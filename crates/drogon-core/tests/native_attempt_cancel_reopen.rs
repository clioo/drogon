//! V1 historic-attempt cancellation, concurrent-cancel serialization and
//! attempt reopen/rollback, verified through the public engine seams only
//! (`Engine::open` + `with_worker_cli` + `dispatch` /
//! `dispatch_authenticated` against real SQLite and real PTYs).
//!
//! The fixture harness is the SHARED V1 harness
//! (`native_worker_lifecycle/harness.rs`, included by path) so both V1 test
//! scopes use the one narrow three-valued liveness observer and the same
//! cooperative cleanup/timeout ordering; this file adds only its own probe
//! entry, scope-specific helpers and controlled fixture error-path tests.
//! Cleanup stays cooperative (stop marker, bounded self-expiry, read-only
//! `kill -0` observation with only proven ESRCH counting as exit, no
//! discovered-PID signaling, fixtures preserved whenever the outcome is
//! unverifiable).

#![cfg(unix)]

#[path = "native_worker_lifecycle/harness.rs"]
mod harness;

use std::process::Command;
use std::time::Duration;

use drogon_core::Engine;
use drogon_protocol::Response;
use serde_json::json;

use harness::{
    Fixture, Liveness, ProbeEnv, Started, StopMarkerGuard, capability_value, classify_kill_output,
    err_code, fresh_worker, liveness_probe, observe_liveness, ok, pid_dir, recorded_pids, request,
    started, wait_for_pid_count,
};

/// Admits the first worker, stops it (settled stop: attempt `stopped`, task
/// `blocked`, child signalled to cooperative exit).
fn stopped_worker(
    env: &ProbeEnv,
    engine: &Engine,
    run_id: &str,
    task_id: &str,
    tag: &str,
) -> Started {
    let worker = fresh_worker(env, engine, run_id, task_id, &format!("start-{tag}"));
    let _ = ok(
        engine,
        &format!("stop-{tag}"),
        "orchestration.workerStop",
        {
            let mut scope = env.scope(engine, run_id, 1);
            scope["dispatchId"] = json!(worker.dispatch_id);
            scope
        },
    );
    let scope = env.scope(engine, run_id, 1);
    harness::wait_for_exit(engine, &scope, &worker.dispatch_id);
    worker
}

fn task_status(env: &ProbeEnv, engine: &Engine, run_id: &str, task_id: &str, id: &str) -> String {
    ok(engine, id, "orchestration.taskShow", {
        let mut scope = env.scope(engine, run_id, 1);
        scope["taskId"] = json!(task_id);
        scope
    })["task"]["status"]
        .as_str()
        .expect("task status")
        .to_string()
}

/// The exact actor identity a final report binds to.
struct AttemptIds<'a> {
    host: &'a str,
    run_id: &'a str,
    task_id: &'a str,
    dispatch_id: &'a str,
}

/// Settles the worker's own attempt with an authenticated final report
/// (kind `finalReport` binds the report to the exact sending dispatch).
fn settle(
    env: &ProbeEnv,
    engine: &Engine,
    ids: AttemptIds,
    outcome: &str,
    request_id: &str,
) -> Response {
    let capability = capability_value(env);
    let mut request = request(
        request_id,
        "orchestration.send",
        json!({
            "scope": {"actorKind":"dispatch","contractVersion":1,
                      "hostId":ids.host, "runId":ids.run_id,
                      "taskId":ids.task_id, "dispatchId":ids.dispatch_id},
            "kind": "finalReport",
            "subject": "probe final report",
            "finalReport": {"outcome": outcome}
        }),
    );
    request.auth = Some(capability);
    engine.dispatch_authenticated(request, "")
}

fn db(env: &ProbeEnv) -> rusqlite::Connection {
    rusqlite::Connection::open(env.data_dir.join(drogon_core::DB_FILE_NAME))
        .expect("open engine database")
}

