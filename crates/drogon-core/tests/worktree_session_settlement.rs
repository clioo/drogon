//! Issue #621: deleting a Workspace must settle the terminals running inside
//! it, never unlink their checkout from under them. Real `Engine`, real
//! SQLite, real temp git repositories and real PTY children — the bug was
//! invisible to anything that mocked the session layer, because
//! `worktree.remove` simply never asked.
#![cfg(unix)]

use std::path::Path;
use std::process::Command;
use std::sync::{Arc, mpsc};
use std::thread::sleep;
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
/// sleeps well past the end of the test.
fn start_live_session(engine: &Engine, workspace_id: &Value) -> Value {
    start_live_session_in(engine, workspace_id, None)
}

/// The same, with the explicit spawn directory `session.start` accepts —
/// the explorer's "Open in Terminal" passes one, and it may be any
/// directory inside the workspace root, not the root itself.
fn start_live_session_in(engine: &Engine, workspace_id: &Value, cwd: Option<&Path>) -> Value {
    let mut params = json!({
        "workspaceId": workspace_id,
        "command": "/bin/sh",
        "args": ["-c", "printf READY; sleep 120"],
        "cols": 80, "rows": 24
    });
    if let Some(cwd) = cwd {
        params["cwd"] = json!(cwd.to_string_lossy());
    }
    let session = ok(engine, "session.start", params);
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let read = ok(
            engine,
            "session.read",
            json!({"sessionId": session["id"], "incarnation": session["incarnation"], "cursor": 0}),
        );
        let bytes = {
            use base64::Engine as _;
            base64::engine::general_purpose::STANDARD
                .decode(read["dataBase64"].as_str().unwrap())
                .unwrap()
        };
        if String::from_utf8_lossy(&bytes).contains("READY") {
            return session;
        }
        assert!(
            Instant::now() < deadline,
            "the fixture session never reported READY"
        );
        sleep(Duration::from_millis(20));
    }
}

fn wait_for<F: FnMut() -> bool>(mut predicate: F, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if predicate() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        sleep(Duration::from_millis(20));
    }
}

fn session_output(engine: &Engine, session: &Value) -> String {
    let read = ok(
        engine,
        "session.read",
        json!({"sessionId": session["id"], "incarnation": session["incarnation"], "cursor": 0}),
    );
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(read["dataBase64"].as_str().unwrap())
        .unwrap();
    String::from_utf8_lossy(&bytes).into_owned()
}

fn write_line(engine: &Engine, session: &Value, line: &str) {
    use base64::Engine as _;
    let data = base64::engine::general_purpose::STANDARD.encode(format!("{line}\n"));
    ok(
        engine,
        "session.write",
        json!({"sessionId": session["id"], "incarnation": session["incarnation"], "dataBase64": data}),
    );
}

