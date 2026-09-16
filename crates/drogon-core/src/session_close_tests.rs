//! R16-AL2 (issue #228): `session.close` / `session.forget` — the
//! user-initiated teardown paths that must work on exited records AND on
//! prior-instance `unverifiable` stubs, which `session.stop` can only
//! report about. The liveness rule pins the honest verdicts: a forgotten
//! stub answers `unverifiable` (loss of contact is never rewritten as
//! exit), a stopped live session answers `exited` with its code.

#![cfg(unix)]

use crate::{Engine, PROTOCOL_VERSION};
use drogon_protocol::Request;
use serde_json::{Value, json};
use std::time::{Duration, Instant};

struct Fixture {
    dir: tempfile::TempDir,
    engine: Engine,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    Fixture { dir, engine }
}

fn invoke(engine: &Engine, id: &str, method: &str, params: Value) -> Value {
    let response = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    });
    assert!(response.ok, "{:?}", response.error);
    response.result.unwrap()
}

fn invoke_err(engine: &Engine, id: &str, method: &str, params: Value) -> String {
    let response = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    });
    assert!(!response.ok, "expected an error for {method}");
    response.error.unwrap().code
}

fn start_sleep_session(fixture: &Fixture) -> Value {
    let workspace = invoke(
        &fixture.engine,
        "workspace",
        "workspace.register",
        json!({"path": fixture.dir.path()}),
    );
    // Unique request id per call: the mutation ledger dedupes by it, and a
    // replayed `session.start` would resurrect the first session's result.
    static NONCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let id = format!(
        "start-{}",
        NONCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    );
    invoke(
        &fixture.engine,
        &id,
        "session.start",
        json!({
            "workspaceId": workspace["id"],
            "command": "/bin/sh",
            "args": ["-c", "exec sleep 30"],
        }),
    )
}

