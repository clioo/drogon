//! Issue #690, the check-and-use half of `worktree.create`: the path guards
//! run before `git worktree add`, and nothing holds the filesystem still in
//! between. This test owns a whole test binary because it replaces `git` on
//! `PATH` for the duration -- an environment mutation no sibling test may
//! observe -- and the wrapper it installs is what rearranges the tree inside
//! the window a real attacker would have to hit by timing.
#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;
use std::sync::{Mutex, MutexGuard};

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

fn req(method: &str, params: Value) -> Request {
    serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": method,
        "method": method,
        "params": params,
    }))
    .unwrap()
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(dir)
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?} failed in {dir:?}");
}

/// `PATH` belongs to the process, not to one test, so a wrapper is
/// installed under a lock held for as long as it is on `PATH` -- without
/// it, two tests in this binary rewrite the same variable and each sees the
/// other's `git`. The guard also restores the previous value however the
/// test ends, so a panic cannot leak the wrapper into the rest of the run
/// (the lock is poisoned by that panic, which fails the waiting test rather
/// than letting it run against a wrapper it did not install).
static PATH_LOCK: Mutex<()> = Mutex::new(());

struct SavedPath {
    previous: Option<std::ffi::OsString>,
    _lock: MutexGuard<'static, ()>,
}

impl SavedPath {
    fn prepend(dir: &Path) -> Self {
        let lock = PATH_LOCK.lock().unwrap();
        let previous = std::env::var_os("PATH");
        let mut entries = vec![dir.to_path_buf()];
        if let Some(current) = &previous {
            entries.extend(std::env::split_paths(current));
        }
        let joined = std::env::join_paths(entries).unwrap();
        unsafe { std::env::set_var("PATH", &joined) };
        SavedPath {
            previous,
            _lock: lock,
        }
    }
}

impl Drop for SavedPath {
    fn drop(&mut self) {
        unsafe {
            match self.previous.take() {
                Some(previous) => std::env::set_var("PATH", previous),
                None => std::env::remove_var("PATH"),
            }
        }
    }
}

/// A swap performed the instant `git worktree add` runs: the preflight
/// guards have passed and the checkout lands at the link's target.
#[test]
fn create_refuses_to_register_a_checkout_a_mid_call_swap_pushed_outside() {
    let data = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let wrapper_dir = tempfile::tempdir().unwrap();

    let real_git = real_git();
    init_repo(repo.path());

    let engine = Engine::open(data.path()).unwrap();
    let canonical_data = std::fs::canonicalize(data.path()).unwrap();
    let project = engine
        .dispatch(req(
            "project.add",
            json!({"path": repo.path().to_string_lossy()}),
        ))
        .result
        .unwrap();
    let project_id = project["id"].as_str().unwrap().to_string();

    // The project's own root under the data directory, named the way
    // `worktree.create` names it.
    let workspaces_root = canonical_data.join("workspaces").join(
        Path::new(repo.path())
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string(),
    );
    std::fs::create_dir_all(&workspaces_root).unwrap();

    // A `git` that swaps the workspaces root for a link to somewhere else
    // the instant `worktree add` is invoked -- the exact window between the
    // preflight guards and the write, made deterministic.
    let wrapper = wrapper_dir.path().join("git");
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\n\
             if [ \"$1\" = worktree ] && [ \"$2\" = add ]; then\n\
             \x20 mv {root} {root}.swapped-away\n\
             \x20 ln -s {outside} {root}\n\
             fi\n\
             exec {git} \"$@\"\n",
            root = shell_quote(&workspaces_root.to_string_lossy()),
            outside = shell_quote(&outside.path().to_string_lossy()),
            git = shell_quote(&real_git),
        ),
    )
    .unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let _path = SavedPath::prepend(wrapper_dir.path());

    let response = engine.dispatch(req(
        "worktree.create",
        json!({"projectId": project_id, "name": "raced"}),
    ));
    assert!(
        !response.ok,
        "a checkout that landed outside the workspaces tree must not register, got {:?}",
        response.result
    );
    let error = response.error.unwrap();
    assert_eq!(error.code, "invalid_argument");
    assert!(
        error.message.contains("Nothing there was deleted"),
        "the refusal tells the user the stray checkout was left alone -- got: {}",
        error.message
    );

    // No row records the outside path, so no later remove can be aimed at it.
    let listed = engine
        .dispatch(req("worktree.list", json!({"projectId": project_id})))
        .result
        .unwrap();
    for worktree in listed["worktrees"].as_array().unwrap() {
        let path = worktree["path"].as_str().unwrap();
        assert!(
            !Path::new(path).starts_with(outside.path()),
            "a workspace row points outside the data directory: {path}"
        );
    }
}

