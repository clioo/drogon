//! Tests for standalone automations (journey J7): cron evaluation at
//! fixed clocks, the bot-free prepare/record path, the `automation.*` RPCs
//! against a real `Engine`, a real scheduled fire through
//! `EngineDispatchSeam` with a fixture `pi` harness executable on `PATH`
//! (a script that prints and exits -- never real model inference), history
//! ordering, and the scheduler shutdown path.

use std::sync::Arc;
use std::time::Duration;

use drogon_core::Engine;
use drogon_core::automations::direct::{
    DirectLookupError, DirectPlan, DirectPrepareOutcome, Reschedule, prepare_direct,
    record_direct_outcome, record_skip,
};
use drogon_core::automations::execution::InvocationReason;
use drogon_core::automations::records::{
    Automation, AutomationRunStatus, AutomationRunTrigger, ExecutionTargetType, MissedRunPolicy,
    SchedulerOwner, WorkspaceMode,
};
use drogon_core::automations::runner::{
    DispatchSeamError, HarnessLaunchParams, RunRefusal, RunnerOutcome,
};
use drogon_core::automations::{runner, scheduler, storage};
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use rusqlite::Connection;
use serde_json::{Value, json};

const HOST: &str = "host-1";
const OTHER_HOST: &str = "host-2";

/// Monday 2026-09-07T00:00:00Z in millisecond epoch.
const MONDAY_MIDNIGHT_MS: f64 = 1_788_739_200_000.0;

const WORKSPACES_DDL: &str = "CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    host_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);";

fn mem_conn() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    storage::migrate(&c).unwrap();
    c.execute_batch(WORKSPACES_DDL).unwrap();
    c
}

fn insert_workspace(conn: &Connection, id: &str, host_id: &str) {
    conn.execute(
        "INSERT INTO workspaces (id, path, name, kind, host_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, format!("/workspaces/{id}"), id, "folder", host_id, "2026-09-07T00:00:00Z"],
    )
    .unwrap();
}

fn sample_automation(id: &str) -> Automation {
    Automation {
        id: id.to_string(),
        creation_key: None,
        name: "nightly sweep".to_string(),
        prompt: "do the thing".to_string(),
        precheck: None,
        agent_id: "pi".to_string(),
        run_context: None,
        source_context: None,
        project_id: "w1".to_string(),
        execution_target_type: ExecutionTargetType::Local,
        execution_target_id: HOST.to_string(),
        execution_target_generation: None,
        scheduler_owner: SchedulerOwner::LocalHostService,
        workspace_mode: WorkspaceMode::Existing,
        workspace_id: Some("w1".to_string()),
        base_branch: None,
        setup_decision: None,
        reuse_session: false,
        timezone: "UTC".to_string(),
        rrule: "* * * * *".to_string(),
        dtstart: 0.0,
        enabled: true,
        next_run_at: 1000.0,
        last_run_at: None,
        missed_run_policy: MissedRunPolicy::RunOnceWithinGrace,
        missed_run_grace_minutes: 15.0,
        created_at: 0.0,
        updated_at: 0.0,
        bot_id: None,
    }
}

fn harness_params() -> HarnessLaunchParams {
    HarnessLaunchParams {
        harness_id: "pi".to_string(),
        model: None,
        effort: None,
        provider: None,
        permission_mode: None,
        headless: false,
    }
}

// --- Cron validation -----------------------------------------------------

#[test]
fn validate_cron_accepts_standard_five_field_expressions() {
    for expr in [
        "* * * * *",
        "*/15 * * * *",
        "0 9 * * MON",
        "30 8 * * 1-5",
        "0 0 1 * *",
        "  * * * * *  ",
    ] {
        assert!(scheduler::validate_cron(expr).is_ok(), "{expr}");
    }
    assert_eq!(
        scheduler::validate_cron("  * * * * *  ").unwrap(),
        "* * * * *"
    );
}

