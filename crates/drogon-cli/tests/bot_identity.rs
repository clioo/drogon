//! Live identity discovery uses the pre-existing bot.snapshot RPC, not files
//! or a new daemon method. The main regression uses real Engine state and a
//! real persistent PTY; only its socket transport is provided by the fixture.
#![cfg(unix)]

mod common;

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use common::{
    Action, MockService, error_envelope, ok_envelope, run_cli, run_cli_with, stderr, stdout,
};
use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

fn request(method: &str, params: Value) -> Request {
    Request {
        protocol: PROTOCOL_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        auth: None,
        method: method.into(),
        params,
    }
}

fn rpc(engine: &Engine, method: &str, params: Value) -> Value {
    let response = engine.dispatch(request(method, params));
    assert!(response.ok, "{method}: {response:?}");
    response.result.unwrap()
}

fn result(output: std::process::Output) -> Value {
    assert!(
        output.status.success(),
        "{} {}",
        stdout(&output),
        stderr(&output)
    );
    serde_json::from_str::<Value>(&stdout(&output)).unwrap()["result"].clone()
}

fn quote(path: &Path) -> String {
    format!("'{}'", path.to_str().unwrap().replace('\'', "'\\''"))
}

struct SessionCleanup<'a> {
    engine: &'a Engine,
    session: Value,
}