/// Single-quote for `/bin/sh`: the temp paths these tests build are tame,
/// but a workspace path with a space is the normal case on macOS.
fn shell_quote(raw: &str) -> String {
    format!("'{}'", raw.replace('\'', "'\\''"))
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

/// Teardown for a session a test deliberately left running: the engine owns
/// the PTY, so its stop is the one that can confirm the child is reaped.
fn settle(engine: &Engine, session: &Value) {
    let stopped = ok(
        engine,
        "session.stop",
        json!({"sessionId": session["id"], "incarnation": session["incarnation"]}),
    );
    assert_eq!(
        stopped["verdict"], "exited",
        "test-owned PTY must be confirmed reaped before the test ends"
    );
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
fn unforced_remove_refuses_a_workspace_whose_terminal_is_live() {
    let fx = git_project();
    let wt = worktree(&fx, "busy");
    let path = wt["path"].as_str().unwrap().to_string();
    let session = start_live_session(&fx.engine, &wt["workspaceId"]);

    let refusal = err(&fx.engine, "worktree.remove", json!({"id": wt["id"]}));
    assert_eq!(refusal.code, "session_live");
    assert!(
        refusal.message.contains("still live:"),
        "the desktop toast keys its proven-live copy on this marker: {}",
        refusal.message
    );
    assert!(
        refusal.message.contains(session["id"].as_str().unwrap()),
        "the refusal names which terminal blocked it: {}",
        refusal.message
    );

    assert!(
        Path::new(&path).is_dir(),
        "a refused remove must not touch the checkout"
    );
    assert_eq!(
        verdict(&fx.engine, &session),
        "live",
        "a refused remove must not disturb the session either"
    );
    let listed = ok(
        &fx.engine,
        "worktree.list",
        json!({"projectId": fx.project_id}),
    );
    assert_eq!(
        listed["worktrees"].as_array().unwrap().len(),
        1,
        "the registration survives a refusal"
    );

    settle(&fx.engine, &session);
}

#[test]
fn forced_remove_settles_the_terminal_before_unlinking_the_checkout() {
    let fx = git_project();
    let wt = worktree(&fx, "busy");
    let path = wt["path"].as_str().unwrap().to_string();
    let session = start_live_session(&fx.engine, &wt["workspaceId"]);

    let removed = ok(
        &fx.engine,
        "worktree.remove",
        json!({"id": wt["id"], "force": true}),
    );
    assert_eq!(removed["removed"], json!(true));
    assert_eq!(
        verdict(&fx.engine, &session),
        "exited",
        "force must settle the PTY, not orphan it"
    );
    assert!(
        !Path::new(&path).exists(),
        "force still removes the checkout once the terminals are settled"
    );
}

#[test]
fn a_terminal_in_one_workspace_never_blocks_deleting_its_sibling() {
    let fx = git_project();
    let busy = worktree(&fx, "busy");
    let idle = worktree(&fx, "idle");
    let idle_path = idle["path"].as_str().unwrap().to_string();
    let session = start_live_session(&fx.engine, &busy["workspaceId"]);

    ok(&fx.engine, "worktree.remove", json!({"id": idle["id"]}));
    assert!(!Path::new(&idle_path).exists());
    assert_eq!(
        verdict(&fx.engine, &session),
        "live",
        "deleting a sibling must not reach into this workspace's terminals"
    );

    settle(&fx.engine, &session);
}

#[test]
fn an_exited_terminal_does_not_block_a_plain_remove() {
    let fx = git_project();
    let wt = worktree(&fx, "done");
    let path = wt["path"].as_str().unwrap().to_string();
    let session = start_live_session(&fx.engine, &wt["workspaceId"]);
    settle(&fx.engine, &session);

    ok(&fx.engine, "worktree.remove", json!({"id": wt["id"]}));
    assert!(!Path::new(&path).exists());
}

/// A record left by a prior daemon instance: no handle here can act on it,
/// so no signal from here can settle it. Loss of contact is not evidence of
/// exit, so neither an unforced nor a forced remove may delete its files.
fn insert_prior_instance_session(data_dir: &Path, workspace_id: &str, session_id: &str) {
    let conn = rusqlite::Connection::open(data_dir.join("drogon.sqlite3")).unwrap();
    conn.execute(
        "INSERT INTO sessions (id, workspace_id, host_id, incarnation, command, args_json, cols, rows, verdict, created_at)
         VALUES (?1, ?2, 'host-prior', 'inc-prior', '/bin/sh', '[]', 80, 24, 'unverifiable', '2026-09-19T00:00:00Z')",
        rusqlite::params![session_id, workspace_id],
    )
    .unwrap();
}

#[test]
fn an_unverifiable_record_refuses_with_or_without_force() {
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
    let wt = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "ghosted"}),
    );
    let path = wt["path"].as_str().unwrap().to_string();
    insert_prior_instance_session(
        data.path(),
        wt["workspaceId"].as_str().unwrap(),
        "ses_ghost",
    );

    let refusal = err(&engine, "worktree.remove", json!({"id": wt["id"]}));
    assert_eq!(refusal.code, "session_unverifiable");
    assert!(
        refusal.message.contains("could not confirm every terminal"),
        "the desktop toast keys its could-not-confirm copy on this marker: {}",
        refusal.message
    );
    assert!(
        !refusal.message.contains("still live:"),
        "loss of contact must never render as proven life: {}",
        refusal.message
    );
    assert!(Path::new(&path).is_dir(), "a refusal deletes nothing");

    // Force stops terminals; it cannot conjure evidence about one this
    // process never held. `project.remove` refuses the same case, and
    // deleting the files anyway is the harm #621 is about.
    let forced = err(
        &engine,
        "worktree.remove",
        json!({"id": wt["id"], "force": true}),
    );
    assert_eq!(forced.code, "session_unverifiable");
    assert!(
        Path::new(&path).is_dir(),
        "force must not delete files out from under a session whose exit is unknown"
    );

    // Closing the record is the honest way out: it is the caller saying the
    // process is gone, and only then does the delete proceed.
    ok(
        &engine,
        "session.close",
        json!({"sessionId": "ses_ghost", "incarnation": "inc-prior"}),
    );
    ok(&engine, "worktree.remove", json!({"id": wt["id"]}));
    assert!(!Path::new(&path).exists());
}

