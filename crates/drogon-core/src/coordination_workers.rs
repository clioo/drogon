//! Host configuration and exact-session observations for native attempts.

use std::path::Path;
use std::sync::{Arc, Mutex};

use drogon_orchestration::runs;
use drogon_protocol::orchestration_common::ProcessVerdict;
use drogon_protocol::orchestration_run::{DispatchParams, DispatchShowParams, DispatchShowResult};
use drogon_protocol::orchestration_worker::*;
use drogon_protocol::{Request, RpcError};
use serde_json::Value;

use crate::coordination_attempts::{self as attempts, Attempt};
use crate::coordination_runs::{decode, encode};
use crate::{Engine, error, session};

impl Engine {
    /// Trusted host configuration, not an RPC or a worker-supplied executable.
    pub fn with_worker_cli(mut self, path: &Path) -> Result<Self, RpcError> {
        if !path.is_absolute() {
            return Err(error::invalid_argument("Worker CLI path must be absolute."));
        }
        let path = std::fs::canonicalize(path)
            .map_err(|_| error::invalid_argument("Worker CLI is not available."))?;
        let metadata = std::fs::metadata(&path)
            .map_err(|_| error::invalid_argument("Worker CLI is not available."))?;
        if !metadata.is_file() || path.to_str().is_none() {
            return Err(error::invalid_argument(
                "Worker CLI must be a UTF-8 regular file path.",
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o111 == 0 {
                return Err(error::invalid_argument("Worker CLI is not executable."));
            }
        }
        self.worker_cli = Some(path);
        Ok(self)
    }

    pub(crate) fn worker_operation(&self, dispatch_id: &str) -> Arc<Mutex<()>> {
        let mut operations = self.worker_operations.lock().unwrap();
        operations.retain(|_, gate| gate.strong_count() > 0);
        if let Some(gate) = operations
            .get(dispatch_id)
            .and_then(std::sync::Weak::upgrade)
        {
            return gate;
        }
        let gate = Arc::new(Mutex::new(()));
        operations.insert(dispatch_id.into(), Arc::downgrade(&gate));
        gate
    }

    pub(crate) fn dispatch_coordination_worker(
        &self,
        request: &Request,
    ) -> Result<Value, RpcError> {
        match request.method.as_str() {
            "orchestration.dispatchShow" => {
                let params: DispatchShowParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                let snapshot = self.coordination_read(|tx| {
                    runs::require_coordinator(tx, &params.scope)?;
                    let attempt = attempts::current_for_task(tx, &params.scope, &params.task_id)?;
                    Ok(attempt)
                })?;
                let dispatch = snapshot
                    .as_ref()
                    .map(|attempt| {
                        let verdict = self.worker_verdict(attempt).unwrap_or(
                            drogon_protocol::orchestration_common::ProcessVerdict::Unverifiable,
                        );
                        WorkerShowResult {
                            dispatch_id: attempt.result.dispatch_id.clone(),
                            task_id: attempt.result.task_id.clone(),
                            assignment_state: attempt.result.assignment_state,
                            readiness: attempt.result.readiness,
                            process_verdict: verdict,
                            outcome: attempt.outcome,
                            report_result: attempt.report_result.clone(),
                            session_identity: attempt.result.session_identity.clone(),
                            launch: Some(attempt.launch.clone()),
                            residual_resources: attempt.result.residual_resources.clone(),
                            failure: attempt.result.failure.clone(),
                            warning: attempt.result.warning.clone(),
                        }
                    })
                    .inspect(|result| {
                        // Fail closed on malformed derived identity rather
                        // than serving an unverifiable dispatch row.
                        if let Err(err) = result.validate_shape() {
                            debug_assert!(false, "invalid dispatch row: {err}");
                        }
                    });
                // The preamble is regenerated deterministically from the
                // current task spec so a preview matches an actual dispatch.
                let preamble = params.preamble.then(|| {
                    crate::coordination_preamble::build_dispatch_preamble(
                        &params.scope,
                        &params.task_id,
                        snapshot.as_ref().map(|a| a.result.dispatch_id.as_str()),
                    )
                });
                encode(DispatchShowResult { dispatch, preamble })
            }
            "orchestration.dispatch" => {
                let params: DispatchParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                self.dispatch_coordination(request, params)
            }
            "orchestration.workerShow" => {
                let params: WorkerShowParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                let attempt = self.coordination_read(|tx| {
                    runs::require_coordinator(tx, &params.scope)?;
                    attempts::show(tx, &params.scope, &params.dispatch_id)
                })?;
                let verdict = self.worker_verdict(&attempt)?;
                encode(WorkerShowResult {
                    dispatch_id: attempt.result.dispatch_id,
                    task_id: attempt.result.task_id,
                    assignment_state: attempt.result.assignment_state,
                    readiness: attempt.result.readiness,
                    process_verdict: verdict,
                    outcome: attempt.outcome,
                    report_result: attempt.report_result,
                    session_identity: attempt.result.session_identity,
                    launch: Some(attempt.launch),
                    residual_resources: attempt.result.residual_resources,
                    failure: attempt.result.failure,
                    warning: attempt.result.warning,
                })
            }
            "orchestration.workerStart" => {
                let params: WorkerStartParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                self.start_coordination_worker(request, params)
            }
            "orchestration.workerRead" => {
                let params: WorkerReadParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                self.read_coordination_worker(&params)
            }
            "orchestration.workerStop" => {
                let params: WorkerStopParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                self.stop_coordination_worker(request, &params)
            }
            "orchestration.workerAbandon" => {
                let params: WorkerAbandonParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                self.abandon_coordination_worker(request, &params)
            }
            "orchestration.workerRelease" => {
                let params: WorkerReleaseParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                self.release_coordination_worker(request, &params)
            }
            "orchestration.workerRetain" => {
                let params: WorkerRetainParams = decode(&request.params)?;
                params.validate_shape(&self.host_id)?;
                self.retain_coordination_worker(request, &params)
            }
            other => Err(error::method_not_found(other)),
        }
    }

    pub(crate) fn worker_verdict(&self, attempt: &Attempt) -> Result<ProcessVerdict, RpcError> {
        let Some(identity) = &attempt.result.session_identity else {
            return Ok(ProcessVerdict::Unverifiable);
        };
        let handle = self
            .sessions
            .lock()
            .unwrap()
            .get(&identity.session_id)
            .cloned();
        let retained = handle.is_some();
        let value = match handle {
            Some(handle) => {
                session::check_incarnation(&handle, &identity.incarnation)?;
                session::snapshot(&handle)
            }
            None => self.session_row_as_value(&identity.session_id, &identity.incarnation)?,
        };
        if value["hostId"] != self.host_id || value["workspaceId"] != attempt.result.workspace_id {
            return Err(error::unverifiable(
                "Stored attempt session identity does not match.",
            ));
        }
        match value["verdict"].as_str() {
            Some("live") if retained => Ok(ProcessVerdict::Live),
            Some("exited") => Ok(ProcessVerdict::Exited),
            _ => Ok(ProcessVerdict::Unverifiable),
        }
    }
}
