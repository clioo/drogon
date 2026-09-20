//! Integration tests for Project/Worktree lifecycle and Session agent-state
//! transitions (journey J1), against a real
//! `Engine`, a real SQLite file, real temp git repositories and a real PTY
//! child. Unix-only (`/bin/sh`), same scope as `engine.rs`.
#![cfg(unix)]

use std::path::Path;
use std::process::Command;
use std::thread::sleep;
use std::time::{Duration, Instant};

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

fn err_message(engine: &Engine, method: &str, request_id: &str, params: Value) -> String {
    let response = engine.dispatch(req(method, request_id, params));
    assert!(
        !response.ok,
        "expected error for {method}, got {:?}",
        response.result
    );
    response.error.unwrap().message
}

fn wait_for<F: FnMut() -> bool>(mut pred: F, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if pred() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        sleep(Duration::from_millis(20));
    }
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(dir)
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?} failed in {dir:?}");
}

/// A real git repository with one commit on `main`, so `HEAD` always
/// resolves for `worktree.create`'s default (unspecified) base ref.
fn init_repo(dir: &Path) {
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "user.name", "Test"]);
    std::fs::write(dir.join("README.md"), "hello\n").unwrap();
    git(dir, &["add", "README.md"]);
    git(dir, &["commit", "-q", "-m", "initial"]);
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

// --- Projects ---------------------------------------------------------------

#[test]
fn project_add_is_idempotent_by_canonical_path_and_classifies_folder_vs_git() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();

    let folder = tempfile::tempdir().unwrap();
    let a = ok(
        &engine,
        "project.add",
        "p1",
        json!({"path": folder.path().to_string_lossy()}),
    );
    let b = ok(
        &engine,
        "project.add",
        "p2",
        json!({"path": folder.path().to_string_lossy()}),
    );
    assert_eq!(
        a["id"], b["id"],
        "same canonical path must yield the same project id"
    );
    assert_eq!(a["kind"], "folder");
    assert!(a["defaultBaseRef"].is_null());

    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let git_project = ok(
        &engine,
        "project.add",
        "p3",
        json!({"path": repo.path().to_string_lossy()}),
    );
    assert_eq!(git_project["kind"], "git");

    let listed = ok(&engine, "project.list", "p4", json!({}));
    assert_eq!(listed["projects"].as_array().unwrap().len(), 2);
}

