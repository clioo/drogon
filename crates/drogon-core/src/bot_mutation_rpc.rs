//! Born-empty Bot creation under canonical atomic receipts and execution-host ownership.

use rusqlite::Connection;
use serde_json::Value;

use crate::bots::input::parse_bot_create;
use crate::bots::records::{Bot, DisplayIdentity, HarnessModelPolicy};
use crate::bots::storage as bots_storage;
use drogon_protocol::RpcError;

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
    bots_storage::create_bot(conn, derived_host_id, &folder, &bot)
        .map_err(|e| storage_error(format!("failed to create bot: {e}")))?;
    serde_json::to_value(&bot).map_err(|e| storage_error(format!("created bot unreadable: {e}")))
}

fn owned_folder(
    conn: &Connection,
    derived_host_id: &str,
    request: &BotCreateRequest,
) -> Result<String, RpcError> {
    crate::workspace::owned_path(
        conn,
        derived_host_id,
        &request.workspace_id,
        &request.asserted_host_id,
    )
    .map_err(|error| match error.code.as_str() {
        "unsupported_host" => foreign_workspace_host(error.message),
        "not_found" => unknown_workspace(error.message),
        _ => error,
    })
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
}
