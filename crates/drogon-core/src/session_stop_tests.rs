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

/// Points `agentCmdOverrides` at a fixture `pi` that sleeps for `secs`
/// seconds, so the hook-event tests below drive a session that legitimately
/// carries the pi hook namespace (hook events on harness-less sessions are
/// refused as forgeries). Must run before `Engine::open`.
fn write_pi_fixture_settings(dir: &tempfile::TempDir, secs: &str) {
    let bin = dir.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let pi = bin.join("pi");
    std::fs::write(&pi, format!("#!/bin/sh\nexec sleep {secs}\n")).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&pi, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    std::fs::write(
        dir.path().join("agent-settings.json"),
        serde_json::to_vec(&json!({
            "version": 1,
            "settings": {
                "defaultTuiAgent": null,
                "disabledTuiAgents": [],
                "agentCmdOverrides": { "pi": pi.to_string_lossy() },
                "agentDefaultArgs": {},
                "agentDefaultEnv": {},
                "agentStatusHooksEnabled": true,
                "tabAutoGenerateTitle": false,
                "promptCacheTimerEnabled": false,
                "promptCacheTtlMs": 300000,
                "codexSessionSourceHome": ""
            }
        }))
        .unwrap(),
    )
    .unwrap();
}

fn start_sleep_session(engine: &Engine, dir: &tempfile::TempDir) -> Value {
    let workspace_dir = dir.path().join("work");
    std::fs::create_dir_all(&workspace_dir).unwrap();
    let response = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: "ws-sleep".into(),
        auth: None,
        method: "workspace.register".into(),
        params: json!({"path": workspace_dir.to_string_lossy()}),
    });
    assert!(response.ok, "{:?}", response.error);
    let workspace = response.result.unwrap();
    let response = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: "start-sleep".into(),
        auth: None,
        method: "harness.start".into(),
        params: json!({
            "workspaceId": workspace["id"],
            "harnessId": "pi",
            "permissionMode": "inherit",
        }),
    });
    assert!(response.ok, "{:?}", response.error);
    response.result.unwrap()
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
    write_pi_fixture_settings(&dir, "30");
    let engine = Engine::open(dir.path()).unwrap();
    let session = start_sleep_session(&engine, &dir);
    let id = session["id"].as_str().unwrap();

    let waited = hook_event(&engine, &session, "ToolApprovalRequested");
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
        write_pi_fixture_settings(&dir, "30");
        let engine = Engine::open(dir.path()).unwrap();
        let session = start_sleep_session(&engine, &dir);
        let waited = hook_event(&engine, &session, "ToolApprovalRequested");
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
fn exit_clears_a_stale_wait_so_restart_lists_the_exited_session() {
    // #222: a session that exits while its hook wait is uncleared (Pi
    // sessions never get the generic PTY clear) must not leave its stamp
    // in the durable row — after a daemon restart that row lists as
    // `exited` with a non-null `agentStateAt` and poisons every
    // `session.list` consumer enforcing the session invariants.
    let dir = tempfile::tempdir().unwrap();
    let id = {
        write_pi_fixture_settings(&dir, "30");
        let engine = Engine::open(dir.path()).unwrap();
        let session = start_sleep_session(&engine, &dir);
        let waited = hook_event(&engine, &session, "ToolApprovalRequested");
        assert_eq!(waited["agentState"], "needs_input");
        let id = waited["id"].as_str().unwrap().to_string();
        let handle = engine.sessions.lock().unwrap()[id.as_str()].clone();
        let stopped = session::stop(&handle).unwrap();
        assert_eq!(stopped["verdict"], "exited");
        assert_eq!(session_row(&dir, &id).1, None);
        id
    };
    // Same database, new engine: the daemon restart over the persisted DB.
    let engine = Engine::open(dir.path()).unwrap();
    let response = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: "list-after-restart".into(),
        auth: None,
        method: "session.list".into(),
        params: json!({}),
    });
    assert!(response.ok, "{:?}", response.error);
    let restored = response.result.unwrap()["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == id)
        .expect("restarted daemon must still list the prior session")
        .clone();
    assert_eq!(restored["verdict"], "exited");
    assert_eq!(restored["agentState"], "exited");
    assert_eq!(restored["agentStateAt"], Value::Null);
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
                exit_code INTEGER, created_at TEXT NOT NULL, harness_id TEXT,
                parent_session_id TEXT
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
