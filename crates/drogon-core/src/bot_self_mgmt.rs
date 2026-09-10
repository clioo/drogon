//! Bot self-management: the NATIVE side of the Bot self-management delivery.
//!
//! The renderer seams/consumer already exist on the stacked source branch
//! (`codex/bots-scope-global`); this module is the daemon half, in priority
//! order:
//!
//! - **P1 — dedicated Bot working folders + profile/scoped-permissions
//!   provisioning.** `bot.self_provision` claims `<base>/bots/<handle>/`
//!   (operator base: `DROGON_BOTS_DIR`, default `<data_dir>/bots` so fixture
//!   data dirs stay isolated; a production data dir rooted at `~/Drogon`
//!   yields exactly `~/Drogon/bots/<handle>`), registers it as a real
//!   workspace through `crate::workspace::register`, and pins a
//!   profile/permissions row in the SAME SQLite file and the SAME
//!   `RequestLedger::run_atomic` transaction as every UI Bot mutation —
//!   never a sidecar file, never a second store. Default permissions scope
//!   the Bot to its home workspace only, with scripts disallowed.
//! - **P2 — monitors on the SAME scheduler/outbox.** Bot monitors tick
//!   through the existing automation scheduler's cron evaluation
//!   (`scheduler::validate_cron` at admission, `scheduler::next_fire_ms`
//!   for due computation) and commit through the existing monitor
//!   decision/storage path (`commit::decide_commit`,
//!   `storage::commit_advance_in_tx`) with change events durably enqueued
//!   into this component's `bot_monitor_events` outbox table in the SAME
//!   transaction as the cursor write — no new timer, no mocked delivery.
//!   Health (healthy/degraded/failing/needs-approval/disabled), check-ins
//!   (every evaluation appends a `bot_monitor_checks` row), read timeouts
//!   (cooperative byte bounds; cancellation stays with the scheduler
//!   owner), failure/recovery thresholds (3 consecutive errors = failing)
//!   and incidents (error check-ins at/after the threshold, closed by the
//!   first later success) all derive from durable rows, never synthesis.
//! - **P3 — audit actor on every Bot-origin mutation.** Every mutating
//!   `bot.self_*` method writes a `bot_audit` row
//!   `(request_id, method, actor_bot_id, target_bot_id, at)` in the SAME
//!   ledger transaction as the mutation itself, so the actor is committed
//!   atomically with the effect it describes. The actor is the acting
//!   Bot's raw id (column `actor_bot_id` carries the namespacing, not the
//!   value); host/UI mutations write no row here.
//! - **P4 — scoped Bot CLI/API over its OWN automations/monitors.**
//!   `bot.self_list/create/update/enable/disable/delete/test` cover both
//!   entity types. Every call asserts `actorBotId == botId` (cross-Bot is
//!   `foreign_bot`), fences writes on the Bot row `rev` / monitor `rev`
//!   (stale is `stale_update`), refuses scope escape (automations and
//!   monitors stay in the provisioned home workspace; file rules stay
//!   under it via `eval::resolve_scoped_path`), refuses new
//!   scripts/resources (interpreter/argv/secrets are never admitted — the
//!   frozen `local_file_digest.v1` rule set), and keeps the approval gate
//!   (ticks refuse unapproved monitors; rule edits re-approve only when
//!   they stay in-scope, otherwise the monitor parks at needs-approval).
//!
//! What this module deliberately does NOT do: mint Bot credentials (the
//! local daemon token still authenticates the transport; `actorBotId` is
//! an assertion fenced exactly like the existing `hostId` assertion),
//! run models (test paths evaluate admission only, never dispatch), or
//! invent schedulers/outboxes/runners (see P2).

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::io::Read as _;

use drogon_protocol::{Request, RpcError};

use crate::automations::execution::InvocationReason;
use crate::automations::records::Automation;
use crate::automations::{scheduler, storage as auto_storage};
use crate::bot_mutation_rpc::{
    NewResponsibilityAutomation, authorize_existing_bot_scope, build_responsibility_automation,
    require_launchable_harness, require_responsibility_name, require_responsibility_prompt,
    resolve_bot_owning_workspace,
};
use crate::bots::monitors::commit::{CommitDecision, RetainReason, StoredMonitorState};
use crate::bots::monitors::eval as monitor_eval;
use crate::bots::monitors::record::{
    MonitorRecord, MonitorTrigger, new_monitor as new_monitor_record,
    staged_rule_edit as staged_monitor_rule_edit,
};
use crate::bots::monitors::result::{MonitorCheckResult, MonitorErrorKind};
use crate::bots::monitors::rule::{LocalFileRule, MAX_FILE_BYTES, MonitorRule};
use crate::bots::monitors::storage as monitor_storage;
use crate::bots::monitors::{backoff_ms, should_admit};
use crate::bots::policy as bot_policy;
use crate::bots::records::{Bot, ResponsibilityTrigger};
use crate::bots::storage as bots_storage;
use crate::{error, workspace};

/// Service capability advertised in `status` (cf. `CAPABILITIES` in
/// `crate::lib`); the CLI preflights it before any `bot.self_*` call.
pub const BOT_SELF_CAPABILITY: &str = "bot.self.v1";

pub const SELF_SCHEMA_COMPONENT: &str = "bot_self";
pub const SELF_SCHEMA_VERSION: i64 = 1;

/// Consecutive error check-ins that flip a monitor from degraded to failing.
pub const FAILURE_THRESHOLD: u32 = 3;
/// Quota per Bot for self-created automations (responsibilities).
pub const MAX_SELF_AUTOMATIONS: usize = 16;
/// Quota per Bot for self-created monitors.
pub const MAX_SELF_MONITORS: usize = 16;
/// Default per-read bound when the caller does not name one.
pub const DEFAULT_MAX_BYTES: u64 = 64 * 1024;
/// Longest admitted Bot handle (also the directory name bound).
pub const MAX_HANDLE_CHARS: usize = 64;

fn invalid_argument(message: impl Into<String>) -> RpcError {
    error::invalid_argument(message)
}

fn not_found(message: impl Into<String>) -> RpcError {
    error::not_found(message)
}

fn storage_error(message: impl Into<String>) -> RpcError {
    error::internal_error(message)
}

fn foreign_bot(message: impl Into<String>) -> RpcError {
    RpcError::new("foreign_bot", message.into())
}

fn stale_update(message: impl Into<String>) -> RpcError {
    RpcError::new("stale_update", message.into())
}

fn bots_storage_error(e: bots_storage::StorageError) -> RpcError {
    match e {
        bots_storage::StorageError::NotFound(what) => not_found(format!("{what} not found")),
        bots_storage::StorageError::StaleUpdate => stale_update("bot changed since it was read"),
        bots_storage::StorageError::OwnershipViolation(what) => {
            invalid_argument(format!("ownership refused: {what}"))
        }
        bots_storage::StorageError::AutomationIdCollision => {
            storage_error("automation id collision")
        }
        bots_storage::StorageError::BotIdCollision => {
            storage_error("bot id already has retained history")
        }
        bots_storage::StorageError::AutomationOwnerConflict => {
            stale_update("automation owner changed since it was read")
        }
        other => storage_error(format!("bot storage failed: {other}")),
    }
}

fn monitor_storage_error(e: monitor_storage::StorageError) -> RpcError {
    match e {
        monitor_storage::StorageError::NotFound(what) => not_found(format!("{what} not found")),
        monitor_storage::StorageError::StaleUpdate => {
            stale_update("monitor changed since it was read")
        }
        monitor_storage::StorageError::IdCollision => storage_error("monitor id collision"),
        monitor_storage::StorageError::Validation(message) => invalid_argument(message),
        other => storage_error(format!("monitor storage failed: {other}")),
    }
}

// ---------------------------------------------------------------------------
// P1: handles, home directories, profiles
// ---------------------------------------------------------------------------

/// Validates a Bot handle into its canonical directory form: trimmed, one
/// leading `@` stripped (exactly like `records::normalize_bot`), then
/// `1..=64` chars of `[A-Za-z0-9_-]` — no separators, no traversal, no
/// empty segments, ever — and finally lowercased. The lowercase canonical
/// form is what makes handles safe on case-insensitive filesystems: two
/// bots whose handles differ only by case (`Watcher` vs `watcher`) claim
/// the SAME directory, so the second claim collides instead of aliasing
/// the first bot's home (see `claim_home_in_tx`). Callers must use the
/// RETURNED form for paths, never the raw input.
pub fn validate_bot_handle(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let stripped = trimmed.strip_prefix('@').unwrap_or(trimmed);
    if stripped.is_empty() {
        return Err("bot handle must not be empty".to_string());
    }
    if stripped.len() > MAX_HANDLE_CHARS {
        return Err(format!(
            "bot handle must be at most {MAX_HANDLE_CHARS} characters"
        ));
    }
    if !stripped
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(
            "bot handle must match [A-Za-z0-9_-]+ (no spaces, no path separators)".to_string(),
        );
    }
    Ok(stripped.to_ascii_lowercase())
}

/// Derives the directory handle for a Bot: its validated stored handle
/// (canonical lowercase — see `validate_bot_handle`), else
/// `bot-<first 8 alphanumeric chars of its id, lowercased>`. The fallback
/// keeps provisioning total (a Bot without a path-safe handle still gets a
/// home) while keeping the preferred `<handle>` shape whenever it is safe.
pub fn dir_handle_for_bot(bot: &Bot) -> Result<String, String> {
    if let Some(handle) = bot.display_identity.handle.as_deref()
        && validate_bot_handle(handle).is_ok()
    {
        return validate_bot_handle(handle);
    }
    let alnum: String = bot
        .id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>()
        .to_ascii_lowercase();
    if alnum.is_empty() {
        return Err("bot id carries no alphanumeric characters for a fallback handle".to_string());
    }
    Ok(format!("bot-{alnum}"))
}

/// Pure base-dir resolution (cf. `drogon-cli`'s `paths::default_data_dir`
/// pattern): `DROGON_BOTS_DIR` when set and non-empty, else
/// `<data_dir>/bots`. Fixture data dirs therefore stay isolated by
/// default; a production host that wants the literal `~/Drogon/bots`
/// layout sets one variable.
pub fn bot_home_base_dir(
    env_value: impl Fn(&str) -> Option<String>,
    data_dir: &std::path::Path,
) -> std::path::PathBuf {
    if let Some(dir) = env_value("DROGON_BOTS_DIR").filter(|v| !v.trim().is_empty()) {
        return std::path::PathBuf::from(dir);
    }
    data_dir.join("bots")
}

