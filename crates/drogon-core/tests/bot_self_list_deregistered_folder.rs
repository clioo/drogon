//! Regression for issue #609: `drogon-cli bot list` answered
//! `storage_error: workspace lookup failed: Query returned no rows` for the
//! very workspace `bot whoami` had just reported.
//!
//! The two commands read different things. `bot whoami` reports the STORED
//! `bot_homes` profile (`homeWorkspaceId`), which is never re-validated
//! against the `workspaces` table. `bot list` resolves the workspace the
//! Bot's RECORD folder is registered under -- and the bots table is keyed by
//! folder PATH, so removing the project or worktree the Bot was created in
//! deletes the `workspaces` row while leaving the Bot, its automations, its
//! monitors, its home and its audit trail exactly where they were.
//!
//! These tests pin the resulting contract: the read still answers (with the
//! reason attached), and only a write that must name a live workspace is
//! refused -- by name, not as a raw sqlite failure.
//!
//! MIT Copyright (c) 2026 Lovecast Inc.

use drogon_core::Engine;
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

fn error(response: Response) -> drogon_protocol::RpcError {
    assert!(!response.ok, "{response:?}");
    response.error.unwrap()
}

struct Fx {
    _root: tempfile::TempDir,
    engine: Engine,
    project_id: String,
    workspace_id: String,
    host_id: String,
    bot_id: String,
    /// What `bot whoami` reports inside the Bot's own session.
    home_workspace_id: String,
}

impl Fx {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("folder");
        std::fs::create_dir(&folder).unwrap();
        let engine = Engine::open(&root.path().join("data")).unwrap();
        // A folder project, added the way an owner adds one: `project.add`
        // registers the workspace, and `project.remove` is what takes that
        // registration away again later.
        let project = success(engine.dispatch(request(
            "add-project",
            "project.add",
            json!({"path": folder}),
        )));
        let project_id = project["id"].as_str().unwrap().to_string();
        let workspace = success(engine.dispatch(request(
            "register",
            "workspace.register",
            json!({"path": folder}),
        )));
        let workspace_id = workspace["id"].as_str().unwrap().to_string();
        let host_id = workspace["hostId"].as_str().unwrap().to_string();
        let bot = success(engine.dispatch(request(
            "create",
            "bot.create",
            json!({
                "workspaceId": workspace_id,
                "hostId": host_id,
                "body": {
                    "characterPreset": "none",
                    "displayIdentity": {
                        "displayName": "Watcher",
                        "handle": "watcher",
                        "title": null
                    },
                    "harnessPolicy": {"defaultHarness": "codex", "explicitModel": null},
                    "instructions": "Guard the realm.",
                    "memories": []
                },
            }),
        )));
        let bot_id = bot["id"].as_str().unwrap().to_string();
        let home = success(engine.dispatch(request(
            "provision",
            "bot.self_provision",
            json!({
                "workspaceId": workspace_id,
                "hostId": host_id,
                "botId": bot_id,
                "actorBotId": bot_id,
            }),
        )));
        let home_workspace_id = home["homeWorkspaceId"].as_str().unwrap().to_string();
        assert_ne!(
            home_workspace_id, workspace_id,
            "the provisioned home is its own workspace, which is why the two commands can disagree"
        );
        Self {
            _root: root,
            engine,
            project_id,
            workspace_id,
            host_id,
            bot_id,
            home_workspace_id,
        }
    }

    fn call(&self, req: &str, method: &str, mut params: Value) -> Response {
        params["hostId"] = json!(self.host_id);
        params["botId"] = json!(self.bot_id);
        params["actorBotId"] = json!(self.bot_id);
        if params.get("workspaceId").is_none() {
            params["workspaceId"] = json!(self.home_workspace_id);
        }
        self.engine.dispatch(request(req, method, params))
    }

    /// The days-later event the issue describes, through the product's own
    /// path: removing the project deletes the `workspaces` row (see
    /// `project::remove`) while every Bot row, keyed by folder PATH, stays
    /// exactly where it was.
    fn deregister_record_folder(&self) {
        success(self.engine.dispatch(request(
            "remove-project",
            "project.remove",
            json!({"id": self.project_id}),
        )));
    }
}

