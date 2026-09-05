//! Request-id admission ledger: "concurrent same request → exactly one
//! spawn; changed params → error; pending after crash → never respawn."
//!
//! Two layers cooperate:
//! - a persisted `requests` row (method, params fingerprint, status, result)
//!   so a replay after this *process* restarts still sees a stable outcome;
//! - an in-memory in-flight table so concurrent callers *within this process*
//!   block on the one caller actually doing the work, rather than racing it.
//!
//! The in-flight lock is only ever held to check/insert a map entry or to
//! read a completed slot's result — never across the caller-supplied work
//! closure, which is where PTY spawn/IO/wait blocking happens.

use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex};

use drogon_protocol::RpcError;
use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error;

type ReceiptOutcome = Result<Value, RpcError>;
type PersistedReceipt = (String, ReceiptOutcome);

fn persistence_uncertain() -> RpcError {
    error::unverifiable("the result could not be durably persisted; retry with the same requestId")
}

pub(crate) fn fingerprint(method: &str, params: &Value) -> String {
    let mut hasher = Sha256::new();
    hasher.update(method.as_bytes());
    hasher.update([0u8]);
    // `serde_json::Value::Object` is a `BTreeMap` under this crate's default
    // features (no `preserve_order`), so this serialization is already
    // canonical in key order.
    hasher.update(serde_json::to_vec(params).unwrap_or_default());
    format!("{:x}", hasher.finalize())
}

struct InFlight {
    fingerprint: String,
    slot: Mutex<Option<Result<Value, RpcError>>>,
    ready: Condvar,
}

impl InFlight {
    fn new(fingerprint: String) -> Self {
        Self {
            fingerprint,
            slot: Mutex::new(None),
            ready: Condvar::new(),
        }
    }

    fn wait(&self) -> Result<Value, RpcError> {
        let mut guard = self.slot.lock().unwrap();
        while guard.is_none() {
            guard = self.ready.wait(guard).unwrap();
        }
        guard.clone().unwrap()
    }

    fn complete(&self, result: Result<Value, RpcError>) {
        *self.slot.lock().unwrap() = Some(result);
        self.ready.notify_all();
    }
}

#[derive(Default)]
pub(crate) struct RequestLedger {
    in_flight: Mutex<HashMap<String, Arc<InFlight>>>,
}

enum Admission {
    RunNow,
    WaitFor(Arc<InFlight>),
    Return(Result<Value, RpcError>),
}

impl RequestLedger {
    /// Runs `work` at most once per (requestId, method, params) triple across
    /// the whole process lifetime, including across a service crash for the
    /// *result* (though never across a crash for re-running `work` itself —
    /// see `db::recover_from_prior_instance`).
    pub(crate) fn run(
        &self,
        db: &Mutex<Connection>,
        request_id: &str,
        method: &str,
        params: &Value,
        work: impl FnOnce() -> Result<Value, RpcError>,
    ) -> Result<Value, RpcError> {
        let fp = fingerprint(method, params);
        let admission = {
            let mut in_flight = self.in_flight.lock().unwrap();
            if let Some(existing) = in_flight.get(request_id) {
                if existing.fingerprint == fp {
                    Admission::WaitFor(existing.clone())
                } else {
                    Admission::Return(Err(error::request_conflict()))
                }
            } else {
                match load_persisted(db, request_id) {
                    Ok(Some((db_fp, outcome))) => {
                        if db_fp == fp {
                            Admission::Return(outcome)
                        } else {
                            Admission::Return(Err(error::request_conflict()))
                        }
                    }
                    Ok(None) => match insert_pending(db, request_id, method, &fp) {
                        Ok(()) => {
                            let slot = Arc::new(InFlight::new(fp.clone()));
                            in_flight.insert(request_id.to_string(), slot);
                            Admission::RunNow
                        }
                        // A primary-key conflict here (not a race — the
                        // whole admission decision runs under `in_flight`'s
                        // lock, so two same-process callers can never both
                        // reach this insert for the same requestId) means a
                        // `pending` row already exists with no in-flight
                        // slot behind it: an earlier `RunNow` on this exact
                        // requestId ran `work()` (a real side effect may
                        // have happened) but failed to persist the result.
                        // The only honest answer is `unverifiable` — never
                        // a raw storage error, and never a second `work()`.
                        Err(InsertPendingError::AlreadyAdmitted) => {
                            Admission::Return(Err(error::unverifiable(
                                "a previous attempt for this requestId did not finish persisting its result; \
                                 its side effect (if any) already happened and cannot be repeated",
                            )))
                        }
                        Err(InsertPendingError::Storage(e)) => Admission::Return(Err(e)),
                    },
                    Err(e) => Admission::Return(Err(e)),
                }
            }
        };

        match admission {
            Admission::Return(result) => result,
            Admission::WaitFor(slot) => slot.wait(),
            Admission::RunNow => {
                let result = work();
                let persisted = finish(db, request_id, &result);
                // Why one shared `outcome`: the leader, every concurrent
                // waiter on this exact requestId, and any later replay must
                // all see the *same* answer. A persist failure means the
                // durable record of `result` never landed, so nobody can be
                // told `result` — everybody gets the same honest
                // `unverifiable` instead. The side effect (if any) already
                // happened and is not repeated (see `insert_pending`'s
                // `AlreadyAdmitted` handling above for the replay case).
                let outcome = match persisted {
                    Ok(()) => result,
                    Err(_) => Err(persistence_uncertain()),
                };
                // Retain an uncertain receipt in memory so retries cannot execute it again.
                let slot = if persisted.is_ok() {
                    self.in_flight.lock().unwrap().remove(request_id)
                } else {
                    self.in_flight.lock().unwrap().get(request_id).cloned()
                };
                if let Some(slot) = slot {
                    slot.complete(outcome.clone());
                }
                outcome
            }
        }
    }
}

