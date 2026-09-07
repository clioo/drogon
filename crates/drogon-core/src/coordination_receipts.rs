//! Authenticated, read-only projections of the existing request ledger.

use drogon_orchestration::runs;
use drogon_protocol::orchestration_question::{
    ReceiptScope, RequestLedgerState, RequestShowParams, RequestShowResult,
};
use drogon_protocol::{Request, Response, RpcError};
use rusqlite::{OptionalExtension, Transaction};
use serde_json::{Value, json};

use crate::coordination_access::{self, WorkerBinding};
use crate::coordination_identity::Actor;
use crate::coordination_runs::{coordinator_actor, decode, encode};
use crate::{Engine, error};

const MAX_RECEIPT_BYTES: usize = 512 * 1024;

impl Engine {
    pub(crate) fn show_coordination_receipt(
        &self,
        request: &Request,
        worker: Option<&WorkerBinding>,
    ) -> Result<Value, RpcError> {
        let params: RequestShowParams = decode(&request.params)?;
        params.validate_shape(&self.host_id)?;
        let value = self.coordination_read(|tx| {
            let actor = match (&params.scope, worker) {
                (ReceiptScope::Bootstrap(scope), None) => Actor::AdminBootstrap {
                    host_id: self.host_id.clone(),
                    coordinator_id: scope.coordinator_id.clone(),
                },
                (ReceiptScope::Coordinator(scope), None) => {
                    runs::require_coordinator(tx, scope)?;
                    coordinator_actor(scope)
                }
                (ReceiptScope::Dispatch(scope), Some(binding)) => {
                    coordination_access::recheck_in_tx(tx, binding)?;
                    if scope.run_id != binding.run_id
                        || scope.task_id != binding.task_id
                        || scope.dispatch_id != binding.dispatch_id
                        || scope.host.host_id != binding.host_id
                    {
                        return Err(coordination_access::unauthorized());
                    }
                    worker_actor(binding)
                }
                _ => return Err(coordination_access::unauthorized()),
            };
            let key = actor.receipt_key(&params.request_id)?;
            encode(inspect_in_tx(tx, &key, &params.request_id)?)
        })?;
        let response = Response::success(request.request_id.clone(), value.clone());
        if serde_json::to_vec(&response)
            .map_err(|_| error::internal_error("Invalid receipt response."))?
            .len()
            > MAX_RECEIPT_BYTES
        {
            return Err(RpcError::new(
                "result_too_large",
                "Saved receipt exceeds the inspection bound.",
            ));
        }
        Ok(value)
    }
}

pub(crate) fn worker_actor(binding: &WorkerBinding) -> Actor {
    Actor::Worker {
        host_id: binding.host_id.clone(),
        run_id: binding.run_id.clone(),
        task_id: binding.task_id.clone(),
        dispatch_id: binding.dispatch_id.clone(),
        session_id: binding.session_id.clone(),
        incarnation: binding.incarnation.clone(),
    }
}

pub(crate) fn inspect_in_tx(
    tx: &Transaction<'_>,
    key: &str,
    request_id: &str,
) -> Result<RequestShowResult, RpcError> {
    let row = tx.query_row(
        "SELECT
            CASE WHEN length(CAST(method AS BLOB)) <= ?2 THEN method END,
            CASE WHEN length(CAST(status AS BLOB)) <= ?2 THEN status END,
            CASE WHEN length(CAST(result_json AS BLOB)) <= ?2 THEN result_json END,
            CASE WHEN length(CAST(error_json AS BLOB)) <= ?2 THEN error_json END,
            COALESCE(length(CAST(result_json AS BLOB)),0),COALESCE(length(CAST(error_json AS BLOB)),0)
         FROM requests WHERE request_id=?1",
        rusqlite::params![key,MAX_RECEIPT_BYTES as i64],
        |row| Ok((row.get::<_,Option<String>>(0)?,row.get::<_,Option<String>>(1)?,
            row.get::<_,Option<String>>(2)?,row.get::<_,Option<String>>(3)?,
            row.get::<_,i64>(4)?,row.get::<_,i64>(5)?)),
    ).optional().map_err(|_| error::internal_error("Receipt inspection failed."))?;
    let Some((method, status, result, failure, result_size, failure_size)) = row else {
        return Ok(RequestShowResult {
            request_id: request_id.into(),
            state: RequestLedgerState::Absent,
            method: None,
            interpretation: "No record in this actor scope; absence is not proof of no effects."
                .into(),
            receipt: None,
        });
    };
    if result_size > MAX_RECEIPT_BYTES as i64 || failure_size > MAX_RECEIPT_BYTES as i64 {
        return Err(RpcError::new(
            "result_too_large",
            "Saved receipt exceeds the inspection bound.",
        ));
    }
    let invalid = || error::internal_error("Invalid saved receipt.");
    let (Some(method), Some(status)) = (method, status) else {
        return Err(invalid());
    };
    let (state, receipt, interpretation) = match (status.as_str(), result, failure) {
        ("pending", None, None) => (
            RequestLedgerState::Pending,
            None,
            "Admission is recorded; effects may still be live or unverifiable. Replay only the same operation identity.",
        ),
        ("done", Some(result), None) => {
            let value: Value = serde_json::from_str(&result).map_err(|_| invalid())?;
            (
                RequestLedgerState::Committed,
                Some(json!({"result":value})),
                "The original result is durably recorded.",
            )
        }
        ("done", None, Some(failure)) => {
            let value: RpcError = serde_json::from_str(&failure).map_err(|_| invalid())?;
            (
                RequestLedgerState::Failed,
                Some(json!({"error":value})),
                "The original failure is durably recorded; this is not process-exit evidence.",
            )
        }
        _ => return Err(invalid()),
    };
    Ok(RequestShowResult {
        request_id: request_id.into(),
        state,
        method: Some(method),
        interpretation: interpretation.into(),
        receipt,
    })
}
