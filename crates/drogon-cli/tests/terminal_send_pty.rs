//! `terminal send` against a real PTY behind a real `drogond` (issue #599).
//!
//! The mock-service suite pins the bytes the CLI puts on the wire. This pins
//! what a program on the other end of the PTY actually *reads*, which is the
//! thing that was broken: a follow-up ending in a newline landed in a live
//! Claude Code session's composer but never submitted.
//!
//! The fixture is a raw-mode reader — `stty raw` turns off the line
//! discipline's `ICRNL`, so it sees the exact bytes an agent TUI would — and
//! it dumps them in hex. That is the only honest way to check this: in
//! canonical mode the line discipline maps CR to NL for the program, so a
//! cooked reader cannot tell the fixed behaviour from the broken one.

#![cfg(unix)]

mod common;

use std::os::unix::fs::PermissionsExt as _;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde_json::Value;

use common::{INHERITED_BINDINGS, run_cli, stderr, stdout};

const BUILD_TIMEOUT: Duration = Duration::from_secs(300);
const READY_TIMEOUT: Duration = Duration::from_secs(20);
const OUTPUT_TIMEOUT: Duration = Duration::from_secs(20);
const POLL_INTERVAL: Duration = Duration::from_millis(25);

/// Dumps the exact bytes the PTY delivered, in hex, between `:` markers.
/// `dd bs=64 count=1` is one `read()` syscall and `stty raw` sets `VMIN=1`,
/// so the read returns as soon as the write lands.
const RAW_READER_SCRIPT: &str = r#"#!/bin/sh
stty raw -echo
printf 'READY:'
dd bs=64 count=1 2>/dev/null | od -An -v -tx1 | tr -d '[:space:]'
printf ':DONE'
"#;

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crates/drogon-cli has a parent")
        .parent()
        .expect("crates/ has a parent")
        .to_path_buf()
}

/// Builds the real `drogond` (a sibling crate's binary, so not exposed via
/// `CARGO_BIN_EXE_*` here) and returns its path next to the already-built
/// `drogon-cli`. Both pipes are drained from the start so a chatty build
/// cannot fill a pipe buffer and masquerade as a build timeout.
fn build_drogond() -> PathBuf {
    let mut child = Command::new("cargo")
        .args(["build", "--locked", "-p", "drogond"])
        .current_dir(workspace_root())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn cargo build -p drogond");
    use std::io::Read;
    fn drain<R: Read + Send + 'static>(pipe: Option<R>) -> std::thread::JoinHandle<String> {
        std::thread::spawn(move || {
            let mut text = String::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_string(&mut text);
            }
            text
        })
    }
    let out_reader = drain(child.stdout.take());
    let err_reader = drain(child.stderr.take());
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().expect("poll cargo build") {
            break status;
        }
        if start.elapsed() > BUILD_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            panic!("cargo build -p drogond did not finish within {BUILD_TIMEOUT:?}");
        }
        std::thread::sleep(POLL_INTERVAL);
    };
    let out = out_reader.join().expect("cargo stdout reader");
    let err = err_reader.join().expect("cargo stderr reader");
    assert!(
        status.success(),
        "cargo build -p drogond failed: {out}\n{err}"
    );
    let target_dir = PathBuf::from(env!("CARGO_BIN_EXE_drogon-cli"))
        .parent()
        .expect("binary path has a parent")
        .to_path_buf();
    let drogond = target_dir.join("drogond");
    assert!(drogond.is_file(), "no drogond at {}", drogond.display());
    drogond
}

/// Owns the `drogond` this test started: killed and reaped exactly once, so
/// no daemon or zombie outlives the test even on a panic.
struct Daemon {
    data_dir: PathBuf,
    child: Child,
    reaped: bool,
}

