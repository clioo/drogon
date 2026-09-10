//! Real-SQLite tests for message append/read and the additive v1 migration.

use rusqlite::Connection;
use serde_json::json;

use super::{Actor, NewMessage, Recipient, append_message_in_tx, get_message_in_tx, migrate_in_tx};
use drogon_protocol::orchestration_mail::{MessageKind, MessagePriority};

fn migrated_conn() -> Connection {
    let mut conn = Connection::open_in_memory().expect("in-memory fixture db");
    let tx = conn.transaction().expect("begin");
    migrate_in_tx(&tx).expect("migrate");
    tx.commit().expect("commit");
    conn
}

fn coordinator_from() -> Actor {
    Actor::Coordinator("coord-1".into())
}

#[test]
fn migration_creates_tables_and_is_idempotent() {
    let mut conn = migrated_conn();
    let tx = conn.transaction().expect("begin");
    migrate_in_tx(&tx).expect("second migrate is a no-op");
    tx.commit().expect("commit");
    conn.execute("SELECT 1 FROM orchestration_mail_messages", [])
        .expect("messages table exists");
    conn.execute("SELECT 1 FROM orchestration_mail_deliveries", [])
        .expect("deliveries table exists");
    conn.execute("SELECT 1 FROM orchestration_mail_read_pointers", [])
        .expect("read pointers table exists");
    conn.execute("SELECT 1 FROM orchestration_mail_questions", [])
        .expect("questions table exists");
}

#[test]
fn migration_rollback_undoes_every_table() {
    let mut conn = Connection::open_in_memory().expect("in-memory fixture db");
    {
        let tx = conn.transaction().expect("begin");
        migrate_in_tx(&tx).expect("migrate");
        // Dropped without commit: real SQLite DDL is transactional.
    }
    let err = conn
        .execute("SELECT 1 FROM orchestration_mail_messages", [])
        .unwrap_err();
    assert!(format!("{err}").contains("no such table"));
}

#[test]
fn future_schema_version_is_refused_before_touching_tables() {
    let mut conn = Connection::open_in_memory().expect("in-memory fixture db");
    {
        let tx = conn.transaction().expect("begin");
        tx.execute_batch(
            "CREATE TABLE schema_versions (component TEXT PRIMARY KEY, version INTEGER NOT NULL);
             INSERT INTO schema_versions VALUES ('orchestration_mail', 999);",
        )
        .unwrap();
        tx.commit().unwrap();
    }
    let tx = conn.transaction().expect("begin");
    let err = migrate_in_tx(&tx).unwrap_err();
    assert_eq!(err.code, "unsupported_orchestration_contract");
    tx.rollback().unwrap();
    let err = conn
        .execute("SELECT 1 FROM orchestration_mail_messages", [])
        .unwrap_err();
    assert!(format!("{err}").contains("no such table"));
}

#[test]
fn append_and_read_exact_message_round_trips_every_immutable_field() {
    let mut conn = migrated_conn();
    let tx = conn.transaction().unwrap();
    let from = coordinator_from();
    let to = Recipient::Dispatch("dispatch-1".into());
    let summary = append_message_in_tx(
        &tx,
        NewMessage {
            message_id: "msg-1",
            host_id: "host-1",
            run_id: "run-1",
            kind: MessageKind::Guidance,
            from: &from,
            to: &to,
            subject: "hello",
            body: Some("body text"),
            payload: Some(&json!({"k": "v"})),
            priority: MessagePriority::Normal,
            thread_id: None,
            origin_request_id: "req-1",
            created_at: "2026-09-07T00:00:00Z",
        },
    )
    .expect("append");
    assert_eq!(summary.message_id, "msg-1");
    assert_eq!(summary.thread_id.as_deref(), Some("msg-1"));
    assert_eq!(summary.from_actor, "coordinator:coord-1");
    assert_eq!(summary.to_actor.as_deref(), Some("dispatch:dispatch-1"));
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    let stored = get_message_in_tx(&tx, "host-1", "run-1", "msg-1")
        .unwrap()
        .expect("message exists");
    assert_eq!(stored.summary.subject, "hello");
    assert_eq!(stored.summary.body.as_deref(), Some("body text"));
    assert_eq!(stored.summary.payload, Some(json!({"k": "v"})));
    assert_eq!(stored.to, Recipient::Dispatch("dispatch-1".into()));
}

