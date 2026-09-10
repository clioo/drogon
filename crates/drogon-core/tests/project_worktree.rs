//! Integration tests for Project/Worktree lifecycle and Session agent-state
//! transitions (`docs/migration/rewrite-mvp-plan.md` J1), against a real
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

    // worktree.create is refused on a folder project.
    assert_eq!(
        err_code(
            &engine,
            "worktree.create",
            "w2",
            json!({"projectId": project_id, "name": "extra"})
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

    assert_eq!(
        err_code(&engine, "worktree.remove", "w2", json!({"id": id})),
        "io_error",
        "git worktree remove refuses a dirty checkout without --force"
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

#[test]
fn worktree_get_returns_one_row_and_current_resolves_the_enclosing_worktree() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());

    let project = ok(
        &engine,
        "project.add",
        "pg1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap().to_string();
    let created = ok(
        &engine,
        "worktree.create",
        "wg1",
        json!({"projectId": project_id, "name": "feature-show"}),
    );
    let worktree_id = created["id"].as_str().unwrap().to_string();
    let worktree_path = created["path"].as_str().unwrap().to_string();

    // worktree.get by id returns exactly that row.
    let shown = ok(&engine, "worktree.get", "wg2", json!({"id": worktree_id}));
    assert_eq!(shown["worktree"]["id"], json!(worktree_id));
    assert_eq!(shown["worktree"]["path"], json!(worktree_path));

    // Unknown id is a typed not_found, never a null row.
    assert_eq!(
        err_code(&engine, "worktree.get", "wg3", json!({"id": "nope"})),
        "not_found"
    );

    // worktree.current resolves a nested directory to the enclosing worktree.
    let nested = Path::new(&worktree_path).join("a/b");
    std::fs::create_dir_all(&nested).unwrap();
    let current = ok(
        &engine,
        "worktree.current",
        "wg4",
        json!({"path": nested.to_string_lossy()}),
    );
    assert_eq!(current["worktree"]["id"], json!(worktree_id));

    // The exact worktree root also resolves.
    let root = ok(
        &engine,
        "worktree.current",
        "wg5",
        json!({"path": worktree_path}),
    );
    assert_eq!(root["worktree"]["id"], json!(worktree_id));

    // A path no managed worktree encloses is a typed not_found, never a guess.
    let outside = tempfile::tempdir().unwrap();
    assert_eq!(
        err_code(
            &engine,
            "worktree.current",
            "wg6",
            json!({"path": outside.path().to_string_lossy()}),
        ),
        "not_found"
    );
}

#[test]
fn session_stop_workspace_sweeps_live_sessions_and_skips_exited() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let workspace = ok(
        &engine,
        "workspace.register",
        "ws-stop",
        json!({"path": data_dir.path().to_string_lossy()}),
    );
    let workspace_id = workspace["id"].as_str().unwrap().to_string();

    let mut session_ids = Vec::new();
    let mut incarnations = Vec::new();
    for i in 0..2 {
        let session = ok(
            &engine,
            "session.start",
            &format!("ss{i}"),
            json!({
                "workspaceId": workspace_id,
                "command": "/bin/sh",
                "args": ["-c", "sleep 30"],
                "cols": 80, "rows": 24
            }),
        );
        session_ids.push(session["id"].as_str().unwrap().to_string());
        incarnations.push(session["incarnation"].as_str().unwrap().to_string());
    }

    // Stop the second session directly so the sweep must skip its
    // already-exited handle (still durable, verdict exited).
    let stopped_row = ok(
        &engine,
        "session.stop",
        "sc1",
        json!({"sessionId": session_ids[1], "incarnation": incarnations[1]}),
    );
    assert_eq!(stopped_row["verdict"], "exited");

    let result = ok(
        &engine,
        "session.stop_workspace",
        "sweep1",
        json!({"workspaceId": workspace_id}),
    );
    // One live session (ss0) is signalled; the exited row is skipped.
    assert_eq!(result["stopped"], json!(1));

    // A repeat sweep finds no live sessions to stop.
    let again = ok(
        &engine,
        "session.stop_workspace",
        "sweep2",
        json!({"workspaceId": workspace_id}),
    );
    assert_eq!(again["stopped"], json!(0));

    // Sessions in another workspace are untouched.
    std::fs::create_dir_all(data_dir.path().join("other")).unwrap();
    let other_ws = ok(
        &engine,
        "workspace.register",
        "ws-other",
        json!({"path": data_dir.path().join("other").to_string_lossy()}),
    );
    let other_ws_id = other_ws["id"].as_str().unwrap().to_string();
    let other = ok(
        &engine,
        "session.start",
        "so1",
        json!({
            "workspaceId": other_ws_id,
            "command": "/bin/sh",
            "args": ["-c", "sleep 30"],
            "cols": 80, "rows": 24
        }),
    );
    let _ = other;
    let other_sweep = ok(
        &engine,
        "session.stop_workspace",
        "sweep3",
        json!({"workspaceId": workspace_id}),
    );
    assert_eq!(other_sweep["stopped"], json!(0));
}

#[test]
fn worktree_update_note_and_parent_roundtrip() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());

    let project = ok(
        &engine,
        "project.add",
        "pu1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap().to_string();
    let parent = ok(
        &engine,
        "worktree.create",
        "pu2",
        json!({"projectId": project_id, "name": "parent-wt"}),
    );
    let parent_id = parent["id"].as_str().unwrap().to_string();
    let child = ok(
        &engine,
        "worktree.create",
        "pu3",
        json!({"projectId": project_id, "name": "child-wt"}),
    );
    let child_id = child["id"].as_str().unwrap().to_string();

    // Set a note and a parent; the reply carries the updated row directly.
    let updated = ok(
        &engine,
        "worktree.update",
        "pu4",
        json!({"worktreeId": child_id, "note": "investigating", "parentWorktreeId": parent_id}),
    );
    assert_eq!(updated["id"], json!(child_id));
    assert_eq!(updated["note"], json!("investigating"));
    assert_eq!(updated["parentWorktreeId"], json!(parent_id));

    // Explicit null clears each field; absent leaves it unchanged.
    let cleared = ok(
        &engine,
        "worktree.update",
        "pu5",
        json!({"worktreeId": child_id, "note": null, "parentWorktreeId": null}),
    );
    assert_eq!(cleared["note"], Value::Null);
    assert_eq!(cleared["parentWorktreeId"], Value::Null);

    // A parent from another project is refused.
    let repo2 = tempfile::tempdir().unwrap();
    init_repo(repo2.path());
    let project2 = ok(
        &engine,
        "project.add",
        "pu6",
        json!({"path": repo2.path().to_string_lossy()}),
    );
    let other = ok(
        &engine,
        "worktree.create",
        "pu7",
        json!({"projectId": project2["id"], "name": "other-wt"}),
    );
    assert_eq!(
        err_code(
            &engine,
            "worktree.update",
            "pu8",
            json!({"worktreeId": child_id, "parentWorktreeId": other["id"]}),
        ),
        "invalid_argument"
    );
}

