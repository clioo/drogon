//! Native launch admission commits before the owned PTY effect.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use drogon_harness::{HarnessLaunchPlan, HarnessLaunchRequest};
use drogon_orchestration::{runs, tasks};
use drogon_protocol::orchestration_common::*;
use drogon_protocol::orchestration_task::{TaskShowParams, TaskStatus};
use drogon_protocol::orchestration_worker::{
    WorkerExecution, WorkerStartParams, WorkerStartResult,
};
use drogon_protocol::{Request, RpcError};
use rusqlite::{OptionalExtension, Transaction};
use serde_json::Value;

use crate::coordination_attempts::{self as attempts, Attempt};
use crate::coordination_identity::DispatchCredential;
use crate::coordination_runs::{coordinator_actor, decode, encode};
use crate::session::session_admission::{self, PreparedSession, WorkerEnvironment};
use crate::{Engine, coordination_access, error, harness, session, worker_brief};

struct PreparedWorker {
    attempt: Attempt,
    session: PreparedSession,
    environment: WorkerEnvironment,
    pi_extension: Option<PathBuf>,
    cli: String,
}

struct LaunchPlan {
    harness: HarnessLaunchPlan,
    cli: String,
    preferences: LaunchPreferences,
    pi_extension: Option<PathBuf>,
}

/// Converts a policy runtime into the launch vocabulary. New policy files use
/// the explicit provider field; the `provider/model` spelling remains a
/// compatibility bridge for graph files written before that field existed.
fn policy_provider_model(
    runtime: &drogon_protocol::graph::GraphRuntimeRef,
) -> (Option<String>, Option<String>) {
    if let Some(provider) = &runtime.provider {
        return (
            Some(provider.clone()),
            (!runtime.model.is_empty()).then(|| runtime.model.clone()),
        );
    }
    if runtime.harness == "pi"
        && let Some((provider, model)) = runtime.model.split_once('/')
        && !provider.is_empty()
        && !model.is_empty()
    {
        return (Some(provider.to_string()), Some(model.to_string()));
    }
    (
        None,
        (!runtime.model.is_empty()).then(|| runtime.model.clone()),
    )
}

/// Binds a hand-named harness to the workspace's own Subagent policy.
///
/// `worker-start --harness X` with no `--model` used to launch whatever that
/// harness picks for itself. On a host with several authenticated providers
/// that is a paid model chosen silently, while the workspace policy pinned a
/// free one — the exact case a delegating agent caught in its own dispatch
/// ("worker-start with --harness pi but no explicit --provider/--model let
/// the child session self-select openai-codex/gpt-5.6-sol"). A configured
/// policy is the owner's spending decision, so an unspecified model is
/// filled from it, and a harness the policy never approved is refused
/// instead of guessed. An explicitly named model stays the caller's own
/// recorded choice; this closes the silent path, not the deliberate one.
fn pin_fresh_launch_to_policy(
    policy: &drogon_protocol::graph::GraphPolicy,
    launch: LaunchPreferences,
) -> Result<LaunchPreferences, RpcError> {
    let configured: Vec<&drogon_protocol::graph::GraphRuntimeRef> = policy
        .approved_runtimes
        .iter()
        .chain(policy.fallback_runtime.iter())
        .collect();
    if configured.is_empty() || launch.model.is_some() {
        return Ok(launch);
    }
    let Some(runtime) = configured
        .iter()
        .find(|runtime| runtime.harness == launch.harness_id)
    else {
        let approved = configured
            .iter()
            .map(|runtime| {
                let (provider, model) = policy_provider_model(runtime);
                match (provider, model) {
                    (Some(provider), Some(model)) => {
                        format!("{}/{provider}/{model}", runtime.harness)
                    }
                    (None, Some(model)) => format!("{}/{model}", runtime.harness),
                    _ => runtime.harness.clone(),
                }
            })
            .collect::<Vec<_>>()
            .join(", ");
        return Err(RpcError::new(
            "invalid_argument",
            format!(
                "This workspace's Subagent policy does not approve harness '{}', so a worker                  cannot be launched on it without naming a model explicitly. Approved runtimes:                  {approved}. Drop --harness to let the policy choose, or name --model yourself.",
                launch.harness_id
            ),
        ));
    };
    let (provider, model) = policy_provider_model(runtime);
    Ok(LaunchPreferences {
        provider: launch.provider.or(provider),
        model,
        ..launch
    })
}

