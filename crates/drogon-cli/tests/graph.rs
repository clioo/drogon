//! `drogon-cli graph`/`mentu resume|retry-step`: the CLI is a thin client of
//! the daemon's one execution path. These tests pin the exact RPC method and
//! params each verb sends (so the view/agent surface cannot drift), plus the
//! refusal path for the daemon-owned `state` half.

#![cfg(unix)]

mod common;

use common::{Action, Behavior, MockService, error_envelope, ok_envelope, stderr, stdout};
use serde_json::{Value, json};
use std::sync::Arc;

fn run_result() -> Value {
    json!({
        "id": "run-1",
        "workspaceId": "ws-1",
        "recipeId": "drogon-graph-n1",
        "approvalId": "appr-1",
        "mentuRunId": "run_20260101_AAAA",
        "status": "running",
        "startedAt": "2026-01-01T00:00:00Z",
        "steps": [],
    })
}

fn graph_result() -> Value {
    json!({
        "graph": {
            "version": 1,
            "intent": {"nodes": [
                {"id": "n1", "title": "Build", "harness": "shell", "model": "",
                 "dependsOn": [], "prompt": "echo n1", "enabled": true}
            ]},
            "state": {"updatedAt": "2026-01-01T00:00:00Z", "nodes": [
                {"id": "n1", "status": "idle"}
            ]},
        }
    })
}

fn failover_result() -> Value {
    json!({
        "run": run_result(),
        "runtime": {"harness": "pi", "model": "qwen3.8-flash-next-nvidia-nvfp4"},
        "isFallback": true,
        "attemptNumber": 2,
        "attempts": [
            {"harness": "opencode", "model": "claude-sonnet-4", "outcome": "launch_failed", "reason": "harness not installed"},
            {"harness": "pi", "model": "qwen3.8-flash-next-nvidia-nvfp4", "outcome": "launched"},
        ],
    })
}

fn compile_result() -> Value {
    json!({
        "recipeId": "drogon-graph-n1",
        "recipe": {"name": "drogon-graph-n1", "steps": []},
        "contentHash": "a".repeat(64),
        "nodeIds": ["n1"],
        "findings": [{
            "code": "missing_completion_signal",
            "severity": "warning",
            "nodeId": "n1",
            "message": "no signal",
            "recommendation": "add one"
        }],
    })
}

fn behavior() -> Behavior {
    Arc::new(|request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(ok_envelope(
                &id,
                json!({
                    "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
                    "capabilities": ["workspace.v1", "graph.v1", "mentu.v1"],
                    "version": "0.1.0",
                }),
            )),
            Some("graph.read") => Action::Respond(ok_envelope(&id, graph_result())),
            Some("graph.node_state") => Action::Respond(ok_envelope(
                &id,
                json!({"state": {"id": "n1", "status": "running", "runId": "run-1"}}),
            )),
            Some("graph.compile") => Action::Respond(ok_envelope(&id, compile_result())),
            Some("graph.run") => Action::Respond(ok_envelope(
                &id,
                json!({"run": run_result(), "compile": compile_result()}),
            )),
            Some("graph.resume_node") | Some("graph.retry_step") | Some("mentu.retry_step") => {
                Action::Respond(ok_envelope(&id, json!({"run": run_result()})))
            }
            Some("graph.run_node_failover") => Action::Respond(ok_envelope(&id, failover_result())),
            Some("graph.write_intent") => Action::Respond(ok_envelope(&id, graph_result())),
            Some("graph.orchestrator_start")
            | Some("graph.orchestrator_status")
            | Some("graph.orchestrator_stop")
            | Some("graph.orchestrator_resume") => Action::Respond(ok_envelope(
                &id,
                json!({"run": {
                    "id":"orch-1", "workspaceId":"ws-1", "policy":{},
                    "main":graph_result()["graph"]["intent"]["nodes"][0],
                    "status":"running", "phase":"main", "iteration":1, "steps":[],
                    "startedAt":"2026-09-12T00:00:00Z", "updatedAt":"2026-09-12T00:00:00Z"
                }}),
            )),
            _ => Action::Respond(error_envelope(
                &id,
                "method_not_found",
                "mock does not implement this method",
            )),
        }
    })
}

fn mock() -> (tempfile::TempDir, MockService) {
    let dir = tempfile::tempdir().expect("tempdir");
    let service = MockService::start(&dir.path().join("data"), behavior());
    (dir, service)
}

