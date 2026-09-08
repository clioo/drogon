//! Headless daemon runs (issue #186): `harness.start` with `headless: true`
//! launches each harness's non-interactive entrypoint (`pi -p`,
//! `claude -p`, `opencode run`, `agy -p`), installs no hook wiring, and a
//! hook wait signal against the headless session never reports
//! `needs_input`. Against real `portable-pty` children and a real SQLite
//! file per test (Unix-only, like `agent_state_hook_events.rs`). No model
//! inference: `pi`/`opencode` are fixture shell scripts on PATH.
#![cfg(unix)]

use std::sync::Mutex;
use std::time::{Duration, Instant};

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

/// Serializes every test in this file: all of them mutate the process
/// `PATH` (prepend-only, restored afterwards), read at `harness.start` time.
static ENV_LOCK: Mutex<()> = Mutex::new(());

fn req(method: &str, request_id: &str, params: Value) -> Request {
    serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": request_id,
        "method": method,
        "params": params,
    }))
    .unwrap()
}

fn ok(engine: &Engine, method: &str, params: Value) -> Value {
    let request_id = uuid::Uuid::new_v4().to_string();
    let response = engine.dispatch(req(method, &request_id, params));
    assert!(
        response.ok,
        "expected ok for {method}: {:?}",
        response.error
    );
    response.result.unwrap()
}

fn register_workspace(engine: &Engine) -> String {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_string_lossy().to_string();
    std::mem::forget(dir);
    let ws = ok(engine, "workspace.register", json!({ "path": path }));
    ws["id"].as_str().unwrap().to_string()
}

fn base64_decode(text: &str) -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .unwrap()
}

/// Restores an env var on drop so no test here can leak state into another.
struct SavedEnv {
    key: &'static str,
    value: Option<std::ffi::OsString>,
}

impl SavedEnv {
    fn capture(key: &'static str) -> Self {
        Self {
            key,
            value: std::env::var_os(key),
        }
    }
}

impl Drop for SavedEnv {
    fn drop(&mut self) {
        match self.value.take() {
            Some(value) => unsafe { std::env::set_var(self.key, value) },
            None => unsafe { std::env::remove_var(self.key) },
        }
    }
}

fn prepend_fixture_bin(bin: &std::path::Path) {
    let mut paths =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect::<Vec<_>>();
    paths.insert(0, bin.to_path_buf());
    let joined = std::env::join_paths(paths).unwrap();
    unsafe { std::env::set_var("PATH", joined) };
}

