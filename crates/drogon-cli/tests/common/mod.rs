//! A protocol-v1 mock native service for drogon-cli integration tests.
//!
//! Binds the real `runtime-v1.sock` inside a test data directory, writes the
//! real `auth.token` file, and answers framed JSON RPC according to a
//! per-test behavior closure. Only the CLI under test is a separate process;
//! the mock lives in the test process.

#![cfg(unix)]
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::watch;

pub const TOKEN: &str = "test-token-do-not-log";
pub const SOCKET_NAME: &str = "runtime-v1.sock";
pub const TOKEN_NAME: &str = "auth.token";

/// What the mock does with one accepted connection (after reading the first
/// request line).
pub enum Action {
    /// Write this JSON value plus a newline, then drop the connection.
    Respond(Value),
    /// Write raw bytes (no newline added), then drop the connection.
    Raw(Vec<u8>),
    /// Drop the connection without writing anything.
    Close,
}

pub type Behavior = Arc<dyn Fn(Value) -> Action + Send + Sync>;

pub struct MockService {
    pub data_dir: PathBuf,
    captured: Arc<Mutex<Vec<Value>>>,
    shutdown: watch::Sender<bool>,
    _accept_loop: tokio::task::JoinHandle<()>,
}

/// Common start: status succeeds with the canonical identity result.
pub fn status_ok_behavior() -> Behavior {
    Arc::new(|request| match request["method"].as_str() {
        Some("status") => Action::Respond(ok_envelope(
            request["requestId"].as_str().unwrap_or(""),
            json!({
                "hostId": "host-1",
                "serviceInstanceId": "svc-1",
                "protocol": 1,
                "capabilities": ["workspace.v1", "session.pty.v1"],
                "version": "0.1.0"
            }),
        )),
        _ => Action::Respond(error_envelope(
            request["requestId"].as_str().unwrap_or(""),
            "method_not_found",
            "mock does not implement this method",
        )),
    })
}

impl MockService {
    /// Starts the mock and writes the auth token into `data_dir` (created if
    /// needed). The socket appears at `<data_dir>/runtime-v1.sock`.
    pub fn start(data_dir: &Path, behavior: Behavior) -> MockService {
        std::fs::create_dir_all(data_dir).expect("create data dir");
        std::fs::write(data_dir.join(TOKEN_NAME), format!("{TOKEN}\n")).expect("write token");

        let socket_path = data_dir.join(SOCKET_NAME);
        let _ = std::fs::remove_file(&socket_path);
        let listener = UnixListener::bind(&socket_path).expect("bind mock socket");
        let captured: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
        let (shutdown, shutdown_rx) = watch::channel(false);

        let captured_for_loop = captured.clone();
        let accept_loop = tokio::spawn(async move {
            let mut shutdown_rx = shutdown_rx;
            loop {
                tokio::select! {
                    _ = shutdown_rx.changed() => break,
                    accepted = listener.accept() => {
                        let Ok((stream, _)) = accepted else { break };
                        let behavior = behavior.clone();
                        let captured = captured_for_loop.clone();
                        tokio::spawn(async move {
                            handle_connection(stream, behavior, captured).await;
                        });
                    }
                }
            }
            let _ = std::fs::remove_file(&socket_path);
        });

        MockService {
            data_dir: data_dir.to_path_buf(),
            captured,
            shutdown,
            _accept_loop: accept_loop,
        }
    }

    /// Starts the mock without an auth token file (negative path).
    pub fn start_without_token(data_dir: &Path, behavior: Behavior) -> MockService {
        std::fs::create_dir_all(data_dir).expect("create data dir");
        let socket_path = data_dir.join(SOCKET_NAME);
        let _ = std::fs::remove_file(&socket_path);
        let listener = UnixListener::bind(&socket_path).expect("bind mock socket");
        let captured: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
        let captured_for_loop = captured.clone();
        let (shutdown, shutdown_rx) = watch::channel(false);
        let accept_loop = tokio::spawn(async move {
            let _ = shutdown_rx;
            while let Ok((stream, _)) = listener.accept().await {
                let behavior = behavior.clone();
                let captured = captured_for_loop.clone();
                tokio::spawn(async move {
                    handle_connection(stream, behavior, captured).await;
                });
            }
        });
        MockService {
            data_dir: data_dir.to_path_buf(),
            captured,
            shutdown,
            _accept_loop: accept_loop,
        }
    }

    pub fn captured(&self) -> Vec<Value> {
        self.captured.lock().expect("capture lock").clone()
    }

    pub fn first_captured(&self) -> Value {
        self.captured()
            .into_iter()
            .next()
            .expect("mock saw a request")
    }

    pub fn last_captured(&self) -> Value {
        self.captured()
            .into_iter()
            .last()
            .expect("mock saw a request")
    }
}

impl Drop for MockService {
    fn drop(&mut self) {
        let _ = self.shutdown.send(true);
    }
}

async fn handle_connection(
    stream: UnixStream,
    behavior: Behavior,
    captured: Arc<Mutex<Vec<Value>>>,
) {
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);
    let mut line = String::new();
    match reader.read_line(&mut line).await {
        Ok(0) | Err(_) => return,
        Ok(_) => {}
    }
    let request: Value = match serde_json::from_str(line.trim()) {
        Ok(value) => value,
        Err(_) => return,
    };
    captured.lock().expect("capture lock").push(request.clone());
    match behavior(request) {
        Action::Respond(envelope) => {
            let mut bytes = serde_json::to_vec(&envelope).expect("serialize envelope");
            bytes.push(b'\n');
            let _ = writer.write_all(&bytes).await;
            let _ = writer.flush().await;
        }
        Action::Raw(bytes) => {
            let _ = writer.write_all(&bytes).await;
            let _ = writer.flush().await;
        }
        Action::Close => {}
    }
    // writer dropped: connection closed.
}

pub fn ok_envelope(request_id: &str, result: Value) -> Value {
    json!({
        "protocol": 1,
        "requestId": request_id,
        "ok": true,
        "result": result
    })
}

pub fn error_envelope(request_id: &str, code: &str, message: &str) -> Value {
    json!({
        "protocol": 1,
        "requestId": request_id,
        "ok": false,
        "error": { "code": code, "message": message, "retryable": false }
    })
}

/// Runs the built drogon-cli binary with `DROGON_DATA_DIR` pointed at the
/// mock's data directory.
pub fn run_cli(data_dir: &Path, args: &[&str]) -> std::process::Output {
    run_cli_with(data_dir, args, &[])
}

/// Extra environment entries, applied on top of the mock data dir.
pub fn run_cli_with(
    data_dir: &Path,
    args: &[&str],
    extra_env: &[(&str, &str)],
) -> std::process::Output {
    let mut command = std::process::Command::new(env!("CARGO_BIN_EXE_drogon-cli"));
    command.args(args).env("DROGON_DATA_DIR", data_dir);
    for (key, value) in extra_env {
        command.env(key, value);
    }
    command.output().expect("spawn drogon-cli")
}

pub fn stdout(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

pub fn stderr(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}
