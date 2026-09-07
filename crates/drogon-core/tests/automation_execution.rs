//! Tests for the pure domain-logic dispatch evaluation in
//! `crate::automations::execution`. There is no pinned upstream source
//! module for this behavior (the source has no comparable pure evaluator;
//! scheduling/dispatch decisions live inline in its scheduler service) --
//! see `docs/migration/native-bot-state-contract.md`'s "Execution remains
//! explicit" for the contract these tests derive from directly.
#![allow(dead_code)]

use drogon_core::automations::execution::{
    self, DispatchAttempt, DispatchDecision, DispatchLookupError, DispatchRefusal,
    InvocationReason, JobOutcome,
};
use drogon_core::automations::records::*;
use drogon_core::automations::storage;
use rusqlite::Connection;

const HOST: &str = "host-a";
const OTHER_HOST: &str = "host-b";

fn conn() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    storage::migrate(&conn).unwrap();
    conn
}

fn sample_automation(id: &str) -> Automation {
    Automation {
        id: id.to_string(),
        creation_key: None,
        name: "nightly sweep".to_string(),
        prompt: "do the thing".to_string(),
        precheck: None,
        agent_id: "codex".to_string(),
        run_context: None,
        source_context: None,
        project_id: "proj-1".to_string(),
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
        next_run_at: 1000.0,
        last_run_at: None,
        missed_run_policy: MissedRunPolicy::RunOnceWithinGrace,
        missed_run_grace_minutes: 30.0,
        created_at: 0.0,
        updated_at: 0.0,
        bot_id: None,
    }
}

// --- Pure evaluation: host fencing ---------------------------------------

#[test]
fn local_automation_owned_by_the_current_host_is_eligible() {
    let a = sample_automation("a1");
    let decision = execution::evaluate_dispatch(&a, HOST, &InvocationReason::ScheduledDue);
    assert_eq!(decision, DispatchDecision::Eligible);
}

#[test]
fn local_automation_owned_by_a_different_host_is_refused_as_foreign() {
    let a = sample_automation("a1");
    let decision = execution::evaluate_dispatch(&a, OTHER_HOST, &InvocationReason::ScheduledDue);
    assert_eq!(
        decision,
        DispatchDecision::Refused(DispatchRefusal::ForeignHost {
            execution_target_type: ExecutionTargetType::Local,
            execution_target_id: HOST.to_string(),
            current_host_id: OTHER_HOST.to_string(),
        })
    );
}

#[test]
fn ssh_targeted_automation_is_always_refused_as_foreign_even_with_a_matching_id() {
    let mut a = sample_automation("a1");
    a.execution_target_type = ExecutionTargetType::Ssh;
    // Even though the id string happens to equal the current host id, an
    // Ssh-targeted automation must never be treated as locally owned: this
    // crate has no SSH execution capability at all (see the module doc).
    a.execution_target_id = HOST.to_string();
    let decision = execution::evaluate_dispatch(&a, HOST, &InvocationReason::ScheduledDue);
    assert_eq!(
        decision,
        DispatchDecision::Refused(DispatchRefusal::ForeignHost {
            execution_target_type: ExecutionTargetType::Ssh,
            execution_target_id: HOST.to_string(),
            current_host_id: HOST.to_string(),
        })
    );
}

// --- Pure evaluation: disabled automations -------------------------------

#[test]
fn disabled_automation_is_refused_regardless_of_invocation_reason() {
    let mut a = sample_automation("a1");
    a.enabled = false;
    for reason in [
        InvocationReason::ScheduledDue,
        InvocationReason::Manual,
        InvocationReason::ReactiveEvent(Some("evt".to_string())),
    ] {
        let decision = execution::evaluate_dispatch(&a, HOST, &reason);
        assert_eq!(
            decision,
            DispatchDecision::Refused(DispatchRefusal::Disabled),
            "reason {reason:?} must still be refused while disabled"
        );
    }
}

#[test]
fn foreign_host_takes_precedence_over_disabled() {
    let mut a = sample_automation("a1");
    a.enabled = false;
    let decision = execution::evaluate_dispatch(&a, OTHER_HOST, &InvocationReason::Manual);
    assert!(
        matches!(
            decision,
            DispatchDecision::Refused(DispatchRefusal::ForeignHost { .. })
        ),
        "a foreign-host automation must never be silently run just because \
         disabled-ness would also refuse it -- the host fence is checked first"
    );
}

#[test]
fn disabled_takes_precedence_over_missing_reactive_event() {
    let mut a = sample_automation("a1");
    a.enabled = false;
    let decision = execution::evaluate_dispatch(&a, HOST, &InvocationReason::ReactiveEvent(None));
    assert_eq!(
        decision,
        DispatchDecision::Refused(DispatchRefusal::Disabled)
    );
}

// --- Pure evaluation: reactive event requirement -------------------------

#[test]
fn reactive_invocation_without_a_supplied_event_is_refused() {
    let a = sample_automation("a1");
    let decision = execution::evaluate_dispatch(&a, HOST, &InvocationReason::ReactiveEvent(None));
    assert_eq!(
        decision,
        DispatchDecision::Refused(DispatchRefusal::MissingReactiveEvent)
    );
}

#[test]
fn reactive_invocation_with_a_supplied_event_is_eligible() {
    let a = sample_automation("a1");
    let decision = execution::evaluate_dispatch(
        &a,
        HOST,
        &InvocationReason::ReactiveEvent(Some("push".to_string())),
    );
    assert_eq!(decision, DispatchDecision::Eligible);
}

