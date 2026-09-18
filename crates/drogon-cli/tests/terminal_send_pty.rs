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
//!
//! The table below is the whole documented surface, not just the headline
//! case: every spelling of "and press Enter", a multi-line body, a blank
//! trailing line, whitespace, non-ASCII, no terminator at all and both
//! `--literal` shapes. An earlier version pinned only `hi\n`, and a mutation
//! that dropped CRLF handling sailed through it.

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
/// Window for a negative assertion: long enough for a delivery that did
/// happen to show up, short enough not to pad the suite.
const SETTLE: Duration = Duration::from_secs(2);

/// Dumps, in hex between `:` markers, exactly the first `$1` bytes the PTY
/// delivered and then exactly `$1` more. `dd bs=1` reads a byte at a time,
/// so the dump never depends on where a read boundary happened to fall.
/// The second dump is how a duplicate delivery becomes visible: with one
/// delivery it blocks forever and `SECOND` never appears.
const RAW_READER_SCRIPT: &str = r#"#!/bin/sh
stty raw -echo
printf 'READY:'
dd bs=1 count="$1" 2>/dev/null | od -An -v -tx1 | tr -d '[:space:]'
printf ':DONE:'
dd bs=1 count="$1" 2>/dev/null | od -An -v -tx1 | tr -d '[:space:]'
printf ':SECOND'
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

