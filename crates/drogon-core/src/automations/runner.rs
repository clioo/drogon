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
    params
}

/// Phase 1 (read-only, one transaction snapshot): composes `bots::policy`/
/// `automations::execution` gating unchanged, then adds the workspace-row-
/// owner check beyond the automation's own `execution_target_id` fence.
/// The transaction is dropped (never committed) before returning -- no
/// lock survives this call.
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

    let decision = bots_policy::evaluate_and_attempt_responsibility_dispatch_from_storage(
        &tx,
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
        ResponsibilityDispatchAttempt::Dispatched(
            ResponsibilityJobOutcome::UnsupportedReactiveDispatch,
        ) => {
            return Ok(PrepareOutcome::Unsupported(
                RunUnsupported::ReactiveDispatchParamsNotWired,
            ));
        }
        ResponsibilityDispatchAttempt::Dispatched(ResponsibilityJobOutcome::Automation(_)) => {
            // Eligibility is already proven; re-read only for the fields
            // (workspace_id/prompt) the stub `JobOutcome` never carried.
            let bot = bots_storage::get_bot(&tx, host_id, folder, bot_id)
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
            bots_storage::require_owned_automation(&tx, bot_id, automation_id)
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
        read_workspace_host_id(&tx, &workspace_id).map_err(ResponsibilityLookupError::Storage)?;
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

    // Every read is done; drop the (uncommitted, read-only) snapshot now,
    // before this function returns -- not after the caller drives dispatch.
    drop(tx);

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
    }))
}

/// Phase 2: takes no `Connection` -- the caller MUST have released its DB
/// guard before calling. Production call shape: lock only across
/// `prepare_run_plan`, drop it, call this, then re-lock for
/// `record_run_outcome`.
pub fn dispatch_run_plan<S: DispatchSeam>(seam: &S, plan: &RunPlan) -> RunnerOutcome {
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

/// The fields [`ObservationUpdate::from_outcome`] derives from a
/// [`RunnerOutcome`], before any merge-with-existing-row logic is applied.
struct ObservationUpdate {
    status: AutomationRunStatus,
    error: Option<String>,
    terminal_session_id: Option<String>,
    session_incarnation: Option<String>,
    exit_code: Option<i64>,
    /// The wall-clock time of *this* observation attempt (the `session.read`
    /// call, successful or not) -- `None` for [`RunnerOutcome::DispatchFailed`],
    /// which never reached an observation at all.
    observed_at: Option<f64>,
    dispatched_at: Option<f64>,
}

impl ObservationUpdate {
    /// `"live"`/`"exited"` map to their status; any other reported verdict,
    /// or a failed poll after a real start, stays `Dispatched` -- a session
    /// was admitted and its terminal state is simply not yet proven, never
    /// synthesized as failed. A failed `harness.start` carries no session
    /// linkage at all, since none was ever admitted.
    fn from_outcome(outcome: &RunnerOutcome, attempt_at: f64) -> Self {
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
                    observed_at: Some(attempt_at),
                    dispatched_at: Some(attempt_at),
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
                observed_at: Some(attempt_at),
                dispatched_at: Some(attempt_at),
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

/// Read-modify-write upsert of the linked `AutomationRun` (id `ar:{request_id}`)
/// against a real `BEGIN IMMEDIATE` transaction, so a concurrent replay of
/// the same event is serialized rather than racing a read against a write.
///
/// Two cases are a deliberate no-op (the row is read back and returned
/// unchanged, nothing is written):
/// - the existing row already proved `Completed` (a real exit was
///   observed) -- that is terminal and is never regressed by a later
///   stale/unverifiable observation for the same incarnation, since this
///   build's deterministic `request_id` always re-admits the same session;
/// - the incoming observation's `observed_at` is older than the existing
///   row's -- an out-of-order replay, rejected without error.
///
/// Every other field this build does not interpret here (`title`,
/// `trigger`, `scheduled_for`, `occurrence_count`, `last_occurrence_at`,
/// ...) is preserved byte-for-byte from the existing row via struct-update
/// syntax; only a first insert ever assigns them, and even then
/// `occurrence_count`/`last_occurrence_at` are left `None` -- this module
/// has no proven source for what they should mean, so it never guesses.
fn upsert_linked_automation_run(
    conn: &Connection,
    automation_run_id: &str,
    plan: &RunPlan,
    outcome: &RunnerOutcome,
) -> Result<AutomationRun, automations_storage::StorageError> {
    let tx = automations_storage::begin_immediate(conn)?;
    let existing = automations_storage::get_automation_run(&tx, automation_run_id)?;
    let observation = ObservationUpdate::from_outcome(outcome, plan.attempt_at);

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
                run_number: None,
                occurrence_count: None,
                last_occurrence_at: None,
                session_incarnation: observation.session_incarnation.clone(),
                exit_code: observation.exit_code,
                observed_at: observation.observed_at,
            };
            automations_storage::upsert_automation_run(&tx, &fresh)?;
            fresh
        }
        Some(existing) if existing.status == AutomationRunStatus::Completed => existing,
        Some(existing) => {
            let is_stale = match (observation.observed_at, existing.observed_at) {
                (Some(incoming), Some(recorded)) => incoming < recorded,
                _ => false,
            };
            if is_stale {
                existing
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
                    dispatched_at: observation.dispatched_at.or(existing.dispatched_at),
                    ..existing
                };
                automations_storage::upsert_automation_run(&tx, &merged)?;
                merged
            }
        }
    };
    tx.commit()?;
    Ok(result)
}

/// Phase 3: durable record via existing responsibility-run history storage,
/// linked to a durably upserted `AutomationRun` at the stable id
/// `ar:{request_id}` (see [`upsert_linked_automation_run`]). `"live"`/
/// `"exited"` map to their `HostObservation`; anything else reported, or a
/// failed poll after a real start, is `Unverifiable` -- never a synthesized
/// guess. A failed `harness.start` has no observation at all, since no
/// session was ever admitted.
pub fn record_run_outcome(
    conn: &Connection,
    plan: &RunPlan,
    outcome: &RunnerOutcome,
) -> Result<(), bots_storage::StorageError> {
    let (host_observation, ended_at) = match outcome {
        RunnerOutcome::Observed { verdict, .. } => match verdict.as_str() {
            "live" => (Some(HostObservation::Live), None),
            "exited" => (Some(HostObservation::Exited), Some(plan.attempt_at)),
            _ => (Some(HostObservation::Unverifiable), None),
        },
        RunnerOutcome::ObservationFailed { .. } => (Some(HostObservation::Unverifiable), None),
        RunnerOutcome::DispatchFailed(_) => (None, Some(plan.attempt_at)),
    };

    let automation_run_id = format!("ar:{}", plan.request_id);
    let automation_run = upsert_linked_automation_run(conn, &automation_run_id, plan, outcome)?;

    let run = ResponsibilityRun {
        id: plan.request_id.clone(),
        bot_id: plan.bot_id.clone(),
        responsibility_id: plan.responsibility_id.clone(),
        automation_id: Some(plan.automation_id.clone()),
        automation_run_id: Some(automation_run.id),
        started_at: plan.attempt_at,
        ended_at,
        recipe: None,
        host_observation,
    };
    bots_storage::record_responsibility_run(conn, &plan.host_id, &plan.folder, run)?;
    Ok(())
}
