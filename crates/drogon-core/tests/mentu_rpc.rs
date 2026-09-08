//! Mentu RPCs (journey J9) through the public `Engine` API: recipes,
//! recipe detail, approval bound to recipe content, run/run_status/retry/
//! cancel through a fixture `mentu-recipes` script that emits the same
//! run-record shapes the real runtime (and the fork before it) produces,
//! and the fail-closed lock verification path. The fixture is placed at
//! each fixture's own isolated data directory
//! (`<data-dir>/mentu/runtime/bin/mentu-recipes`) — never `PATH` — and the
//! expected lock sha256 is pointed at the fixture's own bytes through
//! `mentu::runtime::set_expected_sha256_override`, mirroring
//! `tasks_rpc::set_gh_bin_override`'s test-seam precedent. Every test holds
//! one file-wide serial lock while its override is installed, so parallel
//! tests in this binary cannot observe each other's fixture hash.
#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use drogon_core::Engine;
use drogon_core::mentu::runtime;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

static SERIAL: Mutex<()> = Mutex::new(());

struct RuntimeOverride {
    _lock: MutexGuard<'static, ()>,
}

impl RuntimeOverride {
    fn set(expected_sha256: Option<String>) -> Self {
        let lock = SERIAL.lock().unwrap();
        runtime::set_expected_sha256_override(expected_sha256);
        Self { _lock: lock }
    }
}

impl Drop for RuntimeOverride {
    fn drop(&mut self) {
        runtime::set_expected_sha256_override(None);
    }
}

fn call(engine: &Engine, method: &str, params: Value) -> Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        auth: None,
        method: method.into(),
        params,
    })
}

fn ok(engine: &Engine, method: &str, params: Value) -> Value {
    let response = call(engine, method, params);
    assert!(
        response.ok,
        "expected ok for {method}: {:?}",
        response.error
    );
    response.result.unwrap()
}

fn err_code(engine: &Engine, method: &str, params: Value) -> String {
    let response = call(engine, method, params);
    assert!(
        !response.ok,
        "expected error for {method}, got {:?}",
        response.result
    );
    response.error.unwrap().code
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// A fixture `mentu-recipes` that emits the same run-record shape
/// (`run.json` with `run_id`/`outcome`/`steps[].{label,backend,exit_code,
/// output_file,error_file}`) real `mentu-recipes` writes, keyed off the
/// recipe's own file stem: `success`/`failure` run instantly with that
/// outcome, `slow` sleeps long enough for a cancel test to observe it
/// running. `resume <run-id>` always overwrites that run's record with a
/// successful retry attempt, mirroring `mentu-recipes resume`'s "rerun the
/// steps that did not succeed" contract.
const FIXTURE_SCRIPT: &str = r#"#!/bin/sh
set -e
cmd="$1"
if [ "$cmd" = "--version" ]; then
  echo "mentu-recipes-fixture 0.4.0"
  exit 0
fi
if [ "$cmd" = "run" ]; then
  recipe_path="$2"
  shift 2
  workspace=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --workspace) workspace="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  name=$(basename "$recipe_path" .json)
  run_id="run_fixture_$$_$(date +%s)"
  run_dir="$workspace/.mentu/runs/$run_id"
  mkdir -p "$run_dir"
  if [ "$name" = "slow" ]; then
    sleep 30
  fi
  if [ "$name" = "failure" ]; then
    outcome="failed"; exit_code=1
  else
    outcome="ok"; exit_code=0
  fi
  printf 'fixture stdout for %s\n' "$name" > "$run_dir/fixture-step.stdout"
  printf '' > "$run_dir/fixture-step.stderr"
  cat > "$run_dir/run.json" <<EOF
{"run_id":"$run_id","recipe_name":"$name","started_at":"2026-01-01T00:00:00Z","ended_at":"2026-01-01T00:00:05Z","outcome":"$outcome","cloud_mode":"local-only","steps":[{"label":"fixture-step","backend":"shell","exit_code":$exit_code,"duration_seconds":1,"attempts":1,"local_complete":true,"output_file":"fixture-step.stdout","error_file":"fixture-step.stderr"}],"hooks":[]}
EOF
  echo "Run record: $run_dir/run.json"
  exit "$exit_code"
