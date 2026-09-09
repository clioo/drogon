//! Tests for `automations::runner`'s 3-phase flow: `prepare_run_plan`
//! (read-only) -> `dispatch_run_plan` (no `Connection` param) ->
//! `record_run_outcome`. Gating/workspace/recording tests inject a
//! `FakeDispatchSeam` so no test spawns a real session; two
//! `engine_dispatch_seam_*` tests drive `EngineDispatchSeam` against a real
//! `Engine` on error paths only (also never spawns a process).
#![allow(dead_code)]

use std::cell::RefCell;

use drogon_core::Engine;
use drogon_core::automations;
use drogon_core::automations::execution::{DispatchRefusal, InvocationReason};
use drogon_core::automations::records::*;
use drogon_core::automations::runner::{
    DispatchSeam, DispatchSeamError, EngineDispatchSeam, HarnessLaunchParams, HarnessStarted,
    PrepareOutcome, RunPlan, RunRefusal, RunUnsupported, RunnerOutcome, SessionObservation,
    derive_request_id, dispatch_run_plan, prepare_run_plan, record_run_outcome,
};
use drogon_core::bots::policy::ResponsibilityRefusal;
use drogon_core::bots::records::*;
use drogon_core::bots::storage as bstorage;
use rusqlite::Connection;
use serde_json::Value;

const HOST: &str = "host-1";
const OTHER_HOST: &str = "host-2";
const FOLDER: &str = "/repo";

const WORKSPACES_DDL: &str = "CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    host_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);";

fn conn() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    automations::storage::migrate(&c).unwrap();
    bstorage::migrate(&c).unwrap();
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

fn sample_bot(id: &str, display_name: &str, now: f64) -> Bot {
    Bot {
        id: id.to_string(),
        character_preset: "none".to_string(),
        display_identity: DisplayIdentity {
            display_name: display_name.to_string(),
            handle: None,
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
        created_at: now,
        updated_at: now,
    }
}

fn sample_automation(id: &str, bot_id: &str, workspace_id: Option<String>) -> Automation {
    Automation {
        id: id.to_string(),
        creation_key: None,
        name: "sweep".to_string(),
        prompt: "p".to_string(),
        precheck: None,
        agent_id: "codex".to_string(),
        model: None,
        provider: None,
        run_context: None,
        source_context: None,
        project_id: "proj".to_string(),
        execution_target_type: ExecutionTargetType::Local,
        execution_target_id: HOST.to_string(),
        execution_target_generation: None,
        scheduler_owner: SchedulerOwner::LocalHostService,
        workspace_mode: WorkspaceMode::Existing,
        workspace_id,
        base_branch: None,
        setup_decision: None,
        reuse_session: false,
        timezone: "UTC".to_string(),
        rrule: "FREQ=DAILY".to_string(),
        dtstart: 0.0,
        enabled: true,
        next_run_at: 100.0,
        last_run_at: None,
        missed_run_policy: MissedRunPolicy::RunOnceWithinGrace,
        missed_run_grace_minutes: 30.0,
        created_at: 0.0,
        updated_at: 0.0,
        bot_id: Some(bot_id.to_string()),
    }
}

fn scheduled_responsibility(id: &str, automation_id: &str, enabled: bool) -> Responsibility {
    Responsibility {
        id: id.to_string(),
        name: "sweep".to_string(),
        instructions: String::new(),
        kind: ResponsibilityKind::Scheduled,
        trigger: ResponsibilityTrigger::Scheduled {
            automation_id: automation_id.to_string(),
        },
        enabled,
        recipe: None,
        created_at: 0.0,
        updated_at: 0.0,
    }
}

fn reactive_responsibility(id: &str, event: Option<&str>, enabled: bool) -> Responsibility {
    Responsibility {
        id: id.to_string(),
        name: "watch".to_string(),
        instructions: String::new(),
        kind: ResponsibilityKind::Reactive,
        trigger: ResponsibilityTrigger::Reactive {
            event: event.map(str::to_string),
        },
        enabled,
        recipe: None,
        created_at: 0.0,
        updated_at: 0.0,
    }
}

fn harness_params() -> HarnessLaunchParams {
    HarnessLaunchParams {
        harness_id: "codex".to_string(),
        model: Some("gpt-test".to_string()),
        effort: None,
        provider: None,
        permission_mode: None,
        headless: false,
    }
}

fn ready_plan(outcome: PrepareOutcome) -> RunPlan {
    match outcome {
        PrepareOutcome::Ready(plan) => plan,
        other => panic!("expected PrepareOutcome::Ready, got {other:?}"),
    }
}

/// A scriptable [`DispatchSeam`] that never spawns anything real. Any call
/// beyond what a test scripts a response for panics via `.expect(...)`.
struct FakeDispatchSeam {
    harness_start_calls: RefCell<Vec<(String, Value)>>,
    session_read_calls: RefCell<Vec<(String, String)>>,
    harness_start_response: RefCell<Option<Result<HarnessStarted, DispatchSeamError>>>,
    session_read_response: RefCell<Option<Result<SessionObservation, DispatchSeamError>>>,
    during_harness_start: RefCell<Option<Box<dyn Fn()>>>,
}

impl FakeDispatchSeam {
    fn new() -> Self {
        Self {
            harness_start_calls: RefCell::new(Vec::new()),
            session_read_calls: RefCell::new(Vec::new()),
            harness_start_response: RefCell::new(None),
            session_read_response: RefCell::new(None),
            during_harness_start: RefCell::new(None),
        }
    }

    fn with_harness_start(self, response: Result<HarnessStarted, DispatchSeamError>) -> Self {
        *self.harness_start_response.borrow_mut() = Some(response);
        self
    }

    fn with_session_read(self, response: Result<SessionObservation, DispatchSeamError>) -> Self {
        *self.session_read_response.borrow_mut() = Some(response);
        self
    }

    fn with_during_harness_start(self, hook: impl Fn() + 'static) -> Self {
        *self.during_harness_start.borrow_mut() = Some(Box::new(hook));
        self
    }

    fn session_read_call_count(&self) -> usize {
        self.session_read_calls.borrow().len()
    }
}

impl DispatchSeam for FakeDispatchSeam {
    fn harness_start(
        &self,
        request_id: &str,
        params: Value,
    ) -> Result<HarnessStarted, DispatchSeamError> {
        self.harness_start_calls
            .borrow_mut()
            .push((request_id.to_string(), params));
        if let Some(hook) = self.during_harness_start.borrow().as_ref() {
            hook();
        }
        self.harness_start_response
            .borrow_mut()
            .take()
            .expect("harness_start called without a scripted response")
    }

    fn session_read(
        &self,
        session_id: &str,
        incarnation: &str,
    ) -> Result<SessionObservation, DispatchSeamError> {
        self.session_read_calls
            .borrow_mut()
            .push((session_id.to_string(), incarnation.to_string()));
        self.session_read_response
            .borrow_mut()
            .take()
            .expect("session_read called without a scripted response")
    }
}

// --- Phase 1 gating reuse: refused/unsupported, seam never constructed ---

#[test]
fn disabled_scheduled_responsibility_refuses() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let automation = sample_automation("a1", "b1", Some("w1".to_string()));
    let responsibility = scheduled_responsibility("r1", "a1", false);
    bstorage::create_scheduled_responsibility(&c, HOST, FOLDER, "b1", responsibility, automation)
        .unwrap();

    let outcome = prepare_run_plan(
        &c,
        HOST,
        FOLDER,
        "b1",
        "r1",
        HOST,
        &InvocationReason::ScheduledDue,
        "tick-1",
        &harness_params(),
        100.0,
    )
    .unwrap();

    assert_eq!(
        outcome,
        PrepareOutcome::Refused(RunRefusal::Responsibility(ResponsibilityRefusal::Disabled))
    );
}

