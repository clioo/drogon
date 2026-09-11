//! The `bot.run` bridge: strict desktop-request admission over the
//! ROOT-approved contract, composed on top of `bots::policy` +
//! `automations::runner`'s 3-phase flow (never duplicating either).
//!
//! ## Chat turns (`prompt`, R2-S) and the open-session dispatch
//!
//! `bot.run` also accepts a `prompt` in place of `responsibilityId`/
//! `reason`/`eventIdentity` -- a raw chat turn with no `Responsibility`/
//! `Automation` behind it. [`RunTurn::Chat`] carries this; it bypasses
//! `bots::policy`/`automations::runner::prepare_run_plan_in_tx` entirely
//! (both require an owned `Automation`, which a chat turn never has) and
//! instead composes the harness prompt via `bots::prompt::build_operating_prompt`
//! and dispatches directly through the same [`DispatchSeam`] (never through
//! [`RunPlan`], which is shaped around a real `Automation`/`Responsibility`
//! pair). The turn is persisted as a [`BotMessage`] row (`bot_messages`
//! table, `bots::storage::record_bot_message_in_tx`) instead of a
//! `ResponsibilityRun` -- a distinct effect, not a parallel copy of the
//! existing one. `bot.history` (below) reads these rows back.
//!
//! [`RunTurn::OpenSession`] (Carlos directive, task_e7c183ebc637) is the
//! Open Session button's dispatch and deliberately dispatches NO model
//! turn: a session must open LIVE and IDLE, ready for the user's first
//! real message. The session's liveness and environment are daemon facts
//! surfaced by the status pill and the Bot session inspector -- never a
//! recital the model is asked to invent (the old "confirm this session is
//! live" greeting made the model fabricate working directories and model
//! names that the owner then read as product output). An open-session
//! dispatch therefore starts the harness's interactive entrypoint with NO
//! prompt parameter at all, records no [`BotMessage`] row (no turn
//! happened), and only rotates the Bot's `current_session`.
//!
//! ## Request contract (strict; unknown fields denied)
//!
//! `{workspaceId*, hostId*, botId*, responsibilityId*, reason*:
//! scheduledDue|manual|reactiveEvent, eventIdentity*, harness?, locale?}`,
//! OR `{workspaceId*, hostId*, botId*, prompt*, harness?, locale?}` for a
//! chat turn -- `responsibilityId`/`reason`/`eventIdentity` and `prompt` are
//! mutually exclusive.
//! `requestId` is NOT an admitted param: the native envelope carries it, and
//! ROOT's wiring takes it explicitly, never from `params`. `hostId` is a
//! client ASSERTION tripwire only -- the server always derives the current
//! host internally (the caller-supplied `derived_host_id`, which ROOT's
//! wiring takes from `Engine`'s own host identity) and never trusts the
//! caller for authority. `reason` is an explicit enum mirroring
//! `automations::execution::InvocationReason`; `eventIdentity` never infers
//! it. `harness` carries admitted-schema overrides only; when it is absent
//! the run is `unsupported` unless an existing harness mapping resolves it
//! -- and no such mapping exists in this build, so no default is invented
//! and no authorization is synthesized.
//!
//! ## Staged API, delegated idempotency (V4-A6d)
//!
//! ROOT directive (A6d): no DDL and no parallel ledger are approved for this
//! module. This module owns no receipt-ledger seam and no monolithic
//! handler; instead it exposes independently testable stages that ROOT's
//! wiring adapts directly onto the admitted
//! `crate::requests::RequestLedger::run_staged` (zero ledger/fingerprint
//! API additions -- `run_staged` fingerprints `(method, params)` internally,
//! so this module never computes or stores a fingerprint of its own):
//!
//! 1. [`parse_bot_run_request`] -- strict parse, unchanged from A6c.
//! 2. [`authorize_caller`] -- the worker-denied auth path, unchanged from
//!    A6c: a denied caller is rejected before parsing or the ledger, and
//!    consumes no admission.
//! 3. [`revalidate_run_scope`] -- the workspace-ownership + host-assertion
//!    checks ONLY (never harness/readiness); meant to be ROOT's
//!    `run_staged` `authorize` callback, so it reruns on EVERY admission
//!    attempt, replay included -- a replay whose workspace moved or was
//!    deleted is denied even though the stored receipt would otherwise be
//!    returned verbatim.
//! 4. [`authorized_prepare`] -- FRESH-ONLY (`run_staged` calls `prepare`
//!    only when no stored row exists for this key): repeats the scope
//!    checks (so a fresh refusal still renders a structured, persisted
//!    receipt, matching this module's previous admit-path behavior), then
//!    adds the harness-mapping/bot-readiness checks -- which a replay must
//!    NEVER re-evaluate. Returns an OWNED [`BotRunPrepare`]: every borrowed
//!    value is converted to owned data before returning, so a `Ready`
//!    plan outlives the `&Connection` this call borrowed.
//! 5. [`execute`] -- takes no `Connection`, only the owned `RunPlan` and the
//!    seam: nothing in this module ever holds a database guard across
//!    dispatch, so the production `Engine` wrapper MUST drop its own
//!    `MutexGuard` before calling this and re-lock only for [`record`].
//! 6. [`record`] -- durable write, connection-bound (opens no transaction of
//!    its own): meant to run inside `run_staged`'s own `finalize`
//!    transaction, so the run rows and the receipt row commit atomically.
//! 7. [`build_receipt`] -- the pure, unchanged receipt constructor.
//!    `observed_at` must be sampled AFTER [`execute`] returns (the actual
//!    `session.read` wall time), never at admission time; admission time is
//!    instead the `attempt_at` passed into [`authorized_prepare`] (used for
//!    `recordedAt` and, for a `Ready` plan, `RunPlan::attempt_at`).
//!
//! Refused receipts carry `refusal: {type, kind, ...detail}` --
//! `responsibility{disabled|reactiveRequiresSuppliedEvent|unownedAutomation}`,
//! `automation{foreignHost|disabled|missingReactiveEvent}`, and the
//! workspace-level kinds `missingWorkspaceId|unknownWorkspace|
//! foreignWorkspaceHost`; unsupported receipts carry
//! `reason: {kind: newPerRunWorkspaceMode|reactiveDispatchParamsNotWired}`
//! (plus `harnessMappingAbsent` for this module's own no-mapping case,
//! flagged for ROOT approval). A human-readable `error` string is kept
//! alongside, never instead.
//!
//! ## Registration status and the ROOT adapter (applied)
//!
//! This module is registered in `lib.rs` (`pub mod bot_run_rpc;`) and
//! `dispatch_inner` routes `"bot.run"` to [`crate::Engine::bot_run`] below,
//! immediately after the `bot.create` arm. `dispatch_worker` is untouched:
//! `bot.run` is desktop-only, so a worker credential is denied by
//! `coordination_access::authorize_worker`'s allowlist before a worker
//! request ever reaches a dispatcher match arm at all (see
//! [`authorize_caller`]'s doc for the defensive-only in-crate check that
//! backs this up).
//!
//! `Engine::bot_run` composes the stages above onto `RequestLedger::run_staged`:
//! `authorize` re-checks quiescence (fail-closed on `runtime_busy`) then
//! [`revalidate_run_scope`] on every admission attempt, replay included;
//! `prepare` samples one fresh `attempt_at` and calls [`authorized_prepare`]
//! (fresh-only); `effect` calls [`execute`] for a `Ready` plan (or renders a
//! `Refused`/`Unsupported` receipt directly, with no dispatch at all); and
//! `finalize` calls [`record`] inside `run_staged`'s own finalize
//! transaction, so the run rows and the receipt row commit atomically.
//!
//! ### Lifecycle admission: no outer `lifecycle_gate` guard on `bot.run`
//!
//! Unlike `bot_create`/`Engine::mutating`, `Engine::bot_run` takes **no**
//! `self.lifecycle_gate.read()` guard of its own. Its `effect` phase
//! re-enters `Engine::dispatch` via [`runner::EngineDispatchSeam`]
//! (`harness.start` -> `Engine::mutating`, which itself takes the gate's
//! *read* side; `session.read` takes no gate at all). `RwLock::read` is not
//! reentrant in the general case: a thread that already holds the read side
//! and tries to take it again can deadlock against a writer that arrived in
//! between (many `RwLock` implementations, including the one backing this
//! crate's, do not guarantee recursive-read correctness once a writer is
//! queued). Holding an outer read guard across that nested `dispatch` call
//! would be exactly that hazard, so this module never does.
//!
//! Fencing instead happens the same way `run_staged`'s other admission
//! sites do it: `authorize` checks `self.quiescent` (fail-closed,
//! `runtime_busy`) and then [`revalidate_run_scope`], matching the
//! authorize-before-lookup ordering `run_staged` already enforces before any
//! stored-row inspection. The nested `harness.start`/`session.read` calls
//! carry their own independent `mutating()`/read-path gating, so admission
//! is still fenced end-to-end -- just never via a single guard held across
//! the re-entrant call.
//!
//! A freeze racing the effect phase resolves fail-closed: if
//! `runtime.shutdown` durably freezes between this call's own admission
//! commit and its `effect` running, the nested `harness.start` dispatch hits
//! `Engine::mutating`'s own quiescence check and is refused `runtime_busy`
//! -- so [`execute`] observes a real [`RunnerOutcome::DispatchFailed`], never
//! a live session invented from nothing. `finalize` still runs and commits
//! `requests` from `pending` to `done` atomically with the recorded
//! `DispatchFailed` run rows, for the exact in-flight key, exactly once.

