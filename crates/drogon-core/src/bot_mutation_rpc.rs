//! The `bot.create` bridge: strict desktop-request admission over the
//! ROOT-approved scope (strict parser/storage, no spawn, empty born state),
//! mirroring `bot_run_rpc.rs`'s delegation architecture: pure shapes and
//! decisions here, idempotency delegated to the wiring layer, no local
//! store, no DDL.
//!
//! ## Request contract (strict; unknown fields denied)
//!
//! `{workspaceId*, hostId*, botId?, body*, locale?}` where `body` must be
//! the FULL `bots::input::parse_bot_create` shape (invalid -> the frozen
//! `invalid_argument` code; no partials, no defaults) and `botId` is
//! used as-given when present, minted as a fresh uuid when absent. A
//! params `requestId` is an unknown field: the native envelope carries it,
//! and [`handle_bot_create`] takes it explicitly as `request_id`. `hostId`
//! is a client ASSERTION tripwire only -- the server derives the current
//! host internally (the caller-supplied `derived_host_id`, taken from
//! `Engine`'s own host identity at ROOT wiring); the minimal workspace
//! lookup here (id -> host_id/path, the `workspace::owned_path` fact --
//! note for ROOT: reuse `workspace::owned_path` once this module is
//! registered in-crate) refuses `unknown_workspace` and
//! `foreign_workspace_host` before anything is written.
//!
//! ## Born-empty enforcement
//!
//! The created Bot is always born empty: `responsibilities: []` and
//! `currentSession: null`, enforced structurally in this module regardless
//! of the parser (which itself admits only an empty array / explicit null),
//! and verified in the response DTO. Nothing here spawns: the module has
//! no dispatch seam parameter at all.
//!
//! ## Idempotency is DELEGATED, never stored here
//!
//! ROOT directive (A6c, carried into A6b/B6): no DDL and no parallel
//! ledger. Replay/conflict belongs to the admitted
//! [`crate::requests::RequestLedger`] at ROOT wiring time; this module
//! defines only the narrow [`CreateLedger`] seam, fingerprints the
//! normalized request ([`normalized_create_fingerprint`], envelope id
//! excluded), and builds the response DTO as a pure function. The frozen
//! wire codes used here are exactly: `invalid_argument`,
//! `unknown_workspace`, `foreign_workspace_host`, `storage_error`,
//! `request_conflict` (delegated), plus the pre-existing crate code
//! `unauthorized` for the worker-denied auth path.
//!
//! ## run_atomic-compatible body (for ROOT wiring)
//!
//! The DB work inside the admitted closure never reacquires, locks, or
//! begins anything of its own: it is a guard-SELECT plus a single INSERT
//! through `bots::storage::create_bot` on the `&Connection` this function
//! receives, so it composes with `RequestLedger::run_atomic`'s
//! caller-owned transaction (authorize + work inside one transaction,
//! exactly the shape ROOT's `impl Engine` wrapper will drive). This
//! function never holds a MutexGuard and never begins a transaction.
//!
//! ## Registration status and the ROOT adapter (report-only, not applied)
//!
//! Not yet registered in `lib.rs` (ROOT owns registration). Intended
//! wiring mirrors `bot_run_rpc`: `impl Engine { fn dispatch_bot_create }`
//! adapts `RequestLedger` to [`CreateLedger`], maps the private auth
//! layer's worker binding to [`BotCreateCaller::Worker`], and passes
//! `Engine`'s own host id as `derived_host_id`. See the A6b/A6c delivery
//! reports for the full registration-cleanup list (crate:: path swap,
//! workspace::owned_path / error-constructor / now_rfc3339 reuse).

use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;

use drogon_core::bots::input::parse_bot_create;
use drogon_core::bots::records::{Bot, DisplayIdentity, HarnessModelPolicy};
use drogon_core::bots::storage as bots_storage;
use drogon_protocol::RpcError;

/// The idempotency boundary ROOT's wiring adapts the admitted
/// `RequestLedger` into. Implementations decide replay vs. conflict vs.
/// first admission: identical (id, fingerprint) replays return the stored
/// DTO verbatim; a changed fingerprint under the same id is the frozen
/// `request_conflict` rejection; a first admission runs `work` exactly once
/// and persists its DTO. This module never implements persistence itself.
pub trait CreateLedger {
    fn admit<F>(&self, request_id: &str, fingerprint: &str, work: F) -> Result<Value, RpcError>
    where
        F: FnOnce() -> Result<Value, RpcError>;
}

