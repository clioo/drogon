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
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error;

#[cfg(test)]
#[path = "requests_atomic_tests.rs"]
mod requests_atomic_tests;

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

    /// DATABASE-only atomic path for coordination state. Unlike [`RequestLedger::run`]
    /// (built for external effects whose side effects cannot be rolled back), this
    /// commits domain writes and the success receipt in one `BEGIN IMMEDIATE`
    /// transaction: a domain write never survives when its receipt cannot commit.
    ///
    /// `internal_request_key` is already actor-scoped by the engine caller; no
    /// authority is derived from it. `authorize` runs inside the transaction
    /// BEFORE the saved-receipt lookup, on replay too, so a denied caller
    /// sees its denial even when the fingerprint also changed. Both callbacks
    /// are DB-only: they must not re-acquire the `db` mutex, do external I/O,
    /// or issue transaction control. This path never touches the in-flight
    /// map: one SQLite file with `BEGIN IMMEDIATE` already serializes
    /// same-key admissions, and a legacy external admission's deliberately
    /// retained slot must never be waited on.
    pub(crate) fn run_atomic(
        &self,
        db: &Mutex<Connection>,
        internal_request_key: &str,
        method: &str,
        params: &Value,
        authorize: impl FnOnce(&Transaction<'_>) -> Result<(), RpcError>,
        work: impl FnOnce(&Transaction<'_>) -> Result<Value, RpcError>,
    ) -> Result<Value, RpcError> {
        let fp = fingerprint(method, params);
        run_atomic_inner(db, internal_request_key, method, &fp, authorize, work)
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
    decode_receipt(fp, &status, result_json, error_json).map(Some)
}

// Preserve legacy receipt decoding; pending admissions never authorize another execution.
fn decode_receipt(
    fingerprint: String,
    status: &str,
    result_json: Option<String>,
    error_json: Option<String>,
) -> Result<PersistedReceipt, RpcError> {
    if status == "pending" {
        // Live admissions were checked first; retain fingerprint checks for uncertain receipts.
        return Ok((fingerprint, Err(persistence_uncertain())));
    }
    let outcome = if let Some(result) = result_json {
        Ok(serde_json::from_str(&result).map_err(|e| error::internal_error(e.to_string()))?)
    } else if let Some(err) = error_json {
        Err(serde_json::from_str::<RpcError>(&err)
            .map_err(|e| error::internal_error(e.to_string()))?)
    } else {
        return Err(error::internal_error("corrupt request ledger row"));
    };
    Ok((fingerprint, outcome))
}

/// Distinguishes "a row for this requestId is already there" (an internal
/// admission-bookkeeping fact, never itself surfaced on the wire) from a
/// genuine storage failure, so the caller cannot mistake one for the other.
enum InsertPendingError {
    AlreadyAdmitted,
    Storage(RpcError),
}

/// Atomic-path worker: every early return drops the transaction, rolling
/// back whatever it holds. Only a successful `commit` publishes anything.
fn run_atomic_inner(
    db: &Mutex<Connection>,
    key: &str,
    method: &str,
    fp: &str,
    authorize: impl FnOnce(&Transaction<'_>) -> Result<(), RpcError>,
    work: impl FnOnce(&Transaction<'_>) -> Result<Value, RpcError>,
) -> Result<Value, RpcError> {
    let conn = db.lock().unwrap();
    let tx = match Transaction::new_unchecked(&conn, TransactionBehavior::Immediate) {
        Ok(tx) => tx,
        Err(e) => return Err(error::from_sqlite(e)),
    };
    // Authorization runs before the saved-receipt lookup, on replay too.
    authorize(&tx)?;
    let row: Option<(String, String, Option<String>, Option<String>)> = match tx
        .query_row(
            "SELECT fingerprint, status, result_json, error_json FROM requests WHERE request_id = ?1",
            [key],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
    {
        Ok(row) => row,
        Err(e) => return Err(error::from_sqlite(e)),
    };
    if let Some((db_fp, status, result_json, error_json)) = row {
        // Saved receipt, or a legacy external-effect admission (`pending`):
        // replay or report uncertainty, never re-run. A fingerprint mismatch
        // is a conflict either way.
        if db_fp != fp {
            return Err(error::request_conflict());
        }
        return match decode_receipt(db_fp, &status, result_json, error_json) {
            Ok((_, outcome)) => outcome,
            Err(e) => Err(e),
        };
    }
    // Fresh admission: work runs in a savepoint so only domain changes roll
    // back, then the receipt lands in the same transaction and one commit
    // publishes both together.
    if tx.execute_batch("SAVEPOINT atomic_work").is_err() {
        return Err(persistence_uncertain());
    }
    match work(&tx) {
        Ok(value) => {
            if tx.execute_batch("RELEASE atomic_work").is_err()
                || insert_done_receipt(&tx, key, method, fp, &Ok(value.clone())).is_err()
            {
                return Err(persistence_uncertain());
            }
            match tx.commit() {
                Ok(()) => Ok(value),
                // Commit result unknown: never report success, never claim
                // the domain write is gone.
                Err(_) => Err(persistence_uncertain()),
            }
        }
        Err(work_err) => {
            // A failed savepoint rollback poisons the transaction: publish
            // nothing and let the outer transaction roll back on drop.
            if tx.execute_batch("ROLLBACK TO atomic_work").is_err()
                || tx.execute_batch("RELEASE atomic_work").is_err()
            {
                return Err(persistence_uncertain());
            }
            if insert_done_receipt(&tx, key, method, fp, &Err(work_err.clone())).is_err() {
                return Err(persistence_uncertain());
            }
            match tx.commit() {
                Ok(()) => Err(work_err),
                Err(_) => Err(persistence_uncertain()),
            }
        }
    }
}

fn insert_done_receipt(
    tx: &Transaction,
    key: &str,
    method: &str,
    fingerprint: &str,
    result: &ReceiptOutcome,
) -> rusqlite::Result<()> {
    let (result_json, error_json): (Option<String>, Option<String>) = match result {
        Ok(value) => (Some(value.to_string()), None),
        Err(err) => (None, Some(serde_json::to_string(err).unwrap_or_default())),
    };
    tx.execute(
        "INSERT INTO requests (request_id, method, fingerprint, status, result_json, error_json, created_at) \
         VALUES (?1, ?2, ?3, 'done', ?4, ?5, ?6)",
        rusqlite::params![
            key,
            method,
            fingerprint,
            result_json,
            error_json,
            crate::now_rfc3339()
        ],
    )?;
    Ok(())
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
