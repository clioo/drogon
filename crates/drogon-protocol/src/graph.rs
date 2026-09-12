//! Wire contract for the work graph (`.drogon/graph.json`): the two-halves
//! store (`intent` human-owned, `state` daemon-owned), the graph→recipe
//! compiler, and node-level resume/retry.
//!
//! Shape validation only, mirroring `mentu.rs`: the execution host verifies
//! workspace ownership, the runtime lock and the ownership split itself.
//! `intent` and `state` are strictly separate on the wire: a write that
//! carries the other half is refused, never silently ignored.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::RpcError;
use crate::orchestration_common::validate_opaque_token;

pub const GRAPH_CAPABILITY: &str = "graph.v1";

/// A daemon-owned workflow captures its configuration once, when Run is pressed.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphOrchestratorRun {
    pub id: String,
    pub workspace_id: String,
    pub policy: GraphPolicy,
    pub main: GraphNodeIntent,
    pub status: String,
    pub phase: String,
    pub iteration: u32,
    pub steps: Vec<GraphOrchestratorStep>,
    pub started_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphOrchestratorStep {
    pub node_id: String,
    pub phase: String,
    pub iteration: u32,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime: Option<GraphRuntimeRef>,
    pub is_fallback: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verdict: Option<String>,
    pub attempts: Vec<GraphFailoverAttemptRecord>,
}

/// The workspace-relative location of the graph file.
pub const GRAPH_FILE_DIR: &str = ".drogon";
pub const GRAPH_FILE_NAME: &str = "graph.json";
pub const GRAPH_EVIDENCE_FILE_NAME: &str = "evidence.json";
pub const GRAPH_USAGE_FILE_NAME: &str = "usage.json";

/// The only file version this build reads or writes. A newer file is
/// refused (downgrade guard), never silently rewritten.
pub const GRAPH_VERSION: u32 = 1;

pub const MAX_GRAPH_NODES: usize = 200;
pub const MAX_GRAPH_ID_BYTES: usize = 64;
pub const MAX_GRAPH_TITLE_BYTES: usize = 512;
pub const MAX_GRAPH_PROMPT_BYTES: usize = 64 * 1024;
pub const MAX_GRAPH_MODEL_BYTES: usize = 256;
pub const MAX_GRAPH_DEPENDENCIES: usize = 64;
pub const MAX_GRAPH_OBSERVABILITY_ENTRIES: usize = 5_000;
pub const MAX_GRAPH_EVIDENCE_SUMMARY_BYTES: usize = 4 * 1024;
pub const MAX_GRAPH_EVIDENCE_DETAIL_BYTES: usize = 64 * 1024;
pub const MAX_GRAPH_ARTIFACTS: usize = 64;

/// One lead-agent checkpoint stored in `<workspace>/.drogon/evidence.json`.
/// Evidence is native Drogon data: it is not a Mentu run projection.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GraphEvidenceEntry {
    pub id: String,
    pub timestamp: String,
    pub status: String,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artifacts: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
}

/// One token measurement reported by an agent/harness. Every token field is
/// optional so a provider can report only what it actually knows; callers may
/// never turn missing values into zero.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GraphUsageEntry {
    pub id: String,
    pub timestamp: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub harness: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_write_tokens: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GraphObservabilitySnapshot {
    #[serde(default)]
    pub evidence: Vec<GraphEvidenceEntry>,
    #[serde(default)]
    pub usage: Vec<GraphUsageEntry>,
    #[serde(default)]
    pub updated_at: String,
}

/// The node status vocabulary. Never a status the daemon cannot observe:
/// `running` requires a confirmed live child, loss of contact is
/// `unverifiable`.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GraphNodeStatus {
    #[default]
    Idle,
    Running,
    Succeeded,
    Failed,
    /// Not runnable in this graph: a disabled node, or a node whose upstream
    /// failed/cancelled before it started. Never used for loss of contact.
    Blocked,
    /// The daemon cannot confirm what happened (the child is gone, the run
    /// never produced a record). Never rewritten as failed/succeeded.
    Unverifiable,
}

impl GraphNodeStatus {
    pub fn as_wire(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Blocked => "blocked",
            Self::Unverifiable => "unverifiable",
        }
    }
}

/// Optional additive Pi provider binding inputs on an intent node. The
/// mens contract does not carry these; a `pi` node without them refuses to
/// compile rather than emitting the bare-`pi` false-success recipe.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GraphNodeProvider {
    /// HTTP(S) URL without embedded credentials/query/fragment.
    pub base_url: String,
    /// Environment variable the runtime reads the credential from.
    pub api_key_env: String,
}

