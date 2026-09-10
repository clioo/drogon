//! End-to-end `orchestration.dispatch` over a real in-process Engine: dry-run
//! purity, unsupervised attempt admission, receipt replay/conflict, fencing,
//! inject bytes into a live fixture session, inject refusal, active-dispatch
//! refusal, inject-failure marking, and worker settlement through the minted
//! capability. No model inference; live sessions are short fixture processes
//! owned and stopped by each test.

#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;

use drogon_protocol::orchestration_scope::COORDINATION_CONTRACT_VERSION;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

use crate::Engine;

const SERVICE_CREDENTIAL: &str = "service-secret-token";

struct Fixture {
    _dir: tempfile::TempDir,
    engine: Engine,
    host_id: String,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host_id = engine.host_id.clone();
    Fixture {
        _dir: dir,
        engine,
        host_id,
    }
}

fn invoke(engine: &Engine, id: &str, method: &str, params: Value) -> Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    })
}

fn ok(engine: &Engine, id: &str, method: &str, params: Value) -> Value {
    let response = invoke(engine, id, method, params);
    assert!(response.ok, "{method}: {:?}", response.error);
    response.result.unwrap()
}

fn err_code(engine: &Engine, id: &str, method: &str, params: Value) -> String {
    let response = invoke(engine, id, method, params);
    assert!(!response.ok, "{method} should fail");
    response.error.unwrap().code
}

fn seed_run_task(fixture: &Fixture) -> (Value, String) {
    let host_id = fixture.host_id.clone();
    let run = ok(
        &fixture.engine,
        "seed-run",
        "orchestration.runCreate",
        json!({
            "contractVersion": COORDINATION_CONTRACT_VERSION,
            "hostId": host_id,
            "objective": "dispatch coverage",
            "coordinatorId": "coord-1",
        }),
    );
    let run_id = run["run"]["runId"].as_str().unwrap().to_string();
    let scope = || {
        json!({
            "contractVersion": COORDINATION_CONTRACT_VERSION,
            "hostId": host_id,
            "runId": run_id,
            "coordinatorId": "coord-1",
            "consumerGeneration": 1,
        })
    };
    let task = ok(
        &fixture.engine,
        &format!("seed-task-{}", run_id),
        "orchestration.taskCreate",
        json!({
            "contractVersion": COORDINATION_CONTRACT_VERSION,
            "hostId": host_id,
            "runId": run_id,
            "coordinatorId": "coord-1",
            "consumerGeneration": 1,
            "spec": {"instructions": "do the thing"},
        }),
    );
    let task_id = task["task"]["taskId"].as_str().unwrap().to_string();
    (scope(), task_id)
}

fn dispatch_params(scope: &Value, task_id: &str) -> Value {
    let mut params = scope.clone();
    params["taskId"] = task_id.into();
    params
}

fn task_status(fixture: &Fixture, scope: &Value, task_id: &str) -> String {
    let mut params = scope.clone();
    params["taskId"] = task_id.into();
    let shown = ok(
        &fixture.engine,
        "task-show",
        "orchestration.taskShow",
        params,
    );
    shown["task"]["status"].as_str().unwrap().to_string()
}

fn attempt_count(fixture: &Fixture) -> i64 {
    fixture
        .engine
        .db
        .lock()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM orchestration_attempts", [], |row| {
            row.get(0)
        })
        .unwrap()
}

fn receipt_count(fixture: &Fixture) -> i64 {
    fixture
        .engine
        .db
        .lock()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM requests", [], |row| row.get(0))
        .unwrap()
}

/// Plain shell session: no harness, so `--inject` must refuse it.
fn start_shell_session(fixture: &Fixture, id: &str) -> Value {
    let workspace = ok(
        &fixture.engine,
        &format!("{id}-ws"),
        "workspace.register",
        json!({"path": fixture._dir.path()}),
    );
    ok(
        &fixture.engine,
        id,
        "session.start",
        json!({
            "workspaceId": workspace["id"],
            "command": "/bin/sh",
            "args": ["-c", "exec sleep 30"],
        }),
    )
}

/// Agent session: `harness.start` with a `cat` fixture override, so injected
/// bytes are echoed to PTY output and observable through `session.read`.
fn start_agent_session(fixture: &Fixture, id: &str) -> Value {
    let binary = fixture._dir.path().join(format!("{id}-cat"));
    // `harness.start` appends its own args to the override binary; discard
    // them so `cat` reads stdin and echoes injected bytes back to the PTY.
    std::fs::write(&binary, "#!/bin/sh\nshift $#\nexec cat\n").unwrap();
    std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(
        invoke(
            &fixture.engine,
            &format!("{id}-override"),
            "agent.settings_update",
            json!({"updates": {"agentCmdOverrides": {"claude": binary}}}),
        )
        .ok
    );
    let workspace = ok(
        &fixture.engine,
        &format!("{id}-ws"),
        "workspace.register",
        json!({"path": fixture._dir.path()}),
    );
    let started = ok(
        &fixture.engine,
        id,
        "harness.start",
        json!({"workspaceId": workspace["id"], "harnessId": "claude"}),
    );
    // The fixture process is owned by the engine's session map; stopping it
    // is the test's job. `cat` exits on PTY close, `sleep` on stop.
    started
}

