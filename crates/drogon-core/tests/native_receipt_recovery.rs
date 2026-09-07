//! Actor-scoped recovery of the engine's existing durable ledger.

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

fn call(engine: &Engine, method: &str, id: &str, params: Value) -> Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    })
}

fn ok(engine: &Engine, method: &str, id: &str, params: Value) -> Value {
    let response = call(engine, method, id, params);
    assert!(response.ok, "{method}: {:?}", response.error);
    response.result.unwrap()
}

#[test]
fn bootstrap_receipt_survives_reopen_without_allocating_read_receipts() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host = ok(&engine, "status", "status", json!({}))["hostId"].clone();
    let created = ok(
        &engine,
        "orchestration.runCreate",
        "create",
        json!({
            "contractVersion":1,"hostId":host,"coordinatorId":"owner","objective":"recover"
        }),
    );
    drop(engine);
    let engine = Engine::open(dir.path()).unwrap();
    let scope =
        json!({"actorKind":"bootstrap","contractVersion":1,"hostId":host,"coordinatorId":"owner"});
    let result = ok(
        &engine,
        "orchestration.requestShow",
        "inspect",
        json!({"scope":scope,"requestId":"create"}),
    );
    assert_eq!(result["requestId"], "create");
    assert_eq!(result["state"], "committed");
    assert_eq!(result["method"], "orchestration.runCreate");
    assert_eq!(result["receipt"]["result"], created);
    let absent = ok(
        &engine,
        "orchestration.requestShow",
        "inspect",
        json!({"scope":scope,"requestId":"unknown"}),
    );
    assert_eq!(absent["state"], "absent");
    assert!(
        absent["interpretation"]
            .as_str()
            .unwrap()
            .contains("not proof")
    );
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    assert_eq!(
        conn.query_row("SELECT count(*) FROM requests", [], |r| r.get::<_, u32>(0))
            .unwrap(),
        1
    );
}

#[test]
fn receipt_lookup_fences_stale_coordinator_before_returning_saved_state() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host = ok(&engine, "status", "status", json!({}))["hostId"].clone();
    let run = ok(
        &engine,
        "orchestration.runCreate",
        "create",
        json!({
            "contractVersion":1,"hostId":host,"coordinatorId":"owner","objective":"fence"
        }),
    )["run"]["runId"]
        .clone();
    let scope = json!({"actorKind":"coordinator","contractVersion":1,"hostId":host,
        "runId":run,"coordinatorId":"owner","consumerGeneration":1});
    let mut params = scope.clone();
    params["spec"] = json!({"instructions":"task"});
    ok(&engine, "orchestration.taskCreate", "task", params);
    assert_eq!(
        ok(
            &engine,
            "orchestration.requestShow",
            "show",
            json!({"scope":scope,"requestId":"task"})
        )["state"],
        "committed"
    );
    ok(
        &engine,
        "orchestration.runUse",
        "takeover",
        json!({
            "contractVersion":1,"hostId":host,"runId":run,"coordinatorId":"new-owner",
            "consumerGeneration":1,"takeover":true
        }),
    );
    for target in ["task", "unknown"] {
        let refused = call(
            &engine,
            "orchestration.requestShow",
            "show",
            json!({"scope":scope,"requestId":target}),
        );
        assert_eq!(refused.error.unwrap().code, "consumer_fenced");
    }
}

fn bootstrap_fixture() -> (tempfile::TempDir, Engine, Value, rusqlite::Connection) {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host = ok(&engine, "status", "status", json!({}))["hostId"].clone();
    ok(
        &engine,
        "orchestration.runCreate",
        "create",
        json!({
            "contractVersion":1,"hostId":host,"coordinatorId":"owner","objective":"recovery"
        }),
    );
    let scope =
        json!({"actorKind":"bootstrap","contractVersion":1,"hostId":host,"coordinatorId":"owner"});
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    (dir, engine, scope, conn)
}