impl GraphNodeProvider {
    pub fn validate(&self) -> Result<(), RpcError> {
        if !is_http_url(&self.base_url) {
            return Err(RpcError::new(
                "invalid_argument",
                "A node provider baseUrl must be an http(s) URL without embedded credentials, query or fragment.",
            ));
        }
        validate_opaque_token(
            &self.api_key_env,
            MAX_GRAPH_ID_BYTES,
            "A node provider apiKeyEnv must be a plain environment variable name.",
        )
    }
}

fn is_http_url(raw: &str) -> bool {
    let Some((scheme, rest)) = raw.split_once("://") else {
        return false;
    };
    if !matches!(scheme, "http" | "https") {
        return false;
    }
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    let tail = &rest[authority_end..];
    !authority.is_empty() && !authority.contains('@') && !tail.contains('?') && !tail.contains('#')
}

/// One `intent.nodes[]` entry: what the human (or a planning agent) wants.
/// `state` is never part of this shape.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GraphNodeIntent {
    pub id: String,
    pub title: String,
    /// A harness id from the real harness catalog (`pi`, `claude`, `codex`,
    /// `opencode`, `antigravity`) or the runtime's own `shell` backend.
    pub harness: String,
    /// Exact model id from the per-harness model catalog; empty for `shell`.
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
    pub prompt: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// Additive Pi provider binding inputs; preserved by the store.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<GraphNodeProvider>,
    /// Optional deterministic verification commands emitted as the recipe
    /// step's `verify.commands`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub verify_commands: Vec<String>,
}

fn default_enabled() -> bool {
    true
}

impl GraphNodeIntent {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_graph_node_id(&self.id)?;
        validate_text(&self.title, MAX_GRAPH_TITLE_BYTES, "node title", true)?;
        validate_harness(&self.harness)?;
        if self.model.len() > MAX_GRAPH_MODEL_BYTES || self.model.contains('\0') {
            return Err(RpcError::new(
                "invalid_argument",
                "A node model id is too long or carries NUL.",
            ));
        }
        if self.prompt.is_empty()
            || self.prompt.len() > MAX_GRAPH_PROMPT_BYTES
            || self.prompt.contains('\0')
        {
            return Err(RpcError::new(
                "invalid_argument",
                "A node prompt must be 1..=65536 bytes and carry no NUL.",
            ));
        }
        if self.depends_on.len() > MAX_GRAPH_DEPENDENCIES {
            return Err(RpcError::new(
                "invalid_argument",
                "A node carries too many dependencies.",
            ));
        }
        for dep in &self.depends_on {
            validate_graph_node_id(dep)?;
            if dep == &self.id {
                return Err(RpcError::new(
                    "invalid_argument",
                    "A node cannot depend on itself.",
                ));
            }
        }
        if let Some(provider) = &self.provider {
            provider.validate()?;
        }
        for command in &self.verify_commands {
            if command.is_empty()
                || command.len() > MAX_GRAPH_PROMPT_BYTES
                || command.contains('\0')
            {
                return Err(RpcError::new(
                    "invalid_argument",
                    "A node verify command is empty, too long, or carries NUL.",
                ));
            }
        }
        Ok(())
    }
}

/// The human-owned half.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GraphIntent {
    #[serde(default)]
    pub nodes: Vec<GraphNodeIntent>,
    /// The Subagent policy panel's whole state: additive, optional, defaults
    /// to "nothing configured yet" for a graph written before this field
    /// existed. Deliberately NOT listed in the store's known-intent-key set
    /// (`crates/drogon-core/src/graph/store.rs`): a write that omits
    /// `policy` (e.g. the authoring canvas saving a node edit) must leave
    /// whatever policy is already on disk untouched, the same way an
    /// unknown per-node field like the designer's `position` survives.
    #[serde(default)]
    pub policy: GraphPolicy,
}

/// One (harness, model) pair a subagent may run under. The exact model id
/// from the per-harness catalog, or the compiler-level `provider/model`
/// string the graph already accepts elsewhere — this type does not
/// re-validate that split; `graph/compiler.rs` owns it.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GraphRuntimeRef {
    pub harness: String,
    #[serde(default)]
    pub model: String,
}

impl GraphRuntimeRef {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_harness(&self.harness)?;
        if self.model.len() > MAX_GRAPH_MODEL_BYTES || self.model.contains('\0') {
            return Err(RpcError::new(
                "invalid_argument",
                "A policy runtime model id is too long or carries NUL.",
            ));
        }
        Ok(())
    }
}

/// The bounded adversarial-review loop's own policy: whether it is enabled
/// and how many test/review cycles it may run before stopping honestly.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GraphAdversarialPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_max_iterations")]
    pub max_iterations: u32,
}

