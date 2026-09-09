//! Native launch admission commits before the owned PTY effect.

use std::sync::atomic::Ordering;

use drogon_harness::{HarnessLaunchPlan, HarnessLaunchRequest};
use drogon_orchestration::{runs, tasks};
use drogon_protocol::orchestration_common::*;
use drogon_protocol::orchestration_task::{TaskShowParams, TaskStatus};
use drogon_protocol::orchestration_worker::{
    WorkerExecution, WorkerStartParams, WorkerStartResult,
};
use drogon_protocol::{Request, RpcError};
use rusqlite::{OptionalExtension, Transaction};
use serde_json::{Value, json};

use crate::coordination_attempts::{self as attempts, Attempt};
use crate::coordination_identity::DispatchCredential;
use crate::coordination_runs::{coordinator_actor, decode, encode};
use crate::session::session_admission::{self, PreparedSession, WorkerEnvironment};
use crate::{Engine, coordination_access, error, harness, session};

struct PreparedWorker {
    attempt: Attempt,
    session: PreparedSession,
    environment: WorkerEnvironment,
}

struct LaunchPlan {
    harness: HarnessLaunchPlan,
    cli: String,
    preferences: LaunchPreferences,
}

impl Engine {
    pub(crate) fn start_coordination_worker(
        &self,
        request: &Request,
        params: WorkerStartParams,
    ) -> Result<Value, RpcError> {
        let dispatch_id = format!("dispatch_{}", uuid::Uuid::new_v4());
        let operation = self.worker_operation(&dispatch_id);
        let _operation = operation.lock().unwrap();
        let _admission = self.lifecycle_gate.read().unwrap();
        let key = coordinator_actor(&params.scope).receipt_key(&request.request_id)?;
        // Defer preflight failures until after receipt lookup; replay needs no installed harness.
        let preflight = self.plan_coordination_launch(&params, &dispatch_id);
        self.ledger.run_staged(
            &self.db,
            &key,
            &request.method,
            &request.params,
            |tx| {
                runs::require_coordinator(tx, &params.scope)?;
                if self.quiescent.load(Ordering::Acquire) {
                    return Err(error::runtime_busy(
                        "service admission is frozen for shutdown",
                    ));
                }
                Ok(())
            },
            |tx| self.prepare_coordination_launch(tx, &params, &dispatch_id, preflight?),
            |prepared| self.launch_coordination_worker(&params, prepared),
            |tx, result| {
                if let Ok(value) = result {
                    let launched: WorkerStartResult = decode(value)?;
                    let attempt = attempts::finish_launch(tx, &params.scope, &launched)?;
                    if attempt.result.assignment_state == AssignmentState::Failed
                        && attempt.outcome.is_none()
                    {
                        coordination_access::revoke_in_tx(tx, &dispatch_id, "launch_failed")?;
                        tasks::set_status_in_tx(
                            tx,
                            &self.host_id,
                            &params.scope.run_id,
                            &params.task_id,
                            TaskStatus::Failed,
                        )?;
                    }
                }
                Ok(())
            },
        )
    }

    fn plan_coordination_launch(
        &self,
        params: &WorkerStartParams,
        dispatch_id: &str,
    ) -> Result<LaunchPlan, RpcError> {
        let WorkerExecution::Fresh { launch } = &params.execution else {
            return Err(RpcError::new(
                "unsupported_feature",
                "Existing sessions cannot receive a fresh private worker context yet.",
            ));
        };
        let cli = self
            .worker_cli
            .as_ref()
            .and_then(|path| path.to_str())
            .ok_or_else(|| {
                RpcError::new(
                    "unsupported_feature",
                    "This execution host has no configured worker CLI.",
                )
            })?
            .to_owned();
        let task = self.coordination_read(|tx| {
            tasks::show(
                tx,
                &TaskShowParams {
                    scope: params.scope.clone(),
                    task_id: params.task_id.clone(),
                },
            )
        })?;
        let mut launch_request: HarnessLaunchRequest = decode(&encode(launch)?)?;
        let context = json!({"hostId":self.host_id,"runId":params.scope.run_id,"taskId":params.task_id,"dispatchId":dispatch_id});
        launch_request.prompt = Some(format!(
            "You are a directly assigned Drogon worker. Do not start subworkers.\n\
             Use the host executable {} with an argv-aware process API. Its private environment carries your credential; never print it or read the admin token.\n\
             Your exact non-secret context is {}. Read orchestration --help for command syntax.\n\
             Complete the task, then send exactly one orchestration send --kind final-report with --outcome succeeded or failed, --subject and a concise --body report. Use your environment-provided run/task/dispatch scope; never impersonate a coordinator.\n\
             Use orchestration ask for a blocking question and resume its existing ID after timeout. End this assigned turn after the final report.\n\
             TASK INSTRUCTIONS:\n{}",
            serde_json::to_string(&cli)
                .map_err(|_| error::internal_error("Invalid host CLI path."))?,
            context,
            task.spec.instructions,
        ));
        Ok(LaunchPlan {
            harness: harness::resolve_launch(&launch_request)?,
            cli,
            preferences: launch.clone(),
        })
    }

