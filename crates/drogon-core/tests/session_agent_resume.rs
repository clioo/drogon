//! Session resume BY IDENTITY (owner directive): when a session starts, the
//! harness reports the provider-native conversation it is having (its own
//! hook payload's `session_id`/`transcript_path`); the daemon persists it on
//! the session row, and a reopen names THAT conversation
//! (`claude --resume <id>`) instead of asking the CLI for the most recent one
//! in the working directory. When no identity is known, the launch degrades
//! honestly and the reply says which of the three things happened
//! (`agentResume: resumed | continued | fresh`), so a pane can never present
//! a fresh conversation as a continuation.
//!
//! Unix-only: the harness is a shell fixture on PATH (no real harness, no
//! model inference). The fixture stays alive like a TUI and exits on stdin
//! EOF, so dropping the engine's PTY cannot leave an orphan behind.

#![cfg(unix)]

use std::io::Write as _;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::Mutex;

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

/// Serializes PATH/CLAUDE_CONFIG_DIR mutation across this file's tests (the
/// same pattern `session_restart_record.rs`/`session_env_shim.rs` use: both
/// are process-global, and these tests run inside one process).
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

/// An executable stand-in for the `claude` harness: it echoes every argv
/// entry (so the test can read the resume argv off the record), then stays
/// alive like an interactive TUI until its stdin closes. Reading stdin to EOF
/// is what lets the engine's drop reap it: no orphan child outlives the test.
fn fake_harness_dir(name: &str) -> PathBuf {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(name);
    let mut script = std::fs::File::create(&path).unwrap();
    script
        .write_all(b"#!/bin/sh\nfor arg in \"$@\"; do echo \"ARG:$arg\"; done\nwhile IFS= read -r line; do echo \"you said: $line\"; done\n")
        .unwrap();
    script.sync_all().unwrap();
    drop(script);
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    dir.keep()
}

fn with_env(extra: &[(&str, Option<&std::path::Path>)], run: impl FnOnce()) {
    // A failing assertion in a previous test must not poison the lock for the
    // rest of the file: the guard only serializes process-global env mutation.
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut previous: Vec<(String, Option<std::ffi::OsString>)> = Vec::new();
    for (key, value) in extra {
        previous.push(((*key).to_string(), std::env::var_os(key)));
        match value {
            Some(path) => unsafe { std::env::set_var(key, path) },
            None => unsafe { std::env::remove_var(key) },
        }
    }
    run();
    for (key, value) in previous {
        match value {
            Some(value) => unsafe { std::env::set_var(&key, value) },
            None => unsafe { std::env::remove_var(&key) },
        }
    }
}

fn with_fixture_path(extra: &std::path::Path) -> impl FnOnce() {
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
    move || match previous {
        Some(value) => unsafe { std::env::set_var("PATH", value) },
        None => unsafe { std::env::remove_var("PATH") },
    }
}

fn registered(engine: &Engine, path: &std::path::Path) -> String {
    ok(
        engine,
        &unique("ws"),
        "workspace.register",
        json!({ "path": path.to_string_lossy() }),
    )["id"]
        .as_str()
        .unwrap()
        .to_string()
}

/// Writes a Claude-shaped transcript for `cwd` under `config_root`, the same
/// layout `resume_store` models. Used to put the store into its `Some(true)`
/// state without a real Claude Code install.
fn write_transcript(config_root: &std::path::Path, cwd: &std::path::Path, id: &str) {
    let project = config_root
        .join("projects")
        .join(drogon_harness::claude_project_dir_name(cwd));
    std::fs::create_dir_all(&project).unwrap();
    std::fs::write(project.join(format!("{id}.jsonl")), "{}\n").unwrap();
}

