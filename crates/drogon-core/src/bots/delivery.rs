//! Durable result delivery for Bot conversations (C05).
//!
//! A delivery carries one run's result to one canonical conversation
//! ([`super::conversation::Conversation`]). States are explicit:
//! `pending` (created, never sent), `uncertain` (sent, acknowledgement
//! unknown — never auto-resent, never displayed as delivered), `delivered`
//! (the target acknowledged), `failed` (the target refused or the commit
//! failed, recoverable only by an explicit user action).
//!
//! Crash protocol (three boundaries, each with explicit recovery):
//! - crash before the send effect commits: the row is still `pending`, so
//!   recovery may send it;
//! - crash after the send but before the acknowledgement commits: the row
//!   is already `uncertain` (persisted BEFORE the effect, like the request
//!   ledger's `pending`), so recovery must reconcile — query the target or
//!   ask the user — never blind-retry;
//! - crash after the acknowledgement commits: the row is `delivered`, so
//!   recovery is a no-op.
//!
//! Timeout after possible acceptance is `uncertain`, not failure and not
//! success. This module never claims exactly-once external delivery: the
//! current transport acknowledges locally (`session.write acceptedBytes`
//! and the request ledger's `request_conflict` on changed-payload replay),
//! and anything beyond that is reconciled explicitly.
//!
//! Persistence lives in the SAME SQLite file as the rest of `drogon-core`
//! (table `bot_conversation_deliveries`, created idempotently by
//! [`ensure_schema`]), never a second database and never a raw transcript
//! store: rows carry ids, hashes and states only. Every state change runs
//! inside the caller's `rusqlite::Transaction` so a delivery row and its
//! conversation update commit atomically.
//!
//! Schema status (C05 follow-up correction): [`ensure_schema`] is an
//! UNADOPTED schema proposal, not production migration acceptance. The
//! precise integration the storage owner must apply is: add this table's
//! DDL as the next step of the `bots` component migration chain
//! (`bots::storage`, component `"bots"`, currently v3 → v4) inside
//! `apply_pending_steps_in_tx`'s transaction — so the table, the
//! `schema_versions` bump and the existing downgrade guard
//! (`check_schema_not_ahead`) commit or roll back together with the
//! aggregate gate — after which [`ensure_schema`] remains only an
//! idempotent backstop for standalone tests. Until that handover lands,
//! no production `Conversation`/delivery rows exist. The `_in_tx` helpers
//! below take `&Transaction` precisely so the owner can call them inside
//! that same aggregate transaction; they add no competing storage.
//!
//! Lock discipline: [`DeliveryTarget::send`] takes `&Delivery` (a detached
//! value), never a `Connection` or `Transaction`, and no helper in this
//! module performs network/target I/O under a DB lock. Production callers
//! must drop the database guard before the send effect — the same
//! discipline as `bot.run`'s staged `effect` phase — because the crash
//! protocol depends on `begin_attempt` committing BEFORE the effect runs.

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::claim_identity::js_trim;

const MAX_ID_LEN: usize = 16_384;
const MAX_HASH_LEN: usize = 1024;
const MAX_ERROR_LEN: usize = 16_384;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeliveryError {
    EmptyId,
    EmptyConversationId,
    EmptyBotId,
    EmptyProjectId,
    EmptyHostId,
    EmptyRunId,
    EmptyPayloadHash,
    IdTooLong(&'static str),
    /// Same delivery id, different payload hash: the ledger's
    /// `request_conflict` equivalent. The caller must mint a new id for
    /// different content — the stored row is left untouched.
    PayloadConflict {
        id: String,
    },
    UnknownDelivery(String),
    /// A transition the state machine forbids (e.g. `delivered -> *`,
    /// or `pending -> delivered` without passing through `uncertain`).
    InvalidTransition {
        id: String,
        from: String,
        to: String,
    },
    /// The delivery targets a different conversation/scope than the
    /// caller claims. Refused rather than written to the wrong target.
    WrongTarget {
        expected: String,
        actual: String,
    },
    Storage(String),
}

impl std::fmt::Display for DeliveryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyId => write!(f, "delivery id must be non-empty"),
            Self::EmptyConversationId => write!(f, "conversation id must be non-empty"),
            Self::EmptyBotId => write!(f, "bot id must be non-empty"),
            Self::EmptyProjectId => write!(f, "project id must be non-empty"),
            Self::EmptyHostId => write!(f, "host id must be non-empty"),
            Self::EmptyRunId => write!(f, "originating run id must be non-empty"),
            Self::EmptyPayloadHash => write!(f, "payload hash must be non-empty"),
            Self::IdTooLong(which) => write!(f, "{which} exceeds length bounds"),
            Self::PayloadConflict { id } => write!(
                f,
                "delivery {id} already exists with different content; mint a new id"
            ),
            Self::UnknownDelivery(id) => write!(f, "unknown delivery {id}"),
            Self::InvalidTransition { id, from, to } => {
                write!(f, "delivery {id} cannot move from {from} to {to}")
            }
            Self::WrongTarget { expected, actual } => write!(
                f,
                "delivery targets conversation {expected} but caller names {actual}"
            ),
            Self::Storage(detail) => write!(f, "delivery storage error: {detail}"),
        }
    }
}

