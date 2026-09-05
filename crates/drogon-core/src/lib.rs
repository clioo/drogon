//! `drogon-core`: the engine behind `drogond`. Implements
//! `docs/migration/protocol-v1.md`'s methods against a single host-owned
//! SQLite database and `portable-pty` sessions. `drogond` owns framing,
//! auth and the transport; this crate never sees a raw socket.

mod db;
mod error;
mod harness;
mod ring;
mod session;
mod workspace;

pub mod requests;

/// The on-disk SQLite filename under a data directory, exposed so
/// integration tests (a separate crate that only sees `pub` items) can open
/// their own connection to the same file for fault injection.
pub use db::DB_FILE_NAME;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use drogon_protocol::{PROTOCOL_VERSION, Request, Response, RpcError};
use requests::RequestLedger;
use rusqlite::{Connection, OptionalExtension};
use serde_json::{Value, json};
use session::SessionHandle;

const CAPABILITIES: &[&str] = &[
    "workspace.v1",
    "session.pty.v1",
    "session.cursor-read.v1",
    "session.incarnation.v1",
    "request.idempotency.v1",
    "harness.catalog.v1",
    "harness.launch.v1",
];

pub(crate) fn now_rfc3339() -> String {
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    humantime_rfc3339(dur.as_secs(), dur.subsec_nanos())
}

/// Minimal UTC RFC3339 formatter so this crate does not need a chrono/time
/// dependency for one timestamp column. Deliberately second-resolution.
fn humantime_rfc3339(secs: u64, _nanos: u32) -> String {
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, mo, d) = civil_from_days(days as i64);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

/// Howard Hinnant's civil-from-days algorithm (public domain), used instead
/// of pulling in a date/time crate for one column's formatting.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub struct Engine {
    #[allow(dead_code)]
    data_dir: PathBuf,
    db: Arc<Mutex<Connection>>,
    host_id: String,
    service_instance_id: String,
    sessions: Mutex<HashMap<String, Arc<SessionHandle>>>,
    ledger: RequestLedger,
}

impl Engine {
    pub fn open(data_dir: &Path) -> Result<Engine, RpcError> {
        fs::create_dir_all(data_dir)
            .map_err(|e| error::io_error(format!("cannot create data dir: {e}")))?;
        // This crate's own precondition, independent of any caller (such as
        // `drogond::serve`) that may additionally guard its own entry path:
        // `Engine::open` is the documented entry point and must not trust a
        // symlinked data directory or silently continue past a permission
        // failure it could not actually apply.
        reject_unsafe_data_dir(data_dir)?;
        // Resolve platform aliases such as macOS /var before SQLite's no-follow open.
        let canonical_data_dir = fs::canonicalize(data_dir)
            .map_err(|e| error::io_error(format!("cannot resolve data dir: {e}")))?;
        let data_dir = canonical_data_dir.as_path();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(data_dir, fs::Permissions::from_mode(0o700)).map_err(|e| {
                error::io_error(format!("cannot restrict data dir permissions: {e}"))
            })?;
        }

        db::validate_files(data_dir)
            .map_err(|e| error::io_error(format!("Unsafe database files: {e}")))?;
        let conn = db::open(data_dir).map_err(error::from_sqlite)?;
        #[cfg(unix)]
        db::harden_permissions(data_dir).map_err(|e| {
            error::io_error(format!("cannot restrict database file permissions: {e}"))
        })?;
        db::recover_from_prior_instance(&conn).map_err(error::from_sqlite)?;
        let host_id = read_or_create_host_id(&conn)?;

