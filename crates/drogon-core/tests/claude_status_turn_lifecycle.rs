//! Claude session status must be hook-driven, never keystroke-driven (bug:
//! typing `wadasdasdda` at an idle Claude prompt flipped the project card to
//! "working"). The Orca reference derives
//! the sidebar status purely from harness hooks — `UserPromptSubmit` /
//! `PreToolUse` / `PostToolUse` mean working, `Stop` means done,
//! `PermissionRequest` means waiting, `SessionStart` lands an idle boundary —
//! so local echo at the prompt can never spin the row. These tests drive the
//! real PTY path against a fixture `claude` that echoes its stdin exactly
//! like a TUI repainting the composer on every keystroke: the echo is the
//! output the old activity clock misread as harness activity.
//!
//! Unix-only, like `agent_state_hook_events.rs`. No model inference: hooks
//! are driven through the same `session.hook_event` RPC the hidden
//! `drogon-cli internal hook-event` subcommand calls.

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

/// Installs the echoing `claude` fixture under the test's own directory and
/// points the product's `agentCmdOverrides` at its absolute path, so
/// `harness.start` resolves the fixture through the settings override
/// without touching process-global PATH at all. The earlier per-test PATH
/// install/restore raced between parallel tests on ubuntu CI (a restore
/// wiped another test's fixture mid-launch: not_found "Harness is not
/// installed on this execution host"), and even a once-only install still
/// races `set_var` against sibling tests' PATH reads — the override has no
/// env interaction, so the suite is hermetic under any scheduling.
/// `hooks_enabled: false` is the launch-time-disabled variant (the file
/// then carries no managed hook commands and no `--settings` argv).
fn install_echoing_claude_fixture(dir: &tempfile::TempDir, hooks_enabled: bool) {
    let bin = dir.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let script = bin.join("claude");
    std::fs::write(&script, "#!/bin/sh\ncat\n").unwrap();
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
                "agentCmdOverrides": {
                    "claude": script.to_string_lossy(),
                },
                "agentDefaultArgs": {},
                "agentDefaultEnv": {},
                "agentStatusHooksEnabled": hooks_enabled,
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
    let ws = ok(engine, "workspace.register", json!({ "path": path }));
    ws["id"].as_str().unwrap().to_string()
}

fn launch_claude(engine: &Engine, workspace_id: &str) -> Value {
    ok(
        engine,
        "harness.start",
        json!({ "workspaceId": workspace_id, "harnessId": "claude", "permissionMode": "inherit" }),
    )
}

fn listed_state(engine: &Engine, session_id: &str) -> String {
    listed_row(engine, session_id)["agentState"]
        .as_str()
        .unwrap()
        .to_string()
}

