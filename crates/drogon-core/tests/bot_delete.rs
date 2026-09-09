//! Tests for `bot.delete` (R9-C): removes the Bot, its responsibilities
//! and their Bot-owned automations atomically, preserving
//! responsibility-run rows as orphaned evidence (like
//! `bot.responsibility_delete` does), with request-ledger idempotency.
//!
//! All dispatched calls go through the real `Engine::dispatch` end to end
//! (ledger atomicity, workspace scope, replay).

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

    fn create_bot(&self, id: &str) -> Value {
        ok(self.engine.dispatch(request(
            id,
            "bot.create",
            json!({
                "workspaceId": self.workspace_id,
                "hostId": self.host_id,
                "body": {
                    "characterPreset": "none",
                    "displayIdentity": {"displayName": "Watcher", "handle": null, "title": null},
                    "harnessPolicy": {"defaultHarness": "pi", "explicitModel": null},
                    "instructions": "Guard the realm.",
                    "memories": [],
                },
            }),
        )))
    }

    fn create_responsibility(&self, id: &str, bot_id: &str) -> Value {
        ok(self.engine.dispatch(request(
            id,
            "bot.responsibility_create",
            json!({
                "workspaceId": self.workspace_id,
                "hostId": self.host_id,
                "botId": bot_id,
                "name": "Nightly review",
                "schedule": "* * * * *",
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

    fn delete_bot(&self, id: &str, bot_id: &str) -> Response {
        self.engine.dispatch(request(
            id,
            "bot.delete",
            json!({
                "workspaceId": self.workspace_id,
                "hostId": self.host_id,
                "botId": bot_id,
            }),
        ))
    }
}

#[test]
fn delete_removes_the_bot_its_responsibilities_and_their_owned_automations() {
    let fx = Fixture::new();
    let bot = fx.create_bot("bot-1");
    let bot_id = bot["id"].as_str().unwrap().to_string();
    let created = fx.create_responsibility("resp-create-1", &bot_id);
    let responsibility_id = created["responsibilityId"].as_str().unwrap().to_string();
    let automation_id = created["automationId"].as_str().unwrap().to_string();

    let deleted = ok(fx.delete_bot("del-1", &bot_id));
    assert_eq!(deleted["hostId"], json!(fx.host_id));
    assert_eq!(deleted["workspaceId"], json!(fx.workspace_id));
    assert_eq!(deleted["botId"], json!(bot_id));
    assert_eq!(deleted["removed"], json!(true));
    assert_eq!(deleted["automationIds"], json!([automation_id]));

    // The Bot (and so its responsibilities) is gone from the snapshot.
    let snapshot = fx.snapshot();
    assert!(snapshot["bots"].as_array().unwrap().is_empty());
    assert!(snapshot["history"].as_array().unwrap().is_empty());

    // The still-Bot-owned automation is deleted, not stranded ownerless.
    let listed = ok(fx
        .engine
        .dispatch(request("auto-list", "automation.list", json!({}))));
    assert!(listed["automations"].as_array().unwrap().is_empty());

    // Deleting again with a fresh request id is `not_found`, and the
    // responsibility is gone with the Bot.
    assert_eq!(err(fx.delete_bot("del-2", &bot_id)).code, "not_found");
    assert_eq!(
        err(fx.engine.dispatch(request(
            "resp-del-after",
            "bot.responsibility_delete",
            json!({
                "workspaceId": fx.workspace_id,
                "hostId": fx.host_id,
                "botId": bot_id,
                "responsibilityId": responsibility_id,
            }),
        )))
        .code,
        "not_found"
    );
}

// User-feature-closure item 6 (packaged acceptance: "bot delete must remove
// its owned automations"): bot.snapshot's host-global scope (workspaceId:
// "", R17-E #348) aggregates Bots across every folder a host owns, but the
// wire contract it serializes to (BotsPanelBot) carries no
// workspaceId/folder field. The desktop UI's delete call always sends the
// app's *currently selected* workspace scope (App.tsx's botsScope), which
// for a Bot loaded through the host-global view -- or simply because the
// user (or, in the packaged acceptance suite, a later journey) switched
// workspaces while the Bots panel stayed mounted (its own keep-alive logic)
// -- may not be the workspace this specific Bot actually lives in. Before
// this fix, delete_bot_in_connection required an *exact* caller-supplied
// workspace_id match and failed not_found otherwise, stranding the Bot and
// its owned automation exactly as the packaged run's failureUi captured
// (the "Acceptance Bot R16BB" card, Delete button and scheduled
// responsibility all still present after the delete attempt).

#[test]
fn delete_succeeds_with_the_host_global_empty_workspace_scope() {
    let fx = Fixture::new();
    let bot = fx.create_bot("bot-1");
    let bot_id = bot["id"].as_str().unwrap().to_string();
    let created = fx.create_responsibility("resp-create-1", &bot_id);
    let automation_id = created["automationId"].as_str().unwrap().to_string();

    // Exactly the scope App.tsx's botsScope sends when no workspace is
    // selected (#348's host-global fallback): workspaceId: "".
    let deleted = ok(fx.engine.dispatch(request(
        "del-1",
        "bot.delete",
        json!({"workspaceId": "", "hostId": fx.host_id, "botId": bot_id}),
    )));
    assert_eq!(deleted["botId"], json!(bot_id));
    assert_eq!(deleted["removed"], json!(true));
    assert_eq!(deleted["automationIds"], json!([automation_id.clone()]));

    let snapshot = fx.snapshot();
    assert!(snapshot["bots"].as_array().unwrap().is_empty());
    let listed = ok(fx
        .engine
        .dispatch(request("auto-list", "automation.list", json!({}))));
    assert!(
        !listed["automations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["id"] == json!(automation_id)),
        "bot delete must remove its owned automations"
    );
}

#[test]
fn delete_succeeds_when_the_caller_names_a_different_registered_workspace() {
    let fx = Fixture::new();
    let bot = fx.create_bot("bot-1");
    let bot_id = bot["id"].as_str().unwrap().to_string();
    let created = fx.create_responsibility("resp-create-1", &bot_id);
    let automation_id = created["automationId"].as_str().unwrap().to_string();

    // A second, validly-registered workspace under the same host -- the
    // user (or a later acceptance journey) switched to it while the Bots
    // panel, holding this Bot, stayed mounted (App.tsx's keep-alive).
    let other_dir = tempfile::tempdir().unwrap();
    let other = ok(fx.engine.dispatch(request(
        "ws-register-2",
        "workspace.register",
        json!({"path": other_dir.path()}),
    )));
    let other_workspace_id = other["id"].as_str().unwrap().to_string();
    assert_ne!(other_workspace_id, fx.workspace_id);

    let deleted = ok(fx.engine.dispatch(request(
        "del-1",
        "bot.delete",
        json!({
            "workspaceId": other_workspace_id,
            "hostId": fx.host_id,
            "botId": bot_id,
        }),
    )));
    assert_eq!(deleted["removed"], json!(true));
    assert_eq!(deleted["automationIds"], json!([automation_id.clone()]));

    let listed = ok(fx
        .engine
        .dispatch(request("auto-list", "automation.list", json!({}))));
    assert!(
        !listed["automations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["id"] == json!(automation_id)),
        "bot delete must remove its owned automations"
    );
}

#[test]
fn delete_still_refuses_a_bot_id_that_genuinely_does_not_exist() {
    // The fallback must never turn a real "no such bot" into a false
    // success -- only a *workspace* mismatch is forgiven, never a bad id.
    let fx = Fixture::new();
    assert_eq!(
        err(fx.engine.dispatch(request(
            "del-1",
            "bot.delete",
            json!({"workspaceId": "", "hostId": fx.host_id, "botId": "no-such-bot"}),
        )))
        .code,
        "not_found"
    );
}

#[test]
fn delete_replays_the_stored_receipt_for_the_same_request_id() {
    let fx = Fixture::new();
    let bot = fx.create_bot("bot-1");
    let bot_id = bot["id"].as_str().unwrap().to_string();
    fx.create_responsibility("resp-create-1", &bot_id);

    let params = json!({
        "workspaceId": fx.workspace_id,
        "hostId": fx.host_id,
        "botId": bot_id,
    });
    let first = ok(fx
        .engine
        .dispatch(request("del-once", "bot.delete", params.clone())));
    let second = ok(fx
        .engine
        .dispatch(request("del-once", "bot.delete", params)));
    assert_eq!(first, second);
    assert_eq!(first["removed"], json!(true));
}

#[test]
fn delete_rejects_bad_input_unknown_bot_and_unknown_workspace() {
    let fx = Fixture::new();
    let bot = fx.create_bot("bot-1");
    let bot_id = bot["id"].as_str().unwrap().to_string();

    assert_eq!(
        err(fx.delete_bot("del-missing", "no-such-bot")).code,
        "not_found"
    );

    let missing_ws = fx.engine.dispatch(request(
        "del-bad-ws",
        "bot.delete",
        json!({
            "workspaceId": "no-such-workspace",
            "hostId": fx.host_id,
            "botId": bot_id,
        }),
    ));
    assert_eq!(err(missing_ws).code, "unknown_workspace");

    let extra = fx.engine.dispatch(request(
        "del-extra",
        "bot.delete",
        json!({
            "workspaceId": fx.workspace_id,
            "hostId": fx.host_id,
            "botId": bot_id,
            "force": true,
        }),
    ));
    assert_eq!(err(extra).code, "invalid_argument");

    let missing_field = fx.engine.dispatch(request(
        "del-missing-field",
        "bot.delete",
        json!({
            "workspaceId": fx.workspace_id,
            "hostId": fx.host_id,
        }),
    ));
    assert_eq!(err(missing_field).code, "invalid_argument");
}
