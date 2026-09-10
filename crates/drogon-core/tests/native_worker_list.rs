//! `orchestration.workerList` through the public engine seams only:
//! `Engine::open` + `with_worker_cli` + `dispatch` against real SQLite and a
//! real (fixture) harness process. No model inference: the fixture `claude`
//! harness exits immediately, and every assertion reads durable state.
//!
//! Covers: optional `--run` (without it ALL runs list, never a current-run
//! guess), six-state `--terminal-state` filter, counts over run-selected
//! rows BEFORE the filter, unknown run reads empty, immutable attempt
//! identity per row, independent assignment/outcome/verdict/resource axes,
//! no rows or receipts allocated by the read, and worker-credential denial.

#![cfg(unix)]

use drogon_core::{DB_FILE_NAME, Engine};
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};
use std::sync::{Mutex, OnceLock};

fn path_guard() -> &'static Mutex<()> {
    static GUARD: OnceLock<Mutex<()>> = OnceLock::new();
    GUARD.get_or_init(|| Mutex::new(()))
}

fn call(engine: &Engine, id: &str, method: &str, params: Value) -> Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    })
}

fn ok(engine: &Engine, id: &str, method: &str, params: Value) -> Value {
    let response = call(engine, id, method, params);
    assert!(response.ok, "{method}: {:?}", response.error);
    response.result.unwrap()
}

fn scope(host: &str, run_id: &str, generation: u64) -> Value {
    json!({
        "contractVersion": 1, "hostId": host, "runId": run_id,
        "coordinatorId": "coord-test-1", "consumerGeneration": generation,
    })
}

fn dispatch_scope(host: &str, run_id: &str, generation: u64, dispatch_id: &str) -> Value {
    let mut params = scope(host, run_id, generation);
    params["dispatchId"] = json!(dispatch_id);
    params
}

fn worker_list(engine: &Engine, id: &str, host: &str, run: Option<&str>) -> Value {
    let mut params = json!({"contractVersion": 1, "hostId": host});
    if let Some(run) = run {
        params["run"] = json!(run);
    }
    ok(engine, id, "orchestration.workerList", params)
}

fn worker_list_filtered(
    engine: &Engine,
    id: &str,
    host: &str,
    run: Option<&str>,
    terminal_state: &str,
) -> Value {
    let mut params = json!({"contractVersion": 1, "hostId": host,
        "terminalState": terminal_state});
    if let Some(run) = run {
        params["run"] = json!(run);
    }
    ok(engine, id, "orchestration.workerList", params)
}

/// Row counts for every table, to prove the read allocates nothing.
fn table_counts(data_dir: &std::path::Path) -> Vec<(String, i64)> {
    let conn = rusqlite::Connection::open(data_dir.join(DB_FILE_NAME)).unwrap();
    let tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    tables
        .into_iter()
        .map(|table| {
            let count: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM \"{table}\""), [], |r| {
                    r.get(0)
                })
                .unwrap();
            (table, count)
        })
        .collect()
}

fn start_worker(engine: &Engine, id: &str, host: &str, run: &str, task: &str, ws: &str) -> String {
    let started = ok(
        engine,
        id,
        "orchestration.workerStart",
        json!({"contractVersion": 1, "hostId": host, "runId": run,
               "coordinatorId": "coord-test-1", "consumerGeneration": 1,
               "taskId": task, "workspaceId": ws,
               "mode": "fresh",
               "launch": {"harnessId": "claude", "model": "fixture-model",
                          "permissionMode": "unattended"}}),
    );
    started["dispatchId"].as_str().unwrap().to_string()
}

fn make_task(engine: &Engine, id: &str, host: &str, run: &str, instructions: &str) -> String {
    let task = ok(
        engine,
        id,
        "orchestration.taskCreate",
        json!({"contractVersion": 1, "hostId": host, "runId": run,
               "coordinatorId": "coord-test-1", "consumerGeneration": 1,
               "spec": {"instructions": instructions, "dependsOn": []}}),
    );
    task["task"]["taskId"].as_str().unwrap().to_string()
}