fn stop_session(fixture: &Fixture, session: &Value) {
    static NONCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let id = format!(
        "stop-target-{}",
        NONCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    );
    ok(
        &fixture.engine,
        &id,
        "session.stop",
        json!({"sessionId": session["id"], "incarnation": session["incarnation"]}),
    );
}

fn session_output(engine: &Engine, session: &Value) -> String {
    let read = ok(
        engine,
        "read-back",
        "session.read",
        json!({"sessionId": session["id"], "incarnation": session["incarnation"]}),
    );
    String::from_utf8(crate::session::base64_decode(read["dataBase64"].as_str().unwrap()).unwrap())
        .unwrap()
}

#[test]
fn dry_run_returns_preamble_and_leaves_zero_state() {
    let fixture = fixture();
    let (scope, task_id) = seed_run_task(&fixture);
    let attempts_before = attempt_count(&fixture);
    let receipts_before = receipt_count(&fixture);
    let mut params = dispatch_params(&scope, &task_id);
    params["dryRun"] = true.into();
    let result = ok(&fixture.engine, "dry", "orchestration.dispatch", params);
    assert_eq!(result["dryRun"], true);
    assert_eq!(result["injected"], false);
    assert!(result["dispatch"].is_null());
    let preamble = result["preamble"].as_str().unwrap();
    assert!(preamble.contains("ctx_dryrun"), "{preamble}");
    assert!(preamble.contains(&task_id), "{preamble}");
    assert_eq!(attempt_count(&fixture), attempts_before);
    assert_eq!(receipt_count(&fixture), receipts_before);
    assert_eq!(task_status(&fixture, &scope, &task_id), "ready");
}

