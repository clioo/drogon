//! Integration tests against real `portable-pty` child processes and a real
//! SQLite file per test (via `tempfile::tempdir`). Unix-only (`/bin/sh`);
//! Windows PTY behavior is explicitly out of scope for this slice per
//! `protocol-v1.md` and is not claimed working here.
#![cfg(unix)]

use std::thread::sleep;
use std::time::Duration;

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

fn req(method: &str, request_id: &str, params: Value) -> Request {
    serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": request_id,
        "method": method,
        "params": params,
    }))
    .unwrap()
}

fn ok(engine: &Engine, method: &str, request_id: &str, params: Value) -> Value {
    let response = engine.dispatch(req(method, request_id, params));
    assert!(
        response.ok,
        "expected ok for {method}: {:?}",
        response.error
    );
    response.result.unwrap()
}

fn err_code(engine: &Engine, method: &str, request_id: &str, params: Value) -> String {
    let response = engine.dispatch(req(method, request_id, params));
    assert!(
        !response.ok,
        "expected error for {method}, got {:?}",
        response.result
    );
    response.error.unwrap().code
}

fn register_workspace(engine: &Engine, dir: &std::path::Path, request_id: &str) -> String {
    let ws = ok(
        engine,
        "workspace.register",
        request_id,
        json!({ "path": dir.to_string_lossy() }),
    );
    ws["id"].as_str().unwrap().to_string()
}

fn wait_for<F: FnMut() -> bool>(mut pred: F, timeout: Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if pred() {
            return true;
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        sleep(Duration::from_millis(20));
    }
}

#[test]
fn workspace_register_is_idempotent_by_path() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let a = register_workspace(&engine, dir.path(), "req-1");
    let b = register_workspace(&engine, dir.path(), "req-2");
    assert_eq!(a, b, "same canonical path must yield the same workspace id");
    let listed = ok(&engine, "workspace.list", "req-3", json!({}));
    assert_eq!(listed["workspaces"].as_array().unwrap().len(), 1);
}

#[test]
fn real_pty_input_output_resize_and_normal_exit() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine, dir.path(), "ws-1");

    let session = ok(
        &engine,
        "session.start",
        "start-1",
        json!({
            "workspaceId": workspace_id,
            "command": "/bin/sh",
            "args": ["-c", "read line; echo got:$line; exit 7"],
            "cols": 80, "rows": 24
        }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();
    assert_eq!(session["verdict"], "live");
    assert_eq!(session["cols"], 80);

    let resized = ok(
        &engine,
        "session.resize",
        "resize-1",
        json!({ "sessionId": session_id, "incarnation": incarnation, "cols": 100, "rows": 40 }),
    );
    assert_eq!(resized["cols"], 100);
    assert_eq!(resized["rows"], 40);

    let write_result = ok(
        &engine,
        "session.write",
        "write-1",
        json!({
            "sessionId": session_id,
            "incarnation": incarnation,
            "dataBase64": base64_of("hello\n"),
        }),
    );
    assert_eq!(write_result["acceptedBytes"], 6);

    let mut collected = String::new();
    let mut cursor = 0u64;
    let saw_output = wait_for(
        || {
            let read = ok(
                &engine,
                "session.read",
                &format!("read-{cursor}"),
                json!({ "sessionId": session_id, "incarnation": incarnation, "cursor": cursor }),
            );
            let bytes = base64_decode(read["dataBase64"].as_str().unwrap());
            collected.push_str(&String::from_utf8_lossy(&bytes));
            cursor = read["nextCursor"].as_u64().unwrap();
            collected.contains("got:hello")
        },
        Duration::from_secs(5),
    );
    assert!(saw_output, "expected echoed output, got: {collected:?}");

    let exited = wait_for(
        || {
            let stopped = ok(
                &engine,
                "session.stop",
                "stop-check",
                json!({ "sessionId": session_id, "incarnation": incarnation }),
            );
            stopped["verdict"] == "exited"
        },
        Duration::from_secs(5),
    );
    assert!(exited, "shell should have exited normally after `exit 7`");

    let final_state = ok(
        &engine,
        "session.stop",
        "stop-final",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    );
    assert_eq!(final_state["verdict"], "exited");
    assert_eq!(final_state["exitCode"], 7);
}

#[test]
fn two_sessions_cancellation_is_isolated() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine, dir.path(), "ws-1");

    let a = ok(
        &engine,
        "session.start",
        "start-a",
        json!({ "workspaceId": workspace_id, "command": "/bin/sh", "args": ["-c", "sleep 30"] }),
    );
    let b = ok(
        &engine,
        "session.start",
        "start-b",
        json!({ "workspaceId": workspace_id, "command": "/bin/sh", "args": ["-c", "sleep 30"] }),
    );
    let (a_id, a_inc) = (
        a["id"].as_str().unwrap().to_string(),
        a["incarnation"].as_str().unwrap().to_string(),
    );
    let (b_id, b_inc) = (
        b["id"].as_str().unwrap().to_string(),
        b["incarnation"].as_str().unwrap().to_string(),
    );
    assert_ne!(a_id, b_id);

    let stop_a = ok(
        &engine,
        "session.stop",
        "stop-a",
        json!({ "sessionId": a_id, "incarnation": a_inc }),
    );
    assert_eq!(
        stop_a["verdict"], "exited",
        "killed session must be confirmed exited"
    );

    // Session B must be completely unaffected by A's cancellation.
    let list = ok(&engine, "session.list", "list-1", json!({}));
    let sessions = list["sessions"].as_array().unwrap();
    let b_row = sessions.iter().find(|s| s["id"] == b_id).unwrap();
    assert_eq!(b_row["verdict"], "live", "unrelated session must stay live");

    let ping = ok(
        &engine,
        "session.resize",
        "resize-b",
        json!({ "sessionId": b_id, "incarnation": b_inc, "cols": 90, "rows": 30 }),
    );
    assert_eq!(ping["verdict"], "live");

    let stop_b = ok(
        &engine,
        "session.stop",
        "stop-b",
        json!({ "sessionId": b_id, "incarnation": b_inc }),
    );
    assert_eq!(stop_b["verdict"], "exited");
}

