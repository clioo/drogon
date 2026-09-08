//! Bounded, cancellable execution of the `mentu-recipes` child process. A
//! run is launched asynchronously: [`launch_run`] validates, records a
//! `running` row and spawns the child in its own process group, then
//! returns immediately with that row — the actual wait happens on a
//! detached background thread, which writes the final result back through
//! the same `Arc<Mutex<Connection>>` `Engine` already holds. [`cancel`]
//! stops a still-registered run by the same internal run id `launch_run`
//! minted, cooperatively first (SIGTERM so the supervisor reaps its
//! separately-grouped step shells) with a SIGKILL escalation when the tree
//! refuses to die.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use drogon_protocol::RpcError;
use drogon_protocol::mentu::{MentuRun, MentuRunStatus};

use crate::error;

use super::{run_record, storage};

/// Wall-clock budget for one `mentu-recipes` invocation before this process
/// kills it. Generous: a real recipe can run long individual steps, but an
/// unbounded child is never acceptable.
const RUN_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const POLL_INTERVAL: Duration = Duration::from_millis(50);
/// Combined stdout+stderr retained for diagnostics only (never shown as the
/// evidence of record — that is always the per-step files run.json points
/// at); generous enough for a `mentu-recipes` failure banner, small enough
/// to bound memory.
const MAX_DIAGNOSTIC_BYTES: usize = 2 * 1024 * 1024;

struct ChildEntry {
    child: Arc<Mutex<Child>>,
    cancelled: Arc<AtomicBool>,
}

struct ChildRegistry {
    inner: Mutex<HashMap<String, ChildEntry>>,
}

impl ChildRegistry {
    fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    fn register(&self, id: String, child: Arc<Mutex<Child>>, cancelled: Arc<AtomicBool>) {
        self.inner
            .lock()
            .unwrap()
            .insert(id, ChildEntry { child, cancelled });
    }

    fn remove(&self, id: &str) {
        self.inner.lock().unwrap().remove(id);
    }

    /// Marks the run cancelled and kills its whole step tree if still
    /// registered. Returns `false` if the run is not (or no longer)
    /// tracked here — either it already finished, or `id` never named a
    /// live run.
    fn cancel(&self, id: &str) -> bool {
        let Some(entry) = self
            .inner
            .lock()
            .unwrap()
            .get(id)
            .map(|e| (Arc::clone(&e.child), Arc::clone(&e.cancelled)))
        else {
            return false;
        };
        entry.1.store(true, Ordering::SeqCst);
        // Cooperative first: SIGTERM lets the supervisor reap its steps;
        // the watcher escalates to SIGKILL if the tree refuses to die.
        // Non-Unix has no groups, so it keeps the old immediate kill.
        #[cfg(unix)]
        term_tree(&entry.0);
        #[cfg(not(unix))]
        let _ = entry.0.lock().unwrap().kill();
        true
    }
}

fn registry() -> &'static ChildRegistry {
    static REGISTRY: OnceLock<ChildRegistry> = OnceLock::new();
    REGISTRY.get_or_init(ChildRegistry::new)
}

/// Detaches a run child into its own process group (Unix only), so one
/// signal reaches the `mentu-recipes` supervisor without ever touching the
/// daemon's own group. The supervisor keeps each step in a further,
/// separate group, so the stop itself is two-phase ([`term_tree`] for the
/// cooperative forward, [`kill_tree`] for escalation) — never a bare
/// `Child::kill`, which would orphan the step tree. A forked child is
/// never its group leader, so `setsid` cannot fail here; its return is
/// intentionally unchecked.
#[cfg(unix)]
fn detach_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt as _;
    // `pre_exec` is `unsafe` (its closure runs between fork and exec, where
    // only async-signal-safe code is sound): this one calls nothing but
    // `setsid`, which is.
    unsafe {
        command.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
}

/// Asks a run tree to stop cooperatively (Unix): SIGTERM to the run's
/// group reaches the `mentu-recipes` supervisor, which forwards
/// termination to its step shells. The steps live in their own groups, so
/// a group SIGKILL alone cannot reach them — but the supervisor's TERM
/// handler reaps them, as a live probe against 0.4.0 confirmed.
#[cfg(unix)]
fn term_tree(child: &Arc<Mutex<Child>>) {
    let pid = child.lock().unwrap().id();
    unsafe {
        libc::killpg(pid as libc::pid_t, libc::SIGTERM);
    }
}

