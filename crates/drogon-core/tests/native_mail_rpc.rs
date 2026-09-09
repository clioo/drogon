//! Real Engine mail RPC regressions: send/check for admin and worker actors.
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
    task: String,
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
        json!({"contractVersion":1,"hostId":host,"coordinatorId":"owner","objective":"mail rpc"}),
    )["run"]["runId"]
        .as_str()
        .unwrap()
        .to_string();
    let task = ok(
        engine,
        "orchestration.taskCreate",
        "task-create",
        json!({"contractVersion":1,"hostId":host,"runId":run,"coordinatorId":"owner",
            "consumerGeneration":1,"spec":{"instructions":"do work"}}),
    )["task"]["taskId"]
        .as_str()
        .unwrap()
        .to_string();
    Fixture { host, run, task }
}

/// Seeds a worker credential directly (real Engine has no test-only mint
/// path); binds it to a real run/task via a fixed dispatch id.
fn seed_credential(dir: &std::path::Path, fx: &Fixture, dispatch_id: &str, secret: &str) {
    let digest = format!("{:x}", Sha256::digest(secret.as_bytes()));
    let conn = rusqlite::Connection::open(dir.join(drogon_core::DB_FILE_NAME)).unwrap();
    conn.execute(
        "INSERT INTO orchestration_dispatch_credentials
            (digest, host_id, run_id, task_id, dispatch_id, session_id, incarnation, revoked, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'session-1', 'incarnation-1', 0, 't')",
        rusqlite::params![digest, fx.host, fx.run, fx.task, dispatch_id],
    )
    .unwrap();
}

fn seed_worker(
    engine: &Engine,
    dir: &std::path::Path,
    fx: &Fixture,
    dispatch_id: &str,
    secret: &str,
) {
    seed_credential(dir, fx, dispatch_id, secret);
    let conn = rusqlite::Connection::open(dir.join(drogon_core::DB_FILE_NAME)).unwrap();
    // A current attempt row lets `attempts::settle`/`set_status_in_tx` resolve the task.
    let state = json!({
        "result": {"runId": fx.run, "taskId": fx.task, "dispatchId": dispatch_id,
            "consumerGeneration":1, "workspaceId":"fixture-folder", "assignmentState":"ready",
            "readiness":"notObserved", "processVerdict":"unverifiable", "effects":[], "residualResources":[]},
        "launch": {"harnessId":"claude","permissionMode":"inherit"},
        "outcome": null, "report_message_id": null, "cleanup_owned": false,
    });
    conn.execute(
        "INSERT INTO orchestration_attempts(dispatch_id,host_id,run_id,task_id,is_current,fenced,state_json)
         VALUES (?1,?2,?3,?4,1,0,?5)",
        rusqlite::params![dispatch_id, fx.host, fx.run, fx.task, state.to_string()],
    )
    .unwrap();
    conn.execute(
        "UPDATE orchestration_tasks SET status='dispatched' WHERE task_id=?1",
        [&fx.task],
    )
    .unwrap();
    let _ = engine;
}

fn coordinator_scope(fx: &Fixture) -> Value {
    coordinator_scope_gen(fx, 1)
}

fn coordinator_scope_gen(fx: &Fixture, generation: u64) -> Value {
    json!({"actorKind":"coordinator","contractVersion":1,"hostId":fx.host,"runId":fx.run,
        "coordinatorId":"owner","consumerGeneration":generation})
}

fn dispatch_scope(fx: &Fixture, dispatch_id: &str) -> Value {
    json!({"actorKind":"dispatch","contractVersion":1,"hostId":fx.host,"runId":fx.run,
        "taskId":fx.task,"dispatchId":dispatch_id})
}

#[test]
fn admin_send_and_worker_check_round_trip_with_ack() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let secret = "a".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);

    let sent = ok(
        &engine,
        "orchestration.send",
        "send-1",
        json!({"scope": coordinator_scope(&fx), "kind":"guidance",
            "to": {"kind":"dispatch","dispatchId":"dispatch-1"}, "subject":"go"}),
    );
    assert!(sent["message"]["messageId"].is_string());

    let response = worker_call(
        &engine,
        "orchestration.check",
        "check-1",
        &secret,
        json!({"scope": dispatch_scope(&fx, "dispatch-1"), "mode":"unread"}),
    );
    assert!(response.ok, "{:?}", response.error);
    let result = response.result.unwrap();
    let delivery_id = result["delivery"]["deliveryId"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(result["messages"][0]["subject"], "go");

    let acked = worker_call(
        &engine,
        "orchestration.check",
        "check-2",
        &secret,
        json!({"scope": dispatch_scope(&fx, "dispatch-1"), "mode":"unread", "acknowledge": delivery_id}),
    );
    assert!(acked.ok, "{:?}", acked.error);
    assert_eq!(
        acked.result.unwrap()["acknowledged"]["alreadyAcknowledged"],
        false
    );
}

#[test]
fn worker_final_report_settles_attempt_revokes_credential_and_closes_questions() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let secret = "b".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);

    // A pending question addressed to this dispatch must close on settlement.
    ok(
        &engine,
        "orchestration.send",
        "ask-precursor",
        json!({"scope": coordinator_scope(&fx), "kind":"question",
            "to": {"kind":"dispatch","dispatchId":"dispatch-1"}, "subject":"still there?"}),
    );

    let response = worker_call(
        &engine,
        "orchestration.send",
        "report-1",
        &secret,
        json!({"scope": dispatch_scope(&fx, "dispatch-1"), "kind":"finalReport",
            "subject":"done", "finalReport": {"outcome":"succeeded"}}),
    );
    assert!(response.ok, "{:?}", response.error);
    let result = response.result.unwrap();
    assert_eq!(result["lifecycle"]["action"], "settled");
    assert_eq!(result["lifecycle"]["outcome"], "succeeded");
    assert_eq!(result["lifecycle"]["duplicate"], false);

    let show = ok(
        &engine,
        "orchestration.workerShow",
        "show-1",
        json!(dispatch_scope_admin(&fx, "dispatch-1")),
    );
    assert_eq!(show["assignmentState"], "completed");

    let task = ok(
        &engine,
        "orchestration.taskShow",
        "task-show-1",
        coordinator_scope_task(&fx),
    );
    assert_eq!(task["task"]["status"], "completed");

    // Credential is revoked: a further worker call is refused.
    let after = worker_call(
        &engine,
        "orchestration.check",
        "check-after",
        &secret,
        json!({"scope": dispatch_scope(&fx, "dispatch-1"), "mode":"peek"}),
    );
    assert!(!after.ok);
    assert_eq!(after.error.unwrap().code, "unauthorized");
}

