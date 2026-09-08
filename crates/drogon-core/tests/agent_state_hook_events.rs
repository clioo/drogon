//! `session.hook_event` and the Claude Code hooks settings file, against a
//! real `portable-pty` child and a real SQLite file per test (Unix-only,
//! like `engine.rs`). No model inference: the hook is driven directly
//! through the RPC the hidden `drogon-cli internal hook-event` subcommand
//! calls, and the claude harness is a fixture shell script on PATH.
#![cfg(unix)]

use std::thread::sleep;
use std::time::{Duration, Instant};

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

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

fn err_code(engine: &Engine, method: &str, params: Value) -> String {
    let request_id = uuid::Uuid::new_v4().to_string();
    let response = engine.dispatch(req(method, &request_id, params));
    assert!(
        !response.ok,
        "expected error for {method}, got {:?}",
        response.result
    );
    response.error.unwrap().code
}

fn register_workspace(engine: &Engine) -> String {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_string_lossy().to_string();
    std::mem::forget(dir);
    let ws = ok(engine, "workspace.register", json!({ "path": path }));
    ws["id"].as_str().unwrap().to_string()
}

fn base64_of(text: &str) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(text.as_bytes())
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

#[test]
fn hook_event_marks_needs_input_and_output_clears_it() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    // Why `/bin/cat`, not a shell: a shell prints a startup prompt whose
    // reader-side processing can land after the hook mark under load and
    // spend the fresh wait signal (the reader clears on every chunk with no
    // emission-time comparison). `cat` emits nothing until written to, so
    // every chunk after the mark is causally fresh output -- the prompt
    // bytes are gone by construction, not by timing luck. The later
    // `session.write` still proves fresh output clears the signal, since
    // `cat` echoes the written line back.
    let session = ok(
        &engine,
        "session.start",
        json!({ "workspaceId": workspace_id, "command": "/bin/cat", "args": [] }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();

    let marked = hook_event(&engine, &session_id, &incarnation, "Stop");
    assert_eq!(marked["agentState"], "needs_input");
    assert!(
        marked["agentStateAt"]
            .as_str()
            .is_some_and(|at| !at.is_empty()),
        "needs_input must carry the hook timestamp"
    );

    let listed = ok(&engine, "session.list", json!({}));
    let row = listed["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == session_id)
        .expect("session must be listed");
    assert_eq!(row["agentState"], "needs_input");
    assert_eq!(row["agentStateAt"], marked["agentStateAt"]);

    // New PTY output spends the wait signal: the same read that first shows
    // the echo must already report activity-based derivation again.
    ok(
        &engine,
        "session.write",
        json!({
            "sessionId": session_id,
            "incarnation": incarnation,
            "dataBase64": base64_of("echo hook-probe-9f3\n"),
        }),
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut cursor = 0u64;
    let mut saw_output = false;
    let mut cleared = false;
    while Instant::now() < deadline {
        let read = ok(
            &engine,
            "session.read",
            json!({ "sessionId": session_id, "incarnation": incarnation, "cursor": cursor }),
        );
        let bytes = base64_decode(read["dataBase64"].as_str().unwrap());
        let text = String::from_utf8_lossy(&bytes).into_owned();
        cursor = read["nextCursor"].as_u64().unwrap();
        if text.contains("hook-probe-9f3") {
            saw_output = true;
        }
        // The reader's ring push and wait-signal clear are separate lock
        // acquisitions: a read can observe fresh bytes while the clear is
        // still in flight. Poll for the cleared state instead of asserting
        // it on the first marked read.
        if saw_output && read["session"]["agentState"] == "working" {
            cleared = true;
            break;
        }
        sleep(Duration::from_millis(20));
    }
    assert!(saw_output, "expected the echo output to arrive");
    assert!(
        cleared,
        "fresh output must clear needs_input back to working"
    );

    let stopped = ok(
        &engine,
        "session.stop",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    );
    assert_eq!(stopped["verdict"], "exited");
    assert_eq!(stopped["agentState"], "exited");
}

#[test]
fn hook_event_rejects_bad_identity_events_and_exited_sessions() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let session = ok(
        &engine,
        "session.start",
        json!({ "workspaceId": workspace_id, "command": "/bin/sh", "args": ["-c", "sleep 30"] }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();

    assert_eq!(
        err_code(
            &engine,
            "session.hook_event",
            json!({ "sessionId": "does-not-exist", "incarnation": incarnation, "event": "Stop" }),
        ),
        "not_found"
    );
    assert_eq!(
        err_code(
            &engine,
            "session.hook_event",
            json!({
                "sessionId": session_id,
                "incarnation": "00000000-0000-0000-0000-000000000000",
                "event": "Stop",
            }),
        ),
        "stale_incarnation"
    );
    for event in ["NotificationSent", "ToolResult", "bogus", ""] {
        assert_eq!(
            err_code(
                &engine,
                "session.hook_event",
                json!({ "sessionId": session_id, "incarnation": incarnation, "event": event }),
            ),
            "invalid_argument",
            "event {event:?} must be refused, never silently mapped"
        );
    }

    let stopped = ok(
        &engine,
        "session.stop",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    );
    assert_eq!(stopped["verdict"], "exited");
    assert_eq!(
        err_code(
            &engine,
            "session.hook_event",
            json!({ "sessionId": session_id, "incarnation": incarnation, "event": "Stop" }),
        ),
        "unverifiable",
        "an exited session must never gain a wait signal"
    );
}

/// Restores PATH on drop so the fixture harness never leaks into another test.
struct SavedPath(Option<std::ffi::OsString>);

impl SavedPath {
    fn capture() -> Self {
        Self(std::env::var_os("PATH"))
    }
}

impl Drop for SavedPath {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            unsafe { std::env::set_var("PATH", path) };
        } else {
            unsafe { std::env::remove_var("PATH") };
        }
    }
}

#[test]
fn claude_harness_start_writes_hooks_file_and_exit_removes_it() {
    let _saved_path = SavedPath::capture();
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);

    // Fixture harnesses: executable scripts named like the real CLIs.
    let bin = tempfile::tempdir().unwrap();
    for name in ["claude", "pi"] {
        let script = bin.path().join(name);
        std::fs::write(&script, "#!/bin/sh\nsleep 30\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
    let mut paths =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect::<Vec<_>>();
    paths.insert(0, bin.path().to_path_buf());
    let joined = std::env::join_paths(paths).unwrap();
    unsafe { std::env::set_var("PATH", joined) };

    let launched = ok(
        &engine,
        "harness.start",
        json!({ "workspaceId": workspace_id, "harnessId": "claude", "permissionMode": "inherit" }),
    );
    let session_id = launched["id"].as_str().unwrap().to_string();
    let incarnation = launched["incarnation"].as_str().unwrap().to_string();
    let args = launched["args"].as_array().unwrap();
    let settings_pos = args
        .iter()
        .position(|arg| arg == "--settings")
        .expect("claude launches must carry --settings");
    let settings_path = args[settings_pos + 1].as_str().unwrap().to_string();
    assert!(
        settings_path.contains("hooks"),
        "settings file must live under <data-dir>/hooks: {settings_path}"
    );
    assert!(
        std::path::Path::new(&settings_path).exists(),
        "settings file must exist before the child spawns"
    );
    let settings: Value =
        serde_json::from_str(&std::fs::read_to_string(&settings_path).unwrap()).unwrap();
    for event in ["Notification", "Stop"] {
        let entries = settings["hooks"][event]
            .as_array()
            .unwrap_or_else(|| panic!("hooks.{event} must be an array"));
        assert_eq!(entries.len(), 1, "exactly one entry per event");
        let command = entries[0]["hooks"][0]["command"]
            .as_str()
            .expect("hook entry must be a command");
        assert!(
            command.contains("internal hook-event"),
            "must invoke the hidden CLI subcommand: {command}"
        );
        assert!(
            command.contains(&format!("--session {session_id}")),
            "{command}"
        );
        assert!(
            command.contains(&format!("--incarnation {incarnation}")),
            "{command}"
        );
        assert!(command.contains(&format!("--event {event}")), "{command}");
    }
    assert!(
        !settings.to_string().contains("~/.claude"),
        "hook wiring must never reference the user's global config"
    );

    // The fixture session is real: the hook RPC drives it needs_input.
    let marked = hook_event(&engine, &session_id, &incarnation, "Notification");
    assert_eq!(marked["agentState"], "needs_input");

    // Pi gets its own hook wiring (a `--extension` file, not `--settings`)
    // -- see harness_agent_hooks_opencode_pi.rs for its full coverage.
    let pi = ok(
        &engine,
        "harness.start",
        json!({ "workspaceId": workspace_id, "harnessId": "pi", "permissionMode": "inherit" }),
    );
    assert!(
        !pi["args"]
            .as_array()
            .unwrap()
            .iter()
            .any(|arg| arg == "--settings"),
        "pi must never get claude's --settings wiring"
    );
    let pi_id = pi["id"].as_str().unwrap().to_string();
    let pi_inc = pi["incarnation"].as_str().unwrap().to_string();

    let stopped = ok(
        &engine,
        "session.stop",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    );
    assert_eq!(stopped["verdict"], "exited");
    assert!(
        !std::path::Path::new(&settings_path).exists(),
        "the settings file must be removed when the session exits"
    );

    let pi_stopped = ok(
        &engine,
        "session.stop",
        json!({ "sessionId": pi_id, "incarnation": pi_inc }),
    );
    assert_eq!(pi_stopped["verdict"], "exited");
}
