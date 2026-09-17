//! PERF-01 push channel (`session.output`) tests: the held long-poll twin
//! of `session.read`.
//!
//! Every test drives real PTY children through `Engine::dispatch` — no
//! threads, no Sync requirements: a child that prints mid-wait proves the
//! held call blocks for bytes (not a spin-return), and a quiet child
//! proves it answers empty only at the deadline. Timing bounds are
//! deliberately generous (seconds, not milliseconds) because the suite
//! runs PTY-heavy tests in parallel on a loaded host; they only fail when
//! the behavior is categorically wrong (immediate return, full-wait
//! timeout, hang).

use std::time::{Duration, Instant};

use drogon_protocol::{PROTOCOL_VERSION, Request};
use serde_json::{Value, json};

use crate::Engine;
use crate::session::base64_decode;

const PUSH_CAPABILITY: &str = "session.output-push.v1";

fn invoke(engine: &Engine, id: &str, method: &str, params: Value) -> Value {
    let response = engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    });
    assert!(response.ok, "{method} failed: {:?}", response.error);
    response.result.unwrap()
}

fn dispatch_raw(engine: &Engine, id: &str, method: &str, params: Value) -> crate::Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    })
}

fn open_engine() -> (tempfile::TempDir, Engine) {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    (dir, engine)
}

fn workspace_id(engine: &Engine) -> String {
    let dir = tempfile::tempdir().unwrap();
    let reply = invoke(
        engine,
        "w",
        "workspace.register",
        json!({ "path": dir.path() }),
    );
    // Keep the dir alive for the test: leak is intentional and bounded (one
    // tempdir per test process lifetime is reclaimed by the OS temp sweep;
    // the workspace row only needs the path to exist at register time).
    std::mem::forget(dir);
    reply["id"].as_str().unwrap().to_string()
}

fn start_shell(
    engine: &Engine,
    workspace: &str,
    command: &str,
    args: Vec<&str>,
) -> (String, String) {
    let session = invoke(
        engine,
        "start",
        "session.start",
        json!({
            "workspaceId": workspace,
            "command": command,
            "args": args,
        }),
    );
    (
        session["id"].as_str().unwrap().to_string(),
        session["incarnation"].as_str().unwrap().to_string(),
    )
}

fn output_params(id: &str, incarnation: &str, cursor: u64, wait_ms: u64) -> Value {
    json!({
        "sessionId": id,
        "incarnation": incarnation,
        "cursor": cursor,
        "waitMs": wait_ms,
    })
}

fn decoded_data(page: &Value) -> Vec<u8> {
    base64_decode(page["dataBase64"].as_str().unwrap()).expect("valid base64 from session.output")
}

#[test]
fn status_advertises_the_push_capability() {
    let (_dir, engine) = open_engine();
    let status = invoke(&engine, "status", "status", json!({}));
    let capabilities = status["capabilities"].as_array().unwrap();
    assert!(
        capabilities.iter().any(|c| c == PUSH_CAPABILITY),
        "status.capabilities must advertise {PUSH_CAPABILITY}: {capabilities:?}"
    );
}

#[test]
fn held_output_pushes_a_byte_written_mid_wait() {
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    // The child prints ~2 s after spawn: the held poll below must block for
    // the byte and surface it, not spin-return empty and not sit out the
    // whole 20 s wait.
    let (id, incarnation) = start_shell(
        &engine,
        &workspace,
        "/bin/sh",
        vec!["-c", "sleep 2; printf 'PUSH_TOKEN_42\\n'"],
    );
    let started = Instant::now();
    let page = invoke(
        &engine,
        "poll",
        "session.output",
        output_params(&id, &incarnation, 0, 20_000),
    );
    let elapsed = started.elapsed();
    let text = String::from_utf8_lossy(&decoded_data(&page)).into_owned();
    assert!(
        text.contains("PUSH_TOKEN_42"),
        "held session.output must surface the mid-wait byte, got {text:?}"
    );
    assert!(
        elapsed >= Duration::from_millis(1_000),
        "the call must have blocked for the byte, not answered instantly ({elapsed:?})"
    );
    assert!(
        elapsed < Duration::from_secs(15),
        "the call must push on the byte, not sit out the 20 s wait ({elapsed:?})"
    );
    // The answer keeps the exact session.read shape: the cursor/page
    // protocol (replay, truncation, verdict truth) rides unchanged.
    assert_eq!(page["startCursor"], 0);
    assert_eq!(page["nextCursor"], decoded_data(&page).len() as u64);
    assert_eq!(page["truncated"], false);
    assert_eq!(page["session"]["id"], id);
}

