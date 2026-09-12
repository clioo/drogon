//! End-to-end graph lifecycle against the real daemon and a deterministic
//! shell-fixture `mentu-recipes`:
//!
//!   build a small graph → write it through `graph.write_intent` → compile →
//!   run → watch `state` update while the run is live → fail one node →
//!   retry ONLY that node → resume the other one.
//!
//! The fixture stands in for the pinned runtime so no inference ever runs.
//! It writes real `run.json` records the way `mentu-recipes` does (a partial
//! record first, then the final one) and logs the exact argv it was invoked
//! with, so the daemon's `run`/`resume`/`retry-step` wiring is verified
//! behaviorally, not by inspection.
//!
//! Why its own test binary: `runtime::set_expected_sha256_override` and
//! `DROGON_MENTU_RUNTIME` are process-global, so each fixture owns its own
//! process instead of racing `mentu_live_progress.rs`.

#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
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
        let lock = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        runtime::set_expected_sha256_override(expected_sha256);
        Self { _lock: lock }
    }
}

impl Drop for RuntimeOverride {
    fn drop(&mut self) {
        runtime::set_expected_sha256_override(None);
    }
}

/// The fixture runtime. `run` writes n1 ok then n2 failed-unless-marker, with
/// a partial record and a sleep in between so the daemon's 500 ms progress
/// mirror is exercised. `resume`/`retry-step` rewrite the SAME run directory,
/// exactly as the real runtime does.
const FIXTURE_SCRIPT: &str = r#"#!/bin/sh
set -e
all="$*"
cmd="$1"
if [ "$cmd" = "--version" ]; then echo "mentu-recipes-fixture 0.5.0"; exit 0; fi
if [ "$cmd" = "check" ]; then echo "ok"; exit 0; fi
if [ "$cmd" = "doctor" ]; then printf '{"findings":[],"score":100}\n'; exit 0; fi
case "$cmd" in
  run) recipe="$2"; shift 2 ;;
  resume) mentu_run="$2"; shift 2 ;;
  retry-step) mentu_run="$2"; step="$3"; shift 3 ;;
  *) echo "fixture: unknown command $cmd" >&2; exit 2 ;;
esac
workspace=""
while [ $# -gt 0 ]; do
  case "$1" in
    --workspace) workspace="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ -z "$workspace" ]; then echo "fixture: no workspace" >&2; exit 2; fi
mkdir -p "$workspace/.mentu"
echo "$all" >> "$workspace/.mentu/argv.log"

record() {
  # $1 run_dir, $2 run_id, $3 n2 outcome, $4 n2 exit, $5 extra n2 attempts
  attempts="${5:-1}"
  cat > "$1/run.json" <<EOF
{"run_id":"$2","recipe_name":"fixture","started_at":"2026-01-01T00:00:00Z","ended_at":null,"outcome":"running","cloud_mode":"local-only","steps":[{"label":"n1","backend":"shell","outcome":"ok","exit_code":0,"duration_seconds":1,"attempts":1,"output_file":"n1.stdout","error_file":"n1.stderr"}],"hooks":[]}
EOF
  if [ "$3" = "ok" ]; then
    cat > "$1/run.json" <<EOF
{"run_id":"$2","recipe_name":"fixture","started_at":"2026-01-01T00:00:00Z","ended_at":"2026-01-01T00:00:02Z","outcome":"ok","cloud_mode":"local-only","steps":[{"label":"n1","backend":"shell","outcome":"ok","exit_code":0,"duration_seconds":1,"attempts":1,"output_file":"n1.stdout","error_file":"n1.stderr"},{"label":"n2","backend":"shell","outcome":"ok","exit_code":0,"duration_seconds":1,"attempts":$attempts,"output_file":"n2.stdout","error_file":"n2.stderr"}],"hooks":[]}
EOF
  else
    cat > "$1/run.json" <<EOF
{"run_id":"$2","recipe_name":"fixture","started_at":"2026-01-01T00:00:00Z","ended_at":"2026-01-01T00:00:02Z","outcome":"failed","cloud_mode":"local-only","steps":[{"label":"n1","backend":"shell","outcome":"ok","exit_code":0,"duration_seconds":1,"attempts":1,"output_file":"n1.stdout","error_file":"n1.stderr"},{"label":"n2","backend":"shell","outcome":"failed","exit_code":1,"duration_seconds":1,"attempts":1,"output_file":"n2.stdout","error_file":"n2.stderr"}],"hooks":[]}
EOF
  fi
}

