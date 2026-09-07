//! Execution for the native orchestration verbs. Every call performs the
//! read-only `orchestration.native.v1` capability preflight first, checks the
//! runtime host against the explicit host / scoped hint, then builds the
//! exact typed protocol params, validates their shape, and sends one request.
//! Actor scope (coordinator vs dispatch) follows the explicit scoped
//! credential presence — environment hints are routing context only and never
//! grant authority. No client binding store exists: follow-up verbs require
//! explicit bindings (or the worker's own scoped hints for worker-actor mail).

use std::time::Duration;

use drogon_protocol::RpcError;
use drogon_protocol::orchestration_common::{
    ActorScope, LaunchPermissionMode, LaunchPreferences, OpaqueCursor, ReportOutcome,
    SessionIdentity, WaitPolicy,
};
use drogon_protocol::orchestration_mail::{
    CheckMode, CheckParams, CheckResult, FinalReport, LifecycleVerdict, MessageKind, ReplyParams,
    ReplyResult, SendParams, SendResult, SendTarget,
};
use drogon_protocol::orchestration_question::{
    AskIntent, AskParams, AskResult, AskWaitOutcome, BootstrapScope, ReceiptScope,
    RequestLedgerState, RequestShowParams, RequestShowResult,
};
use drogon_protocol::orchestration_run::{
    RunCreateParams, RunCreateResult, RunListParams, RunListResult, RunShowParams, RunShowResult,
    RunSummary, RunUseParams, RunUseResult,
};
use drogon_protocol::orchestration_scope::{CoordinatorScope, HostScope};
use drogon_protocol::orchestration_task::{
    TaskCreateParams, TaskCreateResult, TaskListParams, TaskListResult, TaskShowParams,
    TaskShowResult, TaskSpec, TaskStatus,
};
use drogon_protocol::orchestration_worker::{
    OutputSource, ProcessAction, WorkerAbandonParams, WorkerAbandonResult, WorkerExecution,
    WorkerPlacement, WorkerReadParams, WorkerReadResult, WorkerReleaseParams, WorkerReleaseResult,
    WorkerShowParams, WorkerShowResult, WorkerStartParams, WorkerStartResult, WorkerStopParams,
    WorkerStopResult,
};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::cli::PermissionModeArg;
use crate::client::{CallOk, Client, StatusResult};
use crate::commands::RunOutcome;
use crate::credential;
use crate::error::{CliError, internal_error, method_not_found};
use crate::orchestration_cli::{
    ActorScopeArgs, CoordinatorScopeArgs, MessageKindArg, OptionalCoordinatorScope,
    OrchestrationCommand, OutcomeArg, OutputSourceArg, ReceiptScopeArg, StatusArg,
};
use crate::transport::DEFAULT_TIMEOUT;

pub const NATIVE_CAPABILITY: &str = "orchestration.native.v1";
/// Wait budget ceiling (mirrors the protocol constant for CLI messages).
pub const MAX_WAIT_BUDGET_MS: u32 = drogon_protocol::orchestration_common::MAX_WAIT_BUDGET_MS;
/// Why: the transport round-trip must outlive the server-side wait budget by
/// a small bounded margin, or every long poll would die at the default 30s
/// transport cap before the server could answer. No unbounded loop: the total
/// is still a hard timeout.
const WAIT_TRANSPORT_MARGIN_MS: u64 = 5_000;

fn usage(message: impl Into<String>) -> CliError {
    CliError::Usage(message.into())
}

/// Purely local actor/flag contradiction checks, run from `Cli::validate`
/// before any connection: a worker credential plus coordinator bindings (or
/// vice versa) would silently discard one side, so both are refused; the
/// coordinator-only verbs refuse worker credentials outright (no
/// administrator fallback); request-show under a worker credential accepts
/// only the dispatch receipt scope; and reuse execution refuses fresh launch
/// preferences.
pub fn validate_actor_flags(command: &OrchestrationCommand) -> Result<(), CliError> {
    let worker_credential = credential::dispatch_credential_present();
    // Scoped hints are local inputs: present-but-empty or non-UTF-8 values
    // fail closed before anything connects.
    for key in [
        "DROGON_RUN_ID",
        "DROGON_TASK_ID",
        "DROGON_DISPATCH_ID",
        "DROGON_HOST_ID",
    ] {
        if let Some(raw) = std::env::var_os(key) {
            let value = raw
                .to_str()
                .ok_or_else(|| usage(format!("{key} is not valid UTF-8")))?;
            if value.is_empty() {
                return Err(usage(format!("{key} is present but empty")));
            }
        }
    }
    let coordinator_only = matches!(
        command,
        OrchestrationCommand::RunCreate { .. }
            | OrchestrationCommand::RunList { .. }
            | OrchestrationCommand::RunShow { .. }
            | OrchestrationCommand::RunUse { .. }
            | OrchestrationCommand::TaskCreate { .. }
            | OrchestrationCommand::TaskList { .. }
            | OrchestrationCommand::TaskShow { .. }
            | OrchestrationCommand::WorkerStart { .. }
            | OrchestrationCommand::WorkerShow { .. }
            | OrchestrationCommand::WorkerRead { .. }
            | OrchestrationCommand::WorkerStop { .. }
            | OrchestrationCommand::WorkerAbandon { .. }
            | OrchestrationCommand::WorkerRelease { .. }
    );
    if coordinator_only {
        if worker_credential {
            return Err(usage(
                "this command is coordinator-only and refuses DROGON_DISPATCH_CAPABILITY; there is no administrator fallback",
            ));
        }
        if let OrchestrationCommand::WorkerStart {
            harness,
            model,
            effort,
            provider,
            permission_mode,
            reuse_session,
            ..
        } = command
        {
            // Reuse execution must not carry fresh launch preferences: they
            // would be silently discarded, not applied. Any explicitly
            // supplied --permission-mode value counts, including inherit.
            if reuse_session.is_some()
                && (harness.is_some()
                    || model.is_some()
                    || effort.is_some()
                    || provider.is_some()
                    || permission_mode.is_some())
            {
                return Err(usage(
                    "--reuse-session rejects fresh launch preferences (--harness/--model/--effort/--provider/--permission-mode)",
                ));
            }
            if effort.is_some() && model.is_none() {
                return Err(usage("--effort requires --model"));
            }
        }
        return Ok(());
    }
    if let OrchestrationCommand::RequestShow { scope, actor, .. } = command {
        if worker_credential {
            if !matches!(scope, ReceiptScopeArg::Dispatch) {
                return Err(usage(
                    "request-show under a worker credential supports only --scope dispatch",
                ));
            }
            if actor.coordinator_id.is_some() || actor.consumer_generation.is_some() {
                return Err(usage(
                    "worker credential set: --coordinator-id/--consumer-generation are                      coordinator bindings and would be discarded",
                ));
            }
        } else if actor.task.is_some() || actor.dispatch.is_some() {
            return Err(usage(
                "coordinator actor: --task/--dispatch are worker bindings and would be discarded",
            ));
        }
        return Ok(());
    }
    // Dual-actor mail verbs.
    if let OrchestrationCommand::Send { actor, .. }
    | OrchestrationCommand::Reply { actor, .. }
    | OrchestrationCommand::Ask { actor, .. } = command
    {
        if worker_credential {
            if actor.coordinator_id.is_some() || actor.consumer_generation.is_some() {
                return Err(usage(
                    "worker credential set: --coordinator-id/--consumer-generation are                      coordinator bindings and would be discarded",
                ));
            }
        } else if actor.task.is_some() || actor.dispatch.is_some() {
            return Err(usage(
                "coordinator actor: --task/--dispatch are worker bindings and would be discarded",
            ));
        }
        return Ok(());
    }
    if let OrchestrationCommand::Check {
        actor,
        peek,
        all,
        ack,
        wait,
        cursor,
        limit,
        ..
    } = command
    {
        if worker_credential {
            if actor.coordinator_id.is_some() || actor.consumer_generation.is_some() {
                return Err(usage(
                    "worker credential set: --coordinator-id/--consumer-generation are \
                     coordinator bindings and would be discarded",
                ));
            }
        } else if actor.task.is_some() || actor.dispatch.is_some() {
            return Err(usage(
                "coordinator actor: --task/--dispatch are worker bindings and would be discarded",
            ));
        }
        // Why: cursor/limit are inspection pagination; a consuming check
        // returns the whole unsplittable FIFO batch, so combining them with
        // unread/ack/wait is a contradiction refused before any connection.
        if cursor.is_some() || limit.is_some() {
            if !(*peek || *all) || ack.is_some() || *wait {
                return Err(usage(
                    "--cursor/--limit are inspection-only (peek/all) and cannot be \
                     combined with consuming reads, --ack or --wait",
                ));
            }
            if let Some(cursor) = cursor {
                OpaqueCursor(cursor.clone())
                    .validate()
                    .map_err(|err| usage(format!("--cursor: {}", err.message)))?;
            }
            if let Some(limit) = limit
                && (*limit == 0 || *limit > drogon_protocol::orchestration_common::MAX_PAGE_LIMIT)
            {
                return Err(usage("--limit is outside the supported range"));
            }
        }
        return Ok(());
    }
    Ok(())
}

