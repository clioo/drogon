//! Real Engine regressions for native `SendTarget::Group` fanout
//! (`coordination_mail_groups.rs`, wired into `commit_send`'s Group arm in
//! `coordination_mail_rpc.rs`). Group semantics are pinned to the read-only
//! migration reference at revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`
//! (`src/main/runtime/orchestration/groups.ts`), adapted to the native
//! current-unfenced-attempt membership model; see
//! `docs/migration/native-mail-groups.md` for the exact mapping and its
//! documented gaps (`@idle` has no native signal and is refused).
#![cfg(unix)]

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

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

fn ok(engine: &Engine, method: &str, request_id: &str, params: Value) -> Value {
    let response = engine.dispatch(req(method, request_id, None, params));
    assert!(
        response.ok,
        "expected ok for {method}: {:?}",
        response.error
    );
    response.result.unwrap()
}

fn err(
    engine: &Engine,
    method: &str,
    request_id: &str,
    params: Value,
) -> drogon_protocol::RpcError {
    let response = engine.dispatch(req(method, request_id, None, params));
    assert!(
        !response.ok,
        "expected an error for {method}, got {:?}",
        response.result
    );
    response.error.unwrap()
}

fn worker_call(
    engine: &Engine,
    method: &str,
    request_id: &str,
    secret: &str,
    params: Value,
) -> drogon_protocol::Response {
    engine.dispatch_authenticated(
        req(method, request_id, Some(secret), params),
        "unused-admin-token",
    )
}

struct Fixture {
    host: String,
    run: String,
    task_seq: std::cell::Cell<u32>,
}

fn setup(engine: &Engine) -> Fixture {
    let host = ok(engine, "status", "status-1", json!({}))["hostId"]
        .as_str()
        .unwrap()
        .to_string();
    let run = ok(
        engine,
        "orchestration.runCreate",
        "run-create",
        json!({"contractVersion":1,"hostId":host,"coordinatorId":"owner","objective":"mail groups"}),
    )["run"]["runId"]
        .as_str()
        .unwrap()
        .to_string();
    Fixture {
        host,
        run,
        task_seq: std::cell::Cell::new(0),
    }
}

fn new_task(engine: &Engine, fx: &Fixture) -> String {
    let seq = fx.task_seq.get();
    fx.task_seq.set(seq + 1);
    ok(
        engine,
        "orchestration.taskCreate",
        &format!("task-create-{seq}"),
        json!({"contractVersion":1,"hostId":fx.host,"runId":fx.run,"coordinatorId":"owner",
            "consumerGeneration":1,"spec":{"instructions":"do work"}}),
    )["task"]["taskId"]
        .as_str()
        .unwrap()
        .to_string()
}

/// Seeds one current, unfenced attempt plus its worker credential directly
/// (the real Engine has no test-only mint path), so it counts as a group
/// member with the given harness/workspace.
#[allow(clippy::too_many_arguments)]
fn seed_worker(
    dir: &std::path::Path,
    host: &str,
    run: &str,
    task_id: &str,
    dispatch_id: &str,
    secret: &str,
    harness_id: &str,
    workspace_id: &str,
) {
    let digest = format!("{:x}", Sha256::digest(secret.as_bytes()));
    let conn = rusqlite::Connection::open(dir.join(drogon_core::DB_FILE_NAME)).unwrap();
    conn.execute(
        "INSERT INTO orchestration_dispatch_credentials
            (digest, host_id, run_id, task_id, dispatch_id, session_id, incarnation, revoked, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'session-1', 'incarnation-1', 0, 't')",
        rusqlite::params![digest, host, run, task_id, dispatch_id],
    )
    .unwrap();
    let state = json!({
        "result": {"runId": run, "taskId": task_id, "dispatchId": dispatch_id,
            "consumerGeneration":1, "workspaceId": workspace_id, "assignmentState":"ready",
            "readiness":"notObserved", "processVerdict":"unverifiable", "effects":[], "residualResources":[]},
        "launch": {"harnessId": harness_id, "permissionMode":"inherit"},
        "outcome": null, "report_message_id": null, "cleanup_owned": false,
    });
    conn.execute(
        "INSERT INTO orchestration_attempts(dispatch_id,host_id,run_id,task_id,is_current,fenced,state_json)
         VALUES (?1,?2,?3,?4,1,0,?5)",
        rusqlite::params![dispatch_id, host, run, task_id, state.to_string()],
    )
    .unwrap();
    conn.execute(
        "UPDATE orchestration_tasks SET status='dispatched' WHERE task_id=?1",
        [task_id],
    )
    .unwrap();
}

