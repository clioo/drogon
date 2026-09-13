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
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use drogon_protocol::RpcError;
use drogon_protocol::mentu::{MentuRun, MentuRunStatus};
use rusqlite::OptionalExtension as _;
use sha2::Digest as _;

use crate::error;

use super::run_record::WorkspaceAttestation;
use super::{run_record, storage};

/// Watchdog for recipes that declare no step budgets. A fully explicit recipe
/// gets the sum of its runtime-owned attempt, retry, verification, and hook
/// limits plus cleanup grace, so the daemon never preempts valid work.
const DEFAULT_RUN_TIMEOUT: Duration =
    Duration::from_secs(super::recipe::DEFAULT_STEP_TIMEOUT_SECONDS);
const DECLARED_TIMEOUT_GRACE: Duration = Duration::from_secs(60);
const VERIFY_COMMAND_TIMEOUT: Duration = Duration::from_secs(300);
const HOOK_COMMAND_TIMEOUT: Duration = Duration::from_secs(120);
const CLOUD_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const GIT_PROBE_TIMEOUT: Duration = Duration::from_secs(10);
const GIT_DIFF_TIMEOUT: Duration = Duration::from_secs(20);
const GIT_ADD_TIMEOUT: Duration = Duration::from_secs(30);
const GIT_COMMIT_TIMEOUT: Duration = Duration::from_secs(60);
const PI_VERSION_TIMEOUT: Duration = Duration::from_secs(5);
const RUNTIME_PROCESS_TEARDOWN: Duration = Duration::from_secs(4);
/// A malformed or hostile recipe cannot turn the daemon's safety watchdog off.
const MAX_RUN_TIMEOUT: Duration = Duration::from_secs(24 * 60 * 60);
const POLL_INTERVAL: Duration = Duration::from_millis(50);
/// Combined stdout+stderr retained for diagnostics only (never shown as the
/// evidence of record — that is always the per-step files run.json points
/// at); generous enough for a `mentu-recipes` failure banner, small enough
/// to bound memory.
const MAX_DIAGNOSTIC_BYTES: usize = 2 * 1024 * 1024;

/// How often the in-flight progress poller re-reads `run.json` while a run
/// is live. `mentu-recipes` rewrites the record after every step, so a
/// sub-second poll makes Evidence and Metrics populate DURING the run
/// instead of only at exit.
const PROGRESS_POLL_INTERVAL: Duration = Duration::from_millis(500);

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

    /// True while this daemon still holds the run's live child. Used by the
    /// graph state projector: a row that says `running` without a tracked
    /// child is loss of contact, reported `unverifiable` — never `running`.
    /// (After a daemon restart nothing is tracked, so every stale `running`
    /// row becomes unverifiable instead of a claim the daemon cannot back.)
    pub fn is_tracked(&self, id: &str) -> bool {
        self.inner.lock().unwrap().contains_key(id)
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

/// Whether this daemon currently holds a confirmed live child for `id`.
/// Loss of contact is never a claim about what happened.
pub fn is_tracked(id: &str) -> bool {
    registry().is_tracked(id)
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

fn repeated_runtime_process(timeout: Duration, count: u64) -> Duration {
    timeout
        .saturating_add(RUNTIME_PROCESS_TEARDOWN)
        .saturating_mul(count.try_into().unwrap_or(u32::MAX))
}

fn workspace_baseline_budget() -> Duration {
    // repository root, HEAD and porcelain status are three sequential probes.
    repeated_runtime_process(GIT_PROBE_TIMEOUT, 3)
}

fn git_finalize_budget() -> Duration {
    // Repository root + post-step baseline + optional quarantine diff, add,
    // commit and final HEAD. Branches that skip work are shorter than this.
    repeated_runtime_process(GIT_PROBE_TIMEOUT, 2)
        .saturating_add(workspace_baseline_budget())
        .saturating_add(repeated_runtime_process(GIT_DIFF_TIMEOUT, 1))
        .saturating_add(repeated_runtime_process(GIT_ADD_TIMEOUT, 1))
        .saturating_add(repeated_runtime_process(GIT_COMMIT_TIMEOUT, 1))
}

fn step_run_budget(
    step: &super::recipe::RecipeStepBudget,
    recipe: &super::recipe::RecipeBudget,
) -> Duration {
    let timeout = step.timeout_seconds.filter(|seconds| *seconds > 0);
    let attempts = step.max_retries.saturating_add(1);
    let attempt_budget =
        repeated_runtime_process(Duration::from_secs(timeout.unwrap_or(0)), attempts);
    let pi_preflight = if step.pi_preflight {
        // Pi checks both the Pi and Node versions before every attempt.
        repeated_runtime_process(PI_VERSION_TIMEOUT, attempts.saturating_mul(2))
    } else {
        Duration::ZERO
    };
    let backoff = Duration::from_millis(step.retry_backoff_ms.saturating_mul(step.max_retries));
    let verification = repeated_runtime_process(VERIFY_COMMAND_TIMEOUT, step.verify_commands);
    let bookkeeping = workspace_baseline_budget()
        .saturating_mul(2)
        .saturating_add(if step.verify_git_clean {
            workspace_baseline_budget()
        } else {
            Duration::ZERO
        })
        .saturating_add(if step.expected_changes {
            git_finalize_budget()
        } else {
            Duration::ZERO
        });
    let terminal_hooks = recipe.after_step_hooks.max(recipe.on_error_hooks);
    let hooks = repeated_runtime_process(
        HOOK_COMMAND_TIMEOUT,
        recipe.before_step_hooks.saturating_add(terminal_hooks),
    );
    attempt_budget
        .saturating_add(pi_preflight)
        .saturating_add(backoff)
        .saturating_add(verification)
        .saturating_add(bookkeeping)
        .saturating_add(hooks)
}

fn parsed_recipe_budget(recipe_bytes: &[u8]) -> Option<super::recipe::RecipeBudget> {
    std::str::from_utf8(recipe_bytes)
        .ok()
        .and_then(|source| super::recipe::parse_recipe_budget(source).ok())
        .filter(|recipe| !recipe.steps.is_empty() || recipe.has_recipe_nodes)
}

fn bounded_declared_timeout(declared: Duration) -> Duration {
    declared
        .saturating_add(DECLARED_TIMEOUT_GRACE)
        .min(MAX_RUN_TIMEOUT)
}

fn recipe_run_timeout(recipe_bytes: &[u8]) -> Duration {
    let Some(recipe) = parsed_recipe_budget(recipe_bytes) else {
        return DEFAULT_RUN_TIMEOUT;
    };
    // Compound, pipeline and parallel recipes resolve child recipe files at
    // runtime. Their nested timing declarations are not part of the approved
    // parent bytes, so only the hard outer cap can conservatively cover them.
    if recipe.has_recipe_nodes
        || recipe
            .steps
            .iter()
            .any(|step| step.timeout_seconds.is_none())
    {
        return MAX_RUN_TIMEOUT;
    }
    let run_hooks = repeated_runtime_process(
        HOOK_COMMAND_TIMEOUT,
        recipe
            .before_run_hooks
            .saturating_add(recipe.after_run_hooks),
    );
    // The pinned runtime gives each cloud request a 10-second inactivity
    // timeout. A cloud-enabled fresh run can start and end its remote run;
    // step evaluation adds one request for every locally completed step.
    // Resume/retry skip start/end, but this conservative count avoids deriving
    // invocation-specific state from mutable files.
    let cloud_requests = if recipe.cloud_enabled {
        let evaluations = if recipe.cloud_evaluate_steps {
            recipe.steps.len() as u64
        } else {
            0
        };
        CLOUD_REQUEST_TIMEOUT
            .saturating_mul(evaluations.saturating_add(2).try_into().unwrap_or(u32::MAX))
    } else {
        Duration::ZERO
    };
    // Fresh runs take one baseline before any steps. Resume/retry do not, but
    // retaining this bounded allowance is safer than consulting mutable state.
    let mut declared = run_hooks
        .saturating_add(cloud_requests)
        .saturating_add(workspace_baseline_budget());
    for step in &recipe.steps {
        declared = declared.saturating_add(step_run_budget(step, &recipe));
    }
    // URLRequest.timeoutInterval can reset when more response data arrives; it
    // is not a hard whole-resource deadline. Only the approved 24-hour outer
    // safety cap can conservatively bound a cloud-enabled runtime invocation.
    if recipe.cloud_enabled {
        MAX_RUN_TIMEOUT
    } else {
        bounded_declared_timeout(declared)
    }
}

fn read_snapshot_file(path: &Path) -> Option<Vec<u8>> {
    use std::io::Read as _;

    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        // O_NOFOLLOW rejects symlinks; O_NONBLOCK keeps a planted FIFO or
        // device node from blocking before the post-open regular-file check.
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt as _;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path).ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file() || metadata.len() > SNAPSHOT_MAX_RECIPE_BYTES {
        return None;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt as _;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return None;
        }
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(SNAPSHOT_MAX_RECIPE_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    (bytes.len() as u64 <= SNAPSHOT_MAX_RECIPE_BYTES).then_some(bytes)
}

fn is_plain_snapshot_directory(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if !metadata.is_dir() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt as _;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return false;
        }
    }
    true
}

fn read_original_snapshot_recipe(workspace_root: &Path, run_id: &str) -> Option<Vec<u8>> {
    if !valid_run_id(run_id) {
        return None;
    }
    let root = snapshot_root(workspace_root);
    if !is_plain_snapshot_directory(&root) {
        return None;
    }
    let dir = root.join(run_id);
    if !is_plain_snapshot_directory(&dir) {
        return None;
    }
    let manifest_bytes = read_snapshot_file(&dir.join("manifest.json"))?;
    let manifest = serde_json::from_slice::<serde_json::Value>(&manifest_bytes).ok()?;
    let recorded_path = PathBuf::from(manifest.get("recipePath")?.as_str()?);
    let file_name = recorded_path.file_name()?;
    let recipe_path = dir.join(file_name);
    if recorded_path != recipe_path {
        return None;
    }
    let recipe_bytes = read_snapshot_file(&recipe_path)?;
    let recorded_hash = manifest.get("contentHash")?.as_str()?;
    (sha256_hex(&recipe_bytes) == recorded_hash).then_some(recipe_bytes)
}