/// Exact attempt-row projection used for before/after mutation comparisons.
fn attempt_row(conn: &rusqlite::Connection, dispatch_id: &str) -> (bool, bool, String) {
    conn.query_row(
        "SELECT is_current, fenced, state_json FROM orchestration_attempts WHERE dispatch_id=?1",
        [dispatch_id],
        |row| {
            Ok((
                row.get::<_, bool>(0)?,
                row.get::<_, bool>(1)?,
                row.get::<_, String>(2)?,
            ))
        },
    )
    .expect("attempt row")
}

fn count(conn: &rusqlite::Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
        row.get(0)
    })
    .expect("row count")
}

// ---------------------------------------------------------------------------
// Controlled fixture error-path tests (shared-harness semantics).
// ---------------------------------------------------------------------------

/// The liveness mapping is exact: only a proven ESRCH ("No such process")
/// counts as exited; success is live; permission errors, usage errors and
/// anything else stay unverifiable so cleanup never deletes fixtures on an
/// unproven outcome.
#[test]
fn liveness_observer_counts_only_proven_esrch_as_exit() {
    assert_eq!(classify_kill_output(true, ""), Liveness::Live);
    assert_eq!(
        classify_kill_output(false, "kill: (1234) - No such process"),
        Liveness::Exited
    );
    assert_eq!(
        classify_kill_output(false, "no such process"),
        Liveness::Exited
    );
    assert_eq!(
        classify_kill_output(false, "kill: pid 1: Operation not permitted"),
        Liveness::Unverifiable
    );
    assert_eq!(classify_kill_output(false, ""), Liveness::Unverifiable);
    assert_eq!(
        classify_kill_output(false, "kill: illegal option -- z"),
        Liveness::Unverifiable
    );
    // The real observer agrees for a real process that exists (this test's
    // own pid is never > 1 in a place where ESRCH could be plausible) and
    // never signals anything beyond signal 0.
    let self_pid = std::process::id() as i32;
    assert!(self_pid > 1);
    assert_eq!(observe_liveness(self_pid), Liveness::Live);
}

/// Cleanup is honest about outcomes: while an owned child is provably live
/// the fixture tree is PRESERVED (bounded Err, no deletion); once the child
/// proves its exit the same cleanup removes the fixtures.
#[test]
fn cleanup_preserves_fixtures_while_a_child_is_live_and_cleans_after_proven_exit() {
    let fixture = Fixture::new("lp");
    let release = fixture.dir.join("release-liveness-test");
    let _guard = ReleaseGuard(release.clone());
    let mut child = Command::new("/bin/sh")
        .arg("-c")
        .arg("while [ ! -f \"$RELEASE\" ]; do sleep 0.1; done")
        .env("RELEASE", &release)
        .stdin(std::process::Stdio::null())
        .spawn()
        .expect("spawn owned blocking fixture child");

    // Record the child exactly the way the fixture harness does.
    use std::io::Write as _;
    let mut pid_log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(fixture.dir.join("pid-log"))
        .expect("open pid log");
    writeln!(pid_log, "{}", child.id()).expect("record owned child pid");
    drop(pid_log);
    assert_eq!(recorded_pids(&fixture.dir), vec![child.id() as i32]);
    assert!(observe_liveness(child.id() as i32) == Liveness::Live);

    // Provably live: bounded cleanup refuses and PRESERVES the fixture tree.
    let preserved = fixture
        .try_cleanup_within(Duration::from_millis(600))
        .expect_err("cleanup must not finish while a child is provably live");
    assert!(
        preserved.contains("provably live"),
        "unexpected refusal reason: {preserved}"
    );
    assert!(fixture.dir.is_dir(), "fixtures must be preserved");

    // Prove the exit (exact owned handle: cooperative release, then reap).
    std::fs::write(&release, b"1").expect("release owned fixture child");
    child.wait().expect("reap owned fixture child");

    // Now the outcome is proven and the same cleanup removes the fixtures.
    fixture
        .try_cleanup_within(Duration::from_secs(10))
        .expect("cleanup must succeed once every child proved its exit");
    assert!(!fixture.dir.exists(), "fixtures removed after proven exit");
}

