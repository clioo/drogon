//! C01 consumer: the existing `harness.start` admission validates the
//! explicit selection with the real C01 vocabulary before any planning.
//!
//! Refusal-path tests only: every case errors before session admission,
//! so no PTY is spawned and `session.list` stays empty (filesystem-only:
//! a temp data dir plus SQLite, no processes, no probes, no network).
//! Host fencing and argv planning stay with the existing plan path
//! (unchanged); these tests pin the gate's refusal codes through the
//! real RPC surface.

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

fn call(engine: &Engine, method: &str, params: Value) -> drogon_protocol::Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        auth: None,
        method: method.into(),
        params,
    })
}

fn sessions_len(engine: &Engine) -> usize {
    call(engine, "session.list", json!({})).result.unwrap()["sessions"]
        .as_array()
        .unwrap()
        .len()
}

fn start(engine: &Engine, params: Value) -> drogon_protocol::Response {
    call(engine, "harness.start", params)
}

#[test]
fn provider_selection_outside_pi_is_refused_without_spawn() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let response = start(
        &engine,
        json!({"workspaceId": "missing", "harnessId": "claude", "provider": "anthropic"}),
    );
    assert_eq!(response.error.unwrap().code, "invalid_argument");
    assert_eq!(sessions_len(&engine), 0);
}

#[test]
fn unsupported_effort_is_refused_per_harness_without_spawn() {
    // Same per-harness table the launch adapter enforces
    // (`allowed_efforts`): opencode advertises no effort flag at all.
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    for (harness, effort) in [
        ("claude", "turbo"),
        ("claude", "off"),
        ("pi", "ultra"),
        ("opencode", "high"),
        ("antigravity", "max"),
        ("codex", "off"),
    ] {
        let response = start(
            &engine,
            json!({"workspaceId": "missing", "harnessId": harness, "effort": effort}),
        );
        assert_eq!(
            response.error.unwrap().code,
            "invalid_argument",
            "{harness}/{effort}"
        );
    }
    assert_eq!(sessions_len(&engine), 0);
}

#[test]
fn malformed_selection_values_are_refused_without_spawn() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    for params in [
        json!({"workspaceId": "missing", "harnessId": "pi", "model": "-x"}),
        json!({"workspaceId": "missing", "harnessId": "pi", "model": "bad\nvalue"}),
        json!({"workspaceId": "missing", "harnessId": "pi", "effort": "--xhigh"}),
        json!({"workspaceId": "missing", "harnessId": "codex", "provider": "x"}),
    ] {
        let response = start(&engine, params);
        assert_eq!(response.error.unwrap().code, "invalid_argument");
    }
    assert_eq!(sessions_len(&engine), 0);
}