#[test]
fn stale_incarnation_is_rejected_for_every_mutating_method() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine, dir.path(), "ws-1");
    let session = ok(
        &engine,
        "session.start",
        "start-1",
        json!({ "workspaceId": workspace_id, "command": "/bin/sh", "args": ["-c", "sleep 5"] }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let wrong = "00000000-0000-0000-0000-000000000000";

    for (method, params) in [
        (
            "session.read",
            json!({ "sessionId": session_id, "incarnation": wrong, "cursor": 0 }),
        ),
        (
            "session.write",
            json!({ "sessionId": session_id, "incarnation": wrong, "dataBase64": base64_of("x") }),
        ),
        (
            "session.resize",
            json!({ "sessionId": session_id, "incarnation": wrong, "cols": 80, "rows": 24 }),
        ),
        (
            "session.stop",
            json!({ "sessionId": session_id, "incarnation": wrong }),
        ),
    ] {
        let code = err_code(&engine, method, &format!("stale-{method}"), params);
        assert_eq!(
            code, "stale_incarnation",
            "method {method} must reject a stale incarnation"
        );
    }

    // Clean up the still-live session so the test process does not leak it.
    let real_incarnation = session["incarnation"].as_str().unwrap();
    ok(
        &engine,
        "session.stop",
        "cleanup",
        json!({ "sessionId": session_id, "incarnation": real_incarnation }),
    );
}

#[test]
fn duplicate_request_id_returns_cached_result_without_a_second_spawn() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine, dir.path(), "ws-1");
    let params =
        json!({ "workspaceId": workspace_id, "command": "/bin/sh", "args": ["-c", "sleep 5"] });

    let first = ok(&engine, "session.start", "dup-1", params.clone());
    let second = ok(&engine, "session.start", "dup-1", params.clone());
    assert_eq!(
        first, second,
        "identical replay must return the original result verbatim"
    );

    let list = ok(&engine, "session.list", "list-1", json!({}));
    assert_eq!(
        list["sessions"].as_array().unwrap().len(),
        1,
        "a replayed session.start must not create a second process"
    );

    ok(
        &engine,
        "session.stop",
        "cleanup",
        json!({ "sessionId": first["id"], "incarnation": first["incarnation"] }),
    );
}

#[test]
fn conflicting_reuse_of_a_request_id_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    ok(
        &engine,
        "workspace.register",
        "same-id",
        json!({ "path": dir.path().to_string_lossy() }),
    );
    let other_dir = tempfile::tempdir().unwrap();
    let code = err_code(
        &engine,
        "workspace.register",
        "same-id",
        json!({ "path": other_dir.path().to_string_lossy() }),
    );
    assert_eq!(code, "request_conflict");
}

