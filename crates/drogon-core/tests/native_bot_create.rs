//! Tests for the staged `bot.create` bridge (`bot_mutation_rpc`) against a
//! real `Engine::open` store, using the second-raw-connection pattern. The
//! module is staged per the A6d principle: pure parse, scope authorization
//! on the passed canonical connection, and a DB-only body — there is no
//! ledger trait, no fingerprint callback, no DDL, and no spawn path, so
//! replay/conflict end-to-end is ROOT-wiring-tested (plan in the A6c/B6
//! delivery reports).
//!
//! Invalid-body isolation follows ROOT msg_0d7df46e99ca: every invalid case
//! is derived from the fully valid params helper by changing ONLY the field
//! under test, with the valid baseline passing first.
//!
//! PROVISIONAL BINDING SEAM: `bot_mutation_rpc` is not yet registered in
//! `lib.rs` (ROOT owns registration); after registration the `#[path]`
//! module below becomes `use drogon_core::bot_mutation_rpc;` with zero test
//! changes, because the module only uses `drogon_core::` paths.

#[path = "../src/bot_mutation_rpc.rs"]
mod bot_mutation_rpc;

use drogon_core::bots::storage as bstorage;
use drogon_core::{DB_FILE_NAME, Engine};
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

use bot_mutation_rpc::{
    BotCreateCaller, authorize_create_scope, create_in_connection, ensure_desktop_caller,
    parse_bot_create_request,
};

/// One deterministic server clock for the whole suite.
const NOW_UNIX: u64 = 1_797_724_800; // 2026-09-09T00:00:00Z

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

/// Fully valid params: the baseline every invalid case derives from.
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

fn parse(params: &Value) -> bot_mutation_rpc::BotCreateRequest {
    parse_bot_create_request(params).unwrap()
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
    let request = parse(&params(&host, json!({})));

    // The valid baseline passes: authorize, then the DB body.
    authorize_create_scope(&conn, &host, &request).unwrap();
    let dto = create_in_connection(&conn, &host, "req-1", &request, NOW_UNIX).unwrap();
    assert_eq!(dto["id"], "bot-1");
    assert_eq!(dto["displayIdentity"]["displayName"], "Watcher");
    assert_eq!(dto["characterPreset"], "none");
    assert_eq!(dto["harnessPolicy"]["defaultHarness"], "codex");
    // Born-empty enforcement, verified in the response.
    assert_eq!(dto["responsibilities"], json!([]));
    assert!(dto["currentSession"].is_null());
    assert_eq!(dto["createdAt"], NOW_UNIX as f64);
    assert_eq!(dto["updatedAt"], NOW_UNIX as f64);

    // Durable scoped record: present in the owning scope, absent elsewhere.
    let stored = bstorage::get_bot(&conn, &host, "/repo", "bot-1")
        .unwrap()
        .unwrap();
    assert_eq!(stored.display_identity.display_name, "Watcher");
    assert!(stored.responsibilities.is_empty());
    assert!(stored.current_session.is_none());
    assert!(
        bstorage::get_bot(&conn, &host, "/other-folder", "bot-1")
            .unwrap()
            .is_none(),
        "the record must be scoped to the workspace folder"
    );

    // Never spawns: no session row ever appears (the bridge has no seam).
    let sessions: i64 = conn
        .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
        .unwrap();
    assert_eq!(sessions, 0);
}

#[test]
fn strict_schema_denies_unknown_fields_and_smuggled_request_ids() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, "ws-1", "/repo", &host);

    // Unknown outer field.
    let err = parse_bot_create_request(&params(&host, json!({"extra": 1}))).unwrap_err();
    assert_eq!(err.code, "invalid_argument");

    // A params `requestId` is an unknown field: the envelope carries it.
    let err =
        parse_bot_create_request(&params(&host, json!({"requestId": "smuggled"}))).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    assert!(err.message.contains("requestId"), "{err:?}");
}

