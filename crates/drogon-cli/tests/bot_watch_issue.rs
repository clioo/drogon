//! `drogon-cli bot watch-issue`: the user-lane ISSUE watch verb. The CLI is
//! a thin client of the daemon's one watch path, so these tests pin the
//! exact RPC method and params the verb sends (`kind: github_issue.v1` and
//! the USER lane's own spellings — never the self lane's `trigger` object),
//! the two-call flow of `--approve`, the parked default, and the one place
//! the issue verb deliberately differs from `watch-pr`: an issue has no
//! review request, so `--filter review_requested` is refused rather than
//! quietly forwarded to a daemon that would reject it.

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
                    "monitorId": "mon-9",
                    "botId": "bot-1",
                    "ruleKind": "github_issue.v1",
                    "approvalHash": "b".repeat(64),
                    "approved": false,
                    "trigger": {"kind": "scheduled", "cron": "* * * * *"},
                    "responsibilityId": "resp-9",
                }),
            )),
            Some("bot.monitor_approve") => Action::Respond(ok_envelope(
                &id,
                json!({"monitorId": "mon-9", "approved": true, "approvalHash": "b".repeat(64)}),
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
async fn watch_issue_sends_the_user_lane_issue_watch_shape() {
    let dir = tempfile::tempdir().expect("tempdir");
    let service = MockService::start(dir.path(), behavior());
    let output = common::run_cli(
        dir.path(),
        &[
            "bot",
            "watch-issue",
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
            "--harness",
            "codex",
            "--skill",
            "drogon-cli",
            "--secret-ref",
            "GITHUB_TOKEN_REF",
            "--api-base",
            "https://ghe.example.com",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let params = create_params(&service.captured());
    // The kind is what separates this verb from `watch-pr`; everything else
    // is the same user-lane shape on purpose.
    assert_eq!(params["kind"], "github_issue.v1");
    assert_eq!(params["botId"], "bot-1");
    assert_eq!(params["workspaceId"], "ws-1");
    assert_eq!(params["hostId"], "host-1");
    assert_eq!(params["repo"], "clioo/drogon");
    assert_eq!(params["filter"], "assigned");
    assert_eq!(params["login"], "clioo");
    assert_eq!(params["harness"], "codex");
    assert_eq!(params["skills"], json!(["drogon-cli"]));
    assert_eq!(params["secretRefs"], json!(["GITHUB_TOKEN_REF"]));
    assert_eq!(params["apiBase"], "https://ghe.example.com");
    assert_eq!(params["cron"], "* * * * *");
    assert!(params.get("trigger").is_none(), "{params}");
    assert!(
        !service
            .captured()
            .iter()
            .any(|request| request["method"] == "bot.monitor_approve"),
        "no approval without --approve"
    );
    let text = stdout(&output);
    assert!(text.contains("mon-9"), "{text}");
    assert!(text.contains("issue watch"), "{text}");
    assert!(text.contains("needs-approval"), "{text}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn watch_issue_defaults_to_the_whole_repository_and_can_arm_in_one_call() {
    let dir = tempfile::tempdir().expect("tempdir");
    let service = MockService::start(dir.path(), behavior());
    let output = common::run_cli(
        dir.path(),
        &[
            "bot",
            "watch-issue",
            "--bot",
            "bot-1",
            "--workspace",
            "ws-1",
            "--repo",
            "clioo/drogon",
            "--approve",
            "--responsibility-name",
            "Triage new issues",
            "--instructions",
            "Reproduce it, fix it, open a PR.",
            "--json",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let captured = service.captured();
    let params = create_params(&captured);
    // "watch this repo for new issues" needs no login: `opened` is the
    // default, and it compares against nothing.
    assert_eq!(params["filter"], "opened");
    assert!(params.get("login").is_none(), "{params}");
    assert_eq!(params["responsibilityName"], "Triage new issues");
    assert_eq!(params["instructions"], "Reproduce it, fix it, open a PR.");
    let approve = captured
        .iter()
        .find(|request| request["method"] == "bot.monitor_approve")
        .expect("--approve calls bot.monitor_approve");
    assert_eq!(approve["params"]["monitorId"], "mon-9");
    assert_eq!(approve["params"]["botId"], "bot-1");
    // Its own request id: the ledger dedupes on (requestId, method, params).
    let create_id = captured
        .iter()
        .find(|request| request["method"] == "bot.monitor_create")
        .unwrap()["requestId"]
        .clone();
    assert_ne!(approve["requestId"], create_id);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn watch_issue_refuses_bad_flags_before_any_rpc() {
    let dir = tempfile::tempdir().expect("tempdir");
    let service = MockService::start(dir.path(), behavior());
    for (label, args) in [
        (
            "assigned without a login",
            vec![
                "bot",
                "watch-issue",
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
            // An issue cannot request a review: the PR-only filter is
            // refused here rather than sent to the daemon.
            "review_requested is not an issue case",
            vec![
                "bot",
                "watch-issue",
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
            ],
        ),
        (
            "manual with a cron",
            vec![
                "bot",
                "watch-issue",
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
                "watch-issue",
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