use std::cell::Cell;
use std::sync::atomic::Ordering;

use rusqlite::Connection;
use serde::Serialize;
use serde_json::{Value, json};

use crate::automations::execution::{DispatchRefusal, InvocationReason};
use crate::automations::runner::{
    self, DispatchSeam, EngineDispatchSeam, HarnessLaunchParams, PrepareOutcome, RunPlan,
    RunRefusal, RunUnsupported, RunnerOutcome,
};
use crate::bots::policy::ResponsibilityRefusal;
use crate::bots::records::{BotMessage, HostObservation};
use crate::bots::storage as bots_storage;
use drogon_protocol::RpcError;
use drogon_protocol::bot::{BotHistoryResult, BotHostObservation, BotMessageWire};

/// Who is calling. ROOT's wiring maps the private auth layer's
/// `WorkerBinding` onto [`BotRunCaller::Worker`]; `bot.run` is desktop-only
/// in v1, so a worker caller is denied on this auth path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BotRunCaller {
    Desktop,
    Worker {
        host_id: String,
        run_id: String,
        dispatch_id: String,
    },
}

/// Explicit invocation reason, mirroring
/// `automations::execution::InvocationReason`; `eventIdentity` never infers
/// it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum Reason {
    ScheduledDue,
    Manual,
    ReactiveEvent,
}

impl Reason {
    fn parse(value: &Value) -> Result<Self, RpcError> {
        match value.as_str() {
            Some("scheduledDue") => Ok(Self::ScheduledDue),
            Some("manual") => Ok(Self::Manual),
            Some("reactiveEvent") => Ok(Self::ReactiveEvent),
            _ => Err(invalid_argument(
                "reason must be one of scheduledDue|manual|reactiveEvent",
            )),
        }
    }

    fn to_invocation_reason(&self, event_identity: &str) -> InvocationReason {
        match self {
            Self::ScheduledDue => InvocationReason::ScheduledDue,
            Self::Manual => InvocationReason::Manual,
            // The event identity is the event payload, never the reason.
            Self::ReactiveEvent => {
                InvocationReason::ReactiveEvent(Some(event_identity.to_string()))
            }
        }
    }
}

/// Admitted-schema harness overrides: every field is a caller-supplied
/// override, never a default. Unknown fields are denied at parse time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HarnessOverrides {
    harness_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    permission_mode: Option<String>,
}

/// A `bot.run` call is one of a scheduled/reactive/manual responsibility
/// invocation, a raw chat turn carrying its own `prompt` (headless one-shot
/// daemon run), or an open-session dispatch (`interactive: true`, no
/// `prompt`): a live, IDLE session with no model turn behind it. Mutually
/// exclusive on the wire (see [`parse_bot_run_request`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum RunTurn {
    Responsibility {
        responsibility_id: String,
        reason: Reason,
        event_identity: String,
    },
    Chat {
        prompt: String,
    },
    /// Open-session request (bug-bot-a836b4ebf8be65505, refined by the
    /// Carlos directive on task_e7c183ebc637): a live, user-facing tab
    /// with NO model turn -- `claude`/`pi`/etc.'s own interactive TUI
    /// entrypoint starts and waits for the user's first real message,
    /// matching the primitive `startHarness` already uses for every other
    /// user-facing tab. A `prompt` alongside `interactive` is a parse
    /// ERROR, so the wire contract itself makes "ask the model to confirm
    /// the session is live" impossible. [`Engine::bot_run`]'s ROOT adapter
    /// -- never [`authorized_prepare`] alone -- is what strips `headless`
    /// and retargets the session at the Bot's own sandbox workspace.
    ///
    /// `resume` (Defect 2): reopen the harness's OWN most recent
    /// conversation in the Bot's home instead of starting a blank one. Set
    /// by the caller only when the Bot's recorded session is known to have
    /// exited; a live session is focused instead, never redispatched.
    OpenSession {
        resume: bool,
    },
}

/// The strict, normalized request. The envelope `request_id` is deliberately
/// not a field: it keys the delegated ledger and never enters the
/// fingerprint. Serialization of this struct is the fingerprint input.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BotRunRequest {
    workspace_id: String,
    /// Client assertion only; verified against the derived host, never
    /// trusted for authority.
    asserted_host_id: String,
    bot_id: String,
    turn: RunTurn,
    #[serde(skip_serializing_if = "Option::is_none")]
    harness: Option<HarnessOverrides>,
    #[serde(skip_serializing_if = "Option::is_none")]
    locale: Option<String>,
}

/// A chat turn's own owned plan -- the [`RunPlan`] equivalent for
/// [`RunTurn::Chat`]. Holds no `Connection`/seam reference, same as
/// `RunPlan`, but carries no `automation_id`/`responsibility_id` since
/// neither exists for a chat turn.
#[derive(Debug, Clone, PartialEq)]
pub struct ChatPlan {
    pub bot_id: String,
    pub request_id: String,
    pub params: Value,
    /// The dispatched turn's raw text. Always empty for an open-session
    /// plan: it dispatches no turn, records no [`BotMessage`] row, and
    /// this field exists only so the one [`ChatPlan`] type can carry both
    /// dispatch kinds' shared plumbing.
    pub prompt: String,
    pub attempt_at: f64,
    /// True for an [`RunTurn::OpenSession`] dispatch: the ROOT adapter
    /// strips `headless` and retargets the Bot's own home workspace, and
    /// `finalize` rotates `current_session` WITHOUT recording a chat-turn
    /// message row (no turn was dispatched). `false` for a plain chat
    /// turn, which keeps the original one-shot headless contract.
    pub open_session: bool,
    /// True when the open-session dispatch must reopen the harness's own
    /// prior conversation (`--continue`, `codex resume --last`) rather than
    /// start blank. Always false for a plain chat turn.
    pub resume: bool,
}

/// Bound on the raw chat message: generous enough for a real conversational
/// turn, small enough that a single message cannot alone approach
/// `drogon_protocol::MAX_FRAME_BYTES`.
const MAX_CHAT_PROMPT_CHARS: usize = 20_000;

fn invalid_argument(message: impl Into<String>) -> RpcError {
    RpcError::new("invalid_argument", message.into())
}

fn internal_error(message: impl Into<String>) -> RpcError {
    RpcError::new("internal_error", message.into())
}

fn unauthorized() -> RpcError {
    RpcError::new(
        "unauthorized",
        "bot.run is desktop-only: worker dispatch credentials are denied on this auth path",
    )
}

/// `bot.run` is desktop-only in v1: a worker caller is denied before parsing
/// or the ledger, so a denied caller consumes no admission. Unchanged from
/// A6c's monolithic admit path, now its own named stage.
pub fn authorize_caller(caller: &BotRunCaller) -> Result<(), RpcError> {
    if matches!(caller, BotRunCaller::Worker { .. }) {
        return Err(unauthorized());
    }
    Ok(())
}