impl Drop for SessionCleanup<'_> {
    fn drop(&mut self) {
        let response = self.engine.dispatch(request(
            "session.stop",
            json!({
                "sessionId": self.session["id"], "incarnation": self.session["incarnation"]
            }),
        ));
        let exited = response.ok
            && response
                .result
                .as_ref()
                .is_some_and(|r| r["verdict"] == "exited");
        if !std::thread::panicking() {
            assert!(exited, "test-owned session cleanup failed: {response:?}");
        } else if !exited {
            eprintln!("test-owned session cleanup unverifiable: {response:?}");
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn already_open_session_discovers_identity_with_stale_or_missing_context_without_restart() {
    let root = tempfile::Builder::new().prefix("bi-").tempdir().unwrap();
    let data = root.path().join("data");
    let engine = Arc::new(Engine::open(&data).unwrap());
    let service_engine = engine.clone();
    let service = MockService::start(
        &data,
        Arc::new(move |value| {
            let response = service_engine.dispatch(serde_json::from_value(value).unwrap());
            Action::Respond(serde_json::to_value(response).unwrap())
        }),
    );
    let project = root.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let workspace = rpc(&engine, "workspace.register", json!({"path": project}));
    let host = workspace["hostId"].as_str().unwrap();
    let mut homes = Vec::new();
    for handle in ["bot-175f377c", "other-bot"] {
        let bot = rpc(
            &engine,
            "bot.create",
            json!({
                "workspaceId": workspace["id"], "hostId": host,
                "body": {
                    "characterPreset": "none",
                    "displayIdentity": {"displayName": "Arya Stark", "handle": handle, "title": null},
                    "harnessPolicy": {"defaultHarness": "pi", "explicitModel": null},
                    "instructions": "Private standing instructions", "memories": []
                }
            }),
        );
        homes.push(rpc(
            &engine,
            "bot.self_provision",
            json!({
                "botId": bot["id"], "actorBotId": bot["id"],
                "hostId": host, "workspaceId": workspace["id"]
            }),
        ));
    }
    let home = &homes[0];
    let home_path = Path::new(home["path"].as_str().unwrap());
    let home_workspace = home["homeWorkspaceId"].as_str().unwrap();
    assert_ne!(home_workspace, workspace["id"].as_str().unwrap());
    assert_ne!(home["botId"], "bot-175f377c");

    let session = result(run_cli(
        &data,
        &[
            "terminal",
            "create",
            "--workspace",
            home_workspace,
            "--json",
            "--",
            "/bin/sh",
        ],
    ));
    let _cleanup = SessionCleanup {
        engine: &engine,
        session: session.clone(),
    };
    // The session is already running before we replace its context with
    // precisely the old shape the owner reported. No bot.run/reopen occurs.
    for (iteration, context) in [
        Some("# Arya Stark\n\n## Identity\n\n- Name: Arya Stark\n"),
        None,
    ]
    .into_iter()
    .enumerate()
    {
        if let Some(context) = context {
            std::fs::write(home_path.join("AGENTS.md"), context).unwrap();
        } else {
            std::fs::remove_file(home_path.join("AGENTS.md")).unwrap();
        }
        // An unrelated cwd contains misleading context. Neither it nor the
        // home context may decide the Bot identity.
        std::fs::write(project.join("AGENTS.md"), "- Bot ID: wrong-bot\n").unwrap();
        let output_path = root.path().join(format!("identity-{iteration}.json"));
        let shell = format!(
            "cd {}; {} bot whoami --json > {}\n",
            quote(&project),
            quote(Path::new(env!("CARGO_BIN_EXE_drogon-cli"))),
            quote(&output_path)
        );
        result(run_cli(
            &data,
            &[
                "terminal",
                "send",
                "--session",
                session["id"].as_str().unwrap(),
                "--incarnation",
                session["incarnation"].as_str().unwrap(),
                "--text",
                &shell,
                "--json",
            ],
        ));
        let deadline = Instant::now() + Duration::from_secs(15);
        let envelope = loop {
            if let Ok(bytes) = std::fs::read(&output_path)
                && let Ok(value) = serde_json::from_slice::<Value>(&bytes)
            {
                break value;
            }
            assert!(Instant::now() < deadline, "identity command did not finish");
            std::thread::sleep(Duration::from_millis(25));
        };
        assert_eq!(envelope["ok"], true, "{envelope}");
        assert_eq!(
            envelope["result"],
            json!({
                "hostId": host, "botId": home["botId"], "workspaceId": home_workspace
            })
        );
        assert!(
            !envelope
                .to_string()
                .contains("Private standing instructions")
        );
        let identity = &envelope["result"];
        let owned = result(run_cli(
            &data,
            &[
                "bot",
                "list",
                "--bot",
                identity["botId"].as_str().unwrap(),
                "--workspace",
                identity["workspaceId"].as_str().unwrap(),
                "--json",
            ],
        ));
        assert_eq!(owned["botId"], home["botId"]);
        let observation = rpc(
            &engine,
            "session.read",
            json!({
                "sessionId": session["id"], "incarnation": session["incarnation"], "cursor": 0
            }),
        );
        assert_eq!(observation["session"]["verdict"], "live");
        assert_eq!(home_path.join("AGENTS.md").exists(), context.is_some());
    }
    assert_eq!(
        service
            .captured()
            .iter()
            .filter(|r| r["method"] == "bot.snapshot")
            .count(),
        2
    );
}

fn snapshot_service(data: &Path, snapshot: Value, capability: bool) -> MockService {
    MockService::start(
        data,
        Arc::new(move |request| {
            let id = request["requestId"].as_str().unwrap();
            match request["method"].as_str().unwrap() {
                "status" => Action::Respond(ok_envelope(
                    id,
                    json!({
                        "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
                        "version": "0.1.0", "capabilities": if capability { vec!["bot.snapshot.v1"] } else { vec![] }
                    }),
                )),
                "bot.snapshot" => Action::Respond(ok_envelope(id, snapshot.clone())),
                method => panic!("unexpected RPC {method}"),
            }
        }),
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn identity_refuses_missing_ambiguous_and_malformed_matches() {
    let bot = json!({"id": "bot-1", "home": {"homeWorkspaceId": "home-1"}});
    for (bots, host, expected) in [
        (json!([]), "host-1", "bot_identity_unavailable"),
        (
            json!([{"id": "bot-1", "home": null}]),
            "host-1",
            "bot_identity_unavailable",
        ),
        (
            json!([bot.clone(), bot.clone()]),
            "host-1",
            "bot_identity_ambiguous",
        ),
        (
            json!([{"home": {"homeWorkspaceId": "home-1"}}]),
            "host-1",
            "invalid_argument",
        ),
        (json!([bot.clone()]), "foreign-host", "invalid_argument"),
        (json!({}), "host-1", "invalid_argument"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let _service = snapshot_service(
            dir.path(),
            json!({"hostId": host, "workspaceId": "", "bots": bots}),
            true,
        );
        let output = run_cli_with(
            dir.path(),
            &["bot", "whoami", "--json"],
            &[("DROGON_WORKSPACE_ID", "home-1")],
        );
        assert_eq!(output.status.code(), Some(1));
        let error: Value = serde_json::from_str(&stdout(&output)).unwrap();
        assert_eq!(error["error"]["code"], expected, "{error}");
        assert!(error.get("result").is_none());
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn identity_preserves_snapshot_failures_without_claiming_an_id() {
    for code in ["snapshot_too_large", "storage_error"] {
        let dir = tempfile::tempdir().unwrap();
        let _service = MockService::start(
            dir.path(),
            Arc::new(move |request| {
                let id = request["requestId"].as_str().unwrap();
                if request["method"] == "status" {
                    Action::Respond(ok_envelope(
                        id,
                        json!({
                            "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
                            "version": "0.1.0", "capabilities": ["bot.snapshot.v1"]
                        }),
                    ))
                } else {
                    Action::Respond(error_envelope(id, code, "snapshot could not be read"))
                }
            }),
        );
        let output = run_cli_with(
            dir.path(),
            &["bot", "whoami", "--json"],
            &[("DROGON_WORKSPACE_ID", "home-1")],
        );
        assert_eq!(output.status.code(), Some(1));
        let envelope: Value = serde_json::from_str(&stdout(&output)).unwrap();
        assert_eq!(envelope["error"]["code"], code);
        assert!(envelope.get("result").is_none());
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn identity_human_output_is_narrow_and_does_not_match_a_similar_workspace() {
    let dir = tempfile::tempdir().unwrap();
    let service = snapshot_service(
        dir.path(),
        json!({
            "hostId": "host-1", "workspaceId": "", "history": ["private history"],
            "bots": [
                {"id": "wrong-bot", "home": {"homeWorkspaceId": "home-10"}},
                {"id": "bot-1", "instructions": "private instructions", "home": {"homeWorkspaceId": "home-1"}}
            ]
        }),
        true,
    );
    let output = run_cli_with(
        dir.path(),
        &["bot", "whoami"],
        &[("DROGON_WORKSPACE_ID", "home-1")],
    );
    assert!(output.status.success(), "{output:?}");
    assert_eq!(stdout(&output).trim(), "bot bot-1\nworkspace home-1");
    let captured = service.captured();
    assert_eq!(captured[1]["method"], "bot.snapshot");
    assert_eq!(
        captured[1]["params"],
        json!({"hostId": "host-1", "workspaceId": "", "locale": "en"})
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn identity_requires_session_environment_and_existing_snapshot_capability() {
    let dir = tempfile::tempdir().unwrap();
    let service = snapshot_service(dir.path(), Value::Null, false);
    let output = run_cli_with(
        dir.path(),
        &["bot", "whoami", "--json"],
        &[("DROGON_WORKSPACE_ID", "")],
    );
    assert_eq!(output.status.code(), Some(2));
    assert!(stderr(&output).contains("DROGON_WORKSPACE_ID is missing"));
    assert!(service.captured().is_empty());
    let output = run_cli_with(
        dir.path(),
        &["bot", "whoami", "--json"],
        &[("DROGON_WORKSPACE_ID", "home-1")],
    );
    assert_eq!(output.status.code(), Some(1));
    assert!(stdout(&output).contains("bot.snapshot.v1"));
    assert_eq!(service.captured().len(), 1);
}
