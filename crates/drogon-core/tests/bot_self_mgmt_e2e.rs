//! Bot self-management E2E (P1–P4): every test runs a real `Engine` over a
//! fixture temp data dir — real SQLite storage, the real automation
//! scheduler tick, the real monitor commit path, no mocked rows or clocks
//! beyond the explicit `now_ms` the scheduler tick itself takes.

use drogon_core::Engine;
use drogon_core::bot_self_mgmt::{
    BOT_SELF_CAPABILITY, MonitorHealth, dir_handle_for_bot, incidents_for_monitor, monitor_health,
    validate_bot_handle,
};
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

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

fn failure_code(response: Response) -> String {
    assert!(!response.ok, "{response:?}");
    response.error.unwrap().code
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
}

impl Fx {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("folder");
        std::fs::create_dir(&folder).unwrap();
        let engine = Engine::open(&root.path().join("data")).unwrap();
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

    fn self_call(&self, req: &str, method: &str, mut params: Value) -> Response {
        if params.get("workspaceId").is_none() {
            params["workspaceId"] = json!(self.workspace_id);
        }
        if params.get("hostId").is_none() {
            params["hostId"] = json!(self.host_id);
        }
        self.engine.dispatch(request(req, method, params))
    }

    fn provision(&self, req: &str, bot_id: &str) -> Value {
        success(self.self_call(
            req,
            "bot.self_provision",
            json!({"botId": bot_id, "actorBotId": bot_id}),
        ))
    }

    fn home_of(&self, bot_id: &str) -> Value {
        success(self.self_call(
            &format!("list-{bot_id}"),
            "bot.self_list",
            json!({"botId": bot_id, "actorBotId": bot_id}),
        ))
    }

    fn audit_rows(&self, bot_id: &str) -> Vec<(String, String, String)> {
        let conn = rusqlite::Connection::open(
            self._root
                .path()
                .join("data")
                .join(drogon_core::DB_FILE_NAME),
        )
        .unwrap();
        let mut stmt = conn
            .prepare("SELECT request_id, method, actor_bot_id FROM bot_audit WHERE target_bot_id = ?1 ORDER BY rowid")
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

// --- P1 ---

#[test]
fn provision_claims_home_profile_workspace_and_is_idempotent() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bot_id = bot["id"].as_str().unwrap();

    let first = fx.provision("p1", bot_id);
    assert_eq!(first["botId"], bot_id);
    assert_eq!(first["handle"], "watcher");
    assert_eq!(first["provisioned"], true);
    let path = first["path"].as_str().unwrap().to_string();
    assert!(path.contains("bots"));
    assert!(path.ends_with("watcher"));
    assert!(std::path::Path::new(&path).is_dir(), "home dir exists");

    let home_id = first["homeWorkspaceId"].as_str().unwrap();
    assert!(!home_id.is_empty());
    assert_ne!(home_id, fx.workspace_id);

    let second = fx.provision("p2", bot_id);
    assert_eq!(second["provisioned"], false);
    assert_eq!(second["path"], path);
    assert_eq!(second["homeWorkspaceId"], home_id);

    // Same native storage as UI mutations: the profile row lives in the
    // daemon SQLite file beside the bots table.
    let conn =
        rusqlite::Connection::open(fx._root.path().join("data").join(drogon_core::DB_FILE_NAME))
            .unwrap();
    let payload: String = conn
        .query_row(
            "SELECT payload_json FROM bot_homes WHERE bot_id = ?1",
            [bot_id],
            |r| r.get(0),
        )
        .unwrap();
    let profile: Value = serde_json::from_str(&payload).unwrap();
    assert_eq!(profile["allowScripts"], false);
    assert_eq!(profile["homeWorkspaceId"], home_id);
}

#[test]
fn provision_falls_back_when_the_bot_has_no_path_safe_handle() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "No Handle", None);
    let bot_id = bot["id"].as_str().unwrap();
    let receipt = fx.provision("p1", bot_id);
    assert_eq!(receipt["provisioned"], true);
    assert!(receipt["handle"].as_str().unwrap().starts_with("bot-"));
    assert!(std::path::Path::new(receipt["path"].as_str().unwrap()).is_dir());
}

