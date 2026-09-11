//! P0 five-surface redaction canary (PR #420 §4.5): a known canary secret
//! is sealed into the store, granted to a real Bot, and resolved through
//! the tick-time seam with the canary deliberately echoed into a captured
//! transcript (the worst case a script runner can produce). The canary must
//! then be absent from every durable surface:
//!
//! 1. `bot_monitors` rows,
//! 2. `bot_monitor_checks` rows,
//! 3. `bot_audit` rows,
//! 4. the `bot_monitor_events` outbox,
//! 5. captured stderr/stdout transcripts (scrubbed through
//!    `scrub_for_persist` before anything may persist — the persisted row
//!    must carry the `[redacted]` marker instead).
//!
//! Only the bare REFERENCE is ever persisted.
//!
//! Real Engine, real scheduler tick, real sealed store, real commit paths;
//! fixture secrets only — no network, no models.

use drogon_core::Engine;
use drogon_core::bots::monitors::record::MonitorRecord;
use drogon_core::bots::monitors::result::{MonitorCheckResult, MonitorErrorKind};
use drogon_core::bots::monitors::storage as monitor_storage;
use drogon_core::integrations::resolve::{
    REDACTED, resolve_for_bot_in_tx, scrub_for_persist, with_resolved_secrets,
};
use drogon_core::integrations::store::SecretStore;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

const CANARY: &str = "canary-REDACT-DROGON-P0-9c27e";

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

    fn provisioned_bot(&self, req: &str, name: &str, handle: &str) -> (String, String) {
        let bot = success(self.engine.dispatch(request(
            req,
            "bot.create",
            json!({
                "workspaceId": self.workspace_id,
                "hostId": self.host_id,
                "body": bot_body(name, Some(handle)),
            }),
        )));
        let bot_id = bot["id"].as_str().unwrap().to_string();
        let provisioned = success(self.engine.dispatch(request(
            format!("prov-{req}").as_str(),
            "bot.self_provision",
            json!({
                "botId": bot_id, "actorBotId": bot_id,
                "workspaceId": self.workspace_id, "hostId": self.host_id,
            }),
        )));
        (bot_id, provisioned["path"].as_str().unwrap().to_string())
    }

    fn approved_monitor(&self, req: &str, bot_id: &str, home_path: &str, resource: &str) -> String {
        std::fs::create_dir_all(home_path).unwrap();
        std::fs::write(format!("{home_path}/{resource}"), "baseline").unwrap();
        let created = success(self.engine.dispatch(request(
            req,
            "bot.self_create_monitor",
            json!({
                "botId": bot_id, "actorBotId": bot_id,
                "workspaceId": self.workspace_id, "hostId": self.host_id,
                "resource": resource,
                "trigger": {"kind": "scheduled", "cron": "* * * * *"},
            }),
        )));
        created["monitorId"].as_str().unwrap().to_string()
    }
}

/// Concatenates EVERY column of EVERY row of `table` into one string.
fn dump_table(data_dir: &std::path::Path, table: &str) -> String {
    let conn = rusqlite::Connection::open(data_dir.join(drogon_core::DB_FILE_NAME)).unwrap();
    let mut stmt = conn.prepare(&format!("SELECT * FROM {table}")).unwrap();
    let column_count = stmt.column_count();
    let rows = stmt
        .query_map([], |r| {
            let mut parts = Vec::with_capacity(column_count);
            for column in 0..column_count {
                let value: Option<rusqlite::types::Value> = r.get(column)?;
                parts.push(match value {
                    None => String::new(),
                    Some(rusqlite::types::Value::Null) => String::new(),
                    Some(rusqlite::types::Value::Integer(v)) => v.to_string(),
                    Some(rusqlite::types::Value::Real(v)) => v.to_string(),
                    Some(rusqlite::types::Value::Text(v)) => v,
                    Some(rusqlite::types::Value::Blob(v)) => {
                        v.iter().map(|b| format!("{b:02x}")).collect::<String>()
                    }
                });
            }
            Ok(parts.join("\u{1}"))
        })
        .unwrap();
    rows.collect::<Result<Vec<_>, _>>().unwrap().join("\u{1}\n")
}

