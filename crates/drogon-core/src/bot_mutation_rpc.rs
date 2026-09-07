//! The `bot.create` bridge, staged per the A6d principle (ROOT directive
//! msg_ad4f2ca5cf2d): pure strict parse + scope authorization on the passed
//! canonical connection + a DB-only body, so ROOT's wrapper owns the
//! canonical `RequestLedger::run_atomic` (method+params fingerprint, its
//! own mutex and transaction) without adapters or external locks.
//!
//! Request contract (strict; unknown fields denied): `{workspaceId*,
//! hostId*, botId?, body*, locale?}`. `body` must be the FULL
//! `parse_bot_create` shape -- no partials, no defaults; a params
//! `requestId` is an unknown field because the native envelope carries it.
//! `hostId` is a client assertion only: the derived host (ROOT's
//! `Engine.host_id`) is the authority.
//!
//! Frozen wire codes only: `invalid_argument`, `unknown_workspace`,
//! `foreign_workspace_host`, `storage_error`, plus the pre-existing crate
//! code `unauthorized` for the worker-denied auth path. Replay/conflict
//! is the canonical ledger's; minting (`botId` absent -> fresh uuid) is
//! fresh-only here so a replay returns the stored DTO without minting.
//!
//! Born-empty is structural: a created Bot always has `responsibilities: []`
//! and `currentSession: null`, verified in the DTO. The module has no
//! dispatch seam, so it cannot spawn.
//!
//! run_atomic compatibility: [`create_in_connection`] is a guard-SELECT
//! plus one INSERT through `bots::storage::create_bot` on the connection it
//! receives; it never reacquires a lock, never begins or commits its own
//! transaction, and composes inside `run_atomic`/`run_staged`'s
//! caller-owned transaction. ROOT note: swap the minimal workspace lookup
//! in [`authorize_create_scope`] for the promised `workspace::owned_path`
//! at registration.

use rusqlite::Connection;
use serde_json::Value;

use drogon_core::bots::input::parse_bot_create;
use drogon_core::bots::records::{Bot, DisplayIdentity, HarnessModelPolicy};
use drogon_core::bots::storage as bots_storage;
use drogon_protocol::RpcError;

/// Who is calling. ROOT's wiring maps the private auth layer's
/// `WorkerBinding` onto [`BotCreateCaller::Worker`]; `bot.create` is
/// desktop-only in v1.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BotCreateCaller {
    Desktop,
    Worker {
        host_id: String,
        run_id: String,
        dispatch_id: String,
    },
}

/// The strict, normalized request. The envelope `request_id` is deliberately
/// absent: it keys the canonical ledger and never enters the params
/// fingerprint.
#[derive(Debug, Clone, PartialEq)]
pub struct BotCreateRequest {
    pub workspace_id: String,
    /// Client assertion only; verified against the derived host.
    pub asserted_host_id: String,
    /// Used as-given when present; minted fresh per admission when absent.
    pub bot_id: Option<String>,
    /// The parse-normalized `parse_bot_create` body.
    pub body: Value,
    pub locale: Option<String>,
}

fn invalid_argument(message: impl Into<String>) -> RpcError {
    RpcError::new("invalid_argument", message.into())
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

/// Worker callers are denied on this auth path; ROOT's wrapper calls this
/// before any ledger admission.
pub fn ensure_desktop_caller(caller: &BotCreateCaller) -> Result<(), RpcError> {
    if matches!(caller, BotCreateCaller::Worker { .. }) {
        return Err(RpcError::new(
            "unauthorized",
            "bot.create is desktop-only: worker dispatch credentials are denied on this auth path",
        ));
    }
    Ok(())
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

/// Strict parse: unknown top-level fields are denied (including a params
/// `requestId` -- the envelope carries it), `workspaceId`/`hostId`/`body`
/// are required, and `body` must be the FULL `parse_bot_create` shape.
pub fn parse_bot_create_request(params: &Value) -> Result<BotCreateRequest, RpcError> {
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
    Ok(BotCreateRequest {
        workspace_id: required_string(params, "workspaceId")?,
        asserted_host_id: required_string(params, "hostId")?,
        bot_id: optional_string(params, "botId")?,
        body: normalized_body,
        locale: optional_string(params, "locale")?,
    })
}

/// Scope authorization on the passed canonical connection: the derived host
/// must own the workspace, and the client's asserted host must equal the
/// derived host. Tx-safe and side-effect-free, so ROOT's wrapper can run it
/// before the ledger admission on EVERY request -- replays included, so a
/// scope change is never bypassed by a cached receipt.
pub fn authorize_create_scope(
    conn: &Connection,
    derived_host_id: &str,
    request: &BotCreateRequest,
) -> Result<(), RpcError> {
    let mut statement = conn
        .prepare("SELECT host_id FROM workspaces WHERE id = ?1")
        .map_err(|e| storage_error(format!("workspace lookup failed: {e}")))?;
    let workspace_host_id: String = statement
        .query_row([&request.workspace_id], |r| r.get(0))
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                unknown_workspace(format!("workspace {} not found", request.workspace_id))
            }
            other => storage_error(format!("workspace lookup failed: {other}")),
        })?;
    if workspace_host_id != derived_host_id {
        return Err(foreign_workspace_host(format!(
            "foreign workspace host: workspace {} belongs to host {}, not current host {}",
            request.workspace_id, workspace_host_id, derived_host_id
        )));
    }
    if request.asserted_host_id != derived_host_id {
        return Err(foreign_workspace_host(format!(
            "foreign workspace host: asserted host {} does not match derived host {}",
            request.asserted_host_id, derived_host_id
        )));
    }
    Ok(())
}

/// Builds the born-empty Bot from the parse-normalized body.
fn build_bot(bot_id: &str, body: &Value, now_unix: u64) -> Result<Bot, RpcError> {
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
        // Born-empty, structurally: a new Bot has no responsibilities and
        // no session, whatever the parser admitted.
        responsibilities: Vec::new(),
        current_session: None,
        created_at: now_unix as f64,
        updated_at: now_unix as f64,
    })
}

/// DB body: mints `botId` when absent (fresh-only -- a replay never re-runs
/// this, so the stored DTO keeps its stable id), creates the born-empty Bot
/// in the caller's scope, and returns the DTO exactly as the snapshot
/// `bots[]` projection. Never begins a transaction, never reacquires a
/// lock, never spawns. Re-resolves the workspace path as the scope folder
/// (defense in depth: [`authorize_create_scope`] must have run first).
pub fn create_in_connection(
    conn: &Connection,
    derived_host_id: &str,
    request_id: &str,
    request: &BotCreateRequest,
    now_unix: u64,
) -> Result<Value, RpcError> {
    let _admission_marker = request_id; // wrapper tracing symmetry
    let folder: String = conn
        .query_row(
            "SELECT path FROM workspaces WHERE id = ?1",
            [&request.workspace_id],
            |r| r.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                unknown_workspace(format!("workspace {} not found", request.workspace_id))
            }
            other => storage_error(format!("workspace lookup failed: {other}")),
        })?;
    let bot_id = match &request.bot_id {
        Some(id) => id.clone(),
        None => uuid::Uuid::new_v4().to_string(),
    };
    let bot = build_bot(&bot_id, &request.body, now_unix)?;
    // Guard-SELECT plus one INSERT inside the caller's transaction.
    bots_storage::create_bot(conn, derived_host_id, &folder, &bot)
        .map_err(|e| storage_error(format!("failed to create bot: {e}")))?;
    serde_json::to_value(&bot).map_err(|e| storage_error(format!("created bot unreadable: {e}")))
}
