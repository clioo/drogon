//! Monitor-event delegation: the chain from a committed monitor change to
//! a Bot responsibility run that creates a worktree, opens a session, and
//! sends a prompt.
//!
//! The producer is the P2 monitor tick
//! ([`crate::bot_self_mgmt::tick_bot_monitors`]), which writes one row per
//! change into the `bot_monitor_events` outbox in the same transaction as
//! the cursor advance — never one without the other. This module drains
//! that outbox, oldest first, in the scheduler tick tail:
//!
//! ```text
//! outbox row → stale-grace check → monitor policy (`ExplicitResponsibility`)
//!   → responsibility gate (`bots::policy`, `ReactiveEvent(Some(event_id))`)
//!   → per-day cap → idempotent dispatch (`runner::dispatch_run_plan`)
//!   → run row + outbox delete + cap bump, atomically
//! ```
//!
//! ## Claim protocol: delete-on-record (pinned by tests)
//!
//! There is deliberately NO claim column. An event is claimed by deleting
//! it in the same `BEGIN IMMEDIATE` transaction that writes the
//! responsibility-run row and bumps the daily cap. A crash between dispatch
//! and record leaves the event queued, and the redelivery *joins* the
//! existing run (same event id → same [`derive_request_id`] → same run-row
//! id) instead of opening a second session or naming a second worktree.
//! At-least-once delivery with an idempotent consumer — never at-most-once
//! with silent loss.
//!
//! ## What this module never does
//!
//! - Never interpolates watched content into prompts. [`build_delegation_prompt`]
//!   takes only event metadata and responsibility metadata; there is no
//!   parameter for file bytes, so raw watched content cannot physically
//!   enter the prompt (the template rule, enforced by construction and by
//!   test).
//! - Never invents a workspace or a harness mapping. The workspace resolves
//!   from the Bot's own folder row; the harness resolves from the Bot's
//!   stored policy via [`harness_overrides`](crate::bots::policy::harness_overrides).
//!   Either absent → honest refusal, event deleted, no fabricated dispatch.
//! - Never dispatches `NotificationOnly` monitors. Their outbox rows are
//!   another lane's retained evidence: the peek join admits only bound
//!   monitors, so unbound rows are never claimed, never dispatched, and
//!   never deleted here. Inference runs only for an explicitly bound
//!   responsibility.
//! - Never floods: [`MAX_DELEGATIONS_PER_BOT_PER_DAY`] bounds one bot, and
//!   [`MAX_DRAIN_PER_TICK`] bounds one tick. A tripped cap deletes the
//!   excess event and counts it (`cap_exceeded`); the durable daily-count
//!   row is the honest state a status surface reads back.

use std::collections::HashSet;
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};

use crate::automations::execution::InvocationReason;
use crate::automations::runner::{
    self, DispatchPlan, DispatchSeam, HarnessLaunchParams, RunnerOutcome,
};
use crate::automations::storage as automations_storage;
use crate::bots::monitors::{
    MonitorRecord, policy::MonitorInferencePolicy, storage as monitor_storage,
};
use crate::bots::policy as bots_policy;
use crate::bots::records::{
    HostObservation, ResponsibilityRun, ResponsibilityRunInvocation, ResponsibilityTrigger,
};
use crate::bots::storage as bots_storage;

pub const DELEGATION_SCHEMA_COMPONENT: &str = "bot_delegation";
pub const DELEGATION_SCHEMA_VERSION: i64 = 1;

/// A stale outbox event is skipped, never caught up: past this age an event
/// describes a world the daemon was not watching, and dispatching it would
/// be a catch-up storm after an outage. Mirrors the scheduler's
/// missed-run-grace shape (`scheduler::fire_due`).
pub const DELEGATION_GRACE_MS: f64 = 30.0 * 60.0 * 1000.0;

/// Anti-flood bound: one flapping monitor may delegate at most this many
/// runs per bot per UTC day. Excess events are dropped with an honest
/// `cap_exceeded` count, never queued behind an unbounded backlog.
pub const MAX_DELEGATIONS_PER_BOT_PER_DAY: i64 = 10;