/// Scoped hints are fail-closed inputs: a present-but-empty or non-UTF-8
/// value is a refused invocation, never a silently ignored variable.
fn env_hint(key: &str) -> Result<Option<String>, CliError> {
    match std::env::var_os(key) {
        None => Ok(None),
        Some(raw) => {
            let value = raw
                .to_str()
                .ok_or_else(|| usage(format!("{key} is not valid UTF-8")))?;
            if value.is_empty() {
                Err(usage(format!("{key} is present but empty")))
            } else {
                Ok(Some(value.to_string()))
            }
        }
    }
}

/// Explicit flags win; a scoped hint fills a gap; a mismatch refuses.
fn agree(flag: &str, env_key: &str, explicit: Option<&str>) -> Result<Option<String>, CliError> {
    let hint = env_hint(env_key)?;
    match (explicit, hint) {
        (Some(value), Some(hint_value)) if value != hint_value => Err(usage(format!(
            "--{flag} conflicts with the scoped {env_key} environment hint"
        ))),
        (Some(value), _) => Ok(Some(value.to_string())),
        (None, Some(hint_value)) => Ok(Some(hint_value)),
        (None, None) => Ok(None),
    }
}

fn require(flag: &str, value: Option<String>) -> Result<String, CliError> {
    value.ok_or_else(|| usage(format!("--{flag} is required for this command")))
}

/// Read-only status preflight. The preflight request id is distinct; every
/// failure is re-keyed onto the operation's request id so `--request-id`
/// stays replayable across preflight errors and retries.
async fn capability_preflight(
    client: &Client,
    operation_request_id: &str,
) -> Result<StatusResult, CliError> {
    let preflight_request_id = uuid::Uuid::new_v4().to_string();
    let call = client
        .call(
            "status",
            serde_json::json!({}),
            &preflight_request_id,
            DEFAULT_TIMEOUT,
        )
        .await
        .map_err(|err| err.retaining_request_id(operation_request_id))?;
    let status: StatusResult = Client::decode_checked(&call, "status", crate::client::check_status)
        .map_err(|err| err.retaining_request_id(operation_request_id))?;
    if !status
        .capabilities
        .iter()
        .any(|cap| cap == NATIVE_CAPABILITY)
    {
        return Err(CliError::local(
            method_not_found(format!(
                "this Drogon service does not advertise {NATIVE_CAPABILITY}; \
                 update the Drogon service on the execution host"
            )),
            operation_request_id,
        ));
    }
    Ok(status)
}

/// Host resolution: explicit `--host` > scoped hint > the preflight's own
/// host identity. Any explicit/hint value that disagrees with the runtime is
/// refused before the method request; there is no fallback host.
fn resolve_host(
    explicit: Option<&str>,
    status_host: &str,
    request_id: &str,
) -> Result<String, CliError> {
    let hint = env_hint("DROGON_HOST_ID")?;
    let chosen = match (explicit, &hint) {
        (Some(value), Some(hint_value)) if value != hint_value => {
            return Err(usage(
                "--host conflicts with the scoped DROGON_HOST_ID environment hint",
            ));
        }
        (Some(value), _) => value.to_string(),
        (None, Some(hint_value)) => hint_value.clone(),
        (None, None) => status_host.to_string(),
    };
    if chosen != status_host {
        return Err(CliError::local(
            RpcError::new(
                "unsupported_host",
                format!(
                    "the requested execution host {chosen:?} is not served by this endpoint ({status_host})"
                ),
            ),
            request_id,
        ));
    }
    Ok(chosen)
}

fn host_scope(host_id: &str) -> HostScope {
    HostScope {
        contract_version: drogon_protocol::orchestration_scope::COORDINATION_CONTRACT_VERSION,
        host_id: host_id.to_string(),
    }
}

/// Coordinator bindings are explicit-only: no hint filling, no defaults.
fn coordinator_scope(host_id: &str, args: &CoordinatorScopeArgs) -> CoordinatorScope {
    CoordinatorScope {
        host: host_scope(host_id),
        run_id: args.run.clone(),
        coordinator_id: args.coordinator_id.clone(),
        consumer_generation: args.consumer_generation,
    }
}

fn coordinator_scope_from_optional(
    host_id: &str,
    args: &OptionalCoordinatorScope,
) -> Result<CoordinatorScope, CliError> {
    Ok(CoordinatorScope {
        host: host_scope(host_id),
        run_id: require("run", args.run.clone())?,
        coordinator_id: require("coordinator-id", args.coordinator_id.clone())?,
        consumer_generation: match args.consumer_generation {
            Some(value) => value,
            None => {
                return Err(usage("--consumer-generation is required for this command"));
            }
        },
    })
}

/// Worker dispatch scope: explicit flags first, scoped hints fill gaps,
/// mismatch refuses, and hints never grant authority.
fn dispatch_scope(
    host_id: &str,
    args: &crate::orchestration_cli::DispatchScope,
) -> Result<drogon_protocol::orchestration_scope::DispatchScope, CliError> {
    Ok(drogon_protocol::orchestration_scope::DispatchScope {
        host: host_scope(host_id),
        run_id: require("run", agree("run", "DROGON_RUN_ID", args.run.as_deref())?)?,
        task_id: require(
            "task",
            agree("task", "DROGON_TASK_ID", args.task.as_deref())?,
        )?,
        dispatch_id: require(
            "dispatch",
            agree("dispatch", "DROGON_DISPATCH_ID", args.dispatch.as_deref())?,
        )?,
    })
}

/// Actor selection follows the scoped credential presence, never the
/// availability of an admin token file.
fn mail_scope(host_id: &str, actor: &ActorScopeArgs) -> Result<ActorScope, CliError> {
    if credential::dispatch_credential_present() {
        Ok(ActorScope::Dispatch(dispatch_scope(
            host_id,
            &actor.dispatch(),
        )?))
    } else {
        Ok(ActorScope::Coordinator(coordinator_scope_from_optional(
            host_id,
            &actor.coordinator(),
        )?))
    }
}

fn parse_target(value: &str) -> Result<SendTarget, CliError> {
    if value == "run-home" {
        return Ok(SendTarget::RunHome);
    }
    if let Some(id) = value.strip_prefix("dispatch:") {
        return Ok(SendTarget::Dispatch {
            dispatch_id: id.to_string(),
        });
    }
    if let Some(name) = value.strip_prefix("group:") {
        return Ok(SendTarget::Group {
            name: name.to_string(),
        });
    }
    Err(usage(
        "--to must be run-home, dispatch:<ID> or group:<NAME>",
    ))
}

