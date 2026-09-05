//! Single host-owned SQLite state store. One file under the data directory,
//! WAL journal, short busy timeout — the same configuration precedent as the
//! prior implementation's orchestration DB (see `inventory-core.md` §1.8).
//! `rusqlite` is used with the `bundled` feature so the service does not
//! depend on a system SQLite.

use std::path::Path;

use rusqlite::Connection;

pub const DB_FILE_NAME: &str = "drogon.sqlite3";

pub fn open(data_dir: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(data_dir.join(DB_FILE_NAME))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.busy_timeout(std::time::Duration::from_millis(5_000))?;
    create_tables(&conn)?;
    Ok(conn)
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

fn create_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
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

/// Runs once per `Engine::open`. Any session or request left `pending`/`live`
/// by a prior process instance has no retained handle in *this* process, so
/// per `protocol-v1.md` it becomes `unverifiable` rather than being silently
/// respawned or trusted. This never touches a session this process itself
/// spawned during the current run — it only fires once, at open time, before
/// any spawn happens.
pub fn recover_from_prior_instance(conn: &Connection) -> rusqlite::Result<()> {
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
