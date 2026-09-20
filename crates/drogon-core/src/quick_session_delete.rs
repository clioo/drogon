use std::path::Path;

use crate::Engine;
use drogon_protocol::RpcError;

impl Engine {
    /// Called under the workspace admission write gate, before removing either
    /// registration or files. A stale daemon record is not evidence of exit.
    ///
    /// The scope is containment, not one exact path: the directory about to
    /// go takes every Workspace registered inside it with it. Matching the
    /// scratch path alone let a session in a registered subdirectory keep
    /// running while its files were deleted — the same orphan #621 is about,
    /// reached through `project.remove` (and through `worktree.remove` on a
    /// Chat's implicit card, which delegates here).
    pub(crate) fn settle_quick_session_members(&self, path: &str) -> Result<(), RpcError> {
        let scope = self.deletion_scope_for(Path::new(path))?;
        self.settle_workspace_sessions(&scope)?;
        // Then the one rule: whatever is still unsettled refuses the delete,
        // so the files stay while a process that may hold them is unaccounted
        // for. `forced` is true because this path has already stopped
        // everything it can — there is no second, stronger attempt to offer.
        match self.workspace_session_evidence(&scope)?.refusal(true) {
            Some(refusal) => Err(refusal),
            None => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        sync::{Arc, mpsc},
        time::Duration,
    };

    /// Every route that can put a live PTY in a workspace: `session.start`,
    /// `harness.start`, and an orchestration dispatch. The third one is the
    /// one the adversarial pass on #621 caught spawning under the shutdown
    /// gate alone, which would have let a worker launch into a checkout a
    /// delete had already settled and was about to unlink.
    #[test]
    fn every_session_admission_route_waits_for_chat_deletion() {
        let data = tempfile::tempdir().unwrap();
        let engine = Arc::new(Engine::open(data.path()).unwrap());
        for route in ["session", "harness", "dispatch"] {
            let gate = engine.workspace_lifecycle_gate.write().unwrap();
            let worker = engine.clone();
            let host_id = engine.host_id.clone();
            let (ready_tx, ready_rx) = mpsc::channel();
            let (done_tx, done_rx) = mpsc::channel();
            let thread = std::thread::spawn(move || {
                ready_tx.send(()).unwrap();
                // Parameters that cannot launch anything: a route must take
                // admission before it decides the call is doomed, or the
                // gate is no barrier at all. The dispatch route needs a
                // well-shaped request (its shape check runs before the
                // handler) and fails on the unknown run behind the gate.
                let result = match route {
                    "harness" => worker.do_harness_start(&json!({})),
                    "session" => worker.do_session_start(&json!({})),
                    _ => {
                        let request: crate::Request = serde_json::from_value(json!({
                            "protocol": drogon_protocol::PROTOCOL_VERSION,
                            "requestId": "gate-probe",
                            "method": "orchestration.workerStart",
                            "params": {
                                "contractVersion": 1,
                                "hostId": host_id,
                                "runId": "run_gate_probe",
                                "coordinatorId": "coord_gate_probe",
                                "consumerGeneration": 1,
                                "taskId": "task_gate_probe",
                                "workspaceId": "ws_gate_probe",
                                "mode": "fresh",
                                "launch": {
                                    "harnessId": "claude",
                                    "model": "fixture-model",
                                    "permissionMode": "unattended"
                                }
                            }
                        }))
                        .unwrap();
                        let reply = worker.dispatch(request);
                        reply.result.ok_or_else(|| reply.error.unwrap())
                    }
                };
                done_tx.send(result).unwrap();
            });
            ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            assert!(
                matches!(
                    done_rx.recv_timeout(Duration::from_millis(100)),
                    Err(mpsc::RecvTimeoutError::Timeout)
                ),
                "the {route} route started without waiting for workspace admission"
            );
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
