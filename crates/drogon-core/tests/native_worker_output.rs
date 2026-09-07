//! Exact-attempt reads over real PTY output; attempt metadata is fixture-seeded.
#![cfg(unix)]

use base64::Engine as _;
use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

fn call(engine: &Engine, method: &str, params: Value) -> Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        auth: None,
        method: method.into(),
        params,
    })
}

fn ok(engine: &Engine, method: &str, params: Value) -> Value {
    let response = call(engine, method, params);
    assert!(response.ok, "{method}: {:?}", response.error);
    response.result.unwrap()
}

struct OwnedSession<'a> {
    engine: &'a Engine,
    identity: Value,
}
impl Drop for OwnedSession<'_> {
    fn drop(&mut self) {
        call(self.engine, "session.stop", self.identity.clone());
    }
}

#[test]
fn worker_read_preserves_bytes_pins_cursor_and_refuses_lost_output_after_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let host = ok(&engine, "status", json!({}))["hostId"].clone();
    let run = ok(
        &engine,
        "orchestration.runCreate",
        json!({
            "contractVersion":1,"hostId":host,"coordinatorId":"owner","objective":"read output"
        }),
    )["run"]["runId"]
        .clone();
    let mut scope = json!({"contractVersion":1,"hostId":host,"runId":run,
        "coordinatorId":"owner","consumerGeneration":1,"dispatchId":"dispatch-one"});
    let workspace = ok(&engine, "workspace.register", json!({"path":dir.path()}))["id"].clone();
    let session = ok(
        &engine,
        "session.start",
        json!({"workspaceId":workspace,
        "command":"/bin/echo","args":["worker-output-ñ-🐉"],"cols":80,"rows":24}),
    );
    let identity = json!({"sessionId":session["id"],"incarnation":session["incarnation"]});
    let owned = OwnedSession {
        engine: &engine,
        identity: identity.clone(),
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let read = ok(&engine, "session.read", identity.clone());
        if read["session"]["verdict"] == "exited" && read["dataBase64"].as_str().unwrap().len() > 5
        {
            break;
        }
        assert!(Instant::now() < deadline, "PTY did not drain");
        std::thread::sleep(Duration::from_millis(10));
    }
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    for dispatch in ["dispatch-one", "dispatch-two"] {
        let state = json!({"result":{"runId":run,"taskId":dispatch,"dispatchId":dispatch,
            "consumerGeneration":1,"workspaceId":workspace,"assignmentState":"ready",
            "readiness":"notObserved","processVerdict":"live","sessionIdentity":identity,
            "effects":[],"residualResources":[]},
            "launch":{"harnessId":"claude","permissionMode":"inherit"},
            "outcome":null,"report_message_id":null,"cleanup_owned":false});
        conn.execute("INSERT INTO orchestration_attempts(dispatch_id,host_id,run_id,task_id,is_current,fenced,state_json) VALUES (?1,?2,?3,?1,1,0,?4)",
            rusqlite::params![dispatch,host.as_str().unwrap(),run.as_str().unwrap(),state.to_string()]).unwrap();
    }
    let first = ok(&engine, "orchestration.workerRead", scope.clone());
    assert_eq!(first["source"], "terminal");
    assert_eq!(first["processVerdict"], "exited");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(
            first["entries"][0]["content"]["dataBase64"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
    assert!(
        String::from_utf8(bytes)
            .unwrap()
            .contains("worker-output-ñ-🐉")
    );
    let cursor = first["nextCursor"].as_str().unwrap().to_owned();
    scope["cursor"] = json!(cursor);
    assert!(
        ok(&engine, "orchestration.workerRead", scope.clone())["entries"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    scope["dispatchId"] = json!("dispatch-two");
    let mismatch = call(&engine, "orchestration.workerRead", scope.clone());
    assert!(!mismatch.ok);
    assert_eq!(mismatch.error.unwrap().code, "invalid_argument");
    scope["dispatchId"] = json!("dispatch-one");
    scope["source"] = json!("transcript");
    assert_eq!(
        call(&engine, "orchestration.workerRead", scope.clone())
            .error
            .unwrap()
            .code,
        "source_changed"
    );
    drop(owned);
    drop(conn);
    drop(engine);
    let engine = Engine::open(dir.path()).unwrap();
    scope["source"] = json!("auto");
    assert_eq!(
        call(&engine, "orchestration.workerRead", scope)
            .error
            .unwrap()
            .code,
        "unverifiable"
    );
}
