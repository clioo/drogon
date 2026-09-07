//! Runs: creation, takeover and bounded inspection of a coordination run.
//!
//! Every function receives the caller's transaction and performs no clock read,
//! ID minting, nested transaction or I/O beyond that connection. Root's engine
//! authenticates the actor and consults the `RequestLedger` *before* calling a
//! mutator, so this module must not imitate replay: a repeated mutator call is a
//! real second attempt and is refused as a duplicate run id.

use crate::pagination::{
    CursorScope, PAGE_RESULT_BUDGET_BYTES, decode_cursor, encode_cursor, fit_page, page_limit,
    split_page,
};
use crate::schema::store_error;
use drogon_protocol::RpcError;
use drogon_protocol::orchestration_run::{
    RunCreateParams, RunCreateResult, RunListParams, RunListResult, RunShowParams, RunShowResult,
    RunSummary, RunUseParams, RunUseResult,
};
use drogon_protocol::orchestration_scope::{CoordinatorScope, MAX_CONSUMER_GENERATION};
use rusqlite::{Row, Transaction, params};

/// Fixed statement pair for run pages. The keyset boundary is the only text
/// interpolated into `RUN_PAGE_NEXT`, and `keyset_boundary` renders it from an
/// integer SQLite cannot accept as a bind parameter inside a row-value
/// comparison; every data value stays a placeholder.
const RUN_PAGE_FIRST: &str = "SELECT run_id, host_id, coordinator_id, consumer_generation, \
     objective, created_at_ms FROM orchestration_runs \
     WHERE host_id = ?1 ORDER BY created_at_ms ASC, run_id ASC LIMIT ?2";

const RUN_PAGE_NEXT: &str = "SELECT run_id, host_id, coordinator_id, consumer_generation, \
     objective, created_at_ms FROM orchestration_runs \
     WHERE host_id = ?1 AND (created_at_ms, run_id) > \
     ((SELECT CAST(%BOUNDARY% AS INTEGER)), ?2) \
     ORDER BY created_at_ms ASC, run_id ASC LIMIT ?3";

/// A run's persisted coordinator binding, which is what every fenced call checks.
struct RunBinding {
    host_id: String,
    coordinator_id: String,
    consumer_generation: u64,
}

