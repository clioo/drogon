//! Correlated question/answer mail. A question and its mail message commit
//! atomically; resume only ever reads; only the addressed actor may reply,
//! and a reply is idempotent by exact answer body, never overwritten.
//!
//! `ask_new_in_tx`/`ask_resume_in_tx`/`reply_in_tx` are the domain functions
//! for `orchestration.ask`/`orchestration.reply`, called by root's
//! `coordination_question_rpc.rs`.

use drogon_protocol::RpcError;
use drogon_protocol::orchestration_common::validate_opaque_token;
use drogon_protocol::orchestration_mail::{MessageKind, MessagePriority};
use drogon_protocol::orchestration_question::AnswerPayload;
use rusqlite::{OptionalExtension, Transaction, params};
use serde_json::json;

use super::{Actor, NewMessage, Recipient, append_message_in_tx, get_message_in_tx};
use crate::error;

#[cfg(test)]
#[path = "coordination_mail_questions_tests.rs"]
mod coordination_mail_questions_tests;

#[derive(Debug)]
pub(crate) struct QuestionRecord {
    pub(crate) question_message_id: String,
    pub(crate) thread_id: String,
    pub(crate) closed: bool,
    pub(crate) answer: Option<AnswerPayload>,
}

struct QuestionRow {
    closed: bool,
    answer_message_id: Option<String>,
    answer_body: Option<String>,
    thread_id: String,
}

fn load_question_row(
    tx: &Transaction,
    host_id: &str,
    run_id: &str,
    question_message_id: &str,
) -> Result<Option<QuestionRow>, RpcError> {
    tx.query_row(
        "SELECT closed, answer_message_id, answer_body, thread_id
           FROM orchestration_mail_questions
          WHERE host_id = ?1 AND run_id = ?2 AND question_message_id = ?3",
        params![host_id, run_id, question_message_id],
        |r| {
            Ok(QuestionRow {
                closed: r.get::<_, i64>(0)? != 0,
                answer_message_id: r.get(1)?,
                answer_body: r.get(2)?,
                thread_id: r.get(3)?,
            })
        },
    )
    .optional()
    .map_err(super::mail_storage_error)
}

fn to_record(
    question_message_id: &str,
    closed: bool,
    answer_message_id: Option<String>,
    answer_body: Option<String>,
    thread_id: String,
) -> QuestionRecord {
    let answer = answer_message_id.map(|id| AnswerPayload {
        body: answer_body.unwrap_or_default(),
        answer_message_id: Some(id),
    });
    QuestionRecord {
        question_message_id: question_message_id.to_string(),
        thread_id,
        closed,
        answer,
    }
}

/// Appends the question message and its correlation row in one transaction.
/// `addressee` is the run home (any current coordinator may reply) or one
/// exact dispatch; there is no group addressee — root must resolve/refuse
/// group targeting before calling this.
#[allow(clippy::too_many_arguments)]
pub(crate) fn ask_new_in_tx(
    tx: &Transaction,
    host_id: &str,
    run_id: &str,
    question_message_id: &str,
    asker: &Actor,
    addressee: &Recipient,
    question_text: &str,
    options: &[String],
    thread_id: Option<&str>,
    origin_request_id: &str,
    created_at: &str,
) -> Result<QuestionRecord, RpcError> {
    let payload = (!options.is_empty()).then(|| json!({ "options": options }));
    let summary = append_message_in_tx(
        tx,
        NewMessage {
            message_id: question_message_id,
            host_id,
            run_id,
            kind: MessageKind::Question,
            from: asker,
            to: addressee,
            subject: question_text,
            body: None,
            payload: payload.as_ref(),
            priority: MessagePriority::Normal,
            thread_id,
            origin_request_id,
            created_at,
        },
    )?;
    let thread_id = summary
        .thread_id
        .expect("append_message_in_tx always sets a thread id");
    correlate_question_in_tx(tx, host_id, run_id, question_message_id, &thread_id)?;
    Ok(to_record(question_message_id, false, None, None, thread_id))
}

/// Inserts the correlation row for an already-appended `question`-kind
/// message. Any `send` of `kind: "question"` -- not only the dedicated
/// `ask` path -- must call this atomically with its message insert, or a
/// later `reply`/resume finds the message but no correlation and refuses.
pub(crate) fn correlate_question_in_tx(
    tx: &Transaction,
    host_id: &str,
    run_id: &str,
    question_message_id: &str,
    thread_id: &str,
) -> Result<(), RpcError> {
    tx.execute(
        "INSERT INTO orchestration_mail_questions
            (question_message_id, host_id, run_id, thread_id, closed)
         VALUES (?1, ?2, ?3, ?4, 0)",
        params![question_message_id, host_id, run_id, thread_id],
    )
    .map_err(super::mail_storage_error)?;
    Ok(())
}

/// Pure read: never creates mail, never mutates state, regardless of
/// whether the question is answered, pending, or closed unresolved.
pub(crate) fn ask_resume_in_tx(
    tx: &Transaction,
    host_id: &str,
    run_id: &str,
    question_message_id: &str,
) -> Result<QuestionRecord, RpcError> {
    validate_opaque_token(question_message_id, 128, "Invalid message id.")?;
    let row = load_question_row(tx, host_id, run_id, question_message_id)?
        .ok_or_else(|| error::not_found("Question does not exist in this run."))?;
    Ok(to_record(
        question_message_id,
        row.closed,
        row.answer_message_id,
        row.answer_body,
        row.thread_id,
    ))
}