case "$cmd" in
  run)
    run_id="run_fixture_$$_$(date +%s)"
    run_dir="$workspace/.mentu/runs/$run_id"
    mkdir -p "$run_dir"
    printf 'partial\n' > "$run_dir/n1.stdout"
    : > "$run_dir/n1.stderr"
    # Partial record first: n1 done, no n2 yet. The daemon must project this
    # while the process is still alive.
    cat > "$run_dir/run.json" <<EOF
{"run_id":"$run_id","recipe_name":"fixture","started_at":"2026-01-01T00:00:00Z","ended_at":null,"outcome":"running","cloud_mode":"local-only","steps":[{"label":"n1","backend":"shell","outcome":"ok","exit_code":0,"duration_seconds":1,"attempts":1,"output_file":"n1.stdout","error_file":"n1.stderr"}],"hooks":[]}
EOF
    sleep 2
    if [ -f "$workspace/.mentu/n2.marker" ]; then
      record "$run_dir" "$run_id" ok 0 2
    else
      : > "$workspace/.mentu/n2.marker"
      record "$run_dir" "$run_id" failed 1 1
    fi
    ;;
  resume)
    run_dir="$workspace/.mentu/runs/$mentu_run"
    printf 'partial\n' > "$run_dir/n1.stdout" 2>/dev/null || true
    sleep 1
    record "$run_dir" "$mentu_run" ok 0 2
    ;;
  retry-step)
    run_dir="$workspace/.mentu/runs/$mentu_run"
    sleep 1
    record "$run_dir" "$mentu_run" ok 0 2
    ;;
esac
echo "Run record: $run_dir/run.json"
exit 0
"#;

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
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

fn node(id: &str, deps: &[&str]) -> Value {
    json!({
        "id": id,
        "title": format!("Node {id}"),
        "harness": "shell",
        "model": "",
        "dependsOn": deps,
        "prompt": format!("echo {id}"),
        "enabled": true,
    })
}

