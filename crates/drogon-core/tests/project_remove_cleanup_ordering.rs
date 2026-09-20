//! `project.remove` deletes the app-owned files before the rows (#623): an
//! error must never be reported over a registration that is already gone,
//! because the user reads the error as "nothing happened" and the folder is
//! then stranded with nothing left pointing at it.
#![cfg(unix)]
use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

fn call(engine: &Engine, method: &str, params: Value) -> drogon_protocol::Response {
    let request: Request = serde_json::from_value(json!({"protocol": PROTOCOL_VERSION, "requestId": uuid::Uuid::new_v4().to_string(), "method": method, "params": params})).unwrap();
    engine.dispatch(request)
}

fn ok(engine: &Engine, method: &str, params: Value) -> Value {
    let reply = call(engine, method, params);
    assert!(reply.ok, "{method}: {:?}", reply.error);
    reply.result.unwrap()
}

fn is_registered(engine: &Engine, id: &str) -> bool {
    ok(engine, "project.list", json!({}))["projects"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p["id"] == id)
}

fn workspace_count(engine: &Engine, path: &str) -> usize {
    ok(engine, "workspace.list", json!({}))["workspaces"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|w| w["path"] == path)
        .count()
}

/// Makes unlinking inside `dir` fail. Returns false when the caller can write
/// anyway (root ignores the mode), which leaves nothing for the test to prove.
fn deny_unlink(dir: &Path) -> bool {
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o500)).unwrap();
    let probe = dir.join("unlink-probe");
    match std::fs::write(&probe, "x") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
            false
        }
        Err(_) => true,
    }
}

fn allow_unlink(dir: &Path) {
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).unwrap();
}

#[test]
fn a_failed_chat_scratch_cleanup_keeps_the_chat_registered_and_retryable() {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let chat = ok(
        &engine,
        "project.quickSessionCreate",
        json!({"name": "Stubborn"}),
    );
    let id = chat["project"]["id"].as_str().unwrap().to_string();
    let path = chat["project"]["path"].as_str().unwrap().to_string();
    let scratch = Path::new(&path);
    if !deny_unlink(scratch) {
        return;
    }

    let refused = call(&engine, "project.remove", json!({"id": id}));
    assert!(
        !refused.ok,
        "an undeletable scratch must refuse the removal"
    );
    let error = refused.error.unwrap();
    assert_eq!(error.code, "io_error", "{}", error.message);
    assert!(
        error
            .message
            .contains("quick session scratch cleanup failed"),
        "{}",
        error.message
    );
    // The reported failure and the database agree: nothing was committed.
    assert!(
        is_registered(&engine, &id),
        "a reported failure must leave the Chat registered"
    );
    assert_eq!(
        workspace_count(&engine, &path),
        1,
        "its workspace row survives the refused removal too"
    );
    assert!(scratch.is_dir(), "the scratch is untouched");

    // Retrying once the obstacle is gone completes the delete, rather than
    // answering not_found over rows a failed call had already dropped.
    allow_unlink(scratch);
    let retried = call(&engine, "project.remove", json!({"id": id}));
    assert!(
        retried.ok,
        "the retry must delete, not report not_found: {:?}",
        retried.error
    );
    assert!(!scratch.exists(), "the retry removes the scratch");
    assert!(!is_registered(&engine, &id));
    assert_eq!(workspace_count(&engine, &path), 0);
}

#[test]
fn a_chat_whose_scratch_already_vanished_still_unregisters() {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let chat = ok(&engine, "project.quickSessionCreate", json!({}));
    let id = chat["project"]["id"].as_str().unwrap().to_string();
    let path = chat["project"]["path"].as_str().unwrap().to_string();
    // A scratch removed behind the app's back (a temp sweep, a user with a
    // terminal) leaves nothing to clean, so removal must still go through.
    std::fs::remove_dir_all(&path).unwrap();

    let removed = call(&engine, "project.remove", json!({"id": id}));
    assert!(
        removed.ok,
        "a missing scratch is cleanup already done: {:?}",
        removed.error
    );
    assert!(!is_registered(&engine, &id));
    assert_eq!(workspace_count(&engine, &path), 0);
}

#[test]
fn a_failed_managed_folder_delete_keeps_the_project_registered_and_retryable() {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let created = ok(
        &engine,
        "project.create",
        json!({"name": "stubborn-a1b2c3"}),
    );
    let id = created["project"]["id"].as_str().unwrap().to_string();
    let path = created["project"]["path"].as_str().unwrap().to_string();
    let folder = Path::new(&path);
    std::fs::write(folder.join("specs.md"), "x").unwrap();
    if !deny_unlink(folder) {
        return;
    }

    let refused = call(
        &engine,
        "project.remove",
        json!({"id": id, "deleteFiles": true}),
    );
    assert!(!refused.ok, "an undeletable folder must refuse the removal");
    let error = refused.error.unwrap();
    assert_eq!(error.code, "io_error", "{}", error.message);
    assert!(
        error.message.contains("stays registered"),
        "the message must match what the database did: {}",
        error.message
    );
    assert!(
        is_registered(&engine, &id),
        "a reported failure must leave the project registered"
    );
    assert!(folder.is_dir());

    allow_unlink(folder);
    let retried = call(
        &engine,
        "project.remove",
        json!({"id": id, "deleteFiles": true}),
    );
    assert!(
        retried.ok,
        "the retry must delete, not report not_found: {:?}",
        retried.error
    );
    assert!(!folder.exists());
    assert!(!is_registered(&engine, &id));
}

#[test]
fn a_managed_folder_that_already_vanished_still_unregisters() {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let created = ok(
        &engine,
        "project.create",
        json!({"name": "vanished-d4e5f6"}),
    );
    let id = created["project"]["id"].as_str().unwrap().to_string();
    let path = created["project"]["path"].as_str().unwrap().to_string();
    std::fs::remove_dir_all(&path).unwrap();

    let removed = call(
        &engine,
        "project.remove",
        json!({"id": id, "deleteFiles": true}),
    );
    assert!(
        removed.ok,
        "a folder already gone leaves nothing to delete: {:?}",
        removed.error
    );
    assert!(!is_registered(&engine, &id));
}

#[test]
fn deleting_files_still_refuses_a_folder_outside_the_projects_home() {
    let data = tempfile::tempdir().unwrap();
    let engine = Engine::open(data.path()).unwrap();
    let owned = tempfile::tempdir().unwrap();
    let path = owned.path().to_str().unwrap().to_string();
    std::fs::write(owned.path().join("notes.md"), "mine").unwrap();
    let added = ok(
        &engine,
        "project.add",
        json!({"path": path, "name": "mine"}),
    );
    let id = added["id"].as_str().unwrap().to_string();

    let refused = call(
        &engine,
        "project.remove",
        json!({"id": id, "deleteFiles": true}),
    );
    assert!(!refused.ok, "the owner's folder is never deleted");
    assert!(
        refused.error.unwrap().message.contains("projects home"),
        "the guard survives the cleanup reordering"
    );
    assert!(
        is_registered(&engine, &id),
        "a refused delete keeps the registration"
    );
    assert!(owned.path().join("notes.md").exists());
}
