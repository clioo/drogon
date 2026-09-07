//! `runtime.shutdown` per `docs/migration/service-quiescence-contract.md`.
//! Real Engine, real SQLite file, real `portable-pty` children — no mocks of
//! missing product behavior. Unix-only, matching every other PTY-backed
//! integration test in this crate.
#![cfg(unix)]

use std::time::{Duration, Instant};

use drogon_core::{DB_FILE_NAME, Engine};
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

fn call(engine: &Engine, request_id: &str, method: &str, params: Value) -> Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: request_id.into(),
        auth: None,
        method: method.into(),
        params,
    })
}

fn ok(response: Response) -> Value {
    assert!(response.ok, "expected ok: {:?}", response.error);
    response.result.unwrap()
}

fn err_code(response: Response) -> String {
    assert!(response.error.is_some(), "expected error: {:?}", response);
    response.error.unwrap().code
}

fn status(engine: &Engine) -> Value {
    ok(call(engine, "status", "status", json!({})))
}

fn shutdown_params(status: &Value) -> Value {
    json!({
        "hostId": status["hostId"],
        "serviceInstanceId": status["serviceInstanceId"],
    })
}

fn register_workspace(engine: &Engine, dir: &std::path::Path, request_id: &str) -> String {
    let ws = ok(call(
        engine,
        request_id,
        "workspace.register",
        json!({"path": dir.to_string_lossy()}),
    ));
    ws["id"].as_str().unwrap().to_string()
}

fn wait_for<F: FnMut() -> bool>(mut pred: F, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if pred() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn method_is_registered_and_advertised_as_a_capability() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let status = status(&engine);
    assert!(
        status["capabilities"]
            .as_array()
            .unwrap()
            .contains(&json!("runtime.quiescent-shutdown.v1")),
        "the new capability must only be advertised once actually implemented"
    );
    assert!(
        status.get("processId").is_some(),
        "status must add optional processId for kernel-observer correlation"
    );
}

#[test]
fn empty_service_shutdown_is_accepted_and_freezes_further_admission() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let status = status(&engine);
    assert!(!engine.is_quiescent());

    let result = ok(call(
        &engine,
        "shutdown-1",
        "runtime.shutdown",
        shutdown_params(&status),
    ));
    assert_eq!(result["hostId"], status["hostId"]);
    assert_eq!(result["serviceInstanceId"], status["serviceInstanceId"]);
    assert_eq!(result["accepted"], true);
    assert!(
        engine.is_quiescent(),
        "a durably accepted receipt must freeze admission"
    );

    // "Freeze new mutations once shutdown admission is durable."
    let refused = err_code(call(
        &engine,
        "after-shutdown",
        "workspace.register",
        json!({"path": dir.path().to_string_lossy()}),
    ));
    assert_eq!(refused, "runtime_busy");
}

#[test]
fn wrong_host_is_unsupported_host_and_never_admits() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let status = status(&engine);
    let code = err_code(call(
        &engine,
        "bad-host",
        "runtime.shutdown",
        json!({"hostId": "not-this-host", "serviceInstanceId": status["serviceInstanceId"]}),
    ));
    assert_eq!(code, "unsupported_host");
    assert!(!engine.is_quiescent());
}

#[test]
fn stale_instance_is_stale_incarnation_and_never_admits() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let status = status(&engine);
    let code = err_code(call(
        &engine,
        "bad-instance",
        "runtime.shutdown",
        json!({"hostId": status["hostId"], "serviceInstanceId": "not-this-instance"}),
    ));
    assert_eq!(code, "stale_incarnation");
    assert!(!engine.is_quiescent());
}

#[test]
fn missing_fence_fields_are_invalid_argument() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let status = status(&engine);
    assert_eq!(
        err_code(call(
            &engine,
            "no-host",
            "runtime.shutdown",
            json!({"serviceInstanceId": status["serviceInstanceId"]})
        )),
        "invalid_argument"
    );
    assert_eq!(
        err_code(call(
            &engine,
            "no-instance",
            "runtime.shutdown",
            json!({"hostId": status["hostId"]})
        )),
        "invalid_argument"
    );
}

