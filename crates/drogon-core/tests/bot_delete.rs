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

    fn create_responsibility_with_workspace(
        &self,
        id: &str,
        workspace_id: &str,
        bot_id: &str,
    ) -> Response {
        self.engine.dispatch(request(
            id,
            "bot.responsibility_create",
            json!({
                "workspaceId": workspace_id,
                "hostId": self.host_id,
                "botId": bot_id,
                "name": "Nightly review",
                "schedule": "* * * * *",
                "prompt": "Review incoming work.",
            }),
        ))
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

    fn delete_responsibility_with_workspace(
        &self,
        id: &str,
        workspace_id: &str,
        bot_id: &str,
        responsibility_id: &str,
    ) -> Response {
        self.engine.dispatch(request(
            id,
            "bot.responsibility_delete",
            json!({
                "workspaceId": workspace_id,
                "hostId": self.host_id,
                "botId": bot_id,
                "responsibilityId": responsibility_id,
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

// Coordinator review (msg_805784c99bef): the same missing-Bot-workspace-
// identity gap bot.delete had also applied to bot.responsibility_create --
// a responsibility is created FOR an existing bot, so its home workspace
// is the bot's own, never an arbitrary caller-asserted one.

#[test]
fn responsibility_create_succeeds_with_the_host_global_empty_workspace_scope_and_uses_the_bots_own_workspace() {
    let fx = Fixture::new();
    let bot_id = fx.create_bot("bot-1")["id"].as_str().unwrap().to_string();
    let created = ok(fx.create_responsibility_with_workspace("create-1", "", &bot_id));
    // The empty caller scope must never leak into the new automation's own
    // execution target -- it must resolve to the bot's real home workspace.
    assert_eq!(created["workspaceId"], json!(fx.workspace_id));
    assert_eq!(created["botId"], json!(bot_id));
    assert!(created["responsibilityId"].as_str().is_some());
    assert!(created["automationId"].as_str().is_some());
}

#[test]
fn responsibility_create_succeeds_after_switching_to_a_different_registered_workspace() {
    let fx = Fixture::new();
    let bot_id = fx.create_bot("bot-1")["id"].as_str().unwrap().to_string();
    let other_dir = tempfile::tempdir().unwrap();
    let other_workspace_id = ok(fx.engine.dispatch(request(
        "ws-register-2",
        "workspace.register",
        json!({"path": other_dir.path()}),
    )))["id"]
        .as_str()
        .unwrap()
        .to_string();
    let created = ok(fx.create_responsibility_with_workspace(
        "create-1",
        &other_workspace_id,
        &bot_id,
    ));
    // Never the caller's mismatched workspace -- the bot's own.
    assert_eq!(created["workspaceId"], json!(fx.workspace_id));
    assert_ne!(created["workspaceId"], json!(other_workspace_id));
}

#[test]
fn responsibility_create_still_rejects_a_genuinely_unknown_workspace() {
    let fx = Fixture::new();
    let bot_id = fx.create_bot("bot-1")["id"].as_str().unwrap().to_string();
    assert_eq!(
        err(fx.create_responsibility_with_workspace(
            "create-1",
            "no-such-workspace",
            &bot_id,
        ))
        .code,
        "unknown_workspace"
    );
}

#[test]
fn responsibility_create_still_refuses_a_bot_id_that_genuinely_does_not_exist() {
    let fx = Fixture::new();
    assert_eq!(
        err(fx.create_responsibility_with_workspace("create-1", "", "no-such-bot")).code,
        "not_found"
    );
}

#[test]
fn responsibility_create_replays_the_stored_receipt_for_the_same_request_id() {
    let fx = Fixture::new();
    let bot_id = fx.create_bot("bot-1")["id"].as_str().unwrap().to_string();
    let first = ok(fx.create_responsibility_with_workspace("create-once", "", &bot_id));
    let replayed = ok(fx.create_responsibility_with_workspace("create-once", "", &bot_id));
    assert_eq!(first, replayed);
}

// Coordinator review (msg_805784c99bef): the same missing-Bot-workspace-
// identity gap bot.delete had also applied to bot.responsibility_delete --
// consistent authoritative owner routing, not a one-off fix scoped to the
// single failing assertion.

#[test]
fn responsibility_delete_succeeds_with_the_host_global_empty_workspace_scope() {
    let fx = Fixture::new();
    let bot_id = fx.create_bot("bot-1")["id"].as_str().unwrap().to_string();
    let created = fx.create_responsibility("resp-1", &bot_id);
    let responsibility_id = created["responsibilityId"].as_str().unwrap().to_string();
    let automation_id = created["automationId"].as_str().unwrap().to_string();

    let deleted = ok(fx.delete_responsibility_with_workspace(
        "del-1",
        "",
        &bot_id,
        &responsibility_id,
    ));
    assert_eq!(deleted["removed"], json!(true));
    assert_eq!(deleted["automationId"], json!(automation_id.clone()));

    let listed = ok(fx
        .engine
        .dispatch(request("auto-list", "automation.list", json!({}))));
    assert!(
        !listed["automations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["id"] == json!(automation_id)),
        "responsibility delete must remove its owned automation"
    );
}

#[test]
fn responsibility_delete_succeeds_after_switching_to_a_different_registered_workspace() {
    let fx = Fixture::new();
    let bot_id = fx.create_bot("bot-1")["id"].as_str().unwrap().to_string();
    let created = fx.create_responsibility("resp-1", &bot_id);
    let responsibility_id = created["responsibilityId"].as_str().unwrap().to_string();

    // The user (or a later acceptance journey) switched to a second,
    // validly-registered workspace while the Bots panel, holding this Bot,
    // stayed mounted (App.tsx's keep-alive) -- exactly bot.delete's own
    // "different registered workspace" scenario.
    let other_dir = tempfile::tempdir().unwrap();
    let other_workspace_id = ok(fx.engine.dispatch(request(
        "ws-register-2",
        "workspace.register",
        json!({"path": other_dir.path()}),
    )))["id"]
        .as_str()
        .unwrap()
        .to_string();

    let deleted = ok(fx.delete_responsibility_with_workspace(
        "del-1",
        &other_workspace_id,
        &bot_id,
        &responsibility_id,
    ));
    assert_eq!(deleted["removed"], json!(true));
}

#[test]
fn responsibility_delete_replays_the_stored_receipt_after_the_bot_is_already_gone() {
    // Same replay-must-never-require-existence constraint as bot.delete's
    // own coverage: the first call succeeds and deletes the bot itself
    // (deleting a bot removes its responsibilities too), the SAME
    // request_id replayed afterward must return the cached receipt, not
    // a fresh not_found from authorize re-running against a bot that
    // (correctly) no longer exists.
    let fx = Fixture::new();
    let bot_id = fx.create_bot("bot-1")["id"].as_str().unwrap().to_string();
    let created = fx.create_responsibility("resp-1", &bot_id);
    let responsibility_id = created["responsibilityId"].as_str().unwrap().to_string();

    let first = ok(fx.delete_responsibility_with_workspace(
        "del-once",
        "",
        &bot_id,
        &responsibility_id,
    ));
    ok(fx.delete_bot("del-bot", &bot_id));
    let replayed = ok(fx.delete_responsibility_with_workspace(
        "del-once",
        "",
        &bot_id,
        &responsibility_id,
    ));
    assert_eq!(first, replayed);
}

#[test]
fn responsibility_delete_still_rejects_a_genuinely_unknown_workspace() {
    // Only the empty host-global sentinel and a real-but-different
    // workspace are forgiven -- a typo'd/stale non-empty workspace id
    // stays a rejected request, exactly like bot.delete's own contract.
    let fx = Fixture::new();
    let bot_id = fx.create_bot("bot-1")["id"].as_str().unwrap().to_string();
    let created = fx.create_responsibility("resp-1", &bot_id);
    let responsibility_id = created["responsibilityId"].as_str().unwrap().to_string();
    assert_eq!(
        err(fx.delete_responsibility_with_workspace(
            "del-1",
            "no-such-workspace",
            &bot_id,
            &responsibility_id,
        ))
        .code,
        "unknown_workspace"
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
