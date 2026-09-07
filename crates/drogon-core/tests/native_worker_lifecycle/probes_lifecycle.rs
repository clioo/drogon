//! Stop, retry, abandon, release and reopen through real owned PTYs.

use crate::harness::*;
use base64::Engine as _;
use drogon_core::Engine;
use serde_json::json;

pub fn lifecycle_transitions(env: &ProbeEnv) {
    let engine = Engine::open(&env.data_dir).expect("engine open");
    let engine = engine.with_worker_cli(&env.cli).expect("worker cli");
    let (host, run_id, task_a) = env.prepare(&engine, "lc", "lifecycle");
    let extra_task = |id: &str, instructions: &str| {
        ok(
            &engine,
            id,
            "orchestration.taskCreate",
            json!({"contractVersion": 1, "hostId": host, "runId": run_id,
                   "coordinatorId": "coord-test-1", "consumerGeneration": 1,
                   "spec": {"instructions": instructions, "dependsOn": []}}),
        )["task"]["taskId"]
            .as_str()
            .unwrap()
            .to_string()
    };
    let task_b = extra_task("task-lc-b", "lifecycle b");
    let task_c = extra_task("task-lc-c", "lifecycle c");

    // (a) explicit stop fences, observes exit, and retryOf admits a distinct
    // attempt/session with the task dispatched again.
    let first = fresh_worker(env, &engine, &run_id, &task_a, "start-a1");
    let stop = ok(&engine, "stop-a1", "orchestration.workerStop", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["dispatchId"] = json!(first.dispatch_id);
        scope
    });
    assert_eq!(stop["processAction"], json!("signalled"));
    wait_for_exit(&engine, &env.scope(&engine, &run_id, 1), &first.dispatch_id);
    let blocked = ok(&engine, "show-task-a1", "orchestration.taskShow", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["taskId"] = json!(task_a);
        scope
    });
    assert_eq!(blocked["task"]["status"], json!("blocked"));
    let retry = env.start_worker(
        &engine,
        &run_id,
        &task_a,
        Some(&first.dispatch_id),
        "start-a2",
    );
    assert!(
        retry.ok,
        "retryOf must admit a replacement: {:?}",
        retry.error
    );
    let second = started(&retry.result.unwrap());
    assert_ne!(second.dispatch_id, first.dispatch_id, "distinct attempt");
    assert_ne!(second.session_id, first.session_id, "distinct session");
    let dispatched = ok(&engine, "show-task-a2", "orchestration.taskShow", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["taskId"] = json!(task_a);
        scope
    });
    assert_eq!(dispatched["task"]["status"], json!("dispatched"));

    wait_for_pid_count(env, 2);
    let show = env.worker_show(&engine, &run_id, &second.dispatch_id, "show-a2");
    assert_eq!(show["processVerdict"], json!("live"));
    let children = recorded_pids(&pid_dir(env));
    assert_eq!(children.len(), 2);
    assert!(
        liveness_probe(children[1]),
        "replacement child must remain live"
    );

    // (b) a real stop is exact: re-stopping the old (already exited) attempt
    // leaves task B's live session untouched.
    let b = fresh_worker(env, &engine, &run_id, &task_b, "start-b1");
    let _ = ok(&engine, "stop-a1-again", "orchestration.workerStop", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["dispatchId"] = json!(first.dispatch_id);
        scope
    });
    let b_show = env.worker_show(&engine, &run_id, &b.dispatch_id, "show-b1");
    assert_eq!(b_show["processVerdict"], json!("live"));

    // (c) abandon never signals: the process keeps running.
    let c = fresh_worker(env, &engine, &run_id, &task_c, "start-c1");
    let abandoned = ok(&engine, "abandon-c1", "orchestration.workerAbandon", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["dispatchId"] = json!(c.dispatch_id);
        scope["reason"] = json!("probe");
        scope
    });
    assert_eq!(abandoned["assignmentState"], json!("abandoned"));
    let c_show = env.worker_show(&engine, &run_id, &c.dispatch_id, "show-c1");
    assert_eq!(
        c_show["processVerdict"],
        json!("live"),
        "abandon must not signal"
    );
    let c_pid = recorded_pids(&pid_dir(env))
        .last()
        .copied()
        .expect("c child pid");
    assert!(liveness_probe(c_pid), "abandoned child must still run");

    // (d) release rejects the active attempt, then succeeds after a settled
    // stop, with the stopped session's ring output preserved.
    let active_release = engine.dispatch(request(
        "release-b-active",
        "orchestration.workerRelease",
        {
            let mut scope = env.scope(&engine, &run_id, 1);
            scope["dispatchId"] = json!(b.dispatch_id);
            scope
        },
    ));
    assert_eq!(err_code(&active_release), "attempt_active");
    let _ = ok(&engine, "stop-b1", "orchestration.workerStop", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["dispatchId"] = json!(b.dispatch_id);
        scope
    });
    let released = ok(&engine, "release-b1", "orchestration.workerRelease", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["dispatchId"] = json!(b.dispatch_id);
        scope
    });
    assert!(
        released["disposition"] == json!("released")
            || released["disposition"] == json!("unverifiable"),
        "disposition {}",
        released["disposition"]
    );
    let read = ok(
        &engine,
        "read-b1",
        "session.read",
        json!({"sessionId": b.session_id, "incarnation": b.incarnation, "cursor": 0}),
    );
    let decoded = String::from_utf8(
        base64::engine::general_purpose::STANDARD
            .decode(read["dataBase64"].as_str().unwrap_or_default())
            .unwrap_or_default(),
    )
    .unwrap_or_default();
    assert!(
        decoded.contains("worker-fixture-output"),
        "ring output must survive a settled stop+release: {decoded:?}"
    );
}

