//! End-to-end proof of the Subagent policy's failover order against the
//! real daemon: `graph.run_node_failover` tries approved runtimes in order,
//! skips one that fails to even COMPILE (an unsupported harness — nothing
//! ever ran), advances past one whose real (fixture) run settles `failed`,
//! and only then reaches the configured fallback — never before every
//! approved runtime has been tried.
//!
//! The fixture stands in for the pinned `mentu-recipes` runtime so no
//! inference ever runs. It reads the STAGED recipe file the daemon hands it
//! (the exact snapshot bytes `mentu-recipes run <path> --workspace <dir>`
//! receives) and looks at which Pi model the compiler embedded to decide
//! pass or fail — this is what lets one policy-configured model "always
//! fail" and another "always succeed" without the test reaching into any
//! daemon internals.
//!
//! Why its own test binary: `runtime::set_expected_sha256_override` is
//! process-global (see `graph_lifecycle.rs`'s docstring for the same
//! reasoning), so this fixture owns its own process.

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

/// `check`/`doctor` always pass (the emitter's own shape is not what this
/// test is proving). `run` reads the staged recipe it was handed, decides
/// pass/fail from which Pi model it names, and writes one real `run.json`.
const FIXTURE_SCRIPT: &str = r#"#!/bin/sh
set -e
cmd="$1"
if [ "$cmd" = "--version" ]; then echo "mentu-recipes-fixture 0.5.0"; exit 0; fi
if [ "$cmd" = "check" ]; then echo "ok"; exit 0; fi
if [ "$cmd" = "doctor" ]; then printf '{"findings":[],"score":100}\n'; exit 0; fi
if [ "$cmd" != "run" ]; then echo "fixture: unknown command $cmd" >&2; exit 2; fi
recipe="$2"
shift 2
workspace=""
while [ $# -gt 0 ]; do
  case "$1" in
    --workspace) workspace="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ -z "$workspace" ]; then echo "fixture: no workspace" >&2; exit 2; fi
mkdir -p "$workspace/.mentu"
echo "$recipe" >> "$workspace/.mentu/recipe-arg.log"
run_id="run_fixture_$$_$(date +%s)_$RANDOM"
run_dir="$workspace/.mentu/runs/$run_id"
mkdir -p "$run_dir"
: > "$run_dir/n1.stdout"
: > "$run_dir/n1.stderr"
if grep -q 'good-model' "$recipe"; then
  outcome=ok
  exit_code=0
else
  outcome=failed
  exit_code=1
fi
# A brief real delay: the daemon spawns this fixture and returns from
# `graph.run_node_failover` immediately, so callers get a genuine window
# where the child is still alive to observe (a double-launch guard test
# needs that window to be real, not assumed).
sleep 1
cat > "$run_dir/run.json" <<EOF
{"run_id":"$run_id","recipe_name":"fixture","started_at":"2026-01-01T00:00:00Z","ended_at":"2026-01-01T00:00:01Z","outcome":"$outcome","cloud_mode":"local-only","steps":[{"label":"n1","backend":"drogon-pi-n1","outcome":"$outcome","exit_code":$exit_code,"duration_seconds":1,"attempts":1,"output_file":"n1.stdout","error_file":"n1.stderr"}],"hooks":[]}
EOF
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

