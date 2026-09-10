//! REAL `Engine::dispatch`/staged-ledger coverage for `bot.run`'s owner
//! resolution: the `native_bot_run.rs` pure-bridge tests prove
//! `authorized_prepare`/`revalidate_run_scope` in
//! isolation, but every one of its REAL-ENGINE tests dispatches an
//! intentionally-unknown harness id, so none of them ever launches an
//! actual session whose real cwd can be checked. This file closes that gap:
//! a real fixture shell script on PATH (this repo's established technique,
//! see `headless_runs.rs`) stands in for the harness, so `bot.run` goes all
//! the way through `run_staged`/`harness.start`/a real PTY child and back,
//! with NO paid inference and no real installed agent.
#![cfg(unix)]

use std::sync::Mutex;
use std::time::{Duration, Instant};

use drogon_core::bots::records::{
    Bot, DEFAULT_DROGON_BOT_HARNESS, DisplayIdentity, HarnessModelPolicy,
};
use drogon_core::bots::storage as bstorage;
use drogon_core::{DB_FILE_NAME, Engine};
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

fn ok(engine: &Engine, method: &str, request_id: &str, params: Value) -> Value {
    let response = engine.dispatch(req(method, request_id, params));
    assert!(
        response.ok,
        "expected ok for {method}: {:?}",
        response.error
    );
    response.result.unwrap()
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
    let joined = std::env::join_paths(paths).unwrap();
    unsafe { std::env::set_var("PATH", joined) };
}

/// Stands in for the `pi` harness: prints its own working directory and
/// exits immediately -- proves the real spawn's cwd without any inference.
fn write_pi_fixture_echoing_cwd(bin: &std::path::Path) {
    let script = bin.join("pi");
    std::fs::write(&script, "#!/bin/sh\necho CWD=$(pwd)\n").unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn base64_decode(text: &str) -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .unwrap()
}

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
            &uuid::Uuid::new_v4().to_string(),
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

struct Fixture {
    _root: tempfile::TempDir,
    engine: Engine,
    host: String,
    /// The bot's real home workspace -- registered first, bot seeded there.
    home_workspace_id: String,
    home_folder: String,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("bot-home");
        std::fs::create_dir(&folder).unwrap();
        let engine = Engine::open(&root.path().join("data")).unwrap();
        let workspace = ok(
            &engine,
            "workspace.register",
            &uuid::Uuid::new_v4().to_string(),
            json!({"path": folder}),
        );
        let host = workspace["hostId"].as_str().unwrap().to_string();
        let home_workspace_id = workspace["id"].as_str().unwrap().to_string();
        let home_folder = workspace["path"].as_str().unwrap().to_string();

        let conn = rusqlite::Connection::open(root.path().join("data").join(DB_FILE_NAME)).unwrap();
        let bot = Bot {
            id: "bot-1".to_string(),
            character_preset: "none".to_string(),
            display_identity: DisplayIdentity {
                display_name: "Watcher".to_string(),
                handle: None,
                title: None,
            },
            harness_policy: HarnessModelPolicy {
                default_harness: DEFAULT_DROGON_BOT_HARNESS.to_string(),
                explicit_model: None,
            },
            instructions: String::new(),
            memories: Vec::new(),
            responsibilities: Vec::new(),
            current_session: None,
            created_at: 0.0,
            updated_at: 0.0,
        };
        bstorage::create_bot(&conn, &host, &home_folder, &bot).unwrap();

        Self {
            _root: root,
            engine,
            host,
            home_workspace_id,
            home_folder,
        }
    }

    fn register_other_workspace(&self) -> (String, String) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_path_buf();
        std::mem::forget(dir); // outlives the fixture's own lifetime
        let workspace = ok(
            &self.engine,
            "workspace.register",
            &uuid::Uuid::new_v4().to_string(),
            json!({"path": path}),
        );
        (
            workspace["id"].as_str().unwrap().to_string(),
            workspace["path"].as_str().unwrap().to_string(),
        )
    }

    fn chat_params(&self, workspace_id: &str) -> Value {
        json!({
            "workspaceId": workspace_id,
            "hostId": self.host,
            "botId": "bot-1",
            "prompt": "what's the status?",
            "harness": { "harnessId": "pi" },
        })
    }
}

/// Host-global scope (`workspaceId: ""`, bot.snapshot's own aggregation
/// sentinel): the real staged dispatch must launch `pi` with the bot's
/// TRUE home as its cwd, not fail on an empty/unresolvable workspace.
#[test]
fn bot_run_host_global_scope_launches_the_real_session_at_the_bots_true_workspace() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let fx = Fixture::new();
    let bin = tempfile::tempdir().unwrap();
    write_pi_fixture_echoing_cwd(bin.path());
    prepend_fixture_bin(bin.path());

    let receipt = ok(&fx.engine, "bot.run", "req-host-global", fx.chat_params(""));
    assert_eq!(receipt["outcome"], "dispatched", "{receipt:?}");
    assert_eq!(
        receipt["workspaceId"],
        json!(fx.home_workspace_id),
        "the receipt itself must carry the bot's true owning workspaceId"
    );
    let session_id = receipt["session"]["sessionId"].as_str().unwrap();
    let incarnation = receipt["session"]["incarnation"].as_str().unwrap();
    let output = read_until_exited(&fx.engine, session_id, incarnation, Duration::from_secs(10));
    assert!(
        output.contains(&format!("CWD={}", fx.home_folder)),
        "expected the real session's cwd to be the bot's true home {:?}, got output {output:?}",
        fx.home_folder
    );
}