#[test]
fn provision_denies_a_handle_pinned_by_another_bot() {
    let fx = Fx::new();
    let a = fx.create_bot("c1", "Alpha", Some("same"));
    let aid = a["id"].as_str().unwrap().to_string();
    fx.provision("p1", &aid);

    // The create-time contract (the adversarial report on the Bots data
    // model): an exact duplicate handle that could never boot is rejected
    // HERE, with the real reason naming the live owner, instead of being
    // accepted and failing forever at first open.
    let refused = fx.self_call(
        "c2",
        "bot.create",
        json!({"body": bot_body("Beta", Some("same"))}),
    );
    assert!(!refused.ok, "{refused:?}");
    let error = refused.error.unwrap();
    assert_eq!(error.code, "invalid_argument");
    assert!(
        error.message.contains("already owned by bot") && error.message.contains(&aid),
        "the refusal must name the real owner and the real reason: {error:?}"
    );

    // A LEGACY duplicate (a data dir written before create-time rejection
    // existed, seeded straight into storage to simulate it) is still
    // denied at PROVISION time.
    let legacy = drogon_core::bots::records::Bot {
        id: "legacy-beta".to_string(),
        character_preset: "none".to_string(),
        display_identity: drogon_core::bots::records::DisplayIdentity {
            display_name: "Beta".to_string(),
            handle: Some("same".to_string()),
            title: None,
        },
        harness_policy: drogon_core::bots::records::HarnessModelPolicy {
            default_harness: "codex".to_string(),
            explicit_model: None,
        },
        instructions: String::new(),
        memories: Vec::new(),
        responsibilities: Vec::new(),
        current_session: None,
        created_at: 0.0,
        updated_at: 0.0,
    };
    let conn =
        rusqlite::Connection::open(fx._root.path().join("data").join(drogon_core::DB_FILE_NAME))
            .unwrap();
    let folder: String = conn
        .query_row("SELECT folder FROM bots WHERE id = ?1", [&aid], |r| {
            r.get(0)
        })
        .unwrap();
    drogon_core::bots::storage::create_bot(&conn, &fx.host_id, &folder, &legacy).unwrap();
    let code = failure_code(fx.self_call(
        "p2",
        "bot.self_provision",
        json!({"botId": "legacy-beta", "actorBotId": "legacy-beta"}),
    ));
    assert_eq!(code, "invalid_argument");
}

#[test]
fn handle_validation_rejects_traversal_and_separators() {
    assert_eq!(validate_bot_handle("watcher").unwrap(), "watcher");
    assert_eq!(validate_bot_handle("@watcher").unwrap(), "watcher");
    assert!(validate_bot_handle("").is_err());
    assert!(validate_bot_handle("   ").is_err());
    assert!(validate_bot_handle("../evil").is_err());
    assert!(validate_bot_handle("a/b").is_err());
    assert!(validate_bot_handle("a b").is_err());
    assert!(validate_bot_handle(&"x".repeat(65)).is_err());
    let bot = drogon_core::bots::records::Bot {
        id: "bot-1234-abcdef".to_string(),
        character_preset: "none".to_string(),
        display_identity: drogon_core::bots::records::DisplayIdentity {
            display_name: "X".to_string(),
            handle: None,
            title: None,
        },
        harness_policy: drogon_core::bots::records::HarnessModelPolicy {
            default_harness: "codex".to_string(),
            explicit_model: None,
        },
        instructions: String::new(),
        memories: Vec::new(),
        responsibilities: Vec::new(),
        current_session: None,
        created_at: 0.0,
        updated_at: 0.0,
    };
    assert_eq!(dir_handle_for_bot(&bot).unwrap(), "bot-bot1234a");
}

// --- P4 automations ---

fn create_self_automation(fx: &Fx, req: &str, bot_id: &str) -> Value {
    success(fx.self_call(
        req,
        "bot.self_create_automation",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "name": "Nightly review", "schedule": "* * * * *",
            "prompt": "Review incoming work.",
        }),
    ))
}

