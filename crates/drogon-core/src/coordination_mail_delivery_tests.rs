//! Real-SQLite tests for check/ack/peek/all: FIFO batches, one outstanding
//! delivery per consumer key, replay, takeover, wake filters and cursors.

use rusqlite::{Connection, TransactionBehavior};
use serde_json::json;

use super::{Consumer, check_unread_in_tx, inspect_in_tx};
use crate::coordination_mail::{Actor, NewMessage, Recipient, append_message_in_tx, migrate_in_tx};
use drogon_protocol::orchestration_mail::MessageKind;

const HOST: &str = "host-1";
const RUN: &str = "run-1";

fn migrated_conn() -> Connection {
    let mut conn = Connection::open_in_memory().expect("in-memory fixture db");
    let tx = conn.transaction().expect("begin");
    migrate_in_tx(&tx).expect("migrate");
    tx.commit().expect("commit");
    conn
}

fn seed_messages(conn: &mut Connection, to: &Recipient, count: usize, kind: MessageKind) {
    let tx = conn.transaction().unwrap();
    let from = Actor::Coordinator("coord-1".into());
    for i in 0..count {
        append_message_in_tx(
            &tx,
            NewMessage {
                message_id: &format!("m{i}"),
                host_id: HOST,
                run_id: RUN,
                kind,
                from: &from,
                to,
                subject: &format!("s{i}"),
                body: None,
                payload: None,
                thread_id: None,
                origin_request_id: &format!("r{i}"),
                created_at: "t",
            },
        )
        .unwrap();
    }
    tx.commit().unwrap();
}

fn coordinator(generation: u64) -> Consumer {
    Consumer::Coordinator {
        coordinator_id: "coord-1".into(),
        generation,
    }
}

#[test]
fn fifo_batch_is_ordered_and_capped_at_fifty() {
    let mut conn = migrated_conn();
    seed_messages(&mut conn, &Recipient::RunHome, 60, MessageKind::Status);
    let tx = conn.transaction().unwrap();
    let outcome = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        None,
        &[],
        "d1",
    )
    .unwrap();
    let delivery = outcome.delivery.expect("delivery allocated");
    assert_eq!(delivery.message_ids.len(), 50);
    assert_eq!(delivery.message_ids[0], "m0");
    assert_eq!(delivery.message_ids[49], "m49");
    assert_eq!(outcome.messages.len(), 50);
}

#[test]
fn two_checkers_same_consumer_key_get_one_delivery() {
    let mut conn = migrated_conn();
    seed_messages(&mut conn, &Recipient::RunHome, 3, MessageKind::Status);
    let tx = conn.transaction().unwrap();
    let first = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        None,
        &[],
        "d1",
    )
    .unwrap();
    tx.commit().unwrap();
    let tx = conn.transaction().unwrap();
    let second = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        None,
        &[],
        "d2",
    )
    .unwrap();
    tx.commit().unwrap();
    assert_eq!(
        first.delivery.unwrap().delivery_id,
        second.delivery.unwrap().delivery_id
    );
}

#[test]
fn real_two_connection_race_serializes_to_one_delivery() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("mail.sqlite3");
    {
        let mut conn = Connection::open(&path).unwrap();
        let tx = conn.transaction().unwrap();
        migrate_in_tx(&tx).unwrap();
        tx.commit().unwrap();
        seed_messages(&mut conn, &Recipient::RunHome, 2, MessageKind::Status);
    }
    let mut conn_a = Connection::open(&path).unwrap();
    let mut conn_b = Connection::open(&path).unwrap();
    // Immediate acquires the write lock at BEGIN, so the second connection's
    // whole transaction (including its own active-delivery lookup) really
    // runs after the first commits -- a genuine cross-connection race, not
    // an in-process ordering assumption.
    let tx_a = conn_a
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    let a = check_unread_in_tx(
        &tx_a,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        None,
        &[],
        "shared",
    )
    .unwrap();
    tx_a.commit().unwrap();
    let tx_b = conn_b
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    let b = check_unread_in_tx(
        &tx_b,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        None,
        &[],
        "shared-2",
    )
    .unwrap();
    tx_b.commit().unwrap();
    assert_eq!(
        a.delivery.unwrap().delivery_id,
        b.delivery.unwrap().delivery_id
    );
}

