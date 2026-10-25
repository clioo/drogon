//! A Claude automation run must not be `Completed` by the very tick that
//! launched it (issue #684). Reconciliation finalizes a live session on the
//! busy-to-idle edge, but a launched Claude session is *defined* to be idle:
//! `initial_hook_turn_ended` lands the row on the session boundary so a
//! fresh TUI shows no phantom spinner (issue #360), and Claude's own
//! `SessionStart` hook re-asserts that boundary. Neither is evidence that a
//! turn ran, so neither may finalize a run. Completion now additionally
//! requires a turn boundary the harness itself reported — a resumption hook
//! that opened a turn or a turn-end hook that closed one — stamped no
//! earlier than the run's dispatch.
//!
//! Unix-only, like the other PTY suites. No model inference: the `claude`
//! fixture is a shell script resolved through `agentCmdOverrides`, and hooks
//! arrive through the same `session.hook_event` RPC the hidden `drogon-cli
//! internal hook-event` subcommand calls.

#![cfg(unix)]

use std::time::{Duration, Instant};

use drogon_core::Engine;
use drogon_core::automations::scheduler;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

fn request(method: &str, params: Value) -> Request {
    Request {
        protocol: PROTOCOL_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        auth: None,
        method: method.into(),
        params,
    }
}

fn ok(response: Response) -> Value {
    assert!(response.ok, "{response:?}");
    response.result.unwrap()
}

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64
}

/// Installs a `claude` fixture under the test's own directory and points
/// `agentCmdOverrides` at its absolute path, so `harness.start` resolves it
/// without touching process-global `PATH` (which races parallel tests).
fn install_claude_fixture(dir: &tempfile::TempDir, body: &str) {
    let bin = dir.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let script = bin.join("claude");
    std::fs::write(&script, body).unwrap();
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
}

fn engine_with_workspace(dir: &tempfile::TempDir) -> (Engine, String) {
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_dir = dir.path().join("work");
    std::fs::create_dir_all(&workspace_dir).unwrap();
    let registered = ok(engine.dispatch(request(
        "workspace.register",
        json!({ "path": workspace_dir.to_string_lossy() }),
    )));
    let workspace_id = registered["id"].as_str().unwrap().to_string();
    (engine, workspace_id)
}

/// Creates a Claude automation and backdates its stored slot so the next
/// tick on the real clock is due. The real clock matters: reconciliation
/// compares hook stamps against `dispatched_at`, so a synthetic future
/// tick clock would make every stamp look stale for the wrong reason.
fn due_claude_automation(dir: &tempfile::TempDir, engine: &Engine, workspace_id: &str) -> String {
    let created = ok(engine.dispatch(request(
        "automation.create",
        json!({
            "name": "turn-proof",
            "cron": "* * * * *",
            "workspaceId": workspace_id,
            "harness": "claude",
            "prompt": "sweep the thing",
        }),
    )));
    let automation_id = created["id"].as_str().unwrap().to_string();
    let conn = open_engine_db(dir);
    let text: String = conn
        .query_row(
            "SELECT payload_json FROM automations WHERE id = ?1",
            [&automation_id],
            |row| row.get(0),
        )
        .unwrap();
    let mut payload: Value = serde_json::from_str(&text).unwrap();
    payload["nextRunAt"] = json!(now_ms() - 1_000.0);
    payload["dtstart"] = json!(0.0);
    let changed = conn
        .execute(
            "UPDATE automations SET payload_json = ?1 WHERE id = ?2",
            rusqlite::params![payload.to_string(), &automation_id],
        )
        .unwrap();
    assert_eq!(changed, 1);
    automation_id
}

fn open_engine_db(dir: &tempfile::TempDir) -> rusqlite::Connection {
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    conn.busy_timeout(Duration::from_secs(5)).unwrap();
    conn
}

fn read_run_payload(conn: &rusqlite::Connection, run_id: &str) -> Value {
    let text: String = conn
        .query_row(
            "SELECT payload_json FROM automation_runs WHERE id = ?1",
            [run_id],
            |row| row.get(0),
        )
        .unwrap();
    serde_json::from_str(&text).unwrap()
}