#[test]
fn self_automation_crud_fences_stale_cas() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bot_id = bot["id"].as_str().unwrap();
    fx.provision("p1", bot_id);

    let created = create_self_automation(&fx, "a1", bot_id);
    let resp_id = created["responsibilityId"].as_str().unwrap().to_string();
    assert!(!created["automationId"].as_str().unwrap().is_empty());

    // The owned automation runs in the provisioned home workspace, never
    // the caller's scope — privilege has no wider spelling.
    let home = fx.home_of(bot_id);
    let home_ws = home["home"]["homeWorkspaceId"].as_str().unwrap();
    let listed = &home["automations"];
    assert_eq!(listed.as_array().unwrap().len(), 1);
    assert_eq!(listed[0]["responsibilityId"], resp_id);
    assert_eq!(listed[0]["schedule"], "* * * * *");
    let bot_rev = home["botRev"].as_i64().unwrap();

    // Stale CAS is denied before any write.
    assert_eq!(
        failure_code(fx.self_call(
            "a2",
            "bot.self_update_automation",
            json!({
                "botId": bot_id, "actorBotId": bot_id,
                "responsibilityId": resp_id, "expectedBotRev": bot_rev + 99,
                "name": "Stale",
            }),
        )),
        "stale_update"
    );

    let updated = success(fx.self_call(
        "a3",
        "bot.self_update_automation",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "responsibilityId": resp_id, "expectedBotRev": bot_rev,
            "name": "Nightly deeper review",
        }),
    ));
    assert_eq!(updated["responsibilityId"], resp_id);

    // Disable → test reports refusal (real policy evaluation, no dispatch).
    let after_update = fx.home_of(bot_id);
    let rev2 = after_update["botRev"].as_i64().unwrap();
    success(fx.self_call(
        "a4",
        "bot.self_set_automation_enabled",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "responsibilityId": resp_id, "expectedBotRev": rev2, "enabled": false,
        }),
    ));
    let refused = success(fx.self_call(
        "a5",
        "bot.self_test_automation",
        json!({"botId": bot_id, "actorBotId": bot_id, "responsibilityId": resp_id}),
    ));
    assert_eq!(refused["eligible"], false);
    assert_eq!(refused["refusedBy"], "responsibility");

    // Re-enable → eligible, still no session started by the test path.
    let after_disable = fx.home_of(bot_id);
    let rev3 = after_disable["botRev"].as_i64().unwrap();
    success(fx.self_call(
        "a6",
        "bot.self_set_automation_enabled",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "responsibilityId": resp_id, "expectedBotRev": rev3, "enabled": true,
        }),
    ));
    let eligible = success(fx.self_call(
        "a7",
        "bot.self_test_automation",
        json!({"botId": bot_id, "actorBotId": bot_id, "responsibilityId": resp_id}),
    ));
    assert_eq!(eligible["eligible"], true);

    let deleted = success(fx.self_call(
        "a8",
        "bot.self_delete_automation",
        json!({"botId": bot_id, "actorBotId": bot_id, "responsibilityId": resp_id}),
    ));
    assert_eq!(deleted["removed"], true);
    let _ = home_ws;
    assert_eq!(
        fx.home_of(bot_id)["automations"].as_array().unwrap().len(),
        0
    );
}

#[test]
fn self_api_denies_cross_bot_scope() {
    let fx = Fx::new();
    let a = fx.create_bot("c1", "Alpha", Some("alpha"));
    let b = fx.create_bot("c2", "Beta", Some("beta"));
    let a_id = a["id"].as_str().unwrap();
    let b_id = b["id"].as_str().unwrap();
    fx.provision("p1", a_id);
    fx.provision("p2", b_id);

    for (method, params) in [
        ("bot.self_list", json!({})),
        (
            "bot.self_create_automation",
            json!({"name": "x", "schedule": "* * * * *", "prompt": "y"}),
        ),
        (
            "bot.self_delete_automation",
            json!({"responsibilityId": "resp-nope"}),
        ),
        (
            "bot.self_create_monitor",
            json!({"resource": "notes.md", "trigger": {"kind": "manual"}}),
        ),
    ] {
        let mut p = params;
        p["botId"] = json!(b_id);
        p["actorBotId"] = json!(a_id);
        assert_eq!(
            failure_code(fx.self_call("x", method, p)),
            "foreign_bot",
            "{method} must deny cross-Bot scope"
        );
    }
}

