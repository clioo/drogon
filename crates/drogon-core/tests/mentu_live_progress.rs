//! Live Mentu run state: the approvals a run can be started from, and the
//! in-flight mirroring of `mentu-recipes`'s own `run.json` into the daemon's
//! run row.
//!
//! Why this is its own test binary: `runtime::set_expected_sha256_override`
//! is process-global, so each fixture here owns its own process (and its own
//! serial lock) instead of racing `mentu_rpc.rs`'s fixtures.
#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
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

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// A fixture `mentu-recipes` whose `live` recipe rewrites its `run.json`
/// exactly the way the real runtime does: an initial `running` record with
/// no steps, then one record per finished step, then the final outcome. The
/// intermediate records are what a live UI has to be able to show.
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
  name=$(basename "$recipe_path" .json)
  run_id="run_fixture_$$_$(date +%s)"
  run_dir="$workspace/.mentu/runs/$run_id"
  mkdir -p "$run_dir"
  if [ "$name" = "live" ]; then
    cat > "$run_dir/run.json" <<EOF
{"run_id":"$run_id","recipe_name":"live","started_at":"2026-01-01T00:00:00Z","ended_at":null,"outcome":"running","cloud_mode":"local-only","steps":[],"hooks":[]}
EOF
    sleep 1
    printf 'first step output\n' > "$run_dir/first.stdout"
    printf '' > "$run_dir/first.stderr"
    cat > "$run_dir/run.json" <<EOF
{"run_id":"$run_id","recipe_name":"live","started_at":"2026-01-01T00:00:00Z","ended_at":null,"outcome":"running","cloud_mode":"local-only","steps":[{"label":"first","backend":"shell","outcome":"ok","exit_code":0,"duration_seconds":1,"attempts":1,"local_complete":true,"output_file":"first.stdout","error_file":"first.stderr"}],"hooks":[]}
EOF
    sleep 3
    printf 'second step output\n' > "$run_dir/second.stdout"
    printf '' > "$run_dir/second.stderr"
    cat > "$run_dir/run.json" <<EOF
{"run_id":"$run_id","recipe_name":"live","started_at":"2026-01-01T00:00:00Z","ended_at":"2026-01-01T00:00:04Z","outcome":"ok","cloud_mode":"local-only","steps":[{"label":"first","backend":"shell","outcome":"ok","exit_code":0,"duration_seconds":1,"attempts":1,"local_complete":true,"output_file":"first.stdout","error_file":"first.stderr"},{"label":"second","backend":"shell","outcome":"ok","exit_code":0,"duration_seconds":1,"attempts":1,"local_complete":true,"output_file":"second.stdout","error_file":"second.stderr"}],"hooks":[]}
EOF
    echo "Run record: $run_dir/run.json"
    exit 0
  fi
  echo "mentu-recipes-fixture: unknown recipe $name" >&2
  exit 2
fi
echo "mentu-recipes-fixture: unknown command $cmd" >&2
exit 2
"#;

const LIVE_RECIPE: &str = r#"{"name":"live","description":"fixture recipe","steps":[{"label":"first","backend":"shell","prompt":"echo first"},{"label":"second","backend":"shell","prompt":"echo second"}]}"#;

struct Fixture {
    _root: tempfile::TempDir,
    _override: RuntimeOverride,
    engine: Engine,
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
        fs::write(
            workspace_dir
                .join(".mentu")
                .join("recipes")
                .join("live.json"),
            LIVE_RECIPE,
        )
        .unwrap();
        let registered = ok(
            &engine,
            "workspace.register",
            json!({"path": workspace_dir.to_str().unwrap()}),
        );
        let workspace_id = registered["id"].as_str().unwrap().to_string();
        Fixture {
            _root: root,
            _override,
            engine,
            workspace_id,
        }
    }

    fn recipe(&self) -> Value {
        ok(
            &self.engine,
            "mentu.recipe",
            json!({"workspaceId": self.workspace_id, "recipeId": "live"}),
        )
    }

    fn approve(&self) -> Value {
        let hash = self.recipe()["recipe"]["contentHash"]
            .as_str()
            .unwrap()
            .to_string();
        ok(
            &self.engine,
            "mentu.approve",
            json!({
                "workspaceId": self.workspace_id,
                "recipeId": "live",
                "contentHash": hash,
            }),
        )
    }

    fn run(&self) -> Value {
        let approval = self.approve();
        ok(
            &self.engine,
            "mentu.run",
            json!({
                "workspaceId": self.workspace_id,
                "recipeId": "live",
                "approvalId": approval["approval"]["id"],
            }),
        )
    }

    fn run_status(&self, run_id: &str) -> Value {
        ok(&self.engine, "mentu.run_status", json!({ "runId": run_id }))
    }
}

