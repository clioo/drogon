use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

fn call(engine: &Engine, method: &str, id: &str, params: Value) -> Response {
    engine.dispatch(
        serde_json::from_value::<Request>(json!({
            "protocol": PROTOCOL_VERSION, "requestId": id, "method": method, "params": params
        }))
        .unwrap(),
    )
}

fn success(response: Response) -> Value {
    assert!(response.ok, "{:?}", response.error);
    response.result.unwrap()
}

fn setup(engine: &Engine) -> Value {
    let host = success(call(engine, "status", "status", json!({})))["hostId"].clone();
    let run = success(call(
        engine,
        "orchestration.runCreate",
        "create",
        json!({
            "contractVersion": 1, "hostId": host, "coordinatorId": "owner", "objective": "questions"
        }),
    ))["run"]["runId"]
        .clone();
    json!({"actorKind":"coordinator", "contractVersion":1, "hostId":host,
        "runId":run, "coordinatorId":"owner", "consumerGeneration":1})
}

#[test]
fn ask_timeout_replay_reply_and_resume_preserve_one_question() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let scope = setup(&engine);
    let params = json!({"scope":scope,"intent":"new","question":"Continue?",
        "wait":{"timeoutMs":1}});
    let first = success(call(&engine, "orchestration.ask", "ask", params.clone()));
    assert_eq!(first["wait"]["outcome"], "pending");
    let replay = success(call(&engine, "orchestration.ask", "ask", params));
    assert_eq!(first["questionMessageId"], replay["questionMessageId"]);
    let reply_params =
        json!({"scope":scope,"questionMessageId":first["questionMessageId"],"body":"Yes"});
    let answer = success(call(
        &engine,
        "orchestration.reply",
        "reply",
        reply_params.clone(),
    ));
    let duplicate = success(call(
        &engine,
        "orchestration.reply",
        "reply-again",
        reply_params,
    ));
    assert_eq!(answer["message"], duplicate["message"]);
    let resumed = success(call(
        &engine,
        "orchestration.ask",
        "resume",
        json!({
            "scope":scope,"intent":"resume","questionMessageId":first["questionMessageId"],"wait":{"timeoutMs":1}
        }),
    ));
    assert_eq!(resumed["wait"]["outcome"], "answered");
    assert_eq!(resumed["answer"]["body"], "Yes");
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM orchestration_mail_questions",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM orchestration_mail_messages",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        2
    );
    let conflict = call(
        &engine,
        "orchestration.reply",
        "conflict",
        json!({
            "scope":scope,"questionMessageId":first["questionMessageId"],"body":"No"
        }),
    );
    assert_eq!(conflict.error.unwrap().code, "answer_conflict");
}

fn seed_worker(engine: &Engine, dir: &std::path::Path, scope: &Value, id: &str) -> (Value, String) {
    use sha2::{Digest, Sha256};
    let task = success(call(
        engine,
        "orchestration.taskCreate",
        &format!("task-{id}"),
        json!({
            "contractVersion":1,"hostId":scope["hostId"],"runId":scope["runId"],
            "coordinatorId":"owner","consumerGeneration":1,"spec":{"instructions":"answer"}
        }),
    ))["task"]["taskId"]
        .clone();
    let secret = format!("{}-{id}", "a".repeat(64));
    let conn = rusqlite::Connection::open(dir.join(drogon_core::DB_FILE_NAME)).unwrap();
    let state = json!({
        "result":{"runId":scope["runId"],"taskId":task,"dispatchId":id,"consumerGeneration":1,
            "workspaceId":"fixture-folder","assignmentState":"ready","readiness":"notObserved",
            "processVerdict":"unverifiable","effects":[],"residualResources":[]},
        "launch":{"harnessId":"claude","permissionMode":"inherit"},
        "outcome":null,"report_message_id":null,"cleanup_owned":false
    });
    conn.execute("INSERT INTO orchestration_attempts(dispatch_id,host_id,run_id,task_id,is_current,fenced,state_json) VALUES (?1,?2,?3,?4,1,0,?5)",
        rusqlite::params![id, scope["hostId"].as_str().unwrap(), scope["runId"].as_str().unwrap(), task.as_str().unwrap(),state.to_string()]).unwrap();
    conn.execute("INSERT INTO orchestration_dispatch_credentials(digest,host_id,run_id,task_id,dispatch_id,session_id,incarnation,revoked,created_at) VALUES (?1,?2,?3,?4,?5,?5,?5,0,'t')",
        rusqlite::params![format!("{:x}",Sha256::digest(secret.as_bytes())),scope["hostId"].as_str().unwrap(),scope["runId"].as_str().unwrap(),task.as_str().unwrap(),id]).unwrap();
    (
        json!({"actorKind":"dispatch","contractVersion":1,"hostId":scope["hostId"],"runId":scope["runId"],"taskId":task,"dispatchId":id}),
        secret,
    )
}

