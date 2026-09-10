//! Integration tests for the composer Advanced data layers (R16-BM2):
//! explicit branch names, worktree notes, sidebar-nesting parents, sparse
//! checkout, the project setup script, Quick Session scratch projects and
//! sparse-checkout presets — against a real `Engine`, a real SQLite file
//! and real temp git repositories. Unix-only, same scope as
//! `project_worktree.rs`.
#![cfg(unix)]

use std::path::Path;
use std::process::Command;

use std::sync::atomic::{AtomicU64, Ordering};

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

// The mutating-request ledger dedupes by requestId, so every call in a
// test gets a fresh one.
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn next_id() -> String {
    format!("r{}", NEXT_ID.fetch_add(1, Ordering::Relaxed))
}

fn req(method: &str, request_id: &str, params: Value) -> Request {
    serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": request_id,
        "method": method,
        "params": params,
    }))
    .unwrap()
}

fn ok(engine: &Engine, method: &str, params: Value) -> Value {
    let response = engine.dispatch(req(method, &next_id(), params));
    assert!(
        response.ok,
        "expected ok for {method}: {:?}",
        response.error
    );
    response.result.unwrap()
}

fn err_code(engine: &Engine, method: &str, params: Value) -> String {
    let response = engine.dispatch(req(method, &next_id(), params));
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
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(dir.join("src/lib.rs"), "// lib\n").unwrap();
    std::fs::create_dir_all(dir.join("docs")).unwrap();
    std::fs::write(dir.join("docs/guide.md"), "# guide\n").unwrap();
    std::fs::create_dir_all(dir.join("tools")).unwrap();
    std::fs::write(dir.join("tools/helper.sh"), "#!/bin/sh\n").unwrap();
    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", "initial"]);
}

fn add_git_project(engine: &Engine, repo: &Path) -> String {
    let project = ok(
        engine,
        "project.add",
        json!({"path": repo.to_string_lossy()}),
    );
    project["id"].as_str().unwrap().to_string()
}

#[test]
fn worktree_create_with_an_explicit_branch_separates_branch_from_name() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project_id = add_git_project(&engine, repo.path());

    let wt = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "my-workspace", "branch": "feature/my-branch"}),
    );
    assert_eq!(wt["branch"], "feature/my-branch");
    assert!(
        wt["path"].as_str().unwrap().ends_with("my-workspace"),
        "the folder keeps the worktree name: {}",
        wt["path"]
    );
    let head_branch = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(wt["path"].as_str().unwrap())
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8(head_branch.stdout).unwrap().trim(),
        "feature/my-branch"
    );
}

#[test]
fn worktree_create_rejects_an_invalid_explicit_branch_with_gits_own_message() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project_id = add_git_project(&engine, repo.path());

    let response = engine.dispatch(req(
        "worktree.create",
        &next_id(),
        json!({"projectId": project_id, "name": "ws", "branch": "feat..nope"}),
    ));
    assert!(!response.ok, "an invalid branch must be refused");
    let error = response.error.unwrap();
    assert_eq!(error.code, "io_error");
    assert!(
        error.message.contains("check-ref-format"),
        "the fork surfaces git's own validation message, got: {}",
        error.message
    );
    assert!(
        !data_dir
            .path()
            .join("workspaces")
            .join(repo.path().file_name().unwrap())
            .join("ws")
            .exists(),
        "a refused branch creates no worktree directory"
    );
}

#[test]
fn worktree_note_round_trips_through_create_list_and_update() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project_id = add_git_project(&engine, repo.path());

    let wt = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "noted", "note": "  investigate the flake  "}),
    );
    assert_eq!(wt["note"], "investigate the flake", "notes store trimmed");
    let id = wt["id"].as_str().unwrap().to_string();

    let listed = ok(&engine, "worktree.list", json!({"projectId": project_id}));
    assert_eq!(listed["worktrees"][0]["note"], "investigate the flake");

    let updated = ok(
        &engine,
        "worktree.update",
        json!({"worktreeId": id, "note": "root cause: cache"}),
    );
    assert_eq!(updated["note"], "root cause: cache");

    let cleared = ok(
        &engine,
        "worktree.update",
        json!({"worktreeId": id, "note": null}),
    );
    assert!(cleared["note"].is_null(), "explicit null clears the note");

    // Absent leaves the column untouched.
    ok(
        &engine,
        "worktree.update",
        json!({"worktreeId": id, "note": "again"}),
    );
    let untouched = ok(&engine, "worktree.update", json!({"worktreeId": id}));
    assert_eq!(untouched["note"], "again");

    assert_eq!(
        err_code(&engine, "worktree.update", json!({"worktreeId": "missing"})),
        "not_found"
    );
}