fn write_fixture_script(bin: &std::path::Path, name: &str, body: &str) {
    let script = bin.join(name);
    std::fs::write(&script, format!("#!/bin/sh\n{body}\n")).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn argv_of(session: &Value) -> Vec<String> {
    session["args"]
        .as_array()
        .unwrap()
        .iter()
        .map(|arg| arg.as_str().unwrap().to_string())
        .collect()
}

/// Polls `session.read` until the session verdict is `exited`, returning the
/// retained output. Panics past `timeout` so a wiring regression fails
/// loudly instead of hanging.
fn read_until_exited(
    engine: &Engine,
    session_id: &str,
    incarnation: &str,
    timeout: Duration,
) -> String {
    let deadline = Instant::now() + timeout;
    let mut cursor = 0u64;
    let mut text = String::new();
    while Instant::now() < deadline {
        let read = ok(
            engine,
            "session.read",
            json!({ "sessionId": session_id, "incarnation": incarnation, "cursor": cursor }),
        );
        let bytes = base64_decode(read["dataBase64"].as_str().unwrap());
        text.push_str(&String::from_utf8_lossy(&bytes));
        cursor = read["nextCursor"].as_u64().unwrap();
        if read["session"]["verdict"] == "exited" {
            return text;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("timed out waiting for session exit; output so far: {text:?}");
}

#[test]
fn pi_headless_uses_print_mode_installs_no_hooks_and_ignores_wait_signals() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");

    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);

    let bin = tempfile::tempdir().unwrap();
    // Stays alive briefly so the hook event below races a live session,
    // then exits on its own like `pi -p` does after answering.
    write_fixture_script(bin.path(), "pi", "echo HEADLESS_READY\nsleep 5");
    prepend_fixture_bin(bin.path());

    let launched = ok(
        &engine,
        "harness.start",
        json!({ "workspaceId": workspace_id, "harnessId": "pi", "prompt": "hi", "headless": true }),
    );
    let args = argv_of(&launched);
    assert!(
        args.contains(&"-p".to_string()),
        "headless Pi must go through print mode: {args:?}"
    );
    assert!(
        !args.iter().any(|arg| arg == "--extension"),
        "headless runs install no hook extension: {args:?}"
    );
    let session_id = launched["id"].as_str().unwrap().to_string();
    let incarnation = launched["incarnation"].as_str().unwrap().to_string();

    // The exact signal #186 stalled on: a headless run must never report it.
    let snapshot = ok(
        &engine,
        "session.hook_event",
        json!({ "sessionId": session_id, "incarnation": incarnation, "event": "ToolApprovalRequested" }),
    );
    assert_ne!(
        snapshot["agentState"], "needs_input",
        "a hook wait signal must not pin a headless run at needs_input"
    );

    let text = read_until_exited(&engine, &session_id, &incarnation, Duration::from_secs(15));
    assert!(
        text.contains("HEADLESS_READY"),
        "the headless process output stays readable after exit: {text:?}"
    );
}

#[test]
fn pi_interactive_keeps_the_tui_and_its_wait_signal() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");

    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);

    let bin = tempfile::tempdir().unwrap();
    write_fixture_script(bin.path(), "pi", "sleep 30");
    prepend_fixture_bin(bin.path());

    // No `headless` key at all: user-facing tabs keep the interactive TUI.
    let launched = ok(
        &engine,
        "harness.start",
        json!({ "workspaceId": workspace_id, "harnessId": "pi", "prompt": "hi" }),
    );
    let args = argv_of(&launched);
    assert!(
        !args.contains(&"-p".to_string()),
        "interactive Pi must not go through print mode: {args:?}"
    );
    assert!(
        args.iter().any(|arg| arg == "--extension"),
        "interactive Pi keeps its agent-status extension: {args:?}"
    );
    let session_id = launched["id"].as_str().unwrap().to_string();
    let incarnation = launched["incarnation"].as_str().unwrap().to_string();

    let snapshot = ok(
        &engine,
        "session.hook_event",
        json!({ "sessionId": session_id, "incarnation": incarnation, "event": "ToolApprovalRequested" }),
    );
    assert_eq!(
        snapshot["agentState"], "needs_input",
        "interactive sessions keep the R14-C wait signal"
    );

    ok(
        &engine,
        "session.stop",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    );
}

#[test]
fn opencode_headless_dispatches_the_run_subcommand() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let _saved_config_dir = SavedEnv::capture("OPENCODE_CONFIG_DIR");
    unsafe { std::env::remove_var("OPENCODE_CONFIG_DIR") };

    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);

    let bin = tempfile::tempdir().unwrap();
    write_fixture_script(bin.path(), "opencode", "sleep 30");
    prepend_fixture_bin(bin.path());

    let launched = ok(
        &engine,
        "harness.start",
        json!({ "workspaceId": workspace_id, "harnessId": "opencode", "prompt": "hi", "headless": true }),
    );
    let args = argv_of(&launched);
    assert_eq!(
        args.first().map(String::as_str),
        Some("run"),
        "headless OpenCode must dispatch the run subcommand: {args:?}"
    );
    assert!(
        args.contains(&"hi".to_string()),
        "the prompt goes to run as a message positional: {args:?}"
    );
    let session_id = launched["id"].as_str().unwrap().to_string();
    let incarnation = launched["incarnation"].as_str().unwrap().to_string();
    ok(
        &engine,
        "session.stop",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    );
}
