//! Wire-shape and serde tests for the frozen native coordination method
//! group proposal. These tests pin serialization (including exact wire keys),
//! additive evolution, scope requirements, fence bounds, decode-time mode
//! contradictions and credential absence. Schema tests only: no orchestration
//! behavior is implemented.

use drogon_protocol::orchestration_common::{
    ActorScope, AssignmentState, AttemptFailure, DEFAULT_RUN_PAGE_LIMIT, LaunchPermissionMode,
    LaunchPreferences, MAX_CURSOR_BYTES, MAX_MAIL_BATCH, MAX_WAIT_BUDGET_MS, OpaqueCursor,
    ProcessVerdict, ReadinessObservation, ReportOutcome, ResidualResource, ResourceAction,
    ResourceDisposition, ResourceEffect, ResourceKind, SessionIdentity, WaitPolicy,
    leaks_credential_shaped_key,
};
use drogon_protocol::orchestration_mail::{
    AckReceipt, CheckMode, CheckParams, CheckResult, DuplicateReportReceipt, FinalReport,
    LifecycleVerdict, MessageKind, MessageReceipt, MessageSummary, OutstandingDelivery,
    ReplyParams, ReplyResult, SendBatchResult, SendParams, SendResult, SendTarget, SendWarning,
};
use drogon_protocol::orchestration_question::{
    AnswerPayload, AskIntent, AskParams, AskResult, AskWaitOutcome, BootstrapScope, ReceiptScope,
    RequestLedgerState, RequestShowParams, RequestShowResult,
};
use drogon_protocol::orchestration_run::{
    RunCreateParams, RunCreateResult, RunListParams, RunListResult, RunShowParams, RunShowResult,
    RunSummary, RunUseParams, RunUseResult,
};
use drogon_protocol::orchestration_scope::{
    CoordinatorScope, DispatchScope, HostScope, MAX_CONSUMER_GENERATION,
};
use drogon_protocol::orchestration_task::{
    TaskCreateParams, TaskCreateResult, TaskListParams, TaskListResult, TaskRecord, TaskShowParams,
    TaskShowResult, TaskSpec, TaskStatus, TaskSummary, TaskUpdateParams, TaskUpdateResult,
};
use drogon_protocol::orchestration_worker::{
    OutputEntry, OutputSource, ProcessAction, WorkerAbandonParams, WorkerAbandonResult,
    WorkerExecution, WorkerPlacement, WorkerReadParams, WorkerReadResult, WorkerReleaseParams,
    WorkerReleaseResult, WorkerShowParams, WorkerShowResult, WorkerStartParams, WorkerStartResult,
    WorkerStopParams, WorkerStopResult,
};
use serde::Deserialize;
use serde_json::{Value, json};

fn host_scope() -> HostScope {
    HostScope {
        contract_version: 1,
        host_id: "host-a".into(),
    }
}

fn coordinator_scope() -> CoordinatorScope {
    CoordinatorScope {
        host: host_scope(),
        run_id: "run-1".into(),
        coordinator_id: "coordinator-1".into(),
        consumer_generation: 3,
    }
}

fn dispatch_scope() -> DispatchScope {
    DispatchScope {
        host: host_scope(),
        run_id: "run-1".into(),
        task_id: "task-1".into(),
        dispatch_id: "dispatch-1".into(),
    }
}

fn fresh_launch() -> WorkerExecution {
    WorkerExecution::Fresh {
        launch: LaunchPreferences {
            harness_id: "opencode".into(),
            model: Some("model-x".into()),
            effort: Some("high".into()),
            provider: None,
            permission_mode: LaunchPermissionMode::Unattended,
        },
    }
}

fn assert_camel_case_round_trip<T>(value: &T, camel_key: &str)
where
    T: serde::Serialize + for<'de> Deserialize<'de> + PartialEq + std::fmt::Debug,
{
    let serialized = serde_json::to_value(value).unwrap();
    assert!(
        serialized.get(camel_key).is_some(),
        "expected camelCase key {camel_key} in {serialized}"
    );
    let round_tripped: T = serde_json::from_value(serialized).unwrap();
    assert_eq!(&round_tripped, value);
}

#[test]
fn run_methods_round_trip_with_explicit_host_and_generation() {
    let params = RunCreateParams {
        host: host_scope(),
        objective: "Coordinate the release audit".into(),
        coordinator_id: "coordinator-1".into(),
    };
    params.validate_shape("host-a").unwrap();
    let create_json = serde_json::to_value(&params).unwrap();
    // Root decision: the initial generation is always 1 and server-owned, so
    // the creation params carry no generation field at all.
    assert!(create_json.get("consumerGeneration").is_none());
    assert_camel_case_round_trip(&params, "coordinatorId");

    let summary = RunSummary {
        run_id: "run-1".into(),
        objective: "Objective".into(),
        coordinator_id: "coordinator-1".into(),
        consumer_generation: 4,
        created_at_ms: 1_700_000_000_000,
    };
    let use_result = RunUseResult {
        run: summary.clone(),
    };
    assert_camel_case_round_trip(&use_result, "run");
    assert_camel_case_round_trip(
        &RunListParams {
            host: host_scope(),
            limit: Some(DEFAULT_RUN_PAGE_LIMIT),
            cursor: Some(OpaqueCursor("page-2".into())),
        },
        "cursor",
    );
    assert_camel_case_round_trip(
        &RunListResult {
            runs: vec![],
            next_cursor: Some(OpaqueCursor("page-3".into())),
        },
        "runs",
    );
    assert_camel_case_round_trip(
        &RunShowResult {
            run: summary.clone(),
            task_count: Some(2),
        },
        "taskCount",
    );
    let created = RunCreateResult { run: summary };
    assert_camel_case_round_trip(&created, "run");
    assert_camel_case_round_trip(
        &RunShowParams {
            host: host_scope(),
            run_id: "run-1".into(),
        },
        "runId",
    );
    let use_params = RunUseParams {
        host: host_scope(),
        run_id: "run-1".into(),
        coordinator_id: "coordinator-1".into(),
        consumer_generation: 3,
        takeover: true,
    };
    use_params.validate_shape("host-a").unwrap();
    assert_camel_case_round_trip(&use_params, "consumerGeneration");
}

