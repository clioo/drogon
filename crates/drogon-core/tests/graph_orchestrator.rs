//! Real daemon scheduler + pinned shell runtime fixture; no model inference.
#![cfg(unix)]
use drogon_core::{
    Engine,
    graph::orchestrator,
    mentu::{execution, runtime},
};
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

const SCRIPT: &str = r#"#!/bin/sh
set -eu
case "$1" in
 --version) echo fixture; exit 0;;
 check) echo ok; exit 0;;
 doctor) echo '{"findings":[],"score":100}'; exit 0;;
esac
recipe="$2"
shift 2
workspace=""
while [ $# -gt 0 ]; do
 case "$1" in --workspace) workspace="$2"; shift 2;; *) shift;; esac
done
label=$(sed -n 's/.*"label": *"\([^"]*\)".*/\1/p' "$recipe" | head -1)
# What a node's runtime (and the agent it launches) can see: the daemon's own
# CLI shims first on PATH, bound to this data dir and workspace, no session.
printf '%s\n%s\n%s\n%s\n' "$DROGON_DATA_DIR" "$DROGON_WORKSPACE_ID" "${PATH%%:*}" "${DROGON_SESSION_ID:-unset}" > "$workspace/env-seen"
if [ -f "$workspace/pause-fixture" ]; then
 sleep 60 &
 child=$!
 echo "$child" > "$workspace/fixture-child.pid"
 wait "$child"
fi
mkdir -p "$workspace/.drogon/evaluations"
verdict=pass
case "$label" in *-1-test) verdict=findings;; esac
printf '{"verdict":"%s","evidence":"fixture executed"}' "$verdict" > "$workspace/.drogon/evaluations/$label.json"
run_id="run_fixture_$$"
run_dir="$workspace/.mentu/runs/$run_id"
mkdir -p "$run_dir"
touch "$run_dir/out" "$run_dir/err"
# Every real step changes the workspace (the main agent does the work, the
# tester writes its evidence, the reviewer fixes findings) and the pinned
# runtime reports each created path as drift. The daemon must read that as
# advisory for orchestrator runs — and must never declare `expected_changes`,
# which makes the runtime auto-commit the matching changes in the owner's repo.
bookkeeping=',"drift":{"created_paths":["work.txt",".drogon/evaluations/'"$label"'.json"],"expected_paths":[],"unexpected_paths":["work.txt",".drogon/evaluations/'"$label"'.json"]}'
if grep -q '"expected_changes"' "$recipe"; then
 bookkeeping=',"warnings":["expected_changes declared: the runtime would auto-commit"]'
fi
printf '{"run_id":"%s","recipe_name":"fixture","started_at":"2026-01-01T00:00:00Z","ended_at":"2026-01-01T00:00:01Z","outcome":"ok","cloud_mode":"local-only","steps":[{"label":"%s","backend":"shell","outcome":"ok","exit_code":0,"duration_seconds":0,"attempts":1,"output_file":"out","error_file":"err"%s}],"hooks":[]}' "$run_id" "$label" "$bookkeeping" > "$run_dir/run.json"
echo "Run record: $run_dir/run.json"
"#;

fn call(engine: &Engine, method: &str, params: Value) -> Value {
    let response = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        auth: None,
        method: method.into(),
        params,
    });
    assert!(response.ok, "{method}: {:?}", response.error);
    response.result.unwrap()
}