#[test]
fn worktree_parent_nests_within_the_same_project_and_refuses_cycles() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project_id = add_git_project(&engine, repo.path());

    let parent = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "parent"}),
    );
    let parent_id = parent["id"].as_str().unwrap().to_string();
    let child = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "child", "parentWorktreeId": parent_id}),
    );
    assert_eq!(child["parentWorktreeId"], parent_id);

    let listed = ok(&engine, "worktree.list", json!({"projectId": project_id}));
    let rows = listed["worktrees"].as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows[0]["parentWorktreeId"].is_null());
    assert_eq!(rows[1]["parentWorktreeId"], parent_id);

    // A foreign or missing parent is refused at create time.
    let other_repo = tempfile::tempdir().unwrap();
    init_repo(other_repo.path());
    let other_project = add_git_project(&engine, other_repo.path());
    let foreign = ok(
        &engine,
        "worktree.create",
        json!({"projectId": other_project, "name": "foreign"}),
    );
    assert_eq!(
        err_code(
            &engine,
            "worktree.create",
            json!({
                "projectId": project_id,
                "name": "cross-project",
                "parentWorktreeId": foreign["id"]
            })
        ),
        "invalid_argument"
    );
    assert_eq!(
        err_code(
            &engine,
            "worktree.create",
            json!({"projectId": project_id, "name": "orphan", "parentWorktreeId": "missing"})
        ),
        "invalid_argument"
    );
}

#[test]
fn worktree_update_parent_cycle_is_refused() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project_id = add_git_project(&engine, repo.path());

    let parent = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "parent"}),
    );
    let parent_id = parent["id"].as_str().unwrap().to_string();
    let child = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "child", "parentWorktreeId": parent_id}),
    );
    let child_id = child["id"].as_str().unwrap().to_string();

    assert_eq!(
        err_code(
            &engine,
            "worktree.update",
            json!({"worktreeId": parent_id, "parentWorktreeId": child_id})
        ),
        "invalid_argument",
        "parent -> child while child -> parent closes a cycle"
    );
    assert_eq!(
        err_code(
            &engine,
            "worktree.update",
            json!({"worktreeId": parent_id, "parentWorktreeId": parent_id})
        ),
        "invalid_argument",
        "a worktree cannot be its own parent"
    );

    // Clearing the parent (explicit null) is allowed.
    let cleared = ok(
        &engine,
        "worktree.update",
        json!({"worktreeId": child_id, "parentWorktreeId": null}),
    );
    assert!(cleared["parentWorktreeId"].is_null());
}

#[test]
fn worktree_create_with_sparse_checkout_materializes_only_the_picked_directories() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project_id = add_git_project(&engine, repo.path());

    let wt = ok(
        &engine,
        "worktree.create",
        json!({
            "projectId": project_id,
            "name": "sparse-ws",
            "sparse": ["src", "docs/", "src"]
        }),
    );
    let path = Path::new(wt["path"].as_str().unwrap());
    assert!(path.join("src/lib.rs").is_file(), "src is checked out");
    assert!(path.join("docs/guide.md").is_file(), "docs is checked out");
    // Cone mode includes root-level files by design; an unpicked nested
    // directory is the reliable absence assertion.
    assert!(
        !path.join("tools/helper.sh").exists(),
        "an unpicked nested directory stays out of a cone sparse checkout"
    );
    let listed = Command::new("git")
        .args(["sparse-checkout", "list"])
        .current_dir(path)
        .output()
        .unwrap();
    let listed = String::from_utf8(listed.stdout).unwrap();
    assert!(listed.contains("src"), "cone patterns record src: {listed}");
    assert!(
        listed.contains("docs"),
        "cone patterns record docs: {listed}"
    );
    // HEAD still resolves after the no-checkout add + sparse materialization.
    assert_eq!(wt["head"], rev_parse(repo.path(), "main"));
}

