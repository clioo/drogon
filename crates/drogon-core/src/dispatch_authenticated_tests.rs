//! Real Engine authorization and binding-replacement races.

use serde_json::json;
use sha2::{Digest, Sha256};

use crate::Engine;
use crate::coordination_access;
use drogon_protocol::{PROTOCOL_VERSION, Request};

const SERVICE_CREDENTIAL: &str = "service-secret-token";
const WORKER_SECRET: &str = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const RUN: &str = "run-1";
const TASK: &str = "task-1";
const DISPATCH: &str = "dispatch-1";
const SESSION: &str = "session-1";
const INCARNATION: &str = "incarnation-1";

fn digest(secret: &str) -> String {
    format!("{:x}", Sha256::digest(secret.as_bytes()))
}

fn req(method: &str, auth: Option<&str>) -> Request {
    serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": "r1",
        "auth": auth,
        "method": method,
        "params": {},
    }))
    .unwrap()
}

fn open_engine_with_worker(secret: &str) -> (tempfile::TempDir, Engine, String) {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host_id = engine.host_id.clone();
    {
        let mut conn = engine.db.lock().unwrap();
        let tx = conn.transaction().unwrap();
        coordination_access::register_in_tx(
            &tx,
            &digest(secret),
            &host_id,
            RUN,
            TASK,
            DISPATCH,
            SESSION,
            INCARNATION,
            "2026-09-07T00:00:00Z",
        )
        .unwrap();
        tx.commit().unwrap();
    }
    (dir, engine, host_id)
}

#[test]
fn worker_dispatch_answers_status_without_entering_the_admin_dispatcher() {
    let (_dir, engine, _host_id) = open_engine_with_worker(WORKER_SECRET);
    let response =
        engine.dispatch_authenticated(req("status", Some(WORKER_SECRET)), SERVICE_CREDENTIAL);
    assert!(response.ok, "{:?}", response.error);
    assert_eq!(response.result.unwrap()["hostId"], json!(_host_id));
}

#[test]
fn replaced_binding_after_authorization_cannot_inherit_a_stale_credential() {
    for changed_field in [
        "host_id",
        "run_id",
        "task_id",
        "session_id",
        "incarnation",
        "digest",
    ] {
        let (_dir, engine, host_id) = open_engine_with_worker(WORKER_SECRET);
        let binding = {
            let conn = engine.db.lock().unwrap();
            coordination_access::authorize_worker(
                &conn,
                &host_id,
                WORKER_SECRET,
                "status",
                &json!({}),
            )
            .unwrap()
        };
        {
            let conn = engine.db.lock().unwrap();
            conn.execute(&format!("UPDATE orchestration_dispatch_credentials SET {changed_field} = 'replacement' WHERE dispatch_id = ?1"), [DISPATCH]).unwrap();
        }
        let response = engine.dispatch_worker(binding, req("status", Some(WORKER_SECRET)));
        assert!(
            !response.ok,
            "stale binding survived replacement of {changed_field}: {response:?}"
        );
        assert_eq!(response.error.unwrap().code, "unauthorized");
    }
}

#[test]
fn revocation_committed_after_entry_authorization_denies_the_real_worker_dispatch() {
    let (_dir, engine, host_id) = open_engine_with_worker(WORKER_SECRET);

    let binding = {
        let conn = engine.db.lock().unwrap();
        coordination_access::authorize_worker(&conn, &host_id, WORKER_SECRET, "status", &json!({}))
            .expect("initial authorization")
    };

    {
        let mut conn = engine.db.lock().unwrap();
        let tx = conn.transaction().unwrap();
        coordination_access::revoke_in_tx(&tx, DISPATCH, "superseded").unwrap();
        tx.commit().unwrap();
    }

    let response = engine.dispatch_worker(binding, req("status", Some(WORKER_SECRET)));
    assert!(
        !response.ok,
        "revoked binding must be denied, got {response:?}"
    );
    assert_eq!(response.error.unwrap().code, "unauthorized");
}

#[test]
fn allowed_but_unimplemented_orchestration_method_is_honest_method_not_found_not_a_fake_success() {
    let (_dir, engine, host_id) = open_engine_with_worker(WORKER_SECRET);
    let scope = json!({
        "actorKind": "dispatch",
        "contractVersion": 1,
        "hostId": host_id,
        "runId": RUN,
        "taskId": TASK,
        "dispatchId": DISPATCH,
    });
    let request: Request = serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": "r2",
        "auth": WORKER_SECRET,
        "method": "orchestration.send",
        "params": { "scope": scope, "payload": {"kind": "heartbeat"} },
    }))
    .unwrap();
    let response = engine.dispatch_authenticated(request, SERVICE_CREDENTIAL);
    assert!(!response.ok);
    assert_eq!(response.error.unwrap().code, "method_not_found");
}
