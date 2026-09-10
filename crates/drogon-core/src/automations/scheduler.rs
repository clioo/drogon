//! Cron tick loop for standalone automations, owned by the daemon.
//!
//! Every [`TICK_INTERVAL`] the loop lists stored automations and fires the
//! ones whose cron schedule is due, dispatching through the existing
//! [`runner::dispatch_run_plan`](super::runner::dispatch_run_plan) seam
//! (via the shared [`runner::DispatchPlan`](super::runner::DispatchPlan)
//! projection) with the existing refusal evaluation
//! ([`execution::evaluate_dispatch`](super::execution::evaluate_dispatch))
//! and the durable run-row recording in [`super::direct`].
//!
//! ## Schedule encoding
//!
//! A standalone automation carries its cron expression in
//! [`Automation::rrule`](super::records::Automation::rrule) -- the same
//! field the reference implementation uses for both RRULE and cron
//! schedules. Rows whose `rrule` is a legacy `FREQ=...` RRULE (written by
//! the Bot scheduled-responsibility flow) are not cron schedules: the tick
//! leaves them alone entirely. [`is_cron_schedule`] distinguishes the two.
//!
//! ## Time model
//!
//! All automation timestamps are millisecond-epoch `f64` (see
//! `crate::now_unix_ms`). Cron evaluation runs in the automation's
//! stored IANA zone ([`Automation::timezone`](super::records::Automation::timezone),
//! resolved by [`super::timezone`]); rows stored without a zone evaluate
//! in UTC exactly as before. A `* * * * *` schedule therefore fires at
//! the top of every minute in its zone.
//!
//! ## Missed runs
//!
//! [`MissedRunPolicy::RunOnceWithinGrace`](super::records::MissedRunPolicy)
//! is honored per slot: a due slot reached within
//! `missed_run_grace_minutes` of `next_run_at` still dispatches once; a
//! slot past grace records one `SkippedMissed` run and reschedules without
//! dispatching, so a long daemon outage yields one skip row, never a
//! catch-up storm.
//!
//! ## Shutdown
//!
//! The loop exits when the engine reports [`Engine::is_quiescent`] (a
//! frozen service never starts new work) or when the owner calls
//! [`SchedulerHandle::shutdown`]. [`tick_once`] is the synchronous,
//! clock-injected core so tests drive fixed clocks without threads.

use std::cmp::Ordering;
use std::str::FromStr;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering as AtomicOrdering},
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use croner::time::{CivilDate, CivilDateTime, CivilTime, Resolution, Weekday};
use croner::{Cron, CronDateTime};

use super::direct::{
    self, DirectLookupError, DirectPlan, DirectPrepareOutcome, ReconcileOutcome, Reschedule,
    SessionEvidence,
};
use super::execution::InvocationReason;
use super::records::{Automation, AutomationRunStatus, AutomationRunTrigger};
use super::runner::{EngineDispatchSeam, HarnessLaunchParams, RunRefusal, RunUnsupported};
use crate::Engine;

/// Production tick period: due automations are evaluated this often.
pub const TICK_INTERVAL: Duration = Duration::from_secs(15);

/// Cron expressions are one line; this cap rejects pasted documents, not
/// schedules (the reference allows 2 KiB, which is already generous).
pub const CRON_EXPRESSION_MAX_BYTES: usize = 256;

/// A Unix timestamp in whole seconds, viewed as UTC. Implements
/// [`CronDateTime`] so cron evaluation needs no date/time crate beyond
/// `croner` itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct UnixUtc(i64);

fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y } as i32, m, d)
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

fn civil_of(unix_secs: i64) -> CivilDateTime {
    let days = unix_secs.div_euclid(86_400);
    let rem = unix_secs.rem_euclid(86_400);
    let (y, mo, d) = civil_from_days(days);
    CivilDateTime::new(
        CivilDate::from_parts_unchecked(y, mo, d),
        CivilTime::from_parts_unchecked(
            (rem / 3600) as u32,
            ((rem % 3600) / 60) as u32,
            (rem % 60) as u32,
        ),
    )
}

impl CronDateTime for UnixUtc {
    fn to_civil(&self) -> CivilDateTime {
        civil_of(self.0)
    }

