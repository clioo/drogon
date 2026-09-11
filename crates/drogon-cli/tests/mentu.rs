//! `drogon-cli mentu`: the environment check must be honest (installed /
//! not_installed / partially_available, never an optimistic guess) and
//! `mentu open` must only report success when the desktop confirmed the tab.

#![cfg(unix)]

mod common;

use common::{Action, Behavior, MockService, error_envelope, ok_envelope, stderr, stdout};
use serde_json::{Value, json};
use std::sync::Arc;

fn runtime_result(overrides: Value) -> Value {
    let mut base = json!({
        "available": true,
        "path": "/data/mentu/runtime/bin/mentu-recipes",
        "version": "mentu-recipes 0.5.0",
        "expectedRevision": "c82ccfa0ebbe77d62193e068821ba6e74f87a8d3",
        "expectedSha256": "f00528a940185e9433ad65b02e7de251d7d3d856c9d24d38f8b1474a1ca8bc5d",
        "actualSha256": "f00528a940185e9433ad65b02e7de251d7d3d856c9d24d38f8b1474a1ca8bc5d",
        "lockMatches": true,
        "message": null,
    });
    for (key, value) in overrides.as_object().expect("object") {
        base[key] = value.clone();
    }
    json!({ "runtime": base })
}

fn recipes_result() -> Value {
    json!({
        "recipes": [
            { "id": "hello", "path": ".mentu/recipes/hello.json", "name": "Hello",
              "valid": true, "issue": null },
            { "id": "broken", "path": ".mentu/recipes/broken.json", "name": null,
              "valid": false, "issue": "missing steps" },
        ]
    })
}

fn behavior(runtime: Value, recipes: Value) -> Behavior {
    Arc::new(move |request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(ok_envelope(
                &id,
                json!({
                    "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
                    "capabilities": [
                        "workspace.v1", "session.pty.v1", "mentu.v1", "browser.relay.v1",
                    ],
                    "version": "0.1.0",
                }),
            )),
            Some("mentu.runtime") => Action::Respond(ok_envelope(&id, runtime.clone())),
            Some("mentu.recipes") => Action::Respond(ok_envelope(&id, recipes.clone())),
            Some("mentu.open") => Action::Respond(ok_envelope(
                &id,
                json!({
                    "workspaceId": request["params"]["workspaceId"],
                    "recipeId": request["params"].get("recipeId").cloned().unwrap_or(Value::Null),
                    "opened": true,
                }),
            )),
            _ => Action::Respond(error_envelope(
                &id,
                "method_not_found",
                "mock does not implement this method",
            )),
        }
    })
}

