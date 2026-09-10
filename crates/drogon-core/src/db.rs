//! Single host-owned SQLite state store. One file under the data directory,
//! WAL journal, short busy timeout — the same configuration precedent as the
//! prior implementation's orchestration DB (see `inventory-core.md` §1.8).
//! `rusqlite` is used with the `bundled` feature so the service does not
//! depend on a system SQLite.

use std::path::Path;
use std::time::{Duration, Instant};

use rusqlite::{Connection, ErrorCode, OpenFlags, OptionalExtension, Transaction};

use crate::automations::storage as automations_storage;
use crate::bots::storage as bots_storage;
use crate::coordination_access;
use crate::mentu::storage as mentu_storage;

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
            created_at TEXT NOT NULL,
            harness_id TEXT,
            needs_input_at TEXT,
            parent_session_id TEXT,
            turn_fact TEXT,
            turn_fact_at TEXT
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

/// How many pre-migration backups to retain under `<data-dir>/backups`.
pub const PRE_MIGRATION_BACKUP_RETENTION: usize = 3;

/// Every per-component `schema_versions` entry this build knows, with its
/// current supported version. Keep in sync with the constants in each
/// component module; `upgrade_safety.rs` cross-checks the pairings against
/// the modules' own recorded migrations so drift fails a test.
const VERSIONED_COMPONENTS: &[(&str, i64)] = &[
    (
        automations_storage::AUTOMATIONS_SCHEMA_COMPONENT,
        automations_storage::AUTOMATIONS_SCHEMA_VERSION,
    ),
    (
        bots_storage::BOTS_SCHEMA_COMPONENT,
        bots_storage::BOTS_SCHEMA_VERSION,
    ),
    (
        mentu_storage::MENTU_SCHEMA_COMPONENT,
        mentu_storage::MENTU_SCHEMA_VERSION,
    ),
    (
        crate::project::PROJECTS_SCHEMA_COMPONENT,
        crate::project::PROJECTS_SCHEMA_VERSION,
    ),
    ("coordination_access", 1),
    ("orchestration_mail", 1),
    ("orchestration_attempts", 1),
    (
        crate::coordination_worker_retain::SCHEMA_COMPONENT,
        crate::coordination_worker_retain::SCHEMA_VERSION,
    ),
];

/// One recorded component version a forward migration would advance.
#[derive(Debug, PartialEq, Eq, Clone)]
pub(crate) struct PendingMigration {
    pub component: String,
    pub recorded: i64,
    pub target: i64,
}

/// Reads every recorded per-component version and reports those older than
/// this build's current version. Components with no recorded row yet are
/// fresh installs (created directly at current), never pending. The main
/// schema (sessions/requests/workspaces) has no version row of its own; its
/// additive column migrations are detected structurally instead.
fn pending_forward_migrations(conn: &Connection) -> rusqlite::Result<Vec<PendingMigration>> {
    let has_schema_versions: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_versions'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|count| count > 0)?;
    let mut pending = Vec::new();
    if has_schema_versions {
        for (component, current) in VERSIONED_COMPONENTS {
            let recorded: Option<i64> = conn
                .query_row(
                    "SELECT version FROM schema_versions WHERE component = ?1",
                    [component],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(recorded) = recorded
                && recorded < *current
            {
                pending.push(PendingMigration {
                    component: (*component).to_string(),
                    recorded,
                    target: *current,
                });
            }
        }
    }
    if table_columns(conn, "orchestration_domain_meta")?.is_some() {
        let recorded: Option<i64> = conn.query_row(
            "SELECT MAX(version) FROM orchestration_domain_meta",
            [],
            |row| row.get(0),
        )?;
        let target = drogon_orchestration::schema::SCHEMA_VERSION;
        if let Some(recorded) = recorded
            && recorded < target
        {
            pending.push(PendingMigration {
                component: "orchestration_domain".to_string(),
                recorded,
                target,
            });
        }
    }
    // Main-schema additive columns: an older data dir's `sessions` table
    // lacks them; a fresh or current one already has all three.
    if let Ok(Some((_, cols))) = table_columns(conn, "sessions") {
        let has = |name: &str| cols.iter().any(|c| c == name);
        if !(has("harness_id")
            && has("needs_input_at")
            && has("parent_session_id")
            && has("turn_fact")
            && has("turn_fact_at"))
        {
            pending.push(PendingMigration {
                component: "sessions (main schema columns)".to_string(),
                recorded: 1,
                target: 1,
            });
        }
    }
    Ok(pending)
}

fn table_columns(
    conn: &Connection,
    table: &str,
) -> rusqlite::Result<Option<(String, Vec<String>)>> {
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1",
            [table],
            |r| r.get::<_, i64>(0),
        )
        .map(|count| count > 0)?;
    if !exists {
        return Ok(None);
    }
    let cols = conn
        .prepare(&format!("PRAGMA table_info({table})"))?
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(Some((table.to_string(), cols)))
}

