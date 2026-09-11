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
        "#!/bin/sh\necho CWD=$(pwd)\n[ -f .drogon-prior-conversation ] && echo \"PRIOR:$(cat .drogon-prior-conversation)\"\necho \"prior conversation 1\" > .drogon-prior-conversation\nfor arg in \"$@\"; do echo \"ARG:$arg\"; done\necho '---AGENTS---'\ncat AGENTS.md 2>/dev/null\necho '---CLAUDE---'\ncat CLAUDE.md 2>/dev/null\necho \"CHILD_SESSION=${CLAUDE_CODE_CHILD_SESSION:-}\"\necho \"CODEX_THREAD=${CODEX_THREAD_ID:-}\"\ntrap 'exit 0' TERM INT\nwhile IFS= read -r line; do echo \"you said: $line\"; done\n",
    )
    .unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
}

/// The same staying-alive script under the `claude` name, so a test can drive
/// the Claude Code resume path (whose on-disk transcript store the daemon now
/// inspects) without a real installed Claude Code.
fn write_claude_fixture_staying_alive(bin: &std::path::Path) {
    write_pi_fixture_staying_alive(bin);
    let pi = bin.join("pi");
    std::fs::copy(&pi, bin.join("claude")).unwrap();
}

/// A `claude` stand-in that keeps a per-home conversation and can be pointed
/// at one by id, the way the real CLI's `--resume <session-id>` does:
///
/// - fresh start: record this home's conversation id (`PROVIDER_ID`), append a
///   turn to its transcript, and print the transcript;
/// - `--resume <id>`: print `RESUMED:<id>` plus the transcript stored FOR THAT
///   ID -- so `RESUMED:<wrong id>` or `NO SUCH CONVERSATION` is a real failure,
///   not just a missing error message.
const PROVIDER_ID: &str = "9f8d1c2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";

