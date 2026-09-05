#![cfg(unix)]

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

fn call(engine: &Engine, method: &str, params: Value) -> Value {
    let result = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        auth: None,
        method: method.into(),
        params,
    });
    assert!(result.ok, "{method}: {:?}", result.error);
    result.result.unwrap()
}

#[test]
fn direct_child_exit_is_observed_before_descendant_closes_the_pty() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace = call(&engine, "workspace.register", json!({"path":dir.path()}));
    let session = call(
        &engine,
        "session.start",
        json!({
            "workspaceId": workspace["id"], "command":"/bin/sh",
            "args":["-c", "sleep 2 & exit 9"],
        }),
    );
    let started = Instant::now();
    let mut observed = false;
    while started.elapsed() < Duration::from_millis(1000) {
        let rows = call(&engine, "session.list", json!({}));
        if rows["sessions"][0]["verdict"] == "exited" {
            assert_eq!(rows["sessions"][0]["exitCode"], 9);
            observed = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let stopped = call(
        &engine,
        "session.stop",
        json!({"sessionId":session["id"], "incarnation":session["incarnation"]}),
    );
    assert_eq!(stopped["verdict"], "exited");
    // The bounded descendant finishes itself; stopping the parent is not descendant cleanup evidence.
    std::thread::sleep(Duration::from_millis(2200));
    assert!(observed, "Child exit must not wait for descendant PTY EOF");
}

#[test]
fn malformed_optional_arguments_cannot_launch_or_broaden_scope() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace = call(&engine, "workspace.register", json!({"path":dir.path()}));
    for args in [Value::Null, json!("--print"), json!({})] {
        let result = engine.dispatch(Request {
            protocol: PROTOCOL_VERSION,
            request_id: uuid::Uuid::new_v4().to_string(),
            auth: None,
            method: "session.start".into(),
            params: json!({"workspaceId":workspace["id"], "command":"/bin/sh", "args":args}),
        });
        assert_eq!(result.error.unwrap().code, "invalid_argument");
    }
    let result = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        auth: None,
        method: "session.list".into(),
        params: json!({"workspaceId":null}),
    });
    assert_eq!(result.error.unwrap().code, "invalid_argument");
    assert!(
        call(&engine, "session.list", json!({}))["sessions"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}