elif [ "$cmd" = "resume" ]; then
  run_id="$2"
  shift 2
  workspace=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --workspace) workspace="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  run_dir="$workspace/.mentu/runs/$run_id"
  printf 'fixture retried stdout\n' > "$run_dir/fixture-step.stdout"
  printf '' > "$run_dir/fixture-step.stderr"
  cat > "$run_dir/run.json" <<EOF
{"run_id":"$run_id","recipe_name":"retried","started_at":"2026-01-01T00:00:00Z","ended_at":"2026-01-01T00:00:06Z","outcome":"ok","cloud_mode":"local-only","steps":[{"label":"fixture-step","backend":"shell","exit_code":0,"duration_seconds":1,"attempts":2,"local_complete":true,"output_file":"fixture-step.stdout","error_file":"fixture-step.stderr"}],"hooks":[]}
EOF
  echo "Run record: $run_dir/run.json"
  exit 0
else
  echo "mentu-recipes-fixture: unknown command $cmd" >&2
  exit 2
fi
"#;

fn recipe_json(name: &str) -> String {
    format!(
        r#"{{"name":"{name}","description":"fixture recipe","steps":[{{"label":"fixture-step","backend":"shell","prompt":"printf '{name}\\n'","timeout":30}}]}}"#
    )
}

struct Fixture {
    _root: tempfile::TempDir,
    _override: RuntimeOverride,
    engine: Engine,
    workspace_path: PathBuf,
    workspace_id: String,
}

impl Fixture {
    /// Installs the fixture runtime and points the expected lock sha256 at
    /// its own bytes, so `mentu.run`/`mentu.retry` verify successfully
    /// against it.
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let data_dir = root.path().join("data");
        let bin_dir = data_dir.join("mentu").join("runtime").join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let bin_path = bin_dir.join("mentu-recipes");
        fs::write(&bin_path, FIXTURE_SCRIPT).unwrap();
        fs::set_permissions(&bin_path, fs::Permissions::from_mode(0o755)).unwrap();
        let fixture_sha256 = sha256_hex(FIXTURE_SCRIPT.as_bytes());
        let _override = RuntimeOverride::set(Some(fixture_sha256));