fn bot_home_base(data_dir: &std::path::Path) -> std::path::PathBuf {
    bot_home_base_dir(
        |key| {
            std::env::var_os(key)
                .and_then(|v| v.into_string().ok())
                .filter(|v| !v.is_empty())
        },
        data_dir,
    )
}

/// Joins and defends the home path: the validated handle can never escape
/// the base by construction, and the final segment check closes the gap
/// even if validation ever regresses.
pub fn bot_home_dir(base: &std::path::Path, handle: &str) -> Result<std::path::PathBuf, String> {
    validate_bot_handle(handle)?;
    let path = base.join(handle);
    if path.file_name().and_then(|n| n.to_str()) != Some(handle) {
        return Err("bot home path escaped its base directory".to_string());
    }
    Ok(path)
}

pub(crate) fn ensure_home_dir(path: &std::path::Path) -> Result<(), RpcError> {
    std::fs::create_dir_all(path)
        .map_err(|e| storage_error(format!("cannot create bot home directory: {e}")))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| storage_error(format!("cannot restrict bot home permissions: {e}")))?;
    }
    Ok(())
}

/// The provisioned profile/permissions row: identity, home binding, and
/// the scope fence P4 enforces. Scripts are never allowed (`allow_scripts`
/// is always false on write; readers must not interpret a `true` arriving
/// from a future version as permission — unknown fields fail closed at
/// the fence, see `allows_workspace`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BotHomeProfile {
    pub bot_id: String,
    pub handle: String,
    pub path: String,
    pub home_workspace_id: String,
    /// Originating (UI-side) workspace the Bot was provisioned from; kept
    /// for operators, never a P4 write target.
    pub origin_workspace_id: String,
    /// The ONLY workspaces self-created automations/monitors may target.
    pub workspaces: Vec<String>,
    pub allow_scripts: bool,
    pub max_automations: usize,
    pub max_monitors: usize,
    pub created_at: f64,
    pub updated_at: f64,
}

impl BotHomeProfile {
    /// Fail-closed workspace fence: a profile that (from any writer,
    /// present or future) allows scripts or does not list the workspace
    /// admits nothing. P4 create paths call this on the provisioned home
    /// workspace before writing.
    pub fn allows_workspace(&self, workspace_id: &str) -> bool {
        !self.allow_scripts && self.workspaces.iter().any(|w| w == workspace_id)
    }
}

// ---------------------------------------------------------------------------
// P1/P3 storage component: bot_homes, bot_audit, bot_monitor_events
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum SelfStorageError {
    Sqlite(rusqlite::Error),
    Json(serde_json::Error),
    /// `handle` is already pinned by a different Bot.
    HandleCollision {
        handle: String,
        owner: String,
    },
    UnsupportedSchemaVersion {
        component: &'static str,
        found: i64,
        supported: i64,
    },
}

impl From<rusqlite::Error> for SelfStorageError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}
impl From<serde_json::Error> for SelfStorageError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

impl std::fmt::Display for SelfStorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sqlite(e) => write!(f, "sqlite error: {e}"),
            Self::Json(e) => write!(f, "json error: {e}"),
            Self::HandleCollision { handle, owner } => write!(
                f,
                "bot handle {handle:?} is already pinned by bot {owner:?}"
            ),
            Self::UnsupportedSchemaVersion {
                component,
                found,
                supported,
            } => write!(
                f,
                "{component} schema version {found} is newer than the {supported} this build supports"
            ),
        }
    }
}
impl std::error::Error for SelfStorageError {}

type SelfResult<T> = std::result::Result<T, SelfStorageError>;

fn create_self_tables(tx: &Transaction) -> SelfResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS bot_homes (
            bot_id TEXT PRIMARY KEY,
            handle TEXT NOT NULL UNIQUE,
            path TEXT NOT NULL,
            updated_at REAL NOT NULL,
            rev INTEGER NOT NULL DEFAULT 0,
            payload_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS bot_audit (
            request_id TEXT PRIMARY KEY,
            method TEXT NOT NULL,
            actor_bot_id TEXT NOT NULL,
            target_bot_id TEXT NOT NULL,
            at REAL NOT NULL,
            detail_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS bot_audit_target ON bot_audit(target_bot_id);
        CREATE TABLE IF NOT EXISTS bot_monitor_events (
            event_id TEXT PRIMARY KEY,
            monitor_id TEXT NOT NULL,
            bot_id TEXT,
            at REAL NOT NULL,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS bot_monitor_events_monitor_id
            ON bot_monitor_events(monitor_id);",
    )?;
    Ok(())
}

pub fn check_schema_not_ahead(conn: &Connection) -> SelfResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_versions (
            component TEXT PRIMARY KEY,
            version INTEGER NOT NULL
        );",
    )?;
    let existing: Option<i64> = conn
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![SELF_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(found) = existing
        && found > SELF_SCHEMA_VERSION
    {
        return Err(SelfStorageError::UnsupportedSchemaVersion {
            component: SELF_SCHEMA_COMPONENT,
            found,
            supported: SELF_SCHEMA_VERSION,
        });
    }
    Ok(())
}

pub(crate) fn apply_pending_steps_in_tx(tx: &Transaction) -> SelfResult<()> {
    check_schema_not_ahead(tx)?;
    let existing: Option<i64> = tx
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![SELF_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    if existing.is_none() {
        create_self_tables(tx)?;
        tx.execute(
            "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)",
            params![SELF_SCHEMA_COMPONENT, SELF_SCHEMA_VERSION],
        )?;
    }
    Ok(())
}

pub(crate) fn self_storage_error(e: SelfStorageError) -> RpcError {
    match e {
        SelfStorageError::HandleCollision { handle, owner } => invalid_argument(format!(
            "bot handle {handle:?} is already owned by bot {owner:?}"
        )),
        other => storage_error(format!("bot self-management storage failed: {other}")),
    }
}

/// Pins the home profile: INSERTs, or — when this Bot already has a home —
/// returns the pinned row unchanged (handle pinned at first provision;
/// idempotent re-provision). A handle owned by a DIFFERENT Bot is
/// `HandleCollision`, never an overwrite. Handles are canonical lowercase
/// at provisioning (see `validate_bot_handle`), and the collision probe is
/// additionally case-insensitive (`COLLATE NOCASE`) so a pre-normalization
/// row (`Watcher`) still blocks its alias (`watcher`) from claiming the
/// same directory on a case-insensitive filesystem.
pub fn claim_home_in_tx(
    tx: &Transaction,
    profile: &BotHomeProfile,
) -> SelfResult<(BotHomeProfile, bool)> {
    if let Some(json) = tx
        .query_row(
            "SELECT payload_json FROM bot_homes WHERE bot_id = ?1",
            params![profile.bot_id],
            |r| r.get::<_, String>(0),
        )
        .optional()?
    {
        return Ok((serde_json::from_str(&json)?, false));
    }
    let payload = serde_json::to_string(profile)?;
    match tx.execute(
        "INSERT INTO bot_homes (bot_id, handle, path, updated_at, rev, payload_json)
         VALUES (?1, ?2, ?3, ?4, 0, ?5)",
        params![
            profile.bot_id,
            profile.handle,
            profile.path,
            profile.updated_at,
            payload
        ],
    ) {
        Ok(_) => Ok((profile.clone(), true)),
        Err(rusqlite::Error::SqliteFailure(e, _))
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            // Either a lost race with our own bot_id row (now visible) or
            // a genuine handle collision with another Bot.
            if let Some(json) = tx
                .query_row(
                    "SELECT payload_json FROM bot_homes WHERE bot_id = ?1",
                    params![profile.bot_id],
                    |r| r.get::<_, String>(0),
                )
                .optional()?
            {
                return Ok((serde_json::from_str(&json)?, false));
            }
            let owner: Option<String> = tx
                .query_row(
                    "SELECT bot_id FROM bot_homes WHERE handle = ?1 COLLATE NOCASE",
                    params![profile.handle],
                    |r| r.get(0),
                )
                .optional()?;
            Err(SelfStorageError::HandleCollision {
                handle: profile.handle.clone(),
                owner: owner.unwrap_or_else(|| "<unknown>".to_string()),
            })
        }
        Err(e) => Err(e.into()),
    }
}

pub fn home_for_bot(tx: &Transaction, bot_id: &str) -> SelfResult<Option<BotHomeProfile>> {
    tx.query_row(
        "SELECT payload_json FROM bot_homes WHERE bot_id = ?1",
        params![bot_id],
        |r| r.get::<_, String>(0),
    )
    .optional()?
    .map(|json| Ok(serde_json::from_str(&json)?))
    .transpose()
}

/// Get-or-create the Bot's provisioned home (P1): reuses the pinned
/// [`BotHomeProfile`] when one already exists (idempotent -- a Bot only
/// ever gets ONE home, however many times a session against it opens),
/// else claims `<base>/<handle>/`, registers it as a real workspace and
/// pins a fresh profile row. The same steps `Engine::bot_self_provision`'s
/// effect phase performs, extracted so a host/UI-origin caller (never a
/// `bot.self_*` actor, so this writes no `bot_audit` row -- P3 audit is for
/// Bot-origin actions only, see this module's doc) can provision on demand
/// too: opening an interactive Bot session (`bot_run_rpc`'s
/// `RunTurn::Chat::interactive`) must run in the Bot's OWN home, never
/// wherever its record happens to be stored (that folder is whatever
/// project workspace was selected at `bot.create` time -- the caller's
/// workspace, not the Bot's).
pub(crate) fn ensure_home_for_bot(
    tx: &Transaction,
    data_dir: &std::path::Path,
    host_id: &str,
    bot: &Bot,
    origin_workspace_id: &str,
) -> Result<BotHomeProfile, RpcError> {
    if let Some(existing) = home_for_bot(tx, &bot.id).map_err(self_storage_error)? {
        return Ok(existing);
    }
    let handle = dir_handle_for_bot(bot).map_err(|e| invalid_argument(e.to_string()))?;
    let base = bot_home_base(data_dir);
    let home_path = bot_home_dir(&base, &handle).map_err(|e| invalid_argument(e.to_string()))?;
    ensure_home_dir(&home_path)?;
    let home_path_str = home_path.to_string_lossy().to_string();
    let label = format!("Bot {handle}");
    let registered = workspace::register(tx, host_id, &home_path_str, Some(label.as_str()))
        .map_err(|e| storage_error(format!("home workspace registration failed: {}", e.message)))?;
    let home_workspace_id = registered
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| storage_error("home workspace registration unreadable"))?
        .to_string();
    let now_ms = crate::now_unix_ms() as f64;
    let profile = BotHomeProfile {
        bot_id: bot.id.clone(),
        handle,
        path: home_path_str,
        home_workspace_id: home_workspace_id.clone(),
        origin_workspace_id: origin_workspace_id.to_string(),
        workspaces: vec![home_workspace_id],
        allow_scripts: false,
        max_automations: MAX_SELF_AUTOMATIONS,
        max_monitors: MAX_SELF_MONITORS,
        created_at: now_ms,
        updated_at: now_ms,
    };
    let (pinned, _provisioned) = claim_home_in_tx(tx, &profile).map_err(self_storage_error)?;
    Ok(pinned)
}

