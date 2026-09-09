//! Runs: creation, takeover and bounded inspection of a coordination run.

use crate::pagination::{
    CursorScope, PAGE_RESULT_BUDGET_BYTES, decode_cursor, encode_cursor, fit_page, page_limit,
    split_page,
};
use crate::schema::store_error;
use drogon_protocol::RpcError;
use drogon_protocol::orchestration_run::{
    RunCreateParams, RunCreateResult, RunCurrentParams, RunCurrentResult, RunListParams,
    RunListResult, RunShowParams, RunShowResult, RunSummary, RunUseParams, RunUseResult,
};
use drogon_protocol::orchestration_scope::{CoordinatorScope, MAX_CONSUMER_GENERATION};
use rusqlite::{OptionalExtension, Row, Transaction, params};

const RUN_PAGE_FIRST: &str = "SELECT run_id, host_id, coordinator_id, consumer_generation, \
     objective, created_at_ms FROM orchestration_runs \
     WHERE host_id = ?1 ORDER BY created_at_ms ASC, run_id ASC LIMIT ?2";

const RUN_PAGE_NEXT: &str = "SELECT run_id, host_id, coordinator_id, consumer_generation, \
     objective, created_at_ms FROM orchestration_runs \
     WHERE host_id = ?1 AND (created_at_ms > ?2 OR (created_at_ms = ?2 AND run_id > ?3)) \
     ORDER BY created_at_ms ASC, run_id ASC LIMIT ?4";

/// A run's persisted coordinator binding, which is what every fenced call checks.
struct RunBinding {
    host_id: String,
    coordinator_id: String,
    consumer_generation: u64,
}

/// Verifies a caller's persisted binding (host, run, coordinator, generation).
pub fn require_coordinator(tx: &Transaction<'_>, scope: &CoordinatorScope) -> Result<(), RpcError> {
    let run = load_run(tx, &scope.run_id)?;
    check_binding(
        &RunBinding {
            host_id: run.binding.host_id.clone(),
            coordinator_id: run.summary.coordinator_id.clone(),
            consumer_generation: run.summary.consumer_generation,
        },
        &scope.host.host_id,
        &scope.coordinator_id,
        scope.consumer_generation,
    )
}

fn check_binding(
    run: &RunBinding,
    host_id: &str,
    coordinator_id: &str,
    consumer_generation: u64,
) -> Result<(), RpcError> {
    if run.host_id != host_id {
        return Err(RpcError::new(
            "unsupported_host",
            "The requested execution host is not served by this endpoint.",
        ));
    }
    if run.coordinator_id != coordinator_id || run.consumer_generation != consumer_generation {
        return Err(RpcError::new(
            "consumer_fenced",
            "The supplied coordinator binding no longer owns this run.",
        ));
    }
    Ok(())
}

/// A run row: the public summary plus the persisted host, which the wire summary
struct RunRow {
    binding: RunBinding,
    summary: RunSummary,
}

fn load_run(tx: &Transaction<'_>, run_id: &str) -> Result<RunRow, RpcError> {
    tx.query_row(
        "SELECT run_id, host_id, coordinator_id, consumer_generation, objective, created_at_ms \
         FROM orchestration_runs WHERE run_id = ?1",
        params![run_id],
        read_run_row,
    )
    .map_err(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => {
            RpcError::new("run_not_found", "No run exists with that identifier.")
        }
        other => store_error(other),
    })
}

fn read_run_row(row: &Row<'_>) -> rusqlite::Result<RunRow> {
    let consumer_generation = u64::try_from(row.get::<_, i64>("consumer_generation")?)
        .map_err(|_| rusqlite::Error::InvalidQuery)?;
    if !(1..=MAX_CONSUMER_GENERATION).contains(&consumer_generation) {
        return Err(rusqlite::Error::InvalidQuery);
    }
    let summary = RunSummary {
        run_id: row.get("run_id")?,
        objective: row.get("objective")?,
        coordinator_id: row.get("coordinator_id")?,
        consumer_generation,
        created_at_ms: u64::try_from(row.get::<_, i64>("created_at_ms")?)
            .map_err(|_| rusqlite::Error::InvalidQuery)?,
    };
    Ok(RunRow {
        binding: RunBinding {
            host_id: row.get("host_id")?,
            coordinator_id: summary.coordinator_id.clone(),
            consumer_generation: summary.consumer_generation,
        },
        summary,
    })
}

