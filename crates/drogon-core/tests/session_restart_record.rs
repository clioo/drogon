//! R12-E terminal-restart record tests: the session record carries the
//! launch argv (`command`/`args`) and the launching harness id
//! (`harnessId`, additive), and `session.start` accepts an optional
//! `command` so a restart can re-launch the exact prior argv. The harness
//! case runs a fake `pi` executable from a fixture PATH so no real harness
//! or model inference is involved. Unix-only (shell fixtures).

#![cfg(unix)]

use std::io::Write as _;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::Mutex;

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

/// Serializes PATH mutation across the tests in this file (see
/// session_env_shim.rs for the same pattern).
static PATH_LOCK: Mutex<()> = Mutex::new(());

fn call(engine: &Engine, id: &str, method: &str, params: Value) -> Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    })
}

fn ok(engine: &Engine, id: &str, method: &str, params: Value) -> Value {
    let response = call(engine, id, method, params);
    assert!(response.ok, "{method}: {:?}", response.error);
    response.result.unwrap()
}

/// The idempotency ledger rejects a reused request id with different
/// params, so every call gets its own id.
fn unique(prefix: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    format!("{prefix}-{}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

fn listed(engine: &Engine) -> Vec<Value> {
    ok(engine, &unique("list"), "session.list", json!({}))["sessions"]
        .as_array()
        .unwrap()
        .clone()
}

fn record_of(engine: &Engine, session_id: &str) -> Value {
    listed(engine)
        .into_iter()
        .find(|row| row["id"] == session_id)
        .unwrap_or_else(|| panic!("session {session_id} missing from list"))
}

/// Writes an executable stand-in for the `pi` harness that just sleeps, so
/// `harness.start` discovers and launches it without any model inference.
/// The tempdir is intentionally leaked (`keep`): the engine's PTY child
/// keeps executing from this path for the rest of the test.
fn fake_harness_dir(name: &str) -> PathBuf {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(name);
    let mut script = std::fs::File::create(&path).unwrap();
    script.write_all(b"#!/bin/sh\nsleep 30\n").unwrap();
    script.sync_all().unwrap();
    drop(script);
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    dir.keep()
}

fn with_fixture_path(extra: &std::path::Path, run: impl FnOnce()) {
    let _guard = PATH_LOCK.lock().unwrap();
    let previous = std::env::var_os("PATH");
    let joined = std::env::join_paths(
        std::iter::once(extra.to_path_buf()).chain(
            previous
                .as_ref()
                .map(std::env::split_paths)
                .into_iter()
                .flatten(),
        ),
    )
    .unwrap();
    unsafe { std::env::set_var("PATH", &joined) };
    run();
    match previous {
        Some(value) => unsafe { std::env::set_var("PATH", value) },
        None => unsafe { std::env::remove_var("PATH") },
    }
}

#[test]
fn plain_session_record_carries_launch_argv_and_null_harness() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let ws = ok(
        &engine,
        &unique("ws"),
        "workspace.register",
        json!({ "path": dir.path().to_string_lossy() }),
    );
    let workspace_id = ws["id"].as_str().unwrap();

    // Explicit argv round-trips verbatim onto the record.
    let started = ok(
        &engine,
        &unique("start"),
        "session.start",
        json!({
            "workspaceId": workspace_id,
            "command": "/bin/sleep",
            "args": ["2"],
        }),
    );
    assert_eq!(started["command"], "/bin/sleep");
    assert_eq!(started["args"], json!(["2"]));
    assert_eq!(started["harnessId"], Value::Null);

    // Restart reuse: session.start repeats the record's argv exactly.
    let restarted = ok(
        &engine,
        &unique("start"),
        "session.start",
        json!({
            "workspaceId": workspace_id,
            "command": started["command"],
            "args": started["args"],
        }),
    );
    assert_eq!(restarted["command"], started["command"]);
    assert_eq!(restarted["args"], started["args"]);
    assert_eq!(restarted["harnessId"], Value::Null);

    // `command` is additive-optional: absent, the daemon picks its default
    // interactive shell (never empty).
    let default_shell = ok(
        &engine,
        &unique("start"),
        "session.start",
        json!({ "workspaceId": workspace_id }),
    );
    let command = default_shell["command"].as_str().unwrap();
    assert!(
        !command.is_empty(),
        "default shell command must not be empty"
    );

    for row in listed(&engine) {
        assert!(
            row.get("harnessId").is_some(),
            "every session record carries the additive harnessId field: {row}"
        );
        let stop = ok(
            &engine,
            &unique("stop"),
            "session.stop",
            json!({
                "sessionId": row["id"],
                "incarnation": row["incarnation"],
            }),
        );
        assert_eq!(stop["verdict"], "exited");
    }
}

#[test]
fn harness_session_record_carries_harness_id_for_restart() {
    let fixture_dir = fake_harness_dir("pi");
    with_fixture_path(&fixture_dir, || {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::open(dir.path()).unwrap();
        let ws = ok(
            &engine,
            &unique("ws"),
            "workspace.register",
            json!({ "path": dir.path().to_string_lossy() }),
        );
        let workspace_id = ws["id"].as_str().unwrap();

        let launched = ok(
            &engine,
            &unique("harness-start"),
            "harness.start",
            json!({
                "workspaceId": workspace_id,
                "harnessId": "pi",
                "permissionMode": "inherit",
            }),
        );
        // The launch-identity record: same harness id the launcher used, so
        // a terminal Restart can call harness.start with it again.
        assert_eq!(launched["harnessId"], "pi");
        let executable = launched["command"].as_str().unwrap();
        assert!(
            PathBuf::from(executable).ends_with("pi"),
            "harness command is the discovered executable: {executable}"
        );

        let stored = record_of(&engine, launched["id"].as_str().unwrap());
        assert_eq!(stored["harnessId"], "pi");
        assert_eq!(stored["command"], launched["command"]);

        let stopped = ok(
            &engine,
            &unique("stop"),
            "session.stop",
            json!({
                "sessionId": launched["id"],
                "incarnation": launched["incarnation"],
            }),
        );
        assert_eq!(stopped["verdict"], "exited");
    });
}