#[test]
fn invalid_bodies_are_isolated_to_the_field_under_test_from_a_passing_baseline() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, "ws-1", "/repo", &host);

    // The valid baseline passes first (ROOT msg_0d7df46e99ca).
    let baseline = parse(&params(&host, json!({})));
    authorize_create_scope(&conn, &host, &baseline).unwrap();
    create_in_connection(&conn, &host, "req-baseline", &baseline, NOW_UNIX).unwrap();

    // Change ONLY responsibilities: a non-empty born array is refused at
    // the parse phase (invalid_argument naming the field), so the DB body
    // is never reached and nothing is written.
    let with_duty = params(
        &host,
        json!({"body": {
            "characterPreset": "none",
            "displayIdentity": { "displayName": "Watcher", "handle": null, "title": null },
            "harnessPolicy": { "defaultHarness": "codex", "explicitModel": null },
            "instructions": "",
            "memories": [],
            "responsibilities": [ { "id": "x" } ]
        }}),
    );
    let err = parse_bot_create_request(&with_duty).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    assert!(err.message.contains("responsibilities"), "{err:?}");

    // Change ONLY currentSession: a born Bot can never carry a session.
    let with_session = params(
        &host,
        json!({"body": {
            "characterPreset": "none",
            "displayIdentity": { "displayName": "Watcher", "handle": null, "title": null },
            "harnessPolicy": { "defaultHarness": "codex", "explicitModel": null },
            "instructions": "",
            "memories": [],
            "currentSession": { "sessionId": "s", "harness": "codex", "model": null,
                                "startedAt": 1.0, "rotatedAt": null }
        }}),
    );
    let err = parse_bot_create_request(&with_session).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    assert!(err.message.contains("currentSession"), "{err:?}");

    // Structural defense in depth: even a hand-built request whose body
    // smuggles born state produces a born-empty DTO, because build_bot
    // never reads those keys.
    let smuggled = bot_mutation_rpc::BotCreateRequest {
        workspace_id: "ws-1".to_string(),
        asserted_host_id: host.clone(),
        bot_id: Some("bot-smuggled".to_string()),
        body: json!({
            "characterPreset": "none",
            "displayIdentity": { "displayName": "Watcher", "handle": null, "title": null },
            "harnessPolicy": { "defaultHarness": "codex", "explicitModel": null },
            "instructions": "",
            "memories": [],
            "responsibilities": [ { "id": "x" } ],
            "currentSession": { "sessionId": "s", "harness": "codex" }
        }),
        locale: None,
    };
    authorize_create_scope(&conn, &host, &smuggled).unwrap();
    let dto = create_in_connection(&conn, &host, "req-smuggled", &smuggled, NOW_UNIX).unwrap();
    assert_eq!(dto["responsibilities"], json!([]));
    assert!(dto["currentSession"].is_null());
}

#[test]
fn absent_bot_id_mints_a_fresh_id_per_admission_replay_identity_is_delegated() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, "ws-1", "/repo", &host);

    // Two separate admissions without botId mint two distinct ids: minting
    // is fresh-only here; identical-replay identity is the canonical
    // ledger's job at ROOT wiring (the admitted work never re-runs).
    let first = parse(&params(&host, json!({"botId": null})));
    authorize_create_scope(&conn, &host, &first).unwrap();
    let dto_a = create_in_connection(&conn, &host, "req-a", &first, NOW_UNIX).unwrap();

    let second = parse(&params(&host, json!({"botId": null})));
    authorize_create_scope(&conn, &host, &second).unwrap();
    let dto_b = create_in_connection(&conn, &host, "req-b", &second, NOW_UNIX).unwrap();

    let id_a = dto_a["id"].as_str().unwrap().to_string();
    let id_b = dto_b["id"].as_str().unwrap().to_string();
    assert!(!id_a.is_empty() && !id_b.is_empty());
    assert_ne!(id_a, id_b, "each admission mints its own id");
    assert!(
        bstorage::get_bot(&conn, &host, "/repo", &id_a)
            .unwrap()
            .is_some()
    );
    assert!(
        bstorage::get_bot(&conn, &host, "/repo", &id_b)
            .unwrap()
            .is_some()
    );
}

#[test]
fn authorize_reruns_are_side_effect_free_and_repeatable() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, "ws-1", "/repo", &host);
    let request = parse(&params(&host, json!({})));

    // Authorization is a pure gate: repeatable, identical, and write-free —
    // the shape ROOT's wrapper needs to rerun it before cached replays.
    for _ in 0..3 {
        authorize_create_scope(&conn, &host, &request).unwrap();
    }
    let bots: i64 = conn
        .query_row("SELECT COUNT(*) FROM bots", [], |r| r.get(0))
        .unwrap();
    assert_eq!(bots, 0, "authorization alone writes nothing");
}