#[test]
fn quiet_output_waits_out_the_deadline_then_answers_empty() {
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    // `cat` with no input writes nothing: the poll must hold (not
    // spin-return) and answer an empty live page at the deadline — the
    // empty answer doubles as the reconciliation tick (it carries the
    // session verdict).
    let (id, incarnation) = start_shell(&engine, &workspace, "/bin/cat", vec![]);
    let cursor = invoke(
        &engine,
        "read",
        "session.read",
        json!({"sessionId": id, "incarnation": incarnation, "cursor": 0}),
    )["nextCursor"]
        .as_u64()
        .unwrap();
    let started = Instant::now();
    let page = invoke(
        &engine,
        "poll",
        "session.output",
        output_params(&id, &incarnation, cursor, 500),
    );
    let elapsed = started.elapsed();
    assert!(
        decoded_data(&page).is_empty(),
        "quiet session must answer empty"
    );
    assert_eq!(page["session"]["verdict"], "live");
    assert!(
        elapsed >= Duration::from_millis(300),
        "the call must hold the wait, not spin-return ({elapsed:?})"
    );
    assert!(
        elapsed < Duration::from_secs(10),
        "the call must answer at the deadline, not hang ({elapsed:?})"
    );
}

#[test]
fn zero_wait_degrades_to_an_immediate_read() {
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    let (id, incarnation) = start_shell(&engine, &workspace, "/bin/cat", vec![]);
    let started = Instant::now();
    let page = invoke(
        &engine,
        "poll",
        "session.output",
        output_params(&id, &incarnation, 0, 0),
    );
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "zero wait must answer at once"
    );
    assert!(decoded_data(&page).is_empty());
}

#[test]
fn exit_wakes_a_held_poll_with_exit_truth() {
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    // A short sleeper writes nothing and exits ~1 s after spawn: a poll
    // held at the live edge must wake on the observed exit — the pane
    // learns `exited` within a frame of the reap, not at the next wait
    // deadline. (The spawn path itself can leave a few dozen setup bytes
    // in the ring, so drain to the live edge first.)
    let (id, incarnation) = start_shell(&engine, &workspace, "/bin/sh", vec!["-c", "sleep 1"]);
    let drained = invoke(
        &engine,
        "drain",
        "session.output",
        output_params(&id, &incarnation, 0, 0),
    );
    let cursor = drained["nextCursor"].as_u64().unwrap();
    let started = Instant::now();
    let page = invoke(
        &engine,
        "poll",
        "session.output",
        output_params(&id, &incarnation, cursor, 20_000),
    );
    let elapsed = started.elapsed();
    assert_eq!(page["session"]["verdict"], "exited");
    assert!(
        elapsed >= Duration::from_millis(300),
        "the poll must have been held until the exit, not answered instantly ({elapsed:?})"
    );
    assert!(
        elapsed < Duration::from_secs(15),
        "exit must wake the held poll, not the deadline ({elapsed:?})"
    );
}

