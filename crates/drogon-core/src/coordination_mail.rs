//! Transaction-only native mail domain: durable messages, one recipient
//! each, ordered by database sequence. Callers supply the transaction, all
//! identity and every id; this module mints nothing and opens no connection.
//! `coordination_mail_delivery.rs` covers check/peek/all/ack;
//! `coordination_mail_questions.rs` covers ask/reply/close. Root owns
//! authentication and RPC wiring. Group fanout is root's job and must
//! happen inside the ONE calling transaction that also produces the send's
//! own receipt — one `append_message_in_tx` call per member, all in that
//! same transaction, never one transaction per member (a partial fanout
//! must never commit).

use drogon_protocol::RpcError;
use drogon_protocol::orchestration_common::validate_opaque_token;
use drogon_protocol::orchestration_mail::{MessageKind, MessageSummary};
use rusqlite::{OptionalExtension, Transaction, params};
use serde_json::Value;

use crate::error;

#[path = "coordination_mail_delivery.rs"]
pub(crate) mod delivery;
#[path = "coordination_mail_questions.rs"]
pub(crate) mod questions;

#[cfg(test)]
#[path = "coordination_mail_tests.rs"]
mod coordination_mail_tests;

pub(crate) const SCHEMA_COMPONENT: &str = "orchestration_mail";
pub(crate) const SCHEMA_VERSION: i64 = 1;

/// Single-message and page response budget (bytes); enforced before mutation
/// or consumption, never a silent truncation.
pub(crate) const RESPONSE_BUDGET_BYTES: usize = 512 * 1024;

/// Conservative flat overhead added per message on top of its own
/// `MessageSummary` JSON bytes, approximating what it contributes to a real
/// wire response beyond that: its id echoed again in
/// `delivery.messageIds`/`acknowledged.messageIds`, and surrounding JSON
/// array/object punctuation. Not an exact accounting of a same-call ACK's
/// own (separately, already budget-checked at its own mint time) delivery.
pub(crate) const PER_MESSAGE_WIRE_OVERHEAD_BYTES: usize = 256;

/// Never echoes raw SQLite driver/trigger text, which could otherwise
/// surface a stored subject/body/payload (or any other bound value) through
/// a constraint or extended error message. Every mail-storage failure gets
/// one fixed, generic message instead. Kept local to this domain rather
/// than touching the crate-wide `error::from_sqlite`.
pub(crate) fn mail_storage_error(_err: rusqlite::Error) -> RpcError {
    RpcError::new("internal_error", "Mail storage operation failed.")
}

/// The actual wire footprint of one message: its real serialized
/// `MessageSummary` bytes (so JSON escaping, ids, kind tag and every field
/// are accounted for, not a raw string-length guess) plus the conservative
/// per-message envelope overhead.
pub(crate) fn message_wire_size(summary: &MessageSummary) -> Result<usize, RpcError> {
    let bytes = serde_json::to_vec(summary)
        .map_err(|_| error::invalid_argument("Message is not serializable."))?;
    Ok(bytes.len() + PER_MESSAGE_WIRE_OVERHEAD_BYTES)
}

/// Worst-case bytes a full 50-id ACK echo plus a delivery's own 50-id
/// metadata plus the Response/CheckResult skeleton add on top of whatever
/// messages are packed (measured at 26497 bytes with maximally-escaped
/// 128-byte ids; see `combined_ack_and_delivery_response_fits_the_wire_budget`).
pub(crate) const RESPONSE_ENVELOPE_RESERVE_BYTES: usize = 32 * 1024;

/// Ceiling actually enforced when packing messages into a delivery or an
/// inspection page: the wire budget minus the envelope reserve, so a
/// same-call ACK or the envelope itself never pushes the real response over
/// `RESPONSE_BUDGET_BYTES`.
pub(crate) const PACKING_BUDGET_BYTES: usize =
    RESPONSE_BUDGET_BYTES - RESPONSE_ENVELOPE_RESERVE_BYTES;