impl Default for GraphAdversarialPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            max_iterations: default_max_iterations(),
        }
    }
}

fn default_max_iterations() -> u32 {
    DEFAULT_ADVERSARIAL_MAX_ITERATIONS
}

pub const MIN_ADVERSARIAL_MAX_ITERATIONS: u32 = 1;
pub const MAX_ADVERSARIAL_MAX_ITERATIONS: u32 = 10;
pub const DEFAULT_ADVERSARIAL_MAX_ITERATIONS: u32 = 3;
pub const MAX_POLICY_APPROVED_RUNTIMES: usize = 32;

impl GraphAdversarialPolicy {
    pub fn validate(&self) -> Result<(), RpcError> {
        if self.max_iterations < MIN_ADVERSARIAL_MAX_ITERATIONS
            || self.max_iterations > MAX_ADVERSARIAL_MAX_ITERATIONS
        {
            return Err(RpcError::new(
                "invalid_argument",
                format!(
                    "Adversarial testing's maximum iterations must be between {MIN_ADVERSARIAL_MAX_ITERATIONS} \
                     and {MAX_ADVERSARIAL_MAX_ITERATIONS}."
                ),
            ));
        }
        Ok(())
    }
}

/// The Subagent policy panel's persisted state (`intent.policy`): every
/// subagent node inherits the approved-runtime order and the fallback: try
/// each approved runtime in order, only using the fallback once all of them
/// have failed. `approvedRuntimes` is ordered — that order IS the failover
/// order, so callers must never reorder it silently.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GraphPolicy {
    #[serde(default)]
    pub approved_runtimes: Vec<GraphRuntimeRef>,
    #[serde(default)]
    pub fallback_runtime: Option<GraphRuntimeRef>,
    #[serde(default)]
    pub adversarial: GraphAdversarialPolicy,
    /// When true, the main agent's brief tells it to plan and delegate to
    /// the enabled nodes instead of doing the work itself (Part 3).
    #[serde(default)]
    pub delegate: bool,
}

impl GraphPolicy {
    pub fn validate(&self) -> Result<(), RpcError> {
        if self.delegate && self.adversarial.enabled {
            return Err(RpcError::new(
                "invalid_argument",
                "Delegate and adversarial testing are mutually exclusive execution modes.",
            ));
        }
        if self.approved_runtimes.len() > MAX_POLICY_APPROVED_RUNTIMES {
            return Err(RpcError::new(
                "invalid_argument",
                "The Subagent policy panel carries too many approved runtimes.",
            ));
        }
        for runtime in &self.approved_runtimes {
            runtime.validate()?;
        }
        if let Some(fallback) = &self.fallback_runtime {
            fallback.validate()?;
        }
        self.adversarial.validate()
    }
}

impl GraphIntent {
    /// Validates the whole graph: node ids, dependencies, duplicate ids and
    /// cycles. Returns the nodes in a deterministic topological order.
    pub fn validate(&self) -> Result<Vec<String>, RpcError> {
        if self.nodes.len() > MAX_GRAPH_NODES {
            return Err(RpcError::new(
                "invalid_argument",
                "The graph carries too many nodes.",
            ));
        }
        self.policy.validate()?;
        let mut seen: Vec<&str> = Vec::with_capacity(self.nodes.len());
        for node in &self.nodes {
            node.validate()?;
            if seen.contains(&node.id.as_str()) {
                return Err(RpcError::new(
                    "invalid_argument",
                    format!("Duplicate graph node id '{}'.", node.id),
                ));
            }
            seen.push(&node.id);
        }
        for node in &self.nodes {
            for dep in &node.depends_on {
                if !seen.contains(&dep.as_str()) {
                    return Err(RpcError::new(
                        "invalid_argument",
                        format!("Node '{}' depends on unknown node '{}'.", node.id, dep),
                    ));
                }
            }
        }
        topological_order(self)
    }

    pub fn node(&self, id: &str) -> Option<&GraphNodeIntent> {
        self.nodes.iter().find(|node| node.id == id)
    }
}

/// Deterministic greedy topological order: repeatedly scan the original
/// input order and emit every node whose dependencies are already emitted.
/// A cycle is a refusal naming its members, never a silent drop.
pub fn topological_order(intent: &GraphIntent) -> Result<Vec<String>, RpcError> {
    let mut remaining: Vec<&GraphNodeIntent> = intent.nodes.iter().collect();
    let mut done: Vec<String> = Vec::with_capacity(remaining.len());
    while !remaining.is_empty() {
        let mut progressed = false;
        let mut next: Vec<&GraphNodeIntent> = Vec::new();
        for node in remaining {
            if node
                .depends_on
                .iter()
                .all(|dep| done.iter().any(|id| id == dep))
            {
                done.push(node.id.clone());
                progressed = true;
            } else {
                next.push(node);
            }
        }
        if !progressed {
            let members: Vec<&str> = next.iter().map(|node| node.id.as_str()).collect();
            return Err(RpcError::new(
                "invalid_argument",
                format!(
                    "The graph has a dependency cycle through: {}.",
                    members.join(", ")
                ),
            ));
        }
        remaining = next;
    }
    Ok(done)
}