/// A refused delete leaves the record it refused over exactly where it was:
/// a row whose process may still be running is the honest trace of it, and
/// forgetting it is the one thing the session owner must never do.
#[test]
fn a_refused_remove_keeps_the_record_it_refused_over() {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project = ok(
        &engine,
        "project.add",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let wt = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project["id"], "name": "ghosted"}),
    );
    insert_prior_instance_session(
        data.path(),
        wt["workspaceId"].as_str().unwrap(),
        "ses_ghost",
    );
    err(
        &engine,
        "worktree.remove",
        json!({"id": wt["id"], "force": true}),
    );

    let conn = rusqlite::Connection::open(data.path().join("drogon.sqlite3")).unwrap();
    let verdict: String = conn
        .query_row(
            "SELECT verdict FROM sessions WHERE id = 'ses_ghost'",
            [],
            |r| r.get(0),
        )
        .expect("the unsettled session's record must survive a refused delete");
    assert_eq!(verdict, "unverifiable");
}

/// A folder Workspace section removes no files, but dropping its
/// registration still orphans the terminals running in it — the card
/// vanishes while the PTY keeps going. Same gate, same copy.
#[test]
fn a_folder_section_with_a_live_terminal_refuses_too() {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let folder = tempfile::tempdir().unwrap();
    let project = ok(
        &engine,
        "project.add",
        json!({"path": folder.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap().to_string();
    assert_eq!(
        project["kind"], "folder",
        "a plain directory is a folder project"
    );
    let section = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "section"}),
    );
    let session = start_live_session(&engine, &section["workspaceId"]);

    let refusal = err(&engine, "worktree.remove", json!({"id": section["id"]}));
    assert_eq!(refusal.code, "session_live");
    let listed = ok(&engine, "worktree.list", json!({"projectId": project_id}));
    assert_eq!(
        listed["worktrees"].as_array().unwrap().len(),
        2,
        "the section is still registered after a refusal"
    );

    let removed = ok(
        &engine,
        "worktree.remove",
        json!({"id": section["id"], "force": true}),
    );
    assert_eq!(removed["removed"], json!(true));
    assert_eq!(
        verdict(&engine, &session),
        "exited",
        "force settles a folder section's terminals too"
    );
    assert!(
        folder.path().exists(),
        "a folder section still deletes no files"
    );
}

