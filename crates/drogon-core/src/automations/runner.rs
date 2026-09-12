//! Injectable automation trigger adapter over `Engine.dispatch`'s confirmed
//! `harness.start` + `session.read` seam. Three-phase flow so no public
//! function ever holds a live `&Connection` together with a
//! [`DispatchSeam`]: [`prepare_run_plan`] (read-only, one transaction
//! snapshot) -> [`dispatch_run_plan`] (takes no `Connection`, so the
//! caller MUST release its DB guard before calling it -- the signature
//! removes the borrow, not the caller's own `MutexGuard`) ->
//! [`record_run_outcome`] (durable write). Eligibility is
//! decided entirely by `bots::policy`/`automations::execution` (composed,
//! never duplicated); [`RunUnsupported`] is returned -- never a fabricated
//! success -- wherever ROOT-owned wiring (new-workspace-per-run creation,
//! reactive-dispatch params, and `Bot::harness_policy` -> `HarnessId`
//! resolution) is absent.
//!
//! [`prepare_run_plan_in_tx`] and [`record_run_outcome_in_tx`] (V4-A6d) are
//! the connection-bound bodies of [`prepare_run_plan`]/[`record_run_outcome`]
//! minus their own transaction begin/drop/commit: a caller that already
//! holds an open transaction (e.g. a delegated request ledger's own
//! admission/finalize transaction) calls these directly instead, since
//! rusqlite cannot nest a second real `BEGIN` inside one already open. The
//! public wrappers are exactly these bodies wrapped in their own owned
//! transaction and are unchanged in behavior.

use rusqlite::{Connection, OptionalExtension};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use drogon_protocol::{PROTOCOL_VERSION, Request, Response, RpcError};

use crate::Engine;
use crate::automations::execution::{DispatchRefusal, InvocationReason};
use crate::automations::records::{
    Automation, AutomationRun, AutomationRunStatus, AutomationRunTrigger, SessionKind,
    WorkspaceMode,
};
use crate::automations::storage as automations_storage;
use crate::bots::policy::{
    self as bots_policy, ResponsibilityDispatchAttempt, ResponsibilityJobOutcome,
    ResponsibilityLookupError, ResponsibilityRefusal,
};
use crate::bots::records::{HostObservation, ResponsibilityRun, ResponsibilityTrigger};
use crate::bots::storage as bots_storage;

/// No mapping exists from `Bot::harness_policy` to `drogon_harness::HarnessId`
/// yet, so callers must resolve these explicitly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HarnessLaunchParams {
    pub harness_id: String,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub provider: Option<String>,
    pub permission_mode: Option<String>,
    /// Every run through this seam is a headless daemon run (`pi -p`,
    /// `claude -p`, `opencode run`, `codex exec`, `agy -p`): no TUI, no approval-answer
    /// surface. Always `true` on run paths; user-facing tabs never build
    /// this struct (they call `harness.start` directly, headless absent).
    pub headless: bool,
}

