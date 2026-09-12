//! Graph → recipe compiler.
//!
//! Given a node and its transitive dependencies (or an explicit selection),
//! emit a valid Mentu recipe JSON and hand it to the EXISTING runtime path —
//! there is no second execution engine here.
//!
//! The single most important thing this module does: a Pi step is emitted
//! with the COMPLETE provider binding (`api: "cli"`, `agent: "pi"`,
//! `base_url`, `model`, `api_key_env`). A provider entry missing `api` — or a
//! bare `backend: "pi"` step — passes `mentu-recipes check` AND `doctor
//! --strict` with score 100 and then makes the runtime silently downgrade the
//! step to a bare chat-completion HTTP call (no system prompt, no tools) and
//! stamp the run `ok`. The emitter must make that trap unreachable.

use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use drogon_protocol::RpcError;
use drogon_protocol::graph::{
    GraphFinding, GraphFindingSeverity, GraphIntent, GraphNodeIntent, topological_order,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::error;
use crate::mentu::{recipe, runtime};

/// Default per-step budgets. Explicit so `doctor --strict` never reports
/// `default_timeout`.
pub const SHELL_STEP_TIMEOUT_SECONDS: u64 = 600;
pub const AGENT_STEP_TIMEOUT_SECONDS: u64 = 3600;

/// Env fallbacks for a Pi node that does not carry its own provider binding.
pub const PI_BASE_URL_ENV: &str = "DROGON_GRAPH_PI_BASE_URL";
pub const PI_API_KEY_ENV_ENV: &str = "DROGON_GRAPH_PI_API_KEY_ENV";

/// How long `check`/`doctor` may take before the compile refuses. The runtime
/// is a local binary; a hang is a host failure, not a recipe verdict.
const VALIDATION_TIMEOUT: Duration = Duration::from_secs(30);

/// The complete Pi provider binding the emitter writes. Kept as one struct so
/// a shape test can pin every field at once.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PiBinding {
    pub name: String,
    pub base_url: String,
    pub model: String,
    pub api_key_env: String,
}

impl PiBinding {
    /// The exact JSON object written into `providers[name]`.
    pub fn to_value(&self) -> Value {
        json!({
            "api": "cli",
            "agent": "pi",
            "base_url": self.base_url,
            "model": self.model,
            "api_key_env": self.api_key_env,
        })
    }
}

/// One compiled node, in execution order.
#[derive(Clone, Debug)]
pub struct CompiledNode {
    pub id: String,
    pub step_label: String,
}

#[derive(Clone, Debug)]
pub struct CompiledGraph {
    pub recipe_id: String,
    pub recipe: Value,
    pub content_hash: String,
    /// The compiled nodes in execution (topological) order.
    pub nodes: Vec<CompiledNode>,
    pub findings: Vec<GraphFinding>,
}

impl CompiledGraph {
    pub fn node_ids(&self) -> Vec<String> {
        self.nodes.iter().map(|node| node.id.clone()).collect()
    }
}

/// The selection: a single target node or an explicit set. Both are closed
/// over their transitive dependencies.
#[derive(Clone, Debug)]
pub enum Selection {
    Target(String),
    Explicit(Vec<String>),
}

impl Selection {
    fn seed(&self) -> &[String] {
        match self {
            Self::Target(id) => std::slice::from_ref(id),
            Self::Explicit(ids) => ids,
        }
    }

    fn recipe_target(&self) -> String {
        match self {
            Self::Target(id) => id.clone(),
            Self::Explicit(ids) => {
                let mut sorted = ids.clone();
                sorted.sort();
                let digest = Sha256::digest(sorted.join("\u{0}").as_bytes());
                let hex: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
                format!("selection-{hex}")
            }
        }
    }
}

/// Where a Pi node's provider inputs come from when the node does not carry
/// them: the daemon's environment. `None` for both means a Pi node refuses
/// to compile rather than emit the bare-`pi` false-success recipe.
#[derive(Clone, Debug, Default)]
pub struct PiProviderDefaults {
    pub base_url: Option<String>,
    pub api_key_env: Option<String>,
}