/// P3: records the Bot-origin actor atomically with the mutation it
/// describes. The stored actor is the acting Bot's RAW id (no `bot:`
/// prefix — the `bot:` namespacing lives in the API field and column
/// names, `actorBotId`/`actor_bot_id`, not the value, so rows join
/// directly against `bot_id`/`target_bot_id`). `INSERT OR IGNORE` keeps a
/// ledger replay (same request_id, same params) from double-logging if
/// work ever re-ran.
pub fn record_audit_in_tx(
    tx: &Transaction,
    request_id: &str,
    method: &str,
    actor_bot_id: &str,
    target_bot_id: &str,
    at: f64,
    detail: &Value,
) -> SelfResult<()> {
    let detail_json = serde_json::to_string(detail)?;
    tx.execute(
        "INSERT OR IGNORE INTO bot_audit
         (request_id, method, actor_bot_id, target_bot_id, at, detail_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            request_id,
            method,
            actor_bot_id,
            target_bot_id,
            at,
            detail_json
        ],
    )?;
    Ok(())
}

pub fn audit_count_for_bot(conn: &Connection, bot_id: &str) -> SelfResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM bot_audit WHERE target_bot_id = ?1",
        params![bot_id],
        |r| r.get(0),
    )?)
}

/// P2 outbox write: one durable row per monitor change event, in the SAME
/// transaction as the cursor advance. `event_id` is content-bound
/// (`eval::event_id_for`), so `INSERT OR IGNORE` dedups replays exactly
/// like C05's same-id + same-hash rule (a same-id + different-hash
/// conflict cannot arise from this layer by construction).
pub fn record_monitor_event_in_tx(
    tx: &Transaction,
    event_id: &str,
    monitor_id: &str,
    bot_id: Option<&str>,
    at: f64,
    payload: &Value,
) -> SelfResult<()> {
    let payload_json = serde_json::to_string(payload)?;
    tx.execute(
        "INSERT OR IGNORE INTO bot_monitor_events
         (event_id, monitor_id, bot_id, at, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![event_id, monitor_id, bot_id, at, payload_json],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// P2: health, incidents, tick
// ---------------------------------------------------------------------------

/// Durable health derived from a monitor record — never synthesized.
/// Thresholds: `FAILURE_THRESHOLD` consecutive errors = failing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MonitorHealth {
    Healthy,
    Degraded,
    Failing,
    NeedsApproval,
    Disabled,
}

impl MonitorHealth {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Healthy => "healthy",
            Self::Degraded => "degraded",
            Self::Failing => "failing",
            Self::NeedsApproval => "needs_approval",
            Self::Disabled => "disabled",
        }
    }
}

pub fn monitor_health(record: &MonitorRecord) -> MonitorHealth {
    if !record.enabled {
        return MonitorHealth::Disabled;
    }
    if !record.is_approved() {
        return MonitorHealth::NeedsApproval;
    }
    if record.consecutive_errors >= FAILURE_THRESHOLD {
        return MonitorHealth::Failing;
    }
    if record.consecutive_errors > 0 {
        return MonitorHealth::Degraded;
    }
    MonitorHealth::Healthy
}

/// One incident: error check-ins at/after the failure threshold, closed by
/// the first later success. Derived from durable check rows only.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorIncident {
    pub monitor_id: String,
    pub started_at_ms: f64,
    pub check_id: String,
    pub error_kind: String,
    pub message: String,
    pub consecutive_errors: u32,
    pub recovered_at_ms: Option<f64>,
}

pub fn incidents_for_monitor(
    conn: &Connection,
    monitor_id: &str,
) -> Result<Vec<MonitorIncident>, monitor_storage::StorageError> {
    let checks = monitor_storage::list_checks_for_monitor(conn, monitor_id)?;
    let mut incidents = Vec::new();
    let mut errors: u32 = 0;
    let mut open: Option<usize> = None;
    for check in &checks {
        match &check.result.outcome {
            crate::bots::monitors::result::MonitorOutcome::Error {
                error_kind,
                message,
            } => {
                errors = errors.saturating_add(1);
                if errors >= FAILURE_THRESHOLD && open.is_none() {
                    open = Some(incidents.len());
                    incidents.push(MonitorIncident {
                        monitor_id: monitor_id.to_string(),
                        started_at_ms: check.started_at_ms,
                        check_id: check.id.clone(),
                        error_kind: format!("{error_kind:?}"),
                        message: message.clone(),
                        consecutive_errors: errors,
                        recovered_at_ms: None,
                    });
                } else if let Some(index) = open {
                    incidents[index].consecutive_errors = errors;
                }
            }
            _ => {
                errors = 0;
                if let Some(index) = open.take() {
                    incidents[index].recovered_at_ms = Some(check.started_at_ms);
                }
            }
        }
    }
    Ok(incidents)
}

fn monitor_state_of(record: &MonitorRecord) -> StoredMonitorState {
    StoredMonitorState {
        monitor_id: record.id.clone(),
        version: record.version,
        cursor: record.cursor.clone(),
        last_event_id: record.last_event_id.clone(),
        enabled: record.enabled,
    }
}

fn all_monitor_records(conn: &Connection) -> Vec<(MonitorRecord, i64)> {
    let mut out = Vec::new();
    let mut stmt = match conn.prepare("SELECT payload_json, rev FROM bot_monitors ORDER BY rowid") {
        Ok(stmt) => stmt,
        Err(_) => return out, // Table predates this component's adoption: no monitors, never an error.
    };
    let rows: Vec<(String, i64)> = match stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .and_then(|rows| rows.collect::<std::result::Result<Vec<_>, _>>())
    {
        Ok(rows) => rows,
        Err(_) => return out,
    };
    for (json, rev) in rows {
        if let Ok(record) = serde_json::from_str::<MonitorRecord>(&json) {
            out.push((record, rev));
        }
    }
    out
}

pub fn monitors_for_bot(
    conn: &Connection,
    bot_id: &str,
) -> Result<Vec<(MonitorRecord, i64)>, monitor_storage::StorageError> {
    Ok(all_monitor_records(conn)
        .into_iter()
        .filter(|(record, _)| record.bot_id.as_deref() == Some(bot_id))
        .collect())
}

/// Bounded, scope-contained file read OUTSIDE any DB lock. Two fences,
/// in order: the lexical containment check (`resolve_scoped_path`, which
/// rejects absolute paths and `..` escapes without touching the
/// filesystem), then canonicalize-and-compare (which resolves every
/// symlink — including a `link.md -> /outside` planted in the home AFTER
/// admission — and verifies the real location still lies under the real
/// home root before a single byte is read). A symlink redirecting outside
/// is an honest `Forbidden` error check-in: cursor retained, nothing
/// emitted, never a silent no-change.
///
/// Both sides are canonicalized because the stored root itself may alias
/// (e.g. a symlinked system temp dir): comparing a canonical file against a
/// non-canonical root would false-positive on every read.
///
/// Residual TOCTOU, stated not hidden: a path swapped between the
/// canonicalize and the open still races. Closing the plant-before-tick
/// class (the proven break) is what this fence is for; pinning open file
/// descriptors is follow-up work, not claimed here.
enum ScopedBytes {
    Bytes(Vec<u8>),
    TooLarge(u64),
    Failure(MonitorErrorKind, String),
}

fn read_scoped_file(project_root: &str, resource: &str, max_bytes: u64) -> ScopedBytes {
    let joined = match monitor_eval::resolve_scoped_path(project_root, resource) {
        Ok(path) => path,
        Err(reason) => return ScopedBytes::Failure(MonitorErrorKind::Malformed, reason),
    };
    let canonical_root = match std::fs::canonicalize(project_root) {
        Ok(root) => root,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return ScopedBytes::Failure(
                MonitorErrorKind::NotFound,
                "monitor workspace root is absent".to_string(),
            );
        }
        Err(e) => {
            return ScopedBytes::Failure(
                MonitorErrorKind::IoError,
                format!("monitor workspace root unreadable: {e}"),
            );
        }
    };
    // Canonicalize resolves every symlink component (including a planted
    // final-segment link) or fails for absent paths — mapped to the same
    // honest shapes the direct open used to produce.
    let canonical_file = match std::fs::canonicalize(&joined) {
        Ok(path) => path,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return ScopedBytes::Failure(
                MonitorErrorKind::NotFound,
                format!("monitored file is absent: {resource}"),
            );
        }
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            return ScopedBytes::Failure(
                MonitorErrorKind::Forbidden,
                format!("monitored file is not readable: {resource}"),
            );
        }
        Err(e) => {
            return ScopedBytes::Failure(
                MonitorErrorKind::IoError,
                format!("monitored file read failed: {e}"),
            );
        }
    };
    if !canonical_file.starts_with(&canonical_root) {
        return ScopedBytes::Failure(
            MonitorErrorKind::Forbidden,
            format!("monitored file escapes the Bot home: {resource}"),
        );
    }
    let bound = max_bytes.min(MAX_FILE_BYTES);
    // Open the canonical path, not the lexical join: the containment
    // verdict above applies to exactly this location.
    let file = match std::fs::File::open(&canonical_file) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return ScopedBytes::Failure(
                MonitorErrorKind::NotFound,
                format!("monitored file is absent: {resource}"),
            );
        }
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            return ScopedBytes::Failure(
                MonitorErrorKind::Forbidden,
                format!("monitored file is not readable: {resource}"),
            );
        }
        Err(e) => {
            return ScopedBytes::Failure(
                MonitorErrorKind::IoError,
                format!("monitored file read failed: {e}"),
            );
        }
    };
    let mut limited = file.take(bound + 1);
    let mut bytes = Vec::new();
    match std::io::Read::read_to_end(&mut limited, &mut bytes) {
        Ok(_) => {}
        Err(e) => {
            return ScopedBytes::Failure(
                MonitorErrorKind::IoError,
                format!("monitored file read failed: {e}"),
            );
        }
    }
    if bytes.len() as u64 > bound {
        return ScopedBytes::TooLarge(bytes.len() as u64);
    }
    ScopedBytes::Bytes(bytes)
}

