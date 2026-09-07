//! Direct Engine/SQLite authentication coverage; subprocess tests live in drogond.
#![cfg(unix)]

use std::path::Path;

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use rusqlite::Connection;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const SERVICE_CREDENTIAL: &str = "service-secret-token";
const WORKER_SECRET: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const RUN: &str = "run-1";
const TASK: &str = "task-1";
const DISPATCH: &str = "dispatch-1";
const SESSION: &str = "session-1";
const INCARNATION: &str = "incarnation-1";

fn digest_hex(secret: &str) -> String {
    format!("{:x}", Sha256::digest(secret.as_bytes()))
}

fn seed_worker_credential(data_dir: &Path, host_id: &str, secret: &str) {
    let conn = Connection::open(data_dir.join(drogon_core::DB_FILE_NAME)).expect("open db file");
    conn.execute(
        "INSERT INTO orchestration_dispatch_credentials
            (digest, host_id, run_id, task_id, dispatch_id, session_id, incarnation, revoked, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, '2026-09-07T00:00:00Z')",
        rusqlite::params![digest_hex(secret), host_id, RUN, TASK, DISPATCH, SESSION, INCARNATION],
    )
    .expect("insert credential fixture row");
}

fn revoke_worker_credential(data_dir: &Path) {
    let conn = Connection::open(data_dir.join(drogon_core::DB_FILE_NAME)).expect("open db file");
    conn.execute(
        "UPDATE orchestration_dispatch_credentials SET revoked = 1 WHERE dispatch_id = ?1",
        rusqlite::params![DISPATCH],
    )
    .expect("revoke credential fixture row");
}

fn req(method: &str, request_id: &str, auth: Option<&str>, params: Value) -> Request {
    serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": request_id,
        "auth": auth,
        "method": method,
        "params": params,
    }))
    .unwrap()
}

fn own_dispatch_scope(host_id: &str) -> Value {
    json!({
        "actorKind": "dispatch",
        "contractVersion": 1,
        "hostId": host_id,
        "runId": RUN,
        "taskId": TASK,
        "dispatchId": DISPATCH,
    })
}

#[test]
fn migration_creates_the_credentials_table_at_real_startup() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).expect("open engine (runs real migration)");
    drop(engine);
    let conn = Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    conn.execute("SELECT 1 FROM orchestration_dispatch_credentials", [])
        .expect("table exists after real Engine::open");
}

#[test]
fn admin_service_credential_flow_is_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let response = engine.dispatch_authenticated(
        req("status", "r1", Some(SERVICE_CREDENTIAL), json!({})),
        SERVICE_CREDENTIAL,
    );
    assert!(response.ok, "{:?}", response.error);
}

#[test]
fn valid_persisted_worker_credential_was_previously_refused_now_authorizes_status() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host_id = engine
        .dispatch(req("status", "boot", None, json!({})))
        .result
        .unwrap()["hostId"]
        .as_str()
        .unwrap()
        .to_string();

    let refused = engine.dispatch_authenticated(
        req("status", "r0", Some(WORKER_SECRET), json!({})),
        SERVICE_CREDENTIAL,
    );
    assert!(!refused.ok);
    assert_eq!(refused.error.unwrap().code, "unauthorized");

    seed_worker_credential(dir.path(), &host_id, WORKER_SECRET);

    let response = engine.dispatch_authenticated(
        req("status", "r1", Some(WORKER_SECRET), json!({})),
        SERVICE_CREDENTIAL,
    );
    assert!(response.ok, "{:?}", response.error);
}

#[test]
fn invalid_missing_and_revoked_worker_credentials_are_unauthorized() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host_id = engine
        .dispatch(req("status", "boot", None, json!({})))
        .result
        .unwrap()["hostId"]
        .as_str()
        .unwrap()
        .to_string();
    seed_worker_credential(dir.path(), &host_id, WORKER_SECRET);

    for (label, auth) in [("missing", None), ("garbage", Some("not-a-real-secret"))] {
        let response = engine
            .dispatch_authenticated(req("status", label, auth, json!({})), SERVICE_CREDENTIAL);
        assert!(!response.ok, "{label} must be refused");
        assert_eq!(response.error.unwrap().code, "unauthorized");
    }

    revoke_worker_credential(dir.path());
    let response = engine.dispatch_authenticated(
        req("status", "r-revoked", Some(WORKER_SECRET), json!({})),
        SERVICE_CREDENTIAL,
    );
    assert!(!response.ok);
    assert_eq!(response.error.unwrap().code, "unauthorized");
}