#[test]
fn project_remove_deletes_the_row_but_never_the_files() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let folder = tempfile::tempdir().unwrap();
    let project = ok(
        &engine,
        "project.add",
        "p1",
        json!({"path": folder.path().to_string_lossy()}),
    );
    let id = project["id"].as_str().unwrap();

    ok(&engine, "project.remove", "p2", json!({"id": id}));
    assert!(
        folder.path().is_dir(),
        "project.remove must never delete files"
    );
    assert_eq!(
        ok(&engine, "project.list", "p3", json!({}))["projects"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    assert_eq!(
        err_code(&engine, "project.remove", "p4", json!({"id": id})),
        "not_found"
    );
}

// --- Folder project implicit worktree ---------------------------------------

#[test]
fn folder_project_exposes_one_implicit_worktree_and_starts_a_session_in_it() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let folder = tempfile::tempdir().unwrap();
    let project = ok(
        &engine,
        "project.add",
        "p1",
        json!({"path": folder.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap();

    let listed = ok(
        &engine,
        "worktree.list",
        "w1",
        json!({"projectId": project_id}),
    );
    let worktrees = listed["worktrees"].as_array().unwrap();
    assert_eq!(
        worktrees.len(),
        1,
        "a folder project has exactly one implicit worktree"
    );
    assert_eq!(worktrees[0]["path"], project["path"]);
    let workspace_id = worktrees[0]["workspaceId"].as_str().unwrap().to_string();

    let session = ok(
        &engine,
        "session.start",
        "s1",
        json!({"workspaceId": workspace_id, "command": "/bin/sh", "args": ["-c", "pwd"], "cols": 80, "rows": 24}),
    );
    assert_eq!(session["verdict"], "live");

    // worktree.create on a folder project now creates an additional named
    // Workspace section sharing the folder path (issue #579), with its own
    // distinct workspaceId so its sessions group separately.
    let extra = ok(
        &engine,
        "worktree.create",
        "w2",
        json!({"projectId": project_id, "name": "extra"}),
    );
    assert_eq!(extra["path"], project["path"]);
    assert_ne!(extra["workspaceId"].as_str().unwrap(), workspace_id);
    let listed = ok(
        &engine,
        "worktree.list",
        "w3",
        json!({"projectId": project_id}),
    );
    assert_eq!(
        listed["worktrees"].as_array().unwrap().len(),
        2,
        "the implicit primary plus the created section"
    );

    // Git-only options remain refused on a folder Workspace.
    assert_eq!(
        err_code(
            &engine,
            "worktree.create",
            "w4",
            json!({"projectId": project_id, "name": "nope", "baseRef": "main"})
        ),
        "invalid_argument"
    );
}

// --- Git project worktrees ---------------------------------------------------

#[test]
fn git_project_create_two_worktrees_list_and_remove() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let main_head = rev_parse(repo.path(), "HEAD");

    let project = ok(
        &engine,
        "project.add",
        "p1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap();

    let wt1 = ok(
        &engine,
        "worktree.create",
        "w1",
        json!({"projectId": project_id, "name": "feature-a"}),
    );
    assert_eq!(wt1["branch"], "feature-a");
    assert_eq!(
        wt1["head"], main_head,
        "no baseRef defaults to current HEAD"
    );
    assert!(wt1["baseRef"].is_null());

    let wt2 = ok(
        &engine,
        "worktree.create",
        "w2",
        json!({"projectId": project_id, "name": "feature-b"}),
    );
    assert_ne!(wt1["path"], wt2["path"]);
    assert_ne!(wt1["workspaceId"], wt2["workspaceId"]);

    let listed = ok(
        &engine,
        "worktree.list",
        "w3",
        json!({"projectId": project_id}),
    );
    let worktrees = listed["worktrees"].as_array().unwrap();
    assert_eq!(worktrees.len(), 2);
    let ids: Vec<&str> = worktrees
        .iter()
        .map(|w| w["id"].as_str().unwrap())
        .collect();
    assert!(ids.contains(&wt1["id"].as_str().unwrap()));
    assert!(ids.contains(&wt2["id"].as_str().unwrap()));

    // session.start works unchanged against a worktree's registered workspace.
    let workspace_id = wt2["workspaceId"].as_str().unwrap().to_string();
    let session = ok(
        &engine,
        "session.start",
        "s1",
        json!({"workspaceId": workspace_id, "command": "/bin/sh", "args": ["-c", "git rev-parse --abbrev-ref HEAD"], "cols": 80, "rows": 24}),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();
    let saw_branch_name = wait_for(
        || {
            let read = ok(
                &engine,
                "session.read",
                "r1",
                json!({"sessionId": session_id, "incarnation": incarnation, "cursor": 0}),
            );
            let bytes = base64_decode(read["dataBase64"].as_str().unwrap());
            String::from_utf8_lossy(&bytes).contains("feature-b")
        },
        Duration::from_secs(3),
    );
    assert!(
        saw_branch_name,
        "session started inside the feature-b worktree"
    );

    let remove_id = wt1["id"].as_str().unwrap();
    ok(&engine, "worktree.remove", "w4", json!({"id": remove_id}));
    let after_remove = ok(
        &engine,
        "worktree.list",
        "w5",
        json!({"projectId": project_id}),
    );
    assert_eq!(after_remove["worktrees"].as_array().unwrap().len(), 1);
    assert_eq!(
        err_code(&engine, "worktree.remove", "w6", json!({"id": remove_id})),
        "not_found"
    );
}

// --- Project removal drops its workspaces (#354) ----------------------------

#[test]
fn project_remove_also_removes_its_worktree_workspaces() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());

    let project = ok(
        &engine,
        "project.add",
        "p1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap();
    let folder = tempfile::tempdir().unwrap();
    let other = ok(
        &engine,
        "project.add",
        "p2",
        json!({"path": folder.path().to_string_lossy()}),
    );
    let other_id = other["id"].as_str().unwrap().to_string();
    let other_worktrees = ok(
        &engine,
        "worktree.list",
        "w0",
        json!({"projectId": other_id}),
    );
    let other_workspace = other_worktrees["worktrees"][0]["workspaceId"]
        .as_str()
        .unwrap()
        .to_string();

    let wt = ok(
        &engine,
        "worktree.create",
        "w1",
        json!({"projectId": project_id, "name": "feature-a"}),
    );
    let wt_workspace = wt["workspaceId"].as_str().unwrap().to_string();
    let wt_path = wt["path"].as_str().unwrap().to_string();
    let before = ok(&engine, "workspace.list", "l1", json!({}));
    assert!(
        before["workspaces"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w["id"] == wt_workspace),
        "the worktree's workspace is listed before the removal"
    );

    ok(&engine, "project.remove", "p3", json!({"id": project_id}));
    let after = ok(&engine, "workspace.list", "l2", json!({}));
    assert!(
        after["workspaces"]
            .as_array()
            .unwrap()
            .iter()
            .all(|w| w["id"] != wt_workspace),
        "project.remove must drop the removed project's worktree workspaces"
    );
    assert!(
        Path::new(&wt_path).is_dir(),
        "project.remove never deletes files; the checkout becomes unmanaged"
    );
    // A different project's implicit folder workspace is untouched.
    assert!(
        after["workspaces"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w["id"] == other_workspace),
        "sibling projects keep their workspaces"
    );
    // The project's worktree registrations are gone with it.
    assert_eq!(
        err_code(
            &engine,
            "worktree.list",
            "w2",
            json!({"projectId": project_id}),
        ),
        "not_found"
    );
}

#[test]
fn worktree_create_reports_existing_branch_with_actionable_guidance() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());

    let project = ok(
        &engine,
        "project.add",
        "p1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap();
    let response = engine.dispatch(req(
        "worktree.create",
        "w1",
        json!({"projectId": project_id, "name": "main"}),
    ));

    assert!(!response.ok);
    let error = response.error.unwrap();
    assert_eq!(error.code, "invalid_argument");
    assert_eq!(
        error.message,
        "branch 'main' already exists; choose a new worktree name and use Base ref to start from this branch"
    );
    assert_eq!(
        ok(
            &engine,
            "worktree.list",
            "w2",
            json!({"projectId": project_id}),
        )["worktrees"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
}

#[test]
fn worktree_create_honors_an_explicit_base_ref() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    git(repo.path(), &["checkout", "-q", "-b", "topic"]);
    std::fs::write(repo.path().join("topic.txt"), "topic\n").unwrap();
    git(repo.path(), &["add", "topic.txt"]);
    git(repo.path(), &["commit", "-q", "-m", "topic commit"]);
    let topic_head = rev_parse(repo.path(), "topic");
    git(repo.path(), &["checkout", "-q", "main"]);

    let project = ok(
        &engine,
        "project.add",
        "p1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap();

    let wt = ok(
        &engine,
        "worktree.create",
        "w1",
        json!({"projectId": project_id, "name": "from-topic", "baseRef": "topic"}),
    );
    assert_eq!(wt["baseRef"], "topic");
    assert_eq!(wt["head"], topic_head);
}

#[test]
fn worktree_remove_refuses_a_dirty_checkout_unless_forced() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());

    let project = ok(
        &engine,
        "project.add",
        "p1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap();
    let wt = ok(
        &engine,
        "worktree.create",
        "w1",
        json!({"projectId": project_id, "name": "dirty"}),
    );
    let id = wt["id"].as_str().unwrap();
    let path = wt["path"].as_str().unwrap();
    std::fs::write(
        Path::new(path).join("README.md"),
        "changed, not committed\n",
    )
    .unwrap();

    let refusal = err_message(&engine, "worktree.remove", "w2", json!({"id": id}));
    assert!(
        refusal.contains("use --force to delete it"),
        "git worktree remove refuses a dirty checkout without --force, in its \
         own words -- got: {refusal}"
    );
    ok(
        &engine,
        "worktree.remove",
        "w3",
        json!({"id": id, "force": true}),
    );
    assert!(
        !Path::new(path).exists(),
        "forced remove actually removes the checkout"
    );
}

// --- Force delete covers what git alone will not (#604) ---------------------

/// Every state below leaves `worktree.remove` the only way a user can retire
/// the card, so a successful removal has to leave no row behind either.
fn assert_worktree_gone(engine: &Engine, project_id: &str, worktree_id: &str, request_id: &str) {
    let listed = ok(
        engine,
        "worktree.list",
        request_id,
        json!({"projectId": project_id}),
    );
    assert!(
        !listed["worktrees"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w["id"] == worktree_id),
        "the removed workspace must not survive in worktree.list"
    );
}

#[test]
fn worktree_remove_forces_a_git_locked_checkout() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());

    let project = ok(
        &engine,
        "project.add",
        "p1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap().to_string();
    let wt = ok(
        &engine,
        "worktree.create",
        "w1",
        json!({"projectId": project_id, "name": "locked"}),
    );
    let id = wt["id"].as_str().unwrap().to_string();
    let path = wt["path"].as_str().unwrap().to_string();
    git(repo.path(), &["worktree", "lock", &path]);

    assert_eq!(
        err_code(&engine, "worktree.remove", "w2", json!({"id": id})),
        "io_error",
        "git refuses a locked working tree when nothing was forced"
    );
    // git demands `remove -f -f` here: before #604 the single --force Drogon
    // sent made the Force checkbox unable to delete a locked workspace at all.
    ok(
        &engine,
        "worktree.remove",
        "w3",
        json!({"id": id, "force": true}),
    );
    assert!(
        !Path::new(&path).exists(),
        "forced remove deletes a locked checkout"
    );
    assert_worktree_gone(&engine, &project_id, &id, "w4");
}

#[test]
fn worktree_remove_forces_a_checkout_git_no_longer_registers() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());

    let project = ok(
        &engine,
        "project.add",
        "p1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap().to_string();
    let wt = ok(
        &engine,
        "worktree.create",
        "w1",
        json!({"projectId": project_id, "name": "orphan"}),
    );
    let id = wt["id"].as_str().unwrap().to_string();
    let path = wt["path"].as_str().unwrap().to_string();

    // The state #604 was filed from: git's admin entry is gone (pruned while
    // the directory was elsewhere) but the checkout is still on disk, so
    // `git worktree remove` dies "is not a working tree" however hard it is
    // forced and the workspace could never be deleted from Drogon at all.
    let stashed = format!("{path}.stashed");
    std::fs::rename(&path, &stashed).unwrap();
    git(repo.path(), &["worktree", "prune"]);
    std::fs::rename(&stashed, &path).unwrap();
    assert!(Path::new(&path).exists());

    let refusal = err_message(&engine, "worktree.remove", "w2", json!({"id": id}));
    assert!(
        refusal.contains("git no longer registers a working tree") && refusal.contains("Use Force"),
        "an unregistered checkout is refused with copy the user can act on, \
         not git's useless fatal -- got: {refusal}"
    );
    assert!(
        Path::new(&path).exists(),
        "the refusal leaves the directory untouched"
    );

    ok(
        &engine,
        "worktree.remove",
        "w3",
        json!({"id": id, "force": true}),
    );
    assert!(
        !Path::new(&path).exists(),
        "force deletes the orphaned directory git had forgotten"
    );
    assert_worktree_gone(&engine, &project_id, &id, "w4");
}

#[test]
fn worktree_remove_forces_a_row_whose_directory_and_registration_are_both_gone() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());

    let project = ok(
        &engine,
        "project.add",
        "p1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap().to_string();
    let wt = ok(
        &engine,
        "worktree.create",
        "w1",
        json!({"projectId": project_id, "name": "vanished"}),
    );
    let id = wt["id"].as_str().unwrap().to_string();
    let path = wt["path"].as_str().unwrap().to_string();

    std::fs::remove_dir_all(&path).unwrap();
    git(repo.path(), &["worktree", "prune"]);

    ok(
        &engine,
        "worktree.remove",
        "w2",
        json!({"id": id, "force": true}),
    );
    assert_worktree_gone(&engine, &project_id, &id, "w3");
}

