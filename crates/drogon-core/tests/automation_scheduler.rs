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
    DirectLookupError, DirectPlan, DirectPrepareOutcome, ReconcileOutcome, Reschedule,
    SessionEvidence, apply_reconcile, prepare_direct, reconcile_decision, record_direct_outcome,
    record_skip,
};
use drogon_core::automations::execution::InvocationReason;
use drogon_core::automations::records::{
    Automation, AutomationRun, AutomationRunStatus, AutomationRunTrigger, ExecutionTargetType,
    MissedRunPolicy, SchedulerOwner, SessionKind, WorkspaceMode,
};
use drogon_core::automations::runner::{
    DispatchSeamError, HarnessLaunchParams, RunRefusal, RunnerOutcome,
};
use drogon_core::automations::{runner, scheduler, storage};
use drogon_core::bots::records::{
    Bot, DisplayIdentity, HarnessModelPolicy, Responsibility, ResponsibilityKind,
    ResponsibilityTrigger,
};
use drogon_core::bots::storage as bots_storage;
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
        model: None,
        provider: None,
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

// --- Bot-owned dispatch harness resolution (issue #188) --------------------

fn mem_conn_with_bots() -> Connection {
    let conn = mem_conn();
    bots_storage::migrate(&conn).unwrap();
    conn
}

/// A Pi bot whose scheduled responsibility owns `automation_id`, stored
/// with the workspace path `insert_workspace` uses so the scope matches.
fn insert_pi_bot(
    conn: &Connection,
    bot_id: &str,
    automation_id: &str,
    explicit_model: Option<&str>,
) {
    let bot = Bot {
        id: bot_id.to_string(),
        character_preset: "none".to_string(),
        display_identity: DisplayIdentity {
            display_name: "Sparky".to_string(),
            handle: None,
            title: None,
        },
        harness_policy: HarnessModelPolicy {
            default_harness: "pi".to_string(),
            explicit_model: explicit_model.map(str::to_string),
        },
        instructions: String::new(),
        memories: Vec::new(),
        responsibilities: vec![Responsibility {
            id: format!("resp-{bot_id}"),
            name: "sweep".to_string(),
            instructions: String::new(),
            kind: ResponsibilityKind::Scheduled,
            trigger: ResponsibilityTrigger::Scheduled {
                automation_id: automation_id.to_string(),
            },
            enabled: true,
            recipe: None,
            created_at: 0.0,
            updated_at: 0.0,
        }],
        current_session: None,
        created_at: 0.0,
        updated_at: 0.0,
    };
    bots_storage::create_bot(conn, HOST, "/workspaces/w1", &bot).unwrap();
}

/// The launch params the scheduler tick and `automation.run_now` build
/// from a stored row (`harness_for`): the row's own pins, nothing else.
fn row_harness_params(automation: &Automation, headless: bool) -> HarnessLaunchParams {
    HarnessLaunchParams {
        harness_id: automation.agent_id.clone(),
        model: automation.model.clone(),
        effort: None,
        provider: automation.provider.clone(),
        permission_mode: None,
        headless,
    }
}

fn bot_owned_automation(id: &str, bot_id: &str) -> Automation {
    Automation {
        bot_id: Some(bot_id.to_string()),
        ..sample_automation(id)
    }
}

fn prepare(conn: &Connection, automation_id: &str, params: &HarnessLaunchParams) -> DirectPlan {
    ready_direct(
        prepare_direct(
            conn,
            HOST,
            automation_id,
            &InvocationReason::ScheduledDue,
            AutomationRunTrigger::Scheduled,
            "slot-1",
            params,
            2000.0,
        )
        .unwrap(),
    )
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

fn base64_decode(text: &str) -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .unwrap()
}

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
        // The argv echo proves which launcher flags a dispatch really
        // carried (e.g. pinned `--model`/`--provider`); no test asserts
        // the bare marker alone, so extending the line is safe.
        std::fs::write(
            &pi,
            "#!/bin/sh\necho \"automation-fixture-output ARGS:$@\"\nexit 0\n",
        )
        .unwrap();
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