#[test]
fn session_show_returns_metadata_and_a_bounded_preview() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let workspace = ok(
        &engine,
        "workspace.register",
        "ws-show",
        json!({"path": data_dir.path().to_string_lossy()}),
    );
    let workspace_id = workspace["id"].as_str().unwrap().to_string();
    let session = ok(
        &engine,
        "session.start",
        "sh1",
        json!({
            "workspaceId": workspace_id,
            "command": "/bin/sh",
            "args": ["-c", "echo show-marker-42; sleep 30"],
            "cols": 80, "rows": 24
        }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();

    // Wait for the marker to land in the ring before showing.
    let deadline = Instant::now() + Duration::from_secs(10);
    let shown = loop {
        let shown = ok(
            &engine,
            "session.show",
            "sh2",
            json!({"sessionId": session_id}),
        );
        let preview = shown["previewBase64"].as_str().unwrap_or("");
        let decoded = base64_decode_test(preview);
        if decoded.contains("show-marker-42") {
            break shown;
        }
        assert!(Instant::now() < deadline, "preview never showed the marker");
        sleep(Duration::from_millis(50));
    };
    assert_eq!(shown["id"], json!(session_id));
    assert_eq!(shown["verdict"], json!("live"));

    // Unknown session is a typed not_found.
    assert_eq!(
        err_code(&engine, "session.show", "sh3", json!({"sessionId": "nope"})),
        "not_found"
    );

    // A closed session's row reports its honest verdict with a null preview
    // only when no handle remains; here close forgets the row entirely.
    let closed = ok(
        &engine,
        "session.close",
        "sh4",
        json!({"sessionId": session_id, "incarnation": session["incarnation"]}),
    );
    let _ = closed;
    assert_eq!(
        err_code(
            &engine,
            "session.show",
            "sh5",
            json!({"sessionId": session_id})
        ),
        "not_found"
    );
}

fn base64_decode_test(text: &str) -> String {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(text.as_bytes())
        .unwrap_or_default();
    String::from_utf8_lossy(&bytes).into_owned()
}

#[test]
fn worktree_ps_summarizes_live_session_counts_with_limit() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());

    let project = ok(
        &engine,
        "project.add",
        "ps1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap().to_string();
    let first = ok(
        &engine,
        "worktree.create",
        "ps2",
        json!({"projectId": project_id, "name": "ps-first"}),
    );
    let second = ok(
        &engine,
        "worktree.create",
        "ps3",
        json!({"projectId": project_id, "name": "ps-second"}),
    );
    let first_workspace = first["workspaceId"].as_str().unwrap().to_string();

    // One live session on the first worktree; none on the second.
    let session = ok(
        &engine,
        "session.start",
        "ps4",
        json!({
            "workspaceId": first_workspace,
            "command": "/bin/sh",
            "args": ["-c", "sleep 30"],
            "cols": 80, "rows": 24
        }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();

    let summary = ok(&engine, "worktree.ps", "ps5", json!({}));
    let worktrees = summary["worktrees"].as_array().unwrap();
    assert_eq!(worktrees.len(), 2);
    assert_eq!(summary["totalCount"], json!(2));
    assert_eq!(summary["truncated"], json!(false));
    let by_id: std::collections::HashMap<&str, &Value> = worktrees
        .iter()
        .map(|w| (w["worktreeId"].as_str().unwrap(), w))
        .collect();
    assert_eq!(
        by_id[first["id"].as_str().unwrap()]["liveSessions"],
        json!(1)
    );
    assert_eq!(
        by_id[second["id"].as_str().unwrap()]["liveSessions"],
        json!(0)
    );

    // The cap truncates honestly.
    let capped = ok(&engine, "worktree.ps", "ps6", json!({"limit": 1}));
    assert_eq!(capped["worktrees"].as_array().unwrap().len(), 1);
    assert_eq!(capped["totalCount"], json!(2));
    assert_eq!(capped["truncated"], json!(true));

    // A zero limit is a typed invalid argument, not silent clamping.
    assert_eq!(
        err_code(&engine, "worktree.ps", "ps7", json!({"limit": 0})),
        "invalid_argument"
    );

    // Stopping the session drops the count to zero.
    let _ = ok(
        &engine,
        "session.stop",
        "ps8",
        json!({"sessionId": session_id, "incarnation": session["incarnation"]}),
    );
    let after = ok(&engine, "worktree.ps", "ps9", json!({}));
    let by_id: std::collections::HashMap<&str, &Value> = after["worktrees"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| (w["worktreeId"].as_str().unwrap(), w))
        .collect();
    assert_eq!(
        by_id[first["id"].as_str().unwrap()]["liveSessions"],
        json!(0)
    );
}

#[test]
fn diagnostics_memory_reports_session_counts_honestly() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let workspace = ok(
        &engine,
        "workspace.register",
        "dm1",
        json!({"path": data_dir.path().to_string_lossy()}),
    );
    let session = ok(
        &engine,
        "session.start",
        "dm2",
        json!({
            "workspaceId": workspace["id"],
            "command": "/bin/sh",
            "args": ["-c", "sleep 30"],
            "cols": 80, "rows": 24
        }),
    );
    let report = ok(&engine, "diagnostics.memory", "dm3", json!({}));
    assert_eq!(report["process"], json!("drogond"));
    assert!(report["pid"].as_u64().is_some());
    assert_eq!(report["liveSessions"], json!(1));
    assert_eq!(report["totalSessions"], json!(1));
    // rssBytes is platform-scoped: a number on Linux, null elsewhere — never
    // a fabricated value.
    assert!(report["rssBytes"].is_u64() || report["rssBytes"].is_null());
    let _ = ok(
        &engine,
        "session.close",
        "dm4",
        json!({"sessionId": session["id"], "incarnation": session["incarnation"]}),
    );
    let after = ok(&engine, "diagnostics.memory", "dm5", json!({}));
    assert_eq!(after["liveSessions"], json!(0));
}

#[test]
fn session_rename_sets_and_clears_the_durable_title() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let workspace = ok(
        &engine,
        "workspace.register",
        "rn1",
        json!({"path": data_dir.path().to_string_lossy()}),
    );
    let session = ok(
        &engine,
        "session.start",
        "rn2",
        json!({
            "workspaceId": workspace["id"],
            "command": "/bin/sh",
            "args": ["-c", "sleep 30"],
            "cols": 80, "rows": 24
        }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();
    assert_eq!(session["title"], Value::Null);

    let renamed = ok(
        &engine,
        "session.rename",
        "rn3",
        json!({"sessionId": session_id, "incarnation": incarnation, "title": "deploy worker"}),
    );
    assert_eq!(renamed["title"], json!("deploy worker"));

    // The rename is visible on list and show for the live row.
    let listed = ok(
        &engine,
        "session.list",
        "rn4",
        json!({"workspaceId": workspace["id"]}),
    );
    let row = &listed["sessions"].as_array().unwrap()[0];
    assert_eq!(row["title"], json!("deploy worker"));
    let shown = ok(
        &engine,
        "session.show",
        "rn5",
        json!({"sessionId": session_id}),
    );
    assert_eq!(shown["title"], json!("deploy worker"));

    // A blank title clears; the row persists after engine reopen.
    let cleared = ok(
        &engine,
        "session.rename",
        "rn6",
        json!({"sessionId": session_id, "incarnation": incarnation, "title": "   "}),
    );
    assert_eq!(cleared["title"], Value::Null);

    let renamed = ok(
        &engine,
        "session.rename",
        "rn7",
        json!({"sessionId": session_id, "incarnation": incarnation, "title": "persisted"}),
    );
    assert_eq!(renamed["title"], json!("persisted"));
    drop(engine);
    let reopened = Engine::open(data_dir.path()).unwrap();
    let shown = ok(
        &reopened,
        "session.show",
        "rn8",
        json!({"sessionId": session_id}),
    );
    assert_eq!(shown["title"], json!("persisted"));

    // Wrong incarnation is fenced like every other mutation. After reopen
    // there is no retained handle, so the fence reads `unverifiable`; a live
    // handle would read `stale_incarnation`. Either way it is never applied.
    let fence = err_code(
        &reopened,
        "session.rename",
        "rn9",
        json!({"sessionId": session_id, "incarnation": "stale", "title": "x"}),
    );
    assert!(
        fence == "unverifiable" || fence == "stale_incarnation",
        "unexpected fence code: {fence}"
    );
}

#[test]
fn worktree_create_accepts_note_and_parent_and_validates_parent_project() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project = ok(
        &engine,
        "project.add",
        "cp1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let parent = ok(
        &engine,
        "worktree.create",
        "cp2",
        json!({"projectId": project["id"], "name": "parent"}),
    );
    let child = ok(
        &engine,
        "worktree.create",
        "cp3",
        json!({
            "projectId": project["id"],
            "name": "child",
            "parentWorktreeId": parent["id"],
            "note": "from the CLI"
        }),
    );
    assert_eq!(child["parentWorktreeId"], parent["id"]);
    assert_eq!(child["note"], json!("from the CLI"));

    // A parent from another project is refused at create time.
    let other_repo = tempfile::tempdir().unwrap();
    init_repo(other_repo.path());
    let other_project = ok(
        &engine,
        "project.add",
        "cp4",
        json!({"path": other_repo.path().to_string_lossy()}),
    );
    assert_eq!(
        err_code(
            &engine,
            "worktree.create",
            "cp5",
            json!({
                "projectId": other_project["id"],
                "name": "stray",
                "parentWorktreeId": parent["id"]
            }),
        ),
        "invalid_argument"
    );
}

/// Source worktree-remove-branch-deletion.test.ts: `deleteBranch` removes the
/// now-orphaned branch with the *safe* `git branch -d` — unmerged commits
/// keep the branch — and a branch with merged commits is deleted.
#[test]
fn worktree_remove_with_delete_branch_deletes_merged_and_keeps_unmerged() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project = ok(
        &engine,
        "project.add",
        "db1",
        json!({"path": repo.path().to_string_lossy()}),
    );

    // Merged branch: deleted after the worktree goes.
    let merged = ok(
        &engine,
        "worktree.create",
        "db2",
        json!({"projectId": project["id"], "name": "merged"}),
    );
    ok(
        &engine,
        "worktree.remove",
        "db3",
        json!({"id": merged["id"], "deleteBranch": true}),
    );
    let merged_gone = std::process::Command::new("git")
        .args(["-C"])
        .arg(repo.path())
        .args(["rev-parse", "--verify", "-q", "merged"])
        .output()
        .unwrap();
    assert!(
        !merged_gone.status.success(),
        "merged branch must be deleted"
    );

    // Unmerged branch: `branch -d` refuses and the branch survives.
    let unmerged = ok(
        &engine,
        "worktree.create",
        "db4",
        json!({"projectId": project["id"], "name": "unmerged"}),
    );
    let unmerged_path = unmerged["path"].as_str().unwrap().to_string();
    std::fs::write(format!("{unmerged_path}/work.txt"), "unmerged\n").unwrap();
    git(std::path::Path::new(&unmerged_path), &["add", "work.txt"]);
    git(
        std::path::Path::new(&unmerged_path),
        &["commit", "-q", "-m", "unmerged work"],
    );
    ok(
        &engine,
        "worktree.remove",
        "db5",
        json!({"id": unmerged["id"], "deleteBranch": true}),
    );
    let kept = std::process::Command::new("git")
        .args(["-C"])
        .arg(repo.path())
        .args(["rev-parse", "--verify", "-q", "unmerged"])
        .output()
        .unwrap();
    assert!(
        kept.status.success(),
        "unmerged branch must survive safe deletion"
    );
}

