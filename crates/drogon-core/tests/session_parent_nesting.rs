//! Issue #359: the parent-session record behind the sidebar's nested
//! subagent box. `session.start`/`harness.start` accept an additive
//! `parentSessionId` (a `drogon-cli` invoked inside a terminal reports its
//! inherited `DROGON_SESSION_ID`, the fork's env-inheritance lineage
//! adapted to this repo), the daemon persists it durably, and every wire
//! surface (`session.start` result, live `session.list` rows, restored
//! rows after a daemon restart) reports it. Unix-only, like `engine.rs`.
#![cfg(unix)]

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

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

fn err_code(engine: &Engine, method: &str, params: Value) -> String {
    let request_id = uuid::Uuid::new_v4().to_string();
    let response = engine.dispatch(req(method, &request_id, params));
    assert!(
        !response.ok,
        "expected error for {method}, got {:?}",
        response.result
    );
    response.error.unwrap().code
}

fn register_workspace(engine: &Engine) -> String {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_string_lossy().to_string();
    std::mem::forget(dir);
    let ws = ok(engine, "workspace.register", json!({ "path": path }));
    ws["id"].as_str().unwrap().to_string()
}

fn start_session(engine: &Engine, workspace_id: &str, parent: Option<Value>) -> Value {
    let mut params = json!({
        "workspaceId": workspace_id,
        "command": "/bin/sh",
        "args": ["-c", "sleep 30"],
        "cols": 80,
        "rows": 24,
    });
    if let Some(parent) = parent {
        params["parentSessionId"] = parent;
    }
    ok(engine, "session.start", params)
}

fn listed_row<'a>(list: &'a Value, id: &str) -> &'a Value {
    list["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == id)
        .unwrap_or_else(|| panic!("session {id} must be listed: {list}"))
}

#[test]
fn parentless_sessions_report_null_parent() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let session = start_session(&engine, &workspace_id, None);
    assert!(
        session["parentSessionId"].is_null(),
        "a UI-spawned session has no parent: {session}"
    );
}

#[test]
fn session_start_records_and_reports_the_parent_session() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let parent = start_session(&engine, &workspace_id, None);
    let parent_id = parent["id"].as_str().unwrap().to_string();

    let child = start_session(&engine, &workspace_id, Some(json!(parent_id)));
    assert_eq!(
        child["parentSessionId"],
        json!(parent_id),
        "the spawn result must echo the recorded parent: {child}"
    );

    let list = ok(
        &engine,
        "session.list",
        json!({ "workspaceId": workspace_id }),
    );
    let row = listed_row(&list, child["id"].as_str().unwrap());
    assert_eq!(row["parentSessionId"], json!(parent_id));
    let parent_row = listed_row(&list, &parent_id);
    assert!(
        parent_row["parentSessionId"].is_null(),
        "the parent is itself parentless: {parent_row}"
    );

    let (child_id, child_inc) = (
        child["id"].as_str().unwrap().to_string(),
        child["incarnation"].as_str().unwrap().to_string(),
    );
    let stopped = ok(
        &engine,
        "session.stop",
        json!({ "sessionId": child_id, "incarnation": child_inc }),
    );
    assert_eq!(stopped["parentSessionId"], json!(parent_id));
}

#[test]
fn session_start_refuses_an_unknown_parent_session() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    assert_eq!(
        err_code(
            &engine,
            "session.start",
            json!({
                "workspaceId": workspace_id,
                "command": "/bin/sh",
                "args": ["-c", "sleep 30"],
                "parentSessionId": "00000000-0000-0000-0000-000000000000",
            }),
        ),
        "not_found",
        "a parent that names no session on this host must be refused"
    );
}

#[test]
fn parent_record_survives_a_daemon_restart() {
    let dir = tempfile::tempdir().unwrap();
    let (parent_id, child_id) = {
        let engine = Engine::open(dir.path()).unwrap();
        let workspace_id = register_workspace(&engine);
        let parent = start_session(&engine, &workspace_id, None);
        let child = start_session(&engine, &workspace_id, Some(json!(parent["id"])));
        (
            parent["id"].as_str().unwrap().to_string(),
            child["id"].as_str().unwrap().to_string(),
        )
        // Engine drops without stop: crash-recovery shape; rows come back
        // `unverifiable` but the lineage record must still be reported.
    };
    let engine = Engine::open(dir.path()).unwrap();
    let list = ok(&engine, "session.list", json!({}));
    let row = listed_row(&list, &child_id);
    assert_eq!(row["parentSessionId"], json!(parent_id));
    assert_eq!(row["verdict"], "unverifiable");
}

#[test]
fn harness_start_records_the_parent_session() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let parent = start_session(&engine, &workspace_id, None);
    let parent_id = parent["id"].as_str().unwrap().to_string();

    // Antigravity installs no hook wiring, so it needs no fixture on PATH.
    let launched = ok(
        &engine,
        "harness.start",
        json!({
            "workspaceId": workspace_id,
            "harnessId": "antigravity",
            "permissionMode": "inherit",
            "parentSessionId": parent_id,
        }),
    );
    assert_eq!(
        launched["parentSessionId"],
        json!(parent_id),
        "a harness launched from inside a session carries the same parent record: {launched}"
    );

    assert_eq!(
        err_code(
            &engine,
            "harness.start",
            json!({
                "workspaceId": workspace_id,
                "harnessId": "antigravity",
                "permissionMode": "inherit",
                "parentSessionId": "00000000-0000-0000-0000-000000000000",
            }),
        ),
        "not_found"
    );
}
