//! Adversarial-report regressions for the Bot handle lifecycle.
//!
//! 1. `bot.delete` left the `bot_homes` row behind, so a new Bot created
//!    with the same handle could never open a session again:
//!    `bot handle "nameprobe" is already owned by bot "<deleted id>"`,
//!    permanently, with no way to release the name. Deleting a Bot must
//!    release its handle.
//! 2. `bot.create` accepted case-variant duplicate handles ("Arya" vs
//!    "arya") that can be created but never boot: the second one to
//!    provision collides on the same canonical directory handle. A handle
//!    that cannot boot must be rejected at CREATE time, with the real
//!    reason.
//! 3. Data dirs written before the fix hold tombstone `bot_homes` rows
//!    whose Bot is gone; those must not block the handle either (the claim
//!    path heals them).
//!
//! All three FAIL on unmodified main (the released-handle open and the
//! tombstone open refuse with the HandleCollision error, and the
//! case-variant duplicate create succeeds).
//!
//! Unix-only: the open-session turn runs a shell fixture on PATH that
//! stays alive like a TUI (no real harness, no model inference).

#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::sync::Mutex;

use drogon_core::{DB_FILE_NAME, Engine};
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

/// Serializes PATH mutation across this file's tests (process-global).
static ENV_LOCK: Mutex<()> = Mutex::new(());

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

fn err(engine: &Engine, id: &str, method: &str, params: Value) -> drogon_protocol::RpcError {
    let response = call(engine, id, method, params);
    assert!(!response.ok, "expected an error for {method}: {response:?}");
    response.error.unwrap()
}

/// A `pi` stand-in that stays alive like an interactive TUI and exits on
/// stdin EOF (so dropping the engine's PTY reaps it -- no orphan).
fn write_staying_alive_fixture(bin: &std::path::Path) {
    let script = bin.join("pi");
    std::fs::write(
        &script,
        "#!/bin/sh\necho CWD=$(pwd)\ntrap 'exit 0' TERM INT\nwhile IFS= read -r line; do echo \"you said: $line\"; done\n",
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
}

struct Fixture {
    _root: tempfile::TempDir,
    engine: Engine,
    host: String,
    workspace_id: String,
    _bin: tempfile::TempDir,
    _path_restore: Box<dyn FnOnce()>,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("project");
        std::fs::create_dir(&folder).unwrap();
        let engine = Engine::open(&root.path().join("data")).unwrap();
        let workspace = ok(
            &engine,
            "ws-register",
            "workspace.register",
            json!({"path": folder.to_string_lossy()}),
        );
        let host = workspace["hostId"].as_str().unwrap().to_string();
        let workspace_id = workspace["id"].as_str().unwrap().to_string();

        let bin = tempfile::tempdir().unwrap();
        write_staying_alive_fixture(bin.path());
        let previous = std::env::var_os("PATH");
        let joined = std::env::join_paths(
            std::iter::once(bin.path().to_path_buf()).chain(
                previous
                    .as_ref()
                    .map(std::env::split_paths)
                    .into_iter()
                    .flatten(),
            ),
        )
        .unwrap();
        unsafe { std::env::set_var("PATH", &joined) };
        let restore = match previous {
            Some(value) => {
                Box::new(move || unsafe { std::env::set_var("PATH", value) }) as Box<dyn FnOnce()>
            }
            None => Box::new(|| unsafe { std::env::remove_var("PATH") }) as Box<dyn FnOnce()>,
        };

        Self {
            _root: root,
            engine,
            host,
            workspace_id,
            _bin: bin,
            _path_restore: restore,
        }
    }

    fn db_path(&self) -> std::path::PathBuf {
        self._root.path().join("data").join(DB_FILE_NAME)
    }

    fn create(&self, id: &str, request_id: &str, handle: &str) -> Value {
        ok(
            &self.engine,
            request_id,
            "bot.create",
            json!({
                "workspaceId": self.workspace_id,
                "hostId": self.host,
                "botId": id,
                "body": {
                    "characterPreset": "none",
                    "displayIdentity": {
                        "displayName": format!("Bot {handle}"),
                        "handle": handle,
                        "title": null,
                    },
                    "harnessPolicy": {
                        "defaultHarness": "pi",
                        "explicitModel": null,
                    },
                    "instructions": "",
                    "memories": [],
                },
            }),
        )
    }

    /// The same open-session shape the Bots page sends: interactive, no
    /// prompt, the harness's own entrypoint.
    fn open_session(&self, bot_id: &str, request_id: &str) -> Value {
        ok(
            &self.engine,
            request_id,
            "bot.run",
            json!({
                "workspaceId": self.workspace_id,
                "hostId": self.host,
                "botId": bot_id,
                "interactive": true,
                "harness": { "harnessId": "pi" },
            }),
        )
    }

    fn stop_session(&self, receipt: &Value, request_id: &str) {
        ok(
            &self.engine,
            request_id,
            "session.stop",
            json!({
                "sessionId": receipt["session"]["sessionId"],
                "incarnation": receipt["session"]["incarnation"],
            }),
        );
    }

    fn delete_bot(&self, bot_id: &str, request_id: &str) {
        ok(
            &self.engine,
            request_id,
            "bot.delete",
            json!({
                "workspaceId": self.workspace_id,
                "hostId": self.host,
                "botId": bot_id,
            }),
        );
    }
}

