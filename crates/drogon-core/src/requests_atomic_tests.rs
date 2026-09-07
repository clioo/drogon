//! Atomic-path tests for [`super::RequestLedger::run_atomic`].
//!
//! History: `db_only_effect_rolls_back_when_receipt_insert_cannot_commit`
//! below descends from the RED established at `0d063a0`, where the same
//! domain assertion FAILED against the legacy external-effect path
//! (`left: 1, right: 0`): the domain write survived when its success
//! receipt could not commit. It now passes against `run_atomic`.
//!
//! The legacy non-rollback behavior is intentionally preserved for
//! external effects; `legacy_external_path_still_leaves_effect_on_receipt_failure`
//! pins that, and is not a regression claim.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Barrier, Mutex};

use drogon_protocol::RpcError;
use rusqlite::{Connection, Transaction};
use serde_json::json;

use super::{RequestLedger, fingerprint};

fn open_fixture() -> Mutex<Connection> {
    let conn = Connection::open_in_memory().expect("in-memory fixture db");
    conn.execute_batch(
        "CREATE TABLE requests (
            request_id TEXT PRIMARY KEY,
            method TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            status TEXT NOT NULL,
            result_json TEXT,
            error_json TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE domain_notes (
            id TEXT PRIMARY KEY,
            body TEXT NOT NULL
        );",
    )
    .expect("fixture schema");
    Mutex::new(conn)
}

fn domain_count(db: &Mutex<Connection>) -> i64 {
    db.lock()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM domain_notes", [], |row| row.get(0))
        .expect("count domain rows")
}

fn allow(_: &Transaction) -> Result<(), RpcError> {
    Ok(())
}

fn deny(_: &Transaction) -> Result<(), RpcError> {
    Err(RpcError::new("unauthorized", "stale consumer generation"))
}

fn append_note(tx: &Transaction, id: &str, body: &str) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO domain_notes (id, body) VALUES (?1, ?2)",
        [id, body],
    )?;
    Ok(())
}

#[test]
fn db_only_effect_rolls_back_when_receipt_insert_cannot_commit() {
    let db = open_fixture();
    // Sabotage only the receipt INSERT; the domain write itself succeeds.
    db.lock()
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER block_receipt_insert BEFORE INSERT ON requests
             BEGIN SELECT RAISE(ABORT, 'injected receipt insert failure'); END;",
        )
        .expect("install insert-failure trigger");
    let ledger = RequestLedger::default();
    let params = json!({"noteId": "n1", "body": "hello"});

    let outcome = ledger.run_atomic(
        &db,
        "req-red-1",
        "domain.noteAppend",
        &params,
        allow,
        |tx| {
            append_note(tx, "n1", "hello").expect("domain write inside work");
            Ok(json!({"appended": "n1"}))
        },
    );

    // The success could not be recorded: honest answer is `unverifiable`,
    // never the unrecorded result.
    let err = outcome.expect_err("sabotaged receipt insert must not report success");
    assert_eq!(err.code, "unverifiable");
    // RED-turned-GREEN: the domain write rolled back with the receipt.
    assert_eq!(domain_count(&db), 0);
}

#[test]
fn legacy_external_path_still_leaves_effect_on_receipt_failure() {
    // Pins the preserved external-effect semantics of `run`: when the
    // receipt UPDATE fails after real work ran, callers get `unverifiable`
    // and the side effect is NOT rolled back. Unchanged by `run_atomic`.
    let db = open_fixture();
    db.lock()
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER inject_finish_failure BEFORE UPDATE ON requests
             WHEN NEW.status = 'done'
             BEGIN SELECT RAISE(ABORT, 'injected receipt finish failure'); END;",
        )
        .expect("install finish-failure trigger");
    let ledger = RequestLedger::default();
    let params = json!({"noteId": "n1", "body": "hello"});

    let outcome = ledger.run(&db, "req-legacy-1", "domain.noteAppend", &params, || {
        db.lock()
            .unwrap()
            .execute(
                "INSERT INTO domain_notes (id, body) VALUES ('n1', 'hello')",
                [],
            )
            .expect("domain write inside work closure");
        Ok(json!({"appended": "n1"}))
    });

    let err = outcome.expect_err("sabotaged receipt finish must not report success");
    assert_eq!(err.code, "unverifiable");
    assert_eq!(
        domain_count(&db),
        1,
        "legacy external-effect path deliberately leaves the committed write"
    );
}

