//! The `bot.run` bridge: strict desktop-request admission over the
//! ROOT-approved contract, composed on top of `bots::policy` +
//! `automations::runner`'s 3-phase flow (never duplicating either).
//!
//! ## Request contract (strict; unknown fields denied)
//!
//! `{workspaceId*, hostId*, botId*, responsibilityId*, reason*:
//! scheduledDue|manual|reactiveEvent, eventIdentity*, harness?, locale?}`.
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
use drogon_protocol::RpcError;

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
    responsibility_id: String,
    reason: Reason,
    event_identity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    harness: Option<HarnessOverrides>,
    #[serde(skip_serializing_if = "Option::is_none")]
    locale: Option<String>,
}

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
/// and ids must be non-empty after trim.
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
    Ok(BotRunRequest {
        workspace_id: required_string(params, "workspaceId")?,
        asserted_host_id: required_string(params, "hostId")?,
        bot_id: required_string(params, "botId")?,
        responsibility_id: required_string(params, "responsibilityId")?,
        reason: Reason::parse(object.get("reason").unwrap_or(&Value::Null))?,
        event_identity: required_string(params, "eventIdentity")?,
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
    Ok { folder: String },
    UnknownWorkspace,
    ForeignWorkspaceHost { workspace_host_id: String },
    ForeignAssertedHost,
}

fn lookup_workspace_scope(
    conn: &Connection,
    derived_host_id: &str,
    request: &BotRunRequest,
) -> Result<WorkspaceScope, RpcError> {
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
    let (workspace_host_id, folder) = match workspace {
        Some(pair) => pair,
        None => return Ok(WorkspaceScope::UnknownWorkspace),
    };
    if workspace_host_id != derived_host_id {
        return Ok(WorkspaceScope::ForeignWorkspaceHost { workspace_host_id });
    }
    if request.asserted_host_id != derived_host_id {
        return Ok(WorkspaceScope::ForeignAssertedHost);
    }
    Ok(WorkspaceScope::Ok { folder })
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
        WorkspaceScope::Ok { .. } => Ok(()),
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
    Ready {
        plan: RunPlan,
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
    request: &BotRunRequest,
    attempt_at: f64,
) -> Result<BotRunPrepare, RpcError> {
    let workspace_id = request.workspace_id.clone();
    let folder = match lookup_workspace_scope(conn, derived_host_id, request)? {
        WorkspaceScope::Ok { folder } => folder,
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
    };

    let prepared = runner::prepare_run_plan_in_tx(
        conn,
        derived_host_id,
        &folder,
        &request.bot_id,
        &request.responsibility_id,
        derived_host_id,
        &request.reason.to_invocation_reason(&request.event_identity),
        &request.event_identity,
        &harness_params,
        attempt_at,
    );
    match prepared {
        Ok(PrepareOutcome::Ready(plan)) => Ok(BotRunPrepare::Ready { plan, workspace_id }),
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
        let seam = EngineDispatchSeam::new(self);
        let outcome_slot: Cell<Option<(RunPlan, RunnerOutcome, f64)>> = Cell::new(None);
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
                Ok((
                    attempt_at,
                    authorized_prepare(tx, &derived_host_id, &parsed, attempt_at)?,
                ))
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
                    Value::String(error),
                    None,
                    attempt_at,
                )),
                BotRunPrepare::Ready { plan, workspace_id } => {
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
                            Value::String(error.to_string()),
                            None,
                            attempt_at,
                        ),
                    };
                    outcome_slot.set(Some((plan, outcome, observed_at)));
                    Ok(receipt)
                }
            },
            |tx, _result| {
                if let Some((plan, outcome, observed_at)) = outcome_slot.take() {
                    record(tx, &plan, &outcome, observed_at)?;
                }
                Ok(())
            },
        )
    }
}