fn scope_denied(message: impl Into<String>) -> RpcError {
    RpcError::new("unauthorized", message.into())
}

fn required_string(object: &Value, key: &str) -> Result<String, RpcError> {
    let value = object
        .get(key)
        .ok_or_else(|| invalid_argument(format!("missing required field {key}")))?;
    let text = value
        .as_str()
        .ok_or_else(|| invalid_argument(format!("field {key} must be a string")))?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(invalid_argument(format!("field {key} must be non-empty")));
    }
    Ok(trimmed.to_string())
}

/// Like [`required_string`], but the empty string is a legitimate value
/// here, not a violation: it is the deliberate host-global scope sentinel
/// (bot.snapshot's `workspaceId: ""` aggregation, #348) that
/// `revalidate_run_scope`/`authorized_prepare` resolve to the bot's real
/// owning workspace via `bot_mutation_rpc::resolve_bot_owning_workspace`.
/// Matches `BotDeleteParams`/`BotResponsibilityCreateParams`/
/// `BotResponsibilityDeleteParams` in `drogon_protocol::bot`, which are
/// plain serde `String` fields with no non-empty enforcement, for the same
/// scope. The field must still be present and a string -- only the
/// non-empty requirement is dropped.
fn required_workspace_id(object: &Value, key: &str) -> Result<String, RpcError> {
    let value = object
        .get(key)
        .ok_or_else(|| invalid_argument(format!("missing required field {key}")))?;
    value
        .as_str()
        .map(|text| text.to_string())
        .ok_or_else(|| invalid_argument(format!("field {key} must be a string")))
}

fn optional_string(object: &Value, key: &str) -> Result<Option<String>, RpcError> {
    match object.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .map(|text| Some(text.to_string()))
            .ok_or_else(|| invalid_argument(format!("field {key} must be a string"))),
    }
}

fn parse_harness(value: &Value) -> Result<HarnessOverrides, RpcError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid_argument("harness must be an object"))?;
    let admitted = ["harnessId", "model", "effort", "provider", "permissionMode"];
    for key in object.keys() {
        if !admitted.contains(&key.as_str()) {
            return Err(invalid_argument(format!(
                "unknown field harness.{key}: only admitted harness overrides are accepted"
            )));
        }
    }
    Ok(HarnessOverrides {
        harness_id: required_string(value, "harnessId")?,
        model: optional_string(value, "model")?,
        effort: optional_string(value, "effort")?,
        provider: optional_string(value, "provider")?,
        permission_mode: optional_string(value, "permissionMode")?,
    })
}

/// Strict parse: unknown top-level fields are denied (including a params
/// `requestId` -- the envelope carries it), every starred field is required,
/// and ids must be non-empty after trim. A `prompt` key (chat turn) and
/// `responsibilityId`/`reason`/`eventIdentity` (responsibility turn) are
/// mutually exclusive; supplying both is rejected rather than silently
/// preferring one.
pub fn parse_bot_run_request(params: &Value) -> Result<BotRunRequest, RpcError> {
    let object = params
        .as_object()
        .ok_or_else(|| invalid_argument("bot.run params must be an object"))?;
    let admitted = [
        "workspaceId",
        "hostId",
        "botId",
        "responsibilityId",
        "reason",
        "eventIdentity",
        "prompt",
        "interactive",
        "resume",
        "harness",
        "locale",
    ];
    for key in object.keys() {
        if !admitted.contains(&key.as_str()) {
            return Err(invalid_argument(format!("unknown field {key}")));
        }
    }
    let harness = match object.get("harness") {
        None | Some(Value::Null) => None,
        Some(value) => Some(parse_harness(value)?),
    };
    let interactive = match object.get("interactive") {
        None | Some(Value::Null) => None,
        Some(Value::Bool(value)) => Some(*value),
        Some(_) => return Err(invalid_argument("field interactive must be a boolean")),
    };
    let resume = match object.get("resume") {
        None | Some(Value::Null) => false,
        Some(Value::Bool(value)) => *value,
        Some(_) => return Err(invalid_argument("field resume must be a boolean")),
    };
    if resume && interactive != Some(true) {
        return Err(invalid_argument(
            "field resume is only valid on an open-session dispatch (interactive: true): a chat \
             turn or a responsibility invocation has no prior conversation to reopen",
        ));
    }
    let has_prompt = matches!(object.get("prompt"), Some(value) if !value.is_null());
    if interactive.is_some()
        && ["responsibilityId", "reason", "eventIdentity"]
            .iter()
            .any(|key| object.contains_key(*key))
    {
        return Err(invalid_argument(
            "field interactive must not be set alongside a responsibility invocation (only a chat \
             turn or an open-session dispatch can use it)",
        ));
    }
    let turn = if has_prompt {
        if interactive == Some(true) {
            // The Carlos directive (task_e7c183ebc637): opening a session
            // must never dispatch a model turn -- the model is never the
            // source of truth about the session. Reject the combination so
            // the wire contract itself enforces it.
            return Err(invalid_argument(
                "field prompt must not be set alongside interactive: opening a session never \
                 dispatches a model turn",
            ));
        }
        for key in ["responsibilityId", "reason", "eventIdentity"] {
            if object.contains_key(key) {
                return Err(invalid_argument(format!(
                    "field {key} must not be set alongside prompt (a chat turn carries no \
                     responsibility)"
                )));
            }
        }
        let prompt = required_string(params, "prompt")?;
        if prompt.chars().count() > MAX_CHAT_PROMPT_CHARS {
            return Err(invalid_argument("field prompt exceeds the maximum length"));
        }
        RunTurn::Chat { prompt }
    } else if interactive == Some(true) {
        RunTurn::OpenSession { resume }
    } else {
        if let Some(false) = interactive {
            return Err(invalid_argument(
                "field interactive must be true without a prompt: an open-session dispatch is \
                 the only promptless turn",
            ));
        }
        RunTurn::Responsibility {
            responsibility_id: required_string(params, "responsibilityId")?,
            reason: Reason::parse(object.get("reason").unwrap_or(&Value::Null))?,
            event_identity: required_string(params, "eventIdentity")?,
        }
    };
    Ok(BotRunRequest {
        workspace_id: required_workspace_id(params, "workspaceId")?,
        asserted_host_id: required_string(params, "hostId")?,
        bot_id: required_string(params, "botId")?,
        turn,
        harness,
        locale: optional_string(params, "locale")?,
    })
}

/// This module's own deterministic rendering of a native refusal: the
/// structured `{type, kind, ...detail}` object per the approved mapping,
/// plus the human message. The runner's refusal types carry no `Display`
/// and A5 owns those files, so this bridge renders each variant exactly
/// once, here; both forms are pinned by the contract tests.
fn render_refusal(refusal: &RunRefusal) -> (Value, String) {
    match refusal {
        RunRefusal::Responsibility(policy) => match policy {
            ResponsibilityRefusal::Disabled => (
                json!({"type": "responsibility", "kind": "disabled"}),
                "responsibility is disabled".to_string(),
            ),
            ResponsibilityRefusal::ReactiveRequiresSuppliedEvent(_) => (
                json!({"type": "responsibility", "kind": "reactiveRequiresSuppliedEvent"}),
                "reactive responsibility requires a supplied event for this invocation reason"
                    .to_string(),
            ),
            ResponsibilityRefusal::UnownedAutomation(automation_id) => (
                json!({
                    "type": "responsibility",
                    "kind": "unownedAutomation",
                    "automationId": automation_id,
                }),
                format!("automation {automation_id} is not owned by this bot"),
            ),
        },
        RunRefusal::Automation(execution_refusal) => match execution_refusal {
            DispatchRefusal::ForeignHost {
                execution_target_id,
                current_host_id,
                ..
            } => (
                json!({
                    "type": "automation",
                    "kind": "foreignHost",
                    "executionTargetId": execution_target_id,
                    "currentHostId": current_host_id,
                }),
                format!(
                    "automation is not local to the current host: automation targets host \
                     {execution_target_id}, current host is {current_host_id}"
                ),
            ),
            DispatchRefusal::Disabled => (
                json!({"type": "automation", "kind": "disabled"}),
                "automation is disabled".to_string(),
            ),
            DispatchRefusal::MissingReactiveEvent => (
                json!({"type": "automation", "kind": "missingReactiveEvent"}),
                "reactive dispatch requires a supplied event".to_string(),
            ),
        },
        RunRefusal::MissingWorkspaceId => (
            json!({"type": "workspace", "kind": "missingWorkspaceId"}),
            "automation has no workspace to run in".to_string(),
        ),
        RunRefusal::UnknownWorkspace(workspace_id) => (
            json!({
                "type": "workspace",
                "kind": "unknownWorkspace",
                "workspaceId": workspace_id,
            }),
            format!("workspace {workspace_id} not found"),
        ),
        RunRefusal::ForeignWorkspaceHost {
            workspace_id,
            workspace_host_id,
            current_host_id,
        } => (
            json!({
                "type": "workspace",
                "kind": "foreignWorkspaceHost",
                "workspaceId": workspace_id,
                "workspaceHostId": workspace_host_id,
                "currentHostId": current_host_id,
            }),
            format!(
                "foreign workspace host: workspace {workspace_id} belongs to host \
                 {workspace_host_id}, not current host {current_host_id}"
            ),
        ),
    }
}

