//! Launch and replay probes: fresh launch identity/private context, replay
//! idempotency, payload conflicts and active-attempt refusal.

use crate::harness::*;
use drogon_core::Engine;
use serde_json::json;

pub fn fresh_launch_context(env: &ProbeEnv) {
    let engine = Engine::open(&env.data_dir).expect("engine open");
    let engine = engine.with_worker_cli(&env.cli).expect("worker cli");
    let (_host, run_id, task_id) = env.prepare(&engine, "fl", "fresh launch");
    let worker = fresh_worker(env, &engine, &run_id, &task_id, "start-fresh-1");

    // Exact identity and the assignment/readiness axes, distinct from liveness.
    assert_eq!(worker.assignment_state, "ready");
    assert_eq!(worker.readiness, "notObserved");
    assert_eq!(worker.process_verdict, "live");
    let show = env.worker_show(&engine, &run_id, &worker.dispatch_id, "show-fresh");
    assert_eq!(show["processVerdict"], json!("live"));
    assert_eq!(
        show["sessionIdentity"]["sessionId"],
        json!(worker.session_id)
    );
    assert_eq!(
        show["sessionIdentity"]["incarnation"],
        json!(worker.incarnation)
    );

    // The probe actually used the fixture harness, not an installed model CLI.
    // macOS /var vs /private/var: compare canonicalized paths.
    let dump = completed_env_dump(env);
    let canonical_dir =
        std::fs::canonicalize(env.data_dir.parent().expect("fixture dir")).expect("canonicalize");
    assert!(
        dump.contains(&format!(
            "self_path={}",
            canonical_dir.join("claude").display()
        )),
        "probe did not run the fixture harness:\n{dump}"
    );

    // Private worker context: presence booleans and a length only — the
    // capability value itself is never printed.
    for key in [
        "DROGON_DISPATCH_CAPABILITY",
        "DROGON_RUN_ID",
        "DROGON_TASK_ID",
        "DROGON_DISPATCH_ID",
        "DROGON_HOST_ID",
        "DROGON_SESSION_ID",
        "DROGON_SESSION_INCARNATION",
        "DROGON_DATA_DIR",
        "DROGON_CLI_COMMAND",
    ] {
        assert!(
            dump.contains(&format!("{key}=present")),
            "worker env missing {key}:\n{dump}"
        );
    }
    assert!(
        dump.contains("capability_is_bogus=no"),
        "inherited bogus capability was not replaced:\n{dump}"
    );
    assert!(
        dump.contains("capability_len=64"),
        "capability must be the 64-hex service secret (length 64):\n{dump}"
    );
    let capability = capability_value(env);
    assert!(
        capability.len() == 64 && capability.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "minted credential must contain exactly 64 ASCII hex bytes"
    );
    use sha2::Digest as _;
    let digest = format!("{:x}", sha2::Sha256::digest(capability.as_bytes()));
    let conn = rusqlite::Connection::open(env.data_dir.join(drogon_core::DB_FILE_NAME)).unwrap();
    let matches: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM orchestration_dispatch_credentials WHERE digest=?1 AND dispatch_id=?2 AND session_id=?3 AND incarnation=?4 AND revoked=0)",
        rusqlite::params![digest,worker.dispatch_id,worker.session_id,worker.incarnation],
        |row| row.get(0),
    ).unwrap();
    assert!(
        matches,
        "persisted digest must bind the actual private credential and exact session"
    );

    // Inherited Orca/admin controls must be removed from the private context.
    assert!(
        dump.contains("ORCA_TERMINAL_HANDLE=absent"),
        "inherited ORCA_TERMINAL_HANDLE leaked into the private worker environment:\n{dump}"
    );
    assert!(
        dump.contains("DROGON_ADMIN_SENTINEL=absent")
            && dump.contains("ORCA_ADMIN_SENTINEL=absent"),
        "inherited admin/Orca sentinel leaked into the private worker environment:\n{dump}"
    );
}

pub fn replay_and_conflicts(env: &ProbeEnv) {
    let engine = Engine::open(&env.data_dir).expect("engine open");
    let engine = engine.with_worker_cli(&env.cli).expect("worker cli");
    let (_host, run_id, task_id) = env.prepare(&engine, "rp", "replay");
    let start = |rid: &str| env.start_worker(&engine, &run_id, &task_id, None, rid);

    let response = start("replay-op-1");
    assert!(response.ok, "{:?}", response.error);
    let first = started(&response.result.unwrap());
    wait_for_pid_count(env, 1);

    // Sequential replay: the saved receipt returns without a second launch.
    let replayed = start("replay-op-1");
    assert!(replayed.ok, "{:?}", replayed.error);
    assert_eq!(
        replayed.result.unwrap()["dispatchId"],
        json!(first.dispatch_id)
    );
    wait_for_pid_count(env, 1);

    // Concurrent callers recover the same already-committed receipt.
    std::thread::scope(|scope| {
        for _ in 0..2 {
            let engine = &engine;
            let run_id = &run_id;
            let task_id = &task_id;
            scope.spawn(move || {
                let params = json!({
                    "contractVersion": 1, "hostId": env.host_id(engine), "runId": run_id,
                    "coordinatorId": "coord-test-1", "consumerGeneration": 1,
                    "taskId": task_id,
                    "workspaceId": env.workspace_id(engine),
                    "mode": "fresh",
                    "launch": {
                        "harnessId": "claude", "model": "fixture-model",
                        "permissionMode": "unattended"
                    }
                });
                let response =
                    engine.dispatch(request("replay-op-1", "orchestration.workerStart", params));
                assert!(
                    response.ok,
                    "concurrent replay failed: {:?}",
                    response.error
                );
            });
        }
    });
    wait_for_pid_count(env, 1);

    // Changed payload on the same request id is a conflict, not an effect.
    let changed = json!({
        "contractVersion": 1, "hostId": env.host_id(&engine), "runId": run_id,
        "coordinatorId": "coord-test-1", "consumerGeneration": 1,
        "taskId": task_id,
        "workspaceId": env.workspace_id(&engine),
        "mode": "fresh",
        "launch": {
            "harnessId": "claude", "model": "a-different-model",
            "permissionMode": "unattended"
        }
    });
    let conflicted = engine.dispatch(request("replay-op-1", "orchestration.workerStart", changed));
    assert_eq!(err_code(&conflicted), "request_conflict");
    wait_for_pid_count(env, 1);

    // A second active attempt on the same task refuses without a new child.
    // (The task is dispatched, so admission refuses before the attempt fence;
    // the exact code is the engine's task_not_ready/attempt_active family.)
    let refused = env.start_worker(&engine, &run_id, &task_id, None, "second-active");
    let code = err_code(&refused);
    assert!(
        matches!(
            code.as_str(),
            "task_not_ready" | "attempt_active" | "retry_required"
        ),
        "second active attempt must refuse, got {code}: {refused:?}"
    );
    wait_for_pid_count(env, 1);
    assert_eq!(
        recorded_pids(&pid_dir(env)).len(),
        1,
        "no replay or refusal may spawn twice"
    );
}
