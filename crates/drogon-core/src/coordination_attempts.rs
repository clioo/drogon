//! Durable attempt state; callers supply the transaction and all authority checks.

use drogon_protocol::RpcError;
use drogon_protocol::orchestration_common::{AssignmentState, LaunchPreferences, ReportOutcome};
use drogon_protocol::orchestration_scope::CoordinatorScope;
use drogon_protocol::orchestration_worker::WorkerStartResult;
use rusqlite::{OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};

use crate::error;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct Attempt {
    pub(crate) result: WorkerStartResult,
    pub(crate) launch: LaunchPreferences,
    pub(crate) outcome: Option<ReportOutcome>,
    pub(crate) report_message_id: Option<String>,
    pub(crate) cleanup_owned: bool,
}

pub(crate) fn migrate(tx: &Transaction<'_>) -> Result<(), RpcError> {
    tx.execute_batch("CREATE TABLE IF NOT EXISTS schema_versions (component TEXT PRIMARY KEY, version INTEGER NOT NULL);").map_err(error::from_sqlite)?;
    let version: Option<i64> = tx
        .query_row(
            "SELECT version FROM schema_versions WHERE component='orchestration_attempts'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(error::from_sqlite)?;
    if version.is_some_and(|v| v != 1) {
        return Err(RpcError::new(
            "unsupported_orchestration_contract",
            "Unsupported attempt schema version.",
        ));
    }
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS orchestration_attempts (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            dispatch_id TEXT NOT NULL UNIQUE,
            host_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            is_current INTEGER NOT NULL CHECK(is_current IN (0,1)),
            fenced INTEGER NOT NULL CHECK(fenced IN (0,1)),
            retry_of TEXT,
            state_json TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS orchestration_attempt_current
            ON orchestration_attempts(host_id,run_id,task_id) WHERE is_current=1;
        CREATE INDEX IF NOT EXISTS orchestration_attempt_history
            ON orchestration_attempts(host_id,run_id,task_id,sequence);
        INSERT OR IGNORE INTO schema_versions(component,version) VALUES ('orchestration_attempts',1);",
    ).map_err(error::from_sqlite)
}

fn decode(value: String) -> Result<Attempt, RpcError> {
    serde_json::from_str(&value).map_err(|_| error::internal_error("Invalid stored attempt."))
}

fn encode(attempt: &Attempt) -> Result<String, RpcError> {
    serde_json::to_string(attempt).map_err(|_| error::internal_error("Invalid attempt state."))
}

pub(crate) fn show(
    tx: &Transaction<'_>,
    scope: &CoordinatorScope,
    dispatch_id: &str,
) -> Result<Attempt, RpcError> {
    let value: Option<(String,String)> = tx.query_row(
        "SELECT state_json,task_id FROM orchestration_attempts WHERE dispatch_id=?1 AND host_id=?2 AND run_id=?3",
        params![dispatch_id,scope.host.host_id,scope.run_id], |r| Ok((r.get(0)?,r.get(1)?)),
    ).optional().map_err(error::from_sqlite)?;
    let (state, task_id) =
        value.ok_or_else(|| error::not_found("Attempt does not exist in this run."))?;
    let attempt = decode(state)?;
    if attempt.result.run_id != scope.run_id
        || attempt.result.task_id != task_id
        || attempt.result.dispatch_id != dispatch_id
    {
        return Err(error::internal_error(
            "Stored attempt identity is inconsistent.",
        ));
    }
    Ok(attempt)
}

pub(crate) struct HistoryEntry {
    pub(crate) attempt: Attempt,
    pub(crate) retry_of: Option<String>,
    pub(crate) active: bool,
}

pub(crate) fn history(
    tx: &Transaction<'_>,
    scope: &CoordinatorScope,
    task_id: &str,
) -> Result<Vec<HistoryEntry>, RpcError> {
    let mut statement = tx
        .prepare(
            "SELECT dispatch_id,retry_of,is_current,fenced FROM orchestration_attempts
         WHERE host_id=?1 AND run_id=?2 AND task_id=?3 ORDER BY sequence LIMIT 501",
        )
        .map_err(error::from_sqlite)?;
    let rows = statement
        .query_map(params![scope.host.host_id, scope.run_id, task_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, bool>(2)?,
                row.get::<_, bool>(3)?,
            ))
        })
        .map_err(error::from_sqlite)?;
    let mut history = Vec::new();
    for row in rows {
        if history.len() == 500 {
            return Err(RpcError::new(
                "result_too_large",
                "Task history exceeds the response bound.",
            ));
        }
        let (dispatch_id, retry_of, current, fenced) = row.map_err(error::from_sqlite)?;
        let attempt = show(tx, scope, &dispatch_id)?;
        let awaiting_report = matches!(
            attempt.result.assignment_state,
            AssignmentState::Admitting | AssignmentState::Ready
        ) || (attempt.result.assignment_state == AssignmentState::Failed
            && attempt
                .result
                .failure
                .as_ref()
                .is_some_and(|failure| failure.code == "agent_prompt_stalled"));
        let active = current && !fenced && awaiting_report;
        history.push(HistoryEntry {
            attempt,
            retry_of,
            active,
        });
    }
    Ok(history)
}

