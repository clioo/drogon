#![cfg(unix)]
use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

fn call(engine: &Engine, method: &str, params: Value) -> drogon_protocol::Response {
    let request: Request = serde_json::from_value(json!({"protocol": PROTOCOL_VERSION, "requestId": uuid::Uuid::new_v4().to_string(), "method": method, "params": params})).unwrap();
    engine.dispatch(request)
}
fn ok(engine: &Engine, method: &str, params: Value) -> Value {
    let reply = call(engine, method, params);
    assert!(reply.ok, "{method}: {:?}", reply.error);
    reply.result.unwrap()
}
fn start(engine: &Engine, workspace: &Value) -> Value {
    ok(
        engine,
        "session.start",
        json!({"workspaceId": workspace, "command": "/bin/sh", "args": ["-c", "printf READY; sleep 60"]}),
    )
}
#[test]
fn deleting_a_chat_settles_only_its_own_live_processes_before_removing_files() {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let chat = ok(
        &engine,
        "project.quickSessionCreate",
        json!({"name": "Delete me"}),
    );
    let sibling = ok(
        &engine,
        "project.quickSessionCreate",
        json!({"name": "Keep me"}),
    );
    let owned = start(&engine, &chat["workspaceId"]);
    let other = start(&engine, &sibling["workspaceId"]);
    ok(
        &engine,
        "project.remove",
        json!({"id": chat["project"]["id"]}),
    );
    let read = ok(
        &engine,
        "session.read",
        json!({"sessionId": owned["id"], "incarnation": owned["incarnation"], "cursor": 0}),
    );
    assert_eq!(
        read["session"]["verdict"], "exited",
        "deleting a Chat must not orphan its live process"
    );
    let other_read = ok(
        &engine,
        "session.read",
        json!({"sessionId": other["id"], "incarnation": other["incarnation"], "cursor": 0}),
    );
    assert_eq!(other_read["session"]["verdict"], "live");
    assert!(!std::path::Path::new(chat["project"]["path"].as_str().unwrap()).exists());
    assert!(std::path::Path::new(sibling["project"]["path"].as_str().unwrap()).exists());
}

#[test]
fn unverifiable_chat_member_preserves_registration_and_scratch() {
    let data = tempfile::tempdir().unwrap();
    let (chat, member) = {
        let engine = Engine::open(data.path()).unwrap();
        let chat = ok(&engine, "project.quickSessionCreate", json!({}));
        let member = start(&engine, &chat["workspaceId"]);
        (chat, member)
    };
    // Restore a prior-instance active record, as left by a crash. The new
    // Engine has no process handle and must not assume that process exited.
    let conn = rusqlite::Connection::open(data.path().join("drogon.sqlite3")).unwrap();
    conn.execute(
        "UPDATE sessions SET verdict = 'live' WHERE id = ?1",
        [member["id"].as_str().unwrap()],
    )
    .unwrap();
    drop(conn);
    let engine = Engine::open(data.path()).unwrap();
    let reply = call(
        &engine,
        "project.remove",
        json!({"id": chat["project"]["id"]}),
    );
    assert!(!reply.ok);
    assert_eq!(reply.error.unwrap().code, "session_unverifiable");
    let projects = ok(&engine, "project.list", json!({}));
    assert!(
        projects["projects"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["id"] == chat["project"]["id"])
    );
    assert!(std::path::Path::new(chat["project"]["path"].as_str().unwrap()).exists());
}

#[test]
fn foreign_marker_preserves_registration_and_does_not_stop_the_session() {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let chat = ok(&engine, "project.quickSessionCreate", json!({}));
    let member = start(&engine, &chat["workspaceId"]);
    let path = std::path::Path::new(chat["project"]["path"].as_str().unwrap());
    std::fs::write(
        path.join(".drogon-quick-session.json"),
        "{\"owner\":\"foreign\",\"projectId\":\"foreign\"}",
    )
    .unwrap();
    assert!(
        !call(
            &engine,
            "project.remove",
            json!({"id": chat["project"]["id"]})
        )
        .ok
    );
    let projects = ok(&engine, "project.list", json!({}));
    assert!(
        projects["projects"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["id"] == chat["project"]["id"])
    );
    let read = ok(
        &engine,
        "session.read",
        json!({"sessionId": member["id"], "incarnation": member["incarnation"], "cursor": 0}),
    );
    assert_eq!(read["session"]["verdict"], "live");
    assert!(path.exists());
}
