//! Live service handoff: a replacement `drogond` takes over the running
//! service's PTY sessions instead of the update stopping them.
//!
//! The predecessor parks every session's reader between reads
//! ([`ReaderGate`]), so no output byte is consumed after its ring is
//! captured, then sends each PTY master descriptor plus the session's
//! in-memory state ([`HandoffSession`]) to the successor. The child keeps
//! running on the same PTY throughout: nothing is signalled, respawned or
//! re-attached, and the session keeps its id, incarnation and ring cursors.
//!
//! What the successor cannot inherit is parenthood. The child stays the
//! predecessor's (then init's) to reap, so an adopted child is owned
//! through the descriptor it holds plus a verified process identity — pid
//! and kernel start time — never a pid alone ([`AdoptedChild`]). Its exit
//! is observed as the process disappearing; the exit code is the one the
//! predecessor recorded if it reaped the child first, and otherwise
//! honestly unknown.
//!
//! The transport (the handoff socket, descriptor passing, and the ordering
//! that lets the predecessor resume if the successor never confirms) lives
//! in `drogond`; this module is the engine half.

use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use drogon_protocol::RpcError;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error;
use crate::session::SessionHandle;

/// Version of [`HandoffPackage`]. A successor refuses a package it does not
/// understand before touching a single descriptor.
pub const HANDOFF_FORMAT: u32 = 1;

/// Status capability advertised by services that can hand their sessions
/// over (`runtime.handoff`). Absent on platforms without descriptor passing.
pub const HANDOFF_CAPABILITY: &str = "runtime.session-handoff.v1";

/// How long a handoff waits for every reader to park before giving up and
/// resuming them. Readers wake at least every [`READ_READINESS_POLL`].
const PARK_DEADLINE: Duration = Duration::from_secs(3);

/// Upper bound on how long a reader sits in `poll` before rechecking its
/// gate. Output wakes it immediately; this only bounds handoff latency.
const READ_READINESS_POLL: Duration = Duration::from_millis(100);

/// Pause point a session's reader thread checks between reads.
#[derive(Default)]
pub(crate) struct ReaderGate {
    state: Mutex<GateState>,
    changed: Condvar,
}

#[derive(Default)]
struct GateState {
    requested: bool,
    parked: bool,
    released: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Park {
    Run,
    /// The successor owns the PTY; the reader must stop without reading.
    Released,
}

impl ReaderGate {
    /// Called by the reader between reads. Blocks while a handoff holds
    /// the session.
    pub(crate) fn park_if_requested(&self) -> Park {
        let mut state = self.state.lock().unwrap();
        if state.released {
            return Park::Released;
        }
        if !state.requested {
            return Park::Run;
        }
        state.parked = true;
        self.changed.notify_all();
        while state.requested && !state.released {
            state = self.changed.wait(state).unwrap();
        }
        state.parked = false;
        self.changed.notify_all();
        if state.released {
            Park::Released
        } else {
            Park::Run
        }
    }

    fn request(&self) {
        self.state.lock().unwrap().requested = true;
    }

    fn is_parked(&self) -> bool {
        self.state.lock().unwrap().parked
    }

    fn wait_parked(&self, timeout: Duration) -> bool {
        let state = self.state.lock().unwrap();
        let (state, _) = self
            .changed
            .wait_timeout_while(state, timeout, |state| !state.parked)
            .unwrap();
        state.parked
    }

    fn resume(&self) {
        let mut state = self.state.lock().unwrap();
        state.requested = false;
        self.changed.notify_all();
    }

    fn release(&self) {
        let mut state = self.state.lock().unwrap();
        state.released = true;
        self.changed.notify_all();
    }
}

/// Waits (bounded) until `fd` has something to read — output, EOF or an
/// error, all of which the following `read` reports. `false` means "check
/// the gate again first".
#[cfg(unix)]
pub(crate) fn wait_readable(fd: std::os::unix::io::RawFd) -> bool {
    let mut poll = libc::pollfd {
        fd,
        events: libc::POLLIN,
        revents: 0,
    };
    let timeout = READ_READINESS_POLL.as_millis() as libc::c_int;
    // SAFETY: one valid pollfd for the duration of the call.
    let ready = unsafe { libc::poll(&mut poll, 1, timeout) };
    if ready < 0 {
        // EINTR: recheck the gate. Anything else is the descriptor's own
        // failure, which the read reports.
        return std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted;
    }
    ready > 0
}

/// One grid the PTY has held, with the ring offset it took effect at.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct HandoffGrid {
    pub(crate) cursor: u64,
    pub(crate) cols: u16,
    pub(crate) rows: u16,
}

