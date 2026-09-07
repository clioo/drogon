//! Tests for the `bot.create` bridge (`bot_mutation_rpc`) against a real
//! `Engine::open` store, using the same second-raw-connection pattern and
//! the same delegation architecture as `native_bot_run.rs`: an in-memory
//! `LedgerDouble` implements the module's `CreateLedger` seam (admit
//! semantics mirroring the admitted `RequestLedger`), and the bridge itself
//! owns no DDL, no table, and no spawn path — it has no dispatch seam at
//! all, and the tests additionally pin that no session row ever appears.
//!
//! PROVISIONAL BINDING SEAM: `bot_mutation_rpc` is not yet registered in
//! `lib.rs` (ROOT owns registration); after registration the `#[path]`
//! module below becomes `use drogon_core::bot_mutation_rpc;` with zero test
//! changes, because the module only uses `drogon_core::` paths.

#[path = "../src/bot_mutation_rpc.rs"]
mod bot_mutation_rpc;

use std::collections::HashMap;
use std::sync::Mutex as StdMutex;

use drogon_core::bots::storage as bstorage;
use drogon_core::{DB_FILE_NAME, Engine};
use drogon_protocol::{PROTOCOL_VERSION, Request, RpcError};
use serde_json::{Value, json};

use bot_mutation_rpc::{BotCreateCaller, CreateLedger, handle_bot_create};

/// One deterministic server clock for the whole suite.
const NOW_UNIX: u64 = 1_797_724_800; // 2026-09-09T00:00:00Z

/// In-memory ledger double implementing the module's `CreateLedger` seam
/// with admitted `RequestLedger` semantics: identical (id, fingerprint)
/// replay returns the stored DTO verbatim, a changed fingerprint under the
/// same envelope id is the frozen `request_conflict` rejection, and first
/// admission runs `work` exactly once. Call-log observable. Never a table.
struct LedgerDouble {
    stored: StdMutex<HashMap<String, (String, Value)>>,
    log: StdMutex<Vec<String>>,
}

impl LedgerDouble {
    fn new() -> Self {
        Self {
            stored: StdMutex::new(HashMap::new()),
            log: StdMutex::new(Vec::new()),
        }
    }

    fn consults(&self) -> Vec<String> {
        self.log.lock().unwrap().clone()
    }

    fn mark_stored(&self, request_id: &str) {
        let mut stored = self.stored.lock().unwrap();
        if let Some((_, dto)) = stored.get_mut(request_id) {
            dto["storageProbe"] = json!("returned-from-ledger");
        }
    }
}

impl CreateLedger for LedgerDouble {
    fn admit<F>(&self, request_id: &str, fingerprint: &str, work: F) -> Result<Value, RpcError>
    where
        F: FnOnce() -> Result<Value, RpcError>,
    {
        self.log.lock().unwrap().push(format!("admit:{request_id}"));
        let mut stored = self.stored.lock().unwrap();
        match stored.get(request_id) {
            Some((stored_fingerprint, dto)) if stored_fingerprint == fingerprint => Ok(dto.clone()),
            Some(_) => Err(RpcError::new(
                "request_conflict",
                "requestId was already used with different parameters.",
            )),
            None => {
                let dto = work()?;
                stored.insert(
                    request_id.to_string(),
                    (fingerprint.to_string(), dto.clone()),
                );
                Ok(dto)
            }
        }
    }
}

fn fixture() -> (tempfile::TempDir, Engine, rusqlite::Connection, String) {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let response = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: "discover-host".to_string(),
        auth: None,
        method: "status".to_string(),
        params: json!({}),
    });
    assert!(response.ok, "status must succeed: {response:?}");
    let host = response.result.unwrap()["hostId"]
        .as_str()
        .unwrap()
        .to_string();
    let conn = rusqlite::Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
    (dir, engine, conn, host)
}

fn seed_workspace(conn: &rusqlite::Connection, id: &str, path: &str, host: &str) {
    conn.execute(
        "INSERT INTO workspaces (id, path, name, kind, host_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, path, id, "folder", host, "2026-09-09T00:00:00Z"],
    )
    .unwrap();
}

/// `requestId` is NOT an admitted param: the envelope carries it.
fn params(host: &str, overrides: Value) -> Value {
    let mut value = json!({
        "workspaceId": "ws-1",
        "hostId": host,
        "botId": "bot-1",
        "body": {
            "characterPreset": "none",
            "displayIdentity": { "displayName": "Watcher", "handle": null, "title": null },
            "harnessPolicy": { "defaultHarness": "codex", "explicitModel": null },
            "instructions": "",
            "memories": []
        },
    });
    for (key, val) in overrides.as_object().unwrap() {
        if val.is_null() {
            value.as_object_mut().unwrap().remove(key);
        } else {
            value[key] = val.clone();
        }
    }
    value
}

