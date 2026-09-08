//! Journey J6 Tasks RPCs through the public `Engine` API: list, show,
//! start (worktree + link) and links against a real `Engine`, a real SQLite
//! file and real temp git repositories. `gh` is faked by direct binary path
//! through `tasks_rpc::set_gh_bin_override` — never via process-global
//! `PATH` mutation — and every test holds one file-wide serial lock while
//! its override is installed, so parallel tests in this binary cannot
//! observe each other's fixture binary.
#![cfg(unix)]

use drogon_core::Engine;
use drogon_core::tasks_rpc;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

static IDS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
static SERIAL: Mutex<()> = Mutex::new(());

struct GhOverride {
    _lock: MutexGuard<'static, ()>,
}

impl GhOverride {
    fn set(path: Option<PathBuf>) -> Self {
        let lock = SERIAL.lock().unwrap();
        tasks_rpc::set_gh_bin_override(path);
        Self { _lock: lock }
    }
}

impl Drop for GhOverride {
    fn drop(&mut self) {
        tasks_rpc::set_gh_bin_override(None);
    }
}

fn call(engine: &Engine, method: &str, params: Value) -> Response {
    let id = IDS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: format!("tasks-{id}"),
        auth: None,
        method: method.into(),
        params,
    })
}

fn ok(engine: &Engine, method: &str, params: Value) -> Value {
    let response = call(engine, method, params);
    assert!(
        response.ok,
        "expected ok for {method}: {:?}",
        response.error
    );
    response.result.unwrap()
}

fn err_code(engine: &Engine, method: &str, params: Value) -> String {
    let response = call(engine, method, params);
    assert!(
        !response.ok,
        "expected error for {method}, got {:?}",
        response.result
    );
    response.error.unwrap().code
}

fn git(cwd: &Path, args: &[&str]) {
    let status = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?} failed in {cwd:?}");
}

fn init_repo(dir: &Path, origin: Option<&str>) {
    fs::create_dir_all(dir).unwrap();
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "user.email", "fixture@example.com"]);
    git(dir, &["config", "user.name", "fixture"]);
    fs::write(dir.join("README.md"), "hello\n").unwrap();
    git(dir, &["add", "README.md"]);
    git(dir, &["commit", "-q", "-m", "initial"]);
    if let Some(url) = origin {
        git(dir, &["remote", "add", "origin", url]);
    }
}

fn write_executable(dir: &Path, name: &str, body: &str) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, body).unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    path
}

const LIST_JSON: &str = r#"[
  {"number":7,"title":"Fix the sidebar crash","state":"OPEN",
   "labels":[{"name":"bug","color":"d73a4a"}],
   "assignees":[{"login":"octocat"}],
   "updatedAt":"2026-09-06T12:00:00Z",
   "url":"https://github.com/example/repo/issues/7"},
  {"number":9,"title":"Add browser pane","state":"OPEN",
   "labels":[{"name":"enhancement","color":"a2eeef"}],
   "assignees":[],
   "updatedAt":"2026-09-05T09:30:00Z",
   "url":"https://github.com/example/repo/issues/9"}
]"#;

const VIEW_JSON_7: &str = r#"{"number":7,"title":"Fix the sidebar crash","state":"OPEN",
 "body":"Steps to reproduce: open the sidebar.",
 "labels":[{"name":"bug","color":"d73a4a"}],
 "assignees":[{"login":"octocat"}],
 "updatedAt":"2026-09-06T12:00:00Z",
 "url":"https://github.com/example/repo/issues/7"}"#;