fn dispatch_scope_admin(fx: &Fixture, dispatch_id: &str) -> Value {
    json!({"contractVersion":1,"hostId":fx.host,"runId":fx.run,"coordinatorId":"owner",
        "consumerGeneration":1,"dispatchId":dispatch_id})
}

fn coordinator_scope_task(fx: &Fixture) -> Value {
    json!({"contractVersion":1,"hostId":fx.host,"runId":fx.run,"coordinatorId":"owner",
        "consumerGeneration":1,"taskId":fx.task})
}

/// Same-ID replay while the credential is still valid (a lifecycle send
/// never revokes anything). A final report's own same-ID replay is
/// necessarily post-revocation and is exercised via `same_id_replay_of_a_settled_report_is_idempotent`.
#[test]
fn same_id_replay_of_a_non_final_send_is_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let secret = "c".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);
    let params = json!({"scope": dispatch_scope_actor(&fx, "dispatch-1"), "kind":"status",
        "subject":"alive"});

    let first = worker_call(
        &engine,
        "orchestration.send",
        "status-1",
        &secret,
        params.clone(),
    );
    assert!(first.ok, "{:?}", first.error);
    let replay = worker_call(&engine, "orchestration.send", "status-1", &secret, params);
    assert!(replay.ok, "{:?}", replay.error);
    assert_eq!(
        serde_json::to_value(&first.result).unwrap(),
        serde_json::to_value(&replay.result).unwrap(),
        "same request id replays the identical receipt"
    );
}

/// A new request id reporting the same outcome is an explicit duplicate, not
/// a second settlement. The very same (now revoked) credential must be able
/// to make this call itself: a settled-report credential narrowly recovers
/// through `send`, so no second seeded credential is used or needed.
#[test]
fn new_id_duplicate_outcome_is_marked_not_resettled() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let secret = "c".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);
    let params = json!({"scope": dispatch_scope(&fx, "dispatch-1"), "kind":"finalReport",
        "subject":"done", "finalReport": {"outcome":"succeeded"}});

    let first = worker_call(
        &engine,
        "orchestration.send",
        "report-1",
        &secret,
        params.clone(),
    );
    assert!(first.ok, "{:?}", first.error);

    let dup = worker_call(&engine, "orchestration.send", "report-2", &secret, params);
    assert!(
        dup.ok,
        "revoked credential must recover via a duplicate send: {:?}",
        dup.error
    );
    let dup_result = dup.result.unwrap();
    assert_eq!(dup_result["lifecycle"]["duplicate"], true);
    assert_eq!(dup_result["duplicate"]["originalRequestId"], "report-1");
    assert_eq!(dup_result["message"], first.result.unwrap()["message"]);
    let decoded: drogon_protocol::orchestration_mail::SendResult =
        serde_json::from_value(dup_result).unwrap();
    decoded.validate_shape().unwrap();
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM orchestration_mail_messages",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        count, 1,
        "duplicate returns the original receipt without appending mail"
    );
}

/// Same request id, same payload, replayed after the credential's own
/// settlement revoked it: the ledger's cached receipt must still be
/// reachable through the narrow settled-report recovery path.
#[test]
fn same_id_replay_of_a_settled_report_is_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let secret = "g".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);
    let params = json!({"scope": dispatch_scope(&fx, "dispatch-1"), "kind":"finalReport",
        "subject":"done", "finalReport": {"outcome":"succeeded"}});

    let first = worker_call(
        &engine,
        "orchestration.send",
        "report-1",
        &secret,
        params.clone(),
    );
    assert!(first.ok, "{:?}", first.error);

    let replay = worker_call(&engine, "orchestration.send", "report-1", &secret, params);
    assert!(
        replay.ok,
        "same-id replay must survive the settlement's own revocation: {:?}",
        replay.error
    );
    assert_eq!(
        serde_json::to_value(&first.result).unwrap(),
        serde_json::to_value(&replay.result).unwrap(),
        "same request id replays the identical committed receipt"
    );
}

#[test]
fn report_payload_naming_another_task_is_refused_without_effects() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let secret = "h".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);
    // The reporting dispatch's own task id settles fine; naming any other
    // task id is a task_dispatch_mismatch before any write (source:
    // resolveLifecycleAuthority).
    let refused = worker_call(
        &engine,
        "orchestration.send",
        "mismatch",
        &secret,
        json!({"scope": dispatch_scope(&fx, "dispatch-1"), "kind":"finalReport",
            "subject":"done", "finalReport": {"outcome":"succeeded"},
            "payload": {"taskId": "some-other-task"}}),
    );
    assert!(!refused.ok);
    assert_eq!(refused.error.unwrap().code, "task_dispatch_mismatch");
    // Nothing settled and no message landed: the attempt still reports live.
    let show = engine.dispatch(
        serde_json::from_value(json!({
            "protocol": drogon_protocol::PROTOCOL_VERSION, "requestId": "show",
            "method": "orchestration.workerShow",
            "params": dispatch_scope_admin(&fx, "dispatch-1"),
        }))
        .unwrap(),
    );
    assert!(show.ok);
    assert!(show.result.unwrap()["outcome"].is_null());
}

#[test]
fn conflicting_outcome_is_refused_and_original_status_is_preserved() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let secret = "d".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);

    let first = worker_call(
        &engine,
        "orchestration.send",
        "report-1",
        &secret,
        json!({"scope": dispatch_scope(&fx, "dispatch-1"), "kind":"finalReport",
            "subject":"done", "finalReport": {"outcome":"succeeded"}}),
    );
    assert!(first.ok, "{:?}", first.error);

    // The credential is revoked by its own settlement, but the narrow
    // settled-report recovery path still lets it attempt a resend; a
    // conflicting outcome on a new request id must be refused with no effect.
    let conflict = worker_call(
        &engine,
        "orchestration.send",
        "report-conflict",
        &secret,
        json!({"scope": dispatch_scope(&fx, "dispatch-1"), "kind":"finalReport",
            "subject":"done", "finalReport": {"outcome":"failed"}}),
    );
    assert!(!conflict.ok);
    assert_eq!(conflict.error.unwrap().code, "report_conflict");

    let task = ok(
        &engine,
        "orchestration.taskShow",
        "task-show-1",
        coordinator_scope_task(&fx),
    );
    assert_eq!(
        task["task"]["status"], "completed",
        "the original outcome is preserved"
    );
}

