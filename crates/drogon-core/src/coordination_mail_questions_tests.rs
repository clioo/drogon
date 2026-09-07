//! Real-SQLite tests for ask/reply/close: atomic question+mail, resume-only
//! reads, addressed-actor-only replies, idempotent/conflicting answers.

use rusqlite::Connection;

use super::{ask_new_in_tx, ask_resume_in_tx, close_dispatch_questions_in_tx, reply_in_tx};
use crate::coordination_mail::{Actor, Recipient, migrate_in_tx};

const HOST: &str = "host-1";
const RUN: &str = "run-1";

fn migrated_conn() -> Connection {
    let mut conn = Connection::open_in_memory().expect("in-memory fixture db");
    let tx = conn.transaction().expect("begin");
    migrate_in_tx(&tx).expect("migrate");
    tx.commit().expect("commit");
    conn
}

#[test]
fn ask_new_creates_question_and_mail_atomically() {
    let mut conn = migrated_conn();
    let tx = conn.transaction().unwrap();
    let record = ask_new_in_tx(
        &tx,
        HOST,
        RUN,
        "q1",
        &Actor::Coordinator("coord-1".into()),
        &Recipient::Dispatch("d1".into()),
        "proceed?",
        &["yes".into(), "no".into()],
        None,
        "r1",
        "t",
    )
    .unwrap();
    assert_eq!(record.question_message_id, "q1");
    assert_eq!(
        record.thread_id, "q1",
        "self-threaded when no thread was supplied"
    );
    assert!(!record.closed);
    assert!(record.answer.is_none());
    tx.commit().unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM orchestration_mail_messages WHERE message_id='q1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "the question message exists in the same commit");
}

#[test]
fn rollback_undoes_both_the_message_and_the_question_row() {
    let mut conn = migrated_conn();
    {
        let tx = conn.transaction().unwrap();
        ask_new_in_tx(
            &tx,
            HOST,
            RUN,
            "q1",
            &Actor::Coordinator("coord-1".into()),
            &Recipient::Dispatch("d1".into()),
            "proceed?",
            &[],
            None,
            "r1",
            "t",
        )
        .unwrap();
        // Dropped without commit.
    }
    let messages: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM orchestration_mail_messages",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let questions: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM orchestration_mail_questions",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!((messages, questions), (0, 0));
}

#[test]
fn resume_reads_pending_and_never_creates_mail() {
    let mut conn = migrated_conn();
    let tx = conn.transaction().unwrap();
    ask_new_in_tx(
        &tx,
        HOST,
        RUN,
        "q1",
        &Actor::Coordinator("coord-1".into()),
        &Recipient::Dispatch("d1".into()),
        "proceed?",
        &[],
        None,
        "r1",
        "t",
    )
    .unwrap();
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    let record = ask_resume_in_tx(&tx, HOST, RUN, "q1").unwrap();
    assert!(record.answer.is_none());
    tx.commit().unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM orchestration_mail_messages",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "resume created no additional mail");
}

#[test]
fn dispatch_to_run_home_and_run_home_to_dispatch_both_work() {
    let mut conn = migrated_conn();
    let tx = conn.transaction().unwrap();
    ask_new_in_tx(
        &tx,
        HOST,
        RUN,
        "q-from-coord",
        &Actor::Coordinator("coord-1".into()),
        &Recipient::Dispatch("d1".into()),
        "run-home to dispatch",
        &[],
        None,
        "r1",
        "t",
    )
    .unwrap();
    ask_new_in_tx(
        &tx,
        HOST,
        RUN,
        "q-from-dispatch",
        &Actor::Dispatch("d1".into()),
        &Recipient::RunHome,
        "dispatch to run-home",
        &[],
        None,
        "r2",
        "t",
    )
    .unwrap();
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    reply_in_tx(
        &tx,
        HOST,
        RUN,
        "q-from-coord",
        &Actor::Dispatch("d1".into()),
        "a1",
        "yes",
        None,
        "r3",
        "t",
    )
    .expect("addressed dispatch may reply");
    reply_in_tx(
        &tx,
        HOST,
        RUN,
        "q-from-dispatch",
        &Actor::Coordinator("coord-2".into()),
        "a2",
        "sure",
        None,
        "r4",
        "t",
    )
    .expect("any current coordinator may reply to a run-home-addressed question");
}