fn worktree_paths(dir: &Path) -> String {
    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(dir)
        .output()
        .unwrap();
    assert!(output.status.success());
    String::from_utf8(output.stdout).unwrap()
}

#[test]
fn worktree_remove_forces_a_checkout_git_refuses_even_twice_forced() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());

    let project = ok(
        &engine,
        "project.add",
        "p1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap().to_string();
    let wt = ok(
        &engine,
        "worktree.create",
        "w1",
        json!({"projectId": project_id, "name": "broken"}),
    );
    let id = wt["id"].as_str().unwrap().to_string();
    let path = wt["path"].as_str().unwrap().to_string();

    // git still registers this worktree, so it is not the orphan case -- but
    // its .git file no longer resolves, and `remove -f -f` fails validation
    // rather than deleting anything. Force still has to mean the workspace goes.
    std::fs::write(Path::new(&path).join(".git"), "not a gitfile\n").unwrap();
    assert!(
        worktree_paths(repo.path()).contains(&path),
        "precondition: git has not forgotten this worktree"
    );

    ok(
        &engine,
        "worktree.remove",
        "w2",
        json!({"id": id, "force": true}),
    );
    assert!(!Path::new(&path).exists(), "force deletes the checkout");
    assert!(
        !worktree_paths(repo.path()).contains(&path),
        "and prunes the admin entry git was still holding, so the name is free again"
    );
    assert_worktree_gone(&engine, &project_id, &id, "w3");
}

