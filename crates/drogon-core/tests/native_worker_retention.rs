//! `orchestration.workerRetain` through the public engine seams only:
//! `Engine::open` + `with_worker_cli` + `dispatch` against real SQLite and a
//! real (fixture) harness process. No model inference: the fixture `claude`
//! harness exits immediately, and every assertion reads durable state.
//!
//! Covers: retain records `user_requested` with no process effects, including
//! on an active attempt (all native attempts are supervised, so active retain
//! succeeds without stopping); receipt replay and fencing match the other
//! worker verbs; retention survives a daemon reopen; explicit release clears
//! the hold and records `released`; a later retain answers `already_released`;
//! a stale generation is fenced.

#![cfg(unix)]

use drogon_core::{DB_FILE_NAME, Engine};
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use rusqlite::OptionalExtension;
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

fn retention_row(data_dir: &std::path::Path, dispatch_id: &str) -> Option<(String, String)> {
    let conn = rusqlite::Connection::open(data_dir.join(DB_FILE_NAME)).unwrap();
    conn.query_row(
        "SELECT state, reason FROM worker_resource_retention WHERE dispatch_id = ?1",
        [dispatch_id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
    )
    .optional()
    .unwrap()
}

#[test]
fn worker_retain_is_durable_replayable_and_cleared_by_release() {
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
            json!({"path": workspace_dir.to_str().unwrap(), "name": "retain-ws"}),
        );
        let workspace_id =
            ok(&engine, "ws-list", "workspace.list", json!({}))["workspaces"][0]["id"]
                .as_str()
                .unwrap()
                .to_string();
        let run = ok(
            &engine,
            "run",
            "orchestration.runCreate",
            json!({"contractVersion": 1, "hostId": host,
                   "objective": "retain probe", "coordinatorId": "coord-test-1"}),
        );
        let run_id = run["run"]["runId"].as_str().unwrap().to_string();
        let task = ok(
            &engine,
            "task",
            "orchestration.taskCreate",
            json!({"contractVersion": 1, "hostId": host, "runId": run_id,
                   "coordinatorId": "coord-test-1", "consumerGeneration": 1,
                   "spec": {"instructions": "retain me", "dependsOn": []}}),
        );
        let task_id = task["task"]["taskId"].as_str().unwrap().to_string();

        // Retain an active assignment without changing its lifecycle.
        let active = ok(
            &engine,
            "start-active",
            "orchestration.workerStart",
            json!({"contractVersion": 1, "hostId": host, "runId": run_id,
                   "coordinatorId": "coord-test-1", "consumerGeneration": 1,
                   "taskId": task_id, "workspaceId": workspace_id,
                   "mode": "fresh",
                   "launch": {"harnessId": "claude", "model": "fixture-model",
                              "permissionMode": "unattended"}}),
        );
        let active_dispatch = active["dispatchId"].as_str().unwrap().to_string();
        let mut retain_params = dispatch_scope(&host, &run_id, 1, &active_dispatch);
        // Source parity: every native attempt is supervised, so retaining an
        // active worker succeeds without stopping it.
        let active_retained = ok(
            &engine,
            "retain-active",
            "orchestration.workerRetain",
            retain_params.clone(),
        );
        assert_eq!(active_retained["disposition"], json!("retained"));
        assert_eq!(active_retained["reason"], json!("user_requested"));
        assert_eq!(active_retained["state"], json!("retained"));
        assert_eq!(active_retained["processAction"], json!("none"));
        assert_eq!(active_retained["archive"], Value::Null);
        assert_eq!(
            retention_row(data_dir.path(), &active_dispatch),
            Some(("retained".to_string(), "user_requested".to_string()))
        );
        ok(
            &engine,
            "stop-active",
            "orchestration.workerStop",
            dispatch_scope(&host, &run_id, 1, &active_dispatch),
        );
        // The hold recorded while active survives the stop.
        assert_eq!(
            retention_row(data_dir.path(), &active_dispatch),
            Some(("retained".to_string(), "user_requested".to_string()))
        );

        // Settle a second attempt for the retain/release flow.
        let task2 = ok(
            &engine,
            "task2",
            "orchestration.taskCreate",
            json!({"contractVersion": 1, "hostId": host, "runId": run_id,
                   "coordinatorId": "coord-test-1", "consumerGeneration": 1,
                   "spec": {"instructions": "retain me twice", "dependsOn": []}}),
        );
        let task2_id = task2["task"]["taskId"].as_str().unwrap().to_string();
        let started = ok(
            &engine,
            "start",
            "orchestration.workerStart",
            json!({"contractVersion": 1, "hostId": host, "runId": run_id,
                   "coordinatorId": "coord-test-1", "consumerGeneration": 1,
                   "taskId": task2_id, "workspaceId": workspace_id,
                   "mode": "fresh",
                   "launch": {"harnessId": "claude", "model": "fixture-model",
                              "permissionMode": "unattended"}}),
        );
        let dispatch_id = started["dispatchId"].as_str().unwrap().to_string();
        ok(
            &engine,
            "stop",
            "orchestration.workerStop",
            dispatch_scope(&host, &run_id, 1, &dispatch_id),
        );
        let before = ok(&engine, "list-before", "session.list", json!({}));
        retain_params = dispatch_scope(&host, &run_id, 1, &dispatch_id);

        // Retain records user_requested and performs no process effects.
        let retained = ok(
            &engine,
            "retain-1",
            "orchestration.workerRetain",
            retain_params.clone(),
        );
        assert_eq!(retained["dispatchId"], json!(dispatch_id));
        assert_eq!(retained["disposition"], json!("retained"));
        assert_eq!(retained["reason"], json!("user_requested"));
        assert_eq!(retained["state"], json!("retained"));
        assert_eq!(retained["processAction"], json!("none"));
        assert_eq!(retained["archive"], Value::Null);
        assert_eq!(
            retention_row(data_dir.path(), &dispatch_id),
            Some(("retained".to_string(), "user_requested".to_string()))
        );
        let after = ok(&engine, "list-after", "session.list", json!({}));
        assert_eq!(before, after, "retain must not touch any session");

        // Same request id replays the identical receipt without a second write.
        let replayed = ok(
            &engine,
            "retain-1",
            "orchestration.workerRetain",
            retain_params.clone(),
        );
        assert_eq!(replayed, retained);

        // A stale generation is fenced, like the other worker verbs.
        let mut stale = retain_params.clone();
        stale["consumerGeneration"] = json!(2);
        assert_eq!(
            call(&engine, "retain-stale", "orchestration.workerRetain", stale)
                .error
                .unwrap()
                .code,
            "consumer_fenced"
        );

        // Retention survives a daemon reopen.
        drop(engine);
        let engine = Engine::open(data_dir.path()).unwrap();
        let retained_again = ok(
            &engine,
            "retain-2",
            "orchestration.workerRetain",
            retain_params.clone(),
        );
        assert_eq!(retained_again["disposition"], json!("retained"));
        assert_eq!(retained_again["reason"], json!("user_requested"));

        // Explicit release clears the hold and records the actual outcome.
        let released = ok(
            &engine,
            "release-1",
            "orchestration.workerRelease",
            retain_params.clone(),
        );
        assert_eq!(released["disposition"], json!("released"));
        assert_eq!(released["state"], json!("released"));
        assert_eq!(released["processAction"], json!("none"));
        assert_eq!(released["archive"], Value::Null);
        assert_eq!(released["processVerdict"], json!("exited"));
        assert_eq!(
            retention_row(data_dir.path(), &dispatch_id),
            Some(("released".to_string(), "released".to_string()))
        );

        // A later retain answers already_released without side effects.
        let again = ok(
            &engine,
            "retain-3",
            "orchestration.workerRetain",
            retain_params.clone(),
        );
        assert_eq!(again["disposition"], json!("released"));
        assert_eq!(again["reason"], json!("already_released"));
        assert_eq!(again["state"], json!("already_released"));
        assert_eq!(again["processAction"], json!("none"));
        assert_eq!(again["archive"], Value::Null);
        drop(engine);
        std::fs::remove_dir_all(&fixture_dir).unwrap();
    });

    unsafe {
        std::env::set_var("PATH", &saved_path);
    }
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

