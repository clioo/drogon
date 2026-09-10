//! REAL `Engine::dispatch` coverage for the Open-Session fix
//! (bug-bot-a836b4ebf8be65505 + the Carlos directive on
//! task_e7c183ebc637): the owner observed a Bot session print one
//! context-aware line then exit 0 immediately, because `bot.run`'s chat-turn
//! path always dispatched a HEADLESS one-shot daemon run (`claude -p`,
//! `pi -p`, ...) -- the exact seam `automations::runner` uses for a
//! scheduled/manual responsibility, which is SUPPOSED to complete and exit.
//! `RunTurn::OpenSession` (wire: `interactive: true`, NO `prompt`) instead
//! runs the harness's own interactive entrypoint (no `-p`) with nothing to
//! consume -- NO model turn is dispatched, so the session opens live and
//! IDLE and every environment fact the owner sees comes from the daemon's
//! own surfaces (status pill, inspector), never from a model recital --
//! AND the session runs in the Bot's own provisioned home workspace
//! (`bot_self_mgmt::ensure_home_for_bot`) instead of the folder the Bot's
//! record happens to be stored under.
//!
//! A real fixture shell script on `PATH` stands in for the harness (this
//! repo's established technique, see `native_bot_run_shell_fixture.rs` and
//! `headless_runs.rs`): NO paid inference, no real installed agent. The
//! fixture SLEEPS instead of exiting -- the one behavioral difference from
//! the headless fixture in `native_bot_run_shell_fixture.rs`
//! (which exits immediately) that this test file exists to prove -- and it
//! echoes every stdin line back, so "no `you said:` line" is behavioral
//! proof that the daemon delivered no prompt turn to the harness.
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

/// Stands in for the `pi` harness's OWN interactive entrypoint (no `-p`):
/// prints its cwd and argv, then blocks reading stdin -- echoing every line
/// back -- instead of exiting. Exactly what a real interactive TUI does
/// (wait for input), and the echo is what makes "no prompt turn was
/// delivered" behaviorally provable: a daemon-side prompt would show up as
/// a `you said:` line. `trap` so `session.stop`'s SIGTERM exits cleanly.
fn write_pi_fixture_staying_alive(bin: &std::path::Path) {
    let script = bin.join("pi");
    std::fs::write(
        &script,
        "#!/bin/sh\necho CWD=$(pwd)\nfor arg in \"$@\"; do echo \"ARG:$arg\"; done\ntrap 'exit 0' TERM INT\nwhile IFS= read -r line; do echo \"you said: $line\"; done\n",
    )
    .unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn base64_decode(text: &str) -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .unwrap()
}