/// Writes the release file even on an assertion failure inside the test, so
/// the owned blocking child can never outlive this test.
struct ReleaseGuard(std::path::PathBuf);

impl Drop for ReleaseGuard {
    fn drop(&mut self) {
        let _ = std::fs::write(&self.0, b"1");
    }
}

// ---------------------------------------------------------------------------
// Probes (public engine seams only).
// ---------------------------------------------------------------------------

/// A settled (final-reported) attempt is historic: new-request stop/abandon
/// must refuse with `attempt_settled` and leave every stored fact unchanged
/// (unit anchor: `stop_cannot_overwrite_a_final_report`).
fn settled_cancel_refused(env: &ProbeEnv) {
    let engine = Engine::open(&env.data_dir).expect("engine open");
    let engine = engine.with_worker_cli(&env.cli).expect("worker cli");
    let (host, run_id, task_id) = env.prepare(&engine, "sc", "settled cancel");
    let worker = fresh_worker(env, &engine, &run_id, &task_id, "start-sc-1");

    // The worker settles its own attempt; the task completes.
    let report = settle(
        env,
        &engine,
        AttemptIds {
            host: &host,
            run_id: &run_id,
            task_id: &task_id,
            dispatch_id: &worker.dispatch_id,
        },
        "succeeded",
        "report-sc-1",
    );
    assert!(report.ok, "final report must settle: {:?}", report.error);
    assert_eq!(
        report.result.unwrap()["lifecycle"]["outcome"],
        json!("succeeded")
    );
    assert_eq!(
        task_status(env, &engine, &run_id, &task_id, "task-sc"),
        "completed"
    );
    let settled_show = env.worker_show(&engine, &run_id, &worker.dispatch_id, "show-sc");
    assert_eq!(settled_show["assignmentState"], json!("completed"));

    // The historic snapshot every cancelled write must leave untouched.
    let conn = db(env);
    let before = attempt_row(&conn, &worker.dispatch_id);
    let requests_before = count(&conn, "requests");
    let attempts_before = count(&conn, "orchestration_attempts");
    drop(conn);

    // Both cancellation verbs refuse the settled attempt.
    let stop = engine.dispatch(request("stop-sc-late", "orchestration.workerStop", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["dispatchId"] = json!(worker.dispatch_id);
        scope
    }));
    assert_eq!(
        err_code(&stop),
        "attempt_settled",
        "stop of a settled attempt must refuse: {stop:?}"
    );
    let abandon = engine.dispatch(request("abandon-sc-late", "orchestration.workerAbandon", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["dispatchId"] = json!(worker.dispatch_id);
        scope["reason"] = json!("probe");
        scope
    }));
    assert_eq!(
        err_code(&abandon),
        "attempt_settled",
        "abandon of a settled attempt must refuse: {abandon:?}"
    );

    // No mutation of the attempt: row bytes, task status, worker projection.
    // The request ledger legitimately records each refusal as a durable
    // failure receipt — exactly one per refused call, none left pending.
    let conn = db(env);
    assert_eq!(attempt_row(&conn, &worker.dispatch_id), before);
    assert_eq!(
        count(&conn, "requests"),
        requests_before + 2,
        "each refused cancellation records exactly one failure receipt"
    );
    let pending: i64 = conn
        .query_row(
            "SELECT count(*) FROM requests WHERE request_id IN ('stop-sc-late','abandon-sc-late') AND status='pending'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(pending, 0, "refused calls are not pending launch authority");
    assert_eq!(count(&conn, "orchestration_attempts"), attempts_before);
    drop(conn);
    assert_eq!(
        task_status(env, &engine, &run_id, &task_id, "task-sc-after"),
        "completed"
    );
    let after_show = env.worker_show(&engine, &run_id, &worker.dispatch_id, "show-sc-after");
    assert_eq!(after_show, settled_show);
}

