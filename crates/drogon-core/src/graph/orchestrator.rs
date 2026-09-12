//! Durable, depth-one orchestration. The daemon advances receipts, never a UI timer.
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use super::{compiler, failover, store};
use crate::mentu::{execution, storage};
use crate::{Engine, error};
use drogon_protocol::graph::{
    GraphFailoverAttemptRecord, GraphIntent, GraphNodeIntent, GraphOrchestratorRun as Run,
    GraphOrchestratorStep as Step, GraphPolicy, GraphRuntimeRef,
};
use drogon_protocol::mentu::MentuRunStatus;
use drogon_protocol::{Request, RpcError};
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

fn parse<T: serde::de::DeserializeOwned>(value: &Value) -> Result<T, RpcError> {
    serde_json::from_value(value.clone()).map_err(|e| error::invalid_argument(e.to_string()))
}

impl Engine {
    fn save_orchestrator(&self, run: &mut Run) -> Result<(), RpcError> {
        run.updated_at = crate::now_rfc3339();
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

    pub(crate) fn graph_write_policy(&self, request: &Request) -> Result<Value, RpcError> {
        self.mutating(request, |engine, params| {
            let parsed: Policy = parse(params)?;
            parsed.policy.validate()?;
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
            if engine.orchestrator_runs()?.iter().any(|run| {
                run.workspace_id == parsed.workspace_id
                    && matches!(run.status.as_str(), "running" | "stopping" | "unverifiable")
            }) {
                return Err(error::invalid_argument(
                    "This workspace already has an active or unverifiable workflow.",
                ));
            }
            let policy = store::read_graph(&path)?.intent.policy;
            policy.validate()?;
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
                updated_at: now,
                error: None,
            };
            run.steps.push(new_step(&run));
            engine.save_orchestrator(&mut run)?;
            Ok(json!({"run":run}))
        })
    }

    pub(crate) fn graph_orchestrator_status(&self, params: &Value) -> Result<Value, RpcError> {
        let parsed: Workspace = parse(params)?;
        self.workspace_path(&parsed.workspace_id)?;
        let _gate = self.graph_orchestrator_gate.lock().unwrap();
        Ok(
            json!({"run":self.orchestrator_runs()?.into_iter().find(|run| run.workspace_id == parsed.workspace_id)}),
        )
    }

