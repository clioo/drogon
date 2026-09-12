//! Native Work Graph evidence and token usage under `<workspace>/.drogon/`.
//! These ledgers deliberately do not read Mentu recipes or run records.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use drogon_protocol::RpcError;
use drogon_protocol::graph::{
    GRAPH_EVIDENCE_FILE_NAME, GRAPH_FILE_DIR, GRAPH_USAGE_FILE_NAME, GraphEvidenceEntry,
    GraphObservabilitySnapshot, GraphUsageEntry, MAX_GRAPH_ARTIFACTS,
    MAX_GRAPH_EVIDENCE_DETAIL_BYTES, MAX_GRAPH_EVIDENCE_SUMMARY_BYTES,
    MAX_GRAPH_OBSERVABILITY_ENTRIES,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

use crate::{Engine, error};
use drogon_protocol::Request;

const OBSERVABILITY_VERSION: u32 = 1;
const MAX_LEDGER_BYTES: u64 = 16 * 1024 * 1024;
const MAX_TOKEN_VALUE: u64 = 9_007_199_254_740_991;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Ledger<T> {
    #[serde(default = "ledger_version")]
    version: u32,
    entries: Vec<T>,
}

fn ledger_version() -> u32 {
    OBSERVABILITY_VERSION
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceParams {
    workspace_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EvidenceAppendParams {
    workspace_id: String,
    status: String,
    summary: String,
    #[serde(default)]
    detail: Option<String>,
    #[serde(default)]
    artifacts: Vec<String>,
    #[serde(default)]
    run_id: Option<String>,
    #[serde(default)]
    agent_id: Option<String>,
    #[serde(default)]
    role: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageAppendParams {
    workspace_id: String,
    #[serde(default)]
    run_id: Option<String>,
    #[serde(default)]
    agent_id: Option<String>,
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    harness: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    input_tokens: Option<u64>,
    #[serde(default)]
    output_tokens: Option<u64>,
    #[serde(default)]
    cache_read_tokens: Option<u64>,
    #[serde(default)]
    cache_write_tokens: Option<u64>,
}

fn parse<T: DeserializeOwned>(value: &Value) -> Result<T, RpcError> {
    serde_json::from_value(value.clone()).map_err(|e| error::invalid_argument(e.to_string()))
}

fn ledger_path(root: &Path, name: &str) -> PathBuf {
    root.join(GRAPH_FILE_DIR).join(name)
}

fn read_ledger<T: DeserializeOwned>(path: &Path) -> Result<Ledger<T>, RpcError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Ledger {
                version: OBSERVABILITY_VERSION,
                entries: Vec::new(),
            });
        }
        Err(err) => {
            return Err(error::io_error(format!(
                "cannot inspect {}: {err}",
                path.display()
            )));
        }
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(error::invalid_argument(format!(
            "{} must be a regular file owned by the workspace.",
            path.display()
        )));
    }
    if metadata.len() > MAX_LEDGER_BYTES {
        return Err(error::invalid_argument(format!(
            "{} exceeds the native observability size limit.",
            path.display()
        )));
    }
    let text = fs::read_to_string(path)
        .map_err(|err| error::io_error(format!("cannot read {}: {err}", path.display())))?;
    let ledger: Ledger<T> = serde_json::from_str(&text).map_err(|err| {
        error::invalid_argument(format!("{} is not valid JSON: {err}", path.display()))
    })?;
    if ledger.version != OBSERVABILITY_VERSION {
        return Err(error::invalid_argument(format!(
            "{} has unsupported version {}.",
            path.display(),
            ledger.version
        )));
    }
    Ok(ledger)
}

fn write_ledger<T: Serialize>(path: &Path, ledger: &Ledger<T>) -> Result<(), RpcError> {
    let directory = path
        .parent()
        .ok_or_else(|| error::internal_error("ledger path has no parent"))?;
    if let Ok(metadata) = fs::symlink_metadata(directory)
        && metadata.file_type().is_symlink()
    {
        return Err(error::invalid_argument(".drogon must not be a symlink."));
    }
    fs::create_dir_all(directory)
        .map_err(|err| error::io_error(format!("cannot create {}: {err}", directory.display())))?;
    let bytes =
        serde_json::to_vec_pretty(ledger).map_err(|err| error::internal_error(err.to_string()))?;
    if bytes.len() as u64 > MAX_LEDGER_BYTES {
        return Err(error::invalid_argument(
            "The native observability ledger is full.",
        ));
    }
    let temp = directory.join(format!(
        ".{}.tmp.{}.{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("observability"),
        std::process::id(),
        uuid::Uuid::new_v4().simple()
    ));
    {
        let mut file = fs::File::create(&temp)
            .map_err(|err| error::io_error(format!("cannot create {}: {err}", temp.display())))?;
        file.write_all(&bytes)
            .and_then(|()| file.write_all(b"\n"))
            .and_then(|()| file.sync_all())
            .map_err(|err| {
                let _ = fs::remove_file(&temp);
                error::io_error(format!("cannot write {}: {err}", temp.display()))
            })?;
    }
    fs::rename(&temp, path).map_err(|err| {
        let _ = fs::remove_file(&temp);
        error::io_error(format!("cannot replace {}: {err}", path.display()))
    })?;
    if let Ok(directory) = fs::File::open(directory) {
        let _ = directory.sync_all();
    }
    Ok(())
}