#[test]
fn foreign_automation_host_refuses() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let mut automation = sample_automation("a1", "b1", Some("w1".to_string()));
    automation.execution_target_id = OTHER_HOST.to_string();
    let responsibility = scheduled_responsibility("r1", "a1", true);
    bstorage::create_scheduled_responsibility(&c, HOST, FOLDER, "b1", responsibility, automation)
        .unwrap();

    let outcome = prepare_run_plan(
        &c,
        HOST,
        FOLDER,
        "b1",
        "r1",
        HOST,
        &InvocationReason::ScheduledDue,
        "tick-1",
        &harness_params(),
        100.0,
    )
    .unwrap();

    match outcome {
        PrepareOutcome::Refused(RunRefusal::Automation(DispatchRefusal::ForeignHost {
            ..
        })) => {}
        other => panic!("expected an Automation(ForeignHost) refusal, got {other:?}"),
    }
}

#[test]
fn reactive_without_supplied_event_refuses() {
    let c = conn();
    let mut bot = sample_bot("b1", "Alice", 0.0);
    bot.responsibilities
        .push(reactive_responsibility("r1", None, true));
    bstorage::create_bot(&c, HOST, FOLDER, &bot).unwrap();

    let outcome = prepare_run_plan(
        &c,
        HOST,
        FOLDER,
        "b1",
        "r1",
        HOST,
        &InvocationReason::Manual,
        "manual-op-1",
        &harness_params(),
        100.0,
    )
    .unwrap();

    match outcome {
        PrepareOutcome::Refused(RunRefusal::Responsibility(
            ResponsibilityRefusal::ReactiveRequiresSuppliedEvent(_),
        )) => {}
        other => panic!("expected ReactiveRequiresSuppliedEvent refusal, got {other:?}"),
    }
}

#[test]
fn reactive_with_supplied_event_is_unsupported() {
    let c = conn();
    let mut bot = sample_bot("b1", "Alice", 0.0);
    bot.responsibilities
        .push(reactive_responsibility("r1", None, true));
    bstorage::create_bot(&c, HOST, FOLDER, &bot).unwrap();

    let outcome = prepare_run_plan(
        &c,
        HOST,
        FOLDER,
        "b1",
        "r1",
        HOST,
        &InvocationReason::ReactiveEvent(Some("push".to_string())),
        "event-42",
        &harness_params(),
        100.0,
    )
    .unwrap();

    assert_eq!(
        outcome,
        PrepareOutcome::Unsupported(RunUnsupported::ReactiveDispatchParamsNotWired)
    );
}

#[test]
fn new_per_run_workspace_mode_is_unsupported() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let mut automation = sample_automation("a1", "b1", None);
    automation.workspace_mode = WorkspaceMode::NewPerRun;
    let responsibility = scheduled_responsibility("r1", "a1", true);
    bstorage::create_scheduled_responsibility(&c, HOST, FOLDER, "b1", responsibility, automation)
        .unwrap();

    let outcome = prepare_run_plan(
        &c,
        HOST,
        FOLDER,
        "b1",
        "r1",
        HOST,
        &InvocationReason::ScheduledDue,
        "tick-1",
        &harness_params(),
        100.0,
    )
    .unwrap();

    assert_eq!(
        outcome,
        PrepareOutcome::Unsupported(RunUnsupported::NewPerRunWorkspaceMode)
    );
}

#[test]
fn missing_workspace_id_refuses() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let automation = sample_automation("a1", "b1", None);
    let responsibility = scheduled_responsibility("r1", "a1", true);
    bstorage::create_scheduled_responsibility(&c, HOST, FOLDER, "b1", responsibility, automation)
        .unwrap();

    let outcome = prepare_run_plan(
        &c,
        HOST,
        FOLDER,
        "b1",
        "r1",
        HOST,
        &InvocationReason::ScheduledDue,
        "tick-1",
        &harness_params(),
        100.0,
    )
    .unwrap();

    assert_eq!(
        outcome,
        PrepareOutcome::Refused(RunRefusal::MissingWorkspaceId)
    );
}

#[test]
fn unknown_workspace_refuses() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let automation = sample_automation("a1", "b1", Some("ghost-workspace".to_string()));
    let responsibility = scheduled_responsibility("r1", "a1", true);
    bstorage::create_scheduled_responsibility(&c, HOST, FOLDER, "b1", responsibility, automation)
        .unwrap();

    let outcome = prepare_run_plan(
        &c,
        HOST,
        FOLDER,
        "b1",
        "r1",
        HOST,
        &InvocationReason::ScheduledDue,
        "tick-1",
        &harness_params(),
        100.0,
    )
    .unwrap();

    assert_eq!(
        outcome,
        PrepareOutcome::Refused(RunRefusal::UnknownWorkspace("ghost-workspace".to_string()))
    );
}

#[test]
fn foreign_workspace_host_refuses_even_when_automation_execution_target_already_matches() {
    let c = conn();
    // automation.execution_target_id == HOST (would pass on its own), but
    // the workspace row it targets was registered under a different host.
    insert_workspace(&c, "w1", OTHER_HOST);
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let automation = sample_automation("a1", "b1", Some("w1".to_string()));
    let responsibility = scheduled_responsibility("r1", "a1", true);
    bstorage::create_scheduled_responsibility(&c, HOST, FOLDER, "b1", responsibility, automation)
        .unwrap();

    let outcome = prepare_run_plan(
        &c,
        HOST,
        FOLDER,
        "b1",
        "r1",
        HOST,
        &InvocationReason::ScheduledDue,
        "tick-1",
        &harness_params(),
        100.0,
    )
    .unwrap();

    assert_eq!(
        outcome,
        PrepareOutcome::Refused(RunRefusal::ForeignWorkspaceHost {
            workspace_id: "w1".to_string(),
            workspace_host_id: OTHER_HOST.to_string(),
            current_host_id: HOST.to_string(),
        })
    );
}

