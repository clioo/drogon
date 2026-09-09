//! Real Engine run/task regressions; initial RED evidence is retained in Git.
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

fn ok(engine: &Engine, method: &str, request_id: &str, params: Value) -> Value {
    let response = engine.dispatch(req(method, request_id, params));
    assert!(
        response.ok,
        "expected ok for {method}: {:?}",
        response.error
    );
    response.result.unwrap()
}

fn err_code(engine: &Engine, method: &str, request_id: &str, params: Value) -> String {
    let response = engine.dispatch(req(method, request_id, params));
    assert!(
        !response.ok,
        "expected error for {method}, got {:?}",
        response.result
    );
    response.error.unwrap().code
}

fn real_host_id(engine: &Engine) -> String {
    ok(engine, "status", "status-1", json!({}))["hostId"]
        .as_str()
        .unwrap()
        .to_string()
}

/// `orchestration.runCreate` params per the contract table +
/// "Resolved freeze decisions" (`HostScope` fields flattened, plus
/// `coordinatorId`/`objective`).
fn run_create_params(host_id: &str, coordinator_id: &str, objective: &str) -> Value {
    json!({
        "contractVersion": 1,
        "hostId": host_id,
        "coordinatorId": coordinator_id,
        "objective": objective,
    })
}

/// `orchestration.taskCreate` params: a `CoordinatorScope` (host context +
/// `runId`/`coordinatorId`/`consumerGeneration`) plus an immutable
/// `spec: { instructions, dependsOn }`.
fn task_create_params(
    host_id: &str,
    run_id: &str,
    coordinator_id: &str,
    consumer_generation: u64,
    instructions: &str,
    depends_on: &[&str],
) -> Value {
    json!({
        "contractVersion": 1,
        "hostId": host_id,
        "runId": run_id,
        "coordinatorId": coordinator_id,
        "consumerGeneration": consumer_generation,
        "spec": { "instructions": instructions, "dependsOn": depends_on },
    })
}

/// Coordinator-scoped task inspection; run inspection permits host scope.
fn coordinator_scope_params(
    host_id: &str,
    run_id: &str,
    coordinator_id: &str,
    consumer_generation: u64,
) -> Value {
    json!({
        "contractVersion": 1,
        "hostId": host_id,
        "runId": run_id,
        "coordinatorId": coordinator_id,
        "consumerGeneration": consumer_generation,
    })
}

#[test]
fn task_show_retains_attempt_order_retry_links_and_honest_liveness_after_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host = real_host_id(&engine);
    let run = ok(
        &engine,
        "orchestration.runCreate",
        "history-run",
        run_create_params(&host, "owner", "history"),
    )["run"]["runId"]
        .as_str()
        .unwrap()
        .to_owned();
    let task = ok(
        &engine,
        "orchestration.taskCreate",
        "history-task",
        task_create_params(&host, &run, "owner", 1, "preserve attempts", &[]),
    )["task"]["taskId"]
        .as_str()
        .unwrap()
        .to_owned();
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    for (id, state, retry, current) in [
        ("old", "stopped", None, 0),
        ("new", "ready", Some("old"), 1),
    ] {
        let value = json!({
            "result": {"runId": run, "taskId": task, "dispatchId": id,
                "consumerGeneration": 1, "workspaceId": "folder", "assignmentState": state,
                "readiness": "notObserved", "processVerdict": "live", "effects": [], "residualResources": []},
            "launch": {"harnessId": "claude", "permissionMode": "inherit"},
            "outcome": null, "report_message_id": null, "cleanup_owned": true
        });
        conn.execute("INSERT INTO orchestration_attempts(dispatch_id,host_id,run_id,task_id,is_current,fenced,retry_of,state_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            rusqlite::params![id,host,run,task,current,1-current,retry,value.to_string()]).unwrap();
    }
    drop(conn);
    drop(engine);
    let engine = Engine::open(dir.path()).unwrap();
    let mut params = coordinator_scope_params(&host, &run, "owner", 1);
    params["taskId"] = json!(task);
    let result = ok(&engine, "orchestration.taskShow", "history-show", params);
    assert_eq!(result["attempts"].as_array().unwrap().len(), 2);
    assert_eq!(result["attempts"][0]["dispatchId"], "old");
    assert_eq!(result["attempts"][0]["attempt"], 1);
    assert_eq!(result["attempts"][1]["attempt"], 2);
    assert_eq!(result["attempts"][1]["retryOf"], "old");
    assert_eq!(result["attempts"][1]["processVerdict"], "unverifiable");
    assert_eq!(result["activeDispatchId"], "new");
}