/// A message/question recipient: the run's own home mailbox, or one exact
/// dispatch's inbox. Group addressing has no single recipient and is root's
/// job to fan out before calling here (one `append_message_in_tx` per member).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Recipient {
    RunHome,
    Dispatch(String),
}

impl Recipient {
    /// Storage sentinel: dispatch ids are validated non-empty, so `""`
    /// unambiguously means "no dispatch", never a real recipient.
    fn column(&self) -> &str {
        match self {
            Recipient::RunHome => "",
            Recipient::Dispatch(id) => id,
        }
    }

    fn validate(&self) -> Result<(), RpcError> {
        match self {
            Recipient::RunHome => Ok(()),
            Recipient::Dispatch(id) => validate_opaque_token(id, 128, "Invalid dispatch id."),
        }
    }
}

/// A message sender or question party: the coordinator, or one exact
/// dispatch. Stored as separate columns, never delimiter-joined.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Actor {
    Coordinator(String),
    Dispatch(String),
}

impl Actor {
    fn kind(&self) -> &'static str {
        match self {
            Actor::Coordinator(_) => "coordinator",
            Actor::Dispatch(_) => "dispatch",
        }
    }

    fn coordinator_id(&self) -> Option<&str> {
        match self {
            Actor::Coordinator(id) => Some(id.as_str()),
            Actor::Dispatch(_) => None,
        }
    }

    fn dispatch_id(&self) -> Option<&str> {
        match self {
            Actor::Coordinator(_) => None,
            Actor::Dispatch(id) => Some(id.as_str()),
        }
    }

    fn validate(&self) -> Result<(), RpcError> {
        match self {
            Actor::Coordinator(id) => validate_opaque_token(id, 128, "Invalid coordinator id."),
            Actor::Dispatch(id) => validate_opaque_token(id, 128, "Invalid dispatch id."),
        }
    }
}

/// Stable discriminant for cursor fingerprinting; not a wire value.
pub(crate) fn message_kind_tag(kind: MessageKind) -> u8 {
    match kind {
        MessageKind::Status => 0,
        MessageKind::Question => 1,
        MessageKind::Answer => 2,
        MessageKind::Heartbeat => 3,
        MessageKind::FinalReport => 4,
        MessageKind::Guidance => 5,
        MessageKind::Escalation => 6,
    }
}

fn message_kind_str(kind: MessageKind) -> &'static str {
    match kind {
        MessageKind::Status => "status",
        MessageKind::Question => "question",
        MessageKind::Answer => "answer",
        MessageKind::Heartbeat => "heartbeat",
        MessageKind::FinalReport => "finalReport",
        MessageKind::Guidance => "guidance",
        MessageKind::Escalation => "escalation",
    }
}

fn message_kind_from_str(value: &str) -> Result<MessageKind, RpcError> {
    Ok(match value {
        "status" => MessageKind::Status,
        "question" => MessageKind::Question,
        "answer" => MessageKind::Answer,
        "heartbeat" => MessageKind::Heartbeat,
        "finalReport" => MessageKind::FinalReport,
        "guidance" => MessageKind::Guidance,
        "escalation" => MessageKind::Escalation,
        _ => return Err(error::internal_error("Invalid stored message kind.")),
    })
}

