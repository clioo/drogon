//! Whole-batch consuming check, ACK, and read-only peek/all inspection.
//! One outstanding delivery per exact recipient+consumer key; consuming
//! reads never split a FIFO batch, and inspection never allocates one.

use drogon_protocol::RpcError;
use drogon_protocol::orchestration_common::{MAX_MAIL_BATCH, validate_opaque_token};
use drogon_protocol::orchestration_mail::{
    AckReceipt, MessageKind, MessageSummary, OutstandingDelivery,
};
use rusqlite::{OptionalExtension, Transaction, params};
use sha2::{Digest, Sha256};

#[cfg(test)]
use super::RESPONSE_BUDGET_BYTES;
use super::{PACKING_BUDGET_BYTES, Recipient, StoredMessage, message_kind_str, message_kind_tag};
use crate::error;

#[cfg(test)]
#[path = "coordination_mail_delivery_tests.rs"]
mod coordination_mail_delivery_tests;

/// Who is reading a mailbox. A dispatch's own inbox has exactly one possible
/// reader (itself) and no generation concept; only the run-home mailbox has
/// a coordinator identity that can be superseded by takeover.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Consumer {
    Coordinator {
        coordinator_id: String,
        generation: u64,
    },
    Dispatch,
}

impl Consumer {
    fn coordinator_id(&self) -> Option<&str> {
        match self {
            Consumer::Coordinator { coordinator_id, .. } => Some(coordinator_id.as_str()),
            Consumer::Dispatch => None,
        }
    }

    fn generation(&self) -> Option<i64> {
        match self {
            Consumer::Coordinator { generation, .. } => Some(*generation as i64),
            Consumer::Dispatch => None,
        }
    }

    fn validate(&self, recipient: &Recipient) -> Result<(), RpcError> {
        match (recipient, self) {
            (
                Recipient::RunHome,
                Consumer::Coordinator {
                    coordinator_id,
                    generation,
                },
            ) => {
                validate_opaque_token(coordinator_id, 128, "Invalid coordinator id.")?;
                drogon_protocol::orchestration_common::validate_consumer_generation(*generation)
            }
            (Recipient::Dispatch(_), Consumer::Dispatch) => Ok(()),
            _ => Err(error::invalid_argument(
                "Consumer identity does not match the mailbox recipient.",
            )),
        }
    }
}

#[derive(Debug)]
pub(crate) struct CheckOutcome {
    pub(crate) delivery: Option<OutstandingDelivery>,
    pub(crate) acknowledged: Option<AckReceipt>,
    pub(crate) messages: Vec<MessageSummary>,
}

/// Reads the mailbox's read-through pointer, rejecting corruption instead of
/// silently coercing it: a negative stored value would wrap to a huge `u64`
/// via `as`, and a pointer beyond every message ever recorded is impossible
/// (it can only ever be set from a real delivered batch's own max sequence)
/// and must not be treated as an honestly caught-up empty mailbox.
fn read_pointer_in_tx(
    tx: &Transaction,
    host_id: &str,
    run_id: &str,
    recipient: &Recipient,
) -> Result<u64, RpcError> {
    let raw: Option<i64> = tx
        .query_row(
            "SELECT read_through_sequence FROM orchestration_mail_read_pointers
              WHERE host_id = ?1 AND run_id = ?2 AND to_dispatch_id = ?3",
            params![host_id, run_id, recipient.column()],
            |r| r.get(0),
        )
        .optional()
        .map_err(super::mail_storage_error)?;
    let value = raw.unwrap_or(0);
    if value < 0 {
        return Err(error::internal_error("Corrupt negative mail read pointer."));
    }
    let max_sequence: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(sequence), 0) FROM orchestration_mail_messages",
            [],
            |r| r.get(0),
        )
        .map_err(super::mail_storage_error)?;
    if value > max_sequence {
        return Err(error::internal_error(
            "Corrupt mail read pointer beyond any recorded message.",
        ));
    }
    Ok(value as u64)
}

