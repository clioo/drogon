//! Tests for Bot-side responsibility-level dispatch gating
//! (`crate::bots::policy`), composed over
//! `automations::execution::evaluate_and_attempt_dispatch` -- see
//! `docs/migration/native-bot-state-contract.md`'s "Execution remains
//! explicit" for the contract this module derives from, and
//! `automation_execution.rs`/`bot_storage.rs` for the sibling suites this
//! one composes on top of.
#![allow(dead_code)]

use drogon_core::automations;
use drogon_core::automations::execution::{DispatchRefusal, InvocationReason, JobOutcome};
use drogon_core::automations::records::*;
use drogon_core::bots::policy::{
    self, ResponsibilityDispatchAttempt, ResponsibilityJobOutcome, ResponsibilityLookupError,
    ResponsibilityRefusal,
};
use drogon_core::bots::records::*;
use drogon_core::bots::storage as bstorage;
use rusqlite::Connection;

const HOST: &str = "host-1";
const OTHER_HOST: &str = "host-2";
const FOLDER: &str = "/repo";

fn conn() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    automations::storage::migrate(&conn).unwrap();
    bstorage::migrate(&conn).unwrap();
    conn
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

fn sample_automation(id: &str, bot_id: &str) -> Automation {
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
        workspace_id: None,
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

// --- Pure evaluation: disabled wins regardless of trigger/automation -----

#[test]
fn disabled_scheduled_responsibility_refuses_even_with_an_eligible_owned_automation() {
    let automation = sample_automation("a1", "b1");
    let responsibility = scheduled_responsibility("r1", "a1", false);
    let attempt = policy::evaluate_and_attempt_responsibility_dispatch(
        &responsibility,
        Some(&automation),
        HOST,
        &InvocationReason::ScheduledDue,
    );
    assert_eq!(
        attempt,
        ResponsibilityDispatchAttempt::RefusedByResponsibility(ResponsibilityRefusal::Disabled)
    );
}

#[test]
fn disabled_reactive_responsibility_refuses_even_with_a_supplied_event() {
    let responsibility = reactive_responsibility("r1", None, false);
    let attempt = policy::evaluate_and_attempt_responsibility_dispatch(
        &responsibility,
        None,
        HOST,
        &InvocationReason::ReactiveEvent(Some("push".to_string())),
    );
    assert_eq!(
        attempt,
        ResponsibilityDispatchAttempt::RefusedByResponsibility(ResponsibilityRefusal::Disabled)
    );
}

// --- Reactive: never acquires/runs from manual or scheduled-due reasons --

#[test]
fn reactive_responsibility_refuses_manual_invocation() {
    let responsibility = reactive_responsibility("r1", None, true);
    let attempt = policy::evaluate_and_attempt_responsibility_dispatch(
        &responsibility,
        None,
        HOST,
        &InvocationReason::Manual,
    );
    assert_eq!(
        attempt,
        ResponsibilityDispatchAttempt::RefusedByResponsibility(
            ResponsibilityRefusal::ReactiveRequiresSuppliedEvent(InvocationReason::Manual)
        )
    );
}

#[test]
fn reactive_responsibility_refuses_scheduled_due_invocation() {
    let responsibility = reactive_responsibility("r1", None, true);
    let attempt = policy::evaluate_and_attempt_responsibility_dispatch(
        &responsibility,
        None,
        HOST,
        &InvocationReason::ScheduledDue,
    );
    assert_eq!(
        attempt,
        ResponsibilityDispatchAttempt::RefusedByResponsibility(
            ResponsibilityRefusal::ReactiveRequiresSuppliedEvent(InvocationReason::ScheduledDue)
        )
    );
}

#[test]
fn reactive_responsibility_refuses_polling_with_no_event() {
    let responsibility = reactive_responsibility("r1", None, true);
    let attempt = policy::evaluate_and_attempt_responsibility_dispatch(
        &responsibility,
        None,
        HOST,
        &InvocationReason::ReactiveEvent(None),
    );
    assert_eq!(
        attempt,
        ResponsibilityDispatchAttempt::RefusedByResponsibility(
            ResponsibilityRefusal::ReactiveRequiresSuppliedEvent(InvocationReason::ReactiveEvent(
                None
            ))
        )
    );
}

#[test]
fn reactive_responsibility_with_a_supplied_event_dispatches_the_typed_unsupported_stub() {
    let responsibility = reactive_responsibility("r1", None, true);
    let attempt = policy::evaluate_and_attempt_responsibility_dispatch(
        &responsibility,
        None,
        HOST,
        &InvocationReason::ReactiveEvent(Some("push".to_string())),
    );
    assert_eq!(
        attempt,
        ResponsibilityDispatchAttempt::Dispatched(
            ResponsibilityJobOutcome::UnsupportedReactiveDispatch
        )
    );
}

#[test]
fn reactive_responsibility_never_delegates_to_automation_evaluation_even_when_one_is_supplied() {
    // Even if a caller mistakenly hands this a resolved automation, a
    // reactive trigger must never delegate to it -- "reactive
    // responsibilities do not acquire an automation merely to share a
    // code path."
    let responsibility = reactive_responsibility("r1", None, true);
    let foreign_automation = sample_automation("a1", "someone-else");
    let attempt = policy::evaluate_and_attempt_responsibility_dispatch(
        &responsibility,
        Some(&foreign_automation),
        HOST,
        &InvocationReason::ReactiveEvent(Some("push".to_string())),
    );
    assert_eq!(
        attempt,
        ResponsibilityDispatchAttempt::Dispatched(
            ResponsibilityJobOutcome::UnsupportedReactiveDispatch
        )
    );
}

// --- Scheduled: requires an owned automation before automation eval ------

#[test]
fn scheduled_responsibility_without_a_resolved_owned_automation_refuses_before_automation_eval() {
    let responsibility = scheduled_responsibility("r1", "a1", true);
    let attempt = policy::evaluate_and_attempt_responsibility_dispatch(
        &responsibility,
        None,
        HOST,
        &InvocationReason::ScheduledDue,
    );
    assert_eq!(
        attempt,
        ResponsibilityDispatchAttempt::RefusedByResponsibility(
            ResponsibilityRefusal::UnownedAutomation("a1".to_string())
        )
    );
}

#[test]
fn scheduled_responsibility_with_an_owned_automation_delegates_to_automation_evaluation() {
    let mut automation = sample_automation("a1", "b1");
    automation.execution_target_id = OTHER_HOST.to_string();
    let responsibility = scheduled_responsibility("r1", "a1", true);
    let attempt = policy::evaluate_and_attempt_responsibility_dispatch(
        &responsibility,
        Some(&automation),
        HOST,
        &InvocationReason::ScheduledDue,
    );
    assert_eq!(
        attempt,
        ResponsibilityDispatchAttempt::RefusedByAutomation(DispatchRefusal::ForeignHost {
            execution_target_type: ExecutionTargetType::Local,
            execution_target_id: OTHER_HOST.to_string(),
            current_host_id: HOST.to_string(),
        })
    );
}

#[test]
fn scheduled_responsibility_with_an_eligible_owned_automation_dispatches() {
    let automation = sample_automation("a1", "b1");
    let responsibility = scheduled_responsibility("r1", "a1", true);
    let attempt = policy::evaluate_and_attempt_responsibility_dispatch(
        &responsibility,
        Some(&automation),
        HOST,
        &InvocationReason::ScheduledDue,
    );
    assert_eq!(
        attempt,
        ResponsibilityDispatchAttempt::Dispatched(ResponsibilityJobOutcome::Automation(
            JobOutcome::UnsupportedSessionSpawn
        ))
    );
}

// --- Storage-composed: real ownership resolution via require_owned_automation

#[test]
fn from_storage_refuses_a_scheduled_responsibility_whose_automation_is_owned_by_a_different_bot() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b2", "Bob", 0.0)).unwrap();
    // "a1" is owned by b2, but b1's own responsibility record still claims it.
    let foreign_automation = sample_automation("a1", "b2");
    automations::storage::insert_new_automation(&c, &foreign_automation).unwrap();
    let mut bot1 = bstorage::get_bot(&c, HOST, FOLDER, "b1").unwrap().unwrap();
    bot1.responsibilities
        .push(scheduled_responsibility("r1", "a1", true));
    bstorage::update_bot(&c, HOST, FOLDER, "b1", 1.0, |b| {
        b.responsibilities = bot1.responsibilities.clone();
    })
    .unwrap();

    let attempt = policy::evaluate_and_attempt_responsibility_dispatch_from_storage(
        &c,
        HOST,
        FOLDER,
        "b1",
        "r1",
        HOST,
        &InvocationReason::ScheduledDue,
    )
    .unwrap();
    assert_eq!(
        attempt,
        ResponsibilityDispatchAttempt::RefusedByResponsibility(
            ResponsibilityRefusal::UnownedAutomation("a1".to_string())
        )
    );
}

