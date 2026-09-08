//! Bot-free automation dispatch: the same [`DispatchSeam`] call sequence
//! as [`runner::dispatch_run_plan`](super::runner::dispatch_run_plan)
//! (via the shared [`runner::DispatchPlan`](super::runner::DispatchPlan)
//! projection -- never a parallel seam implementation), but without the
//! Bot/`Responsibility` indirection. Standalone automations created through
//! `automation.create` have no Bot owner and no scheduled responsibility, so
//! [`runner::prepare_run_plan`](super::runner::prepare_run_plan) cannot
//! admit them; this module prepares them straight from the stored
//! [`Automation`](super::records::Automation) instead.
//!
//! Eligibility reuses [`execution::evaluate_dispatch`](super::execution::evaluate_dispatch)
//! (same host fence, same disabled refusal -- never duplicated) and the same
//! workspace-row ownership check the runner applies beyond the automation's
//! own `execution_target_id` fence. Recording reuses the same
//! `automations::storage` run-row primitives and the same `ar:{request_id}`
//! stable run-id convention as the runner, plus the `ResponsibilityRun`
//! projection when the fired automation is Bot-owned (a scheduled
//! responsibility's automation -- see [`record_direct_outcome`]); a
//! bot-free automation has no Bot row to attach one to, so only its
//! `AutomationRun` is written.

use rusqlite::{Connection, OptionalExtension};
use serde_json::{Value, json};

use super::execution::{self, InvocationReason};
use super::records::{
    Automation, AutomationRun, AutomationRunStatus, AutomationRunTrigger, SessionKind,
    WorkspaceMode,
};
use super::runner::{self, DispatchPlan, HarnessLaunchParams, RunRefusal, RunUnsupported};
use super::storage as automations_storage;
use crate::bots::records::{ResponsibilityRun, ResponsibilityRunInvocation};
use crate::bots::storage as bots_storage;

/// Owned data a bot-free run needs to dispatch + record. Holds no
/// `Connection`/seam reference by construction, mirroring [`runner::RunPlan`].
#[derive(Debug, Clone, PartialEq)]
pub struct DirectPlan {
    pub automation_id: String,
    pub workspace_id: String,
    pub request_id: String,
    pub params: Value,
    pub trigger: AutomationRunTrigger,
    pub attempt_at: f64,
}

impl DispatchPlan for DirectPlan {
    fn request_id(&self) -> &str {
        &self.request_id
    }

    fn params(&self) -> &Value {
        &self.params
    }
}

/// Result of [`prepare_direct`]; same vocabulary as the runner so the
/// scheduler and `automation.run_now` render refusals identically.
#[derive(Debug, Clone, PartialEq)]
pub enum DirectPrepareOutcome {
    Refused(RunRefusal),
    Unsupported(RunUnsupported),
    Ready(DirectPlan),
}

/// Lookup failure while preparing a direct plan.
#[derive(Debug)]
pub enum DirectLookupError {
    Missing,
    Storage(automations_storage::StorageError),
}

impl From<automations_storage::StorageError> for DirectLookupError {
    fn from(value: automations_storage::StorageError) -> Self {
        Self::Storage(value)
    }
}

impl From<rusqlite::Error> for DirectLookupError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Storage(automations_storage::StorageError::Sqlite(value))
    }
}

