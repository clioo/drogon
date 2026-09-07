//! Deterministic receipt-fault probes: SQLite storage triggers (a public
//! storage seam) abort exactly one staged-ledger write per scenario.

use crate::harness::*;
use drogon_core::Engine;
use serde_json::json;

pub fn pending_insert_fault(env: &ProbeEnv) {
    let engine = Engine::open(&env.data_dir).expect("engine open");
    let engine = engine.with_worker_cli(&env.cli).expect("worker cli");
    let (_host, run_id, task_id) = env.prepare(&engine, "pf", "fault");
    // Deterministic public-seam fault: a storage trigger aborts exactly the
    // staged pending-receipt INSERT for workerStart, so admission rolls back.
    let conn =
        rusqlite::Connection::open(env.data_dir.join(drogon_core::DB_FILE_NAME)).expect("sqlite");
    conn.execute_batch(
        "CREATE TRIGGER inject_pending_insert_failure \
         BEFORE INSERT ON requests WHEN NEW.status='pending' \
         AND NEW.method='orchestration.workerStart' \
         BEGIN SELECT RAISE(ABORT, 'injected pending insert failure'); END;",
    )
    .expect("create trigger");
    let refused = env.start_worker(&engine, &run_id, &task_id, None, "faulted-start");
    assert!(!refused.ok, "faulted admission must fail");
    let missing = engine.dispatch(request("show-faulted", "orchestration.workerShow", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["dispatchId"] = json!("dispatch_nonexistent");
        scope
    }));
    assert_eq!(err_code(&missing), "not_found", "no attempt row may exist");
    for table in [
        "orchestration_attempts",
        "orchestration_dispatch_credentials",
        "sessions",
    ] {
        let count: i64 = conn
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0, "faulted admission left a row in {table}");
    }
    std::thread::sleep(std::time::Duration::from_millis(300));
    assert_eq!(recorded_pids(&pid_dir(env)).len(), 0, "no child may spawn");
    let task = ok(&engine, "task-f-after", "orchestration.taskShow", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["taskId"] = json!(task_id);
        scope
    });
    assert_eq!(
        task["task"]["status"],
        json!("ready"),
        "task must be untouched"
    );
    conn.execute_batch("DROP TRIGGER inject_pending_insert_failure;")
        .expect("drop trigger");
}

pub fn post_spawn_persist_fault(env: &ProbeEnv) {
    let engine = Engine::open(&env.data_dir).expect("engine open");
    let engine = engine.with_worker_cli(&env.cli).expect("worker cli");
    let (_host, run_id, task_id) = env.prepare(&engine, "pg", "postspawn");
    // Deterministic public-seam fault: abort the post-spawn liveness persist.
    // Admission is already committed, so the child must be retained and the
    // replay must not spawn a second process.
    let conn =
        rusqlite::Connection::open(env.data_dir.join(drogon_core::DB_FILE_NAME)).expect("sqlite");
    conn.execute_batch(
        "CREATE TRIGGER inject_session_persist_failure \
         BEFORE UPDATE OF verdict ON sessions WHEN NEW.verdict='live' \
         BEGIN SELECT RAISE(ABORT, 'injected session persist failure'); END;",
    )
    .expect("create trigger");
    let faulted = env.start_worker(&engine, &run_id, &task_id, None, "postspawn-start");
    assert!(
        faulted.ok,
        "a spawned worker must retain a structured recovery receipt: {:?}",
        faulted.error
    );
    let result = faulted.result.unwrap();
    assert_eq!(
        result["assignmentState"], "ready",
        "spawn acceptance is known despite the persistence warning"
    );
    assert!(
        result["warning"]
            .as_str()
            .unwrap()
            .contains("could not be persisted")
    );
    assert!(
        result["warning"]
            .as_str()
            .unwrap()
            .contains("does not prove prompt or model readiness")
    );
    let dispatch_id = result["dispatchId"]
        .as_str()
        .expect("admitted dispatch identity");
    assert!(result["sessionIdentity"]["sessionId"].is_string());
    let shown = env.worker_show(&engine, &run_id, dispatch_id, "postspawn-show");
    assert_eq!(
        shown["assignmentState"], "ready",
        "attempt must not remain admitting"
    );
    wait_for_pid_count(env, 1);
    let pids = recorded_pids(&pid_dir(env));
    assert!(liveness_probe(pids[0]), "retained child must be alive");

    // Replay of the same request must not repeat the spawn.
    let replayed = env.start_worker(&engine, &run_id, &task_id, None, "postspawn-start");
    assert!(
        replayed.ok,
        "replay must retain the structured launch receipt"
    );
    assert_eq!(replayed.result.unwrap(), result);
    std::thread::sleep(std::time::Duration::from_millis(300));
    assert_eq!(
        recorded_pids(&pid_dir(env)).len(),
        1,
        "replay must not launch a second process"
    );
    conn.execute_batch("DROP TRIGGER inject_session_persist_failure;")
        .expect("drop trigger");
}