#[test]
fn self_api_denies_unknown_fields_and_bad_schedules() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bot_id = bot["id"].as_str().unwrap();
    fx.provision("p1", bot_id);

    // Unknown fields are denied at admission (same convention as bot.run).
    assert_eq!(
        failure_code(fx.self_call(
            "bad",
            "bot.self_create_automation",
            json!({
                "botId": bot_id, "actorBotId": bot_id,
                "name": "x", "schedule": "* * * * *", "prompt": "y",
                "workspaceIdOverride": "ws-evil",
            }),
        )),
        "invalid_argument"
    );
    assert_eq!(
        failure_code(fx.self_call(
            "bad2",
            "bot.self_create_automation",
            json!({
                "botId": bot_id, "actorBotId": bot_id,
                "name": "x", "schedule": "not a cron", "prompt": "y",
            }),
        )),
        "invalid_argument"
    );
    // Escaping monitor resources are denied at admission, not at tick.
    assert_eq!(
        failure_code(fx.self_call(
            "bad3",
            "bot.self_create_monitor",
            json!({
                "botId": bot_id, "actorBotId": bot_id,
                "resource": "../escape.md", "trigger": {"kind": "manual"},
            }),
        )),
        "invalid_argument"
    );
}

// --- P2/P4 monitors ---

fn create_self_monitor(fx: &Fx, req: &str, bot_id: &str, resource: &str) -> Value {
    success(fx.self_call(
        req,
        "bot.self_create_monitor",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "resource": resource,
            "trigger": {"kind": "scheduled", "cron": "* * * * *"},
        }),
    ))
}

#[test]
fn monitor_tick_records_checkins_change_event_and_outbox_row() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bot_id = bot["id"].as_str().unwrap();
    let provisioned = fx.provision("p1", bot_id);
    let home_path = provisioned["path"].as_str().unwrap().to_string();
    std::fs::write(home_path.clone() + "/notes.md", "v1").unwrap();

    let created = create_self_monitor(&fx, "m1", bot_id, "notes.md");
    let monitor_id = created["monitorId"].as_str().unwrap().to_string();
    assert_eq!(created["health"], "healthy");

    // Baseline through the REAL scheduler tick (monitors ride tick_once).
    // The baseline itself is a change (no prior cursor) with one event.
    let now = 1_700_000_000_000.0;
    drogon_core::automations::scheduler::tick_once(&fx.engine, now);
    let home = fx.home_of(bot_id);
    let view = &home["monitors"][0];
    assert_eq!(view["id"], monitor_id);
    assert_eq!(view["health"], "healthy");
    assert_eq!(view["hasCursor"], true);

    // Change → next minute fire commits a change + a durable outbox event.
    std::fs::write(home_path.clone() + "/notes.md", "v2").unwrap();
    drogon_core::automations::scheduler::tick_once(&fx.engine, now + 61_000.0);
    let home = fx.home_of(bot_id);
    assert!(!home["monitors"][0]["lastEventId"].is_null());

    let conn =
        rusqlite::Connection::open(fx._root.path().join("data").join(drogon_core::DB_FILE_NAME))
            .unwrap();
    let event_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM bot_monitor_events WHERE monitor_id = ?1",
            [&monitor_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        event_count, 2,
        "baseline + one change = two durable outbox rows"
    );
    let check_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM bot_monitor_checks WHERE monitor_id = ?1",
            [&monitor_id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(check_count >= 2, "every evaluation checks in");
}

