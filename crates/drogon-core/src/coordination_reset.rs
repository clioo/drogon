//! Host-scoped orchestration reset (`orchestration.reset`).
//!
//! Scope mapping (source: `orchestration-reset.ts`, mapped to NATIVE tables):
//! - `all`: runs, run bindings, tasks (+ dependencies), gates, attempts,
//!   mail messages/deliveries/questions (+ read pointers), worker resource
//!   retention — everything in the orchestration domain.
//! - `tasks`: tasks (+ dependencies), gates, attempts, retention, run
//!   bindings; pending question threads are closed, NOT deleted, so surviving
//!   messages keep their correlation (source behavior).
//! - `messages`: mail messages, deliveries, question threads (+ read pointers).
//!
//!   The `requests` ledger is always preserved so a lost reset response stays
//!   replayable under the same request id.
//!
//! Refusal when a live supervised worker is active: the source has no such
//! guard, but deleting durable attempt rows under a live process would orphan
//! it (native worker-stop documentation says stop first). An attempt blocks
//! reset while it is unsettled (`outcome: None`), in `admitting`/`ready`,
//! and its session is observed `live`. The check runs inside the same
//! transaction before any delete, so a refusal mutates nothing.

use drogon_protocol::orchestration_common::{AssignmentState, ProcessVerdict};
use drogon_protocol::orchestration_run::{ResetParams, ResetResult, ResetScope};
use drogon_protocol::{Request, RpcError};
use rusqlite::{Transaction, params};
use serde_json::Value;

use crate::coordination_attempts::Attempt;
use crate::coordination_identity::Actor;
use crate::{Engine, error};

/// Delete host rows from `table`, tolerating a not-yet-migrated table. Every
/// coordination component migrates lazily inside its own mutation, so a reset
/// on a fresh host must not fail on absent tables.
fn delete_host_rows(tx: &Transaction<'_>, table: &str, host_id: &str) -> Result<(), RpcError> {
    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            [table],
            |row| row.get::<_, i64>(0),
        )
        .map_err(error::from_sqlite)?
        != 0;
    if !exists {
        return Ok(());
    }
    let sql = format!("DELETE FROM {table} WHERE host_id = ?1");
    tx.execute(&sql, params![host_id])
        .map_err(error::from_sqlite)?;
    Ok(())
}

fn table_exists(tx: &Transaction<'_>, table: &str) -> Result<bool, RpcError> {
    tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [table],
        |row| row.get::<_, i64>(0),
    )
    .map_err(error::from_sqlite)
    .map(|count: i64| count != 0)
}

impl Engine {
    pub(crate) fn reset_orchestration(&self, request: &Request) -> Result<Value, RpcError> {
        let params: ResetParams = serde_json::from_value(request.params.clone())
            .map_err(|_| error::invalid_argument("Invalid orchestration reset params."))?;
        params.validate_shape(&self.host_id)?;
        // Host-scoped mutation: no coordinator binding. The receipt actor is
        // the host itself so replays stay host-scoped.
        let actor = Actor::AdminBootstrap {
            host_id: self.host_id.clone(),
            coordinator_id: "orchestration-reset".to_string(),
        };
        let scope = params.scope;
        self.coordination_mutation(
            request,
            actor,
            |_| Ok(()),
            |tx| {
                refuse_on_live_worker(self, tx)?;
                match scope {
                    ResetScope::All => reset_all(tx, &self.host_id)?,
                    ResetScope::Tasks => reset_tasks(tx, &self.host_id)?,
                    ResetScope::Messages => reset_messages(tx, &self.host_id)?,
                }
                let scope_name = match scope {
                    ResetScope::All => "all",
                    ResetScope::Tasks => "tasks",
                    ResetScope::Messages => "messages",
                };
                serde_json::to_value(ResetResult {
                    reset: scope_name.to_string(),
                })
                .map_err(|err| error::internal_error(err.to_string()))
            },
        )
    }
}