#[test]
fn from_storage_refuses_a_scheduled_responsibility_whose_automation_does_not_exist() {
    let c = conn();
    let mut bot = sample_bot("b1", "Alice", 0.0);
    bot.responsibilities
        .push(scheduled_responsibility("r1", "missing-automation", true));
    bstorage::create_bot(&c, HOST, FOLDER, &bot).unwrap();

    let attempt = policy::evaluate_and_attempt_responsibility_dispatch_from_storage(
        &c,
        HOST,
        FOLDER,
        "b1",
        "r1",
        HOST,
        &InvocationReason::ScheduledDue,
    )
    .unwrap();
    assert_eq!(
        attempt,
        ResponsibilityDispatchAttempt::RefusedByResponsibility(
            ResponsibilityRefusal::UnownedAutomation("missing-automation".to_string())
        )
    );
}

#[test]
fn from_storage_dispatches_a_scheduled_responsibility_with_a_genuinely_owned_automation() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();
    let automation = sample_automation("a1", "b1");
    let responsibility = scheduled_responsibility("r1", "a1", true);
    bstorage::create_scheduled_responsibility(&c, HOST, FOLDER, "b1", responsibility, automation)
        .unwrap();

    let attempt = policy::evaluate_and_attempt_responsibility_dispatch_from_storage(
        &c,
        HOST,
        FOLDER,
        "b1",
        "r1",
        HOST,
        &InvocationReason::ScheduledDue,
    )
    .unwrap();
    assert_eq!(
        attempt,
        ResponsibilityDispatchAttempt::Dispatched(ResponsibilityJobOutcome::Automation(
            JobOutcome::UnsupportedSessionSpawn
        ))
    );
}