/// A checkout takes every Workspace registered inside it when it goes.
/// `refuse_nested_registrations` guards the ones with a `worktrees` or
/// `projects` row; a plain `workspace.register` has neither, so its
/// terminals are only safe if the session scope reaches them. The first cut
/// of this fix scoped the evidence to the removed worktree's own workspace
/// id, and a live PTY in `<checkout>/sub` kept running while its directory
/// was unlinked under it — the original bug wearing a different hat.
#[test]
fn a_live_terminal_in_a_nested_workspace_blocks_the_delete_too() {
    let fx = git_project();
    let outer = worktree(&fx, "outer");
    let outer_path = outer["path"].as_str().unwrap().to_string();
    let nested_dir = Path::new(&outer_path).join("sub");
    std::fs::create_dir(&nested_dir).unwrap();
    let nested = ok(
        &fx.engine,
        "workspace.register",
        json!({"path": nested_dir.to_string_lossy()}),
    );
    let session = start_live_session(&fx.engine, &nested["id"]);

    let refusal = err(&fx.engine, "worktree.remove", json!({"id": outer["id"]}));
    assert_eq!(refusal.code, "session_live");
    assert!(
        refusal.message.contains(session["id"].as_str().unwrap()),
        "the refusal names the nested terminal: {}",
        refusal.message
    );
    assert!(
        Path::new(&outer_path).is_dir(),
        "the checkout holding a live nested terminal must survive"
    );
    assert_eq!(verdict(&fx.engine, &session), "live");

    // Force settles the nested terminal before the directory goes, instead
    // of unlinking it out from under a running PTY.
    ok(
        &fx.engine,
        "worktree.remove",
        json!({"id": outer["id"], "force": true}),
    );
    assert_eq!(
        verdict(&fx.engine, &session),
        "exited",
        "the nested terminal must be settled, not orphaned"
    );
    assert!(!Path::new(&outer_path).exists());
}

/// A nested *registration* (issue #623) refuses the delete outright. That
/// refusal has to come first: stopping an agent's terminal and then
/// declining to delete anything would cost the work for nothing.
#[test]
fn a_delete_that_will_refuse_anyway_stops_nobody_first() {
    let fx = git_project();
    let outer = worktree(&fx, "outer");
    let nested_dir = Path::new(outer["path"].as_str().unwrap()).join("sub");
    std::fs::create_dir(&nested_dir).unwrap();
    ok(
        &fx.engine,
        "project.add",
        json!({"path": nested_dir.to_string_lossy()}),
    );
    let session = start_live_session(&fx.engine, &outer["workspaceId"]);

    let refusal = err(
        &fx.engine,
        "worktree.remove",
        json!({"id": outer["id"], "force": true}),
    );
    assert_eq!(
        refusal.code, "invalid_argument",
        "the nested registration refuses the delete: {}",
        refusal.message
    );
    assert_eq!(
        verdict(&fx.engine, &session),
        "live",
        "a refused delete must not have killed the terminal on its way out"
    );

    settle(&fx.engine, &session);
}

/// Scope is containment, not string prefix, and not "every workspace".
#[test]
fn a_sibling_checkout_with_a_similar_name_is_out_of_scope() {
    let fx = git_project();
    let target = worktree(&fx, "feature");
    let sibling = worktree(&fx, "feature-2");
    let session = start_live_session(&fx.engine, &sibling["workspaceId"]);

    ok(&fx.engine, "worktree.remove", json!({"id": target["id"]}));
    assert!(!Path::new(target["path"].as_str().unwrap()).exists());
    assert!(Path::new(sibling["path"].as_str().unwrap()).is_dir());
    assert_eq!(verdict(&fx.engine, &session), "live");

    settle(&fx.engine, &session);
}

/// Registers a Workspace row verbatim, the way a legacy or foreign writer
/// would: no canonicalization, so its spelling need not match the one
/// `std::fs::canonicalize` produces. Every current writer canonicalizes,
/// which is exactly why a scope that only compares canonical spellings
/// looked correct while dropping rows like this one.
fn insert_workspace_row(data_dir: &Path, id: &str, path: &Path) {
    let conn = rusqlite::Connection::open(data_dir.join("drogon.sqlite3")).unwrap();
    conn.execute(
        "INSERT INTO workspaces (id, path, name, kind, host_id, created_at)
         VALUES (?1, ?2, 'legacy', 'folder', (SELECT host_id FROM workspaces LIMIT 1), '2026-09-19T00:00:00Z')",
        rusqlite::params![id, path.to_string_lossy()],
    )
    .unwrap();
}