fn validate_text(
    value: &str,
    maximum: usize,
    label: &str,
    allow_empty: bool,
) -> Result<(), RpcError> {
    if (!allow_empty && value.trim().is_empty()) || value.len() > maximum || value.contains('\0') {
        return Err(error::invalid_argument(format!(
            "{label} is empty, too long, or carries NUL."
        )));
    }
    Ok(())
}

fn validate_optional(value: &Option<String>, label: &str) -> Result<(), RpcError> {
    if let Some(value) = value {
        validate_text(value, 4 * 1024, label, false)?;
    }
    Ok(())
}

fn snapshot(root: &Path) -> Result<GraphObservabilitySnapshot, RpcError> {
    let evidence: Ledger<GraphEvidenceEntry> =
        read_ledger(&ledger_path(root, GRAPH_EVIDENCE_FILE_NAME))?;
    let usage: Ledger<GraphUsageEntry> = read_ledger(&ledger_path(root, GRAPH_USAGE_FILE_NAME))?;
    let updated_at = evidence
        .entries
        .last()
        .map(|entry| entry.timestamp.as_str())
        .into_iter()
        .chain(usage.entries.last().map(|entry| entry.timestamp.as_str()))
        .max()
        .unwrap_or_default()
        .to_string();
    Ok(GraphObservabilitySnapshot {
        evidence: evidence.entries,
        usage: usage.entries,
        updated_at,
    })
}

impl Engine {
    pub(crate) fn graph_observability_status(&self, params: &Value) -> Result<Value, RpcError> {
        let parsed: WorkspaceParams = parse(params)?;
        let root = self.workspace_path(&parsed.workspace_id)?;
        let _gate = self.graph_orchestrator_gate.lock().unwrap();
        Ok(json!({"observability": snapshot(&root)?}))
    }

    pub(crate) fn graph_evidence_append(&self, request: &Request) -> Result<Value, RpcError> {
        self.mutating(request, |engine, params| {
            let parsed: EvidenceAppendParams = parse(params)?;
            if !matches!(
                parsed.status.as_str(),
                "progress" | "finding" | "blocked" | "completed" | "failed"
            ) {
                return Err(error::invalid_argument(
                    "Evidence status must be progress, finding, blocked, completed, or failed.",
                ));
            }
            validate_text(
                &parsed.summary,
                MAX_GRAPH_EVIDENCE_SUMMARY_BYTES,
                "Evidence summary",
                false,
            )?;
            if let Some(detail) = &parsed.detail {
                validate_text(
                    detail,
                    MAX_GRAPH_EVIDENCE_DETAIL_BYTES,
                    "Evidence detail",
                    true,
                )?;
            }
            if parsed.artifacts.len() > MAX_GRAPH_ARTIFACTS {
                return Err(error::invalid_argument(
                    "Evidence carries too many artifacts.",
                ));
            }
            for artifact in &parsed.artifacts {
                validate_text(artifact, 4 * 1024, "Evidence artifact", false)?;
            }
            validate_optional(&parsed.run_id, "Evidence run id")?;
            validate_optional(&parsed.agent_id, "Evidence agent id")?;
            validate_optional(&parsed.role, "Evidence role")?;
            let root = engine.workspace_path(&parsed.workspace_id)?;
            let _gate = engine.graph_orchestrator_gate.lock().unwrap();
            let path = ledger_path(&root, GRAPH_EVIDENCE_FILE_NAME);
            let mut ledger: Ledger<GraphEvidenceEntry> = read_ledger(&path)?;
            if ledger.entries.len() >= MAX_GRAPH_OBSERVABILITY_ENTRIES {
                return Err(error::invalid_argument(
                    "The evidence ledger reached its entry limit.",
                ));
            }
            ledger.entries.push(GraphEvidenceEntry {
                id: uuid::Uuid::new_v4().simple().to_string(),
                timestamp: crate::now_rfc3339(),
                status: parsed.status,
                summary: parsed.summary,
                detail: parsed.detail,
                artifacts: parsed.artifacts,
                run_id: parsed.run_id,
                agent_id: parsed.agent_id,
                role: parsed.role,
            });
            write_ledger(&path, &ledger)?;
            Ok(json!({"observability": snapshot(&root)?}))
        })
    }