#[test]
fn the_reported_provider_session_id_survives_a_daemon_restart_and_names_the_resume() {
    let fixture_dir = fake_harness_dir("claude");
    let config_root = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    with_env(
        &[
            ("PATH", Some(fixture_dir.as_path())),
            ("CLAUDE_CONFIG_DIR", Some(config_root.path())),
        ],
        || {
            let restore_path = with_fixture_path(&fixture_dir);
            // Two Engine instances over ONE data dir = the daemon restart.
            let data_dir = tempfile::tempdir().unwrap();
            let provider_id = "9f8d1c2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
            // The transcript the harness's hook reported: a REAL file that
            // survives the restart (the verified-locator contract -- a
            // resume whose transcript is gone degrades to fresh).
            let transcript_root = tempfile::tempdir().unwrap();
            let transcript = transcript_root.path().join(format!("{provider_id}.jsonl"));
            std::fs::write(&transcript, "{}\n").unwrap();
            let transcript = transcript.to_string_lossy().to_string();
            let (workspace_id, session_id, incarnation) = {
                let engine = Engine::open(data_dir.path()).unwrap();
                let workspace_id = registered(&engine, project.path());
                let launched = ok(
                    &engine,
                    &unique("harness-start"),
                    "harness.start",
                    json!({
                        "workspaceId": workspace_id,
                        "harnessId": "claude",
                        "permissionMode": "inherit",
                    }),
                );
                assert_eq!(launched["agentResume"], "fresh");
                assert_eq!(launched["agentSessionId"], Value::Null);
                // The harness's own SessionStart hook payload names the
                // conversation. Nothing is inferred from the filesystem.
                let event = ok(
                    &engine,
                    &unique("hook"),
                    "session.hook_event",
                    json!({
                        "sessionId": launched["id"],
                        "incarnation": launched["incarnation"],
                        "event": "SessionStart",
                        "agentSessionId": provider_id,
                        "agentSessionTranscriptPath": transcript,
                    }),
                );
                assert_eq!(event["agentSessionId"], provider_id);
                // Claude's SessionStart is the session boundary, not a turn
                // start: a freshly opened session stays idle (no phantom
                // spinner), exactly as the reference maps SessionStart.
                assert_eq!(event["agentState"], "idle");
                let row = record_of(&engine, launched["id"].as_str().unwrap());
                assert_eq!(row["agentSessionId"], provider_id);
                assert_eq!(row["agentSessionTranscriptPath"], transcript);
                (
                    workspace_id,
                    launched["id"].as_str().unwrap().to_string(),
                    launched["incarnation"].as_str().unwrap().to_string(),
                )
                // `engine` drops here: the PTY master closes, the fixture's
                // stdin reaches EOF and it exits. The durable row stays
                // `live` until the next instance sweeps it
                // (`recover_from_prior_instance`), which is exactly the
                // post-restart state this test asserts on.
            };

            let engine = Engine::open(data_dir.path()).unwrap();
            let recovered = record_of(&engine, &session_id);
            assert_eq!(
                recovered["verdict"], "unverifiable",
                "a row no instance holds a child for is unverifiable, never exited"
            );
            assert_eq!(recovered["incarnation"], incarnation);
            assert_eq!(
                recovered["agentSessionId"], provider_id,
                "the provider conversation identity is durable"
            );
            assert_eq!(recovered["agentSessionTranscriptPath"], transcript);

            // Reopen by identity: `resumeSessionId` names the recovered row,
            // whose recorded provider id the planner turns into the harness's
            // own resume argv.
            let resumed = ok(
                &engine,
                &unique("resume"),
                "harness.start",
                json!({
                    "workspaceId": workspace_id,
                    "harnessId": "claude",
                    "permissionMode": "inherit",
                    "resume": true,
                    "resumeSessionId": session_id,
                }),
            );
            assert_eq!(resumed["agentResume"], "resumed");
            assert_eq!(
                resumed["agentSessionId"],
                Value::Null,
                "the new row's own identity is not inherited"
            );
            let args: Vec<String> = resumed["args"]
                .as_array()
                .unwrap()
                .iter()
                .map(|arg| arg.as_str().unwrap().to_string())
                .collect();
            let index = args
                .iter()
                .position(|arg| arg == "--resume")
                .unwrap_or_else(|| panic!("expected --resume in argv: {args:?}"));
            assert_eq!(
                args[index + 1],
                provider_id,
                "the reopen must name the SAME conversation, never the most recent one"
            );

            let stopped = ok(
                &engine,
                &unique("stop"),
                "session.stop",
                json!({
                    "sessionId": resumed["id"],
                    "incarnation": resumed["incarnation"],
                }),
            );
            assert_eq!(stopped["verdict"], "exited");
            restore_path();
        },
    );
}