#[test]
fn whole_ack_advances_and_allocates_next_batch() {
    let mut conn = migrated_conn();
    seed_messages(&mut conn, &Recipient::RunHome, 4, MessageKind::Status);
    let tx = conn.transaction().unwrap();
    let first = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        None,
        &[],
        "d1",
    )
    .unwrap();
    let delivery_id = first.delivery.unwrap().delivery_id;
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    let second = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        Some(&delivery_id),
        &[],
        "d2",
    )
    .unwrap();
    assert!(!second.acknowledged.unwrap().already_acknowledged);
    assert!(second.delivery.is_none(), "no more unread mail to allocate");
    tx.commit().unwrap();
}

#[test]
fn duplicate_ack_is_idempotent() {
    let mut conn = migrated_conn();
    seed_messages(&mut conn, &Recipient::RunHome, 1, MessageKind::Status);
    let tx = conn.transaction().unwrap();
    let first = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        None,
        &[],
        "d1",
    )
    .unwrap();
    let delivery_id = first.delivery.unwrap().delivery_id;
    tx.commit().unwrap();

    for expected_already in [false, true] {
        let tx = conn.transaction().unwrap();
        let outcome = check_unread_in_tx(
            &tx,
            HOST,
            RUN,
            &Recipient::RunHome,
            &coordinator(1),
            Some(&delivery_id),
            &[],
            "unused",
        )
        .unwrap();
        assert_eq!(
            outcome.acknowledged.unwrap().already_acknowledged,
            expected_already
        );
        tx.commit().unwrap();
    }
}

#[test]
fn cross_run_recipient_host_and_generation_ack_is_rejected() {
    let mut conn = migrated_conn();
    seed_messages(&mut conn, &Recipient::RunHome, 1, MessageKind::Status);
    let tx = conn.transaction().unwrap();
    let delivery_id = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        None,
        &[],
        "d1",
    )
    .unwrap()
    .delivery
    .unwrap()
    .delivery_id;
    tx.commit().unwrap();

    let cases: Vec<(&str, &str, Recipient, Consumer)> = vec![
        ("other-run", HOST, Recipient::RunHome, coordinator(1)),
        (RUN, "other-host", Recipient::RunHome, coordinator(1)),
        (
            RUN,
            HOST,
            Recipient::Dispatch("d".into()),
            Consumer::Dispatch,
        ),
        (RUN, HOST, Recipient::RunHome, coordinator(2)),
    ];
    for (run, host, recipient, consumer) in cases {
        let tx = conn.transaction().unwrap();
        let err = check_unread_in_tx(
            &tx,
            host,
            run,
            &recipient,
            &consumer,
            Some(&delivery_id),
            &[],
            "unused",
        )
        .unwrap_err();
        assert_eq!(err.code, "invalid_argument");
        tx.rollback().unwrap();
    }
}

