//! Live PTY sessions. Ownership model per `protocol-v1.md`: "Session
//! ownership is established from retained process handles, not a PID read
//! from persisted data." `SessionHandle` below *is* that retained handle —
//! it lives only in this process's memory (`Engine.sessions`), is never
//! reconstructed from SQLite, and disappears (goes `unverifiable`) the
//! instant this process does, by construction rather than by a PID probe.
//! See `inventory-core.md` §1.3 for why external PID-identity probing (the
//! prior implementation's technique) is a different, narrower problem this
//! module deliberately does not reuse.

use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use drogon_protocol::RpcError;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use rusqlite::Connection;
use serde_json::{Value, json};

use crate::error;
use crate::ring::RingBuffer;

/// Non-blocking poll budget for `stop`: how long we wait for the kill to be
/// observed before answering `unverifiable` instead of `exited`. Chosen to
/// be comfortably longer than a normal SIGTERM/SIGKILL reap on a healthy
/// host; not derived from any measurement in the prior implementation.
const STOP_VERIFY_TIMEOUT: Duration = Duration::from_millis(2_000);
const STOP_POLL_INTERVAL: Duration = Duration::from_millis(20);

pub(crate) struct SessionHandle {
    pub(crate) session_id: String,
    pub(crate) incarnation: String,
    pub(crate) workspace_id: String,
    pub(crate) host_id: String,
    pub(crate) command: String,
    pub(crate) args: Vec<String>,
    pub(crate) created_at: String,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    ring: Mutex<RingBuffer>,
    size: Mutex<(u16, u16)>,
    /// `None` until reaped exactly once; both the reader thread (on PTY EOF)
    /// and an explicit `stop` race to reap, guarded by this same mutex so
    /// the underlying `wait()`/`try_wait()` is only ever called by whichever
    /// gets here first.
    exit_code: Mutex<Option<i64>>,
    db: Arc<Mutex<Connection>>,
}

fn now_rfc3339() -> String {
    crate::now_rfc3339()
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn(
    db: Arc<Mutex<Connection>>,
    host_id: String,
    workspace_id: String,
    cwd: &str,
    command: String,
    args: Vec<String>,
    cols: u16,
    rows: u16,
) -> Result<(String, Arc<SessionHandle>, Value), RpcError> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let incarnation = uuid::Uuid::new_v4().to_string();
    let created_at = now_rfc3339();

    // Why insert before touching the PTY at all: protocol-v1.md requires
    // "Persist pending spawn admission before spawning." It also closes a
    // race where a fast-exiting child's reader thread would try to mark the
    // row `exited` before the row exists — an `UPDATE` that matches zero
    // rows would silently vanish and a later `INSERT ... verdict='live'`
    // would then permanently overwrite the true exited state.
    {
        let conn = db.lock().unwrap();
        conn.execute(
            "INSERT INTO sessions (id, workspace_id, host_id, incarnation, command, args_json, cols, rows, verdict, exit_code, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', NULL, ?9)",
            rusqlite::params![
                session_id,
                workspace_id,
                host_id,
                incarnation,
                command,
                serde_json::to_string(&args).unwrap_or_default(),
                cols,
                rows,
                created_at,
            ],
        )
        .map_err(error::from_sqlite)?;
    }

    match spawn_pty(cwd, &command, &args, cols, rows) {
        Ok((master, writer, reader, child)) => {
            let handle = Arc::new(SessionHandle {
                session_id: session_id.clone(),
                incarnation: incarnation.clone(),
                workspace_id: workspace_id.clone(),
                host_id: host_id.clone(),
                command: command.clone(),
                args: args.clone(),
                created_at: created_at.clone(),
                master: Mutex::new(master),
                writer: Mutex::new(writer),
                child: Mutex::new(child),
                ring: Mutex::new(RingBuffer::new()),
                size: Mutex::new((cols, rows)),
                exit_code: Mutex::new(None),
                db: db.clone(),
            });
            spawn_reader_thread(handle.clone(), reader);
            // Conditional: only flips a still-`pending` row to `live`. If the
            // reader thread already reaped a near-instant exit and wrote
            // `exited`, this is a harmless no-op — the terminal state wins.
            {
                let conn = db.lock().unwrap();
                let _ = conn.execute(
                    "UPDATE sessions SET verdict = 'live' WHERE id = ?1 AND verdict = 'pending'",
                    [&session_id],
                );
            }
            finish_spawn(&handle, &session_id)
        }
        Err(e) => {
            // Exact cleanup: the admitted row must not linger as `pending`
            // (which crash-recovery would otherwise later mark
            // `unverifiable` for a session that in fact never ran).
            let conn = db.lock().unwrap();
            let _ = conn.execute(
                "UPDATE sessions SET verdict = 'exited', exit_code = NULL WHERE id = ?1 AND verdict = 'pending'",
                [&session_id],
            );
            Err(e)
        }
    }
}

