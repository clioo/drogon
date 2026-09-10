//! Mail wire types: `orchestration.send`, `orchestration.check`,
//! `orchestration.reply`. Whole-batch delivery with explicit ACK, mutually
//! exclusive read modes, and scoped lifecycle reports. Shape validation only;
//! mail ordering, delivery allocation and consumption are engine obligations.

use crate::RpcError;
use crate::orchestration_common::{
    ActorScope, MAX_SUBJECT_TEXT_BYTES, OpaqueCursor, ReportOutcome, WaitPolicy,
    validate_opaque_token, validate_task_text,
};
use crate::orchestration_scope::HostScope;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Coordination message kinds. Source `worker_done` maps to `finalReport`;
/// coordinator guidance is its own kind so a dispatch-scoped inbox can filter
/// it without parsing subjects. `escalation` preserves the source escalation
/// workflow. Unknown kinds are refused at decode (unsupported input), never
/// silently ignored.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MessageKind {
    Status,
    Question,
    Answer,
    Heartbeat,
    FinalReport,
    Guidance,
    Escalation,
    /// Source-only kinds carried as opaque mail with no lifecycle effect.
    Dispatch,
    MergeReady,
    Handoff,
    DecisionGate,
}

/// Source display priority (`MessagePriority`): urgent/high messages render
/// `[URGENT]`/`[HIGH]` tags in human output. Absent on the wire means
/// normal (pre-priority senders and stores).
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MessagePriority {
    #[default]
    Normal,
    High,
    Urgent,
}

impl MessagePriority {
    pub fn tag(self) -> &'static str {
        match self {
            MessagePriority::Normal => "",
            MessagePriority::High => " [HIGH]",
            MessagePriority::Urgent => " [URGENT]",
        }
    }

    pub fn from_stored(value: &str) -> Option<Self> {
        match value {
            "normal" => Some(MessagePriority::Normal),
            "high" => Some(MessagePriority::High),
            "urgent" => Some(MessagePriority::Urgent),
            _ => None,
        }
    }

    pub fn as_stored(self) -> &'static str {
        match self {
            MessagePriority::Normal => "normal",
            MessagePriority::High => "high",
            MessagePriority::Urgent => "urgent",
        }
    }
}

/// Addressing. Lifecycle kinds may only target the run home (or omit the
/// target for the sender's own run home); group addressing stays available
/// for non-lifecycle traffic. Authority for guidance/replies is validated by
/// the engine against the credential, not by the addressed ids.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SendTarget {
    RunHome,
    Dispatch { dispatch_id: String },
    Group { name: String },
}

impl SendTarget {
    pub fn validate_shape(&self) -> Result<(), RpcError> {
        match self {
            SendTarget::RunHome => Ok(()),
            SendTarget::Dispatch { dispatch_id } => {
                validate_opaque_token(dispatch_id, 128, "Invalid dispatch id.")
            }
            SendTarget::Group { name } => {
                validate_opaque_token(name, 128, "Invalid group address.")
            }
        }
    }
}

/// Final-report payload bound to the exact sending attempt. `result` is the
/// explicitly allowed task-authored result metadata blob.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalReport {
    pub outcome: ReportOutcome,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
}

/// Why: send params couple the lifecycle report fields to the final-report
/// kind conditionally; `validate_shape` enforces the coupling because serde
/// cannot express "required iff kind == finalReport" declaratively.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendParams {
    pub scope: ActorScope,
    pub kind: MessageKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<SendTarget>,
    pub subject: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// Structured message payload (task-authored data, source: `payload`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    /// Display priority (source: `priority`); absent means normal.
    #[serde(default)]
    pub priority: MessagePriority,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    /// Required exactly when `kind` is `finalReport` (source: `--outcome`
    /// paired with `worker_done`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub final_report: Option<FinalReport>,
}

impl SendParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(execution_host_id)?;
        validate_task_text(
            &self.subject,
            MAX_SUBJECT_TEXT_BYTES,
            "Invalid message subject.",
        )?;
        if let Some(body) = &self.body {
            validate_task_text(
                body,
                crate::orchestration_common::MAX_TASK_TEXT_BYTES,
                "Invalid message body.",
            )?;
        }
        if let Some(thread) = &self.thread_id {
            validate_opaque_token(thread, 128, "Invalid thread id.")?;
        }
        if let Some(target) = &self.to {
            target.validate_shape()?;
        }
        if self.kind == MessageKind::Answer {
            return Err(RpcError::new(
                "invalid_argument",
                "Answers require orchestration.reply with an authorized question reference.",
            ));
        }
        // Why: a worker's lifecycle state belongs to one exact run home; the
        // source CLI refuses group (and any dispatch) addressing for
        // heartbeat/worker_done, and the wire keeps that rule. Guidance and
        // replies keep dispatch/group addressing with engine-side authority.
        if matches!(self.kind, MessageKind::Heartbeat | MessageKind::FinalReport) {
            match &self.to {
                None | Some(SendTarget::RunHome) => {}
                Some(_) => {
                    return Err(RpcError::new(
                        "invalid_argument",
                        "Lifecycle messages may only target the run home.",
                    ));
                }
            }
        }
        match (self.kind, &self.final_report) {
            (MessageKind::FinalReport, None) => Err(RpcError::new(
                "invalid_argument",
                "A final report requires the final report payload.",
            )),
            (MessageKind::FinalReport, Some(_)) => Ok(()),
            (_, Some(_)) => Err(RpcError::new(
                "invalid_argument",
                "The final report payload is only valid on a final report.",
            )),
            _ => Ok(()),
        }
    }
}

