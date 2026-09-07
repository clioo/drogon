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