#[test]
fn worktree_remove_leaves_a_sibling_worktree_whose_directory_is_merely_away() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());

    let project = ok(
        &engine,
        "project.add",
        "p1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap().to_string();
    let doomed = ok(
        &engine,
        "worktree.create",
        "w1",
        json!({"projectId": project_id, "name": "doomed"}),
    );
    let sibling = ok(
        &engine,
        "worktree.create",
        "w2",
        json!({"projectId": project_id, "name": "sibling"}),
    );
    let doomed_path = doomed["path"].as_str().unwrap().to_string();
    let sibling_path = sibling["path"].as_str().unwrap().to_string();

    // The sibling lives on a volume that is not mounted right now, so git
    // counts its entry as prunable. Deleting an unrelated workspace must not
    // take it away: a repo-wide `git worktree prune` here would deregister
    // it, and it would come back from the mount no longer a worktree.
    let stashed = format!("{sibling_path}.unmounted");
    std::fs::rename(&sibling_path, &stashed).unwrap();
    // Force the doomed checkout down the recovery path: git still registers
    // it, but its .git file no longer resolves, so `remove -f -f` refuses.
    std::fs::write(Path::new(&doomed_path).join(".git"), "not a gitfile\n").unwrap();

    ok(
        &engine,
        "worktree.remove",
        "w3",
        json!({"id": doomed["id"], "force": true}),
    );
    std::fs::rename(&stashed, &sibling_path).unwrap();
    assert!(
        worktree_paths(repo.path()).contains(&sibling_path),
        "the sibling is still a registered worktree once its volume is back"
    );
    assert!(
        !worktree_paths(repo.path()).contains(&doomed_path),
        "and the deleted workspace's own entry is gone"
    );
}

