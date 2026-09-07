use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::json;

#[test]
fn worker_operations_refuse_a_foreign_host_before_any_effect_or_receipt() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let scope = json!({
        "contractVersion":1,"hostId":"foreign-execution-host", "runId":"run",
        "coordinatorId":"coordinator", "consumerGeneration":1,
        "dispatchId":"dispatch", "taskId":"task", "workspaceId":"workspace",
        "mode":"fresh", "launch":{"harnessId":"pi"}
    });
    for method in [
        "workerStart",
        "workerShow",
        "workerRead",
        "workerStop",
        "workerAbandon",
        "workerRelease",
    ] {
        let response = engine.dispatch(Request {
            protocol: PROTOCOL_VERSION,
            request_id: method.into(),
            auth: None,
            method: format!("orchestration.{method}"),
            params: scope.clone(),
        });
        assert!(!response.ok);
        assert_eq!(response.error.unwrap().code, "unsupported_host", "{method}");
    }
    let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
    for table in ["requests", "sessions", "workspaces"] {
        let count: u32 = conn
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0, "foreign host created {table} state");
    }
}
