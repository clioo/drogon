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

/// A fake `gh` that answers `issue list`/`issue view` from fixture JSON and
/// records its last argv in the repo (`$PWD/.gh-argv-last`) so tests can
/// prove which `--repo`/`--state` the core derived.
fn fake_gh_list_view() -> String {
    format!(
        "#!/bin/sh\necho \"$*\" > \"$PWD/.gh-argv-last\"\n\
         if [ \"$2\" = \"list\" ]; then\ncat <<'EOF'\n{LIST_JSON}\nEOF\n\
         elif [ \"$2\" = \"view\" ] && [ \"$3\" = \"7\" ]; then\ncat <<'EOF'\n{VIEW_JSON_7}\nEOF\n\
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
