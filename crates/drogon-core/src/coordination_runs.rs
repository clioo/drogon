//! Engine-owned admission and receipts around transaction-only run/task operations.

use drogon_orchestration::{runs, tasks};
use drogon_protocol::orchestration_run::*;
use drogon_protocol::orchestration_scope::CoordinatorScope;
use drogon_protocol::orchestration_task::*;
use drogon_protocol::{Request, RpcError};
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::sync::atomic::Ordering;

use crate::coordination_attempts;
use crate::coordination_identity::Actor;
use crate::{Engine, error, now_unix_ms as now_ms, requests};

impl Engine {
    pub(crate) fn dispatch_run_task(&self, request: &Request) -> Result<Value, RpcError> {
        match request.method.as_str() {
            "orchestration.runCreate" => {
                let params: RunCreateParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                let actor = Actor::AdminBootstrap {
                    host_id: self.host_id.clone(),
                    coordinator_id: params.coordinator_id.clone(),
                };
                self.coordination_mutation(
                    request,
                    actor,
                    |_| Ok(()),
                    |tx| encode(runs::create(tx, &params, &new_id("run"), now_ms())?),
                )
            }
            "orchestration.runUse" => {
                let params: RunUseParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                let actor = coordinator_actor(&CoordinatorScope {
                    host: params.host.clone(),
                    run_id: params.run_id.clone(),
                    coordinator_id: params.coordinator_id.clone(),
                    consumer_generation: params.consumer_generation,
                });
                let key = actor.receipt_key(&request.request_id)?;
                self.coordination_mutation(
                    request,
                    actor,
                    |tx| authorize_run_use(tx, &params, request, &key),
                    |tx| encode(runs::use_run(tx, &params)?),
                )
            }
            "orchestration.runList" => {
                let params: RunListParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                self.coordination_read(|tx| encode(runs::list(tx, &params)?))
            }
            "orchestration.runShow" => {
                let params: RunShowParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                self.coordination_read(|tx| encode(runs::show(tx, &params)?))
            }
            "orchestration.taskCreate" => {
                let params: TaskCreateParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                self.coordination_mutation(
                    request,
                    coordinator_actor(&params.scope),
                    |tx| runs::require_coordinator(tx, &params.scope),
                    |tx| encode(tasks::create(tx, &params, &new_id("task"), now_ms())?),
                )
            }
            "orchestration.taskList" => {
                let params: TaskListParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                self.coordination_read(|tx| {
                    runs::require_coordinator(tx, &params.scope)?;
                    encode(tasks::list(tx, &params)?)
                })
            }
            "orchestration.taskShow" => {
                let params: TaskShowParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                let (mut result, history) = self.coordination_read(|tx| {
                    runs::require_coordinator(tx, &params.scope)?;
                    Ok((
                        tasks::show(tx, &params)?,
                        coordination_attempts::history(tx, &params.scope, &params.task_id)?,
                    ))
                })?;
                for (index, entry) in history.into_iter().enumerate() {
                    let verdict = self.worker_verdict(&entry.attempt)?;
                    if entry.active {
                        result.active_dispatch_id = Some(entry.attempt.result.dispatch_id.clone());
                    }
                    result
                        .attempts
                        .push(drogon_protocol::orchestration_common::AttemptSummary {
                            dispatch_id: entry.attempt.result.dispatch_id,
                            attempt: (index + 1) as u32,
                            retry_of: entry.retry_of,
                            assignment_state: entry.attempt.result.assignment_state,
                            outcome: entry.attempt.outcome,
                            process_verdict: verdict,
                        });
                }
                encode(result)
            }
            other => Err(error::method_not_found(other)),
        }
    }

    pub(crate) fn coordination_mutation(
        &self,
        request: &Request,
        actor: Actor,
        authorize: impl FnOnce(&Transaction<'_>) -> Result<(), RpcError>,
        work: impl FnOnce(&Transaction<'_>) -> Result<Value, RpcError>,
    ) -> Result<Value, RpcError> {
        let key = actor.receipt_key(&request.request_id)?;
        let _admission = self.lifecycle_gate.read().unwrap();
        self.ledger.run_atomic(
            &self.db,
            &key,
            &request.method,
            &request.params,
            |tx| {
                authorize(tx)?;
                if self.quiescent.load(Ordering::Acquire) {
                    return Err(error::runtime_busy(
                        "service admission is frozen for shutdown",
                    ));
                }
                Ok(())
            },
            work,
        )
    }

    pub(crate) fn coordination_read<T>(
        &self,
        read: impl FnOnce(&Transaction<'_>) -> Result<T, RpcError>,
    ) -> Result<T, RpcError> {
        let mut conn = self.db.lock().unwrap();
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Deferred)
            .map_err(error::from_sqlite)?;
        // Fence and payload share one snapshot; reads never allocate request receipts.
        read(&tx)
    }
}

pub(crate) fn coordinator_actor(scope: &CoordinatorScope) -> Actor {
    Actor::Coordinator {
        host_id: scope.host.host_id.clone(),
        run_id: scope.run_id.clone(),
        coordinator_id: scope.coordinator_id.clone(),
        consumer_generation: scope.consumer_generation,
    }
}

fn authorize_run_use(
    tx: &Transaction<'_>,
    params: &RunUseParams,
    request: &Request,
    key: &str,
) -> Result<(), RpcError> {
    let current = runs::show(
        tx,
        &RunShowParams {
            host: params.host.clone(),
            run_id: params.run_id.clone(),
        },
    )?
    .run;
    if current.consumer_generation == params.consumer_generation
        && (params.takeover || current.coordinator_id == params.coordinator_id)
    {
        return Ok(());
    }
    // Only the exact committed takeover may replay across its own generation advance.
    if params.takeover
        && current.coordinator_id == params.coordinator_id
        && params.consumer_generation.checked_add(1) == Some(current.consumer_generation)
    {
        let stored: Option<(String, String)> = tx.query_row(
            "SELECT fingerprint, result_json FROM requests WHERE request_id = ?1 AND status = 'done' AND error_json IS NULL AND result_json IS NOT NULL",
            [key], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(error::from_sqlite)?;
        if let Some((fingerprint, result)) = stored
            && fingerprint == requests::fingerprint(&request.method, &request.params)
        {
            let receipt: RunUseResult = serde_json::from_str(&result)
                .map_err(|_| error::internal_error("invalid takeover receipt"))?;
            if receipt.run == current {
                return Ok(());
            }
        }
    }
    Err(RpcError::new(
        "consumer_fenced",
        "Coordinator binding has changed.",
    ))
}

pub(crate) fn decode<T: DeserializeOwned>(value: &Value) -> Result<T, RpcError> {
    serde_json::from_value(value.clone())
        .map_err(|_| RpcError::new("invalid_argument", "Invalid coordination parameters."))
}

pub(crate) fn encode(value: impl Serialize) -> Result<Value, RpcError> {
    serde_json::to_value(value).map_err(|_| error::internal_error("invalid coordination result"))
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", uuid::Uuid::new_v4())
}