fn read_retry_snapshot(
    db: &Arc<Mutex<rusqlite::Connection>>,
    workspace_root: &Path,
    workspace_id: &str,
    run_id: &str,
) -> Option<Vec<u8>> {
    if !valid_run_id(run_id) {
        return None;
    }
    // Every wrapper retry retains the original approval id. Resolve the one
    // fresh run that materialized that approval directly instead of walking an
    // arbitrarily deep retry_of chain and eventually losing its safe budget.
    let (source_run_id, approved_hash) = {
        let conn = db.lock().unwrap();
        let prior = storage::get_run(&conn, run_id).ok()??;
        if prior.workspace_id != workspace_id {
            return None;
        }
        let source_run_id = conn
            .query_row(
                "SELECT id FROM mentu_runs WHERE workspace_id = ?1 AND approval_id = ?2 AND retry_of IS NULL ORDER BY rowid LIMIT 1",
                rusqlite::params![workspace_id, prior.approval_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .ok()??;
        let approved_hash = storage::approval_content_hash(&conn, &prior.approval_id).ok()??;
        (source_run_id, approved_hash)
    };
    let bytes = read_original_snapshot_recipe(workspace_root, &source_run_id)?;
    (sha256_hex(&bytes) == approved_hash).then_some(bytes)
}

fn invocation_run_timeout(
    invocation: &Invocation<'_>,
    snapshot: Option<&StagedSnapshot>,
    retry_recipe: Option<&[u8]>,
) -> Duration {
    if let Some(snapshot) = snapshot {
        return recipe_run_timeout(&snapshot.recipe_bytes);
    }
    match invocation {
        // A fresh run without approved staged bytes is a legacy caller. Never
        // derive its watchdog from a second read of the mutable recipe path.
        Invocation::Run { .. } => DEFAULT_RUN_TIMEOUT,
        // Resume and retry re-enter runtime-side state. Reuse the exact
        // approved bytes retained for the original run; an absent or changed
        // snapshot falls back to the historical bounded default, never 24 h.
        Invocation::Resume { .. } | Invocation::RetryStep { .. } => retry_recipe
            .map(recipe_run_timeout)
            .unwrap_or(DEFAULT_RUN_TIMEOUT),
    }
}

fn wait_bounded(
    child: &Arc<Mutex<Child>>,
    cancelled: &Arc<AtomicBool>,
    run_timeout: Duration,
) -> WaitOutcome {
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
        if start.elapsed() >= run_timeout {
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

/// What kind of invocation to launch: a fresh `run` of a recipe, a
/// `resume` of an existing (already-known) `mentu-recipes` run id, or a
/// `retry-step` of one step within that run. All three share the same
/// watcher/finish logic below.
pub enum Invocation<'a> {
    Run {
        recipe_path: &'a Path,
    },
    Resume {
        mentu_run_id: &'a str,
    },
    RetryStep {
        mentu_run_id: &'a str,
        step: &'a str,
    },
}

/// Launches one `mentu-recipes` invocation in the background and returns
/// immediately with the freshly inserted `running` row. `db` is cloned
/// (it is already an `Arc`) so the watcher thread can write the final
/// result without this call holding any lock past the (near-instant)
/// spawn.
///
/// C03: `snapshot` carries the staged approved bytes for a fresh `Run`.
/// When present the staged content is re-verified against the live
/// workspace (refusing drift), materialized write-once under
/// `.mentu/recipes/.snapshots/<run id>/`, and the snapshot recipe path — never
/// the mutable recipe path — is passed to the runtime. `Resume` with a
/// snapshot is refused: a resume re-enters runtime-side state, it does
/// not start approved bytes.
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
    snapshot: Option<StagedSnapshot>,
    attestation: WorkspaceAttestation,
    data_dir: &Path,
) -> Result<MentuRun, RpcError> {
    if matches!(
        invocation,
        Invocation::Resume { .. } | Invocation::RetryStep { .. }
    ) && snapshot.is_some()
    {
        return Err(error::invalid_argument(
            "Snapshots ride fresh runs; retry resumes runtime-side state.",
        ));
    }
    let retry_recipe = if matches!(
        &invocation,
        Invocation::Resume { .. } | Invocation::RetryStep { .. }
    ) {
        retry_of
            .as_deref()
            .and_then(|run_id| read_retry_snapshot(&db, &workspace_root, &workspace_id, run_id))
    } else {
        None
    };
    let run_timeout =
        invocation_run_timeout(&invocation, snapshot.as_ref(), retry_recipe.as_deref());
    let internal_id = uuid::Uuid::new_v4().to_string();
    let started_at = crate::now_rfc3339();

    // The recipe argument the runtime loads: the immutable snapshot when
    // staged, else the caller-supplied path (the resume path and any
    // legacy caller without staged bytes). The snapshot recipe path is
    // deterministic (run id + recipe file name), so the exact argv is
    // known before materialization and recorded in the manifest.
    let mut snapshot_dir: Option<PathBuf> = None;
    let mut recipe_arg: Option<PathBuf> = None;
    let mut attest_resources: Vec<(String, String)> = Vec::new();
    if let Some(staged) = &snapshot {
        if staged.recipe_id != recipe_id {
            return Err(error::invalid_argument(
                "Staged snapshot names a different recipe.",
            ));
        }
        verify_staged_fresh(&workspace_root, daemon_home_prompts().as_deref(), staged)?;
        let snapshot_recipe_path = snapshot_root(&workspace_root)
            .join(&internal_id)
            .join(&staged.recipe_file_name);
        let argv = vec![
            runtime_path.to_string_lossy().into_owned(),
            "run".to_string(),
            snapshot_recipe_path.to_string_lossy().into_owned(),
            "--workspace".to_string(),
            workspace_root.to_string_lossy().into_owned(),
        ];
        let materialized = materialize_snapshot(&workspace_root, &internal_id, staged, &argv)?;
        debug_assert_eq!(materialized.recipe_path, snapshot_recipe_path);
        snapshot_dir = Some(materialized.dir);
        recipe_arg = Some(materialized.recipe_path);
        attest_resources = staged
            .resources
            .iter()
            .map(|(resource, _)| (resource.path.clone(), resource.sha256.clone()))
            .collect();
    }

    let mut command = Command::new(&runtime_path);
    #[cfg(unix)]
    detach_process_group(&mut command);
    // The runtime and the agent it launches see this daemon's CLI shims
    // first on PATH, bound to this data dir and workspace, and no session
    // identity (see `session_env::apply_to_workspace_process`).
    crate::session_env::apply_to_workspace_process(&mut command, data_dir, &workspace_id);
    let before_run_ids = match &invocation {
        Invocation::Run { recipe_path } => {
            // A staged snapshot overrides the caller path: the runtime
            // loads the immutable approved bytes even if the recipe is
            // edited again before (or during) the run.
            command
                .arg("run")
                .arg(recipe_arg.as_deref().unwrap_or(*recipe_path));
            Some(run_record::list_run_directory_names(&workspace_root))
        }
        Invocation::Resume { mentu_run_id } => {
            command.arg("resume").arg(mentu_run_id);
            None
        }
        Invocation::RetryStep { mentu_run_id, step } => {
            command.arg("retry-step").arg(mentu_run_id).arg(step);
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

    let mut child = command.spawn().map_err(|e| {
        // A materialized snapshot for a failed spawn is historical
        // evidence of an attempted operation, never litter: the exact
        // approved bytes, manifest and argv are retained for audit and
        // ownership. Fresh run ids keep retries write-once, so a
        // retained snapshot can never collide with a later one.
        let _ = &snapshot_dir;
        error::io_error(format!("failed to start mentu-recipes: {e}"))
    })?;
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
        if let Invocation::Resume { mentu_run_id } | Invocation::RetryStep { mentu_run_id, .. } =
            &invocation
        {
            storage::set_mentu_run_id(&conn, &internal_id, mentu_run_id)?;
        }
    }

    let known_mentu_run_id = match &invocation {
        Invocation::Resume { mentu_run_id } | Invocation::RetryStep { mentu_run_id, .. } => {
            Some(mentu_run_id.to_string())
        }
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
    // Live progress: a second thread mirrors `mentu-recipes`'s own
    // `run.json` into the run row while the child is alive, so
    // `mentu.run_status` and `mentu.run_evidence` answer with the steps
    // that have already finished, not an empty list until exit. The
    // watcher flips `progress_done` once it has written the final row.
    let progress_done = Arc::new(AtomicBool::new(false));
    let poller_done = Arc::clone(&progress_done);
    let poller_db = Arc::clone(&db);
    let poller_workspace = workspace_root.clone();
    let poller_id = internal_id.clone();
    let poller_mentu_run_id = known_mentu_run_id.clone();
    let poller_before_ids = before_run_ids.clone();
    std::thread::spawn(move || {
        let mut mentu_run_id = poller_mentu_run_id;
        while !poller_done.load(Ordering::SeqCst) {
            if mentu_run_id.is_none() {
                mentu_run_id = poller_before_ids
                    .as_ref()
                    .and_then(|before| run_record::discover_new_run_id(&poller_workspace, before));
            }
            if let Some(id) = &mentu_run_id
                && let Ok(Some(run_json)) = run_record::read_run_json(&poller_workspace, id)
            {
                let conn = poller_db.lock().unwrap();
                let _ = storage::record_run_progress(&conn, &poller_id, id, &run_json);
            }
            // Short slices, so a run that exits mid-interval is finalized
            // by the watcher without the poller holding the connection.
            let wake = Instant::now() + PROGRESS_POLL_INTERVAL;
            while Instant::now() < wake && !poller_done.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(25));
            }
        }
    });
    std::thread::spawn(move || {
        let outcome = wait_bounded(&child_arc, &cancelled, run_timeout);
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
            attest_resources,
            attestation,
        );
        progress_done.store(true, Ordering::SeqCst);
    });

    storage::get_run(&db.lock().unwrap(), &internal_id)?
        .ok_or_else(|| error::internal_error("Work Graph run vanished immediately after insert."))
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
    attest_resources: Vec<(String, String)>,
    attestation: WorkspaceAttestation,
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

    let mentu_run_id = known_mentu_run_id
        .or_else(|| {
            // The live progress poller may already have discovered and
            // recorded the runtime's run id; prefer that over a second
            // directory diff, which could pick a different concurrent run.
            let conn = db.lock().unwrap();
            storage::get_run(&conn, internal_id)
                .ok()
                .flatten()
                .and_then(|run| run.mentu_run_id)
        })
        .or_else(|| {
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
            // The runtime's keyword completion is only a secondary signal;
            // re-check it against the recorded stdout with an anchored match
            // (not inside a fence, on the final line) and refuse a run whose
            // only completion evidence was a keyword printed in an example.
            let keyword_warning =
                run_record::keyword_completion_warning(workspace_root, &mentu_run_id, &run_json);
            let status = if keyword_warning.is_some() {
                MentuRunStatus::Failed
            } else {
                run_record::overall_status_with(&run_json, &steps, attestation)
            };
            let ended = run_record::ended_at(&run_json).unwrap_or_else(|| ended_at.clone());
            // Post-run attestation: resources pinned at approval are
            // re-hashed after the child exits. Drift means the run may
            // have read unapproved bytes mid-flight — disclosed on the
            // record, never silent. (A pre-spawn refusal already covers
            // drift before launch; this covers drift during the run.)
            let drift = attested_drift(
                workspace_root,
                daemon_home_prompts().as_deref(),
                &attest_resources,
            );
            let error_message = match (
                keyword_warning
                    .clone()
                    .or_else(|| run_record::unresolved_warning_with(&run_json, attestation))
                    .or_else(|| first_step_error(&steps, status)),
                drift.is_empty(),
            ) {
                (message, true) => message,
                (message, false) => {
                    let disclosure = format!(
                        "Relative resource(s) changed during execution ({}); the recorded \
                         result may reflect unapproved bytes — re-approve and retry.",
                        drift.join(", ")
                    );
                    Some(match message {
                        Some(previous) => format!("{previous}\n{disclosure}"),
                        None => disclosure,
                    })
                }
            };
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

// ---------------------------------------------------------------------------
// C03: approved execution selection + immutable execution snapshot.
//
// A run never executes the mutable recipe path. Instead `mentu.run`
// stages the exact approved bytes (plus the agent steps' effective
// selection and the pinned adapter/runtime identity) into a write-once
// snapshot dir, re-verifies it immediately before spawn, and passes the
// snapshot recipe path to the runtime. `--workspace` and the child cwd
// stay the workspace root, so run records, evidence, and step-relative
// resolution behave exactly as approved. Relative resources
// (`prompt_file`) are mirrored into the snapshot at their
// workspace-relative layout AND hash-pinned in the manifest: a runtime
// resolving against the recipe directory reads pinned bytes, while
// workspace-relative resolution meets bytes verified equal at spawn.
// Drift before launch refuses the run; drift during the run is disclosed
// on the run record by post-run attestation — B is never silently
// executed under A's approval.
//
// All selection verdicts here consume the real C01 APIs
// (`drogon_harness::{validate_selection, allowed efforts via
// selection, PiProviderBinding::validate}`) — never a re-derived table.
// Anything needing a live catalog probe or the runtime's own
// `adapters --json` (full `translate_selection`) is marked in the
// manifest as host-unverified until that wiring lands; static blocks
// (no registered adapter, bare-Pi false positive) refuse immediately
// with source-cited reasons.
// ---------------------------------------------------------------------------

use drogon_harness::{
    CONTRACT_DERIVED_FROM_REVISION, CONTRACT_DERIVED_FROM_VERSION, HarnessId, HarnessSelection,
    HostCatalog, PiProviderBinding,
};

use super::recipe::{self, AgentStepIdentity};
use super::runtime::{MENTU_LOCK_REVISION, MENTU_LOCK_VERSION};

/// Wire error code for a selection the pinned runtime cannot execute.
/// The message always names the exact unsupported combination and its
/// evidence; the run is refused, never relabeled as supported.
/// (Inline constructor, the `mentu_approval_consumed` precedent.)
pub const BACKEND_UNSUPPORTED_CODE: &str = "mentu_backend_unsupported";

/// Recipe bytes larger than this are refused a snapshot (mirrors the
/// 1 MiB recipe source limit; snapshots must stay small and auditable).
const SNAPSHOT_MAX_RECIPE_BYTES: u64 = 1024 * 1024;
/// One mirrored relative resource is capped like an evidence stream: big
/// binaries are recorded as skipped, never pulled into the snapshot.
const SNAPSHOT_MAX_RESOURCE_BYTES: u64 = 512 * 1024;

/// One agent step's host-checked execution selection, recorded with the
/// run. `notes` carries the honesty context (unverified scope, Pi tool
/// restrictions, runtime-owned backends) the UI renders next to the
/// selection instead of a bare label.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedAgentStep {
    pub label: String,
    /// The recipe step backend (for Pi: the providers-map binding name).
    pub backend: String,
    /// The exact model id the recipe carries, if any.
    pub model: Option<String>,
    /// The backend name the runtime adapter resolves.
    pub adapter_backend: String,
    pub notes: Vec<String>,
}

/// The pinned runtime identity every selection is validated against.
/// Fail-closed: when the core lock drifts from the revision C01's
/// translation table was source-derived from, validation refuses rather
/// than silently re-deriving across runtime versions.
pub fn approved_runtime_identity() -> Result<drogon_harness::MentuRuntimeIdentity, RpcError> {
    if MENTU_LOCK_VERSION != CONTRACT_DERIVED_FROM_VERSION
        || MENTU_LOCK_REVISION != CONTRACT_DERIVED_FROM_REVISION
    {
        return Err(error::internal_error(
            "Mentu runtime lock drifted from the revision the executable-translation \
             table was derived from; refusing selection validation until the table is \
             re-derived.",
        ));
    }
    Ok(drogon_harness::MentuRuntimeIdentity {
        version: MENTU_LOCK_VERSION.to_string(),
        revision: MENTU_LOCK_REVISION.to_string(),
    })
}

fn unsupported(reason: String, evidence: &'static str) -> RpcError {
    RpcError::new(
        BACKEND_UNSUPPORTED_CODE,
        format!("{reason} Evidence: {evidence}."),
    )
}

/// An honestly-degraded host catalog for harnesses that expose no model
/// enumeration surface (`claude`, `codex`): availability comes from a
/// PATH lookup only (no child spawned), entries are empty by construction,
/// and the scope note says exactly that. `validate_selection` against it
/// yields `ManualUnverified` — carried with the note, never upgraded — or
/// `NotInstalled` when the executable is absent, which refuses the run.
fn no_surface_catalog(harness: HarnessId) -> HostCatalog {
    let path = std::env::var_os("PATH");
    let executable = drogon_harness::resolve_executable(harness.executable(), path.as_deref());
    HostCatalog {
        harness,
        availability: if executable.is_some() {
            drogon_harness::HarnessAvailability::Available
        } else {
            drogon_harness::HarnessAvailability::Missing
        },
        executable,
        provenance: None,
        entries: Vec::new(),
        status: drogon_harness::EnumerationStatus::UnsupportedSurface,
        note: Some(
            "host PATH lookup only; this harness exposes no model enumeration surface and \
             catalog probing is not yet wired, so the model id rides unverified"
                .to_string(),
        ),
    }
}

fn harness_for_backend(backend: &str) -> Option<HarnessId> {
    match backend.to_ascii_lowercase().as_str() {
        "claude" => Some(HarnessId::Claude),
        "codex" => Some(HarnessId::Codex),
        "opencode" => Some(HarnessId::Opencode),
        "antigravity" | "agy" => Some(HarnessId::Antigravity),
        _ => None,
    }
}

/// The silent-HTTP-downgrade guard for one resolved provider binding.
///
/// The pinned `mentu-recipes` runtime selects the tool-enabled provider-config
/// adapter only when the entry carries `"api": "cli"`. A missing key, or any
/// other value, makes it issue a bare chat completion — no system prompt, no
/// tools, `tools: null` on the wire — and the step is still stamped `ok`, so
/// the run reads as a success while the model could not touch anything. The
/// refusal names the field and cites the runtime's ProviderConfig resolution,
/// so a binding that would degrade silently never reaches the runtime.
fn validate_provider_binding_api(
    step_label: &str,
    backend: &str,
    entry: &serde_json::Value,
) -> Result<(), RpcError> {
    match entry.get("api").and_then(serde_json::Value::as_str) {
        Some("cli") => Ok(()),
        Some(other) => Err(unsupported(
            format!(
                "Step '{step_label}' resolves provider binding '{backend}' whose \"api\" is \
                 {other:?}; only \"api\": \"cli\" reaches the provider-config adapter that gives \
                 the model tools. Any other api silently degrades the agent step to a bare chat \
                 completion with no tools."
            ),
            "mentu-recipes ProviderConfig.api / PiCLIAdapter provider-config resolution",
        )),
        None => Err(unsupported(
            format!(
                "Step '{step_label}' resolves provider binding '{backend}' that omits the required \
                 \"api\": \"cli\" field; without it the runtime silently degrades the agent step \
                 to a bare chat completion with no tools."
            ),
            "mentu-recipes ProviderConfig.api / PiCLIAdapter provider-config resolution",
        )),
    }
}

/// Validates one agent step's execution selection against the pinned
/// runtime contract without spawning anything (no catalog probe, no
/// `adapters --json`, no inference): pure planning over the recipe JSON
/// plus a PATH lookup. Returns the record the snapshot manifest stores.
///
/// Refusals (exact unsupported combinations, never silent substitution):
/// - `opencode`/`antigravity`: the pinned runtime registers no such
///   adapter (`Adapters.swift AdapterRegistry`; `unknown_backend` under
///   `doctor --strict` for opencode, verified against the locked binary).
/// - A bare `pi` backend (or alias) with no matching `providers` entry:
///   passes `check`/`doctor --strict` yet `PiCLIAdapter.execute`
///   unconditionally throws without an explicit provider — the documented
///   false positive. A matching entry is shape-checked with the real
///   [`PiProviderBinding::validate`], including the effective-model rule
///   (`request.model ?? config.model`): a step model disagreeing with the
///   binding's exact model is refused, never substituted.
/// - A `pi` step carrying `reasoning`/`thinking` overrides (only
///   `thinking: "off"` is tolerated), per `PiCLIAdapter.execute`.
/// - A `claude`/`codex` harness whose executable is not on PATH.
/// - Malformed model ids (the `plan_launch` shape rules, via
///   [`drogon_harness::validate_selection`]).
///
/// Everything else is carried with notes: `claude`/`codex` models ride
/// manual-unverified (enumeration surface absent), and non-harness
/// backends (`openai`, `deepseek`, `ollama`, custom) are runtime-owned
/// with no host verdict either way.
fn validate_one_agent_step(
    step: &AgentStepIdentity,
    providers: Option<&serde_json::Value>,
    full_step: &serde_json::Value,
) -> Result<ValidatedAgentStep, RpcError> {
    let _identity = approved_runtime_identity()?;
    // A providers-map key whose entry selects the Pi adapter is a Pi
    // binding even when the key is an alias, not the literal "pi".
    let pi_entry = providers
        .and_then(|p| p.as_object())
        .and_then(|map| map.get(&step.backend))
        .filter(|entry| entry.get("agent").and_then(serde_json::Value::as_str) == Some("pi"));
    // Silent-degradation seam (the eval's worst): the pinned runtime treats a
    // binding without `"api": "cli"` as a bare chat completion — no system
    // prompt, no tools, `tools: null` on the wire — and stamps the run `ok`
    // anyway. This guard refuses such a binding by name, for every agent
    // backend that resolves a providers entry, before it can be handed over.
    if let Some(entry) = providers
        .and_then(|p| p.as_object())
        .and_then(|map| map.get(&step.backend))
    {
        validate_provider_binding_api(&step.label, &step.backend, entry)?;
    }
    if pi_entry.is_some() || step.backend.eq_ignore_ascii_case("pi") {
        return validate_pi_step(step, providers, full_step);
    }
    match harness_for_backend(&step.backend) {
        None => Ok(ValidatedAgentStep {
            label: step.label.clone(),
            backend: step.backend.clone(),
            model: step.model.clone(),
            adapter_backend: step.backend.clone(),
            notes: vec![format!(
                "backend '{}' is runtime-owned (not a Drogon harness selection); no host verdict",
                step.backend
            )],
        }),
        Some(HarnessId::Opencode) => Err(unsupported(
            format!(
                "Step '{}' selects backend '{}', which mentu-recipes {} cannot execute: no \
                 opencode adapter is registered",
                step.label, step.backend, MENTU_LOCK_VERSION
            ),
            "Adapters.swift AdapterRegistry.adapter + live doctor --strict unknown_backend",
        )),
        Some(HarnessId::Antigravity) => Err(unsupported(
            format!(
                "Step '{}' selects backend '{}', which mentu-recipes {} cannot execute: no \
                 antigravity adapter is registered",
                step.label, step.backend, MENTU_LOCK_VERSION
            ),
            "Adapters.swift AdapterRegistry.adapter",
        )),
        Some(harness @ (HarnessId::Claude | HarnessId::Codex)) => {
            let selection = HarnessSelection {
                harness,
                provider: None,
                model: step.model.clone(),
                effort: None,
            };
            let catalog = no_surface_catalog(harness);
            match drogon_harness::validate_selection(&selection, &catalog) {
                drogon_harness::SelectionVerdict::ManualUnverified { reason, .. } => {
                    Ok(ValidatedAgentStep {
                        label: step.label.clone(),
                        backend: step.backend.clone(),
                        model: step.model.clone(),
                        adapter_backend: step.backend.clone(),
                        notes: vec![format!("model id rides manual-unverified: {reason}")],
                    })
                }
                drogon_harness::SelectionVerdict::NotInstalled => Err(unsupported(
                    format!(
                        "Step '{}' selects '{}', but no '{}' executable was found on PATH on this host",
                        step.label,
                        step.backend,
                        harness.executable()
                    ),
                    "host PATH lookup (no enumeration surface to consult)",
                )),
                drogon_harness::SelectionVerdict::Malformed { field, reason } => {
                    Err(error::invalid_argument(format!(
                        "Step '{}' carries a malformed {field}: {reason}",
                        step.label
                    )))
                }
                // Unreachable without enumeration entries (empty catalog +
                // unsupported surface can only yield the arms above), but
                // refuting verdicts must refuse rather than fall through.
                other => Err(unsupported(
                    format!(
                        "Step '{}' selection is refuted by the host catalog: {other:?}",
                        step.label
                    ),
                    "host catalog verdict (no fictitious combinations)",
                )),
            }
        }
        // `pi` never surfaces from `harness_for_backend` (it rides the
        // providers-map branch above), but a literal pi backend that
        // somehow reaches here validates as pi all the same.
        Some(HarnessId::Pi) => validate_pi_step(step, providers, full_step),
    }
}

/// The Pi branch of [`validate_one_agent_step`]: the step backend names a
/// providers-map binding (or is the literal `pi`, which then must still
/// resolve to one). Consumes the real [`PiProviderBinding::validate`] and
/// mirrors `translate_selection`'s effective-model and override rules so
/// the refusal vocabulary matches the translator exactly; the full
/// adapters-evidence translation plugs in once that wiring lands.
fn validate_pi_step(
    step: &AgentStepIdentity,
    providers: Option<&serde_json::Value>,
    full_step: &serde_json::Value,
) -> Result<ValidatedAgentStep, RpcError> {
    if full_step
        .get("reasoning")
        .and_then(serde_json::Value::as_str)
        .is_some()
    {
        return Err(unsupported(
            format!(
                "Step '{}' carries a reasoning override on a pi backend, which PiCLIAdapter rejects",
                step.label
            ),
            "PiCLIAdapter.swift execute guard on reasoning/thinking",
        ));
    }
    if let Some(thinking) = full_step
        .get("thinking")
        .and_then(serde_json::Value::as_str)
        && thinking != "off"
    {
        return Err(unsupported(
            format!(
                "Step '{}' carries thinking {:?} on a pi backend, which PiCLIAdapter rejects (only 'off' is tolerated)",
                step.label, thinking
            ),
            "PiCLIAdapter.swift execute guard on reasoning/thinking",
        ));
    }
    let entry = providers
        .and_then(|p| p.as_object())
        .and_then(|map| map.get(&step.backend));
    let Some(entry) = entry else {
        return Err(unsupported(
            format!(
                "Step '{}' selects pi backend '{}' with no matching providers entry: a bare pi step \
                 passes check and doctor --strict yet PiCLIAdapter.execute unconditionally throws \
                 'Pi requires an explicit provider'. Supply the binding (base_url + exact model + one \
                 credential source) in the recipe providers map",
                step.label, step.backend
            ),
            "PiCLIAdapter.swift execute guard + live check/doctor evidence (score 100, no findings)",
        ));
    };
    let entry_model = entry.get("model").and_then(serde_json::Value::as_str);
    // Effective model FIRST (`request.model ?? config.model`): disagreeing
    // ids refuse, an omitted step model resolves to the binding's exact id.
    let effective_model = match (&step.model, entry_model) {
        (Some(selected), Some(bound)) if selected != bound => {
            return Err(unsupported(
                format!(
                    "Step '{}' names model {selected:?} but the pi binding '{}' carries exact model \
                     ID {bound:?}; translating would silently substitute one for the other",
                    step.label, step.backend
                ),
                "PiCLIAdapter.swift request.model ?? config.model mapping",
            ));
        }
        (Some(selected), _) => Some(selected.clone()),
        (None, Some(bound)) => Some(bound.to_string()),
        (None, None) => None,
    };
    let Some(effective_model) = effective_model else {
        return Err(unsupported(
            format!(
                "Step '{}' pi binding '{}' names no exact model ID (neither the step nor the binding carries one)",
                step.label, step.backend
            ),
            "PiCLIAdapter.swift execute guard (exact model ID required)",
        ));
    };
    let binding = PiProviderBinding {
        provider_name: step.backend.clone(),
        api: entry
            .get("api")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string(),
        base_url: entry
            .get("base_url")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string(),
        model: effective_model.clone(),
        api_key_env: entry
            .get("api_key_env")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        api_key_vault: entry
            .get("api_key_vault")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
    };
    if let Err(reason) = binding.validate() {
        return Err(unsupported(
            format!(
                "Step '{}' pi binding '{}' is not executable-shaped: {reason}",
                step.label, step.backend
            ),
            "PiCLIAdapter.swift base_url/credential guards",
        ));
    }
    // The EFFECTIVE selection is what the host verdict rests on, so a
    // binding model the host never enumerated cannot bypass the checks
    // through an omitted step model.
    let effective_selection = HarnessSelection {
        harness: HarnessId::Pi,
        provider: None,
        model: Some(effective_model.clone()),
        effort: None,
    };
    let catalog = no_surface_catalog(HarnessId::Pi);
    let verdict = drogon_harness::validate_selection(&effective_selection, &catalog);
    let mut notes = vec![
        "pi step executes through a provider-config adapter, not bare 'pi'".to_string(),
        "PiCLIAdapter requires Pi >= 0.84.1 and Node >= 22.19 on the execution host and \
         restricts tools to read/bash/edit/write/grep/find/ls"
            .to_string(),
    ];
    match verdict {
        drogon_harness::SelectionVerdict::ManualUnverified { reason, .. } => {
            notes.push(format!("model id rides manual-unverified: {reason}"));
        }
        drogon_harness::SelectionVerdict::NotInstalled => {
            return Err(unsupported(
                format!(
                    "Step '{}' selects pi, but no 'pi' executable was found on PATH on this host",
                    step.label
                ),
                "host PATH lookup (no enumeration surface to consult)",
            ));
        }
        drogon_harness::SelectionVerdict::Malformed { field, reason } => {
            return Err(error::invalid_argument(format!(
                "Step '{}' carries a malformed {field}: {reason}",
                step.label
            )));
        }
        other => {
            return Err(unsupported(
                format!(
                    "Step '{}' selection is refuted by the host catalog: {other:?}",
                    step.label
                ),
                "host catalog verdict (no fictitious combinations)",
            ));
        }
    }
    if step.model.is_none() {
        notes.push(
            "model omitted on the step; executing the binding's exact model ID, owned by the \
             caller's credential resolution"
                .to_string(),
        );
    }
    Ok(ValidatedAgentStep {
        label: step.label.clone(),
        backend: step.backend.clone(),
        model: Some(effective_model),
        adapter_backend: step.backend.clone(),
        notes,
    })
}

/// Validates every agent step's execution selection in a parsed recipe.
/// Shell steps are skipped (no selection to validate); runtime-owned
/// backends are carried with notes. Pure computation over the recipe JSON
/// plus PATH lookups — no probe, no spawn, no inference.
pub fn validate_agent_execution(
    recipe: &serde_json::Value,
) -> Result<Vec<ValidatedAgentStep>, RpcError> {
    let steps = recipe::list_agent_steps(recipe)?;
    let providers = recipe.get("providers");
    let full_steps: Vec<serde_json::Value> = recipe
        .get("steps")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let full_by_label = |label: &str| {
        full_steps
            .iter()
            .find(|s| s.get("label").and_then(serde_json::Value::as_str) == Some(label))
    };
    steps
        .iter()
        .map(|step| {
            let full = full_by_label(&step.label)
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            validate_one_agent_step(step, providers, &full)
        })
        .collect()
}

/// One relative resource pinned in the snapshot: its workspace-relative
/// path, sha256 and exact bytes (mirrored under `resources/`).
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotResource {
    pub path: String,
    pub sha256: String,
    pub bytes_len: u64,
}

/// The staged (not yet run-bound) approved snapshot: exact recipe bytes +
/// validated agent selections + mirrored relative resources. Created by
/// [`stage_approved_snapshot`], materialized per run by
/// [`materialize_snapshot`], re-verified before spawn by
/// [`verify_staged_fresh`]. Filesystem reads only — never executes.
#[derive(Clone, Debug)]
pub struct StagedSnapshot {
    pub recipe_id: String,
    pub content_hash: String,
    pub recipe_bytes: Vec<u8>,
    pub recipe_file_name: String,
    pub resources: Vec<(SnapshotResource, Vec<u8>)>,
    pub skipped_resources: Vec<String>,
    pub steps: Vec<ValidatedAgentStep>,
}

/// The snapshot manifest stored alongside the immutable bytes: the
/// effective selection plus the pinned adapter/runtime version recorded
/// with the run. `cwd` is the workspace root the snapshot preserves;
/// `resources` pins every mirrored relative file by hash.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotManifest {
    pub version: u32,
    pub recipe_id: String,
    pub content_hash: String,
    pub run_id: String,
    pub created_at: String,
    pub cwd: String,
    pub recipe_path: String,
    pub workspace_root: String,
    pub runtime: SnapshotRuntime,
    /// The exact argv the launch used: runtime, `run`, snapshot recipe
    /// path, `--workspace`, workspace root — auditable proof of what the
    /// pinned runtime was asked to load.
    pub argv: Vec<String>,
    pub steps: Vec<ValidatedAgentStep>,
    pub resources: Vec<SnapshotResource>,
    pub skipped_resources: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRuntime {
    pub version: String,
    pub revision: String,
}

/// The snapshot root INSIDE the workspace's admitted recipes tree:
/// `<workspace>/.mentu/recipes/.snapshots`. The pinned `mentu-recipes`
/// 0.5.0 runtime resolves a recipe path only against an admitted recipes
/// root — the workspace's `.mentu/recipes` or the home's — and answers
/// "Recipe not found" for anything else (verified against the pinned
/// binary: `.mentu/snapshots/...` is refused, `.mentu/recipes/.snapshots/...`
/// is admitted, and the hidden directory stays out of `mentu-recipes list`).
/// Materializing inside the recipes tree is what makes the approved
/// immutable bytes loadable without weakening the runner's own admission.
fn snapshot_root(workspace_root: &Path) -> PathBuf {
    workspace_root
        .join(".mentu")
        .join("recipes")
        .join(".snapshots")
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = sha2::Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn valid_run_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Collects the `prompt_file` references in `steps`, rooted at the
/// workspace's `.mentu/prompts/` — the ONLY location the pinned
/// `mentu-recipes` 0.5.0 runtime resolves `prompt_file` from (verified
/// against the pinned binary: a file beside the recipe, in the workspace
/// cwd, or at any other workspace-relative path is never read; the step
/// fails "has no prompt or prompt_file"). Lookup is two-tier, in runner
/// order: `<workspace>/.mentu/prompts/<rel>` first, then
/// `<home>/.mentu/prompts/<rel>` — the reference itself is the bare
/// name, never a `.mentu/prompts`-prefixed path (that would
/// double-prefix). Absolute paths and `..` escapes are skipped with a
/// note (never followed); surviving entries resolve containment-checked
/// against the tier that admitted them. `Path` joins only —
/// spaces/Unicode flow through untouched, no shell involved. The staged
/// bytes are the approval-bound mirror; the runner reads the live file
/// from the admitting tier, and spawn-time plus post-run drift
/// attestation (`attested_drift`) discloses any divergence from these
/// pinned digests.
fn collect_snapshot_resources(
    workspace_root: &Path,
    workspace_real: &Path,
    home_prompts: Option<&Path>,
    steps: &[serde_json::Value],
) -> (Vec<(SnapshotResource, Vec<u8>)>, Vec<String>) {
    let workspace_prompts = workspace_root.join(".mentu").join("prompts");
    let mut resources = Vec::new();
    let mut skipped = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for step in steps {
        let Some(rel) = step.get("prompt_file").and_then(serde_json::Value::as_str) else {
            continue;
        };
        if rel.is_empty() || rel.contains('\0') {
            skipped.push(format!("{rel}: not a readable relative reference"));
            continue;
        }
        let rel_path = Path::new(rel);
        if rel_path.is_absolute()
            || rel_path
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            skipped.push(format!("{rel}: outside the workspace, not mirrored"));
            continue;
        }
        if !seen.insert(rel.to_string()) {
            continue;
        }
        // Two-tier lookup in runner order: the workspace's prompts root
        // first, then the home's (the caller passes it pre-canonicalized;
        // `None` when there is no home). The admitting tier's canonical
        // root is the containment boundary for that resource.
        let mut tiers: Vec<(PathBuf, PathBuf)> =
            vec![(workspace_prompts.clone(), workspace_real.to_path_buf())];
        if let Some((root, home_real)) =
            home_prompts.and_then(|home| fs::canonicalize(home).ok().map(|real| (home, real)))
        {
            // The boundary is canonicalized so symlinked homes (macOS
            // temp dirs, /home -> /usr/home) cannot quietly reject an
            // admitted resource.
            tiers.push((root.to_path_buf(), home_real));
        }
        let mut found: Option<(std::path::PathBuf, std::path::PathBuf)> = None;
        for (root, boundary) in &tiers {
            if let Some(real) = fs::canonicalize(root.join(rel_path))
                .ok()
                .filter(|real| real.is_file() && real.starts_with(boundary))
            {
                found = Some((real, boundary.clone()));
                break;
            }
        }
        let Some((real, _boundary)) = found else {
            skipped.push(format!("{rel}: unreadable at approval time"));
            continue;
        };
        let Ok(meta) = fs::metadata(&real) else {
            skipped.push(format!("{rel}: unreadable at approval time"));
            continue;
        };
        if meta.len() > SNAPSHOT_MAX_RESOURCE_BYTES {
            skipped.push(format!(
                "{rel}: larger than the {} KiB mirror cap, runs against the live file",
                SNAPSHOT_MAX_RESOURCE_BYTES / 1024
            ));
            continue;
        }
        match fs::read(&real) {
            Ok(bytes) => {
                let hash = sha256_hex(&bytes);
                resources.push((
                    SnapshotResource {
                        path: rel.replace('\\', "/"),
                        sha256: hash,
                        bytes_len: bytes.len() as u64,
                    },
                    bytes,
                ));
            }
            Err(_) => skipped.push(format!("{rel}: unreadable at approval time")),
        }
    }
    (resources, skipped)
}

/// Stages the approved snapshot for `recipe_id` whose exact on-disk bytes
/// must still hash to `content_hash` (the approval-bound hash): mismatch
/// refuses with the re-approval message, the same vocabulary `mentu.run`
/// already uses. Reads and validates only — the caller materializes per
/// run and re-verifies immediately before spawn.
pub fn stage_approved_snapshot(
    workspace_root: &Path,
    home_prompts: Option<&Path>,
    recipe_id: &str,
    content_hash: &str,
) -> Result<StagedSnapshot, RpcError> {
    let recipe_path = recipe::resolve_recipe_path(workspace_root, recipe_id)?;
    let meta = fs::metadata(&recipe_path).map_err(|e| error::io_error(e.to_string()))?;
    if meta.len() > SNAPSHOT_MAX_RECIPE_BYTES {
        return Err(error::invalid_argument(
            "Recipe source exceeds the 1 MiB safety limit.",
        ));
    }
    let bytes = fs::read(&recipe_path).map_err(|e| error::io_error(e.to_string()))?;
    if sha256_hex(&bytes) != content_hash {
        return Err(error::invalid_argument(
            "Recipe content changed since approval; re-approve before running.",
        ));
    }
    let source = String::from_utf8(bytes.clone())
        .map_err(|_| error::invalid_argument("Recipe source is not valid UTF-8."))?;
    let recipe: serde_json::Value = serde_json::from_str(&source)
        .map_err(|e| error::invalid_argument(format!("Invalid JSON: {e}")))?;
    // Same bar as the load path: the snapshot never carries bytes the
    // recipe reader could not serve back.
    recipe::load_recipe(workspace_root, recipe_id)?;
    let steps = validate_agent_execution(&recipe)?;
    let workspace_real = fs::canonicalize(workspace_root)
        .map_err(|_| error::not_found("Workspace is unavailable."))?;
    let full_steps: Vec<serde_json::Value> = recipe
        .get("steps")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let (resources, skipped_resources) =
        collect_snapshot_resources(workspace_root, &workspace_real, home_prompts, &full_steps);
    let recipe_file_name = recipe_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| error::invalid_argument("Invalid Work Graph recipe reference."))?
        .to_string();
    // A relative resource that would land on the snapshot's own files
    // (the recipe copy or the manifest) is refused loudly: silently
    // skipping it would leave the runtime reading the live file while
    // the manifest claims a pinned copy.
    for (resource, _) in &resources {
        if resource.path == recipe_file_name || resource.path == "manifest.json" {
            return Err(error::invalid_argument(format!(
                "Relative resource '{}' collides with the execution snapshot layout; \
                 rename it before approving.",
                resource.path
            )));
        }
    }
    Ok(StagedSnapshot {
        recipe_id: recipe_id.to_string(),
        content_hash: content_hash.to_string(),
        recipe_bytes: bytes,
        recipe_file_name,
        resources,
        skipped_resources,
        steps,
    })
}

/// Re-verifies staged bytes against the live workspace immediately before
/// spawn: the recipe hash plus every mirrored resource. Any drift refuses
/// the launch — it must never silently execute B after approving A.
pub fn verify_staged_fresh(
    workspace_root: &Path,
    home_prompts: Option<&Path>,
    staged: &StagedSnapshot,
) -> Result<(), RpcError> {
    let current = recipe::current_content_hash(workspace_root, &staged.recipe_id)?;
    if current != staged.content_hash {
        return Err(error::invalid_argument(
            "Recipe content changed since approval; re-approve before running.",
        ));
    }
    // The same two lookup roots the pinned runner resolves prompt_file
    // from, in the same order. Each admitted resource must still exist,
    // stay inside its admitting tier, and hash to the approved digest.
    let workspace_prompts = workspace_root.join(".mentu").join("prompts");
    let workspace_real = fs::canonicalize(workspace_root)
        .map_err(|_| error::not_found("Workspace is unavailable."))?;
    let mut roots = vec![(workspace_prompts, workspace_real)];
    if let Some((root, home_real)) =
        home_prompts.and_then(|home| fs::canonicalize(home).ok().map(|real| (home, real)))
    {
        roots.push((root.to_path_buf(), home_real));
    }
    for (resource, _) in &staged.resources {
        let found = roots.iter().find_map(|(root, boundary)| {
            let real = fs::canonicalize(root.join(&resource.path)).ok()?;
            (real.is_file() && real.starts_with(boundary)).then_some(real)
        });
        let real = found.ok_or_else(|| {
            error::invalid_argument(format!(
                "Relative resource '{}' changed since approval; re-approve before running.",
                resource.path
            ))
        })?;
        let bytes = fs::read(&real).map_err(|_| {
            error::invalid_argument(format!(
                "Relative resource '{}' changed since approval; re-approve before running.",
                resource.path
            ))
        })?;
        if sha256_hex(&bytes) != resource.sha256 {
            return Err(error::invalid_argument(format!(
                "Relative resource '{}' changed since approval; re-approve before running.",
                resource.path
            )));
        }
    }
    Ok(())
}

/// Reads one live resource for attestation with a bounded pull: at most
/// one byte past the mirror cap. A file that grew past the cap reads as
/// drifted without loading it fully into memory.
fn read_live_resource_capped(path: &Path) -> Option<Vec<u8>> {
    use std::io::Read as _;
    let mut file = fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    // One past the cap is enough to prove "changed".
    let cap = (SNAPSHOT_MAX_RESOURCE_BYTES + 1) as usize;
    file.by_ref()
        .take(cap as u64)
        .read_to_end(&mut bytes)
        .ok()?;
    Some(bytes)
}

/// Post-run attestation over staged `(path, sha256)` pairs: returns the
/// workspace-relative paths whose live bytes no longer match the
/// approval-pinned hash (missing, escaped-containment, or
/// content-drifted). Pure reads — the caller discloses, never rewrites.
/// The daemon's home prompts root (`$HOME/.mentu/prompts`) — the
/// runner's second lookup tier — canonicalized best-effort. `None` when
/// HOME is unset or the path is unavailable; the runner itself would
/// also fail to read from a missing root, so `None` is honest.
pub fn daemon_home_prompts() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME")?;
    let root = std::path::PathBuf::from(home)
        .join(".mentu")
        .join("prompts");
    fs::canonicalize(&root).ok()
}

fn attested_drift(
    workspace_root: &Path,
    home_prompts: Option<&Path>,
    staged: &[(String, String)],
) -> Vec<String> {
    if staged.is_empty() {
        return Vec::new();
    }
    // The same two lookup roots the pinned runner reads prompt_file
    // from, in the same order: the workspace's prompts root first, then
    // the home's. A resource absent from BOTH tiers is drifted.
    let workspace_prompts = workspace_root.join(".mentu").join("prompts");
    let mut roots = vec![workspace_prompts];
    roots.extend(home_prompts.map(Path::to_path_buf));
    let mut drifted = Vec::new();
    for (rel, pinned) in staged {
        let matches = roots
            .iter()
            .find_map(|root| {
                // The first tier that HAS the file decides: a drifted
                // workspace copy must not fall through to a matching
                // home copy, because the runner reads the workspace one.
                let real = fs::canonicalize(root.join(rel)).ok()?;
                if !real.is_file() {
                    return None;
                }
                Some(
                    read_live_resource_capped(&real)
                        .is_some_and(|bytes| sha256_hex(&bytes) == *pinned),
                )
            })
            .unwrap_or(false);
        if !matches {
            drifted.push(rel.clone());
        }
    }
    drifted
}

/// Materialized (run-bound, write-once) snapshot paths.
pub struct MaterializedSnapshot {
    pub dir: PathBuf,
    /// The recipe path to pass as the runtime `run` argument. It keeps
    /// the recipe's own file name (not a fixed `recipe.json`) so
    /// file-stem-keyed fixture runtimes keep addressing the same recipe.
    pub recipe_path: PathBuf,
}

/// Materializes `staged` under `.mentu/recipes/.snapshots/<run_id>/`: the
/// exact approved recipe bytes, the mirrored pinned resource bytes laid
/// out at their prompts-relative paths (the runner reads the LIVE
/// `.mentu/prompts/<rel>` file — see `collect_snapshot_resources` — so
/// this mirror is the run-bound audit copy of what approval pinned), and
/// `manifest.json` recording the effective selection, the exact argv, and
/// the pinned adapter/runtime version with the run. Write-once: an
/// existing dir is never overwritten.
/// `--workspace` and the child cwd intentionally stay the workspace root
/// (run records and evidence keep their established locations, and step
/// `dir`/shell relatives resolve exactly as approved); the manifest pins
/// `cwd` so the intended working directory survives moves.
pub fn materialize_snapshot(
    workspace_root: &Path,
    run_id: &str,
    staged: &StagedSnapshot,
    argv: &[String],
) -> Result<MaterializedSnapshot, RpcError> {
    if !valid_run_id(run_id) {
        return Err(error::invalid_argument("Invalid Work Graph run identity."));
    }
    let dir = snapshot_root(workspace_root).join(run_id);
    // `create_dir` (not `create_dir_all` on the leaf): an existing
    // snapshot dir is never overwritten — immutability is structural.
    if let Some(parent) = dir.parent() {
        fs::create_dir_all(parent).map_err(|e| error::io_error(e.to_string()))?;
    }
    fs::create_dir(&dir)
        .map_err(|e| error::io_error(format!("snapshot for run {run_id} already exists: {e}")))?;
    let recipe_path = dir.join(&staged.recipe_file_name);
    // Any failure after the dir exists removes the partial snapshot so a
    // later retry with the same run id cannot observe half a snapshot.
    let failed = |dir: &Path| {
        let _ = fs::remove_dir_all(dir);
    };
    if let Err(e) = fs::write(&recipe_path, &staged.recipe_bytes) {
        failed(&dir);
        return Err(error::io_error(e.to_string()));
    }
    for (resource, bytes) in &staged.resources {
        // Workspace-relative layout: the mirror sits where the reference
        // points. A resource colliding with the snapshot's own files is
        // refused at stage time (see `stage_approved_snapshot`), so this
        // target can never be the recipe or the manifest.
        let target = dir.join(&resource.path);
        if let Some(parent) = target.parent()
            && fs::create_dir_all(parent).is_err()
        {
            failed(&dir);
            return Err(error::io_error(format!(
                "cannot mirror resource '{}'",
                resource.path
            )));
        }
        if fs::write(&target, bytes).is_err() {
            failed(&dir);
            return Err(error::io_error(format!(
                "cannot mirror resource '{}'",
                resource.path
            )));
        }
    }
    let manifest = SnapshotManifest {
        version: 1,
        recipe_id: staged.recipe_id.clone(),
        content_hash: staged.content_hash.clone(),
        run_id: run_id.to_string(),
        created_at: crate::now_rfc3339(),
        cwd: workspace_root.to_string_lossy().into_owned(),
        recipe_path: recipe_path.to_string_lossy().into_owned(),
        workspace_root: workspace_root.to_string_lossy().into_owned(),
        runtime: SnapshotRuntime {
            version: MENTU_LOCK_VERSION.to_string(),
            revision: MENTU_LOCK_REVISION.to_string(),
        },
        argv: argv.to_vec(),
        steps: staged.steps.clone(),
        resources: staged.resources.iter().map(|(r, _)| r.clone()).collect(),
        skipped_resources: staged.skipped_resources.clone(),
    };
    let text = serde_json::to_string_pretty(&manifest)
        .map_err(|e| error::internal_error(e.to_string()))?;
    if fs::write(dir.join("manifest.json"), format!("{text}\n")).is_err() {
        failed(&dir);
        return Err(error::io_error("cannot write snapshot manifest."));
    }
    Ok(MaterializedSnapshot { dir, recipe_path })
}

#[cfg(test)]
mod timeout_tests {
    use super::*;

    #[test]
    fn explicit_step_budgets_outlive_the_recipe_they_guard() {
        let recipe = serde_json::json!({
            "steps": [
                { "label": "main", "timeout": crate::graph::compiler::AGENT_STEP_TIMEOUT_SECONDS },
                { "label": "verify", "timeout": crate::graph::compiler::SHELL_STEP_TIMEOUT_SECONDS }
            ]
        });
        let timeout = recipe_run_timeout(&serde_json::to_vec(&recipe).unwrap());
        assert_eq!(
            timeout,
            Duration::from_secs(
                crate::graph::compiler::AGENT_STEP_TIMEOUT_SECONDS
                    + crate::graph::compiler::SHELL_STEP_TIMEOUT_SECONDS
                    + (2 * RUNTIME_PROCESS_TEARDOWN.as_secs())
                    + DECLARED_TIMEOUT_GRACE.as_secs()
            ) + workspace_baseline_budget().saturating_mul(5)
        );
        assert!(
            timeout > Duration::from_secs(crate::graph::compiler::AGENT_STEP_TIMEOUT_SECONDS),
            "the daemon watchdog must not preempt a valid graph step"
        );
    }

    #[test]
    fn short_explicit_and_partially_undeclared_budgets_stay_safe() {
        assert_eq!(
            recipe_run_timeout(br#"{"steps":[{"label":"main","timeout":30}]}"#),
            Duration::from_secs(30)
                + RUNTIME_PROCESS_TEARDOWN
                + DECLARED_TIMEOUT_GRACE
                + workspace_baseline_budget().saturating_mul(3)
        );
        assert_eq!(
            recipe_run_timeout(br#"{"steps":[{"label":"main","timeout":30},{"label":"verify"}]}"#),
            Duration::from_secs(30 + 30 * 60)
                + (2 * RUNTIME_PROCESS_TEARDOWN)
                + DECLARED_TIMEOUT_GRACE
                + workspace_baseline_budget().saturating_mul(5)
        );
    }

    #[test]
    fn declared_retries_and_backoff_are_part_of_the_outer_budget() {
        let recipe =
            br#"{"steps":[{"label":"main","timeout":30,"max_retries":2,"retry_backoff_ms":2500}]}"#;
        assert_eq!(
            recipe_run_timeout(recipe),
            Duration::from_secs(95)
                + (3 * RUNTIME_PROCESS_TEARDOWN)
                + DECLARED_TIMEOUT_GRACE
                + workspace_baseline_budget().saturating_mul(3)
        );
    }

    #[test]
    fn verification_and_hook_limits_are_part_of_the_outer_budget() {
        let recipe = br#"{
            "hooks": {
                "before_run": ["a"],
                "after_run": ["b"],
                "before_step": ["c"],
                "after_step": ["d", "e"],
                "on_error": ["f"]
            },
            "steps": [{
                "label": "main",
                "timeout": 30,
                "verify": {"commands": ["one", "two"]}
            }]
        }"#;
        assert_eq!(
            recipe_run_timeout(recipe),
            Duration::from_secs(1_322) + workspace_baseline_budget().saturating_mul(3)
        );
    }

    #[test]
    fn cloud_request_limits_keep_the_hard_outer_cap() {
        let steps: Vec<_> = (0..20)
            .map(|index| serde_json::json!({"label": format!("step-{index}"), "timeout": 1}))
            .collect();
        let recipe = serde_json::to_vec(&serde_json::json!({
            "cloud": {"enabled": true, "evaluate_steps": true},
            "steps": steps,
        }))
        .unwrap();
        assert_eq!(recipe_run_timeout(&recipe), MAX_RUN_TIMEOUT);

        let local_only = br#"{
            "cloud": {"enabled": false, "evaluate_steps": true},
            "steps": [{"label": "main", "timeout": 1}]
        }"#;
        assert_eq!(
            recipe_run_timeout(local_only),
            Duration::from_secs(1)
                + RUNTIME_PROCESS_TEARDOWN
                + DECLARED_TIMEOUT_GRACE
                + workspace_baseline_budget().saturating_mul(3)
        );
    }

    #[test]
    fn explicitly_unbounded_steps_keep_the_hard_outer_cap() {
        assert_eq!(
            recipe_run_timeout(br#"{"steps":[{"label":"main","timeout":0}]}"#),
            MAX_RUN_TIMEOUT
        );
        assert_eq!(
            recipe_run_timeout(br#"{"steps":[{"label":"main","timeout":-1}]}"#),
            MAX_RUN_TIMEOUT
        );
    }

    #[test]
    fn child_recipe_graphs_keep_the_hard_outer_cap() {
        let recipe = br#"{
            "type": "compound",
            "steps": [],
            "recipes": [{"recipe": "long-running-child"}]
        }"#;
        assert_eq!(recipe_run_timeout(recipe), MAX_RUN_TIMEOUT);
    }

    #[test]
    fn pi_preflight_and_git_bookkeeping_limits_are_part_of_the_outer_budget() {
        let recipe = br#"{
            "providers": {"pinned-pi": {"api": "cli", "agent": " PI "}},
            "steps": [{
                "label": "main",
                "backend": "PINNED_PI",
                "timeout": 1,
                "max_retries": 1,
                "expected_changes": ["src"],
                "verify": {"git_clean_outside": ["src"]}
            }]
        }"#;
        // Two adapter attempts: 10 s including teardown. Each attempt checks
        // Pi and Node (36 s including teardown), then 1 s retry backoff.
        // Baselines/bookkeeping are 360 s and grace is 60 s.
        assert_eq!(recipe_run_timeout(recipe), Duration::from_secs(467));

        let chat_provider = br#"{
            "providers": {"pinned-pi": {"agent": "pi"}},
            "steps": [{"label": "main", "backend": "pinned-pi", "timeout": 1}]
        }"#;
        assert_eq!(
            recipe_run_timeout(chat_provider),
            Duration::from_secs(1)
                + RUNTIME_PROCESS_TEARDOWN
                + DECLARED_TIMEOUT_GRACE
                + workspace_baseline_budget().saturating_mul(3)
        );
    }

    #[test]
    fn retry_step_keeps_the_recipe_budget_for_reexecuted_dependents() {
        let recipe =
            br#"{"steps":[{"label":"main","timeout":45},{"label":"verify","timeout":900}]}"#;
        let retry = Invocation::RetryStep {
            mentu_run_id: "runtime-run",
            step: "main",
        };
        assert_eq!(
            invocation_run_timeout(&retry, None, Some(recipe)),
            Duration::from_secs(945)
                + (2 * RUNTIME_PROCESS_TEARDOWN)
                + DECLARED_TIMEOUT_GRACE
                + workspace_baseline_budget().saturating_mul(5)
        );
        assert_eq!(
            invocation_run_timeout(&retry, None, None),
            DEFAULT_RUN_TIMEOUT
        );
    }

    #[test]
    fn absent_and_hostile_budgets_stay_bounded() {
        assert_eq!(
            recipe_run_timeout(br#"{"steps":[{"label":"main"}]}"#),
            DEFAULT_RUN_TIMEOUT
                + RUNTIME_PROCESS_TEARDOWN
                + DECLARED_TIMEOUT_GRACE
                + workspace_baseline_budget().saturating_mul(3)
        );
        assert_eq!(recipe_run_timeout(br#"{}"#), DEFAULT_RUN_TIMEOUT);
        let hostile = serde_json::json!({ "steps": [{ "label": "main", "timeout": u64::MAX }] });
        assert_eq!(
            recipe_run_timeout(&serde_json::to_vec(&hostile).unwrap()),
            MAX_RUN_TIMEOUT
        );
    }

    #[test]
    fn a_legacy_fresh_run_without_staged_bytes_keeps_the_default_bound() {
        let run = Invocation::Run {
            recipe_path: Path::new("mutable.json"),
        };
        assert_eq!(
            invocation_run_timeout(&run, None, None),
            DEFAULT_RUN_TIMEOUT
        );
    }

    #[test]
    fn resume_and_retry_reuse_the_original_approved_budget() {
        let workspace = tempfile::tempdir().unwrap();
        let original_run_id = "original-run";
        let dir = snapshot_root(workspace.path()).join(original_run_id);
        fs::create_dir_all(&dir).unwrap();
        let recipe_path = dir.join("approved.json");
        let recipe_bytes = br#"{"steps":[{"label":"main","timeout":45}]}"#;
        fs::write(&recipe_path, recipe_bytes).unwrap();
        fs::write(
            dir.join("manifest.json"),
            serde_json::to_vec(&serde_json::json!({
                "recipePath": recipe_path,
                "contentHash": sha256_hex(recipe_bytes),
            }))
            .unwrap(),
        )
        .unwrap();

        let resume = Invocation::Resume {
            mentu_run_id: "runtime-run",
        };
        let approved = read_original_snapshot_recipe(workspace.path(), original_run_id).unwrap();
        assert_eq!(
            invocation_run_timeout(&resume, None, Some(&approved)),
            Duration::from_secs(45)
                + RUNTIME_PROCESS_TEARDOWN
                + DECLARED_TIMEOUT_GRACE
                + workspace_baseline_budget().saturating_mul(3)
        );
        assert_eq!(
            invocation_run_timeout(&resume, None, None),
            DEFAULT_RUN_TIMEOUT
        );
    }

    #[cfg(windows)]
    #[test]
    fn snapshot_reader_rejects_windows_reparse_points() {
        use std::os::windows::fs::{symlink_dir, symlink_file};

        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("recipe.json");
        fs::write(&file, b"{}").unwrap();
        let file_link = root.path().join("recipe-link.json");
        symlink_file(&file, &file_link).unwrap();
        assert!(read_snapshot_file(&file_link).is_none());

        let directory = root.path().join("snapshot");
        fs::create_dir(&directory).unwrap();
        let directory_link = root.path().join("snapshot-link");
        symlink_dir(&directory, &directory_link).unwrap();
        assert!(!is_plain_snapshot_directory(&directory_link));
    }

    #[cfg(unix)]
    #[test]
    fn snapshot_reader_rejects_a_fifo_without_blocking() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt as _;
        use std::sync::mpsc;

        let dir = tempfile::tempdir().unwrap();
        let fifo = dir.path().join("manifest.json");
        let fifo_name = CString::new(fifo.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo_name.as_ptr(), 0o600) }, 0);

        let (sender, receiver) = mpsc::sync_channel(1);
        let read_path = fifo.clone();
        let reader = std::thread::spawn(move || {
            sender.send(read_snapshot_file(&read_path)).unwrap();
        });
        let result = match receiver.recv_timeout(Duration::from_secs(1)) {
            Ok(result) => result,
            Err(error) => {
                // O_RDWR opens a FIFO without waiting and unblocks a broken
                // read-only implementation before the test fails.
                let unblock = OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(&fifo)
                    .unwrap();
                reader.join().unwrap();
                drop(unblock);
                panic!("snapshot FIFO read did not fail promptly: {error}");
            }
        };
        reader.join().unwrap();
        assert!(result.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn bounded_wait_stops_and_reaps_a_timed_out_fixture_process() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "sleep 60"]);
        detach_process_group(&mut command);
        let child = Arc::new(Mutex::new(command.spawn().unwrap()));
        let cancelled = Arc::new(AtomicBool::new(false));
        assert!(matches!(
            wait_bounded(&child, &cancelled, Duration::from_millis(20)),
            WaitOutcome::TimedOut
        ));
        assert!(child.lock().unwrap().try_wait().unwrap().is_some());
    }

    #[test]
    fn deep_retry_history_recovers_the_approved_snapshot_directly() {
        let workspace = tempfile::tempdir().unwrap();
        let dir = snapshot_root(workspace.path()).join("original");
        fs::create_dir_all(&dir).unwrap();
        let recipe_path = dir.join("approved.json");
        let recipe_bytes = br#"{"steps":[{"label":"main","timeout":75}]}"#;
        fs::write(&recipe_path, recipe_bytes).unwrap();
        fs::write(
            dir.join("manifest.json"),
            serde_json::to_vec(&serde_json::json!({
                "recipePath": recipe_path,
                "contentHash": sha256_hex(recipe_bytes),
            }))
            .unwrap(),
        )
        .unwrap();

        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        let tx = conn.transaction().unwrap();
        storage::apply_pending_steps_in_tx(&tx).unwrap();
        tx.commit().unwrap();
        storage::insert_approval(
            &conn,
            &drogon_protocol::mentu::MentuApproval {
                id: "approval".into(),
                workspace_id: "workspace".into(),
                recipe_id: "recipe".into(),
                content_hash: sha256_hex(recipe_bytes),
                approved_at: "2026-09-13T00:00:00Z".into(),
            },
        )
        .unwrap();
        storage::insert_run(
            &conn,
            &storage::NewRun {
                id: "original",
                workspace_id: "workspace",
                recipe_id: "recipe",
                approval_id: "approval",
                started_at: "2026-09-13T00:00:00Z",
                retry_of: None,
            },
        )
        .unwrap();
        let mut previous = "original".to_string();
        for index in 0..70 {
            let id = format!("retry-{index}");
            storage::insert_run(
                &conn,
                &storage::NewRun {
                    id: &id,
                    workspace_id: "workspace",
                    recipe_id: "recipe",
                    approval_id: "approval",
                    started_at: "2026-09-13T00:00:00Z",
                    retry_of: Some(&previous),
                },
            )
            .unwrap();
            previous = id;
        }
        let db = Arc::new(Mutex::new(conn));
        let recovered = read_retry_snapshot(&db, workspace.path(), "workspace", &previous).unwrap();
        assert_eq!(recovered, recipe_bytes);

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let alternate = dir.join("alternate.json");
            fs::write(&alternate, recipe_bytes).unwrap();
            fs::remove_file(&recipe_path).unwrap();
            symlink(&alternate, &recipe_path).unwrap();
            assert!(
                read_retry_snapshot(&db, workspace.path(), "workspace", &previous).is_none(),
                "matching approved bytes reached through a symlink must still be refused"
            );
            fs::remove_file(&recipe_path).unwrap();
        }

        let changed = br#"{"steps":[{"label":"main","timeout":999}]}"#;
        fs::write(&recipe_path, changed).unwrap();
        fs::write(
            dir.join("manifest.json"),
            serde_json::to_vec(&serde_json::json!({
                "recipePath": recipe_path,
                "contentHash": sha256_hex(changed),
            }))
            .unwrap(),
        )
        .unwrap();
        assert!(
            read_retry_snapshot(&db, workspace.path(), "workspace", &previous).is_none(),
            "workspace-owned snapshot edits must not replace the approved durable hash"
        );
    }
}