fn dispatch_scope_actor(fx: &Fixture, dispatch_id: &str) -> Value {
    json!({"actorKind":"dispatch","contractVersion":1,"hostId":fx.host,"runId":fx.run,
        "taskId":fx.task,"dispatchId":dispatch_id})
}

#[test]
fn revoked_credential_recovers_its_settled_report_via_request_show_only() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let secret = "e".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);

    let report = worker_call(
        &engine,
        "orchestration.send",
        "report-1",
        &secret,
        json!({"scope": dispatch_scope(&fx, "dispatch-1"), "kind":"finalReport",
            "subject":"done", "finalReport": {"outcome":"succeeded"}}),
    );
    assert!(report.ok, "{:?}", report.error);

    // A typed CLI calls `status` as a preflight before every method; a
    // settled-report credential must still pass it, read-only.
    let status = worker_call(&engine, "status", "status-after", &secret, json!({}));
    assert!(
        status.ok,
        "status preflight must survive settlement: {:?}",
        status.error
    );
    assert_eq!(status.result.unwrap()["hostId"], fx.host);

    let recovered = worker_call(
        &engine,
        "orchestration.requestShow",
        "recover-1",
        &secret,
        json!({"scope": dispatch_scope_actor(&fx, "dispatch-1"), "requestId":"report-1"}),
    );
    assert!(
        recovered.ok,
        "revoked credential must still recover its own settled report: {:?}",
        recovered.error
    );
    assert_eq!(recovered.result.unwrap()["state"], "committed");

    let other = worker_call(
        &engine,
        "orchestration.check",
        "other-1",
        &secret,
        json!({"scope": dispatch_scope(&fx, "dispatch-1"), "mode":"peek"}),
    );
    assert!(!other.ok, "revocation must still block every other method");
    assert_eq!(other.error.unwrap().code, "unauthorized");
}

/// A credential row claiming `revocation_reason = 'reported'` is not, by
/// itself, proof of anything: recovery must cross-check the actual attempt
/// row's own stored outcome, not just trust that string.
#[test]
fn revocation_reason_string_alone_does_not_grant_recovery_without_a_matching_settled_attempt() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let secret = "j".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);

    let report = worker_call(
        &engine,
        "orchestration.send",
        "report-1",
        &secret,
        json!({"scope": dispatch_scope(&fx, "dispatch-1"), "kind":"finalReport",
            "subject":"done", "finalReport": {"outcome":"succeeded"}}),
    );
    assert!(report.ok, "{:?}", report.error);

    // Corrupt the durable attempt state back to "no outcome yet" while the
    // credential row still says `revocation_reason = 'reported'`.
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    let state = json!({
        "result": {"runId": fx.run, "taskId": fx.task, "dispatchId": "dispatch-1",
            "consumerGeneration":1, "workspaceId":"fixture-folder", "assignmentState":"ready",
            "readiness":"notObserved", "processVerdict":"unverifiable", "effects":[], "residualResources":[]},
        "launch": {"harnessId":"claude","permissionMode":"inherit"},
        "outcome": null, "report_message_id": null, "cleanup_owned": false,
    });
    conn.execute(
        "UPDATE orchestration_attempts SET state_json = ?1 WHERE dispatch_id = 'dispatch-1'",
        [state.to_string()],
    )
    .unwrap();
    drop(conn);

    for (method, params) in [
        ("status", json!({})),
        (
            "orchestration.requestShow",
            json!({"scope": dispatch_scope_actor(&fx, "dispatch-1"), "requestId":"report-1"}),
        ),
    ] {
        let response = worker_call(&engine, method, "after-corruption", &secret, params);
        assert!(
            !response.ok,
            "{method} must be refused once the attempt no longer proves settlement"
        );
        assert_eq!(response.error.unwrap().code, "unauthorized");
    }
}

/// A bounded wait with nothing to deliver must time out honestly instead of
/// blocking forever or fabricating a delivery, and must not hold any lock
/// while sleeping (other calls on the same engine keep working meanwhile).
#[test]
fn check_unread_wait_times_out_honestly_with_no_message() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let secret = "h".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);

    let started = std::time::Instant::now();
    let response = worker_call(
        &engine,
        "orchestration.check",
        "wait-1",
        &secret,
        json!({"scope": dispatch_scope(&fx, "dispatch-1"), "mode":"unread", "wait": {"timeoutMs": 150}}),
    );
    assert!(response.ok, "{:?}", response.error);
    assert!(started.elapsed() >= std::time::Duration::from_millis(150));
    let result = response.result.unwrap();
    assert_eq!(result["timedOut"], true);
    assert_eq!(result["cancelled"], false);
    assert!(result["delivery"].is_null());
}

/// A message that arrives mid-wait must still be delivered within the same
/// bounded call, not require a second round trip.
#[test]
fn check_unread_wait_delivers_a_message_that_arrives_mid_wait() {
    let dir = tempfile::tempdir().unwrap();
    let engine = std::sync::Arc::new(Engine::open(dir.path()).unwrap());
    let fx = setup(&engine);
    let secret = "i".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);

    let sender_engine = engine.clone();
    let fx_scope = coordinator_scope(&fx);
    let sender = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(80));
        ok(
            &sender_engine,
            "orchestration.send",
            "mid-wait-send",
            json!({"scope": fx_scope, "kind":"guidance",
                "to": {"kind":"dispatch","dispatchId":"dispatch-1"}, "subject":"arrived"}),
        );
    });

    let response = worker_call(
        &engine,
        "orchestration.check",
        "wait-2",
        &secret,
        json!({"scope": dispatch_scope(&fx, "dispatch-1"), "mode":"unread", "wait": {"timeoutMs": 5000}}),
    );
    sender.join().unwrap();
    assert!(response.ok, "{:?}", response.error);
    let result = response.result.unwrap();
    assert_eq!(result["timedOut"], false);
    assert_eq!(result["messages"][0]["subject"], "arrived");
}

