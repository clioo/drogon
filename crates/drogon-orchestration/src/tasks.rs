//! Tasks: immutable specs, dependency validation, status derivation and bounded

use crate::pagination::{
    CursorScope, PAGE_RESULT_BUDGET_BYTES, decode_cursor, encode_cursor, fit_page, page_limit,
    split_page,
};
use crate::runs::invalid;
use crate::schema::store_error;
use drogon_protocol::RpcError;
use drogon_protocol::orchestration_common::MAX_TASK_TEXT_BYTES;
use drogon_protocol::orchestration_task::{
    TaskCreateParams, TaskCreateResult, TaskListParams, TaskListResult, TaskRecord, TaskShowParams,
    TaskShowResult, TaskSpec, TaskStatus, TaskSummary,
};
use rusqlite::{OptionalExtension, Row, Transaction, params};
use serde_json::Value;
use std::collections::HashSet;

/// Longest instruction text the domain accepts. Shape validation enforces this
const INSTRUCTION_LIMIT: usize = MAX_TASK_TEXT_BYTES;
/// A task may name at most this many prerequisites, so one create cannot
const MAX_DEPENDENCIES: usize = 256;
/// Characters of instruction text a brief listing may return. Counted in
const BRIEF_SPEC_CHARS: usize = 160;

/// Columns of one task row, read by name in `read_task_row`. It is spliced into
const TASK_COLUMNS: &str = "task_id, run_id, status, created_at_ms, instructions, title, \
     display_name, parent_task_id, metadata_json, depends_on_json";

/// First task page. The status filter is a bindable NULL-able predicate, so one
const TASK_PAGE_FIRST: &str = "SELECT %COLUMNS% FROM orchestration_tasks \
     WHERE run_id = ?1 AND host_id = ?2 AND (?3 IS NULL OR status = ?3) \
     ORDER BY created_at_ms ASC, task_id ASC LIMIT ?4";

const TASK_PAGE_NEXT: &str = "SELECT %COLUMNS% FROM orchestration_tasks \
     WHERE run_id = ?1 AND host_id = ?2 AND (?3 IS NULL OR status = ?3) \
     AND (created_at_ms > ?4 OR (created_at_ms = ?4 AND task_id > ?5)) \
     ORDER BY created_at_ms ASC, task_id ASC LIMIT ?6";

/// Maps a persisted status word to the protocol vocabulary. An unrecognised
fn decode_status(raw: &str) -> Result<TaskStatus, RpcError> {
    match raw {
        "pending" => Ok(TaskStatus::Pending),
        "ready" => Ok(TaskStatus::Ready),
        "dispatched" => Ok(TaskStatus::Dispatched),
        "completed" => Ok(TaskStatus::Completed),
        "failed" => Ok(TaskStatus::Failed),
        "blocked" => Ok(TaskStatus::Blocked),
        _ => Err(store_error("a stored task status is not recognised")),
    }
}

fn status_code(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::Pending => "pending",
        TaskStatus::Ready => "ready",
        TaskStatus::Dispatched => "dispatched",
        TaskStatus::Completed => "completed",
        TaskStatus::Failed => "failed",
        TaskStatus::Blocked => "blocked",
    }
}

/// The domain's readiness predicate: `ready` only when every prerequisite is
pub(crate) fn status_for_dependency_statuses(dependencies: &[TaskStatus]) -> TaskStatus {
    if dependencies
        .iter()
        .all(|status| *status == TaskStatus::Completed)
    {
        TaskStatus::Ready
    } else {
        TaskStatus::Pending
    }
}

/// Collapses every whitespace run (newlines included) to single spaces and
fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Brief rendering: collapse, then cap at `BRIEF_SPEC_CHARS` characters. The
fn brief_spec(text: &str) -> (String, bool) {
    let collapsed = collapse_whitespace(text);
    if collapsed.chars().count() <= BRIEF_SPEC_CHARS {
        return (collapsed, false);
    }
    (collapsed.chars().take(BRIEF_SPEC_CHARS).collect(), true)
}

fn encode_string_list(values: &[String]) -> Result<String, RpcError> {
    serde_json::to_string(values).map_err(|_| store_error("a task field could not be stored"))
}

fn decode_string_list(raw: &str) -> Result<Vec<String>, RpcError> {
    serde_json::from_str(raw).map_err(|_| store_error("a stored task field is malformed"))
}

/// Task-authored JSON is stored as text so an absent field stays absent instead
fn encode_json(value: Option<&Value>) -> Result<Option<String>, RpcError> {
    value
        .map(serde_json::to_string)
        .transpose()
        .map_err(|_| store_error("task metadata could not be stored"))
}