#[test]
fn bot_list_still_answers_when_the_record_folder_left_the_registry() {
    let fx = Fx::new();
    success(fx.call(
        "make-automation",
        "bot.self_create_automation",
        json!({
            "name": "Morning sweep",
            "schedule": "0 9 * * *",
            "prompt": "Check the watchtower.",
        }),
    ));

    fx.deregister_record_folder();

    // The call from the issue: --workspace is the id `bot whoami` reports.
    let listed = success(fx.call("list", "bot.self_list", json!({})));
    assert_eq!(listed["botId"], json!(fx.bot_id));
    assert_eq!(
        listed["automations"].as_array().unwrap().len(),
        1,
        "the Bot's own inventory is still readable: {listed}"
    );
    assert!(listed["home"].is_object(), "{listed}");
    assert!(listed["auditCount"].as_i64().unwrap() >= 1, "{listed}");

    // The degraded state is reported, never papered over.
    assert_eq!(listed["workspaceId"], Value::Null, "{listed}");
    let notice = listed["notice"].as_str().unwrap();
    assert!(
        notice.contains(&fx.bot_id),
        "the notice names the Bot: {notice}"
    );
    assert!(
        notice.contains(listed["folder"].as_str().unwrap()),
        "and the folder that left the registry: {notice}"
    );
}

#[test]
fn a_healthy_bot_list_reports_its_real_workspace_and_no_notice() {
    let fx = Fx::new();
    let listed = success(fx.call("list", "bot.self_list", json!({})));
    assert_eq!(
        listed["workspaceId"],
        json!(fx.workspace_id),
        "the Bot's record folder, not the asserted home workspace: {listed}"
    );
    assert_eq!(listed["notice"], Value::Null, "{listed}");
}

#[test]
fn a_write_names_the_deregistered_folder_instead_of_a_sqlite_failure() {
    let fx = Fx::new();
    fx.deregister_record_folder();

    let refused = error(fx.call(
        "make-automation",
        "bot.self_create_automation",
        json!({
            "name": "Morning sweep",
            "schedule": "0 9 * * *",
            "prompt": "Check the watchtower.",
        }),
    ));
    // The bug's signature, gone for good.
    assert_ne!(refused.code, "storage_error", "{refused:?}");
    assert!(
        !refused.message.contains("Query returned no rows"),
        "{refused:?}"
    );
    // A write has to target a live workspace, so it is still refused -- but
    // with the actual diagnosis, distinct from an id this host never knew.
    assert_eq!(refused.code, "workspace_deregistered", "{refused:?}");
    assert_ne!(refused.code, "unknown_workspace", "{refused:?}");
    assert!(refused.message.contains(&fx.bot_id), "{refused:?}");
    assert!(
        refused.message.contains("drogon-cli workspace add"),
        "the refusal says how to recover: {refused:?}"
    );
}

#[test]
fn an_id_this_host_never_knew_is_still_routed_by_the_bot_itself() {
    let fx = Fx::new();
    // The authoritative-owner routing predates this fix: a workspace id that
    // does not name the Bot's folder resolves through the Bot instead, so an
    // unknown id must NOT start reporting the deregistered-folder condition.
    let listed = success(fx.call(
        "list",
        "bot.self_list",
        json!({"workspaceId": "00000000-0000-0000-0000-000000000000"}),
    ));
    assert_eq!(listed["workspaceId"], json!(fx.workspace_id), "{listed}");
    assert_eq!(listed["notice"], Value::Null, "{listed}");

    // A Bot this host never knew is still a plain not_found.
    let missing = error(fx.engine.dispatch(request(
        "list-missing",
        "bot.self_list",
        json!({
            "workspaceId": fx.workspace_id,
            "hostId": fx.host_id,
            "botId": "no-such-bot",
            "actorBotId": "no-such-bot",
        }),
    )));
    assert_eq!(missing.code, "not_found", "{missing:?}");
}
