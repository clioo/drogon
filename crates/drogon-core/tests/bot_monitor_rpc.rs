//! Tests for `bot.monitor_create` / `bot.monitor_approve` /
//! `bot.monitor_list` (P3): stage parked, arm explicitly, read health.
//!
//! All calls go through the real `Engine::dispatch` end to end (ledger
//! atomicity, bot scope, replay). No models, no network.

use drogon_core::Engine;
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
    bot_id: String,
}

impl Fixture {
    fn new() -> Self {
        Self::with_harness("codex")
    }

    fn with_harness(harness: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::open(dir.path()).unwrap();
        let folder = dir.path().join("folder");
        std::fs::create_dir(&folder).unwrap();
        std::fs::create_dir(folder.join("notes")).unwrap();
        std::fs::write(folder.join("notes/status.md"), b"v1").unwrap();
        let registered = ok(engine.dispatch(request(
            "ws-register",
            "workspace.register",
            json!({"path": folder}),
        )));
        let workspace_id = registered["id"].as_str().unwrap().to_string();
        let host_id = registered["hostId"].as_str().unwrap().to_string();
        let project =
            ok(engine.dispatch(request("proj-add", "project.add", json!({"path": folder}))));
        assert!(project["id"].as_str().is_some(), "{project:?}");
        let bot = ok(engine.dispatch(request(
            "bot-create",
            "bot.create",
            json!({
                "workspaceId": workspace_id,
                "hostId": host_id,
                "body": {
                    "characterPreset": "none",
                    "displayIdentity": {"displayName": "Watcher", "handle": null, "title": null},
                    "harnessPolicy": {"defaultHarness": harness, "explicitModel": null},
                    "instructions": "Guard the realm.",
                    "memories": [],
                },
            }),
        )));
        let bot_id = bot["id"].as_str().unwrap().to_string();
        Self {
            _dir: dir,
            engine,
            workspace_id,
            host_id,
            bot_id,
        }
    }

    fn scope(&self) -> Value {
        json!({
            "workspaceId": self.workspace_id,
            "hostId": self.host_id,
            "botId": self.bot_id,
        })
    }

    fn create(&self, id: &str, extra: Value) -> Value {
        let mut params = self.scope();
        for (k, v) in extra.as_object().unwrap() {
            params[k] = v.clone();
        }
        ok(self
            .engine
            .dispatch(request(id, "bot.monitor_create", params)))
    }

    fn create_err(&self, id: &str, extra: Value) -> RpcError {
        let mut params = self.scope();
        for (k, v) in extra.as_object().unwrap() {
            params[k] = v.clone();
        }
        err(self
            .engine
            .dispatch(request(id, "bot.monitor_create", params)))
    }

    fn approve(&self, id: &str, monitor_id: &str) -> Value {
        let mut params = self.scope();
        params["monitorId"] = Value::String(monitor_id.to_string());
        ok(self
            .engine
            .dispatch(request(id, "bot.monitor_approve", params)))
    }

    fn list(&self) -> Value {
        ok(self
            .engine
            .dispatch(request("list", "bot.monitor_list", self.scope())))
    }
}

#[test]
fn create_stages_parked_and_approve_arms() {
    let fixture = Fixture::new();
    let created = fixture.create(
        "m-create",
        json!({
            "monitorId": "mon-1",
            "resource": "notes/status.md",
            "responsibilityName": "triage",
            "instructions": "Triage the change.",
        }),
    );
    assert_eq!(created["monitorId"], "mon-1");
    assert_eq!(created["approved"], false);
    let responsibility_id = created["responsibilityId"].as_str().unwrap().to_string();
    assert!(responsibility_id.starts_with("resp-"));

    // Parked: the list view reports needs-approval, never armed.
    let listed = fixture.list();
    assert_eq!(listed["monitors"].as_array().unwrap().len(), 1);
    assert_eq!(listed["monitors"][0]["approved"], false);
    assert_eq!(listed["monitors"][0]["resource"], "notes/status.md");
    assert_eq!(listed["monitors"][0]["responsibilityId"], responsibility_id);
    assert_eq!(listed["monitors"][0]["delegationsToday"]["used"], 0);
    assert_eq!(listed["monitors"][0]["delegationsToday"]["max"], 10);

    // Approve arms the exact rule hash.
    let approved = fixture.approve("m-approve", "mon-1");
    assert_eq!(approved["approved"], true);
    assert!(approved["approvalHash"].as_str().unwrap().len() == 64);
    assert_eq!(fixture.list()["monitors"][0]["approved"], true);
}

