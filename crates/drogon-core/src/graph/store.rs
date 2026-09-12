//! The `.drogon/graph.json` store: one file, two strictly separate halves.
//!
//! - `intent` is written only by the human (through the UI) or a planning
//!   agent; the daemon never writes into it.
//! - `state` is written only by the daemon from real observation; a write
//!   through the intent seam that carries `state` is refused.
//!
//! Writes are atomic (temp file + fsync + rename) so a reader never sees a
//! half-written graph, and unknown fields are merged forward on every write
//! so the two halves can evolve independently.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use drogon_protocol::RpcError;
use drogon_protocol::graph::{
    GRAPH_FILE_DIR, GRAPH_FILE_NAME, GRAPH_VERSION, Graph, GraphIntent, GraphState,
};
use serde_json::{Map, Value, json};

use crate::error;

/// Known intent keys.
const KNOWN_INTENT_KEYS: &[&str] = &["nodes"];
/// Known state keys.
const KNOWN_STATE_KEYS: &[&str] = &["updatedAt", "nodes"];
/// Known state-node keys; unknown state-node fields survive a rewrite.
const KNOWN_STATE_NODE_KEYS: &[&str] = &[
    "id",
    "status",
    "runId",
    "mentuRunId",
    "startedAt",
    "endedAt",
    "evidence",
    "lastError",
    "harness",
    "model",
    "isFreeDefaultRuntime",
];
/// Known node keys; unknown node fields survive a rewrite.
const KNOWN_NODE_KEYS: &[&str] = &[
    "id",
    "title",
    "harness",
    "model",
    "dependsOn",
    "prompt",
    "enabled",
    "provider",
    "verifyCommands",
];

/// Test-only crash seam: set to any value and the writer aborts (SIGABRT)
/// after the temp file is written and fsynced but before the rename, so a
/// test can prove a kill mid-write never produces a torn `graph.json`.
pub const CRASH_AFTER_TEMP_ENV: &str = "DROGON_GRAPH_TEST_ABORT_AFTER_TEMP";

pub fn graph_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(GRAPH_FILE_DIR).join(GRAPH_FILE_NAME)
}