fn decode_json(raw: Option<String>) -> Result<Option<Value>, RpcError> {
    raw.as_deref()
        .map(|text| {
            serde_json::from_str(text).map_err(|_| store_error("a stored task field is malformed"))
        })
        .transpose()
}

/// Bounds the domain enforces itself, so a mutation never relies on the caller
fn validate_spec(spec: &TaskSpec) -> Result<(), RpcError> {
    spec.validate_shape()?;
    if spec.instructions.len() > INSTRUCTION_LIMIT {
        return Err(invalid("Task instructions are too long."));
    }
    if spec.depends_on.len() > MAX_DEPENDENCIES {
        return Err(invalid("A task may not declare that many dependencies."));
    }
    Ok(())
}

/// Removes repeated dependency ids while keeping first-occurrence order, so the
fn dedupe_ids(ids: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    ids.iter()
        .filter(|id| seen.insert(id.as_str()))
        .cloned()
        .collect()
}

/// One stored task row, decoded for either a summary or a full detail view.
struct TaskRow {
    task_id: String,
    run_id: String,
    status: TaskStatus,
    created_at_ms: u64,
    instructions: String,
    title: Option<String>,
    display_name: Option<String>,
    metadata: Option<Value>,
    depends_on: Vec<String>,
    parent: Option<String>,
}

impl TaskRow {
    fn record(&self) -> TaskRecord {
        TaskRecord {
            task_id: self.task_id.clone(),
            run_id: self.run_id.clone(),
            status: self.status,
            depends_on: self.depends_on.clone(),
        }
    }

    /// The complete immutable spec, never an elided copy of it.
    fn spec(&self) -> TaskSpec {
        TaskSpec {
            title: self.title.clone(),
            instructions: self.instructions.clone(),
            depends_on: self.depends_on.clone(),
            parent: self.parent.clone(),
            display_name: self.display_name.clone(),
            metadata: self.metadata.clone(),
        }
    }

    /// Listing rendering: full mode returns the instructions verbatim with
    fn summary(&self, brief: bool) -> TaskSummary {
        let (spec, spec_truncated) = if brief {
            brief_spec(&self.instructions)
        } else {
            (self.instructions.clone(), false)
        };
        TaskSummary {
            task_id: self.task_id.clone(),
            status: self.status,
            spec,
            spec_truncated,
            title: self.title.clone(),
            depends_on: Some(self.depends_on.clone()),
        }
    }
}

// Why this shape: rusqlite 0.40.2 cannot carry an RpcError out of a row closure,
fn domain_error(error: RpcError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::other(error.code)),
    )
}

fn unwrap_domain_error(error: rusqlite::Error) -> RpcError {
    if let rusqlite::Error::FromSqlConversionFailure(_, _, inner) = &error
        && let Some(io_error) = inner.downcast_ref::<std::io::Error>()
        && let Some(detail) = io_error.get_ref().map(ToString::to_string)
        && (detail == "storage_error" || detail == "invalid_argument")
    {
        return RpcError::new(
            detail.as_str(),
            "The coordination store holds data this engine cannot read.",
        );
    }
    store_error(error)
}

/// Decodes a task row, JSON columns included. A field that cannot be decoded is
fn read_task_row(row: &Row<'_>) -> rusqlite::Result<TaskRow> {
    Ok(TaskRow {
        task_id: row.get("task_id")?,
        run_id: row.get("run_id")?,
        status: decode_status(&row.get::<_, String>("status")?).map_err(domain_error)?,
        created_at_ms: u64::try_from(row.get::<_, i64>("created_at_ms")?)
            .map_err(|_| rusqlite::Error::InvalidQuery)?,
        instructions: row.get("instructions")?,
        title: row.get("title")?,
        display_name: row.get("display_name")?,
        metadata: decode_json(row.get::<_, Option<String>>("metadata_json")?)
            .map_err(domain_error)?,
        depends_on: decode_string_list(&row.get::<_, String>("depends_on_json")?)
            .map_err(domain_error)?,
        parent: row.get("parent_task_id")?,
    })
}

/// Loads a task and proves it lives in the caller's run, so a task id cannot be
fn load_task_in_run(
    tx: &Transaction<'_>,
    task_id: &str,
    run_id: &str,
) -> Result<TaskRow, RpcError> {
    tx.query_row(
        "SELECT task_id, run_id, status, created_at_ms, instructions, title, display_name, \
         parent_task_id, metadata_json, depends_on_json \
         FROM orchestration_tasks WHERE task_id = ?1 AND run_id = ?2",
        params![task_id, run_id],
        read_task_row,
    )
    .optional()
    .map_err(unwrap_domain_error)?
    .ok_or_else(|| RpcError::new("task_not_found", "No task exists in this run with that id."))
}