fn render_unsupported(unsupported: &RunUnsupported) -> (Value, String) {
    match unsupported {
        RunUnsupported::NewPerRunWorkspaceMode => (
            json!({"kind": "newPerRunWorkspaceMode"}),
            "new-per-run workspace creation is not wired for bot.run".to_string(),
        ),
        RunUnsupported::ReactiveDispatchParamsNotWired => (
            json!({"kind": "reactiveDispatchParamsNotWired"}),
            "reactive dispatch parameters are not wired for bot.run".to_string(),
        ),
    }
}

/// Pure receipt construction: the single source of the approved receipt
/// shape. Nothing here persists anything -- persistence is the delegated
/// ledger's job.
#[allow(clippy::too_many_arguments)]
pub fn build_receipt(
    request_id: &str,
    derived_host_id: &str,
    workspace_id: &str,
    outcome: &str,
    refusal: Value,
    reason: Value,
    session: Option<Value>,
    automation_run_id: Option<String>,
    responsibility_run_id: Option<String>,
    message_id: Option<String>,
    error: Value,
    observed_at: Option<f64>,
    recorded_at: f64,
) -> Value {
    json!({
        "requestId": request_id,
        "hostId": derived_host_id,
        "workspaceId": workspace_id,
        "automationRunId": automation_run_id,
        "responsibilityRunId": responsibility_run_id,
        "messageId": message_id,
        "session": session,
        "outcome": outcome,
        "refusal": refusal,
        "reason": reason,
        "error": error,
        "observedAt": observed_at,
        "recordedAt": recorded_at,
    })
}

/// The workspace-ownership + host-assertion fact set both
/// [`revalidate_run_scope`] and [`authorized_prepare`] check -- the SAME
/// query and equality checks, translated by each caller into its own
/// vocabulary (a propagated `RpcError` for the replay-time `authorize`
/// callback; a persisted, structured `Refused` receipt for fresh
/// admission).
enum WorkspaceScope {
    Ok,
    /// The deliberate empty-string host-global sentinel (mirrors
    /// `bot_mutation_rpc::authorize_existing_bot_scope`'s own handling of
    /// `workspaceId: ""`, e.g. a run issued from the host-global Bots
    /// view): no workspace row to look up yet, but the asserted host still
    /// gates admission. The actual owning folder/workspace is resolved
    /// afterward, by bot id, in [`authorized_prepare`] -- never here.
    HostGlobal,
    UnknownWorkspace,
    ForeignWorkspaceHost {
        workspace_host_id: String,
    },
    ForeignAssertedHost,
}

fn lookup_workspace_scope(
    conn: &Connection,
    derived_host_id: &str,
    request: &BotRunRequest,
) -> Result<WorkspaceScope, RpcError> {
    if request.workspace_id.is_empty() {
        if request.asserted_host_id != derived_host_id {
            return Ok(WorkspaceScope::ForeignAssertedHost);
        }
        return Ok(WorkspaceScope::HostGlobal);
    }
    let workspace = {
        let mut statement = conn
            .prepare("SELECT host_id, path FROM workspaces WHERE id = ?1")
            .map_err(|e| internal_error(format!("workspace lookup failed: {e}")))?;
        let mut rows = statement
            .query([&request.workspace_id])
            .map_err(|e| internal_error(format!("workspace lookup failed: {e}")))?;
        match rows.next() {
            Ok(Some(row)) => {
                let host_id: String = row
                    .get(0)
                    .map_err(|e| internal_error(format!("workspace lookup failed: {e}")))?;
                let path: String = row
                    .get(1)
                    .map_err(|e| internal_error(format!("workspace lookup failed: {e}")))?;
                Some((host_id, path))
            }
            Ok(None) => None,
            Err(e) => Err(internal_error(format!("workspace lookup failed: {e}")))?,
        }
    };
    let (workspace_host_id, _folder) = match workspace {
        Some(pair) => pair,
        None => return Ok(WorkspaceScope::UnknownWorkspace),
    };
    if workspace_host_id != derived_host_id {
        return Ok(WorkspaceScope::ForeignWorkspaceHost { workspace_host_id });
    }
    if request.asserted_host_id != derived_host_id {
        return Ok(WorkspaceScope::ForeignAssertedHost);
    }
    // The exact-match folder is no longer threaded through from here: both
    // callers ([`revalidate_run_scope`] and [`authorized_prepare`]) now
    // resolve the bot's true owning (folder, workspaceId) themselves via
    // [`crate::bot_mutation_rpc::resolve_bot_owning_workspace`], which
    // re-derives it -- this scope check's only remaining job is admitting
    // or refusing the ASSERTED workspace/host, not naming a folder.
    Ok(WorkspaceScope::Ok)
}

/// Replay-time scope revalidation ONLY: workspace-ownership +
/// host-assertion, never harness/readiness. Meant to be installed as
/// `run_staged`'s `authorize` callback, which runs on EVERY admission
/// attempt including a saved replay, BEFORE the stored receipt is decoded --
/// so a replay whose workspace was deleted/moved/host-changed since the
/// original admission is denied with a propagated error, and the stored
/// receipt is left completely untouched (an `authorize` error short-circuits
/// before any read/write of the `requests` row).
pub fn revalidate_run_scope(
    conn: &Connection,
    derived_host_id: &str,
    request: &BotRunRequest,
) -> Result<(), RpcError> {
    match lookup_workspace_scope(conn, derived_host_id, request)? {
        WorkspaceScope::Ok | WorkspaceScope::HostGlobal => Ok(()),
        WorkspaceScope::UnknownWorkspace => Err(scope_denied(format!(
            "workspace {} not found",
            request.workspace_id
        ))),
        WorkspaceScope::ForeignWorkspaceHost { workspace_host_id } => Err(scope_denied(format!(
            "foreign workspace host: workspace {} belongs to host {}, not current host {}",
            request.workspace_id, workspace_host_id, derived_host_id
        ))),
        WorkspaceScope::ForeignAssertedHost => Err(scope_denied(format!(
            "foreign workspace host: asserted host {} does not match derived host {}",
            request.asserted_host_id, derived_host_id
        ))),
    }
}

/// Outcome of [`authorized_prepare`]. Every variant is fully owned: `Ready`'s
/// `RunPlan` has no lifetime parameters (`automations::runner::RunPlan`), so
/// it outlives the `&Connection` this call borrowed, by construction.
#[derive(Debug, Clone, PartialEq)]
pub enum BotRunPrepare {
    Refused {
        workspace_id: String,
        refusal: Value,
        error: String,
    },
    Unsupported {
        workspace_id: String,
        reason: Value,
        error: String,
    },
    ReadyResponsibility {
        plan: RunPlan,
        workspace_id: String,
    },
    ReadyChat {
        plan: ChatPlan,
        workspace_id: String,
    },
}