// --- The one real, currently-passing test: a positive control proving
// Engine::open/dispatch itself works, so a failure below can never be
// misread as "the engine is broken". ---

/// Mirrors `crates/drogon-core/tests/engine.rs`'s own
/// `workspace_register_is_idempotent_by_path`.
#[test]
fn task_update_persists_results_promotes_dependencies_and_replays_atomically() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host = real_host_id(&engine);
    let run = ok(
        &engine,
        "orchestration.runCreate",
        "update-run",
        run_create_params(&host, "owner", "update tasks"),
    )["run"]["runId"]
        .as_str()
        .unwrap()
        .to_owned();
    let first = ok(
        &engine,
        "orchestration.taskCreate",
        "first-task",
        task_create_params(&host, &run, "owner", 1, "prerequisite", &[]),
    )["task"]["taskId"]
        .as_str()
        .unwrap()
        .to_owned();
    let child = ok(
        &engine,
        "orchestration.taskCreate",
        "child-task",
        task_create_params(&host, &run, "owner", 1, "dependent", &[&first]),
    )["task"]["taskId"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut update = coordinator_scope_params(&host, &run, "owner", 1);
    update["taskId"] = json!(first);
    update["status"] = json!("completed");
    update["result"] = json!("Listo ✓\noutput retained");
    let result = ok(
        &engine,
        "orchestration.taskUpdate",
        "update-one",
        update.clone(),
    );
    assert_eq!(result["task"]["status"], "completed");
    assert_eq!(result["task"]["result"], "Listo ✓\noutput retained");
    assert_eq!(
        ok(
            &engine,
            "orchestration.taskUpdate",
            "update-one",
            update.clone()
        ),
        result
    );
    let mut different = update.clone();
    different["status"] = json!("failed");
    assert_eq!(
        err_code(&engine, "orchestration.taskUpdate", "update-one", different),
        "request_conflict"
    );
    drop(engine);
    let engine = Engine::open(dir.path()).unwrap();
    let mut show = coordinator_scope_params(&host, &run, "owner", 1);
    show["taskId"] = json!(first);
    assert_eq!(
        ok(
            &engine,
            "orchestration.taskShow",
            "updated-show",
            show.clone()
        )["task"]["result"],
        "Listo ✓\noutput retained"
    );
    show["taskId"] = json!(child);
    assert_eq!(
        ok(&engine, "orchestration.taskShow", "child-show", show)["task"]["status"],
        "ready"
    );
    update["status"] = json!("blocked");
    update.as_object_mut().unwrap().remove("result");
    assert_eq!(
        ok(
            &engine,
            "orchestration.taskUpdate",
            "update-two",
            update.clone()
        )["task"]["result"],
        "Listo ✓\noutput retained"
    );
    update["result"] = json!("");
    assert_eq!(
        ok(
            &engine,
            "orchestration.taskUpdate",
            "clear-result",
            update.clone()
        )["task"]["result"],
        ""
    );
    update["status"] = json!("dispatched");
    assert_eq!(
        err_code(
            &engine,
            "orchestration.taskUpdate",
            "no-dispatch",
            update.clone()
        ),
        "task_not_startable"
    );
    update["coordinatorId"] = json!("other-owner");
    assert_eq!(
        err_code(&engine, "orchestration.taskUpdate", "wrong-owner", update),
        "consumer_fenced"
    );
}