#[test]
fn worker_stop_and_abandon_close_pending_questions_atomically() {
    for (method, expect_state) in [
        ("orchestration.workerStop", "stopped"),
        ("orchestration.workerAbandon", "abandoned"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::open(dir.path()).unwrap();
        let fx = setup(&engine);
        let secret = "f".repeat(64);
        seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);

        // A generic `send` of `kind: "question"` correlates atomically with
        // its own message insert, exactly like the dedicated `ask` path.
        let sent = ok(
            &engine,
            "orchestration.send",
            "ask-precursor",
            json!({"scope": coordinator_scope(&fx), "kind":"question",
                "to": {"kind":"dispatch","dispatchId":"dispatch-1"}, "subject":"need input?"}),
        );
        let question_message_id = sent["message"]["messageId"].as_str().unwrap().to_string();

        let cancel = ok(
            &engine,
            method,
            "cancel-1",
            json!({"contractVersion":1,"hostId":fx.host,"runId":fx.run,"coordinatorId":"owner",
                "consumerGeneration":1,"dispatchId":"dispatch-1"}),
        );
        assert_eq!(cancel["assignmentState"], expect_state);

        let resumed = worker_call(
            &engine,
            "orchestration.check",
            "check-closed",
            &secret,
            json!({"scope": dispatch_scope_actor(&fx, "dispatch-1"), "mode":"peek"}),
        );
        // The credential itself is revoked by the same transaction; confirm
        // via the coordinator side that history/closure landed, not via a
        // (now unauthorized) worker read.
        assert!(!resumed.ok);
        let closed: i64 = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME))
            .unwrap()
            .query_row(
                "SELECT closed FROM orchestration_mail_questions WHERE question_message_id = ?1",
                [&question_message_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            closed, 1,
            "{method} must close the pending question atomically"
        );
    }
}

#[test]
fn generic_answer_send_is_refused_for_every_actor_and_target_without_mail_effects() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let secret = "k".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);
    let second_task = ok(
        &engine,
        "orchestration.taskCreate",
        "second-task",
        json!({"contractVersion":1,"hostId":fx.host,"runId":fx.run,"coordinatorId":"owner",
            "consumerGeneration":1,"spec":{"instructions":"other worker"}}),
    );
    let second = Fixture {
        host: fx.host.clone(),
        run: fx.run.clone(),
        task: second_task["task"]["taskId"].as_str().unwrap().to_string(),
    };
    seed_worker(&engine, dir.path(), &second, "dispatch-2", &"l".repeat(64));
    let question = ok(
        &engine,
        "orchestration.send",
        "real-question",
        json!({"scope": coordinator_scope(&fx), "kind":"question",
            "to":{"kind":"dispatch","dispatchId":"dispatch-2"},
            "subject":"proceed?", "threadId":"real-thread"}),
    );
    let mut accepted = Vec::new();
    for actor in ["coordinator", "dispatch"] {
        for (index, target) in [
            Value::Null,
            json!({"kind":"runHome"}),
            json!({"kind":"dispatch","dispatchId":"dispatch-1"}),
            json!({"kind":"group","name":"@all"}),
        ]
        .into_iter()
        .enumerate()
        {
            let scope = if actor == "coordinator" {
                coordinator_scope(&fx)
            } else {
                dispatch_scope(&fx, "dispatch-1")
            };
            let mut params = json!({"scope":scope,"kind":"answer","subject":"proceed?",
                "body":"forged","threadId":"real-thread"});
            if !target.is_null() {
                params["to"] = target;
            }
            let id = format!("forged-{actor}-{index}");
            let response = if actor == "coordinator" {
                engine.dispatch(req("orchestration.send", &id, None, params))
            } else {
                worker_call(&engine, "orchestration.send", &id, &secret, params)
            };
            if response.ok {
                accepted.push(id);
            } else {
                let error = response.error.unwrap();
                assert_eq!(error.code, "invalid_argument", "{id}: {error:?}");
                assert!(
                    error.message.contains("orchestration.reply"),
                    "{id}: {error:?}"
                );
            }
        }
    }
    assert!(
        accepted.is_empty(),
        "generic answers bypassed reply: {accepted:?}"
    );
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM orchestration_mail_messages",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "rejected sends must not append any mail");
    let resumed = ok(
        &engine,
        "orchestration.ask",
        "resume-unanswered",
        json!({"scope":coordinator_scope(&fx),"intent":"resume",
            "questionMessageId":question["message"]["messageId"],"wait":{"timeoutMs":1}}),
    );
    assert!(resumed["answer"].is_null());
}

#[test]
fn generic_send_question_is_answerable_via_reply() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let secret = "k".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);

    let sent = ok(
        &engine,
        "orchestration.send",
        "send-question",
        json!({"scope": coordinator_scope(&fx), "kind":"question",
            "to": {"kind":"dispatch","dispatchId":"dispatch-1"}, "subject":"proceed?"}),
    );
    let question_message_id = sent["message"]["messageId"].as_str().unwrap().to_string();

    let reply = worker_call(
        &engine,
        "orchestration.reply",
        "reply-1",
        &secret,
        json!({"scope": dispatch_scope_actor(&fx, "dispatch-1"),
            "questionMessageId": question_message_id, "body":"Yes"}),
    );
    assert!(reply.ok, "{:?}", reply.error);
    assert_eq!(
        reply.result.unwrap()["questionMessageId"],
        question_message_id
    );

    let resumed = ok(
        &engine,
        "orchestration.ask",
        "resume-1",
        json!({"scope": coordinator_scope(&fx), "intent":"resume",
            "questionMessageId": question_message_id, "wait":{"timeoutMs":1}}),
    );
    assert_eq!(resumed["wait"]["outcome"], "answered");
    assert_eq!(resumed["answer"]["body"], "Yes");
}

