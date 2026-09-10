//! Durable monitor + check history storage (C10 checkpoint 1).
//!
//! Own tables only (`bot_monitors`, `bot_monitor_checks`) under the
//! `bot_monitors` schema component. Full records round-trip as
//! `payload_json`; `id`/`host_id`/`project_id`/`bot_id` are indexed columns
//! so scope listings never parse JSON.
//!
//! This module never implements an outbox: the caller's C05 delivery write
//! and the cursor CAS below must commit in one caller-owned transaction.
//! History rows are retained after disable/delete (orphaned evidence, like
//! Bot responsibility runs) and carry the delivery uncertainty of the
//! event they describe. No processes, no network, no model calls.

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};

use super::record::MonitorRecord;
use super::result::MonitorCheckResult;

pub const MONITORS_SCHEMA_COMPONENT: &str = "bot_monitors";
pub const MONITORS_SCHEMA_VERSION: i64 = 1;

#[derive(Debug)]
pub enum StorageError {
    Sqlite(rusqlite::Error),
    Json(serde_json::Error),
    Validation(String),
    NotFound(&'static str),
    IdCollision,
    StaleUpdate,
    UnsupportedSchemaVersion {
        component: &'static str,
        found: i64,
        supported: i64,
    },
}

impl From<rusqlite::Error> for StorageError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

impl From<serde_json::Error> for StorageError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

impl std::fmt::Display for StorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sqlite(e) => write!(f, "sqlite error: {e}"),
            Self::Json(e) => write!(f, "json error: {e}"),
            Self::Validation(message) => write!(f, "invalid monitor record: {message}"),
            Self::NotFound(what) => write!(f, "{what} not found"),
            Self::IdCollision => write!(f, "a monitor with this id already exists"),
            Self::StaleUpdate => write!(f, "stale update: row changed since it was read"),
            Self::UnsupportedSchemaVersion {
                component,
                found,
                supported,
            } => write!(
                f,
                "{component} schema version {found} is newer than the {supported} this build supports"
            ),
        }
    }
}

impl std::error::Error for StorageError {}

type Result<T> = std::result::Result<T, StorageError>;

/// Delivery uncertainty retained with each check row. `NotApplicable`
/// covers no-change/error outcomes (nothing was emitted); the other three
/// describe a changed event's delivery only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryState {
    NotApplicable,
    Pending,
    Confirmed,
    Uncertain,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCheck {
    pub id: String,
    pub monitor_id: String,
    pub monitor_version: u64,
    pub started_at_ms: f64,
    pub result: MonitorCheckResult,
    pub delivery: DeliveryState,
}

fn create_tables(tx: &Transaction) -> Result<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS bot_monitors (
            id TEXT PRIMARY KEY,
            host_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            bot_id TEXT,
            updated_at REAL NOT NULL,
            rev INTEGER NOT NULL DEFAULT 0,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS bot_monitors_scope ON bot_monitors(host_id, project_id);
        CREATE TABLE IF NOT EXISTS bot_monitor_checks (
            id TEXT PRIMARY KEY,
            monitor_id TEXT NOT NULL,
            started_at REAL NOT NULL,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS bot_monitor_checks_monitor_id ON bot_monitor_checks(monitor_id);",
    )?;
    Ok(())
}

pub fn check_schema_not_ahead(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_versions (
            component TEXT PRIMARY KEY,
            version INTEGER NOT NULL
        );",
    )?;
    let existing: Option<i64> = conn
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![MONITORS_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(found) = existing
        && found > MONITORS_SCHEMA_VERSION
    {
        return Err(StorageError::UnsupportedSchemaVersion {
            component: MONITORS_SCHEMA_COMPONENT,
            found,
            supported: MONITORS_SCHEMA_VERSION,
        });
    }
    Ok(())
}

