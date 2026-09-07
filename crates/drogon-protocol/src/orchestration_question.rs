//! Question and receipt-recovery wire types: `orchestration.ask` and
//! `orchestration.requestShow`. An ask commits once, then waits/resumes by
//! message id; timeout never recreates the question or fabricates an answer.
//! requestShow is actor-scoped read-only receipt recovery.

use crate::RpcError;
use crate::orchestration_common::{
    ActorScope, MAX_TASK_TEXT_BYTES, WaitPolicy, validate_opaque_token, validate_request_id,
    validate_task_text,
};
use crate::orchestration_mail::SendTarget;
use crate::orchestration_scope::{CoordinatorScope, DispatchScope, HostScope};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Why: "new question" and "resume" are exactly one intent (source CLI refuses
/// passing both `--question` and `--resume`). Deserialization rejects the
/// contradictory fields outright — resume carrying `question`/`options`, or a
/// new question carrying `questionMessageId` — because serde would otherwise
/// silently ignore them. Unrelated additive fields stay allowed.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(
    tag = "intent",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AskIntent {
    New {
        question: String,
        /// Optional answer choices (source: `--options`); data, never shell.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        options: Vec<String>,
    },
    /// Re-read an existing pending question. Timeout of the original wait
    /// leaves this exact question pending and resumable.
    Resume { question_message_id: String },
}

impl AskIntent {
    fn from_value(value: Value) -> Result<Self, String> {
        let map = match value {
            Value::Object(map) => map,
            _ => return Err("ask intent must be an object".into()),
        };
        match map.get("intent").and_then(Value::as_str) {
            Some("new") => {
                if map.contains_key("questionMessageId") {
                    return Err("a new question cannot carry questionMessageId".into());
                }
                let question = match map.get("question").and_then(Value::as_str) {
                    Some(question) => question.to_string(),
                    None => return Err("missing field question".into()),
                };
                let options = match map.get("options") {
                    Some(Value::Array(items)) => items
                        .iter()
                        .map(|item| {
                            item.as_str()
                                .map(str::to_string)
                                .ok_or_else(|| "ask options must be strings".to_string())
                        })
                        .collect::<Result<Vec<String>, String>>()?,
                    Some(_) => return Err("ask options must be an array of strings".into()),
                    None => Vec::new(),
                };
                Ok(AskIntent::New { question, options })
            }
            Some("resume") => {
                for reserved in ["question", "options"] {
                    if map.contains_key(reserved) {
                        return Err(format!("a resume cannot carry {reserved}"));
                    }
                }
                let question_message_id = match map.get("questionMessageId").and_then(Value::as_str)
                {
                    Some(id) => id.to_string(),
                    None => return Err("missing field questionMessageId".into()),
                };
                Ok(AskIntent::Resume {
                    question_message_id,
                })
            }
            _ => Err("intent must be \"new\" or \"resume\"".into()),
        }
    }

    pub fn validate_shape(&self) -> Result<(), RpcError> {
        match self {
            AskIntent::New { question, options } => {
                validate_task_text(
                    question,
                    MAX_TASK_TEXT_BYTES,
                    "Invalid orchestration question.",
                )?;
                let mut seen = std::collections::BTreeSet::new();
                for option in options {
                    validate_task_text(option, 1024, "Invalid question option.")?;
                    // Why: duplicate options would make an answer ambiguous.
                    if !seen.insert(option.as_str()) {
                        return Err(RpcError::new(
                            "invalid_argument",
                            "Duplicate question option.",
                        ));
                    }
                }
                Ok(())
            }
            AskIntent::Resume {
                question_message_id,
            } => validate_opaque_token(question_message_id, 128, "Invalid message id."),
        }
    }
}

impl<'de> Deserialize<'de> for AskIntent {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        Self::from_value(value).map_err(serde::de::Error::custom)
    }
}

/// Ask a question and optionally wait for the answer. The commit and the wait
/// are separate: the question message id is durable as soon as the method
/// admits, and a waiter rechecks authority on every observation so takeover or
/// cancellation wakes a stale consumer instead of leaving it attached.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskParams {
    pub scope: ActorScope,
    #[serde(flatten)]
    pub intent: AskIntent,
    /// Addressing for a new question (who is being asked). Meaningless on
    /// resume and refused at decode.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<SendTarget>,
    pub wait: WaitPolicy,
}