/// Per-tick bound on claimed events, so one crowded outbox cannot stall
/// the 15 s tick (same scale as the script-runner concurrency cap).
pub const MAX_DRAIN_PER_TICK: usize = 4;

#[derive(Debug)]
pub enum DelegationError {
    Sqlite(rusqlite::Error),
    Json(serde_json::Error),
    Storage(String),
    UnsupportedSchemaVersion { found: i64, supported: i64 },
}

impl From<rusqlite::Error> for DelegationError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

impl From<serde_json::Error> for DelegationError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

impl From<automations_storage::StorageError> for DelegationError {
    fn from(value: automations_storage::StorageError) -> Self {
        Self::Storage(format!("automation store error: {value}"))
    }
}

impl From<bots_storage::StorageError> for DelegationError {
    fn from(value: bots_storage::StorageError) -> Self {
        Self::Storage(format!("bot store error: {value}"))
    }
}

impl std::fmt::Display for DelegationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sqlite(e) => write!(f, "sqlite error: {e}"),
            Self::Json(e) => write!(f, "json error: {e}"),
            Self::Storage(message) => write!(f, "{message}"),
            Self::UnsupportedSchemaVersion { found, supported } => write!(
                f,
                "{DELEGATION_SCHEMA_COMPONENT} schema version {found} is newer than the {supported} this build supports"
            ),
        }
    }
}

impl std::error::Error for DelegationError {}

type Result<T> = std::result::Result<T, DelegationError>;

/// One committed monitor change awaiting delegation. Carries metadata only:
/// ids, cursor digest, scope, and timestamps — never watched bytes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegationEvent {
    pub event_id: String,
    pub monitor_id: String,
    pub monitor_version: u64,
    pub cursor: String,
    pub host_id: String,
    pub project_id: String,
    pub resource: String,
    pub bot_id: Option<String>,
    pub observed_at_ms: f64,
}

fn create_tables(tx: &Transaction) -> Result<()> {
    // The outbox itself (`bot_monitor_events`) belongs to the BotSelf
    // component (`bot_self_mgmt::record_monitor_event_in_tx` writes it);
    // this component owns only the delegation budget rows. Forward, never
    // duplicated here.
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS bot_delegation_daily (
            bot_id TEXT NOT NULL,
            day_utc INTEGER NOT NULL,
            count INTEGER NOT NULL,
            PRIMARY KEY (bot_id, day_utc)
        );",
    )?;
    Ok(())
}

pub fn check_schema_not_ahead(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_versions (
            component TEXT PRIMARY KEY,
            version INTEGER NOT NULL
        );",
    )?;
    let existing: Option<i64> = conn
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![DELEGATION_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(found) = existing
        && found > DELEGATION_SCHEMA_VERSION
    {
        return Err(DelegationError::UnsupportedSchemaVersion {
            found,
            supported: DELEGATION_SCHEMA_VERSION,
        });
    }
    Ok(())
}