/// The first time a newer build opens an older data dir — i.e. whenever a
/// forward migration is about to run — snapshot the database next to it
/// (`<data-dir>/backups/pre-migration-<utc>/drogon.sqlite3` plus a
/// `manifest.json`), retaining the newest [`PRE_MIGRATION_BACKUP_RETENTION`].
/// The snapshot uses `VACUUM INTO`, which yields a consistent single-file
/// copy even with a live WAL and, crucially, is legal *outside* a
/// transaction — which is why this runs before the aggregate startup
/// transaction opens. Best-effort by design: every migration itself is
/// additive and rollback-safe, so a failed backup (disk full, read-only
/// dir) degrades to a loud stderr note rather than refusing startup.
fn create_pre_migration_backup_if_needed(conn: &Connection) {
    let pending = match pending_forward_migrations(conn) {
        Ok(pending) if !pending.is_empty() => pending,
        Ok(_) => return,
        Err(e) => {
            eprintln!("drogond: pre-migration backup skipped (cannot read schema_versions): {e}");
            return;
        }
    };
    // `conn.path()` is the database *file*; the backup lives beside it, in
    // the data dir itself.
    let data_dir = conn
        .path()
        .and_then(|p| std::fs::canonicalize(p).ok())
        .and_then(|db_file| db_file.parent().map(|p| p.to_path_buf()));
    let Some(data_dir) = data_dir else {
        eprintln!("drogond: pre-migration backup skipped (cannot resolve database path)");
        return;
    };
    if let Err(e) = create_pre_migration_backup(&data_dir, conn, &pending) {
        eprintln!(
            "drogond: pre-migration backup FAILED for {} (continuing; migrations are rollback-safe): {e}",
            data_dir.display()
        );
    } else if let Ok(backups) = std::fs::read_dir(data_dir.join("backups")) {
        let newest = backups.filter_map(|e| e.ok()).map(|e| e.path()).max();
        if let Some(newest) = newest {
            eprintln!(
                "drogond: pre-migration backup created at {} before migrating this data dir forward",
                newest.display()
            );
        }
    }
}

/// Builds one backup directory. Exposed `pub(crate)` for the upgrade-safety
/// tests; the retention policy lives in [`prune_pre_migration_backups`].
pub(crate) fn create_pre_migration_backup(
    data_dir: &Path,
    conn: &Connection,
    pending: &[PendingMigration],
) -> std::io::Result<std::path::PathBuf> {
    let backups_dir = data_dir.join("backups");
    std::fs::create_dir_all(&backups_dir)?;
    let dir = backups_dir.join(format!("pre-migration-{}", crate::now_unix_ms()));
    std::fs::create_dir(&dir)?;
    // VACUUM INTO copies a consistent snapshot of the whole database
    // (WAL included) into a fresh file; it refuses to overwrite, which also
    // guards against a colliding directory name.
    let target = dir.join(DB_FILE_NAME);
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy().as_ref()])
        .map_err(|e| {
            let _ = std::fs::remove_dir_all(&dir);
            std::io::Error::other(format!("VACUUM INTO snapshot failed: {e}"))
        })?;
    let pending_json: Vec<serde_json::Value> = pending
        .iter()
        .map(|p| {
            serde_json::json!({
                "component": p.component,
                "recorded_version": p.recorded,
                "migrating_to": p.target,
            })
        })
        .collect();
    let manifest = serde_json::json!({
        "kind": "drogon-pre-migration-backup",
        "created_at": crate::now_rfc3339(),
        "data_dir": data_dir.to_string_lossy(),
        "database_file": DB_FILE_NAME,
        "writer_build_version": env!("CARGO_PKG_VERSION"),
        "reason": "a newer Drogon build migrated this data dir forward",
        "pending_migrations": pending_json,
    });
    std::fs::write(
        dir.join("manifest.json"),
        serde_json::to_string_pretty(&manifest)
            .map_err(|e| std::io::Error::other(e.to_string()))?,
    )?;
    prune_pre_migration_backups(&backups_dir);
    Ok(dir)
}

/// Keeps only the newest [`PRE_MIGRATION_BACKUP_RETENTION`] backup
/// directories. Directory names embed unix ms of constant width (13 digits
/// until the year 2286), so a numeric-suffix sort is the time sort; names
/// without a numeric suffix sort last and go first. Prune failures are
/// swallowed: a stale extra backup never justifies failing the startup
/// path.
fn prune_pre_migration_backups(backups_dir: &Path) {
    let mut backups: Vec<(u64, std::path::PathBuf)> = match std::fs::read_dir(backups_dir) {
        Ok(entries) => entries
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("pre-migration-"))
            })
            .map(|p| {
                let stamp = p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .and_then(|n| n.strip_prefix("pre-migration-"))
                    .and_then(|n| n.parse::<u64>().ok())
                    .unwrap_or(0);
                (stamp, p)
            })
            .collect(),
        Err(_) => return,
    };
    backups.sort_by_key(|(stamp, _)| *stamp);
    while backups.len() > PRE_MIGRATION_BACKUP_RETENTION {
        let Some((_, oldest)) = backups.first() else {
            break;
        };
        let _ = std::fs::remove_dir_all(oldest);
        backups.remove(0);
    }
}

