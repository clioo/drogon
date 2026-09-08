//! Split session admission: [`reserve`] records the pending row in the
//! caller's transaction without touching a process; [`launch_reserved`]
//! verifies the committed reservation, then performs the PTY effect with the
//! same primitives as the ordinary path. Ordinary sessions launch with no
//! worker context and the session environment only (no control-plane
//! inheritance); worker launches layer their service-authored context on top.
//!
//! Cancel/revocation races and ledger ownership are engine integration
//! obligations; this seam does not claim them. A lost handle is never
//! followed by a PID kill.

use std::sync::{Arc, Mutex};

use drogon_protocol::RpcError;
use rusqlite::{Connection, OptionalExtension, Transaction};
use serde_json::Value;

use super::{SessionHandle, finish_spawn, spawn_reader_thread};
use crate::coordination_identity::DispatchCredential;
use crate::error;

#[cfg(test)]
#[path = "session_admission_tests.rs"]
mod session_admission_tests;

/// A launched child: its id, retained handle, and session JSON.
pub(crate) type LaunchedSession = (String, Arc<SessionHandle>, Value);

/// One sessions row as read back for verification: workspace, host,
/// incarnation, command, args JSON, cols, rows, verdict, creation time,
/// launch harness id (additive; part of the checked admission identity).
type AdmissionRow = (
    String,
    String,
    String,
    String,
    String,
    i64,
    i64,
    String,
    String,
    Option<String>,
);

pub(crate) struct PreparedSession {
    session_id: String,
    incarnation: String,
    workspace_id: String,
    host_id: String,
    cwd: String,
    command: String,
    args: Vec<String>,
    harness_id: Option<String>,
    cols: u16,
    rows: u16,
    created_at: String,
}

impl PreparedSession {
    pub(crate) fn session_id(&self) -> &str {
        &self.session_id
    }

    pub(crate) fn incarnation(&self) -> &str {
        &self.incarnation
    }

    #[cfg(test)]
    pub(crate) fn workspace_id(&self) -> &str {
        &self.workspace_id
    }

    #[cfg(test)]
    pub(crate) fn host_id(&self) -> &str {
        &self.host_id
    }
}

impl std::fmt::Debug for PreparedSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PreparedSession")
            .field("session_id", &self.session_id)
            .field("incarnation", &self.incarnation)
            .field("workspace_id", &self.workspace_id)
            .field("host_id", &self.host_id)
            .finish_non_exhaustive()
    }
}

/// Service-authored worker context only: typed values, never client-supplied
/// environment pairs. The credential travels solely into the child's private
/// environment, never into argv, prompts, or stored records.
pub(crate) struct WorkerEnvironment {
    credential: DispatchCredential,
    host_id: String,
    run_id: String,
    task_id: String,
    dispatch_id: String,
    session_id: String,
    incarnation: String,
    data_dir: String,
    cli_command: String,
}

