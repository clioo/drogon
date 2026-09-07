//! Shared wire vocabulary for the frozen native coordination method group.
//! Shape validation only: it never authenticates an actor or verifies a
//! database fence, and passing it grants no authority — the runtime compares
//! the credential's stored binding against the supplied scope. No struct here
//! carries a credential; the actor rides the envelope's redacted `auth` field.

use crate::RpcError;
use crate::orchestration_scope::{CoordinatorScope, DispatchScope, MAX_CONSUMER_GENERATION};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Source caps a consuming check batch at 50 messages (one outstanding Delivery).
pub const MAX_MAIL_BATCH: usize = 50;
/// Source `orchestration run-list` defaults to 100 rows per bounded page.
pub const DEFAULT_RUN_PAGE_LIMIT: u32 = 100;
/// Wire ceiling for any page request; the server may return fewer rows.
pub const MAX_PAGE_LIMIT: u32 = 500;
/// Opaque cursors are server-minted tokens; 4096 bytes leaves room for
/// host-qualified context. The earlier 256-byte guess was not source-pinned.
pub const MAX_CURSOR_BYTES: usize = 4096;
/// Task/prompt-shaped free text bound, matching the harness prompt limit.
pub const MAX_TASK_TEXT_BYTES: usize = 32_768;
/// Subject/question-shaped free text bound; generous but log-safe.
pub const MAX_SUBJECT_TEXT_BYTES: usize = 2_048;
/// Upper bound for any blocking wait budget (15 minutes). Waits release
/// database and admission locks between observations regardless of budget.
pub const MAX_WAIT_BUDGET_MS: u32 = 900_000;

/// Why: the same coordination methods serve the admin/coordinator actor and
/// the dispatch-scoped worker actor. The tag `actorKind` is explicit (not
/// untagged) so wire readers see the intended authority shape, and
/// deserialization rejects contradictory reserved fields instead of silently
/// dropping them (serde otherwise ignores unknown fields).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "actorKind", rename_all = "camelCase")]
pub enum ActorScope {
    Coordinator(CoordinatorScope),
    Dispatch(DispatchScope),
}

/// Fields reserved to the dispatch scope; their presence on a
/// coordinator-tagged scope is a contradiction, not an additive field.
const DISPATCH_RESERVED_FIELDS: [&str; 2] = ["taskId", "dispatchId"];
/// Fields reserved to the coordinator scope; symmetric rule.
const COORDINATOR_RESERVED_FIELDS: [&str; 2] = ["coordinatorId", "consumerGeneration"];

impl<'de> Deserialize<'de> for ActorScope {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let map = serde_json::Map::deserialize(deserializer)?;
        let kind = map
            .get("actorKind")
            .ok_or_else(|| serde::de::Error::missing_field("actorKind"))?;
        match kind.as_str() {
            Some("coordinator") => {
                reject_reserved_fields::<D::Error>(
                    &map,
                    &DISPATCH_RESERVED_FIELDS,
                    "coordinator scope must not carry dispatch fields",
                )?;
                Ok(ActorScope::Coordinator(
                    CoordinatorScope::deserialize(Value::Object(map))
                        .map_err(serde::de::Error::custom)?,
                ))
            }
            Some("dispatch") => {
                reject_reserved_fields::<D::Error>(
                    &map,
                    &COORDINATOR_RESERVED_FIELDS,
                    "dispatch scope must not carry coordinator fields",
                )?;
                Ok(ActorScope::Dispatch(
                    DispatchScope::deserialize(Value::Object(map))
                        .map_err(serde::de::Error::custom)?,
                ))
            }
            _ => Err(serde::de::Error::custom(
                "actorKind must be \"coordinator\" or \"dispatch\"",
            )),
        }
    }
}

/// Rejects reserved keys whose presence contradicts the selected variant.
/// Unrelated additive fields stay allowed.
fn reject_reserved_fields<E: serde::de::Error>(
    map: &serde_json::Map<String, Value>,
    reserved: &[&str],
    message: &str,
) -> Result<(), E> {
    for field in reserved {
        if map.contains_key(*field) {
            return Err(E::custom(format!("{message}: unexpected field {field}")));
        }
    }
    Ok(())
}