#[test]
fn future_cursor_is_invalid_argument() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine, dir.path(), "ws-1");
    let session = ok(
        &engine,
        "session.start",
        "start-1",
        json!({ "workspaceId": workspace_id, "command": "/bin/sh", "args": ["-c", "sleep 5"] }),
    );
    let code = err_code(
        &engine,
        "session.read",
        "read-future",
        json!({
            "sessionId": session["id"], "incarnation": session["incarnation"], "cursor": 999_999_999u64
        }),
    );
    assert_eq!(code, "invalid_argument");
    ok(
        &engine,
        "session.stop",
        "cleanup",
        json!({ "sessionId": session["id"], "incarnation": session["incarnation"] }),
    );
}

#[test]
fn crash_then_restart_marks_prior_sessions_unverifiable_and_never_respawns() {
    let dir = tempfile::tempdir().unwrap();
    let session_id;
    let incarnation;
    {
        let engine = Engine::open(dir.path()).unwrap();
        let workspace_id = register_workspace(&engine, dir.path(), "ws-1");
        // Long-lived on purpose: its reader thread must stay blocked in
        // read() for the rest of this test so it cannot race the second
        // Engine's crash-recovery sweep by reaping and persisting a real
        // exit after we have already asserted `unverifiable`.
        let session = ok(
            &engine,
            "session.start",
            "start-1",
            json!({ "workspaceId": workspace_id, "command": "/bin/sh", "args": ["-c", "sleep 30"] }),
        );
        session_id = session["id"].as_str().unwrap().to_string();
        incarnation = session["incarnation"].as_str().unwrap().to_string();
        // Simulates a crash: the Engine (and, in a real service, the whole
        // process) goes away without an orderly session shutdown. The OS
        // process spawned above is deliberately not killed here.
    }

    let engine2 = Engine::open(dir.path()).unwrap();
    let list = ok(&engine2, "session.list", "list-1", json!({}));
    let row = list["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == session_id)
        .expect("prior session row must survive the restart");
    assert_eq!(row["verdict"], "unverifiable");

    // Read/write/resize must refuse to act without a retained handle.
    let read_code = err_code(
        &engine2,
        "session.read",
        "read-1",
        json!({ "sessionId": session_id, "incarnation": incarnation, "cursor": 0 }),
    );
    assert_eq!(read_code, "unverifiable");

    // Stop is allowed to report the known state without erroring, but must
    // not claim a new spawn or a fabricated exit.
    let stopped = ok(
        &engine2,
        "session.stop",
        "stop-1",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    );
    assert_eq!(stopped["verdict"], "unverifiable");
}

#[test]
fn invalid_input_is_rejected_before_any_spawn() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine, dir.path(), "ws-1");

    assert_eq!(
        err_code(
            &engine,
            "session.start",
            "bad-1",
            json!({ "workspaceId": workspace_id, "command": "" })
        ),
        "invalid_argument"
    );
    assert_eq!(
        err_code(
            &engine,
            "session.start",
            "bad-2",
            json!({ "workspaceId": workspace_id, "command": "/bin/sh", "cols": 0 })
        ),
        "invalid_argument"
    );
    assert_eq!(
        err_code(
            &engine,
            "session.start",
            "bad-3",
            json!({ "workspaceId": "does-not-exist", "command": "/bin/sh" })
        ),
        "not_found"
    );
    assert_eq!(
        err_code(&engine, "no.such.method", "bad-4", json!({})),
        "method_not_found"
    );

    let list = ok(&engine, "session.list", "list-1", json!({}));
    assert!(
        list["sessions"].as_array().unwrap().is_empty(),
        "no invalid call may spawn a process"
    );
}

