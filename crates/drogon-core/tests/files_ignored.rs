//! `files.ignored` (R16-AM) through the public `Engine` API: the explorer's
//! visible-row query reports git-ignored paths for dimming, like the
//! reference. Fixtures are owned temp dirs with a local repo config, the
//! same shape `git_review.rs` uses; assertions use unique fixture names so
//! ambient global git excludes cannot collide with them.

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
        request_id: format!("files-ignored-{id}"),
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

    fn ignored(&self, paths: &[&str]) -> Response {
        call(
            &self.engine,
            "files.ignored",
            self.params(json!({"paths": paths})),
        )
    }
}

fn git(cwd: &Path, args: &[&str]) {
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
}

fn ignored_set(result: &Response) -> Vec<String> {
    assert!(result.ok, "{result:?}");
    result.result.as_ref().unwrap()["ignored"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect()
}

#[test]
fn reports_gitignored_paths_and_echoes_scope() {
    let fx = Fixture::new();
    fs::write(fx.repo.join(".gitignore"), "amignored-dir/\n*.amignored\n").unwrap();
    fs::create_dir(fx.repo.join("amignored-dir")).unwrap();
    fs::write(fx.repo.join("amignored-dir").join("inner.js"), "x").unwrap();
    fs::write(fx.repo.join("top.amignored"), "y").unwrap();

    let result = fx.ignored(&["tracked.txt", "amignored-dir", "top.amignored"]);
    let mut ignored = ignored_set(&result);
    ignored.sort();
    assert_eq!(ignored, vec!["amignored-dir", "top.amignored"]);
    let body = result.result.unwrap();
    assert_eq!(body["workspaceId"], fx.workspace_id);
    assert_eq!(body["hostId"], fx.host_id);
}

#[test]
fn empty_query_returns_empty_without_touching_git() {
    let fx = Fixture::new();
    let ignored = ignored_set(&fx.ignored(&[]));
    assert!(ignored.is_empty());
}

#[test]
fn non_git_workspace_returns_empty_not_an_error() {
    let root = tempfile::tempdir().unwrap();
    let plain = root.path().join("plain");
    fs::create_dir(&plain).unwrap();
    let engine = Engine::open(&root.path().join("data")).unwrap();
    let registered = call(
        &engine,
        "workspace.register",
        json!({"path": plain.to_str().unwrap()}),
    );
    assert!(registered.ok, "{registered:?}");
    let registered = registered.result.unwrap();
    let result = call(
        &engine,
        "files.ignored",
        json!({
            "workspaceId": registered["id"].as_str().unwrap(),
            "hostId": registered["hostId"].as_str().unwrap(),
            "paths": ["anything.txt"],
        }),
    );
    assert!(result.ok, "{result:?}");
    assert!(
        result.result.unwrap()["ignored"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn rejects_absolute_and_parent_escape_paths() {
    let fx = Fixture::new();
    for bad in ["/etc/passwd", "../escape.txt"] {
        let result = fx.ignored(&[bad]);
        assert!(!result.ok, "{bad}: {result:?}");
    }
}

#[test]
fn rejects_overlong_batches() {
    let fx = Fixture::new();
    let many: Vec<String> = (0..201).map(|i| format!("f{i}.txt")).collect();
    let refs: Vec<&str> = many.iter().map(String::as_str).collect();
    let result = fx.ignored(&refs);
    assert!(!result.ok, "{result:?}");
}