/// Replacement preserves the old row and fences it in the admission transaction.
pub(crate) fn admit(
    tx: &Transaction<'_>,
    scope: &CoordinatorScope,
    attempt: &Attempt,
    retry_of: Option<&str>,
) -> Result<Option<String>, RpcError> {
    let result = &attempt.result;
    if result.run_id != scope.run_id
        || result.consumer_generation != scope.consumer_generation
        || result.assignment_state != AssignmentState::Admitting
        || attempt.outcome.is_some()
    {
        return Err(error::invalid_argument("Invalid attempt admission."));
    }
    let current: Option<(String,String)> = tx.query_row(
        "SELECT dispatch_id,state_json FROM orchestration_attempts WHERE host_id=?1 AND run_id=?2 AND task_id=?3 AND is_current=1",
        params![scope.host.host_id,scope.run_id,result.task_id], |r| Ok((r.get(0)?,r.get(1)?)),
    ).optional().map_err(error::from_sqlite)?;
    let replaced = match current {
        None if retry_of.is_none() => None,
        Some((id, state)) if retry_of == Some(id.as_str()) => {
            let prior = decode(state)?;
            if !matches!(
                prior.result.assignment_state,
                AssignmentState::Failed | AssignmentState::Stopped | AssignmentState::Abandoned
            ) {
                return Err(RpcError::new(
                    "attempt_active",
                    "The current attempt cannot be replaced.",
                ));
            }
            Some(id)
        }
        _ => {
            return Err(RpcError::new(
                "retry_required",
                "Retry must name the latest replaceable attempt.",
            ));
        }
    };
    if let Some(id) = &replaced {
        tx.execute(
            "UPDATE orchestration_attempts SET is_current=0,fenced=1 WHERE dispatch_id=?1",
            [id],
        )
        .map_err(error::from_sqlite)?;
    }
    tx.execute(
        "INSERT INTO orchestration_attempts(dispatch_id,host_id,run_id,task_id,is_current,fenced,state_json,retry_of) VALUES (?1,?2,?3,?4,1,0,?5,?6)",
        params![result.dispatch_id,scope.host.host_id,scope.run_id,result.task_id,encode(attempt)?,retry_of],
    ).map_err(error::from_sqlite)?;
    Ok(replaced)
}

fn save(tx: &Transaction<'_>, scope: &CoordinatorScope, attempt: &Attempt) -> Result<(), RpcError> {
    let changed = tx.execute(
        "UPDATE orchestration_attempts SET state_json=?4 WHERE dispatch_id=?1 AND host_id=?2 AND run_id=?3 AND task_id=?5",
        params![attempt.result.dispatch_id,scope.host.host_id,scope.run_id,encode(attempt)?,attempt.result.task_id],
    ).map_err(error::from_sqlite)?;
    if changed != 1 {
        return Err(error::not_found("Attempt does not exist in this run."));
    }
    Ok(())
}

/// A fast report or committed cancellation wins over late launch finalization.
pub(crate) fn finish_launch(
    tx: &Transaction<'_>,
    scope: &CoordinatorScope,
    result: &WorkerStartResult,
) -> Result<Attempt, RpcError> {
    let mut attempt = show(tx, scope, &result.dispatch_id)?;
    if attempt.result.run_id != result.run_id
        || attempt.result.consumer_generation != result.consumer_generation
        || attempt.result.task_id != result.task_id
        || attempt.result.session_identity != result.session_identity
        || attempt.result.workspace_id != result.workspace_id
    {
        return Err(error::invalid_argument("Launch result identity changed."));
    }
    if attempt.result.assignment_state == AssignmentState::Admitting {
        if !matches!(
            result.assignment_state,
            AssignmentState::Ready | AssignmentState::Failed
        ) {
            return Err(error::invalid_argument("Invalid launch completion state."));
        }
        require_current_unfenced(tx, scope, &result.dispatch_id)?;
        attempt.result = result.clone();
        save(tx, scope, &attempt)?;
    }
    Ok(attempt)
}

