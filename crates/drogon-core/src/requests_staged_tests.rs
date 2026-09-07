use super::*;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

fn fixture() -> (tempfile::TempDir, Mutex<Connection>) {
    let dir = tempfile::tempdir().unwrap();
    let conn = crate::db::open(&dir.path().canonicalize().unwrap()).unwrap();
    crate::db::migrate_and_recover(&conn).unwrap();
    conn.execute_batch("CREATE TABLE staged_probe (id TEXT PRIMARY KEY, phase TEXT NOT NULL);")
        .unwrap();
    (dir, Mutex::new(conn))
}

fn prepare(tx: &Transaction<'_>) -> Result<(), RpcError> {
    tx.execute(
        "INSERT INTO staged_probe VALUES ('attempt', 'admitted')",
        [],
    )
    .map_err(error::from_sqlite)?;
    Ok(())
}

fn finalize(tx: &Transaction<'_>, _: &ReceiptOutcome) -> Result<(), RpcError> {
    tx.execute(
        "UPDATE staged_probe SET phase = 'finished' WHERE id = 'attempt'",
        [],
    )
    .map_err(error::from_sqlite)?;
    Ok(())
}

#[test]
fn external_effect_sees_committed_admission_and_no_ledger_or_database_lock() {
    let (dir, db) = fixture();
    let ledger = RequestLedger::default();
    let result = ledger
        .run_staged(
            &db,
            "key",
            "workerStart",
            &json!({}),
            |_| Ok(()),
            prepare,
            |_| {
                assert!(db.try_lock().is_ok());
                assert!(ledger.in_flight.try_lock().is_ok());
                let observer = Connection::open(dir.path().join(crate::DB_FILE_NAME)).unwrap();
                let phase: String = observer
                    .query_row("SELECT phase FROM staged_probe", [], |r| r.get(0))
                    .unwrap();
                let state: String = observer
                    .query_row(
                        "SELECT status FROM requests WHERE request_id = 'key'",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap();
                assert_eq!(phase, "admitted");
                assert_eq!(state, "pending");
                Ok(json!({"effect":"accepted"}))
            },
            finalize,
        )
        .unwrap();
    assert_eq!(result, json!({"effect":"accepted"}));
    let conn = db.lock().unwrap();
    let phase: String = conn
        .query_row("SELECT phase FROM staged_probe", [], |r| r.get(0))
        .unwrap();
    let state: String = conn
        .query_row("SELECT status FROM requests", [], |r| r.get(0))
        .unwrap();
    assert_eq!((phase.as_str(), state.as_str()), ("finished", "done"));
}

#[test]
fn pending_receipt_failure_rolls_back_admission_without_external_effect() {
    let (_dir, db) = fixture();
    let ledger = RequestLedger::default();
    db.lock().unwrap().execute_batch("CREATE TRIGGER reject_pending BEFORE INSERT ON requests BEGIN SELECT RAISE(ABORT, 'injected'); END;").unwrap();
    let effects = AtomicUsize::new(0);
    let result = ledger.run_staged(
        &db,
        "key",
        "workerStart",
        &json!({}),
        |_| Ok(()),
        prepare,
        |_| {
            effects.fetch_add(1, Ordering::SeqCst);
            Ok(json!({}))
        },
        finalize,
    );
    assert!(result.is_err());
    assert_eq!(effects.load(Ordering::SeqCst), 0);
    let count: u32 = db
        .lock()
        .unwrap()
        .query_row("SELECT count(*) FROM staged_probe", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
    db.lock()
        .unwrap()
        .execute_batch("DROP TRIGGER reject_pending;")
        .unwrap();
    ledger
        .run_staged(
            &db,
            "key",
            "workerStart",
            &json!({}),
            |_| Ok(()),
            prepare,
            |_| Ok(json!({})),
            finalize,
        )
        .unwrap();
}

#[test]
fn preparation_failure_rolls_back_domain_but_replays_its_error_receipt() {
    let (_dir, db) = fixture();
    let ledger = RequestLedger::default();
    let preparations = AtomicUsize::new(0);
    for _ in 0..2 {
        let result = ledger.run_staged(
            &db,
            "key",
            "workerStart",
            &json!({}),
            |_| Ok(()),
            |tx| {
                preparations.fetch_add(1, Ordering::SeqCst);
                prepare(tx)?;
                Err::<(), _>(RpcError::new("not_ready", "blocked dependency"))
            },
            |_| panic!("refused admission must not run an effect"),
            finalize,
        );
        assert_eq!(result.unwrap_err().code, "not_ready");
    }
    assert_eq!(preparations.load(Ordering::SeqCst), 1);
    let count: u32 = db
        .lock()
        .unwrap()
        .query_row("SELECT count(*) FROM staged_probe", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn final_receipt_failure_keeps_effect_uncertain_and_rolls_back_finalization() {
    let (dir, db) = fixture();
    let ledger = RequestLedger::default();
    db.lock().unwrap().execute_batch("CREATE TRIGGER reject_finish BEFORE UPDATE ON requests BEGIN SELECT RAISE(ABORT, 'injected'); END;").unwrap();
    let effects = AtomicUsize::new(0);
    for _ in 0..2 {
        let result = ledger.run_staged(
            &db,
            "key",
            "workerStart",
            &json!({}),
            |_| Ok(()),
            prepare,
            |_| {
                effects.fetch_add(1, Ordering::SeqCst);
                Ok(json!({"spawned":true}))
            },
            finalize,
        );
        assert_eq!(result.unwrap_err().code, "unverifiable");
    }
    assert_eq!(effects.load(Ordering::SeqCst), 1);
    let phase: String = db
        .lock()
        .unwrap()
        .query_row("SELECT phase FROM staged_probe", [], |r| r.get(0))
        .unwrap();
    assert_eq!(phase, "admitted");
    db.lock()
        .unwrap()
        .execute_batch("DROP TRIGGER reject_finish;")
        .unwrap();
    drop(db);
    let reopened = Mutex::new(crate::db::open(&dir.path().canonicalize().unwrap()).unwrap());
    let fresh_ledger = RequestLedger::default();
    let result = fresh_ledger.run_staged(
        &reopened,
        "key",
        "workerStart",
        &json!({}),
        |_| Ok(()),
        prepare,
        |_| panic!("pending after reopen is not launch authority"),
        finalize,
    );
    assert_eq!(result.unwrap_err().code, "unverifiable");
}

#[test]
fn authorization_precedes_both_saved_and_in_memory_receipt_inspection() {
    for uncertain in [false, true] {
        let (_dir, db) = fixture();
        let ledger = RequestLedger::default();
        if uncertain {
            db.lock().unwrap().execute_batch("CREATE TRIGGER reject_finish BEFORE UPDATE ON requests BEGIN SELECT RAISE(ABORT, 'injected'); END;").unwrap();
        }
        let _ = ledger.run_staged(
            &db,
            "key",
            "workerStart",
            &json!({}),
            |_| Ok(()),
            prepare,
            |_| Ok(json!({})),
            finalize,
        );
        let result = ledger.run_staged(
            &db,
            "key",
            "workerStart",
            &json!({"changed":true}),
            |_| Err(RpcError::new("consumer_fenced", "changed owner")),
            prepare,
            |_| panic!("fenced request must not execute"),
            finalize,
        );
        assert_eq!(result.unwrap_err().code, "consumer_fenced");
    }
}

#[test]
fn concurrent_callers_join_one_effect_and_receive_identical_results() {
    let (_dir, db) = fixture();
    let db = Arc::new(db);
    let ledger = Arc::new(RequestLedger::default());
    let effects = Arc::new(AtomicUsize::new(0));
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let leader = {
        let (db, ledger, effects) = (db.clone(), ledger.clone(), effects.clone());
        std::thread::spawn(move || {
            ledger.run_staged(
                &db,
                "key",
                "workerStart",
                &json!({}),
                |_| Ok(()),
                prepare,
                |_| {
                    effects.fetch_add(1, Ordering::SeqCst);
                    entered_tx.send(()).unwrap();
                    release_rx
                        .recv_timeout(std::time::Duration::from_secs(5))
                        .unwrap();
                    Ok(json!({"session":"exact"}))
                },
                finalize,
            )
        })
    };
    entered_rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    let (admitted_tx, admitted_rx) = std::sync::mpsc::channel();
    let follower = {
        let (db, ledger, effects) = (db.clone(), ledger.clone(), effects.clone());
        std::thread::spawn(move || {
            ledger.run_staged(
                &db,
                "key",
                "workerStart",
                &json!({}),
                |_| {
                    admitted_tx.send(()).unwrap();
                    Ok(())
                },
                prepare,
                |_| {
                    effects.fetch_add(1, Ordering::SeqCst);
                    Ok(json!({"wrong":"duplicate"}))
                },
                finalize,
            )
        })
    };
    admitted_rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    release_tx.send(()).unwrap();
    assert_eq!(
        leader.join().unwrap().unwrap(),
        follower.join().unwrap().unwrap()
    );
    assert_eq!(effects.load(Ordering::SeqCst), 1);
}

#[test]
fn effect_panic_is_uncertain_and_never_reexecuted() {
    let (_dir, db) = fixture();
    let ledger = RequestLedger::default();
    let effects = AtomicUsize::new(0);
    for _ in 0..2 {
        let result = ledger.run_staged(
            &db,
            "key",
            "workerStart",
            &json!({}),
            |_| Ok(()),
            prepare,
            |_| {
                effects.fetch_add(1, Ordering::SeqCst);
                panic!("injected panic after external effect");
            },
            |_, _| Ok(()),
        );
        assert_eq!(result.unwrap_err().code, "unverifiable");
    }
    assert_eq!(effects.load(Ordering::SeqCst), 1);
}

#[test]
fn final_commit_failure_rolls_back_domain_finalization_without_repeating_effect() {
    let (_dir, db) = fixture();
    db.lock().unwrap().execute_batch(
        "PRAGMA foreign_keys = ON;
         CREATE TABLE staged_parent (id INTEGER PRIMARY KEY);
         CREATE TABLE staged_child (parent INTEGER REFERENCES staged_parent(id) DEFERRABLE INITIALLY DEFERRED);"
    ).unwrap();
    let ledger = RequestLedger::default();
    let effects = AtomicUsize::new(0);
    for _ in 0..2 {
        let result = ledger.run_staged(
            &db,
            "key",
            "workerStart",
            &json!({}),
            |_| Ok(()),
            prepare,
            |_| {
                effects.fetch_add(1, Ordering::SeqCst);
                Ok(json!({"spawned":true}))
            },
            |tx, result| {
                finalize(tx, result)?;
                tx.execute("INSERT INTO staged_child VALUES (999)", [])
                    .map_err(error::from_sqlite)?;
                Ok(())
            },
        );
        assert_eq!(result.unwrap_err().code, "unverifiable");
    }
    assert_eq!(effects.load(Ordering::SeqCst), 1);
    let conn = db.lock().unwrap();
    let phase: String = conn
        .query_row("SELECT phase FROM staged_probe", [], |r| r.get(0))
        .unwrap();
    let count: u32 = conn
        .query_row("SELECT count(*) FROM staged_child", [], |r| r.get(0))
        .unwrap();
    assert_eq!(phase, "admitted");
    assert_eq!(count, 0);
}

#[test]
fn missing_pending_row_cannot_produce_a_false_success_receipt() {
    let (_dir, db) = fixture();
    let ledger = RequestLedger::default();
    let effects = AtomicUsize::new(0);
    for _ in 0..2 {
        let result = ledger.run_staged(
            &db,
            "key",
            "workerStart",
            &json!({}),
            |_| Ok(()),
            prepare,
            |_| {
                effects.fetch_add(1, Ordering::SeqCst);
                db.lock()
                    .unwrap()
                    .execute("DELETE FROM requests WHERE request_id = 'key'", [])
                    .unwrap();
                Ok(json!({"spawned":true}))
            },
            finalize,
        );
        assert_eq!(result.unwrap_err().code, "unverifiable");
    }
    assert_eq!(effects.load(Ordering::SeqCst), 1);
    let phase: String = db
        .lock()
        .unwrap()
        .query_row("SELECT phase FROM staged_probe", [], |r| r.get(0))
        .unwrap();
    assert_eq!(phase, "admitted");
}

#[test]
fn failed_admission_commit_never_runs_an_external_effect() {
    let (_dir, db) = fixture();
    db.lock().unwrap().execute_batch(
        "PRAGMA foreign_keys = ON;
         CREATE TABLE staged_parent (id INTEGER PRIMARY KEY);
         CREATE TABLE staged_child (parent INTEGER REFERENCES staged_parent(id) DEFERRABLE INITIALLY DEFERRED);"
    ).unwrap();
    let ledger = RequestLedger::default();
    let result = ledger.run_staged(
        &db,
        "key",
        "workerStart",
        &json!({}),
        |_| Ok(()),
        |tx| {
            prepare(tx)?;
            tx.execute("INSERT INTO staged_child VALUES (999)", [])
                .map_err(error::from_sqlite)?;
            Ok(())
        },
        |_| panic!("failed admission commit cannot authorize an effect"),
        finalize,
    );
    assert_eq!(result.unwrap_err().code, "unverifiable");
    let conn = db.lock().unwrap();
    for table in ["requests", "staged_probe", "staged_child"] {
        let count: u32 = conn
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0, "failed commit persisted {table}");
    }
}