impl Engine {
    pub(crate) fn start_coordination_worker(
        &self,
        request: &Request,
        params: WorkerStartParams,
    ) -> Result<Value, RpcError> {
        let dispatch_id = format!("dispatch_{}", uuid::Uuid::new_v4());
        let operation = self.worker_operation(&dispatch_id);
        let _operation = operation.lock().unwrap();
        let _admission = self.lifecycle_gate.read().unwrap();
        // The third route into a workspace's PTY set, beside `session.start`
        // and `harness.start`: a dispatch spawns into
        // `params.placement.workspace_id`, so it takes the same workspace
        // admission gate they do. Without it a worker could be launched into
        // a checkout that `worktree.remove` had already settled and was
        // about to unlink (found by the adversarial pass on #621).
        let _workspace_admission = self.workspace_lifecycle_gate.read().unwrap();
        let key = coordinator_actor(&params.scope).receipt_key(&request.request_id)?;
        // Defer preflight failures until after receipt lookup; replay needs no installed harness.
        let preflight = self.plan_coordination_launch(&params, &dispatch_id);
        self.ledger.run_staged(
            &self.db,
            &key,
            &request.method,
            &request.params,
            |tx| {
                runs::require_coordinator(tx, &params.scope)?;
                if self.quiescent.load(Ordering::Acquire) {
                    return Err(error::runtime_busy(
                        "service admission is frozen for shutdown",
                    ));
                }
                Ok(())
            },
            |tx| self.prepare_coordination_launch(tx, &params, &dispatch_id, preflight?),
            |prepared| self.launch_coordination_worker(&params, prepared),
            |tx, result| {
                if let Ok(value) = result {
                    let launched: WorkerStartResult = decode(value)?;
                    let attempt = attempts::finish_launch(tx, &params.scope, &launched)?;
                    if attempt.result.assignment_state == AssignmentState::Failed
                        && attempt.outcome.is_none()
                    {
                        coordination_access::revoke_in_tx(tx, &dispatch_id, "launch_failed")?;
                        tasks::set_status_in_tx(
                            tx,
                            &self.host_id,
                            &params.scope.run_id,
                            &params.task_id,
                            TaskStatus::Failed,
                        )?;
                    }
                }
                Ok(())
            },
        )
    }