/// Main schema, capability migrations, recovery and host identity commit together.
pub fn migrate_and_recover(conn: &Connection) -> Result<String, StartupError> {
    // Before anything migrates: if this build is about to move an older
    // data dir forward, snapshot it first (best-effort; see the fn doc).
    create_pre_migration_backup_if_needed(conn);
    let tx = automations_storage::begin_immediate(conn).map_err(StartupError::Automations)?;
    create_tables(&tx)?;
    automations_storage::apply_pending_steps_in_tx(&tx).map_err(StartupError::Automations)?;
    bots_storage::apply_pending_steps_in_tx(&tx).map_err(StartupError::Bots)?;
    mentu_storage::apply_pending_steps_in_tx(&tx)?;
    crate::project::apply_pending_steps_in_tx(&tx)?;
    coordination_access::apply_pending_steps_in_tx(&tx)?;
    crate::coordination_worker_retain::apply_pending_steps_in_tx(&tx)?;
    drogon_orchestration::schema::migrate_in_tx(&tx).map_err(StartupError::Orchestration)?;
    crate::coordination_attempts::migrate(&tx).map_err(StartupError::Orchestration)?;
    crate::coordination_mail::migrate_in_tx(&tx).map_err(StartupError::Orchestration)?;
    migrate_sessions_harness_id(&tx)?;
    migrate_sessions_needs_input(&tx)?;
    migrate_sessions_parent_session_id(&tx)?;
    migrate_sessions_turn_fact(&tx)?;
    recover_from_prior_instance(&tx)?;
    let host_id = read_or_create_host_id(&tx)?;
    tx.commit()?;
    Ok(host_id)
}

/// Additive migration for the sessions launch-identity record: the
/// `harness_id` column carries which harness (if any) launched the session
/// so a terminal Restart can re-launch the same harness. Plain `session.start`
/// sessions keep `NULL`. Idempotent: fresh databases already created the
/// column in [`create_tables`].
fn migrate_sessions_harness_id(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let has_column: bool = tx
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'harness_id'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|count| count > 0)?;
    if !has_column {
        tx.execute_batch("ALTER TABLE sessions ADD COLUMN harness_id TEXT;")?;
    }
    Ok(())
}

/// Additive migration for the sticky wait signal: `needs_input_at` keeps
/// the wall-clock stamp of the most recent uncleared `session.hook_event`
/// wait signal, so a daemon restart reports a still-waiting session as
/// `needs_input` (with its original stamp) instead of `unknown`. The
/// verdict still flips to `unverifiable` in
/// [`recover_from_prior_instance`] — only the wait signal is durable, never
/// the activity clock. Idempotent: fresh databases already created the
/// column in [`create_tables`].
fn migrate_sessions_needs_input(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let has_column: bool = tx
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'needs_input_at'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|count| count > 0)?;
    if !has_column {
        tx.execute_batch("ALTER TABLE sessions ADD COLUMN needs_input_at TEXT;")?;
    }
    Ok(())
}

/// Additive migration for subagent nesting (issue #359): `parent_session_id`
/// records which session's PTY spawned this one (a `drogon-cli` invoked
/// inside a terminal reports its inherited `DROGON_SESSION_ID`), so the
/// sidebar can render the fork's nested child-agent box. `NULL` for
/// UI-spawned and other parentless sessions. Idempotent: fresh databases
/// already created the column in [`create_tables`].
fn migrate_sessions_parent_session_id(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    let has_column: bool = tx
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'parent_session_id'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|count| count > 0)?;
    if !has_column {
        tx.execute_batch("ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;")?;
    }
    Ok(())
}

/// Additive migration for the durable hook turn fact: `turn_fact`
/// (`active`/`ended`, `NULL` = no known turn) and its `turn_fact_at` stamp
/// mirror the in-memory lifecycle so a daemon restart reports a turn
/// reported by hooks as still-`working` (with its original stamp) instead
/// of hiding it as `unknown` — loss of contact never proves exit, and
/// nobody observed the turn concluding. Idempotent: fresh databases
/// already created the columns in [`create_tables`].
fn migrate_sessions_turn_fact(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    for column in ["turn_fact", "turn_fact_at"] {
        let has_column: bool = tx
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = '{column}'"
                ),
                [],
                |r| r.get::<_, i64>(0),
            )
            .map(|count| count > 0)?;
        if !has_column {
            tx.execute_batch(&format!(
                "ALTER TABLE sessions ADD COLUMN {column} TEXT;"
            ))?;
        }
    }
    Ok(())
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
