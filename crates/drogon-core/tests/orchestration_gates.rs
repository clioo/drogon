//! Decision gate behavior from the source decision-gate-store, exercised on Engine.
use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

fn call(engine: &Engine, method: &str, id: &str, params: Value) -> drogon_protocol::Response {
    engine.dispatch(
        serde_json::from_value::<Request>(json!({
            "protocol": PROTOCOL_VERSION, "requestId": id, "method": method, "params": params,
        }))
        .unwrap(),
    )
}
fn ok(engine: &Engine, method: &str, id: &str, params: Value) -> Value {
    let response = call(engine, method, id, params);
    assert!(response.ok, "{method}: {:?}", response.error);
    response.result.unwrap()
}
fn scope(engine: &Engine, owner: &str) -> Value {
    let host = ok(engine, "status", "status", json!({}))["hostId"].clone();
    let run = ok(engine, "orchestration.runCreate", owner, json!({
        "contractVersion": 1, "hostId": host, "coordinatorId": owner, "objective": "gate journey",
    }))["run"].clone();
    json!({"contractVersion": 1, "hostId": host, "coordinatorId": owner,
        "consumerGeneration": run["consumerGeneration"], "runId": run["runId"]})
}
fn task(engine: &Engine, scope: &Value, id: &str) -> String {
    let mut params = scope.clone();
    params["spec"] = json!({"instructions": "wait for approval"});
    ok(engine, "orchestration.taskCreate", id, params)["task"]["taskId"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[test]
fn gates_block_tasks_resolve_durably_and_preserve_receipt_identity() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let scope = scope(&engine, "owner");
    let task = task(&engine, &scope, "task");
    let mut create = scope.clone();
    create["taskId"] = json!(task);
    create["question"] = json!("Deploy? ✓");
    create["options"] = json!(["yes", "no"]);
    let first = ok(
        &engine,
        "orchestration.gateCreate",
        "create-gate",
        create.clone(),
    );
    assert_eq!(first["gate"]["status"], "pending");
    assert_eq!(first["gate"]["task_id"], task);
    assert_eq!(first["gate"]["options"], "[\"yes\",\"no\"]");
    assert_eq!(
        ok(&engine, "orchestration.gateCreate", "create-gate", create),
        first
    );
    let mut show = scope.clone();
    show["taskId"] = json!(task);
    assert_eq!(
        ok(
            &engine,
            "orchestration.taskShow",
            "show-blocked",
            show.clone()
        )["task"]["status"],
        "blocked"
    );
    let mut list = scope.clone();
    list["status"] = json!("pending");
    assert_eq!(
        ok(
            &engine,
            "orchestration.gateList",
            "list-pending",
            list.clone()
        )["count"],
        1
    );
    let mut resolve = scope.clone();
    resolve["gateId"] = first["gate"]["id"].clone();
    resolve["resolution"] = json!("approved outside the suggested choices");
    let settled = ok(
        &engine,
        "orchestration.gateResolve",
        "resolve",
        resolve.clone(),
    );
    assert_eq!(settled["gate"]["status"], "resolved");
    assert_eq!(
        settled["gate"]["resolution"],
        "approved outside the suggested choices"
    );
    assert!(settled["gate"]["resolved_at"].is_string());
    assert_eq!(
        ok(&engine, "orchestration.gateResolve", "resolve", resolve),
        settled
    );
    assert_eq!(
        ok(&engine, "orchestration.taskShow", "show-ready", show)["task"]["status"],
        "ready"
    );
    assert_eq!(
        ok(&engine, "orchestration.gateList", "pending-after", list)["count"],
        0
    );
    drop(engine);
    let engine = Engine::open(dir.path()).unwrap();
    let listed = ok(&engine, "orchestration.gateList", "after-restart", scope);
    assert_eq!(listed["count"], 1);
    assert_eq!(listed["gates"][0], settled["gate"]);
}

#[test]
fn resolving_a_gate_with_an_active_worker_rolls_back_every_gate_field() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let scope = scope(&engine, "owner");
    let task = task(&engine, &scope, "task");
    let mut create = scope.clone();
    create["taskId"] = json!(task);
    create["question"] = json!("Review?");
    let before = ok(&engine, "orchestration.gateCreate", "gate", create)["gate"].clone();
    let state = json!({
        "result": {"runId": scope["runId"], "taskId": task, "dispatchId": "worker",
            "consumerGeneration": 1, "workspaceId": "folder", "assignmentState": "ready",
            "readiness": "notObserved", "processVerdict": "unverifiable", "effects": [], "residualResources": []},
        "launch": {"harnessId": "claude", "permissionMode": "inherit"},
        "outcome": null, "report_message_id": null, "cleanup_owned": true
    });
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    conn.execute("INSERT INTO orchestration_attempts(dispatch_id,host_id,run_id,task_id,is_current,fenced,state_json) VALUES ('worker',?1,?2,?3,1,0,?4)",
        rusqlite::params![scope["hostId"].as_str().unwrap(),scope["runId"].as_str().unwrap(),task,state.to_string()]).unwrap();
    let mut resolve = scope.clone();
    resolve["gateId"] = before["id"].clone();
    resolve["resolution"] = json!("must not commit");
    assert_eq!(
        call(&engine, "orchestration.gateResolve", "denied", resolve)
            .error
            .unwrap()
            .code,
        "task_not_startable"
    );
    assert_eq!(
        ok(&engine, "orchestration.gateList", "unchanged", scope)["gates"][0],
        before
    );
}