#[test]
fn pending_failure_and_corrupt_receipts_are_distinct_without_read_side_effects() {
    let (_dir, engine, scope, conn) = bootstrap_fixture();
    conn.execute(
        "UPDATE requests SET status='pending',result_json=NULL,error_json=NULL",
        [],
    )
    .unwrap();
    let pending = ok(
        &engine,
        "orchestration.requestShow",
        "show",
        json!({"scope":scope,"requestId":"create"}),
    );
    assert_eq!(pending["state"], "pending");
    assert!(pending.get("receipt").is_none());
    conn.execute(
        "UPDATE requests SET status='done',error_json=?1",
        [r#"{"code":"fixture_failure","message":"safe failure","retryable":false}"#],
    )
    .unwrap();
    let failure = ok(
        &engine,
        "orchestration.requestShow",
        "show",
        json!({"scope":scope,"requestId":"create"}),
    );
    assert_eq!(failure["state"], "failed");
    assert_eq!(failure["receipt"]["error"]["code"], "fixture_failure");
    for corrupt in ["not-json-SENTINEL", "null", "{\"code\":12}"] {
        conn.execute("UPDATE requests SET error_json=?1", [corrupt])
            .unwrap();
        let refused = call(
            &engine,
            "orchestration.requestShow",
            "show",
            json!({"scope":scope,"requestId":"create"}),
        );
        assert_eq!(refused.error.unwrap().code, "internal_error");
    }
    assert_eq!(
        conn.query_row("SELECT count(*) FROM requests", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn receipt_lookup_does_not_cross_bootstrap_actor_or_execution_host() {
    let (_dir, engine, mut scope, _conn) = bootstrap_fixture();
    scope["coordinatorId"] = json!("other-owner");
    assert_eq!(
        ok(
            &engine,
            "orchestration.requestShow",
            "show",
            json!({"scope":scope,"requestId":"create"})
        )["state"],
        "absent"
    );
    scope["hostId"] = json!("remote-host");
    let refused = call(
        &engine,
        "orchestration.requestShow",
        "show",
        json!({"scope":scope,"requestId":"create"}),
    );
    assert!(!refused.ok);
    assert!(refused.result.is_none());
}

#[test]
fn complete_receipt_response_respects_byte_budget_not_only_stored_payload() {
    let (_dir, engine, scope, conn) = bootstrap_fixture();
    let payload = serde_json::to_string(&"x".repeat(512 * 1024 - 2)).unwrap();
    assert_eq!(payload.len(), 512 * 1024);
    conn.execute(
        "UPDATE requests SET result_json=?1,error_json=NULL,status='done'",
        [payload],
    )
    .unwrap();
    let refused = call(
        &engine,
        "orchestration.requestShow",
        "show",
        json!({"scope":scope,"requestId":"create"}),
    );
    assert!(
        !refused.ok,
        "the envelope must not push a successful response over budget"
    );
    assert_eq!(refused.error.unwrap().code, "result_too_large");
    assert_eq!(
        conn.query_row("SELECT count(*) FROM requests", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn corrupt_oversized_metadata_is_refused_without_echoing_it() {
    let (_dir, engine, scope, conn) = bootstrap_fixture();
    let oversized = "SENTINEL".repeat(80 * 1024);
    for statement in [
        "UPDATE requests SET method=?1",
        "UPDATE requests SET method='orchestration.runCreate',status=?1",
    ] {
        conn.execute(statement, [&oversized]).unwrap();
        let refused = call(
            &engine,
            "orchestration.requestShow",
            "show",
            json!({"scope":scope,"requestId":"create"}),
        );
        assert!(!refused.ok);
        assert_eq!(refused.error.as_ref().unwrap().code, "internal_error");
        assert!(
            !serde_json::to_string(&refused)
                .unwrap()
                .contains("SENTINEL")
        );
    }
}