#[test]
fn create_refuses_unknown_and_scheduled_bindings() {
    let fixture = Fixture::new();
    // Unknown responsibility id.
    let error = fixture.create_err(
        "m-bad-bind",
        json!({"resource": "notes/status.md", "responsibilityId": "resp-nope"}),
    );
    assert_eq!(error.code, "not_found", "{error:?}");
    // Mutually exclusive binding modes.
    let error = fixture.create_err(
        "m-both",
        json!({
            "resource": "notes/status.md",
            "responsibilityId": "resp-nope",
            "responsibilityName": "triage",
        }),
    );
    assert_eq!(error.code, "invalid_argument", "{error:?}");
    // Scheduled responsibilities cannot be bound: create one, then try.
    let scheduled = ok(fixture.engine.dispatch(request(
        "resp-sched",
        "bot.responsibility_create",
        json!({
            "workspaceId": fixture.workspace_id,
            "hostId": fixture.host_id,
            "botId": fixture.bot_id,
            "name": "Nightly review",
            "schedule": "* * * * *",
            "prompt": "Review incoming work.",
        }),
    )));
    let scheduled_id = scheduled["responsibility"]["id"]
        .as_str()
        .or_else(|| scheduled["responsibilityId"].as_str())
        .unwrap_or("")
        .to_string();
    assert!(!scheduled_id.is_empty(), "{scheduled:?}");
    let error = fixture.create_err(
        "m-sched-bind",
        json!({"resource": "notes/status.md", "responsibilityId": scheduled_id}),
    );
    assert_eq!(error.code, "invalid_argument", "{error:?}");
}

#[test]
fn create_refuses_bad_scope_and_shapes() {
    let fixture = Fixture::new();
    // Unknown bot.
    let mut params = fixture.scope();
    params["botId"] = json!("bot-nope");
    params["resource"] = json!("notes/status.md");
    let error =
        err(fixture
            .engine
            .dispatch(request("m-unknown-bot", "bot.monitor_create", params)));
    assert_eq!(error.code, "not_found", "{error:?}");
    // Absolute resource.
    let error = fixture.create_err("m-abs", json!({"resource": "/etc/passwd"}));
    assert_eq!(error.code, "invalid_argument", "{error:?}");
    // Oversized bound.
    let error = fixture.create_err(
        "m-big",
        json!({"resource": "notes/status.md", "maxBytes": 999_999_999u64}),
    );
    assert_eq!(error.code, "invalid_argument", "{error:?}");
    // Unknown top-level field.
    let error = fixture.create_err(
        "m-extra",
        json!({"resource": "notes/status.md", "script": "evil.sh"}),
    );
    assert_eq!(error.code, "invalid_argument", "{error:?}");
}

#[test]
fn approve_is_replay_safe_and_missing_is_not_found() {
    let fixture = Fixture::new();
    fixture.create(
        "m-create",
        json!({"monitorId": "mon-1", "resource": "notes/status.md"}),
    );
    // Same envelope request id twice: the ledger replays the receipt,
    // never a second mutation.
    let first = fixture.approve("m-approve-same", "mon-1");
    let second = fixture.approve("m-approve-same", "mon-1");
    assert_eq!(first, second);
    // Duplicate monitor id on a fresh request: collision, never overwrite.
    let error = fixture.create_err(
        "m-create-dup",
        json!({"monitorId": "mon-1", "resource": "notes/other.md"}),
    );
    assert_eq!(error.code, "invalid_argument", "{error:?}");
    // Approving a monitor that was never staged.
    let mut params = fixture.scope();
    params["monitorId"] = json!("mon-nope");
    let error =
        err(fixture
            .engine
            .dispatch(request("m-approve-nope", "bot.monitor_approve", params)));
    assert_eq!(error.code, "not_found", "{error:?}");
}

