//! Native equivalents of the pinned `src/shared/automations-types.ts`
//! (`Automation`, `AutomationRun`, and their supporting types), at source
//! revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. See
//! `docs/migration/native-bot-state-contract.md` and
//! `tests/parity/ports/WP-CAP-BOTS/native-state/` for the parity evidence.
//!
//! This is the **global** native automation record authority: Bots
//! reference an `Automation` by [`Automation::bot_id`], they do not own a
//! separate copy of it. Every field from the source type is preserved
//! (never reduced to an ID/Bot-ID pair); fields this crate does not yet
//! interpret (e.g. `run_context`/`source_context`, SSH execution-target
//! derivation) still round-trip losslessly through [`Automation`]/
//! [`AutomationRun`] so a versioned payload with fields this build does
//! not use stays intact and recoverable.
//!
//! ## Absent vs. null
//!
//! A TypeScript `field?: T` (optional, never null) is `Option<T>` with
//! `#[serde(default, skip_serializing_if = "Option::is_none")]`: `None`
//! serializes as the key being *absent*, not `null`. A TypeScript
//! `field: T | null` (always present, nullable) is `Option<T>` with
//! `#[serde(default)]` and no skip: `None` serializes as an explicit JSON
//! `null`. A TypeScript `field?: T | null` (optional *and* nullable) is
//! `Option<Option<T>>` with `#[serde(default, skip_serializing_if =
//! "Option::is_none")]`, which correctly distinguishes all three states:
//! outer `None` = absent, `Some(None)` = explicit `null`, `Some(Some(v))`
//! = present value.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

/// See the module doc's "Absent vs. null". Without this, serde's derived
/// `Option<Option<T>>::deserialize` special-cases a JSON `null` the same
/// way it special-cases an absent key (both collapse to the outer `None`),
/// silently losing the absent-vs-null distinction. This is only invoked
/// when the key is present at all (an absent key short-circuits to
/// `#[serde(default)]` without calling this), so seeing `null` here means
/// the value really is `Some(None)`.
fn double_option<'de, D, T>(deserializer: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Deserialize::deserialize(deserializer).map(Some)
}

/// `WorkspaceMode` (shared with the Bot IPC schema's `schedule.workspaceMode`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceMode {
    Existing,
    NewPerRun,
}

/// `SetupDecision` (shared with the Bot IPC schema's `schedule.setupDecision`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SetupDecision {
    Inherit,
    Run,
    Skip,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionTargetType {
    Local,
    Ssh,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SchedulerOwner {
    LocalHostService,
    SshBridge,
    RemoteHostService,
}

/// Single-legal-value source literal `'run_once_within_grace'`, kept as a
/// real (one-variant) enum rather than a bare string so an unrecognized
/// persisted value round-trips as an explicit deserialize error, not a
/// silently-accepted new policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissedRunPolicy {
    RunOnceWithinGrace,
}

/// `AutomationPrecheck` (`{ command, timeoutSeconds }`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationPrecheck {
    pub command: String,
    pub timeout_seconds: f64,
}

/// `AutomationPrecheckResult`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationPrecheckResult {
    pub command: String,
    pub exit_code: Option<i64>,
    pub timed_out: bool,
    pub duration_ms: f64,
    pub stdout: String,
    pub stderr: String,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub error: Option<String>,
    pub started_at: f64,
    pub completed_at: f64,
}