        let engine = Engine::open(&data_dir).unwrap();
        let workspace_dir = root.path().join("workspace");
        fs::create_dir_all(workspace_dir.join(".mentu").join("recipes")).unwrap();
        let registered = ok(
            &engine,
            "workspace.register",
            json!({"path": workspace_dir.to_str().unwrap()}),
        );
        let workspace_id = registered["id"].as_str().unwrap().to_string();
        let workspace_path = fs::canonicalize(&workspace_dir).unwrap();
        Fixture {
            _root: root,
            _override,
            engine,
            workspace_path,
            workspace_id,
        }
    }

    /// Fixture with NO lock override installed, so the real
    /// `MENTU_LOCK_SHA256` constant is checked against this fixture's own
    /// (necessarily different) bytes — the fail-closed lock-mismatch path.
    fn new_without_override() -> Self {
        let root = tempfile::tempdir().unwrap();
        let data_dir = root.path().join("data");
        let bin_dir = data_dir.join("mentu").join("runtime").join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let bin_path = bin_dir.join("mentu-recipes");
        fs::write(&bin_path, FIXTURE_SCRIPT).unwrap();
        fs::set_permissions(&bin_path, fs::Permissions::from_mode(0o755)).unwrap();
        let _override = RuntimeOverride::set(None);

        let engine = Engine::open(&data_dir).unwrap();
        let workspace_dir = root.path().join("workspace");
        fs::create_dir_all(workspace_dir.join(".mentu").join("recipes")).unwrap();
        let registered = ok(
            &engine,
            "workspace.register",
            json!({"path": workspace_dir.to_str().unwrap()}),
        );
        let workspace_id = registered["id"].as_str().unwrap().to_string();
        let workspace_path = fs::canonicalize(&workspace_dir).unwrap();
        Fixture {
            _root: root,
            _override,
            engine,
            workspace_path,
            workspace_id,
        }
    }

    fn write_recipe(&self, name: &str) {
        let path = self
            .workspace_path
            .join(".mentu")
            .join("recipes")
            .join(format!("{name}.json"));
        fs::write(path, recipe_json(name)).unwrap();
    }

    fn recipe_detail(&self, name: &str) -> Value {
        ok(
            &self.engine,
            "mentu.recipe",
            json!({"workspaceId": self.workspace_id, "recipeId": name}),
        )["recipe"]
            .clone()
    }

    fn approve(&self, name: &str) -> String {
        let detail = self.recipe_detail(name);
        let approved = ok(
            &self.engine,
            "mentu.approve",
            json!({
                "workspaceId": self.workspace_id,
                "recipeId": name,
                "contentHash": detail["contentHash"],
            }),
        );
        approved["approval"]["id"].as_str().unwrap().to_string()
    }

    fn run(&self, name: &str, approval_id: &str) -> Value {
        ok(
            &self.engine,
            "mentu.run",
            json!({
                "workspaceId": self.workspace_id,
                "recipeId": name,
                "approvalId": approval_id,
            }),
        )["run"]
            .clone()
    }

    fn wait_for_completion(&self, run_id: &str) -> Value {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let run = ok(&self.engine, "mentu.run_status", json!({"runId": run_id}))["run"].clone();
            if run["status"] != "running" {
                return run;
            }
            assert!(
                Instant::now() < deadline,
                "run {run_id} did not finish in time: {run:?}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

#[test]
fn recipes_lists_valid_and_invalid_entries_without_hiding_either() {
    let fx = Fixture::new();
    fx.write_recipe("success");
    fs::write(
        fx.workspace_path
            .join(".mentu")
            .join("recipes")
            .join("broken.json"),
        "{not json",
    )
    .unwrap();
    let listed = ok(
        &fx.engine,
        "mentu.recipes",
        json!({"workspaceId": fx.workspace_id}),
    );
    let recipes = listed["recipes"].as_array().unwrap();
    assert_eq!(recipes.len(), 2);
    let success = recipes.iter().find(|r| r["id"] == "success").unwrap();
    assert_eq!(success["valid"], true);
    let broken = recipes.iter().find(|r| r["id"] == "broken").unwrap();
    assert_eq!(broken["valid"], false);
    assert!(broken["issue"].is_string());
}

#[test]
fn recipe_returns_steps_a_draft_source_and_a_stable_content_hash() {
    let fx = Fixture::new();
    fx.write_recipe("success");
    let detail = fx.recipe_detail("success");
    assert_eq!(detail["name"], "success");
    assert_eq!(detail["steps"][0]["label"], "fixture-step");
    assert_eq!(detail["steps"][0]["backend"], "shell");
    assert!(detail["source"].as_str().unwrap().contains("\"steps\""));
    assert_eq!(detail["contentHash"].as_str().unwrap().len(), 64);
}

#[test]
fn runtime_reports_availability_and_the_lock_digest() {
    let fx = Fixture::new();
    let runtime_info = ok(&fx.engine, "mentu.runtime", json!({}))["runtime"].clone();
    assert_eq!(runtime_info["available"], true);
    assert_eq!(runtime_info["lockMatches"], true);
}

#[test]
fn lock_mismatch_is_reported_and_run_refuses_to_start() {
    let fx = Fixture::new_without_override();
    let runtime_info = ok(&fx.engine, "mentu.runtime", json!({}))["runtime"].clone();
    assert_eq!(runtime_info["available"], false);
    assert_eq!(runtime_info["lockMatches"], false);

    fx.write_recipe("success");
    let approval_id = fx.approve("success");
    let code = err_code(
        &fx.engine,
        "mentu.run",
        json!({
            "workspaceId": fx.workspace_id,
            "recipeId": "success",
            "approvalId": approval_id,
        }),
    );
    assert_eq!(code, "mentu_runtime_unavailable");
}

#[test]
fn approval_is_bound_to_content_and_can_only_be_used_once() {
    let fx = Fixture::new();
    fx.write_recipe("success");
    let detail = fx.recipe_detail("success");

    let stale = err_code(
        &fx.engine,
        "mentu.approve",
        json!({
            "workspaceId": fx.workspace_id,
            "recipeId": "success",
            "contentHash": "a".repeat(64),
        }),
    );
    assert_eq!(stale, "invalid_argument");

    let approval_id = fx.approve("success");
    let _ = fx.run("success", &approval_id);

    let reused = err_code(
        &fx.engine,
        "mentu.run",
        json!({
            "workspaceId": fx.workspace_id,
            "recipeId": "success",
            "approvalId": approval_id,
        }),
    );
    assert_eq!(reused, "mentu_approval_consumed");
    let _ = detail; // keep for clarity that content_hash came from this load
}

#[test]
fn run_executes_through_the_pinned_runtime_and_records_success() {
    let fx = Fixture::new();
    fx.write_recipe("success");
    let approval_id = fx.approve("success");
    let started = fx.run("success", &approval_id);
    assert_eq!(started["status"], "running");
    let run_id = started["id"].as_str().unwrap().to_string();

    let finished = fx.wait_for_completion(&run_id);
    assert_eq!(finished["status"], "succeeded");
    assert!(finished["mentuRunId"].as_str().unwrap().starts_with("run_"));
    let steps = finished["steps"].as_array().unwrap();
    assert_eq!(steps.len(), 1);
    assert_eq!(steps[0]["status"], "succeeded");
    let output_path = steps[0]["outputPath"].as_str().unwrap();
    assert!(output_path.starts_with(".mentu/runs/"));
    let evidence = fs::read_to_string(fx.workspace_path.join(output_path)).unwrap();
    assert!(evidence.contains("fixture stdout for success"));
}

#[test]
fn run_records_failure_honestly_with_a_step_error() {
    let fx = Fixture::new();
    fx.write_recipe("failure");
    let approval_id = fx.approve("failure");
    let started = fx.run("failure", &approval_id);
    let run_id = started["id"].as_str().unwrap().to_string();

    let finished = fx.wait_for_completion(&run_id);
    assert_eq!(finished["status"], "failed");
    assert!(finished["error"].is_string());
    assert_eq!(finished["steps"][0]["status"], "failed");
    assert_eq!(finished["steps"][0]["exitCode"], 1);
}

#[test]
fn retry_preserves_the_prior_mentu_run_id_and_can_turn_a_failure_into_a_success() {
    let fx = Fixture::new();
    fx.write_recipe("failure");
    let approval_id = fx.approve("failure");
    let started = fx.run("failure", &approval_id);
    let run_id = started["id"].as_str().unwrap().to_string();
    let first = fx.wait_for_completion(&run_id);
    assert_eq!(first["status"], "failed");
    let mentu_run_id = first["mentuRunId"].as_str().unwrap().to_string();

    let retried = ok(&fx.engine, "mentu.retry", json!({"runId": run_id}))["run"].clone();
    assert_eq!(retried["retryOf"], run_id);
    let retried_id = retried["id"].as_str().unwrap().to_string();
    assert_ne!(retried_id, run_id);

    let finished = fx.wait_for_completion(&retried_id);
    assert_eq!(finished["status"], "succeeded");
    assert_eq!(finished["mentuRunId"], mentu_run_id);
    assert_eq!(finished["steps"][0]["attempts"], 2);
}

#[test]
fn cancel_stops_a_running_recipe_and_the_status_lands_as_cancelled() {
    let fx = Fixture::new();
    fx.write_recipe("slow");
    let approval_id = fx.approve("slow");
    let started = fx.run("slow", &approval_id);
    let run_id = started["id"].as_str().unwrap().to_string();
    assert_eq!(started["status"], "running");

    std::thread::sleep(Duration::from_millis(200));
    let cancelled = ok(&fx.engine, "mentu.cancel", json!({"runId": run_id}))["run"].clone();
    let _ = cancelled;

    let finished = fx.wait_for_completion(&run_id);
    assert_eq!(finished["status"], "cancelled");
}

#[test]
fn recipe_save_round_trips_a_step_edit_and_returns_the_new_hash() {
    let fx = Fixture::new();
    fx.write_recipe("success");
    let before = fx.recipe_detail("success");
    let before_hash = before["contentHash"].as_str().unwrap().to_string();

    let edited = recipe_json("success").replace("30", "60");
    assert_ne!(edited, recipe_json("success"));
    let saved = ok(
        &fx.engine,
        "mentu.recipe_save",
        json!({
            "workspaceId": fx.workspace_id,
            "recipeId": "success",
            "content": edited,
        }),
    )["recipe"]
        .clone();
    assert_eq!(saved["name"], "success");
    assert_eq!(saved["source"], edited);
    assert_ne!(saved["contentHash"], before_hash);
    assert_eq!(saved["contentHash"].as_str().unwrap().len(), 64);
    // The catalog still lists the recipe as valid under the new bytes.
    let after = fx.recipe_detail("success");
    assert_eq!(after, saved);
}

#[test]
fn recipe_save_refuses_invalid_recipes_and_traversal() {
    let fx = Fixture::new();
    fx.write_recipe("success");
    let before = fx.recipe_detail("success");

    for bad in [
        "{not json",
        r#"{"steps": [{"label": "a"}]}"#,
        r#"{"name": "success"}"#,
        r#"{"name": "success", "steps": [{"backend": "shell"}]}"#,
        "",
    ] {
        let code = err_code(
            &fx.engine,
            "mentu.recipe_save",
            json!({
                "workspaceId": fx.workspace_id,
                "recipeId": "success",
                "content": bad,
            }),
        );
        assert_eq!(code, "invalid_argument", "content {bad:?} must be refused");
    }
    for traversal in ["../secret", "/etc/passwd", "a/../../b"] {
        let code = err_code(
            &fx.engine,
            "mentu.recipe_save",
            json!({
                "workspaceId": fx.workspace_id,
                "recipeId": traversal,
                "content": recipe_json("success"),
            }),
        );
        assert_eq!(code, "invalid_argument", "id {traversal:?} must be refused");
    }
    // Saving a recipe that does not exist is `not_found`, not a write.
    let code = err_code(
        &fx.engine,
        "mentu.recipe_save",
        json!({
            "workspaceId": fx.workspace_id,
            "recipeId": "missing",
            "content": recipe_json("missing"),
        }),
    );
    assert_eq!(code, "not_found");
    // Every refusal left the recipe untouched.
    assert_eq!(fx.recipe_detail("success"), before);
}

#[test]
fn recipe_save_invalidates_the_old_approval_and_the_new_hash_runs() {
    let fx = Fixture::new();
    fx.write_recipe("success");
    let before_hash = fx.recipe_detail("success")["contentHash"]
        .as_str()
        .unwrap()
        .to_string();
    let approval_id = fx.approve("success");

    // Edit the recipe: the pre-save approval must die with the old bytes.
    let edited = recipe_json("success").replace("30", "60");
    let saved = ok(
        &fx.engine,
        "mentu.recipe_save",
        json!({
            "workspaceId": fx.workspace_id,
            "recipeId": "success",
            "content": edited,
        }),
    )["recipe"]
        .clone();
    assert_ne!(saved["contentHash"].as_str().unwrap(), before_hash);

    let code = err_code(
        &fx.engine,
        "mentu.run",
        json!({
            "workspaceId": fx.workspace_id,
            "recipeId": "success",
            "approvalId": approval_id,
        }),
    );
    assert_eq!(
        code, "mentu_approval_consumed",
        "the pre-save approval must be invalidated, not merely hash-mismatched"
    );

    // A fresh review of the new bytes approves and runs to completion.
    let fresh_approval_id = fx.approve("success");
    assert_ne!(fresh_approval_id, approval_id);
    let started = fx.run("success", &fresh_approval_id);
    let run_id = started["id"].as_str().unwrap().to_string();
    let finished = fx.wait_for_completion(&run_id);
    assert_eq!(finished["status"], "succeeded");
}

#[test]
fn run_evidence_reads_the_finished_run_stdout_content_with_fork_shapes() {
    let fx = Fixture::new();
    fx.write_recipe("success");
    let approval_id = fx.approve("success");
    let started = fx.run("success", &approval_id);
    let run_id = started["id"].as_str().unwrap().to_string();
    let finished = fx.wait_for_completion(&run_id);
    assert_eq!(finished["status"], "succeeded");

    let result = ok(&fx.engine, "mentu.run_evidence", json!({"runId": run_id}));
    assert_eq!(result["runId"], run_id);
    assert_eq!(result["mentuRunId"], finished["mentuRunId"]);
    let evidence = result["evidence"].as_array().unwrap();
    assert_eq!(evidence.len(), 1);
    assert_eq!(evidence[0]["label"], "fixture-step");
    let stdout = &evidence[0]["stdout"];
    assert_eq!(stdout["reference"], "fixture-step.stdout");
    assert!(
        stdout["path"]
            .as_str()
            .is_some_and(|p| p.ends_with("fixture-step.stdout"))
    );
    assert!(
        stdout["content"]
            .as_str()
            .is_some_and(|c| c.contains("fixture stdout for success"))
    );
    assert!(stdout.get("error").is_none());
    // The fixture writes an empty stderr: captured, present, empty.
    let stderr = &evidence[0]["stderr"];
    assert_eq!(stderr["reference"], "fixture-step.stderr");
    assert_eq!(stderr["content"], "");
    assert!(stderr.get("error").is_none());
}

#[test]
fn run_evidence_reports_a_failed_run_step_error_and_refuses_unknown_runs() {
    let fx = Fixture::new();
    fx.write_recipe("failure");
    let approval_id = fx.approve("failure");
    let started = fx.run("failure", &approval_id);
    let run_id = started["id"].as_str().unwrap().to_string();
    let finished = fx.wait_for_completion(&run_id);
    assert_eq!(finished["status"], "failed");

    let result = ok(&fx.engine, "mentu.run_evidence", json!({"runId": run_id}));
    let evidence = result["evidence"].as_array().unwrap();
    assert_eq!(evidence.len(), 1);
    assert!(
        evidence[0]["stdout"]["content"]
            .as_str()
            .is_some_and(|c| c.contains("fixture stdout for failure"))
    );

    assert_eq!(
        err_code(
            &fx.engine,
            "mentu.run_evidence",
            json!({"runId": "no-such-run"}),
        ),
        "not_found"
    );
    assert_eq!(
        err_code(&fx.engine, "mentu.run_evidence", json!({"runId": ""})),
        "invalid_argument"
    );
}