fn advance_read_pointer_in_tx(
    tx: &Transaction,
    host_id: &str,
    run_id: &str,
    recipient: &Recipient,
    through_sequence: u64,
) -> Result<(), RpcError> {
    tx.execute(
        "INSERT INTO orchestration_mail_read_pointers
            (host_id, run_id, to_dispatch_id, read_through_sequence)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(host_id, run_id, to_dispatch_id)
         DO UPDATE SET read_through_sequence = MAX(read_through_sequence, excluded.read_through_sequence)",
        params![host_id, run_id, recipient.column(), through_sequence as i64],
    )
    .map_err(super::mail_storage_error)?;
    Ok(())
}

fn active_delivery_in_tx(
    tx: &Transaction,
    host_id: &str,
    run_id: &str,
    recipient: &Recipient,
    consumer: &Consumer,
) -> Result<Option<(String, Vec<String>, i64)>, RpcError> {
    tx.query_row(
        "SELECT delivery_id, message_ids_json, max_sequence FROM orchestration_mail_deliveries
          WHERE host_id = ?1 AND run_id = ?2 AND to_dispatch_id = ?3
            AND consumer_coordinator_id IS ?4 AND consumer_generation IS ?5
            AND acknowledged = 0",
        params![
            host_id,
            run_id,
            recipient.column(),
            consumer.coordinator_id(),
            consumer.generation()
        ],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        },
    )
    .optional()
    .map_err(super::mail_storage_error)?
    .map(|(id, ids_json, max_sequence)| {
        let ids: Vec<String> = serde_json::from_str(&ids_json)
            .map_err(|_| error::internal_error("Invalid stored delivery batch."))?;
        Ok((id, ids, max_sequence))
    })
    .transpose()
}

/// Re-validates a frozen batch before ever reusing it: shape (unique,
/// 1..=50, valid ids), every message actually belongs to `recipient`,
/// sequences strictly increasing, real total wire size under budget, and
/// the stored `max_sequence` matches the batch's true last sequence. Never
/// shrinks a corrupt batch -- refuses it whole.
fn validate_delivery_batch(
    tx: &Transaction,
    host_id: &str,
    run_id: &str,
    recipient: &Recipient,
    delivery_id: &str,
    message_ids: &[String],
    stored_max_sequence: i64,
) -> Result<Vec<MessageSummary>, RpcError> {
    OutstandingDelivery {
        delivery_id: delivery_id.to_string(),
        message_ids: message_ids.to_vec(),
    }
    .validate_shape()
    .map_err(|_| error::internal_error("Corrupt stored delivery batch shape."))?;
    if stored_max_sequence < 0 {
        return Err(error::internal_error(
            "Corrupt negative delivery max sequence.",
        ));
    }
    let mut messages = Vec::with_capacity(message_ids.len());
    let mut previous_sequence = 0u64;
    let mut total_size = 0usize;
    for id in message_ids {
        let stored = super::get_message_in_tx(tx, host_id, run_id, id)?
            .ok_or_else(|| error::internal_error("Delivered message is missing."))?;
        if stored.to != *recipient {
            return Err(error::internal_error(
                "Delivered message recipient mismatch.",
            ));
        }
        if stored.summary.sequence <= previous_sequence {
            return Err(error::internal_error(
                "Delivered batch is out of sequence order.",
            ));
        }
        previous_sequence = stored.summary.sequence;
        total_size += super::message_wire_size(&stored.summary)?;
        messages.push(stored.summary);
    }
    if previous_sequence as i64 != stored_max_sequence {
        return Err(error::internal_error(
            "Delivery max sequence does not match its batch.",
        ));
    }
    if total_size > PACKING_BUDGET_BYTES {
        return Err(error::internal_error(
            "Delivered batch exceeds the response budget; refused, not shrunk.",
        ));
    }
    Ok(messages)
}