#[test]
fn foreign_scope_is_refused_and_leaks_no_state() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, "ws-1", "/repo", "host-other");
    let other_hosted = parse(&params(&host, json!({})));

    // The workspace row belongs to another host: refused regardless of the
    // client's assertion.
    let err = authorize_create_scope(&conn, &host, &other_hosted).unwrap_err();
    assert_eq!(err.code, "foreign_workspace_host");
    assert_eq!(
        err.message,
        format!(
            "foreign workspace host: workspace ws-1 belongs to host host-other, \
             not current host {host}"
        )
    );

    // Unknown workspace.
    let missing = parse(&params(&host, json!({"workspaceId": "ws-missing"})));
    let err = authorize_create_scope(&conn, &host, &missing).unwrap_err();
    assert_eq!(err.code, "unknown_workspace");

    // A mismatched assertion on an owned workspace is refused too.
    seed_workspace(&conn, "ws-2", "/repo2", &host);
    let mismatched = parse(&params(
        &host,
        json!({
            "workspaceId": "ws-2",
            "hostId": "host-evil"
        }),
    ));
    let err = authorize_create_scope(&conn, &host, &mismatched).unwrap_err();
    assert_eq!(err.code, "foreign_workspace_host");
    assert_eq!(
        err.message,
        format!(
            "foreign workspace host: asserted host host-evil does not match derived host {host}"
        )
    );

    // The refusals leaked no state, and the DB body without authorization
    // still refuses an unknown scope on its own (defense in depth).
    let bots: i64 = conn
        .query_row("SELECT COUNT(*) FROM bots", [], |r| r.get(0))
        .unwrap();
    assert_eq!(bots, 0);
    let err = create_in_connection(&conn, &host, "req-x", &missing, NOW_UNIX).unwrap_err();
    assert_eq!(err.code, "unknown_workspace");
}

#[test]
fn worker_callers_are_denied_on_this_auth_path() {
    let err = ensure_desktop_caller(&BotCreateCaller::Worker {
        host_id: "host-1".to_string(),
        run_id: "run-1".to_string(),
        dispatch_id: "dispatch-1".to_string(),
    })
    .unwrap_err();
    assert_eq!(err.code, "unauthorized");
    assert_eq!(
        err.message,
        "bot.create is desktop-only: worker dispatch credentials are denied on this auth path"
    );
    ensure_desktop_caller(&BotCreateCaller::Desktop).unwrap();
}

#[test]
fn the_bridge_creates_no_tables_and_persists_nothing_but_the_bot_row() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, "ws-1", "/repo", &host);

    let tables_before: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'",
            [],
            |r| r.get(0),
        )
        .unwrap();

    let request = parse(&params(&host, json!({})));
    authorize_create_scope(&conn, &host, &request).unwrap();
    let dto = create_in_connection(&conn, &host, "req-1", &request, NOW_UNIX).unwrap();
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

#[test]
fn the_db_body_composes_inside_a_caller_owned_transaction() {
    let (_dir, _engine, conn, host) = fixture();
    seed_workspace(&conn, "ws-1", "/repo", &host);
    let request = parse(&params(&host, json!({})));

    // run_atomic compatibility, behaviorally proven: the body runs inside a
    // caller-owned transaction without beginning or committing its own.
    let tx = conn.unchecked_transaction().unwrap();
    let dto = create_in_connection(&tx, &host, "req-1", &request, NOW_UNIX).unwrap();
    assert_eq!(dto["id"], "bot-1");
    // A second connection sees nothing until the caller commits: the body
    // left commit control entirely to the transaction owner.
    let observer = rusqlite::Connection::open(_dir.path().join(DB_FILE_NAME)).unwrap();
    assert!(
        bstorage::get_bot(&observer, &host, "/repo", "bot-1")
            .unwrap()
            .is_none(),
        "uncommitted work must not leak past the caller's transaction"
    );
    tx.commit().unwrap();
    assert!(
        bstorage::get_bot(&observer, &host, "/repo", "bot-1")
            .unwrap()
            .is_some()
    );
}