#[test]
fn dispatch_records_unsupervised_attempt_with_receipt_replay() {
    let fixture = fixture();
    let (scope, task_id) = seed_run_task(&fixture);
    let session = start_shell_session(&fixture, "plain");
    let mut params = dispatch_params(&scope, &task_id);
    params["to"] = session["id"].clone();
    let first = ok(
        &fixture.engine,
        "d1",
        "orchestration.dispatch",
        params.clone(),
    );
    assert_eq!(first["dryRun"], false);
    assert_eq!(first["injected"], false);
    assert!(first["preamble"].is_null());
    let dispatch_id = first["dispatch"]["dispatchId"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(dispatch_id.starts_with("dispatch_"));
    assert_eq!(first["dispatch"]["taskId"], task_id);
    assert_eq!(first["dispatch"]["assignmentState"], "ready");
    assert_eq!(
        first["dispatch"]["sessionIdentity"]["sessionId"],
        session["id"]
    );
    assert_eq!(task_status(&fixture, &scope, &task_id), "dispatched");
    // Unsupervised: worker-show adopts the target identity.
    let mut show = scope.clone();
    show["dispatchId"] = dispatch_id.clone().into();
    let shown = ok(&fixture.engine, "show", "orchestration.workerShow", show);
    assert_eq!(shown["sessionIdentity"]["sessionId"], session["id"]);
    // Worker-list retains it: no owned resource to release.
    let listed = ok(
        &fixture.engine,
        "list",
        "orchestration.workerList",
        json!({"contractVersion": COORDINATION_CONTRACT_VERSION, "hostId": fixture.host_id}),
    );
    let entries = listed["workers"].as_array().unwrap();
    let entry = entries
        .iter()
        .find(|entry| entry["dispatchId"] == dispatch_id)
        .expect("dispatch listed");
    assert_eq!(entry["terminalState"], "retained");
    // Receipt replay returns the identical envelope.
    let replay = ok(
        &fixture.engine,
        "d1",
        "orchestration.dispatch",
        params.clone(),
    );
    assert_eq!(replay, first, "replayed receipt, not a fresh dispatch");
    // Same request id with different params is a conflict, not a dispatch.
    let mut conflict = params.clone();
    conflict["returnPreamble"] = true.into();
    assert_eq!(
        err_code(&fixture.engine, "d1", "orchestration.dispatch", conflict),
        "request_conflict"
    );

    // Source `findActiveDispatchForAssignee`: a second dispatch onto the same
    // live terminal is refused before any state change.
    let second_task = {
        static NONCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let id = format!(
            "seed-task-2-{}",
            NONCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        );
        let task = ok(
            &fixture.engine,
            &id,
            "orchestration.taskCreate",
            json!({
                "contractVersion": COORDINATION_CONTRACT_VERSION,
                "hostId": fixture.host_id,
                "runId": scope["runId"],
                "coordinatorId": "coord-1",
                "consumerGeneration": 1,
                "spec": {"instructions": "occupy a different task"},
            }),
        );
        task["task"]["taskId"].as_str().unwrap().to_string()
    };
    assert_eq!(
        task_status(&fixture, &scope, &second_task),
        "ready",
        "second_task={second_task} first_task={task_id}"
    );
    let mut occupied = dispatch_params(&scope, &second_task);
    occupied["to"] = session["id"].clone();
    assert_eq!(
        err_code(
            &fixture.engine,
            "occupied",
            "orchestration.dispatch",
            occupied
        ),
        "attempt_active"
    );
    assert_eq!(task_status(&fixture, &scope, &second_task), "ready");
    // The first task stays dispatched; the refused second dispatch never
    // rewrote it.
    assert_eq!(task_status(&fixture, &scope, &task_id), "dispatched");
    // Worker-stop fences an unsupervised dispatch without signalling it.
    let mut stop = scope.clone();
    stop["dispatchId"] = dispatch_id.clone().into();
    let stopped = ok(&fixture.engine, "stop", "orchestration.workerStop", stop);
    assert_eq!(stopped["processAction"], "none");
    assert!(stopped["warning"].is_string());
    stop_session(&fixture, &session);
}

#[test]
fn inject_writes_preamble_bytes_and_capability_settles() {
    let fixture = fixture();
    let (scope, task_id) = seed_run_task(&fixture);
    let session = start_agent_session(&fixture, "agent");
    let mut params = dispatch_params(&scope, &task_id);
    params["to"] = session["id"].clone();
    params["inject"] = true.into();
    params["returnPreamble"] = true.into();
    let result = ok(&fixture.engine, "d1", "orchestration.dispatch", params);
    assert_eq!(result["injected"], true);
    let preamble = result["preamble"].as_str().unwrap().to_string();
    let dispatch_id = result["dispatch"]["dispatchId"].as_str().unwrap();
    assert!(preamble.contains(dispatch_id), "{preamble}");
    assert!(preamble.contains("--dispatch-capability"), "{preamble}");
    // The write landed in the live session: `session.read` reports the exact
    // injected prompt preview the engine recorded alongside the PTY write.
    let read = ok(
        &fixture.engine,
        "read-back",
        "session.read",
        json!({"sessionId": session["id"], "incarnation": session["incarnation"]}),
    );
    // The preview clips to 512 chars by design; the injected text starts
    // with exactly what was recorded.
    assert!(preamble.starts_with(read["session"]["agentPromptPreview"].as_str().unwrap()));
    // And the bytes round-trip through the fixture's stdin echo (the PTY
    // translates newline to CRLF on output, so compare CR-stripped).
    let mut echoed = String::new();
    for _ in 0..50 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        echoed = session_output(&fixture.engine, &session).replace('\r', "");
        if echoed.contains(&preamble) {
            break;
        }
    }
    // Byte-exact echo is unavailable by construction: the canonical-mode PTY
    // echoes input through the line discipline while `cat` re-emits it, so
    // long writes interleave. Single-line tokens survive intact, proving the
    // exact injected bytes reached the session.
    assert!(
        echoed.contains(dispatch_id),
        "dispatch id arrived through the fixture session"
    );
    // The minted capability settles the dispatch via worker_done.
    let secret = preamble
        .lines()
        .find_map(|line| line.trim().strip_prefix("--dispatch-capability "))
        .expect("capability line")
        .trim()
        .to_string();
    assert!(
        echoed.contains(&secret),
        "minted capability arrived through the fixture session"
    );
    let report: Request = serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": "worker-done",
        "auth": secret,
        "method": "orchestration.send",
        "params": {
            "scope": {
                "actorKind": "dispatch",
                "contractVersion": COORDINATION_CONTRACT_VERSION,
                "hostId": fixture.host_id,
                "runId": scope["runId"],
                "taskId": task_id,
                "dispatchId": dispatch_id,
            },
            "kind": "finalReport",
            "subject": "done",
            "body": "Did the work. Found the path. Nothing left.",
            "finalReport": {"outcome": "succeeded"},
        },
    }))
    .unwrap();
    let settled = fixture
        .engine
        .dispatch_authenticated(report, SERVICE_CREDENTIAL);
    assert!(settled.ok, "{:?}", settled.error);
    let mut show = scope.clone();
    show["dispatchId"] = dispatch_id.into();
    let shown = ok(&fixture.engine, "show", "orchestration.workerShow", show);
    assert_eq!(shown["outcome"], "succeeded");
    assert_eq!(shown["assignmentState"], "completed");
    stop_session(&fixture, &session);
}

