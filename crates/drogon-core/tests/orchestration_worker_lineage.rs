//! Orchestration worker lineage (issue #622, part A2): a daemon-spawned
//! worker records the session that asked for it, so the sidebar can nest it.
//!
//! Unix-only: workers launch a fixture `claude` shell script on PATH with a
//! dummy `drogon-cli`. No model inference. Every worker and parent session
//! is stopped through its exact retained handle with bounded waits; temp
//! dirs are owned by their test — never a broad `pkill`/`killall`.
#![cfg(unix)]

use std::sync::Mutex;
use std::time::{Duration, Instant};

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

/// Serializes PATH mutation across tests in this file.
static ENV_LOCK: Mutex<()> = Mutex::new(());

struct SavedPath(Option<std::ffi::OsString>);

impl SavedPath {
    fn capture() -> Self {
        Self(std::env::var_os("PATH"))
    }
}

impl Drop for SavedPath {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            unsafe { std::env::set_var("PATH", path) };
        }
    }
}

fn req(method: &str, request_id: &str, params: Value) -> Request {
    serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": request_id,
        "method": method,
        "params": params,
    }))
    .unwrap()
}

fn ok(engine: &Engine, method: &str, params: Value) -> Value {
    let request_id = uuid::Uuid::new_v4().to_string();
    let response = engine.dispatch(req(method, &request_id, params));
    assert!(
        response.ok,
        "expected ok for {method}: {:?}",
        response.error
    );
    response.result.unwrap()
}

fn err_response(engine: &Engine, method: &str, params: Value) -> String {
    let request_id = uuid::Uuid::new_v4().to_string();
    let response = engine.dispatch(req(method, &request_id, params));
    assert!(
        !response.ok,
        "expected error for {method}, got {:?}",
        response.result
    );
    response.error.unwrap().code
}

fn write_script(path: &std::path::Path, body: &str) {
    std::fs::write(path, body).unwrap();
    use std::os::unix::fs::PermissionsExt;
    let mut perm = std::fs::metadata(path).unwrap().permissions();
    perm.set_mode(0o755);
    std::fs::set_permissions(path, perm).unwrap();
}

fn prepend_bin(bin: &std::path::Path) {
    let existing = std::env::var_os("PATH").unwrap_or_default();
    let mut paths = vec![bin.to_path_buf()];
    paths.extend(std::env::split_paths(&existing));
    let joined = std::env::join_paths(&paths).unwrap();
    unsafe { std::env::set_var("PATH", joined) };
}

fn find_sleep() -> String {
    for candidate in ["/bin/sleep", "/usr/bin/sleep"] {
        if std::path::Path::new(candidate).is_file() {
            return candidate.to_string();
        }
    }
    panic!("no sleep binary for the parent fixture");
}

struct WorkerSetup {
    engine: Engine,
    workspace_id: String,
    host: String,
    run_id: String,
}

impl WorkerSetup {
    fn open(dir: &tempfile::TempDir, bin: &tempfile::TempDir) -> Self {
        write_script(&bin.path().join("claude"), "#!/bin/sh\nsleep 30\n");
        write_script(&bin.path().join("drogon-cli"), "#!/bin/sh\nexit 0\n");
        prepend_bin(bin.path());
        let cli = bin.path().join("drogon-cli");
        let engine = Engine::open(dir.path())
            .unwrap()
            .with_worker_cli(&cli)
            .unwrap();
        let workspace_dir = dir.path().join("ws");
        std::fs::create_dir_all(&workspace_dir).unwrap();
        let workspace_id = ok(
            &engine,
            "workspace.register",
            json!({ "path": workspace_dir.to_string_lossy() }),
        )["id"]
            .as_str()
            .unwrap()
            .to_string();
        let host = ok(&engine, "status", json!({}))["hostId"]
            .as_str()
            .unwrap()
            .to_string();
        let run_id = ok(
            &engine,
            "orchestration.runCreate",
            json!({
                "contractVersion": 1, "hostId": host,
                "coordinatorId": "owner", "objective": "lineage",
            }),
        )["run"]["runId"]
            .as_str()
            .unwrap()
            .to_string();
        Self {
            engine,
            workspace_id,
            host,
            run_id,
        }
    }

    fn task(&self, tag: &str) -> String {
        ok(
            &self.engine,
            "orchestration.taskCreate",
            json!({
                "contractVersion": 1, "hostId": self.host, "runId": self.run_id,
                "coordinatorId": "owner", "consumerGeneration": 1,
                "spec": {"instructions": tag, "dependsOn": []},
            }),
        )["task"]["taskId"]
            .as_str()
            .unwrap()
            .to_string()
    }