/// The removal itself succeeds even when the safe branch deletion refuses:
/// deleting the branch is best-effort after the worktree is gone.
#[test]
fn worktree_remove_without_delete_branch_keeps_the_branch() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project = ok(
        &engine,
        "project.add",
        "kb1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let created = ok(
        &engine,
        "worktree.create",
        "kb2",
        json!({"projectId": project["id"], "name": "kept"}),
    );
    ok(
        &engine,
        "worktree.remove",
        "kb3",
        json!({"id": created["id"]}),
    );
    let kept = std::process::Command::new("git")
        .args(["-C"])
        .arg(repo.path())
        .args(["rev-parse", "--verify", "-q", "kept"])
        .output()
        .unwrap();
    assert!(
        kept.status.success(),
        "the branch stays without deleteBranch"
    );
}

#[test]
fn worktree_update_title_roundtrip() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project = ok(
        &engine,
        "project.add",
        "ut1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let created = ok(
        &engine,
        "worktree.create",
        "ut2",
        json!({"projectId": project["id"], "name": "named"}),
    );
    let updated = ok(
        &engine,
        "worktree.update",
        "ut3",
        json!({"worktreeId": created["id"], "title": "display title"}),
    );
    assert_eq!(updated["title"], json!("display title"));
    // Tri-state: absent preserves, explicit null clears.
    let kept = ok(
        &engine,
        "worktree.update",
        "ut4",
        json!({"worktreeId": created["id"], "note": "keep the title"}),
    );
    assert_eq!(kept["title"], json!("display title"));
    let cleared = ok(
        &engine,
        "worktree.update",
        "ut5",
        json!({"worktreeId": created["id"], "title": null}),
    );
    assert_eq!(cleared["title"], Value::Null);
}