impl std::error::Error for DeliveryError {}

impl From<rusqlite::Error> for DeliveryError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Storage(value.to_string())
    }
}

impl From<serde_json::Error> for DeliveryError {
    fn from(value: serde_json::Error) -> Self {
        Self::Storage(value.to_string())
    }
}

fn codepoint_len(s: &str) -> usize {
    s.chars().count()
}

fn check_id(
    value: &str,
    empty: DeliveryError,
    field: &'static str,
) -> Result<String, DeliveryError> {
    let trimmed = js_trim(value).to_string();
    if trimmed.is_empty() {
        return Err(empty);
    }
    if codepoint_len(&trimmed) > MAX_ID_LEN {
        return Err(DeliveryError::IdTooLong(field));
    }
    Ok(trimmed)
}

/// Canonical sha256 hex over the exact result bytes the target will
/// receive. The same bytes always hash the same, so a replayed delivery id
/// with identical content is idempotent while changed content with the
/// same id is a [`DeliveryError::PayloadConflict`] — never a silent
/// second commit.
pub fn payload_hash_for(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Delivery state. `accepted` and `delivered` are the same terminal state
/// here (the target acknowledged); the wire keeps the single word
/// `delivered` so the four states stay mutually exclusive in every view.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeliveryState {
    Pending,
    Uncertain,
    Delivered,
    Failed,
}

impl DeliveryState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Uncertain => "uncertain",
            Self::Delivered => "delivered",
            Self::Failed => "failed",
        }
    }

    pub fn parse(value: &str) -> Result<Self, DeliveryError> {
        match value {
            "pending" => Ok(Self::Pending),
            "uncertain" => Ok(Self::Uncertain),
            "delivered" => Ok(Self::Delivered),
            "failed" => Ok(Self::Failed),
            other => Err(DeliveryError::Storage(format!(
                "unknown delivery state {other}"
            ))),
        }
    }
}

/// What recovery means for a delivery in its current state. `Uncertain`
/// never offers a blind resend: only reconciliation (an explicit target
/// query or user decision) may resolve it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryRecovery {
    /// Still `pending`: safe to attempt the send.
    ResendPending,
    /// `uncertain`: reconcile first (query the target or ask the user);
    /// never auto-resend.
    ReconcileUncertain,
    /// `delivered`: nothing to do.
    NoopDelivered,
    /// `failed`: an explicit user-approved retry may re-enter `uncertain`.
    RetryFailedRequiresApproval,
}

impl DeliveryRecovery {
    pub fn for_state(state: DeliveryState) -> Self {
        match state {
            DeliveryState::Pending => Self::ResendPending,
            DeliveryState::Uncertain => Self::ReconcileUncertain,
            DeliveryState::Delivered => Self::NoopDelivered,
            DeliveryState::Failed => Self::RetryFailedRequiresApproval,
        }
    }
}

/// The outcome of one send attempt against the target. `Timeout` means the
/// bytes may or may not have landed — the delivery stays `uncertain` and
/// is never auto-resent nor displayed as delivered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TargetSendOutcome {
    Accepted,
    Rejected(String),
    Timeout,
}