fn load_persisted(
    db: &Mutex<Connection>,
    request_id: &str,
) -> Result<Option<PersistedReceipt>, RpcError> {
    let conn = db.lock().unwrap();
    let row: Option<(String, String, Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT fingerprint, status, result_json, error_json FROM requests WHERE request_id = ?1",
            [request_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(error::from_sqlite)?;
    let Some((fp, status, result_json, error_json)) = row else {
        return Ok(None);
    };
    if status == "pending" {
        // Live admissions were checked first; retain fingerprint checks for uncertain receipts.
        return Ok(Some((fp, Err(persistence_uncertain()))));
    }
    let outcome = if let Some(result) = result_json {
        Ok(serde_json::from_str(&result).map_err(|e| error::internal_error(e.to_string()))?)
    } else if let Some(err) = error_json {
        Err(serde_json::from_str::<RpcError>(&err)
            .map_err(|e| error::internal_error(e.to_string()))?)
    } else {
        return Err(error::internal_error("corrupt request ledger row"));
    };
    Ok(Some((fp, outcome)))
}

/// Distinguishes "a row for this requestId is already there" (an internal
/// admission-bookkeeping fact, never itself surfaced on the wire) from a
/// genuine storage failure, so the caller cannot mistake one for the other.
enum InsertPendingError {
    AlreadyAdmitted,
    Storage(RpcError),
}

fn insert_pending(
    db: &Mutex<Connection>,
    request_id: &str,
    method: &str,
    fingerprint: &str,
) -> Result<(), InsertPendingError> {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO requests (request_id, method, fingerprint, status, created_at) \
         VALUES (?1, ?2, ?3, 'pending', ?4)",
        rusqlite::params![request_id, method, fingerprint, crate::now_rfc3339()],
    )
    .map(|_| ())
    .map_err(|e| match e {
        rusqlite::Error::SqliteFailure(sqlite_err, _)
            if sqlite_err.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            InsertPendingError::AlreadyAdmitted
        }
        other => InsertPendingError::Storage(error::from_sqlite(other)),
    })
}

fn finish(
    db: &Mutex<Connection>,
    request_id: &str,
    result: &Result<Value, RpcError>,
) -> Result<(), RpcError> {
    let conn = db.lock().unwrap();
    match result {
        Ok(value) => conn.execute(
            "UPDATE requests SET status = 'done', result_json = ?2, error_json = NULL WHERE request_id = ?1",
            rusqlite::params![request_id, value.to_string()],
        ),
        Err(err) => conn.execute(
            "UPDATE requests SET status = 'done', error_json = ?2, result_json = NULL WHERE request_id = ?1",
            rusqlite::params![
                request_id,
                serde_json::to_string(err).unwrap_or_default()
            ],
        ),
    }
    .map(|_| ())
    .map_err(error::from_sqlite)
}