/// Verifies a caller's persisted binding (host, run, coordinator, generation).
///
/// `run_not_found` is reserved for a run that does not exist, `unsupported_host`
/// for a run persisted under another host, and `consumer_fenced` for a wrong
/// coordinator *or* a wrong generation — without disclosing which of the two.
pub fn require_coordinator(
    tx: &Transaction<'_>,
    scope: &CoordinatorScope,
) -> Result<(), RpcError> {
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
/// deliberately omits because the engine owns host routing.
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
    let summary = RunSummary {
        run_id: row.get("run_id")?,
        objective: row.get("objective")?,
        coordinator_id: row.get("coordinator_id")?,
        consumer_generation: u64::try_from(row.get::<_, i64>("consumer_generation")?)
            .unwrap_or_default(),
        created_at_ms: u64::try_from(row.get::<_, i64>("created_at_ms")?).unwrap_or_default(),
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
///
/// The initial generation is server-owned and always 1; `run_id` and `now_ms`
/// come from the trusted engine. An existing `run_id` is refused, never
/// overwritten: adopting a caller-chosen id would hand a client another run's
/// coordinator binding.
pub fn create(
    tx: &Transaction<'_>,
    params: &RunCreateParams,
    run_id: &str,
    now_ms: u64,
) -> Result<RunCreateResult, RpcError> {
    let created_at_ms = i64::try_from(now_ms)
        .map_err(|_| RpcError::new("invalid_argument", "Run creation time is out of range."))?;
    let inserted = tx
        .execute(
            "INSERT INTO orchestration_runs
             (run_id, host_id, coordinator_id, consumer_generation, objective, created_at_ms)
             VALUES (?1, ?2, ?3, 1, ?4, ?5)",
            params![run_id, params.host.host_id, params.coordinator_id, params.objective, created_at_ms],
        )
        .map_err(|error| match duplicate(&error, "orchestration_runs.run_id") {
            true => RpcError::new(
                "invalid_argument",
                "A run already exists with the requested identifier.",
            ),
            false => store_error(error),
        })?;
    if inserted != 1 {
        return Err(store_error("run creation did not persist exactly one row"));
    }
    Ok(RunCreateResult {
        run: RunSummary {
            run_id: run_id.to_string(),
            objective: params.objective.clone(),
            coordinator_id: params.coordinator_id.clone(),
            consumer_generation: 1,
            created_at_ms: now_ms,
        },
    })
}

/// True when `error` is the named unique-constraint violation, so the caller can
/// answer a duplicate id with a precise `invalid_argument` instead of a generic
/// storage failure.
fn duplicate(error: &rusqlite::Error, constraint: &str) -> bool {
    matches!(error, rusqlite::Error::SqliteFailure(_, Some(message))
        if message.contains(&format!("UNIQUE constraint failed: {constraint}")))
}

/// Read-only run inspection. Host-scoped per the wire contract, so the caller's
/// `hostId` is compared against the run's persisted host.
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
///
/// Contract detail: `coordinatorId` on `runList` is the caller's identity for
/// receipt recovery, not a filter — listing is how a coordinator discovers runs
/// it may bind, so filtering on it would make `runUse` unusable. The persisted
/// host is the scope; a run stored under another host is never returned.
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
    // The size trim below may keep fewer rows than `limit`, and its cursor
    // resumes at the last kept row, so trimming cannot skip anything.
    let fetch =
        i64::try_from(limit.checked_add(1).ok_or_else(page_too_large)?).map_err(|_| page_too_large())?;
    let statement = match &after {
        None => RUN_PAGE_FIRST.to_string(),
        Some(key) => RUN_PAGE_NEXT.replace(
            "%BOUNDARY%",
            &keyset_boundary(key.after_created_at_ms)?,
        ),
    };
    let mut query = tx.prepare(&statement).map_err(store_error)?;
    let mapped = match &after {
        None => query.query_map(params![params.host.host_id, fetch], read_run_row),
        Some(key) => query.query_map(params![params.host.host_id, key.after_id, fetch], read_run_row),
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
        // last kept row is what makes the next page continue rather than skip.
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

/// Renders the integer keyset boundary for the fixed continuation template.
/// `i64::MAX` caps the comparison, so a boundary can never widen a scan.
fn keyset_boundary(after_created_at_ms: u64) -> Result<String, RpcError> {
    i64::try_from(after_created_at_ms)
        .map(|value| value.to_string())
        .map_err(|_| page_too_large())
}

fn page_too_large() -> RpcError {
    RpcError::new("invalid_argument", "The requested page is too large.")
}

/// Binds a coordinator to an existing run, or explicitly takes it over.
///
/// `takeover: false` requires the caller's generation to match the current one
/// and changes no state — there is no implicit adoption and no silent default to
/// the latest run. `takeover: true` still requires the caller's *known current*
/// generation (proof it observed the state it supersedes), then advances the
/// generation by exactly 1 and installs the new coordinator. A generation at the
/// wire ceiling refuses instead of wrapping.
pub fn use_run(tx: &Transaction<'_>, params: &RunUseParams) -> Result<RunUseResult, RpcError> {
    let current = load_run(tx, &params.run_id)?;
    check_binding(
        &current.binding,
        &params.host.host_id,
        &params.coordinator_id,
        params.consumer_generation,
    )?;
    if !params.takeover {
        return Ok(RunUseResult { run: current.summary });
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
    tx.execute(
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
    // Why re-read rather than echo the computed value: the compare-and-swap guard
    // means a racing takeover can only lose, and what the caller receives must be
    // what is actually on disk.
    let updated = load_run(tx, &params.run_id)?;
    Ok(RunUseResult { run: updated.summary })
}

pub(crate) fn invalid(message: impl Into<String>) -> RpcError {
    RpcError::new("invalid_argument", message)
}
