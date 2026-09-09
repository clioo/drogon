//! OpenCode's status plugin overlay and Pi's agent-status extension,
//! against real `portable-pty` children and a real SQLite file per test
//! (Unix-only, matching `agent_state_hook_events.rs`). No model inference:
//! `opencode`/`pi` are fixture shell scripts on PATH that echo the env vars
//! and files the daemon installed for them, and the events a real status
//! plugin/extension would report are driven directly through the RPC the
//! hidden `drogon-cli internal hook-event` subcommand calls (same approach
//! `agent_state_hook_events.rs` uses for claude's `Notification`/`Stop`).
#![cfg(unix)]

use std::sync::Mutex;
use std::time::{Duration, Instant};

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

/// Serializes every test in this file: all of them mutate the process
/// `PATH` (prepend-only, restored afterwards) and/or `OPENCODE_CONFIG_DIR`,
/// both read at `harness.start` time.
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

fn hook_event(engine: &Engine, session_id: &str, incarnation: &str, event: &str) -> Value {
    ok(
        engine,
        "session.hook_event",
        json!({ "sessionId": session_id, "incarnation": incarnation, "event": event }),
    )
}

fn base64_of(text: &str) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(text.as_bytes())
}

/// Polls `session.read` until `predicate` matches the accumulated output,
/// returning the latest session snapshot at that point. Panics past
/// `timeout` so a wiring regression fails loudly instead of hanging.
fn read_until(
    engine: &Engine,
    session_id: &str,
    incarnation: &str,
    predicate: impl Fn(&str) -> bool,
    timeout: Duration,
) -> (String, Value) {
    let deadline = Instant::now() + timeout;
    let mut cursor = 0u64;
    let mut text = String::new();
    let mut last = Value::Null;
    while Instant::now() < deadline {
        let read = ok(
            engine,
            "session.read",
            json!({ "sessionId": session_id, "incarnation": incarnation, "cursor": cursor }),
        );
        let bytes = base64_decode(read["dataBase64"].as_str().unwrap());
        text.push_str(&String::from_utf8_lossy(&bytes));
        cursor = read["nextCursor"].as_u64().unwrap();
        last = read["session"].clone();
        if predicate(&text) {
            return (text, last);
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("timed out waiting for predicate; output so far: {text:?} last session: {last:?}");
}

/// Polls for a file's existence: the fixture's `touch $DROGON_HOOK_MARKER`
/// runs on the line right after the echo `read_until` anchors on, so it can
/// still be in flight (a separate forked process) the instant that text is
/// observed in the PTY buffer.
fn wait_for_file(path: &str, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if std::path::Path::new(path).is_file() {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("timed out waiting for file to exist: {path}");
}

/// Restores an env var on drop (prepend-only PATH edits, or a scoped
/// `OPENCODE_CONFIG_DIR`) so no test here can leak state into another.
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

#[test]
fn opencode_harness_start_installs_overlay_and_env_and_removes_it_on_exit() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let _saved_config_dir = SavedEnv::capture("OPENCODE_CONFIG_DIR");
    unsafe { std::env::remove_var("OPENCODE_CONFIG_DIR") };

    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);

    let bin = tempfile::tempdir().unwrap();
    write_fixture_script(
        bin.path(),
        "opencode",
        "echo \"CONFIG_DIR=$OPENCODE_CONFIG_DIR\"\n\
         echo \"HOOK_CLI=$DROGON_HOOK_CLI\"\n\
         echo \"HOOK_INC=$DROGON_HOOK_INCARNATION\"\n\
         echo \"SESSION_ID=$DROGON_SESSION_ID\"\n\
         echo \"HOOK_MARKER=$DROGON_HOOK_MARKER\"\n\
         touch \"$DROGON_HOOK_MARKER\"\n\
         sleep 30",
    );
    prepend_fixture_bin(bin.path());

    let launched = ok(
        &engine,
        "harness.start",
        json!({ "workspaceId": workspace_id, "harnessId": "opencode", "permissionMode": "inherit" }),
    );
    let session_id = launched["id"].as_str().unwrap().to_string();
    let incarnation = launched["incarnation"].as_str().unwrap().to_string();
    assert!(
        !launched["args"]
            .as_array()
            .unwrap()
            .iter()
            .any(|arg| arg == "--settings" || arg == "--extension"),
        "opencode gets env-var wiring only, no extra argv"
    );

    let (text, _) = read_until(
        &engine,
        &session_id,
        &incarnation,
        |t| t.contains("SESSION_ID="),
        Duration::from_secs(5),
    );
    let get = |prefix: &str| {
        text.lines()
            .find_map(|l| l.strip_prefix(prefix))
            .unwrap_or_else(|| panic!("missing {prefix} in output: {text:?}"))
            .trim()
            .to_string()
    };
    let config_dir = get("CONFIG_DIR=");
    assert!(
        config_dir.contains("harness-hooks/opencode/"),
        "overlay must live under <data-dir>/harness-hooks/opencode/: {config_dir}"
    );
    assert_eq!(get("HOOK_INC="), incarnation);
    assert_eq!(get("SESSION_ID="), session_id);
    let hook_cli = get("HOOK_CLI=");
    assert!(
        std::path::Path::new(&hook_cli).is_file(),
        "DROGON_HOOK_CLI must be a real, absolute CLI path: {hook_cli}"
    );
    let marker_path = get("HOOK_MARKER=");
    assert_eq!(
        std::path::Path::new(&marker_path).parent().unwrap(),
        std::path::Path::new(&config_dir),
        "the load marker must live inside the overlay, not the plugins dir"
    );
    wait_for_file(&marker_path, Duration::from_secs(5));

    let plugins_dir = std::path::Path::new(&config_dir).join("plugins");
    let plugin_files: Vec<_> = std::fs::read_dir(&plugins_dir)
        .unwrap_or_else(|e| panic!("overlay plugins dir must exist: {e}"))
        .filter_map(|e| e.ok())
        .collect();
    assert_eq!(plugin_files.len(), 1, "exactly our own plugin file");
    let plugin_source = std::fs::read_to_string(plugin_files[0].path()).unwrap();
    assert!(plugin_source.contains("MIT Copyright (c) 2026 Lovecast Inc."));
    assert!(plugin_source.contains("internal hook-event"));
    for event in [
        "SessionIdle",
        "PermissionRequest",
        "AskUserQuestion",
        "PermissionReplied",
        "QuestionReplied",
        "NewTurn",
        "ToolStart",
    ] {
        assert!(
            plugin_source.contains(event),
            "plugin must wire {event}: {plugin_source}"
        );
    }

    let stopped = ok(
        &engine,
        "session.stop",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    );
    assert_eq!(stopped["verdict"], "exited");
    assert!(
        !std::path::Path::new(&config_dir).exists(),
        "the overlay directory must be removed when the session exits"
    );
    assert!(
        !std::path::Path::new(&marker_path).exists(),
        "the load marker must go with the overlay"
    );
}

#[cfg(unix)]
#[test]
fn opencode_overlay_mirrors_existing_config_and_preserves_the_original() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let _saved_config_dir = SavedEnv::capture("OPENCODE_CONFIG_DIR");

    let user_config = tempfile::tempdir().unwrap();
    std::fs::write(user_config.path().join("opencode.json"), "{}").unwrap();
    std::fs::create_dir_all(user_config.path().join("plugins")).unwrap();
    std::fs::write(
        user_config.path().join("plugins").join("my-plugin.js"),
        "// mine",
    )
    .unwrap();
    unsafe { std::env::set_var("OPENCODE_CONFIG_DIR", user_config.path()) };

    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let bin = tempfile::tempdir().unwrap();
    write_fixture_script(
        bin.path(),
        "opencode",
        "echo \"CONFIG_DIR=$OPENCODE_CONFIG_DIR\"\nsleep 30",
    );
    prepend_fixture_bin(bin.path());

    let launched = ok(
        &engine,
        "harness.start",
        json!({ "workspaceId": workspace_id, "harnessId": "opencode", "permissionMode": "inherit" }),
    );
    let session_id = launched["id"].as_str().unwrap().to_string();
    let incarnation = launched["incarnation"].as_str().unwrap().to_string();
    let (text, _) = read_until(
        &engine,
        &session_id,
        &incarnation,
        |t| t.contains("CONFIG_DIR="),
        Duration::from_secs(5),
    );
    let overlay = text
        .lines()
        .find_map(|l| l.strip_prefix("CONFIG_DIR="))
        .unwrap()
        .trim()
        .to_string();
    let overlay = std::path::Path::new(&overlay);

    assert!(
        std::fs::symlink_metadata(overlay.join("opencode.json"))
            .unwrap()
            .file_type()
            .is_symlink(),
        "the user's top-level config entries must be mirrored as symlinks"
    );
    assert_eq!(
        std::fs::read_to_string(overlay.join("opencode.json")).unwrap(),
        "{}"
    );
    assert_eq!(
        std::fs::read_to_string(overlay.join("plugins").join("my-plugin.js")).unwrap(),
        "// mine",
        "the user's own plugin must be preserved alongside ours"
    );
    assert!(
        overlay
            .join("plugins")
            .join("drogon-opencode-status.js")
            .is_file()
    );

    ok(
        &engine,
        "session.stop",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    );
    // The overlay is gone, but the user's real config directory is untouched.
    assert!(!overlay.exists());
    assert_eq!(
        std::fs::read_to_string(user_config.path().join("opencode.json")).unwrap(),
        "{}"
    );
    assert_eq!(
        std::fs::read_to_string(user_config.path().join("plugins").join("my-plugin.js")).unwrap(),
        "// mine"
    );
}