/// Fixture harness: an executable named `pi` on `PATH` that prints and
/// exits 0 — never real model inference. (Same shape as
/// `automation_scheduler.rs`' fixture; separate test process, own `Once`.)
fn ensure_fixture_harness_on_path() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let dir =
            std::env::temp_dir().join(format!("drogon-delegation-fixture-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pi = dir.join("pi");
        std::fs::write(
            &pi,
            "#!/bin/sh\necho \"delegation-fixture-output ARGS:$@\"\nexit 0\n",
        )
        .unwrap();
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

fn history_len(fixture: &Fixture) -> usize {
    let snap = ok(fixture.engine.dispatch(request(
        "snap",
        "bot.snapshot",
        json!({"workspaceId": fixture.workspace_id, "hostId": fixture.host_id, "locale": "en-US"}),
    )));
    snap["history"].as_array().unwrap().len()
}

/// End to end through the real scheduler tick and the real dispatch seam:
/// a watched-file change makes the Bot dispatch exactly one headless run
/// (fixture `pi`), a repeat tick dispatches nothing, and the next change
/// dispatches exactly once more.
#[test]
fn scheduler_tick_delegates_file_changes_to_bot_runs() {
    ensure_fixture_harness_on_path();
    let fixture = Fixture::with_harness("pi");
    let created = fixture.create(
        "m-create",
        json!({
            "monitorId": "mon-1",
            "resource": "notes/status.md",
            "responsibilityName": "triage",
            "instructions": "Triage the change.",
        }),
    );
    assert_eq!(created["approved"], false);
    fixture.approve("m-approve", "mon-1");

    // First tick: the initial read is a change → one event, one dispatch.
    // Wall-clock times (not fixed): the cap row and the list view must
    // agree on *today*. The producer tick only fires cron-scheduled
    // monitors, so the follow-up change below is timed past the next
    // minute boundary (deterministic regardless of where in the minute
    // this test starts).
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64;
    let next_minute = (now / 60_000.0).floor() * 60_000.0 + 60_000.0;
    let summary = drogon_core::automations::scheduler::tick_once(&fixture.engine, now);
    assert_eq!(summary.monitor_events, 1, "one change committed");
    assert_eq!(summary.delegations, 1, "one delegation dispatched");
    assert_eq!(history_len(&fixture), 1);

    // Repeat tick, same bytes: nothing new anywhere.
    let summary = drogon_core::automations::scheduler::tick_once(&fixture.engine, now + 15_000.0);
    assert_eq!(summary.monitor_events, 0);
    assert_eq!(summary.delegations, 0);
    assert_eq!(history_len(&fixture), 1);

    // A genuinely new change delegates exactly once more — timed past
    // the next minute boundary so the cron-scheduled producer is due.
    std::fs::write(
        fixture._dir.path().join("folder/notes/status.md"),
        b"v2 bytes",
    )
    .unwrap();
    let summary =
        drogon_core::automations::scheduler::tick_once(&fixture.engine, next_minute + 61_000.0);
    assert_eq!(summary.monitor_events, 1);
    assert_eq!(summary.delegations, 1);
    assert_eq!(history_len(&fixture), 2);

    // The list view reports the honest budget: 2 consumed (or 1, when
    // the minute-boundary wait crossed a UTC midnight — the cap day
    // rolled over, which is itself correct behavior).
    let listed = fixture.list();
    let used = listed["monitors"][0]["delegationsToday"]["used"]
        .as_i64()
        .unwrap();
    assert!(used == 1 || used == 2, "used today: {used}");
    assert!(listed["monitors"][0]["lastEventId"].as_str().is_some());
}

#[test]
fn create_honors_cron_manual_and_rejects_bad_cron() {
    let fixture = Fixture::new();
    // Default: scheduled every minute (the cadence the P2 tick fires).
    let created = fixture.create(
        "m-cron-default",
        json!({"monitorId": "mon-cron", "resource": "notes/status.md"}),
    );
    assert_eq!(
        created["trigger"],
        json!({"kind": "scheduled", "cron": "* * * * *"})
    );
    // Explicit cron.
    let created = fixture.create(
        "m-cron-explicit",
        json!({"monitorId": "mon-cron2", "resource": "notes/status.md", "cron": "*/5 * * * *"}),
    );
    assert_eq!(
        created["trigger"],
        json!({"kind": "scheduled", "cron": "*/5 * * * *"})
    );
    // Nonsense cron is refused at admission, not discovered at tick time.
    let error = fixture.create_err(
        "m-cron-bad",
        json!({"monitorId": "mon-bad", "resource": "notes/status.md", "cron": "FREQ=DAILY"}),
    );
    assert_eq!(error.code, "invalid_argument", "{error:?}");
    // Manual opt-out: staged, valid, but the producer tick always skips it.
    let created = fixture.create(
        "m-manual",
        json!({"monitorId": "mon-man", "resource": "notes/status.md", "manual": true}),
    );
    assert_eq!(created["trigger"], json!({"kind": "manual"}));
    let listed = fixture.list();
    let monitors = listed["monitors"].as_array().unwrap();
    assert_eq!(monitors.len(), 3);
}
