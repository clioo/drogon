//! #176 residual: `git.status` carries `branch.baseRef`, the repo's
//! default base ref for the clean-state sentence ("ahead of origin/main",
//! never a literal "base" when a default exists). Resolution is fork
//! parity (src/main/git/repo-default-base-ref.ts): a verified
//! `refs/remotes/origin/HEAD` first, then the fixed probe ladder
//! (origin/main, origin/master, main, master), else null. Fixtures are
//! owned temp dirs; real `git` is spawned by binary name for setup.

use drogon_core::Engine;
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
        request_id: format!("git-status-base-ref-{id}"),
        auth: None,
        method: method.into(),
        params,
    })
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

struct Fixture {
    _root: tempfile::TempDir,
    engine: Engine,
    repo: PathBuf,
    workspace_id: String,
    host_id: String,
}

impl Fixture {
    /// A one-commit repo on branch `branch` with no remote.
    fn new(branch: &str) -> Self {
        let root = tempfile::tempdir().unwrap();
        let repo = root.path().join("repo");
        fs::create_dir(&repo).unwrap();
        git(&repo, &["init", "-q", "-b", branch]);
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

    fn branch_payload(&self) -> Value {
        let result = call(
            &self.engine,
            "git.status",
            json!({"workspaceId": self.workspace_id, "hostId": self.host_id}),
        );
        assert!(result.ok, "{result:?}");
        result.result.unwrap()["branch"].clone()
    }
}

/// Adds `origin` pointing at a throwaway bare repo with the given default
/// branch, then fetches it so the remote refs exist locally.
fn add_origin_with_default_branch(fx: &Fixture, default_branch: &str) {
    let bare = fx._root.path().join("origin.git");
    git(
        fx._root.path(),
        &["init", "-q", "--bare", "-b", default_branch, "origin.git"],
    );
    // Seed the bare repo with one commit on the default branch.
    let seed = fx._root.path().join("seed");
    fs::create_dir(&seed).unwrap();
    git(&seed, &["init", "-q", "-b", default_branch]);
    git(&seed, &["config", "user.email", "fixture@example.com"]);
    git(&seed, &["config", "user.name", "fixture"]);
    fs::write(seed.join("seed.txt"), "seed\n").unwrap();
    git(&seed, &["add", "seed.txt"]);
    git(&seed, &["commit", "-q", "-m", "seed"]);
    git(
        &seed,
        &["push", "-q", bare.to_str().unwrap(), default_branch],
    );
    git(
        &fx.repo,
        &["remote", "add", "origin", bare.to_str().unwrap()],
    );
    git(&fx.repo, &["fetch", "-q", "origin"]);
}

#[test]
fn repo_without_any_candidate_reports_a_null_base_ref() {
    let fx = Fixture::new("main");
    // No remote and the local branch is `main`... which IS a probe
    // candidate, so rename the branch to something outside the ladder.
    git(&fx.repo, &["branch", "-m", "main", "topic"]);
    let branch = fx.branch_payload();
    assert_eq!(branch["baseRef"], Value::Null, "{branch:?}");
}

#[test]
fn local_main_resolves_without_a_remote() {
    let fx = Fixture::new("main");
    let branch = fx.branch_payload();
    assert_eq!(branch["baseRef"], json!("main"), "{branch:?}");
}

#[test]
fn local_master_is_the_ladder_fallback() {
    let fx = Fixture::new("master");
    let branch = fx.branch_payload();
    assert_eq!(branch["baseRef"], json!("master"), "{branch:?}");
}

#[test]
fn origin_head_wins_when_verified() {
    let fx = Fixture::new("main");
    add_origin_with_default_branch(&fx, "main");
    git(&fx.repo, &["remote", "set-head", "origin", "main"]);
    let branch = fx.branch_payload();
    assert_eq!(branch["baseRef"], json!("origin/main"), "{branch:?}");
}

#[test]
fn origin_head_pointing_at_master_reports_origin_master() {
    let fx = Fixture::new("main");
    add_origin_with_default_branch(&fx, "master");
    git(&fx.repo, &["remote", "set-head", "origin", "master"]);
    let branch = fx.branch_payload();
    assert_eq!(branch["baseRef"], json!("origin/master"), "{branch:?}");
}

#[test]
fn remote_main_beats_local_master() {
    // The repo works on master locally; origin carries main. The ladder
    // prefers the remote default (fork parity).
    let fx = Fixture::new("master");
    add_origin_with_default_branch(&fx, "main");
    let branch = fx.branch_payload();
    assert_eq!(branch["baseRef"], json!("origin/main"), "{branch:?}");
}
