//! End-to-end `orchestration.reset` over a real in-process Engine: scope
//! correctness, host isolation, receipt replay, rollback and the
//! live-worker refusal. No model inference; live sessions are short `sleep`
//! processes owned and stopped by each test.

#![cfg(unix)]

use drogon_protocol::orchestration_common::{
    AssignmentState, LaunchPermissionMode, LaunchPreferences, ProcessVerdict, ReadinessObservation,
    SessionIdentity,
};
use drogon_protocol::orchestration_scope::COORDINATION_CONTRACT_VERSION;
use drogon_protocol::orchestration_worker::WorkerStartResult;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

use super::coordination_attempts::Attempt;
use crate::Engine;

fn reset_req(id: &str, host_id: &str, scope: &str) -> Request {
    serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": id,
        "method": "orchestration.reset",
        "params": {
            "contractVersion": COORDINATION_CONTRACT_VERSION,
            "hostId": host_id,
            "scope": scope,
        },
    }))
    .unwrap()
}

fn dispatch(engine: &Engine, request: Request) -> drogon_protocol::Response {
    engine.dispatch(request)
}

/// Seed two hosts' domain rows. The local host is seeded through the real
/// RPCs (run/task/gate/send) so fixtures exercise production writes; the
/// remote host uses full-column SQL (every NOT NULL column supplied — plain
/// `INSERT OR IGNORE` would silently skip rows otherwise).
fn seed_domain(engine: &Engine, host: &str, other: &str) {
    let rpc = |id: &str, method: &str, params: Value| {
        let response = dispatch(
            engine,
            serde_json::from_value(json!({
                "protocol": PROTOCOL_VERSION,
                "requestId": id,
                "method": method,
                "params": params,
            }))
            .unwrap(),
        );
        assert!(response.ok, "{method}: {:?}", response.error);
        response.result.unwrap()
    };
    let host_params = || {
        json!({
            "contractVersion": COORDINATION_CONTRACT_VERSION,
            "hostId": host,
        })
    };
    let run = rpc(
        "seed-run",
        "orchestration.runCreate",
        json!({
            "contractVersion": COORDINATION_CONTRACT_VERSION,
            "hostId": host,
            "objective": "seed",
            "coordinatorId": "coord-seed",
        }),
    );
    let run_id = run["run"]["runId"].as_str().unwrap().to_string();
    let scope = || {
        let mut base = host_params();
        base["runId"] = run_id.clone().into();
        base["coordinatorId"] = "coord-seed".into();
        base["consumerGeneration"] = 1.into();
        base
    };
    let task_a = rpc(
        "seed-task-a",
        "orchestration.taskCreate",
        json!({"contractVersion": COORDINATION_CONTRACT_VERSION,
            "hostId": host, "runId": run_id, "coordinatorId": "coord-seed",
            "consumerGeneration": 1,
            "spec": {"instructions": "do a"}}),
    );
    let task_a_id = task_a["task"]["taskId"].as_str().unwrap().to_string();
    rpc(
        "seed-task-b",
        "orchestration.taskCreate",
        json!({"contractVersion": COORDINATION_CONTRACT_VERSION,
            "hostId": host, "runId": run_id, "coordinatorId": "coord-seed",
            "consumerGeneration": 1,
            "spec": {"instructions": "do b", "dependsOn": [task_a_id]}}),
    );
    rpc(
        "seed-gate",
        "orchestration.gateCreate",
        json!({"contractVersion": COORDINATION_CONTRACT_VERSION,
            "hostId": host, "runId": run_id, "coordinatorId": "coord-seed",
            "consumerGeneration": 1, "taskId": task_a_id,
            "question": "proceed?"}),
    );
    let mut send_scope = scope();
    send_scope["actorKind"] = "coordinator".into();
    rpc(
        "seed-send",
        "orchestration.send",
        json!({"scope": send_scope,
            "kind": "status", "subject": "seed mail"}),
    );
    let _ = host_params;
    let conn = engine.db.lock().unwrap();
    let settled_attempt = |run: &str, task: &str, dispatch_id: &str| {
        serde_json::to_string(&Attempt {
            result: WorkerStartResult {
                run_id: run.into(),
                task_id: task.into(),
                dispatch_id: dispatch_id.into(),
                consumer_generation: 1,
                workspace_id: "ws-1".into(),
                assignment_state: AssignmentState::Completed,
                readiness: ReadinessObservation::NotObserved,
                process_verdict: ProcessVerdict::Exited,
                session_identity: None,
                effects: vec![],
                residual_resources: vec![],
                failure: None,
                warning: None,
            },
            launch: LaunchPreferences {
                harness_id: "harness-1".into(),
                model: None,
                effort: None,
                provider: None,
                permission_mode: LaunchPermissionMode::Inherit,
            },
            outcome: Some(drogon_protocol::orchestration_common::ReportOutcome::Succeeded),
            report_message_id: None,
            report_result: None,
            cleanup_owned: false,
        })
        .unwrap()
    };
    // Local settled attempt + retention + question thread + delivery pointer.
    conn.execute(
        "INSERT INTO orchestration_attempts (dispatch_id, host_id, run_id, task_id, is_current, fenced, state_json) VALUES ('dispatch-local', ?1, ?2, ?3, 0, 0, ?4)",
        rusqlite::params![
            host,
            run_id,
            task_a_id,
            settled_attempt(&run_id, &task_a_id, "dispatch-local"),
        ],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO worker_resource_retention (dispatch_id, state, reason, updated_at) VALUES ('dispatch-local', 'retained', 'test', 'now')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO orchestration_mail_questions (question_message_id, host_id, run_id, thread_id, closed) VALUES ('q-local', ?1, ?2, 'thread-local', 0)",
        rusqlite::params![host, run_id],
    )
    .unwrap();
    // Remote host: full-column raw rows (never through local RPCs).
    conn.execute(
        "INSERT INTO orchestration_runs (run_id, host_id, coordinator_id, consumer_generation, objective, created_at_ms) VALUES ('run-remote', ?1, 'coord-remote', 1, 'remote', 1)",
        [other],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO orchestration_run_bindings (host_id, coordinator_id, run_id, consumer_generation) VALUES (?1, 'coord-remote', 'run-remote', 1)",
        [other],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO orchestration_tasks (task_id, run_id, host_id, instructions, depends_on_json, status, created_at_ms) VALUES ('task-remote', 'run-remote', ?1, 'do r', '[]', 'pending', 1)",
        [other],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO orchestration_tasks (task_id, run_id, host_id, instructions, depends_on_json, status, created_at_ms) VALUES ('task-remote-child', 'run-remote', ?1, 'do r2', '[\"task-remote\"]', 'pending', 2)",
        [other],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO orchestration_task_dependencies (task_id, depends_on_task_id, position) VALUES ('task-remote-child', 'task-remote', 0)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO orchestration_gates (id, host_id, run_id, task_id, question, options, status) VALUES ('gate-remote', ?1, 'run-remote', 'task-remote', 'go?', '[]', 'pending')",
        [other],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO orchestration_attempts (dispatch_id, host_id, run_id, task_id, is_current, fenced, state_json) VALUES ('dispatch-remote', ?1, 'run-remote', 'task-remote', 0, 0, ?2)",
        rusqlite::params![
            other,
            settled_attempt("run-remote", "task-remote", "dispatch-remote"),
        ],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO worker_resource_retention (dispatch_id, state, reason, updated_at) VALUES ('dispatch-remote', 'retained', 'test', 'now')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO orchestration_mail_messages (message_id, host_id, run_id, kind, from_kind, subject, thread_id, origin_request_id, created_at) VALUES ('msg-remote', ?1, 'run-remote', 'status', 'coordinator', 'hi', 'thread-remote', 'req-remote', 'now')",
        [other],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO orchestration_mail_deliveries (delivery_id, host_id, run_id, message_ids_json, max_sequence) VALUES ('delivery-remote', ?1, 'run-remote', '[\"msg-remote\"]', 1)",
        [other],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO orchestration_mail_questions (question_message_id, host_id, run_id, thread_id, closed) VALUES ('q-remote', ?1, 'run-remote', 'thread-remote', 0)",
        [other],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO orchestration_mail_read_pointers (host_id, run_id, to_dispatch_id, read_through_sequence) VALUES (?1, 'run-remote', '', 0)",
        [other],
    )
    .unwrap();
}