fn mock(runtime: Value, recipes: Value) -> (tempfile::TempDir, MockService) {
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("data");
    let service = MockService::start(&data_dir, behavior(runtime, recipes));
    (dir, service)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn installed_runtime_reports_installed_with_the_workspace_inventory() {
    let (_hold, service) = mock(runtime_result(json!({})), recipes_result());
    let output = common::run_cli(
        &service.data_dir,
        &["--json", "mentu", "status", "--workspace", "ws-1"],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(envelope["ok"], true);
    assert_eq!(envelope["result"]["verdict"], "installed");
    assert_eq!(envelope["result"]["workspace"]["id"], "ws-1");
    assert_eq!(envelope["result"]["workspace"]["recipes"]["total"], 2);
    assert_eq!(envelope["result"]["workspace"]["recipes"]["valid"], 1);
    assert_eq!(
        envelope["result"]["workspace"]["recipes"]["invalid"][0]["id"],
        "broken"
    );
    assert_eq!(
        envelope["result"]["workspace"]["recipes"]["invalid"][0]["issue"],
        "missing steps"
    );
    assert!(
        envelope["result"]["summary"]
            .as_str()
            .unwrap()
            .contains("matches the approved lock"),
        "{envelope:?}"
    );

    // Human text leads with the verdict, so a reader cannot miss it.
    let output = common::run_cli(
        &service.data_dir,
        &["mentu", "status", "--workspace", "ws-1"],
    );
    let text = stdout(&output);
    assert!(
        text.starts_with("Mentu environment: installed"),
        "stdout: {text}"
    );
    assert!(text.contains("recipes: 2 total, 1 valid"), "stdout: {text}");
    assert!(
        text.contains("invalid broken: missing steps"),
        "stdout: {text}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn absent_runtime_reports_not_installed_and_never_optimistic() {
    let (_hold, service) = mock(
        runtime_result(json!({
            "available": false,
            "version": null,
            "actualSha256": null,
            "lockMatches": false,
            "message": "Mentu Recipes is unavailable on the execution host.",
        })),
        recipes_result(),
    );
    let output = common::run_cli(&service.data_dir, &["--json", "mentu", "status"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(envelope["result"]["verdict"], "not_installed");
    // No workspace was asked for: the recipe half is unknown, never zero.
    assert_eq!(envelope["result"]["workspace"], Value::Null);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lock_mismatch_reports_partially_available() {
    let (_hold, service) = mock(
        runtime_result(json!({
            "available": false,
            "lockMatches": false,
            "actualSha256": "0000000000000000000000000000000000000000000000000000000000000000",
            "message": "The application-owned Mentu runtime does not match the approved runtime lock.",
        })),
        recipes_result(),
    );
    let output = common::run_cli(&service.data_dir, &["--json", "mentu", "status"]);
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(envelope["result"]["verdict"], "partially_available");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_silent_version_probe_is_not_a_full_install() {
    // Bytes match the lock but the binary never answered --version: the
    // honest answer is "partially available", not "installed".
    let (_hold, service) = mock(runtime_result(json!({ "version": null })), recipes_result());
    let output = common::run_cli(&service.data_dir, &["--json", "mentu", "status"]);
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(envelope["result"]["verdict"], "partially_available");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn open_sends_workspace_recipe_and_timeout_then_reports_the_desktop_verdict() {
    let (_hold, service) = mock(runtime_result(json!({})), recipes_result());
    let output = common::run_cli(
        &service.data_dir,
        &[
            "--json",
            "mentu",
            "open",
            "--workspace",
            "ws-1",
            "--recipe",
            "hello",
            "--timeout-ms",
            "4000",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(envelope["result"]["opened"], true);
    assert_eq!(envelope["result"]["workspaceId"], "ws-1");
    assert_eq!(envelope["result"]["recipeId"], "hello");

    let open = service
        .captured()
        .into_iter()
        .find(|request| request["method"] == "mentu.open")
        .expect("mock saw mentu.open");
    assert_eq!(open["params"]["workspaceId"], "ws-1");
    assert_eq!(open["params"]["recipeId"], "hello");
    assert_eq!(open["params"]["timeoutMs"], 4000);

    let output = common::run_cli(
        &service.data_dir,
        &["mentu", "open", "--workspace", "ws-1", "--recipe", "hello"],
    );
    assert!(
        stdout(&output).contains("focused on recipe hello"),
        "stdout: {}",
        stdout(&output)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn open_without_a_recipe_omits_the_field() {
    let (_hold, service) = mock(runtime_result(json!({})), recipes_result());
    let output = common::run_cli(&service.data_dir, &["mentu", "open", "--workspace", "ws-1"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let open = service
        .captured()
        .into_iter()
        .find(|request| request["method"] == "mentu.open")
        .expect("mock saw mentu.open");
    assert!(
        open["params"].get("recipeId").is_none(),
        "params: {:?}",
        open["params"]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn desktop_not_connected_surfaces_instead_of_a_fake_open() {
    let behavior: Behavior = Arc::new(|request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(ok_envelope(
                &id,
                json!({
                    "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
                    "capabilities": ["mentu.v1", "browser.relay.v1"],
                    "version": "0.1.0",
                }),
            )),
            Some("mentu.open") => Action::Respond(error_envelope(
                &id,
                "desktop_not_connected",
                "No connected Drogon desktop completed the browser command within 15000ms.",
            )),
            _ => Action::Respond(error_envelope(&id, "method_not_found", "no such method")),
        }
    });
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("data");
    let service = MockService::start(&data_dir, behavior);
    let output = common::run_cli(&service.data_dir, &["mentu", "open", "--workspace", "ws-1"]);
    assert_eq!(output.status.code(), Some(1), "stdout: {}", stdout(&output));
    assert!(
        stderr(&output).contains("desktop_not_connected"),
        "stderr: {}",
        stderr(&output)
    );

    let output = common::run_cli(
        &service.data_dir,
        &["--json", "mentu", "open", "--workspace", "ws-1"],
    );
    assert_eq!(output.status.code(), Some(1));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON failure envelope");
    assert_eq!(envelope["ok"], false);
    assert_eq!(envelope["error"]["code"], "desktop_not_connected");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn missing_mentu_capability_refuses_before_any_mentu_call() {
    let behavior: Behavior = Arc::new(|request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(ok_envelope(
                &id,
                json!({
                    "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
                    "capabilities": ["workspace.v1"],
                    "version": "0.1.0",
                }),
            )),
            _ => Action::Respond(error_envelope(&id, "method_not_found", "no such method")),
        }
    });
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("data");
    let service = MockService::start(&data_dir, behavior);
    let output = common::run_cli(&service.data_dir, &["mentu", "status"]);
    assert_eq!(output.status.code(), Some(1), "stdout: {}", stdout(&output));
    assert!(
        stderr(&output).contains("mentu.v1"),
        "stderr: {}",
        stderr(&output)
    );
    assert!(
        service
            .captured()
            .iter()
            .all(|request| request["method"] != "mentu.runtime"),
        "no Mentu call without the capability"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn empty_recipe_is_a_usage_error_without_io() {
    let dir = tempfile::tempdir().expect("tempdir");
    let output = common::run_cli(
        dir.path(),
        &["mentu", "open", "--workspace", "ws-1", "--recipe", ""],
    );
    assert_eq!(output.status.code(), Some(2), "stdout: {}", stdout(&output));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn auth_token_is_never_printed() {
    let (_hold, service) = mock(runtime_result(json!({})), recipes_result());
    let output = common::run_cli(
        &service.data_dir,
        &["--json", "mentu", "status", "--workspace", "ws-1"],
    );
    assert!(!stdout(&output).contains(common::TOKEN));
    assert!(!stderr(&output).contains(common::TOKEN));
}

// ---------------------------------------------------------------------------
// `mentu run` and friends: the delegation primitives. These assert BOTH
// halves of the honesty contract: a run that starts reports the daemon's
// own run row, and a recipe without a content-bound approval is refused
// with `mentu_approval_required` — the CLI never approves on the caller's
// behalf, so an edited recipe cannot be run behind the human's back.
// ---------------------------------------------------------------------------

const APPROVAL_ID: &str = "appr-1";
const CONTENT_HASH: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn hash_hex() -> String {
    CONTENT_HASH.to_string()
}

fn approval() -> Value {
    json!({
        "id": APPROVAL_ID,
        "workspaceId": "ws-1",
        "recipeId": "hello",
        "contentHash": hash_hex(),
        "approvedAt": "2026-09-07T00:00:00Z",
    })
}

fn run_payload(status: &str, ended_at: Option<&str>, steps: Value) -> Value {
    json!({
        "id": "run-row-1",
        "workspaceId": "ws-1",
        "recipeId": "hello",
        "approvalId": APPROVAL_ID,
        "status": status,
        "startedAt": "2026-09-07T00:00:00Z",
        "endedAt": ended_at,
        "steps": steps,
    })
}

fn step_payload(label: &str, status: &str) -> Value {
    json!({
        "label": label,
        "backend": "shell",
        "status": status,
        "exitCode": if status == "succeeded" { json!(0) } else { Value::Null },
        "durationSeconds": 1,
        "attempts": 1,
        "outputPath": format!(".mentu/runs/run_row_1/{label}.stdout"),
        "errorPath": format!(".mentu/runs/run_row_1/{label}.stderr"),
    })
}

fn mentu_status_envelope(id: &str) -> Value {
    ok_envelope(
        id,
        json!({
            "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
            "capabilities": ["workspace.v1", "mentu.v1"],
            "version": "0.1.0",
        }),
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn run_resolves_the_pending_approval_and_starts_the_daemon_run() {
    let behavior: Behavior = Arc::new(|request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(mentu_status_envelope(&id)),
            Some("mentu.pending_approval") => {
                Action::Respond(ok_envelope(&id, json!({ "approval": approval() })))
            }
            Some("mentu.run") => {
                assert_eq!(request["params"]["approvalId"], APPROVAL_ID);
                Action::Respond(ok_envelope(
                    &id,
                    json!({ "run": run_payload("running", None, json!([])) }),
                ))
            }
            _ => Action::Respond(error_envelope(&id, "method_not_found", "no such method")),
        }
    });
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("data");
    let service = MockService::start(&data_dir, behavior);
    let output = common::run_cli(
        &service.data_dir,
        &[
            "--json",
            "mentu",
            "run",
            "--workspace",
            "ws-1",
            "--recipe",
            "hello",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(envelope["result"]["run"]["id"], "run-row-1");
    assert_eq!(envelope["result"]["run"]["status"], "running");

    let methods: Vec<String> = service
        .captured()
        .into_iter()
        .filter_map(|request| request["method"].as_str().map(str::to_string))
        .collect();
    assert!(methods.contains(&"mentu.pending_approval".to_string()));
    assert!(methods.contains(&"mentu.run".to_string()));

    // Human form names the daemon run id, the handle for follow/cancel.
    let output = common::run_cli(
        &service.data_dir,
        &["mentu", "run", "--workspace", "ws-1", "--recipe", "hello"],
    );
    assert!(
        stdout(&output).contains("Started Mentu run run-row-1"),
        "stdout: {}",
        stdout(&output)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn run_refuses_without_an_approval_and_never_calls_mentu_run() {
    let behavior: Behavior = Arc::new(|request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(mentu_status_envelope(&id)),
            Some("mentu.pending_approval") => {
                Action::Respond(ok_envelope(&id, json!({ "approval": Value::Null })))
            }
            Some("mentu.run") => Action::Respond(error_envelope(
                &id,
                "invalid_argument",
                "the CLI should have refused before calling mentu.run",
            )),
            _ => Action::Respond(error_envelope(&id, "method_not_found", "no such method")),
        }
    });
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("data");
    let service = MockService::start(&data_dir, behavior);
    let output = common::run_cli(
        &service.data_dir,
        &[
            "--json",
            "mentu",
            "run",
            "--workspace",
            "ws-1",
            "--recipe",
            "hello",
        ],
    );
    assert_eq!(output.status.code(), Some(1), "stdout: {}", stdout(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON failure envelope");
    assert_eq!(envelope["ok"], false);
    assert_eq!(envelope["error"]["code"], "mentu_approval_required");
    assert!(
        envelope["error"]["message"]
            .as_str()
            .unwrap()
            .contains("never approves"),
        "{envelope:?}"
    );
    assert!(
        service
            .captured()
            .iter()
            .all(|request| request["method"] != "mentu.run"),
        "an unapproved recipe must not reach mentu.run"
    );

    // Human form prints the refusal code on stderr and exits 1.
    let output = common::run_cli(
        &service.data_dir,
        &["mentu", "run", "--workspace", "ws-1", "--recipe", "hello"],
    );
    assert_eq!(output.status.code(), Some(1));
    assert!(
        stderr(&output).contains("mentu_approval_required"),
        "stderr: {}",
        stderr(&output)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn explicit_approval_skips_the_pending_lookup_and_unknown_recipe_surfaces() {
    let behavior: Behavior = Arc::new(|request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(mentu_status_envelope(&id)),
            Some("mentu.pending_approval") => Action::Respond(error_envelope(
                &id,
                "invalid_argument",
                "an explicit --approval must skip the lookup",
            )),
            Some("mentu.run") => {
                Action::Respond(error_envelope(&id, "not_found", "Mentu recipe not found."))
            }
            _ => Action::Respond(error_envelope(&id, "method_not_found", "no such method")),
        }
    });
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("data");
    let service = MockService::start(&data_dir, behavior);
    let output = common::run_cli(
        &service.data_dir,
        &[
            "--json",
            "mentu",
            "run",
            "--workspace",
            "ws-1",
            "--recipe",
            "missing",
            "--approval",
            APPROVAL_ID,
        ],
    );
    assert_eq!(output.status.code(), Some(1), "stdout: {}", stdout(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON failure envelope");
    assert_eq!(envelope["error"]["code"], "not_found");
    let methods: Vec<String> = service
        .captured()
        .into_iter()
        .filter_map(|request| request["method"].as_str().map(str::to_string))
        .collect();
    assert!(!methods.contains(&"mentu.pending_approval".to_string()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn run_without_the_capability_refuses_before_any_mentu_call() {
    let behavior: Behavior = Arc::new(|request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(ok_envelope(
                &id,
                json!({
                    "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
                    "capabilities": ["workspace.v1"],
                    "version": "0.1.0",
                }),
            )),
            _ => Action::Respond(error_envelope(&id, "method_not_found", "no such method")),
        }
    });
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("data");
    let service = MockService::start(&data_dir, behavior);
    let output = common::run_cli(
        &service.data_dir,
        &["mentu", "run", "--workspace", "ws-1", "--recipe", "hello"],
    );
    assert_eq!(output.status.code(), Some(1), "stdout: {}", stdout(&output));
    assert!(
        stderr(&output).contains("mentu.v1"),
        "stderr: {}",
        stderr(&output)
    );
    assert!(
        service
            .captured()
            .iter()
            .all(|request| request["method"] != "mentu.pending_approval"),
        "no Mentu call without the capability"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn follow_polls_the_daemon_run_to_a_truthful_exit_code() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let polls = Arc::new(AtomicUsize::new(0));
    let polls_for_behavior = Arc::clone(&polls);
    let behavior: Behavior = Arc::new(move |request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(mentu_status_envelope(&id)),
            Some("mentu.pending_approval") => {
                Action::Respond(ok_envelope(&id, json!({ "approval": approval() })))
            }
            Some("mentu.run") => Action::Respond(ok_envelope(
                &id,
                json!({ "run": run_payload("running", None, json!([])) }),
            )),
            Some("mentu.run_status") => {
                let seen = polls_for_behavior.fetch_add(1, Ordering::SeqCst);
                if seen == 0 {
                    Action::Respond(ok_envelope(
                        &id,
                        json!({ "run": run_payload("running", None, json!([step_payload("build", "succeeded")])) }),
                    ))
                } else {
                    Action::Respond(ok_envelope(
                        &id,
                        json!({ "run": run_payload("succeeded", Some("2026-09-07T00:00:02Z"), json!([step_payload("build", "succeeded")])) }),
                    ))
                }
            }
            _ => Action::Respond(error_envelope(&id, "method_not_found", "no such method")),
        }
    });
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("data");
    let service = MockService::start(&data_dir, behavior);
    let output = common::run_cli(
        &service.data_dir,
        &[
            "--json",
            "mentu",
            "run",
            "--workspace",
            "ws-1",
            "--recipe",
            "hello",
            "--follow",
            "--timeout-ms",
            "10000",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    // JSON mode prints the LAST observed run, not the stale starting row.
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(envelope["result"]["run"]["status"], "succeeded");
    assert_eq!(envelope["result"]["run"]["steps"][0]["label"], "build");
    assert!(polls.load(Ordering::SeqCst) >= 1);

    // Human mode reports the movement and the final per-step lines.
    let output = common::run_cli(
        &service.data_dir,
        &[
            "mentu",
            "run",
            "--workspace",
            "ws-1",
            "--recipe",
            "hello",
            "--follow",
            "--timeout-ms",
            "10000",
        ],
    );
    let text = stdout(&output);
    assert!(text.contains("running"), "stdout: {text}");
    assert!(text.contains("succeeded"), "stdout: {text}");
    assert!(text.contains("build [shell] succeeded"), "stdout: {text}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn follow_reports_a_failed_run_as_exit_one_with_the_failing_step() {
    let behavior: Behavior = Arc::new(|request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(mentu_status_envelope(&id)),
            Some("mentu.run") => Action::Respond(ok_envelope(
                &id,
                json!({ "run": run_payload("running", None, json!([])) }),
            )),
            Some("mentu.run_status") => {
                let mut step = step_payload("build", "failed");
                step["exitCode"] = json!(2);
                step["error"] = json!("step exited with code 2");
                Action::Respond(ok_envelope(
                    &id,
                    json!({ "run": run_payload("failed", Some("2026-09-07T00:00:02Z"), json!([step])) }),
                ))
            }
            _ => Action::Respond(error_envelope(&id, "method_not_found", "no such method")),
        }
    });
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("data");
    let service = MockService::start(&data_dir, behavior);
    let output = common::run_cli(
        &service.data_dir,
        &[
            "mentu",
            "run",
            "--workspace",
            "ws-1",
            "--recipe",
            "hello",
            "--approval",
            APPROVAL_ID,
            "--follow",
            "--timeout-ms",
            "10000",
        ],
    );
    assert_eq!(output.status.code(), Some(1), "stdout: {}", stdout(&output));
    let text = stdout(&output);
    assert!(
        text.contains("build [shell] failed exit 2"),
        "stdout: {text}"
    );
    assert!(
        stderr(&output).contains("finished as failed"),
        "stderr: {}",
        stderr(&output)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn follow_times_out_honestly_when_the_run_never_settles() {
    let behavior: Behavior = Arc::new(|request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(mentu_status_envelope(&id)),
            Some("mentu.run") => Action::Respond(ok_envelope(
                &id,
                json!({ "run": run_payload("running", None, json!([])) }),
            )),
            Some("mentu.run_status") => Action::Respond(ok_envelope(
                &id,
                json!({ "run": run_payload("running", None, json!([])) }),
            )),
            _ => Action::Respond(error_envelope(&id, "method_not_found", "no such method")),
        }
    });
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("data");
    let service = MockService::start(&data_dir, behavior);
    let output = common::run_cli(
        &service.data_dir,
        &[
            "--json",
            "mentu",
            "run",
            "--workspace",
            "ws-1",
            "--recipe",
            "hello",
            "--approval",
            APPROVAL_ID,
            "--follow",
            "--timeout-ms",
            "1000",
        ],
    );
    assert_eq!(output.status.code(), Some(1), "stdout: {}", stdout(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON failure envelope");
    assert_eq!(envelope["error"]["code"], "timeout");
    assert!(
        envelope["error"]["message"]
            .as_str()
            .unwrap()
            .contains("last observed status running"),
        "{envelope:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn run_status_and_runs_and_cancel_render_both_modes() {
    let behavior: Behavior = Arc::new(|request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(mentu_status_envelope(&id)),
            Some("mentu.run_status") => Action::Respond(ok_envelope(
                &id,
                json!({ "run": run_payload("failed", Some("2026-09-07T00:00:02Z"), json!([step_payload("build", "failed")])) }),
            )),
            Some("mentu.runs") => Action::Respond(ok_envelope(
                &id,
                json!({ "runs": [
                    run_payload("failed", Some("2026-09-07T00:00:02Z"), json!([step_payload("build", "failed")])),
                    run_payload("running", None, json!([])),
                ] }),
            )),
            Some("mentu.cancel") => Action::Respond(ok_envelope(
                &id,
                json!({ "run": run_payload("running", None, json!([])) }),
            )),
            _ => Action::Respond(error_envelope(&id, "method_not_found", "no such method")),
        }
    });
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("data");
    let service = MockService::start(&data_dir, behavior);

    let output = common::run_cli(
        &service.data_dir,
        &["mentu", "run-status", "--run", "run-row-1"],
    );
    assert_eq!(output.status.code(), Some(1), "stdout: {}", stdout(&output));
    assert!(
        stdout(&output).contains("recipe hello status failed"),
        "stdout: {}",
        stdout(&output)
    );

    let output = common::run_cli(&service.data_dir, &["mentu", "runs", "--workspace", "ws-1"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    assert_eq!(
        stdout(&output).lines().count(),
        2,
        "stdout: {}",
        stdout(&output)
    );

    let output = common::run_cli(
        &service.data_dir,
        &["mentu", "runs", "--workspace", "ws-1", "--json"],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(envelope["result"]["runs"].as_array().unwrap().len(), 2);

    let output = common::run_cli(
        &service.data_dir,
        &["mentu", "cancel", "--run", "run-row-1"],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    assert!(
        stdout(&output).contains("Cancellation requested"),
        "stdout: {}",
        stdout(&output)
    );
    let cancel = service
        .captured()
        .into_iter()
        .find(|request| request["method"] == "mentu.cancel")
        .expect("mock saw mentu.cancel");
    assert_eq!(cancel["params"]["runId"], "run-row-1");
}
