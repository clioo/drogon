//! Jira store resilience and picker queries (R17-A): missing/corrupt site
//! files, tampered tokens, per-site credential errors, multi-site fan-out
//! policy, projects paging and issue-create metadata.

#[path = "jira_support.rs"]
mod support;

use std::process::{Command, Stdio};

use serde_json::{Value, json};

use support::{FixtureServer, TestContext};

#[test]
fn status_survives_a_missing_or_corrupt_sites_file() {
    let ctx = TestContext::open();
    let status = ctx.ok("jira.status", json!({}));
    assert_eq!(status["connected"], false);
    assert_eq!(status["sites"].as_array().unwrap().len(), 0);

    let server = FixtureServer::new();
    ctx.connect(&server);
    std::fs::write(ctx.jira_dir().join("sites.json"), "{corrupt!").unwrap();
    let status = ctx.ok("jira.status", json!({}));
    assert_eq!(status["connected"], false, "corrupt file reads as empty");
}

#[test]
fn tampered_token_records_a_credential_error_status_can_explain() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let token_dir = ctx.jira_dir().join("tokens");
    let token_path = std::fs::read_dir(&token_dir)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let mut raw: Vec<u8> = std::fs::read(&token_path).unwrap();
    raw[10] ^= 0x01;
    std::fs::write(&token_path, raw).unwrap();

    // A read attempt records the per-site error (the fork's readToken is
    // what populates credentialErrors for getStatus to surface).
    let error = ctx.err("jira.listIssues", json!({}));
    assert_eq!(error.code, "jira_credential_error");

    // The fork's getStatus shape: the token file still exists, so the
    // connection still looks saved (connected) while credentialError
    // explains the read failure from the recorded per-site error — without
    // re-touching the store on every status poll.
    let status = ctx.ok("jira.status", json!({}));
    assert_eq!(status["connected"], true);
    let message = status["credentialError"]
        .as_str()
        .expect("credential error");
    assert!(message.contains("could not be decrypted"));
    assert_eq!(error.message, message);

    // Reconnecting stores a fresh token and clears the recorded error.
    ctx.connect(&server);
    let status = ctx.ok("jira.status", json!({}));
    assert_eq!(status["connected"], true);
    assert!(status.get("credentialError").is_none());
}

#[test]
fn all_fan_out_downgrades_a_dead_site_but_specific_selection_surfaces_it() {
    let good = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&good);
    // Second, distinct site identity on the same healthy fixture.
    ctx.ok(
        "jira.connect",
        json!({
            "siteUrl": good.site_url(),
            "email": "ana@example.com",
            "apiToken": "fixture-token",
        }),
    );
    let status = ctx.ok("jira.status", json!({}));
    assert_eq!(status["sites"].as_array().unwrap().len(), 2);

    // Point the second site at a dead port by editing the site file (the
    // store has no positive cache of it; the token cache still holds the
    // token, which is exactly the "site is down" shape).
    let mut file: Value =
        serde_json::from_str(&std::fs::read_to_string(ctx.jira_dir().join("sites.json")).unwrap())
            .unwrap();
    let second_id = status["sites"][1]["id"].clone();
    for site in file["sites"].as_array_mut().unwrap() {
        if site["id"] == second_id {
            site["siteUrl"] = json!("http://127.0.0.1:1");
        }
    }
    std::fs::write(
        ctx.jira_dir().join("sites.json"),
        serde_json::to_string_pretty(&file).unwrap(),
    )
    .unwrap();

    // 'all' selection: one healthy site carries the read; the dead site is
    // downgraded, not surfaced.
    let all = ctx.ok(
        "jira.searchIssues",
        json!({"jql": "project = DROG", "siteId": "all"}),
    );
    assert!(all["issues"].as_array().unwrap().len() >= 13);

    // Specific selection of the dead site: the error IS the answer.
    let error = ctx.err(
        "jira.searchIssues",
        json!({"jql": "project = DROG", "siteId": second_id}),
    );
    assert_eq!(error.code, "jira_unreachable");
    assert!(error.retryable);
}