/// Receipt for one accepted message. `sequence` is the durable mail position.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageReceipt {
    pub message_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sequence: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
}

/// Lifecycle settlement verdict for a final report (source: `lifecycle`).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LifecycleVerdict {
    Completed,
    Failed,
    /// Accepted settlement, possibly as a duplicate of the original report.
    Settled {
        outcome: ReportOutcome,
        #[serde(default)]
        duplicate: bool,
    },
    /// Rejected before effects; `code`/`reason` are the runtime's own
    /// (source: `sender_not_assignee` travels verbatim).
    Rejected {
        code: String,
        reason: String,
    },
}

/// Identifies the original committed report for a duplicate settlement
/// (contract: duplicate receipts identify the original, never re-create it).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateReportReceipt {
    pub original_request_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_message_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendWarning {
    pub code: String,
    pub recipient: String,
    pub message: String,
}

/// Send result. Exactly one of `message`/`batch` is set; `lifecycle` is set
/// for lifecycle sends. `validate_shape` enforces the exclusivity.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<MessageReceipt>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub batch: Option<SendBatchResult>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lifecycle: Option<LifecycleVerdict>,
    /// Duplicate settlement receipt identifying the original report.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duplicate: Option<DuplicateReportReceipt>,
    #[serde(default)]
    pub warnings: Vec<SendWarning>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendBatchResult {
    pub messages: Vec<MessageReceipt>,
    pub recipients: u32,
}

impl SendResult {
    pub fn validate_shape(&self) -> Result<(), RpcError> {
        if self.message.is_some() && self.batch.is_some() {
            return Err(RpcError::new(
                "invalid_argument",
                "Send result carries either one message or a batch.",
            ));
        }
        if self.message.is_none() && self.batch.is_none() {
            return Err(RpcError::new(
                "invalid_argument",
                "Send result carries no message receipt.",
            ));
        }
        Ok(())
    }
}

/// Read/consume mode for a check. The source CLI's `--ack` becomes
/// `unread` + optional `acknowledge`: ACK a prior whole-batch delivery and
/// then consume/wait for the next batch in one call. `peek`/`all` are
/// non-consuming inspections; a reserved `acknowledge` field supplied on
/// them is rejected at decode, never silently ignored.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CheckMode {
    /// Consuming read: allocates/returns the recipient's next FIFO batch,
    /// optionally after acknowledging a prior delivery in the same call.
    Unread {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        acknowledge: Option<String>,
    },
    /// Non-consuming inspection of unread mail; never claims consumption.
    Peek,
    /// Non-consuming inspection of all retained mail.
    All,
}

impl<'de> Deserialize<'de> for CheckMode {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let map = serde_json::Map::deserialize(deserializer)?;
        match map.get("mode").and_then(Value::as_str) {
            Some("unread") => {
                let acknowledge = match map.get("acknowledge") {
                    Some(Value::String(delivery_id)) => Some(delivery_id.clone()),
                    Some(_) => {
                        return Err(serde::de::Error::custom(
                            "acknowledge must be a string delivery id",
                        ));
                    }
                    None => None,
                };
                Ok(CheckMode::Unread { acknowledge })
            }
            Some("peek") => {
                if map.contains_key("acknowledge") {
                    return Err(serde::de::Error::custom(
                        "peek does not acknowledge deliveries",
                    ));
                }
                Ok(CheckMode::Peek)
            }
            Some("all") => {
                if map.contains_key("acknowledge") {
                    return Err(serde::de::Error::custom(
                        "all does not acknowledge deliveries",
                    ));
                }
                Ok(CheckMode::All)
            }
            _ => Err(serde::de::Error::custom(
                "mode must be \"unread\", \"peek\" or \"all\"",
            )),
        }
    }
}

