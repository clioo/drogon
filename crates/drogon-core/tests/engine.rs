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
fn handle_loss_then_reopen_marks_prior_sessions_unverifiable_and_never_respawns() {
    let dir = tempfile::tempdir().unwrap();
    // The original engine is retained for the whole test on purpose: it is
    // the only exact cleanup path for the fixture child (`session.stop` with
    // the real incarnation — never a name/PID-based kill), so the child does
    // not outlive the test. What this models is a second Engine over the
    // same store finding rows whose in-memory handles it does not have; it
    // is NOT real process death and is not crash-recovery proof. A fixture
    // where the spawning process actually dies remains an open follow-up.
    let original = std::sync::Arc::new(Engine::open(dir.path()).unwrap());
    let workspace_id = register_workspace(&original, dir.path(), "ws-1");
    // Keep the child alive so the poller cannot persist an exit during handle-loss assertions.
    let session = ok(
        &original,
        "session.start",
        "start-1",
        json!({ "workspaceId": workspace_id, "command": "/bin/sh", "args": ["-c", "sleep 30"] }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();
    let _guard = SessionGuard {
        engine: original.clone(),
        session_id: session_id.clone(),
        incarnation: incarnation.clone(),
    };

    // A second Engine over the same store has no access to `original`'s
    // in-memory handle; opening it runs the prior-instance sweep.
    let restarted = Engine::open(dir.path()).unwrap();
    let list = ok(&restarted, "session.list", "list-1", json!({}));
    let row = list["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == session_id)
        .expect("prior session row must survive the restart");
    assert_eq!(row["verdict"], "unverifiable");

    // Read/write/resize must refuse to act without a retained handle.
    let read_code = err_code(
        &restarted,
        "session.read",
        "read-1",
        json!({ "sessionId": session_id, "incarnation": incarnation, "cursor": 0 }),
    );
    assert_eq!(read_code, "unverifiable");

    // Stop is allowed to report the known state without erroring, but must
    // not claim a new spawn or a fabricated exit.
    let stopped = ok(
        &restarted,
        "session.stop",
        "stop-1",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    );
    assert_eq!(stopped["verdict"], "unverifiable");

    // Exact fixture cleanup through the retained original handle: the
    // fixture child is killed and reaped via its own session identity, so
    // nothing is left running after the test.
    let cleaned = ok(
        &original,
        "session.stop",
        "fixture-cleanup",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    );
    assert_eq!(
        cleaned["verdict"], "exited",
        "fixture child must be cleaned up exactly through the retained handle"
    );
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

#[test]
fn unknown_session_ids_are_not_found_while_recovered_ones_are_unverifiable() {
    // Regression for: a session id that never existed got the same
    // `unverifiable` answer as a real prior-instance session whose handle is
    // gone, and only `session.stop` checked the incarnation on that path.
    let dir = tempfile::tempdir().unwrap();
    // Retained for the whole test: the exact cleanup path for the fixture
    // child (`session.stop` with the real incarnation), so the child does
    // not outlive the test. The second Engine below has no access to this
    // engine's in-memory handles; that is the prior-instance model here,
    // not real process death.
    let original = std::sync::Arc::new(Engine::open(dir.path()).unwrap());
    let workspace_id = register_workspace(&original, dir.path(), "ws-1");
    let session = ok(
        &original,
        "session.start",
        "start-1",
        json!({ "workspaceId": workspace_id, "command": "/bin/sh", "args": ["-c", "sleep 30"] }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();
    let _guard = SessionGuard {
        engine: original.clone(),
        session_id: session_id.clone(),
        incarnation: incarnation.clone(),
    };

    // Sweeps the row to `unverifiable`: this engine holds no handle for it.
    let engine = Engine::open(dir.path()).unwrap();

    for method in [
        "session.read",
        "session.write",
        "session.resize",
        "session.stop",
    ] {
        let params = match method {
            "session.write" => json!({
                "sessionId": "never-existed", "incarnation": "inc", "dataBase64": "aGk="
            }),
            "session.resize" => json!({
                "sessionId": "never-existed", "incarnation": "inc", "cols": 80, "rows": 24
            }),
            "session.read" => json!({
                "sessionId": "never-existed", "incarnation": "inc", "cursor": 0
            }),
            _ => json!({ "sessionId": "never-existed", "incarnation": "inc" }),
        };
        assert_eq!(
            err_code(&engine, method, &format!("missing-{method}"), params),
            "not_found",
            "a never-existing session id must be not_found for {method}"
        );
    }

    // Prior-instance row with the correct incarnation: unverifiable.
    assert_eq!(
        err_code(
            &engine,
            "session.read",
            "recovered-read",
            json!({ "sessionId": session_id, "incarnation": incarnation, "cursor": 0 }),
        ),
        "unverifiable"
    );

    // Prior-instance row with a wrong incarnation: stale_incarnation,
    // consistently across methods.
    for method in [
        "session.read",
        "session.write",
        "session.resize",
        "session.stop",
    ] {
        let params = match method {
            "session.write" => json!({
                "sessionId": session_id, "incarnation": "wrong", "dataBase64": "aGk="
            }),
            "session.resize" => json!({
                "sessionId": session_id, "incarnation": "wrong", "cols": 80, "rows": 24
            }),
            "session.read" => json!({
                "sessionId": session_id, "incarnation": "wrong", "cursor": 0
            }),
            _ => json!({ "sessionId": session_id, "incarnation": "wrong" }),
        };
        assert_eq!(
            err_code(&engine, method, &format!("stale-{method}"), params),
            "stale_incarnation",
            "wrong incarnation must be stale_incarnation for {method}"
        );
    }

    // Exact fixture cleanup through the retained original handle: the
    // fixture child is killed and reaped via its own session identity, so
    // nothing is left running after the test.
    let cleaned = ok(
        &original,
        "session.stop",
        "fixture-cleanup",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    );
    assert_eq!(
        cleaned["verdict"], "exited",
        "fixture child must be cleaned up exactly through the retained handle"
    );
}

#[test]
fn child_environment_is_stripped_of_runtime_control_context() {
    // Regression for: inherited ORCA_* was stripped, but this runtime's own
    // DROGON_* authority (notably DROGON_DATA_DIR) leaked into every child,
    // letting a harness agent accidentally target the spawning service.
    //
    // The probe runs in an owned subprocess — this same test binary,
    // re-invoked into the isolated `#[ignore]` entry below — whose
    // environment is configured here, entirely before spawn: two
    // control-context canaries the PTY child must NOT see (`ORCA_*`,
    // `DROGON_*`) and one benign inherited canary it must still see. The
    // test process's own environment is never mutated, so no concurrently
    // running test can ever observe a forged one.
    let exe = std::env::current_exe().expect("current test binary path");
    let mut command = std::process::Command::new(exe);
    command.args([
        "--exact",
        "child_environment_probe_entry",
        "--ignored",
        "--nocapture",
    ]);
    command.env_clear();
    command.env("PROBE_CHILD_MODE", "1");
    command.env("ORCA_TEST_CONTROL", "orca-leak-canary");
    command.env("DROGON_DATA_DIR", "/tmp/drogon-should-not-inherit");
    // Not a control variable: the PTY child must inherit it unchanged.
    command.env("PROBE_KEEP_ME", "inherited-canary");
    command.env("PATH", std::env::var("PATH").unwrap_or_default());
    command.env("TMPDIR", std::env::temp_dir());
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut probe = command.spawn().expect("spawn isolated probe subprocess");

    // Bounded completion on the exact owned handle. If the deadline passes,
    // this exact child is killed — never a shared-name or PID search.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    let status = loop {
        match probe.try_wait().expect("probe subprocess state") {
            Some(status) => break status,
            None => {
                if std::time::Instant::now() >= deadline {
                    let _ = probe.kill();
                    let _ = probe.wait();
                    panic!("probe subprocess exceeded its completion deadline");
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        }
    };
    // The probe prints only a few bytes, so reading after exit cannot block
    // on a full pipe.
    use std::io::Read as _;
    let mut stdout = String::new();
    probe
        .stdout
        .take()
        .expect("piped stdout")
        .read_to_string(&mut stdout)
        .expect("read probe stdout");

    assert!(
        status.success(),
        "probe subprocess failed ({status}); stdout:\n{stdout}"
    );
    assert!(
        stdout.contains("PROBE keep=inherited-canary"),
        "a benign inherited value must survive into the PTY child: {stdout:?}"
    );
    assert!(
        stdout.contains("orca=unset") && stdout.contains("drogon=unset"),
        "runtime control context leaked into the PTY child: {stdout:?}"
    );
}

/// Isolated entry point re-invoked as an owned subprocess by
/// `child_environment_is_stripped_of_runtime_control_context`. Ignored so
/// ordinary test runs (including `cargo test -- --ignored` without the
/// marker) never execute the probe outside its explicit environment.
#[test]
#[ignore = "probe entry: only run via the exact re-invocation with PROBE_CHILD_MODE=1"]
fn child_environment_probe_entry() {
    if std::env::var("PROBE_CHILD_MODE").as_deref() != Ok("1") {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_id = register_workspace(&engine, dir.path(), "ws-1");
    let probe = "printf 'PROBE keep=%s orca=%s drogon=%s' \"${PROBE_KEEP_ME:-unset}\" \"${ORCA_TEST_CONTROL:-unset}\" \"${DROGON_DATA_DIR:-unset}\"";
    let session = ok(
        &engine,
        "session.start",
        "start-1",
        json!({
            "workspaceId": workspace_id,
            "command": "/bin/sh",
            "args": ["-c", probe.to_string()],
        }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    let mut output = String::new();
    while std::time::Instant::now() < deadline {
        output = read_output(&engine, &session_id, &incarnation);
        if output.contains("PROBE keep=") {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    // Exact cleanup of the fixture child through its own session handle.
    let _ = ok(
        &engine,
        "session.stop",
        "fixture-cleanup",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    );
    println!("{output}");
    assert!(
        output.contains("PROBE keep="),
        "probe shell never produced its verdict: {output:?}"
    );
}

fn read_output(engine: &Engine, session_id: &str, incarnation: &str) -> String {
    let read = ok(
        engine,
        "session.read",
        "probe-read",
        json!({ "sessionId": session_id, "incarnation": incarnation, "cursor": 0 }),
    );
    let encoded = read["dataBase64"].as_str().unwrap_or("");
    String::from_utf8_lossy(&base64_decode(encoded)).into_owned()
}

/// Stops the session on drop, so even a failing assertion cleans up the
/// fixture child exactly (via its own session identity, never a name/PID
/// search). An explicit successful stop in the test body makes the later
/// drop a harmless no-op.
struct SessionGuard {
    engine: std::sync::Arc<Engine>,
    session_id: String,
    incarnation: String,
}

impl Drop for SessionGuard {
    fn drop(&mut self) {
        let _ = self.engine.dispatch(req(
            "session.stop",
            "guard-cleanup",
            json!({ "sessionId": self.session_id, "incarnation": self.incarnation }),
        ));
    }
}

#[test]
fn fixture_guard_stops_the_exact_session_during_unwind() {
    let dir = tempfile::tempdir().unwrap();
    let engine = std::sync::Arc::new(Engine::open(dir.path()).unwrap());
    let workspace_id = register_workspace(&engine, dir.path(), "ws-1");
    let session = ok(
        &engine,
        "session.start",
        "start-1",
        json!({ "workspaceId": workspace_id, "command": "/bin/sh", "args": ["-c", "exec sleep 30"] }),
    );
    let guard = SessionGuard {
        engine: engine.clone(),
        session_id: session["id"].as_str().unwrap().to_string(),
        incarnation: session["incarnation"].as_str().unwrap().to_string(),
    };
    let unwind = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        let _guard = guard;
        panic!("intentional fixture assertion failure");
    }));
    assert!(unwind.is_err());
    let read = ok(
        &engine,
        "session.read",
        "read-after-unwind",
        json!({ "sessionId": session["id"], "incarnation": session["incarnation"], "cursor": 0 }),
    );
    assert_eq!(read["session"]["verdict"], "exited");
}

#[test]
fn a_large_write_to_a_stalled_child_does_not_stall_resize() {
    // Reproduction review for: `NativePty` holding the writer and master
    // under one mutex. A write that blocks on a child which never reads
    // (`sleep` never drains its stdin; the kernel tty queue fills) must not
    // serialize master operations — `session.resize` has to stay responsive
    // while that write is still outstanding.
    let dir = tempfile::tempdir().unwrap();
    let engine = std::sync::Arc::new(Engine::open(dir.path()).unwrap());
    let workspace_id = register_workspace(&engine, dir.path(), "ws-1");
    let session = ok(
        &engine,
        "session.start",
        "start-1",
        json!({
            "workspaceId": workspace_id,
            "command": "/bin/sh",
            "args": ["-c", "exec sleep 30"]
        }),
    );
    let session_id = session["id"].as_str().unwrap().to_string();
    let incarnation = session["incarnation"].as_str().unwrap().to_string();
    let guard = SessionGuard {
        engine: engine.clone(),
        session_id: session_id.clone(),
        incarnation: incarnation.clone(),
    };

    // Far larger than any kernel tty queue: once the queue fills, the
    // master-side `write_all` blocks until the (never-reading) child exits.
    let encoded = base64_of(&"x".repeat(1_048_576));

    // Give the freshly spawned child a moment to be established.
    std::thread::sleep(Duration::from_millis(150));

    let (write_tx, write_rx) = std::sync::mpsc::channel();
    {
        let engine = engine.clone();
        let session_id = session_id.clone();
        let incarnation = incarnation.clone();
        std::thread::spawn(move || {
            let response = engine.dispatch(req(
                "session.write",
                "big-write",
                json!({
                    "sessionId": session_id,
                    "incarnation": incarnation,
                    "dataBase64": encoded,
                }),
            ));
            let _ = write_tx.send(response);
        });
    }
    // Let the write enter `write_all` and block on the full queue.
    std::thread::sleep(Duration::from_millis(300));

    let (resize_tx, resize_rx) = std::sync::mpsc::channel();
    {
        let engine = engine.clone();
        let session_id = session_id.clone();
        let incarnation = incarnation.clone();
        std::thread::spawn(move || {
            let response = engine.dispatch(req(
                "session.resize",
                "resize-while-write",
                json!({
                    "sessionId": session_id,
                    "incarnation": incarnation,
                    "cols": 101,
                    "rows": 41
                }),
            ));
            let _ = resize_tx.send(response);
        });
    }
    let resized = resize_rx
        .recv_timeout(Duration::from_secs(3))
        .expect("session.resize must complete while a large write is blocked on a stalled child");
    assert!(
        resized.ok,
        "resize during a blocked write failed: {:?}",
        resized.error
    );
    assert_eq!(resized.result.unwrap()["cols"], 101);

    // Cleanup: stopping the child unblocks (and fails) the outstanding
    // write; both the stop and the write thread must return in bounded
    // time. The explicit stop also makes the guard's drop a no-op.
    let stopped = ok(
        &engine,
        "session.stop",
        "stop-1",
        json!({ "sessionId": session_id, "incarnation": incarnation }),
    );
    assert_eq!(stopped["verdict"], "exited");
    drop(guard);
    let _ = write_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("the blocked write must return once the child is stopped");
}
