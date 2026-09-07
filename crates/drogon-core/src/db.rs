//! Single host-owned SQLite state store. One file under the data directory,
//! WAL journal, short busy timeout — the same configuration precedent as the
//! prior implementation's orchestration DB (see `inventory-core.md` §1.8).
//! `rusqlite` is used with the `bundled` feature so the service does not
//! depend on a system SQLite.

use std::path::Path;
use std::time::{Duration, Instant};

use rusqlite::{Connection, ErrorCode, OpenFlags, OptionalExtension};

use crate::automations::storage as automations_storage;
use crate::bots::storage as bots_storage;
use crate::coordination_access;

pub const DB_FILE_NAME: &str = "drogon.sqlite3";

/// The initial WAL switch can return BUSY/LOCKED without invoking SQLite's busy handler.
fn set_wal_journal_mode_with_retry(conn: &Connection) -> rusqlite::Result<()> {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match conn.pragma_update(None, "journal_mode", "WAL") {
            Ok(()) => return Ok(()),
            Err(rusqlite::Error::SqliteFailure(e, _))
                if matches!(e.code, ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked)
                    && Instant::now() < deadline =>
            {
                std::thread::sleep(Duration::from_millis(5));
            }
            Err(e) => return Err(e),
        }
    }
}

/// Schema changes belong to the rollback-safe aggregate startup transaction.
pub fn open(data_dir: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open_with_flags(
        data_dir.join(DB_FILE_NAME),
        OpenFlags::default() | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    set_wal_journal_mode_with_retry(&conn)?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.busy_timeout(std::time::Duration::from_millis(5_000))?;
    Ok(conn)
}

pub fn validate_files(data_dir: &Path) -> std::io::Result<()> {
    for name in [
        DB_FILE_NAME,
        "drogon.sqlite3-wal",
        "drogon.sqlite3-shm",
        "drogon.sqlite3-journal",
    ] {
        let metadata = match std::fs::symlink_metadata(data_dir.join(name)) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Database paths must be ordinary private files",
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if metadata.nlink() != 1 || metadata.uid() != std::fs::metadata(data_dir)?.uid() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "Database files must have one link and the data-directory owner",
                ));
            }
        }
    }
    Ok(())
}

/// Restricts the main db file and its WAL/SHM siblings to owner-only.
/// Genuine permission failures are propagated rather than swallowed; a
/// sibling simply not existing yet (WAL/SHM are created lazily) is not one.
#[cfg(unix)]
pub fn harden_permissions(data_dir: &Path) -> std::io::Result<()> {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    for name in [DB_FILE_NAME, "drogon.sqlite3-wal", "drogon.sqlite3-shm"] {
        let path = data_dir.join(name);
        let meta = match fs::metadata(&path) {
            Ok(meta) => meta,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e),
        };
        let mut perms = meta.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(&path, perms)?;
    }
    Ok(())
}

fn create_tables(tx: &Connection) -> rusqlite::Result<()> {
    tx.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            host_id TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            host_id TEXT NOT NULL,
            incarnation TEXT NOT NULL,
            command TEXT NOT NULL,
            args_json TEXT NOT NULL,
            cols INTEGER NOT NULL,
            rows INTEGER NOT NULL,
            verdict TEXT NOT NULL,
            exit_code INTEGER,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS requests (
            request_id TEXT PRIMARY KEY,
            method TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            status TEXT NOT NULL,
            result_json TEXT,
            error_json TEXT,
            created_at TEXT NOT NULL
        );
        ",
    )
}

/// The aggregate startup transaction rolls back on any component or SQL failure.
#[derive(Debug)]
pub enum StartupError {
    Automations(automations_storage::StorageError),
    Bots(bots_storage::StorageError),
    Orchestration(drogon_protocol::RpcError),
    /// Main-schema, recovery, or host-identity failure.
    Sqlite(rusqlite::Error),
}

impl std::fmt::Display for StartupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Automations(e) => write!(f, "automations: {e}"),
            Self::Bots(e) => write!(f, "bots: {e}"),
            Self::Orchestration(e) => write!(f, "orchestration: {}", e.message),
            Self::Sqlite(e) => write!(f, "sqlite error: {e}"),
        }
    }
}

impl std::error::Error for StartupError {}

impl From<rusqlite::Error> for StartupError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

/// Main schema, capability migrations, recovery and host identity commit together.
pub fn migrate_and_recover(conn: &Connection) -> Result<String, StartupError> {
    let tx = automations_storage::begin_immediate(conn).map_err(StartupError::Automations)?;
    create_tables(&tx)?;
    automations_storage::apply_pending_steps_in_tx(&tx).map_err(StartupError::Automations)?;
    bots_storage::apply_pending_steps_in_tx(&tx).map_err(StartupError::Bots)?;
    coordination_access::apply_pending_steps_in_tx(&tx)?;
    drogon_orchestration::schema::migrate_in_tx(&tx).map_err(StartupError::Orchestration)?;
    crate::coordination_attempts::migrate(&tx).map_err(StartupError::Orchestration)?;
    crate::coordination_mail::migrate_in_tx(&tx).map_err(StartupError::Orchestration)?;
    recover_from_prior_instance(&tx)?;
    let host_id = read_or_create_host_id(&tx)?;
    tx.commit()?;
    Ok(host_id)
}

/// Runs once per `Engine::open`, inside [`migrate_and_recover`]'s
/// transaction. Any session or request left `pending`/`live` by a prior
/// process instance has no retained handle in *this* process, so per
/// `protocol-v1.md` it becomes `unverifiable` rather than being silently
/// respawned or trusted. This never touches a session this process itself
/// spawned during the current run — it only fires once, at open time,
/// before any spawn happens.
fn recover_from_prior_instance(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sessions SET verdict = 'unverifiable' WHERE verdict IN ('pending', 'live')",
        [],
    )?;
    let unverifiable_error = serde_json::json!({
        "code": "unverifiable",
        "message": "Service restarted while this request was in flight; prior outcome is unknown.",
        "retryable": false
    })
    .to_string();
    conn.execute(
        "UPDATE requests SET status = 'done', error_json = ?1, result_json = NULL WHERE status = 'pending'",
        [unverifiable_error],
    )?;
    Ok(())
}

/// Reads the durable per-database host id, creating one if this is a
/// fresh database. Moved here (from `lib.rs`) so it can run inside
/// [`migrate_and_recover`]'s transaction: a fresh id created here must not
/// survive a later rollback in the same startup attempt.
fn read_or_create_host_id(conn: &Connection) -> rusqlite::Result<String> {
    let existing: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key = 'host_id'", [], |r| {
            r.get(0)
        })
        .optional()?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('host_id', ?1)",
        [&id],
    )?;
    Ok(id)
}