#[test]
fn headless_runs_carry_the_headless_flag_into_harness_start() {
    let c = conn();
    insert_workspace(&c, "w1", HOST);
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let automation = sample_automation("a1", "b1", Some("w1".to_string()));
    let responsibility = scheduled_responsibility("r1", "a1", true);
    bstorage::create_scheduled_responsibility(&c, HOST, FOLDER, "b1", responsibility, automation)
        .unwrap();

    let mut headless = harness_params();
    headless.headless = true;
    let plan = ready_plan(
        prepare_run_plan(
            &c,
            HOST,
            FOLDER,
            "b1",
            "r1",
            HOST,
            &InvocationReason::ScheduledDue,
            "due-100",
            &headless,
            100.0,
        )
        .unwrap(),
    );
    assert_eq!(plan.params["headless"], true);
}

// --- Phases 2/3: real dispatch through the fake seam, then recording ----

#[test]
fn happy_path_dispatches_through_the_seam_with_expected_params_and_records_live_observation() {
    let c = conn();
    insert_workspace(&c, "w1", HOST);
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let mut automation = sample_automation("a1", "b1", Some("w1".to_string()));
    automation.prompt = "do the thing".to_string();
    let responsibility = scheduled_responsibility("r1", "a1", true);
    bstorage::create_scheduled_responsibility(&c, HOST, FOLDER, "b1", responsibility, automation)
        .unwrap();

    let plan = ready_plan(
        prepare_run_plan(
            &c,
            HOST,
            FOLDER,
            "b1",
            "r1",
            HOST,
            &InvocationReason::ScheduledDue,
            "due-100",
            &harness_params(),
            100.0,
        )
        .unwrap(),
    );

    let expected_request_id = derive_request_id(HOST, FOLDER, "b1", "r1", "due-100");
    assert_eq!(plan.request_id, expected_request_id);
    assert_eq!(plan.params["workspaceId"], "w1");
    assert_eq!(plan.params["harnessId"], "codex");
    assert_eq!(plan.params["prompt"], "do the thing");
    assert_eq!(plan.params["model"], "gpt-test");
    assert!(plan.params.get("effort").is_none());

    let seam = FakeDispatchSeam::new()
        .with_harness_start(Ok(HarnessStarted {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
        }))
        .with_session_read(Ok(SessionObservation {
            verdict: "live".to_string(),
            exit_code: None,
        }));

    let outcome = dispatch_run_plan(&seam, &plan);
    assert_eq!(
        outcome,
        RunnerOutcome::Observed {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
            verdict: "live".to_string(),
            exit_code: None,
        }
    );
    {
        let calls = seam.harness_start_calls.borrow();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, expected_request_id);
    }

    record_run_outcome(&c, &plan, &outcome, 100.0).unwrap();

    let history = bstorage::history_for_bot(&c, HOST, FOLDER, "b1").unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].responsibility_run.id, expected_request_id);
    assert_eq!(
        history[0].responsibility_run.host_observation,
        Some(HostObservation::Live)
    );
    assert_eq!(history[0].responsibility_run.ended_at, None);
    assert_eq!(history[0].responsibility_run.started_at, 100.0);
}

#[test]
fn exited_verdict_closes_ended_at_and_records_host_observation_exited() {
    let c = conn();
    insert_workspace(&c, "w1", HOST);
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let automation = sample_automation("a1", "b1", Some("w1".to_string()));
    let responsibility = scheduled_responsibility("r1", "a1", true);
    bstorage::create_scheduled_responsibility(&c, HOST, FOLDER, "b1", responsibility, automation)
        .unwrap();

    let plan = ready_plan(
        prepare_run_plan(
            &c,
            HOST,
            FOLDER,
            "b1",
            "r1",
            HOST,
            &InvocationReason::Manual,
            "manual-op-1",
            &harness_params(),
            100.0,
        )
        .unwrap(),
    );

    let seam = FakeDispatchSeam::new()
        .with_harness_start(Ok(HarnessStarted {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
        }))
        .with_session_read(Ok(SessionObservation {
            verdict: "exited".to_string(),
            exit_code: Some(7),
        }));

    let outcome = dispatch_run_plan(&seam, &plan);
    record_run_outcome(&c, &plan, &outcome, 100.0).unwrap();

    let history = bstorage::history_for_bot(&c, HOST, FOLDER, "b1").unwrap();
    assert_eq!(
        history[0].responsibility_run.host_observation,
        Some(HostObservation::Exited)
    );
    assert_eq!(history[0].responsibility_run.ended_at, Some(100.0));
}

#[test]
fn harness_start_failure_is_recorded_with_no_observation_and_never_polls_session_read() {
    let c = conn();
    insert_workspace(&c, "w1", HOST);
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let automation = sample_automation("a1", "b1", Some("w1".to_string()));
    let responsibility = scheduled_responsibility("r1", "a1", true);
    bstorage::create_scheduled_responsibility(&c, HOST, FOLDER, "b1", responsibility, automation)
        .unwrap();

    let plan = ready_plan(
        prepare_run_plan(
            &c,
            HOST,
            FOLDER,
            "b1",
            "r1",
            HOST,
            &InvocationReason::ScheduledDue,
            "tick-1",
            &harness_params(),
            100.0,
        )
        .unwrap(),
    );

    let seam_error = DispatchSeamError {
        code: "not_found".to_string(),
        message: "Unknown harness".to_string(),
    };
    let seam = FakeDispatchSeam::new().with_harness_start(Err(seam_error.clone()));

    let outcome = dispatch_run_plan(&seam, &plan);
    assert_eq!(outcome, RunnerOutcome::DispatchFailed(seam_error));
    assert_eq!(seam.session_read_call_count(), 0);

    record_run_outcome(&c, &plan, &outcome, 100.0).unwrap();

    let history = bstorage::history_for_bot(&c, HOST, FOLDER, "b1").unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].responsibility_run.host_observation, None);
    assert_eq!(history[0].responsibility_run.ended_at, Some(100.0));
}

#[test]
fn session_read_failure_after_successful_start_is_recorded_as_unverifiable() {
    let c = conn();
    insert_workspace(&c, "w1", HOST);
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let automation = sample_automation("a1", "b1", Some("w1".to_string()));
    let responsibility = scheduled_responsibility("r1", "a1", true);
    bstorage::create_scheduled_responsibility(&c, HOST, FOLDER, "b1", responsibility, automation)
        .unwrap();

    let plan = ready_plan(
        prepare_run_plan(
            &c,
            HOST,
            FOLDER,
            "b1",
            "r1",
            HOST,
            &InvocationReason::ScheduledDue,
            "tick-1",
            &harness_params(),
            100.0,
        )
        .unwrap(),
    );

    let seam_error = DispatchSeamError {
        code: "unverifiable".to_string(),
        message: "lost contact".to_string(),
    };
    let seam = FakeDispatchSeam::new()
        .with_harness_start(Ok(HarnessStarted {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
        }))
        .with_session_read(Err(seam_error.clone()));

    let outcome = dispatch_run_plan(&seam, &plan);
    assert_eq!(
        outcome,
        RunnerOutcome::ObservationFailed {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
            error: seam_error,
        }
    );

    record_run_outcome(&c, &plan, &outcome, 100.0).unwrap();

    let history = bstorage::history_for_bot(&c, HOST, FOLDER, "b1").unwrap();
    assert_eq!(
        history[0].responsibility_run.host_observation,
        Some(HostObservation::Unverifiable)
    );
    assert_eq!(history[0].responsibility_run.ended_at, None);
}