    pub(crate) fn graph_usage_append(&self, request: &Request) -> Result<Value, RpcError> {
        self.mutating(request, |engine, params| {
            let parsed: UsageAppendParams = parse(params)?;
            let values = [
                parsed.input_tokens,
                parsed.output_tokens,
                parsed.cache_read_tokens,
                parsed.cache_write_tokens,
            ];
            if values.iter().all(Option::is_none) {
                return Err(error::invalid_argument(
                    "Usage must report at least one token field.",
                ));
            }
            if values
                .into_iter()
                .flatten()
                .any(|value| value > MAX_TOKEN_VALUE)
            {
                return Err(error::invalid_argument(
                    "A usage token value exceeds JavaScript's exact integer range.",
                ));
            }
            validate_optional(&parsed.run_id, "Usage run id")?;
            validate_optional(&parsed.agent_id, "Usage agent id")?;
            validate_optional(&parsed.role, "Usage role")?;
            validate_optional(&parsed.harness, "Usage harness")?;
            validate_optional(&parsed.model, "Usage model")?;
            let root = engine.workspace_path(&parsed.workspace_id)?;
            let _gate = engine.graph_orchestrator_gate.lock().unwrap();
            let path = ledger_path(&root, GRAPH_USAGE_FILE_NAME);
            let mut ledger: Ledger<GraphUsageEntry> = read_ledger(&path)?;
            if ledger.entries.len() >= MAX_GRAPH_OBSERVABILITY_ENTRIES {
                return Err(error::invalid_argument(
                    "The usage ledger reached its entry limit.",
                ));
            }
            ledger.entries.push(GraphUsageEntry {
                id: uuid::Uuid::new_v4().simple().to_string(),
                timestamp: crate::now_rfc3339(),
                run_id: parsed.run_id,
                agent_id: parsed.agent_id,
                role: parsed.role,
                harness: parsed.harness,
                model: parsed.model,
                input_tokens: parsed.input_tokens,
                output_tokens: parsed.output_tokens,
                cache_read_tokens: parsed.cache_read_tokens,
                cache_write_tokens: parsed.cache_write_tokens,
            });
            write_ledger(&path, &ledger)?;
            Ok(json!({"observability": snapshot(&root)?}))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(method: &str, params: Value) -> Request {
        Request {
            protocol: drogon_protocol::PROTOCOL_VERSION,
            request_id: uuid::Uuid::new_v4().to_string(),
            auth: None,
            method: method.into(),
            params,
        }
    }

    fn engine_and_workspace() -> (tempfile::TempDir, Engine, String) {
        let root = tempfile::tempdir().unwrap();
        let engine = Engine::open(&root.path().join("data")).unwrap();
        let registered =
            engine.dispatch(request("workspace.register", json!({"path": root.path()})));
        let workspace = registered.result.unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        (root, engine, workspace)
    }

    #[test]
    fn native_evidence_and_usage_are_durable_workspace_files() {
        let (root, engine, workspace) = engine_and_workspace();
        engine
            .graph_evidence_append(&request(
                "graph.evidence_append",
                json!({
                    "workspaceId": workspace, "status": "progress", "summary": "Tests are green",
                    "artifacts": ["reports/unit.txt"], "agentId": "leader"
                }),
            ))
            .unwrap();
        engine
            .graph_usage_append(&request(
                "graph.usage_append",
                json!({
                    "workspaceId": workspace, "agentId": "leader", "harness": "pi",
                    "inputTokens": 120, "outputTokens": 30
                }),
            ))
            .unwrap();
        let status = engine
            .graph_observability_status(&json!({"workspaceId": workspace}))
            .unwrap();
        assert_eq!(
            status["observability"]["evidence"][0]["summary"],
            "Tests are green"
        );
        assert_eq!(status["observability"]["usage"][0]["inputTokens"], 120);
        assert!(root.path().join(".drogon/evidence.json").is_file());
        assert!(root.path().join(".drogon/usage.json").is_file());
        let evidence = fs::read_to_string(root.path().join(".drogon/evidence.json")).unwrap();
        assert!(!evidence.contains("mentu"));
    }

    #[test]
    fn usage_refuses_an_empty_measurement() {
        let (_root, engine, workspace) = engine_and_workspace();
        let error = engine
            .graph_usage_append(&request(
                "graph.usage_append",
                json!({
                    "workspaceId": workspace, "agentId": "leader"
                }),
            ))
            .unwrap_err();
        assert!(error.message.contains("at least one token field"));
    }
}