/// Polls `automation.run` until the honest output snapshot contains the
/// needle (or the deadline passes): proves the run's session really
/// produced the fixture output the daemon reports.
fn poll_run_snapshot(engine: &Engine, run_id: &str, needle: &str) -> bool {
    for _ in 0..100 {
        let detail = ok(engine.dispatch(request(
            &uuid::Uuid::new_v4().to_string(),
            "automation.run",
            json!({"runId": run_id}),
        )));
        if detail["outputSnapshot"]
            .as_object()
            .is_some_and(|snapshot| {
                snapshot["content"]
                    .as_str()
                    .is_some_and(|content| content.contains(needle))
            })
        {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

#[test]
fn create_update_pin_model_provider_and_surface_them() {
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);

    let created = ok(engine.dispatch(request(
        "pin-1",
        "automation.create",
        json!({"name": "pinned", "cron": "* * * * *", "workspaceId": workspace_id,
               "harness": "pi", "prompt": "p",
               "model": "fixture-model", "provider": "dgx-spark"}),
    )));
    let automation_id = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["model"], json!("fixture-model"));
    assert_eq!(created["provider"], json!("dgx-spark"));
    let listed = ok(engine.dispatch(request("pin-list", "automation.list", json!({}))));
    let item = &listed["automations"].as_array().unwrap()[0];
    assert_eq!(item["model"], json!("fixture-model"));
    assert_eq!(item["provider"], json!("dgx-spark"));

    // No pin: the summary omits both keys rather than nulling them.
    let bare = create_automation(&engine, "pin-bare", &workspace_id, "* * * * *");
    assert!(bare.get("model").is_none());
    assert!(bare.get("provider").is_none());

    // Update pins both onto an existing automation.
    let bare_id = bare["id"].as_str().unwrap();
    let updated = ok(engine.dispatch(request(
        "pin-2",
        "automation.update",
        json!({"id": bare_id, "model": "late-model", "provider": "dgx-spark"}),
    )));
    assert_eq!(updated["model"], json!("late-model"));
    assert_eq!(updated["provider"], json!("dgx-spark"));

    // Moving a provider-pinned automation off pi is refused: the stored
    // provider could only DispatchFailed there.
    assert_eq!(
        err_code(engine.dispatch(request(
            "pin-3",
            "automation.update",
            json!({"id": automation_id, "harness": "claude"}),
        ))),
        "invalid_argument"
    );
}

#[test]
fn create_update_reject_bad_model_provider() {
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let bad = vec![
        ("empty-model", json!({"model": ""})),
        ("flag-model", json!({"model": "--model=x"})),
        ("long-model", json!({"model": "m".repeat(513)})),
        (
            "provider-on-claude",
            json!({"harness": "claude", "provider": "dgx-spark"}),
        ),
    ];
    for (tag, extra) in bad {
        let mut params = json!({"name": format!("bad-{tag}"), "cron": "* * * * *",
                                "workspaceId": workspace_id, "harness": "pi", "prompt": "p"});
        for (key, value) in extra.as_object().unwrap() {
            params
                .as_object_mut()
                .unwrap()
                .insert(key.clone(), value.clone());
        }
        assert_eq!(
            err_code(engine.dispatch(request(tag, "automation.create", params))),
            "invalid_argument",
            "{tag} must be refused"
        );
    }
    // Provider on update against a non-pi automation is refused too.
    let created = create_automation(&engine, "pin-claude", &workspace_id, "* * * * *");
    let claude_id = created["id"].as_str().unwrap();
    ok(engine.dispatch(request(
        "pin-harness",
        "automation.update",
        json!({"id": claude_id, "harness": "claude"}),
    )));
    assert_eq!(
        err_code(engine.dispatch(request(
            "pin-bad-upd",
            "automation.update",
            json!({"id": claude_id, "provider": "dgx-spark"}),
        ))),
        "invalid_argument"
    );
}

#[test]
fn run_now_launches_with_the_pinned_model_provider() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let created = ok(engine.dispatch(request(
        "pin-run-create",
        "automation.create",
        json!({"name": "pinned-run", "cron": "* * * * *", "workspaceId": workspace_id,
               "harness": "pi", "prompt": "p",
               "model": "fixture-model", "provider": "dgx-spark"}),
    )));
    let automation_id = created["id"].as_str().unwrap().to_string();

    let result = ok(engine.dispatch(request(
        "pin-run-now",
        "automation.run_now",
        json!({"id": automation_id}),
    )));
    assert_eq!(result["outcome"], json!("dispatched"));
    let run_id = result["runId"].as_str().unwrap().to_string();
    let history = ok(engine.dispatch(request(
        "pin-run-hist",
        "automation.history",
        json!({"automationId": automation_id}),
    )));
    let session_id = history["runs"][0]["terminalSessionId"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(poll_session_exited(&engine, &workspace_id, &session_id));
    // The fixture echoed its real argv: the pinned flags reached the
    // launcher, and the run detail honestly reports that output.
    assert!(
        poll_run_snapshot(&engine, &run_id, "--model fixture-model"),
        "run snapshot never showed the pinned model flag"
    );
    assert!(
        poll_run_snapshot(&engine, &run_id, "--provider dgx-spark"),
        "run snapshot never showed the pinned provider flag"
    );
}

#[test]
fn tick_fires_with_the_pinned_model_provider() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let created = ok(engine.dispatch(request(
        "pin-tick-create",
        "automation.create",
        json!({"name": "pinned-tick", "cron": "* * * * *", "workspaceId": workspace_id,
               "harness": "pi", "prompt": "p",
               "model": "fixture-model", "provider": "dgx-spark"}),
    )));
    let automation_id = created["id"].as_str().unwrap().to_string();
    let slot = created["nextRunAt"].as_f64().unwrap();

    let summary = scheduler::tick_once(&engine, slot + 30_000.0);
    assert_eq!(summary.fired, 1);
    assert_eq!(summary.failed, 0);
    let history = ok(engine.dispatch(request(
        "pin-tick-hist",
        "automation.history",
        json!({"automationId": automation_id}),
    )));
    let run_id = history["runs"][0]["id"].as_str().unwrap().to_string();
    assert!(
        poll_run_snapshot(&engine, &run_id, "--model fixture-model"),
        "scheduled run snapshot never showed the pinned model flag"
    );
}

