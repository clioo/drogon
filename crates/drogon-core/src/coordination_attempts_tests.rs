use super::*;
use drogon_protocol::orchestration_common::{
    LaunchPermissionMode, ProcessVerdict, ReadinessObservation,
};
use drogon_protocol::orchestration_scope::HostScope;
use rusqlite::Connection;

fn scope() -> CoordinatorScope {
    CoordinatorScope {
        host: HostScope {
            contract_version: 1,
            host_id: "host-a".into(),
        },
        run_id: "run-a".into(),
        coordinator_id: "owner".into(),
        consumer_generation: 1,
    }
}

fn attempt(id: &str) -> Attempt {
    Attempt {
        result: WorkerStartResult {
            run_id: "run-a".into(),
            task_id: "task-a".into(),
            dispatch_id: id.into(),
            consumer_generation: 1,
            workspace_id: "folder-a".into(),
            assignment_state: AssignmentState::Admitting,
            readiness: ReadinessObservation::NotObserved,
            process_verdict: ProcessVerdict::Unverifiable,
            session_identity: None,
            effects: vec![],
            residual_resources: vec![],
            failure: None,
            warning: None,
        },
        launch: LaunchPreferences {
            harness_id: "pi".into(),
            model: None,
            effort: None,
            provider: None,
            permission_mode: LaunchPermissionMode::Inherit,
        },
        outcome: None,
        report_message_id: None,
        report_result: None,
        cleanup_owned: true,
    }
}

fn database() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    let tx = conn.transaction().unwrap();
    migrate(&tx).unwrap();
    tx.commit().unwrap();
    conn
}

#[test]
fn history_is_task_scoped_and_refuses_truncating_more_than_500_attempts() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    for index in 0..501 {
        let mut entry = attempt(&format!("history-{index}"));
        entry.result.assignment_state = AssignmentState::Stopped;
        tx.execute("INSERT INTO orchestration_attempts(dispatch_id,host_id,run_id,task_id,is_current,fenced,state_json) VALUES (?1,'host-a','run-a','task-a',0,1,?2)",
            params![entry.result.dispatch_id,encode(&entry).unwrap()]).unwrap();
    }
    assert!(history(&tx, &scope(), "other-task").unwrap().is_empty());
    assert_eq!(
        history(&tx, &scope(), "task-a").err().unwrap().code,
        "result_too_large"
    );
    tx.execute(
        "DELETE FROM orchestration_attempts WHERE dispatch_id='history-500'",
        [],
    )
    .unwrap();
    let entries = history(&tx, &scope(), "task-a").unwrap();
    assert_eq!(entries.len(), 500);
    assert!(entries.iter().all(|entry| !entry.active));
    assert_eq!(entries[499].attempt.result.dispatch_id, "history-499");
}

#[test]
fn admission_rollback_removes_attempt_and_current_pointer() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    admit(&tx, &scope(), &attempt("one"), None).unwrap();
    tx.rollback().unwrap();
    let tx = conn.transaction().unwrap();
    assert!(show(&tx, &scope(), "one").is_err());
    admit(&tx, &scope(), &attempt("two"), None).unwrap();
}

#[test]
fn active_attempt_refuses_both_implicit_and_explicit_replacement() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    admit(&tx, &scope(), &attempt("one"), None).unwrap();
    assert_eq!(
        admit(&tx, &scope(), &attempt("two"), None)
            .unwrap_err()
            .code,
        "retry_required"
    );
    assert_eq!(
        admit(&tx, &scope(), &attempt("two"), Some("one"))
            .unwrap_err()
            .code,
        "attempt_active"
    );
    require_current_unfenced(&tx, &scope(), "one").unwrap();
}

#[test]
fn replacement_fences_old_authority_without_erasing_history() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    admit(&tx, &scope(), &attempt("one"), None).unwrap();
    fence(&tx, &scope(), "one", AssignmentState::Stopped).unwrap();
    assert_eq!(
        admit(&tx, &scope(), &attempt("two"), Some("one")).unwrap(),
        Some("one".into())
    );
    assert_eq!(
        require_current_unfenced(&tx, &scope(), "one")
            .unwrap_err()
            .code,
        "attempt_fenced"
    );
    require_current_unfenced(&tx, &scope(), "two").unwrap();
    assert_eq!(
        show(&tx, &scope(), "one").unwrap().result.assignment_state,
        AssignmentState::Stopped
    );
    assert_eq!(
        admit(&tx, &scope(), &attempt("three"), Some("one"))
            .unwrap_err()
            .code,
        "retry_required"
    );
}

#[test]
fn rolled_back_replacement_restores_prior_authority_and_history() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    let mut original = attempt("one");
    admit(&tx, &scope(), &original, None).unwrap();
    original.result.assignment_state = AssignmentState::Failed;
    save(&tx, &scope(), &original).unwrap();
    tx.commit().unwrap();
    let tx = conn.transaction().unwrap();
    admit(&tx, &scope(), &attempt("two"), Some("one")).unwrap();
    tx.rollback().unwrap();
    let tx = conn.transaction().unwrap();
    require_current_unfenced(&tx, &scope(), "one").unwrap();
    assert!(show(&tx, &scope(), "two").is_err());
}

#[test]
fn stop_cannot_overwrite_a_final_report() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    let mut original = attempt("one");
    admit(&tx, &scope(), &original, None).unwrap();
    original.result.assignment_state = AssignmentState::Completed;
    original.outcome = Some(ReportOutcome::Succeeded);
    original.report_message_id = Some("report-a".into());
    save(&tx, &scope(), &original).unwrap();
    assert_eq!(
        fence(&tx, &scope(), "one", AssignmentState::Stopped)
            .unwrap_err()
            .code,
        "attempt_settled"
    );
    assert_eq!(
        show(&tx, &scope(), "one").unwrap().report_message_id,
        Some("report-a".into())
    );
}