/// Maps a target outcome to the next durable state. Pure so both the
/// transactional helper and the crash-injection tests agree exactly.
pub fn next_state_for_target_outcome(outcome: &TargetSendOutcome) -> DeliveryState {
    match outcome {
        TargetSendOutcome::Accepted => DeliveryState::Delivered,
        TargetSendOutcome::Rejected(_) => DeliveryState::Failed,
        TargetSendOutcome::Timeout => DeliveryState::Uncertain,
    }
}

/// A deterministic delivery target for tests and for documenting the
/// production contract. Production sends through the existing
/// session/store transport with the DB guard released (same discipline as
/// `bot.run`'s staged `effect` phase); tests implement this trait with a
/// scripted fixture, never a real session or child process.
pub trait DeliveryTarget {
    fn send(&self, delivery: &Delivery) -> TargetSendOutcome;
}

/// One durable delivery. No payload bytes here — only the hash
/// ([`payload_hash_for`]) plus routing ids and state. Reply bytes stay in
/// the session ring; this row proves where they were meant to go and
/// whether the target acknowledged them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Delivery {
    pub id: String,
    pub conversation_id: String,
    pub bot_id: String,
    pub project_id: String,
    pub host_id: String,
    pub run_id: String,
    pub payload_hash: String,
    pub state: DeliveryState,
    pub attempts: u32,
    pub created_at: f64,
    pub updated_at: f64,
    pub last_error: Option<String>,
}

impl Delivery {
    /// Enqueues a new delivery in `pending`. Same id + same payload hash
    /// returns the existing row unchanged (no second locally committed
    /// result); same id + different hash is a [`DeliveryError::PayloadConflict`].
    /// Eight params are the delivery identity itself (seven ids + clock);
    /// grouping them would hide the required fields from callers.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: &str,
        conversation_id: &str,
        bot_id: &str,
        project_id: &str,
        host_id: &str,
        run_id: &str,
        payload_hash: &str,
        now: f64,
    ) -> Result<Self, DeliveryError> {
        let hash = js_trim(payload_hash).to_string();
        if hash.is_empty() {
            return Err(DeliveryError::EmptyPayloadHash);
        }
        if hash.len() > MAX_HASH_LEN {
            return Err(DeliveryError::IdTooLong("payload_hash"));
        }
        Ok(Self {
            id: check_id(id, DeliveryError::EmptyId, "delivery")?,
            conversation_id: check_id(
                conversation_id,
                DeliveryError::EmptyConversationId,
                "conversation",
            )?,
            bot_id: check_id(bot_id, DeliveryError::EmptyBotId, "bot")?,
            project_id: check_id(project_id, DeliveryError::EmptyProjectId, "project")?,
            host_id: check_id(host_id, DeliveryError::EmptyHostId, "host")?,
            run_id: check_id(run_id, DeliveryError::EmptyRunId, "run")?,
            payload_hash: hash,
            state: DeliveryState::Pending,
            attempts: 0,
            created_at: now,
            updated_at: now,
            last_error: None,
        })
    }

    pub fn check_target(&self, conversation_id: &str) -> Result<(), DeliveryError> {
        if js_trim(conversation_id) != self.conversation_id {
            return Err(DeliveryError::WrongTarget {
                expected: self.conversation_id.clone(),
                actual: js_trim(conversation_id).to_string(),
            });
        }
        Ok(())
    }

    pub fn recovery(&self) -> DeliveryRecovery {
        DeliveryRecovery::for_state(self.state)
    }

    /// Pure `pending -> uncertain` (first attempt) or `failed -> uncertain`
    /// (explicit user-approved retry). `uncertain` and `delivered` never
    /// re-enter here: an uncertain delivery must reconcile first, and a
    /// delivered one is terminal.
    pub fn begin_attempt(&mut self, approved_retry: bool, now: f64) -> Result<(), DeliveryError> {
        match self.state {
            DeliveryState::Pending => {
                self.state = DeliveryState::Uncertain;
                self.attempts = self.attempts.saturating_add(1);
                self.updated_at = now;
                Ok(())
            }
            DeliveryState::Failed => {
                if !approved_retry {
                    return Err(DeliveryError::InvalidTransition {
                        id: self.id.clone(),
                        from: self.state.as_str().to_string(),
                        to: DeliveryState::Uncertain.as_str().to_string(),
                    });
                }
                self.state = DeliveryState::Uncertain;
                self.attempts = self.attempts.saturating_add(1);
                self.last_error = None;
                self.updated_at = now;
                Ok(())
            }
            _ => Err(DeliveryError::InvalidTransition {
                id: self.id.clone(),
                from: self.state.as_str().to_string(),
                to: DeliveryState::Uncertain.as_str().to_string(),
            }),
        }
    }

    pub fn commit_delivered(&mut self, now: f64) -> Result<(), DeliveryError> {
        if self.state != DeliveryState::Uncertain {
            return Err(DeliveryError::InvalidTransition {
                id: self.id.clone(),
                from: self.state.as_str().to_string(),
                to: DeliveryState::Delivered.as_str().to_string(),
            });
        }
        self.state = DeliveryState::Delivered;
        self.last_error = None;
        self.updated_at = now;
        Ok(())
    }

    pub fn commit_failed(&mut self, reason: &str, now: f64) -> Result<(), DeliveryError> {
        if self.state != DeliveryState::Uncertain {
            return Err(DeliveryError::InvalidTransition {
                id: self.id.clone(),
                from: self.state.as_str().to_string(),
                to: DeliveryState::Failed.as_str().to_string(),
            });
        }
        let reason = js_trim(reason).to_string();
        let reason = if reason.is_empty() {
            "target refused the delivery".to_string()
        } else {
            reason.chars().take(MAX_ERROR_LEN).collect()
        };
        self.state = DeliveryState::Failed;
        self.last_error = Some(reason);
        self.updated_at = now;
        Ok(())
    }

    /// Resolves an `uncertain` delivery from an explicit reconciliation
    /// result (a target query or user decision supplied by the caller).
    /// `accepted == true` commits `delivered`, otherwise `failed`. Never
    /// called automatically and never retries the send itself.
    pub fn reconcile(
        &mut self,
        accepted: bool,
        note: Option<&str>,
        now: f64,
    ) -> Result<(), DeliveryError> {
        if self.state != DeliveryState::Uncertain {
            let to = if accepted { "delivered" } else { "failed" };
            return Err(DeliveryError::InvalidTransition {
                id: self.id.clone(),
                from: self.state.as_str().to_string(),
                to: to.to_string(),
            });
        }
        if accepted {
            self.state = DeliveryState::Delivered;
            self.last_error = None;
        } else {
            let note = note.map(js_trim).unwrap_or("");
            self.state = DeliveryState::Failed;
            self.last_error = Some(if note.is_empty() {
                "reconciliation found the delivery was not accepted".to_string()
            } else {
                note.chars().take(MAX_ERROR_LEN).collect()
            });
        }
        self.updated_at = now;
        Ok(())
    }
}