#[cfg(test)]
mod selection_snapshot_tests {
    use super::*;

    fn workspace() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn write_workspace_recipe(root: &Path, rel: &str, contents: &str) {
        let path = root.join(".mentu").join("recipes").join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    fn content_hash(root: &Path, id: &str) -> String {
        recipe::current_content_hash(root, id).unwrap()
    }

    const SHELL_ONLY: &str = r#"{
        "name": "shell-only",
        "steps": [
            {"label": "build", "backend": "shell", "prompt": "make", "depends_on": []}
        ]
    }"#;

    #[test]
    fn runtime_identity_matches_the_derived_contract() {
        let identity = approved_runtime_identity().unwrap();
        assert_eq!(identity.version, "0.5.0");
        assert_eq!(
            identity.revision,
            "c82ccfa0ebbe77d62193e068821ba6e74f87a8d3"
        );
    }

    #[test]
    fn shell_only_recipes_validate_with_no_agent_selections() {
        let recipe: serde_json::Value = serde_json::from_str(SHELL_ONLY).unwrap();
        assert_eq!(validate_agent_execution(&recipe).unwrap(), Vec::new());
    }

    #[test]
    fn opencode_and_antigravity_are_exact_unsupported_combinations() {
        for backend in ["opencode", "antigravity"] {
            let recipe: serde_json::Value = serde_json::from_str(&format!(
                r#"{{"name": "x", "steps": [{{"label": "a", "backend": "{backend}"}}]}}"#
            ))
            .unwrap();
            let err = validate_agent_execution(&recipe).unwrap_err();
            assert_eq!(err.code, BACKEND_UNSUPPORTED_CODE, "{backend}");
            assert!(
                err.message.contains(backend),
                "names the combination: {}",
                err.message
            );
        }
    }

