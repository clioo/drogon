//! DISHONEST-3 (Delegate must be delivered): flipping the Work Graph's
//! Delegate toggle must change what the NEXT session in that workspace
//! actually receives, not only `intent.policy.delegate` on disk and
//! `drogon-cli skills get`'s prose. This is REAL `Engine::dispatch` coverage
//! against `harness.start`: a shell fixture stands in for the harness
//! (never a real, possibly paid, install) and proves the daemon wrote the
//! current Subagent policy into `AGENTS.md`/`CLAUDE.md` in the workspace's
//! own working directory BEFORE the harness process ever read it -- the
//! exact seam `bots::context_files` already uses for a Bot's identity,
//! generalized to an ordinary (non-Bot) workspace session.
//!
//! Unix-only: the harness is a real shell script on `PATH`, not a real
//! installed agent. It stays alive (like an interactive TUI) until its
//! stdin closes, so dropping the session cannot leave an orphan behind.
#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine as _;
use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

/// Serializes this file's tests: all of them mutate the process `PATH`.
static ENV_LOCK: Mutex<()> = Mutex::new(());

fn call(engine: &Engine, method: &str, params: Value) -> Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        auth: None,
        method: method.into(),
        params,
    })
}

fn ok(engine: &Engine, method: &str, params: Value) -> Value {
    let response = call(engine, method, params);
    assert!(response.ok, "{method}: {:?}", response.error);
    response.result.unwrap()
}

fn prepend_fixture_bin(bin: &Path) -> Option<std::ffi::OsString> {
    let previous = std::env::var_os("PATH");
    let mut paths = previous
        .as_ref()
        .map(std::env::split_paths)
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    paths.insert(0, bin.to_path_buf());
    let joined = std::env::join_paths(paths).unwrap();
    unsafe { std::env::set_var("PATH", joined) };
    previous
}

fn restore_path(previous: Option<std::ffi::OsString>) {
    match previous {
        Some(value) => unsafe { std::env::set_var("PATH", value) },
        None => unsafe { std::env::remove_var("PATH") },
    }
}

/// Stands in for `claude`'s own interactive entrypoint: prints its cwd, then
/// `cat`s `AGENTS.md`/`CLAUDE.md` from that cwd (exactly what a real harness
/// does on its own, per `bots::context_files`'s own doc comment), then
/// blocks on stdin so the test can read a clean, complete snapshot before
/// tearing it down.
fn write_claude_fixture(bin: &Path) {
    let script = bin.join("claude");
    std::fs::write(
        &script,
        "#!/bin/sh\necho CWD=$(pwd)\necho '---AGENTS---'\ncat AGENTS.md 2>/dev/null\necho '---CLAUDE---'\ncat CLAUDE.md 2>/dev/null\necho '---END---'\ntrap 'exit 0' TERM INT\nwhile IFS= read -r line; do :; done\n",
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn base64_decode(text: &str) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .unwrap()
}

/// Reads until the accumulated output contains `---END---` (the fixture's
/// own completion marker) or `timeout` expires.
fn read_until_complete(
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
            json!({ "sessionId": session_id, "incarnation": incarnation, "cursor": cursor }),
        );
        let bytes = base64_decode(read["dataBase64"].as_str().unwrap());
        text.push_str(&String::from_utf8_lossy(&bytes));
        cursor = read["nextCursor"].as_u64().unwrap();
        if text.contains("---END---") || read["session"]["verdict"] == "exited" {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    text
}

struct Fixture {
    _root: tempfile::TempDir,
    engine: Engine,
    workspace_id: String,
    workspace_dir: std::path::PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let workspace_dir = root.path().join("workspace");
        std::fs::create_dir_all(&workspace_dir).unwrap();
        let engine = Engine::open(&root.path().join("data")).unwrap();
        let registered = ok(
            &engine,
            "workspace.register",
            json!({"path": workspace_dir.to_str().unwrap()}),
        );
        let workspace_id = registered["id"].as_str().unwrap().to_string();
        Fixture {
            _root: root,
            engine,
            workspace_id,
            workspace_dir,
        }
    }

    fn set_delegate(&self, delegate: bool) {
        ok(
            &self.engine,
            "graph.write_intent",
            json!({
                "workspaceId": self.workspace_id,
                "intent": {"nodes": [], "policy": {"delegate": delegate}},
            }),
        );
    }

    /// Launches a fresh fixture `claude` session, reads its full startup
    /// snapshot, and stops it -- returns the snapshot text.
    fn launch_and_capture(&self) -> String {
        let launched = ok(
            &self.engine,
            "harness.start",
            json!({
                "workspaceId": self.workspace_id,
                "harnessId": "claude",
                "permissionMode": "inherit",
            }),
        );
        let session_id = launched["id"].as_str().unwrap().to_string();
        let incarnation = launched["incarnation"].as_str().unwrap().to_string();
        let output = read_until_complete(
            &self.engine,
            &session_id,
            &incarnation,
            Duration::from_secs(20),
        );
        assert!(
            output.contains("---END---"),
            "fixture never completed its startup snapshot: {output:?}"
        );
        let stopped = ok(
            &self.engine,
            "session.stop",
            json!({"sessionId": session_id, "incarnation": incarnation}),
        );
        assert_eq!(stopped["verdict"], "exited");
        output
    }
}

