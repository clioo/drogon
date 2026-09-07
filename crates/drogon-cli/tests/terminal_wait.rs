//! `terminal wait` against a real `drogond` in a temp data dir: the exited,
//! output and idle success paths, the typed `timeout` failure, fail-fast
//! refusals for unknown sessions, and the status capabilities the bundled
//! guides promise. No mocks: the CLI binary drives the real daemon binary.

#![cfg(unix)]

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

const BUILD_TIMEOUT: Duration = Duration::from_secs(300);
const READY_TIMEOUT: Duration = Duration::from_secs(15);
const POLL_INTERVAL: Duration = Duration::from_millis(25);

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crates/drogon-cli has a parent")
        .parent()
        .expect("crates/ has a parent")
        .to_path_buf()
}

/// Builds the real `drogond` binary; both stdio pipes are drained by reader
/// threads from the start so a chatty `cargo build` can never block on a
/// full pipe buffer and masquerade as the build timeout.
fn build_drogond() -> PathBuf {
    let root = workspace_root();
    let mut child = Command::new("cargo")
        .args(["build", "--locked", "-p", "drogond"])
        .current_dir(&root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn cargo build -p drogond");
    fn drain<R: std::io::Read + Send + 'static>(
        pipe: Option<R>,
    ) -> std::thread::JoinHandle<String> {
        std::thread::spawn(move || {
            let mut text = String::new();
            if let Some(mut pipe) = pipe {
                let _ = std::io::Read::read_to_string(&mut pipe, &mut text);
            }
            text
        })
    }
    let stdout_reader = drain(child.stdout.take());
    let stderr_reader = drain(child.stderr.take());
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().expect("poll cargo build") {
            break status;
        }
        if start.elapsed() > BUILD_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            panic!("cargo build -p drogond --locked did not finish within {BUILD_TIMEOUT:?}");
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let out = stdout_reader.join().expect("cargo stdout reader");
    let err = stderr_reader.join().expect("cargo stderr reader");
    assert!(
        status.success(),
        "cargo build -p drogond --locked failed: stdout={out}\nstderr={err}"
    );
    let cli_path = PathBuf::from(env!("CARGO_BIN_EXE_drogon-cli"));
    let target_dir = cli_path
        .parent()
        .expect("drogon-cli binary path has a parent directory")
        .to_path_buf();
    let drogond_path = target_dir.join("drogond");
    assert!(
        drogond_path.is_file(),
        "expected drogond binary at {} after build",
        drogond_path.display()
    );
    drogond_path
}

struct Daemon {
    data_dir: PathBuf,
    child: Child,
}

