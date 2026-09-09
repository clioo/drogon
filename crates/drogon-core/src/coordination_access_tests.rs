//! SQLite credential isolation, revocation and migration coverage.

use rusqlite::Connection;
use serde_json::json;

use super::{
    apply_pending_steps_in_tx, authorize_worker, digest_presented_secret, recheck_in_tx,
    register_in_tx, revoke_in_tx,
};

const HOST: &str = "host-1";
const RUN: &str = "run-1";
const TASK: &str = "task-1";
const DISPATCH: &str = "dispatch-1";
const SESSION: &str = "session-1";
const INCARNATION: &str = "incarnation-1";
const SECRET: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn migrated_conn() -> Connection {
    let mut conn = Connection::open_in_memory().expect("in-memory fixture db");
    let tx = conn.transaction().expect("begin");
    apply_pending_steps_in_tx(&tx).expect("migrate");
    tx.commit().expect("commit");
    conn
}

fn register(conn: &mut Connection, secret: &str) {
    let digest = digest_presented_secret(secret);
    let tx = conn.transaction().expect("begin");
    register_in_tx(
        &tx,
        &digest,
        HOST,
        RUN,
        TASK,
        DISPATCH,
        SESSION,
        INCARNATION,
        "2026-09-07T00:00:00Z",
    )
    .expect("register");
    tx.commit().expect("commit");
}

fn dispatch_scope() -> serde_json::Value {
    json!({
        "actorKind": "dispatch",
        "contractVersion": 1,
        "hostId": HOST,
        "runId": RUN,
        "taskId": TASK,
        "dispatchId": DISPATCH,
    })
}

#[test]
fn migration_creates_table_and_is_idempotent() {
    let mut conn = migrated_conn();
    let tx = conn.transaction().expect("begin");
    apply_pending_steps_in_tx(&tx).expect("second migrate is a no-op");
    tx.commit().expect("commit");
    conn.execute("SELECT 1 FROM orchestration_dispatch_credentials", [])
        .expect("table exists");
}

#[test]
fn migration_rollback_leaves_no_table() {
    let mut conn = Connection::open_in_memory().expect("in-memory fixture db");
    {
        let tx = conn.transaction().expect("begin");
        apply_pending_steps_in_tx(&tx).expect("migrate");
    }
    let err = conn
        .execute("SELECT 1 FROM orchestration_dispatch_credentials", [])
        .unwrap_err();
    assert!(format!("{err}").contains("no such table"));
}

#[test]
fn only_hash_is_ever_persisted_not_the_raw_secret() {
    let mut conn = migrated_conn();
    register(&mut conn, SECRET);
    let stored: String = conn
        .query_row(
            "SELECT digest FROM orchestration_dispatch_credentials LIMIT 1",
            [],
            |r| r.get(0),
        )
        .expect("row");
    assert_ne!(stored, SECRET);
    assert_eq!(stored, digest_presented_secret(SECRET));
    let full: String = conn
        .query_row(
            "SELECT digest || '|' || host_id || '|' || run_id || '|' || task_id || '|' ||
                    dispatch_id || '|' || session_id || '|' || incarnation
               FROM orchestration_dispatch_credentials LIMIT 1",
            [],
            |r| r.get(0),
        )
        .expect("row");
    assert!(!full.contains(SECRET));
}

#[test]
fn valid_active_worker_status_is_authorized() {
    let mut conn = migrated_conn();
    register(&mut conn, SECRET);
    let binding = authorize_worker(&conn, HOST, SECRET, "status", &json!({})).expect("authorized");
    assert_eq!(binding.dispatch_id, DISPATCH);
    assert!(!binding.revoked);
}

#[test]
fn missing_credential_is_unauthorized() {
    let conn = migrated_conn();
    let err = authorize_worker(&conn, HOST, "", "status", &json!({})).unwrap_err();
    assert_eq!(err.code, "unauthorized");
}