fn call(
    conn: &rusqlite::Connection,
    host: &str,
    request_id: &str,
    params: &Value,
    caller: &BotCreateCaller,
    ledger: &LedgerDouble,
) -> Result<Value, RpcError> {
    handle_bot_create(conn, host, request_id, params, caller, ledger, NOW_UNIX)
}

fn table_count(conn: &rusqlite::Connection, name: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [name],
        |r| r.get(0),
    )
    .unwrap()
}

#[test]
fn strict_shape_valid_create_creates_a_born_empty_bot_dto() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, "ws-1", "/repo", &host);
    let ledger = LedgerDouble::new();

    let dto = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({})),
        &BotCreateCaller::Desktop,
        &ledger,
    )
    .unwrap();
    assert_eq!(dto["id"], "bot-1");
    assert_eq!(dto["displayIdentity"]["displayName"], "Watcher");
    assert_eq!(dto["characterPreset"], "none");
    assert_eq!(dto["harnessPolicy"]["defaultHarness"], "codex");
    // Born-empty enforcement, verified in the response.
    assert_eq!(dto["responsibilities"], json!([]));
    assert!(dto["currentSession"].is_null());
    assert_eq!(dto["createdAt"], NOW_UNIX as f64);
    assert_eq!(dto["updatedAt"], NOW_UNIX as f64);

    // The row is durably created in the scoped store.
    let stored = bstorage::get_bot(&conn, &host, "/repo", "bot-1")
        .unwrap()
        .unwrap();
    assert_eq!(stored.display_identity.display_name, "Watcher");
    assert!(stored.responsibilities.is_empty());
    assert!(stored.current_session.is_none());

    // Never spawns: no session row ever appears (the bridge has no seam).
    let sessions: i64 = conn
        .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
        .unwrap();
    assert_eq!(sessions, 0);
}

#[test]
fn strict_schema_denies_unknown_fields_smuggled_request_ids_and_nonempty_born_state() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, "ws-1", "/repo", &host);
    let ledger = LedgerDouble::new();

    // Unknown outer field.
    let err = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({"extra": 1})),
        &BotCreateCaller::Desktop,
        &ledger,
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");

    // A params `requestId` is an unknown field: the envelope carries it.
    let err = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({"requestId": "smuggled"})),
        &BotCreateCaller::Desktop,
        &ledger,
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    assert!(err.message.contains("requestId"), "{err:?}");

    // The body must be the FULL parse_bot_create shape: a partial body is
    // invalid_argument, never completed with defaults.
    let partial = json!({
        "workspaceId": "ws-1",
        "hostId": host,
        "botId": "bot-1",
        "body": { "characterPreset": "none" },
    });
    let err = call(
        &conn,
        &host,
        "req-1",
        &partial,
        &BotCreateCaller::Desktop,
        &ledger,
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");

    // Non-empty born responsibilities are refused by the body parser.
    let with_duty = json!({
        "workspaceId": "ws-1",
        "hostId": host,
        "botId": "bot-1",
        "body": {
            "characterPreset": "none",
            "displayIdentity": { "displayName": "Watcher" },
            "harnessPolicy": { "defaultHarness": "codex" },
            "instructions": "",
            "memories": [],
            "responsibilities": [ { "id": "x" } ]
        },
    });
    let err = call(
        &conn,
        &host,
        "req-1",
        &with_duty,
        &BotCreateCaller::Desktop,
        &ledger,
    )
    .unwrap_err();
    assert_eq!(err.code, "invalid_argument");

    // Pure rejections consume no admission.
    assert!(ledger.consults().is_empty());
}

#[test]
fn same_envelope_request_id_replays_the_exact_stored_dto_even_for_a_minted_id() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, "ws-1", "/repo", &host);
    let ledger = LedgerDouble::new();

    // botId absent: the bridge mints one at first admission.
    let first = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({"botId": null})),
        &BotCreateCaller::Desktop,
        &ledger,
    )
    .unwrap();
    let minted = first["id"].as_str().unwrap().to_string();
    assert!(!minted.is_empty());

    // Tamper with the stored DTO: a true ledger replay returns the STORED
    // value (probe visible); a rebuild/mint would lose the probe and mint a
    // second id.
    ledger.mark_stored("req-1");
    let second = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({"botId": null})),
        &BotCreateCaller::Desktop,
        &ledger,
    )
    .unwrap();
    assert_eq!(second["storageProbe"], "returned-from-ledger");
    let mut expected = first.clone();
    expected["storageProbe"] = json!("returned-from-ledger");
    assert_eq!(second, expected);
    assert_eq!(second["id"], minted.as_str(), "the minted id is stable");

    // Exactly one bot row exists: the replay did not create a second Bot.
    let bots: i64 = conn
        .query_row("SELECT COUNT(*) FROM bots", [], |r| r.get(0))
        .unwrap();
    assert_eq!(bots, 1);
    assert_eq!(
        ledger.consults(),
        vec!["admit:req-1".to_string(), "admit:req-1".to_string()]
    );
}