#[derive(Debug)]
pub(crate) enum Settlement {
    New(Box<Attempt>),
    Duplicate { message_id: String },
}

/// The caller commits the final mailbox message in this same transaction.
pub(crate) fn settle(
    tx: &Transaction<'_>,
    scope: &CoordinatorScope,
    dispatch_id: &str,
    outcome: ReportOutcome,
    message_id: &str,
) -> Result<Settlement, RpcError> {
    require_current_unfenced(tx, scope, dispatch_id)?;
    let mut attempt = show(tx, scope, dispatch_id)?;
    if let Some(prior) = attempt.outcome {
        if prior != outcome {
            return Err(RpcError::new(
                "report_conflict",
                "Attempt already reported a different outcome.",
            ));
        }
        return Ok(Settlement::Duplicate {
            message_id: attempt.report_message_id.ok_or_else(|| {
                error::internal_error("Reported attempt has no message identity.")
            })?,
        });
    }
    if !matches!(
        attempt.result.assignment_state,
        AssignmentState::Admitting | AssignmentState::Ready
    ) && !(attempt.result.assignment_state == AssignmentState::Failed
        && attempt
            .result
            .failure
            .as_ref()
            .is_some_and(|failure| failure.code == "agent_prompt_stalled"))
    {
        return Err(RpcError::new(
            "attempt_settled",
            "Attempt cannot accept a final report.",
        ));
    }
    attempt.outcome = Some(outcome);
    attempt.report_message_id = Some(message_id.into());
    attempt.result.assignment_state = match outcome {
        ReportOutcome::Succeeded => AssignmentState::Completed,
        ReportOutcome::Failed => AssignmentState::Failed,
    };
    attempt.result.readiness =
        drogon_protocol::orchestration_common::ReadinessObservation::WorkerObserved;
    attempt.result.failure = None;
    attempt.result.warning = None;
    save(tx, scope, &attempt)?;
    Ok(Settlement::New(Box::new(attempt)))
}

pub(crate) fn require_current_unfenced(
    tx: &Transaction<'_>,
    scope: &CoordinatorScope,
    dispatch_id: &str,
) -> Result<(), RpcError> {
    let valid: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM orchestration_attempts WHERE dispatch_id=?1 AND host_id=?2 AND run_id=?3 AND is_current=1 AND fenced=0)",
        params![dispatch_id,scope.host.host_id,scope.run_id], |r| r.get(0),
    ).map_err(error::from_sqlite)?;
    if !valid {
        return Err(RpcError::new(
            "attempt_fenced",
            "Attempt authority has been fenced.",
        ));
    }
    Ok(())
}

pub(crate) fn fence(
    tx: &Transaction<'_>,
    scope: &CoordinatorScope,
    dispatch_id: &str,
    state: AssignmentState,
) -> Result<Attempt, RpcError> {
    if !matches!(state, AssignmentState::Stopped | AssignmentState::Abandoned) {
        return Err(error::invalid_argument("Invalid cancellation state."));
    }
    let mut attempt = show(tx, scope, dispatch_id)?;
    if attempt.outcome.is_some() {
        return Err(RpcError::new(
            "attempt_settled",
            "The attempt already has a final report.",
        ));
    }
    if matches!(
        attempt.result.assignment_state,
        AssignmentState::Stopped | AssignmentState::Abandoned
    ) {
        return Ok(attempt);
    }
    require_current_unfenced(tx, scope, dispatch_id)?;
    attempt.result.assignment_state = state;
    tx.execute(
        "UPDATE orchestration_attempts SET fenced=1 WHERE dispatch_id=?1",
        [dispatch_id],
    )
    .map_err(error::from_sqlite)?;
    save(tx, scope, &attempt)?;
    Ok(attempt)
}

#[cfg(test)]
#[path = "coordination_attempts_tests.rs"]
mod tests;