#[test]
fn from_storage_distinguishes_missing_bot_from_missing_responsibility() {
    let c = conn();
    bstorage::create_bot(&c, HOST, FOLDER, &sample_bot("b1", "Alice", 0.0)).unwrap();

    let missing_bot = policy::evaluate_and_attempt_responsibility_dispatch_from_storage(
        &c,
        HOST,
        FOLDER,
        "ghost-bot",
        "r1",
        HOST,
        &InvocationReason::ScheduledDue,
    );
    assert!(matches!(
        missing_bot,
        Err(ResponsibilityLookupError::BotNotFound)
    ));

    let missing_responsibility = policy::evaluate_and_attempt_responsibility_dispatch_from_storage(
        &c,
        HOST,
        FOLDER,
        "b1",
        "ghost-responsibility",
        HOST,
        &InvocationReason::ScheduledDue,
    );
    assert!(matches!(
        missing_responsibility,
        Err(ResponsibilityLookupError::ResponsibilityNotFound)
    ));
}

// --- Durability end-to-end: record run -> history shape -> reopen --------

/// `record_responsibility_run` -> `history_for_bot` row shape (newest-first,
/// null-join markers preserved for a reactive run with no automation link)
/// -> a genuine close+reopen of the database file re-derives the identical
/// gating decision for both a scheduled and a reactive responsibility on
/// the same Bot.
#[test]
fn responsibility_run_history_and_gating_decision_survive_a_real_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.sqlite3");

    {
        let c = Connection::open(&path).unwrap();
        automations::storage::migrate(&c).unwrap();
        bstorage::migrate(&c).unwrap();

        let mut bot = sample_bot("b1", "Alice", 0.0);
        bot.responsibilities
            .push(reactive_responsibility("r2", None, true));
        bstorage::create_bot(&c, HOST, FOLDER, &bot).unwrap();

        let automation = sample_automation("a1", "b1");
        let scheduled = scheduled_responsibility("r1", "a1", true);
        bstorage::create_scheduled_responsibility(&c, HOST, FOLDER, "b1", scheduled, automation)
            .unwrap();

        bstorage::record_responsibility_run(
            &c,
            HOST,
            FOLDER,
            ResponsibilityRun {
                id: "run-scheduled".to_string(),
                bot_id: "b1".to_string(),
                responsibility_id: "r1".to_string(),
                automation_id: Some("a1".to_string()),
                automation_run_id: None,
                started_at: 1.0,
                ended_at: None,
                recipe: Some(RecipeLink {
                    recipe_ref: "sweep-recipe".to_string(),
                    run_id: None,
                    evidence_path: None,
                }),
                host_observation: Some(HostObservation::Live),
                invocation: Some(ResponsibilityRunInvocation::Scheduled),
            },
        )
        .unwrap();
        bstorage::record_responsibility_run(
            &c,
            HOST,
            FOLDER,
            ResponsibilityRun {
                id: "run-reactive".to_string(),
                bot_id: "b1".to_string(),
                responsibility_id: "r2".to_string(),
                automation_id: None,
                automation_run_id: None,
                started_at: 2.0,
                ended_at: None,
                recipe: None,
                host_observation: None,
                invocation: Some(ResponsibilityRunInvocation::Manual),
            },
        )
        .unwrap();

        let history = bstorage::history_for_bot(&c, HOST, FOLDER, "b1").unwrap();
        let ids: Vec<&str> = history
            .iter()
            .map(|h| h.responsibility_run.id.as_str())
            .collect();
        assert_eq!(
            ids,
            vec!["run-reactive", "run-scheduled"],
            "newest (started_at 2.0) must sort before oldest (started_at 1.0)"
        );
        assert!(
            history[0].automation.is_none(),
            "the reactive run carries no automation_id -> null join, never synthesized"
        );
        assert!(
            history[1].automation.is_some(),
            "the scheduled run's real owned automation must resolve, not null-join"
        );

        let before_scheduled = policy::evaluate_and_attempt_responsibility_dispatch_from_storage(
            &c,
            HOST,
            FOLDER,
            "b1",
            "r1",
            HOST,
            &InvocationReason::ScheduledDue,
        )
        .unwrap();
        assert_eq!(
            before_scheduled,
            ResponsibilityDispatchAttempt::Dispatched(ResponsibilityJobOutcome::Automation(
                JobOutcome::UnsupportedSessionSpawn
            ))
        );
        let before_reactive = policy::evaluate_and_attempt_responsibility_dispatch_from_storage(
            &c,
            HOST,
            FOLDER,
            "b1",
            "r2",
            HOST,
            &InvocationReason::ReactiveEvent(None),
        )
        .unwrap();
        assert_eq!(
            before_reactive,
            ResponsibilityDispatchAttempt::RefusedByResponsibility(
                ResponsibilityRefusal::ReactiveRequiresSuppliedEvent(
                    InvocationReason::ReactiveEvent(None)
                )
            )
        );
    }

    // Genuine reopen: a fresh connection, fresh process-level state, no
    // in-memory decision anywhere to go stale against.
    let c = Connection::open(&path).unwrap();
    automations::storage::migrate(&c).unwrap();
    bstorage::migrate(&c).unwrap();

    let history = bstorage::history_for_bot(&c, HOST, FOLDER, "b1").unwrap();
    let ids: Vec<&str> = history
        .iter()
        .map(|h| h.responsibility_run.id.as_str())
        .collect();
    assert_eq!(ids, vec!["run-reactive", "run-scheduled"]);
    assert!(history[0].automation.is_none());
    assert!(history[1].automation.is_some());
    assert_eq!(
        history[1]
            .responsibility_run
            .recipe
            .as_ref()
            .unwrap()
            .recipe_ref,
        "sweep-recipe",
        "recorded run payload fields must survive the reopen unchanged"
    );

    let after_scheduled = policy::evaluate_and_attempt_responsibility_dispatch_from_storage(
        &c,
        HOST,
        FOLDER,
        "b1",
        "r1",
        HOST,
        &InvocationReason::ScheduledDue,
    )
    .unwrap();
    assert_eq!(
        after_scheduled,
        ResponsibilityDispatchAttempt::Dispatched(ResponsibilityJobOutcome::Automation(
            JobOutcome::UnsupportedSessionSpawn
        )),
        "the re-derived scheduled decision must be identical after reopen"
    );
    let after_reactive = policy::evaluate_and_attempt_responsibility_dispatch_from_storage(
        &c,
        HOST,
        FOLDER,
        "b1",
        "r2",
        HOST,
        &InvocationReason::ReactiveEvent(None),
    )
    .unwrap();
    assert_eq!(
        after_reactive,
        ResponsibilityDispatchAttempt::RefusedByResponsibility(
            ResponsibilityRefusal::ReactiveRequiresSuppliedEvent(InvocationReason::ReactiveEvent(
                None
            ))
        ),
        "the re-derived reactive refusal must be identical after reopen"
    );
}

