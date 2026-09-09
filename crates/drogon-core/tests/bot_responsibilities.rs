//! Tests for `bot.responsibility_create` / `bot.responsibility_delete`
//! (R7-E): a scheduled responsibility is an automation owned by the Bot,
//! fired by the existing scheduler, with snapshot/history evidence.
//!
//! All dispatched calls go through the real `Engine::dispatch` end to end
//! (ledger atomicity, workspace scope, replay). The scheduled fire uses
//! the same fixture-`pi`-on-`PATH` harness as `automation_scheduler.rs`:
//! a shell stub that prints and exits 0, never real model inference.

use std::time::Duration;

use drogon_core::Engine;
use drogon_core::automations::scheduler;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response, RpcError};
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

fn ok(response: Response) -> Value {
    assert!(response.ok, "{response:?}");
    response.result.unwrap()
}

fn err(response: Response) -> RpcError {
    assert!(!response.ok, "expected error, got {response:?}");
    response.error.unwrap()
}

struct Fixture {
    _dir: tempfile::TempDir,
    engine: Engine,
    workspace_id: String,
    host_id: String,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::open(dir.path()).unwrap();
        let folder = dir.path().join("folder");
        std::fs::create_dir(&folder).unwrap();
        let registered = ok(engine.dispatch(request(
            "ws-register",
            "workspace.register",
            json!({"path": folder}),
        )));
        Self {
            _dir: dir,
            workspace_id: registered["id"].as_str().unwrap().to_string(),
            host_id: registered["hostId"].as_str().unwrap().to_string(),
            engine,
        }
    }

    fn create_bot(&self, id: &str, harness: &str) -> Value {
        ok(self.engine.dispatch(request(
            id,
            "bot.create",
            json!({
                "workspaceId": self.workspace_id,
                "hostId": self.host_id,
                "body": {
                    "characterPreset": "none",
                    "displayIdentity": {"displayName": "Watcher", "handle": null, "title": null},
                    "harnessPolicy": {"defaultHarness": harness, "explicitModel": null},
                    "instructions": "Guard the realm.",
                    "memories": [],
                },
            }),
        )))
    }

    fn create_responsibility(&self, id: &str, bot_id: &str, schedule: &str) -> Value {
        ok(self.engine.dispatch(request(
            id,
            "bot.responsibility_create",
            json!({
                "workspaceId": self.workspace_id,
                "hostId": self.host_id,
                "botId": bot_id,
                "name": "Nightly review",
                "schedule": schedule,
                "prompt": "Review incoming work.",
            }),
        )))
    }

    fn snapshot(&self) -> Value {
        ok(self.engine.dispatch(request(
            &uuid::Uuid::new_v4().to_string(),
            "bot.snapshot",
            json!({
                "workspaceId": self.workspace_id,
                "hostId": self.host_id,
                "locale": "en-US",
            }),
        )))
    }
}

/// Fixture harness: an executable named `pi` on `PATH` that prints and
/// exits 0 -- the demo harness, never real model inference. Same shape as
/// `automation_scheduler.rs`'s fixture (per-process dir, `Once`-guarded).
fn ensure_fixture_harness_on_path() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let dir =
            std::env::temp_dir().join(format!("drogon-bot-resp-fixture-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pi = dir.join("pi");
        std::fs::write(&pi, "#!/bin/sh\necho bot-fixture-output\nexit 0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&pi, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let old = std::env::var_os("PATH").unwrap_or_default();
        let mut paths = vec![dir.into_os_string()];
        paths.extend(std::env::split_paths(&old).map(|p| p.into_os_string()));
        unsafe {
            std::env::set_var("PATH", std::env::join_paths(paths).unwrap());
        }
    });
}

