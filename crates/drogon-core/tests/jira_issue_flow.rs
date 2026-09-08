//! Jira issue creation, detail, comments, transitions, mutations and
//! start-from-issue against the fake Jira server (R17-C). Every test talks
//! ONLY to the committed fixture — no real Atlassian site is ever contacted
//! and no real credential is read or written.
#![cfg(unix)]

#[path = "jira_support.rs"]
mod support;

use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, MutexGuard};

use support::{FIXTURE_TOKEN, FixtureServer, TestContext};

/// `jira.startIssue` runs through the shared worktree-creation path, so
/// these tests need a real git project; unlike `tasks.*` there is no `gh`
/// binary to fake (the issue comes from the Jira fixture).
struct GitFixture {
    _root: tempfile::TempDir,
    ctx: TestContext,
    project_id: String,
}

impl GitFixture {
    fn new(server: &FixtureServer) -> Self {
        let root = tempfile::tempdir().unwrap();
        let repo = root.path().join("repo");
        init_repo(&repo);
        let ctx = TestContext::open();
        let added = ctx.ok("project.add", json!({"path": repo.to_str().unwrap()}));
        assert_eq!(added["kind"], "git");
        ctx.connect(server);
        GitFixture {
            _root: root,
            ctx,
            project_id: added["id"].as_str().unwrap().to_string(),
        }
    }
}

fn git(cwd: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?} failed in {cwd:?}");
}

fn init_repo(dir: &Path) {
    std::fs::create_dir_all(dir).unwrap();
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "user.email", "fixture@example.com"]);
    git(dir, &["config", "user.name", "fixture"]);
    std::fs::write(dir.join("README.md"), "hello\n").unwrap();
    git(dir, &["add", "README.md"]);
    git(dir, &["commit", "-q", "-m", "initial"]);
}

/// The fixture logs one JSON line per handled request; pull every line
/// matching a predicate (oldest first).
fn logged_requests(server: &FixtureServer, pred: impl Fn(&Value) -> bool) -> Vec<Value> {
    server
        .request_log()
        .into_iter()
        .filter(|entry| pred(entry))
        .collect()
}

// --- detail -----------------------------------------------------------------

#[test]
fn get_issue_renders_the_adf_description_to_markdown() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let issue = ctx.ok("jira.getIssue", json!({"key": "DROG-1"}));
    assert!(
        issue.is_object(),
        "detail returns the issue object: {issue}"
    );
    assert_eq!(issue["key"], "DROG-1");
    assert_eq!(issue["title"], "Project setup and repo bootstrap");
    let description = issue["description"].as_str().unwrap();
    assert!(
        description.contains("Bootstrap the repository"),
        "paragraph text renders: {description}"
    );
    assert!(
        description.contains("## Plan"),
        "heading renders: {description}"
    );
    assert!(
        description.contains("- cargo workspace layout"),
        "bullet list renders: {description}"
    );
    assert!(
        description.contains("  - fmt + clippy gates"),
        "nested list indents: {description}"
    );
    assert!(
        description.contains("```\ncargo build --workspace --locked\n```"),
        "code block renders: {description}"
    );
    assert!(
        description.contains("*[Terminal screenshot]*"),
        "unresolved media keeps a visible marker: {description}"
    );

    // The daemon asked for the fork's detail field set, expanded.
    let detail = logged_requests(&server, |entry| {
        entry["method"] == "GET" && entry["key"] == "DROG-1"
    });
    assert_eq!(detail.len(), 1, "exactly one detail GET");
    let fields: Vec<&str> = detail[0]["fields"].as_str().unwrap().split(',').collect();
    assert!(fields.contains(&"description"));
    assert!(fields.contains(&"attachment"));
    assert!(fields.contains(&"updated"));
    assert_eq!(detail[0]["expand"], "renderedFields");
}