impl ActorScope {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        match self {
            ActorScope::Coordinator(scope) => scope.validate_shape(execution_host_id),
            ActorScope::Dispatch(scope) => scope.validate_shape(execution_host_id),
        }
    }

    /// The run binding is common to both actors; every coordination effect is
    /// fenced against it inside the engine's transaction.
    pub fn run_id(&self) -> &str {
        match self {
            ActorScope::Coordinator(scope) => &scope.run_id,
            ActorScope::Dispatch(scope) => &scope.run_id,
        }
    }
}

/// Process liveness has exactly three verdicts. Loss of contact is
/// `unverifiable`, never proof of exit; a persisted PID is never probe evidence.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProcessVerdict {
    Live,
    Unverifiable,
    Exited,
}

/// Why: readiness is tracked separately from spawn acceptance and process
/// liveness ("spawn acceptance is not TUI readiness; TUI readiness is not a
/// worker handshake"). `promptObserved` means the preamble reached the worker;
/// `workerObserved` means the worker itself acted. A prompt observation
/// timeout leaves `notObserved` without revoking the capability. Replacement
/// still requires an explicit retry of the failed attempt (a1d2073).
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReadinessObservation {
    NotObserved,
    PromptObserved,
    WorkerObserved,
}

/// Attempt lifecycle state, independent of report outcome, readiness and
/// process verdict (contract: do not overload one status field). Maps the
/// accepted source workerStart result states (`ready`/`failed`/`stopped`)
/// plus the contract's explicit abandon outcome.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AssignmentState {
    /// Durable admission committed; process launch not yet confirmed.
    Admitting,
    /// Spawn accepted. Not a claim about readiness or model response.
    Ready,
    /// Settled by an authenticated final report (outcome carried separately).
    Completed,
    /// Settled as failed (launch failure or failed final report).
    Failed,
    /// Coordinator stop committed before any signal attempt.
    Stopped,
    /// Coordinator abandoned the attempt; by contract it never signals.
    Abandoned,
}

/// Final report outcome. Exactly one terminal outcome can win per attempt.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReportOutcome {
    Succeeded,
    Failed,
}

/// What the engine actually did (or honestly did not do) to a resource.
/// `unverifiable` records uncertainty instead of inventing exit evidence.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ResourceDisposition {
    Released,
    Retained,
    NoOwnedResource,
    Unverifiable,
}

/// Exact resource identity: kind plus the server-assigned id and, for
/// sessions, the incarnation string from the current native vocabulary.
/// Deliberately no PIDs and no secrets.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ResourceKind {
    Workspace,
    Session,
}

/// What happened to the exact resource (created vs reused vs retained vs released).
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ResourceAction {
    Created,
    Reused,
    Retained,
    Released,
}

/// A side effect the engine reports, identifying the exact resource.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceEffect {
    pub kind: ResourceKind,
    pub resource_id: String,
    /// Session incarnation (UUID string vocabulary), when session-scoped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub incarnation: Option<String>,
    pub action: ResourceAction,
}

/// A resource the engine still knows about after an operation, with an honest
/// disposition (retained / no-owned-resource / unverifiable), never a guessed
/// exit claim, and the exact identity needed for recovery.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidualResource {
    pub kind: ResourceKind,
    pub resource_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub incarnation: Option<String>,
    pub action: ResourceAction,
    pub disposition: ResourceDisposition,
}

/// Recorded failure with a stable machine-readable `code` (root decision
/// a1d2073: e.g. `agent_prompt_stalled` marks the prompt-observation-timeout
/// case, which retains the credential, keeps the attempt active and leaves
/// readiness unverified — it is not a cancellation fence).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptFailure {
    pub code: String,
    pub stage: String,
    pub message: String,
}

/// Per-attempt summary for task/worker history views. Every attempt's history
/// is preserved; replacement always names the prior attempt.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptSummary {
    pub dispatch_id: String,
    pub attempt: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_of: Option<String>,
    pub assignment_state: AssignmentState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<ReportOutcome>,
    pub process_verdict: ProcessVerdict,
}

/// Exact owned session identity returned by reads and required for explicit
/// reuse. `incarnation` is a String (the current native SessionSummary's UUID
/// string vocabulary), not a counter.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIdentity {
    pub session_id: String,
    pub incarnation: String,
}

impl SessionIdentity {
    pub fn validate_shape(&self) -> Result<(), RpcError> {
        validate_opaque_token(&self.session_id, 128, "Invalid session id.")?;
        validate_opaque_token(&self.incarnation, 128, "Invalid session incarnation.")
    }
}