#[test]
fn validate_cron_rejects_garbage_legacy_rrule_and_oversize() {
    assert!(scheduler::validate_cron("").is_err());
    assert!(scheduler::validate_cron("   ").is_err());
    assert!(scheduler::validate_cron("not a cron").is_err());
    assert!(scheduler::validate_cron("* * *").is_err());
    // Legacy RRULE rows from the Bot flow are not cron schedules.
    assert!(scheduler::validate_cron("FREQ=DAILY").is_err());
    assert!(scheduler::validate_cron("FREQ=HOURLY;BYMINUTE=5").is_err());
    let huge = "* ".repeat(200);
    assert!(scheduler::validate_cron(&huge).is_err());
}

#[test]
fn is_cron_schedule_distinguishes_cron_from_legacy_rrule() {
    assert!(scheduler::is_cron_schedule("* * * * *"));
    assert!(!scheduler::is_cron_schedule("FREQ=DAILY"));
}

// --- Cron fire times at fixed clocks --------------------------------------

#[test]
fn every_minute_fires_at_the_next_minute_boundary() {
    // 12:34:56.789 UTC -> next fire is exactly 12:35:00.000 UTC.
    let after = MONDAY_MIDNIGHT_MS + ((12 * 60 + 34) * 60 + 56) as f64 * 1000.0 + 789.0;
    let expected = MONDAY_MIDNIGHT_MS + ((12 * 60 + 35) * 60) as f64 * 1000.0;
    assert_eq!(
        scheduler::next_fire_ms("* * * * *", after),
        Some(expected as i64)
    );
}

#[test]
fn daily_schedule_fires_at_that_utc_wall_time() {
    // Monday 00:00 UTC -> "30 8 * * *" fires Monday 08:30 UTC.
    let expected_ms = (1_788_739_200_i64 + 8 * 3600 + 30 * 60) * 1000;
    assert_eq!(
        scheduler::next_fire_ms("30 8 * * *", MONDAY_MIDNIGHT_MS),
        Some(expected_ms)
    );
}

#[test]
fn weekly_monday_schedule_from_monday_midnight_fires_same_day() {
    let expected_ms = (1_788_739_200_i64 + 9 * 3600) * 1000;
    assert_eq!(
        scheduler::next_fire_ms("0 9 * * MON", MONDAY_MIDNIGHT_MS),
        Some(expected_ms)
    );
}

#[test]
fn weekday_schedule_skips_the_weekend() {
    // Friday 2026-09-11T10:00Z with "0 9 * * MON-FRI": next fire is Monday
    // 2026-09-14T09:00Z.
    let friday_10 = (1_788_739_200_i64 + 4 * 86_400 + 10 * 3600) * 1000;
    let monday_9 = (1_788_739_200_i64 + 7 * 86_400 + 9 * 3600) * 1000;
    assert_eq!(
        scheduler::next_fire_ms("0 9 * * MON-FRI", friday_10 as f64),
        Some(monday_9)
    );
}

#[test]
fn invalid_expression_has_no_next_fire() {
    assert_eq!(
        scheduler::next_fire_ms("FREQ=DAILY", MONDAY_MIDNIGHT_MS),
        None
    );
    assert_eq!(scheduler::next_fire_ms("bogus", MONDAY_MIDNIGHT_MS), None);
}

// --- Due evaluation ---------------------------------------------------------

#[test]
fn is_due_requires_enabled_cron_and_a_passed_slot() {
    let mut automation = sample_automation("a1");
    automation.next_run_at = 1000.0;
    assert!(scheduler::is_due(&automation, 1000.0));
    assert!(scheduler::is_due(&automation, 60_000.0));
    assert!(!scheduler::is_due(&automation, 999.0));

    automation.enabled = false;
    assert!(!scheduler::is_due(&automation, 60_000.0));
    automation.enabled = true;

    automation.rrule = "FREQ=DAILY".to_string();
    assert!(!scheduler::is_due(&automation, 60_000.0));
    automation.rrule = "* * * * *".to_string();

    automation.dtstart = 120_000.0;
    assert!(!scheduler::is_due(&automation, 60_000.0));
    assert!(scheduler::is_due(&automation, 120_000.0));
}

// --- Bot-free prepare/record on a raw connection ------------------------------

fn ready_direct(outcome: DirectPrepareOutcome) -> DirectPlan {
    match outcome {
        DirectPrepareOutcome::Ready(plan) => plan,
        other => panic!("expected Ready, got {other:?}"),
    }
}