// --- Idempotency key derivation ------------------------------------------

#[test]
fn request_id_is_deterministic_for_identical_inputs() {
    assert_eq!(
        derive_request_id(HOST, FOLDER, "b1", "r1", "due-100"),
        derive_request_id(HOST, FOLDER, "b1", "r1", "due-100")
    );
}

#[test]
fn request_id_differs_for_different_event_identities() {
    assert_ne!(
        derive_request_id(HOST, FOLDER, "b1", "r1", "due-100"),
        derive_request_id(HOST, FOLDER, "b1", "r1", "due-200")
    );
}

#[test]
fn request_id_differs_across_host_and_folder_scope() {
    let base = derive_request_id(HOST, FOLDER, "b1", "r1", "evt");
    assert_ne!(
        base,
        derive_request_id(OTHER_HOST, FOLDER, "b1", "r1", "evt")
    );
    assert_ne!(
        base,
        derive_request_id(HOST, "/other-repo", "b1", "r1", "evt")
    );
}

/// Proves the hash form is length-prefixed, not naive concatenation: without
/// prefixing, `bot_id="a:b", responsibility_id="c"` and
/// `bot_id="a", responsibility_id="b:c"` would hash identically.
#[test]
fn request_id_does_not_collide_across_a_component_boundary_shift() {
    // A space is outside the natural-form's safe charset, so both cases
    // are forced onto the hash path -- exactly where naive concatenation
    // (no length prefix) would make "ab"+"c" collide with "a"+"bc".
    let a = derive_request_id(HOST, FOLDER, "ab", "c", "evt bad");
    let b = derive_request_id(HOST, FOLDER, "a", "bc", "evt bad");
    assert_ne!(a, b);
}

#[test]
fn request_id_falls_back_to_a_deterministic_hash_for_an_oversized_event_identity() {
    let huge = "x".repeat(500);
    let id = derive_request_id(HOST, FOLDER, "b1", "r1", &huge);
    assert!(id.len() <= 128);
    assert!(id.starts_with("automation-run:hash:"));
    assert_eq!(id, derive_request_id(HOST, FOLDER, "b1", "r1", &huge));
}

// --- Phase 1 releases its read transaction before returning --------------

#[test]
fn prepare_run_plan_releases_its_read_transaction_before_returning() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("drogon-automation-runner-test.sqlite3");

    let primary = Connection::open(&path).unwrap();
    automations::storage::migrate(&primary).unwrap();
    bstorage::migrate(&primary).unwrap();
    primary.execute_batch(WORKSPACES_DDL).unwrap();
    insert_workspace(&primary, "w1", HOST);
    bstorage::create_bot(&primary, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let automation = sample_automation("a1", "b1", Some("w1".to_string()));
    let responsibility = scheduled_responsibility("r1", "a1", true);
    bstorage::create_scheduled_responsibility(
        &primary,
        HOST,
        FOLDER,
        "b1",
        responsibility,
        automation,
    )
    .unwrap();

    let plan = ready_plan(
        prepare_run_plan(
            &primary,
            HOST,
            FOLDER,
            "b1",
            "r1",
            HOST,
            &InvocationReason::ScheduledDue,
            "due-100",
            &harness_params(),
            100.0,
        )
        .unwrap(),
    );

    // A wholly separate connection to the same file must be able to write
    // immediately: if `prepare_run_plan` left its internal transaction
    // open, this would fail (SQLITE_BUSY) or block instead of succeeding.
    let secondary = Connection::open(&path).unwrap();
    secondary
        .execute(
            "INSERT INTO workspaces (id, path, name, kind, host_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params!["w2", "/workspaces/w2", "w2", "folder", HOST, "2026-09-07T00:00:00Z"],
        )
        .expect("prepare_run_plan must not leave its read transaction open");

    let seam = FakeDispatchSeam::new()
        .with_harness_start(Ok(HarnessStarted {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
        }))
        .with_session_read(Ok(SessionObservation {
            verdict: "live".to_string(),
            exit_code: None,
        }));
    let outcome = dispatch_run_plan(&seam, &plan);
    assert!(matches!(outcome, RunnerOutcome::Observed { .. }));
}

/// Same proof from the seam's side: a second connection can write to the
/// same file *during* `dispatch_run_plan` itself (which has no
/// `Connection` parameter at all, so this is redundant with the type
/// signature -- kept as an empirical regression guard).
#[test]
fn no_db_lock_is_held_during_dispatch_run_plan() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir
        .path()
        .join("drogon-automation-runner-lock-test.sqlite3");

    let primary = Connection::open(&path).unwrap();
    automations::storage::migrate(&primary).unwrap();
    bstorage::migrate(&primary).unwrap();
    primary.execute_batch(WORKSPACES_DDL).unwrap();
    insert_workspace(&primary, "w1", HOST);
    bstorage::create_bot(&primary, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let automation = sample_automation("a1", "b1", Some("w1".to_string()));
    let responsibility = scheduled_responsibility("r1", "a1", true);
    bstorage::create_scheduled_responsibility(
        &primary,
        HOST,
        FOLDER,
        "b1",
        responsibility,
        automation,
    )
    .unwrap();

    let plan = ready_plan(
        prepare_run_plan(
            &primary,
            HOST,
            FOLDER,
            "b1",
            "r1",
            HOST,
            &InvocationReason::ScheduledDue,
            "due-100",
            &harness_params(),
            100.0,
        )
        .unwrap(),
    );

    let secondary_path = path.clone();
    let seam = FakeDispatchSeam::new()
        .with_harness_start(Ok(HarnessStarted {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
        }))
        .with_session_read(Ok(SessionObservation {
            verdict: "live".to_string(),
            exit_code: None,
        }))
        .with_during_harness_start(move || {
            let secondary = Connection::open(&secondary_path).unwrap();
            secondary
                .execute(
                    "INSERT INTO workspaces (id, path, name, kind, host_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params!["w2", "/workspaces/w2", "w2", "folder", HOST, "2026-09-07T00:00:00Z"],
                )
                .expect("a second connection must be able to write while dispatch_run_plan is in flight");
        });

    let outcome = dispatch_run_plan(&seam, &plan);
    assert!(matches!(outcome, RunnerOutcome::Observed { .. }));
    let count: i64 = primary
        .query_row("SELECT COUNT(*) FROM workspaces", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 2);
}

// --- EngineDispatchSeam wiring (real Engine, error paths only -- never spawns) ---

#[test]
fn engine_dispatch_seam_surfaces_harness_start_errors_verbatim() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let seam = EngineDispatchSeam::new(&engine);

    let result = seam.harness_start(
        "req-1",
        serde_json::json!({
            "workspaceId": "does-not-exist",
            "harnessId": "claude",
        }),
    );

    assert!(
        result.is_err(),
        "expected an error for an unregistered workspace"
    );
}