#[test]
fn worker_list_covers_runs_filters_counts_and_allocates_nothing() {
    let _path = path_guard().lock().unwrap();
    let fixture_dir = tempfile::tempdir().unwrap();
    let fixture_dir = fixture_dir.keep();
    let harness = fixture_dir.join("claude");
    std::fs::write(&harness, "#!/bin/sh\nexit 0\n").unwrap();
    let cli = fixture_dir.join("probe-cli");
    std::fs::write(&cli, "#!/bin/sh\nexit 0\n").unwrap();
    use std::os::unix::fs::PermissionsExt;
    for path in [&harness, &cli] {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let saved_path = std::env::var_os("PATH").unwrap_or_default();
    let mut paths = vec![fixture_dir.clone()];
    paths.extend(std::env::split_paths(&saved_path));
    // PATH is process-global: the file-level mutex above serializes this.
    unsafe {
        std::env::set_var("PATH", std::env::join_paths(&paths).unwrap());
    }

    let result = std::panic::catch_unwind(|| {
        let data_dir = tempfile::tempdir().unwrap();
        let workspace_dir = data_dir.path().join("ws");
        std::fs::create_dir(&workspace_dir).unwrap();
        let engine = Engine::open(data_dir.path()).unwrap();
        let engine = engine.with_worker_cli(&cli).unwrap();
        let host = ok(&engine, "status", "status", json!({}))["hostId"]
            .as_str()
            .unwrap()
            .to_string();
        ok(
            &engine,
            "ws",
            "workspace.register",
            json!({"path": workspace_dir.to_str().unwrap(), "name": "list-ws"}),
        );
        let workspace_id =
            ok(&engine, "ws-list", "workspace.list", json!({}))["workspaces"][0]["id"]
                .as_str()
                .unwrap()
                .to_string();

        let mk_run = |engine: &Engine, id: &str, objective: &str| {
            ok(
                engine,
                id,
                "orchestration.runCreate",
                json!({"contractVersion": 1, "hostId": host,
                       "objective": objective, "coordinatorId": "coord-test-1"}),
            )["run"]["runId"]
                .as_str()
                .unwrap()
                .to_string()
        };
        let run1 = mk_run(&engine, "run1", "list probe one");
        let run2 = mk_run(&engine, "run2", "list probe two");

        // run1: one unsettled assignment and one stopped attempt with a hold.
        let task1 = make_task(&engine, "t1", &host, &run1, "active work");
        let d_active = start_worker(&engine, "s1", &host, &run1, &task1, &workspace_id);
        let task2 = make_task(&engine, "t2", &host, &run1, "stopped work");
        let d_stopped = start_worker(&engine, "s2", &host, &run1, &task2, &workspace_id);
        ok(
            &engine,
            "stop2",
            "orchestration.workerStop",
            dispatch_scope(&host, &run1, 1, &d_stopped),
        );
        let retained = ok(
            &engine,
            "retain2",
            "orchestration.workerRetain",
            dispatch_scope(&host, &run1, 1, &d_stopped),
        );
        assert_eq!(retained["state"], json!("retained"));

        // run2: one attempt retained then released.
        let task3 = make_task(&engine, "t3", &host, &run2, "released work");
        let d_released = start_worker(&engine, "s3", &host, &run2, &task3, &workspace_id);
        ok(
            &engine,
            "stop3",
            "orchestration.workerStop",
            dispatch_scope(&host, &run2, 1, &d_released),
        );
        ok(
            &engine,
            "retain3",
            "orchestration.workerRetain",
            dispatch_scope(&host, &run2, 1, &d_released),
        );
        let released = ok(
            &engine,
            "release3",
            "orchestration.workerRelease",
            dispatch_scope(&host, &run2, 1, &d_released),
        );
        assert_eq!(released["state"], json!("released"));

        // Without --run every run lists: immutable identity per row.
        let all = worker_list(&engine, "list-all", &host, None);
        assert_eq!(all["workers"].as_array().unwrap().len(), 3);
        let by_dispatch = |id: &str| {
            all["workers"]
                .as_array()
                .unwrap()
                .iter()
                .find(|w| w["dispatchId"] == json!(id))
                .unwrap()
                .clone()
        };
        let active = by_dispatch(&d_active);
        assert_eq!(active["taskId"], json!(task1));
        assert_eq!(active["runId"], json!(run1));
        assert_eq!(active["terminalState"], json!("active"));
        // Proven cleanup-owned native session: a real native resource even
        // absent a retention row, derived from attempt ownership only.
        assert_eq!(active["resource"]["state"], json!("owned"));
        assert_eq!(active["resource"]["reason"], json!("cleanup_owned"));
        assert!(active["assignmentState"].is_string());
        assert!(active["processVerdict"].is_string());
        // Source-mapped row fields are always present.
        assert_eq!(active["workerState"], json!("ready"));
        assert_eq!(active["dispatchStatus"], json!("dispatched"));
        assert!(active["agentTerminalHandle"].is_string());
        let stopped = by_dispatch(&d_stopped);
        assert_eq!(stopped["taskId"], json!(task2));
        assert_eq!(stopped["runId"], json!(run1));
        assert_eq!(stopped["terminalState"], json!("retained"));
        assert_eq!(stopped["resource"]["state"], json!("retained"));
        assert_eq!(stopped["resource"]["reason"], json!("user_requested"));
        assert_eq!(stopped["workerState"], json!("stopped"));
        assert_eq!(stopped["dispatchStatus"], json!("failed"));
        let done = by_dispatch(&d_released);
        assert_eq!(done["taskId"], json!(task3));
        assert_eq!(done["runId"], json!(run2));
        assert_eq!(done["terminalState"], json!("released"));
        assert_eq!(done["resource"]["state"], json!("released"));
        assert_eq!(
            all["counts"],
            json!({"active": 1, "retained": 1, "released": 1})
        );

        // --run isolates: run1 sees two rows, run2 one.
        let only1 = worker_list(&engine, "list-r1", &host, Some(&run1));
        assert_eq!(only1["workers"].as_array().unwrap().len(), 2);
        assert!(
            only1["workers"]
                .as_array()
                .unwrap()
                .iter()
                .all(|w| w["runId"] == json!(run1))
        );
        assert_eq!(only1["counts"], json!({"active": 1, "retained": 1}));
        let only2 = worker_list(&engine, "list-r2", &host, Some(&run2));
        assert_eq!(only2["workers"].as_array().unwrap().len(), 1);
        assert_eq!(only2["counts"], json!({"released": 1}));

        // Unknown run reads empty, never an error.
        let unknown = worker_list(&engine, "list-unknown", &host, Some("run-missing"));
        assert_eq!(unknown["workers"], json!([]));
        assert_eq!(unknown["counts"], json!({}));

        // Terminal-state filters: active / retained / released.
        let actives = worker_list_filtered(&engine, "f-active", &host, None, "active");
        assert_eq!(actives["workers"].as_array().unwrap().len(), 1);
        assert_eq!(actives["workers"][0]["dispatchId"], json!(d_active));
        let retained_rows = worker_list_filtered(&engine, "f-ret", &host, None, "retained");
        assert_eq!(retained_rows["workers"].as_array().unwrap().len(), 1);
        assert_eq!(retained_rows["workers"][0]["dispatchId"], json!(d_stopped));
        let released_rows = worker_list_filtered(&engine, "f-rel", &host, None, "released");
        assert_eq!(released_rows["workers"].as_array().unwrap().len(), 1);

        // Counts are computed BEFORE the filter: a filter matching nothing
        // in run2 still reports run2's retained counts honestly.
        let empty_but_counted =
            worker_list_filtered(&engine, "f-empty", &host, Some(&run2), "active");
        assert_eq!(empty_but_counted["workers"], json!([]));
        assert_eq!(empty_but_counted["counts"], json!({"released": 1}));

        // The read allocates no rows and no receipts anywhere in the db.
        let before = table_counts(data_dir.path());
        worker_list(&engine, "list-audit-1", &host, None);
        worker_list_filtered(&engine, "list-audit-2", &host, Some(&run1), "retained");
        worker_list(&engine, "list-audit-3", &host, Some("run-missing"));
        assert_eq!(table_counts(data_dir.path()), before, "list must not write");

        // A worker credential cannot list: the core gate denies the method.
        let denied = engine.dispatch_authenticated(
            Request {
                protocol: PROTOCOL_VERSION,
                request_id: "list-denied".into(),
                auth: Some("bogus-dispatch-credential".into()),
                method: "orchestration.workerList".into(),
                params: json!({"contractVersion": 1, "hostId": host}),
            },
            "synthetic-service-credential",
        );
        assert!(!denied.ok);
        assert_eq!(denied.error.unwrap().code, "unauthorized");

        // Invalid filter and cross-host scope fail closed at shape validation.
        assert_eq!(
            call(
                &engine,
                "list-bad-filter",
                "orchestration.workerList",
                json!({"contractVersion": 1, "hostId": host, "terminalState": "bogus"}),
            )
            .error
            .unwrap()
            .code,
            "invalid_argument"
        );
        assert_eq!(
            call(
                &engine,
                "list-bad-host",
                "orchestration.workerList",
                json!({"contractVersion": 1, "hostId": "other-host"}),
            )
            .error
            .unwrap()
            .code,
            "unsupported_host"
        );
    });
    unsafe {
        std::env::set_var("PATH", &saved_path);
    }
    result.unwrap();
}

/// Reopened-engine regression for the workerList self-deadlock: after the
/// engine is dropped and reopened, every session is historical, so every
/// verdict takes the `session_row_as_value` DB path that used to re-lock
/// `self.db` under `coordination_read`. The list runs on a thread with a
/// bounded wait so a regression fails honestly instead of hanging the suite.
#[test]
fn worker_list_after_reopen_lists_historical_sessions_without_deadlock() {
    let _path = path_guard().lock().unwrap();
    let fixture_dir = tempfile::tempdir().unwrap();
    let fixture_dir = fixture_dir.keep();
    let harness = fixture_dir.join("claude");
    std::fs::write(&harness, "#!/bin/sh\nexit 0\n").unwrap();
    let cli = fixture_dir.join("probe-cli");
    std::fs::write(&cli, "#!/bin/sh\nexit 0\n").unwrap();
    use std::os::unix::fs::PermissionsExt;
    for path in [&harness, &cli] {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let saved_path = std::env::var_os("PATH").unwrap_or_default();
    let mut paths = vec![fixture_dir.clone()];
    paths.extend(std::env::split_paths(&saved_path));
    unsafe {
        std::env::set_var("PATH", std::env::join_paths(&paths).unwrap());
    }

    let result = std::panic::catch_unwind(|| {
        let data_dir = tempfile::tempdir().unwrap();
        let data_path = data_dir.keep();
        let workspace_dir = data_path.join("ws");
        std::fs::create_dir(&workspace_dir).unwrap();
        let host = {
            let engine = Engine::open(&data_path).unwrap();
            let engine = engine.with_worker_cli(&cli).unwrap();
            let host = ok(&engine, "status", "status", json!({}))["hostId"]
                .as_str()
                .unwrap()
                .to_string();
            ok(
                &engine,
                "ws",
                "workspace.register",
                json!({"path": workspace_dir.to_str().unwrap(), "name": "reopen-ws"}),
            );
            let workspace_id = ok(&engine, "ws-list", "workspace.list", json!({}))["workspaces"][0]
                ["id"]
                .as_str()
                .unwrap()
                .to_string();
            let run = ok(
                &engine,
                "run",
                "orchestration.runCreate",
                json!({"contractVersion": 1, "hostId": host,
                       "objective": "reopen probe", "coordinatorId": "coord-test-1"}),
            )["run"]["runId"]
                .as_str()
                .unwrap()
                .to_string();
            let task = make_task(&engine, "t", &host, &run, "reopen work");
            start_worker(&engine, "s", &host, &run, &task, &workspace_id);
            // Sanity: lists while the session is still resident.
            let listed = worker_list(&engine, "list-before", &host, None);
            assert_eq!(listed["workers"].as_array().unwrap().len(), 1);
            host
        };
        // Drop the engine (all sessions become historical rows), reopen, and
        // list with a bounded wait: a deadlock regression times out here.
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let engine = Engine::open(&data_path).unwrap();
            let outcome = worker_list(&engine, "list-reopened", &host, None);
            let _ = tx.send(outcome);
        });
        let reopened = rx
            .recv_timeout(std::time::Duration::from_secs(30))
            .expect("workerList after reopen must complete; a timeout means deadlock");
        assert_eq!(reopened["workers"].as_array().unwrap().len(), 1);
        assert_eq!(reopened["counts"], json!({"active": 1}));
    });
    unsafe {
        std::env::set_var("PATH", &saved_path);
    }
    result.unwrap();
}