#[test]
fn prepare_direct_refuses_disabled_without_touching_a_seam() {
    let c = mem_conn();
    insert_workspace(&c, "w1", HOST);
    let mut automation = sample_automation("a1");
    automation.enabled = false;
    storage::upsert_automation(&c, &automation).unwrap();

    let outcome = prepare_direct(
        &c,
        HOST,
        "a1",
        &InvocationReason::ScheduledDue,
        AutomationRunTrigger::Scheduled,
        "slot-1",
        &harness_params(),
        2000.0,
    )
    .unwrap();
    assert!(matches!(
        outcome,
        DirectPrepareOutcome::Refused(RunRefusal::Automation(_))
    ));
}

#[test]
fn prepare_direct_refuses_unknown_and_foreign_workspaces() {
    let c = mem_conn();
    insert_workspace(&c, "w1", OTHER_HOST);
    let automation = sample_automation("a1");
    storage::upsert_automation(&c, &automation).unwrap();

    // w1 exists but belongs to another host.
    let outcome = prepare_direct(
        &c,
        HOST,
        "a1",
        &InvocationReason::Manual,
        AutomationRunTrigger::Manual,
        "m-1",
        &harness_params(),
        2000.0,
    )
    .unwrap();
    assert!(matches!(
        outcome,
        DirectPrepareOutcome::Refused(RunRefusal::ForeignWorkspaceHost { .. })
    ));

    // Ghost workspace id.
    let mut automation = sample_automation("a2");
    automation.workspace_id = Some("ghost".to_string());
    storage::upsert_automation(&c, &automation).unwrap();
    let outcome = prepare_direct(
        &c,
        HOST,
        "a2",
        &InvocationReason::Manual,
        AutomationRunTrigger::Manual,
        "m-2",
        &harness_params(),
        2000.0,
    )
    .unwrap();
    assert_eq!(
        outcome,
        DirectPrepareOutcome::Refused(RunRefusal::UnknownWorkspace("ghost".to_string()))
    );
}

#[test]
fn prepare_direct_supports_new_per_run_is_unsupported_and_missing_is_an_error() {
    let c = mem_conn();
    let mut automation = sample_automation("a1");
    automation.workspace_mode = WorkspaceMode::NewPerRun;
    automation.workspace_id = None;
    storage::upsert_automation(&c, &automation).unwrap();
    let outcome = prepare_direct(
        &c,
        HOST,
        "a1",
        &InvocationReason::ScheduledDue,
        AutomationRunTrigger::Scheduled,
        "slot-1",
        &harness_params(),
        2000.0,
    )
    .unwrap();
    assert!(matches!(
        outcome,
        DirectPrepareOutcome::Unsupported(runner::RunUnsupported::NewPerRunWorkspaceMode)
    ));

    let missing = prepare_direct(
        &c,
        HOST,
        "nope",
        &InvocationReason::Manual,
        AutomationRunTrigger::Manual,
        "m-1",
        &harness_params(),
        2000.0,
    );
    assert!(matches!(missing, Err(DirectLookupError::Missing)));
}

#[test]
fn ready_direct_plan_carries_harness_start_params() {
    let c = mem_conn();
    insert_workspace(&c, "w1", HOST);
    let automation = sample_automation("a1");
    storage::upsert_automation(&c, &automation).unwrap();
    let plan = ready_direct(
        prepare_direct(
            &c,
            HOST,
            "a1",
            &InvocationReason::ScheduledDue,
            AutomationRunTrigger::Scheduled,
            "slot-1",
            &harness_params(),
            2000.0,
        )
        .unwrap(),
    );
    assert_eq!(plan.automation_id, "a1");
    assert_eq!(plan.workspace_id, "w1");
    assert_eq!(plan.params["workspaceId"], json!("w1"));
    assert_eq!(plan.params["harnessId"], json!("pi"));
    assert_eq!(plan.params["prompt"], json!("do the thing"));
    assert!(plan.request_id.starts_with("automation-run:"));
}