impl WorkerEnvironment {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        credential: DispatchCredential,
        host_id: &str,
        run_id: &str,
        task_id: &str,
        dispatch_id: &str,
        session_id: &str,
        incarnation: &str,
        data_dir: &str,
        cli_command: &str,
    ) -> Result<Self, RpcError> {
        // Opaque-ID bounds mirror `orchestration_scope` shape validation
        // (nonempty, at most 128 bytes, no whitespace or control); the byte
        // length governs, so multibyte text is measured, not counted.
        for (name, value) in [
            ("host_id", host_id),
            ("run_id", run_id),
            ("task_id", task_id),
            ("dispatch_id", dispatch_id),
            ("session_id", session_id),
            ("incarnation", incarnation),
        ] {
            if value.is_empty()
                || value.len() > 128
                || value.contains('\0')
                || value.chars().any(|c| c.is_control() || c.is_whitespace())
            {
                return Err(RpcError::new(
                    "invalid_argument",
                    format!("invalid worker context field: {name}"),
                ));
            }
        }
        for (name, value) in [("data_dir", data_dir), ("cli_command", cli_command)] {
            if value.is_empty()
                || value.contains('\0')
                || !std::path::Path::new(value).is_absolute()
            {
                return Err(RpcError::new(
                    "invalid_argument",
                    format!("worker context path must be absolute: {name}"),
                ));
            }
        }
        Ok(Self {
            credential,
            host_id: host_id.into(),
            run_id: run_id.into(),
            task_id: task_id.into(),
            dispatch_id: dispatch_id.into(),
            session_id: session_id.into(),
            incarnation: incarnation.into(),
            data_dir: data_dir.into(),
            cli_command: cli_command.into(),
        })
    }

    fn agrees_with(&self, plan: &PreparedSession) -> Result<(), RpcError> {
        if self.host_id != plan.host_id
            || self.session_id != plan.session_id
            || self.incarnation != plan.incarnation
        {
            return Err(RpcError::new(
                "invalid_argument",
                "worker context does not match its reservation",
            ));
        }
        Ok(())
    }

    pub(crate) fn apply_to_command(&self, cmd: &mut portable_pty::CommandBuilder) {
        cmd.env(
            "DROGON_DISPATCH_CAPABILITY",
            self.credential.as_secret_str(),
        );
        cmd.env("DROGON_RUN_ID", &self.run_id);
        cmd.env("DROGON_TASK_ID", &self.task_id);
        cmd.env("DROGON_DISPATCH_ID", &self.dispatch_id);
        cmd.env("DROGON_HOST_ID", &self.host_id);
        cmd.env("DROGON_SESSION_ID", &self.session_id);
        cmd.env("DROGON_SESSION_INCARNATION", &self.incarnation);
        cmd.env("DROGON_DATA_DIR", &self.data_dir);
        cmd.env("DROGON_CLI_COMMAND", &self.cli_command);
    }
}

impl std::fmt::Debug for WorkerEnvironment {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkerEnvironment")
            .field("host_id", &self.host_id)
            .field("run_id", &self.run_id)
            .field("task_id", &self.task_id)
            .field("dispatch_id", &self.dispatch_id)
            .field("session_id", &self.session_id)
            .finish_non_exhaustive()
    }
}