/// Creates one task in a run whose coordinator binding the caller's scope proves.
pub fn create(
    tx: &Transaction<'_>,
    params: &TaskCreateParams,
    task_id: &str,
    now_ms: u64,
) -> Result<TaskCreateResult, RpcError> {
    params.validate_shape(&params.scope.host.host_id)?;
    crate::runs::validate_id(task_id)?;
    let created_at_ms =
        i64::try_from(now_ms).map_err(|_| invalid("Task creation time is out of range."))?;
    crate::runs::require_coordinator(tx, &params.scope)?;
    validate_spec(&params.spec)?;
    let depends_on = dedupe_ids(&params.spec.depends_on);

    let mut dependency_statuses = Vec::with_capacity(depends_on.len());
    for dependency in &depends_on {
        if dependency == task_id {
            return Err(invalid("A task may not depend on itself."));
        }
        // The run-scoped lookup is what refuses a cross-run dependency: an id
        let raw = tx
            .query_row(
                "SELECT status FROM orchestration_tasks WHERE task_id = ?1 AND run_id = ?2",
                params![dependency, params.scope.run_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(store_error)?
            .ok_or_else(|| invalid("A task dependency does not exist in this run."))?;
        dependency_statuses.push(decode_status(&raw)?);
    }

    if let Some(parent) = &params.spec.parent {
        if parent == task_id {
            return Err(invalid("A task may not be its own parent."));
        }
        let exists: Option<String> = tx
            .query_row(
                "SELECT task_id FROM orchestration_tasks WHERE task_id = ?1 AND run_id = ?2",
                params![parent, params.scope.run_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(store_error)?;
        if exists.is_none() {
            return Err(invalid("The parent task does not exist in this run."));
        }
    }

    let status = status_for_dependency_statuses(&dependency_statuses);
    tx.execute(
        "INSERT INTO orchestration_tasks
         (task_id, run_id, host_id, title, display_name, instructions, depends_on_json,
          parent_task_id, metadata_json, status, created_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            task_id,
            params.scope.run_id,
            params.scope.host.host_id,
            params.spec.title,
            params.spec.display_name,
            params.spec.instructions,
            encode_string_list(&depends_on)?,
            params.spec.parent,
            encode_json(params.spec.metadata.as_ref())?,
            status_code(status),
            created_at_ms
        ],
    )
    .map_err(|error| match error {
        rusqlite::Error::SqliteFailure(_, Some(message))
            if message.contains("UNIQUE constraint failed: orchestration_tasks.task_id") =>
        {
            invalid("A task already exists with the requested identifier.")
        }
        other => store_error(other),
    })?;

    for (position, dependency) in depends_on.iter().enumerate() {
        let position = i64::try_from(position)
            .map_err(|_| invalid("A task may not declare that many dependencies."))?;
        tx.execute(
            "INSERT INTO orchestration_task_dependencies
             (task_id, depends_on_task_id, position) VALUES (?1, ?2, ?3)",
            params![task_id, dependency, position],
        )
        .map_err(store_error)?;
    }

    Ok(TaskCreateResult {
        task: TaskRecord {
            task_id: task_id.to_string(),
            run_id: params.scope.run_id.clone(),
            status,
            depends_on,
        },
    })
}

/// Full task detail: the complete immutable spec plus the attempt history the
pub fn show(tx: &Transaction<'_>, params: &TaskShowParams) -> Result<TaskShowResult, RpcError> {
    crate::runs::require_coordinator(tx, &params.scope)?;
    let row = load_task_in_run(tx, &params.task_id, &params.scope.run_id)?;
    Ok(TaskShowResult {
        task: row.record(),
        spec: row.spec(),
        attempts: Vec::new(),
        active_dispatch_id: None,
    })
}

/// Cursor filter identity. `ready` normalises to the same key as `status: ready`
fn filter_key(params: &TaskListParams) -> String {
    if params.ready {
        return status_code(TaskStatus::Ready).to_string();
    }
    params
        .status
        .map(|status| status_code(status).to_string())
        .unwrap_or_default()
}

pub fn list(tx: &Transaction<'_>, params: &TaskListParams) -> Result<TaskListResult, RpcError> {
    params.validate_shape(&params.scope.host.host_id)?;
    crate::runs::require_coordinator(tx, &params.scope)?;
    let limit = page_limit(params.limit)?;
    let scope = CursorScope {
        family: "task",
        host_id: params.scope.host.host_id.clone(),
        run_id: params.scope.run_id.clone(),
        filter: filter_key(params),
        after_created_at_ms: 0,
        after_id: String::new(),
    };
    let after = params
        .cursor
        .as_ref()
        .map(|cursor| decode_cursor(cursor, &scope))
        .transpose()?;
    let status_filter = if params.ready {
        Some(status_code(TaskStatus::Ready))
    } else {
        params.status.map(status_code)
    };
    // Why the fetch is `limit + 1`: a surplus row proves a next page exists.
    let fetch = i64::try_from(limit.checked_add(1).ok_or_else(page_too_large)?)
        .map_err(|_| page_too_large())?;
    let statement = match &after {
        None => TASK_PAGE_FIRST.replace("%COLUMNS%", TASK_COLUMNS),
        Some(_) => TASK_PAGE_NEXT.replace("%COLUMNS%", TASK_COLUMNS),
    };
    let mut query = tx.prepare(&statement).map_err(store_error)?;
    let mapped = match &after {
        None => query.query_map(
            params![
                params.scope.run_id,
                params.scope.host.host_id,
                status_filter,
                fetch
            ],
            read_task_row,
        ),
        Some(key) => query.query_map(
            params![
                params.scope.run_id,
                params.scope.host.host_id,
                status_filter,
                i64::try_from(key.after_created_at_ms).map_err(|_| page_too_large())?,
                key.after_id,
                fetch
            ],
            read_task_row,
        ),
    }
    .map_err(unwrap_domain_error)?;
    // A corrupt status on one row must fail the whole listing, not vanish from it.
    let probed = mapped
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(unwrap_domain_error)?;
    let (rows, row_cap_reached) = split_page(probed, limit);

    let summaries = rows
        .iter()
        .map(|row| row.summary(params.brief))
        .collect::<Vec<_>>();
    let (kept, budget_reached) = fit_page(summaries, PAGE_RESULT_BUDGET_BYTES)?;
    let next_cursor = match kept.last() {
        // Either a row cap or a size trim means more rows exist; minting from the
        Some(last) if row_cap_reached || budget_reached => Some(encode_cursor(&CursorScope {
            after_created_at_ms: rows[kept.len() - 1].created_at_ms,
            after_id: last.task_id.clone(),
            ..scope
        })?),
        _ => None,
    };
    Ok(TaskListResult {
        tasks: kept,
        next_cursor,
    })
}

fn page_too_large() -> RpcError {
    RpcError::new("invalid_argument", "The requested page is too large.")
}

/// Called only inside the engine's authenticated attempt transaction.
pub fn set_status_in_tx(
    tx: &Transaction<'_>,
    host_id: &str,
    run_id: &str,
    task_id: &str,
    status: TaskStatus,
) -> Result<(), RpcError> {
    let changed = tx.execute(
        "UPDATE orchestration_tasks SET status=?4 WHERE host_id=?1 AND run_id=?2 AND task_id=?3",
        params![host_id, run_id, task_id, status_code(status)],
    ).map_err(store_error)?;
    if changed != 1 {
        return Err(RpcError::new(
            "task_not_found",
            "No task exists in this run with that id.",
        ));
    }
    if status == TaskStatus::Completed {
        tx.execute(
            "UPDATE orchestration_tasks AS child SET status='ready'
             WHERE child.host_id=?1 AND child.run_id=?2 AND child.status='pending'
             AND EXISTS(SELECT 1 FROM orchestration_task_dependencies AS edge
                 WHERE edge.task_id=child.task_id AND edge.depends_on_task_id=?3)
             AND NOT EXISTS(SELECT 1 FROM orchestration_task_dependencies AS edge
                 LEFT JOIN orchestration_tasks AS prerequisite
                   ON prerequisite.task_id=edge.depends_on_task_id
                   AND prerequisite.host_id=?1 AND prerequisite.run_id=?2
                 WHERE edge.task_id=child.task_id
                   AND (prerequisite.status IS NULL OR prerequisite.status <> 'completed'))",
            params![host_id, run_id, task_id],
        )
        .map_err(store_error)?;
    }
    Ok(())
}

/// Recheck prerequisites at admission; a prior ready label is not authority.
pub fn require_completed_dependencies(
    tx: &Transaction<'_>,
    host_id: &str,
    run_id: &str,
    task_id: &str,
) -> Result<(), RpcError> {
    let waiting: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM orchestration_task_dependencies AS edge
         LEFT JOIN orchestration_tasks AS prerequisite ON prerequisite.task_id=edge.depends_on_task_id
           AND prerequisite.host_id=?1 AND prerequisite.run_id=?2
         WHERE edge.task_id=?3 AND (prerequisite.status IS NULL OR prerequisite.status <> 'completed'))",
        params![host_id,run_id,task_id], |row| row.get(0),
    ).map_err(store_error)?;
    if waiting {
        return Err(RpcError::new(
            "task_not_ready",
            "Task prerequisites have not completed successfully.",
        ));
    }
    Ok(())
}
