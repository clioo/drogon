//! `session.hook_event` and the Claude Code hooks settings file, against a
//! real `portable-pty` child and a real SQLite file per test (Unix-only,
//! like `engine.rs`). No model inference: the hook is driven directly
//! through the RPC the hidden `drogon-cli internal hook-event` subcommand
//! calls, and the claude harness is a fixture shell script resolved via the
//! product's `agentCmdOverrides` (absolute path) — the suite never touches
//! process-global PATH, so it is hermetic under any test scheduling.

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

/// Writes a fixture `claude` (and optionally a fixture `pi`) under the
/// test's own directory and resolves them through the product's
/// `agentCmdOverrides`, so harness launches never depend on process PATH.
/// `script_body` is the shell body: `cat` echoes (a TUI repainting the
/// composer on every keystroke), `sleep` just stays live.
fn write_fixture_settings(dir: &tempfile::TempDir, script_body: &str, with_pi: bool) {
    let bin = dir.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let claude = bin.join("claude");
    std::fs::write(&claude, format!("#!/bin/sh\n{script_body}\n")).unwrap();
    let mut overrides = serde_json::Map::new();
    overrides.insert(
        "claude".to_string(),
        json!(claude.to_string_lossy().into_owned()),
    );
    if with_pi {
        let pi = bin.join("pi");
        std::fs::write(&pi, "#!/bin/sh\nexec sleep 30\n").unwrap();
        overrides.insert("pi".to_string(), json!(pi.to_string_lossy().into_owned()));
    }
    for script in [&claude] {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perm = std::fs::metadata(script).unwrap().permissions();
            perm.set_mode(0o755);
            std::fs::set_permissions(script, perm).unwrap();
        }
    }
    if with_pi {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let pi = bin.join("pi");
            let mut perm = std::fs::metadata(&pi).unwrap().permissions();
            perm.set_mode(0o755);
            std::fs::set_permissions(&pi, perm).unwrap();
        }
    }
    std::fs::write(
        dir.path().join("agent-settings.json"),
        serde_json::to_vec(&json!({
            "version": 1,
            "settings": {
                "defaultTuiAgent": null,
                "disabledTuiAgents": [],
                "agentCmdOverrides": overrides,
                "agentDefaultArgs": {},
                "agentDefaultEnv": {},
                "agentStatusHooksEnabled": true,
                "tabAutoGenerateTitle": false,
                "promptCacheTimerEnabled": false,
                "promptCacheTtlMs": 300000,
                "codexSessionSourceHome": ""
            }
        }))
        .unwrap(),
    )
    .unwrap();
}