#[test]
fn task_update_cannot_settle_or_requeue_an_active_supervised_dispatch() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host = real_host_id(&engine);
    let run = ok(
        &engine,
        "orchestration.runCreate",
        "active-run",
        run_create_params(&host, "owner", "active worker"),
    )["run"]["runId"]
        .as_str()
        .unwrap()
        .to_owned();
    let task = ok(
        &engine,
        "orchestration.taskCreate",
        "active-task",
        task_create_params(&host, &run, "owner", 1, "work", &[]),
    )["task"]["taskId"]
        .as_str()
        .unwrap()
        .to_owned();
    let state = json!({
        "result": {"runId": run, "taskId": task, "dispatchId": "active-dispatch",
            "consumerGeneration": 1, "workspaceId": "folder", "assignmentState": "ready",
            "readiness": "notObserved", "processVerdict": "unverifiable", "effects": [], "residualResources": []},
        "launch": {"harnessId": "claude", "permissionMode": "inherit"},
        "outcome": null, "report_message_id": null, "cleanup_owned": true
    });
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    conn.execute("INSERT INTO orchestration_attempts(dispatch_id,host_id,run_id,task_id,is_current,fenced,state_json) VALUES ('active-dispatch',?1,?2,?3,1,0,?4)",
        rusqlite::params![host,run,task,state.to_string()]).unwrap();
    let mut update = coordinator_scope_params(&host, &run, "owner", 1);
    update["taskId"] = json!(task);
    update["result"] = json!("must not overwrite");
    for status in ["completed", "failed", "ready", "pending", "blocked"] {
        update["status"] = json!(status);
        assert_eq!(
            err_code(
                &engine,
                "orchestration.taskUpdate",
                &format!("deny-{status}"),
                update.clone()
            ),
            "task_not_startable"
        );
    }
    let mut gate = coordinator_scope_params(&host, &run, "owner", 1);
    gate["taskId"] = json!(task);
    gate["question"] = json!("cannot block active worker");
    assert_eq!(
        err_code(&engine, "orchestration.gateCreate", "active-gate", gate),
        "task_not_startable"
    );
    let stored: (String, Option<String>) = conn
        .query_row(
            "SELECT status,result FROM orchestration_tasks WHERE task_id=?1",
            [&task],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(stored, ("ready".to_string(), None));
    update["status"] = json!("dispatched");
    assert_eq!(
        ok(
            &engine,
            "orchestration.taskUpdate",
            "keep-dispatched",
            update
        )["task"]["status"],
        "dispatched"
    );
    let after: String = conn
        .query_row(
            "SELECT state_json FROM orchestration_attempts WHERE dispatch_id='active-dispatch'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(serde_json::from_str::<Value>(&after).unwrap(), state);
}

#[test]
fn task_result_schema_upgrade_preserves_v1_data_and_takes_a_backup() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host = real_host_id(&engine);
    let run = ok(
        &engine,
        "orchestration.runCreate",
        "upgrade-run",
        run_create_params(&host, "owner", "existing run"),
    )["run"]["runId"]
        .as_str()
        .unwrap()
        .to_owned();
    let task = ok(
        &engine,
        "orchestration.taskCreate",
        "upgrade-task",
        task_create_params(&host, &run, "owner", 1, "existing instruction ✓", &[]),
    )["task"]["taskId"]
        .as_str()
        .unwrap()
        .to_owned();
    drop(engine);
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    conn.execute_batch("ALTER TABLE orchestration_tasks DROP COLUMN result; UPDATE orchestration_domain_meta SET version=1;").unwrap();
    drop(conn);
    let engine = Engine::open(dir.path()).unwrap();
    let mut show = coordinator_scope_params(&host, &run, "owner", 1);
    show["taskId"] = json!(task);
    let result = ok(&engine, "orchestration.taskShow", "upgraded-show", show);
    assert_eq!(result["spec"]["instructions"], "existing instruction ✓");
    assert!(result["task"].get("result").is_none());
    let backups: Vec<_> = std::fs::read_dir(dir.path().join("backups"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    assert_eq!(backups.len(), 1);
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(backups[0].join("manifest.json")).unwrap()).unwrap();
    assert!(
        manifest["pending_migrations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["component"] == "orchestration_domain"
                && m["recorded_version"] == 1
                && m["migrating_to"] == drogon_orchestration::schema::SCHEMA_VERSION)
    );
    let backup = rusqlite::Connection::open(backups[0].join(drogon_core::DB_FILE_NAME)).unwrap();
    assert_eq!(
        backup
            .query_row(
                "SELECT MAX(version) FROM orchestration_domain_meta",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
    drop(engine);
    drop(Engine::open(dir.path()).unwrap());
    assert_eq!(
        std::fs::read_dir(dir.path().join("backups"))
            .unwrap()
            .count(),
        1
    );
}

#[test]
fn engine_still_serves_status_and_workspace_control() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();

    let status = ok(&engine, "status", "status-1", json!({}));
    assert_eq!(status["protocol"], PROTOCOL_VERSION);
    assert!(status["hostId"].as_str().is_some_and(|h| !h.is_empty()));

    let ws_a = ok(
        &engine,
        "workspace.register",
        "ws-1",
        json!({ "path": dir.path().to_string_lossy() }),
    );
    let ws_b = ok(
        &engine,
        "workspace.register",
        "ws-2",
        json!({ "path": dir.path().to_string_lossy() }),
    );
    assert_eq!(
        ws_a["id"], ws_b["id"],
        "existing idempotent-by-path behavior must be unaffected by this file's presence"
    );
}

// --- Real, unignored RED: each fails today on the same absent-method
// cause, written to the frozen contract fields for when the method exists. ---

/// Contract: `orchestration.runCreate` returns `result.run.runId` and
/// `consumerGeneration: 1` for a fresh run. Restates the accepted source
/// `orchestration-run-delivery-db.test.ts`'s "binds creation to one pane"
/// case's `consumer_generation: 1` on first creation.
#[test]
fn run_create_returns_run_id_and_consumer_generation_one() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host_id = real_host_id(&engine);

    let created = ok(
        &engine,
        "orchestration.runCreate",
        "run-create-1",
        run_create_params(&host_id, "coordinator-1", "first run"),
    );
    assert!(
        created["run"]["runId"]
            .as_str()
            .is_some_and(|s| !s.is_empty())
    );
    assert_eq!(created["run"]["consumerGeneration"], 1);
}

/// Contract table: "Same request ID, same actor and payload" -> "Replay
/// the saved receipt; no extra message or state change." Restates the
/// existing `RequestLedger` replay semantics (`crates/drogon-core/src/requests.rs`)
/// extended to the new coordination keys.
#[test]
fn run_create_replays_same_run_for_same_request_id_and_payload() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host_id = real_host_id(&engine);
    let params = run_create_params(&host_id, "coordinator-1", "same run twice");

    let first = ok(
        &engine,
        "orchestration.runCreate",
        "run-create-1",
        params.clone(),
    );
    let replay = ok(&engine, "orchestration.runCreate", "run-create-1", params);
    assert_eq!(first["run"]["runId"], replay["run"]["runId"]);
    assert_eq!(replay["run"]["consumerGeneration"], 1);
}