fn worker(engine: &Engine, secret: &str, method: &str, id: &str, params: Value) -> Response {
    engine.dispatch_authenticated(
        serde_json::from_value(json!({
            "protocol":PROTOCOL_VERSION,"requestId":id,"method":method,"params":params,"auth":secret
        }))
        .unwrap(),
        "unused-admin-token",
    )
}

#[test]
fn both_directions_enforce_asker_and_addressee_identity() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let scope = setup(&engine);
    let (one, secret) = seed_worker(&engine, dir.path(), &scope, "dispatch-one");
    let (two, sibling_secret) = seed_worker(&engine, dir.path(), &scope, "dispatch-two");
    let ask = success(worker(
        &engine,
        &secret,
        "orchestration.ask",
        "worker-ask",
        json!({
            "scope":one,"intent":"new","question":"Proceed?","wait":{"timeoutMs":1}
        }),
    ));
    let id = ask["questionMessageId"].clone();
    let snoop = worker(
        &engine,
        &sibling_secret,
        "orchestration.ask",
        "snoop",
        json!({
            "scope":two,"intent":"resume","questionMessageId":id,"wait":{"timeoutMs":1}
        }),
    );
    assert_eq!(snoop.error.unwrap().code, "unauthorized");
    let wrong = worker(
        &engine,
        &sibling_secret,
        "orchestration.reply",
        "wrong",
        json!({
            "scope":two,"questionMessageId":id,"body":"sibling"
        }),
    );
    assert!(!wrong.ok);
    success(call(
        &engine,
        "orchestration.reply",
        "coordinator-reply",
        json!({"scope":scope,"questionMessageId":id,"body":"Go"}),
    ));
    let resumed = success(worker(
        &engine,
        &secret,
        "orchestration.ask",
        "resume",
        json!({
            "scope":one,"intent":"resume","questionMessageId":id,"wait":{"timeoutMs":1}
        }),
    ));
    assert_eq!(resumed["answer"]["body"], "Go");
    let ask = success(call(
        &engine,
        "orchestration.ask",
        "coordinator-ask",
        json!({
            "scope":scope,"intent":"new","question":"Ready?","to":{"kind":"dispatch","dispatchId":"dispatch-one"},"wait":{"timeoutMs":1}
        }),
    ));
    let id = ask["questionMessageId"].clone();
    success(worker(
        &engine,
        &secret,
        "orchestration.reply",
        "worker-reply",
        json!({"scope":one,"questionMessageId":id,"body":"Ready"}),
    ));
    let resumed = success(call(
        &engine,
        "orchestration.ask",
        "coordinator-resume",
        json!({
            "scope":scope,"intent":"resume","questionMessageId":id,"wait":{"timeoutMs":1}
        }),
    ));
    assert_eq!(resumed["answer"]["body"], "Ready");
    let spoof = worker(
        &engine,
        &secret,
        "orchestration.ask",
        "spoof",
        json!({
            "scope":two,"intent":"new","question":"Spoof","wait":{"timeoutMs":1}
        }),
    );
    assert_eq!(spoof.error.unwrap().code, "unauthorized");
}

#[test]
fn waiter_releases_database_for_concurrent_reply() {
    let dir = tempfile::tempdir().unwrap();
    let engine = std::sync::Arc::new(Engine::open(dir.path()).unwrap());
    let scope = setup(&engine);
    let first = success(call(
        &engine,
        "orchestration.ask",
        "initial",
        json!({
            "scope":scope,"intent":"new","question":"Concurrent?","wait":{"timeoutMs":1}
        }),
    ));
    let id = first["questionMessageId"].clone();
    std::thread::scope(|threads| {
        let waiter = threads.spawn(|| {
            call(
                &engine,
                "orchestration.ask",
                "waiting",
                json!({
                    "scope":scope,"intent":"resume","questionMessageId":id,"wait":{"timeoutMs":1000}
                }),
            )
        });
        std::thread::sleep(std::time::Duration::from_millis(30));
        success(call(
            &engine,
            "orchestration.reply",
            "answer",
            json!({"scope":scope,"questionMessageId":id,"body":"Concurrent answer"}),
        ));
        let result = success(waiter.join().unwrap());
        assert_eq!(result["wait"]["outcome"], "answered");
    });
}