/// Aggregate-startup shape for `db::migrate_and_recover`: creates both
/// tables (or refuses loudly on a newer recorded version) inside the
/// caller's transaction. Additive `CREATE TABLE IF NOT EXISTS` — safe to
/// adopt on databases that predate the delegation chain.
pub(crate) fn apply_pending_steps_in_tx(tx: &Transaction) -> Result<()> {
    check_schema_not_ahead(tx)?;
    let existing: Option<i64> = tx
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![DELEGATION_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    if existing.is_none() {
        create_tables(tx)?;
        tx.execute(
            "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)",
            params![DELEGATION_SCHEMA_COMPONENT, DELEGATION_SCHEMA_VERSION],
        )?;
    }
    Ok(())
}

/// Standalone migration for controlled (test) databases. Production goes
/// through [`apply_pending_steps_in_tx`] via the aggregate gate.
pub fn migrate(conn: &Connection) -> Result<()> {
    check_schema_not_ahead(conn)?;
    let existing: Option<i64> = conn
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![DELEGATION_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    if existing.is_some() {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    create_tables(&tx)?;
    tx.execute(
        "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)",
        params![DELEGATION_SCHEMA_COMPONENT, DELEGATION_SCHEMA_VERSION],
    )?;
    tx.commit()?;
    Ok(())
}

/// Oldest-first peek at the P2 outbox (read-only, no claim — the claim is
/// the delete in the record transaction), restricted to monitors that
/// opted into the chain (`inferencePolicy.kind = explicit_responsibility`).
/// Unbound monitors' rows are another component's retained evidence
/// (their tests assert those rows persist) — this drain never touches
/// them, and the join means an unbound backlog can never starve a bound
/// event behind the per-tick bound. Rows whose payload no longer parses
/// (or whose id disagrees with its own payload) come back as poison the
/// caller orphans instead of retrying forever.
fn peek_oldest(conn: &Connection, limit: usize) -> Result<Vec<PeekedEvent>> {
    let mut stmt = conn.prepare(
        "SELECT e.event_id, e.payload_json FROM bot_monitor_events e
         JOIN bot_monitors m ON m.id = e.monitor_id
         WHERE json_extract(m.payload_json, '$.inferencePolicy.kind')
               = 'explicit_responsibility'
         ORDER BY e.at, e.rowid LIMIT ?1",
    )?;
    let rows = stmt
        .query_map(params![limit as i64], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .map(|(event_id, payload_json)| {
            match serde_json::from_str::<DelegationEvent>(&payload_json) {
                Ok(event) if event.event_id == event_id => PeekedEvent::Event(event),
                _ => PeekedEvent::Poison(event_id),
            }
        })
        .collect())
}

/// One peeked outbox row: a well-formed delegation event, or a poison row
/// the drain orphans instead of spinning on.
enum PeekedEvent {
    Event(DelegationEvent),
    Poison(String),
}

fn delete_event(conn: &Connection, event_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM bot_monitor_events WHERE event_id = ?1",
        params![event_id],
    )?;
    Ok(())
}

/// Whether both P2 tables this drain reads exist yet. Databases that
/// predate the BotSelf/BotMonitors components' adoption (or unit-test
/// databases that never migrated them) drain to an empty summary, never
/// an error.
fn outbox_table_exists(conn: &Connection) -> bool {
    let has = |name: &str| {
        conn.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1")
            .and_then(|mut stmt| stmt.exists(params![name]))
            .unwrap_or(false)
    };
    has("bot_monitor_events") && has("bot_monitors")
}

/// Terminal-verdict buckets for [`delete_counted`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeleteBucket {
    Orphaned,
    Refused,
    JoinedExisting,
    CapExceeded,
}

/// Delete-or-count helper for terminal verdicts: a failed delete keeps the
/// event queued and counts `failed` instead of the intended bucket, so no
/// path can silently drop an event.
fn delete_counted(
    db: &Mutex<Connection>,
    event_id: &str,
    summary: &mut DelegationSummary,
    bucket: DeleteBucket,
) {
    match delete_event(&db.lock().unwrap(), event_id) {
        Ok(()) => match bucket {
            DeleteBucket::Orphaned => summary.orphaned += 1,
            DeleteBucket::Refused => summary.refused += 1,
            DeleteBucket::JoinedExisting => summary.joined_existing += 1,
            DeleteBucket::CapExceeded => summary.cap_exceeded += 1,
        },
        Err(e) => {
            eprintln!("[delegation] delete failed for {event_id}: {e}");
            summary.failed += 1;
        }
    }
}

/// Whole UTC days since the epoch. Integer day numbers (not formatted
/// dates) so the cap needs no date/time crate and cannot drift on format.
pub fn utc_day_number(now_ms: f64) -> i64 {
    (now_ms / 86_400_000.0).floor() as i64
}

/// Honest cap state for status surfaces (`bot.monitor_list` reports
/// "delegations today: used/max"): how many runs this bot has consumed
/// of today's budget. Reads the same durable row the drain bumps.
pub fn delegations_used_today(conn: &Connection, bot_id: &str, now_ms: f64) -> Result<i64> {
    delegation_count_for_day(conn, bot_id, utc_day_number(now_ms))
}

fn delegation_count_for_day(conn: &Connection, bot_id: &str, day_utc: i64) -> Result<i64> {
    Ok(conn
        .query_row(
            "SELECT count FROM bot_delegation_daily WHERE bot_id = ?1 AND day_utc = ?2",
            params![bot_id, day_utc],
            |r| r.get::<_, i64>(0),
        )
        .optional()?
        .unwrap_or(0))
}

fn bump_delegation_count(conn: &Connection, bot_id: &str, day_utc: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO bot_delegation_daily (bot_id, day_utc, count) VALUES (?1, ?2, 1)
         ON CONFLICT(bot_id, day_utc) DO UPDATE SET count = count + 1",
        params![bot_id, day_utc],
    )?;
    Ok(())
}

