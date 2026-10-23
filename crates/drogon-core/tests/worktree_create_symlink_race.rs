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

/// Restores `PATH` however the test ends, so a panic cannot leak the
/// wrapper into the rest of the process.
struct SavedPath(Option<std::ffi::OsString>);

impl SavedPath {
    fn prepend(dir: &Path) -> Self {
        let previous = std::env::var_os("PATH");
        let mut entries = vec![dir.to_path_buf()];
        if let Some(current) = &previous {
            entries.extend(std::env::split_paths(current));
        }
        let joined = std::env::join_paths(entries).unwrap();
        unsafe { std::env::set_var("PATH", &joined) };
        SavedPath(previous)
    }
}

impl Drop for SavedPath {
    fn drop(&mut self) {
        unsafe {
            match self.0.take() {
                Some(previous) => std::env::set_var("PATH", previous),
                None => std::env::remove_var("PATH"),
            }
        }
    }
}

#[test]
fn create_refuses_to_register_a_checkout_a_mid_call_swap_pushed_outside() {
    let data = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let wrapper_dir = tempfile::tempdir().unwrap();

    let real_git = String::from_utf8(
        Command::new("/usr/bin/env")
            .args(["which", "git"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_string();
    assert!(!real_git.is_empty(), "this test needs a real git on PATH");

    git(repo.path(), &["init", "-q", "-b", "main", "."]);
    git(repo.path(), &["config", "user.email", "t@example.com"]);
    git(repo.path(), &["config", "user.name", "Test"]);
    std::fs::write(repo.path().join("README.md"), "hello\n").unwrap();
    git(repo.path(), &["add", "README.md"]);
    git(repo.path(), &["commit", "-qm", "first"]);

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

/// Minimal single-quoted shell literal for a path interpolated into the
/// wrapper script above.
fn shell_quote(raw: &str) -> String {
    format!("'{}'", raw.replace('\'', "'\\''"))
}