/// Everything a successor needs to continue one session exactly. The
/// descriptor travels beside it, in the same order as the package list.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HandoffSession {
    pub(crate) session_id: String,
    pub(crate) incarnation: String,
    pub(crate) workspace_id: String,
    pub(crate) cwd: String,
    pub(crate) host_id: String,
    pub(crate) command: String,
    pub(crate) args: Vec<String>,
    pub(crate) harness_id: Option<String>,
    pub(crate) parent_session_id: Option<String>,
    pub(crate) caused_by_event_id: Option<String>,
    pub(crate) created_at: String,
    pub(crate) pid: u32,
    /// Kernel start time of `pid`, in [`probe`]'s spelling.
    pub(crate) process_start: String,
    pub(crate) tty_name: Option<std::path::PathBuf>,
    pub(crate) ring_start: u64,
    #[serde(with = "base64_bytes")]
    pub(crate) ring: Vec<u8>,
    pub(crate) grids: Vec<HandoffGrid>,
    pub(crate) last_activity_age_ms: Option<u64>,
    pub(crate) last_activity_at: Option<String>,
    pub(crate) needs_input_at: Option<String>,
    pub(crate) hook_transition_age_ms: Option<u64>,
    pub(crate) hook_transition_at: Option<String>,
    pub(crate) agent_prompt_preview: Option<String>,
    pub(crate) cache_idle_at: Option<String>,
    pub(crate) agent_session_id: Option<String>,
    pub(crate) agent_session_transcript_path: Option<String>,
    pub(crate) hook_cleanup_paths: Vec<std::path::PathBuf>,
    pub(crate) suspended_hook_files: Vec<(std::path::PathBuf, Vec<u8>)>,
    pub(crate) explicit_wait_clear: bool,
    pub(crate) turn_fact: u8,
    pub(crate) headless: bool,
    pub(crate) paste_is_text: bool,
    pub(crate) bracketed_paste: bool,
    pub(crate) alternate_screen: bool,
    pub(crate) pending_mode_bytes: Vec<u8>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HandoffPackage {
    format: u32,
    host_id: String,
    from_service_instance_id: String,
    sessions: Vec<HandoffSession>,
}

mod base64_bytes {
    use serde::{Deserialize, Deserializer, Serializer};

    pub(super) fn serialize<S: Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&crate::session::base64_encode(bytes))
    }

    pub(super) fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<u8>, D::Error> {
        let text = String::deserialize(deserializer)?;
        crate::session::base64_decode(&text).map_err(|e| serde::de::Error::custom(e.message))
    }
}

/// The frozen sessions of a handoff in progress on the predecessor.
#[derive(Default)]
pub(crate) struct HandoffState {
    frozen: Mutex<Option<Vec<Arc<SessionHandle>>>>,
}

/// What the predecessor sends: the serialized package and, in the same
/// order, each session's PTY master. The descriptors stay owned by the
/// sessions; the transport duplicates them into the message.
#[cfg(unix)]
pub struct OutgoingHandoff {
    pub package: Vec<u8>,
    pub fds: Vec<std::os::unix::io::RawFd>,
    pub session_ids: Vec<String>,
}

/// A handoff as the successor received it, before it opens its engine.
#[cfg(unix)]
pub struct IncomingHandoff {
    package: HandoffPackage,
    fds: Vec<std::os::fd::OwnedFd>,
}

/// What adoption did with each handed-over session.
#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptionReport {
    /// Sessions now served by this process, still running.
    pub adopted: Vec<String>,
    /// Sessions whose process was already gone by the time it arrived
    /// (their row says `exited`, with the code if the predecessor reaped it).
    pub exited: Vec<String>,
    /// Sessions whose durable row no longer names the handed-over
    /// incarnation (forgotten or replaced); their descriptor was closed.
    pub skipped: Vec<String>,
}

#[cfg(unix)]
impl IncomingHandoff {
    /// Parses a received package. Refuses a mismatched descriptor count or
    /// an unknown format before anything is adopted.
    pub fn parse(package: &[u8], fds: Vec<std::os::fd::OwnedFd>) -> Result<Self, RpcError> {
        let package: HandoffPackage = serde_json::from_slice(package)
            .map_err(|e| error::invalid_argument(format!("unreadable handoff package: {e}")))?;
        if package.format != HANDOFF_FORMAT {
            return Err(error::invalid_argument(format!(
                "handoff package format {} is not {HANDOFF_FORMAT}",
                package.format
            )));
        }
        if package.sessions.len() != fds.len() {
            return Err(error::invalid_argument(format!(
                "handoff carried {} descriptors for {} sessions",
                fds.len(),
                package.sessions.len()
            )));
        }
        Ok(Self { package, fds })
    }

    /// The `(session id, incarnation)` pairs whose processes are provably
    /// the ones that were handed over and still running. `Engine::open`
    /// keeps exactly these live through startup recovery.
    pub fn verified_live(&self) -> Vec<(String, String)> {
        self.package
            .sessions
            .iter()
            .filter(|state| is_same_live_process(state.pid, &state.process_start))
            .map(|state| (state.session_id.clone(), state.incarnation.clone()))
            .collect()
    }

    pub fn session_count(&self) -> usize {
        self.package.sessions.len()
    }

    pub fn from_service_instance_id(&self) -> &str {
        &self.package.from_service_instance_id
    }
}

