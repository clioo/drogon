//! P0 — per-Bot secret grants and the user-only secret surface
//! (PR #420, "P0 — secrets store + grants").
//!
//! A Bot monitor names secret REFERENCES (`GITHUB_TOKEN_REF`); the values
//! live only in the sealed store (`crate::integrations::store`). This module
//! owns the bridge: the `bot_secret_grants` table — one row per
//! `(bot_id, secret_ref)`, minted by a USER, revocable, re-checked on every
//! tick by `integrations::resolve` — and the user-only RPC surface:
//!
//! - `bot.grant_secret` / `bot.revoke_secret` / `bot.list_secret_grants`:
//!   grant bookkeeping. The params carry NO `actorBotId` — there is no Bot
//!   actor to assert, and the Bot-facing `bot.self_*` surface never gains
//!   grant verbs, so a Bot has no self-grant path. `grantedBy` is
//!   attribution (default `owner` on this single-user daemon), not
//!   authentication.
//! - `secrets.set` / `secrets.delete` / `secrets.list`: the user's value
//!   lifecycle for one `(kind, name)`. Values arrive over the local IPC,
//!   are sealed straight into the 0600 store, and are never echoed back,
//!   never logged, and never persisted outside the sealed file (the request
//!   ledger keeps a SHA-256 params fingerprint, not the params).
//!
//! Every grant/revoke writes its `bot_audit` row in the SAME ledger
//! transaction as the mutation, with a USER actor
//! ([`crate::bot_self_mgmt::AuditActor::User`]) — the actor is named.
//! Deliberately NOT here: any value resolution (that is
//! `integrations::resolve`, called by the tick, never by an RPC) and any
//! change to `bot_self_mgmt.rs` beyond the audit-actor extension.
//! MIT Copyright (c) 2026 Lovecast Inc.

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::{Value, json};

use drogon_protocol::{Request, RpcError};

use crate::bot_mutation_rpc::resolve_bot_owning_workspace;
use crate::bot_self_mgmt::{AuditActor, record_audit_in_tx};
use crate::bots::monitors::record::validate_secret_ref;
use crate::bots::storage as bots_storage;
use crate::integrations::store::{self, SecretStore};

/// Service capability advertised in `status`; the CLI preflights it before
/// any grant/secret call.
pub const BOT_SECRETS_CAPABILITY: &str = "bot.secrets.v1";

pub const SECRETS_SCHEMA_COMPONENT: &str = "bot_secrets";
pub const SECRETS_SCHEMA_VERSION: i64 = 1;

/// The actor attribution used when the caller does not name one. This is a
/// single-user local daemon; the name is recorded for audit readability,
/// never for authentication.
pub const DEFAULT_GRANTED_BY: &str = "owner";

/// Longest admitted `grantedBy` attribution.
pub const MAX_GRANTED_BY_CHARS: usize = 128;

type SecretResult<T> = Result<T, SecretStorageError>;

/// Storage-layer failure for the grants table.
#[derive(Debug)]
pub enum SecretStorageError {
    Sqlite(rusqlite::Error),
    Serde(serde_json::Error),
    /// A caller-supplied reference or kind failed validation.
    Invalid(String),
}

impl std::fmt::Display for SecretStorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sqlite(e) => write!(f, "sqlite: {e}"),
            Self::Serde(e) => write!(f, "serde: {e}"),
            Self::Invalid(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for SecretStorageError {}

impl From<rusqlite::Error> for SecretStorageError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Sqlite(e)
    }
}

impl From<serde_json::Error> for SecretStorageError {
    fn from(e: serde_json::Error) -> Self {
        Self::Serde(e)
    }
}

fn secrets_storage_error(e: SecretStorageError) -> RpcError {
    drogon_protocol::RpcError::new(
        "storage_error",
        format!("bot secret grants storage failed: {e}"),
    )
}

