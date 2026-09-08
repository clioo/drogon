//! `project.changes` over a real `Engine` (issue #146): the revision digest
//! a second client polls must move when projects come and go through the
//! same `dispatch` the daemon serves, and rest at the empty digest once
//! the registry is empty again.

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

fn ok(engine: &Engine, method: &str, request_id: &str, params: Value) -> Value {
    let response = engine.dispatch(req(method, request_id, params));
    assert!(
        response.ok,
        "expected ok for {method}: {:?}",
        response.error
    );
    response.result.unwrap()
}

fn revision(engine: &Engine, request_id: &str) -> String {
    ok(engine, "project.changes", request_id, json!({}))["revision"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn project_changes_moves_across_dispatch_when_projects_come_and_go() {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let empty = revision(&engine, "changes-empty");

    let dir = tempfile::tempdir().unwrap();
    let added = ok(
        &engine,
        "project.add",
        "add-1",
        json!({ "path": dir.path().to_string_lossy() }),
    );
    let id = added["id"].as_str().unwrap().to_string();
    assert_ne!(
        revision(&engine, "changes-added"),
        empty,
        "a dispatched project.add moves the digest another client polls"
    );

    let removed = ok(&engine, "project.remove", "remove-1", json!({ "id": id }));
    assert!(removed["removed"].as_bool().unwrap());
    assert_eq!(
        revision(&engine, "changes-removed"),
        empty,
        "removing the only project restores the empty digest"
    );
}