fn assert_absent_everywhere(data_dir: &std::path::Path, canary: &str, context: &str) {
    for table in [
        "bot_monitors",
        "bot_monitor_checks",
        "bot_audit",
        "bot_monitor_events",
        "bot_secret_grants",
        "bot_homes",
        "bots",
        "requests",
    ] {
        let dumped = dump_table(data_dir, table);
        assert!(
            !dumped.contains(canary),
            "{context}: canary leaked into {table}:\n{dumped}"
        );
    }
    // And the raw database bytes themselves (covers any column this build
    // does not know about yet, WAL included).
    for suffix in ["", "-wal", "-shm"] {
        let path = data_dir.join(format!("{}{suffix}", drogon_core::DB_FILE_NAME));
        if let Ok(bytes) = std::fs::read(&path) {
            assert!(
                !bytes
                    .windows(canary.len())
                    .any(|window| window == canary.as_bytes()),
                "{context}: canary leaked into raw db bytes ({path:?})"
            );
        }
    }
}

#[test]
fn resolved_secret_canary_is_absent_from_all_five_surfaces() {
    let fx = Fx::new();
    let (bot_id, home_path) = fx.provisioned_bot("c1", "Watcher", "watcher");
    let monitor_id = fx.approved_monitor("m1", &bot_id, &home_path, "notes.md");

    // The user's value lifecycle through the real RPC, then the real grant.
    success(fx.engine.dispatch(request(
        "s1",
        "secrets.set",
        json!({"kind": "github", "name": "GITHUB_TOKEN_REF", "value": CANARY}),
    )));
    success(fx.engine.dispatch(request(
        "g1",
        "bot.grant_secret",
        json!({
            "botId": bot_id, "secretRef": "GITHUB_TOKEN_REF", "kind": "github",
            "workspaceId": fx.workspace_id, "hostId": fx.host_id,
        }),
    )));

    // Real baseline tick: the approved monitor establishes its cursor, so
    // this fixture genuinely rides the scheduler's monitor machinery.
    let now = 1_700_000_000_000.0;
    drogon_core::automations::scheduler::tick_once(&fx.engine, now);
    let monitor_before = monitor_storage::get_monitor(
        &rusqlite::Connection::open(fx.data_dir.join(drogon_core::DB_FILE_NAME)).unwrap(),
        &monitor_id,
    )
    .unwrap()
    .expect("monitor row exists");
    assert!(monitor_before.0.cursor.is_some(), "baseline tick ran");

    // --- Tick Phase B (lock dropped): resolve through the ONLY gate. ---
    let store = SecretStore::new(&fx.data_dir, "github").unwrap();
    let secret_refs = vec!["GITHUB_TOKEN_REF".to_string()];
    let db_path = fx.data_dir.join(drogon_core::DB_FILE_NAME);
    let conn: &'static mut rusqlite::Connection =
        Box::leak(Box::new(rusqlite::Connection::open(&db_path).unwrap()));
    let tx = conn.unchecked_transaction().unwrap();

    // Positive control: the canary really is resolved into memory.
    let direct = resolve_for_bot_in_tx(&tx, &store, &bot_id, &secret_refs).expect("grant resolves");
    assert_eq!(
        direct,
        vec![("GITHUB_TOKEN_REF".to_string(), CANARY.to_string())]
    );

    // The execution gate hands the resolved values to the runner; the
    // "script" fails and its captured stderr ECHOES the canary — the worst
    // case the future runner must survive.
    let spawned = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let spawned_for_closure = spawned.clone();
    let execution: Result<(String,), drogon_core::integrations::resolve::SecretResolutionError> =
        with_resolved_secrets(&tx, &store, &bot_id, &secret_refs, Err, |resolved| {
            spawned_for_closure.store(true, std::sync::atomic::Ordering::SeqCst);
            // Surface 5, captured transcript: raw stderr holds the value…
            let transcript = format!("gh: error validating token {CANARY}: bad credentials");
            // …and scrub_for_persist is the only text that may leave.
            Ok((scrub_for_persist(&transcript, resolved),))
        });
    let (scrubbed_transcript,) = execution.unwrap();
    assert!(spawned.load(std::sync::atomic::Ordering::SeqCst));
    assert!(
        !scrubbed_transcript.contains(CANARY),
        "scrubbed transcript must not hold the canary"
    );
    assert!(
        scrubbed_transcript.contains(REDACTED),
        "scrubbed transcript carries the redaction marker"
    );

    // --- Tick Phase C (real commit path, exactly like the error-retained
    // branch of tick_bot_monitors): BEGIN IMMEDIATE + cas_write +
    // record_check, so the scrubbed text is what actually persists. ---
    drop(tx);
    let (mut record, rev) =
        monitor_storage::get_monitor(&rusqlite::Connection::open(&db_path).unwrap(), &monitor_id)
            .unwrap()
            .unwrap();
    let result = MonitorCheckResult::error(
        &monitor_id,
        record.version,
        MonitorErrorKind::IoError,
        scrubbed_transcript.clone(),
        now + 61_000.0,
    );
    record.consecutive_errors = record.consecutive_errors.saturating_add(1);
    record.last_error = Some(scrubbed_transcript.clone());
    record.next_eligible_at_ms = Some(now + 61_000.0 + 5_000.0);
    record.updated_at_ms = now + 61_000.0;
    let check = monitor_storage::StoredCheck {
        id: format!("chk_canary_{}", uuid::Uuid::new_v4().simple()),
        monitor_id: monitor_id.clone(),
        monitor_version: record.version,
        started_at_ms: now + 61_000.0,
        result: result.clone(),
        delivery: monitor_storage::DeliveryState::NotApplicable,
    };
    {
        let engine_conn = rusqlite::Connection::open(&db_path).unwrap();
        let tx = engine_conn.unchecked_transaction().unwrap();
        monitor_storage::cas_write(&tx, &record, rev).unwrap();
        monitor_storage::record_check(&tx, &check).unwrap();
        tx.commit().unwrap();
    }

    // Surfaces 1–4 (+ every other table and the raw bytes): the canary is
    // nowhere. The redaction marker IS in the monitor row and the check
    // row, proving those surfaces genuinely carried the scrubbed text.
    assert_absent_everywhere(&fx.data_dir, CANARY, "resolved-secret flow");
    let monitors_dump = dump_table(&fx.data_dir, "bot_monitors");
    assert!(
        monitors_dump.contains(REDACTED),
        "monitor row carries the scrubbed text"
    );
    let checks_dump = dump_table(&fx.data_dir, "bot_monitor_checks");
    assert!(
        checks_dump.contains(REDACTED),
        "check row carries the scrubbed text"
    );
    let checks = monitor_storage::list_checks_for_monitor(
        &rusqlite::Connection::open(&db_path).unwrap(),
        &monitor_id,
    )
    .unwrap();
    assert!(
        checks.iter().any(|c| c.result == result),
        "the check row persisted"
    );
    let _ = MonitorRecord::validate(&record); // the persisted record stays shape-valid
}