/// Cron-due on the SAME scheduler the automations use: a monitor with no
/// cursor yet is due (it needs its baseline); otherwise it is due when the
/// scheduler's next fire after its anchor has passed. Manual triggers
/// never fire on tick.
fn monitor_cron_due(record: &MonitorRecord, now_ms: f64) -> bool {
    let MonitorTrigger::Scheduled { cron } = &record.trigger else {
        return false;
    };
    if scheduler::validate_cron(cron).is_err() {
        return false;
    }
    if record.cursor.is_none() {
        return true;
    }
    let anchor = record.last_success_at_ms.unwrap_or(record.created_at_ms);
    match scheduler::next_fire_ms(cron, anchor) {
        Some(next) => now_ms >= next as f64,
        None => false,
    }
}

/// Outcome counts for one monitor tick, for tests and operator logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct MonitorTickSummary {
    pub checked: usize,
    pub evaluated: usize,
    pub changed: usize,
    pub unchanged: usize,
    pub errors: usize,
    pub skipped: usize,
    pub refused: usize,
    pub events: usize,
}

/// Ticks every due Bot monitor: evaluate (no lock held during file IO),
/// then commit cursor + check-in + outbox event in ONE transaction each.
/// Best-effort per monitor — one bad row never aborts the tick — and
/// silent when there is nothing to do.
pub(crate) fn tick_bot_monitors(engine: &crate::Engine, now_ms: f64) -> MonitorTickSummary {
    struct Candidate {
        record: MonitorRecord,
        rev: i64,
        root: String,
        max_bytes: u64,
    }

    let mut summary = MonitorTickSummary::default();
    if engine.is_quiescent() {
        return summary;
    }
    // Phase A: load under the lock, no IO.
    let candidates: Vec<Candidate> = {
        let conn = engine.db.lock().unwrap();
        let mut out = Vec::new();
        for (record, rev) in all_monitor_records(&conn) {
            summary.checked += 1;
            if !record.enabled || !record.is_approved() {
                summary.skipped += 1;
                continue;
            }
            if !matches!(record.trigger, MonitorTrigger::Scheduled { .. }) {
                summary.skipped += 1;
                continue;
            }
            if !should_admit(now_ms, record.next_eligible_at_ms, record.enabled) {
                summary.skipped += 1;
                continue;
            }
            if !monitor_cron_due(&record, now_ms) {
                summary.skipped += 1;
                continue;
            }
            let rule = record.rule.local_file().clone();
            let root = match workspace::get_path(&conn, &rule.project_id) {
                Ok(root) => root,
                Err(_) => {
                    // Unknown workspace: an honest error check-in, committed below.
                    out.push(Candidate {
                        record,
                        rev,
                        root: String::new(),
                        max_bytes: rule.max_bytes,
                    });
                    continue;
                }
            };
            if rule.host_id != engine.host_id {
                summary.refused += 1;
                continue;
            }
            out.push(Candidate {
                max_bytes: rule.max_bytes,
                record,
                rev,
                root,
            });
        }
        out
    };
    // Phase B: evaluate with no lock held.
    struct Evaluated {
        candidate: Candidate,
        result: MonitorCheckResult,
    }
    let mut evaluated = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        summary.evaluated += 1;
        let rule = candidate.record.rule.local_file().clone();
        let result = if candidate.root.is_empty() {
            monitor_eval::read_failure(
                &candidate.record,
                MonitorErrorKind::NotFound,
                "monitor workspace is gone",
                now_ms,
            )
        } else {
            match read_scoped_file(&candidate.root, &rule.resource, candidate.max_bytes) {
                ScopedBytes::Bytes(bytes) => {
                    monitor_eval::evaluate_bytes(&candidate.record, &bytes, now_ms)
                }
                ScopedBytes::TooLarge(len) => MonitorCheckResult::error(
                    &candidate.record.id,
                    candidate.record.version,
                    MonitorErrorKind::Oversized,
                    format!(
                        "monitored file is {len} bytes, bound is {}",
                        candidate.max_bytes.min(MAX_FILE_BYTES)
                    ),
                    now_ms,
                ),
                ScopedBytes::Failure(kind, message) => {
                    monitor_eval::read_failure(&candidate.record, kind, message, now_ms)
                }
            }
        };
        evaluated.push(Evaluated { candidate, result });
    }
    // Phase C: commit each in its own BEGIN IMMEDIATE.
    for Evaluated { candidate, result } in evaluated {
        let rule = candidate.record.rule.local_file().clone();
        let decision = commit::decide_for_tick(&candidate.record, &result);
        match decision {
            CommitDecision::Advance { new_cursor, intent } => {
                let mut updated = candidate.record.clone();
                updated.cursor = Some(new_cursor);
                updated.last_event_id = Some(intent.event_id.clone());
                updated.consecutive_errors = 0;
                updated.next_eligible_at_ms = None;
                updated.last_success_at_ms = Some(now_ms);
                updated.last_error = None;
                updated.updated_at_ms = now_ms;
                let check = monitor_storage::StoredCheck {
                    id: format!("chk_{}", uuid::Uuid::new_v4().to_string().replace('-', "")),
                    monitor_id: updated.id.clone(),
                    monitor_version: updated.version,
                    started_at_ms: now_ms,
                    result: result.clone(),
                    delivery: monitor_storage::DeliveryState::Pending,
                };
                let event_payload = json!({
                    "eventId": intent.event_id,
                    "monitorId": intent.monitor_id,
                    "monitorVersion": intent.monitor_version,
                    "cursor": intent.cursor,
                    "hostId": rule.host_id,
                    "projectId": rule.project_id,
                    "resource": rule.resource,
                    "botId": intent.bot_id,
                    "observedAtMs": now_ms,
                });
                let conn = engine.db.lock().unwrap();
                let tx = match auto_storage::begin_immediate(&conn) {
                    Ok(tx) => tx,
                    Err(e) => {
                        eprintln!("[bot-monitors] tick tx failed: {e}");
                        summary.refused += 1;
                        continue;
                    }
                };
                let event_id = intent.event_id.clone();
                let bot_id = intent.bot_id.clone();
                let enqueue = |tx: &Transaction| {
                    record_monitor_event_in_tx(
                        tx,
                        &event_id,
                        &updated.id,
                        bot_id.as_deref(),
                        now_ms,
                        &event_payload,
                    )
                    .map_err(|e| e.to_string())
                };
                match monitor_storage::commit_advance_in_tx(
                    &tx,
                    &updated,
                    candidate.rev,
                    &check,
                    enqueue,
                ) {
                    Ok(()) => {
                        if tx.commit().is_ok() {
                            summary.changed += 1;
                            summary.events += 1;
                        } else {
                            summary.refused += 1;
                        }
                    }
                    Err(e) => {
                        eprintln!("[bot-monitors] tick commit refused: {e}");
                        summary.refused += 1;
                    }
                }
            }
            CommitDecision::Retain { reason } => {
                let mut updated = candidate.record.clone();
                let mut delivery = monitor_storage::DeliveryState::NotApplicable;
                match reason {
                    RetainReason::NoChange => {
                        updated.consecutive_errors = 0;
                        updated.next_eligible_at_ms = None;
                        updated.last_success_at_ms = Some(now_ms);
                        updated.last_error = None;
                        updated.updated_at_ms = now_ms;
                        summary.unchanged += 1;
                    }
                    RetainReason::ErrorRetained => {
                        updated.consecutive_errors = updated.consecutive_errors.saturating_add(1);
                        updated.next_eligible_at_ms =
                            Some(now_ms + backoff_ms(updated.consecutive_errors));
                        updated.last_error =
                            Some(outcome_error_text(&result).chars().take(512).collect());
                        updated.updated_at_ms = now_ms;
                        delivery = monitor_storage::DeliveryState::NotApplicable;
                        summary.errors += 1;
                    }
                    RetainReason::DuplicateTick | RetainReason::Disabled => {
                        summary.skipped += 1;
                        continue;
                    }
                }
                let check = monitor_storage::StoredCheck {
                    id: format!("chk_{}", uuid::Uuid::new_v4().to_string().replace('-', "")),
                    monitor_id: updated.id.clone(),
                    monitor_version: updated.version,
                    started_at_ms: now_ms,
                    result: result.clone(),
                    delivery,
                };
                let conn = engine.db.lock().unwrap();
                let tx = match auto_storage::begin_immediate(&conn) {
                    Ok(tx) => tx,
                    Err(e) => {
                        eprintln!("[bot-monitors] tick tx failed: {e}");
                        summary.refused += 1;
                        continue;
                    }
                };
                let ok = monitor_storage::cas_write(&tx, &updated, candidate.rev).is_ok()
                    && monitor_storage::record_check(&tx, &check).is_ok()
                    && tx.commit().is_ok();
                if !ok {
                    summary.refused += 1;
                }
            }
            CommitDecision::RefuseStale { reason } => {
                eprintln!("[bot-monitors] tick refused stale: {reason}");
                summary.refused += 1;
            }
        }
    }
    summary
}

fn outcome_error_text(result: &MonitorCheckResult) -> String {
    match &result.outcome {
        crate::bots::monitors::result::MonitorOutcome::Error {
            error_kind,
            message,
        } => {
            format!("{error_kind:?}: {message}")
        }
        crate::bots::monitors::result::MonitorOutcome::NoChange { cursor } => {
            format!("no_change {cursor}")
        }
        crate::bots::monitors::result::MonitorOutcome::Changed { event_id, cursor } => {
            format!("changed {event_id} {cursor}")
        }
    }
}

mod commit {
    //! Tick-local commit-input adapter: the pure `decide_commit` needs the
    //! stored projection plus scope, which the tick rebuilds from the
    //! loaded record so the decision stays exactly the reviewed one.
    use super::*;
    use crate::bots::monitors::commit::{CommitInput, decide_commit};

    pub(super) fn decide_for_tick(
        record: &MonitorRecord,
        result: &MonitorCheckResult,
    ) -> CommitDecision {
        let rule = record.rule.local_file();
        decide_commit(
            &monitor_state_of(record),
            &rule.host_id,
            &rule.project_id,
            &rule.resource,
            record.bot_id.as_deref(),
            result,
            &CommitInput {
                expected_version: record.version,
            },
        )
    }
}