#[test]
fn stop_and_read_do_not_block_when_child_closes_pty_before_exiting() {
    // Regression for: the reader thread's post-EOF reap used to call a
    // blocking `wait()` while holding the same lock `read`/`write`/`stop`
    // need, so a child that closes its own pty fds and keeps running (PTY
    // EOF fires well before the process actually exits) would hang every
    // other request against this session for as long as the child lived.
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine, dir.path(), "ws-1");
    let session = ok(
        &engine,
        "session.start",
        "start-1",
        json!({
            "workspaceId": workspace_id,
            "command": "/bin/sh",
            "args": ["-c", "exec 0<&- 1>&- 2>&-; sleep 2"]
        }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();

    // Let the reader thread observe PTY EOF while the child is still alive.
    sleep(Duration::from_millis(200));

    // Must return promptly — before the fix this would hang for up to the
    // child's remaining ~1.8s while the reader thread sat in `wait()`.
    let read_result = ok(
        &engine,
        "session.read",
        "read-1",
        json!({ "sessionId": session_id, "incarnation": incarnation, "cursor": 0 }),
    );
    let verdict = read_result["session"]["verdict"].as_str().unwrap();
    assert!(
        verdict == "live" || verdict == "exited",
        "unexpected verdict {verdict}"
    );

    let mut attempt = 0u32;
    let stopped = wait_for(
        || {
            attempt += 1;
            let s = ok(
                &engine,
                "session.stop",
                &format!("stop-{attempt}"),
                json!({ "sessionId": session_id, "incarnation": incarnation }),
            );
            s["verdict"] == "exited"
        },
        Duration::from_secs(4),
    );
    assert!(
        stopped,
        "stop must observe the real exit without hanging on the closed-pty child"
    );
}

#[test]
fn stop_preserves_the_session_handle_and_its_retained_output() {
    // Regression for: `stop` used to remove the in-memory handle (and thus
    // drop its ring buffer) the instant exit was confirmed, so a `read`
    // issued right after a normal exit could never see the process's final
    // output — even though the bytes were already sitting in the buffer.
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine, dir.path(), "ws-1");
    let session = ok(
        &engine,
        "session.start",
        "start-1",
        json!({
            "workspaceId": workspace_id,
            "command": "/bin/sh",
            "args": ["-c", "echo final-output; exit 0"]
        }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();

    // Let the shell actually get scheduled and run to its natural `exit 0`
    // before polling `stop` — otherwise `stop`'s own `kill()` can race the
    // freshly-forked child and terminate it by signal before it ever writes
    // "final-output", which is a test-timing hazard, not the behavior under
    // test here.
    sleep(Duration::from_millis(150));

    let mut stop_attempt = 0u32;
    let stopped = wait_for(
        || {
            stop_attempt += 1;
            ok(
                &engine,
                "session.stop",
                &format!("stop-{stop_attempt}"),
                json!({ "sessionId": session_id, "incarnation": incarnation }),
            )["verdict"]
                == "exited"
        },
        Duration::from_secs(3),
    );
    assert!(stopped);

    // The exit status (from a direct waitpid-style check) can be observed
    // slightly before the reader thread finishes draining the pty's output
    // into the ring buffer — they are two independent facts about the same
    // process. Poll the read the same bounded way real clients would.
    let mut read_attempt = 0u32;
    let mut last_read = Value::Null;
    let saw_output = wait_for(
        || {
            read_attempt += 1;
            last_read = ok(
                &engine,
                "session.read",
                &format!("read-{read_attempt}"),
                json!({ "sessionId": session_id, "incarnation": incarnation, "cursor": 0 }),
            );
            let bytes = base64_decode(last_read["dataBase64"].as_str().unwrap());
            String::from_utf8_lossy(&bytes).contains("final-output")
        },
        Duration::from_secs(2),
    );
    assert!(
        saw_output,
        "output retained before exit must still be readable after stop, got {last_read:?}"
    );
    assert_eq!(last_read["session"]["verdict"], "exited");

    // A resize on an already-exited session must be refused, not report a
    // fabricated `live` verdict.
    let resize_code = err_code(
        &engine,
        "session.resize",
        "resize-1",
        json!({ "sessionId": session_id, "incarnation": incarnation, "cols": 100, "rows": 40 }),
    );
    assert_eq!(resize_code, "unverifiable");
}

#[test]
fn present_but_invalid_optional_fields_are_rejected_not_defaulted() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine, dir.path(), "ws-1");
    let session = ok(
        &engine,
        "session.start",
        "start-1",
        json!({ "workspaceId": workspace_id, "command": "/bin/sh", "args": ["-c", "sleep 5"] }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();

    assert_eq!(
        err_code(
            &engine,
            "session.read",
            "bad-cursor",
            json!({ "sessionId": session_id, "incarnation": incarnation, "cursor": "not-a-number" })
        ),
        "invalid_argument",
        "a present, wrongly-typed cursor must error, never silently read from 0"
    );
    assert_eq!(
        err_code(
            &engine,
            "session.read",
            "bad-limit",
            json!({ "sessionId": session_id, "incarnation": incarnation, "cursor": 0, "limitBytes": "lots" })
        ),
        "invalid_argument",
        "a present, wrongly-typed limitBytes must error, never silently fall back to the default"
    );

    // A second, unrelated workspace + session so a broadened (unfiltered)
    // list would be observably different from a correctly-rejected one.
    let other_dir = tempfile::tempdir().unwrap();
    let other_workspace_id = register_workspace(&engine, other_dir.path(), "ws-2");
    ok(
        &engine,
        "session.start",
        "start-2",
        json!({ "workspaceId": other_workspace_id, "command": "/bin/sh", "args": ["-c", "sleep 5"] }),
    );
    assert_eq!(
        err_code(
            &engine,
            "session.list",
            "bad-filter",
            json!({ "workspaceId": 12345 })
        ),
        "invalid_argument",
        "a present, wrongly-typed workspaceId filter must error, never silently broaden to all workspaces"
    );

    ok(
        &engine,
        "session.stop",
        "cleanup-1",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    );
}

#[test]
fn engine_open_refuses_a_symlinked_data_dir() {
    let base = tempfile::tempdir().unwrap();
    let real_dir = base.path().join("real");
    std::fs::create_dir(&real_dir).unwrap();
    let link = base.path().join("link");
    std::os::unix::fs::symlink(&real_dir, &link).unwrap();

    let result = Engine::open(&link);
    assert!(
        result.is_err(),
        "a symlinked data directory must be refused, not silently followed"
    );
}

#[test]
fn a_request_ledger_persistence_failure_gives_leader_and_replay_the_same_unverifiable_answer() {
    // Fault injection: a `BEFORE UPDATE ... WHEN NEW.status = 'done'`
    // trigger deterministically makes `RequestLedger::finish` fail, without
    // needing to fake a disk-full or I/O-error condition.
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap(); // creates the schema
    let workspace_id = register_workspace(&engine, dir.path(), "ws-1");

    {
        let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
        conn.execute_batch(
            "CREATE TRIGGER abort_requests_done
             BEFORE UPDATE OF status ON requests
             WHEN NEW.status = 'done'
             BEGIN SELECT RAISE(ABORT, 'fault-injected persistence failure'); END;",
        )
        .unwrap();
    }

    let leader_code = err_code(
        &engine,
        "session.start",
        "poisoned-1",
        json!({ "workspaceId": workspace_id, "command": "/bin/sh", "args": ["-c", "sleep 5"] }),
    );
    assert_eq!(
        leader_code, "unverifiable",
        "a finish() failure must not be reported as success"
    );

    // The side effect actually happened despite the stuck bookkeeping row —
    // confirm via session.list rather than the (deliberately withheld) result.
    let sessions_after_leader = ok(&engine, "session.list", "list-1", json!({}))["sessions"]
        .as_array()
        .unwrap()
        .len();
    assert_eq!(
        sessions_after_leader, 1,
        "work() must still have run exactly once"
    );

    // A replay of the exact same requestId must get the same answer, and
    // must not spawn a second session.
    let replay_code = err_code(
        &engine,
        "session.start",
        "poisoned-1",
        json!({ "workspaceId": workspace_id, "command": "/bin/sh", "args": ["-c", "sleep 5"] }),
    );
    assert_eq!(
        replay_code, "unverifiable",
        "a replay must get the same outcome as the leader"
    );
    assert_eq!(
        err_code(
            &engine,
            "session.start",
            "poisoned-1",
            json!({"workspaceId": workspace_id, "command": "/bin/sh", "args": ["-c", "echo must-not-run"]})
        ),
        "request_conflict"
    );

    let sessions_after_replay = ok(&engine, "session.list", "list-2", json!({}))["sessions"]
        .as_array()
        .unwrap()
        .len();
    assert_eq!(
        sessions_after_replay, 1,
        "a replay must never repeat the side effect"
    );

    // "Storage recovers": drop the fault so cleanup itself (also a mutating,
    // ledger-routed call) can actually persist its own result.
    {
        let conn = rusqlite::Connection::open(dir.path().join(drogon_core::DB_FILE_NAME)).unwrap();
        conn.execute_batch("DROP TRIGGER abort_requests_done;")
            .unwrap();
    }

    // Clean up the orphaned-but-real session discovered via session.list —
    // its id/incarnation were never returned to any caller because of the
    // poisoned ledger, exactly as a real operator would have to recover.
    let sessions = ok(&engine, "session.list", "list-3", json!({}));
    let orphan = &sessions["sessions"].as_array().unwrap()[0];
    ok(
        &engine,
        "session.stop",
        "cleanup-1",
        json!({ "sessionId": orphan["id"], "incarnation": orphan["incarnation"] }),
    );
}

fn base64_of(text: &str) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(text.as_bytes())
}

fn base64_decode(text: &str) -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(text)
        .unwrap()
}