impl std::fmt::Display for DirectLookupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Missing => write!(f, "automation not found"),
            Self::Storage(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for DirectLookupError {}

fn harness_start_params(workspace_id: &str, prompt: &str, harness: &HarnessLaunchParams) -> Value {
    let mut params = json!({
        "workspaceId": workspace_id,
        "harnessId": harness.harness_id,
        "prompt": prompt,
    });
    if let Some(model) = &harness.model {
        params["model"] = json!(model);
    }
    if let Some(effort) = &harness.effort {
        params["effort"] = json!(effort);
    }
    if let Some(provider) = &harness.provider {
        params["provider"] = json!(provider);
    }
    if let Some(permission_mode) = &harness.permission_mode {
        params["permissionMode"] = json!(permission_mode);
    }
    if harness.headless {
        params["headless"] = json!(true);
    }
    params
}

fn read_workspace_host_id(
    conn: &Connection,
    workspace_id: &str,
) -> Result<Option<String>, rusqlite::Error> {
    conn.query_row(
        "SELECT host_id FROM workspaces WHERE id = ?1",
        [workspace_id],
        |r| r.get::<_, String>(0),
    )
    .optional()
}

/// Read-only preparation of a bot-free run: evaluates the existing
/// execution gate, then the workspace-row ownership beyond the automation's
/// own fence. Takes `&Connection` and holds no guard across dispatch --
/// the caller locks only for this call, drops, dispatches, then re-locks
/// for [`record_direct_outcome`].
#[allow(clippy::too_many_arguments)]
pub fn prepare_direct(
    conn: &Connection,
    current_host_id: &str,
    automation_id: &str,
    reason: &InvocationReason,
    trigger: AutomationRunTrigger,
    event_identity: &str,
    harness: &HarnessLaunchParams,
    attempt_at: f64,
) -> Result<DirectPrepareOutcome, DirectLookupError> {
    let automation: Automation = automations_storage::get_automation(conn, automation_id)?
        .ok_or(DirectLookupError::Missing)?;
    if let super::execution::DispatchDecision::Refused(refusal) =
        execution::evaluate_dispatch(&automation, current_host_id, reason)
    {
        return Ok(DirectPrepareOutcome::Refused(RunRefusal::Automation(
            refusal,
        )));
    }
    let workspace_id = match automation.workspace_mode {
        WorkspaceMode::NewPerRun => {
            return Ok(DirectPrepareOutcome::Unsupported(
                RunUnsupported::NewPerRunWorkspaceMode,
            ));
        }
        WorkspaceMode::Existing => match &automation.workspace_id {
            Some(id) => id.clone(),
            None => {
                return Ok(DirectPrepareOutcome::Refused(
                    RunRefusal::MissingWorkspaceId,
                ));
            }
        },
    };
    match read_workspace_host_id(conn, &workspace_id)? {
        None => {
            return Ok(DirectPrepareOutcome::Refused(RunRefusal::UnknownWorkspace(
                workspace_id,
            )));
        }
        Some(workspace_host_id) if workspace_host_id != current_host_id => {
            return Ok(DirectPrepareOutcome::Refused(
                RunRefusal::ForeignWorkspaceHost {
                    workspace_id,
                    workspace_host_id,
                    current_host_id: current_host_id.to_string(),
                },
            ));
        }
        Some(_) => {}
    }
    let request_id = runner::derive_request_id(
        current_host_id,
        &workspace_id,
        "automation",
        &automation.id,
        event_identity,
    );
    Ok(DirectPrepareOutcome::Ready(DirectPlan {
        automation_id: automation.id.clone(),
        workspace_id: workspace_id.clone(),
        request_id,
        params: harness_start_params(&workspace_id, &automation.prompt, harness),
        trigger,
        attempt_at,
    }))
}

/// Where the automation row moves after this observation: the next cron
/// fire strictly after now (or the stored value when the schedule yields
/// none), plus the last-run stamp. Computed by the caller (scheduler or
/// `run_now`), which owns the clock and the cron evaluation; this module
/// only applies it atomically with the run row.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Reschedule {
    pub next_run_at: f64,
    pub last_run_at: Option<f64>,
}

fn status_for_outcome(outcome: &runner::RunnerOutcome) -> (AutomationRunStatus, Option<String>) {
    match outcome {
        runner::RunnerOutcome::Observed { verdict, .. } => match verdict.as_str() {
            "exited" => (AutomationRunStatus::Completed, None),
            _ => (AutomationRunStatus::Dispatched, None),
        },
        runner::RunnerOutcome::ObservationFailed { error, .. } => {
            (AutomationRunStatus::Dispatched, Some(error.to_string()))
        }
        runner::RunnerOutcome::DispatchFailed(error) => {
            (AutomationRunStatus::DispatchFailed, Some(error.to_string()))
        }
    }
}