/// Source repo.searchRefs: substring ref search over branches/remotes/tags
/// with a default page of 25 (max 1000) and an honest truncated flag.
#[test]
fn repo_search_refs_filters_branches_and_reports_truncation() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    git(repo.path(), &["branch", "feat-alpha"]);
    git(repo.path(), &["branch", "feat-beta"]);
    git(repo.path(), &["branch", "chore-x"]);
    git(repo.path(), &["tag", "feat-v1"]);
    let project = ok(
        &engine,
        "project.add",
        "sr1",
        json!({"path": repo.path().to_string_lossy()}),
    );

    let result = ok(
        &engine,
        "repo.search_refs",
        "sr2",
        json!({"projectId": project["id"], "query": "feat"}),
    );
    let refs = result["refs"].as_array().unwrap();
    assert!(refs.contains(&json!("feat-alpha")), "refs: {refs:?}");
    assert!(refs.contains(&json!("feat-beta")));
    assert!(refs.contains(&json!("feat-v1")));
    assert!(!refs.contains(&json!("chore-x")));
    assert_eq!(result["truncated"], json!(false));

    // --limit caps the page and sets truncated when more refs matched.
    let result = ok(
        &engine,
        "repo.search_refs",
        "sr3",
        json!({"projectId": project["id"], "query": "feat", "limit": 2}),
    );
    assert_eq!(result["refs"].as_array().unwrap().len(), 2);
    assert_eq!(result["truncated"], json!(true));

    // Unknown project is typed not_found; zero limit is invalid.
    assert_eq!(
        err_code(
            &engine,
            "repo.search_refs",
            "sr4",
            json!({"projectId": "proj-nope", "query": "x"}),
        ),
        "not_found"
    );
    assert_eq!(
        err_code(
            &engine,
            "repo.search_refs",
            "sr5",
            json!({"projectId": project["id"], "query": "x", "limit": 0}),
        ),
        "invalid_argument"
    );
}

