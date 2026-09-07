//! Shared fixture and probe harness: cooperative, signal-free cleanup only.

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub const WAIT_BUDGET: Duration = Duration::from_secs(10);
/// Bounded self-expiry for any leftover fixture child (seconds), so cleanup
/// never needs to signal a discovered PID.
pub const FIXTURE_LIFETIME_SECS: u64 = 20;

pub struct Fixture {
    pub dir: PathBuf,
    cli: PathBuf,
}

impl Fixture {
    pub fn new(tag: &str) -> Fixture {
        let dir = tempfile::Builder::new()
            .prefix(&format!("dg-nwl-{tag}-"))
            .tempdir()
            .expect("fixture tempdir")
            .keep();
        let harness = dir.join("claude");
        std::fs::write(&harness, FIXTURE_SCRIPT).expect("write claude fixture");
        let cli = dir.join("probe-cli");
        std::fs::write(&cli, "#!/bin/sh\nexit 0\n").expect("write cli fixture");
        use std::os::unix::fs::PermissionsExt;
        for path in [&harness, &cli] {
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
                .expect("chmod fixture");
        }
        Fixture { dir, cli }
    }

    /// Cooperative cleanup: write the parent stop marker on EVERY attempt
    /// (so a later observer can distinguish cleaned-up from never-cleaned,
    /// including on the normal child-crash path), then wait, bounded, for
    /// the recorded fixture children to PROVE their exit (or self-expire).
    /// Never signals a discovered PID. Only a provably-exited outcome removes
    /// the fixture tree; an unverifiable outcome preserves it on disk so a
    /// live or unprovable child is never buried under a deleted directory.
    pub fn cleanup(&self) {
        if let Err(reason) = self.try_cleanup() {
            panic!(
                "fixture cleanup is unverifiable after its bounded expiry ({reason}); \
                 fixtures preserved at {}",
                self.dir.display()
            );
        }
    }

    /// Bounded, non-panicking variant of [`Fixture::cleanup`]: `Ok(())` means
    /// every recorded child PROVED its exit (ESRCH) and the fixture tree was
    /// removed; `Err(reason)` means the outcome stayed unverifiable or a
    /// child is provably live, and the fixture tree is PRESERVED.
    pub fn try_cleanup(&self) -> Result<(), String> {
        self.try_cleanup_within(Duration::from_secs(FIXTURE_LIFETIME_SECS + 5))
    }

