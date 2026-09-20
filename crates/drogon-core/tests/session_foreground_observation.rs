//! Foreground-agent observation (issue #622, part A1): a plain
//! `session.start` shell that foregrounds a harness executable reports it in
//! `observedHarnessId`/`observedHarnessAt`, without ever gaining hook
//! authority, restart identity, or `working`/`idle`.
//!
//! Unix-only (like `agent_state_hook_events.rs`): the probe reads
//! `tcgetpgrp` plus `/proc`/`proc_pidpath`, and the fixtures are real PTY
//! children. No model inference. Every session is stopped through the exact
//! retained handle (`session.stop`) with a bounded wait, and every temp dir
//! is owned by its test — never a broad `pkill`/`killall`.
#![cfg(unix)]

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

fn register_workspace_at(engine: &Engine, path: &std::path::Path) -> String {
    let ws = ok(
        engine,
        "workspace.register",
        json!({ "path": path.to_string_lossy() }),
    );
    ws["id"].as_str().unwrap().to_string()
}

fn stop_session(engine: &Engine, session_id: &str, incarnation: &str) -> Value {
    ok(
        engine,
        "session.stop",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    )
}

fn find_sleep() -> std::path::PathBuf {
    for candidate in ["/bin/sleep", "/usr/bin/sleep"] {
        let path = std::path::PathBuf::from(candidate);
        if path.is_file() {
            return path;
        }
    }
    panic!("no sleep binary for the foreground fixture");
}

fn find_bash() -> String {
    for candidate in ["/bin/bash", "/usr/bin/bash"] {
        if std::path::Path::new(candidate).is_file() {
            return candidate.to_string();
        }
    }
    panic!("no bash binary for the observation-clear fixture");
}

fn base64_of(text: &str) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(text.as_bytes())
}

/// A real binary named by the caller that sleeps `argv[1]` seconds (8 by
/// default) and exits on its own, so the foregrounding shell returns to
/// the foreground mid-test. Same `cc` trick as [`build_sleeper`]: a copy
/// of a platform binary will not do on macOS.
fn build_timed_sleeper(dst: &std::path::Path) {
    let src = dst.with_extension("c");
    std::fs::write(
        &src,
        "#include <stdlib.h>\n#include <unistd.h>\nint main(int argc, char **argv) { unsigned s = argc > 1 ? (unsigned)atoi(argv[1]) : 8; sleep(s); return 0; }\n",
    )
    .unwrap();
    let output = std::process::Command::new("cc")
        .args(["-O2", "-o"])
        .arg(dst)
        .arg(&src)
        .output()
        .expect("spawn cc for the timed foreground fixture");
    assert!(
        output.status.success(),
        "cc failed for the timed foreground fixture: {output:?}"
    );
    make_executable(dst);
    let _ = std::fs::remove_file(&src);
}

fn make_executable(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let mut perm = std::fs::metadata(path).unwrap().permissions();
    perm.set_mode(0o755);
    std::fs::set_permissions(path, perm).unwrap();
}

/// Builds a real binary sleeper named by the caller (e.g. `claude`), so
/// `/proc/<pid>/exe` (or macOS `proc_pidpath`) names it directly. A copy
/// of a platform binary will not do: macOS SIGKILLs ad-hoc copies of
/// `/bin/sleep`, so the fixture is compiled with the host `cc`.
fn build_sleeper(dst: &std::path::Path) {
    let src = dst.with_extension("c");
    std::fs::write(
        &src,
        "#include <unistd.h>\nint main(void) { sleep(30); return 0; }\n",
    )
    .unwrap();
    let output = std::process::Command::new("cc")
        .args(["-O2", "-o"])
        .arg(dst)
        .arg(&src)
        .output()
        .expect("spawn cc for the foreground fixture");
    assert!(
        output.status.success(),
        "cc failed for the foreground fixture: {output:?}"
    );
    make_executable(dst);
    let _ = std::fs::remove_file(&src);
}