/// Two simultaneous cancellation requests serialize on the dispatch operation
/// lock: the state transitions exactly once, exactly one response signals the
/// owned process, and the loser observes an idempotent no-op fence.
fn concurrent_cancel_single_winner(env: &ProbeEnv) {
    let engine = Engine::open(&env.data_dir).expect("engine open");
    let engine = engine.with_worker_cli(&env.cli).expect("worker cli");
    let (_host, run_id, task_id) = env.prepare(&engine, "cc", "concurrent cancel");
    let worker = fresh_worker(env, &engine, &run_id, &task_id, "start-cc-1");
    wait_for_pid_count(env, 1);

    let results: Vec<Response> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..2)
            .map(|index| {
                let engine = &engine;
                let run_id = &run_id;
                let dispatch_id = worker.dispatch_id.clone();
                scope.spawn(move || {
                    let mut params = json!({
                        "contractVersion": 1, "hostId": "",
                        "runId": run_id, "coordinatorId": "coord-test-1",
                        "consumerGeneration": 1,
                    });
                    params["hostId"] =
                        ok(engine, "status-cc", "status", json!({}))["hostId"].clone();
                    params["dispatchId"] = json!(dispatch_id);
                    engine.dispatch(request(
                        &format!("stop-cc-{index}"),
                        "orchestration.workerStop",
                        params,
                    ))
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|handle| handle.join().expect("join"))
            .collect()
    });

    // Both requests are admitted (the fence is idempotent), but exactly one
    // of them performed the transition and signalled the owned process.
    let mut signalled = 0;
    for response in &results {
        assert!(response.ok, "concurrent stop failed: {:?}", response.error);
        let result = response.result.as_ref().unwrap();
        assert_eq!(result["assignmentState"], json!("stopped"));
        if result["processAction"] == json!("signalled") {
            signalled += 1;
        }
    }
    assert_eq!(
        signalled, 1,
        "exactly one concurrent cancel may signal: {results:?}"
    );

    let scope = env.scope(&engine, &run_id, 1);
    harness::wait_for_exit(&engine, &scope, &worker.dispatch_id);
    assert_eq!(
        task_status(env, &engine, &run_id, &task_id, "task-cc"),
        "blocked",
        "the task transitions to blocked exactly once"
    );
    let conn = db(env);
    assert_eq!(count(&conn, "orchestration_attempts"), 1);
    drop(conn);
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(
        recorded_pids(&pid_dir(env)).len(),
        1,
        "no cancel may launch or respawn a process"
    );
}

/// A replacement admission that rolls back restores the failed attempt's
/// pre-retry authority and state: the fenced flip is transactional with the
/// replacement insert (unit anchor:
/// `rolled_back_replacement_restores_prior_authority_and_history`).
fn failed_retry_rollback_restores_state(env: &ProbeEnv) {
    let engine = Engine::open(&env.data_dir).expect("engine open");
    let engine = engine.with_worker_cli(&env.cli).expect("worker cli");
    let (_host, run_id, task_id) = env.prepare(&engine, "rb", "retry rollback");
    let first = stopped_worker(env, &engine, &run_id, &task_id, "rb-1");

    let conn = db(env);
    let before = attempt_row(&conn, &first.dispatch_id);
    let attempts_before = count(&conn, "orchestration_attempts");
    let sessions_before = count(&conn, "sessions");
    let credentials_before = count(&conn, "orchestration_dispatch_credentials");
    drop(conn);
    assert_eq!(
        task_status(env, &engine, &run_id, &task_id, "task-rb-before"),
        "blocked"
    );

    // Deterministic public-seam fault: abort exactly the replacement attempt
    // INSERT (retry_of is only set on replacements), which sits before the
    // task-status write and the child spawn in the admission transaction.
    let conn = db(env);
    conn.execute_batch(
        "CREATE TRIGGER inject_retry_admit_failure \
         BEFORE INSERT ON orchestration_attempts WHEN NEW.retry_of IS NOT NULL \
         BEGIN SELECT RAISE(ABORT, 'injected retry admit failure'); END;",
    )
    .expect("create trigger");
    drop(conn);

    let rolled_back = env.start_worker(
        &engine,
        &run_id,
        &task_id,
        Some(&first.dispatch_id),
        "start-rb-2",
    );
    assert!(
        !rolled_back.ok,
        "the faulted replacement admission must fail and roll back: {rolled_back:?}"
    );

    let conn = db(env);
    assert_eq!(
        attempt_row(&conn, &first.dispatch_id),
        before,
        "the failed attempt must keep its exact pre-retry row (current+unfenced authority)"
    );
    assert_eq!(count(&conn, "orchestration_attempts"), attempts_before);
    assert_eq!(count(&conn, "sessions"), sessions_before);
    assert_eq!(
        count(&conn, "orchestration_dispatch_credentials"),
        credentials_before
    );
    drop(conn);
    assert_eq!(
        task_status(env, &engine, &run_id, &task_id, "task-rb-after"),
        "blocked",
        "the task keeps its pre-retry status"
    );
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(
        recorded_pids(&pid_dir(env)).len(),
        1,
        "a rolled-back admission must never spawn"
    );
    let _ = ok(&engine, "show-rb-old", "orchestration.workerShow", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["dispatchId"] = json!(first.dispatch_id);
        scope
    });
}