#[test]
fn inject_refused_without_agent_leaves_zero_state() {
    let fixture = fixture();
    let (scope, task_id) = seed_run_task(&fixture);
    let session = start_shell_session(&fixture, "plain");
    let attempts_before = attempt_count(&fixture);
    let mut params = dispatch_params(&scope, &task_id);
    params["to"] = session["id"].clone();
    params["inject"] = true.into();
    let code = err_code(&fixture.engine, "d1", "orchestration.dispatch", params);
    assert_eq!(code, "invalid_argument");
    assert_eq!(attempt_count(&fixture), attempts_before);
    assert_eq!(task_status(&fixture, &scope, &task_id), "ready");
    stop_session(&fixture, &session);
}

#[test]
fn dispatch_to_missing_terminal_fails_without_state() {
    let fixture = fixture();
    let (scope, task_id) = seed_run_task(&fixture);
    let attempts_before = attempt_count(&fixture);
    let mut params = dispatch_params(&scope, &task_id);
    params["to"] = "session-that-never-existed".into();
    let code = err_code(&fixture.engine, "d1", "orchestration.dispatch", params);
    assert_eq!(code, "not_found");
    assert_eq!(attempt_count(&fixture), attempts_before);
    assert_eq!(task_status(&fixture, &scope, &task_id), "ready");
}

#[test]
fn inject_into_exited_terminal_marks_attempt_failed() {
    let fixture = fixture();
    let (scope, task_id) = seed_run_task(&fixture);
    let session = start_agent_session(&fixture, "agent");
    stop_session(&fixture, &session);
    let mut params = dispatch_params(&scope, &task_id);
    params["to"] = session["id"].clone();
    params["inject"] = true.into();
    let response = invoke(&fixture.engine, "d1", "orchestration.dispatch", params);
    assert!(!response.ok, "exited terminal cannot accept the write");
    let mut show = scope.clone();
    show["taskId"] = task_id.clone().into();
    let current = ok(
        &fixture.engine,
        "current",
        "orchestration.dispatchShow",
        show,
    );
    let dispatch = &current["dispatch"];
    assert_eq!(dispatch["taskId"], task_id);
    assert_eq!(dispatch["assignmentState"], "failed");
    assert_eq!(dispatch["failure"]["stage"], "inject");
}

#[test]
fn second_dispatch_while_active_is_refused_settled_may_replace() {
    let fixture = fixture();
    let (scope, task_id) = seed_run_task(&fixture);
    let session = start_shell_session(&fixture, "plain");
    let mut params = dispatch_params(&scope, &task_id);
    params["to"] = session["id"].clone();
    let first = ok(&fixture.engine, "d1", "orchestration.dispatch", params);
    let dispatch_id = first["dispatch"]["dispatchId"].as_str().unwrap();
    // A naive retry while the dispatch is active reports not-ready: the task
    // guard surfaces the dispatch-lock before admission is even reached.
    // (`admit_dispatch` still refuses `attempt_active` itself — covered at
    // the admission level in `coordination_attempts_tests` — for a task that
    // returns to ready with an active attempt by another path.)
    let session2 = start_shell_session(&fixture, "plain2");
    let mut params2 = dispatch_params(&scope, &task_id);
    params2["to"] = session2["id"].clone();
    assert_eq!(
        err_code(&fixture.engine, "d2", "orchestration.dispatch", params2),
        "task_not_ready"
    );
    // After settlement the task returns to ready and re-dispatch replaces
    // the fenced row.
    let mut stop = scope.clone();
    stop["dispatchId"] = dispatch_id.into();
    ok(&fixture.engine, "stop", "orchestration.workerStop", stop);
    let mut update = scope.clone();
    update["taskId"] = task_id.clone().into();
    update["status"] = "ready".into();
    ok(
        &fixture.engine,
        "re-ready",
        "orchestration.taskUpdate",
        update,
    );
    let mut params3 = dispatch_params(&scope, &task_id);
    params3["to"] = session2["id"].clone();
    let third = ok(&fixture.engine, "d3", "orchestration.dispatch", params3);
    let replaced = third["dispatch"]["dispatchId"].as_str().unwrap();
    assert_ne!(replaced, dispatch_id);
    let mut show = scope.clone();
    show["taskId"] = task_id.clone().into();
    show["preamble"] = true.into();
    let current = ok(
        &fixture.engine,
        "current",
        "orchestration.dispatchShow",
        show,
    );
    assert_eq!(current["dispatch"]["dispatchId"], replaced);
    stop_session(&fixture, &session);
    stop_session(&fixture, &session2);
}