/// Daemon runs are headless by definition, so they must never inherit an
/// approval prompt. Keep the permission choice in one place for every
/// automation and Bot dispatch path.
pub(crate) fn headless_permission_mode() -> Option<String> {
    Some("unattended".to_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HarnessStarted {
    pub session_id: String,
    pub incarnation: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionObservation {
    pub verdict: String,
    pub exit_code: Option<i64>,
}

/// Real `RpcError` code/message, carried verbatim -- never fabricated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DispatchSeamError {
    pub code: String,
    pub message: String,
}

impl From<RpcError> for DispatchSeamError {
    fn from(value: RpcError) -> Self {
        Self {
            code: value.code,
            message: value.message,
        }
    }
}

impl std::fmt::Display for DispatchSeamError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for DispatchSeamError {}

/// One `harness.start` dispatch + one `session.read` poll; fakeable so
/// tests never spawn a real session.
pub trait DispatchSeam {
    fn harness_start(
        &self,
        request_id: &str,
        params: Value,
    ) -> Result<HarnessStarted, DispatchSeamError>;

    fn session_read(
        &self,
        session_id: &str,
        incarnation: &str,
    ) -> Result<SessionObservation, DispatchSeamError>;
}

/// Production seam: wraps `&Engine`'s already-`pub` `dispatch` -- no
/// lib.rs/protocol change was needed to build this.
pub struct EngineDispatchSeam<'a> {
    engine: &'a Engine,
}

impl<'a> EngineDispatchSeam<'a> {
    pub fn new(engine: &'a Engine) -> Self {
        Self { engine }
    }
}

impl DispatchSeam for EngineDispatchSeam<'_> {
    fn harness_start(
        &self,
        request_id: &str,
        params: Value,
    ) -> Result<HarnessStarted, DispatchSeamError> {
        let response = self.engine.dispatch(Request {
            protocol: PROTOCOL_VERSION,
            request_id: request_id.to_string(),
            auth: None,
            method: "harness.start".to_string(),
            params,
        });
        let result = ok_result(response)?;
        let session_id = result
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid_response("harness.start result missing id"))?
            .to_string();
        let incarnation = result
            .get("incarnation")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid_response("harness.start result missing incarnation"))?
            .to_string();
        Ok(HarnessStarted {
            session_id,
            incarnation,
        })
    }

    fn session_read(
        &self,
        session_id: &str,
        incarnation: &str,
    ) -> Result<SessionObservation, DispatchSeamError> {
        // Read-only, not ledger-admitted: a fresh id per poll is correct.
        let response = self.engine.dispatch(Request {
            protocol: PROTOCOL_VERSION,
            request_id: Uuid::new_v4().to_string(),
            auth: None,
            method: "session.read".to_string(),
            params: json!({
                "sessionId": session_id,
                "incarnation": incarnation,
                "limitBytes": 1,
            }),
        });
        let result = ok_result(response)?;
        let session = result
            .get("session")
            .ok_or_else(|| invalid_response("session.read result missing session"))?;
        let verdict = session
            .get("verdict")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid_response("session.read result missing verdict"))?
            .to_string();
        let exit_code = session.get("exitCode").and_then(Value::as_i64);
        Ok(SessionObservation { verdict, exit_code })
    }
}

fn ok_result(response: Response) -> Result<Value, DispatchSeamError> {
    if response.ok {
        response
            .result
            .ok_or_else(|| invalid_response("ok response missing result"))
    } else {
        Err(response
            .error
            .map(DispatchSeamError::from)
            .unwrap_or_else(|| invalid_response("failed response missing error")))
    }
}

fn invalid_response(message: &str) -> DispatchSeamError {
    DispatchSeamError {
        code: "invalid_response".to_string(),
        message: message.to_string(),
    }
}

/// A policy/data refusal this module can fully evaluate now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunRefusal {
    Responsibility(ResponsibilityRefusal),
    Automation(DispatchRefusal),
    MissingWorkspaceId,
    UnknownWorkspace(String),
    /// The workspace row's own `host_id`, independent of the automation's
    /// `execution_target_id` fence.
    ForeignWorkspaceHost {
        workspace_id: String,
        workspace_host_id: String,
        current_host_id: String,
    },
}

/// ROOT-owned wiring this module does not fabricate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunUnsupported {
    NewPerRunWorkspaceMode,
    ReactiveDispatchParamsNotWired,
}

/// Failure while preparing a plan.
#[derive(Debug)]
pub enum RunnerLookupError {
    Responsibility(ResponsibilityLookupError),
    /// Re-read disagreed with the eligibility decision on trigger kind --
    /// impossible under one transaction snapshot, but never asserted away.
    InconsistentTriggerKind,
}

impl From<ResponsibilityLookupError> for RunnerLookupError {
    fn from(value: ResponsibilityLookupError) -> Self {
        Self::Responsibility(value)
    }
}

impl From<rusqlite::Error> for RunnerLookupError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Responsibility(ResponsibilityLookupError::Storage(value.into()))
    }
}

impl std::fmt::Display for RunnerLookupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Responsibility(e) => write!(f, "{e}"),
            Self::InconsistentTriggerKind => {
                write!(
                    f,
                    "responsibility trigger kind changed within one read snapshot"
                )
            }
        }
    }
}

impl std::error::Error for RunnerLookupError {}

/// Outcome of a real seam dispatch; never fabricated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunnerOutcome {
    Observed {
        session_id: String,
        incarnation: String,
        verdict: String,
        exit_code: Option<i64>,
    },
    /// `harness.start` itself failed -- no session was ever admitted.
    DispatchFailed(DispatchSeamError),
    /// A session was admitted but `session.read` failed to observe it.
    ObservationFailed {
        session_id: String,
        incarnation: String,
        error: DispatchSeamError,
    },
}