type SpawnedPty = (
    Box<dyn MasterPty + Send>,
    Box<dyn Write + Send>,
    Box<dyn Read + Send>,
    Box<dyn Child + Send + Sync>,
);

fn spawn_pty(
    cwd: &str,
    command: &str,
    args: &[String],
    cols: u16,
    rows: u16,
) -> Result<SpawnedPty, RpcError> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| error::io_error(format!("openpty failed: {e}")))?;

    // Why acquired before spawning: both come from the master side and do
    // not need a child to exist first. Getting them before `spawn_command`
    // means a failure here never has to clean up an already-spawned,
    // unreachable child — there is nothing to spawn command's fault clean up
    // yet.
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| error::io_error(format!("clone pty reader failed: {e}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| error::io_error(format!("take pty writer failed: {e}")))?;

    let mut cmd = CommandBuilder::new(command);
    for (key, _) in std::env::vars_os() {
        if key
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("ORCA_")
        {
            cmd.env_remove(key);
        }
    }
    cmd.args(args);
    cmd.cwd(cwd);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| error::io_error(format!("spawn failed: {e}")))?;
    // Why: the slave fd must not stay open in this process past spawn, or
    // the child's controlling terminal never sees EOF/hangup correctly on
    // some platforms when the parent still holds it open.
    drop(pair.slave);

    Ok((pair.master, writer, reader, child))
}

fn finish_spawn(
    handle: &Arc<SessionHandle>,
    session_id: &str,
) -> Result<(String, Arc<SessionHandle>, Value), RpcError> {
    let session_json = to_json(handle, "live", None);
    Ok((session_id.to_string(), handle.clone(), session_json))
}

/// How often the background poller (below) checks for exit after PTY EOF.
/// Never held across a lock — see `poll_until_exit`.
const EOF_POLL_INTERVAL: Duration = Duration::from_millis(30);

fn spawn_reader_thread(handle: Arc<SessionHandle>, mut reader: Box<dyn Read + Send>) {
    let observed_child = handle.clone();
    std::thread::spawn(move || poll_until_exit(&observed_child));
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => handle.ring.lock().unwrap().push(&buf[..n]),
                Err(_) => break,
            }
        }
        // EOF and child exit are independent; descendants can keep the slave open.
    });
}

/// Reap without blocking. Only ever takes each lock for the instant needed
/// to check/call `try_wait`, never across a sleep — every caller (`stop`'s
/// poll loop, this module's own background poller, `write`'s liveness
/// check) can interleave freely with each other.
fn try_reap(handle: &SessionHandle) -> Option<i64> {
    let mut exit = handle.exit_code.lock().unwrap();
    if let Some(code) = *exit {
        return Some(code);
    }
    let mut child = handle.child.lock().unwrap();
    match child.try_wait() {
        Ok(Some(status)) => {
            let code = status.exit_code() as i64;
            *exit = Some(code);
            Some(code)
        }
        _ => None,
    }
}

/// Polls (never blocks, never holds a lock across the sleep) until the
/// child's real exit is observed, then persists it. Runs for as long as it
/// takes — a background thread waiting on its own session's eventual exit
/// costs nothing else while it waits.
fn poll_until_exit(handle: &SessionHandle) {
    loop {
        if let Some(code) = try_reap(handle) {
            persist_exit(handle, code);
            return;
        }
        std::thread::sleep(EOF_POLL_INTERVAL);
    }
}

fn persist_exit(handle: &SessionHandle, exit_code: i64) {
    let conn = handle.db.lock().unwrap();
    let _ = conn.execute(
        "UPDATE sessions SET verdict = 'exited', exit_code = ?2 WHERE id = ?1",
        rusqlite::params![handle.session_id, exit_code],
    );
}

pub(crate) fn check_incarnation(handle: &SessionHandle, incarnation: &str) -> Result<(), RpcError> {
    if handle.incarnation != incarnation {
        return Err(error::stale_incarnation());
    }
    Ok(())
}

