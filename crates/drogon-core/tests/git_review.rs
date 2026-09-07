//! Journey J2 review RPCs through the public `Engine` API: status, unified
//! diff, stage/unstage, commit, push to a temp bare remote, and the typed
//! `gh_unavailable` error. Fixtures are owned temp dirs; `git`/`gh` stand-ins
//! are spawned by direct binary path, never via process-global `PATH`
//! mutation (the `*_with_bin` seams exist for exactly this).

use drogon_core::Engine;
use drogon_core::git_process;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

static IDS: AtomicUsize = AtomicUsize::new(0);

fn call(engine: &Engine, method: &str, params: Value) -> Response {
    let id = IDS.fetch_add(1, Ordering::Relaxed);
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: format!("git-review-{id}"),
        auth: None,
        method: method.into(),
        params,
    })
}

struct Fixture {
    _root: tempfile::TempDir,
    engine: Engine,
    repo: PathBuf,
    workspace_id: String,
    host_id: String,
}

impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let repo = root.path().join("repo");
        fs::create_dir(&repo).unwrap();
        git(&repo, &["init", "-q", "-b", "main"]);
        git(&repo, &["config", "user.email", "fixture@example.com"]);
        git(&repo, &["config", "user.name", "fixture"]);
        fs::write(repo.join("tracked.txt"), "one\n").unwrap();
        git(&repo, &["add", "tracked.txt"]);
        git(&repo, &["commit", "-q", "-m", "init"]);
        let engine = Engine::open(&root.path().join("data")).unwrap();
        let registered = call(
            &engine,
            "workspace.register",
            json!({"path": repo.to_str().unwrap()}),
        );
        assert!(registered.ok, "{registered:?}");
        let registered = registered.result.unwrap();
        Fixture {
            _root: root,
            engine,
            repo,
            workspace_id: registered["id"].as_str().unwrap().to_string(),
            host_id: registered["hostId"].as_str().unwrap().to_string(),
        }
    }

    fn params(&self, extra: Value) -> Value {
        let mut base = json!({"workspaceId": self.workspace_id, "hostId": self.host_id});
        for (key, value) in extra.as_object().unwrap() {
            base[key] = value.clone();
        }
        base
    }

    fn status(&self) -> Value {
        let result = call(&self.engine, "git.status", self.params(json!({})));
        assert!(result.ok, "{result:?}");
        result.result.unwrap()
    }

    fn entries(&self) -> Vec<Value> {
        self.status()["entries"].as_array().unwrap().clone()
    }
}

