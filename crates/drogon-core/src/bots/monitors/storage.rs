//! Durable monitor + check history storage (C10 checkpoint 1).
//!
//! Own tables only (`bot_monitors`, `bot_monitor_checks`) under the
//! `bot_monitors` schema component. Full records round-trip as
//! `payload_json`; `id`/`host_id`/`project_id`/`bot_id` are indexed columns
//! so scope listings never parse JSON.
//!
//! v3 adds `bot_monitor_github_seen`: one row per pull request a
//! `github_pr.v1` watch has already released (or seeded as its baseline),
//! so "the same PR never fires twice" is a set membership test and never a
//! digest of response bytes (an unrelated comment on an already-released PR
//! cannot re-release it). Metadata only — a number and a timestamp, never
//! watched content.
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
pub const MONITORS_SCHEMA_VERSION: i64 = 3;

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
        CREATE INDEX IF NOT EXISTS bot_monitor_checks_monitor_id ON bot_monitor_checks(monitor_id);
        CREATE TABLE IF NOT EXISTS bot_monitor_github_seen (
            monitor_id TEXT NOT NULL,
            pull_number INTEGER NOT NULL,
            seen_at_ms REAL NOT NULL,
            PRIMARY KEY (monitor_id, pull_number)
        );",
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

/// Proposed aggregate-startup shape for the migration owner's handover:
/// UNADOPTED for production — never call this (or [`migrate`]) on
/// production data before the handover. Tests exercise it on controlled
/// databases only.
pub fn apply_pending_steps_in_tx(tx: &Transaction) -> Result<()> {
    check_schema_not_ahead(tx)?;
    let existing: Option<i64> = tx
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![MONITORS_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    match existing {
        None => {
            create_tables(tx)?;
            tx.execute(
                "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)",
                params![MONITORS_SCHEMA_COMPONENT, MONITORS_SCHEMA_VERSION],
            )?;
        }
        Some(found) if found < MONITORS_SCHEMA_VERSION => {
            // v1 -> v2 is additive only: the new rule kinds live inside the
            // existing `payload_json` column and add no table or column.
            // `create_tables` stays idempotent so any additive index a
            // future step adds is created here before the bump is recorded;
            // rows are never rewritten, so already-approved monitors stay
            // approved. `check_schema_not_ahead` above still refuses a
            // newer-than-this-build version loudly.
            create_tables(tx)?;
            tx.execute(
                "UPDATE schema_versions SET version = ?2 WHERE component = ?1",
                params![MONITORS_SCHEMA_COMPONENT, MONITORS_SCHEMA_VERSION],
            )?;
        }
        Some(_) => {}
    }
    Ok(())
}

/// Standalone migration entry, same handover status as
/// [`apply_pending_steps_in_tx`]: UNADOPTED for production data.
/// Tests call this on controlled temporary/in-memory databases only.
pub fn migrate(conn: &Connection) -> Result<()> {
    check_schema_not_ahead(conn)?;
    let existing: Option<i64> = conn
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![MONITORS_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    if existing.is_some_and(|found| found >= MONITORS_SCHEMA_VERSION) {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    create_tables(&tx)?;
    tx.execute(
        "INSERT OR REPLACE INTO schema_versions(component, version) VALUES (?1, ?2)",
        params![MONITORS_SCHEMA_COMPONENT, MONITORS_SCHEMA_VERSION],
    )?;
    tx.commit()?;
    Ok(())
}

fn row_to_record(json: String) -> Result<MonitorRecord> {
    Ok(serde_json::from_str(&json)?)
}

fn scope_of(record: &MonitorRecord) -> (String, String, Option<String>) {
    // Match on the enum: scope is common to every kind, and calling a
    // file-only accessor here would silently mis-scope the new kinds.
    let (host_id, project_id) = record.rule.scope();
    (
        host_id.to_string(),
        project_id.to_string(),
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

/// Every monitor owned by one bot, in row order. The bot surface (list,
/// approve) is bot-scoped; per-project listings stay the scoped read path
/// for everything else.
pub fn list_monitors_for_bot(conn: &Connection, bot_id: &str) -> Result<Vec<MonitorRecord>> {
    let mut stmt =
        conn.prepare("SELECT payload_json FROM bot_monitors WHERE bot_id = ?1 ORDER BY rowid")?;
    let rows = stmt
        .query_map(params![bot_id], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter().map(row_to_record).collect()
}

/// Every monitor in the store, in row order. The delegation producer
/// tick (and only it) uses this: per-project listings stay the scoped
/// read path for everything else.
pub fn list_all_monitors(conn: &Connection) -> Result<Vec<MonitorRecord>> {
    let mut stmt = conn.prepare("SELECT payload_json FROM bot_monitors ORDER BY rowid")?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    rows.into_iter().map(row_to_record).collect()
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

/// Same-transaction cursor advance + delivery-enqueue shape (C10/C05
/// integration proposal — PROPOSED and UNADOPTED until the reviewed C05
/// API pin lands and the migration owner hands over).
///
/// The caller supplies `enqueue` (its own C05 `enqueue_in_tx` closure),
/// so this module never imports C05 and never owns an outbox: the intent
/// is handed to the caller, never stored here. The monitor CAS, the
/// check-history row, and the caller enqueue share the caller's
/// transaction; any error rolls everything back on transaction drop:
/// neither a lost notification nor a falsely advanced cursor. Network
/// work stays outside the transaction — `enqueue` must only write rows.
#[derive(Debug)]
pub enum CommitTxError {
    Storage(StorageError),
    /// The caller's enqueue closure refused; the caller must roll back
    /// (cursor and history unchanged).
    Enqueue(String),
}

impl From<StorageError> for CommitTxError {
    fn from(value: StorageError) -> Self {
        Self::Storage(value)
    }
}

impl From<rusqlite::Error> for CommitTxError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Storage(StorageError::Sqlite(value))
    }
}

impl From<serde_json::Error> for CommitTxError {
    fn from(value: serde_json::Error) -> Self {
        Self::Storage(StorageError::Json(value))
    }
}

impl std::fmt::Display for CommitTxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Storage(e) => write!(f, "{e}"),
            Self::Enqueue(message) => write!(f, "delivery enqueue refused: {message}"),
        }
    }
}

impl std::error::Error for CommitTxError {}

pub fn commit_advance_in_tx(
    tx: &Transaction,
    record: &MonitorRecord,
    expected_rev: i64,
    check: &StoredCheck,
    enqueue: impl FnOnce(&Transaction) -> std::result::Result<(), String>,
) -> std::result::Result<(), CommitTxError> {
    record.validate().map_err(StorageError::Validation)?;
    let payload = serde_json::to_string(record)?;
    let (host_id, project_id, bot_id) = scope_of(record);
    let affected = tx.execute(
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
        let still_exists: Option<i64> = tx
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
        }
        .into());
    }
    let check_payload = serde_json::to_string(check)?;
    tx.execute(
        "INSERT INTO bot_monitor_checks (id, monitor_id, started_at, payload_json)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            check.id,
            check.monitor_id,
            check.started_at_ms,
            check_payload
        ],
    )?;
    enqueue(tx).map_err(CommitTxError::Enqueue)?;
    Ok(())
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

    fn check(id: &str, at: f64) -> StoredCheck {
        StoredCheck {
            id: id.into(),
            monitor_id: "mon-1".into(),
            monitor_version: 1,
            started_at_ms: at,
            result: MonitorCheckResult::error("mon-1", 1, MonitorErrorKind::NotFound, "gone", at),
            delivery: DeliveryState::Uncertain,
        }
    }

    #[test]
    fn commit_advance_applies_cursor_check_and_enqueue_atomically() {
        let conn = memory_db();
        let rec = record("mon-1");
        create_monitor(&conn, &rec).unwrap();
        let (_, rev) = get_monitor(&conn, "mon-1").unwrap().unwrap();
        let mut advanced = rec.clone();
        advanced.cursor = Some("v1:".to_string() + &"bb".repeat(32));
        advanced.updated_at_ms = 2.0;
        let tx = conn.unchecked_transaction().unwrap();
        commit_advance_in_tx(&tx, &advanced, rev, &check("chk-1", 2.0), |_| Ok(())).unwrap();
        tx.commit().unwrap();
        let (reloaded, _) = get_monitor(&conn, "mon-1").unwrap().unwrap();
        assert_eq!(reloaded.cursor, advanced.cursor);
        assert_eq!(list_checks_for_monitor(&conn, "mon-1").unwrap().len(), 1);
    }

    #[test]
    fn commit_advance_rolls_back_cursor_and_history_when_enqueue_fails() {
        let conn = memory_db();
        let rec = record("mon-1");
        create_monitor(&conn, &rec).unwrap();
        let (_, rev) = get_monitor(&conn, "mon-1").unwrap().unwrap();
        let mut advanced = rec.clone();
        advanced.cursor = Some("v1:".to_string() + &"bb".repeat(32));
        advanced.updated_at_ms = 2.0;
        {
            let tx = conn.unchecked_transaction().unwrap();
            let outcome = commit_advance_in_tx(&tx, &advanced, rev, &check("chk-1", 2.0), |_| {
                Err("delivery outbox unavailable".to_string())
            });
            assert!(matches!(outcome, Err(CommitTxError::Enqueue(_))));
            // Drop without commit: real SQLite rollback of the CAS and
            // the history row alike — neither a lost notification nor a
            // falsely advanced cursor.
        }
        let (reloaded, _) = get_monitor(&conn, "mon-1").unwrap().unwrap();
        assert_eq!(reloaded.cursor, None);
        assert!(list_checks_for_monitor(&conn, "mon-1").unwrap().is_empty());
    }

    #[test]
    fn commit_advance_refuses_a_stale_rev_without_writing() {
        let conn = memory_db();
        let rec = record("mon-1");
        create_monitor(&conn, &rec).unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        let outcome = commit_advance_in_tx(&tx, &rec, 41, &check("chk-1", 2.0), |_| Ok(()));
        assert!(matches!(
            outcome,
            Err(CommitTxError::Storage(StorageError::StaleUpdate))
        ));
    }

    fn script_record(id: &str) -> MonitorRecord {
        let rule = MonitorRule::ScriptCommand(super::super::rule::ScriptRule {
            host_id: "h".to_string(),
            project_id: "p".to_string(),
            script_path: "scripts/watch.sh".to_string(),
            script_hash: "ab".repeat(32),
            interpreter: super::super::rule::ScriptInterpreter::GhApi,
            argv: vec!["repos/clioo/drogon/pulls".to_string()],
            timeout_ms: 30_000,
            max_output_bytes: 65_536,
            secret_refs: vec!["GITHUB_TOKEN_REF".to_string()],
        });
        let hash = rule.approval_hash();
        new_monitor(
            id.into(),
            Some("bot-1".into()),
            rule,
            MonitorTrigger::Manual,
            hash,
            1.0,
        )
        .unwrap()
    }

    fn http_record(id: &str) -> MonitorRecord {
        let rule = MonitorRule::HttpPoll(super::super::rule::HttpPollRule {
            host_id: "h".to_string(),
            project_id: "p".to_string(),
            url_hash: "cd".repeat(32),
            timeout_ms: 30_000,
            max_body_bytes: 65_536,
            cursor_spec: super::super::rule::HttpCursorSpec::BodyDigest,
            secret_refs: vec!["GRANOLA_TOKEN".to_string()],
        });
        let hash = rule.approval_hash();
        new_monitor(
            id.into(),
            Some("bot-1".into()),
            rule,
            MonitorTrigger::Manual,
            hash,
            1.0,
        )
        .unwrap()
    }

    #[test]
    fn mixed_kind_table_lists_and_scopes_through_the_enum() {
        let conn = memory_db();
        for rec in [
            record("mon-file"),
            script_record("mon-script"),
            http_record("mon-http"),
        ] {
            create_monitor(&conn, &rec).unwrap();
        }
        let listed = list_all_monitors(&conn).unwrap();
        assert_eq!(listed.len(), 3);
        let kinds: Vec<&str> = listed.iter().map(|r| r.rule.kind_str()).collect();
        assert!(kinds.contains(&"local_file_digest.v1"));
        assert!(kinds.contains(&"script_command.v1"));
        assert!(kinds.contains(&"http_poll.v1"));
        // scope_of must match the enum: every kind resolves (h, p).
        let scoped = list_monitors_for_project(&conn, "h", "p").unwrap();
        assert_eq!(scoped.len(), 3);
    }

    #[test]
    fn legacy_local_file_row_revalidates_and_stays_approved() {
        // A row written by the v1 build: no v2 fields, old approval hash.
        let conn = memory_db();
        let legacy_json = concat!(
            r#"{"id":"mon-legacy","botId":"bot-1","version":1,"rule":"#,
            r#"{"kind":"local_file_digest.v1","hostId":"h","projectId":"p","#,
            r#""resource":"notes/a.md","maxBytes":1024},"interpreter":null,"argv":[],"#,
            r#""secretRefs":[],"trigger":{"kind":"manual"},"cursor":null,"enabled":true,"#,
            r#""approvedRuleHash":""#,
            "9b4ddd41a94811f6ba2b5a2d29398b2a9f5f181c93ea4655266f25c352209b71",
            r#"","createdAtMs":1.0,"updatedAtMs":1.0,"consecutiveErrors":0,"#,
            r#""nextEligibleAtMs":null,"lastEventId":null,"lastSuccessAtMs":null,"lastError":null}"#
        );
        conn.execute(
            "INSERT INTO bot_monitors (id, host_id, project_id, bot_id, updated_at, rev, payload_json)
             VALUES ('mon-legacy', 'h', 'p', 'bot-1', 1.0, 0, ?1)",
            params![legacy_json],
        )
        .unwrap();
        let (loaded, _) = get_monitor(&conn, "mon-legacy").unwrap().unwrap();
        loaded.validate().expect("legacy row re-validates");
        assert!(
            loaded.is_approved(),
            "already-approved legacy row stays approved"
        );
        assert_eq!(loaded.rule.approval_hash(), loaded.approved_rule_hash);
    }

    #[test]
    fn schema_bump_records_v3_and_refuses_a_newer_build() {
        // A v1 data dir migrates forward to v3 without touching rows.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_versions (component TEXT PRIMARY KEY, version INTEGER NOT NULL);
             INSERT INTO schema_versions(component, version) VALUES ('bot_monitors', 1);",
        )
        .unwrap();
        migrate(&conn).unwrap();
        let version: i64 = conn
            .query_row(
                "SELECT version FROM schema_versions WHERE component = 'bot_monitors'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(version, MONITORS_SCHEMA_VERSION);
        // A version this build cannot read is refused loudly, never
        // misinterpreted.
        let future = Connection::open_in_memory().unwrap();
        future
            .execute_batch(
                "CREATE TABLE schema_versions (component TEXT PRIMARY KEY, version INTEGER NOT NULL);
                 INSERT INTO schema_versions(component, version) VALUES ('bot_monitors', 99);",
            )
            .unwrap();
        let error = migrate(&future).unwrap_err();
        assert!(error.to_string().contains("is newer than"), "{error}");
    }
}
