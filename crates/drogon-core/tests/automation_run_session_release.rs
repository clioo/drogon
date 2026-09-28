//! A recurring automation must not pile one exited tab per run into its
//! workspace. The scheduler tick keeps each automation's newest run session
//! and releases older ones once they have provably exited, copying their
//! output into run history first. Harnesses are shell fixtures that print
//! and exit (or sleep), never real model inference.

use std::time::Duration;

use drogon_core::Engine;
use drogon_core::automations::run_session_release::{
    RELEASED_SNAPSHOT_MAX_BYTES, released_snapshot,
};
use drogon_core::automations::scheduler;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

fn request(id: &str, method: &str, params: Value) -> Request {
    Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    }
}

fn call(engine: &Engine, method: &str, params: Value) -> Response {
    engine.dispatch(request(&uuid::Uuid::new_v4().to_string(), method, params))
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

/// Writes a `pi` fixture into the data dir and points the harness override
/// at it, so each test picks its own fixture without touching `PATH`.
fn engine_with_pi_fixture(dir: &tempfile::TempDir, script: &str) -> (Engine, String) {
    let bin = dir.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let pi = bin.join("pi");
    std::fs::write(&pi, script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&pi, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    std::fs::write(
        dir.path().join("agent-settings.json"),
        serde_json::to_vec(&json!({
            "version": 1,
            "settings": {
                "defaultTuiAgent": null,
                "disabledTuiAgents": [],
                "agentCmdOverrides": { "pi": pi.to_string_lossy() },
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
    let engine = Engine::open(dir.path()).unwrap();
    let work = dir.path().join("work");
    std::fs::create_dir_all(&work).unwrap();
    let registered = ok(call(
        &engine,
        "workspace.register",
        json!({"path": work.to_string_lossy()}),
    ));
    (engine, registered["id"].as_str().unwrap().to_string())
}

const PRINT_AND_EXIT: &str = "#!/bin/sh\necho \"issue-watch-fixture-output\"\nexit 0\n";

fn create_automation(engine: &Engine, workspace_id: &str) -> String {
    let created = ok(call(
        engine,
        "automation.create",
        json!({
            "name": "issue-watch",
            "cron": "0 0 1 1 *",
            "workspaceId": workspace_id,
            "harness": "pi",
            "prompt": "fixture watch",
        }),
    ));
    created["id"].as_str().unwrap().to_string()
}

/// Runs the automation once and returns `(run id, session id, incarnation)`.
fn run_now(engine: &Engine, automation_id: &str) -> (String, String, String) {
    let result = ok(call(
        engine,
        "automation.run_now",
        json!({"id": automation_id}),
    ));
    let run_id = result["runId"].as_str().unwrap().to_string();
    // The run detail flattens the run view beside its snapshot fields.
    let detail = ok(call(engine, "automation.run", json!({"runId": run_id})));
    let session_id = detail["terminalSessionId"].as_str().unwrap().to_string();
    let incarnation = session_incarnation(engine, &session_id);
    // Distinct creation instants keep "newest run" unambiguous.
    std::thread::sleep(Duration::from_millis(5));
    (run_id, session_id, incarnation)
}

fn listed_sessions(engine: &Engine, workspace_id: &str) -> Vec<Value> {
    ok(call(
        engine,
        "session.list",
        json!({"workspaceId": workspace_id}),
    ))["sessions"]
        .as_array()
        .unwrap()
        .clone()
}

fn session_incarnation(engine: &Engine, session_id: &str) -> String {
    let all = ok(call(engine, "session.list", json!({})));
    all["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == json!(session_id))
        .and_then(|s| s["incarnation"].as_str())
        .expect("run session must be listed")
        .to_string()
}

fn wait_exited(engine: &Engine, workspace_id: &str, session_id: &str) {
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        let exited = listed_sessions(engine, workspace_id)
            .iter()
            .any(|s| s["id"] == json!(session_id) && s["verdict"] == json!("exited"));
        if exited {
            return;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "fixture session {session_id} never exited"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn listed_ids(engine: &Engine, workspace_id: &str) -> Vec<String> {
    listed_sessions(engine, workspace_id)
        .iter()
        .map(|s| s["id"].as_str().unwrap().to_string())
        .collect()
}

fn open_engine_db(dir: &tempfile::TempDir) -> rusqlite::Connection {
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    conn.busy_timeout(Duration::from_secs(5)).unwrap();
    conn
}

fn set_run_status(dir: &tempfile::TempDir, run_id: &str, status: &str) {
    let db = open_engine_db(dir);
    let text: String = db
        .query_row(
            "SELECT payload_json FROM automation_runs WHERE id = ?1",
            [run_id],
            |row| row.get(0),
        )
        .unwrap();
    let mut payload: Value = serde_json::from_str(&text).unwrap();
    payload["status"] = json!(status);
    db.execute(
        "UPDATE automation_runs SET payload_json = ?1 WHERE id = ?2",
        rusqlite::params![payload.to_string(), run_id],
    )
    .unwrap();
}

#[test]
fn a_recurring_automation_keeps_only_its_newest_run_session() {
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_pi_fixture(&dir, PRINT_AND_EXIT);
    let automation_id = create_automation(&engine, &workspace_id);

    let runs: Vec<_> = (0..3).map(|_| run_now(&engine, &automation_id)).collect();
    for (_, session_id, _) in &runs {
        wait_exited(&engine, &workspace_id, session_id);
    }
    assert_eq!(listed_ids(&engine, &workspace_id).len(), 3);

    let summary = scheduler::tick_once(&engine, now_ms());
    assert_eq!(summary.released, 2, "{summary:?}");

    // Only the newest run's session is left on the workspace's tab strip.
    let (_, newest_session, _) = &runs[2];
    assert_eq!(
        listed_ids(&engine, &workspace_id),
        vec![newest_session.clone()]
    );

    for (run_id, session_id, incarnation) in &runs[..2] {
        // The record and the in-memory handle are both gone.
        let read = call(
            &engine,
            "session.read",
            json!({"sessionId": session_id, "incarnation": incarnation}),
        );
        assert!(!read.ok, "released session {session_id} is still readable");
        assert_eq!(read.error.unwrap().code, "not_found");
        // Run history still shows what the run printed.
        let detail = ok(call(&engine, "automation.run", json!({"runId": run_id})));
        assert_eq!(detail["status"], json!("completed"));
        assert_eq!(detail["sessionExists"], json!(false));
        let content = detail["outputSnapshot"]["content"].as_str().unwrap_or("");
        assert!(
            content.contains("issue-watch-fixture-output"),
            "released run {run_id} lost its output: {detail}"
        );
    }

    // Idempotent: nothing further to release until a newer run exists.
    assert_eq!(scheduler::tick_once(&engine, now_ms()).released, 0);
    assert_eq!(
        listed_ids(&engine, &workspace_id),
        vec![newest_session.clone()]
    );

    // The next run supersedes the one that was kept.
    let (_, next_session, _) = run_now(&engine, &automation_id);
    wait_exited(&engine, &workspace_id, &next_session);
    assert_eq!(scheduler::tick_once(&engine, now_ms()).released, 1);
    assert_eq!(listed_ids(&engine, &workspace_id), vec![next_session]);
}

#[test]
fn a_live_session_of_a_finished_run_is_never_released() {
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) =
        engine_with_pi_fixture(&dir, "#!/bin/sh\necho still-working\nexec sleep 120\n");
    let automation_id = create_automation(&engine, &workspace_id);
    let (older_run, older_session, older_inc) = run_now(&engine, &automation_id);
    let (_, newer_session, newer_inc) = run_now(&engine, &automation_id);
    // A run can finalize on its turn-end edge while its session lives on;
    // being superseded must not make that live PTY an orphan.
    set_run_status(&dir, &older_run, "completed");

    let summary = scheduler::tick_once(&engine, now_ms());
    assert_eq!(summary.released, 0, "{summary:?}");
    let listed = listed_ids(&engine, &workspace_id);
    assert!(listed.contains(&older_session) && listed.contains(&newer_session));

    for (session_id, incarnation) in [(older_session, older_inc), (newer_session, newer_inc)] {
        ok(call(
            &engine,
            "session.close",
            json!({"sessionId": session_id, "incarnation": incarnation}),
        ));
    }
    assert!(listed_ids(&engine, &workspace_id).is_empty());
}

#[test]
fn after_a_restart_only_a_stored_exited_verdict_proves_release() {
    let dir = tempfile::tempdir().unwrap();
    let (automation_id, workspace_id, runs) = {
        let (engine, workspace_id) = engine_with_pi_fixture(&dir, PRINT_AND_EXIT);
        let automation_id = create_automation(&engine, &workspace_id);
        let runs: Vec<_> = (0..3).map(|_| run_now(&engine, &automation_id)).collect();
        for (_, session_id, _) in &runs {
            wait_exited(&engine, &workspace_id, session_id);
        }
        (automation_id, workspace_id, runs)
    };
    for (run_id, _, _) in &runs {
        set_run_status(&dir, run_id, "completed");
    }
    // A row whose exit was never observed stays: loss of contact is not exit.
    let (_, unproven_session, _) = &runs[0];
    open_engine_db(&dir)
        .execute(
            "UPDATE sessions SET verdict = 'unverifiable', exit_code = NULL WHERE id = ?1",
            [unproven_session],
        )
        .unwrap();

    let engine = Engine::open(dir.path()).unwrap();
    let summary = scheduler::tick_once(&engine, now_ms());
    assert_eq!(summary.released, 1, "{summary:?}");
    let mut listed = listed_ids(&engine, &workspace_id);
    listed.sort();
    let mut expected = vec![unproven_session.clone(), runs[2].1.clone()];
    expected.sort();
    assert_eq!(listed, expected);
    let history = ok(call(
        &engine,
        "automation.history",
        json!({"automationId": automation_id}),
    ));
    assert_eq!(history["runs"].as_array().unwrap().len(), 3);
}

#[test]
fn released_snapshots_are_plain_trimmed_and_bounded() {
    assert!(released_snapshot("\x1b[32m  \x1b[0m\r\n", false, 1.0).is_none());

    let plain = released_snapshot("\x1b[1mNo new issues.\x1b[0m\r\n", false, 7.0).unwrap();
    assert_eq!(plain.content, "No new issues.");
    assert_eq!(plain.captured_at, 7.0);
    assert!(!plain.truncated);
    assert!(released_snapshot("done", true, 1.0).unwrap().truncated);

    // Over the bound: the newest bytes survive, cut on a char boundary.
    let long = format!(
        "{}é{}END",
        "a".repeat(10),
        "ñ".repeat(RELEASED_SNAPSHOT_MAX_BYTES)
    );
    let bounded = released_snapshot(&long, false, 1.0).unwrap();
    assert!(bounded.truncated);
    assert!(bounded.content.len() <= RELEASED_SNAPSHOT_MAX_BYTES);
    assert!(bounded.content.ends_with("END"));
    assert!(!bounded.content.starts_with('a'));
}
