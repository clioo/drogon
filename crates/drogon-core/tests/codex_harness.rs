//! Codex's native harness adapter against a shell fixture.  The fixture never
//! runs model inference: it only reports its environment and sleeps while the
//! test drives the same hook-event RPC a Codex command hook invokes.
#![cfg(unix)]

use std::sync::Mutex;
use std::time::Duration;

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

static ENV_LOCK: Mutex<()> = Mutex::new(());

fn request(method: &str, params: Value) -> Request {
    serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": uuid::Uuid::new_v4().to_string(),
        "method": method,
        "params": params,
    }))
    .unwrap()
}

fn ok(engine: &Engine, method: &str, params: Value) -> Value {
    let response = engine.dispatch(request(method, params));
    assert!(
        response.ok,
        "expected {method} to succeed: {:?}",
        response.error
    );
    response.result.unwrap()
}

fn register_workspace(engine: &Engine) -> String {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().to_string_lossy().into_owned();
    std::mem::forget(directory);
    ok(engine, "workspace.register", json!({ "path": path }))["id"]
        .as_str()
        .unwrap()
        .to_string()
}

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
    unsafe { std::env::set_var("PATH", std::env::join_paths(paths).unwrap()) };
}

fn fixture(bin: &std::path::Path, name: &str, body: &str) {
    let path = bin.join(name);
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn wait_for_exit(engine: &Engine, session_id: &str, incarnation: &str) -> Value {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    let mut cursor = 0;
    while std::time::Instant::now() < deadline {
        let read = ok(
            engine,
            "session.read",
            json!({
                "sessionId": session_id,
                "incarnation": incarnation,
                "cursor": cursor,
            }),
        );
        cursor = read["nextCursor"].as_u64().unwrap();
        if read["session"]["verdict"] == "exited" {
            return read;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("Codex fixture did not exit");
}

fn wait_for_output(engine: &Engine, session_id: &str, incarnation: &str) -> String {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    let mut cursor = 0;
    let mut output = String::new();
    while std::time::Instant::now() < deadline {
        let read = ok(
            engine,
            "session.read",
            json!({
                "sessionId": session_id,
                "incarnation": incarnation,
                "cursor": cursor,
            }),
        );
        use base64::Engine as _;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(read["dataBase64"].as_str().unwrap())
            .unwrap();
        output.push_str(&String::from_utf8_lossy(&bytes));
        cursor = read["nextCursor"].as_u64().unwrap();
        if output.contains("CODEX_HOME=") {
            return output;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("Codex fixture did not report CODEX_HOME: {output:?}");
}

#[test]
fn codex_uses_a_disposable_home_mirrors_user_material_and_reports_hook_state() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let _saved_codex_home = SavedEnv::capture("CODEX_HOME");

    let source = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(source.path().join("skills/review")).unwrap();
    std::fs::write(
        source.path().join("skills/review/SKILL.md"),
        "review skill\n",
    )
    .unwrap();
    std::fs::write(source.path().join("AGENTS.md"), "source instructions\n").unwrap();
    std::fs::write(source.path().join("auth.json"), "must not copy\n").unwrap();
    std::fs::write(source.path().join("history.jsonl"), "must not copy\n").unwrap();
    let source_hooks = json!({
        "hooks": {
            "Stop": [{
                "hooks": [{"type": "command", "command": "/usr/bin/user-hook"}]
            }]
        }
    });
    std::fs::write(
        source.path().join("hooks.json"),
        serde_json::to_string_pretty(&source_hooks).unwrap(),
    )
    .unwrap();
    let source_hooks_path = source.path().join("hooks.json");
    let source_config = format!(
        "model_instructions_file = \"instructions.md\"\n[hooks.state.\"{}:stop:0:0\"]\nenabled = true\ntrusted_hash = \"sha256:user\"\n",
        source_hooks_path.display()
    );
    std::fs::write(source.path().join("config.toml"), &source_config).unwrap();
    unsafe { std::env::set_var("CODEX_HOME", source.path()) };

    let bin = tempfile::tempdir().unwrap();
    fixture(
        bin.path(),
        "codex",
        "printf 'CODEX_HOME=%s\\n' \"$CODEX_HOME\"\nprintf 'SESSION_ID=%s\\n' \"$DROGON_SESSION_ID\"\nsleep 30",
    );
    prepend_fixture_bin(bin.path());

    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let launched = ok(
        &engine,
        "harness.start",
        json!({
            "workspaceId": workspace_id,
            "harnessId": "codex",
            "permissionMode": "inherit"
        }),
    );
    let session_id = launched["id"].as_str().unwrap().to_string();
    let incarnation = launched["incarnation"].as_str().unwrap().to_string();
    let output = wait_for_output(&engine, &session_id, &incarnation);
    let managed_home = output
        .lines()
        .find_map(|line| line.strip_prefix("CODEX_HOME="))
        .unwrap()
        .trim();
    let managed_home_path = std::path::Path::new(managed_home);

    assert_ne!(managed_home_path, source.path());
    assert!(managed_home.contains("harness-hooks/codex/"));
    assert_eq!(
        std::fs::read_to_string(managed_home_path.join("skills/review/SKILL.md")).unwrap(),
        "review skill\n"
    );
    assert_eq!(
        std::fs::read_to_string(managed_home_path.join("AGENTS.md")).unwrap(),
        "source instructions\n"
    );
    assert!(!managed_home_path.join("auth.json").exists());
    assert!(!managed_home_path.join("history.jsonl").exists());

    let hooks: Value = serde_json::from_str(
        &std::fs::read_to_string(managed_home_path.join("hooks.json")).unwrap(),
    )
    .unwrap();
    for event in [
        "SessionStart",
        "UserPromptSubmit",
        "PreToolUse",
        "PermissionRequest",
        "PostToolUse",
        "SubagentStart",
        "SubagentStop",
        "Stop",
    ] {
        let definitions = hooks["hooks"][event].as_array().unwrap();
        assert!(!definitions.is_empty(), "managed {event} hook missing");
        let command = definitions[0]["hooks"][0]["command"].as_str().unwrap();
        assert!(command.contains("internal hook-event"));
        assert!(command.contains(&format!("--session {session_id}")));
        assert!(command.contains(&format!("--incarnation {incarnation}")));
        assert!(command.contains(&format!("--event {event}")));
    }
    assert_eq!(
        hooks["hooks"]["Stop"][1]["hooks"][0]["command"],
        "/usr/bin/user-hook"
    );

    let managed_config = std::fs::read_to_string(managed_home_path.join("config.toml")).unwrap();
    assert!(
        managed_config.contains("'/"),
        "relative config paths must be absolute"
    );
    assert!(managed_config.contains(&format!(
        "{}:stop:1:0",
        managed_home_path.join("hooks.json").display()
    )));
    assert!(!managed_config.contains(&format!("{}:stop:0:0", source_hooks_path.display())));

    let waiting = ok(
        &engine,
        "session.hook_event",
        json!({
            "sessionId": session_id,
            "incarnation": incarnation,
            "event": "PermissionRequest"
        }),
    );
    assert_eq!(waiting["agentState"], "needs_input");
    let working = ok(
        &engine,
        "session.hook_event",
        json!({
            "sessionId": session_id,
            "incarnation": incarnation,
            "event": "PreToolUse"
        }),
    );
    assert_eq!(working["agentState"], "working");
    let stopped = ok(
        &engine,
        "session.stop",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    );
    assert_eq!(stopped["agentState"], "exited");
    assert!(
        !managed_home_path.exists(),
        "Codex managed home must be cleaned up"
    );
    assert_eq!(
        std::fs::read_to_string(source.path().join("hooks.json")).unwrap(),
        serde_json::to_string_pretty(&source_hooks).unwrap(),
        "the real Codex home must remain byte-for-byte untouched"
    );
    assert_eq!(
        std::fs::read_to_string(source.path().join("config.toml")).unwrap(),
        source_config,
        "the real Codex config must remain untouched"
    );
}

#[test]
fn headless_codex_gets_isolated_config_without_wait_hooks_and_is_cleaned_on_exit() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let _saved_codex_home = SavedEnv::capture("CODEX_HOME");

    let source = tempfile::tempdir().unwrap();
    let source_hooks = json!({
        "hooks": {
            "Stop": [{
                "hooks": [{"type": "command", "command": "/usr/bin/user-hook"}]
            }]
        }
    });
    std::fs::write(
        source.path().join("hooks.json"),
        serde_json::to_string_pretty(&source_hooks).unwrap(),
    )
    .unwrap();
    unsafe { std::env::set_var("CODEX_HOME", source.path()) };

    let bin = tempfile::tempdir().unwrap();
    fixture(
        bin.path(),
        "codex",
        "printf 'CODEX_HOME=%s\\n' \"$CODEX_HOME\"\nsleep 1",
    );
    prepend_fixture_bin(bin.path());

    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let launched = ok(
        &engine,
        "harness.start",
        json!({
            "workspaceId": workspace_id,
            "harnessId": "codex",
            "permissionMode": "inherit",
            "headless": true,
            "prompt": "finish the fixture"
        }),
    );
    let session_id = launched["id"].as_str().unwrap().to_string();
    let incarnation = launched["incarnation"].as_str().unwrap().to_string();
    let output = wait_for_output(&engine, &session_id, &incarnation);
    let managed_home = output
        .lines()
        .find_map(|line| line.strip_prefix("CODEX_HOME="))
        .unwrap()
        .trim();
    let managed_home_path = std::path::Path::new(managed_home);
    let hooks: Value = serde_json::from_str(
        &std::fs::read_to_string(managed_home_path.join("hooks.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        hooks["hooks"]["Stop"][0]["hooks"][0]["command"],
        "/usr/bin/user-hook"
    );
    assert!(hooks["hooks"].get("SessionStart").is_none());
    let canonical_data = std::fs::canonicalize(data.path()).unwrap();
    assert!(
        managed_home_path.starts_with(canonical_data.join("harness-hooks/codex")),
        "managed home {managed_home} is not under data dir {}",
        canonical_data.display()
    );
    let headless_wait = ok(
        &engine,
        "session.hook_event",
        json!({
            "sessionId": session_id,
            "incarnation": incarnation,
            "event": "PermissionRequest"
        }),
    );
    assert_ne!(headless_wait["agentState"], "needs_input");

    let exited = wait_for_exit(&engine, &session_id, &incarnation);
    assert_eq!(exited["session"]["verdict"], "exited");
    assert!(!managed_home_path.exists());
}

#[test]
fn headless_codex_fast_exit_does_not_leak_its_managed_home() {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let _saved_codex_home = SavedEnv::capture("CODEX_HOME");

    let source = tempfile::tempdir().unwrap();
    std::fs::write(source.path().join("hooks.json"), r#"{"hooks":{}}"#).unwrap();
    unsafe { std::env::set_var("CODEX_HOME", source.path()) };

    let bin = tempfile::tempdir().unwrap();
    fixture(
        bin.path(),
        "codex",
        "printf 'CODEX_HOME=%s\\n' \"$CODEX_HOME\"\nexit 0",
    );
    prepend_fixture_bin(bin.path());

    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let launched = ok(
        &engine,
        "harness.start",
        json!({
            "workspaceId": workspace_id,
            "harnessId": "codex",
            "permissionMode": "inherit",
            "headless": true,
            "prompt": "exit now"
        }),
    );
    let session_id = launched["id"].as_str().unwrap().to_string();
    let incarnation = launched["incarnation"].as_str().unwrap().to_string();
    let output = wait_for_output(&engine, &session_id, &incarnation);
    let managed_home = output
        .lines()
        .find_map(|line| line.strip_prefix("CODEX_HOME="))
        .unwrap()
        .trim()
        .to_owned();
    wait_for_exit(&engine, &session_id, &incarnation);
    assert!(!std::path::Path::new(&managed_home).exists());
}