struct Fixture {
    _root: tempfile::TempDir,
    _override: RuntimeOverride,
    engine: Engine,
    workspace_id: String,
    workspace_dir: std::path::PathBuf,
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
        Fixture {
            _root: root,
            _override,
            engine,
            workspace_id,
            workspace_dir,
        }
    }

    fn write_intent(&self, intent: Value) -> Value {
        ok(
            &self.engine,
            "graph.write_intent",
            json!({"workspaceId": self.workspace_id, "intent": intent}),
        )
    }

    fn read(&self) -> Value {
        ok(
            &self.engine,
            "graph.read",
            json!({"workspaceId": self.workspace_id}),
        )
    }

    fn state_of(&self, read: &Value, id: &str) -> Value {
        read["graph"]["state"]["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|node| node["id"] == id)
            .cloned()
            .unwrap_or_else(|| panic!("no state node {id} in {read}"))
    }

    fn run(&self, node_id: &str) -> Value {
        ok(
            &self.engine,
            "graph.run",
            json!({"workspaceId": self.workspace_id, "nodeId": node_id}),
        )
    }

    fn argv_log(&self) -> String {
        fs::read_to_string(self.workspace_dir.join(".mentu").join("argv.log")).unwrap_or_default()
    }

    /// The fixture harness logs its argv when the run's process actually
    /// execs, which is asynchronous to the RPC that created the run: a
    /// single read right after `graph.retry_step`/`graph.resume_node`
    /// races that exec and has been observed missing the line entirely
    /// under full-suite load. Poll boundedly for the expected line; the
    /// assertion still fails the moment the line never appears (wrong
    /// target included — only the exact expected line ends the wait).
    fn wait_argv_contains(&self, needle: &str) -> String {
        let deadline = Instant::now() + Duration::from_secs(45);
        loop {
            let argv = self.argv_log();
            if argv.contains(needle) {
                return argv;
            }
            assert!(
                Instant::now() < deadline,
                "argv log never produced {needle:?}; argv log:\n{}",
                self.argv_log()
            );
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn wait_mentu_run_id(&self, run_id: &str) -> String {
        let deadline = Instant::now() + Duration::from_secs(45);
        loop {
            let status = ok(&self.engine, "mentu.run_status", json!({ "runId": run_id }));
            if let Some(id) = status["run"]["mentuRunId"].as_str() {
                return id.to_string();
            }
            assert!(
                Instant::now() < deadline,
                "run {run_id} never recorded a mentu run id"
            );
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    fn wait_status(&self, run_id: &str, want: &str) -> Value {
        let deadline = Instant::now() + Duration::from_secs(45);
        loop {
            let status = ok(&self.engine, "mentu.run_status", json!({ "runId": run_id }));
            if status["run"]["status"] == want {
                return status;
            }
            assert!(
                Instant::now() < deadline,
                "run {run_id} never reached {want}; last: {status}"
            );
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    fn wait_node_status(&self, id: &str, want: &str) -> Value {
        let deadline = Instant::now() + Duration::from_secs(45);
        loop {
            let read = self.read();
            let state = self.state_of(&read, id);
            if state["status"] == want {
                return state;
            }
            assert!(
                Instant::now() < deadline,
                "node {id} never reached {want}; last: {state}"
            );
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

#[test]
fn the_whole_graph_lifecycle_runs_through_the_real_daemon() {
    let fixture = Fixture::new();

    // 1. Write the human-owned half through RPC.
    let written = fixture.write_intent(json!({"nodes": [
        node("n1", &[]),
        node("n2", &["n1"]),
    ]}));
    assert_eq!(written["graph"]["version"], 1);
    assert!(
        fixture.workspace_dir.join(".drogon/graph.json").exists(),
        "the graph file is written at .drogon/graph.json"
    );
    // Both nodes start idle: no run has been observed.
    let read = fixture.read();
    assert_eq!(fixture.state_of(&read, "n1")["status"], "idle");
    assert_eq!(fixture.state_of(&read, "n2")["status"], "idle");

    // 2. Compile: n2 closes over n1.
    let compiled = ok(
        &fixture.engine,
        "graph.compile",
        json!({"workspaceId": fixture.workspace_id, "nodeId": "n2"}),
    );
    assert_eq!(compiled["nodeIds"], json!(["n1", "n2"]));
    assert_eq!(compiled["recipe"]["steps"][0]["label"], "n1");
    assert_eq!(compiled["recipe"]["steps"][1]["label"], "n2");
    assert!(
        compiled["findings"].as_array().unwrap().is_empty(),
        "fixture check/doctor report no findings: {compiled}"
    );

    // 3. Run it. n1 succeeds, n2 fails on its first attempt.
    let started = fixture.run("n2");
    let run_id = started["run"]["id"].as_str().unwrap().to_string();
    let mentu_run_id = fixture.wait_mentu_run_id(&run_id);

    // 4. While the run is live, state must show n1 already succeeded and the
    //    run still running — the live-progress projection, not a final view.
    let deadline = Instant::now() + Duration::from_secs(45);
    let mut observed_live = None;
    while Instant::now() < deadline {
        let read = fixture.read();
        let live = ok(
            &fixture.engine,
            "mentu.run_status",
            json!({ "runId": run_id }),
        );
        if live["run"]["status"] == "running"
            && fixture.state_of(&read, "n1")["status"] == "succeeded"
        {
            observed_live = Some(read);
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let live = observed_live.expect(
        "state must show n1 succeeded while the run is still running (the daemon's live mirror)",
    );
    // n2 has not started yet in the partial record.
    assert_eq!(fixture.state_of(&live, "n2")["status"], "idle");

    // A second launch into a node that is still live is refused, never a
    // duplicate worker.
    let double = call(
        &fixture.engine,
        "graph.run",
        json!({"workspaceId": fixture.workspace_id, "nodeId": "n2"}),
    );
    assert!(!double.ok);
    assert!(
        double
            .error
            .as_ref()
            .is_some_and(|error| error.message.contains("live run")),
        "{double:?}"
    );

    // Deleting an intent node does NOT kill the running worker: the orphaned
    // node stays visible in `state` (running), it is simply no longer part of
    // the graph that would be relaunched.
    fixture.write_intent(json!({"nodes": [node("n2", &[])]}));
    let orphaned = fixture.read();
    // The orphaned node's own step already succeeded; what matters is that it
    // is still OBSERVED in state (not dropped with its deleted intent entry)
    // while its run is live.
    let orphan_state = fixture.state_of(&orphaned, "n1");
    assert_eq!(orphan_state["status"], "succeeded");
    assert_eq!(orphan_state["runId"], run_id);
    assert!(
        ok(
            &fixture.engine,
            "mentu.run_status",
            json!({ "runId": run_id })
        )["run"]["status"]
            == "running",
        "deleting the intent node must not stop the run"
    );
    // Restore the full intent for the retry half of the journey.
    fixture.write_intent(json!({"nodes": [node("n1", &[]), node("n2", &["n1"])]}));

    // 5. It settles: n1 succeeded, n2 failed.
    fixture.wait_status(&run_id, "failed");
    let failed = fixture.wait_node_status("n2", "failed");
    assert_eq!(failed["runId"], run_id);
    assert_eq!(
        fixture.state_of(&fixture.read(), "n1")["status"],
        "succeeded"
    );

    // 6. Retry ONLY n2, through the runtime's own `retry-step`.
    let retried = ok(
        &fixture.engine,
        "graph.retry_step",
        json!({"workspaceId": fixture.workspace_id, "nodeId": "n2"}),
    );
    let retry_run = retried["run"]["id"].as_str().unwrap().to_string();
    assert_ne!(retry_run, run_id, "a retry is a new daemon run row");
    let argv = fixture.wait_argv_contains(&format!("retry-step {mentu_run_id} n2"));
    assert!(
        argv.contains(&format!("retry-step {mentu_run_id} n2")),
        "retry-step must target the SAME mentu run and only n2; argv log:\n{argv}"
    );
    fixture.wait_status(&retry_run, "succeeded");
    let retried_state = fixture.wait_node_status("n2", "succeeded");
    assert_eq!(retried_state["runId"], retry_run);
    // n1 was not rerun by retry-step: its step entry keeps attempts 1.
    assert_eq!(
        fixture.state_of(&fixture.read(), "n1")["status"],
        "succeeded"
    );

    // 7. Resume n1 through the runtime's own `resume`.
    let resumed = ok(
        &fixture.engine,
        "graph.resume_node",
        json!({"workspaceId": fixture.workspace_id, "nodeId": "n1"}),
    );
    let resume_run = resumed["run"]["id"].as_str().unwrap().to_string();
    let argv = fixture.wait_argv_contains(&format!("resume {mentu_run_id}"));
    assert!(
        argv.contains(&format!("resume {mentu_run_id}")),
        "resume must target the node's mentu run; argv log:\n{argv}"
    );
    fixture.wait_status(&resume_run, "succeeded");
}

#[test]
fn the_intent_seam_refuses_a_state_write_and_preserves_the_state_half() {
    let fixture = Fixture::new();
    fixture.write_intent(json!({"nodes": [node("n1", &[])]}));

    // A renderer that tries to write `state` is refused, not ignored.
    let refused = call(
        &fixture.engine,
        "graph.write_intent",
        json!({
            "workspaceId": fixture.workspace_id,
            "intent": {"nodes": [node("n1", &[])]},
            "state": {"nodes": []},
        }),
    );
    assert!(!refused.ok);
    assert_eq!(refused.error.unwrap().code, "invalid_argument");

    // ... and so is smuggling it inside `intent`.
    let refused_inner = call(
        &fixture.engine,
        "graph.write_intent",
        json!({
            "workspaceId": fixture.workspace_id,
            "intent": {"nodes": [node("n1", &[])], "state": {"nodes": []}},
        }),
    );
    assert!(!refused_inner.ok);

    // Unknown fields in state and at the root survive an intent rewrite.
    let path = fixture.workspace_dir.join(".drogon/graph.json");
    let mut raw: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    raw["futureRoot"] = json!({"kept": true});
    raw["state"] = json!({"updatedAt": "2026-01-01T00:00:00Z", "nodes": [], "futureState": 9});
    fs::write(&path, serde_json::to_string_pretty(&raw).unwrap()).unwrap();

    fixture.write_intent(json!({"nodes": [node("n1", &[]), node("n2", &["n1"])]}));
    let raw: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(raw["futureRoot"]["kept"], true);
    assert_eq!(raw["state"]["futureState"], 9);
    assert_eq!(raw["intent"]["nodes"].as_array().unwrap().len(), 2);
}

/// A kill between the temp write and the rename must never produce a torn
/// `graph.json`. The child aborts (SIGABRT) after writing and fsyncing the
/// temp file; the parent proves the old complete file is still intact.
#[test]
fn an_atomic_write_killed_before_the_rename_leaves_the_old_graph_intact() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(".drogon/graph.json");
    let original = json!({
        "version": 1,
        "intent": {"nodes": [node("keep", &[])]},
        "state": {"updatedAt": "", "nodes": []},
    });
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, serde_json::to_string_pretty(&original).unwrap()).unwrap();

    let exe = std::env::current_exe().unwrap();
    let status = std::process::Command::new(exe)
        .args([
            "--exact",
            "__crash_writer_child",
            "--ignored",
            "--nocapture",
        ])
        .env("DROGON_GRAPH_CRASH_DIR", dir.path())
        .env("DROGON_GRAPH_TEST_ABORT_AFTER_TEMP", "1")
        .status()
        .unwrap();
    assert!(
        status.code().is_none(),
        "the child must die by signal mid-write, got {status:?}"
    );

    let after: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(after, original, "a killed write must not touch graph.json");
    // The temp file is orphaned, never read as the graph.
    let leftovers: Vec<String> = fs::read_dir(path.parent().unwrap())
        .unwrap()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with(".graph.json.tmp."))
        .collect();
    assert_eq!(leftovers.len(), 1, "expected the orphaned temp file");
}

/// Not a test on its own: spawned by the test above with the crash env set.
#[test]
#[ignore]
fn __crash_writer_child() {
    let Ok(dir) = std::env::var("DROGON_GRAPH_CRASH_DIR") else {
        return;
    };
    let intent = json!({"nodes": [node("replacement", &[])]});
    let _ = drogon_core::graph::store::write_intent(Path::new(&dir), &intent);
    panic!("the crash seam did not abort; write_intent returned");
}