fn fetch_unread_batch(
    tx: &Transaction,
    host_id: &str,
    run_id: &str,
    recipient: &Recipient,
    after_sequence: u64,
) -> Result<Vec<StoredMessage>, RpcError> {
    let sql = format!(
        "SELECT {} FROM orchestration_mail_messages
          WHERE host_id = ?1 AND run_id = ?2 AND to_dispatch_id = ?3 AND sequence > ?4
          ORDER BY sequence ASC LIMIT {}",
        super::message_columns(),
        MAX_MAIL_BATCH
    );
    let mut stmt = tx.prepare(&sql).map_err(super::mail_storage_error)?;
    let rows = stmt
        .query_map(
            params![host_id, run_id, recipient.column(), after_sequence as i64],
            super::decode_message_row,
        )
        .map_err(super::mail_storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(super::mail_storage_error)?;
    Ok(rows)
}

/// Whether the *entire* unread backlog (not just the oldest 50 candidates a
/// delivery could carry) contains a message of one of `kinds`. The wake
/// condition must search the whole backlog: a matching message far behind
/// the 50-message delivery cap must still wake the waiter, even though the
/// delivered batch itself (the oldest FIFO prefix) may not yet include it.
fn any_unread_matches_kind(
    tx: &Transaction,
    host_id: &str,
    run_id: &str,
    recipient: &Recipient,
    after_sequence: u64,
    kinds: &[MessageKind],
) -> Result<bool, RpcError> {
    let kind_strs: Vec<&'static str> = kinds.iter().map(|k| message_kind_str(*k)).collect();
    let placeholders = kind_strs.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT 1 FROM orchestration_mail_messages
          WHERE host_id = ? AND run_id = ? AND to_dispatch_id = ? AND sequence > ?
            AND kind IN ({placeholders}) LIMIT 1"
    );
    let mut stmt = tx.prepare(&sql).map_err(super::mail_storage_error)?;
    let after = after_sequence as i64;
    let recipient_col = recipient.column();
    let mut all_params: Vec<&dyn rusqlite::ToSql> = vec![&host_id, &run_id, &recipient_col, &after];
    for k in &kind_strs {
        all_params.push(k);
    }
    stmt.exists(all_params.as_slice())
        .map_err(super::mail_storage_error)
}

