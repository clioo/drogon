//! C10 integration proof: bounded digest monitors with durable change events.
//!
//! Imports the real `drogon_core::bots::monitors` tree (export seam
//! granted); the units under test are pure computation plus
//! controlled-filesystem SQLite (`tempfile`), never Engine construction,
//! sessions, daemons, CLI, servers, or native children.

use drogon_core::bots::monitors::commit::{
    self, CommitDecision, CommitInput, RetainReason, StoredMonitorState,
};
use drogon_core::bots::monitors::eval;
use drogon_core::bots::monitors::policy;
use drogon_core::bots::monitors::record::{self, MonitorTrigger, new_monitor};
use drogon_core::bots::monitors::result::{MonitorErrorKind, MonitorOutcome};
use drogon_core::bots::monitors::rule::{LocalFileRule, MonitorRule};
use drogon_core::bots::monitors::storage;

fn test_rule() -> MonitorRule {
    MonitorRule::LocalFileDigest(LocalFileRule {
        host_id: "host-1".to_string(),
        project_id: "proj-1".to_string(),
        resource: "notes/status.md".to_string(),
        max_bytes: 64 * 1024,
    })
}

fn test_record() -> record::MonitorRecord {
    let rule = test_rule();
    let hash = rule.approval_hash();
    new_monitor(
        "mon-1".to_string(),
        Some("bot-1".to_string()),
        rule,
        MonitorTrigger::Manual,
        hash,
        1_000.0,
    )
    .expect("fresh monitor validates and is approved")
}

fn stored_of(rec: &record::MonitorRecord) -> StoredMonitorState {
    StoredMonitorState {
        monitor_id: rec.id.clone(),
        version: rec.version,
        cursor: rec.cursor.clone(),
        last_event_id: rec.last_event_id.clone(),
        enabled: rec.enabled,
    }
}

#[test]
fn unchanged_repeats_and_restarts_emit_nothing() {
    let rec = test_record();
    let first = eval::evaluate_bytes(&rec, b"hello world", 10.0);
    let event_id = first
        .event_id()
        .expect("first read is a change")
        .to_string();
    let cursor = first.cursor().expect("change carries a cursor").to_string();

    // Commit once.
    let decision = commit::decide_commit(
        &stored_of(&rec),
        "host-1",
        "proj-1",
        "notes/status.md",
        &first,
        &CommitInput {
            expected_version: 1,
        },
    );
    let intent = match decision {
        CommitDecision::Advance { intent, .. } => intent,
        other => panic!("expected one advance, got {other:?}"),
    };
    assert_eq!(intent.event_id, event_id);

    // Same bytes after "restart" (fresh record with the committed cursor).
    let mut restarted = test_record();
    restarted.cursor = Some(cursor.clone());
    restarted.last_event_id = Some(event_id.clone());
    let repeat = eval::evaluate_bytes(&restarted, b"hello world", 20.0);
    assert!(matches!(repeat.outcome, MonitorOutcome::NoChange { .. }));
    assert_eq!(
        commit::decide_commit(
            &stored_of(&restarted),
            "host-1",
            "proj-1",
            "notes/status.md",
            &repeat,
            &CommitInput {
                expected_version: 1
            },
        ),
        CommitDecision::Retain {
            reason: RetainReason::NoChange
        }
    );
    // Unchanged polls never owe the model anything at this layer; this is
    // policy/unit evidence only, not an observed zero through a mounted
    // runtime (that handover is still routed to root).
    assert_eq!(
        policy::MonitorInferencePolicy::model_calls_for_unchanged_poll(),
        0
    );
}

#[test]
fn one_new_version_creates_one_committed_local_event() {
    let rec = test_record();
    let first = eval::evaluate_bytes(&rec, b"v1 bytes", 10.0);
    let first_event = first.event_id().unwrap().to_string();
    let first_cursor = first.cursor().unwrap().to_string();
    let mut committed = rec.clone();
    committed.cursor = Some(first_cursor);
    committed.last_event_id = Some(first_event.clone());

    // New bytes => exactly one new stable event, different from the first.
    let second = eval::evaluate_bytes(&committed, b"v2 bytes", 20.0);
    let second_event = second.event_id().unwrap().to_string();
    assert_ne!(first_event, second_event);
    assert!(matches!(
        commit::decide_commit(
            &stored_of(&committed),
            "host-1",
            "proj-1",
            "notes/status.md",
            &second,
            &CommitInput {
                expected_version: 1
            },
        ),
        CommitDecision::Advance { .. }
    ));
}

#[test]
fn failures_retain_the_prior_cursor_with_honest_errors() {
    let rec = test_record();
    let mut stored = stored_of(&rec);
    stored.cursor = Some(eval::cursor_for_digest(&eval::digest_bytes(b"base")));

    // Absence / forbidden / oversize / timeout are errors, never change.
    let kinds = [
        MonitorErrorKind::NotFound,
        MonitorErrorKind::Forbidden,
        MonitorErrorKind::Unauthorized,
        MonitorErrorKind::IoError,
        MonitorErrorKind::Oversized,
        MonitorErrorKind::Timeout,
    ];
    for kind in kinds {
        let failure = eval::read_failure(&rec, kind, "probe failure", 30.0);
        assert!(failure.is_error());
        assert_eq!(
            commit::decide_commit(
                &stored,
                "host-1",
                "proj-1",
                "notes/status.md",
                &failure,
                &CommitInput {
                    expected_version: 1
                },
            ),
            CommitDecision::Retain {
                reason: RetainReason::ErrorRetained
            }
        );
    }
    // Oversized bytes straight from the evaluator behave the same way.
    let big = vec![b'x'; 70 * 1024];
    let oversized = eval::evaluate_bytes(&rec, &big, 31.0);
    assert!(oversized.is_error());
}

