//! P0 per-Bot secret grants E2E: every test runs a real `Engine` over a
//! fixture temp data dir — real SQLite storage, real ledger transactions,
//! real sealed store files. Fixture secrets only; no network, no models.
//!
//! Covered here: user-only grant/revoke/list RPCs, the named-user audit
//! trail, revocation taking effect on the NEXT tick's grant re-read, the
//! ungranted-`Unauthorized` refusal, and the value lifecycle never touching
//! the request ledger in plaintext.

use drogon_core::Engine;
use drogon_core::bot_secrets::BOT_SECRETS_CAPABILITY;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

const CANARY: &str = "canary-GRANTS-DROGON-P0-4b91f";

fn request(id: &str, method: &str, params: Value) -> Request {
    Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    }
}

fn success(response: Response) -> Value {
    assert!(response.ok, "{response:?}");
    response.result.unwrap()
}

fn failure(response: Response) -> (String, String) {
    assert!(!response.ok, "{response:?}");
    let error = response.error.unwrap();
    (error.code, error.message)
}

fn bot_body(name: &str, handle: Option<&str>) -> Value {
    json!({
        "characterPreset": "none",
        "displayIdentity": {"displayName": name, "handle": handle, "title": null},
        "harnessPolicy": {"defaultHarness": "codex", "explicitModel": null},
        "instructions": "Guard the realm.",
        "memories": []
    })
}

struct Fx {
    _root: tempfile::TempDir,
    engine: Engine,
    workspace_id: String,
    host_id: String,
    data_dir: std::path::PathBuf,
}

impl Fx {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("folder");
        std::fs::create_dir(&folder).unwrap();
        let data_dir = root.path().join("data");
        let engine = Engine::open(&data_dir).unwrap();
        let workspace = success(engine.dispatch(request(
            "register",
            "workspace.register",
            json!({"path": folder}),
        )));
        let workspace_id = workspace["id"].as_str().unwrap().to_string();
        let host_id = workspace["hostId"].as_str().unwrap().to_string();
        Self {
            _root: root,
            engine,
            workspace_id,
            host_id,
            data_dir,
        }
    }

    fn create_bot(&self, req: &str, name: &str, handle: Option<&str>) -> Value {
        success(self.engine.dispatch(request(
            req,
            "bot.create",
            json!({
                "workspaceId": self.workspace_id,
                "hostId": self.host_id,
                "body": bot_body(name, handle),
            }),
        )))
    }

    fn provision(&self, req: &str, bot_id: &str) -> Value {
        success(self.engine.dispatch(request(
            req,
            "bot.self_provision",
            json!({
                "botId": bot_id, "actorBotId": bot_id,
                "workspaceId": self.workspace_id, "hostId": self.host_id,
            }),
        )))
    }

    fn grant(&self, req: &str, bot_id: &str, secret_ref: &str, kind: &str) -> Response {
        self.engine.dispatch(request(
            req,
            "bot.grant_secret",
            json!({
                "botId": bot_id, "secretRef": secret_ref, "kind": kind,
                "workspaceId": self.workspace_id, "hostId": self.host_id,
            }),
        ))
    }

    fn revoke(&self, req: &str, bot_id: &str, secret_ref: &str) -> Response {
        self.engine.dispatch(request(
            req,
            "bot.revoke_secret",
            json!({
                "botId": bot_id, "secretRef": secret_ref,
                "workspaceId": self.workspace_id, "hostId": self.host_id,
            }),
        ))
    }

    /// A raw connection + tx over the SAME sqlite file the engine wrote —
    /// how a tick Phase B would see the grants table.
    fn db_tx(&self) -> rusqlite::Transaction<'static> {
        let path = self.data_dir.join(drogon_core::DB_FILE_NAME);
        let conn: &'static mut rusqlite::Connection =
            Box::leak(Box::new(rusqlite::Connection::open(path).unwrap()));
        conn.unchecked_transaction().unwrap()
    }

    fn audit_rows(&self, bot_id: &str) -> Vec<(String, String, String)> {
        let conn =
            rusqlite::Connection::open(self.data_dir.join(drogon_core::DB_FILE_NAME)).unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT request_id, method, actor_bot_id FROM bot_audit
                 WHERE target_bot_id = ?1 ORDER BY rowid",
            )
            .unwrap();
        stmt.query_map([bot_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
    }
}