fn sample_run(id: &str, automation_id: &str) -> AutomationRun {
    AutomationRun {
        id: id.to_string(),
        automation_id: automation_id.to_string(),
        run_context: None,
        source_context: None,
        title: String::new(),
        scheduled_for: 1_000.0,
        status: AutomationRunStatus::Dispatched,
        trigger: AutomationRunTrigger::Manual,
        workspace_id: Some("w1".to_string()),
        workspace_display_name: None,
        session_kind: SessionKind::Terminal,
        chat_session_id: None,
        terminal_session_id: Some("s1".to_string()),
        terminal_pane_key: None,
        terminal_pty_id: None,
        output_snapshot: None,
        precheck_result: None,
        usage: None,
        error: None,
        started_at: Some(1_000.0),
        dispatched_at: Some(1_000.0),
        created_at: 1_000.0,
        run_number: None,
        occurrence_count: None,
        last_occurrence_at: None,
        session_incarnation: Some("inc-1".to_string()),
        exit_code: None,
        observed_at: Some(1_000.0),
    }
}

fn live_evidence(agent_state: &str, agent_state_at: Option<&str>) -> SessionEvidence {
    SessionEvidence {
        verdict: "live".to_string(),
        exit_code: None,
        agent_state: agent_state.to_string(),
        agent_state_at: agent_state_at.map(str::to_string),
        incarnation: "inc-1".to_string(),
    }
}

/// 1970-01-01T00:00:01Z: one second after the sample run's dispatch, so a
/// wait-signal stamped then provably postdates it.
const SIGNAL_AFTER_DISPATCH: &str = "1970-01-01T00:00:01Z";

#[test]
fn reconcile_decision_finalizes_only_on_proven_terminal_evidence() {
    let run = sample_run("ar:1", "a1");
    // Exited sessions finalize with the reaped code (or none).
    assert_eq!(
        reconcile_decision(
            &run,
            Some(&SessionEvidence {
                verdict: "exited".to_string(),
                exit_code: Some(0),
                agent_state: "exited".to_string(),
                agent_state_at: None,
                incarnation: "inc-1".to_string(),
            })
        ),
        ReconcileOutcome::Exited { exit_code: Some(0) }
    );
    // A live working agent is still running.
    assert_eq!(
        reconcile_decision(&run, Some(&live_evidence("working", None))),
        ReconcileOutcome::Running
    );
    // A live agent whose wait-signal postdates dispatch ended its turn.
    assert_eq!(
        reconcile_decision(
            &run,
            Some(&live_evidence("needs_input", Some(SIGNAL_AFTER_DISPATCH)))
        ),
        ReconcileOutcome::TurnEnded
    );
    // Issue #360 fork parity: the reference's busy-to-idle edge — a live
    // agent that went idle after dispatch ended its turn.
    assert_eq!(
        reconcile_decision(
            &run,
            Some(&live_evidence("idle", Some(SIGNAL_AFTER_DISPATCH)))
        ),
        ReconcileOutcome::TurnEnded
    );
    // ...but idle without a stamp proves no edge.
    assert_eq!(
        reconcile_decision(&run, Some(&live_evidence("idle", None))),
        ReconcileOutcome::Running
    );
    // Same-second truncation edge: a dispatch 500 ms into a second and a
    // signal stamped that same second are indistinguishable at this
    // resolution, so the edge is (conservatively) accepted.
    let mut same_second = run.clone();
    same_second.dispatched_at = Some(500.0);
    assert_eq!(
        reconcile_decision(
            &same_second,
            Some(&live_evidence("needs_input", Some("1970-01-01T00:00:00Z")))
        ),
        ReconcileOutcome::TurnEnded
    );
    // A wait-signal from before dispatch proves nothing about this run.
    let mut stale = run.clone();
    stale.dispatched_at = Some(2_000.0);
    assert_eq!(
        reconcile_decision(
            &stale,
            Some(&live_evidence("needs_input", Some(SIGNAL_AFTER_DISPATCH)))
        ),
        ReconcileOutcome::Running
    );
    // Malformed stamps, missing stamps, and missing dispatch times never
    // finalize: the edge stays unproven.
    assert_eq!(
        reconcile_decision(
            &run,
            Some(&live_evidence("needs_input", Some("not-a-time")))
        ),
        ReconcileOutcome::Running
    );
    assert_eq!(
        reconcile_decision(&run, Some(&live_evidence("needs_input", None))),
        ReconcileOutcome::Running
    );
    let mut dateless = run.clone();
    dateless.dispatched_at = None;
    assert_eq!(
        reconcile_decision(
            &dateless,
            Some(&live_evidence("needs_input", Some(SIGNAL_AFTER_DISPATCH)))
        ),
        ReconcileOutcome::Running
    );
    // A live handle of another incarnation is not this run's session.
    assert_eq!(
        reconcile_decision(
            &run,
            Some(&SessionEvidence {
                incarnation: "inc-2".to_string(),
                ..live_evidence("needs_input", Some(SIGNAL_AFTER_DISPATCH))
            })
        ),
        ReconcileOutcome::Running
    );
    // No handle in this process: stranded, never completed.
    assert_eq!(reconcile_decision(&run, None), ReconcileOutcome::Stranded);
}