/// The small enqueue-result surface C06/C08/C10/C11 consume. Carries the
/// exact context reference ([`super::conversation::ContextReferenceDto`]
/// fields flattened here so a consumer without the conversation row can
/// still enqueue) plus the result hash. The storage owner resolves the
/// conversation row and commits this atomically with it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueResultRequest {
    pub delivery_id: String,
    pub conversation_id: String,
    pub bot_id: String,
    pub project_id: String,
    pub host_id: String,
    pub run_id: String,
    pub payload_hash: String,
}

impl EnqueueResultRequest {
    pub fn into_delivery(self, now: f64) -> Result<Delivery, DeliveryError> {
        Delivery::new(
            &self.delivery_id,
            &self.conversation_id,
            &self.bot_id,
            &self.project_id,
            &self.host_id,
            &self.run_id,
            &self.payload_hash,
            now,
        )
    }
}

/// One decoded `bot_conversation_deliveries` row, in column order. A named
/// struct (rather than 12 positional args) keeps the row shape explicit at
/// every read site.
struct DeliveryRow {
    id: String,
    conversation_id: String,
    bot_id: String,
    project_id: String,
    host_id: String,
    run_id: String,
    payload_hash: String,
    state: String,
    attempts: u32,
    created_at: f64,
    updated_at: f64,
    last_error: Option<String>,
}