const PR_LIST_JSON: &str = r#"[
  {"number":12,"title":"Add the PR flow","state":"OPEN","isDraft":false,
   "labels":[{"name":"enhancement","color":"a2eeef"}],
   "assignees":[{"login":"octocat"}],
   "author":{"login":"helix"},
   "reviewDecision":"APPROVED",
   "statusCheckRollup":[
     {"name":"build","status":"COMPLETED","conclusion":"SUCCESS"},
     {"name":"lint","status":"COMPLETED","conclusion":"SUCCESS"},
     {"name":"e2e","status":"IN_PROGRESS","conclusion":""}
   ],
   "mergeable":"MERGEABLE",
   "headRefName":"add-pr-flow","baseRefName":"main",
   "updatedAt":"2026-09-06T14:00:00Z",
   "url":"https://github.com/example/repo/pull/12"},
  {"number":13,"title":"Draft the release notes","state":"OPEN","isDraft":true,
   "labels":[],
   "assignees":[],
   "author":{"login":"helix"},
   "reviewDecision":"",
   "statusCheckRollup":[],
   "mergeable":"UNKNOWN",
   "headRefName":"draft-work","baseRefName":"main",
   "updatedAt":"2026-09-05T10:00:00Z",
   "url":"https://github.com/example/repo/pull/13"}
]"#;

const PR_VIEW_JSON_12: &str = r#"{"number":12,"title":"Add the PR flow","state":"OPEN","isDraft":false,
 "labels":[{"name":"enhancement","color":"a2eeef"}],
 "assignees":[{"login":"octocat"}],
 "author":{"login":"helix"},
 "reviewDecision":"APPROVED",
 "statusCheckRollup":[
   {"name":"build","status":"COMPLETED","conclusion":"SUCCESS"},
   {"name":"lint","status":"COMPLETED","conclusion":"SUCCESS"},
   {"name":"e2e","status":"IN_PROGRESS","conclusion":""}
 ],
 "mergeable":"MERGEABLE",
 "headRefName":"add-pr-flow","baseRefName":"main",
 "updatedAt":"2026-09-06T14:00:00Z",
 "url":"https://github.com/example/repo/pull/12"}"#;

/// A fake `gh` that answers `issue list`/`issue view` from fixture JSON,
/// plus `pr list`/`pr view` for pulls mode, and records its last argv in
/// the repo (`$PWD/.gh-argv-last`) so tests can prove which
/// `--repo`/`--state` the core derived.
fn fake_gh_list_view() -> String {
    format!(
        "#!/bin/sh\necho \"$*\" > \"$PWD/.gh-argv-last\"\n\
         if [ \"$1\" = \"issue\" ] && [ \"$2\" = \"list\" ]; then\ncat <<'EOF'\n{LIST_JSON}\nEOF\n\
         elif [ \"$1\" = \"issue\" ] && [ \"$2\" = \"view\" ] && [ \"$3\" = \"7\" ]; then\ncat <<'EOF'\n{VIEW_JSON_7}\nEOF\n\
         elif [ \"$1\" = \"pr\" ] && [ \"$2\" = \"list\" ]; then\ncat <<'EOF'\n{PR_LIST_JSON}\nEOF\n\
         elif [ \"$1\" = \"pr\" ] && [ \"$2\" = \"view\" ] && [ \"$3\" = \"12\" ]; then\ncat <<'EOF'\n{PR_VIEW_JSON_12}\nEOF\n\
         else\necho 'could not resolve to an Issue' >&2\nexit 1\nfi\n"
    )
}

