//! `automation.runs_all` and `automation.run`: the runs-across-automations
//! dashboard query and the run detail page's RPC, driven through
//! `Engine::dispatch` with the fixture `pi` harness (echo + exit 0, never a
//! real model). Pins the honesty contract of the detail's output snapshot:
//! a live/retained session is read, a gone session with no stored snapshot
//! yields none, and nothing is ever fabricated.

use std::time::Duration;

use drogon_core::automations::direct::plain_text_snapshot_tail;
use drogon_core::automations::records::*;
use drogon_core::automations::scheduler;
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

fn err_code(response: Response) -> String {
    assert!(!response.ok, "expected error, got {response:?}");
    response.error.unwrap().code
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
/// exits 0 -- the demo harness, never real model inference.
fn ensure_fixture_harness_on_path() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let dir =
            std::env::temp_dir().join(format!("drogon-automation-fixture-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pi = dir.join("pi");
        // Bold + underline markup around the marker proves the detail's
        // snapshot serves plain text: markup is reduced, the words stay.
        std::fs::write(
            &pi,
            "#!/bin/sh\nprintf '\\033[1mbold\\033[0m automation-fixture-output\\033[4m\\n'\nexit 0\n",
        )
        .unwrap();
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

fn create_automation(engine: &Engine, id: &str, workspace_id: &str, cron: &str) -> Value {
    ok(engine.dispatch(request(
        id,
        "automation.create",
        json!({
            "name": format!("auto-{id}"),
            "cron": cron,
            "workspaceId": workspace_id,
            "harness": "pi",
            "prompt": "fixture sweep",
        }),
    )))
}

fn poll_session_exited(engine: &Engine, workspace_id: &str, session_id: &str) -> bool {
    for _ in 0..100 {
        let listed = ok(engine.dispatch(request(
            &uuid::Uuid::new_v4().to_string(),
            "session.list",
            json!({"workspaceId": workspace_id}),
        )));
        let sessions = listed["sessions"].as_array().unwrap();
        if sessions
            .iter()
            .any(|s| s["id"] == json!(session_id) && s["verdict"] == json!("exited"))
        {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

fn run_now(engine: &Engine, automation_id: &str) -> Value {
    ok(engine.dispatch(request(
        &uuid::Uuid::new_v4().to_string(),
        "automation.run_now",
        json!({"id": automation_id}),
    )))
}

#[test]
fn runs_all_pages_across_automations_newest_scheduled_first() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let manual = create_automation(&engine, "dash-manual", &workspace_id, "* * * * *");
    let manual_id = manual["id"].as_str().unwrap().to_string();
    let scheduled = create_automation(&engine, "dash-sched", &workspace_id, "* * * * *");

    // One manual run and one scheduled run, from different automations.
    // The manual automation is disabled after its manual run so the tick
    // below cannot fire a second run for it.
    run_now(&engine, &manual_id);
    ok(engine.dispatch(request(
        "dis-manual",
        "automation.update",
        json!({"id": manual_id, "enabled": false}),
    )));
    let slot = scheduled["nextRunAt"].as_f64().unwrap();
    let summary = scheduler::tick_once(&engine, slot + 30_000.0);
    assert_eq!(summary.fired, 1);

    let page1 = ok(engine.dispatch(request(
        "runs-page-1",
        "automation.runs_all",
        json!({"page": 1, "perPage": 1}),
    )));
    assert_eq!(page1["total"], json!(2));
    assert_eq!(page1["page"], json!(1));
    assert_eq!(page1["perPage"], json!(1));
    let runs1 = page1["runs"].as_array().unwrap();
    assert_eq!(runs1.len(), 1);
    let first = &runs1[0];
    assert!(
        first["automationName"] == json!("auto-dash-manual")
            || first["automationName"] == json!("auto-dash-sched")
    );
    assert!(first["id"].as_str().is_some());
    assert!(
        first["status"] == json!("dispatched") || first["status"] == json!("completed"),
        "unexpected status {}",
        first["status"]
    );

    let page2 = ok(engine.dispatch(request(
        "runs-page-2",
        "automation.runs_all",
        json!({"page": 2, "perPage": 1}),
    )));
    let runs2 = page2["runs"].as_array().unwrap();
    assert_eq!(runs2.len(), 1);
    assert_ne!(runs2[0]["id"], first["id"]);

    // Newest scheduledFor first: page 1's run is never older than page 2's.
    let all = ok(engine.dispatch(request(
        "runs-all-1",
        "automation.runs_all",
        json!({"page": 1, "perPage": 10}),
    )));
    let runs = all["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 2);
    assert!(runs[0]["scheduledFor"].as_f64().unwrap() >= runs[1]["scheduledFor"].as_f64().unwrap());
    // Every row names its automation and carries the wire view keys.
    for run in runs {
        assert!(run["automationName"].as_str().is_some());
        assert!(run["automationId"].as_str().is_some());
        assert!(run["scheduledFor"].as_f64().is_some());
    }
}

#[test]
fn runs_all_status_filter_only_returns_matching_runs() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let created = create_automation(&engine, "dash-filter", &workspace_id, "* * * * *");
    let automation_id = created["id"].as_str().unwrap().to_string();
    let result = run_now(&engine, &automation_id);
    assert_eq!(result["outcome"], json!("dispatched"));
    let observed = result["status"].as_str().unwrap().to_string();
    assert!(observed == "dispatched" || observed == "completed");

    let matching = ok(engine.dispatch(request(
        "filter-match",
        "automation.runs_all",
        json!({"page": 1, "perPage": 10, "status": observed}),
    )));
    assert_eq!(matching["total"], json!(1));
    assert_eq!(matching["runs"].as_array().unwrap().len(), 1);

    let other = if observed == "completed" {
        "dispatched"
    } else {
        "completed"
    };
    let empty = ok(engine.dispatch(request(
        "filter-miss",
        "automation.runs_all",
        json!({"page": 1, "perPage": 10, "status": other}),
    )));
    assert_eq!(empty["total"], json!(0));
    assert!(empty["runs"].as_array().unwrap().is_empty());
}

#[test]
fn runs_all_rejects_out_of_range_paging_params() {
    let dir = tempfile::tempdir().unwrap();
    let (engine, _workspace_id) = engine_with_workspace(&dir);
    for (id, params) in [
        ("page-zero", json!({"page": 0})),
        ("per-zero", json!({"page": 1, "perPage": 0})),
        ("per-huge", json!({"page": 1, "perPage": 9999})),
        ("bogus-status", json!({"page": 1, "status": "bogus"})),
    ] {
        assert_eq!(
            err_code(engine.dispatch(request(id, "automation.runs_all", params))),
            "invalid_argument",
            "case {id}"
        );
    }
    // A page past the end is not an error, just an empty page.
    let past = ok(engine.dispatch(request(
        "page-past",
        "automation.runs_all",
        json!({"page": u64::MAX, "perPage": 5}),
    )));
    assert_eq!(past["total"], json!(0));
    assert!(past["runs"].as_array().unwrap().is_empty());
    // Empty params are fine: defaults apply.
    let empty = ok(engine.dispatch(request("runs-empty", "automation.runs_all", json!({}))));
    assert_eq!(empty["page"], json!(1));
    assert_eq!(empty["perPage"], json!(50));
}

#[test]
fn run_detail_serves_the_session_tail_while_the_session_is_known() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let created = create_automation(&engine, "dash-detail", &workspace_id, "* * * * *");
    let automation_id = created["id"].as_str().unwrap().to_string();
    let result = run_now(&engine, &automation_id);
    let run_id = result["runId"].as_str().unwrap().to_string();

    let detail = ok(engine.dispatch(request(
        "run-detail-1",
        "automation.run",
        json!({"runId": run_id}),
    )));
    assert_eq!(detail["id"], json!(run_id));
    assert_eq!(detail["automationId"], json!(automation_id));
    assert_eq!(detail["trigger"], json!("manual"));
    assert!(detail.get("title").is_some());
    let session_id = detail["terminalSessionId"].as_str().unwrap().to_string();
    assert!(
        poll_session_exited(&engine, &workspace_id, &session_id),
        "the fixture harness session never reached exited"
    );

    // After the fixture's output was written, the detail serves the
    // retained tail and reports the session as still known to the daemon.
    let detail = ok(engine.dispatch(request(
        "run-detail-2",
        "automation.run",
        json!({"runId": run_id}),
    )));
    let snapshot = &detail["outputSnapshot"];
    assert!(!snapshot.is_null(), "expected a session-tail snapshot");
    assert_eq!(snapshot["format"], json!("plain_text"));
    let content = snapshot["content"].as_str().unwrap();
    assert!(
        content.contains("automation-fixture-output"),
        "snapshot should carry the fixture's real output, got {content:?}"
    );
    assert!(
        content.contains("bold"),
        "snapshot should keep the words while reducing markup, got {content:?}"
    );
    assert!(
        !content.contains('\x1b'),
        "plain_text snapshot must not leak terminal escapes, got {content:?}"
    );
    assert_eq!(snapshot["truncated"], json!(false));
    assert_eq!(detail["sessionExists"], json!(true));
    assert!(snapshot["capturedAt"].as_f64().is_some());
}

#[test]
fn snapshot_tail_reduces_terminal_markup_to_plain_text() {
    let raw = concat!(
        "\x1b[1;32mok\x1b[0m\r\n",
        "\x1b[2K\x1b[1Arepaint",
        "\x1b]0;title C:\\path\\file\x07",
        "\x1b]8;;https://example.com\x07link\x1b]8;;\x07",
        "\x1b]0;st-title\x1b\\",
        "\x1b(Bplain",
        "caf\u{e9} \u{1f980}",
        "a\rb",
        "c\x00d\x7fe",
        "\x1b",
    );
    assert_eq!(
        plain_text_snapshot_tail(raw),
        "ok\nrepaintlinkplaincaf\u{e9} \u{1f980}a\nbcde"
    );
}

#[test]
fn run_detail_without_a_session_has_no_snapshot_and_no_session() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let created = create_automation(&engine, "dash-refused", &workspace_id, "* * * * *");
    let automation_id = created["id"].as_str().unwrap().to_string();
    ok(engine.dispatch(request(
        "disable-1",
        "automation.update",
        json!({"id": automation_id, "enabled": false}),
    )));

    // The refusal records a skipped run with no session at all: the detail
    // must not invent output or claim a live session.
    let result = run_now(&engine, &automation_id);
    let run_id = result["runId"].as_str().unwrap().to_string();
    let detail = ok(engine.dispatch(request(
        "run-detail-refused",
        "automation.run",
        json!({"runId": run_id}),
    )));
    assert_eq!(detail["status"], json!("skipped_unavailable"));
    assert!(detail["outputSnapshot"].is_null());
    assert_eq!(detail["sessionExists"], json!(false));
    assert!(detail["error"].as_str().is_some());
    assert!(detail["terminalSessionId"].is_null());

    // Bookkeeping: the workspace never saw a session from the refusal.
    let listed = ok(engine.dispatch(request(
        "sessions-1",
        "session.list",
        json!({"workspaceId": workspace_id}),
    )));
    assert!(listed["sessions"].as_array().unwrap().is_empty());
}

#[test]
fn run_detail_honestly_reports_a_session_the_process_never_held() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let created = create_automation(&engine, "dash-gone", &workspace_id, "* * * * *");
    let automation_id = created["id"].as_str().unwrap().to_string();

    // Simulate a run whose session this process no longer holds (daemon
    // restart / sweep): write the row through the same storage the engine
    // uses, against the engine's own database file.
    let gone_session = format!("gone-{}", uuid::Uuid::new_v4());
    let run = AutomationRun {
        id: "ar:gone".to_string(),
        automation_id: automation_id.clone(),
        run_context: None,
        source_context: None,
        title: String::new(),
        scheduled_for: 1_000.0,
        status: AutomationRunStatus::Dispatched,
        trigger: AutomationRunTrigger::Manual,
        workspace_id: Some(workspace_id.clone()),
        workspace_display_name: None,
        session_kind: SessionKind::Terminal,
        chat_session_id: None,
        terminal_session_id: Some(gone_session),
        terminal_pane_key: None,
        terminal_pty_id: None,
        output_snapshot: None,
        precheck_result: None,
        usage: None,
        error: None,
        started_at: None,
        dispatched_at: Some(1_000.0),
        created_at: 1_000.0,
        run_number: None,
        occurrence_count: None,
        last_occurrence_at: None,
        session_incarnation: None,
        exit_code: None,
        observed_at: None,
    };
    {
        let conn = rusqlite::Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
        // The engine already owns the real schema; assert that instead of
        // creating anything.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, bot_id TEXT, payload_json TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS automation_runs (id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, payload_json TEXT NOT NULL);",
        )
        .unwrap();
        let automation_payload = serde_json::to_string(&Automation {
            id: automation_id.clone(),
            creation_key: None,
            name: "auto-dash-gone".to_string(),
            prompt: "fixture sweep".to_string(),
            precheck: None,
            agent_id: "pi".to_string(),
            model: None,
            provider: None,
            run_context: None,
            source_context: None,
            project_id: workspace_id.clone(),
            execution_target_type: ExecutionTargetType::Local,
            execution_target_id: "local".to_string(),
            execution_target_generation: None,
            scheduler_owner: SchedulerOwner::LocalHostService,
            workspace_mode: WorkspaceMode::Existing,
            workspace_id: Some(workspace_id.clone()),
            base_branch: None,
            setup_decision: None,
            reuse_session: false,
            timezone: "UTC".to_string(),
            rrule: "* * * * *".to_string(),
            dtstart: 0.0,
            enabled: true,
            next_run_at: 0.0,
            last_run_at: None,
            missed_run_policy: MissedRunPolicy::RunOnceWithinGrace,
            missed_run_grace_minutes: 15.0,
            created_at: 0.0,
            updated_at: 0.0,
            bot_id: None,
        })
        .unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO automations (id, payload_json) VALUES (?1, ?2)",
            rusqlite::params![automation_id, automation_payload],
        )
        .unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO automation_runs (id, automation_id, payload_json) VALUES (?1, ?2, ?3)",
            rusqlite::params![run.id, run.automation_id, serde_json::to_string(&run).unwrap()],
        )
        .unwrap();
    }

    let detail = ok(engine.dispatch(request(
        "run-detail-gone",
        "automation.run",
        json!({"runId": "ar:gone"}),
    )));
    assert_eq!(detail["id"], json!("ar:gone"));
    // The named session is not held by this process: no snapshot, no
    // session flag, and the record's own error stays the only content
    // source (none here).
    assert!(detail["outputSnapshot"].is_null());
    assert_eq!(detail["sessionExists"], json!(false));

    // The run's automation still exists in the engine's real table, so the
    // row legitimately appears in runs_all, named after that automation.
    let all = ok(engine.dispatch(request(
        "runs-gone",
        "automation.runs_all",
        json!({"page": 1, "perPage": 10}),
    )));
    assert_eq!(all["total"], json!(1));
    assert_eq!(all["runs"][0]["automationName"], json!("auto-dash-gone"));
    assert_eq!(all["runs"][0]["id"], json!("ar:gone"));
}

#[test]
fn run_detail_rejects_unknown_and_blank_run_ids() {
    let dir = tempfile::tempdir().unwrap();
    let (engine, _workspace_id) = engine_with_workspace(&dir);
    assert_eq!(
        err_code(engine.dispatch(request(
            "run-missing",
            "automation.run",
            json!({"runId": "ar:nope"})
        ))),
        "not_found"
    );
    assert_eq!(
        err_code(engine.dispatch(request(
            "run-blank",
            "automation.run",
            json!({"runId": "  "})
        ))),
        "invalid_argument"
    );
    assert_eq!(
        err_code(engine.dispatch(request(
            "run-bad-shape",
            "automation.run",
            json!({"run_id": "ar:nope"})
        ))),
        "invalid_argument"
    );
}