fn list_ids(fixture: &Fixture) -> Vec<String> {
    let listed = invoke(&fixture.engine, "list", "session.list", json!({}));
    listed["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_string())
        .collect()
}

fn identity(session: &Value) -> Value {
    json!({
        "sessionId": session["id"],
        "incarnation": session["incarnation"],
    })
}

fn stored_verdict(fixture: &Fixture, id: &str) -> String {
    fixture
        .engine
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT verdict FROM sessions WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .expect("stub row")
}

/// Pins the simulated post-restart stub row at `unverifiable` and proves no
/// late write is still in flight before the caller reads it. The killed
/// child's detached exit poller performs one final unconditional
/// `UPDATE sessions SET verdict = 'exited'` after `stop()` returns; under
/// load that write can land after the stub UPDATE, so a single UPDATE
/// followed by an immediate `close` races (issue #371: the stored `exited`
/// was honestly reported, failing the `unverifiable` assertion). The poller
/// returns right after that single write, so re-applying the UPDATE
/// converges: at most one overwrite can ever follow, and a continuous
/// stability window with no flip proves none remains before `close` reads.
fn pin_stub_row_unverifiable(fixture: &Fixture, id: &str) {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        fixture
            .engine
            .db
            .lock()
            .unwrap()
            .execute(
                "UPDATE sessions SET verdict = 'unverifiable', exit_code = NULL WHERE id = ?1",
                rusqlite::params![id],
            )
            .unwrap();
        let stable_until = Instant::now() + Duration::from_secs(2);
        let mut overwritten = false;
        while Instant::now() < stable_until {
            if stored_verdict(fixture, id) != "unverifiable" {
                overwritten = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        if !overwritten {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "stub row never stabilized at unverifiable for {id}"
        );
    }
}

#[test]
fn close_stops_live_session_and_forgets_record() {
    let fixture = fixture();
    let session = start_sleep_session(&fixture);
    let closed = invoke(
        &fixture.engine,
        "close",
        "session.close",
        identity(&session),
    );
    assert_eq!(closed["id"], session["id"]);
    assert_eq!(closed["verdict"], "exited");
    assert!(closed["exitCode"].is_number());
    assert!(
        !list_ids(&fixture).contains(&session["id"].as_str().unwrap().to_string()),
        "a confirmed close forgets the record: the tab must not resurrect",
    );
    assert!(
        !fixture
            .engine
            .sessions
            .lock()
            .unwrap()
            .contains_key(session["id"].as_str().unwrap()),
        "the retained handle is released with the record",
    );
}

#[test]
fn close_of_handleless_stub_forgets_record_with_honest_verdict() {
    let fixture = fixture();
    let session = start_sleep_session(&fixture);
    let id = session["id"].as_str().unwrap().to_string();
    // Simulate the post-restart stub exactly: the exit (if any) was never
    // observed by THIS instance, so the recovery sweep leaves the row
    // `unverifiable`, and no handle exists here.
    let handle = fixture.engine.sessions.lock().unwrap()[&id].clone();
    let _ = crate::session::stop(&handle);
    fixture.engine.sessions.lock().unwrap().remove(&id);
    pin_stub_row_unverifiable(&fixture, &id);
    let closed = invoke(
        &fixture.engine,
        "close",
        "session.close",
        identity(&session),
    );
    assert_eq!(closed["id"], session["id"]);
    assert_eq!(
        closed["verdict"], "unverifiable",
        "loss of contact is never rewritten as exit, even on forget",
    );
    assert!(
        !list_ids(&fixture).contains(&id),
        "the stub record is gone from session.list",
    );
}

#[test]
fn close_of_exited_record_forgets_it() {
    let fixture = fixture();
    let session = start_sleep_session(&fixture);
    invoke(&fixture.engine, "stop", "session.stop", identity(&session));
    let closed = invoke(
        &fixture.engine,
        "close",
        "session.close",
        identity(&session),
    );
    assert_eq!(closed["verdict"], "exited");
    assert!(!list_ids(&fixture).contains(&session["id"].as_str().unwrap().to_string()));
}

#[test]
fn close_enforces_identity() {
    let fixture = fixture();
    let session = start_sleep_session(&fixture);
    assert_eq!(
        invoke_err(
            &fixture.engine,
            "missing",
            "session.close",
            json!({"sessionId": "nope", "incarnation": "nope"}),
        ),
        "not_found",
    );
    assert_eq!(
        invoke_err(
            &fixture.engine,
            "stale",
            "session.close",
            json!({"sessionId": session["id"], "incarnation": "stale"}),
        ),
        "stale_incarnation",
    );
    // Refused closes keep the record.
    assert!(list_ids(&fixture).contains(&session["id"].as_str().unwrap().to_string()));
}

#[test]
fn forget_refuses_a_live_session_but_removes_exited_and_stub_records() {
    let fixture = fixture();
    let live = start_sleep_session(&fixture);
    assert_eq!(
        invoke_err(&fixture.engine, "live", "session.forget", identity(&live),),
        "invalid_argument",
        "forgetting a live session would orphan its PTY",
    );
    assert!(list_ids(&fixture).contains(&live["id"].as_str().unwrap().to_string()));

    // Exited record with a retained handle: forget releases both.
    invoke(&fixture.engine, "stop", "session.stop", identity(&live));
    let forgotten = invoke(
        &fixture.engine,
        "forget-exited",
        "session.forget",
        identity(&live),
    );
    assert_eq!(forgotten["verdict"], "exited");
    assert!(!list_ids(&fixture).contains(&live["id"].as_str().unwrap().to_string()));

    // Prior-instance stub: no handle at all.
    let stub = start_sleep_session(&fixture);
    let stub_id = stub["id"].as_str().unwrap().to_string();
    let handle = fixture.engine.sessions.lock().unwrap()[&stub_id].clone();
    let _ = crate::session::stop(&handle);
    fixture.engine.sessions.lock().unwrap().remove(&stub_id);
    let forgotten = invoke(
        &fixture.engine,
        "forget-stub",
        "session.forget",
        identity(&stub),
    );
    assert_eq!(forgotten["verdict"], "exited");
    assert!(!list_ids(&fixture).contains(&stub_id));
}

#[test]
fn repeated_close_of_forgotten_record_is_not_found() {
    let fixture = fixture();
    let session = start_sleep_session(&fixture);
    invoke(
        &fixture.engine,
        "close",
        "session.close",
        identity(&session),
    );
    assert_eq!(
        invoke_err(
            &fixture.engine,
            "again",
            "session.close",
            identity(&session),
        ),
        "not_found",
    );
}
