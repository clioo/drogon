//! Host-scoped read-only listing for `orchestration.workerList`.
// MIT Copyright (c) 2026 Lovecast Inc.
// Source derivation: `db/worker-terminal/worker-terminal-listing.ts`
// (`listWorkerTerminalResources`: run filter, per-row terminal derivation,
// counts over run-selected rows before the terminal-state filter) and
// `worker-terminal-ownership.ts` (`deriveWorkerTerminalListState`), adapted
// to the durable state this engine actually owns (assignment lifecycle +
// `worker_resource_retention` rows; no `worker_terminal_resources` table, no
// archives, no owned resources).
//!
//! Read-only: `coordination_read` allocates no request receipts, and listing
//! never signals, archives, or fabricates resources. Assignment/report
//! status, physical process verdict, and terminal resource state stay
//! independent axes; loss of contact never proves exit.
//!
//! Lock discipline: the DB snapshot (attempts + retention rows) is taken
//! under one read transaction, then the transaction is released before any
//! `worker_verdict` call. `worker_verdict` re-locks `self.db` for historical
//! sessions, so calling it under `coordination_read` would self-deadlock.

use drogon_protocol::MAX_FRAME_BYTES;
use drogon_protocol::orchestration_common::{AssignmentState, ReportOutcome};
use drogon_protocol::orchestration_worker::{
    DispatchListStatus, WorkerDispatchListState, WorkerListEntry, WorkerListParams,
    WorkerListResource, WorkerListResult, WorkerTerminalListState,
};
use drogon_protocol::{Request, RpcError};
use rusqlite::params;

use crate::coordination_attempts::{self as attempts, Attempt};
use crate::coordination_runs::decode;
use crate::coordination_worker_retain::{self as retention};
use crate::{Engine, error};

/// Response budget: half a frame, matching the bot snapshot convention.
/// Both the SQL preflight and the materialized serialization check fail with
/// the same honest `worker_list_too_large` instead of silently truncating.
const LIST_BUDGET_BYTES: i64 = (MAX_FRAME_BYTES / 2) as i64;
const LIST_MAX_ROWS: i64 = 5_000;

fn list_too_large() -> RpcError {
    RpcError::new(
        "worker_list_too_large",
        "Worker list exceeds the response limit; narrow it with run.",
    )
}

impl Engine {
    pub(crate) fn list_coordination_workers(
        &self,
        request: &Request,
    ) -> Result<serde_json::Value, RpcError> {
        let params: WorkerListParams = decode(&request.params)?;
        params.validate_shape(&self.host_id)?;
        // Snapshot durable state under one read transaction, then release the
        // DB lock before touching process state (deadlock fence; see above).
        let snapshot = self.coordination_read(|tx| {
            let count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM orchestration_attempts
                      WHERE host_id = ?1 AND (?2 IS NULL OR run_id = ?2)",
                    params![self.host_id, params.run.as_deref()],
                    |row| row.get(0),
                )
                .map_err(error::from_sqlite)?;
            if count > LIST_MAX_ROWS {
                return Err(list_too_large());
            }
            let bytes: i64 = tx
                .query_row(
                    "SELECT COALESCE(SUM(LENGTH(CAST(state_json AS BLOB))), 0)
                       FROM orchestration_attempts
                      WHERE host_id = ?1 AND (?2 IS NULL OR run_id = ?2)",
                    params![self.host_id, params.run.as_deref()],
                    |row| row.get(0),
                )
                .map_err(error::from_sqlite)?;
            if bytes > LIST_BUDGET_BYTES {
                return Err(list_too_large());
            }
            let mut statement = tx
                .prepare(
                    "SELECT dispatch_id FROM orchestration_attempts
                      WHERE host_id = ?1 AND (?2 IS NULL OR run_id = ?2)
                      ORDER BY sequence ASC",
                )
                .map_err(error::from_sqlite)?;
            let dispatch_ids = statement
                .query_map(params![self.host_id, params.run.as_deref()], |row| {
                    row.get::<_, String>(0)
                })
                .map_err(error::from_sqlite)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(error::from_sqlite)?;
            drop(statement);
            let mut rows = Vec::with_capacity(dispatch_ids.len());
            for dispatch_id in &dispatch_ids {
                let attempt = attempts::show_by_dispatch(tx, &self.host_id, dispatch_id)?;
                // Immutable identity: the stored row must name itself.
                if attempt.result.dispatch_id != *dispatch_id {
                    return Err(error::internal_error(
                        "Stored attempt identity is inconsistent.",
                    ));
                }
                let retained = retention::get_state_in_tx(tx, dispatch_id)?;
                rows.push((attempt, retained));
            }
            Ok(rows)
        })?;
        // Process verdicts and terminal derivation run outside the DB lock.
        let mut entries = Vec::with_capacity(snapshot.len());
        let mut materialized: i64 = 0;
        for (attempt, retained) in &snapshot {
            let verdict = self
                .worker_verdict(attempt)
                .unwrap_or(drogon_protocol::orchestration_common::ProcessVerdict::Unverifiable);
            let worker_state = derive_worker_state(attempt);
            let dispatch_status = derive_dispatch_status(attempt);
            let handle = attempt
                .result
                .session_identity
                .as_ref()
                .map(|identity| identity.session_id.clone());
            let (terminal_state, resource) =
                derive_list_state(worker_state, handle.as_deref(), attempt, retained.clone());
            let entry = WorkerListEntry {
                dispatch_id: attempt.result.dispatch_id.clone(),
                task_id: attempt.result.task_id.clone(),
                run_id: attempt.result.run_id.clone(),
                assignment_state: attempt.result.assignment_state,
                outcome: attempt.outcome,
                process_verdict: verdict,
                worker_state,
                dispatch_status,
                agent_terminal_handle: handle,
                terminal_state,
                resource,
            };
            // Bound in-memory accumulation against the same budget instead of
            // materializing an unbounded row set.
            materialized += serde_json::to_string(&entry)
                .map_err(|_| error::internal_error("Invalid worker list."))?
                .len() as i64;
            if materialized > LIST_BUDGET_BYTES {
                return Err(list_too_large());
            }
            entries.push(entry);
        }
        // Counts over the run-selected rows BEFORE the terminal-state filter;
        // rows with no terminal evidence (`None`) are skipped, as in source.
        let mut counts = std::collections::BTreeMap::new();
        for entry in &entries {
            if let Some(state) = &entry.terminal_state {
                *counts.entry(state.as_str().to_string()).or_insert(0) += 1;
            }
        }
        let workers = entries
            .into_iter()
            .filter(|entry| {
                params
                    .terminal_state
                    .as_ref()
                    .is_none_or(|want| entry.terminal_state.as_ref() == Some(want))
            })
            .collect();
        let result = WorkerListResult { workers, counts };
        let value = serde_json::to_value(&result)
            .map_err(|_| error::internal_error("Invalid worker list."))?;
        if serde_json::to_string(&value)
            .map_err(|_| error::internal_error("Invalid worker list."))?
            .len() as i64
            > LIST_BUDGET_BYTES
        {
            return Err(list_too_large());
        }
        Ok(value)
    }
}