/// The tombstone regression: the handle must not die with the Bot.
/// FAILS on unmodified main -- the successor's open refuses with
/// `bot handle "nameprobe" is already owned by bot "bot-nameprobe-A"`.
#[test]
fn deleting_a_bot_releases_its_handle_for_a_successor() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let fx = Fixture::new();

    fx.create("bot-nameprobe-A", "create-a", "nameprobe");
    let first = fx.open_session("bot-nameprobe-A", "open-a");
    assert_eq!(first["outcome"], "dispatched", "{first:?}");
    fx.stop_session(&first, "stop-a");
    fx.delete_bot("bot-nameprobe-A", "delete-a");

    // A NEW Bot with the SAME handle: on main this create succeeds but the
    // open below refuses forever (the tombstone owns the handle).
    fx.create("bot-nameprobe-B", "create-b", "nameprobe");
    let second = fx.open_session("bot-nameprobe-B", "open-b");
    assert_eq!(
        second["outcome"], "dispatched",
        "the successor must be able to open a session with the released \
         handle: {second:?}"
    );
    fx.stop_session(&second, "stop-b");
    fx.delete_bot("bot-nameprobe-B", "delete-b");
}

/// Case-variant duplicates must be rejected at CREATE time with the real
/// reason, not accepted and left to fail at first open.
/// FAILS on unmodified main -- the second create succeeds.
#[test]
fn create_rejects_a_case_variant_handle_that_could_never_boot() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let fx = Fixture::new();

    fx.create("bot-arya-A", "create-arya", "Arya");
    let error = err(
        &fx.engine,
        "create-arya-lower",
        "bot.create",
        json!({
            "workspaceId": fx.workspace_id,
            "hostId": fx.host,
            "botId": "bot-arya-B",
            "body": {
                "characterPreset": "none",
                "displayIdentity": {
                    "displayName": "Bot arya",
                    "handle": "arya",
                    "title": null,
                },
                "harnessPolicy": {
                    "defaultHarness": "pi",
                    "explicitModel": null,
                },
                "instructions": "",
                "memories": [],
            },
        }),
    );
    assert_eq!(error.code, "invalid_argument");
    assert!(
        error.message.contains("already owned by bot") && error.message.contains("bot-arya-A"),
        "the refusal must name the real owner and the real reason: {error:?}"
    );
}

/// Data dirs written before the fix hold `bot_homes` rows whose Bot row is
/// gone. The claim path must heal those tombstones instead of blocking the
/// handle forever.
/// FAILS on unmodified main -- the successor's open refuses with the
/// HandleCollision error.
#[test]
fn a_legacy_tombstone_row_from_a_deleted_bot_does_not_block_the_handle() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let fx = Fixture::new();

    fx.create("bot-nameprobe-A", "create-a", "nameprobe");
    let first = fx.open_session("bot-nameprobe-A", "open-a");
    assert_eq!(first["outcome"], "dispatched", "{first:?}");
    fx.stop_session(&first, "stop-a");

    // Simulate a pre-fix delete: the bots row goes away, the bot_homes row
    // stays (the exact on-disk state this regression is about).
    {
        let conn = rusqlite::Connection::open(fx.db_path()).unwrap();
        let changed = conn
            .execute("DELETE FROM bots WHERE id = ?1", ["bot-nameprobe-A"])
            .unwrap();
        assert_eq!(changed, 1);
        let homes: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM bot_homes WHERE bot_id = ?1",
                ["bot-nameprobe-A"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(homes, 1, "the tombstone row is the point of the test");
    }

    fx.create("bot-nameprobe-B", "create-b", "nameprobe");
    let second = fx.open_session("bot-nameprobe-B", "open-b");
    assert_eq!(
        second["outcome"], "dispatched",
        "a tombstone from a gone Bot must not block the handle: {second:?}"
    );
    fx.stop_session(&second, "stop-b");
}