/// A fake `gh` whose `issue list` honors `--limit N` and emits N synthetic
/// issues (newest first: numbers 100..1) so paging windows and the
/// fetch-one-extra `hasNextPage` probe are exercised end to end. `pr list`
/// answers the same window with synthetic PRs.
fn fake_gh_list_paged(total: u64) -> String {
    format!(
        "#!/bin/sh\necho \"$*\" > \"$PWD/.gh-argv-last\"\n\
         if [ \"$1\" = \"issue\" ] && [ \"$2\" = \"list\" ]; then\n\
         LIMIT={total}; prev=\"\"; for a in \"$@\"; do \
         [ \"$prev\" = \"--limit\" ] && LIMIT=$a; prev=\"$a\"; done; \
         [ \"$LIMIT\" -gt {total} ] && LIMIT={total}; \
         i=0; printf '['; while [ \"$i\" -lt \"$LIMIT\" ]; do i=$((i+1)); \
         [ \"$i\" -gt 1 ] && printf ','; n=$((101-i)); \
         printf '{{\"number\":%d,\"title\":\"Issue %d\",\"state\":\"OPEN\",\"labels\":[],\"assignees\":[],\"updatedAt\":\"2026-09-06T12:00:00Z\",\"url\":\"https://github.com/example/repo/issues/%d\"}}' \"$n\" \"$n\" \"$n\"; done; printf ']'; echo; \
         elif [ \"$1\" = \"pr\" ] && [ \"$2\" = \"list\" ]; then\n\
         LIMIT={total}; prev=\"\"; for a in \"$@\"; do \
         [ \"$prev\" = \"--limit\" ] && LIMIT=$a; prev=\"$a\"; done; \
         [ \"$LIMIT\" -gt {total} ] && LIMIT={total}; \
         i=0; printf '['; while [ \"$i\" -lt \"$LIMIT\" ]; do i=$((i+1)); \
         [ \"$i\" -gt 1 ] && printf ','; n=$((101-i)); \
         printf '{{\"number\":%d,\"title\":\"PR %d\",\"state\":\"OPEN\",\"isDraft\":false,\"labels\":[],\"assignees\":[],\"updatedAt\":\"2026-09-06T12:00:00Z\",\"url\":\"https://github.com/example/repo/pull/%d\",\"headRefName\":\"pr-%d\",\"baseRefName\":\"main\"}}' \"$n\" \"$n\" \"$n\" \"$n\"; done; printf ']'; echo; \
         elif [ \"$1\" = \"issue\" ] && [ \"$2\" = \"view\" ] && [ \"$3\" = \"7\" ]; then\ncat <<'EOF'\n{VIEW_JSON_7}\nEOF\n\
         else\necho 'could not resolve to an Issue' >&2\nexit 1\nfi\n"
    )
}

struct Fixture {
    _root: tempfile::TempDir,
    _override: GhOverride,
    engine: Engine,
    repo: PathBuf,
    project_id: String,
}

impl Fixture {
    fn new(origin: Option<&str>, gh_body: Option<&str>) -> Self {
        let root = tempfile::tempdir().unwrap();
        let repo = root.path().join("repo");
        init_repo(&repo, origin);
        let gh_bin = gh_body.map(|body| write_executable(root.path(), "gh-fake", body));
        let _override = GhOverride::set(gh_bin);
        let engine = Engine::open(&root.path().join("data")).unwrap();
        let added = ok(
            &engine,
            "project.add",
            json!({"path": repo.to_str().unwrap()}),
        );
        assert_eq!(added["kind"], "git");
        Fixture {
            _root: root,
            _override,
            engine,
            repo,
            project_id: added["id"].as_str().unwrap().to_string(),
        }
    }

    fn last_argv(&self) -> String {
        fs::read_to_string(self.repo.join(".gh-argv-last")).unwrap_or_default()
    }

    /// Re-points the `gh` override without re-taking the serial lock (the
    /// fixture already holds it for the whole test; locking again would
    /// self-deadlock on this thread).
    fn set_gh_bin(&self, path: Option<PathBuf>) {
        tasks_rpc::set_gh_bin_override(path);
    }
}

