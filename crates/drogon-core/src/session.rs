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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use drogon_protocol::RpcError;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use rusqlite::{Connection, TransactionBehavior};
use serde_json::{Value, json};

use crate::agent_state::{self, Activity, AgentState};
use crate::error;
use crate::ring::RingBuffer;

#[path = "session_admission.rs"]
pub(crate) mod session_admission;

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
    /// The PTY master, dropped once the child's exit has been positively
    /// observed *and* the reader thread finished draining output.
    /// Retained ring output is in-memory and survives this release.
    native: Mutex<Option<NativePty>>,
    /// The PTY writer, under its own lock — deliberately NOT the master's.
    /// A write can block for a long time on a child that never reads its
    /// input; that must never serialize master operations (`resize`) or
    /// native release behind the blocked writer. Only writes pay for a
    /// blocked write.
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    ring: Mutex<RingBuffer>,
    size: Mutex<(u16, u16)>,
    /// Child observation is independent of PTY EOF and serialized with exact stop.
    exit_code: Mutex<Option<i64>>,
    /// Set by the reader thread when the PTY read side reached EOF or an
    /// unrecoverable read error — i.e. the drain phase is over.
    reader_done: AtomicBool,
    /// Monotonic instant of the most recent PTY output chunk, paired with the
    /// wall-clock stamp captured at the same moment (an `Instant` cannot be
    /// rendered as `agentStateAt`). `None` until the first chunk arrives.
    last_activity: Mutex<Option<(Instant, String)>>,
    /// Wall-clock stamp of the most recent `session.hook_event` (`Stop` or
    /// `Notification` from the per-session Claude Code hooks file) that no
    /// later PTY output has cleared yet. `None` for sessions that never got
    /// one — other harnesses keep purely activity-based states.
    needs_input_at: Mutex<Option<String>>,
    /// Per-session Claude Code `--settings` file `harness.start` wrote for
    /// this session (a nonce name under `<data-dir>/hooks/`), removed when
    /// the session exits. `None` for sessions launched without one.
    hook_settings_file: Mutex<Option<std::path::PathBuf>>,
    db: Arc<Mutex<Connection>>,
}

impl SessionHandle {
    /// Assembles the retained handle from an already-spawned child. The
    /// caller owns reader startup and engine registration from here.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn from_spawned(
        session_id: String,
        incarnation: String,
        workspace_id: String,
        host_id: String,
        command: String,
        args: Vec<String>,
        created_at: String,
        cols: u16,
        rows: u16,
        master: Box<dyn MasterPty + Send>,
        writer: Box<dyn Write + Send>,
        child: Box<dyn Child + Send + Sync>,
        db: Arc<Mutex<Connection>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            session_id,
            incarnation,
            workspace_id,
            host_id,
            command,
            args,
            created_at,
            native: Mutex::new(Some(NativePty { master })),
            writer: Mutex::new(Some(writer)),
            child: Mutex::new(child),
            ring: Mutex::new(RingBuffer::new()),
            size: Mutex::new((cols, rows)),
            exit_code: Mutex::new(None),
            reader_done: AtomicBool::new(false),
            last_activity: Mutex::new(None),
            needs_input_at: Mutex::new(None),
            hook_settings_file: Mutex::new(None),
            db,
        })
    }

    /// Records a hook wait signal; the next PTY output chunk clears it.
    pub(crate) fn note_hook_event(&self) {
        *self.needs_input_at.lock().unwrap() = Some(crate::now_rfc3339());
    }

    /// Remembers the per-session hooks settings file so the exit paths can
    /// remove it. Called once by `harness.start` right after launch.
    pub(crate) fn set_hook_settings_file(&self, path: std::path::PathBuf) {
        *self.hook_settings_file.lock().unwrap() = Some(path);
    }

    /// Takes the remembered hooks settings file for deletion, if any.
    fn take_hook_settings_file(&self) -> Option<std::path::PathBuf> {
        self.hook_settings_file.lock().unwrap().take()
    }
}