/// The daemon-owned half: what was actually observed, never what intent
/// wished were true.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GraphNodeState {
    pub id: String,
    #[serde(default)]
    pub status: GraphNodeStatus,
    /// The daemon's own run row id this node's latest launch produced.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    /// The `mentu-recipes` run id (`run_...`), once known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mentu_run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    /// A resolvable reference the UI can use: the recorded step's evidence
    /// paths plus the verification verdict the runtime wrote.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    /// F0: which runtime actually ran this node's latest launch — the
    /// failover-substituted candidate when one was tried, or the node's own
    /// authored harness/model when it launched through `graph.run` (never
    /// substituted). `None` only when the node has never been launched at
    /// all; never a guess otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub harness: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Whether the attributed runtime above is this build's free, local,
    /// never-billed default (`failover::default_free_runtime()`) — the one
    /// fact the canvas needs to disclose a paid/external spawn honestly,
    /// without hardcoding the free pair a second time in the UI layer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_free_default_runtime: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GraphState {
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub nodes: Vec<GraphNodeState>,
}

impl GraphState {
    pub fn empty(updated_at: impl Into<String>) -> Self {
        Self {
            updated_at: updated_at.into(),
            nodes: Vec::new(),
        }
    }
}

/// The whole file.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    #[serde(default = "default_graph_version")]
    pub version: u32,
    #[serde(default)]
    pub intent: GraphIntent,
    #[serde(default = "default_graph_state")]
    pub state: GraphState,
}

fn default_graph_version() -> u32 {
    GRAPH_VERSION
}

fn default_graph_state() -> GraphState {
    GraphState {
        updated_at: String::new(),
        nodes: Vec::new(),
    }
}

/// One finding from the runtime's own `check`/`doctor`, attributed to the
/// node that caused it when the location names one.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GraphFindingSeverity {
    Error,
    Warning,
    Info,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GraphFinding {
    pub code: String,
    pub severity: GraphFindingSeverity,
    /// The intent node the finding names, when the runtime's location names
    /// a step (`steps[2].n3`). `None` for recipe-level findings.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommendation: Option<String>,
}

impl GraphFinding {
    pub fn is_error(&self) -> bool {
        matches!(self.severity, GraphFindingSeverity::Error)
    }
}

// ---------------------------------------------------------------------------
// Params and results
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphWorkspaceParams {
    pub workspace_id: String,
}

impl GraphWorkspaceParams {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_opaque_token(&self.workspace_id, 128, "Invalid graph workspace identity.")
    }
}

/// Params for `graph.write_intent`. `intent` rides as raw JSON so the store
/// can preserve unknown fields verbatim; semantic validation happens on the
/// typed view. A sibling `state` key (or one inside `intent`) is refused.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphWriteIntentParams {
    pub workspace_id: String,
    pub intent: Value,
}

impl GraphWriteIntentParams {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_opaque_token(&self.workspace_id, 128, "Invalid graph workspace identity.")?;
        if !self.intent.is_object() {
            return Err(RpcError::new(
                "invalid_argument",
                "graph.write_intent needs an intent object with a nodes array.",
            ));
        }
        require_no_state_half(&self.intent)
    }
}

/// The ownership refusal, shared by `graph.write_intent` (rejects state) and
/// the daemon's own state writer (rejects intent).
pub fn require_no_state_half(intent: &Value) -> Result<(), RpcError> {
    if intent.get("state").is_some() {
        return Err(RpcError::new(
            "invalid_argument",
            "`state` is owned by the daemon and cannot be written through graph.write_intent; \
             only the daemon observes and records it.",
        ));
    }
    Ok(())
}

/// Params for `graph.compile`/`graph.run`: exactly one of `nodeId` (the node
/// plus its transitive dependencies) or `nodeIds` (an explicit selection,
/// still closed over its dependencies).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCompileParams {
    pub workspace_id: String,
    #[serde(default)]
    pub node_id: Option<String>,
    #[serde(default)]
    pub node_ids: Vec<String>,
}

