//! Additive, versioned run/task tables owned by this domain.

use drogon_protocol::RpcError;
use rusqlite::{OptionalExtension, Transaction, params};

/// Version stamped into `orchestration_domain_meta` for the DDL applied below.
pub const SCHEMA_VERSION: i64 = 1;

const DDL: &str = "
CREATE TABLE IF NOT EXISTS orchestration_domain_meta (
    version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orchestration_runs (
    run_id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    coordinator_id TEXT NOT NULL,
    consumer_generation INTEGER NOT NULL,
    objective TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS orchestration_runs_page
    ON orchestration_runs(host_id, created_at_ms, run_id);

CREATE TABLE IF NOT EXISTS orchestration_tasks (
    task_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    host_id TEXT NOT NULL,
    title TEXT,
    display_name TEXT,
    instructions TEXT NOT NULL,
    depends_on_json TEXT NOT NULL,
    parent_task_id TEXT,
    metadata_json TEXT,
    status TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS orchestration_tasks_page
    ON orchestration_tasks(run_id, host_id, created_at_ms, task_id);

CREATE TABLE IF NOT EXISTS orchestration_task_dependencies (
    task_id TEXT NOT NULL,
    depends_on_task_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (task_id, depends_on_task_id)
);
";

/// Reads the applied domain schema version: `None` when the tables are absent.
pub fn schema_version(connection: &rusqlite::Connection) -> Result<Option<i64>, RpcError> {
    // SQLite's EXISTS() is an integer, so the same type is read back explicitly.
    let table_exists = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table'
                           AND name = 'orchestration_domain_meta')",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(store_error)?
        != 0;
    if !table_exists {
        return Ok(None);
    }
    connection
        .query_row(
            "SELECT MAX(version) FROM orchestration_domain_meta",
            [],
            |row| row.get::<_, Option<i64>>(0),
        )
        .optional()
        .map_err(store_error)?
        .flatten()
        .map_or(Ok(None), |version| Ok(Some(version)))
}

/// Applies the additive DDL and stamps `SCHEMA_VERSION` inside the caller's
pub fn migrate_in_tx(tx: &Transaction<'_>) -> Result<(), RpcError> {
    if let Some(applied) = schema_version(tx)?
        && applied != SCHEMA_VERSION
    {
        return Err(RpcError::new(
            "unsupported_orchestration_contract",
            "The stored coordination domain schema is not supported by this engine.",
        ));
    }
    tx.execute_batch(DDL).map_err(store_error)?;
    // Insert only when nothing is stamped yet, so a restart never writes a second
    if schema_version(tx)?.is_none() {
        tx.execute(
            "INSERT INTO orchestration_domain_meta (version) VALUES (?1)",
            params![SCHEMA_VERSION],
        )
        .map_err(store_error)?;
    }
    Ok(())
}

/// Shared safe rendering of an SQLite failure: stable code and a short message,
pub(crate) fn store_error(_detail: impl std::fmt::Display) -> RpcError {
    RpcError::new(
        "storage_error",
        "The coordination store could not complete the operation.",
    )
}