/// The session's output after a bounded settle, for the one assertion that
/// is about something NOT arriving. Anything a returned call wrote is
/// already in the PTY; this just gives the fixture time to react to it.
fn session_output_after(data_dir: &Path, session: &str, incarnation: &str) -> String {
    let deadline = Instant::now() + SETTLE;
    while Instant::now() < deadline {
        std::thread::sleep(POLL_INTERVAL);
    }
    session_output(data_dir, session, incarnation)
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

/// Starts a workspace-registered daemon and returns its handle plus the
/// workspace id, so one test can drive several sessions without paying for
/// a daemon per case.
struct Fixture {
    daemon: Daemon,
    data_dir: PathBuf,
    workspace_id: String,
    reader: PathBuf,
    _root: tempfile::TempDir,
}

impl Fixture {
    fn start(prefix: &str) -> Fixture {
        let drogond = build_drogond();
        let root = tempfile::Builder::new()
            .prefix(prefix)
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
        Fixture {
            daemon,
            data_dir,
            workspace_id,
            reader,
            _root: root,
        }
    }

    /// A session running the raw-mode reader, already blocked on its first
    /// read of `expect_bytes` bytes.
    fn raw_session(&self, expect_bytes: usize) -> (String, String) {
        let created = ok(
            &self.data_dir,
            &[
                "terminal",
                "create",
                "--workspace",
                &self.workspace_id,
                "--",
                "/bin/sh",
                self.reader.to_str().expect("utf-8 path"),
                &expect_bytes.to_string(),
            ],
        );
        let session = field(&created, "/result/id");
        let incarnation = field(&created, "/result/incarnation");
        wait_for_marker(&self.data_dir, &session, &incarnation, "READY:");
        (session, incarnation)
    }

    fn close(&self, session: &str, incarnation: &str) {
        let closed = ok(
            &self.data_dir,
            &[
                "terminal",
                "close",
                "--session",
                session,
                "--incarnation",
                incarnation,
            ],
        );
        assert_eq!(closed["result"]["verdict"], "exited", "{closed:#}");
    }

    /// Teardown that runs on success and on failure, before the daemon goes
    /// away, and proves the process this test started really exited.
    fn shut_down(self) {
        let exit = self.daemon.shut_down();
        assert!(
            exit.code().is_some() || std::os::unix::process::ExitStatusExt::signal(&exit).is_some(),
            "the drogond this test started did not report an exit: {exit:?}"
        );
    }
}

/// The hex between `READY:` and `:DONE` — exactly what the reader's first
/// `n` bytes were.
fn first_dump(text: &str) -> String {
    text.rsplit("READY:")
        .next()
        .expect("output after READY:")
        .split(":DONE")
        .next()
        .expect("output before :DONE")
        .to_string()
}

/// One row of the documented surface: what `--text` (plus `--literal`) is
/// asked to deliver, and the exact bytes a raw-mode reader must see.
struct Case {
    text: &'static str,
    literal: bool,
    hex: &'static str,
    accepted: u64,
    submitted_enter: bool,
}

#[test]
fn a_raw_mode_reader_gets_exactly_the_documented_bytes() {
    // Return is 0d. 0a is the byte that used to be sent and that a raw-mode
    // TUI does not submit on — it is the bug, and it must appear only where
    // the caller's own body or `--literal` puts it.
    const CASES: &[Case] = &[
        // Every spelling of "and press Enter" is the same one-byte Return.
        Case {
            text: "hi\n",
            literal: false,
            hex: "68690d",
            accepted: 3,
            submitted_enter: true,
        },
        Case {
            text: "hi\r\n",
            literal: false,
            hex: "68690d",
            accepted: 3,
            submitted_enter: true,
        },
        Case {
            text: "hi\r",
            literal: false,
            hex: "68690d",
            accepted: 3,
            submitted_enter: true,
        },
        // Interior line feeds are the composer's; only the last terminator
        // submits, so a multi-line message is one turn.
        Case {
            text: "one\ntwo\n",
            literal: false,
            hex: "6f6e650a74776f0d",
            accepted: 8,
            submitted_enter: true,
        },
        // A blank trailing line is a line feed plus one Return, not two.
        Case {
            text: "hi\n\n",
            literal: false,
            hex: "68690a0d",
            accepted: 4,
            submitted_enter: true,
        },
        Case {
            text: "   \n",
            literal: false,
            hex: "2020200d",
            accepted: 4,
            submitted_enter: true,
        },
        // Nothing to submit: bytes only, and no claim of a turn.
        Case {
            text: "hi",
            literal: false,
            hex: "6869",
            accepted: 2,
            submitted_enter: false,
        },
        // Multi-byte text is measured and delivered in bytes.
        Case {
            text: "é\n",
            literal: false,
            hex: "c3a90d",
            accepted: 3,
            submitted_enter: true,
        },
        // `--literal` is the byte-exact path: the line feed stays a line
        // feed, which is exactly the shape that never submitted a turn.
        Case {
            text: "hi\n",
            literal: true,
            hex: "68690a",
            accepted: 3,
            submitted_enter: false,
        },
        Case {
            text: "hi\r\n",
            literal: true,
            hex: "68690d0a",
            accepted: 4,
            submitted_enter: false,
        },
    ];

    let fixture = Fixture::start("dg-send-");
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        for case in CASES {
            let expected_bytes = case.hex.len() / 2;
            let (session, incarnation) = fixture.raw_session(expected_bytes);
            let mut args = vec![
                "terminal",
                "send",
                "--session",
                session.as_str(),
                "--incarnation",
                incarnation.as_str(),
                "--text",
                case.text,
            ];
            if case.literal {
                args.push("--literal");
            }
            let sent = ok(&fixture.data_dir, &args);
            let label = format!("{:?} literal={}", case.text, case.literal);
            assert_eq!(
                sent["result"]["acceptedBytes"], case.accepted,
                "{label}: {sent:#}"
            );
            assert_eq!(
                sent["result"]["submittedEnter"], case.submitted_enter,
                "{label}: {sent:#}"
            );
            let text = wait_for_marker(&fixture.data_dir, &session, &incarnation, ":DONE");
            assert_eq!(
                first_dump(&text),
                case.hex,
                "{label}: session output {text:?}"
            );
            fixture.close(&session, &incarnation);
        }
    }));
    fixture.shut_down();
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// An empty payload is the SERVICE's to refuse (`require_str`), and the
/// mock-backed suite cannot see that. A refusal must also never claim a
/// turn: no `submittedEnter` at all, in either direction.
#[test]
fn an_empty_text_is_refused_by_the_service_and_claims_no_turn() {
    let fixture = Fixture::start("dg-empty-");
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let (session, incarnation) = fixture.raw_session(1);
        for extra in [vec![], vec!["--literal"]] {
            let mut args = vec![
                "terminal",
                "send",
                "--session",
                session.as_str(),
                "--incarnation",
                incarnation.as_str(),
                "--text",
                "",
            ];
            args.extend_from_slice(&extra);
            let (code, envelope) = call(&fixture.data_dir, &args);
            assert_eq!(code, 1, "extra {extra:?}: {envelope:#}");
            assert_eq!(envelope["ok"], false, "{envelope:#}");
            assert_eq!(
                envelope["error"]["code"], "invalid_argument",
                "{envelope:#}"
            );
            assert!(
                !envelope.to_string().contains("submittedEnter"),
                "a refused send must not mention a keystroke: {envelope:#}"
            );
        }
        fixture.close(&session, &incarnation);
    }));
    fixture.shut_down();
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// One send is one ledger row, so a `--retry-request` replay reaches the PTY
/// exactly once instead of typing the message — and its Enter — twice. The
/// mock service has no ledger, so only a real daemon can pin this.
#[test]
fn a_replayed_send_reaches_the_pty_exactly_once() {
    let fixture = Fixture::start("dg-replay-");
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let (session, incarnation) = fixture.raw_session(5);
        for attempt in 0..2 {
            let sent = ok(
                &fixture.data_dir,
                &[
                    "terminal",
                    "send",
                    "--session",
                    &session,
                    "--incarnation",
                    &incarnation,
                    "--text",
                    "PING\n",
                    "--retry-request",
                    "replay-once",
                ],
            );
            assert_eq!(
                sent["result"]["acceptedBytes"], 5,
                "attempt {attempt}: {sent:#}"
            );
            assert_eq!(sent["result"]["submittedEnter"], true, "attempt {attempt}");
        }
        let text = wait_for_marker(&fixture.data_dir, &session, &incarnation, ":DONE");
        assert_eq!(first_dump(&text), "50494e470d", "session output {text:?}");
        // The fixture's second read only completes if a second delivery
        // landed, so `SECOND` appearing is the duplicate. Settle first: the
        // replay has already returned, and anything it wrote would be in
        // the PTY by now.
        let settled = session_output_after(&fixture.data_dir, &session, &incarnation);
        assert!(
            !settled.contains(":SECOND"),
            "the replay delivered the message twice: {settled:?}"
        );
    }));
    fixture.shut_down();
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}