fn git(cwd: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn real git for fixture setup");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

fn entry_by_path(entries: &[Value], path: &str) -> Value {
    entries
        .iter()
        .find(|e| e["path"] == path)
        .unwrap_or_else(|| panic!("no status entry for {path}: {entries:?}"))
        .clone()
}

#[test]
fn status_reports_branch_and_kinds() {
    let fx = Fixture::new();
    fs::write(fx.repo.join("tracked.txt"), "one\ntwo\n").unwrap();
    fs::write(fx.repo.join("new.txt"), "untracked\n").unwrap();
    let status = fx.status();
    assert_eq!(status["workspaceId"], fx.workspace_id);
    assert_eq!(status["hostId"], fx.host_id);
    assert_eq!(status["branch"]["head"], "main");
    let entries = status["entries"].as_array().unwrap();
    assert_eq!(entry_by_path(entries, "tracked.txt")["kind"], "ordinary");
    assert_eq!(entry_by_path(entries, "new.txt")["kind"], "untracked");
}

#[test]
fn diff_stage_unstage_round_trip() {
    let fx = Fixture::new();
    fs::write(fx.repo.join("tracked.txt"), "one\ntwo\n").unwrap();

    let diff = call(
        &fx.engine,
        "git.diff",
        fx.params(json!({"path": "tracked.txt"})),
    );
    assert!(diff.ok, "{diff:?}");
    let diff = diff.result.unwrap();
    assert_eq!(diff["staged"], false);
    assert_eq!(diff["truncated"], false);
    assert!(diff["diff"].as_str().unwrap().contains("+two"));

    let stage = call(
        &fx.engine,
        "git.stage",
        fx.params(json!({"paths": ["tracked.txt"]})),
    );
    assert!(stage.ok, "{stage:?}");

    let unstaged = call(
        &fx.engine,
        "git.diff",
        fx.params(json!({"path": "tracked.txt"})),
    )
    .result
    .unwrap();
    assert_eq!(unstaged["diff"], "");
    let staged = call(
        &fx.engine,
        "git.diff",
        fx.params(json!({"path": "tracked.txt", "staged": true})),
    );
    assert!(staged.ok, "{staged:?}");
    assert!(
        staged.result.unwrap()["diff"]
            .as_str()
            .unwrap()
            .contains("+two")
    );

    let unstage = call(
        &fx.engine,
        "git.unstage",
        fx.params(json!({"paths": ["tracked.txt"]})),
    );
    assert!(unstage.ok, "{unstage:?}");
    let entries = fx.entries();
    let entry = entry_by_path(&entries, "tracked.txt");
    // Porcelain v2 spells "unmodified" as `.`, not v1's space.
    assert_eq!(entry["staged"], ".");
    assert_eq!(entry["unstaged"], "M");
}

#[test]
fn commit_returns_oid_and_cleans_status() {
    let fx = Fixture::new();
    fs::write(fx.repo.join("tracked.txt"), "changed\n").unwrap();
    call(
        &fx.engine,
        "git.stage",
        fx.params(json!({"paths": ["tracked.txt"]})),
    );
    let commit = call(
        &fx.engine,
        "git.commit",
        fx.params(json!({"message": "review commit"})),
    );
    assert!(commit.ok, "{commit:?}");
    let oid = commit.result.unwrap()["commit"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(oid.len(), 40);
    assert_eq!(git(&fx.repo, &["rev-parse", "HEAD"]).trim(), oid);
    assert!(fx.entries().is_empty());
}

#[test]
fn push_delivers_the_rpc_commit_to_a_bare_remote() {
    let fx = Fixture::new();
    let remote = fx._root.path().join("remote.git");
    git(fx._root.path(), &["init", "-q", "--bare", "remote.git"]);
    git(
        &fx.repo,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    );
    // Setup-only push establishing the upstream; the asserted push below
    // runs entirely through the RPC.
    git(&fx.repo, &["push", "-q", "-u", "origin", "main"]);

    fs::write(fx.repo.join("tracked.txt"), "pushed\n").unwrap();
    call(
        &fx.engine,
        "git.stage",
        fx.params(json!({"paths": ["tracked.txt"]})),
    );
    call(
        &fx.engine,
        "git.commit",
        fx.params(json!({"message": "to push"})),
    );
    let push = call(&fx.engine, "git.push", fx.params(json!({})));
    assert!(push.ok, "{push:?}");
    assert_eq!(push.result.unwrap()["pushed"], true);

    let local = git(&fx.repo, &["rev-parse", "HEAD"]);
    let remote_head = git(
        fx._root.path(),
        &["--git-dir", "remote.git", "rev-parse", "main"],
    );
    assert_eq!(local, remote_head);
}

#[test]
fn wrong_host_and_bad_paths_are_rejected_before_any_spawn() {
    let fx = Fixture::new();
    let mut foreign = fx.params(json!({"path": "tracked.txt"}));
    foreign["hostId"] = json!("another-host");
    for method in [
        "git.status",
        "git.diff",
        "git.stage",
        "git.unstage",
        "git.commit",
        "git.push",
        "git.pr_create",
    ] {
        let mut params = foreign.clone();
        params["message"] = json!("msg");
        params["paths"] = json!(["tracked.txt"]);
        params["title"] = json!("title");
        let result = call(&fx.engine, method, params);
        assert_eq!(result.error.unwrap().code, "unsupported_host", "{method}");
    }
    for params in [
        fx.params(json!({"path": "../escape"})),
        fx.params(json!({"paths": ["../escape"]})),
        fx.params(json!({"message": ""})),
    ] {
        let method = if params.get("message").is_some() {
            "git.commit"
        } else if params.get("paths").is_some() {
            "git.stage"
        } else {
            "git.diff"
        };
        let result = call(&fx.engine, method, params);
        assert_eq!(result.error.unwrap().code, "invalid_argument", "{method}");
    }
    assert!(fx.entries().is_empty());
}

fn write_executable(dir: &Path, name: &str, body: &str) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, body).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    }
    path
}

#[test]
fn gh_reports_url_or_typed_unavailable_without_touching_path() {
    let fx = Fixture::new();
    let budget = git_process::git_mutation_budget();
    let ok_bin = write_executable(
        fx._root.path(),
        "gh-ok",
        "#!/bin/sh\necho 'https://github.com/example/repo/pull/42'\n",
    );
    let url = git_process::run_gh_pr_create_with_bin(&ok_bin, &fx.repo, "title", None, &budget)
        .expect("fake gh printing a URL must succeed");
    assert_eq!(url, "https://github.com/example/repo/pull/42");

    let auth_bin = write_executable(
        fx._root.path(),
        "gh-auth",
        "#!/bin/sh\necho 'error: To get started with GitHub, please run: gh auth login' >&2\nexit 1\n",
    );
    let err = git_process::run_gh_pr_create_with_bin(&auth_bin, &fx.repo, "title", None, &budget)
        .expect_err("auth-shaped gh failure must fail");
    assert_eq!(err.code, "gh_unavailable");

    let missing = fx._root.path().join("does-not-exist-gh");
    let err = git_process::run_gh_pr_create_with_bin(&missing, &fx.repo, "title", None, &budget)
        .expect_err("missing gh binary must fail typed");
    assert_eq!(err.code, "gh_unavailable");

    let repo_err_bin = write_executable(
        fx._root.path(),
        "gh-repo",
        "#!/bin/sh\necho 'no remotes found' >&2\nexit 1\n",
    );
    let err =
        git_process::run_gh_pr_create_with_bin(&repo_err_bin, &fx.repo, "title", None, &budget)
            .expect_err("non-auth gh failure must fail");
    assert_eq!(err.code, "io_error");
}
