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
/// Same, per table row: the send has already returned, so an over-delivered
/// byte is in the PTY and the fixture only needs a moment to echo it.
const ROW_SETTLE: Duration = Duration::from_millis(250);

/// Dumps, in hex between `:` markers, exactly the first `$1` bytes the PTY
/// delivered, then reads ONE more byte. `dd bs=1` reads a byte at a time, so
/// the dump never depends on where a read boundary happened to fall.
/// The second read is how anything beyond the expected bytes becomes
/// visible: with an exact delivery it blocks forever and `EXTRA` never
/// appears.
const RAW_READER_SCRIPT: &str = r#"#!/bin/sh
stty raw -echo
printf '%b' "$2"
printf 'READY:'
dd bs=1 count="$1" 2>/dev/null | od -An -v -tx1 | tr -d '[:space:]'
printf ':DONE:'
dd bs=1 count=1 2>/dev/null | od -An -v -tx1 | tr -d '[:space:]'
printf ':EXTRA'
"#;

/// Issue #625's far end: a TUI that asked for bracketed paste and is then
/// BUSY. It announces `ESC [ ? 2004 h`, says READY, and spends the next
/// few seconds not reading its input at all — exactly a Claude Code
/// session mid-turn. Everything written meanwhile queues in the PTY, so
/// the single `dd` afterwards takes it all in ONE read, which is the
/// condition under which a paste heuristic swallows a fused Return.
const BUSY_PASTE_TUI_SCRIPT: &str = r#"#!/bin/sh
stty raw -echo
printf '\033[?2004h'
printf 'READY:'
sleep "$1"
dd bs=65536 count=1 2>/dev/null | od -An -v -tx1 | tr -d '[:space:]'
printf ':DONE'
"#;

/// The other far end: a TUI blocked in `read()` with no bracketed paste.
/// It dumps its first TWO reads separately, so where the read boundary
/// fell is visible — which is how "the Return went out as its own write"
/// stops being a claim and becomes an observation.
const TWO_READS_SCRIPT: &str = r#"#!/bin/sh
stty raw -echo
printf 'READY:A:'
dd bs=65536 count=1 2>/dev/null | od -An -v -tx1 | tr -d '[:space:]'
printf ':B:'
dd bs=65536 count=1 2>/dev/null | od -An -v -tx1 | tr -d '[:space:]'
printf ':END'
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
fn session_output_after(
    data_dir: &Path,
    session: &str,
    incarnation: &str,
    settle: Duration,
) -> String {
    let deadline = Instant::now() + settle;
    while Instant::now() < deadline {
        std::thread::sleep(POLL_INTERVAL);
    }
    session_output(data_dir, session, incarnation)
}

/// A session the fixture is still running. Checked before a negative
/// assertion so "nothing more arrived" cannot really mean "the reader died".
fn assert_still_live(data_dir: &Path, session: &str, incarnation: &str, label: &str) {
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
            "1",
        ],
    );
    assert_eq!(
        read["result"]["session"]["verdict"], "live",
        "{label}: the fixture must still be reading: {read:#}"
    );
}