/// Who may answer a question: the run home accepts any current coordinator
/// (root already authenticated that identity); an exact dispatch accepts
/// only that same dispatch.
fn replier_matches_addressee(replier: &Actor, addressee: &Recipient) -> bool {
    match addressee {
        Recipient::RunHome => matches!(replier, Actor::Coordinator(_)),
        Recipient::Dispatch(id) => matches!(replier, Actor::Dispatch(d) if d == id),
    }
}

/// First reply wins. An exact repeated body replays the original answer
/// message; any other body is refused, never overwriting the answer. An
/// optional `thread_id` must agree with the question's own thread.
#[allow(clippy::too_many_arguments)]
pub(crate) fn reply_in_tx(
    tx: &Transaction,
    host_id: &str,
    run_id: &str,
    question_message_id: &str,
    replier: &Actor,
    answer_message_id: &str,
    body: &str,
    thread_id: Option<&str>,
    origin_request_id: &str,
    created_at: &str,
) -> Result<QuestionRecord, RpcError> {
    validate_opaque_token(question_message_id, 128, "Invalid message id.")?;
    let question = get_message_in_tx(tx, host_id, run_id, question_message_id)?
        .ok_or_else(|| error::not_found("Question does not exist in this run."))?;
    if question.summary.kind != MessageKind::Question {
        return Err(error::invalid_argument("Target message is not a question."));
    }
    if !replier_matches_addressee(replier, &question.to) {
        return Err(error::invalid_argument(
            "Only the addressed actor may reply to this question.",
        ));
    }
    let row = load_question_row(tx, host_id, run_id, question_message_id)?
        .ok_or_else(|| error::not_found("Question does not exist in this run."))?;
    if let Some(supplied) = thread_id
        && supplied != row.thread_id
    {
        return Err(error::invalid_argument(
            "Reply thread must agree with the question's thread.",
        ));
    }
    if let Some(existing_id) = row.answer_message_id {
        // First reply wins: an exact repeat of the same answer replays the
        // original message id/body; anything else is a conflict, not an
        // overwrite.
        if row.answer_body.as_deref() == Some(body) {
            return Ok(to_record(
                question_message_id,
                row.closed,
                Some(existing_id),
                Some(body.to_string()),
                row.thread_id,
            ));
        }
        return Err(RpcError::new(
            "answer_conflict",
            "This question already has a different answer.",
        ));
    }
    if row.closed {
        return Err(error::invalid_argument(
            "This question is closed and cannot take a new answer.",
        ));
    }
    let stored_thread = row.thread_id;
    // The typed sender identity comes straight from the correlated
    // message row -- never parsed back out of the opaque `from_actor`
    // wire string.
    let answer_recipient = match &question.from {
        Actor::Coordinator(_) => Recipient::RunHome,
        Actor::Dispatch(id) => Recipient::Dispatch(id.clone()),
    };
    append_message_in_tx(
        tx,
        NewMessage {
            message_id: answer_message_id,
            host_id,
            run_id,
            kind: MessageKind::Answer,
            from: replier,
            to: &answer_recipient,
            subject: question.summary.subject.as_str(),
            body: Some(body),
            payload: None,
            priority: MessagePriority::Normal,
            thread_id: Some(stored_thread.as_str()),
            origin_request_id,
            created_at,
        },
    )?;
    tx.execute(
        "UPDATE orchestration_mail_questions
            SET answer_message_id = ?1, answer_body = ?2, answer_origin_request_id = ?3
          WHERE host_id = ?4 AND run_id = ?5 AND question_message_id = ?6",
        params![
            answer_message_id,
            body,
            origin_request_id,
            host_id,
            run_id,
            question_message_id
        ],
    )
    .map_err(super::mail_storage_error)?;
    Ok(to_record(
        question_message_id,
        false,
        Some(answer_message_id.to_string()),
        Some(body.to_string()),
        stored_thread,
    ))
}

/// Closes every unresolved (unanswered, not-already-closed) question where
/// `dispatch_id` is either party — attempt cancellation/final report call
/// this for both directions. History is preserved; nothing is deleted.
pub(crate) fn close_dispatch_questions_in_tx(
    tx: &Transaction,
    host_id: &str,
    run_id: &str,
    dispatch_id: &str,
    reason: &str,
) -> Result<u32, RpcError> {
    validate_opaque_token(dispatch_id, 128, "Invalid dispatch id.")?;
    let updated = tx
        .execute(
            "UPDATE orchestration_mail_questions
                SET closed = 1, closed_reason = ?1
              WHERE closed = 0 AND answer_message_id IS NULL
                AND host_id = ?2 AND run_id = ?3
                AND question_message_id IN (
                    SELECT message_id FROM orchestration_mail_messages
                     WHERE host_id = ?2 AND run_id = ?3
                       AND (from_dispatch_id = ?4 OR to_dispatch_id = ?4)
                )",
            params![reason, host_id, run_id, dispatch_id],
        )
        .map_err(super::mail_storage_error)?;
    Ok(updated as u32)
}