// --- Dispatch-time harness policy resolution (issue #188) -----------------

fn bot_with_policy(default_harness: &str, explicit_model: Option<&str>) -> Bot {
    let mut bot = sample_bot("b-policy", "Resolver", 0.0);
    bot.harness_policy = HarnessModelPolicy {
        default_harness: default_harness.to_string(),
        explicit_model: explicit_model.map(str::to_string),
    };
    bot
}

#[test]
fn harness_overrides_split_the_stored_provider_model_string_for_pi() {
    let resolved = policy::harness_overrides(&bot_with_policy(
        "pi",
        Some("dgx-spark/qwen3.8-flash-next-nvidia-nvfp4"),
    ));
    assert_eq!(resolved.harness_id, "pi");
    assert_eq!(resolved.provider.as_deref(), Some("dgx-spark"));
    assert_eq!(
        resolved.model.as_deref(),
        Some("qwen3.8-flash-next-nvidia-nvfp4")
    );
    assert_eq!(resolved.permission_mode.as_deref(), Some("unattended"));
}

#[test]
fn harness_overrides_keep_a_bare_model_without_provider() {
    let resolved = policy::harness_overrides(&bot_with_policy("pi", Some("qwen-local")));
    assert_eq!(resolved.provider, None);
    assert_eq!(resolved.model.as_deref(), Some("qwen-local"));
    assert_eq!(resolved.permission_mode.as_deref(), Some("unattended"));
}