    pub fn try_cleanup_within(&self, deadline: Duration) -> Result<(), String> {
        // The parent cleanup stop-marker is written on EVERY cleanup attempt
        // — success, provably-live refusal, unreadable pid log, or the normal
        // child-crash path — so a later observer can always distinguish
        // "cleanup ran here" from "never cleaned". A marker write failure
        // preserves the fixtures too (the cleanup itself is then unverifiable).
        std::fs::write(self.dir.join("stop-marker"), b"stop\n")
            .map_err(|error| format!("write cleanup stop marker: {error}"))?;
        let deadline = Instant::now() + deadline;
        let mut last_reason = String::from("cleanup window exhausted before any observation");
        while Instant::now() < deadline {
            match recorded_pids_result(&self.dir) {
                PidLog::Unreadable(reason) => {
                    return Err(format!(
                        "pid log unreadable; no child outcome is knowable, \
                         fixture preserved: {reason}"
                    ));
                }
                PidLog::NeverStarted => {}
                PidLog::Recorded(pids) => {
                    let mut blocked = None;
                    for pid in &pids {
                        match observe_liveness(*pid) {
                            Liveness::Exited => {}
                            Liveness::Live => {
                                blocked = Some(format!("pid {pid} is provably live"));
                                break;
                            }
                            Liveness::Unverifiable => {
                                blocked = Some(format!("pid {pid} liveness unverifiable"));
                                break;
                            }
                        }
                    }
                    if let Some(reason) = blocked {
                        last_reason = reason;
                        std::thread::sleep(Duration::from_millis(100));
                        continue;
                    }
                }
            }
            // No child was ever recorded, or every recorded child proved its
            // exit: only now may the fixture tree be removed.
            match std::fs::remove_file(self.dir.join("env-dump.cap")) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(format!("remove env-dump.cap: {error}")),
            }
            std::fs::remove_dir_all(&self.dir)
                .map_err(|error| format!("remove owned fixture: {error}"))?;
            return Ok(());
        }
        Err(last_reason)
    }

    // Only the lifecycle scope's binary uses this default entry; the
    // cancel/reopen binary drives `run_using` with its own entry name.
    #[allow(dead_code)]
    pub fn run(&self, probe: &str) -> Invocation {
        self.run_using("native_worker_probe_entry", probe)
    }

    /// Runs `probe` through the given test-binary entry name (the shared
    /// harness serves both V1 scopes: the lifecycle suite's
    /// `native_worker_probe_entry` and the cancel/reopen suite's
    /// `native_cancel_reopen_probe_entry`).
    pub fn run_using(&self, entry: &str, probe: &str) -> Invocation {
        let exe = std::env::current_exe().expect("test binary path");
        let path = {
            let existing = std::env::var_os("PATH").unwrap_or_default();
            let mut paths = std::env::split_paths(&existing).collect::<Vec<_>>();
            paths.insert(0, self.dir.clone());
            std::env::join_paths(&paths).expect("join PATH")
        };
        let mut child = Command::new(&exe)
            .args(["--exact", entry, "--nocapture", "--test-threads", "1"])
            .env("NATIVE_PROBE", probe)
            .env("NATIVE_FIXTURE_DIR", &self.dir)
            .env("NATIVE_CLI_PATH", &self.cli)
            .env("DROGON_ADMIN_SENTINEL", "synthetic-admin-sentinel-0003")
            .env("ORCA_ADMIN_SENTINEL", "synthetic-admin-sentinel-0004")
            .env(
                "NATIVE_BOGUS_CAPABILITY",
                "synthetic-inherited-bogus-capability-0002",
            )
            .env(
                "DROGON_DISPATCH_CAPABILITY",
                "synthetic-inherited-bogus-capability-0002",
            )
            .env("ORCA_TERMINAL_HANDLE", "planted-orca-handle")
            // Fixture channels: deterministic paths under the fixture temp
            // tree; the fake harness records its PID, private-environment
            // facts, stop marker location and bounded lifetime from these.
            .env("NATIVE_PID_LOG", self.dir.join("pid-log"))
            .env("NATIVE_ENV_DUMP", self.dir.join("env-dump"))
            .env("NATIVE_STOP_MARKER", self.dir.join("stop-marker"))
            .env("NATIVE_FIXTURE_LIFETIME", FIXTURE_LIFETIME_SECS.to_string())
            .env("PATH", &path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn isolated probe subprocess");
        let mut stdout_pipe = child.stdout.take().expect("stdout pipe");
        let mut stderr_pipe = child.stderr.take().expect("stderr pipe");
        let stdout_reader = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = stdout_pipe.read_to_end(&mut bytes);
            String::from_utf8_lossy(&bytes).into_owned()
        });
        let stderr_reader = std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = stderr_pipe.read_to_end(&mut bytes);
            String::from_utf8_lossy(&bytes).into_owned()
        });
        let deadline = Instant::now() + Duration::from_secs(120);
        let invocation = loop {
            match child.try_wait().expect("poll probe subprocess") {
                Some(status) => {
                    break Invocation {
                        exit_code: status.code().unwrap_or(-1),
                        stdout: stdout_reader.join().expect("stdout reader"),
                        stderr: stderr_reader.join().expect("stderr reader"),
                    };
                }
                None if Instant::now() >= deadline => {
                    // Timeout ordering, fixed per fixture review: (1) publish
                    // the cooperative stop marker FIRST — this is the
                    // guarantee mechanism that holds even when the child is
                    // killed below, because a killed child never runs its own
                    // `StopMarkerGuard::drop`; (2) give the probe child and
                    // the fixture children a bounded window to observe the
                    // marker and self-exit; (3) only then kill the EXACT
                    // retained child handle (never a broad PID kill); (4)
                    // clean up only what is provably exited — an
                    // unverifiable outcome preserves the fixtures (cleanup
                    // panics with the preservation notice in that case).
                    let _ = std::fs::write(self.dir.join("stop-marker"), b"stop\n");
                    let cooperative = Instant::now() + Duration::from_secs(5);
                    loop {
                        if child.try_wait().expect("poll probe subprocess").is_some() {
                            break;
                        }
                        if Instant::now() >= cooperative {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_reader.join();
                    let _ = stderr_reader.join();
                    self.cleanup();
                    panic!("probe {probe} exceeded its 120s bound");
                }
                None => std::thread::sleep(Duration::from_millis(20)),
            }
        };
        self.cleanup();
        invocation
    }
}