/// After the rolled-back retry, reopening the same failed attempt succeeds
/// with a fresh attempt identity while the prior attempt stays in history,
/// exactly as its row was recorded.
fn reopen_after_rollback_preserves_history(env: &ProbeEnv) {
    let engine = Engine::open(&env.data_dir).expect("engine open");
    let engine = engine.with_worker_cli(&env.cli).expect("worker cli");
    let (_host, run_id, task_id) = env.prepare(&engine, "ro", "reopen");
    let first = stopped_worker(env, &engine, &run_id, &task_id, "ro-1");
    let conn = db(env);
    let historic_row = attempt_row(&conn, &first.dispatch_id);
    drop(conn);

    let conn = db(env);
    conn.execute_batch(
        "CREATE TRIGGER inject_retry_admit_failure \
         BEFORE INSERT ON orchestration_attempts WHEN NEW.retry_of IS NOT NULL \
         BEGIN SELECT RAISE(ABORT, 'injected retry admit failure'); END;",
    )
    .expect("create trigger");
    drop(conn);
    let rolled_back = env.start_worker(
        &engine,
        &run_id,
        &task_id,
        Some(&first.dispatch_id),
        "start-ro-2",
    );
    assert!(!rolled_back.ok, "the faulted retry must roll back");
    let conn = db(env);
    let attempts_after_rollback = count(&conn, "orchestration_attempts");
    drop(conn);
    assert_eq!(attempts_after_rollback, 1);

    // Reopen: the same retry without the fault yields a NEW attempt identity.
    let conn = db(env);
    conn.execute_batch("DROP TRIGGER inject_retry_admit_failure;")
        .expect("drop trigger");
    drop(conn);
    let reopened = env.start_worker(
        &engine,
        &run_id,
        &task_id,
        Some(&first.dispatch_id),
        "start-ro-3",
    );
    assert!(
        reopened.ok,
        "reopen must admit a replacement: {:?}",
        reopened.error
    );
    let replacement = started(&reopened.result.unwrap());
    assert_ne!(
        replacement.dispatch_id, first.dispatch_id,
        "reopen yields a new attempt id"
    );
    assert_ne!(
        replacement.session_id, first.session_id,
        "reopen yields a distinct session"
    );
    assert_eq!(
        task_status(env, &engine, &run_id, &task_id, "task-ro"),
        "dispatched",
        "the task is dispatched again"
    );

    // Prior history preserved: the historic row keeps its exact state_json
    // with the fenced/current flags now pointing at the replacement.
    let conn = db(env);
    assert_eq!(count(&conn, "orchestration_attempts"), 2);
    let (current, fenced, state_json) = attempt_row(&conn, &first.dispatch_id);
    assert!(
        !current && fenced,
        "the historic attempt stays fenced history"
    );
    assert_eq!(
        state_json, historic_row.2,
        "the historic attempt's stored state is untouched"
    );
    let retry_of: String = conn
        .query_row(
            "SELECT retry_of FROM orchestration_attempts WHERE dispatch_id=?1",
            [replacement.dispatch_id.as_str()],
            |row| row.get(0),
        )
        .expect("replacement row");
    assert_eq!(retry_of, first.dispatch_id, "history keeps the retry link");
    let (r_current, r_fenced, _) = attempt_row(&conn, &replacement.dispatch_id);
    assert!(
        r_current && !r_fenced,
        "only the replacement is authoritative"
    );
    drop(conn);

    // Both attempts remain inspectable through the public seam.
    let historic_show = ok(&engine, "show-ro-old", "orchestration.workerShow", {
        let mut scope = env.scope(&engine, &run_id, 1);
        scope["dispatchId"] = json!(first.dispatch_id);
        scope
    });
    assert_eq!(historic_show["assignmentState"], json!("stopped"));
    let replacement_show =
        env.worker_show(&engine, &run_id, &replacement.dispatch_id, "show-ro-new");
    assert_eq!(replacement_show["assignmentState"], json!("ready"));
    wait_for_pid_count(env, 2);
    let pids = recorded_pids(&pid_dir(env));
    assert!(
        liveness_probe(pids[1]),
        "the reopened attempt owns its live child"
    );
}