fn write_resuming_claude_fixture(bin: &std::path::Path) {
    let script = bin.join("claude");
    std::fs::write(
        &script,
        format!(
            r#"#!/bin/sh
for arg in "$@"; do echo "ARG:$arg"; done
case "$*" in
  *--resume*)
    # The id is the argument right after --resume.
    shift_count=0
    for arg in "$@"; do
      if [ "$previous" = "--resume" ]; then resume_id="$arg"; fi
      previous="$arg"
      shift_count=$((shift_count + 1))
    done
    echo "RESUMED:${{resume_id}}"
    if [ -f ".drogon-conversation-${{resume_id}}" ]; then
      echo "CONVERSATION:$(cat .drogon-conversation-${{resume_id}})"
    else
      echo "NO SUCH CONVERSATION"
    fi
    ;;
  *)
    echo "{PROVIDER_ID}" > .drogon-provider-id
    echo "the first turn of {PROVIDER_ID}" > .drogon-conversation-{PROVIDER_ID}
    echo "CONVERSATION:$(cat .drogon-conversation-{PROVIDER_ID})"
    ;;
esac
trap 'exit 0' TERM INT
while IFS= read -r line; do echo "you said: $line"; done
"#
        ),
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
/// Reads until `ready(text)` holds, the session exits, or `timeout`
/// expires, returning the accumulated output and the LAST observed
/// verdict. Returning the moment the expected bytes arrive keeps tests fast
/// while a generous timeout keeps them robust when the whole suite runs in
/// parallel and a PTY spawn is slow.
fn read_until(
    engine: &Engine,
    session_id: &str,
    incarnation: &str,
    ready: impl Fn(&str) -> bool,
    timeout: Duration,
) -> (String, String) {
    let deadline = Instant::now() + timeout;
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
        if verdict == "exited" || ready(&text) {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    (text, verdict)
}

/// Reads for a fixed duration regardless of content (used after a
/// `read_until` when a test must positively observe that nothing else
/// arrives).
fn read_for(
    engine: &Engine,
    session_id: &str,
    incarnation: &str,
    duration: Duration,
) -> (String, String) {
    read_until(engine, session_id, incarnation, |_| false, duration)
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
        self.open_session_params_for("pi")
    }

    /// Same open-session shape for a specific harness, so the resume-degrade
    /// tests can exercise the Claude Code store without changing the rest of
    /// the fixture's Pi-based coverage.
    fn open_session_params_for(&self, harness: &str) -> Value {
        // task_e7c183ebc637: the Open Session dispatch carries NO prompt.
        // `interactive: true` without a prompt is the whole contract.
        json!({
            "workspaceId": self.record_workspace_id,
            "hostId": self.host,
            "botId": "bot-1",
            "interactive": true,
            "harness": { "harnessId": harness },
        })
    }

    /// Edits the Bot's stored identity/instructions/memories directly (the
    /// only mutation path this repo exposes today: identity editing has no
    /// RPC yet), so a test can prove the context files follow the record.
    fn edit_bot(&self, name: &str, instructions: &str, memories: &[&str]) {
        let conn =
            rusqlite::Connection::open(self._root.path().join("data").join(DB_FILE_NAME)).unwrap();
        bstorage::update_bot(
            &conn,
            &self.host,
            &self.record_folder,
            "bot-1",
            42.0,
            |bot| {
                bot.display_identity.display_name = name.to_string();
                bot.display_identity.title = Some("Scout".to_string());
                bot.instructions = instructions.to_string();
                bot.memories = memories.iter().map(|m| m.to_string()).collect();
            },
        )
        .unwrap();
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

    let (output, verdict) = read_until(
        &fx.engine,
        &session_id,
        &incarnation,
        |text| text.contains("CWD="),
        Duration::from_secs(20),
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

    let (output, _verdict) = read_until(
        &fx.engine,
        &session_id,
        &incarnation,
        |text| text.contains("CWD="),
        Duration::from_secs(20),
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

    let (mut output, verdict) = read_until(
        &fx.engine,
        &session_id,
        &incarnation,
        |text| text.contains("CWD="),
        Duration::from_secs(20),
    );
    // Observe a short settle window after startup: a prompt, if the daemon
    // had dispatch one, would be echoed here by the fixture's stdin loop.
    let (settled, _) = read_for(
        &fx.engine,
        &session_id,
        &incarnation,
        Duration::from_millis(400),
    );
    output.push_str(&settled);
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

/// Gap 1 (task_926fddc5e769): the Bot's identity, role, standing
/// instructions and memories must reach the HARNESS when the session
/// opens. The fixture is a real shell process started by the daemon in the
/// Bot's home; it `cat`s `AGENTS.md`/`CLAUDE.md` from its own working
/// directory, which is exactly what a context-file-reading harness does.
/// Asserting the files exist is not enough -- this asserts the bytes a real
/// harness process reads out of its cwd.
#[test]
fn open_session_materializes_the_identity_files_the_harness_reads() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let fx = Fixture::new();
    fx.edit_bot(
        "Arya Stark",
        "Always answer first as Arya Stark.",
        &["The owner is Carlos."],
    );
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

    let (output, _verdict) = read_until(
        &fx.engine,
        &session_id,
        &incarnation,
        // Wait for the CLAUDE.md CONTENT, not the marker that precedes
        // `cat CLAUDE.md`: stopping at the marker raced the `cat` output and
        // flaked under a loaded workspace test run.
        |text| text.contains("Your identity, role, standing instructions and memories"),
        Duration::from_secs(20),
    );
    assert!(
        output.contains("---AGENTS---") && output.contains("---CLAUDE---"),
        "the fixture must have read both identity files from its cwd: {output:?}"
    );
    assert!(
        output.contains("# Arya Stark"),
        "the harness must receive the Bot's display name: {output:?}"
    );
    assert!(
        output.contains("- Handle: @arya-stark") && output.contains("- Role:"),
        "the harness must receive the Bot's handle and role when present: {output:?}"
    );
    assert!(
        output.contains("Always answer first as Arya Stark."),
        "the harness must receive the Bot's standing instructions: {output:?}"
    );
    assert!(
        output.contains("- The owner is Carlos."),
        "the harness must receive the Bot's memories: {output:?}"
    );
    assert!(
        output.contains("Your identity, role, standing instructions and memories"),
        "CLAUDE.md must point the harness at AGENTS.md: {output:?}"
    );

    ok(
        &fx.engine,
        "session.stop",
        "req-stop",
        json!({"sessionId": session_id, "incarnation": incarnation}),
    );
}

/// Gap 1's second half: an edit to the Bot's display name, instructions or
/// memories must be reflected in the NEXT session's context files, with the
/// stale identity gone -- never two contradictory files on disk.
#[test]
fn editing_the_bot_identity_refreshes_the_files_the_next_session_reads() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let fx = Fixture::new();
    fx.edit_bot("Arya Stark", "First instructions.", &["First memory."]);
    let bin = tempfile::tempdir().unwrap();
    write_pi_fixture_staying_alive(bin.path());
    prepend_fixture_bin(bin.path());

    let first = ok(
        &fx.engine,
        "bot.run",
        "req-open-session-1",
        fx.open_session_params(),
    );
    let first_id = first["session"]["sessionId"].as_str().unwrap().to_string();
    let first_inc = first["session"]["incarnation"]
        .as_str()
        .unwrap()
        .to_string();
    let (first_output, _) = read_until(
        &fx.engine,
        &first_id,
        &first_inc,
        |text| text.contains("First instructions."),
        Duration::from_secs(20),
    );
    assert!(first_output.contains("First instructions."));
    ok(
        &fx.engine,
        "session.stop",
        "req-stop-1",
        json!({"sessionId": first_id, "incarnation": first_inc}),
    );

    // The owner edits the Bot's identity, instructions and memories.
    fx.edit_bot(
        "Arya of House Stark",
        "Second instructions.",
        &["Second memory."],
    );

    let second = ok(
        &fx.engine,
        "bot.run",
        "req-open-session-2",
        fx.open_session_params(),
    );
    assert_eq!(second["outcome"], "dispatched", "{second:?}");
    let second_id = second["session"]["sessionId"].as_str().unwrap().to_string();
    let second_inc = second["session"]["incarnation"]
        .as_str()
        .unwrap()
        .to_string();
    let (second_output, _) = read_until(
        &fx.engine,
        &second_id,
        &second_inc,
        |text| text.contains("Second memory."),
        Duration::from_secs(20),
    );
    assert!(
        second_output.contains("Arya of House Stark"),
        "the next session must read the edited display name: {second_output:?}"
    );
    assert!(
        second_output.contains("Second instructions.")
            && second_output.contains("- Second memory."),
        "the next session must read the edited instructions and memories: {second_output:?}"
    );
    assert!(
        !second_output.contains("First instructions.")
            && !second_output.contains("- First memory."),
        "the stale identity must be gone, never left beside the fresh one: {second_output:?}"
    );

    ok(
        &fx.engine,
        "session.stop",
        "req-stop-2",
        json!({"sessionId": second_id, "incarnation": second_inc}),
    );
}

// ---------------------------------------------------------------------------
// Defect 2: a CLOSED Bot session must reopen the harness's own prior
// conversation (`--continue` / `codex resume --last`), never a blank one.
// ---------------------------------------------------------------------------

/// The reopened session must carry the harness's own continue flag AND land
/// in the same home where the prior conversation lives -- `--continue` picks
/// the most recent conversation in the cwd, so the cwd being the same Bot
/// home is the precondition that makes the flag meaningful. The fixture
/// leaves a `.drogon-prior-conversation` marker on its first run and prints
/// `PRIOR:<contents>` when it finds one; the resumed run must find it.
#[test]
fn reopened_bot_session_resumes_the_harness_conversation() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let fx = Fixture::new();
    let bin = tempfile::tempdir().unwrap();
    write_pi_fixture_staying_alive(bin.path());
    prepend_fixture_bin(bin.path());

    // First, a fresh session: no `--continue`, no prior conversation yet.
    let first = ok(
        &fx.engine,
        "bot.run",
        "req-open-1",
        fx.open_session_params(),
    );
    assert_eq!(first["outcome"], "dispatched", "{first:?}");
    let first_id = first["session"]["sessionId"].as_str().unwrap().to_string();
    let first_inc = first["session"]["incarnation"]
        .as_str()
        .unwrap()
        .to_string();
    let (first_output, _) = read_until(
        &fx.engine,
        &first_id,
        &first_inc,
        |text| text.contains("CHILD_SESSION="),
        Duration::from_secs(20),
    );
    assert!(
        !first_output.contains("ARG:--continue"),
        "a fresh open must not claim to resume anything: {first_output:?}"
    );
    assert!(
        !first_output.contains("PRIOR:"),
        "the first session has no prior conversation: {first_output:?}"
    );
    ok(
        &fx.engine,
        "session.stop",
        "req-stop-1",
        json!({"sessionId": first_id, "incarnation": first_inc}),
    );

    // The session is now CLOSED. Reopening must resume, not start blank.
    let mut reopened_params = fx.open_session_params();
    reopened_params["resume"] = json!(true);
    let second = ok(&fx.engine, "bot.run", "req-open-2", reopened_params);
    assert_eq!(second["outcome"], "dispatched", "{second:?}");
    let second_id = second["session"]["sessionId"].as_str().unwrap().to_string();
    let second_inc = second["session"]["incarnation"]
        .as_str()
        .unwrap()
        .to_string();
    let (second_output, verdict) = read_until(
        &fx.engine,
        &second_id,
        &second_inc,
        |text| text.contains("PRIOR:"),
        Duration::from_secs(20),
    );
    assert_eq!(
        verdict, "live",
        "a resumed session is an interactive tab, not a one-shot run: {second_output:?}"
    );
    assert!(
        second_output.contains("ARG:--continue"),
        "the reopened session must pass the harness's own continue flag: {second_output:?}"
    );
    assert!(
        second_output.contains("PRIOR:prior conversation 1"),
        "the resumed session must run in the same Bot home the prior conversation \
         lives in: {second_output:?}"
    );
    ok(
        &fx.engine,
        "session.stop",
        "req-stop-2",
        json!({"sessionId": second_id, "incarnation": second_inc}),
    );
}

/// The owner's contract for the Bot twin, end to end: the harness reports the
/// conversation it is having (its own hook payload), the Bot record latches
/// that identity, and reopening the Bot names THAT conversation -- not the
/// most recent one in the home. The Drogon session row is REMOVED before the
/// reopen on purpose: the latched identity on the Bot record is what keeps the
/// dead end ("the daemon has not reported whether this Bot's session is still
/// running") from being permanent.
#[test]
fn reopened_bot_session_resumes_the_exact_conversation_the_harness_reported() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let _saved_claude_dir = SavedEnv::capture("CLAUDE_CONFIG_DIR");
    let fx = Fixture::new();
    let bin = tempfile::tempdir().unwrap();
    write_resuming_claude_fixture(bin.path());
    prepend_fixture_bin(bin.path());
    // An EMPTY Claude Code store: the filesystem would say "nothing to
    // resume", so only the harness's own reported id can name the
    // conversation.
    let claude_root = tempfile::tempdir().unwrap();
    unsafe { std::env::set_var("CLAUDE_CONFIG_DIR", claude_root.path()) };

    // 1. A fresh open, no resume claim.
    let opened = ok(
        &fx.engine,
        "bot.run",
        "req-open-identity",
        fx.open_session_params_for("claude"),
    );
    assert_eq!(opened["outcome"], "dispatched", "{opened:?}");
    let first_id = opened["session"]["sessionId"].as_str().unwrap().to_string();
    let first_inc = opened["session"]["incarnation"]
        .as_str()
        .unwrap()
        .to_string();
    let (first_output, _) = read_until(
        &fx.engine,
        &first_id,
        &first_inc,
        |text| text.contains("CONVERSATION:"),
        Duration::from_secs(20),
    );
    assert!(
        !first_output.contains("ARG:--resume"),
        "a fresh open must not claim to resume anything: {first_output:?}"
    );

    // 2. The harness's own hook payload reports the provider conversation.
    let reported = ok(
        &fx.engine,
        "session.hook_event",
        "req-hook-identity",
        json!({
            "sessionId": first_id,
            "incarnation": first_inc,
            "event": "SessionStart",
            "agentSessionId": PROVIDER_ID,
        }),
    );
    assert_eq!(reported["agentSessionId"], PROVIDER_ID);

    // 3. The snapshot latches it onto the Bot record.
    let snapshot = ok(
        &fx.engine,
        "bot.snapshot",
        "req-snapshot-identity",
        json!({"workspaceId": "", "hostId": fx.host, "locale": "en"}),
    );
    assert_eq!(
        snapshot["bots"][0]["currentSession"]["agentSessionId"], PROVIDER_ID,
        "the Bot record must learn the conversation identity"
    );

    // 4. Close the session and REMOVE its row: from here on the Bot record is
    //    the only place the identity exists.
    ok(
        &fx.engine,
        "session.stop",
        "req-stop-identity",
        json!({"sessionId": first_id, "incarnation": first_inc}),
    );
    ok(
        &fx.engine,
        "session.forget",
        "req-forget-identity",
        json!({"sessionId": first_id, "incarnation": first_inc}),
    );
    let listed = ok(&fx.engine, "session.list", "req-list-identity", json!({}));
    assert!(
        !listed["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["id"] == first_id.as_str()),
        "the durable row is gone; the record alone must carry the identity"
    );

    // 5. Reopen: the launch must name THAT conversation, and the harness must
    //    hand the prior turn's content back.
    let mut params = fx.open_session_params_for("claude");
    params["resume"] = json!(true);
    let reopened = ok(&fx.engine, "bot.run", "req-open-reopen", params);
    assert_eq!(reopened["outcome"], "dispatched", "{reopened:?}");
    let second_id = reopened["session"]["sessionId"]
        .as_str()
        .unwrap()
        .to_string();
    let second_inc = reopened["session"]["incarnation"]
        .as_str()
        .unwrap()
        .to_string();
    let (output, verdict) = read_until(
        &fx.engine,
        &second_id,
        &second_inc,
        |text| text.contains("CONVERSATION:") || text.contains("NO SUCH CONVERSATION"),
        Duration::from_secs(20),
    );
    assert_eq!(verdict, "live", "{output:?}");
    assert!(
        output.contains("ARG:--resume") && output.contains(&format!("ARG:{PROVIDER_ID}")),
        "the reopen must name the reported conversation id: {output:?}"
    );
    assert!(
        output.contains(&format!("RESUMED:{PROVIDER_ID}")),
        "the harness must be pointed at the SAME conversation: {output:?}"
    );
    assert!(
        output.contains(&format!("CONVERSATION:the first turn of {PROVIDER_ID}")),
        "the resumed run must return the prior conversation's CONTENT, not just exit cleanly: {output:?}"
    );
    ok(
        &fx.engine,
        "session.stop",
        "req-stop-reopen",
        json!({"sessionId": second_id, "incarnation": second_inc}),
    );
}

/// The resume-degrade safety: a reopen asks `claude` to continue its most
/// recent conversation in the Bot home, but when the Bot's Claude Code store
/// holds NO transcript for that directory the real CLI refuses to start and
/// exits. The daemon must degrade to a normal start so the session still
/// boots. The fixture is the proof: it prints every argv entry, so
/// `ARG:--continue` present/absent is exactly the launch the daemon built.
///
/// This FAILS on unmodified main (the resume flag was passed unconditionally)
/// and passes once the harness's own store decides.
#[test]
fn resume_degrades_to_a_normal_start_when_the_harness_has_no_conversation() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let _saved_claude_dir = SavedEnv::capture("CLAUDE_CONFIG_DIR");
    let fx = Fixture::new();
    let bin = tempfile::tempdir().unwrap();
    write_claude_fixture_staying_alive(bin.path());
    prepend_fixture_bin(bin.path());
    // An empty Claude Code config root: no `projects/<home>` transcript.
    let claude_root = tempfile::tempdir().unwrap();
    unsafe { std::env::set_var("CLAUDE_CONFIG_DIR", claude_root.path()) };

    let mut params = fx.open_session_params_for("claude");
    params["resume"] = json!(true);
    let opened = ok(&fx.engine, "bot.run", "req-open-degrade", params);
    assert_eq!(opened["outcome"], "dispatched", "{opened:?}");
    let session_id = opened["session"]["sessionId"].as_str().unwrap().to_string();
    let incarnation = opened["session"]["incarnation"]
        .as_str()
        .unwrap()
        .to_string();

    let (output, verdict) = read_until(
        &fx.engine,
        &session_id,
        &incarnation,
        |text| text.contains("CHILD_SESSION="),
        Duration::from_secs(20),
    );
    assert_eq!(
        verdict, "live",
        "the session must boot fresh instead of exiting on a resume with \
         nothing to resume: {output:?}"
    );
    assert!(
        output.contains("CWD="),
        "the harness must actually have started: {output:?}"
    );
    assert!(
        !output.contains("ARG:--continue"),
        "with no transcript in the harness's store the continue flag must be \
         dropped, never passed to a CLI that would refuse to start: {output:?}"
    );

    ok(
        &fx.engine,
        "session.stop",
        "req-stop-degrade",
        json!({"sessionId": session_id, "incarnation": incarnation}),
    );
}