#[test]
fn atomic_success_commits_state_and_replays_without_second_write() {
    let db = open_fixture();
    let ledger = RequestLedger::default();
    let params = json!({"noteId": "n1", "body": "hello"});
    let executions = AtomicUsize::new(0);

    let first = ledger.run_atomic(&db, "req-ok-1", "domain.noteAppend", &params, allow, |tx| {
        executions.fetch_add(1, Ordering::SeqCst);
        append_note(tx, "n1", "hello").expect("domain write");
        Ok(json!({"appended": "n1"}))
    });
    assert_eq!(first.unwrap(), json!({"appended": "n1"}));
    assert_eq!(domain_count(&db), 1);

    let replay = ledger.run_atomic(&db, "req-ok-1", "domain.noteAppend", &params, allow, |_| {
        executions.fetch_add(1, Ordering::SeqCst);
        Ok(json!({"appended": "SHOULD-NOT-RUN"}))
    });
    assert_eq!(replay.unwrap(), json!({"appended": "n1"}));
    assert_eq!(executions.load(Ordering::SeqCst), 1);
    assert_eq!(domain_count(&db), 1);
}

#[test]
fn atomic_same_key_changed_method_or_params_conflicts() {
    let db = open_fixture();
    let ledger = RequestLedger::default();
    let executions = AtomicUsize::new(0);

    let first = ledger.run_atomic(
        &db,
        "req-cf-1",
        "domain.noteAppend",
        &json!({"noteId": "n1"}),
        allow,
        |tx| {
            executions.fetch_add(1, Ordering::SeqCst);
            append_note(tx, "n1", "hello").expect("domain write");
            Ok(json!({"appended": "n1"}))
        },
    );
    assert!(first.is_ok());

    // Same key, different method.
    let conflict = ledger.run_atomic(
        &db,
        "req-cf-1",
        "domain.noteRemove",
        &json!({"noteId": "n1"}),
        allow,
        |_| {
            executions.fetch_add(1, Ordering::SeqCst);
            Ok(json!({}))
        },
    );
    assert_eq!(conflict.unwrap_err().code, "request_conflict");

    // Same key and method, different params.
    let conflict = ledger.run_atomic(
        &db,
        "req-cf-1",
        "domain.noteAppend",
        &json!({"noteId": "n2"}),
        allow,
        |_| {
            executions.fetch_add(1, Ordering::SeqCst);
            Ok(json!({}))
        },
    );
    assert_eq!(conflict.unwrap_err().code, "request_conflict");
    assert_eq!(executions.load(Ordering::SeqCst), 1);
    assert_eq!(domain_count(&db), 1);
}

#[test]
fn atomic_reordered_nested_json_keys_share_one_fingerprint() {
    let db = open_fixture();
    let ledger = RequestLedger::default();
    let executions = AtomicUsize::new(0);
    let first = json!({"a": 1, "b": {"x": 1, "y": 2}});
    let reordered = json!({"b": {"y": 2, "x": 1}, "a": 1});
    assert_eq!(
        fingerprint("domain.noteAppend", &first),
        fingerprint("domain.noteAppend", &reordered),
        "canonical key order must make these identical"
    );

    let one = ledger.run_atomic(
        &db,
        "req-reorder-1",
        "domain.noteAppend",
        &first,
        allow,
        |tx| {
            executions.fetch_add(1, Ordering::SeqCst);
            append_note(tx, "n1", "hello").expect("domain write");
            Ok(json!({"appended": "n1"}))
        },
    );
    let two = ledger.run_atomic(
        &db,
        "req-reorder-1",
        "domain.noteAppend",
        &reordered,
        allow,
        |_| {
            executions.fetch_add(1, Ordering::SeqCst);
            Ok(json!({"appended": "SHOULD-NOT-RUN"}))
        },
    );
    assert_eq!(one.unwrap(), json!({"appended": "n1"}));
    assert_eq!(two.unwrap(), json!({"appended": "n1"}));
    assert_eq!(executions.load(Ordering::SeqCst), 1);
    assert_eq!(domain_count(&db), 1);
}