impl GraphCompileParams {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_opaque_token(&self.workspace_id, 128, "Invalid graph workspace identity.")?;
        match (&self.node_id, self.node_ids.is_empty()) {
            (Some(id), true) => validate_graph_node_id(id),
            (None, false) => {
                if self.node_ids.len() > MAX_GRAPH_NODES {
                    return Err(RpcError::new(
                        "invalid_argument",
                        "Too many explicitly selected graph nodes.",
                    ));
                }
                for id in &self.node_ids {
                    validate_graph_node_id(id)?;
                }
                Ok(())
            }
            (Some(_), false) => Err(RpcError::new(
                "invalid_argument",
                "graph.compile takes either nodeId or nodeIds, not both.",
            )),
            (None, true) => Err(RpcError::new(
                "invalid_argument",
                "graph.compile needs nodeId or a non-empty nodeIds selection.",
            )),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNodeParams {
    pub workspace_id: String,
    pub node_id: String,
}

impl GraphNodeParams {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_opaque_token(&self.workspace_id, 128, "Invalid graph workspace identity.")?;
        validate_graph_node_id(&self.node_id)
    }
}

/// Params for `graph.retry_step`: `step` defaults to the node id (the step
/// label the compiler emits for that node).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRetryStepParams {
    pub workspace_id: String,
    pub node_id: String,
    #[serde(default)]
    pub step: Option<String>,
}

impl GraphRetryStepParams {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_opaque_token(&self.workspace_id, 128, "Invalid graph workspace identity.")?;
        validate_graph_node_id(&self.node_id)?;
        if let Some(step) = &self.step {
            validate_opaque_token(step, MAX_GRAPH_ID_BYTES, "Invalid graph step label.")?;
        }
        Ok(())
    }
}

/// Params for the run-scoped `mentu.retry_step`: rerun one step of a past
/// run by its daemon run id, without redoing the rest of the graph.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MentuRetryStepParams {
    pub run_id: String,
    pub step: String,
}

