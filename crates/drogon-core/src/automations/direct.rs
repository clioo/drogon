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
use crate::bots::policy as bots_policy;
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

/// Dispatch-time resolution of a Bot-owned automation's harness policy
/// (issue #188): the fork's `resolveBotAutomationDispatchContext`
/// (`src/main/bots/bot-automation-dispatch-context.ts`) re-resolves the
/// owning Bot's CURRENT harness at every dispatch -- not at row-build
/// time -- so editing the bot later applies to already-scheduled
/// responsibilities; this composes that with the desktop's
/// `buildBotRunHarness` split (ported as
/// [`bots_policy::harness_overrides`]): `explicit_model` carries
/// `provider/model`, and Pi daemon runs go unattended. Precedence: an
/// explicit automation-row pin (#211) beats the bot policy, which beats
/// bare harness defaults. Bot-free automations -- and a Bot row that no
/// longer resolves (a stale `bot_id`) -- dispatch exactly as before: the
/// row's own params stay the safe fallback, never a new refusal path
/// downstream of the eligibility/ownership fences this module already
/// evaluated.
fn resolve_dispatch_harness(
    conn: &Connection,
    automation: &Automation,
    row: &HarnessLaunchParams,
) -> HarnessLaunchParams {
    if automation.bot_id.is_none() {
        return row.clone();
    }
    let owned = bots_storage::owning_scheduled_responsibility(conn, &automation.id)
        .ok()
        .flatten();
    let bot = owned.and_then(|owned| {
        bots_storage::get_bot(conn, &owned.host_id, &owned.folder, &owned.bot_id)
            .ok()
            .flatten()
    });
    let Some(bot) = bot else {
        return row.clone();
    };
    let policy = bots_policy::harness_overrides(&bot);
    HarnessLaunchParams {
        // The Bot owns the harness identity (the fork overrides `agentId`
        // unconditionally); the row's `agent_id` was only its build-time
        // snapshot.
        harness_id: policy.harness_id,
        // The row's own pins win (#211 precedence); the bot policy fills
        // the gaps. Read straight off the loaded row so the precedence
        // never depends on the caller forwarding the row values.
        model: automation.model.clone().or(policy.model),
        effort: row.effort.clone(),
        provider: automation.provider.clone().or(policy.provider),
        permission_mode: row.permission_mode.clone().or(policy.permission_mode),
        headless: row.headless,
    }
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
    let harness = resolve_dispatch_harness(conn, &automation, harness);
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
        params: harness_start_params(&workspace_id, &automation.prompt, &harness),
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

/// Session evidence the scheduler tick reads off a live handle for one
/// `Dispatched` run: the wire `verdict`/`agentState` strings from
/// [`crate::session::snapshot`], never re-derived here.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionEvidence {
    pub verdict: String,
    pub exit_code: Option<i64>,
    pub agent_state: String,
    pub agent_state_at: Option<String>,
    pub incarnation: String,
}

/// What the tick's reconciliation concludes about one `Dispatched` run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReconcileOutcome {
    /// The session exited: the run is done, with this exit code.
    Exited { exit_code: Option<i64> },
    /// The session is live but its hook wait-signal postdates dispatch:
    /// the agent's turn ended and it now waits for follow-up input that
    /// an automation never sends. Known gap: a tool-approval request
    /// raises the same signal and cannot be distinguished here
    /// (`session.rs` keeps only the stamp, not the event name); the run
    /// detail keeps resolving the live snapshot, so an approval prompt
    /// stays visible rather than hidden.
    TurnEnded,
    /// No handle for the run's session in this process (daemon restarted
    /// or the session was swept): closed out without claiming completion,
    /// mirroring the reference's stranded-run close-out.
    Stranded,
    /// Still running, or the live handle is another incarnation than the
    /// run's (a stale replay must never finalize another session's run).
    Running,
}

/// Strict parser for this crate's own UTC RFC3339 writer format
/// (`YYYY-MM-DDTHH:MM:SSZ`, second resolution -- see
/// `crate::now_rfc3339`): returns whole seconds since the Unix epoch.
/// Anything else (including a future format change) is `None`, which the
/// decision treats as "edge unproven", never as completion.
fn rfc3339_to_secs(raw: &str) -> Option<i64> {
    let bytes = raw.as_bytes();
    if bytes.len() != 20 {
        return None;
    }
    const IDX: [usize; 6] = [0, 5, 8, 11, 14, 17];
    const LEN: [usize; 6] = [4, 2, 2, 2, 2, 2];
    let mut part = [0i64; 6];
    for (i, (at, len)) in IDX.iter().zip(LEN.iter()).enumerate() {
        let slice = bytes.get(*at..at + len)?;
        if !slice.iter().all(u8::is_ascii_digit) {
            return None;
        }
        part[i] = std::str::from_utf8(slice).ok()?.parse().ok()?;
    }
    if &raw[4..5] != "-"
        || &raw[7..8] != "-"
        || &raw[10..11] != "T"
        || &raw[13..14] != ":"
        || &raw[16..17] != ":"
        || &raw[19..20] != "Z"
    {
        return None;
    }
    let [year, month, day, hour, minute, second] = part;
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    // Month-length/leap validation would need the civil calendar; a
    // day-of-month past the month's end still yields a deterministic
    // (if uncalendared) instant, which is all an ordering proof needs.
    let days = days_from_civil(year as i32, month as u32, day as u32);
    Some(days * 86_400 + hour * 3600 + minute * 60 + second)
}

fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year } as i64;
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Pure reconciliation decision for one `Dispatched` run. Never touches
/// storage; the scheduler applies the outcome with [`apply_reconcile`].
pub fn reconcile_decision(
    run: &AutomationRun,
    session: Option<&SessionEvidence>,
) -> ReconcileOutcome {
    let Some(evidence) = session else {
        return ReconcileOutcome::Stranded;
    };
    if let Some(incarnation) = &run.session_incarnation
        && *incarnation != evidence.incarnation
    {
        return ReconcileOutcome::Running;
    }
    if evidence.verdict == "exited" {
        return ReconcileOutcome::Exited {
            exit_code: evidence.exit_code,
        };
    }
    if evidence.agent_state == "needs_input" {
        // The stamp is second-truncated at write time, so it can read up
        // to just under a second *before* the true signal instant; the
        // +999 ms tolerance makes the edge exact, not approximate: a
        // signal stamped a full second (or more) before dispatch can only
        // predate this run.
        let edge_proven = match (
            evidence.agent_state_at.as_deref().and_then(rfc3339_to_secs),
            run.dispatched_at,
        ) {
            (Some(signal_secs), Some(dispatched_at)) => {
                signal_secs * 1000 + 999 >= dispatched_at as i64
            }
            _ => false,
        };
        if edge_proven {
            return ReconcileOutcome::TurnEnded;
        }
    }
    ReconcileOutcome::Running
}

/// Applies a non-`Running` [`reconcile_decision`] to the stored run row in
/// one `BEGIN IMMEDIATE`: finalizes `Dispatched` rows only, so a
/// `Completed` row (or a row another tick already finalized) is never
/// regressed. Returns whether the row changed.
pub fn apply_reconcile(
    conn: &Connection,
    run_id: &str,
    outcome: ReconcileOutcome,
    observed_at: f64,
) -> Result<bool, automations_storage::StorageError> {
    if outcome == ReconcileOutcome::Running {
        return Ok(false);
    }
    let tx = automations_storage::begin_immediate(conn)?;
    let Some(mut run) = automations_storage::get_automation_run(&tx, run_id)? else {
        tx.commit()?;
        return Ok(false);
    };
    if run.status != AutomationRunStatus::Dispatched {
        tx.commit()?;
        return Ok(false);
    }
    match outcome {
        ReconcileOutcome::Exited { exit_code } => {
            run.status = AutomationRunStatus::Completed;
            run.exit_code = exit_code;
            run.observed_at = Some(observed_at);
        }
        ReconcileOutcome::TurnEnded => {
            run.status = AutomationRunStatus::Completed;
            run.observed_at = Some(observed_at);
        }
        ReconcileOutcome::Stranded => {
            run.status = AutomationRunStatus::DispatchFailed;
            run.error = Some(
                "Drogon lost the terminal for this run before it reported completion.".to_string(),
            );
            run.observed_at = Some(observed_at);
        }
        ReconcileOutcome::Running => unreachable!(),
    }
    automations_storage::upsert_automation_run(&tx, &run)?;
    tx.commit()?;
    Ok(true)
}

/// Reduces a raw PTY tail to the `plain_text` the run detail promises.
/// Control sequences do not survive: CSI/OSC/DCS color, cursor, title and
/// hyperlink markup is dropped while the visible text (including link URLs
/// and targets) stays. Line discipline: CRLF folds to LF (the PTY's ONLCR),
/// a lone CR becomes LF (progress repaint), other C0 controls and DEL go.
/// No blank-line squeezing, no truncation here: the snapshot stays a
/// faithful tail, only without terminal markup.
pub fn plain_text_snapshot_tail(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            match chars.peek() {
                None => break,
                Some('[') => {
                    chars.next();
                    for seq in chars.by_ref() {
                        if ('\x40'..='\x7E').contains(&seq) {
                            break;
                        }
                    }
                }
                Some(']') | Some('P') | Some('X') | Some('^') | Some('_') => {
                    chars.next();
                    consume_until_string_terminator(&mut chars);
                }
                Some('(') | Some(')') | Some('#') => {
                    chars.next();
                    chars.next();
                }
                Some(_) => {
                    chars.next();
                }
            }
            continue;
        }
        // C1 singletons only ever decode from real C1 bytes, never from
        // UTF-8 text continuations, so they are safe to treat as openers.
        if c == '\u{9b}' {
            for seq in chars.by_ref() {
                if ('\x40'..='\x7E').contains(&seq) {
                    break;
                }
            }
            continue;
        }
        if c == '\u{9d}' {
            consume_until_string_terminator(&mut chars);
            continue;
        }
        if c.is_control() {
            match c {
                '\n' | '\t' => out.push(c),
                '\r' => {
                    if chars.peek() == Some(&'\n') {
                        continue;
                    }
                    out.push('\n');
                }
                _ => {}
            }
            continue;
        }
        out.push(c);
    }
    out
}

/// Consumes an OSC/DCS/APC/PM/SOS payload through its string
/// terminator: BEL, or ESC followed by backslash. A lone backslash inside
/// (Windows paths, regex payloads) never terminates; a bare ESC aborts the
/// payload per ECMA-48 and is itself consumed.
fn consume_until_string_terminator(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) {
    let mut previous = '\0';
    for c in chars.by_ref() {
        if c == '\x07' || (c == '\\' && previous == '\x1b') {
            break;
        }
        previous = c;
    }
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