    pub(crate) fn graph_orchestrator_stop(&self, request: &Request) -> Result<Value, RpcError> {
        self.mutating(request, |engine, params| {
            let parsed: Control = parse(params)?;
            let _gate = engine.graph_orchestrator_gate.lock().unwrap();
            let mut run = engine.find_orchestrator(&parsed)?;
            if matches!(run.status.as_str(), "running" | "unverifiable") {
                if let Some(id) = run.steps.last().and_then(|step| step.run_id.as_ref()) {
                    if execution::is_tracked(id) {
                        execution::cancel(id);
                        run.status = "stopping".into();
                    } else {
                        let child = storage::get_run(&engine.db.lock().unwrap(), id)?;
                        if child
                            .as_ref()
                            .is_some_and(|child| child.status == MentuRunStatus::Succeeded)
                        {
                            let step = run.steps.last_mut().unwrap();
                            let verdict = if step.phase == "main" {
                                Some("pass".into())
                            } else {
                                read_verdict(
                                    &engine.workspace_path(&run.workspace_id)?,
                                    &step.node_id,
                                )?
                            };
                            if let Some(verdict) = verdict {
                                step.status = "succeeded".into();
                                step.verdict = Some(verdict);
                                if let Some(attempt) = step.attempts.last_mut() {
                                    attempt.outcome = "succeeded".into();
                                }
                                finish_step(&mut run);
                                if run.status == "running" {
                                    run.status = "stopped".into();
                                }
                            } else {
                                run.status = "stopped".into();
                            }
                        } else {
                            run.status = if child.is_some_and(|child| {
                                matches!(
                                    child.status,
                                    MentuRunStatus::Failed | MentuRunStatus::Cancelled
                                )
                            }) {
                                "stopped"
                            } else {
                                "unverifiable"
                            }
                            .into();
                        }
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
            if let Err(err) = self.advance_orchestrator(&mut run) {
                run.status = "failed".into();
                run.error = Some(err.message);
            }
            self.save_orchestrator(&mut run)?;
        }
        Ok(())
    }

    fn advance_orchestrator(&self, run: &mut Run) -> Result<(), RpcError> {
        let root = self.workspace_path(&run.workspace_id)?;
        let step = run.steps.last_mut().expect("workflow has a step");
        if step.status == "dispatching" {
            run.status = "unverifiable".into();
            run.error = Some("Daemon interrupted during launch; no retry is safe without confirming the worker exited.".into());
            return Ok(());
        }
        if let Some(id) = &step.run_id {
            let child = storage::get_run(&self.db.lock().unwrap(), id)?;
            let Some(child) = child else {
                step.status = "unverifiable".into();
                run.status = "unverifiable".into();
                return Ok(());
            };
            if child.status == MentuRunStatus::Unavailable {
                step.status = "unverifiable".into();
                run.status = "unverifiable".into();
                return Ok(());
            }
            if child.status == MentuRunStatus::Running {
                if !execution::is_tracked(id) {
                    step.status = "unverifiable".into();
                    run.status = "unverifiable".into();
                }
                return Ok(());
            }
            if execution::is_tracked(id) {
                return Ok(());
            }
            if run.status == "stopping" || child.status == MentuRunStatus::Cancelled {
                run.status = "stopped".into();
                step.status = "stopped".into();
                return Ok(());
            }
            if child.status == MentuRunStatus::Succeeded {
                let verdict = if run.phase == "main" {
                    Some("pass".to_string())
                } else {
                    read_verdict(&root, &step.node_id)?
                };
                if let Some(verdict) = verdict {
                    step.status = "succeeded".into();
                    step.verdict = Some(verdict);
                    if let Some(attempt) = step.attempts.last_mut() {
                        attempt.outcome = "succeeded".into();
                    }
                    finish_step(run);
                    return Ok(());
                }
            }
            if let Some(attempt) = step.attempts.last_mut() {
                attempt.outcome = "failed".into();
                attempt.reason =
                    Some(child.error.unwrap_or_else(|| {
                        "Worker did not produce a valid evaluation result.".into()
                    }));
            }
            step.run_id = None;
            step.status = "pending".into();
        }
        if run.status == "stopping" {
            run.status = "stopped".into();
            return Ok(());
        }
        let candidates = if run.phase == "main" {
            vec![GraphRuntimeRef {
                harness: run.main.harness.clone(),
                model: run.main.model.clone(),
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
        let result_path = root.join(result_path(&node.id));
        std::fs::create_dir_all(result_path.parent().unwrap())
            .map_err(|e| error::io_error(e.to_string()))?;
        // Each attempt must write fresh evidence; an earlier attempt cannot certify it.
        if result_path.exists() {
            std::fs::remove_file(&result_path).map_err(|e| error::io_error(e.to_string()))?;
        }
        let intent = GraphIntent {
            nodes: vec![node.clone()],
            policy: run.policy.clone(),
        };
        let launched = (|| {
            let mut compiled = compiler::compile(
                &intent,
                &compiler::Selection::Target(node.id.clone()),
                &compiler::PiProviderDefaults::from_env(),
            )?;
            let runtime = crate::mentu::runtime::require_verified_runtime(self.data_dir())?;
            compiler::validate_and_persist(&runtime, &root, &mut compiled)?;
            if let Some(finding) = compiled.findings.iter().find(|finding| finding.is_error()) {
                return Err(error::invalid_argument(finding.message.clone()));
            }
            run.steps.last_mut().unwrap().status = "dispatching".into();
            self.save_orchestrator(run)?;
            self.launch_compiled(&run.workspace_id, &[node.id], &mut compiled)
        })();
        let step = run.steps.last_mut().unwrap();
        step.runtime = Some(candidate.clone());
        step.is_fallback =
            run.phase != "main" && failover::is_fallback_attempt(&run.policy, step.attempts.len());
        match launched {
            Ok(child) => {
                step.run_id = Some(child.id);
                step.status = "running".into();
                step.attempts.push(GraphFailoverAttemptRecord {
                    harness: candidate.harness,
                    model: candidate.model,
                    outcome: "launched".into(),
                    reason: None,
                });
            }
            Err(err) => {
                step.status = "pending".into();
                step.attempts.push(GraphFailoverAttemptRecord {
                    harness: candidate.harness,
                    model: candidate.model,
                    outcome: "launch_failed".into(),
                    reason: Some(err.message),
                });
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

fn read_verdict(root: &std::path::Path, node_id: &str) -> Result<Option<String>, RpcError> {
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
    if !value
        .get("evidence")
        .and_then(Value::as_str)
        .is_some_and(|evidence| !evidence.trim().is_empty())
    {
        return Ok(None);
    }
    Ok(value
        .get("verdict")
        .and_then(Value::as_str)
        .filter(|v| matches!(*v, "pass" | "findings"))
        .map(str::to_string))
}

fn node_for_step(run: &Run, candidate: &GraphRuntimeRef) -> GraphNodeIntent {
    let step = run.steps.last().unwrap();
    let mut node = run.main.clone();
    node.id = step.node_id.clone();
    node.harness = candidate.harness.clone();
    node.model = candidate.model.clone();
    node.depends_on.clear();
    if run.phase == "main" && node.harness != "shell" {
        if run.policy.delegate {
            node.prompt.push_str("\nPlan and delegate the implementation to depth-one Drogon nodes using the approved policy below; coordinate and review their results.");
        }
        node.prompt.push_str(&format!(
            "\n\nDrogon run {}: immutable Subagent policy snapshot\n{}\n\
             If you delegate, use Drogon graph CLI declared nodes (see `drogon-cli graph --help`) \
             and explicit harness/model pairs from this snapshot. Try approved pairs in their \
             configured order; use fallback only after every approved runtime fails to execute. \
             Findings are successful evaluations and do not trigger runtime failover. Do not use \
             native ungoverned subagent spawns. Maximum subagent depth is one: children must not \
             delegate further. Workspace policy edits apply to future runs; do not substitute them \
             for this snapshot. The daemon owns any enabled adversarial loop; do not launch duplicate \
             test/review workers yourself.", run.id, serde_json::to_string(&run.policy).expect("policy serializes")
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
        node.verify_commands.clear();
        let role = if run.phase == "test" {
            "Test adversarially. Run real tests and record reproducible findings. Do not modify product code."
        } else {
            "Independently review code, read the adversarial test evidence for this iteration, fix findings, and verify corrections. Report findings if any remain or if you changed product code: the next iteration must retest it."
        };
        node.prompt = format!(
            "{role}\nTask: {}\nIteration {} of {}. Read prior evidence in .drogon/evaluations/ for workflow {}. Do not spawn subagents: maximum depth is 1.\nWrite {} as JSON with verdict (exactly pass or findings) and evidence (what was tested/reviewed and findings). A findings verdict is a successful evaluation, not a process error. Exit normally after recording either verdict.",
            run.main.prompt,
            run.iteration,
            run.policy.adversarial.max_iterations,
            run.id,
            result_path(&node.id)
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
            if let Err(err) = engine.tick_graph_orchestrator() {
                eprintln!("Graph orchestrator: {}", err.message);
            }
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
            assert_eq!(read_verdict(root.path(), "test").unwrap(), None);
        }
        for verdict in ["pass", "findings"] {
            std::fs::write(
                &path,
                json!({"verdict":verdict,"evidence":"ran tests"}).to_string(),
            )
            .unwrap();
            assert_eq!(
                read_verdict(root.path(), "test").unwrap().as_deref(),
                Some(verdict)
            );
        }
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
            },
        );
        assert!(node.provider.is_none());
        assert_eq!(node.model, "different-provider/model");
        run.phase = "main".into();
        run.policy.delegate = true;
        let main = node_for_step(
            &run,
            &GraphRuntimeRef {
                harness: "pi".into(),
                model: "main-model".into(),
            },
        );
        assert!(main.provider.is_some());
        assert!(main.prompt.contains("Plan and delegate the implementation"));
        assert!(main.prompt.contains("immutable Subagent policy snapshot"));
        assert!(main.prompt.contains("children must not"));
    }
}
