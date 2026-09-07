//! The `bot.run` bridge: strict desktop-request admission over the
//! ROOT-approved contract, composed on top of `bots::policy` +
//! `automations::runner`'s 3-phase flow (never duplicating either).
//!
//! ## Request contract (strict; unknown fields denied)
//!
//! `{workspaceId*, hostId*, botId*, responsibilityId*, reason*:
//! scheduledDue|manual|reactiveEvent, eventIdentity*, harness?, locale?}`.
//! `requestId` is NOT an admitted param: the native envelope carries it, and
//! [`handle_bot_run`] takes it explicitly as `request_id`. `hostId` is a
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
//! ## Idempotency is DELEGATED, never stored here
//!
//! ROOT directive (A6c): no DDL and no parallel ledger are approved for this
//! module. Receipt persistence and the replay/conflict decision belong to
//! the admitted [`crate::requests::RequestLedger`] at ROOT wiring time; this
//! module therefore defines only the narrow [`ReceiptLedger`] seam,
//! fingerprints the normalized params ([`normalized_request_fingerprint`]),
//! and builds receipt Values as pure functions. It never creates a table,
//! never executes DDL, and never persists anything itself. Parse and
//! authorization failures are decided BEFORE the ledger is consulted, so a
//! malformed or unauthorized request consumes no admission.
//!
//! ## Structured outcomes
//!
//! Refused receipts carry `refusal: {type, kind, ...detail}` --
//! `responsibility{disabled|reactiveRequiresSuppliedEvent|unownedAutomation}`,
//! `automation{foreignHost|disabled|missingReactiveEvent}`, and the
//! workspace-level kinds `missingWorkspaceId|unknownWorkspace|
//! foreignWorkspaceHost`; unsupported receipts carry
//! `reason: {kind: newPerRunWorkspaceMode|reactiveDispatchParamsNotWired}`
//! (plus `harnessMappingAbsent` for this module's own no-mapping case,
//! flagged for ROOT approval). A human-readable `error` string is kept
//! alongside, never instead. `recordedAt`/`observedAt` are numeric
//! attempt-time seconds (`f64`); `observedAt` is the actual observation
//! time -- with this module's single injected clock that is exactly
//! `now_unix` at the poll -- and is null whenever no observation occurred.
//!
//! ## Phase discipline (caller MUST release its DB guard)
//!
//! Like `automations::runner`, this module is structured so nothing holds a
//! `&Connection` across the dispatch phase. That is a property of THIS
//! module's call sequencing only: the production Engine wrapper (ROOT-owned
//! wiring) locks its connection mutex across `prepare`, MUST drop its own
//! `MutexGuard` before the harness dispatch happens, and re-locks for the
//! record phase. Nothing here claims a signature removes a caller's guard;
//! this function simply never holds one, because it takes `&Connection`
//! and the seam by separate parameters.
//!
//! ## Registration status and the ROOT adapter (report-only, not applied)
//!
//! This module is not yet registered in `lib.rs` (ROOT owns registration).
//! The intended wiring: `impl Engine { fn dispatch_bot_run(&self, ...) }`
//! adapts the in-crate `RequestLedger` to [`ReceiptLedger`] (its admit path
//! needs to accept this module's externally computed fingerprint), then
//! calls [`handle_bot_run`] with `EngineDispatchSeam` and the private auth
//! layer's worker binding mapped to [`BotRunCaller::Worker`]. See the A6c
//! delivery report for the exact adapter hunk and the ledger-backed replay
//! test plan, which is ROOT-wiring-tested, not testable from this external
//! compile.

use rusqlite::Connection;
use serde::Serialize;
use serde_json::{Value, json};

use drogon_core::automations::execution::{DispatchRefusal, InvocationReason};
use drogon_core::automations::runner::{
    self, DispatchSeam, HarnessLaunchParams, PrepareOutcome, RunRefusal, RunUnsupported,
    RunnerOutcome,
};
use drogon_core::bots::policy::ResponsibilityRefusal;
use drogon_protocol::RpcError;

/// The idempotency boundary ROOT's wiring adapts the admitted
/// `RequestLedger` into. Implementations decide replay vs. conflict vs.
/// first admission: identical (id, fingerprint) replays return the stored
/// receipt verbatim; a changed fingerprint under the same id is the frozen
/// `request_conflict` rejection; a first admission runs `work` exactly once
/// and persists its receipt. This module never implements persistence
/// itself.
pub trait ReceiptLedger {
    fn admit<F>(&self, request_id: &str, fingerprint: &str, work: F) -> Result<Value, RpcError>
    where
        F: FnOnce() -> Result<Value, RpcError>;
}

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