fn last_graph_request(service: &MockService) -> Value {
    service
        .captured()
        .into_iter()
        .rev()
        .find(|request| {
            request["method"]
                .as_str()
                .is_some_and(|method| method.starts_with("graph.") || method == "mentu.retry_step")
        })
        .expect("a graph request reached the mock")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn durable_orchestrator_verbs_send_exact_workspace_and_run_identity() {
    let (dir, service) = mock();
    let task = graph_result()["graph"]["intent"]["nodes"][0].clone();
    let path = dir.path().join("main-task.json");
    std::fs::write(&path, serde_json::to_vec(&task).unwrap()).unwrap();
    let started = common::run_cli(
        &service.data_dir,
        &[
            "--json",
            "graph",
            "orchestrator-start",
            "--workspace",
            "ws-1",
            "--file",
            path.to_str().unwrap(),
        ],
    );
    assert_eq!(started.status.code(), Some(0), "{}", stderr(&started));
    assert_eq!(
        last_graph_request(&service)["params"],
        json!({"workspaceId":"ws-1", "main":task})
    );
    for (verb, method) in [
        ("orchestrator-stop", "graph.orchestrator_stop"),
        ("orchestrator-resume", "graph.orchestrator_resume"),
    ] {
        let output = common::run_cli(
            &service.data_dir,
            &["graph", verb, "--workspace", "ws-1", "--run", "orch-1"],
        );
        assert_eq!(output.status.code(), Some(0), "{}", stderr(&output));
        let request = last_graph_request(&service);
        assert_eq!(request["method"], method);
        assert_eq!(
            request["params"],
            json!({"workspaceId":"ws-1", "runId":"orch-1"})
        );
        assert!(stdout(&output).contains("Workflow orch-1: running"));
    }
    let output = common::run_cli(
        &service.data_dir,
        &[
            "--json",
            "graph",
            "orchestrator-status",
            "--workspace",
            "ws-1",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "{}", stderr(&output));
    assert_eq!(
        last_graph_request(&service)["method"],
        "graph.orchestrator_status"
    );
    let envelope: Value = serde_json::from_str(&stdout(&output)).unwrap();
    assert_eq!(envelope["result"]["run"]["id"], "orch-1");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn graph_read_renders_both_halves_and_asks_for_the_workspace() {
    let (_hold, service) = mock();
    let output = common::run_cli(
        &service.data_dir,
        &["--json", "graph", "read", "--workspace", "ws-1"],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(
        envelope["result"]["graph"]["intent"]["nodes"][0]["id"],
        "n1"
    );
    assert_eq!(
        envelope["result"]["graph"]["state"]["nodes"][0]["status"],
        "idle"
    );

    let request = last_graph_request(&service);
    assert_eq!(request["method"], "graph.read");
    assert_eq!(request["params"], json!({"workspaceId": "ws-1"}));

    // Human text shows the intent and the observed state side by side.
    let output = common::run_cli(&service.data_dir, &["graph", "read", "--workspace", "ws-1"]);
    let text = stdout(&output);
    assert!(text.contains("Work graph v1"), "{text}");
    assert!(text.contains("n1 [shell no model] Build"), "{text}");
    assert!(text.contains("n1 idle"), "{text}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn graph_compile_sends_the_selection_and_can_write_the_recipe() {
    let (_hold, service) = mock();
    let out_path = service.data_dir.join("emitted.json");
    let output = common::run_cli(
        &service.data_dir,
        &[
            "graph",
            "compile",
            "--workspace",
            "ws-1",
            "--node",
            "n1",
            "--output",
            out_path.to_str().unwrap(),
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let request = last_graph_request(&service);
    assert_eq!(request["method"], "graph.compile");
    assert_eq!(
        request["params"],
        json!({"workspaceId": "ws-1", "nodeId": "n1"})
    );
    // The advisory finding is rendered, not hidden.
    let text = stdout(&output);
    assert!(text.contains("warning missing_completion_signal"), "{text}");
    assert!(text.contains("(advisory)"), "{text}");
    let written: Value =
        serde_json::from_str(&std::fs::read_to_string(&out_path).unwrap()).unwrap();
    assert_eq!(written["name"], "drogon-graph-n1");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn graph_compile_explicit_selection_sends_node_ids() {
    let (_hold, service) = mock();
    let output = common::run_cli(
        &service.data_dir,
        &[
            "graph",
            "compile",
            "--workspace",
            "ws-1",
            "--nodes",
            "n1,n2",
            "--json",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    assert_eq!(
        last_graph_request(&service)["params"],
        json!({"workspaceId": "ws-1", "nodeIds": ["n1", "n2"]})
    );
}

/// Regression for the QA finding "no command runs the whole graph":
/// `graph run` accepted only `--node`. The whole-graph form must run every
/// enabled node through the ONE existing `graph.run` path (the same call
/// the desktop's Run graph button sends), never a second engine.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn graph_run_all_runs_every_enabled_node_through_the_one_run_path() {
    let dir = tempfile::tempdir().expect("tempdir");
    let service = MockService::start(
        &dir.path().join("data"),
        Arc::new(|request| {
            let id = request["requestId"].as_str().unwrap_or("").to_string();
            match request["method"].as_str() {
                Some("status") => Action::Respond(ok_envelope(
                    &id,
                    json!({
                        "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
                        "capabilities": ["workspace.v1", "graph.v1", "mentu.v1"],
                        "version": "0.1.0",
                    }),
                )),
                Some("graph.read") => Action::Respond(ok_envelope(
                    &id,
                    json!({"graph": {
                        "version": 1,
                        "intent": {"nodes": [
                            {"id": "n1", "title": "Build", "harness": "shell", "model": "",
                             "dependsOn": [], "prompt": "echo n1", "enabled": true},
                            {"id": "n2", "title": "Review", "harness": "shell", "model": "",
                             "dependsOn": ["n1"], "prompt": "echo n2", "enabled": true},
                            {"id": "n3", "title": "Retired", "harness": "shell", "model": "",
                             "dependsOn": [], "prompt": "echo n3", "enabled": false},
                        ]},
                        "state": {"updatedAt": "2026-01-01T00:00:00Z", "nodes": []},
                    }}),
                )),
                Some("graph.run") => Action::Respond(ok_envelope(
                    &id,
                    json!({ "run": run_result(), "compile": compile_result() }),
                )),
                _ => Action::Respond(error_envelope(
                    &id,
                    "method_not_found",
                    "mock does not implement this method",
                )),
            }
        }),
    );

    let output = common::run_cli(
        &service.data_dir,
        &["--json", "graph", "run", "--workspace", "ws-1", "--all"],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(envelope["result"]["run"]["id"], "run-1");
    let request = last_graph_request(&service);
    assert_eq!(request["method"], "graph.run");
    assert_eq!(request["params"]["workspaceId"], "ws-1");
    let node_ids: Vec<String> = request["params"]["nodeIds"]
        .as_array()
        .expect("nodeIds")
        .iter()
        .map(|value| value.as_str().expect("id").to_string())
        .collect();
    // Every enabled node, disabled nodes excluded, deps closed by the daemon.
    assert_eq!(node_ids, vec!["n1", "n2"]);
    assert!(request["params"].get("nodeId").is_none());
}

/// `--all` on a graph with nothing enabled refuses honestly instead of
/// launching an empty recipe.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn graph_run_all_refuses_when_nothing_is_enabled() {
    let dir = tempfile::tempdir().expect("tempdir");
    let service = MockService::start(
        &dir.path().join("data"),
        Arc::new(|request| {
            let id = request["requestId"].as_str().unwrap_or("").to_string();
            match request["method"].as_str() {
                Some("status") => Action::Respond(ok_envelope(
                    &id,
                    json!({
                        "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
                        "capabilities": ["workspace.v1", "graph.v1", "mentu.v1"],
                        "version": "0.1.0",
                    }),
                )),
                Some("graph.read") => Action::Respond(ok_envelope(
                    &id,
                    json!({"graph": {
                        "version": 1,
                        "intent": {"nodes": [
                            {"id": "n3", "title": "Retired", "harness": "shell", "model": "",
                             "dependsOn": [], "prompt": "echo n3", "enabled": false},
                        ]},
                        "state": {"updatedAt": "2026-01-01T00:00:00Z", "nodes": []},
                    }}),
                )),
                _ => Action::Respond(error_envelope(
                    &id,
                    "method_not_found",
                    "mock does not implement this method",
                )),
            }
        }),
    );

    let output = common::run_cli(
        &service.data_dir,
        &["--json", "graph", "run", "--workspace", "ws-1", "--all"],
    );
    assert_eq!(output.status.code(), Some(1));
    // Under --json the failure envelope is the caller's parseable channel.
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON failure envelope");
    assert_eq!(envelope["ok"], false);
    let message = envelope["error"]["message"].as_str().unwrap_or("");
    assert!(
        message.contains("no enabled nodes"),
        "the refusal must say why: {message}"
    );
    // Nothing reached graph.run.
    assert!(
        service
            .captured()
            .iter()
            .all(|request| request["method"] != "graph.run")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn graph_run_sends_the_node_and_mentu_retry_step_sends_the_run_and_step() {
    let (_hold, service) = mock();
    let output = common::run_cli(
        &service.data_dir,
        &[
            "--json",
            "graph",
            "run",
            "--workspace",
            "ws-1",
            "--node",
            "n1",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(envelope["result"]["run"]["id"], "run-1");
    assert_eq!(
        last_graph_request(&service)["params"],
        json!({"workspaceId": "ws-1", "nodeId": "n1"})
    );

    let output = common::run_cli(
        &service.data_dir,
        &["mentu", "retry-step", "--run", "run-1", "--step", "n2"],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let request = last_graph_request(&service);
    assert_eq!(request["method"], "mentu.retry_step");
    assert_eq!(request["params"], json!({"runId": "run-1", "step": "n2"}));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn graph_retry_step_defaults_to_the_node_label_and_resume_uses_resume_node() {
    let (_hold, service) = mock();
    let output = common::run_cli(
        &service.data_dir,
        &["graph", "retry-step", "--workspace", "ws-1", "--node", "n2"],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let request = last_graph_request(&service);
    assert_eq!(request["method"], "graph.retry_step");
    // No `step` field: the daemon defaults it to the node id.
    assert_eq!(
        request["params"],
        json!({"workspaceId": "ws-1", "nodeId": "n2"})
    );

    let output = common::run_cli(
        &service.data_dir,
        &["graph", "resume", "--workspace", "ws-1", "--node", "n2"],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let request = last_graph_request(&service);
    assert_eq!(request["method"], "graph.resume_node");
    assert_eq!(
        request["params"],
        json!({"workspaceId": "ws-1", "nodeId": "n2"})
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn graph_run_node_failover_sends_the_node_and_renders_the_winning_runtime_and_attempt_history()
 {
    let (_hold, service) = mock();
    let output = common::run_cli(
        &service.data_dir,
        &[
            "--json",
            "graph",
            "run-node-failover",
            "--workspace",
            "ws-1",
            "--node",
            "n1",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(envelope["result"]["run"]["id"], "run-1");
    assert_eq!(envelope["result"]["runtime"]["harness"], "pi");
    assert_eq!(envelope["result"]["isFallback"], true);
    assert_eq!(envelope["result"]["attemptNumber"], 2);
    assert_eq!(
        last_graph_request(&service)["method"],
        "graph.run_node_failover"
    );
    assert_eq!(
        last_graph_request(&service)["params"],
        json!({"workspaceId": "ws-1", "nodeId": "n1"})
    );

    // The human-readable render (no --json) never overclaims the node's own
    // stored harness/model — it must name the runtime the policy actually
    // picked, that it was the fallback, and every runtime tried before it.
    let output = common::run_cli(
        &service.data_dir,
        &[
            "graph",
            "run-node-failover",
            "--workspace",
            "ws-1",
            "--node",
            "n1",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let text = stdout(&output);
    assert!(
        text.contains("pi/qwen3.8-flash-next-nvidia-nvfp4"),
        "{text}"
    );
    assert!(text.contains("the fallback runtime"), "{text}");
    assert!(text.contains("opencode/claude-sonnet-4"), "{text}");
    assert!(text.contains("harness not installed"), "{text}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn graph_write_intent_reads_a_file_and_sends_the_intent_verbatim() {
    let (_hold, service) = mock();
    let intent_path = service.data_dir.join("intent.json");
    let intent = json!({"nodes": [
        {"id": "n1", "title": "Build", "harness": "shell", "model": "",
         "dependsOn": [], "prompt": "echo n1", "enabled": true, "futureField": 7}
    ]});
    std::fs::write(&intent_path, serde_json::to_string(&intent).unwrap()).unwrap();

    let output = common::run_cli(
        &service.data_dir,
        &[
            "graph",
            "write-intent",
            "--workspace",
            "ws-1",
            "--file",
            intent_path.to_str().unwrap(),
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let request = last_graph_request(&service);
    assert_eq!(request["method"], "graph.write_intent");
    assert_eq!(request["params"]["workspaceId"], "ws-1");
    // Unknown fields ride through untouched; the CLI never rewrites intent.
    assert_eq!(request["params"]["intent"]["nodes"][0]["futureField"], 7);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refused_state_write_surfaces_the_daemon_error() {
    let dir = tempfile::tempdir().expect("tempdir");
    let behavior: Behavior = Arc::new(|request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(ok_envelope(
                &id,
                json!({
                    "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
                    "capabilities": ["workspace.v1", "graph.v1"],
                    "version": "0.1.0",
                }),
            )),
            Some("graph.write_intent") => Action::Respond(error_envelope(
                &id,
                "invalid_argument",
                "`state` is owned by the daemon and cannot be written through graph.write_intent",
            )),
            _ => Action::Respond(error_envelope(&id, "method_not_found", "unimplemented")),
        }
    });
    let service = MockService::start(&dir.path().join("data"), behavior);
    let intent_path = service.data_dir.join("intent.json");
    std::fs::write(&intent_path, r#"{"nodes":[],"state":{"nodes":[]}}"#).unwrap();
    let output = common::run_cli(
        &service.data_dir,
        &[
            "graph",
            "write-intent",
            "--workspace",
            "ws-1",
            "--file",
            intent_path.to_str().unwrap(),
        ],
    );
    assert_ne!(output.status.code(), Some(0));
    assert!(
        stderr(&output).contains("owned by the daemon"),
        "stderr: {}",
        stderr(&output)
    );
}
