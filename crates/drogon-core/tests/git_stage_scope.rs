//! #175: scoped staging. "Stage all" inside the Untracked Files group must
//! stage exactly that group's paths (`git add -- <untracked paths>`), never
//! `git add -A`; the Changes group's Stage all stages only tracked changes.
//! Fixtures are owned temp dirs; real `git` is spawned by binary name for
//! setup and for the final ground-truth assertion.

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
        request_id: format!("git-stage-scope-{id}"),
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

const UNTRACKED_ODD: &str = "<!-- qa edit r1 -->.html";
const UNTRACKED_PLAIN: &str = "cli-created.txt";

impl Fixture {
    /// The exact #175 layout: one tracked deletion plus two untracked files.
    fn qa_175() -> Self {
        let root = tempfile::tempdir().unwrap();
        let repo = root.path().join("repo");
        fs::create_dir(&repo).unwrap();
        git(&repo, &["init", "-q", "-b", "qa-main"]);
        git(&repo, &["config", "user.email", "fixture@example.com"]);
        git(&repo, &["config", "user.name", "fixture"]);
        fs::write(repo.join("index.html"), "hello\n").unwrap();
        git(&repo, &["add", "index.html"]);
        git(&repo, &["commit", "-q", "-m", "init"]);
        // Unstaged tracked deletion plus two untracked files.
        fs::remove_file(repo.join("index.html")).unwrap();
        fs::write(repo.join(UNTRACKED_ODD), "<!-- qa edit r1 -->").unwrap();
        fs::write(repo.join(UNTRACKED_PLAIN), "cli\n").unwrap();
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
}

#[test]
fn stage_all_in_untracked_files_stages_only_untracked_paths() {
    let fx = Fixture::qa_175();
    // Ground truth before: unstaged deletion plus two untracked files.
    let before = git(&fx.repo, &["status", "--short"]);
    assert!(before.contains(" D index.html"), "{before:?}");
    assert!(before.contains(UNTRACKED_PLAIN), "{before:?}");

    // Exactly what the panel sends for the Untracked Files "Stage all".
    let staged = call(
        &fx.engine,
        "git.stage",
        fx.params(json!({"paths": [UNTRACKED_ODD, UNTRACKED_PLAIN]})),
    );
    assert!(staged.ok, "{staged:?}");

    // The tracked deletion must stay unstaged; both untracked files stage.
    let after = git(&fx.repo, &["status", "--short"]);
    assert!(
        after.contains(" D index.html"),
        "tracked deletion must stay unstaged: {after:?}"
    );
    assert!(
        after.contains(&format!("A  {UNTRACKED_PLAIN}")),
        "plain untracked file must stage: {after:?}"
    );
    assert!(
        after
            .lines()
            .any(|line| line.starts_with("A ") && line.contains("qa edit r1")),
        "odd-named untracked file must stage: {after:?}"
    );

    // The status read back through the daemon agrees with git (porcelain v2
    // marks the unmodified side with `.`, not a space).
    let entries = fx.status_entries();
    let staged_paths: Vec<&str> = entries
        .iter()
        .filter(|entry| entry["staged"] != "." && entry["staged"] != " ")
        .map(|entry| entry["path"].as_str().unwrap())
        .collect();
    assert_eq!(staged_paths.len(), 2, "{entries:?}");
    assert!(
        !staged_paths.contains(&"index.html"),
        "index.html must not stage: {entries:?}"
    );
}

#[test]
fn stage_all_in_changes_stages_only_the_tracked_deletion() {
    let fx = Fixture::qa_175();
    // Exactly what the panel sends for the Changes "Stage all".
    let staged = call(
        &fx.engine,
        "git.stage",
        fx.params(json!({"paths": ["index.html"]})),
    );
    assert!(staged.ok, "{staged:?}");

    let after = git(&fx.repo, &["status", "--short"]);
    assert!(after.contains("D  index.html"), "{after:?}");
    assert!(
        after
            .lines()
            .any(|line| line.starts_with("??") && line.contains("qa edit r1")),
        "odd-named file must stay untracked: {after:?}"
    );
    assert!(
        after.contains(&format!("?? {UNTRACKED_PLAIN}")),
        "{after:?}"
    );
}