fn coordinator_scope(fx: &Fixture) -> Value {
    json!({"actorKind":"coordinator","contractVersion":1,"hostId":fx.host,"runId":fx.run,
        "coordinatorId":"owner","consumerGeneration":1})
}

fn dispatch_scope(fx: &Fixture, task_id: &str, dispatch_id: &str) -> Value {
    json!({"actorKind":"dispatch","contractVersion":1,"hostId":fx.host,"runId":fx.run,
        "taskId":task_id,"dispatchId":dispatch_id})
}

fn unread_subjects(
    engine: &Engine,
    fx: &Fixture,
    task_id: &str,
    dispatch_id: &str,
    secret: &str,
) -> Vec<String> {
    let response = worker_call(
        engine,
        "orchestration.check",
        &format!("check-{dispatch_id}"),
        secret,
        json!({"scope": dispatch_scope(fx, task_id, dispatch_id), "mode":"unread"}),
    );
    assert!(response.ok, "{:?}", response.error);
    let result = response.result.unwrap();
    result["messages"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|m| m["subject"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn group_all_fans_out_to_every_current_worker_and_excludes_the_sending_coordinator() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let task_a = new_task(&engine, &fx);
    let task_b = new_task(&engine, &fx);
    seed_worker(
        dir.path(),
        &fx.host,
        &fx.run,
        &task_a,
        "worker-a",
        "a".repeat(64).as_str(),
        "codex",
        "ws-1",
    );
    seed_worker(
        dir.path(),
        &fx.host,
        &fx.run,
        &task_b,
        "worker-b",
        "b".repeat(64).as_str(),
        "claude",
        "ws-2",
    );

    let sent = ok(
        &engine,
        "orchestration.send",
        "send-all",
        json!({"scope": coordinator_scope(&fx), "kind":"status",
            "to": {"kind":"group","name":"all"}, "subject":"broadcast"}),
    );
    assert_eq!(sent["batch"]["recipients"], 2);

    assert_eq!(
        unread_subjects(&engine, &fx, &task_a, "worker-a", &"a".repeat(64)),
        vec!["broadcast".to_string()]
    );
    assert_eq!(
        unread_subjects(&engine, &fx, &task_b, "worker-b", &"b".repeat(64)),
        vec!["broadcast".to_string()]
    );
}

#[test]
fn group_harness_name_selects_only_matching_workers() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let task_a = new_task(&engine, &fx);
    let task_b = new_task(&engine, &fx);
    let task_c = new_task(&engine, &fx);
    seed_worker(
        dir.path(),
        &fx.host,
        &fx.run,
        &task_a,
        "codex-1",
        "a".repeat(64).as_str(),
        "codex",
        "ws-1",
    );
    seed_worker(
        dir.path(),
        &fx.host,
        &fx.run,
        &task_b,
        "claude-1",
        "b".repeat(64).as_str(),
        "claude",
        "ws-1",
    );
    seed_worker(
        dir.path(),
        &fx.host,
        &fx.run,
        &task_c,
        "codex-2",
        "c".repeat(64).as_str(),
        "codex",
        "ws-2",
    );

    let sent = ok(
        &engine,
        "orchestration.send",
        "send-codex",
        json!({"scope": coordinator_scope(&fx), "kind":"status",
            "to": {"kind":"group","name":"codex"}, "subject":"codex only"}),
    );
    assert_eq!(sent["batch"]["recipients"], 2);
    assert!(
        unread_subjects(&engine, &fx, &task_b, "claude-1", &"b".repeat(64)).is_empty(),
        "claude-1 must not receive a codex-only broadcast"
    );
    assert_eq!(
        unread_subjects(&engine, &fx, &task_a, "codex-1", &"a".repeat(64)),
        vec!["codex only".to_string()]
    );
}

#[test]
fn group_worktree_selects_only_matching_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let task_a = new_task(&engine, &fx);
    let task_b = new_task(&engine, &fx);
    seed_worker(
        dir.path(),
        &fx.host,
        &fx.run,
        &task_a,
        "in-ws",
        "a".repeat(64).as_str(),
        "codex",
        "ws-target",
    );
    seed_worker(
        dir.path(),
        &fx.host,
        &fx.run,
        &task_b,
        "other-ws",
        "b".repeat(64).as_str(),
        "codex",
        "ws-other",
    );

    let sent = ok(
        &engine,
        "orchestration.send",
        "send-worktree",
        json!({"scope": coordinator_scope(&fx), "kind":"status",
            "to": {"kind":"group","name":"worktree:ws-target"}, "subject":"here only"}),
    );
    assert_eq!(sent["batch"]["recipients"], 1);
    assert_eq!(
        unread_subjects(&engine, &fx, &task_a, "in-ws", &"a".repeat(64)),
        vec!["here only".to_string()]
    );
    assert!(unread_subjects(&engine, &fx, &task_b, "other-ws", &"b".repeat(64)).is_empty());
}