pub fn apply_pending_steps_in_tx(tx: &Transaction) -> Result<()> {
    check_schema_not_ahead(tx)?;
    let existing: Option<i64> = tx
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![MONITORS_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    if existing.is_none() {
        create_tables(tx)?;
        tx.execute(
            "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)",
            params![MONITORS_SCHEMA_COMPONENT, MONITORS_SCHEMA_VERSION],
        )?;
    }
    Ok(())
}

pub fn migrate(conn: &Connection) -> Result<()> {
    check_schema_not_ahead(conn)?;
    let existing: Option<i64> = conn
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![MONITORS_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    if existing.is_some() {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    create_tables(&tx)?;
    tx.execute(
        "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)",
        params![MONITORS_SCHEMA_COMPONENT, MONITORS_SCHEMA_VERSION],
    )?;
    tx.commit()?;
    Ok(())
}

fn row_to_record(json: String) -> Result<MonitorRecord> {
    Ok(serde_json::from_str(&json)?)
}

fn scope_of(record: &MonitorRecord) -> (String, String, Option<String>) {
    let rule = record.rule.local_file();
    (
        rule.host_id.clone(),
        rule.project_id.clone(),
        record.bot_id.clone(),
    )
}

/// Insert a new monitor. Validates the record shape first; a reused `id`
/// is [`StorageError::IdCollision`], never an overwrite.
pub fn create_monitor(conn: &Connection, record: &MonitorRecord) -> Result<()> {
    record.validate().map_err(StorageError::Validation)?;
    let payload = serde_json::to_string(record)?;
    let (host_id, project_id, bot_id) = scope_of(record);
    match conn.execute(
        "INSERT INTO bot_monitors (id, host_id, project_id, bot_id, updated_at, rev, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
        params![
            record.id,
            host_id,
            project_id,
            bot_id,
            record.updated_at_ms,
            payload
        ],
    ) {
        Ok(_) => Ok(()),
        Err(rusqlite::Error::SqliteFailure(e, _))
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            Err(StorageError::IdCollision)
        }
        Err(e) => Err(e.into()),
    }
}

pub fn get_monitor(conn: &Connection, id: &str) -> Result<Option<(MonitorRecord, i64)>> {
    conn.query_row(
        "SELECT payload_json, rev FROM bot_monitors WHERE id = ?1",
        params![id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
    )
    .optional()?
    .map(|(json, rev)| Ok((row_to_record(json)?, rev)))
    .transpose()
}

/// Compare-and-swap write guarded by the internal `rev` column (never by
/// `updated_at`). The caller passes the `rev` snapshot from [`get_monitor`].
pub fn cas_write(conn: &Connection, record: &MonitorRecord, expected_rev: i64) -> Result<()> {
    record.validate().map_err(StorageError::Validation)?;
    let payload = serde_json::to_string(record)?;
    let (host_id, project_id, bot_id) = scope_of(record);
    let affected = conn.execute(
        "UPDATE bot_monitors SET host_id = ?1, project_id = ?2, bot_id = ?3,
         updated_at = ?4, rev = rev + 1, payload_json = ?5
         WHERE id = ?6 AND rev = ?7",
        params![
            host_id,
            project_id,
            bot_id,
            record.updated_at_ms,
            payload,
            record.id,
            expected_rev
        ],
    )?;
    if affected == 0 {
        let still_exists: Option<i64> = conn
            .query_row(
                "SELECT 1 FROM bot_monitors WHERE id = ?1",
                params![record.id],
                |r| r.get(0),
            )
            .optional()?;
        return Err(if still_exists.is_some() {
            StorageError::StaleUpdate
        } else {
            StorageError::NotFound("monitor")
        });
    }
    Ok(())
}

/// Delete the monitor row but retain its check history as orphaned
/// evidence. Returns false when no such monitor existed.
pub fn delete_monitor(conn: &Connection, id: &str) -> Result<bool> {
    let deleted = conn.execute("DELETE FROM bot_monitors WHERE id = ?1", params![id])?;
    Ok(deleted > 0)
}

pub fn list_monitors_for_project(
    conn: &Connection,
    host_id: &str,
    project_id: &str,
) -> Result<Vec<MonitorRecord>> {
    let mut stmt = conn.prepare(
        "SELECT payload_json FROM bot_monitors WHERE host_id = ?1 AND project_id = ?2 ORDER BY rowid",
    )?;
    let rows = stmt
        .query_map(params![host_id, project_id], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter().map(row_to_record).collect()
}

/// Append one check row (every evaluation — no-change, changed, and error
/// alike — so history, last success/error, and delivery uncertainty are
/// never erased by a later tick).
pub fn record_check(conn: &Connection, check: &StoredCheck) -> Result<()> {
    let payload = serde_json::to_string(check)?;
    conn.execute(
        "INSERT INTO bot_monitor_checks (id, monitor_id, started_at, payload_json)
         VALUES (?1, ?2, ?3, ?4)",
        params![check.id, check.monitor_id, check.started_at_ms, payload],
    )?;
    Ok(())
}

pub fn list_checks_for_monitor(conn: &Connection, monitor_id: &str) -> Result<Vec<StoredCheck>> {
    let mut stmt = conn.prepare(
        "SELECT payload_json FROM bot_monitor_checks WHERE monitor_id = ?1 ORDER BY started_at",
    )?;
    let rows = stmt
        .query_map(params![monitor_id], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|json| Ok(serde_json::from_str(&json)?))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::record::{MonitorTrigger, new_monitor};
    use super::super::result::{MonitorCheckResult, MonitorErrorKind};
    use super::super::rule::{LocalFileRule, MonitorRule};
    use super::*;

    fn record(id: &str) -> MonitorRecord {
        let rule = MonitorRule::LocalFileDigest(LocalFileRule {
            host_id: "h".to_string(),
            project_id: "p".to_string(),
            resource: "notes/a.md".to_string(),
            max_bytes: 1024,
        });
        let hash = rule.approval_hash();
        new_monitor(id.into(), None, rule, MonitorTrigger::Manual, hash, 1.0).unwrap()
    }

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn create_get_cas_and_delete_retain_checks() {
        let conn = memory_db();
        let rec = record("mon-1");
        create_monitor(&conn, &rec).unwrap();
        assert!(matches!(
            create_monitor(&conn, &rec),
            Err(StorageError::IdCollision)
        ));
        let (loaded, rev) = get_monitor(&conn, "mon-1").unwrap().unwrap();
        assert_eq!(loaded.id, "mon-1");
        let mut edited = loaded.clone();
        edited.enabled = false;
        edited.updated_at_ms = 2.0;
        cas_write(&conn, &edited, rev).unwrap();
        // A stale rev no longer writes.
        assert!(matches!(
            cas_write(&conn, &edited, rev),
            Err(StorageError::StaleUpdate)
        ));
        let check = StoredCheck {
            id: "chk-1".into(),
            monitor_id: "mon-1".into(),
            monitor_version: 1,
            started_at_ms: 3.0,
            result: MonitorCheckResult::error("mon-1", 1, MonitorErrorKind::NotFound, "gone", 3.0),
            delivery: DeliveryState::NotApplicable,
        };
        record_check(&conn, &check).unwrap();
        assert!(delete_monitor(&conn, "mon-1").unwrap());
        assert!(get_monitor(&conn, "mon-1").unwrap().is_none());
        // History survives the delete.
        assert_eq!(list_checks_for_monitor(&conn, "mon-1").unwrap().len(), 1);
    }
}