#[test]
fn unknown_credential_is_unauthorized() {
    let conn = migrated_conn();
    let err = authorize_worker(&conn, HOST, SECRET, "status", &json!({})).unwrap_err();
    assert_eq!(err.code, "unauthorized");
}

#[test]
fn revoked_credential_is_unauthorized_even_for_status() {
    let mut conn = migrated_conn();
    register(&mut conn, SECRET);
    let tx = conn.transaction().expect("begin");
    revoke_in_tx(&tx, DISPATCH, "task replaced").expect("revoke");
    tx.commit().expect("commit");
    let err = authorize_worker(&conn, HOST, SECRET, "status", &json!({})).unwrap_err();
    assert_eq!(err.code, "unauthorized");
}

#[test]
fn revoke_in_tx_is_idempotent() {
    let mut conn = migrated_conn();
    register(&mut conn, SECRET);
    for _ in 0..2 {
        let tx = conn.transaction().expect("begin");
        revoke_in_tx(&tx, DISPATCH, "task replaced").expect("revoke");
        tx.commit().expect("commit");
    }
    let err = authorize_worker(&conn, HOST, SECRET, "status", &json!({})).unwrap_err();
    assert_eq!(err.code, "unauthorized");
}

#[test]
fn wrong_host_is_unauthorized() {
    let mut conn = migrated_conn();
    register(&mut conn, SECRET);
    let err = authorize_worker(&conn, "other-host", SECRET, "status", &json!({})).unwrap_err();
    assert_eq!(err.code, "unauthorized");
}

#[test]
fn forbidden_methods_are_unauthorized_before_any_scope_check() {
    let mut conn = migrated_conn();
    register(&mut conn, SECRET);
    for method in [
        "session.start",
        "session.read",
        "session.write",
        "session.stop",
        "workspace.register",
        "workspace.list",
        "harness.start",
        "harness.list",
        "runtime.shutdown",
        "orchestration.runCreate",
        "orchestration.runCurrent",
        "orchestration.runBind",
        "orchestration.taskCreate",
        "orchestration.taskUpdate",
        "orchestration.gateCreate",
        "orchestration.gateResolve",
        "orchestration.gateList",
        "orchestration.workerStart",
        "orchestration.workerStop",
        "unknown.method",
    ] {
        let err = authorize_worker(&conn, HOST, SECRET, method, &json!({})).unwrap_err();
        assert_eq!(err.code, "unauthorized", "method {method} must be refused");
    }
}

#[test]
fn admin_existing_methods_are_not_in_the_worker_allowlist() {
    for method in ["session.start", "workspace.register", "runtime.shutdown"] {
        assert!(!super::is_allowed_worker_method(method));
    }
    for method in [
        "status",
        "orchestration.send",
        "orchestration.check",
        "orchestration.ask",
        "orchestration.reply",
        "orchestration.requestShow",
    ] {
        assert!(super::is_allowed_worker_method(method));
    }
}

#[test]
fn matching_own_dispatch_scope_is_authorized_for_send() {
    let mut conn = migrated_conn();
    register(&mut conn, SECRET);
    let params = json!({ "scope": dispatch_scope(), "payload": {"kind": "heartbeat"} });
    authorize_worker(&conn, HOST, SECRET, "orchestration.send", &params).expect("authorized");
}

#[test]
fn missing_scope_field_is_unauthorized() {
    let mut conn = migrated_conn();
    register(&mut conn, SECRET);
    let err = authorize_worker(&conn, HOST, SECRET, "orchestration.send", &json!({})).unwrap_err();
    assert_eq!(err.code, "unauthorized");
}

#[test]
fn mismatched_dispatch_id_in_scope_is_unauthorized() {
    let mut conn = migrated_conn();
    register(&mut conn, SECRET);
    let mut scope = dispatch_scope();
    scope["dispatchId"] = json!("some-other-dispatch");
    let params = json!({ "scope": scope });
    let err = authorize_worker(&conn, HOST, SECRET, "orchestration.check", &params).unwrap_err();
    assert_eq!(err.code, "unauthorized");
}

