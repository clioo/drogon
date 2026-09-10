use drogon_core::{DB_FILE_NAME, Engine, automations, bots};
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

fn call(engine: &Engine, method: &str, params: Value) -> Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        auth: None,
        method: method.into(),
        params,
    })
}

struct Fixture {
    dir: tempfile::TempDir,
    engine: Engine,
    workspace: Value,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::open(&dir.path().join("data")).unwrap();
        let workspace = call(&engine, "workspace.register", json!({"path":dir.path()}))
            .result
            .unwrap();
        Self {
            dir,
            engine,
            workspace,
        }
    }

    fn conn(&self) -> rusqlite::Connection {
        rusqlite::Connection::open(self.dir.path().join("data").join(DB_FILE_NAME)).unwrap()
    }

    fn scope(&self) -> Value {
        json!({"hostId":self.workspace["hostId"], "workspaceId":self.workspace["id"], "locale":"en-US"})
    }

    fn seed(&self, id: &str, host: &str, folder: &str) {
        let bot = bots::records::normalize_bot(
            &json!({"id":id,"displayIdentity":{"displayName":id}}),
            |_| true,
            1.0,
        )
        .unwrap();
        bots::storage::create_bot(&self.conn(), host, folder, &bot).unwrap();
    }
}

#[test]
fn snapshot_uses_registered_folder_and_returns_only_its_host_scope() {
    let fx = Fixture::new();
    let host = fx.workspace["hostId"].as_str().unwrap();
    let folder = fx.workspace["path"].as_str().unwrap();
    fx.seed("ours", host, folder);
    fx.seed("other-folder", host, "another-folder");
    fx.seed("other-host", "remote-host", folder);
    let result = call(&fx.engine, "bot.snapshot", fx.scope());
    assert!(result.ok, "{result:?}");
    let data = result.result.unwrap();
    assert_eq!(data["workspaceId"], fx.workspace["id"]);
    assert_eq!(data["hostId"], fx.workspace["hostId"]);
    assert_eq!(data["bots"].as_array().unwrap().len(), 1);
    assert_eq!(data["bots"][0]["id"], "ours");
    assert_eq!(data["history"], json!([]));
}

#[test]
fn missing_and_foreign_host_are_not_an_empty_success() {
    let fx = Fixture::new();
    let mut scope = fx.scope();
    scope["hostId"] = json!("other-host");
    assert_eq!(
        call(&fx.engine, "bot.snapshot", scope.clone())
            .error
            .unwrap()
            .code,
        "unsupported_host"
    );
    scope.as_object_mut().unwrap().remove("hostId");
    assert_eq!(
        call(&fx.engine, "bot.snapshot", scope).error.unwrap().code,
        "invalid_argument"
    );
}

#[test]
fn foreign_workspace_row_is_rejected_even_with_local_host_parameter() {
    let fx = Fixture::new();
    fx.conn()
        .execute(
            "UPDATE workspaces SET host_id='remote' WHERE id=?1",
            [fx.workspace["id"].as_str().unwrap()],
        )
        .unwrap();
    assert_eq!(
        call(&fx.engine, "bot.snapshot", fx.scope())
            .error
            .unwrap()
            .code,
        "unsupported_host"
    );
}