/// Best-effort removal of a session's hooks settings file: failures only
/// mean a small orphaned JSON (its hook commands fail closed against a dead
/// session), never a session-state error.
fn remove_hook_settings_file(path: &std::path::Path) {
    let _ = std::fs::remove_file(path);
}

/// The native PTY master held open while the session can still resize.
/// Releasing this struct closes the master descriptor. The writer lives
/// separately (see `SessionHandle::writer`).
struct NativePty {
    master: Box<dyn MasterPty + Send>,
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn(
    db: Arc<Mutex<Connection>>,
    data_dir: &std::path::Path,
    host_id: String,
    workspace_id: String,
    cwd: &str,
    command: String,
    args: Vec<String>,
    cols: u16,
    rows: u16,
) -> Result<(String, Arc<SessionHandle>, Value), RpcError> {
    // Why insert before touching the PTY at all: protocol-v1.md requires
    // "Persist pending spawn admission before spawning." It also closes a
    // race where a fast-exiting child's reader thread would try to mark the
    // row `exited` before the row exists — an `UPDATE` that matches zero
    // rows would silently vanish and a later `INSERT ... verdict='live'`
    // would then permanently overwrite the true exited state.
    //
    // This is reserve (admission) + commit, then the launch effect; the
    // failure cleanup and handle ownership below match `launch_reserved`.
    let plan = {
        let conn = db.lock().unwrap();
        let tx = rusqlite::Transaction::new_unchecked(&conn, TransactionBehavior::Immediate)
            .map_err(error::from_sqlite)?;
        let plan = session_admission::reserve(
            &tx,
            &host_id,
            &workspace_id,
            cwd,
            &command,
            &args,
            cols,
            rows,
        )?;
        tx.commit().map_err(error::from_sqlite)?;
        plan
    };
    session_admission::launch_reserved(db, data_dir, plan, None)
}

type SpawnedPty = (
    Box<dyn MasterPty + Send>,
    Box<dyn Write + Send>,
    Box<dyn Read + Send>,
    Box<dyn Child + Send + Sync>,
);

#[allow(clippy::too_many_arguments)]
fn spawn_pty(
    data_dir: &std::path::Path,
    workspace_id: &str,
    session_id: &str,
    cwd: &str,
    command: &str,
    args: &[String],
    cols: u16,
    rows: u16,
    worker_env: Option<&session_admission::WorkerEnvironment>,
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
    // Session environment first: strip inherited control-plane context (a
    // harness or agent inside a session must not act on this service through
    // inherited variables), prepend the `<data-dir>/bin` shims to PATH, and
    // export the session identity. A reserved worker launch then applies
    // exactly its service-authored context on top; ordinary sessions keep
    // only the session environment.
    crate::session_env::apply_to_command(&mut cmd, data_dir, workspace_id, session_id);
    if let Some(env) = worker_env {
        env.apply_to_command(&mut cmd);
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

const CHILD_POLL_INTERVAL: Duration = Duration::from_millis(30);

fn spawn_reader_thread(handle: Arc<SessionHandle>, mut reader: Box<dyn Read + Send>) {
    let observed_child = handle.clone();
    std::thread::spawn(move || poll_until_exit(&observed_child));
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    handle.ring.lock().unwrap().push(&buf[..n]);
                    *handle.last_activity.lock().unwrap() =
                        Some((Instant::now(), crate::now_rfc3339()));
                    // Output resumes: the wait signal is spent, back to
                    // activity-based derivation.
                    *handle.needs_input_at.lock().unwrap() = None;
                }
                Err(_) => break,
            }
        }
        // EOF and child exit are independent; descendants can keep the slave open.
        handle.reader_done.store(true, Ordering::Release);
        // The reader finishing may be the last of the two facts (exit observed
        // + drain done) — try to release the native halves right away. The
        // exit observer (stop or the poller) covers the other ordering.
        try_release_native(&handle);
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
/// child's real exit is observed, then persists it and releases the native
/// PTY halves. Runs for as long as it takes — a background thread waiting on
/// its own session's eventual exit costs nothing else while it waits.
fn poll_until_exit(handle: &SessionHandle) {
    loop {
        if let Some(code) = try_reap(handle) {
            if persist_exit(handle, code).is_ok() {
                if let Some(path) = handle.take_hook_settings_file() {
                    remove_hook_settings_file(&path);
                }
                try_release_native(handle);
                return;
            }
            std::thread::sleep(Duration::from_secs(1));
        } else {
            std::thread::sleep(CHILD_POLL_INTERVAL);
        }
    }
}

/// Drops the PTY master and writer exactly once, and only after BOTH facts
/// hold: the child's exit was positively observed (reaped exit status) and
/// the reader thread finished draining output. Retained ring output is
/// in-memory and unaffected, so `session.read` keeps serving the retained
/// tail after release. No descendant cleanup is claimed, attempted, or
/// implied. Each lock is taken only for the instant of a check or a
/// `take()`; this never blocks while holding the DB or session-map locks.
/// The master is taken before the writer: even if a writer-side write is
/// still unwinding, the master descriptor is released first.
fn try_release_native(handle: &SessionHandle) {
    if handle.exit_code.lock().unwrap().is_none() {
        return;
    }
    if !handle.reader_done.load(Ordering::Acquire) {
        return;
    }
    drop(handle.native.lock().unwrap().take());
    drop(handle.writer.lock().unwrap().take());
}

fn persist_exit(handle: &SessionHandle, exit_code: i64) -> Result<(), RpcError> {
    let conn = handle.db.lock().unwrap();
    let changed = conn
        .execute(
            "UPDATE sessions SET verdict = 'exited', exit_code = ?2 WHERE id = ?1",
            rusqlite::params![handle.session_id, exit_code],
        )
        .map_err(error::from_sqlite)?;
    if changed != 1 {
        return Err(error::io_error("Session exit record is missing"));
    }
    Ok(())
}

pub(crate) fn persist_admission(handle: &SessionHandle) -> Result<(), RpcError> {
    let conn = handle.db.lock().unwrap();
    let result = conn.execute(
        "UPDATE sessions SET verdict = CASE WHEN verdict = 'pending' THEN 'live' ELSE verdict END WHERE id = ?1",
        [&handle.session_id],
    );
    if !matches!(result, Ok(1)) {
        return Err(error::unverifiable(format!(
            "Session {} started but its state could not be persisted; inspect its retained identity before further action",
            handle.session_id,
        )));
    }
    Ok(())
}

pub(crate) fn check_incarnation(handle: &SessionHandle, incarnation: &str) -> Result<(), RpcError> {
    if handle.incarnation != incarnation {
        return Err(error::stale_incarnation());
    }
    Ok(())
}

impl SessionHandle {
    /// Whether the child's exit has been positively observed (reaped),
    /// without forcing a reap (read paths must never block on process state).
    pub(crate) fn is_exited(&self) -> bool {
        self.exit_code.lock().unwrap().is_some()
    }
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
    // Writer lock only: a long/blocking write must not serialize master
    // operations (`resize`) or native release behind it.
    let mut writer = handle.writer.lock().unwrap();
    let Some(writer) = writer.as_mut() else {
        // Exit was observed and output drained between the reap check and the
        // lock; the writer is gone by design, not by failure.
        return Err(error::unverifiable(
            "session already exited; cannot accept more input",
        ));
    };
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
    {
        let mut native = handle.native.lock().unwrap();
        let Some(native) = native.as_mut() else {
            // Exit was observed and output drained between the reap check and
            // the lock; the master is gone by design, not by failure. (A
            // blocked writer holds only the writer lock, never this one.)
            return Err(error::unverifiable("session already exited; cannot resize"));
        };
        native
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| error::io_error(format!("pty resize failed: {e}")))?;
    }
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
pub(crate) fn stop(handle: &SessionHandle) -> Result<Value, RpcError> {
    stop_with_action(handle).session
}

pub(crate) struct StopObservation {
    pub(crate) process_action: drogon_protocol::orchestration_worker::ProcessAction,
    pub(crate) session: Result<Value, RpcError>,
}

/// Preserve signal evidence even when persisting the observed exit fails.
pub(crate) fn stop_with_action(handle: &SessionHandle) -> StopObservation {
    use drogon_protocol::orchestration_worker::ProcessAction;

    if let Some(code) = try_reap(handle) {
        if let Some(path) = handle.take_hook_settings_file() {
            remove_hook_settings_file(&path);
        }
        try_release_native(handle);
        return StopObservation {
            process_action: ProcessAction::None,
            session: persist_exit(handle, code).map(|()| to_json(handle, "exited", Some(code))),
        };
    }
    let process_action = {
        let mut child = handle.child.lock().unwrap();
        match child.kill() {
            Ok(()) => ProcessAction::Signalled,
            Err(_) => ProcessAction::Unverifiable,
        }
    };
    let deadline = Instant::now() + STOP_VERIFY_TIMEOUT;
    loop {
        if let Some(code) = try_reap(handle) {
            if let Some(path) = handle.take_hook_settings_file() {
                remove_hook_settings_file(&path);
            }
            try_release_native(handle);
            return StopObservation {
                process_action,
                session: persist_exit(handle, code).map(|()| to_json(handle, "exited", Some(code))),
            };
        }
        if Instant::now() >= deadline {
            // The poller thread owns release for this ordering: it will
            // observe the exit and release the native halves once drained.
            return StopObservation {
                process_action,
                session: Ok(to_json(handle, "unverifiable", None)),
            };
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

pub(crate) fn snapshot(handle: &SessionHandle) -> Value {
    let (verdict, code) = current_verdict(handle);
    to_json(handle, &verdict, code)
}

/// Exit takes precedence over the raw activity clock (see
/// `agent_state::derive`): a caller here already knows whether the session
/// exited via its own `verdict`, so this never re-reaps `exit_code` itself.
/// An uncleared hook signal reports `needs_input` with its own stamp; the
/// reader thread clears it on the next output chunk.
fn agent_state_fields(handle: &SessionHandle, verdict: &str) -> (&'static str, Option<String>) {
    let (activity, wall_clock_at) = match &*handle.last_activity.lock().unwrap() {
        None => (Activity::NeverObserved, None),
        Some((instant, at)) => (Activity::LastActiveAgo(instant.elapsed()), Some(at.clone())),
    };
    let needs_input_at = handle.needs_input_at.lock().unwrap().clone();
    let state = agent_state::derive(verdict == "exited", activity, needs_input_at.is_some());
    let at = match state {
        AgentState::Working | AgentState::Idle => wall_clock_at,
        AgentState::NeedsInput => needs_input_at,
        AgentState::Exited | AgentState::Unknown => None,
    };
    (state.as_wire(), at)
}

pub(crate) fn to_json(handle: &SessionHandle, verdict: &str, exit_code: Option<i64>) -> Value {
    let (cols, rows) = *handle.size.lock().unwrap();
    let (agent_state, agent_state_at) = agent_state_fields(handle, verdict);
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
        "agentState": agent_state,
        "agentStateAt": agent_state_at,
    })
}

/// Reads the whole retained output tail of a session (cursor 0, one full
/// ring's worth): used by `automation.run` to snapshot a run's live or
/// retained session output. The outcome's `truncated` flag is set exactly
/// when older bytes have already rotated out of the ring.
pub(crate) fn read_tail(handle: &SessionHandle) -> crate::ring::ReadOutcome {
    handle
        .ring
        .lock()
        .unwrap()
        .read(0, crate::ring::CAPACITY_BYTES)
        .expect("cursor 0 is never a future cursor")
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