/// Additive v1 schema: messages, per-mailbox read pointers, deliveries and
/// questions. Refuses a future recorded version before touching any table;
/// the caller's own transaction rollback undoes every step here.
pub(crate) fn migrate_in_tx(tx: &Transaction) -> Result<(), RpcError> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_versions (
            component TEXT PRIMARY KEY,
            version INTEGER NOT NULL
        );",
    )
    .map_err(mail_storage_error)?;
    let found: Option<i64> = tx
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()
        .map_err(mail_storage_error)?;
    // With exactly one released version, any recorded value other than
    // precisely `SCHEMA_VERSION` -- future (too high) or corrupt (0,
    // negative, or any other stray value) -- is refused explicitly rather
    // than silently stepped forward.
    if let Some(found) = found {
        if found != SCHEMA_VERSION {
            return Err(RpcError::new(
                "unsupported_orchestration_contract",
                "Unsupported orchestration mail schema version.",
            ));
        }
        return Ok(());
    }
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS orchestration_mail_messages (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT NOT NULL UNIQUE,
            host_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            from_kind TEXT NOT NULL,
            from_coordinator_id TEXT,
            from_dispatch_id TEXT,
            to_dispatch_id TEXT NOT NULL DEFAULT '',
            subject TEXT NOT NULL,
            body TEXT,
            payload_json TEXT,
            thread_id TEXT NOT NULL,
            origin_request_id TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS orchestration_mail_messages_mailbox
            ON orchestration_mail_messages(host_id, run_id, to_dispatch_id, sequence);

        CREATE TABLE IF NOT EXISTS orchestration_mail_read_pointers (
            host_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            to_dispatch_id TEXT NOT NULL DEFAULT '',
            read_through_sequence INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (host_id, run_id, to_dispatch_id)
        );

        CREATE TABLE IF NOT EXISTS orchestration_mail_deliveries (
            delivery_id TEXT PRIMARY KEY,
            host_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            to_dispatch_id TEXT NOT NULL DEFAULT '',
            consumer_coordinator_id TEXT,
            consumer_generation INTEGER,
            message_ids_json TEXT NOT NULL,
            max_sequence INTEGER NOT NULL,
            acknowledged INTEGER NOT NULL DEFAULT 0
        );
        CREATE UNIQUE INDEX IF NOT EXISTS orchestration_mail_deliveries_active
            ON orchestration_mail_deliveries(
                host_id, run_id, to_dispatch_id,
                COALESCE(consumer_coordinator_id, ''), COALESCE(consumer_generation, -1)
            ) WHERE acknowledged = 0;

        CREATE TABLE IF NOT EXISTS orchestration_mail_questions (
            question_message_id TEXT PRIMARY KEY,
            host_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            thread_id TEXT NOT NULL,
            closed INTEGER NOT NULL DEFAULT 0,
            closed_reason TEXT,
            answer_message_id TEXT,
            answer_body TEXT,
            answer_origin_request_id TEXT
        );
        CREATE INDEX IF NOT EXISTS orchestration_mail_messages_dispatch_party
            ON orchestration_mail_messages(host_id, run_id, from_dispatch_id);",
    )
    .map_err(mail_storage_error)?;
    tx.execute(
        "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)
         ON CONFLICT(component) DO UPDATE SET version = excluded.version",
        params![SCHEMA_COMPONENT, SCHEMA_VERSION],
    )
    .map_err(mail_storage_error)?;
    Ok(())
}

/// Everything needed to append one immutable message. `created_at` and every
/// id are caller-supplied (no clock/id minting in this module).
pub(crate) struct NewMessage<'a> {
    pub(crate) message_id: &'a str,
    pub(crate) host_id: &'a str,
    pub(crate) run_id: &'a str,
    pub(crate) kind: MessageKind,
    pub(crate) from: &'a Actor,
    pub(crate) to: &'a Recipient,
    pub(crate) subject: &'a str,
    pub(crate) body: Option<&'a str>,
    pub(crate) payload: Option<&'a Value>,
    /// When absent, the message starts its own thread (`thread_id ==
    /// message_id`) — a caller-supplied identity, not a minted one.
    pub(crate) thread_id: Option<&'a str>,
    pub(crate) origin_request_id: &'a str,
    pub(crate) created_at: &'a str,
}