#[test]
fn burst_drains_in_order_without_drops_or_duplicates() {
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    // Pure-shell counter: ~100 KiB of deterministic output (portable — no
    // `seq` on macOS). The PTY translates \n to \r\n (ONLCR), so expect
    // the translated form.
    let (id, incarnation) = start_shell(
        &engine,
        &workspace,
        "/bin/sh",
        vec![
            "-c",
            "i=1; while [ $i -le 5000 ]; do echo \"line-$i\"; i=$((i+1)); done",
        ],
    );
    let mut expected = String::new();
    for i in 1..=5000 {
        expected.push_str(&format!("line-{i}\r\n"));
    }
    // A short page is NOT the end: the child may still be writing. Drain
    // until the positively observed exit arrives with an empty page, then
    // run one confirmation round so a reader-thread straggler still in
    // flight cannot hide a tail byte behind the exit verdict.
    let mut cursor = 0u64;
    let mut assembled: Vec<u8> = Vec::new();
    let mut pages = 0u32;
    let mut exited_empty_rounds = 0u32;
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let page = invoke(
            &engine,
            "poll",
            "session.output",
            output_params(&id, &incarnation, cursor, 5_000),
        );
        assert_eq!(page["truncated"], false, "100 KiB fits the 1 MiB ring");
        assert_eq!(page["startCursor"], cursor, "pages must chain contiguously");
        let bytes = decoded_data(&page);
        cursor = page["nextCursor"].as_u64().unwrap();
        assert_eq!(
            cursor,
            page["startCursor"].as_u64().unwrap() + bytes.len() as u64
        );
        assembled.extend_from_slice(&bytes);
        pages += 1;
        assert!(pages < 200, "drain must converge, not spin");
        assert!(Instant::now() < deadline, "burst drain timed out");
        if page["session"]["verdict"] == "exited" && bytes.is_empty() {
            exited_empty_rounds += 1;
            if exited_empty_rounds == 1 {
                // Confirmation round: a reader straggler would land here.
                let confirm = invoke(
                    &engine,
                    "confirm",
                    "session.output",
                    output_params(&id, &incarnation, cursor, 2_000),
                );
                let confirm_bytes = decoded_data(&confirm);
                assert_eq!(confirm["startCursor"], cursor);
                cursor = confirm["nextCursor"].as_u64().unwrap();
                assembled.extend_from_slice(&confirm_bytes);
                if confirm_bytes.is_empty() {
                    break;
                }
                exited_empty_rounds = 0;
            }
        } else {
            exited_empty_rounds = 0;
        }
    }
    assert_eq!(
        String::from_utf8_lossy(&assembled),
        expected,
        "flood output must arrive ordered, complete and duplicate-free"
    );
}

#[test]
fn output_matches_read_cursor_for_cursor_across_methods() {
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    let (id, incarnation) = start_shell(
        &engine,
        &workspace,
        "/bin/sh",
        vec!["-c", "printf 'abc'; sleep 5"],
    );
    // Wait for the byte on the new channel, then continue on the old one:
    // the two methods share one cursor space.
    let first = invoke(
        &engine,
        "poll",
        "session.output",
        output_params(&id, &incarnation, 0, 10_000),
    );
    assert_eq!(String::from_utf8_lossy(&decoded_data(&first)), "abc");
    let cursor = first["nextCursor"].as_u64().unwrap();
    let second = invoke(
        &engine,
        "read",
        "session.read",
        json!({"sessionId": id, "incarnation": incarnation, "cursor": cursor}),
    );
    assert_eq!(second["startCursor"], cursor);
    assert_eq!(second["nextCursor"], cursor);
}

#[test]
fn future_cursor_is_invalid_argument_not_a_hang() {
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    let (id, incarnation) = start_shell(&engine, &workspace, "/bin/cat", vec![]);
    let started = Instant::now();
    let response = dispatch_raw(
        &engine,
        "poll",
        "session.output",
        json!({"sessionId": id, "incarnation": incarnation, "cursor": u64::MAX, "waitMs": 10_000}),
    );
    assert!(!response.ok, "future cursor must error like session.read");
    assert_eq!(response.error.unwrap().code, "invalid_argument");
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "a future cursor must error at once, never hang the wait"
    );
}

#[test]
fn identity_errors_answer_at_once_with_read_codes() {
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    let (id, incarnation) = start_shell(&engine, &workspace, "/bin/cat", vec![]);
    let stale = dispatch_raw(
        &engine,
        "poll",
        "session.output",
        json!({"sessionId": id, "incarnation": "wrong-incarnation", "cursor": 0, "waitMs": 10_000}),
    );
    assert!(!stale.ok);
    assert_eq!(stale.error.unwrap().code, "stale_incarnation");
    let missing = dispatch_raw(
        &engine,
        "poll",
        "session.output",
        json!({"sessionId": "no-such-session", "incarnation": incarnation, "cursor": 0, "waitMs": 10_000}),
    );
    assert!(!missing.ok);
    assert_eq!(missing.error.unwrap().code, "not_found");
}

#[test]
fn limit_bounds_are_shared_with_read() {
    let (_dir, engine) = open_engine();
    let workspace = workspace_id(&engine);
    let (id, incarnation) = start_shell(&engine, &workspace, "/bin/cat", vec![]);
    for bad in [0u64, 65_537] {
        let response = dispatch_raw(
            &engine,
            "poll",
            "session.output",
            json!({"sessionId": id, "incarnation": incarnation, "cursor": 0, "waitMs": 0, "limitBytes": bad}),
        );
        assert!(!response.ok, "limitBytes {bad} must be refused");
        assert_eq!(response.error.unwrap().code, "invalid_argument");
    }
}
