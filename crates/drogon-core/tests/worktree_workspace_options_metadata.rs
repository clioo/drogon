//! Integration tests for the Workspace Options metadata columns added to
//! `worktrees` (workspace_status, is_pinned, is_archived, sort_order,
//! manual_order, last_activity_at, linked_pr, creator) -- against a real
//! `Engine`, a real SQLite file and real temp git repositories. Same
//! fixture shape as `worktree_composer_advanced.rs`; unix-only for the
//! same reason (real `git worktree add`).
#![cfg(unix)]

use std::path::Path;
use std::process::Command;

use std::sync::atomic::{AtomicU64, Ordering};

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

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

/// Every field defaults honestly (absent/false/0), not a fake value, on a
/// freshly created worktree -- and both `worktree.create` and
/// `worktree.list` agree on the same shape.
#[test]
fn worktree_create_and_list_default_workspace_options_metadata_honestly() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project_id = add_git_project(&engine, repo.path());

    let wt = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "feature"}),
    );
    assert!(wt["workspaceStatus"].is_null());
    assert_eq!(wt["isPinned"], json!(false));
    assert_eq!(wt["isArchived"], json!(false));
    assert!(wt["manualOrder"].is_null());
    assert!(wt["linkedPr"].is_null());
    assert!(
        wt["creator"].is_null(),
        "desktop create leaves creator absent"
    );
    assert_eq!(
        wt["sortOrder"],
        json!(1),
        "first worktree in this project gets sort_order 1, not a fake constant"
    );
    assert_eq!(
        wt["lastActivityAt"], wt["createdAt"],
        "a freshly created worktree is, at minimum, as recently active as its own creation"
    );

    let listed = ok(&engine, "worktree.list", json!({"projectId": project_id}));
    assert_eq!(listed["worktrees"][0], wt);
}

/// `sort_order` is a real, monotonic per-project insertion stamp -- not a
/// constant and not global across projects.
#[test]
fn worktree_create_assigns_increasing_per_project_sort_order() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo_a = tempfile::tempdir().unwrap();
    init_repo(repo_a.path());
    let project_a = add_git_project(&engine, repo_a.path());
    let repo_b = tempfile::tempdir().unwrap();
    init_repo(repo_b.path());
    let project_b = add_git_project(&engine, repo_b.path());

    let a1 = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_a, "name": "a1"}),
    );
    let a2 = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_a, "name": "a2"}),
    );
    let b1 = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_b, "name": "b1"}),
    );
    assert_eq!(a1["sortOrder"], json!(1));
    assert_eq!(a2["sortOrder"], json!(2));
    assert_eq!(
        b1["sortOrder"],
        json!(1),
        "sort_order is scoped per project, a second project starts at 1 again"
    );
}

/// `drogon-cli worktree create` is the one real producer of
/// `creator: "cli"` today; an unrecognized value is rejected rather than
/// silently stored.
#[test]
fn worktree_create_accepts_the_cli_creator_and_rejects_unknown_values() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project_id = add_git_project(&engine, repo.path());

    let cli_created = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "from-cli", "creator": "cli"}),
    );
    assert_eq!(cli_created["creator"], "cli");

    assert_eq!(
        err_code(
            &engine,
            "worktree.create",
            json!({"projectId": project_id, "name": "bogus", "creator": "not-a-real-source"}),
        ),
        "invalid_argument"
    );
}

/// `creator: "automation"` is accepted through the SAME genuine
/// `worktree.create` API as `"cli"` -- and durably survives an engine
/// reopen and is real-filterable via `Worktree.creator ==
/// "automation"` (the frontend's `isAutomationCreatedWorktree`/Hide
/// "Automation-created"). No automation-dispatched CALLER of this API
/// exists in this build yet (`RunUnsupported::NewPerRunWorkspaceMode` is
/// unwired everywhere in the automations subsystem, confirmed at both
/// `automations::runner`/`automations::direct`, not merely `bot_run_rpc`)
/// -- that scheduler mode is unrelated, out-of-scope work; this test only
/// proves the storage/filtering half already works end to end for the
/// day a caller exists.
#[test]
fn worktree_create_accepts_and_persists_the_automation_creator_across_reopen() {
    let data_dir = tempfile::tempdir().unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());

    let (project_id, automation_wt_id, desktop_wt_id) = {
        let engine = Engine::open(data_dir.path()).unwrap();
        let project_id = add_git_project(&engine, repo.path());
        let automation_created = ok(
            &engine,
            "worktree.create",
            json!({"projectId": project_id, "name": "from-automation", "creator": "automation"}),
        );
        assert_eq!(automation_created["creator"], "automation");
        let desktop_created = ok(
            &engine,
            "worktree.create",
            json!({"projectId": project_id, "name": "from-desktop"}),
        );
        assert!(
            desktop_created["creator"].is_null(),
            "desktop create leaves creator absent"
        );
        (
            project_id,
            automation_created["id"].as_str().unwrap().to_string(),
            desktop_created["id"].as_str().unwrap().to_string(),
        )
    };

    // Reopen: a fresh Engine over the same data dir, proving durability
    // rather than an in-memory echo of the create call.
    let engine = Engine::open(data_dir.path()).unwrap();
    let listed = ok(&engine, "worktree.list", json!({"projectId": project_id}));
    let worktrees = listed["worktrees"].as_array().unwrap();
    let by_id = |id: &str| worktrees.iter().find(|w| w["id"] == id).unwrap();
    assert_eq!(by_id(&automation_wt_id)["creator"], "automation");
    assert!(by_id(&desktop_wt_id)["creator"].is_null());

    // Real filter: exactly the automation-created worktree, and only it.
    let automation_created_ids: Vec<&str> = worktrees
        .iter()
        .filter(|w| w["creator"] == "automation")
        .map(|w| w["id"].as_str().unwrap())
        .collect();
    assert_eq!(automation_created_ids, vec![automation_wt_id.as_str()]);
}

