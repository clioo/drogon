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

fn start_shell_session(fixture: &Fixture, args: &[&str]) -> Value {
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
            "args": args,
        }),
    )
}

fn start_sleep_session(fixture: &Fixture) -> Value {
    start_shell_session(fixture, &["-c", "exec sleep 30"])
}

fn list_row(fixture: &Fixture, session_id: &str) -> Value {
    let listed = invoke(&fixture.engine, "list", "session.list", json!({}));
    listed["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == session_id)
        .unwrap_or_else(|| panic!("session {session_id} missing from session.list"))
        .clone()
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

/// Reaps this test's `sleep` children however the test ends: an assertion
/// that fires before the close would otherwise leave a live PTY behind,
/// and AGENTS.md makes every test the owner of the processes it starts.
/// Stopping an already-stopped (or already-forgotten) session is a no-op
/// that reports an error nobody is waiting on.
struct StopOnDrop(Vec<std::sync::Arc<crate::session::SessionHandle>>);

impl Drop for StopOnDrop {
    fn drop(&mut self) {
        for handle in &self.0 {
            let _ = crate::session::stop(handle);
        }
    }
}

fn handle_of(fixture: &Fixture, session_id: &str) -> std::sync::Arc<crate::session::SessionHandle> {
    fixture.engine.sessions.lock().unwrap()[session_id].clone()
}

/// A headless `sleep` session with one `automation_runs` row dispatched
/// into it — the shape a bot run or an automation dispatch leaves behind,
/// and the only shape whose completion the exit poller is responsible for.
fn start_dispatched_headless_session(
    fixture: &Fixture,
    run_id: &str,
) -> (Value, std::sync::Arc<crate::session::SessionHandle>) {
    let session = start_sleep_session(fixture);
    let id = session["id"].as_str().unwrap().to_string();
    let handle = handle_of(fixture, &id);
    handle.set_headless();
    let payload = json!({
        "id": run_id,
        "automationId": "auto-1",
        "title": "t",
        "scheduledFor": 1.0,
        "status": "dispatched",
        "trigger": "manual",
        "terminalSessionId": id,
        "sessionIncarnation": session["incarnation"],
        "sessionKind": "terminal",
        "createdAt": 1.0,
    });
    fixture
        .engine
        .db
        .lock()
        .unwrap()
        .execute(
            "INSERT INTO automation_runs (id, automation_id, payload_json) VALUES (?1, ?2, ?3)",
            rusqlite::params![run_id, "auto-1", payload.to_string()],
        )
        .unwrap();
    (session, handle)
}

fn automation_run(fixture: &Fixture, run_id: &str) -> Value {
    let conn = fixture.engine.db.lock().unwrap();
    let text: String = conn
        .query_row(
            "SELECT payload_json FROM automation_runs WHERE id = ?1",
            [run_id],
            |row| row.get(0),
        )
        .unwrap();
    serde_json::from_str(&text).unwrap()
}

/// Waits out one parked cycle and then some for the exit poller to end.
/// Ten seconds is twenty-five parked cycles: long enough that only a
/// poller that never intends to return can reach it.
fn await_exit_poller_end(handle: &crate::session::SessionHandle, label: &str) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while handle.exit_poller_is_live() {
        assert!(
            Instant::now() < deadline,
            "{label}: the exit poller was still running 10s after the record went away — \
             a deleted row can never take its write, so the retry is an immortal thread",
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// The cycle the exit observers are parked on while this file's close
/// tests run, and how long a test waits for a parked observer to pick it
/// up (one default [`CHILD_POLL_INTERVAL`] cycle plus margin).
///
/// `session.close` and the exit poller are two independent observers
/// racing to reap the same child — `stop` looks every 20 ms, the poller
/// every 30 ms — and only the closes `stop` wins reach the
/// delete-before-the-poller's-write ordering this regression is about.
/// Measured against the unfixed code, that is about three closes in a
/// hundred: a test that waits for it is not a regression test. Parking
/// the poller makes the close the certain winner without touching the
/// path it then takes — it still wakes on its own, finds its row gone,
/// and has to end.
const PARKED_POLL_CYCLE: Duration = Duration::from_millis(400);
const PARK_TAKES_EFFECT_AFTER: Duration = Duration::from_millis(100);

/// Issue #694: `session.close` deletes the session row while the exit
/// poller may still be between its reap and its write. The poller's
/// `UPDATE … WHERE id = ?` then matched no row, and the old code slept a
/// second and tried again forever — one stranded thread per close, each
/// pinning a `SessionHandle` and the database `Arc`. Worse, headless
/// completion only ran after a *successful* write, so the automation row
/// the run was dispatched into stayed `dispatched` until a restart filed
/// the outcome as unknown, discarding an exit code this process had
/// already reaped.
#[test]
fn close_does_not_leak_the_exit_poller_or_drop_headless_completion() {
    let fixture = fixture();
    let (first, first_handle) = start_dispatched_headless_session(&fixture, "ar:first");
    let (second, second_handle) = start_dispatched_headless_session(&fixture, "ar:second");
    let _cleanup = StopOnDrop(vec![first_handle.clone(), second_handle.clone()]);
    first_handle.park_exit_poller(PARKED_POLL_CYCLE);
    second_handle.park_exit_poller(PARKED_POLL_CYCLE);
    std::thread::sleep(PARK_TAKES_EFFECT_AFTER);

    let closed = invoke(
        &fixture.engine,
        "close-1",
        "session.close",
        identity(&first),
    );
    assert_eq!(closed["verdict"], "exited");
    let exit_code = closed["exitCode"].clone();
    assert!(exit_code.is_number(), "close reaped no code: {closed}");

    // Read while the poller is still parked: the completion below is the
    // close's own work, not the observer catching up afterwards.
    let settled_by_close = automation_run(&fixture, "ar:first");
    assert_eq!(
        settled_by_close["status"], "completed",
        "the reaped exit IS the headless run's completion; a forgotten session row \
         must not downgrade it to an outcome a restart has to guess",
    );
    assert_eq!(settled_by_close["exitCode"], exit_code);
    assert!(settled_by_close["observedAt"].is_number());

    await_exit_poller_end(&first_handle, "first close");
    // The poller woke, found no row, and advanced the same run rows a
    // second time. Terminal rows are left alone, so the stamp the close
    // wrote is still the one stored.
    assert_eq!(
        automation_run(&fixture, "ar:first"),
        settled_by_close,
        "the poller's second advancement rewrote a run the close had already completed",
    );

    // A second close of another live session settles the same way, so the
    // number of live pollers never grows with the number of closes.
    let closed = invoke(
        &fixture.engine,
        "close-2",
        "session.close",
        identity(&second),
    );
    assert_eq!(closed["verdict"], "exited");
    await_exit_poller_end(&second_handle, "second close");
    assert!(
        !first_handle.exit_poller_is_live(),
        "the first close's poller came back to life",
    );
    let run = automation_run(&fixture, "ar:second");
    assert_eq!(run["status"], "completed");
    assert_eq!(run["exitCode"], closed["exitCode"]);
}

/// `session.stop` must keep the row (issue #694): it is the call that
/// leaves a late persist somewhere to land, which is why only `close` and
/// `forget` ever needed a settle. With the observer parked, `stop` is the
/// only thread that reaps here, and the run row stays `dispatched` after
/// it — advancing a headless run is the exit observer's job, not the
/// signal's. `session.forget` then has to settle that run itself, because
/// the delete it performs is the observer's last chance.
#[test]
fn forget_settles_the_headless_run_that_stop_left_for_the_observer() {
    let fixture = fixture();
    let (session, handle) = start_dispatched_headless_session(&fixture, "ar:forget");
    let _cleanup = StopOnDrop(vec![handle.clone()]);
    let id = session["id"].as_str().unwrap().to_string();
    handle.park_exit_poller(PARKED_POLL_CYCLE);
    std::thread::sleep(PARK_TAKES_EFFECT_AFTER);

    let stopped = invoke(&fixture.engine, "stop", "session.stop", identity(&session));
    assert_eq!(stopped["verdict"], "exited");
    let exit_code = stopped["exitCode"].clone();
    assert!(exit_code.is_number(), "stop reaped no code: {stopped}");
    assert!(
        list_ids(&fixture).contains(&id),
        "stop keeps the record: a late persist still has a row to land on",
    );
    assert_eq!(
        automation_run(&fixture, "ar:forget")["status"],
        "dispatched",
        "the signal is not the completion; the exit observer advances the run",
    );

    let forgotten = invoke(
        &fixture.engine,
        "forget",
        "session.forget",
        identity(&session),
    );
    assert_eq!(forgotten["verdict"], "exited");
    assert!(!list_ids(&fixture).contains(&id));
    let run = automation_run(&fixture, "ar:forget");
    assert_eq!(run["status"], "completed");
    assert_eq!(run["exitCode"], exit_code);

    await_exit_poller_end(&handle, "forget");
}

/// The same race with the close winning by a mile: the row is already gone
/// when the exit happens, which is exactly what the poller sees when a
/// close lands during its sleep. It must end — and it still owes the
/// linked run row the code it reaped, because that row is its own durable
/// record and nothing about a forgotten terminal makes the exit unknown.
#[test]
fn an_exit_observed_after_the_record_was_forgotten_still_ends_the_poller() {
    let fixture = fixture();
    let (session, handle) = start_dispatched_headless_session(&fixture, "ar:forgotten");
    let _cleanup = StopOnDrop(vec![handle.clone()]);
    let id = session["id"].as_str().unwrap().to_string();

    {
        let conn = fixture.engine.db.lock().unwrap();
        crate::session::forget_record(&conn, &id).unwrap();
    }
    fixture.engine.sessions.lock().unwrap().remove(&id);
    // The exit is only observable now, with no row left to write it to.
    let _ = crate::session::stop(&handle);

    await_exit_poller_end(&handle, "forgotten record");
    let run = automation_run(&fixture, "ar:forgotten");
    assert_eq!(run["status"], "completed");
    assert!(run["exitCode"].is_number());
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

/// Issue #333: a shell with a live foreground job must report
/// `hasForegroundChild`, so the desktop can confirm before closing the tab.
/// Two commands defeat the shell's single-command exec optimization, so the
/// leader stays a waiting shell with a live `sleep` child until the job ends.
#[test]
fn list_reports_foreground_child_while_shell_runs_job() {
    let fixture = fixture();
    let session = start_shell_session(&fixture, &["-c", "echo spawned; sleep 30"]);
    let id = session["id"].as_str().unwrap().to_string();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        let row = list_row(&fixture, &id);
        assert_eq!(row["verdict"], "live");
        if row["hasForegroundChild"] == true {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "foreground job never reported as a live child",
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    invoke(&fixture.engine, "stop", "session.stop", identity(&session));
}

/// Issue #333: an idle shell at its prompt is its own foreground group, so
/// closing its tab must not prompt.
#[test]
fn list_reports_no_foreground_child_for_idle_shell() {
    let fixture = fixture();
    let session = start_shell_session(&fixture, &[]);
    let id = session["id"].as_str().unwrap().to_string();
    std::thread::sleep(std::time::Duration::from_millis(300));
    let row = list_row(&fixture, &id);
    assert_eq!(row["verdict"], "live");
    assert_eq!(
        row["hasForegroundChild"], false,
        "an idle prompt has no foreground child",
    );
    invoke(&fixture.engine, "stop", "session.stop", identity(&session));
}

/// Issue #333: the busy flag is a live-session fact only — a stopped session
/// reports `exited` with no foreground child, so a confirmed close never
/// re-prompts on an already-dead tab.
#[test]
fn exited_session_reports_no_foreground_child() {
    let fixture = fixture();
    let session = start_shell_session(&fixture, &["-c", "echo spawned; sleep 30"]);
    let id = session["id"].as_str().unwrap().to_string();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        if list_row(&fixture, &id)["hasForegroundChild"] == true {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "foreground job never reported as a live child",
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    invoke(&fixture.engine, "stop", "session.stop", identity(&session));
    let row = list_row(&fixture, &id);
    assert_eq!(row["verdict"], "exited");
    assert_eq!(row["hasForegroundChild"], false);
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