/// FRESH-ONLY admission preparation (ROOT's `run_staged` `prepare` callback
/// runs this only when no stored row exists for this key): repeats the
/// workspace-ownership + host-assertion checks (so a fresh refusal still
/// renders a structured, persisted receipt), then the harness-mapping
/// presence check (absent overrides -> `Unsupported` `harnessMappingAbsent`;
/// no default is invented and no authorization is synthesized), then
/// delegates the storage-scope + bot/responsibility readiness gate to
/// `automations::runner::prepare_run_plan_in_tx` (composed, never
/// duplicated). `attempt_at` is this admission's own clock sample: used for
/// `RunPlan::attempt_at` and, by the caller, as every receipt's
/// `recordedAt` -- `observed_at` for a `Ready` plan's eventual receipt must
/// come from a LATER sample, taken after [`execute`] returns.
///
/// Uses `_in_tx` (not the transaction-owning `prepare_run_plan`) because
/// this function is meant to run inside the delegated ledger's own
/// admission transaction, which cannot nest a second real `BEGIN`.
pub fn authorized_prepare(
    conn: &Connection,
    derived_host_id: &str,
    envelope_request_id: &str,
    request: &BotRunRequest,
    attempt_at: f64,
) -> Result<BotRunPrepare, RpcError> {
    let workspace_id = request.workspace_id.clone();
    let (folder, workspace_id) = match lookup_workspace_scope(conn, derived_host_id, request)? {
        // Both a real, host-owned workspace and the host-global sentinel
        // are a VALID asserted scope (checked above); neither is
        // necessarily the bot's OWN home, though -- a stale workspace
        // selection or the host-global Bots view both assert a scope the
        // bot may not actually live in. Resolve the bot's true owning
        // (folder, workspaceId) here, the same primitive `bot.delete` and
        // `bot.responsibility_create`/`delete` already share, so the
        // staged ledger and the shell-fixture session launch it triggers
        // always target the bot's real workspace, never the caller's
        // possibly-stale assertion.
        WorkspaceScope::Ok | WorkspaceScope::HostGlobal => {
            match crate::bot_mutation_rpc::resolve_bot_owning_workspace(
                conn,
                derived_host_id,
                &request.workspace_id,
                &request.asserted_host_id,
                &request.bot_id,
            ) {
                Ok(resolved) => resolved,
                Err(e) if e.code == "not_found" => {
                    return Ok(BotRunPrepare::Refused {
                        workspace_id,
                        refusal: json!({
                            "type": "bot",
                            "kind": "unknownBot",
                            "botId": request.bot_id,
                        }),
                        error: format!("bot {} not found", request.bot_id),
                    });
                }
                Err(e) => return Err(e),
            }
        }
        WorkspaceScope::UnknownWorkspace => {
            return Ok(BotRunPrepare::Refused {
                error: format!("workspace {workspace_id} not found"),
                refusal: json!({
                    "type": "workspace",
                    "kind": "unknownWorkspace",
                    "workspaceId": workspace_id,
                }),
                workspace_id,
            });
        }
        WorkspaceScope::ForeignWorkspaceHost { workspace_host_id } => {
            return Ok(BotRunPrepare::Refused {
                error: format!(
                    "foreign workspace host: workspace {workspace_id} belongs to host \
                     {workspace_host_id}, not current host {derived_host_id}"
                ),
                refusal: json!({
                    "type": "workspace",
                    "kind": "foreignWorkspaceHost",
                    "workspaceId": workspace_id,
                    "workspaceHostId": workspace_host_id,
                    "currentHostId": derived_host_id,
                }),
                workspace_id,
            });
        }
        WorkspaceScope::ForeignAssertedHost => {
            return Ok(BotRunPrepare::Refused {
                error: format!(
                    "foreign workspace host: asserted host {} does not match \
                     derived host {derived_host_id}",
                    request.asserted_host_id
                ),
                refusal: json!({
                    "type": "workspace",
                    "kind": "foreignWorkspaceHost",
                    "workspaceId": workspace_id,
                    "assertedHostId": request.asserted_host_id,
                    "currentHostId": derived_host_id,
                }),
                workspace_id,
            });
        }
    };

    // Harness mapping: absent overrides are `unsupported` until an existing
    // mapping resolves them; none exists in this build, so no default and
    // no synthetic authorization. (`harnessMappingAbsent` is this module's
    // own reason kind, flagged for ROOT approval.) FRESH-ONLY: a replay
    // must never depend on whether a harness mapping currently exists.
    let Some(harness) = &request.harness else {
        return Ok(BotRunPrepare::Unsupported {
            workspace_id,
            reason: json!({"kind": "harnessMappingAbsent"}),
            error: "no harness mapping exists for this bot: supply admitted \
                    harness overrides"
                .to_string(),
        });
    };
    let harness_params = HarnessLaunchParams {
        harness_id: harness.harness_id.clone(),
        model: harness.model.clone(),
        effort: harness.effort.clone(),
        provider: harness.provider.clone(),
        permission_mode: harness.permission_mode.clone(),
        // Both turn kinds (responsibility and chat) are headless daemon
        // runs: no TUI, no approval-answer surface (issue #186).
        headless: true,
    };

    match &request.turn {
        RunTurn::Responsibility {
            responsibility_id,
            reason,
            event_identity,
        } => {
            let prepared = runner::prepare_run_plan_in_tx(
                conn,
                derived_host_id,
                &folder,
                &request.bot_id,
                responsibility_id,
                derived_host_id,
                &reason.to_invocation_reason(event_identity),
                event_identity,
                &harness_params,
                attempt_at,
            );
            match prepared {
                Ok(PrepareOutcome::Ready(plan)) => {
                    Ok(BotRunPrepare::ReadyResponsibility { plan, workspace_id })
                }
                Ok(PrepareOutcome::Refused(refusal)) => {
                    let (object, message) = render_refusal(&refusal);
                    Ok(BotRunPrepare::Refused {
                        workspace_id,
                        refusal: object,
                        error: message,
                    })
                }
                Ok(PrepareOutcome::Unsupported(unsupported)) => {
                    let (reason, message) = render_unsupported(&unsupported);
                    Ok(BotRunPrepare::Unsupported {
                        workspace_id,
                        reason,
                        error: message,
                    })
                }
                Err(e) => Err(internal_error(format!("failed to load bot run state: {e}"))),
            }
        }
        RunTurn::Chat { prompt } => {
            let Some(bot) = bots_storage::get_bot(conn, derived_host_id, &folder, &request.bot_id)
                .map_err(|e| internal_error(format!("failed to load bot run state: {e}")))?
            else {
                return Ok(BotRunPrepare::Refused {
                    workspace_id,
                    refusal: json!({"type": "bot", "kind": "unknownBot", "botId": request.bot_id}),
                    error: format!("bot {} not found", request.bot_id),
                });
            };
            let operating_prompt = crate::bots::prompt::build_operating_prompt(&bot, prompt);
            let chat_request_id = format!("bot-chat:{envelope_request_id}");
            let params = build_chat_harness_start_params(
                &workspace_id,
                Some(&operating_prompt),
                &harness_params,
                false,
                None,
            );
            Ok(BotRunPrepare::ReadyChat {
                plan: ChatPlan {
                    bot_id: request.bot_id.clone(),
                    request_id: chat_request_id,
                    params,
                    prompt: prompt.clone(),
                    attempt_at,
                    open_session: false,
                    resume: false,
                },
                workspace_id,
            })
        }
        RunTurn::OpenSession { resume } => {
            // Same bot-existence gate as a chat turn, but NO prompt is
            // built or dispatched: the session opens live and IDLE, and
            // the harness's own interactive entrypoint waits for the
            // user's first real message (Carlos directive,
            // task_e7c183ebc637). Liveness/environment facts belong to
            // the daemon's status pill and inspector, never to a model
            // recital.
            let Some(bot) = bots_storage::get_bot(conn, derived_host_id, &folder, &request.bot_id)
                .map_err(|e| internal_error(format!("failed to load bot run state: {e}")))?
            else {
                return Ok(BotRunPrepare::Refused {
                    workspace_id,
                    refusal: json!({"type": "bot", "kind": "unknownBot", "botId": request.bot_id}),
                    error: format!("bot {} not found", request.bot_id),
                });
            };
            // Resume by identity: the provider-native conversation this Bot's
            // session is having, so the harness opens THAT conversation
            // (`claude --resume <id>`) instead of the most recent one in the
            // Bot's home. The Bot record's latched locator is preferred -- it
            // survives the Drogon session row's deletion on an explicit close
            // -- and the daemon's own row is consulted only to fill in what
            // the record does not have yet. Absent both, the launch degrades
            // exactly as before and reports `agentResume: "fresh"`/
            // `"continued"` from the daemon, never a pretend continuation.
            let identity = if *resume {
                resolve_bot_agent_session(conn, derived_host_id, &bot, request.bot_id.as_str())
            } else {
                None
            };
            let chat_request_id = format!("bot-open:{envelope_request_id}");
            let params = build_chat_harness_start_params(
                &workspace_id,
                None,
                &harness_params,
                *resume,
                identity.as_ref(),
            );
            Ok(BotRunPrepare::ReadyChat {
                plan: ChatPlan {
                    bot_id: request.bot_id.clone(),
                    request_id: chat_request_id,
                    params,
                    prompt: String::new(),
                    attempt_at,
                    open_session: true,
                    resume: *resume,
                },
                workspace_id,
            })
        }
    }
}