/// `worktree.update` sets and clears every Workspace Options field, and
/// bumps `last_activity_at` on any real mutation -- absent-vs-null on the
/// nullable fields distinguishes "leave untouched" from "clear", exactly
/// like the existing `note`/`parentWorktreeId` contract.
#[test]
fn worktree_update_sets_and_clears_workspace_options_fields() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project_id = add_git_project(&engine, repo.path());

    let wt = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "feature"}),
    );
    let id = wt["id"].as_str().unwrap().to_string();
    let created_at = wt["createdAt"].as_str().unwrap().to_string();

    let updated = ok(
        &engine,
        "worktree.update",
        json!({
            "worktreeId": id,
            "workspaceStatus": "in-progress",
            "isPinned": true,
            "isArchived": false,
            "manualOrder": 2000,
            "linkedPr": 42,
        }),
    );
    assert_eq!(updated["workspaceStatus"], "in-progress");
    assert_eq!(updated["isPinned"], json!(true));
    assert_eq!(updated["isArchived"], json!(false));
    assert_eq!(updated["manualOrder"], json!(2000));
    assert_eq!(updated["linkedPr"], json!(42));
    assert!(
        updated["lastActivityAt"].as_str().unwrap() >= created_at.as_str(),
        "a real mutation must bump last_activity_at forward, never backward"
    );

    // Explicit null clears the nullable fields back to "no value".
    let cleared = ok(
        &engine,
        "worktree.update",
        json!({
            "worktreeId": id,
            "workspaceStatus": null,
            "manualOrder": null,
            "linkedPr": null,
        }),
    );
    assert!(cleared["workspaceStatus"].is_null());
    assert!(cleared["manualOrder"].is_null());
    assert!(cleared["linkedPr"].is_null());
    // isPinned was never re-sent: it stays untouched by the clearing call.
    assert_eq!(cleared["isPinned"], json!(true));

    // Absent leaves every field untouched (the existing no-op contract).
    let untouched = ok(&engine, "worktree.update", json!({"worktreeId": id}));
    assert_eq!(untouched["isPinned"], json!(true));
    assert!(untouched["workspaceStatus"].is_null());

    // Unpin, and re-archive.
    let unpinned = ok(
        &engine,
        "worktree.update",
        json!({"worktreeId": id, "isPinned": false, "isArchived": true}),
    );
    assert_eq!(unpinned["isPinned"], json!(false));
    assert_eq!(unpinned["isArchived"], json!(true));
}

/// `worktree.rename` is a real mutation too -- it must bump
/// `last_activity_at` the same as `worktree.update` does, so Sort by
/// "Recent" and Hide "Sleeping" see a rename as activity.
#[test]
fn worktree_rename_bumps_last_activity_at() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project_id = add_git_project(&engine, repo.path());

    let wt = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "feature"}),
    );
    let id = wt["id"].as_str().unwrap().to_string();
    let created_at = wt["createdAt"].as_str().unwrap().to_string();

    let renamed = ok(
        &engine,
        "worktree.rename",
        json!({"worktreeId": id, "name": "Renamed feature"}),
    );
    assert_eq!(renamed["title"], "Renamed feature");
    assert!(renamed["lastActivityAt"].as_str().unwrap() >= created_at.as_str());
}