    fn prepare_coordination_launch(
        &self,
        tx: &Transaction<'_>,
        params: &WorkerStartParams,
        dispatch_id: &str,
        plan: LaunchPlan,
    ) -> Result<PreparedWorker, RpcError> {
        let task = tasks::show(
            tx,
            &TaskShowParams {
                scope: params.scope.clone(),
                task_id: params.task_id.clone(),
            },
        )?;
        let allowed = task.task.status == TaskStatus::Ready
            || (params.retry_of.is_some()
                && matches!(task.task.status, TaskStatus::Failed | TaskStatus::Blocked));
        if !allowed {
            return Err(RpcError::new(
                "task_not_ready",
                "Task is not ready for a new worker attempt.",
            ));
        }
        tasks::require_completed_dependencies(
            tx,
            &self.host_id,
            &params.scope.run_id,
            &params.task_id,
        )?;
        let cwd: Option<String> = tx
            .query_row(
                "SELECT path FROM workspaces WHERE id=?1 AND host_id=?2",
                rusqlite::params![params.placement.workspace_id, self.host_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(error::from_sqlite)?;
        let cwd = cwd.ok_or_else(|| {
            error::not_found("Workspace is not registered on this execution host.")
        })?;
        // Issue #359 deviation: the fork derives a worker's parent from the
        // orchestration DB's `created_by_pane_key` recorded at task-create
        // time; this repo's coordination protocol carries no creator-session
        // identity, so daemon-spawned workers have no parent to record (CLI-
        // spawned terminals do — see `do_session_start`).
        let prepared = session_admission::reserve(
            tx,
            &self.host_id,
            &params.placement.workspace_id,
            &cwd,
            &plan.harness.command,
            &plan.harness.args,
            None,
            None,
            100,
            32,
        )?;
        let identity = SessionIdentity {
            session_id: prepared.session_id().into(),
            incarnation: prepared.incarnation().into(),
        };
        let credential = DispatchCredential::mint()?;
        coordination_access::register_in_tx(
            tx,
            &credential.digest(),
            &self.host_id,
            &params.scope.run_id,
            &params.task_id,
            dispatch_id,
            &identity.session_id,
            &identity.incarnation,
            &crate::now_rfc3339(),
        )?;
        let environment = WorkerEnvironment::new(
            credential,
            &self.host_id,
            &params.scope.run_id,
            &params.task_id,
            dispatch_id,
            &identity.session_id,
            &identity.incarnation,
            self.data_dir
                .to_str()
                .ok_or_else(|| error::invalid_argument("Worker data directory is not UTF-8."))?,
            &plan.cli,
        )?;
        let attempt = Attempt {
            result: WorkerStartResult {
                run_id: params.scope.run_id.clone(),
                task_id: params.task_id.clone(),
                dispatch_id: dispatch_id.into(),
                consumer_generation: params.scope.consumer_generation,
                workspace_id: params.placement.workspace_id.clone(),
                assignment_state: AssignmentState::Admitting,
                readiness: ReadinessObservation::NotObserved,
                process_verdict: ProcessVerdict::Unverifiable,
                session_identity: Some(identity.clone()),
                effects: vec![
                    ResourceEffect {
                        kind: ResourceKind::Workspace,
                        resource_id: params.placement.workspace_id.clone(),
                        incarnation: None,
                        action: ResourceAction::Reused,
                    },
                    ResourceEffect {
                        kind: ResourceKind::Session,
                        resource_id: identity.session_id.clone(),
                        incarnation: Some(identity.incarnation.clone()),
                        action: ResourceAction::Created,
                    },
                ],
                residual_resources: vec![ResidualResource {
                    kind: ResourceKind::Session,
                    resource_id: identity.session_id,
                    incarnation: Some(identity.incarnation),
                    action: ResourceAction::Retained,
                    disposition: ResourceDisposition::Retained,
                }],
                failure: None,
                warning: Some("Spawn acceptance does not prove prompt or model readiness.".into()),
            },
            launch: plan.preferences,
            outcome: None,
            report_message_id: None,
            report_result: None,
            cleanup_owned: true,
        };
        if let Some(replaced) =
            attempts::admit(tx, &params.scope, &attempt, params.retry_of.as_deref())?
        {
            coordination_access::revoke_in_tx(tx, &replaced, "superseded")?;
        }
        tasks::set_status_in_tx(
            tx,
            &self.host_id,
            &params.scope.run_id,
            &params.task_id,
            TaskStatus::Dispatched,
        )?;
        Ok(PreparedWorker {
            attempt,
            session: prepared,
            environment,
        })
    }

    fn launch_coordination_worker(
        &self,
        params: &WorkerStartParams,
        mut prepared: PreparedWorker,
    ) -> Result<Value, RpcError> {
        match session_admission::launch_reserved(
            self.db.clone(),
            &self.data_dir,
            prepared.session,
            Some(prepared.environment),
            &[],
        ) {
            Ok((id, handle, _)) => {
                self.sessions.lock().unwrap().insert(id, handle.clone());
                // Spawn is already accepted; preserve recovery identity on a bookkeeping fault.
                let persistence_warning = session::persist_admission(&handle).err();
                let recorded = self.coordination_read(|tx| {
                    attempts::show(tx, &params.scope, &prepared.attempt.result.dispatch_id)
                })?;
                if recorded.result.assignment_state != AssignmentState::Admitting {
                    prepared.attempt = recorded;
                } else {
                    prepared.attempt.result.assignment_state = AssignmentState::Ready;
                }
                if let Some(warning) = persistence_warning {
                    prepared.attempt.result.warning =
                        Some(match prepared.attempt.result.warning.take() {
                            Some(readiness) => format!("{readiness} {}", warning.message),
                            None => warning.message,
                        });
                }
            }
            Err(_) => {
                prepared.attempt.result.assignment_state = AssignmentState::Failed;
                prepared.attempt.result.failure = Some(AttemptFailure {
                    code: "launch_failed".into(),
                    stage: "spawn".into(),
                    message: "The selected harness could not be launched.".into(),
                });
            }
        }
        prepared.attempt.result.process_verdict = self
            .worker_verdict(&prepared.attempt)
            .unwrap_or(ProcessVerdict::Unverifiable);
        encode(prepared.attempt.result)
    }
}