fn parse_message_kind(name: &str) -> Option<MessageKind> {
    match name.trim() {
        "status" => Some(MessageKind::Status),
        "question" => Some(MessageKind::Question),
        "answer" => Some(MessageKind::Answer),
        "heartbeat" => Some(MessageKind::Heartbeat),
        "final-report" | "finalReport" => Some(MessageKind::FinalReport),
        "guidance" => Some(MessageKind::Guidance),
        "escalation" => Some(MessageKind::Escalation),
        _ => None,
    }
}

fn parse_kinds(value: &str) -> Result<Vec<MessageKind>, CliError> {
    value
        .split(',')
        .filter(|part| !part.trim().is_empty())
        .map(|part| {
            parse_message_kind(part).ok_or_else(|| usage(format!("unknown message kind {part:?}")))
        })
        .collect()
}

fn parse_json_object(flag: &str, value: &Option<String>) -> Result<Option<Value>, CliError> {
    match value {
        None => Ok(None),
        Some(text) => {
            let parsed: Value = serde_json::from_str(text)
                .map_err(|err| usage(format!("--{flag} is not valid JSON: {err}")))?;
            if !parsed.is_object() {
                return Err(usage(format!("--{flag} must be a JSON object")));
            }
            Ok(Some(parsed))
        }
    }
}

fn wait_policy(timeout_ms: Option<u32>) -> Result<WaitPolicy, CliError> {
    let timeout_ms = timeout_ms.ok_or_else(|| usage("--timeout-ms is required with --wait"))?;
    let policy = WaitPolicy { timeout_ms };
    policy
        .validate()
        .map_err(|err| usage(format!("--timeout-ms: {}", err.message)))?;
    Ok(policy)
}

/// Transport timeout: the configured wait budget plus a small bounded margin
/// (never the default, never indefinite).
fn call_timeout(wait: Option<&WaitPolicy>) -> Duration {
    match wait {
        Some(policy) => {
            Duration::from_millis(u64::from(policy.timeout_ms) + WAIT_TRANSPORT_MARGIN_MS)
        }
        None => DEFAULT_TIMEOUT,
    }
}

fn validate_params<T: serde::Serialize>(
    params: &T,
    validate: impl FnOnce(&T) -> Result<(), RpcError>,
    request_id: &str,
) -> Result<Value, CliError> {
    // Why usage (exit 2): the CLI constructed these params entirely from
    // local input, so a shape violation is a bad invocation, not an
    // operation failure; nothing reached the wire.
    let _ = request_id;
    validate(params)
        .map_err(|err| usage(format!("invalid orchestration arguments: {}", err.message)))?;
    serde_json::to_value(params).map_err(|err| {
        CliError::local(
            internal_error(format!("cannot encode orchestration params: {err}")),
            request_id,
        )
    })
}

fn emit(
    call: CallOk,
    json: bool,
    human: impl FnOnce() -> String,
    exit_code: u8,
) -> Result<RunOutcome, CliError> {
    if json {
        let stdout = serde_json::to_string_pretty(&call.raw).map_err(|err| {
            CliError::local(
                internal_error(format!("cannot encode response: {err}")),
                call.request_id.clone(),
            )
        })?;
        Ok(RunOutcome {
            stdout,
            exit_code,
            stderr_note: None,
        })
    } else {
        Ok(RunOutcome {
            stdout: human(),
            exit_code,
            stderr_note: None,
        })
    }
}

/// Shared invariant checks for run summaries on any run method result.
fn check_run(run: &RunSummary) -> Result<(), String> {
    drogon_protocol::orchestration_common::validate_short_label(&run.run_id)
        .map_err(|e| e.message)?;
    drogon_protocol::orchestration_common::validate_short_label(&run.coordinator_id)
        .map_err(|e| e.message)?;
    // Protocol-owned fence bounds: positive and within the JS-exact cap.
    drogon_protocol::orchestration_common::validate_consumer_generation(run.consumer_generation)
        .map_err(|e| e.message)?;
    Ok(())
}

/// Honest human suffix: engine warnings and residual resource identities are
/// always surfaced, never silently dropped.
fn human_extras(
    warning: &Option<String>,
    residuals: &[drogon_protocol::orchestration_common::ResidualResource],
) -> String {
    let mut text = String::new();
    if let Some(warning) = warning {
        text.push_str(&format!("\nwarning: {warning}"));
    }
    for resource in residuals {
        text.push_str(&format!(
            "\nresidual {} {} ({}: {})",
            wire_resource_kind(resource.kind),
            resource.resource_id,
            wire_action(resource.action),
            wire_disposition(resource.disposition)
        ));
    }
    text
}

fn validate_returned_cursor(cursor: &Option<OpaqueCursor>) -> Result<(), String> {
    if let Some(cursor) = cursor {
        cursor.validate().map_err(|e| e.message)?;
    }
    Ok(())
}

fn check_task_id(task_id: &str) -> Result<(), String> {
    drogon_protocol::orchestration_common::validate_short_label(task_id).map_err(|e| e.message)
}

fn check_dispatch_id(dispatch_id: &str) -> Result<(), String> {
    drogon_protocol::orchestration_common::validate_short_label(dispatch_id).map_err(|e| e.message)
}

