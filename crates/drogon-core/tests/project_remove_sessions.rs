//! Regression for the audit's P1: `project.remove` must not strand live
//! sessions.
//!
//! Removing a Project deletes its Workspaces' rows. Live PTYs used to keep
//! running with a `workspace_id` no longer in `workspaces`, where no
//! per-workspace list could find them — and `runtime.shutdown` then refused
//! every restart because those rows were still not `exited`. The removal now
//! answers for those terminals through the same evidence rule
//! `worktree.remove` uses (#621): unforced, a live session refuses the
//! delete and names itself; forced, it is stopped and its row settles
//! `exited`.
//!
//! Real `Engine`, real SQLite, real temp git repositories, real PTY children.

#![cfg(unix)]

use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

fn call(engine: &Engine, method: &str, params: Value) -> Response {
    let request: Request = serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": uuid::Uuid::new_v4().to_string(),
        "method": method,
        "params": params,
    }))
    .unwrap();
    engine.dispatch(request)
}

fn ok(engine: &Engine, method: &str, params: Value) -> Value {
    let response = call(engine, method, params);
    assert!(
        response.ok,
        "expected ok for {method}: {:?}",
        response.error
    );
    response.result.unwrap()
}

fn err(engine: &Engine, method: &str, params: Value) -> drogon_protocol::RpcError {
    let response = call(engine, method, params);
    assert!(
        !response.ok,
        "expected an error for {method}, got {:?}",
        response.result
    );
    response.error.unwrap()
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

/// A session whose PTY is unmistakably alive: it announces itself, then
/// sleeps past the end of the test.
fn start_live_session(engine: &Engine, workspace_id: &Value) -> Value {
    let session = ok(
        engine,
        "session.start",
        json!({
            "workspaceId": workspace_id,
            "command": "/bin/sh",
            "args": ["-c", "printf READY; sleep 120"],
            "cols": 80, "rows": 24
        }),
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let read = ok(
            engine,
            "session.read",
            json!({"sessionId": session["id"], "incarnation": session["incarnation"], "cursor": 0}),
        );
        use base64::Engine as _;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(read["dataBase64"].as_str().unwrap())
            .unwrap();
        if String::from_utf8_lossy(&bytes).contains("READY") {
            return session;
        }
        assert!(
            Instant::now() < deadline,
            "the fixture session never reported READY"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn verdict(engine: &Engine, session: &Value) -> String {
    ok(
        engine,
        "session.read",
        json!({"sessionId": session["id"], "incarnation": session["incarnation"], "cursor": 0}),
    )["session"]["verdict"]
        .as_str()
        .unwrap()
        .to_string()
}

fn settle(engine: &Engine, session: &Value) {
    let stopped = ok(
        engine,
        "session.stop",
        json!({"sessionId": session["id"], "incarnation": session["incarnation"]}),
    );
    assert_eq!(stopped["verdict"], "exited");
}

fn project_ids(engine: &Engine) -> Vec<String> {
    ok(engine, "project.list", json!({}))["projects"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["id"].as_str().unwrap().to_string())
        .collect()
}

fn worktree_ids(engine: &Engine, project_id: &str) -> Vec<String> {
    ok(engine, "worktree.list", json!({"projectId": project_id}))["worktrees"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["id"].as_str().unwrap().to_string())
        .collect()
}
struct GitProject {
    _data: tempfile::TempDir,
    _repo: tempfile::TempDir,
    engine: Engine,
    project_id: String,
}

fn git_project() -> GitProject {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project = ok(
        &engine,
        "project.add",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap().to_string();
    GitProject {
        _data: data,
        _repo: repo,
        engine,
        project_id,
    }
}

fn worktree(fx: &GitProject, name: &str) -> Value {
    ok(
        &fx.engine,
        "worktree.create",
        json!({"projectId": fx.project_id, "name": name}),
    )
}

#[test]
fn an_unforced_remove_refuses_while_a_project_terminal_is_live() {
    let fx = git_project();
    let first = worktree(&fx, "alpha");
    let second = worktree(&fx, "beta");
    let first_session = start_live_session(&fx.engine, &first["workspaceId"]);
    let second_session = start_live_session(&fx.engine, &second["workspaceId"]);

    let refusal = err(&fx.engine, "project.remove", json!({"id": fx.project_id}));
    assert_eq!(refusal.code, "session_live", "{}", refusal.message);
    assert!(
        refusal.message.contains("still live:"),
        "the desktop keys its proven-live copy on this marker: {}",
        refusal.message
    );
    for session in [&first_session, &second_session] {
        assert!(
            refusal.message.contains(session["id"].as_str().unwrap()),
            "the refusal names every blocking terminal: {}",
            refusal.message
        );
    }

    // A refusal that was always going to happen must not have cost an agent
    // its terminal, nor touched the registration.
    assert_eq!(verdict(&fx.engine, &first_session), "live");
    assert_eq!(verdict(&fx.engine, &second_session), "live");
    assert!(
        project_ids(&fx.engine).contains(&fx.project_id),
        "the refused project stays registered"
    );
    assert_eq!(worktree_ids(&fx.engine, &fx.project_id).len(), 2);

    settle(&fx.engine, &first_session);
    settle(&fx.engine, &second_session);
}

#[test]
fn a_forced_remove_stops_every_terminal_and_settles_their_rows_exited() {
    let fx = git_project();
    let first = worktree(&fx, "alpha");
    let second = worktree(&fx, "beta");
    let first_session = start_live_session(&fx.engine, &first["workspaceId"]);
    let second_session = start_live_session(&fx.engine, &second["workspaceId"]);

    let removed = ok(
        &fx.engine,
        "project.remove",
        json!({"id": fx.project_id, "force": true}),
    );
    assert_eq!(removed["removed"], true);
    assert!(
        project_ids(&fx.engine).is_empty(),
        "the project is unregistered"
    );
    // The workspace rows this removal deleted are gone from the host-wide
    // list — the stranding bug was a session pointing at one of these ids
    // after the row had been deleted underneath it.
    let remaining_workspaces = ok(&fx.engine, "workspace.list", json!({}))["workspaces"]
        .as_array()
        .unwrap()
        .clone();
    for removed in [&first, &second] {
        assert!(
            remaining_workspaces
                .iter()
                .all(|entry| entry["id"] != removed["workspaceId"]),
            "the worktree's workspace row is gone: {remaining_workspaces:?}"
        );
    }
    assert_eq!(
        call(
            &fx.engine,
            "worktree.list",
            json!({ "projectId": fx.project_id })
        )
        .error
        .map(|error| error.code)
        .as_deref(),
        Some("not_found"),
        "no worktree row survives its project registration"
    );

    // The rows stay as history, settled by observation — never a silently
    // stranded `live` row with no workspace.
    for session in [&first_session, &second_session] {
        assert_eq!(
            verdict(&fx.engine, session),
            "exited",
            "a forced removal stops the terminal it removes"
        );
    }
    let host_wide = ok(&fx.engine, "session.list", json!({}))["sessions"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(host_wide.len(), 2);
    assert!(
        host_wide
            .iter()
            .all(|session| session["verdict"] == "exited"),
        "no record is left claiming to be live: {host_wide:?}"
    );
}

#[test]
fn a_folder_project_refuses_a_live_terminal_and_keeps_its_folder_on_force() {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let folder = tempfile::tempdir().unwrap();
    let project = ok(
        &engine,
        "project.add",
        json!({"path": folder.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap().to_string();
    let workspace_id = ok(&engine, "workspace.list", json!({}))["workspaces"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| {
            entry["path"]
                == json!(
                    std::fs::canonicalize(folder.path())
                        .unwrap()
                        .to_string_lossy()
                )
        })
        .map(|entry| entry["id"].clone())
        .expect("the folder project's implicit workspace");
    let session = start_live_session(&engine, &workspace_id);

    let refusal = err(&engine, "project.remove", json!({"id": project_id}));
    assert_eq!(refusal.code, "session_live", "{}", refusal.message);
    assert_eq!(verdict(&engine, &session), "live");

    let removed = ok(
        &engine,
        "project.remove",
        json!({"id": project_id, "force": true}),
    );
    assert_eq!(removed["removed"], true);
    assert_eq!(verdict(&engine, &session), "exited");
    assert!(
        folder.path().is_dir(),
        "a registration-only removal never deletes the owner's folder"
    );
}