/// Seeded-derivation coverage only (no liveness claim): a failed spawn with
/// no proven terminal identity lists `terminalState: null` and no resource,
/// while a reused/not-cleanup-owned terminal lists `retained` with a
/// `no_owned_resource` reason. Counts skip the null row.
#[test]
fn worker_list_derives_null_and_unowned_terminals_from_stored_rows() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let host = ok(&engine, "status", "status", json!({}))["hostId"]
        .as_str()
        .unwrap()
        .to_string();
    let failed_json = serde_json::json!({
        "result": {
            "runId": "run-seed", "taskId": "task-seed", "dispatchId": "d-failed",
            "consumerGeneration": 1, "workspaceId": "ws-seed",
            "assignmentState": "failed", "readiness": "notObserved",
            "processVerdict": "unverifiable", "sessionIdentity": null,
            "effects": [], "residualResources": [],
        },
        "launch": {"harnessId": "claude"},
        "outcome": null, "report_message_id": null, "report_result": null,
        "cleanup_owned": true,
    });
    let reused_json = serde_json::json!({
        "result": {
            "runId": "run-seed", "taskId": "task-seed", "dispatchId": "d-reused",
            "consumerGeneration": 1, "workspaceId": "ws-seed",
            "assignmentState": "ready", "readiness": "notObserved",
            "processVerdict": "unverifiable",
            "sessionIdentity": {"sessionId": "sess-reused", "incarnation": "inc-1"},
            "effects": [], "residualResources": [],
        },
        "launch": {"harnessId": "claude"},
        "outcome": null, "report_message_id": null, "report_result": null,
        "cleanup_owned": false,
    });
    {
        let conn = rusqlite::Connection::open(data_dir.path().join(DB_FILE_NAME)).unwrap();
        // The engine holds the lock only across each call; open a second
        // connection for seeding while this engine is idle.
        drop(engine);
        conn.execute(
            "INSERT INTO sessions
               (id, workspace_id, host_id, incarnation, command, args_json,
                cols, rows, verdict, exit_code, created_at, harness_id, needs_input_at)
             VALUES ('sess-reused', 'ws-seed', ?1, 'inc-1', 'sh', '[]',
                     80, 24, 'exited', 0, 't', NULL, NULL)",
            rusqlite::params![host],
        )
        .unwrap();
        for (dispatch_id, value) in [("d-failed", failed_json), ("d-reused", reused_json)] {
            conn.execute(
                "INSERT INTO orchestration_attempts
                   (dispatch_id, host_id, run_id, task_id, is_current, fenced, retry_of, state_json)
                 VALUES (?1, ?2, 'run-seed', 'task-seed', 0, 0, NULL, ?3)",
                rusqlite::params![dispatch_id, host, serde_json::to_string(&value).unwrap()],
            )
            .unwrap();
        }
    }
    let engine = Engine::open(data_dir.path()).unwrap();
    let listed = worker_list(&engine, "list-seed", &host, Some("run-seed"));
    assert_eq!(listed["workers"].as_array().unwrap().len(), 2);
    let by_id = |id: &str| {
        listed["workers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|w| w["dispatchId"] == json!(id))
            .unwrap()
            .clone()
    };
    let failed = by_id("d-failed");
    assert!(failed["terminalState"].is_null());
    assert!(failed["resource"].is_null());
    assert!(failed["agentTerminalHandle"].is_null());
    assert_eq!(failed["workerState"], json!("failed"));
    assert_eq!(failed["dispatchStatus"], json!("failed"));
    let reused = by_id("d-reused");
    assert_eq!(reused["terminalState"], json!("retained"));
    assert_eq!(reused["resource"]["state"], json!("retained"));
    assert_eq!(reused["resource"]["reason"], json!("no_owned_resource"));
    assert_eq!(reused["agentTerminalHandle"], json!("sess-reused"));
    // Counts skip the null-terminal row: only the retained row counts.
    assert_eq!(listed["counts"], json!({"retained": 1}));
    // The null row is still selectable by omitting the filter only: a
    // terminal-state filter never matches it.
    let filtered =
        worker_list_filtered(&engine, "list-seed-f", &host, Some("run-seed"), "retained");
    assert_eq!(filtered["workers"].as_array().unwrap().len(), 1);
    assert_eq!(filtered["counts"], json!({"retained": 1}));
    // Losing one terminal's metadata must not suppress the entire inventory
    // or turn loss of contact into an exit claim.
    let conn = rusqlite::Connection::open(data_dir.path().join(DB_FILE_NAME)).unwrap();
    conn.execute("DELETE FROM sessions WHERE id='sess-reused'", [])
        .unwrap();
    let lost = worker_list(&engine, "list-lost-session", &host, Some("run-seed"));
    assert_eq!(lost["workers"].as_array().unwrap().len(), 2);
    let reused = lost["workers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|w| w["dispatchId"] == "d-reused")
        .unwrap();
    assert_eq!(reused["processVerdict"], "unverifiable");
    assert_eq!(lost["counts"], json!({"retained": 1}));
}

/// Seeded oversize preflight: a stored row larger than the response budget
/// fails honestly with `worker_list_too_large`, never silently truncated.
#[test]
fn worker_list_oversize_rows_fail_with_an_honest_size_error() {
    let data_dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(data_dir.path()).unwrap();
    let host = ok(&engine, "status", "status", json!({}))["hostId"]
        .as_str()
        .unwrap()
        .to_string();
    drop(engine);
    let padding = "x".repeat(600_000);
    let big_json = serde_json::json!({
        "result": {
            "runId": "run-big", "taskId": "task-big", "dispatchId": "d-big",
            "consumerGeneration": 1, "workspaceId": padding,
            "assignmentState": "ready", "readiness": "notObserved",
            "processVerdict": "unverifiable", "sessionIdentity": null,
            "effects": [], "residualResources": [],
        },
        "launch": {"harnessId": "claude"},
        "outcome": null, "report_message_id": null, "report_result": null,
        "cleanup_owned": true,
    });
    let conn = rusqlite::Connection::open(data_dir.path().join(DB_FILE_NAME)).unwrap();
    conn.execute(
        "INSERT INTO orchestration_attempts
           (dispatch_id, host_id, run_id, task_id, is_current, fenced, retry_of, state_json)
         VALUES ('d-big', ?1, 'run-big', 'task-big', 0, 0, NULL, ?2)",
        rusqlite::params![host, serde_json::to_string(&big_json).unwrap()],
    )
    .unwrap();
    drop(conn);
    let engine = Engine::open(data_dir.path()).unwrap();
    let response = call(
        &engine,
        "list-big",
        "orchestration.workerList",
        json!({"contractVersion": 1, "hostId": host, "run": "run-big"}),
    );
    assert!(!response.ok);
    assert_eq!(response.error.unwrap().code, "worker_list_too_large");
}