/// Entry-level (full RPC dispatch, not the raw delivery function): a
/// generation-1 coordinator's own delivery must be refused once a real
/// takeover has admitted generation 2, even though nothing else has
/// touched that delivery and generation 1 never acknowledged it.
#[test]
fn entry_level_stale_coordinator_ack_before_gen2_allocation_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);

    ok(
        &engine,
        "orchestration.send",
        "seed",
        json!({"scope": coordinator_scope(&fx), "kind":"status", "subject":"heads up"}),
    );

    let gen1_check = ok(
        &engine,
        "orchestration.check",
        "gen1-check",
        json!({"scope": coordinator_scope_gen(&fx, 1), "mode":"unread"}),
    );
    let gen1_delivery_id = gen1_check["delivery"]["deliveryId"]
        .as_str()
        .unwrap()
        .to_string();

    ok(
        &engine,
        "orchestration.runUse",
        "takeover",
        json!({"contractVersion":1,"hostId":fx.host,"runId":fx.run,
            "coordinatorId":"owner","consumerGeneration":1,"takeover":true}),
    );

    let gen2_check = ok(
        &engine,
        "orchestration.check",
        "gen2-check",
        json!({"scope": coordinator_scope_gen(&fx, 2), "mode":"unread"}),
    );
    assert_eq!(
        gen2_check["delivery"]["messageIds"], gen1_check["delivery"]["messageIds"],
        "takeover must still see the same never-acknowledged mail"
    );

    let stale_ack = engine.dispatch(req(
        "orchestration.check",
        "gen1-stale-ack",
        None,
        json!({"scope": coordinator_scope_gen(&fx, 1), "mode":"unread",
            "acknowledge": gen1_delivery_id}),
    ));
    assert!(!stale_ack.ok, "a fenced generation-1 ACK must be refused");
    assert_eq!(stale_ack.error.unwrap().code, "consumer_fenced");
}

/// A same-request-id replay of a bounded wait must never re-enter the wait
/// loop: the ledger already decided the outcome, so replay must return
/// near-instantly even with a much larger wait budget than the original.
#[test]
fn check_unread_wait_same_id_replay_does_not_wait_again() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let secret = "l".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);
    let params = json!({"scope": dispatch_scope(&fx, "dispatch-1"), "mode":"unread",
        "wait": {"timeoutMs": 300}});

    let first = worker_call(
        &engine,
        "orchestration.check",
        "wait-replay",
        &secret,
        params.clone(),
    );
    assert!(first.ok, "{:?}", first.error);
    assert_eq!(first.result.as_ref().unwrap()["timedOut"], true);

    let started = std::time::Instant::now();
    let replay = worker_call(
        &engine,
        "orchestration.check",
        "wait-replay",
        &secret,
        params,
    );
    let elapsed = started.elapsed();
    assert!(replay.ok, "{:?}", replay.error);
    assert_eq!(
        serde_json::to_value(&first.result).unwrap(),
        serde_json::to_value(&replay.result).unwrap(),
        "same request id replays the identical committed receipt"
    );
    assert!(
        elapsed < std::time::Duration::from_millis(150),
        "replay must skip the wait loop entirely (budget was 300ms), took {elapsed:?}"
    );
}

/// Shutdown interrupting an in-progress wait must produce a graceful
/// `cancelled: true` response, never a hard `runtime_busy` error and never
/// a fabricated delivery.
#[test]
fn check_unread_wait_shutdown_cancellation_is_graceful_not_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);

    let status = ok(&engine, "status", "shutdown-status", json!({}));
    ok(
        &engine,
        "runtime.shutdown",
        "shutdown-1",
        json!({"hostId": fx.host, "serviceInstanceId": status["serviceInstanceId"]}),
    );

    let response = engine.dispatch(req(
        "orchestration.check",
        "wait-during-shutdown",
        None,
        json!({"scope": coordinator_scope(&fx), "mode":"unread", "wait":{"timeoutMs":5000}}),
    ));
    assert!(
        response.ok,
        "a wait interrupted by shutdown must be a graceful response, not an error: {:?}",
        response.error
    );
    let result = response.result.unwrap();
    assert_eq!(result["cancelled"], true);
    assert_eq!(result["timedOut"], false);
    assert!(result["delivery"].is_null());
}

/// The prewait poll must not treat the very batch this call is about to
/// acknowledge as "unread": otherwise a call that both acks an outstanding
/// batch and asks to wait wakes on that old batch immediately, and the
/// commit then acks it and returns whatever (here: nothing) is left instead
/// of actually waiting for the next batch to arrive.
#[test]
fn check_unread_wait_acks_old_batch_then_waits_for_the_next_one() {
    let dir = tempfile::tempdir().unwrap();
    let engine = std::sync::Arc::new(Engine::open(dir.path()).unwrap());
    let fx = setup(&engine);
    let secret = "m".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);

    ok(
        &engine,
        "orchestration.send",
        "old-batch-send",
        json!({"scope": coordinator_scope(&fx), "kind":"guidance",
            "to": {"kind":"dispatch","dispatchId":"dispatch-1"}, "subject":"old"}),
    );
    let old_check = worker_call(
        &engine,
        "orchestration.check",
        "old-check",
        &secret,
        json!({"scope": dispatch_scope(&fx, "dispatch-1"), "mode":"unread"}),
    );
    assert!(old_check.ok, "{:?}", old_check.error);
    let old_delivery_id = old_check.result.unwrap()["delivery"]["deliveryId"]
        .as_str()
        .unwrap()
        .to_string();

    let sender_engine = engine.clone();
    let fx_scope = coordinator_scope(&fx);
    let sender = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(150));
        ok(
            &sender_engine,
            "orchestration.send",
            "new-batch-send",
            json!({"scope": fx_scope, "kind":"guidance",
                "to": {"kind":"dispatch","dispatchId":"dispatch-1"}, "subject":"new"}),
        );
    });

    let started = std::time::Instant::now();
    let response = worker_call(
        &engine,
        "orchestration.check",
        "ack-and-wait",
        &secret,
        json!({"scope": dispatch_scope(&fx, "dispatch-1"), "mode":"unread",
            "acknowledge": old_delivery_id, "wait": {"timeoutMs": 5000}}),
    );
    sender.join().unwrap();
    let elapsed = started.elapsed();
    assert!(response.ok, "{:?}", response.error);
    let result = response.result.unwrap();
    assert_eq!(
        result["acknowledged"]["deliveryId"], old_delivery_id,
        "must ack the old batch as requested"
    );
    assert_eq!(result["acknowledged"]["alreadyAcknowledged"], false);
    assert_eq!(
        result["timedOut"], false,
        "must have woken on the new message, not timed out"
    );
    assert_eq!(
        result["messages"][0]["subject"], "new",
        "must deliver the NEXT batch, not an empty result for the old one"
    );
    assert!(
        elapsed >= std::time::Duration::from_millis(150),
        "must have actually waited for the next message, not returned instantly: {elapsed:?}"
    );
    assert!(
        elapsed < std::time::Duration::from_millis(3000),
        "must wake promptly once the new message lands: {elapsed:?}"
    );
}