/// The directory a workspace row names can be gone while its terminal runs
/// on — a PTY keeps its deleted cwd. Placing that row still has to work, or
/// the delete stops seeing it and unlinks the checkout out from under the
/// PTY: `removed: true`, verdict still `live`. Found by the adversarial pass
/// on the first scope fix.
#[test]
fn a_live_terminal_under_a_vanished_directory_still_blocks_the_delete() {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project = ok(
        &engine,
        "project.add",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let wt = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project["id"], "name": "outer"}),
    );
    let outer = std::fs::canonicalize(wt["path"].as_str().unwrap()).unwrap();

    // A second spelling of the same checkout, as a symlinked parent or an
    // uncanonicalized legacy row would produce.
    let alias = outer.parent().unwrap().join("alias");
    std::os::unix::fs::symlink(&outer, &alias).unwrap();
    let nested = alias.join("sub");
    std::fs::create_dir(outer.join("sub")).unwrap();
    insert_workspace_row(data.path(), "ws_legacy", &nested);
    let session = start_live_session(&engine, &json!("ws_legacy"));

    // The terminal outlives its directory.
    std::fs::remove_dir_all(outer.join("sub")).unwrap();
    assert_eq!(verdict(&engine, &session), "live");

    let refusal = err(&engine, "worktree.remove", json!({"id": wt["id"]}));
    assert_eq!(refusal.code, "session_live");
    assert!(outer.is_dir(), "a refused remove deletes nothing");

    // And force settles that terminal rather than unlinking the checkout
    // around it, which is what a scope blind to this row did.
    ok(
        &engine,
        "worktree.remove",
        json!({"id": wt["id"], "force": true}),
    );
    assert_eq!(
        verdict(&engine, &session),
        "exited",
        "the terminal under the vanished directory must be settled"
    );
    assert!(!outer.exists());
}

/// A folder Project's implicit card has no `worktrees` row, so
/// `worktree.remove` hands it to `project.remove` — which takes the same
/// exclusive workspace admission gate this call needs. Taking that gate
/// before the hand-off deadlocks the daemon on itself, with the gate held,
/// which would also wedge every `session.start` behind it. The delete must
/// simply complete.
#[test]
fn removing_a_folder_projects_implicit_card_does_not_deadlock() {
    let data = tempfile::tempdir().unwrap();
    let folder = tempfile::tempdir().unwrap();
    let engine = Arc::new(Engine::open(data.path()).unwrap());
    let project = ok(
        &engine,
        "project.add",
        json!({"path": folder.path().to_string_lossy()}),
    );
    let implicit_id = project["id"].as_str().unwrap().to_string();

    let worker = engine.clone();
    let (done_tx, done_rx) = mpsc::channel();
    let thread = std::thread::spawn(move || {
        let reply = call(&worker, "worktree.remove", json!({"id": implicit_id}));
        done_tx.send(reply.ok).unwrap();
    });
    assert_eq!(
        done_rx.recv_timeout(Duration::from_secs(10)),
        Ok(true),
        "the implicit-card delete must finish instead of deadlocking on the gate"
    );
    thread.join().unwrap();

    // And a session can still be admitted afterwards: the gate was released.
    let workspace = ok(
        &engine,
        "workspace.register",
        json!({"path": folder.path().to_string_lossy()}),
    );
    let session = start_live_session(&engine, &workspace["id"]);
    settle(&engine, &session);
}

/// A Chat's card has no `worktrees` row either, so `worktree.remove` hands
/// it to `project.remove`, which deletes the scratch directory. Matching
/// that one path exactly left a session in a registered subdirectory running
/// while its files went — the same orphan, reached the other way round.
#[test]
fn deleting_a_chat_settles_the_terminals_in_its_subdirectories() {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let chat = ok(&engine, "project.quickSessionCreate", json!({}));
    let scratch = chat["project"]["path"].as_str().unwrap().to_string();
    let nested_dir = Path::new(&scratch).join("sub");
    std::fs::create_dir(&nested_dir).unwrap();
    let nested = ok(
        &engine,
        "workspace.register",
        json!({"path": nested_dir.to_string_lossy()}),
    );
    let session = start_live_session(&engine, &nested["id"]);

    ok(
        &engine,
        "worktree.remove",
        json!({"id": chat["project"]["id"]}),
    );
    assert_eq!(
        verdict(&engine, &session),
        "exited",
        "the nested terminal must be settled, not left running over deleted files"
    );
    assert!(!Path::new(&scratch).exists());
}