/// Source `printPreservedBranchWarning`: when the safe branch delete is
/// asked for but refuses (unmerged work), the removal still succeeds and
/// the reply names the preserved branch so the CLI can warn.
#[test]
fn worktree_remove_names_the_preserved_branch_for_the_warning() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project = ok(
        &engine,
        "project.add",
        "pb1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let created = ok(
        &engine,
        "worktree.create",
        "pb2",
        json!({"projectId": project["id"], "name": "preserved"}),
    );
    let path = created["path"].as_str().unwrap().to_string();
    std::fs::write(format!("{path}/work.txt"), "unmerged\n").unwrap();
    git(std::path::Path::new(&path), &["add", "work.txt"]);
    git(
        std::path::Path::new(&path),
        &["commit", "-q", "-m", "unmerged"],
    );
    let removed = ok(
        &engine,
        "worktree.remove",
        "pb3",
        json!({"id": created["id"], "deleteBranch": true}),
    );
    assert_eq!(removed["branchDeleted"], json!(false));
    assert_eq!(removed["branch"], json!("preserved"));
}

/// `runHooks` is accepted (source contract) but honestly a no-op: the
/// native runtime has no orca.yaml hook engine, so the reply carries a
/// warning the CLI surfaces instead of silently pretending to run hooks.
#[test]
fn worktree_remove_run_hooks_warns_instead_of_pretending() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project = ok(
        &engine,
        "project.add",
        "rh1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let created = ok(
        &engine,
        "worktree.create",
        "rh2",
        json!({"projectId": project["id"], "name": "hooked"}),
    );
    let plain = ok(
        &engine,
        "worktree.remove",
        "rh3",
        json!({"id": created["id"]}),
    );
    assert!(plain.get("warning").is_none());

    let created = ok(
        &engine,
        "worktree.create",
        "rh4",
        json!({"projectId": project["id"], "name": "hooked2"}),
    );
    let warned = ok(
        &engine,
        "worktree.remove",
        "rh5",
        json!({"id": created["id"], "runHooks": true}),
    );
    assert_eq!(warned["removed"], json!(true));
    assert_eq!(
        warned["warning"],
        json!("run-hooks is a no-op: this runtime has no orca.yaml hook engine")
    );
}