fn write_run_payload(conn: &rusqlite::Connection, run_id: &str, payload: &Value) {
    let changed = conn
        .execute(
            "UPDATE automation_runs SET payload_json = ?1 WHERE id = ?2",
            rusqlite::params![payload.to_string(), run_id],
        )
        .unwrap();
    assert_eq!(changed, 1);
}

fn newest_run(engine: &Engine, automation_id: &str) -> Value {
    let history = ok(engine.dispatch(request(
        "automation.history",
        json!({ "automationId": automation_id }),
    )));
    history["runs"][0].clone()
}

/// The run row by id. Tests follow the run they fired, never "the newest
/// one": a `* * * * *` schedule reschedules onto the next minute boundary,
/// so a test that waits out an activity window can otherwise cross it and
/// start reading a second, freshly dispatched run.
fn run_by_id(engine: &Engine, automation_id: &str, run_id: &str) -> Value {
    let history = ok(engine.dispatch(request(
        "automation.history",
        json!({ "automationId": automation_id }),
    )));
    history["runs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|run| run["id"] == json!(run_id))
        .unwrap_or_else(|| panic!("run {run_id} must be in history"))
        .clone()
}

/// Stops the schedule after its one fire, so no second slot dispatches a
/// second Claude session while the test waits. Reconciliation of the run
/// already dispatched is unaffected: it is keyed by run row, not by whether
/// the automation is still enabled.
fn disable(engine: &Engine, automation_id: &str) {
    let updated = ok(engine.dispatch(request(
        "automation.update",
        json!({ "id": automation_id, "enabled": false }),
    )));
    assert_eq!(updated["enabled"], json!(false));
}

fn session_row(engine: &Engine, session_id: &str) -> Value {
    let listed = ok(engine.dispatch(request("session.list", json!({}))));
    listed["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == json!(session_id))
        .unwrap_or_else(|| panic!("session {session_id} must be listed"))
        .clone()
}

fn hook_event(engine: &Engine, session_id: &str, incarnation: &str, event: &str) -> Value {
    ok(engine.dispatch(request(
        "session.hook_event",
        json!({ "sessionId": session_id, "incarnation": incarnation, "event": event }),
    )))
}

/// Stops a test-owned session and proves it reached `exited` before the
/// test reports success, so no fixture PTY outlives the suite.
fn stop_and_confirm_exit(engine: &Engine, session_id: &str, incarnation: &str) {
    ok(engine.dispatch(request(
        "session.stop",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    )));
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if session_row(engine, session_id)["verdict"] == json!("exited") {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "test-owned session {session_id} must exit"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// The hook arm, exactly as reported: an interactive Claude session that is
/// idle because it just launched, bound to a run dispatched in that same
/// second. The tick must leave the run `Dispatched` until the harness
/// reports a real turn, then finalize it exactly once.
#[test]
fn a_claude_launch_boundary_never_finalizes_the_run_it_was_dispatched_for() {
    let dir = tempfile::tempdir().unwrap();
    // `cat` stays at the prompt forever, like a TUI waiting for input.
    install_claude_fixture(&dir, "#!/bin/sh\ncat\n");
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let automation_id = due_claude_automation(&dir, &engine, &workspace_id);

    // The tick that fires the automation must not also finish it.
    let fired = scheduler::tick_once(&engine, now_ms());
    assert_eq!(fired.fired, 1, "the backdated slot is due");
    assert_eq!(
        fired.completed, 0,
        "the firing tick must not complete its own run"
    );
    let run = newest_run(&engine, &automation_id);
    let run_id = run["id"].as_str().unwrap().to_string();
    assert_eq!(run["status"], json!("dispatched"));
    disable(&engine, &automation_id);
    let dispatch_session = run["terminalSessionId"].as_str().unwrap().to_string();
    let dispatch_incarnation = session_row(&engine, &dispatch_session)["incarnation"]
        .as_str()
        .unwrap()
        .to_string();

    // Scheduler fires are headless (`claude -p`), which installs no hook
    // file. The reported mechanism lives on the interactive install
    // surface, so the run is re-bound to a hook-launched Claude session —
    // the real admission path, `initial_hook_turn_ended` and all. No public
    // RPC re-links runs, hence the direct row write (same shape the
    // turn-ended reconciliation test uses).
    let dispatched_at = now_ms();
    let interactive = ok(engine.dispatch(request(
        "harness.start",
        json!({
            "workspaceId": workspace_id,
            "harnessId": "claude",
            "permissionMode": "inherit",
        }),
    )));
    let session_id = interactive["id"].as_str().unwrap().to_string();
    let incarnation = interactive["incarnation"].as_str().unwrap().to_string();

    // The launch definition itself: idle, on the harness's own authority,
    // with no turn boundary reported at all.
    let launched = session_row(&engine, &session_id);
    assert_eq!(
        launched["agentState"],
        json!("idle"),
        "a fresh Claude session stays idle (issue #360)"
    );
    assert_eq!(launched["agentStateAuthority"], json!("hook"));
    assert!(
        launched["agentTurnStartedAt"].is_null() && launched["agentTurnEndedAt"].is_null(),
        "a launch reports no turn boundary: {launched}"
    );

    // Claude fires `SessionStart` at the session boundary itself — on
    // launch, on resume and after `/clear`. It lands the same idle row and
    // must stay just as silent about turns.
    let boundary = hook_event(&engine, &session_id, &incarnation, "SessionStart");
    assert_eq!(boundary["agentState"], json!("idle"));
    assert!(
        boundary["agentTurnStartedAt"].is_null() && boundary["agentTurnEndedAt"].is_null(),
        "SessionStart is a session boundary, not a turn end: {boundary}"
    );

    {
        let db = open_engine_db(&dir);
        let mut payload = read_run_payload(&db, &run_id);
        payload["status"] = json!("dispatched");
        payload["terminalSessionId"] = json!(session_id);
        payload["sessionIncarnation"] = json!(incarnation);
        // Launch and dispatch inside the same second: the exact edge the
        // seconds-truncation tolerance accepts, which is why the stamp rule
        // alone could never catch this.
        payload["dispatchedAt"] = json!(dispatched_at);
        payload["startedAt"] = json!(dispatched_at);
        write_run_payload(&db, &run_id, &payload);
    }
    stop_and_confirm_exit(&engine, &dispatch_session, &dispatch_incarnation);

    // THE regression: idle-at-launch, stamped in the dispatch second, is
    // not a finished turn.
    let before_turn = scheduler::tick_once(&engine, now_ms());
    assert_eq!(before_turn.completed, 0);
    assert_eq!(before_turn.stranded, 0);
    assert_eq!(
        run_by_id(&engine, &automation_id, &run_id)["status"],
        json!("dispatched"),
        "the run is still waiting for Claude to start the turn"
    );

    // The turn actually runs.
    let working = hook_event(&engine, &session_id, &incarnation, "UserPromptSubmit");
    assert_eq!(working["agentState"], json!("working"));
    assert!(
        working["agentTurnStartedAt"].is_string(),
        "UserPromptSubmit opens a turn: {working}"
    );
    let mid_turn = scheduler::tick_once(&engine, now_ms());
    assert_eq!(mid_turn.completed, 0, "a working turn is not finished");

    let stopped = hook_event(&engine, &session_id, &incarnation, "Stop");
    assert_eq!(stopped["agentState"], json!("idle"));
    assert!(
        stopped["agentTurnEndedAt"].is_string(),
        "Stop closes the turn: {stopped}"
    );

    // Now — and only now — the run finalizes, exactly once.
    let finalized = scheduler::tick_once(&engine, now_ms());
    assert_eq!(finalized.completed, 1);
    let completed = run_by_id(&engine, &automation_id, &run_id);
    assert_eq!(completed["status"], json!("completed"));
    let observed_at = completed["observedAt"].clone();

    let again = scheduler::tick_once(&engine, now_ms());
    assert_eq!(again.completed, 0, "a completed run is finalized once");
    let unchanged = run_by_id(&engine, &automation_id, &run_id);
    assert_eq!(unchanged["status"], json!("completed"));
    assert_eq!(unchanged["observedAt"], observed_at);

    stop_and_confirm_exit(&engine, &session_id, &incarnation);
}

/// The arm the shipping dispatch actually reaches: scheduler fires are
/// headless, so Claude gets no hook file and its row falls back to the
/// activity clock — which reads `idle` after three seconds of silence, with
/// a stamp long past dispatch. A headless run's completion signal is its
/// process verdict, never a pause in its output, so the quiet tick must
/// leave it alone and the exit must finish it.
#[test]
fn a_quiet_headless_claude_run_waits_for_its_exit_not_for_silence() {
    let dir = tempfile::tempdir().unwrap();
    // Prints once (so the activity clock has a stamp after dispatch), then
    // works silently for far longer than the activity window.
    install_claude_fixture(&dir, "#!/bin/sh\necho thinking\nexec sleep 120\n");
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let automation_id = due_claude_automation(&dir, &engine, &workspace_id);

    let fired = scheduler::tick_once(&engine, now_ms());
    assert_eq!(fired.fired, 1);
    assert_eq!(fired.completed, 0);
    let run = newest_run(&engine, &automation_id);
    let run_id = run["id"].as_str().unwrap().to_string();
    disable(&engine, &automation_id);
    let session_id = run["terminalSessionId"].as_str().unwrap().to_string();
    let incarnation = session_row(&engine, &session_id)["incarnation"]
        .as_str()
        .unwrap()
        .to_string();

    // Wait for the row to go quiet-idle: the state the old predicate
    // finalized on.
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let row = session_row(&engine, &session_id);
        if row["agentState"] == json!("idle") {
            assert_eq!(
                row["agentStateAuthority"],
                json!("activity"),
                "a headless Claude launch installs no hooks, so its idle is the activity clock"
            );
            assert!(
                row["agentTurnStartedAt"].is_null() && row["agentTurnEndedAt"].is_null(),
                "no hook ever reported a turn for this session: {row}"
            );
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the quiet fixture must settle to idle, saw {}",
            row["agentState"]
        );
        std::thread::sleep(Duration::from_millis(250));
    }

    let quiet = scheduler::tick_once(&engine, now_ms());
    assert_eq!(
        quiet.completed, 0,
        "silence is not a finished turn: `sleep 120` is still running"
    );
    assert_eq!(
        run_by_id(&engine, &automation_id, &run_id)["status"],
        json!("dispatched")
    );

    // The verdict is what finishes a headless run — and it does, so the
    // stricter idle rule strands nothing. (The exit observation itself is
    // the reaper's; the tick is the backstop and must not double-finalize.)
    stop_and_confirm_exit(&engine, &session_id, &incarnation);
    let mut finalized = 0;
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        // The tick is the backstop for the exit the reaper may already have
        // observed; either way the outcome is Completed with a verdict, and
        // a live-but-quiet run is the only thing it leaves alone.
        let summary = scheduler::tick_once(&engine, now_ms());
        finalized += summary.completed;
        assert_eq!(summary.stranded, 0, "an exited run is never stranded");
        let run = run_by_id(&engine, &automation_id, &run_id);
        if run["status"] == json!("completed") {
            assert!(
                run["exitCode"].is_number(),
                "an exited headless run carries its verdict: {run}"
            );
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the exit must finalize the run, saw {}",
            run["status"]
        );
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(
        finalized <= 1,
        "the run finalizes at most once, saw {finalized}"
    );
    let after_exit = scheduler::tick_once(&engine, now_ms());
    assert_eq!(
        after_exit.completed, 0,
        "a finalized run is not re-finalized"
    );
    assert_eq!(after_exit.stranded, 0, "an exited run is never stranded");
}