/// Chat-turn equivalent of `automations::runner`'s private
/// `build_harness_start_params`: same shape, since `harness.start` itself
/// has no concept of responsibilities/automations. `prompt: None` (the
/// open-session dispatch) omits the key entirely, so the harness starts
/// with nothing to consume -- no model turn exists to burn.
fn build_chat_harness_start_params(
    workspace_id: &str,
    prompt: Option<&str>,
    harness_params: &HarnessLaunchParams,
    resume: bool,
    agent_session: Option<&crate::session::AgentSessionIdentity>,
) -> Value {
    let mut params = json!({
        "workspaceId": workspace_id,
        "harnessId": harness_params.harness_id,
    });
    if resume {
        // Defect 2: reopen the harness's own prior conversation. Native's
        // launch planner maps this to `--continue` / `codex resume --last`.
        params["resume"] = json!(true);
    }
    if let Some(identity) = agent_session {
        // The exact conversation, when the harness reported one. The planner
        // spells it per harness (`claude --resume <id>`, `pi --session
        // <transcript>`, ...) and degrades to its own most-recent entrypoint
        // when the locator cannot name one.
        params["agentSessionId"] = json!(identity.id);
        if let Some(path) = &identity.transcript_path {
            params["agentSessionTranscriptPath"] = json!(path);
        }
    }
    if let Some(prompt) = prompt {
        params["prompt"] = json!(prompt);
    }
    if let Some(model) = &harness_params.model {
        params["model"] = json!(model);
    }
    if let Some(effort) = &harness_params.effort {
        params["effort"] = json!(effort);
    }
    if let Some(provider) = &harness_params.provider {
        params["provider"] = json!(provider);
    }
    if let Some(permission_mode) = &harness_params.permission_mode {
        params["permissionMode"] = json!(permission_mode);
    }
    if harness_params.headless {
        params["headless"] = json!(true);
    }
    params
}

/// Chat-turn equivalent of `automations::runner::dispatch_run_plan`: the
/// same one-`harness_start`-plus-one-`session_read` composition, over
/// [`ChatPlan`] instead of [`RunPlan`] (which requires an owned
/// `Automation`/`Responsibility` a chat turn never has).
pub fn execute_chat<S: DispatchSeam>(plan: &ChatPlan, seam: &S) -> RunnerOutcome {
    let started = match seam.harness_start(&plan.request_id, plan.params.clone()) {
        Ok(started) => started,
        Err(err) => return RunnerOutcome::DispatchFailed(err),
    };
    match seam.session_read(&started.session_id, &started.incarnation) {
        Ok(observation) => RunnerOutcome::Observed {
            session_id: started.session_id,
            incarnation: started.incarnation,
            verdict: observation.verdict,
            exit_code: observation.exit_code,
        },
        Err(err) => RunnerOutcome::ObservationFailed {
            session_id: started.session_id,
            incarnation: started.incarnation,
            error: err,
        },
    }
}

fn host_observation_of(verdict: &str) -> HostObservation {
    if verdict == "exited" {
        HostObservation::Exited
    } else {
        HostObservation::Live
    }
}

/// Durable record for a chat turn: connection-bound (opens no transaction
/// of its own), meant to run inside the delegated ledger's own `finalize`
/// transaction, same as [`record`]. `message_id` is minted once in `effect`
/// (so the receipt's `messageId` and the persisted row share the same id)
/// and threaded in rather than minted here.
pub fn record_chat(
    conn: &Connection,
    plan: &ChatPlan,
    outcome: &RunnerOutcome,
    observed_at: f64,
    message_id: String,
) -> Result<(), RpcError> {
    let (session_id, incarnation, host_observation, ended_at, error) = match outcome {
        RunnerOutcome::Observed {
            session_id,
            incarnation,
            verdict,
            ..
        } => (
            Some(session_id.clone()),
            Some(incarnation.clone()),
            Some(host_observation_of(verdict)),
            Some(observed_at),
            None,
        ),
        RunnerOutcome::ObservationFailed {
            session_id,
            incarnation,
            error,
        } => (
            Some(session_id.clone()),
            Some(incarnation.clone()),
            Some(HostObservation::Unverifiable),
            Some(observed_at),
            Some(error.to_string()),
        ),
        RunnerOutcome::DispatchFailed(error) => (None, None, None, None, Some(error.to_string())),
    };
    let message = BotMessage {
        id: message_id,
        bot_id: plan.bot_id.clone(),
        request_id: plan.request_id.clone(),
        prompt: plan.prompt.clone(),
        session_id,
        incarnation,
        host_observation,
        error,
        started_at: plan.attempt_at,
        ended_at,
    };
    bots_storage::record_bot_message_in_tx(conn, &message)
        .map_err(|e| internal_error(format!("failed to record bot message: {e}")))
}

/// Get-or-create the Bot's OWN isolated home workspace -- the real fix
/// behind "isolation is real, not cosmetic": an interactive Bot session's
/// `harness.start` `workspaceId` (its cwd) must be THIS, never the folder
/// the Bot's record happens to be stored under (that folder is whatever
/// project workspace was selected at `bot.create` time -- the caller's own
/// workspace, not the Bot's). Delegates to `bot_self_mgmt::ensure_home_for_bot`
/// -- the SAME provisioned-home primitive `bot.self_provision` (P1) already
/// builds (a registered workspace at `<DROGON_BOTS_DIR or data_dir/bots>/
/// <handle>`, `~/Drogon/bots/<handle>` in a real install), just never wired
/// to Open Session before now, so opening a session for a Bot that was
/// already explicitly provisioned reuses its existing home unchanged.
fn ensure_bot_home_workspace(
    tx: &rusqlite::Transaction,
    data_dir: &std::path::Path,
    host_id: &str,
    bot_id: &str,
    origin_workspace_id: &str,
) -> Result<(String, String), RpcError> {
    let folder = bots_storage::folder_for_bot_id(tx, host_id, bot_id)
        .map_err(|e| internal_error(format!("failed to load bot run state: {e}")))?
        .ok_or_else(|| not_found_bot(bot_id))?;
    let bot = bots_storage::get_bot(tx, host_id, &folder, bot_id)
        .map_err(|e| internal_error(format!("failed to load bot run state: {e}")))?
        .ok_or_else(|| not_found_bot(bot_id))?;
    let home = crate::bot_self_mgmt::ensure_home_for_bot(
        tx,
        data_dir,
        host_id,
        &bot,
        origin_workspace_id,
    )?;
    Ok((home.home_workspace_id, home.path))
}

fn not_found_bot(bot_id: &str) -> RpcError {
    RpcError::new("not_found", format!("bot {bot_id} not found"))
}