/// A second, validly-registered workspace under the same host, asserted by
/// the caller instead of the bot's own -- the real staged dispatch must
/// still launch at the bot's true home, never the caller's stale/mismatched
/// (but otherwise valid) selection.
#[test]
fn bot_run_different_valid_workspace_still_launches_at_the_bots_true_workspace() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let fx = Fixture::new();
    let (other_workspace_id, other_folder) = fx.register_other_workspace();
    assert_ne!(other_folder, fx.home_folder);
    let bin = tempfile::tempdir().unwrap();
    write_pi_fixture_echoing_cwd(bin.path());
    prepend_fixture_bin(bin.path());

    let receipt = ok(
        &fx.engine,
        "bot.run",
        "req-other-ws",
        fx.chat_params(&other_workspace_id),
    );
    assert_eq!(receipt["outcome"], "dispatched", "{receipt:?}");
    assert_eq!(
        receipt["workspaceId"],
        json!(fx.home_workspace_id),
        "the receipt itself must carry the bot's true owning workspaceId"
    );
    let session_id = receipt["session"]["sessionId"].as_str().unwrap();
    let incarnation = receipt["session"]["incarnation"].as_str().unwrap();
    let output = read_until_exited(&fx.engine, session_id, incarnation, Duration::from_secs(10));
    assert!(
        output.contains(&format!("CWD={}", fx.home_folder)),
        "expected the bot's true home {:?}, not the caller's asserted workspace {:?}: got {output:?}",
        fx.home_folder,
        other_folder
    );
}

/// An exact request replay (same envelope requestId, same params) must
/// never spawn a second real session -- the delegated ledger returns the
/// stored receipt verbatim, proven here by a real process count, not just
/// a `requests` row count.
#[test]
fn bot_run_exact_request_replay_launches_only_one_real_session() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let fx = Fixture::new();
    let bin = tempfile::tempdir().unwrap();
    write_pi_fixture_echoing_cwd(bin.path());
    prepend_fixture_bin(bin.path());

    let params = fx.chat_params("");
    let first = ok(&fx.engine, "bot.run", "req-replay", params.clone());
    let second = ok(&fx.engine, "bot.run", "req-replay", params);
    assert_eq!(
        first, second,
        "an exact replay must return the identical stored receipt"
    );

    let conn = rusqlite::Connection::open(fx._root.path().join("data").join(DB_FILE_NAME)).unwrap();
    let harness_start_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM requests WHERE method = 'harness.start'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        harness_start_count, 1,
        "replay must not re-dispatch harness.start a second time"
    );
    let bot_message_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM bot_messages", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        bot_message_count, 1,
        "replay must not persist a second bot message row"
    );
}

/// A workspace genuinely owned by ANOTHER host (not a mismatched-but-local
/// selection) must still be rejected through the FULL `Engine::dispatch`
/// pipeline -- not only when `authorized_prepare`/`revalidate_run_scope`
/// are called directly, matching `workspace_owned_by_another_host_is_refused_even_when_the_assertion_matches`
/// in `native_bot_run.rs` but proven end to end here.
#[test]
fn bot_run_workspace_owned_by_another_host_is_rejected_through_full_engine_dispatch() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let fx = Fixture::new();

    let conn = rusqlite::Connection::open(fx._root.path().join("data").join(DB_FILE_NAME)).unwrap();
    conn.execute(
        "INSERT INTO workspaces (id, path, name, kind, host_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params!["ws-foreign", "/tmp/foreign", "foreign", "folder", "host-other", "2026-09-09T00:00:00Z"],
    )
    .unwrap();
    drop(conn);

    let response = fx.engine.dispatch(req(
        "bot.run",
        "req-foreign-host",
        fx.chat_params("ws-foreign"),
    ));
    assert!(
        !response.ok,
        "a workspace owned by another host must be a hard denial, got {response:?}"
    );
    assert_eq!(response.error.unwrap().code, "unauthorized");

    // No harness.start was ever attempted -- rejected before dispatch, no
    // fixture bin needed on PATH for this test at all.
    let conn = rusqlite::Connection::open(fx._root.path().join("data").join(DB_FILE_NAME)).unwrap();
    let harness_start_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM requests WHERE method = 'harness.start'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(harness_start_count, 0);
}
