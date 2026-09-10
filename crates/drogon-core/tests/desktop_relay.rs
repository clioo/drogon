//! Daemon-mediated desktop command relay (`browser.relay.v1`): enqueue via
//! `browser.*`, long-poll via `desktop.commands.poll`, finish via
//! `desktop.commands.complete`, and the typed `desktop_not_connected`
//! timeout when no desktop answers.

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::{Duration, Instant};

fn call(engine: &Engine, id: &str, method: &str, params: Value) -> Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    })
}

fn fixture() -> (tempfile::TempDir, Arc<Engine>) {
    let root = tempfile::tempdir().unwrap();
    let engine = Engine::open(&root.path().join("data")).unwrap();
    (root, Arc::new(engine))
}

fn error_code(response: &Response) -> &str {
    assert!(!response.ok, "{response:?}");
    response.error.as_ref().unwrap().code.as_str()
}

#[test]
fn status_advertises_the_relay_capability() {
    let (_root, engine) = fixture();
    let status = call(&engine, "status", "status", json!({}));
    assert!(status.ok, "{status:?}");
    let capabilities = status.result.unwrap()["capabilities"].clone();
    assert!(
        capabilities
            .as_array()
            .unwrap()
            .iter()
            .any(|cap| cap == "browser.relay.v1"),
        "{capabilities:?}"
    );
}

#[test]
fn enqueue_poll_complete_roundtrip_returns_the_desktop_result() {
    let (_root, engine) = fixture();
    let waiter = Arc::clone(&engine);
    let handle = std::thread::spawn(move || {
        call(
            &waiter,
            "open",
            "browser.open",
            json!({"workspaceId": "w1", "url": "https://example.test/", "timeoutMs": 5000}),
        )
    });
    // The desktop long-poll observes the enqueued command with its kind and
    // wire params, exactly once.
    let polled = call(
        &engine,
        "poll",
        "desktop.commands.poll",
        json!({"clientId": "desktop-1", "waitMs": 5000}),
    );
    assert!(polled.ok, "{polled:?}");
    let commands = polled.result.unwrap()["commands"].clone();
    assert_eq!(commands.as_array().unwrap().len(), 1);
    let command = &commands[0];
    assert_eq!(command["kind"], "browser.open");
    assert_eq!(command["params"]["workspaceId"], "w1");
    assert_eq!(command["params"]["url"], "https://example.test/");
    let command_id = command["commandId"].as_str().unwrap().to_string();

    let second = call(
        &engine,
        "poll-again",
        "desktop.commands.poll",
        json!({"clientId": "desktop-1", "waitMs": 100}),
    );
    assert!(second.ok, "{second:?}");
    assert_eq!(
        second.result.unwrap()["commands"].as_array().unwrap().len(),
        0
    );

    let completed = call(
        &engine,
        "complete",
        "desktop.commands.complete",
        json!({"commandId": command_id, "ok": true, "result": {"tabId": "browser-tab-1"}}),
    );
    assert!(completed.ok, "{completed:?}");

    let opened = handle.join().unwrap();
    assert!(opened.ok, "{opened:?}");
    assert_eq!(opened.result.unwrap()["tabId"], "browser-tab-1");
}

#[test]
fn desktop_failure_propagates_its_typed_error() {
    let (_root, engine) = fixture();
    let waiter = Arc::clone(&engine);
    let handle = std::thread::spawn(move || {
        call(
            &waiter,
            "click",
            "browser.click",
            json!({"tabId": "browser-tab-9", "selector": "#missing", "timeoutMs": 5000}),
        )
    });
    let polled = call(
        &engine,
        "poll",
        "desktop.commands.poll",
        json!({"clientId": "desktop-1", "waitMs": 5000}),
    );
    let command_id = polled.result.unwrap()["commands"][0]["commandId"].clone();
    let completed = call(
        &engine,
        "complete",
        "desktop.commands.complete",
        json!({
            "commandId": command_id,
            "ok": false,
            "error": {"code": "browser_no_tab", "message": "Tab is not open."},
        }),
    );
    assert!(completed.ok, "{completed:?}");
    let clicked = handle.join().unwrap();
    assert_eq!(error_code(&clicked), "browser_no_tab");
}

