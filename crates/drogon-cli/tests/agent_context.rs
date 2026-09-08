//! `agent-context` and `project remove`: the local machine-readable schema
//! plus the registration-removal verb, through the real binary against a
//! mock native protocol-v1 service.

#![cfg(unix)]

mod common;

use common::{Behavior, MockService, error_envelope, ok_envelope, stderr, stdout};
use serde_json::{Value, json};
use std::sync::Arc;

fn behavior() -> Behavior {
    Arc::new(|request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => common::Action::Respond(ok_envelope(
                &id,
                json!({
                    "hostId": "host-1", "serviceInstanceId": "svc-1", "protocol": 1,
                    "capabilities": ["workspace.v1", "session.pty.v1", "project.v1"],
                    "version": "0.1.0",
                }),
            )),
            Some("project.remove") => {
                let want = request["params"]["id"].as_str().unwrap_or("");
                if want == "proj-1" {
                    common::Action::Respond(ok_envelope(
                        &id,
                        json!({"id": "proj-1", "removed": true}),
                    ))
                } else {
                    common::Action::Respond(error_envelope(&id, "not_found", "project not found"))
                }
            }
            _ => common::Action::Respond(error_envelope(&id, "method_not_found", "no such method")),
        }
    })
}

fn mock() -> (tempfile::TempDir, MockService) {
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("data");
    let service = MockService::start(&data_dir, behavior());
    (dir, service)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn project_remove_calls_daemon_and_renders_both_modes() {
    let (_hold, service) = mock();
    let output = common::run_cli(&service.data_dir, &["project", "remove", "proj-1"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let text = stdout(&output);
    assert!(text.contains("Removed project proj-1."), "stdout: {text}");

    let output = common::run_cli(
        &service.data_dir,
        &["--json", "project", "remove", "proj-1"],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(envelope["ok"], true);
    assert_eq!(envelope["result"]["id"], "proj-1");
    assert_eq!(envelope["result"]["removed"], true);

    // The daemon saw the exact param shape, not the CLI's positional form.
    let seen = service.captured();
    let call = seen
        .iter()
        .find(|request| request["method"] == "project.remove")
        .expect("mock saw project.remove");
    assert_eq!(call["params"]["id"], "proj-1");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn project_remove_unknown_id_is_a_typed_failure_envelope() {
    let (_hold, service) = mock();
    let output = common::run_cli(
        &service.data_dir,
        &["--json", "project", "remove", "proj-missing"],
    );
    assert_eq!(output.status.code(), Some(1), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON envelope");
    assert_eq!(envelope["ok"], false);
    assert_eq!(envelope["error"]["code"], "not_found");

    // Human mode keeps stdout untouched and reports code + message on stderr.
    let output = common::run_cli(&service.data_dir, &["project", "remove", "proj-missing"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(stdout(&output).is_empty(), "failures never emit stdout");
    assert!(
        stderr(&output).contains("not_found"),
        "stderr: {}",
        stderr(&output)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn project_remove_empty_id_is_a_usage_error() {
    let (_hold, service) = mock();
    let output = common::run_cli(&service.data_dir, &["project", "remove", ""]);
    assert_eq!(output.status.code(), Some(2));
    assert!(stdout(&output).is_empty(), "usage errors never emit stdout");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn agent_context_schema_shape_matches_the_fork_contract() {
    let (_hold, service) = mock();
    let output = common::run_cli(&service.data_dir, &["--json", "agent-context"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let schema: Value = serde_json::from_str(&stdout(&output)).expect("JSON schema");
    // Same top-level shape as the fork's `agent-context --json`.
    assert_eq!(schema["schemaVersion"], 1);
    let commands = schema["commands"].as_array().expect("commands array");
    assert_eq!(schema["commandCount"], commands.len() as u64);
    assert!(
        commands.len() >= 50,
        "whole surface, got {}",
        commands.len()
    );
    let mut names: Vec<&str> = commands
        .iter()
        .map(|entry| entry["command"].as_str().expect("command string"))
        .collect();
    let mut sorted = names.clone();
    sorted.sort_unstable();
    assert_eq!(names, sorted, "commands sort by name");
    for entry in commands {
        for key in [
            "command",
            "path",
            "aliases",
            "argumentMode",
            "summary",
            "usage",
            "flags",
            "positionalArgs",
            "examples",
            "notes",
        ] {
            assert!(entry.get(key).is_some(), "entry is missing {key}");
        }
    }
    names.sort_unstable();
    for verb in [
        "agent-context",
        "project remove",
        "terminal wait",
        "worktree create",
        "browser open",
        "skills get",
        "orchestration ask",
        "internal hook-event",
    ] {
        assert!(names.contains(&verb), "schema is missing {verb:?}");
    }
    // The fork spellings are discoverable in the wait entry.
    let wait = commands
        .iter()
        .find(|entry| entry["command"] == "terminal wait")
        .expect("terminal wait entry");
    let notes = wait["notes"].as_array().expect("wait notes");
    assert!(
        notes
            .iter()
            .any(|note| note.as_str().is_some_and(|text| text.contains("tui-idle"))),
        "wait entry must document tui-idle"
    );
}

/// `agent-context` is a pure local read like the fork's: this data
/// directory was never given a socket or token, and both modes exit 0.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn agent_context_works_with_no_daemon_at_all() {
    let dir = tempfile::tempdir().expect("tempdir");
    let data_dir = dir.path().join("no-daemon");
    let output = common::run_cli(&data_dir, &["agent-context"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let text = stdout(&output);
    assert!(text.contains("commands (schema v1)"), "stdout: {text}");
    assert!(text.contains("agent-context --json"), "stdout: {text}");

    let output = common::run_cli(&data_dir, &["agent-context", "--json"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let schema: Value = serde_json::from_str(&stdout(&output)).expect("JSON schema");
    assert_eq!(schema["schemaVersion"], 1);
}