#[test]
fn message_without_explicit_thread_starts_its_own_thread() {
    let mut conn = migrated_conn();
    let tx = conn.transaction().unwrap();
    let from = Actor::Dispatch("dispatch-1".into());
    let summary = append_message_in_tx(
        &tx,
        NewMessage {
            message_id: "msg-2",
            host_id: "host-1",
            run_id: "run-1",
            kind: MessageKind::Status,
            from: &from,
            to: &Recipient::RunHome,
            subject: "status",
            body: None,
            payload: None,
            priority: MessagePriority::Normal,
            thread_id: None,
            origin_request_id: "req-2",
            created_at: "2026-09-07T00:00:00Z",
        },
    )
    .unwrap();
    assert_eq!(summary.thread_id.as_deref(), Some("msg-2"));
    assert_eq!(summary.to_actor, None);
}

#[test]
fn duplicate_message_id_is_refused() {
    let mut conn = migrated_conn();
    let from = coordinator_from();
    let tx = conn.transaction().unwrap();
    append_message_in_tx(
        &tx,
        NewMessage {
            message_id: "dup",
            host_id: "host-1",
            run_id: "run-1",
            kind: MessageKind::Status,
            from: &from,
            to: &Recipient::RunHome,
            subject: "s",
            body: None,
            payload: None,
            priority: MessagePriority::Normal,
            thread_id: None,
            origin_request_id: "r1",
            created_at: "t",
        },
    )
    .unwrap();
    tx.commit().unwrap();
    let tx = conn.transaction().unwrap();
    let err = append_message_in_tx(
        &tx,
        NewMessage {
            message_id: "dup",
            host_id: "host-1",
            run_id: "run-1",
            kind: MessageKind::Status,
            from: &from,
            to: &Recipient::RunHome,
            subject: "s2",
            body: None,
            payload: None,
            priority: MessagePriority::Normal,
            thread_id: None,
            origin_request_id: "r2",
            created_at: "t",
        },
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn oversized_body_is_refused_before_any_mutation() {
    let mut conn = migrated_conn();
    let from = coordinator_from();
    let tx = conn.transaction().unwrap();
    let huge = "a".repeat(super::RESPONSE_BUDGET_BYTES + 1);
    let err = append_message_in_tx(
        &tx,
        NewMessage {
            message_id: "big",
            host_id: "host-1",
            run_id: "run-1",
            kind: MessageKind::Status,
            from: &from,
            to: &Recipient::RunHome,
            subject: "s",
            body: Some(&huge),
            payload: None,
            priority: MessagePriority::Normal,
            thread_id: None,
            origin_request_id: "r1",
            created_at: "t",
        },
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    tx.rollback().unwrap();
    let tx = conn.transaction().unwrap();
    assert!(
        get_message_in_tx(&tx, "host-1", "run-1", "big")
            .unwrap()
            .is_none()
    );
}

#[test]
fn genuine_commit_persists_across_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("mail.sqlite3");
    {
        let mut conn = Connection::open(&path).unwrap();
        let tx = conn.transaction().unwrap();
        migrate_in_tx(&tx).unwrap();
        let from = coordinator_from();
        append_message_in_tx(
            &tx,
            NewMessage {
                message_id: "persisted",
                host_id: "host-1",
                run_id: "run-1",
                kind: MessageKind::Status,
                from: &from,
                to: &Recipient::RunHome,
                subject: "s",
                body: None,
                payload: None,
                priority: MessagePriority::Normal,
                thread_id: None,
                origin_request_id: "r1",
                created_at: "t",
            },
        )
        .unwrap();
        tx.commit().unwrap();
    }
    let mut conn = Connection::open(&path).unwrap();
    let tx = conn.transaction().unwrap();
    let stored = get_message_in_tx(&tx, "host-1", "run-1", "persisted").unwrap();
    assert!(stored.is_some());
}

#[test]
fn a_recorded_schema_value_other_than_exactly_one_is_refused_not_silently_advanced() {
    let mut conn = Connection::open_in_memory().unwrap();
    {
        let tx = conn.transaction().unwrap();
        tx.execute_batch(
            "CREATE TABLE schema_versions (component TEXT PRIMARY KEY, version INTEGER NOT NULL);
             INSERT INTO schema_versions VALUES ('orchestration_mail', 0);",
        )
        .unwrap();
        tx.commit().unwrap();
    }
    let tx = conn.transaction().unwrap();
    let err = migrate_in_tx(&tx)
        .expect_err("a stored 0 is neither absent nor the current version and must not be silently stepped forward");
    assert_eq!(err.code, "unsupported_orchestration_contract");
}

#[test]
fn corrupt_from_kind_identity_is_rejected_not_defaulted_to_an_empty_dispatch() {
    let mut conn = migrated_conn();
    let tx = conn.transaction().unwrap();
    // Bypasses `append_message_in_tx` on purpose: this simulates a row this
    // module never wrote (external corruption, or a future schema drift)
    // rather than anything reachable through the public API.
    tx.execute(
        "INSERT INTO orchestration_mail_messages
            (message_id, host_id, run_id, kind, from_kind, from_coordinator_id, from_dispatch_id,
             to_dispatch_id, subject, body, payload_json, thread_id, origin_request_id, created_at)
         VALUES ('corrupt', 'host-1', 'run-1', 'status', 'mystery', NULL, NULL, '', 's', NULL, NULL, 'corrupt', 'r1', 't')",
        [],
    )
    .unwrap();
    tx.commit().unwrap();
    let tx = conn.transaction().unwrap();
    let err = get_message_in_tx(&tx, "host-1", "run-1", "corrupt")
        .expect_err("an unknown from_kind must never silently become an empty-id Dispatch actor");
    assert_eq!(err.code, "internal_error");
}

#[test]
fn sentinel_trigger_proves_no_raw_driver_text_echo() {
    let mut conn = migrated_conn();
    const SENTINEL: &str = "SENTINEL-PRIVATE-BODY-CONTENT-4f2c";
    conn.execute_batch(&format!(
        "CREATE TEMP TRIGGER sentinel_leak_check BEFORE INSERT ON orchestration_mail_messages
         WHEN NEW.subject = '{SENTINEL}'
         BEGIN
             SELECT RAISE(ABORT, '{SENTINEL}');
         END;"
    ))
    .unwrap();
    let from = coordinator_from();
    let tx = conn.transaction().unwrap();
    let err = append_message_in_tx(
        &tx,
        NewMessage {
            message_id: "trig",
            host_id: "host-1",
            run_id: "run-1",
            kind: MessageKind::Status,
            from: &from,
            to: &Recipient::RunHome,
            subject: SENTINEL,
            body: None,
            payload: None,
            priority: MessagePriority::Normal,
            thread_id: None,
            origin_request_id: "r1",
            created_at: "t",
        },
    )
    .expect_err("the trigger aborts the insert");
    let rendered = format!("{err:?} {}", err.message);
    assert!(
        !rendered.contains(SENTINEL),
        "raw driver/trigger text must never reach the wire error: got {rendered:?}"
    );
}

#[test]
fn high_escape_body_is_measured_by_actual_serialized_size_not_raw_length() {
    let mut conn = migrated_conn();
    let from = coordinator_from();
    let tx = conn.transaction().unwrap();
    // Every quote byte doubles under JSON escaping (`"` -> `\"`), so this
    // body's raw length is comfortably under budget but its real wire size
    // is not -- a length-only check would wrongly accept it.
    let escaped = "\"".repeat(super::RESPONSE_BUDGET_BYTES * 3 / 5);
    assert!(escaped.len() < super::RESPONSE_BUDGET_BYTES);
    let err = append_message_in_tx(
        &tx,
        NewMessage {
            message_id: "escaped",
            host_id: "host-1",
            run_id: "run-1",
            kind: MessageKind::Status,
            from: &from,
            to: &Recipient::RunHome,
            subject: "s",
            body: Some(&escaped),
            payload: None,
            priority: MessagePriority::Normal,
            thread_id: None,
            origin_request_id: "r1",
            created_at: "t",
        },
    )
    .expect_err("actual JSON-serialized size, not raw length, must be measured");
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn origin_request_id_and_typed_sender_survive_a_real_read() {
    let mut conn = migrated_conn();
    let from = Actor::Dispatch("dispatch-9".into());
    let tx = conn.transaction().unwrap();
    append_message_in_tx(
        &tx,
        NewMessage {
            message_id: "typed",
            host_id: "host-1",
            run_id: "run-1",
            kind: MessageKind::FinalReport,
            from: &from,
            to: &Recipient::RunHome,
            subject: "s",
            body: None,
            payload: None,
            priority: MessagePriority::Normal,
            thread_id: None,
            origin_request_id: "origin-req-77",
            created_at: "t",
        },
    )
    .unwrap();
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    let stored = get_message_in_tx(&tx, "host-1", "run-1", "typed")
        .unwrap()
        .expect("message exists");
    assert_eq!(stored.from, Actor::Dispatch("dispatch-9".into()));
    assert_eq!(stored.origin_request_id, "origin-req-77");
}