impl crate::Engine {
    /// `runtime.handoff`: freezes admission and parks every live session's
    /// reader so its state can be captured whole. The caller has already
    /// validated the fences. Refuses — leaving the service untouched — when
    /// work that cannot move with a PTY is running.
    pub(crate) fn do_runtime_handoff(&self) -> Result<serde_json::Value, RpcError> {
        // A platform that cannot pass descriptors answers exactly like a
        // service predating handoff, so callers keep one fallback.
        if !supported() {
            return Err(error::method_not_found("runtime.handoff"));
        }
        let Ok(_gate) = self.lifecycle_gate.try_write() else {
            return Err(error::runtime_busy(
                "a session or harness admission is currently in flight",
            ));
        };
        {
            let conn = self.db.lock().unwrap();
            let running: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM mentu_runs WHERE status = 'running'",
                    [],
                    |row| row.get(0),
                )
                .map_err(error::from_sqlite)?;
            if running > 0 {
                return Err(error::runtime_busy(
                    "a Mentu recipe run is in flight; it cannot move to another service",
                ));
            }
        }
        let mut frozen_slot = self.handoff.frozen.lock().unwrap();
        if frozen_slot.is_some() || self.quiescent.load(std::sync::atomic::Ordering::Acquire) {
            return Err(error::runtime_busy("this service is already stopping"));
        }
        let handles: Vec<Arc<SessionHandle>> =
            self.sessions.lock().unwrap().values().cloned().collect();
        for handle in &handles {
            handle.handoff.request();
        }
        let deadline = Instant::now() + PARK_DEADLINE;
        let mut frozen = Vec::new();
        for handle in handles {
            // A reader that already hit EOF never parks again; its session
            // is ending and stays with this process's exit observer.
            loop {
                if handle.handoff.is_parked() {
                    frozen.push(handle);
                    break;
                }
                if handle.reader_finished() {
                    break;
                }
                let now = Instant::now();
                if now >= deadline {
                    for handle in self.sessions.lock().unwrap().values() {
                        handle.handoff.resume();
                    }
                    return Err(error::runtime_busy(format!(
                        "session {} did not pause for the handoff; nothing was changed",
                        handle.session_id
                    )));
                }
                handle
                    .handoff
                    .wait_parked((deadline - now).min(Duration::from_millis(50)));
            }
        }
        let sessions = frozen.len();
        *frozen_slot = Some(frozen);
        self.quiescent
            .store(true, std::sync::atomic::Ordering::Release);
        Ok(serde_json::json!({
            "hostId": self.host_id,
            "serviceInstanceId": self.service_instance_id,
            "accepted": true,
            "sessions": sessions,
        }))
    }

    /// Whether an accepted `runtime.handoff` is waiting for its successor.
    pub fn handoff_requested(&self) -> bool {
        self.handoff.frozen.lock().unwrap().is_some()
    }

    /// Captures the parked sessions for the successor. Sessions whose child
    /// exited while parked are left out (this process still reaps them).
    #[cfg(unix)]
    pub fn handoff_outgoing(&self) -> Result<OutgoingHandoff, RpcError> {
        let frozen = self.handoff.frozen.lock().unwrap();
        let Some(frozen) = frozen.as_ref() else {
            return Err(error::invalid_argument("no handoff was accepted"));
        };
        let mut sessions = Vec::new();
        let mut fds = Vec::new();
        let mut session_ids = Vec::new();
        for handle in frozen {
            let (Some(state), Some(fd)) = (handle.handoff_state(), handle.master_fd()) else {
                continue;
            };
            session_ids.push(state.session_id.clone());
            sessions.push(state);
            fds.push(fd);
        }
        let package = serde_json::to_vec(&HandoffPackage {
            format: HANDOFF_FORMAT,
            host_id: self.host_id.clone(),
            from_service_instance_id: self.service_instance_id.clone(),
            sessions,
        })
        .map_err(|e| error::internal_error(format!("cannot encode handoff package: {e}")))?;
        Ok(OutgoingHandoff {
            package,
            fds,
            session_ids,
        })
    }

    /// The successor never confirmed: take the sessions back. Readers
    /// resume where they paused, admission reopens, and rows a failed
    /// successor's startup recovery demoted are live again, because this
    /// process still holds their children.
    pub fn resume_after_handoff(&self) {
        let Some(frozen) = self.handoff.frozen.lock().unwrap().take() else {
            return;
        };
        let conn = self.db.lock().unwrap();
        for handle in self.sessions.lock().unwrap().values() {
            if !handle.is_exited() {
                let _ = conn.execute(
                    "UPDATE sessions SET verdict = 'live' \
                     WHERE id = ?1 AND incarnation = ?2 AND verdict = 'unverifiable'",
                    rusqlite::params![handle.session_id, handle.incarnation],
                );
            }
        }
        drop(conn);
        for handle in frozen {
            handle.handoff.resume();
        }
        self.quiescent
            .store(false, std::sync::atomic::Ordering::Release);
    }

    /// The successor confirmed it serves the sessions: stop every parked
    /// reader for good without reading. Production exits the process right
    /// after instead of calling this; it exists so an in-process successor
    /// (tests) never races a predecessor reader for the same bytes.
    pub fn release_after_handoff(&self) {
        if let Some(frozen) = self.handoff.frozen.lock().unwrap().as_ref() {
            for handle in frozen {
                handle.handoff.release();
            }
        }
    }

    /// Takes over the sessions of `incoming` on this freshly opened engine
    /// (opened with [`crate::Engine::open_adopting`] over
    /// [`IncomingHandoff::verified_live`]). Each process is re-verified
    /// right before its handle is built.
    #[cfg(unix)]
    pub fn adopt_handoff(&self, incoming: IncomingHandoff) -> AdoptionReport {
        let mut report = AdoptionReport::default();
        let IncomingHandoff { package, fds } = incoming;
        for (state, fd) in package.sessions.into_iter().zip(fds) {
            let session_id = state.session_id.clone();
            let row: Option<(String, String)> = self
                .db
                .lock()
                .unwrap()
                .query_row(
                    "SELECT verdict, incarnation FROM sessions WHERE id = ?1",
                    [&session_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .ok()
                .flatten();
            let Some((verdict, incarnation)) = row else {
                report.skipped.push(session_id);
                continue;
            };
            if incarnation != state.incarnation {
                report.skipped.push(session_id);
                continue;
            }
            if verdict == "exited" {
                // The predecessor reaped it in transit and recorded the code.
                report.exited.push(session_id);
                continue;
            }
            if !is_same_live_process(state.pid, &state.process_start) {
                // Positively gone: the process that was handed over no
                // longer exists. Keep a code the predecessor recorded.
                let _ = self.db.lock().unwrap().execute(
                    "UPDATE sessions SET verdict = 'exited', needs_input_at = NULL \
                     WHERE id = ?1 AND incarnation = ?2 AND verdict != 'exited'",
                    rusqlite::params![session_id, state.incarnation],
                );
                report.exited.push(session_id);
                continue;
            }
            match adopt_one(self, state, fd) {
                Ok(()) => report.adopted.push(session_id),
                Err(err) => {
                    crate::diagnostics::log_line(format_args!(
                        "handoff: session {session_id} could not be adopted: {}",
                        err.message
                    ));
                    report.skipped.push(session_id);
                }
            }
        }
        report
    }
}

#[cfg(unix)]
fn adopt_one(
    engine: &crate::Engine,
    state: HandoffSession,
    fd: std::os::fd::OwnedFd,
) -> Result<(), RpcError> {
    use std::os::fd::AsFd;
    let dup = |what: &str| {
        fd.as_fd()
            .try_clone_to_owned()
            .map(std::fs::File::from)
            .map_err(|e| error::io_error(format!("cannot duplicate adopted pty {what}: {e}")))
    };
    let reader = dup("reader")?;
    let writer = dup("writer")?;
    let grid = state.grids.last().cloned().unwrap_or(HandoffGrid {
        cursor: 0,
        cols: 80,
        rows: 24,
    });
    let handle = SessionHandle::assemble(
        state.session_id.clone(),
        state.incarnation.clone(),
        state.workspace_id.clone(),
        state.cwd.clone(),
        state.host_id.clone(),
        state.command.clone(),
        state.args.clone(),
        state.harness_id.clone(),
        state.parent_session_id.clone(),
        state.caused_by_event_id.clone(),
        state.created_at.clone(),
        grid.cols,
        grid.rows,
        crate::session::PtyMaster::Adopted(AdoptedMaster {
            fd,
            tty_name: state.tty_name.clone(),
        }),
        Box::new(writer),
        Box::new(AdoptedChild {
            pid: state.pid,
            start: state.process_start.clone(),
        }),
        engine.db.clone(),
    );
    let session_id = state.session_id.clone();
    handle.restore_handoff_state(state);
    engine
        .sessions
        .lock()
        .unwrap()
        .insert(session_id, handle.clone());
    crate::session::spawn_reader_thread(handle, Box::new(reader));
    Ok(())
}

/// Whether a session's child is an adopted one, and if so whether it has
/// ended. Takes no lock beyond the child's and the database's, one at a
/// time (see `session::try_reap`).
#[cfg(unix)]
pub(crate) enum AdoptedExit {
    NotAdopted,
    Running,
    Exited(Option<i64>),
}

#[cfg(unix)]
pub(crate) fn observe_adopted_exit(handle: &SessionHandle) -> AdoptedExit {
    let exited = {
        let guard = handle.child_for_reap();
        // `impl_downcast!` gives the bare trait object its `downcast_ref`.
        let child: &dyn portable_pty::Child = &**guard;
        match child.downcast_ref::<AdoptedChild>() {
            None => return AdoptedExit::NotAdopted,
            Some(adopted) => adopted.has_exited(),
        }
    };
    if !exited {
        return AdoptedExit::Running;
    }
    AdoptedExit::Exited(recorded_exit_code(&handle.db, &handle.session_id))
}

/// The exit code a previous owner durably recorded for this session, if it
/// reaped the child before this process noticed it was gone.
pub(crate) fn recorded_exit_code(db: &Arc<Mutex<Connection>>, session_id: &str) -> Option<i64> {
    db.lock()
        .unwrap()
        .query_row(
            "SELECT exit_code FROM sessions WHERE id = ?1 AND verdict = 'exited'",
            [session_id],
            |row| row.get::<_, Option<i64>>(0),
        )
        .optional()
        .ok()
        .flatten()
        .flatten()
}

/// What the kernel says about a pid right now.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ProcessProbe {
    /// The pid names a process; `start` identifies which one.
    Alive { start: String, zombie: bool },
    /// No process has this pid.
    Gone,
    /// The kernel would not say (loss of contact never proves exit).
    Unknown,
}