#[test]
fn scheduled_due_and_manual_never_require_an_event() {
    let a = sample_automation("a1");
    assert_eq!(
        execution::evaluate_dispatch(&a, HOST, &InvocationReason::ScheduledDue),
        DispatchDecision::Eligible
    );
    assert_eq!(
        execution::evaluate_dispatch(&a, HOST, &InvocationReason::Manual),
        DispatchDecision::Eligible
    );
}

// --- Job outcome: distinct from dispatch decision, stub is honest --------

#[test]
fn spawn_v1_session_always_returns_unsupported_never_a_fabricated_success() {
    let a = sample_automation("a1");
    assert_eq!(
        execution::spawn_v1_session(&a),
        JobOutcome::UnsupportedSessionSpawn
    );
}

#[test]
fn eligible_automation_is_dispatched_with_an_unsupported_job_outcome() {
    let a = sample_automation("a1");
    let attempt = execution::evaluate_and_attempt_dispatch(&a, HOST, &InvocationReason::Manual);
    assert_eq!(
        attempt,
        DispatchAttempt::Dispatched(JobOutcome::UnsupportedSessionSpawn)
    );
}

#[test]
fn refused_automation_never_reaches_job_execution() {
    let mut a = sample_automation("a1");
    a.enabled = false;
    let attempt = execution::evaluate_and_attempt_dispatch(&a, HOST, &InvocationReason::Manual);
    assert_eq!(attempt, DispatchAttempt::Refused(DispatchRefusal::Disabled));
}

// --- Durable re-derivation: storage-integrated wrapper -------------------

#[test]
fn missing_automation_row_is_an_explicit_missing_error() {
    let conn = conn();
    let err = execution::evaluate_and_attempt_dispatch_from_storage(
        &conn,
        "does-not-exist",
        HOST,
        &InvocationReason::Manual,
    )
    .unwrap_err();
    assert!(matches!(err, DispatchLookupError::Missing));
}

#[test]
fn unreadable_automation_row_is_a_distinct_error_from_missing() {
    let conn = conn();
    // Hand-write a row whose payload_json is not a valid Automation, to
    // simulate a stale/unreadable persisted shape distinct from an absent
    // row entirely.
    conn.execute(
        "INSERT INTO automations (id, bot_id, payload_json) VALUES (?1, NULL, ?2)",
        rusqlite::params!["broken", "{ this is not valid json"],
    )
    .unwrap();
    let err = execution::evaluate_and_attempt_dispatch_from_storage(
        &conn,
        "broken",
        HOST,
        &InvocationReason::Manual,
    )
    .unwrap_err();
    assert!(
        matches!(err, DispatchLookupError::Unreadable(_)),
        "an unreadable row must never be reported as simply missing"
    );
}

#[test]
fn stored_automation_dispatch_attempt_matches_the_pure_evaluation() {
    let conn = conn();
    storage::insert_new_automation(&conn, &sample_automation("a1")).unwrap();
    let attempt = execution::evaluate_and_attempt_dispatch_from_storage(
        &conn,
        "a1",
        HOST,
        &InvocationReason::ScheduledDue,
    )
    .unwrap();
    assert_eq!(
        attempt,
        DispatchAttempt::Dispatched(JobOutcome::UnsupportedSessionSpawn)
    );
}

#[test]
fn decision_is_re_derived_from_the_current_row_not_a_stale_in_memory_snapshot() {
    let conn = conn();
    storage::insert_new_automation(&conn, &sample_automation("a1")).unwrap();

    let before = execution::evaluate_and_attempt_dispatch_from_storage(
        &conn,
        "a1",
        HOST,
        &InvocationReason::ScheduledDue,
    )
    .unwrap();
    assert_eq!(
        before,
        DispatchAttempt::Dispatched(JobOutcome::UnsupportedSessionSpawn)
    );

    // A concurrent mutation disables the automation after the first
    // decision was derived. Re-deriving (never reusing `before`) must
    // observe the new state -- there is no cached decision to go stale.
    let mut disabled = sample_automation("a1");
    disabled.enabled = false;
    storage::upsert_automation(&conn, &disabled).unwrap();

    let after = execution::evaluate_and_attempt_dispatch_from_storage(
        &conn,
        "a1",
        HOST,
        &InvocationReason::ScheduledDue,
    )
    .unwrap();
    assert_eq!(after, DispatchAttempt::Refused(DispatchRefusal::Disabled));
}

#[test]
fn decision_survives_a_full_connection_close_and_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.sqlite3");
    {
        let conn = Connection::open(&path).unwrap();
        storage::migrate(&conn).unwrap();
        storage::insert_new_automation(&conn, &sample_automation("a1")).unwrap();
    }
    // Reopen: a fresh `Connection`, no process-local cache to inherit from.
    let conn = Connection::open(&path).unwrap();
    storage::migrate(&conn).unwrap();
    let attempt = execution::evaluate_and_attempt_dispatch_from_storage(
        &conn,
        "a1",
        HOST,
        &InvocationReason::ScheduledDue,
    )
    .unwrap();
    assert_eq!(
        attempt,
        DispatchAttempt::Dispatched(JobOutcome::UnsupportedSessionSpawn)
    );
}