#[test]
fn get_issue_unknown_key_is_an_honest_null() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let result = ctx.ok("jira.getIssue", json!({"key": "DROG-404"}));
    assert_eq!(result, Value::Null);
    // An unknown key (plain 404) maps the same.
    let result = ctx.ok("jira.getIssue", json!({"key": "NOPE-1"}));
    assert_eq!(result, Value::Null);
}

#[test]
fn get_issue_non_auth_failures_are_an_honest_null() {
    // The fork's getIssue `continue`s on non-auth failures and returns null
    // when no site produced the issue; the 429 taxonomy still rides the
    // search/mutation surfaces.
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let result = ctx.ok("jira.getIssue", json!({"key": "DROG-429"}));
    assert_eq!(result, Value::Null);
    let result = ctx.ok("jira.getIssue", json!({"key": "DROG-400"}));
    assert_eq!(result, Value::Null);
}

// --- comments ---------------------------------------------------------------

#[test]
fn comments_are_paged_ordered_and_rendered() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let comments = ctx.ok("jira.comments", json!({"key": "DROG-1"}));
    let comments = comments.as_array().unwrap();
    assert_eq!(comments.len(), 2);
    assert_eq!(comments[0]["id"], "20001");
    assert_eq!(comments[0]["body"], "Repo skeleton looks good.");
    assert_eq!(comments[0]["user"]["displayName"], "Ana Garcia");
    assert_eq!(
        comments[1]["body"],
        "One question:\n\n1. which Rust version?"
    );
    let requests = logged_requests(&server, |entry| {
        entry["method"] == "GET" && entry["key"] == "DROG-1"
    });
    assert!(requests.iter().all(|entry| entry["orderBy"] == "created"));
}

#[test]
fn comments_accept_the_server_wiki_string_shape() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let comments = ctx.ok("jira.comments", json!({"key": "DROG-2"}));
    let comments = comments.as_array().unwrap();
    assert_eq!(comments.len(), 1);
    assert_eq!(
        comments[0]["body"],
        "Plain string body (Server/DC wiki shape)."
    );
}

#[test]
fn comments_unknown_issue_degrades_to_empty() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let comments = ctx.ok("jira.comments", json!({"key": "DROG-404"}));
    assert_eq!(comments.as_array().unwrap().len(), 0);
}

// --- transitions ------------------------------------------------------------

#[test]
fn transitions_map_with_target_status() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let transitions = ctx.ok("jira.transitions", json!({"key": "DROG-1"}));
    let transitions = transitions.as_array().unwrap();
    assert_eq!(transitions.len(), 2);
    assert_eq!(transitions[0]["name"], "Start Progress");
    assert_eq!(transitions[0]["to"]["name"], "In Progress");
    assert_eq!(transitions[0]["to"]["categoryKey"], "indeterminate");
    assert_eq!(transitions[1]["to"]["categoryKey"], "done");
}

#[test]
fn transitions_failure_degrades_to_empty() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let transitions = ctx.ok("jira.transitions", json!({"key": "DROG-404"}));
    assert_eq!(transitions.as_array().unwrap().len(), 0);
}

// --- create -----------------------------------------------------------------