/// The other half: when the harness's store DOES hold a transcript for the
/// Bot home, the requested resume is honored -- the degrade must not throw
/// away a real conversation.
#[test]
fn resume_is_kept_when_the_harness_conversation_exists() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let _saved_claude_dir = SavedEnv::capture("CLAUDE_CONFIG_DIR");
    let fx = Fixture::new();
    let bin = tempfile::tempdir().unwrap();
    write_claude_fixture_staying_alive(bin.path());
    prepend_fixture_bin(bin.path());
    let claude_root = tempfile::tempdir().unwrap();
    unsafe { std::env::set_var("CLAUDE_CONFIG_DIR", claude_root.path()) };

    // Learn the Bot's real home from a first (fresh) session, then plant the
    // transcript the CLI would have written there.
    let first = ok(
        &fx.engine,
        "bot.run",
        "req-open-keep-1",
        fx.open_session_params_for("claude"),
    );
    let first_id = first["session"]["sessionId"].as_str().unwrap().to_string();
    let first_inc = first["session"]["incarnation"]
        .as_str()
        .unwrap()
        .to_string();
    let (first_output, _) = read_until(
        &fx.engine,
        &first_id,
        &first_inc,
        |text| text.contains("CWD="),
        Duration::from_secs(20),
    );
    let home = first_output
        .lines()
        .find_map(|line| line.strip_prefix("CWD="))
        .expect("the fixture prints its cwd")
        .trim()
        .to_string();
    ok(
        &fx.engine,
        "session.stop",
        "req-stop-keep-1",
        json!({"sessionId": first_id, "incarnation": first_inc}),
    );

    let project =
        claude_root
            .path()
            .join("projects")
            .join(drogon_harness::claude_project_dir_name(
                std::path::Path::new(&home),
            ));
    std::fs::create_dir_all(&project).unwrap();
    std::fs::write(
        project.join("11111111-2222-3333-4444-555555555555.jsonl"),
        "{}\n",
    )
    .unwrap();

    let mut params = fx.open_session_params_for("claude");
    params["resume"] = json!(true);
    let second = ok(&fx.engine, "bot.run", "req-open-keep-2", params);
    let second_id = second["session"]["sessionId"].as_str().unwrap().to_string();
    let second_inc = second["session"]["incarnation"]
        .as_str()
        .unwrap()
        .to_string();
    let (second_output, verdict) = read_until(
        &fx.engine,
        &second_id,
        &second_inc,
        |text| text.contains("CHILD_SESSION="),
        Duration::from_secs(20),
    );
    assert_eq!(verdict, "live", "{second_output:?}");
    assert!(
        second_output.contains("ARG:--continue"),
        "a real transcript in the store must keep the requested resume: {second_output:?}"
    );
    ok(
        &fx.engine,
        "session.stop",
        "req-stop-keep-2",
        json!({"sessionId": second_id, "incarnation": second_inc}),
    );
}

