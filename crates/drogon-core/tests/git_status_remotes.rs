//! #176: `git.status` reports remote names so the panel distinguishes "no
//! remote configured" from "no upstream on an existing remote". Fixtures
//! are owned temp dirs; real `git` is spawned by binary name for setup.

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
        request_id: format!("git-status-remotes-{id}"),
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

    fn branch(&self) -> Value {
        let result = call(
            &self.engine,
            "git.status",
            json!({"workspaceId": self.workspace_id, "hostId": self.host_id}),
        );
        assert!(result.ok, "{result:?}");
        result.result.unwrap()["branch"].clone()
    }
}

#[test]
fn status_on_a_repo_without_a_remote_reports_an_empty_remote_list() {
    let fx = Fixture::new();
    assert!(git(&fx.repo, &["remote"]).is_empty());
    let branch = fx.branch();
    assert_eq!(branch["upstream"], Value::Null, "{branch:?}");
    let remotes = branch["remotes"].as_array().unwrap();
    assert!(remotes.is_empty(), "{branch:?}");
}

#[test]
fn status_lists_remote_names_but_never_urls() {
    let fx = Fixture::new();
    let remote = fx._root.path().join("remote.git");
    git(fx._root.path(), &["init", "-q", "--bare", "remote.git"]);
    git(
        &fx.repo,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    );
    let branch = fx.branch();
    let remotes: Vec<&str> = branch["remotes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|name| name.as_str().unwrap())
        .collect();
    assert_eq!(remotes, vec!["origin"], "{branch:?}");
    // The raw wire JSON must not carry the URL (credentials can hide in
    // remote URLs), only the name.
    let wire = serde_json::to_string(&branch).unwrap();
    assert!(!wire.contains("://"), "{wire:?}");
    assert!(!wire.contains("remote.git"), "{wire:?}");
}

#[test]
fn status_distinguishes_no_upstream_from_no_remote() {
    let fx = Fixture::new();
    let remote = fx._root.path().join("remote.git");
    git(fx._root.path(), &["init", "-q", "--bare", "remote.git"]);
    git(
        &fx.repo,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    );
    // Remote exists, but this branch tracks nothing: upstream null,
    // remotes non-empty — the panel's two distinct states.
    let branch = fx.branch();
    assert_eq!(branch["upstream"], Value::Null, "{branch:?}");
    assert_eq!(branch["remotes"], json!(["origin"]), "{branch:?}");

    git(&fx.repo, &["push", "-q", "-u", "origin", "main"]);
    let branch = fx.branch();
    assert_eq!(branch["upstream"], json!("origin/main"), "{branch:?}");
    assert_eq!(branch["remotes"], json!(["origin"]), "{branch:?}");
}