fn write_script(dir: &Path, name: &str, body: &str) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, body).expect("write fixture");
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
    busy_paste_tui: PathBuf,
    two_reads: PathBuf,
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
        let reader = write_script(&workspace, "raw-reader.sh", RAW_READER_SCRIPT);
        let busy_paste_tui = write_script(&workspace, "busy-paste-tui.sh", BUSY_PASTE_TUI_SCRIPT);
        let two_reads = write_script(&workspace, "two-reads.sh", TWO_READS_SCRIPT);
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
            busy_paste_tui,
            two_reads,
            _root: root,
        }
    }

    /// A session running the raw-mode reader, already blocked on its first
    /// read of `expect_bytes` bytes.
    fn raw_session(&self, expect_bytes: usize) -> (String, String) {
        self.raw_session_with_modes(expect_bytes, "")
    }

    /// The same reader, but announcing `modes` first (a `printf '%b'`
    /// string, so `\033[?2004h` turns bracketed paste on). Waiting for
    /// `READY:` is what makes the announcement ordered: the daemon scans
    /// each output chunk for mode changes BEFORE the chunk is readable,
    /// so output that shows `READY:` cannot precede the flag.
    fn raw_session_with_modes(&self, expect_bytes: usize, modes: &str) -> (String, String) {
        self.script_session(
            self.reader.clone(),
            &[&expect_bytes.to_string(), modes],
            "READY:",
        )
    }

    /// A session running `script` with `args`, waited until it prints
    /// `marker`.
    fn script_session(&self, script: PathBuf, args: &[&str], marker: &str) -> (String, String) {
        let script = script.to_str().expect("utf-8 path").to_string();
        let mut argv = vec![
            "terminal",
            "create",
            "--workspace",
            &self.workspace_id,
            "--",
            "/bin/sh",
            &script,
        ];
        argv.extend_from_slice(args);
        let created = ok(&self.data_dir, &argv);
        let session = field(&created, "/result/id");
        let incarnation = field(&created, "/result/incarnation");
        wait_for_marker(&self.data_dir, &session, &incarnation, marker);
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
        // Nothing BUT the submit.
        Case {
            text: "\n",
            literal: false,
            hex: "0d",
            accepted: 1,
            submitted_enter: true,
        },
        Case {
            text: "\r\n",
            literal: false,
            hex: "0d",
            accepted: 1,
            submitted_enter: true,
        },
        // An interior carriage return is the caller's byte, passed through
        // rather than guessed at — it is Return to the reader, which is why
        // the guide tells a caller with CRLF line endings to convert them.
        Case {
            text: "A\rB\n",
            literal: false,
            hex: "410d420d",
            accepted: 4,
            submitted_enter: true,
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
            // The dump is the first `n` bytes, so over-delivery would match
            // it by prefix. The fixture's one extra read is what rules that
            // out — and the reader has to still be alive for its silence to
            // mean anything.
            assert_still_live(&fixture.data_dir, &session, &incarnation, &label);
            let settled =
                session_output_after(&fixture.data_dir, &session, &incarnation, ROW_SETTLE);
            assert!(
                !settled.contains(":EXTRA"),
                "{label}: more bytes reached the PTY than were asked for: {settled:?}"
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
        // The fixture's extra read only completes if another byte arrived,
        // so `EXTRA` appearing is the duplicate. Both legs of the negative
        // assertion are covered: the first delivery is proven by `:DONE`
        // above, and the reader is proven to still be waiting below, so
        // silence cannot mean "nothing was ever sent" or "the reader died".
        assert_still_live(&fixture.data_dir, &session, &incarnation, "replay");
        let settled = session_output_after(&fixture.data_dir, &session, &incarnation, SETTLE);
        assert!(
            !settled.contains(":EXTRA"),
            "the replay delivered the message twice: {settled:?}"
        );
    }));
    fixture.shut_down();
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

// --- issue #625: the Return survives a mid-turn paste-detecting TUI ---

/// Bracketed-paste framing, as a terminal writes it.
const PASTE_START: &[u8] = b"\x1b[200~";
const PASTE_END: &[u8] = b"\x1b[201~";

/// A message long enough to be a message. Kept well under a PTY input
/// queue (1 KiB on the tighter of the platforms this runs on) so the
/// fixture's single `read()` really does get the whole thing — the test
/// is about where the Return lands, not about short reads.
const LONG_MESSAGE: &str = "Update from the owner (relayed by a bot): main is blocked. \
Your PR must target the v2 branch, NOT main. If you already opened it against main, \
retarget it, and do not stop at opening the PR: say exactly why in the issue comment.";