/// Polls `session.list` until the row's `observedHarnessId` equals
/// `expected` (or the deadline passes). Returns the latest row.
fn poll_observed(engine: &Engine, session_id: &str, expected: &Value, timeout: Duration) -> Value {
    let deadline = Instant::now() + timeout;
    loop {
        let listed = ok(engine, "session.list", json!({}));
        let row = listed["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == session_id)
            .expect("session must be listed")
            .clone();
        if &row["observedHarnessId"] == expected {
            return row;
        }
        assert!(
            Instant::now() < deadline,
            "observedHarnessId never became {expected} (last row {row})"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// A direct executable named `claude` (a real binary copy, not a script, so
/// `/proc/<pid>/exe` names it) is observed on a harness-less session.
#[test]
fn direct_executable_named_claude_is_observed() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_dir = dir.path().join("ws");
    std::fs::create_dir_all(&workspace_dir).unwrap();
    let workspace_id = register_workspace_at(&engine, &workspace_dir);

    let fixture = dir.path().join("claude");
    build_sleeper(&fixture);
    let session = ok(
        &engine,
        "session.start",
        json!({
            "workspaceId": workspace_id,
            "command": fixture.to_string_lossy(),
            "args": ["30"],
        }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();

    let row = poll_observed(
        &engine,
        &session_id,
        &json!("claude"),
        Duration::from_secs(5),
    );
    assert_eq!(row["harnessId"], Value::Null);
    assert!(
        row["observedHarnessAt"]
            .as_str()
            .is_some_and(|at| !at.is_empty()),
        "an observation carries its RFC 3339 stamp"
    );
    // The observation never deposits hook-derived state.
    assert_eq!(row["agentState"], json!("unknown"));

    let stopped = stop_session(&engine, &session_id, &incarnation);
    assert_eq!(stopped["verdict"], "exited");
}

/// A `node` shim whose argv names `/claude` is observed via the argv scan.
#[test]
fn shim_argv_path_observes_claude() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_dir = dir.path().join("ws");
    std::fs::create_dir_all(&workspace_dir).unwrap();
    let workspace_id = register_workspace_at(&engine, &workspace_dir);

    let claude_path = dir.path().join("claude");
    std::fs::write(&claude_path, "# harness target\n").unwrap();
    let node_path = dir.path().join("node");
    std::fs::write(&node_path, "#!/bin/sh\nsleep 30\n").unwrap();
    make_executable(&node_path);
    let session = ok(
        &engine,
        "session.start",
        json!({
            "workspaceId": workspace_id,
            "command": node_path.to_string_lossy(),
            "args": [claude_path.to_string_lossy()],
        }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();

    let row = poll_observed(
        &engine,
        &session_id,
        &json!("claude"),
        Duration::from_secs(5),
    );
    assert_eq!(row["harnessId"], Value::Null);
    assert!(
        row["observedHarnessAt"]
            .as_str()
            .is_some_and(|at| !at.is_empty())
    );

    let stopped = stop_session(&engine, &session_id, &incarnation);
    assert_eq!(stopped["verdict"], "exited");
}

/// A foreground with no harness name reports nothing (under-reporting is
/// correct; a guess is not).
#[test]
fn non_harness_foreground_reports_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_dir = dir.path().join("ws");
    std::fs::create_dir_all(&workspace_dir).unwrap();
    let workspace_id = register_workspace_at(&engine, &workspace_dir);

    let sleep = find_sleep();
    let session = ok(
        &engine,
        "session.start",
        json!({
            "workspaceId": workspace_id,
            "command": sleep.to_string_lossy(),
            "args": ["30"],
        }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();

    // Give a probe a chance to run, then require nothing observed.
    std::thread::sleep(Duration::from_millis(300));
    let listed = ok(&engine, "session.list", json!({}));
    let row = listed["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == session_id)
        .expect("session must be listed");
    assert_eq!(row["observedHarnessId"], Value::Null);
    assert_eq!(row["observedHarnessAt"], Value::Null);

    let stopped = stop_session(&engine, &session_id, &incarnation);
    assert_eq!(stopped["verdict"], "exited");
}

/// A `harness.start` session already names its harness and keeps the
/// observed fields null, even while its foreground is the harness.
#[test]
fn harness_launched_session_keeps_observed_null() {
    let dir = tempfile::tempdir().unwrap();
    let bin = dir.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let claude = bin.join("claude");
    std::fs::write(&claude, "#!/bin/sh\nexec sleep 30\n").unwrap();
    make_executable(&claude);
    std::fs::write(
        dir.path().join("agent-settings.json"),
        serde_json::to_vec(&json!({
            "version": 1,
            "settings": {
                "defaultTuiAgent": null,
                "disabledTuiAgents": [],
                "agentCmdOverrides": { "claude": claude.to_string_lossy() },
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
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_dir = dir.path().join("ws");
    std::fs::create_dir_all(&workspace_dir).unwrap();
    let workspace_id = register_workspace_at(&engine, &workspace_dir);

    let session = ok(
        &engine,
        "harness.start",
        json!({ "workspaceId": workspace_id, "harnessId": "claude", "permissionMode": "inherit" }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();
    assert_eq!(session["harnessId"], json!("claude"));

    std::thread::sleep(Duration::from_millis(300));
    let listed = ok(&engine, "session.list", json!({}));
    let row = listed["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == session_id)
        .expect("session must be listed");
    assert_eq!(row["harnessId"], json!("claude"));
    assert_eq!(row["observedHarnessId"], Value::Null);
    assert_eq!(row["observedHarnessAt"], Value::Null);

    let stopped = stop_session(&engine, &session_id, &incarnation);
    assert_eq!(stopped["verdict"], "exited");
    assert_eq!(stopped["observedHarnessId"], Value::Null);
}

/// The observation clears when the agent exits (issue #622, C3): a plain
/// interactive shell that foregrounds the fixture `claude` reports it, and
/// reports null again once the fixture exits on its own and the shell
/// returns to the foreground. Without the clear, the row would read
/// `Claude` forever after the agent quit.
#[test]
fn observation_clears_when_the_foregrounded_agent_exits() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_dir = dir.path().join("ws");
    std::fs::create_dir_all(&workspace_dir).unwrap();
    let workspace_id = register_workspace_at(&engine, &workspace_dir);

    let fixture = dir.path().join("claude");
    build_timed_sleeper(&fixture);
    let session = ok(
        &engine,
        "session.start",
        json!({
            "workspaceId": workspace_id,
            "command": find_bash(),
            "args": ["-i"],
        }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();

    // Baseline: the bare interactive shell foregrounds no harness.
    std::thread::sleep(Duration::from_millis(500));
    let listed = ok(&engine, "session.list", json!({}));
    let row = listed["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == session_id)
        .expect("session must be listed");
    assert_eq!(row["observedHarnessId"], Value::Null);

    // Foreground the fixture the way a user runs `claude` at the prompt.
    ok(
        &engine,
        "session.write",
        json!({
            "sessionId": session_id,
            "incarnation": incarnation,
            "dataBase64": base64_of(&format!("{} 8\n", fixture.to_string_lossy())),
        }),
    );
    let row = poll_observed(
        &engine,
        &session_id,
        &json!("claude"),
        Duration::from_secs(12),
    );
    assert_eq!(row["harnessId"], Value::Null);
    assert!(
        row["observedHarnessAt"]
            .as_str()
            .is_some_and(|at| !at.is_empty()),
        "an observation carries its RFC 3339 stamp"
    );

    // The fixture exits on its own; the shell returns to the foreground and
    // the observation clears (polled past the 1 s memo TTL).
    let row = poll_observed(&engine, &session_id, &Value::Null, Duration::from_secs(20));
    assert_eq!(row["observedHarnessAt"], Value::Null);

    let stopped = stop_session(&engine, &session_id, &incarnation);
    assert_eq!(stopped["verdict"], "exited");
}

/// An observed `claude` buys no hook authority: every `session.hook_event`
/// name is still refused on the harness-less session, exactly as
/// `hook_events_on_harness_less_sessions_are_refused` requires.
#[test]
fn observed_foreground_buys_no_hook_authority() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_dir = dir.path().join("ws");
    std::fs::create_dir_all(&workspace_dir).unwrap();
    let workspace_id = register_workspace_at(&engine, &workspace_dir);

    let fixture = dir.path().join("claude");
    build_sleeper(&fixture);
    let session = ok(
        &engine,
        "session.start",
        json!({
            "workspaceId": workspace_id,
            "command": fixture.to_string_lossy(),
            "args": ["30"],
        }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();
    poll_observed(
        &engine,
        &session_id,
        &json!("claude"),
        Duration::from_secs(5),
    );

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
            "observed claude must not admit hook event {event}"
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
    assert_eq!(row["agentState"], "unknown");

    let stopped = stop_session(&engine, &session_id, &incarnation);
    assert_eq!(stopped["verdict"], "exited");
}

/// An observed harness never changes what a restart executes: the launch
/// `harnessId` stays null, so a restart re-uses the shell argv verbatim
/// instead of re-launching a harness.
#[test]
fn observed_harness_never_changes_restart_identity() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_dir = dir.path().join("ws");
    std::fs::create_dir_all(&workspace_dir).unwrap();
    let workspace_id = register_workspace_at(&engine, &workspace_dir);

    let fixture = dir.path().join("claude");
    build_sleeper(&fixture);
    let fixture_str = fixture.to_string_lossy().to_string();
    let session = ok(
        &engine,
        "session.start",
        json!({
            "workspaceId": workspace_id,
            "command": fixture_str,
            "args": ["30"],
        }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();
    let row = poll_observed(
        &engine,
        &session_id,
        &json!("claude"),
        Duration::from_secs(5),
    );

    // The restart source of truth is untouched: no launch harness, and the
    // recorded shell argv is exactly what was spawned.
    assert_eq!(row["harnessId"], Value::Null);
    assert_eq!(row["command"], json!(fixture_str));
    assert_eq!(row["args"], json!(["30"]));
    assert_eq!(row["observedHarnessId"], json!("claude"));

    let stopped = stop_session(&engine, &session_id, &incarnation);
    assert_eq!(stopped["verdict"], "exited");
    assert_eq!(stopped["harnessId"], Value::Null);
}