fn rev_parse(dir: &Path, rev: &str) -> String {
    let output = Command::new("git")
        .args(["rev-parse", rev])
        .current_dir(dir)
        .output()
        .unwrap();
    assert!(output.status.success());
    String::from_utf8(output.stdout).unwrap().trim().to_string()
}

#[test]
fn worktree_create_rejects_non_relative_sparse_directories() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project_id = add_git_project(&engine, repo.path());

    for bad in ["/abs", "../escape", "a/../../b"] {
        assert_eq!(
            err_code(
                &engine,
                "worktree.create",
                json!({"projectId": project_id, "name": "sparse-bad", "sparse": [bad]})
            ),
            "invalid_argument",
            "sparse entry {bad:?} must be refused"
        );
    }
}

#[test]
fn project_update_sets_and_clears_the_setup_script() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project_id = add_git_project(&engine, repo.path());

    let updated = ok(
        &engine,
        "project.update",
        json!({"id": project_id, "setupScript": "pnpm install\npnpm build"}),
    );
    assert_eq!(updated["setupScript"], "pnpm install\npnpm build");

    let listed = ok(&engine, "project.list", json!({}));
    assert_eq!(
        listed["projects"][0]["setupScript"],
        "pnpm install\npnpm build"
    );

    let cleared = ok(
        &engine,
        "project.update",
        json!({"id": project_id, "setupScript": null}),
    );
    assert!(cleared["setupScript"].is_null());

    assert_eq!(
        err_code(
            &engine,
            "project.update",
            json!({"id": "missing", "setupScript": "x"})
        ),
        "not_found"
    );
}

#[test]
fn quick_session_create_registers_a_scratch_folder_project_and_remove_deletes_it() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();

    let created = ok(&engine, "project.quickSessionCreate", json!({}));
    let project = &created["project"];
    assert_eq!(project["kind"], "folder");
    assert_eq!(project["name"], "Quick Session");
    assert_eq!(project["quickSession"], true);
    assert!(created["workspaceId"].is_string());
    let path = project["path"].as_str().unwrap().to_string();
    let canonical_data_dir = std::fs::canonicalize(data_dir.path()).unwrap();
    assert!(
        path.starts_with(
            &canonical_data_dir
                .join("quick-sessions")
                .to_string_lossy()
                .to_string()
        ),
        "the scratch lives under the data dir: {path}"
    );
    let marker = Path::new(&path).join(".drogon-quick-session.json");
    assert!(marker.is_file(), "the ownership marker is written");

    // The implicit worktree resolves the workspace like any folder project.
    let worktrees = ok(
        &engine,
        "worktree.list",
        json!({"projectId": project["id"]}),
    );
    assert_eq!(
        worktrees["worktrees"][0]["workspaceId"],
        created["workspaceId"]
    );

    // A typed name wins, like the fork's create input.
    let named = ok(
        &engine,
        "project.quickSessionCreate",
        json!({"name": "scratchpad"}),
    );
    assert_eq!(named["project"]["name"], "scratchpad");

    ok(&engine, "project.remove", json!({"id": project["id"]}));
    assert!(
        !Path::new(&path).exists(),
        "removing a quick session project deletes its app-owned scratch folder"
    );
    // The named one stays on disk until it too is removed.
    let named_path = named["project"]["path"].as_str().unwrap().to_string();
    assert!(Path::new(&named_path).is_dir());
}