    fn civil_weekday(&self) -> Weekday {
        // 1970-01-01 was a Thursday (4 days after Sunday).
        Weekday::from_days_from_sunday(
            self.0
                .div_euclid(86_400)
                .rem_euclid(7)
                .wrapping_add(4)
                .rem_euclid(7) as u32,
        )
    }

    fn resolve_civil(
        &self,
        civil: CivilDateTime,
    ) -> Result<Resolution<Self>, croner::errors::CronError> {
        use croner::errors::CronError;
        let date = CivilDate::from_ymd_opt(civil.year(), civil.month(), civil.day())
            .ok_or(CronError::InvalidDate)?;
        let _ = date;
        let time = CivilTime::from_hms_opt(civil.hour(), civil.minute(), civil.second())
            .ok_or(CronError::InvalidTime)?;
        let _ = time;
        let secs = days_from_civil(civil.year(), civil.month(), civil.day()) * 86_400
            + i64::from(civil.hour()) * 3600
            + i64::from(civil.minute()) * 60
            + i64::from(civil.second());
        Ok(Resolution::Single(UnixUtc(secs)))
    }

    fn checked_add_seconds(&self, seconds: i64) -> Option<Self> {
        self.0.checked_add(seconds).map(UnixUtc)
    }

    fn cmp_instant(&self, other: &Self) -> Ordering {
        self.0.cmp(&other.0)
    }
}

/// Strict cron validation shared by `create`/`update` and the tick: trims,
/// byte-caps, then parses. Returns the canonical trimmed expression.
pub fn validate_cron(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("cron expression must not be empty".to_string());
    }
    if trimmed.len() > CRON_EXPRESSION_MAX_BYTES {
        return Err(format!(
            "cron expression must be at most {CRON_EXPRESSION_MAX_BYTES} bytes"
        ));
    }
    if trimmed.bytes().any(|b| b.is_ascii_control()) {
        return Err("cron expression must not contain control characters".to_string());
    }
    Cron::from_str(trimmed).map_err(|e| format!("invalid cron expression: {e}"))?;
    Ok(trimmed.to_string())
}

/// True when `rrule` parses as a cron expression (as opposed to a legacy
/// `FREQ=...` RRULE written by the Bot flow, which the tick ignores).
pub fn is_cron_schedule(rrule: &str) -> bool {
    validate_cron(rrule).is_ok()
}

/// Next cron fire strictly after `after_ms` (millisecond epoch), as
/// millisecond epoch. `None` when the expression never fires again or the
/// search fails -- callers keep the stored `next_run_at` in that case,
/// never a fabricated time.
pub fn next_fire_ms(cron_expr: &str, after_ms: f64) -> Option<i64> {
    let cron = Cron::from_str(cron_expr.trim()).ok()?;
    let after_secs = (after_ms / 1000.0).floor() as i64;
    let next = cron
        .find_next_occurrence(&UnixUtc(after_secs), false)
        .ok()?;
    next.0.checked_mul(1000)
}

/// Due when the automation is enabled, carries a cron schedule, has
/// started (`now >= dtstart`), and its stored `next_run_at` has passed.
pub fn is_due(automation: &Automation, now_ms: f64) -> bool {
    automation.enabled
        && now_ms >= automation.dtstart
        && is_cron_schedule(&automation.rrule)
        && now_ms >= automation.next_run_at
}

/// Outcome counts for one [`tick_once`], for tests and operator logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TickSummary {
    pub checked: usize,
    pub fired: usize,
    pub skipped_missed: usize,
    pub refused: usize,
    pub failed: usize,
    /// Previously `Dispatched` runs the tick finalized as `Completed`
    /// (session exited, or the agent's turn ended after dispatch).
    pub completed: usize,
    /// Previously `Dispatched` runs whose session is gone from this
    /// process: closed out as `DispatchFailed` without claiming
    /// completion, never silently left behind.
    pub stranded: usize,
}

fn harness_for(automation: &Automation) -> HarnessLaunchParams {
    HarnessLaunchParams {
        harness_id: automation.agent_id.clone(),
        model: automation.model.clone(),
        effort: None,
        provider: automation.provider.clone(),
        permission_mode: None,
        // Scheduler fires are headless daemon runs (issue #186).
        headless: true,
    }
}

fn reschedule_after(automation: &Automation, now_ms: f64, ran: bool) -> Reschedule {
    Reschedule {
        next_run_at: super::timezone::next_native_fire_ms(
            &automation.rrule,
            &automation.timezone,
            now_ms,
        )
        .map(|ms| ms as f64)
        .unwrap_or(automation.next_run_at),
        last_run_at: if ran { Some(now_ms) } else { None },
    }
}