#[test]
fn mismatched_task_id_in_scope_is_unauthorized() {
    let mut conn = migrated_conn();
    register(&mut conn, SECRET);
    let mut scope = dispatch_scope();
    scope["taskId"] = json!("some-other-task");
    let params = json!({ "scope": scope });
    let err = authorize_worker(&conn, HOST, SECRET, "orchestration.ask", &params).unwrap_err();
    assert_eq!(err.code, "unauthorized");
}

#[test]
fn coordinator_scope_escalation_is_unauthorized() {
    let mut conn = migrated_conn();
    register(&mut conn, SECRET);
    let scope = json!({
        "actorKind": "coordinator",
        "contractVersion": 1,
        "hostId": HOST,
        "runId": RUN,
        "coordinatorId": "coord-1",
        "consumerGeneration": 1,
    });
    let params = json!({ "scope": scope });
    let err = authorize_worker(&conn, HOST, SECRET, "orchestration.reply", &params).unwrap_err();
    assert_eq!(err.code, "unauthorized");
}

#[test]
fn request_show_dispatch_scope_matching_own_binding_is_authorized() {
    let mut conn = migrated_conn();
    register(&mut conn, SECRET);
    let params = json!({ "scope": dispatch_scope(), "requestId": "req-1" });
    authorize_worker(&conn, HOST, SECRET, "orchestration.requestShow", &params)
        .expect("authorized");
}

#[test]
fn request_show_bootstrap_scope_is_unauthorized() {
    let mut conn = migrated_conn();
    register(&mut conn, SECRET);
    let scope = json!({
        "actorKind": "bootstrap",
        "contractVersion": 1,
        "hostId": HOST,
        "coordinatorId": "coord-1",
    });
    let params = json!({ "scope": scope, "requestId": "req-1" });
    let err =
        authorize_worker(&conn, HOST, SECRET, "orchestration.requestShow", &params).unwrap_err();
    assert_eq!(err.code, "unauthorized");
}

#[test]
fn request_show_coordinator_scope_is_unauthorized() {
    let mut conn = migrated_conn();
    register(&mut conn, SECRET);
    let scope = json!({
        "actorKind": "coordinator",
        "contractVersion": 1,
        "hostId": HOST,
        "runId": RUN,
        "coordinatorId": "coord-1",
        "consumerGeneration": 1,
    });
    let params = json!({ "scope": scope, "requestId": "req-1" });
    let err =
        authorize_worker(&conn, HOST, SECRET, "orchestration.requestShow", &params).unwrap_err();
    assert_eq!(err.code, "unauthorized");
}

#[test]
fn another_dispatchs_credential_cannot_address_this_scope() {
    let mut conn = migrated_conn();
    register(&mut conn, SECRET);
    let other_secret = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    let digest = digest_presented_secret(other_secret);
    let tx = conn.transaction().expect("begin");
    register_in_tx(
        &tx,
        &digest,
        HOST,
        RUN,
        "task-2",
        "dispatch-2",
        "session-2",
        "incarnation-2",
        "2026-09-07T00:00:00Z",
    )
    .expect("register second");
    tx.commit().expect("commit");
    let own_scope = json!({
        "actorKind": "dispatch",
        "contractVersion": 1,
        "hostId": HOST,
        "runId": RUN,
        "taskId": "task-2",
        "dispatchId": "dispatch-2",
    });
    authorize_worker(
        &conn,
        HOST,
        other_secret,
        "orchestration.send",
        &json!({ "scope": own_scope }),
    )
    .expect("own scope authorized");
    let err = authorize_worker(
        &conn,
        HOST,
        other_secret,
        "orchestration.send",
        &json!({ "scope": dispatch_scope() }),
    )
    .unwrap_err();
    assert_eq!(err.code, "unauthorized");
}

