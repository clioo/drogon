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
//!   responsibility. Interactive open-session runs use the Bot's provisioned
//!   home; monitor-released and scheduled runs use the Bot's record folder so
//!   work happens in the project that owns the Bot.
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
/// Version 3: the firing evidence gains the released case's resource
/// (`pull/<n>` for a pull-request watch, the path for a file watch) so
/// the product can name WHAT a firing released — additive, old rows keep
/// NULL.
pub const DELEGATION_SCHEMA_VERSION: i64 = 3;

/// A stale outbox event is skipped, never caught up: past this age an event
/// describes a world the daemon was not watching, and dispatching it would
/// be a catch-up storm after an outage. Mirrors the scheduler's
/// missed-run-grace shape (`scheduler::fire_due`).
pub const DELEGATION_GRACE_MS: f64 = 30.0 * 60.0 * 1000.0;
/// Notification-only event rows older than this are discarded; check-in rows
/// remain the durable evidence for the monitor's observation history.
pub const NOTIFICATION_EVENT_RETENTION_MS: f64 = 7.0 * 24.0 * 60.0 * 60.0 * 1000.0;
/// A notification-only monitor retains at most its newest event rows.
pub const MAX_NOTIFICATION_EVENTS_PER_MONITOR: usize = 200;

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
    // this component owns the delegation budget rows and the firing
    // evidence. Forward, never duplicated here.
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS bot_delegation_daily (
            bot_id TEXT NOT NULL,
            day_utc INTEGER NOT NULL,
            count INTEGER NOT NULL,
            PRIMARY KEY (bot_id, day_utc)
        );
        CREATE TABLE IF NOT EXISTS bot_monitor_firings (
            event_id TEXT PRIMARY KEY,
            monitor_id TEXT NOT NULL,
            bot_id TEXT,
            responsibility_id TEXT,
            outcome TEXT NOT NULL,
            run_id TEXT,
            detail TEXT,
            at_ms REAL NOT NULL,
            resource TEXT
        );",
    )?;
    Ok(())
}