pub struct Invocation {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// The fake installed harness: records its PID, prints a sentinel line the
/// probes look for in the ring, dumps private-environment facts (presence
/// booleans and a length — never the secret value), then waits cooperatively
/// for the stop marker or its bounded self-expiry.
const FIXTURE_SCRIPT: &str = r#"#!/bin/sh
umask 077
printf '%s\n' "$$" >> "$NATIVE_PID_LOG"
echo worker-fixture-output
out="$NATIVE_ENV_DUMP"
{
printf 'self_path=%s\n' "$0"
for k in DROGON_DISPATCH_CAPABILITY DROGON_RUN_ID DROGON_TASK_ID \
DROGON_DISPATCH_ID DROGON_HOST_ID DROGON_SESSION_ID \
DROGON_SESSION_INCARNATION DROGON_DATA_DIR DROGON_CLI_COMMAND \
ORCA_TERMINAL_HANDLE DROGON_ADMIN_SENTINEL ORCA_ADMIN_SENTINEL; do
eval "v=\${$k+x}"
if [ -n "$v" ]; then printf '%s=present\n' "$k"; else printf '%s=absent\n' "$k"; fi
done
if [ -n "${NATIVE_BOGUS_CAPABILITY:-}" ] \
&& [ "${DROGON_DISPATCH_CAPABILITY:-}" = "$NATIVE_BOGUS_CAPABILITY" ]; then
printf 'capability_is_bogus=yes\n'
else printf 'capability_is_bogus=no\n'; fi
printf 'capability_len=%s\n' "${#DROGON_DISPATCH_CAPABILITY}"
if [ -n "${DROGON_DISPATCH_CAPABILITY:-}" ]; then
printf '%s' "$DROGON_DISPATCH_CAPABILITY" > "${NATIVE_ENV_DUMP}.cap"
fi
printf 'dump_complete\n'
} > "$out"
lifetime="${NATIVE_FIXTURE_LIFETIME:-25}"
marker="${NATIVE_STOP_MARKER}"
i=0
while [ ! -f "$marker" ] && [ "$i" -lt "$lifetime" ]; do
sleep 1
i=$((i+1))
done
"#;

// ---------------------------------------------------------------------------
// Probe environment and shared helpers.
// ---------------------------------------------------------------------------

/// Three-valued, read-only child-liveness verdict. ONLY a proven ESRCH
/// (the OS answering `kill -0` with "No such process") counts as `Exited`;
/// permission errors, unexpected failures and spawn failures are
/// `Unverifiable`, which cleanup must treat as KEEP-THINGS-AS-THEY-ARE —
/// never as exit evidence and never as a reason to delete fixtures.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Liveness {
    Live,
    Exited,
    Unverifiable,
}

/// Pure classifier for one `kill -0` outcome; split out from
/// [`observe_liveness`] so the ESRCH/permission mapping is directly
/// testable without fabricating real processes.
pub fn classify_kill_output(success: bool, stderr: &str) -> Liveness {
    if success {
        return Liveness::Live;
    }
    if stderr.to_lowercase().contains("no such process") {
        return Liveness::Exited;
    }
    Liveness::Unverifiable
}

/// The one narrow liveness observer for both V1 test scopes. Strictly
/// read-only: it sends signal 0 and never signals anything else.
pub fn observe_liveness(pid: i32) -> Liveness {
    assert!(pid > 1, "fixture liveness requires one positive child PID");
    match Command::new("kill").arg("-0").arg(pid.to_string()).output() {
        Ok(output) => classify_kill_output(
            output.status.success(),
            &String::from_utf8_lossy(&output.stderr),
        ),
        // `kill` itself could not be spawned: nothing was proven.
        Err(_) => Liveness::Unverifiable,
    }
}