/// Contract table: "Same request ID, different payload" -> `request_conflict`.
/// Restates the existing `error::request_conflict()` behavior
/// (`crates/drogon-core/src/requests.rs`) applied to a coordination method.
#[test]
fn run_create_refuses_conflicting_payload_for_same_request_id() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host_id = real_host_id(&engine);

    let _ = ok(
        &engine,
        "orchestration.runCreate",
        "run-create-1",
        run_create_params(&host_id, "coordinator-1", "objective A"),
    );
    let code = err_code(
        &engine,
        "orchestration.runCreate",
        "run-create-1",
        run_create_params(&host_id, "coordinator-1", "objective B (changed)"),
    );
    assert_eq!(code, "request_conflict");
}

/// Contract: dispatch only when all prerequisites have successful final
/// reports; a task with no `dependsOn` is immediately dispatchable.
/// Restates accepted `db-task-create-readiness.test.ts`'s root-task
/// (zero-dependency, trivially-satisfied) case.
#[test]
fn task_create_root_task_without_dependencies_is_ready() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host_id = real_host_id(&engine);
    let run = ok(
        &engine,
        "orchestration.runCreate",
        "run-1",
        run_create_params(&host_id, "coordinator-1", "objective"),
    );
    let run_id = run["run"]["runId"].as_str().unwrap();

    let task = ok(
        &engine,
        "orchestration.taskCreate",
        "task-1",
        task_create_params(
            &host_id,
            run_id,
            "coordinator-1",
            1,
            "do the root work",
            &[],
        ),
    );
    assert!(
        task["task"]["taskId"]
            .as_str()
            .is_some_and(|s| !s.is_empty())
    );
    assert_eq!(task["task"]["status"], "ready");
}