#[test]
fn a_live_child_refuses_shutdown_with_runtime_busy_and_stays_live() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let status = status(&engine);
    let workspace = register_workspace(&engine, dir.path(), "ws");
    let session = ok(call(
        &engine,
        "start",
        "session.start",
        json!({"workspaceId": workspace, "command": "/bin/sh", "args": ["-c", "sleep 5"]}),
    ));

    let code = err_code(call(
        &engine,
        "shutdown-busy",
        "runtime.shutdown",
        shutdown_params(&status),
    ));
    assert_eq!(code, "runtime_busy");
    assert!(!engine.is_quiescent());

    let listed = ok(call(&engine, "list", "session.list", json!({})));
    assert_eq!(
        listed["sessions"][0]["verdict"], "live",
        "a refused shutdown must never stop the session on the caller's behalf"
    );

    let stopped = ok(call(
        &engine,
        "stop",
        "session.stop",
        json!({"sessionId": session["id"], "incarnation": session["incarnation"]}),
    ));
    assert_eq!(stopped["verdict"], "exited");

    let accepted = ok(call(
        &engine,
        "shutdown-after-exit",
        "runtime.shutdown",
        shutdown_params(&status),
    ));
    assert_eq!(accepted["accepted"], true);
}

#[test]
fn a_pending_row_refuses_shutdown() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let status = status(&engine);
    let db = rusqlite::Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
    db.execute(
        "INSERT INTO sessions (id, workspace_id, host_id, incarnation, command, args_json, cols, rows, verdict, exit_code, created_at) \
         VALUES ('fixture-pending', 'ws', 'host', 'inc', '/bin/sh', '[]', 80, 24, 'pending', NULL, '2026-01-01T00:00:00Z')",
        [],
    )
    .unwrap();

    let code = err_code(call(
        &engine,
        "shutdown-pending",
        "runtime.shutdown",
        shutdown_params(&status),
    ));
    assert_eq!(code, "runtime_busy");
    assert!(!engine.is_quiescent());
}

#[test]
fn a_recovered_unverifiable_row_refuses_shutdown() {
    let dir = tempfile::tempdir().unwrap();
    {
        // Simulate a session a prior instance believed live, with no
        // retained in-process handle here at all.
        let engine = Engine::open(dir.path()).unwrap();
        let db = rusqlite::Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
        db.execute(
            "INSERT INTO sessions (id, workspace_id, host_id, incarnation, command, args_json, cols, rows, verdict, exit_code, created_at) \
             VALUES ('fixture-live', 'ws', 'host', 'inc', '/bin/sh', '[]', 80, 24, 'live', NULL, '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        drop(engine);
    }
    // A fresh Engine::open runs `recover_from_prior_instance`, turning the
    // orphaned `live` row into `unverifiable` per protocol-v1.md.
    let engine = Engine::open(dir.path()).unwrap();
    let listed = ok(call(&engine, "list", "session.list", json!({})));
    assert_eq!(listed["sessions"][0]["verdict"], "unverifiable");

    let status = status(&engine);
    let code = err_code(call(
        &engine,
        "shutdown-unverifiable",
        "runtime.shutdown",
        shutdown_params(&status),
    ));
    assert_eq!(code, "runtime_busy");
    assert!(!engine.is_quiescent());
}

#[test]
fn duplicate_request_id_replays_the_same_result() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let status = status(&engine);
    let first = ok(call(
        &engine,
        "dup",
        "runtime.shutdown",
        shutdown_params(&status),
    ));
    let second = ok(call(
        &engine,
        "dup",
        "runtime.shutdown",
        shutdown_params(&status),
    ));
    assert_eq!(
        first, second,
        "an identical replay must return its original result"
    );

    // A conflicting-params reuse of the same requestId would need a second
    // valid-fenced params shape; `runtime.shutdown`'s only params are the
    // fenced identity fields themselves, so any different value is instead
    // caught by the fence check before the ledger is ever consulted — this
    // is the "an old instance's receipt cannot stop a replacement" ordering
    // exercised by `a_replacement_instance_rejects_an_old_instances_receipt`.
    let code = err_code(call(
        &engine,
        "dup",
        "runtime.shutdown",
        json!({"hostId": status["hostId"], "serviceInstanceId": "different"}),
    ));
    assert_eq!(code, "stale_incarnation");
}

