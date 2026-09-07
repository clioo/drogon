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

#[test]
fn inspect_kind_filter_does_not_lose_matching_rows_beyond_the_probe_window() {
    let mut conn = migrated_conn();
    seed_messages(&mut conn, &Recipient::RunHome, 10, MessageKind::Status);
    let tx = conn.transaction().unwrap();
    let from = Actor::Coordinator("coord-1".into());
    append_message_in_tx(
        &tx,
        NewMessage {
            message_id: "guidance-late",
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
    // A small limit means a small unfiltered probe window; the matching
    // Guidance message sits past it and must still be found, not hidden.
    let (page, cursor) = inspect_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        false,
        &[MessageKind::Guidance],
        None,
        5,
    )
    .unwrap();
    assert_eq!(
        page.len(),
        1,
        "the later matching message must be found, not hidden by the probe window"
    );
    assert_eq!(page[0].message_id, "guidance-late");
    assert!(cursor.is_none());
}

#[test]
fn wake_kind_beyond_first_fifty_candidates_still_wakes_and_delivers_oldest_prefix() {
    let mut conn = migrated_conn();
    seed_messages(&mut conn, &Recipient::RunHome, 60, MessageKind::Status);
    let tx = conn.transaction().unwrap();
    let from = Actor::Coordinator("coord-1".into());
    append_message_in_tx(
        &tx,
        NewMessage {
            message_id: "guidance-61",
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
    let delivery = outcome.delivery.expect(
        "a match exists in the full backlog beyond the first 50 candidates and must still wake",
    );
    assert_eq!(delivery.message_ids.len(), 50);
    assert_eq!(delivery.message_ids[0], "m0");
    assert_eq!(delivery.message_ids[49], "m49");
    assert!(
        !delivery.message_ids.contains(&"guidance-61".to_string()),
        "the oldest FIFO prefix is delivered, not the triggering message itself"
    );
}

#[test]
fn check_delivery_batch_respects_the_response_byte_budget_and_freezes_on_replay() {
    let mut conn = migrated_conn();
    let tx = conn.transaction().unwrap();
    let from = Actor::Coordinator("coord-1".into());
    // Each message alone fits under budget; any two together do not.
    let big = "x".repeat(super::RESPONSE_BUDGET_BYTES * 3 / 5);
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
                body: Some(&big),
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
    let delivery = first.delivery.clone().expect("some allocation happens");
    assert_eq!(
        delivery.message_ids.len(),
        1,
        "a byte-budget-respecting prefix, not all 3, must be allocated"
    );
    tx.commit().unwrap();

    // Replay must return the exact same frozen batch, never re-trim it
    // differently on a second observation.
    let tx = conn.transaction().unwrap();
    let replay = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        None,
        &[],
        "unused",
    )
    .unwrap();
    assert_eq!(replay.delivery, first.delivery);
}

#[test]
fn corrupted_oversized_existing_row_is_refused_explicitly_not_delivered_or_silently_empty() {
    let mut conn = migrated_conn();
    // Bypasses `append_message_in_tx`'s own size enforcement on purpose:
    // this simulates a row this module never wrote (corruption or a future
    // schema/limit change), not anything reachable through the public API.
    let huge = "y".repeat(super::RESPONSE_BUDGET_BYTES * 2);
    let tx = conn.transaction().unwrap();
    tx.execute(
        "INSERT INTO orchestration_mail_messages
            (message_id, host_id, run_id, kind, from_kind, from_coordinator_id, from_dispatch_id,
             to_dispatch_id, subject, body, payload_json, thread_id, origin_request_id, created_at)
         VALUES ('corrupt-big', ?1, ?2, 'status', 'coordinator', 'coord-1', NULL, '', 's', ?3, NULL, 'corrupt-big', 'r1', 't')",
        rusqlite::params![HOST, RUN, huge],
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
        &[],
        "d1",
    );
    assert!(
        outcome.is_err(),
        "a corrupted oversized existing row must be refused explicitly, \
         never delivered oversize and never silently skipped as an empty mailbox: {outcome:?}"
    );
}

#[test]
fn cursor_sequence_above_i64_max_is_rejected_not_wrapped_into_a_restart() {
    let mut conn = migrated_conn();
    seed_messages(&mut conn, &Recipient::RunHome, 3, MessageKind::Status);
    let tx = conn.transaction().unwrap();
    let huge_sequence: u64 = i64::MAX as u64 + 100;
    let fingerprint = super::scope_fingerprint(HOST, RUN, &Recipient::RunHome, false, &[]);
    let mut buf = Vec::with_capacity(40);
    buf.extend_from_slice(&huge_sequence.to_be_bytes());
    buf.extend_from_slice(&fingerprint);
    let malicious_cursor = crate::session::base64_encode(&buf);

    let result = inspect_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        false,
        &[],
        Some(&malicious_cursor),
        10,
    );
    assert!(
        result.is_err(),
        "a cursor sequence beyond i64::MAX must be refused, not wrapped negative \
         via `as i64` (which would restart pagination from the top): {result:?}"
    );
}

#[test]
fn corrupt_read_pointer_beyond_any_real_message_is_rejected_not_a_silent_livelock() {
    let mut conn = migrated_conn();
    seed_messages(&mut conn, &Recipient::RunHome, 2, MessageKind::Status);
    let tx = conn.transaction().unwrap();
    tx.execute(
        "INSERT INTO orchestration_mail_read_pointers
            (host_id, run_id, to_dispatch_id, read_through_sequence)
         VALUES (?1, ?2, '', 999999999)",
        rusqlite::params![HOST, RUN],
    )
    .unwrap();
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    let result = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        None,
        &[],
        "d1",
    );
    assert!(
        result.is_err(),
        "a read pointer impossibly beyond any recorded message is corruption and \
         must be refused explicitly, not treated as a genuinely caught-up empty mailbox: {result:?}"
    );
}