#[test]
fn old_delivery_id_cannot_be_acked_but_new_generation_still_gets_the_unread_mail() {
    let mut conn = migrated_conn();
    seed_messages(&mut conn, &Recipient::RunHome, 2, MessageKind::Status);
    let tx = conn.transaction().unwrap();
    let old_delivery = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        None,
        &[],
        "gen1",
    )
    .unwrap()
    .delivery
    .unwrap();
    tx.commit().unwrap();

    // Takeover: generation 2 must still be able to allocate the same
    // still-unread mail (never acknowledged by generation 1).
    let tx = conn.transaction().unwrap();
    let new_gen = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(2),
        None,
        &[],
        "gen2",
    )
    .unwrap();
    let new_delivery = new_gen
        .delivery
        .expect("takeover does not lose unread mail");
    assert_eq!(new_delivery.message_ids, old_delivery.message_ids);
    tx.commit().unwrap();

    // The old generation may not ACK it (fenced), even though the exact
    // delivery id it was handed still names a real (but now foreign) row.
    let tx = conn.transaction().unwrap();
    let err = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        Some(&old_delivery.delivery_id),
        &[],
        "unused",
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn kind_filter_never_skips_earlier_nonmatching_messages() {
    let mut conn = migrated_conn();
    seed_messages(&mut conn, &Recipient::RunHome, 2, MessageKind::Status);
    let tx = conn.transaction().unwrap();
    let from = Actor::Coordinator("coord-1".into());
    append_message_in_tx(
        &tx,
        NewMessage {
            message_id: "guidance-1",
            host_id: HOST,
            run_id: RUN,
            kind: MessageKind::Guidance,
            from: &from,
            to: &Recipient::RunHome,
            subject: "g",
            body: None,
            payload: None,
            thread_id: None,
            origin_request_id: "rg",
            created_at: "t",
        },
    )
    .unwrap();
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    let outcome = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        None,
        &[MessageKind::Guidance],
        "d1",
    )
    .unwrap();
    let delivery = outcome.delivery.expect("wake condition met");
    // The whole FIFO batch, including the earlier non-matching status
    // messages, is returned -- the filter never trims it.
    assert_eq!(delivery.message_ids, vec!["m0", "m1", "guidance-1"]);
}

#[test]
fn no_matching_wake_kind_allocates_nothing() {
    let mut conn = migrated_conn();
    seed_messages(&mut conn, &Recipient::RunHome, 2, MessageKind::Status);
    let tx = conn.transaction().unwrap();
    let outcome = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        None,
        &[MessageKind::Guidance],
        "d1",
    )
    .unwrap();
    assert!(outcome.delivery.is_none());
    assert!(outcome.messages.is_empty());
    tx.commit().unwrap();
    // No delivery row was created for the unmet wake condition.
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM orchestration_mail_deliveries",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn existing_delivery_ignores_kind_filter_and_returns_whole_batch() {
    let mut conn = migrated_conn();
    seed_messages(&mut conn, &Recipient::RunHome, 2, MessageKind::Status);
    let tx = conn.transaction().unwrap();
    let first = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        None,
        &[],
        "d1",
    )
    .unwrap();
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    let replay = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        None,
        &[MessageKind::Guidance],
        "unused",
    )
    .unwrap();
    assert_eq!(replay.delivery, first.delivery);
}

#[test]
fn peek_and_all_never_create_a_delivery_or_move_the_read_pointer() {
    let mut conn = migrated_conn();
    seed_messages(&mut conn, &Recipient::RunHome, 3, MessageKind::Status);
    let tx = conn.transaction().unwrap();
    let (peeked, cursor) =
        inspect_in_tx(&tx, HOST, RUN, &Recipient::RunHome, true, &[], None, 100).unwrap();
    assert_eq!(peeked.len(), 3);
    assert!(cursor.is_none());
    tx.commit().unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM orchestration_mail_deliveries",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);

    // A real consuming check still sees all three as unread afterward.
    let tx = conn.transaction().unwrap();
    let outcome = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        None,
        &[],
        "d1",
    )
    .unwrap();
    assert_eq!(outcome.delivery.unwrap().message_ids.len(), 3);
}

#[test]
fn all_mode_still_returns_acknowledged_mail_peek_does_not() {
    let mut conn = migrated_conn();
    seed_messages(&mut conn, &Recipient::RunHome, 1, MessageKind::Status);
    let tx = conn.transaction().unwrap();
    let delivery_id = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        None,
        &[],
        "d1",
    )
    .unwrap()
    .delivery
    .unwrap()
    .delivery_id;
    tx.commit().unwrap();
    let tx = conn.transaction().unwrap();
    check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        Some(&delivery_id),
        &[],
        "unused",
    )
    .unwrap();
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    let (peeked, _) =
        inspect_in_tx(&tx, HOST, RUN, &Recipient::RunHome, true, &[], None, 100).unwrap();
    assert!(peeked.is_empty(), "peek only shows unread mail");
    let (all, _) =
        inspect_in_tx(&tx, HOST, RUN, &Recipient::RunHome, false, &[], None, 100).unwrap();
    assert_eq!(
        all.len(),
        1,
        "all shows retained mail regardless of read state"
    );
}