/// The provider-native conversation a Bot's recorded session is having: the
/// record's latched locator first (it survives the Drogon session row's
/// deletion), else the daemon's own durable row for that session id (written
/// by the harness's hook payload). Never both, never invented.
fn resolve_bot_agent_session(
    conn: &Connection,
    host_id: &str,
    bot: &crate::bots::records::Bot,
    bot_id: &str,
) -> Option<crate::session::AgentSessionIdentity> {
    let recorded = bot.current_session.as_ref()?;
    if let Some(identity) = crate::session::AgentSessionIdentity::parse(
        recorded.agent_session_id.as_deref(),
        recorded.agent_session_transcript_path.as_deref(),
    ) {
        return Some(identity);
    }
    let identity = crate::session::recorded_agent_session(conn, &recorded.session_id)
        .ok()
        .flatten()?;
    // Learn it for next time: the row may be gone by then.
    if let Ok(Some(folder)) = bots_storage::folder_for_bot_id(conn, host_id, bot_id) {
        let _ = bots_storage::record_session_agent_identity(
            conn,
            host_id,
            &folder,
            bot_id,
            &recorded.session_id,
            &identity,
            crate::now_unix_ms() as f64 / 1000.0,
        );
    }
    Some(identity)
}

/// Persists the open-session side effect [`record_chat`] does not cover:
/// rotates the Bot's `current_session` to the just-opened one (so
/// `bot.snapshot` reflects the live session immediately), when the dispatch
/// actually produced one (never on [`RunnerOutcome::DispatchFailed`], which
/// carries no session identity at all). Connection-bound, meant to run
/// alongside [`record_chat`] inside the delegated ledger's own `finalize`
/// transaction. `harnessId`/`model` are read back off `plan.params` (the
/// exact values `harness.start` was actually called with) rather than
/// re-derived, so the persisted `BotSession` can never drift from reality.
fn record_opened_session(
    conn: &Connection,
    host_id: &str,
    plan: &ChatPlan,
    outcome: &RunnerOutcome,
    observed_at: f64,
) -> Result<(), RpcError> {
    let session_id = match outcome {
        RunnerOutcome::Observed { session_id, .. } => session_id.clone(),
        RunnerOutcome::ObservationFailed { session_id, .. } => session_id.clone(),
        RunnerOutcome::DispatchFailed(_) => return Ok(()),
    };
    let Some(folder) = bots_storage::folder_for_bot_id(conn, host_id, &plan.bot_id)
        .map_err(|e| internal_error(format!("failed to load bot run state: {e}")))?
    else {
        // The Bot vanished between `authorized_prepare` and `finalize`
        // (concurrent delete): the live session it opened is real and
        // stays running, but there is no Bot record left to point at it.
        return Ok(());
    };
    let harness = plan
        .params
        .get("harnessId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let model = plan
        .params
        .get("model")
        .and_then(Value::as_str)
        .map(str::to_string);
    bots_storage::rotate_session(
        conn,
        host_id,
        &folder,
        &plan.bot_id,
        Some(crate::bots::records::BotSession {
            session_id,
            harness,
            model,
            started_at: plan.attempt_at,
            rotated_at: Some(observed_at),
            // The provider-native conversation is learned from the harness's
            // own hook payload after the session starts; `bot.snapshot`
            // latches it onto this record (see
            // `project_bots_current_session_facts`). A rotated session must
            // never inherit the previous conversation's locator, so both stay
            // unset here.
            agent_session_id: None,
            agent_session_transcript_path: None,
        }),
        observed_at,
    )
    .map_err(|e| internal_error(format!("failed to record the opened Bot session: {e}")))?;
    Ok(())
}

/// Phase 2: no `Connection` -- the caller MUST have released its DB guard
/// before calling. Named pass-through onto
/// `automations::runner::dispatch_run_plan` so this module's own staged-API
/// surface names every stage.
pub fn execute<S: DispatchSeam>(plan: &RunPlan, seam: &S) -> RunnerOutcome {
    runner::dispatch_run_plan(seam, plan)
}

/// Phase 3: durable record. Connection-bound (opens no transaction of its
/// own, V4-A6d) so it can run inside the delegated ledger's own `finalize`
/// transaction and commit atomically with that transaction's receipt write.
pub fn record(
    conn: &Connection,
    plan: &RunPlan,
    outcome: &RunnerOutcome,
    observed_at: f64,
) -> Result<(), RpcError> {
    runner::record_run_outcome_in_tx(conn, plan, outcome, observed_at)
        .map_err(|e| internal_error(format!("failed to record bot run: {e}")))
}

/// What [`Engine::bot_run`]'s `effect` phase hands to its `finalize` phase:
/// the owned plan plus its outcome, tagged by which turn kind actually ran
/// (a single call is always exactly one of the two).
enum PreparedOutcome {
    Responsibility(RunPlan, RunnerOutcome, f64),
    Chat(ChatPlan, RunnerOutcome, f64, Option<String>),
}

/// The applied ROOT adapter: composes the staged primitives above onto
/// `RequestLedger::run_staged`. See this module's doc for why no outer
/// `lifecycle_gate` guard is taken here, unlike `bot_create`.
impl crate::Engine {
    pub(crate) fn bot_run(&self, request: &drogon_protocol::Request) -> Result<Value, RpcError> {
        let parsed = parse_bot_run_request(&request.params)?;
        let derived_host_id = self.host_id.clone();
        let request_id = request.request_id.clone();
        let method = request.method.clone();
        let params = request.params.clone();
        // Cloned up front (not `self.data_dir()` inside a `prepare` closure
        // below): `self.ledger.run_staged(&self.db, ...)` already borrows
        // `self` disjointly by field, which a `self.data_dir()` *method*
        // call inside a captured closure cannot join without borrowing all
        // of `self`.
        let data_dir = self.data_dir().to_path_buf();
        let seam = EngineDispatchSeam::new(self);
        let outcome_slot: Cell<Option<PreparedOutcome>> = Cell::new(None);
        self.ledger.run_staged(
            &self.db,
            &request_id,
            &method,
            &params,
            |tx| {
                if self.quiescent.load(Ordering::Acquire) {
                    return Err(crate::error::runtime_busy(
                        "service admission is frozen for shutdown",
                    ));
                }
                revalidate_run_scope(tx, &derived_host_id, &parsed)
            },
            |tx| {
                // Single clock sample at fresh admission; travels as part of
                // the prepared tuple so `effect` never needs its own admission
                // clock.
                let attempt_at = crate::now_unix_ms() as f64;
                let mut prepared =
                    authorized_prepare(tx, &derived_host_id, &request_id, &parsed, attempt_at)?;
                // Open-session retarget (bug-bot-a836b4ebf8be65505): an
                // open-session dispatch is a live user-facing tab, not a
                // headless daemon run, so it must (a) drop `headless` from
                // the built `harness.start` params -- the interactive TUI
                // entrypoint stays running instead of exiting on completion
                // -- and (b) run against the Bot's OWN isolated sandbox
                // workspace instead of the folder its record happens to be
                // stored under (which is whatever project workspace was
                // selected at `bot.create` time, never the caller's to
                // isolate from). Its params carry NO `prompt` key already
                // (authorized_prepare built it that way): no model turn is
                // dispatched. `authorized_prepare` stays unaware of any of
                // this -- it is applied here, in the ROOT adapter, so the
                // staged primitive keeps its original one-shot contract
                // (and every existing direct-call test) untouched.
                if let BotRunPrepare::ReadyChat { plan, workspace_id } = &mut prepared
                    && plan.open_session
                {
                    plan.params
                        .as_object_mut()
                        .expect("chat harness.start params is always a JSON object")
                        .remove("headless");
                    let (home_workspace_id, _home_path) = ensure_bot_home_workspace(
                        tx,
                        &data_dir,
                        &derived_host_id,
                        &parsed.bot_id,
                        workspace_id,
                    )?;
                    plan.params["workspaceId"] = json!(home_workspace_id);
                    *workspace_id = home_workspace_id;
                }
                Ok((attempt_at, prepared))
            },
            |(attempt_at, prepared)| match prepared {
                BotRunPrepare::Refused {
                    workspace_id,
                    refusal,
                    error,
                } => Ok(build_receipt(
                    &request_id,
                    &derived_host_id,
                    &workspace_id,
                    "refused",
                    refusal,
                    Value::Null,
                    None,
                    None,
                    None,
                    None,
                    Value::String(error),
                    None,
                    attempt_at,
                )),
                BotRunPrepare::Unsupported {
                    workspace_id,
                    reason,
                    error,
                } => Ok(build_receipt(
                    &request_id,
                    &derived_host_id,
                    &workspace_id,
                    "unsupported",
                    Value::Null,
                    reason,
                    None,
                    None,
                    None,
                    None,
                    Value::String(error),
                    None,
                    attempt_at,
                )),
                BotRunPrepare::ReadyResponsibility { plan, workspace_id } => {
                    let outcome = execute(&plan, &seam);
                    // Strictly after `execute` returns: the actual
                    // `session.read` wall time, never the admission sample.
                    let observed_at = crate::now_unix_ms() as f64;
                    let receipt = match &outcome {
                        RunnerOutcome::Observed {
                            session_id,
                            incarnation,
                            ..
                        } => build_receipt(
                            &request_id,
                            &derived_host_id,
                            &workspace_id,
                            "dispatched",
                            Value::Null,
                            Value::Null,
                            Some(json!({"sessionId": session_id, "incarnation": incarnation})),
                            Some(format!("ar:{}", plan.request_id)),
                            Some(plan.request_id.clone()),
                            None,
                            Value::Null,
                            Some(observed_at),
                            attempt_at,
                        ),
                        RunnerOutcome::ObservationFailed {
                            session_id,
                            incarnation,
                            error,
                        } => build_receipt(
                            &request_id,
                            &derived_host_id,
                            &workspace_id,
                            "dispatched",
                            Value::Null,
                            Value::Null,
                            Some(json!({"sessionId": session_id, "incarnation": incarnation})),
                            Some(format!("ar:{}", plan.request_id)),
                            Some(plan.request_id.clone()),
                            None,
                            Value::String(error.to_string()),
                            Some(observed_at),
                            attempt_at,
                        ),
                        RunnerOutcome::DispatchFailed(error) => build_receipt(
                            &request_id,
                            &derived_host_id,
                            &workspace_id,
                            "refused",
                            Value::Null,
                            Value::Null,
                            None,
                            Some(format!("ar:{}", plan.request_id)),
                            Some(plan.request_id.clone()),
                            None,
                            Value::String(error.to_string()),
                            None,
                            attempt_at,
                        ),
                    };
                    outcome_slot.set(Some(PreparedOutcome::Responsibility(
                        plan,
                        outcome,
                        observed_at,
                    )));
                    Ok(receipt)
                }
                BotRunPrepare::ReadyChat { plan, workspace_id } => {
                    let outcome = execute_chat(&plan, &seam);
                    // Strictly after `execute_chat` returns, same rule as
                    // the responsibility path.
                    let observed_at = crate::now_unix_ms() as f64;
                    // An open-session dispatch has no message row, so its
                    // receipt carries a null messageId honestly.
                    let message_id = (!plan.open_session).then(|| uuid::Uuid::new_v4().to_string());
                    let receipt = match &outcome {
                        RunnerOutcome::Observed {
                            session_id,
                            incarnation,
                            ..
                        } => build_receipt(
                            &request_id,
                            &derived_host_id,
                            &workspace_id,
                            "dispatched",
                            Value::Null,
                            Value::Null,
                            Some(json!({"sessionId": session_id, "incarnation": incarnation})),
                            None,
                            None,
                            message_id.clone(),
                            Value::Null,
                            Some(observed_at),
                            attempt_at,
                        ),
                        RunnerOutcome::ObservationFailed {
                            session_id,
                            incarnation,
                            error,
                        } => build_receipt(
                            &request_id,
                            &derived_host_id,
                            &workspace_id,
                            "dispatched",
                            Value::Null,
                            Value::Null,
                            Some(json!({"sessionId": session_id, "incarnation": incarnation})),
                            None,
                            None,
                            message_id.clone(),
                            Value::String(error.to_string()),
                            Some(observed_at),
                            attempt_at,
                        ),
                        RunnerOutcome::DispatchFailed(error) => build_receipt(
                            &request_id,
                            &derived_host_id,
                            &workspace_id,
                            "refused",
                            Value::Null,
                            Value::Null,
                            None,
                            None,
                            None,
                            message_id.clone(),
                            Value::String(error.to_string()),
                            None,
                            attempt_at,
                        ),
                    };
                    outcome_slot.set(Some(PreparedOutcome::Chat(
                        plan,
                        outcome,
                        observed_at,
                        message_id,
                    )));
                    Ok(receipt)
                }
            },
            |tx, _result| {
                match outcome_slot.take() {
                    Some(PreparedOutcome::Responsibility(plan, outcome, observed_at)) => {
                        record(tx, &plan, &outcome, observed_at)?;
                    }
                    Some(PreparedOutcome::Chat(plan, outcome, observed_at, message_id)) => {
                        // An open-session dispatch records NO chat-turn
                        // message row (no turn was dispatched -- the
                        // receipt's messageId stays null and bot.history
                        // stays honest); it only rotates the Bot's
                        // current_session so the snapshot/inspector reflect
                        // the live session.
                        if plan.open_session {
                            record_opened_session(
                                tx,
                                &derived_host_id,
                                &plan,
                                &outcome,
                                observed_at,
                            )?;
                        } else {
                            record_chat(
                                tx,
                                &plan,
                                &outcome,
                                observed_at,
                                // Only an open-session plan arrives without one,
                                // and the branch above already handled it.
                                message_id.expect("a plain chat turn mints a message id"),
                            )?;
                        }
                    }
                    None => {}
                }
                Ok(())
            },
        )
    }

    /// `bot.history {workspaceId, hostId, botId, limit?}`: newest-first
    /// chat-turn history for one bot, bounded by `limit` (default
    /// [`DEFAULT_HISTORY_LIMIT`], clamped to [`MAX_HISTORY_LIMIT`]). A plain
    /// scoped read -- no ledger, no mutation -- following the same
    /// `workspace::owned_path` scope check `bot.snapshot` uses.
    pub(crate) fn bot_history(&self, params: &Value) -> Result<Value, RpcError> {
        let scope: HistoryScope = serde_json::from_value(params.clone())
            .map_err(|_| invalid_argument("Invalid Bot history scope"))?;
        if scope.workspace_id.is_empty() || scope.bot_id.is_empty() {
            return Err(invalid_argument("Invalid Bot history scope"));
        }
        let limit = scope
            .limit
            .map(i64::from)
            .unwrap_or(DEFAULT_HISTORY_LIMIT)
            .clamp(1, MAX_HISTORY_LIMIT);
        let conn = self.db.lock().unwrap();
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| internal_error(format!("bot history lookup failed: {e}")))?;
        let folder =
            crate::workspace::owned_path(&tx, &self.host_id, &scope.workspace_id, &scope.host_id)?;
        let messages = bots_storage::history_for_bot_messages(
            &tx,
            &self.host_id,
            &folder,
            &scope.bot_id,
            limit,
        )
        .map_err(|e| internal_error(format!("failed to read bot history: {e}")))?;
        let result = BotHistoryResult {
            host_id: self.host_id.clone(),
            workspace_id: scope.workspace_id.clone(),
            bot_id: scope.bot_id.clone(),
            messages: messages.into_iter().map(bot_message_wire).collect(),
        };
        serde_json::to_value(&result)
            .map_err(|_| internal_error("Bot history serialization failed".to_string()))
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoryScope {
    workspace_id: String,
    host_id: String,
    bot_id: String,
    #[serde(default)]
    limit: Option<u32>,
}

const DEFAULT_HISTORY_LIMIT: i64 = 50;
const MAX_HISTORY_LIMIT: i64 = 200;

fn bot_message_wire(message: BotMessage) -> BotMessageWire {
    BotMessageWire {
        id: message.id,
        bot_id: message.bot_id,
        request_id: message.request_id,
        prompt: message.prompt,
        session_id: message.session_id,
        incarnation: message.incarnation,
        host_observation: message.host_observation.map(|value| match value {
            HostObservation::Live => BotHostObservation::Live,
            HostObservation::Exited => BotHostObservation::Exited,
            HostObservation::Unverifiable => BotHostObservation::Unverifiable,
        }),
        error: message.error,
        started_at: message.started_at,
        ended_at: message.ended_at,
    }
}
