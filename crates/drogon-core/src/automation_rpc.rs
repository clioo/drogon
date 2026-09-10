//! Standalone `automation.*` RPCs (journey J7): create/list/update/delete,
//! manual `run_now`, and run `history` for bot-free cron automations.
//!
//! These compose the existing pieces without duplicating them: cron
//! validation and rescheduling come from [`automations::scheduler`] with
//! IANA-zone evaluation from [`automations::timezone`], eligibility and
//! dispatch from [`automations::direct`] +
//! [`automations::runner`]'s seam, and durability from
//! [`automations::storage`]. The schedule lives in `Automation::rrule`
//! (the reference stores cron there too) with its wall-time zone in
//! `Automation::timezone` (absent/legacy rows evaluate in UTC); unknown
//! zones are rejected at admission, never coerced.
//!
//! `create`/`update`/`delete` run on the atomic ledger path (DB-only, one
//! transaction with the receipt). `run_now` runs on the effect ledger path
//! with no outer `lifecycle_gate` guard -- like `bot.run`, its effect phase
//! re-enters `Engine::dispatch` (`harness.start` takes the gate's read side
//! itself), so holding an outer read guard across it would risk the same
//! recursive-read deadlock `bot_run_rpc` documents. Quiescence is checked
//! fail-closed at the top of the work closure instead.

use rusqlite::{Connection, OptionalExtension};
use serde_json::{Value, json};

use drogon_protocol::{
    Request, RpcError,
    automation::{
        AutomationCreateParams, AutomationDeleteParams, AutomationHistoryParams,
        AutomationHistoryResult, AutomationListResult, AutomationPreviewParams,
        AutomationPreviewResult, AutomationPreviewSkipped, AutomationRunDetail,
        AutomationRunListItem, AutomationRunNowOutcome, AutomationRunNowParams,
        AutomationRunNowResult, AutomationRunOutputFormat, AutomationRunOutputSnapshotView,
        AutomationRunParams, AutomationRunStatus as WireStatus,
        AutomationRunTrigger as WireTrigger, AutomationRunView, AutomationRunsAllParams,
        AutomationRunsAllResult, AutomationSummary, AutomationUpdateParams, LastRunSummary,
    },
};

use crate::automations::direct::{
    DirectLookupError, DirectPlan, DirectPrepareOutcome, Reschedule, plain_text_snapshot_tail,
};
use crate::automations::execution::InvocationReason;
use crate::automations::records::{
    Automation, AutomationRun, AutomationRunStatus, AutomationRunTrigger, ExecutionTargetType,
    MissedRunPolicy, SchedulerOwner, WorkspaceMode,
};
use crate::automations::runner::{self, EngineDispatchSeam, HarnessLaunchParams};
use crate::automations::{direct, scheduler, storage};

const DEFAULT_GRACE_MINUTES: f64 = 15.0;
const MAX_GRACE_MINUTES: f64 = 10_080.0;
const MAX_HISTORY_LIMIT: u64 = 200;
const DEFAULT_HISTORY_LIMIT: usize = 50;
const DEFAULT_RUNS_ALL_PAGE: u64 = 1;
const DEFAULT_RUNS_ALL_PER_PAGE: u64 = 50;
const MAX_RUNS_ALL_PER_PAGE: u64 = 200;

fn invalid_argument(message: impl Into<String>) -> RpcError {
    crate::error::invalid_argument(message)
}

fn not_found(message: impl Into<String>) -> RpcError {
    crate::error::not_found(message)
}

fn internal_error(message: impl Into<String>) -> RpcError {
    crate::error::internal_error(message)
}

fn storage_error(context: impl Into<String>) -> RpcError {
    internal_error(context.into())
}

fn parse_params<T: serde::de::DeserializeOwned>(
    params: &Value,
    method: &str,
) -> Result<T, RpcError> {
    serde_json::from_value(params.clone())
        .map_err(|e| invalid_argument(format!("{method} params invalid: {e}")))
}

fn require_id(id: &str, what: &str) -> Result<String, RpcError> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err(invalid_argument(format!("{what} must not be empty")));
    }
    if trimmed.len() > 128 || trimmed.chars().any(char::is_control) {
        return Err(invalid_argument(format!(
            "{what} must be 1..=128 characters without control characters"
        )));
    }
    Ok(trimmed.to_string())
}

fn require_name(name: &str) -> Result<String, RpcError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(invalid_argument("name must contain visible text"));
    }
    if trimmed.len() > 128 {
        return Err(invalid_argument("name must be at most 128 UTF-8 bytes"));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(invalid_argument("name must not contain control characters"));
    }
    Ok(trimmed.to_string())
}

fn require_prompt(prompt: &str) -> Result<String, RpcError> {
    if prompt.trim().is_empty() {
        return Err(invalid_argument("prompt must contain visible text"));
    }
    if prompt.len() > 32768 {
        return Err(invalid_argument("prompt must be at most 32768 UTF-8 bytes"));
    }
    if prompt.contains('\0') {
        return Err(invalid_argument("prompt must not contain NUL"));
    }
    Ok(prompt.to_string())
}