#[test]
fn pi_harness_start_installs_extension_and_removes_it_on_exit() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");

    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let bin = tempfile::tempdir().unwrap();
    write_fixture_script(
        bin.path(),
        "pi",
        "echo \"HOOK_CLI=$DROGON_HOOK_CLI\"\n\
         echo \"HOOK_INC=$DROGON_HOOK_INCARNATION\"\n\
         echo \"SESSION_ID=$DROGON_SESSION_ID\"\n\
         echo \"HOOK_MARKER=$DROGON_HOOK_MARKER\"\n\
         touch \"$DROGON_HOOK_MARKER\"\n\
         sleep 30",
    );
    prepend_fixture_bin(bin.path());

    let launched = ok(
        &engine,
        "harness.start",
        json!({ "workspaceId": workspace_id, "harnessId": "pi", "permissionMode": "inherit" }),
    );
    let session_id = launched["id"].as_str().unwrap().to_string();
    let incarnation = launched["incarnation"].as_str().unwrap().to_string();

    let args = launched["args"].as_array().unwrap();
    let ext_pos = args
        .iter()
        .position(|a| a == "--extension")
        .expect("pi launches must carry --extension");
    let extension_path = args[ext_pos + 1].as_str().unwrap().to_string();
    assert!(
        extension_path.contains("harness-hooks/pi/") && extension_path.ends_with(".ts"),
        "extension file must live under <data-dir>/harness-hooks/pi/: {extension_path}"
    );
    let source = std::fs::read_to_string(&extension_path)
        .unwrap_or_else(|e| panic!("extension file must exist before pi starts: {e}"));
    assert!(source.contains("MIT Copyright (c) 2026 Lovecast Inc."));
    assert!(source.contains("internal hook-event"));
    assert!(source.contains("export default function (pi)"));
    for event in [
        "AgentStart",
        "ToolStart",
        "ToolApprovalRequested",
        "ToolApprovalResolved",
        "AgentEnd",
    ] {
        assert!(
            source.contains(event),
            "extension must wire {event}: {source}"
        );
    }

    let (text, _) = read_until(
        &engine,
        &session_id,
        &incarnation,
        |t| t.contains("SESSION_ID="),
        Duration::from_secs(5),
    );
    let get = |prefix: &str| {
        text.lines()
            .find_map(|l| l.strip_prefix(prefix))
            .unwrap()
            .trim()
            .to_string()
    };
    assert_eq!(get("HOOK_INC="), incarnation);
    assert_eq!(get("SESSION_ID="), session_id);
    assert!(std::path::Path::new(&get("HOOK_CLI=")).is_file());
    let marker_path = get("HOOK_MARKER=");
    assert_eq!(
        marker_path,
        format!("{extension_path}.loaded"),
        "the marker must be a sibling of the extension file"
    );
    wait_for_file(&marker_path, Duration::from_secs(5));

    let stopped = ok(
        &engine,
        "session.stop",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    );
    assert_eq!(stopped["verdict"], "exited");
    assert!(
        !std::path::Path::new(&extension_path).exists(),
        "the extension file must be removed when the session exits"
    );
    assert!(
        !std::path::Path::new(&marker_path).exists(),
        "the sibling load marker must also be removed when the session exits"
    );
}

