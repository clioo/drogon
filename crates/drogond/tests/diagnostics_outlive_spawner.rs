//! The daemon is spawned by the desktop with its stderr on a pipe, and it
//! outlives that desktop by design. Once the desktop is gone the pipe has no
//! reader, and a Rust `eprintln!` to it panics: the automation scheduler's
//! first tick with something to log died that way on 2026-09-14, and the
//! heartbeat froze for hours. This proves the structural fix over the real
//! binary: once serving, the daemon writes its diagnostics to
//! `logs/drogond.log` and lets go of the inherited pipe (the reader sees
//! EOF while the process is alive), and its scheduler heartbeat keeps
//! advancing across a tick after that.
#![cfg(unix)]

use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

const STARTUP_TIMEOUT: Duration = Duration::from_secs(20);
const CLIENT_TIMEOUT: Duration = Duration::from_secs(10);

struct TestServer {
    dir: tempfile::TempDir,
    token: String,
    child: Child,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn start_server_with_piped_stderr() -> TestServer {
    let dir = tempfile::tempdir().unwrap();
    let child = Command::new(env!("CARGO_BIN_EXE_drogond"))
        .env_clear()
        .arg("--data-dir")
        .arg(dir.path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut server = TestServer {
        dir,
        token: String::new(),
        child,
    };
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    loop {
        assert!(
            server.child.try_wait().unwrap().is_none(),
            "daemon exited during startup"
        );
        if let Ok(token) =
            std::fs::read_to_string(server.dir.path().join(drogond::auth::TOKEN_FILE_NAME))
            && UnixStream::connect(server.dir.path().join("runtime-v1.sock")).is_ok()
        {
            server.token = token;
            return server;
        }
        assert!(Instant::now() < deadline, "daemon startup deadline");
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn status(server: &TestServer, request_id: &str) -> Value {
    let mut stream = UnixStream::connect(server.dir.path().join("runtime-v1.sock")).unwrap();
    stream.set_read_timeout(Some(CLIENT_TIMEOUT)).unwrap();
    stream.set_write_timeout(Some(CLIENT_TIMEOUT)).unwrap();
    let request: Request = serde_json::from_value(json!({
        "protocol": PROTOCOL_VERSION,
        "requestId": request_id,
        "method": "status",
        "auth": server.token,
        "params": {},
    }))
    .unwrap();
    let mut bytes = serde_json::to_vec(&request).unwrap();
    bytes.push(b'\n');
    stream.write_all(&bytes).unwrap();
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    let response: Response = serde_json::from_str(&line).unwrap();
    assert!(response.ok, "status must answer: {:?}", response.error);
    response.result.unwrap()
}

#[test]
fn a_serving_daemon_logs_to_its_data_directory_and_lets_go_of_the_spawners_pipe() {
    let mut server = start_server_with_piped_stderr();
    let log = server.dir.path().join("logs").join("drogond.log");

    // The inherited pipe carries only the hand-off line, then EOF — while the
    // daemon is still alive. Everything after the redirect lands in the file,
    // so a reader that disappears can never turn a log line into a panic.
    let mut inherited = String::new();
    server
        .child
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut inherited)
        .unwrap();
    assert!(
        server.child.try_wait().unwrap().is_none(),
        "the daemon must still be running after its stderr pipe reached EOF"
    );
    assert!(
        inherited.contains("diagnostics continue in"),
        "the spawner's pipe names the log before the hand-off, got {inherited:?}"
    );
    assert!(
        inherited.contains(&log.display().to_string()),
        "the hand-off names the log path, got {inherited:?}"
    );

    let logged = std::fs::read_to_string(&log).unwrap();
    assert!(
        logged.contains("log opened at"),
        "the first line in the log is the daemon announcing itself, got {logged:?}"
    );

    // The scheduler is alive and its heartbeat keeps advancing past a tick
    // taken with the pipe already gone: the exact thing that used to stop.
    let first = status(&server, "heartbeat-0")["schedulerLastTickMs"]
        .as_u64()
        .expect("the first tick runs at startup");
    let deadline = Instant::now() + Duration::from_secs(40);
    let mut poll = 0u32;
    loop {
        poll += 1;
        let tick = status(&server, &format!("heartbeat-{poll}"))["schedulerLastTickMs"]
            .as_u64()
            .unwrap();
        if tick > first {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the scheduler heartbeat never advanced after the spawner's pipe closed"
        );
        std::thread::sleep(Duration::from_millis(500));
    }
}