impl<'de> Deserialize<'de> for AskParams {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let mut map = serde_json::Map::deserialize(deserializer)?;
        let scope = ActorScope::deserialize(
            map.remove("scope")
                .ok_or_else(|| serde::de::Error::missing_field("scope"))?,
        )
        .map_err(serde::de::Error::custom)?;
        let wait = WaitPolicy::deserialize(
            map.remove("wait")
                .ok_or_else(|| serde::de::Error::missing_field("wait"))?,
        )
        .map_err(serde::de::Error::custom)?;
        if matches!(map.get("intent").and_then(Value::as_str), Some("resume"))
            && map.contains_key("to")
        {
            return Err(serde::de::Error::custom(
                "a resume cannot change the question addressing",
            ));
        }
        let to = match map.remove("to") {
            Some(value) => Some(SendTarget::deserialize(value).map_err(serde::de::Error::custom)?),
            None => None,
        };
        let intent =
            AskIntent::deserialize(Value::Object(map)).map_err(serde::de::Error::custom)?;
        Ok(AskParams {
            scope,
            intent,
            to,
            wait,
        })
    }
}

impl AskParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(execution_host_id)?;
        self.intent.validate_shape()?;
        if let Some(target) = &self.to {
            target.validate_shape()?;
        }
        self.wait.validate()
    }
}

/// The answer content. `answerMessageId` lets callers ACK/audit the answer
/// message; it is optional because legacy receipts may not expose it.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerPayload {
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_message_id: Option<String>,
}

/// Wait outcome, independent of the answer payload.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AskWaitOutcome {
    /// An answer arrived within the effective budget.
    Answered,
    /// Budget elapsed; the question stays pending and resumable.
    Pending,
    /// Shutdown/cancellation interrupted the wait; nothing is finalized.
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskResult {
    /// Durable question identity; present as soon as the ask committed.
    pub question_message_id: String,
    pub thread_id: String,
    pub wait: AskWaitOutcome,
    /// Present exactly when `wait` is `answered` (validated).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer: Option<AnswerPayload>,
    /// The server's effective (possibly clamped) budget actually applied.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effective_timeout_ms: Option<u32>,
    /// True when the interruption was a lost/observed-closed connection.
    #[serde(default)]
    pub connection_lost: bool,
}

impl AskResult {
    pub fn validate_shape(&self) -> Result<(), RpcError> {
        validate_opaque_token(&self.question_message_id, 128, "Invalid message id.")?;
        validate_opaque_token(&self.thread_id, 128, "Invalid thread id.")?;
        match (self.wait, &self.answer) {
            (AskWaitOutcome::Answered, Some(_)) => Ok(()),
            (AskWaitOutcome::Answered, None) => Err(RpcError::new(
                "invalid_argument",
                "An answered ask result carries no answer.",
            )),
            (_, Some(_)) => Err(RpcError::new(
                "invalid_argument",
                "Only an answered ask result may carry an answer.",
            )),
            _ => Ok(()),
        }
    }
}

/// Common host context for the bootstrap receipt scope: the admin/bootstrap
/// actor has a coordinator identity but no run binding yet.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapScope {
    #[serde(flatten)]
    pub host: HostScope,
    pub coordinator_id: String,
}

/// Explicit receipt identity scope for requestShow. Why: the admin
/// credential is shared infrastructure, so the caller states which actor's
/// receipt space to search and the engine fences the lookup by the
/// authenticated actor before touching the ledger — this routing grants no
/// authority by itself.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "actorKind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ReceiptScope {
    Bootstrap(BootstrapScope),
    Coordinator(CoordinatorScope),
    Dispatch(DispatchScope),
}

impl ReceiptScope {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        match self {
            ReceiptScope::Bootstrap(scope) => {
                scope.host.validate_target(execution_host_id)?;
                crate::orchestration_common::validate_short_label(&scope.coordinator_id)
            }
            ReceiptScope::Coordinator(scope) => scope.validate_shape(execution_host_id),
            ReceiptScope::Dispatch(scope) => scope.validate_shape(execution_host_id),
        }
    }
}

/// Actor-scoped read-only receipt recovery. There is no free-form actor field:
/// the scope names the receipt space, and the engine authorizes it from the
/// redacted `auth` envelope, so a worker can never retrieve an admin receipt
/// by guessing its request id.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestShowParams {
    pub scope: ReceiptScope,
    pub request_id: String,
}

impl RequestShowParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(execution_host_id)?;
        validate_request_id(&self.request_id)
    }
}

/// Ledger state of a recovered request. `absent` is the honest no-record
/// answer (never proof that no effects happened — the interpretation must say
/// so); it replaces the earlier `unknown` placeholder.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestLedgerState {
    Pending,
    Committed,
    Failed,
    Absent,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestShowResult {
    pub request_id: String,
    pub state: RequestLedgerState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    /// The honest human-readable reading (source: `interpretation`).
    pub interpretation: String,
    /// Original receipt metadata. This is the explicitly allowed
    /// result-metadata JSON exception; it never contains credentials.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receipt: Option<Value>,
}