/// Proven-live only, for probes that ASSERT a child is alive. Cleanup paths
/// must NOT use this bool: a `false` here can be mere unverifiability, and
/// treating that as exit would delete fixtures with a child possibly still
/// running. Cleanup goes through [`observe_liveness`] instead.
pub fn liveness_probe(pid: i32) -> bool {
    observe_liveness(pid) == Liveness::Live
}

pub struct ProbeEnv {
    pub workspace: PathBuf,
    pub data_dir: PathBuf,
    pub cli: PathBuf,
}

impl ProbeEnv {
    pub fn from_parent_env() -> ProbeEnv {
        let dir = PathBuf::from(std::env::var("NATIVE_FIXTURE_DIR").expect("fixture dir"));
        ProbeEnv {
            workspace: {
                std::fs::create_dir_all(dir.join("workspace")).expect("workspace dir");
                dir.join("workspace")
            },
            data_dir: dir.join("data"),
            cli: PathBuf::from(std::env::var("NATIVE_CLI_PATH").expect("cli path")),
        }
    }

    pub fn host_id(&self, engine: &Engine) -> String {
        ok(engine, "status", "status", json!({}))["hostId"]
            .as_str()
            .expect("host id")
            .to_string()
    }

    pub fn workspace_id(&self, engine: &Engine) -> String {
        ok(engine, "ws-list", "workspace.list", json!({}))["workspaces"][0]["id"]
            .as_str()
            .expect("workspace id")
            .to_string()
    }

    /// Registers the workspace, creates the run and one dependency-free task
    /// (Ready on creation), returning (host, run_id, task_id).
    pub fn prepare(&self, engine: &Engine, tag: &str, objective: &str) -> (String, String, String) {
        let host = self.host_id(engine);
        ok(
            engine,
            &format!("ws-{tag}"),
            "workspace.register",
            json!({"path": self.workspace.to_str().unwrap(), "name": "probe-workspace"}),
        );
        let run = ok(
            engine,
            &format!("run-{tag}"),
            "orchestration.runCreate",
            json!({
                "contractVersion": 1, "hostId": host,
                "objective": objective, "coordinatorId": "coord-test-1"
            }),
        );
        assert_eq!(run["run"]["consumerGeneration"], json!(1));
        let run_id = run["run"]["runId"].as_str().expect("run id").to_string();
        let task = ok(
            engine,
            &format!("task-{tag}"),
            "orchestration.taskCreate",
            json!({
                "contractVersion": 1, "hostId": host, "runId": run_id,
                "coordinatorId": "coord-test-1", "consumerGeneration": 1,
                "spec": {"instructions": "probe instructions", "dependsOn": []}
            }),
        );
        let task_id = task["task"]["taskId"]
            .as_str()
            .expect("task id")
            .to_string();
        assert_eq!(task["task"]["status"], json!("ready"));
        (host, run_id, task_id)
    }

    pub fn scope(&self, engine: &Engine, run_id: &str, generation: u64) -> Value {
        json!({
            "contractVersion": 1, "hostId": self.host_id(engine), "runId": run_id,
            "coordinatorId": "coord-test-1", "consumerGeneration": generation
        })
    }

    pub fn start_worker(
        &self,
        engine: &Engine,
        run_id: &str,
        task_id: &str,
        retry_of: Option<&str>,
        request_id: &str,
    ) -> Response {
        let catalog = ok(engine, "fixture-catalog", "harness.list", json!({}));
        let fixture = std::fs::canonicalize(pid_dir(self).join("claude")).unwrap();
        let executable = catalog["harnesses"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["harnessId"] == "claude")
            .unwrap()["executable"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_eq!(
            std::fs::canonicalize(executable).unwrap(),
            fixture,
            "refuse any installed model CLI before launch"
        );
        let mut params = json!({
            "contractVersion": 1, "hostId": self.host_id(engine), "runId": run_id,
            "coordinatorId": "coord-test-1", "consumerGeneration": 1,
            "taskId": task_id,
            "workspaceId": self.workspace_id(engine),
            "mode": "fresh",
            "launch": {
                "harnessId": "claude", "model": "fixture-model",
                "permissionMode": "unattended"
            }
        });
        if let Some(retry) = retry_of {
            params["retryOf"] = json!(retry);
        }
        engine.dispatch(request(request_id, "orchestration.workerStart", params))
    }

    pub fn worker_show(&self, engine: &Engine, run_id: &str, dispatch_id: &str, id: &str) -> Value {
        let mut scope = self.scope(engine, run_id, 1);
        scope["dispatchId"] = json!(dispatch_id);
        ok(engine, id, "orchestration.workerShow", scope)
    }
}

pub fn request(id: &str, method: &str, params: Value) -> Request {
    Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    }
}

