//! Persistent explicit coordinator bindings: never infer the latest run globally.
use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};
fn ok(engine: &Engine, method: &str, id: &str, params: Value) -> Value {
    let response = engine.dispatch(
        serde_json::from_value::<Request>(json!({
            "protocol": PROTOCOL_VERSION, "requestId": id, "method": method, "params": params,
        }))
        .unwrap(),
    );
    assert!(response.ok, "{method}: {:?}", response.error);
    response.result.unwrap()
}
fn host(engine: &Engine) -> Value {
    ok(engine, "status", "status", json!({}))["hostId"].clone()
}
fn current(engine: &Engine, host: &Value, owner: &str) -> Value {
    ok(
        engine,
        "orchestration.runCurrent",
        "current",
        json!({
            "contractVersion": 1, "hostId": host, "coordinatorId": owner,
        }),
    )["run"]
        .clone()
}
fn create(engine: &Engine, host: &Value, owner: &str, id: &str) -> Value {
    ok(
        engine,
        "orchestration.runCreate",
        id,
        json!({
            "contractVersion": 1, "hostId": host, "coordinatorId": owner, "objective": id,
        }),
    )["run"]
        .clone()
}
#[test]
fn current_run_is_bound_by_create_and_use_not_by_global_recency() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host = host(&engine);
    assert!(current(&engine, &host, "alice").is_null());
    let first = create(&engine, &host, "alice", "first");
    let second = create(&engine, &host, "alice", "second");
    let unrelated = create(&engine, &host, "bob", "unrelated");
    assert_eq!(current(&engine, &host, "alice"), second);
    assert_eq!(current(&engine, &host, "bob"), unrelated);
    // Replaying an older creation must not silently change the current binding.
    assert_eq!(create(&engine, &host, "alice", "first"), first);
    assert_eq!(current(&engine, &host, "alice"), second);
    let used = ok(
        &engine,
        "orchestration.runUse",
        "use-first",
        json!({
            "contractVersion": 1, "hostId": host, "coordinatorId": "alice",
            "runId": first["runId"], "consumerGeneration": 1,
        }),
    )["run"]
        .clone();
    assert_eq!(used, first);
    assert_eq!(current(&engine, &host, "alice"), first);
    drop(engine);
    let engine = Engine::open(dir.path()).unwrap();
    assert_eq!(current(&engine, &host, "alice"), first);
    assert_eq!(current(&engine, &host, "bob"), unrelated);
    let taken = ok(
        &engine,
        "orchestration.runUse",
        "takeover",
        json!({
            "contractVersion": 1, "hostId": host, "coordinatorId": "carol",
            "runId": first["runId"], "consumerGeneration": 1, "takeover": true,
        }),
    )["run"]
        .clone();
    assert_eq!(taken["consumerGeneration"], 2);
    assert!(current(&engine, &host, "alice").is_null());
    assert_eq!(current(&engine, &host, "carol"), taken);
}
#[test]
fn upgrading_unbound_runs_does_not_guess_a_coordinator_binding() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host = host(&engine);
    create(&engine, &host, "alice", "first");
    let second = create(&engine, &host, "alice", "second");
    drop(engine);
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    // Reconstruct the previous schema: neither existing run identifies a current binding.
    conn.execute_batch("DROP TABLE IF EXISTS orchestration_run_bindings; UPDATE orchestration_domain_meta SET version=3;").unwrap();
    drop(conn);
    let engine = Engine::open(dir.path()).unwrap();
    assert!(current(&engine, &host, "alice").is_null());
    ok(
        &engine,
        "orchestration.runUse",
        "explicit-use",
        json!({
            "contractVersion": 1, "hostId": host, "coordinatorId": "alice",
            "runId": second["runId"], "consumerGeneration": 1,
        }),
    );
    assert_eq!(current(&engine, &host, "alice"), second);
}
