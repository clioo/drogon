//! Pre-implementation RED tests for `orchestration.run*`/`task*` against a
//! real `Engine::open`/`dispatch` and an isolated per-test temp data dir —
//! no mock domain, no fake store. Run/task contract decisions:
//! `docs/migration/native-coordination-contract.md`; per-test rationale and
//! the compiled `cargo test` transcript: `docs/migration/native-coordination-engine-red.md`.
//!
//! None of `orchestration.run{Create,List,Show,Use}` or
//! `orchestration.task{Create,List,Show}` is wired into
//! `Engine::dispatch_inner` yet (see `crates/drogon-core/src/lib.rs`'s
//! method match); every behavioral test below therefore fails today, for
//! the single shared reason that the method does not exist yet — not as
//! nine independently-proven bugs. Each test's first `ok(...)` call panics
//! on the resulting `method_not_found` response, so whatever it asserts
//! about replay, dependency gating, or takeover past that point is written
//! for when the method exists, not exercised today. That is deliberate:
//! these are real, unignored RED tests, not a passing characterization of
//! absence.
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

// --- The one real, currently-passing test: a positive control proving
// Engine::open/dispatch itself works, so a failure below can never be
// misread as "the engine is broken". ---

/// Mirrors `crates/drogon-core/tests/engine.rs`'s own
/// `workspace_register_is_idempotent_by_path`.
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