#[test]
fn apply_reconcile_finalizes_dispatched_rows_only() {
    let conn = mem_conn();
    insert_workspace(&conn, "w1", HOST);
    let run = sample_run("ar:apply-1", "a1");
    storage::upsert_automation_run(&conn, &run).unwrap();

    assert!(!apply_reconcile(&conn, "ar:apply-1", ReconcileOutcome::Running, 2_000.0).unwrap());
    let unchanged = storage::get_automation_run(&conn, "ar:apply-1")
        .unwrap()
        .unwrap();
    assert_eq!(unchanged.status, AutomationRunStatus::Dispatched);

    assert!(
        apply_reconcile(
            &conn,
            "ar:apply-1",
            ReconcileOutcome::Exited { exit_code: Some(3) },
            2_000.0
        )
        .unwrap()
    );
    let done = storage::get_automation_run(&conn, "ar:apply-1")
        .unwrap()
        .unwrap();
    assert_eq!(done.status, AutomationRunStatus::Completed);
    assert_eq!(done.exit_code, Some(3));
    assert_eq!(done.observed_at, Some(2_000.0));

    // A Completed row is never regressed, not even by a strand.
    assert!(!apply_reconcile(&conn, "ar:apply-1", ReconcileOutcome::Stranded, 3_000.0).unwrap());
    let kept = storage::get_automation_run(&conn, "ar:apply-1")
        .unwrap()
        .unwrap();
    assert_eq!(kept.status, AutomationRunStatus::Completed);
    assert!(kept.error.is_none());

    // Stranded close-out claims dispatch failure, never completion.
    let mut ghost = sample_run("ar:apply-2", "a1");
    ghost.terminal_session_id = Some("ghost-session".to_string());
    storage::upsert_automation_run(&conn, &ghost).unwrap();
    assert!(apply_reconcile(&conn, "ar:apply-2", ReconcileOutcome::Stranded, 4_000.0).unwrap());
    let stranded = storage::get_automation_run(&conn, "ar:apply-2")
        .unwrap()
        .unwrap();
    assert_eq!(stranded.status, AutomationRunStatus::DispatchFailed);
    assert!(stranded.error.unwrap().contains("lost the terminal"));

    // Missing rows are a silent no-op.
    assert!(
        !apply_reconcile(
            &conn,
            "ar:missing",
            ReconcileOutcome::Exited { exit_code: None },
            5_000.0
        )
        .unwrap()
    );
}

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64
}