/// Source `worker_state` from the assignment lifecycle plus reported
/// outcome: completed work maps through the outcome (`succeeded` only on a
/// succeeded report; a completed attempt with no outcome is honestly
/// `start_unknown`, never a fabricated success).
fn derive_worker_state(attempt: &Attempt) -> WorkerDispatchListState {
    match attempt.result.assignment_state {
        AssignmentState::Admitting => WorkerDispatchListState::Starting,
        AssignmentState::Ready => WorkerDispatchListState::Ready,
        AssignmentState::Completed => match attempt.outcome {
            Some(ReportOutcome::Succeeded) => WorkerDispatchListState::Succeeded,
            Some(ReportOutcome::Failed) => WorkerDispatchListState::Failed,
            None => WorkerDispatchListState::StartUnknown,
        },
        AssignmentState::Failed => WorkerDispatchListState::Failed,
        AssignmentState::Stopped => WorkerDispatchListState::Stopped,
        AssignmentState::Abandoned => WorkerDispatchListState::Abandoned,
    }
}

/// Source `dispatch_status` from the same lifecycle: admitting work is
/// pending, ready work is dispatched, completed work follows the outcome,
/// failed work failed, and stopped/abandoned dispatches completed their
/// lifecycle without failing it.
fn derive_dispatch_status(attempt: &Attempt) -> DispatchListStatus {
    match attempt.result.assignment_state {
        AssignmentState::Admitting => DispatchListStatus::Pending,
        AssignmentState::Ready => DispatchListStatus::Dispatched,
        AssignmentState::Completed => match attempt.outcome {
            Some(ReportOutcome::Succeeded) => DispatchListStatus::Completed,
            _ => DispatchListStatus::Failed,
        },
        AssignmentState::Failed => DispatchListStatus::Failed,
        AssignmentState::Stopped | AssignmentState::Abandoned => match attempt.outcome {
            Some(ReportOutcome::Succeeded) => DispatchListStatus::Completed,
            _ => DispatchListStatus::Failed,
        },
    }
}

/// Exact port of source `deriveWorkerTerminalListState`, with the engine's
/// durable retention row standing in for the source resource row:
/// released/unknown/pending/retained win by release state first. Without a
/// retention row there is no resource table, so provenance comes from the
/// immutable attempt: no proven terminal identity (failed spawn) yields
/// `None`, never a fabricated state; a reused or not-cleanup-owned terminal
/// is retained, never active; a proven cleanup-owned native session is a
/// real native resource even absent a retention row, derived from immutable
/// attempt ownership (never fabricated identity, dates, or archives).
fn derive_list_state(
    worker_state: WorkerDispatchListState,
    agent_terminal_handle: Option<&str>,
    attempt: &Attempt,
    retained: Option<(retention::ResourceState, String)>,
) -> (Option<WorkerTerminalListState>, Option<WorkerListResource>) {
    if let Some((state, reason)) = retained {
        let terminal = match state {
            retention::ResourceState::Released => WorkerTerminalListState::Released,
            retention::ResourceState::ReleaseUnknown => WorkerTerminalListState::ReleaseUnknown,
            retention::ResourceState::ReleasePending => WorkerTerminalListState::ReleasePending,
            retention::ResourceState::Retained => WorkerTerminalListState::Retained,
        };
        let resource = WorkerListResource {
            state: state.as_str().to_string(),
            reason,
        };
        return (Some(terminal), Some(resource));
    }
    let Some(_handle) = agent_terminal_handle else {
        return (None, None);
    };
    if !attempt.cleanup_owned {
        return (
            Some(WorkerTerminalListState::Retained),
            Some(WorkerListResource {
                state: "retained".to_string(),
                reason: "no_owned_resource".to_string(),
            }),
        );
    }
    let terminal = match worker_state {
        WorkerDispatchListState::Succeeded | WorkerDispatchListState::Failed => {
            WorkerTerminalListState::Reclaimable
        }
        WorkerDispatchListState::Stopped | WorkerDispatchListState::Abandoned => {
            WorkerTerminalListState::Retained
        }
        _ => WorkerTerminalListState::Active,
    };
    let resource = WorkerListResource {
        state: "owned".to_string(),
        reason: "cleanup_owned".to_string(),
    };
    (Some(terminal), Some(resource))
}
