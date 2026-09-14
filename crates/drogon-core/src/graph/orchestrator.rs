//! Durable, depth-one orchestration. The daemon advances receipts, never a UI timer.
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::{failover, observability, store};
use crate::{Engine, error, session};
use chrono::{DateTime, Datelike, Timelike, Utc};
use drogon_protocol::graph::{
    GraphFailoverAttemptRecord, GraphNodeIntent, GraphOrchestratorRun as Run,
    GraphOrchestratorStep as Step, GraphPolicy, GraphRuntimeRef,
};
use drogon_protocol::{Request, RpcError};
use rusqlite::OptionalExtension as _;
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Start {
    workspace_id: String,
    main: GraphNodeIntent,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Workspace {
    workspace_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Control {
    workspace_id: String,
    run_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Policy {
    workspace_id: String,
    policy: GraphPolicy,
    main: Option<GraphNodeIntent>,
}

// Independent pollers merge snapshots by this value, so every save needs a
// distinct revision even though the shared product clock is second-resolution.
static LAST_ORCHESTRATOR_UPDATE_NANOS: AtomicU64 = AtomicU64::new(0);

fn timestamp_nanos(value: &str) -> Option<u64> {
    let timestamp = DateTime::parse_from_rfc3339(value).ok()?;
    u64::try_from(timestamp.timestamp())
        .ok()?
        .checked_mul(1_000_000_000)?
        .checked_add(timestamp.timestamp_subsec_nanos().into())
}

fn next_orchestrator_updated_at(previous: &str) -> Result<String, RpcError> {
    let now: u64 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .try_into()
        .unwrap_or(u64::MAX);
    let previous_floor = match timestamp_nanos(previous) {
        Some(value) => value
            .checked_add(1)
            .ok_or_else(|| error::internal_error("Workflow timestamp range exhausted."))?,
        None => 0,
    };
    let floor = previous_floor.max(now);
    let mut observed = LAST_ORCHESTRATOR_UPDATE_NANOS.load(Ordering::Acquire);
    let reserved = loop {
        let next = floor.max(
            observed
                .checked_add(1)
                .ok_or_else(|| error::internal_error("Workflow timestamp range exhausted."))?,
        );
        match LAST_ORCHESTRATOR_UPDATE_NANOS.compare_exchange_weak(
            observed,
            next,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => break next,
            Err(actual) => observed = actual,
        }
    };
    let seconds = i64::try_from(reserved / 1_000_000_000)
        .map_err(|_| error::internal_error("Workflow timestamp exceeded RFC3339 range."))?;
    DateTime::<Utc>::from_timestamp(seconds, (reserved % 1_000_000_000) as u32)
        .map(|timestamp| {
            format!(
                "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:09}Z",
                timestamp.year(),
                timestamp.month(),
                timestamp.day(),
                timestamp.hour(),
                timestamp.minute(),
                timestamp.second(),
                timestamp.nanosecond()
            )
        })
        .ok_or_else(|| error::internal_error("Workflow timestamp exceeded RFC3339 range."))
}

fn parse<T: serde::de::DeserializeOwned>(value: &Value) -> Result<T, RpcError> {
    serde_json::from_value(value.clone()).map_err(|e| error::invalid_argument(e.to_string()))
}

const NATIVE_SESSION_RUN_PREFIX: &str = "session:";

fn encode_session_run_id(session_id: &str, incarnation: &str) -> String {
    format!("{NATIVE_SESSION_RUN_PREFIX}{session_id}:{incarnation}")
}

fn decode_session_run_id(run_id: &str) -> Option<(&str, &str)> {
    run_id
        .strip_prefix(NATIVE_SESSION_RUN_PREFIX)?
        .split_once(':')
}

fn runtime_launch_parts(runtime: &GraphRuntimeRef) -> (Option<String>, String) {
    if let Some(provider) = runtime.provider.as_ref().filter(|value| !value.is_empty()) {
        return (Some(provider.clone()), runtime.model.clone());
    }
    if runtime.harness == "pi"
        && let Some((provider, model)) = runtime.model.split_once('/')
        && !provider.is_empty()
        && !model.is_empty()
    {
        return (Some(provider.to_string()), model.to_string());
    }
    (None, runtime.model.clone())
}

/// Refuse only the ambiguous bare Pi ids the host's own model catalog can
/// prove. Unavailable or non-enumerating catalogs remain honest but cannot
/// establish ambiguity, so those selections stay manual-unverified.
fn validate_pi_model_refs(engine: &Engine, refs: &[(&str, &str)]) -> Result<(), RpcError> {
    if !refs.iter().any(|(harness, model)| {
        *harness == "pi" && !model.trim().is_empty() && !model.contains('/')
    }) {
        return Ok(());
    }
    let response = engine.dispatch(Request {
        protocol: drogon_protocol::PROTOCOL_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        auth: None,
        method: "harness.models".into(),
        params: json!({"harnessId": "pi"}),
    });
    if !response.ok {
        return Err(response
            .error
            .unwrap_or_else(|| error::invalid_argument("Pi model catalog probe failed.")));
    }
    let catalog = &response
        .result
        .ok_or_else(|| error::invalid_argument("Pi model catalog probe returned no catalog."))?["catalog"];
    if catalog.get("status").and_then(Value::as_str) != Some("enumerated") {
        return Ok(());
    }
    for (harness, model) in refs {
        if *harness == "pi" && !model.trim().is_empty() && !model.contains('/') {
            reject_ambiguous_pi_model(catalog, model)?;
        }
    }
    Ok(())
}

fn reject_ambiguous_pi_model(catalog: &Value, model: &str) -> Result<(), RpcError> {
    let mut alternatives: Vec<String> = catalog
        .get("entries")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|entry| entry.get("id").and_then(Value::as_str) == Some(model))
        .filter_map(|entry| Some(format!("{}/{}", entry.get("provider")?.as_str()?, model)))
        .collect();
    alternatives.sort();
    alternatives.dedup();
    if alternatives.len() > 1 {
        return Err(error::invalid_argument(format!(
            "Pi model '{model}' is ambiguous across providers; use one of the qualified forms: {}.",
            alternatives.join(", ")
        )));
    }
    Ok(())
}

impl Engine {
    fn save_orchestrator(&self, run: &mut Run) -> Result<(), RpcError> {
        run.updated_at = next_orchestrator_updated_at(&run.updated_at)?;
        let payload =
            serde_json::to_string(run).map_err(|e| error::internal_error(e.to_string()))?;
        self.db.lock().unwrap().execute("INSERT INTO graph_orchestrator_runs(id, workspace_id, payload, updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at", rusqlite::params![run.id, run.workspace_id, payload, run.updated_at])
            .map_err(|e| error::internal_error(e.to_string()))?;
        Ok(())
    }

    fn orchestrator_runs(&self) -> Result<Vec<Run>, RpcError> {
        let db = self.db.lock().unwrap();
        let mut query = db
            .prepare("SELECT payload FROM graph_orchestrator_runs ORDER BY rowid DESC")
            .map_err(|e| error::internal_error(e.to_string()))?;
        let rows = query
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| error::internal_error(e.to_string()))?;
        rows.map(|row| {
            let payload = row.map_err(|e| error::internal_error(e.to_string()))?;
            serde_json::from_str(&payload).map_err(|e| error::internal_error(e.to_string()))
        })
        .collect()
    }

    fn orchestrator_run_for_workspace(&self, workspace_id: &str) -> Result<Option<Run>, RpcError> {
        let db = self.db.lock().unwrap();
        let payload = db
            .query_row(
                "SELECT payload FROM graph_orchestrator_runs WHERE workspace_id = ?1 ORDER BY rowid DESC LIMIT 1",
                [workspace_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| error::internal_error(e.to_string()))?;
        payload
            .map(|payload| {
                serde_json::from_str(&payload).map_err(|e| error::internal_error(e.to_string()))
            })
            .transpose()
    }

    pub(crate) fn graph_write_policy(&self, request: &Request) -> Result<Value, RpcError> {
        self.mutating(request, |engine, params| {
            let parsed: Policy = parse(params)?;
            parsed.policy.validate()?;
            let mut model_refs: Vec<(&str, &str)> = parsed
                .policy
                .approved_runtimes
                .iter()
                .map(|runtime| (runtime.harness.as_str(), runtime.model.as_str()))
                .collect();
            if let Some(fallback) = parsed.policy.fallback_runtime.as_ref() {
                model_refs.push((fallback.harness.as_str(), fallback.model.as_str()));
            }
            if let Some(main) = parsed.main.as_ref() {
                model_refs.push((main.harness.as_str(), main.model.as_str()));
            }
            validate_pi_model_refs(engine, &model_refs)?;
            let _gate = engine.graph_orchestrator_gate.lock().unwrap();
            let path = engine.workspace_path(&parsed.workspace_id)?;
            let raw = store::read_raw(&path)?;
            let mut intent = raw["intent"].clone();
            intent["policy"] = json!(parsed.policy);
            if let Some(mut main) = parsed.main {
                main.id = "orchestrator-main".into();
                main.validate()?;
                let nodes = intent["nodes"]
                    .as_array_mut()
                    .ok_or_else(|| error::invalid_argument("Graph nodes must be an array."))?;
                nodes.retain(|node| node["id"] != "orchestrator-main");
                nodes.push(json!(main));
            }
            Ok(json!({"graph":store::write_intent(&path, &intent)?}))
        })
    }

    pub(crate) fn graph_orchestrator_start(&self, request: &Request) -> Result<Value, RpcError> {
        self.mutating(request, |engine, params| {
            let parsed: Start = parse(params)?;
            parsed.main.validate()?;
            if !parsed.main.depends_on.is_empty() || !parsed.main.enabled {
                return Err(error::invalid_argument(
                    "The main task must be enabled and have no dependencies.",
                ));
            }
            let _gate = engine.graph_orchestrator_gate.lock().unwrap();
            let path = engine.workspace_path(&parsed.workspace_id)?;
            let prior_runs = engine.orchestrator_runs()?;
            if prior_runs.iter().any(|run| {
                run.workspace_id == parsed.workspace_id
                    && matches!(run.status.as_str(), "running" | "stopping" | "unverifiable")
            }) {
                return Err(error::invalid_argument(
                    "This workspace already has an active or unverifiable workflow.",
                ));
            }
            let prior_updated_at = prior_runs
                .iter()
                .find(|run| run.workspace_id == parsed.workspace_id)
                .map(|run| run.updated_at.clone());
            let policy = store::read_graph(&path)?.intent.policy;
            policy.validate()?;
            let mut model_refs: Vec<(&str, &str)> = policy
                .approved_runtimes
                .iter()
                .map(|runtime| (runtime.harness.as_str(), runtime.model.as_str()))
                .collect();
            if let Some(fallback) = policy.fallback_runtime.as_ref() {
                model_refs.push((fallback.harness.as_str(), fallback.model.as_str()));
            }
            model_refs.push((parsed.main.harness.as_str(), parsed.main.model.as_str()));
            validate_pi_model_refs(engine, &model_refs)?;
            let now = crate::now_rfc3339();
            let mut run = Run {
                id: uuid::Uuid::new_v4().simple().to_string(),
                workspace_id: parsed.workspace_id,
                main: parsed.main,
                policy,
                status: "running".into(),
                phase: "main".into(),
                iteration: 1,
                steps: vec![],
                started_at: now.clone(),
                updated_at: prior_updated_at.unwrap_or(now),
                error: None,
            };
            run.steps.push(new_step(&run));
            engine.save_orchestrator(&mut run)?;
            let approved = run
                .policy
                .approved_runtimes
                .iter()
                .map(describe_runtime)
                .collect::<Vec<_>>()
                .join(", ");
            engine.record_telemetry(
                &run,
                "progress",
                format!(
                    "Workflow started: main task on {} · adversarial testing {} · up to {} iteration(s)",
                    describe_runtime(&GraphRuntimeRef {
                        harness: run.main.harness.clone(),
                        model: run.main.model.clone(),
                        provider: None,
                    }),
                    if run.policy.adversarial.enabled { "on" } else { "off" },
                    run.policy.adversarial.max_iterations
                ),
                Some(format!(
                    "Run {}\nApproved runtimes for the test and review agents, tried in order: {}\nFallback runtime: {}\nTask:\n{}",
                    run.id,
                    if approved.is_empty() { "none".to_string() } else { approved },
                    run.policy
                        .fallback_runtime
                        .as_ref()
                        .map(describe_runtime)
                        .unwrap_or_else(|| "none".to_string()),
                    run.main.prompt
                )),
                vec![],
                "orchestrator",
                "orchestrator",
            );
            Ok(json!({"run":run}))
        })
    }

    pub(crate) fn graph_orchestrator_status(&self, params: &Value) -> Result<Value, RpcError> {
        let parsed: Workspace = parse(params)?;
        self.workspace_path(&parsed.workspace_id)?;
        let _gate = self.graph_orchestrator_gate.lock().unwrap();
        Ok(json!({
            "run": self.orchestrator_run_for_workspace(&parsed.workspace_id)?
        }))
    }

    pub(crate) fn graph_orchestrator_stop(&self, request: &Request) -> Result<Value, RpcError> {
        self.mutating(request, |engine, params| {
            let parsed: Control = parse(params)?;
            let _gate = engine.graph_orchestrator_gate.lock().unwrap();
            let mut run = engine.find_orchestrator(&parsed)?;
            if matches!(run.status.as_str(), "running" | "unverifiable") {
                if let Some(id) = run.steps.last().and_then(|step| step.run_id.as_ref()) {
                    if let Some((session_id, incarnation)) = decode_session_run_id(id) {
                        match engine.do_session_stop(&json!({
                            "sessionId": session_id,
                            "incarnation": incarnation,
                        })) {
                            Ok(stopped) if stopped["verdict"] == "exited" => {
                                run.status = "stopped".into();
                                run.steps.last_mut().unwrap().status = "stopped".into();
                            }
                            Ok(_) => run.status = "unverifiable".into(),
                            Err(err) if err.code == "not_found" => {
                                run.status = "unverifiable".into();
                                run.error = Some(
                                    "The native session record is missing, so Drogon cannot confirm that its process exited."
                                        .into(),
                                );
                            }
                            Err(err) => return Err(err),
                        }
                    } else {
                        run.status = "unverifiable".into();
                        run.error = Some(
                            "This workflow predates native session execution; its process cannot be controlled by this build."
                                .into(),
                        );
                    }
                } else if run
                    .steps
                    .last()
                    .is_some_and(|step| step.status == "dispatching")
                {
                    run.status = "unverifiable".into();
                } else {
                    run.status = "stopped".into();
                }
                engine.save_orchestrator(&mut run)?;
            }
            Ok(json!({"run":run}))
        })
    }

    fn find_orchestrator(&self, params: &Control) -> Result<Run, RpcError> {
        self.workspace_path(&params.workspace_id)?;
        self.orchestrator_runs()?
            .into_iter()
            .find(|run| run.id == params.run_id && run.workspace_id == params.workspace_id)
            .ok_or_else(|| error::not_found("Workflow run not found."))
    }

    pub(crate) fn graph_orchestrator_resume(&self, request: &Request) -> Result<Value, RpcError> {
        self.mutating(request, |engine, params| {
            let parsed: Control = parse(params)?;
            let _gate = engine.graph_orchestrator_gate.lock().unwrap();
            let mut run = engine.find_orchestrator(&parsed)?;
            if run.status != "stopped" {
                return Err(error::invalid_argument("Only a confirmed stopped run can resume. Unverifiable work must be investigated first."));
            }
            if engine.orchestrator_runs()?.iter().any(|other| other.workspace_id == run.workspace_id && other.id != run.id && matches!(other.status.as_str(), "running" | "stopping" | "unverifiable")) {
                return Err(error::invalid_argument("Another workflow is active."));
            }
            run.status = "running".into();
            run.error = None;
            run.steps.last_mut().expect("workflow has a step").status = "stopped".into();
            run.steps.push(new_step(&run));
            engine.save_orchestrator(&mut run)?;
            Ok(json!({"run":run}))
        })
    }

    /// Runs independently of open windows. Holds the same lifecycle admission as RPC mutations.
    pub fn tick_graph_orchestrator(&self) -> Result<(), RpcError> {
        let _lifecycle = self.lifecycle_gate.read().unwrap();
        if self.is_quiescent() {
            return Ok(());
        }
        let _gate = self.graph_orchestrator_gate.lock().unwrap();
        for mut run in self.orchestrator_runs()? {
            if !matches!(run.status.as_str(), "running" | "stopping") {
                continue;
            }
            let before = run.status.clone();
            if let Err(err) = self.advance_orchestrator(&mut run) {
                run.status = "failed".into();
                run.error = Some(err.message);
            }
            self.save_orchestrator(&mut run)?;
            if run.status != before {
                self.record_workflow_outcome(&run);
            }
        }
        Ok(())
    }

    /// Writes one line of the run's telemetry into the workspace's own
    /// evidence ledger. Best effort by design: telemetry that cannot be
    /// written is logged, never allowed to fail the workflow it describes.
    /// Called only while `graph_orchestrator_gate` is held.
    #[allow(clippy::too_many_arguments)] // Mirrors the evidence ledger's attribution fields.
    fn record_telemetry(
        &self,
        run: &Run,
        status: &str,
        summary: String,
        detail: Option<String>,
        artifacts: Vec<String>,
        agent_id: &str,
        role: &str,
    ) {
        let root = match self.workspace_path(&run.workspace_id) {
            Ok(root) => root,
            Err(_) => return,
        };
        let entry = observability::daemon_evidence(
            status,
            summary,
            detail,
            artifacts,
            Some(run.id.clone()),
            Some(agent_id.to_string()),
            Some(role.to_string()),
        );
        if let Err(err) = observability::append_daemon_evidence(&root, entry) {
            eprintln!(
                "[graph-orchestrator] telemetry for run {} not recorded: {}",
                run.id, err.message
            );
        }
    }

    fn record_workflow_outcome(&self, run: &Run) {
        let attempts: usize = run.steps.iter().map(|step| step.attempts.len()).sum();
        let fallbacks = run.steps.iter().filter(|step| step.is_fallback).count();
        let findings = run
            .steps
            .iter()
            .filter(|step| step.verdict.as_deref() == Some("findings"))
            .count();
        let shape = format!(
            "{} iteration(s) · {} step(s) · {} runtime attempt(s) · {} on the fallback · {} round(s) with findings",
            run.iteration,
            run.steps.len(),
            attempts,
            fallbacks,
            findings
        );
        let (status, summary) = match run.status.as_str() {
            "passed" => (
                "completed",
                format!("Workflow passed: the last review found nothing left to fix · {shape}"),
            ),
            "exhausted" => (
                "blocked",
                format!(
                    "Workflow exhausted its {} iteration cap with findings still open · {shape}",
                    run.policy.adversarial.max_iterations
                ),
            ),
            "stopped" => ("blocked", format!("Workflow stopped on request · {shape}")),
            "unverifiable" => (
                "blocked",
                format!("Workflow unverifiable: contact with a worker was lost · {shape}"),
            ),
            "failed" => ("failed", format!("Workflow failed · {shape}")),
            _ => return,
        };
        let mut lines = vec![format!(
            "Started {} · last update {}",
            run.started_at, run.updated_at
        )];
        if let Some(error) = &run.error {
            lines.push(format!("Reason: {error}"));
        }
        for step in &run.steps {
            let runtime = step
                .runtime
                .as_ref()
                .map(describe_runtime)
                .unwrap_or_else(|| "no runtime".to_string());
            lines.push(format!(
                "iteration {} · {} · {} · {}{} · verdict {}",
                step.iteration,
                step.phase,
                step.status,
                runtime,
                if step.is_fallback { " (fallback)" } else { "" },
                step.verdict.as_deref().unwrap_or("—")
            ));
        }
        self.record_telemetry(
            run,
            status,
            summary,
            Some(lines.join("\n")),
            vec![],
            "orchestrator",
            "orchestrator",
        );
    }

    fn advance_orchestrator(&self, run: &mut Run) -> Result<(), RpcError> {
        let root = self.workspace_path(&run.workspace_id)?;
        let step = run.steps.last_mut().expect("workflow has a step");
        if step.status == "dispatching" {
            run.status = "unverifiable".into();
            run.error = Some("Daemon interrupted during launch; no retry is safe without confirming the worker exited.".into());
            return Ok(());
        }
        if let Some(id) = step.run_id.clone() {
            let Some((session_id, incarnation)) = decode_session_run_id(&id) else {
                step.status = "unverifiable".into();
                run.status = "unverifiable".into();
                run.error = Some(
                    "This workflow predates native session execution; its process cannot be observed by this build."
                        .into(),
                );
                return Ok(());
            };
            let handle = self.sessions.lock().unwrap().get(session_id).cloned();
            let retained = handle.is_some();
            let snapshot = match handle {
                Some(handle) => {
                    session::check_incarnation(&handle, incarnation)?;
                    session::snapshot(&handle)
                }
                None => match self.session_row_as_value(session_id, incarnation) {
                    Ok(snapshot) => snapshot,
                    Err(err) if err.code == "not_found" => {
                        step.status = "unverifiable".into();
                        run.status = "unverifiable".into();
                        run.error = Some(
                            "The native session record is missing, so its process outcome is unverifiable."
                                .into(),
                        );
                        return Ok(());
                    }
                    Err(err) => return Err(err),
                },
            };
            if snapshot["verdict"] == "live" && retained {
                return Ok(());
            }
            if snapshot["verdict"] != "exited" {
                step.status = "unverifiable".into();
                run.status = "unverifiable".into();
                return Ok(());
            }
            if run.status == "stopping" {
                run.status = "stopped".into();
                step.status = "stopped".into();
                return Ok(());
            }
            let exit_code = snapshot["exitCode"].as_i64();
            let evaluation = if exit_code == Some(0) {
                if run.phase == "main" {
                    Some(("pass".to_string(), None))
                } else {
                    read_evaluation(&root, &step.node_id)?
                        .map(|(verdict, evidence)| (verdict, Some(evidence)))
                }
            } else {
                None
            };
            if let Some((verdict, evidence)) = evaluation {
                step.status = "succeeded".into();
                step.verdict = Some(verdict.clone());
                if let Some(attempt) = step.attempts.last_mut() {
                    attempt.outcome = "succeeded".into();
                }
                let (iteration, phase, node_id, runtime) = (
                    step.iteration,
                    step.phase.clone(),
                    step.node_id.clone(),
                    step.runtime
                        .as_ref()
                        .map(describe_runtime)
                        .unwrap_or_default(),
                );
                finish_step(run);
                if phase == "main" {
                    self.record_telemetry(
                        run,
                        "completed",
                        format!("Iteration {iteration} · main agent finished its task on {runtime}"),
                        Some(format!(
                            "Node {node_id} · session {session_id}\nTask as given to the agent:\n{}\n\n{}",
                            run.main.prompt,
                            if run.policy.adversarial.enabled {
                                "Adversarial testing is on: a test agent now tries to break this work, and a review agent judges what it found."
                            } else {
                                "Adversarial testing is off: the workflow ends here."
                            }
                        )),
                        vec![],
                        &node_id,
                        "main",
                    );
                } else {
                    let status = if verdict == "pass" {
                        "completed"
                    } else {
                        "finding"
                    };
                    self.record_telemetry(
                        run,
                        status,
                        format!("Iteration {iteration} · {phase} verdict: {verdict} · {runtime}"),
                        Some(format!(
                            "Node {node_id} · session {session_id}\nWhat the {phase} agent reported as its evidence:\n{}",
                            evidence.unwrap_or_default()
                        )),
                        vec![result_path(&node_id)],
                        &node_id,
                        &phase,
                    );
                }
                return Ok(());
            }
            let reason = match exit_code {
                Some(code) if code != 0 => {
                    format!("Native agent session exited with code {code}.")
                }
                _ => "Agent session did not produce a valid evaluation result.".into(),
            };
            if let Some(attempt) = step.attempts.last_mut() {
                attempt.outcome = "failed".into();
                attempt.reason = Some(reason.clone());
            }
            let failed = (
                step.iteration,
                step.phase.clone(),
                step.node_id.clone(),
                step.attempts.len(),
                step.runtime
                    .as_ref()
                    .map(describe_runtime)
                    .unwrap_or_default(),
            );
            step.run_id = None;
            step.status = "pending".into();
            let (iteration, phase, node_id, attempt_no, runtime) = failed;
            self.record_telemetry(
                run,
                "failed",
                format!("Iteration {iteration} · {phase}: attempt {attempt_no} on {runtime} failed"),
                Some(format!(
                    "Node {node_id} · session {session_id}\nReason: {reason}\nThe next approved runtime is tried, then the fallback; the workflow fails only when every configured runtime failed."
                )),
                vec![],
                &node_id,
                &phase,
            );
        }
        if run.status == "stopping" {
            run.status = "stopped".into();
            return Ok(());
        }
        let candidates = if run.phase == "main" {
            vec![GraphRuntimeRef {
                harness: run.main.harness.clone(),
                model: run.main.model.clone(),
                provider: None,
            }]
        } else {
            failover::attempt_sequence(&run.policy)
        };
        let step = run.steps.last().unwrap();
        let Some(candidate) = candidates.get(step.attempts.len()).cloned() else {
            run.status = "failed".into();
            run.error = Some("Every configured runtime failed to execute this role.".into());
            run.steps.last_mut().unwrap().status = "failed".into();
            return Ok(());
        };
        let node = node_for_step(run, &candidate);
        let evaluation_file = root.join(result_path(&node.id));
        std::fs::create_dir_all(evaluation_file.parent().unwrap())
            .map_err(|e| error::io_error(e.to_string()))?;
        // Each attempt must write fresh evidence; an earlier attempt cannot certify it.
        if evaluation_file.exists() {
            std::fs::remove_file(&evaluation_file).map_err(|e| error::io_error(e.to_string()))?;
        }
        let (provider, model) = runtime_launch_parts(&candidate);
        let mut launch = json!({
            "workspaceId": run.workspace_id,
            "harnessId": candidate.harness,
            "model": model,
            "prompt": node.prompt,
            "headless": true,
        });
        if let Some(provider) = provider {
            launch["provider"] = json!(provider);
        }
        let launched = (|| {
            run.steps.last_mut().unwrap().status = "dispatching".into();
            self.save_orchestrator(run)?;
            self.do_harness_start(&launch)
        })();
        let step = run.steps.last_mut().unwrap();
        step.runtime = Some(candidate.clone());
        step.is_fallback =
            run.phase != "main" && failover::is_fallback_attempt(&run.policy, step.attempts.len());
        let (iteration, phase, node_id, is_fallback) = (
            step.iteration,
            step.phase.clone(),
            step.node_id.clone(),
            step.is_fallback,
        );
        let attempt_no = step.attempts.len() + 1;
        let runtime = describe_runtime(&candidate);
        match launched {
            Ok(child) => {
                let session_id = child["id"].as_str().ok_or_else(|| {
                    error::internal_error("Native session launch returned no id.")
                })?;
                let incarnation = child["incarnation"].as_str().ok_or_else(|| {
                    error::internal_error("Native session launch returned no incarnation.")
                })?;
                step.run_id = Some(encode_session_run_id(session_id, incarnation));
                step.status = "running".into();
                step.attempts.push(GraphFailoverAttemptRecord {
                    harness: candidate.harness,
                    model: candidate.model,
                    provider: candidate.provider,
                    outcome: "launched".into(),
                    reason: None,
                });
                let role_note = match phase.as_str() {
                    "main" => "The main agent builds what the task describes, in this workspace."
                        .to_string(),
                    "test" => format!(
                        "The test agent tries to break the main agent's work and writes its verdict (pass or findings, with evidence) to {}.",
                        result_path(&node_id)
                    ),
                    _ => format!(
                        "The review agent judges the test agent's findings and writes its own verdict to {}.",
                        result_path(&node_id)
                    ),
                };
                self.record_telemetry(
                    run,
                    "progress",
                    format!(
                        "Iteration {iteration} · {phase}: attempt {attempt_no} launched on {runtime}{}",
                        if is_fallback { " (fallback runtime)" } else { "" }
                    ),
                    Some(format!("Node {node_id} · session {session_id}\n{role_note}")),
                    vec![],
                    &node_id,
                    &phase,
                );
            }
            Err(err) => {
                step.status = "pending".into();
                step.attempts.push(GraphFailoverAttemptRecord {
                    harness: candidate.harness,
                    model: candidate.model,
                    provider: candidate.provider,
                    outcome: "launch_failed".into(),
                    reason: Some(err.message.clone()),
                });
                self.record_telemetry(
                    run,
                    "failed",
                    format!(
                        "Iteration {iteration} · {phase}: attempt {attempt_no} could not launch on {runtime}"
                    ),
                    Some(format!("Node {node_id}\nReason: {}", err.message)),
                    vec![],
                    &node_id,
                    &phase,
                );
            }
        }
        Ok(())
    }
}

fn new_step(run: &Run) -> Step {
    Step {
        node_id: format!(
            "or-{}-{}-{}-{}",
            run.id,
            run.steps.len(),
            run.iteration,
            run.phase
        ),
        phase: run.phase.clone(),
        iteration: run.iteration,
        status: "pending".into(),
        run_id: None,
        runtime: None,
        is_fallback: false,
        verdict: None,
        attempts: vec![],
    }
}

fn finish_step(run: &mut Run) {
    match run.phase.as_str() {
        "main" if !run.policy.adversarial.enabled => {
            run.status = "passed".into();
            return;
        }
        "main" => run.phase = "test".into(),
        "test" => run.phase = "review".into(),
        "review" => {
            let passed = run
                .steps
                .iter()
                .filter(|step| {
                    step.iteration == run.iteration
                        && step.phase != "main"
                        && step.status == "succeeded"
                })
                .all(|step| step.verdict.as_deref() == Some("pass"));
            if passed {
                run.status = "passed".into();
                return;
            }
            if run.iteration >= run.policy.adversarial.max_iterations {
                run.status = "exhausted".into();
                return;
            }
            run.iteration += 1;
            run.phase = "test".into();
        }
        _ => unreachable!(),
    }
    run.steps.push(new_step(run));
}

fn result_path(node_id: &str) -> String {
    format!(".drogon/evaluations/{node_id}.json")
}

/// `describe_runtime` renders a runtime the way the Subagent policy shows it:
/// `harness/model`, or the bare harness when the model is its default.
fn describe_runtime(runtime: &GraphRuntimeRef) -> String {
    if runtime.model.trim().is_empty() {
        format!("{} (harness default model)", runtime.harness)
    } else {
        format!("{}/{}", runtime.harness, runtime.model)
    }
}

/// The worker's evaluation file: its verdict and the evidence it wrote for
/// it. Absent, oversized, malformed or evidence-less files are `None` — an
/// attempt without a readable verdict is a failed attempt.
fn read_evaluation(
    root: &std::path::Path,
    node_id: &str,
) -> Result<Option<(String, String)>, RpcError> {
    let path = root.join(result_path(node_id));
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(error::io_error(e.to_string())),
    };
    if !metadata.is_file() || metadata.len() > 65536 {
        return Ok(None);
    }
    let text = std::fs::read_to_string(path).map_err(|e| error::io_error(e.to_string()))?;
    let value: Value = match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    let Some(evidence) = value
        .get("evidence")
        .and_then(Value::as_str)
        .filter(|evidence| !evidence.trim().is_empty())
    else {
        return Ok(None);
    };
    Ok(value
        .get("verdict")
        .and_then(Value::as_str)
        .filter(|v| matches!(*v, "pass" | "findings"))
        .map(|verdict| (verdict.to_string(), evidence.to_string())))
}

fn node_for_step(run: &Run, candidate: &GraphRuntimeRef) -> GraphNodeIntent {
    let step = run.steps.last().unwrap();
    let mut node = run.main.clone();
    node.id = step.node_id.clone();
    node.harness = candidate.harness.clone();
    node.model = if candidate.harness == "pi" {
        candidate
            .provider
            .as_deref()
            .filter(|provider| !provider.is_empty())
            .map(|provider| format!("{provider}/{}", candidate.model))
            .unwrap_or_else(|| candidate.model.clone())
    } else {
        candidate.model.clone()
    };
    node.depends_on.clear();
    if run.phase == "main" && node.harness != "shell" {
        if run.policy.adversarial.enabled {
            node.prompt.push_str(
                "\nImplement the user's request directly unless a genuinely independent subtask \
                 benefits from a depth-one worker. Never delegate a simple lookup, repository \
                 discovery, one `gh` command, or a small bounded edit. The daemon launches the \
                 final whole-workflow test/review sessions after your work settles; do not \
                 dispatch duplicate testers yourself. Any child you launch must not delegate.",
            );
        } else if run.policy.delegate {
            node.prompt.push_str(
                "\nDelegation is available, not mandatory. Do simple lookups, repository \
                 discovery, `gh` commands, and bounded edits directly. If the user asks you to \
                 make changes, you may make them yourself. Use depth-one Drogon children only \
                 when independent work benefits from parallelism or specialization, supervise \
                 their results, and do not add adversarial testers. Children must not delegate.",
            );
        } else {
            node.prompt.push_str(
                "\nWork directly on the task in this main agent. Do not proactively dispatch \
                 subagents, though an explicit user request to delegate may authorize one.",
            );
        }
        node.prompt.push_str(&format!(
            "\n\nDrogon run {}: immutable Subagent policy snapshot\n{}\n\
             You are this graph's main agent, not a Bot dispatcher or a depth-one worker. \
             A Bot may have dispatched the graph on the user's behalf; that dispatch does not \
             consume your child-depth budget.\n\
             Before substantial planning or delegation, read `.drogon/graph.json` with \
             `drogon-cli graph read --workspace {} --json` and native evidence/usage with \
             `drogon-cli graph observability --workspace {} --json`. A simple read-only answer \
             or obvious repository command needs no worker: resolve the repository and use normal \
             tools such as `gh` directly. If delegation is useful, use Drogon's native \
             orchestration run-create, task-create and worker-start commands to create and \
             supervise children (read `drogon-cli skills get --topic orchestration`). Use the \
             approved runtime policy and explicit harness/model pairs from this snapshot, not \
             harness-internal subagent tools, bare harness sessions, or native ungoverned spawns. \
             Try approved pairs in their configured order; use fallback only after every approved \
             runtime fails to execute. Findings are successful evaluations and do not trigger \
             runtime failover. Maximum subagent depth is one: children must not delegate further. \
             Workspace policy edits apply to future runs; do not substitute them for this snapshot. \
             The daemon owns any enabled adversarial loop; do not launch duplicate whole-workflow \
             test/review workers yourself.",
            run.id,
            serde_json::to_string(&run.policy).expect("policy serializes"),
            run.workspace_id,
            run.workspace_id
        ));
        node.prompt.push_str(&format!(
            "\nRecord concise, meaningful progress checkpoints for the human with `drogon-cli graph evidence-add --workspace {} --run {} --agent leader`; use progress, finding, blocked, completed, or failed. Pi terminal sessions with DROGON_HOOK_MARKER report usage automatically; do not duplicate those measurements. For other launches, record exact incremental token usage with `graph usage-add` only when the harness reports it. Omit unknown token fields; never estimate them. These native ledgers live under .drogon and belong to Drogon.",
            run.workspace_id, run.id
        ));
    }
    if run.phase != "main" {
        node.provider = None;
        node.title = if run.phase == "test" {
            "Adversarial test"
        } else {
            "Code review and corrections"
        }
        .into();
        // Deterministic completion for a role: the evaluation file the role
        // was asked to write. A 60-character completion keyword is a
        // transcription task for the agent, and a cheap model gets one hex
        // digit wrong (observed: a tester wrote a valid verdict, mistyped the
        // keyword, and the whole iteration was thrown away). The artifact is
        // the real contract, `read_verdict` validates its content below, and
        // a missing file still fails the step with the runtime's own message.
        node.verify_commands = vec![format!("test -s '{}'", result_path(&node.id))];
        let role = if run.phase == "test" {
            "Test adversarially. Run real tests and record reproducible findings. Do not modify product code."
        } else {
            "Independently review code, read the adversarial test evidence for this iteration, fix findings, and verify corrections. Report findings if any remain or if you changed product code: the next iteration must retest it."
        };
        node.prompt = format!(
            "{role}\nTask: {}\nIteration {} of {}. Read prior evidence in .drogon/evaluations/ for workflow {}. Do not spawn subagents: maximum depth is 1.\nWrite {} as JSON with verdict (exactly pass or findings) and evidence (what was tested/reviewed and findings). Also append a concise human checkpoint with `drogon-cli graph evidence-add --workspace {} --run {} --agent {} --role {}` and exact incremental usage with `graph usage-add` if the harness reports tokens, except in Pi terminal sessions with DROGON_HOOK_MARKER, whose usage Drogon records automatically. Never duplicate those measurements. A findings verdict is a successful evaluation, not a process error. Exit normally after recording either verdict.",
            run.main.prompt,
            run.iteration,
            run.policy.adversarial.max_iterations,
            run.id,
            result_path(&node.id),
            run.workspace_id,
            run.id,
            node.id,
            run.phase
        );
    }
    node
}

pub struct Scheduler {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}
impl Scheduler {
    pub fn shutdown(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(handle) = self.thread.take() {
            handle.thread().unpark();
            let _ = handle.join();
        }
    }
}
impl Drop for Scheduler {
    fn drop(&mut self) {
        self.shutdown();
    }
}
pub fn spawn(engine: Arc<Engine>) -> Scheduler {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let thread = thread::spawn(move || {
        while !flag.load(Ordering::Acquire) && !engine.is_quiescent() {
            crate::automations::scheduler::guarded_tick("graph-orchestrator", || {
                if let Err(err) = engine.tick_graph_orchestrator() {
                    eprintln!("Graph orchestrator: {}", err.message);
                }
            });
            thread::park_timeout(Duration::from_millis(500));
        }
    });
    Scheduler {
        stop,
        thread: Some(thread),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orchestrator_update_timestamps_are_strictly_monotonic() {
        let first = next_orchestrator_updated_at("").unwrap();
        let second = next_orchestrator_updated_at(&first).unwrap();
        assert!(timestamp_nanos(&second).unwrap() > timestamp_nanos(&first).unwrap());
        assert!(first.ends_with('Z') && first.contains('.'));
    }

    #[test]
    fn ambiguous_pi_models_name_qualified_alternatives() {
        let catalog = json!({
            "status": "enumerated",
            "entries": [
                {"provider": "azure-openai-responses", "id": "gpt-5.6-luna"},
                {"provider": "openai-codex", "id": "gpt-5.6-luna"},
                {"provider": "openai-codex", "id": "unique"}
            ]
        });
        let error = reject_ambiguous_pi_model(&catalog, "gpt-5.6-luna").unwrap_err();
        assert!(error.message.contains("ambiguous across providers"));
        assert!(
            error
                .message
                .contains("azure-openai-responses/gpt-5.6-luna")
        );
        assert!(error.message.contains("openai-codex/gpt-5.6-luna"));
        assert!(reject_ambiguous_pi_model(&catalog, "unique").is_ok());
        assert!(reject_ambiguous_pi_model(&catalog, "openai-codex/gpt-5.6-luna").is_ok());
    }

    #[test]
    fn native_session_run_ids_round_trip_without_mentu_state() {
        let encoded = encode_session_run_id("session-id", "incarnation-id");
        assert_eq!(
            decode_session_run_id(&encoded),
            Some(("session-id", "incarnation-id"))
        );
        assert_eq!(decode_session_run_id("legacy-mentu-run"), None);
    }

    #[test]
    fn evaluations_require_a_valid_verdict_and_nonempty_evidence() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join(result_path("test"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        for invalid in [
            json!({"verdict":"pass"}),
            json!({"verdict":"pass","evidence":" "}),
            json!({"verdict":"maybe","evidence":"ran tests"}),
            json!({"verdict":"pass","evidence":[]}),
        ] {
            std::fs::write(&path, invalid.to_string()).unwrap();
            assert_eq!(read_evaluation(root.path(), "test").unwrap(), None);
        }
        for verdict in ["pass", "findings"] {
            std::fs::write(
                &path,
                json!({"verdict":verdict,"evidence":"ran tests"}).to_string(),
            )
            .unwrap();
            assert_eq!(
                read_evaluation(root.path(), "test")
                    .unwrap()
                    .map(|value| value.0),
                Some(verdict.to_string())
            );
        }
    }

    #[test]
    fn the_orchestrator_writes_its_own_telemetry_into_the_evidence_ledger() {
        let root = tempfile::tempdir().unwrap();
        let engine = Engine::open(&root.path().join("data")).unwrap();
        let response = engine.dispatch(Request {
            protocol: drogon_protocol::PROTOCOL_VERSION,
            request_id: uuid::Uuid::new_v4().to_string(),
            auth: None,
            method: "workspace.register".into(),
            params: json!({"path":root.path()}),
        });
        let workspace = response.result.unwrap()["id"].as_str().unwrap().to_string();
        let main: GraphNodeIntent = serde_json::from_value(
            json!({"id":"main","title":"Task","harness":"pi","model":"dgx-spark/qwen","prompt":"Build the deck"}),
        )
        .unwrap();
        let mut run = Run {
            id: "telemetry-run".into(),
            workspace_id: workspace.clone(),
            main,
            policy: GraphPolicy::default(),
            status: "running".into(),
            phase: "main".into(),
            iteration: 1,
            steps: vec![],
            started_at: crate::now_rfc3339(),
            updated_at: crate::now_rfc3339(),
            error: None,
        };
        let mut step = new_step(&run);
        step.runtime = Some(GraphRuntimeRef {
            harness: "pi".into(),
            model: "dgx-spark/qwen".into(),
            provider: None,
        });
        step.status = "succeeded".into();
        step.verdict = Some("findings".into());
        run.steps.push(step);

        // What the tick records as it goes: an attempt, then the outcome.
        engine.record_telemetry(
            &run,
            "progress",
            "Iteration 1 · main: attempt 1 launched on pi/dgx-spark/qwen".into(),
            Some("Node or-1 · session session-1".into()),
            vec![],
            "or-1",
            "main",
        );
        run.status = "exhausted".into();
        engine.record_workflow_outcome(&run);

        let ledger: Value = serde_json::from_str(
            &std::fs::read_to_string(root.path().join(".drogon/evidence.json")).unwrap(),
        )
        .unwrap();
        let entries = ledger["entries"].as_array().unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0]["status"], "progress");
        assert_eq!(entries[0]["runId"], "telemetry-run");
        assert_eq!(entries[0]["agentId"], "or-1");
        assert_eq!(entries[0]["role"], "main");
        let outcome = entries[1]["summary"].as_str().unwrap();
        assert!(
            outcome.starts_with("Workflow exhausted its 3 iteration cap"),
            "{outcome}"
        );
        assert!(
            outcome.contains("1 step(s)") && outcome.contains("1 round(s) with findings"),
            "{outcome}"
        );
        assert_eq!(entries[1]["status"], "blocked");
        assert_eq!(entries[1]["role"], "orchestrator");
        let detail = entries[1]["detail"].as_str().unwrap();
        assert!(
            detail
                .contains("iteration 1 · main · succeeded · pi/dgx-spark/qwen · verdict findings"),
            "{detail}"
        );

        // A run whose status did not end never records an outcome.
        run.status = "running".into();
        engine.record_workflow_outcome(&run);
        let ledger: Value = serde_json::from_str(
            &std::fs::read_to_string(root.path().join(".drogon/evidence.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(ledger["entries"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn an_evaluation_yields_its_verdict_and_the_agent_evidence_behind_it() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join(result_path("node-7"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            r#"{"verdict":"findings","evidence":"Undo after the last swipe restores nothing."}"#,
        )
        .unwrap();
        let (verdict, evidence) = read_evaluation(root.path(), "node-7").unwrap().unwrap();
        assert_eq!(verdict, "findings");
        assert_eq!(evidence, "Undo after the last swipe restores nothing.");
        assert_eq!(read_evaluation(root.path(), "absent").unwrap(), None);
    }

    #[test]
    fn stop_without_contact_never_claims_exit() {
        let root = tempfile::tempdir().unwrap();
        let engine = Engine::open(&root.path().join("data")).unwrap();
        let response = engine.dispatch(Request {
            protocol: drogon_protocol::PROTOCOL_VERSION,
            request_id: uuid::Uuid::new_v4().to_string(),
            auth: None,
            method: "workspace.register".into(),
            params: json!({"path":root.path()}),
        });
        let workspace = response.result.unwrap()["id"].as_str().unwrap().to_string();
        let main: GraphNodeIntent = serde_json::from_value(
            json!({"id":"main","title":"Task","harness":"shell","prompt":"true"}),
        )
        .unwrap();
        let mut run = Run {
            id: "receipt-gap".into(),
            workspace_id: workspace.clone(),
            main,
            policy: GraphPolicy::default(),
            status: "running".into(),
            phase: "main".into(),
            iteration: 1,
            steps: vec![],
            started_at: crate::now_rfc3339(),
            updated_at: crate::now_rfc3339(),
            error: None,
        };
        let mut step = new_step(&run);
        step.status = "running".into();
        step.run_id = Some("lost-child-receipt".into());
        run.steps.push(step);
        engine.save_orchestrator(&mut run).unwrap();
        let request = Request {
            protocol: drogon_protocol::PROTOCOL_VERSION,
            request_id: uuid::Uuid::new_v4().to_string(),
            auth: None,
            method: "graph.orchestrator_stop".into(),
            params: json!({"workspaceId":workspace,"runId":run.id}),
        };
        let stopped = engine.graph_orchestrator_stop(&request).unwrap();
        assert_eq!(stopped["run"]["status"], "unverifiable");
    }

    #[test]
    fn policy_provider_stays_paired_with_a_pi_model_for_compilation() {
        let main: GraphNodeIntent = serde_json::from_value(
            json!({"id":"main","title":"Task","harness":"pi","model":"main-model","prompt":"Task"}),
        )
        .unwrap();
        let mut run = Run {
            id: "provider-test".into(),
            workspace_id: "ws".into(),
            main,
            policy: GraphPolicy::default(),
            status: "running".into(),
            phase: "test".into(),
            iteration: 1,
            steps: vec![],
            started_at: String::new(),
            updated_at: String::new(),
            error: None,
        };
        run.steps.push(new_step(&run));
        let node = node_for_step(
            &run,
            &GraphRuntimeRef {
                harness: "pi".into(),
                model: "gpt-5.6-luna".into(),
                provider: Some("openai-codex".into()),
            },
        );
        assert_eq!(node.model, "openai-codex/gpt-5.6-luna");
        assert!(node.provider.is_none());
    }

    #[test]
    fn subagent_does_not_inherit_the_main_provider_binding() {
        let main: GraphNodeIntent = serde_json::from_value(json!({"id":"main","title":"Task","harness":"pi","model":"main-model","prompt":"Task","provider":{"baseUrl":"https://example.com/v1","apiKeyEnv":"MAIN_KEY"}})).unwrap();
        let mut run = Run {
            id: "provider-test".into(),
            workspace_id: "ws".into(),
            main,
            policy: GraphPolicy::default(),
            status: "running".into(),
            phase: "test".into(),
            iteration: 1,
            steps: vec![],
            started_at: String::new(),
            updated_at: String::new(),
            error: None,
        };
        run.steps.push(new_step(&run));
        let node = node_for_step(
            &run,
            &GraphRuntimeRef {
                harness: "pi".into(),
                model: "different-provider/model".into(),
                provider: None,
            },
        );
        assert!(node.provider.is_none());
        assert_eq!(node.model, "different-provider/model");
        assert!(
            node.prompt
                .contains("Do not spawn subagents: maximum depth is 1")
        );
        run.phase = "main".into();
        run.policy.delegate = true;
        let main = node_for_step(
            &run,
            &GraphRuntimeRef {
                harness: "pi".into(),
                model: "main-model".into(),
                provider: None,
            },
        );
        assert!(main.provider.is_some());
        assert!(
            main.prompt
                .contains("Delegation is available, not mandatory")
        );
        assert!(main.prompt.contains("`gh` commands"));
        assert!(main.prompt.contains("may make them yourself"));
        assert!(main.prompt.contains("immutable Subagent policy snapshot"));
        assert!(
            main.prompt
                .contains("main agent, not a Bot dispatcher or a depth-one worker")
        );
        assert!(
            main.prompt
                .contains("does not consume your child-depth budget")
        );
        assert!(
            main.prompt
                .contains("orchestration run-create, task-create and worker-start")
        );
        assert!(main.prompt.contains("children must not"));
        assert!(
            main.prompt
                .contains("drogon-cli graph read --workspace ws --json")
        );
        assert!(
            main.prompt
                .contains("drogon-cli graph observability --workspace ws --json")
        );

        run.policy.delegate = false;
        run.policy.adversarial.enabled = true;
        let adversarial = node_for_step(
            &run,
            &GraphRuntimeRef {
                harness: "pi".into(),
                model: "main-model".into(),
                provider: None,
            },
        );
        assert!(
            adversarial
                .prompt
                .contains("Never delegate a simple lookup")
        );
        assert!(
            adversarial
                .prompt
                .contains("daemon launches the final whole-workflow")
        );

        run.policy.adversarial.enabled = false;
        let direct = node_for_step(
            &run,
            &GraphRuntimeRef {
                harness: "pi".into(),
                model: "main-model".into(),
                provider: None,
            },
        );
        assert!(
            direct
                .prompt
                .contains("explicit user request to delegate may authorize one")
        );
    }
}
