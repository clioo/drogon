//! Born-empty Bot creation under canonical atomic receipts and execution-host ownership.
//!
//! MIT Copyright (c) 2026 Lovecast Inc. Adapted from the fork's
//! `src/shared/drogon-bot-contract.ts` (responsibility and run-record
//! shapes) and `src/main/bots/bot-service.ts` (responsibility
//! create/run-record semantics), source revision
//! `c97906287bb7a390b25e2025b600d9fb3c25d9c3`; the daemon keeps the
//! same receipts/ownership invariants natively over SQLite.

use rusqlite::{Connection, Transaction};
use serde_json::{Value, json};

use crate::automations::records::{
    Automation, ExecutionTargetType, MissedRunPolicy, SchedulerOwner, WorkspaceMode,
};
use crate::automations::scheduler;
use crate::bots::input::parse_bot_create;
use crate::bots::records::{
    Bot, DisplayIdentity, HarnessModelPolicy, Responsibility, ResponsibilityKind,
    ResponsibilityTrigger,
};
use crate::bots::storage as bots_storage;
use drogon_protocol::RpcError;
use drogon_protocol::bot::{
    BotDeleteParams, BotDeleteResult, BotResponsibilityCreateParams, BotResponsibilityCreateResult,
    BotResponsibilityDeleteParams, BotResponsibilityDeleteResult,
};

// The envelope request ID must not enter the params fingerprint.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct BotCreateRequest {
    pub workspace_id: String,
    /// Client assertion only; verified against the derived host.
    pub asserted_host_id: String,
    pub bot_id: Option<String>,
    pub body: Value,
    pub _locale: Option<String>,
}

fn invalid_argument(message: impl Into<String>) -> RpcError {
    RpcError::new("invalid_argument", message.into())
}

fn not_found(message: impl Into<String>) -> RpcError {
    RpcError::new("not_found", message.into())
}

fn unknown_workspace(message: impl Into<String>) -> RpcError {
    RpcError::new("unknown_workspace", message.into())
}

fn foreign_workspace_host(message: impl Into<String>) -> RpcError {
    RpcError::new("foreign_workspace_host", message.into())
}

fn storage_error(message: impl Into<String>) -> RpcError {
    RpcError::new("storage_error", message.into())
}

fn required_string(object: &Value, key: &str) -> Result<String, RpcError> {
    let value = object
        .get(key)
        .ok_or_else(|| invalid_argument(format!("missing required field {key}")))?;
    let text = value
        .as_str()
        .ok_or_else(|| invalid_argument(format!("field {key} must be a string")))?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(invalid_argument(format!("field {key} must be non-empty")));
    }
    Ok(trimmed.to_string())
}

fn optional_string(object: &Value, key: &str) -> Result<Option<String>, RpcError> {
    match object.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .map(|text| Some(text.to_string()))
            .ok_or_else(|| invalid_argument(format!("field {key} must be a string"))),
    }
}

pub(crate) fn parse_bot_create_request(params: &Value) -> Result<BotCreateRequest, RpcError> {
    let object = params
        .as_object()
        .ok_or_else(|| invalid_argument("bot.create params must be an object"))?;
    let admitted = ["workspaceId", "hostId", "botId", "body", "locale"];
    for key in object.keys() {
        if !admitted.contains(&key.as_str()) {
            return Err(invalid_argument(format!("unknown field {key}")));
        }
    }
    let body = object
        .get("body")
        .ok_or_else(|| invalid_argument("missing required field body"))?;
    let normalized_body = parse_bot_create(body).map_err(|e| invalid_argument(e.to_string()))?;
    let bot_id = optional_string(params, "botId")?;
    // Match the existing desktop ID boundary, including UTF-16 length.
    if let Some(id) = &bot_id
        && (id.is_empty()
            || id.encode_utf16().count() > 128
            || id.chars().any(|c| (c as u32) <= 0x1f || c == '\u{7f}'))
    {
        return Err(invalid_argument("Invalid Bot identifier"));
    }
    Ok(BotCreateRequest {
        workspace_id: required_string(params, "workspaceId")?,
        asserted_host_id: required_string(params, "hostId")?,
        bot_id,
        body: normalized_body,
        _locale: optional_string(params, "locale")?,
    })
}