/// Why: mirrored from `drogon-harness::launch::PermissionMode` (that crate is
/// not a protocol dependency). Permissions are explicit per launch, never a
/// global setting, and never inferred.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LaunchPermissionMode {
    #[default]
    Inherit,
    Unattended,
}

/// Per-invocation launch preferences, field-aligned with
/// `drogon-harness::HarnessLaunchRequest` so the engine can adapt without
/// semantic drift. Values are data, never shell; the executable itself is
/// always the host's discovered harness, never a client-supplied command.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchPreferences {
    /// Must match a harness the host has discovered; adapted to the harness
    /// crate's own id type at the engine boundary.
    pub harness_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default)]
    pub permission_mode: LaunchPermissionMode,
}

/// Bounded wait budget for blocking observations. Waiting releases database
/// and admission locks between observations; the budget never extends
/// authority. Positive and at most `MAX_WAIT_BUDGET_MS`.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitPolicy {
    pub timeout_ms: u32,
}

impl WaitPolicy {
    pub fn validate(&self) -> Result<(), RpcError> {
        if self.timeout_ms == 0 || self.timeout_ms > MAX_WAIT_BUDGET_MS {
            return Err(RpcError::new(
                "invalid_argument",
                "Invalid orchestration wait budget.",
            ));
        }
        Ok(())
    }
}

/// Server-minted opaque continuation token. Not interpreted by clients.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(transparent)]
pub struct OpaqueCursor(pub String);

impl OpaqueCursor {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_opaque_token(&self.0, MAX_CURSOR_BYTES, "Invalid orchestration cursor.")
    }
}

/// Validates bounded opaque identifier-shaped tokens (cursors, delivery ids).
pub fn validate_opaque_token(value: &str, max_bytes: usize, message: &str) -> Result<(), RpcError> {
    if value.is_empty()
        || value.len() > max_bytes
        || value
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err(RpcError::new("invalid_argument", message));
    }
    Ok(())
}

/// Validates bounded free text that may contain newlines (task text, prompts)
/// but never NUL. Text is data, never shell code.
pub fn validate_task_text(value: &str, max_bytes: usize, message: &str) -> Result<(), RpcError> {
    if value.is_empty() || value.len() > max_bytes || value.contains('\0') {
        return Err(RpcError::new("invalid_argument", message));
    }
    Ok(())
}

/// Validates an optional page limit against the wire bounds.
pub fn validate_page_limit(limit: Option<u32>) -> Result<(), RpcError> {
    if let Some(limit) = limit
        && (limit == 0 || limit > MAX_PAGE_LIMIT)
    {
        return Err(RpcError::new(
            "invalid_argument",
            "Page limit is outside the supported range.",
        ));
    }
    Ok(())
}

/// Validates a consumer generation fence value: positive and exactly
/// representable in JavaScript, matching `orchestration_scope`.
pub fn validate_consumer_generation(generation: u64) -> Result<(), RpcError> {
    if !(1..=MAX_CONSUMER_GENERATION).contains(&generation) {
        return Err(RpcError::new(
            "invalid_argument",
            "Invalid orchestration context.",
        ));
    }
    Ok(())
}

/// Validates a bounded identifier field (effect kinds, stages, coordinator ids).
pub fn validate_short_label(value: &str) -> Result<(), RpcError> {
    validate_opaque_token(value, 128, "Invalid orchestration label.")
}

/// Request-id validation mirroring `Request::validate` exactly (non-empty,
/// at most 128 bytes, no control characters — whitespace allowed), so
/// request-show accepts precisely the ids the envelope can carry.
pub fn validate_request_id(value: &str) -> Result<(), RpcError> {
    if value.is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        return Err(RpcError::new("invalid_argument", "Invalid request id."));
    }
    Ok(())
}

/// True when a serialized params/results object leaks a credential-shaped key.
/// Why: a freeze-level guard, not engine security — no orchestration struct
/// may grow an auth/capability/secret field; the credential rides only the
/// envelope's redacted `auth` field.
pub fn leaks_credential_shaped_key(value: &Value) -> bool {
    fn scan(key: &str) -> bool {
        let lowered = key.to_ascii_lowercase();
        ["auth", "capability", "credential", "token", "secret"]
            .iter()
            .any(|banned| lowered.contains(banned))
    }
    match value {
        Value::Object(map) => map
            .iter()
            .any(|(key, inner)| scan(key) || leaks_credential_shaped_key(inner)),
        Value::Array(items) => items.iter().any(leaks_credential_shaped_key),
        _ => false,
    }
}