#[test]
fn an_unusable_locator_is_dropped_and_the_resume_degrades_honestly() {
    let fixture_dir = fake_harness_dir("claude");
    let config_root = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    with_env(
        &[
            ("PATH", Some(fixture_dir.as_path())),
            ("CLAUDE_CONFIG_DIR", Some(config_root.path())),
        ],
        || {
            let restore_path = with_fixture_path(&fixture_dir);
            let data_dir = tempfile::tempdir().unwrap();
            let engine = Engine::open(data_dir.path()).unwrap();
            let workspace_id = registered(&engine, project.path());
            let launched = ok(
                &engine,
                &unique("harness-start"),
                "harness.start",
                json!({
                    "workspaceId": workspace_id,
                    "harnessId": "claude",
                    "permissionMode": "inherit",
                }),
            );
            // A hostile locator never becomes argv and is never persisted.
            let event = ok(
                &engine,
                &unique("hook"),
                "session.hook_event",
                json!({
                    "sessionId": launched["id"],
                    "incarnation": launched["incarnation"],
                    "event": "UserPromptSubmit",
                    "agentSessionId": "--dangerously-skip-permissions",
                }),
            );
            assert_eq!(event["agentSessionId"], Value::Null);

            // No recorded identity and no conversation in the harness's own
            // store: `--continue` would refuse to start, so the daemon
            // declines the resume and says so.
            let declined = ok(
                &engine,
                &unique("resume"),
                "harness.start",
                json!({
                    "workspaceId": workspace_id,
                    "harnessId": "claude",
                    "permissionMode": "inherit",
                    "resume": true,
                    "resumeSessionId": launched["id"],
                }),
            );
            assert_eq!(
                declined["agentResume"], "fresh",
                "a declined resume must be reported as a fresh start"
            );
            assert!(
                !declined["args"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|arg| arg == "--continue"),
                "a declined resume must not carry a continue flag"
            );

            // With a conversation in the harness's own store but no reported
            // identity, the CLI's own most-recent entrypoint is the best
            // available answer -- and the reply says `continued`, never
            // `resumed`.
            // The registered workspace path is the canonical one (macOS temp
            // dirs are symlinked), and the store layout is derived from the
            // session's real cwd.
            let cwd = std::fs::canonicalize(project.path()).unwrap();
            write_transcript(config_root.path(), &cwd, "prior-conversation");
            let continued = ok(
                &engine,
                &unique("resume"),
                "harness.start",
                json!({
                    "workspaceId": workspace_id,
                    "harnessId": "claude",
                    "permissionMode": "inherit",
                    "resume": true,
                    "resumeSessionId": launched["id"],
                }),
            );
            assert_eq!(continued["agentResume"], "continued");
            assert!(
                continued["args"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|arg| arg == "--continue"),
                "the degraded resume keeps the harness's own continue flag"
            );

            for row in listed(&engine) {
                ok(
                    &engine,
                    &unique("stop"),
                    "session.stop",
                    json!({"sessionId": row["id"], "incarnation": row["incarnation"]}),
                );
            }
            restore_path();
        },
    );
}