/// The core regression proof (fails on unmodified `origin/main`, where
/// context files are always created and a reset leaves stale policy text):
/// with Delegate ON, a freshly launched session's own `AGENTS.md`/`CLAUDE.md`
/// -- read by the harness itself, not merely present on disk -- names the
/// delegate instruction and a real, existing `drogon-cli` verb. With
/// Delegate OFF, a later session removes the managed block and Drogon-created
/// files, leaving the workspace clean.
#[test]
fn delegate_toggle_reaches_the_next_sessions_own_brief() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let bin = tempfile::tempdir().unwrap();
    write_claude_fixture(bin.path());
    let previous_path = prepend_fixture_bin(bin.path());

    let fx = Fixture::new();

    fx.set_delegate(true);
    let with_delegate_on = fx.launch_and_capture();
    assert!(
        with_delegate_on.contains("Delegate: ON"),
        "the harness's own AGENTS.md snapshot must show Delegate ON: {with_delegate_on:?}"
    );
    assert!(
        with_delegate_on.contains(&format!(
            "drogon-cli graph write-intent --workspace {} --file graph-intent.json",
            fx.workspace_id
        )),
        "the delegate instruction must name the real, workspace-scoped write-intent verb: \
         {with_delegate_on:?}"
    );
    fx.set_delegate(false);
    let with_delegate_off = fx.launch_and_capture();
    assert!(
        !with_delegate_off.contains("Subagent Policy"),
        "the default policy must not be injected after the flip: {with_delegate_off:?}"
    );
    assert!(
        !fx.workspace_dir.join("AGENTS.md").exists(),
        "Drogon-created AGENTS.md must be removed when policy returns to default"
    );
    assert!(
        !fx.workspace_dir.join("CLAUDE.md").exists(),
        "Drogon-created CLAUDE.md must be removed when policy returns to default"
    );
    restore_path(previous_path);
}

/// A workspace that never touched the Work Graph feature at all must remain
/// byte-for-byte clean after a session starts: no default policy block and no
/// newly created `AGENTS.md`/`CLAUDE.md`.
#[test]
fn a_workspace_with_no_graph_configured_yet_gets_no_policy_files() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let bin = tempfile::tempdir().unwrap();
    write_claude_fixture(bin.path());
    let previous_path = prepend_fixture_bin(bin.path());

    let fx = Fixture::new();
    let marker = fx.workspace_dir.join("owner-file.txt");
    std::fs::write(&marker, b"owner bytes stay unchanged\n").unwrap();
    let marker_before = std::fs::read(&marker).unwrap();
    let before = std::fs::read_dir(&fx.workspace_dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect::<Vec<_>>();
    assert!(!fx.workspace_dir.join(".drogon").join("graph.json").exists());
    let output = fx.launch_and_capture();
    assert!(!output.contains("Subagent Policy"), "{output:?}");
    assert!(!fx.workspace_dir.join("AGENTS.md").exists());
    assert!(!fx.workspace_dir.join("CLAUDE.md").exists());
    let after = std::fs::read_dir(&fx.workspace_dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect::<Vec<_>>();
    assert_eq!(before, after);
    assert_eq!(std::fs::read(&marker).unwrap(), marker_before);

    restore_path(previous_path);
}

/// A workspace is very often a real project that already has its own
/// `AGENTS.md`: configured policy delivery must never destroy content the
/// owner actually wrote there, and resetting the policy must restore the
/// exact owner bytes.
#[test]
fn a_real_projects_existing_agents_md_content_survives_configure_and_reset() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let bin = tempfile::tempdir().unwrap();
    write_claude_fixture(bin.path());
    let previous_path = prepend_fixture_bin(bin.path());

    let fx = Fixture::new();
    let owner_content = "# Real Project\n\nDo not break the build.\n";
    std::fs::write(fx.workspace_dir.join("AGENTS.md"), owner_content).unwrap();
    fx.set_delegate(true);
    let output = fx.launch_and_capture();
    assert!(
        output.contains("Do not break the build."),
        "the owner's own AGENTS.md content must survive: {output:?}"
    );
    assert!(output.contains("Subagent Policy"), "{output:?}");

    fx.set_delegate(false);
    let reset_output = fx.launch_and_capture();
    assert!(
        !reset_output.contains("Subagent Policy"),
        "{reset_output:?}"
    );
    assert_eq!(
        std::fs::read_to_string(fx.workspace_dir.join("AGENTS.md")).unwrap(),
        owner_content
    );
    assert!(!fx.workspace_dir.join("CLAUDE.md").exists());

    restore_path(previous_path);
}