/// The env half of Defect 2: a daemon launched from inside a harness session
/// (the coordinator's own accident that produced "Transcript saving is off —
/// inherited CLAUDE_CODE_CHILD_SESSION marker") must still spawn a clean
/// TOP-LEVEL harness for a Bot. With the markers poisoned in THIS process's
/// environment, the spawned fixture must observe them empty.
#[test]
fn poisoned_parent_harness_identity_never_reaches_the_spawned_bot_harness() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let _saved_child = SavedEnv::capture("CLAUDE_CODE_CHILD_SESSION");
    let _saved_session = SavedEnv::capture("CLAUDE_CODE_SESSION_ID");
    let _saved_entrypoint = SavedEnv::capture("CLAUDE_CODE_ENTRYPOINT");
    let _saved_bridge = SavedEnv::capture("CLAUDE_CODE_BRIDGE_SESSION_ID");
    let _saved_codex = SavedEnv::capture("CODEX_THREAD_ID");
    let fx = Fixture::new();
    let bin = tempfile::tempdir().unwrap();
    write_pi_fixture_staying_alive(bin.path());
    prepend_fixture_bin(bin.path());

    for key in [
        "CLAUDE_CODE_CHILD_SESSION",
        "CLAUDE_CODE_SESSION_ID",
        "CLAUDE_CODE_ENTRYPOINT",
        "CLAUDE_CODE_BRIDGE_SESSION_ID",
        "CODEX_THREAD_ID",
    ] {
        unsafe { std::env::set_var(key, "poison") };
    }

    let receipt = ok(
        &fx.engine,
        "bot.run",
        "req-open-poisoned",
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
    let (output, _) = read_until(
        &fx.engine,
        &session_id,
        &incarnation,
        |text| text.contains("CODEX_THREAD="),
        Duration::from_secs(20),
    );
    assert!(
        output.contains("CHILD_SESSION=") && !output.contains("CHILD_SESSION=poison"),
        "CLAUDE_CODE_CHILD_SESSION must never reach the Bot's harness: {output:?}"
    );
    assert!(
        output.contains("CODEX_THREAD=") && !output.contains("CODEX_THREAD=poison"),
        "CODEX_THREAD_ID must never reach the Bot's harness: {output:?}"
    );
    ok(
        &fx.engine,
        "session.stop",
        "req-stop-poisoned",
        json!({"sessionId": session_id, "incarnation": incarnation}),
    );
}