#[test]
fn task_methods_round_trip_with_decided_status_vocabulary() {
    for status in [
        TaskStatus::Pending,
        TaskStatus::Ready,
        TaskStatus::Dispatched,
        TaskStatus::Completed,
        TaskStatus::Failed,
        TaskStatus::Blocked,
    ] {
        let value = serde_json::to_value(status).unwrap();
        let round: TaskStatus = serde_json::from_value(value).unwrap();
        assert_eq!(round, status);
    }

    let params = TaskCreateParams {
        scope: coordinator_scope(),
        spec: TaskSpec {
            title: Some("Audit".into()),
            instructions: "Run the audit steps".into(),
            depends_on: vec!["task-0".into(), "task-1".into()],
            parent: None,
            display_name: Some("Release audit".into()),
            metadata: Some(json!({"taskAuthored": true})),
        },
    };
    params.validate_shape("host-a").unwrap();
    let serialized = serde_json::to_value(&params).unwrap();
    assert_eq!(serialized["spec"]["dependsOn"], json!(["task-0", "task-1"]));
    assert_eq!(serialized["coordinatorId"], json!("coordinator-1"));
    assert_eq!(serialized["consumerGeneration"], json!(3));
    assert_camel_case_round_trip(&params, "spec");

    let duplicate = TaskCreateParams {
        scope: coordinator_scope(),
        spec: TaskSpec {
            title: None,
            instructions: "x".into(),
            depends_on: vec!["task-1".into(), "task-1".into()],
            parent: None,
            display_name: None,
            metadata: None,
        },
    };
    // The domain deduplicates prerequisite IDs in its transaction.
    duplicate.validate_shape("host-a").unwrap();

    // The listing must convey instructions: spec + specTruncated required.
    let summary = TaskSummary {
        task_id: "task-1".into(),
        status: TaskStatus::Ready,
        spec: "Run the audit steps".into(),
        spec_truncated: false,
        title: Some("Audit".into()),
        depends_on: Some(vec!["task-0".into()]),
    };
    assert_camel_case_round_trip(&summary, "specTruncated");

    let list_params = TaskListParams {
        scope: coordinator_scope(),
        brief: true,
        ready: true,
        status: None,
        limit: None,
        cursor: None,
    };
    list_params.validate_shape("host-a").unwrap();
    // ready + a non-ready status is contradictory before admission.
    let conflicting = TaskListParams {
        status: Some(TaskStatus::Failed),
        ..list_params.clone()
    };
    assert_eq!(
        conflicting.validate_shape("host-a").unwrap_err().code,
        "invalid_argument"
    );
    // ready + status ready is the compatible spelling.
    let aligned = TaskListParams {
        status: Some(TaskStatus::Ready),
        ..list_params
    };
    aligned.validate_shape("host-a").unwrap();

    assert_camel_case_round_trip(
        &TaskListResult {
            tasks: vec![summary],
            next_cursor: None,
        },
        "tasks",
    );
    assert_camel_case_round_trip(
        &TaskShowParams {
            scope: coordinator_scope(),
            task_id: "task-1".into(),
        },
        "taskId",
    );
    let created = TaskCreateResult {
        task: TaskRecord {
            task_id: "task-1".into(),
            run_id: "run-1".into(),
            status: TaskStatus::Pending,
            depends_on: vec!["task-0".into()],
            result: None,
        },
    };
    assert_camel_case_round_trip(&created, "task");
    let mut update = TaskUpdateParams {
        scope: coordinator_scope(),
        task_id: "task-1".into(),
        status: TaskStatus::Completed,
        result: Some("done ✓".into()),
    };
    update.validate_shape("host-a").unwrap();
    assert_camel_case_round_trip(&update, "taskId");
    assert_camel_case_round_trip(
        &TaskUpdateResult {
            task: created.task.clone(),
        },
        "task",
    );
    update.result = Some("".into());
    update.validate_shape("host-a").unwrap();
    update.result =
        Some("x".repeat(drogon_protocol::orchestration_common::MAX_TASK_TEXT_BYTES + 1));
    assert!(update.validate_shape("host-a").is_err());
    let shown = TaskShowResult {
        task: created.task,
        spec: params.spec,
        attempts: vec![],
        active_dispatch_id: None,
    };
    assert_camel_case_round_trip(&shown, "attempts");
}