    fn plan_coordination_launch(
        &self,
        params: &WorkerStartParams,
        dispatch_id: &str,
    ) -> Result<LaunchPlan, RpcError> {
        if matches!(params.execution, WorkerExecution::Reuse { .. }) {
            return Err(RpcError::new(
                "unsupported_feature",
                "Existing sessions cannot receive a fresh private worker context yet.",
            ));
        }
        let cli = self
            .worker_cli
            .as_ref()
            .and_then(|path| path.to_str())
            .ok_or_else(|| {
                RpcError::new(
                    "unsupported_feature",
                    "This execution host has no configured worker CLI.",
                )
            })?
            .to_owned();
        let task = self.coordination_read(|tx| {
            tasks::show(
                tx,
                &TaskShowParams {
                    scope: params.scope.clone(),
                    task_id: params.task_id.clone(),
                },
            )
        })?;
        let workspace_path = self.coordination_read(|tx| {
            tx.query_row(
                "SELECT path FROM workspaces WHERE id=?1 AND host_id=?2",
                rusqlite::params![params.placement.workspace_id, self.host_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(error::from_sqlite)?
            .ok_or_else(|| error::not_found("Workspace is not registered on this execution host."))
        })?;
        let graph = crate::graph::store::read_graph(Path::new(&workspace_path))?;
        let launch = match &params.execution {
            WorkerExecution::Fresh { launch } => {
                pin_fresh_launch_to_policy(&graph.intent.policy, launch.clone())?
            }
            WorkerExecution::Policy => {
                let attempted = self.coordination_read(|tx| {
                    attempts::failed_policy_launches(tx, &params.scope, &params.task_id)
                })?;
                let attempted_refs = attempted
                    .iter()
                    .map(|launch| drogon_protocol::graph::GraphRuntimeRef {
                        harness: launch.harness_id.clone(),
                        model: launch.model.clone().unwrap_or_default(),
                        provider: launch.provider.clone(),
                    })
                    .collect::<Vec<_>>();
                let runtime = crate::graph::failover::next_runtime(
                    &graph.intent.policy,
                    &attempted_refs,
                )
                .ok_or_else(|| {
                    RpcError::new(
                        "policy_exhausted",
                        "The Work Graph policy has no untried approved or fallback runtime for this task.",
                    )
                })?;
                if runtime.harness == "shell" {
                    return Err(RpcError::new(
                        "unsupported_feature",
                        "A shell graph runtime cannot be used as an orchestration worker.",
                    ));
                }
                let (provider, model) = policy_provider_model(&runtime);
                LaunchPreferences {
                    harness_id: runtime.harness,
                    model,
                    effort: None,
                    provider,
                    permission_mode: LaunchPermissionMode::Inherit,
                }
            }
            WorkerExecution::Reuse { .. } => unreachable!(),
        };
        let mut launch_request: HarnessLaunchRequest = decode(&encode(&launch)?)?;
        let objective = task
            .spec
            .display_name
            .as_deref()
            .or(task.spec.title.as_deref())
            .unwrap_or("Complete the assigned task");
        let scope_paths =
            worker_brief::task_scope_paths(task.spec.metadata.as_ref(), Path::new(&workspace_path));
        launch_request.prompt = Some(worker_brief::compose_worker_brief(
            objective,
            &scope_paths,
            &task.spec.instructions,
            Path::new(&workspace_path),
            &params.scope.run_id,
            &params.task_id,
            dispatch_id,
            &cli,
            &graph.intent.policy,
        ));
        let mut harness = harness::resolve_launch(&launch_request)?;
        let pi_extension = (launch.harness_id == "pi").then(|| {
            let path = harness::harness_hooks::pi::nonce_extension_path(
                &self.data_dir,
                &uuid::Uuid::new_v4().to_string(),
            );
            harness
                .args
                .extend(["--extension".into(), path.to_string_lossy().into_owned()]);
            path
        });
        Ok(LaunchPlan {
            harness,
            cli,
            preferences: launch,
            pi_extension,
        })
    }

    fn prepare_coordination_launch(
        &self,
        tx: &Transaction<'_>,
        params: &WorkerStartParams,
        dispatch_id: &str,
        plan: LaunchPlan,
    ) -> Result<PreparedWorker, RpcError> {
        let task = tasks::show(
            tx,
            &TaskShowParams {
                scope: params.scope.clone(),
                task_id: params.task_id.clone(),
            },
        )?;
        let allowed = task.task.status == TaskStatus::Ready
            || (params.retry_of.is_some()
                && matches!(task.task.status, TaskStatus::Failed | TaskStatus::Blocked));
        if !allowed {
            return Err(RpcError::new(
                "task_not_ready",
                "Task is not ready for a new worker attempt.",
            ));
        }
        tasks::require_completed_dependencies(
            tx,
            &self.host_id,
            &params.scope.run_id,
            &params.task_id,
        )?;
        let cwd: Option<String> = tx
            .query_row(
                "SELECT path FROM workspaces WHERE id=?1 AND host_id=?2",
                rusqlite::params![params.placement.workspace_id, self.host_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(error::from_sqlite)?;
        let cwd = cwd.ok_or_else(|| {
            error::not_found("Workspace is not registered on this execution host.")
        })?;
        // Issue #622 (subagent nesting): the optional creator-session
        // identity — `drogon-cli orchestration worker-start` sends its
        // inherited `DROGON_SESSION_ID` as `parentSessionId`, exactly like
        // `terminal create` / `harness start` children do. Only the shape
        // is refused here (empty or NUL): an id that names no session on
        // this host is DROPPED and the worker launches parentless. The CLI
        // attaches that id automatically from its inherited environment —
        // the caller never asked for a parent — so a stale or already-closed
        // coordinator session id must never fail a launch over cosmetic
        // attribution. The sidebar already renders a dangling parent as a
        // flat root, so dropping is display-safe. A coordinator outside a
        // Drogon terminal sends none, and the worker stays parentless.
        let parent_session_id = match params.parent_session_id.as_deref() {
            None => None,
            Some(parent) => {
                if parent.is_empty() || parent.contains('\0') {
                    return Err(error::invalid_argument("parentSessionId must not be empty"));
                }
                let exists: bool = tx
                    .query_row(
                        "SELECT COUNT(*) FROM sessions WHERE id = ?1 AND host_id = ?2",
                        rusqlite::params![parent, self.host_id],
                        |r| r.get::<_, i64>(0),
                    )
                    .map_err(error::from_sqlite)?
                    > 0;
                if exists {
                    Some(parent.to_string())
                } else {
                    None
                }
            }
        };
        let prepared = session_admission::reserve(
            tx,
            &self.host_id,
            &params.placement.workspace_id,
            &cwd,
            &plan.harness.command,
            &plan.harness.args,
            Some(plan.preferences.harness_id.clone()),
            parent_session_id,
            None,
            100,
            32,
        )?;
        let identity = SessionIdentity {
            session_id: prepared.session_id().into(),
            incarnation: prepared.incarnation().into(),
        };
        let credential = DispatchCredential::mint()?;
        coordination_access::register_in_tx(
            tx,
            &credential.digest(),
            &self.host_id,
            &params.scope.run_id,
            &params.task_id,
            dispatch_id,
            &identity.session_id,
            &identity.incarnation,
            &crate::now_rfc3339(),
        )?;
        let environment = WorkerEnvironment::new(
            credential,
            &self.host_id,
            &params.scope.run_id,
            &params.task_id,
            dispatch_id,
            &identity.session_id,
            &identity.incarnation,
            self.data_dir
                .to_str()
                .ok_or_else(|| error::invalid_argument("Worker data directory is not UTF-8."))?,
            &plan.cli,
        )?;
        let attempt = Attempt {
            result: WorkerStartResult {
                run_id: params.scope.run_id.clone(),
                task_id: params.task_id.clone(),
                dispatch_id: dispatch_id.into(),
                consumer_generation: params.scope.consumer_generation,
                workspace_id: params.placement.workspace_id.clone(),
                assignment_state: AssignmentState::Admitting,
                readiness: ReadinessObservation::NotObserved,
                process_verdict: ProcessVerdict::Unverifiable,
                session_identity: Some(identity.clone()),
                effects: vec![
                    ResourceEffect {
                        kind: ResourceKind::Workspace,
                        resource_id: params.placement.workspace_id.clone(),
                        incarnation: None,
                        action: ResourceAction::Reused,
                    },
                    ResourceEffect {
                        kind: ResourceKind::Session,
                        resource_id: identity.session_id.clone(),
                        incarnation: Some(identity.incarnation.clone()),
                        action: ResourceAction::Created,
                    },
                ],
                residual_resources: vec![ResidualResource {
                    kind: ResourceKind::Session,
                    resource_id: identity.session_id,
                    incarnation: Some(identity.incarnation),
                    action: ResourceAction::Retained,
                    disposition: ResourceDisposition::Retained,
                }],
                failure: None,
                warning: Some("Spawn acceptance does not prove prompt or model readiness.".into()),
            },
            launch: plan.preferences,
            outcome: None,
            report_message_id: None,
            report_result: None,
            cleanup_owned: true,
        };
        if let Some(replaced) =
            attempts::admit(tx, &params.scope, &attempt, params.retry_of.as_deref())?
        {
            coordination_access::revoke_in_tx(tx, &replaced, "superseded")?;
        }
        tasks::set_status_in_tx(
            tx,
            &self.host_id,
            &params.scope.run_id,
            &params.task_id,
            TaskStatus::Dispatched,
        )?;
        Ok(PreparedWorker {
            attempt,
            session: prepared,
            environment,
            pi_extension: plan.pi_extension,
            cli: plan.cli,
        })
    }

    fn launch_coordination_worker(
        &self,
        params: &WorkerStartParams,
        mut prepared: PreparedWorker,
    ) -> Result<Value, RpcError> {
        let mut cleanup_paths = Vec::new();
        let launch = (|| {
            let mut extra_env = Vec::new();
            if let Some(path) = &prepared.pi_extension {
                let marker = harness::harness_hooks::pi::marker_path(path);
                cleanup_paths.extend([path.clone(), marker.clone()]);
                harness::harness_hooks::pi::write_extension_file(path)?;
                extra_env = crate::session_env::harness_hook_env(
                    &prepared.cli,
                    prepared.session.incarnation(),
                );
                extra_env.extend([
                    (
                        "DROGON_HOOK_MARKER".into(),
                        marker.to_string_lossy().into_owned(),
                    ),
                    ("DROGON_HOOK_USAGE_ONLY".into(), "1".into()),
                ]);
            }
            session_admission::launch_reserved_with_cleanup(
                self.db.clone(),
                &self.data_dir,
                prepared.session,
                Some(prepared.environment),
                &extra_env,
                session_admission::LaunchOptions {
                    cleanup_paths: cleanup_paths.clone(),
                    ..Default::default()
                },
            )
        })();
        match launch {
            Ok((id, handle, _)) => {
                self.sessions.lock().unwrap().insert(id, handle.clone());
                // Spawn is already accepted; preserve recovery identity on a bookkeeping fault.
                let persistence_warning = session::persist_admission(&handle).err();
                let recorded = self.coordination_read(|tx| {
                    attempts::show(tx, &params.scope, &prepared.attempt.result.dispatch_id)
                })?;
                if recorded.result.assignment_state != AssignmentState::Admitting {
                    prepared.attempt = recorded;
                } else {
                    prepared.attempt.result.assignment_state = AssignmentState::Ready;
                }
                if let Some(warning) = persistence_warning {
                    prepared.attempt.result.warning =
                        Some(match prepared.attempt.result.warning.take() {
                            Some(readiness) => format!("{readiness} {}", warning.message),
                            None => warning.message,
                        });
                }
            }
            Err(_) => {
                if let Some(identity) = &prepared.attempt.result.session_identity {
                    session_admission::abandon_pending(&self.db, &identity.session_id);
                }
                for path in cleanup_paths {
                    crate::hooks::remove_settings_file(&path);
                }
                prepared.attempt.result.assignment_state = AssignmentState::Failed;
                prepared.attempt.result.failure = Some(AttemptFailure {
                    code: "launch_failed".into(),
                    stage: "spawn".into(),
                    message: "The selected harness could not be launched.".into(),
                });
            }
        }
        prepared.attempt.result.process_verdict = self
            .worker_verdict(&prepared.attempt)
            .unwrap_or(ProcessVerdict::Unverifiable);
        encode(prepared.attempt.result)
    }
}

#[cfg(test)]
mod policy_pinning_tests {
    use super::*;
    use drogon_protocol::graph::{GraphPolicy, GraphRuntimeRef};

    fn runtime(harness: &str, model: &str) -> GraphRuntimeRef {
        GraphRuntimeRef {
            harness: harness.into(),
            model: model.into(),
            provider: None,
        }
    }
    fn launch(harness: &str, model: Option<&str>) -> LaunchPreferences {
        LaunchPreferences {
            harness_id: harness.into(),
            model: model.map(str::to_string),
            effort: None,
            provider: None,
            permission_mode: LaunchPermissionMode::Inherit,
        }
    }

    #[test]
    fn an_unspecified_model_is_filled_from_the_policy_never_left_to_the_harness() {
        let policy = GraphPolicy {
            approved_runtimes: vec![runtime("pi", "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4")],
            ..GraphPolicy::default()
        };
        let pinned = pin_fresh_launch_to_policy(&policy, launch("pi", None)).unwrap();
        assert_eq!(pinned.provider.as_deref(), Some("dgx-spark"));
        assert_eq!(
            pinned.model.as_deref(),
            Some("qwen3.8-flash-next-nvidia-nvfp4"),
            "the free runtime the owner approved, not whatever pi would pick"
        );
    }

    #[test]
    fn a_harness_the_policy_never_approved_is_refused_with_the_approved_list() {
        let policy = GraphPolicy {
            approved_runtimes: vec![runtime("pi", "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4")],
            ..GraphPolicy::default()
        };
        let error = pin_fresh_launch_to_policy(&policy, launch("claude", None)).unwrap_err();
        assert_eq!(error.code, "invalid_argument");
        assert!(
            error.message.contains("does not approve harness 'claude'"),
            "{}",
            error.message
        );
        assert!(
            error.message.contains("qwen3.8-flash-next-nvidia-nvfp4"),
            "{}",
            error.message
        );
    }

    #[test]
    fn an_explicit_model_and_an_unconfigured_policy_both_pass_through_untouched() {
        let policy = GraphPolicy {
            approved_runtimes: vec![runtime("pi", "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4")],
            ..GraphPolicy::default()
        };
        let explicit =
            pin_fresh_launch_to_policy(&policy, launch("pi", Some("openai-codex/gpt-5.6-luna")))
                .unwrap();
        assert_eq!(explicit.model.as_deref(), Some("openai-codex/gpt-5.6-luna"));
        let unconfigured =
            pin_fresh_launch_to_policy(&GraphPolicy::default(), launch("claude", None)).unwrap();
        assert_eq!(unconfigured.model, None, "no policy, no opinion");
    }

    #[test]
    fn the_fallback_runtime_also_pins_a_harness_the_approved_list_does_not_carry() {
        let policy = GraphPolicy {
            approved_runtimes: vec![runtime("pi", "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4")],
            fallback_runtime: Some(runtime("claude", "claude-sonnet-5")),
            ..GraphPolicy::default()
        };
        let pinned = pin_fresh_launch_to_policy(&policy, launch("claude", None)).unwrap();
        assert_eq!(pinned.model.as_deref(), Some("claude-sonnet-5"));
    }
}