        Ok(Engine {
            data_dir: data_dir.to_path_buf(),
            db: Arc::new(Mutex::new(conn)),
            host_id,
            service_instance_id: uuid::Uuid::new_v4().to_string(),
            sessions: Mutex::new(HashMap::new()),
            ledger: RequestLedger::default(),
        })
    }

    pub fn dispatch(&self, request: Request) -> Response {
        if let Err(err) = request.validate() {
            return Response::failure(request.request_id, err);
        }
        let result = self.dispatch_inner(&request);
        match result {
            Ok(value) => Response::success(request.request_id, value),
            Err(err) => Response::failure(request.request_id, err),
        }
    }

    fn dispatch_inner(&self, request: &Request) -> Result<Value, RpcError> {
        match request.method.as_str() {
            "status" => Ok(self.status()),
            "harness.list" => Ok(self.harness_list()),
            "harness.start" => self.mutating(request, Self::do_harness_start),
            "workspace.register" => self.mutating(request, Self::do_workspace_register),
            "workspace.list" => {
                let conn = self.db.lock().unwrap();
                workspace::list(&conn)
            }
            "session.start" => self.mutating(request, Self::do_session_start),
            "session.list" => self.do_session_list(&request.params),
            "session.read" => self.do_session_read(&request.params),
            "session.write" => self.mutating(request, Self::do_session_write),
            "session.resize" => self.mutating(request, Self::do_session_resize),
            "session.stop" => self.mutating(request, Self::do_session_stop),
            other => Err(error::method_not_found(other)),
        }
    }

    fn status(&self) -> Value {
        json!({
            "hostId": self.host_id,
            "serviceInstanceId": self.service_instance_id,
            "protocol": PROTOCOL_VERSION,
            "capabilities": CAPABILITIES,
            "version": env!("CARGO_PKG_VERSION"),
        })
    }

    fn mutating(
        &self,
        request: &Request,
        work: impl FnOnce(&Self, &Value) -> Result<Value, RpcError>,
    ) -> Result<Value, RpcError> {
        let params = request.params.clone();
        self.ledger.run(
            &self.db,
            &request.request_id,
            &request.method,
            &params,
            || work(self, &params),
        )
    }

    fn do_workspace_register(&self, params: &Value) -> Result<Value, RpcError> {
        let path = require_str(params, "path")?;
        let name = optional_str(params, "name")?;
        let conn = self.db.lock().unwrap();
        workspace::register(&conn, &self.host_id, path, name)
    }

    fn do_session_start(&self, params: &Value) -> Result<Value, RpcError> {
        let workspace_id = require_str(params, "workspaceId")?.to_string();
        let command = require_str(params, "command")?.to_string();
        if command.contains('\0') {
            return Err(error::invalid_argument("command must not contain NUL"));
        }
        let args = params
            .get("args")
            .map(|a| {
                let a = a
                    .as_array()
                    .ok_or_else(|| error::invalid_argument("args must be an array"))?;
                a.iter()
                    .map(|v| {
                        v.as_str()
                            .filter(|s| !s.contains('\0'))
                            .map(str::to_string)
                            .ok_or_else(|| error::invalid_argument("args must be NUL-free strings"))
                    })
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()?
            .unwrap_or_default();
        let cols = require_dimension(params, "cols", 80)?;
        let rows = require_dimension(params, "rows", 24)?;

        let cwd = {
            let conn = self.db.lock().unwrap();
            workspace::get_path(&conn, &workspace_id)?
        };

        // `session::spawn` durably records the pending admission before it
        // touches the PTY at all, and reconciles the row's terminal state
        // (`live` vs. an already-observed `exited`) itself — see its doc
        // comment for why that ordering matters.
        let (session_id, handle, session_json) = session::spawn(
            self.db.clone(),
            self.host_id.clone(),
            workspace_id,
            &cwd,
            command,
            args,
            cols,
            rows,
        )?;

        self.sessions
            .lock()
            .unwrap()
            .insert(session_id, handle.clone());
        // Retain ownership even when the post-spawn durable transition fails.
        session::persist_admission(&handle)?;
        Ok(session_json)
    }

    fn do_session_list(&self, params: &Value) -> Result<Value, RpcError> {
        let workspace_filter = optional_str(params, "workspaceId")?;
        let conn = self.db.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT id, workspace_id, host_id, incarnation, command, args_json, cols, rows, verdict, exit_code, created_at FROM sessions ORDER BY created_at",
            )
            .map_err(error::from_sqlite)?;
        let rows: Vec<_> = stmt
            .query_map([], row_to_session_json)
            .map_err(error::from_sqlite)?
            .collect();
        drop(stmt);
        let sessions_guard = self.sessions.lock().unwrap();
        let mut sessions = Vec::new();
        for row in rows {
            let (id, mut value) = row.map_err(error::from_sqlite)?;
            if let Some(handle) = sessions_guard.get(&id) {
                value = session::snapshot(handle);
            }
            if workspace_filter.is_none_or(|w| value["workspaceId"] == w) {
                sessions.push(value);
            }
        }
        Ok(json!({ "sessions": sessions }))
    }

    fn do_session_read(&self, params: &Value) -> Result<Value, RpcError> {
        let (handle, _) = self.require_session_with_incarnation(params)?;
        let cursor = optional_u64(params, "cursor", 0)?;
        let limit = optional_u64(params, "limitBytes", 65_536)?;
        if !(1..=65_536).contains(&limit) {
            return Err(error::invalid_argument("limitBytes must be 1..=65536"));
        }
        session::read(&handle, cursor, limit as usize)
    }

    fn do_session_write(&self, params: &Value) -> Result<Value, RpcError> {
        let (handle, _) = self.require_session_with_incarnation(params)?;
        let data_b64 = require_str(params, "dataBase64")?;
        let bytes = session::base64_decode(data_b64)?;
        let accepted = session::write(&handle, &bytes)?;
        Ok(json!({ "acceptedBytes": accepted }))
    }

    fn do_session_resize(&self, params: &Value) -> Result<Value, RpcError> {
        let (handle, _) = self.require_session_with_incarnation(params)?;
        let cols = require_dimension(params, "cols", 80)?;
        let rows = require_dimension(params, "rows", 24)?;
        session::resize(&handle, cols, rows)
    }

    fn do_session_stop(&self, params: &Value) -> Result<Value, RpcError> {
        let session_id = require_str(params, "sessionId")?.to_string();
        let incarnation = require_str(params, "incarnation")?;
        let handle = self.sessions.lock().unwrap().get(&session_id).cloned();
        let Some(handle) = handle else {
            // No retained handle: either this process never held one
            // (unknown id -> not_found below) or it was swept to
            // `unverifiable` by a prior-instance crash recovery. Either way
            // this process cannot act on it.
            return self.session_row_as_value(&session_id, incarnation);
        };
        session::check_incarnation(&handle, incarnation)?;
        // The handle stays in `self.sessions` even after a confirmed exit:
        // dropping it here would also drop its ring buffer, making
        // `session.read` unable to serve output the session legitimately
        // still retains. The handle's own state (`exit_code`) already makes
        // every subsequent read/write/resize/stop report the true verdict;
        // write/resize additionally refuse to act on an exited session.
        session::stop(&handle)
    }

    fn session_row_as_value(&self, session_id: &str, incarnation: &str) -> Result<Value, RpcError> {
        let conn = self.db.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT id, workspace_id, host_id, incarnation, command, args_json, cols, rows, verdict, exit_code, created_at FROM sessions WHERE id = ?1",
                [session_id],
                row_to_session_json,
            )
            .optional()
            .map_err(error::from_sqlite)?;
        let Some((_, value)) = row else {
            return Err(error::not_found("session not found"));
        };
        if value["incarnation"] != incarnation {
            return Err(error::stale_incarnation());
        }
        Ok(value)
    }

    fn require_session_with_incarnation(
        &self,
        params: &Value,
    ) -> Result<(Arc<SessionHandle>, String), RpcError> {
        let session_id = require_str(params, "sessionId")?.to_string();
        let incarnation = require_str(params, "incarnation")?;
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(&session_id)
            .cloned()
            .ok_or_else(|| {
                error::unverifiable("session has no active handle in this service instance")
            })?;
        session::check_incarnation(&handle, incarnation)?;
        Ok((handle, session_id))
    }
}