// ---------------------------------------------------------------------------
// P4: scoped Bot RPC surface
// ---------------------------------------------------------------------------

fn parse_params<T: serde::de::DeserializeOwned>(
    params: &Value,
    method: &str,
) -> Result<T, RpcError> {
    serde_json::from_value(params.clone())
        .map_err(|e| invalid_argument(format!("{method} params invalid: {e}")))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelfScope {
    workspace_id: String,
    host_id: String,
    bot_id: String,
    actor_bot_id: String,
}

impl SelfScope {
    fn check_actor(&self) -> Result<(), RpcError> {
        if self.actor_bot_id.trim().is_empty() {
            return Err(invalid_argument("actorBotId must not be empty"));
        }
        if self.actor_bot_id != self.bot_id {
            return Err(foreign_bot(format!(
                "actor bot {} may not act for bot {}",
                self.actor_bot_id, self.bot_id
            )));
        }
        Ok(())
    }
}

/// Resolves the Bot's own folder/workspace AND its provisioned home,
/// enforcing the actor fence first. Returns
/// `(folder, workspace_id, bot, home)`.
fn resolve_self(
    tx: &Transaction,
    derived_host_id: &str,
    scope: &SelfScope,
) -> Result<(String, String, Bot, BotHomeProfile), RpcError> {
    scope.check_actor()?;
    let (folder, workspace_id) = resolve_bot_owning_workspace(
        tx,
        derived_host_id,
        &scope.workspace_id,
        &scope.host_id,
        &scope.bot_id,
    )?;
    let bot = bots_storage::get_bot(tx, derived_host_id, &folder, &scope.bot_id)
        .map_err(bots_storage_error)?
        .ok_or_else(|| not_found(format!("bot {} not found", scope.bot_id)))?;
    let home = home_for_bot(tx, &scope.bot_id)
        .map_err(self_storage_error)?
        .ok_or_else(|| {
            not_found(format!(
                "bot {} has no provisioned home; call bot.self_provision first",
                scope.bot_id
            ))
        })?;
    Ok((folder, workspace_id, bot, home))
}

/// Same, without requiring a provisioned home (provision itself, list).
fn resolve_self_bot(
    tx: &Transaction,
    derived_host_id: &str,
    scope: &SelfScope,
) -> Result<(String, String, Bot), RpcError> {
    scope.check_actor()?;
    let (folder, workspace_id) = resolve_bot_owning_workspace(
        tx,
        derived_host_id,
        &scope.workspace_id,
        &scope.host_id,
        &scope.bot_id,
    )?;
    let bot = bots_storage::get_bot(tx, derived_host_id, &folder, &scope.bot_id)
        .map_err(bots_storage_error)?
        .ok_or_else(|| not_found(format!("bot {} not found", scope.bot_id)))?;
    Ok((folder, workspace_id, bot))
}

fn audit(
    tx: &Transaction,
    request_id: &str,
    method: &str,
    scope: &SelfScope,
    at: f64,
    detail: &Value,
) -> Result<(), RpcError> {
    record_audit_in_tx(
        tx,
        request_id,
        method,
        &scope.actor_bot_id,
        &scope.bot_id,
        at,
        detail,
    )
    .map_err(self_storage_error)
}

fn check_quiescent(engine: &crate::Engine) -> Result<(), RpcError> {
    if engine.quiescent.load(std::sync::atomic::Ordering::Acquire) {
        return Err(crate::error::runtime_busy(
            "service admission is frozen for shutdown",
        ));
    }
    Ok(())
}

fn authorize_self(
    engine: &crate::Engine,
    tx: &Transaction,
    scope: &SelfScope,
) -> Result<(), RpcError> {
    check_quiescent(engine)?;
    scope.check_actor()?;
    authorize_existing_bot_scope(tx, &engine.host_id, &scope.workspace_id, &scope.host_id)
}

fn responsibility_view(bot_id: &str, tx: &Transaction, bot: &Bot) -> Vec<Value> {
    bot.responsibilities
        .iter()
        .map(|r| {
            let (automation_id, schedule, automation_enabled) = match &r.trigger {
                ResponsibilityTrigger::Scheduled { automation_id } => {
                    match auto_storage::get_automation(tx, automation_id) {
                        Ok(Some(a)) if a.bot_id.as_deref() == Some(bot_id) => {
                            (Some(a.id.clone()), Some(a.rrule.clone()), Some(a.enabled))
                        }
                        _ => (Some(automation_id.clone()), None, None),
                    }
                }
                ResponsibilityTrigger::Reactive { .. } => (None, None, None),
            };
            json!({
                "responsibilityId": r.id,
                "automationId": automation_id,
                "name": r.name,
                "enabled": r.enabled,
                "automationEnabled": automation_enabled,
                "schedule": schedule,
                "kind": r.kind,
            })
        })
        .collect()
}

fn monitor_view(record: &MonitorRecord) -> Value {
    let rule = record.rule.local_file();
    json!({
        "id": record.id,
        "version": record.version,
        "enabled": record.enabled,
        "approved": record.is_approved(),
        "health": monitor_health(record).as_str(),
        "resource": rule.resource,
        "maxBytes": rule.max_bytes,
        "trigger": record.trigger,
        "consecutiveErrors": record.consecutive_errors,
        "nextEligibleAtMs": record.next_eligible_at_ms,
        "lastSuccessAtMs": record.last_success_at_ms,
        "lastError": record.last_error,
        "lastEventId": record.last_event_id,
        "hasCursor": record.cursor.is_some(),
    })
}

// --- provision (P1) ---

impl crate::Engine {
    pub(crate) fn bot_self_provision(&self, request: &Request) -> Result<Value, RpcError> {
        let scope: SelfScope = parse_params(&request.params, "bot.self_provision")?;
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |tx| authorize_self(self, tx, &scope),
            |tx| {
                let (_, origin_workspace, bot) = resolve_self_bot(tx, &self.host_id, &scope)?;
                let handle =
                    dir_handle_for_bot(&bot).map_err(|e| invalid_argument(e.to_string()))?;
                let base = bot_home_base(&self.data_dir);
                let home_path =
                    bot_home_dir(&base, &handle).map_err(|e| invalid_argument(e.to_string()))?;
                ensure_home_dir(&home_path)?;
                let home_path_str = home_path.to_string_lossy().to_string();
                let label = format!("Bot {handle}");
                let registered =
                    workspace::register(tx, &self.host_id, &home_path_str, Some(label.as_str()))
                        .map_err(|e| {
                            storage_error(format!(
                                "home workspace registration failed: {}",
                                e.message
                            ))
                        })?;
                let home_workspace_id = registered
                    .get("id")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| storage_error("home workspace registration unreadable"))?
                    .to_string();
                let now_ms = crate::now_unix_ms() as f64;
                let profile = BotHomeProfile {
                    bot_id: bot.id.clone(),
                    handle: handle.clone(),
                    path: home_path_str.clone(),
                    home_workspace_id: home_workspace_id.clone(),
                    origin_workspace_id: origin_workspace.clone(),
                    workspaces: vec![home_workspace_id.clone()],
                    allow_scripts: false,
                    max_automations: MAX_SELF_AUTOMATIONS,
                    max_monitors: MAX_SELF_MONITORS,
                    created_at: now_ms,
                    updated_at: now_ms,
                };
                let (pinned, provisioned) =
                    claim_home_in_tx(tx, &profile).map_err(self_storage_error)?;
                let at = crate::now_unix_ms() as f64;
                audit(
                    tx,
                    &request.request_id,
                    &request.method,
                    &scope,
                    at,
                    &json!({"handle": pinned.handle, "homeWorkspaceId": pinned.home_workspace_id}),
                )?;
                Ok(json!({
                    "hostId": self.host_id,
                    "botId": bot.id,
                    "handle": pinned.handle,
                    "path": pinned.path,
                    "homeWorkspaceId": pinned.home_workspace_id,
                    "originWorkspaceId": pinned.origin_workspace_id,
                    "provisioned": provisioned,
                }))
            },
        )
    }

    // --- list (P4) ---

    pub(crate) fn bot_self_list(&self, request: &Request) -> Result<Value, RpcError> {
        let scope: SelfScope = parse_params(&request.params, "bot.self_list")?;
        scope.check_actor()?;
        if scope.host_id != self.host_id {
            return Err(foreign_bot("request belongs to another execution host"));
        }
        let conn = self.db.lock().unwrap();
        let tx = conn.unchecked_transaction().map_err(error::from_sqlite)?;
        let (folder, _, bot) = resolve_self_bot(&tx, &self.host_id, &scope)?;
        let home = home_for_bot(&tx, &scope.bot_id).map_err(self_storage_error)?;
        let bot_rev = bots_storage::current_rev(&tx, &self.host_id, &folder, &bot.id)
            .map_err(bots_storage_error)?
            .unwrap_or(0);
        let automations = responsibility_view(&bot.id, &tx, &bot);
        let mut monitors = Vec::new();
        for (record, rev) in monitors_for_bot(&tx, &bot.id).map_err(monitor_storage_error)? {
            let mut view = monitor_view(&record);
            view["rev"] = json!(rev);
            monitors.push(view);
        }
        let audit_count = audit_count_for_bot(&tx, &bot.id).map_err(self_storage_error)?;
        Ok(json!({
            "hostId": self.host_id,
            "botId": bot.id,
            "botRev": bot_rev,
            "home": home,
            "automations": automations,
            "monitors": monitors,
            "auditCount": audit_count,
        }))
    }
}

// --- P4: self automations ---

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelfCreateAutomation {
    workspace_id: String,
    host_id: String,
    bot_id: String,
    actor_bot_id: String,
    name: String,
    schedule: String,
    prompt: String,
    enabled: Option<bool>,
}

