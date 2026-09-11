//! `drogon-cli bot watch-pr`: the user-lane pull-request watch verb. The CLI
//! is a thin client of the daemon's one watch path, so these tests pin the
//! exact RPC method and params the verb sends (the USER lane's own spellings:
//! `kind`, `repo`, `filter`, `login`, `apiBase`, `secretRefs`, `harness`,
//! `skills`, `cron` — never the self lane's `trigger` object), the two-call
//! flow of `--approve`, and the parked default.

#![cfg(unix)]

mod common;

use common::{Action, Behavior, MockService, error_envelope, ok_envelope, stderr, stdout};
use serde_json::{Value, json};
use std::sync::Arc;

fn behavior() -> Behavior {
    Arc::new(|request| {
        let id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(ok_envelope(
                &id,
                json!({
                    "hostId": "host-1",
                    "serviceInstanceId": "svc-1",
                    "protocol": 1,
                    "capabilities": ["bot.self.v1"],
                    "version": "0.1.0"
                }),
            )),
            Some("bot.monitor_create") => Action::Respond(ok_envelope(
                &id,
                json!({
                    "monitorId": "mon-1",
                    "botId": "bot-1",
                    "ruleKind": "github_pr.v1",
                    "approvalHash": "a".repeat(64),
                    "approved": false,
                    "trigger": {"kind": "scheduled", "cron": "* * * * *"},
                    "responsibilityId": "resp-1",
                }),
            )),
            Some("bot.monitor_approve") => Action::Respond(ok_envelope(
                &id,
                json!({"monitorId": "mon-1", "approved": true, "approvalHash": "a".repeat(64)}),
            )),
            _ => Action::Respond(error_envelope(
                &id,
                "method_not_found",
                "mock does not implement this method",
            )),
        }
    })
}

fn create_params(captured: &[Value]) -> Value {
    captured
        .iter()
        .find(|request| request["method"] == "bot.monitor_create")
        .map(|request| request["params"].clone())
        .expect("the verb called bot.monitor_create")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn watch_pr_sends_the_user_lane_watch_shape() {
    let dir = tempfile::tempdir().expect("tempdir");
    let service = MockService::start(dir.path(), behavior());
    let output = common::run_cli(
        dir.path(),
        &[
            "bot",
            "watch-pr",
            "--bot",
            "bot-1",
            "--workspace",
            "ws-1",
            "--repo",
            "clioo/drogon",
            "--filter",
            "review_requested",
            "--login",
            "clioo",
            "--harness",
            "codex",
            "--skill",
            "drogon-cli",
            "--skill",
            "frontend-review",
            "--secret-ref",
            "GITHUB_TOKEN_REF",
            "--api-base",
            "https://ghe.example.com",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let params = create_params(&service.captured());
    assert_eq!(params["kind"], "github_pr.v1");
    assert_eq!(params["botId"], "bot-1");
    assert_eq!(params["workspaceId"], "ws-1");
    assert_eq!(params["hostId"], "host-1");
    assert_eq!(params["repo"], "clioo/drogon");
    assert_eq!(params["filter"], "review_requested");
    assert_eq!(params["login"], "clioo");
    assert_eq!(params["harness"], "codex");
    assert_eq!(params["skills"], json!(["drogon-cli", "frontend-review"]));
    assert_eq!(params["secretRefs"], json!(["GITHUB_TOKEN_REF"]));
    assert_eq!(params["apiBase"], "https://ghe.example.com");
    // The cadence is the user lane's own spelling, and never the self lane's
    // `trigger` object (which the daemon refuses by name).
    assert_eq!(params["cron"], "* * * * *");
    assert!(params.get("trigger").is_none(), "{params}");
    // Without --approve the watch stays parked: no approve call was made.
    assert!(
        !service
            .captured()
            .iter()
            .any(|request| request["method"] == "bot.monitor_approve"),
        "no approval without --approve"
    );
    // The human line says what happened and how to arm it.
    let text = stdout(&output);
    assert!(text.contains("mon-1"), "{text}");
    assert!(text.contains("needs-approval"), "{text}");
    assert!(text.contains("bot.monitor_approve"), "{text}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn watch_pr_approve_flag_arms_the_exact_rule_hash() {
    let dir = tempfile::tempdir().expect("tempdir");
    let service = MockService::start(dir.path(), behavior());
    let output = common::run_cli(
        dir.path(),
        &[
            "bot",
            "watch-pr",
            "--bot",
            "bot-1",
            "--workspace",
            "ws-1",
            "--repo",
            "clioo/drogon",
            "--filter",
            "assigned",
            "--login",
            "clioo",
            "--manual",
            "--approve",
            "--responsibility-name",
            "Review assigned pull requests",
            "--instructions",
            "Read the diff and report.",
            "--json",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let captured = service.captured();
    let params = create_params(&captured);
    assert_eq!(params["manual"], json!(true));
    assert!(params.get("cron").is_none(), "{params}");
    assert_eq!(
        params["responsibilityName"],
        "Review assigned pull requests"
    );
    assert_eq!(params["instructions"], "Read the diff and report.");
    let approve = captured
        .iter()
        .find(|request| request["method"] == "bot.monitor_approve")
        .expect("--approve calls bot.monitor_approve");
    assert_eq!(approve["params"]["monitorId"], "mon-1");
    assert_eq!(approve["params"]["botId"], "bot-1");
    // Its own request id: the ledger dedupes on (requestId, method, params),
    // so reusing the create call's id would replay the create answer instead
    // of arming the watch.
    let create_id = captured
        .iter()
        .find(|request| request["method"] == "bot.monitor_create")
        .unwrap()["requestId"]
        .clone();
    assert_ne!(approve["requestId"], create_id);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn watch_pr_refuses_bad_flags_before_any_rpc() {
    let dir = tempfile::tempdir().expect("tempdir");
    let service = MockService::start(dir.path(), behavior());
    for (label, args) in [
        (
            "assigned without a login",
            vec![
                "bot",
                "watch-pr",
                "--bot",
                "bot-1",
                "--workspace",
                "ws-1",
                "--repo",
                "clioo/drogon",
                "--filter",
                "assigned",
            ],
        ),
        (
            "unknown filter",
            vec![
                "bot",
                "watch-pr",
                "--bot",
                "bot-1",
                "--workspace",
                "ws-1",
                "--repo",
                "clioo/drogon",
                "--filter",
                "mine",
            ],
        ),
        (
            "manual with a cron",
            vec![
                "bot",
                "watch-pr",
                "--bot",
                "bot-1",
                "--workspace",
                "ws-1",
                "--repo",
                "clioo/drogon",
                "--manual",
                "--cron",
                "* * * * *",
            ],
        ),
        (
            "api-base that is not http(s)",
            vec![
                "bot",
                "watch-pr",
                "--bot",
                "bot-1",
                "--workspace",
                "ws-1",
                "--repo",
                "clioo/drogon",
                "--api-base",
                "file:///etc/passwd",
            ],
        ),
    ] {
        let output = common::run_cli(dir.path(), &args);
        assert_eq!(output.status.code(), Some(2), "{label}: {output:?}");
        assert!(
            stderr(&output).contains("error"),
            "{label}: {}",
            stderr(&output)
        );
    }
    assert!(
        service.captured().is_empty(),
        "a refused invocation never reaches the daemon"
    );
}