/// How a paste-aware TUI reads what arrives on its stdin.
///
/// This is a model, and it is stated rather than assumed: bytes framed
/// between `ESC [ 200 ~` and `ESC [ 201 ~` are text, never keys; outside a
/// frame, a burst bigger than a few keystrokes is taken for a paste (the
/// heuristic every TUI that lacks framing has to fall back on, and the one
/// #625 tripped over) and its bytes are text too; anything else is
/// keystrokes, and `CR` is the key that submits.
///
/// It is fed the bytes a REAL fixture reported reading, one call per real
/// `read()`, so what it judges is an observation, not a simulation.
#[derive(Debug, Default)]
struct PasteAwareTui {
    composer: String,
    submitted: Vec<String>,
}

/// Longest burst this model still reads as typing rather than as a paste.
///
/// It is deliberately the most pessimistic value that is still coherent —
/// three bytes, one key or two — because the model exists to catch the
/// bug, not to flatter the fix. The daemon's framing threshold is the
/// same number, and
/// `every_body_the_daemon_declines_to_frame_is_keystroke_sized` asserts
/// that the two stay lined up: nothing this model would swallow is left
/// unframed.
const KEYSTROKE_BURST_MAX: usize = 3;

impl PasteAwareTui {
    /// One `read()` worth of bytes.
    fn read_burst(&mut self, burst: &[u8]) {
        let mut rest = burst;
        while !rest.is_empty() {
            match find(rest, PASTE_START) {
                Some(0) => {
                    let body = &rest[PASTE_START.len()..];
                    let end = find(body, PASTE_END).unwrap_or(body.len());
                    self.insert(&body[..end]);
                    rest = &body[(end + PASTE_END.len()).min(body.len())..];
                }
                Some(at) => {
                    self.plain(&rest[..at]);
                    rest = &rest[at..];
                }
                None => {
                    self.plain(rest);
                    rest = &[];
                }
            }
        }
    }

    fn plain(&mut self, bytes: &[u8]) {
        if bytes.len() > KEYSTROKE_BURST_MAX {
            // Too much at once to be typing: a paste, Return and all.
            self.insert(bytes);
            return;
        }
        for byte in bytes {
            match byte {
                b'\r' => {
                    let turn = std::mem::take(&mut self.composer);
                    self.submitted.push(turn);
                }
                _ => self.insert(&[*byte]),
            }
        }
    }