impl PiProviderDefaults {
    pub fn from_env() -> Self {
        let read = |key: &str| {
            std::env::var(key)
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        };
        Self {
            base_url: read(PI_BASE_URL_ENV),
            api_key_env: read(PI_API_KEY_ENV_ENV),
        }
    }
}

fn node_error(node: &str, message: impl std::fmt::Display) -> RpcError {
    error::invalid_argument(format!("Node '{node}': {message}"))
}

/// The deterministic provider name for a node's Pi binding.
pub fn pi_provider_name(node_id: &str) -> String {
    format!("drogon-pi-{node_id}")
}

/// The completion sentinel an agent step must print so completion is
/// observable (`doctor --strict` accepts `completion_keyword`).
pub fn completion_sentinel(node_id: &str) -> String {
    let sanitized: String = node_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect();
    format!("DROGON_NODE_{sanitized}_DONE")
}

/// Compiles `selection` against `intent`. Writes nothing here; the caller
/// persists and validates. `defaults` supplies Pi provider inputs.
pub fn compile(
    intent: &GraphIntent,
    selection: &Selection,
    defaults: &PiProviderDefaults,
) -> Result<CompiledGraph, RpcError> {
    intent.validate()?;
    let order = topological_order(intent)?;
    let wanted = closure(intent, selection.seed())?;

    let mut steps: Vec<Value> = Vec::new();
    let mut providers = serde_json::Map::new();
    let mut nodes: Vec<CompiledNode> = Vec::new();
    let mut findings: Vec<GraphFinding> = Vec::new();

    for id in order.iter().filter(|id| wanted.contains(id)) {
        let node = intent.node(id).expect("closure only contains known nodes");
        if !node.enabled {
            return Err(node_error(
                id,
                "this node is disabled, so a graph that includes it cannot be compiled. \
                 Enable it in the graph, or remove it from the dependency path.",
            ));
        }
        let (mut step, provider, mut step_findings) = node_step(node, defaults)?;
        if let Some((name, binding)) = provider {
            providers.insert(name, binding);
        }
        findings.append(&mut step_findings);
        // Dependencies are always a subset of the compiled set (the closure
        // guarantees it); keep the declared order.
        step["depends_on"] = json!(node.depends_on);
        steps.push(step);
        nodes.push(CompiledNode {
            id: node.id.clone(),
            step_label: node.id.clone(),
        });
    }

    let recipe_id = format!("drogon-graph-{}", selection.recipe_target());
    let mut recipe = json!({
        "name": recipe_id,
        "description": format!(
            "Compiled from the work graph ({}); edit .drogon/graph.json and recompile, \
             never this file.",
            nodes
                .iter()
                .map(|node| node.id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ),
        "type": "sequence",
        "steps": steps,
    });
    if !providers.is_empty() {
        recipe["providers"] = Value::Object(providers);
    }

    Ok(CompiledGraph {
        recipe_id,
        recipe,
        content_hash: String::new(),
        nodes,
        findings,
    })
}

/// The ONE provider/model rule for the work graph — the same split the Bots
/// model field applies (`buildBotRunHarness`): a `provider/model` string
/// splits at the FIRST slash and everything after it is the exact id the
/// server knows (so `nvidia/deepseek-ai/deepseek-v4-flash-0731` keeps
/// `deepseek-ai/deepseek-v4-flash-0731`). A bare id — the model picker's
/// catalog form — rides unchanged. A leading or trailing slash is neither
/// form; it is refused by name, with the expected form stated, so a rejected
/// id never surfaces as the opaque "Pi did not produce a successful
/// structured completion".
fn resolve_pi_model(node_id: &str, raw: &str) -> Result<(String, Option<GraphFinding>), RpcError> {
    let trimmed = raw.trim();
    let Some(slash) = trimmed.find('/') else {
        return Ok((trimmed.to_string(), None));
    };
    let (provider, rest) = trimmed.split_at(slash);
    let exact = &rest[1..];
    if provider.is_empty() || exact.is_empty() {
        return Err(node_error(
            node_id,
            format!(
                "model id '{trimmed}' is not runnable: the {} side of the slash is empty, so \
                 it is neither a bare exact id nor the `provider/model` form the product \
                 teaches (e.g. dgx-spark/qwen3.8-flash-next-nvidia-nvfp4). Pass the exact id \
                 the per-harness model catalog lists, or `provider/model`.",
                if provider.is_empty() { "provider" } else { "model" }
            ),
        ));
    }
    Ok((
        exact.to_string(),
        Some(GraphFinding {
            code: "pi_model_provider_prefix".into(),
            severity: GraphFindingSeverity::Info,
            node_id: Some(node_id.to_string()),
            message: format!(
                "model '{trimmed}' carries a provider prefix; the graph splits it at the \
                 first slash, the same rule the Bots model field applies, and runs the exact \
                 id '{exact}' through this node's pi provider binding."
            ),
            recommendation: None,
        }),
    ))
}

/// Emits one recipe step plus, for Pi, the provider-map entry and any
/// compile-time finding (the provider/model split is surfaced, never
/// silent). The backend mapping is explicit; an unsupported harness refuses
/// with the node named.
fn node_step(
    node: &GraphNodeIntent,
    defaults: &PiProviderDefaults,
) -> Result<(Value, Option<(String, Value)>, Vec<GraphFinding>), RpcError> {
    let mut step = json!({
        "label": node.id,
        "prompt": node.prompt,
        "timeout": AGENT_STEP_TIMEOUT_SECONDS,
    });
    let mut provider = None;
    let mut findings: Vec<GraphFinding> = Vec::new();
    match node.harness.as_str() {
        "shell" => {
            step["backend"] = json!("shell");
            step["timeout"] = json!(SHELL_STEP_TIMEOUT_SECONDS);
        }
        "pi" => {
            if node.model.trim().is_empty() {
                return Err(node_error(
                    &node.id,
                    "a pi node needs an exact model id from the per-harness model catalog.",
                ));
            }
            let (model, split) = resolve_pi_model(&node.id, &node.model)?;
            if let Some(finding) = split {
                findings.push(finding);
            }
            let (base_url, api_key_env) = match &node.provider {
                Some(provider) => {
                    provider.validate()?;
                    (provider.base_url.clone(), provider.api_key_env.clone())
                }
                None => {
                    let (Some(base_url), Some(api_key_env)) =
                        (defaults.base_url.clone(), defaults.api_key_env.clone())
                    else {
                        return Err(node_error(
                            &node.id,
                            "a pi node needs an explicit provider binding (base_url + \
                             api_key_env). Without one, mentu-recipes accepts a bare 'pi' step \
                             and then silently downgrades it to a chat-completion HTTP call \
                             with no system prompt and no tools, stamping the run ok. Set \
                             `provider.baseUrl`/`provider.apiKeyEnv` on the node, or \
                             DROGON_GRAPH_PI_BASE_URL/DROGON_GRAPH_PI_API_KEY_ENV on the daemon.",
                        ));
                    };
                    (base_url, api_key_env)
                }
            };
            let name = pi_provider_name(&node.id);
            let binding = PiBinding {
                name: name.clone(),
                base_url,
                model: model.clone(),
                api_key_env,
            };
            // The runtime executes `request.model ?? config.model`; keep both
            // exact and equal so no substitution can happen.
            step["backend"] = json!(name);
            step["model"] = json!(model);
            provider = Some((name, binding.to_value()));
        }
        "claude" | "codex" => {
            step["backend"] = json!(node.harness);
            if !node.model.trim().is_empty() {
                step["model"] = json!(node.model);
            }
        }
        "opencode" | "antigravity" => {
            return Err(node_error(
                &node.id,
                format!(
                    "harness '{}' has no adapter registered in mentu-recipes {} (only shell, \
                     claude, codex and pi execute); this node cannot be compiled to a recipe \
                     that would actually run.",
                    node.harness,
                    runtime::MENTU_LOCK_VERSION
                ),
            ));
        }
        other => {
            return Err(node_error(
                &node.id,
                format!(
                    "harness '{other}' is not in the harness catalog; the compiler never \
                     invents a backend."
                ),
            ));
        }
    }
    if node.verify_commands.is_empty() {
        if node.harness != "shell" {
            // Observability: an agent step with no deterministic verification
            // gets a completion keyword, and the emitted prompt tells the
            // agent exactly what to print.
            let sentinel = completion_sentinel(&node.id);
            step["completion_keyword"] = json!(sentinel);
            let instruction = format!(
                "\n\nWhen this task is complete, end your final message with exactly this \
                 line:\n{sentinel}\n"
            );
            let prompt = format!("{}{}", node.prompt, instruction);
            if prompt.len() > drogon_protocol::graph::MAX_GRAPH_PROMPT_BYTES {
                return Err(node_error(
                    &node.id,
                    "the compiled prompt (prompt plus completion instruction) exceeds the \
                     recipe size limit.",
                ));
            }
            step["prompt"] = json!(prompt);
        }
    } else {
        step["verify"] = json!({ "commands": node.verify_commands });
    }
    Ok((step, provider, findings))
}

/// The transitive dependency closure of `seeds`, including the seeds.
fn closure(intent: &GraphIntent, seeds: &[String]) -> Result<Vec<String>, RpcError> {
    let mut wanted: Vec<String> = Vec::new();
    let mut queue: Vec<String> = seeds.to_vec();
    while let Some(id) = queue.pop() {
        let node = intent.node(&id).ok_or_else(|| {
            error::invalid_argument(format!(
                "The graph has no node '{id}', so nothing can be compiled for it."
            ))
        })?;
        if wanted.contains(&id) {
            continue;
        }
        wanted.push(id);
        for dep in &node.depends_on {
            queue.push(dep.clone());
        }
    }
    Ok(wanted)
}

// ---------------------------------------------------------------------------
// Validation through the pinned runtime's own check/doctor
// ---------------------------------------------------------------------------

/// Validates the emitted recipe with the runtime's own `check` and
/// `doctor --strict`, after persisting it at `.mentu/recipes/<id>.json`
/// (the runtime resolves recipes from the workspace's `.mentu/recipes`).
///
/// Returns the persisted recipe's exact content hash plus every finding,
/// attributed to the node the runtime's location names. An error-severity
/// finding (or a failed `check`) is a refusal: a graph that would not
/// validate never executes.
pub fn validate_and_persist(
    runtime_path: &Path,
    workspace_root: &Path,
    compiled: &mut CompiledGraph,
) -> Result<(), RpcError> {
    let source = serde_json::to_string_pretty(&compiled.recipe)
        .map_err(|e| error::internal_error(e.to_string()))?;
    let detail = recipe::save_compiled_recipe(workspace_root, &compiled.recipe_id, &source)?;
    compiled.content_hash = detail.content_hash;

    let recipe_path = recipe::resolve_recipe_path(workspace_root, &compiled.recipe_id)?;
    let mut findings: Vec<GraphFinding> = Vec::new();

    // `check` is the schema validator; it resolves the recipe by id relative
    // to the workspace, so it must run with the workspace as cwd.
    let mut check = Command::new(runtime_path);
    check.arg("check").arg(&compiled.recipe_id);
    check.current_dir(workspace_root);
    let check = run_bounded(&mut check, VALIDATION_TIMEOUT)?;
    if !check.status.success() {
        findings.push(GraphFinding {
            code: "check_failed".into(),
            severity: GraphFindingSeverity::Error,
            node_id: None,
            message: output_tail(&check.stdout, &check.stderr),
            recommendation: Some(
                "This is the runtime's own schema verdict; fix the graph inputs it names.".into(),
            ),
        });
    }

    // `doctor --strict` carries the structured findings (severity + the exact
    // step location), so node attribution comes from here.
    let mut doctor = Command::new(runtime_path);
    doctor
        .arg("doctor")
        .arg(&recipe_path)
        .arg("--strict")
        .arg("--format")
        .arg("json");
    doctor.current_dir(workspace_root);
    let doctor = run_bounded(&mut doctor, VALIDATION_TIMEOUT)?;
    let doctor_json = serde_json::from_slice::<Value>(&doctor.stdout).ok();
    match doctor_json
        .as_ref()
        .and_then(|value| value.get("findings"))
        .and_then(Value::as_array)
    {
        Some(entries) => {
            for entry in entries {
                findings.push(doctor_finding(entry, &compiled.node_ids()));
            }
        }
        None if !doctor.status.success() => {
            findings.push(GraphFinding {
                code: "doctor_failed".into(),
                severity: GraphFindingSeverity::Error,
                node_id: None,
                message: output_tail(&doctor.stdout, &doctor.stderr),
                recommendation: Some(
                    "doctor did not produce its JSON findings; inspect the emitted recipe.".into(),
                ),
            });
        }
        None => {}
    }
    // Compile-time findings (e.g. the provider/model split) ride ahead of
    // the runtime's own check/doctor verdicts.
    compiled.findings.extend(findings);
    Ok(())
}

/// Maps one `doctor --format json` finding onto the graph vocabulary. The
/// location (`steps[2].n3`) names the node; a bare `steps[2]` maps by index.
fn doctor_finding(entry: &Value, node_ids: &[String]) -> GraphFinding {
    let severity = match entry.get("severity").and_then(Value::as_str) {
        Some("error") => GraphFindingSeverity::Error,
        Some("info") => GraphFindingSeverity::Info,
        _ => GraphFindingSeverity::Warning,
    };
    let location = entry.get("location").and_then(Value::as_str).unwrap_or("");
    GraphFinding {
        code: entry
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
        severity,
        node_id: node_for_location(location, node_ids),
        message: entry
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        recommendation: entry
            .get("recommendation")
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}

fn node_for_location(location: &str, node_ids: &[String]) -> Option<String> {
    let rest = location.strip_prefix("steps[")?;
    let (index, tail) = rest.split_once(']')?;
    if let Some(label) = tail.strip_prefix('.').filter(|label| !label.is_empty())
        && node_ids.iter().any(|id| id == label)
    {
        return Some(label.to_string());
    }
    let index: usize = index.parse().ok()?;
    node_ids.get(index).cloned()
}

fn output_tail(stdout: &[u8], stderr: &[u8]) -> String {
    let mut text = String::from_utf8_lossy(stderr).trim().to_string();
    if text.is_empty() {
        text = String::from_utf8_lossy(stdout).trim().to_string();
    }
    text.chars().take(2000).collect()
}

/// Runs a command with a bounded wall clock, killing it on timeout so a hung
/// runtime never hangs a compile.
fn run_bounded(command: &mut Command, timeout: Duration) -> Result<std::process::Output, RpcError> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| error::io_error(format!("failed to start mentu-recipes: {e}")))?;
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error::io_error(format!(
                    "mentu-recipes did not answer within {}s",
                    timeout.as_secs()
                )));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => {
                let _ = child.kill();
                return Err(error::io_error(format!("mentu-recipes wait failed: {e}")));
            }
        }
    }
    child
        .wait_with_output()
        .map_err(|e| error::io_error(format!("mentu-recipes output failed: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use drogon_protocol::graph::GraphNodeProvider;

    fn node(id: &str, harness: &str, deps: &[&str]) -> GraphNodeIntent {
        GraphNodeIntent {
            id: id.into(),
            title: format!("Node {id}"),
            harness: harness.into(),
            model: if harness == "shell" {
                String::new()
            } else {
                "qwen3.8-flash-next-nvidia-nvfp4".into()
            },
            depends_on: deps.iter().map(|d| d.to_string()).collect(),
            prompt: format!("do {id}"),
            enabled: true,
            provider: None,
            verify_commands: Vec::new(),
        }
    }

    fn defaults() -> PiProviderDefaults {
        PiProviderDefaults {
            base_url: Some("http://127.0.0.1:9/v1".into()),
            api_key_env: Some("PI_KEY".into()),
        }
    }

    #[test]
    fn a_two_node_graph_with_one_agent_node_emits_the_exact_recipe() {
        let intent = GraphIntent {
            nodes: vec![node("n1", "shell", &[]), node("n2", "pi", &["n1"])],
        };
        let compiled = compile(&intent, &Selection::Target("n2".into()), &defaults()).unwrap();
        assert_eq!(compiled.recipe_id, "drogon-graph-n2");
        assert_eq!(compiled.node_ids(), vec!["n1", "n2"]);
        let steps = compiled.recipe["steps"].as_array().unwrap();
        assert_eq!(steps[0]["label"], "n1");
        assert_eq!(steps[0]["backend"], "shell");
        assert_eq!(steps[0]["depends_on"], json!([]));
        assert_eq!(steps[1]["label"], "n2");
        assert_eq!(steps[1]["backend"], "drogon-pi-n2");
        assert_eq!(steps[1]["depends_on"], json!(["n1"]));
        assert_eq!(steps[1]["model"], "qwen3.8-flash-next-nvidia-nvfp4");
        assert!(steps[1]["completion_keyword"].is_string());
        assert!(
            steps[1]["prompt"]
                .as_str()
                .unwrap()
                .contains(&completion_sentinel("n2")),
            "the emitted prompt must tell the agent what to print"
        );
    }

    /// The pin: every emitted Pi provider binding is complete. A missing `api`
    /// is exactly the false-success trap this compiler exists to prevent.
    #[test]
    fn pi_provider_binding_is_always_complete() {
        let intent = GraphIntent {
            nodes: vec![node("n1", "pi", &[])],
        };
        let compiled = compile(&intent, &Selection::Target("n1".into()), &defaults()).unwrap();
        let binding = &compiled.recipe["providers"]["drogon-pi-n1"];
        assert_eq!(binding["api"], "cli");
        assert_eq!(binding["agent"], "pi");
        assert_eq!(binding["base_url"], "http://127.0.0.1:9/v1");
        assert_eq!(binding["model"], "qwen3.8-flash-next-nvidia-nvfp4");
        assert_eq!(binding["api_key_env"], "PI_KEY");
        // No field may be absent or null: the adapter's guard checks api +
        // base_url + model + exactly one credential source.
        for field in ["api", "agent", "base_url", "model", "api_key_env"] {
            assert!(
                binding.get(field).is_some_and(|value| !value.is_null()),
                "provider binding is missing {field}: {binding}"
            );
        }
        assert_eq!(compiled.recipe["steps"][0]["backend"], "drogon-pi-n1");
    }

    #[test]
    fn a_pi_node_without_a_provider_refuses_instead_of_emitting_bare_pi() {
        let intent = GraphIntent {
            nodes: vec![node("n1", "pi", &[])],
        };
        let err = compile(
            &intent,
            &Selection::Target("n1".into()),
            &PiProviderDefaults::default(),
        )
        .unwrap_err();
        assert_eq!(err.code, "invalid_argument");
        assert!(err.message.contains("provider binding"));
        assert!(err.message.contains("n1"));
    }

    #[test]
    fn a_node_provider_overrides_the_daemon_default() {
        let mut n1 = node("n1", "pi", &[]);
        n1.provider = Some(GraphNodeProvider {
            base_url: "https://node.example/v1".into(),
            api_key_env: "NODE_KEY".into(),
        });
        let intent = GraphIntent { nodes: vec![n1] };
        let compiled = compile(
            &intent,
            &Selection::Target("n1".into()),
            &PiProviderDefaults::default(),
        )
        .unwrap();
        let binding = &compiled.recipe["providers"]["drogon-pi-n1"];
        assert_eq!(binding["base_url"], "https://node.example/v1");
        assert_eq!(binding["api_key_env"], "NODE_KEY");
    }

    #[test]
    fn compilation_closes_over_dependencies_and_keeps_topological_order() {
        let intent = GraphIntent {
            nodes: vec![
                node("n3", "shell", &["n1"]),
                node("n1", "shell", &[]),
                node("n2", "pi", &["n1"]),
            ],
        };
        let compiled = compile(&intent, &Selection::Target("n3".into()), &defaults()).unwrap();
        assert_eq!(compiled.node_ids(), vec!["n1", "n3"]);
        // Explicit selection also closes over dependencies.
        let compiled = compile(
            &intent,
            &Selection::Explicit(vec!["n2".into()]),
            &defaults(),
        )
        .unwrap();
        assert_eq!(compiled.node_ids(), vec!["n1", "n2"]);
    }

    #[test]
    fn a_disabled_node_in_the_path_refuses_with_its_name() {
        let mut n1 = node("n1", "shell", &[]);
        n1.enabled = false;
        let intent = GraphIntent {
            nodes: vec![n1, node("n2", "shell", &["n1"])],
        };
        let err = compile(&intent, &Selection::Target("n2".into()), &defaults()).unwrap_err();
        assert!(err.message.contains("n1"));
        assert!(err.message.contains("disabled"));
    }

    #[test]
    fn unsupported_harnesses_refuse_with_the_node_named() {
        for harness in ["opencode", "antigravity", "mystery"] {
            let intent = GraphIntent {
                nodes: vec![node("n1", harness, &[])],
            };
            let err = compile(&intent, &Selection::Target("n1".into()), &defaults()).unwrap_err();
            assert!(err.message.contains("n1"), "{harness}: {err:?}");
            assert!(err.message.contains(harness));
        }
    }

    #[test]
    fn verify_commands_replace_the_completion_sentinel() {
        let mut n1 = node("n1", "pi", &[]);
        n1.verify_commands = vec!["test -f out.txt".into()];
        let intent = GraphIntent { nodes: vec![n1] };
        let compiled = compile(&intent, &Selection::Target("n1".into()), &defaults()).unwrap();
        let step = &compiled.recipe["steps"][0];
        assert_eq!(step["verify"]["commands"], json!(["test -f out.txt"]));
        assert!(step.get("completion_keyword").is_none());
        assert_eq!(step["prompt"], "do n1");
    }

    /// Regression for the QA finding "the model syntax the product teaches
    /// is the one the graph cannot run": the app documents
    /// `dgx-spark/qwen3.8-flash-next-nvidia-nvfp4` (provider/model), the
    /// Bots harness splits it at the first slash, but the compiler used to
    /// pass the whole string through as the recipe's model — and the server
    /// rejects the prefixed name, failing every Pi node in 0 s with the
    /// opaque "Pi did not produce a successful structured completion".
    /// The graph must accept the same string and split it the same way.
    #[test]
    fn a_prefixed_provider_model_splits_to_the_exact_id_the_server_knows() {
        let mut n1 = node("n1", "pi", &[]);
        n1.model = "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4".into();
        let intent = GraphIntent { nodes: vec![n1] };
        let compiled = compile(&intent, &Selection::Target("n1".into()), &defaults()).unwrap();
        let binding = &compiled.recipe["providers"]["drogon-pi-n1"];
        assert_eq!(binding["model"], "qwen3.8-flash-next-nvidia-nvfp4");
        // The runtime executes `request.model ?? config.model`; both must be
        // the exact id or validate_pi_step refuses the disagreement.
        assert_eq!(
            compiled.recipe["steps"][0]["model"],
            "qwen3.8-flash-next-nvidia-nvfp4"
        );
        // The split is surfaced as a finding, never silent.
        let split = compiled
            .findings
            .iter()
            .find(|finding| finding.code == "pi_model_provider_prefix")
            .expect("the split must be surfaced as a finding");
        assert_eq!(split.node_id.as_deref(), Some("n1"));
        assert_eq!(split.severity, GraphFindingSeverity::Info);
        assert!(split.message.contains("dgx-spark/qwen3.8-flash-next-nvidia-nvfp4"));
        assert!(split.message.contains("qwen3.8-flash-next-nvidia-nvfp4"));
    }

    /// The failure must never be opaque again: a model id that cannot map
    /// names the id, says why, and says what form is expected.
    #[test]
    fn a_malformed_provider_model_is_refused_by_name_with_the_expected_form() {
        for bad in ["/qwen3.8-flash-next-nvidia-nvfp4", "dgx-spark/", "/"] {
            let mut n1 = node("n1", "pi", &[]);
            n1.model = bad.into();
            let intent = GraphIntent { nodes: vec![n1] };
            let err = compile(&intent, &Selection::Target("n1".into()), &defaults()).unwrap_err();
            assert_eq!(err.code, "invalid_argument");
            assert!(
                err.message.contains(bad.trim()),
                "the refusal must name the id {bad:?}: {}",
                err.message
            );
            assert!(
                err.message.contains("provider/model"),
                "the refusal must state the expected form: {}",
                err.message
            );
            assert!(
                err.message.contains("n1"),
                "the refusal must name the node: {}",
                err.message
            );
        }
    }

    /// A bare exact id (the picker's catalog form) rides unchanged, and a
    /// provider part that itself contains a slash keeps everything after the
    /// FIRST slash as the exact id — the same split rule the rest of the
    /// product applies.
    #[test]
    fn bare_ids_and_multi_segment_ids_split_like_the_product_rule() {
        let bare = node("n1", "pi", &[]);
        let intent = GraphIntent { nodes: vec![bare] };
        let compiled = compile(&intent, &Selection::Target("n1".into()), &defaults()).unwrap();
        assert_eq!(
            compiled.recipe["providers"]["drogon-pi-n1"]["model"],
            "qwen3.8-flash-next-nvidia-nvfp4"
        );
        assert!(compiled.findings.is_empty());

        // A catalog id like nvidia's `deepseek-ai/deepseek-v4-flash-0731` is
        // expressed as `nvidia/deepseek-ai/deepseek-v4-flash-0731`: the split
        // at the FIRST slash keeps the full id.
        let mut n2 = node("n2", "pi", &[]);
        n2.model = "nvidia/deepseek-ai/deepseek-v4-flash-0731".into();
        let intent = GraphIntent { nodes: vec![n2] };
        let compiled = compile(&intent, &Selection::Target("n2".into()), &defaults()).unwrap();
        assert_eq!(
            compiled.recipe["providers"]["drogon-pi-n2"]["model"],
            "deepseek-ai/deepseek-v4-flash-0731"
        );
    }

    #[test]
    fn doctor_findings_are_attributed_to_the_node_that_caused_them() {
        let node_ids = vec!["n1".to_string(), "n2".to_string()];
        let attributed = doctor_finding(
            &json!({
                "code": "missing_completion_signal",
                "severity": "warning",
                "location": "steps[1].n2",
                "message": "no signal",
                "recommendation": "add one"
            }),
            &node_ids,
        );
        assert_eq!(attributed.node_id.as_deref(), Some("n2"));
        assert_eq!(attributed.severity, GraphFindingSeverity::Warning);

        let by_index = doctor_finding(
            &json!({"code": "x", "severity": "error", "location": "steps[0]", "message": "m"}),
            &node_ids,
        );
        assert_eq!(by_index.node_id.as_deref(), Some("n1"));
        assert!(by_index.is_error());

        let unknown_label = doctor_finding(
            &json!({"code": "x", "severity": "error", "location": "steps[1].gone", "message": "m"}),
            &node_ids,
        );
        assert_eq!(unknown_label.node_id.as_deref(), Some("n2"));

        let recipe_level = doctor_finding(
            &json!({"code": "invalid_recipe", "severity": "error", "location": "recipe", "message": "m"}),
            &node_ids,
        );
        assert_eq!(recipe_level.node_id, None);
    }
}
