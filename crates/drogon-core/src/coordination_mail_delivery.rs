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

use super::{RESPONSE_BUDGET_BYTES, Recipient, StoredMessage, message_kind_str, message_kind_tag};
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

fn read_pointer_in_tx(
    tx: &Transaction,
    host_id: &str,
    run_id: &str,
    recipient: &Recipient,
) -> Result<u64, RpcError> {
    tx.query_row(
        "SELECT read_through_sequence FROM orchestration_mail_read_pointers
          WHERE host_id = ?1 AND run_id = ?2 AND to_dispatch_id = ?3",
        params![host_id, run_id, recipient.column()],
        |r| r.get::<_, i64>(0),
    )
    .optional()
    .map_err(error::from_sqlite)
    .map(|v| v.unwrap_or(0) as u64)
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
    .map_err(error::from_sqlite)?;
    Ok(())
}

fn active_delivery_in_tx(
    tx: &Transaction,
    host_id: &str,
    run_id: &str,
    recipient: &Recipient,
    consumer: &Consumer,
) -> Result<Option<(String, Vec<String>)>, RpcError> {
    tx.query_row(
        "SELECT delivery_id, message_ids_json FROM orchestration_mail_deliveries
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
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
    )
    .optional()
    .map_err(error::from_sqlite)?
    .map(|(id, ids_json)| {
        let ids: Vec<String> = serde_json::from_str(&ids_json)
            .map_err(|_| error::internal_error("Invalid stored delivery batch."))?;
        Ok((id, ids))
    })
    .transpose()
}

fn load_messages_in_order(
    tx: &Transaction,
    host_id: &str,
    run_id: &str,
    ids: &[String],
) -> Result<Vec<MessageSummary>, RpcError> {
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        let stored = super::get_message_in_tx(tx, host_id, run_id, id)?
            .ok_or_else(|| error::internal_error("Delivered message is missing."))?;
        out.push(stored.summary);
    }
    Ok(out)
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
    let mut stmt = tx.prepare(&sql).map_err(error::from_sqlite)?;
    let rows = stmt
        .query_map(
            params![host_id, run_id, recipient.column(), after_sequence as i64],
            super::decode_message_row,
        )
        .map_err(error::from_sqlite)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error::from_sqlite)?;
    Ok(rows)
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
        .map_err(error::from_sqlite)?;
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
            .map_err(error::from_sqlite)?;
        if newest.is_some_and(|newest| newest > *generation as i64) {
            return Err(error::invalid_argument(
                "This consumer generation has been superseded by a takeover.",
            ));
        }
    }
    let message_ids: Vec<String> = serde_json::from_str(&ids_json)
        .map_err(|_| error::internal_error("Invalid stored delivery batch."))?;
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
    .map_err(error::from_sqlite)?;
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

    if let Some((delivery_id, message_ids)) =
        active_delivery_in_tx(tx, host_id, run_id, recipient, consumer)?
    {
        let messages = load_messages_in_order(tx, host_id, run_id, &message_ids)?;
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
    if !kinds.is_empty() && !candidates.iter().any(|m| kinds.contains(&m.summary.kind)) {
        // Wake condition unmet: earlier nonmatching messages are never
        // skipped/dropped — simply no allocation happens yet.
        return Ok(CheckOutcome {
            delivery: None,
            acknowledged,
            messages: Vec::new(),
        });
    }
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
    .map_err(error::from_sqlite)?;
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
    let probe_limit = limit as i64 + 1;
    let kind_filter: Option<Vec<&'static str>> =
        (!kinds.is_empty()).then(|| kinds.iter().map(|k| message_kind_str(*k)).collect());
    let sql = format!(
        "SELECT {} FROM orchestration_mail_messages
          WHERE host_id = ?1 AND run_id = ?2 AND to_dispatch_id = ?3 AND sequence > ?4
          ORDER BY sequence ASC LIMIT {probe_limit}",
        super::message_columns()
    );
    let mut stmt = tx.prepare(&sql).map_err(error::from_sqlite)?;
    let rows: Vec<StoredMessage> = stmt
        .query_map(
            params![host_id, run_id, recipient.column(), after as i64],
            super::decode_message_row,
        )
        .map_err(error::from_sqlite)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error::from_sqlite)?;
    let mut included: Vec<MessageSummary> = Vec::new();
    let mut size = 0usize;
    let mut next_cursor = None;
    let mut seen = 0u32;
    for row in rows {
        if let Some(filter) = &kind_filter
            && !filter.contains(&message_kind_str(row.summary.kind))
        {
            continue;
        }
        if seen >= limit {
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
        let row_size = row.summary.subject.len()
            + row.summary.body.as_ref().map_or(0, String::len)
            + row
                .summary
                .payload
                .as_ref()
                .map_or(0, |p| serde_json::to_vec(p).map(|v| v.len()).unwrap_or(0));
        if size + row_size > RESPONSE_BUDGET_BYTES && !included.is_empty() {
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
        seen += 1;
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
    let expected = scope_fingerprint(host_id, run_id, recipient, unread_only, kinds);
    if bytes[8..40] != expected {
        return Err(error::invalid_argument(
            "Cursor does not match this scope/filter.",
        ));
    }
    Ok(sequence)
}