#[test]
fn denied_authorization_on_replay_does_not_leak_saved_success() {
    let db = open_fixture();
    let ledger = RequestLedger::default();
    let params = json!({"noteId": "n1"});
    let executions = AtomicUsize::new(0);

    let first = ledger.run_atomic(
        &db,
        "req-auth-1",
        "domain.noteAppend",
        &params,
        allow,
        |tx| {
            executions.fetch_add(1, Ordering::SeqCst);
            append_note(tx, "n1", "hello").expect("domain write");
            Ok(json!({"appended": "n1"}))
        },
    );
    assert!(first.is_ok());

    // Same key, stale/denied authorization: the saved success must not leak.
    let denied = ledger.run_atomic(
        &db,
        "req-auth-1",
        "domain.noteAppend",
        &params,
        deny,
        |_| {
            executions.fetch_add(1, Ordering::SeqCst);
            Ok(json!({"appended": "SHOULD-NOT-RUN"}))
        },
    );
    assert_eq!(denied.unwrap_err().code, "unauthorized");
    assert_eq!(executions.load(Ordering::SeqCst), 1);

    // A fresh authorization still replays the saved success.
    let replay = ledger.run_atomic(
        &db,
        "req-auth-1",
        "domain.noteAppend",
        &params,
        allow,
        |_| {
            executions.fetch_add(1, Ordering::SeqCst);
            Ok(json!({"appended": "SHOULD-NOT-RUN"}))
        },
    );
    assert_eq!(replay.unwrap(), json!({"appended": "n1"}));
    assert_eq!(executions.load(Ordering::SeqCst), 1);
}

#[test]
fn authorization_failure_writes_nothing_and_leaves_no_receipt() {
    let db = open_fixture();
    let ledger = RequestLedger::default();
    let params = json!({"noteId": "n1"});
    let executions = AtomicUsize::new(0);

    let denied = ledger.run_atomic(
        &db,
        "req-auth-2",
        "domain.noteAppend",
        &params,
        deny,
        |_| {
            executions.fetch_add(1, Ordering::SeqCst);
            Ok(json!({}))
        },
    );
    assert_eq!(denied.unwrap_err().code, "unauthorized");
    assert_eq!(executions.load(Ordering::SeqCst), 0);
    assert_eq!(domain_count(&db), 0);
    let rows: i64 = db
        .lock()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM requests", [], |r| r.get(0))
        .expect("count receipts");
    assert_eq!(rows, 0, "denied authorization must leave no receipt row");

    // The key is unpoisoned: an authorized call executes normally.
    let ok = ledger.run_atomic(
        &db,
        "req-auth-2",
        "domain.noteAppend",
        &params,
        allow,
        |tx| {
            executions.fetch_add(1, Ordering::SeqCst);
            append_note(tx, "n1", "hello").expect("domain write");
            Ok(json!({"appended": "n1"}))
        },
    );
    assert_eq!(ok.unwrap(), json!({"appended": "n1"}));
    assert_eq!(domain_count(&db), 1);
}

#[test]
fn work_error_rolls_back_domain_and_persists_replayable_failure() {
    let db = open_fixture();
    let ledger = RequestLedger::default();
    let params = json!({"noteId": "n1"});
    let executions = AtomicUsize::new(0);
    let failure = RpcError::new("io_error", "simulated work failure");

    let outcome = ledger.run_atomic(
        &db,
        "req-fail-1",
        "domain.noteAppend",
        &params,
        allow,
        |tx| {
            executions.fetch_add(1, Ordering::SeqCst);
            append_note(tx, "n1", "hello").expect("domain write before failure");
            Err(failure.clone())
        },
    );
    assert_eq!(outcome.unwrap_err(), failure);
    assert_eq!(
        domain_count(&db),
        0,
        "failed work must not leave its domain write"
    );

    // The stable failure receipt replays without re-executing work.
    let replay = ledger.run_atomic(
        &db,
        "req-fail-1",
        "domain.noteAppend",
        &params,
        allow,
        |_| {
            executions.fetch_add(1, Ordering::SeqCst);
            Ok(json!({"appended": "SHOULD-NOT-RUN"}))
        },
    );
    assert_eq!(replay.unwrap_err(), failure);
    assert_eq!(executions.load(Ordering::SeqCst), 1);
    assert_eq!(domain_count(&db), 0);
}