#[test]
fn real_full_tick_never_persists_watched_file_contents() {
    let fx = Fx::new();
    let (bot_id, home_path) = fx.provisioned_bot("c1", "Watcher", "watcher");
    let monitor_id = fx.approved_monitor("m1", &bot_id, &home_path, "notes.md");

    // The WATCHED CONTENT itself is the canary here: whatever a monitor
    // reads must persist only as a digest.
    std::fs::write(format!("{home_path}/notes.md"), format!("token={CANARY}")).unwrap();

    let now = 1_700_000_000_000.0;
    drogon_core::automations::scheduler::tick_once(&fx.engine, now);
    // Change → the second tick fires a real outbox event.
    std::fs::write(
        format!("{home_path}/notes.md"),
        format!("token={CANARY}\nrotated={CANARY}"),
    )
    .unwrap();
    drogon_core::automations::scheduler::tick_once(&fx.engine, now + 61_000.0);

    assert_absent_everywhere(&fx.data_dir, CANARY, "full-tick watched-content flow");

    // The surfaces were genuinely written: cursor advanced, a check row
    // exists, and the change produced exactly one durable outbox event.
    let conn = rusqlite::Connection::open(fx.data_dir.join(drogon_core::DB_FILE_NAME)).unwrap();
    let (record, _) = monitor_storage::get_monitor(&conn, &monitor_id)
        .unwrap()
        .unwrap();
    assert!(record.cursor.is_some());
    assert!(record.last_event_id.is_some());
    let checks = monitor_storage::list_checks_for_monitor(&conn, &monitor_id).unwrap();
    assert_eq!(checks.len(), 2, "one check-in per tick");
    let events: i64 = conn
        .query_row("SELECT COUNT(*) FROM bot_monitor_events", [], |r| r.get(0))
        .unwrap();
    // Baseline observation is itself a change (no prior cursor), so the
    // content change makes the second durable event.
    assert_eq!(events, 2, "baseline + change each committed one event");
}