#[test]
fn list_returns_open_issues_and_derives_repo_and_state() {
    let fx = Fixture::new(
        Some("https://github.com/example/repo.git"),
        Some(&fake_gh_list_view()),
    );
    let listed = ok(
        &fx.engine,
        "tasks.list",
        json!({"projectId": fx.project_id}),
    );
    assert_eq!(listed["repo"], "example/repo");
    let issues = listed["issues"].as_array().unwrap();
    assert_eq!(issues.len(), 2);
    assert_eq!(issues[0]["number"], 7);
    assert_eq!(issues[0]["title"], "Fix the sidebar crash");
    assert_eq!(issues[0]["state"], "open");
    assert_eq!(issues[0]["labels"][0]["name"], "bug");
    assert_eq!(issues[0]["assignees"][0], "octocat");
    assert_eq!(issues[0]["updatedAt"], "2026-09-06T12:00:00Z");
    assert!(issues[0].get("body").is_none());
    let argv = fx.last_argv();
    assert!(
        argv.contains("--repo example/repo") && argv.contains("--state open"),
        "core must derive --repo/--state, got: {argv}"
    );

    let filtered = ok(
        &fx.engine,
        "tasks.list",
        json!({"projectId": fx.project_id, "query": "browser"}),
    );
    let issues = filtered["issues"].as_array().unwrap();
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0]["number"], 9);

    // The paging echo: default window is page 1 x the source page size, and
    // two rows can never prove a next page.
    assert_eq!(listed["page"], 1);
    assert_eq!(listed["perPage"], 36);
    assert_eq!(listed["hasNextPage"], false);
    assert!(listed.get("total").is_none());
    let by_number = ok(
        &fx.engine,
        "tasks.list",
        json!({"projectId": fx.project_id, "query": "#7"}),
    );
    assert_eq!(by_number["issues"].as_array().unwrap().len(), 1);

    ok(
        &fx.engine,
        "tasks.list",
        json!({"projectId": fx.project_id, "state": "closed"}),
    );
    assert!(
        fx.last_argv().contains("--state closed"),
        "state param must reach gh"
    );
}

#[test]
fn list_pages_through_the_gh_stream_with_proven_has_next() {
    let fx = Fixture::new(
        Some("https://github.com/example/repo.git"),
        Some(&fake_gh_list_paged(5)),
    );
    let params = |page: u64, per_page: u64| json!({"projectId": fx.project_id, "page": page, "perPage": per_page});

    let page1 = ok(&fx.engine, "tasks.list", params(1, 2));
    assert_eq!(page1["page"], 1);
    assert_eq!(page1["perPage"], 2);
    let issues = page1["issues"].as_array().unwrap();
    let numbers: Vec<u64> = issues
        .iter()
        .map(|issue| issue["number"].as_u64().unwrap())
        .collect();
    assert_eq!(numbers, vec![100, 99], "newest first, first window");
    assert_eq!(page1["hasNextPage"], true);

    let page3 = ok(&fx.engine, "tasks.list", params(3, 2));
    let issues = page3["issues"].as_array().unwrap();
    let numbers: Vec<u64> = issues
        .iter()
        .map(|issue| issue["number"].as_u64().unwrap())
        .collect();
    assert_eq!(numbers, vec![96], "5 rows total: page 3 holds the tail row");
    assert_eq!(page3["hasNextPage"], false);

    // A page past the data end is honestly empty, not an error.
    let page4 = ok(&fx.engine, "tasks.list", params(4, 2));
    assert_eq!(page4["issues"].as_array().unwrap().len(), 0);
    assert_eq!(page4["hasNextPage"], false);

    // The full page window is fetched in one call: --limit carries the
    // requested window plus the single has-next probe row.
    ok(&fx.engine, "tasks.list", params(2, 2));
    assert!(
        fx.last_argv().contains("--limit 5"),
        "fetch limit must be page*perPage+1, got: {}",
        fx.last_argv()
    );

    // A full window proves another page exists.
    let full = ok(&fx.engine, "tasks.list", params(1, 36));
    assert_eq!(full["issues"].as_array().unwrap().len(), 5);
    assert_eq!(full["hasNextPage"], false, "5 < 36-row window");
}

