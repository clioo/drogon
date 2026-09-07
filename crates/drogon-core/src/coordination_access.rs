//! Persisted dispatch credentials and transaction-scoped identity verification.

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::Value;
use sha2::{Digest, Sha256};

use drogon_protocol::RpcError;
use drogon_protocol::orchestration_common::ActorScope;
use drogon_protocol::orchestration_question::ReceiptScope;

#[cfg(test)]
#[path = "coordination_access_tests.rs"]
mod coordination_access_tests;

pub(crate) const SCHEMA_COMPONENT: &str = "coordination_access";
pub(crate) const SCHEMA_VERSION: i64 = 1;

const ALLOWED_WORKER_METHODS: &[&str] = &[
    "status",
    "orchestration.send",
    "orchestration.check",
    "orchestration.ask",
    "orchestration.reply",
    "orchestration.requestShow",
];

const SCOPED_WORKER_METHODS: &[&str] = &[
    "orchestration.send",
    "orchestration.check",
    "orchestration.ask",
    "orchestration.reply",
    "orchestration.requestShow",
];

pub(crate) fn unauthorized() -> RpcError {
    RpcError::new(
        "unauthorized",
        "invalid or unauthorized dispatch credential",
    )
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct WorkerBinding {
    digest: String,
    pub(crate) host_id: String,
    pub(crate) run_id: String,
    pub(crate) task_id: String,
    pub(crate) dispatch_id: String,
    pub(crate) session_id: String,
    pub(crate) incarnation: String,
    pub(crate) revoked: bool,
}

impl std::fmt::Debug for WorkerBinding {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkerBinding")
            .field("dispatch_id", &self.dispatch_id)
            .field("revoked", &self.revoked)
            .finish_non_exhaustive()
    }
}

fn digest_presented_secret(secret: &str) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let bytes = Sha256::digest(secret.as_bytes());
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    out
}

fn create_v1_table(tx: &Connection) -> rusqlite::Result<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS orchestration_dispatch_credentials (
            digest TEXT PRIMARY KEY,
            host_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            dispatch_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            incarnation TEXT NOT NULL,
            revoked INTEGER NOT NULL DEFAULT 0,
            revocation_reason TEXT,
            created_at TEXT NOT NULL,
            UNIQUE (host_id, run_id, task_id, dispatch_id, session_id, incarnation)
        );
        CREATE INDEX IF NOT EXISTS orchestration_dispatch_credentials_dispatch_id
            ON orchestration_dispatch_credentials(dispatch_id);",
    )
}

fn check_schema_not_ahead(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_versions (
            component TEXT PRIMARY KEY,
            version INTEGER NOT NULL
        );",
    )?;
    let existing: Option<i64> = conn
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(found) = existing
        && found > SCHEMA_VERSION
    {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_SCHEMA),
            Some(format!(
                "coordination_access schema version {found} is newer than supported {SCHEMA_VERSION}"
            )),
        ));
    }
    Ok(())
}