#[test]
fn wrong_host_scope_mismatch_and_coordinator_escalation_are_unauthorized() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host_id = engine
        .dispatch(req("status", "boot", None, json!({})))
        .result
        .unwrap()["hostId"]
        .as_str()
        .unwrap()
        .to_string();
    seed_worker_credential(dir.path(), "some-other-host", WORKER_SECRET);
    let wrong_host_response = engine.dispatch_authenticated(
        req("status", "r1", Some(WORKER_SECRET), json!({})),
        SERVICE_CREDENTIAL,
    );
    assert!(!wrong_host_response.ok);
    assert_eq!(wrong_host_response.error.unwrap().code, "unauthorized");

    let dir2 = tempfile::tempdir().unwrap();
    let engine2 = Engine::open(dir2.path()).unwrap();
    let host_id2 = engine2
        .dispatch(req("status", "boot", None, json!({})))
        .result
        .unwrap()["hostId"]
        .as_str()
        .unwrap()
        .to_string();
    seed_worker_credential(dir2.path(), &host_id2, WORKER_SECRET);

    let mut mismatched_scope = own_dispatch_scope(&host_id2);
    mismatched_scope["dispatchId"] = json!("some-other-dispatch");
    let scope_mismatch = engine2.dispatch_authenticated(
        req(
            "orchestration.send",
            "r2",
            Some(WORKER_SECRET),
            json!({ "scope": mismatched_scope }),
        ),
        SERVICE_CREDENTIAL,
    );
    assert!(!scope_mismatch.ok);
    assert_eq!(scope_mismatch.error.unwrap().code, "unauthorized");

    let coordinator_scope = json!({
        "actorKind": "coordinator",
        "contractVersion": 1,
        "hostId": host_id2,
        "runId": RUN,
        "coordinatorId": "coord-1",
        "consumerGeneration": 1,
    });
    let escalation = engine2.dispatch_authenticated(
        req(
            "orchestration.reply",
            "r3",
            Some(WORKER_SECRET),
            json!({ "scope": coordinator_scope }),
        ),
        SERVICE_CREDENTIAL,
    );
    assert!(!escalation.ok);
    assert_eq!(escalation.error.unwrap().code, "unauthorized");
    let _ = host_id;
}

#[test]
fn worker_credential_cannot_reach_raw_session_workspace_harness_or_shutdown() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host_id = engine
        .dispatch(req("status", "boot", None, json!({})))
        .result
        .unwrap()["hostId"]
        .as_str()
        .unwrap()
        .to_string();
    seed_worker_credential(dir.path(), &host_id, WORKER_SECRET);

    for (method, params) in [
        (
            "session.start",
            json!({"workspaceId": "w1", "command": "/bin/sh"}),
        ),
        ("session.list", json!({})),
        (
            "workspace.register",
            json!({"path": dir.path().to_string_lossy()}),
        ),
        ("workspace.list", json!({})),
        ("harness.list", json!({})),
        ("harness.start", json!({})),
        ("runtime.shutdown", json!({"hostId": host_id})),
    ] {
        let response = engine.dispatch_authenticated(
            req(method, "r", Some(WORKER_SECRET), params),
            SERVICE_CREDENTIAL,
        );
        assert!(
            !response.ok,
            "{method} must be refused for a worker credential"
        );
        assert_eq!(
            response.error.unwrap().code,
            "unauthorized",
            "method: {method}"
        );
    }
}

#[test]
fn worker_credential_never_allow_listed_method_falls_through_to_honest_unauthorized() {
    // `status`/`send`/`check`/`ask`/`reply`/`requestShow` are all wired now;
    // a coordinator-only method stays refused at the allowlist, not routed.
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host_id = engine
        .dispatch(req("status", "boot", None, json!({})))
        .result
        .unwrap()["hostId"]
        .as_str()
        .unwrap()
        .to_string();
    seed_worker_credential(dir.path(), &host_id, WORKER_SECRET);

    let response = engine.dispatch_authenticated(
        req(
            "orchestration.workerStart",
            "r1",
            Some(WORKER_SECRET),
            json!({ "hostId": host_id, "runId": RUN, "taskId": TASK }),
        ),
        SERVICE_CREDENTIAL,
    );
    assert!(!response.ok);
    assert_eq!(response.error.unwrap().code, "unauthorized");
}

#[test]
fn unknown_methods_are_still_denied_for_the_admin_service_credential_too() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let response = engine.dispatch_authenticated(
        req("totally.unknown", "r1", Some(SERVICE_CREDENTIAL), json!({})),
        SERVICE_CREDENTIAL,
    );
    assert!(!response.ok);
    assert_eq!(response.error.unwrap().code, "method_not_found");
}

#[test]
fn credential_never_appears_in_any_response_error_or_debug_text() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host_id = engine
        .dispatch(req("status", "boot", None, json!({})))
        .result
        .unwrap()["hostId"]
        .as_str()
        .unwrap()
        .to_string();
    seed_worker_credential(dir.path(), &host_id, WORKER_SECRET);

    let response = engine.dispatch_authenticated(
        req("session.start", "r1", Some(WORKER_SECRET), json!({})),
        SERVICE_CREDENTIAL,
    );
    let serialized = serde_json::to_string(&response).unwrap();
    assert!(!serialized.contains(WORKER_SECRET));
    assert!(!format!("{response:?}").contains(WORKER_SECRET));
}
