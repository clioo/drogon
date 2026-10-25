//! Regression for the audit's P0: a session must never be spawned in a cwd
//! the caller did not ask for.
//!
//! The PTY layer used to substitute `$HOME` when a workspace's directory was
//! missing, so starting a terminal or agent from a card whose folder had been
//! deleted (Finder, an unmounted volume, a manual `git worktree remove`)
//! silently ran the process in the owner's home directory while the session
//! row and its card still named the dead workspace. Admission now refuses
//! with `invalid_argument` naming the path, before a pending row exists and
//! before any process is started.
//!
//! Real `Engine`, real SQLite, real PTY child: the bug was invisible to
//! anything that mocked the session layer, because the substitution happened
//! inside the spawn syscall arguments.

#![cfg(unix)]

use std::time::{Duration, Instant};

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

fn call(engine: &Engine, method: &str, params: Value) -> Response {
    let request: Request = serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": uuid::Uuid::new_v4().to_string(),
        "method": method,
        "params": params,
    }))
    .unwrap();
    engine.dispatch(request)
}

fn ok(engine: &Engine, method: &str, params: Value) -> Value {
    let response = call(engine, method, params);
    assert!(
        response.ok,
        "expected ok for {method}: {:?}",
        response.error
    );
    response.result.unwrap()
}

fn err(engine: &Engine, method: &str, params: Value) -> drogon_protocol::RpcError {
    let response = call(engine, method, params);
    assert!(
        !response.ok,
        "expected an error for {method}, got {:?}",
        response.result
    );
    response.error.unwrap()
}

fn sessions(engine: &Engine, workspace_id: &str) -> Vec<Value> {
    ok(engine, "session.list", json!({"workspaceId": workspace_id}))["sessions"]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

/// A session whose PTY is unmistakably alive and stays that way for the test.
fn start_live_session(engine: &Engine, workspace_id: &str) -> Value {
    let session = ok(
        engine,
        "session.start",
        json!({
            "workspaceId": workspace_id,
            "command": "/bin/sh",
            "args": ["-c", "printf READY; sleep 60"],
            "cols": 80, "rows": 24
        }),
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let read = ok(
            engine,
            "session.read",
            json!({"sessionId": session["id"], "incarnation": session["incarnation"], "cursor": 0}),
        );
        use base64::Engine as _;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(read["dataBase64"].as_str().unwrap())
            .unwrap();
        if String::from_utf8_lossy(&bytes).contains("READY") {
            return session;
        }
        assert!(
            Instant::now() < deadline,
            "the fixture session never reported READY"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

struct Fixture {
    data: tempfile::TempDir,
    workspace: tempfile::TempDir,
    engine: Engine,
    workspace_id: String,
}

fn fixture() -> Fixture {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let workspace = tempfile::tempdir().unwrap();
    ok(
        &engine,
        "project.add",
        json!({"path": workspace.path().to_string_lossy()}),
    );
    let registered = ok(&engine, "workspace.list", json!({}));
    let wanted = std::fs::canonicalize(workspace.path()).unwrap();
    let workspace_id = registered["workspaces"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| {
            entry["path"]
                .as_str()
                .map(|path| std::fs::canonicalize(path).unwrap_or_else(|_| path.into()) == wanted)
                .unwrap_or(false)
        })
        .map(|entry| entry["id"].as_str().unwrap().to_string())
        .expect("the registered folder project owns one workspace");
    Fixture {
        data,
        workspace,
        engine,
        workspace_id,
    }
}

/// Teardown for a session a test deliberately left running.
fn settle(engine: &Engine, session: &Value) {
    let stopped = ok(
        engine,
        "session.stop",
        json!({"sessionId": session["id"], "incarnation": session["incarnation"]}),
    );
    assert_eq!(stopped["verdict"], "exited");
}

#[test]
fn a_removed_workspace_folder_refuses_the_spawn_and_leaves_no_session() {
    let fx = fixture();
    // A session in the still-existing folder proves the fixture spawns.
    let live = start_live_session(&fx.engine, &fx.workspace_id);
    assert_eq!(sessions(&fx.engine, &fx.workspace_id).len(), 1);

    let missing = fx.workspace.path().to_path_buf();
    drop(fx.workspace);
    assert!(!missing.exists(), "the workspace folder must be gone");

    let refusal = err(
        &fx.engine,
        "session.start",
        json!({"workspaceId": fx.workspace_id, "command": "/bin/sh", "args": [], "cols": 80, "rows": 24}),
    );
    assert_eq!(refusal.code, "invalid_argument", "{}", refusal.message);
    assert!(
        refusal.message.contains(missing.to_str().unwrap()),
        "the refusal must name the missing directory: {}",
        refusal.message
    );
    assert!(
        refusal.message.contains("does not exist"),
        "the refusal must say what is wrong: {}",
        refusal.message
    );

    // Nothing was admitted, so nothing can be left live or pending: the
    // refused spawn never wrote a row and never reached the PTY.
    let listed = sessions(&fx.engine, &fx.workspace_id);
    assert_eq!(
        listed.len(),
        1,
        "a refused spawn must not add a session: {listed:?}"
    );
    assert_eq!(
        listed[0]["id"], live["id"],
        "the only row is the pre-existing live session"
    );
    let host_wide = ok(&fx.engine, "session.list", json!({}))["sessions"]
        .as_array()
        .unwrap()
        .len();
    assert_eq!(host_wide, 1, "no second session exists host-wide");

    settle(&fx.engine, &live);
    assert!(fx.data.path().is_dir());
}

/// The same guard covers an explicit `cwd`: a caller that names a directory
/// inside the workspace which has since been removed gets the same honest
/// refusal instead of a `$HOME` session.
#[test]
fn an_explicit_cwd_that_vanished_refuses_the_spawn() {
    let fx = fixture();
    let nested = fx.workspace.path().join("src");
    std::fs::create_dir(&nested).unwrap();
    let session = ok(
        &fx.engine,
        "session.start",
        json!({
            "workspaceId": fx.workspace_id,
            "command": "/bin/sh",
            "args": ["-c", "printf READY; sleep 60"],
            "cwd": nested.to_string_lossy(),
            "cols": 80, "rows": 24
        }),
    );
    settle(&fx.engine, &session);

    std::fs::remove_dir(&nested).unwrap();
    let refusal = err(
        &fx.engine,
        "session.start",
        json!({
            "workspaceId": fx.workspace_id,
            "command": "/bin/sh",
            "args": [],
            "cwd": nested.to_string_lossy(),
            "cols": 80, "rows": 24
        }),
    );
    // The explicit-cwd branch already answered this before the fix; the test
    // pins that both branches refuse rather than falling back.
    assert_eq!(refusal.code, "invalid_argument", "{}", refusal.message);
    assert_eq!(
        sessions(&fx.engine, &fx.workspace_id).len(),
        1,
        "the exited session is the only row"
    );
}