#[test]
fn worktree_remove_still_reports_a_failure_git_owns() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());

    let project = ok(
        &engine,
        "project.add",
        "p1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap().to_string();
    let wt = ok(
        &engine,
        "worktree.create",
        "w1",
        json!({"projectId": project_id, "name": "dirty"}),
    );
    let id = wt["id"].as_str().unwrap().to_string();
    let path = wt["path"].as_str().unwrap().to_string();
    std::fs::write(Path::new(&path).join("README.md"), "uncommitted\n").unwrap();

    // A worktree git still registers keeps git's own verdict: the recovery
    // path must never swallow a refusal by deleting the directory itself.
    let refusal = err_message(&engine, "worktree.remove", "w2", json!({"id": id}));
    assert!(
        refusal.contains("use --force to delete it"),
        "git still registers this one, so git's own verdict is what comes \
         back -- not the unregistered-workspace copy -- got: {refusal}"
    );
    assert!(
        Path::new(&path).join("README.md").exists(),
        "a refused removal leaves the checkout in place"
    );
    let listed = ok(
        &engine,
        "worktree.list",
        "w3",
        json!({"projectId": project_id}),
    );
    assert!(
        listed["worktrees"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w["id"] == id.as_str()),
        "a refused removal keeps the row"
    );
}