impl Daemon {
    fn start(drogond_path: &Path, data_dir: &Path) -> Daemon {
        let child = Command::new(drogond_path)
            .arg("--data-dir")
            .arg(data_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn drogond");
        let daemon = Daemon {
            data_dir: data_dir.to_path_buf(),
            child,
        };
        daemon.wait_ready();
        daemon
    }

    fn wait_ready(&self) {
        let socket = self.data_dir.join("runtime-v1.sock");
        let token = self.data_dir.join("auth.token");
        let start = Instant::now();
        loop {
            if socket.exists() && token.exists() {
                let probe = run_cli(&self.data_dir, &["--json", "status"]);
                if probe.status.success() {
                    return;
                }
            }
            if start.elapsed() > READY_TIMEOUT {
                panic!(
                    "drogond did not become ready within {READY_TIMEOUT:?} \
                     (socket present: {}, token present: {})",
                    socket.exists(),
                    token.exists()
                );
            }
            std::thread::sleep(POLL_INTERVAL);
        }
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn run_cli(data_dir: &Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_drogon-cli"))
        .args(args)
        .env("DROGON_DATA_DIR", data_dir)
        .env_remove("DROGON_DISPATCH_CAPABILITY")
        .output()
        .expect("spawn drogon-cli")
}

/// Runs the CLI with `--json` prepended and parses the single stdout
/// envelope (or Null when a failure correctly left stdout empty).
fn call_json(data_dir: &Path, args: &[&str]) -> (i32, Value) {
    let full: Vec<&str> = std::iter::once("--json")
        .chain(args.iter().copied())
        .collect();
    let out = run_cli(data_dir, &full);
    let code = out.status.code().unwrap_or(-1);
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    let value = if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or_else(|err| {
            panic!(
                "invalid JSON stdout for {args:?}: {err}\nstdout={text}\nstderr={}",
                String::from_utf8_lossy(&out.stderr)
            )
        })
    };
    (code, value)
}

fn stdout(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn stderr(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

fn text_field<'a>(value: &'a Value, pointer: &str) -> &'a str {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("missing/non-string field {pointer} in {value:#}"))
}

fn register_workspace(data_dir: &Path, dir: &Path) -> String {
    std::fs::create_dir_all(dir).expect("create workspace dir");
    let (code, ws) = call_json(data_dir, &["workspace", "add", dir.to_str().expect("utf8")]);
    assert_eq!(code, 0, "workspace add failed: {ws:#}");
    text_field(&ws, "/result/id").to_string()
}

fn start_session(data_dir: &Path, workspace: &str, argv: &[&str]) -> (String, String) {
    let mut args: Vec<&str> = vec!["terminal", "create", "--workspace", workspace, "--"];
    args.extend_from_slice(argv);
    let (code, sess) = call_json(data_dir, &args);
    assert_eq!(code, 0, "terminal create {argv:?} failed: {sess:#}");
    (
        text_field(&sess, "/result/id").to_string(),
        text_field(&sess, "/result/incarnation").to_string(),
    )
}

fn wait_args<'a>(
    session: &'a str,
    incarnation: &'a str,
    condition: &'a str,
    timeout_ms: &'a str,
) -> Vec<&'a str> {
    vec![
        "terminal",
        "wait",
        "--session",
        session,
        "--incarnation",
        incarnation,
        "--for",
        condition,
        "--timeout-ms",
        timeout_ms,
    ]
}

#[test]
fn terminal_wait_success_paths_against_a_real_daemon() {
    let drogond_path = build_drogond();
    let scratch = tempfile::tempdir().expect("scratch tempdir");
    let data_dir = scratch.path().join("data");
    let daemon = Daemon::start(&drogond_path, &data_dir);
    let ws_id = register_workspace(&data_dir, &scratch.path().join("ws"));

    // Exited: `true` is gone before the first poll finishes.
    let (session, incarnation) = start_session(&data_dir, &ws_id, &["true"]);
    let args = wait_args(&session, &incarnation, "exited", "10000");
    let args_ref: Vec<&str> = args.to_vec();
    let output = run_cli(&data_dir, &args_ref);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let text = stdout(&output);
    assert!(text.contains("Wait satisfied"), "stdout: {text}");
    assert!(text.contains("[exited]"), "stdout: {text}");
    assert!(text.contains("for=exited"), "stdout: {text}");

    // JSON success carries the satisfying session.read envelope.
    let mut json_args: Vec<&str> = vec!["--json"];
    json_args.extend_from_slice(&args_ref);
    let output = run_cli(&data_dir, &json_args);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON wait envelope");
    assert_eq!(envelope["ok"], Value::Bool(true));
    assert_eq!(
        envelope["result"]["session"]["verdict"],
        Value::from("exited")
    );

    // Output: echo leaves bytes behind, so the first poll already holds.
    let (session, incarnation) = start_session(&data_dir, &ws_id, &["echo", "hello-wait-marker"]);
    let args = wait_args(&session, &incarnation, "output", "10000");
    let args_ref: Vec<&str> = args.to_vec();
    let output = run_cli(&data_dir, &args_ref);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    assert!(
        stdout(&output).contains("for=output"),
        "stdout: {}",
        stdout(&output)
    );

    // Idle: one burst, then silence past the agent-state window.
    let (session, incarnation) =
        start_session(&data_dir, &ws_id, &["sh", "-c", "echo hi; sleep 30"]);
    let args = wait_args(&session, &incarnation, "idle", "20000");
    let args_ref: Vec<&str> = args.to_vec();
    let output = run_cli(&data_dir, &args_ref);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    assert!(
        stdout(&output).contains("for=idle"),
        "stdout: {}",
        stdout(&output)
    );

    // Best-effort cleanup of the idle sleeper; the daemon Drop reaps the rest.
    let _ = run_cli(
        &data_dir,
        &[
            "terminal",
            "close",
            "--session",
            &session,
            "--incarnation",
            &incarnation,
        ],
    );
    drop(daemon);
}