struct Fixture {
    root: tempfile::TempDir,
    engine: Arc<Engine>,
    workspace: String,
}
impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("data");
        let bin = data.join("mentu/runtime/bin/mentu-recipes");
        fs::create_dir_all(bin.parent().unwrap()).unwrap();
        fs::write(&bin, SCRIPT).unwrap();
        fs::set_permissions(bin, fs::Permissions::from_mode(0o755)).unwrap();
        runtime::set_expected_sha256_override(Some(
            Sha256::digest(SCRIPT.as_bytes())
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect(),
        ));
        let engine = Arc::new(Engine::open(&data).unwrap());
        let dir = root.path().join("workspace");
        fs::create_dir_all(&dir).unwrap();
        let workspace = call(&engine, "workspace.register", json!({"path":dir}))["id"]
            .as_str()
            .unwrap()
            .to_string();
        Self {
            root,
            engine,
            workspace,
        }
    }
    fn policy(&self, enabled: bool, max: u32) {
        call(
            &self.engine,
            "graph.write_policy",
            json!({"workspaceId":self.workspace,"policy":{"approvedRuntimes":[{"harness":"antigravity","model":"unavailable"}],"fallbackRuntime":{"harness":"shell","model":""},"adversarial":{"enabled":enabled,"maxIterations":max}}}),
        );
    }
    fn start(&self) -> Value {
        call(&self.engine,"graph.orchestrator_start",json!({"workspaceId":self.workspace,"main":{"id":"main","title":"Task","harness":"shell","model":"","prompt":"true","enabled":true}}))["run"].clone()
    }
    fn snapshot(&self) -> Value {
        call(
            &self.engine,
            "graph.orchestrator_status",
            json!({"workspaceId":self.workspace}),
        )["run"]
            .clone()
    }
    fn settled(&self) -> Value {
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            let run = self.snapshot();
            if run["status"] != "running" {
                return run;
            }
            assert!(Instant::now() < deadline, "run did not settle: {run}");
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let response = self.engine.dispatch(Request {
            protocol: PROTOCOL_VERSION,
            request_id: uuid::Uuid::new_v4().to_string(),
            auth: None,
            method: "graph.orchestrator_status".into(),
            params: json!({"workspaceId":self.workspace}),
        });
        if let Some(value) = response.result {
            for step in value["run"]["steps"].as_array().into_iter().flatten() {
                if let Some(id) = step["runId"].as_str() {
                    execution::cancel(id);
                    let deadline = Instant::now() + Duration::from_secs(5);
                    while execution::is_tracked(id) && Instant::now() < deadline {
                        std::thread::sleep(Duration::from_millis(20));
                    }
                    assert!(
                        !execution::is_tracked(id),
                        "test-owned runtime {id} remains live"
                    );
                }
            }
        }
        runtime::set_expected_sha256_override(None);
    }
}

#[test]
fn daemon_runs_off_mode_and_both_roles_with_snapshot_policy_and_fallback() {
    let _lock = TEST_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    let mut fixture = Fixture::new();
    let invalid = fixture.engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        auth: None,
        method: "graph.write_policy".into(),
        params: json!({
            "workspaceId": fixture.workspace,
            "policy": {
                "approvedRuntimes": [],
                "fallbackRuntime": null,
                "adversarial": {"enabled": true, "maxIterations": 3},
                "delegate": true
            }
        }),
    });
    assert!(!invalid.ok);
    assert_eq!(invalid.error.unwrap().code, "invalid_argument");

    fixture.policy(false, 2);
    fixture.start();
    // Pending work persists across a daemon reconstruction before any worker launches.
    fixture.engine = Arc::new(Engine::open(&fixture.root.path().join("data")).unwrap());
    let mut scheduler = orchestrator::spawn(fixture.engine.clone());
    let off = fixture.settled();
    assert_eq!(off["status"], "passed");
    assert_eq!(off["steps"].as_array().unwrap().len(), 1);
    // The daemon binds its canonical data dir (macOS tempdirs live under /private).
    let data_dir = fixture.root.path().join("data").canonicalize().unwrap();
    let env_seen = fs::read_to_string(fixture.root.path().join("workspace/env-seen")).unwrap();
    let seen: Vec<&str> = env_seen.lines().collect();
    assert_eq!(
        seen[0],
        data_dir.to_str().unwrap(),
        "DROGON_DATA_DIR reaches the node runtime"
    );
    assert_eq!(
        seen[1], fixture.workspace,
        "DROGON_WORKSPACE_ID reaches the node runtime"
    );
    assert_eq!(
        seen[2],
        data_dir.join("bin").to_str().unwrap(),
        "the daemon's CLI shims lead the node runtime's PATH"
    );
    assert_eq!(
        seen[3], "unset",
        "a node runtime carries no session identity"
    );

    fixture.policy(true, 2);
    fixture.start();
    fixture.policy(false, 1); // Editing next-run configuration cannot alter this run.
    let on = fixture.settled();
    assert_eq!(on["status"], "passed", "{on}");
    let steps = on["steps"].as_array().unwrap();
    assert_eq!(steps.len(), 5, "main, test, review, test, review");
    assert_eq!(steps[1]["status"], "succeeded");
    assert_eq!(steps[1]["verdict"], "findings");
    assert_eq!(steps[2]["phase"], "review");
    assert_eq!(steps[4]["phase"], "review");
    for step in &steps[1..] {
        assert_eq!(step["attempts"].as_array().unwrap().len(), 2);
        assert_eq!(step["attempts"][0]["outcome"], "launch_failed");
        assert_eq!(step["attempts"][1]["outcome"], "succeeded");
        assert_eq!(step["isFallback"], true);
    }
    scheduler.shutdown();

    // Cancellation acts on a genuinely live runtime, including its sleep child.
    let pause = fixture.root.path().join("workspace/pause-fixture");
    fs::write(&pause, "pause").unwrap();
    fixture.policy(false, 1);
    let active = fixture.start();
    let mut scheduler = orchestrator::spawn(fixture.engine.clone());
    let deadline = Instant::now() + Duration::from_secs(10);
    let live_id = loop {
        let snapshot = fixture.snapshot();
        if let Some(id) = snapshot["steps"][0]["runId"].as_str() {
            assert!(execution::is_tracked(id));
            break id.to_string();
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(25));
    };
    let child_file = fixture.root.path().join("workspace/fixture-child.pid");
    while !child_file.exists() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(25));
    }
    let child_pid: i32 = fs::read_to_string(child_file)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    call(
        &fixture.engine,
        "graph.orchestrator_stop",
        json!({"workspaceId":fixture.workspace,"runId":active["id"]}),
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if fixture.snapshot()["status"] == "stopped" {
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(25));
    }
    assert!(!execution::is_tracked(&live_id));
    // Signal zero is a read-only existence check for the exact captured fixture child.
    assert_eq!(
        unsafe { libc::kill(child_pid, 0) },
        -1,
        "fixture sleep child survived cancellation"
    );
    scheduler.shutdown();
    fs::remove_file(pause).unwrap();

    fixture.policy(true, 1);
    fixture.start();
    let mut scheduler = orchestrator::spawn(fixture.engine.clone());
    let exhausted = fixture.settled();
    assert_eq!(exhausted["status"], "exhausted");
    assert_eq!(
        exhausted["steps"].as_array().unwrap().len(),
        3,
        "review runs even on the final failed iteration"
    );
    scheduler.shutdown();

    fixture.policy(false, 1);
    let pending = fixture.start();
    let stopped = call(
        &fixture.engine,
        "graph.orchestrator_stop",
        json!({"workspaceId":fixture.workspace,"runId":pending["id"]}),
    );
    assert_eq!(stopped["run"]["status"], "stopped");
    call(
        &fixture.engine,
        "graph.orchestrator_resume",
        json!({"workspaceId":fixture.workspace,"runId":pending["id"]}),
    );
    let mut scheduler = orchestrator::spawn(fixture.engine.clone());
    assert_eq!(fixture.settled()["status"], "passed");
    scheduler.shutdown();
}