    fn insert(&mut self, bytes: &[u8]) {
        self.composer
            .push_str(&String::from_utf8_lossy(bytes).replace('\r', "\n"));
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn from_hex(hex: &str) -> Vec<u8> {
    assert!(hex.len().is_multiple_of(2), "odd hex dump: {hex:?}");
    (0..hex.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(&hex[at..at + 2], 16).expect("hex byte"))
        .collect()
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The dump between two markers.
fn between(text: &str, start: &str, end: &str) -> String {
    text.rsplit(start)
        .next()
        .unwrap_or_else(|| panic!("no {start:?} in {text:?}"))
        .split(end)
        .next()
        .unwrap_or_else(|| panic!("no {end:?} after {start:?} in {text:?}"))
        .to_string()
}

/// The model has to fail on the broken shape, or it proves nothing about
/// the fixed one. This is the byte stream #625 described: body and Return
/// fused, delivered in one read to a TUI that was too busy to be blocked
/// in `read()`.
#[test]
fn the_tui_model_does_not_submit_the_fused_delivery_that_was_reported() {
    let mut tui = PasteAwareTui::default();
    tui.read_burst(format!("{LONG_MESSAGE}\r").as_bytes());
    assert!(
        tui.submitted.is_empty(),
        "the pre-fix delivery must NOT submit, or this model cannot detect \
         the bug: {:?}",
        tui.submitted
    );
    assert!(
        tui.composer.starts_with("Update from the owner"),
        "...and the message must be sitting in the composer, which is what \
         the issue reported: {:?}",
        tui.composer
    );

    // Short input is still typing: the heuristic must not eat every Return.
    let mut typed = PasteAwareTui::default();
    typed.read_burst(b"y\r");
    assert_eq!(typed.submitted, vec!["y".to_string()]);
}

/// The daemon's framing threshold and this model's paste cutoff have to
/// stay lined up, or the suite would bless a gap: a body too big for the
/// model to call typing but too small for the daemon to frame is exactly
/// the shape that goes out unframed and is then swallowed. An adversarial
/// pass found that gap when the two were 16 and 8 — and then found that
/// the first version of this test only illustrated the invariant with two
/// hand-picked strings, so moving the daemon's threshold did not fail it.
///
/// So it asks the daemon. It walks body lengths upward against a real
/// session until the service reports the first framed one, which IS the
/// threshold wherever it is set, and then checks the largest unframed
/// body against the model.
#[test]
fn every_body_the_daemon_declines_to_frame_is_keystroke_sized() {
    let fixture = Fixture::start("dg-inv-");
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // Well past any plausible threshold; a body of this length that
        // is still unframed would be a finding of its own.
        const PROBE_MAX: usize = 64;
        let mut first_framed = None;
        for length in 1..=PROBE_MAX {
            let body = "a".repeat(length);
            // Byte-exact reading is what the framing table is for; here
            // only the service's own answer matters. The reader is asked
            // for far more bytes than any framed body can be, so it
            // stays blocked and cannot exit between the body and the
            // Return — that window is real, and the framing table's
            // exact counts are where it is accounted for.
            let (session, incarnation) =
                fixture.raw_session_with_modes(PROBE_MAX * 4, r"\033[?2004h");
            let sent = ok(
                &fixture.data_dir,
                &[
                    "terminal",
                    "send",
                    "--session",
                    session.as_str(),
                    "--incarnation",
                    incarnation.as_str(),
                    "--text",
                    &format!("{body}\n"),
                ],
            );
            let framed = sent["result"]["bracketedPaste"]
                .as_bool()
                .unwrap_or_else(|| panic!("bracketedPaste missing: {sent:#}"));
            fixture.close(&session, &incarnation);
            if framed {
                first_framed = Some(length);
                break;
            }
        }
        let first_framed = first_framed.unwrap_or_else(|| {
            panic!("no body up to {PROBE_MAX} bytes was framed on a session with paste on")
        });
        assert!(
            first_framed >= 2,
            "a one-byte body is a keystroke and must never be framed"
        );

        // The largest body the daemon declines to frame reaches the far
        // end together with its Return, as one burst of that many bytes
        // plus one. That burst has to be small enough for the model to
        // still call it typing, or it is swallowed.
        let largest_unframed = first_framed - 1;
        let burst = largest_unframed + 1;
        assert!(
            burst <= KEYSTROKE_BURST_MAX,
            "the daemon leaves a {largest_unframed}-byte body unframed, which \
             reaches the far end as a {burst}-byte burst with its Return — \
             bigger than the {KEYSTROKE_BURST_MAX} bytes this suite's model \
             still reads as typing, so it would be swallowed"
        );

        // And the two claims the invariant rests on, against the model.
        let mut typed = PasteAwareTui::default();
        typed.read_burst(format!("{}\r", "a".repeat(largest_unframed)).as_bytes());
        assert_eq!(
            typed.submitted,
            vec!["a".repeat(largest_unframed)],
            "the largest unframed body must still submit from one read"
        );
        let mut swallowed = PasteAwareTui::default();
        swallowed.read_burst(format!("{}\r", "a".repeat(first_framed)).as_bytes());
        assert!(
            swallowed.submitted.is_empty(),
            "the first framed length must be one the model would swallow \
             unframed, or the threshold is lower than it needs to be: {:?}",
            swallowed.submitted
        );
    }));
    fixture.shut_down();
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// The headline regression. A long, single-line message sent to a
/// bracketed-paste TUI that is mid-turn: the bytes are captured from a
/// real PTY, from a real `read()` that really did get them all at once,
/// and then judged by the model above.
#[test]
fn a_long_message_submits_on_a_busy_paste_detecting_tui() {
    let fixture = Fixture::start("dg-busy-");
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let (session, incarnation) = fixture.script_session(
            fixture.busy_paste_tui.clone(),
            // Long enough that the send lands while the fixture is still
            // not reading. If it ever does not, the one-read assertion
            // below fails loudly rather than passing for the wrong reason.
            &["5"],
            "READY:",
        );
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
                &format!("{LONG_MESSAGE}\n"),
            ],
        );
        // `acceptedBytes` is still the caller's payload: framing is the
        // transport's business and is not billed to the caller.
        assert_eq!(
            sent["result"]["acceptedBytes"],
            (LONG_MESSAGE.len() + 1) as u64,
            "{sent:#}"
        );
        assert_eq!(sent["result"]["submittedEnter"], true, "{sent:#}");
        assert_eq!(sent["result"]["enterDelivery"], "keypress", "{sent:#}");
        assert_eq!(sent["result"]["bracketedPaste"], true, "{sent:#}");

        let text = wait_for_marker(&fixture.data_dir, &session, &incarnation, ":DONE");
        let burst = from_hex(&between(&text, "READY:", ":DONE"));

        // What one read actually delivered: the body inside a paste frame,
        // and the Return AFTER the marker that closes it.
        let expected = [PASTE_START, LONG_MESSAGE.as_bytes(), PASTE_END, b"\r"].concat();
        assert_eq!(
            to_hex(&burst),
            to_hex(&expected),
            "one read delivered {:?}",
            String::from_utf8_lossy(&burst)
        );

        // And that is enough for the TUI to submit, from one read, busy.
        let mut tui = PasteAwareTui::default();
        tui.read_burst(&burst);
        assert_eq!(
            tui.submitted,
            vec![LONG_MESSAGE.to_string()],
            "composer left holding {:?}",
            tui.composer
        );

        fixture.close(&session, &incarnation);
    }));
    fixture.shut_down();
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// The gap an adversarial pass found: a body too short to be framed under
/// the old sixteen-byte threshold, but long enough to be read as a paste,
/// sent to the same busy far end. It coalesced with its Return into one
/// read and, by the model above, sat unsubmitted while the caller was
/// told `keypress`. Eight bytes is a message now, so it is framed and it
/// submits.
#[test]
fn a_short_message_submits_on_a_busy_paste_detecting_tui() {
    const SHORT: &str = "continue";
    let fixture = Fixture::start("dg-short-");
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let (session, incarnation) =
            fixture.script_session(fixture.busy_paste_tui.clone(), &["5"], "READY:");
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
                &format!("{SHORT}\n"),
            ],
        );
        assert_eq!(sent["result"]["bracketedPaste"], true, "{sent:#}");
        assert_eq!(sent["result"]["enterDelivery"], "keypress", "{sent:#}");

        let text = wait_for_marker(&fixture.data_dir, &session, &incarnation, ":DONE");
        let burst = from_hex(&between(&text, "READY:", ":DONE"));
        let expected = [PASTE_START, SHORT.as_bytes(), PASTE_END, b"\r"].concat();
        assert_eq!(to_hex(&burst), to_hex(&expected));
        let mut tui = PasteAwareTui::default();
        tui.read_burst(&burst);
        assert_eq!(
            tui.submitted,
            vec![SHORT.to_string()],
            "composer left holding {:?}",
            tui.composer
        );

        fixture.close(&session, &incarnation);
    }));
    fixture.shut_down();
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// The issue's follow-up shape, pinned so its scope is not overclaimed: a
/// lone Return to the same busy TUI. One byte cannot be mistaken for a
/// paste by any burst-size heuristic, and it is not framed, so this
/// delivery is byte-identical before and after the fix. It submits here.
/// That is the evidence for the limit stated in `terminal_send`'s module
/// doc: whatever swallowed the reporter's follow-up Return, it was not
/// this mechanism, and this change does not claim to have fixed it.
#[test]
fn a_lone_return_reaches_a_busy_paste_detecting_tui_as_one_keypress() {
    let fixture = Fixture::start("dg-lone-");
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let (session, incarnation) =
            fixture.script_session(fixture.busy_paste_tui.clone(), &["5"], "READY:");
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
                "\n",
            ],
        );
        assert_eq!(sent["result"]["acceptedBytes"], 1, "{sent:#}");
        assert_eq!(sent["result"]["enterDelivery"], "keypress", "{sent:#}");
        assert_eq!(sent["result"]["bracketedPaste"], false, "{sent:#}");

        let text = wait_for_marker(&fixture.data_dir, &session, &incarnation, ":DONE");
        let burst = from_hex(&between(&text, "READY:", ":DONE"));
        assert_eq!(to_hex(&burst), "0d", "one read delivered {burst:?}");
        let mut tui = PasteAwareTui::default();
        tui.read_burst(&burst);
        assert_eq!(
            tui.submitted,
            vec![String::new()],
            "a lone Return must submit"
        );

        fixture.close(&session, &incarnation);
    }));
    fixture.shut_down();
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// The other half of the delivery: with no bracketed paste to frame, the
/// Return still has to be its own write. A reader blocked in `read()`
/// proves it — the body comes back from one read and the Return from the
/// next. Fused, the second read would never return and `:END` would never
/// be printed.
#[test]
fn the_return_arrives_in_a_read_of_its_own() {
    let fixture = Fixture::start("dg-two-");
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let (session, incarnation) =
            fixture.script_session(fixture.two_reads.clone(), &[], "READY:A:");
        const BODY: &str = "please rebase onto v2 and rerun the gates";
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
                &format!("{BODY}\n"),
            ],
        );
        assert_eq!(sent["result"]["enterDelivery"], "keypress", "{sent:#}");
        // This far end never asked for bracketed paste, so it must not be
        // handed paste markers it would show as literal text.
        assert_eq!(sent["result"]["bracketedPaste"], false, "{sent:#}");

        let text = wait_for_marker(&fixture.data_dir, &session, &incarnation, ":END");
        let first = from_hex(&between(&text, "READY:A:", ":B:"));
        let second = from_hex(&between(&text, ":B:", ":END"));
        assert_eq!(
            String::from_utf8_lossy(&first),
            BODY,
            "the first read must be the body alone"
        );
        assert_eq!(to_hex(&second), "0d", "the second read must be the Return");

        fixture.close(&session, &incarnation);
    }));
    fixture.shut_down();
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// One row of the framing policy: what a session that asked for bracketed
/// paste is handed, and why.
struct FrameCase {
    what: &'static str,
    modes: &'static str,
    text: &'static str,
    literal: bool,
    framed: bool,
    hex: &'static str,
}

