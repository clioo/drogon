//! V1 historic-attempt cancellation, concurrent-cancel serialization and
//! attempt reopen/rollback, verified through the public engine seams only
//! (`Engine::open` + `with_worker_cli` + `dispatch` /
//! `dispatch_authenticated` against real SQLite and real PTYs).
//!
//! Fixture pattern copied from `tests/native_worker_lifecycle/`: each parent
//! test re-executes this test binary as an isolated subprocess with `PATH`
//! prepended to a temp fixture directory holding a fake installed `claude`
//! harness and a `probe-cli` executable; the subprocess runs exactly one
//! probe through `native_cancel_reopen_probe_entry`. Cleanup stays
//! cooperative (stop marker + bounded self-expiry, read-only `kill -0`
//! liveness, exact-handle `Child::kill` only on timeout).
//!
//! Storage-seam faults follow `probes_faults.rs`: a narrowly scoped SQLite
//! trigger aborts exactly one durable write to force a real transaction
//! rollback. Setup/compile failures are not RED evidence; each assertion is
//! the behavioral contract itself.

#![cfg(unix)]

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

// ---------------------------------------------------------------------------
// Fixture (adapted from native_worker_lifecycle/harness.rs).
// ---------------------------------------------------------------------------

const WAIT_BUDGET: Duration = Duration::from_secs(10);
const FIXTURE_LIFETIME_SECS: u64 = 20;

