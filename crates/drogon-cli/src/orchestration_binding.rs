//! Resolve source terminal context through the daemon, without a client binding store.
// MIT Copyright (c) 2026 Lovecast Inc.
// Source behavior: src/cli/handlers/orchestration/run-handlers.ts and
// src/main/runtime/rpc/methods/orchestration-runs.ts. Native identity checks are local.
use crate::client::{Client, SessionList, StatusResult, Verdict, check_session};
use crate::credential;
use crate::error::CliError;
use crate::orchestration_cli::{CoordinatorScopeArgs, OrchestrationCommand, ReceiptScopeArg};
use crate::orchestration_commands::{check_run, host_scope};
use crate::transport::DEFAULT_TIMEOUT;
use drogon_protocol::RpcError;
use drogon_protocol::orchestration_common::SessionIdentity;
use drogon_protocol::orchestration_run::{
    RunCurrentParams, RunCurrentResult, RunShowParams, RunShowResult, RunSummary,
};
use sha2::{Digest, Sha256};

pub(crate) const CAPABILITY: &str = "orchestration.terminal-bindings.v1";
pub(crate) struct Resolved {
    pub command: OrchestrationCommand,
    pub caller: Option<SessionIdentity>,
}
fn failure(id: &str, code: &str, message: &str) -> CliError {
    CliError::local(RpcError::new(code, message), id)
}
fn usage(message: &str) -> CliError {
    CliError::Usage(message.into())
}
pub(crate) fn terminal_hint() -> bool {
    std::env::var_os("DROGON_SESSION_ID").is_some()
}
pub(crate) fn named_inspection(command: &OrchestrationCommand) -> bool {
    matches!(
        command,
        OrchestrationCommand::TaskList { .. }
            | OrchestrationCommand::TaskShow { .. }
            | OrchestrationCommand::GateList { .. }
            | OrchestrationCommand::WorkerShow { .. }
            | OrchestrationCommand::WorkerRead { .. }
    )
}
fn require_capability(status: &StatusResult, id: &str) -> Result<(), CliError> {
    if !status.capabilities.iter().any(|cap| cap == CAPABILITY) {
        return Err(failure(
            id,
            "unsupported_feature",
            "Runtime lacks orchestration.terminal-bindings.v1; explicit native bindings are still available.",
        ));
    }
    Ok(())
}
async fn owner(
    client: &Client,
    id: &str,
    status: &StatusResult,
    from: Option<&str>,
    explicit: Option<&str>,
) -> Result<(String, Option<SessionIdentity>), CliError> {
    if from.is_none()
        && let Some(explicit) = explicit
    {
        return Ok((explicit.to_string(), None));
    }
    let hint = std::env::var("DROGON_SESSION_ID").ok();
    let selected = match from {
        Some("current") | None => hint.as_deref(),
        Some(selected) => Some(selected),
    }.ok_or_else(|| usage("No coordinator terminal context; pass --from <terminal-id> or explicit native bindings."))?;
    if hint.as_deref().is_some_and(|hint| hint != selected) {
        return Err(usage("--from conflicts with DROGON_SESSION_ID"));
    }
    require_capability(status, id)?;
    let call = client
        .call("session.list", serde_json::json!({}), id, DEFAULT_TIMEOUT)
        .await?;
    let sessions: SessionList =
        Client::decode_checked(&call, "session.list", |_: &SessionList| Ok(()))?;
    let candidates: Vec<_> = sessions
        .sessions
        .iter()
        .filter(|session| session.id == selected)
        .collect();
    if candidates.len() != 1 {
        return Err(failure(
            id,
            "not_found",
            "Coordinator terminal is missing or ambiguous; no binding was guessed.",
        ));
    }
    let session = candidates[0];
    check_session(session).map_err(|_| {
        failure(
            id,
            "unverifiable",
            "Invalid coordinator terminal observation.",
        )
    })?;
    if session.host_id != status.host_id || session.verdict != Verdict::Live {
        return Err(failure(
            id,
            "unverifiable",
            "Coordinator terminal is not observed live on this host.",
        ));
    }
    if hint.as_deref() == Some(selected) {
        for key in ["DROGON_SESSION_INCARNATION", "DROGON_HOOK_INCARNATION"] {
            if let Ok(expected) = std::env::var(key)
                && expected != session.incarnation
            {
                return Err(failure(
                    id,
                    "stale_incarnation",
                    "Coordinator terminal incarnation does not match the scoped environment.",
                ));
            }
        }
    }
    let caller = SessionIdentity {
        session_id: session.id.clone(),
        incarnation: session.incarnation.clone(),
    };
    let identity = serde_json::json!([
        "drogon.coordinator-session.v1",
        caller.session_id,
        caller.incarnation
    ]);
    let owner = format!(
        "terminal-{:x}",
        Sha256::digest(identity.to_string().as_bytes())
    );
    if explicit.is_some_and(|explicit| explicit != owner) {
        return Err(usage(
            "--coordinator-id conflicts with the caller terminal identity",
        ));
    }
    Ok((owner, Some(caller)))
}
async fn current(
    client: &Client,
    id: &str,
    status: &StatusResult,
    owner: &str,
    caller: &Option<SessionIdentity>,
) -> Result<RunSummary, CliError> {
    require_capability(status, id)?;
    let params = RunCurrentParams {
        host: host_scope(&status.host_id),
        coordinator_id: owner.to_string(),
        caller: caller.clone(),
    };
    let call = client
        .call(
            "orchestration.runCurrent",
            serde_json::to_value(params).map_err(|_| usage("Invalid binding parameters"))?,
            id,
            DEFAULT_TIMEOUT,
        )
        .await?;
    let result: RunCurrentResult =
        Client::decode_checked(&call, "orchestration.runCurrent", |r: &RunCurrentResult| {
            if let Some(run) = &r.run {
                check_run(run)?;
                if run.coordinator_id != owner {
                    return Err("run-current response names a different coordinator".into());
                }
            }
            Ok(())
        })?;
    result.run.ok_or_else(|| {
        failure(
            id,
            "run_not_found",
            "No Run is bound to this coordinator. Use run-create or run-use explicitly.",
        )
    })
}
async fn show(
    client: &Client,
    id: &str,
    status: &StatusResult,
    run: &str,
) -> Result<RunSummary, CliError> {
    let params = RunShowParams {
        host: host_scope(&status.host_id),
        run_id: run.to_string(),
    };
    let call = client
        .call(
            "orchestration.runShow",
            serde_json::to_value(params).map_err(|_| usage("Invalid run parameters"))?,
            id,
            DEFAULT_TIMEOUT,
        )
        .await?;
    let result: RunShowResult =
        Client::decode_checked(&call, "orchestration.runShow", |r: &RunShowResult| {
            check_run(&r.run)?;
            if r.run.run_id != run {
                return Err("run-show response names a different run".into());
            }
            Ok(())
        })?;
    Ok(result.run)
}
fn fill(
    scope: &mut CoordinatorScopeArgs,
    run: &RunSummary,
    owner: &str,
    id: &str,
) -> Result<(), CliError> {
    if scope
        .run
        .as_deref()
        .is_some_and(|requested| requested != run.run_id)
    {
        return Err(failure(
            id,
            "consumer_fenced",
            "The requested run is not the caller's bound run; use run-use explicitly.",
        ));
    }
    scope.run.get_or_insert_with(|| run.run_id.clone());
    scope
        .coordinator_id
        .get_or_insert_with(|| owner.to_string());
    // An explicit stale/invalid generation is preserved for the native fence, never repaired.
    scope
        .consumer_generation
        .get_or_insert(run.consumer_generation);
    Ok(())
}
pub(crate) async fn resolve(
    client: &Client,
    id: &str,
    status: &StatusResult,
    mut command: OrchestrationCommand,
) -> Result<Resolved, CliError> {
    if credential::dispatch_credential_present() {
        if let Some(actor) = command.actor_scope_mut()
            && let Some(from) = &actor.from
            && std::env::var("DROGON_SESSION_ID").ok().as_ref() != Some(from)
        {
            return Err(usage(
                "Worker --from/--terminal must match DROGON_SESSION_ID",
            ));
        }
        return Ok(Resolved {
            command,
            caller: None,
        });
    }
    match &mut command {
        OrchestrationCommand::RunCreate {
            coordinator_id,
            from,
            ..
        } => {
            if from.is_none() && (coordinator_id.is_some() || !terminal_hint()) {
                return Ok(Resolved {
                    command,
                    caller: None,
                });
            }
            let (resolved_owner, caller) = owner(
                client,
                id,
                status,
                from.as_deref(),
                coordinator_id.as_deref(),
            )
            .await?;
            *coordinator_id = Some(resolved_owner);
            return Ok(Resolved { command, caller });
        }
        OrchestrationCommand::RunCurrent {
            coordinator_id,
            from,
            ..
        } => {
            let (resolved_owner, caller) = owner(
                client,
                id,
                status,
                from.as_deref(),
                coordinator_id.as_deref(),
            )
            .await?;
            *coordinator_id = Some(resolved_owner);
            return Ok(Resolved { command, caller });
        }
        OrchestrationCommand::RunUse {
            scope, id: target, ..
        } => {
            if let Some(target) = target {
                if scope.run.as_ref().is_some_and(|run| run != target) {
                    return Err(usage("--id and --run name different runs"));
                }
                scope.run = Some(target.clone());
            }
            if scope.run.is_none() {
                return Err(usage("run-use requires --id or --run"));
            }
        }
        OrchestrationCommand::RequestShow {
            scope: ReceiptScopeArg::Bootstrap | ReceiptScopeArg::Dispatch,
            ..
        } => {
            return Ok(Resolved {
                command,
                caller: None,
            });
        }
        // Host-scoped read-only listing: no coordinator binding, no
        // current-run guess. `--run` narrows; without it all runs list.
        OrchestrationCommand::WorkerList { .. } => {
            return Ok(Resolved {
                command,
                caller: None,
            });
        }
        _ => {}
    }
    if let Some(mut scope) = command.coordinator_scope().cloned() {
        if scope.is_complete() && scope.from.is_none() {
            return Ok(Resolved {
                command,
                caller: None,
            });
        }
        if named_inspection(&command)
            && scope.run.is_some()
            && scope.coordinator_id.is_none()
            && scope.from.is_none()
        {
            let run = show(client, id, status, scope.run_id()).await?;
            fill(&mut scope, &run, &run.coordinator_id, id)?;
            *command.coordinator_scope_mut().unwrap() = scope;
            return Ok(Resolved {
                command,
                caller: None,
            });
        }
        let (resolved_owner, caller) = owner(
            client,
            id,
            status,
            scope.from.as_deref(),
            scope.coordinator_id.as_deref(),
        )
        .await?;
        if matches!(command, OrchestrationCommand::RunUse { .. })
            && caller.is_some()
            && scope.consumer_generation.is_none()
        {
            scope.coordinator_id = Some(resolved_owner);
            *command.coordinator_scope_mut().unwrap() = scope;
            return Ok(Resolved { command, caller });
        }
        let run = if matches!(command, OrchestrationCommand::RunUse { .. }) {
            if scope.consumer_generation.is_none() {
                return Err(usage(
                    "Native run-use requires --consumer-generation or a verified --from terminal.",
                ));
            }
            show(client, id, status, scope.run_id()).await?
        } else {
            current(client, id, status, &resolved_owner, &caller).await?
        };
        if let OrchestrationCommand::RunUse { takeover, .. } = &mut command
            && caller.is_some()
            && run.coordinator_id != resolved_owner
        {
            *takeover = true;
        }
        fill(&mut scope, &run, &resolved_owner, id)?;
        *command.coordinator_scope_mut().unwrap() = scope;
        return Ok(Resolved { command, caller });
    }
    if let Some(actor) = command.actor_scope_mut() {
        if actor.from.is_none()
            && actor.run.is_some()
            && actor.coordinator_id.is_some()
            && actor.consumer_generation.is_some()
        {
            return Ok(Resolved {
                command,
                caller: None,
            });
        }
        let mut scope = CoordinatorScopeArgs {
            run: actor.run.clone(),
            coordinator_id: actor.coordinator_id.clone(),
            consumer_generation: actor.consumer_generation,
            from: actor.from.clone(),
        };
        let (resolved_owner, caller) = owner(
            client,
            id,
            status,
            scope.from.as_deref(),
            scope.coordinator_id.as_deref(),
        )
        .await?;
        let run = current(client, id, status, &resolved_owner, &caller).await?;
        fill(&mut scope, &run, &resolved_owner, id)?;
        actor.run = scope.run;
        actor.coordinator_id = scope.coordinator_id;
        actor.consumer_generation = scope.consumer_generation;
        return Ok(Resolved { command, caller });
    }
    Ok(Resolved {
        command,
        caller: None,
    })
}