impl MessageKind {
    /// Human display name. Source `type` strings are the contract:
    /// `worker_done` (not the wire `finalReport`), everything else 1:1.
    pub fn display_name(self) -> &'static str {
        match self {
            MessageKind::Status => "status",
            MessageKind::Question => "question",
            MessageKind::Answer => "answer",
            MessageKind::Heartbeat => "heartbeat",
            MessageKind::FinalReport => "worker_done",
            MessageKind::Guidance => "guidance",
            MessageKind::Escalation => "escalation",
            MessageKind::Dispatch => "dispatch",
            MessageKind::MergeReady => "merge_ready",
            MessageKind::Handoff => "handoff",
            MessageKind::DecisionGate => "decision_gate",
        }
    }
}

impl CheckMode {
    pub fn validate_shape(&self) -> Result<(), RpcError> {
        if let CheckMode::Unread {
            acknowledge: Some(delivery_id),
        } = self
        {
            validate_opaque_token(delivery_id, 128, "Invalid delivery id.")?;
        }
        Ok(())
    }

    /// Why: wait is a consuming-read concept; inspecting peek/all never
    /// blocks, so a wait budget there is refused before admission.
    pub fn allows_wait(&self) -> bool {
        matches!(self, CheckMode::Unread { .. })
    }
}

/// Check request. The actor scope selects the mailbox: coordinator scope for
/// run-home mail, dispatch scope for the worker's own inbox.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckParams {
    pub scope: ActorScope,
    /// Why flattened: the wire stays flat like the source params —
    /// `{"mode":"unread","acknowledge":"…"}` or `{"mode":"peek"}`.
    #[serde(flatten)]
    pub mode: CheckMode,
    /// Optional bounded wait for the first matching message; never holds
    /// database or admission locks while waiting. Unread mode only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wait: Option<WaitPolicy>,
    /// Optional kind filter. A wake-type filter may wait for a match but can
    /// never exclude earlier messages from the returned FIFO batch. Unknown
    /// kinds fail decode as unsupported input.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub kinds: Vec<MessageKind>,
    /// Preamble/inject presentation flag (source: `inject`).
    #[serde(default)]
    pub inject: bool,
    /// Expanded local-text rendering flag (source: `--format`).
    #[serde(default)]
    pub format: bool,
    /// Inspection-only pagination; consuming checks cannot split a FIFO delivery.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<OpaqueCursor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

impl CheckParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(execution_host_id)?;
        self.mode.validate_shape()?;
        if self.mode.allows_wait() && (self.cursor.is_some() || self.limit.is_some()) {
            return Err(RpcError::new(
                "invalid_argument",
                "Only inspection checks accept pagination.",
            ));
        }
        crate::orchestration_common::validate_page_limit(self.limit)?;
        if let Some(cursor) = &self.cursor {
            cursor.validate()?;
        }
        if let Some(wait) = &self.wait {
            if !self.mode.allows_wait() {
                return Err(RpcError::new(
                    "invalid_argument",
                    "Only unread checks may wait for new mail.",
                ));
            }
            wait.validate()?;
        }
        Ok(())
    }
}

/// Immutable mail summary ordered by database sequence, not timestamp.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSummary {
    pub message_id: String,
    pub sequence: u64,
    pub kind: MessageKind,
    pub from_actor: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_actor: Option<String>,
    pub subject: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    /// Display priority; defaults to normal for pre-priority stores.
    #[serde(default)]
    pub priority: MessagePriority,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
}

/// One outstanding whole-batch delivery. A consuming check returns the exact
/// same ordered message ids until the batch is fully acknowledged.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutstandingDelivery {
    pub delivery_id: String,
    /// Ordered FIFO batch; at most `MAX_MAIL_BATCH` (50) unique ids.
    pub message_ids: Vec<String>,
}

impl OutstandingDelivery {
    pub fn validate_shape(&self) -> Result<(), RpcError> {
        validate_opaque_token(&self.delivery_id, 128, "Invalid delivery id.")?;
        if self.message_ids.is_empty()
            || self.message_ids.len() > crate::orchestration_common::MAX_MAIL_BATCH
        {
            return Err(RpcError::new(
                "invalid_argument",
                "Delivery batch size is outside the supported range.",
            ));
        }
        let mut seen = std::collections::BTreeSet::new();
        for id in &self.message_ids {
            validate_opaque_token(id, 128, "Invalid message id.")?;
            // Why: a whole-batch ACK is keyed by exact ordered ids, so a
            // duplicated id would make the batch identity ambiguous.
            if !seen.insert(id.as_str()) {
                return Err(RpcError::new(
                    "invalid_argument",
                    "Duplicate message id in delivery batch.",
                ));
            }
        }
        Ok(())
    }
}