/// Builds 50 unique legal 128-byte ids, each escaped to maximum JSON size.
fn max_escaped_ids() -> Vec<String> {
    (0..50)
        .map(|i| format!("{}{:04}", "\"".repeat(124), i))
        .collect()
}

fn seed_and_ack_with_ids(conn: &mut Connection, ids: &[String]) -> String {
    let from = Actor::Coordinator("coord-1".into());
    let tx = conn.transaction().unwrap();
    for id in ids {
        append_message_in_tx(
            &tx,
            NewMessage {
                message_id: id,
                host_id: HOST,
                run_id: RUN,
                kind: MessageKind::Status,
                from: &from,
                to: &Recipient::RunHome,
                subject: "s",
                body: None,
                payload: None,
                thread_id: None,
                origin_request_id: "r",
                created_at: "t",
            },
        )
        .unwrap();
    }
    tx.commit().unwrap();
    let tx = conn.transaction().unwrap();
    let prior = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        None,
        &[],
        "prior",
    )
    .unwrap();
    let prior_delivery_id = prior.delivery.unwrap().delivery_id;
    tx.commit().unwrap();
    prior_delivery_id
}

/// A response that would still succeed is never allowed to exceed the wire
/// budget, even when a same-call ACK of a full 50-id batch rides alongside
/// it uncounted by a per-message-only guard.
#[test]
fn oversized_combined_response_is_never_silently_allowed() {
    use drogon_protocol::Response;
    use drogon_protocol::orchestration_mail::CheckResult;

    let mut conn = migrated_conn();
    let ids = max_escaped_ids();
    assert!(ids.iter().all(|id| id.len() == 128));
    let prior_delivery_id = seed_and_ack_with_ids(&mut conn, &ids);

    // Admission now refuses this size; inject as corrupt data via raw SQL.
    let body = "a".repeat(super::RESPONSE_BUDGET_BYTES - 4096);
    let tx = conn.transaction().unwrap();
    tx.execute(
        "INSERT INTO orchestration_mail_messages
            (message_id, host_id, run_id, kind, from_kind, from_coordinator_id, from_dispatch_id,
             to_dispatch_id, subject, body, payload_json, thread_id, origin_request_id, created_at)
         VALUES ('danger-zone', ?1, ?2, 'status', 'coordinator', 'coord-1', NULL, '', 's', ?3, NULL, 'danger-zone', 'r', 't')",
        rusqlite::params![HOST, RUN, body],
    )
    .unwrap();
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    let result = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        Some(&prior_delivery_id),
        &[],
        "new",
    );
    // Either explicitly refused (safe, since it cannot fit alongside a
    // worst-case ACK), or -- if delivered -- genuinely within budget.
    if let Ok(outcome) = result {
        let check_result = CheckResult {
            delivery: outcome.delivery,
            acknowledged: outcome.acknowledged,
            messages: outcome.messages,
            next_cursor: None,
            timed_out: false,
            cancelled: false,
            connection_lost: false,
        };
        let response = Response::success(
            "r".repeat(128),
            serde_json::to_value(&check_result).unwrap(),
        );
        let bytes = serde_json::to_vec(&response).unwrap();
        assert!(
            bytes.len() <= 512 * 1024,
            "combined Response is {} bytes, over the 512KiB wire budget",
            bytes.len()
        );
    }
}

