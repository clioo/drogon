//! Behavioral RED for the unmet DATABASE-only atomicity requirement.
//!
//! The existing [`super::RequestLedger::run`] path was built for external
//! effects (spawn a process, then record the receipt): the `work` closure's
//! side effect is intentionally *not* rolled back when the receipt finish
//! step fails — every caller then gets the same honest `unverifiable`
//! instead of the unrecorded result (see `super`'s module docs). That
//! non-rollback design is correct for external effects and is NOT asserted
//! to be a regression here.
//!
//! Coordination needs a second, transaction-aware path for DATABASE-only
//! operations: domain state, mailbox output and the successful receipt must
//! commit atomically, so that a domain write never survives when its
//! success receipt cannot commit. These tests run against the UNCHANGED
//! production `RequestLedger::run` with a real SQLite `requests` table
//! (same schema as `db.rs`) plus a small domain table:
//!
//! - `db_only_effect_rolls_back_when_receipt_finish_cannot_commit` is the
//!   RED test: it forces the receipt UPDATE to fail with a trigger and
//!   asserts the new atomic requirement (domain row absent). It currently
//!   FAILS because the external-effect path leaves the committed write.
//! - The two control tests PASS on the current implementation, proving the
//!   fixture is valid and the RED is not a setup failure.

use std::sync::Mutex;

use rusqlite::Connection;

use super::RequestLedger;

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

/// Sabotages only the receipt finish step: the admission INSERT still
/// succeeds, but any transition of a receipt row to `done` aborts, so
/// `RequestLedger::run` must answer `unverifiable` for work it already ran.
fn break_receipt_finish(db: &Mutex<Connection>) {
    db.lock()
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER inject_finish_failure BEFORE UPDATE ON requests
             WHEN NEW.status = 'done'
             BEGIN
                 SELECT RAISE(ABORT, 'injected receipt finish failure');
             END;",
        )
        .expect("install finish-failure trigger");
}

#[test]
fn db_only_effect_rolls_back_when_receipt_finish_cannot_commit() {
    let db = open_fixture();
    break_receipt_finish(&db);
    let ledger = RequestLedger::default();
    let params = serde_json::json!({"noteId": "n1", "body": "hello"});

    let outcome = ledger.run(&db, "req-red-1", "domain.noteAppend", &params, || {
        db.lock()
            .unwrap()
            .execute(
                "INSERT INTO domain_notes (id, body) VALUES ('n1', 'hello')",
                [],
            )
            .expect("domain write inside work closure");
        Ok(serde_json::json!({"appended": "n1"}))
    });

    // The success could not be durably recorded, so the only honest answer
    // is `unverifiable` — this half already holds on the current path.
    let err = outcome.expect_err("sabotaged receipt finish must not report success");
    assert_eq!(err.code, "unverifiable");

    // NEW requirement for the DATABASE-only ledger path (not yet
    // implemented): the domain write must not survive when its success
    // receipt cannot commit. Current external-effect behavior leaves the
    // committed row behind, so this assertion is the behavioral RED.
    assert_eq!(
        domain_count(&db),
        0,
        "DB-only domain write must roll back with its receipt; \
         its presence proves the current path cannot serve coordination state"
    );
}

#[test]
fn successful_receipt_commits_domain_write_and_replays_without_second_write() {
    let db = open_fixture();
    let ledger = RequestLedger::default();
    let params = serde_json::json!({"noteId": "n1", "body": "hello"});
    let executions = std::sync::atomic::AtomicUsize::new(0);

    let first = ledger.run(&db, "req-ok-1", "domain.noteAppend", &params, || {
        executions.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        db.lock()
            .unwrap()
            .execute(
                "INSERT INTO domain_notes (id, body) VALUES ('n1', 'hello')",
                [],
            )
            .expect("domain write inside work closure");
        Ok(serde_json::json!({"appended": "n1"}))
    });
    assert_eq!(first.unwrap(), serde_json::json!({"appended": "n1"}));
    assert_eq!(domain_count(&db), 1);

    // Same request identity, same payload: identical replay, no re-execution.
    let replay = ledger.run(&db, "req-ok-1", "domain.noteAppend", &params, || {
        executions.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(serde_json::json!({"appended": "SHOULD-NOT-RUN"}))
    });
    assert_eq!(replay.unwrap(), serde_json::json!({"appended": "n1"}));
    assert_eq!(
        executions.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "replay must not re-execute the work closure"
    );
    assert_eq!(domain_count(&db), 1, "replay must not duplicate the domain write");
}

#[test]
fn same_key_changed_payload_is_refused_without_second_write() {
    let db = open_fixture();
    let ledger = RequestLedger::default();
    let executions = std::sync::atomic::AtomicUsize::new(0);

    let first = ledger.run(
        &db,
        "req-conflict-1",
        "domain.noteAppend",
        &serde_json::json!({"noteId": "n1"}),
        || {
            executions.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            db.lock()
                .unwrap()
                .execute(
                    "INSERT INTO domain_notes (id, body) VALUES ('n1', 'hello')",
                    [],
                )
                .expect("domain write inside work closure");
            Ok(serde_json::json!({"appended": "n1"}))
        },
    );
    assert!(first.is_ok());
    assert_eq!(domain_count(&db), 1);

    // Same request key, different semantic payload: refused, no second write.
    let conflict = ledger.run(
        &db,
        "req-conflict-1",
        "domain.noteAppend",
        &serde_json::json!({"noteId": "n2"}),
        || {
            executions.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            db.lock()
                .unwrap()
                .execute(
                    "INSERT INTO domain_notes (id, body) VALUES ('n2', 'other')",
                    [],
                )
                .expect("domain write inside work closure");
            Ok(serde_json::json!({"appended": "n2"}))
        },
    );
    let err = conflict.expect_err("changed payload under the same key must be refused");
    assert_eq!(err.code, "request_conflict");
    assert_eq!(
        executions.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "conflicting reuse must not execute the work closure"
    );
    assert_eq!(domain_count(&db), 1, "conflicting reuse must not add a domain row");
}
