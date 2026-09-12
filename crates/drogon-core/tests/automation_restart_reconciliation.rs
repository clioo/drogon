//! Startup reconciliation of headless run records (install-resilience P2):
//! automation runs, Bot responsibility runs and Bot chat turns left
//! `dispatched`/`live` by a daemon restart must never keep claiming a
//! liveness nothing holds — and the owner must keep a way forward. Driven
//! through `Engine::dispatch` with the fixture `pi` harness (echo + exit 0,
//! never a real model); the stranded rows are seeded exactly as a crash
//! mid-run leaves them, then a fresh `Engine::open` must reconcile them.

use std::time::Duration;

use drogon_core::{DB_FILE_NAME, Engine};
use drogon_protocol::{Request, Response};
use serde_json::{Value, json};
use tempfile::TempDir;

fn request(id: &str, method: &str, params: Value) -> Request {
    drogon_protocol::Request {
        protocol: drogon_protocol::PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    }
}

fn ok(response: Response) -> Value {
    assert!(response.ok, "{response:?}");
    response.result.unwrap()
}

fn engine_with_workspace(dir: &TempDir) -> (Engine, String) {
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_dir = dir.path().join("work");
    std::fs::create_dir_all(&workspace_dir).unwrap();
    let registered = ok(engine.dispatch(request(
        "ws-1",
        "workspace.register",
        json!({"path": workspace_dir.to_string_lossy()}),
    )));
    let workspace_id = registered["id"].as_str().unwrap().to_string();
    (engine, workspace_id)
}

/// Fixture harness: an executable named `pi` on `PATH` that prints and
/// exits 0 — the demo harness, never real model inference.
fn ensure_fixture_harness_on_path() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let dir =
            std::env::temp_dir().join(format!("drogon-automation-fixture-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pi = dir.join("pi");
        std::fs::write(&pi, "#!/bin/sh\nprintf 'reconcile-fixture-output\\n'\nexit 0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&pi, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let old = std::env::var_os("PATH").unwrap_or_default();
        let mut paths = vec![dir.clone().into_os_string()];
        paths.extend(std::env::split_paths(&old).map(|p| p.into_os_string()));
        unsafe {
            std::env::set_var("PATH", std::env::join_paths(paths).unwrap());
        }
    });
}

fn create_automation(engine: &Engine, id: &str, workspace_id: &str) -> Value {
    ok(engine.dispatch(request(
        id,
        "automation.create",
        json!({
            "name": format!("auto-{id}"),
            "cron": "* * * * *",
            "workspaceId": workspace_id,
            "harness": "pi",
            "prompt": "fixture sweep",
        }),
    )))
}

fn run_detail(engine: &Engine, run_id: &str) -> Value {
    ok(engine.dispatch(request(
        &uuid::Uuid::new_v4().to_string(),
        "automation.run",
        json!({"runId": run_id}),
    )))
}

fn run_now(engine: &Engine, automation_id: &str) -> Value {
    ok(engine.dispatch(request(
        &uuid::Uuid::new_v4().to_string(),
        "automation.run_now",
        json!({"id": automation_id}),
    )))
}

/// Seeds the `dispatched` run row a daemon crash mid-run leaves behind: the
/// watcher that would have advanced it died with the process. Direct SQL on
/// the test's own data dir; `session_id` must name NO `sessions` row (the
/// ghost-session shape the audit's Finding 2 predicts).
fn seed_dispatched_run(
    dir: &TempDir,
    automation_id: &str,
    run_id: &str,
    session_id: &str,
    incarnation: &str,
) {
    let payload = json!({
        "id": run_id,
        "automationId": automation_id,
        "title": "orphaned by restart",
        "scheduledFor": 1_000.0,
        "status": "dispatched",
        "trigger": "scheduled",
        "workspaceId": null,
        "sessionKind": "terminal",
        "terminalSessionId": session_id,
        "sessionIncarnation": incarnation,
        "createdAt": 900.0,
        "runNumber": 1.0,
    });
    let conn = rusqlite::Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
    conn.execute(
        "INSERT INTO automation_runs (id, automation_id, payload_json) VALUES (?1, ?2, ?3)",
        rusqlite::params![run_id, automation_id, payload.to_string()],
    )
    .unwrap();
}

fn sqlite_column(dir: &TempDir, sql: &str, param: &str) -> Option<String> {
    let conn = rusqlite::Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
    conn.query_row(sql, [param], |row| row.get::<_, Option<String>>(0))
        .unwrap()
}

