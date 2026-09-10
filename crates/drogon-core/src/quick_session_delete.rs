use crate::{Engine, error, session};
use drogon_protocol::RpcError;
use serde_json::json;

impl Engine {
    /// Called under the workspace admission write gate, before removing either
    /// registration or files. A stale daemon record is not evidence of exit.
    pub(crate) fn settle_quick_session_members(&self, path: &str) -> Result<(), RpcError> {
        let members = {
            let conn = self.db.lock().unwrap();
            let mut statement = conn.prepare(
                "SELECT s.id, s.incarnation FROM sessions s JOIN workspaces w ON w.id = s.workspace_id
                 WHERE w.path = ?1 AND s.verdict != 'exited' ORDER BY s.id"
            ).map_err(error::from_sqlite)?;
            let rows = statement
                .query_map([path], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(error::from_sqlite)?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(error::from_sqlite)?
        };
        // Refuse unknown ownership before stopping any known member.
        {
            let handles = self.sessions.lock().unwrap();
            for (id, incarnation) in &members {
                let handle = handles.get(id).ok_or_else(|| RpcError::new(
                    "session_unverifiable", "Cannot delete this Chat while a session's exit is unverifiable. Reconnect to its owning service first."
                ))?;
                session::check_incarnation(handle, incarnation)?;
            }
        }
        for (id, incarnation) in members {
            let stopped =
                self.do_session_stop(&json!({"sessionId": id, "incarnation": incarnation}))?;
            if stopped["verdict"] != "exited" {
                return Err(RpcError::new(
                    "session_unverifiable",
                    "Chat session exit was not confirmed; its files have not been deleted.",
                ));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{Arc, mpsc},
        time::Duration,
    };

    #[test]
    fn both_session_admission_routes_wait_for_chat_deletion() {
        let data = tempfile::tempdir().unwrap();
        let engine = Arc::new(Engine::open(data.path()).unwrap());
        for harness in [false, true] {
            let gate = engine.workspace_lifecycle_gate.write().unwrap();
            let worker = engine.clone();
            let (ready_tx, ready_rx) = mpsc::channel();
            let (done_tx, done_rx) = mpsc::channel();
            let thread = std::thread::spawn(move || {
                ready_tx.send(()).unwrap();
                // Invalid parameters avoid any provider/process launch; both
                // real entrypoints must acquire admission before validation.
                let result = if harness {
                    worker.do_harness_start(&json!({}))
                } else {
                    worker.do_session_start(&json!({}))
                };
                done_tx.send(result).unwrap();
            });
            ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            assert!(matches!(
                done_rx.recv_timeout(Duration::from_millis(100)),
                Err(mpsc::RecvTimeoutError::Timeout)
            ));
            drop(gate);
            assert!(
                done_rx
                    .recv_timeout(Duration::from_secs(5))
                    .unwrap()
                    .is_err()
            );
            thread.join().unwrap();
        }
    }
}