#[test]
fn terminal_wait_timeout_and_refusals_against_a_real_daemon() {
    let drogond_path = build_drogond();
    let scratch = tempfile::tempdir().expect("scratch tempdir");
    let data_dir = scratch.path().join("data");
    let daemon = Daemon::start(&drogond_path, &data_dir);
    let ws_id = register_workspace(&data_dir, &scratch.path().join("ws"));

    let (session, incarnation) = start_session(&data_dir, &ws_id, &["sleep", "30"]);

    // Human timeout: exit 1 with the typed reason on stderr.
    let args = wait_args(&session, &incarnation, "exited", "500");
    let args_ref: Vec<&str> = args.to_vec();
    let output = run_cli(&data_dir, &args_ref);
    assert_eq!(output.status.code(), Some(1), "stdout: {}", stdout(&output));
    let text = stderr(&output);
    assert!(text.contains("timeout"), "stderr: {text}");
    assert!(text.contains("timed out"), "stderr: {text}");

    // JSON timeout: the failure envelope carries error.code timeout.
    let mut json_args: Vec<&str> = vec!["--json"];
    json_args.extend_from_slice(&args_ref);
    let output = run_cli(&data_dir, &json_args);
    assert_eq!(output.status.code(), Some(1));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON timeout envelope");
    assert_eq!(envelope["ok"], Value::Bool(false));
    assert_eq!(envelope["error"]["code"], Value::from("timeout"));

    // Unknown sessions fail fast with the daemon's refusal, not a timeout.
    let args = wait_args("no-such-session", "no-such-incarnation", "exited", "5000");
    let args_ref: Vec<&str> = args.to_vec();
    let start = Instant::now();
    let output = run_cli(&data_dir, &args_ref);
    let elapsed = start.elapsed();
    assert_eq!(output.status.code(), Some(1), "stdout: {}", stdout(&output));
    let text = stderr(&output);
    assert!(!text.contains("timed out"), "must not time out: {text}");
    assert!(
        elapsed < Duration::from_secs(5),
        "unknown sessions refuse fast, took {elapsed:?}: {text}"
    );

    // An unbounded wait is a usage error, never a hung invocation.
    let args = wait_args(&session, &incarnation, "exited", "0");
    let args_ref: Vec<&str> = args.to_vec();
    let output = run_cli(&data_dir, &args_ref);
    assert_eq!(output.status.code(), Some(2));
    assert!(stdout(&output).is_empty());

    // The capabilities the bundled guides promise are really advertised.
    let (code, status) = call_json(&data_dir, &["status"]);
    assert_eq!(code, 0, "status failed: {status:#}");
    let capabilities = status["result"]["capabilities"]
        .as_array()
        .expect("capabilities array");
    for required in [
        "project.v1",
        "worktree.v1",
        "git.v1",
        "session.agent-state.v1",
    ] {
        assert!(
            capabilities.iter().any(|c| c.as_str() == Some(required)),
            "status is missing {required}: {status:#}"
        );
    }

    let _ = run_cli(
        &data_dir,
        &[
            "terminal",
            "close",
            "--session",
            &session,
            "--incarnation",
            &incarnation,
        ],
    );
    drop(daemon);
}