#[test]
fn worker_methods_round_trip_with_placement_execution_and_resources() {
    let start = WorkerStartParams {
        scope: coordinator_scope(),
        task_id: "task-1".into(),
        placement: WorkerPlacement {
            workspace_id: "ws-1".into(),
        },
        execution: fresh_launch(),
        display_name: Some("Release audit".into()),
        comment: Some("Supervised".into()),
        timeout_ms: Some(90_000),
        retry_of: Some("dispatch-0".into()),
    };
    start.validate_shape("host-a").unwrap();
    let start_json = serde_json::to_value(&start).unwrap();
    // Flat wire: placement and execution flatten alongside the scope.
    assert_eq!(start_json["workspaceId"], json!("ws-1"));
    assert_eq!(start_json["mode"], json!("fresh"));
    assert_eq!(start_json["launch"]["permissionMode"], json!("unattended"));
    assert_eq!(start_json["retryOf"], json!("dispatch-0"));
    assert_camel_case_round_trip(&start, "launch");

    let reuse = WorkerStartParams {
        execution: WorkerExecution::Reuse {
            session_identity: SessionIdentity {
                session_id: "session-1".into(),
                incarnation: "f2b4c995-0e6c-4a0a-9e6f-1f2a3b4c5d6e".into(),
            },
        },
        ..start.clone()
    };
    reuse.validate_shape("host-a").unwrap();
    let reuse_json = serde_json::to_value(&reuse).unwrap();
    assert_eq!(reuse_json["mode"], json!("reuse"));
    // incarnation is a String (current native UUID vocabulary), never a number.
    assert_eq!(
        reuse_json["sessionIdentity"]["incarnation"],
        json!("f2b4c995-0e6c-4a0a-9e6f-1f2a3b4c5d6e")
    );
    assert_camel_case_round_trip(&reuse, "sessionIdentity");

    let result = WorkerStartResult {
        run_id: "run-1".into(),
        task_id: "task-1".into(),
        dispatch_id: "dispatch-1".into(),
        consumer_generation: 3,
        workspace_id: "ws-1".into(),
        assignment_state: AssignmentState::Admitting,
        readiness: ReadinessObservation::NotObserved,
        process_verdict: ProcessVerdict::Unverifiable,
        session_identity: None,
        effects: vec![ResourceEffect {
            kind: ResourceKind::Workspace,
            resource_id: "ws-1".into(),
            incarnation: None,
            action: ResourceAction::Reused,
        }],
        residual_resources: vec![ResidualResource {
            kind: ResourceKind::Session,
            resource_id: "session-1".into(),
            incarnation: Some("f2b4c995-0e6c-4a0a-9e6f-1f2a3b4c5d6e".into()),
            action: ResourceAction::Created,
            disposition: ResourceDisposition::Unverifiable,
        }],
        failure: None,
        warning: None,
    };
    let result_json = serde_json::to_value(&result).unwrap();
    assert_eq!(result_json["processVerdict"], json!("unverifiable"));
    assert_eq!(result_json["readiness"], json!("notObserved"));
    assert_eq!(result_json["assignmentState"], json!("admitting"));
    assert_eq!(result_json["effects"][0]["resourceId"], json!("ws-1"));
    assert_camel_case_round_trip(&result, "effects");

    let mut show = WorkerShowResult {
        dispatch_id: "dispatch-1".into(),
        task_id: "task-1".into(),
        assignment_state: AssignmentState::Ready,
        readiness: ReadinessObservation::WorkerObserved,
        process_verdict: ProcessVerdict::Live,
        outcome: None,
        report_result: None,
        session_identity: Some(SessionIdentity {
            session_id: "session-1".into(),
            incarnation: "f2b4c995-0e6c-4a0a-9e6f-1f2a3b4c5d6e".into(),
        }),
        launch: None,
        residual_resources: vec![],
        failure: None,
        warning: None,
    };
    assert_camel_case_round_trip(&show, "sessionIdentity");
    let old_shape = serde_json::to_value(&show).unwrap();
    assert!(old_shape.get("reportResult").is_none());
    assert!(
        serde_json::from_value::<WorkerShowResult>(old_shape)
            .unwrap()
            .report_result
            .is_none()
    );
    show.report_result = Some(json!({"files":["src/example.rs"],"testsPassed":true}));
    assert_camel_case_round_trip(&show, "reportResult");
    assert_camel_case_round_trip(
        &WorkerShowParams {
            scope: coordinator_scope(),
            dispatch_id: "dispatch-1".into(),
        },
        "dispatchId",
    );
    assert_camel_case_round_trip(
        &WorkerReadParams {
            scope: coordinator_scope(),
            dispatch_id: "dispatch-1".into(),
            cursor: Some(OpaqueCursor("owr1_next".into())),
            limit: Some(100),
            source: OutputSource::Transcript,
        },
        "cursor",
    );
    let read = WorkerReadResult {
        dispatch_id: "dispatch-1".into(),
        source: OutputSource::Transcript,
        process_verdict: ProcessVerdict::Live,
        entries: vec![OutputEntry {
            sequence: 1,
            source_identity: "session-1".into(),
            fallback_reason: None,
            content: json!({"workerAuthored": "line"}),
        }],
        next_cursor: Some(OpaqueCursor("owr1_next".into())),
    };
    assert_camel_case_round_trip(&read, "entries");

    let stop = WorkerStopResult {
        dispatch_id: "dispatch-1".into(),
        assignment_state: AssignmentState::Stopped,
        process_action: ProcessAction::None,
        process_verdict: ProcessVerdict::Live,
        residual_resources: vec![ResidualResource {
            kind: ResourceKind::Session,
            resource_id: "session-9".into(),
            incarnation: None,
            action: ResourceAction::Retained,
            disposition: ResourceDisposition::Retained,
        }],
        warning: Some("stopped without closing its unsupervised terminal".into()),
    };
    assert_camel_case_round_trip(&stop, "processAction");
    assert_camel_case_round_trip(&stop, "processVerdict");
    assert_camel_case_round_trip(
        &WorkerStopParams {
            scope: coordinator_scope(),
            dispatch_id: "dispatch-1".into(),
        },
        "dispatchId",
    );
    // Abandon never signals: the result has no process-action field at all.
    let abandon = WorkerAbandonResult {
        dispatch_id: "dispatch-1".into(),
        assignment_state: AssignmentState::Abandoned,
        residual_resources: vec![ResidualResource {
            kind: ResourceKind::Session,
            resource_id: "session-1".into(),
            incarnation: None,
            action: ResourceAction::Retained,
            disposition: ResourceDisposition::Retained,
        }],
    };
    let abandon_json = serde_json::to_value(&abandon).unwrap();
    assert!(abandon_json.get("processAction").is_none());
    assert_camel_case_round_trip(&abandon, "assignmentState");
    assert_camel_case_round_trip(
        &WorkerAbandonParams {
            scope: coordinator_scope(),
            dispatch_id: "dispatch-1".into(),
            reason: Some("superseded".into()),
        },
        "reason",
    );
    let release = WorkerReleaseResult {
        dispatch_id: "dispatch-1".into(),
        disposition: ResourceDisposition::NoOwnedResource,
        process_verdict: ProcessVerdict::Exited,
        residual_resources: vec![],
    };
    assert_camel_case_round_trip(&release, "disposition");
    assert_camel_case_round_trip(
        &WorkerReleaseParams {
            scope: coordinator_scope(),
            dispatch_id: "dispatch-1".into(),
        },
        "dispatchId",
    );
}