#[test]
fn rejected_target_rolls_back_question_and_corrupt_resume_is_bounded() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let scope = setup(&engine);
    let invalid = call(
        &engine,
        "orchestration.ask",
        "missing-target",
        json!({
            "scope":scope,"intent":"new","question":"Missing?","to":{"kind":"dispatch","dispatchId":"absent"},"wait":{"timeoutMs":1}
        }),
    );
    assert!(!invalid.ok);
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM orchestration_mail_questions",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    let first = success(call(
        &engine,
        "orchestration.ask",
        "initial",
        json!({
            "scope":scope,"intent":"new","question":"Bounded?","wait":{"timeoutMs":1}
        }),
    ));
    conn.execute(
        "UPDATE orchestration_mail_questions SET answer_body=?1",
        ["x".repeat(600000)],
    )
    .unwrap();
    let result = call(
        &engine,
        "orchestration.ask",
        "resume",
        json!({
            "scope":scope,"intent":"resume","questionMessageId":first["questionMessageId"],"wait":{"timeoutMs":1}
        }),
    );
    assert_eq!(result.error.unwrap().code, "internal_error");
}

#[test]
fn takeover_fences_waiter_and_new_coordinator_can_recover_question() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let scope = setup(&engine);
    let first = success(call(
        &engine,
        "orchestration.ask",
        "initial",
        json!({
            "scope":scope,"intent":"new","question":"Takeover?","wait":{"timeoutMs":1}
        }),
    ));
    let id = first["questionMessageId"].clone();
    std::thread::scope(|threads| {
        let waiter = threads.spawn(|| {
            call(
                &engine,
                "orchestration.ask",
                "waiting",
                json!({
                    "scope":scope,"intent":"resume","questionMessageId":id,"wait":{"timeoutMs":1000}
                }),
            )
        });
        std::thread::sleep(std::time::Duration::from_millis(30));
        success(call(
            &engine,
            "orchestration.runUse",
            "takeover",
            json!({
                "contractVersion":1,"hostId":scope["hostId"],"runId":scope["runId"],
                "coordinatorId":"replacement","consumerGeneration":1,"takeover":true
            }),
        ));
        assert_eq!(
            waiter.join().unwrap().error.unwrap().code,
            "consumer_fenced"
        );
    });
    let mut current = scope.clone();
    current["coordinatorId"] = json!("replacement");
    current["consumerGeneration"] = json!(2);
    success(call(
        &engine,
        "orchestration.reply",
        "reply",
        json!({"scope":current,"questionMessageId":id,"body":"Recovered"}),
    ));
    let result = success(call(
        &engine,
        "orchestration.ask",
        "recover",
        json!({
            "scope":current,"intent":"resume","questionMessageId":id,"wait":{"timeoutMs":1}
        }),
    ));
    assert_eq!(result["answer"]["body"], "Recovered");
}

#[test]
fn shutdown_interrupts_wait_without_settling_question() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let scope = setup(&engine);
    let first = success(call(
        &engine,
        "orchestration.ask",
        "initial",
        json!({
            "scope":scope,"intent":"new","question":"Shutdown?","wait":{"timeoutMs":1}
        }),
    ));
    let id = first["questionMessageId"].clone();
    std::thread::scope(|threads| {
        let waiter = threads.spawn(|| {
            call(
                &engine,
                "orchestration.ask",
                "waiting",
                json!({
                    "scope":scope,"intent":"resume","questionMessageId":id,"wait":{"timeoutMs":1000}
                }),
            )
        });
        std::thread::sleep(std::time::Duration::from_millis(30));
        let status = success(call(&engine, "status", "shutdown-status", json!({})));
        success(call(
            &engine,
            "runtime.shutdown",
            "shutdown",
            json!({
                "hostId":status["hostId"],"serviceInstanceId":status["serviceInstanceId"]
            }),
        ));
        assert_eq!(
            success(waiter.join().unwrap())["wait"]["outcome"],
            "cancelled"
        );
    });
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    assert_eq!(
        conn.query_row("SELECT closed FROM orchestration_mail_questions", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn cancelled_addressee_closes_coordinator_question() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let scope = setup(&engine);
    seed_worker(&engine, dir.path(), &scope, "dispatch-cancel");
    let first = success(call(
        &engine,
        "orchestration.ask",
        "initial",
        json!({
            "scope":scope,"intent":"new","question":"Still there?","to":{"kind":"dispatch","dispatchId":"dispatch-cancel"},"wait":{"timeoutMs":1}
        }),
    ));
    success(call(
        &engine,
        "orchestration.workerAbandon",
        "abandon",
        json!({
            "contractVersion":1,"hostId":scope["hostId"],"runId":scope["runId"],
            "coordinatorId":"owner","consumerGeneration":1,"dispatchId":"dispatch-cancel"
        }),
    ));
    let result = success(call(
        &engine,
        "orchestration.ask",
        "resume",
        json!({
            "scope":scope,"intent":"resume","questionMessageId":first["questionMessageId"],"wait":{"timeoutMs":1}
        }),
    ));
    assert_eq!(result["wait"]["outcome"], "cancelled");
}