fn count(engine: &Engine, table: &str, host: &str) -> i64 {
    engine
        .db
        .lock()
        .unwrap()
        .query_row(
            &format!("SELECT COUNT(*) FROM {table} WHERE host_id = ?1"),
            [host],
            |row| row.get(0),
        )
        .unwrap()
}

fn retention_count(engine: &Engine, dispatch: &str) -> i64 {
    engine
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM worker_resource_retention WHERE dispatch_id = ?1",
            [dispatch],
            |row| row.get(0),
        )
        .unwrap()
}

fn question_closed(engine: &Engine, qid: &str) -> i64 {
    engine
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT closed FROM orchestration_mail_questions WHERE question_message_id = ?1",
            [qid],
            |row| row.get(0),
        )
        .unwrap()
}

fn open_engine() -> (tempfile::TempDir, Engine, String) {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host = engine.host_id.clone();
    (dir, engine, host)
}

#[test]
fn reset_all_clears_local_domain_and_keeps_remote_and_receipts() {
    let (_dir, engine, host) = open_engine();
    let other = "host-elsewhere";
    seed_domain(&engine, &host, other);
    // A prior mutation receipt that reset must preserve.
    let create = dispatch(
        &engine,
        serde_json::from_value(json!({
            "protocol": PROTOCOL_VERSION,
            "requestId": "run-create-1",
            "method": "orchestration.runCreate",
            "params": {
                "contractVersion": COORDINATION_CONTRACT_VERSION,
                "hostId": host,
                "objective": "keep me",
                "coordinatorId": "coord-keep",
            },
        }))
        .unwrap(),
    );
    assert!(create.ok, "{:?}", create.error);

    let response = dispatch(&engine, reset_req("reset-1", &host, "all"));
    assert!(response.ok, "{:?}", response.error);
    assert_eq!(response.result.unwrap(), json!({"reset": "all"}));

    for table in [
        "orchestration_runs",
        "orchestration_run_bindings",
        "orchestration_tasks",
        "orchestration_gates",
        "orchestration_attempts",
        "orchestration_mail_messages",
        "orchestration_mail_deliveries",
        "orchestration_mail_questions",
        "orchestration_mail_read_pointers",
    ] {
        assert_eq!(count(&engine, table, &host), 0, "{table} not cleared");
        assert!(count(&engine, table, other) > 0, "{table} remote touched");
    }
    assert_eq!(retention_count(&engine, "dispatch-local"), 0);
    assert_eq!(retention_count(&engine, "dispatch-remote"), 1);
    let deps: i64 = engine
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM orchestration_task_dependencies",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(deps, 1, "only the remote dependency row survives");
    // The requests ledger survives reset (receipts are keyed by hashed
    // actor-scoped keys, so count by method, not raw request id).
    let kept: i64 = engine
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM requests WHERE method IN ('orchestration.runCreate', 'orchestration.reset')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(kept >= 2, "ledger rows lost: {kept}");
}