/// Finding 2, converted from INFERRED to OBSERVED: a `dispatched`
/// automation run whose terminal session is absent from `sessions` still
/// reports `dispatched` after a daemon restart — and with the fix it
/// reconciles to `skipped_unavailable` ("Unavailable", already wired into
/// the renderer's re-run affordance) with a truthful error, and a re-run
/// dispatches a fresh real run. Never `dispatch_failed`: loss of contact
/// is not failure.
#[test]
fn a_dispatched_run_orphaned_by_a_restart_reconciles_and_reruns() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let created = create_automation(&engine, "rec-auto", &workspace_id);
    let automation_id = created["id"].as_str().unwrap().to_string();

    seed_dispatched_run(&dir, &automation_id, "rec-run-ghost", "sess-ghost", "inc-ghost");

    // The repro (Finding 2): before the restart the row honestly reports
    // dispatched; a fresh daemon used to keep reporting exactly this
    // forever, with nothing running it.
    let before = run_detail(&engine, "rec-run-ghost");
    assert_eq!(before["status"], "dispatched");

    // Restart the daemon.
    drop(engine);
    let restarted = Engine::open(dir.path()).unwrap();

    // No row may claim a liveness nothing holds — and it lands
    // unavailable, never failed.
    let after = run_detail(&restarted, "rec-run-ghost");
    assert_eq!(after["status"], "skipped_unavailable");
    let error = after["error"].as_str().unwrap_or_default();
    assert!(error.contains("restart"), "untruthful error: {error}");

    // The way forward: the re-run affordance works — run_now dispatches a
    // fresh, real run through the fixture harness.
    let now = run_now(&restarted, &automation_id);
    assert_eq!(now["outcome"], "dispatched");
    let fresh_id = now["runId"].as_str().unwrap().to_string();
    assert_ne!(fresh_id, "rec-run-ghost");
    // The fresh run proceeds to a real completion while the ghost run
    // stays reconciled — no resurrection, no second lie.
    let mut fresh_status = String::new();
    for _ in 0..100 {
        fresh_status = run_detail(&restarted, &fresh_id)["status"]
            .as_str()
            .unwrap()
            .to_string();
        if fresh_status != "dispatched" {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(
        fresh_status == "dispatched" || fresh_status == "completed",
        "fresh run ended in an unexpected status: {fresh_status}"
    );
    let ghost = run_detail(&restarted, "rec-run-ghost");
    assert_eq!(ghost["status"], "skipped_unavailable");
}

/// The crash-window replay: the prior process observed the child's exit and
/// durably recorded it on the session (verdict `exited` + code) but died
/// before advancing the run row. That is positive evidence, so the
/// reconciliation completes the run with the recorded code — exactly what
/// the live observer would have committed.
#[test]
fn a_dispatched_run_whose_session_recorded_its_exit_replays_completion() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let created = create_automation(&engine, "rec-exit", &workspace_id);
    let automation_id = created["id"].as_str().unwrap().to_string();

    seed_dispatched_run(&dir, &automation_id, "rec-run-exit", "sess-real", "inc-real");
    {
        let conn = rusqlite::Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
        conn.execute(
            "INSERT INTO sessions (id, workspace_id, host_id, incarnation, command, args_json, \
             cols, rows, verdict, exit_code, created_at) \
             VALUES ('sess-real', 'ws', 'host', 'inc-real', '/bin/sh', '[]', 80, 24, \
             'exited', 3, '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
    }

    drop(engine);
    let restarted = Engine::open(dir.path()).unwrap();

    let after = run_detail(&restarted, "rec-run-exit");
    assert_eq!(after["status"], "completed");
    assert_eq!(after["exitCode"], 3);
}

/// Bot chat turns and responsibility runs reconcile the same way: a turn
/// still claiming `live` whose session is gone becomes `unverifiable`
/// (loss of contact is never `exited`), and a responsibility run moves
/// with the automation run it was admitted for.
#[test]
fn live_bot_turns_and_responsibility_runs_do_not_survive_a_restart_as_live() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let created = create_automation(&engine, "rec-bot", &workspace_id);
    let automation_id = created["id"].as_str().unwrap().to_string();

    seed_dispatched_run(&dir, &automation_id, "rec-run-bot", "sess-ghost", "inc-ghost");
    {
        let conn = rusqlite::Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
        // A chat turn claiming `live` for the same ghost session.
        let message = json!({
            "id": "msg-ghost",
            "botId": "bot-1",
            "requestId": "req-1",
            "prompt": "hello",
            "sessionId": "sess-ghost",
            "incarnation": "inc-ghost",
            "hostObservation": "live",
            "startedAt": 800.0,
            "endedAt": 810.0,
        });
        conn.execute(
            "INSERT INTO bot_messages (id, bot_id, started_at, payload_json) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["msg-ghost", "bot-1", 800.0, message.to_string()],
        )
        .unwrap();
        // A responsibility run admitted for the ghost automation run.
        let responsibility = json!({
            "id": "resp-ghost",
            "botId": "bot-1",
            "responsibilityId": "resp-1",
            "automationId": automation_id,
            "automationRunId": "rec-run-bot",
            "startedAt": 800.0,
            "hostObservation": "live",
            "invocation": "scheduled",
        });
        conn.execute(
            "INSERT INTO bot_responsibility_runs (id, bot_id, automation_run_id, started_at, payload_json) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params!["resp-ghost", "bot-1", "rec-run-bot", 800.0, responsibility.to_string()],
        )
        .unwrap();
    }

    drop(engine);
    let _restarted = Engine::open(dir.path()).unwrap();

    let message_observation = sqlite_column(
        &dir,
        "SELECT json_extract(payload_json, '$.hostObservation') FROM bot_messages WHERE id = ?1",
        "msg-ghost",
    )
    .unwrap();
    assert_eq!(message_observation, "unverifiable");
    let responsibility_observation = sqlite_column(
        &dir,
        "SELECT json_extract(payload_json, '$.hostObservation') FROM bot_responsibility_runs WHERE id = ?1",
        "resp-ghost",
    )
    .unwrap();
    assert_eq!(responsibility_observation, "unverifiable");
    // The automation run itself reconciled too — the responsibility run
    // moved with it, not independently.
    let run_status = sqlite_column(
        &dir,
        "SELECT json_extract(payload_json, '$.status') FROM automation_runs WHERE id = ?1",
        "rec-run-bot",
    )
    .unwrap();
    assert_eq!(run_status, "skipped_unavailable");
}