/// Framing bytes a far end never asked for — or that would turn a
/// keystroke into text — would be a worse bug than the one being fixed.
/// This is the whole gate, in both directions.
#[test]
fn bracketed_framing_is_applied_only_where_it_is_safe_and_needed() {
    const ON: &str = r"\033[?2004h";
    const OFF_AGAIN: &str = r"\033[?2004h\033[?2004l";
    const ALT_SCREEN: &str = r"\033[?1049h\033[?2004h";
    const BACK_FROM_ALT: &str = r"\033[?1049h\033[?2004h\033[?1049l";
    const CASES: &[FrameCase] = &[
        FrameCase {
            what: "a message-sized body to a TUI that asked for paste",
            modes: ON,
            text: "rebase onto v2 please\n",
            literal: false,
            framed: true,
            hex: "1b5b3230307e7265626173652\
                  06f6e746f20763220706c656173651b5b3230317e0d",
        },
        FrameCase {
            what: "a single-key answer stays a keystroke",
            modes: ON,
            text: "y\n",
            literal: false,
            framed: false,
            hex: "790d",
        },
        // The threshold itself, from both sides.
        FrameCase {
            what: "two bytes is still a key or two",
            modes: ON,
            text: "ab\n",
            literal: false,
            framed: false,
            hex: "61620d",
        },
        FrameCase {
            what: "three bytes is a message",
            modes: ON,
            text: "abc\n",
            literal: false,
            framed: true,
            hex: "1b5b3230307e6162631b5b3230317e0d",
        },
        // The body an adversarial pass coalesced with its Return on a
        // busy far end while the threshold was still sixteen.
        FrameCase {
            what: "a short word is a message, not keystrokes",
            modes: ON,
            text: "continue\n",
            literal: false,
            framed: true,
            hex: "1b5b3230307e636f6e74696e75651b5b3230317e0d",
        },
        FrameCase {
            what: "a tab is text, not a key that blocks framing",
            modes: ON,
            text: "abcdefghijklmnop\tqrst\n",
            literal: false,
            framed: true,
            hex: "1b5b3230307e6162636465666768696a6b6c6d6e6f700971727374\
                  1b5b3230317e0d",
        },
        // The threshold counts BYTES, and a framed body is passed through
        // byte for byte — no transcoding, no sanitizing.
        FrameCase {
            what: "non-ASCII is measured and delivered in bytes",
            modes: ON,
            text: "héllo → wörld ✓✓\n",
            literal: false,
            framed: true,
            hex: "1b5b3230307e68c3a96c6c6f20e286922077c3b6726c6420e29c93\
                  e29c931b5b3230317e0d",
        },
        // A body that spells the closing marker cannot escape a frame,
        // because its ESC is exactly what stops it being framed at all.
        FrameCase {
            what: "a body spelling the end marker is never framed",
            modes: ON,
            text: "abcdefghijklmnop\u{1b}[201~qrst\n",
            literal: false,
            framed: false,
            hex: "6162636465666768696a6b6c6d6e6f701b5b3230317e717273740d",
        },
        // Issue #625's follow-up shape: a lone Return. There is no body to
        // frame and nothing to pace it against, so it is one byte, exactly
        // as before the fix — see the module doc on what that does and
        // does not explain.
        FrameCase {
            what: "a lone Return is one byte and is never framed",
            modes: ON,
            text: "\n",
            literal: false,
            framed: false,
            hex: "0d",
        },
        FrameCase {
            what: "a short multi-line body is still a message",
            modes: ON,
            text: "a\nb\n",
            literal: false,
            framed: true,
            hex: "1b5b3230307e610a621b5b3230317e0d",
        },
        FrameCase {
            what: "an ESC in the body would break the frame",
            modes: ON,
            text: "abcdefghijklmnop\u{1b}q\n",
            literal: false,
            framed: false,
            hex: "6162636465666768696a6b6c6d6e6f701b710d",
        },
        FrameCase {
            what: "a control byte in the body is a key, not text",
            modes: ON,
            text: "abcdefghijklmnop\u{3}\n",
            literal: false,
            framed: false,
            hex: "6162636465666768696a6b6c6d6e6f70030d",
        },
        FrameCase {
            what: "an interior carriage return keeps its documented meaning",
            modes: ON,
            text: "abcdefghijklmnop\rqrstuvwx\n",
            literal: false,
            framed: false,
            hex: "6162636465666768696a6b6c6d6e6f700d717273747576777\
                  80d",
        },
        FrameCase {
            what: "no Return to disambiguate, so nothing to frame",
            modes: ON,
            text: "rebase onto v2 please",
            literal: false,
            framed: false,
            hex: "7265626173\
                  65206f6e746f20763220706c65617365",
        },
        FrameCase {
            what: "--literal is byte-exact, always",
            modes: ON,
            text: "rebase onto v2 please\n",
            literal: true,
            framed: false,
            hex: "7265626173\
                  65206f6e746f20763220706c656173650a",
        },
        FrameCase {
            what: "a TUI that never asked for paste is never framed",
            modes: "",
            text: "rebase onto v2 please\n",
            literal: false,
            framed: false,
            hex: "726562617365206f6e746f20763220706c656173650d",
        },
        // vim's shape. It announces bracketed paste like any composer,
        // but a paste is text there, not the Ex command the caller
        // typed — an adversarial pass watched `:wq` put vim into INSERT
        // while the send reported success.
        FrameCase {
            what: "a full-screen application on the alternate screen is not framed",
            modes: ALT_SCREEN,
            text: ":wq\n",
            literal: false,
            framed: false,
            hex: "3a77710d",
        },
        FrameCase {
            what: "...not even for a long message",
            modes: ALT_SCREEN,
            text: "rebase onto v2 please\n",
            literal: false,
            framed: false,
            hex: "726562617365206f6e746f20763220706c656173650d",
        },
        // Leaving the alternate screen gives the paste its meaning back.
        FrameCase {
            what: "back on the normal screen, framing resumes",
            modes: BACK_FROM_ALT,
            text: "rebase onto v2 please\n",
            literal: false,
            framed: true,
            hex: "1b5b3230307e726562617365206f6e746f20763220706c65617365\
                  1b5b3230317e0d",
        },
        FrameCase {
            what: "a TUI that turned paste back off is not framed either",
            modes: OFF_AGAIN,
            text: "rebase onto v2 please\n",
            literal: false,
            framed: false,
            hex: "726562617365206f6e746f20763220706c656173650d",
        },
    ];

    let fixture = Fixture::start("dg-frame-");
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        for case in CASES {
            let hex: String = case.hex.split_whitespace().collect();
            let (session, incarnation) = fixture.raw_session_with_modes(hex.len() / 2, case.modes);
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
            assert_eq!(
                sent["result"]["bracketedPaste"], case.framed,
                "{}: {sent:#}",
                case.what
            );
            let text = wait_for_marker(&fixture.data_dir, &session, &incarnation, ":DONE");
            assert_eq!(first_dump(&text), hex, "{}: output {text:?}", case.what);
            assert_still_live(&fixture.data_dir, &session, &incarnation, case.what);
            let settled =
                session_output_after(&fixture.data_dir, &session, &incarnation, ROW_SETTLE);
            assert!(
                !settled.contains(":EXTRA"),
                "{}: more bytes reached the PTY than were asked for: {settled:?}",
                case.what
            );
            fixture.close(&session, &incarnation);
        }
    }));
    fixture.shut_down();
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// Two agents nudging one session must not interleave, and the paced
/// Return is the window that could let them. The daemon holds the writer
/// lock across body and Return, so each message arrives whole; the reader
/// sees two complete lines, never a fused one.
#[test]
fn concurrent_sends_do_not_interleave_across_the_paced_return() {
    let fixture = Fixture::start("dg-race-");
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        const A: &str = "AAAAAAAAAAAAAAAAAAAAAAAA";
        const B: &str = "BBBBBBBBBBBBBBBBBBBBBBBB";
        let expected = A.len() + B.len() + 2;
        let (session, incarnation) = fixture.raw_session(expected);
        let mut senders = Vec::new();
        for body in [A, B] {
            let data_dir = fixture.data_dir.clone();
            let session = session.clone();
            let incarnation = incarnation.clone();
            senders.push(std::thread::spawn(move || {
                ok(
                    &data_dir,
                    &[
                        "terminal",
                        "send",
                        "--session",
                        &session,
                        "--incarnation",
                        &incarnation,
                        "--text",
                        &format!("{body}\n"),
                    ],
                );
            }));
        }
        for sender in senders {
            sender.join().expect("sender thread");
        }
        let text = wait_for_marker(&fixture.data_dir, &session, &incarnation, ":DONE");
        let delivered = String::from_utf8(from_hex(&first_dump(&text))).expect("utf-8");
        let mut lines: Vec<&str> = delivered.split('\r').filter(|s| !s.is_empty()).collect();
        lines.sort_unstable();
        assert_eq!(
            lines,
            vec![A, B],
            "a message was split by the other one: {delivered:?}"
        );
        fixture.close(&session, &incarnation);
    }));
    fixture.shut_down();
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}
