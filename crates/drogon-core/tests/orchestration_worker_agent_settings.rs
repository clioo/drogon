//! Orchestration workers run with the owner's agent settings, like any
//! session the owner starts: their default args (where the unattended
//! `--dangerously-skip-permissions` of a normal setup lives) reach the
//! worker's argv. A worker is a daemon-owned tab nobody sits at, so an
//! explicit `unattended` request still stands, with or without settings.
//! Before, workers were planned from PATH alone and asked for permissions
//! nobody was there to grant.
//!
//! Unix-only: workers launch a fixture `claude` shell script on PATH with a
//! dummy `drogon-cli`. No model inference. Every worker is stopped through
//! its dispatch with a bounded wait; temp dirs are owned by their test.
#![cfg(unix)]

use std::sync::Mutex;
use std::time::{Duration, Instant};

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

/// Serializes PATH mutation across tests in this file.
static ENV_LOCK: Mutex<()> = Mutex::new(());

struct SavedPath(Option<std::ffi::OsString>);

impl Drop for SavedPath {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            unsafe { std::env::set_var("PATH", path) };
        }
    }
}

fn ok(engine: &Engine, method: &str, params: Value) -> Value {
    let request: Request = serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": uuid::Uuid::new_v4().to_string(),
        "method": method,
        "params": params,
    }))
    .unwrap();
    let response = engine.dispatch(request);
    assert!(
        response.ok,
        "expected ok for {method}: {:?}",
        response.error
    );
    response.result.unwrap()
}

fn write_script(path: &std::path::Path, body: &str) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::write(path, body).unwrap();
    let mut perm = std::fs::metadata(path).unwrap().permissions();
    perm.set_mode(0o755);
    std::fs::set_permissions(path, perm).unwrap();
}

fn write_settings(dir: &std::path::Path, default_args: Value) {
    std::fs::write(
        dir.join("agent-settings.json"),
        serde_json::to_vec(&json!({
            "version": 1,
            "settings": {
                "defaultTuiAgent": null,
                "disabledTuiAgents": [],
                "agentCmdOverrides": {},
                "agentDefaultArgs": default_args,
                "agentDefaultEnv": {},
                "agentStatusHooksEnabled": false,
                "tabAutoGenerateTitle": false,
                "promptCacheTimerEnabled": false,
                "promptCacheTtlMs": 300000,
                "codexSessionSourceHome": ""
            }
        }))
        .unwrap(),
    )
    .unwrap();
}

/// Starts one worker with `launch` and returns its argv, then stops it.
fn worker_args(settings: Option<Value>, launch: Value) -> Vec<String> {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved = SavedPath(std::env::var_os("PATH"));
    let dir = tempfile::tempdir().unwrap();
    let bin = tempfile::tempdir().unwrap();
    write_script(&bin.path().join("claude"), "#!/bin/sh\nsleep 30\n");
    write_script(&bin.path().join("drogon-cli"), "#!/bin/sh\nexit 0\n");
    let mut paths = vec![bin.path().to_path_buf()];
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    unsafe { std::env::set_var("PATH", std::env::join_paths(&paths).unwrap()) };
    if let Some(default_args) = settings {
        write_settings(dir.path(), default_args);
    }

    let engine = Engine::open(dir.path())
        .unwrap()
        .with_worker_cli(&bin.path().join("drogon-cli"))
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
        json!({"contractVersion": 1, "hostId": host, "coordinatorId": "owner", "objective": "settings"}),
    )["run"]["runId"]
        .as_str()
        .unwrap()
        .to_string();
    let task_id = ok(
        &engine,
        "orchestration.taskCreate",
        json!({
            "contractVersion": 1, "hostId": host, "runId": run_id,
            "coordinatorId": "owner", "consumerGeneration": 1,
            "spec": {"instructions": "review", "dependsOn": []},
        }),
    )["task"]["taskId"]
        .as_str()
        .unwrap()
        .to_string();
    let started = ok(
        &engine,
        "orchestration.workerStart",
        json!({
            "contractVersion": 1, "hostId": host, "runId": run_id,
            "coordinatorId": "owner", "consumerGeneration": 1,
            "taskId": task_id, "workspaceId": workspace_id,
            "mode": "fresh", "launch": launch,
        }),
    );
    let session_id = started["sessionIdentity"]["sessionId"]
        .as_str()
        .unwrap()
        .to_string();
    let dispatch_id = started["dispatchId"].as_str().unwrap().to_string();
    let row = ok(&engine, "session.list", json!({}))["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == session_id)
        .expect("worker session is listed")
        .clone();
    let args: Vec<String> = row["args"]
        .as_array()
        .expect("the session row carries its argv")
        .iter()
        .map(|a| a.as_str().unwrap().to_string())
        .collect();

    ok(
        &engine,
        "orchestration.workerStop",
        json!({
            "contractVersion": 1, "hostId": host, "runId": run_id,
            "coordinatorId": "owner", "consumerGeneration": 1, "dispatchId": dispatch_id,
        }),
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let verdict = ok(&engine, "session.list", json!({}))["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == session_id)
            .map(|s| s["verdict"].clone());
        if verdict == Some(json!("exited")) {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "worker never exited: {verdict:?}"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
    args
}

const SKIP: &str = "--dangerously-skip-permissions";

#[test]
fn a_worker_inherits_the_owners_default_args() {
    // What the orchestrator sends by default: no permission mode, a model.
    let args = worker_args(
        Some(json!({"claude": "--dangerously-skip-permissions --fixture-default"})),
        json!({"harnessId": "claude", "model": "claude-opus-5-5"}),
    );
    assert!(args.iter().any(|a| a == SKIP), "{args:?}");
    assert!(args.iter().any(|a| a == "--fixture-default"), "{args:?}");
    assert!(
        args.windows(2).any(|w| w == ["--model", "claude-opus-5-5"]),
        "{args:?}"
    );
}

#[test]
fn an_owner_without_default_args_gets_no_unrequested_flag() {
    let args = worker_args(
        Some(json!({"claude": ""})),
        json!({"harnessId": "claude", "model": "claude-opus-5-5"}),
    );
    assert!(!args.iter().any(|a| a == SKIP), "{args:?}");
}

#[test]
fn an_unattended_worker_stays_unattended_with_or_without_settings() {
    let launch = json!({"harnessId": "claude", "model": "m", "permissionMode": "unattended"});
    let with_settings = worker_args(Some(json!({"claude": ""})), launch.clone());
    assert!(with_settings.iter().any(|a| a == SKIP), "{with_settings:?}");
    let without = worker_args(None, launch);
    assert!(without.iter().any(|a| a == SKIP), "{without:?}");
}