impl Daemon {
    fn start(drogond: &Path, data_dir: &Path) -> Daemon {
        let mut command = Command::new(drogond);
        command
            .arg("--data-dir")
            .arg(data_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        // The daemon passes its own environment on to the sessions it spawns,
        // so the fixture must not inherit another runtime's bindings either.
        for name in INHERITED_BINDINGS {
            command.env_remove(name);
        }
        let child = command.spawn().expect("spawn drogond");
        let daemon = Daemon {
            data_dir: data_dir.to_path_buf(),
            child,
            reaped: false,
        };
        daemon.wait_ready();
        daemon
    }

    fn wait_ready(&self) {
        let start = Instant::now();
        loop {
            if self.data_dir.join("runtime-v1.sock").exists()
                && self.data_dir.join("auth.token").exists()
                && run_cli(&self.data_dir, &["--json", "status"])
                    .status
                    .success()
            {
                return;
            }
            if start.elapsed() > READY_TIMEOUT {
                let probe = run_cli(&self.data_dir, &["--json", "status"]);
                panic!(
                    "drogond was not ready within {READY_TIMEOUT:?}; last status \
                     probe exited {:?}: {}{}",
                    probe.status.code(),
                    stdout(&probe),
                    stderr(&probe)
                );
            }
            std::thread::sleep(POLL_INTERVAL);
        }
    }
}

impl Daemon {
    /// Signals the daemon this test started and waits for its real exit
    /// status. A reaped status IS the proof it is gone — probing the pid
    /// afterwards would ask about whatever process later reused the number.
    fn shut_down(mut self) -> std::process::ExitStatus {
        let _ = self.child.kill();
        let status = self
            .child
            .wait()
            .expect("reap the drogond this test started");
        self.reaped = true;
        status
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        if self.reaped {
            return;
        }
        // Unwind path only: never panics (a panic in drop aborts), still
        // reaps so no daemon or zombie outlives the test.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn call(data_dir: &Path, args: &[&str]) -> (i32, Value) {
    let mut full = vec!["--json"];
    full.extend_from_slice(args);
    let out = run_cli(data_dir, &full);
    let text = stdout(&out);
    let value = if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or_else(|err| {
            panic!(
                "invalid JSON for {args:?}: {err}\nstdout={text}\nstderr={}",
                stderr(&out)
            )
        })
    };
    (out.status.code().unwrap_or(-1), value)
}

fn ok(data_dir: &Path, args: &[&str]) -> Value {
    let (code, value) = call(data_dir, args);
    assert_eq!(code, 0, "expected success for {args:?}: {value:#}");
    assert_eq!(value["ok"], Value::Bool(true), "{args:?}: {value:#}");
    value
}

fn field(value: &Value, pointer: &str) -> String {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("missing {pointer} in {value:#}"))
        .to_string()
}

/// Everything the session has produced so far, decoded.
fn session_output(data_dir: &Path, session: &str, incarnation: &str) -> String {
    let read = ok(
        data_dir,
        &[
            "terminal",
            "read",
            "--session",
            session,
            "--incarnation",
            incarnation,
            "--cursor",
            "0",
            "--limit-bytes",
            "65536",
        ],
    );
    let bytes = STANDARD
        .decode(field(&read, "/result/dataBase64"))
        .expect("dataBase64 decodes");
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Polls the session's output until `marker` appears, or panics with what it
/// actually saw. Bounded: a missing marker is a failed test, never a hang.
fn wait_for_marker(data_dir: &Path, session: &str, incarnation: &str, marker: &str) -> String {
    let start = Instant::now();
    loop {
        let text = session_output(data_dir, session, incarnation);
        if text.contains(marker) {
            return text;
        }
        assert!(
            start.elapsed() <= OUTPUT_TIMEOUT,
            "session never produced {marker:?} within {OUTPUT_TIMEOUT:?}; saw: {text:?}"
        );
        std::thread::sleep(POLL_INTERVAL);
    }
}

fn write_raw_reader(dir: &Path) -> PathBuf {
    let path = dir.join("raw-reader.sh");
    std::fs::write(&path, RAW_READER_SCRIPT).expect("write fixture");
    let mut perms = std::fs::metadata(&path)
        .expect("stat fixture")
        .permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&path, perms).expect("chmod fixture");
    path
}