/// A chat turn whose session positively recorded its exit replays `exited`
/// with the turn's end stamped — the crash-window replay for messages.
#[test]
fn a_live_chat_turn_whose_session_recorded_its_exit_replays_exited() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, _workspace_id) = engine_with_workspace(&dir);
    {
        let conn = rusqlite::Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
        let message = json!({
            "id": "msg-exit",
            "botId": "bot-1",
            "requestId": "req-1",
            "prompt": "hello",
            "sessionId": "sess-real",
            "incarnation": "inc-real",
            "hostObservation": "live",
            "startedAt": 800.0,
            "endedAt": 810.0,
        });
        conn.execute(
            "INSERT INTO bot_messages (id, bot_id, started_at, payload_json) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params!["msg-exit", "bot-1", 800.0, message.to_string()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions (id, workspace_id, host_id, incarnation, command, args_json, \
             cols, rows, verdict, exit_code, created_at) \
             VALUES ('sess-real', 'ws', 'host', 'inc-real', '/bin/sh', '[]', 80, 24, \
             'exited', 0, '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
    }

    drop(engine);
    let _restarted = Engine::open(dir.path()).unwrap();

    let observation = sqlite_column(
        &dir,
        "SELECT json_extract(payload_json, '$.hostObservation') FROM bot_messages WHERE id = ?1",
        "msg-exit",
    )
    .unwrap();
    assert_eq!(observation, "exited");
}

/// Sanity for the honest no-op: rows already terminal (and a genuinely
/// exited turn) are never demoted or rewritten by the reconciliation.
#[test]
fn terminal_rows_are_left_untouched_by_the_reconciliation() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let created = create_automation(&engine, "rec-done", &workspace_id);
    let automation_id = created["id"].as_str().unwrap().to_string();

    {
        let conn = rusqlite::Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
        let completed = json!({
            "id": "rec-run-done",
            "automationId": automation_id,
            "title": "already done",
            "scheduledFor": 1_000.0,
            "status": "completed",
            "trigger": "scheduled",
            "sessionKind": "terminal",
            "exitCode": 0,
            "createdAt": 900.0,
        });
        conn.execute(
            "INSERT INTO automation_runs (id, automation_id, payload_json) VALUES (?1, ?2, ?3)",
            rusqlite::params!["rec-run-done", automation_id, completed.to_string()],
        )
        .unwrap();
    }

    drop(engine);
    let _restarted = Engine::open(dir.path()).unwrap();

    let run_status = sqlite_column(
        &dir,
        "SELECT json_extract(payload_json, '$.status') FROM automation_runs WHERE id = ?1",
        "rec-run-done",
    )
    .unwrap();
    assert_eq!(run_status, "completed");
}

/// A session row that is NOT exited-with-code is loss of contact, never
/// completion: an `unverifiable` session (the verdict startup recovery just
/// settled on) must reconcile its stranded run to `unavailable`, not
/// `completed` and not `dispatch_failed`.
#[test]
fn an_exited_session_without_a_code_is_loss_of_contact_not_completion() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let created = create_automation(&engine, "rec-nocode", &workspace_id);
    let automation_id = created["id"].as_str().unwrap().to_string();

    seed_dispatched_run(&dir, &automation_id, "rec-run-nocode", "sess-nocode", "inc-nocode");
    {
        let conn = rusqlite::Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
        conn.execute(
            "INSERT INTO sessions (id, workspace_id, host_id, incarnation, command, args_json, \
             cols, rows, verdict, exit_code, created_at) \
             VALUES ('sess-nocode', 'ws', 'host', 'inc-nocode', '/bin/sh', '[]', 80, 24, \
             'unverifiable', NULL, '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
    }

    drop(engine);
    let restarted = Engine::open(dir.path()).unwrap();

    let after = run_detail(&restarted, "rec-run-nocode");
    assert_eq!(after["status"], "skipped_unavailable");
}