#[test]
fn folder_workspace_remove_drops_the_registration_and_leaves_the_folder() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let folder = tempfile::tempdir().unwrap();
    std::fs::write(folder.path().join("keep.txt"), "the user's files\n").unwrap();

    let project = ok(
        &engine,
        "project.add",
        "p1",
        json!({"path": folder.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap().to_string();
    let listed = ok(
        &engine,
        "worktree.list",
        "w1",
        json!({"projectId": project_id}),
    );
    let implicit = listed["worktrees"][0]["id"].as_str().unwrap().to_string();

    // The implicit row's id is the project's own and it has no `worktrees`
    // row, so before #604 this answered "worktree not found" and the folder
    // workspace stayed in the sidebar for good -- with no Force to fall back
    // on, since the dialog offers none for a folder delete.
    ok(&engine, "worktree.remove", "w2", json!({"id": implicit}));
    assert!(
        folder.path().join("keep.txt").exists(),
        "removing a folder workspace removes the registration, never the files"
    );
    let projects = ok(&engine, "project.list", "p2", json!({}));
    assert!(
        !projects["projects"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["id"] == project_id.as_str()),
        "the folder project's registration is what the card owned"
    );
    let workspaces = ok(&engine, "workspace.list", "s1", json!({}));
    assert!(
        !workspaces["workspaces"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w["path"] == folder.path().to_string_lossy().as_ref()),
        "and its workspace goes with it, or the shell keeps rendering the card"
    );
}

#[test]
fn worktree_remove_still_refuses_an_id_that_names_nothing() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    assert_eq!(
        err_code(
            &engine,
            "worktree.remove",
            "w1",
            json!({"id": "no-such-id"})
        ),
        "not_found"
    );
}

#[test]
fn worktree_remove_never_unregisters_a_git_project_through_its_project_id() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());

    let project = ok(
        &engine,
        "project.add",
        "p1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap().to_string();

    // Only a *folder* project exposes an implicit worktree carrying its own
    // id. A git project's id names no worktree, and must never be mistaken
    // for one -- removing it would unregister the whole project and every
    // workspace under it.
    assert_eq!(
        err_code(&engine, "worktree.remove", "w1", json!({"id": project_id})),
        "not_found"
    );
    let projects = ok(&engine, "project.list", "p2", json!({}));
    assert!(
        projects["projects"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["id"] == project_id.as_str()),
        "the project is still registered"
    );
}