/// Creates a run bound to its first coordinator at generation 1.
pub fn create(
    tx: &Transaction<'_>,
    params: &RunCreateParams,
    run_id: &str,
    now_ms: u64,
) -> Result<RunCreateResult, RpcError> {
    params.validate_shape(&params.host.host_id)?;
    validate_id(run_id)?;
    let created_at_ms = i64::try_from(now_ms)
        .map_err(|_| RpcError::new("invalid_argument", "Run creation time is out of range."))?;
    let inserted = tx
        .execute(
            "INSERT INTO orchestration_runs
             (run_id, host_id, coordinator_id, consumer_generation, objective, created_at_ms)
             VALUES (?1, ?2, ?3, 1, ?4, ?5)",
            params![
                run_id,
                params.host.host_id,
                params.coordinator_id,
                params.objective,
                created_at_ms
            ],
        )
        .map_err(
            |error| match duplicate(&error, "orchestration_runs.run_id") {
                true => RpcError::new(
                    "invalid_argument",
                    "A run already exists with the requested identifier.",
                ),
                false => store_error(error),
            },
        )?;
    if inserted != 1 {
        return Err(store_error("run creation did not persist exactly one row"));
    }
    let run = RunSummary {
        run_id: run_id.to_string(),
        objective: params.objective.clone(),
        coordinator_id: params.coordinator_id.clone(),
        consumer_generation: 1,
        created_at_ms: now_ms,
    };
    bind_current(tx, &params.host.host_id, &run)?;
    Ok(RunCreateResult { run })
}

fn bind_current(tx: &Transaction<'_>, host: &str, run: &RunSummary) -> Result<(), RpcError> {
    let generation = i64::try_from(run.consumer_generation).map_err(store_error)?;
    let changed = tx.execute("INSERT INTO orchestration_run_bindings(host_id,coordinator_id,run_id,consumer_generation) VALUES (?1,?2,?3,?4)
        ON CONFLICT(host_id,coordinator_id) DO UPDATE SET run_id=excluded.run_id,consumer_generation=excluded.consumer_generation",
        params![host,run.coordinator_id,run.run_id,generation]).map_err(store_error)?;
    if changed != 1 {
        return Err(store_error("Current run binding was not persisted."));
    }
    Ok(())
}

pub fn current(
    tx: &Transaction<'_>,
    params: &RunCurrentParams,
) -> Result<RunCurrentResult, RpcError> {
    params.validate_shape(&params.host.host_id)?;
    let run = tx.query_row("SELECT r.run_id,r.host_id,r.coordinator_id,r.consumer_generation,r.objective,r.created_at_ms
        FROM orchestration_run_bindings AS b JOIN orchestration_runs AS r ON r.run_id=b.run_id
        WHERE b.host_id=?1 AND b.coordinator_id=?2 AND r.host_id=b.host_id
            AND r.coordinator_id=b.coordinator_id AND r.consumer_generation=b.consumer_generation",
        params![params.host.host_id,params.coordinator_id], read_run_row).optional().map_err(store_error)?;
    Ok(RunCurrentResult {
        run: run.map(|row| row.summary),
    })
}

/// True when `error` is the named unique-constraint violation, so the caller can
fn duplicate(error: &rusqlite::Error, constraint: &str) -> bool {
    matches!(error, rusqlite::Error::SqliteFailure(_, Some(message))
        if message.contains(&format!("UNIQUE constraint failed: {constraint}")))
}