#[test]
fn prompt_stall_failure_and_late_first_report_serialize_without_resume_claims() {
    // Root decision a1d2073: AGENT_PROMPT_STALLED_ERROR leaves the attempt
    // failed-but-inspectable, readiness unverified, no reported outcome, and
    // the process verdict independent — explicit retry names this attempt.
    let stalled = WorkerShowResult {
        dispatch_id: "dispatch-9".into(),
        task_id: "task-1".into(),
        assignment_state: AssignmentState::Failed,
        readiness: ReadinessObservation::NotObserved,
        process_verdict: ProcessVerdict::Unverifiable,
        outcome: None,
        report_result: None,
        session_identity: Some(SessionIdentity {
            session_id: "session-7".into(),
            incarnation: "7c1d5a2b-3e4f-4a5b-8c9d-0e1f2a3b4c5d".into(),
        }),
        launch: None,
        residual_resources: vec![ResidualResource {
            kind: ResourceKind::Session,
            resource_id: "session-7".into(),
            incarnation: Some("7c1d5a2b-3e4f-4a5b-8c9d-0e1f2a3b4c5d".into()),
            action: ResourceAction::Created,
            disposition: ResourceDisposition::Unverifiable,
        }],
        failure: Some(AttemptFailure {
            code: "agent_prompt_stalled".into(),
            stage: "dispatch_prompt".into(),
            message: "prompt observation timed out; the attempt stays inspectable".into(),
        }),
        warning: None,
    };
    let stalled_json = serde_json::to_value(&stalled).unwrap();
    assert_eq!(
        stalled_json["failure"]["code"],
        json!("agent_prompt_stalled")
    );
    assert_eq!(stalled_json["readiness"], json!("notObserved"));
    assert_eq!(stalled_json["outcome"], Value::Null);
    assert!(stalled_json.get("outcome").is_none());
    assert_eq!(stalled_json["processVerdict"], json!("unverifiable"));
    assert_camel_case_round_trip(&stalled, "failure");
    // Explicit retry references the exact failed attempt; no auto-respawn.
    let retry = WorkerStartParams {
        scope: coordinator_scope(),
        task_id: "task-1".into(),
        placement: WorkerPlacement {
            workspace_id: "ws-1".into(),
        },
        execution: fresh_launch(),
        display_name: None,
        comment: None,
        timeout_ms: None,
        retry_of: Some("dispatch-9".into()),
    };
    retry.validate_shape("host-a").unwrap();
    assert_eq!(
        serde_json::to_value(&retry).unwrap()["retryOf"],
        json!("dispatch-9")
    );

    // A late first report settles once; duplicate metadata identifies the
    // original report without re-creating it or claiming resume semantics.
    let late_report = SendResult {
        message: Some(MessageReceipt {
            message_id: "msg-final-1".into(),
            sequence: Some(41),
            run_id: Some("run-1".into()),
        }),
        batch: None,
        lifecycle: Some(LifecycleVerdict::Settled {
            outcome: ReportOutcome::Succeeded,
            duplicate: false,
        }),
        duplicate: None,
        warnings: vec![],
    };
    late_report.validate_shape().unwrap();
    assert_camel_case_round_trip(&late_report, "lifecycle");
    let duplicate = SendResult {
        message: Some(MessageReceipt {
            message_id: "msg-final-2".into(),
            sequence: Some(41),
            run_id: Some("run-1".into()),
        }),
        batch: None,
        lifecycle: Some(LifecycleVerdict::Settled {
            outcome: ReportOutcome::Succeeded,
            duplicate: true,
        }),
        duplicate: Some(DuplicateReportReceipt {
            original_request_id: "request-1".into(),
            original_message_id: Some("msg-final-1".into()),
        }),
        warnings: vec![],
    };
    duplicate.validate_shape().unwrap();
    let duplicate_json = serde_json::to_value(&duplicate).unwrap();
    assert_eq!(
        duplicate_json["duplicate"]["originalRequestId"],
        json!("request-1")
    );
    assert_camel_case_round_trip(&duplicate, "duplicate");
}

#[test]
fn mail_methods_round_trip_with_ack_then_consume_and_modes() {
    let send = SendParams {
        scope: ActorScope::Dispatch(dispatch_scope()),
        kind: MessageKind::FinalReport,
        to: Some(SendTarget::RunHome),
        subject: "task complete".into(),
        body: Some("all checks passed".into()),
        payload: None,
        thread_id: None,
        final_report: Some(FinalReport {
            outcome: ReportOutcome::Succeeded,
            result: Some(json!({"taskAuthored": "summary"})),
        }),
    };
    send.validate_shape("host-a").unwrap();
    let send_json = serde_json::to_value(&send).unwrap();
    assert_eq!(send_json["scope"]["actorKind"], json!("dispatch"));
    assert_eq!(send_json["finalReport"]["outcome"], json!("succeeded"));
    assert_camel_case_round_trip(&send, "finalReport");

    let send_result = SendResult {
        message: Some(MessageReceipt {
            message_id: "msg-1".into(),
            sequence: Some(7),
            run_id: Some("run-1".into()),
        }),
        batch: None,
        lifecycle: Some(LifecycleVerdict::Settled {
            outcome: ReportOutcome::Succeeded,
            duplicate: false,
        }),
        duplicate: None,
        warnings: vec![SendWarning {
            code: "reveal_failed".into(),
            recipient: "term-1".into(),
            message: "could not reveal".into(),
        }],
    };
    send_result.validate_shape().unwrap();
    assert_camel_case_round_trip(&send_result, "lifecycle");
    assert_camel_case_round_trip(
        &SendResult {
            message: None,
            batch: Some(SendBatchResult {
                messages: vec![],
                recipients: 2,
            }),
            lifecycle: None,
            duplicate: None,
            warnings: vec![],
        },
        "batch",
    );

    let check = CheckParams {
        scope: ActorScope::Coordinator(coordinator_scope()),
        mode: CheckMode::Unread {
            acknowledge: Some("delivery-0".into()),
        },
        wait: Some(WaitPolicy { timeout_ms: 1_000 }),
        kinds: vec![MessageKind::Guidance, MessageKind::Escalation],
        inject: false,
        cursor: None,
        limit: None,
    };
    check.validate_shape("host-a").unwrap();
    let check_json = serde_json::to_value(&check).unwrap();
    assert_eq!(check_json["mode"], json!("unread"));
    assert_eq!(check_json["acknowledge"], json!("delivery-0"));
    assert_eq!(check_json["kinds"], json!(["guidance", "escalation"]));
    assert_camel_case_round_trip(&check, "mode");

    let delivery = OutstandingDelivery {
        delivery_id: "delivery-1".into(),
        message_ids: (0..MAX_MAIL_BATCH)
            .map(|index| format!("msg-{index}"))
            .collect(),
    };
    delivery.validate_shape().unwrap();
    let check_result = CheckResult {
        delivery: Some(delivery),
        acknowledged: Some(AckReceipt {
            delivery_id: "delivery-0".into(),
            already_acknowledged: false,
            message_ids: (0..MAX_MAIL_BATCH)
                .map(|index| format!("old-{index}"))
                .collect(),
        }),
        messages: (0..MAX_MAIL_BATCH)
            .map(|index| MessageSummary {
                message_id: format!("msg-{index}"),
                sequence: 11 + index as u64,
                kind: MessageKind::Guidance,
                from_actor: "coordinator-1".into(),
                to_actor: Some("dispatch-1".into()),
                subject: "next steps".into(),
                body: Some("do the thing".into()),
                payload: None,
                thread_id: None,
            })
            .collect(),
        next_cursor: None,
        timed_out: false,
        cancelled: false,
        connection_lost: false,
    };
    check_result.validate_shape().unwrap();
    assert_camel_case_round_trip(&check_result, "delivery");
    assert_camel_case_round_trip(&check_result, "acknowledged");

    // Peek stays non-consuming and cannot wait.
    let peek = CheckParams {
        scope: check.scope.clone(),
        mode: CheckMode::Peek,
        wait: None,
        kinds: vec![],
        inject: false,
        cursor: None,
        limit: None,
    };
    peek.validate_shape("host-a").unwrap();
    assert!(!peek.mode.allows_wait());
    let peek_with_wait = CheckParams {
        wait: Some(WaitPolicy { timeout_ms: 1_000 }),
        ..peek.clone()
    };
    assert_eq!(
        peek_with_wait.validate_shape("host-a").unwrap_err().code,
        "invalid_argument"
    );

    assert_camel_case_round_trip(
        &ReplyParams {
            scope: ActorScope::Dispatch(dispatch_scope()),
            question_message_id: "question-1".into(),
            body: "the answer".into(),
            thread_id: Some("thread-1".into()),
        },
        "questionMessageId",
    );
    let reply = ReplyResult {
        message: MessageReceipt {
            message_id: "answer-1".into(),
            sequence: Some(12),
            run_id: None,
        },
        question_message_id: "question-1".into(),
    };
    assert_camel_case_round_trip(&reply, "questionMessageId");
}