#[test]
fn pending_external_receipt_is_refused_and_never_rerun() {
    let db = open_fixture();
    let ledger = RequestLedger::default();
    let params = json!({"noteId": "n1"});
    let executions = AtomicUsize::new(0);

    // Simulate a legacy external-effect admission stuck `pending`.
    db.lock()
        .unwrap()
        .execute(
            "INSERT INTO requests (request_id, method, fingerprint, status, created_at) \
             VALUES ('req-pend-1', 'domain.noteAppend', ?1, 'pending', '2026-09-07T00:00:00Z')",
            [fingerprint("domain.noteAppend", &params)],
        )
        .expect("seed pending external row");

    let outcome = ledger.run_atomic(
        &db,
        "req-pend-1",
        "domain.noteAppend",
        &params,
        allow,
        |_| {
            executions.fetch_add(1, Ordering::SeqCst);
            Ok(json!({}))
        },
    );
    assert_eq!(outcome.unwrap_err().code, "unverifiable");
    assert_eq!(
        executions.load(Ordering::SeqCst),
        0,
        "pending rows are never re-run"
    );
    assert_eq!(domain_count(&db), 0);

    // Same key with changed params conflicts instead of running.
    let conflict = ledger.run_atomic(
        &db,
        "req-pend-1",
        "domain.noteAppend",
        &json!({"noteId": "n2"}),
        allow,
        |_| {
            executions.fetch_add(1, Ordering::SeqCst);
            Ok(json!({}))
        },
    );
    assert_eq!(conflict.unwrap_err().code, "request_conflict");
    assert_eq!(executions.load(Ordering::SeqCst), 0);
}

#[test]
fn commit_failure_reports_uncertain_without_success() {
    // Deferred foreign key: statements succeed, COMMIT fails. The API must
    // answer `unverifiable` — never success — without claiming certainty.
    let db = open_fixture();
    {
        let conn = db.lock().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE atomic_parents (id TEXT PRIMARY KEY);
             CREATE TABLE atomic_children (
                 id TEXT PRIMARY KEY,
                 parent_id TEXT REFERENCES atomic_parents(id)
                     DEFERRABLE INITIALLY DEFERRED
             );",
        )
        .expect("deferred-fk schema");
    }
    let ledger = RequestLedger::default();
    let params = json!({"child": "c1"});

    let outcome = ledger.run_atomic(
        &db,
        "req-commit-1",
        "domain.childAdd",
        &params,
        allow,
        |tx| {
            tx.execute(
                "INSERT INTO atomic_children (id, parent_id) VALUES ('c1', 'missing-parent')",
                [],
            )
            .expect("deferred insert succeeds until commit");
            Ok(json!({"added": "c1"}))
        },
    );
    assert_eq!(outcome.unwrap_err().code, "unverifiable");

    // Recovery with the same key is safe: nothing durable was published, so
    // the retry is a fresh admission once its data is valid.
    let retry = ledger.run_atomic(
        &db,
        "req-commit-1",
        "domain.childAdd",
        &params,
        allow,
        |tx| {
            tx.execute(
                "INSERT INTO atomic_parents (id) VALUES ('missing-parent')",
                [],
            )
            .expect("parent insert");
            tx.execute(
                "INSERT INTO atomic_children (id, parent_id) VALUES ('c1', 'missing-parent')",
                [],
            )
            .expect("child insert");
            Ok(json!({"added": "c1"}))
        },
    );
    assert_eq!(retry.unwrap(), json!({"added": "c1"}));
}

#[test]
fn concurrent_same_key_calls_write_once() {
    let db = open_fixture();
    let ledger = RequestLedger::default();
    let params = json!({"noteId": "n1"});
    let executions = AtomicUsize::new(0);

    let barrier = Barrier::new(2);
    std::thread::scope(|scope| {
        let first = scope.spawn(|| {
            barrier.wait();
            ledger.run_atomic(
                &db,
                "req-race-1",
                "domain.noteAppend",
                &params,
                allow,
                |tx| {
                    executions.fetch_add(1, Ordering::SeqCst);
                    append_note(tx, "n1", "hello").expect("domain write");
                    Ok(json!({"appended": "n1"}))
                },
            )
        });
        let second = scope.spawn(|| {
            barrier.wait();
            ledger.run_atomic(
                &db,
                "req-race-1",
                "domain.noteAppend",
                &params,
                allow,
                |tx| {
                    executions.fetch_add(1, Ordering::SeqCst);
                    append_note(tx, "n1", "hello").expect("domain write");
                    Ok(json!({"appended": "n1"}))
                },
            )
        });
        let (one, two) = (first.join().unwrap(), second.join().unwrap());
        assert_eq!(one.unwrap(), json!({"appended": "n1"}));
        assert_eq!(two.unwrap(), json!({"appended": "n1"}));
    });
    assert_eq!(
        executions.load(Ordering::SeqCst),
        1,
        "exactly one execution"
    );
    assert_eq!(domain_count(&db), 1, "exactly one domain row");
}

