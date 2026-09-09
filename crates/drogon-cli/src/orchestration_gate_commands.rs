//! Decision gate CLI mapping after native capability and actor preflight.
use crate::client::Client;
use crate::commands::RunOutcome;
use crate::error::CliError;
use crate::orchestration_cli::OrchestrationCommand;
use crate::orchestration_commands::{coordinator_scope, emit, validate_params};
use crate::transport::DEFAULT_TIMEOUT;
use drogon_protocol::orchestration_common::validate_opaque_token;
use drogon_protocol::orchestration_gate::*;

fn check_gate(gate: &GateRecord, run: &str) -> Result<(), String> {
    validate_opaque_token(&gate.id, 128, "Invalid gate id.").map_err(|e| e.message)?;
    validate_opaque_token(&gate.task_id, 128, "Invalid gate task id.").map_err(|e| e.message)?;
    if gate.run_id != run {
        return Err("gate response names a different run".into());
    }
    serde_json::from_str::<Vec<String>>(&gate.options)
        .map_err(|_| "gate options are not a JSON string array".to_string())?;
    Ok(())
}
pub(crate) async fn run(
    client: &Client,
    request: &str,
    json: bool,
    host: &str,
    command: &OrchestrationCommand,
) -> Result<RunOutcome, CliError> {
    match command {
        OrchestrationCommand::GateCreate {
            scope,
            task,
            question,
            options,
            ..
        } => {
            let options: Vec<String> = match options {
                Some(value) => serde_json::from_str(value).map_err(|_| {
                    CliError::Usage("Invalid --options: must be a JSON array of strings".into())
                })?,
                None => Vec::new(),
            };
            let params = GateCreateParams {
                scope: coordinator_scope(host, scope),
                task_id: task.clone(),
                question: question.clone(),
                options,
            };
            let value = validate_params(&params, |p| p.validate_shape(host), request)?;
            let call = client
                .call("orchestration.gateCreate", value, request, DEFAULT_TIMEOUT)
                .await?;
            let result: GateResult = Client::decode_checked(
                &call,
                "orchestration.gateCreate",
                |r: &GateResult| {
                    check_gate(&r.gate, scope.run_id())?;
                    if r.gate.task_id != *task
                        || r.gate.question != *question
                        || r.gate.status != GateStatus::Pending
                        || serde_json::from_str::<Vec<String>>(&r.gate.options)
                            .ok()
                            .as_ref()
                            != Some(&params.options)
                    {
                        return Err("gate-create response does not match the requested task/question/options".into());
                    }
                    Ok(())
                },
            )?;
            emit(
                call,
                json,
                || {
                    format!(
                        "Gate {} created for task {} [{}]",
                        result.gate.id,
                        result.gate.task_id,
                        result.gate.status.as_str()
                    )
                },
                0,
            )
        }
        OrchestrationCommand::GateResolve {
            scope,
            id,
            resolution,
            ..
        } => {
            let params = GateResolveParams {
                scope: coordinator_scope(host, scope),
                gate_id: id.clone(),
                resolution: resolution.clone(),
            };
            let value = validate_params(&params, |p| p.validate_shape(host), request)?;
            let call = client
                .call("orchestration.gateResolve", value, request, DEFAULT_TIMEOUT)
                .await?;
            let result: GateResult =
                Client::decode_checked(&call, "orchestration.gateResolve", |r: &GateResult| {
                    check_gate(&r.gate, scope.run_id())?;
                    if r.gate.id != *id
                        || r.gate.status != GateStatus::Resolved
                        || r.gate.resolution.as_ref() != Some(resolution)
                    {
                        return Err(
                            "gate-resolve response does not match the requested gate/resolution"
                                .into(),
                        );
                    }
                    Ok(())
                })?;
            emit(
                call,
                json,
                || format!("Gate {} resolved: {}", result.gate.id, resolution),
                0,
            )
        }
        OrchestrationCommand::GateList {
            scope,
            task,
            status,
            ..
        } => {
            let status = match status.as_deref() {
                Some("pending") => Some(GateStatus::Pending),
                Some("resolved") => Some(GateStatus::Resolved),
                Some("timeout") => Some(GateStatus::Timeout),
                None => None,
                _ => return Err(CliError::Usage("Invalid gate status".into())),
            };
            let params = GateListParams {
                scope: coordinator_scope(host, scope),
                task_id: task.clone(),
                status,
            };
            let value = validate_params(&params, |p| p.validate_shape(host), request)?;
            let call = client
                .call("orchestration.gateList", value, request, DEFAULT_TIMEOUT)
                .await?;
            let result: GateListResult = Client::decode_checked(
                &call,
                "orchestration.gateList",
                |r: &GateListResult| {
                    if r.run_id != scope.run_id() || r.count != r.gates.len() {
                        return Err("gate-list response has inconsistent run/count".into());
                    }
                    let mut ids = std::collections::HashSet::new();
                    for gate in &r.gates {
                        check_gate(gate, scope.run_id())?;
                        if task.as_ref().is_some_and(|t| *t != gate.task_id)
                            || status.is_some_and(|s| s != gate.status)
                            || !ids.insert(&gate.id)
                        {
                            return Err("gate-list response violates the requested filter or repeats a gate".into());
                        }
                    }
                    Ok(())
                },
            )?;
            emit(
                call,
                json,
                || {
                    if result.gates.is_empty() {
                        return "No gates found.".into();
                    }
                    result
                        .gates
                        .iter()
                        .map(|g| {
                            format!(
                                "{} task={} [{}] \"{}\"",
                                g.id,
                                g.task_id,
                                g.status.as_str(),
                                g.question
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                },
                0,
            )
        }
        _ => unreachable!("gate handler accepts only gate commands"),
    }
}