#[test]
fn question_and_receipt_methods_round_trip_with_explicit_scope() {
    let ask = AskParams {
        scope: ActorScope::Dispatch(dispatch_scope()),
        intent: AskIntent::New {
            question: "May I edit the frozen manifest?".into(),
            options: vec!["yes".into(), "no".into()],
        },
        to: Some(SendTarget::RunHome),
        wait: WaitPolicy { timeout_ms: 5_000 },
    };
    ask.validate_shape("host-a").unwrap();
    let ask_json = serde_json::to_value(&ask).unwrap();
    assert_eq!(ask_json["intent"], json!("new"));
    assert_eq!(ask_json["wait"]["timeoutMs"], json!(5_000));
    assert_camel_case_round_trip(&ask, "intent");

    let resume = AskParams {
        scope: ActorScope::Dispatch(dispatch_scope()),
        intent: AskIntent::Resume {
            question_message_id: "question-1".into(),
        },
        to: None,
        wait: WaitPolicy { timeout_ms: 1_000 },
    };
    resume.validate_shape("host-a").unwrap();
    assert_camel_case_round_trip(&resume, "intent");

    let answered = AskResult {
        question_message_id: "question-1".into(),
        thread_id: "thread-1".into(),
        wait: AskWaitOutcome::Answered,
        answer: Some(AnswerPayload {
            body: "yes".into(),
            answer_message_id: Some("answer-1".into()),
        }),
        effective_timeout_ms: Some(5_000),
        connection_lost: false,
    };
    answered.validate_shape().unwrap();
    assert_camel_case_round_trip(&answered, "answer");

    let pending = AskResult {
        question_message_id: "question-1".into(),
        thread_id: "thread-1".into(),
        wait: AskWaitOutcome::Pending,
        answer: None,
        effective_timeout_ms: Some(4_000),
        connection_lost: false,
    };
    pending.validate_shape().unwrap();
    assert_camel_case_round_trip(&pending, "effectiveTimeoutMs");

    // Receipt recovery names the receipt space explicitly; bootstrap has a
    // coordinator identity but no run binding yet.
    for (scope, kind_key) in [
        (
            ReceiptScope::Bootstrap(BootstrapScope {
                host: host_scope(),
                coordinator_id: "coordinator-1".into(),
            }),
            "bootstrap",
        ),
        (
            ReceiptScope::Coordinator(coordinator_scope()),
            "coordinator",
        ),
        (ReceiptScope::Dispatch(dispatch_scope()), "dispatch"),
    ] {
        let params = RequestShowParams {
            scope,
            request_id: "request-1".into(),
        };
        params.validate_shape("host-a").unwrap();
        let json = serde_json::to_value(&params).unwrap();
        assert_eq!(json["scope"]["actorKind"], json!(kind_key));
        assert_camel_case_round_trip(&params, "requestId");
    }

    let receipt = RequestShowResult {
        request_id: "request-1".into(),
        state: RequestLedgerState::Absent,
        method: Some("orchestration.send".into()),
        interpretation: "no record; absence is not proof that no effects happened".into(),
        receipt: Some(json!({"taskAuthored": true})),
    };
    assert_camel_case_round_trip(&receipt, "interpretation");
    let committed = RequestShowResult {
        state: RequestLedgerState::Committed,
        ..receipt
    };
    assert_camel_case_round_trip(&committed, "state");
}

#[test]
fn additive_params_and_result_fields_are_ignored_not_identity() {
    let mut run_use = serde_json::to_value(RunUseParams {
        host: host_scope(),
        run_id: "run-1".into(),
        coordinator_id: "coordinator-1".into(),
        consumer_generation: 3,
        takeover: false,
    })
    .unwrap();
    run_use["futureHint"] = json!({"optional": true});
    let parsed: RunUseParams = serde_json::from_value(run_use).unwrap();
    assert_eq!(parsed.consumer_generation, 3);

    let mut send_result = serde_json::to_value(SendResult {
        message: Some(MessageReceipt {
            message_id: "msg-1".into(),
            sequence: None,
            run_id: None,
        }),
        batch: None,
        lifecycle: None,
        duplicate: None,
        warnings: vec![],
    })
    .unwrap();
    send_result["futureCount"] = json!(41);
    let parsed: SendResult = serde_json::from_value(send_result).unwrap();
    assert_eq!(parsed.message.as_ref().unwrap().message_id, "msg-1");

    let mut check = serde_json::to_value(CheckParams {
        scope: ActorScope::Dispatch(dispatch_scope()),
        mode: CheckMode::Peek,
        wait: None,
        kinds: vec![],
        inject: false,
        cursor: None,
        limit: None,
    })
    .unwrap();
    check["futureMode"] = json!("later");
    let parsed: CheckParams = serde_json::from_value(check).unwrap();
    assert_eq!(parsed.mode, CheckMode::Peek);
}