#[test]
fn cross_connection_contention_serializes_to_single_write() {
    let dir = tempfile::tempdir().expect("isolated dir");
    let path = dir.path().join("contention.sqlite3");
    let schema = "CREATE TABLE requests (
            request_id TEXT PRIMARY KEY,
            method TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            status TEXT NOT NULL,
            result_json TEXT,
            error_json TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE domain_notes (
            id TEXT PRIMARY KEY,
            body TEXT NOT NULL
        );";
    let conn_a = Connection::open(&path).expect("file db A");
    conn_a
        .busy_timeout(std::time::Duration::from_secs(10))
        .expect("busy timeout");
    conn_a.execute_batch(schema).expect("shared schema");
    let conn_b = Connection::open(&path).expect("file db B");
    conn_b
        .busy_timeout(std::time::Duration::from_secs(10))
        .expect("busy timeout");
    let db_a = Mutex::new(conn_a);
    let db_b = Mutex::new(conn_b);
    let ledger = RequestLedger::default();
    let params = json!({"noteId": "n1"});
    let executions = AtomicUsize::new(0);

    // Both connections race the same key through one ledger on one file:
    // the loser blocks in BEGIN IMMEDIATE until the winner commits, then
    // replays the committed receipt through its own authorized transaction.
    let barrier = Barrier::new(2);
    std::thread::scope(|scope| {
        let leader = scope.spawn(|| {
            barrier.wait();
            ledger.run_atomic(
                &db_a,
                "req-xconn-1",
                "domain.noteAppend",
                &params,
                allow,
                |tx| {
                    executions.fetch_add(1, Ordering::SeqCst);
                    append_note(tx, "n1", "hello").expect("domain write");
                    Ok(json!({"appended": "n1"}))
                },
            )
        });
        let follower = scope.spawn(|| {
            barrier.wait();
            ledger.run_atomic(
                &db_b,
                "req-xconn-1",
                "domain.noteAppend",
                &params,
                allow,
                |tx| {
                    executions.fetch_add(1, Ordering::SeqCst);
                    append_note(tx, "n1", "hello").expect("domain write");
                    Ok(json!({"appended": "n1"}))
                },
            )
        });
        let (one, two) = (leader.join().unwrap(), follower.join().unwrap());
        assert_eq!(one.unwrap(), json!({"appended": "n1"}));
        assert_eq!(two.unwrap(), json!({"appended": "n1"}));
    });
    assert_eq!(executions.load(Ordering::SeqCst), 1);
    assert_eq!(domain_count(&db_a), 1);
}

#[test]
fn persisted_replay_after_reopen_needs_no_reexecution() {
    let dir = tempfile::tempdir().expect("isolated dir");
    let path = dir.path().join("reopen.sqlite3");
    let params = json!({"noteId": "n1"});
    let executions = AtomicUsize::new(0);
    let ledger = RequestLedger::default();

    {
        let db = Mutex::new({
            let conn = Connection::open(&path).expect("file db");
            conn.execute_batch(
                "CREATE TABLE requests (
                    request_id TEXT PRIMARY KEY,
                    method TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    status TEXT NOT NULL,
                    result_json TEXT,
                    error_json TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE domain_notes (
                    id TEXT PRIMARY KEY,
                    body TEXT NOT NULL
                );",
            )
            .expect("schema");
            conn
        });
        let outcome = ledger.run_atomic(
            &db,
            "req-reopen-1",
            "domain.noteAppend",
            &params,
            allow,
            |tx| {
                executions.fetch_add(1, Ordering::SeqCst);
                append_note(tx, "n1", "hello").expect("domain write");
                Ok(json!({"appended": "n1"}))
            },
        );
        assert_eq!(outcome.unwrap(), json!({"appended": "n1"}));
    }

    // New connection, same durable receipt: replays without executing work.
    {
        let db = Mutex::new(Connection::open(&path).expect("reopened file db"));
        let replay = ledger.run_atomic(
            &db,
            "req-reopen-1",
            "domain.noteAppend",
            &params,
            allow,
            |_| {
                executions.fetch_add(1, Ordering::SeqCst);
                Ok(json!({"appended": "SHOULD-NOT-RUN"}))
            },
        );
        assert_eq!(replay.unwrap(), json!({"appended": "n1"}));
    }
    assert_eq!(executions.load(Ordering::SeqCst), 1);
}