#[test]
fn stale_duplicate_limited_and_disabled_work_never_admits() {
    let rec = test_record();
    let stored = stored_of(&rec);
    let fresh = eval::evaluate_bytes(&rec, b"payload", 40.0);

    // Out-of-order expectation refuses.
    assert!(matches!(
        commit::decide_commit(
            &stored,
            "host-1",
            "proj-1",
            "notes/status.md",
            &fresh,
            &CommitInput {
                expected_version: 0
            },
        ),
        CommitDecision::RefuseStale { .. }
    ));
    // A rule edit bumps the version; the old payload is stale afterward.
    let edited = record::staged_rule_edit(
        rec.clone(),
        MonitorRule::LocalFileDigest(LocalFileRule {
            host_id: "host-1".to_string(),
            project_id: "proj-1".to_string(),
            resource: "notes/other.md".to_string(),
            max_bytes: 64 * 1024,
        }),
        50.0,
    )
    .unwrap();
    assert!(!edited.is_approved());
    assert!(matches!(
        commit::decide_commit(
            &StoredMonitorState {
                version: edited.version,
                ..stored.clone()
            },
            "host-1",
            "proj-1",
            "notes/status.md",
            &fresh,
            &CommitInput {
                expected_version: 1
            },
        ),
        CommitDecision::RefuseStale { .. }
    ));
    // Disabled retains without emitting.
    let disabled = StoredMonitorState {
        enabled: false,
        ..stored.clone()
    };
    assert_eq!(
        commit::decide_commit(
            &disabled,
            "host-1",
            "proj-1",
            "notes/status.md",
            &fresh,
            &CommitInput {
                expected_version: 1
            },
        ),
        CommitDecision::Retain {
            reason: RetainReason::Disabled
        }
    );
    // Rate-limit watermark refuses admission before evaluation even runs.
    assert!(!commit::should_admit(10.0, Some(100.0), true));
    assert!(commit::should_admit(100.0, Some(100.0), true));
}

#[test]
fn storage_cas_and_history_survive_delete_and_reopen() {
    // The aggregate-startup shape (one caller-owned transaction, as
    // `Engine::open` would supply) migrates a fresh database identically.
    // Proposed/unadopted for production until the migration-owner
    // handover; exercised here on a controlled in-memory database only.
    let startup_conn = rusqlite::Connection::open_in_memory().expect("controlled db");
    {
        let tx = startup_conn.unchecked_transaction().expect("begin");
        storage::apply_pending_steps_in_tx(&tx).expect("aggregate steps");
        tx.commit().expect("commit");
    }
    let rec = test_record();
    storage::create_monitor(&startup_conn, &rec).expect("create via aggregate shape");
    assert_eq!(
        storage::list_monitors_for_project(&startup_conn, "host-1", "proj-1")
            .expect("scope list")
            .len(),
        1
    );

    let dir = tempfile::tempdir().expect("controlled temp dir");
    let db_path = dir.path().join("monitors.db");
    let conn = rusqlite::Connection::open(&db_path).expect("open controlled db");
    storage::migrate(&conn).expect("migrate");

    let rec = test_record();
    storage::create_monitor(&conn, &rec).expect("create");
    assert_eq!(
        storage::list_monitors_for_project(&conn, "host-1", "proj-1")
            .expect("scope list")
            .len(),
        1
    );
    assert!(
        storage::list_monitors_for_project(&conn, "host-1", "other-proj")
            .expect("scope list")
            .is_empty()
    );
    let (loaded, rev) = storage::get_monitor(&conn, "mon-1")
        .expect("get")
        .expect("present");
    assert_eq!(loaded.id, "mon-1");

    // Evaluate real controlled-filesystem bytes and record the check.
    let first = eval::evaluate_bytes(&loaded, b"file v1", 60.0);
    let cursor = first.cursor().unwrap().to_string();
    let event_id = first.event_id().unwrap().to_string();
    storage::record_check(
        &conn,
        &storage::StoredCheck {
            id: "chk-1".to_string(),
            monitor_id: "mon-1".to_string(),
            monitor_version: 1,
            started_at_ms: 60.0,
            result: first.clone(),
            delivery: storage::DeliveryState::Pending,
        },
    )
    .expect("record check");

    // Advance the cursor with the stale-rev guard: a racing writer loses.
    let mut advanced = loaded.clone();
    advanced.cursor = Some(cursor.clone());
    advanced.last_event_id = Some(event_id.clone());
    advanced.updated_at_ms = 61.0;
    storage::cas_write(&conn, &advanced, rev).expect("cas advance");
    assert!(matches!(
        storage::cas_write(&conn, &advanced, rev),
        Err(storage::StorageError::StaleUpdate)
    ));

    // Delete stops admissions but keeps history; reopen shows the same.
    assert!(storage::delete_monitor(&conn, "mon-1").expect("delete"));
    assert_eq!(
        storage::list_checks_for_monitor(&conn, "mon-1")
            .expect("history")
            .len(),
        1
    );
    drop(conn);
    let reopened = rusqlite::Connection::open(&db_path).expect("reopen controlled db");
    assert!(
        storage::get_monitor(&reopened, "mon-1")
            .expect("get")
            .is_none()
    );
    assert_eq!(
        storage::list_checks_for_monitor(&reopened, "mon-1")
            .expect("history")
            .len(),
        1
    );
}