#[test]
fn worktree_remove_refuses_a_recorded_path_that_is_not_normalized() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());

    let project = ok(
        &engine,
        "project.add",
        "p1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap().to_string();
    let wt = ok(
        &engine,
        "worktree.create",
        "w1",
        json!({"projectId": project_id, "name": "kept"}),
    );
    let id = wt["id"].as_str().unwrap().to_string();
    let path = wt["path"].as_str().unwrap().to_string();

    // `worktree.create` never writes a `..`, but a row that acquired one
    // must not make a forced delete report success having removed nothing:
    // the checkout would stay on disk with the rows gone, so nothing could
    // reach it again -- the very shape of #604, re-entered through the fix.
    let detoured = format!("{path}/../no-such-dir-zzz/../kept");
    {
        let db = data_dir.path().join("drogon.sqlite3");
        let conn = rusqlite::Connection::open(db).unwrap();
        conn.execute(
            "UPDATE worktrees SET path = ?1 WHERE id = ?2",
            rusqlite::params![detoured, id],
        )
        .unwrap();
    }

    let refusal = err_message(
        &engine,
        "worktree.remove",
        "w2",
        json!({"id": id, "force": true}),
    );
    assert!(refusal.contains("not normalized"), "got: {refusal}");
    assert!(
        Path::new(&path).exists(),
        "and the checkout it could not resolve is still there"
    );
    let listed = ok(
        &engine,
        "worktree.list",
        "w3",
        json!({"projectId": project_id}),
    );
    assert!(
        listed["worktrees"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w["id"] == id.as_str()),
        "a refusal never drops the row -- that is what makes it unreachable"
    );
}

#[test]
fn folder_workspace_remove_carries_project_removes_file_semantics() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();

    // A Quick Session's scratch is app-owned, lives under the data dir, and
    // `project.remove` deletes it on an explicit delete -- which is already
    // what the Chats card does, since ChatsList submits `project.remove`.
    // Routing the implicit worktree to the same method has to mean the same
    // thing, or the two surfaces disagree about the same card.
    let quick = ok(
        &engine,
        "project.quickSessionCreate",
        "q1",
        json!({"name": "scratch chat"}),
    );
    let quick_id = quick["project"]["id"].as_str().unwrap().to_string();
    let scratch = quick["project"]["path"].as_str().unwrap().to_string();
    assert!(Path::new(&scratch).exists());

    let listed = ok(
        &engine,
        "worktree.list",
        "w1",
        json!({"projectId": quick_id}),
    );
    let implicit = listed["worktrees"][0]["id"].as_str().unwrap().to_string();
    assert_eq!(
        implicit, quick_id,
        "a quick session's implicit worktree is the project"
    );

    ok(&engine, "worktree.remove", "w2", json!({"id": implicit}));
    assert!(
        !Path::new(&scratch).exists(),
        "the app-owned scratch goes, exactly as project.remove documents"
    );
}

#[test]
fn worktree_remove_refuses_to_take_a_nested_workspace_down_with_it() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());

    let project = ok(
        &engine,
        "project.add",
        "p1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap().to_string();
    let outer = ok(
        &engine,
        "worktree.create",
        "w1",
        json!({"projectId": project_id, "name": "outer"}),
    );
    // A name may carry a separator, so one workspace's checkout can sit
    // inside another's without anyone tampering with the database.
    let inner = ok(
        &engine,
        "worktree.create",
        "w2",
        json!({"projectId": project_id, "name": "outer/inner", "branch": "inner-branch"}),
    );
    let outer_path = outer["path"].as_str().unwrap().to_string();
    let inner_path = inner["path"].as_str().unwrap().to_string();
    assert!(
        Path::new(&inner_path).starts_with(&outer_path),
        "precondition: the inner checkout really is inside the outer one"
    );
    std::fs::write(Path::new(&inner_path).join("work.txt"), "uncommitted\n").unwrap();

    // Send the outer one down the recovery path, where Drogon deletes the
    // directory itself: a plain `remove_dir_all` would take the inner
    // checkout with it and leave the inner row pointing at nothing.
    std::fs::write(Path::new(&outer_path).join(".git"), "not a gitfile\n").unwrap();
    let refusal = err_message(
        &engine,
        "worktree.remove",
        "w3",
        json!({"id": outer["id"], "force": true}),
    );
    assert!(
        refusal.contains("is inside it") && refusal.contains(&inner_path),
        "the refusal names the workspace that would have been destroyed -- got: {refusal}"
    );
    assert!(
        Path::new(&inner_path).join("work.txt").exists(),
        "the nested workspace's uncommitted work survives"
    );

    // Deleting the inner one first is the way through, and then the outer
    // one goes.
    ok(
        &engine,
        "worktree.remove",
        "w4",
        json!({"id": inner["id"], "force": true}),
    );
    ok(
        &engine,
        "worktree.remove",
        "w5",
        json!({"id": outer["id"], "force": true}),
    );
    assert!(!Path::new(&outer_path).exists());
}