#[test]
fn a_replacement_instance_rejects_an_old_instances_receipt() {
    let dir = tempfile::tempdir().unwrap();
    let first_status = {
        let engine = Engine::open(dir.path()).unwrap();
        let status = status(&engine);
        // The old instance really durably admits a shutdown receipt here —
        // not a fabricated row — so the replay below exercises a genuine
        // historical accepted receipt in the shared database.
        let accepted = ok(call(
            &engine,
            "dup",
            "runtime.shutdown",
            shutdown_params(&status),
        ));
        assert_eq!(accepted["accepted"], true);
        status
        // engine dropped: this simulates the old instance exiting.
    };
    let engine2 = Engine::open(dir.path()).unwrap();
    // The old instance's serviceInstanceId is foreign to the new instance,
    // so its fences refuse before any ledger/receipt lookup even happens.
    let code = err_code(call(
        &engine2,
        "dup",
        "runtime.shutdown",
        shutdown_params(&first_status),
    ));
    assert_eq!(code, "stale_incarnation");
    assert!(
        !engine2.is_quiescent(),
        "an old instance's receipt must never stop its replacement"
    );

    // The old receipt's requestId cannot be recycled for the replacement's
    // own shutdown either: same id, different (valid) fences means a
    // different request fingerprint, so the ledger reports a conflict.
    let code = err_code(call(
        &engine2,
        "dup",
        "runtime.shutdown",
        shutdown_params(&status(&engine2)),
    ));
    assert_eq!(code, "request_conflict");
    assert!(!engine2.is_quiescent());

    // And the replacement can still shut itself down with a fresh id.
    let accepted = ok(call(
        &engine2,
        "own-shutdown",
        "runtime.shutdown",
        shutdown_params(&status(&engine2)),
    ));
    assert_eq!(accepted["accepted"], true);
}

/// A receipt whose durable write fails must never authorize exit: the
/// request stays honest (`unverifiable`, retryable by requestId only), the
/// engine stays non-quiescent, and the retained uncertain receipt cannot be
/// re-run into a second effect.
#[test]
fn a_failed_receipt_write_never_authorizes_exit() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let status = status(&engine);
    // Fault injection at the storage layer: the admission INSERT succeeds,
    // but any UPDATE of the request ledger (the durable finish) aborts.
    let db = rusqlite::Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
    db.execute(
        "CREATE TRIGGER forbid_receipt_persist BEFORE UPDATE ON requests \
         BEGIN SELECT RAISE(ABORT, 'test fault: receipt write fails'); END",
        [],
    )
    .unwrap();
    drop(db);

    let response = call(
        &engine,
        "shutdown-fault",
        "runtime.shutdown",
        shutdown_params(&status),
    );
    assert_eq!(
        err_code(response),
        "unverifiable",
        "a failed durable receipt must surface as unverifiable, never accepted"
    );
    assert!(
        !engine.is_quiescent(),
        "a failed receipt write must not authorize exit"
    );

    // The uncertain receipt is retained: a same-requestId retry neither
    // re-runs the admission nor suddenly succeeds.
    let retry = call(
        &engine,
        "shutdown-fault",
        "runtime.shutdown",
        shutdown_params(&status),
    );
    assert_eq!(err_code(retry), "unverifiable");
    assert!(!engine.is_quiescent());
}

/// Concurrent repeats of the same shutdown requestId must not create
/// another effect: every racer observes the one durable receipt's outcome.
#[test]
fn concurrent_duplicate_shutdown_requests_produce_one_effect_and_the_same_outcome() {
    let dir = tempfile::tempdir().unwrap();
    let engine = std::sync::Arc::new(Engine::open(dir.path()).unwrap());
    let status = status(&engine);
    let params = shutdown_params(&status);

    let barrier = std::sync::Arc::new(std::sync::Barrier::new(4));
    let racers: Vec<_> = (0..4)
        .map(|_| {
            let engine = engine.clone();
            let params = params.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                call(&engine, "shutdown-dup", "runtime.shutdown", params)
            })
        })
        .collect();

    let mut results = Vec::new();
    for racer in racers {
        results.push(ok(racer.join().unwrap()));
    }
    for result in &results {
        assert_eq!(
            result, &results[0],
            "every concurrent duplicate must see the one receipt's outcome"
        );
        assert_eq!(result["accepted"], true);
    }
    assert!(engine.is_quiescent());

    // Exactly one durable receipt row backs all four answers.
    let db = rusqlite::Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
    let (rows, done): (i64, i64) = db
        .query_row(
            "SELECT COUNT(*), SUM(status = 'done') FROM requests WHERE request_id = 'shutdown-dup'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(rows, 1, "concurrent duplicates share one admission");
    assert_eq!(done, 1);
}