#[test]
fn only_the_addressed_actor_may_reply() {
    let mut conn = migrated_conn();
    let tx = conn.transaction().unwrap();
    ask_new_in_tx(
        &tx,
        HOST,
        RUN,
        "q1",
        &Actor::Coordinator("coord-1".into()),
        &Recipient::Dispatch("d1".into()),
        "proceed?",
        &[],
        None,
        "r1",
        "t",
    )
    .unwrap();
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    let err = reply_in_tx(
        &tx,
        HOST,
        RUN,
        "q1",
        &Actor::Dispatch("other-dispatch".into()),
        "a1",
        "yes",
        None,
        "r2",
        "t",
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn first_reply_wins_exact_repeat_replays_conflicting_answer_refused() {
    let mut conn = migrated_conn();
    let tx = conn.transaction().unwrap();
    ask_new_in_tx(
        &tx,
        HOST,
        RUN,
        "q1",
        &Actor::Coordinator("coord-1".into()),
        &Recipient::Dispatch("d1".into()),
        "proceed?",
        &[],
        None,
        "r1",
        "t",
    )
    .unwrap();
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    let first = reply_in_tx(
        &tx,
        HOST,
        RUN,
        "q1",
        &Actor::Dispatch("d1".into()),
        "a1",
        "yes",
        None,
        "r2",
        "t",
    )
    .unwrap();
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    let replay = reply_in_tx(
        &tx,
        HOST,
        RUN,
        "q1",
        &Actor::Dispatch("d1".into()),
        "a-different-id",
        "yes",
        None,
        "r3",
        "t",
    )
    .unwrap();
    assert_eq!(replay.answer.as_ref().unwrap().body, "yes");
    assert_eq!(
        replay.answer, first.answer,
        "exact repeat replays the original answer"
    );
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    let err = reply_in_tx(
        &tx,
        HOST,
        RUN,
        "q1",
        &Actor::Dispatch("d1".into()),
        "a2",
        "no",
        None,
        "r4",
        "t",
    )
    .unwrap_err();
    assert_eq!(err.code, "answer_conflict");

    // The conflicting reply's message was never actually appended.
    let count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM orchestration_mail_messages WHERE message_id='a2'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn thread_mismatch_is_refused_before_effects() {
    let mut conn = migrated_conn();
    let tx = conn.transaction().unwrap();
    ask_new_in_tx(
        &tx,
        HOST,
        RUN,
        "q1",
        &Actor::Coordinator("coord-1".into()),
        &Recipient::Dispatch("d1".into()),
        "proceed?",
        &[],
        Some("custom-thread"),
        "r1",
        "t",
    )
    .unwrap();
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    let err = reply_in_tx(
        &tx,
        HOST,
        RUN,
        "q1",
        &Actor::Dispatch("d1".into()),
        "a1",
        "yes",
        Some("wrong-thread"),
        "r2",
        "t",
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    let count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM orchestration_mail_messages WHERE message_id='a1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn close_dispatch_questions_closes_unresolved_in_both_directions_and_keeps_history() {
    let mut conn = migrated_conn();
    let tx = conn.transaction().unwrap();
    ask_new_in_tx(
        &tx,
        HOST,
        RUN,
        "q-to-dispatch",
        &Actor::Coordinator("coord-1".into()),
        &Recipient::Dispatch("d1".into()),
        "pending 1",
        &[],
        None,
        "r1",
        "t",
    )
    .unwrap();
    ask_new_in_tx(
        &tx,
        HOST,
        RUN,
        "q-from-dispatch",
        &Actor::Dispatch("d1".into()),
        &Recipient::RunHome,
        "pending 2",
        &[],
        None,
        "r2",
        "t",
    )
    .unwrap();
    ask_new_in_tx(
        &tx,
        HOST,
        RUN,
        "q-already-answered",
        &Actor::Coordinator("coord-1".into()),
        &Recipient::Dispatch("d1".into()),
        "answered already",
        &[],
        None,
        "r3",
        "t",
    )
    .unwrap();
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    reply_in_tx(
        &tx,
        HOST,
        RUN,
        "q-already-answered",
        &Actor::Dispatch("d1".into()),
        "a1",
        "ok",
        None,
        "r4",
        "t",
    )
    .unwrap();
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    let closed = close_dispatch_questions_in_tx(&tx, HOST, RUN, "d1", "attempt cancelled").unwrap();
    assert_eq!(
        closed, 2,
        "both unresolved directions close, the answered one does not"
    );
    tx.commit().unwrap();

    let tx = conn.transaction().unwrap();
    let record = ask_resume_in_tx(&tx, HOST, RUN, "q-to-dispatch").unwrap();
    assert!(record.closed);
    let answered = ask_resume_in_tx(&tx, HOST, RUN, "q-already-answered").unwrap();
    assert!(
        !answered.closed,
        "answered questions are not touched by close"
    );

    let err = reply_in_tx(
        &tx,
        HOST,
        RUN,
        "q-to-dispatch",
        &Actor::Dispatch("d1".into()),
        "late",
        "yes",
        None,
        "r5",
        "t",
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");

    // History remains: the row still exists, just closed.
    let count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM orchestration_mail_questions",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 3);
}