#[test]
fn recheck_in_tx_sees_a_revocation_that_raced_the_initial_authorization() {
    let mut conn = migrated_conn();
    register(&mut conn, SECRET);
    let binding = authorize_worker(
        &conn,
        HOST,
        SECRET,
        "orchestration.send",
        &json!({ "scope": dispatch_scope() }),
    )
    .expect("initial authorization");
    {
        let tx = conn.transaction().expect("begin revoke");
        revoke_in_tx(&tx, DISPATCH, "replaced by a new attempt").expect("revoke");
        tx.commit().expect("commit revoke");
    }
    let tx = conn.transaction().expect("begin mutating tx");
    let err = recheck_in_tx(&tx, &binding, "status").unwrap_err();
    assert_eq!(err.code, "unauthorized");
    tx.rollback().expect("rollback");
}

#[test]
fn recheck_in_tx_reports_the_live_binding_when_not_revoked() {
    let mut conn = migrated_conn();
    register(&mut conn, SECRET);
    let binding = authorize_worker(&conn, HOST, SECRET, "status", &json!({})).unwrap();
    let tx = conn.transaction().expect("begin");
    let binding = recheck_in_tx(&tx, &binding, "status").expect("still authorized");
    assert_eq!(binding.run_id, RUN);
    assert_eq!(binding.task_id, TASK);
    assert!(!binding.revoked);
    tx.rollback().expect("rollback");
}

#[test]
fn recheck_in_tx_unknown_dispatch_is_unauthorized() {
    let mut conn = migrated_conn();
    register(&mut conn, SECRET);
    let binding = authorize_worker(&conn, HOST, SECRET, "status", &json!({})).unwrap();
    let tx = Connection::open_in_memory().unwrap();
    let tx = tx.unchecked_transaction().expect("begin");
    apply_pending_steps_in_tx(&tx).expect("migrate");
    let err = recheck_in_tx(&tx, &binding, "status").unwrap_err();
    assert_eq!(err.code, "unauthorized");
    tx.rollback().expect("rollback");
    drop(conn);
}

/// A credential revoked with reason `"reported"` but with no matching
/// `orchestration_attempts` row at all (never settled, or the row is simply
/// absent) must never be treated as recovered -- the reason string is a
/// hint, not proof; the durable attempt state is the only proof.
#[test]
fn reported_reason_without_any_matching_attempt_row_is_unauthorized() {
    let mut conn = migrated_conn();
    {
        let tx = conn.transaction().expect("begin");
        crate::coordination_attempts::migrate(&tx).expect("migrate attempts schema");
        tx.commit().expect("commit");
    }
    register(&mut conn, SECRET);
    let tx = conn.transaction().expect("begin revoke");
    revoke_in_tx(&tx, DISPATCH, "reported").expect("revoke");
    tx.commit().expect("commit revoke");

    for method in ["status", "orchestration.send", "orchestration.requestShow"] {
        let params = if method == "status" {
            json!({})
        } else {
            json!({ "scope": dispatch_scope() })
        };
        let err = authorize_worker(&conn, HOST, SECRET, method, &params).unwrap_err();
        assert_eq!(err.code, "unauthorized", "method: {method}");
    }
}

/// A credential revoked for a real product reason other than its own report
/// (`"superseded"`, from a retry replacing the current attempt) must never
/// recover through the narrow settled-report paths, even if some unrelated
/// attempt row happens to carry a settled outcome.
#[test]
fn superseded_reason_never_grants_settled_report_recovery() {
    let mut conn = migrated_conn();
    {
        let tx = conn.transaction().expect("begin");
        crate::coordination_attempts::migrate(&tx).expect("migrate attempts schema");
        tx.execute(
            "INSERT INTO orchestration_attempts(dispatch_id,host_id,run_id,task_id,is_current,fenced,state_json)
             VALUES (?1,?2,?3,?4,0,1,?5)",
            rusqlite::params![
                DISPATCH,
                HOST,
                RUN,
                TASK,
                json!({
                    "result": {"runId": RUN, "taskId": TASK, "dispatchId": DISPATCH,
                        "consumerGeneration":1, "workspaceId":"w", "assignmentState":"completed",
                        "readiness":"workerObserved", "processVerdict":"unverifiable",
                        "effects":[], "residualResources":[]},
                    "launch": {"harnessId":"claude","permissionMode":"inherit"},
                    "outcome": "succeeded", "report_message_id": "msg-1", "cleanup_owned": false,
                })
                .to_string()
            ],
        )
        .expect("seed superseded, already-settled attempt row");
        tx.commit().expect("commit");
    }
    register(&mut conn, SECRET);
    let tx = conn.transaction().expect("begin revoke");
    revoke_in_tx(&tx, DISPATCH, "superseded").expect("revoke");
    tx.commit().expect("commit revoke");

    for method in ["status", "orchestration.send", "orchestration.requestShow"] {
        let params = if method == "status" {
            json!({})
        } else {
            json!({ "scope": dispatch_scope() })
        };
        let err = authorize_worker(&conn, HOST, SECRET, method, &params).unwrap_err();
        assert_eq!(err.code, "unauthorized", "method: {method}");
    }
}