fn row_to_session_json(r: &rusqlite::Row) -> rusqlite::Result<(String, Value)> {
    let id: String = r.get(0)?;
    let args_json: String = r.get(5)?;
    let args: Vec<String> = serde_json::from_str(&args_json).unwrap_or_default();
    Ok((
        id.clone(),
        json!({
            "id": id,
            "workspaceId": r.get::<_, String>(1)?,
            "hostId": r.get::<_, String>(2)?,
            "incarnation": r.get::<_, String>(3)?,
            "command": r.get::<_, String>(4)?,
            "args": args,
            "cols": r.get::<_, i64>(6)?,
            "rows": r.get::<_, i64>(7)?,
            "verdict": r.get::<_, String>(8)?,
            "exitCode": r.get::<_, Option<i64>>(9)?,
            "createdAt": r.get::<_, String>(10)?,
        }),
    ))
}

#[cfg(unix)]
fn reject_unsafe_data_dir(data_dir: &Path) -> Result<(), RpcError> {
    let meta = fs::symlink_metadata(data_dir)
        .map_err(|e| error::io_error(format!("cannot inspect data dir: {e}")))?;
    if meta.file_type().is_symlink() {
        return Err(error::invalid_argument(
            "refusing a symlinked data directory",
        ));
    }
    Ok(())
}

#[cfg(not(unix))]
fn reject_unsafe_data_dir(_data_dir: &Path) -> Result<(), RpcError> {
    Ok(())
}

fn read_or_create_host_id(conn: &Connection) -> Result<String, RpcError> {
    let existing: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key = 'host_id'", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(error::from_sqlite)?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('host_id', ?1)",
        [&id],
    )
    .map_err(error::from_sqlite)?;
    Ok(id)
}

fn require_str<'a>(params: &'a Value, field: &str) -> Result<&'a str, RpcError> {
    params
        .get(field)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error::invalid_argument(format!("missing or invalid field: {field}")))
}

/// Only absence selects the default; malformed values must not broaden a request.
fn optional_u64(params: &Value, field: &str, default: u64) -> Result<u64, RpcError> {
    match params.get(field) {
        None => Ok(default),
        Some(value) => value.as_u64().ok_or_else(|| {
            error::invalid_argument(format!("{field} must be a non-negative integer"))
        }),
    }
}

/// Same present-but-invalid-is-an-error rule as `optional_u64`, for a
/// filter field: a caller who mistypes `workspaceId`'s type must see an
/// error, never a silently unfiltered (broader) result set.
fn optional_str<'a>(params: &'a Value, field: &str) -> Result<Option<&'a str>, RpcError> {
    match params.get(field) {
        None => Ok(None),
        Some(value) => value
            .as_str()
            .filter(|value| !value.is_empty())
            .map(Some)
            .ok_or_else(|| error::invalid_argument(format!("{field} must be a string"))),
    }
}

fn require_dimension(params: &Value, field: &str, default: u16) -> Result<u16, RpcError> {
    let Some(value) = params.get(field) else {
        return Ok(default);
    };
    let n = value
        .as_u64()
        .ok_or_else(|| error::invalid_argument(format!("{field} must be a positive integer")))?;
    if !(1..=1000).contains(&n) {
        return Err(error::invalid_argument(format!("{field} must be 1..=1000")));
    }
    Ok(n as u16)
}