#[test]
fn create_issue_sends_the_forks_field_shape_and_returns_key_and_url() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let result = ctx.ok(
        "jira.createIssue",
        json!({
            "projectId": "10000",
            "issueTypeId": "10001",
            "title": "Ship the fixture flow",
            "description": "line one\nline two",
            "customFields": {
                "custom_10002": { "id": "2" },
                "custom_10003": "fixture-user-2",
                "custom_10004": ["ui", "daemon"],
                "custom_10006": 3,
                // The renderer builds ADF for textarea custom fields
                // (`buildJiraCreateTextAdf`); the daemon passes it through.
                "custom_10005": { "type": "doc", "version": 1, "content": [
                    { "type": "paragraph", "content": [{ "type": "text", "text": "risky" }] }
                ] }
            },
            "userFieldKeys": ["custom_10003"],
        }),
    );
    assert_eq!(result["ok"], true);
    let key = result["key"].as_str().unwrap().to_string();
    assert!(
        key.starts_with("DROG-"),
        "the fixture mints the next key in the project: {key}"
    );
    assert!(
        result["url"]
            .as_str()
            .unwrap()
            .ends_with(&format!("/browse/{key}"))
    );

    let create = logged_requests(&server, |entry| {
        entry["method"] == "POST" && entry["path"] == "/rest/api/3/issue"
    });
    assert_eq!(create.len(), 1);
    let fields = &create[0]["body"]["fields"];
    assert_eq!(fields["project"], json!({ "id": "10000" }));
    assert_eq!(fields["issuetype"], json!({ "id": "10001" }));
    assert_eq!(fields["summary"], "Ship the fixture flow");
    // Cloud description is ADF, one paragraph per line (the fork's textToAdf).
    let description = &fields["description"];
    assert_eq!(description["type"], "doc");
    assert_eq!(description["content"][0]["content"][0]["text"], "line one");
    assert_eq!(description["content"][1]["content"][0]["text"], "line two");
    // User-typed fields shaped into accountId refs; the select option and
    // the rest pass through untouched.
    assert_eq!(
        fields["custom_10003"],
        json!({ "accountId": "fixture-user-2" })
    );
    assert_eq!(fields["custom_10002"], json!({ "id": "2" }));
    assert_eq!(fields["custom_10004"], json!(["ui", "daemon"]));
    assert_eq!(fields["custom_10006"], json!(3));
    // The renderer-built ADF for textarea custom fields passes through.
    assert_eq!(fields["custom_10005"]["type"], "doc");
    assert_eq!(
        fields["custom_10005"]["content"][0]["content"][0]["text"],
        "risky"
    );
}

#[test]
fn create_issue_business_failures_ride_the_result_envelope() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    // The fixture 400s a FAIL_CREATE summary; the daemon surfaces the
    // site's message inside {ok:false} exactly like the fork.
    let result = ctx.ok(
        "jira.createIssue",
        json!({"projectId": "10000", "issueTypeId": "10001", "title": "FAIL_CREATE on purpose"}),
    );
    assert_eq!(result["ok"], false);
    assert!(
        result["error"]
            .as_str()
            .unwrap()
            .contains("could not be created")
    );
    // An empty title never reaches the wire.
    let result = ctx.ok(
        "jira.createIssue",
        json!({"projectId": "10000", "issueTypeId": "10001", "title": "   "}),
    );
    assert_eq!(result["ok"], false);
    assert_eq!(result["error"], "Title is required.");
}

#[test]
fn create_issue_without_a_connection_is_honest() {
    let server = FixtureServer::new();
    let _ = server;
    let ctx = TestContext::open();
    let result = ctx.ok(
        "jira.createIssue",
        json!({"projectId": "10000", "issueTypeId": "10001", "title": "No site"}),
    );
    assert_eq!(result["ok"], false);
    assert_eq!(result["error"], "Not connected to Jira.");
}

// --- Server/DC shapes -------------------------------------------------------

/// Connect a second, Server/DC-flavored fixture site (Bearer PAT auth,
/// `/rest/api/2` base) and run one test at a time against it — the curl
/// override is process-global per test binary.
static SERVER_SERIAL: Mutex<()> = Mutex::new(());

struct ServerSiteGuard {
    _lock: MutexGuard<'static, ()>,
}