    #[test]
    fn bare_pi_is_refused_as_the_documented_false_positive() {
        let recipe: serde_json::Value = serde_json::from_str(
            r#"{"name": "x", "steps": [{"label": "a", "backend": "pi", "model": "m"}]}"#,
        )
        .unwrap();
        let err = validate_agent_execution(&recipe).unwrap_err();
        assert_eq!(err.code, BACKEND_UNSUPPORTED_CODE);
        assert!(err.message.contains("explicit provider"), "{}", err.message);
    }

    #[test]
    fn pi_binding_shape_is_checked_with_the_real_validator() {
        // Missing credential source: exactly-one-source rule.
        let recipe: serde_json::Value = serde_json::from_str(
            r#"{
            "name": "x",
            "steps": [{"label": "a", "backend": "kimi", "model": "k1"}],
            "providers": {"kimi": {"api": "cli", "agent": "pi", "base_url": "https://x.test/v1", "model": "k1"}}
        }"#,
        )
        .unwrap();
        let err = validate_agent_execution(&recipe).unwrap_err();
        assert_eq!(err.code, BACKEND_UNSUPPORTED_CODE);
        assert!(err.message.contains("credential"), "{}", err.message);
    }

    #[test]
    fn provider_binding_without_api_cli_is_refused_before_it_can_degrade() {
        // The eval's worst seam: a Pi binding that omits `"api": "cli"` is
        // executed by the runtime as a bare chat completion with no tools,
        // and the run is still stamped `ok`. Drogon must refuse it by name.
        let recipe: serde_json::Value = serde_json::from_str(
            r#"{
            "name": "x",
            "steps": [{"label": "work", "backend": "kimi", "model": "k1"}],
            "providers": {"kimi": {"agent": "pi", "base_url": "https://x.test/v1", "model": "k1", "api_key_env": "K"}}
        }"#,
        )
        .unwrap();
        let err = validate_agent_execution(&recipe).unwrap_err();
        assert_eq!(err.code, BACKEND_UNSUPPORTED_CODE, "{}", err.message);
        assert!(
            err.message.contains("api"),
            "the refusal must name the missing field: {}",
            err.message
        );
        assert!(
            err.message.contains("tools"),
            "the refusal must say what is lost: {}",
            err.message
        );
    }

    #[test]
    fn provider_binding_with_a_non_cli_api_is_refused() {
        let recipe: serde_json::Value = serde_json::from_str(
            r#"{
            "name": "x",
            "steps": [{"label": "work", "backend": "kimi", "model": "k1"}],
            "providers": {"kimi": {"api": "chat", "agent": "pi", "base_url": "https://x.test/v1", "model": "k1", "api_key_env": "K"}}
        }"#,
        )
        .unwrap();
        let err = validate_agent_execution(&recipe).unwrap_err();
        assert_eq!(err.code, BACKEND_UNSUPPORTED_CODE, "{}", err.message);
        assert!(err.message.contains("\"chat\""), "{}", err.message);
    }

    #[test]
    fn a_runtime_owned_backend_resolving_a_bad_binding_is_also_refused() {
        // The guard is backend-agnostic: any agent step that resolves a
        // providers entry is checked, so an alias without `agent: "pi"`
        // cannot slip past as "runtime-owned" while pointing at a binding
        // that will silently drop tools.
        let recipe: serde_json::Value = serde_json::from_str(
            r#"{
            "name": "x",
            "steps": [{"label": "work", "backend": "my-alias"}],
            "providers": {"my-alias": {"base_url": "https://x.test/v1", "model": "k1"}}
        }"#,
        )
        .unwrap();
        let err = validate_agent_execution(&recipe).unwrap_err();
        assert_eq!(err.code, BACKEND_UNSUPPORTED_CODE, "{}", err.message);
        assert!(err.message.contains("my-alias"), "{}", err.message);
    }

    #[test]
    fn pi_step_model_disagreeing_with_the_binding_is_never_substituted() {
        let recipe: serde_json::Value = serde_json::from_str(
            r#"{
            "name": "x",
            "steps": [{"label": "a", "backend": "kimi", "model": "other"}],
            "providers": {"kimi": {"api": "cli", "agent": "pi", "base_url": "https://x.test/v1", "model": "k1", "api_key_env": "K"}}
        }"#,
        )
        .unwrap();
        let err = validate_agent_execution(&recipe).unwrap_err();
        assert_eq!(err.code, BACKEND_UNSUPPORTED_CODE);
        assert!(
            err.message.contains("silently substitute"),
            "{}",
            err.message
        );
    }

    #[test]
    fn pi_reasoning_overrides_are_refused_before_shape_checks() {
        let recipe: serde_json::Value = serde_json::from_str(
            r#"{
            "name": "x",
            "steps": [{"label": "a", "backend": "kimi", "reasoning": "high"}],
            "providers": {"kimi": {"api": "cli", "agent": "pi", "base_url": "https://x.test/v1", "model": "k1", "api_key_env": "K"}}
        }"#,
        )
        .unwrap();
        let err = validate_agent_execution(&recipe).unwrap_err();
        assert_eq!(err.code, BACKEND_UNSUPPORTED_CODE);
        assert!(err.message.contains("reasoning"), "{}", err.message);
    }

    #[test]
    fn runtime_owned_backends_carry_notes_not_verdicts() {
        let recipe: serde_json::Value = serde_json::from_str(
            r#"{"name": "x", "steps": [{"label": "a", "backend": "ollama", "model": "q"}]}"#,
        )
        .unwrap();
        let steps = validate_agent_execution(&recipe).unwrap();
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].adapter_backend, "ollama");
        assert!(steps[0].notes.iter().any(|n| n.contains("runtime-owned")));
    }

    #[test]
    fn malformed_model_ids_are_refused_without_a_catalog() {
        let recipe: serde_json::Value = serde_json::from_str(
            r#"{"name": "x", "steps": [{"label": "a", "backend": "codex", "model": "--evil"}]}"#,
        )
        .unwrap();
        let err = validate_agent_execution(&recipe).unwrap_err();
        assert_eq!(err.code, "invalid_argument");
    }

    #[test]
    fn stage_materialize_verify_round_trip_with_unicode_and_spaces() {
        let dir = workspace();
        // Spaces + Unicode in both the recipe id path and the relative
        // resource, rooted at the workspace's .mentu/prompts — the only
        // location the pinned runtime resolves prompt_file from.
        write_workspace_recipe(dir.path(), "team redo.json", SHELL_ONLY);
        let resource_rel = "docs/plan de acción.md";
        let resource_path = dir.path().join(".mentu/prompts").join(resource_rel);
        std::fs::create_dir_all(resource_path.parent().unwrap()).unwrap();
        std::fs::write(&resource_path, "paso uno\n").unwrap();
        let with_resource = SHELL_ONLY.replace(
            r#""prompt": "make""#,
            &format!(r#""prompt": "make", "prompt_file": "{resource_rel}""#),
        );
        write_workspace_recipe(dir.path(), "team redo.json", &with_resource);
        let hash = content_hash(dir.path(), "team redo");
        let staged = stage_approved_snapshot(dir.path(), None, "team redo", &hash).unwrap();
        assert_eq!(staged.resources.len(), 1);
        assert_eq!(staged.resources[0].0.path, resource_rel);
        assert!(staged.skipped_resources.is_empty());
        verify_staged_fresh(dir.path(), None, &staged).unwrap();
        let snapshot_recipe_arg = dir
            .path()
            .join(".mentu/recipes/.snapshots/run-1")
            .join("team redo.json")
            .to_string_lossy()
            .into_owned();
        let argv = vec![
            "/runtime/mentu-recipes".to_string(),
            "run".to_string(),
            snapshot_recipe_arg,
            "--workspace".to_string(),
            dir.path().to_string_lossy().into_owned(),
        ];
        let materialized = materialize_snapshot(dir.path(), "run-1", &staged, &argv).unwrap();
        // The snapshot keeps the recipe's own file name.
        assert_eq!(
            materialized
                .recipe_path
                .file_name()
                .and_then(|n| n.to_str()),
            Some("team redo.json")
        );
        assert_eq!(
            std::fs::read(&materialized.recipe_path).unwrap(),
            staged.recipe_bytes
        );
        // Mirrored resource bytes are exact, at the workspace-relative layout.
        let mirrored = materialized.dir.join(resource_rel);
        assert_eq!(std::fs::read(&mirrored).unwrap(), b"paso uno\n");
        // Manifest records selection + pinned runtime + cwd + hashes.
        let manifest: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(materialized.dir.join("manifest.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(manifest["contentHash"], serde_json::Value::String(hash));
        assert_eq!(
            manifest["runtime"]["version"],
            serde_json::Value::String("0.5.0".into())
        );
        assert_eq!(
            manifest["runtime"]["revision"],
            serde_json::Value::String("c82ccfa0ebbe77d62193e068821ba6e74f87a8d3".into())
        );
        assert_eq!(
            manifest["resources"][0]["path"],
            serde_json::Value::String(resource_rel.into())
        );
        // The manifest records the exact argv the launch uses.
        assert_eq!(manifest["argv"][1], serde_json::Value::String("run".into()));
        assert!(
            manifest["argv"][2]
                .as_str()
                .is_some_and(|p| p.contains(".mentu/recipes/.snapshots/run-1/")),
            "argv names the snapshot recipe inside the admitted recipes tree: {}",
            manifest["argv"]
        );
        // Write-once: the same run id never overwrites.
        assert!(materialize_snapshot(dir.path(), "run-1", &staged, &argv).is_err());
        assert_eq!(
            std::fs::read(&materialized.recipe_path).unwrap(),
            staged.recipe_bytes
        );
    }

    #[test]
    fn edited_bytes_or_resources_refuse_with_reapproval() {
        let dir = workspace();
        write_workspace_recipe(dir.path(), "hello.json", SHELL_ONLY);
        std::fs::create_dir_all(dir.path().join("docs")).unwrap();
        std::fs::create_dir_all(dir.path().join(".mentu/prompts/docs")).unwrap();
        std::fs::write(dir.path().join(".mentu/prompts/docs/note.md"), "v1").unwrap();
        let with_resource = SHELL_ONLY.replace(
            r#""prompt": "make""#,
            r#""prompt": "make", "prompt_file": "docs/note.md""#,
        );
        write_workspace_recipe(dir.path(), "hello.json", &with_resource);
        let hash = content_hash(dir.path(), "hello");
        let staged = stage_approved_snapshot(dir.path(), None, "hello", &hash).unwrap();
        // Edit the recipe to B before launch: staging and verification refuse.
        let edited = with_resource.replace("shell-only", "changed");
        write_workspace_recipe(dir.path(), "hello.json", &edited);
        assert!(
            stage_approved_snapshot(dir.path(), None, "hello", &hash).is_err(),
            "stale hash must not stage"
        );
        assert!(
            verify_staged_fresh(dir.path(), None, &staged).is_err(),
            "edited bytes must not verify"
        );
        // Restore A, then drift the relative resource instead.
        write_workspace_recipe(dir.path(), "hello.json", &with_resource);
        verify_staged_fresh(dir.path(), None, &staged).unwrap();
        std::fs::write(dir.path().join(".mentu/prompts/docs/note.md"), "v2").unwrap();
        let err = verify_staged_fresh(dir.path(), None, &staged).unwrap_err();
        assert!(err.message.contains("docs/note.md"), "{}", err.message);
    }

    #[test]
    fn attestation_reports_drift_missing_and_growth() {
        let dir = workspace();
        std::fs::create_dir_all(dir.path().join(".mentu/prompts/docs")).unwrap();
        std::fs::write(dir.path().join(".mentu/prompts/docs/a.md"), "v1").unwrap();
        let pinned_a = ("docs/a.md".to_string(), sha256_hex(b"v1"));
        let pinned_b = ("docs/b.md".to_string(), sha256_hex(b"v1"));
        // Unchanged bytes attest clean.
        assert!(attested_drift(dir.path(), None, std::slice::from_ref(&pinned_a)).is_empty());
        // Content drift flags the file.
        std::fs::write(dir.path().join(".mentu/prompts/docs/a.md"), "v2").unwrap();
        assert_eq!(
            attested_drift(dir.path(), None, std::slice::from_ref(&pinned_a)),
            vec!["docs/a.md".to_string()]
        );
        // A missing file flags it too.
        assert_eq!(
            attested_drift(dir.path(), None, &[pinned_b]),
            vec!["docs/b.md".to_string()]
        );
        // Growth past the mirror cap reads as drifted without loading it all.
        let big = vec![b'x'; (SNAPSHOT_MAX_RESOURCE_BYTES + 16) as usize];
        std::fs::write(dir.path().join(".mentu/prompts/docs/a.md"), &big).unwrap();
        assert_eq!(
            attested_drift(dir.path(), None, &[pinned_a]),
            vec!["docs/a.md".to_string()]
        );
    }

    #[test]
    fn resource_colliding_with_snapshot_layout_is_refused() {
        let dir = workspace();
        // A `prompt_file` that would land on the snapshot's own manifest
        // must refuse at stage: silently skipping it would leave the
        // runtime reading the live file while the manifest claims pinned.
        let colliding = SHELL_ONLY.replace(
            r#""prompt": "make""#,
            r#""prompt": "make", "prompt_file": "manifest.json""#,
        );
        std::fs::create_dir_all(dir.path().join(".mentu/prompts")).unwrap();
        std::fs::write(dir.path().join(".mentu/prompts/manifest.json"), "live\n").unwrap();
        write_workspace_recipe(dir.path(), "collide.json", &colliding);
        let hash = content_hash(dir.path(), "collide");
        let err = stage_approved_snapshot(dir.path(), None, "collide", &hash).unwrap_err();
        assert!(err.message.contains("collides"), "{}", err.message);
    }

    #[test]
    fn prompt_file_resolves_home_tier_when_workspace_lacks_it() {
        let dir = workspace();
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".mentu/prompts")).unwrap();
        std::fs::write(
            home.path().join(".mentu/prompts/home-only.md"),
            "home bytes\n",
        )
        .unwrap();
        let with_home = SHELL_ONLY.replace(
            r#""prompt": "make""#,
            r#""prompt": "make", "prompt_file": "home-only.md""#,
        );
        write_workspace_recipe(dir.path(), "home-tier.json", &with_home);
        let hash = content_hash(dir.path(), "home-tier");
        let staged = stage_approved_snapshot(
            dir.path(),
            Some(&home.path().join(".mentu/prompts")),
            "home-tier",
            &hash,
        )
        .unwrap();
        assert_eq!(staged.resources.len(), 1);
        assert_eq!(staged.resources[0].0.path, "home-only.md");
        // The home-tier bytes are the pinned ones, and freshness verifies
        // against the same tier (workspace first, home second).
        assert_eq!(staged.resources[0].1, b"home bytes\n");
        verify_staged_fresh(
            dir.path(),
            Some(&home.path().join(".mentu/prompts")),
            &staged,
        )
        .unwrap();
        // Without the home tier in play the same reference is honestly
        // unresolvable: a skip note, never a fabricated pin.
        let without_home = stage_approved_snapshot(dir.path(), None, "home-tier", &hash).unwrap();
        assert!(without_home.resources.is_empty());
        assert_eq!(without_home.skipped_resources.len(), 1);
    }

    #[test]
    fn prompt_file_workspace_tier_wins_over_home() {
        let dir = workspace();
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".mentu/prompts")).unwrap();
        std::fs::create_dir_all(home.path().join(".mentu/prompts")).unwrap();
        std::fs::write(
            dir.path().join(".mentu/prompts/both.md"),
            "workspace bytes\n",
        )
        .unwrap();
        std::fs::write(home.path().join(".mentu/prompts/both.md"), "home bytes\n").unwrap();
        let with_both = SHELL_ONLY.replace(
            r#""prompt": "make""#,
            r#""prompt": "make", "prompt_file": "both.md""#,
        );
        write_workspace_recipe(dir.path(), "two-tier.json", &with_both);
        let hash = content_hash(dir.path(), "two-tier");
        let staged = stage_approved_snapshot(
            dir.path(),
            Some(&home.path().join(".mentu/prompts")),
            "two-tier",
            &hash,
        )
        .unwrap();
        // Runner order is workspace-first: the pinned bytes are the
        // workspace tier's, never the home copy.
        assert_eq!(staged.resources[0].1, b"workspace bytes\n");
        // A workspace-tier drift is flagged even though the home tier
        // still holds the approved bytes (the runner reads workspace
        // first, so the drifted copy is what would execute).
        std::fs::write(dir.path().join(".mentu/prompts/both.md"), "drifted\n").unwrap();
        assert!(
            !verify_staged_fresh(
                dir.path(),
                Some(&home.path().join(".mentu/prompts")),
                &staged
            )
            .is_ok()
        );
    }

    #[test]
    fn escaping_and_absolute_resources_are_skipped_never_followed() {
        let dir = workspace();
        let evil = SHELL_ONLY.replace(
            r#""prompt": "make""#,
            r#""prompt": "make", "prompt_file": "../../etc/passwd""#,
        );
        write_workspace_recipe(dir.path(), "evil.json", &evil);
        let hash = content_hash(dir.path(), "evil");
        let staged = stage_approved_snapshot(dir.path(), None, "evil", &hash).unwrap();
        assert!(staged.resources.is_empty());
        assert_eq!(staged.skipped_resources.len(), 1);
        assert!(staged.skipped_resources[0].contains("outside the workspace"));
    }
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
