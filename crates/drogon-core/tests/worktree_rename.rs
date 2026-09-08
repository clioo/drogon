//! Integration tests for `worktree.rename { worktreeId, name }` (task R9-A,
//! journey J1 remainder), through `Engine::dispatch` with real temp git
//! repositories. The rename sets the card's display title only — the git
//! branch and the worktree directory are untouched, matching Orca's
//! `updateWorktreeMeta(displayName)` inline-rename flow.
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

fn err_code(engine: &Engine, method: &str, request_id: &str, params: Value) -> String {
    let response = engine.dispatch(req(method, request_id, params));
    assert!(
        !response.ok,
        "expected error for {method}, got {:?}",
        response.result
    );
    response.error.unwrap().code
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(dir)
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?} failed in {dir:?}");
}

fn init_repo(dir: &Path) {
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "user.name", "Test"]);
    std::fs::write(dir.join("README.md"), "hello\n").unwrap();
    git(dir, &["add", "README.md"]);
    git(dir, &["commit", "-q", "-m", "initial"]);
}

/// One git project with one worktree; returns `(project_id, worktree)`.
fn project_with_worktree(engine: &Engine, repo: &Path, tag: &str) -> (String, Value) {
    let project = ok(
        engine,
        "project.add",
        &format!("{tag}-pa"),
        json!({ "path": repo.to_str().unwrap() }),
    );
    let project_id = project["id"].as_str().unwrap().to_string();
    let worktree = ok(
        engine,
        "worktree.create",
        &format!("{tag}-wc"),
        json!({ "projectId": project_id, "name": "feature" }),
    );
    (project_id, worktree)
}

#[test]
fn rename_sets_the_display_title_and_keeps_branch_and_path() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let (project_id, worktree) = project_with_worktree(&engine, repo.path(), "t1");
    let id = worktree["id"].as_str().unwrap();
    let branch_before = worktree["branch"].as_str().unwrap().to_string();
    let path_before = worktree["path"].as_str().unwrap().to_string();
    assert!(worktree.get("title").is_none() || worktree["title"].is_null());

    let renamed = ok(
        &engine,
        "worktree.rename",
        "t1-rn",
        json!({ "worktreeId": id, "name": "  My feature  " }),
    );
    assert_eq!(renamed["title"], "My feature");
    // Display title only: branch and directory are untouched.
    assert_eq!(renamed["branch"], branch_before);
    assert_eq!(renamed["path"], path_before);

    let listed = ok(
        &engine,
        "worktree.list",
        "t1-ls",
        json!({ "projectId": project_id }),
    );
    let found = listed["worktrees"]
        .as_array()
        .unwrap()
        .iter()
        .find(|w| w["id"] == id)
        .unwrap();
    assert_eq!(found["title"], "My feature");
}

#[test]
fn rename_rejects_blank_overlong_and_missing_targets() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let (_, worktree) = project_with_worktree(&engine, repo.path(), "t2");
    let id = worktree["id"].as_str().unwrap().to_string();

    for (tag, name) in [
        ("blank", ""),
        ("spaces", "   "),
        ("nul", "has\0nul"),
        ("long", &"x".repeat(257)),
    ] {
        assert_eq!(
            err_code(
                &engine,
                "worktree.rename",
                &format!("t2-{tag}"),
                json!({ "worktreeId": id, "name": name }),
            ),
            "invalid_argument"
        );
    }
    assert_eq!(
        err_code(
            &engine,
            "worktree.rename",
            "t2-missing",
            json!({ "worktreeId": "no-such-worktree", "name": "Title" }),
        ),
        "not_found"
    );
    // A failed rename leaves the stored title alone (still null here).
    let listed = ok(
        &engine,
        "worktree.list",
        "t2-ls",
        json!({ "projectId": worktree["projectId"] }),
    );
    let found = listed["worktrees"]
        .as_array()
        .unwrap()
        .iter()
        .find(|w| w["id"] == id)
        .unwrap();
    assert!(found.get("title").is_none() || found["title"].is_null());
}

#[test]
fn rename_is_repeatable_and_survives_engine_reopen() {
    let data_dir = tempfile::tempdir().unwrap();
    let project_id: String;
    let worktree_id: String;
    {
        let engine = Engine::open(data_dir.path()).unwrap();
        let repo = tempfile::tempdir().unwrap();
        init_repo(repo.path());
        // NOTE: `repo` is dropped at the end of this block, but the daemon
        // never touches the repo path on rename — only the title column —
        // so the second open below is safe.
        let (pid, worktree) = project_with_worktree(&engine, repo.path(), "t3");
        project_id = pid;
        worktree_id = worktree["id"].as_str().unwrap().to_string();
        ok(
            &engine,
            "worktree.rename",
            "t3-r1",
            json!({ "worktreeId": worktree_id, "name": "First" }),
        );
        ok(
            &engine,
            "worktree.rename",
            "t3-r2",
            json!({ "worktreeId": worktree_id, "name": "Second" }),
        );
        std::mem::forget(repo);
    }
    let engine = Engine::open(data_dir.path()).unwrap();
    let listed = ok(
        &engine,
        "worktree.list",
        "t3-ls",
        json!({ "projectId": project_id }),
    );
    let found = listed["worktrees"]
        .as_array()
        .unwrap()
        .iter()
        .find(|w| w["id"] == worktree_id)
        .unwrap();
    assert_eq!(found["title"], "Second");
}

/// A database migrated from the v1 schema (no `title` column, version 1)
/// gains the column on open and renames cleanly — the established
/// `schema_versions` migration pattern.
#[test]
fn v1_database_migrates_the_title_column_on_open() {
    let data_dir = tempfile::tempdir().unwrap();
    {
        let db_path = data_dir.path().join("drogon.sqlite3");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_versions (component TEXT PRIMARY KEY, version INTEGER NOT NULL);
             CREATE TABLE projects (
                id TEXT PRIMARY KEY, host_id TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL, kind TEXT NOT NULL, default_base_ref TEXT,
                created_at TEXT NOT NULL);
             CREATE TABLE worktrees (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL, workspace_id TEXT NOT NULL UNIQUE,
                path TEXT NOT NULL UNIQUE, branch TEXT NOT NULL, head TEXT NOT NULL,
                base_ref TEXT, created_at TEXT NOT NULL);
             CREATE TABLE workspaces (
                id TEXT PRIMARY KEY, host_id TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL);
             INSERT INTO schema_versions(component, version) VALUES ('projects', 1);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO projects (id, host_id, path, name, kind, default_base_ref, created_at)
             VALUES ('p1', 'h', '/tmp/x', 'x', 'git', NULL, '2026-09-07T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO workspaces (id, host_id, path, name, kind, created_at)
             VALUES ('ws1', 'h', '/tmp/x/w', 'w', 'git', '2026-09-07T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO worktrees (id, project_id, workspace_id, path, branch, head, base_ref, created_at)
             VALUES ('w1', 'p1', 'ws1', '/tmp/x/w', 'feature', 'abc', NULL, '2026-09-07T00:00:00Z')",
            [],
        )
        .unwrap();
    }
    let engine = Engine::open(data_dir.path()).unwrap();
    let renamed = ok(
        &engine,
        "worktree.rename",
        "t4-rn",
        json!({ "worktreeId": "w1", "name": "Migrated" }),
    );
    assert_eq!(renamed["title"], "Migrated");
    assert_eq!(renamed["branch"], "feature");
}