#[test]
fn cursor_paginates_without_skipping_and_rejects_foreign_scope() {
    let mut conn = migrated_conn();
    seed_messages(&mut conn, &Recipient::RunHome, 5, MessageKind::Status);
    let tx = conn.transaction().unwrap();
    let (page1, cursor1) =
        inspect_in_tx(&tx, HOST, RUN, &Recipient::RunHome, false, &[], None, 2).unwrap();
    assert_eq!(
        page1
            .iter()
            .map(|m| m.message_id.as_str())
            .collect::<Vec<_>>(),
        ["m0", "m1"]
    );
    let cursor1 = cursor1.expect("more pages remain");

    let (page2, cursor2) = inspect_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        false,
        &[],
        Some(&cursor1),
        2,
    )
    .unwrap();
    assert_eq!(
        page2
            .iter()
            .map(|m| m.message_id.as_str())
            .collect::<Vec<_>>(),
        ["m2", "m3"]
    );
    let cursor2 = cursor2.expect("one page remains");

    let (page3, cursor3) = inspect_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        false,
        &[],
        Some(&cursor2),
        2,
    )
    .unwrap();
    assert_eq!(
        page3
            .iter()
            .map(|m| m.message_id.as_str())
            .collect::<Vec<_>>(),
        ["m4"]
    );
    assert!(cursor3.is_none());

    // A cursor minted for a different recipient must never be honored here.
    let err = inspect_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::Dispatch("other".into()),
        false,
        &[],
        Some(&cursor1),
        2,
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn response_budget_stops_a_page_without_omitting_the_boundary_message() {
    let mut conn = migrated_conn();
    let tx = conn.transaction().unwrap();
    let from = Actor::Coordinator("coord-1".into());
    let big_body = "x".repeat(super::RESPONSE_BUDGET_BYTES / 2 + 1);
    for i in 0..3 {
        append_message_in_tx(
            &tx,
            NewMessage {
                message_id: &format!("big{i}"),
                host_id: HOST,
                run_id: RUN,
                kind: MessageKind::Status,
                from: &from,
                to: &Recipient::RunHome,
                subject: "s",
                body: Some(&big_body),
                payload: None,
                thread_id: None,
                origin_request_id: &format!("r{i}"),
                created_at: "t",
            },
        )
        .unwrap();
    }
    tx.commit().unwrap();
    let tx = conn.transaction().unwrap();
    let (page1, cursor1) =
        inspect_in_tx(&tx, HOST, RUN, &Recipient::RunHome, false, &[], None, 100).unwrap();
    assert_eq!(
        page1.len(),
        1,
        "budget stops after the first oversized-adjacent message"
    );
    let cursor1 = cursor1.expect("more remain");
    let (page2, _) = inspect_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        false,
        &[],
        Some(&cursor1),
        100,
    )
    .unwrap();
    assert_eq!(page2.len(), 1, "the boundary message was not skipped");
}

#[test]
fn dispatch_inbox_consumer_must_be_that_dispatch() {
    let mut conn = migrated_conn();
    seed_messages(
        &mut conn,
        &Recipient::Dispatch("d1".into()),
        1,
        MessageKind::Status,
    );
    let tx = conn.transaction().unwrap();
    let err = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::Dispatch("d1".into()),
        &coordinator(1),
        None,
        &[],
        "d1-try",
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    let ok = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::Dispatch("d1".into()),
        &Consumer::Dispatch,
        None,
        &[],
        "d1-ok",
    )
    .unwrap();
    assert!(ok.delivery.is_some());
    let _ = json!({});
}
