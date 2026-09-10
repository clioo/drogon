//! Bot-owned file monitors: stage (parked), approve, and list.
//!
//! The delegation chain ([`crate::bots::delegation`]) only fires for
//! monitors bound to a reactive responsibility, and the producer tick only
//! evaluates *approved* monitors — so creating a monitor and arming it are
//! deliberately two calls: `bot.monitor_create` stages the watch parked at
//! needs-approval (the Bot itself calls this from its session), and
//! `bot.monitor_approve` arms the exact rule hash (the user, after reading
//! the diff in the list view). Any rule change re-parks; approval never
//! carries across an edit.
//!
//! Three methods, all bot-scoped through the Bot's owning workspace:
//! `bot.monitor_create`, `bot.monitor_approve`, `bot.monitor_list`.
//! Wired into `Engine::dispatch_inner` next to the other `bot.*` arms.

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::bots::monitors::record::{
    MonitorTrigger, approve_rule, bind_responsibility, new_unapproved_monitor,
};
use crate::bots::monitors::rule::{LocalFileRule, MAX_FILE_BYTES, MonitorRule, validate_rule};
use crate::bots::monitors::storage as mstorage;
use crate::bots::records::ResponsibilityTrigger;
use crate::bots::storage as bstorage;
use drogon_protocol::RpcError;

fn invalid_argument(message: impl Into<String>) -> RpcError {
    RpcError::new("invalid_argument", message.into())
}

fn not_found(message: impl Into<String>) -> RpcError {
    RpcError::new("not_found", message.into())
}

fn storage_error(message: impl Into<String>) -> RpcError {
    RpcError::new("storage_error", message.into())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MonitorScope {
    workspace_id: String,
    host_id: String,
    bot_id: String,
}

fn parse_scope(params: &Value, method: &str) -> Result<MonitorScope, RpcError> {
    let object = params
        .as_object()
        .ok_or_else(|| invalid_argument(format!("{method} params must be an object")))?;
    for key in object.keys() {
        let admitted = [
            "workspaceId",
            "hostId",
            "botId",
            "monitorId",
            "resource",
            "maxBytes",
            "responsibilityId",
            // Mint-a-responsibility mode: stage the reactive
            // responsibility and the parked monitor in one call.
            "responsibilityName",
            "instructions",
        ];
        if !admitted.contains(&key.as_str()) {
            return Err(invalid_argument(format!("{method}: unknown field {key}")));
        }
    }
    let required = |key: &str| -> Result<String, RpcError> {
        let text = object
            .get(key)
            .and_then(Value::as_str)
            .ok_or_else(|| invalid_argument(format!("{method}: missing required field {key}")))?;
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Err(invalid_argument(format!(
                "{method}: field {key} must be non-empty"
            )));
        }
        Ok(trimmed.to_string())
    };
    Ok(MonitorScope {
        workspace_id: required("workspaceId")?,
        host_id: required("hostId")?,
        bot_id: required("botId")?,
    })
}

/// Resolve the Bot's owning `(folder, workspace_id)` — the same
/// authoritative-owner routing `bot.run` uses — proving the Bot exists in
/// the caller's asserted scope. Never trusts the caller's workspace
/// selection when it disagrees with where the Bot actually lives.
fn resolve_bot_scope(
    conn: &Connection,
    derived_host_id: &str,
    scope: &MonitorScope,
) -> Result<(String, String), RpcError> {
    crate::bot_mutation_rpc::resolve_bot_owning_workspace(
        conn,
        derived_host_id,
        &scope.workspace_id,
        &scope.host_id,
        &scope.bot_id,
    )
}

/// The watched tree: the registered project whose path is the Bot's folder.
/// A monitor watches a project tree, never an arbitrary host path.
fn project_for_folder(
    conn: &Connection,
    derived_host_id: &str,
    folder: &str,
) -> Result<String, RpcError> {
    conn.query_row(
        "SELECT id FROM projects WHERE path = ?1 AND host_id = ?2",
        params![folder, derived_host_id],
        |r| r.get::<_, String>(0),
    )
    .optional()
    .map_err(|e| storage_error(format!("project lookup failed: {e}")))?
    .ok_or_else(|| {
        invalid_argument(
            "this bot's folder is not a registered project yet: run `project add` first",
        )
    })
}

