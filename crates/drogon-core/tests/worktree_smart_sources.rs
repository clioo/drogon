//! Integration tests for the composer's smart sources (the fork's
//! "Name or 'Create From'" field over Drogon's data layer):
//! `worktree.branch_search` (local + remote refs, most recent first,
//! `<remote>/HEAD` dropped) and `worktree.create`'s `reuseBranch` (check out
//! the existing branch instead of branching off it). Against a real `Engine`,
//! a real SQLite file and real temp git repositories. Unix-only.

#![cfg(unix)]

use std::path::Path;
use std::process::Command;

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

fn req(method: &str, request_id: &str, params: Value) -> Request {
    serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": request_id,
        "method": method,
        "params": params,
    }))
    .unwrap()
}

fn ok(engine: &Engine, method: &str, request_id: &str, params: Value) -> Value {
    let response = engine.dispatch(req(method, request_id, params));
    assert!(
        response.ok,
        "expected ok for {method}: {:?}",
        response.error
    );
    response.result.unwrap()
}

fn err(engine: &Engine, method: &str, request_id: &str, params: Value) -> (String, String) {
    let response = engine.dispatch(req(method, request_id, params));
    assert!(
        !response.ok,
        "expected error for {method}, got {:?}",
        response.result
    );
    let error = response.error.unwrap();
    (error.code, error.message)
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(dir)
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?} failed in {dir:?}");
}

fn commit_file(dir: &Path, name: &str, message: &str) {
    std::fs::write(dir.join(name), format!("{message}\n")).unwrap();
    git(dir, &["add", name]);
    git(dir, &["commit", "-q", "-m", message]);
}

/// A real git repository with one commit on `main` and an `origin` remote
/// (a sibling bare clone) carrying `origin/main` and `origin/remote-only`.
fn init_repo_with_remote(dir: &Path) {
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "user.name", "Test"]);
    commit_file(dir, "README.md", "initial");

    let bare = tempfile::tempdir().unwrap();
    git(
        dir,
        &[
            "clone",
            "-q",
            "--bare",
            dir.to_str().unwrap(),
            bare.path().to_str().unwrap(),
        ],
    );
    git(
        dir,
        &["remote", "add", "origin", bare.path().to_str().unwrap()],
    );
    git(dir, &["push", "-q", "origin", "main"]);
    git(dir, &["fetch", "-q", "origin"]);
    // A remote-only branch the local clone never checked out.
    git(dir, &["branch", "remote-only", "origin/main"]);
    git(dir, &["push", "-q", "origin", "remote-only"]);
    git(dir, &["branch", "-D", "remote-only"]);
    git(dir, &["fetch", "-q", "origin"]);
    // A second local branch with its own (newer) commit.
    git(dir, &["checkout", "-q", "-b", "feature/local"]);
    commit_file(dir, "feature.txt", "feature work");
    git(dir, &["checkout", "-q", "main"]);
}

fn git_project(engine: &Engine, repo: &Path) -> String {
    let project = ok(
        engine,
        "project.add",
        "p1",
        json!({"path": repo.to_string_lossy()}),
    );
    project["id"].as_str().unwrap().to_string()
}

// --- worktree.branch_search ---------------------------------------------------

