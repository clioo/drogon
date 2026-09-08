//! Jira issue search against the fake Jira server (R17-A): filter JQL
//! verbatim from the fork, screenshot-shape mapping, paging, the fork's
//! error taxonomy, cancellation, and the Server/DC v2 search fallback.

#[path = "jira_support.rs"]
mod support;

use serde_json::json;

use support::{FixtureServer, TestContext};

#[test]
fn assigned_tab_sends_the_forks_jql_and_maps_issues() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let result = ctx.ok("jira.listIssues", json!({"filter": "assigned"}));
    let sent = server.last_search_request();
    assert_eq!(
        sent["jql"],
        "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC"
    );
    // List fields exclude description (the fork's hot-path carve-out).
    let fields = sent["fields"].as_array().unwrap();
    assert!(!fields.iter().any(|field| field == "description"));
    assert!(fields.iter().any(|field| field == "updated"));
    assert_eq!(sent["path"], "/rest/api/3/search/jql");

    let issues = result["issues"].as_array().unwrap();
    assert!(!issues.is_empty());
    for issue in issues {
        // Everything the Tasks list renders is present.
        assert!(!issue["key"].as_str().unwrap().is_empty());
        assert!(!issue["title"].as_str().unwrap().is_empty());
        assert!(
            issue["url"]
                .as_str()
                .unwrap()
                .starts_with(&format!("{}/browse/", server.site_url()))
        );
        assert!(issue["status"]["name"].is_string());
        assert!(issue["status"]["categoryKey"].is_string());
        assert!(issue["project"]["key"].is_string());
        assert!(issue["issueType"]["name"].is_string());
        assert!(
            issue["updatedAt"].as_str().unwrap().ends_with("+0000")
                || issue["updatedAt"].as_str().unwrap().ends_with('Z')
        );
        assert_eq!(issue["siteId"], result["issues"][0]["siteId"]);
    }
}

#[test]
fn reported_all_open_and_done_tabs_send_their_fork_jql() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    ctx.ok("jira.listIssues", json!({"filter": "reported"}));
    assert_eq!(
        server.last_search_request()["jql"],
        "reporter = currentUser() AND resolution = Unresolved ORDER BY updated DESC"
    );
    let all_open = ctx.ok("jira.listIssues", json!({"filter": "all"}));
    assert_eq!(
        server.last_search_request()["jql"],
        "resolution = Unresolved ORDER BY updated DESC"
    );
    let done = ctx.ok("jira.listIssues", json!({"filter": "done"}));
    assert_eq!(
        server.last_search_request()["jql"],
        "assignee = currentUser() AND resolution IS NOT EMPTY ORDER BY updated DESC"
    );
    // 17 unresolved issues in the fixture; only the two Done rows drop out.
    assert_eq!(all_open["total"], 17);
    assert_eq!(all_open["issues"].as_array().unwrap().len(), 17);
    assert_eq!(all_open["isLast"], true);
    assert_eq!(done["total"], 2);
}

#[test]
fn screenshot_shape_backlog_grouping_and_missing_fields() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let result = ctx.ok("jira.listIssues", json!({"filter": "all", "limit": 100}));
    let issues = result["issues"].as_array().unwrap();
    assert_eq!(issues.len(), 17);

    // The screenshot's grouping column: 13 issues sit in "Backlog".
    let backlog = issues
        .iter()
        .filter(|issue| issue["status"]["name"] == "Backlog")
        .count();
    assert_eq!(backlog, 13, "fixture must reproduce Backlog 13");

    // Project tag chips: DROG rows carry the project key/name for chips.
    let drog: Vec<_> = issues
        .iter()
        .filter(|issue| issue["project"]["key"] == "DROG")
        .collect();
    assert_eq!(drog.len(), 14);
    assert!(
        drog.iter()
            .all(|issue| issue["project"]["name"] == "Drogon")
    );

    // Priorities: High and Medium rows carry names; "Not Set" rows carry
    // no priority at all (never a fabricated empty object).
    let high = issues
        .iter()
        .filter(|issue| issue["priority"]["name"] == "High")
        .count();
    let medium = issues
        .iter()
        .filter(|issue| issue["priority"]["name"] == "Medium")
        .count();
    assert!(high >= 4, "expected several High rows, got {high}");
    assert!(medium >= 3, "expected several Medium rows, got {medium}");
    let not_set = issues
        .iter()
        .filter(|issue| issue.get("priority").is_none());
    assert!(
        not_set.count() >= 3,
        "fixture must include rows with no priority (Not Set)"
    );

    // Unassigned rows carry no assignee (never a fabricated Unknown user).
    let unassigned = issues
        .iter()
        .filter(|issue| issue.get("assignee").is_none())
        .count();
    assert!(unassigned >= 2);

    // Status categories drive the tone: Backlog is "new", In Review is
    // "indeterminate", Done is "done".
    let done = ctx.ok("jira.listIssues", json!({"filter": "done"}));
    let done_row = done["issues"]
        .as_array()
        .unwrap()
        .iter()
        .find(|issue| issue["key"] == "WEB-1")
        .expect("WEB-1");
    assert_eq!(done_row["status"]["categoryKey"], "done");
    let review_row = issues
        .iter()
        .find(|issue| issue["key"] == "ORCA-2")
        .expect("ORCA-2");
    assert_eq!(review_row["status"]["categoryKey"], "indeterminate");
}