/// Reads until `deadline`, returning the accumulated output and the LAST
/// observed verdict -- unlike `native_bot_run_shell_fixture.rs`'s
/// `read_until_exited` (which loops until exit and panics on timeout), a
/// still-`live` verdict at the deadline is the expected, asserted-on outcome
/// here.
fn read_for(
    engine: &Engine,
    session_id: &str,
    incarnation: &str,
    duration: Duration,
) -> (String, String) {
    let deadline = Instant::now() + duration;
    let mut cursor = 0u64;
    let mut text = String::new();
    let mut verdict = "live".to_string();
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
        verdict = read["session"]["verdict"].as_str().unwrap().to_string();
        if verdict == "exited" {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    (text, verdict)
}

struct Fixture {
    _root: tempfile::TempDir,
    engine: Engine,
    host: String,
    /// The bot's RECORD folder -- registered first, bot seeded there. This
    /// is deliberately NOT the bot's home: proving the interactive session's
    /// cwd is its own home (not this) is the isolation half of the fix.
    record_workspace_id: String,
    record_folder: String,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("project-worktree");
        std::fs::create_dir(&folder).unwrap();
        let engine = Engine::open(&root.path().join("data")).unwrap();
        let workspace = ok(
            &engine,
            "workspace.register",
            &uuid::Uuid::new_v4().to_string(),
            json!({"path": folder}),
        );
        let host = workspace["hostId"].as_str().unwrap().to_string();
        let record_workspace_id = workspace["id"].as_str().unwrap().to_string();
        let record_folder = workspace["path"].as_str().unwrap().to_string();

        let conn = rusqlite::Connection::open(root.path().join("data").join(DB_FILE_NAME)).unwrap();
        let bot = Bot {
            id: "bot-1".to_string(),
            character_preset: "none".to_string(),
            display_identity: DisplayIdentity {
                display_name: "Arya Stark".to_string(),
                handle: Some("arya-stark".to_string()),
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
        bstorage::create_bot(&conn, &host, &record_folder, &bot).unwrap();

        Self {
            _root: root,
            engine,
            host,
            record_workspace_id,
            record_folder,
        }
    }

    fn open_session_params(&self) -> Value {
        // task_e7c183ebc637: the Open Session dispatch carries NO prompt.
        // `interactive: true` without a prompt is the whole contract.
        json!({
            "workspaceId": self.record_workspace_id,
            "hostId": self.host,
            "botId": "bot-1",
            "interactive": true,
            "harness": { "harnessId": "pi" },
        })
    }
}

/// The core regression proof: opening an interactive Bot session must NOT
/// behave like the headless automation seam -- the harness must still be
/// `live` well after `harness.start` returned, never `exited`.
#[test]
fn interactive_open_session_stays_live_instead_of_exiting_like_a_headless_run() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let fx = Fixture::new();
    let bin = tempfile::tempdir().unwrap();
    write_pi_fixture_staying_alive(bin.path());
    prepend_fixture_bin(bin.path());

    let receipt = ok(
        &fx.engine,
        "bot.run",
        "req-open-session",
        fx.open_session_params(),
    );
    assert_eq!(receipt["outcome"], "dispatched", "{receipt:?}");
    let session_id = receipt["session"]["sessionId"]
        .as_str()
        .unwrap()
        .to_string();
    let incarnation = receipt["session"]["incarnation"]
        .as_str()
        .unwrap()
        .to_string();

    let (output, verdict) = read_for(
        &fx.engine,
        &session_id,
        &incarnation,
        Duration::from_millis(800),
    );
    assert_eq!(
        verdict, "live",
        "an interactive Bot session must stay live, not exit like a headless \
         one-shot run; output so far: {output:?}"
    );
    assert!(
        output.contains("CWD="),
        "expected the fixture's startup line, got {output:?}"
    );

    // Clean up the fixture's own long-running process (AGENTS.md: every
    // agent owns cleanup of the processes it starts for validation).
    let stopped = ok(
        &fx.engine,
        "session.stop",
        "req-stop",
        json!({"sessionId": session_id, "incarnation": incarnation}),
    );
    assert_eq!(stopped["verdict"], "exited");
}

/// The isolation half of the fix: the interactive session's cwd must be the
/// Bot's OWN provisioned home (`~/Drogon/bots/<handle>` in a real install),
/// never the folder its record happens to be stored under -- that folder is
/// whatever project workspace was selected at `bot.create` time, the
/// CALLER's workspace, not the Bot's.
#[test]
fn interactive_open_session_runs_in_the_bots_own_home_not_the_record_folder() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let fx = Fixture::new();
    let bin = tempfile::tempdir().unwrap();
    write_pi_fixture_staying_alive(bin.path());
    prepend_fixture_bin(bin.path());

    let receipt = ok(
        &fx.engine,
        "bot.run",
        "req-open-session",
        fx.open_session_params(),
    );
    assert_eq!(receipt["outcome"], "dispatched", "{receipt:?}");
    assert_ne!(
        receipt["workspaceId"],
        json!(fx.record_workspace_id),
        "the receipt must carry the Bot's OWN home workspace, never the \
         record folder's -- isolation is real, not cosmetic"
    );
    let session_id = receipt["session"]["sessionId"]
        .as_str()
        .unwrap()
        .to_string();
    let incarnation = receipt["session"]["incarnation"]
        .as_str()
        .unwrap()
        .to_string();

    let (output, _verdict) = read_for(
        &fx.engine,
        &session_id,
        &incarnation,
        Duration::from_millis(300),
    );
    assert!(
        !output.contains(&format!("CWD={}", fx.record_folder)),
        "the session must not run inside the project worktree its record \
         happens to be stored under: {output:?}"
    );
    assert!(
        output.contains(&format!(
            "{}bots{}arya-stark",
            std::path::MAIN_SEPARATOR,
            std::path::MAIN_SEPARATOR
        )),
        "expected the session's cwd inside the Bot's own provisioned home \
         (.../bots/arya-stark, the exact `~/Drogon/bots/<handle>` shape in a \
         real install), got {output:?}"
    );

    ok(
        &fx.engine,
        "session.stop",
        "req-stop",
        json!({"sessionId": session_id, "incarnation": incarnation}),
    );
}

/// `bot.snapshot` must reflect the just-opened session immediately (P1's
/// `currentSession`), proving `record_opened_session`'s
/// `bots_storage::rotate_session` call actually commits, not just the
/// receipt.
#[test]
fn interactive_open_session_rotates_the_bots_current_session_in_the_snapshot() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let fx = Fixture::new();
    let bin = tempfile::tempdir().unwrap();
    write_pi_fixture_staying_alive(bin.path());
    prepend_fixture_bin(bin.path());

    let receipt = ok(
        &fx.engine,
        "bot.run",
        "req-open-session",
        fx.open_session_params(),
    );
    let session_id = receipt["session"]["sessionId"]
        .as_str()
        .unwrap()
        .to_string();
    let incarnation = receipt["session"]["incarnation"]
        .as_str()
        .unwrap()
        .to_string();

    let snapshot = ok(
        &fx.engine,
        "bot.snapshot",
        "req-snapshot",
        json!({"workspaceId": "", "hostId": fx.host, "locale": "en-US"}),
    );
    let bots = snapshot["bots"].as_array().unwrap();
    let bot = bots
        .iter()
        .find(|b| b["id"] == "bot-1")
        .expect("bot-1 present in the global snapshot");
    assert_eq!(
        bot["currentSession"]["sessionId"],
        json!(session_id),
        "bot.snapshot must reflect the opened session's id: {bot:?}"
    );
    assert_eq!(bot["currentSession"]["harness"], json!("pi"));
    // Bot session inspector's Process ID row (bug-bot-a836b4ebf8be65505):
    // the fixture is genuinely still running at this point, so its real OS
    // pid must be projected onto the snapshot, never a placeholder.
    let pid = bot["currentSession"]["processId"]
        .as_u64()
        .unwrap_or_else(|| panic!("expected a live processId, got {bot:?}"));
    assert!(pid > 0);

    ok(
        &fx.engine,
        "session.stop",
        "req-stop",
        json!({"sessionId": session_id, "incarnation": incarnation}),
    );

    // The stopped session's pid must NOT still be projected -- a pid is
    // only ever meaningful for a currently-live process.
    let after_stop = ok(
        &fx.engine,
        "bot.snapshot",
        "req-snapshot-2",
        json!({"workspaceId": "", "hostId": fx.host, "locale": "en-US"}),
    );
    let bot_after = after_stop["bots"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["id"] == "bot-1")
        .unwrap();
    assert!(
        bot_after["currentSession"]["processId"].is_null(),
        "a stopped session must not still report a live pid: {bot_after:?}"
    );
}

