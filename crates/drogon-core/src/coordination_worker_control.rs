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
use crate::coordination_worker_retain::{self as retention, ResourceState, RetainDisposition};
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
                    // Source: the warning is unconditional — no signal was sent.
                    warning: Some(
                        "The worker was abandoned without signalling its process.".into(),
                    ),
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
                // Source `stop_unknown`: a stop whose outcome the host could
                // not prove (no signal reached a verifiable exit) is exit 1
                // for the CLI, distinct from a fence-only answer.
                let unknown = !already_fenced
                    && attempt.cleanup_owned
                    && (process_action == ProcessAction::Unverifiable
                        || (process_action == ProcessAction::Signalled
                            && process_verdict != ProcessVerdict::Exited));
                encode(WorkerStopResult {
                    dispatch_id: params.dispatch_id.clone(),
                    assignment_state: attempt.result.assignment_state,
                    process_action,
                    process_verdict,
                    residual_resources: worker_residuals(&attempt, process_verdict),
                    warning: (!attempt.cleanup_owned)
                        .then(|| {
                            "The existing session is not cleanup-owned by this attempt.".into()
                        })
                        .or(unknown.then(|| {
                            "The stop outcome is unknown: the process may still be live.".into()
                        })),
                    state: unknown.then(|| "stop_unknown".to_string()),
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
                if !settled_attempt(&attempt) {
                    return Err(RpcError::new(
                        "attempt_active",
                        "Release requires a settled attempt.",
                    ));
                }
                coordination_access::revoke_in_tx(tx, &params.dispatch_id, "released")?;
                // An explicit release clears a requested retention first, then
                // durably publishes `release_pending` for cleanup-owned
                // attempts BEFORE any external process control runs, so a
                // crash between commit and control still leaves the committed
                // intent behind. The actual outcome is recorded in finalize.
                retention::clear_retention_in_tx(tx, &params.dispatch_id)?;
                if attempt.cleanup_owned
                    && !matches!(
                        retention::get_state_in_tx(tx, &params.dispatch_id)?,
                        Some((ResourceState::Released, _))
                    )
                {
                    retention::record_release_in_tx(
                        tx,
                        &params.dispatch_id,
                        ResourceState::ReleasePending,
                        &crate::now_rfc3339(),
                    )?;
                }
                let already_released = retention::get_state_in_tx(tx, &params.dispatch_id)?
                    .is_some_and(|(state, _)| state == ResourceState::Released);
                Ok((attempt, already_released))
            },
            |(attempt, already_released)| {
                let (process_action, verdict) = if already_released {
                    (ProcessAction::None, ProcessVerdict::Exited)
                } else {
                    self.control_worker_process(&attempt, true)
                };
                let (disposition, state) = if already_released {
                    (
                        ResourceDisposition::Released,
                        "already_released".to_string(),
                    )
                } else if !attempt.cleanup_owned {
                    (ResourceDisposition::NoOwnedResource, "retained".to_string())
                } else if verdict == ProcessVerdict::Exited {
                    (ResourceDisposition::Released, "released".to_string())
                } else {
                    (
                        ResourceDisposition::Unverifiable,
                        "release_unknown".to_string(),
                    )
                };
                encode(WorkerReleaseResult {
                    dispatch_id: params.dispatch_id.clone(),
                    disposition,
                    state,
                    process_verdict: verdict,
                    process_action,
                    archive: None,
                    residual_resources: worker_residuals(&attempt, verdict),
                })
            },
            |tx, outcome| {
                // Record the actual release state, staged with the receipt:
                // a finished release reads `already_released` later, an
                // uncertain one stays `release_unknown` and cannot be
                // retained over. No-owned-resource releases record nothing.
                let released = outcome.as_ref().is_ok_and(|value| {
                    value
                        .get("disposition")
                        .and_then(|disposition| disposition.as_str())
                        == Some("released")
                });
                let uncertain = outcome.as_ref().is_ok_and(|value| {
                    value
                        .get("disposition")
                        .and_then(|disposition| disposition.as_str())
                        == Some("unverifiable")
                });
                if released {
                    retention::record_release_in_tx(
                        tx,
                        &params.dispatch_id,
                        ResourceState::Released,
                        &crate::now_rfc3339(),
                    )?;
                } else if uncertain {
                    retention::record_release_in_tx(
                        tx,
                        &params.dispatch_id,
                        ResourceState::ReleaseUnknown,
                        &crate::now_rfc3339(),
                    )?;
                }
                Ok(())
            },
        )
    }

    pub(crate) fn retain_coordination_worker(
        &self,
        request: &Request,
        params: &WorkerRetainParams,
    ) -> Result<Value, RpcError> {
        // Source: `retainWorkerTerminalResource` refuses active only when
        // `!worker` (unsupervised). Every native attempt is supervised, so an
        // active worker retains here without stopping: retain never signals.
        let operation = self.worker_operation(&params.dispatch_id);
        let _operation = operation.lock().unwrap();
        let _admission = self.lifecycle_gate.read().unwrap();
        // Observe the process verdict outside any receipt transaction:
        // `worker_verdict` may read session rows (db) and session handles, so
        // it must not run while this thread holds the db mutex.
        let snapshot = {
            let mut conn = self.db.lock().unwrap();
            let tx = conn.transaction().map_err(crate::error::from_sqlite)?;
            attempts::show(&tx, &params.scope, &params.dispatch_id)?
        };
        let verdict = self
            .worker_verdict(&snapshot)
            .unwrap_or(ProcessVerdict::Unverifiable);
        let expected_task = snapshot.result.task_id.clone();
        let expected_session = snapshot.result.session_identity.clone();
        let expected_workspace = snapshot.result.workspace_id.clone();
        let expected_cleanup = snapshot.cleanup_owned;
        let key = coordinator_actor(&params.scope).receipt_key(&request.request_id)?;
        // Retain is a DB-only mutation: the hold and its success receipt
        // commit atomically, so a hold never survives without its receipt.
        // The pre-observed verdict is only reported; it never changes the
        // outcome and is never re-observed under the write lock.
        self.ledger.run_atomic(
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
                if attempt.result.task_id != expected_task
                    || attempt.result.session_identity != expected_session
                    || attempt.result.workspace_id != expected_workspace
                    || attempt.cleanup_owned != expected_cleanup
                {
                    return Err(crate::error::request_conflict());
                }
                // No process or filesystem effects: the hold is only recorded.
                // An attempt without cleanup ownership holds nothing, so no
                // row is written for it.
                let stored = if attempt.cleanup_owned {
                    Some(retention::retain_in_tx(
                        tx,
                        &params.dispatch_id,
                        &crate::now_rfc3339(),
                    )?)
                } else {
                    None
                };
                let (disposition, reason, state) = match stored {
                    None => (
                        ResourceDisposition::NoOwnedResource,
                        "no_owned_resource".to_string(),
                        "retained".to_string(),
                    ),
                    Some(RetainDisposition::Retained) => (
                        ResourceDisposition::Retained,
                        "user_requested".to_string(),
                        "retained".to_string(),
                    ),
                    Some(RetainDisposition::AlreadyReleased) => (
                        ResourceDisposition::Released,
                        "already_released".to_string(),
                        "already_released".to_string(),
                    ),
                    Some(RetainDisposition::ReleaseCommitted(ResourceState::ReleasePending)) => (
                        ResourceDisposition::Unverifiable,
                        "release_committed".to_string(),
                        "release_pending".to_string(),
                    ),
                    Some(RetainDisposition::ReleaseCommitted(_)) => (
                        ResourceDisposition::Unverifiable,
                        "release_committed".to_string(),
                        "release_unknown".to_string(),
                    ),
                };
                encode(WorkerRetainResult {
                    dispatch_id: params.dispatch_id.clone(),
                    disposition,
                    reason,
                    state,
                    process_verdict: verdict,
                    process_action: ProcessAction::None,
                    archive: None,
                    residual_resources: attempt
                        .result
                        .residual_resources
                        .iter()
                        .cloned()
                        .map(|mut resource| {
                            if resource.kind == ResourceKind::Session {
                                resource.disposition = disposition;
                                if disposition == ResourceDisposition::Released {
                                    resource.action = ResourceAction::Released;
                                }
                            }
                            resource
                        })
                        .collect(),
                })
            },
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

fn settled_attempt(attempt: &Attempt) -> bool {
    attempt.outcome.is_some()
        || matches!(
            attempt.result.assignment_state,
            AssignmentState::Stopped | AssignmentState::Abandoned
        )
        || (attempt.result.assignment_state == AssignmentState::Failed
            && attempt
                .result
                .failure
                .as_ref()
                .is_some_and(|failure| failure.code == "launch_failed"))
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