#[test]
fn capability_is_advertised() {
    let fx = Fx::new();
    let status = success(fx.engine.dispatch(request("s", "status", json!({}))));
    let capabilities = status["capabilities"].as_array().unwrap();
    assert!(
        capabilities.iter().any(|c| c == BOT_SECRETS_CAPABILITY),
        "status must advertise {BOT_SECRETS_CAPABILITY}"
    );
}

#[test]
fn grant_and_revoke_are_audited_with_the_user_named() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bot_id = bot["id"].as_str().unwrap().to_string();
    fx.provision("p1", &bot_id);

    let granted = success(fx.grant("g1", &bot_id, "GITHUB_TOKEN_REF", "github"));
    assert_eq!(granted["granted"], true);
    assert_eq!(granted["secretRef"], "GITHUB_TOKEN_REF");
    assert_eq!(granted["kind"], "github");
    assert_eq!(granted["grantedBy"], "owner");

    let revoked = success(fx.revoke("r1", &bot_id, "GITHUB_TOKEN_REF"));
    assert_eq!(revoked["revoked"], true);

    let rows = fx.audit_rows(&bot_id);
    let grant_rows: Vec<&(String, String, String)> = rows
        .iter()
        .filter(|(_, method, _)| method == "bot.grant_secret")
        .collect();
    let revoke_rows: Vec<&(String, String, String)> = rows
        .iter()
        .filter(|(_, method, _)| method == "bot.revoke_secret")
        .collect();
    assert_eq!(grant_rows.len(), 1, "{rows:?}");
    assert_eq!(revoke_rows.len(), 1, "{rows:?}");
    // The actor is the named USER, not a bot id.
    assert_eq!(grant_rows[0].2, "user:owner");
    assert_eq!(revoke_rows[0].2, "user:owner");

    // A named grantor attribution is recorded verbatim.
    let granted = success(fx.engine.dispatch(request(
        "g2",
        "bot.grant_secret",
        json!({
            "botId": bot_id, "secretRef": "GRANOLA_TOKEN_REF", "kind": "granola",
            "grantedBy": "carlos",
            "workspaceId": fx.workspace_id, "hostId": fx.host_id,
        }),
    )));
    assert_eq!(granted["grantedBy"], "carlos");
    let rows = fx.audit_rows(&bot_id);
    let granola: Vec<&(String, String, String)> = rows
        .iter()
        .filter(|(_, method, _)| method == "bot.grant_secret")
        .filter(|(request_id, _, _)| request_id == "g2")
        .collect();
    assert_eq!(granola.len(), 1);
    assert_eq!(granola[0].2, "user:carlos");
}

#[test]
fn list_grants_surfaces_names_and_metadata_never_values() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bot_id = bot["id"].as_str().unwrap().to_string();
    fx.provision("p1", &bot_id);
    fx.grant("g1", &bot_id, "B_REF", "github");
    fx.grant("g2", &bot_id, "A_REF", "granola");
    // The store itself holds the values; grants are name-only bookkeeping.
    let store = drogon_core::integrations::store::SecretStore::new(&fx.data_dir, "github").unwrap();
    store.save_secret("B_REF", CANARY).unwrap();

    let listed = success(fx.engine.dispatch(request(
        "l1",
        "bot.list_secret_grants",
        json!({
            "botId": bot_id,
            "workspaceId": fx.workspace_id, "hostId": fx.host_id,
        }),
    )));
    let grants = listed["grants"].as_array().unwrap();
    assert_eq!(grants.len(), 2);
    assert_eq!(grants[0]["secretRef"], "A_REF");
    assert_eq!(grants[0]["kind"], "granola");
    assert_eq!(grants[1]["secretRef"], "B_REF");
    assert_eq!(grants[1]["kind"], "github");
    assert_eq!(grants[1]["grantedBy"], "owner");
    let listed_text = listed.to_string();
    assert!(
        !listed_text.contains(CANARY),
        "grant listing must never carry values"
    );
}