fn err(engine: &Engine, method: &str, params: Value) -> String {
    let response = call(engine, method, params);
    assert!(
        !response.ok,
        "expected an error for {method}, got: {:?}",
        response.result
    );
    response.error.unwrap().message
}

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

    fn pi_node(id: &str) -> Value {
        json!({
            "id": id,
            "title": format!("Node {id}"),
            "harness": "pi",
            "model": "placeholder",
            "dependsOn": [],
            "prompt": "Report the number of tracked files.",
            "enabled": true,
            "provider": {
                "baseUrl": "http://127.0.0.1:9/v1",
                "apiKeyEnv": "DROGON_FIXTURE_PI_KEY",
            },
        })
    }

    fn write_intent(&self, intent: Value) -> Value {
        ok(
            &self.engine,
            "graph.write_intent",
            json!({"workspaceId": self.workspace_id, "intent": intent}),
        )
    }

    fn run_failover(&self, node_id: &str) -> Value {
        ok(
            &self.engine,
            "graph.run_node_failover",
            json!({"workspaceId": self.workspace_id, "nodeId": node_id}),
        )
    }

    fn run_failover_err(&self, node_id: &str) -> String {
        err(
            &self.engine,
            "graph.run_node_failover",
            json!({"workspaceId": self.workspace_id, "nodeId": node_id}),
        )
    }

    fn read(&self) -> Value {
        ok(
            &self.engine,
            "graph.read",
            json!({"workspaceId": self.workspace_id}),
        )
    }

    fn node_status(&self, id: &str) -> String {
        self.read()["graph"]["state"]["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|node| node["id"] == id)
            .unwrap_or_else(|| panic!("no state node {id}"))["status"]
            .as_str()
            .unwrap()
            .to_string()
    }

    fn wait_node_status(&self, id: &str, want: &str) -> Value {
        let deadline = Instant::now() + Duration::from_secs(45);
        loop {
            let read = self.read();
            let state = read["graph"]["state"]["nodes"]
                .as_array()
                .unwrap()
                .iter()
                .find(|node| node["id"] == id)
                .cloned()
                .unwrap_or_else(|| panic!("no state node {id} in {read}"));
            if state["status"] == want {
                return state;
            }
            assert!(
                Instant::now() < deadline,
                "node {id} never reached {want}; last: {state}"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

/// The whole failover story in one run: approved[0] is an unsupported
/// harness (fails to LAUNCH — nothing ever ran), approved[1]'s model always
/// fails the fixture run, and only the fallback's model succeeds.
#[test]
fn failover_tries_approved_runtimes_in_order_and_only_then_the_fallback() {
    let fixture = Fixture::new();
    fixture.write_intent(json!({
        "nodes": [Fixture::pi_node("n1")],
        "policy": {
            "approvedRuntimes": [
                {"harness": "mystery-unsupported", "model": "whatever"},
                {"harness": "pi", "model": "bad-model"},
            ],
            "fallbackRuntime": {"harness": "pi", "model": "good-model"},
            "adversarial": {"enabled": false, "maxIterations": 3},
            "delegate": false,
        },
    }));

    // Attempt 1: the unsupported harness fails to compile at all — the
    // daemon records `launch_failed` and moves straight to attempt 2
    // WITHIN this same call, since a compile-time refusal needs no
    // observation.
    let first = fixture.run_failover("n1");
    assert_eq!(first["runtime"]["harness"], "pi");
    assert_eq!(first["runtime"]["model"], "bad-model");
    assert_eq!(first["isFallback"], false);
    assert_eq!(first["attemptNumber"], 2);
    let attempts = first["attempts"].as_array().unwrap();
    assert_eq!(attempts.len(), 2, "attempts so far: {attempts:?}");
    assert_eq!(attempts[0]["harness"], "mystery-unsupported");
    assert_eq!(attempts[0]["outcome"], "launch_failed");
    assert!(
        attempts[0]["reason"]
            .as_str()
            .unwrap()
            .contains("mystery-unsupported"),
        "the refusal must name the unsupported harness: {:?}",
        attempts[0]["reason"]
    );
    assert_eq!(attempts[1]["harness"], "pi");
    assert_eq!(attempts[1]["outcome"], "launched");

    // While attempt 2 (bad-model) is what's actually running, a second call
    // must refuse rather than double-launch.
    let busy = fixture.run_failover_err("n1");
    assert!(
        busy.contains("already has a live run"),
        "must refuse to double-launch: {busy}"
    );

    // The fixture's real (fake) run settles failed for `bad-model`.
    fixture.wait_node_status("n1", "failed");

    // Attempt 3: advance to the fallback, only now that both approved
    // runtimes have genuinely been tried.
    let second = fixture.run_failover("n1");
    assert_eq!(second["runtime"]["harness"], "pi");
    assert_eq!(second["runtime"]["model"], "good-model");
    assert_eq!(second["isFallback"], true, "the fallback is used last");
    assert_eq!(second["attemptNumber"], 3);
    let attempts = second["attempts"].as_array().unwrap();
    assert_eq!(attempts.len(), 3);
    // BROKEN-2: the ledger recorded `launched` at launch time (the daemon
    // could not yet know the outcome), but by now this run has genuinely
    // settled failed — every attempt row must carry that real settlement,
    // not "launched" forever.
    assert_eq!(
        attempts[1]["outcome"], "failed",
        "a launched attempt whose run settled failed must be reported as failed, not stuck at launched"
    );
    assert!(
        attempts[1]["reason"]
            .as_str()
            .is_some_and(|r| !r.is_empty()),
        "a settled-failed attempt must carry a reason: {:?}",
        attempts[1]["reason"]
    );
    assert_eq!(attempts[2]["harness"], "pi");
    assert_eq!(attempts[2]["model"], "good-model");
    assert_eq!(attempts[2]["outcome"], "launched");

    fixture.wait_node_status("n1", "succeeded");

    // The episode is done: failover on an already-succeeded node refuses
    // rather than silently starting a fresh one.
    let done = fixture.run_failover_err("n1");
    assert!(
        done.contains("already succeeded"),
        "must refuse once the node has succeeded: {done}"
    );
}

/// BROKEN-2's exact literal shape: three approved runtimes (a compile-time
/// refusal, then two that launch for real and each settle failed) plus a
/// fallback that finally succeeds — the episode must walk every one of them
/// in order, never stopping early and never skipping ahead.
#[test]
fn failover_walks_every_approved_runtime_before_the_fallback() {
    let fixture = Fixture::new();
    fixture.write_intent(json!({
        "nodes": [Fixture::pi_node("n1")],
        "policy": {
            "approvedRuntimes": [
                {"harness": "mystery-unsupported", "model": "whatever"},
                {"harness": "pi", "model": "bad-model-1"},
                {"harness": "pi", "model": "bad-model-2"},
            ],
            "fallbackRuntime": {"harness": "pi", "model": "good-model"},
            "adversarial": {"enabled": false, "maxIterations": 3},
            "delegate": false,
        },
    }));

    // Attempt 1: refuse-to-launch, skipped within this same call.
    let first = fixture.run_failover("n1");
    assert_eq!(first["runtime"]["model"], "bad-model-1");
    assert_eq!(first["attemptNumber"], 2);
    fixture.wait_node_status("n1", "failed");

    // Attempt 2: launches for real, settles failed (launch-then-fail).
    let second = fixture.run_failover("n1");
    assert_eq!(second["runtime"]["model"], "bad-model-2");
    assert_eq!(second["isFallback"], false);
    assert_eq!(second["attemptNumber"], 3);
    fixture.wait_node_status("n1", "failed");

    // Attempt 3: the second real candidate also settles failed — only NOW
    // does the episode reach the fallback, never before every approved
    // runtime genuinely failed.
    let third = fixture.run_failover("n1");
    assert_eq!(third["runtime"]["model"], "good-model");
    assert_eq!(third["isFallback"], true, "the fallback is used last");
    assert_eq!(third["attemptNumber"], 4);
    let attempts = third["attempts"].as_array().unwrap();
    assert_eq!(
        attempts.len(),
        4,
        "every approved runtime plus the fallback: {attempts:?}"
    );
    assert_eq!(attempts[0]["outcome"], "launch_failed");
    assert_eq!(attempts[1]["model"], "bad-model-1");
    assert_eq!(attempts[1]["outcome"], "failed");
    assert_eq!(attempts[2]["model"], "bad-model-2");
    assert_eq!(attempts[2]["outcome"], "failed");
    assert_eq!(attempts[3]["model"], "good-model");
    assert_eq!(attempts[3]["outcome"], "launched");

    fixture.wait_node_status("n1", "succeeded");
}

/// A mid-episode reorder of the approved-runtime list must change which
/// runtime is tried NEXT (position-based, read fresh from the live policy
/// every call) while never rewriting an attempt already made.
#[test]
fn failover_honors_a_mid_episode_reorder_for_attempts_not_yet_made() {
    let fixture = Fixture::new();
    fixture.write_intent(json!({
        "nodes": [Fixture::pi_node("n1")],
        "policy": {
            "approvedRuntimes": [
                {"harness": "pi", "model": "bad-model-1"},
                {"harness": "pi", "model": "bad-model-2"},
            ],
            "fallbackRuntime": {"harness": "pi", "model": "good-model"},
            "adversarial": {"enabled": false, "maxIterations": 3},
            "delegate": false,
        },
    }));

    let first = fixture.run_failover("n1");
    assert_eq!(first["runtime"]["model"], "bad-model-1");
    fixture.wait_node_status("n1", "failed");

    // Reorder the STILL-UNTRIED tail of the list (swap the fallback ahead of
    // the second approved runtime) and re-write the intent — the first
    // attempt already made must stay exactly as recorded.
    fixture.write_intent(json!({
        "nodes": [Fixture::pi_node("n1")],
        "policy": {
            "approvedRuntimes": [
                {"harness": "pi", "model": "bad-model-1"},
                {"harness": "pi", "model": "good-model"},
            ],
            "fallbackRuntime": {"harness": "pi", "model": "bad-model-2"},
            "adversarial": {"enabled": false, "maxIterations": 3},
            "delegate": false,
        },
    }));

    let second = fixture.run_failover("n1");
    assert_eq!(
        second["runtime"]["model"], "good-model",
        "the reordered list's new position-2 candidate must be tried next"
    );
    assert_eq!(second["isFallback"], false);
    let attempts = second["attempts"].as_array().unwrap();
    assert_eq!(attempts.len(), 2);
    assert_eq!(
        attempts[0]["model"], "bad-model-1",
        "the already-made first attempt must never be rewritten by a later reorder"
    );
    assert_eq!(attempts[0]["outcome"], "failed");

    fixture.wait_node_status("n1", "succeeded");
}

/// F0: the daemon must attribute which runtime ACTUALLY ran a node's
/// latest launch onto `state` itself — never leaving the persisted/read
/// half showing the node's authored template harness/model regardless of
/// which approved runtime failover actually substituted.
#[test]
fn state_attributes_the_actually_substituted_runtime_not_the_authored_template() {
    let fixture = Fixture::new();
    // The node's own AUTHORED harness/model ("pi"/"placeholder") is never
    // what runs once a policy is configured — this proves `state` reports
    // the SUBSTITUTED runtime, not this template.
    fixture.write_intent(json!({
        "nodes": [Fixture::pi_node("n1")],
        "policy": {
            "approvedRuntimes": [{"harness": "pi", "model": "good-model"}],
            "fallbackRuntime": null,
            "adversarial": {"enabled": false, "maxIterations": 3},
            "delegate": false,
        },
    }));
    fixture.run_failover("n1");
    let settled = fixture.wait_node_status("n1", "succeeded");
    assert_eq!(settled["harness"], "pi");
    assert_eq!(settled["model"], "good-model");
    assert_eq!(
        settled["isFreeDefaultRuntime"], false,
        "good-model is not this build's free local default"
    );
}

/// F0, the zero-config half: launched via the same failover seam but with
/// NO policy configured at all, `state` must attribute the free local
/// default honestly (harness/model AND the `isFreeDefaultRuntime` flag) —
/// even though this node settles failed (the free default's model is not
/// "good-model", so the fixture never marks it a pass). A separate test
/// (not a second `Fixture` in the test above) because `Fixture::new()`
/// holds the process-global runtime-override lock for its whole lifetime;
/// two live in one test body would self-deadlock, not just risk a stale
/// policy surviving via the store's merge-forward.
#[test]
fn state_attributes_the_zero_config_free_default_runtime() {
    let fixture = Fixture::new();
    fixture.write_intent(json!({"nodes": [Fixture::pi_node("n1")]}));
    fixture.run_failover("n1");
    let settled = fixture.wait_node_status("n1", "failed");
    assert_eq!(settled["harness"], "pi");
    assert_eq!(settled["model"], "qwen3.8-flash-next-nvidia-nvfp4");
    assert_eq!(
        settled["isFreeDefaultRuntime"], true,
        "the zero-config default runtime must be attributed as free"
    );
}

/// An empty policy must still run for real, on the free local default —
/// zero cost by default, never a hard failure just because nobody has
/// opened the Subagent policy panel yet.
#[test]
fn an_empty_policy_runs_the_free_local_default_and_succeeds() {
    let fixture = Fixture::new();
    fixture.write_intent(json!({"nodes": [Fixture::pi_node("n1")]}));
    // No policy at all in the payload: `resolveGraphPolicy`'s Rust
    // counterpart, `GraphPolicy::default()`, is what the daemon actually
    // applies. The default runtime's model does not literally contain
    // "good-model", so the fixture would normally fail it — proving this
    // path really did try the DEFAULT id, not silently skip failover.
    let attempt = fixture.run_failover("n1");
    assert_eq!(attempt["runtime"]["harness"], "pi");
    assert_eq!(
        attempt["runtime"]["model"],
        "qwen3.8-flash-next-nvidia-nvfp4"
    );
    assert_eq!(attempt["isFallback"], false);
    assert_eq!(attempt["attemptNumber"], 1);

    fixture.wait_node_status("n1", "failed");

    // No fallback configured either: exhaustion is an honest refusal, not a
    // silent stop.
    let exhausted = fixture.run_failover_err("n1");
    assert!(
        exhausted.contains("Nothing left to try"),
        "must name exhaustion, not silently do nothing: {exhausted}"
    );
    assert_eq!(fixture.node_status("n1"), "failed");
}

/// A node with a live run must never be double-launched by failover, and a
/// blocked node has nothing to fail over.
#[test]
fn failover_refuses_a_disabled_node() {
    let fixture = Fixture::new();
    fixture.write_intent(json!({"nodes": [{
        "id": "n1",
        "title": "Disabled",
        "harness": "shell",
        "model": "",
        "dependsOn": [],
        "prompt": "echo hi",
        "enabled": false,
    }]}));
    let refusal = fixture.run_failover_err("n1");
    assert!(
        refusal.contains("blocked"),
        "a disabled node must refuse as blocked, not attempt anything: {refusal}"
    );
}