/// Refuses before any mutation if the message's actual serialized wire
/// shape (subject, body, payload, ids, kind, JSON escaping and all) would
/// make it individually unframeable, rather than silently truncating it. A
/// raw string-length sum ignores JSON escaping (e.g. every `"`/`\\` doubles
/// under encoding) and every non-body field, so it can wrongly accept a
/// message whose real wire bytes exceed the budget.
#[allow(clippy::too_many_arguments)]
fn enforce_message_size(
    message_id: &str,
    kind: MessageKind,
    from: &Actor,
    to: &Recipient,
    subject: &str,
    body: Option<&str>,
    payload: Option<&Value>,
    thread_id: &str,
) -> Result<(), RpcError> {
    let probe = row_to_summary(
        message_id.to_string(),
        0,
        kind,
        from,
        to,
        subject.to_string(),
        body.map(str::to_string),
        payload.cloned(),
        Some(thread_id.to_string()),
    );
    if message_wire_size(&probe)? > RESPONSE_BUDGET_BYTES {
        return Err(error::invalid_argument(
            "Message exceeds the response budget.",
        ));
    }
    Ok(())
}

/// Appends one immutable message and returns its durable summary. Used
/// directly by `send` and internally by `ask`/`reply` for the correlated
/// question/answer messages, all inside the caller's one transaction.
pub(crate) fn append_message_in_tx(
    tx: &Transaction,
    new: NewMessage,
) -> Result<MessageSummary, RpcError> {
    validate_opaque_token(new.message_id, 128, "Invalid message id.")?;
    validate_opaque_token(new.host_id, 128, "Invalid host id.")?;
    validate_opaque_token(new.run_id, 128, "Invalid run id.")?;
    new.from.validate()?;
    new.to.validate()?;
    if let Some(thread) = new.thread_id {
        validate_opaque_token(thread, 128, "Invalid thread id.")?;
    }
    let thread_id = new.thread_id.unwrap_or(new.message_id);
    enforce_message_size(
        new.message_id,
        new.kind,
        new.from,
        new.to,
        new.subject,
        new.body,
        new.payload,
        thread_id,
    )?;
    let payload_json = new
        .payload
        .map(serde_json::to_string)
        .transpose()
        .map_err(|_| error::invalid_argument("Message payload is not serializable."))?;
    tx.execute(
        "INSERT INTO orchestration_mail_messages
            (message_id, host_id, run_id, kind, from_kind, from_coordinator_id, from_dispatch_id,
             to_dispatch_id, subject, body, payload_json, thread_id, origin_request_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            new.message_id,
            new.host_id,
            new.run_id,
            message_kind_str(new.kind),
            new.from.kind(),
            new.from.coordinator_id(),
            new.from.dispatch_id(),
            new.to.column(),
            new.subject,
            new.body,
            payload_json,
            thread_id,
            new.origin_request_id,
            new.created_at,
        ],
    )
    .map_err(|err| match err {
        rusqlite::Error::SqliteFailure(e, _)
            if e.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE =>
        {
            error::invalid_argument("message id already used")
        }
        other => mail_storage_error(other),
    })?;
    let sequence = tx.last_insert_rowid() as u64;
    Ok(row_to_summary(
        new.message_id.to_string(),
        sequence,
        new.kind,
        new.from,
        new.to,
        new.subject.to_string(),
        new.body.map(str::to_string),
        new.payload.cloned(),
        Some(thread_id.to_string()),
    ))
}

#[allow(clippy::too_many_arguments)]
fn row_to_summary(
    message_id: String,
    sequence: u64,
    kind: MessageKind,
    from: &Actor,
    to: &Recipient,
    subject: String,
    body: Option<String>,
    payload: Option<Value>,
    thread_id: Option<String>,
) -> MessageSummary {
    let from_actor = match from {
        Actor::Coordinator(id) => format!("coordinator:{id}"),
        Actor::Dispatch(id) => format!("dispatch:{id}"),
    };
    let to_actor = match to {
        Recipient::RunHome => None,
        Recipient::Dispatch(id) => Some(format!("dispatch:{id}")),
    };
    MessageSummary {
        message_id,
        sequence,
        kind,
        from_actor,
        to_actor,
        subject,
        body,
        payload,
        thread_id,
    }
}