/// Contract: a task depending on an incomplete same-run task is `pending`
/// until that dependency completes. Restates accepted
/// `db-task-create-readiness.test.ts`'s "promotes only after every
/// dependency completes" case.
#[test]
fn task_create_dependent_task_is_pending_until_dependencies_complete() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host_id = real_host_id(&engine);
    let run = ok(
        &engine,
        "orchestration.runCreate",
        "run-1",
        run_create_params(&host_id, "coordinator-1", "objective"),
    );
    let run_id = run["run"]["runId"].as_str().unwrap();
    let root = ok(
        &engine,
        "orchestration.taskCreate",
        "task-root",
        task_create_params(&host_id, run_id, "coordinator-1", 1, "root", &[]),
    );
    let root_id = root["task"]["taskId"].as_str().unwrap().to_string();

    let dependent = ok(
        &engine,
        "orchestration.taskCreate",
        "task-dependent",
        task_create_params(
            &host_id,
            run_id,
            "coordinator-1",
            1,
            "depends on root",
            &[&root_id],
        ),
    );
    assert_eq!(dependent["task"]["status"], "pending");
}

/// Contract: reject missing dependencies. Restates accepted
/// `db-task-create-readiness.test.ts`'s "rejects missing dependencies
/// without inserting a task" case: the refusal must not allocate a task
/// row (verified by an immediately-following `taskList` showing none).
#[test]
fn task_create_refuses_missing_dependency_without_allocating_task() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host_id = real_host_id(&engine);
    let run = ok(
        &engine,
        "orchestration.runCreate",
        "run-1",
        run_create_params(&host_id, "coordinator-1", "objective"),
    );
    let run_id = run["run"]["runId"].as_str().unwrap().to_string();

    let code = err_code(
        &engine,
        "orchestration.taskCreate",
        "task-missing-dep",
        task_create_params(
            &host_id,
            &run_id,
            "coordinator-1",
            1,
            "depends on nothing real",
            &["task_does_not_exist"],
        ),
    );
    assert_eq!(code, "invalid_argument");

    let listed = ok(
        &engine,
        "orchestration.taskList",
        "task-list-1",
        coordinator_scope_params(&host_id, &run_id, "coordinator-1", 1),
    );
    assert_eq!(
        listed["tasks"].as_array().unwrap().len(),
        0,
        "a refused dependency must not have allocated a task row"
    );
}