#[test]
fn reset_tasks_keeps_messages_and_closes_threads() {
    let (_dir, engine, host) = open_engine();
    seed_domain(&engine, &host, "host-elsewhere");
    let response = dispatch(&engine, reset_req("reset-t", &host, "tasks"));
    assert!(response.ok, "{:?}", response.error);
    assert_eq!(response.result.unwrap(), json!({"reset": "tasks"}));

    for table in [
        "orchestration_tasks",
        "orchestration_gates",
        "orchestration_attempts",
        "orchestration_run_bindings",
    ] {
        assert_eq!(count(&engine, table, &host), 0, "{table} not cleared");
    }
    // Messages are NOT deleted; the pending thread is closed instead. (A
    // run-home send creates no delivery row; only the message survives.)
    assert_eq!(count(&engine, "orchestration_mail_messages", &host), 1);
    assert_eq!(count(&engine, "orchestration_mail_questions", &host), 1);
    assert_eq!(question_closed(&engine, "q-local"), 1);
    // Runs survive the tasks scope.
    assert_eq!(count(&engine, "orchestration_runs", &host), 1);
    assert_eq!(retention_count(&engine, "dispatch-local"), 0);
}

#[test]
fn reset_messages_only_clears_mail() {
    let (_dir, engine, host) = open_engine();
    seed_domain(&engine, &host, "host-elsewhere");
    let response = dispatch(&engine, reset_req("reset-m", &host, "messages"));
    assert!(response.ok, "{:?}", response.error);
    assert_eq!(response.result.unwrap(), json!({"reset": "messages"}));

    for table in [
        "orchestration_mail_messages",
        "orchestration_mail_deliveries",
        "orchestration_mail_questions",
        "orchestration_mail_read_pointers",
    ] {
        assert_eq!(count(&engine, table, &host), 0, "{table} not cleared");
    }
    for table in [
        "orchestration_runs",
        "orchestration_run_bindings",
        "orchestration_tasks",
        "orchestration_gates",
        "orchestration_attempts",
    ] {
        assert!(count(&engine, table, &host) > 0, "{table} wrongly cleared");
    }
    assert_eq!(retention_count(&engine, "dispatch-local"), 1);
}

