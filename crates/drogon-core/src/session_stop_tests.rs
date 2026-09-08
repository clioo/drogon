#![cfg(unix)]

use super::*;
use drogon_protocol::orchestration_worker::ProcessAction;

struct Fixture {
    dir: tempfile::TempDir,
    _engine: Engine,
    handle: Arc<SessionHandle>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = session::stop(&self.handle);
    }
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let invoke = |id: &str, method: &str, params: Value| {
        let response = engine.dispatch(Request {
            protocol: PROTOCOL_VERSION,
            request_id: id.into(),
            auth: None,
            method: method.into(),
            params,
        });
        assert!(response.ok, "{:?}", response.error);
        response.result.unwrap()
    };
    let workspace = invoke(
        "workspace",
        "workspace.register",
        json!({"path":dir.path()}),
    );
    let session = invoke(
        "start",
        "session.start",
        json!({
            "workspaceId":workspace["id"], "command":"/bin/sh", "args":["-c", "exec sleep 30"]
        }),
    );
    let handle = engine.sessions.lock().unwrap()[session["id"].as_str().unwrap()].clone();
    Fixture {
        dir,
        _engine: engine,
        handle,
    }
}

#[test]
fn exact_stop_distinguishes_signal_from_already_observed_exit() {
    let fixture = fixture();
    let handle = &fixture.handle;
    let stopped = session::stop_with_action(handle);
    assert_eq!(stopped.process_action, ProcessAction::Signalled);
    assert_eq!(stopped.session.unwrap()["verdict"], "exited");
    let repeated = session::stop_with_action(handle);
    assert_eq!(repeated.process_action, ProcessAction::None);
    assert_eq!(repeated.session.unwrap()["verdict"], "exited");
}

fn start_sleep_session(engine: &Engine, dir: &tempfile::TempDir, secs: &str) -> Value {
    let invoke = |id: &str, method: &str, params: Value| {
        let response = engine.dispatch(Request {
            protocol: PROTOCOL_VERSION,
            request_id: id.into(),
            auth: None,
            method: method.into(),
            params,
        });
        assert!(response.ok, "{:?}", response.error);
        response.result.unwrap()
    };
    let workspace = invoke(
        "workspace",
        "workspace.register",
        json!({"path":dir.path()}),
    );
    invoke(
        "start",
        "session.start",
        json!({
            "workspaceId": workspace["id"],
            "command": "/bin/sh",
            "args": ["-c", format!("exec sleep {secs}")],
        }),
    )
}

fn hook_event(engine: &Engine, session: &Value, event: &str) -> Value {
    let response = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: format!("hook-{event}"),
        auth: None,
        method: "session.hook_event".into(),
        params: json!({
            "sessionId": session["id"],
            "incarnation": session["incarnation"],
            "event": event,
        }),
    });
    assert!(response.ok, "{:?}", response.error);
    response.result.unwrap()
}

fn session_row(dir: &tempfile::TempDir, id: &str) -> (String, Option<String>) {
    let conn = Connection::open(dir.path().join(DB_FILE_NAME)).unwrap();
    conn.query_row(
        "SELECT verdict, needs_input_at FROM sessions WHERE id = ?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .unwrap()
}

#[test]
fn hook_wait_stamp_is_durable_and_clear_removes_it() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let session = start_sleep_session(&engine, &dir, "30");
    let id = session["id"].as_str().unwrap();

    let waited = hook_event(&engine, &session, "AgentEnd");
    assert_eq!(waited["agentState"], "needs_input");
    let stamp = waited["agentStateAt"].as_str().unwrap().to_string();
    assert_eq!(session_row(&dir, id).1.as_deref(), Some(stamp.as_str()));

    let cleared = hook_event(&engine, &session, "AgentStart");
    assert_ne!(cleared["agentState"], "needs_input");
    assert_eq!(session_row(&dir, id).1, None);

    let handle = engine.sessions.lock().unwrap()[id].clone();
    let _ = session::stop(&handle);
}

#[test]
fn restart_keeps_reporting_an_uncleared_wait_with_its_stamp() {
    let dir = tempfile::tempdir().unwrap();
    let (id, stamp) = {
        let engine = Engine::open(dir.path()).unwrap();
        let session = start_sleep_session(&engine, &dir, "30");
        let waited = hook_event(&engine, &session, "AgentEnd");
        assert_eq!(waited["agentState"], "needs_input");
        // The engine drops without `stop`: the orphaned `sleep` keeps the
        // row `live` so the next open must recover it as `unverifiable`
        // (it exits on its own seconds later; nothing here can reap it).
        (
            waited["id"].as_str().unwrap().to_string(),
            waited["agentStateAt"].as_str().unwrap().to_string(),
        )
    };
    let engine = Engine::open(dir.path()).unwrap();
    let response = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: "list".into(),
        auth: None,
        method: "session.list".into(),
        params: json!({}),
    });
    assert!(response.ok, "{:?}", response.error);
    let listed = response.result.unwrap();
    let restored = listed["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == id)
        .expect("restarted daemon must still list the prior session")
        .clone();
    assert_eq!(restored["verdict"], "unverifiable");
    assert_eq!(restored["agentState"], "needs_input");
    assert_eq!(restored["agentStateAt"], stamp);
}

#[test]
fn old_schema_without_needs_input_gains_the_column_on_open() {
    let dir = tempfile::tempdir().unwrap();
    Connection::open(dir.path().join(DB_FILE_NAME))
        .unwrap()
        .execute_batch(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, host_id TEXT NOT NULL,
                incarnation TEXT NOT NULL, command TEXT NOT NULL, args_json TEXT NOT NULL,
                cols INTEGER NOT NULL, rows INTEGER NOT NULL, verdict TEXT NOT NULL,
                exit_code INTEGER, created_at TEXT NOT NULL, harness_id TEXT
            );
            CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )
        .unwrap();
    let _engine = Engine::open(dir.path()).unwrap();
    let has_column: bool = Connection::open(dir.path().join(DB_FILE_NAME))
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'needs_input_at'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .unwrap();
    assert!(has_column, "open must migrate the wait-signal column");
}

#[test]
fn signal_evidence_survives_exit_storage_failure() {
    let fixture = fixture();
    let handle = &fixture.handle;
    let conn = Connection::open(fixture.dir.path().join(DB_FILE_NAME)).unwrap();
    conn.execute_batch("CREATE TRIGGER refuse_exit BEFORE UPDATE OF verdict ON sessions WHEN NEW.verdict='exited' BEGIN SELECT RAISE(FAIL, 'exit fixture'); END;").unwrap();
    let stopped = session::stop_with_action(handle);
    assert_eq!(stopped.process_action, ProcessAction::Signalled);
    assert!(stopped.session.is_err());
    assert_eq!(session::snapshot(handle)["verdict"], "exited");
    conn.execute_batch("DROP TRIGGER refuse_exit;").unwrap();
    let recovered = session::stop_with_action(handle);
    assert_eq!(recovered.process_action, ProcessAction::None);
    assert_eq!(recovered.session.unwrap()["verdict"], "exited");
}