#[test]
fn headless_direct_runs_carry_the_headless_flag_into_harness_start() {
    let c = mem_conn();
    insert_workspace(&c, "w1", HOST);
    let automation = sample_automation("a1");
    storage::upsert_automation(&c, &automation).unwrap();
    let mut headless = harness_params();
    headless.headless = true;
    let plan = ready_direct(
        prepare_direct(
            &c,
            HOST,
            "a1",
            &InvocationReason::ScheduledDue,
            AutomationRunTrigger::Scheduled,
            "slot-1",
            &headless,
            2000.0,
        )
        .unwrap(),
    );
    assert_eq!(plan.params["headless"], json!(true));
}

#[test]
fn record_direct_outcome_maps_verdicts_and_advances_the_schedule() {
    let c = mem_conn();
    insert_workspace(&c, "w1", HOST);
    let automation = sample_automation("a1");
    storage::upsert_automation(&c, &automation).unwrap();
    let plan = ready_direct(
        prepare_direct(
            &c,
            HOST,
            "a1",
            &InvocationReason::Manual,
            AutomationRunTrigger::Manual,
            "m-1",
            &harness_params(),
            2000.0,
        )
        .unwrap(),
    );
    let reschedule = Reschedule {
        next_run_at: 61_000.0,
        last_run_at: Some(2000.0),
    };
    let run_id = record_direct_outcome(
        &c,
        &plan,
        &RunnerOutcome::Observed {
            session_id: "s1".to_string(),
            incarnation: "i1".to_string(),
            verdict: "exited".to_string(),
            exit_code: Some(0),
        },
        2500.0,
        reschedule,
    )
    .unwrap();
    assert_eq!(run_id, format!("ar:{}", plan.request_id));
    let run = storage::get_automation_run(&c, &run_id).unwrap().unwrap();
    assert_eq!(run.status, AutomationRunStatus::Completed);
    assert_eq!(run.trigger, AutomationRunTrigger::Manual);
    assert_eq!(run.exit_code, Some(0));
    let updated = storage::get_automation(&c, "a1").unwrap().unwrap();
    assert_eq!(updated.next_run_at, 61_000.0);
    assert_eq!(updated.last_run_at, Some(2000.0));

    // A later live observation for the same stable run id never regresses
    // a proven Completed.
    let run_id_again = record_direct_outcome(
        &c,
        &plan,
        &RunnerOutcome::Observed {
            session_id: "s1".to_string(),
            incarnation: "i1".to_string(),
            verdict: "live".to_string(),
            exit_code: None,
        },
        3000.0,
        Reschedule {
            next_run_at: 121_000.0,
            last_run_at: None,
        },
    )
    .unwrap();
    assert_eq!(run_id_again, run_id);
    let kept = storage::get_automation_run(&c, &run_id).unwrap().unwrap();
    assert_eq!(kept.status, AutomationRunStatus::Completed);
}

#[test]
fn record_direct_outcome_marks_failed_dispatches() {
    let c = mem_conn();
    insert_workspace(&c, "w1", HOST);
    let automation = sample_automation("a1");
    storage::upsert_automation(&c, &automation).unwrap();
    let plan = ready_direct(
        prepare_direct(
            &c,
            HOST,
            "a1",
            &InvocationReason::Manual,
            AutomationRunTrigger::Manual,
            "m-9",
            &harness_params(),
            2000.0,
        )
        .unwrap(),
    );
    let run_id = record_direct_outcome(
        &c,
        &plan,
        &RunnerOutcome::DispatchFailed(DispatchSeamError {
            code: "not_found".to_string(),
            message: "Harness is not installed".to_string(),
        }),
        2500.0,
        Reschedule {
            next_run_at: 61_000.0,
            last_run_at: Some(2000.0),
        },
    )
    .unwrap();
    let run = storage::get_automation_run(&c, &run_id).unwrap().unwrap();
    assert_eq!(run.status, AutomationRunStatus::DispatchFailed);
    assert!(run.error.unwrap().contains("not installed"));
    assert!(run.terminal_session_id.is_none());
}