/// True only when `pid` is still exactly the process that was handed over
/// and has not exited. A reused pid or a zombie is not.
fn is_same_live_process(pid: u32, start: &str) -> bool {
    matches!(probe(pid), ProcessProbe::Alive { start: now, zombie: false } if now == start)
}

/// macOS: `sysctl(KERN_PROC_PID)`, the one query that still answers for a
/// zombie (`proc_pidinfo` reports a zombie as missing). `libc` does not
/// model `struct kinfo_proc`, so the three fields read here are taken at
/// their fixed offsets in the 64-bit `extern_proc` it begins with:
/// `p_starttime` (a `timeval`) at 0 and `p_stat` at 36.
#[cfg(target_os = "macos")]
pub(crate) fn probe(pid: u32) -> ProcessProbe {
    const KINFO_PROC_SIZE: usize = 648;
    const P_STAT_OFFSET: usize = 36;
    let mut buffer = [0u64; KINFO_PROC_SIZE / 8];
    let mut len = KINFO_PROC_SIZE;
    let mut mib = [
        libc::CTL_KERN,
        libc::KERN_PROC,
        libc::KERN_PROC_PID,
        pid as libc::c_int,
    ];
    // SAFETY: `buffer` is a live, 8-aligned `len`-byte region.
    let rc = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            mib.len() as libc::c_uint,
            buffer.as_mut_ptr().cast(),
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    if rc != 0 {
        return ProcessProbe::Unknown;
    }
    if len == 0 {
        // The kernel answers a free pid with an empty result.
        return ProcessProbe::Gone;
    }
    if len != KINFO_PROC_SIZE {
        return ProcessProbe::Unknown;
    }
    let bytes: &[u8; KINFO_PROC_SIZE] = unsafe { &*buffer.as_ptr().cast() };
    let seconds = i64::from_ne_bytes(bytes[0..8].try_into().unwrap());
    let micros = i32::from_ne_bytes(bytes[8..12].try_into().unwrap());
    ProcessProbe::Alive {
        start: format!("{seconds}.{micros:06}"),
        zombie: bytes[P_STAT_OFFSET] == libc::SZOMB as u8,
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn probe(pid: u32) -> ProcessProbe {
    let stat = match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        Ok(stat) => stat,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return ProcessProbe::Gone,
        Err(_) => return ProcessProbe::Unknown,
    };
    // `pid (comm) state ppid ...`: comm may hold spaces or parens, so split
    // after its last `)`. starttime is field 22, the 20th after comm.
    let Some((_, rest)) = stat.rsplit_once(')') else {
        return ProcessProbe::Unknown;
    };
    let fields: Vec<&str> = rest.split_whitespace().collect();
    match (fields.first(), fields.get(19)) {
        (Some(state), Some(start)) => ProcessProbe::Alive {
            start: (*start).to_string(),
            zombie: *state == "Z" || *state == "X",
        },
        _ => ProcessProbe::Unknown,
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) fn probe(_pid: u32) -> ProcessProbe {
    ProcessProbe::Unknown
}

/// Whether this build can take part in a handoff at all.
pub(crate) fn supported() -> bool {
    cfg!(any(target_os = "macos", target_os = "linux"))
}

/// A child another service instance spawned. Owned through its verified
/// identity; see the module doc for why it is never reaped here.
#[cfg(unix)]
#[derive(Debug)]
pub(crate) struct AdoptedChild {
    pid: u32,
    start: String,
}

#[cfg(unix)]
impl AdoptedChild {
    /// Positive evidence that the adopted process ended: its pid is free,
    /// names a different process, or is a zombie awaiting its parent.
    pub(crate) fn has_exited(&self) -> bool {
        match probe(self.pid) {
            ProcessProbe::Gone => true,
            ProcessProbe::Alive { start, zombie } => zombie || start != self.start,
            ProcessProbe::Unknown => false,
        }
    }
}

#[cfg(unix)]
/// SIGHUP, a short grace, then SIGKILL — the same sequence the PTY crate
/// uses for children it spawned — each signal sent only after re-proving
/// the pid still names the adopted process.
fn kill_verified(pid: u32, start: &str) -> std::io::Result<()> {
    let signal = |signo: libc::c_int| -> std::io::Result<()> {
        if !is_same_live_process(pid, start) {
            return Ok(());
        }
        // SAFETY: plain kill(2) on a pid just re-verified as the adopted child.
        if unsafe { libc::kill(pid as libc::pid_t, signo) } != 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::ESRCH) {
                return Err(error);
            }
        }
        Ok(())
    };
    signal(libc::SIGHUP)?;
    for attempt in 0..5 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_millis(50));
        }
        if !is_same_live_process(pid, start) {
            return Ok(());
        }
    }
    signal(libc::SIGKILL)
}

