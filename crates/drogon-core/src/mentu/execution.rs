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
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use drogon_protocol::RpcError;
use drogon_protocol::mentu::{MentuRun, MentuRunStatus};
use sha2::Digest as _;

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
///
/// C03: `snapshot` carries the staged approved bytes for a fresh `Run`.
/// When present the staged content is re-verified against the live
/// workspace (refusing drift), materialized write-once under
/// `.mentu/snapshots/<run id>/`, and the snapshot recipe path — never
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
) -> Result<MentuRun, RpcError> {
    if matches!(invocation, Invocation::Resume { .. }) && snapshot.is_some() {
        return Err(error::invalid_argument(
            "Snapshots ride fresh runs; retry resumes runtime-side state.",
        ));
    }
    let internal_id = uuid::Uuid::new_v4().to_string();
    let started_at = crate::now_rfc3339();

    // The recipe argument the runtime loads: the immutable snapshot when
    // staged, else the caller-supplied path (the resume path and any
    // legacy caller without staged bytes).
    let mut snapshot_dir: Option<PathBuf> = None;
    let mut recipe_arg: Option<PathBuf> = None;
    if let Some(staged) = &snapshot {
        if staged.recipe_id != recipe_id {
            return Err(error::invalid_argument(
                "Staged snapshot names a different recipe.",
            ));
        }
        verify_staged_fresh(&workspace_root, staged)?;
        let materialized = materialize_snapshot(&workspace_root, &internal_id, staged)?;
        snapshot_dir = Some(materialized.dir);
        recipe_arg = Some(materialized.recipe_path);
    }

    let mut command = Command::new(&runtime_path);
    #[cfg(unix)]
    detach_process_group(&mut command);
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
    };
    command
        .arg("--workspace")
        .arg(&workspace_root)
        .current_dir(&workspace_root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| {
        // A materialized snapshot with no run behind it is litter, not
        // evidence: drop it so failed spawns cannot accumulate snapshot
        // dirs. (Refusals happen before materialization and leave nothing.)
        if let Some(dir) = &snapshot_dir {
            let _ = std::fs::remove_dir_all(dir);
        }
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

// ---------------------------------------------------------------------------
// C03: approved execution selection + immutable execution snapshot.
//
// A run never executes the mutable recipe path. Instead `mentu.run`
// stages the exact approved bytes (plus the agent steps' effective
// selection and the pinned adapter/runtime identity) into a write-once
// snapshot dir, re-verifies it immediately before spawn, and passes the
// snapshot recipe path to the runtime. `--workspace` and the child cwd
// stay the workspace root, so run records and evidence keep their
// established locations. Relative resources (`prompt_file`) are mirrored
// into the snapshot and hash-pinned in the manifest; drift between
// approval and launch refuses the run with a reason instead of silently
// executing different bytes.
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

fn snapshot_root(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".mentu").join("snapshots")
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

/// Collects the workspace-relative `prompt_file` references in `steps`:
/// absolute paths and `..` escapes are skipped with a note (never
/// followed); surviving entries resolve containment-checked against the
/// workspace root. `Path` joins only — spaces/Unicode flow through
/// untouched, no shell involved.
fn collect_snapshot_resources(
    workspace_root: &Path,
    workspace_real: &Path,
    steps: &[serde_json::Value],
) -> (Vec<(SnapshotResource, Vec<u8>)>, Vec<String>) {
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
        let candidate = workspace_root.join(rel_path);
        let Ok(real) = fs::canonicalize(&candidate) else {
            skipped.push(format!("{rel}: unreadable at approval time"));
            continue;
        };
        if !real.starts_with(workspace_real) || !real.is_file() {
            skipped.push(format!("{rel}: outside the workspace, not mirrored"));
            continue;
        }
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
        collect_snapshot_resources(workspace_root, &workspace_real, &full_steps);
    let recipe_file_name = recipe_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| error::invalid_argument("Invalid Mentu recipe reference."))?
        .to_string();
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
pub fn verify_staged_fresh(workspace_root: &Path, staged: &StagedSnapshot) -> Result<(), RpcError> {
    let current = recipe::current_content_hash(workspace_root, &staged.recipe_id)?;
    if current != staged.content_hash {
        return Err(error::invalid_argument(
            "Recipe content changed since approval; re-approve before running.",
        ));
    }
    let workspace_real = fs::canonicalize(workspace_root)
        .map_err(|_| error::not_found("Workspace is unavailable."))?;
    for (resource, _) in &staged.resources {
        let candidate = workspace_root.join(&resource.path);
        let real = fs::canonicalize(&candidate).map_err(|_| {
            error::invalid_argument(format!(
                "Relative resource '{}' changed since approval; re-approve before running.",
                resource.path
            ))
        })?;
        if !real.starts_with(&workspace_real) {
            return Err(error::invalid_argument(format!(
                "Relative resource '{}' changed since approval; re-approve before running.",
                resource.path
            )));
        }
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

/// Materialized (run-bound, write-once) snapshot paths.
pub struct MaterializedSnapshot {
    pub dir: PathBuf,
    /// The recipe path to pass as the runtime `run` argument. It keeps
    /// the recipe's own file name (not a fixed `recipe.json`) so
    /// file-stem-keyed fixture runtimes keep addressing the same recipe.
    pub recipe_path: PathBuf,
}

/// Materializes `staged` under `.mentu/snapshots/<run_id>/`: the exact
/// approved recipe bytes, the mirrored `resources/`, and `manifest.json`
/// recording the effective selection plus the pinned adapter/runtime
/// version with the run. Write-once: an existing dir is never overwritten.
/// `--workspace` and the child cwd intentionally stay the workspace root
/// (run records and evidence keep their established locations); the
/// manifest pins `cwd` so the intended working directory survives moves.
pub fn materialize_snapshot(
    workspace_root: &Path,
    run_id: &str,
    staged: &StagedSnapshot,
) -> Result<MaterializedSnapshot, RpcError> {
    if !valid_run_id(run_id) {
        return Err(error::invalid_argument("Invalid Mentu run identity."));
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
        let target = dir.join("resources").join(&resource.path);
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
        // Spaces + Unicode in both the recipe id path and the relative resource.
        write_workspace_recipe(dir.path(), "team redo.json", SHELL_ONLY);
        let resource_rel = "docs/plan de acción.md";
        let resource_path = dir.path().join(resource_rel);
        std::fs::create_dir_all(resource_path.parent().unwrap()).unwrap();
        std::fs::write(&resource_path, "paso uno\n").unwrap();
        let with_resource = SHELL_ONLY.replace(
            r#""prompt": "make""#,
            &format!(r#""prompt": "make", "prompt_file": "{resource_rel}""#),
        );
        write_workspace_recipe(dir.path(), "team redo.json", &with_resource);
        let hash = content_hash(dir.path(), "team redo");
        let staged = stage_approved_snapshot(dir.path(), "team redo", &hash).unwrap();
        assert_eq!(staged.resources.len(), 1);
        assert_eq!(staged.resources[0].0.path, resource_rel);
        assert!(staged.skipped_resources.is_empty());
        verify_staged_fresh(dir.path(), &staged).unwrap();
        let materialized = materialize_snapshot(dir.path(), "run-1", &staged).unwrap();
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
        // Mirrored resource bytes are exact.
        let mirrored = materialized.dir.join("resources").join(resource_rel);
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
        // Write-once: the same run id never overwrites.
        assert!(materialize_snapshot(dir.path(), "run-1", &staged).is_err());
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
        std::fs::write(dir.path().join("docs/note.md"), "v1").unwrap();
        let with_resource = SHELL_ONLY.replace(
            r#""prompt": "make""#,
            r#""prompt": "make", "prompt_file": "docs/note.md""#,
        );
        write_workspace_recipe(dir.path(), "hello.json", &with_resource);
        let hash = content_hash(dir.path(), "hello");
        let staged = stage_approved_snapshot(dir.path(), "hello", &hash).unwrap();
        // Edit the recipe to B before launch: staging and verification refuse.
        let edited = with_resource.replace("shell-only", "changed");
        write_workspace_recipe(dir.path(), "hello.json", &edited);
        assert!(
            stage_approved_snapshot(dir.path(), "hello", &hash).is_err(),
            "stale hash must not stage"
        );
        assert!(
            verify_staged_fresh(dir.path(), &staged).is_err(),
            "edited bytes must not verify"
        );
        // Restore A, then drift the relative resource instead.
        write_workspace_recipe(dir.path(), "hello.json", &with_resource);
        verify_staged_fresh(dir.path(), &staged).unwrap();
        std::fs::write(dir.path().join("docs/note.md"), "v2").unwrap();
        let err = verify_staged_fresh(dir.path(), &staged).unwrap_err();
        assert!(err.message.contains("docs/note.md"), "{}", err.message);
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
        let staged = stage_approved_snapshot(dir.path(), "evil", &hash).unwrap();
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