/// Contract: reject cross-run dependencies the same way. Restates the same
/// accepted family with the dependency belonging to a different run
/// entirely; must refuse without allocating a task, verified against run
/// A's own `taskList` (not just the error code) so a task silently
/// allocated despite the refusal cannot hide from this assertion.
#[test]
fn task_create_refuses_cross_run_dependency_without_allocating_task() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host_id = real_host_id(&engine);
    let run_a = ok(
        &engine,
        "orchestration.runCreate",
        "run-a",
        run_create_params(&host_id, "coordinator-1", "run A"),
    );
    let run_a_id = run_a["run"]["runId"].as_str().unwrap().to_string();
    let run_b = ok(
        &engine,
        "orchestration.runCreate",
        "run-b",
        run_create_params(&host_id, "coordinator-2", "run B"),
    );
    let run_b_id = run_b["run"]["runId"].as_str().unwrap().to_string();
    let foreign_task = ok(
        &engine,
        "orchestration.taskCreate",
        "task-in-b",
        task_create_params(
            &host_id,
            &run_b_id,
            "coordinator-2",
            1,
            "lives in run B",
            &[],
        ),
    );
    let foreign_task_id = foreign_task["task"]["taskId"].as_str().unwrap().to_string();

    let code = err_code(
        &engine,
        "orchestration.taskCreate",
        "task-cross-run-dep",
        task_create_params(
            &host_id,
            &run_a_id,
            "coordinator-1",
            1,
            "depends on a task in run B",
            &[&foreign_task_id],
        ),
    );
    assert_eq!(code, "invalid_argument");

    let listed_a = ok(
        &engine,
        "orchestration.taskList",
        "task-list-a",
        coordinator_scope_params(&host_id, &run_a_id, "coordinator-1", 1),
    );
    assert_eq!(
        listed_a["tasks"].as_array().unwrap().len(),
        0,
        "the refused cross-run attempt must not allocate a task in run A"
    );
    let listed_b = ok(
        &engine,
        "orchestration.taskList",
        "task-list-b",
        coordinator_scope_params(&host_id, &run_b_id, "coordinator-2", 1),
    );
    let tasks_b = listed_b["tasks"].as_array().unwrap();
    assert_eq!(tasks_b.len(), 1, "run B must retain only its original task");
    assert_eq!(tasks_b[0]["taskId"], foreign_task_id);
}

/// Contract: durability across an Engine reopen, exercising exactly the
/// list/show pair its name promises. Restates accepted
/// `orchestration-run-delivery-db.test.ts`'s "replays an outstanding batch
/// after reopening the database" durability pattern, applied to run/task
/// existence via a real second `Engine::open` on the same data dir.
#[test]
fn run_and_task_list_show_survive_engine_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let (run_id, task_id, host_id) = {
        let engine = Engine::open(dir.path()).unwrap();
        let host_id = real_host_id(&engine);
        let run = ok(
            &engine,
            "orchestration.runCreate",
            "run-1",
            run_create_params(&host_id, "coordinator-1", "durable objective"),
        );
        let run_id = run["run"]["runId"].as_str().unwrap().to_string();
        let task = ok(
            &engine,
            "orchestration.taskCreate",
            "task-1",
            task_create_params(&host_id, &run_id, "coordinator-1", 1, "durable task", &[]),
        );
        (
            run_id,
            task["task"]["taskId"].as_str().unwrap().to_string(),
            host_id,
        )
    };

    let reopened = Engine::open(dir.path()).unwrap();

    let shown_run = ok(
        &reopened,
        "orchestration.runShow",
        "run-show-1",
        coordinator_scope_params(&host_id, &run_id, "coordinator-1", 1),
    );
    assert_eq!(shown_run["run"]["runId"], run_id);

    let listed_runs = ok(
        &reopened,
        "orchestration.runList",
        "run-list-1",
        json!({ "contractVersion": 1, "hostId": host_id, "coordinatorId": "coordinator-1" }),
    );
    assert!(
        listed_runs["runs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["runId"] == run_id),
        "runList after reopen must still include the run created before the reopen"
    );

    let shown_task = ok(
        &reopened,
        "orchestration.taskShow",
        "task-show-1",
        json!({
            "contractVersion": 1, "hostId": host_id, "runId": run_id, "taskId": task_id,
            "coordinatorId": "coordinator-1", "consumerGeneration": 1,
        }),
    );
    assert_eq!(shown_task["task"]["taskId"], task_id);

    let listed_tasks = ok(
        &reopened,
        "orchestration.taskList",
        "task-list-1",
        coordinator_scope_params(&host_id, &run_id, "coordinator-1", 1),
    );
    assert!(
        listed_tasks["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["taskId"] == task_id),
        "taskList after reopen must still include the task created before the reopen"
    );
}

/// Contract: "Admin authentication allows an explicit takeover, not a
/// silent default to the latest run." Takeover is an explicit `takeover:
/// true` plus the caller's own known current `consumerGeneration` (proving
/// it observed the state it is superseding) — never an implicit rebind
/// triggered merely by supplying a new `coordinatorId`. Restates accepted
/// `orchestration-run-delivery-db.test.ts`'s "rebinds a Run by
/// incrementing its consumer generation" and "fences an outstanding batch
/// when the Run consumer changes" cases, whose source asserts exactly
/// `{code: 'consumer_fenced'}` for a stale post-takeover caller — that
/// exact code, not an invented one, is asserted below.
#[test]
fn run_use_takeover_fences_old_coordinator_generation() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host_id = real_host_id(&engine);
    let run = ok(
        &engine,
        "orchestration.runCreate",
        "run-1",
        run_create_params(&host_id, "coordinator-old", "objective"),
    );
    let run_id = run["run"]["runId"].as_str().unwrap().to_string();

    let taken_over = ok(
        &engine,
        "orchestration.runUse",
        "run-use-1",
        json!({
            "contractVersion": 1, "hostId": host_id, "runId": run_id,
            "coordinatorId": "coordinator-new",
            "consumerGeneration": 1,
            "takeover": true,
        }),
    );
    let new_generation = taken_over["run"]["consumerGeneration"].as_u64().unwrap();
    assert!(
        new_generation > 1,
        "an explicit takeover must advance the generation"
    );

    let code = err_code(
        &engine,
        "orchestration.taskCreate",
        "task-with-stale-generation",
        task_create_params(
            &host_id,
            &run_id,
            "coordinator-old",
            1,
            "stale attempt",
            &[],
        ),
    );
    assert_eq!(
        code, "consumer_fenced",
        "the old coordinator's known generation must be fenced after takeover, not silently accepted"
    );
}