fn refusal_text(refusal: &RunRefusal) -> String {
    match refusal {
        RunRefusal::Responsibility(_) => "responsibility refused dispatch".to_string(),
        RunRefusal::Automation(e) => format!("automation refused dispatch: {e:?}"),
        RunRefusal::MissingWorkspaceId => "automation has no workspace to run in".to_string(),
        RunRefusal::UnknownWorkspace(id) => format!("workspace {id} not found"),
        RunRefusal::ForeignWorkspaceHost {
            workspace_id,
            workspace_host_id,
            current_host_id,
        } => format!(
            "workspace {workspace_id} belongs to host {workspace_host_id}, not {current_host_id}"
        ),
    }
}

fn unsupported_text(unsupported: &RunUnsupported) -> String {
    match unsupported {
        RunUnsupported::NewPerRunWorkspaceMode => {
            "new-per-run workspace creation is not supported by the local scheduler".to_string()
        }
        RunUnsupported::ReactiveDispatchParamsNotWired => {
            "reactive dispatch is not supported by the local scheduler".to_string()
        }
    }
}

/// Pure supersede check behind [`is_stale_evaluation`]: any difference
/// on an evaluation-relevant field means the snapshot's slot identity
/// (`scheduled:{next_run_at}`) or dispatch parameters no longer describe
/// the stored schedule, so the evaluation must not dispatch.
fn is_superseded(snapshot: &Automation, fresh: &Automation) -> bool {
    fresh.rrule != snapshot.rrule
        || fresh.next_run_at != snapshot.next_run_at
        || fresh.enabled != snapshot.enabled
        || fresh.timezone != snapshot.timezone
}

/// True when the tick's listed snapshot no longer matches the stored
/// row on an evaluation-relevant field: a schedule edit landed between
/// the tick's list and this fire. A stale evaluation never dispatches a
/// superseded schedule -- the fresh row is re-evaluated on the next tick
/// with its own slot identity -- and never records, so history stays
/// clean. Reads the row fresh (one row, only for due automations).
fn is_stale_evaluation(engine: &Engine, automation: &Automation) -> bool {
    let fresh = {
        let conn = engine.db.lock().unwrap();
        match super::storage::get_automation(&conn, &automation.id) {
            Ok(row) => row,
            Err(e) => {
                eprintln!(
                    "[automations] tick re-read failed for {}: {e}",
                    automation.id
                );
                return true;
            }
        }
    };
    let Some(fresh) = fresh else {
        // Deleted between list and fire: nothing to dispatch or record.
        return true;
    };
    is_superseded(automation, &fresh)
}