/// A data dir written by a pre-v5 daemon (schema_versions row at 1, no
/// Workspace Options columns at all) backfills `sort_order` in
/// `created_at` order and `last_activity_at` from `created_at` on open --
/// real migration recovery, not a silently-zeroed column that would break
/// Sort by "Manual"'s tiebreak for every pre-existing worktree.
#[test]
fn v1_database_backfills_sort_order_and_last_activity_at_on_open() {
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
        for (id, path, created_at) in [
            ("w1", "/tmp/x/w1", "2026-09-07T00:00:00Z"),
            ("w2", "/tmp/x/w2", "2026-09-07T00:01:00Z"),
        ] {
            conn.execute(
                "INSERT INTO workspaces (id, host_id, path, name, kind, created_at)
                 VALUES (?1, 'h', ?2, 'w', 'git', ?3)",
                rusqlite::params![format!("ws-{id}"), path, created_at],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO worktrees (id, project_id, workspace_id, path, branch, head, base_ref, created_at)
                 VALUES (?1, 'p1', ?2, ?3, 'feature', 'abc', NULL, ?4)",
                rusqlite::params![id, format!("ws-{id}"), path, created_at],
            )
            .unwrap();
        }
    }
    let engine = Engine::open(data_dir.path()).unwrap();
    let listed = ok(&engine, "worktree.list", json!({"projectId": "p1"}));
    let worktrees = listed["worktrees"].as_array().unwrap();
    assert_eq!(worktrees.len(), 2);
    let by_id = |id: &str| worktrees.iter().find(|w| w["id"] == id).unwrap();
    assert_eq!(
        by_id("w1")["sortOrder"],
        json!(1),
        "created first, ranked first"
    );
    assert_eq!(
        by_id("w2")["sortOrder"],
        json!(2),
        "created second, ranked second"
    );
    assert_eq!(by_id("w1")["lastActivityAt"], "2026-09-07T00:00:00Z");
    assert_eq!(by_id("w2")["lastActivityAt"], "2026-09-07T00:01:00Z");
}

/// A folder Project's synthesized implicit worktree (no real `worktrees`
/// row) renders Workspace Options metadata at honest defaults, the same
/// way it already does for title/note/parentWorktreeId.
#[test]
fn folder_project_implicit_worktree_defaults_workspace_options_metadata() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let folder = tempfile::tempdir().unwrap();
    let project = ok(
        &engine,
        "project.add",
        json!({"path": folder.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap().to_string();

    let listed = ok(&engine, "worktree.list", json!({"projectId": project_id}));
    let implicit = &listed["worktrees"][0];
    assert!(implicit["workspaceStatus"].is_null());
    assert_eq!(implicit["isPinned"], json!(false));
    assert_eq!(implicit["isArchived"], json!(false));
    assert_eq!(implicit["sortOrder"], json!(0));
    assert!(implicit["manualOrder"].is_null());
    assert!(implicit["creator"].is_null());
}

/// `worktree.update` against a folder Project's implicit-worktree id
/// (`project.id`, no real `worktrees` row -- coordinator review,
/// msg_cc2acea0c485: "status/manual order must work for folder workspaces
/// with real identity") persists workspace status/pin/archive/manual
/// order for real, durably, and the change survives a fresh `list` read
/// and an engine reopen -- not just an in-memory echo.
#[test]
fn worktree_update_sets_workspace_options_for_a_folder_projects_implicit_worktree() {
    let data_dir = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    let project_id = {
        let engine = Engine::open(data_dir.path()).unwrap();
        let project = ok(
            &engine,
            "project.add",
            json!({"path": folder.path().to_string_lossy()}),
        );
        let project_id = project["id"].as_str().unwrap().to_string();

        let updated = ok(
            &engine,
            "worktree.update",
            json!({
                "worktreeId": project_id,
                "workspaceStatus": "in-review",
                "isPinned": true,
                "manualOrder": 5000,
            }),
        );
        assert_eq!(
            updated["id"], project_id,
            "the implicit worktree id is the project id"
        );
        assert_eq!(updated["workspaceStatus"], "in-review");
        assert_eq!(updated["isPinned"], json!(true));
        assert_eq!(updated["isArchived"], json!(false));
        assert_eq!(updated["manualOrder"], json!(5000));
        project_id
    };

    // Survives a fresh `list` read and a full engine reopen -- real
    // durable storage, not an in-memory echo of the update call.
    let engine = Engine::open(data_dir.path()).unwrap();
    let listed = ok(&engine, "worktree.list", json!({"projectId": project_id}));
    let implicit = &listed["worktrees"][0];
    assert_eq!(implicit["workspaceStatus"], "in-review");
    assert_eq!(implicit["isPinned"], json!(true));
    assert_eq!(implicit["manualOrder"], json!(5000));
}

/// `note`/`parentWorktreeId`/`linkedPr` have no folder-project equivalent
/// (no branch, exactly one worktree with no sibling) and must be refused
/// outright rather than silently accepted and dropped.
#[test]
fn worktree_update_rejects_inapplicable_fields_for_a_folder_projects_implicit_worktree() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let folder = tempfile::tempdir().unwrap();
    let project = ok(
        &engine,
        "project.add",
        json!({"path": folder.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap().to_string();

    assert_eq!(
        err_code(
            &engine,
            "worktree.update",
            json!({"worktreeId": project_id, "note": "does not apply"}),
        ),
        "invalid_argument"
    );
    assert_eq!(
        err_code(
            &engine,
            "worktree.update",
            json!({"worktreeId": project_id, "linkedPr": 1}),
        ),
        "invalid_argument"
    );
}

/// A genuinely unknown id (neither a real worktree nor a folder project)
/// is still `not_found`, not silently accepted.
#[test]
fn worktree_update_unknown_id_is_not_found() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    assert_eq!(
        err_code(
            &engine,
            "worktree.update",
            json!({"worktreeId": "no-such-worktree-or-project", "isPinned": true}),
        ),
        "not_found"
    );
}