#[test]
fn takeover_receipt_replays_only_while_its_resulting_binding_is_current() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host = real_host_id(&engine);
    let run = ok(
        &engine,
        "orchestration.runCreate",
        "create",
        run_create_params(&host, "old", "takeover replay"),
    );
    let run_id = run["run"]["runId"].as_str().unwrap();
    let mut params = coordinator_scope_params(&host, run_id, "new", 1);
    params["takeover"] = json!(true);
    let first = ok(&engine, "orchestration.runUse", "takeover", params.clone());
    assert_eq!(first["run"]["consumerGeneration"], 2);
    assert_eq!(
        ok(&engine, "orchestration.runUse", "takeover", params.clone()),
        first
    );
    assert_eq!(
        err_code(
            &engine,
            "orchestration.runUse",
            "new-request",
            params.clone()
        ),
        "consumer_fenced"
    );

    let mut third = coordinator_scope_params(&host, run_id, "third", 2);
    third["takeover"] = json!(true);
    ok(&engine, "orchestration.runUse", "third-takeover", third);
    assert_eq!(
        err_code(&engine, "orchestration.runUse", "takeover", params),
        "consumer_fenced"
    );
}

#[test]
fn stale_task_receipt_is_fenced_before_replay_or_payload_conflict() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host = real_host_id(&engine);
    let run = ok(
        &engine,
        "orchestration.runCreate",
        "create",
        run_create_params(&host, "old", "fence replay"),
    );
    let run_id = run["run"]["runId"].as_str().unwrap();
    let mut task = task_create_params(&host, run_id, "old", 1, "original", &[]);
    ok(&engine, "orchestration.taskCreate", "task", task.clone());
    let mut takeover = coordinator_scope_params(&host, run_id, "new", 1);
    takeover["takeover"] = json!(true);
    ok(&engine, "orchestration.runUse", "takeover", takeover);
    assert_eq!(
        err_code(&engine, "orchestration.taskCreate", "task", task.clone()),
        "consumer_fenced"
    );
    task["spec"]["instructions"] = json!("changed");
    assert_eq!(
        err_code(&engine, "orchestration.taskCreate", "task", task),
        "consumer_fenced"
    );
    assert_eq!(
        err_code(
            &engine,
            "orchestration.taskList",
            "read",
            coordinator_scope_params(&host, run_id, "old", 1)
        ),
        "consumer_fenced"
    );
}