pub(crate) fn read(
    handle: &SessionHandle,
    cursor: u64,
    limit_bytes: usize,
) -> Result<Value, RpcError> {
    let outcome = handle
        .ring
        .lock()
        .unwrap()
        .read(cursor, limit_bytes)
        .ok_or_else(|| error::invalid_argument("cursor is ahead of all data written so far"))?;
    let current_verdict_exit = current_verdict(handle);
    Ok(json!({
        "session": to_json(handle, &current_verdict_exit.0, current_verdict_exit.1),
        "dataBase64": base64_encode(&outcome.bytes),
        "startCursor": outcome.start_cursor,
        "nextCursor": outcome.next_cursor,
        "truncated": outcome.truncated,
    }))
}

pub(crate) fn write(handle: &SessionHandle, data: &[u8]) -> Result<usize, RpcError> {
    if try_reap(handle).is_some() {
        return Err(error::unverifiable(
            "session already exited; cannot accept more input",
        ));
    }
    let mut writer = handle.writer.lock().unwrap();
    writer
        .write_all(data)
        .map_err(|e| error::io_error(format!("pty write failed: {e}")))?;
    let _ = writer.flush();
    Ok(data.len())
}

/// Returns the session's truthful post-resize verdict rather than a
/// hardcoded `"live"` — a resize can race an exit, and the caller must never
/// be told a session is live when it has already been observed to exit.
pub(crate) fn resize(handle: &SessionHandle, cols: u16, rows: u16) -> Result<Value, RpcError> {
    if let Some(code) = try_reap(handle) {
        return Err(error::unverifiable(format!(
            "session already exited (code {code}); cannot resize"
        )));
    }
    handle
        .master
        .lock()
        .unwrap()
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| error::io_error(format!("pty resize failed: {e}")))?;
    *handle.size.lock().unwrap() = (cols, rows);
    let conn = handle.db.lock().unwrap();
    conn.execute(
        "UPDATE sessions SET cols = ?2, rows = ?3 WHERE id = ?1",
        rusqlite::params![handle.session_id, cols, rows],
    )
    .map_err(error::from_sqlite)?;
    drop(conn);
    let (verdict, exit_code) = current_verdict(handle);
    Ok(to_json(handle, &verdict, exit_code))
}

/// Sends the kill, then waits up to `STOP_VERIFY_TIMEOUT` for the exit to be
/// observed. Never assumes `kill()` returning `Ok` means the process is
/// gone — only an actual reaped exit status does.
pub(crate) fn stop(handle: &SessionHandle) -> Value {
    if let Some(code) = try_reap(handle) {
        return to_json(handle, "exited", Some(code));
    }
    {
        let mut child = handle.child.lock().unwrap();
        let _ = child.kill();
    }
    let deadline = Instant::now() + STOP_VERIFY_TIMEOUT;
    loop {
        if let Some(code) = try_reap(handle) {
            persist_exit(handle, code);
            return to_json(handle, "exited", Some(code));
        }
        if Instant::now() >= deadline {
            return to_json(handle, "unverifiable", None);
        }
        std::thread::sleep(STOP_POLL_INTERVAL);
    }
}

/// The verdict/exit-code pair as currently known, without forcing a reap
/// (used by `read`/`list` paths that must not block on process state).
fn current_verdict(handle: &SessionHandle) -> (String, Option<i64>) {
    match *handle.exit_code.lock().unwrap() {
        Some(code) => ("exited".to_string(), Some(code)),
        None => ("live".to_string(), None),
    }
}

pub(crate) fn to_json(handle: &SessionHandle, verdict: &str, exit_code: Option<i64>) -> Value {
    let (cols, rows) = *handle.size.lock().unwrap();
    json!({
        "id": handle.session_id,
        "workspaceId": handle.workspace_id,
        "hostId": handle.host_id,
        "incarnation": handle.incarnation,
        "command": handle.command,
        "args": handle.args,
        "cols": cols,
        "rows": rows,
        "verdict": verdict,
        "exitCode": exit_code,
        "createdAt": handle.created_at,
    })
}

pub(crate) fn base64_encode(bytes: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

pub(crate) fn base64_decode(text: &str) -> Result<Vec<u8>, RpcError> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .map_err(|_| error::invalid_argument("dataBase64 is not valid base64"))
}