#[test]
fn scopes_are_required_and_refuse_wrong_host_or_version() {
    let mut run_create = serde_json::to_value(RunCreateParams {
        host: host_scope(),
        objective: "obj".into(),
        coordinator_id: "coordinator-1".into(),
    })
    .unwrap();
    run_create.as_object_mut().unwrap().remove("hostId");
    assert!(serde_json::from_value::<RunCreateParams>(run_create).is_err());

    let params = RunCreateParams {
        host: host_scope(),
        objective: "obj".into(),
        coordinator_id: "coordinator-1".into(),
    };
    assert_eq!(
        params.validate_shape("host-b").unwrap_err().code,
        "unsupported_host"
    );

    let mut wrong_version = serde_json::to_value(params).unwrap();
    wrong_version["contractVersion"] = json!(2);
    let parsed: RunCreateParams = serde_json::from_value(wrong_version).unwrap();
    assert_eq!(
        parsed.validate_shape("host-a").unwrap_err().code,
        "unsupported_orchestration_contract"
    );

    let send = SendParams {
        scope: ActorScope::Coordinator(coordinator_scope()),
        kind: MessageKind::Status,
        to: None,
        subject: "s".into(),
        body: None,
        payload: None,
        thread_id: None,
        final_report: None,
    };
    assert_eq!(
        send.validate_shape("host-b").unwrap_err().code,
        "unsupported_host"
    );

    let mut missing_scope = serde_json::to_value(send).unwrap();
    missing_scope.as_object_mut().unwrap().remove("scope");
    assert!(serde_json::from_value::<SendParams>(missing_scope).is_err());
}

#[test]
fn actor_scopes_reject_contradictory_reserved_fields_but_keep_additive_ones() {
    // Coordinator-tagged scope carrying dispatch-only fields is refused at
    // decode instead of silently dropped.
    let mut contradictory = json!({
        "actorKind": "coordinator",
        "contractVersion": 1,
        "hostId": "host-a",
        "runId": "run-1",
        "coordinatorId": "coordinator-1",
        "consumerGeneration": 3
    });
    contradictory["taskId"] = json!("task-1");
    assert!(serde_json::from_value::<ActorScope>(contradictory.clone()).is_err());
    contradictory.as_object_mut().unwrap().remove("taskId");
    contradictory["dispatchId"] = json!("dispatch-1");
    assert!(serde_json::from_value::<ActorScope>(contradictory).is_err());

    // Dispatch-tagged scope carrying coordinator-only fields likewise.
    let mut worker = json!({
        "actorKind": "dispatch",
        "contractVersion": 1,
        "hostId": "host-a",
        "runId": "run-1",
        "taskId": "task-1",
        "dispatchId": "dispatch-1"
    });
    worker["consumerGeneration"] = json!(3);
    assert!(serde_json::from_value::<ActorScope>(worker.clone()).is_err());
    worker.as_object_mut().unwrap().remove("consumerGeneration");
    worker["coordinatorId"] = json!("coordinator-1");
    assert!(serde_json::from_value::<ActorScope>(worker).is_err());

    // Unrelated additive fields stay allowed.
    let mut additive = json!({
        "actorKind": "dispatch",
        "contractVersion": 1,
        "hostId": "host-a",
        "runId": "run-1",
        "taskId": "task-1",
        "dispatchId": "dispatch-1",
        "futureHint": {"optional": true}
    });
    let parsed: ActorScope = serde_json::from_value(additive.clone()).unwrap();
    assert_eq!(parsed.run_id(), "run-1");
    additive["actorKind"] = json!("coordinator");
    additive["coordinatorId"] = json!("coordinator-1");
    additive["consumerGeneration"] = json!(3);
    additive.as_object_mut().unwrap().remove("taskId");
    additive.as_object_mut().unwrap().remove("dispatchId");
    let parsed: ActorScope = serde_json::from_value(additive).unwrap();
    assert!(matches!(parsed, ActorScope::Coordinator(_)));

    // Missing or unknown tags are refused.
    assert!(serde_json::from_value::<ActorScope>(json!({"hostId": "host-a"})).is_err());
    assert!(
        serde_json::from_value::<ActorScope>(json!({
            "actorKind": "admin",
            "contractVersion": 1,
            "hostId": "host-a"
        }))
        .is_err()
    );
}

#[test]
fn generation_fences_refuse_unsafe_values() {
    for generation in [0u64, MAX_CONSUMER_GENERATION + 1, u64::MAX] {
        let params = RunUseParams {
            host: host_scope(),
            run_id: "run-1".into(),
            coordinator_id: "coordinator-1".into(),
            consumer_generation: generation,
            takeover: false,
        };
        assert_eq!(
            params.validate_shape("host-a").unwrap_err().code,
            "invalid_argument",
            "generation {generation}"
        );
    }
    let mut raw = serde_json::to_value(RunUseParams {
        host: host_scope(),
        run_id: "run-1".into(),
        coordinator_id: "coordinator-1".into(),
        consumer_generation: 1,
        takeover: false,
    })
    .unwrap();
    raw["consumerGeneration"] = json!(1.5);
    assert!(serde_json::from_value::<RunUseParams>(raw).is_err());
}