/// Deterministic worktree name for one event: derived from the event id
/// alone, so a redelivered event reuses the name instead of creating a
/// second worktree. Stays within git branch-name-safe characters.
pub fn worktree_name_for_event(event_id: &str) -> String {
    let hex: String = event_id
        .strip_prefix("mev_")
        .unwrap_or(event_id)
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect();
    format!("deleg-{hex}")
}

/// The idempotency key for one delegation: the same event always produces
/// the same request id (mirrors the scheduler's `slot_request_id`
/// pattern), so a replay joins the existing run instead of dispatching a
/// second session.
pub fn delegation_request_id(
    host_id: &str,
    folder: &str,
    bot_id: &str,
    responsibility_id: &str,
    event_id: &str,
) -> String {
    crate::automations::runner::derive_request_id(
        host_id,
        folder,
        bot_id,
        responsibility_id,
        event_id,
    )
}

/// Input to the delegation prompt. Note what is NOT here: there is no
/// field for watched file bytes, digests, or error text — the template
/// rule is structural, not a review guideline. A caller cannot interpolate
/// raw watched content because it is never given any.
pub struct DelegationPromptInput<'a> {
    pub event: &'a DelegationEvent,
    pub responsibility_name: &'a str,
    pub responsibility_instructions: &'a str,
    pub worktree_name: &'a str,
    pub used_today: i64,
    pub max_per_day: i64,
}

/// Build the headless-run prompt from the template plus structured fields
/// only: event/monitor/resource ids, the responsibility's own standing
/// instructions, and the deterministic worktree name. The change itself is
/// referenced by event id — its bytes never enter model context here.
pub fn build_delegation_prompt(input: &DelegationPromptInput) -> String {
    let event = input.event;
    let instructions = input.responsibility_instructions.trim();
    let standing = if instructions.is_empty() {
        "No standing instructions recorded.".to_string()
    } else {
        instructions.to_string()
    };
    format!(
        "Monitor delegation {event_id} (delegation {used} of {max} today for this bot).\n\
         \n\
         A watched file changed:\n\
         - monitor: {monitor} (rule version {version})\n\
         - project: {project}, resource: {resource}\n\
         - observed at: {observed_ms} ms epoch\n\
         \n\
         Your responsibility: {resp_name}\n\
         {standing}\n\
         \n\
         Act now, using drogon-cli from your session:\n\
         1. `drogon-cli worktree create --project {project} --name {worktree}` — \
         this exact name is derived from the event id, so a redelivered event \
         reuses it instead of creating a second worktree. If it already exists \
         from an earlier delivery of this event, reuse it.\n\
         2. `drogon-cli harness start --workspace <the new workspace id> --harness <your harness> --prompt \"<task>\"` \
         to open a worker session on that worktree.\n\
         3. Send the worker its task prompt with `drogon-cli terminal send`, \
         and wait for it with `drogon-cli terminal wait`.\n\
         \n\
         Rules: refer to the change by event id ({event_id}) only. The watched \
         file's contents are never included in prompts — do not paste them.",
        event_id = event.event_id,
        used = input.used_today,
        max = input.max_per_day,
        monitor = event.monitor_id,
        version = event.monitor_version,
        project = event.project_id,
        resource = event.resource,
        observed_ms = event.observed_at_ms,
        resp_name = input.responsibility_name,
        worktree = input.worktree_name,
    )
}