/// Refuse while any unsettled admitting/ready attempt on this host is
/// observed live. Runs before any delete in the same transaction, so a
/// refusal leaves every row intact.
fn refuse_on_live_worker(engine: &Engine, tx: &Transaction<'_>) -> Result<(), RpcError> {
    if !table_exists(tx, "orchestration_attempts")? {
        return Ok(());
    }
    let mut stmt = tx
        .prepare("SELECT state_json FROM orchestration_attempts WHERE host_id = ?1")
        .map_err(error::from_sqlite)?;
    let rows = stmt
        .query_map(params![engine.host_id], |row| row.get::<_, String>(0))
        .map_err(error::from_sqlite)?;
    for row in rows {
        let state = row.map_err(error::from_sqlite)?;
        let attempt: Attempt = serde_json::from_str(&state)
            .map_err(|_| error::internal_error("Invalid stored attempt."))?;
        let lifecycle_active = matches!(
            attempt.result.assignment_state,
            AssignmentState::Admitting | AssignmentState::Ready
        );
        if attempt.outcome.is_none() && lifecycle_active {
            let verdict = engine.worker_verdict(&attempt)?;
            if verdict == ProcessVerdict::Live {
                return Err(RpcError::new(
                    "worker_active",
                    "Reset refused: a supervised worker attempt is still live on this host; stop it first.",
                ));
            }
        }
    }
    Ok(())
}

/// Retention rows are keyed by dispatch id (no host column); scope them
/// through this host's attempts.
fn delete_host_retention(tx: &Transaction<'_>, host_id: &str) -> Result<(), RpcError> {
    if !table_exists(tx, "worker_resource_retention")? {
        return Ok(());
    }
    if table_exists(tx, "orchestration_attempts")? {
        tx.execute(
            "DELETE FROM worker_resource_retention WHERE dispatch_id IN \
             (SELECT dispatch_id FROM orchestration_attempts WHERE host_id = ?1)",
            params![host_id],
        )
        .map_err(error::from_sqlite)?;
    }
    Ok(())
}

fn delete_host_dependencies(tx: &Transaction<'_>, host_id: &str) -> Result<(), RpcError> {
    if !table_exists(tx, "orchestration_task_dependencies")? {
        return Ok(());
    }
    if table_exists(tx, "orchestration_tasks")? {
        tx.execute(
            "DELETE FROM orchestration_task_dependencies WHERE task_id IN \
             (SELECT task_id FROM orchestration_tasks WHERE host_id = ?1)",
            params![host_id],
        )
        .map_err(error::from_sqlite)?;
    }
    Ok(())
}

fn reset_all(tx: &Transaction<'_>, host_id: &str) -> Result<(), RpcError> {
    // Order matters: retention resolves its host scope through this host's
    // attempts, so it goes before the attempts delete; other dependents go
    // before parents where no cascade exists.
    delete_host_retention(tx, host_id)?;
    delete_host_dependencies(tx, host_id)?;
    delete_host_rows(tx, "orchestration_tasks", host_id)?;
    delete_host_rows(tx, "orchestration_gates", host_id)?;
    delete_host_rows(tx, "orchestration_attempts", host_id)?;
    delete_host_rows(tx, "orchestration_mail_messages", host_id)?;
    delete_host_rows(tx, "orchestration_mail_deliveries", host_id)?;
    delete_host_rows(tx, "orchestration_mail_questions", host_id)?;
    delete_host_rows(tx, "orchestration_mail_read_pointers", host_id)?;
    delete_host_rows(tx, "orchestration_runs", host_id)?;
    delete_host_rows(tx, "orchestration_run_bindings", host_id)?;
    Ok(())
}

fn reset_tasks(tx: &Transaction<'_>, host_id: &str) -> Result<(), RpcError> {
    delete_host_retention(tx, host_id)?;
    delete_host_dependencies(tx, host_id)?;
    delete_host_rows(tx, "orchestration_tasks", host_id)?;
    delete_host_rows(tx, "orchestration_gates", host_id)?;
    delete_host_rows(tx, "orchestration_attempts", host_id)?;
    delete_host_rows(tx, "orchestration_run_bindings", host_id)?;
    // Messages survive: close pending question threads instead of deleting
    // them, preserving correlation for the surviving mail.
    if table_exists(tx, "orchestration_mail_questions")? {
        tx.execute(
            "UPDATE orchestration_mail_questions SET closed = 1 \
             WHERE host_id = ?1 AND closed = 0",
            params![host_id],
        )
        .map_err(error::from_sqlite)?;
    }
    Ok(())
}

fn reset_messages(tx: &Transaction<'_>, host_id: &str) -> Result<(), RpcError> {
    delete_host_rows(tx, "orchestration_mail_messages", host_id)?;
    delete_host_rows(tx, "orchestration_mail_deliveries", host_id)?;
    delete_host_rows(tx, "orchestration_mail_questions", host_id)?;
    delete_host_rows(tx, "orchestration_mail_read_pointers", host_id)?;
    Ok(())
}