#[test]
fn check_ack_reserved_on_inspection_and_ask_contradictions_fail_at_decode() {
    // Reserved `acknowledge` on peek/all must be rejected while decoding,
    // never silently ignored.
    for mode in ["peek", "all"] {
        let raw = json!({
            "scope": ActorScope::Dispatch(dispatch_scope()),
            "mode": mode,
            "acknowledge": "delivery-1"
        });
        let error =
            serde_json::from_value::<CheckParams>(raw).expect_err("reserved ack must fail decode");
        assert!(
            error.to_string().contains("acknowledge"),
            "unexpected error: {error}"
        );
    }

    // ACK then wait for new mail in one unread call is the supported shape.
    let ack_then_wait = CheckParams {
        scope: ActorScope::Dispatch(dispatch_scope()),
        mode: CheckMode::Unread {
            acknowledge: Some("delivery-0".into()),
        },
        wait: Some(WaitPolicy {
            timeout_ms: MAX_WAIT_BUDGET_MS,
        }),
        kinds: vec![],
        inject: false,
        cursor: None,
        limit: None,
    };
    ack_then_wait.validate_shape("host-a").unwrap();

    // Wait budgets are positive and bounded.
    for timeout in [0, MAX_WAIT_BUDGET_MS + 1] {
        let over = CheckParams {
            scope: ack_then_wait.scope.clone(),
            mode: CheckMode::Unread { acknowledge: None },
            wait: Some(WaitPolicy {
                timeout_ms: timeout,
            }),
            kinds: vec![],
            inject: false,
            cursor: None,
            limit: None,
        };
        assert_eq!(
            over.validate_shape("host-a").unwrap_err().code,
            "invalid_argument",
            "timeout {timeout}"
        );
    }

    // Ask contradictions fail at JSON decoding.
    let resume_with_question = json!({
        "scope": ActorScope::Dispatch(dispatch_scope()),
        "intent": "resume",
        "questionMessageId": "question-1",
        "question": "hello again", "wait": {"timeoutMs": 100}
    });
    assert!(serde_json::from_value::<AskParams>(resume_with_question).is_err());
    let resume_with_options = json!({
        "scope": ActorScope::Dispatch(dispatch_scope()),
        "intent": "resume",
        "questionMessageId": "question-1",
        "options": ["a"], "wait": {"timeoutMs": 100}
    });
    assert!(serde_json::from_value::<AskParams>(resume_with_options).is_err());
    let resume_with_target = json!({
        "scope": ActorScope::Dispatch(dispatch_scope()),
        "intent": "resume",
        "questionMessageId": "question-1",
        "to": {"kind": "runHome"}, "wait": {"timeoutMs": 100}
    });
    assert!(serde_json::from_value::<AskParams>(resume_with_target).is_err());
    let new_with_question_id = json!({
        "scope": ActorScope::Dispatch(dispatch_scope()),
        "intent": "new",
        "question": "hello",
        "questionMessageId": "question-1", "wait": {"timeoutMs": 100}
    });
    assert!(serde_json::from_value::<AskParams>(new_with_question_id).is_err());

    // Unrelated additive fields still survive decoding of a valid intent.
    let mut additive_new = json!({
        "scope": ActorScope::Dispatch(dispatch_scope()),
        "intent": "new",
        "question": "hello",
        "wait": {"timeoutMs": 100}
    });
    additive_new["futureField"] = json!(true);
    let parsed: AskParams = serde_json::from_value(additive_new).unwrap();
    assert!(matches!(parsed.intent, AskIntent::New { .. }));

    // A result acknowledging a delivery cannot claim it as the new batch too.
    let conflated = CheckResult {
        delivery: Some(OutstandingDelivery {
            delivery_id: "delivery-1".into(),
            message_ids: vec!["msg-1".into()],
        }),
        acknowledged: Some(AckReceipt {
            delivery_id: "delivery-1".into(),
            already_acknowledged: false,
            message_ids: vec!["msg-1".into()],
        }),
        messages: vec![],
        next_cursor: None,
        timed_out: false,
        cancelled: false,
        connection_lost: false,
    };
    assert!(conflated.validate_shape().is_err());

    // Delivery batches keep whole-FIFO identity: bounded, ordered, unique.
    let duplicated = OutstandingDelivery {
        delivery_id: "delivery-1".into(),
        message_ids: vec!["msg-1".into(), "msg-1".into()],
    };
    assert!(duplicated.validate_shape().is_err());
    let oversized = OutstandingDelivery {
        delivery_id: "delivery-1".into(),
        message_ids: (0..=MAX_MAIL_BATCH)
            .map(|index| format!("msg-{index}"))
            .collect(),
    };
    assert!(oversized.validate_shape().is_err());
}

#[test]
fn generic_send_reserves_answers_for_correlated_reply() {
    for target in [
        None,
        Some(SendTarget::RunHome),
        Some(SendTarget::Dispatch {
            dispatch_id: "dispatch-1".into(),
        }),
        Some(SendTarget::Group {
            name: "@all".into(),
        }),
    ] {
        let send = SendParams {
            scope: ActorScope::Dispatch(dispatch_scope()),
            kind: MessageKind::Answer,
            to: target,
            subject: "answer".into(),
            body: Some("forged".into()),
            payload: None,
            thread_id: Some("question-thread".into()),
            final_report: None,
        };
        let error = send.validate_shape("host-a").unwrap_err();
        assert_eq!(error.code, "invalid_argument");
        assert!(error.message.contains("orchestration.reply"));
    }
}

#[test]
fn lifecycle_kinds_target_only_run_home_and_reports_require_their_payload() {
    for kind in [MessageKind::Heartbeat, MessageKind::FinalReport] {
        for target in [
            Some(SendTarget::Dispatch {
                dispatch_id: "dispatch-1".into(),
            }),
            Some(SendTarget::Group {
                name: "crew".into(),
            }),
        ] {
            let send = SendParams {
                scope: ActorScope::Dispatch(dispatch_scope()),
                kind,
                to: target,
                subject: "s".into(),
                body: None,
                payload: None,
                thread_id: None,
                final_report: None,
            };
            assert_eq!(
                send.validate_shape("host-a").unwrap_err().code,
                "invalid_argument",
                "{kind:?}"
            );
        }
        // Run home (or omitted) is the allowed lifecycle addressing.
        let final_report = matches!(kind, MessageKind::FinalReport).then(|| FinalReport {
            outcome: ReportOutcome::Succeeded,
            result: None,
        });
        let run_home = SendParams {
            scope: ActorScope::Dispatch(dispatch_scope()),
            kind,
            to: Some(SendTarget::RunHome),
            subject: "s".into(),
            body: None,
            payload: None,
            thread_id: None,
            final_report,
        };
        let omitted = SendParams {
            to: None,
            ..run_home.clone()
        };
        run_home.validate_shape("host-a").unwrap();
        omitted.validate_shape("host-a").unwrap();
    }

    let missing_report = SendParams {
        scope: ActorScope::Dispatch(dispatch_scope()),
        kind: MessageKind::FinalReport,
        to: Some(SendTarget::RunHome),
        subject: "s".into(),
        body: None,
        payload: None,
        thread_id: None,
        final_report: None,
    };
    assert!(missing_report.validate_shape("host-a").is_err());
    let stray_report = SendParams {
        scope: ActorScope::Dispatch(dispatch_scope()),
        kind: MessageKind::Status,
        to: None,
        subject: "s".into(),
        body: None,
        payload: None,
        thread_id: None,
        final_report: Some(FinalReport {
            outcome: ReportOutcome::Failed,
            result: None,
        }),
    };
    assert!(stray_report.validate_shape("host-a").is_err());
    let send_result = SendResult {
        message: None,
        batch: None,
        lifecycle: None,
        duplicate: None,
        warnings: vec![],
    };
    assert!(send_result.validate_shape().is_err());
    let both = SendResult {
        message: Some(MessageReceipt {
            message_id: "m".into(),
            sequence: None,
            run_id: None,
        }),
        batch: Some(SendBatchResult {
            messages: vec![],
            recipients: 1,
        }),
        lifecycle: None,
        duplicate: None,
        warnings: vec![],
    };
    assert!(both.validate_shape().is_err());
    let answered_without_answer = AskResult {
        question_message_id: "q".into(),
        thread_id: "t".into(),
        wait: AskWaitOutcome::Answered,
        answer: None,
        effective_timeout_ms: None,
        connection_lost: false,
    };
    assert!(answered_without_answer.validate_shape().is_err());
}