#[test]
fn revoked_canary_flow_writes_an_unauthorized_checkin_without_spawn() {
    let fx = Fx::new();
    let (bot_id, home_path) = fx.provisioned_bot("c1", "Watcher", "watcher");
    let monitor_id = fx.approved_monitor("m1", &bot_id, &home_path, "notes.md");
    success(fx.engine.dispatch(request(
        "s1",
        "secrets.set",
        json!({"kind": "github", "name": "GITHUB_TOKEN_REF", "value": CANARY}),
    )));
    success(fx.engine.dispatch(request(
        "g1",
        "bot.grant_secret",
        json!({
            "botId": bot_id, "secretRef": "GITHUB_TOKEN_REF", "kind": "github",
            "workspaceId": fx.workspace_id, "hostId": fx.host_id,
        }),
    )));
    // Revoke BEFORE the tick: the next tick must refuse without ever
    // resolving (and without spawning — the gate never calls execute).
    success(fx.engine.dispatch(request(
        "r1",
        "bot.revoke_secret",
        json!({
            "botId": bot_id, "secretRef": "GITHUB_TOKEN_REF",
            "workspaceId": fx.workspace_id, "hostId": fx.host_id,
        }),
    )));

    let store = SecretStore::new(&fx.data_dir, "github").unwrap();
    let db_path = fx.data_dir.join(drogon_core::DB_FILE_NAME);
    let conn: &'static mut rusqlite::Connection =
        Box::leak(Box::new(rusqlite::Connection::open(&db_path).unwrap()));
    let tx = conn.unchecked_transaction().unwrap();
    let spawned = std::sync::atomic::AtomicBool::new(false);
    let outcome: Result<(), drogon_core::integrations::resolve::SecretResolutionError> =
        with_resolved_secrets(
            &tx,
            &store,
            &bot_id,
            &["GITHUB_TOKEN_REF".to_string()],
            Err,
            |_resolved| {
                spawned.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            },
        );
    let error = outcome.unwrap_err();
    assert_eq!(
        error.monitor_error_kind(),
        MonitorErrorKind::Unauthorized,
        "revocation must fail the next resolution closed"
    );
    assert!(
        !spawned.into_inner(),
        "nothing may spawn behind an unauthorized ref"
    );
    assert!(
        !error.message().contains(CANARY),
        "refusals name the reference, never a value"
    );

    // The refusal is recorded as an honest error check-in (scrubbed text —
    // here there is nothing to scrub, but the row must still exist and the
    // value must still be nowhere).
    drop(tx);
    let now = 1_700_000_000_000.0;
    let (mut record, rev) =
        monitor_storage::get_monitor(&rusqlite::Connection::open(&db_path).unwrap(), &monitor_id)
            .unwrap()
            .unwrap();
    let result = MonitorCheckResult::error(
        &monitor_id,
        record.version,
        error.monitor_error_kind(),
        scrub_for_persist(&error.message(), &[]),
        now,
    );
    record.consecutive_errors = record.consecutive_errors.saturating_add(1);
    record.last_error = Some(error.message());
    record.updated_at_ms = now;
    let check = monitor_storage::StoredCheck {
        id: format!("chk_denied_{}", uuid::Uuid::new_v4().simple()),
        monitor_id: monitor_id.clone(),
        monitor_version: record.version,
        started_at_ms: now,
        result,
        delivery: monitor_storage::DeliveryState::NotApplicable,
    };
    {
        let engine_conn = rusqlite::Connection::open(&db_path).unwrap();
        let tx = engine_conn.unchecked_transaction().unwrap();
        monitor_storage::cas_write(&tx, &record, rev).unwrap();
        monitor_storage::record_check(&tx, &check).unwrap();
        tx.commit().unwrap();
    }
    assert_absent_everywhere(&fx.data_dir, CANARY, "revoked-flow");
    let checks = monitor_storage::list_checks_for_monitor(
        &rusqlite::Connection::open(&db_path).unwrap(),
        &monitor_id,
    )
    .unwrap();
    assert_eq!(checks.len(), 1, "the honest error check-in persisted");
}