pub fn reopen_unverifiable(env: &ProbeEnv) {
    let engine = Engine::open(&env.data_dir).expect("engine open");
    let engine = engine.with_worker_cli(&env.cli).expect("worker cli");
    let (_host, run_id, task_id) = env.prepare(&engine, "ro", "reopen");
    let worker = fresh_worker(env, &engine, &run_id, &task_id, "start-ro-1");
    drop(engine);

    // Reopen loses every retained handle: the stored attempt stays, but the
    // missing handle must not become live evidence, and the CLI must neither
    // PID-kill nor respawn the lost child.
    let reopened = Engine::open(&env.data_dir).expect("reopen");
    let reopened = reopened.with_worker_cli(&env.cli).expect("worker cli");
    let show = env.worker_show(&reopened, &run_id, &worker.dispatch_id, "show-ro");
    assert_eq!(show["processVerdict"], json!("unverifiable"));
    wait_for_pid_count(env, 1);
    let pids = recorded_pids(&pid_dir(env));
    assert!(
        liveness_probe(pids[0]),
        "lost-handle child must not be PID-killed"
    );
    std::thread::sleep(std::time::Duration::from_millis(300));
    assert_eq!(recorded_pids(&pid_dir(env)).len(), 1, "no respawn");
}

pub fn foreign_identity_no_effect(env: &ProbeEnv) {
    let engine = Engine::open(&env.data_dir).expect("engine open");
    let engine = engine.with_worker_cli(&env.cli).expect("worker cli");
    let (_host, run_id, task_id) = env.prepare(&engine, "fx", "foreign");
    let worker = fresh_worker(env, &engine, &run_id, &task_id, "start-x1");
    // Stop/release naming a foreign run must do nothing to the live attempt.
    let mut foreign = env.scope(&engine, &run_id, 1);
    foreign["runId"] = json!("run-foreign");
    foreign["dispatchId"] = json!(worker.dispatch_id);
    let stop = engine.dispatch(request(
        "stop-foreign",
        "orchestration.workerStop",
        foreign.clone(),
    ));
    assert_eq!(err_code(&stop), "run_not_found");
    let release = engine.dispatch(request(
        "release-foreign",
        "orchestration.workerRelease",
        foreign,
    ));
    assert_eq!(err_code(&release), "run_not_found");
    let show = env.worker_show(&engine, &run_id, &worker.dispatch_id, "show-x1");
    assert_eq!(
        show["processVerdict"],
        json!("live"),
        "foreign operations must not touch it"
    );
    wait_for_pid_count(env, 1);
    let pids = recorded_pids(&pid_dir(env));
    assert!(liveness_probe(pids[0]));
}

/// An already-fenced attempt cannot regress its replacement to blocked.
pub fn old_attempt_stop_corruption(env: &ProbeEnv) {
    let engine = Engine::open(&env.data_dir).expect("engine open");
    let engine = engine.with_worker_cli(&env.cli).expect("worker cli");
    let (_host, run_id, task_id) = env.prepare(&engine, "cz", "corruption");
    let first = fresh_worker(env, &engine, &run_id, &task_id, "start-z1");
    let _ = ok(&engine, "stop-z1", "orchestration.workerStop", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["dispatchId"] = json!(first.dispatch_id);
        scope
    });
    let retry = env.start_worker(
        &engine,
        &run_id,
        &task_id,
        Some(&first.dispatch_id),
        "start-z2",
    );
    assert!(retry.ok, "{:?}", retry.error);
    let replacement = started(&retry.result.unwrap());
    wait_for_pid_count(env, 2);

    // NEW-request stop of the already-fenced OLD attempt must not touch the
    // replacement's task state or its live process.
    let _ = ok(&engine, "stop-z1-again", "orchestration.workerStop", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["dispatchId"] = json!(first.dispatch_id);
        scope
    });
    let task = ok(&engine, "task-z-after", "orchestration.taskShow", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["taskId"] = json!(task_id);
        scope
    });
    assert_eq!(
        task["task"]["status"],
        json!("dispatched"),
        "replacement must stay dispatched after an old-attempt stop"
    );
    let replacement_show = env.worker_show(&engine, &run_id, &replacement.dispatch_id, "show-z2");
    assert_eq!(replacement_show["processVerdict"], json!("live"));
}
