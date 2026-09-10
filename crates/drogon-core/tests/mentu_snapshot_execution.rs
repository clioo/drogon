//! C03 snapshot execution through the real `Engine` dispatch (journey J9):
//! proves the pinned runtime is actually invoked with the immutable
//! approved bytes — argv, snapshot content, manifest — using a
//! deterministic argv-logging fixture. No model inference anywhere.
//!
//! Exact protected lifecycle review (per-task requirement; mirrors the
//! established `mentu_rpc.rs` fixture precedent, narrowed further):
//! - Fixture: a POSIX `sh` script at this test's own temp data-dir fixed
//!   runtime path (`<data>/mentu/runtime/bin/mentu-recipes`, never `PATH`).
//!   It appends its full argv (NUL-separated, spaces/Unicode-safe) to
//!   `<workspace>/.mentu/last-argv.log`, writes one instant successful
//!   `run.json`, and exits 0. No sleeps, no network, no cancel path — the
//!   child always exits on its own in milliseconds.
//! - Daemon side: `Engine::open` is in-process (SQLite file in the temp
//!   root, no socket/daemon/Electron). `launch_run` spawns the fixture in
//!   its own process group with piped stdio drained on threads; the
//!   detached watcher thread reaps it and writes the final row, then the
//!   test observes `mentu.run_status` with a 10 s bound. Instant fixture
//!   means no orphan is possible on assertion failure (the child is
//!   already reaped); the `TempDir` drop removes data/workspace dirs.
//! - Lock seam: `mentu::runtime::set_expected_sha256_override` is pointed
//!   at the fixture's own bytes under a file-local serial lock (this file
//!   is its own test binary/process, so no other suite observes it).
//! - Refusal cases assert no spawn happened at all (no snapshot dir, no
//!   argv log) — nothing to clean up beyond the temp dirs.
//! - Unix-only: the fixture is a shell script (`#![cfg(unix)]`, same as
//!   `mentu_rpc.rs`).
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

/// Argv-logging fixture: records its exact argv, then reports one instant
/// successful shell step. `name` keys off the recipe file stem exactly
/// like the `mentu_rpc.rs` fixture, so snapshot file names stay meaningful.
const FIXTURE_SCRIPT: &str = r#"#!/bin/sh
set -e
cmd="$1"
if [ "$cmd" = "--version" ]; then
  echo "mentu-recipes-fixture 0.5.0"
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
  printf '%s\0' "$cmd" "$recipe_path" "--workspace" "$workspace" > "$workspace/.mentu/last-argv.log"
  name=$(basename "$recipe_path" .json)
  run_id="run_fixture_$$_$(date +%s)"
  run_dir="$workspace/.mentu/runs/$run_id"
  mkdir -p "$run_dir"
  printf 'fixture stdout for %s\n' "$name" > "$run_dir/fixture-step.stdout"
  printf '' > "$run_dir/fixture-step.stderr"
  cat > "$run_dir/run.json" <<EOF
{"run_id":"$run_id","recipe_name":"$name","started_at":"2026-01-01T00:00:00Z","ended_at":"2026-01-01T00:00:05Z","outcome":"ok","cloud_mode":"local-only","steps":[{"label":"fixture-step","backend":"shell","exit_code":0,"duration_seconds":1,"attempts":1,"local_complete":true,"output_file":"fixture-step.stdout","error_file":"fixture-step.stderr"}],"hooks":[]}
EOF
  echo "Run record: $run_dir/run.json"
  exit 0
else
  echo "mentu-recipes-fixture: unknown command $cmd" >&2
  exit 2
fi
"#;

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

struct Fixture {
    _root: tempfile::TempDir,
    _override: RuntimeOverride,
    engine: Engine,
    workspace_path: PathBuf,
    workspace_id: String,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let data_dir = root.path().join("data");
        let bin_dir = data_dir.join("mentu").join("runtime").join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        let bin_path = bin_dir.join("mentu-recipes");
        fs::write(&bin_path, FIXTURE_SCRIPT).unwrap();
        fs::set_permissions(&bin_path, fs::Permissions::from_mode(0o755)).unwrap();
        let _override = RuntimeOverride::set(Some(sha256_hex(FIXTURE_SCRIPT.as_bytes())));

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

    fn write_recipe(&self, name: &str, contents: &str) {
        fs::write(
            self.workspace_path
                .join(".mentu")
                .join("recipes")
                .join(format!("{name}.json")),
            contents,
        )
        .unwrap();
    }