#[test]
fn attempt_inspection_is_host_and_run_scoped() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    admit(&tx, &scope(), &attempt("one"), None).unwrap();
    let mut foreign = scope();
    foreign.host.host_id = "other-host".into();
    assert!(show(&tx, &foreign, "one").is_err());
    assert!(fence(&tx, &foreign, "one", AssignmentState::Stopped).is_err());
    foreign = scope();
    foreign.run_id = "other-run".into();
    assert!(show(&tx, &foreign, "one").is_err());
    require_current_unfenced(&tx, &scope(), "one").unwrap();
}

#[test]
fn unsupported_schema_is_refused_before_creating_attempt_tables() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE schema_versions(component TEXT PRIMARY KEY,version INTEGER NOT NULL); INSERT INTO schema_versions VALUES ('orchestration_attempts',2);").unwrap();
    let tx = conn.transaction().unwrap();
    assert_eq!(
        migrate(&tx).unwrap_err().code,
        "unsupported_orchestration_contract"
    );
    let count: i64 = tx
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='orchestration_attempts'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn report_wins_over_late_launch_finalization_without_claiming_exit() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    let mut original = attempt("one");
    admit(&tx, &scope(), &original, None).unwrap();
    let Settlement::New(reported) =
        settle(&tx, &scope(), "one", ReportOutcome::Succeeded, "report-a").unwrap()
    else {
        panic!("first report must settle")
    };
    assert_eq!(
        reported.result.process_verdict,
        ProcessVerdict::Unverifiable
    );
    original.result.assignment_state = AssignmentState::Ready;
    original.result.process_verdict = ProcessVerdict::Live;
    let finished = finish_launch(&tx, &scope(), &original.result).unwrap();
    assert_eq!(finished.result.assignment_state, AssignmentState::Completed);
    assert_eq!(finished.report_message_id, Some("report-a".into()));
    assert_eq!(
        finished.result.readiness,
        ReadinessObservation::WorkerObserved
    );
}

#[test]
fn duplicate_report_keeps_original_message_and_conflicting_outcome_is_refused() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    admit(&tx, &scope(), &attempt("one"), None).unwrap();
    settle(&tx, &scope(), "one", ReportOutcome::Failed, "report-a").unwrap();
    let Settlement::Duplicate { message_id } =
        settle(&tx, &scope(), "one", ReportOutcome::Failed, "report-b").unwrap()
    else {
        panic!("same outcome must duplicate")
    };
    assert_eq!(message_id, "report-a");
    assert_eq!(
        settle(&tx, &scope(), "one", ReportOutcome::Succeeded, "report-c")
            .unwrap_err()
            .code,
        "report_conflict"
    );
    admit(&tx, &scope(), &attempt("two"), Some("one")).unwrap();
    assert_eq!(
        settle(&tx, &scope(), "one", ReportOutcome::Failed, "report-d")
            .unwrap_err()
            .code,
        "attempt_fenced"
    );
}

#[test]
fn committed_cancel_refuses_report_and_late_launch_cannot_clear_fence() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    let mut original = attempt("one");
    admit(&tx, &scope(), &original, None).unwrap();
    fence(&tx, &scope(), "one", AssignmentState::Abandoned).unwrap();
    assert_eq!(
        settle(&tx, &scope(), "one", ReportOutcome::Succeeded, "report-a")
            .unwrap_err()
            .code,
        "attempt_fenced"
    );
    original.result.assignment_state = AssignmentState::Ready;
    assert_eq!(
        finish_launch(&tx, &scope(), &original.result)
            .unwrap()
            .result
            .assignment_state,
        AssignmentState::Abandoned
    );
}

#[test]
fn prompt_observation_failure_accepts_the_first_real_report_but_launch_failure_does_not() {
    for failure_code in ["agent_prompt_stalled", "spawn_failed"] {
        let mut conn = database();
        let tx = conn.transaction().unwrap();
        let mut original = attempt("one");
        admit(&tx, &scope(), &original, None).unwrap();
        original.result.assignment_state = AssignmentState::Failed;
        original.result.failure = Some(drogon_protocol::orchestration_common::AttemptFailure {
            code: failure_code.into(),
            stage: "launch".into(),
            message: "fixture".into(),
        });
        finish_launch(&tx, &scope(), &original.result).unwrap();
        let result = settle(&tx, &scope(), "one", ReportOutcome::Failed, "report-a");
        if failure_code == "agent_prompt_stalled" {
            let Settlement::New(reported) = result.unwrap() else {
                panic!("first real report")
            };
            assert_eq!(reported.outcome, Some(ReportOutcome::Failed));
            assert!(reported.result.failure.is_none());
        } else {
            assert_eq!(result.unwrap_err().code, "attempt_settled");
        }
    }
}

#[test]
fn corrupt_record_cannot_redirect_an_exact_attempt_operation() {
    let mut conn = database();
    let tx = conn.transaction().unwrap();
    let mut original = attempt("one");
    admit(&tx, &scope(), &original, None).unwrap();
    original.result.dispatch_id = "two".into();
    tx.execute(
        "UPDATE orchestration_attempts SET state_json=?1 WHERE dispatch_id='one'",
        [encode(&original).unwrap()],
    )
    .unwrap();
    assert_eq!(
        show(&tx, &scope(), "one").unwrap_err().code,
        "internal_error"
    );
    assert!(fence(&tx, &scope(), "one", AssignmentState::Stopped).is_err());
}
