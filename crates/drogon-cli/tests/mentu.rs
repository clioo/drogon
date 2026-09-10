//! `drogon-cli mentu`: the environment check must be honest (installed /
//! not_installed / partially_available, never an optimistic guess) and
//! `mentu open` must only report success when the desktop confirmed the tab.

#![cfg(unix)]

mod common;

use common::{Action, Behavior, MockService, error_envelope, ok_envelope, stderr, stdout};
use serde_json::{Value, json};
use std::sync::Arc;

fn runtime_result(overrides: Value) -> Value {
    let mut base = json!({
        "available": true,
        "path": "/data/mentu/runtime/bin/mentu-recipes",
        "version": "mentu-recipes 0.5.0",
        "expectedRevision": "c82ccfa0ebbe77d62193e068821ba6e74f87a8d3",
        "expectedSha256": "f00528a940185e9433ad65b02e7de251d7d3d856c9d24d38f8b1474a1ca8bc5d",
        "actualSha256": "f00528a940185e9433ad65b02e7de251d7d3d856c9d24d38f8b1474a1ca8bc5d",
        "lockMatches": true,
        "message": null,
    });
    for (key, value) in overrides.as_object().expect("object") {
        base[key] = value.clone();
    }
    json!({ "runtime": base })
}

fn recipes_result() -> Value {
    json!({
        "recipes": [
            { "id": "hello", "path": ".mentu/recipes/hello.json", "name": "Hello",
              "valid": true, "issue": null },
            { "id": "broken", "path": ".mentu/recipes/broken.json", "name": null,
              "valid": false, "issue": "missing steps" },
        ]
    })
}

fn behavior(runtime: Value, recipes: Value) -> Behavior {
    Arc::new(move |request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(ok_envelope(
                &id,
                json!({
                    "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
                    "capabilities": [
                        "workspace.v1", "session.pty.v1", "mentu.v1", "browser.relay.v1",
                    ],
                    "version": "0.1.0",
                }),
            )),
            Some("mentu.runtime") => Action::Respond(ok_envelope(&id, runtime.clone())),
            Some("mentu.recipes") => Action::Respond(ok_envelope(&id, recipes.clone())),
            Some("mentu.open") => Action::Respond(ok_envelope(
                &id,
                json!({
                    "workspaceId": request["params"]["workspaceId"],
                    "recipeId": request["params"].get("recipeId").cloned().unwrap_or(Value::Null),
                    "opened": true,
                }),
            )),
            _ => Action::Respond(error_envelope(
                &id,
                "method_not_found",
                "mock does not implement this method",
            )),
        }
    })
}