#[test]
fn a_resume_naming_an_unknown_session_starts_fresh_without_pretending() {
    let fixture_dir = fake_harness_dir("claude");
    let config_root = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    with_env(
        &[
            ("PATH", Some(fixture_dir.as_path())),
            ("CLAUDE_CONFIG_DIR", Some(config_root.path())),
        ],
        || {
            let restore_path = with_fixture_path(&fixture_dir);
            let data_dir = tempfile::tempdir().unwrap();
            let engine = Engine::open(data_dir.path()).unwrap();
            let workspace_id = registered(&engine, project.path());
            let resumed = ok(
                &engine,
                &unique("resume"),
                "harness.start",
                json!({
                    "workspaceId": workspace_id,
                    "harnessId": "claude",
                    "permissionMode": "inherit",
                    "resume": true,
                    "resumeSessionId": "00000000-0000-4000-8000-000000000000",
                }),
            );
            assert_eq!(resumed["agentResume"], "fresh");
            for row in listed(&engine) {
                ok(
                    &engine,
                    &unique("stop"),
                    "session.stop",
                    json!({"sessionId": row["id"], "incarnation": row["incarnation"]}),
                );
            }
            restore_path();
        },
    );
}

/// The identity columns are an ADDITIVE main-schema migration (the `sessions`
/// table has no version row of its own; `db.rs` detects the missing columns
/// structurally). An existing data dir must gain them, and a row written
/// before the migration must still be listed.
#[test]
fn an_older_data_dir_gains_the_agent_session_columns() {
    let data_dir = tempfile::tempdir().unwrap();
    {
        let _engine = Engine::open(data_dir.path()).unwrap();
    }
    let db_path = data_dir.path().join(drogon_core::DB_FILE_NAME);
    {
        // Simulate a data dir written by a build that predates the columns.
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        for column in ["agent_session_id", "agent_session_transcript_path"] {
            conn.execute_batch(&format!("ALTER TABLE sessions DROP COLUMN {column};"))
                .unwrap();
        }
        conn.execute(
            "INSERT INTO sessions (id, workspace_id, host_id, incarnation, command, args_json, cols, rows, verdict, created_at) \
             VALUES ('legacy-1', 'ws-1', 'host-1', 'inc-1', '/bin/sh', '[]', 80, 24, 'unverifiable', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
    }
    let engine = Engine::open(data_dir.path()).unwrap();
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    for column in ["agent_session_id", "agent_session_transcript_path"] {
        let present: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = ?1",
                [column],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(present, 1, "{column} must be migrated in");
    }
    let listed = listed(&engine);
    let legacy = listed
        .iter()
        .find(|row| row["id"] == "legacy-1")
        .expect("a pre-migration row must still be listed");
    assert_eq!(legacy["verdict"], "unverifiable");
    assert_eq!(legacy["agentSessionId"], Value::Null);
    assert_eq!(legacy["agentSessionTranscriptPath"], Value::Null);
}

/// Adversarial-report regression ("SESSION RESTORED" when nothing was
/// restored): the session row latches a provider conversation whose
/// transcript has since been deleted from the harness's store. The real CLI
/// answers `--resume <stale-id>` with "No conversation found with session
/// ID: <id>" and exit 1 -- it does NOT silently start a new conversation.
///
/// The daemon persists `agent_session_transcript_path`, so it can verify
/// the locator BEFORE claiming a restoration: a locator whose transcript is
/// gone must degrade to a fresh start and say `agentResume: "fresh"`,
/// never `"resumed"`. This FAILS on unmodified main, which reports
/// `resumed` from the argv it built and leaves the pane's restored banner
/// standing above the harness's own refusal.
#[test]
fn a_resume_naming_a_deleted_transcript_degrades_to_fresh_instead_of_claiming_restoration() {
    let fixture_dir = fake_harness_dir("claude");
    let config_root = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let transcript_root = tempfile::tempdir().unwrap();
    with_env(
        &[
            ("PATH", Some(fixture_dir.as_path())),
            ("CLAUDE_CONFIG_DIR", Some(config_root.path())),
        ],
        || {
            let restore_path = with_fixture_path(&fixture_dir);
            let data_dir = tempfile::tempdir().unwrap();
            let provider_id = "9f8d1c2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
            let transcript = transcript_root.path().join(format!("{provider_id}.jsonl"));
            std::fs::write(&transcript, "{}\n").unwrap();
            let transcript_str = transcript.to_string_lossy().to_string();
            let (workspace_id, session_id, _incarnation) = {
                let engine = Engine::open(data_dir.path()).unwrap();
                let workspace_id = registered(&engine, project.path());
                let launched = ok(
                    &engine,
                    &unique("harness-start"),
                    "harness.start",
                    json!({
                        "workspaceId": workspace_id,
                        "harnessId": "claude",
                        "permissionMode": "inherit",
                    }),
                );
                // The harness's own hook payload records the conversation
                // AND the transcript the daemon can later verify against.
                ok(
                    &engine,
                    &unique("hook"),
                    "session.hook_event",
                    json!({
                        "sessionId": launched["id"],
                        "incarnation": launched["incarnation"],
                        "event": "SessionStart",
                        "agentSessionId": provider_id,
                        "agentSessionTranscriptPath": transcript_str,
                    }),
                );
                (
                    workspace_id,
                    launched["id"].as_str().unwrap().to_string(),
                    launched["incarnation"].as_str().unwrap().to_string(),
                )
            };

            // The daemon restarts over the same data dir (the row's verdict
            // becomes unverifiable), and the transcript is deleted
            // underneath: the recorded conversation is gone.
            std::fs::remove_file(&transcript).unwrap();
            let engine = Engine::open(data_dir.path()).unwrap();
            let recovered = record_of(&engine, &session_id);
            assert_eq!(recovered["verdict"], "unverifiable");
            assert_eq!(recovered["agentSessionId"], provider_id);

            let resumed = ok(
                &engine,
                &unique("resume"),
                "harness.start",
                json!({
                    "workspaceId": workspace_id,
                    "harnessId": "claude",
                    "permissionMode": "inherit",
                    "resume": true,
                    "resumeSessionId": session_id,
                }),
            );
            assert_eq!(
                resumed["agentResume"], "fresh",
                "a locator whose transcript is gone must be reported as a \
                 fresh start, never as a restoration: {resumed:?}"
            );
            assert!(
                !resumed["args"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|arg| arg == "--resume"),
                "a declined resume must not carry a resume flag the CLI \
                 would refuse: {resumed:?}"
            );
            for row in listed(&engine) {
                ok(
                    &engine,
                    &unique("stop"),
                    "session.stop",
                    json!({"sessionId": row["id"], "incarnation": row["incarnation"]}),
                );
            }
            restore_path();
        },
    );
}

/// The verified-locator counterpart: when the persisted transcript still
/// exists on disk, the resume is the real thing and keeps reporting
/// `resumed` (the pane's restored banner stays truthful).
#[test]
fn a_resume_whose_transcript_still_exists_keeps_the_verified_restored_claim() {
    let fixture_dir = fake_harness_dir("claude");
    let config_root = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let transcript_root = tempfile::tempdir().unwrap();
    with_env(
        &[
            ("PATH", Some(fixture_dir.as_path())),
            ("CLAUDE_CONFIG_DIR", Some(config_root.path())),
        ],
        || {
            let restore_path = with_fixture_path(&fixture_dir);
            let data_dir = tempfile::tempdir().unwrap();
            let provider_id = "9f8d1c2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
            let transcript = transcript_root.path().join(format!("{provider_id}.jsonl"));
            std::fs::write(&transcript, "{}\n").unwrap();
            let transcript_str = transcript.to_string_lossy().to_string();
            let (workspace_id, session_id, _incarnation) = {
                let engine = Engine::open(data_dir.path()).unwrap();
                let workspace_id = registered(&engine, project.path());
                let launched = ok(
                    &engine,
                    &unique("harness-start"),
                    "harness.start",
                    json!({
                        "workspaceId": workspace_id,
                        "harnessId": "claude",
                        "permissionMode": "inherit",
                    }),
                );
                ok(
                    &engine,
                    &unique("hook"),
                    "session.hook_event",
                    json!({
                        "sessionId": launched["id"],
                        "incarnation": launched["incarnation"],
                        "event": "SessionStart",
                        "agentSessionId": provider_id,
                        "agentSessionTranscriptPath": transcript_str,
                    }),
                );
                (
                    workspace_id,
                    launched["id"].as_str().unwrap().to_string(),
                    launched["incarnation"].as_str().unwrap().to_string(),
                )
            };
            let engine = Engine::open(data_dir.path()).unwrap();
            let resumed = ok(
                &engine,
                &unique("resume"),
                "harness.start",
                json!({
                    "workspaceId": workspace_id,
                    "harnessId": "claude",
                    "permissionMode": "inherit",
                    "resume": true,
                    "resumeSessionId": session_id,
                }),
            );
            assert_eq!(
                resumed["agentResume"], "resumed",
                "a locator whose transcript is verifiably present is a real \
                 restoration: {resumed:?}"
            );
            assert!(
                resumed["args"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|arg| arg == "--resume"),
                "the verified resume must name the conversation: {resumed:?}"
            );
            for row in listed(&engine) {
                ok(
                    &engine,
                    &unique("stop"),
                    "session.stop",
                    json!({"sessionId": row["id"], "incarnation": row["incarnation"]}),
                );
            }
            restore_path();
        },
    );
}

/// An id-only locator (a row whose transcript path was never persisted) has
/// nothing the daemon can verify, so the launch keeps the harness's own
/// resume argv but must NOT claim a restoration up front: `agentResume` is
/// reported as `resume-unverified`, which the pane renders as NO banner
/// (the harness's own output is the only honest confirmation left). This
/// FAILS on unmodified main, which reports `resumed` for the same launch.
#[test]
fn an_id_only_locator_is_reported_unverified_not_restored() {
    let fixture_dir = fake_harness_dir("claude");
    let config_root = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    with_env(
        &[
            ("PATH", Some(fixture_dir.as_path())),
            ("CLAUDE_CONFIG_DIR", Some(config_root.path())),
        ],
        || {
            let restore_path = with_fixture_path(&fixture_dir);
            let data_dir = tempfile::tempdir().unwrap();
            let provider_id = "9f8d1c2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
            let (workspace_id, session_id, _incarnation) = {
                let engine = Engine::open(data_dir.path()).unwrap();
                let workspace_id = registered(&engine, project.path());
                let launched = ok(
                    &engine,
                    &unique("harness-start"),
                    "harness.start",
                    json!({
                        "workspaceId": workspace_id,
                        "harnessId": "claude",
                        "permissionMode": "inherit",
                    }),
                );
                // Only the id is reported; no transcript path is persisted.
                ok(
                    &engine,
                    &unique("hook"),
                    "session.hook_event",
                    json!({
                        "sessionId": launched["id"],
                        "incarnation": launched["incarnation"],
                        "event": "SessionStart",
                        "agentSessionId": provider_id,
                    }),
                );
                (
                    workspace_id,
                    launched["id"].as_str().unwrap().to_string(),
                    launched["incarnation"].as_str().unwrap().to_string(),
                )
            };
            let engine = Engine::open(data_dir.path()).unwrap();
            let resumed = ok(
                &engine,
                &unique("resume"),
                "harness.start",
                json!({
                    "workspaceId": workspace_id,
                    "harnessId": "claude",
                    "permissionMode": "inherit",
                    "resume": true,
                    "resumeSessionId": session_id,
                }),
            );
            assert_eq!(
                resumed["agentResume"], "resume-unverified",
                "an id-only locator cannot be verified before launch and must \
                 not be claimed as restored: {resumed:?}"
            );
            assert!(
                resumed["args"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|arg| arg == "--resume"),
                "the harness's own resume argv stays; the harness is the \
                 authority on whether the conversation exists: {resumed:?}"
            );
            for row in listed(&engine) {
                ok(
                    &engine,
                    &unique("stop"),
                    "session.stop",
                    json!({"sessionId": row["id"], "incarnation": row["incarnation"]}),
                );
            }
            restore_path();
        },
    );
}
