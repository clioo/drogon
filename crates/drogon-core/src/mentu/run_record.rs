//! Parsing for the run record `mentu-recipes` writes to
//! `<workspace>/.mentu/runs/<run_id>/run.json` — a narrowed Rust port of the
//! fork's `mentu-run-parsing.ts`, keeping only what the panel/tab need to
//! show honestly: per-step status, evidence file paths, errors and the
//! recorded `verification` results.
//!
//! MIT Copyright (c) 2026 Lovecast Inc. Fields this crate does not display
//! (git/drift metadata, hooks) are left in the raw JSON rather than
//! modeled, matching this product's own wire contract (`MentuStepRun`)
//! rather than the fork's fuller shape.

use std::fs;
use std::path::{Path, PathBuf};

use drogon_protocol::RpcError;
use drogon_protocol::mentu::{
    MAX_MENTU_EVIDENCE_BYTES, MENTU_EVIDENCE_CONTENT_TRUNCATED, MENTU_EVIDENCE_OUTSIDE_RUN_DIR,
    MentuReferencedOutput, MentuRunStatus, MentuStepEvidence, MentuStepRun, MentuStepVerification,
};
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

/// A step's own status. The record's per-step `outcome` wins: a step can
/// fail boundary verification with a zero exit code (and vice versa for
/// older records, which carry no outcome and fall back to the exit code).
fn step_status(step: &Value, exit_code: Option<i64>) -> MentuRunStatus {
    match step.get("outcome").and_then(Value::as_str) {
        Some("ok") => MentuRunStatus::Succeeded,
        Some("failed") => MentuRunStatus::Failed,
        Some("running") => MentuRunStatus::Running,
        _ => match exit_code {
            Some(0) => MentuRunStatus::Succeeded,
            Some(_) => MentuRunStatus::Failed,
            None => MentuRunStatus::Unavailable,
        },
    }
}

/// One verification issue message: a plain string, or an object carrying a
/// `message` string like the real `mentu-recipes` writes
/// (`{"kind": "command", "message": "..."}`).
fn verification_issue(issue: &Value) -> String {
    if let Some(text) = issue.as_str() {
        return text.to_string();
    }
    issue
        .get("message")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| "Unrecognized verification issue; inspect the raw run record.".into())
}

fn verification_messages(step: &Value, key: &str) -> Vec<String> {
    step.get("verification")
        .and_then(|verification| verification.get(key))
        .and_then(Value::as_array)
        .map(|issues| issues.iter().map(verification_issue).collect())
        .unwrap_or_default()
}