#[test]
fn group_idle_is_refused_as_unsupported_feature_never_inferred() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let task_a = new_task(&engine, &fx);
    seed_worker(
        dir.path(),
        &fx.host,
        &fx.run,
        &task_a,
        "worker-a",
        "a".repeat(64).as_str(),
        "codex",
        "ws-1",
    );

    let error = err(
        &engine,
        "orchestration.send",
        "send-idle",
        json!({"scope": coordinator_scope(&fx), "kind":"status",
            "to": {"kind":"group","name":"idle"}, "subject":"anyone free?"}),
    );
    assert_eq!(error.code, "unsupported_feature");
    assert!(unread_subjects(&engine, &fx, &task_a, "worker-a", &"a".repeat(64)).is_empty());
}

#[test]
fn group_send_from_a_dispatch_excludes_only_itself() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let task_a = new_task(&engine, &fx);
    let task_b = new_task(&engine, &fx);
    let secret_a = "a".repeat(64);
    let secret_b = "b".repeat(64);
    seed_worker(
        dir.path(),
        &fx.host,
        &fx.run,
        &task_a,
        "sender-worker",
        &secret_a,
        "codex",
        "ws-1",
    );
    seed_worker(
        dir.path(),
        &fx.host,
        &fx.run,
        &task_b,
        "peer-worker",
        &secret_b,
        "codex",
        "ws-1",
    );

    let response = worker_call(
        &engine,
        "orchestration.send",
        "peer-broadcast",
        &secret_a,
        json!({"scope": dispatch_scope(&fx, &task_a, "sender-worker"), "kind":"status",
            "to": {"kind":"group","name":"all"}, "subject":"heads up"}),
    );
    assert!(response.ok, "{:?}", response.error);
    assert_eq!(response.result.unwrap()["batch"]["recipients"], 1);
    assert_eq!(
        unread_subjects(&engine, &fx, &task_b, "peer-worker", &secret_b),
        vec!["heads up".to_string()]
    );
    assert!(
        unread_subjects(&engine, &fx, &task_a, "sender-worker", &secret_a).is_empty(),
        "the sending dispatch must not receive its own group broadcast"
    );
}

#[test]
fn group_membership_is_isolated_to_its_own_host_and_run() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx_a = setup(&engine);
    let host = fx_a.host.clone();
    let run_b = ok(
        &engine,
        "orchestration.runCreate",
        "run-create-b",
        json!({"contractVersion":1,"hostId":host,"coordinatorId":"owner","objective":"other run"}),
    )["run"]["runId"]
        .as_str()
        .unwrap()
        .to_string();
    let fx_b = Fixture {
        host,
        run: run_b,
        task_seq: std::cell::Cell::new(0),
    };
    let task_a = new_task(&engine, &fx_a);
    let task_b = new_task(&engine, &fx_b);
    seed_worker(
        dir.path(),
        &fx_a.host,
        &fx_a.run,
        &task_a,
        "run-a-worker",
        "a".repeat(64).as_str(),
        "codex",
        "ws-1",
    );
    seed_worker(
        dir.path(),
        &fx_b.host,
        &fx_b.run,
        &task_b,
        "run-b-worker",
        "b".repeat(64).as_str(),
        "codex",
        "ws-1",
    );

    let sent = ok(
        &engine,
        "orchestration.send",
        "send-run-a-all",
        json!({"scope": coordinator_scope(&fx_a), "kind":"status",
            "to": {"kind":"group","name":"all"}, "subject":"run a only"}),
    );
    assert_eq!(sent["batch"]["recipients"], 1);
    assert!(
        unread_subjects(&engine, &fx_b, &task_b, "run-b-worker", &"b".repeat(64)).is_empty(),
        "a different run's worker must never receive another run's group broadcast"
    );
}

