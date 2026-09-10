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
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
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

/// `SessionHandle::turn_fact` states: no hook-reported turn live, a
/// resumption hook opened one, or a turn-end hook concluded one. Plain
/// constants (not an enum) because the fact lives in an `AtomicU8`.
const TURN_INACTIVE: u8 = 0;
const TURN_ACTIVE: u8 = 1;
const TURN_ENDED: u8 = 2;
/// Wire spellings of the durable turn fact (`sessions.turn_fact`); `NULL`
/// means INACTIVE — no known turn.
pub(crate) const TURN_ACTIVE_WIRE: &str = "active";
pub(crate) const TURN_ENDED_WIRE: &str = "ended";

pub(crate) struct SessionHandle {
    pub(crate) session_id: String,
    pub(crate) incarnation: String,
    pub(crate) workspace_id: String,
    pub(crate) host_id: String,
    pub(crate) command: String,
    pub(crate) args: Vec<String>,
    /// Which harness launched this session, when it was `harness.start`
    /// (additive launch-identity record). Plain `session.start` sessions
    /// carry `None`. A terminal Restart re-launches from this record.
    pub(crate) harness_id: Option<String>,
    /// Issue #359: the session whose PTY spawned this one (recorded at
    /// spawn from the spawning caller's inherited `DROGON_SESSION_ID`), so
    /// the sidebar can nest this row under its parent exactly like the
    /// fork's `orchestration.parentPaneKey`. `None` for parentless
    /// (UI-spawned) sessions.
    pub(crate) parent_session_id: Option<String>,
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
    /// Wall-clock stamp of the most recent `session.hook_event` wait
    /// signal (`Notification` from the per-session Claude Code hooks file,
    /// or a genuine-wait event from another harness' hook install) that no
    /// later clear has removed yet. `None` for sessions that never got
    /// one — sessions without a managed hook keep purely activity-based states.
    needs_input_at: Mutex<Option<String>>,
    /// Wall-clock stamp of the most recent hook lifecycle transition (turn
    /// start via a resumption hook, turn end via a turn-end hook, or the
    /// admission boundary). Pairs an `Instant` for ordering against
    /// `last_activity` with the renderable RFC 3339 string. Backs the
    /// `agentStateAt` of hook-derived `working`/`idle` states: a turn
    /// reported by hooks with no PTY output yet (silent harnesses, the
    /// fresh-session idle boundary) still owes the card a freshness stamp,
    /// which the activity clock alone cannot provide.
    hook_transition_at: Mutex<Option<(Instant, String)>>,
    agent_prompt_preview: Mutex<Option<String>>,
    cache_idle_at: Mutex<Option<String>>,
    /// Per-session harness hook install artifacts `harness.start` wrote for
    /// this session (Claude's `--settings` file; OpenCode's
    /// `OPENCODE_CONFIG_DIR` overlay directory; Pi's `--extension` file and
    /// sibling marker; Codex's disposable `CODEX_HOME`), all removed when the
    /// session exits (`hooks::remove_settings_file` handles both a file and a
    /// directory tree). Empty for sessions launched without hook wiring.
    hook_cleanup_paths: Mutex<Vec<std::path::PathBuf>>,
    suspended_hook_files: Mutex<Vec<(std::path::PathBuf, Vec<u8>)>>,
    /// OpenCode/Pi/Codex/Claude opt out of the reader thread's generic
    /// activity-based clear (set by `harness.rs` via
    /// [`Self::set_explicit_wait_clear`]): their hook lifecycle is authoritative
    /// once a wait signal is reported, so any unrelated PTY byte clearing
    /// `needs_input_at` would make "waiting for you" a lie — and for claude
    /// the clock's reading of the composer's keystroke echo flipped idle
    /// sessions to `working` (sidebar-status bug), which is why claude
    /// joined them. Plain sessions and hook-less launches keep the default
    /// generic-activity clear.
    explicit_wait_clear: AtomicBool,
    /// In-memory turn fact for `explicit_wait_clear` sessions, one of
    /// `TURN_INACTIVE`/`TURN_ACTIVE`/`TURN_ENDED`: opened by resumption
    /// hooks (`clear_hook_event`), closed by wait hooks (`note_hook_event`)
    /// and concluded by turn-end hooks (`end_hook_event`). Backed by the
    /// durable `sessions.turn_fact`/`turn_fact_at` columns so a daemon
    /// restart keeps reporting a hook-reported turn as `working` (with its
    /// original stamp) instead of hiding it as `unknown` — loss of contact
    /// never proves exit, and nobody observed the turn concluding.
    /// [`Self::reset_hook_lifecycle`] drops both copies when the status
    /// hooks lose their authority.
    turn_fact: AtomicU8,
    /// Daemon-run mode (bot/automation headless launches: `pi -p`,
    /// `claude -p`, `opencode run`, `codex exec`, `agy -p`). Set once by
    /// `harness.start` right after launch. A headless run has no approval-answer surface,
    /// so hook wait signals are ignored for it (see `hooks.rs`) and its
    /// exit advances the linked run rows (see `run_completion.rs`).
    headless: AtomicBool,
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
        harness_id: Option<String>,
        parent_session_id: Option<String>,
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
            harness_id,
            parent_session_id,
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
            hook_transition_at: Mutex::new(None),
            agent_prompt_preview: Mutex::new(None),
            cache_idle_at: Mutex::new(None),
            hook_cleanup_paths: Mutex::new(Vec::new()),
            suspended_hook_files: Mutex::new(Vec::new()),
            explicit_wait_clear: AtomicBool::new(false),
            turn_fact: AtomicU8::new(TURN_INACTIVE),
            headless: AtomicBool::new(false),
            db,
        })
    }

    pub(crate) fn set_status_hooks_enabled(&self, enabled: bool) -> Result<(), RpcError> {
        if self.is_exited() {
            return Ok(());
        }
        let mut saved = self.suspended_hook_files.lock().unwrap();
        if enabled {
            for (path, bytes) in saved.iter() {
                if path.exists() {
                    std::fs::write(path, bytes)
                        .map_err(|_| error::io_error("Cannot restore managed agent hook"))?;
                }
            }
            saved.clear();
        } else if saved.is_empty() {
            // The hook lifecycle loses its authority with the files: drop
            // it wholesale so the session falls back to the activity clock
            // (the documented `HookTurn::Inactive` policy) instead of
            // stranding its last hook-reported state forever — a turn
            // disabled mid-run must never keep reading `working` with no
            // hook ever able to conclude it.
            self.reset_hook_lifecycle();
            let paths = self.hook_cleanup_paths.lock().unwrap().clone();
            for root in paths {
                let path = match self.harness_id.as_deref() {
                    Some("codex") => root.join("hooks.json"),
                    Some("opencode") => root.join("plugins/drogon-opencode-status.js"),
                    Some("pi") if root.extension().is_some_and(|ext| ext == "ts") => root,
                    Some("claude") => root,
                    _ => continue,
                };
                if !path.is_file() {
                    continue;
                }
                let bytes = std::fs::read(&path)
                    .map_err(|_| error::io_error("Cannot read managed agent hook"))?;
                let inactive = if path.extension().is_some_and(|ext| ext == "json") {
                    let mut value: Value = serde_json::from_slice(&bytes)
                        .map_err(|_| error::invalid_argument("Invalid managed hooks"))?;
                    if let Some(events) = value["hooks"].as_object_mut() {
                        for entries in events.values_mut() {
                            if let Some(entries) = entries.as_array_mut() {
                                for entry in entries.iter_mut() {
                                    if let Some(hooks) = entry["hooks"].as_array_mut() {
                                        hooks.retain(|hook| {
                                            !hook["command"].as_str().is_some_and(|cmd| {
                                                cmd.contains("internal hook-event")
                                            })
                                        });
                                    }
                                }
                                entries.retain(|entry| {
                                    entry["hooks"]
                                        .as_array()
                                        .is_none_or(|hooks| !hooks.is_empty())
                                });
                            }
                        }
                        events.retain(|_, entries| {
                            entries.as_array().is_none_or(|entries| !entries.is_empty())
                        });
                    }
                    serde_json::to_vec(&value).unwrap()
                } else if self.harness_id.as_deref() == Some("opencode") {
                    b"export const DrogonStatusPlugin = async () => ({});".to_vec()
                } else {
                    b"export default function () {}".to_vec()
                };
                std::fs::write(&path, inactive)
                    .map_err(|_| error::io_error("Cannot remove managed agent hook"))?;
                saved.push((path, bytes));
            }
            self.cache_idle_at.lock().unwrap().take();
        } else {
            // The files regain their authority, but no fact was observed
            // under it while they were out: force re-observation from the
            // activity clock until the next real hook event (the disable
            // already reset the lifecycle; this covers a disable racing in
            // from another window between this enable and its file
            // restore).
            self.reset_hook_lifecycle();
        }
        Ok(())
    }

    pub(crate) fn note_agent_prompt(&self, prompt: &str) {
        let mut preview = self.agent_prompt_preview.lock().unwrap();
        if preview.is_none() && !prompt.trim().is_empty() {
            *preview = Some(prompt.chars().take(512).collect());
        }
    }

    pub(crate) fn note_cache_event(&self, event: &str) {
        if self.harness_id.as_deref() != Some("claude") {
            return;
        }
        if event == "Stop" {
            *self.cache_idle_at.lock().unwrap() = Some(crate::now_rfc3339());
        } else if matches!(event, "UserPromptSubmit" | "PreToolUse") {
            *self.cache_idle_at.lock().unwrap() = None;
        }
    }

    /// Records a hook wait signal; the next PTY output chunk clears it,
    /// unless [`Self::set_explicit_wait_clear`] opted this session out of
    /// that generic clear. The stamp is also durable (`sessions` row), so a
    /// daemon restart keeps reporting a still-waiting session as
    /// `needs_input` instead of `unknown`.
    pub(crate) fn note_hook_event(&self) {
        // The wait hook hands the session back to the user: any turn the
        // resumption hook opened is parked, not running.
        self.turn_fact.store(TURN_INACTIVE, Ordering::Release);
        *self.hook_transition_at.lock().unwrap() = None;
        let stamp = crate::now_rfc3339();
        *self.needs_input_at.lock().unwrap() = Some(stamp.clone());
        persist_wait_signal(self, Some(&stamp));
        persist_turn_fact(self, None, None);
    }

    /// Explicit turn-start signal from a harness hook's own resumption
    /// event (`agent_state`'s `HookSignal::TurnStart` names), independent
    /// of PTY activity. The only way `needs_input_at` clears for a session
    /// that opted out of the generic clear.
    pub(crate) fn clear_hook_event(&self) {
        // A resumption event is the harness's own "the agent is on it":
        // the turn stays authoritative until the next wait or turn-end
        // hook, through output silence that would otherwise flip the row
        // idle mid-turn.
        self.turn_fact.store(TURN_ACTIVE, Ordering::Release);
        *self.needs_input_at.lock().unwrap() = None;
        persist_wait_signal(self, None);
        // The turn start is the freshness origin for a hook-reported turn
        // whose harness has not emitted output yet.
        let stamp = (Instant::now(), crate::now_rfc3339());
        *self.hook_transition_at.lock().unwrap() = Some(stamp.clone());
        persist_turn_fact(self, Some(TURN_ACTIVE_WIRE), Some(&stamp.1));
    }

    /// Turn-end signal (`agent_state`'s `HookSignal::TurnEnd` names:
    /// Pi AgentEnd, OpenCode SessionIdle, Claude/Codex Stop — the
    /// reference maps every one to `done`). Clears any wait signal like a
    /// resumption hook but CLOSES the turn instead of opening it: the row
    /// reads `idle` on the harness's own authority and the user's echo at
    /// the idle prompt does not spin it back to `working` (issue #360).
    pub(crate) fn end_hook_event(&self) {
        self.turn_fact.store(TURN_ENDED, Ordering::Release);
        *self.needs_input_at.lock().unwrap() = None;
        persist_wait_signal(self, None);
        // The turn-end moment is the freshness origin for the hook-declared
        // idle boundary — including a session with no PTY output at all yet
        // (fresh claude launch), which the client contract requires to
        // carry a non-null `agentStateAt`.
        let stamp = (Instant::now(), crate::now_rfc3339());
        *self.hook_transition_at.lock().unwrap() = Some(stamp.clone());
        persist_turn_fact(self, Some(TURN_ENDED_WIRE), Some(&stamp.1));
    }

    /// Spends an in-flight hook signal without ever manufacturing a turn
    /// fact: the wait stamp is dropped, but the turn fact and its
    /// transition stamp stay exactly as they were. The policy for events
    /// that arrive while status hooks are globally disabled — the hook
    /// files are neutered, so no event may open a turn nobody's hooks can
    /// conclude (that strands `working`); a genuine turn-end still
    /// concludes via [`Self::end_hook_event`].
    pub(crate) fn discard_hook_signal(&self) {
        *self.needs_input_at.lock().unwrap() = None;
        persist_wait_signal(self, None);
    }

    /// Drops the whole hook lifecycle without opening a turn: the turn
    /// fact returns to INACTIVE (the activity-clock fallback), any wait
    /// signal is discarded, and the transition stamp is cleared — durably
    /// too, so a restart cannot resurrect a lifecycle the disabled policy
    /// already dropped. The disable/re-enable policy for status hooks: the
    /// files lose or regain authority, so the session honestly re-observes
    /// from the activity clock instead of stranding its last
    /// hook-reported state (`working` with no activity ever).
    pub(crate) fn reset_hook_lifecycle(&self) {
        self.turn_fact.store(TURN_INACTIVE, Ordering::Release);
        *self.needs_input_at.lock().unwrap() = None;
        persist_wait_signal(self, None);
        *self.hook_transition_at.lock().unwrap() = None;
        persist_turn_fact(self, None, None);
    }

    /// Opts this session out of the reader thread's generic activity-based
    /// clear. Admission sets it before starting the reader thread for
    /// OpenCode/Pi/Codex and interactive Claude sessions — see the field doc
    /// for why.
    pub(crate) fn set_explicit_wait_clear(&self) {
        self.explicit_wait_clear.store(true, Ordering::Release);
    }

    /// Hook-authoritative turn fact backing [`agent_state::HookTurn`]:
    /// resumption hooks open the turn, wait hooks park it, turn-end hooks
    /// conclude it. In-memory only — after a daemon restart the session
    /// falls back to the activity clock (`HookTurn::Inactive`) rather than
    /// claiming a turn nobody re-observed.
    pub(crate) fn hook_turn_fact(&self) -> crate::agent_state::HookTurn {
        match self.turn_fact.load(Ordering::Acquire) {
            TURN_ACTIVE => crate::agent_state::HookTurn::Active,
            TURN_ENDED => crate::agent_state::HookTurn::Ended,
            _ => crate::agent_state::HookTurn::Inactive,
        }
    }

    /// Marks this session as a headless daemon run. Admission sets it before
    /// starting the reader/poller threads, before a hook event or fast exit
    /// can observe it unset. See the field doc.
    pub(crate) fn set_headless(&self) {
        self.headless.store(true, Ordering::Release);
    }

    /// Whether this session is a headless daemon run.
    pub(crate) fn is_headless(&self) -> bool {
        self.headless.load(Ordering::Acquire)
    }

    /// Remembers one per-session hook install artifact so the exit paths
    /// can remove it. The admission helper registers paths before starting
    /// the exit observer (Pi has both its `--extension` file and a sibling
    /// marker; Codex owns its disposable home as one directory).
    pub(crate) fn add_hook_cleanup_path(&self, path: std::path::PathBuf) {
        self.hook_cleanup_paths.lock().unwrap().push(path);
    }

    /// Takes every remembered hook install artifact for deletion, if any.
    fn take_hook_cleanup_paths(&self) -> Vec<std::path::PathBuf> {
        std::mem::take(&mut self.hook_cleanup_paths.lock().unwrap())
    }
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
    harness_id: Option<String>,
    parent_session_id: Option<String>,
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
            harness_id,
            parent_session_id,
            cols,
            rows,
        )?;
        tx.commit().map_err(error::from_sqlite)?;
        plan
    };
    session_admission::launch_reserved(db, data_dir, plan, None, &[])
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
    extra_env: &[(String, String)],
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
    // only the session environment. `extra_env` (an OpenCode/Pi hook
    // overlay from `harness.rs` — `OPENCODE_CONFIG_DIR`, the hook CLI path
    // and incarnation) applies last and is empty for every other caller.
    crate::session_env::apply_to_command(&mut cmd, data_dir, workspace_id, session_id);
    if let Some(env) = worker_env {
        env.apply_to_command(&mut cmd);
    }
    for (key, value) in extra_env {
        cmd.env(key, value);
    }
    cmd.args(args);
    cmd.cwd(cwd);

    // Why not `slave.spawn_command` on unix: that path resets only
    // SIGINT/SIGQUIT/SIGTERM/SIGHUP/SIGCHLD/SIGALRM before exec. A detached
    // daemon commonly runs with SIGINT/SIGQUIT ignored and Rust's runtime
    // ignores SIGPIPE at startup; POSIX keeps ignored dispositions across
    // exec, so a session child could never be interrupted by ^C and
    // pipeline tools lost default SIGPIPE behavior (issue #273). Our own
    // spawn resets the full set (adding SIGPIPE and SIGTSTP) and clears the
    // blocked signal mask in the child, then does the same
    // setsid/TIOCSCTTY/fd-cleanup the pty crate's hook did. Windows keeps
    // the crate's ConPTY spawn (no POSIX signals there).
    #[cfg(unix)]
    let child = spawn_child_unix(pair.master.as_ref(), &cmd)?;
    #[cfg(windows)]
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

