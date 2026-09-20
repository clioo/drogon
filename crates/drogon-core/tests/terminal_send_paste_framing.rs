//! Which far ends `session.write` frames a body for (issue #625).
//!
//! The CLI's PTY suite pins the bytes for sessions started with
//! `session.start`, where the gate is what the program announces. This
//! pins the half only `harness.start` can reach: a launched agent
//! composer is framed for even on the alternate screen.
//!
//! That case is not hypothetical. Antigravity (`agy`) paints
//! `ESC [ ? 1049 h` before its own `ESC [ ? 2004 h`, so judging by the
//! screen alone would leave every `agy` session with exactly the bug this
//! module fixes — the message typed into the composer, never submitted.
//! The fixtures below reproduce both observed shapes (agy's, and Claude
//! Code's normal-screen one) without running any model inference.
//!
//! Unix-only: the fixtures are shell scripts driving a real PTY.

#![cfg(unix)]

use std::time::{Duration, Instant};

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

fn ok(engine: &Engine, method: &str, params: Value) -> Value {
    let request_id = uuid::Uuid::new_v4().to_string();
    let response = engine.dispatch(
        serde_json::from_value::<Request>(json!({
            "protocol": PROTOCOL_VERSION,
            "requestId": request_id,
            "method": method,
            "params": params,
        }))
        .unwrap(),
    );
    assert!(
        response.ok,
        "expected ok for {method}: {:?}",
        response.error
    );
    response.result.unwrap()
}

fn base64_of(text: &str) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(text.as_bytes())
}

fn base64_decode(text: &str) -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(text.as_bytes())
        .unwrap()
}

/// Installs a fixture `claude` that announces `modes`, says READY, then
/// reads forever, and points `agentCmdOverrides` at it — the same
/// override seam the status-lifecycle suite uses, so no test touches
/// process-global PATH.
fn install_announcing_fixture(dir: &tempfile::TempDir, modes: &str) {
    let bin = dir.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let script = bin.join("claude");
    std::fs::write(
        &script,
        format!(
            "#!/bin/sh\nstty raw -echo\nprintf '%b' '{modes}'\nprintf 'READY:'\ncat >/dev/null\n"
        ),
    )
    .unwrap();
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    std::fs::write(
        dir.path().join("agent-settings.json"),
        serde_json::to_vec(&json!({
            "version": 1,
            "settings": {
                "defaultTuiAgent": null,
                "disabledTuiAgents": [],
                "agentCmdOverrides": { "claude": script.to_string_lossy() },
                "agentDefaultArgs": {},
                "agentDefaultEnv": {},
                "agentStatusHooksEnabled": false,
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

fn register_workspace(engine: &Engine) -> String {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_string_lossy().to_string();
    std::mem::forget(dir);
    ok(engine, "workspace.register", json!({ "path": path }))["id"]
        .as_str()
        .unwrap()
        .to_string()
}

/// Waits until the fixture's announcement has been read by the daemon,
/// which `READY:` proves: the reader scans a chunk for mode changes
/// before that chunk can be read back, so output showing `READY:` cannot
/// precede the announcement it followed.
fn wait_until_ready(engine: &Engine, session: &str, incarnation: &str) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        let read = ok(
            engine,
            "session.read",
            json!({ "sessionId": session, "incarnation": incarnation, "cursor": 0 }),
        );
        let bytes = base64_decode(read["dataBase64"].as_str().unwrap());
        if String::from_utf8_lossy(&bytes).contains("READY:") {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("the fixture never announced itself");
}

/// Launches the fixture through `harness.start`, sends one message, and
/// reports whether the service framed it.
fn framed_for_launched_harness(modes: &str) -> bool {
    let dir = tempfile::tempdir().unwrap();
    install_announcing_fixture(&dir, modes);
    let engine = Engine::open(dir.path()).unwrap();
    let workspace = register_workspace(&engine);
    let started = ok(
        &engine,
        "harness.start",
        json!({
            "workspaceId": workspace,
            "harnessId": "claude",
            "permissionMode": "inherit"
        }),
    );
    let session = started["session"]["id"]
        .as_str()
        .or_else(|| started["id"].as_str())
        .unwrap_or_else(|| panic!("no session id in {started:#}"))
        .to_string();
    let incarnation = started["session"]["incarnation"]
        .as_str()
        .or_else(|| started["incarnation"].as_str())
        .unwrap()
        .to_string();
    wait_until_ready(&engine, &session, &incarnation);

    let wrote = ok(
        &engine,
        "session.write",
        json!({
            "sessionId": session,
            "incarnation": incarnation,
            "dataBase64": base64_of("please retarget the PR at v2\r"),
            "submitEnter": true,
        }),
    );
    assert_eq!(wrote["enterDelivery"], "keypress", "{wrote:#}");
    let framed = wrote["bracketedPaste"].as_bool().unwrap();
    ok(
        &engine,
        "session.close",
        json!({ "sessionId": session, "incarnation": incarnation }),
    );
    framed
}

/// Antigravity's observed shape. Judging by the screen alone would leave
/// every `agy` session unframed, which is issue #625 all over again for
/// that harness; the launch record is what prevents it.
#[test]
fn a_launched_composer_on_the_alternate_screen_is_still_framed_for() {
    assert!(
        framed_for_launched_harness(r"\033[?1049h\033[?25l\033[?2004h"),
        "a harness Drogon launched is an agent composer whatever screen it paints on"
    );
}

/// Claude Code's and Codex's observed shape, through the same path.
#[test]
fn a_launched_composer_on_the_normal_screen_is_framed_for() {
    assert!(framed_for_launched_harness(
        r"\033[?25l\033[?2004h\033[?2031h"
    ));
}

/// The launch record never invents an announcement: a harness that never
/// asked for bracketed paste is still not framed for, because framing
/// bytes a program cannot interpret would be worse than the bug.
#[test]
fn a_launched_harness_that_never_asked_for_paste_is_not_framed_for() {
    assert!(!framed_for_launched_harness(r"\033[?1049h\033[?25l"));
    assert!(!framed_for_launched_harness(r"\033[?2004h\033[?2004l"));
}