#[test]
fn user_typed_jql_replaces_the_tab_and_paging_reports_total_and_is_last() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    // Typed JQL goes through verbatim (the tab composition is the
    // renderer's job; the daemon passes JQL through untouched).
    let page1 = ctx.ok(
        "jira.searchIssues",
        json!({"jql": "project = DROG", "startAt": 8, "limit": 5}),
    );
    assert_eq!(server.last_search_request()["jql"], "project = DROG");
    let issues1 = page1["issues"].as_array().unwrap();
    assert_eq!(issues1.len(), 5);
    assert_eq!(page1["total"], 14);
    assert_eq!(page1["isLast"], false);
    assert!(
        issues1
            .iter()
            .all(|issue| issue["project"]["key"] == "DROG")
    );

    let page2 = ctx.ok(
        "jira.searchIssues",
        json!({"jql": "project = DROG", "startAt": 13, "limit": 5}),
    );
    assert_eq!(page2["issues"].as_array().unwrap().len(), 1);
    assert_eq!(page2["isLast"], true);
}

#[test]
fn limit_is_clamped_to_the_forks_bounds() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    ctx.ok("jira.listIssues", json!({"filter": "all", "limit": 500}));
    assert_eq!(server.last_search_request()["maxResults"], 100);
    ctx.ok("jira.listIssues", json!({"filter": "all", "limit": 0}));
    assert_eq!(server.last_search_request()["maxResults"], 1);
}

#[test]
fn rate_limit_maps_to_a_retryable_error_with_retry_after() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let error = ctx.err(
        "jira.searchIssues",
        json!({"jql": "project = DROG AND JQL_RATE_LIMIT"}),
    );
    assert_eq!(error.code, "jira_rate_limited");
    assert!(error.retryable, "429 must be retryable");
    assert!(error.message.contains("Rate limit exceeded"));
    assert!(error.message.contains("retry after 7s"));
}

#[test]
fn bad_jql_and_missing_issue_map_to_honest_errors() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let bad = ctx.err("jira.searchIssues", json!({"jql": "JQL_BAD"}));
    assert_eq!(bad.code, "jira_bad_request");
    assert!(bad.message.contains("does not exist"));
    let missing = ctx.err("jira.searchIssues", json!({"jql": "JQL_NOT_FOUND"}));
    assert_eq!(missing.code, "jira_not_found");
}

#[test]
fn search_without_a_site_returns_an_empty_result_not_a_lie() {
    let ctx = TestContext::open();
    let result = ctx.ok("jira.listIssues", json!({}));
    assert_eq!(result["issues"].as_array().unwrap().len(), 0);
}

#[test]
fn server_sites_search_through_the_classic_v2_endpoint() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.ok(
        "jira.connect",
        json!({
            "siteUrl": server.site_url(),
            "email": "",
            "apiToken": "fixture-token",
            "authType": "server",
        }),
    );
    ctx.ok("jira.listIssues", json!({"filter": "all"}));
    assert_eq!(server.last_search_request()["path"], "/rest/api/2/search");
    // Server/DC /project is the plain array resource.
    let projects = ctx.ok("jira.listProjects", json!({}));
    assert_eq!(projects.as_array().unwrap().len(), 5);
}

#[test]
fn a_superseding_search_with_the_same_request_id_cancels_the_previous_one() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let slow = std::thread::scope(|scope| {
        let slow_handle = scope.spawn(|| {
            ctx.call(
                "jira.searchIssues",
                json!({"jql": "JQL_SLOW", "requestId": "dup"}),
            )
        });
        // Give the slow search a moment to register, then re-use its id:
        // the renderer cancels a search when the query changes.
        std::thread::sleep(std::time::Duration::from_millis(400));
        let fast = ctx.ok(
            "jira.searchIssues",
            json!({"jql": "project = DROG", "requestId": "dup"}),
        );
        assert_eq!(fast["total"], 14);
        slow_handle.join().expect("slow search thread")
    });
    assert!(!slow.ok, "the superseded search must not succeed");
    assert_eq!(slow.error.expect("cancelled error").code, "jira_cancelled");
}

#[test]
fn cancel_search_issues_kills_an_in_flight_search() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let slow = std::thread::scope(|scope| {
        let slow_handle = scope.spawn(|| {
            ctx.call(
                "jira.searchIssues",
                json!({"jql": "JQL_SLOW", "requestId": "cancel-me"}),
            )
        });
        std::thread::sleep(std::time::Duration::from_millis(400));
        let cancelled = ctx.ok("jira.cancelSearchIssues", json!({"requestId": "cancel-me"}));
        assert_eq!(cancelled["cancelled"], true);
        slow_handle.join().expect("slow search thread")
    });
    assert!(!slow.ok);
    assert_eq!(slow.error.expect("cancelled error").code, "jira_cancelled");
    // Cancelling an id nobody owns is a quiet false, never an error.
    let unknown = ctx.ok("jira.cancelSearchIssues", json!({"requestId": "nobody"}));
    assert_eq!(unknown["cancelled"], false);
}
