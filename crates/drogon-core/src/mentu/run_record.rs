//! Parsing for the run record `mentu-recipes` writes to
//! `<workspace>/.mentu/runs/<run_id>/run.json` — a narrowed Rust port of the
//! fork's `mentu-run-parsing.ts`, keeping only what the panel/tab need to
//! show honestly: per-step status, evidence file paths and errors. Fields
//! this crate does not display (git/verification/drift metadata, hooks) are
//! left in the raw JSON rather than modeled, matching this product's own
//! wire contract (`MentuStepRun`) rather than the fork's fuller shape.

use std::fs;
use std::path::{Path, PathBuf};

use drogon_protocol::RpcError;
use drogon_protocol::mentu::{MentuRunStatus, MentuStepRun};
use serde_json::Value;

use crate::error;

/// A `run_...` id as `mentu-recipes` mints it. Validated before it is ever
/// used to build a filesystem path.
pub fn validate_mentu_run_id(id: &str) -> Result<(), RpcError> {
    let valid = !id.is_empty()
        && id.starts_with("run_")
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if valid {
        Ok(())
    } else {
        Err(error::invalid_argument("Invalid Mentu run id."))
    }
}

fn runs_root(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".mentu").join("runs")
}

/// The run directory `mentu-recipes` owns for `mentu_run_id`, containment
/// checked the same way recipe paths are.
pub fn run_dir(workspace_root: &Path, mentu_run_id: &str) -> Result<PathBuf, RpcError> {
    validate_mentu_run_id(mentu_run_id)?;
    let root = runs_root(workspace_root);
    Ok(root.join(mentu_run_id))
}

/// Reads and parses `run.json` for `mentu_run_id`. `Ok(None)` means the
/// run directory or its record does not exist yet (a run that just
/// started, before `mentu-recipes` has written anything) — distinct from a
/// read/parse failure, which propagates as `Err`.
pub fn read_run_json(workspace_root: &Path, mentu_run_id: &str) -> Result<Option<Value>, RpcError> {
    let path = run_dir(workspace_root, mentu_run_id)?.join("run.json");
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text)
            .map(Some)
            .map_err(|e| error::invalid_argument(format!("run.json is invalid JSON: {e}"))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(error::io_error(e.to_string())),
    }
}

fn workspace_relative_evidence_path(mentu_run_id: &str, file_name: &str) -> Option<String> {
    if file_name.is_empty() || file_name.contains('\0') || file_name.contains('/') {
        return None;
    }
    Some(format!(".mentu/runs/{mentu_run_id}/{file_name}"))
}

fn step_status(exit_code: Option<i64>) -> MentuRunStatus {
    match exit_code {
        Some(0) => MentuRunStatus::Succeeded,
        Some(_) => MentuRunStatus::Failed,
        None => MentuRunStatus::Unavailable,
    }
}

/// Extracts every step this crate's wire contract cares about from a parsed
/// `run.json` object. A step missing its required fields (`label`,
/// `exit_code`) is skipped rather than failing the whole run's evidence —
/// the surrounding steps are still real, honest evidence.
pub fn parse_steps(run_json: &Value, mentu_run_id: &str) -> Vec<MentuStepRun> {
    let Some(steps) = run_json.get("steps").and_then(Value::as_array) else {
        return Vec::new();
    };
    steps
        .iter()
        .filter_map(|step| {
            let label = step.get("label")?.as_str()?.to_string();
            let backend = step
                .get("backend")
                .and_then(Value::as_str)
                .unwrap_or("shell")
                .to_string();
            let exit_code = step.get("exit_code").and_then(Value::as_i64);
            Some(MentuStepRun {
                label,
                backend,
                status: step_status(exit_code),
                exit_code,
                duration_seconds: step.get("duration_seconds").and_then(Value::as_i64),
                attempts: step.get("attempts").and_then(Value::as_i64),
                output_path: step
                    .get("output_file")
                    .and_then(Value::as_str)
                    .and_then(|f| workspace_relative_evidence_path(mentu_run_id, f)),
                error_path: step
                    .get("error_file")
                    .and_then(Value::as_str)
                    .and_then(|f| workspace_relative_evidence_path(mentu_run_id, f)),
                error: if exit_code.is_some_and(|code| code != 0) {
                    step.get("warnings")
                        .and_then(Value::as_array)
                        .map(|warnings| {
                            warnings
                                .iter()
                                .filter_map(Value::as_str)
                                .collect::<Vec<_>>()
                                .join("; ")
                        })
                        .filter(|s| !s.is_empty())
                        .or_else(|| Some(format!("step exited with code {}", exit_code.unwrap())))
                } else {
                    None
                },
            })
        })
        .collect()
}