/// The dispatch-relevant projection of a delegation: the idempotency key
/// plus the exact `harness.start` params. Dispatches through the one shared
/// [`runner::dispatch_run_plan`] seam — never a parallel implementation.
pub struct DelegationPlan {
    pub request_id: String,
    pub params: serde_json::Value,
}

impl DispatchPlan for DelegationPlan {
    fn request_id(&self) -> &str {
        &self.request_id
    }
    fn params(&self) -> &serde_json::Value {
        &self.params
    }
}

/// Per-drain outcome counts, for tests and operator logs.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DelegationSummary {
    /// Outbox rows examined this drain.
    pub claimed: usize,
    /// Fresh headless runs actually dispatched (one session each).
    pub dispatched: usize,
    /// Replays that joined the existing run: no new session, no new
    /// worktree name.
    pub joined_existing: usize,
    /// Events older than [`DELEGATION_GRACE_MS`]: skipped after an outage,
    /// never caught up.
    pub skipped_stale: usize,
    /// Excess events dropped by the per-day cap.
    pub cap_exceeded: usize,
    /// Bound at peek time but unbound when re-read (a concurrent edit
    /// won the race): left queued for the next drain, never dispatched
    /// and never deleted on this pass.
    pub deferred: usize,
    /// Events whose bot/responsibility/policy gate refused them.
    pub refused: usize,
    /// Events whose monitor or bot row is gone.
    pub orphaned: usize,
    /// Storage failures; the event stays queued for the next tick.
    pub failed: usize,
}

fn find_run_by_id(conn: &Connection, run_id: &str) -> Result<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM bot_responsibility_runs WHERE id = ?1",
            params![run_id],
            |r| r.get::<_, i64>(0),
        )
        .optional()?
        .is_some())
}

fn workspace_id_for_folder(
    conn: &Connection,
    host_id: &str,
    folder: &str,
) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT id FROM workspaces WHERE path = ?1 AND host_id = ?2",
            params![folder, host_id],
            |r| r.get::<_, String>(0),
        )
        .optional()?)
}

fn build_harness_start_params(
    workspace_id: &str,
    prompt: &str,
    harness: &HarnessLaunchParams,
) -> serde_json::Value {
    let mut params = serde_json::json!({
        "workspaceId": workspace_id,
        "harnessId": harness.harness_id,
        "prompt": prompt,
    });
    if let Some(model) = &harness.model {
        params["model"] = serde_json::json!(model);
    }
    if let Some(provider) = &harness.provider {
        params["provider"] = serde_json::json!(provider);
    }
    if let Some(permission_mode) = &harness.permission_mode {
        params["permissionMode"] = serde_json::json!(permission_mode);
    }
    if harness.headless {
        params["headless"] = serde_json::json!(true);
    }
    params
}

fn projection_of(
    outcome: &RunnerOutcome,
    observed_at: f64,
    attempt_at: f64,
) -> (Option<HostObservation>, Option<f64>, f64) {
    match outcome {
        RunnerOutcome::Observed { verdict, .. } if verdict == "exited" => {
            (Some(HostObservation::Exited), Some(observed_at), attempt_at)
        }
        RunnerOutcome::Observed { .. } => (Some(HostObservation::Live), None, attempt_at),
        RunnerOutcome::ObservationFailed { .. } => (
            Some(HostObservation::Unverifiable),
            Some(observed_at),
            attempt_at,
        ),
        RunnerOutcome::DispatchFailed(_) => (None, Some(observed_at), attempt_at),
    }
}

