//! `orchestration.dispatch`: coordinator sends a ready task to an existing
//! live terminal, optionally injecting the preamble into it.
// MIT Copyright (c) 2026 Lovecast Inc.
// Source derivation: `src/main/runtime/rpc/methods/orchestration-dispatch-methods.ts`
// (`orchestration.dispatch`) and `src/main/runtime/orchestration/preamble.ts`
// (`buildDispatchPreamble`), adapted to the durable state this engine owns.
//!
//! Native mapping: the target `--to` resolves to a session id that must be
//! live in this host's session map (no PID guessing); the dispatch is stored
//! as a native attempt with `cleanup_owned: false`, which is exactly the
//! unsupervised marker — worker-list derives `retained`/`no_owned_resource`
//! for it, worker-retain records `no_owned_resource`, and worker-stop fences
//! without signalling the process. No `worker_resource_retention` row is
//! created: a dispatch context owns no resource. `--inject` writes the
//! preamble through `session::write` after the admission commits; capability
//! minting goes through `coordination_access::register_in_tx` so `worker_done`
//! settles the dispatch with the scoped credential. Inject failure marks the
//! attempt failed (`failDispatch` + throw) without touching the target.

use std::sync::Arc;
use std::sync::atomic::Ordering;

use drogon_orchestration::{runs, tasks};
use drogon_protocol::orchestration_common::{
    AssignmentState, LaunchPermissionMode, LaunchPreferences, ProcessVerdict, ReadinessObservation,
    SessionIdentity,
};
use drogon_protocol::orchestration_run::{DispatchParams, DispatchResult};
use drogon_protocol::orchestration_task::{TaskShowParams, TaskStatus};
use drogon_protocol::orchestration_worker::{WorkerShowResult, WorkerStartResult};
use drogon_protocol::{Request, RpcError};
use serde_json::Value;

use crate::coordination_attempts::{self as attempts, Attempt};
use crate::coordination_identity::DispatchCredential;
use crate::coordination_runs::{coordinator_actor, encode};
use crate::session::SessionHandle;
use crate::{Engine, coordination_access, error, session};

/// Native `--inject` gate: only a harness-launched session (an observed
/// agent) may receive an injected preamble. Plain shells carry
/// `harness_id: None`; injecting into one would dump the preamble as shell
/// input (source: the inject rejection for terminals with no detected agent).
fn inject_rejection(terminal: &str) -> RpcError {
    error::invalid_argument(format!(
        "Cannot dispatch --inject to terminal {terminal}: no recognized agent detected. \
         Start an agent in the terminal and let it finish launching, \
         or dispatch without --inject and send the prompt manually."
    ))
}

struct PreparedDispatch {
    attempt: Attempt,
    scope: drogon_protocol::orchestration_scope::CoordinatorScope,
    target: Arc<SessionHandle>,
    inject: bool,
    return_preamble: bool,
    secret: Option<String>,
}