fn show_verdict(engine: &Engine, host: &str, run_id: &str, dispatch_id: &str, id: &str) -> Value {
    let mut params = scope(host, run_id, 1);
    params["dispatchId"] = json!(dispatch_id);
    ok(engine, id, "orchestration.workerShow", params)["processVerdict"].clone()
}

fn wait_for_verdict(
    engine: &Engine,
    host: &str,
    run_id: &str,
    dispatch_id: &str,
    want: &str,
    id_prefix: &str,
) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    let mut n = 0u64;
    loop {
        let verdict = show_verdict(
            engine,
            host,
            run_id,
            dispatch_id,
            &format!("{id_prefix}-{n}"),
        );
        if verdict == json!(want) {
            return;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "worker {dispatch_id} never reached verdict {want} (last {verdict})"
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
        n += 1;
    }
}

/// Read-only liveness probe of one exact PID: only `kill -0` success counts
/// as live; anything else is not liveness evidence.
fn pid_is_live(pid: i32) -> bool {
    std::process::Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn pid_is_gone(pid: i32) -> bool {
    match std::process::Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .output()
    {
        Ok(output) => {
            !output.status.success()
                && String::from_utf8_lossy(&output.stderr)
                    .to_lowercase()
                    .contains("no such process")
        }
        Err(_) => false,
    }
}

fn read_fixture_pid(fixture_dir: &std::path::Path) -> i32 {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        if let Ok(contents) = std::fs::read_to_string(fixture_dir.join("pid-log"))
            && let Some(line) = contents.lines().next()
            && let Ok(pid) = line.trim().parse::<i32>()
        {
            return pid;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "fixture harness never recorded its PID"
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

/// A lingering terminal survives `workerRetain` (LIVE before and after, by
/// both engine verdict and an OS-level `kill -0` on the exact recorded
/// fixture PID), and an explicit `workerRelease` after a settled
/// non-killing abandon actually stops it (engine verdict `exited` plus a
/// proven ESRCH). A panic-safe guard stops the exact owned dispatch and
/// verifies exit before deleting anything; unverifiable teardown keeps the
/// directories and fails loudly instead of burying a live child.
#[test]
fn worker_retain_keeps_live_terminal_and_release_stops_it() {
    let _path = path_guard().lock().unwrap();
    let fixture_dir = tempfile::Builder::new()
        .prefix("dg-retain-live-")
        .tempdir()
        .unwrap()
        .keep();
    // Lingering fixture: records its exact PID, then waits (bounded
    // self-expiry) for the cooperative stop marker. No children of its own:
    // the shell read loop below is all built-in.
    std::fs::write(
        fixture_dir.join("claude"),
        "#!/bin/bash\ndir=${0%/*}\nprintf '%s\\n' \"$$\" >> \"$dir/pid-log\"\ndeadline=$((SECONDS+25))\nwhile [ ! -f \"$dir/stop-marker\" ] && (( SECONDS < deadline )); do\nread -r -t 1 ignored || :\ndone\n",
    )
    .unwrap();
    let cli = fixture_dir.join("probe-cli");
    std::fs::write(&cli, "#!/bin/sh\nexit 0\n").unwrap();
    use std::os::unix::fs::PermissionsExt;
    for path in [fixture_dir.join("claude"), cli.clone()] {
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let saved_path = std::env::var_os("PATH").unwrap_or_default();
    let mut paths = vec![fixture_dir.clone()];
    paths.extend(std::env::split_paths(&saved_path));
    unsafe {
        std::env::set_var("PATH", std::env::join_paths(&paths).unwrap());
    }

    let result = std::panic::catch_unwind(|| {
        let data_dir = tempfile::Builder::new()
            .prefix("dg-retain-live-data-")
            .tempdir()
            .unwrap()
            .keep();
        let workspace_dir = data_dir.join("ws");
        std::fs::create_dir(&workspace_dir).unwrap();
        let engine = Engine::open(&data_dir).unwrap();
        let engine = engine.with_worker_cli(&cli).unwrap();
        let host = ok(&engine, "status", "status", json!({}))["hostId"]
            .as_str()
            .unwrap()
            .to_string();
        ok(
            &engine,
            "ws",
            "workspace.register",
            json!({"path": workspace_dir.to_str().unwrap(), "name": "retain-live-ws"}),
        );
        let workspace_id =
            ok(&engine, "ws-list", "workspace.list", json!({}))["workspaces"][0]["id"]
                .as_str()
                .unwrap()
                .to_string();
        let run = ok(
            &engine,
            "run",
            "orchestration.runCreate",
            json!({"contractVersion": 1, "hostId": host,
                   "objective": "retain live probe", "coordinatorId": "coord-test-1"}),
        );
        let run_id = run["run"]["runId"].as_str().unwrap().to_string();
        let task = ok(
            &engine,
            "task",
            "orchestration.taskCreate",
            json!({"contractVersion": 1, "hostId": host, "runId": run_id,
                   "coordinatorId": "coord-test-1", "consumerGeneration": 1,
                   "spec": {"instructions": "linger", "dependsOn": []}}),
        );
        let task_id = task["task"]["taskId"].as_str().unwrap().to_string();
        let started = ok(
            &engine,
            "start",
            "orchestration.workerStart",
            json!({"contractVersion": 1, "hostId": host, "runId": run_id,
                   "coordinatorId": "coord-test-1", "consumerGeneration": 1,
                   "taskId": task_id, "workspaceId": workspace_id,
                   "mode": "fresh",
                   "launch": {"harnessId": "claude", "model": "fixture-model",
                              "permissionMode": "unattended"}}),
        );
        let dispatch_id = started["dispatchId"].as_str().unwrap().to_string();
        let scope_params = || dispatch_scope(&host, &run_id, 1, &dispatch_id);

        // LIVE before retain: engine verdict plus OS-level proof on the
        // exact recorded fixture PID — never assignment state alone.
        wait_for_verdict(&engine, &host, &run_id, &dispatch_id, "live", "wait-live");
        let pid = read_fixture_pid(&fixture_dir);
        assert!(pid_is_live(pid), "fixture pid {pid} must be provably live");

        // Retain records the hold with no process effects on the active
        // (supervised) attempt.
        let retained = ok(
            &engine,
            "retain-live",
            "orchestration.workerRetain",
            scope_params(),
        );
        assert_eq!(retained["disposition"], json!("retained"));
        assert_eq!(retained["processAction"], json!("none"));
        assert_eq!(
            show_verdict(&engine, &host, &run_id, &dispatch_id, "show-after-retain"),
            json!("live"),
            "retain must not disturb the live terminal"
        );
        assert!(
            pid_is_live(pid),
            "fixture pid {pid} must still be provably live after retain"
        );

        // Settle without killing: abandon never signals, so the child keeps
        // running and the attempt becomes releasable.
        let abandoned = ok(
            &engine,
            "abandon",
            "orchestration.workerAbandon",
            scope_params(),
        );
        assert_eq!(abandoned["assignmentState"], json!("abandoned"));
        assert!(
            pid_is_live(pid),
            "abandoned fixture pid {pid} must still run before release"
        );

        // Explicit release performs a real process action and stops it.
        let released = ok(
            &engine,
            "release-live",
            "orchestration.workerRelease",
            scope_params(),
        );
        assert_eq!(released["disposition"], json!("released"));
        assert_ne!(
            released["processAction"],
            json!("none"),
            "release of a live owned terminal must act: {released}"
        );
        wait_for_verdict(
            &engine,
            &host,
            &run_id,
            &dispatch_id,
            "exited",
            "wait-exited",
        );
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            if pid_is_gone(pid) {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "released fixture pid {pid} never proved its exit"
            );
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        // Repeat release and a later retain both answer already_released.
        let released_again = ok(
            &engine,
            "release-again",
            "orchestration.workerRelease",
            scope_params(),
        );
        assert_eq!(released_again["disposition"], json!("released"));
        assert_eq!(released_again["state"], json!("already_released"));
        assert_eq!(released_again["processAction"], json!("none"));
        let retained_after = ok(
            &engine,
            "retain-after-release",
            "orchestration.workerRetain",
            scope_params(),
        );
        assert_eq!(retained_after["disposition"], json!("released"));
        assert_eq!(retained_after["reason"], json!("already_released"));
        assert_eq!(retained_after["state"], json!("already_released"));
        assert_eq!(retained_after["processAction"], json!("none"));

        // Teardown: stop the exact owned dispatch (idempotent after
        // release), publish the cooperative marker, and prove exit before
        // deleting anything.
        let _ = call(
            &engine,
            "stop-tail",
            "orchestration.workerStop",
            scope_params(),
        );
        std::fs::write(fixture_dir.join("stop-marker"), b"stop\n").unwrap();
        drop(engine);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            if pid_is_gone(pid) {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "owned fixture pid {pid} exit unverifiable; dirs preserved at {} and {}",
                fixture_dir.display(),
                data_dir.display()
            );
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        std::fs::remove_dir_all(&fixture_dir).unwrap();
        std::fs::remove_dir_all(&data_dir).unwrap();
    });

    unsafe {
        std::env::set_var("PATH", &saved_path);
    }
    if let Err(payload) = result {
        // Panic path: stop the exact owned dispatch only if the engine is
        // still reachable is impossible here, so publish the cooperative
        // marker and verify exit before deleting; otherwise keep everything.
        let _ = std::fs::write(fixture_dir.join("stop-marker"), b"stop\n");
        let pid = std::fs::read_to_string(fixture_dir.join("pid-log"))
            .ok()
            .and_then(|contents| {
                contents
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .parse::<i32>()
                    .ok()
            });
        // A missing PID log is missing evidence, not proof that no child launched.
        let mut exited = false;
        if let Some(pid) = pid {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
            while std::time::Instant::now() < deadline {
                if pid_is_gone(pid) {
                    exited = true;
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
        if exited {
            let _ = std::fs::remove_dir_all(&fixture_dir);
        } else {
            eprintln!(
                "retain-live teardown unverifiable; fixtures preserved at {}",
                fixture_dir.display()
            );
        }
        std::panic::resume_unwind(payload);
    }
}

/// Retain's atomic receipt through the real engine: a fenced (stale
/// generation) retain records no row, and replaying a saved request id with
/// different params conflicts without changing the recorded hold.
#[test]
fn worker_retain_receipt_is_atomic_and_failures_leave_no_row() {
    let _path = path_guard().lock().unwrap();
    let fixture_dir = tempfile::Builder::new()
        .prefix("dg-retain-atomic-")
        .tempdir()
        .unwrap()
        .keep();
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
            json!({"path": workspace_dir.to_str().unwrap(), "name": "retain-atomic-ws"}),
        );
        let workspace_id =
            ok(&engine, "ws-list", "workspace.list", json!({}))["workspaces"][0]["id"]
                .as_str()
                .unwrap()
                .to_string();
        let run = ok(
            &engine,
            "run",
            "orchestration.runCreate",
            json!({"contractVersion": 1, "hostId": host,
                   "objective": "retain atomic probe", "coordinatorId": "coord-test-1"}),
        );
        let run_id = run["run"]["runId"].as_str().unwrap().to_string();
        let task = ok(
            &engine,
            "task",
            "orchestration.taskCreate",
            json!({"contractVersion": 1, "hostId": host, "runId": run_id,
                   "coordinatorId": "coord-test-1", "consumerGeneration": 1,
                   "spec": {"instructions": "atomic", "dependsOn": []}}),
        );
        let task_id = task["task"]["taskId"].as_str().unwrap().to_string();
        let started = ok(
            &engine,
            "start",
            "orchestration.workerStart",
            json!({"contractVersion": 1, "hostId": host, "runId": run_id,
                   "coordinatorId": "coord-test-1", "consumerGeneration": 1,
                   "taskId": task_id, "workspaceId": workspace_id,
                   "mode": "fresh",
                   "launch": {"harnessId": "claude", "model": "fixture-model",
                              "permissionMode": "unattended"}}),
        );
        let dispatch_id = started["dispatchId"].as_str().unwrap().to_string();
        ok(
            &engine,
            "stop",
            "orchestration.workerStop",
            dispatch_scope(&host, &run_id, 1, &dispatch_id),
        );
        let params = dispatch_scope(&host, &run_id, 1, &dispatch_id);

        // A fenced retain fails before any write: no row survives it.
        let mut stale = params.clone();
        stale["consumerGeneration"] = json!(2);
        assert_eq!(
            call(&engine, "retain-stale", "orchestration.workerRetain", stale)
                .error
                .unwrap()
                .code,
            "consumer_fenced"
        );
        assert_eq!(retention_row(data_dir.path(), &dispatch_id), None);

        let conn = rusqlite::Connection::open(data_dir.path().join(DB_FILE_NAME)).unwrap();
        conn.execute_batch("CREATE TRIGGER ignore_retention BEFORE INSERT ON worker_resource_retention BEGIN SELECT RAISE(IGNORE); END;").unwrap();
        let ignored = call(
            &engine,
            "ignored-retain",
            "orchestration.workerRetain",
            params.clone(),
        );
        assert!(!ignored.ok, "an ignored write cannot acknowledge retention");
        assert_eq!(retention_row(data_dir.path(), &dispatch_id), None);
        conn.execute_batch("DROP TRIGGER ignore_retention;")
            .unwrap();
        // A real retain records the hold.
        let retained = ok(
            &engine,
            "retain-1",
            "orchestration.workerRetain",
            params.clone(),
        );
        assert_eq!(retained["disposition"], json!("retained"));

        // Keep the real dispatch identity so admission reaches the fingerprint check.
        let mut conflict = params.clone();
        conflict["futureHint"] = json!("different intent");
        let conflicted = call(&engine, "retain-1", "orchestration.workerRetain", conflict);
        assert_eq!(conflicted.error.unwrap().code, "request_conflict");
        assert_eq!(
            retention_row(data_dir.path(), &dispatch_id),
            Some(("retained".to_string(), "user_requested".to_string())),
            "conflicting replay must roll back without touching the hold"
        );
        assert_eq!(retention_row(data_dir.path(), "some-other-dispatch"), None);

        drop(engine);
        std::fs::remove_dir_all(&fixture_dir).unwrap();
    });

    unsafe {
        std::env::set_var("PATH", &saved_path);
    }
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}
