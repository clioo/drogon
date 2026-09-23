//! Regression tests for issue #579: creating a workspace on a FOLDER
//! project must produce its own sidebar section, exactly like a git
//! worktree does, instead of only adding another agent window to the
//! folder's single implicit workspace.
//!
//! A section is a distinct Workspace (its own `workspaceId`), because the
//! sidebar groups sessions by `workspaceId`. So the real, observable
//! contract is: `worktree.create` on a folder project registers a NEW
//! Workspace that shares the folder path but carries a distinct
//! `workspaceId`, and `worktree.list` returns it alongside the folder's
//! implicit primary. No `git` runs for a folder Workspace, so these tests
//! do not require a git repository.
#![cfg(unix)]

use std::sync::atomic::{AtomicU64, Ordering};

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn next_id() -> String {
    format!("r{}", NEXT_ID.fetch_add(1, Ordering::Relaxed))
}

fn req(method: &str, params: Value) -> Request {
    serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": next_id(),
        "method": method,
        "params": params,
    }))
    .unwrap()
}

fn ok(engine: &Engine, method: &str, params: Value) -> Value {
    let response = engine.dispatch(req(method, params));
    assert!(
        response.ok,
        "expected ok for {method}: {:?}",
        response.error
    );
    response.result.unwrap()
}

fn err(engine: &Engine, method: &str, params: Value) -> String {
    let response = engine.dispatch(req(method, params));
    assert!(
        !response.ok,
        "expected error for {method}, got {:?}",
        response.result
    );
    response.error.unwrap().code
}

/// A plain (non-git) directory registers as a folder Project.
fn add_folder_project(engine: &Engine, dir: &std::path::Path) -> Value {
    let project = ok(
        engine,
        "project.add",
        json!({"path": dir.to_string_lossy()}),
    );
    assert_eq!(
        project["kind"],
        json!("folder"),
        "expected a folder project"
    );
    project
}

fn worktrees(engine: &Engine, project_id: &str) -> Vec<Value> {
    let listed = ok(engine, "worktree.list", json!({"projectId": project_id}));
    listed["worktrees"].as_array().cloned().unwrap()
}

/// Creating a folder workspace yields its own section: a distinct
/// `workspaceId` (so its sessions group separately) that shares the folder
/// path, and `worktree.list` returns it next to the implicit primary.
#[test]
fn folder_workspace_create_makes_a_separate_section() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let folder = tempfile::tempdir().unwrap();
    let project = add_folder_project(&engine, folder.path());
    let project_id = project["id"].as_str().unwrap().to_string();

    // The folder starts with exactly one section: its implicit primary
    // (id == project id).
    let before = worktrees(&engine, &project_id);
    assert_eq!(before.len(), 1, "a fresh folder has one implicit section");
    let primary = &before[0];
    assert_eq!(primary["id"], json!(project_id));
    let primary_workspace_id = primary["workspaceId"].as_str().unwrap().to_string();

    // Creating a workspace on the folder makes a NEW section.
    let created = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "analysis"}),
    );
    assert_eq!(created["projectId"], json!(project_id));
    assert_eq!(created["title"], json!("analysis"));
    assert_eq!(
        created["path"], primary["path"],
        "a folder workspace shares the folder path"
    );
    assert_ne!(
        created["id"], primary["id"],
        "a new section has its own worktree id, not the implicit id"
    );
    let created_workspace_id = created["workspaceId"].as_str().unwrap().to_string();
    assert_ne!(
        created_workspace_id, primary_workspace_id,
        "a new section has its own workspaceId so its sessions group separately"
    );

    // Both sections are now listed, primary first.
    let after = worktrees(&engine, &project_id);
    assert_eq!(after.len(), 2, "the folder now has two sections");
    assert_eq!(after[0]["id"], json!(project_id));
    assert_eq!(after[1]["id"], created["id"]);
}

/// Each `worktree.create` adds another distinct section; a session started
/// in one section does not appear under the other (grouping is by
/// `workspaceId`).
#[test]
fn folder_workspaces_have_distinct_workspace_ids() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let folder = tempfile::tempdir().unwrap();
    let project = add_folder_project(&engine, folder.path());
    let project_id = project["id"].as_str().unwrap().to_string();

    let a = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "alpha"}),
    );
    let b = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "beta"}),
    );
    assert_ne!(a["workspaceId"], b["workspaceId"]);
    assert_ne!(a["id"], b["id"]);
    // Per-project monotonic sort order, exactly like git worktrees.
    assert_eq!(a["sortOrder"], json!(1));
    assert_eq!(b["sortOrder"], json!(2));

    let listed = worktrees(&engine, &project_id);
    assert_eq!(listed.len(), 3, "implicit primary + two created sections");
}

/// A folder workspace has no branch, base ref, parent or sparse checkout;
/// passing a git-only field is rejected honestly rather than silently
/// ignored.
#[test]
fn folder_workspace_rejects_git_only_options() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let folder = tempfile::tempdir().unwrap();
    let project = add_folder_project(&engine, folder.path());
    let project_id = project["id"].as_str().unwrap().to_string();

    let code = err(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "x", "baseRef": "main"}),
    );
    assert_eq!(code, "invalid_argument");

    let code = err(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "x", "branch": "feature"}),
    );
    assert_eq!(code, "invalid_argument");

    // An empty name is rejected too (the name is the section's title).
    let code = err(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "   "}),
    );
    assert_eq!(code, "invalid_argument");
}

/// Removing a folder workspace unregisters only that section (no `git`,
/// no file deletion); the implicit primary and the folder itself remain.
#[test]
fn folder_workspace_remove_drops_only_that_section() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let folder = tempfile::tempdir().unwrap();
    std::fs::write(folder.path().join("keep.txt"), "data\n").unwrap();
    let project = add_folder_project(&engine, folder.path());
    let project_id = project["id"].as_str().unwrap().to_string();

    let created = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "temp"}),
    );
    let created_id = created["id"].as_str().unwrap().to_string();
    assert_eq!(worktrees(&engine, &project_id).len(), 2);

    let removed = ok(&engine, "worktree.remove", json!({"id": created_id}));
    assert_eq!(removed["removed"], json!(true));

    let after = worktrees(&engine, &project_id);
    assert_eq!(after.len(), 1, "only the implicit primary remains");
    assert_eq!(after[0]["id"], json!(project_id));
    // The folder and its files are never touched by a folder-workspace remove.
    assert!(
        folder.path().join("keep.txt").exists(),
        "removing a folder workspace must not delete folder files"
    );
}

/// Renaming a folder workspace updates its card title, and the change
/// survives a `worktree.list` round-trip.
#[test]
fn folder_workspace_rename_persists() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let folder = tempfile::tempdir().unwrap();
    let project = add_folder_project(&engine, folder.path());
    let project_id = project["id"].as_str().unwrap().to_string();

    let created = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "draft"}),
    );
    let created_id = created["id"].as_str().unwrap().to_string();

    let renamed = ok(
        &engine,
        "worktree.rename",
        json!({"worktreeId": created_id, "name": "final"}),
    );
    assert_eq!(renamed["title"], json!("final"));

    let listed = worktrees(&engine, &project_id);
    let row = listed
        .iter()
        .find(|w| w["id"] == json!(created_id))
        .expect("renamed section still listed");
    assert_eq!(row["title"], json!("final"));
}
