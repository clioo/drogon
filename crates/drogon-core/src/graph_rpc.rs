//! `graph.*` RPC glue: validates params, resolves the workspace, projects the
//! daemon-owned `state` half from real observation, and delegates to
//! `crate::graph::{store, compiler, state, storage}`. Registered in `lib.rs`'s
//! `CAPABILITIES` and `dispatch_inner`.
//!
//! Ownership split at the seam: `graph.write_intent` refuses any payload that
//! carries `state`; `state` is only ever written by
//! [`Engine::refresh_graph_state`], which never writes `intent`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use drogon_protocol::graph::{
    Graph, GraphCompileParams, GraphCompileResult, GraphIntent, GraphNodeParams,
    GraphNodeStateResult, GraphResumeResult, GraphRetryStepParams, GraphRunResult, GraphState,
    GraphWorkspaceParams, GraphWriteIntentParams,
};
use drogon_protocol::mentu::MentuApproval;
use drogon_protocol::{Request, RpcError};
use serde_json::Value;

use crate::graph::{compiler, state, storage, store};
use crate::mentu::{execution, storage as mentu_storage};
use crate::{Engine, error, workspace};

fn parse<T: serde::de::DeserializeOwned>(params: &Value, what: &str) -> Result<T, RpcError> {
    serde_json::from_value(params.clone())
        .map_err(|_| error::invalid_argument(format!("Invalid {what} params.")))
}

fn to_value<T: serde::Serialize>(value: T) -> Result<Value, RpcError> {
    serde_json::to_value(value).map_err(|e| error::internal_error(e.to_string()))
}

impl Engine {
    fn workspace_path(&self, workspace_id: &str) -> Result<PathBuf, RpcError> {
        let conn = self.db.lock().unwrap();
        workspace::get_path(&conn, workspace_id).map(PathBuf::from)
    }

    /// The projected `state` half for a workspace, written back when it
    /// changed. Read-only from the ledger's point of view: it mutates only
    /// the daemon-owned half, never `intent`.
    fn refresh_graph_state(
        &self,
        workspace_id: &str,
        workspace_root: &Path,
        intent: &GraphIntent,
    ) -> Result<GraphState, RpcError> {
        let (mappings, runs) = {
            let conn = self.db.lock().unwrap();
            let mappings = storage::latest_node_runs(&conn, workspace_id)?;
            let mut runs: HashMap<String, drogon_protocol::mentu::MentuRun> = HashMap::new();
            for mapping in &mappings {
                if runs.contains_key(&mapping.run_id) {
                    continue;
                }
                if let Some(run) = mentu_storage::get_run(&conn, &mapping.run_id)? {
                    runs.insert(mapping.run_id.clone(), run);
                }
            }
            (mappings, runs)
        };
        let projected = state::project(
            intent,
            &mappings,
            &runs,
            &execution::is_tracked,
            &crate::now_rfc3339(),
        );
        store::write_state_if_changed(workspace_root, &projected)?;
        Ok(projected)
    }

    pub(crate) fn graph_read(&self, params: &Value) -> Result<Value, RpcError> {
        let parsed: GraphWorkspaceParams = parse(params, "graph.read")?;
        parsed.validate()?;
        let workspace_root = self.workspace_path(&parsed.workspace_id)?;
        let mut graph = store::read_graph(&workspace_root)?;
        graph.state =
            self.refresh_graph_state(&parsed.workspace_id, &workspace_root, &graph.intent)?;
        to_value(drogon_protocol::graph::GraphResult { graph })
    }

    pub(crate) fn graph_node_state(&self, params: &Value) -> Result<Value, RpcError> {
        let parsed: GraphNodeParams = parse(params, "graph.node_state")?;
        parsed.validate()?;
        let workspace_root = self.workspace_path(&parsed.workspace_id)?;
        let graph = store::read_graph(&workspace_root)?;
        let projected =
            self.refresh_graph_state(&parsed.workspace_id, &workspace_root, &graph.intent)?;
        let node_state = projected
            .nodes
            .into_iter()
            .find(|node| node.id == parsed.node_id)
            .ok_or_else(|| {
                error::not_found(format!("The graph has no node '{}'.", parsed.node_id))
            })?;
        to_value(GraphNodeStateResult { state: node_state })
    }

    pub(crate) fn graph_write_intent(&self, request: &Request) -> Result<Value, RpcError> {
        self.mutating(request, Self::do_graph_write_intent)
    }