/// A dispatch that genuinely reported (revoked for reason `"reported"`, its
/// own attempt row carries a settled outcome) but whose attempt has since
/// been retried and replaced (`is_current = 0`, fenced by the newer attempt
/// admission created) must never recover through the narrow settled-report
/// paths -- only the *current* attempt's own settlement counts; a retired
/// one cannot, even though nothing forged the reason.
#[test]
fn reported_but_retired_by_a_later_retry_is_unauthorized() {
    let mut conn = migrated_conn();
    {
        let tx = conn.transaction().expect("begin");
        crate::coordination_attempts::migrate(&tx).expect("migrate attempts schema");
        tx.execute(
            "INSERT INTO orchestration_attempts(dispatch_id,host_id,run_id,task_id,is_current,fenced,state_json)
             VALUES (?1,?2,?3,?4,0,1,?5)",
            rusqlite::params![
                DISPATCH,
                HOST,
                RUN,
                TASK,
                json!({
                    "result": {"runId": RUN, "taskId": TASK, "dispatchId": DISPATCH,
                        "consumerGeneration":1, "workspaceId":"w", "assignmentState":"failed",
                        "readiness":"workerObserved", "processVerdict":"unverifiable",
                        "effects":[], "residualResources":[]},
                    "launch": {"harnessId":"claude","permissionMode":"inherit"},
                    "outcome": "failed", "report_message_id": "msg-1", "cleanup_owned": false,
                })
                .to_string()
            ],
        )
        .expect("seed a genuinely reported but retired (is_current=0) attempt row");
        // The retry's own new attempt row is the current one for this task now.
        tx.execute(
            "INSERT INTO orchestration_attempts(dispatch_id,host_id,run_id,task_id,is_current,fenced,state_json)
             VALUES ('dispatch-retry',?1,?2,?3,1,0,?4)",
            rusqlite::params![
                HOST,
                RUN,
                TASK,
                json!({
                    "result": {"runId": RUN, "taskId": TASK, "dispatchId": "dispatch-retry",
                        "consumerGeneration":1, "workspaceId":"w", "assignmentState":"ready",
                        "readiness":"notObserved", "processVerdict":"unverifiable",
                        "effects":[], "residualResources":[]},
                    "launch": {"harnessId":"claude","permissionMode":"inherit"},
                    "outcome": null, "report_message_id": null, "cleanup_owned": false,
                })
                .to_string()
            ],
        )
        .expect("seed the replacing retry's current attempt row");
        tx.commit().expect("commit");
    }
    register(&mut conn, SECRET);
    let tx = conn.transaction().expect("begin revoke");
    revoke_in_tx(&tx, DISPATCH, "reported").expect("revoke");
    tx.commit().expect("commit revoke");

    for method in ["status", "orchestration.send", "orchestration.requestShow"] {
        let params = if method == "status" {
            json!({})
        } else {
            json!({ "scope": dispatch_scope() })
        };
        let err = authorize_worker(&conn, HOST, SECRET, method, &params).unwrap_err();
        assert_eq!(err.code, "unauthorized", "method: {method}");
    }
}