#[test]
fn engine_dispatch_seam_surfaces_session_read_errors_verbatim() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let seam = EngineDispatchSeam::new(&engine);

    let result = seam.session_read("missing-session", "inc-x");

    assert!(result.is_err(), "expected an error for an unknown session");
}

// --- Durable runner history via existing run linkage (V4-A5) ------------

/// `AutomationRun.id = ar:{request_id}` -- the stable linkage
/// `record_run_outcome` derives internally; tests re-derive it the same
/// way to look the row up.
fn automation_run_id_for(request_id: &str) -> String {
    format!("ar:{request_id}")
}

fn seed_scheduled_bot(c: &Connection) {
    insert_workspace(c, "w1", HOST);
    bstorage::create_bot(c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let automation = sample_automation("a1", "b1", Some("w1".to_string()));
    let responsibility = scheduled_responsibility("r1", "a1", true);
    bstorage::create_scheduled_responsibility(c, HOST, FOLDER, "b1", responsibility, automation)
        .unwrap();
}

fn prepare(c: &Connection, event_identity: &str, attempt_at: f64) -> RunPlan {
    ready_plan(
        prepare_run_plan(
            c,
            HOST,
            FOLDER,
            "b1",
            "r1",
            HOST,
            &InvocationReason::ScheduledDue,
            event_identity,
            &harness_params(),
            attempt_at,
        )
        .unwrap(),
    )
}

#[test]
fn record_run_outcome_assigns_fork_style_per_automation_ordinals() {
    let c = conn();
    seed_scheduled_bot(&c);

    let live = RunnerOutcome::Observed {
        session_id: "s1".to_string(),
        incarnation: "inc-1".to_string(),
        verdict: "live".to_string(),
        exit_code: None,
    };
    let first_plan = prepare(&c, "due-100", 100.0);
    record_run_outcome(&c, &first_plan, &live, 100.0).unwrap();
    let first = automations::storage::get_automation_run(
        &c,
        &automation_run_id_for(&first_plan.request_id),
    )
    .unwrap()
    .expect("row must exist");
    assert_eq!(first.run_number, Some(1.0));

    // A genuinely different due event for the SAME automation is a new run:
    // the ordinal advances, matching the fork's nextAutomationRunNumber.
    let second_plan = prepare(&c, "due-200", 200.0);
    assert_ne!(
        second_plan.request_id, first_plan.request_id,
        "different due events must derive different request ids"
    );
    record_run_outcome(&c, &second_plan, &live, 200.0).unwrap();
    let second = automations::storage::get_automation_run(
        &c,
        &automation_run_id_for(&second_plan.request_id),
    )
    .unwrap()
    .expect("row must exist");
    assert_eq!(
        second.run_number,
        Some(2.0),
        "the second run of the same automation takes the next ordinal"
    );

    // A different automation numbers independently from 1.
    insert_workspace(&c, "w2", HOST);
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b2", "Bob", 0.0)).unwrap();
    let other_automation = sample_automation("a2", "b2", Some("w2".to_string()));
    let other_responsibility = scheduled_responsibility("r2", "a2", true);
    bstorage::create_scheduled_responsibility(
        &c,
        HOST,
        FOLDER,
        "b2",
        other_responsibility,
        other_automation,
    )
    .unwrap();
    let other_plan = ready_plan(
        prepare_run_plan(
            &c,
            HOST,
            FOLDER,
            "b2",
            "r2",
            HOST,
            &InvocationReason::ScheduledDue,
            "due-300",
            &harness_params(),
            300.0,
        )
        .unwrap(),
    );
    record_run_outcome(&c, &other_plan, &live, 300.0).unwrap();
    let other = automations::storage::get_automation_run(
        &c,
        &automation_run_id_for(&other_plan.request_id),
    )
    .unwrap()
    .expect("row must exist");
    assert_eq!(
        other.run_number,
        Some(1.0),
        "ordinals are per automation, never global"
    );
}

#[test]
fn record_run_outcome_reopened_db_is_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("drogon-runner-history-idempotency.sqlite3");

    let primary = Connection::open(&path).unwrap();
    automations::storage::migrate(&primary).unwrap();
    bstorage::migrate(&primary).unwrap();
    primary.execute_batch(WORKSPACES_DDL).unwrap();
    seed_scheduled_bot(&primary);

    let plan = prepare(&primary, "due-100", 100.0);
    let outcome = RunnerOutcome::Observed {
        session_id: "s1".to_string(),
        incarnation: "inc-1".to_string(),
        verdict: "live".to_string(),
        exit_code: None,
    };
    record_run_outcome(&primary, &plan, &outcome, 100.0).unwrap();
    drop(primary);

    // A genuinely reopened connection, replaying the identical event.
    let reopened = Connection::open(&path).unwrap();
    record_run_outcome(&reopened, &plan, &outcome, 100.0).unwrap();

    let automation_run_id = automation_run_id_for(&plan.request_id);
    let run_count: i64 = reopened
        .query_row(
            "SELECT COUNT(*) FROM automation_runs WHERE id = ?1",
            [&automation_run_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        run_count, 1,
        "replay must not insert a second automation_run row"
    );

    let responsibility_count: i64 = reopened
        .query_row(
            "SELECT COUNT(*) FROM bot_responsibility_runs WHERE automation_run_id = ?1",
            [&automation_run_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        responsibility_count, 1,
        "replay must not insert a second responsibility_run row"
    );

    let history = bstorage::history_for_bot(&reopened, HOST, FOLDER, "b1").unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(
        history[0].responsibility_run.automation_run_id.as_deref(),
        Some(automation_run_id.as_str())
    );

    let stored = automations::storage::get_automation_run(&reopened, &automation_run_id)
        .unwrap()
        .expect("automation_run row must exist");
    assert_eq!(stored.status, AutomationRunStatus::Dispatched);
    assert_eq!(stored.terminal_session_id.as_deref(), Some("s1"));
    assert_eq!(stored.session_incarnation.as_deref(), Some("inc-1"));
    assert_eq!(stored.observed_at, Some(100.0));
}

#[test]
fn automation_run_exited_is_never_regressed_by_a_later_stale_live_observation() {
    let c = conn();
    seed_scheduled_bot(&c);
    let plan = prepare(&c, "due-100", 100.0);
    let automation_run_id = automation_run_id_for(&plan.request_id);

    // 1) live.
    record_run_outcome(
        &c,
        &plan,
        &RunnerOutcome::Observed {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
            verdict: "live".to_string(),
            exit_code: None,
        },
        100.0,
    )
    .unwrap();

    // 2) exited -- proven terminal.
    record_run_outcome(
        &c,
        &plan,
        &RunnerOutcome::Observed {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
            verdict: "exited".to_string(),
            exit_code: Some(0),
        },
        150.0,
    )
    .unwrap();
    let after_exit = automations::storage::get_automation_run(&c, &automation_run_id)
        .unwrap()
        .expect("row must exist");
    assert_eq!(after_exit.status, AutomationRunStatus::Completed);
    assert_eq!(after_exit.exit_code, Some(0));

    // 3) a later, stale "live" for the SAME incarnation must not regress it.
    record_run_outcome(
        &c,
        &plan,
        &RunnerOutcome::Observed {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
            verdict: "live".to_string(),
            exit_code: None,
        },
        200.0,
    )
    .unwrap();

    let after_stale = automations::storage::get_automation_run(&c, &automation_run_id)
        .unwrap()
        .expect("row must exist");
    assert_eq!(
        after_stale.status,
        AutomationRunStatus::Completed,
        "a proven Exited must never be regressed by a later stale observation"
    );
    assert_eq!(
        after_stale.exit_code,
        Some(0),
        "the exit code recorded at the real exit must survive a later stale observation"
    );
}

#[test]
fn observation_failure_after_admit_records_session_linkage_distinct_from_dispatch_failure() {
    let c = conn();
    seed_scheduled_bot(&c);

    // A session WAS admitted, but observing it failed.
    let observed_plan = prepare(&c, "due-100", 100.0);
    let observation_error = DispatchSeamError {
        code: "unverifiable".to_string(),
        message: "lost contact".to_string(),
    };
    record_run_outcome(
        &c,
        &observed_plan,
        &RunnerOutcome::ObservationFailed {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
            error: observation_error.clone(),
        },
        100.0,
    )
    .unwrap();
    let observed_run = automations::storage::get_automation_run(
        &c,
        &automation_run_id_for(&observed_plan.request_id),
    )
    .unwrap()
    .expect("row must exist");
    assert_eq!(observed_run.status, AutomationRunStatus::Dispatched);
    assert_eq!(observed_run.terminal_session_id.as_deref(), Some("s1"));
    assert_eq!(observed_run.session_incarnation.as_deref(), Some("inc-1"));
    assert_eq!(observed_run.exit_code, None);
    assert_eq!(observed_run.observed_at, Some(100.0));

    let history = bstorage::history_for_bot(&c, HOST, FOLDER, "b1").unwrap();
    let observed_history = history
        .iter()
        .find(|h| h.responsibility_run.id == observed_plan.request_id)
        .unwrap();
    assert_eq!(
        observed_history.responsibility_run.host_observation,
        Some(HostObservation::Unverifiable)
    );
    assert_eq!(observed_history.responsibility_run.ended_at, None);

    // No session was ever admitted at all -- carries no session linkage.
    let failed_plan = prepare(&c, "due-200", 200.0);
    let dispatch_error = DispatchSeamError {
        code: "not_found".to_string(),
        message: "Unknown harness".to_string(),
    };
    record_run_outcome(
        &c,
        &failed_plan,
        &RunnerOutcome::DispatchFailed(dispatch_error.clone()),
        200.0,
    )
    .unwrap();
    let failed_run = automations::storage::get_automation_run(
        &c,
        &automation_run_id_for(&failed_plan.request_id),
    )
    .unwrap()
    .expect("row must exist");
    assert_eq!(failed_run.status, AutomationRunStatus::DispatchFailed);
    assert_eq!(
        failed_run.terminal_session_id, None,
        "a failed dispatch must carry no session linkage"
    );
    assert_eq!(failed_run.session_incarnation, None);
    assert_eq!(failed_run.observed_at, None);
}

#[test]
fn automation_run_error_is_verbatim_for_both_failure_kinds() {
    let c = conn();
    seed_scheduled_bot(&c);

    let observation_error = DispatchSeamError {
        code: "unverifiable".to_string(),
        message: "lost contact".to_string(),
    };
    let observed_plan = prepare(&c, "due-100", 100.0);
    record_run_outcome(
        &c,
        &observed_plan,
        &RunnerOutcome::ObservationFailed {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
            error: observation_error.clone(),
        },
        100.0,
    )
    .unwrap();
    let observed_run = automations::storage::get_automation_run(
        &c,
        &automation_run_id_for(&observed_plan.request_id),
    )
    .unwrap()
    .expect("row must exist");
    assert_eq!(
        observed_run.error,
        Some(observation_error.to_string()),
        "the observation RpcError's code/message must survive verbatim"
    );

    let dispatch_error = DispatchSeamError {
        code: "not_found".to_string(),
        message: "Unknown harness".to_string(),
    };
    let failed_plan = prepare(&c, "due-200", 200.0);
    record_run_outcome(
        &c,
        &failed_plan,
        &RunnerOutcome::DispatchFailed(dispatch_error.clone()),
        200.0,
    )
    .unwrap();
    let failed_run = automations::storage::get_automation_run(
        &c,
        &automation_run_id_for(&failed_plan.request_id),
    )
    .unwrap()
    .expect("row must exist");
    assert_eq!(
        failed_run.error,
        Some(dispatch_error.to_string()),
        "the dispatch RpcError's code/message must survive verbatim"
    );

    // A successful observation carries no error at all.
    let ok_plan = prepare(&c, "due-300", 300.0);
    record_run_outcome(
        &c,
        &ok_plan,
        &RunnerOutcome::Observed {
            session_id: "s2".to_string(),
            incarnation: "inc-2".to_string(),
            verdict: "live".to_string(),
            exit_code: None,
        },
        300.0,
    )
    .unwrap();
    let ok_run =
        automations::storage::get_automation_run(&c, &automation_run_id_for(&ok_plan.request_id))
            .unwrap()
            .expect("row must exist");
    assert_eq!(ok_run.error, None);
}

#[test]
fn record_run_outcome_retry_preserves_created_started_and_session_identity() {
    let c = conn();
    seed_scheduled_bot(&c);

    let first_plan = prepare(&c, "due-100", 100.0);
    record_run_outcome(
        &c,
        &first_plan,
        &RunnerOutcome::Observed {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
            verdict: "live".to_string(),
            exit_code: None,
        },
        100.0,
    )
    .unwrap();
    let automation_run_id = automation_run_id_for(&first_plan.request_id);
    let first = automations::storage::get_automation_run(&c, &automation_run_id)
        .unwrap()
        .expect("row must exist");
    assert_eq!(first.created_at, 100.0);
    assert_eq!(first.started_at, Some(100.0));
    assert_eq!(first.dispatched_at, Some(100.0));
    assert_eq!(
        first.run_number,
        Some(1.0),
        "the fork's nextAutomationRunNumber ordinal is assigned once at creation"
    );

    // A retry of the SAME event (same request_id), observed again later, at
    // a genuinely later wall-clock attempt time, re-admitting the same
    // session/incarnation (a real idempotent redispatch).
    let retry_plan = prepare(&c, "due-100", 200.0);
    assert_eq!(
        retry_plan.request_id, first_plan.request_id,
        "the retry must derive the identical request_id"
    );
    record_run_outcome(
        &c,
        &retry_plan,
        &RunnerOutcome::Observed {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
            verdict: "live".to_string(),
            exit_code: None,
        },
        200.0,
    )
    .unwrap();

    let retried = automations::storage::get_automation_run(&c, &automation_run_id)
        .unwrap()
        .expect("row must exist");
    assert_eq!(
        retried.created_at, 100.0,
        "created_at must be preserved from the first insert, not overwritten by the retry"
    );
    assert_eq!(
        retried.started_at,
        Some(100.0),
        "started_at must be preserved from the first insert, not overwritten by the retry"
    );
    assert_eq!(
        retried.dispatched_at,
        Some(100.0),
        "dispatched_at is the FIRST dispatch time, frozen forever -- the retry's own \
         (later) attempt_at must never rewrite it"
    );
    assert_eq!(
        retried.run_number,
        Some(1.0),
        "run_number must stay untouched by the retry"
    );
    assert_eq!(retried.terminal_session_id.as_deref(), Some("s1"));
    assert_eq!(retried.session_incarnation.as_deref(), Some("inc-1"));
    assert_eq!(
        retried.observed_at,
        Some(200.0),
        "observed_at legitimately advances on a genuine, non-stale later observation"
    );
    assert_eq!(
        retried.occurrence_count, None,
        "retries must not touch occurrence_count"
    );
    assert_eq!(
        retried.last_occurrence_at, None,
        "retries must not touch last_occurrence_at"
    );
}

// --- V4-A5b: responsibility projection from the ACCEPTED row -------------
//
// Reproduces the ROOT-gating regression this module previously had:
// `record_run_outcome` used to build `ResponsibilityRun.host_observation`/
// `ended_at` straight from the incoming `outcome`, not from the ACCEPTED,
// already-terminal-guarded `AutomationRun` row -- so a later stale
// live/unverifiable replay for the same (already `Completed`) incarnation
// regressed the responsibility row back off `Exited`, with `ended_at`
// left inconsistently `Some` by `bots_storage::record_responsibility_run`'s
// own null-merge. Both sequences below assert BOTH durable rows (via
// `automations::storage::get_automation_run` and `history_for_bot`) never
// regress, that `dispatched_at` stays frozen at the very first dispatch
// despite later replays supplying later `plan.attempt_at`s, and that
// `observed_at` on the accepted row equals exactly the observation time
// each call injected (proving the new explicit parameter, distinct from
// `plan.attempt_at`, is what is actually threaded through).

#[test]
fn live_then_exited_then_stale_live_never_regresses_either_row() {
    let c = conn();
    seed_scheduled_bot(&c);
    let plan = prepare(&c, "due-100", 100.0);
    let automation_run_id = automation_run_id_for(&plan.request_id);

    // 1) live, observed at t=10 (dispatch attempt itself is t=100).
    record_run_outcome(
        &c,
        &plan,
        &RunnerOutcome::Observed {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
            verdict: "live".to_string(),
            exit_code: None,
        },
        10.0,
    )
    .unwrap();

    // 2) exited, observed at t=20 -- proven terminal.
    record_run_outcome(
        &c,
        &plan,
        &RunnerOutcome::Observed {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
            verdict: "exited".to_string(),
            exit_code: Some(0),
        },
        20.0,
    )
    .unwrap();

    // 3) a later, stale "live" for the SAME incarnation, observed at t=30.
    record_run_outcome(
        &c,
        &plan,
        &RunnerOutcome::Observed {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
            verdict: "live".to_string(),
            exit_code: None,
        },
        30.0,
    )
    .unwrap();

    let automation_run = automations::storage::get_automation_run(&c, &automation_run_id)
        .unwrap()
        .expect("row must exist");
    assert_eq!(
        automation_run.status,
        AutomationRunStatus::Completed,
        "a proven Exited AutomationRun must never be regressed by a later stale live observation"
    );
    assert_eq!(automation_run.exit_code, Some(0));
    assert_eq!(
        automation_run.observed_at,
        Some(20.0),
        "the terminal guard freezes observed_at at the real exit's own injected time"
    );
    assert_eq!(
        automation_run.dispatched_at,
        Some(100.0),
        "dispatched_at stays the FIRST dispatch's plan.attempt_at, never a later replay's"
    );

    let history = bstorage::history_for_bot(&c, HOST, FOLDER, "b1").unwrap();
    let run = &history
        .iter()
        .find(|h| h.responsibility_run.id == plan.request_id)
        .unwrap()
        .responsibility_run;
    assert_eq!(
        run.host_observation,
        Some(HostObservation::Exited),
        "a stale live replay after a proven exit must never regress the responsibility row off Exited"
    );
    assert_eq!(
        run.ended_at,
        Some(20.0),
        "ended_at must follow the accepted AutomationRun's own observed_at, staying consistent \
         with host_observation=Exited rather than dangling from a stale re-derivation"
    );
}

#[test]
fn live_then_exited_then_stale_unverifiable_never_regresses_either_row() {
    let c = conn();
    seed_scheduled_bot(&c);
    let plan = prepare(&c, "due-100", 100.0);
    let automation_run_id = automation_run_id_for(&plan.request_id);

    // 1) live, observed at t=10.
    record_run_outcome(
        &c,
        &plan,
        &RunnerOutcome::Observed {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
            verdict: "live".to_string(),
            exit_code: None,
        },
        10.0,
    )
    .unwrap();

    // 2) exited, observed at t=20 -- proven terminal.
    record_run_outcome(
        &c,
        &plan,
        &RunnerOutcome::Observed {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
            verdict: "exited".to_string(),
            exit_code: Some(0),
        },
        20.0,
    )
    .unwrap();

    // 3) a later, stale failed poll for the SAME incarnation, at t=30.
    let poll_error = DispatchSeamError {
        code: "unverifiable".to_string(),
        message: "lost contact".to_string(),
    };
    record_run_outcome(
        &c,
        &plan,
        &RunnerOutcome::ObservationFailed {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
            error: poll_error,
        },
        30.0,
    )
    .unwrap();

    let automation_run = automations::storage::get_automation_run(&c, &automation_run_id)
        .unwrap()
        .expect("row must exist");
    assert_eq!(
        automation_run.status,
        AutomationRunStatus::Completed,
        "a proven Exited AutomationRun must never be regressed by a later stale failed poll"
    );
    assert_eq!(automation_run.exit_code, Some(0));
    assert_eq!(automation_run.observed_at, Some(20.0));
    assert_eq!(
        automation_run.dispatched_at,
        Some(100.0),
        "dispatched_at stays the FIRST dispatch's plan.attempt_at, never a later replay's"
    );

    let history = bstorage::history_for_bot(&c, HOST, FOLDER, "b1").unwrap();
    let run = &history
        .iter()
        .find(|h| h.responsibility_run.id == plan.request_id)
        .unwrap()
        .responsibility_run;
    assert_eq!(
        run.host_observation,
        Some(HostObservation::Exited),
        "a stale failed-poll replay after a proven exit must never regress the responsibility \
         row to Unverifiable"
    );
    assert_eq!(
        run.ended_at,
        Some(20.0),
        "ended_at must stay consistent with host_observation=Exited"
    );
}

// --- V4-A5c: atomic both-row record transaction --------------------------
//
// Reproduces a second, distinct hole left by the V4-A5b fix above: for a
// NON-terminal existing row (`Dispatched`, never `Completed`), a later
// out-of-order (stale `observed_at`) replay was correctly rejected by the
// `AutomationRun` upsert (the row itself was left untouched), but
// `record_run_outcome` still built a FRESH `ResponsibilityRun` projection
// straight from the raw incoming `outcome` regardless -- regressing the
// responsibility row even though the durable `AutomationRun` it is
// supposed to mirror never changed. It also proves `record_run_outcome`
// now opens exactly one `BEGIN IMMEDIATE` transaction shared by both
// writes (a genuine mid-transaction failure on the second write rolls
// back the first), and that a session/incarnation mismatch for the same
// `request_id` is refused outright rather than silently overwriting the
// existing linkage.

fn history_row(c: &Connection, bot_id: &str, request_id: &str) -> ResponsibilityRun {
    bstorage::history_for_bot(c, HOST, FOLDER, bot_id)
        .unwrap()
        .into_iter()
        .find(|h| h.responsibility_run.id == request_id)
        .expect("responsibility run row must exist")
        .responsibility_run
}

#[test]
fn stale_nonterminal_observation_never_regresses_the_responsibility_row() {
    let c = conn();
    seed_scheduled_bot(&c);
    let plan = prepare(&c, "due-100", 100.0);
    let automation_run_id = automation_run_id_for(&plan.request_id);

    // 1) live, observed at t=100 -- non-terminal (`Dispatched`).
    record_run_outcome(
        &c,
        &plan,
        &RunnerOutcome::Observed {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
            verdict: "live".to_string(),
            exit_code: None,
        },
        100.0,
    )
    .unwrap();

    let before_run = automations::storage::get_automation_run(&c, &automation_run_id)
        .unwrap()
        .expect("row must exist");
    assert_eq!(before_run.status, AutomationRunStatus::Dispatched);
    let before_responsibility = history_row(&c, "b1", &plan.request_id);
    assert_eq!(
        before_responsibility.host_observation,
        Some(HostObservation::Live)
    );
    assert_eq!(before_responsibility.ended_at, None);

    // 2) a later-arriving but OUT-OF-ORDER (earlier `observed_at`) failed
    // poll for the SAME incarnation -- rejected as stale, must not touch
    // either durable row.
    let poll_error = DispatchSeamError {
        code: "unverifiable".to_string(),
        message: "lost contact".to_string(),
    };
    record_run_outcome(
        &c,
        &plan,
        &RunnerOutcome::ObservationFailed {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
            error: poll_error,
        },
        50.0,
    )
    .unwrap();

    let after_run = automations::storage::get_automation_run(&c, &automation_run_id)
        .unwrap()
        .expect("row must exist");
    assert_eq!(
        after_run, before_run,
        "a stale non-terminal replay must leave the AutomationRun row byte-identical"
    );

    let after_responsibility = history_row(&c, "b1", &plan.request_id);
    assert_eq!(
        after_responsibility, before_responsibility,
        "a stale non-terminal replay must leave the ResponsibilityRun row byte-identical -- \
         never re-derived from the rejected replay's own outcome"
    );
}

#[test]
fn session_incarnation_mismatch_for_the_same_request_id_is_an_ownership_violation() {
    let c = conn();
    seed_scheduled_bot(&c);
    let plan = prepare(&c, "due-100", 100.0);
    let automation_run_id = automation_run_id_for(&plan.request_id);

    record_run_outcome(
        &c,
        &plan,
        &RunnerOutcome::Observed {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
            verdict: "live".to_string(),
            exit_code: None,
        },
        100.0,
    )
    .unwrap();

    let before_run = automations::storage::get_automation_run(&c, &automation_run_id)
        .unwrap()
        .expect("row must exist");
    let before_responsibility = history_row(&c, "b1", &plan.request_id);

    // Same `request_id` (so the same `ar:{request_id}` linkage), but a
    // DIFFERENT session/incarnation -- never a legitimate replay under this
    // build's deterministic request_id, so it must be refused rather than
    // silently overwriting the existing linkage.
    let result = record_run_outcome(
        &c,
        &plan,
        &RunnerOutcome::Observed {
            session_id: "s2".to_string(),
            incarnation: "inc-2".to_string(),
            verdict: "live".to_string(),
            exit_code: None,
        },
        200.0,
    );
    assert!(
        matches!(result, Err(bstorage::StorageError::OwnershipViolation(_))),
        "a session/incarnation mismatch for the same request_id must be an OwnershipViolation, \
         got {result:?}"
    );

    let after_run = automations::storage::get_automation_run(&c, &automation_run_id)
        .unwrap()
        .expect("row must exist");
    assert_eq!(
        after_run, before_run,
        "a refused linkage mismatch must leave the AutomationRun row untouched"
    );
    let after_responsibility = history_row(&c, "b1", &plan.request_id);
    assert_eq!(
        after_responsibility, before_responsibility,
        "a refused linkage mismatch must leave the ResponsibilityRun row untouched"
    );

    let run_count: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM bot_responsibility_runs WHERE automation_run_id = ?1",
            [&automation_run_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        run_count, 1,
        "the refused call must never insert a second row"
    );
}

#[test]
fn a_mid_transaction_failure_on_the_responsibility_write_rolls_back_the_automation_run_write_too() {
    let c = conn();
    seed_scheduled_bot(&c);
    let plan = prepare(&c, "due-100", 100.0);
    let automation_run_id = automation_run_id_for(&plan.request_id);

    // A concurrent delete of the Bot between plan preparation and
    // recording: the linked `AutomationRun` upsert (the FIRST write in the
    // shared transaction) would still succeed in isolation, but the
    // `ResponsibilityRun` write (the SECOND) now genuinely fails --
    // `record_responsibility_run_in_tx` requires the Bot to exist. Both
    // writes share one `BEGIN IMMEDIATE` transaction, so this real failure
    // must roll back the already-applied first write too.
    assert!(bstorage::delete_bot(&c, HOST, FOLDER, "b1").unwrap());

    let result = record_run_outcome(
        &c,
        &plan,
        &RunnerOutcome::Observed {
            session_id: "s1".to_string(),
            incarnation: "inc-1".to_string(),
            verdict: "live".to_string(),
            exit_code: None,
        },
        100.0,
    );
    assert!(
        result.is_err(),
        "the responsibility write must fail: its owning Bot no longer exists"
    );

    let stored = automations::storage::get_automation_run(&c, &automation_run_id).unwrap();
    assert!(
        stored.is_none(),
        "the AutomationRun upsert must roll back together with the failed responsibility write, \
         never left as an orphaned committed row"
    );

    let run_count: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM bot_responsibility_runs WHERE automation_run_id = ?1",
            [&automation_run_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        run_count, 0,
        "no responsibility run row may be committed when its own write failed"
    );
}