impl Engine {
    pub(crate) fn dispatch_coordination(
        &self,
        request: &Request,
        params: DispatchParams,
    ) -> Result<Value, RpcError> {
        if params.dry_run {
            // Read-only preview: no receipt, no attempt, task state untouched.
            let preamble = self.coordination_read(|tx| {
                runs::require_coordinator(tx, &params.scope)?;
                tasks::show(
                    tx,
                    &TaskShowParams {
                        scope: params.scope.clone(),
                        task_id: params.task_id.clone(),
                    },
                )?;
                Ok(
                    crate::coordination_preamble::build_dispatch_preamble_with_capability(
                        &params.scope,
                        &params.task_id,
                        "ctx_dryrun",
                        None,
                    ),
                )
            })?;
            return encode(DispatchResult {
                dispatch: None,
                injected: false,
                dry_run: true,
                preamble: Some(preamble),
            });
        }
        let to = params.to.clone().ok_or_else(|| {
            error::invalid_argument(
                "Missing --to: a live target terminal is required unless --dry-run.",
            )
        })?;
        // Session-list identity check before any state effect: the target
        // must be a live session observed by this host.
        let target = self
            .sessions
            .lock()
            .unwrap()
            .get(&to)
            .cloned()
            .ok_or_else(|| {
                error::not_found("Target terminal is not a live session on this host.")
            })?;
        if params.inject && target.harness_id.is_none() {
            return Err(inject_rejection(&to));
        }
        let dispatch_id = format!("dispatch_{}", uuid::Uuid::new_v4());
        let operation = self.worker_operation(&dispatch_id);
        let _operation = operation.lock().unwrap();
        let _admission = self.lifecycle_gate.read().unwrap();
        let key = coordinator_actor(&params.scope).receipt_key(&request.request_id)?;
        // Mint before admission so the preamble embeds the exact secret whose
        // digest the admission registers; the secret itself never hits the DB.
        let credential = params.inject.then(DispatchCredential::mint).transpose()?;
        let secret = credential
            .as_ref()
            .map(|credential| credential.as_secret_str().to_owned());
        let digest = credential.as_ref().map(|credential| credential.digest());
        // Source `findActiveDispatchForAssignee`: one live terminal hosts at
        // most one active dispatch; a second one on the same pane is refused
        // before any state effect. The check lives in the admission
        // transaction so a retry's receipt lookup precedes it. The occupancy
        // probe must not run against the replay path: run_staged looks the
        // receipt up first and returns it before calling this closure again.
        let prepare = |tx: &rusqlite::Transaction<'_>| {
            let occupied: bool = tx
                .query_row(
                    "SELECT EXISTS(
                        SELECT 1 FROM orchestration_attempts a
                        WHERE a.host_id=?1 AND a.fenced=0
                          AND json_extract(a.state_json,'$.result.sessionIdentity.sessionId')=?2
                          AND NOT EXISTS(
                            SELECT 1 FROM requests r
                            WHERE r.request_id=?3 AND r.status='done' AND r.error_json IS NULL
                              AND r.result_json IS NOT NULL
                              AND json_extract(r.result_json,'$.dispatch.dispatchId') = a.dispatch_id
                          )
                    )",
                    rusqlite::params![&self.host_id, &target.session_id, &key],
                    |row| row.get(0),
                )
                .map_err(error::from_sqlite)?;
            if occupied {
                return Err(RpcError::new(
                    "attempt_active",
                    format!("Terminal {} already has an active dispatch.", to),
                ));
            }
            Ok(())
        };
        self.ledger.run_staged(
            &self.db,
            &key,
            &request.method,
            &request.params,
            |tx| {
                runs::require_coordinator(tx, &params.scope)?;
                prepare(tx)?;
                if self.quiescent.load(Ordering::Acquire) {
                    return Err(error::runtime_busy(
                        "service admission is frozen for shutdown",
                    ));
                }
                Ok(())
            },
            |tx| {
                self.prepare_dispatch(
                    tx,
                    &params,
                    &dispatch_id,
                    &target,
                    digest.as_deref(),
                    secret.clone(),
                )
            },
            |prepared| self.inject_dispatch(prepared),
            |tx, outcome| {
                if outcome.is_err() {
                    attempts::mark_inject_failed(
                        tx,
                        &params.scope,
                        &dispatch_id,
                        &outcome
                            .as_ref()
                            .err()
                            .map(|reason| reason.message.clone())
                            .unwrap_or_else(|| "inject failed".into()),
                    )?;
                    coordination_access::revoke_in_tx(tx, &dispatch_id, "inject_failed")?;
                }
                Ok(())
            },
        )
    }

    fn prepare_dispatch(
        &self,
        tx: &rusqlite::Transaction<'_>,
        params: &DispatchParams,
        dispatch_id: &str,
        target: &Arc<SessionHandle>,
        digest: Option<&str>,
        secret: Option<String>,
    ) -> Result<PreparedDispatch, RpcError> {
        let task = tasks::show(
            tx,
            &TaskShowParams {
                scope: params.scope.clone(),
                task_id: params.task_id.clone(),
            },
        )?;
        if task.task.status != TaskStatus::Ready {
            return Err(RpcError::new(
                "task_not_ready",
                format!(
                    "Task {} is {}; only ready tasks can be dispatched.",
                    params.task_id,
                    status_label(task.task.status)
                ),
            ));
        }
        tasks::require_completed_dependencies(
            tx,
            &self.host_id,
            &params.scope.run_id,
            &params.task_id,
        )?;
        let attempt = Attempt {
            result: WorkerStartResult {
                run_id: params.scope.run_id.clone(),
                task_id: params.task_id.clone(),
                dispatch_id: dispatch_id.to_owned(),
                consumer_generation: params.scope.consumer_generation,
                workspace_id: target.workspace_id.clone(),
                assignment_state: AssignmentState::Ready,
                readiness: ReadinessObservation::NotObserved,
                process_verdict: ProcessVerdict::Unverifiable,
                session_identity: Some(SessionIdentity {
                    session_id: target.session_id.clone(),
                    incarnation: target.incarnation.clone(),
                }),
                effects: vec![],
                residual_resources: vec![],
                failure: None,
                warning: Some(
                    "Unsupervised dispatch: the coordinator owns no process handle for this terminal."
                        .into(),
                ),
            },
            launch: LaunchPreferences {
                harness_id: "dispatch".into(),
                model: None,
                effort: None,
                provider: None,
                permission_mode: LaunchPermissionMode::Inherit,
            },
            outcome: None,
            report_message_id: None,
            report_result: None,
            cleanup_owned: false,
        };
        if let Some(replaced) = attempts::admit_dispatch(tx, &params.scope, &attempt)? {
            coordination_access::revoke_in_tx(tx, &replaced, "superseded")?;
        }
        if let Some(digest) = digest {
            coordination_access::register_in_tx(
                tx,
                digest,
                &self.host_id,
                &params.scope.run_id,
                &params.task_id,
                dispatch_id,
                &target.session_id,
                &target.incarnation,
                &crate::now_rfc3339(),
            )?;
        }
        tasks::set_status_in_tx(
            tx,
            &self.host_id,
            &params.scope.run_id,
            &params.task_id,
            TaskStatus::Dispatched,
        )?;
        Ok(PreparedDispatch {
            attempt,
            scope: params.scope.clone(),
            target: Arc::clone(target),
            inject: params.inject,
            return_preamble: params.return_preamble,
            secret,
        })
    }

    /// Runs with neither ledger nor database mutex held. Builds the preamble
    /// once so the injected bytes and the returned text are identical, then
    /// writes it into the target session when `--inject` was requested.
    fn inject_dispatch(&self, prepared: PreparedDispatch) -> Result<Value, RpcError> {
        let preamble = crate::coordination_preamble::build_dispatch_preamble_with_capability(
            &prepared.scope,
            &prepared.attempt.result.task_id,
            &prepared.attempt.result.dispatch_id,
            prepared.secret.as_deref(),
        );
        let mut injected = false;
        if prepared.inject {
            prepared.target.note_agent_prompt(&preamble);
            session::write(&prepared.target, preamble.as_bytes())?;
            injected = true;
        }
        let verdict = self
            .worker_verdict(&prepared.attempt)
            .unwrap_or(ProcessVerdict::Unverifiable);
        let attempt = &prepared.attempt;
        let row = WorkerShowResult {
            dispatch_id: attempt.result.dispatch_id.clone(),
            task_id: attempt.result.task_id.clone(),
            assignment_state: attempt.result.assignment_state,
            readiness: attempt.result.readiness,
            process_verdict: verdict,
            outcome: attempt.outcome,
            report_result: attempt.report_result.clone(),
            session_identity: attempt.result.session_identity.clone(),
            launch: Some(attempt.launch.clone()),
            residual_resources: attempt.result.residual_resources.clone(),
            failure: attempt.result.failure.clone(),
            warning: attempt.result.warning.clone(),
            observation: self.agent_wait_observation(attempt),
        };
        if let Err(err) = row.validate_shape() {
            debug_assert!(false, "invalid dispatch row: {err}");
        }
        encode(DispatchResult {
            dispatch: Some(row),
            injected,
            dry_run: false,
            preamble: prepared.return_preamble.then_some(preamble),
        })
    }
}

#[cfg(test)]
#[path = "coordination_dispatch_tests.rs"]
mod tests;

fn status_label(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::Pending => "pending",
        TaskStatus::Ready => "ready",
        TaskStatus::Dispatched => "dispatched",
        TaskStatus::Completed => "completed",
        TaskStatus::Failed => "failed",
        TaskStatus::Blocked => "blocked",
    }
}