// Replays must not bypass changed execution-host ownership.
pub(crate) fn authorize_create_scope(
    conn: &Connection,
    derived_host_id: &str,
    request: &BotCreateRequest,
) -> Result<(), RpcError> {
    owned_folder(conn, derived_host_id, request).map(|_| ())
}

fn build_bot(bot_id: &str, body: &Value, now_ms: u64) -> Result<Bot, RpcError> {
    let part = |key: &str| -> Result<Value, RpcError> {
        body.get(key)
            .cloned()
            .ok_or_else(|| storage_error(format!("normalized body missing {key}")))
    };
    let display_identity: DisplayIdentity = serde_json::from_value(part("displayIdentity")?)
        .map_err(|e| storage_error(format!("normalized displayIdentity unreadable: {e}")))?;
    let harness_policy: HarnessModelPolicy = serde_json::from_value(part("harnessPolicy")?)
        .map_err(|e| storage_error(format!("normalized harnessPolicy unreadable: {e}")))?;
    let memories: Vec<String> = serde_json::from_value(part("memories")?)
        .map_err(|e| storage_error(format!("normalized memories unreadable: {e}")))?;
    Ok(Bot {
        id: bot_id.to_string(),
        character_preset: body
            .get("characterPreset")
            .and_then(Value::as_str)
            .ok_or_else(|| storage_error("normalized body missing characterPreset"))?
            .to_string(),
        display_identity,
        harness_policy,
        instructions: body
            .get("instructions")
            .and_then(Value::as_str)
            .ok_or_else(|| storage_error("normalized body missing instructions"))?
            .to_string(),
        memories,
        // Creation never inherits duties or starts execution.
        responsibilities: Vec::new(),
        current_session: None,
        created_at: now_ms as f64,
        updated_at: now_ms as f64,
    })
}

// The caller's transaction commits the Bot and its exact receipt together.
pub(crate) fn create_in_connection(
    conn: &Connection,
    derived_host_id: &str,
    request: &BotCreateRequest,
    now_ms: u64,
) -> Result<Value, RpcError> {
    let folder = owned_folder(conn, derived_host_id, request)?;
    let bot_id = match &request.bot_id {
        Some(id) => id.clone(),
        None => uuid::Uuid::new_v4().to_string(),
    };
    let bot = build_bot(&bot_id, &request.body, now_ms)?;
    // A handle that could never boot is rejected HERE, with the real
    // reason, instead of being accepted and failing forever at first open
    // (adversarial report): "Arya" and "arya" canonicalize to the SAME
    // directory handle on a case-insensitive filesystem, so the second
    // create must not be admitted. Handles with no canonical directory
    // form (unicode, spaces, over-long) keep today's behaviour exactly:
    // they are accepted and their home falls back to `bot-<id8>` at
    // provision time.
    if let Some(handle) = bot.display_identity.handle.as_deref()
        && let Ok(canonical) = crate::bot_self_mgmt::validate_bot_handle(handle)
        && let Some(owner) = crate::bot_self_mgmt::live_handle_owner(conn, &canonical)
            .map_err(|e| storage_error(format!("bot handle ownership probe failed: {e}")))?
        && owner != bot.id
    {
        return Err(invalid_argument(format!(
            "bot handle {canonical:?} is already owned by bot {owner:?}"
        )));
    }
    bots_storage::create_bot(conn, derived_host_id, &folder, &bot)
        .map_err(|e| storage_error(format!("failed to create bot: {e}")))?;
    serde_json::to_value(&bot).map_err(|e| storage_error(format!("created bot unreadable: {e}")))
}