/// `AutomationRunOutputSnapshot`. `format` is currently single-valued
/// (`'plain_text'`) in the source; kept as a one-variant enum for the same
/// reason as [`MissedRunPolicy`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationRunOutputFormat {
    PlainText,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunOutputSnapshot {
    pub format: AutomationRunOutputFormat,
    pub content: String,
    pub captured_at: f64,
    pub truncated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationRunUsageStatus {
    Known,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationRunUsageProvider {
    Claude,
    Codex,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EstimatedCostSource {
    ApiEquivalent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageAttribution {
    ProviderSessionTimeWindow,
}

/// `AutomationRunUsageUnavailableReason`. Confirmed directly against the
/// pinned source (`src/shared/automations-types.ts`,
/// `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, sha256
/// `ac7b60881d60f8bd777b56bacb99de3c3661ea26ed77cb8f233f8375956761e9`): a
/// real closed 7-value union, not a free-form string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationRunUsageUnavailableReason {
    RunNotFinished,
    ProviderUnsupported,
    RemoteUsageUnavailable,
    UsageNotEnabled,
    ScanFailed,
    NoMatchingSession,
    AmbiguousSession,
}

/// `AutomationRunUsage`. Every numeric measurement is nullable, never
/// defaulted to zero: "missing usage is not zero" (contract doc).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunUsage {
    pub status: AutomationRunUsageStatus,
    pub provider: Option<AutomationRunUsageProvider>,
    pub model: Option<String>,
    pub input_tokens: Option<f64>,
    pub output_tokens: Option<f64>,
    pub cache_read_tokens: Option<f64>,
    pub cache_write_tokens: Option<f64>,
    pub reasoning_output_tokens: Option<f64>,
    pub total_tokens: Option<f64>,
    pub estimated_cost_usd: Option<f64>,
    pub estimated_cost_source: Option<EstimatedCostSource>,
    pub provider_session_id: Option<String>,
    pub attribution: Option<UsageAttribution>,
    pub collected_at: f64,
    pub unavailable_reason: Option<AutomationRunUsageUnavailableReason>,
    pub unavailable_message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationRunStatus {
    Pending,
    Dispatching,
    Dispatched,
    Completed,
    SkippedPrecheck,
    SkippedMissed,
    SkippedUnavailable,
    SkippedNeedsInteractiveAuth,
    DispatchFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AutomationRunTrigger {
    Scheduled,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionKind {
    Terminal,
}

/// Native `Automation` (`src/shared/automations-types.ts`). The **global**
/// automation record; `bot_id` is the only Bot-ownership field (an
/// optional plain string -- source confirms there is no explicit-null
/// "unowned" state distinct from absence).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Automation {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creation_key: Option<String>,
    pub name: String,
    pub prompt: String,
    #[serde(default)]
    pub precheck: Option<AutomationPrecheck>,
    pub agent_id: String,
    /// Native-glue additions (not source `automations-types.ts` fields):
    /// harness model/provider overrides pinned at create/update and used
    /// for every dispatch of this automation (scheduler and `run_now`).
    /// `None` means the harness default. `Option` (not double-option):
    /// absent and explicit-null both read as unset, matching the wire
    /// params where absent/null both mean "leave unchanged".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// Deprecated in the source; preserved as an opaque JSON blob rather
    /// than a typed `WorkspaceRunContext` (not needed by the ownership/
    /// history behavior this build ports). Absent/null/value are still
    /// distinguished (see module doc).
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub run_context: Option<Option<Value>>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub source_context: Option<Option<Value>>,
    pub project_id: String,
    pub execution_target_type: ExecutionTargetType,
    pub execution_target_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_target_generation: Option<f64>,
    pub scheduler_owner: SchedulerOwner,
    pub workspace_mode: WorkspaceMode,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub base_branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_decision: Option<SetupDecision>,
    pub reuse_session: bool,
    pub timezone: String,
    pub rrule: String,
    pub dtstart: f64,
    pub enabled: bool,
    pub next_run_at: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<f64>,
    pub missed_run_policy: MissedRunPolicy,
    pub missed_run_grace_minutes: f64,
    pub created_at: f64,
    pub updated_at: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bot_id: Option<String>,
}

/// Native `AutomationRun`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRun {
    pub id: String,
    pub automation_id: String,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub run_context: Option<Option<Value>>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub source_context: Option<Option<Value>>,
    pub title: String,
    pub scheduled_for: f64,
    pub status: AutomationRunStatus,
    pub trigger: AutomationRunTrigger,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub workspace_display_name: Option<Option<String>>,
    pub session_kind: SessionKind,
    #[serde(default)]
    pub chat_session_id: Option<String>,
    #[serde(default)]
    pub terminal_session_id: Option<String>,
    #[serde(default)]
    pub terminal_pane_key: Option<String>,
    #[serde(default)]
    pub terminal_pty_id: Option<String>,
    #[serde(default)]
    pub output_snapshot: Option<AutomationRunOutputSnapshot>,
    #[serde(default)]
    pub precheck_result: Option<AutomationPrecheckResult>,
    #[serde(default)]
    pub usage: Option<AutomationRunUsage>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub started_at: Option<f64>,
    #[serde(default)]
    pub dispatched_at: Option<f64>,
    pub created_at: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_number: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occurrence_count: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_occurrence_at: Option<f64>,
    /// Native-glue addition (not a source `automations-types.ts` field):
    /// the admitted session's incarnation, for `SessionKind::Terminal` runs
    /// only -- see `automations::runner::record_run_outcome`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_incarnation: Option<String>,
    /// Native-glue addition: the observed numeric exit code, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    /// Native-glue addition: the wall-clock time of the specific
    /// `session.read` (or failed-observation) call that produced this
    /// row's current status, used to reject out-of-order stale replays.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_at: Option<f64>,
}

impl Automation {
    /// Source `automationBelongsToBot`: `automation.botId === botId`.
    pub fn belongs_to_bot(&self, bot_id: &str) -> bool {
        self.bot_id.as_deref() == Some(bot_id)
    }
}