#[test]
fn harness_overrides_leave_non_pi_harnesses_inherited() {
    let resolved = policy::harness_overrides(&bot_with_policy(
        "claude",
        Some("dgx-spark/qwen3.8-flash-next-nvidia-nvfp4"),
    ));
    assert_eq!(resolved.harness_id, "claude");
    assert_eq!(resolved.provider.as_deref(), Some("dgx-spark"));
    assert_eq!(
        resolved.model.as_deref(),
        Some("qwen3.8-flash-next-nvidia-nvfp4")
    );
    assert_eq!(resolved.permission_mode, None);
}

#[test]
fn harness_overrides_treat_null_and_blank_models_as_no_override() {
    for stored in [None, Some(""), Some("   ")] {
        let resolved = policy::harness_overrides(&bot_with_policy("pi", stored));
        assert_eq!(resolved.model, None, "stored model {stored:?}");
        assert_eq!(resolved.provider, None, "stored model {stored:?}");
        // The Pi unattended rule never depends on the model string.
        assert_eq!(resolved.permission_mode.as_deref(), Some("unattended"));
    }
}

#[test]
fn harness_overrides_keep_edge_slash_strings_as_bare_model_ids() {
    // The source's `slash > 0`/`slash < len - 1` guard sends these to the
    // bare-model branch with the whole string intact (Pi also accepts
    // slash-bearing bare ids); only a mid-string slash splits.
    for stored in [Some("/model"), Some("provider/")] {
        let resolved = policy::harness_overrides(&bot_with_policy("pi", stored));
        assert_eq!(resolved.model, stored.map(str::to_string));
        assert_eq!(resolved.provider, None);
    }
}