#[test]
fn list_state_filter_reaches_gh_and_rejects_out_of_bounds_pages() {
    let fx = Fixture::new(
        Some("https://github.com/example/repo.git"),
        Some(&fake_gh_list_paged(3)),
    );
    ok(
        &fx.engine,
        "tasks.list",
        json!({"projectId": fx.project_id, "state": "all", "page": 2, "perPage": 2}),
    );
    let argv = fx.last_argv();
    assert!(
        argv.contains("--state all") && argv.contains("--limit 5"),
        "state and the page-2 window must reach gh, got: {argv}"
    );
    for bad in [
        json!({"projectId": fx.project_id, "page": 0}),
        json!({"projectId": fx.project_id, "page": 11}),
        json!({"projectId": fx.project_id, "perPage": 0}),
        json!({"projectId": fx.project_id, "perPage": 101}),
    ] {
        assert_eq!(
            err_code(&fx.engine, "tasks.list", bad),
            "invalid_argument",
            "out-of-bounds paging must be refused"
        );
    }
}

#[test]
fn show_returns_the_issue_body() {
    let fx = Fixture::new(
        Some("git@github.com:example/repo.git"),
        Some(&fake_gh_list_view()),
    );
    let shown = ok(
        &fx.engine,
        "tasks.show",
        json!({"projectId": fx.project_id, "number": 7}),
    );
    assert_eq!(shown["issue"]["number"], 7);
    assert_eq!(
        shown["issue"]["body"],
        "Steps to reproduce: open the sidebar."
    );
    assert_eq!(
        err_code(
            &fx.engine,
            "tasks.show",
            json!({"projectId": fx.project_id, "number": 999}),
        ),
        "io_error",
        "unknown issue is a gh failure, not a typed tasks error"
    );
}