fn owned_folder(
    conn: &Connection,
    derived_host_id: &str,
    request: &BotCreateRequest,
) -> Result<String, RpcError> {
    owned_folder_for(
        conn,
        derived_host_id,
        &request.workspace_id,
        &request.asserted_host_id,
    )
}

fn owned_folder_for(
    conn: &Connection,
    derived_host_id: &str,
    workspace_id: &str,
    asserted_host_id: &str,
) -> Result<String, RpcError> {
    crate::workspace::owned_path(conn, derived_host_id, workspace_id, asserted_host_id).map_err(
        |error| match error.code.as_str() {
            "unsupported_host" => foreign_workspace_host(error.message),
            "not_found" => unknown_workspace(error.message),
            _ => error,
        },
    )
}

/// Resolves the folder actually owning `bot_id` for an existing-Bot
/// mutation (delete today; see this function's own doc for why the same
/// gap applies to run/responsibility create/delete), falling back past
/// the caller-supplied `workspace_id` when it does not name that bot's
/// own home folder.
///
/// `bot.snapshot`'s host-global scope (`workspaceId: ""`, R17-E #348)
/// aggregates Bots across every folder a host owns
/// (`bots_storage::list_bots_with_folders`), but the wire contract it
/// serializes to (`BotsPanelBot`) carries no workspaceId/folder field --
/// so a mutation issued from that view (or from any workspace other than
/// the one this specific bot happens to live in -- Bots keep-alive
/// (App.tsx) can leave the panel mounted well past the workspace that was
/// selected when it loaded) had no `workspace_id` that could ever resolve
/// through the exact caller-supplied match alone, and failed `not_found`
/// even though the bot was never lost. `bot_id` is a single global
/// primary key (`bots.id`), so once `derived_host_id` (server-derived,
/// never client input) is confirmed to own it, no caller-controlled input
/// decides which folder is searched -- the same host boundary
/// `owned_folder_for` enforces, just not gated on a workspace guess.
fn resolve_bot_owning_folder(
    conn: &Connection,
    derived_host_id: &str,
    workspace_id: &str,
    asserted_host_id: &str,
    bot_id: &str,
) -> Result<String, RpcError> {
    if let Ok(folder) = owned_folder_for(conn, derived_host_id, workspace_id, asserted_host_id)
        && bots_storage::current_rev(conn, derived_host_id, &folder, bot_id)
            .map_err(responsibility_storage_error)?
            .is_some()
    {
        return Ok(folder);
    }
    bots_storage::folder_for_bot_id(conn, derived_host_id, bot_id)
        .map_err(responsibility_storage_error)?
        .ok_or_else(|| not_found(format!("bot {bot_id} not found")))
}

/// Like [`resolve_bot_owning_folder`], but also returns the bot's own
/// `workspace_id` -- needed by `bot.responsibility_create`, which (unlike
/// delete) embeds `workspace_id` in the NEW automation it creates: that
/// value is the automation's own execution target, so it must be the
/// bot's real home workspace, never a caller-asserted one that might be
/// empty (host-global scope) or simply wrong (a different workspace
/// selected while the panel stayed mounted). The exact-match fast path
/// reuses the caller's `workspace_id` verbatim (no reverse lookup); only
/// the fallback path resolves it from the bot's own folder path.
///
/// `pub(crate)`: also the owner-resolution primitive for `bot_run_rpc`'s
/// `authorized_prepare`, which has the identical gap this module's own
/// doc originally called out ("bot.run's own workspace resolution ... is
/// not yet migrated to this pattern") -- reused directly rather than
/// re-implemented, so both mutations share one authoritative-owner route.
pub(crate) fn resolve_bot_owning_workspace(
    conn: &Connection,
    derived_host_id: &str,
    workspace_id: &str,
    asserted_host_id: &str,
    bot_id: &str,
) -> Result<(String, String), RpcError> {
    if let Ok(folder) = owned_folder_for(conn, derived_host_id, workspace_id, asserted_host_id)
        && bots_storage::current_rev(conn, derived_host_id, &folder, bot_id)
            .map_err(responsibility_storage_error)?
            .is_some()
    {
        return Ok((folder, workspace_id.to_string()));
    }
    let folder = bots_storage::folder_for_bot_id(conn, derived_host_id, bot_id)
        .map_err(responsibility_storage_error)?
        .ok_or_else(|| not_found(format!("bot {bot_id} not found")))?;
    let resolved_workspace_id: String = conn
        .query_row(
            "SELECT id FROM workspaces WHERE path = ?1 AND host_id = ?2",
            rusqlite::params![folder, derived_host_id],
            |r| r.get(0),
        )
        .map_err(|e| storage_error(format!("workspace lookup failed: {e}")))?;
    Ok((folder, resolved_workspace_id))
}

