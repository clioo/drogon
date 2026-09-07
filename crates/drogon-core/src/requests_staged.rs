//! Commit attempt/session/credential admission before an external effect;
//! retain uncertain receipts without ever repeating that effect.

use super::*;

#[cfg(test)]
#[path = "requests_staged_tests.rs"]
mod tests;

enum StagedAdmission<P> {
    Execute(P, Arc<InFlight>),
    Wait(Arc<InFlight>),
    Return(ReceiptOutcome),
}

impl RequestLedger {
    /// `prepare` and `finalize` are DB-only callbacks in the caller's transaction.
    /// `effect` runs with neither ledger nor database mutex held. The caller owns
    /// lifecycle admission and exact-resource cancellation fences across phases.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn run_staged<P>(
        &self,
        db: &Mutex<Connection>,
        key: &str,
        method: &str,
        params: &Value,
        authorize: impl FnOnce(&Transaction<'_>) -> Result<(), RpcError>,
        prepare: impl FnOnce(&Transaction<'_>) -> Result<P, RpcError>,
        effect: impl FnOnce(P) -> ReceiptOutcome,
        finalize: impl FnOnce(&Transaction<'_>, &ReceiptOutcome) -> Result<(), RpcError>,
    ) -> ReceiptOutcome {
        let fp = fingerprint(method, params);
        let admission = {
            // Preserve the legacy lock order, but authorize before inspecting its map.
            let mut in_flight = self.in_flight.lock().unwrap();
            let mut conn = db.lock().unwrap();
            let tx = conn
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(error::from_sqlite)?;
            authorize(&tx)?;
            if let Some(slot) = in_flight.get(key) {
                if slot.fingerprint != fp {
                    StagedAdmission::Return(Err(error::request_conflict()))
                } else {
                    StagedAdmission::Wait(slot.clone())
                }
            } else {
                let row: Option<(String, String, Option<String>, Option<String>)> = tx.query_row(
                    "SELECT fingerprint, status, result_json, error_json FROM requests WHERE request_id = ?1",
                    [key], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                ).optional().map_err(error::from_sqlite)?;
                if let Some((saved_fp, status, result, failure)) = row {
                    StagedAdmission::Return(if saved_fp != fp {
                        Err(error::request_conflict())
                    } else {
                        decode_receipt(saved_fp, &status, result, failure)?.1
                    })
                } else {
                    tx.execute_batch("SAVEPOINT staged_admission")
                        .map_err(error::from_sqlite)?;
                    match prepare(&tx) {
                        Ok(plan) => {
                            tx.execute_batch("RELEASE staged_admission")
                                .map_err(error::from_sqlite)?;
                            tx.execute(
                                "INSERT INTO requests (request_id, method, fingerprint, status, created_at) VALUES (?1, ?2, ?3, 'pending', ?4)",
                                rusqlite::params![key, method, fp, crate::now_rfc3339()],
                            ).map_err(error::from_sqlite)?;
                            tx.commit().map_err(|_| persistence_uncertain())?;
                            let slot = Arc::new(InFlight::new(fp.clone()));
                            in_flight.insert(key.to_owned(), slot.clone());
                            StagedAdmission::Execute(plan, slot)
                        }
                        Err(reason) => {
                            tx.execute_batch(
                                "ROLLBACK TO staged_admission; RELEASE staged_admission",
                            )
                            .map_err(|_| persistence_uncertain())?;
                            insert_done_receipt(&tx, key, method, &fp, &Err(reason.clone()))
                                .map_err(|_| persistence_uncertain())?;
                            tx.commit().map_err(|_| persistence_uncertain())?;
                            StagedAdmission::Return(Err(reason))
                        }
                    }
                }
            }
        };
        match admission {
            StagedAdmission::Return(result) => result,
            StagedAdmission::Wait(slot) => slot.wait(),
            StagedAdmission::Execute(plan, slot) => {
                // A panic may follow a real effect; it must not strand joiners or permit replay.
                let result =
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| effect(plan)))
                        .unwrap_or_else(|_| Err(persistence_uncertain()));
                let saved = staged_finish(db, key, method, &fp, &result, finalize);
                let outcome = if saved.is_ok() {
                    result
                } else {
                    Err(persistence_uncertain())
                };
                slot.complete(outcome.clone());
                if saved.is_ok() {
                    self.in_flight.lock().unwrap().remove(key);
                }
                outcome
            }
        }
    }
}

fn staged_finish(
    db: &Mutex<Connection>,
    key: &str,
    method: &str,
    fp: &str,
    result: &ReceiptOutcome,
    finalize: impl FnOnce(&Transaction<'_>, &ReceiptOutcome) -> Result<(), RpcError>,
) -> Result<(), RpcError> {
    let mut conn = db.lock().unwrap();
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error::from_sqlite)?;
    finalize(&tx, result)?;
    let (value, failure) = match result {
        Ok(value) => (Some(value.to_string()), None),
        Err(reason) => (
            None,
            Some(serde_json::to_string(reason).map_err(|_| persistence_uncertain())?),
        ),
    };
    let changed = tx.execute(
        "UPDATE requests SET status = 'done', result_json = ?4, error_json = ?5 WHERE request_id = ?1 AND method = ?2 AND fingerprint = ?3 AND status = 'pending'",
        rusqlite::params![key, method, fp, value, failure],
    ).map_err(error::from_sqlite)?;
    if changed != 1 {
        return Err(persistence_uncertain());
    }
    tx.commit().map_err(|_| persistence_uncertain())
}
