//! Real-SQLite tests for message append/read and the additive v1 migration.

use rusqlite::Connection;
use serde_json::json;

use super::{Actor, NewMessage, Recipient, append_message_in_tx, get_message_in_tx, migrate_in_tx};
use drogon_protocol::orchestration_mail::MessageKind;

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