#[test]
fn start_creates_an_issue_worktree_link_and_is_idempotent() {
    let fx = Fixture::new(
        Some("https://github.com/example/repo.git"),
        Some(&fake_gh_list_view()),
    );
    let started = ok(
        &fx.engine,
        "tasks.start",
        json!({"projectId": fx.project_id, "number": 7}),
    );
    assert_eq!(started["issueNumber"], 7);
    assert_eq!(
        started["worktree"]["branch"],
        "issue-7-fix-the-sidebar-crash"
    );
    let workspace_id = started["worktree"]["workspaceId"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(
        Path::new(started["worktree"]["path"].as_str().unwrap()).is_dir(),
        "start must create a real checkout"
    );
    assert!(!workspace_id.is_empty());

    let links = ok(
        &fx.engine,
        "tasks.links",
        json!({"projectId": fx.project_id}),
    );
    let links = links["links"].as_array().unwrap();
    assert_eq!(links.len(), 1);
    assert_eq!(links[0]["issueNumber"], 7);
    assert_eq!(links[0]["branch"], "issue-7-fix-the-sidebar-crash");

    let again = ok(
        &fx.engine,
        "tasks.start",
        json!({"projectId": fx.project_id, "number": 7}),
    );
    assert_eq!(
        again["worktree"]["id"], started["worktree"]["id"],
        "a repeated start must reuse the linked worktree"
    );
    let listed = ok(
        &fx.engine,
        "worktree.list",
        json!({"projectId": fx.project_id}),
    );
    assert_eq!(listed["worktrees"].as_array().unwrap().len(), 1);
}

#[test]
fn links_is_empty_before_any_start() {
    let fx = Fixture::new(
        Some("https://github.com/example/repo.git"),
        Some(&fake_gh_list_view()),
    );
    let links = ok(
        &fx.engine,
        "tasks.links",
        json!({"projectId": fx.project_id}),
    );
    assert_eq!(links["links"].as_array().unwrap().len(), 0);
}

#[test]
fn missing_gh_is_gh_unavailable() {
    let fx = Fixture::new(Some("https://github.com/example/repo.git"), None);
    fx.set_gh_bin(Some(fx._root.path().join("does-not-exist-gh")));
    assert_eq!(
        err_code(
            &fx.engine,
            "tasks.list",
            json!({"projectId": fx.project_id}),
        ),
        "gh_unavailable"
    );
}

#[test]
fn unauthenticated_gh_is_gh_unauthenticated() {
    let fx = Fixture::new(
        Some("https://github.com/example/repo.git"),
        Some(
            "#!/bin/sh\necho 'error: To get started with GitHub, please run: gh auth login' >&2\nexit 1\n",
        ),
    );
    assert_eq!(
        err_code(
            &fx.engine,
            "tasks.list",
            json!({"projectId": fx.project_id}),
        ),
        "gh_unauthenticated"
    );
}

#[test]
fn repos_without_a_github_remote_are_no_github_remote() {
    // Each fixture holds the file-wide serial lock while its `gh`
    // override is installed, so the two fixtures live in separate scopes:
    // nesting them would re-lock on the same thread and self-deadlock.
    {
        let fx = Fixture::new(None, Some(&fake_gh_list_view()));
        assert_eq!(
            err_code(
                &fx.engine,
                "tasks.list",
                json!({"projectId": fx.project_id}),
            ),
            "no_github_remote",
            "a repo with no origin must not reach gh"
        );
        assert!(
            !fx.repo.join(".gh-argv-last").exists(),
            "no gh spawn may happen without a remote"
        );
    }

    {
        let fx = Fixture::new(
            Some("https://gitlab.com/example/repo.git"),
            Some(&fake_gh_list_view()),
        );
        assert_eq!(
            err_code(
                &fx.engine,
                "tasks.show",
                json!({"projectId": fx.project_id, "number": 7}),
            ),
            "no_github_remote"
        );
    }
}

#[test]
fn pulls_list_returns_prs_with_rollup_draft_and_empty_issues() {
    let fx = Fixture::new(
        Some("https://github.com/example/repo.git"),
        Some(&fake_gh_list_view()),
    );
    let listed = ok(
        &fx.engine,
        "tasks.list",
        json!({"projectId": fx.project_id, "mode": "pulls"}),
    );
    assert_eq!(listed["repo"], "example/repo");
    assert_eq!(
        listed["issues"].as_array().unwrap().len(),
        0,
        "pulls mode serves pulls, never issues"
    );
    let pulls = listed["pulls"].as_array().unwrap();
    assert_eq!(pulls.len(), 2);
    assert_eq!(pulls[0]["number"], 12);
    assert_eq!(pulls[0]["title"], "Add the PR flow");
    assert_eq!(pulls[0]["state"], "open");
    assert_eq!(pulls[0]["isDraft"], false);
    assert_eq!(pulls[0]["reviewDecision"], "APPROVED");
    assert_eq!(pulls[0]["checks"]["state"], "pending");
    assert_eq!(pulls[0]["checks"]["total"], 3);
    assert_eq!(pulls[0]["checks"]["passed"], 2);
    assert_eq!(pulls[0]["checks"]["pending"], 1);
    assert_eq!(pulls[0]["mergeable"], "MERGEABLE");
    assert_eq!(pulls[0]["headRefName"], "add-pr-flow");
    assert_eq!(pulls[0]["baseRefName"], "main");
    assert_eq!(pulls[0]["assignees"][0], "octocat");
    // The draft maps OPEN+isDraft onto the draft state; empty rollups and
    // decisions stay absent, never null.
    assert_eq!(pulls[1]["number"], 13);
    assert_eq!(pulls[1]["state"], "draft");
    assert_eq!(pulls[1]["isDraft"], true);
    assert!(pulls[1].get("reviewDecision").is_none());
    assert!(pulls[1].get("checks").is_none());
    assert_eq!(pulls[1]["mergeable"], "UNKNOWN");
    let argv = fx.last_argv();
    assert!(
        argv.contains("pr list")
            && argv.contains("--repo example/repo")
            && argv.contains("--state open"),
        "core must derive pr list --repo/--state, got: {argv}"
    );

    let filtered = ok(
        &fx.engine,
        "tasks.list",
        json!({"projectId": fx.project_id, "mode": "pulls", "query": "release"}),
    );
    let pulls = filtered["pulls"].as_array().unwrap();
    assert_eq!(pulls.len(), 1);
    assert_eq!(pulls[0]["number"], 13);
    let by_number = ok(
        &fx.engine,
        "tasks.list",
        json!({"projectId": fx.project_id, "mode": "pulls", "query": "#12"}),
    );
    assert_eq!(by_number["pulls"].as_array().unwrap().len(), 1);

    assert_eq!(listed["page"], 1);
    assert_eq!(listed["perPage"], 36);
    assert_eq!(listed["hasNextPage"], false);
    assert!(listed.get("total").is_none());
}

#[test]
fn pulls_list_pages_with_proven_has_next() {
    let fx = Fixture::new(
        Some("https://github.com/example/repo.git"),
        Some(&fake_gh_list_paged(5)),
    );
    let params = |page: u64, per_page: u64| json!({"projectId": fx.project_id, "mode": "pulls", "page": page, "perPage": per_page});

    let page1 = ok(&fx.engine, "tasks.list", params(1, 2));
    let pulls = page1["pulls"].as_array().unwrap();
    let numbers: Vec<u64> = pulls
        .iter()
        .map(|pull| pull["number"].as_u64().unwrap())
        .collect();
    assert_eq!(numbers, vec![100, 99]);
    assert_eq!(page1["hasNextPage"], true);
    assert_eq!(page1["issues"].as_array().unwrap().len(), 0);

    let page3 = ok(&fx.engine, "tasks.list", params(3, 2));
    let pulls = page3["pulls"].as_array().unwrap();
    assert_eq!(pulls.len(), 1);
    assert_eq!(pulls[0]["headRefName"], "pr-96");
    assert_eq!(page3["hasNextPage"], false);

    ok(&fx.engine, "tasks.list", params(2, 2));
    let argv = fx.last_argv();
    assert!(
        argv.contains("pr list") && argv.contains("--limit 5"),
        "fetch limit must be page*perPage+1 on the pr path, got: {argv}"
    );
}

/// A pulls-mode project whose GitHub origin is served by a local bare repo:
/// the origin URL keeps the `owner/repo` slug derivation honest while a
/// repo-local `url.insteadOf` rewrite points fetches at the bare repo, so
/// `pull/<N>/head` refspecs resolve with no network and no global config.
struct PrFetchFixture {
    _origin_dir: tempfile::TempDir,
    fx: Fixture,
}

impl PrFetchFixture {
    fn new(keep_local_branch: bool) -> Self {
        let origin_dir = tempfile::tempdir().unwrap();
        git(origin_dir.path(), &["init", "-q", "--bare", "origin.git"]);
        let bare = origin_dir.path().join("origin.git");
        let fx = Fixture::new(
            Some("https://github.com/example/repo.git"),
            Some(&fake_gh_list_view()),
        );
        git(
            &fx.repo,
            &[
                "config",
                &format!("url.{}.insteadOf", bare.to_str().unwrap()),
                "https://github.com/example/repo.git",
            ],
        );
        git(&fx.repo, &["checkout", "-qb", "add-pr-flow"]);
        fs::write(fx.repo.join("pr.txt"), "pr head\n").unwrap();
        git(&fx.repo, &["add", "pr.txt"]);
        git(&fx.repo, &["commit", "-qm", "pr head"]);
        git(
            &fx.repo,
            &["push", "-q", "origin", "add-pr-flow:refs/pull/12/head"],
        );
        git(&fx.repo, &["checkout", "-q", "main"]);
        if !keep_local_branch {
            git(&fx.repo, &["branch", "-q", "-D", "add-pr-flow"]);
        }
        Self {
            _origin_dir: origin_dir,
            fx,
        }
    }
}

#[test]
fn pulls_start_fetches_the_head_branch_into_a_new_worktree() {
    let holder = PrFetchFixture::new(false);
    let fx = &holder.fx;
    let started = ok(
        &fx.engine,
        "tasks.start",
        json!({"projectId": fx.project_id, "number": 12, "mode": "pulls"}),
    );
    assert_eq!(started["issueNumber"], 12);
    assert_eq!(started["worktree"]["branch"], "add-pr-flow");
    assert_eq!(started["headBranch"], "add-pr-flow");
    assert_eq!(started["link"]["branch"], "add-pr-flow");
    let worktree_path = started["worktree"]["path"].as_str().unwrap();
    assert!(
        Path::new(worktree_path).join("pr.txt").is_file(),
        "the worktree must check out the fetched PR head content"
    );
    assert!(
        worktree_path.contains("pr-12-add-pr-flow"),
        "directory name stays slash-safe, got: {worktree_path}"
    );

    let links = ok(
        &fx.engine,
        "tasks.links",
        json!({"projectId": fx.project_id}),
    );
    let links = links["links"].as_array().unwrap();
    assert_eq!(links.len(), 1);
    assert_eq!(links[0]["issueNumber"], 12);

    let again = ok(
        &fx.engine,
        "tasks.start",
        json!({"projectId": fx.project_id, "number": 12, "mode": "pulls"}),
    );
    assert_eq!(
        again["worktree"]["id"], started["worktree"]["id"],
        "a repeated PR start must reuse the linked worktree"
    );
}

#[test]
fn pulls_start_reuses_a_pre_existing_local_head_branch() {
    // The head branch already exists locally (a local checkout of the same
    // PR): the no-force fetch refuses, and the start reuses the verified
    // branch instead of failing or forcing.
    let holder = PrFetchFixture::new(true);
    let fx = &holder.fx;
    let started = ok(
        &fx.engine,
        "tasks.start",
        json!({"projectId": fx.project_id, "number": 12, "mode": "pulls"}),
    );
    assert_eq!(started["worktree"]["branch"], "add-pr-flow");
    assert!(
        Path::new(started["worktree"]["path"].as_str().unwrap())
            .join("pr.txt")
            .is_file(),
    );
}

#[test]
fn pulls_start_without_a_fetchable_head_fails_honestly() {
    let fx = Fixture::new(
        Some("https://github.com/example/repo.git"),
        Some(&fake_gh_list_view()),
    );
    // No PR refs exist on this origin, and no local branch either: the
    // fetch and the reuse probe both fail, so the start is an io_error,
    // never a worktree on the wrong content.
    assert_eq!(
        err_code(
            &fx.engine,
            "tasks.start",
            json!({"projectId": fx.project_id, "number": 12, "mode": "pulls"}),
        ),
        "io_error"
    );
}

#[test]
fn pulls_list_without_gh_is_gh_unavailable() {
    let fx = Fixture::new(Some("https://github.com/example/repo.git"), None);
    fx.set_gh_bin(Some(fx._root.path().join("does-not-exist-gh")));
    assert_eq!(
        err_code(
            &fx.engine,
            "tasks.list",
            json!({"projectId": fx.project_id, "mode": "pulls"}),
        ),
        "gh_unavailable"
    );
}

#[test]
fn folder_projects_and_bad_params_fail_honestly() {
    let fx = Fixture::new(
        Some("https://github.com/example/repo.git"),
        Some(&fake_gh_list_view()),
    );
    let folder = tempfile::tempdir().unwrap();
    let added = ok(
        &fx.engine,
        "project.add",
        json!({"path": folder.path().to_str().unwrap()}),
    );
    assert_eq!(added["kind"], "folder");
    let folder_id = added["id"].as_str().unwrap();
    for method in ["tasks.list", "tasks.links"] {
        assert_eq!(
            err_code(&fx.engine, method, json!({"projectId": folder_id})),
            "invalid_argument",
            "{method} on a folder project"
        );
    }
    assert_eq!(
        err_code(
            &fx.engine,
            "tasks.start",
            json!({"projectId": folder_id, "number": 7}),
        ),
        "invalid_argument"
    );
    assert_eq!(
        err_code(
            &fx.engine,
            "tasks.list",
            json!({"projectId": "does-not-exist"}),
        ),
        "not_found"
    );
    assert_eq!(
        err_code(
            &fx.engine,
            "tasks.show",
            json!({"projectId": fx.project_id, "number": 0}),
        ),
        "invalid_argument"
    );
}
