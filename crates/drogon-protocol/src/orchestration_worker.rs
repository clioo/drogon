//! Worker attempt wire types:
//! `orchestration.workerStart/workerShow/workerRead/workerStop/workerAbandon/workerRelease/workerRetain`.
//! Coordinator authority with fence-before-effects. Shape validation only; the
//! engine owns admission, process handles and liveness evidence.

use crate::RpcError;
use crate::orchestration_common::{
    AssignmentState, AttemptFailure, LaunchPreferences, OpaqueCursor, ProcessVerdict,
    ReadinessObservation, ReportOutcome, ResidualResource, ResourceDisposition, ResourceEffect,
    SessionIdentity, validate_opaque_token, validate_page_limit, validate_short_label,
    validate_task_text,
};
use crate::orchestration_scope::CoordinatorScope;
use serde::{Deserialize, Serialize};

/// Why: native workerStart places execution in a workspace the host already
/// registered. Worktree/folder creation happens through the workspace APIs
/// before the call; until that composition exists the engine answers with an
/// explicit unsupported-feature error before effects (source worktree CLI
/// flags remain a deferred parity obligation, tracked in the freeze proposal).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerPlacement {
    /// Registered workspace id. Registered folders and Git worktrees are both
    /// valid; the id must already exist on the selected host.
    pub workspace_id: String,
}

impl WorkerPlacement {
    pub fn validate_shape(&self) -> Result<(), RpcError> {
        validate_short_label(&self.workspace_id)
    }
}

/// Execution mode, explicit either way: a fresh attempt with launch
/// preferences, or an explicit reuse of an exact existing session. There is
/// no implicit cleanup ownership and no implicit reattachment in either mode.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WorkerExecution {
    Fresh { launch: LaunchPreferences },
    Reuse { session_identity: SessionIdentity },
}

impl WorkerExecution {
    pub fn validate_shape(&self) -> Result<(), RpcError> {
        match self {
            WorkerExecution::Fresh { launch } => validate_launch_preferences(launch),
            WorkerExecution::Reuse { session_identity } => session_identity.validate_shape(),
        }
    }
}

/// Coordinator creates exactly one attempt for a task. Replacement is explicit:
/// `retryOf` must name the latest failed/stopped/abandoned attempt being
/// replaced — never an auto-respawn; the prior attempt is fenced. The selected
/// execution host is the scope's `hostId` (source: `--on <host>`).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerStartParams {
    #[serde(flatten)]
    pub scope: CoordinatorScope,
    pub task_id: String,
    #[serde(flatten)]
    pub placement: WorkerPlacement,
    #[serde(flatten)]
    pub execution: WorkerExecution,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// Per-attempt budget hint in milliseconds; not a kill deadline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u32>,
    /// Prior attempt being explicitly replaced (source: `retryOf`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_of: Option<String>,
}

impl WorkerStartParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(execution_host_id)?;
        validate_opaque_token(&self.task_id, 128, "Invalid task id.")?;
        self.placement.validate_shape()?;
        self.execution.validate_shape()?;
        if let Some(name) = &self.display_name {
            validate_task_text(name, 512, "Invalid worker display name.")?;
        }
        if let Some(comment) = &self.comment {
            validate_task_text(comment, 8192, "Invalid worker comment.")?;
        }
        if let Some(retry_of) = &self.retry_of {
            validate_opaque_token(retry_of, 128, "Invalid retry reference.")?;
        }
        Ok(())
    }
}

/// Validates launch preference values with the same bounds as the harness
/// adapter (no empty/flag-shaped/control values; executable is host-supplied).
pub fn validate_launch_preferences(preferences: &LaunchPreferences) -> Result<(), RpcError> {
    validate_short_label(&preferences.harness_id)?;
    for value in [
        &preferences.model,
        &preferences.effort,
        &preferences.provider,
    ]
    .into_iter()
    .flatten()
    {
        if value.is_empty()
            || value.len() > 512
            || value.chars().any(char::is_control)
            || value.starts_with('-')
        {
            return Err(RpcError::new(
                "invalid_argument",
                "Invalid launch preference.",
            ));
        }
    }
    Ok(())
}