/// Fires one due automation: a DST-gap slot records a skip (never
/// dispatches), a missed-past-grace slot records a skip, otherwise
/// prepares, dispatches through the existing runner seam, and records.
/// Holds no database guard across the seam call.
fn fire_due(engine: &Engine, automation: &Automation, now_ms: f64) -> TickFire {
    if is_stale_evaluation(engine, automation) {
        return TickFire::Stale;
    }
    if let Some(gap) = super::timezone::gap_skip_for_slot(
        &automation.rrule,
        &automation.timezone,
        automation.next_run_at,
    ) {
        let reschedule = reschedule_after(automation, now_ms, false);
        let recorded = {
            let conn = engine.db.lock().unwrap();
            direct::record_skip(
                &conn,
                &automation.id,
                &slot_request_id(engine, automation),
                AutomationRunTrigger::Scheduled,
                AutomationRunStatus::SkippedMissed,
                Some(gap.reason),
                automation.next_run_at,
                now_ms,
                reschedule,
            )
        };
        return match recorded {
            Ok(_) => TickFire::SkippedMissed,
            Err(e) => {
                eprintln!(
                    "[automations] failed to record gap skip for {}: {e}",
                    automation.id
                );
                TickFire::Failed
            }
        };
    }
    let grace_ms = automation.missed_run_grace_minutes * 60.0 * 1000.0;
    if now_ms > automation.next_run_at + grace_ms {
        let reschedule = reschedule_after(automation, now_ms, false);
        let recorded = {
            let conn = engine.db.lock().unwrap();
            direct::record_skip(
                &conn,
                &automation.id,
                &slot_request_id(engine, automation),
                AutomationRunTrigger::Scheduled,
                AutomationRunStatus::SkippedMissed,
                Some(format!(
                    "missed scheduled run for {} (past {} minute grace)",
                    automation.next_run_at, automation.missed_run_grace_minutes
                )),
                automation.next_run_at,
                now_ms,
                reschedule,
            )
        };
        return match recorded {
            Ok(_) => TickFire::SkippedMissed,
            Err(e) => {
                eprintln!(
                    "[automations] failed to record missed skip for {}: {e}",
                    automation.id
                );
                TickFire::Failed
            }
        };
    }
    let event_identity = format!("scheduled:{}", automation.next_run_at as i64);
    let prepared = {
        let conn = engine.db.lock().unwrap();
        direct::prepare_direct(
            &conn,
            &engine.host_id,
            &automation.id,
            &InvocationReason::ScheduledDue,
            AutomationRunTrigger::Scheduled,
            &event_identity,
            &harness_for(automation),
            now_ms,
        )
    };
    let plan: DirectPlan = match prepared {
        Err(DirectLookupError::Missing) => return TickFire::Failed,
        Err(DirectLookupError::Storage(e)) => {
            eprintln!("[automations] prepare failed for {}: {e}", automation.id);
            return TickFire::Failed;
        }
        Ok(DirectPrepareOutcome::Refused(refusal)) => {
            let reschedule = reschedule_after(automation, now_ms, false);
            let recorded = {
                let conn = engine.db.lock().unwrap();
                direct::record_skip(
                    &conn,
                    &automation.id,
                    &slot_request_id(engine, automation),
                    AutomationRunTrigger::Scheduled,
                    AutomationRunStatus::SkippedUnavailable,
                    Some(refusal_text(&refusal)),
                    automation.next_run_at,
                    now_ms,
                    reschedule,
                )
            };
            if let Err(e) = recorded {
                eprintln!(
                    "[automations] failed to record refusal skip for {}: {e}",
                    automation.id
                );
                return TickFire::Failed;
            }
            return TickFire::Refused;
        }
        Ok(DirectPrepareOutcome::Unsupported(unsupported)) => {
            let reschedule = reschedule_after(automation, now_ms, false);
            let recorded = {
                let conn = engine.db.lock().unwrap();
                direct::record_skip(
                    &conn,
                    &automation.id,
                    &slot_request_id(engine, automation),
                    AutomationRunTrigger::Scheduled,
                    AutomationRunStatus::SkippedUnavailable,
                    Some(unsupported_text(&unsupported)),
                    automation.next_run_at,
                    now_ms,
                    reschedule,
                )
            };
            if let Err(e) = recorded {
                eprintln!(
                    "[automations] failed to record unsupported skip for {}: {e}",
                    automation.id
                );
                return TickFire::Failed;
            }
            return TickFire::Refused;
        }
        Ok(DirectPrepareOutcome::Ready(plan)) => plan,
    };
    let seam = EngineDispatchSeam::new(engine);
    let outcome = super::runner::dispatch_run_plan(&seam, &plan);
    let observed_at = now_after_dispatch();
    let reschedule = reschedule_after(automation, now_ms, true);
    let recorded = {
        let conn = engine.db.lock().unwrap();
        direct::record_direct_outcome(&conn, &plan, &outcome, observed_at, reschedule)
    };
    match recorded {
        Ok(_) => TickFire::Fired,
        Err(e) => {
            eprintln!(
                "[automations] failed to record run outcome for {}: {e}",
                automation.id
            );
            TickFire::Failed
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TickFire {
    Fired,
    SkippedMissed,
    Refused,
    Failed,
    /// The listed snapshot was superseded by a schedule edit (or the row
    /// was deleted) before this fire ran: nothing dispatched, nothing
    /// recorded; the fresh row is re-evaluated on the next tick.
    Stale,
}

/// Stable per-slot request id so a retried tick for the same slot upserts
/// rather than duplicating history.
fn slot_request_id(engine: &Engine, automation: &Automation) -> String {
    let workspace = automation.workspace_id.as_deref().unwrap_or("no-workspace");
    super::runner::derive_request_id(
        &engine.host_id,
        workspace,
        "automation",
        &automation.id,
        &format!("scheduled:{}", automation.next_run_at as i64),
    )
}

fn now_after_dispatch() -> f64 {
    crate::now_unix_ms() as f64
}

/// One synchronous scheduler pass over all stored automations at `now_ms`.
/// Never starts work on a quiescent engine. Holds no database guard across
/// any seam call.
pub fn tick_once(engine: &Engine, now_ms: f64) -> TickSummary {
    let mut summary = TickSummary::default();
    if engine.is_quiescent() {
        return summary;
    }
    let automations = {
        let conn = engine.db.lock().unwrap();
        match super::storage::list_all_automations(&conn) {
            Ok(list) => list,
            Err(e) => {
                eprintln!("[automations] tick list failed: {e}");
                return summary;
            }
        }
    };
    for automation in &automations {
        summary.checked += 1;
        if !is_due(automation, now_ms) {
            continue;
        }
        match fire_due(engine, automation, now_ms) {
            TickFire::Fired => summary.fired += 1,
            TickFire::SkippedMissed => summary.skipped_missed += 1,
            TickFire::Refused => summary.refused += 1,
            TickFire::Failed => summary.failed += 1,
            TickFire::Stale => {}
        }
    }
    reconcile_outstanding(engine, now_ms, &mut summary);
    summary
}

/// Reads one live handle's verdict/agent-state projection without holding
/// any database guard: `snapshot` only locks the handle's own cells.
fn session_evidence(engine: &Engine, session_id: &str) -> Option<SessionEvidence> {
    let handle = engine.sessions.lock().unwrap().get(session_id).cloned()?;
    let snap = crate::session::snapshot(&handle);
    Some(SessionEvidence {
        verdict: snap.get("verdict")?.as_str()?.to_string(),
        exit_code: snap.get("exitCode").and_then(serde_json::Value::as_i64),
        agent_state: snap.get("agentState")?.as_str()?.to_string(),
        agent_state_at: snap
            .get("agentStateAt")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        incarnation: snap.get("incarnation")?.as_str()?.to_string(),
    })
}

/// Finalizes previously `Dispatched` runs whose terminal state is now
/// provable: an exited session, or a live session whose agent went
/// `idle` (the reference's busy-to-idle edge, restored for issue #360)
/// or reported a turn-ending wait signal after dispatch. Sessions gone
/// from this process close out
/// as stranded, never as completed. Holds no database guard across the
/// per-handle snapshot reads; each row finalizes in its own transaction.
fn reconcile_outstanding(engine: &Engine, now_ms: f64, summary: &mut TickSummary) {
    let candidates = {
        let conn = engine.db.lock().unwrap();
        match super::storage::list_all_automation_runs(&conn) {
            Ok(all) => all
                .into_iter()
                .flat_map(|(_, runs)| runs)
                .filter(|run| {
                    run.status == AutomationRunStatus::Dispatched
                        && run.terminal_session_id.is_some()
                })
                .map(|run| {
                    (
                        run.id.clone(),
                        run.terminal_session_id.clone().unwrap_or_default(),
                    )
                })
                .collect::<Vec<_>>(),
            Err(e) => {
                eprintln!("[automations] reconcile list failed: {e}");
                return;
            }
        }
    };
    for (run_id, session_id) in candidates {
        let evidence = session_evidence(engine, &session_id);
        let outcome = {
            let conn = engine.db.lock().unwrap();
            let run = match super::storage::get_automation_run(&conn, &run_id) {
                Ok(Some(run)) if run.status == AutomationRunStatus::Dispatched => run,
                Ok(_) => continue,
                Err(e) => {
                    eprintln!("[automations] reconcile read failed for {run_id}: {e}");
                    continue;
                }
            };
            direct::reconcile_decision(&run, evidence.as_ref())
        };
        match outcome {
            ReconcileOutcome::Running => {}
            ReconcileOutcome::Exited { .. } | ReconcileOutcome::TurnEnded => {
                match direct::apply_reconcile(&engine.db.lock().unwrap(), &run_id, outcome, now_ms)
                {
                    Ok(true) => summary.completed += 1,
                    Ok(false) => {}
                    Err(e) => {
                        eprintln!("[automations] reconcile finalize failed for {run_id}: {e}")
                    }
                }
            }
            ReconcileOutcome::Stranded => {
                match direct::apply_reconcile(&engine.db.lock().unwrap(), &run_id, outcome, now_ms)
                {
                    Ok(true) => summary.stranded += 1,
                    Ok(false) => {}
                    Err(e) => {
                        eprintln!("[automations] reconcile strand failed for {run_id}: {e}")
                    }
                }
            }
        }
    }
}

/// Owned background tick loop. [`shutdown`](SchedulerHandle::shutdown)
/// stops it; dropping without shutdown detaches (the loop also exits on
/// engine quiescence).
pub struct SchedulerHandle {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl SchedulerHandle {
    pub fn shutdown(&mut self) {
        self.stop.store(true, AtomicOrdering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }

    pub fn is_stopped(&self) -> bool {
        self.stop.load(AtomicOrdering::Acquire)
    }
}

/// Spawns the daemon-owned tick loop on a plain OS thread (the daemon is
/// synchronous; no async runtime is required for a 15 s poll).
pub fn spawn(engine: Arc<Engine>, interval: Duration) -> SchedulerHandle {
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    let thread = thread::Builder::new()
        .name("drogon-automation-scheduler".to_string())
        .spawn(move || {
            while !stopped.load(AtomicOrdering::Acquire) {
                let now_ms = crate::now_unix_ms() as f64;
                let _ = tick_once(&engine, now_ms);
                if engine.is_quiescent() {
                    break;
                }
                let step = Duration::from_millis(100);
                let mut waited = Duration::ZERO;
                while waited < interval && !stopped.load(AtomicOrdering::Acquire) {
                    thread::sleep(step.min(interval - waited));
                    waited += step;
                }
            }
        })
        .expect("automation scheduler thread spawns");
    SchedulerHandle {
        stop,
        thread: Some(thread),
    }
}

impl Drop for SchedulerHandle {
    fn drop(&mut self) {
        self.stop.store(true, AtomicOrdering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::super::records::{
        Automation, ExecutionTargetType, MissedRunPolicy, SchedulerOwner, WorkspaceMode,
    };
    use super::is_superseded;

    fn sample(id: &str) -> Automation {
        Automation {
            id: id.to_string(),
            creation_key: None,
            name: "sweep".to_string(),
            prompt: "do the thing".to_string(),
            precheck: None,
            agent_id: "pi".to_string(),
            model: None,
            provider: None,
            run_context: None,
            source_context: None,
            project_id: "w1".to_string(),
            execution_target_type: ExecutionTargetType::Local,
            execution_target_id: "host-1".to_string(),
            execution_target_generation: None,
            scheduler_owner: SchedulerOwner::LocalHostService,
            workspace_mode: WorkspaceMode::Existing,
            workspace_id: Some("w1".to_string()),
            base_branch: None,
            setup_decision: None,
            reuse_session: false,
            timezone: "UTC".to_string(),
            rrule: "* * * * *".to_string(),
            dtstart: 0.0,
            enabled: true,
            next_run_at: 1000.0,
            last_run_at: None,
            missed_run_policy: MissedRunPolicy::RunOnceWithinGrace,
            missed_run_grace_minutes: 15.0,
            created_at: 0.0,
            updated_at: 0.0,
            bot_id: None,
        }
    }

    #[test]
    fn identical_rows_are_not_superseded() {
        assert!(!is_superseded(&sample("a"), &sample("a")));
    }

    #[test]
    fn schedule_edits_supersede_the_listed_snapshot() {
        let snapshot = sample("a");
        let mut cron_edit = sample("a");
        cron_edit.rrule = "0 9 * * *".to_string();
        assert!(is_superseded(&snapshot, &cron_edit));
        let mut slot_edit = sample("a");
        slot_edit.next_run_at = 2000.0;
        assert!(is_superseded(&snapshot, &slot_edit));
        let mut zone_edit = sample("a");
        zone_edit.timezone = "America/New_York".to_string();
        assert!(is_superseded(&snapshot, &zone_edit));
        let mut disable = sample("a");
        disable.enabled = false;
        assert!(is_superseded(&snapshot, &disable));
    }

    #[test]
    fn prompt_only_edits_do_not_supersede_evaluation() {
        // A prompt/harness edit keeps the slot identity, so the due slot
        // still fires (with the fresh row's prompt); only schedule fields
        // version the evaluation.
        let snapshot = sample("a");
        let mut prompt_edit = sample("a");
        prompt_edit.prompt = "new prompt".to_string();
        prompt_edit.updated_at = 5000.0;
        assert!(!is_superseded(&snapshot, &prompt_edit));
    }
}
