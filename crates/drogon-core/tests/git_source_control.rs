//! R10-B Source Control RPCs through the public `Engine` API: discard
//! (tracked restore via `git checkout --`, untracked removal via scoped
//! `git clean -fd`), per-file line counts, and fast-forward-only pull plus
//! default-remote fetch against a temp bare remote. Fixtures are owned temp
//! dirs; real `git` is spawned by binary name for setup only.

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
        request_id: format!("git-source-control-{id}"),
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

    fn status_entries(&self) -> Vec<Value> {
        let result = call(&self.engine, "git.status", self.params(json!({})));
        assert!(result.ok, "{result:?}");
        result.result.unwrap()["entries"]
            .as_array()
            .unwrap()
            .clone()
    }

    fn count_for(&self, paths: &[&str]) -> Vec<Value> {
        let result = call(
            &self.engine,
            "git.line_counts",
            self.params(json!({"paths": paths})),
        );
        assert!(result.ok, "{result:?}");
        result.result.unwrap()["counts"].as_array().unwrap().clone()
    }
}

fn git(cwd: &Path, args: &[&str]) -> String {
    // Fixture git must not see the developer's global/system config
    // (default branch, hooks, signing, templates) or prompt for anything.
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_AUTHOR_NAME", "fixture")
        .env("GIT_AUTHOR_EMAIL", "fixture@example.com")
        .env("GIT_COMMITTER_NAME", "fixture")
        .env("GIT_COMMITTER_EMAIL", "fixture@example.com")
        .output()
        .expect("spawn real git for fixture setup");
    assert!(
        output.status.success(),
        "git {args:?} failed (status {:?})\nstdout: {}\nstderr: {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

#[test]
fn discard_tracked_restores_modified_and_deleted_files() {
    let fx = Fixture::new();
    fs::write(fx.repo.join("tracked.txt"), "changed\n").unwrap();
    fs::write(fx.repo.join("gone.txt"), "bye\n").unwrap();
    git(&fx.repo, &["add", "gone.txt"]);
    git(&fx.repo, &["commit", "-q", "-m", "second"]);
    fs::remove_file(fx.repo.join("gone.txt")).unwrap();

    let discard = call(
        &fx.engine,
        "git.discard",
        fx.params(json!({"paths": ["tracked.txt", "gone.txt"], "untracked": false})),
    );
    assert!(discard.ok, "{discard:?}");
    assert_eq!(
        discard.result.unwrap()["paths"],
        json!(["tracked.txt", "gone.txt"])
    );
    assert_eq!(
        fs::read_to_string(fx.repo.join("tracked.txt")).unwrap(),
        "one\n"
    );
    assert_eq!(
        fs::read_to_string(fx.repo.join("gone.txt")).unwrap(),
        "bye\n"
    );
    assert!(fx.status_entries().is_empty());
}

#[test]
fn discard_untracked_removes_only_the_selected_paths() {
    let fx = Fixture::new();
    fs::write(fx.repo.join("scratch.txt"), "tmp\n").unwrap();
    fs::write(fx.repo.join("keep.txt"), "keep\n").unwrap();
    fs::create_dir(fx.repo.join("scratch-dir")).unwrap();
    fs::write(fx.repo.join("scratch-dir").join("inner.txt"), "tmp\n").unwrap();

    let discard = call(
        &fx.engine,
        "git.discard",
        fx.params(json!({"paths": ["scratch.txt", "scratch-dir"], "untracked": true})),
    );
    assert!(discard.ok, "{discard:?}");
    assert!(!fx.repo.join("scratch.txt").exists());
    assert!(!fx.repo.join("scratch-dir").exists());
    // Not selected: survives. Tracked fixture file: untouched.
    assert!(fx.repo.join("keep.txt").exists());
    assert_eq!(
        fs::read_to_string(fx.repo.join("tracked.txt")).unwrap(),
        "one\n"
    );
    let entries = fx.status_entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["path"], "keep.txt");
}

#[test]
fn discard_rejects_traversal_and_empty_lists() {
    let fx = Fixture::new();
    for params in [
        fx.params(json!({"paths": ["../escape"], "untracked": false})),
        fx.params(json!({"paths": [], "untracked": true})),
        fx.params(json!({"paths": ["tracked.txt"]})),
    ] {
        let result = call(&fx.engine, "git.discard", params);
        assert!(!result.ok, "{result:?}");
        assert_eq!(result.error.unwrap().code, "invalid_argument");
    }
    // Nothing was touched by the rejected calls.
    assert_eq!(
        fs::read_to_string(fx.repo.join("tracked.txt")).unwrap(),
        "one\n"
    );
}

#[test]
fn line_counts_split_staged_unstaged_and_untracked() {
    let fx = Fixture::new();
    // Two staged additions, one unstaged addition.
    fs::write(fx.repo.join("tracked.txt"), "one\ntwo\nthree\n").unwrap();
    git(&fx.repo, &["add", "tracked.txt"]);
    fs::write(fx.repo.join("tracked.txt"), "one\ntwo\nthree\nfour\n").unwrap();
    fs::write(fx.repo.join("fresh.txt"), "a\nb\nc\n").unwrap();

    let counts = fx.count_for(&["tracked.txt", "fresh.txt"]);
    let tracked = counts.iter().find(|c| c["path"] == "tracked.txt").unwrap();
    assert_eq!(tracked["stagedAdded"], 2);
    assert_eq!(tracked["stagedRemoved"], 0);
    assert_eq!(tracked["unstagedAdded"], 1);
    assert_eq!(tracked["unstagedRemoved"], 0);
    let fresh = counts.iter().find(|c| c["path"] == "fresh.txt").unwrap();
    assert_eq!(fresh["unstagedAdded"], 3);
    assert_eq!(fresh["unstagedRemoved"], 0);
}

#[test]
fn line_counts_report_null_for_binary() {
    let fx = Fixture::new();
    fs::write(fx.repo.join("blob.bin"), [0u8, 1, 2, 3, b'\n']).unwrap();
    git(&fx.repo, &["add", "blob.bin"]);

    let counts = fx.count_for(&["blob.bin"]);
    let blob = &counts[0];
    assert_eq!(blob["path"], "blob.bin");
    assert!(blob["stagedAdded"].is_null(), "{blob:?}");
    assert!(blob["unstagedAdded"].is_null(), "{blob:?}");
}

#[test]
fn line_counts_reject_bad_paths() {
    let fx = Fixture::new();
    let result = call(
        &fx.engine,
        "git.line_counts",
        fx.params(json!({"paths": ["../escape"]})),
    );
    assert!(!result.ok, "{result:?}");
    assert_eq!(result.error.unwrap().code, "invalid_argument");
}

#[test]
fn commit_amend_folds_into_the_previous_commit() {
    let fx = Fixture::new();
    let before = git(&fx.repo, &["rev-list", "--count", "HEAD"]);
    fs::write(fx.repo.join("tracked.txt"), "amended\n").unwrap();
    call(
        &fx.engine,
        "git.stage",
        fx.params(json!({"paths": ["tracked.txt"]})),
    );
    let amend = call(
        &fx.engine,
        "git.commit",
        fx.params(json!({"message": "amended init", "amend": true})),
    );
    assert!(amend.ok, "{amend:?}");
    assert_eq!(
        git(&fx.repo, &["rev-list", "--count", "HEAD"]).trim(),
        before.trim()
    );
    assert_eq!(
        git(&fx.repo, &["log", "-1", "--format=%s"]).trim(),
        "amended init"
    );
    assert_eq!(
        fs::read_to_string(fx.repo.join("tracked.txt")).unwrap(),
        "amended\n"
    );
}

#[test]
fn pull_fast_forwards_from_a_bare_remote() {
    let fx = Fixture::new();
    let remote = fx._root.path().join("remote.git");
    git(
        fx._root.path(),
        &["init", "-q", "--bare", "-b", "main", "remote.git"],
    );
    git(
        &fx.repo,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    );
    git(&fx.repo, &["push", "-q", "-u", "origin", "main"]);
    // Simulate falling behind: the remote keeps the commit, we rewind.
    git(&fx.repo, &["reset", "-q", "--hard", "HEAD~0"]);
    fs::write(fx.repo.join("tracked.txt"), "ahead\n").unwrap();
    git(&fx.repo, &["commit", "-q", "-am", "ahead"]);
    git(&fx.repo, &["push", "-q", "origin", "main"]);
    git(&fx.repo, &["reset", "-q", "--hard", "HEAD~1"]);

    let pull = call(&fx.engine, "git.pull", fx.params(json!({})));
    assert!(pull.ok, "{pull:?}");
    assert!(!pull.result.unwrap()["detail"].as_str().unwrap().is_empty());
    assert_eq!(
        git(&fx.repo, &["rev-parse", "HEAD"]).trim(),
        git(&fx.repo, &["rev-parse", "origin/main"]).trim()
    );
    assert_eq!(
        fs::read_to_string(fx.repo.join("tracked.txt")).unwrap(),
        "ahead\n"
    );
}

#[test]
fn fetch_updates_remote_tracking_without_touching_the_worktree() {
    let fx = Fixture::new();
    let remote = fx._root.path().join("remote.git");
    git(
        fx._root.path(),
        &["init", "-q", "--bare", "-b", "main", "remote.git"],
    );
    git(
        &fx.repo,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    );
    git(&fx.repo, &["push", "-q", "-u", "origin", "main"]);

    // Advance the remote from a second clone, then fetch here.
    let other = fx._root.path().join("other");
    git(
        fx._root.path(),
        &["clone", "-q", remote.to_str().unwrap(), "other"],
    );
    git(&other, &["config", "user.email", "fixture@example.com"]);
    git(&other, &["config", "user.name", "fixture"]);
    fs::write(other.join("tracked.txt"), "remote-side\n").unwrap();
    git(&other, &["commit", "-q", "-am", "remote side"]);
    git(&other, &["push", "-q", "origin", "main"]);

    // Local uncommitted work must survive the fetch untouched.
    fs::write(fx.repo.join("tracked.txt"), "local\n").unwrap();
    let fetch = call(&fx.engine, "git.fetch", fx.params(json!({})));
    assert!(fetch.ok, "{fetch:?}");
    assert_eq!(
        git(&fx.repo, &["rev-parse", "origin/main"]).trim(),
        git(&other, &["rev-parse", "HEAD"]).trim()
    );
    assert_eq!(
        fs::read_to_string(fx.repo.join("tracked.txt")).unwrap(),
        "local\n"
    );
    // Behind-by-one is now visible in status.
    let status = call(&fx.engine, "git.status", fx.params(json!({})));
    assert!(status.ok, "{status:?}");
    assert_eq!(status.result.unwrap()["branch"]["behind"], 1);
}