#[test]
fn grant_surface_is_user_only_no_bot_actor_unknown_fields_denied() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bot_id = bot["id"].as_str().unwrap().to_string();

    // No `actorBotId` exists on this surface: a Bot-actor assertion is an
    // UNKNOWN field and denied outright, so no Bot can even name itself
    // here — and `bot.self_*` never gained grant verbs.
    let (code, _) = failure(fx.engine.dispatch(request(
        "bad1",
        "bot.grant_secret",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "secretRef": "TOKEN_REF", "kind": "github",
            "workspaceId": fx.workspace_id, "hostId": fx.host_id,
        }),
    )));
    assert_eq!(code, "invalid_argument");

    // A foreign execution host is refused.
    let (code, _) = failure(fx.engine.dispatch(request(
        "bad2",
        "bot.grant_secret",
        json!({
            "botId": bot_id, "secretRef": "TOKEN_REF", "kind": "github",
            "workspaceId": fx.workspace_id, "hostId": "host-elsewhere",
        }),
    )));
    assert_eq!(code, "foreign_bot");

    // Unknown bot is an honest not_found.
    let (code, _) = failure(fx.grant("bad3", "bot-does-not-exist", "TOKEN_REF", "github"));
    assert_eq!(code, "not_found");

    // Bad refs and kinds are invalid_argument, never partially applied.
    let (code, _) = failure(fx.grant("bad4", &bot_id, "KEY=value", "github"));
    assert_eq!(code, "invalid_argument");
    let (code, _) = failure(fx.grant("bad5", &bot_id, "OK_REF", "../escape"));
    assert_eq!(code, "invalid_argument");
    let (code, _) = failure(fx.revoke("bad6", &bot_id, "NEVER_GRANTED"));
    assert_eq!(code, "not_found");
}

#[test]
fn ungranted_ref_is_unauthorized_at_the_tick_seam() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bot_id = bot["id"].as_str().unwrap().to_string();
    fx.provision("p1", &bot_id);

    // The value exists in the store — the ONLY missing piece is the grant.
    let store = drogon_core::integrations::store::SecretStore::new(&fx.data_dir, "github").unwrap();
    store.save_secret("GITHUB_TOKEN_REF", CANARY).unwrap();

    let tx = fx.db_tx();
    let error = drogon_core::integrations::resolve::resolve_for_bot_in_tx(
        &tx,
        &store,
        &bot_id,
        &["GITHUB_TOKEN_REF".to_string()],
    )
    .unwrap_err();
    assert_eq!(
        error.monitor_error_kind(),
        drogon_core::bots::monitors::result::MonitorErrorKind::Unauthorized
    );
}

#[test]
fn revocation_takes_effect_on_the_next_tick() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bot_id = bot["id"].as_str().unwrap().to_string();
    fx.provision("p1", &bot_id);
    let store = drogon_core::integrations::store::SecretStore::new(&fx.data_dir, "github").unwrap();
    store.save_secret("GITHUB_TOKEN_REF", CANARY).unwrap();

    // Tick 1: the grant exists, the seam resolves the value into memory.
    success(fx.grant("g1", &bot_id, "GITHUB_TOKEN_REF", "github"));
    {
        let tx = fx.db_tx();
        let resolved = drogon_core::integrations::resolve::resolve_for_bot_in_tx(
            &tx,
            &store,
            &bot_id,
            &["GITHUB_TOKEN_REF".to_string()],
        )
        .unwrap();
        assert_eq!(
            resolved,
            vec![("GITHUB_TOKEN_REF".to_string(), CANARY.to_string())]
        );
    }

    // The user revokes between ticks (audited, user-named).
    success(fx.revoke("r1", &bot_id, "GITHUB_TOKEN_REF"));

    // Tick 2: a FRESH transaction (nothing cached from tick 1) refuses.
    {
        let tx = fx.db_tx();
        let error = drogon_core::integrations::resolve::resolve_for_bot_in_tx(
            &tx,
            &store,
            &bot_id,
            &["GITHUB_TOKEN_REF".to_string()],
        )
        .unwrap_err();
        assert_eq!(
            error.monitor_error_kind(),
            drogon_core::bots::monitors::result::MonitorErrorKind::Unauthorized
        );
    }

    // Re-granting resumes resolution (the kill switch is reversible).
    success(fx.grant("g2", &bot_id, "GITHUB_TOKEN_REF", "github"));
    let tx = fx.db_tx();
    let resolved = drogon_core::integrations::resolve::resolve_for_bot_in_tx(
        &tx,
        &store,
        &bot_id,
        &["GITHUB_TOKEN_REF".to_string()],
    )
    .unwrap();
    assert_eq!(resolved.len(), 1);
}