/// The `git` the wrapper delegates to, resolved before `PATH` is rewritten.
fn real_git() -> String {
    let resolved = String::from_utf8(
        Command::new("/usr/bin/env")
            .args(["which", "git"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_string();
    assert!(!resolved.is_empty(), "this test needs a real git on PATH");
    resolved
}

/// A repository with one commit on `main`, so `HEAD` resolves for
/// `worktree.create`'s default base ref.
fn init_repo(dir: &Path) {
    git(dir, &["init", "-q", "-b", "main", "."]);
    git(dir, &["config", "user.email", "t@example.com"]);
    git(dir, &["config", "user.name", "Test"]);
    std::fs::write(dir.join("README.md"), "hello\n").unwrap();
    git(dir, &["add", "README.md"]);
    git(dir, &["commit", "-qm", "first"]);
}

/// Minimal single-quoted shell literal for a path interpolated into the
/// wrapper script above.
fn shell_quote(raw: &str) -> String {
    format!("'{}'", raw.replace('\'', "'\\''"))
}

/// The later half of the same window: the swap happens after `git worktree
/// add` and after the post-add check, while the call is still resolving the
/// new checkout. Registration must not resolve the path a second time and
/// record wherever it points by then -- whatever this call does, nothing
/// outside the data directory may end up in a row.
#[test]
fn create_never_records_a_path_a_post_check_swap_moved_outside() {
    let data = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let wrapper_dir = tempfile::tempdir().unwrap();

    let real_git = real_git();
    init_repo(repo.path());

    let engine = Engine::open(data.path()).unwrap();
    let canonical_data = std::fs::canonicalize(data.path()).unwrap();
    let project = engine
        .dispatch(req(
            "project.add",
            json!({"path": repo.path().to_string_lossy()}),
        ))
        .result
        .unwrap();
    let project_id = project["id"].as_str().unwrap().to_string();
    let workspaces_root = canonical_data
        .join("workspaces")
        .join(repo.path().file_name().unwrap());
    std::fs::create_dir_all(&workspaces_root).unwrap();

    // `rev-parse` is the first git call after the post-add check, so the
    // wrapper copies the finished checkout outside, swaps the root for a
    // link to the copy, and lets git answer from there. Everything the call
    // resolves from now on points outside.
    let wrapper = wrapper_dir.path().join("git");
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\n\
             if [ \"$1\" = rev-parse ] && [ -d {root} ] && [ ! -L {root} ]; then\n\
             \x20 cp -R {root}/ {outside}/copy\n\
             \x20 mv {root} {root}.swapped-away\n\
             \x20 ln -s {outside}/copy {root}\n\
             fi\n\
             exec {git} \"$@\"\n",
            root = shell_quote(&workspaces_root.to_string_lossy()),
            outside = shell_quote(&outside.path().to_string_lossy()),
            git = shell_quote(&real_git),
        ),
    )
    .unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let _path = SavedPath::prepend(wrapper_dir.path());

    let response = engine.dispatch(req(
        "worktree.create",
        json!({"projectId": project_id, "name": "raced"}),
    ));
    if let Some(created) = &response.result {
        let recorded = created["path"].as_str().unwrap();
        assert!(
            !Path::new(recorded).starts_with(outside.path()),
            "the row records a path outside the data directory: {recorded}"
        );
    }

    let workspaces = engine
        .dispatch(req("workspace.list", json!({})))
        .result
        .unwrap();
    for workspace in workspaces["workspaces"].as_array().unwrap() {
        let path = workspace["path"].as_str().unwrap();
        assert!(
            !Path::new(path).starts_with(outside.path()),
            "a workspace registration points outside the data directory: {path}"
        );
    }
}