fn monitor_error(e: mstorage::StorageError) -> RpcError {
    match e {
        mstorage::StorageError::IdCollision => {
            invalid_argument("a monitor with this id already exists")
        }
        mstorage::StorageError::NotFound(what) => not_found(format!("{what} not found")),
        mstorage::StorageError::StaleUpdate => {
            storage_error("monitor changed since it was read; re-list and retry")
        }
        other => storage_error(format!("monitor store failed: {other}")),
    }
}

fn bot_error(e: bstorage::StorageError) -> RpcError {
    match e {
        bstorage::StorageError::NotFound(what) => not_found(format!("{what} not found")),
        other => storage_error(format!("bot store failed: {other}")),
    }
}

/// `bot.monitor_create` work phase: stage a parked file monitor. The
/// binding resolves three ways:
/// - `responsibilityId`: bind an existing reactive responsibility (refused
///   when missing or scheduled — delegation only drives reactive ones).
/// - `responsibilityName` (+ optional `instructions`): mint a fresh
///   enabled reactive responsibility on the bot and bind it, so one call
///   stages both the watch and its handler.
/// - neither: an unbound `NotificationOnly` monitor (drains without
///   dispatch; useful as a pure change log).
///
/// Always parked — approval is the separate `bot.monitor_approve` call.
pub(crate) fn create_monitor_in_tx(
    tx: &Transaction,
    derived_host_id: &str,
    params: &Value,
    now_ms: f64,
) -> Result<Value, RpcError> {
    let scope = parse_scope(params, "bot.monitor_create")?;
    let (folder, _) = resolve_bot_scope(tx, derived_host_id, &scope)?;
    let object = params.as_object().expect("parse_scope checked object");
    let resource = object
        .get("resource")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| invalid_argument("bot.monitor_create: missing required field resource"))?
        .to_string();
    let max_bytes = match object.get("maxBytes") {
        None | Some(Value::Null) => 64 * 1024,
        Some(Value::Number(n)) => n.as_u64().ok_or_else(|| {
            invalid_argument("bot.monitor_create: maxBytes must be a positive integer")
        })?,
        Some(_) => {
            return Err(invalid_argument(
                "bot.monitor_create: maxBytes must be a positive integer",
            ));
        }
    };
    if max_bytes == 0 || max_bytes > MAX_FILE_BYTES {
        return Err(invalid_argument(format!(
            "bot.monitor_create: maxBytes must be 1..={MAX_FILE_BYTES}"
        )));
    }
    let monitor_id = object
        .get("monitorId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let responsibility_id = object
        .get("responsibilityId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let responsibility_name = object
        .get("responsibilityName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let instructions = object
        .get("instructions")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if responsibility_id.is_some() && responsibility_name.is_some() {
        return Err(invalid_argument(
            "bot.monitor_create: responsibilityId and responsibilityName are mutually exclusive",
        ));
    }
    if responsibility_id.is_none()
        && responsibility_name.is_none()
        && !instructions.trim().is_empty()
    {
        return Err(invalid_argument(
            "bot.monitor_create: instructions needs a responsibilityName to attach to",
        ));
    }
    if instructions.contains('\0') || instructions.len() > 32768 {
        return Err(invalid_argument(
            "bot.monitor_create: instructions must be NUL-free and at most 32768 bytes",
        ));
    }

    // Resolve the binding: existing reactive, or freshly minted reactive.
    // Either way the id below is a reactive responsibility by construction.
    let bound_responsibility_id: Option<String> = if let Some(responsibility_id) =
        &responsibility_id
    {
        let bot = bstorage::get_bot(tx, derived_host_id, &folder, &scope.bot_id)
            .map_err(bot_error)?
            .ok_or_else(|| not_found(format!("bot {} not found", scope.bot_id)))?;
        let responsibility = bot
            .responsibilities
            .iter()
            .find(|r| r.id == *responsibility_id)
            .ok_or_else(|| {
                not_found(format!(
                    "responsibility {responsibility_id} not found on this bot"
                ))
            })?;
        if !matches!(
            responsibility.trigger,
            ResponsibilityTrigger::Reactive { .. }
        ) {
            return Err(invalid_argument(
                "responsibilityId must name a reactive responsibility; \
                     scheduled responsibilities run from their automation, never from a monitor",
            ));
        }
        Some(responsibility_id.clone())
    } else if let Some(name) = &responsibility_name {
        let trimmed = name.trim();
        if trimmed.len() > 128 || trimmed.chars().any(char::is_control) {
            return Err(invalid_argument(
                "bot.monitor_create: responsibilityName must be 1..=128 bytes with no control characters",
            ));
        }
        let minted_id = format!("resp-{}", uuid::Uuid::new_v4());
        let minted = crate::bots::records::Responsibility {
            id: minted_id.clone(),
            name: trimmed.to_string(),
            instructions: instructions.clone(),
            kind: crate::bots::records::ResponsibilityKind::Reactive,
            trigger: ResponsibilityTrigger::Reactive { event: None },
            enabled: true,
            recipe: None,
            created_at: now_ms,
            updated_at: now_ms,
        };
        bstorage::update_bot(tx, derived_host_id, &folder, &scope.bot_id, now_ms, |bot| {
            bot.responsibilities.push(minted.clone());
        })
        .map_err(bot_error)?;
        Some(minted_id)
    } else {
        None
    };
    let project_id = project_for_folder(tx, derived_host_id, &folder)?;
    let rule = MonitorRule::LocalFileDigest(LocalFileRule {
        host_id: derived_host_id.to_string(),
        project_id,
        resource,
        max_bytes,
    });
    validate_rule(&rule).map_err(invalid_argument)?;
    let mut record = new_unapproved_monitor(
        monitor_id.clone(),
        Some(scope.bot_id.clone()),
        rule,
        MonitorTrigger::Manual,
        now_ms,
    )
    .map_err(invalid_argument)?;
    if let Some(bound) = bound_responsibility_id {
        record = bind_responsibility(record, bound, now_ms).map_err(invalid_argument)?;
    }
    mstorage::create_monitor(tx, &record).map_err(monitor_error)?;
    Ok(json!({
        "monitorId": record.id,
        "botId": scope.bot_id,
        "approved": false,
        "responsibilityId": match &record.inference_policy {
            crate::bots::monitors::policy::MonitorInferencePolicy::ExplicitResponsibility { responsibility_id } =>
                Value::String(responsibility_id.clone()),
            _ => Value::Null,
        },
    }))
}

/// `bot.monitor_approve` work phase: arm the monitor's CURRENT rule text.
/// Re-approving after an edit is the same call — approval always names the
/// exact bytes being armed (returned as `approvalHash`).
pub(crate) fn approve_monitor_in_tx(
    tx: &Transaction,
    derived_host_id: &str,
    params: &Value,
    now_ms: f64,
) -> Result<Value, RpcError> {
    let scope = parse_scope(params, "bot.monitor_approve")?;
    let (folder, _) = resolve_bot_scope(tx, derived_host_id, &scope)?;
    let monitor_id = params
        .as_object()
        .and_then(|o| o.get("monitorId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| invalid_argument("bot.monitor_approve: missing required field monitorId"))?;
    let (record, rev) = mstorage::get_monitor(tx, monitor_id)
        .map_err(monitor_error)?
        .ok_or_else(|| not_found(format!("monitor {monitor_id} not found")))?;
    if record.bot_id.as_deref() != Some(scope.bot_id.as_str()) {
        return Err(not_found(format!("monitor {monitor_id} not found")));
    }
    // The approval pins this rule text: refuse to arm a monitor whose rule
    // no longer watches this bot's own tree.
    let project_id = project_for_folder(tx, derived_host_id, &folder)?;
    let rule = record.rule.local_file();
    if rule.host_id != derived_host_id || rule.project_id != project_id {
        return Err(invalid_argument(
            "monitor no longer watches this bot's project; re-create it instead of approving",
        ));
    }
    let approved = approve_rule(record, now_ms);
    let approval_hash = approved.approved_rule_hash.clone();
    mstorage::cas_write(tx, &approved, rev).map_err(monitor_error)?;
    Ok(json!({
        "monitorId": monitor_id,
        "botId": scope.bot_id,
        "approved": true,
        "approvalHash": approval_hash,
    }))
}

/// `bot.monitor_list`: every monitor owned by the bot with its health and
/// today's delegation budget (`delegationsToday: {used, max}`) — the
/// honest state behind the cap.
fn monitor_list_in_conn(
    conn: &Connection,
    scope: &MonitorScope,
    now_ms: f64,
) -> Result<Value, RpcError> {
    let monitors = mstorage::list_monitors_for_bot(conn, &scope.bot_id).map_err(monitor_error)?;
    let used =
        crate::bots::delegation::delegations_used_today(conn, &scope.bot_id, now_ms).unwrap_or(0);
    let items: Vec<Value> = monitors
        .iter()
        .map(|record| {
            let rule = record.rule.local_file();
            json!({
                "monitorId": record.id,
                "version": record.version,
                "resource": rule.resource,
                "projectId": rule.project_id,
                "enabled": record.enabled,
                "approved": record.is_approved(),
                "responsibilityId": match &record.inference_policy {
                    crate::bots::monitors::policy::MonitorInferencePolicy::ExplicitResponsibility { responsibility_id } =>
                        Value::String(responsibility_id.clone()),
                    _ => Value::Null,
                },
                "cursor": record.cursor,
                "lastEventId": record.last_event_id,
                "consecutiveErrors": record.consecutive_errors,
                "lastError": record.last_error,
                "delegationsToday": {
                    "used": used,
                    "max": crate::bots::delegation::MAX_DELEGATIONS_PER_BOT_PER_DAY,
                },
            })
        })
        .collect();
    Ok(json!({ "monitors": items }))
}

/// Authorize phase shared by the two mutating calls: the Bot must exist
/// in the caller's asserted scope (which also proves workspace ownership
/// through the authoritative-owner routing).
fn authorize_bot_scope(
    tx: &Transaction,
    derived_host_id: &str,
    scope: &MonitorScope,
) -> Result<(), RpcError> {
    crate::bot_mutation_rpc::resolve_bot_owning_workspace(
        tx,
        derived_host_id,
        &scope.workspace_id,
        &scope.host_id,
        &scope.bot_id,
    )
    .map(|_| ())
}

impl crate::Engine {
    pub(crate) fn bot_monitor_create(
        &self,
        request: &drogon_protocol::Request,
    ) -> Result<Value, RpcError> {
        let params = request.params.clone();
        let host_id = self.host_id.clone();
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |tx| {
                if self.is_quiescent() {
                    return Err(crate::error::runtime_busy(
                        "service admission is frozen for shutdown",
                    ));
                }
                let scope = parse_scope(&params, "bot.monitor_create")?;
                authorize_bot_scope(tx, &host_id, &scope)
            },
            |tx| create_monitor_in_tx(tx, &host_id, &params, crate::now_unix_ms() as f64),
        )
    }

    pub(crate) fn bot_monitor_approve(
        &self,
        request: &drogon_protocol::Request,
    ) -> Result<Value, RpcError> {
        let params = request.params.clone();
        let host_id = self.host_id.clone();
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |tx| {
                if self.is_quiescent() {
                    return Err(crate::error::runtime_busy(
                        "service admission is frozen for shutdown",
                    ));
                }
                let scope = parse_scope(&params, "bot.monitor_approve")?;
                authorize_bot_scope(tx, &host_id, &scope)
            },
            |tx| approve_monitor_in_tx(tx, &host_id, &params, crate::now_unix_ms() as f64),
        )
    }

    pub(crate) fn bot_monitor_list(&self, params: &Value) -> Result<Value, RpcError> {
        let scope = parse_scope(params, "bot.monitor_list")?;
        let conn = self.db.lock().unwrap();
        // Scope-proof first: the Bot must live in the asserted workspace.
        resolve_bot_scope(&conn, &self.host_id, &scope)?;
        monitor_list_in_conn(&conn, &scope, crate::now_unix_ms() as f64)
    }
}