/// A same-request-id replay of a bounded ack+wait must never re-run the wait
/// loop or re-apply the acknowledgement: the ledger already decided the
/// outcome, including the ack, so replay returns the identical receipt.
#[test]
fn check_unread_wait_with_ack_same_id_replay_preserves_result() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let secret = "n".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);

    ok(
        &engine,
        "orchestration.send",
        "old-batch-send",
        json!({"scope": coordinator_scope(&fx), "kind":"guidance",
            "to": {"kind":"dispatch","dispatchId":"dispatch-1"}, "subject":"old"}),
    );
    let old_check = worker_call(
        &engine,
        "orchestration.check",
        "old-check",
        &secret,
        json!({"scope": dispatch_scope(&fx, "dispatch-1"), "mode":"unread"}),
    );
    assert!(old_check.ok, "{:?}", old_check.error);
    let old_delivery_id = old_check.result.unwrap()["delivery"]["deliveryId"]
        .as_str()
        .unwrap()
        .to_string();

    let params = json!({"scope": dispatch_scope(&fx, "dispatch-1"), "mode":"unread",
        "acknowledge": old_delivery_id, "wait": {"timeoutMs": 200}});
    let first = worker_call(
        &engine,
        "orchestration.check",
        "ack-wait-replay",
        &secret,
        params.clone(),
    );
    assert!(first.ok, "{:?}", first.error);
    assert_eq!(first.result.as_ref().unwrap()["timedOut"], true);
    assert_eq!(
        first.result.as_ref().unwrap()["acknowledged"]["alreadyAcknowledged"],
        false
    );

    let started = std::time::Instant::now();
    let replay = worker_call(
        &engine,
        "orchestration.check",
        "ack-wait-replay",
        &secret,
        params,
    );
    let elapsed = started.elapsed();
    assert!(replay.ok, "{:?}", replay.error);
    assert_eq!(
        serde_json::to_value(&first.result).unwrap(),
        serde_json::to_value(&replay.result).unwrap(),
        "same request id must replay the identical committed receipt, including the ack"
    );
    assert!(
        elapsed < std::time::Duration::from_millis(150),
        "replay must skip the wait loop entirely (budget was 200ms), took {elapsed:?}"
    );

    let acknowledged_count: i64 =
        rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME))
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM orchestration_mail_deliveries
                  WHERE delivery_id = ?1 AND acknowledged = 1",
                [&old_delivery_id],
                |r| r.get(0),
            )
            .unwrap();
    assert_eq!(
        acknowledged_count, 1,
        "the old batch must be acknowledged exactly once, never re-applied by a replay"
    );
}

/// Real shutdown arriving *while* a wait is already blocked (not before it
/// starts) must interrupt it gracefully, well before the requested deadline.
#[test]
fn check_unread_wait_real_shutdown_midwait_is_cancelled_before_deadline() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    std::thread::scope(|threads| {
        let waiting = threads.spawn(|| {
            engine.dispatch(req(
                "orchestration.check",
                "shutdown-midwait",
                None,
                json!({"scope": coordinator_scope(&fx), "mode":"unread", "wait":{"timeoutMs":5000}}),
            ))
        });
        std::thread::sleep(std::time::Duration::from_millis(120));
        let status = ok(&engine, "status", "shutdown-status", json!({}));
        let started = std::time::Instant::now();
        ok(
            &engine,
            "runtime.shutdown",
            "shutdown-1",
            json!({"hostId": fx.host, "serviceInstanceId": status["serviceInstanceId"]}),
        );
        let response = waiting.join().unwrap();
        assert!(response.ok, "{:?}", response.error);
        let result = response.result.unwrap();
        assert_eq!(result["cancelled"], true);
        assert_eq!(result["timedOut"], false);
        assert!(result["delivery"].is_null());
        assert!(
            started.elapsed() < std::time::Duration::from_secs(1),
            "an already-blocked wait must be cancelled promptly by a later shutdown, not held to the deadline"
        );
    });
}

/// A worker's credential revoked (e.g. by an explicit stop) *while* its own
/// unread wait is already blocked must refuse that in-flight call promptly,
/// not silently keep waiting on a now-dead credential until the deadline.
#[test]
fn check_unread_wait_worker_revocation_midwait_is_refused_before_deadline() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let secret = "o".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);

    std::thread::scope(|threads| {
        let waiting = threads.spawn(|| {
            worker_call(
                &engine,
                "orchestration.check",
                "revoke-midwait",
                &secret,
                json!({"scope": dispatch_scope(&fx, "dispatch-1"), "mode":"unread",
                    "wait":{"timeoutMs":5000}}),
            )
        });
        std::thread::sleep(std::time::Duration::from_millis(120));
        let started = std::time::Instant::now();
        ok(
            &engine,
            "orchestration.workerStop",
            "stop-midwait",
            json!({"contractVersion":1,"hostId":fx.host,"runId":fx.run,"coordinatorId":"owner",
                "consumerGeneration":1,"dispatchId":"dispatch-1"}),
        );
        let response = waiting.join().unwrap();
        assert!(
            !response.ok,
            "a revoked credential's in-flight wait must be refused, not fabricate a delivery"
        );
        assert_eq!(response.error.unwrap().code, "unauthorized");
        assert!(
            started.elapsed() < std::time::Duration::from_secs(1),
            "revocation must interrupt an already-blocked wait promptly, not wait for the deadline"
        );
    });
}