#[test]
fn reset_replay_returns_cached_result_and_conflicts_on_new_params() {
    let (_dir, engine, host) = open_engine();
    seed_domain(&engine, &host, "host-elsewhere");
    let first = dispatch(&engine, reset_req("reset-replay", &host, "all"));
    assert!(first.ok, "{:?}", first.error);
    // Same request id + same params: cached result, no re-reset (still ok).
    let replay = dispatch(&engine, reset_req("reset-replay", &host, "all"));
    assert!(replay.ok, "{:?}", replay.error);
    assert_eq!(replay.result.unwrap(), json!({"reset": "all"}));
    // Same request id + different scope: fingerprint conflict.
    let conflict = dispatch(&engine, reset_req("reset-replay", &host, "tasks"));
    assert!(!conflict.ok);
    assert_eq!(conflict.error.unwrap().code, "request_conflict");
}

#[test]
fn reset_rolls_back_everything_on_injected_storage_failure() {
    let (_dir, engine, host) = open_engine();
    seed_domain(&engine, &host, "host-elsewhere");
    engine
        .db
        .lock()
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER poison_tasks_delete BEFORE DELETE ON orchestration_tasks
             BEGIN SELECT RAISE(ABORT, 'injected reset failure'); END;",
        )
        .unwrap();
    let response = dispatch(&engine, reset_req("reset-poison", &host, "tasks"));
    assert!(!response.ok, "injected failure must surface");
    // Nothing was deleted and no receipt was kept (replay stays possible).
    assert_eq!(count(&engine, "orchestration_tasks", &host), 2);
    assert_eq!(count(&engine, "orchestration_gates", &host), 1);
    let receipts: i64 = engine
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM requests WHERE request_id = 'reset-poison'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(receipts, 0, "failed reset must not keep a receipt");
}

#[test]
fn reset_refuses_while_a_supervised_worker_is_live() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host = engine.host_id.clone();
    seed_domain(&engine, &host, "host-elsewhere");
    let invoke = |id: &str, method: &str, params: Value| {
        let response = dispatch(
            &engine,
            Request {
                protocol: PROTOCOL_VERSION,
                request_id: id.into(),
                auth: None,
                method: method.into(),
                params,
            },
        );
        assert!(response.ok, "{:?}", response.error);
        response.result.unwrap()
    };
    let workspace = invoke("ws", "workspace.register", json!({"path": dir.path()}));
    let ws_id = workspace["id"].as_str().unwrap().to_string();
    let session = invoke(
        "sess",
        "session.start",
        json!({"workspaceId": ws_id, "command": "/bin/sh", "args": ["-c", "exec sleep 30"]}),
    );
    let attempt = Attempt {
        result: WorkerStartResult {
            run_id: "run-local".into(),
            task_id: "task-local".into(),
            dispatch_id: "dispatch-live".into(),
            consumer_generation: 1,
            workspace_id: ws_id,
            assignment_state: AssignmentState::Ready,
            readiness: ReadinessObservation::NotObserved,
            process_verdict: ProcessVerdict::Live,
            session_identity: Some(SessionIdentity {
                session_id: session["id"].as_str().unwrap().into(),
                incarnation: session["incarnation"].as_str().unwrap().into(),
            }),
            effects: vec![],
            residual_resources: vec![],
            failure: None,
            warning: None,
        },
        launch: LaunchPreferences {
            harness_id: "harness-1".into(),
            model: None,
            effort: None,
            provider: None,
            permission_mode: LaunchPermissionMode::Inherit,
        },
        outcome: None,
        report_message_id: None,
        report_result: None,
        cleanup_owned: true,
    };
    engine
        .db
        .lock()
        .unwrap()
        .execute(
            "INSERT INTO orchestration_attempts (dispatch_id, host_id, run_id, task_id, is_current, fenced, state_json) VALUES ('dispatch-live', ?1, 'run-local', 'task-local', 1, 0, ?2)",
            rusqlite::params![host, serde_json::to_string(&attempt).unwrap()],
        )
        .unwrap();

    let refused = dispatch(&engine, reset_req("reset-live", &host, "all"));
    assert!(!refused.ok);
    assert_eq!(refused.error.unwrap().code, "worker_active");
    // Refusal mutated nothing.
    assert_eq!(count(&engine, "orchestration_tasks", &host), 2);
    assert_eq!(count(&engine, "orchestration_runs", &host), 1);

    // After the worker settles (session stopped), reset succeeds.
    let stop = dispatch(
        &engine,
        serde_json::from_value(json!({
            "protocol": PROTOCOL_VERSION,
            "requestId": "stop-live",
            "method": "session.stop",
            "params": {
                "sessionId": session["id"],
                "incarnation": session["incarnation"],
            },
        }))
        .unwrap(),
    );
    assert!(stop.ok, "{:?}", stop.error);
    let response = dispatch(&engine, reset_req("reset-live-2", &host, "all"));
    assert!(response.ok, "{:?}", response.error);
    assert_eq!(count(&engine, "orchestration_runs", &host), 0);
}