/// The narrow half of the scope rule. A folder section shares its path with
/// the Project and with every sibling section, and removing one deletes no
/// files — so it must answer for its own row and nobody else's, or deleting
/// one card would stop the terminals in another.
#[test]
fn removing_one_folder_section_leaves_a_siblings_terminal_alone() {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let folder = tempfile::tempdir().unwrap();
    let project = ok(
        &engine,
        "project.add",
        json!({"path": folder.path().to_string_lossy()}),
    );
    let project_id = project["id"].as_str().unwrap().to_string();
    let going = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "going"}),
    );
    let staying = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project_id, "name": "staying"}),
    );
    let session = start_live_session(&engine, &staying["workspaceId"]);

    ok(&engine, "worktree.remove", json!({"id": going["id"]}));
    assert_eq!(
        verdict(&engine, &session),
        "live",
        "another section's terminal is not this delete's to stop"
    );
    let listed = ok(&engine, "worktree.list", json!({"projectId": project_id}));
    assert_eq!(listed["worktrees"].as_array().unwrap().len(), 2);
    assert!(folder.path().exists());

    settle(&engine, &session);
}

/// The owning Workspace does not say where a terminal actually sits:
/// `session.start` takes an explicit `cwd` anywhere inside its workspace
/// root. A workspace registered above the checkouts, with a terminal opened
/// into one of them, kept that PTY running while the checkout was unlinked
/// under it — `removed: true`, verdict still `live`. Found by the
/// adversarial pass on #621.
#[test]
fn a_terminal_standing_in_the_checkout_blocks_the_delete_whoever_owns_it() {
    let fx = git_project();
    let victim = worktree(&fx, "victim");
    let victim_path = std::fs::canonicalize(victim["path"].as_str().unwrap()).unwrap();
    // A Workspace registered at the directory the checkouts live under, so
    // the session's own workspace is not the one being deleted.
    let parent = ok(
        &fx.engine,
        "workspace.register",
        json!({"path": victim_path.parent().unwrap().to_string_lossy()}),
    );
    let session = start_live_session_in(&fx.engine, &parent["id"], Some(&victim_path));

    let refusal = err(&fx.engine, "worktree.remove", json!({"id": victim["id"]}));
    assert_eq!(refusal.code, "session_live");
    assert!(victim_path.is_dir(), "a refused remove deletes nothing");
    assert_eq!(verdict(&fx.engine, &session), "live");

    ok(
        &fx.engine,
        "worktree.remove",
        json!({"id": victim["id"], "force": true}),
    );
    assert_eq!(
        verdict(&fx.engine, &session),
        "exited",
        "the terminal standing in the checkout must be settled, not orphaned"
    );
    assert!(!victim_path.exists());
}

/// The other half: a terminal in that same parent workspace which is *not*
/// standing in the checkout is none of this delete's business.
#[test]
fn a_terminal_beside_the_checkout_is_left_alone() {
    let fx = git_project();
    let victim = worktree(&fx, "victim");
    let victim_path = std::fs::canonicalize(victim["path"].as_str().unwrap()).unwrap();
    let home = victim_path.parent().unwrap().to_path_buf();
    let beside = home.join("beside");
    std::fs::create_dir(&beside).unwrap();
    let parent = ok(
        &fx.engine,
        "workspace.register",
        json!({"path": home.to_string_lossy()}),
    );
    let session = start_live_session_in(&fx.engine, &parent["id"], Some(&beside));

    ok(&fx.engine, "worktree.remove", json!({"id": victim["id"]}));
    assert_eq!(
        verdict(&fx.engine, &session),
        "live",
        "a terminal outside the deleted directory is not this delete's to stop"
    );
    assert!(!victim_path.exists());

    settle(&fx.engine, &session);
}

