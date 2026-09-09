use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::json;

fn ok(engine: &Engine, method: &str, params: serde_json::Value) -> serde_json::Value {
    let response = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: uuid::Uuid::new_v4().to_string(),
        auth: None,
        method: method.into(),
        params,
    });
    assert!(response.ok, "{method}: {:?}", response.error);
    response.result.unwrap()
}

#[test]
fn historical_cancellation_cannot_block_a_replacement_task() {
    for method in ["orchestration.workerStop", "orchestration.workerAbandon"] {
        for old_state in ["stopped", "abandoned"] {
            let dir = tempfile::tempdir().unwrap();
            let engine = Engine::open(dir.path()).unwrap();
            let host = ok(&engine, "status", json!({}))["hostId"].clone();
            let run = ok(&engine, "orchestration.runCreate", json!({
                "contractVersion":1,"hostId":host,"coordinatorId":"owner","objective":"history isolation"
            }))["run"]["runId"].clone();
            let scope = json!({"contractVersion":1,"hostId":host,"runId":run,
                "coordinatorId":"owner","consumerGeneration":1});
            let mut create = scope.clone();
            create["spec"] = json!({"instructions":"replacement remains active"});
            let task = ok(&engine, "orchestration.taskCreate", create)["task"]["taskId"].clone();
            assert!(task.is_string());
            let conn =
                rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
            conn.execute(
                "UPDATE orchestration_tasks SET status='dispatched' WHERE task_id=?1",
                [task.as_str().unwrap()],
            )
            .unwrap();
            for (dispatch, state, current, fenced) in
                [("old", old_state, 0, 1), ("replacement", "ready", 1, 0)]
            {
                let state = json!({"result":{"runId":run,"taskId":task,"dispatchId":dispatch,
                    "consumerGeneration":1,"workspaceId":"fixture-folder","assignmentState":state,
                    "readiness":"notObserved","processVerdict":"unverifiable",
                    "effects":[],"residualResources":[]},
                    "launch":{"harnessId":"claude","permissionMode":"inherit"},
                    "outcome":null,"report_message_id":null,"cleanup_owned":false});
                conn.execute("INSERT INTO orchestration_attempts(dispatch_id,host_id,run_id,task_id,is_current,fenced,state_json) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                    rusqlite::params![dispatch,host.as_str().unwrap(),run.as_str().unwrap(),task.as_str().unwrap(),current,fenced,state.to_string()]).unwrap();
            }
            let mut cancel = scope.clone();
            cancel["dispatchId"] = json!("old");
            let result = ok(&engine, method, cancel);
            assert_eq!(result["assignmentState"], old_state);
            let status: String = conn
                .query_row(
                    "SELECT status FROM orchestration_tasks WHERE task_id=?1",
                    [task.as_str().unwrap()],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(
                status, "dispatched",
                "{method} on historical {old_state} must not block its replacement"
            );
            let replacement: (i64, i64) = conn.query_row("SELECT is_current,fenced FROM orchestration_attempts WHERE dispatch_id='replacement'", [], |row| Ok((row.get(0)?,row.get(1)?))).unwrap();
            assert_eq!(replacement, (1, 0));
            let mut show = scope;
            show["dispatchId"] = json!("replacement");
            assert_eq!(
                ok(&engine, "orchestration.workerShow", show)["assignmentState"],
                "ready"
            );
        }
    }
}

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
        "workerRetain",
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