/// Drain up to [`MAX_DRAIN_PER_TICK`] outbox events: for each, apply the
/// stale-grace check, the monitor policy, the responsibility gate (via
/// `bots::policy` with `ReactiveEvent(Some(event_id))`), the per-day cap,
/// and the idempotent dispatch. Holds no database guard across any seam
/// call: every phase locks `db` briefly and releases it before dispatch.
///
/// Never fails the caller on a poison event: refusals, orphans, stale
/// rows, and cap excess are deleted-or-skipped with honest counts, and
/// only storage failures keep the event queued (`failed`).
pub fn drain_delegation_events<S: DispatchSeam>(
    db: &Mutex<Connection>,
    current_host_id: &str,
    seam: &S,
    now_ms: f64,
) -> DelegationSummary {
    let mut summary = DelegationSummary::default();
    let events = match peek_oldest(&db.lock().unwrap(), MAX_DRAIN_PER_TICK) {
        Ok(events) => events,
        Err(e) => {
            // The outbox belongs to the BotSelf component: a database that
            // predates its adoption has no table, which means no events —
            // never an error (mirrors their tick's own table check).
            if !outbox_table_exists(&db.lock().unwrap()) {
                return summary;
            }
            eprintln!("[delegation] outbox peek failed: {e}");
            return summary;
        }
    };
    // Bots that already tripped the cap this drain: their remaining events
    // stay queued (another bot's events still drain normally).
    let mut capped: HashSet<String> = HashSet::new();
    for peeked in &events {
        summary.claimed += 1;
        let event = match peeked {
            PeekedEvent::Event(event) => event,
            PeekedEvent::Poison(event_id) => {
                delete_counted(db, event_id, &mut summary, DeleteBucket::Orphaned);
                continue;
            }
        };
        if now_ms - event.observed_at_ms > DELEGATION_GRACE_MS {
            if delete_event(&db.lock().unwrap(), &event.event_id).is_ok() {
                summary.skipped_stale += 1;
            } else {
                summary.failed += 1;
            }
            continue;
        }
        drain_single_event(
            db,
            current_host_id,
            seam,
            event,
            now_ms,
            &mut capped,
            &mut summary,
        );
    }
    summary
}