fn listed_row(engine: &Engine, session_id: &str) -> Value {
    let listed = ok(engine, "session.list", json!({}));
    listed["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == session_id)
        .unwrap_or_else(|| panic!("session {session_id} must be listed"))
        .clone()
}

fn hook_event(engine: &Engine, session_id: &str, incarnation: &str, event: &str) -> Value {
    ok(
        engine,
        "session.hook_event",
        json!({ "sessionId": session_id, "incarnation": incarnation, "event": event }),
    )
}

/// Writes `text` to the session PTY and waits until its echo is observed in
/// the output ring, so every state assertion below happens strictly AFTER
/// the keystroke-driven output the derivation must ignore.
fn write_and_wait_for_echo(engine: &Engine, session: &Value, text: &str) {
    let session_id = session["id"].as_str().unwrap();
    let incarnation = session["incarnation"].as_str().unwrap();
    ok(
        engine,
        "session.write",
        json!({
            "sessionId": session_id,
            "incarnation": incarnation,
            "dataBase64": base64_of(text),
        }),
    );
    let needle = text.trim();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut cursor = 0u64;
    while Instant::now() < deadline {
        let read = ok(
            engine,
            "session.read",
            json!({ "sessionId": session_id, "incarnation": incarnation, "cursor": cursor }),
        );
        cursor = read["nextCursor"].as_u64().unwrap();
        let bytes = base64_decode(read["dataBase64"].as_str().unwrap());
        if String::from_utf8_lossy(&bytes).contains(needle) {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("expected the keystroke echo {needle:?} to arrive as PTY output");
}

/// THE bug: typing at a fresh idle Claude prompt produced PTY echo, the
/// activity clock read it as harness output, and the card span "working -
/// just now" while nothing ran. Keystroke echo must leave the session idle.
#[test]
fn typing_at_a_fresh_claude_session_never_reads_working() {
    let dir = tempfile::tempdir().unwrap();
    install_echoing_claude_fixture(&dir, true);
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let session = launch_claude(&engine, &workspace_id);
    let session_id = session["id"].as_str().unwrap().to_string();

    write_and_wait_for_echo(&engine, &session, "wadasdasdda");

    assert_eq!(
        listed_state(&engine, &session_id),
        "idle",
        "local keystrokes at the composer must never flip the session to working"
    );
}

/// The full hook lifecycle on the claude install surface: a submitted turn
/// reads working (through output silence far past the activity window),
/// Stop concludes it to idle, later keystroke echo cannot resurrect it,
/// Notification parks it on needs_input, and a resumption clears the wait.
#[test]
fn claude_turn_lifecycle_reads_working_only_for_real_turns() {
    let dir = tempfile::tempdir().unwrap();
    install_echoing_claude_fixture(&dir, true);
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let session = launch_claude(&engine, &workspace_id);
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();

    // Launch lands on the idle session boundary (the reference maps
    // SessionStart to done): an idle TUI is idle before the first prompt.
    assert_eq!(
        listed_state(&engine, &session_id),
        "idle",
        "a freshly launched claude session is idle, not unknown/working"
    );

    // The user submits a prompt: the turn opens and reads working.
    let working = hook_event(&engine, &session_id, &incarnation, "UserPromptSubmit");
    assert_eq!(working["agentState"], "working");

    // Silent thinking far past the 3s activity window must not drop the
    // hook-reported turn to idle mid-turn.
    std::thread::sleep(Duration::from_millis(3300));
    assert_eq!(
        listed_state(&engine, &session_id),
        "working",
        "a hook-reported turn stays working through output silence"
    );

    // Tool lifecycle hooks keep the turn authoritative too.
    let tooling = hook_event(&engine, &session_id, &incarnation, "PostToolUse");
    assert_eq!(tooling["agentState"], "working");

    // The turn ends: Stop concludes it to idle on the harness's authority.
    let stopped = hook_event(&engine, &session_id, &incarnation, "Stop");
    assert_eq!(stopped["agentState"], "idle");

    // And typing at the now-idle prompt can never spin it back up — the
    // exact regression from the bug report, on the post-turn side.
    write_and_wait_for_echo(&engine, &session, "typing again after the turn\n");
    assert_eq!(
        listed_state(&engine, &session_id),
        "idle",
        "keystroke echo at the idle prompt must not resurrect working"
    );

    // Notification parks the session on a genuine wait; the next submit
    // resumes the turn and clears it.
    let waiting = hook_event(&engine, &session_id, &incarnation, "Notification");
    assert_eq!(waiting["agentState"], "needs_input");
    let resumed = hook_event(&engine, &session_id, &incarnation, "UserPromptSubmit");
    assert_eq!(resumed["agentState"], "working");
    let done = hook_event(&engine, &session_id, &incarnation, "Stop");
    assert_eq!(done["agentState"], "idle");
}

/// The per-session settings file must install the reference's claude turn
/// lifecycle, not only the wait/stop pair: PreToolUse/PostToolUse carry the
/// running turn (and clear a wait after a permission approval, which no
/// generic output clear may do anymore), PermissionRequest is the immediate
/// wait surface.
#[test]
fn settings_file_installs_the_full_claude_turn_lifecycle() {
    let dir = tempfile::tempdir().unwrap();
    install_echoing_claude_fixture(&dir, true);
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let session = launch_claude(&engine, &workspace_id);
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();
    let args = session["args"].as_array().unwrap();
    let settings_pos = args
        .iter()
        .position(|arg| arg == "--settings")
        .expect("claude launches must carry --settings");
    let settings: Value = serde_json::from_str(
        &std::fs::read_to_string(args[settings_pos + 1].as_str().unwrap()).unwrap(),
    )
    .unwrap();

    for event in [
        // `SessionStart` is installed so the harness's own payload can report
        // the provider conversation at the session boundary (resume by
        // identity), even for a session closed before its first turn.
        "SessionStart",
        "UserPromptSubmit",
        "Notification",
        "Stop",
        "PreToolUse",
        "PostToolUse",
        "PermissionRequest",
    ] {
        let entries = settings["hooks"][event]
            .as_array()
            .unwrap_or_else(|| panic!("hooks.{event} must be installed"));
        assert_eq!(entries.len(), 1, "one entry per event");
        let command = entries[0]["hooks"][0]["command"].as_str().unwrap();
        assert!(command.contains("internal hook-event"), "{command}");
        assert!(command.contains(&format!("--event {event}")), "{command}");
        assert!(
            command.contains(&format!("--session {session_id}")),
            "{command}"
        );
        assert!(
            command.contains(&format!("--incarnation {incarnation}")),
            "{command}"
        );
    }
}

/// When the user disables agent status hooks entirely there is no hook
/// truth, so the claude session honestly falls back to the activity clock
/// (keystroke echo reads working there — the documented hook-less policy,
/// same as plain terminals), and the settings file carries no managed
/// commands.
#[test]
fn hooks_disabled_claude_keeps_the_activity_policy() {
    let dir = tempfile::tempdir().unwrap();
    install_echoing_claude_fixture(&dir, false);
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let session = launch_claude(&engine, &workspace_id);

    // Launch-time disabled hooks install nothing: no --settings argv at all
    // (runtime toggles neuter the file instead — see set_status_hooks_enabled).
    assert!(
        !session["args"]
            .as_array()
            .unwrap()
            .iter()
            .any(|arg| arg == "--settings"),
        "launch-time disabled status hooks must not wire claude settings"
    );

    write_and_wait_for_echo(&engine, &session, "typed with hooks disabled\n");
    assert_eq!(
        listed_state(&engine, session["id"].as_str().unwrap()),
        "working",
        "hook-less sessions keep the activity-clock policy"
    );
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

fn set_status_hooks(engine: &Engine, enabled: bool) {
    ok(
        engine,
        "agent.settings_update",
        json!({ "updates": { "agentStatusHooksEnabled": enabled } }),
    );
}

/// Adversarial F1: disabling status hooks mid-turn must drop the hook
/// lifecycle wholesale — a turn that was hook-reported `working` falls
/// back to the activity clock (here: `unknown`, no output ever) instead of
/// stranding `working` with no hook able to conclude it.
#[test]
fn disabling_status_hooks_mid_turn_drops_the_hook_lifecycle() {
    let dir = tempfile::tempdir().unwrap();
    install_echoing_claude_fixture(&dir, true);
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let session = launch_claude(&engine, &workspace_id);
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();

    hook_event(&engine, &session_id, &incarnation, "UserPromptSubmit");
    assert_eq!(listed_state(&engine, &session_id), "working");

    set_status_hooks(&engine, false);
    let state = listed_state(&engine, &session_id);
    assert_ne!(
        state, "working",
        "a disabled lifecycle must never keep reading working"
    );

    // A late in-flight turn-start while disabled must not reopen it either.
    hook_event(&engine, &session_id, &incarnation, "UserPromptSubmit");
    assert_ne!(
        listed_state(&engine, &session_id),
        "working",
        "hook events while disabled must not manufacture a turn"
    );
}

/// Round-2 RACE-1/RACE-2: a Stop that arrives while status hooks are
/// globally disabled must be SPENT, never concluded — concluding it
/// durably parked ENDED hook authority over the live session, which hid
/// later typing as `idle` and survived re-enable against the
/// re-observation promise. The disabled row is pure activity clock; the
/// re-enable resets unconditionally, so typing reads `working` again
/// until the next real hook event re-establishes authority.
#[test]
fn stop_while_disabled_is_spent_and_reenable_reobserves() {
    let dir = tempfile::tempdir().unwrap();
    install_echoing_claude_fixture(&dir, true);
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let session = launch_claude(&engine, &workspace_id);
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();

    set_status_hooks(&engine, false);
    hook_event(&engine, &session_id, &incarnation, "Stop");
    assert_eq!(
        listed_state(&engine, &session_id),
        "unknown",
        "a spent Stop must deposit no authority: the activity clock owns the row"
    );

    // RACE-1's exact repro: typing while still disabled follows the
    // activity clock — the spent Stop must not hide it as idle.
    write_and_wait_for_echo(&engine, &session, "typed while disabled\n");
    assert_eq!(listed_state(&engine, &session_id), "working");

    set_status_hooks(&engine, true);
    write_and_wait_for_echo(&engine, &session, "typed after re-enable\n");
    assert_eq!(
        listed_state(&engine, &session_id),
        "working",
        "typing after the disabled window must not be hidden as idle"
    );

    // The next real hook event re-establishes full authority.
    hook_event(&engine, &session_id, &incarnation, "UserPromptSubmit");
    assert_eq!(listed_state(&engine, &session_id), "working");
    hook_event(&engine, &session_id, &incarnation, "Stop");
    assert_eq!(listed_state(&engine, &session_id), "idle");
}

/// Adversarial F3: re-enabling status hooks after a mid-turn disable
/// forces re-observation — the stranded state does not survive, and the
/// next real hook event re-establishes authority.
#[test]
fn disable_then_reenable_forces_reobservation() {
    let dir = tempfile::tempdir().unwrap();
    install_echoing_claude_fixture(&dir, true);
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let session = launch_claude(&engine, &workspace_id);
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();

    hook_event(&engine, &session_id, &incarnation, "UserPromptSubmit");
    assert_eq!(listed_state(&engine, &session_id), "working");
    set_status_hooks(&engine, false);
    assert_ne!(listed_state(&engine, &session_id), "working");

    set_status_hooks(&engine, true);
    assert_ne!(
        listed_state(&engine, &session_id),
        "working",
        "re-enabling must reset the lifecycle, not resurrect the stale turn"
    );

    // The next real hook event re-establishes the hook authority.
    hook_event(&engine, &session_id, &incarnation, "UserPromptSubmit");
    assert_eq!(
        listed_state(&engine, &session_id),
        "working",
        "after re-enable, real hook events drive the state again"
    );
}

/// Adversarial F4: the hook turn fact is durable — a daemon restart
/// re-reports a turn that was hook-reported `working` as `working` with
/// its original stamp, instead of hiding it as `unknown`. Loss of contact
/// never proves exit, and nobody observed the turn concluding.
#[test]
fn restart_keeps_a_hook_reported_turn_working() {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().to_path_buf();
    install_echoing_claude_fixture(&dir, true);
    let engine = Engine::open(&data_dir).unwrap();
    let workspace_id = register_workspace(&engine);
    let session = launch_claude(&engine, &workspace_id);
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();
    hook_event(&engine, &session_id, &incarnation, "UserPromptSubmit");
    assert_eq!(listed_state(&engine, &session_id), "working");
    drop(engine);

    let reopened = Engine::open(&data_dir).unwrap();
    let listed = ok(&reopened, "session.list", json!({}));
    let row = listed["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == session_id)
        .expect("session must survive the restart");
    assert_eq!(
        row["agentState"], "working",
        "a hook-reported turn must survive a restart as working"
    );
    assert!(
        row["agentStateAt"]
            .as_str()
            .is_some_and(|at| !at.is_empty()),
        "the restored working state must carry its original stamp"
    );
}

/// Adversarial F5: a foreign harness's hook name arriving over the socket
/// must be refused, never mapped — an injected pi `AgentStart` on an idle
/// claude session used to manufacture a phantom `working`.
#[test]
fn foreign_harness_event_names_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    install_echoing_claude_fixture(&dir, true);
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let session = launch_claude(&engine, &workspace_id);
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();

    for foreign in [
        "AgentStart",
        "AgentEnd",
        "SessionIdle",
        "NewTurn",
        "ToolApprovalRequested",
        "SubagentStart",
    ] {
        assert_eq!(
            err_code(
                &engine,
                "session.hook_event",
                json!({ "sessionId": session_id, "incarnation": incarnation, "event": foreign }),
            ),
            "invalid_argument",
            "foreign event {foreign} must be refused for a claude session"
        );
    }
    assert_eq!(
        listed_state(&engine, &session_id),
        "idle",
        "refused foreign events must not move the row"
    );
}

/// `SessionStart` used to be foreign for claude (codex owns it as a turn
/// start). It is now claude's own name too: the workspace-session-resume work
/// installs it so the harness's own hook payload can report the provider
/// conversation at the session boundary, even for a session closed before its
/// first turn. Claude's SessionStart is the idle session boundary (the
/// reference maps it to a done row), NOT a turn start -- a freshly launched
/// session must never show a phantom spinner.
#[test]
fn claude_session_start_reports_the_conversation_and_stays_idle() {
    let dir = tempfile::tempdir().unwrap();
    install_echoing_claude_fixture(&dir, true);
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let session = launch_claude(&engine, &workspace_id);
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();

    let started = ok(
        &engine,
        "session.hook_event",
        json!({
            "sessionId": session_id,
            "incarnation": incarnation,
            "event": "SessionStart",
            "agentSessionId": "11111111-2222-3333-4444-555555555555",
            "agentSessionTranscriptPath": "/tmp/11111111.jsonl",
        }),
    );
    assert_eq!(started["agentState"], "idle");
    assert_eq!(
        started["agentSessionId"],
        "11111111-2222-3333-4444-555555555555"
    );
    assert_eq!(started["agentSessionTranscriptPath"], "/tmp/11111111.jsonl");
    // The identity is durable on the row, not just in the reply.
    let row = listed_row(&engine, &session_id);
    assert_eq!(
        row["agentSessionId"],
        "11111111-2222-3333-4444-555555555555"
    );
}

/// A hook-reported locator is untrusted input to a future child's argv:
/// anything that could be read as a flag or smuggle control characters is
/// dropped, never persisted and never passed on.
#[test]
fn a_hostile_hook_locator_is_never_recorded() {
    let dir = tempfile::tempdir().unwrap();
    install_echoing_claude_fixture(&dir, true);
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine);
    let session = launch_claude(&engine, &workspace_id);
    let session_id = session["id"].as_str().unwrap().to_string();

    for hostile in ["--dangerously-skip-permissions", "bad\nid", ""] {
        let updated = ok(
            &engine,
            "session.hook_event",
            json!({
                "sessionId": session_id,
                "incarnation": session["incarnation"],
                "event": "UserPromptSubmit",
                "agentSessionId": hostile,
            }),
        );
        assert_eq!(updated["agentSessionId"], Value::Null, "{hostile:?}");
    }
}