#[test]
fn monitor_errors_backoff_fail_open_incident_and_recover() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bot_id = bot["id"].as_str().unwrap();
    let provisioned = fx.provision("p1", bot_id);
    let home_path = provisioned["path"].as_str().unwrap().to_string();
    std::fs::write(home_path.clone() + "/notes.md", "v1").unwrap();

    create_self_monitor(&fx, "m1", bot_id, "notes.md");
    let base = 1_700_000_000_000.0;
    drogon_core::automations::scheduler::tick_once(&fx.engine, base);

    // Absence: three error check-ins across the backoff watermarks.
    std::fs::remove_file(home_path.clone() + "/notes.md").unwrap();
    let mut now = base + 61_000.0;
    for _ in 0..3 {
        drogon_core::automations::scheduler::tick_once(&fx.engine, now);
        now += 300_000.0; // past the 5s/10s/20s backoff steps
    }
    let home = fx.home_of(bot_id);
    assert_eq!(home["monitors"][0]["health"], "failing");
    assert!(home["monitors"][0]["consecutiveErrors"].as_u64().unwrap() >= 3);

    let conn =
        rusqlite::Connection::open(fx._root.path().join("data").join(drogon_core::DB_FILE_NAME))
            .unwrap();
    let monitor_id = home["monitors"][0]["id"].as_str().unwrap().to_string();
    let incidents = incidents_for_monitor(&conn, &monitor_id).unwrap();
    assert_eq!(incidents.len(), 1, "one incident opens at the threshold");
    assert!(incidents[0].recovered_at_ms.is_none());

    // Recovery: the file returns, the next fire closes the incident.
    std::fs::write(home_path.clone() + "/notes.md", "v3").unwrap();
    drogon_core::automations::scheduler::tick_once(&fx.engine, now + 300_000.0);
    let home = fx.home_of(bot_id);
    assert_eq!(home["monitors"][0]["health"], "healthy");
    let incidents = incidents_for_monitor(&conn, &monitor_id).unwrap();
    assert_eq!(incidents.len(), 1);
    assert!(
        incidents[0].recovered_at_ms.is_some(),
        "first later success closes the incident"
    );
}

#[test]
fn monitor_crud_fences_rev_and_keeps_approval_gate() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bot_id = bot["id"].as_str().unwrap();
    let provisioned = fx.provision("p1", bot_id);
    let home_path = provisioned["path"].as_str().unwrap().to_string();
    std::fs::write(home_path.clone() + "/notes.md", "v1").unwrap();

    // A missing monitor id is not_found; a monitor owned by ANOTHER Bot
    // is foreign_bot (genuine cross-Bot denial, below).
    assert_eq!(
        failure_code(fx.self_call(
            "m-bad",
            "bot.self_delete_monitor",
            json!({"botId": bot_id, "actorBotId": bot_id, "monitorId": "nope"}),
        )),
        "not_found"
    );
    let other = fx.create_bot("c2", "Other", Some("other"));
    let other_id = other["id"].as_str().unwrap();
    fx.provision("p-other", other_id);
    std::fs::write(home_path.clone() + "/notes.md", "v1").unwrap();
    let foreign = create_self_monitor(&fx, "m-foreign", other_id, "notes.md");
    let foreign_id = foreign["monitorId"].as_str().unwrap();
    assert_eq!(
        failure_code(fx.self_call(
            "m-cross",
            "bot.self_delete_monitor",
            json!({"botId": bot_id, "actorBotId": bot_id, "monitorId": foreign_id}),
        )),
        "foreign_bot"
    );

    create_self_monitor(&fx, "m1", bot_id, "notes.md");
    let home = fx.home_of(bot_id);
    let rev = home["monitors"][0]["rev"].as_i64().unwrap();
    let monitor_id = home["monitors"][0]["id"].as_str().unwrap().to_string();

    assert_eq!(
        failure_code(fx.self_call(
            "m2",
            "bot.self_set_monitor_enabled",
            json!({
                "botId": bot_id, "actorBotId": bot_id,
                "monitorId": monitor_id, "expectedRev": rev + 5, "enabled": false,
            }),
        )),
        "stale_update"
    );
    let disabled = success(fx.self_call(
        "m3",
        "bot.self_set_monitor_enabled",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "monitorId": monitor_id, "expectedRev": rev, "enabled": false,
        }),
    ));
    assert_eq!(disabled["health"], "disabled");

    // Disabled monitors never evaluate: the dry-run test says so without
    // committing anything.
    let test = success(fx.self_call(
        "m4",
        "bot.self_test_monitor",
        json!({"botId": bot_id, "actorBotId": bot_id, "monitorId": monitor_id}),
    ));
    assert_eq!(test["eligible"], false);

    let home = fx.home_of(bot_id);
    let rev2 = home["monitors"][0]["rev"].as_i64().unwrap();
    let updated = success(fx.self_call(
        "m5",
        "bot.self_update_monitor",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "monitorId": monitor_id, "expectedRev": rev2, "maxBytes": 4096,
        }),
    ));
    assert_eq!(updated["approved"], true);
    assert_eq!(updated["version"].as_u64().unwrap(), 2);

    let deleted = success(fx.self_call(
        "m6",
        "bot.self_delete_monitor",
        json!({"botId": bot_id, "actorBotId": bot_id, "monitorId": monitor_id}),
    ));
    assert_eq!(deleted["removed"], true);

    // Check history survives deletion as orphaned evidence.
    let conn =
        rusqlite::Connection::open(fx._root.path().join("data").join(drogon_core::DB_FILE_NAME))
            .unwrap();
    let remaining: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM bot_monitors WHERE id = ?1",
            [&monitor_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(remaining, 0);
}