#[test]
fn a_grant_for_one_bot_never_authorizes_another_bot() {
    let fx = Fx::new();
    let a = fx.create_bot("c1", "Alpha", Some("alpha"));
    let b = fx.create_bot("c2", "Beta", Some("beta"));
    let a_id = a["id"].as_str().unwrap().to_string();
    let b_id = b["id"].as_str().unwrap().to_string();
    fx.provision("p1", &a_id);
    fx.provision("p2", &b_id);
    fx.grant("g1", &a_id, "SHARED_REF", "github");

    let store = drogon_core::integrations::store::SecretStore::new(&fx.data_dir, "github").unwrap();
    store.save_secret("SHARED_REF", CANARY).unwrap();

    let tx = fx.db_tx();
    let resolved_for_a = drogon_core::integrations::resolve::resolve_for_bot_in_tx(
        &tx,
        &store,
        &a_id,
        &["SHARED_REF".to_string()],
    );
    assert!(resolved_for_a.is_ok());
    let error = drogon_core::integrations::resolve::resolve_for_bot_in_tx(
        &tx,
        &store,
        &b_id,
        &["SHARED_REF".to_string()],
    )
    .unwrap_err();
    assert_eq!(
        error.monitor_error_kind(),
        drogon_core::bots::monitors::result::MonitorErrorKind::Unauthorized
    );
}

#[test]
fn set_secret_seals_the_value_and_the_ledger_never_holds_plaintext() {
    let fx = Fx::new();
    // Value goes in through the RPC, sealed straight into the store.
    let saved = success(fx.engine.dispatch(request(
        "s1",
        "secrets.set",
        json!({"kind": "github", "name": "GITHUB_TOKEN_REF", "value": CANARY}),
    )));
    assert_eq!(saved["saved"], true);
    assert!(
        !saved.to_string().contains(CANARY),
        "the response must never echo the value"
    );

    // The sealed store round-trips it; the plaintext file does not exist.
    let store = drogon_core::integrations::store::SecretStore::new(&fx.data_dir, "github").unwrap();
    assert_eq!(
        store.read_secret("GITHUB_TOKEN_REF").unwrap().as_deref(),
        Some(CANARY)
    );

    // The durable DB files hold a fingerprint, never the params: grep the
    // raw bytes of every database file for the canary.
    for suffix in ["", "-wal", "-shm"] {
        let path = fx
            .data_dir
            .join(format!("{}{suffix}", drogon_core::DB_FILE_NAME));
        if let Ok(bytes) = std::fs::read(&path) {
            assert!(
                !bytes
                    .windows(CANARY.len())
                    .any(|window| window == CANARY.as_bytes()),
                "{path:?} must never hold the plaintext value"
            );
        }
    }

    // Names-only listing and delete round out the lifecycle.
    let listed = success(fx.engine.dispatch(request(
        "l1",
        "secrets.list",
        json!({"kind": "github"}),
    )));
    assert_eq!(listed["names"], json!(["GITHUB_TOKEN_REF"]));
    let deleted = success(fx.engine.dispatch(request(
        "d1",
        "secrets.delete",
        json!({"kind": "github", "name": "GITHUB_TOKEN_REF"}),
    )));
    assert_eq!(deleted["deleted"], true);
    assert_eq!(store.read_secret("GITHUB_TOKEN_REF").unwrap(), None);

    // A granted-but-now-unset secret resolves to an honest NotFound.
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bot_id = bot["id"].as_str().unwrap().to_string();
    fx.provision("p1", &bot_id);
    fx.grant("g1", &bot_id, "GITHUB_TOKEN_REF", "github");
    let tx = fx.db_tx();
    let error = drogon_core::integrations::resolve::resolve_for_bot_in_tx(
        &tx,
        &store,
        &bot_id,
        &["GITHUB_TOKEN_REF".to_string()],
    )
    .unwrap_err();
    assert_eq!(
        error.monitor_error_kind(),
        drogon_core::bots::monitors::result::MonitorErrorKind::NotFound
    );
}