/// Opens the engine's own SQLite file alongside the live engine (the
/// engine is idle at these points; a busy timeout covers any stray
/// lock): lets tests re-link a run row to a chosen session, which no
/// public RPC spells.
fn open_engine_db(dir: &tempfile::TempDir) -> rusqlite::Connection {
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .unwrap();
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

#[test]
fn tick_finalizes_an_exited_fixture_run_as_completed() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let created = create_automation(&engine, "fin-1", &workspace_id, "0 0 1 1 *");
    let automation_id = created["id"].as_str().unwrap().to_string();

    let result = ok(engine.dispatch(request(
        "fin-run",
        "automation.run_now",
        json!({"id": automation_id}),
    )));
    let run_id = result["runId"].as_str().unwrap().to_string();
    let history = ok(engine.dispatch(request(
        "fin-hist",
        "automation.history",
        json!({"automationId": automation_id}),
    )));
    let session_id = history["runs"][0]["terminalSessionId"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(poll_session_exited(&engine, &workspace_id, &session_id));

    // The record-time poll may already have caught the exit (Completed);
    // force the row back to Dispatched so the tick path is always
    // exercised deterministically.
    let db = open_engine_db(&dir);
    let mut payload = read_run_payload(&db, &run_id);
    payload["status"] = json!("dispatched");
    payload["exitCode"] = Value::Null;
    write_run_payload(&db, &run_id, &payload);
    drop(db);

    // Prove the session handle outlived the poll: an exited fixture's
    // handle can be dropped by the engine before the tick, and the
    // reconcile treats a missing handle as stranded rather than exited.
    let session_still_tracked = engine.session_is_tracked(&session_id);
    let summary = scheduler::tick_once(&engine, now_ms());
    let history = ok(engine.dispatch(request(
        "fin-hist-2",
        "automation.history",
        json!({"automationId": automation_id}),
    )));
    assert_eq!(history["runs"][0]["id"], json!(run_id));
    if session_still_tracked {
        assert_eq!(summary.completed, 1);
        assert_eq!(summary.stranded, 0);
        assert_eq!(history["runs"][0]["status"], json!("completed"));
        assert_eq!(history["runs"][0]["exitCode"], json!(0));
    } else {
        // Session handle already reaped: the tick strand-reports instead.
        assert_eq!(summary.completed, 0);
        assert_eq!(summary.stranded, 1);
        assert_eq!(history["runs"][0]["status"], json!("dispatch_failed"));
    }

    // A second tick leaves the terminal row alone.
    let again = scheduler::tick_once(&engine, now_ms());
    assert_eq!(again.completed, 0);
    assert_eq!(again.stranded, 0);
}

#[test]
fn tick_finalizes_a_turn_ended_live_session_as_completed() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let created = create_automation(&engine, "fin-2", &workspace_id, "0 0 1 1 *");
    let automation_id = created["id"].as_str().unwrap().to_string();
    let result = ok(engine.dispatch(request(
        "fin2-run",
        "automation.run_now",
        json!({"id": automation_id}),
    )));
    let run_id = result["runId"].as_str().unwrap().to_string();

    // A live session stands in for the agent's session: it emits output
    // (its activity stamp) and then idles. Re-link the run row to it (no
    // public RPC re-links runs), then report the turn-end hook the pi
    // extension sends on AgentEnd — a clear (#360), so the session
    // returns to activity-based derivation and reads `idle` once the
    // silence window passes; that idle edge is what the tick finalizes.
    let sleeper = ok(engine.dispatch(request(
        "fin2-sleep",
        "session.start",
        json!({"workspaceId": workspace_id, "command": "/bin/sh",
               "args": ["-c", "echo turn-ended-marker; exec sleep 120"], "cols": 80, "rows": 24}),
    )));
    let sleeper_id = sleeper["id"].as_str().unwrap().to_string();
    let sleeper_inc = sleeper["incarnation"].as_str().unwrap().to_string();
    // The echo must land before the relink and the turn-end report so its
    // stamp provably belongs to this run's dispatch window.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    let mut cursor = 0u64;
    loop {
        let read = ok(engine.dispatch(request(
            "fin2-read",
            "session.read",
            json!({"sessionId": sleeper_id, "incarnation": sleeper_inc, "cursor": cursor}),
        )));
        let text = String::from_utf8(base64_decode(read["dataBase64"].as_str().unwrap())).unwrap();
        if text.contains("turn-ended-marker") {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "sleeper must echo its marker"
        );
        cursor = read["nextCursor"].as_u64().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let db = open_engine_db(&dir);
    let mut payload = read_run_payload(&db, &run_id);
    payload["status"] = json!("dispatched");
    payload["terminalSessionId"] = json!(sleeper_id);
    payload["sessionIncarnation"] = json!(sleeper_inc);
    write_run_payload(&db, &run_id, &payload);
    drop(db);

    // Before the turn-end signal the tick must leave the run alone.
    let idle = scheduler::tick_once(&engine, now_ms());
    assert_eq!(idle.completed, 0);
    assert_eq!(idle.stranded, 0);

    ok(engine.dispatch(request(
        "fin2-hook",
        "session.hook_event",
        json!({"sessionId": sleeper_id, "incarnation": sleeper_inc, "event": "AgentEnd"}),
    )));
    // Wait out the activity window so the turn-ended session reports the
    // idle edge the scheduler finalizes on.
    let idle_deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
    loop {
        let listed = ok(engine.dispatch(request(
            "fin2-list",
            "session.list",
            json!({"workspaceId": workspace_id}),
        )));
        let row = listed["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == sleeper_id)
            .expect("sleeper must be listed");
        if row["agentState"] == "idle" {
            break;
        }
        assert!(
            std::time::Instant::now() < idle_deadline,
            "turn-ended session must settle to idle, saw {}",
            row["agentState"]
        );
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let summary = scheduler::tick_once(&engine, now_ms());
    assert_eq!(summary.completed, 1);
    assert_eq!(summary.stranded, 0);
    let history = ok(engine.dispatch(request(
        "fin2-hist",
        "automation.history",
        json!({"automationId": automation_id}),
    )));
    assert_eq!(history["runs"][0]["id"], json!(run_id));
    assert_eq!(history["runs"][0]["status"], json!("completed"));

    ok(engine.dispatch(request(
        "fin2-stop",
        "session.stop",
        json!({"sessionId": sleeper_id, "incarnation": sleeper_inc}),
    )));
}

#[test]
fn tick_strands_a_dispatched_run_whose_session_is_gone() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    // Reopen: a new process state with no session handles (the daemon-
    // restart shape the fork's retained-run reconciler covers). A ghost
    // Dispatched row (run_now would attach a live handle instead) is
    // planted straight into the database file after the reopen, so crash
    // recovery can never see it first.
    let (engine, workspace_id) = {
        let (engine, workspace_id) = engine_with_workspace(&dir);
        drop(engine);
        let engine = Engine::open(dir.path()).unwrap();
        (engine, workspace_id)
    };
    let created = create_automation(&engine, "strand-1", &workspace_id, "0 0 1 1 *");
    let automation_id = created["id"].as_str().unwrap().to_string();
    let db = open_engine_db(&dir);
    let run = serde_json::json!({
        "id": "ar:ghost-1", "automationId": automation_id,
        "title": "", "scheduledFor": 1_000.0, "status": "dispatched",
        "trigger": "manual", "workspaceId": workspace_id,
        "sessionKind": "terminal", "terminalSessionId": "ghost-session",
        "sessionIncarnation": "inc-1",
        "startedAt": 1_000.0, "dispatchedAt": 1_000.0, "createdAt": 1_000.0,
        "observedAt": 1_000.0,
    });
    db.execute(
        "INSERT INTO automation_runs (id, automation_id, payload_json) VALUES (?1, ?2, ?3)",
        rusqlite::params!["ar:ghost-1", automation_id, run.to_string()],
    )
    .unwrap();
    drop(db);
    let summary = scheduler::tick_once(&engine, 2_000.0);
    assert_eq!(summary.stranded, 1);
    assert_eq!(summary.completed, 0);
    let history = ok(engine.dispatch(request(
        "strand-hist",
        "automation.history",
        json!({"automationId": automation_id}),
    )));
    assert_eq!(history["runs"][0]["id"], json!("ar:ghost-1"));
    assert_eq!(history["runs"][0]["status"], json!("dispatch_failed"));
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

// --- Bot-owned dispatch harness resolution (issue #188) --------------------

#[test]
fn bot_owned_dispatch_resolves_the_bots_harness_policy() {
    let c = mem_conn_with_bots();
    insert_workspace(&c, "w1", HOST);
    insert_pi_bot(
        &c,
        "b1",
        "a1",
        Some("dgx-spark/qwen3.8-flash-next-nvidia-nvfp4"),
    );
    // The row carries no pins, exactly like build_responsibility_automation.
    let automation = bot_owned_automation("a1", "b1");
    assert_eq!(automation.model, None);
    assert_eq!(automation.provider, None);
    storage::upsert_automation(&c, &automation).unwrap();

    let automation = bot_owned_automation("a1", "b1");
    let params = row_harness_params(&automation, true);
    let plan = prepare(&c, "a1", &params);
    // The bot's current policy reaches the harness.start params at
    // dispatch time, not just the row's build-time snapshot.
    assert_eq!(plan.params["harnessId"], json!("pi"));
    assert_eq!(plan.params["provider"], json!("dgx-spark"));
    assert_eq!(
        plan.params["model"],
        json!("qwen3.8-flash-next-nvidia-nvfp4")
    );
    assert_eq!(plan.params["permissionMode"], json!("unattended"));
    assert_eq!(plan.params["headless"], json!(true));
}

#[test]
fn explicit_automation_pins_beat_the_bot_policy() {
    let c = mem_conn_with_bots();
    insert_workspace(&c, "w1", HOST);
    insert_pi_bot(
        &c,
        "b1",
        "a1",
        Some("dgx-spark/qwen3.8-flash-next-nvidia-nvfp4"),
    );
    let mut automation = bot_owned_automation("a1", "b1");
    automation.model = Some("pinned-model".to_string());
    automation.provider = Some("pinned-provider".to_string());
    storage::upsert_automation(&c, &automation).unwrap();

    let plan = prepare(&c, "a1", &row_harness_params(&automation, false));
    // Row pins win (#211 precedence); the bot policy only fills the gaps
    // (permissionMode), and Pi stays Pi.
    assert_eq!(plan.params["provider"], json!("pinned-provider"));
    assert_eq!(plan.params["model"], json!("pinned-model"));
    assert_eq!(plan.params["permissionMode"], json!("unattended"));
    assert_eq!(plan.params["harnessId"], json!("pi"));
}

#[test]
fn editing_the_bot_applies_to_existing_responsibilities() {
    let c = mem_conn_with_bots();
    insert_workspace(&c, "w1", HOST);
    insert_pi_bot(&c, "b1", "a1", Some("dgx-spark/model-a"));
    storage::upsert_automation(&c, &bot_owned_automation("a1", "b1")).unwrap();

    let plan = prepare(&c, "a1", &harness_params());
    assert_eq!(plan.params["model"], json!("model-a"));

    // A later bot edit (new model, different harness) must reach the SAME
    // stored automation's next dispatch -- the fork's dispatch-time
    // resolution behavior.
    bots_storage::update_bot(&c, HOST, "/workspaces/w1", "b1", 5_000.0, |bot| {
        bot.harness_policy.explicit_model = Some("dgx-spark/model-b".to_string());
        bot.harness_policy.default_harness = "claude".to_string();
    })
    .unwrap();

    let plan = prepare(&c, "a1", &harness_params());
    assert_eq!(plan.params["model"], json!("model-b"));
    assert_eq!(plan.params["harnessId"], json!("claude"));
    // Only Pi runs go unattended.
    assert!(plan.params.get("permissionMode").is_none());
}

#[test]
fn bot_free_and_stale_bot_automations_dispatch_with_their_row_params() {
    let c = mem_conn_with_bots();
    insert_workspace(&c, "w1", HOST);

    // A bot-free (user) automation: pins pass through untouched.
    let mut user_row = sample_automation("user-1");
    user_row.model = Some("row-model".to_string());
    user_row.provider = Some("row-provider".to_string());
    storage::upsert_automation(&c, &user_row).unwrap();
    let plan = prepare(&c, "user-1", &row_harness_params(&user_row, false));
    assert_eq!(plan.params["harnessId"], json!("pi"));
    assert_eq!(plan.params["model"], json!("row-model"));
    assert_eq!(plan.params["provider"], json!("row-provider"));
    assert!(plan.params.get("permissionMode").is_none());

    // A bot-owned row whose bot no longer resolves: the row's own params
    // stay the safe fallback, never a new refusal.
    storage::upsert_automation(&c, &bot_owned_automation("stale-1", "ghost")).unwrap();
    let plan = prepare(&c, "stale-1", &harness_params());
    assert_eq!(plan.params["harnessId"], json!("pi"));
    assert!(plan.params.get("model").is_none());
    assert!(plan.params.get("provider").is_none());
}

/// Full-engine journey: a Pi bot with a stored local model + a scheduled
/// responsibility, dispatched by `automation.run_now` -- the launched
/// session's argv carries the bot's provider/model/unattended/headless
/// policy (issue #188), which the bare-default launch used to omit.
#[test]
fn bot_owned_run_now_launches_the_bots_model_provider_and_unattended_mode() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let host_id = {
        let registered = ok(engine.dispatch(request(
            "host-q",
            "workspace.register",
            json!({"path": dir.path().join("work")}),
        )));
        registered["hostId"].as_str().unwrap().to_string()
    };
    let bot = ok(engine.dispatch(request(
        "bot-1",
        "bot.create",
        json!({
            "workspaceId": workspace_id,
            "hostId": host_id,
            "body": {
                "characterPreset": "none",
                "displayIdentity": {"displayName": "Sparky", "handle": null, "title": null},
                "harnessPolicy": {
                    "defaultHarness": "pi",
                    "explicitModel": "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
                },
                "instructions": "Sweep the realm.",
                "memories": [],
            },
        }),
    )));
    let bot_id = bot["id"].as_str().unwrap().to_string();
    let created = ok(engine.dispatch(request(
        "resp-1",
        "bot.responsibility_create",
        json!({
            "workspaceId": workspace_id,
            "hostId": host_id,
            "botId": bot_id,
            "name": "Nightly sweep",
            "schedule": "* * * * *",
            "prompt": "do the thing",
        }),
    )));
    let automation_id = created["automationId"].as_str().unwrap().to_string();

    let result = ok(engine.dispatch(request(
        "run-now-bot",
        "automation.run_now",
        json!({"id": automation_id}),
    )));
    assert_eq!(result["outcome"], json!("dispatched"));

    let history = ok(engine.dispatch(request(
        "hist-bot",
        "automation.history",
        json!({"automationId": automation_id}),
    )));
    let runs = history["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 1);
    let session_id = runs[0]["terminalSessionId"].as_str().unwrap().to_string();
    assert!(
        poll_session_exited(&engine, &workspace_id, &session_id),
        "the fixture harness session never reached exited"
    );
    let listed = ok(engine.dispatch(request(
        "sess-bot",
        "session.list",
        json!({"workspaceId": workspace_id}),
    )));
    let session = listed["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == json!(session_id))
        .unwrap();
    let args: Vec<String> = session["args"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a.as_str().unwrap().to_string())
        .collect();
    let joined = args.join(" ");
    assert!(joined.contains("--provider dgx-spark"), "{args:?}");
    assert!(
        joined.contains("--model qwen3.8-flash-next-nvidia-nvfp4"),
        "{args:?}"
    );
    assert!(args.contains(&"--approve".to_string()), "{args:?}");
    assert!(args.contains(&"-p".to_string()), "{args:?}");
}

/// Same journey through the scheduler tick itself: the cron fire of a
/// bot-owned automation resolves the bot's CURRENT policy at dispatch.
#[test]
fn bot_owned_scheduled_tick_launches_the_bots_harness_policy() {
    ensure_fixture_harness_on_path();
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);
    let host_id = {
        let registered = ok(engine.dispatch(request(
            "host-q",
            "workspace.register",
            json!({"path": dir.path().join("work")}),
        )));
        registered["hostId"].as_str().unwrap().to_string()
    };
    let bot = ok(engine.dispatch(request(
        "bot-1",
        "bot.create",
        json!({
            "workspaceId": workspace_id,
            "hostId": host_id,
            "body": {
                "characterPreset": "none",
                "displayIdentity": {"displayName": "Sparky", "handle": null, "title": null},
                "harnessPolicy": {
                    "defaultHarness": "pi",
                    "explicitModel": "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
                },
                "instructions": "Sweep the realm.",
                "memories": [],
            },
        }),
    )));
    let bot_id = bot["id"].as_str().unwrap().to_string();
    let created = ok(engine.dispatch(request(
        "resp-1",
        "bot.responsibility_create",
        json!({
            "workspaceId": workspace_id,
            "hostId": host_id,
            "botId": bot_id,
            "name": "Nightly sweep",
            "schedule": "* * * * *",
            "prompt": "do the thing",
        }),
    )));
    let automation_id = created["automationId"].as_str().unwrap().to_string();
    let slot = {
        let listed = ok(engine.dispatch(request("list-1", "automation.list", json!({}))));
        listed["automations"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["id"] == json!(automation_id))
            .unwrap()["nextRunAt"]
            .as_f64()
            .unwrap()
    };

    let summary = scheduler::tick_once(&engine, slot + 30_000.0);
    assert_eq!(summary.fired, 1);
    assert_eq!(summary.failed, 0);

    let history = ok(engine.dispatch(request(
        "hist-tick-bot",
        "automation.history",
        json!({"automationId": automation_id}),
    )));
    let runs = history["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["trigger"], json!("scheduled"));
    let session_id = runs[0]["terminalSessionId"].as_str().unwrap().to_string();
    assert!(
        poll_session_exited(&engine, &workspace_id, &session_id),
        "the fixture harness session never reached exited"
    );
    let listed = ok(engine.dispatch(request(
        "sess-tick-bot",
        "session.list",
        json!({"workspaceId": workspace_id}),
    )));
    let session = listed["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == json!(session_id))
        .unwrap();
    let args: Vec<String> = session["args"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a.as_str().unwrap().to_string())
        .collect();
    let joined = args.join(" ");
    assert!(joined.contains("--provider dgx-spark"), "{args:?}");
    assert!(
        joined.contains("--model qwen3.8-flash-next-nvidia-nvfp4"),
        "{args:?}"
    );
    assert!(args.contains(&"--approve".to_string()), "{args:?}");
}