#[test]
fn unanswered_command_times_out_to_desktop_not_connected() {
    let (_root, engine) = fixture();
    let start = Instant::now();
    let response = call(
        &engine,
        "snapshot",
        "browser.snapshot",
        json!({"tabId": "browser-tab-1", "timeoutMs": 150}),
    );
    let elapsed = start.elapsed();
    assert_eq!(error_code(&response), "desktop_not_connected");
    assert!(response.error.as_ref().unwrap().retryable);
    assert!(
        elapsed < Duration::from_secs(5),
        "the timeout must bound the wait, took {elapsed:?}"
    );
    // The timed-out command is gone: a later poll sees an empty queue.
    let polled = call(
        &engine,
        "poll",
        "desktop.commands.poll",
        json!({"clientId": "desktop-1", "waitMs": 50}),
    );
    assert!(polled.ok, "{polled:?}");
    assert_eq!(
        polled.result.unwrap()["commands"].as_array().unwrap().len(),
        0
    );
}

#[test]
fn mentu_open_rides_the_same_relay_and_carries_its_recipe() {
    let (_root, engine) = fixture();
    let waiter = Arc::clone(&engine);
    let handle = std::thread::spawn(move || {
        call(
            &waiter,
            "mentu-open",
            "mentu.open",
            json!({"workspaceId": "w1", "recipeId": "hello", "timeoutMs": 5000}),
        )
    });
    let polled = call(
        &engine,
        "poll",
        "desktop.commands.poll",
        json!({"clientId": "desktop-1", "waitMs": 5000}),
    );
    assert!(polled.ok, "{polled:?}");
    let commands = polled.result.unwrap()["commands"].clone();
    assert_eq!(commands.as_array().unwrap().len(), 1);
    assert_eq!(commands[0]["kind"], "mentu.open");
    assert_eq!(commands[0]["params"]["workspaceId"], "w1");
    assert_eq!(commands[0]["params"]["recipeId"], "hello");
    let command_id = commands[0]["commandId"].as_str().unwrap().to_string();

    // The completion is the RENDERER's verdict (the Mentu tab is renderer
    // state), relayed verbatim back to the CLI waiter.
    let completed = call(
        &engine,
        "complete",
        "desktop.commands.complete",
        json!({
            "commandId": command_id,
            "ok": true,
            "result": {"workspaceId": "w1", "recipeId": "hello", "opened": true}
        }),
    );
    assert!(completed.ok, "{completed:?}");
    let answered = handle.join().expect("waiter thread");
    assert!(answered.ok, "{answered:?}");
    assert_eq!(answered.result.unwrap()["opened"], true);
}

#[test]
fn mentu_open_without_recipe_omits_the_field_and_rejects_an_empty_id() {
    let (_root, engine) = fixture();
    let waiter = Arc::clone(&engine);
    let handle = std::thread::spawn(move || {
        call(
            &waiter,
            "mentu-open",
            "mentu.open",
            json!({"workspaceId": "w1", "timeoutMs": 5000}),
        )
    });
    let polled = call(
        &engine,
        "poll",
        "desktop.commands.poll",
        json!({"clientId": "desktop-1", "waitMs": 5000}),
    );
    assert!(polled.ok, "{polled:?}");
    let commands = polled.result.unwrap()["commands"].clone();
    let params = commands[0]["params"].clone();
    assert_eq!(params["workspaceId"], "w1");
    assert!(params.get("recipeId").is_none(), "{params:?}");
    let command_id = commands[0]["commandId"].as_str().unwrap().to_string();
    call(
        &engine,
        "complete",
        "desktop.commands.complete",
        json!({"commandId": command_id, "ok": true, "result": {"opened": true}}),
    );
    let _ = handle.join().expect("waiter thread");

    // An empty recipe id is refused before anything is enqueued.
    let refused = call(
        &engine,
        "mentu-empty",
        "mentu.open",
        json!({"workspaceId": "w1", "recipeId": ""}),
    );
    assert_eq!(error_code(&refused), "invalid_argument");
    let empty_workspace = call(
        &engine,
        "mentu-no-workspace",
        "mentu.open",
        json!({"timeoutMs": 1000}),
    );
    assert_eq!(error_code(&empty_workspace), "invalid_argument");
}