/// No-op where groups do not exist; [`kill_tree`] is the only stop there.
#[cfg(not(unix))]
fn term_tree(child: &Arc<Mutex<Child>>) {
    let _ = child;
}

/// Escalation when cooperation fails: SIGKILLs the run's group, then the
/// direct child as a fallback. ESRCH from a group that already exited is
/// ordinary and ignored.
fn kill_tree(child: &Arc<Mutex<Child>>) {
    #[cfg(unix)]
    {
        let pid = child.lock().unwrap().id();
        unsafe {
            libc::killpg(pid as libc::pid_t, libc::SIGKILL);
        }
    }
    let _ = child.lock().unwrap().kill();
}

/// True once the child has exited (and been reaped via `try_wait`) within
/// `grace`.
fn exited_within(child: &Arc<Mutex<Child>>, grace: Duration) -> bool {
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline {
        {
            let mut guard = child.lock().unwrap();
            if let Ok(Some(_)) = guard.try_wait() {
                return true;
            }
        }
        std::thread::sleep(POLL_INTERVAL);
    }
    false
}

fn spawn_capture_thread(mut stream: impl std::io::Read + Send + 'static) -> Arc<Mutex<Vec<u8>>> {
    let buf: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    let buf_thread = Arc::clone(&buf);
    std::thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        loop {
            match stream.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let mut guard = buf_thread.lock().unwrap();
                    if guard.len() < MAX_DIAGNOSTIC_BYTES {
                        let remaining = MAX_DIAGNOSTIC_BYTES - guard.len();
                        guard.extend_from_slice(&chunk[..n.min(remaining)]);
                    }
                }
            }
        }
    });
    buf
}

enum WaitOutcome {
    Exited,
    TimedOut,
    Cancelled,
}

