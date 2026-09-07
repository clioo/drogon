//! Commit cancellation authority before touching an exact owned process.

use std::sync::atomic::Ordering;

use drogon_orchestration::{runs, tasks};
use drogon_protocol::orchestration_common::*;
use drogon_protocol::orchestration_scope::CoordinatorScope;
use drogon_protocol::orchestration_task::TaskStatus;
use drogon_protocol::orchestration_worker::*;
use drogon_protocol::{Request, RpcError};
use serde_json::Value;

use crate::coordination_attempts::{self as attempts, Attempt};
use crate::coordination_mail::questions;
use crate::coordination_runs::{coordinator_actor, encode};
use crate::{Engine, coordination_access, error, session};

impl Engine {
    pub(crate) fn abandon_coordination_worker(
        &self,
        request: &Request,
        params: &WorkerAbandonParams,
    ) -> Result<Value, RpcError> {
        let operation = self.worker_operation(&params.dispatch_id);
        let _operation = operation.lock().unwrap();
        self.coordination_mutation(
            request,
            coordinator_actor(&params.scope),
            |tx| runs::require_coordinator(tx, &params.scope),
            |tx| {
                let attempt = attempts::fence(
                    tx,
                    &params.scope,
                    &params.dispatch_id,
                    AssignmentState::Abandoned,
                )?;
                coordination_access::revoke_in_tx(tx, &params.dispatch_id, "abandoned")?;
                questions::close_dispatch_questions_in_tx(
                    tx,
                    &params.scope.host.host_id,
                    &params.scope.run_id,
                    &params.dispatch_id,
                    "abandoned",
                )?;
                block_current_task(tx, &params.scope, &attempt)?;
                encode(WorkerAbandonResult {
                    dispatch_id: params.dispatch_id.clone(),
                    assignment_state: attempt.result.assignment_state,
                    residual_resources: attempt.result.residual_resources,
                })
            },
        )
    }

    pub(crate) fn stop_coordination_worker(
        &self,
        request: &Request,
        params: &WorkerStopParams,
    ) -> Result<Value, RpcError> {
        let operation = self.worker_operation(&params.dispatch_id);
        let _operation = operation.lock().unwrap();
        let _admission = self.lifecycle_gate.read().unwrap();
        let key = coordinator_actor(&params.scope).receipt_key(&request.request_id)?;
        self.ledger.run_staged(
            &self.db,
            &key,
            &request.method,
            &request.params,
            |tx| {
                runs::require_coordinator(tx, &params.scope)?;
                self.require_worker_admission()
            },
            |tx| {
                let before = attempts::show(tx, &params.scope, &params.dispatch_id)?;
                let already_fenced = matches!(
                    before.result.assignment_state,
                    AssignmentState::Stopped | AssignmentState::Abandoned
                );
                let attempt = attempts::fence(
                    tx,
                    &params.scope,
                    &params.dispatch_id,
                    AssignmentState::Stopped,
                )?;
                coordination_access::revoke_in_tx(tx, &params.dispatch_id, "stopped")?;
                questions::close_dispatch_questions_in_tx(
                    tx,
                    &params.scope.host.host_id,
                    &params.scope.run_id,
                    &params.dispatch_id,
                    "stopped",
                )?;
                block_current_task(tx, &params.scope, &attempt)?;
                Ok((attempt, already_fenced))
            },
            |(attempt, already_fenced)| {
                let (process_action, process_verdict) =
                    self.control_worker_process(&attempt, !already_fenced);
                encode(WorkerStopResult {
                    dispatch_id: params.dispatch_id.clone(),
                    assignment_state: attempt.result.assignment_state,
                    process_action,
                    process_verdict,
                    residual_resources: worker_residuals(&attempt, process_verdict),
                    warning: (!attempt.cleanup_owned).then(|| {
                        "The existing session is not cleanup-owned by this attempt.".into()
                    }),
                })
            },
            |_, _| Ok(()),
        )
    }