#[test]
fn long_poll_waits_for_a_late_command() {
    let (_root, engine) = fixture();
    let poller = Arc::clone(&engine);
    let handle = std::thread::spawn(move || {
        call(
            &poller,
            "poll",
            "desktop.commands.poll",
            json!({"clientId": "desktop-1", "waitMs": 5000}),
        )
    });
    std::thread::sleep(Duration::from_millis(200));
    let waiter = Arc::clone(&engine);
    let tabs = std::thread::spawn(move || {
        call(
            &waiter,
            "tabs",
            "browser.tabs",
            json!({"workspaceId": "w1", "timeoutMs": 5000}),
        )
    });
    let polled = handle.join().unwrap();
    assert!(polled.ok, "{polled:?}");
    let commands = polled.result.unwrap()["commands"].clone();
    assert_eq!(commands.as_array().unwrap().len(), 1);
    assert_eq!(commands[0]["kind"], "browser.tabs");
    let command_id = commands[0]["commandId"].clone();
    let completed = call(
        &engine,
        "complete",
        "desktop.commands.complete",
        json!({"commandId": command_id, "ok": true, "result": {"tabs": []}}),
    );
    assert!(completed.ok, "{completed:?}");
    let listed = tabs.join().unwrap();
    assert!(listed.ok, "{listed:?}");
}

#[test]
fn oversized_snapshot_text_is_capped_not_rejected() {
    let (_root, engine) = fixture();
    let waiter = Arc::clone(&engine);
    let handle = std::thread::spawn(move || {
        call(
            &waiter,
            "snapshot",
            "browser.snapshot",
            json!({"tabId": "browser-tab-1", "timeoutMs": 5000}),
        )
    });
    let polled = call(
        &engine,
        "poll",
        "desktop.commands.poll",
        json!({"clientId": "desktop-1", "waitMs": 5000}),
    );
    let command_id = polled.result.unwrap()["commands"][0]["commandId"].clone();
    let big = "x".repeat(40_000);
    let completed = call(
        &engine,
        "complete",
        "desktop.commands.complete",
        json!({
            "commandId": command_id,
            "ok": true,
            "result": {
                "tabId": "browser-tab-1", "url": "https://example.test/",
                "title": "Example", "text": big, "truncated": false,
            },
        }),
    );
    assert!(completed.ok, "{completed:?}");
    let snapshot = handle.join().unwrap();
    assert!(snapshot.ok, "{snapshot:?}");
    let result = snapshot.result.unwrap();
    assert_eq!(result["text"].as_str().unwrap().chars().count(), 32_768);
    assert_eq!(result["truncated"], true);
}

#[test]
fn invalid_params_fail_fast_without_enqueueing() {
    let (_root, engine) = fixture();
    for (method, params) in [
        (
            "browser.navigate",
            json!({"tabId": "", "url": "https://example.test/"}),
        ),
        (
            "browser.snapshot",
            json!({"tabId": "browser-tab-1", "timeoutMs": 0}),
        ),
        (
            "browser.click",
            json!({"tabId": "browser-tab-1", "selector": ""}),
        ),
        (
            "browser.fill",
            json!({"tabId": "browser-tab-1", "selector": "#a", "text": "x\0y"}),
        ),
        (
            "browser.open",
            json!({"workspaceId": "w1", "timeoutMs": 99_999}),
        ),
        (
            "desktop.commands.poll",
            json!({"clientId": "", "waitMs": 10}),
        ),
        (
            "desktop.commands.complete",
            json!({"commandId": "relay-1", "ok": true}),
        ),
    ] {
        let response = call(&engine, "bad", method, params);
        assert_eq!(error_code(&response), "invalid_argument", "{method}");
    }
    let polled = call(
        &engine,
        "poll",
        "desktop.commands.poll",
        json!({"clientId": "desktop-1", "waitMs": 50}),
    );
    assert!(polled.ok, "{polled:?}");
    assert_eq!(
        polled.result.unwrap()["commands"].as_array().unwrap().len(),
        0
    );
}

#[test]
fn completing_an_unknown_command_is_not_found() {
    let (_root, engine) = fixture();
    let response = call(
        &engine,
        "complete",
        "desktop.commands.complete",
        json!({"commandId": "relay-999", "ok": true, "result": {}}),
    );
    assert_eq!(error_code(&response), "not_found");
}