/// Unix half of `spawn_pty`'s child launch: translate the already-composed
/// [`CommandBuilder`] (session env, worker env, hook overlay, argv, cwd)
/// into a `std::process::Command` so a `pre_exec` hook can reset inherited
/// signal dispositions and the blocked-signal mask before exec, then
/// reproduce the pty setup the crate's own hook did (setsid, the slave as
/// controlling terminal, stray-fd cleanup). Dispositions that were ignored
/// in the daemon survive exec per POSIX, so without this reset a session's
/// shell inherits SIGINT/SIGQUIT/SIGPIPE ignored from a detached or
/// Rust-runtime daemon and ^C can never interrupt it (issue #273).
#[cfg(unix)]
fn spawn_child_unix(
    master: &dyn MasterPty,
    builder: &CommandBuilder,
) -> Result<Box<dyn Child + Send + Sync>, RpcError> {
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::io::FromRawFd;
    use std::os::unix::process::CommandExt;

    // The crate's `SlavePty` trait exposes no fd, so open the slave device
    // ourselves by its tty name (O_NOCTTY: the child takes it as its
    // controlling terminal explicitly in `pre_exec`).
    let tty_name = master
        .tty_name()
        .ok_or_else(|| error::io_error("pty master exposes no tty name on unix"))?;
    let c_path = std::ffi::CString::new(tty_name.as_os_str().as_bytes())
        .map_err(|_| error::io_error("pty tty name contains a NUL byte"))?;
    let slave_fd = unsafe { libc::open(c_path.as_ptr(), libc::O_RDWR | libc::O_NOCTTY) };
    if slave_fd == -1 {
        return Err(error::io_error(format!(
            "open pty slave failed: {}",
            std::io::Error::last_os_error()
        )));
    }
    let argv = builder.get_argv();
    let program = argv
        .first()
        .ok_or_else(|| error::invalid_argument("session command is empty"))?;
    let mut command = std::process::Command::new(program);
    command.args(&argv[1..]);
    // Mirror the crate's `as_command`: an invalid cwd falls back to $HOME
    // rather than failing the spawn.
    let cwd = builder
        .get_cwd()
        .filter(|dir| std::path::Path::new(dir).is_dir());
    match cwd {
        Some(dir) => {
            command.current_dir(dir);
        }
        None => {
            if let Some(home) = std::env::var_os("HOME") {
                command.current_dir(home);
            }
        }
    }
    command.env_clear();
    for (key, value) in builder.iter_full_env_as_str() {
        command.env(key, value);
    }
    command.env("SHELL", builder.get_shell());

    // Duplicate the slave fd for each stdio stream; std moves them onto
    // 0/1/2 in the child before `pre_exec` runs, so the hook can take the
    // controlling terminal via fd 0.
    let dup_slave = || {
        let fd = unsafe { libc::dup(slave_fd) };
        if fd == -1 {
            Err(error::io_error(format!(
                "dup pty slave failed: {}",
                std::io::Error::last_os_error()
            )))
        } else {
            Ok(unsafe { std::fs::File::from_raw_fd(fd) })
        }
    };
    command
        .stdin(std::process::Stdio::from(dup_slave()?))
        .stdout(std::process::Stdio::from(dup_slave()?))
        .stderr(std::process::Stdio::from(dup_slave()?));
    unsafe {
        libc::close(slave_fd);
    }

    unsafe {
        command.pre_exec(|| {
            // Reset every disposition the daemon may carry: a detached
            // service often runs with SIGINT/SIGQUIT ignored, and Rust's
            // runtime ignores SIGPIPE at startup. POSIX keeps ignored
            // dispositions across exec, and a non-interactive shell cannot
            // trap or reset a signal that was ignored on entry, so this is
            // the only point where a session child can recover default
            // behavior. Then clear any blocked-signal mask.
            for signo in [
                libc::SIGINT,
                libc::SIGQUIT,
                libc::SIGPIPE,
                libc::SIGTERM,
                libc::SIGHUP,
                libc::SIGCHLD,
                libc::SIGALRM,
                libc::SIGTSTP,
            ] {
                libc::signal(signo, libc::SIG_DFL);
            }
            let empty_set: libc::sigset_t = std::mem::zeroed();
            libc::sigprocmask(libc::SIG_SETMASK, &empty_set, std::ptr::null_mut());

            // Session leader with the pty slave as controlling terminal:
            // required for job-control signals (and SIGWINCH on resize) to
            // reach the foreground process group.
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            #[allow(clippy::cast_lossless)]
            if libc::ioctl(0, libc::TIOCSCTTY as _, 0) == -1 {
                return Err(std::io::Error::last_os_error());
            }
            portable_pty::unix::close_random_fds();
            Ok(())
        });
    }

    let child = command
        .spawn()
        .map_err(|e| error::io_error(format!("spawn failed: {e}")))?;
    Ok(Box::new(child))
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
        // Line discipline delivers output in small chunks (single-digit bytes
        // per read on macOS), so a flood session can push 100k chunks/s.
        // Timestamp formatting and mutex churn per chunk burned real CPU;
        // activity is consumed at whole-second granularity downstream, so
        // the observation is throttled. `None` (never marked) always marks:
        // the first activity observation is what lifts a session out of
        // `unknown` — suppressing it would stick fresh sessions there.
        let mut last_activity_marked: Option<Instant> = None;
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    handle.ring.lock().unwrap().push(&buf[..n]);
                    let now = Instant::now();
                    let marked = if last_activity_marked
                        .map(|marked| now.duration_since(marked).as_millis() >= 200)
                        .unwrap_or(true)
                    {
                        last_activity_marked = Some(now);
                        *handle.last_activity.lock().unwrap() = Some((now, crate::now_rfc3339()));
                        true
                    } else {
                        false
                    };
                    // Output resumes: the wait signal is spent, back to
                    // activity-based derivation. Skipped for sessions that
                    // opted into explicit-only clearing (OpenCode/Pi/Codex —
                    // see the `explicit_wait_clear` field doc): their hook
                    // lifecycle can report a genuine wait while PTY bytes
                    // continue, so output clearing the signal here is wrong.
                    let cleared = if !handle.explicit_wait_clear.load(Ordering::Acquire) {
                        clear_wait_signal_on_activity(&handle)
                    } else {
                        false
                    };
                    // R16-BF2 push: fresh output (and the wait clear it
                    // carries) moves the agent state now — recorded after
                    // both mutations so the snapshot reflects the new truth,
                    // not the pre-clear signal. `record_snapshot` is
                    // transition-guarded, so steady output stays quiet (one
                    // event per stamp change) and the per-chunk fast path
                    // above keeps its throttle.
                    if marked || cleared {
                        crate::session_events::record_snapshot(&snapshot(&handle));
                    }
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

/// Observe and reap without waiting for the child. The exit lock is held
/// while the child's cleanup artifacts are removed so no reader can observe
/// `exited` before cleanup has completed. The child lock is released before
/// filesystem work; callers only hold the exit lock across that work, never
/// across a sleep.
fn try_reap(handle: &SessionHandle) -> Option<i64> {
    let mut exit = handle.exit_code.lock().unwrap();
    if let Some(code) = *exit {
        return Some(code);
    }
    let code = {
        let mut child = handle.child.lock().unwrap();
        match child.try_wait() {
            Ok(Some(status)) => status.exit_code() as i64,
            _ => return None,
        }
    };
    for path in handle.take_hook_cleanup_paths() {
        crate::hooks::remove_settings_file(&path);
    }
    *exit = Some(code);
    Some(code)
}

/// Polls (never blocks, never holds a lock across the sleep) until the
/// child's real exit is observed, then persists it and releases the native
/// PTY halves. Runs for as long as it takes — a background thread waiting on
/// its own session's eventual exit costs nothing else while it waits.
fn poll_until_exit(handle: &SessionHandle) {
    loop {
        if let Some(code) = try_reap(handle) {
            if persist_exit(handle, code).is_ok() {
                // A headless daemon run's exit IS its completion signal:
                // advance the linked run rows to their terminal state now,
                // while the linkage is still provable in this process.
                // Interactive sessions never carry run linkage (runs always
                // launch headless), so they skip this. A failure here must
                // never disturb the already-persisted exit.
                if handle.is_headless() {
                    let observed_at = crate::now_unix_ms() as f64;
                    if let Err(e) = advance_headless_run_records(
                        &handle.db,
                        &handle.session_id,
                        &handle.incarnation,
                        code,
                        observed_at,
                    ) {
                        eprintln!(
                            "[session] failed to advance headless run records for {}: {e}",
                            handle.session_id
                        );
                    }
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

/// Advances the run rows linked to one exited headless session to their
/// terminal state: `automation_runs` rows admitted for this exact
/// session/incarnation move `dispatched` -> `completed` (with the reaped
/// exit code); their linked `bot_responsibility_runs` rows move to
/// `exited` with `ended_at`; `bot_messages` (chat turns) for this exact
/// session/incarnation gain `exited`/`ended_at`. Anything already terminal
/// is left untouched (earliest `ended_at` wins), and rows for other
/// sessions/incarnations are never matched: the session fence is the
/// `(session id, incarnation)` pair, the same linkage dispatch recorded.
///
/// Rows are JSON payloads (`payload_json`), so the match pre-filters in SQL
/// with `json_extract` (precedent: `bot_snapshot_rpc.rs`) and the status
/// guard is applied on the parsed struct in Rust. One `BEGIN IMMEDIATE`
/// for the whole advancement; returns how many rows moved.
pub(crate) fn advance_headless_run_records(
    db: &std::sync::Arc<std::sync::Mutex<Connection>>,
    session_id: &str,
    incarnation: &str,
    exit_code: i64,
    observed_at: f64,
) -> Result<AdvanceSummary, crate::automations::storage::StorageError> {
    use crate::automations::records::{AutomationRun, AutomationRunStatus};
    use crate::automations::storage::StorageError;
    use crate::bots::records::{BotMessage, HostObservation, ResponsibilityRun};

    let mut summary = AdvanceSummary::default();
    let conn = db.lock().unwrap();
    let tx = crate::automations::storage::begin_immediate(&conn)?;
    let mut advanced_automation_run_ids = Vec::new();
    {
        let mut select = tx.prepare(
            "SELECT id, payload_json FROM automation_runs \
             WHERE json_extract(payload_json, '$.terminalSessionId') = ?1",
        )?;
        let rows: Vec<(String, String)> = select
            .query_map([session_id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_, _>>()?;
        for (id, payload) in rows {
            let Ok(mut run): Result<AutomationRun, _> = serde_json::from_str(&payload) else {
                continue;
            };
            if run.session_incarnation.as_deref() != Some(incarnation)
                || run.status != AutomationRunStatus::Dispatched
            {
                continue;
            }
            run.status = AutomationRunStatus::Completed;
            run.exit_code = Some(exit_code);
            run.observed_at = Some(observed_at);
            let payload = serde_json::to_string(&run).map_err(StorageError::Json)?;
            tx.execute(
                "UPDATE automation_runs SET payload_json = ?1 WHERE id = ?2",
                rusqlite::params![payload, id],
            )?;
            advanced_automation_run_ids.push(id);
            summary.automation_runs += 1;
        }
    }
    for automation_run_id in &advanced_automation_run_ids {
        let mut select = tx.prepare(
            "SELECT id, payload_json FROM bot_responsibility_runs WHERE automation_run_id = ?1",
        )?;
        let rows: Vec<(String, String)> = select
            .query_map([automation_run_id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_, _>>()?;
        for (id, payload) in rows {
            let Ok(mut run): Result<ResponsibilityRun, _> = serde_json::from_str(&payload) else {
                continue;
            };
            if run.host_observation == Some(HostObservation::Exited) {
                continue;
            }
            run.host_observation = Some(HostObservation::Exited);
            run.ended_at = Some(observed_at);
            let payload = serde_json::to_string(&run).map_err(StorageError::Json)?;
            tx.execute(
                "UPDATE bot_responsibility_runs SET payload_json = ?1 WHERE id = ?2",
                rusqlite::params![payload, id],
            )?;
            summary.responsibility_runs += 1;
        }
    }
    {
        let mut select = tx.prepare(
            "SELECT id, payload_json FROM bot_messages \
             WHERE json_extract(payload_json, '$.sessionId') = ?1",
        )?;
        let rows: Vec<(String, String)> = select
            .query_map([session_id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_, _>>()?;
        for (id, payload) in rows {
            let Ok(mut message): Result<BotMessage, _> = serde_json::from_str(&payload) else {
                continue;
            };
            // The observation decides, not `ended_at`: `record_chat` stamps
            // `ended_at` at dispatch-observation time even for a live turn,
            // so gating on it would skip every observed turn. Already-exited
            // rows keep their earliest `ended_at`.
            if message.incarnation.as_deref() != Some(incarnation)
                || message.host_observation == Some(HostObservation::Exited)
            {
                continue;
            }
            message.host_observation = Some(HostObservation::Exited);
            message.ended_at = Some(observed_at);
            let payload = serde_json::to_string(&message).map_err(StorageError::Json)?;
            tx.execute(
                "UPDATE bot_messages SET payload_json = ?1 WHERE id = ?2",
                rusqlite::params![payload, id],
            )?;
            summary.messages += 1;
        }
    }
    tx.commit()?;
    Ok(summary)
}

/// How many rows [`advance_headless_run_records`] moved to terminal state.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct AdvanceSummary {
    pub automation_runs: usize,
    pub responsibility_runs: usize,
    pub messages: usize,
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
    // An exit resolves any pending wait: the agent will never be answered,
    // so its stamp must not outlive the session in the durable row. A
    // restored `exited` row carrying a stale `needs_input_at` reports
    // `agentState exited` with a non-null `agentStateAt`, which poisons
    // every `session.list` consumer enforcing the session invariants
    // (#222). Only the durable row clears: past the exit every reader is
    // verdict-gated (`agent_state_fields` reports no stamp for `exited`,
    // and `hook_event` refuses exited sessions), so the in-memory signal
    // is unobservable — and taking its lock here would stall the exit
    // poller behind PTY-output churn, delaying hook-artifact removal.
    let conn = handle.db.lock().unwrap();
    let changed = conn
        .execute(
            "UPDATE sessions SET verdict = 'exited', exit_code = ?2, needs_input_at = NULL WHERE id = ?1",
            rusqlite::params![handle.session_id, exit_code],
        )
        .map_err(error::from_sqlite)?;
    if changed != 1 {
        return Err(error::io_error("Session exit record is missing"));
    }
    // R16-BF2 push: the exit moves the agent state to `exited` now. The
    // snapshot derives `exited` from the reaped code (never a stamp), so a
    // racing late activity mark can never resurrect `working` through the
    // transition guard.
    crate::session_events::record_snapshot(&snapshot(handle));
    Ok(())
}

/// Activity-based wait-signal clear. Idempotent: a noisy session can push
/// thousands of chunks per second, and only the `Some → None` transition may
/// touch the durable `sessions` row — an unconditional UPDATE per chunk made
/// a single 2.5 MB/s session burn ~40% of daemon CPU in SQLite writes.
/// Returns whether a transition actually happened.
pub(crate) fn clear_wait_signal_on_activity(handle: &SessionHandle) -> bool {
    {
        let mut signal = handle.needs_input_at.lock().unwrap();
        if signal.is_none() {
            return false;
        }
        *signal = None;
    }
    persist_wait_signal(handle, None);
    true
}

/// Mirrors the in-memory wait signal into the durable `sessions` row so
/// the wait survives a daemon restart. Best-effort like the reader
/// thread's other observations: a failed write must never break the live
/// session it reports on — the next signal overwrites it anyway.
fn persist_wait_signal(handle: &SessionHandle, stamp: Option<&str>) {
    let conn = handle.db.lock().unwrap();
    let _ = conn.execute(
        "UPDATE sessions SET needs_input_at = ?2 WHERE id = ?1",
        rusqlite::params![handle.session_id, stamp],
    );
}

/// Mirrors the in-memory turn fact into the durable `sessions` row so a
/// hook-reported turn (and its freshness stamp) survives a daemon restart:
/// the restored row re-reports `working`/`idle` from the hook's own
/// authority instead of hiding it as `unknown`. `None` facts park or drop
/// the lifecycle. Best-effort like [`persist_wait_signal`].
fn persist_turn_fact(handle: &SessionHandle, fact: Option<&str>, at: Option<&str>) {
    let conn = handle.db.lock().unwrap();
    let _ = conn.execute(
        "UPDATE sessions SET turn_fact = ?2, turn_fact_at = ?3 WHERE id = ?1",
        rusqlite::params![handle.session_id, fact, at],
    );
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
    // R16-BF2 push: a fresh admission is a state birth (`unknown` until the
    // first output). Recording it lets the push bridge learn new sessions
    // instantly instead of on the next `session.list` poll.
    crate::session_events::record_snapshot(&snapshot(handle));
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

    /// The retained PTY child's OS pid, when the platform exposes one.
    /// Used by `ports.kill` to prove a pid belongs to this workspace's
    /// session before signalling it — the handle, never persisted state,
    /// is the ownership evidence (same model as `session.stop`).
    pub(crate) fn child_process_id(&self) -> Option<u32> {
        self.child.lock().unwrap().process_id()
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

/// Forgets the durable row of a session the caller is explicitly done with
/// (R16-AL2, issue #228). This is the only honest way to dismiss an
/// `unverifiable` stub: the liveness rule forbids rewriting loss of contact
/// as `exited`, so the record cannot be "resolved" — it can only be
/// removed. Callers must stop (or positively confirm the exit of) any live
/// handle before forgetting; an orphaned live PTY is the one outcome this
/// module must never produce.
pub(crate) fn forget_record(conn: &rusqlite::Connection, session_id: &str) -> Result<(), RpcError> {
    let changed = conn
        .execute(
            "DELETE FROM sessions WHERE id = ?1",
            rusqlite::params![session_id],
        )
        .map_err(error::from_sqlite)?;
    if changed != 1 {
        return Err(error::not_found("session not found"));
    }
    Ok(())
}

pub(crate) struct StopObservation {
    pub(crate) process_action: drogon_protocol::orchestration_worker::ProcessAction,
    pub(crate) session: Result<Value, RpcError>,
}

/// Preserve signal evidence even when persisting the observed exit fails.
pub(crate) fn stop_with_action(handle: &SessionHandle) -> StopObservation {
    use drogon_protocol::orchestration_worker::ProcessAction;

    if let Some(code) = try_reap(handle) {
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
    let last_activity_instant = &*handle.last_activity.lock().unwrap();
    let (activity, wall_clock_at) = match last_activity_instant {
        None => (Activity::NeverObserved, None),
        Some((instant, at)) => (Activity::LastActiveAgo(instant.elapsed()), Some(at.clone())),
    };
    // Hook-derived `working`/`idle` without PTY output yet (silent harness
    // turn, fresh-session idle boundary) dates from the hook transition;
    // otherwise the later of the two clocks is the state's freshness
    // origin — flowing output refreshes it exactly as before.
    let hook_transition_at = handle.hook_transition_at.lock().unwrap().clone();
    let state_at = match (last_activity_instant, &hook_transition_at) {
        (Some((activity_instant, _at)), Some((hook_instant, hook_at))) => {
            if hook_instant > activity_instant {
                Some(hook_at.clone())
            } else {
                wall_clock_at
            }
        }
        (None, Some((_, hook_at))) => Some(hook_at.clone()),
        _ => wall_clock_at,
    };
    let needs_input_at = handle.needs_input_at.lock().unwrap().clone();
    let hook_turn = if !handle.explicit_wait_clear.load(Ordering::Acquire) {
        // Hook-less sessions (plain terminals, headless and hook-disabled
        // launches) keep activity-based `Working`, but a turn-end hook still
        // reads as `idle` — the reference maps every Stop to done (#360).
        // Hook-authoritative sessions (OpenCode/Pi/Codex, interactive
        // Claude) use their full turn fact: `Working` is hook-driven, never
        // output-driven (#358), so the composer's keystroke echo — which is
        // PTY output too — cannot spin an idle row back to working.
        match handle.hook_turn_fact() {
            agent_state::HookTurn::Ended => agent_state::HookTurn::Ended,
            _ => agent_state::HookTurn::Untracked,
        }
    } else {
        handle.hook_turn_fact()
    };
    let state = agent_state::derive(
        verdict == "exited",
        activity,
        needs_input_at.is_some(),
        hook_turn,
    );
    let at = match state {
        AgentState::Working | AgentState::Idle => state_at,
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
        "harnessId": handle.harness_id,
        "parentSessionId": handle.parent_session_id,
        "cols": cols,
        "rows": rows,
        "verdict": verdict,
        "exitCode": exit_code,
        "createdAt": handle.created_at,
        "agentState": agent_state,
        "agentStateAt": agent_state_at,
        "agentPromptPreview": handle.agent_prompt_preview.lock().unwrap().clone(),
        "cacheIdleAt": handle.cache_idle_at.lock().unwrap().clone(),
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

#[cfg(test)]
#[path = "session_close_tests.rs"]
mod session_close_tests;

#[cfg(all(test, unix))]
#[path = "session_signal_reset_tests.rs"]
mod session_signal_reset_tests;

#[cfg(test)]
mod headless_completion_tests {
    use super::*;
    use serde_json::json;

    fn open_engine() -> (tempfile::TempDir, crate::Engine) {
        let dir = tempfile::tempdir().unwrap();
        let engine = crate::Engine::open(dir.path()).unwrap();
        (dir, engine)
    }

    fn insert_automation_run(
        engine: &crate::Engine,
        id: &str,
        session_id: Option<&str>,
        incarnation: Option<&str>,
        status: &str,
    ) {
        let payload = json!({
            "id": id,
            "automationId": "auto-1",
            "title": "t",
            "scheduledFor": 1.0,
            "status": status,
            "trigger": "manual",
            "terminalSessionId": session_id,
            "sessionIncarnation": incarnation,
            "sessionKind": "terminal",
            "createdAt": 1.0,
        });
        engine
            .db
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO automation_runs (id, automation_id, payload_json) VALUES (?1, ?2, ?3)",
                rusqlite::params![id, "auto-1", payload.to_string()],
            )
            .unwrap();
    }

    fn insert_responsibility_run(
        engine: &crate::Engine,
        id: &str,
        automation_run_id: Option<&str>,
        observation: Option<&str>,
    ) {
        let payload = json!({
            "id": id,
            "botId": "bot-1",
            "responsibilityId": "resp-1",
            "automationId": "auto-1",
            "automationRunId": automation_run_id,
            "startedAt": 1.0,
            "endedAt": null,
            "recipe": null,
            "hostObservation": observation,
        });
        engine
            .db
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO bot_responsibility_runs (id, bot_id, automation_run_id, started_at, payload_json) VALUES (?1, ?2, ?3, 1.0, ?4)",
                rusqlite::params![id, "bot-1", automation_run_id, payload.to_string()],
            )
            .unwrap();
    }

    fn insert_message(
        engine: &crate::Engine,
        id: &str,
        session_id: Option<&str>,
        observation: &str,
        ended_at: Value,
    ) {
        let payload = json!({
            "id": id,
            "botId": "bot-1",
            "requestId": "req-1",
            "prompt": "hi",
            "sessionId": session_id,
            "incarnation": "inc-1",
            "hostObservation": observation,
            "error": null,
            "startedAt": 1.0,
            "endedAt": ended_at,
        });
        engine
            .db
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO bot_messages (id, bot_id, started_at, payload_json) VALUES (?1, ?2, 1.0, ?3)",
                rusqlite::params![id, "bot-1", payload.to_string()],
            )
            .unwrap();
    }

    fn read_payload(engine: &crate::Engine, table: &str, id: &str) -> Value {
        let conn = engine.db.lock().unwrap();
        let text: String = conn
            .query_row(
                &format!("SELECT payload_json FROM {table} WHERE id = ?1"),
                [id],
                |row| row.get(0),
            )
            .unwrap();
        serde_json::from_str(&text).unwrap()
    }

    #[test]
    fn exit_advances_the_linked_rows_to_their_terminal_state() {
        let (_dir, engine) = open_engine();
        insert_automation_run(&engine, "ar:1", Some("sess-1"), Some("inc-1"), "dispatched");
        insert_responsibility_run(&engine, "rr-1", Some("ar:1"), Some("live"));
        // A dispatch-observed live turn carries `ended_at` already (the
        // dispatch observation time): the exit still advances it, moving
        // `ended_at` to the exit time.
        insert_message(&engine, "msg-1", Some("sess-1"), "live", json!(2.0));

        let summary = advance_headless_run_records(&engine.db, "sess-1", "inc-1", 0, 42.0).unwrap();
        assert_eq!(
            summary,
            AdvanceSummary {
                automation_runs: 1,
                responsibility_runs: 1,
                messages: 1,
            }
        );

        let run = read_payload(&engine, "automation_runs", "ar:1");
        assert_eq!(run["status"], "completed");
        assert_eq!(run["exitCode"], 0);
        assert_eq!(run["observedAt"], 42.0);
        // Untouched fields survive the payload round-trip.
        assert_eq!(run["trigger"], "manual");

        let responsibility = read_payload(&engine, "bot_responsibility_runs", "rr-1");
        assert_eq!(responsibility["hostObservation"], "exited");
        assert_eq!(responsibility["endedAt"], 42.0);

        let message = read_payload(&engine, "bot_messages", "msg-1");
        assert_eq!(message["hostObservation"], "exited");
        assert_eq!(message["endedAt"], 42.0);
    }

    #[test]
    fn exit_leaves_terminal_foreign_and_unlinked_rows_untouched() {
        let (_dir, engine) = open_engine();
        // Already terminal: never regressed, earliest ended_at wins.
        insert_automation_run(
            &engine,
            "ar:done",
            Some("sess-1"),
            Some("inc-1"),
            "completed",
        );
        insert_responsibility_run(&engine, "rr:done", Some("ar:done"), Some("exited"));
        // Same session id, different incarnation: a different run.
        insert_automation_run(
            &engine,
            "ar:other-inc",
            Some("sess-1"),
            Some("inc-9"),
            "dispatched",
        );
        // No session linkage at all (dispatch failed / skipped rows).
        insert_automation_run(&engine, "ar:bare", None, None, "dispatched");
        insert_responsibility_run(&engine, "rr:bare", None, Some("live"));
        // Already exited: keeps its earliest `ended_at`.
        insert_message(&engine, "msg:done", Some("sess-1"), "exited", json!(2.0));

        let summary = advance_headless_run_records(&engine.db, "sess-1", "inc-1", 3, 42.0).unwrap();
        assert_eq!(summary, AdvanceSummary::default());

        assert_eq!(
            read_payload(&engine, "automation_runs", "ar:done")["status"],
            "completed"
        );
        assert_eq!(
            read_payload(&engine, "automation_runs", "ar:other-inc")["status"],
            "dispatched"
        );
        assert_eq!(
            read_payload(&engine, "automation_runs", "ar:bare")["status"],
            "dispatched"
        );
        assert_eq!(
            read_payload(&engine, "bot_responsibility_runs", "rr:done")["hostObservation"],
            "exited"
        );
        assert_eq!(
            read_payload(&engine, "bot_responsibility_runs", "rr:bare")["hostObservation"],
            "live"
        );
    }
}

#[cfg(all(test, unix))]
mod session_start_cwd_tests {
    use super::*;
    use serde_json::json;

    fn open_engine() -> (tempfile::TempDir, crate::Engine) {
        let dir = tempfile::tempdir().unwrap();
        let engine = crate::Engine::open(dir.path()).unwrap();
        (dir, engine)
    }

    fn invoke(engine: &crate::Engine, id: &str, method: &str, params: Value) -> Value {
        let response = engine.dispatch(crate::Request {
            protocol: crate::PROTOCOL_VERSION,
            request_id: id.into(),
            auth: None,
            method: method.into(),
            params,
        });
        assert!(response.ok, "{method} failed: {:?}", response.error);
        response.result.unwrap()
    }

    fn workspace_with_subdir() -> (tempfile::TempDir, crate::Engine, String, String) {
        let (dir, engine) = open_engine();
        let workspace = invoke(
            &engine,
            "w",
            "workspace.register",
            json!({ "path": dir.path() }),
        );
        let workspace_id = workspace["id"].as_str().unwrap().to_string();
        let subdir = dir.path().join("src");
        std::fs::create_dir(&subdir).unwrap();
        (
            dir,
            engine,
            workspace_id,
            subdir.to_string_lossy().into_owned(),
        )
    }

    fn start(engine: &crate::Engine, params: Value) -> crate::Response {
        engine.dispatch(crate::Request {
            protocol: crate::PROTOCOL_VERSION,
            request_id: "s".into(),
            auth: None,
            method: "session.start".into(),
            params,
        })
    }

    /// Reads the retained ring until output appears (bounded), returning
    /// the decoded text.
    fn read_output(engine: &crate::Engine, session_id: &str, incarnation: &str) -> String {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let response = engine.dispatch(crate::Request {
                protocol: crate::PROTOCOL_VERSION,
                request_id: "r".into(),
                auth: None,
                method: "session.read".into(),
                params: json!({
                    "sessionId": session_id,
                    "incarnation": incarnation,
                    "cursor": 0
                }),
            });
            let result = response.result.expect("session.read ok");
            let data = result["dataBase64"].as_str().unwrap_or("");
            let text = base64_decode(data).expect("valid base64 from session.read");
            if !text.is_empty() {
                return String::from_utf8_lossy(&text).into_owned();
            }
            assert!(Instant::now() < deadline, "no PTY output observed");
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    #[test]
    fn explicit_cwd_spawn_the_session_in_the_row_directory() {
        let (_dir, engine, workspace_id, subdir) = workspace_with_subdir();
        let session = invoke(
            &engine,
            "s",
            "session.start",
            json!({
                "workspaceId": workspace_id,
                "command": "/bin/pwd",
                "args": [],
                "cwd": subdir,
            }),
        );
        let output = read_output(
            &engine,
            session["id"].as_str().unwrap(),
            session["incarnation"].as_str().unwrap(),
        );
        // macOS canonicalizes /var -> /private/var; the spawn cwd is the
        // canonical form, so compare against that.
        let canonical = std::fs::canonicalize(&subdir).unwrap();
        assert!(
            output.trim_end() == canonical.to_string_lossy(),
            "pwd output {output:?} should be the row directory {canonical:?}"
        );
    }

    #[test]
    fn absent_cwd_keeps_the_workspace_root_spawn() {
        let (dir, engine, workspace_id, _subdir) = workspace_with_subdir();
        let session = invoke(
            &engine,
            "s",
            "session.start",
            json!({
                "workspaceId": workspace_id,
                "command": "/bin/pwd",
                "args": [],
            }),
        );
        let output = read_output(
            &engine,
            session["id"].as_str().unwrap(),
            session["incarnation"].as_str().unwrap(),
        );
        let root = std::fs::canonicalize(dir.path()).unwrap();
        assert!(
            output.trim_end() == root.to_string_lossy(),
            "pwd output {output:?} should be the workspace root {root:?}"
        );
    }

    #[test]
    fn cwd_outside_the_workspace_root_is_refused() {
        let (_dir, engine, workspace_id, _subdir) = workspace_with_subdir();
        let outside = tempfile::tempdir().unwrap();
        let response = start(
            &engine,
            json!({
                "workspaceId": workspace_id,
                "command": "/bin/pwd",
                "args": [],
                "cwd": outside.path(),
            }),
        );
        assert!(!response.ok, "outside-root cwd must not spawn");
        let message = response.error.unwrap().message;
        assert!(message.contains("workspace root"), "{message}");
    }

    #[test]
    fn nonexistent_or_relative_cwd_is_refused() {
        let (_dir, engine, workspace_id, subdir) = workspace_with_subdir();
        let missing = start(
            &engine,
            json!({
                "workspaceId": workspace_id,
                "cwd": format!("{subdir}/nope"),
            }),
        );
        assert!(!missing.ok, "nonexistent cwd must not spawn");
        let relative = start(
            &engine,
            json!({ "workspaceId": workspace_id, "cwd": "src" }),
        );
        assert!(!relative.ok, "relative cwd must not spawn");
    }
}

#[cfg(all(test, unix))]
mod wait_signal_activity_tests {
    use super::*;
    use serde_json::json;

    fn started_handle() -> (tempfile::TempDir, crate::Engine, Arc<SessionHandle>) {
        let dir = tempfile::tempdir().unwrap();
        let engine = crate::Engine::open(dir.path()).unwrap();
        let invoke = |id: &str, method: &str, params: Value| {
            let response = engine.dispatch(crate::Request {
                protocol: crate::PROTOCOL_VERSION,
                request_id: id.into(),
                auth: None,
                method: method.into(),
                params,
            });
            assert!(response.ok, "{:?}", response.error);
            response.result.unwrap()
        };
        let workspace = invoke("w", "workspace.register", json!({ "path": dir.path() }));
        let session = invoke(
            "s",
            "session.start",
            json!({
                "workspaceId": workspace["id"],
                "command": "/bin/sh",
                "args": ["-c", "exec sleep 30"],
            }),
        );
        let handle = engine.sessions.lock().unwrap()[session["id"].as_str().unwrap()].clone();
        (dir, engine, handle)
    }

    /// The reader thread calls the activity clear on every PTY chunk. A
    /// noisy session pushes thousands of chunks per second, so only the
    /// `Some → None` transition may write the durable row; an unconditional
    /// UPDATE per chunk made one 2.5 MB/s session burn ~40% of daemon CPU.
    #[test]
    fn activity_clear_persists_only_on_transition() {
        let (_dir, _engine, handle) = started_handle();
        // No signal set: clearing is a no-op.
        assert!(!clear_wait_signal_on_activity(&handle));
        handle.note_hook_event();
        assert!(handle.needs_input_at.lock().unwrap().is_some());
        // First activity clear transitions and persists NULL.
        assert!(clear_wait_signal_on_activity(&handle));
        assert!(handle.needs_input_at.lock().unwrap().is_none());
        // Subsequent chunk clears (a noisy session pushes thousands per
        // second) must be free: no transition, durable row stays NULL.
        for _ in 0..1000 {
            assert!(!clear_wait_signal_on_activity(&handle));
        }
        let conn = handle.db.lock().unwrap();
        let stamp: Option<String> = conn
            .query_row(
                "SELECT needs_input_at FROM sessions WHERE id = ?1",
                [&handle.session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stamp, None);
    }

    /// #358 fork parity (Orca's row status is hook-driven, never
    /// output-driven): for `explicit_wait_clear` sessions a resumption
    /// hook's turn reports `working` on its own — no PTY output required —
    /// and a later wait hook reports `needs_input` again, with the user's
    /// own echo never manufacturing a spinner in between.
    #[test]
    fn hook_turn_drives_working_for_explicit_wait_clear_sessions() {
        let (_dir, _engine, handle) = started_handle();
        handle.set_explicit_wait_clear();
        // No hook event yet: nothing hook-authoritative to report, so the
        // activity fallback still rules (sleep produced no output).
        assert_eq!(snapshot(&handle)["agentState"], "unknown");
        assert_eq!(handle.hook_turn_fact(), agent_state::HookTurn::Inactive);
        // The resumption hook opens the turn: working with zero PTY output.
        handle.clear_hook_event();
        assert_eq!(handle.hook_turn_fact(), agent_state::HookTurn::Active);
        assert_eq!(snapshot(&handle)["agentState"], "working");
        // The wait hook hands the session back to the user.
        handle.note_hook_event();
        assert_eq!(handle.hook_turn_fact(), agent_state::HookTurn::Inactive);
        assert_eq!(snapshot(&handle)["agentState"], "needs_input");
        // Kernel echo of the user's own keystroke (the tty is in canonical
        // mode; `sleep` never reads it) neither clears the wait nor
        // manufactures working — it is not hook evidence.
        crate::session::write(&handle, b"x").unwrap();
        assert_eq!(snapshot(&handle)["agentState"], "needs_input");
    }

    /// #360 fork parity: a turn-end hook (Pi AgentEnd, OpenCode
    /// SessionIdle, Claude/Codex Stop — the reference maps each to `done`)
    /// clears a wait signal AND closes the turn, so the row reads `idle`
    /// on the harness's own authority; the user's echo at the idle prompt
    /// does not spin it back to `working`, and the next resumption hook
    /// opens a new turn.
    #[test]
    fn turn_end_hook_reads_idle_and_survives_echo() {
        let (_dir, _engine, handle) = started_handle();
        handle.set_explicit_wait_clear();
        handle.note_hook_event();
        assert_eq!(snapshot(&handle)["agentState"], "needs_input");
        handle.end_hook_event();
        assert_eq!(handle.hook_turn_fact(), agent_state::HookTurn::Ended);
        assert_eq!(snapshot(&handle)["agentState"], "idle");
        // The user's echo at the idle prompt is not hook evidence.
        crate::session::write(&handle, b"x").unwrap();
        assert_eq!(snapshot(&handle)["agentState"], "idle");
        // A new turn reopens the hook lifecycle.
        handle.clear_hook_event();
        assert_eq!(handle.hook_turn_fact(), agent_state::HookTurn::Active);
        assert_eq!(snapshot(&handle)["agentState"], "working");
    }

    /// Sessions without a hook lifecycle (plain shells, Claude) keep the
    /// purely activity-based derivation: no turn fact ever accumulates,
    /// and the generic activity clear stays the only wait-release path.
    #[test]
    fn untracked_sessions_never_accumulate_a_hook_turn() {
        let (_dir, _engine, handle) = started_handle();
        handle.note_hook_event();
        assert_eq!(snapshot(&handle)["agentState"], "needs_input");
        assert!(clear_wait_signal_on_activity(&handle));
        assert_eq!(handle.hook_turn_fact(), agent_state::HookTurn::Inactive);
        // No output was ever observed: unknown, not a guessed idle.
        assert_eq!(snapshot(&handle)["agentState"], "unknown");
    }
}