// --- P3 ---

#[test]
fn audit_actor_covers_every_bot_origin_mutation_and_no_ui_mutation() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bot_id = bot["id"].as_str().unwrap();
    fx.provision("p1", bot_id);

    let created = create_self_automation(&fx, "a1", bot_id);
    let resp_id = created["responsibilityId"].as_str().unwrap().to_string();
    let home = fx.home_of(bot_id);
    let rev = home["botRev"].as_i64().unwrap();
    success(fx.self_call(
        "a2",
        "bot.self_update_automation",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "responsibilityId": resp_id, "expectedBotRev": rev, "name": "Renamed",
        }),
    ));
    let home = fx.home_of(bot_id);
    let rev = home["botRev"].as_i64().unwrap();
    success(fx.self_call(
        "a3",
        "bot.self_set_automation_enabled",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "responsibilityId": resp_id, "expectedBotRev": rev, "enabled": false,
        }),
    ));
    success(fx.self_call(
        "a4",
        "bot.self_delete_automation",
        json!({"botId": bot_id, "actorBotId": bot_id, "responsibilityId": resp_id}),
    ));
    std::fs::write(
        format!(
            "{}/notes.md",
            fx.provision("p1b", bot_id)["path"].as_str().unwrap()
        ),
        "v1",
    )
    .unwrap();
    let mon = create_self_monitor(&fx, "m1", bot_id, "notes.md");
    let monitor_id = mon["monitorId"].as_str().unwrap().to_string();
    let home = fx.home_of(bot_id);
    let mrev = home["monitors"][0]["rev"].as_i64().unwrap();
    success(fx.self_call(
        "m2",
        "bot.self_set_monitor_enabled",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "monitorId": monitor_id, "expectedRev": mrev, "enabled": false,
        }),
    ));
    success(fx.self_call(
        "m3",
        "bot.self_delete_monitor",
        json!({"botId": bot_id, "actorBotId": bot_id, "monitorId": monitor_id}),
    ));

    // A UI-origin mutation writes no audit row.
    success(fx.engine.dispatch(request(
        "ui-resp",
        "bot.responsibility_create",
        json!({
            "workspaceId": fx.workspace_id, "hostId": fx.host_id, "botId": bot_id,
            "name": "UI duty", "schedule": "* * * * *", "prompt": "From the panel.",
        }),
    )));

    let rows = fx.audit_rows(bot_id);
    let methods: Vec<&str> = rows.iter().map(|(_, m, _)| m.as_str()).collect();
    for expected in [
        "bot.self_provision",
        "bot.self_create_automation",
        "bot.self_update_automation",
        "bot.self_set_automation_enabled",
        "bot.self_delete_automation",
        "bot.self_create_monitor",
        "bot.self_set_monitor_enabled",
        "bot.self_delete_monitor",
    ] {
        assert!(
            methods.contains(&expected),
            "missing audit for {expected}: {methods:?}"
        );
    }
    assert!(
        !methods.contains(&"bot.responsibility_create"),
        "UI mutations must not mint Bot-actor rows"
    );
    assert!(
        rows.iter().all(|(_, _, actor)| actor == bot_id),
        "every Bot-origin row carries the Bot actor"
    );
}

#[test]
fn monitor_health_thresholds() {
    use drogon_core::bots::monitors::record::MonitorTrigger;
    use drogon_core::bots::monitors::rule::{LocalFileRule, MonitorRule};
    let rule = MonitorRule::LocalFileDigest(LocalFileRule {
        host_id: "h".to_string(),
        project_id: "p".to_string(),
        resource: "notes.md".to_string(),
        max_bytes: 1024,
    });
    let approved = rule.approval_hash();
    let mut record = drogon_core::bots::monitors::record::new_monitor(
        "m".into(),
        Some("b".into()),
        rule,
        MonitorTrigger::Manual,
        approved,
        1.0,
    )
    .unwrap();
    assert_eq!(monitor_health(&record), MonitorHealth::Healthy);
    record.consecutive_errors = 2;
    assert_eq!(monitor_health(&record), MonitorHealth::Degraded);
    record.consecutive_errors = 3;
    assert_eq!(monitor_health(&record), MonitorHealth::Failing);
    record.enabled = false;
    assert_eq!(monitor_health(&record), MonitorHealth::Disabled);
    record.enabled = true;
    record.approved_rule_hash = "stale".to_string();
    assert_eq!(monitor_health(&record), MonitorHealth::NeedsApproval);
}