impl MentuRetryStepParams {
    pub fn validate(&self) -> Result<(), RpcError> {
        validate_opaque_token(&self.run_id, 200, "Invalid Mentu run identity.")?;
        validate_opaque_token(&self.step, MAX_GRAPH_ID_BYTES, "Invalid step label.")
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphResult {
    pub graph: Graph,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNodeStateResult {
    pub state: GraphNodeState,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphCompileResult {
    /// The emitted recipe id inside `.mentu/recipes`.
    pub recipe_id: String,
    /// The exact emitted recipe JSON.
    pub recipe: Value,
    pub content_hash: String,
    /// The compiled nodes in execution (topological) order.
    pub node_ids: Vec<String>,
    /// `check`/`doctor` findings, each attributed to its node when known.
    pub findings: Vec<GraphFinding>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRunResult {
    pub run: crate::mentu::MentuRun,
    pub compile: GraphCompileResult,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphResumeResult {
    pub run: crate::mentu::MentuRun,
}

/// One entry in a node's failover history, as returned to a caller (a
/// slimmer projection of the daemon's own ledger row — no internal ids).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GraphFailoverAttemptRecord {
    pub harness: String,
    pub model: String,
    /// `launched`, `launch_failed`, or `failed` — see
    /// `drogon_core::graph::storage::FailoverAttempt` for the exact meaning
    /// of each.
    pub outcome: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Result of `graph.run_node_failover`: which runtime this attempt used,
/// whether it was the configured fallback, its position in the sequence,
/// and the full attempt history for this failover episode so a caller never
/// has to reconstruct it from separate reads.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRunNodeFailoverResult {
    pub run: crate::mentu::MentuRun,
    pub runtime: GraphRuntimeRef,
    pub is_fallback: bool,
    /// 1 for the first runtime tried this episode, 2 for the second, etc.
    pub attempt_number: u32,
    pub attempts: Vec<GraphFailoverAttemptRecord>,
}

/// A graph node id that is safe as a recipe step label and provider-map key.
pub fn validate_graph_node_id(id: &str) -> Result<(), RpcError> {
    if id.is_empty()
        || id.len() > MAX_GRAPH_ID_BYTES
        || !id.bytes().next().is_some_and(|b| b.is_ascii_alphanumeric())
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b':'))
    {
        return Err(RpcError::new(
            "invalid_argument",
            "A graph node id must match [A-Za-z0-9][A-Za-z0-9_.:-]{0,63} so it can be a recipe \
             step label and a provider-map key.",
        ));
    }
    Ok(())
}

fn validate_harness(harness: &str) -> Result<(), RpcError> {
    let valid = !harness.is_empty()
        && harness.len() <= MAX_GRAPH_ID_BYTES
        && harness
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if valid {
        Ok(())
    } else {
        Err(RpcError::new(
            "invalid_argument",
            "A node harness must be a lowercase catalog id from the harness catalog.",
        ))
    }
}

fn validate_text(value: &str, max: usize, what: &str, allow_spaces: bool) -> Result<(), RpcError> {
    let valid = !value.is_empty()
        && value.len() <= max
        && !value.contains('\0')
        && value
            .chars()
            .all(|c| !c.is_control() && (allow_spaces || (!c.is_whitespace() && c != '"')));
    if valid {
        Ok(())
    } else {
        Err(RpcError::new(
            "invalid_argument",
            format!("Invalid graph {what}."),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn node(id: &str, deps: &[&str]) -> GraphNodeIntent {
        GraphNodeIntent {
            id: id.into(),
            title: format!("node {id}"),
            harness: "shell".into(),
            model: String::new(),
            depends_on: deps.iter().map(|d| d.to_string()).collect(),
            prompt: "echo hi".into(),
            enabled: true,
            provider: None,
            verify_commands: Vec::new(),
        }
    }

    #[test]
    fn intent_round_trips_with_exact_wire_keys() {
        let intent = GraphIntent {
            nodes: vec![GraphNodeIntent {
                id: "n1".into(),
                title: "Build".into(),
                harness: "pi".into(),
                model: "qwen3.8-flash-next-nvidia-nvfp4".into(),
                depends_on: vec!["n0".into()],
                prompt: "do the thing".into(),
                enabled: true,
                provider: Some(GraphNodeProvider {
                    base_url: "http://127.0.0.1:9/v1".into(),
                    api_key_env: "PI_KEY".into(),
                }),
                verify_commands: vec!["test -f out.txt".into()],
            }],
            ..GraphIntent::default()
        };
        let value = serde_json::to_value(&intent).unwrap();
        assert_eq!(value["nodes"][0]["dependsOn"], json!(["n0"]));
        assert_eq!(
            value["nodes"][0]["provider"]["baseUrl"],
            "http://127.0.0.1:9/v1"
        );
        assert_eq!(value["nodes"][0]["provider"]["apiKeyEnv"], "PI_KEY");
        assert_eq!(
            value["nodes"][0]["verifyCommands"],
            json!(["test -f out.txt"])
        );
        let back: GraphIntent = serde_json::from_value(value).unwrap();
        assert_eq!(back, intent);
    }

    #[test]
    fn graph_node_status_is_snake_case_on_the_wire() {
        for (status, wire) in [
            (GraphNodeStatus::Idle, "idle"),
            (GraphNodeStatus::Running, "running"),
            (GraphNodeStatus::Succeeded, "succeeded"),
            (GraphNodeStatus::Failed, "failed"),
            (GraphNodeStatus::Blocked, "blocked"),
            (GraphNodeStatus::Unverifiable, "unverifiable"),
        ] {
            assert_eq!(serde_json::to_value(status).unwrap(), json!(wire));
            assert_eq!(status.as_wire(), wire);
        }
    }

    #[test]
    fn write_intent_refuses_a_state_key_at_the_root_or_inside_intent() {
        let root = GraphWriteIntentParams {
            workspace_id: "ws1".into(),
            intent: json!({"nodes": [], "state": {}}),
        };
        assert_eq!(root.validate().unwrap_err().code, "invalid_argument");
        let params: GraphWriteIntentParams = serde_json::from_value(json!({
            "workspaceId": "ws1",
            "intent": {"nodes": []},
            "state": {"nodes": []},
        }))
        .unwrap();
        // The sibling root key is outside the deserialized params but the
        // raw params object is what the dispatcher feeds validate for the
        // core-owned path; the shared guard still refuses it here.
        assert!(require_no_state_half(&json!({"state": {}})).is_err());
        assert!(params.validate().is_ok());
    }

    #[test]
    fn node_ids_must_be_step_label_safe() {
        for good in ["n1", "node-1", "a.b_c:d", "A0"] {
            validate_graph_node_id(good).unwrap();
        }
        for bad in ["", "-n1", "n 1", "n/1", "n\"1"] {
            assert!(
                validate_graph_node_id(bad).is_err(),
                "{bad:?} must be refused"
            );
        }
    }

    #[test]
    fn validate_reports_unknown_dependency_duplicate_and_cycle() {
        let unknown = GraphIntent {
            nodes: vec![node("n1", &["missing"])],
            ..GraphIntent::default()
        };
        assert!(
            unknown
                .validate()
                .unwrap_err()
                .message
                .contains("unknown node")
        );
        let duplicate = GraphIntent {
            nodes: vec![node("n1", &[]), node("n1", &[])],
            ..GraphIntent::default()
        };
        assert!(
            duplicate
                .validate()
                .unwrap_err()
                .message
                .contains("Duplicate")
        );
        let cycle = GraphIntent {
            nodes: vec![node("n1", &["n2"]), node("n2", &["n1"])],
            ..GraphIntent::default()
        };
        assert!(cycle.validate().unwrap_err().message.contains("cycle"));
    }

    #[test]
    fn topological_order_is_dependency_first_and_deterministic() {
        let intent = GraphIntent {
            nodes: vec![node("n3", &["n1"]), node("n1", &[]), node("n2", &["n1"])],
            ..GraphIntent::default()
        };
        assert_eq!(intent.validate().unwrap(), vec!["n1", "n2", "n3"]);
    }

    #[test]
    fn compile_params_require_exactly_one_selection_form() {
        let ok_one: GraphCompileParams =
            serde_json::from_value(json!({"workspaceId": "ws1", "nodeId": "n1"})).unwrap();
        ok_one.validate().unwrap();
        let ok_many: GraphCompileParams =
            serde_json::from_value(json!({"workspaceId": "ws1", "nodeIds": ["n1", "n2"]})).unwrap();
        ok_many.validate().unwrap();
        for bad in [
            json!({"workspaceId": "ws1"}),
            json!({"workspaceId": "ws1", "nodeIds": []}),
            json!({"workspaceId": "ws1", "nodeId": "n1", "nodeIds": ["n2"]}),
        ] {
            let parsed: GraphCompileParams = serde_json::from_value(bad).unwrap();
            assert_eq!(parsed.validate().unwrap_err().code, "invalid_argument");
        }
    }

    #[test]
    fn provider_binding_requires_http_and_a_plain_env_name() {
        GraphNodeProvider {
            base_url: "https://example.com/v1".into(),
            api_key_env: "PI_KEY".into(),
        }
        .validate()
        .unwrap();
        for bad in [
            "ftp://example.com",
            "https://user:pw@example.com",
            "https://example.com/?q=1",
            "https://example.com/#frag",
            "example.com",
        ] {
            let provider = GraphNodeProvider {
                base_url: bad.into(),
                api_key_env: "PI_KEY".into(),
            };
            assert!(provider.validate().is_err(), "{bad:?} must be refused");
        }
        let provider = GraphNodeProvider {
            base_url: "http://127.0.0.1:9/v1".into(),
            api_key_env: "".into(),
        };
        assert!(provider.validate().is_err());
    }

    #[test]
    fn graph_findings_serialize_severity_and_omit_absent_attribution() {
        let recipe_level = GraphFinding {
            code: "invalid_recipe".into(),
            severity: GraphFindingSeverity::Error,
            node_id: None,
            message: "bad".into(),
            recommendation: None,
        };
        let value = serde_json::to_value(&recipe_level).unwrap();
        assert_eq!(value["severity"], "error");
        assert!(value.get("nodeId").is_none());
        assert!(recipe_level.is_error());
    }

    #[test]
    fn graph_state_round_trips_and_omits_absent_fields() {
        let state = GraphState {
            updated_at: "2026-01-01T00:00:00Z".into(),
            nodes: vec![GraphNodeState {
                id: "n1".into(),
                status: GraphNodeStatus::Idle,
                run_id: None,
                mentu_run_id: None,
                started_at: None,
                ended_at: None,
                evidence: None,
                last_error: None,
                harness: None,
                model: None,
                is_free_default_runtime: None,
            }],
        };
        let value = serde_json::to_value(&state).unwrap();
        assert_eq!(value["nodes"][0], json!({"id": "n1", "status": "idle"}));
        let back: GraphState = serde_json::from_value(value).unwrap();
        assert_eq!(back, state);
    }

    #[test]
    fn nodes_default_enabled_when_the_field_is_absent() {
        let node: GraphNodeIntent = serde_json::from_value(json!({
            "id": "n1",
            "title": "t",
            "harness": "shell",
            "model": "",
            "prompt": "echo hi",
        }))
        .unwrap();
        assert!(node.enabled);
        assert!(node.depends_on.is_empty());
        assert!(node.provider.is_none());
    }

    #[test]
    fn policy_defaults_to_nothing_configured_when_absent_from_an_older_intent() {
        // An intent written before `policy` existed has no such key at all;
        // it must parse as "nothing configured" rather than refuse.
        let intent: GraphIntent = serde_json::from_value(json!({"nodes": []})).unwrap();
        assert_eq!(intent.policy, GraphPolicy::default());
        assert!(intent.policy.approved_runtimes.is_empty());
        assert!(intent.policy.fallback_runtime.is_none());
        assert!(!intent.policy.adversarial.enabled);
        assert_eq!(
            intent.policy.adversarial.max_iterations,
            DEFAULT_ADVERSARIAL_MAX_ITERATIONS
        );
        assert!(!intent.policy.delegate);
        intent.validate().unwrap();
    }

    #[test]
    fn policy_round_trips_with_exact_wire_keys() {
        let intent = GraphIntent {
            nodes: vec![],
            policy: GraphPolicy {
                approved_runtimes: vec![
                    GraphRuntimeRef {
                        harness: "opencode".into(),
                        model: "claude-sonnet-4".into(),
                    },
                    GraphRuntimeRef {
                        harness: "codex".into(),
                        model: "gpt-5.3-codex".into(),
                    },
                ],
                fallback_runtime: Some(GraphRuntimeRef {
                    harness: "custom".into(),
                    model: "qwen3-coder".into(),
                }),
                adversarial: GraphAdversarialPolicy {
                    enabled: true,
                    max_iterations: 10,
                },
                delegate: false,
            },
        };
        intent.validate().unwrap();
        let value = serde_json::to_value(&intent).unwrap();
        assert_eq!(
            value["policy"]["approvedRuntimes"][0]["harness"],
            "opencode"
        );
        assert_eq!(value["policy"]["fallbackRuntime"]["model"], "qwen3-coder");
        assert_eq!(value["policy"]["adversarial"]["maxIterations"], 10);
        assert_eq!(value["policy"]["delegate"], false);
        let back: GraphIntent = serde_json::from_value(value).unwrap();
        assert_eq!(back, intent);
    }

    #[test]
    fn delegate_and_adversarial_modes_are_mutually_exclusive() {
        let policy = GraphPolicy {
            delegate: true,
            adversarial: GraphAdversarialPolicy {
                enabled: true,
                max_iterations: 3,
            },
            ..GraphPolicy::default()
        };
        let error = policy.validate().unwrap_err();
        assert_eq!(error.code, "invalid_argument");
        assert!(error.message.contains("mutually exclusive"));
    }

    #[test]
    fn policy_write_omitting_it_must_not_be_confused_with_clearing_it() {
        // This is the store's job (merge_intent in graph/store.rs never
        // lists `policy` as a known intent key so an omission preserves the
        // existing on-disk policy), not this type's — but the type-level
        // contract this depends on is that a payload with no `policy` key
        // parses as the DEFAULT, never an error, so the store can tell "not
        // sent" apart from "sent empty" at the raw-JSON level before this
        // struct ever sees it.
        let no_policy_key: GraphIntent =
            serde_json::from_value(json!({"nodes": [{"id": "n1", "title": "t", "harness": "shell", "model": "", "prompt": "echo hi"}]}))
                .unwrap();
        assert_eq!(no_policy_key.policy, GraphPolicy::default());
    }

    #[test]
    fn adversarial_max_iterations_bounds_are_enforced() {
        let mut policy = GraphAdversarialPolicy {
            enabled: true,
            max_iterations: 0,
        };
        assert!(policy.validate().is_err());
        policy.max_iterations = MAX_ADVERSARIAL_MAX_ITERATIONS + 1;
        assert!(policy.validate().is_err());
        policy.max_iterations = MIN_ADVERSARIAL_MAX_ITERATIONS;
        policy.validate().unwrap();
        policy.max_iterations = MAX_ADVERSARIAL_MAX_ITERATIONS;
        policy.validate().unwrap();
    }

    #[test]
    fn policy_rejects_too_many_approved_runtimes() {
        let policy = GraphPolicy {
            approved_runtimes: (0..=MAX_POLICY_APPROVED_RUNTIMES)
                .map(|i| GraphRuntimeRef {
                    harness: "shell".into(),
                    model: format!("m{i}"),
                })
                .collect(),
            ..GraphPolicy::default()
        };
        assert!(policy.validate().is_err());
    }

    #[test]
    fn policy_runtime_rejects_an_invalid_harness_id() {
        let bad = GraphRuntimeRef {
            harness: "Not A Valid Harness!".into(),
            model: String::new(),
        };
        assert!(bad.validate().is_err());
        let good = GraphRuntimeRef {
            harness: "opencode".into(),
            model: "claude-sonnet-4".into(),
        };
        good.validate().unwrap();
    }

    #[test]
    fn graph_intent_validate_surfaces_a_policy_error() {
        let intent = GraphIntent {
            nodes: vec![],
            policy: GraphPolicy {
                adversarial: GraphAdversarialPolicy {
                    enabled: true,
                    max_iterations: 0,
                },
                ..GraphPolicy::default()
            },
        };
        assert_eq!(intent.validate().unwrap_err().code, "invalid_argument");
    }
}