/// Read-only run inspection. Host-scoped per the wire contract, so the caller's
pub fn show(tx: &Transaction<'_>, params: &RunShowParams) -> Result<RunShowResult, RpcError> {
    let run = load_run(tx, &params.run_id)?;
    if run.binding.host_id != params.host.host_id {
        return Err(RpcError::new(
            "unsupported_host",
            "The requested execution host is not served by this endpoint.",
        ));
    }
    let task_count = tx
        .query_row(
            "SELECT COUNT(*) FROM orchestration_tasks WHERE run_id = ?1",
            params![params.run_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(store_error)?;
    Ok(RunShowResult {
        run: run.summary,
        task_count: u32::try_from(task_count).ok(),
    })
}

/// Host-scoped, cursor-paginated run listing.
pub fn list(tx: &Transaction<'_>, params: &RunListParams) -> Result<RunListResult, RpcError> {
    let limit = page_limit(params.limit)?;
    let scope = CursorScope {
        family: "run",
        host_id: params.host.host_id.clone(),
        run_id: String::new(),
        filter: String::new(),
        after_created_at_ms: 0,
        after_id: String::new(),
    };
    let after = params
        .cursor
        .as_ref()
        .map(|cursor| decode_cursor(cursor, &scope))
        .transpose()?;

    // Why the fetch is `limit + 1`: a surplus row proves a next page exists.
    let fetch = i64::try_from(limit.checked_add(1).ok_or_else(page_too_large)?)
        .map_err(|_| page_too_large())?;
    let statement = match &after {
        None => RUN_PAGE_FIRST,
        Some(_) => RUN_PAGE_NEXT,
    };
    let mut query = tx.prepare(statement).map_err(store_error)?;
    let mapped = match &after {
        None => query.query_map(params![params.host.host_id, fetch], read_run_row),
        Some(key) => query.query_map(
            params![
                params.host.host_id,
                i64::try_from(key.after_created_at_ms).map_err(|_| page_too_large())?,
                key.after_id,
                fetch
            ],
            read_run_row,
        ),
    }
    .map_err(store_error)?;
    let probed = mapped
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(store_error)?;
    let (rows, row_cap_reached) = split_page(probed, limit);

    let summaries = rows.into_iter().map(|row| row.summary).collect::<Vec<_>>();
    let (kept, budget_reached) = fit_page(summaries, PAGE_RESULT_BUDGET_BYTES)?;
    let next_cursor = match kept.last() {
        // A row cap or a size trim both mean "more exists"; minting from the
        Some(last) if row_cap_reached || budget_reached => Some(encode_cursor(&CursorScope {
            after_created_at_ms: last.created_at_ms,
            after_id: last.run_id.clone(),
            ..scope
        })?),
        _ => None,
    };
    Ok(RunListResult {
        runs: kept,
        next_cursor,
    })
}

fn page_too_large() -> RpcError {
    RpcError::new("invalid_argument", "The requested page is too large.")
}

/// Binds a coordinator to an existing run, or explicitly takes it over.
pub fn use_run(tx: &Transaction<'_>, params: &RunUseParams) -> Result<RunUseResult, RpcError> {
    params.validate_shape(&params.host.host_id)?;
    let current = load_run(tx, &params.run_id)?;
    check_binding(
        &current.binding,
        &params.host.host_id,
        if params.takeover {
            &current.summary.coordinator_id
        } else {
            &params.coordinator_id
        },
        params.consumer_generation,
    )?;
    if !params.takeover {
        bind_current(tx, &params.host.host_id, &current.summary)?;
        return Ok(RunUseResult {
            run: current.summary,
        });
    }
    let next_generation = current
        .summary
        .consumer_generation
        .checked_add(1)
        .filter(|next| *next <= MAX_CONSUMER_GENERATION)
        .ok_or_else(|| {
            RpcError::new(
                "consumer_fenced",
                "The run consumer generation cannot advance further.",
            )
        })?;
    let changed = tx
        .execute(
            "UPDATE orchestration_runs
         SET coordinator_id = ?2, consumer_generation = ?3
         WHERE run_id = ?1 AND consumer_generation = ?4",
            params![
                params.run_id,
                params.coordinator_id,
                i64::try_from(next_generation).unwrap_or(i64::MAX),
                i64::try_from(current.summary.consumer_generation).unwrap_or(i64::MAX)
            ],
        )
        .map_err(store_error)?;
    if changed != 1 {
        return Err(RpcError::new(
            "consumer_fenced",
            "The run binding changed during takeover.",
        ));
    }
    // Why re-read rather than echo the computed value: the compare-and-swap guard
    let updated = load_run(tx, &params.run_id)?;
    bind_current(tx, &params.host.host_id, &updated.summary)?;
    Ok(RunUseResult {
        run: updated.summary,
    })
}

pub(crate) fn invalid(message: impl Into<String>) -> RpcError {
    RpcError::new("invalid_argument", message)
}

pub(crate) fn validate_id(value: &str) -> Result<(), RpcError> {
    drogon_protocol::orchestration_common::validate_opaque_token(
        value,
        128,
        "Invalid coordination identifier.",
    )
}