/// Result of creating one attempt. The three evidence axes are independent on
/// purpose: `assignmentState` (lifecycle), `readiness` (preamble/worker
/// observation) and `processVerdict` (exactly live/unverifiable/exited). For
/// a prompt-observation failure the result carries `assignmentState: failed`
/// with `failure.code = "agent_prompt_stalled"`, readiness unverified, and
/// the credential retained (root decision a1d2073).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerStartResult {
    pub run_id: String,
    pub task_id: String,
    pub dispatch_id: String,
    /// Coordinator generation fence after this mutation.
    pub consumer_generation: u64,
    /// Exact placement used, for recovery and inspection.
    pub workspace_id: String,
    pub assignment_state: AssignmentState,
    pub readiness: ReadinessObservation,
    pub process_verdict: ProcessVerdict,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_identity: Option<SessionIdentity>,
    #[serde(default)]
    pub effects: Vec<ResourceEffect>,
    #[serde(default)]
    pub residual_resources: Vec<ResidualResource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<AttemptFailure>,
    /// Honest warning text (source: reveal warning, Structured Chat guidance).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

/// Coordinator read of one attempt.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerShowParams {
    #[serde(flatten)]
    pub scope: CoordinatorScope,
    pub dispatch_id: String,
}

impl WorkerShowParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(execution_host_id)?;
        validate_opaque_token(&self.dispatch_id, 128, "Invalid dispatch id.")
    }
}

/// Coordinator read of one attempt, including exact owned session identity
/// and reported outcome (`outcome: None` means nothing settled yet — a
/// prompt-observation failure does not report an outcome).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerShowResult {
    pub dispatch_id: String,
    pub task_id: String,
    pub assignment_state: AssignmentState,
    pub readiness: ReadinessObservation,
    pub process_verdict: ProcessVerdict,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<ReportOutcome>,
    /// Original task-authored final-report metadata; absent on older hosts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub report_result: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_identity: Option<SessionIdentity>,
    /// As accepted, not as argv; argv never leaves the engine.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub launch: Option<LaunchPreferences>,
    #[serde(default)]
    pub residual_resources: Vec<ResidualResource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<AttemptFailure>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

impl WorkerShowResult {
    pub fn validate_shape(&self) -> Result<(), RpcError> {
        validate_opaque_token(&self.dispatch_id, 128, "Invalid dispatch id.")?;
        validate_opaque_token(&self.task_id, 128, "Invalid task id.")
    }
}

/// Worker output source. `auto` lets the engine pick its default stream;
/// explicit selection pins terminal or transcript (source: `--source`).
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OutputSource {
    #[default]
    Auto,
    Terminal,
    Transcript,
}

/// Bounded output read with opaque cursors. Source anchor: `workerRead`
/// accepts the initial zero cursor and opaque source-pinned cursors; here the
/// initial read is the absent cursor and every returned cursor stays opaque.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerReadParams {
    #[serde(flatten)]
    pub scope: CoordinatorScope,
    pub dispatch_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<OpaqueCursor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(default)]
    pub source: OutputSource,
}

impl WorkerReadParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(execution_host_id)?;
        validate_opaque_token(&self.dispatch_id, 128, "Invalid dispatch id.")?;
        if let Some(cursor) = &self.cursor {
            cursor.validate()?;
        }
        validate_page_limit(self.limit)
    }
}

/// One output entry. `content` is worker-authored material (terminal bytes or
/// transcript messages) — the explicitly allowed task-authored JSON exception.
/// `sourceIdentity` names the exact stream/session the entry came from (no PTY
/// ownership implied); `fallbackReason` explains any degraded source.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputEntry {
    /// Database/sequence position; monotonic within the stream.
    pub sequence: u64,
    pub source_identity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback_reason: Option<String>,
    pub content: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerReadResult {
    pub dispatch_id: String,
    pub source: OutputSource,
    pub process_verdict: ProcessVerdict,
    #[serde(default)]
    pub entries: Vec<OutputEntry>,
    /// Continuation token; absent/None means end of the currently retained
    /// stream. Cursor-pinned: entries never straddle a returned cursor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<OpaqueCursor>,
}

/// What the engine actually did to the process. `none` is the honest outcome
/// when the assignment was fenced without closing an unsupervised process.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProcessAction {
    /// A signal was sent to the exact owned handle.
    Signalled,
    /// No signal was sent (not owned, already fenced, retained process).
    #[default]
    None,
    /// The engine cannot currently prove what happened.
    Unverifiable,
}