/// Durable record of a dispatched direct run plus the automation-row
/// advance, in one `BEGIN IMMEDIATE`: a proven `Completed` row is never
/// regressed by a later observation for the same stable run id. When the
/// fired automation is Bot-owned (a scheduled responsibility's automation),
/// the same transaction also records the `ResponsibilityRun` projection --
/// exactly what the manual `bot.run` path writes via
/// [`runner::record_run_outcome_in_tx`](super::runner::record_run_outcome_in_tx)
/// (same stable id convention, same accepted-row projection), stamped from
/// the plan's own trigger (a scheduler fire is scheduled, an
/// `automation.run_now` is manual) so `bot.snapshot` history shows the
/// tick. A bot-free (standalone) automation has no owning Bot row, so only
/// the `AutomationRun` is written -- the `ResponsibilityRun` projection has
/// no Bot row to attach to, same as before.
///
/// Returns [`bots_storage::StorageError`] (a superset covering the
/// automation-row writes via `From`): callers only render it, never match
/// on it.
pub fn record_direct_outcome(
    conn: &Connection,
    plan: &DirectPlan,
    outcome: &runner::RunnerOutcome,
    observed_at: f64,
    reschedule: Reschedule,
) -> Result<String, bots_storage::StorageError> {
    let tx = automations_storage::begin_immediate(conn)?;
    let run_id = format!("ar:{}", plan.request_id);
    let existing = automations_storage::get_automation_run(&tx, &run_id)?;
    if let Some(existing) = existing
        && existing.status == AutomationRunStatus::Completed
    {
        apply_reschedule(&tx, &plan.automation_id, reschedule, observed_at)?;
        tx.commit()?;
        return Ok(existing.id);
    }
    let (status, error) = status_for_outcome(outcome);
    let (terminal_session_id, session_incarnation, exit_code, observed, dispatched) = match outcome
    {
        runner::RunnerOutcome::Observed {
            session_id,
            incarnation,
            exit_code,
            ..
        } => (
            Some(session_id.clone()),
            Some(incarnation.clone()),
            *exit_code,
            Some(observed_at),
            Some(plan.attempt_at),
        ),
        runner::RunnerOutcome::ObservationFailed {
            session_id,
            incarnation,
            error: _,
        } => (
            Some(session_id.clone()),
            Some(incarnation.clone()),
            None,
            Some(observed_at),
            Some(plan.attempt_at),
        ),
        runner::RunnerOutcome::DispatchFailed(_) => (None, None, None, None, None),
    };
    let run = AutomationRun {
        id: run_id.clone(),
        automation_id: plan.automation_id.clone(),
        run_context: None,
        source_context: None,
        title: String::new(),
        scheduled_for: plan.attempt_at,
        status,
        trigger: plan.trigger,
        workspace_id: Some(plan.workspace_id.clone()),
        workspace_display_name: None,
        session_kind: SessionKind::Terminal,
        chat_session_id: None,
        terminal_session_id,
        terminal_pane_key: None,
        terminal_pty_id: None,
        output_snapshot: None,
        precheck_result: None,
        usage: None,
        error,
        started_at: dispatched,
        dispatched_at: dispatched,
        created_at: plan.attempt_at,
        run_number: None,
        occurrence_count: None,
        last_occurrence_at: None,
        session_incarnation,
        exit_code,
        observed_at: observed,
    };
    automations_storage::upsert_automation_run(&tx, &run)?;
    record_bot_responsibility_run(&tx, plan, outcome, &run_id)?;
    apply_reschedule(&tx, &plan.automation_id, reschedule, observed_at)?;
    tx.commit()?;
    Ok(run_id)
}