#[test]
fn server_site_create_uses_v2_and_plain_text_bodies() {
    let _guard = ServerSiteGuard {
        _lock: SERVER_SERIAL.lock().unwrap(),
    };
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.ok(
        "jira.connect",
        json!({
            "siteUrl": server.site_url(),
            "email": "",
            "apiToken": FIXTURE_TOKEN,
            "authType": "server",
        }),
    );
    let result = ctx.ok(
        "jira.createIssue",
        json!({
            "projectId": "10000",
            "issueTypeId": "10001",
            "title": "Server shape",
            "description": "plain body",
            "customFields": { "custom_10003": "jsmith" },
            "userFieldKeys": ["custom_10003"],
        }),
    );
    assert_eq!(result["ok"], true);
    let create = logged_requests(&server, |entry| {
        entry["method"] == "POST" && entry["path"] == "/rest/api/2/issue"
    });
    assert_eq!(create.len(), 1, "Server sites POST to the v2 path");
    let fields = &create[0]["body"]["fields"];
    // v2 bodies are plain text, not ADF.
    assert_eq!(fields["description"], "plain body");
    // Server users are identified by `name`, not `accountId`.
    assert_eq!(fields["custom_10003"], json!({ "name": "jsmith" }));

    // A Server comment is the same plain-text shape.
    let comment = ctx.ok(
        "jira.addComment",
        json!({"key": "DROG-1", "body": "wiki body"}),
    );
    assert_eq!(comment["ok"], true);
    let posted = logged_requests(&server, |entry| {
        entry["method"] == "POST" && entry["sub"] == "/comment"
    });
    assert_eq!(posted[0]["body"]["body"], "wiki body");
}

// --- update / addComment ----------------------------------------------------

#[test]
fn update_issue_sends_fields_assignee_and_transition() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let result = ctx.ok(
        "jira.updateIssue",
        json!({
            "key": "DROG-1",
            "title": "Renamed",
            "labels": ["backend", "v1"],
            "priorityId": "3",
            "assigneeAccountId": "fixture-user-2",
            "transitionId": "21",
        }),
    );
    assert_eq!(result["ok"], true);
    let puts = logged_requests(&server, |entry| entry["key"] == "DROG-1");
    let fields_put = puts
        .iter()
        .find(|entry| entry["method"] == "PUT" && entry["sub"] == "")
        .expect("one fields PUT");
    assert_eq!(fields_put["body"]["fields"]["summary"], "Renamed");
    assert_eq!(
        fields_put["body"]["fields"]["labels"],
        json!(["backend", "v1"])
    );
    assert_eq!(
        fields_put["body"]["fields"]["priority"],
        json!({ "id": "3" })
    );
    let assignee_put = puts
        .iter()
        .find(|entry| entry["method"] == "PUT" && entry["sub"] == "/assignee")
        .expect("one assignee PUT");
    // The assignee body is the bare user ref object (the fork's shape).
    assert_eq!(
        assignee_put["body"],
        json!({ "accountId": "fixture-user-2" })
    );
    let transition_post = puts
        .iter()
        .find(|entry| entry["method"] == "POST" && entry["sub"] == "/transitions")
        .expect("one transitions POST");
    assert_eq!(
        transition_post["body"],
        json!({ "transition": { "id": "21" } })
    );
}

#[test]
fn update_issue_can_clear_assignee_and_priority() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let result = ctx.ok(
        "jira.updateIssue",
        json!({"key": "DROG-1", "assigneeAccountId": null, "priorityId": null}),
    );
    assert_eq!(result["ok"], true);
    let requests = logged_requests(&server, |entry| entry["key"] == "DROG-1");
    let assignee_put = requests
        .iter()
        .find(|entry| entry["sub"] == "/assignee")
        .expect("assignee PUT");
    assert_eq!(assignee_put["body"], json!({ "accountId": null }));
    // Clearing priority IS a fields write (`priority: null`); clearing
    // assignee alone is not.
    let fields_put = requests
        .iter()
        .find(|entry| entry["method"] == "PUT" && entry["sub"] == "")
        .expect("priority clear rides the fields PUT");
    assert_eq!(fields_put["body"]["fields"]["priority"], Value::Null);
    assert!(fields_put["body"]["fields"].get("summary").is_none());
}

