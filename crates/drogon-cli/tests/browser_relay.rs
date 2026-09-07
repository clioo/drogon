//! Browser relay CLI: one invocation enqueues one relay command, renders
//! human and JSON output, and surfaces `desktop_not_connected` unchanged.

#![cfg(unix)]

mod common;

use common::{Behavior, MockService, TOKEN, error_envelope, ok_envelope, stderr, stdout};
use serde_json::{Value, json};
use std::sync::Arc;

fn tab_result() -> Value {
    json!({
        "tabId": "browser-tab-1", "workspaceId": "w1",
        "url": "https://example.test/", "title": "Example",
        "loading": false, "canGoBack": false, "canGoForward": false,
        "error": null,
    })
}

fn relay_behavior() -> Behavior {
    Arc::new(|request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => common::Action::Respond(ok_envelope(
                &id,
                json!({
                    "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
                    "capabilities": ["workspace.v1", "session.pty.v1", "browser.relay.v1"],
                    "version": "0.1.0",
                }),
            )),
            Some("browser.snapshot") => common::Action::Respond(ok_envelope(
                &id,
                json!({
                    "tabId": "browser-tab-1", "url": "https://example.test/",
                    "title": "Example", "text": "hello fixture", "truncated": false,
                }),
            )),
            Some("browser.open")
            | Some("browser.navigate")
            | Some("browser.click")
            | Some("browser.fill") => common::Action::Respond(ok_envelope(&id, tab_result())),
            Some("browser.tabs") => {
                common::Action::Respond(ok_envelope(&id, json!({"tabs": [tab_result()]})))
            }
            _ => common::Action::Respond(error_envelope(&id, "method_not_found", "no such method")),
        }
    })
}

fn mock() -> (tempfile::TempDir, MockService) {
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("data");
    let service = MockService::start(&data_dir, relay_behavior());
    (dir, service)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn snapshot_renders_human_text_and_json_envelope() {
    let (_hold, service) = mock();
    let output = common::run_cli(
        &service.data_dir,
        &["browser", "snapshot", "--tab", "browser-tab-1"],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let text = stdout(&output);
    assert!(text.contains("tab browser-tab-1"), "stdout: {text}");
    assert!(text.contains("hello fixture"), "stdout: {text}");

    let output = common::run_cli(
        &service.data_dir,
        &["--json", "browser", "snapshot", "--tab", "browser-tab-1"],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(envelope["ok"], true);
    assert_eq!(envelope["result"]["text"], "hello fixture");
    assert_eq!(envelope["result"]["truncated"], false);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn open_sends_workspace_url_and_timeout() {
    let (_hold, service) = mock();
    let output = common::run_cli(
        &service.data_dir,
        &[
            "browser",
            "open",
            "--workspace",
            "w1",
            "https://example.test/",
            "--timeout-ms",
            "5000",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    assert!(
        stdout(&output).contains("Opened"),
        "stdout: {}",
        stdout(&output)
    );
    let open = service
        .captured()
        .into_iter()
        .find(|request| request["method"] == "browser.open")
        .expect("mock saw browser.open");
    assert_eq!(open["params"]["workspaceId"], "w1");
    assert_eq!(open["params"]["url"], "https://example.test/");
    assert_eq!(open["params"]["timeoutMs"], 5000);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn tabs_lists_workspace_tabs() {
    let (_hold, service) = mock();
    let output = common::run_cli(&service.data_dir, &["browser", "tabs", "--workspace", "w1"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    assert!(
        stdout(&output).contains("browser-tab-1"),
        "stdout: {}",
        stdout(&output)
    );
    let tabs = service
        .captured()
        .into_iter()
        .find(|request| request["method"] == "browser.tabs")
        .expect("mock saw browser.tabs");
    assert_eq!(tabs["params"]["workspaceId"], "w1");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn desktop_not_connected_surfaces_typed_error() {
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("data");
    let behavior: Behavior = Arc::new(|request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => common::Action::Respond(ok_envelope(
                &id,
                json!({
                    "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
                    "capabilities": ["browser.relay.v1"], "version": "0.1.0",
                }),
            )),
            _ => common::Action::Respond({
                let mut envelope = error_envelope(&id, "desktop_not_connected", "no desktop");
                envelope["error"]["retryable"] = json!(true);
                envelope
            }),
        }
    });
    let service = MockService::start(&data_dir, behavior);
    let output = common::run_cli(
        &service.data_dir,
        &["browser", "snapshot", "--tab", "browser-tab-1"],
    );
    assert_eq!(output.status.code(), Some(1), "stdout: {}", stdout(&output));
    assert!(
        stderr(&output).contains("desktop_not_connected"),
        "stderr: {}",
        stderr(&output)
    );

    let output = common::run_cli(
        &service.data_dir,
        &["--json", "browser", "snapshot", "--tab", "browser-tab-1"],
    );
    assert_eq!(output.status.code(), Some(1));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON failure envelope");
    assert_eq!(envelope["ok"], false);
    assert_eq!(envelope["error"]["code"], "desktop_not_connected");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn missing_capability_refuses_before_the_relay() {
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("data");
    let service = MockService::start(&data_dir, common::status_ok_behavior());
    let output = common::run_cli(&service.data_dir, &["browser", "tabs", "--workspace", "w1"]);
    assert_eq!(output.status.code(), Some(1), "stdout: {}", stdout(&output));
    assert!(
        stderr(&output).contains("browser.relay.v1"),
        "stderr: {}",
        stderr(&output)
    );
    assert!(
        service
            .captured()
            .iter()
            .all(|request| request["method"] != "browser.tabs"),
        "no relay call without the capability"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn empty_tab_is_a_usage_error_without_io() {
    let hold = tempfile::tempdir().expect("hold tempdir");
    let missing = hold.path().join("no-runtime-here");
    let output = common::run_cli(&missing, &["browser", "snapshot", "--tab", ""]);
    assert_eq!(output.status.code(), Some(2));
    assert!(stdout(&output).is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn auth_token_is_never_printed() {
    let (_hold, service) = mock();
    let output = common::run_cli(
        &service.data_dir,
        &["browser", "snapshot", "--tab", "browser-tab-1"],
    );
    assert!(!stdout(&output).contains(TOKEN));
    assert!(!stderr(&output).contains(TOKEN));
}