#[test]
fn wire_keys_are_camel_case_and_snake_case_is_refused_for_required_fields() {
    // Exact wire keys on the flattened enum representations.
    let send_target = SendTarget::Dispatch {
        dispatch_id: "dispatch-1".into(),
    };
    let target_json = serde_json::to_value(&send_target).unwrap();
    assert_eq!(target_json["kind"], json!("dispatch"));
    assert_eq!(target_json["dispatchId"], json!("dispatch-1"));

    let resume = AskIntent::Resume {
        question_message_id: "question-1".into(),
    };
    let resume_json = serde_json::to_value(&resume).unwrap();
    assert_eq!(resume_json["intent"], json!("resume"));
    assert_eq!(resume_json["questionMessageId"], json!("question-1"));

    let ack = CheckMode::Unread {
        acknowledge: Some("delivery-1".into()),
    };
    let ack_json = serde_json::to_value(&ack).unwrap();
    assert_eq!(ack_json["mode"], json!("unread"));
    assert_eq!(ack_json["acknowledge"], json!("delivery-1"));

    // snake_case spellings of required fields are unsupported input.
    assert!(
        serde_json::from_value::<AskIntent>(json!({
            "intent": "resume",
            "question_message_id": "question-1"
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<SendTarget>(json!({
            "kind": "dispatch",
            "dispatch_id": "dispatch-1"
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<CheckParams>(json!({
            "scope": ActorScope::Dispatch(dispatch_scope()),
            "mode": "unread",
            "acknowledge_id": "delivery-1"
        }))
        .is_err()
            || {
                let parsed: CheckParams = serde_json::from_value(json!({
                    "scope": ActorScope::Dispatch(dispatch_scope()),
                    "mode": "unread",
                    "acknowledge_id": "delivery-1"
                }))
                .unwrap();
                parsed.mode == CheckMode::Unread { acknowledge: None }
            }
    );

    // Unknown message kinds are unsupported input, not silently ignored.
    assert!(serde_json::from_value::<MessageKind>(json!("nudge")).is_err());
    assert!(
        serde_json::from_value::<CheckParams>(json!({
            "scope": ActorScope::Dispatch(dispatch_scope()),
            "mode": "peek",
            "kinds": ["guidance", "nudge"]
        }))
        .is_err()
    );
}

#[test]
fn process_liveness_has_exactly_three_verdicts_and_cursors_are_bounded() {
    for verdict in ["live", "unverifiable", "exited"] {
        let parsed: ProcessVerdict = serde_json::from_value(json!(verdict)).unwrap();
        let _ = parsed;
    }
    assert!(serde_json::from_value::<ProcessVerdict>(json!("running")).is_err());
    assert!(serde_json::from_value::<ProcessVerdict>(json!("dead")).is_err());

    assert!(OpaqueCursor("valid_cursor".into()).validate().is_ok());
    for invalid in [
        "".to_string(),
        "a b".into(),
        "a\nb".into(),
        "x".repeat(MAX_CURSOR_BYTES + 1),
    ] {
        assert!(
            OpaqueCursor(invalid.clone()).validate().is_err(),
            "cursor {invalid:?}"
        );
    }
    // 4096-byte cursors are the decided bound; host context fits.
    let long_but_legal = WorkerReadParams {
        scope: coordinator_scope(),
        dispatch_id: "dispatch-1".into(),
        cursor: Some(OpaqueCursor("x".repeat(MAX_CURSOR_BYTES))),
        limit: None,
        source: OutputSource::Auto,
    };
    long_but_legal.validate_shape("host-a").unwrap();
}

#[test]
fn no_params_or_results_serde_shape_carries_a_credential() {
    let samples: Vec<Value> = vec![
        serde_json::to_value(RunCreateParams {
            host: host_scope(),
            objective: "obj".into(),
            coordinator_id: "coordinator-1".into(),
        })
        .unwrap(),
        serde_json::to_value(RunUseResult {
            run: RunSummary {
                run_id: "r".into(),
                objective: "o".into(),
                coordinator_id: "c".into(),
                consumer_generation: 1,
                created_at_ms: 0,
            },
        })
        .unwrap(),
        serde_json::to_value(WorkerStartParams {
            scope: coordinator_scope(),
            task_id: "task-1".into(),
            placement: WorkerPlacement {
                workspace_id: "ws-1".into(),
            },
            execution: fresh_launch(),
            display_name: None,
            comment: None,
            timeout_ms: None,
            retry_of: None,
        })
        .unwrap(),
        serde_json::to_value(WorkerStartResult {
            run_id: "r".into(),
            task_id: "t".into(),
            dispatch_id: "d".into(),
            consumer_generation: 1,
            workspace_id: "ws-1".into(),
            assignment_state: AssignmentState::Ready,
            readiness: ReadinessObservation::NotObserved,
            process_verdict: ProcessVerdict::Live,
            session_identity: None,
            effects: vec![],
            residual_resources: vec![],
            failure: None,
            warning: None,
        })
        .unwrap(),
        serde_json::to_value(SendParams {
            scope: ActorScope::Dispatch(dispatch_scope()),
            kind: MessageKind::Heartbeat,
            to: None,
            subject: "s".into(),
            body: None,
            payload: None,
            thread_id: None,
            final_report: None,
        })
        .unwrap(),
        serde_json::to_value(RequestShowResult {
            request_id: "req".into(),
            state: RequestLedgerState::Committed,
            method: None,
            interpretation: "ok".into(),
            receipt: None,
        })
        .unwrap(),
    ];
    for sample in &samples {
        assert!(
            !leaks_credential_shaped_key(sample),
            "credential-shaped key leaked into {sample}"
        );
    }
}

#[test]
fn ensure_process_action_variants_round_trip() {
    for action in [
        ProcessAction::Signalled,
        ProcessAction::None,
        ProcessAction::Unverifiable,
    ] {
        let round: ProcessAction =
            serde_json::from_value(serde_json::to_value(action).unwrap()).unwrap();
        assert_eq!(round, action);
    }
}