/// The Carlos directive (task_e7c183ebc637), proven at the real dispatch
/// seam: an open-session dispatch must deliver NO model turn to the
/// harness. The fixture echoes every stdin line as `you said: ...` and
/// prints every argv entry as `ARG:...`, so any dispatched prompt -- the
/// daemon's own `Drogon task:`-wrapped operating prompt, delivered over
/// argv (Pi interactive) or stdin -- would show up in the output. Opening
/// must leave the harness with nothing to say: the session is live and
/// IDLE, waiting for the user's first real message.
#[test]
fn open_session_delivers_no_prompt_turn_to_the_harness() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let fx = Fixture::new();
    let bin = tempfile::tempdir().unwrap();
    write_pi_fixture_staying_alive(bin.path());
    prepend_fixture_bin(bin.path());

    let receipt = ok(
        &fx.engine,
        "bot.run",
        "req-open-session",
        fx.open_session_params(),
    );
    assert_eq!(receipt["outcome"], "dispatched", "{receipt:?}");
    // No message row exists for an open-session dispatch: no turn happened.
    assert!(
        receipt["messageId"].is_null(),
        "an open-session dispatch must not record a chat-turn message: {receipt:?}"
    );
    let session_id = receipt["session"]["sessionId"]
        .as_str()
        .unwrap()
        .to_string();
    let incarnation = receipt["session"]["incarnation"]
        .as_str()
        .unwrap()
        .to_string();

    let (output, verdict) = read_for(
        &fx.engine,
        &session_id,
        &incarnation,
        Duration::from_millis(800),
    );
    assert_eq!(
        verdict, "live",
        "the session must still be live with nothing to consume; output: {output:?}"
    );
    assert!(
        output.contains("CWD="),
        "expected the fixture's startup line (the harness DID start): {output:?}"
    );
    assert!(
        !output.contains("you said:"),
        "no prompt turn may be delivered to the harness on open -- the session \
         must open idle, not narrating its own state: {output:?}"
    );
    assert!(
        !output.contains("Drogon task:"),
        "the daemon's operating-prompt wrapper must never reach an open-session \
         harness, over argv or stdin: {output:?}"
    );
    assert!(
        !output.contains("confirm this session is live"),
        "the old hallucination-inviting greeting is gone for good: {output:?}"
    );

    ok(
        &fx.engine,
        "session.stop",
        "req-stop",
        json!({"sessionId": session_id, "incarnation": incarnation}),
    );
}

/// The wire contract itself must enforce the directive: `interactive: true`
/// alongside a `prompt` is a parse error, so no caller -- renderer, CLI,
/// test -- can ever ask the model to narrate the session's own state
/// through the open-session seam again.
#[test]
fn interactive_open_session_rejects_a_prompt_at_the_parse_seam() {
    use drogon_core::bot_run_rpc::parse_bot_run_request;

    let params = json!({
        "workspaceId": "ws-1",
        "hostId": "host-1",
        "botId": "bot-1",
        "prompt": "Hi! Reply briefly to confirm this session is live.",
        "interactive": true,
        "harness": { "harnessId": "pi" },
    });
    let error = parse_bot_run_request(&params).expect_err("prompt + interactive must be rejected");
    assert_eq!(error.code, "invalid_argument");
    assert!(
        error.message.contains("never dispatches a model turn"),
        "the refusal must state the design rule, got: {error:?}"
    );

    // `interactive: false` without a prompt is meaningless -- the only
    // promptless turn is an open-session dispatch.
    let params = json!({
        "workspaceId": "ws-1",
        "hostId": "host-1",
        "botId": "bot-1",
        "interactive": false,
        "harness": { "harnessId": "pi" },
    });
    let error = parse_bot_run_request(&params)
        .expect_err("interactive:false without a prompt must be rejected");
    assert_eq!(error.code, "invalid_argument");
}