/// Entry point dispatched from `commands::run`.
pub async fn run(
    client: &Client,
    request_id: &str,
    json: bool,
    command: &OrchestrationCommand,
) -> Result<RunOutcome, CliError> {
    let status = capability_preflight(client, request_id).await?;
    let explicit_host = match command {
        OrchestrationCommand::RunCreate { host, .. }
        | OrchestrationCommand::RunList { host, .. }
        | OrchestrationCommand::RunShow { host, .. }
        | OrchestrationCommand::RunUse { host, .. }
        | OrchestrationCommand::TaskCreate { host, .. }
        | OrchestrationCommand::TaskList { host, .. }
        | OrchestrationCommand::TaskShow { host, .. }
        | OrchestrationCommand::WorkerStart { host, .. }
        | OrchestrationCommand::WorkerShow { host, .. }
        | OrchestrationCommand::WorkerRead { host, .. }
        | OrchestrationCommand::WorkerStop { host, .. }
        | OrchestrationCommand::WorkerAbandon { host, .. }
        | OrchestrationCommand::WorkerRelease { host, .. }
        | OrchestrationCommand::Send { host, .. }
        | OrchestrationCommand::Check { host, .. }
        | OrchestrationCommand::Reply { host, .. }
        | OrchestrationCommand::Ask { host, .. }
        | OrchestrationCommand::RequestShow { host, .. } => host.host.as_deref(),
    };
    let host_id = resolve_host(explicit_host, &status.host_id, request_id)?;

    match command {
        OrchestrationCommand::RunCreate {
            objective,
            coordinator_id,
            ..
        } => {
            let coordinator_id = coordinator_id.clone().unwrap_or_else(|| {
                // The actor namespace must survive a retry of the same operation.
                let identity =
                    serde_json::json!(["drogon.run-create.actor.v1", host_id, request_id]);
                format!(
                    "coord-{:x}",
                    Sha256::digest(identity.to_string().as_bytes())
                )
            });
            let params = RunCreateParams {
                host: host_scope(&host_id),
                objective: objective.clone(),
                coordinator_id: coordinator_id.clone(),
            };
            let value = validate_params(&params, |p| p.validate_shape(&host_id), request_id)?;
            let call = client
                .call(
                    "orchestration.runCreate",
                    value,
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let result: RunCreateResult =
                Client::decode_checked(&call, "orchestration.runCreate", |r: &RunCreateResult| {
                    check_run(&r.run)?;
                    if r.run.coordinator_id != coordinator_id {
                        return Err("run-create response names a different coordinator".into());
                    }
                    if r.run.objective != *objective {
                        return Err("run-create response carries a different objective".into());
                    }
                    if r.run.consumer_generation != 1 {
                        return Err("run-create must start at generation 1".into());
                    }
                    Ok(())
                })?;
            emit(
                call,
                json,
                || {
                    format!(
                        "Run {} bound to coordinator {} (generation {})",
                        result.run.run_id,
                        result.run.coordinator_id,
                        result.run.consumer_generation
                    )
                },
                0,
            )
        }
        OrchestrationCommand::RunList { limit, cursor, .. } => {
            let params = RunListParams {
                host: host_scope(&host_id),
                limit: Some(
                    limit.unwrap_or(drogon_protocol::orchestration_common::DEFAULT_RUN_PAGE_LIMIT),
                ),
                cursor: cursor.clone().map(OpaqueCursor),
            };
            let value = validate_params(&params, |p| p.validate_shape(&host_id), request_id)?;
            let call = client
                .call("orchestration.runList", value, request_id, DEFAULT_TIMEOUT)
                .await?;
            let result: RunListResult =
                Client::decode_checked(&call, "orchestration.runList", |r: &RunListResult| {
                    for run in &r.runs {
                        check_run(run)?;
                    }
                    validate_returned_cursor(&r.next_cursor)
                })?;
            emit(
                call,
                json,
                || {
                    if result.runs.is_empty() {
                        return "No runs.".to_string();
                    }
                    let mut lines = Vec::new();
                    for run in &result.runs {
                        lines.push(format!(
                            "{} {} (coordinator {}, generation {})",
                            run.run_id, run.objective, run.coordinator_id, run.consumer_generation
                        ));
                    }
                    if let Some(cursor) = &result.next_cursor {
                        lines.push(format!("More runs: --cursor {}", cursor.0));
                    }
                    lines.join("\n")
                },
                0,
            )
        }
        OrchestrationCommand::RunShow { run, .. } => {
            let params = RunShowParams {
                host: host_scope(&host_id),
                run_id: run.clone(),
            };
            let value = validate_params(&params, |p| p.validate_shape(&host_id), request_id)?;
            let call = client
                .call("orchestration.runShow", value, request_id, DEFAULT_TIMEOUT)
                .await?;
            let result: RunShowResult =
                Client::decode_checked(&call, "orchestration.runShow", |r: &RunShowResult| {
                    check_run(&r.run)?;
                    if r.run.run_id != *run {
                        return Err(format!(
                            "run-show response names {:?}, not the requested {:?}",
                            r.run.run_id, run
                        ));
                    }
                    Ok(())
                })?;
            emit(
                call,
                json,
                || {
                    format!(
                        "Run {} {} (coordinator {}, generation {})",
                        result.run.run_id,
                        result.run.objective,
                        result.run.coordinator_id,
                        result.run.consumer_generation
                    )
                },
                0,
            )
        }
        OrchestrationCommand::RunUse {
            scope, takeover, ..
        } => {
            let params = RunUseParams {
                host: host_scope(&host_id),
                run_id: scope.run.clone(),
                coordinator_id: scope.coordinator_id.clone(),
                consumer_generation: scope.consumer_generation,
                takeover: *takeover,
            };
            let value = validate_params(&params, |p| p.validate_shape(&host_id), request_id)?;
            let call = client
                .call("orchestration.runUse", value, request_id, DEFAULT_TIMEOUT)
                .await?;
            let result: RunUseResult =
                Client::decode_checked(&call, "orchestration.runUse", |r: &RunUseResult| {
                    check_run(&r.run)?;
                    if r.run.run_id != scope.run {
                        return Err(format!(
                            "run-use response names {:?}, not the requested {:?}",
                            r.run.run_id, scope.run
                        ));
                    }
                    let expected_generation = scope
                        .consumer_generation
                        .checked_add(u64::from(*takeover))
                        .ok_or("run-use generation overflow")?;
                    if r.run.coordinator_id != scope.coordinator_id
                        || r.run.consumer_generation != expected_generation
                    {
                        return Err("run-use response does not match the requested binding".into());
                    }
                    Ok(())
                })?;
            emit(
                call,
                json,
                || {
                    format!(
                        "Bound to run {} as coordinator {} (generation {})",
                        result.run.run_id,
                        result.run.coordinator_id,
                        result.run.consumer_generation
                    )
                },
                0,
            )
        }
        OrchestrationCommand::TaskCreate {
            scope,
            instructions,
            title,
            depends_on,
            parent,
            display_name,
            ..
        } => {
            let spec = TaskSpec {
                title: title.clone(),
                instructions: instructions.clone(),
                depends_on: match depends_on {
                    Some(list) => list.split(',').map(str::to_string).collect(),
                    None => Vec::new(),
                },
                parent: parent.clone(),
                display_name: display_name.clone(),
                metadata: None,
            };
            let params = TaskCreateParams {
                scope: coordinator_scope(&host_id, scope),
                spec,
            };
            let value = validate_params(&params, |p| p.validate_shape(&host_id), request_id)?;
            let call = client
                .call(
                    "orchestration.taskCreate",
                    value,
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let result: TaskCreateResult = Client::decode_checked(
                &call,
                "orchestration.taskCreate",
                |r: &TaskCreateResult| {
                    check_task_id(&r.task.task_id)?;
                    if r.task.run_id != scope.run {
                        return Err("task-create response names a different run".into());
                    }
                    Ok(())
                },
            )?;
            emit(
                call,
                json,
                || {
                    format!(
                        "Task {} ({})",
                        result.task.task_id,
                        wire_task_status(result.task.status)
                    )
                },
                0,
            )
        }
        OrchestrationCommand::TaskList {
            scope,
            brief,
            ready,
            status,
            limit,
            cursor,
            ..
        } => {
            let params = TaskListParams {
                scope: coordinator_scope(&host_id, scope),
                brief: *brief,
                ready: *ready,
                status: status.map(wire_status_arg),
                limit: *limit,
                cursor: cursor.clone().map(OpaqueCursor),
            };
            let value = validate_params(&params, |p| p.validate_shape(&host_id), request_id)?;
            let call = client
                .call("orchestration.taskList", value, request_id, DEFAULT_TIMEOUT)
                .await?;
            let result: TaskListResult =
                Client::decode_checked(&call, "orchestration.taskList", |r: &TaskListResult| {
                    for task in &r.tasks {
                        check_task_id(&task.task_id)?;
                    }
                    validate_returned_cursor(&r.next_cursor)
                })?;
            emit(
                call,
                json,
                || {
                    if result.tasks.is_empty() {
                        return "No tasks.".to_string();
                    }
                    let mut lines = Vec::new();
                    for task in &result.tasks {
                        let title = task.title.clone().unwrap_or_else(|| task.spec.clone());
                        let truncated = if task.spec_truncated { "…" } else { "" };
                        lines.push(format!(
                            "{} [{}] {}{}",
                            task.task_id,
                            wire_task_status(task.status),
                            title,
                            truncated
                        ));
                    }
                    if let Some(cursor) = &result.next_cursor {
                        lines.push(format!("More tasks: --cursor {}", cursor.0));
                    }
                    lines.join("\n")
                },
                0,
            )
        }
        OrchestrationCommand::TaskShow { scope, task, .. } => {
            let params = TaskShowParams {
                scope: coordinator_scope(&host_id, scope),
                task_id: task.clone(),
            };
            let value = validate_params(&params, |p| p.validate_shape(&host_id), request_id)?;
            let call = client
                .call("orchestration.taskShow", value, request_id, DEFAULT_TIMEOUT)
                .await?;
            let result: TaskShowResult =
                Client::decode_checked(&call, "orchestration.taskShow", |r: &TaskShowResult| {
                    check_task_id(&r.task.task_id)?;
                    if r.task.task_id != *task || r.task.run_id != scope.run {
                        return Err(
                            "task-show response does not match the requested task scope".into()
                        );
                    }
                    Ok(())
                })?;
            emit(
                call,
                json,
                || {
                    format!(
                        "Task {} [{}] depends on {:?}; {} attempt(s) recorded\nspec: {}",
                        result.task.task_id,
                        wire_task_status(result.task.status),
                        result.task.depends_on,
                        result.attempts.len(),
                        result.spec.instructions
                    )
                },
                0,
            )
        }
        OrchestrationCommand::WorkerStart {
            scope,
            task,
            workspace,
            harness,
            model,
            effort,
            provider,
            permission_mode,
            reuse_session,
            reuse_incarnation,
            display_name,
            comment,
            timeout_ms,
            retry_of,
            ..
        } => {
            // Reuse execution must not carry fresh launch preferences: they
            // would be silently discarded, not applied. (Pre-connection
            // validation already refused these; kept as defense in depth.)
            if reuse_session.is_some()
                && (harness.is_some()
                    || model.is_some()
                    || effort.is_some()
                    || provider.is_some()
                    || permission_mode.is_some())
            {
                return Err(usage(
                    "--reuse-session rejects fresh launch preferences (--harness/--model/--effort/--provider/--permission-mode)",
                ));
            }
            if effort.is_some() && model.is_none() {
                return Err(usage("--effort requires --model"));
            }
            let execution = match (harness, reuse_session) {
                (Some(harness), None) => {
                    if reuse_incarnation.is_some() {
                        return Err(usage(
                            "--reuse-incarnation requires --reuse-session and cannot be combined with --harness",
                        ));
                    }
                    WorkerExecution::Fresh {
                        launch: LaunchPreferences {
                            harness_id: harness.clone(),
                            model: model.clone(),
                            effort: effort.clone(),
                            provider: provider.clone(),
                            permission_mode: match permission_mode {
                                Some(PermissionModeArg::Unattended) => {
                                    LaunchPermissionMode::Unattended
                                }
                                _ => LaunchPermissionMode::Inherit,
                            },
                        },
                    }
                }
                (None, Some(session)) => WorkerExecution::Reuse {
                    session_identity: SessionIdentity {
                        session_id: session.clone(),
                        incarnation: reuse_incarnation.clone().ok_or_else(|| {
                            usage("--reuse-incarnation is required with --reuse-session")
                        })?,
                    },
                },
                (Some(_), Some(_)) => {
                    return Err(usage(
                        "--harness and --reuse-session are mutually exclusive execution modes",
                    ));
                }
                (None, None) => {
                    return Err(usage(
                        "worker-start needs --harness (fresh launch) or --reuse-session/--reuse-incarnation (explicit reuse)",
                    ));
                }
            };
            let requested_reuse_check = match &execution {
                WorkerExecution::Reuse { session_identity } => Some(session_identity.clone()),
                _ => None,
            };
            let params = WorkerStartParams {
                scope: coordinator_scope(&host_id, scope),
                task_id: task.clone(),
                placement: WorkerPlacement {
                    workspace_id: workspace.clone(),
                },
                execution,
                display_name: display_name.clone(),
                comment: comment.clone(),
                timeout_ms: *timeout_ms,
                retry_of: retry_of.clone(),
            };
            let value = validate_params(&params, |p| p.validate_shape(&host_id), request_id)?;
            let call = client
                .call(
                    "orchestration.workerStart",
                    value,
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let requested_workspace = workspace.clone();
            let requested_scope = (scope.run.clone(), scope.consumer_generation);
            let result: WorkerStartResult = Client::decode_checked(
                &call,
                "orchestration.workerStart",
                |r: &WorkerStartResult| {
                    check_task_id(&r.task_id)?;
                    check_dispatch_id(&r.dispatch_id)?;
                    if r.task_id != *task
                        || r.run_id != requested_scope.0
                        || r.consumer_generation != requested_scope.1
                    {
                        return Err(
                            "worker start response does not match the requested task scope".into(),
                        );
                    }
                    if r.workspace_id != requested_workspace {
                        return Err(format!(
                            "workspaceId {:?} does not match the requested workspace {:?}",
                            r.workspace_id, requested_workspace
                        ));
                    }
                    if let Some(identity) = &requested_reuse_check
                        && r.session_identity.as_ref() != Some(identity)
                    {
                        return Err(
                            "worker start response does not match the requested session reuse"
                                .into(),
                        );
                    }
                    Ok(())
                },
            )?;
            let human = || {
                let mut text = format!(
                    "Dispatch {} for task {} ({}; readiness {}; process {})",
                    result.dispatch_id,
                    result.task_id,
                    wire_assignment(result.assignment_state),
                    wire_readiness(result.readiness),
                    wire_verdict(result.process_verdict)
                );
                if let Some(failure) = &result.failure {
                    text.push_str(&format!(
                        "\nfailure: {} at {}: {}",
                        failure.code, failure.stage, failure.message
                    ));
                }
                text.push_str(&human_extras(&result.warning, &result.residual_resources));
                text
            };
            // Why: a fast authenticated final report can settle the attempt
            // before launch finalization, so Completed is a success too.
            // Readiness and outcome come from the result only — they are
            // never inferred from the process verdict — and Failed/Stopped/
            // Abandoned/Admitting stay non-success.
            let success = matches!(
                result.assignment_state,
                drogon_protocol::orchestration_common::AssignmentState::Ready
                    | drogon_protocol::orchestration_common::AssignmentState::Completed
            );
            emit(call, json, human, u8::from(!success))
        }
        OrchestrationCommand::WorkerShow {
            scope, dispatch, ..
        } => {
            let params = WorkerShowParams {
                scope: coordinator_scope(&host_id, scope),
                dispatch_id: dispatch.clone(),
            };
            let value = validate_params(&params, |p| p.validate_shape(&host_id), request_id)?;
            let call = client
                .call(
                    "orchestration.workerShow",
                    value,
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let result: WorkerShowResult = Client::decode_checked(
                &call,
                "orchestration.workerShow",
                |r: &WorkerShowResult| {
                    r.validate_shape().map_err(|e| e.message)?;
                    if r.dispatch_id != *dispatch {
                        return Err(
                            "worker show response does not match the requested dispatch".into()
                        );
                    }
                    Ok(())
                },
            )?;
            emit(
                call,
                json,
                || {
                    let outcome = result
                        .outcome
                        .map(|o| match o {
                            ReportOutcome::Succeeded => "succeeded",
                            ReportOutcome::Failed => "failed",
                        })
                        .unwrap_or("none");
                    let mut text = format!(
                        "Dispatch {} ({}; readiness {}; process {}; outcome {})",
                        result.dispatch_id,
                        wire_assignment(result.assignment_state),
                        wire_readiness(result.readiness),
                        wire_verdict(result.process_verdict),
                        outcome
                    );
                    if let Some(failure) = &result.failure {
                        text.push_str(&format!(
                            "\nfailure: {} at {}: {}",
                            failure.code, failure.stage, failure.message
                        ));
                    }
                    text.push_str(&human_extras(&result.warning, &result.residual_resources));
                    text
                },
                0,
            )
        }
        OrchestrationCommand::WorkerRead {
            scope,
            dispatch,
            cursor,
            limit,
            source,
            ..
        } => {
            let params = WorkerReadParams {
                scope: coordinator_scope(&host_id, scope),
                dispatch_id: dispatch.clone(),
                cursor: cursor.clone().map(OpaqueCursor),
                limit: *limit,
                source: match source {
                    OutputSourceArg::Auto => OutputSource::Auto,
                    OutputSourceArg::Terminal => OutputSource::Terminal,
                    OutputSourceArg::Transcript => OutputSource::Transcript,
                },
            };
            let value = validate_params(&params, |p| p.validate_shape(&host_id), request_id)?;
            let call = client
                .call(
                    "orchestration.workerRead",
                    value,
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let result: WorkerReadResult = Client::decode_checked(
                &call,
                "orchestration.workerRead",
                |r: &WorkerReadResult| {
                    if r.dispatch_id != *dispatch {
                        return Err(
                            "worker read response does not match the requested dispatch".into()
                        );
                    }
                    validate_returned_cursor(&r.next_cursor)?;
                    for entry in &r.entries {
                        drogon_protocol::orchestration_common::validate_short_label(
                            &entry.source_identity,
                        )
                        .map_err(|e| e.message)?;
                        crate::orchestration_output::terminal_bytes(r.source, entry)?;
                    }
                    Ok(())
                },
            )?;
            emit(
                call,
                json,
                || {
                    let mut output = format!(
                        "{} entr(y/ies) from {} (process {}); more: {}",
                        result.entries.len(),
                        wire_source(result.source),
                        wire_verdict(result.process_verdict),
                        result
                            .next_cursor
                            .as_ref()
                            .map(|c| format!("--cursor {}", c.0))
                            .unwrap_or_else(|| "none".to_string())
                    );
                    for entry in &result.entries {
                        output.push('\n');
                        output.push_str(&crate::orchestration_output::render(result.source, entry));
                    }
                    output
                },
                0,
            )
        }
        OrchestrationCommand::WorkerStop {
            scope, dispatch, ..
        } => {
            let params = WorkerStopParams {
                scope: coordinator_scope(&host_id, scope),
                dispatch_id: dispatch.clone(),
            };
            let value = validate_params(&params, |p| p.validate_shape(&host_id), request_id)?;
            let call = client
                .call(
                    "orchestration.workerStop",
                    value,
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let result: WorkerStopResult = Client::decode_checked(
                &call,
                "orchestration.workerStop",
                |r: &WorkerStopResult| {
                    check_dispatch_id(&r.dispatch_id)?;
                    if r.dispatch_id != *dispatch {
                        return Err(
                            "worker stop response does not match the requested dispatch".into()
                        );
                    }
                    Ok(())
                },
            )?;
            // An unverifiable process action is an honestly uncertain
            // operation, never a claimed success.
            let exit_code = u8::from(result.process_action == ProcessAction::Unverifiable);
            emit(
                call,
                json,
                || {
                    let mut text = format!(
                        "Dispatch {}: assignment {}; process action {} (verdict {})",
                        result.dispatch_id,
                        wire_assignment(result.assignment_state),
                        wire_process_action(result.process_action),
                        wire_verdict(result.process_verdict)
                    );
                    text.push_str(&human_extras(&result.warning, &result.residual_resources));
                    text
                },
                exit_code,
            )
        }
        OrchestrationCommand::WorkerAbandon {
            scope,
            dispatch,
            reason,
            ..
        } => {
            let params = WorkerAbandonParams {
                scope: coordinator_scope(&host_id, scope),
                dispatch_id: dispatch.clone(),
                reason: reason.clone(),
            };
            let value = validate_params(&params, |p| p.validate_shape(&host_id), request_id)?;
            let call = client
                .call(
                    "orchestration.workerAbandon",
                    value,
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let result: WorkerAbandonResult = Client::decode_checked(
                &call,
                "orchestration.workerAbandon",
                |r: &WorkerAbandonResult| {
                    check_dispatch_id(&r.dispatch_id)?;
                    if r.dispatch_id != *dispatch {
                        return Err(
                            "worker abandon response does not match the requested dispatch".into(),
                        );
                    }
                    Ok(())
                },
            )?;
            emit(
                call,
                json,
                || {
                    let mut text = format!(
                        "Dispatch {} abandoned (no signal; {})",
                        result.dispatch_id,
                        wire_assignment(result.assignment_state)
                    );
                    text.push_str(&human_extras(&None, &result.residual_resources));
                    text
                },
                0,
            )
        }
        OrchestrationCommand::WorkerRelease {
            scope, dispatch, ..
        } => {
            let params = WorkerReleaseParams {
                scope: coordinator_scope(&host_id, scope),
                dispatch_id: dispatch.clone(),
            };
            let value = validate_params(&params, |p| p.validate_shape(&host_id), request_id)?;
            let call = client
                .call(
                    "orchestration.workerRelease",
                    value,
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let result: WorkerReleaseResult = Client::decode_checked(
                &call,
                "orchestration.workerRelease",
                |r: &WorkerReleaseResult| {
                    check_dispatch_id(&r.dispatch_id)?;
                    if r.dispatch_id != *dispatch {
                        return Err(
                            "worker release response does not match the requested dispatch".into(),
                        );
                    }
                    Ok(())
                },
            )?;
            // Intentional retained/no-owned-resource releases succeed; an
            // unverifiable disposition is an honestly uncertain operation.
            let exit_code = u8::from(
                result.disposition
                    == drogon_protocol::orchestration_common::ResourceDisposition::Unverifiable,
            );
            emit(
                call,
                json,
                || {
                    let mut text = format!(
                        "Dispatch {}: {} (process {})",
                        result.dispatch_id,
                        wire_disposition(result.disposition),
                        wire_verdict(result.process_verdict)
                    );
                    text.push_str(&human_extras(&None, &result.residual_resources));
                    text
                },
                exit_code,
            )
        }
        OrchestrationCommand::Send {
            actor,
            kind,
            subject,
            to,
            body,
            payload,
            thread_id,
            outcome,
            result: result_meta,
            ..
        } => {
            if result_meta.is_some() && *kind != MessageKindArg::FinalReport {
                return Err(usage("--result is only valid with --kind final-report"));
            }
            let final_report = match (kind, outcome) {
                (MessageKindArg::FinalReport, Some(outcome)) => Some(FinalReport {
                    outcome: match outcome {
                        OutcomeArg::Succeeded => ReportOutcome::Succeeded,
                        OutcomeArg::Failed => ReportOutcome::Failed,
                    },
                    result: parse_json_object("result", result_meta)?,
                }),
                (MessageKindArg::FinalReport, None) => {
                    return Err(usage("--outcome is required for --kind final-report"));
                }
                (_, Some(_)) => {
                    return Err(usage("--outcome is only valid with --kind final-report"));
                }
                _ => None,
            };
            let target = match to.as_deref() {
                Some(value) => Some(parse_target(value)?),
                None => None,
            };
            let kind_value = match kind {
                MessageKindArg::Status => MessageKind::Status,
                MessageKindArg::Question => MessageKind::Question,
                MessageKindArg::Answer => MessageKind::Answer,
                MessageKindArg::Heartbeat => MessageKind::Heartbeat,
                MessageKindArg::FinalReport => MessageKind::FinalReport,
                MessageKindArg::Guidance => MessageKind::Guidance,
                MessageKindArg::Escalation => MessageKind::Escalation,
            };
            // Client-side lifecycle addressing refusal (usage error, exit 2).
            if matches!(
                kind_value,
                MessageKind::Heartbeat | MessageKind::FinalReport
            ) {
                match &target {
                    None | Some(SendTarget::RunHome) => {}
                    Some(_) => {
                        return Err(usage(
                            "lifecycle kinds (heartbeat, final-report) target only run-home",
                        ));
                    }
                }
            }
            let params = SendParams {
                scope: mail_scope(&host_id, actor)?,
                kind: kind_value,
                to: target,
                subject: subject.clone(),
                body: body.clone(),
                payload: parse_json_object("payload", payload)?,
                thread_id: thread_id.clone(),
                final_report,
            };
            let value = validate_params(&params, |p| p.validate_shape(&host_id), request_id)?;
            let call = client
                .call("orchestration.send", value, request_id, DEFAULT_TIMEOUT)
                .await?;
            let result: SendResult =
                Client::decode_checked(&call, "orchestration.send", |r: &SendResult| {
                    r.validate_shape().map_err(|e| e.message)
                })?;
            // A negative lifecycle verdict is a failed invocation: the
            // envelope still prints, but the caller must see exit 1.
            let exit_code = match &result.lifecycle {
                Some(LifecycleVerdict::Rejected { .. }) | Some(LifecycleVerdict::Failed) => 1,
                _ => 0,
            };
            emit(
                call,
                json,
                || match (&result.message, &result.batch) {
                    (Some(message), _) => format!("Sent {}", message.message_id),
                    (_, Some(batch)) => format!(
                        "Sent {} message(s) to {} recipient(s)",
                        batch.messages.len(),
                        batch.recipients
                    ),
                    _ => "Sent".to_string(),
                },
                exit_code,
            )
        }
        OrchestrationCommand::Check {
            actor,
            peek,
            all,
            ack,
            wait,
            timeout_ms,
            kinds,
            inject,
            cursor,
            limit,
            ..
        } => {
            let mode = match (peek, all, ack) {
                (false, false, None) => CheckMode::Unread { acknowledge: None },
                (false, false, Some(delivery_id)) => CheckMode::Unread {
                    acknowledge: Some(delivery_id.clone()),
                },
                (true, false, None) => CheckMode::Peek,
                (false, true, None) => CheckMode::All,
                _ => {
                    return Err(usage(
                        "--peek, --all and --ack are mutually exclusive read modes",
                    ));
                }
            };
            if !mode.allows_wait() && *wait {
                return Err(usage("--wait is only valid in unread mode"));
            }
            if !*wait && timeout_ms.is_some() {
                return Err(usage("--timeout-ms is only valid with --wait"));
            }
            let policy = if *wait {
                Some(wait_policy(*timeout_ms)?)
            } else {
                None
            };
            let requested_ack = match &mode {
                CheckMode::Unread {
                    acknowledge: Some(delivery_id),
                } => Some(delivery_id.clone()),
                _ => None,
            };
            let inspection = !mode.allows_wait();
            let params = CheckParams {
                scope: mail_scope(&host_id, actor)?,
                // Inspection-only pagination (peek/all); consuming reads
                // never carry these (refused in validate_actor_flags).
                cursor: cursor.clone().map(OpaqueCursor),
                limit: *limit,
                mode,
                wait: policy,
                kinds: match kinds {
                    Some(list) => parse_kinds(list)?,
                    None => Vec::new(),
                },
                inject: *inject,
            };
            let value = validate_params(
                &params,
                |p: &CheckParams| p.validate_shape(&host_id),
                request_id,
            )?;
            let call = client
                .call(
                    "orchestration.check",
                    value,
                    request_id,
                    call_timeout(policy.as_ref()),
                )
                .await?;
            let result: CheckResult =
                Client::decode_checked(&call, "orchestration.check", |r: &CheckResult| {
                    r.validate_shape().map_err(|e| e.message)?;
                    validate_returned_cursor(&r.next_cursor)?;
                    // Why: an inspection must never carry delivery ownership,
                    // and a consuming read must echo exactly the delivery the
                    // caller asked to acknowledge.
                    if inspection && (r.delivery.is_some() || r.acknowledged.is_some()) {
                        return Err("peek/all results cannot claim delivery ownership".into());
                    }
                    if let Some(acknowledged) = &r.acknowledged
                        && let Some(requested) = &requested_ack
                        && acknowledged.delivery_id != *requested
                    {
                        return Err(format!(
                            "acknowledged receipt names {:?}, not the requested {:?}",
                            acknowledged.delivery_id, requested
                        ));
                    }
                    Ok(())
                })?;
            let mut outcome = emit(
                call,
                json,
                || {
                    let mut lines = Vec::new();
                    if let Some(acknowledged) = &result.acknowledged {
                        lines.push(format!(
                            "Acknowledged delivery {} ({} message(s))",
                            acknowledged.delivery_id,
                            acknowledged.message_ids.len()
                        ));
                    }
                    if result.timed_out {
                        lines.push("No messages within the wait budget.".to_string());
                    }
                    if let Some(delivery) = &result.delivery {
                        lines.push(format!(
                            "Delivery {} holds {} message(s); ack with --ack {}",
                            delivery.delivery_id,
                            delivery.message_ids.len(),
                            delivery.delivery_id
                        ));
                    }
                    for message in &result.messages {
                        lines.push(format!(
                            "{} [{}] {}: {}",
                            message.message_id,
                            wire_message_kind(message.kind),
                            message.from_actor,
                            message.subject
                        ));
                        if let Some(body) = &message.body {
                            lines.push(body.clone());
                        }
                    }
                    if let Some(cursor) = &result.next_cursor {
                        lines.push(format!("More: --cursor {}", cursor.0));
                    }
                    if lines.is_empty() {
                        lines.push("No messages.".to_string());
                    }
                    lines.join("\n")
                },
                // Why: a waiting read that ended without a delivery is an
                // honestly unfinished observation, never a success.
                u8::from(*wait && (result.timed_out || result.cancelled)),
            )?;
            if !json && *wait && (result.timed_out || result.cancelled) {
                outcome.stderr_note = Some(if result.cancelled {
                    "warning: check wait was interrupted (cancelled)".to_string()
                } else {
                    "warning: no messages within the wait budget".to_string()
                });
            }
            Ok(outcome)
        }
        OrchestrationCommand::Reply {
            actor,
            question,
            body,
            thread_id,
            ..
        } => {
            let params = ReplyParams {
                scope: mail_scope(&host_id, actor)?,
                question_message_id: question.clone(),
                body: body.clone(),
                thread_id: thread_id.clone(),
            };
            let value = validate_params(&params, |p| p.validate_shape(&host_id), request_id)?;
            let call = client
                .call("orchestration.reply", value, request_id, DEFAULT_TIMEOUT)
                .await?;
            let result: ReplyResult =
                Client::decode_checked(&call, "orchestration.reply", |r: &ReplyResult| {
                    check_dispatch_id(&r.message.message_id)?;
                    if r.question_message_id != *question {
                        return Err("reply response does not name the requested question".into());
                    }
                    Ok(())
                })?;
            emit(
                call,
                json,
                || {
                    format!(
                        "Replied {} to question {}",
                        result.message.message_id, result.question_message_id
                    )
                },
                0,
            )
        }
        OrchestrationCommand::Ask {
            actor,
            question,
            option,
            to,
            resume,
            timeout_ms,
            ..
        } => {
            let intent = match (question, resume) {
                (Some(question), None) => AskIntent::New {
                    question: question.clone(),
                    options: option.clone(),
                },
                (None, Some(message_id)) => {
                    if !option.is_empty() {
                        return Err(usage("--option is only valid when asking a new question"));
                    }
                    if to.is_some() {
                        return Err(usage("--to is only valid when asking a new question"));
                    }
                    AskIntent::Resume {
                        question_message_id: message_id.clone(),
                    }
                }
                (Some(_), Some(_)) => {
                    return Err(usage("--question and --resume are mutually exclusive"));
                }
                (None, None) => return Err(usage("ask needs --question or --resume")),
            };
            let target = match to.as_deref() {
                Some(value) => Some(parse_target(value)?),
                None => None,
            };
            let policy = WaitPolicy {
                timeout_ms: *timeout_ms,
            };
            let params = AskParams {
                scope: mail_scope(&host_id, actor)?,
                intent: intent.clone(),
                to: target,
                wait: policy,
            };
            let requested_resume = match &intent {
                AskIntent::Resume {
                    question_message_id,
                } => Some(question_message_id.clone()),
                _ => None,
            };
            let value = validate_params(&params, |p| p.validate_shape(&host_id), request_id)?;
            let call = client
                .call(
                    "orchestration.ask",
                    value,
                    request_id,
                    call_timeout(Some(&policy)),
                )
                .await?;
            let result: AskResult =
                Client::decode_checked(&call, "orchestration.ask", |r: &AskResult| {
                    r.validate_shape().map_err(|e| e.message)?;
                    if let Some(resumed) = &requested_resume
                        && r.question_message_id != *resumed
                    {
                        return Err("ask response does not name the resumed question".into());
                    }
                    Ok(())
                })?;
            let exit_code = match result.wait {
                AskWaitOutcome::Answered => 0,
                AskWaitOutcome::Pending | AskWaitOutcome::Cancelled => 1,
            };
            let note = match result.wait {
                AskWaitOutcome::Pending => Some(format!(
                    "question {} stays pending; resume with --resume {}",
                    result.question_message_id, result.question_message_id
                )),
                AskWaitOutcome::Cancelled => Some(format!(
                    "question {} wait was interrupted",
                    result.question_message_id
                )),
                AskWaitOutcome::Answered => None,
            };
            if json {
                let stdout = serde_json::to_string_pretty(&call.raw).map_err(|err| {
                    CliError::local(
                        internal_error(format!("cannot encode response: {err}")),
                        call.request_id.clone(),
                    )
                })?;
                Ok(RunOutcome {
                    stdout,
                    exit_code,
                    stderr_note: None,
                })
            } else {
                match &result.answer {
                    Some(answer) => Ok(RunOutcome {
                        stdout: answer.body.clone(),
                        exit_code,
                        stderr_note: None,
                    }),
                    None => Ok(RunOutcome {
                        stdout: String::new(),
                        exit_code,
                        stderr_note: note,
                    }),
                }
            }
        }
        OrchestrationCommand::RequestShow {
            request,
            scope,
            actor,
            bootstrap_coordinator_id,
            ..
        } => {
            let receipt_scope = match scope {
                ReceiptScopeArg::Bootstrap => ReceiptScope::Bootstrap(BootstrapScope {
                    host: host_scope(&host_id),
                    coordinator_id: require(
                        "coordinator-id",
                        bootstrap_coordinator_id
                            .clone()
                            .or_else(|| actor.coordinator_id.clone()),
                    )?,
                }),
                ReceiptScopeArg::Coordinator => ReceiptScope::Coordinator(
                    coordinator_scope_from_optional(&host_id, &actor.coordinator())?,
                ),
                ReceiptScopeArg::Dispatch => {
                    ReceiptScope::Dispatch(dispatch_scope(&host_id, &actor.dispatch())?)
                }
            };
            let params = RequestShowParams {
                scope: receipt_scope,
                request_id: request.clone(),
            };
            let value = validate_params(&params, |p| p.validate_shape(&host_id), request_id)?;
            let call = client
                .call(
                    "orchestration.requestShow",
                    value,
                    request_id,
                    DEFAULT_TIMEOUT,
                )
                .await?;
            let result: RequestShowResult = Client::decode_checked(
                &call,
                "orchestration.requestShow",
                |r: &RequestShowResult| {
                    // Absent stays honest: displayed, never an error.
                    drogon_protocol::orchestration_common::validate_request_id(&r.request_id)
                        .map_err(|e| e.message)?;
                    if r.request_id != *request {
                        return Err(
                            "request-show response does not name the requested receipt".into()
                        );
                    }
                    Ok(())
                },
            )?;
            emit(
                call,
                json,
                || {
                    let state = match result.state {
                        RequestLedgerState::Pending => "pending",
                        RequestLedgerState::Committed => "committed",
                        RequestLedgerState::Failed => "failed",
                        RequestLedgerState::Absent => {
                            "absent (no record; absence is not proof of no effects)"
                        }
                    };
                    format!(
                        "{} [{}] {}",
                        result.request_id, state, result.interpretation
                    )
                },
                0,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Rendering helpers: bounded, honest text summaries.
// ---------------------------------------------------------------------------

fn wire_status_arg(status: StatusArg) -> TaskStatus {
    match status {
        StatusArg::Pending => TaskStatus::Pending,
        StatusArg::Ready => TaskStatus::Ready,
        StatusArg::Dispatched => TaskStatus::Dispatched,
        StatusArg::Completed => TaskStatus::Completed,
        StatusArg::Failed => TaskStatus::Failed,
        StatusArg::Blocked => TaskStatus::Blocked,
    }
}

fn wire_task_status(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::Pending => "pending",
        TaskStatus::Ready => "ready",
        TaskStatus::Dispatched => "dispatched",
        TaskStatus::Completed => "completed",
        TaskStatus::Failed => "failed",
        TaskStatus::Blocked => "blocked",
    }
}

fn wire_message_kind(kind: MessageKind) -> &'static str {
    match kind {
        MessageKind::Status => "status",
        MessageKind::Question => "question",
        MessageKind::Answer => "answer",
        MessageKind::Heartbeat => "heartbeat",
        MessageKind::FinalReport => "final-report",
        MessageKind::Guidance => "guidance",
        MessageKind::Escalation => "escalation",
    }
}

fn wire_assignment(state: drogon_protocol::orchestration_common::AssignmentState) -> &'static str {
    use drogon_protocol::orchestration_common::AssignmentState::*;
    match state {
        Admitting => "admitting",
        Ready => "ready",
        Completed => "completed",
        Failed => "failed",
        Stopped => "stopped",
        Abandoned => "abandoned",
    }
}

fn wire_readiness(
    readiness: drogon_protocol::orchestration_common::ReadinessObservation,
) -> &'static str {
    use drogon_protocol::orchestration_common::ReadinessObservation::*;
    match readiness {
        NotObserved => "not observed",
        PromptObserved => "prompt observed",
        WorkerObserved => "worker observed",
    }
}

fn wire_verdict(verdict: drogon_protocol::orchestration_common::ProcessVerdict) -> &'static str {
    match verdict {
        drogon_protocol::orchestration_common::ProcessVerdict::Live => "live",
        drogon_protocol::orchestration_common::ProcessVerdict::Unverifiable => "unverifiable",
        drogon_protocol::orchestration_common::ProcessVerdict::Exited => "exited",
    }
}

fn wire_process_action(action: ProcessAction) -> &'static str {
    match action {
        ProcessAction::Signalled => "signalled",
        ProcessAction::None => "none",
        ProcessAction::Unverifiable => "unverifiable",
    }
}

fn wire_disposition(
    disposition: drogon_protocol::orchestration_common::ResourceDisposition,
) -> &'static str {
    use drogon_protocol::orchestration_common::ResourceDisposition::*;
    match disposition {
        Released => "released",
        Retained => "retained",
        NoOwnedResource => "no owned resource",
        Unverifiable => "unverifiable",
    }
}

fn wire_resource_kind(kind: drogon_protocol::orchestration_common::ResourceKind) -> &'static str {
    match kind {
        drogon_protocol::orchestration_common::ResourceKind::Workspace => "workspace",
        drogon_protocol::orchestration_common::ResourceKind::Session => "session",
    }
}

fn wire_action(action: drogon_protocol::orchestration_common::ResourceAction) -> &'static str {
    use drogon_protocol::orchestration_common::ResourceAction::*;
    match action {
        Created => "created",
        Reused => "reused",
        Retained => "retained",
        Released => "released",
    }
}

fn wire_source(source: OutputSource) -> &'static str {
    match source {
        OutputSource::Auto => "auto",
        OutputSource::Terminal => "terminal",
        OutputSource::Transcript => "transcript",
    }
}