/// The fake installed harness: records its PID, prints a sentinel line the
/// probes wait for in the session ring, dumps presence facts, then waits
/// cooperatively for the stop marker or its bounded self-expiry.
const FIXTURE_SCRIPT: &str = r#"#!/bin/sh
umask 077
printf '%s\n' "$$" >> "$NATIVE_PID_LOG"
echo worker-fixture-output
out="$NATIVE_ENV_DUMP"
{
printf 'self_path=%s\n' "$0"
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

struct Fixture {
    dir: PathBuf,
    cli: PathBuf,
}

impl Fixture {
    fn new(tag: &str) -> Fixture {
        let dir = tempfile::Builder::new()
            .prefix(&format!("dg-cancel-{tag}-"))
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

    /// Cooperative cleanup: stop marker, bounded wait for observed self-exit,
    /// then removal of the owned fixture tree. Never signals a discovered PID.
    fn cleanup(&self) {
        std::fs::write(self.dir.join("stop-marker"), b"stop\n").expect("stop marker");
        let deadline = Instant::now() + Duration::from_secs(FIXTURE_LIFETIME_SECS + 5);
        while Instant::now() < deadline {
            let pids = recorded_pids(&self.dir);
            if pids.is_empty() || pids.iter().all(|pid| !liveness_probe(*pid)) {
                std::fs::remove_dir_all(&self.dir).expect("remove owned fixture");
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        panic!("fixture cleanup is unverifiable after its bounded expiry");
    }

    fn run(&self, probe: &str) -> Invocation {
        let exe = std::env::current_exe().expect("test binary path");
        let path = {
            let existing = std::env::var_os("PATH").unwrap_or_default();
            let mut paths = std::env::split_paths(&existing).collect::<Vec<_>>();
            paths.insert(0, self.dir.clone());
            std::env::join_paths(&paths).expect("join PATH")
        };
        let mut child = Command::new(&exe)
            .args([
                "--exact",
                "native_cancel_reopen_probe_entry",
                "--nocapture",
                "--test-threads",
                "1",
            ])
            .env("NATIVE_PROBE", probe)
            .env("NATIVE_FIXTURE_DIR", &self.dir)
            .env("NATIVE_CLI_PATH", &self.cli)
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
                    // Exact retained test child only: timeout cleanup.
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_reader.join();
                    let _ = stderr_reader.join();
                    panic!("probe {probe} exceeded its 120s bound");
                }
                None => std::thread::sleep(Duration::from_millis(20)),
            }
        };
        self.cleanup();
        invocation
    }
}

struct Invocation {
    exit_code: i32,
    stdout: String,
    stderr: String,
}

struct ProbeEnv {
    workspace: PathBuf,
    data_dir: PathBuf,
    cli: PathBuf,
}

impl ProbeEnv {
    fn from_parent_env() -> ProbeEnv {
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

    fn host_id(&self, engine: &Engine) -> String {
        ok(engine, "status", "status", json!({}))["hostId"]
            .as_str()
            .expect("host id")
            .to_string()
    }

    fn workspace_id(&self, engine: &Engine) -> String {
        ok(engine, "ws-list", "workspace.list", json!({}))["workspaces"][0]["id"]
            .as_str()
            .expect("workspace id")
            .to_string()
    }

    /// Registers the workspace, creates the run and one dependency-free task
    /// (Ready on creation), returning (host, run_id, task_id).
    fn prepare(&self, engine: &Engine, tag: &str, objective: &str) -> (String, String, String) {
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
        let task_id = task["task"]["taskId"].as_str().expect("task id").to_string();
        assert_eq!(task["task"]["status"], json!("ready"));
        (host, run_id, task_id)
    }

    fn scope(&self, engine: &Engine, run_id: &str, generation: u64) -> Value {
        json!({
            "contractVersion": 1, "hostId": self.host_id(engine), "runId": run_id,
            "coordinatorId": "coord-test-1", "consumerGeneration": generation
        })
    }

    fn start_worker(
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

    fn worker_show(&self, engine: &Engine, run_id: &str, dispatch_id: &str, id: &str) -> Value {
        let mut scope = self.scope(engine, run_id, 1);
        scope["dispatchId"] = json!(dispatch_id);
        ok(engine, id, "orchestration.workerShow", scope)
    }

    fn task_status(&self, engine: &Engine, run_id: &str, task_id: &str, id: &str) -> String {
        ok(engine, id, "orchestration.taskShow", {
            let mut scope = self.scope(engine, run_id, 1);
            scope["taskId"] = json!(task_id);
            scope
        })["task"]["status"]
            .as_str()
            .expect("task status")
            .to_string()
    }

    /// Settles the worker's own attempt with an authenticated final report
    /// (kind `finalReport` binds the report to the exact sending dispatch).
    fn settle(&self, engine: &Engine, host: &str, run_id: &str, task_id: &str, dispatch_id: &str, outcome: &str, request_id: &str) -> Response {
        let capability = capability_value(self);
        let mut request = request(
            request_id,
            "orchestration.send",
            json!({
                "scope": {"actorKind":"dispatch","contractVersion":1,"hostId":host,
                          "runId":run_id,"taskId":task_id,"dispatchId":dispatch_id},
                "kind": "finalReport",
                "subject": "probe final report",
                "finalReport": {"outcome": outcome}
            }),
        );
        request.auth = Some(capability);
        engine.dispatch_authenticated(request, "")
    }
}

fn request(id: &str, method: &str, params: Value) -> Request {
    Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    }
}

fn ok(engine: &Engine, id: &str, method: &str, params: Value) -> Value {
    let response = engine.dispatch(request(id, method, params));
    assert!(response.ok, "{method} failed: {:?}", response.error);
    response.result.expect("ok result")
}

fn err_code(response: &Response) -> String {
    response
        .error
        .as_ref()
        .map(|error| error.code.clone())
        .unwrap_or_else(|| "<ok>".into())
}

fn wait_for_exit(engine: &Engine, env: &ProbeEnv, run_id: &str, dispatch_id: &str) {
    let deadline = Instant::now() + WAIT_BUDGET;
    let mut attempts = 0u64;
    loop {
        attempts += 1;
        let verdict = env.worker_show(engine, run_id, dispatch_id, &format!("wait-{attempts}"))["processVerdict"]
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

/// Read-only liveness observation; never signals.
fn liveness_probe(pid: i32) -> bool {
    assert!(pid > 1, "fixture liveness requires one positive child PID");
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

fn recorded_pids(fixture_dir: &Path) -> Vec<i32> {
    std::fs::read_to_string(fixture_dir.join("pid-log"))
        .map(|content| {
            content
                .lines()
                .map(|line| {
                    let pid = line.trim().parse::<i32>().expect("invalid fixture PID record");
                    assert!(pid > 1, "invalid fixture child PID");
                    pid
                })
                .collect()
        })
        .unwrap_or_default()
}

fn pid_dir(env: &ProbeEnv) -> PathBuf {
    env.data_dir.parent().expect("fixture dir").to_path_buf()
}

fn wait_for_pid_count(env: &ProbeEnv, expected: usize) {
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

fn wait_for_file(path: &Path) {
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

/// The worker capability, read from the fixture's temp-side file. Never
/// printed; used only to authenticate the worker's own final report.
fn capability_value(env: &ProbeEnv) -> String {
    let path = PathBuf::from(format!(
        "{}.cap",
        pid_dir(env).join("env-dump").display()
    ));
    wait_for_file(&path);
    std::fs::read_to_string(&path)
        .expect("capability file")
        .trim()
        .to_string()
}

struct Started {
    dispatch_id: String,
    session_id: String,
    incarnation: String,
}

fn started(value: &Value) -> Started {
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
    }
}

fn fresh_worker(
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
struct StopMarkerGuard {
    marker: PathBuf,
}

impl StopMarkerGuard {
    fn new(env: &ProbeEnv) -> StopMarkerGuard {
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

fn db(env: &ProbeEnv) -> rusqlite::Connection {
    rusqlite::Connection::open(env.data_dir.join(drogon_core::DB_FILE_NAME))
        .expect("open engine database")
}

/// Exact attempt-row projection used for before/after mutation comparisons.
fn attempt_row(conn: &rusqlite::Connection, dispatch_id: &str) -> (bool, bool, String) {
    conn.query_row(
        "SELECT is_current, fenced, state_json FROM orchestration_attempts WHERE dispatch_id=?1",
        [dispatch_id],
        |row| {
            Ok((
                row.get::<_, bool>(0)?,
                row.get::<_, bool>(1)?,
                row.get::<_, String>(2)?,
            ))
        },
    )
    .expect("attempt row")
}

fn count(conn: &rusqlite::Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row.get(0))
        .expect("row count")
}

/// Admits the first worker, stops it (settled stop: attempt `stopped`, task
/// `blocked`, child signalled to cooperative exit).
fn stopped_worker(
    env: &ProbeEnv,
    engine: &Engine,
    run_id: &str,
    task_id: &str,
    tag: &str,
) -> Started {
    let worker = fresh_worker(env, engine, run_id, task_id, &format!("start-{tag}"));
    let _ = ok(engine, &format!("stop-{tag}"), "orchestration.workerStop", {
        let mut scope = env.scope(engine, run_id, 1);
        scope["dispatchId"] = json!(worker.dispatch_id);
        scope
    });
    wait_for_exit(engine, env, run_id, &worker.dispatch_id);
    worker
}

// ---------------------------------------------------------------------------
// Probes.
// ---------------------------------------------------------------------------

/// A settled (final-reported) attempt is historic: new-request stop/abandon
/// must refuse with `attempt_settled` and leave every stored fact unchanged
/// (unit anchor: `stop_cannot_overwrite_a_final_report`).
fn settled_cancel_refused(env: &ProbeEnv) {
    let engine = Engine::open(&env.data_dir).expect("engine open");
    let engine = engine.with_worker_cli(&env.cli).expect("worker cli");
    let (host, run_id, task_id) = env.prepare(&engine, "sc", "settled cancel");
    let worker = fresh_worker(env, &engine, &run_id, &task_id, "start-sc-1");

    // The worker settles its own attempt; the task completes.
    let report = env.settle(
        &engine, &host, &run_id, &task_id, &worker.dispatch_id, "succeeded", "report-sc-1",
    );
    assert!(report.ok, "final report must settle: {:?}", report.error);
    assert_eq!(report.result.unwrap()["lifecycle"]["outcome"], json!("succeeded"));
    assert_eq!(
        env.task_status(&engine, &run_id, &task_id, "task-sc"),
        "completed"
    );
    let settled_show = env.worker_show(&engine, &run_id, &worker.dispatch_id, "show-sc");
    assert_eq!(settled_show["assignmentState"], json!("completed"));

    // The historic snapshot every cancelled write must leave untouched.
    let conn = db(env);
    let before = attempt_row(&conn, &worker.dispatch_id);
    let requests_before = count(&conn, "requests");
    let attempts_before = count(&conn, "orchestration_attempts");
    drop(conn);

    // Both cancellation verbs refuse the settled attempt.
    let stop = engine.dispatch(request("stop-sc-late", "orchestration.workerStop", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["dispatchId"] = json!(worker.dispatch_id);
        scope
    }));
    assert_eq!(
        err_code(&stop),
        "attempt_settled",
        "stop of a settled attempt must refuse: {stop:?}"
    );
    let abandon = engine.dispatch(request("abandon-sc-late", "orchestration.workerAbandon", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["dispatchId"] = json!(worker.dispatch_id);
        scope["reason"] = json!("probe");
        scope
    }));
    assert_eq!(
        err_code(&abandon),
        "attempt_settled",
        "abandon of a settled attempt must refuse: {abandon:?}"
    );

    // No mutation of the attempt: row bytes, task status, worker projection.
    // The request ledger legitimately records each refusal as a durable
    // failure receipt — exactly one per refused call, none left pending.
    let conn = db(env);
    assert_eq!(attempt_row(&conn, &worker.dispatch_id), before);
    assert_eq!(
        count(&conn, "requests"),
        requests_before + 2,
        "each refused cancellation records exactly one failure receipt"
    );
    let pending: i64 = conn
        .query_row(
            "SELECT count(*) FROM requests WHERE request_id IN ('stop-sc-late','abandon-sc-late') AND status='pending'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(pending, 0, "refused calls are not pending launch authority");
    assert_eq!(count(&conn, "orchestration_attempts"), attempts_before);
    drop(conn);
    assert_eq!(
        env.task_status(&engine, &run_id, &task_id, "task-sc-after"),
        "completed"
    );
    let after_show = env.worker_show(&engine, &run_id, &worker.dispatch_id, "show-sc-after");
    assert_eq!(after_show, settled_show);
}

/// Two simultaneous cancellation requests serialize on the dispatch operation
/// lock: the state transitions exactly once, exactly one response signals the
/// owned process, and the loser observes an idempotent no-op fence.
fn concurrent_cancel_single_winner(env: &ProbeEnv) {
    let engine = Engine::open(&env.data_dir).expect("engine open");
    let engine = engine.with_worker_cli(&env.cli).expect("worker cli");
    let (_host, run_id, task_id) = env.prepare(&engine, "cc", "concurrent cancel");
    let worker = fresh_worker(env, &engine, &run_id, &task_id, "start-cc-1");
    wait_for_pid_count(env, 1);

    let results: Vec<Response> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..2)
            .map(|index| {
                let engine = &engine;
                let run_id = &run_id;
                let dispatch_id = worker.dispatch_id.clone();
                scope.spawn(move || {
                    let mut params = json!({
                        "contractVersion": 1, "hostId": "",
                        "runId": run_id, "coordinatorId": "coord-test-1",
                        "consumerGeneration": 1,
                    });
                    params["hostId"] = ok(engine, "status-cc", "status", json!({}))["hostId"].clone();
                    params["dispatchId"] = json!(dispatch_id);
                    engine.dispatch(request(
                        &format!("stop-cc-{index}"),
                        "orchestration.workerStop",
                        params,
                    ))
                })
            })
            .collect();
        handles.into_iter().map(|handle| handle.join().expect("join")).collect()
    });

    // Both requests are admitted (the fence is idempotent), but exactly one
    // of them performed the transition and signalled the owned process.
    let mut signalled = 0;
    for response in &results {
        assert!(response.ok, "concurrent stop failed: {:?}", response.error);
        let result = response.result.as_ref().unwrap();
        assert_eq!(result["assignmentState"], json!("stopped"));
        if result["processAction"] == json!("signalled") {
            signalled += 1;
        }
    }
    assert_eq!(
        signalled, 1,
        "exactly one concurrent cancel may signal: {results:?}"
    );

    wait_for_exit(&engine, env, &run_id, &worker.dispatch_id);
    assert_eq!(
        env.task_status(&engine, &run_id, &task_id, "task-cc"),
        "blocked",
        "the task transitions to blocked exactly once"
    );
    let conn = db(env);
    assert_eq!(count(&conn, "orchestration_attempts"), 1);
    drop(conn);
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(
        recorded_pids(&pid_dir(env)).len(),
        1,
        "no cancel may launch or respawn a process"
    );
}

/// A replacement admission that rolls back restores the failed attempt's
/// pre-retry authority and state: the fenced flip is transactional with the
/// replacement insert (unit anchor:
/// `rolled_back_replacement_restores_prior_authority_and_history`).
fn failed_retry_rollback_restores_state(env: &ProbeEnv) {
    let engine = Engine::open(&env.data_dir).expect("engine open");
    let engine = engine.with_worker_cli(&env.cli).expect("worker cli");
    let (_host, run_id, task_id) = env.prepare(&engine, "rb", "retry rollback");
    let first = stopped_worker(env, &engine, &run_id, &task_id, "rb-1");

    let conn = db(env);
    let before = attempt_row(&conn, &first.dispatch_id);
    let attempts_before = count(&conn, "orchestration_attempts");
    let sessions_before = count(&conn, "sessions");
    let credentials_before = count(&conn, "orchestration_dispatch_credentials");
    drop(conn);
    assert_eq!(
        env.task_status(&engine, &run_id, &task_id, "task-rb-before"),
        "blocked"
    );

    // Deterministic public-seam fault: abort exactly the replacement attempt
    // INSERT (retry_of is only set on replacements), which sits before the
    // task-status write and the child spawn in the admission transaction.
    let conn = db(env);
    conn.execute_batch(
        "CREATE TRIGGER inject_retry_admit_failure \
         BEFORE INSERT ON orchestration_attempts WHEN NEW.retry_of IS NOT NULL \
         BEGIN SELECT RAISE(ABORT, 'injected retry admit failure'); END;",
    )
    .expect("create trigger");
    drop(conn);

    let rolled_back = env.start_worker(
        &engine,
        &run_id,
        &task_id,
        Some(&first.dispatch_id),
        "start-rb-2",
    );
    assert!(
        !rolled_back.ok,
        "the faulted replacement admission must fail and roll back: {rolled_back:?}"
    );

    let conn = db(env);
    assert_eq!(
        attempt_row(&conn, &first.dispatch_id),
        before,
        "the failed attempt must keep its exact pre-retry row (current+unfenced authority)"
    );
    assert_eq!(count(&conn, "orchestration_attempts"), attempts_before);
    assert_eq!(count(&conn, "sessions"), sessions_before);
    assert_eq!(
        count(&conn, "orchestration_dispatch_credentials"),
        credentials_before
    );
    drop(conn);
    assert_eq!(
        env.task_status(&engine, &run_id, &task_id, "task-rb-after"),
        "blocked",
        "the task keeps its pre-retry status"
    );
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(
        recorded_pids(&pid_dir(env)).len(),
        1,
        "a rolled-back admission must never spawn"
    );
    let _ = ok(&engine, "show-rb-old", "orchestration.workerShow", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["dispatchId"] = json!(first.dispatch_id);
        scope
    });
}

/// After the rolled-back retry, reopening the same failed attempt succeeds
/// with a fresh attempt identity while the prior attempt stays in history,
/// exactly as its row was recorded.
fn reopen_after_rollback_preserves_history(env: &ProbeEnv) {
    let engine = Engine::open(&env.data_dir).expect("engine open");
    let engine = engine.with_worker_cli(&env.cli).expect("worker cli");
    let (_host, run_id, task_id) = env.prepare(&engine, "ro", "reopen");
    let first = stopped_worker(env, &engine, &run_id, &task_id, "ro-1");
    let conn = db(env);
    let historic_row = attempt_row(&conn, &first.dispatch_id);
    drop(conn);

    let conn = db(env);
    conn.execute_batch(
        "CREATE TRIGGER inject_retry_admit_failure \
         BEFORE INSERT ON orchestration_attempts WHEN NEW.retry_of IS NOT NULL \
         BEGIN SELECT RAISE(ABORT, 'injected retry admit failure'); END;",
    )
    .expect("create trigger");
    drop(conn);
    let rolled_back = env.start_worker(
        &engine,
        &run_id,
        &task_id,
        Some(&first.dispatch_id),
        "start-ro-2",
    );
    assert!(!rolled_back.ok, "the faulted retry must roll back");
    let conn = db(env);
    let attempts_after_rollback = count(&conn, "orchestration_attempts");
    drop(conn);
    assert_eq!(attempts_after_rollback, 1);

    // Reopen: the same retry without the fault yields a NEW attempt identity.
    let conn = db(env);
    conn.execute_batch("DROP TRIGGER inject_retry_admit_failure;").expect("drop trigger");
    drop(conn);
    let reopened = env.start_worker(
        &engine,
        &run_id,
        &task_id,
        Some(&first.dispatch_id),
        "start-ro-3",
    );
    assert!(reopened.ok, "reopen must admit a replacement: {:?}", reopened.error);
    let replacement = started(&reopened.result.unwrap());
    assert_ne!(
        replacement.dispatch_id, first.dispatch_id,
        "reopen yields a new attempt id"
    );
    assert_ne!(
        replacement.session_id, first.session_id,
        "reopen yields a distinct session"
    );
    assert_eq!(
        env.task_status(&engine, &run_id, &task_id, "task-ro"),
        "dispatched",
        "the task is dispatched again"
    );

    // Prior history preserved: the historic row keeps its exact state_json
    // with the fenced/current flags now pointing at the replacement.
    let conn = db(env);
    assert_eq!(count(&conn, "orchestration_attempts"), 2);
    let (current, fenced, state_json) = attempt_row(&conn, &first.dispatch_id);
    assert!(!current && fenced, "the historic attempt stays fenced history");
    assert_eq!(
        state_json,
        historic_row.2,
        "the historic attempt's stored state is untouched"
    );
    let retry_of: String = conn
        .query_row(
            "SELECT retry_of FROM orchestration_attempts WHERE dispatch_id=?1",
            [replacement.dispatch_id.as_str()],
            |row| row.get(0),
        )
        .expect("replacement row");
    assert_eq!(retry_of, first.dispatch_id, "history keeps the retry link");
    let (r_current, r_fenced, _) = attempt_row(&conn, &replacement.dispatch_id);
    assert!(r_current && !r_fenced, "only the replacement is authoritative");
    drop(conn);

    // Both attempts remain inspectable through the public seam.
    let historic_show = ok(&engine, "show-ro-old", "orchestration.workerShow", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["dispatchId"] = json!(first.dispatch_id);
        scope
    });
    assert_eq!(historic_show["assignmentState"], json!("stopped"));
    let replacement_show =
        env.worker_show(&engine, &run_id, &replacement.dispatch_id, "show-ro-new");
    assert_eq!(replacement_show["assignmentState"], json!("ready"));
    wait_for_pid_count(env, 2);
    let pids = recorded_pids(&pid_dir(env));
    assert!(
        liveness_probe(pids[1]),
        "the reopened attempt owns its live child"
    );
}

// ---------------------------------------------------------------------------
// Parent tests + inner probe entry.
// ---------------------------------------------------------------------------

#[test]
fn cancel_of_a_settled_attempt_is_refused_without_mutating_state() {
    let fixture = Fixture::new("sc");
    let run = fixture.run("settled_cancel_refused");
    assert_eq!(
        run.exit_code, 0,
        "stdout:\n{}\nstderr:\n{}",
        run.stdout, run.stderr
    );
}

#[test]
fn concurrent_cancels_serialize_with_exactly_one_signalling_winner() {
    let fixture = Fixture::new("cc");
    let run = fixture.run("concurrent_cancel_single_winner");
    assert_eq!(
        run.exit_code, 0,
        "stdout:\n{}\nstderr:\n{}",
        run.stdout, run.stderr
    );
}

#[test]
fn rolled_back_replacement_admission_restores_the_failed_attempt_state() {
    let fixture = Fixture::new("rb");
    let run = fixture.run("failed_retry_rollback_restores_state");
    assert_eq!(
        run.exit_code, 0,
        "stdout:\n{}\nstderr:\n{}",
        run.stdout, run.stderr
    );
}

#[test]
fn reopen_after_rollback_yields_a_new_attempt_with_history_preserved() {
    let fixture = Fixture::new("ro");
    let run = fixture.run("reopen_after_rollback_preserves_history");
    assert_eq!(
        run.exit_code, 0,
        "stdout:\n{}\nstderr:\n{}",
        run.stdout, run.stderr
    );
}

/// Inner entry: the parent re-executes this binary filtered to this test with
/// `NATIVE_PROBE` selecting exactly one probe.
#[test]
fn native_cancel_reopen_probe_entry() {
    let Ok(probe) = std::env::var("NATIVE_PROBE") else {
        return; // Ordinary suite run: the parent tests drive the probes.
    };
    let env = ProbeEnv::from_parent_env();
    let _guard = StopMarkerGuard::new(&env);
    match probe.as_str() {
        "settled_cancel_refused" => settled_cancel_refused(&env),
        "concurrent_cancel_single_winner" => concurrent_cancel_single_winner(&env),
        "failed_retry_rollback_restores_state" => failed_retry_rollback_restores_state(&env),
        "reopen_after_rollback_preserves_history" => reopen_after_rollback_preserves_history(&env),
        other => panic!("unknown probe {other}"),
    }
}