fn row_to_delivery(row: DeliveryRow) -> Result<Delivery, DeliveryError> {
    Ok(Delivery {
        id: row.id,
        conversation_id: row.conversation_id,
        bot_id: row.bot_id,
        project_id: row.project_id,
        host_id: row.host_id,
        run_id: row.run_id,
        payload_hash: row.payload_hash,
        state: DeliveryState::parse(&row.state)?,
        attempts: row.attempts,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_error: row.last_error,
    })
}

fn read_delivery(tx: &Transaction, id: &str) -> Result<Option<Delivery>, DeliveryError> {
    tx.query_row(
        "SELECT id, conversation_id, bot_id, project_id, host_id, run_id, payload_hash, state, attempts, created_at, updated_at, last_error
         FROM bot_conversation_deliveries WHERE id = ?1",
        params![id],
        |r| {
            Ok(DeliveryRow {
                id: r.get(0)?,
                conversation_id: r.get(1)?,
                bot_id: r.get(2)?,
                project_id: r.get(3)?,
                host_id: r.get(4)?,
                run_id: r.get(5)?,
                payload_hash: r.get(6)?,
                state: r.get(7)?,
                attempts: r.get::<_, i64>(8)? as u32,
                created_at: r.get(9)?,
                updated_at: r.get(10)?,
                last_error: r.get(11)?,
            })
        },
    )
    .optional()?
    .map(row_to_delivery)
    .transpose()
}

fn write_delivery(tx: &Transaction, delivery: &Delivery) -> Result<(), DeliveryError> {
    tx.execute(
        "INSERT INTO bot_conversation_deliveries
         (id, conversation_id, bot_id, project_id, host_id, run_id, payload_hash, state, attempts, created_at, updated_at, last_error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(id) DO UPDATE SET conversation_id = excluded.conversation_id,
                                        bot_id = excluded.bot_id,
                                        project_id = excluded.project_id,
                                        host_id = excluded.host_id,
                                        run_id = excluded.run_id,
                                        payload_hash = excluded.payload_hash,
                                        state = excluded.state,
                                        attempts = excluded.attempts,
                                        created_at = excluded.created_at,
                                        updated_at = excluded.updated_at,
                                        last_error = excluded.last_error",
        params![
            delivery.id,
            delivery.conversation_id,
            delivery.bot_id,
            delivery.project_id,
            delivery.host_id,
            delivery.run_id,
            delivery.payload_hash,
            delivery.state.as_str(),
            delivery.attempts as i64,
            delivery.created_at,
            delivery.updated_at,
            delivery.last_error,
        ],
    )?;
    Ok(())
}

/// Idempotent, reopen-safe schema gate for the deliveries table. UNADOPTED
/// PROPOSAL (see the module doc): `CREATE TABLE IF NOT EXISTS` only, never
/// touching `schema_versions`. The aggregate-migration owner adopts this
/// DDL as the next `bots`-component step when the handover lands; until
/// then this keeps crash-injection tests and early consumers on the same
/// table shape.
pub fn ensure_schema(conn: &Connection) -> Result<(), DeliveryError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS bot_conversation_deliveries (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            bot_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            host_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            payload_hash TEXT NOT NULL,
            state TEXT NOT NULL,
            attempts INTEGER NOT NULL,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL,
            last_error TEXT
        );
        CREATE INDEX IF NOT EXISTS bot_conversation_deliveries_conversation
            ON bot_conversation_deliveries(conversation_id);",
    )?;
    Ok(())
}

/// Transactional enqueue with ledger-style idempotency: same id + same
/// hash returns the stored row (no second commit); same id + different
/// hash is a [`DeliveryError::PayloadConflict`] and writes nothing.
pub fn enqueue_in_tx(tx: &Transaction, delivery: &Delivery) -> Result<Delivery, DeliveryError> {
    if let Some(existing) = read_delivery(tx, &delivery.id)? {
        if existing.payload_hash != delivery.payload_hash {
            return Err(DeliveryError::PayloadConflict {
                id: delivery.id.clone(),
            });
        }
        if existing.conversation_id != delivery.conversation_id
            || existing.bot_id != delivery.bot_id
            || existing.project_id != delivery.project_id
            || existing.host_id != delivery.host_id
        {
            return Err(DeliveryError::WrongTarget {
                expected: existing.conversation_id.clone(),
                actual: delivery.conversation_id.clone(),
            });
        }
        return Ok(existing);
    }
    write_delivery(tx, delivery)?;
    Ok(delivery.clone())
}