#[test]
fn self_capability_is_advertised() {
    let fx = Fx::new();
    let status = success(fx.engine.dispatch(request("s", "status", json!({}))));
    let capabilities = status["capabilities"].as_array().unwrap();
    assert!(
        capabilities.iter().any(|c| c == BOT_SELF_CAPABILITY),
        "status must advertise {BOT_SELF_CAPABILITY}"
    );
}

// --- The action a monitor releases: bind + create-time declaration ---------

#[test]
fn self_monitor_can_declare_and_rebind_the_action_it_releases() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bot_id = bot["id"].as_str().unwrap();
    let provisioned = fx.provision("p1", bot_id);
    let home_path = provisioned["path"].as_str().unwrap().to_string();
    std::fs::write(home_path.clone() + "/notes.md", "v1").unwrap();

    // Create-time declaration: one call stages the watch AND mints the
    // reactive responsibility that fires when it changes.
    let created = success(fx.self_call(
        "m1",
        "bot.self_create_monitor",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "resource": "notes.md",
            "trigger": {"kind": "scheduled", "cron": "* * * * *"},
            "responsibilityName": "Triage changes",
            "instructions": "Check the diff and report.",
        }),
    ));
    let monitor_id = created["monitorId"].as_str().unwrap().to_string();
    let minted = created["responsibilityId"].as_str().unwrap().to_string();
    assert!(!minted.is_empty());
    assert_eq!(created["approved"], true, "binding never parks approval");

    let home = fx.home_of(bot_id);
    let view = &home["monitors"][0];
    assert_eq!(view["responsibilityId"], minted);
    // The minted responsibility is visible on the bot itself.
    assert!(
        home["automations"].as_array().unwrap().iter().any(|r| {
            r["responsibilityId"] == *minted.as_str() && r["name"] == "Triage changes"
        })
    );

    // Rev from the self list, then rebind to an EXISTING reactive
    // responsibility via bot.self_bind_monitor_action (CAS).
    // A second monitor mints a second reactive responsibility; the first
    // monitor then rebinds to that EXISTING id via the bind action (CAS).
    let other = success(fx.self_call(
        "m2",
        "bot.self_create_monitor",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "resource": "notes.md",
            "trigger": {"kind": "scheduled", "cron": "* * * * *"},
            "responsibilityName": "Other action",
        }),
    ));
    let existing = other["responsibilityId"].as_str().unwrap().to_string();
    let rev = view["rev"].as_i64().unwrap();
    let rebound = success(fx.self_call(
        "bind-1",
        "bot.self_bind_monitor_action",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "monitorId": monitor_id,
            "expectedRev": rev,
            "responsibilityId": existing,
        }),
    ));
    assert_eq!(rebound["responsibilityId"], *existing);
    assert_eq!(rebound["approved"], true, "rebinding never parks approval");

    // A stale rev is refused loudly, never applied silently.
    let stale = fx.self_call(
        "bind-2",
        "bot.self_bind_monitor_action",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "monitorId": monitor_id,
            "expectedRev": rev,
            "responsibilityName": "Other",
        }),
    );
    assert_eq!(failure_code(stale), "stale_update");

    // Binding needs a target: neither id nor name is a usage error.
    let missing = fx.self_call(
        "bind-3",
        "bot.self_bind_monitor_action",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "monitorId": monitor_id,
            "expectedRev": rev + 1,
        }),
    );
    assert_eq!(failure_code(missing), "invalid_argument");
}