// ---------------------------------------------------------------------------
// Defect 1's data half: the Bot record must carry the daemon's OWN liveness
// facts, so the renderer can decide focus/reopen/open without guessing from
// the selected workspace's session list.
// ---------------------------------------------------------------------------

#[test]
fn snapshot_projects_the_recorded_sessions_workspace_incarnation_and_verdict() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _saved_path = SavedEnv::capture("PATH");
    let fx = Fixture::new();
    let bin = tempfile::tempdir().unwrap();
    write_pi_fixture_staying_alive(bin.path());
    prepend_fixture_bin(bin.path());

    let receipt = ok(
        &fx.engine,
        "bot.run",
        "req-open-facts",
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
    let home_workspace_id = receipt["workspaceId"].as_str().unwrap().to_string();

    let snapshot = ok(
        &fx.engine,
        "bot.snapshot",
        "req-snapshot-facts",
        json!({"workspaceId": "", "hostId": fx.host, "locale": "en-US"}),
    );
    let bot = snapshot["bots"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["id"] == "bot-1")
        .unwrap()
        .clone();
    let recorded = &bot["currentSession"];
    assert_eq!(recorded["sessionId"], json!(session_id));
    assert_eq!(
        recorded["workspaceId"],
        json!(home_workspace_id),
        "the recorded link must name the Bot's OWN home workspace: {recorded:?}"
    );
    assert_eq!(
        recorded["incarnation"],
        json!(incarnation),
        "the recorded link must carry the incarnation needed to focus it: {recorded:?}"
    );
    assert_eq!(
        recorded["verdict"],
        json!("live"),
        "a running session must be projected live: {recorded:?}"
    );

    ok(
        &fx.engine,
        "session.stop",
        "req-stop-facts",
        json!({"sessionId": session_id, "incarnation": incarnation}),
    );

    let after = ok(
        &fx.engine,
        "bot.snapshot",
        "req-snapshot-facts-2",
        json!({"workspaceId": "", "hostId": fx.host, "locale": "en-US"}),
    );
    let recorded_after = after["bots"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["id"] == "bot-1")
        .unwrap()["currentSession"]
        .clone();
    assert_eq!(
        recorded_after["verdict"],
        json!("exited"),
        "a closed session must be projected exited, which is what tells the \
         renderer to reopen it with a resume instead of silently opening a \
         second session: {recorded_after:?}"
    );
    assert_eq!(
        recorded_after["incarnation"],
        json!(incarnation),
        "the exited record keeps the incarnation that names the closed session"
    );
}

