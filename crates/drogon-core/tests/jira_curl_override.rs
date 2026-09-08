//! The curl binary override seam (R17-A) in its own test binary: the
//! override is process-global state, so it must never run concurrently
//! with fixture-backed tests in another binary.

#[path = "jira_support.rs"]
mod support;

use serde_json::json;

use support::{FixtureServer, TestContext};

#[test]
fn curl_override_maps_a_missing_binary_to_an_unreachable_error() {
    // The tasks_rpc gh-override precedent, lifted to curl: a bogus binary
    // maps to an unreachable error, never a panic or a fabricated list.
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    drogon_core::jira::client::set_curl_bin_override(Some(std::path::PathBuf::from(
        "/nonexistent/drogon-test-curl",
    )));
    let error = ctx.err("jira.listIssues", json!({}));
    drogon_core::jira::client::set_curl_bin_override(None);
    assert_eq!(error.code, "jira_unreachable");
    assert!(error.retryable);
    // Back on the real curl, reads work again.
    let result = ctx.ok("jira.listIssues", json!({"filter": "all"}));
    assert_eq!(result["total"], 17);
}