fn mock(runtime: Value, recipes: Value) -> (tempfile::TempDir, MockService) {
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("data");
    let service = MockService::start(&data_dir, behavior(runtime, recipes));
    (dir, service)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn installed_runtime_reports_installed_with_the_workspace_inventory() {
    let (_hold, service) = mock(runtime_result(json!({})), recipes_result());
    let output = common::run_cli(
        &service.data_dir,
        &["--json", "mentu", "status", "--workspace", "ws-1"],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(envelope["ok"], true);
    assert_eq!(envelope["result"]["verdict"], "installed");
    assert_eq!(envelope["result"]["workspace"]["id"], "ws-1");
    assert_eq!(envelope["result"]["workspace"]["recipes"]["total"], 2);
    assert_eq!(envelope["result"]["workspace"]["recipes"]["valid"], 1);
    assert_eq!(
        envelope["result"]["workspace"]["recipes"]["invalid"][0]["id"],
        "broken"
    );
    assert_eq!(
        envelope["result"]["workspace"]["recipes"]["invalid"][0]["issue"],
        "missing steps"
    );
    assert!(
        envelope["result"]["summary"]
            .as_str()
            .unwrap()
            .contains("matches the approved lock"),
        "{envelope:?}"
    );

    // Human text leads with the verdict, so a reader cannot miss it.
    let output = common::run_cli(
        &service.data_dir,
        &["mentu", "status", "--workspace", "ws-1"],
    );
    let text = stdout(&output);
    assert!(
        text.starts_with("Mentu environment: installed"),
        "stdout: {text}"
    );
    assert!(text.contains("recipes: 2 total, 1 valid"), "stdout: {text}");
    assert!(
        text.contains("invalid broken: missing steps"),
        "stdout: {text}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn absent_runtime_reports_not_installed_and_never_optimistic() {
    let (_hold, service) = mock(
        runtime_result(json!({
            "available": false,
            "version": null,
            "actualSha256": null,
            "lockMatches": false,
            "message": "Mentu Recipes is unavailable on the execution host.",
        })),
        recipes_result(),
    );
    let output = common::run_cli(&service.data_dir, &["--json", "mentu", "status"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(envelope["result"]["verdict"], "not_installed");
    // No workspace was asked for: the recipe half is unknown, never zero.
    assert_eq!(envelope["result"]["workspace"], Value::Null);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lock_mismatch_reports_partially_available() {
    let (_hold, service) = mock(
        runtime_result(json!({
            "available": false,
            "lockMatches": false,
            "actualSha256": "0000000000000000000000000000000000000000000000000000000000000000",
            "message": "The application-owned Mentu runtime does not match the approved runtime lock.",
        })),
        recipes_result(),
    );
    let output = common::run_cli(&service.data_dir, &["--json", "mentu", "status"]);
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(envelope["result"]["verdict"], "partially_available");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_silent_version_probe_is_not_a_full_install() {
    // Bytes match the lock but the binary never answered --version: the
    // honest answer is "partially available", not "installed".
    let (_hold, service) = mock(runtime_result(json!({ "version": null })), recipes_result());
    let output = common::run_cli(&service.data_dir, &["--json", "mentu", "status"]);
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(envelope["result"]["verdict"], "partially_available");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn open_sends_workspace_recipe_and_timeout_then_reports_the_desktop_verdict() {
    let (_hold, service) = mock(runtime_result(json!({})), recipes_result());
    let output = common::run_cli(
        &service.data_dir,
        &[
            "--json",
            "mentu",
            "open",
            "--workspace",
            "ws-1",
            "--recipe",
            "hello",
            "--timeout-ms",
            "4000",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(envelope["result"]["opened"], true);
    assert_eq!(envelope["result"]["workspaceId"], "ws-1");
    assert_eq!(envelope["result"]["recipeId"], "hello");

    let open = service
        .captured()
        .into_iter()
        .find(|request| request["method"] == "mentu.open")
        .expect("mock saw mentu.open");
    assert_eq!(open["params"]["workspaceId"], "ws-1");
    assert_eq!(open["params"]["recipeId"], "hello");
    assert_eq!(open["params"]["timeoutMs"], 4000);

    let output = common::run_cli(
        &service.data_dir,
        &["mentu", "open", "--workspace", "ws-1", "--recipe", "hello"],
    );
    assert!(
        stdout(&output).contains("focused on recipe hello"),
        "stdout: {}",
        stdout(&output)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn open_without_a_recipe_omits_the_field() {
    let (_hold, service) = mock(runtime_result(json!({})), recipes_result());
    let output = common::run_cli(&service.data_dir, &["mentu", "open", "--workspace", "ws-1"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let open = service
        .captured()
        .into_iter()
        .find(|request| request["method"] == "mentu.open")
        .expect("mock saw mentu.open");
    assert!(
        open["params"].get("recipeId").is_none(),
        "params: {:?}",
        open["params"]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn desktop_not_connected_surfaces_instead_of_a_fake_open() {
    let behavior: Behavior = Arc::new(|request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(ok_envelope(
                &id,
                json!({
                    "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
                    "capabilities": ["mentu.v1", "browser.relay.v1"],
                    "version": "0.1.0",
                }),
            )),
            Some("mentu.open") => Action::Respond(error_envelope(
                &id,
                "desktop_not_connected",
                "No connected Drogon desktop completed the browser command within 15000ms.",
            )),
            _ => Action::Respond(error_envelope(&id, "method_not_found", "no such method")),
        }
    });
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("data");
    let service = MockService::start(&data_dir, behavior);
    let output = common::run_cli(&service.data_dir, &["mentu", "open", "--workspace", "ws-1"]);
    assert_eq!(output.status.code(), Some(1), "stdout: {}", stdout(&output));
    assert!(
        stderr(&output).contains("desktop_not_connected"),
        "stderr: {}",
        stderr(&output)
    );

    let output = common::run_cli(
        &service.data_dir,
        &["--json", "mentu", "open", "--workspace", "ws-1"],
    );
    assert_eq!(output.status.code(), Some(1));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON failure envelope");
    assert_eq!(envelope["ok"], false);
    assert_eq!(envelope["error"]["code"], "desktop_not_connected");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn missing_mentu_capability_refuses_before_any_mentu_call() {
    let behavior: Behavior = Arc::new(|request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(ok_envelope(
                &id,
                json!({
                    "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
                    "capabilities": ["workspace.v1"],
                    "version": "0.1.0",
                }),
            )),
            _ => Action::Respond(error_envelope(&id, "method_not_found", "no such method")),
        }
    });
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("data");
    let service = MockService::start(&data_dir, behavior);
    let output = common::run_cli(&service.data_dir, &["mentu", "status"]);
    assert_eq!(output.status.code(), Some(1), "stdout: {}", stdout(&output));
    assert!(
        stderr(&output).contains("mentu.v1"),
        "stderr: {}",
        stderr(&output)
    );
    assert!(
        service
            .captured()
            .iter()
            .all(|request| request["method"] != "mentu.runtime"),
        "no Mentu call without the capability"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn empty_recipe_is_a_usage_error_without_io() {
    let dir = tempfile::tempdir().expect("tempdir");
    let output = common::run_cli(
        dir.path(),
        &["mentu", "open", "--workspace", "ws-1", "--recipe", ""],
    );
    assert_eq!(output.status.code(), Some(2), "stdout: {}", stdout(&output));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn auth_token_is_never_printed() {
    let (_hold, service) = mock(runtime_result(json!({})), recipes_result());
    let output = common::run_cli(
        &service.data_dir,
        &["--json", "mentu", "status", "--workspace", "ws-1"],
    );
    assert!(!stdout(&output).contains(common::TOKEN));
    assert!(!stderr(&output).contains(common::TOKEN));
}