/// Idempotent ACK result (contract: duplicate ACK is idempotent).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AckReceipt {
    pub delivery_id: String,
    /// True when this ACK joined an already-committed acknowledgment.
    pub already_acknowledged: bool,
    pub message_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    /// Set for a consuming read: the (new) outstanding batch to ACK.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery: Option<OutstandingDelivery>,
    /// Set when the call acknowledged a prior delivery; may coexist with a
    /// new `delivery` (ACK then consume in one call).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acknowledged: Option<AckReceipt>,
    #[serde(default)]
    pub messages: Vec<MessageSummary>,
    /// Server-side expanded rendering (source: `formatted`); the CLI prints
    /// it verbatim for human output when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formatted: Option<String>,
    /// Continuation token for bounded inspection output (peek/all); a
    /// consuming read always returns the whole FIFO batch instead.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<OpaqueCursor>,
    /// Wait observations. A timeout leaves state untouched and never fabricates
    /// a final outcome; shutdown interrupts with `cancelled` + `connectionLost`.
    #[serde(default)]
    pub timed_out: bool,
    #[serde(default)]
    pub cancelled: bool,
    #[serde(default)]
    pub connection_lost: bool,
}

impl CheckResult {
    pub fn validate_shape(&self) -> Result<(), RpcError> {
        if let Some(delivery) = &self.delivery {
            delivery.validate_shape()?;
            if !delivery.message_ids.iter().map(String::as_str).eq(self
                .messages
                .iter()
                .map(|message| message.message_id.as_str()))
                || self
                    .messages
                    .windows(2)
                    .any(|pair| pair[0].sequence >= pair[1].sequence)
            {
                return Err(RpcError::new(
                    "invalid_argument",
                    "Delivered messages must match the exact ordered FIFO batch.",
                ));
            }
        }
        if let Some(acknowledged) = &self.acknowledged {
            validate_opaque_token(&acknowledged.delivery_id, 128, "Invalid delivery id.")?;
            // Why: the acknowledged id names the *prior* delivery; claiming it
            // as the new batch id would conflate two consumption events.
            if let Some(delivery) = &self.delivery
                && acknowledged.delivery_id == delivery.delivery_id
            {
                return Err(RpcError::new(
                    "invalid_argument",
                    "Acknowledged delivery id cannot also be the new delivery.",
                ));
            }
        }
        if let Some(cursor) = &self.next_cursor {
            cursor.validate()?;
        }
        Ok(())
    }
}

/// Answers a specific question message, retaining its correlation id. Both
/// actors may reply: the worker to a coordinator question and vice versa;
/// authority comes from the credential, never from the addressed ids.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyParams {
    pub scope: ActorScope,
    /// The question being answered (source: `id`).
    pub question_message_id: String,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
}

impl ReplyParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(execution_host_id)?;
        validate_opaque_token(&self.question_message_id, 128, "Invalid message id.")?;
        validate_task_text(
            &self.body,
            crate::orchestration_common::MAX_TASK_TEXT_BYTES,
            "Invalid reply body.",
        )?;
        if let Some(thread) = &self.thread_id {
            validate_opaque_token(thread, 128, "Invalid thread id.")?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyResult {
    /// The durable answer message; the engine keeps the original correlation.
    pub message: MessageReceipt,
    /// Echo of the answered question for review tooling.
    pub question_message_id: String,
}

/// Global newest-first mail sweep across the host's runs (source:
/// `orchestration.inbox`). Read-only: no deliveries, no read pointers, no
/// receipts. With `terminal`, only mail addressed to that dispatch; a
/// stale/unknown handle reads as empty, never an error.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxParams {
    pub scope: HostScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    /// Dispatch the sweep is filtered to (source: `--terminal` handle).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal: Option<String>,
}

/// Source defaults: whole-host sweep reads 20, a terminal-filtered sweep
/// reads 100 (source `getInbox`/`getAllMessagesForHandle`).
pub const INBOX_DEFAULT_LIMIT: u32 = 20;
pub const INBOX_TERMINAL_DEFAULT_LIMIT: u32 = 100;

impl InboxParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.scope.validate_target(execution_host_id)?;
        crate::orchestration_common::validate_page_limit(self.limit)?;
        if let Some(terminal) = &self.terminal {
            validate_opaque_token(terminal, 128, "Invalid terminal handle.")?;
        }
        Ok(())
    }

    pub fn effective_limit(&self) -> u32 {
        self.limit.unwrap_or(if self.terminal.is_some() {
            INBOX_TERMINAL_DEFAULT_LIMIT
        } else {
            INBOX_DEFAULT_LIMIT
        })
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxResult {
    pub messages: Vec<MessageSummary>,
    pub count: usize,
}

impl InboxResult {
    pub fn validate_shape(&self) -> Result<(), RpcError> {
        if self.count != self.messages.len() {
            return Err(RpcError::new(
                "invalid_argument",
                "Inbox count does not match the returned messages.",
            ));
        }
        Ok(())
    }
}