    fn start_worker(&self, task_id: &str, extra: Value) -> Value {
        let mut params = json!({
            "contractVersion": 1, "hostId": self.host, "runId": self.run_id,
            "coordinatorId": "owner", "consumerGeneration": 1,
            "taskId": task_id, "workspaceId": self.workspace_id,
            "mode": "fresh",
            "launch": {"harnessId": "claude", "model": "fixture-model",
                       "permissionMode": "unattended"},
        });
        for (key, value) in extra.as_object().unwrap() {
            params[key] = value.clone();
        }
        ok(&self.engine, "orchestration.workerStart", params)
    }

    fn session_row(&self, session_id: &str) -> Value {
        ok(&self.engine, "session.list", json!({}))["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == session_id)
            .expect("worker session must be listed")
            .clone()
    }

    fn stop_worker(&self, dispatch_id: &str) {
        ok(
            &self.engine,
            "orchestration.workerStop",
            json!({
                "contractVersion": 1, "hostId": self.host, "runId": self.run_id,
                "coordinatorId": "owner", "consumerGeneration": 1,
                "dispatchId": dispatch_id,
            }),
        );
    }

    fn wait_for_session_exit(&self, session_id: &str) {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let row = self.session_row(session_id);
            if row["verdict"] == json!("exited") {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "worker session never exited: {row}"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

/// A worker started with its creator's session nests under it.
#[test]
fn worker_started_from_inside_session_nests_under_it() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved = SavedPath::capture();
    let dir = tempfile::tempdir().unwrap();
    let bin = tempfile::tempdir().unwrap();
    let setup = WorkerSetup::open(&dir, &bin);

    // The creator session: a plain shell the worker will nest under.
    let parent = ok(
        &setup.engine,
        "session.start",
        json!({
            "workspaceId": setup.workspace_id,
            "command": find_sleep(),
            "args": ["30"],
        }),
    );
    let parent_id = parent["id"].as_str().unwrap().to_string();
    let parent_inc = parent["incarnation"].as_str().unwrap().to_string();

    let task_id = setup.task("nested worker");
    let started = setup.start_worker(&task_id, json!({ "parentSessionId": parent_id }));
    let dispatch_id = started["dispatchId"].as_str().unwrap().to_string();
    let worker_session = started["sessionIdentity"]["sessionId"]
        .as_str()
        .unwrap()
        .to_string();
    assert_ne!(worker_session, parent_id);

    let row = setup.session_row(&worker_session);
    assert_eq!(row["parentSessionId"], json!(parent_id));

    setup.stop_worker(&dispatch_id);
    setup.wait_for_session_exit(&worker_session);
    ok(
        &setup.engine,
        "session.stop",
        json!({ "sessionId": parent_id, "incarnation": parent_inc }),
    );
}

/// A worker started with no creator session stays parentless.
#[test]
fn worker_without_parent_stays_parentless() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved = SavedPath::capture();
    let dir = tempfile::tempdir().unwrap();
    let bin = tempfile::tempdir().unwrap();
    let setup = WorkerSetup::open(&dir, &bin);

    let task_id = setup.task("parentless worker");
    let started = setup.start_worker(&task_id, json!({}));
    let dispatch_id = started["dispatchId"].as_str().unwrap().to_string();
    let worker_session = started["sessionIdentity"]["sessionId"]
        .as_str()
        .unwrap()
        .to_string();

    let row = setup.session_row(&worker_session);
    assert_eq!(row["parentSessionId"], Value::Null);

    setup.stop_worker(&dispatch_id);
    setup.wait_for_session_exit(&worker_session);
}

/// A `parentSessionId` naming no session on this host is refused before any
/// worker effect.
#[test]
fn worker_with_unknown_parent_is_refused() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved = SavedPath::capture();
    let dir = tempfile::tempdir().unwrap();
    let bin = tempfile::tempdir().unwrap();
    let setup = WorkerSetup::open(&dir, &bin);

    let task_id = setup.task("refused lineage");
    let code = err_response(
        &setup.engine,
        "orchestration.workerStart",
        json!({
            "contractVersion": 1, "hostId": setup.host, "runId": setup.run_id,
            "coordinatorId": "owner", "consumerGeneration": 1,
            "taskId": task_id, "workspaceId": setup.workspace_id,
            "mode": "fresh",
            "launch": {"harnessId": "claude", "model": "fixture-model",
                       "permissionMode": "unattended"},
            "parentSessionId": "no-such-session",
        }),
    );
    assert_eq!(code, "not_found");

    // No worker session leaked for the refused start.
    let listed = ok(&setup.engine, "session.list", json!({}));
    assert_eq!(
        listed["sessions"].as_array().unwrap().len(),
        0,
        "a refused workerStart must leave no session"
    );
}