pub fn get_in_tx(tx: &Transaction, id: &str) -> Result<Option<Delivery>, DeliveryError> {
    read_delivery(tx, id)
}

pub fn list_for_conversation_in_tx(
    tx: &Transaction,
    conversation_id: &str,
) -> Result<Vec<Delivery>, DeliveryError> {
    let mut stmt = tx.prepare(
        "SELECT id, conversation_id, bot_id, project_id, host_id, run_id, payload_hash, state, attempts, created_at, updated_at, last_error
         FROM bot_conversation_deliveries WHERE conversation_id = ?1 ORDER BY created_at ASC, rowid ASC",
    )?;
    let rows: Vec<DeliveryRow> = stmt
        .query_map(params![conversation_id], |r| {
            Ok(DeliveryRow {
                id: r.get(0)?,
                conversation_id: r.get(1)?,
                bot_id: r.get(2)?,
                project_id: r.get(3)?,
                host_id: r.get(4)?,
                run_id: r.get(5)?,
                payload_hash: r.get(6)?,
                state: r.get(7)?,
                attempts: r.get::<_, i64>(8)? as u32,
                created_at: r.get(9)?,
                updated_at: r.get(10)?,
                last_error: r.get(11)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter().map(row_to_delivery).collect()
}

/// Persists `pending -> uncertain` (or approved `failed -> uncertain`).
/// This commit happens BEFORE the send effect: a crash after this commit
/// but before the ack commit recovers as `uncertain`, never as a silent
/// resend.
pub fn begin_attempt_in_tx(
    tx: &Transaction,
    id: &str,
    approved_retry: bool,
    now: f64,
) -> Result<Delivery, DeliveryError> {
    let mut delivery =
        read_delivery(tx, id)?.ok_or(DeliveryError::UnknownDelivery(id.to_string()))?;
    delivery.begin_attempt(approved_retry, now)?;
    write_delivery(tx, &delivery)?;
    Ok(delivery)
}

pub fn commit_delivered_in_tx(
    tx: &Transaction,
    id: &str,
    now: f64,
) -> Result<Delivery, DeliveryError> {
    let mut delivery =
        read_delivery(tx, id)?.ok_or(DeliveryError::UnknownDelivery(id.to_string()))?;
    delivery.commit_delivered(now)?;
    write_delivery(tx, &delivery)?;
    Ok(delivery)
}

pub fn commit_failed_in_tx(
    tx: &Transaction,
    id: &str,
    reason: &str,
    now: f64,
) -> Result<Delivery, DeliveryError> {
    let mut delivery =
        read_delivery(tx, id)?.ok_or(DeliveryError::UnknownDelivery(id.to_string()))?;
    delivery.commit_failed(reason, now)?;
    write_delivery(tx, &delivery)?;
    Ok(delivery)
}

/// Persists an explicit reconciliation of an `uncertain` delivery. The
/// caller supplies the reconciled truth (`accepted` from a target query
/// or user decision); this never performs the send itself.
pub fn reconcile_in_tx(
    tx: &Transaction,
    id: &str,
    accepted: bool,
    note: Option<&str>,
    now: f64,
) -> Result<Delivery, DeliveryError> {
    let mut delivery =
        read_delivery(tx, id)?.ok_or(DeliveryError::UnknownDelivery(id.to_string()))?;
    delivery.reconcile(accepted, note, now)?;
    write_delivery(tx, &delivery)?;
    Ok(delivery)
}

/// Connection-bound convenience wrappers (each opens and commits its own
/// transaction). Crash-injection tests use the `_in_tx` variants above
/// with an explicit transaction so they control commit vs. rollback at
/// each of the three send/receipt boundaries.
pub fn enqueue(conn: &Connection, delivery: &Delivery) -> Result<Delivery, DeliveryError> {
    ensure_schema(conn)?;
    let tx = conn.unchecked_transaction()?;
    let result = enqueue_in_tx(&tx, delivery)?;
    tx.commit()?;
    Ok(result)
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Delivery>, DeliveryError> {
    ensure_schema(conn)?;
    let tx = conn.unchecked_transaction()?;
    let result = read_delivery(&tx, id)?;
    tx.rollback()?;
    Ok(result)
}
