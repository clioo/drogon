//! Durable decision gates. Engine admission checks active attempts in the same transaction.
//! MIT Copyright (c) 2026 Lovecast Inc.
//! Behavioral port of db/decision-gates/decision-gate-store.ts from the reference.
use crate::schema::store_error;
use crate::{runs, tasks};
use drogon_protocol::orchestration_gate::*;
use drogon_protocol::orchestration_scope::CoordinatorScope;
use drogon_protocol::orchestration_task::{TaskShowParams, TaskStatus};
use drogon_protocol::{MAX_FRAME_BYTES, RpcError};
use rusqlite::{OptionalExtension, Row, Transaction, params};

fn row(row: &Row<'_>) -> rusqlite::Result<GateRecord> {
    let status = match row.get::<_, String>("status")?.as_str() {
        "pending" => GateStatus::Pending,
        "resolved" => GateStatus::Resolved,
        "timeout" => GateStatus::Timeout,
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    Ok(GateRecord {
        id: row.get("id")?,
        run_id: row.get("run_id")?,
        task_id: row.get("task_id")?,
        question: row.get("question")?,
        options: row.get("options")?,
        status,
        resolution: row.get("resolution")?,
        created_at: row.get("created_at")?,
        resolved_at: row.get("resolved_at")?,
    })
}
pub fn get(
    tx: &Transaction<'_>,
    scope: &CoordinatorScope,
    id: &str,
) -> Result<GateRecord, RpcError> {
    runs::require_coordinator(tx, scope)?;
    tx.query_row(
        "SELECT * FROM orchestration_gates WHERE id=?1 AND run_id=?2 AND host_id=?3",
        params![id, scope.run_id, scope.host.host_id],
        row,
    )
    .optional()
    .map_err(store_error)?
    .ok_or_else(|| RpcError::new("gate_not_found", "Gate not found in this run."))
}
pub fn create(
    tx: &Transaction<'_>,
    params: &GateCreateParams,
    id: &str,
) -> Result<GateResult, RpcError> {
    params.validate_shape(&params.scope.host.host_id)?;
    tasks::show(
        tx,
        &TaskShowParams {
            scope: params.scope.clone(),
            task_id: params.task_id.clone(),
        },
    )?;
    let options = serde_json::to_string(&params.options).map_err(store_error)?;
    tx.execute("INSERT INTO orchestration_gates(id,host_id,run_id,task_id,question,options) VALUES (?1,?2,?3,?4,?5,?6)",
        params![id, params.scope.host.host_id, params.scope.run_id, params.task_id, params.question, options]).map_err(store_error)?;
    tasks::set_status_in_tx(
        tx,
        &params.scope.host.host_id,
        &params.scope.run_id,
        &params.task_id,
        TaskStatus::Blocked,
    )?;
    Ok(GateResult {
        gate: get(tx, &params.scope, id)?,
    })
}
pub fn resolve(tx: &Transaction<'_>, params: &GateResolveParams) -> Result<GateResult, RpcError> {
    params.validate_shape(&params.scope.host.host_id)?;
    let gate = get(tx, &params.scope, &params.gate_id)?;
    if gate.status == GateStatus::Resolved {
        // Re-resolving a settled gate is a no-op read-back (source: the
        // unconditional UPDATE would overwrite a resolved gate; refuse a
        // different resolution instead of silently rewriting it).
        if gate.resolution.as_deref() != Some(params.resolution.as_str()) {
            return Err(RpcError::new(
                "answer_conflict",
                "Gate is already resolved with a different resolution.",
            ));
        }
        return Ok(GateResult { gate });
    }
    let changed = tx.execute("UPDATE orchestration_gates SET status='resolved',resolution=?2,resolved_at=datetime('now') WHERE id=?1 AND status='pending'",
        params![params.gate_id,params.resolution]).map_err(store_error)?;
    if changed != 1 {
        return Err(store_error("Gate resolution was not persisted."));
    }
    tasks::set_status_in_tx(
        tx,
        &params.scope.host.host_id,
        &params.scope.run_id,
        &gate.task_id,
        TaskStatus::Ready,
    )?;
    Ok(GateResult {
        gate: get(tx, &params.scope, &params.gate_id)?,
    })
}
pub fn list(tx: &Transaction<'_>, params: &GateListParams) -> Result<GateListResult, RpcError> {
    params.validate_shape(&params.scope.host.host_id)?;
    runs::require_coordinator(tx, &params.scope)?;
    let mut statement = tx.prepare("SELECT * FROM orchestration_gates WHERE host_id=?1 AND run_id=?2 AND (?3 IS NULL OR task_id=?3) AND (?4 IS NULL OR status=?4) ORDER BY created_at,rowid").map_err(store_error)?;
    let rows = statement
        .query_map(
            params![
                params.scope.host.host_id,
                params.scope.run_id,
                params.task_id,
                params.status.map(GateStatus::as_str)
            ],
            row,
        )
        .map_err(store_error)?;
    let mut gates = Vec::new();
    let mut bytes = 0usize;
    for gate in rows {
        let gate = gate.map_err(store_error)?;
        bytes += serde_json::to_vec(&gate).map_err(store_error)?.len() + 1;
        if bytes > MAX_FRAME_BYTES / 2 {
            return Err(RpcError::new(
                "result_too_large",
                "Gate listing exceeds the response bound; filter by task or status.",
            ));
        }
        gates.push(gate);
    }
    Ok(GateListResult {
        run_id: params.scope.run_id.clone(),
        count: gates.len(),
        gates,
    })
}