/// Cross-method requestId reuse is a ledger conflict, and a shutdown that
/// loses that conflict never admits.
#[test]
fn a_request_id_already_used_by_another_method_conflicts_and_never_admits() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let status = status(&engine);
    let ws = ok(call(
        &engine,
        "shared-id",
        "workspace.register",
        json!({"path": dir.path().to_string_lossy()}),
    ));
    assert!(ws["id"].is_string());

    let code = err_code(call(
        &engine,
        "shared-id",
        "runtime.shutdown",
        shutdown_params(&status),
    ));
    assert_eq!(code, "request_conflict");
    assert!(!engine.is_quiescent());
}

/// The freeze is admission-fencing, not a liveness stop: read-only methods
/// keep serving after `accepted:true`.
#[test]
fn read_only_methods_still_work_after_freeze() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let status = status(&engine);
    let accepted = ok(call(
        &engine,
        "shutdown-1",
        "runtime.shutdown",
        shutdown_params(&status),
    ));
    assert_eq!(accepted["accepted"], true);

    assert!(call(&engine, "status-after", "status", json!({})).ok);
    let listed = ok(call(&engine, "list-after", "session.list", json!({})));
    assert_eq!(listed["sessions"].as_array().unwrap().len(), 0);
    // Dispatch is fully alive: errors are real protocol errors, not a dead engine.
    assert_eq!(
        err_code(call(
            &engine,
            "read-missing",
            "session.read",
            json!({"sessionId": "nope", "incarnation": "inc"})
        )),
        "not_found"
    );
}

#[test]
fn concurrent_session_start_and_shutdown_never_admits_with_a_live_child() {
    let dir = tempfile::tempdir().unwrap();
    let engine = std::sync::Arc::new(Engine::open(dir.path()).unwrap());
    let status = status(&engine);
    let workspace = register_workspace(&engine, dir.path(), "ws");

    let starters: Vec<_> = (0..8)
        .map(|i| {
            let engine = engine.clone();
            let workspace = workspace.clone();
            std::thread::spawn(move || {
                call(
                    &engine,
                    &format!("start-{i}"),
                    "session.start",
                    json!({"workspaceId": workspace, "command": "/bin/sh", "args": ["-c", "read -r release"]}),
                )
            })
        })
        .collect();

    // Wait until at least one start has landed a non-exited row, so every
    // shutdown attempt below deterministically observes real contention
    // rather than racing a window where zero sessions exist yet (which
    // would be a legitimate, non-conflicting admission ordering, not the
    // "no spawn/mutation in flight" case this test targets).
    assert!(wait_for(
        || !ok(call(&engine, "poll-any", "session.list", json!({})))["sessions"]
            .as_array()
            .unwrap()
            .is_empty(),
        Duration::from_secs(2)
    ));

    let mut any_busy = false;
    for i in 0..40 {
        let response = call(
            &engine,
            &format!("shutdown-race-{i}"),
            "runtime.shutdown",
            shutdown_params(&status),
        );
        assert!(
            !response.ok,
            "a session is provably not yet exited; shutdown must refuse"
        );
        assert_eq!(response.error.unwrap().code, "runtime_busy");
        any_busy = true;
    }
    assert!(
        any_busy,
        "at least one shutdown attempt must observe contention"
    );

    for starter in starters {
        let started = starter.join().unwrap();
        assert!(started.ok, "{:?}", started.error);
    }
    assert!(!engine.is_quiescent());

    let listed = ok(call(&engine, "list", "session.list", json!({})));
    for session in listed["sessions"].as_array().unwrap() {
        let stopped = ok(call(
            &engine,
            &format!("stop-{}", session["id"].as_str().unwrap()),
            "session.stop",
            json!({"sessionId": session["id"], "incarnation": session["incarnation"]}),
        ));
        assert_eq!(stopped["verdict"], "exited");
    }
    assert!(wait_for(
        || {
            let listed = ok(call(&engine, "poll", "session.list", json!({})));
            listed["sessions"]
                .as_array()
                .unwrap()
                .iter()
                .all(|s| s["verdict"] == "exited")
        },
        Duration::from_secs(2)
    ));

    let accepted = ok(call(
        &engine,
        "final-shutdown",
        "runtime.shutdown",
        shutdown_params(&status),
    ));
    assert_eq!(accepted["accepted"], true);
}