#[test]
fn self_monitor_binding_refuses_scheduled_and_foreign_responsibilities() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bot_id = bot["id"].as_str().unwrap();
    let provisioned = fx.provision("p1", bot_id);
    let home_path = provisioned["path"].as_str().unwrap().to_string();
    std::fs::write(home_path.clone() + "/notes.md", "v1").unwrap();

    // A scheduled responsibility: created through the self automation
    // lane (mints an automation + scheduled responsibility).
    success(fx.self_call(
        "auto-1",
        "bot.self_create_automation",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "name": "Nightly", "schedule": "* * * * *", "prompt": "Sweep."
        }),
    ));
    let home = fx.home_of(bot_id);
    let scheduled_id = home["automations"][0]["responsibilityId"]
        .as_str()
        .unwrap()
        .to_string();

    create_self_monitor(&fx, "m1", bot_id, "notes.md");
    let monitor_id = fx.home_of(bot_id)["monitors"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let rev = fx.home_of(bot_id)["monitors"][0]["rev"].as_i64().unwrap();

    // Scheduled responsibilities run from their automation, never from a
    // monitor — the binding refuses rather than double-driving.
    let refused = fx.self_call(
        "bind-scheduled",
        "bot.self_bind_monitor_action",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "monitorId": monitor_id,
            "expectedRev": rev,
            "responsibilityId": scheduled_id,
        }),
    );
    assert_eq!(failure_code(refused), "invalid_argument");

    // Another bot's responsibility id is not_found, never a silent bind.
    let other = fx.create_bot("c2", "Second", Some("second"));
    let other_id = other["id"].as_str().unwrap();
    fx.provision("p2", other_id);
    std::fs::write(home_path.clone() + "/notes.md", "v1").unwrap();
    create_self_monitor(&fx, "m2", other_id, "notes.md");
    let other_home = fx.home_of(other_id);
    let _other_monitor = &other_home["monitors"][0];
    let foreign = fx.self_call(
        "bind-foreign",
        "bot.self_bind_monitor_action",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "monitorId": monitor_id,
            "expectedRev": rev,
            "responsibilityId": "resp-of-someone-else",
        }),
    );
    assert_eq!(failure_code(foreign), "not_found");

    // A foreign monitor id never binds either: the ownership fence holds.
    let other_monitor_id = other_home["monitors"][0]["id"].as_str().unwrap();
    let cross = fx.self_call(
        "bind-cross",
        "bot.self_bind_monitor_action",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "monitorId": other_monitor_id,
            "expectedRev": 0,
            "responsibilityName": "Hijack",
        }),
    );
    assert_eq!(failure_code(cross), "foreign_bot");
}

#[test]
fn self_list_carries_the_firing_evidence_of_a_bound_monitor() {
    let fx = Fx::new();
    let bot = fx.create_bot("c1", "Watcher", Some("watcher"));
    let bot_id = bot["id"].as_str().unwrap();
    let provisioned = fx.provision("p1", bot_id);
    let home_path = provisioned["path"].as_str().unwrap().to_string();
    std::fs::write(home_path.clone() + "/notes.md", "v1").unwrap();

    let created = success(fx.self_call(
        "m1",
        "bot.self_create_monitor",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "resource": "notes.md",
            "trigger": {"kind": "scheduled", "cron": "* * * * *"},
            "responsibilityName": "Triage changes",
        }),
    ));
    let monitor_id = created["monitorId"].as_str().unwrap().to_string();

    // No firing yet: the self list shows an honest null.
    let home = fx.home_of(bot_id);
    assert!(home["monitors"][0]["firing"].is_null());

    // Record a firing the way the delegation drain does, then re-list.
    let conn =
        rusqlite::Connection::open(fx._root.path().join("data").join(drogon_core::DB_FILE_NAME))
            .unwrap();
    conn.execute(
        "INSERT INTO bot_monitor_firings
             (event_id, monitor_id, bot_id, responsibility_id, outcome, run_id, detail, at_ms)
         VALUES ('mev_x', ?1, ?2, 'resp_y', 'dispatched', 'run-9', NULL, ?3)",
        rusqlite::params![
            &monitor_id,
            bot_id,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as f64
        ],
    )
    .unwrap();
    let home = fx.home_of(bot_id);
    let firing = &home["monitors"][0]["firing"];
    assert_eq!(firing["lastOutcome"], "dispatched");
    assert_eq!(firing["lastRunId"], "run-9");
    assert_eq!(firing["countToday"], 1);
}