/// One event through every gate. Counts exactly one summary bucket (or
/// `failed`, keeping the event queued) on every path — there is no silent
/// drop and no unbounded retry of a deterministically refused event.
#[allow(clippy::too_many_arguments)]
fn drain_single_event<S: DispatchSeam>(
    db: &Mutex<Connection>,
    current_host_id: &str,
    seam: &S,
    event: &DelegationEvent,
    now_ms: f64,
    capped: &mut HashSet<String>,
    summary: &mut DelegationSummary,
) {
    // Terminal verdicts delete the event (counted) so a deterministically
    // refused/orphaned/stale event can never spin the drain forever.
    // Only storage failures keep the event queued (`failed`).
    // NOTE: every DB read below binds its result to a `let` first: matching
    // directly on `f(&db.lock().unwrap(), …)` would hold the temporary guard
    // across match arms that lock again (std Mutex is not reentrant).
    let monitor_lookup = monitor_storage::get_monitor(&db.lock().unwrap(), &event.monitor_id);
    let monitor: MonitorRecord = match monitor_lookup {
        Ok(Some((record, _))) => record,
        Ok(None) => {
            delete_counted(db, &event.event_id, summary, DeleteBucket::Orphaned);
            return;
        }
        Err(e) => {
            eprintln!("[delegation] monitor read failed: {e}");
            summary.failed += 1;
            return;
        }
    };
    // The peek only admits bound monitors, but a concurrent edit can
    // unbind between peek and now: leave the event queued (it rejoins
    // the unbound backlog, which this drain never consumes) rather than
    // dispatching on a stale binding or deleting another lane's row.
    let responsibility_id = match &monitor.inference_policy {
        MonitorInferencePolicy::NotificationOnly => {
            summary.deferred += 1;
            return;
        }
        MonitorInferencePolicy::ExplicitResponsibility { responsibility_id } => {
            responsibility_id.clone()
        }
    };
    // Owning bot gone (deleted after firing): orphan, delete.
    let bot_id = match event.bot_id.clone().or(monitor.bot_id.clone()) {
        Some(bot_id) => bot_id,
        None => {
            delete_counted(db, &event.event_id, summary, DeleteBucket::Orphaned);
            return;
        }
    };
    if capped.contains(&bot_id) {
        summary.cap_exceeded += 1;
        return;
    }
    let folder_lookup =
        bots_storage::folder_for_bot_id(&db.lock().unwrap(), current_host_id, &bot_id);
    let folder = match folder_lookup {
        Ok(Some(folder)) => folder,
        Ok(None) => {
            delete_counted(db, &event.event_id, summary, DeleteBucket::Orphaned);
            return;
        }
        Err(e) => {
            eprintln!("[delegation] bot-folder read failed: {e}");
            summary.failed += 1;
            return;
        }
    };
    // THE mandated gate: the same storage-composed entry point the runner
    // uses, with the event id as the reactive invocation reason.
    let gate = bots_policy::evaluate_and_attempt_responsibility_dispatch_from_storage(
        &db.lock().unwrap(),
        current_host_id,
        &folder,
        &bot_id,
        &responsibility_id,
        current_host_id,
        &InvocationReason::ReactiveEvent(Some(event.event_id.clone())),
    );
    match gate {
        Err(bots_policy::ResponsibilityLookupError::BotNotFound)
        | Err(bots_policy::ResponsibilityLookupError::ResponsibilityNotFound) => {
            delete_counted(db, &event.event_id, summary, DeleteBucket::Orphaned);
            return;
        }
        Err(e) => {
            eprintln!("[delegation] responsibility gate read failed: {e}");
            summary.failed += 1;
            return;
        }
        Ok(
            bots_policy::ResponsibilityDispatchAttempt::RefusedByResponsibility(_)
            | bots_policy::ResponsibilityDispatchAttempt::RefusedByAutomation(_),
        ) => {
            // Disabled responsibility, unowned automation, or a reason the
            // gate refuses: deterministic, so delete rather than spin.
            delete_counted(db, &event.event_id, summary, DeleteBucket::Refused);
            return;
        }
        Ok(bots_policy::ResponsibilityDispatchAttempt::Dispatched(
            bots_policy::ResponsibilityJobOutcome::Automation(_),
        )) => {
            // Unreachable for a reactive trigger (the pure gate never
            // delegates those to automation evaluation); treat as refused
            // rather than trusting an impossible dispatch.
            delete_counted(db, &event.event_id, summary, DeleteBucket::Refused);
            return;
        }
        Ok(bots_policy::ResponsibilityDispatchAttempt::Dispatched(
            bots_policy::ResponsibilityJobOutcome::ReactiveReady,
        )) => {}
    }
    // Per-day cap, checked before dispatch and bumped in the record
    // transaction: only real delegations consume budget.
    let day_utc = utc_day_number(now_ms);
    let used_lookup = delegation_count_for_day(&db.lock().unwrap(), &bot_id, day_utc);
    let used = match used_lookup {
        Ok(used) => used,
        Err(e) => {
            eprintln!("[delegation] cap read failed: {e}");
            summary.failed += 1;
            return;
        }
    };
    if used >= MAX_DELEGATIONS_PER_BOT_PER_DAY {
        capped.insert(bot_id);
        delete_counted(db, &event.event_id, summary, DeleteBucket::CapExceeded);
        return;
    }
    // Idempotency: the same event maps to the same run-row id, so a
    // redelivery after a crash (or a duplicate tick) joins instead of
    // opening a second session — and no second worktree name is minted.
    let request_id = delegation_request_id(
        current_host_id,
        &folder,
        &bot_id,
        &responsibility_id,
        &event.event_id,
    );
    let already_lookup = find_run_by_id(&db.lock().unwrap(), &request_id);
    let already = match already_lookup {
        Ok(already) => already,
        Err(e) => {
            eprintln!("[delegation] run-row read failed: {e}");
            summary.failed += 1;
            return;
        }
    };
    if already {
        delete_counted(db, &event.event_id, summary, DeleteBucket::JoinedExisting);
        return;
    }
    // Resolve the run context from durable rows only: the bot's own
    // folder row names the workspace, the bot's stored policy names the
    // harness. Nothing is defaulted, nothing is fabricated.
    let (bot, workspace_id) = {
        let conn = db.lock().unwrap();
        let bot = match bots_storage::get_bot(&conn, current_host_id, &folder, &bot_id) {
            Ok(Some(bot)) => bot,
            Ok(None) => {
                drop(conn);
                delete_counted(db, &event.event_id, summary, DeleteBucket::Orphaned);
                return;
            }
            Err(e) => {
                eprintln!("[delegation] bot read failed: {e}");
                summary.failed += 1;
                return;
            }
        };
        let workspace_id = match workspace_id_for_folder(&conn, current_host_id, &folder) {
            Ok(Some(workspace_id)) => workspace_id,
            Ok(None) => {
                drop(conn);
                delete_counted(db, &event.event_id, summary, DeleteBucket::Refused);
                return;
            }
            Err(e) => {
                eprintln!("[delegation] workspace read failed: {e}");
                summary.failed += 1;
                return;
            }
        };
        (bot, workspace_id)
    };
    let Some(responsibility) = bot
        .responsibilities
        .iter()
        .find(|r| r.id == responsibility_id)
    else {
        // Raced a responsibility delete between the gate and now: orphan.
        delete_counted(db, &event.event_id, summary, DeleteBucket::Orphaned);
        return;
    };
    if !matches!(
        responsibility.trigger,
        ResponsibilityTrigger::Reactive { .. }
    ) {
        delete_counted(db, &event.event_id, summary, DeleteBucket::Refused);
        return;
    }
    let overrides = bots_policy::harness_overrides(&bot);
    let harness = HarnessLaunchParams {
        harness_id: overrides.harness_id,
        model: overrides.model,
        effort: None,
        provider: overrides.provider,
        permission_mode: overrides.permission_mode,
        // Delegated runs are headless daemon runs (issue #186): no TUI,
        // no approval-answer surface.
        headless: true,
    };
    let operating = crate::bots::prompt::build_operating_prompt(
        &bot,
        &build_delegation_prompt(&DelegationPromptInput {
            event,
            responsibility_name: &responsibility.name,
            responsibility_instructions: &responsibility.instructions,
            worktree_name: &worktree_name_for_event(&event.event_id),
            used_today: used,
            max_per_day: MAX_DELEGATIONS_PER_BOT_PER_DAY,
        }),
    );
    let plan = DelegationPlan {
        request_id: request_id.clone(),
        params: build_harness_start_params(&workspace_id, &operating, &harness),
    };
    // No database guard held across the seam call.
    let outcome = runner::dispatch_run_plan(seam, &plan);
    let (host_observation, ended_at, _) = projection_of(&outcome, now_ms, now_ms);
    // Claim = delete, in the SAME transaction as the run row and the cap
    // bump: all three commit together or none do.
    let record = (|| -> Result<()> {
        let conn = db.lock().unwrap();
        let tx = crate::automations::storage::begin_immediate(&conn)?;
        bots_storage::record_responsibility_run_in_tx(
            &tx,
            current_host_id,
            &folder,
            ResponsibilityRun {
                id: request_id.clone(),
                bot_id: bot_id.clone(),
                responsibility_id: responsibility_id.clone(),
                automation_id: None,
                automation_run_id: None,
                started_at: now_ms,
                ended_at,
                recipe: None,
                host_observation,
                // An explicit daemon invocation with a reactive-event
                // reason — the `Manual` display bucket covers exactly this
                // (never a schedule fire).
                invocation: Some(ResponsibilityRunInvocation::Manual),
            },
        )
        .map_err(|e| DelegationError::Storage(format!("run record failed: {e}")))?;
        delete_event(&tx, &event.event_id)?;
        bump_delegation_count(&tx, &bot_id, day_utc)?;
        tx.commit()?;
        Ok(())
    })();
    match record {
        Ok(()) => summary.dispatched += 1,
        Err(e) => {
            eprintln!("[delegation] record failed: {e}");
            summary.failed += 1;
        }
    }
}