/// A scheduled responsibility is an automation owned by the Bot: the same
/// owner/policy types `automation.create` uses (`SchedulerOwner`,
/// `WorkspaceMode`, `MissedRunPolicy`), no parallel tables. Bounds mirror
/// `automation.create` exactly (name/prompt/cron), so a responsibility that
/// passes here always describes an automation the scheduler can fire.
pub(crate) fn require_responsibility_name(name: &str) -> Result<String, RpcError> {
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

pub(crate) fn require_responsibility_prompt(prompt: &str) -> Result<String, RpcError> {
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

/// The Bot's harness must be directly launchable: the owned automation the
/// scheduler fires carries no per-run override, so a non-launchable policy
/// value would strand a live cron with no runner behind it.
pub(crate) fn require_launchable_harness(harness: &str) -> Result<String, RpcError> {
    let trimmed = harness.trim();
    if serde_json::from_value::<drogon_harness::HarnessId>(json!(trimmed)).is_err() {
        return Err(invalid_argument(
            "harness must be one of claude|pi|opencode|antigravity|codex",
        ));
    }
    Ok(trimmed.to_string())
}

/// Mirrors `automation.create`'s default; that module owns the constant, so
/// the value is repeated here with its provenance rather than imported
/// across an unowned file.
const RESPONSIBILITY_GRACE_MINUTES: f64 = 15.0;

fn responsibility_storage_error(error: bots_storage::StorageError) -> RpcError {
    match error {
        bots_storage::StorageError::NotFound(what) => not_found(format!("{what} not found")),
        other => storage_error(format!("responsibility mutation failed: {other}")),
    }
}

fn parse_responsibility_params<T: serde::de::DeserializeOwned>(
    params: &Value,
    method: &str,
) -> Result<T, RpcError> {
    serde_json::from_value(params.clone())
        .map_err(|e| invalid_argument(format!("{method} params invalid: {e}")))
}

/// The authorize phase (`run_atomic`'s pre-mutation check) shared by every
/// mutation scoped to an EXISTING bot -- `bot.delete`,
/// `bot.responsibility_delete`, and `bot.responsibility_create` (a
/// responsibility is created FOR an existing bot, so its home workspace is
/// the bot's own, never an arbitrary caller-asserted one -- run,
/// responsibility create, and responsibility delete all share the same
/// missing-Bot-workspace-identity gap, so this is the consistent
/// authoritative-owner routing for all three. `bot.run`'s own workspace
/// resolution is entangled with session-launch targeting in a separate,
/// larger staged-ledger pipeline (`bot_run_rpc`); its `authorized_prepare`
/// work phase now reuses [`resolve_bot_owning_workspace`] directly for the
/// same fallback, while its own `revalidate_run_scope` authorize phase
/// mirrors this function's empty-workspace-id tolerance without weakening
/// the unknown-workspace/foreign-host/replay defenses).
///
/// This function only decides whether the REQUEST is authorized to
/// proceed; it never resolves which folder/workspace the mutation should
/// actually use for an existing bot -- that is `resolve_bot_owning_folder`/
/// `resolve_bot_owning_workspace`'s job in the work phase, run only once
/// (never on a cached replay). Two constraints shape this, not one:
/// - It must forgive the same host-global/mismatched-workspace scope the
///   mutation phase forgives, or that fallback is dead code: an
///   unresolvable `workspace_id` would be rejected here first, before the
///   mutation phase ever runs.
/// - It must NEVER require the bot to still exist. `run_atomic` re-runs
///   `authorize` even on a cached-receipt replay (requests.rs: "Authorization
///   runs before the saved-receipt lookup, on replay too") -- requiring
///   bot existence here would break replaying a delete (of a bot or its
///   responsibility) that (correctly) no longer exists after the first,
///   real delete.
///
/// A non-empty but *unresolvable* `workspace_id` (a typo, a stale id) is
/// still rejected outright, exactly like the pre-existing exact-match
/// behavior: only the deliberate empty-string host-global sentinel (#348)
/// gets the bot-id-based benefit of the doubt.
pub(crate) fn authorize_existing_bot_scope(
    conn: &Connection,
    derived_host_id: &str,
    workspace_id: &str,
    asserted_host_id: &str,
) -> Result<(), RpcError> {
    if workspace_id.is_empty() {
        if asserted_host_id != derived_host_id {
            return Err(foreign_workspace_host(
                "Request belongs to another execution host",
            ));
        }
        return Ok(());
    }
    owned_folder_for(conn, derived_host_id, workspace_id, asserted_host_id).map(|_| ())
}

pub(crate) struct NewResponsibilityAutomation {
    pub(crate) host_id: String,
    pub(crate) workspace_id: String,
    pub(crate) bot_id: String,
    pub(crate) harness: String,
    pub(crate) name: String,
    pub(crate) prompt: String,
    pub(crate) cron: String,
    pub(crate) now_ms: f64,
}

/// Builds the Bot-owned automation for a new scheduled responsibility,
/// mirroring `automation.create`'s construction (local execution target,
/// `Existing` workspace mode, UTC cron) with `bot_id` set -- the only
/// Bot-ownership field, per `automations::records`.
pub(crate) fn build_responsibility_automation(
    new: NewResponsibilityAutomation,
) -> Result<Automation, RpcError> {
    let next_run_at = scheduler::next_fire_ms(&new.cron, new.now_ms)
        .ok_or_else(|| invalid_argument("cron expression has no future occurrence from now"))?
        as f64;
    Ok(Automation {
        id: uuid::Uuid::new_v4().to_string(),
        creation_key: None,
        name: new.name,
        prompt: new.prompt,
        precheck: None,
        agent_id: new.harness,
        // Bot-owned responsibility automations run the bot's own harness
        // mapping at dispatch; they pin no model/provider of their own.
        model: None,
        provider: None,
        run_context: None,
        source_context: None,
        project_id: new.workspace_id.clone(),
        execution_target_type: ExecutionTargetType::Local,
        execution_target_id: new.host_id,
        execution_target_generation: None,
        scheduler_owner: SchedulerOwner::LocalHostService,
        workspace_mode: WorkspaceMode::Existing,
        workspace_id: Some(new.workspace_id),
        base_branch: None,
        setup_decision: None,
        reuse_session: false,
        timezone: "UTC".to_string(),
        rrule: new.cron,
        dtstart: new.now_ms,
        enabled: true,
        next_run_at,
        last_run_at: None,
        missed_run_policy: MissedRunPolicy::RunOnceWithinGrace,
        missed_run_grace_minutes: RESPONSIBILITY_GRACE_MINUTES,
        created_at: new.now_ms,
        updated_at: new.now_ms,
        bot_id: Some(new.bot_id),
    })
}

fn create_responsibility_in_tx(
    tx: &Transaction<'_>,
    host_id: &str,
    params: &BotResponsibilityCreateParams,
    now_ms: f64,
) -> Result<Value, RpcError> {
    // Same host-global/mixed-workspace gap as bot.delete
    // (resolve_bot_owning_workspace's own doc): a responsibility created
    // from the host-global Bots view, or after switching the selected
    // workspace while the panel stayed mounted, must still resolve the
    // bot's OWN home workspace -- never invent a new automation scoped to
    // whatever workspace the caller happened to have selected, which
    // could be empty or simply the wrong one.
    let (folder, workspace_id) = resolve_bot_owning_workspace(
        tx,
        host_id,
        &params.workspace_id,
        &params.host_id,
        &params.bot_id,
    )?;
    let bot = bots_storage::get_bot(tx, host_id, &folder, &params.bot_id)
        .map_err(responsibility_storage_error)?
        .ok_or_else(|| not_found(format!("bot {} not found", params.bot_id)))?;
    let name = require_responsibility_name(&params.name)?;
    let prompt = require_responsibility_prompt(&params.prompt)?;
    let cron = scheduler::validate_cron(&params.schedule).map_err(invalid_argument)?;
    let harness = require_launchable_harness(&bot.harness_policy.default_harness)?;
    let automation = build_responsibility_automation(NewResponsibilityAutomation {
        host_id: host_id.to_string(),
        workspace_id: workspace_id.clone(),
        bot_id: bot.id.clone(),
        harness,
        name: name.clone(),
        prompt: prompt.clone(),
        cron,
        now_ms,
    })?;
    let automation_id = automation.id.clone();
    let responsibility_id = uuid::Uuid::new_v4().to_string();
    let responsibility = Responsibility {
        id: responsibility_id.clone(),
        name,
        instructions: prompt,
        kind: ResponsibilityKind::Scheduled,
        trigger: ResponsibilityTrigger::Scheduled {
            automation_id: automation_id.clone(),
        },
        enabled: true,
        recipe: None,
        created_at: now_ms,
        updated_at: now_ms,
    };
    bots_storage::create_scheduled_responsibility_in_tx(
        tx,
        host_id,
        &folder,
        &bot.id,
        responsibility,
        automation,
    )
    .map_err(responsibility_storage_error)?;
    let result = BotResponsibilityCreateResult {
        host_id: host_id.to_string(),
        workspace_id,
        bot_id: bot.id.clone(),
        responsibility_id,
        automation_id,
    };
    serde_json::to_value(&result)
        .map_err(|e| storage_error(format!("created responsibility unreadable: {e}")))
}

fn delete_bot_in_connection(
    tx: &Transaction<'_>,
    host_id: &str,
    params: &BotDeleteParams,
) -> Result<Value, RpcError> {
    let folder = resolve_bot_owning_folder(
        tx,
        host_id,
        &params.workspace_id,
        &params.host_id,
        &params.bot_id,
    )?;
    let deleted = bots_storage::delete_bot_in_tx(tx, host_id, &folder, &params.bot_id)
        .map_err(responsibility_storage_error)?;
    let Some(deleted) = deleted else {
        return Err(not_found(format!("bot {} not found", params.bot_id)));
    };
    // Handle release (adversarial report): a Bot's name must not die with
    // the Bot. The bot_homes row goes away in the SAME transaction as the
    // bots row, so a successor Bot can claim the same handle and open a
    // session. The home DIRECTORY stays on disk untouched (deleting a Bot
    // must not silently destroy its files); the successor's first open
    // rewrites AGENTS.md/CLAUDE.md from the successor's own record.
    crate::bot_self_mgmt::release_home_in_tx(tx, &params.bot_id)
        .map_err(crate::bot_self_mgmt::self_storage_error)?;
    let result = BotDeleteResult {
        host_id: host_id.to_string(),
        workspace_id: params.workspace_id.clone(),
        bot_id: params.bot_id.clone(),
        removed: true,
        automation_ids: deleted.automation_ids,
    };
    serde_json::to_value(&result).map_err(|e| storage_error(format!("deleted bot unreadable: {e}")))
}

fn delete_responsibility_in_connection(
    tx: &Transaction<'_>,
    host_id: &str,
    params: &BotResponsibilityDeleteParams,
    now_ms: f64,
) -> Result<Value, RpcError> {
    // Same host-global/mixed-workspace gap as bot.delete
    // (resolve_bot_owning_folder's own doc): a responsibility delete issued
    // from the host-global Bots view, or after switching the selected
    // workspace while the panel stayed mounted, must still resolve by the
    // owning Bot's own folder, not fail on the caller's stale scope.
    let folder = resolve_bot_owning_folder(
        tx,
        host_id,
        &params.workspace_id,
        &params.host_id,
        &params.bot_id,
    )?;
    let deleted = bots_storage::delete_responsibility_in_tx(
        tx,
        host_id,
        &folder,
        &params.bot_id,
        &params.responsibility_id,
        now_ms,
    )
    .map_err(responsibility_storage_error)?;
    let result = BotResponsibilityDeleteResult {
        host_id: host_id.to_string(),
        workspace_id: params.workspace_id.clone(),
        bot_id: params.bot_id.clone(),
        responsibility_id: deleted.responsibility_id,
        removed: true,
        automation_id: deleted.automation_id,
    };
    serde_json::to_value(&result)
        .map_err(|e| storage_error(format!("deleted responsibility unreadable: {e}")))
}

impl crate::Engine {
    pub(crate) fn bot_create(&self, request: &drogon_protocol::Request) -> Result<Value, RpcError> {
        let parsed = parse_bot_create_request(&request.params)?;
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |tx| {
                if self.quiescent.load(std::sync::atomic::Ordering::Acquire) {
                    return Err(crate::error::runtime_busy(
                        "service admission is frozen for shutdown",
                    ));
                }
                authorize_create_scope(tx, &self.host_id, &parsed)
            },
            |tx| create_in_connection(tx, &self.host_id, &parsed, crate::now_unix_ms()),
        )
    }

    pub(crate) fn bot_responsibility_create(
        &self,
        request: &drogon_protocol::Request,
    ) -> Result<Value, RpcError> {
        let params: BotResponsibilityCreateParams =
            parse_responsibility_params(&request.params, "bot.responsibility_create")?;
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |tx| {
                if self.quiescent.load(std::sync::atomic::Ordering::Acquire) {
                    return Err(crate::error::runtime_busy(
                        "service admission is frozen for shutdown",
                    ));
                }
                authorize_existing_bot_scope(
                    tx,
                    &self.host_id,
                    &params.workspace_id,
                    &params.host_id,
                )
            },
            |tx| {
                create_responsibility_in_tx(tx, &self.host_id, &params, crate::now_unix_ms() as f64)
            },
        )
    }

    pub(crate) fn bot_delete(&self, request: &drogon_protocol::Request) -> Result<Value, RpcError> {
        let params: BotDeleteParams = parse_responsibility_params(&request.params, "bot.delete")?;
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |tx| {
                if self.quiescent.load(std::sync::atomic::Ordering::Acquire) {
                    return Err(crate::error::runtime_busy(
                        "service admission is frozen for shutdown",
                    ));
                }
                authorize_existing_bot_scope(
                    tx,
                    &self.host_id,
                    &params.workspace_id,
                    &params.host_id,
                )
            },
            |tx| delete_bot_in_connection(tx, &self.host_id, &params),
        )
    }

    pub(crate) fn bot_responsibility_delete(
        &self,
        request: &drogon_protocol::Request,
    ) -> Result<Value, RpcError> {
        let params: BotResponsibilityDeleteParams =
            parse_responsibility_params(&request.params, "bot.responsibility_delete")?;
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |tx| {
                if self.quiescent.load(std::sync::atomic::Ordering::Acquire) {
                    return Err(crate::error::runtime_busy(
                        "service admission is frozen for shutdown",
                    ));
                }
                authorize_existing_bot_scope(
                    tx,
                    &self.host_id,
                    &params.workspace_id,
                    &params.host_id,
                )
            },
            |tx| {
                delete_responsibility_in_connection(
                    tx,
                    &self.host_id,
                    &params,
                    crate::now_unix_ms() as f64,
                )
            },
        )
    }
}