// ---------------------------------------------------------------------------
// Schema (own component; registered in db.rs alongside the others)
// ---------------------------------------------------------------------------

pub(crate) fn create_tables(tx: &Transaction) -> SecretResult<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS bot_secret_grants (
            bot_id TEXT NOT NULL,
            secret_ref TEXT NOT NULL,
            kind TEXT NOT NULL,
            granted_by TEXT NOT NULL,
            at REAL NOT NULL,
            PRIMARY KEY (bot_id, secret_ref)
        );",
    )?;
    Ok(())
}

fn check_schema_not_ahead(conn: &Connection) -> SecretResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_versions (
            component TEXT PRIMARY KEY,
            version INTEGER NOT NULL
        );",
    )?;
    let existing: Option<i64> = conn
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![SECRETS_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(found) = existing
        && found > SECRETS_SCHEMA_VERSION
    {
        return Err(SecretStorageError::Sqlite(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_SCHEMA),
            Some(format!(
                "bot_secrets schema version {found} is newer than supported {SECRETS_SCHEMA_VERSION}"
            )),
        )));
    }
    Ok(())
}

/// Rolls the grants table forward inside the aggregate startup transaction.
pub(crate) fn apply_pending_steps_in_tx(tx: &Transaction) -> SecretResult<()> {
    check_schema_not_ahead(tx)?;
    let existing: Option<i64> = tx
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![SECRETS_SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    if existing.is_none() {
        create_tables(tx)?;
        tx.execute(
            "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)",
            params![SECRETS_SCHEMA_COMPONENT, SECRETS_SCHEMA_VERSION],
        )?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Grant rows + ledger-transaction helpers
// ---------------------------------------------------------------------------

/// One durable `(bot, secret-ref)` mint.
#[derive(Debug, Clone, PartialEq)]
pub struct SecretGrant {
    pub bot_id: String,
    pub secret_ref: String,
    /// Integration kind the ref belongs to (`github`, `granola`, …).
    pub kind: String,
    /// Named user attribution (see [`DEFAULT_GRANTED_BY`]).
    pub granted_by: String,
    pub at: f64,
}

/// Mint (or refresh) the grant for `(bot_id, secret_ref)`. Called only from
/// the user-only grant RPC's ledger transaction — there is no Bot-reachable
/// caller.
pub fn grant_in_tx(
    tx: &Transaction,
    bot_id: &str,
    secret_ref: &str,
    kind: &str,
    granted_by: &str,
    at: f64,
) -> SecretResult<()> {
    validate_secret_ref(secret_ref).map_err(SecretStorageError::Invalid)?;
    store::validate_kind(kind).map_err(SecretStorageError::Invalid)?;
    tx.execute(
        "INSERT INTO bot_secret_grants (bot_id, secret_ref, kind, granted_by, at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(bot_id, secret_ref) DO UPDATE SET
            kind = excluded.kind,
            granted_by = excluded.granted_by,
            at = excluded.at",
        params![bot_id, secret_ref, kind, granted_by, at],
    )?;
    Ok(())
}

/// Remove the grant for `(bot_id, secret_ref)`. Returns `false` when none
/// existed (the revoke RPC turns that into an honest `not_found`).
pub fn revoke_in_tx(tx: &Transaction, bot_id: &str, secret_ref: &str) -> SecretResult<bool> {
    let affected = tx.execute(
        "DELETE FROM bot_secret_grants WHERE bot_id = ?1 AND secret_ref = ?2",
        params![bot_id, secret_ref],
    )?;
    Ok(affected > 0)
}

/// The grant for `(bot_id, secret_ref)`, if any — the per-tick re-check
/// read (`integrations::resolve` calls this inside the tick's own tx).
pub fn has_grant_in_tx(
    tx: &Transaction,
    bot_id: &str,
    secret_ref: &str,
) -> SecretResult<Option<SecretGrant>> {
    let row = tx
        .query_row(
            "SELECT kind, granted_by, at FROM bot_secret_grants
             WHERE bot_id = ?1 AND secret_ref = ?2",
            params![bot_id, secret_ref],
            |r| {
                Ok(SecretGrant {
                    bot_id: bot_id.to_string(),
                    secret_ref: secret_ref.to_string(),
                    kind: r.get(0)?,
                    granted_by: r.get(1)?,
                    at: r.get(2)?,
                })
            },
        )
        .optional()?;
    Ok(row)
}

/// Every grant minted for `bot_id`, sorted by ref — names only, no values.
pub fn grants_for_bot(conn: &Connection, bot_id: &str) -> SecretResult<Vec<SecretGrant>> {
    let mut stmt = conn.prepare(
        "SELECT bot_id, secret_ref, kind, granted_by, at FROM bot_secret_grants
         WHERE bot_id = ?1 ORDER BY secret_ref",
    )?;
    let rows = stmt
        .query_map(params![bot_id], |r| {
            Ok(SecretGrant {
                bot_id: r.get(0)?,
                secret_ref: r.get(1)?,
                kind: r.get(2)?,
                granted_by: r.get(3)?,
                at: r.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

// ---------------------------------------------------------------------------
// User-only RPC surface
// ---------------------------------------------------------------------------

fn invalid_argument(message: impl Into<String>) -> RpcError {
    crate::error::invalid_argument(message)
}

fn not_found(message: impl Into<String>) -> RpcError {
    crate::error::not_found(message)
}

/// Strict params: unknown fields are denied, so a caller can never smuggle
/// an `actorBotId` (or any other Bot assertion) into this surface.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GrantSecretParams {
    workspace_id: String,
    host_id: String,
    bot_id: String,
    secret_ref: String,
    kind: String,
    granted_by: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RevokeSecretParams {
    workspace_id: String,
    host_id: String,
    bot_id: String,
    secret_ref: String,
    granted_by: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListGrantsParams {
    workspace_id: String,
    host_id: String,
    bot_id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetSecretParams {
    kind: String,
    name: String,
    value: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeleteSecretParams {
    kind: String,
    name: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListSecretsParams {
    kind: String,
}

/// Resolves the Bot for a user-origin call: the bot must exist under the
/// derived host. No `actorBotId` is accepted anywhere on this surface.
fn resolve_user_target_bot(
    tx: &Transaction,
    host_id: &str,
    workspace_id: &str,
    bot_id: &str,
) -> Result<(String, String), RpcError> {
    let (folder, workspace) =
        resolve_bot_owning_workspace(tx, host_id, workspace_id, host_id, bot_id)?;
    bots_storage::get_bot(tx, host_id, &folder, bot_id)
        .map_err(crate::bot_self_mgmt::bots_storage_error)?
        .ok_or_else(|| not_found(format!("bot {bot_id} not found")))?;
    Ok((folder, workspace))
}

/// Refuses a caller asserting another execution host (same fence as the
/// `bot.self_*` scope check); consumes the `hostId` param explicitly.
fn check_host(params_host_id: &str, engine_host_id: &str) -> Result<(), RpcError> {
    if params_host_id != engine_host_id {
        return Err(RpcError::new(
            "foreign_bot",
            "request belongs to another execution host",
        ));
    }
    Ok(())
}

fn clean_granted_by(granted_by: &Option<String>) -> Result<String, RpcError> {
    let name = granted_by
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or(DEFAULT_GRANTED_BY);
    if name.len() > MAX_GRANTED_BY_CHARS {
        return Err(invalid_argument(format!(
            "grantedBy must be at most {MAX_GRANTED_BY_CHARS} bytes"
        )));
    }
    if name.bytes().any(|b| b == 0 || b.is_ascii_control()) {
        return Err(invalid_argument(
            "grantedBy must not contain control characters",
        ));
    }
    Ok(name.to_string())
}

impl crate::Engine {
    /// `bot.grant_secret` — USER-only. Mints one `(bot, ref)` grant and
    /// writes the audit row (user actor named) in the same ledger tx.
    pub(crate) fn bot_grant_secret(&self, request: &Request) -> Result<Value, RpcError> {
        let params: GrantSecretParams = parse_strict(&request.params, "bot.grant_secret")?;
        check_host(&params.host_id, &self.host_id)?;
        let granted_by = clean_granted_by(&params.granted_by)?;
        let kind = params.kind.trim().to_string();
        store::validate_kind(&kind)
            .map_err(|e| invalid_argument(format!("invalid integration kind: {e}")))?;
        let secret_ref = params.secret_ref.trim().to_string();
        validate_secret_ref(&secret_ref)
            .map_err(|e| invalid_argument(format!("invalid secretRef: {e}")))?;
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |tx| {
                // Authorization: the target Bot must exist. No Bot-actor
                // assertion exists on this surface by design.
                resolve_user_target_bot(tx, &self.host_id, &params.workspace_id, &params.bot_id)
                    .map(|_| ())
            },
            |tx| {
                let at = crate::now_unix_ms() as f64;
                grant_in_tx(tx, &params.bot_id, &secret_ref, &kind, &granted_by, at)
                    .map_err(secrets_storage_error)?;
                record_audit_in_tx(
                    tx,
                    &request.request_id,
                    "bot.grant_secret",
                    AuditActor::User(granted_by.clone()),
                    &params.bot_id,
                    at,
                    &json!({"secretRef": secret_ref, "kind": kind}),
                )
                .map_err(crate::bot_self_mgmt::self_storage_error)?;
                Ok(json!({
                    "botId": params.bot_id,
                    "secretRef": secret_ref,
                    "kind": kind,
                    "grantedBy": granted_by,
                    "at": at,
                    "granted": true,
                }))
            },
        )
    }

    /// `bot.revoke_secret` — USER-only. Deletes the grant and writes the
    /// audit row (user actor named) in the same ledger tx. Revocation takes
    /// effect on the NEXT tick: resolution re-reads this table per tick.
    pub(crate) fn bot_revoke_secret(&self, request: &Request) -> Result<Value, RpcError> {
        let params: RevokeSecretParams = parse_strict(&request.params, "bot.revoke_secret")?;
        check_host(&params.host_id, &self.host_id)?;
        let revoked_by = clean_granted_by(&params.granted_by)?;
        let secret_ref = params.secret_ref.trim().to_string();
        validate_secret_ref(&secret_ref)
            .map_err(|e| invalid_argument(format!("invalid secretRef: {e}")))?;
        let _gate = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |tx| {
                resolve_user_target_bot(tx, &self.host_id, &params.workspace_id, &params.bot_id)
                    .map(|_| ())
            },
            |tx| {
                let existed = revoke_in_tx(tx, &params.bot_id, &secret_ref)
                    .map_err(secrets_storage_error)?;
                if !existed {
                    return Err(not_found(format!(
                        "bot {} has no grant for secret ref {}",
                        params.bot_id, secret_ref
                    )));
                }
                let at = crate::now_unix_ms() as f64;
                record_audit_in_tx(
                    tx,
                    &request.request_id,
                    "bot.revoke_secret",
                    AuditActor::User(revoked_by.clone()),
                    &params.bot_id,
                    at,
                    &json!({"secretRef": secret_ref}),
                )
                .map_err(crate::bot_self_mgmt::self_storage_error)?;
                Ok(json!({
                    "botId": params.bot_id,
                    "secretRef": secret_ref,
                    "revokedBy": revoked_by,
                    "revoked": true,
                }))
            },
        )
    }

    /// `bot.list_secret_grants` — USER-only, read-only: names and mint
    /// metadata, never values.
    pub(crate) fn bot_list_secret_grants(&self, params: &Value) -> Result<Value, RpcError> {
        let params: ListGrantsParams = parse_strict(params, "bot.list_secret_grants")?;
        check_host(&params.host_id, &self.host_id)?;
        let conn = self.db.lock().unwrap();
        let tx = conn.unchecked_transaction().map_err(crate::error::from_sqlite)?;
        resolve_user_target_bot(&tx, &self.host_id, &params.workspace_id, &params.bot_id)?;
        let grants = grants_for_bot(&tx, &params.bot_id).map_err(secrets_storage_error)?;
        let grants: Vec<Value> = grants
            .into_iter()
            .map(|grant| {
                json!({
                    "botId": grant.bot_id,
                    "secretRef": grant.secret_ref,
                    "kind": grant.kind,
                    "grantedBy": grant.granted_by,
                    "at": grant.at,
                })
            })
            .collect();
        Ok(json!({ "botId": params.bot_id, "grants": grants }))
    }

    /// `secrets.set` — USER-only value lifecycle: seal `value` into the
    /// store for `(kind, name)`. The value is never echoed, logged, or
    /// persisted outside the sealed file (the ledger stores a fingerprint,
    /// not params). Granting the ref to a Bot is a separate, audited call.
    pub(crate) fn do_secrets_set(&self, params: &Value) -> Result<Value, RpcError> {
        let params: SetSecretParams = parse_strict(params, "secrets.set")?;
        let kind = params.kind.trim().to_string();
        let name = params.name.trim().to_string();
        if params.value.is_empty() {
            return Err(invalid_argument("value must not be empty"));
        }
        if params.value.len() > MAX_SECRET_VALUE_BYTES {
            return Err(invalid_argument(format!(
                "value must be at most {MAX_SECRET_VALUE_BYTES} bytes"
            )));
        }
        let store = SecretStore::new(&self.data_dir, &kind)
            .map_err(|e| invalid_argument(format!("invalid integration kind: {e}")))?;
        store
            .save_secret(&name, &params.value)
            .map_err(|e| crate::error::io_error(format!("cannot seal secret: {e}")))?;
        Ok(json!({ "kind": kind, "name": name, "saved": true }))
    }

    /// `secrets.delete` — USER-only: drop the sealed value for `(kind, name)`.
    /// Existing grants stay but resolve to `NotConfigured` until re-set.
    pub(crate) fn do_secrets_delete(&self, params: &Value) -> Result<Value, RpcError> {
        let params: DeleteSecretParams = parse_strict(params, "secrets.delete")?;
        let kind = params.kind.trim().to_string();
        let name = params.name.trim().to_string();
        let store = SecretStore::new(&self.data_dir, &kind)
            .map_err(|e| invalid_argument(format!("invalid integration kind: {e}")))?;
        if !store.has_secret(&name) {
            return Err(not_found(format!(
                "no stored secret for {kind}/{name}"
            )));
        }
        store.delete_secret(&name);
        Ok(json!({ "kind": kind, "name": name, "deleted": true }))
    }

    /// `secrets.list` — USER-only, read-only: configured NAMES for a kind,
    /// never values.
    pub(crate) fn secrets_list(&self, params: &Value) -> Result<Value, RpcError> {
        let params: ListSecretsParams = parse_strict(params, "secrets.list")?;
        let kind = params.kind.trim().to_string();
        let store = SecretStore::new(&self.data_dir, &kind)
            .map_err(|e| invalid_argument(format!("invalid integration kind: {e}")))?;
        Ok(json!({ "kind": kind, "names": store.secret_names() }))
    }
}

/// Longest admitted secret value (API tokens are small; this is generous).
pub const MAX_SECRET_VALUE_BYTES: usize = 8 * 1024;

fn parse_strict<T: serde::de::DeserializeOwned>(
    params: &Value,
    method: &str,
) -> Result<T, RpcError> {
    serde_json::from_value(params.clone())
        .map_err(|e| invalid_argument(format!("{method} params invalid: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tx() -> rusqlite::Transaction<'static> {
        let conn: &'static mut rusqlite::Connection =
            Box::leak(Box::new(rusqlite::Connection::open_in_memory().unwrap()));
        let tx = conn.unchecked_transaction().unwrap();
        create_tables(&tx).unwrap();
        tx
    }

    #[test]
    fn grant_round_trips_and_upsert_refreshes() {
        let tx = tx();
        grant_in_tx(&tx, "bot-1", "TOKEN_REF", "github", "owner", 1.0).unwrap();
        let grant = has_grant_in_tx(&tx, "bot-1", "TOKEN_REF").unwrap().unwrap();
        assert_eq!(grant.kind, "github");
        assert_eq!(grant.granted_by, "owner");
        assert_eq!(grant.at, 1.0);

        // Re-grant refreshes in place (never a duplicate row).
        grant_in_tx(&tx, "bot-1", "TOKEN_REF", "github", "carlos", 2.0).unwrap();
        let grant = has_grant_in_tx(&tx, "bot-1", "TOKEN_REF").unwrap().unwrap();
        assert_eq!(grant.granted_by, "carlos");
        assert_eq!(grant.at, 2.0);

        let grants = grants_for_bot(&tx, "bot-1").unwrap();
        assert_eq!(grants.len(), 1);
        assert!(!has_grant_in_tx(&tx, "bot-2", "TOKEN_REF").unwrap().is_some());
    }

    #[test]
    fn revoke_removes_exactly_one_grant_and_reports_absence() {
        let tx = tx();
        grant_in_tx(&tx, "bot-1", "A_REF", "github", "owner", 1.0).unwrap();
        grant_in_tx(&tx, "bot-1", "B_REF", "granola", "owner", 1.0).unwrap();
        assert!(revoke_in_tx(&tx, "bot-1", "A_REF").unwrap());
        assert!(has_grant_in_tx(&tx, "bot-1", "A_REF").unwrap().is_none());
        assert!(has_grant_in_tx(&tx, "bot-1", "B_REF").unwrap().is_some());
        assert!(!revoke_in_tx(&tx, "bot-1", "A_REF").unwrap());
    }

    #[test]
    fn grant_rejects_bad_refs_and_kinds() {
        let tx = tx();
        assert!(grant_in_tx(&tx, "bot-1", "KEY=value", "github", "owner", 1.0).is_err());
        assert!(grant_in_tx(&tx, "bot-1", "../escape", "github", "owner", 1.0).is_err());
        assert!(grant_in_tx(&tx, "bot-1", "OK_REF", "../escape", "owner", 1.0).is_err());
        assert!(has_grant_in_tx(&tx, "bot-1", "OK_REF").unwrap().is_none());
    }

    #[test]
    fn granted_by_is_cleaned_and_bounded() {
        assert_eq!(clean_granted_by(&None).unwrap(), "owner");
        assert_eq!(clean_granted_by(&Some("  carlos ".into())).unwrap(), "carlos");
        assert_eq!(clean_granted_by(&Some("   ".into())).unwrap(), "owner");
        assert!(clean_granted_by(&Some("x".repeat(129))).is_err());
        assert!(clean_granted_by(&Some("bad\nname".into())).is_err());
    }

    #[test]
    fn schema_component_is_versioned_and_downgrade_guarded() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let tx = conn.unchecked_transaction().unwrap();
        apply_pending_steps_in_tx(&tx).unwrap();
        let version: i64 = tx
            .query_row(
                "SELECT version FROM schema_versions WHERE component = 'bot_secrets'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(version, SECRETS_SCHEMA_VERSION);
        // A newer build's schema must fail this build loudly, not silently.
        tx.execute(
            "UPDATE schema_versions SET version = ?1 WHERE component = 'bot_secrets'",
            params![SECRETS_SCHEMA_VERSION + 1],
        )
        .unwrap();
        assert!(apply_pending_steps_in_tx(&tx).is_err());
    }
}
