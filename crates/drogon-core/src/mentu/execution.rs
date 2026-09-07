//! Bounded, cancellable execution of the `mentu-recipes` child process. A
//! run is launched asynchronously: [`launch_run`] validates, records a
//! `running` row and spawns the child, then returns immediately with that
//! row — the actual wait happens on a detached background thread, which
//! writes the final result back through the same `Arc<Mutex<Connection>>`
//! `Engine` already holds. [`cancel`] kills a still-registered child by the
//! same internal run id `launch_run` minted.

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

    /// Marks the run cancelled and kills its child if still registered.
    /// Returns `false` if the run is not (or no longer) tracked here —
    /// either it already finished, or `id` never named a live run.
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
        let _ = entry.0.lock().unwrap().kill();
        true
    }
}

fn registry() -> &'static ChildRegistry {
    static REGISTRY: OnceLock<ChildRegistry> = OnceLock::new();
    REGISTRY.get_or_init(ChildRegistry::new)
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
    let start = Instant::now();
    loop {
        {
            let mut guard = child.lock().unwrap();
            if let Ok(Some(_)) = guard.try_wait() {
                return WaitOutcome::Exited;
            }
        }
        if cancelled.load(Ordering::SeqCst) {
            // `cancel()` already called kill(); wait a little longer for the
            // OS to actually reap it, but never block this thread forever.
            let deadline = Instant::now() + Duration::from_secs(2);
            while Instant::now() < deadline {
                let mut guard = child.lock().unwrap();
                if let Ok(Some(_)) = guard.try_wait() {
                    return WaitOutcome::Exited;
                }
                drop(guard);
                std::thread::sleep(POLL_INTERVAL);
            }
            return WaitOutcome::Cancelled;
        }
        if start.elapsed() >= RUN_TIMEOUT {
            let _ = child.lock().unwrap().kill();
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