/// Stop commits its fence before attempting any process operation; response
/// loss cannot undo the fence. Repeated stop joins the owned operation. The
/// process verdict is reported separately from the action taken.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerStopParams {
    #[serde(flatten)]
    pub scope: CoordinatorScope,
    pub dispatch_id: String,
}

impl WorkerStopParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(execution_host_id)?;
        validate_opaque_token(&self.dispatch_id, 128, "Invalid dispatch id.")
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerStopResult {
    pub dispatch_id: String,
    pub assignment_state: AssignmentState,
    pub process_action: ProcessAction,
    pub process_verdict: ProcessVerdict,
    #[serde(default)]
    pub residual_resources: Vec<ResidualResource>,
    /// Source: retained unsupervised terminal produces an explicit warning.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

/// Abandon releases coordinator attachment without ever signalling the
/// process, so the result carries no process action at all: there is no
/// signal pathway to report. Residual resources capture the exact retained
/// identity (or honest unverifiable disposition) instead.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerAbandonParams {
    #[serde(flatten)]
    pub scope: CoordinatorScope,
    pub dispatch_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl WorkerAbandonParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(execution_host_id)?;
        validate_opaque_token(&self.dispatch_id, 128, "Invalid dispatch id.")?;
        if let Some(reason) = &self.reason {
            validate_task_text(reason, 2048, "Invalid abandon reason.")?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerAbandonResult {
    pub dispatch_id: String,
    pub assignment_state: AssignmentState,
    #[serde(default)]
    pub residual_resources: Vec<ResidualResource>,
}

/// Release joins/replays the owned release operation only after settlement; it
/// cannot target a reused terminal. Honest dispositions cover retained and
/// no-owned-resource outcomes (contract: an existing external terminal is not
/// implicitly cleanup-owned).
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerReleaseParams {
    #[serde(flatten)]
    pub scope: CoordinatorScope,
    pub dispatch_id: String,
}

impl WorkerReleaseParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(execution_host_id)?;
        validate_opaque_token(&self.dispatch_id, 128, "Invalid dispatch id.")
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerReleaseResult {
    pub dispatch_id: String,
    pub disposition: ResourceDisposition,
    /// Source-compatible release state: `released`, `already_released`,
    /// `release_pending`, `release_unknown`, or `retained` (nothing owned to
    /// release). `disposition` alone cannot distinguish pending from unknown.
    #[serde(default)]
    pub state: String,
    pub process_verdict: ProcessVerdict,
    /// Source compatibility: the engine never signals on release-unknown
    /// paths beyond the owned handle, and there is no archive implementation
    /// yet, so this is honestly `none` / `null`.
    #[serde(default)]
    pub process_action: ProcessAction,
    #[serde(default)]
    pub archive: Option<serde_json::Value>,
    #[serde(default)]
    pub residual_resources: Vec<ResidualResource>,
}

/// Terminal resource state exposed by `orchestration.workerList`; process
/// accounting, never task/dispatch outcome. Source:
/// `worker-terminal-ownership.ts` (`WorkerTerminalListState`).
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerTerminalListState {
    Active,
    Reclaimable,
    Retained,
    ReleasePending,
    ReleaseUnknown,
    Released,
}

impl WorkerTerminalListState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Reclaimable => "reclaimable",
            Self::Retained => "retained",
            Self::ReleasePending => "release_pending",
            Self::ReleaseUnknown => "release_unknown",
            Self::Released => "released",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "active" => Some(Self::Active),
            "reclaimable" => Some(Self::Reclaimable),
            "retained" => Some(Self::Retained),
            "release_pending" => Some(Self::ReleasePending),
            "release_unknown" => Some(Self::ReleaseUnknown),
            "released" => Some(Self::Released),
            _ => None,
        }
    }
}

/// Host-scoped read-only listing of worker attempts. Unlike the other worker
/// verbs there is no coordinator binding: `run` optionally narrows to one
/// run (without it all runs on the host are listed, never a current-run
/// guess) and `terminal_state` optionally filters the six terminal states.
/// Counts are computed over the run-selected rows before the terminal-state
/// filter. No effects, no receipts.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerListParams {
    #[serde(flatten)]
    pub host: crate::orchestration_scope::HostScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal_state: Option<WorkerTerminalListState>,
}