/// The whole file as JSON, with every unknown field intact. A missing file
/// reads as the empty v1 graph (never an error: an unedited workspace simply
/// has no graph yet).
pub fn read_raw(workspace_root: &Path) -> Result<Value, RpcError> {
    let path = graph_path(workspace_root);
    match fs::read_to_string(&path) {
        Ok(text) => {
            let value: Value = serde_json::from_str(&text).map_err(|e| {
                error::invalid_argument(format!("{} is not valid JSON: {e}", path.display()))
            })?;
            check_version(&value)?;
            Ok(value)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(empty_raw()),
        Err(e) => Err(error::io_error(format!(
            "cannot read {}: {e}",
            path.display()
        ))),
    }
}

fn empty_raw() -> Value {
    json!({
        "version": GRAPH_VERSION,
        "intent": {"nodes": []},
        "state": {"updatedAt": "", "nodes": []},
    })
}

fn check_version(value: &Value) -> Result<(), RpcError> {
    if !value.is_object() {
        return Err(error::invalid_argument(
            "The graph file must be a JSON object with `intent` and `state`.",
        ));
    }
    if let Some(version) = value.get("version") {
        match version.as_u64() {
            Some(found) if found == u64::from(GRAPH_VERSION) => Ok(()),
            Some(found) => Err(RpcError::new(
                "graph_version_unsupported",
                format!(
                    "This graph file is version {found}; this build reads and writes version \
                     {GRAPH_VERSION}. Refusing to rewrite a newer graph."
                ),
            )),
            None => Err(error::invalid_argument(
                "The graph file's `version` must be an integer.",
            )),
        }
    } else {
        Ok(())
    }
}

/// The typed view the RPC returns. Built from the raw file so unknown fields
/// in the other half are irrelevant to the caller.
pub fn read_graph(workspace_root: &Path) -> Result<Graph, RpcError> {
    let raw = read_raw(workspace_root)?;
    let graph: Graph = serde_json::from_value(raw)
        .map_err(|e| error::invalid_argument(format!("Invalid graph shape: {e}")))?;
    if graph.version != GRAPH_VERSION {
        return Err(RpcError::new(
            "graph_version_unsupported",
            format!(
                "This graph file is version {}; this build reads and writes version \
                 {GRAPH_VERSION}.",
                graph.version
            ),
        ));
    }
    Ok(graph)
}

/// The human-owned write: replaces `intent`, never touches `state`, and
/// merges unknown fields forward. Refuses a payload that carries `state`.
pub fn write_intent(workspace_root: &Path, intent: &Value) -> Result<Graph, RpcError> {
    drogon_protocol::graph::require_no_state_half(intent)?;
    // Validate semantically before any write so a bad graph never lands.
    let parsed: GraphIntent = serde_json::from_value(intent.clone())
        .map_err(|e| error::invalid_argument(format!("Invalid graph intent: {e}")))?;
    parsed.validate()?;

    let mut raw = read_raw(workspace_root)?;
    let merged = merge_intent(raw.get("intent"), intent);
    let object = raw
        .as_object_mut()
        .ok_or_else(|| error::invalid_argument("The graph file must be a JSON object."))?;
    object.insert("version".into(), json!(GRAPH_VERSION));
    object.insert("intent".into(), merged);
    if !object.contains_key("state") || !object["state"].is_object() {
        object.insert("state".into(), empty_raw()["state"].clone());
    }
    write_atomic(&graph_path(workspace_root), &raw)?;
    read_graph(workspace_root)
}

/// The daemon-owned write: replaces `state`, never touches `intent`, and
/// merges unknown state fields forward (a state node deleted from the
/// projection is actually removed; unknown keys on the surviving nodes are
/// kept).
pub fn write_state(workspace_root: &Path, state: &GraphState) -> Result<Graph, RpcError> {
    let mut raw = read_raw(workspace_root)?;
    let incoming = serde_json::to_value(state).map_err(|e| error::internal_error(e.to_string()))?;
    let merged = merge_keyed(
        raw.get("state"),
        &incoming,
        KNOWN_STATE_KEYS,
        KNOWN_STATE_NODE_KEYS,
    );
    let object = raw
        .as_object_mut()
        .ok_or_else(|| error::invalid_argument("The graph file must be a JSON object."))?;
    object.insert("version".into(), json!(GRAPH_VERSION));
    object.insert("state".into(), merged);
    if !object.contains_key("intent") || !object["intent"].is_object() {
        object.insert("intent".into(), json!({"nodes": []}));
    }
    write_atomic(&graph_path(workspace_root), &raw)?;
    read_graph(workspace_root)
}

/// Writes `state` only when it differs, so a read-repair does not churn the
/// file (and its mtime) on every poll.
pub fn write_state_if_changed(
    workspace_root: &Path,
    state: &GraphState,
) -> Result<Graph, RpcError> {
    let current = read_graph(workspace_root)?;
    if current.state == *state {
        return Ok(current);
    }
    write_state(workspace_root, state)
}

/// Deep merge that preserves fields this build does not model:
/// known keys follow the incoming value exactly (including removal), while
/// unknown keys already on disk survive unless the incoming object sets them.
fn merge_known_and_unknown(existing: &Value, incoming: &Value, known: &[&str]) -> Value {
    match (existing, incoming) {
        (Value::Object(prev), Value::Object(next)) => {
            let mut merged: Map<String, Value> = next.clone();
            for (key, value) in prev {
                if known.contains(&key.as_str()) {
                    continue;
                }
                match merged.get_mut(key) {
                    Some(incoming_value) => {
                        *incoming_value = merge_known_and_unknown(value, incoming_value, &[]);
                    }
                    None => {
                        merged.insert(key.clone(), value.clone());
                    }
                }
            }
            Value::Object(merged)
        }
        (_, incoming) => incoming.clone(),
    }
}

fn merge_intent(existing: Option<&Value>, incoming: &Value) -> Value {
    merge_keyed(existing, incoming, KNOWN_INTENT_KEYS, KNOWN_NODE_KEYS)
}

/// Merge a half whose `nodes` array is keyed by `id`: unknown keys at the
/// half level survive, and unknown keys on nodes that still exist survive.
/// Nodes absent from `incoming` are genuinely removed.
fn merge_keyed(
    existing: Option<&Value>,
    incoming: &Value,
    known_half_keys: &[&str],
    known_node_keys: &[&str],
) -> Value {
    let Some(existing) = existing else {
        return incoming.clone();
    };
    let mut merged = merge_known_and_unknown(existing, incoming, known_half_keys);
    let existing_nodes = existing.get("nodes").and_then(Value::as_array).cloned();
    if let (Some(prev), Some(next)) = (
        existing_nodes,
        merged.get("nodes").and_then(Value::as_array).cloned(),
    ) {
        let nodes: Vec<Value> = next
            .iter()
            .map(|node| {
                let id = node.get("id").and_then(Value::as_str);
                match id.and_then(|id| {
                    prev.iter()
                        .find(|candidate| candidate.get("id").and_then(Value::as_str) == Some(id))
                }) {
                    Some(previous) => merge_known_and_unknown(previous, node, known_node_keys),
                    None => node.clone(),
                }
            })
            .collect();
        if let Some(object) = merged.as_object_mut() {
            object.insert("nodes".into(), Value::Array(nodes));
        }
    }
    merged
}

/// Atomic write: temp file in the same directory, fsync, rename over the
/// target. A reader (or a crash) can only ever observe the old complete file
/// or the new complete file — never a partial one.
fn write_atomic(path: &Path, value: &Value) -> Result<(), RpcError> {
    let directory = path
        .parent()
        .ok_or_else(|| error::internal_error("graph path has no parent directory"))?;
    fs::create_dir_all(directory)
        .map_err(|e| error::io_error(format!("cannot create {}: {e}", directory.display())))?;
    let bytes =
        serde_json::to_vec_pretty(value).map_err(|e| error::internal_error(e.to_string()))?;
    let temp = directory.join(format!(
        ".{GRAPH_FILE_NAME}.tmp.{}.{}",
        std::process::id(),
        unique_suffix()
    ));
    {
        let mut file = fs::File::create(&temp)
            .map_err(|e| error::io_error(format!("cannot create {}: {e}", temp.display())))?;
        file.write_all(&bytes)
            .and_then(|()| file.write_all(b"\n"))
            .and_then(|()| file.sync_all())
            .map_err(|e| {
                let _ = fs::remove_file(&temp);
                error::io_error(format!("cannot write {}: {e}", temp.display()))
            })?;
    }
    if std::env::var_os(CRASH_AFTER_TEMP_ENV).is_some() {
        // Test seam only: simulate a kill between temp write and rename.
        std::process::abort();
    }
    fs::rename(&temp, path).map_err(|e| {
        let _ = fs::remove_file(&temp);
        error::io_error(format!("cannot replace {}: {e}", path.display()))
    })?;
    // Best-effort directory fsync so the rename itself is durable.
    if let Ok(dir) = fs::File::open(directory) {
        let _ = dir.sync_all();
    }
    Ok(())
}

fn unique_suffix() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("{nanos:x}.{count:x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use drogon_protocol::graph::{GraphNodeIntent, GraphNodeProvider};

    fn workspace() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn node(id: &str) -> Value {
        json!({
            "id": id,
            "title": format!("Node {id}"),
            "harness": "shell",
            "model": "",
            "dependsOn": [],
            "prompt": "echo hi",
            "enabled": true,
        })
    }

    #[test]
    fn missing_file_reads_as_the_empty_v1_graph() {
        let dir = workspace();
        let graph = read_graph(dir.path()).unwrap();
        assert_eq!(graph.version, GRAPH_VERSION);
        assert!(graph.intent.nodes.is_empty());
        assert!(graph.state.nodes.is_empty());
    }

    #[test]
    fn intent_writes_leave_the_state_half_and_unknown_root_keys_alone() {
        let dir = workspace();
        let path = graph_path(dir.path());
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            serde_json::to_string_pretty(&json!({
                "version": 1,
                "futureRootKey": {"kept": true},
                "intent": {
                    "nodes": [node("n1")],
                    "futureIntentKey": 7
                },
                "state": {
                    "updatedAt": "2026-01-01T00:00:00Z",
                    "nodes": [{"id": "n1", "status": "running", "futureStateKey": "kept"}]
                }
            }))
            .unwrap(),
        )
        .unwrap();

        write_intent(dir.path(), &json!({"nodes": [node("n1"), node("n2")]})).unwrap();

        let raw: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        // state untouched, including its unknown field.
        assert_eq!(raw["state"]["nodes"][0]["status"], "running");
        assert_eq!(raw["state"]["nodes"][0]["futureStateKey"], "kept");
        // root + intent unknown keys preserved.
        assert_eq!(raw["futureRootKey"]["kept"], true);
        assert_eq!(raw["intent"]["futureIntentKey"], 7);
        assert_eq!(raw["intent"]["nodes"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn policy_survives_an_intent_write_that_does_not_mention_it() {
        let dir = workspace();
        // The Subagent policy panel configures a real policy first.
        let policy = json!({
            "approvedRuntimes": [
                {"harness": "opencode", "model": "claude-sonnet-4"},
                {"harness": "codex", "model": "gpt-5.3-codex"},
            ],
            "fallbackRuntime": {"harness": "custom", "model": "qwen3-coder"},
            "adversarial": {"enabled": true, "maxIterations": 10},
            "delegate": true,
        });
        write_intent(
            dir.path(),
            &json!({"nodes": [node("n1")], "policy": policy}),
        )
        .unwrap();

        // Later, the authoring canvas saves a plain node edit — a payload
        // that names `nodes` only, exactly what `WorkGraphDesigner` sends
        // today. The policy the panel configured must not vanish.
        write_intent(dir.path(), &json!({"nodes": [node("n1"), node("n2")]})).unwrap();

        let graph = read_graph(dir.path()).unwrap();
        assert_eq!(graph.intent.policy.approved_runtimes.len(), 2);
        assert_eq!(graph.intent.policy.approved_runtimes[0].harness, "opencode");
        assert_eq!(
            graph.intent.policy.fallback_runtime.as_ref().unwrap().model,
            "qwen3-coder"
        );
        assert!(graph.intent.policy.adversarial.enabled);
        assert_eq!(graph.intent.policy.adversarial.max_iterations, 10);
        assert!(graph.intent.policy.delegate);
        assert_eq!(
            graph.intent.nodes.len(),
            2,
            "the node edit itself must still apply"
        );
    }

    #[test]
    fn policy_update_replaces_the_whole_policy_and_keeps_nodes_from_incoming() {
        let dir = workspace();
        write_intent(
            dir.path(),
            &json!({
                "nodes": [node("n1")],
                "policy": {"delegate": false, "adversarial": {"enabled": false, "maxIterations": 3}},
            }),
        )
        .unwrap();

        // The policy panel resends the CURRENT nodes verbatim plus its own
        // new policy — the pattern the panel must follow so it never wipes
        // nodes it did not intend to touch.
        write_intent(
            dir.path(),
            &json!({
                "nodes": [node("n1")],
                "policy": {"delegate": true, "adversarial": {"enabled": true, "maxIterations": 5}},
            }),
        )
        .unwrap();

        let graph = read_graph(dir.path()).unwrap();
        assert!(graph.intent.policy.delegate);
        assert!(graph.intent.policy.adversarial.enabled);
        assert_eq!(graph.intent.policy.adversarial.max_iterations, 5);
    }

    #[test]
    fn node_level_unknown_fields_survive_a_rewrite_but_removed_nodes_do_not() {
        let dir = workspace();
        let mut first = node("n1");
        first["futureNodeKey"] = json!({"ui": "extension"});
        write_intent(dir.path(), &json!({"nodes": [first, node("n2")]})).unwrap();

        // Rewrite without `futureNodeKey` on n1 and without n2 entirely.
        write_intent(dir.path(), &json!({"nodes": [node("n1")]})).unwrap();

        let raw = read_raw(dir.path()).unwrap();
        let nodes = raw["intent"]["nodes"].as_array().unwrap();
        assert_eq!(nodes.len(), 1, "a deleted node must actually be removed");
        assert_eq!(nodes[0]["futureNodeKey"]["ui"], "extension");
    }

    #[test]
    fn write_intent_refuses_a_state_payload() {
        let dir = workspace();
        let err =
            write_intent(dir.path(), &json!({"nodes": [], "state": {"nodes": []}})).unwrap_err();
        assert_eq!(err.code, "invalid_argument");
        assert!(!graph_path(dir.path()).exists());
    }

    #[test]
    fn a_newer_file_version_is_refused_not_rewritten() {
        let dir = workspace();
        let path = graph_path(dir.path());
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            r#"{"version":2,"intent":{"nodes":[]},"state":{"nodes":[]}}"#,
        )
        .unwrap();
        let err = read_graph(dir.path()).unwrap_err();
        assert_eq!(err.code, "graph_version_unsupported");
        assert!(write_intent(dir.path(), &json!({"nodes": []})).is_err());
        // The file is byte-identical after the refusal.
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            r#"{"version":2,"intent":{"nodes":[]},"state":{"nodes":[]}}"#
        );
    }

    #[test]
    fn unknown_state_node_fields_survive_a_daemon_state_rewrite() {
        let dir = workspace();
        let path = graph_path(dir.path());
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            serde_json::to_string_pretty(&json!({
                "version": 1,
                "intent": {"nodes": [node("n1")]},
                "state": {
                    "updatedAt": "then",
                    "nodes": [{"id": "n1", "status": "idle", "futureStateNodeKey": "kept"}]
                }
            }))
            .unwrap(),
        )
        .unwrap();
        write_state(
            dir.path(),
            &GraphState {
                updated_at: "now".into(),
                nodes: vec![drogon_protocol::graph::GraphNodeState {
                    id: "n1".into(),
                    status: drogon_protocol::graph::GraphNodeStatus::Running,
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
            },
        )
        .unwrap();
        let raw = read_raw(dir.path()).unwrap();
        assert_eq!(raw["state"]["updatedAt"], "now");
        assert_eq!(raw["state"]["nodes"][0]["status"], "running");
        assert_eq!(raw["state"]["nodes"][0]["futureStateNodeKey"], "kept");
        // A node dropped from the projection is really removed.
        write_state(
            dir.path(),
            &GraphState {
                updated_at: "later".into(),
                nodes: vec![],
            },
        )
        .unwrap();
        assert!(
            read_raw(dir.path()).unwrap()["state"]["nodes"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn a_bad_node_never_reaches_disk() {
        let dir = workspace();
        let err = write_intent(
            dir.path(),
            &json!({"nodes": [{"id": "n1", "title": "t", "harness": "shell", "prompt": "", "model": ""}]}),
        )
        .unwrap_err();
        assert_eq!(err.code, "invalid_argument");
        assert!(!graph_path(dir.path()).exists());
    }

    #[test]
    fn state_write_if_changed_does_not_touch_the_file_when_equal() {
        let dir = workspace();
        write_intent(dir.path(), &json!({"nodes": [node("n1")]})).unwrap();
        let state = GraphState {
            updated_at: "2026-01-01T00:00:00Z".into(),
            nodes: vec![],
        };
        write_state_if_changed(dir.path(), &state).unwrap();
        let path = graph_path(dir.path());
        let first = fs::read_to_string(&path).unwrap();
        write_state_if_changed(dir.path(), &state).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), first);
    }

    #[test]
    fn the_typed_read_is_stable_across_a_state_round_trip() {
        let dir = workspace();
        write_intent(dir.path(), &json!({"nodes": [node("n1")]})).unwrap();
        let graph = write_state(
            dir.path(),
            &GraphState {
                updated_at: "2026-01-01T00:00:00Z".into(),
                nodes: vec![drogon_protocol::graph::GraphNodeState {
                    id: "n1".into(),
                    status: drogon_protocol::graph::GraphNodeStatus::Idle,
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
            },
        )
        .unwrap();
        assert_eq!(graph.state.nodes[0].status.as_wire(), "idle");
        assert_eq!(graph.intent.nodes[0].id, "n1");
    }

    #[test]
    fn a_typed_node_with_a_provider_round_trips_through_the_store() {
        let dir = workspace();
        let intent = GraphIntent {
            nodes: vec![GraphNodeIntent {
                id: "n1".into(),
                title: "t".into(),
                harness: "pi".into(),
                model: "m".into(),
                depends_on: vec![],
                prompt: "do".into(),
                enabled: true,
                provider: Some(GraphNodeProvider {
                    base_url: "http://127.0.0.1:9/v1".into(),
                    api_key_env: "K".into(),
                }),
                verify_commands: vec![],
            }],
            ..GraphIntent::default()
        };
        let value = serde_json::to_value(&intent).unwrap();
        write_intent(dir.path(), &value).unwrap();
        let graph = read_graph(dir.path()).unwrap();
        assert_eq!(graph.intent, intent);
    }
}