/// A legitimately near-budget message that respects the reserve is still
/// delivered, and the real combined Response fits the wire budget.
#[test]
fn near_budget_message_with_full_ack_still_fits_the_wire_budget() {
    use drogon_protocol::Response;
    use drogon_protocol::orchestration_mail::CheckResult;

    let mut conn = migrated_conn();
    let ids = max_escaped_ids();
    let prior_delivery_id = seed_and_ack_with_ids(&mut conn, &ids);

    // Safely under the reserve-adjusted ceiling.
    let from = Actor::Coordinator("coord-1".into());
    let body = "a".repeat(super::PACKING_BUDGET_BYTES - 4096);
    let tx = conn.transaction().unwrap();
    append_message_in_tx(
        &tx,
        NewMessage {
            message_id: "near-budget",
            host_id: HOST,
            run_id: RUN,
            kind: MessageKind::Status,
            from: &from,
            to: &Recipient::RunHome,
            subject: "s",
            body: Some(&body),
            payload: None,
            thread_id: None,
            origin_request_id: "r",
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
        Some(&prior_delivery_id),
        &[],
        "new",
    )
    .unwrap();
    assert!(
        outcome.delivery.is_some(),
        "the near-budget message must still be delivered"
    );

    let check_result = CheckResult {
        delivery: outcome.delivery,
        acknowledged: outcome.acknowledged,
        messages: outcome.messages,
        next_cursor: None,
        timed_out: false,
        cancelled: false,
        connection_lost: false,
    };
    let response = Response::success(
        "r".repeat(128),
        serde_json::to_value(&check_result).unwrap(),
    );
    let bytes = serde_json::to_vec(&response).unwrap();
    assert!(
        bytes.len() <= 512 * 1024,
        "combined Response is {} bytes, over the 512KiB wire budget",
        bytes.len()
    );
}

#[test]
fn inspect_refuses_a_corrupted_first_row_that_is_individually_oversized() {
    let mut conn = migrated_conn();
    let huge = "y".repeat(super::RESPONSE_BUDGET_BYTES * 2);
    let tx = conn.transaction().unwrap();
    tx.execute(
        "INSERT INTO orchestration_mail_messages
            (message_id, host_id, run_id, kind, from_kind, from_coordinator_id, from_dispatch_id,
             to_dispatch_id, subject, body, payload_json, thread_id, origin_request_id, created_at)
         VALUES ('corrupt-big', ?1, ?2, 'status', 'coordinator', 'coord-1', NULL, '', 's', ?3, NULL, 'corrupt-big', 'r1', 't')",
        rusqlite::params![HOST, RUN, huge],
    )
    .unwrap();
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    let result = inspect_in_tx(&tx, HOST, RUN, &Recipient::RunHome, false, &[], None, 100);
    assert!(
        result.is_err(),
        "an individually oversized first row must be refused for inspection too: {result:?}"
    );
}

#[test]
fn replay_refuses_a_delivery_batch_tampered_to_a_foreign_recipient_message() {
    let mut conn = migrated_conn();
    seed_messages(&mut conn, &Recipient::RunHome, 2, MessageKind::Status);
    let from = Actor::Coordinator("coord-1".into());
    let tx = conn.transaction().unwrap();
    append_message_in_tx(
        &tx,
        NewMessage {
            message_id: "foreign",
            host_id: HOST,
            run_id: RUN,
            kind: MessageKind::Status,
            from: &from,
            to: &Recipient::Dispatch("other".into()),
            subject: "s",
            body: None,
            payload: None,
            thread_id: None,
            origin_request_id: "r",
            created_at: "t",
        },
    )
    .unwrap();
    tx.commit().unwrap();
    let tx = conn.transaction().unwrap();
    let delivery = check_unread_in_tx(
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
    .unwrap();
    tx.commit().unwrap();

    // Tamper the frozen batch to reference a message addressed to a
    // different recipient's mailbox.
    let tampered = serde_json::to_string(&vec![
        delivery.message_ids[0].clone(),
        "foreign".to_string(),
    ])
    .unwrap();
    let tx = conn.transaction().unwrap();
    tx.execute(
        "UPDATE orchestration_mail_deliveries SET message_ids_json = ?1 WHERE delivery_id = ?2",
        rusqlite::params![tampered, delivery.delivery_id],
    )
    .unwrap();
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    let result = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        None,
        &[],
        "unused",
    );
    assert!(
        result.is_err(),
        "a replayed batch referencing a foreign-recipient message must be refused: {result:?}"
    );
}

#[test]
fn ack_refuses_a_tampered_max_sequence_without_consuming_anything() {
    let mut conn = migrated_conn();
    seed_messages(&mut conn, &Recipient::RunHome, 2, MessageKind::Status);
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

    // Undershoot (not an impossible/beyond-any-message value, so it can't be
    // caught by the read-pointer's own separate corruption check): the
    // batch's real last message has sequence 2.
    let tx = conn.transaction().unwrap();
    tx.execute(
        "UPDATE orchestration_mail_deliveries SET max_sequence = 1 WHERE delivery_id = ?1",
        rusqlite::params![delivery_id],
    )
    .unwrap();
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    let result = check_unread_in_tx(
        &tx,
        HOST,
        RUN,
        &Recipient::RunHome,
        &coordinator(1),
        Some(&delivery_id),
        &[],
        "unused",
    );
    assert!(
        result.is_err(),
        "a tampered max_sequence must be refused: {result:?}"
    );
    drop(tx);

    // No consumption happened: the delivery is still unacknowledged and the
    // read pointer did not advance.
    let acked: i64 = conn
        .query_row(
            "SELECT acknowledged FROM orchestration_mail_deliveries WHERE delivery_id = ?1",
            [&delivery_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(acked, 0);
    let pointer: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM orchestration_mail_read_pointers",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(pointer, 0);
}

/// Mirrors `enforce_message_size`'s own worst-case-sequence probe.
fn probe_wire_size(body_len: usize) -> usize {
    let summary = drogon_protocol::orchestration_mail::MessageSummary {
        message_id: "near-limit".to_string(),
        sequence: u64::MAX,
        kind: MessageKind::Status,
        from_actor: "coordinator:coord-1".to_string(),
        to_actor: None,
        subject: "s".to_string(),
        body: Some("a".repeat(body_len)),
        payload: None,
        thread_id: Some("near-limit".to_string()),
    };
    super::super::message_wire_size(&summary).unwrap()
}

/// Admission must never accept what delivery can never carry.
#[test]
fn a_message_accepted_at_append_is_never_permanently_undeliverable() {
    let mut conn = migrated_conn();
    let from = Actor::Coordinator("coord-1".into());
    let body = "a".repeat(super::RESPONSE_BUDGET_BYTES - 4096);
    let tx = conn.transaction().unwrap();
    let result = append_message_in_tx(
        &tx,
        NewMessage {
            message_id: "boundary",
            host_id: HOST,
            run_id: RUN,
            kind: MessageKind::Status,
            from: &from,
            to: &Recipient::RunHome,
            subject: "s",
            body: Some(&body),
            payload: None,
            thread_id: None,
            origin_request_id: "r",
            created_at: "t",
        },
    );
    match result {
        Err(_) => {
            let count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM orchestration_mail_messages WHERE message_id = 'boundary'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 0, "a refused message must not be inserted");
        }
        Ok(_) => {
            tx.commit().unwrap();
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
            );
            assert!(
                outcome.is_ok_and(|o| o.delivery.is_some()),
                "admission accepted a message that delivery can never carry"
            );
        }
    }
}

/// The largest message admission legitimately allows is still delivered.
#[test]
fn near_packing_budget_message_is_accepted_and_delivered() {
    let mut conn = migrated_conn();
    let overhead = probe_wire_size(0);
    let body_len = super::PACKING_BUDGET_BYTES - overhead;
    assert_eq!(probe_wire_size(body_len), super::PACKING_BUDGET_BYTES);
    let body = "a".repeat(body_len);
    let from = Actor::Coordinator("coord-1".into());
    let tx = conn.transaction().unwrap();
    append_message_in_tx(
        &tx,
        NewMessage {
            message_id: "near-limit",
            host_id: HOST,
            run_id: RUN,
            kind: MessageKind::Status,
            from: &from,
            to: &Recipient::RunHome,
            subject: "s",
            body: Some(&body),
            payload: None,
            thread_id: None,
            origin_request_id: "r",
            created_at: "t",
        },
    )
    .expect("a message exactly at the packing budget ceiling must be accepted");
    tx.commit().unwrap();

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
    let delivery = outcome
        .delivery
        .expect("the accepted near-limit message must be delivered");
    assert_eq!(delivery.message_ids, vec!["near-limit"]);
}