    fn do_graph_write_intent(&self, params: &Value) -> Result<Value, RpcError> {
        // The refusal must happen on the raw params, before deserialization
        // can ignore a sibling `state` key.
        if params.get("state").is_some() {
            return Err(error::invalid_argument(
                "`state` is owned by the daemon and cannot be written through graph.write_intent; \
                 only the daemon observes and records it.",
            ));
        }
        let parsed: GraphWriteIntentParams = parse(params, "graph.write_intent")?;
        parsed.validate()?;
        let workspace_root = self.workspace_path(&parsed.workspace_id)?;
        let graph = store::write_intent(&workspace_root, &parsed.intent)?;
        let graph = Graph {
            state: self.refresh_graph_state(
                &parsed.workspace_id,
                &workspace_root,
                &graph.intent,
            )?,
            ..graph
        };
        to_value(drogon_protocol::graph::GraphResult { graph })
    }

    pub(crate) fn graph_compile(&self, params: &Value) -> Result<Value, RpcError> {
        let parsed: GraphCompileParams = parse(params, "graph.compile")?;
        parsed.validate()?;
        let workspace_root = self.workspace_path(&parsed.workspace_id)?;
        let graph = store::read_graph(&workspace_root)?;
        let mut compiled = self.compile_for(&workspace_root, &graph.intent, &parsed)?;
        to_value(compile_result(&mut compiled))
    }

    pub(crate) fn graph_run(&self, request: &Request) -> Result<Value, RpcError> {
        self.mutating(request, Self::do_graph_run)
    }

    fn do_graph_run(&self, params: &Value) -> Result<Value, RpcError> {
        let parsed: GraphCompileParams = parse(params, "graph.run")?;
        parsed.validate()?;
        let workspace_root = self.workspace_path(&parsed.workspace_id)?;
        let graph = store::read_graph(&workspace_root)?;
        let mut compiled = self.compile_for(&workspace_root, &graph.intent, &parsed)?;
        if let Some(refusal) = error_findings(&compiled.findings) {
            return Err(error::invalid_argument(format!(
                "The compiled graph would not validate, so it was not executed: {refusal}"
            )));
        }
        let node_ids = compiled.node_ids();
        // Never launch a second worker into a node that is still live.
        if let Some(node) = self.running_node(&parsed.workspace_id, &node_ids)? {
            return Err(error::invalid_argument(format!(
                "Node '{node}' already has a live run; stop it or wait for it before launching \
                 this subgraph again."
            )));
        }
        let run = self.launch_compiled(&parsed.workspace_id, &node_ids, &mut compiled)?;
        // Show the launch immediately: the daemon half must not wait for the
        // first read to report that a node is running.
        self.refresh_graph_state(&parsed.workspace_id, &workspace_root, &graph.intent)?;
        to_value(GraphRunResult {
            run,
            compile: compile_result(&mut compiled),
        })
    }

    pub(crate) fn graph_resume_node(&self, request: &Request) -> Result<Value, RpcError> {
        self.mutating(request, Self::do_graph_resume_node)
    }

    fn do_graph_resume_node(&self, params: &Value) -> Result<Value, RpcError> {
        let parsed: GraphNodeParams = parse(params, "graph.resume_node")?;
        parsed.validate()?;
        self.relaunch_node(&parsed, None)
    }

    pub(crate) fn graph_retry_step(&self, request: &Request) -> Result<Value, RpcError> {
        self.mutating(request, Self::do_graph_retry_step)
    }

    fn do_graph_retry_step(&self, params: &Value) -> Result<Value, RpcError> {
        let parsed: GraphRetryStepParams = parse(params, "graph.retry_step")?;
        parsed.validate()?;
        let step = parsed
            .step
            .clone()
            .unwrap_or_else(|| parsed.node_id.clone());
        let node_params = GraphNodeParams {
            workspace_id: parsed.workspace_id.clone(),
            node_id: parsed.node_id.clone(),
        };
        self.relaunch_node(&node_params, Some(&step))
    }