#[cfg(unix)]
impl portable_pty::ChildKiller for AdoptedChild {
    fn kill(&mut self) -> std::io::Result<()> {
        kill_verified(self.pid, &self.start)
    }

    fn clone_killer(&self) -> Box<dyn portable_pty::ChildKiller + Send + Sync> {
        Box::new(AdoptedChild {
            pid: self.pid,
            start: self.start.clone(),
        })
    }
}

#[cfg(unix)]
impl portable_pty::Child for AdoptedChild {
    /// Only [`AdoptedChild::has_exited`] is meaningful: this process is not
    /// the parent, so there is no status to collect. `try_reap` asks that
    /// directly; this answers "still running" or says why it cannot say more.
    fn try_wait(&mut self) -> std::io::Result<Option<portable_pty::ExitStatus>> {
        if self.has_exited() {
            Err(std::io::Error::other(
                "an adopted child's exit status belongs to the service that spawned it",
            ))
        } else {
            Ok(None)
        }
    }

    fn wait(&mut self) -> std::io::Result<portable_pty::ExitStatus> {
        while !self.has_exited() {
            std::thread::sleep(Duration::from_millis(50));
        }
        Err(std::io::Error::other(
            "an adopted child's exit status belongs to the service that spawned it",
        ))
    }

    fn process_id(&self) -> Option<u32> {
        Some(self.pid)
    }
}