fn ack_in_tx(
    tx: &Transaction,
    host_id: &str,
    run_id: &str,
    recipient: &Recipient,
    consumer: &Consumer,
    delivery_id: &str,
) -> Result<AckReceipt, RpcError> {
    validate_opaque_token(delivery_id, 128, "Invalid delivery id.")?;
    let row: Option<(String, i64, i64)> = tx
        .query_row(
            "SELECT message_ids_json, max_sequence, acknowledged FROM orchestration_mail_deliveries
              WHERE delivery_id = ?1 AND host_id = ?2 AND run_id = ?3 AND to_dispatch_id = ?4
                AND consumer_coordinator_id IS ?5 AND consumer_generation IS ?6",
            params![
                delivery_id,
                host_id,
                run_id,
                recipient.column(),
                consumer.coordinator_id(),
                consumer.generation()
            ],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(super::mail_storage_error)?;
    // Wrong recipient/run/host/generation (including a stale generation's own
    // delivery id) simply never matches this exact key: rejected before any
    // consumption, not silently accepted.
    let (ids_json, max_sequence, acknowledged) = row.ok_or_else(|| {
        error::invalid_argument("Unknown delivery id for this recipient and consumer.")
    })?;
    // A superseded generation's own delivery id still matches its own key
    // exactly, so exact-key matching alone cannot fence it: a takeover that
    // has since allocated under a newer generation makes every older
    // generation's ACK stale, even though nothing else has touched this row.
    if let Consumer::Coordinator { generation, .. } = consumer {
        let newest: Option<i64> = tx
            .query_row(
                "SELECT MAX(consumer_generation) FROM orchestration_mail_deliveries
                  WHERE host_id = ?1 AND run_id = ?2 AND to_dispatch_id = ?3",
                params![host_id, run_id, recipient.column()],
                |r| r.get(0),
            )
            .map_err(super::mail_storage_error)?;
        if newest.is_some_and(|newest| newest > *generation as i64) {
            return Err(error::invalid_argument(
                "This consumer generation has been superseded by a takeover.",
            ));
        }
    }
    let message_ids: Vec<String> = serde_json::from_str(&ids_json)
        .map_err(|_| error::internal_error("Invalid stored delivery batch."))?;
    validate_delivery_batch(
        tx,
        host_id,
        run_id,
        recipient,
        delivery_id,
        &message_ids,
        max_sequence,
    )?;
    if acknowledged != 0 {
        return Ok(AckReceipt {
            delivery_id: delivery_id.to_string(),
            already_acknowledged: true,
            message_ids,
        });
    }
    tx.execute(
        "UPDATE orchestration_mail_deliveries SET acknowledged = 1 WHERE delivery_id = ?1",
        params![delivery_id],
    )
    .map_err(super::mail_storage_error)?;
    advance_read_pointer_in_tx(tx, host_id, run_id, recipient, max_sequence as u64)?;
    Ok(AckReceipt {
        delivery_id: delivery_id.to_string(),
        already_acknowledged: false,
        message_ids,
    })
}

/// One poll of a consuming check: optionally ACKs a prior delivery, then
/// either replays the still-outstanding delivery for this exact consumer
/// key, allocates a fresh FIFO batch (subject to the wake-kind filter), or
/// — with no unread mail or no matching kind — allocates nothing. Waiting
/// across polls is the caller's job, entirely outside this transaction.
#[allow(clippy::too_many_arguments)]
pub(crate) fn check_unread_in_tx(
    tx: &Transaction,
    host_id: &str,
    run_id: &str,
    recipient: &Recipient,
    consumer: &Consumer,
    acknowledge: Option<&str>,
    kinds: &[MessageKind],
    candidate_delivery_id: &str,
) -> Result<CheckOutcome, RpcError> {
    recipient.validate()?;
    consumer.validate(recipient)?;
    validate_opaque_token(host_id, 128, "Invalid host id.")?;
    validate_opaque_token(run_id, 128, "Invalid run id.")?;
    validate_opaque_token(candidate_delivery_id, 128, "Invalid delivery id.")?;

    let acknowledged = acknowledge
        .map(|id| ack_in_tx(tx, host_id, run_id, recipient, consumer, id))
        .transpose()?;

    if let Some((delivery_id, message_ids, stored_max_sequence)) =
        active_delivery_in_tx(tx, host_id, run_id, recipient, consumer)?
    {
        let messages = validate_delivery_batch(
            tx,
            host_id,
            run_id,
            recipient,
            &delivery_id,
            &message_ids,
            stored_max_sequence,
        )?;
        return Ok(CheckOutcome {
            delivery: Some(OutstandingDelivery {
                delivery_id,
                message_ids,
            }),
            acknowledged,
            messages,
        });
    }

    let read_through = read_pointer_in_tx(tx, host_id, run_id, recipient)?;
    let candidates = fetch_unread_batch(tx, host_id, run_id, recipient, read_through)?;
    if candidates.is_empty() {
        return Ok(CheckOutcome {
            delivery: None,
            acknowledged,
            messages: Vec::new(),
        });
    }
    // The wake condition is checked against the *entire* unread backlog, not
    // just the (at most 50) candidates a delivery could carry: a matching
    // message far behind the delivery cap must still wake this call.
    if !kinds.is_empty()
        && !any_unread_matches_kind(tx, host_id, run_id, recipient, read_through, kinds)?
    {
        // Wake condition unmet: earlier nonmatching messages are never
        // skipped/dropped — simply no allocation happens yet.
        return Ok(CheckOutcome {
            delivery: None,
            acknowledged,
            messages: Vec::new(),
        });
    }
    // Trim to a byte-budget-respecting prefix using each candidate's actual
    // serialized wire size (never a raw string-length guess): the delivered
    // batch is the oldest FIFO prefix that fits, even if that means fewer
    // than the 50-message cap or fewer than the wake-triggering message
    // itself (which may sit past this prefix and arrive in a later batch).
    let mut budgeted = Vec::with_capacity(candidates.len());
    let mut used_bytes = 0usize;
    for candidate in candidates {
        let size = super::message_wire_size(&candidate.summary)?;
        if size > PACKING_BUDGET_BYTES {
            if budgeted.is_empty() {
                // The oldest unread message alone cannot fit any response:
                // this is corruption/drift, not a livelock to hide behind an
                // empty or an oversized delivery.
                return Err(error::internal_error(
                    "A stored message exceeds the response budget; delivery refused.",
                ));
            }
            break;
        }
        if used_bytes + size > PACKING_BUDGET_BYTES && !budgeted.is_empty() {
            break;
        }
        used_bytes += size;
        budgeted.push(candidate);
    }
    let candidates = budgeted;
    let message_ids: Vec<String> = candidates
        .iter()
        .map(|m| m.summary.message_id.clone())
        .collect();
    let max_sequence = candidates.last().unwrap().summary.sequence;
    tx.execute(
        "INSERT INTO orchestration_mail_deliveries
            (delivery_id, host_id, run_id, to_dispatch_id, consumer_coordinator_id,
             consumer_generation, message_ids_json, max_sequence, acknowledged)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)",
        params![
            candidate_delivery_id,
            host_id,
            run_id,
            recipient.column(),
            consumer.coordinator_id(),
            consumer.generation(),
            serde_json::to_string(&message_ids).unwrap(),
            max_sequence as i64,
        ],
    )
    .map_err(super::mail_storage_error)?;
    let messages = candidates.into_iter().map(|m| m.summary).collect();
    Ok(CheckOutcome {
        delivery: Some(OutstandingDelivery {
            delivery_id: candidate_delivery_id.to_string(),
            message_ids,
        }),
        acknowledged,
        messages,
    })
}