#[test]
fn record_skip_writes_a_skipped_row_and_reschedules() {
    let c = mem_conn();
    let automation = sample_automation("a1");
    storage::upsert_automation(&c, &automation).unwrap();
    let run_id = record_skip(
        &c,
        "a1",
        "req-skip-1",
        AutomationRunTrigger::Scheduled,
        AutomationRunStatus::SkippedMissed,
        Some("past grace".to_string()),
        1000.0,
        5_000.0,
        Reschedule {
            next_run_at: 61_000.0,
            last_run_at: None,
        },
    )
    .unwrap();
    assert_eq!(run_id, "ar:req-skip-1");
    let run = storage::get_automation_run(&c, &run_id).unwrap().unwrap();
    assert_eq!(run.status, AutomationRunStatus::SkippedMissed);
    let updated = storage::get_automation(&c, "a1").unwrap().unwrap();
    assert_eq!(updated.next_run_at, 61_000.0);
    assert_eq!(updated.last_run_at, None);
}

// --- Real-Engine RPC tests ----------------------------------------------------

fn request(id: &str, method: &str, params: Value) -> Request {
    Request {
        protocol: PROTOCOL_VERSION,
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

fn engine_with_workspace(dir: &tempfile::TempDir) -> (Engine, String) {
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
/// exits 0 -- the demo harness, never real model inference. Prepended once
/// per test process (idempotent: every writer sets the same value).
fn ensure_fixture_harness_on_path() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let dir =
            std::env::temp_dir().join(format!("drogon-automation-fixture-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pi = dir.join("pi");
        std::fs::write(&pi, "#!/bin/sh\necho automation-fixture-output\nexit 0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&pi, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let old = std::env::var_os("PATH").unwrap_or_default();
        let mut paths = vec![dir.into_os_string()];
        paths.extend(std::env::split_paths(&old).map(|p| p.into_os_string()));
        // Single writer (this `Once`), same value on every write; no test
        // in this process reads a different PATH concurrently.
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

#[test]
fn create_list_update_delete_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);

    let created = create_automation(&engine, "create-1", &workspace_id, "* * * * *");
    let automation_id = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["name"], json!("auto-create-1"));
    assert_eq!(created["cron"], json!("* * * * *"));
    assert_eq!(created["harness"], json!("pi"));
    assert!(created["nextRunAt"].as_f64().unwrap() > 0.0);
    assert!(created.get("lastRun").unwrap().is_null());

    let listed = ok(engine.dispatch(request("list-1", "automation.list", json!({}))));
    let items = listed["automations"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], json!(automation_id));
    assert!(items[0].get("nextRunAt").unwrap().is_number());

    let updated = ok(engine.dispatch(request(
        "update-1",
        "automation.update",
        json!({"id": automation_id, "name": "renamed", "enabled": false}),
    )));
    assert_eq!(updated["name"], json!("renamed"));
    assert_eq!(updated["enabled"], json!(false));

    let deleted = ok(engine.dispatch(request(
        "delete-1",
        "automation.delete",
        json!({"id": automation_id}),
    )));
    assert_eq!(deleted["id"], json!(automation_id));
    let listed = ok(engine.dispatch(request("list-2", "automation.list", json!({}))));
    assert!(listed["automations"].as_array().unwrap().is_empty());
    // Runs cascade with the automation: history is gone too.
    assert_eq!(
        err_code(engine.dispatch(request(
            "hist-gone",
            "automation.history",
            json!({"automationId": automation_id})
        ))),
        "not_found"
    );
}

#[test]
fn create_rejects_bad_input_and_update_delete_reject_missing() {
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);

    // Bad cron.
    assert_eq!(
        err_code(engine.dispatch(request(
            "bad-cron",
            "automation.create",
            json!({"name": "x", "cron": "FREQ=DAILY", "workspaceId": workspace_id,
                   "harness": "pi", "prompt": "p"}),
        ))),
        "invalid_argument"
    );
    // Unknown harness.
    assert_eq!(
        err_code(engine.dispatch(request(
            "bad-harness",
            "automation.create",
            json!({"name": "x", "cron": "* * * * *", "workspaceId": workspace_id,
                   "harness": "nope", "prompt": "p"}),
        ))),
        "invalid_argument"
    );
    // Unknown workspace.
    assert_eq!(
        err_code(engine.dispatch(request(
            "bad-ws",
            "automation.create",
            json!({"name": "x", "cron": "* * * * *", "workspaceId": "ghost",
                   "harness": "pi", "prompt": "p"}),
        ))),
        "not_found"
    );
    // Unknown top-level field is denied.
    assert_eq!(
        err_code(engine.dispatch(request(
            "bad-field",
            "automation.create",
            json!({"name": "x", "cron": "* * * * *", "workspaceId": workspace_id,
                   "harness": "pi", "prompt": "p", "timezone": "UTC"}),
        ))),
        "invalid_argument"
    );
    // Missing rows.
    assert_eq!(
        err_code(engine.dispatch(request(
            "upd-missing",
            "automation.update",
            json!({"id": "ghost", "name": "y"}),
        ))),
        "not_found"
    );
    assert_eq!(
        err_code(engine.dispatch(request(
            "del-missing",
            "automation.delete",
            json!({"id": "ghost"}),
        ))),
        "not_found"
    );
    assert_eq!(
        err_code(engine.dispatch(request(
            "run-missing",
            "automation.run_now",
            json!({"id": "ghost"}),
        ))),
        "not_found"
    );
    // History limit bounds.
    let created = create_automation(&engine, "lim-1", &workspace_id, "* * * * *");
    let automation_id = created["id"].as_str().unwrap();
    assert_eq!(
        err_code(engine.dispatch(request(
            "hist-zero",
            "automation.history",
            json!({"automationId": automation_id, "limit": 0}),
        ))),
        "invalid_argument"
    );
    assert_eq!(
        err_code(engine.dispatch(request(
            "hist-huge",
            "automation.history",
            json!({"automationId": automation_id, "limit": 9999}),
        ))),
        "invalid_argument"
    );
    let history = ok(engine.dispatch(request(
        "hist-ok",
        "automation.history",
        json!({"automationId": automation_id, "limit": 10}),
    )));
    assert!(history["runs"].as_array().unwrap().is_empty());
}

/// Polls `session.list` until the session reaches `exited` (or the
/// deadline passes): proves the fixture process really ran to completion.
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

#[test]
fn run_now_dispatches_through_the_seam_with_the_fixture_harness() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let created = create_automation(&engine, "run-1", &workspace_id, "* * * * *");
    let automation_id = created["id"].as_str().unwrap().to_string();

    let result = ok(engine.dispatch(request(
        "run-now-1",
        "automation.run_now",
        json!({"id": automation_id}),
    )));
    assert_eq!(result["automationId"], json!(automation_id));
    assert_eq!(result["outcome"], json!("dispatched"));
    let status = result["status"].as_str().unwrap().to_string();
    assert!(
        status == "dispatched" || status == "completed",
        "unexpected status {status}"
    );

    let history = ok(engine.dispatch(request(
        "hist-1",
        "automation.history",
        json!({"automationId": automation_id}),
    )));
    let runs = history["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["trigger"], json!("manual"));
    let session_id = runs[0]["terminalSessionId"].as_str().unwrap().to_string();
    assert!(
        poll_session_exited(&engine, &workspace_id, &session_id),
        "the fixture harness session never reached exited"
    );
}

#[test]
fn run_now_on_a_disabled_automation_records_a_refusal() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let created = create_automation(&engine, "run-dis", &workspace_id, "* * * * *");
    let automation_id = created["id"].as_str().unwrap().to_string();
    ok(engine.dispatch(request(
        "dis-1",
        "automation.update",
        json!({"id": automation_id, "enabled": false}),
    )));

    let result = ok(engine.dispatch(request(
        "run-dis-1",
        "automation.run_now",
        json!({"id": automation_id}),
    )));
    assert_eq!(result["outcome"], json!("refused"));
    assert!(result["runId"].as_str().is_some());

    let history = ok(engine.dispatch(request(
        "hist-dis",
        "automation.history",
        json!({"automationId": automation_id}),
    )));
    let runs = history["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["status"], json!("skipped_unavailable"));
}

#[test]
fn tick_fires_a_due_schedule_exactly_once_per_slot() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let created = create_automation(&engine, "tick-1", &workspace_id, "* * * * *");
    let automation_id = created["id"].as_str().unwrap().to_string();
    let slot = created["nextRunAt"].as_f64().unwrap();

    // Just after the slot, inside the 15-minute grace: fires.
    let summary = scheduler::tick_once(&engine, slot + 30_000.0);
    assert_eq!(summary.fired, 1);
    assert_eq!(summary.failed, 0);

    // Same clock again: rescheduled past now, so nothing is due.
    let summary = scheduler::tick_once(&engine, slot + 30_000.0);
    assert_eq!(summary.fired, 0);

    let history = ok(engine.dispatch(request(
        "hist-tick",
        "automation.history",
        json!({"automationId": automation_id}),
    )));
    let runs = history["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["trigger"], json!("scheduled"));

    // The stored row advanced past the fired slot.
    let listed = ok(engine.dispatch(request("list-tick", "automation.list", json!({}))));
    let item = &listed["automations"].as_array().unwrap()[0];
    assert!(item["nextRunAt"].as_f64().unwrap() > slot);
    assert!(item["lastRunAt"].as_f64().unwrap() >= slot);
    assert!(item["lastRun"].is_object());
}

#[test]
fn tick_skips_a_slot_past_grace_without_dispatching() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let created = create_automation(&engine, "tick-missed", &workspace_id, "* * * * *");
    let automation_id = created["id"].as_str().unwrap().to_string();
    let slot = created["nextRunAt"].as_f64().unwrap();

    // 15-minute default grace + one hour: missed, never dispatched.
    let summary = scheduler::tick_once(&engine, slot + 16.0 * 60.0 * 1000.0 + 60_000.0);
    assert_eq!(summary.skipped_missed, 1);
    assert_eq!(summary.fired, 0);

    let history = ok(engine.dispatch(request(
        "hist-missed",
        "automation.history",
        json!({"automationId": automation_id}),
    )));
    let runs = history["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["status"], json!("skipped_missed"));
    assert!(runs[0].get("terminalSessionId").unwrap().is_null());
}

#[test]
fn history_orders_newest_first_and_respects_limit() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let created = create_automation(&engine, "hist-ord", &workspace_id, "* * * * *");
    let automation_id = created["id"].as_str().unwrap().to_string();

    for i in 0..3 {
        ok(engine.dispatch(request(
            &format!("ord-run-{i}"),
            "automation.run_now",
            json!({"id": automation_id}),
        )));
        std::thread::sleep(Duration::from_millis(5));
    }
    let history = ok(engine.dispatch(request(
        "hist-ord-full",
        "automation.history",
        json!({"automationId": automation_id}),
    )));
    let runs = history["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 3);
    let times: Vec<f64> = runs
        .iter()
        .map(|r| r["createdAt"].as_f64().unwrap())
        .collect();
    assert!(
        times[0] >= times[1] && times[1] >= times[2],
        "history must be newest-first: {times:?}"
    );
    let limited = ok(engine.dispatch(request(
        "hist-ord-one",
        "automation.history",
        json!({"automationId": automation_id, "limit": 1}),
    )));
    let runs = limited["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["createdAt"].as_f64().unwrap(), times[0]);
}

#[test]
fn quiescent_engine_never_fires_and_scheduler_handle_shuts_down() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let created = create_automation(&engine, "quies-1", &workspace_id, "* * * * *");
    let slot = created["nextRunAt"].as_f64().unwrap();

    // Start the background loop, then stop it: shutdown must join promptly.
    let engine = Arc::new(engine);
    let mut handle = scheduler::spawn(engine.clone(), Duration::from_millis(20));
    std::thread::sleep(Duration::from_millis(150));
    handle.shutdown();
    assert!(handle.is_stopped());

    // Freeze admission via a real shutdown receipt, then prove the tick is
    // a no-op even for a due slot.
    let status = ok(engine.dispatch(request("st-1", "status", json!({}))));
    let shutdown = ok(engine.dispatch(request(
        "shut-1",
        "runtime.shutdown",
        json!({
            "hostId": status["hostId"],
            "serviceInstanceId": status["serviceInstanceId"],
        }),
    )));
    assert_eq!(shutdown["accepted"], json!(true));
    let summary = scheduler::tick_once(&engine, slot + 30_000.0);
    assert_eq!(summary, scheduler::TickSummary::default());
}