/// Owned data an eligible run needs to dispatch + record. Holds no
/// `Connection`/seam reference by construction.
#[derive(Debug, Clone, PartialEq)]
pub struct RunPlan {
    pub host_id: String,
    pub folder: String,
    pub bot_id: String,
    pub responsibility_id: String,
    pub automation_id: String,
    pub request_id: String,
    pub params: Value,
    pub attempt_at: f64,
    /// Why this run was invoked, carried so [`record_run_outcome_in_tx`]
    /// can stamp the responsibility row's display invocation without
    /// re-deriving it. Not consulted by dispatch itself.
    pub reason: crate::automations::execution::InvocationReason,
}

/// Result of [`prepare_run_plan`].
#[derive(Debug, Clone, PartialEq)]
pub enum PrepareOutcome {
    Refused(RunRefusal),
    Unsupported(RunUnsupported),
    Ready(RunPlan),
}

/// Bound keeping the natural request-id form under `Request::validate`'s
/// 128-byte cap across all 5 components + delimiters + prefix.
const MAX_NATURAL_COMPONENT_LEN: usize = 18;

/// Excludes `:` (the natural form's delimiter), so concatenation can never
/// be ambiguous between differently-split components.
fn is_safe_natural_component(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= MAX_NATURAL_COMPONENT_LEN
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'/'))
}

/// Length-prefixes each component before hashing: without this, `"a:b"`+`"c"`
/// and `"a"`+`"b:c"` would hash identically.
fn hashed_request_id(components: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for component in components {
        let bytes = component.as_bytes();
        hasher.update((bytes.len() as u64).to_be_bytes());
        hasher.update(bytes);
    }
    format!("automation-run:hash:{:x}", hasher.finalize())
}

/// Deterministic `Engine.dispatch` idempotency key over the full
/// `(host_id, folder, bot_id, responsibility_id, event_identity)` tuple:
/// identical inputs always produce the identical id, so a retried
/// scheduler tick/manual invoke/reactive event reuses the same ledger
/// admission. Uses the readable natural form only when every component is
/// a validated fixed-format string; falls back to the hash form otherwise.
pub fn derive_request_id(
    host_id: &str,
    folder: &str,
    bot_id: &str,
    responsibility_id: &str,
    event_identity: &str,
) -> String {
    let components = [host_id, folder, bot_id, responsibility_id, event_identity];
    if components.iter().all(|c| is_safe_natural_component(c)) {
        let natural = format!(
            "automation-run:{host_id}:{folder}:{bot_id}:{responsibility_id}:{event_identity}"
        );
        if !natural.is_empty() && natural.len() <= 128 {
            return natural;
        }
    }
    hashed_request_id(&components)
}

fn read_workspace_host_id(
    conn: &Connection,
    workspace_id: &str,
) -> Result<Option<String>, bots_storage::StorageError> {
    Ok(conn
        .query_row(
            "SELECT host_id FROM workspaces WHERE id = ?1",
            [workspace_id],
            |r| r.get::<_, String>(0),
        )
        .optional()?)
}