/// Records the pending admission in the caller's transaction and returns the
/// launch plan. No process, filesystem, or PTY I/O happens here; rolling the
/// caller's transaction back removes the row.
#[allow(clippy::too_many_arguments)]
pub(crate) fn reserve(
    tx: &Transaction,
    host_id: &str,
    workspace_id: &str,
    cwd: &str,
    command: &str,
    args: &[String],
    harness_id: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<PreparedSession, RpcError> {
    if cwd.contains('\0') || command.contains('\0') || args.iter().any(|arg| arg.contains('\0')) {
        return Err(RpcError::new(
            "invalid_argument",
            "spawn fields must not contain NUL",
        ));
    }
    let plan = PreparedSession {
        session_id: uuid::Uuid::new_v4().to_string(),
        incarnation: uuid::Uuid::new_v4().to_string(),
        workspace_id: workspace_id.into(),
        host_id: host_id.into(),
        cwd: cwd.into(),
        command: command.into(),
        args: args.to_vec(),
        harness_id,
        cols,
        rows,
        created_at: crate::now_rfc3339(),
    };
    tx.execute(
        "INSERT INTO sessions (id, workspace_id, host_id, incarnation, command, args_json, cols, rows, verdict, exit_code, created_at, harness_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', NULL, ?9, ?10)",
        rusqlite::params![
            plan.session_id,
            plan.workspace_id,
            plan.host_id,
            plan.incarnation,
            plan.command,
            serde_json::to_string(&plan.args).unwrap_or_default(),
            plan.cols,
            plan.rows,
            plan.created_at,
            plan.harness_id,
        ],
    )
    .map_err(error::from_sqlite)?;
    Ok(plan)
}

/// Verifies the committed reservation under a short lock, then performs the
/// PTY effect with no DB lock held. A missing, recovered, or altered row is
/// refused before any spawn. The live handle is returned before any
/// fallible post-spawn persistence, which stays the engine's job.
pub(crate) fn launch_reserved(
    db: Arc<Mutex<Connection>>,
    data_dir: &std::path::Path,
    plan: PreparedSession,
    env: Option<WorkerEnvironment>,
) -> Result<LaunchedSession, RpcError> {
    if let Some(context) = &env {
        context.agrees_with(&plan)?;
    }
    {
        let conn = db.lock().unwrap();
        if !conn.is_autocommit() {
            // This connection has an open transaction: a row visible here
            // may be uncommitted, so it proves no durable admission. Spawning
            // against it could orphan a child under a later rollback.
            return Err(error::unverifiable(
                "launch connection is inside a transaction; commit first",
            ));
        }
        verify_committed(&conn, &plan)?;
    }
    match super::spawn_pty(
        data_dir,
        &plan.workspace_id,
        &plan.session_id,
        &plan.cwd,
        &plan.command,
        &plan.args,
        plan.cols,
        plan.rows,
        env.as_ref(),
    ) {
        Ok((master, writer, reader, child)) => {
            let handle = SessionHandle::from_spawned(
                plan.session_id.clone(),
                plan.incarnation.clone(),
                plan.workspace_id.clone(),
                plan.host_id.clone(),
                plan.command.clone(),
                plan.args.clone(),
                plan.harness_id.clone(),
                plan.created_at.clone(),
                plan.cols,
                plan.rows,
                master,
                writer,
                child,
                db.clone(),
            );
            spawn_reader_thread(handle.clone(), reader);
            finish_spawn(&handle, &plan.session_id)
        }
        Err(e) => {
            abandon_pending(&db, &plan.session_id);
            Err(e)
        }
    }
}
/// The reservation must be exactly what was planned and still pending:
/// recovered (`unverifiable`/other) rows never launch, and altered rows are
/// refused rather than spawned with substituted parameters. `created_at` is
/// part of the checked creation identity. The schema stores no `cwd`: the
/// plan's working directory is service-authored in memory at reserve time
/// from the Engine-resolved registered workspace, not durable state, so
/// there is nothing to compare it against here and no migration is implied.
fn verify_committed(conn: &Connection, plan: &PreparedSession) -> Result<(), RpcError> {
    let row: Option<AdmissionRow> = conn
        .query_row(
            "SELECT workspace_id, host_id, incarnation, command, args_json, cols, rows, verdict, created_at, harness_id \
             FROM sessions WHERE id = ?1",
            [&plan.session_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                ))
            },
        )
        .optional()
        .map_err(error::from_sqlite)?;
    let Some((
        workspace_id,
        host_id,
        incarnation,
        command,
        args_json,
        cols,
        rows,
        verdict,
        created_at,
        harness_id,
    )) = row
    else {
        return Err(error::unverifiable(
            "no committed reservation for this launch; it may have rolled back",
        ));
    };
    if verdict != "pending" {
        return Err(error::unverifiable(
            "reservation is no longer pending; recovered admissions never launch",
        ));
    }
    let expected_args = serde_json::to_string(&plan.args).unwrap_or_default();
    if workspace_id != plan.workspace_id
        || host_id != plan.host_id
        || incarnation != plan.incarnation
        || command != plan.command
        || args_json != expected_args
        || cols != i64::from(plan.cols)
        || rows != i64::from(plan.rows)
        || created_at != plan.created_at
        || harness_id != plan.harness_id
    {
        return Err(error::internal_error("reservation does not match its plan"));
    }
    Ok(())
}

/// A spawn failure must not leave a `pending` row for crash recovery to
/// misread as a session that ran.
fn abandon_pending(db: &Mutex<Connection>, session_id: &str) {
    let conn = db.lock().unwrap();
    let _ = conn.execute(
        "UPDATE sessions SET verdict = 'exited', exit_code = NULL WHERE id = ?1 AND verdict = 'pending'",
        [session_id],
    );
}