#[test]
fn start_rejects_bare_ambiguous_pi_model_but_accepts_qualified_and_unique() {
    let _lock = TEST_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
    for model in ["shared-model", "p2/shared-model", "unique-model"] {
        let fixture = Fixture::new();
        let pi = fixture.root.path().join("pi-fixture");
        fs::write(
            &pi,
            "#!/bin/sh\ncase \"$1\" in\n --version) echo 0.85.1;;\n --list-models) printf 'provider      model                context  max-out  thinking  images\\np1            shared-model         1K       1K       no        no\\np2            shared-model         1K       1K       no        no\\np1            unique-model         1K       1K       no        no\\n';;\n *) exit 2;;\nesac\n",
        )
        .unwrap();
        fs::set_permissions(&pi, fs::Permissions::from_mode(0o755)).unwrap();
        call(
            &fixture.engine,
            "agent.settings_update",
            json!({"updates": {
                "agentCmdOverrides": {"pi": pi},
                "agentDefaultEnv": {"pi": {"PI_CODING_AGENT_DIR": "/nonexistent/drogon-graph-test-pi"}}
            }}),
        );
        let response = fixture.engine.dispatch(Request {
            protocol: PROTOCOL_VERSION,
            request_id: uuid::Uuid::new_v4().to_string(),
            auth: None,
            method: "graph.orchestrator_start".into(),
            params: json!({"workspaceId":fixture.workspace,"main":{"id":"main","title":"Task","harness":"pi","model":model,"prompt":"true","enabled":true}}),
        });
        if model == "shared-model" {
            assert!(
                !response.ok,
                "bare ambiguous id must be refused: {response:?}"
            );
            let error = response.error.unwrap();
            assert!(error.message.contains("p1/shared-model"), "{error:?}");
            assert!(error.message.contains("p2/shared-model"), "{error:?}");
        } else {
            assert!(
                response.ok,
                "qualified and unique ids are admitted: {response:?}"
            );
        }
    }
}