/// Additive upgrade inside the caller's transaction: creates both tables
/// (idempotent, so a version-1 database gains the firing evidence in
/// place) and stamps the current component version when absent or behind.
/// Refuses loudly only on a recorded version NEWER than this build.
fn apply_schema_in_tx(tx: &Transaction) -> Result<()> {
    check_schema_not_ahead(tx)?;
    let existing: Option<i64> = tx
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![DELEGATION_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    create_tables(tx)?;
    // Additive version-2 → version-3 step for databases that already
    // have the firing table: the released case's resource column. Fresh
    // databases got it from CREATE above; the pragma guard keeps the
    // ALTER idempotent.
    let has_resource: bool = tx
        .prepare(
            "SELECT 1 FROM pragma_table_info('bot_monitor_firings')
             WHERE name = 'resource' LIMIT 1",
        )?
        .exists([])?;
    if !has_resource {
        tx.execute_batch("ALTER TABLE bot_monitor_firings ADD COLUMN resource TEXT;")?;
    }
    match existing {
        None => {
            tx.execute(
                "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)",
                params![DELEGATION_SCHEMA_COMPONENT, DELEGATION_SCHEMA_VERSION],
            )?;
        }
        Some(version) if version < DELEGATION_SCHEMA_VERSION => {
            tx.execute(
                "UPDATE schema_versions SET version = ?2 WHERE component = ?1",
                params![DELEGATION_SCHEMA_COMPONENT, DELEGATION_SCHEMA_VERSION],
            )?;
        }
        Some(_) => {}
    }
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

/// Aggregate-startup shape for `db::migrate_and_recover`: additive
/// `CREATE TABLE IF NOT EXISTS` inside the caller's transaction — safe to
/// adopt on databases that predate the delegation chain; the version-1 →
/// version-2 path gains the firing-evidence table in place.
pub(crate) fn apply_pending_steps_in_tx(tx: &Transaction) -> Result<()> {
    apply_schema_in_tx(tx)
}

/// Standalone migration for controlled (test) databases. Production goes
/// through [`apply_pending_steps_in_tx`] via the aggregate gate.
pub fn migrate(conn: &Connection) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    apply_schema_in_tx(&tx)?;
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
///
/// LEFT JOIN (not an inner join): an event whose monitor was deleted
/// after it was queued is still PEEKED — the drain reaches it and settles
/// it as a visible, durable `orphaned` verdict instead of leaving it in a
/// state where nothing will ever happen to it and nothing tells the owner
/// so. The same join keeps live unbound rows excluded.
fn peek_oldest(conn: &Connection, limit: usize) -> Result<Vec<PeekedEvent>> {
    let mut stmt = conn.prepare(
        "SELECT e.event_id, e.payload_json FROM bot_monitor_events e
         LEFT JOIN bot_monitors m ON m.id = e.monitor_id
         WHERE m.id IS NULL
            OR json_extract(m.payload_json, '$.inferencePolicy.kind')
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

/// Terminal-verdict buckets for [`settle_event`]. Each maps to the
/// durable firing outcome string the monitor surfaces read back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeleteBucket {
    Orphaned,
    Refused,
    JoinedExisting,
    CapExceeded,
    StaleSkipped,
}

impl DeleteBucket {
    fn outcome_str(self) -> &'static str {
        match self {
            DeleteBucket::Orphaned => "orphaned",
            DeleteBucket::Refused => "refused",
            DeleteBucket::JoinedExisting => "joined_existing",
            DeleteBucket::CapExceeded => "cap_exceeded",
            DeleteBucket::StaleSkipped => "stale_skipped",
        }
    }
}

/// Durable verdict for one monitor event: what the delegation did with
/// it. Written to `bot_monitor_firings` keyed by event id, so a replay
/// refreshes the same row instead of duplicating evidence. Carries
/// metadata only — ids, the outcome, and short refusal reasons; never
/// watched bytes.
#[derive(Debug, Clone, PartialEq)]
pub struct FiringEvidence {
    pub event_id: String,
    pub monitor_id: String,
    pub outcome: String,
    pub run_id: Option<String>,
    pub detail: Option<String>,
    /// The released case's own resource (`pull/<n>` for a pull-request
    /// watch, the watched path for a file watch): the product names WHAT
    /// a firing released, never the bare rule kind. NULL on rows written
    /// before version 3.
    pub resource: Option<String>,
    pub at_ms: f64,
    /// Firings recorded for this monitor since the start of its bot's
    /// current UTC day (honest cost share of the bot-wide cap).
    pub count_today: i64,
}

fn record_firing_in_tx(
    tx: &Transaction,
    event: &DelegationEvent,
    responsibility_id: Option<&str>,
    run_id: Option<&str>,
    detail: Option<&str>,
    outcome: &str,
    now_ms: f64,
) -> Result<()> {
    tx.execute(
        "INSERT INTO bot_monitor_firings
             (event_id, monitor_id, bot_id, responsibility_id, outcome, run_id, detail, at_ms, resource)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(event_id) DO UPDATE SET
             bot_id = excluded.bot_id,
             responsibility_id = excluded.responsibility_id,
             outcome = excluded.outcome,
             run_id = excluded.run_id,
             detail = excluded.detail,
             at_ms = excluded.at_ms,
             resource = excluded.resource",
        params![
            event.event_id,
            event.monitor_id,
            event.bot_id,
            responsibility_id,
            outcome,
            run_id,
            detail,
            now_ms,
            // An empty resource (a synthesized verdict event with nothing
            // parseable left) persists as NULL, never a blank string the
            // UI could render as if it were the resource.
            if event.resource.is_empty() {
                None
            } else {
                Some(event.resource.as_str())
            },
        ],
    )?;
    Ok(())
}

fn record_firing(
    conn: &Connection,
    event: &DelegationEvent,
    responsibility_id: Option<&str>,
    run_id: Option<&str>,
    detail: Option<&str>,
    outcome: &str,
    now_ms: f64,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    record_firing_in_tx(
        &tx,
        event,
        responsibility_id,
        run_id,
        detail,
        outcome,
        now_ms,
    )?;
    tx.commit()?;
    Ok(())
}

/// Settle queued outbox events for a monitor: one durable firing row per
/// event (outcome `orphaned`, the supplied honest reason) and the outbox rows
/// deleted, all inside the caller's transaction. Tolerant of a missing outbox
/// table and of unparseable payloads (the row id is enough evidence).
pub fn settle_queued_events_in_tx(
    tx: &Transaction,
    monitor_id: &str,
    detail: &str,
    now_ms: f64,
) -> Result<Vec<String>> {
    let has_table = tx
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1")
        .and_then(|mut stmt| stmt.exists(params!["bot_monitor_events"]))
        .unwrap_or(false);
    if !has_table {
        return Ok(Vec::new());
    }
    let rows = {
        let mut stmt = tx.prepare(
            "SELECT event_id, payload_json FROM bot_monitor_events
             WHERE monitor_id = ?1 ORDER BY at, rowid",
        )?;
        stmt.query_map(params![monitor_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?
    };
    let mut settled = Vec::new();
    for (event_id, payload_json) in rows {
        let parsed = serde_json::from_str::<DelegationEvent>(&payload_json).ok();
        let firing_event = DelegationEvent {
            event_id: event_id.clone(),
            monitor_id: monitor_id.to_string(),
            monitor_version: parsed.as_ref().map(|e| e.monitor_version).unwrap_or(0),
            cursor: parsed
                .as_ref()
                .map(|e| e.cursor.clone())
                .unwrap_or_default(),
            host_id: parsed
                .as_ref()
                .map(|e| e.host_id.clone())
                .unwrap_or_default(),
            project_id: parsed
                .as_ref()
                .map(|e| e.project_id.clone())
                .unwrap_or_default(),
            resource: parsed
                .as_ref()
                .map(|e| e.resource.clone())
                .unwrap_or_default(),
            bot_id: parsed.as_ref().and_then(|e| e.bot_id.clone()),
            observed_at_ms: parsed.as_ref().map(|e| e.observed_at_ms).unwrap_or(now_ms),
        };
        record_firing_in_tx(
            tx,
            &firing_event,
            None,
            None,
            Some(detail),
            DeleteBucket::Orphaned.outcome_str(),
            now_ms,
        )?;
        delete_event(tx, &event_id)?;
        settled.push(event_id);
    }
    Ok(settled)
}

/// Settle every queued outbox event of a monitor being deleted at delete time.
/// The drain's orphaned path covers the reverse race (an event queued after
/// the monitor row is gone), so neither path leaves a silent orphan.
pub fn settle_events_of_deleted_monitor_in_tx(
    tx: &Transaction,
    monitor_id: &str,
    now_ms: f64,
) -> Result<Vec<String>> {
    settle_queued_events_in_tx(
        tx,
        monitor_id,
        "monitor deleted before its queued event could be dispatched",
        now_ms,
    )
}

/// Firing evidence for one monitor, for `bot.monitor_list` and the
/// self-lane list: the newest verdict plus today's count. Empty (zero)
/// when the monitor never released an action — an honest absence, never
/// a fabricated row.
pub fn firing_evidence_for_monitor(
    conn: &Connection,
    monitor_id: &str,
    now_ms: f64,
) -> Option<FiringEvidence> {
    let read = || -> Result<Option<FiringEvidence>> {
        let mut stmt = conn.prepare(
            "SELECT event_id, outcome, run_id, detail, at_ms, resource FROM bot_monitor_firings
             WHERE monitor_id = ?1
             ORDER BY at_ms DESC, rowid DESC LIMIT 1",
        )?;
        let latest = stmt
            .query_row(params![monitor_id], |r| {
                Ok(FiringEvidence {
                    event_id: r.get(0)?,
                    monitor_id: monitor_id.to_string(),
                    outcome: r.get(1)?,
                    run_id: r.get(2)?,
                    detail: r.get(3)?,
                    at_ms: r.get(4)?,
                    resource: r.get(5)?,
                    count_today: 0,
                })
            })
            .optional()?;
        let Some(mut evidence) = latest else {
            return Ok(None);
        };
        evidence.count_today = conn
            .query_row(
                "SELECT COUNT(*) FROM bot_monitor_firings
                 WHERE monitor_id = ?1 AND at_ms >= ?2",
                params![monitor_id, (utc_day_number(now_ms) as f64) * 86_400_000.0],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0);
        Ok(Some(evidence))
    }();
    match read {
        Ok(evidence) => evidence,
        Err(e) => {
            // Evidence reads never break the list surfaces; the drain's
            // own logs remain the fallback record.
            eprintln!("[delegation] firing evidence read failed: {e}");
            None
        }
    }
}

/// The firing context carried to every terminal verdict: what the event
/// was bound to, which run it joined (if any), and the honest reason for
/// a refusal. Metadata only, never watched bytes.
struct Verdict<'a> {
    responsibility_id: Option<&'a str>,
    run_id: Option<&'a str>,
    detail: Option<&'a str>,
}

/// Settle one terminal verdict: write the durable firing row FIRST (so
/// evidence survives even if the delete below fails), then delete the
/// outbox event, then count the bucket. A failed firing insert is logged
/// and does not keep the event queued — a poison evidence table must
/// never wedge the drain, and the outcome is still counted in logs.
fn settle_event(
    db: &Mutex<Connection>,
    event: &DelegationEvent,
    verdict: Verdict,
    bucket: DeleteBucket,
    now_ms: f64,
    summary: &mut DelegationSummary,
) {
    {
        let conn = db.lock().unwrap();
        if let Err(e) = record_firing(
            &conn,
            event,
            verdict.responsibility_id,
            verdict.run_id,
            verdict.detail,
            bucket.outcome_str(),
            now_ms,
        ) {
            eprintln!(
                "[delegation] firing record failed for {}: {e}",
                event.event_id
            );
        }
    }
    match delete_event(&db.lock().unwrap(), &event.event_id) {
        Ok(()) => match bucket {
            DeleteBucket::Orphaned => summary.orphaned += 1,
            DeleteBucket::Refused => summary.refused += 1,
            DeleteBucket::JoinedExisting => summary.joined_existing += 1,
            DeleteBucket::CapExceeded => summary.cap_exceeded += 1,
            DeleteBucket::StaleSkipped => summary.skipped_stale += 1,
        },
        Err(e) => {
            eprintln!("[delegation] delete failed for {}: {e}", event.event_id);
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

/// Deterministic worktree name for a pull-request case. The case is the
/// (repository, pull number) pair — NOT the pull number alone — so two
/// different repositories sharing a PR number never collapse into one
/// worktree, and a redelivered event for the same case reuses the name
/// instead of creating a second worktree.
pub fn worktree_name_for_pr_case(pull_number: u64, repo: &str) -> String {
    let slug: String = repo
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    format!("review-pr-{pull_number}-{slug}")
}

/// The idempotency identity of one delegation: the CASE when the event is
/// a pull-request release (repository + pull number), else the event id.
/// Keying on the case means a second watch releasing the same PR joins
/// the existing run instead of racing it for the same worktree name; a
/// redelivered event still produces the same identity (same case), so the
/// proven replay/restart exactly-once behaviour is unchanged.
pub fn delegation_identity(
    event: &DelegationEvent,
    case_repo: Option<&str>,
    case_pull_number: Option<u64>,
) -> String {
    match (case_repo, case_pull_number) {
        (Some(repo), Some(number)) => format!("pr-case:{repo}:{number}"),
        _ => event.event_id.clone(),
    }
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
///
/// The three case fields are the owner's per-case choices: which harness
/// the released session must run, which skills it must use, and (for a
/// pull-request watch) which PR the case is about. All three come from the
/// monitor rule, so they are inside its approval hash and constrained to
/// id-like alphabets; a pull number is a number. Prose still has exactly
/// one channel — the responsibility's own standing instructions.
pub struct DelegationPromptInput<'a> {
    pub event: &'a DelegationEvent,
    /// The registered Project id owning the event's workspace (not the
    /// workspace id carried by `event.project_id`).
    pub project_id: &'a str,
    /// The registered Project path, shown so the worker can sanity-check the
    /// id before creating a worktree.
    pub project_path: &'a str,
    pub responsibility_name: &'a str,
    pub responsibility_instructions: &'a str,
    pub worktree_name: &'a str,
    pub used_today: i64,
    pub max_per_day: i64,
    /// Harness the released session must use. `None` leaves it to the Bot.
    pub case_harness: Option<&'a str>,
    /// Skills the released session must use (already id-like).
    pub case_skills: &'a [String],
    /// The pull request this case is about, when the watch is a
    /// `github_pr.v1` one.
    pub case_pull_number: Option<u64>,
    /// The GitHub repository the case's pull request lives in (`owner/name`,
    /// id-like and inside the rule's approval hash).
    pub case_repo: Option<&'a str>,
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
    // What the case is. A `github_pr.v1` watch carries `pull/<n>` as its
    // resource; the number is a number, never watched bytes.
    let case_line = match input.case_pull_number {
        Some(number) => format!(
            "- case: pull request #{number} in {repo} — the change to review\n",
            repo = input.case_repo.unwrap_or(&event.project_id)
        ),
        None => String::new(),
    };
    let pull_note = match input.case_pull_number {
        Some(number) => format!(
            "   This case is pull request #{number}: bring it into the worktree \
             (`gh pr checkout {number}` from inside it) or read its diff with \
             `gh pr diff {number}` before you dispatch the review.\n"
        ),
        None => String::new(),
    };
    let harness_flag = input.case_harness.unwrap_or("<your harness>");
    let skills_line = if input.case_skills.is_empty() {
        String::new()
    } else {
        format!(
            "\n   That session MUST use these skills: {} — read each one with \
             `drogon-cli skills get <name>` before starting the work.\n",
            input.case_skills.join(", ")
        )
    };
    format!(
        "Monitor delegation {event_id} (delegation {used} of {max} today for this bot).\n\
         \n\
         A watched change was observed:\n\
         - monitor: {monitor} (rule version {version})\n\
         - project: {project} ({project_path}), resource: {resource}\n\
         - observed at: {observed_ms} ms epoch\n\
         {case_line}\
         Your responsibility: {resp_name}\n\
         {standing}\n\
         \n\
         Act now, using drogon-cli from your session:\n\
         1. `drogon-cli worktree create --project {project} --name {worktree} --json` — \
         read the new workspace id from `.result.workspaceId`. This exact name is \
         derived from the event id, so a redelivered event reuses it instead of \
         creating a second worktree. If it already exists from an earlier delivery \
         of this event, reuse it.\n\
         {pull_note}\
         2. `drogon-cli harness start --workspace <id> --harness {harness_flag} \
         --permission-mode unattended --caused-by-event {event_id} --prompt \"<task>\" --json` \
         to open a worker session on that worktree. Read `.result.id` and \
         `.result.incarnation` from the response. The `--caused-by-event` tag is \
         how the user sees WHY that session appeared: pass this event id unchanged.\n\
         {skills_line}\
         3. `drogon-cli terminal wait --session <id> --incarnation <token> --for idle \
         --timeout-ms 900000`, then read its output with `drogon-cli terminal read`.\n\
         \n\
         Rules: refer to the change by event id ({event_id}) only. The watched \
         content is never included in prompts — do not paste it.",
        event_id = event.event_id,
        used = input.used_today,
        max = input.max_per_day,
        monitor = event.monitor_id,
        version = event.monitor_version,
        project = input.project_id,
        project_path = input.project_path,
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

/// Resolve the workspace id carried by a monitor event to the separately
/// registered Project row. Registration normally canonicalizes both paths,
/// but the fallback also accepts equivalent paths when an older database has
/// one spelling stored differently.
fn project_for_workspace(
    conn: &Connection,
    workspace_id: &str,
    host_id: &str,
) -> Result<Option<(String, String, String)>> {
    let exact = conn
        .query_row(
            "SELECT p.id, p.path, w.path FROM projects p
             JOIN workspaces w ON w.path = p.path
             WHERE w.id = ?1 AND p.host_id = ?2",
            params![workspace_id, host_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    if exact.is_some() {
        return Ok(exact);
    }

    let workspace_path: Option<String> = conn
        .query_row(
            "SELECT path FROM workspaces WHERE id = ?1 AND host_id = ?2",
            params![workspace_id, host_id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(workspace_path) = workspace_path else {
        return Ok(None);
    };
    let workspace_canonical = std::fs::canonicalize(&workspace_path)
        .ok()
        .and_then(|path| path.to_str().map(str::to_string));
    let mut projects = conn.prepare("SELECT id, path FROM projects WHERE host_id = ?1")?;
    let rows = projects
        .query_map(params![host_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows.into_iter().find_map(|(project_id, project_path)| {
        let project_canonical = std::fs::canonicalize(&project_path)
            .ok()
            .and_then(|path| path.to_str().map(str::to_string));
        if project_path == workspace_path
            || workspace_canonical
                .as_deref()
                .zip(project_canonical.as_deref())
                .is_some_and(|(workspace, project)| workspace == project)
        {
            Some((project_id, project_path, workspace_path.clone()))
        } else {
            None
        }
    }))
}

fn workspace_path_for_id(
    conn: &Connection,
    workspace_id: &str,
    host_id: &str,
) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT path FROM workspaces WHERE id = ?1 AND host_id = ?2",
            params![workspace_id, host_id],
            |r| r.get(0),
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
    // Bots that already tripped the cap this drain: their remaining peeked
    // events are settled immediately (another bot's events still drain normally).
    let mut capped: HashSet<String> = HashSet::new();
    for peeked in &events {
        summary.claimed += 1;
        let event = match peeked {
            PeekedEvent::Event(event) => event,
            PeekedEvent::Poison(event_id) => {
                match delete_event(&db.lock().unwrap(), event_id) {
                    Ok(()) => summary.orphaned += 1,
                    Err(_) => summary.failed += 1,
                }
                continue;
            }
        };
        if now_ms - event.observed_at_ms > DELEGATION_GRACE_MS {
            // Stale is a verdict the monitor's history should show too:
            // the change happened while no one was watching.
            settle_event(
                db,
                event,
                Verdict {
                    responsibility_id: None,
                    run_id: None,
                    detail: Some("event older than the outage grace; never caught up"),
                },
                DeleteBucket::StaleSkipped,
                now_ms,
                &mut summary,
            );
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

/// Short, honest, metadata-only refusal text for the firing evidence —
/// what the monitor's history shows when the gate refused. Never carries
/// watched bytes (refusals name states and ids, never content).
fn responsibility_refusal_detail(refusal: &bots_policy::ResponsibilityRefusal) -> String {
    match refusal {
        bots_policy::ResponsibilityRefusal::Disabled => {
            "bound responsibility is disabled".to_string()
        }
        bots_policy::ResponsibilityRefusal::ReactiveRequiresSuppliedEvent(_) => {
            "gate refused: no supplied event".to_string()
        }
        bots_policy::ResponsibilityRefusal::UnownedAutomation(automation_id) => {
            format!("bound responsibility names an unowned automation: {automation_id}")
        }
    }
}

fn automation_refusal_detail(refusal: &crate::automations::execution::DispatchRefusal) -> String {
    use crate::automations::execution::DispatchRefusal as R;
    match refusal {
        R::ForeignHost {
            execution_target_id,
            ..
        } => format!("automation lives on another host: {execution_target_id}"),
        R::Disabled => "bound responsibility's automation is disabled".to_string(),
        R::MissingReactiveEvent => "gate refused: no supplied event".to_string(),
    }
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
            settle_event(
                db,
                event,
                Verdict {
                    responsibility_id: None,
                    run_id: None,
                    detail: Some("monitor row is gone"),
                },
                DeleteBucket::Orphaned,
                now_ms,
                summary,
            );
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
    // The case fields come from the monitor rule (approval-hashed) when
    // the watch is a `github_pr.v1` one; a file watch has none. Computed
    // once, BEFORE the idempotency check, because the case is the dedupe
    // identity: two watches releasing the same PR must land on the same
    // run-row id and join instead of racing for one worktree name.
    let github_case = monitor.rule.github_pr();
    let case_repo = github_case.map(|rule| rule.repo.as_str());
    let case_harness = github_case.and_then(|rule| rule.harness.as_deref());
    let case_skills: &[String] = github_case
        .map(|rule| rule.skills.as_slice())
        .unwrap_or(&[]);
    let case_pull_number = github_case
        .and_then(|_| crate::bots::monitors::github::pull_number_from_resource(&event.resource));
    let identity = delegation_identity(event, case_repo, case_pull_number);
    // A pull-request case is keyed BY THE CASE (repository + PR number):
    // one bot, one PR, one review session — whatever watch (and whatever
    // binding) released it, the second release joins the first run and
    // says so in its firing evidence. The run row itself still records
    // the dispatching event's own responsibility, and the joined event's
    // history names the exact run it joined.
    let is_pr_case = case_repo.is_some() && case_pull_number.is_some();
    // Owning bot gone (deleted after firing): orphan, delete — recorded
    // so the monitor's history shows the honest refusal.
    let bot_id = match event.bot_id.clone().or(monitor.bot_id.clone()) {
        Some(bot_id) => bot_id,
        None => {
            settle_event(
                db,
                event,
                Verdict {
                    responsibility_id: Some(&responsibility_id),
                    run_id: None,
                    detail: Some("no owning bot on the event or monitor"),
                },
                DeleteBucket::Orphaned,
                now_ms,
                summary,
            );
            return;
        }
    };
    if capped.contains(&bot_id) {
        settle_event(
            db,
            event,
            Verdict {
                responsibility_id: Some(&responsibility_id),
                run_id: None,
                detail: Some("per-day delegation cap already used"),
            },
            DeleteBucket::CapExceeded,
            now_ms,
            summary,
        );
        return;
    }
    let folder_lookup =
        bots_storage::folder_for_bot_id(&db.lock().unwrap(), current_host_id, &bot_id);
    let folder = match folder_lookup {
        Ok(Some(folder)) => folder,
        Ok(None) => {
            settle_event(
                db,
                event,
                Verdict {
                    responsibility_id: Some(&responsibility_id),
                    run_id: None,
                    detail: Some("bot home folder is gone"),
                },
                DeleteBucket::Orphaned,
                now_ms,
                summary,
            );
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
        Err(bots_policy::ResponsibilityLookupError::BotNotFound) => {
            settle_event(
                db,
                event,
                Verdict {
                    responsibility_id: Some(&responsibility_id),
                    run_id: None,
                    detail: Some("target bot no longer exists"),
                },
                DeleteBucket::Orphaned,
                now_ms,
                summary,
            );
            return;
        }
        Err(bots_policy::ResponsibilityLookupError::ResponsibilityNotFound) => {
            settle_event(
                db,
                event,
                Verdict {
                    responsibility_id: Some(&responsibility_id),
                    run_id: None,
                    detail: Some("bound responsibility no longer exists"),
                },
                DeleteBucket::Orphaned,
                now_ms,
                summary,
            );
            return;
        }
        Err(e) => {
            eprintln!("[delegation] responsibility gate read failed: {e}");
            summary.failed += 1;
            return;
        }
        Ok(bots_policy::ResponsibilityDispatchAttempt::RefusedByResponsibility(refusal)) => {
            // Disabled responsibility or a reason the gate refuses:
            // deterministic, so delete rather than spin — with the gate's
            // own reason as the honest, surfaced detail.
            settle_event(
                db,
                event,
                Verdict {
                    responsibility_id: Some(&responsibility_id),
                    run_id: None,
                    detail: Some(&responsibility_refusal_detail(&refusal)),
                },
                DeleteBucket::Refused,
                now_ms,
                summary,
            );
            return;
        }
        Ok(bots_policy::ResponsibilityDispatchAttempt::RefusedByAutomation(refusal)) => {
            settle_event(
                db,
                event,
                Verdict {
                    responsibility_id: Some(&responsibility_id),
                    run_id: None,
                    detail: Some(&automation_refusal_detail(&refusal)),
                },
                DeleteBucket::Refused,
                now_ms,
                summary,
            );
            return;
        }
        Ok(bots_policy::ResponsibilityDispatchAttempt::Dispatched(
            bots_policy::ResponsibilityJobOutcome::Automation(_),
        )) => {
            // Unreachable for a reactive trigger (the pure gate never
            // delegates those to automation evaluation); treat as refused
            // rather than trusting an impossible dispatch.
            settle_event(
                db,
                event,
                Verdict {
                    responsibility_id: Some(&responsibility_id),
                    run_id: None,
                    detail: Some("gate returned an impossible automation dispatch"),
                },
                DeleteBucket::Refused,
                now_ms,
                summary,
            );
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
        settle_event(
            db,
            event,
            Verdict {
                responsibility_id: Some(&responsibility_id),
                run_id: None,
                detail: Some("per-day delegation cap already used"),
            },
            DeleteBucket::CapExceeded,
            now_ms,
            summary,
        );
        return;
    }
    // Idempotency: the CASE (repository + pull number for a PR release,
    // the event id otherwise) maps to the run-row id, so a second watch
    // releasing the same PR — or a redelivery after a crash — joins
    // instead of opening a second session, and no second worktree name is
    // minted.
    let request_id = delegation_request_id(
        current_host_id,
        &folder,
        &bot_id,
        if is_pr_case {
            "github-pr-case"
        } else {
            &responsibility_id
        },
        &identity,
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
        settle_event(
            db,
            event,
            Verdict {
                responsibility_id: Some(&responsibility_id),
                run_id: Some(&request_id),
                detail: None,
            },
            DeleteBucket::JoinedExisting,
            now_ms,
            summary,
        );
        return;
    }
    // Resolve the event's workspace to the separately registered Project.
    // `event.project_id` is a workspace id; worktree.create requires the
    // Project id. Keep the path alongside it so the prompt exposes both
    // structured values and the worker can sanity-check the mapping.
    let project_lookup = {
        let conn = db.lock().unwrap();
        project_for_workspace(&conn, &event.project_id, current_host_id)
    };
    let (project_id, project_path) = match project_lookup {
        Ok(Some((project_id, project_path, _workspace_path))) => (project_id, project_path),
        Ok(None) => {
            let workspace_path = {
                let conn = db.lock().unwrap();
                workspace_path_for_id(&conn, &event.project_id, current_host_id)
            };
            let detail = match workspace_path {
                Ok(Some(path)) => format!(
                    "workspace {} ({path}) is not a registered Project; register it with `drogon-cli project add <path>` or watch a project workspace",
                    event.project_id
                ),
                Ok(None) => format!(
                    "workspace {} (<unknown path>) is not a registered Project; register it with `drogon-cli project add <path>` or watch a project workspace",
                    event.project_id
                ),
                Err(e) => {
                    eprintln!("[delegation] workspace path read failed: {e}");
                    summary.failed += 1;
                    return;
                }
            };
            settle_event(
                db,
                event,
                Verdict {
                    responsibility_id: Some(&responsibility_id),
                    run_id: None,
                    detail: Some(&detail),
                },
                DeleteBucket::Refused,
                now_ms,
                summary,
            );
            return;
        }
        Err(e) => {
            eprintln!("[delegation] project read failed: {e}");
            summary.failed += 1;
            return;
        }
    };
    // Resolve the run context from durable rows only: the bot's own
    // folder row names the workspace, the bot's stored policy names the
    // harness. Nothing is defaulted, nothing is fabricated.
    let (bot, workspace_id) = {
        let conn = db.lock().unwrap();
        let bot = match bots_storage::get_bot(&conn, current_host_id, &folder, &bot_id) {
            Ok(Some(bot)) => bot,
            Ok(None) => {
                drop(conn);
                settle_event(
                    db,
                    event,
                    Verdict {
                        responsibility_id: Some(&responsibility_id),
                        run_id: None,
                        detail: Some("target bot no longer exists"),
                    },
                    DeleteBucket::Orphaned,
                    now_ms,
                    summary,
                );
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
                settle_event(
                    db,
                    event,
                    Verdict {
                        responsibility_id: Some(&responsibility_id),
                        run_id: None,
                        detail: Some("bot workspace row is gone"),
                    },
                    DeleteBucket::Refused,
                    now_ms,
                    summary,
                );
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
        settle_event(
            db,
            event,
            Verdict {
                responsibility_id: Some(&responsibility_id),
                run_id: None,
                detail: Some("bound responsibility no longer exists"),
            },
            DeleteBucket::Orphaned,
            now_ms,
            summary,
        );
        return;
    };
    if !matches!(
        responsibility.trigger,
        ResponsibilityTrigger::Reactive { .. }
    ) {
        settle_event(
            db,
            event,
            Verdict {
                responsibility_id: Some(&responsibility_id),
                run_id: None,
                detail: Some("bound responsibility is not reactive"),
            },
            DeleteBucket::Refused,
            now_ms,
            summary,
        );
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
    // The case's own dispatch choices come from the monitor rule (approval-
    // hashed) when the watch is a `github_pr.v1` one; a file watch has none
    // and keeps today's wording exactly. (The values were computed before
    // the idempotency check — the case IS the dedupe identity.)
    // A pull-request case names its worktree after the case (PR number AND
    // repository): two different repos sharing a PR number never collapse
    // into one worktree, and a redelivery reuses the exact name.
    let worktree_name = match (case_repo, case_pull_number) {
        (Some(repo), Some(number)) => worktree_name_for_pr_case(number, repo),
        _ => worktree_name_for_event(&event.event_id),
    };
    let operating = crate::bots::prompt::build_operating_prompt(
        &bot,
        &build_delegation_prompt(&DelegationPromptInput {
            event,
            project_id: &project_id,
            project_path: &project_path,
            responsibility_name: &responsibility.name,
            responsibility_instructions: &responsibility.instructions,
            worktree_name: &worktree_name,
            used_today: used,
            max_per_day: MAX_DELEGATIONS_PER_BOT_PER_DAY,
            case_harness,
            case_skills,
            case_pull_number,
            case_repo,
        }),
    );
    let mut params = build_harness_start_params(&workspace_id, &operating, &harness);
    // Attribution, hop one: the delegated run's own session carries the
    // event that caused it, so both hops of the chain answer "why did this
    // session appear?" with the same monitor event id.
    params["causedByEventId"] = serde_json::json!(event.event_id);
    let plan = DelegationPlan {
        request_id: request_id.clone(),
        params,
    };
    // No database guard held across the seam call.
    let outcome = runner::dispatch_run_plan(seam, &plan);
    let (host_observation, ended_at, _) = projection_of(&outcome, now_ms, now_ms);
    // Claim = delete, in the SAME transaction as the run row, the firing
    // evidence, and the cap bump: all four commit together or none do.
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
                // A monitor event released this run — never a schedule
                // fire, never a human click. The history's own bucket
                // keeps that distinction honest.
                invocation: Some(ResponsibilityRunInvocation::Reactive),
            },
        )
        .map_err(|e| DelegationError::Storage(format!("run record failed: {e}")))?;
        record_firing_in_tx(
            &tx,
            event,
            Some(&responsibility_id),
            Some(&request_id),
            None,
            "dispatched",
            now_ms,
        )?;
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