pub(crate) fn apply_pending_steps_in_tx(tx: &Transaction) -> rusqlite::Result<()> {
    check_schema_not_ahead(tx)?;
    let existing: Option<i64> = tx
        .query_row(
            "SELECT version FROM schema_versions WHERE component = ?1",
            params![SCHEMA_COMPONENT],
            |r| r.get(0),
        )
        .optional()?;
    let mut from_version = existing.unwrap_or(0);
    while from_version < SCHEMA_VERSION {
        let next_version = from_version + 1;
        match next_version {
            1 => create_v1_table(tx)?,
            _ => unreachable!("no migration step defined for version {next_version}"),
        }
        tx.execute(
            "INSERT INTO schema_versions(component, version) VALUES (?1, ?2)
             ON CONFLICT(component) DO UPDATE SET version = excluded.version",
            params![SCHEMA_COMPONENT, next_version],
        )?;
        from_version = next_version;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn register_in_tx(
    tx: &Transaction,
    digest: &str,
    host_id: &str,
    run_id: &str,
    task_id: &str,
    dispatch_id: &str,
    session_id: &str,
    incarnation: &str,
    created_at: &str,
) -> Result<(), RpcError> {
    tx.execute(
        "INSERT INTO orchestration_dispatch_credentials
            (digest, host_id, run_id, task_id, dispatch_id, session_id, incarnation, revoked, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)",
        params![
            digest, host_id, run_id, task_id, dispatch_id, session_id, incarnation, created_at
        ],
    )
    .map_err(crate::error::from_sqlite)?;
    Ok(())
}

pub(crate) fn revoke_in_tx(
    tx: &Transaction,
    dispatch_id: &str,
    reason: &str,
) -> Result<(), RpcError> {
    let updated = tx
        .execute(
            "UPDATE orchestration_dispatch_credentials
                SET revoked = 1, revocation_reason = ?2
              WHERE dispatch_id = ?1 AND revoked = 0",
            params![dispatch_id, reason],
        )
        .map_err(crate::error::from_sqlite)?;
    if updated == 0 {
        return Ok(());
    }
    Ok(())
}

fn row_to_binding(row: &rusqlite::Row) -> rusqlite::Result<WorkerBinding> {
    Ok(WorkerBinding {
        digest: row.get(7)?,
        host_id: row.get(0)?,
        run_id: row.get(1)?,
        task_id: row.get(2)?,
        dispatch_id: row.get(3)?,
        session_id: row.get(4)?,
        incarnation: row.get(5)?,
        revoked: row.get::<_, i64>(6)? != 0,
    })
}

fn lookup_by_digest(conn: &Connection, digest: &str) -> Result<Option<WorkerBinding>, RpcError> {
    conn.query_row(
        "SELECT host_id, run_id, task_id, dispatch_id, session_id, incarnation, revoked, digest
           FROM orchestration_dispatch_credentials WHERE digest = ?1",
        params![digest],
        row_to_binding,
    )
    .optional()
    .map_err(crate::error::from_sqlite)
}

pub(crate) fn is_allowed_worker_method(method: &str) -> bool {
    ALLOWED_WORKER_METHODS.contains(&method)
}

pub(crate) fn authorize_worker(
    conn: &Connection,
    execution_host_id: &str,
    presented_secret: &str,
    method: &str,
    params: &Value,
) -> Result<WorkerBinding, RpcError> {
    if presented_secret.is_empty() {
        return Err(unauthorized());
    }
    let digest = digest_presented_secret(presented_secret);
    let binding = lookup_by_digest(conn, &digest)?.ok_or_else(unauthorized)?;
    if binding.revoked {
        return Err(unauthorized());
    }
    if binding.host_id != execution_host_id {
        return Err(unauthorized());
    }
    if !is_allowed_worker_method(method) {
        return Err(unauthorized());
    }
    if SCOPED_WORKER_METHODS.contains(&method) {
        check_scope_matches(&binding, execution_host_id, method, params)?;
    }
    Ok(binding)
}

fn check_scope_matches(
    binding: &WorkerBinding,
    execution_host_id: &str,
    method: &str,
    params: &Value,
) -> Result<(), RpcError> {
    let Some(scope_value) = params.get("scope") else {
        return Err(unauthorized());
    };
    let (run_id, task_id, dispatch_id) = if method == "orchestration.requestShow" {
        let scope: ReceiptScope =
            serde_json::from_value(scope_value.clone()).map_err(|_| unauthorized())?;
        scope
            .validate_shape(execution_host_id)
            .map_err(|_| unauthorized())?;
        match scope {
            ReceiptScope::Dispatch(dispatch) => {
                (dispatch.run_id, dispatch.task_id, dispatch.dispatch_id)
            }
            ReceiptScope::Bootstrap(_) | ReceiptScope::Coordinator(_) => {
                return Err(unauthorized());
            }
        }
    } else {
        let scope: ActorScope =
            serde_json::from_value(scope_value.clone()).map_err(|_| unauthorized())?;
        scope
            .validate_shape(execution_host_id)
            .map_err(|_| unauthorized())?;
        match scope {
            ActorScope::Dispatch(dispatch) => {
                (dispatch.run_id, dispatch.task_id, dispatch.dispatch_id)
            }
            ActorScope::Coordinator(_) => return Err(unauthorized()),
        }
    };
    if run_id != binding.run_id || task_id != binding.task_id || dispatch_id != binding.dispatch_id
    {
        return Err(unauthorized());
    }
    Ok(())
}

pub(crate) fn recheck_in_tx(
    tx: &Transaction,
    expected: &WorkerBinding,
) -> Result<WorkerBinding, RpcError> {
    let binding = lookup_by_digest(tx, &expected.digest)?.ok_or_else(unauthorized)?;
    if binding.revoked || binding != *expected {
        return Err(unauthorized());
    }
    Ok(binding)
}