fn build_harness_start_params(
    workspace_id: &str,
    prompt: &str,
    harness_params: &HarnessLaunchParams,
) -> Value {
    let mut params = json!({
        "workspaceId": workspace_id,
        "harnessId": harness_params.harness_id,
        "prompt": prompt,
    });
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

/// Phase 1 (read-only, one transaction snapshot): opens its own transaction,
/// delegates to [`prepare_run_plan_in_tx`], then drops (never commits) the
/// snapshot before returning -- no lock survives this call.
#[allow(clippy::too_many_arguments)]
pub fn prepare_run_plan(
    conn: &Connection,
    host_id: &str,
    folder: &str,
    bot_id: &str,
    responsibility_id: &str,
    current_host_id: &str,
    reason: &InvocationReason,
    event_identity: &str,
    harness_params: &HarnessLaunchParams,
    attempt_at: f64,
) -> Result<PrepareOutcome, RunnerLookupError> {
    let tx = conn.unchecked_transaction()?;
    let outcome = prepare_run_plan_in_tx(
        &tx,
        host_id,
        folder,
        bot_id,
        responsibility_id,
        current_host_id,
        reason,
        event_identity,
        harness_params,
        attempt_at,
    )?;
    // Every read is done; drop the (uncommitted, read-only) snapshot now,
    // before this function returns -- not after the caller drives dispatch.
    drop(tx);
    Ok(outcome)
}

/// Connection-bound body of [`prepare_run_plan`]: composes `bots::policy`/
/// `automations::execution` gating unchanged, then adds the workspace-row-
/// owner check beyond the automation's own `execution_target_id` fence.
/// Begins and ends no transaction of its own, so a caller that already
/// holds one open (e.g. a delegated request ledger's own admission
/// transaction, which cannot nest a second real `BEGIN`) can call this
/// directly.
#[allow(clippy::too_many_arguments)]
pub fn prepare_run_plan_in_tx(
    conn: &Connection,
    host_id: &str,
    folder: &str,
    bot_id: &str,
    responsibility_id: &str,
    current_host_id: &str,
    reason: &InvocationReason,
    event_identity: &str,
    harness_params: &HarnessLaunchParams,
    attempt_at: f64,
) -> Result<PrepareOutcome, RunnerLookupError> {
    let decision = bots_policy::evaluate_and_attempt_responsibility_dispatch_from_storage(
        conn,
        host_id,
        folder,
        bot_id,
        responsibility_id,
        current_host_id,
        reason,
    )?;

    let automation: Automation = match decision {
        ResponsibilityDispatchAttempt::RefusedByResponsibility(refusal) => {
            return Ok(PrepareOutcome::Refused(RunRefusal::Responsibility(refusal)));
        }
        ResponsibilityDispatchAttempt::RefusedByAutomation(refusal) => {
            return Ok(PrepareOutcome::Refused(RunRefusal::Automation(refusal)));
        }
        ResponsibilityDispatchAttempt::Dispatched(ResponsibilityJobOutcome::ReactiveReady) => {
            // The responsibility gate passed, but this context-free path
            // carries no outbox event to resolve a workspace and prompt
            // from — only the delegation drain (`bots::delegation`) does.
            // Refuse honestly rather than fabricating either.
            return Ok(PrepareOutcome::Unsupported(
                RunUnsupported::ReactiveDispatchParamsNotWired,
            ));
        }
        ResponsibilityDispatchAttempt::Dispatched(ResponsibilityJobOutcome::Automation(_)) => {
            // Eligibility is already proven; re-read only for the fields
            // (workspace_id/prompt) the stub `JobOutcome` never carried.
            let bot = bots_storage::get_bot(conn, host_id, folder, bot_id)
                .map_err(ResponsibilityLookupError::Storage)?
                .ok_or(ResponsibilityLookupError::BotNotFound)?;
            let responsibility = bot
                .responsibilities
                .iter()
                .find(|r| r.id == responsibility_id)
                .ok_or(ResponsibilityLookupError::ResponsibilityNotFound)?;
            let ResponsibilityTrigger::Scheduled { automation_id } = &responsibility.trigger else {
                return Err(RunnerLookupError::InconsistentTriggerKind);
            };
            bots_storage::require_owned_automation(conn, bot_id, automation_id)
                .map_err(ResponsibilityLookupError::Storage)?
        }
    };

    let workspace_id = match automation.workspace_mode {
        WorkspaceMode::NewPerRun => {
            return Ok(PrepareOutcome::Unsupported(
                RunUnsupported::NewPerRunWorkspaceMode,
            ));
        }
        WorkspaceMode::Existing => match &automation.workspace_id {
            Some(id) => id.clone(),
            None => return Ok(PrepareOutcome::Refused(RunRefusal::MissingWorkspaceId)),
        },
    };

    let workspace_host_id =
        read_workspace_host_id(conn, &workspace_id).map_err(ResponsibilityLookupError::Storage)?;
    let workspace_host_id = match workspace_host_id {
        Some(host) => host,
        None => {
            return Ok(PrepareOutcome::Refused(RunRefusal::UnknownWorkspace(
                workspace_id,
            )));
        }
    };
    if workspace_host_id != current_host_id {
        return Ok(PrepareOutcome::Refused(RunRefusal::ForeignWorkspaceHost {
            workspace_id,
            workspace_host_id,
            current_host_id: current_host_id.to_string(),
        }));
    }

    let request_id = derive_request_id(host_id, folder, bot_id, responsibility_id, event_identity);
    let params = build_harness_start_params(&workspace_id, &automation.prompt, harness_params);

    Ok(PrepareOutcome::Ready(RunPlan {
        host_id: host_id.to_string(),
        folder: folder.to_string(),
        bot_id: bot_id.to_string(),
        responsibility_id: responsibility_id.to_string(),
        automation_id: automation.id,
        request_id,
        params,
        attempt_at,
        reason: reason.clone(),
    }))
}

/// The dispatch-relevant projection of a run plan: the idempotency key and
/// the exact `harness.start` params. [`RunPlan`] and the bot-free
/// [`super::direct::DirectPlan`](crate::automations::direct::DirectPlan)
/// both satisfy this, so both dispatch through this one function -- the
/// seam call sequence is identical, never a parallel implementation.
pub trait DispatchPlan {
    fn request_id(&self) -> &str;
    fn params(&self) -> &Value;
}

impl DispatchPlan for RunPlan {
    fn request_id(&self) -> &str {
        &self.request_id
    }

    fn params(&self) -> &Value {
        &self.params
    }
}

/// Phase 2: takes no `Connection` -- the caller MUST have released its DB
/// guard before calling. Production call shape: lock only across
/// `prepare_run_plan`, drop it, call this, then re-lock for
/// `record_run_outcome`.
pub fn dispatch_run_plan<S: DispatchSeam, P: DispatchPlan + ?Sized>(
    seam: &S,
    plan: &P,
) -> RunnerOutcome {
    let started = match seam.harness_start(plan.request_id(), plan.params().clone()) {
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

/// The fields [`ObservationUpdate::from_outcome`] derives from a
/// [`RunnerOutcome`], before any merge-with-existing-row logic is applied.
struct ObservationUpdate {
    status: AutomationRunStatus,
    error: Option<String>,
    terminal_session_id: Option<String>,
    session_incarnation: Option<String>,
    exit_code: Option<i64>,
    /// The wall-clock time of *this* observation attempt -- the ACTUAL
    /// `session.read` call (successful or not), supplied by the caller via
    /// [`record_run_outcome`]'s own `observed_at` parameter, distinct from
    /// `plan.attempt_at`/`dispatched_at`. `None` for
    /// [`RunnerOutcome::DispatchFailed`], which never reached an observation
    /// at all.
    observed_at: Option<f64>,
    /// The wall-clock time `harness.start` was dispatched -- always
    /// `plan.attempt_at`, never the caller's `observed_at`.
    dispatched_at: Option<f64>,
}

impl ObservationUpdate {
    /// `"live"`/`"exited"` map to their status; any other reported verdict,
    /// or a failed poll after a real start, stays `Dispatched` -- a session
    /// was admitted and its terminal state is simply not yet proven, never
    /// synthesized as failed. A failed `harness.start` carries no session
    /// linkage at all, since none was ever admitted.
    fn from_outcome(outcome: &RunnerOutcome, dispatched_at: f64, observed_at: f64) -> Self {
        match outcome {
            RunnerOutcome::Observed {
                session_id,
                incarnation,
                verdict,
                exit_code,
            } => {
                let status = match verdict.as_str() {
                    "exited" => AutomationRunStatus::Completed,
                    _ => AutomationRunStatus::Dispatched,
                };
                Self {
                    status,
                    error: None,
                    terminal_session_id: Some(session_id.clone()),
                    session_incarnation: Some(incarnation.clone()),
                    exit_code: *exit_code,
                    observed_at: Some(observed_at),
                    dispatched_at: Some(dispatched_at),
                }
            }
            RunnerOutcome::ObservationFailed {
                session_id,
                incarnation,
                error,
            } => Self {
                status: AutomationRunStatus::Dispatched,
                error: Some(error.to_string()),
                terminal_session_id: Some(session_id.clone()),
                session_incarnation: Some(incarnation.clone()),
                exit_code: None,
                observed_at: Some(observed_at),
                dispatched_at: Some(dispatched_at),
            },
            RunnerOutcome::DispatchFailed(error) => Self {
                status: AutomationRunStatus::DispatchFailed,
                error: Some(error.to_string()),
                terminal_session_id: None,
                session_incarnation: None,
                exit_code: None,
                observed_at: None,
                dispatched_at: None,
            },
        }
    }
}

/// Explicit result of [`upsert_linked_automation_run_in_tx`]'s
/// read-modify-write decision, carried alongside the accepted row so
/// [`record_run_outcome`] can decide what to project into the
/// `ResponsibilityRun` write WITHOUT re-deriving it from the raw incoming
/// `outcome` -- see [`RejectedStale`](Self::RejectedStale) for the
/// regression this replaces.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AcceptedOutcome {
    /// No existing row (a first insert), or an existing non-terminal row
    /// legitimately merged with this observation.
    AcceptedNew,
    /// The existing row already proved `Completed` (a real exit was
    /// observed); it is terminal and returned completely unchanged.
    KeptExisting,
    /// The incoming observation's `observed_at` is older than the existing
    /// (non-terminal) row's -- an out-of-order replay. The existing row is
    /// returned completely unchanged, and the caller must project the
    /// responsibility row from that SAME existing state, never from this
    /// call's own rejected `outcome`.
    RejectedStale,
}

/// Read-modify-write upsert of the linked `AutomationRun` (id
/// `ar:{request_id}`), taking an already-open transaction/connection and
/// never beginning or committing one of its own -- see [`record_run_outcome`]
/// for why this and the responsibility-run write now share exactly one
/// `BEGIN IMMEDIATE` (V4-A5c).
///
/// Two cases are a deliberate no-op (the row is read back and returned
/// unchanged, nothing is written) -- both reported via [`AcceptedOutcome`]
/// rather than left for the caller to re-infer from `automation_run.status`:
/// - [`AcceptedOutcome::KeptExisting`]: the existing row already proved
///   `Completed` (a real exit was observed) -- that is terminal and is
///   never regressed by a later stale/unverifiable observation for the
///   same incarnation, since this build's deterministic `request_id`
///   always re-admits the same session;
/// - [`AcceptedOutcome::RejectedStale`]: the incoming observation's
///   `observed_at` is older than the existing (non-terminal) row's -- an
///   out-of-order replay, rejected without error.
///
/// Session fence: if the existing row already carries a
/// `(terminal_session_id, session_incarnation)` linkage and this
/// observation's own linkage is both present and DIFFERENT, the whole call
/// fails with [`bots_storage::StorageError::OwnershipViolation`] rather
/// than silently overwriting it -- the same `request_id` (and so the same
/// `ar:{request_id}` row) must never be re-linked to a different session
/// incarnation.
///
/// Every other field this build does not interpret here (`title`,
/// `trigger`, `scheduled_for`, `occurrence_count`, `last_occurrence_at`,
/// ...) is preserved byte-for-byte from the existing row via struct-update
/// syntax; only a first insert ever assigns them, and even then
/// `occurrence_count`/`last_occurrence_at` are left `None` -- this module
/// has no proven source for what they should mean, so it never guesses.
fn upsert_linked_automation_run_in_tx(
    conn: &Connection,
    automation_run_id: &str,
    plan: &RunPlan,
    outcome: &RunnerOutcome,
    observed_at: f64,
) -> Result<(AutomationRun, AcceptedOutcome), bots_storage::StorageError> {
    let existing = automations_storage::get_automation_run(conn, automation_run_id)?;
    let observation = ObservationUpdate::from_outcome(outcome, plan.attempt_at, observed_at);

    let result = match existing {
        None => {
            let fresh = AutomationRun {
                id: automation_run_id.to_string(),
                automation_id: plan.automation_id.clone(),
                run_context: None,
                source_context: None,
                // Not carried by `RunPlan` (phase 1 never resolves a
                // display title here) -- absent, never fabricated.
                title: String::new(),
                scheduled_for: plan.attempt_at,
                status: observation.status,
                // Every `RunPlan` this function ever receives originates
                // from a `ResponsibilityTrigger::Scheduled` responsibility
                // (`prepare_run_plan` proves this before returning `Ready`);
                // `AutomationRunTrigger` has no third value for a manual
                // "run now" invocation of that same scheduled automation,
                // a known, disclosed modeling gap this module does not
                // paper over with fabricated certainty either way.
                trigger: AutomationRunTrigger::Scheduled,
                workspace_id: None,
                workspace_display_name: None,
                session_kind: SessionKind::Terminal,
                chat_session_id: None,
                terminal_session_id: observation.terminal_session_id.clone(),
                terminal_pane_key: None,
                terminal_pty_id: None,
                output_snapshot: None,
                precheck_result: None,
                usage: None,
                error: observation.error.clone(),
                started_at: observation.dispatched_at,
                dispatched_at: observation.dispatched_at,
                created_at: plan.attempt_at,
                // Fork parity: the ordinal is assigned once, here at
                // creation (the fork's `nextAutomationRunNumber`), never
                // on the merge/replay path below.
                run_number: Some(automations_storage::next_automation_run_number(
                    conn,
                    &plan.automation_id,
                )?),
                occurrence_count: None,
                last_occurrence_at: None,
                session_incarnation: observation.session_incarnation.clone(),
                exit_code: observation.exit_code,
                observed_at: observation.observed_at,
            };
            automations_storage::upsert_automation_run(conn, &fresh)?;
            (fresh, AcceptedOutcome::AcceptedNew)
        }
        Some(existing) => {
            if let (Some(existing_sid), Some(existing_inc)) =
                (&existing.terminal_session_id, &existing.session_incarnation)
                && let (Some(incoming_sid), Some(incoming_inc)) = (
                    &observation.terminal_session_id,
                    &observation.session_incarnation,
                )
                && (existing_sid != incoming_sid || existing_inc != incoming_inc)
            {
                return Err(bots_storage::StorageError::OwnershipViolation(
                    "automation run's existing session linkage does not match this \
                     observation's session/incarnation for the same request id",
                ));
            }
            if existing.status == AutomationRunStatus::Completed {
                (existing, AcceptedOutcome::KeptExisting)
            } else {
                let is_stale = match (observation.observed_at, existing.observed_at) {
                    (Some(incoming), Some(recorded)) => incoming < recorded,
                    _ => false,
                };
                if is_stale {
                    (existing, AcceptedOutcome::RejectedStale)
                } else {
                    let merged = AutomationRun {
                        status: observation.status,
                        error: observation.error.clone(),
                        terminal_session_id: observation
                            .terminal_session_id
                            .clone()
                            .or(existing.terminal_session_id.clone()),
                        session_incarnation: observation
                            .session_incarnation
                            .clone()
                            .or(existing.session_incarnation.clone()),
                        exit_code: observation.exit_code.or(existing.exit_code),
                        observed_at: observation.observed_at.or(existing.observed_at),
                        // The FIRST dispatch time is frozen forever: existing
                        // wins whenever it is already `Some`, never rewritten by
                        // a later replay's own attempt time.
                        dispatched_at: existing.dispatched_at.or(observation.dispatched_at),
                        ..existing
                    };
                    automations_storage::upsert_automation_run(conn, &merged)?;
                    (merged, AcceptedOutcome::AcceptedNew)
                }
            }
        }
    };
    Ok(result)
}

/// Projects the durable `ResponsibilityRun.host_observation`/`ended_at`
/// pair from the ACCEPTED `AutomationRun` row [`upsert_linked_automation_run_in_tx`]
/// just returned -- never straight from the raw incoming `outcome`. That
/// row's own terminal guard already refuses to regress a proven
/// `Completed` (real exit observed) with a later stale/unverifiable
/// replay for the same incarnation; this function only ever reads its
/// result, so a stored `Completed` row can never project back to `Live`
/// (or to an `ended_at`-less `Unverifiable`) here either -- both stay
/// `Exited`, with `ended_at` taken from that same accepted row's
/// `observed_at`, regardless of what the current call's own `outcome`
/// happened to report. `DispatchFailed` never admitted a session, so its
/// `ended_at` is the row's own frozen `created_at`, not this call's
/// `plan.attempt_at`. Only when the accepted row is still non-terminal
/// (`Dispatched`) does the current `outcome`'s own verdict decide
/// `Live`/`Exited`/`Unverifiable`.
///
/// [`record_run_outcome`] never calls this at all when
/// [`upsert_linked_automation_run_in_tx`] reports
/// [`AcceptedOutcome::RejectedStale`]: that case has no ACCEPTED row to
/// project from (the existing row was correctly left untouched), so the
/// only correct projection is "none" -- the existing `ResponsibilityRun`
/// stays byte-identical, never re-derived from this call's own rejected
/// `outcome` (the regression V4-A5c fixes for non-terminal rows).
/// Maps an invocation reason onto the responsibility row's display
/// invocation: only a scheduler-due fire is scheduled; every explicit
/// `bot.run` call (manual or a supplied reactive event) is manual.
fn invocation_of(
    reason: &crate::automations::execution::InvocationReason,
) -> crate::bots::records::ResponsibilityRunInvocation {
    match reason {
        crate::automations::execution::InvocationReason::ScheduledDue => {
            crate::bots::records::ResponsibilityRunInvocation::Scheduled
        }
        _ => crate::bots::records::ResponsibilityRunInvocation::Manual,
    }
}

pub(crate) fn responsibility_projection(
    automation_run: &AutomationRun,
    outcome: &RunnerOutcome,
) -> (Option<HostObservation>, Option<f64>) {
    match automation_run.status {
        AutomationRunStatus::Completed => {
            (Some(HostObservation::Exited), automation_run.observed_at)
        }
        AutomationRunStatus::DispatchFailed => (None, Some(automation_run.created_at)),
        _ => match outcome {
            RunnerOutcome::Observed { verdict, .. } => match verdict.as_str() {
                "live" => (Some(HostObservation::Live), None),
                "exited" => (Some(HostObservation::Exited), automation_run.observed_at),
                _ => (Some(HostObservation::Unverifiable), None),
            },
            RunnerOutcome::ObservationFailed { .. } => (Some(HostObservation::Unverifiable), None),
            RunnerOutcome::DispatchFailed(_) => (None, Some(automation_run.created_at)),
        },
    }
}

/// Phase 3: opens its own `BEGIN IMMEDIATE`, delegates to
/// [`record_run_outcome_in_tx`], then commits once at the end -- both
/// durable writes land together or not at all.
pub fn record_run_outcome(
    conn: &Connection,
    plan: &RunPlan,
    outcome: &RunnerOutcome,
    observed_at: f64,
) -> Result<(), bots_storage::StorageError> {
    let tx = automations_storage::begin_immediate(conn)?;
    record_run_outcome_in_tx(&tx, plan, outcome, observed_at)?;
    tx.commit()?;
    Ok(())
}

/// Connection-bound body of [`record_run_outcome`]: durable record via
/// existing responsibility-run history storage, linked to a durably
/// upserted `AutomationRun` at the stable id `ar:{request_id}` (see
/// [`upsert_linked_automation_run_in_tx`]). `host_observation`/`ended_at`
/// are derived from that ACCEPTED row by [`responsibility_projection`],
/// never fabricated from the raw `outcome` directly -- see its doc for the
/// terminal-guard rationale. `observed_at` is the ACTUAL wall-clock time of
/// this `session.read` (or failed-poll) call, supplied by the caller and
/// distinct from `plan.attempt_at` (the dispatch attempt time); it is only
/// ever used when this call's observation is the one accepted.
///
/// Begins and commits no transaction of its own (V4-A6d): a caller that
/// already holds one open (e.g. a delegated request ledger's own finalize
/// transaction) calls this directly so the run rows and that transaction's
/// own receipt write commit atomically together. [`record_run_outcome`]'s
/// owned `BEGIN IMMEDIATE`/commit around this body is what gives the V4-A5c
/// atomicity guarantee (both durable writes -- the linked `AutomationRun`
/// upsert and the `ResponsibilityRun` record -- share exactly ONE
/// transaction; any failure on either write, including the session fence in
/// [`upsert_linked_automation_run_in_tx`], rolls both back together rather
/// than leaving the first write durably committed while the second silently
/// never happens) for that owned caller, and an embedding caller's own
/// transaction gives the identical guarantee when it wraps this function
/// instead. When the upsert reports [`AcceptedOutcome::RejectedStale`], the
/// `ResponsibilityRun` write is skipped entirely -- the existing row is left
/// exactly as it was, never regressed by a projection built from this
/// call's own rejected `outcome`.
pub fn record_run_outcome_in_tx(
    conn: &Connection,
    plan: &RunPlan,
    outcome: &RunnerOutcome,
    observed_at: f64,
) -> Result<(), bots_storage::StorageError> {
    let automation_run_id = format!("ar:{}", plan.request_id);
    let (automation_run, accepted) =
        upsert_linked_automation_run_in_tx(conn, &automation_run_id, plan, outcome, observed_at)?;

    if accepted != AcceptedOutcome::RejectedStale {
        let (host_observation, ended_at) = responsibility_projection(&automation_run, outcome);
        let run = ResponsibilityRun {
            id: plan.request_id.clone(),
            bot_id: plan.bot_id.clone(),
            responsibility_id: plan.responsibility_id.clone(),
            automation_id: Some(plan.automation_id.clone()),
            automation_run_id: Some(automation_run.id.clone()),
            started_at: plan.attempt_at,
            ended_at,
            recipe: None,
            host_observation,
            invocation: Some(invocation_of(&plan.reason)),
        };
        bots_storage::record_responsibility_run_in_tx(conn, &plan.host_id, &plan.folder, run)?;
    }

    Ok(())
}
