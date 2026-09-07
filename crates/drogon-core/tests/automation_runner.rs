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

    record_run_outcome(&c, &plan, &outcome).unwrap();

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
    record_run_outcome(&c, &plan, &outcome).unwrap();

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

    record_run_outcome(&c, &plan, &outcome).unwrap();

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

    record_run_outcome(&c, &plan, &outcome).unwrap();

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
    record_run_outcome(&primary, &plan, &outcome).unwrap();
    drop(primary);

    // A genuinely reopened connection, replaying the identical event.
    let reopened = Connection::open(&path).unwrap();
    record_run_outcome(&reopened, &plan, &outcome).unwrap();

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
    )
    .unwrap();
    let automation_run_id = automation_run_id_for(&first_plan.request_id);
    let first = automations::storage::get_automation_run(&c, &automation_run_id)
        .unwrap()
        .expect("row must exist");
    assert_eq!(first.created_at, 100.0);
    assert_eq!(first.started_at, Some(100.0));
    assert_eq!(first.run_number, None);

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
    assert_eq!(retried.run_number, None, "run_number must stay untouched");
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