#[test]
fn group_send_same_request_id_replay_is_idempotent_and_never_double_delivers() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let task_a = new_task(&engine, &fx);
    seed_worker(
        dir.path(),
        &fx.host,
        &fx.run,
        &task_a,
        "worker-a",
        "a".repeat(64).as_str(),
        "codex",
        "ws-1",
    );

    let params = json!({"scope": coordinator_scope(&fx), "kind":"status",
        "to": {"kind":"group","name":"all"}, "subject":"once only"});
    let first = ok(&engine, "orchestration.send", "replay-1", params.clone());
    let second = ok(&engine, "orchestration.send", "replay-1", params);
    assert_eq!(first, second);
    assert_eq!(
        unread_subjects(&engine, &fx, &task_a, "worker-a", &"a".repeat(64)),
        vec!["once only".to_string()],
        "a same-request-id replay must not append a second message"
    );
}

#[test]
fn group_send_with_no_current_match_is_not_found() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let task_a = new_task(&engine, &fx);
    seed_worker(
        dir.path(),
        &fx.host,
        &fx.run,
        &task_a,
        "worker-a",
        "a".repeat(64).as_str(),
        "codex",
        "ws-1",
    );

    let error = err(
        &engine,
        "orchestration.send",
        "send-no-match",
        json!({"scope": coordinator_scope(&fx), "kind":"status",
            "to": {"kind":"group","name":"gemini"}, "subject":"nobody home"}),
    );
    assert_eq!(error.code, "not_found");
}

#[test]
fn group_send_unknown_selector_is_unsupported_feature() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let task_a = new_task(&engine, &fx);
    seed_worker(
        dir.path(),
        &fx.host,
        &fx.run,
        &task_a,
        "worker-a",
        "a".repeat(64).as_str(),
        "codex",
        "ws-1",
    );

    let error = err(
        &engine,
        "orchestration.send",
        "send-unknown",
        json!({"scope": coordinator_scope(&fx), "kind":"status",
            "to": {"kind":"group","name":"kimi"}, "subject":"no such group"}),
    );
    assert_eq!(error.code, "unsupported_feature");
}

#[test]
fn reported_members_are_excluded_and_corrupt_identity_refuses_whole_fanout() {
    for scenario in ["reported", "identity", "oversized", "insert-failure"] {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::open(dir.path()).unwrap();
        let fx = setup(&engine);
        let first = new_task(&engine, &fx);
        let second = new_task(&engine, &fx);
        seed_worker(
            dir.path(),
            &fx.host,
            &fx.run,
            &first,
            "a",
            &"a".repeat(64),
            "claude",
            "folder",
        );
        seed_worker(
            dir.path(),
            &fx.host,
            &fx.run,
            &second,
            "b",
            &"b".repeat(64),
            "claude",
            "folder",
        );
        let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
        if scenario == "reported" {
            let report = worker_call(
                &engine,
                "orchestration.send",
                "report-before-group",
                &"b".repeat(64),
                json!({"scope":dispatch_scope(&fx,&second,"b"),"kind":"finalReport","subject":"done","finalReport":{"outcome":"succeeded"}}),
            );
            assert!(report.ok, "{:?}", report.error);
        } else if scenario == "insert-failure" {
            conn.execute_batch("CREATE TRIGGER reject_second_group_message BEFORE INSERT ON orchestration_mail_messages WHEN NEW.to_dispatch_id='b' BEGIN SELECT RAISE(ABORT,'synthetic second recipient failure'); END;").unwrap();
        } else {
            let state: String = conn
                .query_row(
                    "SELECT state_json FROM orchestration_attempts WHERE dispatch_id='b'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            let mut state: Value = serde_json::from_str(&state).unwrap();
            if scenario == "identity" {
                state["result"]["taskId"] = json!("wrong-task");
            } else {
                state["padding"] = json!("x".repeat(70 * 1024));
            }
            conn.execute(
                "UPDATE orchestration_attempts SET state_json=?1 WHERE dispatch_id='b'",
                [state.to_string()],
            )
            .unwrap();
        }
        let sent = engine.dispatch(req("orchestration.send","guarded-group",None,
            json!({"scope":coordinator_scope(&fx),"kind":"guidance","subject":"group","to":{"kind":"group","name":"all"}})));
        if scenario == "reported" {
            assert!(sent.ok, "{:?}", sent.error);
            assert_eq!(sent.result.unwrap()["batch"]["recipients"], 1);
        } else {
            assert!(!sent.ok, "accepted {scenario}");
        }
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM orchestration_mail_messages WHERE subject='group'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            count,
            if scenario == "reported" { 1 } else { 0 },
            "{scenario}"
        );
    }
}