/// Read-only inspection: `unread_only=true` is peek (mailbox's current
/// unread floor), `false` is all retained mail. Never creates a delivery or
/// mutates the read pointer. Bounded by `limit` (server clamps to
/// `MAX_PAGE_LIMIT`) and the response byte budget; a cursor from a different
/// host/run/recipient/mode/kind-filter is rejected, never silently reused.
#[allow(clippy::too_many_arguments)]
pub(crate) fn inspect_in_tx(
    tx: &Transaction,
    host_id: &str,
    run_id: &str,
    recipient: &Recipient,
    unread_only: bool,
    kinds: &[MessageKind],
    cursor: Option<&str>,
    limit: u32,
) -> Result<(Vec<MessageSummary>, Option<String>), RpcError> {
    recipient.validate()?;
    if limit == 0 || limit > drogon_protocol::orchestration_common::MAX_PAGE_LIMIT {
        return Err(error::invalid_argument(
            "Page limit is outside the supported range.",
        ));
    }
    let floor = if unread_only {
        read_pointer_in_tx(tx, host_id, run_id, recipient)?
    } else {
        0
    };
    let after = match cursor {
        Some(token) => {
            decode_cursor(token, host_id, run_id, recipient, unread_only, kinds)?.max(floor)
        }
        None => floor,
    };
    // The kind filter is pushed into the SQL predicate itself (never
    // filtered in Rust after a bounded, unfiltered fetch): a probe window
    // that fetches rows before filtering can exhaust its limit on
    // nonmatching rows and silently hide a later matching one.
    let kind_strs: Vec<&'static str> = kinds.iter().map(|k| message_kind_str(*k)).collect();
    let kind_clause = if kind_strs.is_empty() {
        String::new()
    } else {
        format!(
            " AND kind IN ({})",
            kind_strs.iter().map(|_| "?").collect::<Vec<_>>().join(",")
        )
    };
    let probe_limit = limit as i64 + 1;
    let sql = format!(
        "SELECT {} FROM orchestration_mail_messages
          WHERE host_id = ? AND run_id = ? AND to_dispatch_id = ? AND sequence > ?{kind_clause}
          ORDER BY sequence ASC LIMIT {probe_limit}",
        super::message_columns()
    );
    let mut stmt = tx.prepare(&sql).map_err(super::mail_storage_error)?;
    let after_i64 = after as i64;
    let recipient_col = recipient.column();
    let mut all_params: Vec<&dyn rusqlite::ToSql> =
        vec![&host_id, &run_id, &recipient_col, &after_i64];
    for k in &kind_strs {
        all_params.push(k);
    }
    let rows: Vec<StoredMessage> = stmt
        .query_map(all_params.as_slice(), super::decode_message_row)
        .map_err(super::mail_storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(super::mail_storage_error)?;
    let mut included: Vec<MessageSummary> = Vec::new();
    let mut size = 0usize;
    let mut next_cursor = None;
    for (seen, row) in rows.into_iter().enumerate() {
        if seen as u32 >= limit {
            next_cursor = Some(encode_cursor(
                included.last().map(|m| m.sequence).unwrap_or(after),
                host_id,
                run_id,
                recipient,
                unread_only,
                kinds,
            ));
            break;
        }
        let row_size = super::message_wire_size(&row.summary)?;
        if row_size > PACKING_BUDGET_BYTES {
            // An individually oversized row is corruption, not a page
            // boundary: refused outright, regardless of its position.
            return Err(error::internal_error(
                "A stored message exceeds the response budget; refused.",
            ));
        }
        if size + row_size > PACKING_BUDGET_BYTES && !included.is_empty() {
            next_cursor = Some(encode_cursor(
                included.last().map(|m| m.sequence).unwrap_or(after),
                host_id,
                run_id,
                recipient,
                unread_only,
                kinds,
            ));
            break;
        }
        size += row_size;
        included.push(row.summary);
    }
    Ok((included, next_cursor))
}

fn scope_fingerprint(
    host_id: &str,
    run_id: &str,
    recipient: &Recipient,
    unread_only: bool,
    kinds: &[MessageKind],
) -> [u8; 32] {
    fn push(hasher: &mut Sha256, bytes: &[u8]) {
        hasher.update((bytes.len() as u32).to_be_bytes());
        hasher.update(bytes);
    }
    let mut hasher = Sha256::new();
    push(&mut hasher, host_id.as_bytes());
    push(&mut hasher, run_id.as_bytes());
    push(&mut hasher, recipient.column().as_bytes());
    hasher.update([u8::from(unread_only)]);
    let mut tags: Vec<u8> = kinds.iter().map(|k| message_kind_tag(*k)).collect();
    tags.sort_unstable();
    push(&mut hasher, &tags);
    hasher.finalize().into()
}

fn encode_cursor(
    sequence: u64,
    host_id: &str,
    run_id: &str,
    recipient: &Recipient,
    unread_only: bool,
    kinds: &[MessageKind],
) -> String {
    let mut buf = Vec::with_capacity(40);
    buf.extend_from_slice(&sequence.to_be_bytes());
    buf.extend_from_slice(&scope_fingerprint(
        host_id,
        run_id,
        recipient,
        unread_only,
        kinds,
    ));
    crate::session::base64_encode(&buf)
}

fn decode_cursor(
    token: &str,
    host_id: &str,
    run_id: &str,
    recipient: &Recipient,
    unread_only: bool,
    kinds: &[MessageKind],
) -> Result<u64, RpcError> {
    let bytes = crate::session::base64_decode(token)
        .map_err(|_| error::invalid_argument("Invalid orchestration cursor."))?;
    if bytes.len() != 40 {
        return Err(error::invalid_argument("Invalid orchestration cursor."));
    }
    let sequence = u64::from_be_bytes(bytes[0..8].try_into().unwrap());
    // A sequence beyond `i64::MAX` would wrap negative wherever this value
    // is later cast `as i64` for a SQL parameter, turning `sequence > after`
    // into "matches everything" and silently restarting pagination from the
    // top instead of failing.
    if sequence > i64::MAX as u64 {
        return Err(error::invalid_argument("Invalid orchestration cursor."));
    }
    let expected = scope_fingerprint(host_id, run_id, recipient, unread_only, kinds);
    if bytes[8..40] != expected {
        return Err(error::invalid_argument(
            "Cursor does not match this scope/filter.",
        ));
    }
    Ok(sequence)
}