#[test]
fn update_issue_business_failure_rides_the_envelope() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let result = ctx.ok(
        "jira.updateIssue",
        json!({"key": "DROG-400", "title": "Nope"}),
    );
    assert_eq!(result["ok"], false);
    assert!(result["error"].as_str().unwrap().contains("invalid"));
}

#[test]
fn add_comment_posts_adf_and_returns_the_comment_id() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let result = ctx.ok(
        "jira.addComment",
        json!({"key": "DROG-1", "body": "first line\nsecond line"}),
    );
    assert_eq!(result["ok"], true);
    assert_eq!(result["id"], "90001");
    let posted = logged_requests(&server, |entry| entry["sub"] == "/comment");
    let body = &posted[0]["body"]["body"];
    assert_eq!(body["type"], "doc");
    assert_eq!(body["content"][0]["content"][0]["text"], "first line");
    assert_eq!(body["content"][1]["content"][0]["text"], "second line");
}

// --- start-from-issue -------------------------------------------------------

#[test]
fn start_issue_creates_a_worktree_named_the_forks_way() {
    let server = FixtureServer::new();
    let fx = GitFixture::new(&server);
    let started = fx.ctx.ok(
        "jira.startIssue",
        json!({"projectId": fx.project_id, "key": "DROG-1"}),
    );
    assert_eq!(started["ok"], true);
    assert_eq!(started["key"], "DROG-1");
    // The fork's way: branch/directory slug from the issue key + subject.
    assert_eq!(
        started["seedName"],
        "drog-1-project-setup-and-repo-bootstrap"
    );
    assert_eq!(
        started["displayName"],
        "DROG-1 Project setup and repo bootstrap"
    );
    assert_eq!(
        started["worktree"]["branch"],
        "drog-1-project-setup-and-repo-bootstrap"
    );
    // The badge/link back to the issue: the display title carries the key.
    assert_eq!(
        started["worktree"]["title"],
        "DROG-1 Project setup and repo bootstrap"
    );
    assert!(Path::new(started["worktree"]["path"].as_str().unwrap()).is_dir());

    // A repeated start is idempotent — the same worktree comes back.
    let again = fx.ctx.ok(
        "jira.startIssue",
        json!({"projectId": fx.project_id, "key": "DROG-1"}),
    );
    assert_eq!(again["worktree"]["id"], started["worktree"]["id"]);
    let listed = fx
        .ctx
        .ok("worktree.list", json!({"projectId": fx.project_id}));
    assert_eq!(listed["worktrees"].as_array().unwrap().len(), 1);
}

#[test]
fn start_issue_falls_back_to_the_key_when_the_site_is_unreachable() {
    // No fixture server: the issue read fails and the name falls back to
    // the renderer-provided title, never a silent generic name.
    let ctx = TestContext::open();
    let root = tempfile::tempdir().unwrap();
    let repo = root.path().join("repo");
    init_repo(&repo);
    let added = ctx.ok("project.add", json!({"path": repo.to_str().unwrap()}));
    let started = ctx.ok(
        "jira.startIssue",
        json!({
            "projectId": added["id"],
            "key": "ORCA-9",
            "title": "Polish the picker",
        }),
    );
    assert_eq!(started["seedName"], "orca-9-polish-the-picker");
    assert_eq!(started["displayName"], "ORCA-9 Polish the picker");
    let _ = PathBuf::new();
}

#[test]
fn start_issue_requires_a_git_project() {
    let server = FixtureServer::new();
    let ctx = TestContext::open();
    ctx.connect(&server);
    let root = tempfile::tempdir().unwrap();
    let folder = root.path().join("folder-project");
    std::fs::create_dir_all(&folder).unwrap();
    let added = ctx.ok("project.add", json!({"path": folder.to_str().unwrap()}));
    assert_eq!(added["kind"], "folder");
    let error = ctx.err(
        "jira.startIssue",
        json!({"projectId": added["id"], "key": "DROG-1"}),
    );
    assert_eq!(error.code, "invalid_argument");
}