/// Nothing is approved until a human approves these exact bytes; resolving
/// a pending approval never fabricates one.
#[test]
fn pending_approval_is_null_until_the_exact_content_is_approved() {
    let fixture = Fixture::new();
    let before = ok(
        &fixture.engine,
        "mentu.pending_approval",
        json!({"workspaceId": fixture.workspace_id, "recipeId": "live"}),
    );
    assert_eq!(before["approval"], Value::Null);

    let approval = fixture.approve();
    let pending = ok(
        &fixture.engine,
        "mentu.pending_approval",
        json!({"workspaceId": fixture.workspace_id, "recipeId": "live"}),
    );
    assert_eq!(pending["approval"]["id"], approval["approval"]["id"]);
    assert_eq!(
        pending["approval"]["contentHash"],
        fixture.recipe()["recipe"]["contentHash"]
    );

    // Editing the recipe invalidates the approval on disk, so the lookup
    // must answer "nothing is approved" instead of handing back stale
    // consent for bytes that no longer exist.
    let edited = LIVE_RECIPE.replace("echo second", "echo second-edited");
    fs::write(
        fixture
            ._root
            .path()
            .join("workspace")
            .join(".mentu")
            .join("recipes")
            .join("live.json"),
        &edited,
    )
    .unwrap();
    let after_edit = ok(
        &fixture.engine,
        "mentu.pending_approval",
        json!({"workspaceId": fixture.workspace_id, "recipeId": "live"}),
    );
    assert_eq!(after_edit["approval"], Value::Null);
}

#[test]
fn consuming_the_pending_approval_retires_it() {
    let fixture = Fixture::new();
    let run = fixture.run();
    assert_eq!(run["run"]["status"], "running");
    let after = ok(
        &fixture.engine,
        "mentu.pending_approval",
        json!({"workspaceId": fixture.workspace_id, "recipeId": "live"}),
    );
    assert_eq!(after["approval"], Value::Null);
}

/// The point of requirement E: Evidence and Metrics must populate DURING a
/// run. While `mentu-recipes` is still alive the daemon mirrors the
/// runtime's own partial `run.json` into the run row, so a status poll
/// reports the finished step and `mentu.run_evidence` returns its captured
/// stdout — not an empty list that only fills in at exit.
#[test]
fn a_run_in_flight_reports_its_finished_steps_and_evidence() {
    let fixture = Fixture::new();
    let run = fixture.run();
    let run_id = run["run"]["id"].as_str().unwrap().to_string();

    let deadline = Instant::now() + Duration::from_secs(10);
    let mut live = None;
    while Instant::now() < deadline {
        let status = fixture.run_status(&run_id);
        let row = &status["run"];
        if row["status"] == "running"
            && row["mentuRunId"].is_string()
            && row["steps"]
                .as_array()
                .is_some_and(|steps| !steps.is_empty())
        {
            live = Some(status);
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let live = live.expect(
        "the running row must expose the runtime's mentu run id and its first finished step \
         before the process exits",
    );
    let row = &live["run"];
    assert_eq!(row["steps"][0]["label"], "first");
    assert_eq!(row["steps"][0]["status"], "succeeded");
    assert_eq!(
        row["steps"][0]["outputPath"],
        format!(
            ".mentu/runs/{}/first.stdout",
            row["mentuRunId"].as_str().unwrap()
        )
    );

    // The evidence read uses the same row, so it must answer while running.
    let evidence = ok(
        &fixture.engine,
        "mentu.run_evidence",
        json!({ "runId": run_id }),
    );
    let steps = evidence["evidence"].as_array().unwrap();
    assert!(
        steps.iter().any(|step| {
            step["label"] == "first"
                && step["stdout"]["content"]
                    .as_str()
                    .is_some_and(|text| text.contains("first step output"))
        }),
        "live evidence: {evidence}"
    );

    // And it still settles to the runtime's real terminal outcome.
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut settled = None;
    while Instant::now() < deadline {
        let status = fixture.run_status(&run_id);
        if status["run"]["status"] != "running" {
            settled = Some(status);
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let settled = settled.expect("the run must settle");
    assert_eq!(settled["run"]["status"], "succeeded");
    assert_eq!(settled["run"]["steps"].as_array().unwrap().len(), 2);
    assert_eq!(settled["run"]["endedAt"], "2026-01-01T00:00:04Z");
}