/// Beyond the frozen wire `MessageSummary`, root needs the sender's typed
/// identity and the request that produced this message: `from` for
/// exact-party ask/reply authorization (never parse the opaque
/// `summary.from_actor` string back apart), and `origin_request_id` for
/// `DuplicateReportReceipt`-style recovery of the request that created it.
#[derive(Debug)]
pub(crate) struct StoredMessage {
    pub(crate) summary: MessageSummary,
    pub(crate) to: Recipient,
    pub(crate) from: Actor,
    pub(crate) origin_request_id: String,
}

fn corrupt_row(field: usize, message: &'static str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(field, rusqlite::types::Type::Text, message.into())
}

fn decode_row(row: &rusqlite::Row) -> rusqlite::Result<StoredMessage> {
    let message_id: String = row.get(0)?;
    let sequence: i64 = row.get(1)?;
    if sequence < 0 {
        return Err(corrupt_row(1, "negative stored sequence"));
    }
    let kind: String = row.get(2)?;
    let from_kind: String = row.get(3)?;
    let from_coordinator_id: Option<String> = row.get(4)?;
    let from_dispatch_id: Option<String> = row.get(5)?;
    let to_dispatch_id: String = row.get(6)?;
    let subject: String = row.get(7)?;
    let body: Option<String> = row.get(8)?;
    let payload_json: Option<String> = row.get(9)?;
    let thread_id: String = row.get(10)?;
    let origin_request_id: String = row.get(11)?;
    // An unrecognized `from_kind`, or the paired identity column missing or
    // empty, is corruption -- never silently defaulted to an empty-id actor.
    let from = match from_kind.as_str() {
        "coordinator" => match from_coordinator_id {
            Some(id) if !id.is_empty() => Actor::Coordinator(id),
            _ => return Err(corrupt_row(4, "missing coordinator sender identity")),
        },
        "dispatch" => match from_dispatch_id {
            Some(id) if !id.is_empty() => Actor::Dispatch(id),
            _ => return Err(corrupt_row(5, "missing dispatch sender identity")),
        },
        _ => return Err(corrupt_row(3, "unknown sender kind")),
    };
    let to = if to_dispatch_id.is_empty() {
        Recipient::RunHome
    } else {
        Recipient::Dispatch(to_dispatch_id)
    };
    let payload = payload_json
        .map(|json| serde_json::from_str(&json))
        .transpose()
        .map_err(|_| corrupt_row(9, "invalid stored payload"))?;
    let kind = message_kind_from_str(&kind).map_err(|_| corrupt_row(2, "invalid stored kind"))?;
    Ok(StoredMessage {
        summary: row_to_summary(
            message_id,
            sequence as u64,
            kind,
            &from,
            &to,
            subject,
            body,
            payload,
            Some(thread_id),
        ),
        to,
        from,
        origin_request_id,
    })
}

/// Exact read: the message must exist for this host/run to be returned.
/// Never destructive; the read/consumption pointer lives in the delivery
/// tables, not here.
pub(crate) fn get_message_in_tx(
    tx: &Transaction,
    host_id: &str,
    run_id: &str,
    message_id: &str,
) -> Result<Option<StoredMessage>, RpcError> {
    tx.query_row(
        &format!(
            "SELECT {} FROM orchestration_mail_messages
              WHERE host_id = ?1 AND run_id = ?2 AND message_id = ?3",
            message_columns()
        ),
        params![host_id, run_id, message_id],
        decode_row,
    )
    .optional()
    .map_err(mail_storage_error)
}

pub(crate) fn message_columns() -> &'static str {
    "message_id, sequence, kind, from_kind, from_coordinator_id, from_dispatch_id,
     to_dispatch_id, subject, body, payload_json, thread_id, origin_request_id"
}

pub(crate) fn decode_message_row(row: &rusqlite::Row) -> rusqlite::Result<StoredMessage> {
    decode_row(row)
}