// User-feature-closure item 3: standalone quick sessions ("Chats") must be
// durable across reload/restart -- an ordinary `projects` row, no special
// on-shutdown cleanup exists anywhere in this crate (verified by grep), but
// nothing previously proved it survives a real `Engine` close/reopen cycle,
// nor that reopening never disturbs an unrelated project's own scratch.
#[test]
fn quick_session_survives_a_daemon_restart_without_disturbing_other_projects() {
    let data_dir = tempfile::tempdir().unwrap();
    let other_dir = tempfile::tempdir().unwrap();
    let (chat_id, chat_path, other_project_id) = {
        let engine = Engine::open(data_dir.path()).unwrap();
        let created = ok(
            &engine,
            "project.quickSessionCreate",
            json!({"name": "Chat"}),
        );
        let chat_id = created["project"]["id"].as_str().unwrap().to_string();
        let chat_path = created["project"]["path"].as_str().unwrap().to_string();
        let other = ok(
            &engine,
            "project.add",
            json!({"path": other_dir.path().to_str().unwrap()}),
        );
        (
            chat_id,
            chat_path,
            other["id"].as_str().unwrap().to_string(),
        )
    }; // engine dropped here -- simulates the daemon exiting.

    // Reopen: the "restart" the requirement names.
    let engine = Engine::open(data_dir.path()).unwrap();
    let listed = ok(&engine, "project.list", json!({}));
    let projects = listed["projects"].as_array().unwrap();
    let chat = projects
        .iter()
        .find(|p| p["id"] == chat_id)
        .unwrap_or_else(|| panic!("quick session project lost across restart: {projects:?}"));
    assert_eq!(chat["name"], "Chat");
    assert_eq!(chat["quickSession"], true);
    assert!(
        Path::new(&chat_path).is_dir(),
        "the scratch folder itself must survive the restart, not just the row"
    );
    assert!(
        projects.iter().any(|p| p["id"] == other_project_id),
        "an unrelated project must never be disturbed by reopening"
    );

    // Deleting the Chat post-restart must still only touch its own scratch.
    ok(&engine, "project.remove", json!({"id": chat_id}));
    assert!(!Path::new(&chat_path).exists());
    let other_dir_untouched = other_dir.path().is_dir();
    assert!(
        other_dir_untouched,
        "deleting a Chat must never delete an unrelated project's files"
    );
}

#[test]
fn sparse_presets_save_list_edit_and_reject_collisions() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project_id = add_git_project(&engine, repo.path());

    let empty = ok(
        &engine,
        "project.sparsePresets",
        json!({"projectId": project_id}),
    );
    assert_eq!(empty["presets"].as_array().unwrap().len(), 0);

    let saved = ok(
        &engine,
        "project.saveSparsePreset",
        json!({"projectId": project_id, "name": "App only", "directories": ["apps", "apps/", "docs"]}),
    );
    assert_eq!(saved["name"], "App only");
    assert_eq!(saved["directories"], json!(["apps", "docs"]));

    let listed = ok(
        &engine,
        "project.sparsePresets",
        json!({"projectId": project_id}),
    );
    assert_eq!(listed["presets"].as_array().unwrap().len(), 1);

    let edited = ok(
        &engine,
        "project.saveSparsePreset",
        json!({
            "projectId": project_id,
            "id": saved["id"],
            "name": "App + docs",
            "directories": ["apps", "docs"]
        }),
    );
    assert_eq!(edited["name"], "App + docs");

    assert_eq!(
        err_code(
            &engine,
            "project.saveSparsePreset",
            json!({"projectId": project_id, "name": "App + docs", "directories": ["x"]})
        ),
        "invalid_argument",
        "a name collision on a different id is refused"
    );
    assert_eq!(
        err_code(
            &engine,
            "project.saveSparsePreset",
            json!({"projectId": project_id, "name": "Empty", "directories": []})
        ),
        "invalid_argument",
        "a preset needs at least one directory"
    );

    // Folder projects cannot hold sparse presets (git-only composer row).
    let folder = tempfile::tempdir().unwrap();
    let folder_project = ok(
        &engine,
        "project.add",
        json!({"path": folder.path().to_string_lossy()}),
    );
    assert_eq!(
        err_code(
            &engine,
            "project.saveSparsePreset",
            json!({
                "projectId": folder_project["id"],
                "name": "Nope",
                "directories": ["src"]
            })
        ),
        "invalid_argument"
    );
}