#[test]
fn worktree_create_run_hooks_warns_instead_of_pretending() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project = ok(
        &engine,
        "project.add",
        "ch1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let warned = ok(
        &engine,
        "worktree.create",
        "ch2",
        json!({"projectId": project["id"], "name": "hooked", "runHooks": true}),
    );
    assert!(warned["id"].is_string());
    assert_eq!(
        warned["warning"],
        json!("run-hooks is a no-op: this runtime has no orca.yaml hook engine")
    );
}

#[test]
fn worktree_create_and_update_roundtrip_the_linked_issue() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project = ok(
        &engine,
        "project.add",
        "li1",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let created = ok(
        &engine,
        "worktree.create",
        "li2",
        json!({"projectId": project["id"], "name": "linked", "linkedIssue": 42}),
    );
    assert_eq!(created["linkedIssue"], json!(42));

    // Tri-state update: absent preserves, a number sets, null clears.
    let kept = ok(
        &engine,
        "worktree.update",
        "li3",
        json!({"worktreeId": created["id"], "note": "keep the issue"}),
    );
    assert_eq!(kept["linkedIssue"], json!(42));
    let changed = ok(
        &engine,
        "worktree.update",
        "li4",
        json!({"worktreeId": created["id"], "linkedIssue": 7}),
    );
    assert_eq!(changed["linkedIssue"], json!(7));
    let cleared = ok(
        &engine,
        "worktree.update",
        "li5",
        json!({"worktreeId": created["id"], "linkedIssue": null}),
    );
    assert_eq!(cleared["linkedIssue"], Value::Null);

    // Non-positive numbers are refused on both verbs.
    assert_eq!(
        err_code(
            &engine,
            "worktree.create",
            "li6",
            json!({"projectId": project["id"], "name": "bad", "linkedIssue": 0}),
        ),
        "invalid_argument"
    );
    assert_eq!(
        err_code(
            &engine,
            "worktree.update",
            "li7",
            json!({"worktreeId": created["id"], "linkedIssue": -3}),
        ),
        "invalid_argument"
    );

    // Old rows survive the v4 migration with a NULL issue.
    drop(engine);
    let reopened = Engine::open(data_dir.path()).unwrap();
    let shown = ok(
        &reopened,
        "worktree.get",
        "li8",
        json!({"id": created["id"]}),
    );
    assert_eq!(shown["worktree"]["linkedIssue"], Value::Null);
}