#[test]
fn a_trailing_newline_reaches_a_raw_mode_reader_as_a_carriage_return() {
    let drogond = build_drogond();
    let root = tempfile::Builder::new()
        .prefix("dg-send-")
        .tempdir()
        .expect("tempdir");
    let data_dir = root.path().join("d");
    let workspace = root.path().join("w");
    std::fs::create_dir_all(&workspace).expect("create workspace");
    let reader = write_raw_reader(&workspace);

    let daemon = Daemon::start(&drogond, &data_dir);
    let workspace_id = field(
        &ok(
            &data_dir,
            &["workspace", "add", workspace.to_str().expect("utf-8 path")],
        ),
        "/result/id",
    );
    let created = ok(
        &data_dir,
        &[
            "terminal",
            "create",
            "--workspace",
            &workspace_id,
            "--",
            "/bin/sh",
            reader.to_str().expect("utf-8 path"),
        ],
    );
    let session = field(&created, "/result/id");
    let incarnation = field(&created, "/result/incarnation");

    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // The fixture is in raw mode and blocked in its first read().
        wait_for_marker(&data_dir, &session, &incarnation, "READY:");

        let sent = ok(
            &data_dir,
            &[
                "terminal",
                "send",
                "--session",
                &session,
                "--incarnation",
                &incarnation,
                "--text",
                "hi\n",
            ],
        );
        assert_eq!(sent["result"]["acceptedBytes"], 3, "{sent:#}");
        assert_eq!(sent["result"]["submittedEnter"], true, "{sent:#}");

        let text = wait_for_marker(&data_dir, &session, &incarnation, ":DONE");
        let dump = text
            .rsplit("READY:")
            .next()
            .expect("output after READY:")
            .trim_end_matches(":DONE")
            .trim_end_matches(':')
            .to_string();
        // `hi` then Return. `0d` is Enter; `0a` is the byte that used to be
        // sent and that a raw-mode TUI does not submit on.
        assert_eq!(dump, "68690d", "full session output: {text:?}");
    }));

    // Teardown runs on success and on failure, before the daemon goes away.
    let closed = ok(
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
    assert_eq!(closed["result"]["verdict"], "exited", "{closed:#}");
    // Exit proven by the reaped status of the process this test owns.
    let exit = daemon.shut_down();
    assert!(
        exit.code().is_some() || std::os::unix::process::ExitStatusExt::signal(&exit).is_some(),
        "the drogond this test started did not report an exit: {exit:?}"
    );

    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[test]
fn literal_keeps_delivering_the_exact_bytes_a_caller_asked_for() {
    let drogond = build_drogond();
    let root = tempfile::Builder::new()
        .prefix("dg-lit-")
        .tempdir()
        .expect("tempdir");
    let data_dir = root.path().join("d");
    let workspace = root.path().join("w");
    std::fs::create_dir_all(&workspace).expect("create workspace");
    let reader = write_raw_reader(&workspace);

    let daemon = Daemon::start(&drogond, &data_dir);
    let workspace_id = field(
        &ok(
            &data_dir,
            &["workspace", "add", workspace.to_str().expect("utf-8 path")],
        ),
        "/result/id",
    );
    let created = ok(
        &data_dir,
        &[
            "terminal",
            "create",
            "--workspace",
            &workspace_id,
            "--",
            "/bin/sh",
            reader.to_str().expect("utf-8 path"),
        ],
    );
    let session = field(&created, "/result/id");
    let incarnation = field(&created, "/result/incarnation");

    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        wait_for_marker(&data_dir, &session, &incarnation, "READY:");
        // `--literal` is the escape hatch for callers piping data: the line
        // feed stays a line feed and nothing is split off as a keystroke.
        let sent = ok(
            &data_dir,
            &[
                "terminal",
                "send",
                "--session",
                &session,
                "--incarnation",
                &incarnation,
                "--text",
                "hi\n",
                "--literal",
            ],
        );
        assert_eq!(sent["result"]["acceptedBytes"], 3, "{sent:#}");
        assert_eq!(sent["result"]["submittedEnter"], false, "{sent:#}");
        // The raw reader sees the line feed the caller asked for — the shape
        // that never submitted a turn, kept only behind the flag.
        let text = wait_for_marker(&data_dir, &session, &incarnation, ":DONE");
        let dump = text
            .rsplit("READY:")
            .next()
            .expect("output after READY:")
            .trim_end_matches(":DONE")
            .trim_end_matches(':')
            .to_string();
        assert_eq!(dump, "68690a", "full session output: {text:?}");
    }));

    let closed = ok(
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
    assert_eq!(closed["result"]["verdict"], "exited", "{closed:#}");
    // Exit proven by the reaped status of the process this test owns.
    let exit = daemon.shut_down();
    assert!(
        exit.code().is_some() || std::os::unix::process::ExitStatusExt::signal(&exit).is_some(),
        "the drogond this test started did not report an exit: {exit:?}"
    );

    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}