#[test]
fn create_delete_snapshot_round_trip_with_orphaned_history() {
    ensure_fixture_harness_on_path();
    let fx = Fixture::new();
    let bot = fx.create_bot("bot-1", "pi");
    let bot_id = bot["id"].as_str().unwrap().to_string();

    let created = fx.create_responsibility("resp-create-1", &bot_id, "* * * * *");
    assert_eq!(created["hostId"], json!(fx.host_id));
    assert_eq!(created["workspaceId"], json!(fx.workspace_id));
    assert_eq!(created["botId"], json!(bot_id));
    let responsibility_id = created["responsibilityId"].as_str().unwrap().to_string();
    let automation_id = created["automationId"].as_str().unwrap().to_string();

    // Snapshot carries the responsibility with its scheduled trigger, and
    // the owned automation is a real scheduler row (cron honored).
    let snapshot = fx.snapshot();
    let bots = snapshot["bots"].as_array().unwrap();
    assert_eq!(bots.len(), 1);
    let responsibilities = bots[0]["responsibilities"].as_array().unwrap();
    assert_eq!(responsibilities.len(), 1);
    assert_eq!(responsibilities[0]["id"], json!(responsibility_id));
    assert_eq!(responsibilities[0]["name"], json!("Nightly review"));
    assert_eq!(
        responsibilities[0]["instructions"],
        json!("Review incoming work.")
    );
    assert_eq!(responsibilities[0]["kind"], json!("scheduled"));
    assert_eq!(
        responsibilities[0]["trigger"],
        json!({"kind": "scheduled", "automation_id": automation_id, "automationId": automation_id})
    );

    let listed = ok(fx
        .engine
        .dispatch(request("auto-list", "automation.list", json!({}))));
    let autos = listed["automations"].as_array().unwrap();
    assert_eq!(autos.len(), 1);
    assert_eq!(autos[0]["id"], json!(automation_id));
    assert_eq!(autos[0]["cron"], json!("* * * * *"));
    assert_eq!(autos[0]["harness"], json!("pi"));
    assert!(autos[0]["nextRunAt"].as_f64().unwrap() > 0.0);

    // A manual run through the real seam records a responsibility run the
    // snapshot history joins with live names.
    let run = ok(fx.engine.dispatch(request(
        "manual-1",
        "bot.run",
        json!({
            "workspaceId": fx.workspace_id,
            "hostId": fx.host_id,
            "botId": bot_id,
            "responsibilityId": responsibility_id,
            "reason": "manual",
            "eventIdentity": "manual:1",
            "harness": {"harnessId": "pi"},
        }),
    )));
    assert_eq!(run["outcome"], json!("dispatched"));
    assert!(run["responsibilityRunId"].as_str().is_some());

    let history = fx.snapshot()["history"].clone();
    let entries = history.as_array().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["responsibilityName"], json!("Nightly review"));
    assert_eq!(entries[0]["automationName"], json!("Nightly review"));
    // A manual `bot.run` stamps a manual invocation on the run row.
    assert_eq!(
        entries[0]["run"]["responsibilityId"],
        json!(responsibility_id)
    );
    assert_eq!(entries[0]["run"]["invocation"], json!("manual"));
    // The linked automation run projects the fork's verdict and per-
    // automation ordinal for the row's `status · runRef` evidence line.
    assert_eq!(entries[0]["automationRunNumber"].as_f64(), Some(1.0));
    assert!(entries[0]["automationRunStatus"].as_str().is_some());

    // Delete removes the projection and the still-Bot-owned automation
    // (runs included) but preserves the responsibility-run row as
    // orphaned evidence with null joins.
    let deleted = ok(fx.engine.dispatch(request(
        "resp-delete-1",
        "bot.responsibility_delete",
        json!({
            "workspaceId": fx.workspace_id,
            "hostId": fx.host_id,
            "botId": bot_id,
            "responsibilityId": responsibility_id,
        }),
    )));
    assert_eq!(deleted["removed"], json!(true));
    assert_eq!(deleted["automationId"], json!(automation_id));

    let after = fx.snapshot();
    assert!(
        after["bots"].as_array().unwrap()[0]["responsibilities"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let listed = ok(fx
        .engine
        .dispatch(request("auto-list-2", "automation.list", json!({}))));
    assert!(listed["automations"].as_array().unwrap().is_empty());
    let history = after["history"].clone();
    let entries = history.as_array().unwrap();
    assert_eq!(entries.len(), 1);
    assert!(entries[0].get("responsibilityName").unwrap().is_null());
    assert!(entries[0].get("automationName").unwrap().is_null());
    assert!(entries[0].get("automationRunStatus").unwrap().is_null());
}

#[test]
fn create_rejects_bad_input_unknown_bot_and_unknown_workspace() {
    let fx = Fixture::new();
    let bot = fx.create_bot("bot-1", "pi");
    let bot_id = bot["id"].as_str().unwrap().to_string();
    let base = || {
        json!({
            "workspaceId": fx.workspace_id,
            "hostId": fx.host_id,
            "botId": bot_id,
            "name": "Nightly review",
            "schedule": "* * * * *",
            "prompt": "Review incoming work.",
        })
    };

    let mut bad_cron = base();
    bad_cron["schedule"] = json!("FREQ=DAILY;BYHOUR=9");
    assert_eq!(
        err(fx
            .engine
            .dispatch(request("bad-cron", "bot.responsibility_create", bad_cron)))
        .code,
        "invalid_argument"
    );

    let mut empty_name = base();
    empty_name["name"] = json!("   ");
    assert_eq!(
        err(fx
            .engine
            .dispatch(request("bad-name", "bot.responsibility_create", empty_name)))
        .code,
        "invalid_argument"
    );

    let mut empty_prompt = base();
    empty_prompt["prompt"] = json!("");
    assert_eq!(
        err(fx.engine.dispatch(request(
            "bad-prompt",
            "bot.responsibility_create",
            empty_prompt
        )))
        .code,
        "invalid_argument"
    );

    let mut missing_bot = base();
    missing_bot["botId"] = json!("no-such-bot");
    assert_eq!(
        err(fx
            .engine
            .dispatch(request("bad-bot", "bot.responsibility_create", missing_bot)))
        .code,
        "not_found"
    );

    let mut missing_ws = base();
    missing_ws["workspaceId"] = json!("no-such-workspace");
    assert_eq!(
        err(fx
            .engine
            .dispatch(request("bad-ws", "bot.responsibility_create", missing_ws)))
        .code,
        "unknown_workspace"
    );

    let mut extra = base();
    extra["kind"] = json!("reactive");
    assert_eq!(
        err(fx
            .engine
            .dispatch(request("bad-extra", "bot.responsibility_create", extra)))
        .code,
        "invalid_argument"
    );
}

#[test]
fn create_refuses_a_bot_whose_harness_is_not_launchable() {
    // `gemini` is a known TUI agent at `bot.create` but not a launchable
    // `HarnessId`: the owned automation would strand a live cron with no
    // runner, so creation is refused rather than stranding it.
    let fx = Fixture::new();
    let bot = fx.create_bot("bot-1", "gemini");
    let bot_id = bot["id"].as_str().unwrap().to_string();
    assert_eq!(
        err(fx.engine.dispatch(request(
            "resp-gemini",
            "bot.responsibility_create",
            json!({
                "workspaceId": fx.workspace_id,
                "hostId": fx.host_id,
                "botId": bot_id,
                "name": "Nightly review",
                "schedule": "* * * * *",
                "prompt": "Review incoming work.",
            }),
        )))
        .code,
        "invalid_argument"
    );
}

#[test]
fn delete_rejects_missing_responsibility_and_replays_delete_receipt() {
    let fx = Fixture::new();
    let bot = fx.create_bot("bot-1", "pi");
    let bot_id = bot["id"].as_str().unwrap().to_string();
    let created = fx.create_responsibility("resp-create-1", &bot_id, "* * * * *");
    let responsibility_id = created["responsibilityId"].as_str().unwrap().to_string();

    let mut missing = json!({
        "workspaceId": fx.workspace_id,
        "hostId": fx.host_id,
        "botId": bot_id,
        "responsibilityId": "no-such-responsibility",
    });
    assert_eq!(
        err(fx.engine.dispatch(request(
            "del-missing",
            "bot.responsibility_delete",
            missing.clone()
        )))
        .code,
        "not_found"
    );
    missing["botId"] = json!("no-such-bot");
    assert_eq!(
        err(fx.engine.dispatch(request(
            "del-missing-bot",
            "bot.responsibility_delete",
            missing
        )))
        .code,
        "not_found"
    );

    // Same request id twice: the ledger replays the stored receipt instead
    // of deleting twice (the second run would otherwise be `not_found`).
    let params = json!({
        "workspaceId": fx.workspace_id,
        "hostId": fx.host_id,
        "botId": bot_id,
        "responsibilityId": responsibility_id,
    });
    let first = ok(fx.engine.dispatch(request(
        "del-once",
        "bot.responsibility_delete",
        params.clone(),
    )));
    let second = ok(fx
        .engine
        .dispatch(request("del-once", "bot.responsibility_delete", params)));
    assert_eq!(first, second);
}

#[test]
fn scheduled_tick_fires_the_bot_owned_automation_through_the_seam() {
    ensure_fixture_harness_on_path();
    let fx = Fixture::new();
    let bot = fx.create_bot("bot-1", "pi");
    let bot_id = bot["id"].as_str().unwrap().to_string();
    let created = fx.create_responsibility("resp-create-1", &bot_id, "* * * * *");
    let automation_id = created["automationId"].as_str().unwrap().to_string();
    let responsibility_id = created["responsibilityId"].as_str().unwrap().to_string();

    let listed = ok(fx
        .engine
        .dispatch(request("auto-list", "automation.list", json!({}))));
    let slot = listed["automations"].as_array().unwrap()[0]["nextRunAt"]
        .as_f64()
        .unwrap();

    let summary = scheduler::tick_once(&fx.engine, slot + 30_000.0);
    assert_eq!(summary.fired, 1);
    assert_eq!(summary.failed, 0);

    let history = ok(fx.engine.dispatch(request(
        "hist-tick",
        "automation.history",
        json!({"automationId": automation_id}),
    )));
    let runs = history["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["trigger"], json!("scheduled"));

    // The tick records a responsibility run exactly like a manual Run
    // does: the run row carries the responsibility id, links the
    // automation run (which carries the session id), and the snapshot
    // history shows it with a scheduled invocation.
    let snapshot = fx.snapshot();
    let bot_history = snapshot["history"].as_array().unwrap();
    assert_eq!(bot_history.len(), 1);
    let entry = &bot_history[0];
    assert!(runs[0]["terminalSessionId"].as_str().is_some());
    assert_eq!(entry["run"]["responsibilityId"], json!(responsibility_id));
    assert_eq!(entry["run"]["automationRunId"], runs[0]["id"]);
    assert_eq!(entry["run"]["automationId"], json!(automation_id));
    assert_eq!(entry["run"]["invocation"], json!("scheduled"));
    assert_eq!(entry["responsibilityName"], json!("Nightly review"));
    assert_eq!(entry["automationName"], json!("Nightly review"));
    // The scheduled fire also carries the fork-style ordinal and verdict
    // projection for the row's evidence line.
    assert_eq!(entry["automationRunNumber"].as_f64(), Some(1.0));
    assert!(entry["automationRunStatus"].as_str().is_some());

    // The responsibility projection survives its automation's fire: the
    // schedule advanced past the fired slot.
    let relisted = ok(fx
        .engine
        .dispatch(request("auto-list-2", "automation.list", json!({}))));
    let item = &relisted["automations"].as_array().unwrap()[0];
    assert!(item["nextRunAt"].as_f64().unwrap() > slot);
    let snapshot = fx.snapshot();
    assert_eq!(
        snapshot["bots"].as_array().unwrap()[0]["responsibilities"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    // The fixture session really ran: poll until it exits.
    let session_id = runs[0]["terminalSessionId"].as_str().unwrap().to_string();
    let mut exited = false;
    for _ in 0..100 {
        let listed = ok(fx.engine.dispatch(request(
            &uuid::Uuid::new_v4().to_string(),
            "session.list",
            json!({"workspaceId": fx.workspace_id}),
        )));
        if listed["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["id"] == json!(session_id) && s["verdict"] == json!("exited"))
        {
            exited = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(exited, "the fixture harness session never reached exited");
}