/// The registration half of the scope, on its own. A prior-instance row in
/// a nested Workspace has no handle, so no spawn directory places it — only
/// its workspace id does. Without the containment expansion over
/// `workspaces`, this row is invisible and the checkout goes while a
/// process that may still hold it is unaccounted for.
#[test]
fn an_unverifiable_record_in_a_nested_workspace_blocks_the_delete() {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let repo = tempfile::tempdir().unwrap();
    init_repo(repo.path());
    let project = ok(
        &engine,
        "project.add",
        json!({"path": repo.path().to_string_lossy()}),
    );
    let wt = ok(
        &engine,
        "worktree.create",
        json!({"projectId": project["id"], "name": "outer"}),
    );
    let outer = wt["path"].as_str().unwrap().to_string();
    let nested_dir = Path::new(&outer).join("sub");
    std::fs::create_dir(&nested_dir).unwrap();
    let nested = ok(
        &engine,
        "workspace.register",
        json!({"path": nested_dir.to_string_lossy()}),
    );
    insert_prior_instance_session(
        data.path(),
        nested["id"].as_str().unwrap(),
        "ses_nested_ghost",
    );

    for force in [false, true] {
        let refusal = err(
            &engine,
            "worktree.remove",
            json!({"id": wt["id"], "force": force}),
        );
        assert_eq!(
            refusal.code, "session_unverifiable",
            "force={force}: a nested record nobody can settle must refuse"
        );
        assert!(
            refusal.message.contains("ses_nested_ghost"),
            "the refusal names it: {}",
            refusal.message
        );
        assert!(Path::new(&outer).is_dir(), "force={force} deleted anyway");
    }
}

/// A terminal can walk into a checkout after it starts: the recorded spawn
/// directory says where it began, not where it is. A shell driven with `cd`
/// into the checkout kept running while the directory was unlinked under
/// it — `removed: true`, verdict still `live`. Found by the adversarial
/// pass on #621.
///
/// Platform-gated because the answer comes from the OS (`lsof` on macOS,
/// `/proc` on Linux); elsewhere the recorded directory is all there is, and
/// the module documents that limit rather than pretending otherwise.
#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn a_terminal_that_walked_into_the_checkout_blocks_the_delete() {
    let fx = git_project();
    let victim = worktree(&fx, "victim");
    let victim_path = std::fs::canonicalize(victim["path"].as_str().unwrap()).unwrap();
    let elsewhere = worktree(&fx, "elsewhere");
    // A real shell reading its PTY, not the one-shot fixture: this test
    // needs a terminal that can be driven somewhere else.
    let session = ok(
        &fx.engine,
        "session.start",
        json!({
            "workspaceId": elsewhere["workspaceId"],
            "command": "/bin/sh",
            "cwd": elsewhere["path"],
            "cols": 80, "rows": 24
        }),
    );

    // Drive the shell into the victim checkout and wait until it says so.
    // The marker is split in the command and whole in the output, so the
    // terminal's echo of the line cannot be mistaken for its result — that
    // race let this test pass while the shell was still where it started.
    write_line(
        &fx.engine,
        &session,
        &format!(
            "cd {} && printf 'ARRI''VED'",
            shell_quote(&victim_path.to_string_lossy())
        ),
    );
    assert!(
        wait_for(
            || session_output(&fx.engine, &session).contains("ARRIVED"),
            Duration::from_secs(10)
        ),
        "the shell never reported arriving in the checkout"
    );

    let refusal = err(&fx.engine, "worktree.remove", json!({"id": victim["id"]}));
    assert_eq!(
        refusal.code, "session_live",
        "a terminal standing in the checkout must block it: {}",
        refusal.message
    );
    assert!(victim_path.is_dir());
    assert_eq!(verdict(&fx.engine, &session), "live");

    settle(&fx.engine, &session);
}