/// Stable fingerprint over the normalized request (never over raw wire
/// bytes, never including the envelope id). This is what the delegated
/// ledger keys replays and conflicts on, alongside the envelope id.
pub fn normalized_request_fingerprint(request: &BotRunRequest) -> String {
    use sha2::{Digest, Sha256};
    let canonical = serde_json::to_vec(request).unwrap_or_default();
    format!("{:x}", Sha256::digest(canonical))
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
/// ledger's side of the [`ReceiptLedger`] seam.
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

/// Full `bot.run` admission. `derived_host_id` is the server's own host
/// identity (ROOT's wiring reads it from `Engine`); `request_id` is the
/// native envelope identity and the delegated idempotency key; `seam` is
/// injectable so tests never spawn a real session; `ledger` is the
/// delegated idempotency boundary ([`ReceiptLedger`], adapted from the
/// admitted `RequestLedger` at ROOT wiring); `now_unix` is the server
/// clock, injected for deterministic receipts.
// Each parameter is a distinct delegated dependency of the ROOT wiring; a
// bundling struct would hide the exact seam shape the adapter hunk needs.
#[allow(clippy::too_many_arguments)]
pub fn handle_bot_run<L: ReceiptLedger, S: DispatchSeam>(
    conn: &Connection,
    derived_host_id: &str,
    request_id: &str,
    params: &Value,
    caller: &BotRunCaller,
    seam: &S,
    ledger: &L,
    now_unix: u64,
) -> Result<Value, RpcError> {
    // Authorization precedes everything, including parsing and the ledger:
    // a denied caller consumes no admission.
    if matches!(caller, BotRunCaller::Worker { .. }) {
        return Err(unauthorized());
    }

    // Strict parse precedes the ledger too: a malformed request is a pure
    // rejection and must not consume an admission.
    let request = parse_bot_run_request(params)?;
    let print = normalized_request_fingerprint(&request);

    // Idempotency is delegated from here on: identical replay -> stored
    // receipt verbatim, changed params -> frozen request_conflict, first
    // admission -> the work below runs exactly once.
    ledger.admit(request_id, &print, || {
        // Workspace ownership + the client's host assertion. The workspace
        // row (id -> host/path) is the workspace-ownership fact: the derived
        // host must own the workspace, and the asserted host must equal the
        // derived host. The folder for the scoped Bot load is the workspace
        // path.
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
            None => {
                return Ok(build_receipt(
                    request_id,
                    derived_host_id,
                    &request.workspace_id,
                    "refused",
                    json!({
                        "type": "workspace",
                        "kind": "unknownWorkspace",
                        "workspaceId": request.workspace_id,
                    }),
                    Value::Null,
                    None,
                    None,
                    None,
                    Value::String(format!("workspace {} not found", request.workspace_id)),
                    None,
                    now_unix as f64,
                ));
            }
        };
        if workspace_host_id != derived_host_id {
            return Ok(build_receipt(
                request_id,
                derived_host_id,
                &request.workspace_id,
                "refused",
                json!({
                    "type": "workspace",
                    "kind": "foreignWorkspaceHost",
                    "workspaceId": request.workspace_id,
                    "workspaceHostId": workspace_host_id,
                    "currentHostId": derived_host_id,
                }),
                Value::Null,
                None,
                None,
                None,
                Value::String(format!(
                    "foreign workspace host: workspace {} belongs to host {}, \
                     not current host {}",
                    request.workspace_id, workspace_host_id, derived_host_id
                )),
                None,
                now_unix as f64,
            ));
        }
        if request.asserted_host_id != derived_host_id {
            return Ok(build_receipt(
                request_id,
                derived_host_id,
                &request.workspace_id,
                "refused",
                json!({
                    "type": "workspace",
                    "kind": "foreignWorkspaceHost",
                    "workspaceId": request.workspace_id,
                    "assertedHostId": request.asserted_host_id,
                    "currentHostId": derived_host_id,
                }),
                Value::Null,
                None,
                None,
                None,
                Value::String(format!(
                    "foreign workspace host: asserted host {} does not match \
                     derived host {}",
                    request.asserted_host_id, derived_host_id
                )),
                None,
                now_unix as f64,
            ));
        }

        // Harness mapping: absent overrides are `unsupported` until an
        // existing mapping resolves them; none exists in this build, so no
        // default and no synthetic authorization.
        // (`harnessMappingAbsent` is this module's own reason kind, flagged
        // for ROOT approval.)
        let Some(harness) = &request.harness else {
            return Ok(build_receipt(
                request_id,
                derived_host_id,
                &request.workspace_id,
                "unsupported",
                Value::Null,
                json!({"kind": "harnessMappingAbsent"}),
                None,
                None,
                None,
                Value::String(
                    "no harness mapping exists for this bot: supply admitted \
                     harness overrides"
                        .to_string(),
                ),
                None,
                now_unix as f64,
            ));
        };
        let harness_params = HarnessLaunchParams {
            harness_id: harness.harness_id.clone(),
            model: harness.model.clone(),
            effort: harness.effort.clone(),
            provider: harness.provider.clone(),
            permission_mode: harness.permission_mode.clone(),
        };

        // Phase 1 (read-only). Phase 2 deliberately takes no connection:
        // this module never holds a DB guard, and the production Engine
        // wrapper MUST drop its own mutex guard before dispatching and
        // re-lock for phase 3.
        let prepared = runner::prepare_run_plan(
            conn,
            derived_host_id,
            &folder,
            &request.bot_id,
            &request.responsibility_id,
            derived_host_id,
            &request.reason.to_invocation_reason(&request.event_identity),
            &request.event_identity,
            &harness_params,
            now_unix as f64,
        );
        let plan = match prepared {
            Ok(PrepareOutcome::Ready(plan)) => plan,
            Ok(PrepareOutcome::Refused(refusal)) => {
                let (object, message) = render_refusal(&refusal);
                return Ok(build_receipt(
                    request_id,
                    derived_host_id,
                    &request.workspace_id,
                    "refused",
                    object,
                    Value::Null,
                    None,
                    None,
                    None,
                    Value::String(message),
                    None,
                    now_unix as f64,
                ));
            }
            Ok(PrepareOutcome::Unsupported(unsupported)) => {
                let (reason, message) = render_unsupported(&unsupported);
                return Ok(build_receipt(
                    request_id,
                    derived_host_id,
                    &request.workspace_id,
                    "unsupported",
                    Value::Null,
                    reason,
                    None,
                    None,
                    None,
                    Value::String(message),
                    None,
                    now_unix as f64,
                ));
            }
            Err(e) => return Err(internal_error(format!("failed to load bot run state: {e}"))),
        };

        // Phase 2: no `Connection` in hand by construction.
        let outcome = runner::dispatch_run_plan(seam, &plan);

        // Phase 3: durable record. `observed_at` is the actual observation
        // time -- with this module's single injected clock, exactly
        // `now_unix` at the poll.
        // 4-ARG ADAPTATION (A6b, coordinator-authorized): matches the
        // parallel runner track's
        // `record_run_outcome(conn, plan, outcome, observed_at: f64)`.
        runner::record_run_outcome(conn, &plan, &outcome, now_unix as f64)
            .map_err(|e| internal_error(format!("failed to record bot run: {e}")))?;

        let automation_run_id = format!("ar:{}", plan.request_id);
        let (session, error, outcome_name, observed_at) = match &outcome {
            RunnerOutcome::Observed {
                session_id,
                incarnation,
                ..
            } => (
                Some(json!({
                    "sessionId": session_id,
                    "incarnation": incarnation,
                })),
                Value::Null,
                "dispatched",
                Some(now_unix as f64),
            ),
            // A session was admitted but its state could not be observed:
            // the session identity is real and reported verbatim, the
            // observation is the seam's native error, and the outcome stays
            // `dispatched`.
            RunnerOutcome::ObservationFailed {
                session_id,
                incarnation,
                error,
            } => (
                Some(json!({
                    "sessionId": session_id,
                    "incarnation": incarnation,
                })),
                Value::String(error.to_string()),
                "dispatched",
                Some(now_unix as f64),
            ),
            // `harness.start` refused admission: no session exists, the
            // native error is carried verbatim, the recorded rows exist (the
            // runner records the failed attempt), and no observation ever
            // occurred.
            RunnerOutcome::DispatchFailed(error) => {
                (None, Value::String(error.to_string()), "refused", None)
            }
        };

        Ok(build_receipt(
            request_id,
            derived_host_id,
            &request.workspace_id,
            outcome_name,
            Value::Null,
            Value::Null,
            session,
            Some(automation_run_id),
            Some(plan.request_id),
            error,
            observed_at,
            now_unix as f64,
        ))
    })
}