// --- Agent state --------------------------------------------------------------

fn base64_decode(text: &str) -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .unwrap()
}

#[test]
fn session_agent_state_transitions_working_idle_then_exited() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let folder = tempfile::tempdir().unwrap();
    let workspace = ok(
        &engine,
        "workspace.register",
        "ws1",
        json!({"path": folder.path().to_string_lossy()}),
    );
    let workspace_id = workspace["id"].as_str().unwrap().to_string();

    // Fixture: prints, then sleeps past the 3s activity window, then exits.
    let session = ok(
        &engine,
        "session.start",
        "s1",
        json!({
            "workspaceId": workspace_id,
            "command": "/bin/sh",
            "args": ["-c", "printf hello; sleep 4; printf done"],
            "cols": 80, "rows": 24
        }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();

    let read = |cursor: u64| -> Value {
        ok(
            &engine,
            "session.read",
            "r",
            json!({"sessionId": session_id, "incarnation": incarnation, "cursor": cursor}),
        )
    };

    let mut saw_hello = false;
    assert!(
        wait_for(
            || {
                let r = read(0);
                let bytes = base64_decode(r["dataBase64"].as_str().unwrap());
                saw_hello = String::from_utf8_lossy(&bytes).contains("hello");
                saw_hello
            },
            Duration::from_secs(2),
        ),
        "fixture must print promptly"
    );
    let just_after_output = read(0);
    assert_eq!(
        just_after_output["session"]["agentState"], "working",
        "output just arrived, well inside the 3s activity window"
    );
    assert!(just_after_output["session"]["agentStateAt"].is_string());

    // Cross the 3s activity window while the fixture is still sleeping.
    sleep(Duration::from_millis(3300));
    let while_silent = read(0);
    assert_eq!(just_after_output["session"]["verdict"], "live");
    assert_eq!(
        while_silent["session"]["agentState"], "idle",
        "no output for over 3s while the child is still alive"
    );

    assert!(
        wait_for(
            || read(0)["session"]["verdict"] == "exited",
            Duration::from_secs(3),
        ),
        "fixture must exit after its sleep"
    );
    let after_exit = read(0);
    assert_eq!(after_exit["session"]["agentState"], "exited");
    assert!(after_exit["session"]["agentStateAt"].is_null());
}

#[test]
fn session_agent_state_is_unknown_before_any_output() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let folder = tempfile::tempdir().unwrap();
    let workspace = ok(
        &engine,
        "workspace.register",
        "ws1",
        json!({"path": folder.path().to_string_lossy()}),
    );
    let workspace_id = workspace["id"].as_str().unwrap().to_string();

    let session = ok(
        &engine,
        "session.start",
        "s1",
        json!({
            "workspaceId": workspace_id,
            "command": "/bin/sh",
            "args": ["-c", "sleep 2"],
            "cols": 80, "rows": 24
        }),
    );
    // Immediately after start, before the child has produced any output.
    assert_eq!(session["agentState"], "unknown");
    assert!(session["agentStateAt"].is_null());
}