impl SelfCreateAutomation {
    fn scope(&self) -> SelfScope {
        SelfScope {
            workspace_id: self.workspace_id.clone(),
            host_id: self.host_id.clone(),
            bot_id: self.bot_id.clone(),
            actor_bot_id: self.actor_bot_id.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelfUpdateAutomation {
    workspace_id: String,
    host_id: String,
    bot_id: String,
    actor_bot_id: String,
    responsibility_id: String,
    expected_bot_rev: i64,
    name: Option<String>,
    prompt: Option<String>,
    schedule: Option<String>,
}

impl SelfUpdateAutomation {
    fn scope(&self) -> SelfScope {
        SelfScope {
            workspace_id: self.workspace_id.clone(),
            host_id: self.host_id.clone(),
            bot_id: self.bot_id.clone(),
            actor_bot_id: self.actor_bot_id.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelfSetAutomationEnabled {
    workspace_id: String,
    host_id: String,
    bot_id: String,
    actor_bot_id: String,
    responsibility_id: String,
    expected_bot_rev: i64,
    enabled: bool,
}

impl SelfSetAutomationEnabled {
    fn scope(&self) -> SelfScope {
        SelfScope {
            workspace_id: self.workspace_id.clone(),
            host_id: self.host_id.clone(),
            bot_id: self.bot_id.clone(),
            actor_bot_id: self.actor_bot_id.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelfDeleteAutomation {
    workspace_id: String,
    host_id: String,
    bot_id: String,
    actor_bot_id: String,
    responsibility_id: String,
}

impl SelfDeleteAutomation {
    fn scope(&self) -> SelfScope {
        SelfScope {
            workspace_id: self.workspace_id.clone(),
            host_id: self.host_id.clone(),
            bot_id: self.bot_id.clone(),
            actor_bot_id: self.actor_bot_id.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelfTestAutomation {
    workspace_id: String,
    host_id: String,
    bot_id: String,
    actor_bot_id: String,
    responsibility_id: String,
}

impl SelfTestAutomation {
    fn scope(&self) -> SelfScope {
        SelfScope {
            workspace_id: self.workspace_id.clone(),
            host_id: self.host_id.clone(),
            bot_id: self.bot_id.clone(),
            actor_bot_id: self.actor_bot_id.clone(),
        }
    }
}

/// Applies responsibility edits to the Bot row under the client's expected
/// `rev`, then mirrors the editable fields onto the owned automation row
/// in the SAME transaction. Harness, workspace and ownership are never
/// editable here — privilege escalation has no spelling.
#[allow(clippy::too_many_arguments)] // One tx-wide edit shape; a params struct would only rename the args.
fn edit_owned_responsibility_in_tx(
    tx: &Transaction,
    host_id: &str,
    folder: &str,
    bot: &Bot,
    expected_bot_rev: i64,
    responsibility_id: &str,
    name: Option<String>,
    prompt: Option<String>,
    schedule: Option<String>,
    set_enabled: Option<bool>,
    now_ms: f64,
) -> Result<(Bot, Automation), RpcError> {
    let current = bots_storage::current_rev(tx, host_id, folder, &bot.id)
        .map_err(bots_storage_error)?
        .ok_or_else(|| not_found(format!("bot {} not found", bot.id)))?;
    if current != expected_bot_rev {
        return Err(stale_update(format!(
            "bot rev changed since it was read: expected {expected_bot_rev}, current is {current}"
        )));
    }
    let mut updated_bot = bot.clone();
    let position = updated_bot
        .responsibilities
        .iter()
        .position(|r| r.id == responsibility_id)
        .ok_or_else(|| not_found(format!("responsibility {responsibility_id} not found")))?;
    let automation_id = match &updated_bot.responsibilities[position].trigger {
        ResponsibilityTrigger::Scheduled { automation_id } => automation_id.clone(),
        ResponsibilityTrigger::Reactive { .. } => {
            return Err(invalid_argument(
                "reactive responsibilities are not automations and cannot be edited here",
            ));
        }
    };
    // Ownership is re-proven inside this transaction, never trusted from
    // the request: a missing or foreign-owned automation refuses here.
    let mut automation = bots_storage::require_owned_automation(tx, &bot.id, &automation_id)
        .map_err(bots_storage_error)?;
    if let Some(name) = name {
        let name = require_responsibility_name(&name)?;
        updated_bot.responsibilities[position].name = name.clone();
        automation.name = name;
    }
    if let Some(prompt) = prompt {
        let prompt = require_responsibility_prompt(&prompt)?;
        updated_bot.responsibilities[position].instructions = prompt.clone();
        automation.prompt = prompt;
    }
    let mut cron_touched = false;
    if let Some(schedule) = schedule {
        let cron = scheduler::validate_cron(&schedule).map_err(invalid_argument)?;
        automation.rrule = cron;
        cron_touched = true;
    }
    if let Some(enabled) = set_enabled {
        if enabled && !automation.enabled && automation.next_run_at <= now_ms {
            cron_touched = true;
        }
        updated_bot.responsibilities[position].enabled = enabled;
        automation.enabled = enabled;
    }
    if cron_touched {
        automation.next_run_at = scheduler::next_fire_ms(&automation.rrule, now_ms)
            .map(|ms| ms as f64)
            .ok_or_else(|| invalid_argument("cron expression has no future occurrence from now"))?;
    }
    updated_bot.responsibilities[position].updated_at = now_ms;
    updated_bot.updated_at = now_ms;
    automation.updated_at = now_ms;
    bots_storage::cas_write(tx, host_id, folder, &updated_bot, expected_bot_rev)
        .map_err(bots_storage_error)?;
    auto_storage::upsert_automation(tx, &automation)
        .map_err(|e| storage_error(format!("failed to update automation: {e}")))?;
    Ok((updated_bot, automation))
}

impl crate::Engine {
    pub(crate) fn bot_self_create_automation(&self, request: &Request) -> Result<Value, RpcError> {
        let params: SelfCreateAutomation =
            parse_params(&request.params, "bot.self_create_automation")?;
        let scope = params.scope();
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |tx| authorize_self(self, tx, &scope),
            |tx| {
                let (folder, _, bot, home) = resolve_self(tx, &self.host_id, &scope)?;
                // Fail-closed profile fence: a home row that does not list
                // its own workspace (or that ever allows scripts) admits
                // no self-created automation.
                if !home.allows_workspace(&home.home_workspace_id) {
                    return Err(storage_error("bot home profile forbids new automations"));
                }
                let owned = auto_storage::list_automations_owned_by_bot(tx, &bot.id)
                    .map_err(|e| storage_error(format!("automation lookup failed: {e}")))?;
                if owned.len() >= home.max_automations.max(1) {
                    return Err(invalid_argument("bot automation quota exceeded"));
                }
                let name = require_responsibility_name(&params.name)?;
                let prompt = require_responsibility_prompt(&params.prompt)?;
                let cron = scheduler::validate_cron(&params.schedule).map_err(invalid_argument)?;
                let harness = require_launchable_harness(&bot.harness_policy.default_harness)?;
                let now_ms = crate::now_unix_ms() as f64;
                let automation = build_responsibility_automation(NewResponsibilityAutomation {
                    host_id: self.host_id.clone(),
                    workspace_id: home.home_workspace_id.clone(),
                    bot_id: bot.id.clone(),
                    harness,
                    name: name.clone(),
                    prompt: prompt.clone(),
                    cron,
                    now_ms,
                })?;
                let mut automation = automation;
                if params.enabled == Some(false) {
                    automation.enabled = false;
                }
                let automation_id = automation.id.clone();
                let responsibility_id = uuid::Uuid::new_v4().to_string();
                let responsibility = crate::bots::records::Responsibility {
                    id: responsibility_id.clone(),
                    name,
                    instructions: prompt,
                    kind: crate::bots::records::ResponsibilityKind::Scheduled,
                    trigger: ResponsibilityTrigger::Scheduled {
                        automation_id: automation_id.clone(),
                    },
                    enabled: automation.enabled,
                    recipe: None,
                    created_at: now_ms,
                    updated_at: now_ms,
                };
                bots_storage::create_scheduled_responsibility_in_tx(
                    tx,
                    &self.host_id,
                    &folder,
                    &bot.id,
                    responsibility,
                    automation,
                )
                .map_err(bots_storage_error)?;
                let at = crate::now_unix_ms() as f64;
                audit(
                    tx,
                    &request.request_id,
                    &request.method,
                    &scope,
                    at,
                    &json!({"responsibilityId": responsibility_id, "automationId": automation_id}),
                )?;
                Ok(json!({
                    "hostId": self.host_id,
                    "botId": bot.id,
                    "responsibilityId": responsibility_id,
                    "automationId": automation_id,
                }))
            },
        )
    }

    pub(crate) fn bot_self_update_automation(&self, request: &Request) -> Result<Value, RpcError> {
        let params: SelfUpdateAutomation =
            parse_params(&request.params, "bot.self_update_automation")?;
        if params.name.is_none() && params.prompt.is_none() && params.schedule.is_none() {
            return Err(invalid_argument(
                "at least one of name, prompt or schedule must be supplied",
            ));
        }
        let scope = params.scope();
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |tx| authorize_self(self, tx, &scope),
            |tx| {
                let (folder, _, bot, _) = resolve_self(tx, &self.host_id, &scope)?;
                let now_ms = crate::now_unix_ms() as f64;
                let (updated_bot, automation) = edit_owned_responsibility_in_tx(
                    tx,
                    &self.host_id,
                    &folder,
                    &bot,
                    params.expected_bot_rev,
                    &params.responsibility_id,
                    params.name.clone(),
                    params.prompt.clone(),
                    params.schedule.clone(),
                    None,
                    now_ms,
                )?;
                let at = crate::now_unix_ms() as f64;
                audit(
                    tx,
                    &request.request_id,
                    &request.method,
                    &scope,
                    at,
                    &json!({"responsibilityId": params.responsibility_id}),
                )?;
                Ok(json!({
                    "hostId": self.host_id,
                    "botId": bot.id,
                    "responsibilityId": params.responsibility_id,
                    "automationId": automation.id,
                    "botRev": bots_storage::current_rev(
                        tx, &self.host_id, &folder, &bot.id
                    )
                    .map_err(bots_storage_error)?
                    .unwrap_or(0),
                    "enabled": updated_bot.responsibilities.iter()
                        .find(|r| r.id == params.responsibility_id)
                        .map(|r| r.enabled)
                        .unwrap_or(false),
                }))
            },
        )
    }

    pub(crate) fn bot_self_set_automation_enabled(
        &self,
        request: &Request,
    ) -> Result<Value, RpcError> {
        let params: SelfSetAutomationEnabled =
            parse_params(&request.params, "bot.self_set_automation_enabled")?;
        let scope = params.scope();
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |tx| authorize_self(self, tx, &scope),
            |tx| {
                let (folder, _, bot, _) = resolve_self(tx, &self.host_id, &scope)?;
                let now_ms = crate::now_unix_ms() as f64;
                let (_, automation) = edit_owned_responsibility_in_tx(
                    tx,
                    &self.host_id,
                    &folder,
                    &bot,
                    params.expected_bot_rev,
                    &params.responsibility_id,
                    None,
                    None,
                    None,
                    Some(params.enabled),
                    now_ms,
                )?;
                let at = crate::now_unix_ms() as f64;
                audit(
                    tx,
                    &request.request_id,
                    &request.method,
                    &scope,
                    at,
                    &json!({"responsibilityId": params.responsibility_id, "enabled": params.enabled}),
                )?;
                Ok(json!({
                    "hostId": self.host_id,
                    "botId": bot.id,
                    "responsibilityId": params.responsibility_id,
                    "automationId": automation.id,
                    "enabled": params.enabled,
                }))
            },
        )
    }

    pub(crate) fn bot_self_delete_automation(&self, request: &Request) -> Result<Value, RpcError> {
        let params: SelfDeleteAutomation =
            parse_params(&request.params, "bot.self_delete_automation")?;
        let scope = params.scope();
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |tx| authorize_self(self, tx, &scope),
            |tx| {
                let (folder, _, bot, _) = resolve_self(tx, &self.host_id, &scope)?;
                // Cross-Bot denial: the responsibility must live on the
                // actor's own Bot row — a foreign id is not_found, never
                // resolved elsewhere.
                if !bot
                    .responsibilities
                    .iter()
                    .any(|r| r.id == params.responsibility_id)
                {
                    return Err(not_found(format!(
                        "responsibility {} not found",
                        params.responsibility_id
                    )));
                }
                let now_ms = crate::now_unix_ms() as f64;
                let deleted = bots_storage::delete_responsibility_in_tx(
                    tx,
                    &self.host_id,
                    &folder,
                    &bot.id,
                    &params.responsibility_id,
                    now_ms,
                )
                .map_err(bots_storage_error)?;
                let at = crate::now_unix_ms() as f64;
                audit(
                    tx,
                    &request.request_id,
                    &request.method,
                    &scope,
                    at,
                    &json!({"responsibilityId": params.responsibility_id}),
                )?;
                Ok(json!({
                    "hostId": self.host_id,
                    "botId": bot.id,
                    "responsibilityId": deleted.responsibility_id,
                    "removed": true,
                    "automationId": deleted.automation_id,
                }))
            },
        )
    }

    /// Admission-only test: re-derives the real policy + automation
    /// eligibility decision from durable rows and reports it, without
    /// dispatching anything — no session, no model, no effect.
    pub(crate) fn bot_self_test_automation(&self, request: &Request) -> Result<Value, RpcError> {
        let params: SelfTestAutomation = parse_params(&request.params, "bot.self_test_automation")?;
        let scope = params.scope();
        scope.check_actor()?;
        if scope.host_id != self.host_id {
            return Err(foreign_bot("request belongs to another execution host"));
        }
        let conn = self.db.lock().unwrap();
        let tx = conn.unchecked_transaction().map_err(error::from_sqlite)?;
        let (folder, _, _) = resolve_self_bot(&tx, &self.host_id, &scope)?;
        // resolve_self_bot already fenced the actor to its own Bot; the
        // from-storage evaluation re-proves ownership once more.
        let attempt = bot_policy::evaluate_and_attempt_responsibility_dispatch_from_storage(
            &tx,
            &self.host_id,
            &folder,
            &scope.bot_id,
            &params.responsibility_id,
            &self.host_id,
            &InvocationReason::Manual,
        );
        match attempt {
            Ok(bot_policy::ResponsibilityDispatchAttempt::Dispatched(outcome)) => Ok(json!({
                "hostId": self.host_id,
                "botId": scope.bot_id,
                "responsibilityId": params.responsibility_id,
                "eligible": true,
                "outcome": format!("{outcome:?}"),
            })),
            Ok(bot_policy::ResponsibilityDispatchAttempt::RefusedByResponsibility(reason)) => {
                Ok(json!({
                    "hostId": self.host_id,
                    "botId": scope.bot_id,
                    "responsibilityId": params.responsibility_id,
                    "eligible": false,
                    "refusedBy": "responsibility",
                    "reason": format!("{reason:?}"),
                }))
            }
            Ok(bot_policy::ResponsibilityDispatchAttempt::RefusedByAutomation(reason)) => {
                Ok(json!({
                    "hostId": self.host_id,
                    "botId": scope.bot_id,
                    "responsibilityId": params.responsibility_id,
                    "eligible": false,
                    "refusedBy": "automation",
                    "reason": format!("{reason:?}"),
                }))
            }
            Err(bot_policy::ResponsibilityLookupError::BotNotFound) => {
                Err(not_found(format!("bot {} not found", scope.bot_id)))
            }
            Err(bot_policy::ResponsibilityLookupError::ResponsibilityNotFound) => Err(not_found(
                format!("responsibility {} not found", params.responsibility_id),
            )),
            Err(e) => Err(storage_error(format!("test evaluation failed: {e}"))),
        }
    }
}

// --- P4: self monitors ---

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelfTriggerWire {
    kind: String,
    cron: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelfCreateMonitor {
    workspace_id: String,
    host_id: String,
    bot_id: String,
    actor_bot_id: String,
    resource: String,
    max_bytes: Option<u64>,
    trigger: SelfTriggerWire,
    enabled: Option<bool>,
}

impl SelfCreateMonitor {
    fn scope(&self) -> SelfScope {
        SelfScope {
            workspace_id: self.workspace_id.clone(),
            host_id: self.host_id.clone(),
            bot_id: self.bot_id.clone(),
            actor_bot_id: self.actor_bot_id.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelfUpdateMonitor {
    workspace_id: String,
    host_id: String,
    bot_id: String,
    actor_bot_id: String,
    monitor_id: String,
    expected_rev: i64,
    resource: Option<String>,
    max_bytes: Option<u64>,
    trigger: Option<SelfTriggerWire>,
}

impl SelfUpdateMonitor {
    fn scope(&self) -> SelfScope {
        SelfScope {
            workspace_id: self.workspace_id.clone(),
            host_id: self.host_id.clone(),
            bot_id: self.bot_id.clone(),
            actor_bot_id: self.actor_bot_id.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelfSetMonitorEnabled {
    workspace_id: String,
    host_id: String,
    bot_id: String,
    actor_bot_id: String,
    monitor_id: String,
    expected_rev: i64,
    enabled: bool,
}

impl SelfSetMonitorEnabled {
    fn scope(&self) -> SelfScope {
        SelfScope {
            workspace_id: self.workspace_id.clone(),
            host_id: self.host_id.clone(),
            bot_id: self.bot_id.clone(),
            actor_bot_id: self.actor_bot_id.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelfDeleteMonitor {
    workspace_id: String,
    host_id: String,
    bot_id: String,
    actor_bot_id: String,
    monitor_id: String,
}

impl SelfDeleteMonitor {
    fn scope(&self) -> SelfScope {
        SelfScope {
            workspace_id: self.workspace_id.clone(),
            host_id: self.host_id.clone(),
            bot_id: self.bot_id.clone(),
            actor_bot_id: self.actor_bot_id.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SelfTestMonitor {
    workspace_id: String,
    host_id: String,
    bot_id: String,
    actor_bot_id: String,
    monitor_id: String,
}

impl SelfTestMonitor {
    fn scope(&self) -> SelfScope {
        SelfScope {
            workspace_id: self.workspace_id.clone(),
            host_id: self.host_id.clone(),
            bot_id: self.bot_id.clone(),
            actor_bot_id: self.actor_bot_id.clone(),
        }
    }
}

/// Builds the server-resolved trigger: `manual`, or a `scheduled` cron
/// that the SAME scheduler validates. Anything else is denied.
fn admit_self_trigger(trigger: &SelfTriggerWire) -> Result<MonitorTrigger, RpcError> {
    match trigger.kind.as_str() {
        "manual" => {
            if trigger.cron.is_some() {
                return Err(invalid_argument("a manual trigger takes no cron"));
            }
            Ok(MonitorTrigger::Manual)
        }
        "scheduled" => {
            let cron = trigger
                .cron
                .as_deref()
                .ok_or_else(|| invalid_argument("a scheduled trigger requires cron"))?;
            let cron = scheduler::validate_cron(cron).map_err(invalid_argument)?;
            Ok(MonitorTrigger::Scheduled { cron })
        }
        other => Err(invalid_argument(format!(
            "unknown monitor trigger kind {other:?}"
        ))),
    }
}

fn admit_self_max_bytes(max_bytes: Option<u64>) -> Result<u64, RpcError> {
    let bound = max_bytes.unwrap_or(DEFAULT_MAX_BYTES);
    if bound == 0 || bound > MAX_FILE_BYTES {
        return Err(invalid_argument(format!(
            "maxBytes must be 1..={MAX_FILE_BYTES}"
        )));
    }
    Ok(bound)
}

/// Builds the server-resolved rule: scope always comes from the derived
/// host and the provisioned home workspace — a client-supplied scope has
/// no spelling, so cross-scope rules cannot be requested. Only the frozen
/// `local_file_digest.v1` kind exists; scripts, interpreters and secrets
/// stay refused by `MonitorRecord::validate`.
fn build_self_rule(
    host_id: &str,
    home_workspace_id: &str,
    resource: &str,
    max_bytes: u64,
) -> Result<MonitorRule, RpcError> {
    if resource.is_empty() || resource.len() > 1024 {
        return Err(invalid_argument("resource must be 1..=1024 bytes"));
    }
    let rule = MonitorRule::LocalFileDigest(LocalFileRule {
        host_id: host_id.to_string(),
        project_id: home_workspace_id.to_string(),
        resource: resource.to_string(),
        max_bytes,
    });
    crate::bots::monitors::rule::validate_rule(&rule).map_err(invalid_argument)?;
    // Containment is proven now, not only at tick time: an escaping
    // resource is denied at admission.
    monitor_eval::resolve_scoped_path("/home", resource).map_err(invalid_argument)?;
    Ok(rule)
}

/// Loads a monitor fenced to the actor's own Bot: missing, or owned by a
/// different Bot (or no Bot), is denied — cross-Bot reads have no spelling.
fn load_owned_monitor(
    conn: &Connection,
    bot_id: &str,
    monitor_id: &str,
) -> Result<(MonitorRecord, i64), RpcError> {
    let (record, rev) = monitor_storage::get_monitor(conn, monitor_id)
        .map_err(monitor_storage_error)?
        .ok_or_else(|| not_found(format!("monitor {monitor_id} not found")))?;
    if record.bot_id.as_deref() != Some(bot_id) {
        return Err(foreign_bot(format!(
            "monitor {monitor_id} is not owned by bot {bot_id}"
        )));
    }
    Ok((record, rev))
}

impl crate::Engine {
    pub(crate) fn bot_self_create_monitor(&self, request: &Request) -> Result<Value, RpcError> {
        let params: SelfCreateMonitor = parse_params(&request.params, "bot.self_create_monitor")?;
        let scope = params.scope();
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |tx| authorize_self(self, tx, &scope),
            |tx| {
                let (_, _, _, home) = resolve_self(tx, &self.host_id, &scope)?;
                if !home.allows_workspace(&home.home_workspace_id) {
                    return Err(storage_error("bot home profile forbids new monitors"));
                }
                let owned = monitors_for_bot(tx, &scope.bot_id).map_err(monitor_storage_error)?;
                if owned.len() >= home.max_monitors.max(1) {
                    return Err(invalid_argument("bot monitor quota exceeded"));
                }
                let max_bytes = admit_self_max_bytes(params.max_bytes)?;
                let rule = build_self_rule(
                    &self.host_id,
                    &home.home_workspace_id,
                    &params.resource,
                    max_bytes,
                )?;
                let trigger = admit_self_trigger(&params.trigger)?;
                let now_ms = crate::now_unix_ms() as f64;
                let id = uuid::Uuid::new_v4().to_string();
                // Self-created monitors arrive approved for their exact
                // initial rule (in-scope file digests only — see
                // build_self_rule) but follow the caller's enabled flag
                // (default on). Rule edits below re-approve only while
                // they stay in-scope; anything else parks at
                // needs-approval until the host re-provisions.
                let approved = rule.approval_hash();
                let mut record = new_monitor_record(
                    id.clone(),
                    Some(scope.bot_id.clone()),
                    rule,
                    trigger,
                    approved,
                    now_ms,
                )
                .map_err(invalid_argument)?;
                record.enabled = params.enabled.unwrap_or(true);
                if !record.is_approved() {
                    return Err(storage_error("new monitor must be approved"));
                }
                monitor_storage::create_monitor(tx, &record).map_err(monitor_storage_error)?;
                let at = crate::now_unix_ms() as f64;
                audit(
                    tx,
                    &request.request_id,
                    &request.method,
                    &scope,
                    at,
                    &json!({"monitorId": id}),
                )?;
                Ok(json!({
                    "hostId": self.host_id,
                    "botId": scope.bot_id,
                    "monitorId": id,
                    "approved": true,
                    "health": monitor_health(&record).as_str(),
                }))
            },
        )
    }

    pub(crate) fn bot_self_update_monitor(&self, request: &Request) -> Result<Value, RpcError> {
        let params: SelfUpdateMonitor = parse_params(&request.params, "bot.self_update_monitor")?;
        if params.resource.is_none() && params.max_bytes.is_none() && params.trigger.is_none() {
            return Err(invalid_argument(
                "at least one of resource, maxBytes or trigger must be supplied",
            ));
        }
        let scope = params.scope();
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |tx| authorize_self(self, tx, &scope),
            |tx| {
                let (_, _, _, home) = resolve_self(tx, &self.host_id, &scope)?;
                let (record, rev) = load_owned_monitor(tx, &scope.bot_id, &params.monitor_id)?;
                if rev != params.expected_rev {
                    return Err(stale_update(format!(
                        "monitor rev changed since it was read: expected {}, current is {rev}",
                        params.expected_rev
                    )));
                }
                let now_ms = crate::now_unix_ms() as f64;
                let current = record.rule.local_file().clone();
                let resource = params.resource.as_deref().unwrap_or(&current.resource);
                let max_bytes = admit_self_max_bytes(params.max_bytes.or(Some(current.max_bytes)))?;
                let rule =
                    build_self_rule(&self.host_id, &home.home_workspace_id, resource, max_bytes)?;
                let mut updated =
                    staged_monitor_rule_edit(record, rule, now_ms).map_err(invalid_argument)?;
                if let Some(trigger) = params.trigger.as_ref() {
                    updated.trigger = admit_self_trigger(trigger)?;
                }
                // Re-approval stays in-scope-gated: build_self_rule already
                // refused anything outside the provisioned home, so the
                // staged rule is approvable by construction here.
                updated.approved_rule_hash = updated.rule.approval_hash();
                updated.updated_at_ms = now_ms;
                monitor_storage::cas_write(tx, &updated, params.expected_rev)
                    .map_err(monitor_storage_error)?;
                let at = crate::now_unix_ms() as f64;
                audit(
                    tx,
                    &request.request_id,
                    &request.method,
                    &scope,
                    at,
                    &json!({"monitorId": params.monitor_id}),
                )?;
                Ok(json!({
                    "hostId": self.host_id,
                    "botId": scope.bot_id,
                    "monitorId": updated.id,
                    "version": updated.version,
                    "approved": updated.is_approved(),
                    "health": monitor_health(&updated).as_str(),
                }))
            },
        )
    }

    pub(crate) fn bot_self_set_monitor_enabled(
        &self,
        request: &Request,
    ) -> Result<Value, RpcError> {
        let params: SelfSetMonitorEnabled =
            parse_params(&request.params, "bot.self_set_monitor_enabled")?;
        let scope = params.scope();
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |tx| authorize_self(self, tx, &scope),
            |tx| {
                let (_, _, _, _) = resolve_self(tx, &self.host_id, &scope)?;
                let (mut record, rev) = load_owned_monitor(tx, &scope.bot_id, &params.monitor_id)?;
                if rev != params.expected_rev {
                    return Err(stale_update(format!(
                        "monitor rev changed since it was read: expected {}, current is {rev}",
                        params.expected_rev
                    )));
                }
                // Enabling an unapproved monitor is denied: edits park at
                // needs-approval until re-approved in-scope.
                if params.enabled && !record.is_approved() {
                    return Err(invalid_argument(
                        "monitor needs approval before it can be enabled",
                    ));
                }
                let now_ms = crate::now_unix_ms() as f64;
                record.enabled = params.enabled;
                record.updated_at_ms = now_ms;
                if params.enabled {
                    record.next_eligible_at_ms = None;
                }
                monitor_storage::cas_write(tx, &record, params.expected_rev)
                    .map_err(monitor_storage_error)?;
                let at = crate::now_unix_ms() as f64;
                audit(
                    tx,
                    &request.request_id,
                    &request.method,
                    &scope,
                    at,
                    &json!({"monitorId": params.monitor_id, "enabled": params.enabled}),
                )?;
                Ok(json!({
                    "hostId": self.host_id,
                    "botId": scope.bot_id,
                    "monitorId": record.id,
                    "enabled": record.enabled,
                    "health": monitor_health(&record).as_str(),
                }))
            },
        )
    }

    pub(crate) fn bot_self_delete_monitor(&self, request: &Request) -> Result<Value, RpcError> {
        let params: SelfDeleteMonitor = parse_params(&request.params, "bot.self_delete_monitor")?;
        let scope = params.scope();
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |tx| authorize_self(self, tx, &scope),
            |tx| {
                let (_, _, _, _) = resolve_self(tx, &self.host_id, &scope)?;
                // Ownership fence first: foreign ids never reach deletion.
                let _ = load_owned_monitor(tx, &scope.bot_id, &params.monitor_id)?;
                // Check history is retained as orphaned evidence (same
                // contract as responsibility runs); only the row goes.
                let removed = monitor_storage::delete_monitor(tx, &params.monitor_id)
                    .map_err(monitor_storage_error)?;
                if !removed {
                    return Err(not_found(format!(
                        "monitor {} not found",
                        params.monitor_id
                    )));
                }
                let at = crate::now_unix_ms() as f64;
                audit(
                    tx,
                    &request.request_id,
                    &request.method,
                    &scope,
                    at,
                    &json!({"monitorId": params.monitor_id}),
                )?;
                Ok(json!({
                    "hostId": self.host_id,
                    "botId": scope.bot_id,
                    "monitorId": params.monitor_id,
                    "removed": true,
                }))
            },
        )
    }

    /// Admission-only test: reads the real file (bounded, no lock held)
    /// and reports the evaluation WITHOUT committing cursor, checks or
    /// events — a dry run with real bytes.
    pub(crate) fn bot_self_test_monitor(&self, request: &Request) -> Result<Value, RpcError> {
        let params: SelfTestMonitor = parse_params(&request.params, "bot.self_test_monitor")?;
        let scope = params.scope();
        scope.check_actor()?;
        if scope.host_id != self.host_id {
            return Err(foreign_bot("request belongs to another execution host"));
        }
        let (record, root) = {
            let conn = self.db.lock().unwrap();
            let tx = conn.unchecked_transaction().map_err(error::from_sqlite)?;
            let (_, _, _) = resolve_self_bot(&tx, &self.host_id, &scope)?;
            let (record, _) = load_owned_monitor(&tx, &scope.bot_id, &params.monitor_id)?;
            let rule = record.rule.local_file().clone();
            let root = workspace::get_path(&tx, &rule.project_id)
                .map_err(|e| not_found(format!("monitor workspace is gone: {}", e.message)))?;
            (record, root)
        };
        let now_ms = crate::now_unix_ms() as f64;
        if !record.enabled {
            return Ok(json!({
                "hostId": self.host_id,
                "botId": scope.bot_id,
                "monitorId": record.id,
                "eligible": false,
                "reason": "disabled",
                "health": monitor_health(&record).as_str(),
            }));
        }
        if !record.is_approved() {
            return Ok(json!({
                "hostId": self.host_id,
                "botId": scope.bot_id,
                "monitorId": record.id,
                "eligible": false,
                "reason": "needs_approval",
                "health": monitor_health(&record).as_str(),
            }));
        }
        let rule = record.rule.local_file().clone();
        let outcome = match read_scoped_file(&root, &rule.resource, rule.max_bytes) {
            ScopedBytes::Bytes(bytes) => {
                let result = monitor_eval::evaluate_bytes(&record, &bytes, now_ms);
                json!({"evaluated": true, "outcome": result.outcome})
            }
            ScopedBytes::TooLarge(len) => {
                json!({"evaluated": false, "reason": "oversized", "bytes": len})
            }
            ScopedBytes::Failure(kind, message) => json!({
                "evaluated": false,
                "reason": format!("{kind:?}"),
                "message": message,
            }),
        };
        Ok(json!({
            "hostId": self.host_id,
            "botId": scope.bot_id,
            "monitorId": record.id,
            "eligible": outcome.get("evaluated").and_then(|v| v.as_bool()).unwrap_or(false),
            "health": monitor_health(&record).as_str(),
            "detail": outcome,
        }))
    }
}
