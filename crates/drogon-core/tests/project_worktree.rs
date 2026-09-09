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