#[test]
fn projects_page_through_project_search_and_sort_by_name() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let projects = ctx.ok("jira.listProjects", json!({}));
    let projects = projects.as_array().unwrap();
    assert_eq!(projects.len(), 5);
    let names: Vec<_> = projects
        .iter()
        .map(|project| project["name"].as_str().unwrap().to_string())
        .collect();
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(names, sorted, "locale-sorted by display name");
    assert!(projects.iter().all(|project| {
        project["id"].is_string() && project["key"].is_string() && project["name"].is_string()
    }));
}

#[test]
fn issue_types_and_create_fields_come_from_createmeta() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let issue_types = ctx.ok("jira.listIssueTypes", json!({"projectIdOrKey": "DROG"}));
    let issue_types = issue_types.as_array().unwrap();
    assert_eq!(issue_types.len(), 4);
    assert!(issue_types.iter().any(|kind| kind["name"] == "Task"));
    assert!(issue_types.iter().any(|kind| kind["subtask"] == true));

    let fields = ctx.ok(
        "jira.listCreateFields",
        json!({"projectIdOrKey": "DROG", "issueTypeId": "10001"}),
    );
    let fields = fields.as_array().unwrap();
    let summary = fields
        .iter()
        .find(|field| field["key"] == "summary")
        .expect("summary field");
    assert_eq!(summary["required"], true);
    assert_eq!(summary["schema"]["type"], "string");
    let assignee = fields
        .iter()
        .find(|field| field["key"] == "assignee")
        .expect("assignee field");
    let allowed = assignee["allowedValues"].as_array().unwrap();
    assert_eq!(allowed.len(), 2);
    assert!(allowed.iter().any(|user| user["name"] == "Carlos Fixture"));
    let team = fields
        .iter()
        .find(|field| field["key"] == "custom_10001")
        .expect("custom field keeps its key");
    assert_eq!(
        team["schema"]["custom"],
        "com.atlassian.jira.plugin.system.customfieldtypes:select"
    );
}

#[test]
fn priorities_and_user_search_round_out_the_pickers() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let priorities = ctx.ok("jira.listPriorities", json!({}));
    let names: Vec<_> = priorities
        .as_array()
        .unwrap()
        .iter()
        .map(|priority| priority["name"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(names, vec!["Highest", "High", "Medium", "Low"]);

    let users = ctx.ok("jira.searchUsers", json!({"query": "ana"}));
    let users = users.as_array().unwrap();
    assert_eq!(users.len(), 2, "the fixture returns its user list");
    assert!(users.iter().all(|user| user["accountId"].is_string()));
}

#[test]
fn search_hits_the_serialized_per_site_queue_without_deadlock() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    // Three sequential searches on one site: each completes, none parks
    // the queue (the queue is re-entrant across dispatches, never held
    // across RPCs).
    for _ in 0..3 {
        let result = ctx.ok("jira.listIssues", json!({"filter": "all"}));
        assert_eq!(result["total"], 17);
    }
}

// --- fixture self-check: it must boot, serve, and die with its guard ------

#[test]
fn fixture_server_lifecycle_is_clean() {
    let server = FixtureServer::new();
    let output = Command::new("curl")
        .args([
            "-sS",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            "-H",
            "Authorization: Bearer fixture-token",
            &format!("{}/rest/api/3/myself", server.site_url()),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .output()
        .expect("curl against fixture");
    assert_eq!(String::from_utf8(output.stdout).unwrap(), "200");
    // An unauthorized read gets the real 401 shape.
    let output = Command::new("curl")
        .args([
            "-sS",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            &format!("{}/rest/api/3/myself", server.site_url()),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .output()
        .expect("curl against fixture");
    assert_eq!(String::from_utf8(output.stdout).unwrap(), "401");
}