#[test]
fn branch_search_lists_local_and_remote_refs_without_remote_head() {
    let engine = Engine::open(tempfile::tempdir().unwrap().path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo_with_remote(repo.path());
    let project_id = git_project(&engine, repo.path());

    let result = ok(
        &engine,
        "worktree.branch_search",
        "b1",
        json!({"projectId": project_id}),
    );
    let branches = result["branches"].as_array().unwrap();
    let ref_names: Vec<&str> = branches
        .iter()
        .map(|row| row["refName"].as_str().unwrap())
        .collect();
    assert!(ref_names.contains(&"main"), "{ref_names:?}");
    assert!(ref_names.contains(&"feature/local"), "{ref_names:?}");
    assert!(ref_names.contains(&"origin/main"), "{ref_names:?}");
    assert!(ref_names.contains(&"origin/remote-only"), "{ref_names:?}");
    // The symbolic remote HEAD slot is a pointer, not a branch.
    assert!(!ref_names.iter().any(|name| name.ends_with("/HEAD")));
    // Remote rows strip their remote prefix for the local branch name.
    let remote_only = branches
        .iter()
        .find(|row| row["refName"] == "origin/remote-only")
        .unwrap();
    assert_eq!(remote_only["localBranchName"], "remote-only");
    let local = branches
        .iter()
        .find(|row| row["refName"] == "feature/local")
        .unwrap();
    assert_eq!(local["localBranchName"], "feature/local");
}

#[test]
fn branch_search_filters_by_query_substring_and_bounds_the_limit() {
    let engine = Engine::open(tempfile::tempdir().unwrap().path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo_with_remote(repo.path());
    let project_id = git_project(&engine, repo.path());

    let result = ok(
        &engine,
        "worktree.branch_search",
        "b1",
        json!({"projectId": project_id, "query": "remote"}),
    );
    let branches = result["branches"].as_array().unwrap();
    assert_eq!(branches.len(), 1);
    assert_eq!(branches[0]["refName"], "origin/remote-only");

    let result = ok(
        &engine,
        "worktree.branch_search",
        "b2",
        json!({"projectId": project_id, "query": "feature"}),
    );
    let branches = result["branches"].as_array().unwrap();
    assert_eq!(branches.len(), 1);
    assert_eq!(branches[0]["refName"], "feature/local");

    let result = ok(
        &engine,
        "worktree.branch_search",
        "b3",
        json!({"projectId": project_id, "limit": 1}),
    );
    assert_eq!(result["branches"].as_array().unwrap().len(), 1);
}

#[test]
fn branch_search_is_refused_on_folder_projects() {
    let engine = Engine::open(tempfile::tempdir().unwrap().path()).unwrap();
    let folder = tempfile::tempdir().unwrap();
    let project = ok(
        &engine,
        "project.add",
        "p1",
        json!({"path": folder.path().to_string_lossy()}),
    );
    let (code, _) = err(
        &engine,
        "worktree.branch_search",
        "b1",
        json!({"projectId": project["id"]}),
    );
    assert_eq!(code, "invalid_argument");
}

// --- worktree.create reuseBranch ----------------------------------------------

#[test]
fn reuse_branch_checks_out_the_existing_branch_instead_of_creating_one() {
    let engine = Engine::open(tempfile::tempdir().unwrap().path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo_with_remote(repo.path());
    let project_id = git_project(&engine, repo.path());

    let created = ok(
        &engine,
        "worktree.create",
        "w1",
        json!({
            "projectId": project_id,
            "name": "reuse-feature",
            "branch": "feature/local",
            "reuseBranch": true,
        }),
    );
    // The worktree's branch is the existing `feature/local`, not a fresh
    // branch.
    assert_eq!(created["branch"], "feature/local");
    let head = created["head"].as_str().unwrap();
    let output = Command::new("git")
        .args(["rev-parse", "feature/local"])
        .current_dir(repo.path())
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(head, String::from_utf8(output.stdout).unwrap().trim());

    // A remote ref cannot be reused: the daemon refuses before git could
    // produce a surprising detached worktree.
    let (code, message) = err(
        &engine,
        "worktree.create",
        "w2",
        json!({
            "projectId": project_id,
            "name": "reuse-remote",
            "branch": "origin/remote-only",
            "reuseBranch": true,
        }),
    );
    assert_eq!(code, "invalid_argument");
    assert!(message.contains("not a local branch"), "{message}");
}

#[test]
fn reuse_branch_is_refused_without_a_branch_or_with_a_base_ref() {
    let engine = Engine::open(tempfile::tempdir().unwrap().path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo_with_remote(repo.path());
    let project_id = git_project(&engine, repo.path());

    let (code, _) = err(
        &engine,
        "worktree.create",
        "w1",
        json!({"projectId": project_id, "name": "no-branch", "reuseBranch": true}),
    );
    assert_eq!(code, "invalid_argument");

    let (code, message) = err(
        &engine,
        "worktree.create",
        "w2",
        json!({
            "projectId": project_id,
            "name": "with-base",
            "branch": "main",
            "reuseBranch": true,
            "baseRef": "main",
        }),
    );
    assert_eq!(code, "invalid_argument");
    assert!(message.contains("baseRef"), "{message}");
}

#[test]
fn reuse_branch_reports_a_branch_already_in_use_with_guidance() {
    let engine = Engine::open(tempfile::tempdir().unwrap().path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo_with_remote(repo.path());
    let project_id = git_project(&engine, repo.path());

    // `main` is the primary checkout's branch: git refuses to check it out
    // in a second worktree. The error names the branch and the conflict.
    let (code, message) = err(
        &engine,
        "worktree.create",
        "w1",
        json!({
            "projectId": project_id,
            "name": "second-main",
            "branch": "main",
            "reuseBranch": true,
        }),
    );
    assert_eq!(code, "invalid_argument");
    assert!(
        message.contains("'main' is already checked out in another worktree"),
        "{message}"
    );
}

#[test]
fn reuse_branch_false_keeps_the_fresh_branch_shape() {
    let engine = Engine::open(tempfile::tempdir().unwrap().path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo_with_remote(repo.path());
    let project_id = git_project(&engine, repo.path());

    let created = ok(
        &engine,
        "worktree.create",
        "w1",
        json!({
            "projectId": project_id,
            "name": "fresh",
            "branch": "feature/custom",
            "reuseBranch": false,
        }),
    );
    assert_eq!(created["branch"], "feature/custom");
    // The fresh branch really exists in the source repo.
    let output = Command::new("git")
        .args(["rev-parse", "--verify", "feature/custom"])
        .current_dir(repo.path())
        .output()
        .unwrap();
    assert!(output.status.success());
}