#[test]
fn verified_rollback_frees_domain_for_a_later_key() {
    // A failed admission rolls its domain write back, so the same domain
    // content stays usable under a fresh key (a surviving phantom row would
    // collide on the primary key here).
    let db = open_fixture();
    let ledger = RequestLedger::default();
    let executions = AtomicUsize::new(0);

    let failed = ledger.run_atomic(
        &db,
        "req-reuse-1",
        "domain.noteAppend",
        &json!({"noteId": "n1"}),
        allow,
        |tx| {
            executions.fetch_add(1, Ordering::SeqCst);
            append_note(tx, "n1", "hello").expect("domain write before failure");
            Err(RpcError::new("io_error", "simulated work failure"))
        },
    );
    assert_eq!(failed.unwrap_err().code, "io_error");
    assert_eq!(domain_count(&db), 0);

    let reused = ledger.run_atomic(
        &db,
        "req-reuse-2",
        "domain.noteAppend",
        &json!({"noteId": "n1"}),
        allow,
        |tx| {
            executions.fetch_add(1, Ordering::SeqCst);
            append_note(tx, "n1", "hello").expect("domain write");
            Ok(json!({"appended": "n1"}))
        },
    );
    assert_eq!(reused.unwrap(), json!({"appended": "n1"}));
    assert_eq!(domain_count(&db), 1);
}

#[test]
fn legacy_retained_slot_does_not_block_atomic_same_key() {
    // A legacy `run` whose receipt UPDATE fails deliberately retains its
    // completed in-flight slot forever. A same-key atomic call must still
    // complete: authorize runs, work never runs, nothing is waited on.
    let db = open_fixture();
    db.lock()
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER inject_finish_failure BEFORE UPDATE ON requests
             WHEN NEW.status = 'done'
             BEGIN SELECT RAISE(ABORT, 'injected receipt finish failure'); END;",
        )
        .expect("install finish-failure trigger");
    let ledger = RequestLedger::default();
    let params = json!({"noteId": "n1", "body": "hello"});

    let legacy = ledger.run(&db, "req-shared-1", "domain.noteAppend", &params, || {
        db.lock()
            .unwrap()
            .execute(
                "INSERT INTO domain_notes (id, body) VALUES ('n1', 'hello')",
                [],
            )
            .expect("legacy domain write");
        Ok(json!({"appended": "n1"}))
    });
    assert_eq!(legacy.unwrap_err().code, "unverifiable");

    let auth_calls = AtomicUsize::new(0);
    let work_calls = AtomicUsize::new(0);
    let atomic = ledger.run_atomic(
        &db,
        "req-shared-1",
        "domain.noteAppend",
        &params,
        |_| {
            auth_calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        },
        |_| {
            work_calls.fetch_add(1, Ordering::SeqCst);
            Ok(json!({}))
        },
    );
    assert_eq!(atomic.unwrap_err().code, "unverifiable");
    assert_eq!(auth_calls.load(Ordering::SeqCst), 1);
    assert_eq!(work_calls.load(Ordering::SeqCst), 0);
}

#[test]
fn denied_authorization_beats_fingerprint_conflict_under_live_slot() {
    // A legacy admission is parked inside work (its different-fingerprint
    // slot provably live) while a same-key atomic call with changed params
    // and denied authorization runs. Denial must win over conflict, and the
    // atomic work must never run.
    let db = open_fixture();
    let ledger = RequestLedger::default();
    let arrived = Barrier::new(2);
    let release = Barrier::new(2);
    let auth_calls = AtomicUsize::new(0);
    let work_calls = AtomicUsize::new(0);

    std::thread::scope(|scope| {
        let legacy = scope.spawn(|| {
            ledger.run(
                &db,
                "req-live-1",
                "domain.noteAppend",
                &json!({"noteId": "n1"}),
                || {
                    arrived.wait();
                    release.wait();
                    Ok(json!({"appended": "n1"}))
                },
            )
        });
        arrived.wait();
        let denied = ledger.run_atomic(
            &db,
            "req-live-1",
            "domain.noteAppend",
            &json!({"noteId": "n2"}),
            |_| {
                auth_calls.fetch_add(1, Ordering::SeqCst);
                Err(RpcError::new("unauthorized", "stale consumer"))
            },
            |_| {
                work_calls.fetch_add(1, Ordering::SeqCst);
                Ok(json!({}))
            },
        );
        release.wait();
        let legacy_outcome = legacy.join().expect("legacy thread");
        assert_eq!(denied.unwrap_err().code, "unauthorized");
        assert_eq!(auth_calls.load(Ordering::SeqCst), 1);
        assert_eq!(work_calls.load(Ordering::SeqCst), 0);
        assert_eq!(legacy_outcome.unwrap(), json!({"appended": "n1"}));
    });
}