// ---------------------------------------------------------------------------
// Parent tests + inner probe entry.
// ---------------------------------------------------------------------------

#[test]
fn cancel_of_a_settled_attempt_is_refused_without_mutating_state() {
    let fixture = Fixture::new("sc");
    let run = fixture.run_using("native_cancel_reopen_probe_entry", "settled_cancel_refused");
    assert_eq!(
        run.exit_code, 0,
        "stdout:\n{}\nstderr:\n{}",
        run.stdout, run.stderr
    );
}

#[test]
fn concurrent_cancels_serialize_with_exactly_one_signalling_winner() {
    let fixture = Fixture::new("cc");
    let run = fixture.run_using(
        "native_cancel_reopen_probe_entry",
        "concurrent_cancel_single_winner",
    );
    assert_eq!(
        run.exit_code, 0,
        "stdout:\n{}\nstderr:\n{}",
        run.stdout, run.stderr
    );
}

#[test]
fn rolled_back_replacement_admission_restores_the_failed_attempt_state() {
    let fixture = Fixture::new("rb");
    let run = fixture.run_using(
        "native_cancel_reopen_probe_entry",
        "failed_retry_rollback_restores_state",
    );
    assert_eq!(
        run.exit_code, 0,
        "stdout:\n{}\nstderr:\n{}",
        run.stdout, run.stderr
    );
}

#[test]
fn reopen_after_rollback_yields_a_new_attempt_with_history_preserved() {
    let fixture = Fixture::new("ro");
    let run = fixture.run_using(
        "native_cancel_reopen_probe_entry",
        "reopen_after_rollback_preserves_history",
    );
    assert_eq!(
        run.exit_code, 0,
        "stdout:\n{}\nstderr:\n{}",
        run.stdout, run.stderr
    );
}

/// Inner entry: the parent re-executes this binary filtered to this test with
/// `NATIVE_PROBE` selecting exactly one probe.
#[test]
fn native_cancel_reopen_probe_entry() {
    let Ok(probe) = std::env::var("NATIVE_PROBE") else {
        return; // Ordinary suite run: the parent tests drive the probes.
    };
    let env = ProbeEnv::from_parent_env();
    let _guard = StopMarkerGuard::new(&env);
    match probe.as_str() {
        "settled_cancel_refused" => settled_cancel_refused(&env),
        "concurrent_cancel_single_winner" => concurrent_cancel_single_winner(&env),
        "failed_retry_rollback_restores_state" => failed_retry_rollback_restores_state(&env),
        "reopen_after_rollback_preserves_history" => reopen_after_rollback_preserves_history(&env),
        other => panic!("unknown probe {other}"),
    }
}