    /// Shared node-level resume/retry-step: resolves the node's latest run and
    /// relaunches it through the runtime's own `resume`/`retry-step`.
    fn relaunch_node(
        &self,
        parsed: &GraphNodeParams,
        step: Option<&str>,
    ) -> Result<Value, RpcError> {
        let workspace_root = self.workspace_path(&parsed.workspace_id)?;
        let mapping = {
            let conn = self.db.lock().unwrap();
            storage::latest_node_run(&conn, &parsed.workspace_id, &parsed.node_id)?
        }
        .ok_or_else(|| {
            error::not_found(format!(
                "Node '{}' has no run to resume or retry yet.",
                parsed.node_id
            ))
        })?;
        let run = self.relaunch_run(&mapping.run_id, step)?;
        // A relaunch changes what is observed; refresh the daemon half now so
        // the graph reports `running` without waiting for a read. The
        // node→run mapping is recorded by `relaunch_run`, which knows the
        // prior run's node set.
        let graph = store::read_graph(&workspace_root)?;
        self.refresh_graph_state(&parsed.workspace_id, &workspace_root, &graph.intent)?;
        to_value(GraphResumeResult { run })
    }

    /// Compiles and persists+validates the emitted recipe for `params`.
    fn compile_for(
        &self,
        workspace_root: &Path,
        intent: &GraphIntent,
        params: &GraphCompileParams,
    ) -> Result<compiler::CompiledGraph, RpcError> {
        let selection = match &params.node_id {
            Some(id) => compiler::Selection::Target(id.clone()),
            None => compiler::Selection::Explicit(params.node_ids.clone()),
        };
        let mut compiled = compiler::compile(
            intent,
            &selection,
            &compiler::PiProviderDefaults::from_env(),
        )?;
        let runtime_path = crate::mentu::runtime::require_verified_runtime(self.data_dir())?;
        compiler::validate_and_persist(runtime_path.as_path(), workspace_root, &mut compiled)?;
        Ok(compiled)
    }

    /// Mints the daemon's approval for the compiled bytes (the human declared
    /// the intent and pressed run; the daemon records its own consent) and
    /// launches through the one existing `mentu.run` path, then records the
    /// node→run mapping the state projector reads.
    fn launch_compiled(
        &self,
        workspace_id: &str,
        node_ids: &[String],
        compiled: &mut compiler::CompiledGraph,
    ) -> Result<drogon_protocol::mentu::MentuRun, RpcError> {
        let approval = MentuApproval {
            id: uuid::Uuid::new_v4().to_string(),
            workspace_id: workspace_id.to_string(),
            recipe_id: compiled.recipe_id.clone(),
            content_hash: compiled.content_hash.clone(),
            approved_at: crate::now_rfc3339(),
        };
        {
            let conn = self.db.lock().unwrap();
            mentu_storage::insert_approval(&conn, &approval)?;
        }
        let run = self.launch_approved_recipe(workspace_id, &compiled.recipe_id, &approval.id)?;
        {
            let conn = self.db.lock().unwrap();
            storage::record_node_run(
                &conn,
                workspace_id,
                &run.id,
                &crate::now_rfc3339(),
                node_ids,
            )?;
        }
        Ok(run)
    }

    /// The first compiled node whose latest run has a confirmed live child.
    fn running_node(
        &self,
        workspace_id: &str,
        node_ids: &[String],
    ) -> Result<Option<String>, RpcError> {
        let conn = self.db.lock().unwrap();
        for node_id in node_ids {
            let Some(mapping) = storage::latest_node_run(&conn, workspace_id, node_id)? else {
                continue;
            };
            let Some(run) = mentu_storage::get_run(&conn, &mapping.run_id)? else {
                continue;
            };
            if run.status == drogon_protocol::mentu::MentuRunStatus::Running
                && execution::is_tracked(&run.id)
            {
                return Ok(Some(node_id.clone()));
            }
        }
        Ok(None)
    }
}

fn compile_result(compiled: &mut compiler::CompiledGraph) -> GraphCompileResult {
    GraphCompileResult {
        recipe_id: compiled.recipe_id.clone(),
        recipe: compiled.recipe.clone(),
        content_hash: compiled.content_hash.clone(),
        node_ids: compiled.node_ids(),
        findings: compiled.findings.clone(),
    }
}

/// The error-severity findings rendered as one refusal reason.
fn error_findings(findings: &[drogon_protocol::graph::GraphFinding]) -> Option<String> {
    let errors: Vec<String> = findings
        .iter()
        .filter(|finding| finding.is_error())
        .map(|finding| match &finding.node_id {
            Some(node) => format!("{} ({node}): {}", finding.code, finding.message),
            None => format!("{}: {}", finding.code, finding.message),
        })
        .collect();
    if errors.is_empty() {
        None
    } else {
        Some(errors.join("; "))
    }
}
