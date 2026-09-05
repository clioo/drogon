#![cfg(unix)]

use drogon_core::{DB_FILE_NAME, Engine};
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

fn call(engine: &Engine, id: &str, method: &str, params: Value) -> Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    })
}

fn ok(response: Response) -> Value {
    assert!(response.ok, "{:?}", response.error);
    response.result.unwrap()
}

#[test]
fn failed_post_spawn_transition_retains_identity_and_never_replays_the_spawn() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace = ok(call(
        &engine,
        "workspace",
        "workspace.register",
        json!({"path":dir.path()}),
    ));
    let db = rusqlite::Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
    db.execute_batch("CREATE TRIGGER refuse_admission BEFORE UPDATE OF verdict ON sessions WHEN NEW.verdict='live' BEGIN SELECT RAISE(FAIL, 'admission fixture'); END;").unwrap();
    let params =
        json!({"workspaceId":workspace["id"], "command":"/bin/sh", "args":["-c", "sleep 3"]});
    let admitted = call(&engine, "start", "session.start", params.clone());
    assert_eq!(admitted.error.as_ref().unwrap().code, "unverifiable");
    assert_eq!(
        call(&engine, "start", "session.start", params).error,
        admitted.error
    );
    let listed = ok(call(&engine, "list", "session.list", json!({})));
    let sessions = listed["sessions"].as_array().unwrap();
    assert_eq!(sessions.len(), 1);
    let session = &sessions[0];
    assert_eq!(session["verdict"], "live");
    db.execute_batch("DROP TRIGGER refuse_admission;").unwrap();
    let stopped = ok(call(
        &engine,
        "stop",
        "session.stop",
        json!({"sessionId":session["id"], "incarnation":session["incarnation"]}),
    ));
    assert_eq!(stopped["verdict"], "exited");
}

#[test]
fn stop_never_claims_durable_success_when_exit_persistence_fails() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace = ok(call(
        &engine,
        "workspace",
        "workspace.register",
        json!({"path":dir.path()}),
    ));
    let session = ok(call(
        &engine,
        "start",
        "session.start",
        json!({"workspaceId":workspace["id"], "command":"/bin/sh", "args":["-c", "sleep 3"]}),
    ));
    let identity = json!({"sessionId":session["id"], "incarnation":session["incarnation"]});
    let db = rusqlite::Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
    db.execute_batch("CREATE TRIGGER refuse_exit BEFORE UPDATE OF verdict ON sessions WHEN NEW.verdict='exited' BEGIN SELECT RAISE(FAIL, 'exit fixture'); END;").unwrap();
    let failed = call(&engine, "stop", "session.stop", identity.clone());
    assert!(!failed.ok);
    let observed = ok(call(&engine, "list", "session.list", json!({})));
    assert_eq!(observed["sessions"][0]["verdict"], "exited");
    let persisted: String = db
        .query_row("SELECT verdict FROM sessions", [], |row| row.get(0))
        .unwrap();
    assert_eq!(persisted, "live");
    db.execute_batch("DROP TRIGGER refuse_exit;").unwrap();
    let confirmed = ok(call(
        &engine,
        "stop-after-storage-recovery",
        "session.stop",
        identity.clone(),
    ));
    assert_eq!(confirmed["verdict"], "exited");
    assert_eq!(
        call(&engine, "stop", "session.stop", identity).error,
        failed.error
    );
    let persisted: String = db
        .query_row("SELECT verdict FROM sessions", [], |row| row.get(0))
        .unwrap();
    assert_eq!(persisted, "exited");
}