/// The recorded `verification` object when the step carries one; `None`
/// when it does not, so the desktop renders "not recorded" rather than a
/// clean bill it cannot prove.
fn step_verification(step: &Value) -> Option<MentuStepVerification> {
    step.get("verification")?.as_object()?;
    Some(MentuStepVerification {
        errors: verification_messages(step, "errors"),
        warnings: verification_messages(step, "warnings"),
    })
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
                status: step_status(step, exit_code),
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
                verification: step_verification(step),
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

fn outside_run_dir(reference: &str) -> MentuReferencedOutput {
    MentuReferencedOutput {
        reference: reference.to_string(),
        path: None,
        content: None,
        error: Some(MENTU_EVIDENCE_OUTSIDE_RUN_DIR.to_string()),
    }
}

/// Reads one stdio evidence file a run record references (`output_file` /
/// `error_file`), a narrowed Rust port of the fork's `readMentuOutput`
/// (`src/main/mentu/mentu-run-evidence-files.ts`): the reference must be a
/// bare file name resolving inside `canonical_run_dir` — empty, absolute
/// and escaping references are refused, as are paths the OS will not
/// resolve to a file inside the run dir (a missing stream included, like
/// the fork's failed `realpath`). At most [`MAX_MENTU_EVIDENCE_BYTES`] are
/// read; longer streams keep their head bytes (lossy UTF-8, like the
/// fork's buffer `toString`) with `content_truncated`. Other read failures
/// keep the candidate path with the OS error message.
///
/// `canonical_run_dir` must already be canonicalized (the caller resolves
/// it once per run); every candidate is canonicalized too, so a symlink
/// pointing outside the run dir is refused rather than followed.
pub fn read_evidence_output(canonical_run_dir: &Path, reference: &str) -> MentuReferencedOutput {
    if reference.is_empty() || reference.contains('\0') || Path::new(reference).is_absolute() {
        return outside_run_dir(reference);
    }
    let candidate = canonical_run_dir.join(reference);
    // Lexical escape (`..`) before touching the filesystem.
    if !candidate.starts_with(canonical_run_dir) {
        return outside_run_dir(reference);
    }
    let resolved = match candidate.canonicalize() {
        Ok(resolved) if resolved.starts_with(canonical_run_dir) => resolved,
        _ => return outside_run_dir(reference),
    };
    let mut file = match fs::File::open(&resolved) {
        Ok(file) => file,
        Err(e) => {
            return MentuReferencedOutput {
                reference: reference.to_string(),
                path: Some(candidate.to_string_lossy().into_owned()),
                content: None,
                error: Some(e.to_string()),
            };
        }
    };
    use std::io::Read as _;
    let mut head = Vec::with_capacity(MAX_MENTU_EVIDENCE_BYTES.min(8192));
    // One byte past the cap decides truncation without reading a
    // multi-gigabyte stream into memory.
    let mut tail = [0u8; 1];
    let truncated = match file
        .by_ref()
        .take(MAX_MENTU_EVIDENCE_BYTES as u64)
        .read_to_end(&mut head)
    {
        Ok(_) => matches!(file.read(&mut tail), Ok(1)),
        Err(e) => {
            return MentuReferencedOutput {
                reference: reference.to_string(),
                path: Some(resolved.to_string_lossy().into_owned()),
                content: None,
                error: Some(e.to_string()),
            };
        }
    };
    MentuReferencedOutput {
        reference: reference.to_string(),
        path: Some(resolved.to_string_lossy().into_owned()),
        content: Some(String::from_utf8_lossy(&head).into_owned()),
        error: if truncated {
            Some(MENTU_EVIDENCE_CONTENT_TRUNCATED.to_string())
        } else {
            None
        },
    }
}

/// Loads the stdio evidence for every step label in `run.json`'s `steps`
/// array, first-seen label order with the newest record winning per label —
/// the same overwrite order the fork's `readMentuRunEvidence` uses for
/// `outputs[label]`. `Ok(None)` means the run directory or its record does
/// not exist yet (a run that just started), distinct from a read/parse
/// failure, which propagates as `Err`. Steps carrying neither `output_file`
/// nor `error_file` contribute no entry; a stream whose key is absent reads
/// as an empty, unresolvable reference.
pub fn read_run_evidence(
    workspace_root: &Path,
    mentu_run_id: &str,
) -> Result<Option<Vec<MentuStepEvidence>>, RpcError> {
    let run_dir = match run_dir(workspace_root, mentu_run_id)?.canonicalize() {
        Ok(dir) => dir,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(error::io_error(e.to_string())),
    };
    let Some(run_json) = read_run_json(workspace_root, mentu_run_id)? else {
        return Ok(None);
    };
    let Some(steps) = run_json.get("steps").and_then(Value::as_array) else {
        return Ok(Some(Vec::new()));
    };
    let mut order: Vec<String> = Vec::new();
    let mut by_label: std::collections::HashMap<String, MentuStepEvidence> =
        std::collections::HashMap::new();
    for step in steps {
        let Some(label) = step.get("label").and_then(Value::as_str) else {
            continue;
        };
        let output_file = step.get("output_file").and_then(Value::as_str);
        let error_file = step.get("error_file").and_then(Value::as_str);
        if output_file.is_none() && error_file.is_none() {
            continue;
        }
        if !by_label.contains_key(label) {
            order.push(label.to_string());
        }
        by_label.insert(
            label.to_string(),
            MentuStepEvidence {
                label: label.to_string(),
                stdout: read_evidence_output(&run_dir, output_file.unwrap_or("")),
                stderr: read_evidence_output(&run_dir, error_file.unwrap_or("")),
            },
        );
    }
    Ok(Some(
        order
            .into_iter()
            .filter_map(|label| by_label.remove(&label))
            .collect(),
    ))
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
    fn a_verify_failed_step_is_failed_despite_a_zero_exit_code() {
        let mut run_json = sample_run_json();
        run_json["outcome"] = json!("failed");
        run_json["steps"][0]["outcome"] = json!("failed");
        let steps = parse_steps(&run_json, "run_20260907202509_15F1772D");
        assert_eq!(steps[0].status, MentuRunStatus::Failed);
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
    fn verification_results_come_from_the_record_or_stay_unrecorded() {
        // Mirrors the real `mentu-recipes` 0.4.0 record shape: `verification`
        // issues are `{kind, message}` objects, warnings are plain strings.
        let mut run_json = sample_run_json();
        run_json["steps"][0]["verification"] = json!({
            "errors": [{"kind": "command", "message": "Verification command failed: test -f out.txt\n"}],
            "warnings": ["boundary drift is advisory"]
        });
        let steps = parse_steps(&run_json, "run_20260907202509_15F1772D");
        let verification = steps[0].verification.as_ref().unwrap();
        assert_eq!(
            verification.errors,
            vec!["Verification command failed: test -f out.txt\n".to_string()]
        );
        assert_eq!(
            verification.warnings,
            vec!["boundary drift is advisory".to_string()]
        );

        // No `verification` object: None, never a clean bill.
        let bare = parse_steps(&sample_run_json(), "run_20260907202509_15F1772D");
        assert!(bare[0].verification.is_none());
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

    fn evidence_workspace() -> tempfile::TempDir {
        let workspace = tempfile::tempdir().unwrap();
        let run_dir = workspace
            .path()
            .join(".mentu")
            .join("runs")
            .join("run_evidence1");
        fs::create_dir_all(&run_dir).unwrap();
        fs::write(run_dir.join("step.stdout"), "hello stdout\n").unwrap();
        fs::write(run_dir.join("step.stderr"), "boom\n").unwrap();
        workspace
    }

    #[test]
    fn evidence_output_reads_streams_with_fork_error_reasons() {
        let workspace = evidence_workspace();
        let run_dir = workspace
            .path()
            .join(".mentu")
            .join("runs")
            .join("run_evidence1")
            .canonicalize()
            .unwrap();
        let stdout = read_evidence_output(&run_dir, "step.stdout");
        assert_eq!(stdout.reference, "step.stdout");
        assert_eq!(stdout.content.as_deref(), Some("hello stdout\n"));
        assert!(stdout.error.is_none());
        assert!(
            stdout
                .path
                .as_deref()
                .is_some_and(|p| p.ends_with("step.stdout"))
        );
        // A missing stream is unresolvable, like the fork's failed realpath.
        let missing = read_evidence_output(&run_dir, "absent.stdout");
        assert_eq!(missing.content, None);
        assert_eq!(
            missing.error.as_deref(),
            Some(MENTU_EVIDENCE_OUTSIDE_RUN_DIR)
        );
        // Absolute, empty and escaping references never touch the filesystem.
        for bad in ["", "/etc/hostname", "../escape", "sub/../../escape"] {
            let refused = read_evidence_output(&run_dir, bad);
            assert_eq!(refused.content, None);
            assert_eq!(
                refused.error.as_deref(),
                Some(MENTU_EVIDENCE_OUTSIDE_RUN_DIR),
                "reference {bad:?} must be refused"
            );
        }
    }

    #[test]
    fn evidence_output_truncates_at_the_fork_cap_and_keeps_the_head() {
        let workspace = evidence_workspace();
        let run_dir = workspace
            .path()
            .join(".mentu")
            .join("runs")
            .join("run_evidence1")
            .canonicalize()
            .unwrap();
        let big = "x".repeat(MAX_MENTU_EVIDENCE_BYTES + 1024);
        fs::write(run_dir.join("big.stdout"), &big).unwrap();
        let output = read_evidence_output(&run_dir, "big.stdout");
        assert_eq!(
            output.error.as_deref(),
            Some(MENTU_EVIDENCE_CONTENT_TRUNCATED)
        );
        let content = output.content.unwrap();
        assert_eq!(content.len(), MAX_MENTU_EVIDENCE_BYTES);
        assert!(big.starts_with(&content));
        // Exactly at the cap: no truncation flag.
        let exact = "y".repeat(MAX_MENTU_EVIDENCE_BYTES);
        fs::write(run_dir.join("exact.stdout"), &exact).unwrap();
        let output = read_evidence_output(&run_dir, "exact.stdout");
        assert!(output.error.is_none());
        assert_eq!(output.content.as_deref(), Some(exact.as_str()));
    }

    #[test]
    fn evidence_output_refuses_a_symlink_escaping_the_run_dir() {
        let workspace = evidence_workspace();
        let run_dir = workspace
            .path()
            .join(".mentu")
            .join("runs")
            .join("run_evidence1")
            .canonicalize()
            .unwrap();
        let outside = workspace.path().join("secret.txt");
        fs::write(&outside, "secret").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, run_dir.join("link.stdout")).unwrap();
        let output = read_evidence_output(&run_dir, "link.stdout");
        assert_eq!(output.content, None);
        assert_eq!(
            output.error.as_deref(),
            Some(MENTU_EVIDENCE_OUTSIDE_RUN_DIR)
        );
    }

    #[test]
    fn run_evidence_loads_every_step_label_with_newest_attempt_winning() {
        let workspace = evidence_workspace();
        let run_dir = workspace
            .path()
            .join(".mentu")
            .join("runs")
            .join("run_evidence1");
        fs::write(
            run_dir.join("run.json"),
            json!({
                "run_id": "run_evidence1",
                "recipe_name": "demo",
                "started_at": "2026-01-01T00:00:00Z",
                "outcome": "ok",
                "steps": [
                    {"label": "step", "backend": "shell", "exit_code": 1,
                     "output_file": "step.stdout", "error_file": "step.stderr"},
                    {"label": "step", "backend": "shell", "exit_code": 0,
                     "output_file": "step.stdout", "error_file": "step.stderr"},
                    {"label": "quiet", "backend": "shell", "exit_code": 0},
                ],
            })
            .to_string(),
        )
        .unwrap();
        let evidence = read_run_evidence(workspace.path(), "run_evidence1")
            .unwrap()
            .unwrap();
        // `quiet` carries no file keys and contributes no entry; the
        // repeated `step` label collapses to one entry (newest wins, same
        // files here so the content is the shared head).
        assert_eq!(evidence.len(), 1);
        assert_eq!(evidence[0].label, "step");
        assert_eq!(
            evidence[0].stdout.content.as_deref(),
            Some("hello stdout\n")
        );
        assert_eq!(evidence[0].stderr.content.as_deref(), Some("boom\n"));
    }

    #[test]
    fn run_evidence_is_absent_before_the_record_exists() {
        let workspace = tempfile::tempdir().unwrap();
        // No `.mentu/runs` at all: a run that just started.
        assert!(
            read_run_evidence(workspace.path(), "run_nothing")
                .unwrap()
                .is_none()
        );
    }
}