/// Who is calling. ROOT's wiring maps the private auth layer's
/// `WorkerBinding` onto [`BotCreateCaller::Worker`]; `bot.create` is
/// desktop-only in v1, so a worker caller is denied on this auth path.
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
/// not a field: it keys the delegated ledger and never enters the
/// fingerprint. Serialization of this struct is the fingerprint input; the
/// `body` is the parse-normalized object, so wire key order cannot move it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BotCreateRequest {
    workspace_id: String,
    /// Client assertion only; verified against the derived host, never
    /// trusted for authority.
    asserted_host_id: String,
    /// Used as-given when present; minted as a fresh uuid when absent.
    bot_id: Option<String>,
    body: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    locale: Option<String>,
}

fn invalid_argument(message: impl Into<String>) -> RpcError {
    RpcError::new("invalid_argument", message.into())
}

fn internal_error(message: impl Into<String>) -> RpcError {
    // Frozen-code note: storage failures surface as `storage_error` (see
    // storage_error()); this constructor stays for wiring-layer plumbing
    // failures only.
    RpcError::new("internal_error", message.into())
}

fn unauthorized() -> RpcError {
    RpcError::new(
        "unauthorized",
        "bot.create is desktop-only: worker dispatch credentials are denied on this auth path",
    )
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

/// Strict outer parse: unknown top-level fields are denied (including a
/// params `requestId` -- the envelope carries it), `workspaceId`/`hostId`/
/// `body` are required, and `body` must be the FULL `parse_bot_create`
/// shape (no partials, no defaults; any parse failure is
/// `invalid_argument`).
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

/// Stable fingerprint over the normalized request (never over raw wire
/// bytes, never including the envelope id). This is what the delegated
/// ledger keys replays and conflicts on, alongside the envelope id.
pub fn normalized_create_fingerprint(request: &BotCreateRequest) -> String {
    use sha2::{Digest, Sha256};
    let canonical = serde_json::to_vec(request).unwrap_or_default();
    format!("{:x}", Sha256::digest(canonical))
}

/// Builds the born-empty Bot from the parse-normalized body. Born-empty is
/// enforced structurally here: `responsibilities` is always empty and
/// `currentSession` always null, whatever the parser admitted.
fn build_bot(bot_id: &str, body: &Value, now_unix: u64) -> Result<Bot, RpcError> {
    let character_preset = body
        .get("characterPreset")
        .and_then(Value::as_str)
        .ok_or_else(|| internal_error("normalized body missing characterPreset"))?
        .to_string();
    let display_identity: DisplayIdentity = serde_json::from_value(
        body.get("displayIdentity")
            .cloned()
            .ok_or_else(|| internal_error("normalized body missing displayIdentity"))?,
    )
    .map_err(|e| internal_error(format!("normalized displayIdentity unreadable: {e}")))?;
    let harness_policy: HarnessModelPolicy = serde_json::from_value(
        body.get("harnessPolicy")
            .cloned()
            .ok_or_else(|| internal_error("normalized body missing harnessPolicy"))?,
    )
    .map_err(|e| internal_error(format!("normalized harnessPolicy unreadable: {e}")))?;
    let instructions = body
        .get("instructions")
        .and_then(Value::as_str)
        .ok_or_else(|| internal_error("normalized body missing instructions"))?
        .to_string();
    let memories: Vec<String> = serde_json::from_value(
        body.get("memories")
            .cloned()
            .ok_or_else(|| internal_error("normalized body missing memories"))?,
    )
    .map_err(|e| internal_error(format!("normalized memories unreadable: {e}")))?;
    Ok(Bot {
        id: bot_id.to_string(),
        character_preset,
        display_identity,
        harness_policy,
        instructions,
        memories,
        // Born-empty, structurally: a new Bot has no responsibilities and
        // no session, whatever the parser admitted.
        responsibilities: Vec::new(),
        current_session: None,
        created_at: now_unix as f64,
        updated_at: now_unix as f64,
    })
}

/// Pure DTO construction: the created Bot serialized exactly as the
/// snapshot `bots[]` projection (the record's camelCase serde rendering).
fn bot_dto(bot: &Bot) -> Result<Value, RpcError> {
    serde_json::to_value(bot).map_err(|e| storage_error(format!("created bot unreadable: {e}")))
}

/// Full `bot.create` admission. `derived_host_id` is the server's own host
/// identity (ROOT's wiring reads it from `Engine`); `request_id` is the
/// native envelope identity and the delegated idempotency key; `ledger` is
/// the delegated idempotency boundary ([`CreateLedger`], adapted from the
/// admitted `RequestLedger` at ROOT wiring); `now_unix` is the server
/// clock, injected for deterministic DTOs.
pub fn handle_bot_create<L: CreateLedger>(
    conn: &Connection,
    derived_host_id: &str,
    request_id: &str,
    params: &Value,
    caller: &BotCreateCaller,
    ledger: &L,
    now_unix: u64,
) -> Result<Value, RpcError> {
    // Authorization precedes everything, including parsing and the ledger:
    // a denied caller consumes no admission.
    if matches!(caller, BotCreateCaller::Worker { .. }) {
        return Err(unauthorized());
    }

    // Strict parse precedes the ledger too: a malformed request is a pure
    // rejection and must not consume an admission.
    let request = parse_bot_create_request(params)?;
    let print = normalized_create_fingerprint(&request);

    // Idempotency is delegated from here on: identical replay -> stored DTO
    // verbatim, changed params -> frozen request_conflict, first admission
    // -> the work below runs exactly once.
    ledger.admit(request_id, &print, || {
        // Workspace ownership + the client's host assertion. The workspace
        // row (id -> host/path) is the workspace-ownership fact (ROOT note:
        // swap this minimal lookup for the promised `workspace::owned_path`
        // at registration). The folder for the scoped store is the
        // workspace path.
        let workspace = {
            let mut statement = conn
                .prepare("SELECT host_id, path FROM workspaces WHERE id = ?1")
                .map_err(|e| storage_error(format!("workspace lookup failed: {e}")))?;
            let mut rows = statement
                .query([&request.workspace_id])
                .map_err(|e| storage_error(format!("workspace lookup failed: {e}")))?;
            match rows.next() {
                Ok(Some(row)) => {
                    let host_id: String = row
                        .get(0)
                        .map_err(|e| storage_error(format!("workspace lookup failed: {e}")))?;
                    let path: String = row
                        .get(1)
                        .map_err(|e| storage_error(format!("workspace lookup failed: {e}")))?;
                    Some((host_id, path))
                }
                Ok(None) => None,
                Err(e) => Err(storage_error(format!("workspace lookup failed: {e}")))?,
            }
        };
        let (workspace_host_id, folder) = match workspace {
            Some(pair) => pair,
            None => {
                return Err(unknown_workspace(format!(
                    "workspace {} not found",
                    request.workspace_id
                )));
            }
        };
        if workspace_host_id != derived_host_id {
            return Err(foreign_workspace_host(format!(
                "foreign workspace host: workspace {} belongs to host {}, \
                 not current host {}",
                request.workspace_id, workspace_host_id, derived_host_id
            )));
        }
        if request.asserted_host_id != derived_host_id {
            return Err(foreign_workspace_host(format!(
                "foreign workspace host: asserted host {} does not match derived host {}",
                request.asserted_host_id, derived_host_id
            )));
        }

        // botId: used as-given when present, minted when absent. Minting
        // happens exactly here -- inside the admitted closure -- so a
        // replay returns the stored DTO (and its stable id) instead of
        // minting a second Bot.
        let bot_id = match &request.bot_id {
            Some(id) => id.clone(),
            None => uuid::Uuid::new_v4().to_string(),
        };
        let bot = build_bot(&bot_id, &request.body, now_unix)?;

        // DB-only body: a guard-SELECT plus one INSERT through the admitted
        // storage primitive, on the connection this function received. It
        // never begins a transaction of its own and never reacquires any
        // lock, so it composes with `RequestLedger::run_atomic`'s
        // caller-owned transaction at ROOT wiring.
        bots_storage::create_bot(conn, derived_host_id, &folder, &bot)
            .map_err(|e| storage_error(format!("failed to create bot: {e}")))?;

        bot_dto(&bot)
    })
}