#[test]
fn same_envelope_request_id_with_changed_params_is_a_conflicting_params_reject() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, "ws-1", "/repo", &host);
    let ledger = LedgerDouble::new();

    let first = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({})),
        &BotCreateCaller::Desktop,
        &ledger,
    )
    .unwrap();
    assert_eq!(first["id"], "bot-1");

    let err = call(
        &conn,
        &host,
        "req-1",
        &params(
            &host,
            json!({"body": {
                "characterPreset": "none",
                "displayIdentity": { "displayName": "Renamed", "handle": null, "title": null },
                "harnessPolicy": { "defaultHarness": "codex", "explicitModel": null },
                "instructions": "",
                "memories": []
            }}),
        ),
        &BotCreateCaller::Desktop,
        &ledger,
    )
    .unwrap_err();
    assert_eq!(err.code, "request_conflict");
    assert_eq!(
        err.message,
        "requestId was already used with different parameters."
    );
}

#[test]
fn foreign_scope_is_refused_and_leaks_no_replay_state() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, "ws-1", "/repo", "host-other");
    let ledger = LedgerDouble::new();

    // The workspace row belongs to another host: refused regardless of the
    // client's assertion.
    let err = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({})),
        &BotCreateCaller::Desktop,
        &ledger,
    )
    .unwrap_err();
    assert_eq!(err.code, "foreign_workspace_host");
    assert_eq!(
        err.message,
        format!(
            "foreign workspace host: workspace ws-1 belongs to host host-other, \
             not current host {host}"
        )
    );

    // Unknown workspace.
    let err = call(
        &conn,
        &host,
        "req-2",
        &params(&host, json!({"workspaceId": "ws-missing"})),
        &BotCreateCaller::Desktop,
        &ledger,
    )
    .unwrap_err();
    assert_eq!(err.code, "unknown_workspace");

    // The refusals leaked nothing: no bot row exists and a different
    // envelope id creates cleanly afterwards.
    let bots_before: i64 = conn
        .query_row("SELECT COUNT(*) FROM bots", [], |r| r.get(0))
        .unwrap();
    assert_eq!(bots_before, 0);
    seed_workspace(&conn, "ws-2", "/repo2", &host);
    let dto = call(
        &conn,
        &host,
        "req-3",
        &params(&host, json!({"workspaceId": "ws-2"})),
        &BotCreateCaller::Desktop,
        &ledger,
    )
    .unwrap();
    assert_eq!(dto["id"], "bot-1");
}

#[test]
fn worker_callers_are_denied_on_this_auth_path_and_consume_no_admission() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, "ws-1", "/repo", &host);
    let ledger = LedgerDouble::new();

    let err = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({})),
        &BotCreateCaller::Worker {
            host_id: host.clone(),
            run_id: "run-1".to_string(),
            dispatch_id: "dispatch-1".to_string(),
        },
        &ledger,
    )
    .unwrap_err();
    assert_eq!(err.code, "unauthorized");
    assert_eq!(
        err.message,
        "bot.create is desktop-only: worker dispatch credentials are denied on this auth path"
    );
    assert!(ledger.consults().is_empty());
}

#[test]
fn the_bridge_creates_no_tables_and_persists_nothing_itself() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, "ws-1", "/repo", &host);
    let ledger = LedgerDouble::new();

    let tables_before: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'",
            [],
            |r| r.get(0),
        )
        .unwrap();

    let dto = call(
        &conn,
        &host,
        "req-1",
        &params(&host, json!({})),
        &BotCreateCaller::Desktop,
        &ledger,
    )
    .unwrap();
    assert_eq!(dto["id"], "bot-1");

    let tables_after: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(tables_before, tables_after, "no DDL, no new table");
    assert_eq!(table_count(&conn, "bot_create_receipts"), 0);
    assert_eq!(table_count(&conn, "bot_run_receipts"), 0);
}