/// The claude wait lifecycle on the managed install surface: `Notification`
/// parks the session at `needs_input`, later PTY output must NOT spend the
/// wait (claude is hook-authoritative — the composer's keystroke echo is
/// output too, and a generic output clear would let typing lie), and the
/// next `UserPromptSubmit` resumes the turn and clears the wait.
#[test]
fn hook_event_marks_needs_input_and_resume_clears_it() {
    let dir = tempfile::tempdir().unwrap();
    write_fixture_settings(&dir, "cat", false);
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let session = ok(
        &engine,
        "harness.start",
        json!({ "workspaceId": workspace_id, "harnessId": "claude", "permissionMode": "inherit" }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();

    let marked = hook_event(&engine, &session_id, &incarnation, "Notification");
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

    // Keystroke echo is PTY output, but it must NOT spend the wait: the
    // generic output clear is exactly how typing used to lie about the
    // agent's state. Poll past the echo to prove the wait sticks.
    ok(
        &engine,
        "session.write",
        json!({
            "sessionId": session_id,
            "incarnation": incarnation,
            "dataBase64": base64_of("echo hook-probe-9f3\n"),
        }),
    );
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut saw_output = false;
    let mut cursor = 0u64;
    while Instant::now() < deadline {
        let read = ok(
            &engine,
            "session.read",
            json!({ "sessionId": session_id, "incarnation": incarnation, "cursor": cursor }),
        );
        let bytes = base64_decode(read["dataBase64"].as_str().unwrap());
        cursor = read["nextCursor"].as_u64().unwrap();
        if String::from_utf8_lossy(&bytes).contains("hook-probe-9f3") {
            saw_output = true;
            break;
        }
        sleep(Duration::from_millis(20));
    }
    assert!(saw_output, "expected the echo output to arrive");
    let after_echo = ok(&engine, "session.list", json!({}));
    let row = after_echo["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == session_id)
        .expect("session must be listed");
    assert_eq!(
        row["agentState"], "needs_input",
        "echo output must not spend a hook-authoritative wait"
    );

    // The resumption hook is what clears the wait and opens the turn.
    let resumed = hook_event(&engine, &session_id, &incarnation, "UserPromptSubmit");
    assert_eq!(
        resumed["agentState"], "working",
        "the resumption hook must clear the wait and report the turn"
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
    write_fixture_settings(&dir, "exec sleep 30", false);
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let session = ok(
        &engine,
        "harness.start",
        json!({ "workspaceId": workspace_id, "harnessId": "claude", "permissionMode": "inherit" }),
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

/// Harness-less sessions (plain `session.start`) have no managed hook
/// install, so nothing legitimately reports hooks for them: every event is
/// a forgery and must be refused. Forged Stop/Wait events used to
/// manufacture phantom `idle`/`needs_input` over live activity there —
/// only forged turn starts were inert. The row stays purely
/// activity-derived.
#[test]
fn hook_events_on_harness_less_sessions_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let session = ok(
        &engine,
        "session.start",
        json!({ "workspaceId": workspace_id, "command": "/bin/cat", "args": [] }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();

    // No output yet: the honest activity-derived state is `unknown`.
    let listed = ok(&engine, "session.list", json!({}));
    let row = listed["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == session_id)
        .expect("session must be listed");
    assert_eq!(row["agentState"], "unknown");

    for event in [
        "Stop",
        "Notification",
        "UserPromptSubmit",
        "SessionIdle",
        "AgentEnd",
        "PermissionRequest",
    ] {
        assert_eq!(
            err_code(
                &engine,
                "session.hook_event",
                json!({ "sessionId": session_id, "incarnation": incarnation, "event": event }),
            ),
            "invalid_argument",
            "hook event {event} on a harness-less session is a forgery"
        );
    }

    // The refusals must not have moved the row off the activity clock.
    let listed = ok(&engine, "session.list", json!({}));
    let row = listed["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == session_id)
        .expect("session must be listed");
    assert_eq!(
        row["agentState"], "unknown",
        "refused forgeries must not deposit idle or needs_input"
    );

    // And the activity clock itself still works.
    ok(
        &engine,
        "session.write",
        json!({
            "sessionId": session_id,
            "incarnation": incarnation,
            "dataBase64": base64_of("activity after refusals\n"),
        }),
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut working = false;
    while Instant::now() < deadline {
        let listed = ok(&engine, "session.list", json!({}));
        let row = listed["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == session_id)
            .expect("session must be listed");
        if row["agentState"] == "working" {
            working = true;
            break;
        }
        sleep(Duration::from_millis(20));
    }
    assert!(working, "the activity clock must keep driving the row");

    let stopped = ok(
        &engine,
        "session.stop",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    );
    assert_eq!(stopped["verdict"], "exited");
}

#[test]
fn claude_harness_start_writes_hooks_file_and_exit_removes_it() {
    let dir = tempfile::tempdir().unwrap();
    write_fixture_settings(&dir, "exec sleep 30", true);
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);

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
    for event in [
        "UserPromptSubmit",
        "Notification",
        "Stop",
        "PreToolUse",
        "PostToolUse",
        "PermissionRequest",
    ] {
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