/// The run's overall outcome string (`"ok"`/`"failed"`/...), mapped to this
/// product's status enum. A run with no steps that ever failed is
/// `succeeded` even if the top-level field is absent (older/partial
/// records); anything reporting an explicit non-`ok` outcome is `failed`.
pub fn overall_status(run_json: &Value, steps: &[MentuStepRun]) -> MentuRunStatus {
    match run_json.get("outcome").and_then(Value::as_str) {
        Some("ok") => MentuRunStatus::Succeeded,
        Some(_) => MentuRunStatus::Failed,
        None if steps
            .iter()
            .any(|s| matches!(s.status, MentuRunStatus::Failed)) =>
        {
            MentuRunStatus::Failed
        }
        None => MentuRunStatus::Succeeded,
    }
}

pub fn ended_at(run_json: &Value) -> Option<String> {
    run_json
        .get("ended_at")
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// Discovers the `run_...` directory `mentu-recipes` created for one
/// invocation, by diffing the `.mentu/runs` listing captured before spawn
/// against the listing seen afterward. More robust than parsing the CLI's
/// human-readable progress output for a `run_` token: this only depends on
/// the on-disk contract every `mentu-recipes` command already honors.
pub fn discover_new_run_id(
    workspace_root: &Path,
    before: &std::collections::HashSet<String>,
) -> Option<String> {
    let root = runs_root(workspace_root);
    let entries = fs::read_dir(&root).ok()?;
    let mut candidates: Vec<(std::time::SystemTime, String)> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if before.contains(&name) || validate_mentu_run_id(&name).is_err() {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, name))
        })
        .collect();
    candidates.sort_by_key(|(modified, _)| *modified);
    candidates.pop().map(|(_, name)| name)
}

pub fn list_run_directory_names(workspace_root: &Path) -> std::collections::HashSet<String> {
    let root = runs_root(workspace_root);
    fs::read_dir(&root)
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_run_json() -> Value {
        json!({
            "run_id": "run_20260907202509_15F1772D",
            "recipe_name": "hello",
            "started_at": "2026-09-07T20:25:09Z",
            "ended_at": "2026-09-07T20:25:09Z",
            "outcome": "ok",
            "cloud_mode": "local-only",
            "steps": [
                {
                    "label": "say-hello",
                    "backend": "shell",
                    "exit_code": 0,
                    "duration_seconds": 0,
                    "attempts": 1,
                    "output_file": "say-hello.stdout",
                    "error_file": "say-hello.stderr"
                }
            ],
            "hooks": []
        })
    }

    #[test]
    fn parses_steps_with_workspace_relative_evidence_paths() {
        let run_json = sample_run_json();
        let steps = parse_steps(&run_json, "run_20260907202509_15F1772D");
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].status, MentuRunStatus::Succeeded);
        assert_eq!(
            steps[0].output_path.as_deref(),
            Some(".mentu/runs/run_20260907202509_15F1772D/say-hello.stdout")
        );
        assert_eq!(overall_status(&run_json, &steps), MentuRunStatus::Succeeded);
    }

    #[test]
    fn a_failed_step_reports_a_status_and_an_error_message() {
        let mut run_json = sample_run_json();
        run_json["outcome"] = json!("failed");
        run_json["steps"][0]["exit_code"] = json!(3);
        run_json["steps"][0]["warnings"] = json!(["Completion policy was not satisfied"]);
        let steps = parse_steps(&run_json, "run_20260907202509_15F1772D");
        assert_eq!(steps[0].status, MentuRunStatus::Failed);
        assert_eq!(
            steps[0].error.as_deref(),
            Some("Completion policy was not satisfied")
        );
        assert_eq!(overall_status(&run_json, &steps), MentuRunStatus::Failed);
    }

    #[test]
    fn run_id_validation_refuses_traversal_and_odd_characters() {
        for bad in ["", "../etc", "run_../x", "run_ x", "not_a_run"] {
            assert!(validate_mentu_run_id(bad).is_err());
        }
        assert!(validate_mentu_run_id("run_20260907202509_15F1772D").is_ok());
    }

    #[test]
    fn discovers_the_one_new_run_directory_created_since_before() {
        let workspace = tempfile::tempdir().unwrap();
        let runs = workspace.path().join(".mentu").join("runs");
        fs::create_dir_all(&runs).unwrap();
        fs::create_dir(runs.join("run_existing")).unwrap();
        let before = list_run_directory_names(workspace.path());
        fs::create_dir(runs.join("run_new")).unwrap();
        let discovered = discover_new_run_id(workspace.path(), &before);
        assert_eq!(discovered.as_deref(), Some("run_new"));
    }
}