/// The core J1 correctness guard: OpenCode/Pi are full TUIs that can repaint
/// while genuinely still waiting, so unlike claude they must not clear
/// `needs_input` on generic PTY output — only their own hook's events may.
/// Drives the wait/clear events directly through `session.hook_event`, the
/// same RPC a real plugin/extension would call. Issue #360 fork parity:
/// the wait events are the genuine user-response signals
/// (`PermissionRequest` / `ToolApprovalRequested`), and the turn-end
/// events (`SessionIdle` / `AgentEnd`) are clears that return a finished
/// turn to the activity-based state, never needs_input.
#[test]
fn opencode_and_pi_needs_input_is_cleared_only_by_the_matching_event_not_by_pty_output() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");

    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let bin = tempfile::tempdir().unwrap();
    for name in ["opencode", "pi"] {
        write_fixture_script(bin.path(), name, "sleep 30");
    }
    prepend_fixture_bin(bin.path());

    for (harness_id, wait_event, clear_event, turn_end_event) in [
        ("opencode", "PermissionRequest", "NewTurn", "SessionIdle"),
        ("pi", "ToolApprovalRequested", "AgentStart", "AgentEnd"),
    ] {
        let launched = ok(
            &engine,
            "harness.start",
            json!({ "workspaceId": workspace_id, "harnessId": harness_id, "permissionMode": "inherit" }),
        );
        let session_id = launched["id"].as_str().unwrap().to_string();
        let incarnation = launched["incarnation"].as_str().unwrap().to_string();

        let marked = hook_event(&engine, &session_id, &incarnation, wait_event);
        assert_eq!(
            marked["agentState"], "needs_input",
            "{harness_id}'s {wait_event} must mark needs_input"
        );

        // Spurious PTY activity (a keystroke, a TUI repaint) must not clear
        // the signal for these two harnesses.
        let probe = format!("probe-{harness_id}-9f3");
        ok(
            &engine,
            "session.write",
            json!({
                "sessionId": session_id,
                "incarnation": incarnation,
                "dataBase64": base64_of(&format!("echo {probe}\n")),
            }),
        );
        let (_, session_after_activity) = read_until(
            &engine,
            &session_id,
            &incarnation,
            |t| t.contains(&probe),
            Duration::from_secs(5),
        );
        assert_eq!(
            session_after_activity["agentState"], "needs_input",
            "{harness_id}: generic PTY output must never clear needs_input"
        );

        let cleared = hook_event(&engine, &session_id, &incarnation, clear_event);
        assert_eq!(
            cleared["agentState"], "working",
            "{harness_id}'s {clear_event} must clear needs_input back to activity-based state"
        );

        // Issue #360: the turn-end signal itself never marks needs_input —
        // a finished turn reads as the activity-based state (working while
        // output is fresh, idle after the silence window).
        let turn_ended = hook_event(&engine, &session_id, &incarnation, turn_end_event);
        assert_ne!(
            turn_ended["agentState"], "needs_input",
            "{harness_id}'s {turn_end_event} is a turn-end clear, never needs_input"
        );

        ok(
            &engine,
            "session.stop",
            json!({ "sessionId": session_id, "incarnation": incarnation }),
        );
    }
}