pub fn ok(engine: &Engine, id: &str, method: &str, params: Value) -> Value {
    let response = engine.dispatch(request(id, method, params));
    assert!(response.ok, "{method} failed: {:?}", response.error);
    response.result.expect("ok result")
}

pub fn err_code(response: &Response) -> String {
    response
        .error
        .as_ref()
        .map(|error| error.code.clone())
        .unwrap_or_else(|| "<ok>".into())
}

pub fn wait_for_exit(engine: &Engine, scope: &Value, dispatch_id: &str) {
    let deadline = Instant::now() + WAIT_BUDGET;
    let mut attempts = 0u64;
    loop {
        attempts += 1;
        let mut show = scope.clone();
        show["dispatchId"] = json!(dispatch_id);
        let verdict = ok(
            engine,
            &format!("wait-{attempts}"),
            "orchestration.workerShow",
            show,
        )["processVerdict"]
            .clone();
        if verdict == json!("exited") {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "stop never observed exit (last verdict {verdict})"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// The recorded fixture children, distinguishing the three cases cleanup
/// must tell apart:
/// - [`PidLog::NeverStarted`]: no pid-log file exists — proven "no fixture
///   child was ever recorded" (this is what lets a childless fixture clean
///   up).
/// - [`PidLog::Recorded`]: the log parsed into pid records.
/// - [`PidLog::Unreadable`]: the log exists but could not be read or parsed
///   — NO child outcome is knowable, so cleanup must preserve the fixture
///   tree instead of guessing.
pub enum PidLog {
    NeverStarted,
    Recorded(Vec<i32>),
    Unreadable(String),
}

/// Result-based read of the fixture pid log. Read/parse failures are values,
/// never defaults: an unreadable log can neither prove liveness nor exit.
pub fn recorded_pids_result(fixture_dir: &Path) -> PidLog {
    let content = match std::fs::read_to_string(fixture_dir.join("pid-log")) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return PidLog::NeverStarted;
        }
        Err(error) => return PidLog::Unreadable(format!("read pid-log: {error}")),
    };
    let mut pids = Vec::new();
    for line in content.lines() {
        match line.trim().parse::<i32>() {
            Ok(pid) if pid > 1 => pids.push(pid),
            Ok(pid) => {
                return PidLog::Unreadable(format!("invalid fixture child PID {pid}"));
            }
            Err(_) => {
                return PidLog::Unreadable(format!("malformed pid record {line:?}"));
            }
        }
    }
    PidLog::Recorded(pids)
}

/// Probe-count convenience over [`recorded_pids_result`]: never-started is
/// an empty list; an unreadable/malformed log is a fixture bug and panics
/// loudly instead of pretending zero children. Cleanup paths must use
/// [`recorded_pids_result`] so unreadable logs PRESERVE fixtures.
pub fn recorded_pids(fixture_dir: &Path) -> Vec<i32> {
    match recorded_pids_result(fixture_dir) {
        PidLog::Recorded(pids) => pids,
        PidLog::NeverStarted => Vec::new(),
        PidLog::Unreadable(reason) => {
            panic!("fixture pid log unreadable (fixture bug): {reason}")
        }
    }
}

pub fn pid_dir(env: &ProbeEnv) -> PathBuf {
    env.data_dir.parent().expect("fixture dir").to_path_buf()
}

pub fn wait_for_pid_count(env: &ProbeEnv, expected: usize) {
    let deadline = Instant::now() + WAIT_BUDGET;
    loop {
        if recorded_pids(&pid_dir(env)).len() >= expected {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "child count never reached {expected}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

pub fn wait_for_file(path: &Path) {
    let deadline = Instant::now() + WAIT_BUDGET;
    while !path.exists() {
        assert!(
            Instant::now() < deadline,
            "fixture file never appeared: {}",
            path.display()
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

pub fn env_dump_path(env: &ProbeEnv) -> PathBuf {
    pid_dir(env).join("env-dump")
}

/// Waits for the fixture's dump-complete marker, then returns the dump. The
/// fixture writes the dump incrementally, so probes must never read it early.
#[allow(dead_code)]
pub fn completed_env_dump(env: &ProbeEnv) -> String {
    let path = env_dump_path(env);
    let deadline = Instant::now() + WAIT_BUDGET;
    loop {
        let complete = std::fs::read_to_string(&path)
            .map(|content| content.contains("dump_complete"))
            .unwrap_or(false);
        if complete {
            return std::fs::read_to_string(&path).expect("env dump");
        }
        assert!(
            Instant::now() < deadline,
            "fixture env dump never completed"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

pub fn capability_file(env: &ProbeEnv) -> PathBuf {
    PathBuf::from(format!("{}.cap", env_dump_path(env).display()))
}

/// The worker capability, read from the fixture's temp-side file. Never
/// printed; used only to prove hash/presence facts and to present stale
/// credentials for refusal probes.
pub fn capability_value(env: &ProbeEnv) -> String {
    let path = capability_file(env);
    wait_for_file(&path);
    std::fs::read_to_string(&path)
        .expect("capability file")
        .trim()
        .to_string()
}

#[derive(Clone)]
pub struct Started {
    pub dispatch_id: String,
    pub session_id: String,
    pub incarnation: String,
    // Only the lifecycle probes assert these three axes; the cancel/reopen
    // binary shares the struct without reading them.
    #[allow(dead_code)]
    pub assignment_state: String,
    #[allow(dead_code)]
    pub readiness: String,
    #[allow(dead_code)]
    pub process_verdict: String,
}

pub fn started(value: &Value) -> Started {
    Started {
        dispatch_id: value["dispatchId"].as_str().expect("dispatch").into(),
        session_id: value["sessionIdentity"]["sessionId"]
            .as_str()
            .expect("session id")
            .into(),
        incarnation: value["sessionIdentity"]["incarnation"]
            .as_str()
            .expect("incarnation")
            .into(),
        assignment_state: value["assignmentState"].as_str().expect("state").into(),
        readiness: value["readiness"].as_str().expect("readiness").into(),
        process_verdict: value["processVerdict"].as_str().expect("verdict").into(),
    }
}

pub fn fresh_worker(
    env: &ProbeEnv,
    engine: &Engine,
    run_id: &str,
    task_id: &str,
    rid: &str,
) -> Started {
    let response = env.start_worker(engine, run_id, task_id, None, rid);
    assert!(response.ok, "worker start failed: {:?}", response.error);
    let worker = started(&response.result.unwrap());
    use base64::Engine as _;
    let deadline = Instant::now() + WAIT_BUDGET;
    loop {
        let read = ok(
            engine,
            "fixture-ready",
            "session.read",
            json!({"sessionId":worker.session_id,"incarnation":worker.incarnation,"cursor":0}),
        );
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(read["dataBase64"].as_str().unwrap())
            .unwrap();
        if String::from_utf8_lossy(&bytes).contains("worker-fixture-output") {
            return worker;
        }
        assert!(
            Instant::now() < deadline,
            "fixture never produced startup evidence"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Cooperative stop-marker guard for the inner probe process.
///
/// Guarantee mechanism (fixture review): this guard is belt-and-braces. On
/// any normal unwind of the probe child it writes the stop marker so fixture
/// children end. When the child is killed instead (parent timeout path), the
/// guard can no longer run — the guarantee then comes from the parent, which
/// publishes the same stop marker itself BEFORE the exact-child kill. Either
/// way the marker file appears under the fixture dir and every fixture child
/// ends cooperatively or via its own bounded self-expiry.
pub struct StopMarkerGuard {
    marker: PathBuf,
}

impl StopMarkerGuard {
    pub fn new(env: &ProbeEnv) -> StopMarkerGuard {
        StopMarkerGuard {
            marker: pid_dir(env).join("stop-marker"),
        }
    }
}

impl Drop for StopMarkerGuard {
    fn drop(&mut self) {
        let _ = std::fs::write(&self.marker, b"stop\n");
        // Bounded self-expiry finishes any child that misses the marker; no
        // signal is ever sent to a discovered PID.
    }
}