impl WorkerListParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.host.validate_target(execution_host_id)?;
        if let Some(run) = &self.run {
            validate_opaque_token(run, 128, "Invalid run id.")?;
        }
        Ok(())
    }
}

/// Source-mapped per-row fields (`worker-terminal-listing.ts`
/// `listWorkerTerminalResources`): `worker_state` (`WorkerDispatchState`,
/// never `unsupervised` here since every row is a durable attempt),
/// `dispatch_status` (`DispatchStatus`), and `agent_terminal_handle` (the
/// attempt's proven session id, or `None` when the spawn never proved one).
/// `terminal_state` is `None` only when the engine holds no terminal
/// evidence at all (source `deriveWorkerTerminalListState` null case).
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerDispatchListState {
    Starting,
    Ready,
    StartUnknown,
    Failed,
    Succeeded,
    Stopping,
    StopUnknown,
    Stopped,
    Abandoned,
}

impl WorkerDispatchListState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Starting => "starting",
            Self::Ready => "ready",
            Self::StartUnknown => "start_unknown",
            Self::Failed => "failed",
            Self::Succeeded => "succeeded",
            Self::Stopping => "stopping",
            Self::StopUnknown => "stop_unknown",
            Self::Stopped => "stopped",
            Self::Abandoned => "abandoned",
        }
    }
}

/// Source `DispatchStatus` for `orchestration.workerList` rows.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DispatchListStatus {
    Pending,
    Dispatched,
    Completed,
    Failed,
    CircuitBroken,
}

impl DispatchListStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Dispatched => "dispatched",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::CircuitBroken => "circuit_broken",
        }
    }
}

/// One listed attempt: immutable attempt identity plus the three independent
/// evidence axes (assignment lifecycle, reported outcome, physical process
/// verdict) and the durable terminal resource state. `terminal_state` is
/// `None` only when the engine holds no resource evidence at all.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerListEntry {
    pub dispatch_id: String,
    pub task_id: String,
    pub run_id: String,
    pub assignment_state: AssignmentState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<ReportOutcome>,
    pub process_verdict: ProcessVerdict,
    pub worker_state: WorkerDispatchListState,
    pub dispatch_status: DispatchListStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_terminal_handle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal_state: Option<WorkerTerminalListState>,
    /// Source-compatible resource expose fields where provable: durable
    /// retention state/reason only. No archives, no owned resources.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<WorkerListResource>,
}

/// Durable retention slice of a listed attempt's resource.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerListResource {
    pub state: String,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerListResult {
    #[serde(default)]
    pub workers: Vec<WorkerListEntry>,
    #[serde(default)]
    pub counts: std::collections::BTreeMap<String, u64>,
}

/// Retain records a durable user-requested hold on a supervised worker's
/// resources. It performs no process or filesystem effects: the engine never
/// signals, never archives output, and never equates process exit with
/// release. A released resource answers `already_released`; a committed
/// release (`release_pending` / `release_unknown`) cannot be undone and
/// answers `unverifiable` with that reason.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerRetainParams {
    #[serde(flatten)]
    pub scope: CoordinatorScope,
    pub dispatch_id: String,
}

impl WorkerRetainParams {
    pub fn validate_shape(&self, execution_host_id: &str) -> Result<(), RpcError> {
        self.scope.validate_shape(execution_host_id)?;
        validate_opaque_token(&self.dispatch_id, 128, "Invalid dispatch id.")
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerRetainResult {
    pub dispatch_id: String,
    pub disposition: ResourceDisposition,
    /// Machine-readable reason: `user_requested`, `already_released`,
    /// `release_committed`, or `no_owned_resource`.
    pub reason: String,
    /// Source-compatible retain state: `retained`, `already_released`,
    /// `release_pending`, or `release_unknown`.
    #[serde(default)]
    pub state: String,
    pub process_verdict: ProcessVerdict,
    /// Source compatibility: retain never signals and there is no archive
    /// implementation yet, so this is honestly `none` / `null`.
    #[serde(default)]
    pub process_action: ProcessAction,
    #[serde(default)]
    pub archive: Option<serde_json::Value>,
    #[serde(default)]
    pub residual_resources: Vec<ResidualResource>,
}