fn require_harness(harness: &str) -> Result<String, RpcError> {
    let trimmed = harness.trim();
    if serde_json::from_value::<drogon_harness::HarnessId>(json!(trimmed)).is_err() {
        return Err(invalid_argument(
            "harness must be one of claude|pi|opencode|antigravity|codex",
        ));
    }
    Ok(trimmed.to_string())
}

fn require_grace(value: Option<f64>) -> Result<f64, RpcError> {
    let grace = value.unwrap_or(DEFAULT_GRACE_MINUTES);
    if !grace.is_finite() || grace < 0.0 || grace > MAX_GRACE_MINUTES {
        return Err(invalid_argument(format!(
            "graceMinutes must be within 0..={MAX_GRACE_MINUTES}"
        )));
    }
    Ok(grace)
}

/// Computes the stored `next_run_at` for an admitted (already
/// validated and normalized) cron+zone pair strictly after `now_ms`:
/// the single computation shared by create, schedule-touching update,
/// and run-now reschedules. Callers pass the real clock; same-module
/// tests pass fixed clocks for deterministic gap/fold vectors. Pure:
/// no DB, no ledger, no dispatch.
fn admit_next_run_at(cron: &str, timezone: &str, now_ms: f64) -> Result<f64, RpcError> {
    crate::automations::timezone::next_native_fire_ms(cron, timezone, now_ms)
        .map(|ms| ms as f64)
        .ok_or_else(|| invalid_argument("cron expression has no future occurrence from now"))
}

/// Harness model/provider override admission, mirroring the bounds
/// `drogon-harness::plan_launch` enforces at dispatch (1..=512 bytes, no
/// control characters, never flag-shaped) so a stored override can never
/// be one the launcher itself would refuse. Empty/blank is rejected
/// rather than stored as "unset": callers spell unset by omitting the
/// key (update leaves a stored override unchanged on absent/null).
fn require_harness_option(value: Option<String>, what: &str) -> Result<Option<String>, RpcError> {
    let Some(raw) = value else {
        return Ok(None);
    };
    if raw.is_empty()
        || raw.len() > 512
        || raw.chars().any(char::is_control)
        || raw.starts_with('-')
    {
        return Err(invalid_argument(format!(
            "{what} must be 1..=512 UTF-8 bytes without control characters and must not start with '-'"
        )));
    }
    Ok(Some(raw))
}

/// Provider selection is a Pi-only launcher feature (see
/// `drogon-harness::plan_launch`); refusing it at admission keeps a
/// non-Pi automation from recording runs that can only DispatchFailed.
fn require_provider_for_harness(
    provider: Option<String>,
    harness_id: &str,
) -> Result<Option<String>, RpcError> {
    let provider = require_harness_option(provider, "provider")?;
    if provider.is_some() && harness_id != "pi" {
        return Err(invalid_argument(
            "provider selection is available only for the pi harness",
        ));
    }
    Ok(provider)
}