#[test]
fn malformed_bot_remains_on_disk_and_is_not_hidden_as_empty() {
    let fx = Fixture::new();
    fx.seed(
        "broken",
        fx.workspace["hostId"].as_str().unwrap(),
        fx.workspace["path"].as_str().unwrap(),
    );
    fx.conn()
        .execute("UPDATE bots SET payload_json='{' WHERE id='broken'", [])
        .unwrap();
    assert_eq!(
        call(&fx.engine, "bot.snapshot", fx.scope())
            .error
            .unwrap()
            .code,
        "storage_error"
    );
    let raw: String = fx
        .conn()
        .query_row("SELECT payload_json FROM bots WHERE id='broken'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(raw, "{");
}

#[test]
fn client_folder_override_is_rejected() {
    let fx = Fixture::new();
    let mut scope = fx.scope();
    scope["folder"] = json!("another-folder");
    assert_eq!(
        call(&fx.engine, "bot.snapshot", scope).error.unwrap().code,
        "invalid_argument"
    );
}

/// P2-2 regression (a): excessive history row count must fail `snapshot_too_large` from the
/// cheap COUNT preflight, before any row is parsed. Seeded payloads are deliberately invalid
/// `ResponsibilityRun` JSON: a fall-through to real materialization would surface
/// `storage_error` on the first malformed row instead, so the error code proves the fence held.
#[test]
fn excess_history_rows_trigger_snapshot_too_large_without_full_materialization() {
    let fx = Fixture::new();
    let host = fx.workspace["hostId"].as_str().unwrap();
    let folder = fx.workspace["path"].as_str().unwrap();
    fx.seed("b1", host, folder);

    let conn = fx.conn();
    let tx = conn.unchecked_transaction().unwrap();
    for i in 0..5001 {
        tx.execute(
            "INSERT INTO bot_responsibility_runs (id, bot_id, automation_run_id, started_at, payload_json)
             VALUES (?1, 'b1', NULL, ?2, 'not-valid-json')",
            rusqlite::params![format!("garbage-{i}"), i as f64],
        )
        .unwrap();
    }
    tx.commit().unwrap();

    let result = call(&fx.engine, "bot.snapshot", fx.scope());
    assert_eq!(
        result.error.as_ref().map(|e| e.code.as_str()),
        Some("snapshot_too_large"),
        "{result:?}"
    );
}

/// P2-2 regression (b), automation side: few, tiny history rows must still fail the byte
/// budget when a linked `automations` payload is oversized -- linked records count too.
#[test]
fn oversized_linked_automation_record_hits_the_byte_budget() {
    let fx = Fixture::new();
    let host = fx.workspace["hostId"].as_str().unwrap();
    let folder = fx.workspace["path"].as_str().unwrap();
    fx.seed("b1", host, folder);

    let conn = fx.conn();
    let huge = json!("x".repeat(600_000)).to_string();
    conn.execute(
        "INSERT INTO automations (id, bot_id, payload_json) VALUES ('big-auto', NULL, ?1)",
        rusqlite::params![huge],
    )
    .unwrap();
    let run = json!({
        "id":"run1","botId":"b1","responsibilityId":"r1",
        "automationId":"big-auto","automationRunId":null,
        "startedAt":1.0,"endedAt":null,"recipe":null,"hostObservation":null,
    })
    .to_string();
    conn.execute(
        "INSERT INTO bot_responsibility_runs (id, bot_id, automation_run_id, started_at, payload_json)
         VALUES ('run1', 'b1', NULL, 1.0, ?1)",
        rusqlite::params![run],
    )
    .unwrap();

    let result = call(&fx.engine, "bot.snapshot", fx.scope());
    assert_eq!(
        result.error.as_ref().map(|e| e.code.as_str()),
        Some("snapshot_too_large"),
        "{result:?}"
    );
}

/// Same as above, but the oversized linked record is an `automation_runs` row reached via
/// `automationRunId` rather than `automations` via `automationId`.
#[test]
fn oversized_linked_automation_run_record_hits_the_byte_budget() {
    let fx = Fixture::new();
    let host = fx.workspace["hostId"].as_str().unwrap();
    let folder = fx.workspace["path"].as_str().unwrap();
    fx.seed("b1", host, folder);

    let conn = fx.conn();
    let huge = json!("x".repeat(600_000)).to_string();
    conn.execute(
        "INSERT INTO automation_runs (id, automation_id, payload_json) VALUES ('big-run', 'some-auto', ?1)",
        rusqlite::params![huge],
    )
    .unwrap();
    let run = json!({
        "id":"run1","botId":"b1","responsibilityId":"r1",
        "automationId":null,"automationRunId":"big-run",
        "startedAt":1.0,"endedAt":null,"recipe":null,"hostObservation":null,
    })
    .to_string();
    conn.execute(
        "INSERT INTO bot_responsibility_runs (id, bot_id, automation_run_id, started_at, payload_json)
         VALUES ('run1', 'b1', 'big-run', 1.0, ?1)",
        rusqlite::params![run],
    )
    .unwrap();

    let result = call(&fx.engine, "bot.snapshot", fx.scope());
    assert_eq!(
        result.error.as_ref().map(|e| e.code.as_str()),
        Some("snapshot_too_large"),
        "{result:?}"
    );
}

/// P2-2 regression (c): a worker credential (not the service credential) must be denied for
/// `bot.snapshot` with `unauthorized` through `dispatch_authenticated` -- never data, and
/// never a generic `method_not_found` that would suggest the allowlist was bypassed.
#[test]
fn authenticated_worker_credential_is_denied_for_bot_snapshot_not_given_data() {
    let fx = Fixture::new();
    let host = fx.workspace["hostId"].as_str().unwrap();
    let folder = fx.workspace["path"].as_str().unwrap();
    fx.seed("ours", host, folder);

    let request = drogon_protocol::Request {
        protocol: PROTOCOL_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        auth: Some("some-worker-credential-not-the-service-secret".to_string()),
        method: "bot.snapshot".into(),
        params: fx.scope(),
    };
    let result = fx
        .engine
        .dispatch_authenticated(request, "the-real-service-credential");
    assert!(!result.ok, "{result:?}");
    assert_eq!(result.error.unwrap().code, "unauthorized");
}

/// P2-2 regression (d): an unsupported locale tag maps to `invalid_argument` (the
/// `snapshot_error` LocaleOrdering branch), keeping the locale-vs-malformed-store
/// distinction instead of collapsing both into `storage_error`.
#[test]
fn unsupported_locale_maps_to_invalid_argument_not_storage_error() {
    let fx = Fixture::new();
    let host = fx.workspace["hostId"].as_str().unwrap();
    let folder = fx.workspace["path"].as_str().unwrap();
    fx.seed("ours", host, folder);

    let mut scope = fx.scope();
    scope["locale"] = json!("not a locale!!");
    let result = call(&fx.engine, "bot.snapshot", scope);
    assert_eq!(
        result.error.as_ref().map(|e| e.code.as_str()),
        Some("invalid_argument"),
        "{result:?}"
    );
}

fn sample_automation(id: &str, bot_id: &str) -> automations::records::Automation {
    automations::records::Automation {
        id: id.to_string(),
        creation_key: None,
        name: "sweep".to_string(),
        prompt: "p".to_string(),
        precheck: None,
        agent_id: "codex".to_string(),
        model: None,
        provider: None,
        run_context: None,
        source_context: None,
        project_id: "proj".to_string(),
        execution_target_type: automations::records::ExecutionTargetType::Local,
        execution_target_id: "local".to_string(),
        execution_target_generation: None,
        scheduler_owner: automations::records::SchedulerOwner::LocalHostService,
        workspace_mode: automations::records::WorkspaceMode::Existing,
        workspace_id: None,
        base_branch: None,
        setup_decision: None,
        reuse_session: false,
        timezone: "UTC".to_string(),
        rrule: "FREQ=DAILY".to_string(),
        dtstart: 0.0,
        enabled: true,
        next_run_at: 100.0,
        last_run_at: None,
        missed_run_policy: automations::records::MissedRunPolicy::RunOnceWithinGrace,
        missed_run_grace_minutes: 30.0,
        created_at: 0.0,
        updated_at: 0.0,
        bot_id: Some(bot_id.to_string()),
    }
}

fn sample_scheduled_responsibility(id: &str, automation_id: &str) -> bots::records::Responsibility {
    bots::records::Responsibility {
        id: id.to_string(),
        name: "sweep".to_string(),
        instructions: String::new(),
        kind: bots::records::ResponsibilityKind::Scheduled,
        trigger: bots::records::ResponsibilityTrigger::Scheduled {
            automation_id: automation_id.to_string(),
        },
        enabled: true,
        recipe: None,
        created_at: 0.0,
        updated_at: 0.0,
    }
}

/// Regression: each scheduled responsibility's `trigger` object serialized into the `bots`
/// array must carry a projected camelCase `automationId` alongside the retained snake_case
/// `automation_id` (the trigger's `rename_all` covers only the `kind` tag).
#[test]
fn scheduled_responsibility_trigger_in_bots_array_has_camel_case_automation_id() {
    let fx = Fixture::new();
    let host = fx.workspace["hostId"].as_str().unwrap();
    let folder = fx.workspace["path"].as_str().unwrap();
    fx.seed("b1", host, folder);

    let conn = fx.conn();
    let automation = sample_automation("auto-1", "b1");
    let responsibility = sample_scheduled_responsibility("r1", "auto-1");
    bots::storage::create_scheduled_responsibility(
        &conn,
        host,
        folder,
        "b1",
        responsibility,
        automation,
    )
    .unwrap();

    let result = call(&fx.engine, "bot.snapshot", fx.scope());
    assert!(result.ok, "{result:?}");
    let data = result.result.unwrap();
    let trigger = &data["bots"][0]["responsibilities"][0]["trigger"];
    assert_eq!(trigger["automationId"], json!("auto-1"), "{trigger:?}");
    assert_eq!(trigger["automation_id"], json!("auto-1"), "{trigger:?}");
}

/// P2-2 correction: mirrors the per-reference budget test
/// `snapshot_budget_counts_linked_payload_for_each_materialized_history_entry` in
/// ROOT-owned `native_bot_wire.rs`, against `automation_runs` (via `automationRunId`).
/// One 200KB linked record referenced by 4 rows is under budget once but 4x over; the
/// stored payload is deliberately invalid `AutomationRun` JSON, so `storage_error` would
/// expose a preflight under-count that let materialization run first.
#[test]
fn snapshot_budget_counts_linked_automation_run_payload_for_each_referencing_row() {
    let fx = Fixture::new();
    let host = fx.workspace["hostId"].as_str().unwrap();
    let folder = fx.workspace["path"].as_str().unwrap();
    fx.seed("b1", host, folder);

    let conn = fx.conn();
    let linked_payload = json!("x".repeat(200_000)).to_string();
    conn.execute(
        "INSERT INTO automation_runs (id, automation_id, payload_json) VALUES ('linked-run', 'some-auto', ?1)",
        rusqlite::params![linked_payload],
    )
    .unwrap();
    for index in 0..4 {
        let id = format!("run-{index}");
        let run = json!({
            "id":id, "botId":"b1", "responsibilityId":"duty",
            "automationId":null, "automationRunId":"linked-run",
            "startedAt":1.0, "endedAt":null, "recipe":null, "hostObservation":null,
        });
        conn.execute(
            "INSERT INTO bot_responsibility_runs
             (id, bot_id, automation_run_id, started_at, payload_json)
             VALUES (?1, 'b1', NULL, 1.0, ?2)",
            rusqlite::params![id, run.to_string()],
        )
        .unwrap();
    }
    assert!(linked_payload.len() < drogon_protocol::MAX_FRAME_BYTES / 2);
    assert!(linked_payload.len() * 4 > drogon_protocol::MAX_FRAME_BYTES / 2);

    let result = call(&fx.engine, "bot.snapshot", fx.scope());
    assert_eq!(
        result.error.as_ref().map(|e| e.code.as_str()),
        Some("snapshot_too_large"),
        "Budget each reference before loading malformed linked records: {result:?}",
    );
}

#[test]
fn snapshot_projects_home_when_provisioned_and_null_when_not() {
    let fx = Fixture::new();
    let host = fx.workspace["hostId"].as_str().unwrap();
    let created = call(
        &fx.engine,
        "bot.create",
        json!({
            "workspaceId": fx.workspace["id"],
            "hostId": host,
            "body": {
                "characterPreset": "none",
                "displayIdentity": {"displayName": "Arya", "handle": "arya", "title": null},
                "harnessPolicy": {"defaultHarness": "codex", "explicitModel": null},
                "instructions": "Guard the realm.",
                "memories": [],
            },
        }),
    );
    assert!(created.ok, "{created:?}");
    let bot_id = created.result.unwrap()["id"].as_str().unwrap().to_string();

    // Never provisioned: home is an explicit null, never invented.
    let data = call(&fx.engine, "bot.snapshot", fx.scope()).result.unwrap();
    assert!(data["bots"][0]["home"].is_null());

    // Provision (as the bot itself — the self API's actor fence).
    let provisioned = call(
        &fx.engine,
        "bot.self_provision",
        json!({
            "workspaceId": fx.workspace["id"],
            "hostId": host,
            "botId": bot_id,
            "actorBotId": bot_id,
        }),
    );
    assert!(provisioned.ok, "{provisioned:?}");
    let home_path = provisioned.result.unwrap()["path"]
        .as_str()
        .unwrap()
        .to_string();

    let data = call(&fx.engine, "bot.snapshot", fx.scope()).result.unwrap();
    let home = &data["bots"][0]["home"];
    assert_eq!(home["handle"], "arya");
    assert_eq!(home["path"], home_path);
    assert!(home["homeWorkspaceId"].as_str().is_some());
}