    pub(crate) fn release_coordination_worker(
        &self,
        request: &Request,
        params: &WorkerReleaseParams,
    ) -> Result<Value, RpcError> {
        let operation = self.worker_operation(&params.dispatch_id);
        let _operation = operation.lock().unwrap();
        let _admission = self.lifecycle_gate.read().unwrap();
        let key = coordinator_actor(&params.scope).receipt_key(&request.request_id)?;
        self.ledger.run_staged(
            &self.db,
            &key,
            &request.method,
            &request.params,
            |tx| {
                runs::require_coordinator(tx, &params.scope)?;
                self.require_worker_admission()
            },
            |tx| {
                let attempt = attempts::show(tx, &params.scope, &params.dispatch_id)?;
                let settled = attempt.outcome.is_some()
                    || matches!(
                        attempt.result.assignment_state,
                        AssignmentState::Stopped | AssignmentState::Abandoned
                    )
                    || (attempt.result.assignment_state == AssignmentState::Failed
                        && attempt
                            .result
                            .failure
                            .as_ref()
                            .is_some_and(|failure| failure.code == "launch_failed"));
                if !settled {
                    return Err(RpcError::new(
                        "attempt_active",
                        "Release requires a settled attempt.",
                    ));
                }
                coordination_access::revoke_in_tx(tx, &params.dispatch_id, "released")?;
                Ok(attempt)
            },
            |attempt| {
                let (_, verdict) = self.control_worker_process(&attempt, true);
                let disposition = if !attempt.cleanup_owned {
                    ResourceDisposition::NoOwnedResource
                } else if verdict == ProcessVerdict::Exited {
                    ResourceDisposition::Released
                } else {
                    ResourceDisposition::Unverifiable
                };
                encode(WorkerReleaseResult {
                    dispatch_id: params.dispatch_id.clone(),
                    disposition,
                    process_verdict: verdict,
                    residual_resources: worker_residuals(&attempt, verdict),
                })
            },
            |_, _| Ok(()),
        )
    }

    fn require_worker_admission(&self) -> Result<(), RpcError> {
        if self.quiescent.load(Ordering::Acquire) {
            return Err(error::runtime_busy(
                "service admission is frozen for shutdown",
            ));
        }
        Ok(())
    }

    fn control_worker_process(
        &self,
        attempt: &Attempt,
        signal: bool,
    ) -> (ProcessAction, ProcessVerdict) {
        let observe = || {
            self.worker_verdict(attempt)
                .unwrap_or(ProcessVerdict::Unverifiable)
        };
        if !signal || !attempt.cleanup_owned {
            return (ProcessAction::None, observe());
        }
        let Some(identity) = &attempt.result.session_identity else {
            return (ProcessAction::None, ProcessVerdict::Unverifiable);
        };
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(&identity.session_id)
            .cloned();
        let Some(handle) = handle else {
            return (ProcessAction::None, observe());
        };
        if handle.incarnation != identity.incarnation
            || handle.host_id != self.host_id
            || handle.workspace_id != attempt.result.workspace_id
        {
            return (ProcessAction::None, ProcessVerdict::Unverifiable);
        }
        let stopped = session::stop_with_action(&handle);
        let verdict = if stopped.session.is_err() {
            ProcessVerdict::Unverifiable
        } else {
            observe()
        };
        (stopped.process_action, verdict)
    }
}

fn block_current_task(
    tx: &rusqlite::Transaction<'_>,
    scope: &CoordinatorScope,
    attempt: &Attempt,
) -> Result<(), RpcError> {
    // A historical cancellation can recover its result, never mutate its replacement.
    let current: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM orchestration_attempts WHERE dispatch_id=?1 AND host_id=?2 AND run_id=?3 AND task_id=?4 AND is_current=1)",
        rusqlite::params![attempt.result.dispatch_id,scope.host.host_id,scope.run_id,attempt.result.task_id],
        |row| row.get(0),
    ).map_err(error::from_sqlite)?;
    if current {
        tasks::set_status_in_tx(
            tx,
            &scope.host.host_id,
            &scope.run_id,
            &attempt.result.task_id,
            TaskStatus::Blocked,
        )?;
    }
    Ok(())
}

fn worker_residuals(attempt: &Attempt, verdict: ProcessVerdict) -> Vec<ResidualResource> {
    attempt
        .result
        .residual_resources
        .iter()
        .cloned()
        .map(|mut resource| {
            if resource.kind == ResourceKind::Session {
                resource.disposition = match (attempt.cleanup_owned, verdict) {
                    (false, _) => ResourceDisposition::NoOwnedResource,
                    (true, ProcessVerdict::Exited) => ResourceDisposition::Released,
                    _ => ResourceDisposition::Unverifiable,
                };
                if resource.disposition == ResourceDisposition::Released {
                    resource.action = ResourceAction::Released;
                }
            }
            resource
        })
        .collect()
}