    fn approve(&self, name: &str) -> (String, String) {
        let detail = ok(
            &self.engine,
            "mentu.recipe",
            json!({"workspaceId": self.workspace_id, "recipeId": name}),
        )["recipe"]
            .clone();
        let hash = detail["contentHash"].as_str().unwrap().to_string();
        let source = detail["source"].as_str().unwrap().to_string();
        let approval_id = ok(
            &self.engine,
            "mentu.approve",
            json!({
                "workspaceId": self.workspace_id,
                "recipeId": name,
                "contentHash": hash,
            }),
        )["approval"]["id"]
            .as_str()
            .unwrap()
            .to_string();
        (approval_id, source)
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

    fn read_argv(&self) -> Vec<String> {
        let raw = fs::read(self.workspace_path.join(".mentu").join("last-argv.log")).unwrap();
        raw.split(|b| *b == 0)
            .filter(|s| !s.is_empty())
            .map(|s| String::from_utf8(s.to_vec()).unwrap())
            .collect()
    }
}

const SHELL_RECIPE: &str = r#"{"name":"snapshot-proof","description":"argv fixture","steps":[{"label":"fixture-step","backend":"shell","prompt":"printf 'hi\n'","timeout":30}]}"#;

/// The runtime is invoked with the immutable snapshot — argv, loaded
/// bytes, manifest and cwd all name the approved content, never the live
/// recipe path.
#[test]
fn run_invokes_the_pinned_runtime_with_the_approved_snapshot() {
    let fx = Fixture::new();
    fx.write_recipe("snap", SHELL_RECIPE);
    let (approval_id, approved_source) = fx.approve("snap");

    let run = ok(
        &fx.engine,
        "mentu.run",
        json!({
            "workspaceId": fx.workspace_id,
            "recipeId": "snap",
            "approvalId": approval_id,
        }),
    )["run"]
        .clone();
    let run_id = run["id"].as_str().unwrap().to_string();
    let finished = fx.wait_for_completion(&run_id);
    assert_eq!(finished["status"], "succeeded");

    // Exact argv: `run <snapshot recipe> --workspace <root>`.
    let argv = fx.read_argv();
    assert_eq!(argv.len(), 4, "fixture argv: {argv:?}");
    assert_eq!(argv[0], "run");
    let snapshot_path = PathBuf::from(&argv[1]);
    let expected_dir = fx
        .workspace_path
        .join(".mentu")
        .join("snapshots")
        .join(&run_id);
    assert_eq!(snapshot_path.parent().unwrap(), expected_dir);
    assert_eq!(
        snapshot_path.file_name().unwrap().to_str().unwrap(),
        "snap.json",
        "the snapshot keeps the recipe file name"
    );
    assert_eq!(argv[2], "--workspace");
    assert_eq!(PathBuf::from(&argv[3]), fx.workspace_path);

    // The loaded execution content is the approved bytes, byte for byte.
    assert_eq!(fs::read_to_string(&snapshot_path).unwrap(), approved_source);

    // The manifest records selection, exact argv, pinned runtime and cwd.
    let manifest: Value =
        serde_json::from_str(&fs::read_to_string(expected_dir.join("manifest.json")).unwrap())
            .unwrap();
    assert_eq!(
        manifest["contentHash"],
        json!(sha256_hex(approved_source.as_bytes()))
    );
    assert_eq!(
        manifest["runtime"],
        json!({"version": "0.5.0", "revision": "c82ccfa0ebbe77d62193e068821ba6e74f87a8d3"})
    );
    assert_eq!(
        manifest["cwd"],
        Value::String(fx.workspace_path.to_string_lossy().into_owned())
    );
    let manifest_argv = manifest["argv"].as_array().unwrap();
    assert_eq!(manifest_argv[1], json!("run"));
    assert_eq!(
        manifest_argv[2].as_str().unwrap(),
        snapshot_path.to_string_lossy()
    );
    // Shell-only recipe: no agent selections, no resources — recorded as
    // empty, never invented.
    assert_eq!(manifest["steps"], json!([]));
    assert_eq!(manifest["resources"], json!([]));
}

/// Approve A, edit the file to B before launch: the launch refuses with
/// re-approval — no spawn, no snapshot, no argv log.
#[test]
fn edited_recipe_after_approval_refuses_without_spawning() {
    let fx = Fixture::new();
    fx.write_recipe("snap", SHELL_RECIPE);
    let (approval_id, _) = fx.approve("snap");
    fx.write_recipe("snap", &SHELL_RECIPE.replace("snapshot-proof", "version B"));

    let code = err_code(
        &fx.engine,
        "mentu.run",
        json!({
            "workspaceId": fx.workspace_id,
            "recipeId": "snap",
            "approvalId": approval_id,
        }),
    );
    assert_eq!(code, "invalid_argument");
    assert!(
        !fx.workspace_path.join(".mentu").join("snapshots").exists(),
        "a refused launch stages no snapshot bytes"
    );
    assert!(
        !fx.workspace_path
            .join(".mentu")
            .join("last-argv.log")
            .exists(),
        "a refused launch spawns nothing"
    );
}

/// An unsupported agent backend refuses with the exact combination and
/// its evidence — no inference, no spawn, no snapshot.
#[test]
fn unsupported_agent_backend_refuses_without_inference() {
    let fx = Fixture::new();
    fx.write_recipe(
        "bad",
        r#"{"name":"bad","steps":[{"label":"a","backend":"opencode","prompt":"hi"}]}"#,
    );
    let (approval_id, _) = fx.approve("bad");
    let response = call(
        &fx.engine,
        "mentu.run",
        json!({
            "workspaceId": fx.workspace_id,
            "recipeId": "bad",
            "approvalId": approval_id,
        }),
    );
    assert!(!response.ok);
    let error = response.error.unwrap();
    assert_eq!(error.code, "mentu_backend_unsupported");
    assert!(error.message.contains("opencode"), "{}", error.message);
    assert!(
        !fx.workspace_path.join(".mentu").join("snapshots").exists(),
        "a refused selection stages no snapshot bytes"
    );
    assert!(
        !fx.workspace_path
            .join(".mentu")
            .join("last-argv.log")
            .exists(),
        "a refused selection spawns nothing"
    );
}