/// Local-host-only workspace admission: the row must exist and belong to
/// this host. There is no cross-host assertion concept in the v1 params.
fn admit_workspace(conn: &Connection, host_id: &str, workspace_id: &str) -> Result<(), RpcError> {
    let row: Option<String> = conn
        .query_row(
            "SELECT host_id FROM workspaces WHERE id = ?1",
            [workspace_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| storage_error(format!("workspace lookup failed: {e}")))?;
    match row {
        None => Err(not_found(format!("workspace {workspace_id} not found"))),
        Some(owner) if owner != host_id => Err(RpcError::new(
            "unsupported_host",
            format!("workspace {workspace_id} belongs to another execution host"),
        )),
        Some(_) => Ok(()),
    }
}

fn wire_status(status: AutomationRunStatus) -> WireStatus {
    match status {
        AutomationRunStatus::Pending => WireStatus::Pending,
        AutomationRunStatus::Dispatching => WireStatus::Dispatching,
        AutomationRunStatus::Dispatched => WireStatus::Dispatched,
        AutomationRunStatus::Completed => WireStatus::Completed,
        AutomationRunStatus::SkippedPrecheck => WireStatus::SkippedPrecheck,
        AutomationRunStatus::SkippedMissed => WireStatus::SkippedMissed,
        AutomationRunStatus::SkippedUnavailable => WireStatus::SkippedUnavailable,
        AutomationRunStatus::SkippedNeedsInteractiveAuth => WireStatus::SkippedNeedsInteractiveAuth,
        AutomationRunStatus::DispatchFailed => WireStatus::DispatchFailed,
    }
}

fn wire_trigger(trigger: AutomationRunTrigger) -> WireTrigger {
    match trigger {
        AutomationRunTrigger::Scheduled => WireTrigger::Scheduled,
        AutomationRunTrigger::Manual => WireTrigger::Manual,
    }
}

fn summarize_run(run: &AutomationRun) -> LastRunSummary {
    LastRunSummary {
        id: run.id.clone(),
        status: wire_status(run.status),
        trigger: wire_trigger(run.trigger),
        scheduled_for: run.scheduled_for,
        error: run.error.clone(),
        exit_code: run.exit_code,
    }
}

fn view_run(run: &AutomationRun) -> AutomationRunView {
    AutomationRunView {
        id: run.id.clone(),
        automation_id: run.automation_id.clone(),
        status: wire_status(run.status),
        trigger: wire_trigger(run.trigger),
        scheduled_for: run.scheduled_for,
        workspace_id: run.workspace_id.clone(),
        terminal_session_id: run.terminal_session_id.clone(),
        error: run.error.clone(),
        exit_code: run.exit_code,
        started_at: run.started_at,
        dispatched_at: run.dispatched_at,
        created_at: run.created_at,
    }
}

fn latest_run(runs: &[AutomationRun]) -> Option<&AutomationRun> {
    runs.iter().max_by(|a, b| {
        a.created_at
            .total_cmp(&b.created_at)
            .then_with(|| a.id.cmp(&b.id))
    })
}

/// The output snapshot the daemon can honestly provide for a run: the
/// stored snapshot when one was recorded, otherwise the retained tail of
/// the run's session while that exact session incarnation is still known
/// to this process. Never fabricated: a gone session with no stored
/// snapshot yields `None`, and the client falls back to the run's error.
fn resolve_output_snapshot(
    engine: &crate::Engine,
    run: &AutomationRun,
    now_ms: f64,
) -> (Option<AutomationRunOutputSnapshotView>, bool) {
    if let Some(stored) = &run.output_snapshot {
        return (
            Some(AutomationRunOutputSnapshotView {
                format: AutomationRunOutputFormat::PlainText,
                content: stored.content.clone(),
                captured_at: stored.captured_at,
                truncated: stored.truncated,
            }),
            run.terminal_session_id.as_ref().is_some_and(|session_id| {
                session_incarnation_still_known(engine, session_id, &run.session_incarnation)
            }),
        );
    }
    let Some(session_id) = &run.terminal_session_id else {
        return (None, false);
    };
    let handle = engine.sessions.lock().unwrap().get(session_id).cloned();
    let Some(handle) = handle else {
        // No retained handle in this process: the run's session is gone
        // from this incarnation's point of view (never existed, swept by
        // crash recovery, or the daemon restarted).
        return (None, false);
    };
    if !session_incarnation_still_known(engine, session_id, &run.session_incarnation) {
        return (None, false);
    }
    let outcome = crate::session::read_tail(&handle);
    // The tail is raw PTY bytes but the snapshot promises plain text:
    // terminal markup is reduced (the visible text stays) so the detail
    // page never renders escape garbage.
    let content = plain_text_snapshot_tail(&String::from_utf8_lossy(&outcome.bytes))
        .trim()
        .to_string();
    if content.is_empty() {
        // A session that exists but has produced no retained output gives
        // no snapshot rather than an empty one.
        return (None, true);
    }
    (
        Some(AutomationRunOutputSnapshotView {
            format: AutomationRunOutputFormat::PlainText,
            content,
            captured_at: now_ms,
            truncated: outcome.truncated,
        }),
        true,
    )
}

/// Whether this engine currently holds the named session under the run's
/// recorded incarnation. A missing run incarnation (legacy row) only
/// matches a live handle by session id.
fn session_incarnation_still_known(
    engine: &crate::Engine,
    session_id: &str,
    run_incarnation: &Option<String>,
) -> bool {
    let handle = engine.sessions.lock().unwrap().get(session_id).cloned();
    let Some(handle) = handle else {
        return false;
    };
    match run_incarnation {
        Some(incarnation) => handle.incarnation == *incarnation,
        None => true,
    }
}

fn summarize(conn: &Connection, automation: &Automation) -> Result<AutomationSummary, RpcError> {
    let runs = storage::list_automation_runs(conn, &automation.id)
        .map_err(|e| storage_error(format!("run history lookup failed: {e}")))?;
    Ok(AutomationSummary {
        id: automation.id.clone(),
        name: automation.name.clone(),
        cron: automation.rrule.clone(),
        timezone: if automation.timezone.is_empty() {
            None
        } else {
            Some(automation.timezone.clone())
        },
        workspace_id: automation.workspace_id.clone(),
        harness: automation.agent_id.clone(),
        model: automation.model.clone(),
        provider: automation.provider.clone(),
        prompt: automation.prompt.clone(),
        enabled: automation.enabled,
        next_run_at: automation.next_run_at,
        last_run_at: automation.last_run_at,
        last_run: latest_run(&runs).map(summarize_run),
    })
}

struct NewAutomation {
    id: String,
    name: String,
    cron: String,
    timezone: String,
    workspace_id: String,
    harness: String,
    prompt: String,
    enabled: bool,
    grace: f64,
    model: Option<String>,
    provider: Option<String>,
    now_ms: f64,
}

fn build_automation(
    conn: &Connection,
    host_id: &str,
    new: NewAutomation,
) -> Result<Automation, RpcError> {
    admit_workspace(conn, host_id, &new.workspace_id)?;
    let next_run_at = admit_next_run_at(&new.cron, &new.timezone, new.now_ms)?;
    Ok(Automation {
        id: new.id,
        creation_key: None,
        name: new.name,
        prompt: new.prompt,
        precheck: None,
        agent_id: new.harness,
        model: new.model,
        provider: new.provider,
        run_context: None,
        source_context: None,
        project_id: new.workspace_id.clone(),
        execution_target_type: ExecutionTargetType::Local,
        execution_target_id: host_id.to_string(),
        execution_target_generation: None,
        scheduler_owner: SchedulerOwner::LocalHostService,
        workspace_mode: WorkspaceMode::Existing,
        workspace_id: Some(new.workspace_id),
        base_branch: None,
        setup_decision: None,
        reuse_session: false,
        timezone: new.timezone,
        rrule: new.cron,
        dtstart: new.now_ms,
        enabled: new.enabled,
        next_run_at,
        last_run_at: None,
        missed_run_policy: MissedRunPolicy::RunOnceWithinGrace,
        missed_run_grace_minutes: new.grace,
        created_at: new.now_ms,
        updated_at: new.now_ms,
        bot_id: None,
    })
}

fn check_quiescent(engine: &crate::Engine) -> Result<(), RpcError> {
    if engine.is_quiescent() {
        return Err(crate::error::runtime_busy(
            "service admission is frozen for shutdown",
        ));
    }
    Ok(())
}

impl crate::Engine {
    pub(crate) fn automation_create(&self, request: &Request) -> Result<Value, RpcError> {
        let params: AutomationCreateParams = parse_params(&request.params, "automation.create")?;
        let name = require_name(&params.name)?;
        let cron = scheduler::validate_cron(&params.cron).map_err(invalid_argument)?;
        let timezone = crate::automations::timezone::normalize_timezone(params.timezone.as_deref())
            .map_err(invalid_argument)?;
        let workspace_id = require_id(&params.workspace_id, "workspaceId")?;
        let harness = require_harness(&params.harness)?;
        let prompt = require_prompt(&params.prompt)?;
        let enabled = params.enabled.unwrap_or(true);
        let grace = require_grace(params.grace_minutes)?;
        let model = require_harness_option(params.model, "model")?;
        let provider = require_provider_for_harness(params.provider, &harness)?;
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |_| check_quiescent(self),
            |tx| {
                let now_ms = crate::now_unix_ms() as f64;
                let automation = build_automation(
                    tx,
                    &self.host_id,
                    NewAutomation {
                        id: uuid::Uuid::new_v4().to_string(),
                        name: name.clone(),
                        cron: cron.clone(),
                        timezone: timezone.clone(),
                        workspace_id: workspace_id.clone(),
                        harness: harness.clone(),
                        prompt: prompt.clone(),
                        enabled,
                        grace,
                        model: model.clone(),
                        provider: provider.clone(),
                        now_ms,
                    },
                )?;
                storage::insert_new_automation(tx, &automation)
                    .map_err(|e| storage_error(format!("failed to create automation: {e}")))?;
                let summary = summarize(tx, &automation)?;
                serde_json::to_value(&summary).map_err(|e| internal_error(e.to_string()))
            },
        )
    }

    pub(crate) fn automation_list(&self, params: &Value) -> Result<Value, RpcError> {
        if !params.as_object().is_some_and(|o| o.is_empty()) {
            return Err(invalid_argument("automation.list takes no params"));
        }
        let conn = self.db.lock().unwrap();
        let mut automations = storage::list_all_automations(&conn)
            .map_err(|e| storage_error(format!("automation list failed: {e}")))?;
        automations.sort_by(|a, b| {
            a.created_at
                .total_cmp(&b.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        let mut out = Vec::with_capacity(automations.len());
        for automation in &automations {
            out.push(summarize(&conn, automation)?);
        }
        let result = AutomationListResult { automations: out };
        serde_json::to_value(&result).map_err(|e| internal_error(e.to_string()))
    }

    /// `automation.show { id }`: one automation record, or `not_found`.
    pub(crate) fn automation_show(&self, params: &Value) -> Result<Value, RpcError> {
        let id = params
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid_argument("missing id"))?;
        let id = require_id(id, "id")?;
        let conn = self.db.lock().unwrap();
        let automation = storage::get_automation(&conn, &id)
            .map_err(|e| storage_error(format!("automation show failed: {e}")))?
            .ok_or_else(|| not_found(format!("automation {id} not found")))?;
        serde_json::to_value(summarize(&conn, &automation)?)
            .map_err(|e| internal_error(e.to_string()))
    }

    pub(crate) fn automation_update(&self, request: &Request) -> Result<Value, RpcError> {
        let params: AutomationUpdateParams = parse_params(&request.params, "automation.update")?;
        let id = require_id(&params.id, "id")?;
        let name = params.name.as_deref().map(require_name).transpose()?;
        let cron = params
            .cron
            .as_deref()
            .map(scheduler::validate_cron)
            .transpose()
            .map_err(invalid_argument)?;
        let timezone = params
            .timezone
            .as_deref()
            .map(|zone| crate::automations::timezone::normalize_timezone(Some(zone)))
            .transpose()
            .map_err(invalid_argument)?;
        let workspace_id = params
            .workspace_id
            .as_deref()
            .map(|w| require_id(w, "workspaceId"))
            .transpose()?;
        let harness = params.harness.as_deref().map(require_harness).transpose()?;
        let prompt = params.prompt.as_deref().map(require_prompt).transpose()?;
        if let Some(grace) = params.grace_minutes {
            require_grace(Some(grace))?;
        }
        let model = require_harness_option(params.model, "model")?;
        let provider_raw = require_harness_option(params.provider, "provider")?;
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |_| check_quiescent(self),
            |tx| {
                let mut automation = storage::get_automation(tx, &id)
                    .map_err(|e| storage_error(format!("automation lookup failed: {e}")))?
                    .ok_or_else(|| not_found(format!("automation {id} not found")))?;
                let now_ms = crate::now_unix_ms() as f64;
                if let Some(name) = name.clone() {
                    automation.name = name;
                }
                if let Some(prompt) = prompt.clone() {
                    automation.prompt = prompt;
                }
                if let Some(harness) = harness.clone() {
                    automation.agent_id = harness;
                }
                if let Some(model) = model.clone() {
                    automation.model = Some(model);
                }
                if let Some(provider) = provider_raw.clone() {
                    if automation.agent_id != "pi" {
                        return Err(invalid_argument(
                            "provider selection is available only for the pi harness",
                        ));
                    }
                    automation.provider = Some(provider);
                }
                if automation.agent_id != "pi" && automation.provider.is_some() {
                    return Err(invalid_argument(
                        "automation pins a provider but its harness is not pi: \
                         change the harness back to pi or recreate it without a provider",
                    ));
                }
                if let Some(workspace_id) = workspace_id.clone() {
                    admit_workspace(tx, &self.host_id, &workspace_id)?;
                    automation.workspace_id = Some(workspace_id.clone());
                    automation.project_id = workspace_id;
                }
                if let Some(grace) = params.grace_minutes {
                    automation.missed_run_grace_minutes = grace;
                }
                let mut cron_touched = false;
                if let Some(cron) = cron.clone() {
                    automation.rrule = cron;
                    cron_touched = true;
                }
                if let Some(timezone) = timezone.clone() {
                    // A zone edit re-anchors the same wall time in the new
                    // zone, so the next run is always recomputed.
                    automation.timezone = timezone;
                    cron_touched = true;
                }
                if let Some(enabled) = params.enabled {
                    if enabled && !automation.enabled && automation.next_run_at <= now_ms {
                        cron_touched = true;
                    }
                    automation.enabled = enabled;
                }
                if cron_touched {
                    automation.next_run_at =
                        admit_next_run_at(&automation.rrule, &automation.timezone, now_ms)?;
                }
                automation.updated_at = now_ms;
                storage::upsert_automation(tx, &automation)
                    .map_err(|e| storage_error(format!("failed to update automation: {e}")))?;
                let summary = summarize(tx, &automation)?;
                serde_json::to_value(&summary).map_err(|e| internal_error(e.to_string()))
            },
        )
    }

    pub(crate) fn automation_delete(&self, request: &Request) -> Result<Value, RpcError> {
        let params: AutomationDeleteParams = parse_params(&request.params, "automation.delete")?;
        let id = require_id(&params.id, "id")?;
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |_| check_quiescent(self),
            |tx| {
                let deleted = storage::delete_automation(tx, &id, None).map_err(|e| match e {
                    storage::StorageError::NotFound(_) => {
                        not_found(format!("automation {id} not found"))
                    }
                    other => storage_error(format!("failed to delete automation: {other}")),
                })?;
                if !deleted {
                    return Err(not_found(format!("automation {id} not found")));
                }
                Ok(json!({"id": id}))
            },
        )
    }

    pub(crate) fn automation_history(&self, params: &Value) -> Result<Value, RpcError> {
        let params: AutomationHistoryParams = parse_params(params, "automation.history")?;
        let automation_id = require_id(&params.automation_id, "automationId")?;
        let limit = params.limit.unwrap_or(DEFAULT_HISTORY_LIMIT as u64);
        if limit == 0 || limit > MAX_HISTORY_LIMIT {
            return Err(invalid_argument(format!(
                "limit must be within 1..={MAX_HISTORY_LIMIT}"
            )));
        }
        let conn = self.db.lock().unwrap();
        let exists = storage::get_automation(&conn, &automation_id)
            .map_err(|e| storage_error(format!("automation lookup failed: {e}")))?;
        if exists.is_none() {
            return Err(not_found(format!("automation {automation_id} not found")));
        }
        let mut runs = storage::list_automation_runs(&conn, &automation_id)
            .map_err(|e| storage_error(format!("run history lookup failed: {e}")))?;
        runs.sort_by(|a, b| {
            b.created_at
                .total_cmp(&a.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        runs.truncate(limit as usize);
        let result = AutomationHistoryResult {
            runs: runs.iter().map(view_run).collect(),
        };
        serde_json::to_value(&result).map_err(|e| internal_error(e.to_string()))
    }

    /// Authoritative schedule preview: next fires plus DST-gap skips,
    /// evaluated with the tick's exact zone semantics. Read-only: no
    /// ledger entry, no run rows, no dispatch -- the editor renders this
    /// so its preview and the backend agree by construction.
    pub(crate) fn automation_preview(&self, params: &Value) -> Result<Value, RpcError> {
        let params: AutomationPreviewParams = parse_params(params, "automation.preview")?;
        let cron = scheduler::validate_cron(&params.cron).map_err(invalid_argument)?;
        let timezone = crate::automations::timezone::normalize_timezone(params.timezone.as_deref())
            .map_err(invalid_argument)?;
        let from_ms = params
            .from_ms
            .unwrap_or_else(|| crate::now_unix_ms() as f64);
        if !from_ms.is_finite() || from_ms < 0.0 {
            return Err(invalid_argument(
                "fromMs must be a non-negative millisecond epoch",
            ));
        }
        let count = params.count.unwrap_or(3);
        if count == 0 || count > 10 {
            return Err(invalid_argument("count must be within 1..=10"));
        }
        let preview = crate::automations::timezone::preview_fires_in_zone(
            &cron,
            &timezone,
            from_ms,
            count as usize,
        )
        .ok_or_else(|| invalid_argument("cron expression has no future occurrence from there"))?;
        let result = AutomationPreviewResult {
            timezone: preview.timezone,
            fires: preview.fires.iter().map(|ms| *ms as f64).collect(),
            skipped: preview
                .skipped
                .iter()
                .map(|skip| AutomationPreviewSkipped {
                    date: skip.local_date.clone(),
                    wall_time: skip.wall_time.clone(),
                    reason: skip.reason.clone(),
                })
                .collect(),
        };
        serde_json::to_value(&result).map_err(|e| internal_error(e.to_string()))
    }

    pub(crate) fn automation_run_now(&self, request: &Request) -> Result<Value, RpcError> {
        let params: AutomationRunNowParams = parse_params(&request.params, "automation.run_now")?;
        let id = require_id(&params.id, "id")?;
        // Effect path with no outer lifecycle-gate guard (see module doc):
        // the nested harness.start takes the gate itself.
        self.ledger.run(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            || {
                check_quiescent(self)?;
                let now_ms = crate::now_unix_ms() as f64;
                let event_identity = format!("manual:{}", request.request_id);
                let (automation, harness) = {
                    let conn = self.db.lock().unwrap();
                    let automation = storage::get_automation(&conn, &id)
                        .map_err(|e| storage_error(format!("automation lookup failed: {e}")))?
                        .ok_or_else(|| not_found(format!("automation {id} not found")))?;
                    let harness = HarnessLaunchParams {
                        harness_id: automation.agent_id.clone(),
                        model: automation.model.clone(),
                        effort: None,
                        provider: automation.provider.clone(),
                        permission_mode: None,
                        // `automation.run_now` is a headless daemon run
                        // (issue #186).
                        headless: true,
                    };
                    (automation, harness)
                };
                let prepared = {
                    let conn = self.db.lock().unwrap();
                    direct::prepare_direct(
                        &conn,
                        &self.host_id,
                        &automation.id,
                        &InvocationReason::Manual,
                        AutomationRunTrigger::Manual,
                        &event_identity,
                        &harness,
                        now_ms,
                    )
                };
                let plan: DirectPlan = match prepared {
                    Err(DirectLookupError::Missing) => {
                        return Err(not_found(format!("automation {id} not found")));
                    }
                    Err(DirectLookupError::Storage(e)) => {
                        return Err(storage_error(format!("run preparation failed: {e}")));
                    }
                    Ok(DirectPrepareOutcome::Refused(refusal)) => {
                        let refusal_text = format!("{refusal:?}");
                        let reschedule = Reschedule {
                            next_run_at: admit_next_run_at(
                                &automation.rrule,
                                &automation.timezone,
                                now_ms,
                            )
                            .unwrap_or(automation.next_run_at),
                            last_run_at: None,
                        };
                        let run_id = {
                            let conn = self.db.lock().unwrap();
                            direct::record_skip(
                                &conn,
                                &automation.id,
                                &runner::derive_request_id(
                                    &self.host_id,
                                    automation.workspace_id.as_deref().unwrap_or("no-workspace"),
                                    "automation",
                                    &automation.id,
                                    &event_identity,
                                ),
                                AutomationRunTrigger::Manual,
                                AutomationRunStatus::SkippedUnavailable,
                                Some(refusal_text.clone()),
                                now_ms,
                                now_ms,
                                reschedule,
                            )
                            .map_err(|e| storage_error(format!("failed to record refusal: {e}")))?
                        };
                        let result = AutomationRunNowResult {
                            automation_id: automation.id,
                            run_id: Some(run_id),
                            outcome: AutomationRunNowOutcome::Refused,
                            status: None,
                            refusal: Some(refusal_text),
                            error: None,
                        };
                        return serde_json::to_value(&result)
                            .map_err(|e| internal_error(e.to_string()));
                    }
                    Ok(DirectPrepareOutcome::Unsupported(unsupported)) => {
                        let text = format!("{unsupported:?}");
                        let result = AutomationRunNowResult {
                            automation_id: automation.id,
                            run_id: None,
                            outcome: AutomationRunNowOutcome::Refused,
                            status: None,
                            refusal: Some(text),
                            error: None,
                        };
                        return serde_json::to_value(&result)
                            .map_err(|e| internal_error(e.to_string()));
                    }
                    Ok(DirectPrepareOutcome::Ready(plan)) => plan,
                };
                let seam = EngineDispatchSeam::new(self);
                let outcome = runner::dispatch_run_plan(&seam, &plan);
                let observed_at = crate::now_unix_ms() as f64;
                let reschedule = Reschedule {
                    next_run_at: admit_next_run_at(&automation.rrule, &automation.timezone, now_ms)
                        .unwrap_or(automation.next_run_at),
                    last_run_at: Some(now_ms),
                };
                let run_id = {
                    let conn = self.db.lock().unwrap();
                    direct::record_direct_outcome(&conn, &plan, &outcome, observed_at, reschedule)
                        .map_err(|e| storage_error(format!("failed to record run: {e}")))?
                };
                let (status, error) = match &outcome {
                    runner::RunnerOutcome::Observed { verdict, .. } => (
                        Some(if verdict == "exited" {
                            AutomationRunStatus::Completed
                        } else {
                            AutomationRunStatus::Dispatched
                        }),
                        None,
                    ),
                    runner::RunnerOutcome::ObservationFailed { error, .. } => (
                        Some(AutomationRunStatus::Dispatched),
                        Some(error.to_string()),
                    ),
                    runner::RunnerOutcome::DispatchFailed(error) => (
                        Some(AutomationRunStatus::DispatchFailed),
                        Some(error.to_string()),
                    ),
                };
                let result = AutomationRunNowResult {
                    automation_id: automation.id,
                    run_id: Some(run_id),
                    outcome: AutomationRunNowOutcome::Dispatched,
                    status: status.map(wire_status),
                    refusal: None,
                    error,
                };
                serde_json::to_value(&result).map_err(|e| internal_error(e.to_string()))
            },
        )
    }

    /// Paged runs across ALL local automations, newest scheduled first:
    /// one query for the runs dashboard instead of one per automation.
    pub(crate) fn automation_runs_all(&self, params: &Value) -> Result<Value, RpcError> {
        let params: AutomationRunsAllParams = parse_params(params, "automation.runs_all")?;
        let page = params.page.unwrap_or(DEFAULT_RUNS_ALL_PAGE);
        let per_page = params.per_page.unwrap_or(DEFAULT_RUNS_ALL_PER_PAGE);
        if page == 0 {
            return Err(invalid_argument("page must be >= 1"));
        }
        if per_page == 0 || per_page > MAX_RUNS_ALL_PER_PAGE {
            return Err(invalid_argument(format!(
                "perPage must be within 1..={MAX_RUNS_ALL_PER_PAGE}"
            )));
        }
        let conn = self.db.lock().unwrap();
        let mut names: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        for automation in storage::list_all_automations(&conn)
            .map_err(|e| storage_error(format!("automation list failed: {e}")))?
        {
            names.insert(automation.id.clone(), automation.name.clone());
        }
        let mut items: Vec<AutomationRunListItem> = Vec::new();
        for (automation_id, runs) in storage::list_all_automation_runs(&conn)
            .map_err(|e| storage_error(format!("run history lookup failed: {e}")))?
        {
            let Some(automation_name) = names.get(&automation_id) else {
                // Runs are deleted with their automation; an orphan row is
                // not surfaced as a dashboard entry.
                continue;
            };
            for run in runs {
                if let Some(status) = params.status
                    && wire_status(run.status) != status
                {
                    continue;
                }
                items.push(AutomationRunListItem {
                    run: view_run(&run),
                    title: run.title.clone(),
                    automation_name: automation_name.clone(),
                });
            }
        }
        // Newest scheduled run first, like the source's dashboard ordering.
        items.sort_by(|a, b| {
            b.run
                .scheduled_for
                .total_cmp(&a.run.scheduled_for)
                .then_with(|| b.run.created_at.total_cmp(&a.run.created_at))
                .then_with(|| a.run.id.cmp(&b.run.id))
        });
        let total = items.len() as u64;
        let start = (page - 1).saturating_mul(per_page);
        let runs: Vec<AutomationRunListItem> = items
            .into_iter()
            .skip(start as usize)
            .take(per_page as usize)
            .collect();
        let result = AutomationRunsAllResult {
            runs,
            page,
            per_page,
            total,
        };
        serde_json::to_value(&result).map_err(|e| internal_error(e.to_string()))
    }

    /// One run's detail for the run page: record fields plus the honestly
    /// available output snapshot and whether the run's session still exists.
    pub(crate) fn automation_run(&self, request: &Request) -> Result<Value, RpcError> {
        let params: AutomationRunParams = parse_params(&request.params, "automation.run")?;
        let run_id = require_id(&params.run_id, "runId")?;
        let conn = self.db.lock().unwrap();
        let run = storage::get_automation_run(&conn, &run_id)
            .map_err(|e| storage_error(format!("run lookup failed: {e}")))?
            .ok_or_else(|| not_found(format!("automation run {run_id} not found")))?;
        let now_ms = crate::now_unix_ms() as f64;
        let (output_snapshot, session_exists) = resolve_output_snapshot(self, &run, now_ms);
        let detail = AutomationRunDetail {
            run: view_run(&run),
            title: run.title.clone(),
            workspace_display_name: run.workspace_display_name.clone().flatten(),
            output_snapshot,
            session_exists,
        };
        serde_json::to_value(&detail).map_err(|e| internal_error(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::admit_next_run_at;
    use crate::automations::scheduler;

    /// Monday 2026-09-07T00:00:00Z in millisecond epoch.
    const MONDAY_MIDNIGHT_MS: f64 = 1_788_739_200_000.0;

    const NY: &str = "America/New_York";
    /// Millisecond epoch for a UTC wall time, taking a 0-based month like
    /// JavaScript `Date.UTC` so vectors read identically on both sides.
    fn utc_ms(year: i32, month0: u32, day: u32, hour: u32, minute: u32) -> f64 {
        let month = month0 + 1;
        let y = if month <= 2 { year - 1 } else { year } as i64;
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let mp = (month as i64 + 9) % 12;
        let doy = (153 * mp + 2) / 5 + day as i64 - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        let days = era * 146_097 + doe - 719_468;
        (days * 86_400_000 + hour as i64 * 3_600_000 + minute as i64 * 60_000) as f64
    }

    #[test]
    fn admission_matches_legacy_utc_evaluation() {
        assert_eq!(utc_ms(2026, 8, 7, 0, 0), MONDAY_MIDNIGHT_MS);
        for cron in ["* * * * *", "30 8 * * *", "0 9 * * 1-5", "0 0 29 2 *"] {
            let legacy = scheduler::next_fire_ms(cron, MONDAY_MIDNIGHT_MS).unwrap() as f64;
            assert_eq!(
                admit_next_run_at(cron, "UTC", MONDAY_MIDNIGHT_MS).unwrap(),
                legacy
            );
            assert_eq!(
                admit_next_run_at(cron, "", MONDAY_MIDNIGHT_MS).unwrap(),
                legacy
            );
        }
    }

    #[test]
    fn admission_applies_gap_policy_in_zone() {
        // Mar 8 2026 02:30 does not exist in America/New_York. Admission
        // stores the native first fire; the tick records the gap skip.
        assert_eq!(
            admit_next_run_at("30 2 * * *", NY, utc_ms(2026, 2, 7, 0, 0)).unwrap(),
            utc_ms(2026, 2, 7, 7, 30)
        );
        // Recomputed from inside the gap day, the stored slot is the
        // shifted first-valid instant the tick will record skipped.
        assert_eq!(
            admit_next_run_at("30 2 * * *", NY, utc_ms(2026, 2, 8, 0, 0)).unwrap(),
            utc_ms(2026, 2, 8, 7, 0)
        );
    }

    #[test]
    fn admission_fires_folds_once_at_the_first_occurrence() {
        // Fixed-time fold: the earlier half only.
        assert_eq!(
            admit_next_run_at("30 1 * * *", NY, utc_ms(2026, 9, 31, 12, 0)).unwrap(),
            utc_ms(2026, 10, 1, 5, 30)
        );
        // Interval fold: first halves only, later halves jumped past.
        assert_eq!(
            admit_next_run_at("*/30 1 * * *", NY, utc_ms(2026, 10, 1, 4, 59)).unwrap(),
            utc_ms(2026, 10, 1, 5, 0)
        );
        assert_eq!(
            admit_next_run_at("*/30 1 * * *", NY, utc_ms(2026, 10, 1, 5, 45)).unwrap(),
            utc_ms(2026, 10, 2, 6, 0)
        );
        // Seconds-grained fold wall inside the overlap.
        assert_eq!(
            admit_next_run_at("30 0 1 * * *", NY, utc_ms(2026, 10, 1, 6, 0)).unwrap(),
            utc_ms(2026, 10, 2, 6, 0) + 30_000.0
        );
    }

    #[test]
    fn zone_edit_scenario_is_deterministic_at_fixed_clocks() {
        use crate::automations::timezone::preview_fires_in_zone;
        // Fixed admission clock: yearly walls, future-ness and
        // first-occurrence hold with zero flake. This vector pins May;
        // the January-window relationship (zones' next fires falling in
        // different years) is covered by the integration wall assertions,
        // which hold for any run date.
        let t0 = utc_ms(2026, 4, 17, 12, 0);
        let utc_next = admit_next_run_at("0 0 1 1 *", "UTC", t0).unwrap();
        let ny_next = admit_next_run_at("0 0 1 1 *", NY, t0).unwrap();
        assert_eq!(utc_next, utc_ms(2027, 0, 1, 0, 0));
        assert_eq!(ny_next, utc_ms(2027, 0, 1, 0, 0) + 5.0 * 3_600_000.0);
        assert!(utc_next > t0 && ny_next > t0);
        assert_eq!(
            preview_fires_in_zone("0 0 1 1 *", "UTC", t0, 1)
                .unwrap()
                .fires[0] as f64,
            utc_next
        );
        assert_eq!(
            preview_fires_in_zone("0 0 1 1 *", NY, t0, 1).unwrap().fires[0] as f64,
            ny_next
        );
    }

    #[test]
    fn admission_rejects_schedules_with_no_future_fire() {
        assert!(admit_next_run_at("0 0 31 2 *", "UTC", MONDAY_MIDNIGHT_MS).is_err());
    }
}
