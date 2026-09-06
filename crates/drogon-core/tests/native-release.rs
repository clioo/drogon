//! Regression tests for native PTY resource release: repeated short-lived
//! sessions must not grow the process's open descriptor count (the PTY
//! master/writer pair must be released after the child's exit is positively
//! observed and the reader has drained output), and retained ring output
//! must remain readable after that release.

#![cfg(unix)]

use drogon_core::Engine;
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

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

fn open_descriptor_count() -> usize {
    for dir in ["/dev/fd", "/proc/self/fd"] {
        if let Ok(entries) = std::fs::read_dir(dir) {
            return entries.count();
        }
    }
    panic!("no open-descriptor enumeration available on this platform");
}

fn wait_until_exited(engine: &Engine, session: &Value) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let listed = ok(engine, "list", "session.list", json!({}));
        let row = listed["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["id"] == session["id"])
            .expect("session row must exist")
            .clone();
        if row["verdict"] == "exited" {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "session {:?} never reached exited: {row}",
            session["id"]
        );
        std::thread::sleep(Duration::from_millis(15));
    }
}

fn read_all_output(engine: &Engine, n: usize, session: &Value) -> String {
    let read = ok(
        engine,
        &format!("read-{n}"),
        "session.read",
        json!({
            "sessionId": session["id"],
            "incarnation": session["incarnation"],
            "cursor": 0,
        }),
    );
    let encoded = read["dataBase64"].as_str().unwrap_or("");
    String::from_utf8_lossy(&data_base64_to_bytes(encoded)).into_owned()
}

fn data_base64_to_bytes(encoded: &str) -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .unwrap_or_default()
}

#[test]
fn repeated_short_sessions_bound_fds_and_keep_retained_output() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let workspace = ok(
        &engine,
        "ws",
        "workspace.register",
        json!({ "path": dir.path() }),
    );

    let start = |engine: &Engine, workspace: &Value, n: usize| {
        ok(
            engine,
            &format!("start-{n}"),
            "session.start",
            json!({
                "workspaceId": workspace["id"],
                "command": "/bin/sh",
                "args": ["-c", &format!("echo SHORT-LIVED-{n}; exit 0")],
            }),
        )
    };

    let mut sessions = Vec::new();
    // Warm-up: the first sessions also stabilize lazily-created process fds
    // (SQLite sidecars, runtime internals) so the baseline is steady state.
    for n in 0..2 {
        let session = start(&engine, &workspace, n);
        wait_until_exited(&engine, &session);
        sessions.push(session);
    }
    let baseline = open_descriptor_count();

    for n in 2..8 {
        let session = start(&engine, &workspace, n);
        wait_until_exited(&engine, &session);
        sessions.push(session);
    }

    // Every session has been positively observed to exit and its output
    // drained; the master/writer pair must now be released, so the open
    // descriptor count returns to the baseline (small slack absorbs
    // unrelated fd churn). A leaking implementation holds one or two extra
    // descriptors per session — at least 6 here, far above the slack.
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let count = open_descriptor_count();
        if count <= baseline + 2 {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "native PTY fds were not released: {count} open, baseline {baseline}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }

    // Retained output survives the release: each exited session's ring is
    // still served from memory.
    for (n, session) in sessions.iter().enumerate() {
        let output = read_all_output(&engine, n, session);
        assert!(
            output.contains(&format!("SHORT-LIVED-{n}")),
            "retained output lost for session {n}: got {output:?}"
        );
    }
}