#[test]
fn settled_credential_recovery_requires_valid_own_report_evidence() {
    for corruption in ["outcome", "missing", "sender", "kind", "identity"] {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::open(dir.path()).unwrap();
        let fx = setup(&engine);
        let secret = "proof".repeat(16);
        seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);
        let reported = worker_call(
            &engine,
            "orchestration.send",
            "report-proof",
            &secret,
            json!({"scope": dispatch_scope(&fx, "dispatch-1"), "kind":"finalReport",
                "subject":"done", "finalReport":{"outcome":"succeeded"}}),
        );
        assert!(reported.ok, "{:?}", reported.error);
        assert!(worker_call(&engine, "status", "valid-proof", &secret, json!({})).ok);
        let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
        let state: String = conn
            .query_row(
                "SELECT state_json FROM orchestration_attempts WHERE dispatch_id='dispatch-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let mut state: Value = serde_json::from_str(&state).unwrap();
        match corruption {
            "outcome" => state["outcome"] = json!("fabricated"),
            "missing" => state["report_message_id"] = json!("missing-report"),
            "identity" => state["result"]["dispatchId"] = json!("someone-else"),
            "sender" => {
                conn.execute(
                    "UPDATE orchestration_mail_messages SET from_dispatch_id='someone-else'",
                    [],
                )
                .unwrap();
            }
            "kind" => {
                conn.execute("UPDATE orchestration_mail_messages SET kind='status'", [])
                    .unwrap();
            }
            _ => unreachable!(),
        }
        conn.execute(
            "UPDATE orchestration_attempts SET state_json=?1 WHERE dispatch_id='dispatch-1'",
            [state.to_string()],
        )
        .unwrap();
        let denied = worker_call(&engine, "status", "corrupt-proof", &secret, json!({}));
        assert!(
            !denied.ok,
            "accepted corrupted report evidence: {corruption}"
        );
    }
}

#[test]
fn coordinator_takeover_interrupts_unread_wait_without_waiting_for_deadline() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    std::thread::scope(|threads| {
        let waiting =
            threads.spawn(|| {
                engine.dispatch(req("orchestration.check", "fenced-wait", None,
            json!({"scope":coordinator_scope(&fx),"mode":"unread","wait":{"timeoutMs":3000}})))
            });
        std::thread::sleep(std::time::Duration::from_millis(70));
        let started = std::time::Instant::now();
        ok(
            &engine,
            "orchestration.runUse",
            "wait-takeover",
            json!({"contractVersion":1,
            "hostId":fx.host,"runId":fx.run,"coordinatorId":"owner","consumerGeneration":1,"takeover":true}),
        );
        let response = waiting.join().unwrap();
        assert!(!response.ok);
        assert_eq!(response.error.unwrap().code, "consumer_fenced");
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
    });
}

#[test]
fn send_to_unknown_dispatch_is_refused_without_appending_mail() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let sent = engine.dispatch(req(
        "orchestration.send",
        "missing-target",
        None,
        json!({"scope":coordinator_scope(&fx),"kind":"guidance","subject":"go",
            "to":{"kind":"dispatch","dispatchId":"missing"}}),
    ));
    assert!(!sent.ok);
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM orchestration_mail_messages",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn final_report_metadata_survives_reopen_and_cannot_be_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let secret = "metadata".repeat(8);
    seed_worker(&engine, dir.path(), &fx, "dispatch-meta", &secret);
    let metadata = json!({"files":["src/example.rs"],"tests":{"passed":7}});
    let report = |value| {
        json!({"scope":dispatch_scope(&fx,"dispatch-meta"),"kind":"finalReport",
        "subject":"done","finalReport":{"outcome":"succeeded","result":value}})
    };
    let first = worker_call(
        &engine,
        "orchestration.send",
        "meta-first",
        &secret,
        report(metadata.clone()),
    );
    assert!(first.ok, "{:?}", first.error);
    let late = engine.dispatch(req(
        "orchestration.send",
        "late-guidance",
        None,
        json!({"scope":coordinator_scope(&fx),"kind":"guidance","subject":"too late",
            "to":{"kind":"dispatch","dispatchId":"dispatch-meta"}}),
    ));
    assert!(
        !late.ok,
        "reported worker cannot consume newly accepted guidance"
    );
    let show = || json!(dispatch_scope_admin(&fx, "dispatch-meta"));
    assert_eq!(
        ok(&engine, "orchestration.workerShow", "meta-show", show())["reportResult"],
        metadata
    );
    let duplicate = worker_call(
        &engine,
        "orchestration.send",
        "meta-duplicate",
        &secret,
        report(json!({"changed":true})),
    );
    assert!(duplicate.ok, "{:?}", duplicate.error);
    assert_eq!(duplicate.result.unwrap()["lifecycle"]["duplicate"], true);
    drop(engine);
    let engine = Engine::open(dir.path()).unwrap();
    assert_eq!(
        ok(&engine, "orchestration.workerShow", "meta-reopened", show())["reportResult"],
        metadata
    );
}

#[test]
fn invalid_or_corrupted_ack_is_rejected_before_wait_budget() {
    for corruption in ["missing", "negative", "beyond"] {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::open(dir.path()).unwrap();
        let fx = setup(&engine);
        ok(
            &engine,
            "orchestration.send",
            "floor-message",
            json!({"scope":coordinator_scope(&fx),"kind":"status","subject":"old"}),
        );
        let batch = ok(
            &engine,
            "orchestration.check",
            "floor-batch",
            json!({"scope":coordinator_scope(&fx),"mode":"unread"}),
        );
        let mut id = batch["delivery"]["deliveryId"]
            .as_str()
            .unwrap()
            .to_string();
        if corruption == "missing" {
            id = "unknown-ack".into();
        } else {
            let conn =
                rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
            conn.execute(
                "UPDATE orchestration_mail_deliveries SET max_sequence=?1 WHERE delivery_id=?2",
                rusqlite::params![
                    if corruption == "negative" {
                        -1i64
                    } else {
                        999999
                    },
                    id
                ],
            )
            .unwrap();
        }
        let start = std::time::Instant::now();
        let response = engine.dispatch(req("orchestration.check","floor-wait",None,
            json!({"scope":coordinator_scope(&fx),"mode":"unread","acknowledge":id,"kinds":["guidance"],"wait":{"timeoutMs":1500}})));
        assert!(!response.ok, "{corruption}");
        assert!(
            start.elapsed() < std::time::Duration::from_millis(750),
            "{corruption} waited before rejecting"
        );
    }
}