#[test]
fn atomic_task_receipt_failure_rolls_back_domain_insert_and_can_retry() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host = real_host_id(&engine);
    let run = ok(
        &engine,
        "orchestration.runCreate",
        "create",
        run_create_params(&host, "coordinator", "atomic failure"),
    );
    let run_id = run["run"]["runId"].as_str().unwrap();
    let sql = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    sql.execute_batch("CREATE TRIGGER reject_task_receipt BEFORE INSERT ON requests WHEN NEW.method = 'orchestration.taskCreate' BEGIN SELECT RAISE(ABORT, 'injected failure'); END;").unwrap();
    let params = task_create_params(&host, run_id, "coordinator", 1, "atomic", &[]);
    let response = engine.dispatch(req("orchestration.taskCreate", "task", params.clone()));
    assert!(!response.ok);
    let listed = ok(
        &engine,
        "orchestration.taskList",
        "list",
        coordinator_scope_params(&host, run_id, "coordinator", 1),
    );
    assert_eq!(listed["tasks"], json!([]));
    sql.execute_batch("DROP TRIGGER reject_task_receipt;")
        .unwrap();
    let created = ok(&engine, "orchestration.taskCreate", "task", params.clone());
    assert_eq!(
        ok(&engine, "orchestration.taskCreate", "task", params),
        created
    );
}

#[test]
fn run_receipt_namespace_is_actor_scoped_and_host_refusal_has_no_effects() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host = real_host_id(&engine);
    let a = ok(
        &engine,
        "orchestration.runCreate",
        "same-id",
        run_create_params(&host, "a", "A"),
    );
    let b = ok(
        &engine,
        "orchestration.runCreate",
        "same-id",
        run_create_params(&host, "b", "B"),
    );
    assert_ne!(a["run"]["runId"], b["run"]["runId"]);
    assert_eq!(
        err_code(
            &engine,
            "orchestration.runCreate",
            "same-id",
            run_create_params("another-host", "a", "A")
        ),
        "unsupported_host"
    );
    let listed = ok(
        &engine,
        "orchestration.runList",
        "list",
        json!({"contractVersion":1,"hostId":host}),
    );
    assert_eq!(listed["runs"].as_array().unwrap().len(), 2);
    let sql = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    let receipts: u32 = sql
        .query_row("SELECT count(*) FROM requests", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        receipts, 2,
        "inspection and rejected host must not allocate receipts"
    );
}

#[test]
fn concurrent_run_creation_reuses_one_durable_receipt_after_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let engine = std::sync::Arc::new(Engine::open(dir.path()).unwrap());
    let host = real_host_id(&engine);
    let params = run_create_params(&host, "coordinator", "concurrent");
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(6));
    let threads: Vec<_> = (0..6)
        .map(|_| {
            let engine = engine.clone();
            let barrier = barrier.clone();
            let params = params.clone();
            std::thread::spawn(move || {
                barrier.wait();
                ok(&engine, "orchestration.runCreate", "one-request", params)
            })
        })
        .collect();
    let results: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
    assert!(results.iter().all(|r| r == &results[0]));
    drop(engine);
    let reopened = Engine::open(dir.path()).unwrap();
    assert_eq!(
        ok(&reopened, "orchestration.runCreate", "one-request", params),
        results[0]
    );
    let listed = ok(
        &reopened,
        "orchestration.runList",
        "list",
        json!({"contractVersion":1,"hostId":host}),
    );
    assert_eq!(listed["runs"].as_array().unwrap().len(), 1);
}