// ---------------------------------------------------------------------------
// The wire contract: `resume` is only meaningful on an open-session dispatch.
// ---------------------------------------------------------------------------

#[test]
fn resume_is_rejected_outside_an_open_session_dispatch() {
    use drogon_core::bot_run_rpc::parse_bot_run_request;

    // resume + prompt: a chat turn has no prior conversation to reopen.
    let with_prompt = json!({
        "workspaceId": "ws-1",
        "hostId": "host-1",
        "botId": "bot-1",
        "prompt": "hi",
        "resume": true,
        "harness": { "harnessId": "pi" },
    });
    let error = parse_bot_run_request(&with_prompt).expect_err("resume + prompt must be rejected");
    assert_eq!(error.code, "invalid_argument");
    assert!(
        error.message.contains("open-session"),
        "the refusal must name the only valid dispatch: {error:?}"
    );

    // resume without interactive: same refusal.
    let without_interactive = json!({
        "workspaceId": "ws-1",
        "hostId": "host-1",
        "botId": "bot-1",
        "resume": true,
        "responsibilityId": "resp-1",
        "reason": "manual",
        "eventIdentity": "evt-1",
    });
    let error = parse_bot_run_request(&without_interactive)
        .expect_err("resume without interactive must be rejected");
    assert_eq!(error.code, "invalid_argument");

    // resume: true with interactive: true parses.
    let admitted = json!({
        "workspaceId": "ws-1",
        "hostId": "host-1",
        "botId": "bot-1",
        "interactive": true,
        "resume": true,
        "harness": { "harnessId": "pi" },
    });
    assert!(parse_bot_run_request(&admitted).is_ok());

    // A non-boolean resume is refused.
    let bad_type = json!({
        "workspaceId": "ws-1",
        "hostId": "host-1",
        "botId": "bot-1",
        "interactive": true,
        "resume": "yes",
    });
    let error = parse_bot_run_request(&bad_type).expect_err("non-boolean resume must be rejected");
    assert_eq!(error.code, "invalid_argument");
}