fn wait_bounded(child: &Arc<Mutex<Child>>, cancelled: &Arc<AtomicBool>) -> WaitOutcome {
    const COOPERATIVE_GRACE: Duration = Duration::from_secs(2);
    const REAP_GRACE: Duration = Duration::from_secs(2);
    const TIMEOUT_GRACE: Duration = Duration::from_secs(5);
    let start = Instant::now();
    loop {
        {
            let mut guard = child.lock().unwrap();
            if let Ok(Some(_)) = guard.try_wait() {
                return WaitOutcome::Exited;
            }
        }
        if cancelled.load(Ordering::SeqCst) {
            // `cancel()` already asked for cooperative shutdown; wait a
            // beat for the supervisor to forward it to its steps, then
            // escalate so a hung tree cannot linger past this point.
            if exited_within(child, COOPERATIVE_GRACE) {
                return WaitOutcome::Exited;
            }
            kill_tree(child);
            exited_within(child, REAP_GRACE);
            return WaitOutcome::Cancelled;
        }
        if start.elapsed() >= RUN_TIMEOUT {
            // Same two-phase stop as cancel: TERM first so the supervisor
            // reaps its steps, KILL only on refusal.
            term_tree(child);
            if exited_within(child, TIMEOUT_GRACE) {
                return WaitOutcome::TimedOut;
            }
            kill_tree(child);
            exited_within(child, REAP_GRACE);
            return WaitOutcome::TimedOut;
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

fn diagnostic_tail(stdout: &Arc<Mutex<Vec<u8>>>, stderr: &Arc<Mutex<Vec<u8>>>) -> String {
    let out = String::from_utf8_lossy(&stdout.lock().unwrap()).into_owned();
    let err = String::from_utf8_lossy(&stderr.lock().unwrap()).into_owned();
    let combined = format!("{out}\n{err}");
    let trimmed = combined.trim();
    let tail: String = trimmed
        .chars()
        .rev()
        .take(2000)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    tail
}

/// What kind of invocation to launch: a fresh `run` of a recipe, or a
/// `resume` of an existing (already-known) `mentu-recipes` run id. Both
/// share the same watcher/finish logic below.
pub enum Invocation<'a> {
    Run { recipe_path: &'a Path },
    Resume { mentu_run_id: &'a str },
}

/// Launches one `mentu-recipes` invocation in the background and returns
/// immediately with the freshly inserted `running` row. `db` is cloned
/// (it is already an `Arc`) so the watcher thread can write the final
/// result without this call holding any lock past the (near-instant)
/// spawn.
#[allow(clippy::too_many_arguments)]
pub fn launch_run(
    db: Arc<Mutex<rusqlite::Connection>>,
    runtime_path: PathBuf,
    workspace_root: PathBuf,
    workspace_id: String,
    recipe_id: String,
    approval_id: String,
    retry_of: Option<String>,
    invocation: Invocation,
) -> Result<MentuRun, RpcError> {
    let internal_id = uuid::Uuid::new_v4().to_string();
    let started_at = crate::now_rfc3339();

    let mut command = Command::new(&runtime_path);
    #[cfg(unix)]
    detach_process_group(&mut command);
    let before_run_ids = match &invocation {
        Invocation::Run { recipe_path } => {
            command.arg("run").arg(recipe_path);
            Some(run_record::list_run_directory_names(&workspace_root))
        }
        Invocation::Resume { mentu_run_id } => {
            command.arg("resume").arg(mentu_run_id);
            None
        }
    };
    command
        .arg("--workspace")
        .arg(&workspace_root)
        .current_dir(&workspace_root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| error::io_error(format!("failed to start mentu-recipes: {e}")))?;
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let stdout_buf = spawn_capture_thread(stdout);
    let stderr_buf = spawn_capture_thread(stderr);

    {
        let conn = db.lock().unwrap();
        storage::insert_run(
            &conn,
            &storage::NewRun {
                id: &internal_id,
                workspace_id: &workspace_id,
                recipe_id: &recipe_id,
                approval_id: &approval_id,
                started_at: &started_at,
                retry_of: retry_of.as_deref(),
            },
        )?;
        if let Invocation::Resume { mentu_run_id } = &invocation {
            storage::set_mentu_run_id(&conn, &internal_id, mentu_run_id)?;
        }
    }

    let known_mentu_run_id = match &invocation {
        Invocation::Resume { mentu_run_id } => Some(mentu_run_id.to_string()),
        Invocation::Run { .. } => None,
    };

    let child_arc = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    registry().register(
        internal_id.clone(),
        Arc::clone(&child_arc),
        Arc::clone(&cancelled),
    );

    let watch_id = internal_id.clone();
    let watcher_db = Arc::clone(&db);
    std::thread::spawn(move || {
        let outcome = wait_bounded(&child_arc, &cancelled);
        registry().remove(&watch_id);
        finish(
            &watcher_db,
            &watch_id,
            &workspace_root,
            outcome,
            cancelled.load(Ordering::SeqCst),
            known_mentu_run_id,
            before_run_ids,
            &stdout_buf,
            &stderr_buf,
        );
    });

    storage::get_run(&db.lock().unwrap(), &internal_id)?
        .ok_or_else(|| error::internal_error("Mentu run vanished immediately after insert."))
}

#[allow(clippy::too_many_arguments)]
fn finish(
    db: &Arc<Mutex<rusqlite::Connection>>,
    internal_id: &str,
    workspace_root: &Path,
    outcome: WaitOutcome,
    was_cancelled: bool,
    known_mentu_run_id: Option<String>,
    before_run_ids: Option<std::collections::HashSet<String>>,
    stdout_buf: &Arc<Mutex<Vec<u8>>>,
    stderr_buf: &Arc<Mutex<Vec<u8>>>,
) {
    let ended_at = crate::now_rfc3339();
    if matches!(outcome, WaitOutcome::Cancelled) || was_cancelled {
        let conn = db.lock().unwrap();
        let _ = storage::finish_run(
            &conn,
            internal_id,
            MentuRunStatus::Cancelled,
            &ended_at,
            Some("Cancelled by request."),
            known_mentu_run_id.as_deref(),
            None,
        );
        return;
    }
    if matches!(outcome, WaitOutcome::TimedOut) {
        let conn = db.lock().unwrap();
        let _ = storage::finish_run(
            &conn,
            internal_id,
            MentuRunStatus::Unavailable,
            &ended_at,
            Some("mentu-recipes exceeded its execution time budget and was stopped."),
            known_mentu_run_id.as_deref(),
            None,
        );
        return;
    }

    let mentu_run_id = known_mentu_run_id.or_else(|| {
        before_run_ids
            .as_ref()
            .and_then(|before| run_record::discover_new_run_id(workspace_root, before))
    });

    let Some(mentu_run_id) = mentu_run_id else {
        let tail = diagnostic_tail(stdout_buf, stderr_buf);
        let conn = db.lock().unwrap();
        let _ = storage::finish_run(
            &conn,
            internal_id,
            MentuRunStatus::Unavailable,
            &ended_at,
            Some(&format!(
                "mentu-recipes exited without producing a run record.\n{tail}"
            )),
            None,
            None,
        );
        return;
    };

    match run_record::read_run_json(workspace_root, &mentu_run_id) {
        Ok(Some(run_json)) => {
            let steps = run_record::parse_steps(&run_json, &mentu_run_id);
            let status = run_record::overall_status(&run_json, &steps);
            let ended = run_record::ended_at(&run_json).unwrap_or_else(|| ended_at.clone());
            let error_message = first_step_error(&steps, status);
            let conn = db.lock().unwrap();
            let _ = storage::finish_run(
                &conn,
                internal_id,
                status,
                &ended,
                error_message.as_deref(),
                Some(&mentu_run_id),
                Some(&run_json),
            );
        }
        Ok(None) => {
            let conn = db.lock().unwrap();
            let _ = storage::finish_run(
                &conn,
                internal_id,
                MentuRunStatus::Unavailable,
                &ended_at,
                Some("mentu-recipes reported a run id but wrote no run.json."),
                Some(&mentu_run_id),
                None,
            );
        }
        Err(e) => {
            let conn = db.lock().unwrap();
            let _ = storage::finish_run(
                &conn,
                internal_id,
                MentuRunStatus::Unavailable,
                &ended_at,
                Some(&e.message),
                Some(&mentu_run_id),
                None,
            );
        }
    }
}

fn first_step_error(
    steps: &[drogon_protocol::mentu::MentuStepRun],
    status: MentuRunStatus,
) -> Option<String> {
    if status != MentuRunStatus::Failed {
        return None;
    }
    steps
        .iter()
        .find(|s| s.status == MentuRunStatus::Failed)
        .and_then(|s| s.error.clone())
        .or_else(|| Some("Recipe failed.".to_string()))
}

/// Cancels a still-running launch by its internal run id. Returns `false`
/// when nothing was tracked under `id` (already finished, or unknown).
pub fn cancel(id: &str) -> bool {
    registry().cancel(id)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::io::BufRead as _;
    use std::time::Duration;

    /// A step-shaped process tree: a group-detached `sh` supervisor with one
    /// backgrounded `sleep` grandchild, whose pid is reported on the
    /// supervisor's stdout. Mirrors what a shell recipe step leaves behind
    /// when cancelled mid-step.
    fn spawn_step_like_tree() -> (Child, i32) {
        let mut command = Command::new("sh");
        detach_process_group(&mut command);
        command
            .arg("-c")
            .arg("sleep 60 & echo $!; wait")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = command.spawn().expect("sh supervisor spawns");
        // One line, not `read_to_string`: the backgrounded sleep inherits
        // the pipe, so EOF never arrives while it lives.
        let mut pid_text = String::new();
        std::io::BufReader::new(child.stdout.take().expect("piped stdout"))
            .read_line(&mut pid_text)
            .expect("supervisor reports its grandchild pid");
        let grandchild: i32 = pid_text.trim().parse().expect("a numeric grandchild pid");
        (child, grandchild)
    }

    fn process_exists(pid: i32) -> bool {
        // Signal 0 probes existence without delivering anything; ESRCH
        // means the pid is gone (a zombie adopted by init reads as gone
        // only once reaped, so callers poll).
        unsafe { libc::kill(pid, 0) == 0 }
    }

    #[test]
    fn cancel_kills_grandchildren_a_step_backgrounded() {
        let (child, grandchild) = spawn_step_like_tree();
        assert!(process_exists(grandchild));
        let tree = Arc::new(Mutex::new(child));
        kill_tree(&tree);
        tree.lock().unwrap().wait().expect("reap the supervisor");

        // The SIGKILLed grandchild lingers as a zombie until init reaps
        // it; poll briefly rather than asserting on the first sample.
        let deadline = Instant::now() + Duration::from_secs(10);
        while process_exists(grandchild) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(
            !process_exists(grandchild),
            "backgrounded sleep {grandchild} survived the group kill"
        );
    }
}
