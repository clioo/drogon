//! Issue #609 at the command line: `drogon-cli bot list --bot <ID>
//! --workspace <ID>` against the very workspace `bot whoami` reports, for a
//! Bot whose record folder has left the workspace registry. The real CLI
//! binary talks to a real `Engine`; only the socket transport is the
//! fixture's.
#![cfg(unix)]

mod common;

use std::sync::Arc;

use common::{Action, MockService, run_cli, stderr, stdout};
use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

fn rpc(engine: &Engine, method: &str, params: Value) -> Value {
    let response = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        auth: None,
        method: method.into(),
        params,
    });
    assert!(response.ok, "{method}: {response:?}");
    response.result.unwrap()
}

fn json_result(output: &std::process::Output) -> Value {
    assert!(
        output.status.success(),
        "stdout={} stderr={}",
        stdout(output),
        stderr(output)
    );
    serde_json::from_str::<Value>(&stdout(output)).unwrap()["result"].clone()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bot_list_reads_a_bot_whose_folder_left_the_registry_and_says_why() {
    let root = tempfile::Builder::new().prefix("bl-").tempdir().unwrap();
    let data = root.path().join("data");
    let engine = Arc::new(Engine::open(&data).unwrap());
    let service_engine = engine.clone();
    let _service = MockService::start(
        &data,
        Arc::new(move |value| {
            let response = service_engine.dispatch(serde_json::from_value(value).unwrap());
            Action::Respond(serde_json::to_value(response).unwrap())
        }),
    );

    let folder = root.path().join("project");
    std::fs::create_dir(&folder).unwrap();
    let project = rpc(&engine, "project.add", json!({"path": folder}));
    let workspace = rpc(&engine, "workspace.register", json!({"path": folder}));
    let host = workspace["hostId"].as_str().unwrap();
    let bot = rpc(
        &engine,
        "bot.create",
        json!({
            "workspaceId": workspace["id"], "hostId": host,
            "body": {
                "characterPreset": "none",
                "displayIdentity": {"displayName": "Arya Stark", "handle": "arya", "title": null},
                "harnessPolicy": {"defaultHarness": "pi", "explicitModel": null},
                "instructions": "Private standing instructions", "memories": []
            }
        }),
    );
    let bot_id = bot["id"].as_str().unwrap().to_string();
    let home = rpc(
        &engine,
        "bot.self_provision",
        json!({
            "botId": bot_id, "actorBotId": bot_id,
            "hostId": host, "workspaceId": workspace["id"]
        }),
    );
    // Exactly what `bot whoami --json` reports inside the Bot's session.
    let home_workspace = home["homeWorkspaceId"].as_str().unwrap().to_string();

    // The project the Bot was created in is removed days later, which is
    // what deletes its `workspaces` row and leaves the Bot behind.
    rpc(&engine, "project.remove", json!({"id": project["id"]}));

    let output = run_cli(
        &data,
        &[
            "bot",
            "list",
            "--bot",
            &bot_id,
            "--workspace",
            &home_workspace,
            "--json",
        ],
    );
    let listed = json_result(&output);
    assert_eq!(listed["botId"], json!(bot_id), "{listed}");
    assert_eq!(listed["workspaceId"], Value::Null, "{listed}");
    assert!(listed["home"].is_object(), "{listed}");
    assert!(listed["monitors"].is_array(), "{listed}");
    // The operator is told why, on stderr, without losing the read.
    let note = stderr(&output);
    assert!(note.contains("no longer a registered workspace"), "{note}");
    assert!(note.contains("drogon-cli workspace add"), "{note}");

    // Human mode keeps the same summary line it always had.
    let human = run_cli(
        &data,
        &[
            "bot",
            "list",
            "--bot",
            &bot_id,
            "--workspace",
            &home_workspace,
        ],
    );
    assert!(human.status.success(), "{}", stderr(&human));
    assert!(
        stdout(&human).contains(&format!("bot {bot_id}: 0 automations")),
        "{}",
        stdout(&human)
    );
    assert!(
        stderr(&human).contains("no longer a registered workspace"),
        "{}",
        stderr(&human)
    );
}
