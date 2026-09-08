//! Jira connect/disconnect/status lifecycle against the fake Jira server
//! (R17-A). See jira_support.rs for the no-real-site rule.

#[path = "jira_support.rs"]
mod support;

use serde_json::json;

use support::{FIXTURE_TOKEN, FixtureServer, TestContext};

#[test]
fn connect_validates_myself_and_persists_the_site() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    let connected = ctx.connect(&server);
    assert_eq!(connected["ok"], true);
    assert_eq!(connected["viewer"]["displayName"], "Carlos Fixture");
    assert_eq!(connected["viewer"]["accountId"], "fixture-user-1");

    let status = ctx.ok("jira.status", json!({}));
    assert_eq!(status["connected"], true);
    assert_eq!(status["viewer"]["displayName"], "Carlos Fixture");
    assert_eq!(status["sites"].as_array().unwrap().len(), 1);
    let site = &status["sites"][0];
    assert_eq!(site["siteUrl"], server.site_url());
    assert_eq!(site["email"], "carlos@example.com");
    assert_eq!(site["authType"], "cloud");
    assert_eq!(status["activeSiteId"], site["id"]);
    assert_eq!(status["selectedSiteId"], site["id"]);
    assert!(status.get("credentialError").is_none());

    // The store lives under the daemon data dir, never ~/.orca, and the
    // token is sealed at rest.
    assert!(ctx.jira_dir().join("sites.json").exists());
    assert!(support::token_files_sealed(&ctx.jira_dir()));
}

#[test]
fn connect_rejects_bad_credentials_and_stores_nothing() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    let error = ctx.err(
        "jira.connect",
        json!({
            "siteUrl": server.site_url(),
            "email": "carlos@example.com",
            "apiToken": "wrong-token",
        }),
    );
    assert_eq!(error.code, "jira_auth_required");
    let status = ctx.ok("jira.status", json!({}));
    assert_eq!(status["connected"], false);
    assert!(!ctx.jira_dir().join("sites.json").exists());
}

#[test]
fn connect_requires_email_and_token_for_cloud() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    let error = ctx.err(
        "jira.connect",
        json!({"siteUrl": server.site_url(), "email": "", "apiToken": FIXTURE_TOKEN}),
    );
    assert_eq!(error.code, "invalid_argument");
    assert_eq!(error.message, "Email and API token are required.");
}

#[test]
fn test_connection_revalidates_the_saved_credential() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let viewer = ctx.ok("jira.testConnection", json!({}));
    assert_eq!(viewer["accountId"], "fixture-user-1");
    assert_eq!(viewer["email"], "carlos@example.com");
    assert_eq!(
        viewer["avatarUrl"],
        "https://www.gravatar.com/avatar/fixture?d=mm&s=48"
    );
}

#[test]
fn server_auth_connects_with_bearer_pat_and_uses_v2_myself() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    let connected = ctx.ok(
        "jira.connect",
        json!({
            "siteUrl": server.site_url(),
            "email": "",
            "apiToken": FIXTURE_TOKEN,
            "authType": "server",
        }),
    );
    assert_eq!(connected["ok"], true);
    // The fixture has no accountId on its /rest/api/2/myself identity path
    // unless provided; Server/DC fallback uses name/key — here the fixture
    // viewer does carry accountId, so it wins.
    assert_eq!(connected["viewer"]["accountId"], "fixture-user-1");
    let status = ctx.ok("jira.status", json!({}));
    assert_eq!(status["sites"][0]["authType"], "server");
}

#[test]
fn disconnect_removes_site_token_and_selection() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    ctx.ok("jira.disconnect", json!({}));
    let status = ctx.ok("jira.status", json!({}));
    assert_eq!(status["connected"], false);
    assert!(
        !ctx.jira_dir().join("tokens").exists()
            || std::fs::read_dir(ctx.jira_dir().join("tokens"))
                .unwrap()
                .next()
                .is_none()
    );
}

#[test]
fn select_site_round_trips_through_status() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let site_id = ctx.ok("jira.status", json!({}))["sites"][0]["id"].clone();
    let status = ctx.ok("jira.selectSite", json!({"siteId": site_id}));
    assert_eq!(status["selectedSiteId"], site_id);
    // Selecting an unknown site leaves the file untouched.
    let status = ctx.ok("jira.selectSite", json!({"siteId": "nope"}));
    assert_eq!(status["selectedSiteId"], site_id);
}