/// Records the `ResponsibilityRun` for a Bot-owned automation inside the
/// caller's already-open transaction, or does nothing when no live Bot
/// responsibility references this automation (standalone automations).
/// Mirrors [`runner::record_run_outcome_in_tx`](super::runner::record_run_outcome_in_tx)'s
/// projection: the accepted `AutomationRun` row decides
/// `host_observation`/`ended_at` (never the raw outcome directly), the run
/// id is the plan's stable request id, and the invocation follows the
/// plan's own trigger (scheduler fire: scheduled; `run_now`: manual).
fn record_bot_responsibility_run(
    conn: &Connection,
    plan: &DirectPlan,
    outcome: &runner::RunnerOutcome,
    run_id: &str,
) -> Result<(), bots_storage::StorageError> {
    let Some(owned) = bots_storage::owning_scheduled_responsibility(conn, &plan.automation_id)?
    else {
        return Ok(());
    };
    let automation_run = automations_storage::get_automation_run(conn, run_id)?
        .ok_or(bots_storage::StorageError::NotFound("automation run"))?;
    let (host_observation, ended_at) = runner::responsibility_projection(&automation_run, outcome);
    let invocation = match plan.trigger {
        AutomationRunTrigger::Scheduled => ResponsibilityRunInvocation::Scheduled,
        AutomationRunTrigger::Manual => ResponsibilityRunInvocation::Manual,
    };
    let run = ResponsibilityRun {
        id: plan.request_id.clone(),
        bot_id: owned.bot_id.clone(),
        responsibility_id: owned.responsibility_id.clone(),
        automation_id: Some(plan.automation_id.clone()),
        automation_run_id: Some(automation_run.id.clone()),
        started_at: plan.attempt_at,
        ended_at,
        recipe: None,
        host_observation,
        invocation: Some(invocation),
    };
    bots_storage::record_responsibility_run_in_tx(conn, &owned.host_id, &owned.folder, run)?;
    Ok(())
}

/// Durable record of a run that never dispatched (missed past grace, or a
/// refusal): a `Skipped*` row plus the automation-row advance, atomically.
/// The run id is the caller's stable `ar:{request_id}` so a retried tick
/// for the same slot upserts rather than duplicating history.
#[allow(clippy::too_many_arguments)]
pub fn record_skip(
    conn: &Connection,
    automation_id: &str,
    request_id: &str,
    trigger: AutomationRunTrigger,
    status: AutomationRunStatus,
    error: Option<String>,
    scheduled_for: f64,
    created_at: f64,
    reschedule: Reschedule,
) -> Result<String, automations_storage::StorageError> {
    let tx = automations_storage::begin_immediate(conn)?;
    let run_id = format!("ar:{request_id}");
    if let Some(existing) = automations_storage::get_automation_run(&tx, &run_id)?
        && existing.status == AutomationRunStatus::Completed
    {
        tx.commit()?;
        return Ok(existing.id);
    }
    let run = AutomationRun {
        id: run_id.clone(),
        automation_id: automation_id.to_string(),
        run_context: None,
        source_context: None,
        title: String::new(),
        scheduled_for,
        status,
        trigger,
        workspace_id: None,
        workspace_display_name: None,
        session_kind: SessionKind::Terminal,
        chat_session_id: None,
        terminal_session_id: None,
        terminal_pane_key: None,
        terminal_pty_id: None,
        output_snapshot: None,
        precheck_result: None,
        usage: None,
        error,
        started_at: None,
        dispatched_at: None,
        created_at,
        run_number: None,
        occurrence_count: None,
        last_occurrence_at: None,
        session_incarnation: None,
        exit_code: None,
        observed_at: Some(created_at),
    };
    automations_storage::upsert_automation_run(&tx, &run)?;
    apply_reschedule(&tx, automation_id, reschedule, created_at)?;
    tx.commit()?;
    Ok(run_id)
}

fn apply_reschedule(
    conn: &Connection,
    automation_id: &str,
    reschedule: Reschedule,
    now: f64,
) -> Result<(), automations_storage::StorageError> {
    if let Some(mut automation) = automations_storage::get_automation(conn, automation_id)? {
        automation.next_run_at = reschedule.next_run_at;
        if let Some(last) = reschedule.last_run_at {
            automation.last_run_at = Some(last);
        }
        automation.updated_at = now;
        automations_storage::upsert_automation(conn, &automation)?;
    }
    Ok(())
}