#[test]
fn gates_upgrade_v2_storage_without_losing_task_results() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let scope = scope(&engine, "owner");
    let task = task(&engine, &scope, "task");
    let mut update = scope.clone();
    update["taskId"] = json!(task);
    update["status"] = json!("completed");
    update["result"] = json!("v2 evidence");
    ok(&engine, "orchestration.taskUpdate", "result", update);
    drop(engine);
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    conn.execute_batch(
        "DROP TABLE orchestration_gates; UPDATE orchestration_domain_meta SET version=2;",
    )
    .unwrap();
    drop(conn);
    let engine = Engine::open(dir.path()).unwrap();
    assert_eq!(
        ok(&engine, "orchestration.gateList", "empty", scope.clone())["count"],
        0
    );
    let mut show = scope;
    show["taskId"] = json!(task);
    assert_eq!(
        ok(&engine, "orchestration.taskShow", "preserved", show)["task"]["result"],
        "v2 evidence"
    );
    assert_eq!(
        std::fs::read_dir(dir.path().join("backups"))
            .unwrap()
            .count(),
        1
    );
}

#[test]
fn ignored_writes_cannot_report_success_or_partially_change_task_readiness() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let scope = scope(&engine, "owner");
    let task = task(&engine, &scope, "task");
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    conn.execute_batch("CREATE TRIGGER ignore_task_result BEFORE UPDATE OF result ON orchestration_tasks BEGIN SELECT RAISE(IGNORE); END;").unwrap();
    let mut update = scope.clone();
    update["taskId"] = json!(task);
    update["status"] = json!("completed");
    update["result"] = json!("must be durable");
    let failed = call(&engine, "orchestration.taskUpdate", "ignore-result", update);
    assert!(!failed.ok, "ignored result write cannot be success");
    let mut show = scope.clone();
    show["taskId"] = json!(task);
    assert_eq!(
        ok(
            &engine,
            "orchestration.taskShow",
            "unchanged-task",
            show.clone()
        )["task"]["status"],
        "ready"
    );
    conn.execute_batch("DROP TRIGGER ignore_task_result;")
        .unwrap();
    let mut create = scope.clone();
    create["taskId"] = json!(task);
    create["question"] = json!("Review?");
    let before = ok(&engine, "orchestration.gateCreate", "gate", create)["gate"].clone();
    conn.execute_batch("CREATE TRIGGER ignore_gate BEFORE UPDATE ON orchestration_gates BEGIN SELECT RAISE(IGNORE); END;").unwrap();
    let mut resolve = scope.clone();
    resolve["gateId"] = before["id"].clone();
    resolve["resolution"] = json!("must be durable");
    assert!(!call(&engine, "orchestration.gateResolve", "ignore-gate", resolve).ok);
    assert_eq!(
        ok(&engine, "orchestration.gateList", "unchanged-gate", scope)["gates"][0],
        before
    );
    assert_eq!(
        ok(&engine, "orchestration.taskShow", "still-blocked", show)["task"]["status"],
        "blocked"
    );
}

#[test]
fn gate_mutations_are_run_scoped_and_fenced_before_receipt_replay() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let owner = scope(&engine, "owner");
    let other = scope(&engine, "other");
    let task = task(&engine, &owner, "task");
    let mut create = other.clone();
    create["taskId"] = json!(task);
    create["question"] = json!("wrong run");
    assert_eq!(
        call(
            &engine,
            "orchestration.gateCreate",
            "foreign-create",
            create.clone()
        )
        .error
        .unwrap()
        .code,
        "task_not_found"
    );
    create["runId"] = owner["runId"].clone();
    create["coordinatorId"] = owner["coordinatorId"].clone();
    let gate = ok(
        &engine,
        "orchestration.gateCreate",
        "create",
        create.clone(),
    )["gate"]["id"]
        .clone();
    let mut resolve = other.clone();
    resolve["gateId"] = gate;
    resolve["resolution"] = json!("wrong run");
    assert_eq!(
        call(
            &engine,
            "orchestration.gateResolve",
            "foreign-resolve",
            resolve
        )
        .error
        .unwrap()
        .code,
        "gate_not_found"
    );
    assert_eq!(
        ok(&engine, "orchestration.gateList", "foreign-list", other)["count"],
        0
    );
    let mut takeover = owner.clone();
    takeover["coordinatorId"] = json!("new-owner");
    takeover["takeover"] = json!(true);
    ok(&engine, "orchestration.runUse", "takeover", takeover);
    assert_eq!(
        call(&engine, "orchestration.gateCreate", "create", create)
            .error
            .unwrap()
            .code,
        "consumer_fenced"
    );
}