#[test]
fn check_priority_round_trips_and_peek_all_read_states() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let secret = "b".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);
    for (id, priority, subject) in [
        ("send-normal", "normal", "plain"),
        ("send-high", "high", "elevated"),
        ("send-urgent", "urgent", "critical"),
    ] {
        ok(
            &engine,
            "orchestration.send",
            id,
            json!({"scope": coordinator_scope(&fx), "kind": "guidance",
                "to": {"kind": "dispatch", "dispatchId": "dispatch-1"},
                "subject": subject, "priority": priority}),
        );
    }
    let check = |id: &str, extra: Value| {
        let mut params = json!({"scope": dispatch_scope(&fx, "dispatch-1")});
        for (k, v) in extra.as_object().unwrap() {
            params[k] = v.clone();
        }
        let response = worker_call(&engine, "orchestration.check", id, &secret, params);
        assert!(response.ok, "{:?}", response.error);
        response.result.unwrap()
    };
    // Peek is non-consuming: all three unread rows with priorities intact.
    let peeked = check("peek-1", json!({"mode": "peek"}));
    assert_eq!(peeked["messages"].as_array().unwrap().len(), 3);
    assert_eq!(peeked["messages"][0]["priority"], "normal");
    assert_eq!(peeked["messages"][1]["priority"], "high");
    assert_eq!(peeked["messages"][2]["priority"], "urgent");
    assert!(peeked.get("delivery").is_none());
    // Server-side kind filter applies to inspection output.
    let peeked_guidance = check("peek-2", json!({"mode": "peek", "kinds": ["guidance"]}));
    assert_eq!(peeked_guidance["messages"].as_array().unwrap().len(), 3);
    let peeked_status = check("peek-3", json!({"mode": "peek", "kinds": ["status"]}));
    assert_eq!(peeked_status["messages"].as_array().unwrap().len(), 0);
    // Peek consumed nothing: the consuming read still gets the whole batch.
    let consumed = check("unread-1", json!({"mode": "unread"}));
    assert_eq!(consumed["messages"].as_array().unwrap().len(), 3);
    let delivery_id = consumed["delivery"]["deliveryId"]
        .as_str()
        .unwrap()
        .to_string();
    // An outstanding (unacked) delivery still reads as unread; only the ack
    // advances the read pointer.
    let peeked_outstanding = check("peek-4", json!({"mode": "peek"}));
    assert_eq!(peeked_outstanding["messages"].as_array().unwrap().len(), 3);
    let acked = check(
        "unread-2",
        json!({"mode": "unread", "acknowledge": delivery_id}),
    );
    assert_eq!(acked["acknowledged"]["alreadyAcknowledged"], false);
    assert_eq!(acked["messages"].as_array().unwrap().len(), 0);
    // After the ack, peek sees only unread (none); all includes read rows.
    let peeked_after = check("peek-5", json!({"mode": "peek"}));
    assert_eq!(peeked_after["messages"].as_array().unwrap().len(), 0);
    let all = check("all-1", json!({"mode": "all"}));
    assert_eq!(all["messages"].as_array().unwrap().len(), 3);
    assert!(all.get("delivery").is_none());
}

#[test]
fn check_format_flag_returns_server_side_expanded_block() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let secret = "c".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);
    ok(
        &engine,
        "orchestration.send",
        "send-1",
        json!({"scope": coordinator_scope(&fx), "kind": "guidance",
            "to": {"kind": "dispatch", "dispatchId": "dispatch-1"},
            "subject": "orders", "body": "do the thing",
            "payload": {"step": 1}, "priority": "urgent"}),
    );
    let response = worker_call(
        &engine,
        "orchestration.check",
        "check-1",
        &secret,
        json!({"scope": dispatch_scope(&fx, "dispatch-1"), "mode": "peek", "format": true}),
    );
    assert!(response.ok, "{:?}", response.error);
    let formatted = response.result.unwrap()["formatted"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(formatted.contains("[URGENT] [guidance]"), "{formatted}");
    assert!(formatted.contains("[subject]"), "{formatted}");
    assert!(formatted.contains("[body]"), "{formatted}");
    assert!(formatted.contains("[payload]"), "{formatted}");
    assert!(
        formatted.contains("drogon-cli orchestration reply"),
        "{formatted}"
    );
}

#[test]
fn check_consuming_kind_filter_is_wake_only_never_a_local_output_filter() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let fx = setup(&engine);
    let secret = "d".repeat(64);
    seed_worker(&engine, dir.path(), &fx, "dispatch-1", &secret);
    ok(
        &engine,
        "orchestration.send",
        "send-1",
        json!({"scope": coordinator_scope(&fx), "kind": "status",
            "to": {"kind": "dispatch", "dispatchId": "dispatch-1"}, "subject": "first"}),
    );
    ok(
        &engine,
        "orchestration.send",
        "send-2",
        json!({"scope": coordinator_scope(&fx), "kind": "question",
            "to": {"kind": "dispatch", "dispatchId": "dispatch-1"}, "subject": "second"}),
    );
    // Run-mailbox parity: `kinds` wakes the waiter, but the delivered FIFO
    // batch keeps its earlier non-matching messages.
    let response = worker_call(
        &engine,
        "orchestration.check",
        "check-1",
        &secret,
        json!({"scope": dispatch_scope(&fx, "dispatch-1"), "mode": "unread",
            "kinds": ["question"]}),
    );
    assert!(response.ok, "{:?}", response.error);
    let result = response.result.unwrap();
    let subjects: Vec<&str> = result["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["subject"].as_str().unwrap())
        .collect();
    assert_eq!(subjects, vec!["first", "second"]);
    // With no matching kind anywhere, nothing is allocated yet.
    let response = worker_call(
        &engine,
        "orchestration.check",
        "check-2",
        &secret,
        json!({"scope": dispatch_scope(&fx, "dispatch-1"), "mode": "unread",
            "acknowledge": result["delivery"]["deliveryId"].as_str().unwrap(),
            "kinds": ["heartbeat"]}),
    );
    assert!(response.ok, "{:?}", response.error);
    let result = response.result.unwrap();
    assert_eq!(result["messages"].as_array().unwrap().len(), 0);
    assert!(result.get("delivery").is_none());
}