/// A PTY master received from the predecessor.
#[cfg(unix)]
pub(crate) struct AdoptedMaster {
    fd: std::os::fd::OwnedFd,
    tty_name: Option<std::path::PathBuf>,
}

#[cfg(unix)]
impl AdoptedMaster {
    pub(crate) fn resize(&self, cols: u16, rows: u16) -> std::io::Result<()> {
        use std::os::fd::AsRawFd;
        let size = libc::winsize {
            ws_row: rows,
            ws_col: cols,
            ws_xpixel: 0,
            ws_ypixel: 0,
        };
        // SAFETY: TIOCSWINSZ reads one winsize from a live local.
        if unsafe { libc::ioctl(self.fd.as_raw_fd(), libc::TIOCSWINSZ, &size) } != 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }

    pub(crate) fn raw_fd(&self) -> std::os::unix::io::RawFd {
        use std::os::fd::AsRawFd;
        self.fd.as_raw_fd()
    }

    pub(crate) fn process_group_leader(&self) -> Option<i32> {
        // SAFETY: tcgetpgrp only reads the terminal's foreground group.
        let pgid = unsafe { libc::tcgetpgrp(self.raw_fd()) };
        (pgid > 0).then_some(pgid)
    }

    pub(crate) fn tty_name(&self) -> Option<std::path::PathBuf> {
        self.tty_name.clone()
    }
}

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
mod tests {
    use std::os::fd::{FromRawFd, OwnedFd};
    use std::time::{Duration, Instant};

    use serde_json::{Value, json};

    use super::*;
    use crate::Engine;

    fn call(engine: &Engine, method: &str, params: Value) -> Result<Value, RpcError> {
        let response = engine.dispatch(crate::Request {
            protocol: crate::PROTOCOL_VERSION,
            request_id: uuid::Uuid::new_v4().to_string(),
            auth: None,
            method: method.into(),
            params,
        });
        match response.ok {
            true => Ok(response.result.unwrap()),
            false => Err(response.error.unwrap()),
        }
    }

    fn ok(engine: &Engine, method: &str, params: Value) -> Value {
        call(engine, method, params).unwrap_or_else(|e| panic!("{method} failed: {e:?}"))
    }

    fn start_shell(engine: &Engine, workspace_id: &str, script: &str) -> (String, String) {
        let session = ok(
            engine,
            "session.start",
            json!({
                "workspaceId": workspace_id,
                "command": "/bin/sh",
                "args": ["-c", script],
            }),
        );
        (
            session["id"].as_str().unwrap().to_string(),
            session["incarnation"].as_str().unwrap().to_string(),
        )
    }

    fn output(engine: &Engine, id: &str, incarnation: &str) -> String {
        let read = ok(
            engine,
            "session.read",
            json!({ "sessionId": id, "incarnation": incarnation, "cursor": 0 }),
        );
        let bytes = crate::session::base64_decode(read["dataBase64"].as_str().unwrap()).unwrap();
        String::from_utf8_lossy(&bytes).into_owned()
    }

    fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(20);
        while !done() {
            assert!(Instant::now() < deadline, "timed out waiting for {what}");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn row(engine: &Engine, id: &str) -> Value {
        ok(engine, "session.list", json!({}))["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|session| session["id"] == id)
            .cloned()
            .unwrap_or_else(|| panic!("session {id} missing from session.list"))
    }

    fn fences(engine: &Engine) -> Value {
        let status = ok(engine, "status", json!({}));
        json!({
            "hostId": status["hostId"],
            "serviceInstanceId": status["serviceInstanceId"],
        })
    }

    /// Hands every session of `from` to a fresh engine over the same data
    /// directory, the way `drogond` does across processes (the descriptors
    /// are duplicated, as `SCM_RIGHTS` would).
    fn hand_over(dir: &std::path::Path, from: &Engine) -> (Engine, AdoptionReport) {
        let accepted = ok(from, "runtime.handoff", fences(from));
        assert_eq!(accepted["accepted"], true);
        let outgoing = from.handoff_outgoing().unwrap();
        let fds = outgoing
            .fds
            .iter()
            .map(|fd| unsafe { OwnedFd::from_raw_fd(libc::dup(*fd)) })
            .collect();
        let incoming = IncomingHandoff::parse(&outgoing.package, fds).unwrap();
        let successor = Engine::open_adopting(dir, &incoming.verified_live()).unwrap();
        let report = successor.adopt_handoff(incoming);
        from.release_after_handoff();
        (successor, report)
    }

    fn workspace(engine: &Engine, dir: &std::path::Path) -> String {
        ok(engine, "workspace.register", json!({ "path": dir }))["id"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn a_running_shell_moves_to_the_successor_with_its_output_input_and_identity() {
        let dir = tempfile::tempdir().unwrap();
        let predecessor = Engine::open(dir.path()).unwrap();
        let workspace_id = workspace(&predecessor, dir.path());
        let (id, incarnation) = start_shell(
            &predecessor,
            &workspace_id,
            "echo before-handoff; while read line; do echo got:$line; done",
        );
        wait_for("the shell's first line", || {
            output(&predecessor, &id, &incarnation).contains("before-handoff")
        });
        let pid_before = row(&predecessor, &id);

        let (successor, report) = hand_over(dir.path(), &predecessor);
        assert_eq!(report.adopted, vec![id.clone()], "{report:?}");

        // Same session, same incarnation, still live, with the scrollback
        // it had and at the same cursors.
        let adopted = row(&successor, &id);
        assert_eq!(adopted["incarnation"], incarnation.as_str());
        assert_eq!(adopted["verdict"], "live");
        assert_eq!(adopted["cols"], pid_before["cols"]);
        assert!(output(&successor, &id, &incarnation).contains("before-handoff"));

        // Input reaches the very same process, and its answer is read by
        // the successor.
        ok(
            &successor,
            "session.write",
            json!({
                "sessionId": id,
                "incarnation": incarnation,
                "dataBase64": crate::session::base64_encode(b"after-handoff\n"),
            }),
        );
        wait_for("the adopted shell's answer", || {
            output(&successor, &id, &incarnation).contains("got:after-handoff")
        });

        // A resize lands on the adopted master.
        let resized = ok(
            &successor,
            "session.resize",
            json!({ "sessionId": id, "incarnation": incarnation, "cols": 101, "rows": 31 }),
        );
        assert_eq!(resized["cols"], 101);

        // The successor can stop what it adopted, and says so.
        let stopped = ok(
            &successor,
            "session.stop",
            json!({ "sessionId": id, "incarnation": incarnation }),
        );
        assert_eq!(stopped["verdict"], "exited", "{stopped}");
    }

    #[test]
    fn an_adopted_child_that_exits_is_observed_and_keeps_its_recorded_code() {
        let dir = tempfile::tempdir().unwrap();
        let predecessor = Engine::open(dir.path()).unwrap();
        let workspace_id = workspace(&predecessor, dir.path());
        let (id, incarnation) =
            start_shell(&predecessor, &workspace_id, "echo ready; read x; exit 7");
        wait_for("ready", || {
            output(&predecessor, &id, &incarnation).contains("ready")
        });

        let (successor, report) = hand_over(dir.path(), &predecessor);
        assert_eq!(report.adopted, vec![id.clone()]);
        ok(
            &successor,
            "session.write",
            json!({
                "sessionId": id,
                "incarnation": incarnation,
                "dataBase64": crate::session::base64_encode(b"\n"),
            }),
        );
        wait_for("the adopted exit", || {
            row(&successor, &id)["verdict"] == "exited"
        });
        // The predecessor is still this test's process, so it is the parent
        // that reaps the child and records the real code; the successor's
        // own observation must never erase it.
        wait_for("the recorded code", || {
            recorded_exit_code(&successor.db, &id) == Some(7)
        });
    }

    #[test]
    fn a_process_that_dies_in_transit_is_recorded_exited_not_adopted() {
        let dir = tempfile::tempdir().unwrap();
        let predecessor = Engine::open(dir.path()).unwrap();
        let workspace_id = workspace(&predecessor, dir.path());
        let (id, incarnation) = start_shell(&predecessor, &workspace_id, "echo ready; sleep 60");
        wait_for("ready", || {
            output(&predecessor, &id, &incarnation).contains("ready")
        });
        let pid = predecessor.sessions.lock().unwrap()[&id]
            .child_process_id()
            .unwrap();

        ok(&predecessor, "runtime.handoff", fences(&predecessor));
        let outgoing = predecessor.handoff_outgoing().unwrap();
        // The child dies after the package was captured, before adoption.
        unsafe { libc::kill(pid as libc::pid_t, libc::SIGKILL) };
        wait_for("the child to be gone", || {
            !matches!(probe(pid), ProcessProbe::Alive { zombie: false, .. })
        });
        let fds = outgoing
            .fds
            .iter()
            .map(|fd| unsafe { OwnedFd::from_raw_fd(libc::dup(*fd)) })
            .collect();
        let incoming = IncomingHandoff::parse(&outgoing.package, fds).unwrap();
        assert!(
            incoming.verified_live().is_empty(),
            "a dead process is not kept live"
        );
        let successor = Engine::open_adopting(dir.path(), &incoming.verified_live()).unwrap();
        let report = successor.adopt_handoff(incoming);
        predecessor.release_after_handoff();
        assert!(report.adopted.is_empty(), "{report:?}");
        assert_eq!(report.exited, vec![id.clone()]);
        assert!(!successor.sessions.lock().unwrap().contains_key(&id));
        assert_eq!(row(&successor, &id)["verdict"], "exited");
    }

    #[test]
    fn startup_recovery_keeps_adopted_sessions_live_and_demotes_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let predecessor = Engine::open(dir.path()).unwrap();
        let workspace_id = workspace(&predecessor, dir.path());
        let (kept, _) = start_shell(&predecessor, &workspace_id, "sleep 30");
        let (other, _) = start_shell(&predecessor, &workspace_id, "sleep 30");
        let kept_incarnation = row(&predecessor, &kept)["incarnation"]
            .as_str()
            .unwrap()
            .to_string();

        let successor =
            Engine::open_adopting(dir.path(), &[(kept.clone(), kept_incarnation)]).unwrap();
        assert_eq!(row(&successor, &kept)["verdict"], "live");
        assert_eq!(row(&successor, &other)["verdict"], "unverifiable");
        for id in [&kept, &other] {
            let incarnation = row(&predecessor, id)["incarnation"].clone();
            ok(
                &predecessor,
                "session.stop",
                json!({ "sessionId": id, "incarnation": incarnation }),
            );
        }
    }

    #[test]
    fn an_abandoned_handoff_resumes_every_session_where_it_paused() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::open(dir.path()).unwrap();
        let workspace_id = workspace(&engine, dir.path());
        let (id, incarnation) = start_shell(
            &engine,
            &workspace_id,
            "echo ready; while read line; do echo got:$line; done",
        );
        wait_for("ready", || {
            output(&engine, &id, &incarnation).contains("ready")
        });

        ok(&engine, "runtime.handoff", fences(&engine));
        // Frozen: mutations are refused while the successor is awaited.
        let refused = call(
            &engine,
            "session.write",
            json!({
                "sessionId": id,
                "incarnation": incarnation,
                "dataBase64": crate::session::base64_encode(b"x\n"),
            }),
        )
        .unwrap_err();
        assert_eq!(refused.code, "runtime_busy");

        // A successor that died after recovery demoted the row.
        drop(Engine::open(dir.path()).unwrap());
        assert_eq!(
            row(&engine, &id)["verdict"],
            "live",
            "the handle still answers live"
        );

        engine.resume_after_handoff();
        let conn_verdict: String = engine
            .db
            .lock()
            .unwrap()
            .query_row("SELECT verdict FROM sessions WHERE id = ?1", [&id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(conn_verdict, "live", "resume restores the durable verdict");
        ok(
            &engine,
            "session.write",
            json!({
                "sessionId": id,
                "incarnation": incarnation,
                "dataBase64": crate::session::base64_encode(b"resumed\n"),
            }),
        );
        wait_for("the resumed reader", || {
            output(&engine, &id, &incarnation).contains("got:resumed")
        });
        ok(
            &engine,
            "session.stop",
            json!({ "sessionId": id, "incarnation": incarnation }),
        );
    }

    #[test]
    fn a_handoff_is_refused_with_stale_fences_and_while_a_recipe_runs() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::open(dir.path()).unwrap();
        let mut stale = fences(&engine);
        stale["serviceInstanceId"] = json!("someone-else");
        assert_eq!(
            call(&engine, "runtime.handoff", stale).unwrap_err().code,
            "stale_incarnation"
        );
        engine
            .db
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO mentu_runs (id, workspace_id, recipe_id, approval_id, status, started_at) \
                 VALUES ('run-1', 'ws', 'recipe', 'approval', 'running', ?1)",
                [crate::now_rfc3339()],
            )
            .unwrap();
        let busy = call(&engine, "runtime.handoff", fences(&engine)).unwrap_err();
        assert_eq!(busy.code, "runtime_busy");
        assert!(busy.message.contains("Mentu"), "{}", busy.message);
        assert!(!engine.handoff_requested());
    }

    #[test]
    fn status_advertises_the_handoff_capability() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::open(dir.path()).unwrap();
        let status = ok(&engine, "status", json!({}));
        assert!(
            status["capabilities"]
                .as_array()
                .unwrap()
                .contains(&json!(HANDOFF_CAPABILITY))
        );
    }

    #[test]
    fn a_reused_pid_or_a_zombie_is_not_the_adopted_process() {
        let mut child = std::process::Command::new("/bin/sh")
            .args(["-c", "exit 0"])
            .spawn()
            .unwrap();
        let pid = child.id();
        // Unreaped: a zombie still has a pid and a start time.
        wait_for("the zombie", || {
            matches!(probe(pid), ProcessProbe::Alive { zombie: true, .. })
        });
        let ProcessProbe::Alive { start, .. } = probe(pid) else {
            unreachable!()
        };
        assert!(!is_same_live_process(pid, &start));
        assert!(
            AdoptedChild {
                pid,
                start: start.clone()
            }
            .has_exited()
        );
        child.wait().unwrap();
        assert!(AdoptedChild { pid, start }.has_exited());

        let running = std::process::Command::new("/bin/sleep").arg("30").spawn();
        let mut running = running.unwrap();
        let ProcessProbe::Alive {
            start,
            zombie: false,
        } = probe(running.id())
        else {
            panic!("a running child must probe alive");
        };
        assert!(
            AdoptedChild {
                pid: running.id(),
                start: "0.000000".into()
            }
            .has_exited(),
            "a different start time is a different process"
        );
        assert!(
            !AdoptedChild {
                pid: running.id(),
                start
            }
            .has_exited()
        );
        running.kill().unwrap();
        running.wait().unwrap();
    }
}
