//! V1 dogfood: one real fixture task through the native `drogond` daemon and
//! `drogon-cli`, with no Orca underneath product execution.
//!
//! This spawns the actual compiled `drogond` binary (built as a side effect
//! of this test, since it is a sibling crate's binary and not otherwise on
//! `CARGO_BIN_EXE_*`) against an ephemeral, throwaway `--data-dir`, then
//! drives it exclusively through the compiled `drogon-cli` binary: run/task
//! creation, a fresh worker launch, a failure + explicit retry, artifact
//! inspection on disk, and a genuine late/conflicting final-report refusal
//! sent by the worker itself. The "model" is a fixture shell script standing
//! in for an installed harness (named `claude` on `PATH`, matching
//! `drogon_harness::HarnessId::Claude::executable()`), so the run exercises
//! the real admission/spawn/report/retry/release code paths without network
//! access or a real provider.
//!
//! A second test, [`real_model_probe_reaches_a_daemon_spawned_session`],
//! extends this with one bounded *real* model completion routed through the
//! same daemon-owned session-spawn engine (`session.start` -> `spawn_pty`)
//! that both `terminal create` and every harness launch use. It costs a real
//! (small) amount of real provider spend and reaches the network, so it only
//! runs when explicitly opted into via `DROGON_DOGFOOD_REAL_MODEL` with the
//! exact value `1`; any other value (unset, empty, `0`, …) skips before any
//! build, spawn or spend, and dedicated negative tests pin that skip path.
//!
//! A third test, [`real_model_coordinated_journey_creates_and_reports_an_owned_artifact`],
//! is the follow-up this suite's own evidence doc explicitly deferred: a real
//! model driven through the exact same `orchestration task-create` ->
//! `orchestration worker-start` path the fixture leg exercises (not the
//! lower-risk plain `terminal create` the second test uses), asked to create
//! an owned artifact and report completion through `drogon-cli` itself, with
//! a second, deliberately conflicting final report proving the late-report
//! refusal for real. It shares the exact same opt-in gate and is bounded the
//! same way: unset/empty/`0`/non-`1` skips before any build, daemon, session
//! or spend, and the same negative-test family pins that skip path for both
//! real-model legs.

#![cfg(unix)]

mod common;

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde_json::Value;

use common::{run_cli, stderr, stdout};

const BUILD_TIMEOUT: Duration = Duration::from_secs(300);
const READY_TIMEOUT: Duration = Duration::from_secs(15);
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(15);
const POLL_INTERVAL: Duration = Duration::from_millis(25);
/// Real network + model latency is not instant like the fixture leg, but
/// this is still a single trivial, non-agentic, tool-free completion: bounded
/// generously above the ~2-9s observed locally, nowhere near unbounded.
const REAL_MODEL_TIMEOUT: Duration = Duration::from_secs(60);
const REAL_MODEL_OPT_IN_ENV: &str = "DROGON_DOGFOOD_REAL_MODEL";

/// Approved real-model lane, pinned exactly as the `--print` probe leg was
/// pinned in an earlier review round, so the coordinated-journey leg cannot
/// drift onto an unapproved or default model.
const REAL_MODEL_JOURNEY_MODEL_ID: &str = "claude-sonnet-5";
/// Real agentic tool use (read instructions, invoke bash, exit) is slower and
/// less deterministic than the trivial `--print` completion above; bounded
/// generously above expected single-digit-second-to-low-tens-of-seconds
/// latency for one scripted tool call, still a hard cap enforced by this
/// test's own poll loop (the daemon's `--timeout-ms` is a budget hint, not a
/// kill deadline, so it does not by itself bound anything).
const REAL_MODEL_JOURNEY_TIMEOUT: Duration = Duration::from_secs(180);
/// Bounded window to observe the explicitly stopped worker process actually
/// leave `live` before releasing, so release never races a signal still in
/// flight.
const STOP_OBSERVATION_TIMEOUT: Duration = Duration::from_secs(15);
/// Explicit output cap (max `workerRead` entries, not bytes) for the one
/// diagnostic read this leg performs: evidence/panic-context only, never a
/// pass/fail assertion, and never an unbounded read of a real agent's own
/// session output.
const REAL_MODEL_JOURNEY_READ_LIMIT: u32 = 200;

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crates/drogon-cli has a parent")
        .parent()
        .expect("crates/ has a parent")
        .to_path_buf()
}

/// Builds the real `drogond` binary (not otherwise available via
/// `CARGO_BIN_EXE_*` from this package) and returns its path alongside the
/// already-built `drogon-cli` binary in the same target directory, matching
/// the daemon's own sibling-executable discovery (`configure_worker_cli`).
///
/// Both stdio pipes are drained by concurrent reader threads from the start:
/// a chatty `cargo build` must never fill a pipe buffer and block the
/// compiler, which would masquerade as the build timeout below.
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
                let _ = pipe.read_to_string(&mut text);
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

/// A fixture "harness" standing in for a real installed model CLI. It is
/// named `claude` so `drogon_harness::discover` (run inside the daemon
/// process, against the daemon's own `PATH`) finds it exactly as it would a
/// real Claude Code install. Behavior is controlled entirely through
/// `--model`, the one launch preference the coordinator can freely set:
/// `fixture-fail` reports a failed final report, anything else reports
/// success. On the success path it additionally exercises a genuine late,
/// conflicting final-report from the *same* worker credential, capturing the
/// daemon's refusal to disk for the test to inspect.
const FIXTURE_HARNESS_SCRIPT: &str = r#"#!/usr/bin/env bash
set -u

mode="fixture-succeed"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --model)
      mode="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

printf 'DROGON-FIXTURE-ARTIFACT dispatch=%s task=%s mode=%s\n' \
  "${DROGON_DISPATCH_ID:-}" "${DROGON_TASK_ID:-}" "$mode" > artifact.txt

if [ "$mode" = "fixture-fail" ]; then
  outcome="failed"
else
  outcome="succeeded"
fi

"$DROGON_CLI_COMMAND" --data-dir "$DROGON_DATA_DIR" --json orchestration send \
  --type worker_done --subject "fixture $mode" --outcome "$outcome" \
  --body "fixture worker report" \
  --task-id "${DROGON_TASK_ID:-}" --dispatch-id "${DROGON_DISPATCH_ID:-}" \
  --files-modified "artifact.txt,done" --report-path "artifact.txt" > first-report.json 2> first-report.stderr
first_status=$?

if [ "$mode" != "fixture-fail" ]; then
  "$DROGON_CLI_COMMAND" --data-dir "$DROGON_DATA_DIR" --json orchestration send \
    --kind final-report --subject "late duplicate" --outcome failed \
    --body "late duplicate report from the same settled worker" > late-report.json 2>&1
  echo "$?" > late-report.exit
fi

# Written strictly after every prior redirect has been fully written and
# closed (sequential shell execution): the one signal the test polls for, so
# it never observes a file a moment after its `>` truncated it but before the
# command actually finished writing.
touch done
exit "$first_status"
"#;

fn write_fixture_harness(bin_dir: &Path) -> PathBuf {
    std::fs::create_dir_all(bin_dir).expect("create fixture bin dir");
    let path = bin_dir.join("claude");
    std::fs::write(&path, FIXTURE_HARNESS_SCRIPT).expect("write fixture harness script");
    let mut perms = std::fs::metadata(&path)
        .expect("stat fixture harness script")
        .permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&path, perms).expect("chmod fixture harness script");
    path
}

/// Owns the spawned `drogond` process for the test's lifetime: dropped (or
/// explicitly shut down) exactly once, with a bounded wait so the child is
/// reaped rather than left as a zombie or an orphaned live process.
struct Daemon {
    data_dir: PathBuf,
    child: Child,
}

impl Daemon {
    /// `extra_path_prefix`, when present, is prepended onto the daemon's own
    /// `PATH` so `drogon_harness::discover` (run inside the daemon process)
    /// finds an executable placed there ahead of anything already installed
    /// — used by the fixture-harness leg. `None` leaves `PATH` exactly as
    /// this test process inherited it, so discovery finds whatever is
    /// genuinely installed on this host (the real-model leg).
    fn start(drogond_path: &Path, data_dir: &Path, extra_path_prefix: Option<&Path>) -> Daemon {
        let existing_path = std::env::var("PATH").unwrap_or_default();
        let path_value = match extra_path_prefix {
            Some(prefix) => format!("{}:{}", prefix.display(), existing_path),
            None => existing_path,
        };
        let child = Command::new(drogond_path)
            .arg("--data-dir")
            .arg(data_dir)
            .env("PATH", path_value)
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
                // Files existing proves bind+token-write happened; confirm
                // the accept loop actually answers before trusting it.
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
        // Exact release of the process this test itself owns: no graceful
        // RPC dependency (that path is exercised by other suites), just a
        // deterministic signal-then-reap so no child or zombie leaks out of
        // this test regardless of what happened above.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn wait_for_file(path: &Path, timeout: Duration) -> bool {
    let start = Instant::now();
    loop {
        if path.is_file() {
            return true;
        }
        if start.elapsed() > timeout {
            return false;
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

/// Runs the compiled `drogon-cli` as the coordinator actor (service-token
/// auth, no dispatch credential) and parses its `--json` stdout envelope.
fn coordinator_call(data_dir: &Path, args: &[&str]) -> (i32, Value) {
    let mut full = vec!["--json"];
    full.extend_from_slice(args);
    let out = run_cli(data_dir, &full);
    let code = out.status.code().unwrap_or(-1);
    let text = stdout(&out);
    let value = if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or_else(|err| {
            panic!(
                "invalid JSON stdout for {args:?}: {err}\nstdout={text}\nstderr={}",
                stderr(&out)
            )
        })
    };
    (code, value)
}

fn assert_ok(code: i32, value: &Value, args: &[&str]) {
    assert_eq!(
        code, 0,
        "expected success for {args:?}, got exit {code}: {value:#}"
    );
    assert_eq!(
        value["ok"],
        Value::Bool(true),
        "expected ok:true for {args:?}: {value:#}"
    );
}

fn text_field<'a>(value: &'a Value, pointer: &str) -> &'a str {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("missing/non-string field {pointer} in {value:#}"))
}

#[test]
fn terminal_bound_coordinator_uses_source_commands_without_native_scope_flags() {
    let binary = build_drogond();
    let root = tempfile::tempdir().unwrap();
    let data_dir = root.path().join("data");
    let workspace = root.path().join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    let daemon = Daemon::start(&binary, &data_dir, None);
    let (code, ws) = coordinator_call(
        &data_dir,
        &["workspace", "add", workspace.to_str().unwrap()],
    );
    assert_ok(code, &ws, &["workspace", "add"]);
    let (code, terminal) = coordinator_call(
        &data_dir,
        &[
            "terminal",
            "create",
            "--workspace",
            ws["result"]["id"].as_str().unwrap(),
            "--",
            "/bin/sh",
            "-c",
            "while read line; do :; done",
        ],
    );
    assert_ok(code, &terminal, &["terminal", "create"]);
    let session = text_field(&terminal, "/result/id").to_string();
    let guard = SessionGuard {
        data_dir: data_dir.clone(),
        session_id: session.clone(),
        incarnation: text_field(&terminal, "/result/incarnation").to_string(),
        closed: false,
    };
    let create_a = [
        "--request-id",
        "terminal-run-a",
        "orchestration",
        "run-create",
        "--objective",
        "first",
        "--from",
        &session,
    ];
    let (code, first) = coordinator_call(&data_dir, &create_a);
    assert_ok(code, &first, &create_a);
    let a = text_field(&first, "/result/run/runId").to_string();
    let owner = text_field(&first, "/result/run/coordinatorId").to_string();
    let (code, task) = coordinator_call(
        &data_dir,
        &[
            "orchestration",
            "task-create",
            "--spec",
            "fixture task",
            "--from",
            &session,
        ],
    );
    assert_ok(code, &task, &["task-create"]);
    assert_eq!(task["result"]["task"]["runId"], a);
    let task_id = text_field(&task, "/result/task/taskId").to_string();
    let (code, second) = coordinator_call(
        &data_dir,
        &[
            "orchestration",
            "run-create",
            "--objective",
            "second",
            "--from",
            &session,
        ],
    );
    assert_ok(code, &second, &["run-create"]);
    let b = text_field(&second, "/result/run/runId").to_string();
    let (code, replay) = coordinator_call(&data_dir, &create_a);
    assert_ok(code, &replay, &create_a);
    assert_eq!(replay["result"], first["result"]);
    let (code, current) = coordinator_call(
        &data_dir,
        &["orchestration", "run-current", "--from", &session],
    );
    assert_ok(code, &current, &["run-current"]);
    assert_eq!(current["result"]["run"]["runId"], b);
    let from_env = common::run_cli_with(
        &data_dir,
        &["--json", "orchestration", "run-current"],
        &[
            ("DROGON_SESSION_ID", &session),
            (
                "DROGON_SESSION_INCARNATION",
                text_field(&terminal, "/result/incarnation"),
            ),
        ],
    );
    assert!(from_env.status.success(), "{}", stderr(&from_env));
    let from_env: Value = serde_json::from_slice(&from_env.stdout).unwrap();
    assert_eq!(from_env["result"]["run"]["runId"], b);
    let stale = common::run_cli_with(
        &data_dir,
        &["--json", "orchestration", "run-current"],
        &[
            ("DROGON_SESSION_ID", &session),
            ("DROGON_SESSION_INCARNATION", "wrong-birth"),
        ],
    );
    assert!(!stale.status.success());
    let stale: Value = serde_json::from_slice(&stale.stdout).unwrap();
    assert_eq!(stale["error"]["code"], "stale_incarnation");
    // A raw client cannot bypass the daemon's physical caller recheck.
    let forged = serde_json::json!({"contractVersion": 1, "hostId": terminal["result"]["hostId"], "coordinatorId": owner,
        "objective": "forged", "caller": {"sessionId": session, "incarnation": "wrong-birth"}}).to_string();
    let (code, refused) = coordinator_call(
        &data_dir,
        &["rpc", "orchestration.runCreate", "--params", &forged],
    );
    assert_ne!(code, 0);
    assert_eq!(refused["error"]["code"], "invalid_argument");
    let (code, old) = coordinator_call(&data_dir, &["orchestration", "run-show", "--id", &a]);
    assert_ok(code, &old, &["run-show"]);
    assert_eq!(old["result"]["run"]["consumerGeneration"], 2);
    assert_ne!(old["result"]["run"]["coordinatorId"], owner);
    let (code, fenced) = coordinator_call(
        &data_dir,
        &[
            "orchestration",
            "task-update",
            "--id",
            &task_id,
            "--status",
            "completed",
            "--run",
            &a,
            "--coordinator-id",
            &owner,
            "--consumer-generation",
            "1",
        ],
    );
    assert_ne!(code, 0);
    assert_eq!(fenced["error"]["code"], "consumer_fenced");
    let (code, used) = coordinator_call(
        &data_dir,
        &[
            "--request-id",
            "source-use-a",
            "orchestration",
            "run-use",
            "--id",
            &a,
            "--from",
            &session,
        ],
    );
    assert_ok(code, &used, &["run-use"]);
    assert_eq!(used["result"]["run"]["consumerGeneration"], 3);
    let (code, replayed_use) = coordinator_call(
        &data_dir,
        &[
            "--request-id",
            "source-use-a",
            "orchestration",
            "run-use",
            "--id",
            &a,
            "--from",
            &session,
        ],
    );
    assert_ok(code, &replayed_use, &["run-use", "replay"]);
    assert_eq!(replayed_use["result"], used["result"]);
    let (code, tasks) = coordinator_call(
        &data_dir,
        &["orchestration", "task-list", "--from", &session],
    );
    assert_ok(code, &tasks, &["task-list"]);
    assert_eq!(tasks["result"]["tasks"][0]["taskId"], task_id);
    let (code, refused) = coordinator_call(
        &data_dir,
        &[
            "orchestration",
            "task-create",
            "--spec",
            "wrong run",
            "--run",
            &b,
            "--from",
            &session,
        ],
    );
    assert_ne!(code, 0);
    assert_eq!(refused["error"]["code"], "consumer_fenced");
    let (code, inspection) =
        coordinator_call(&data_dir, &["orchestration", "task-list", "--run", &b]);
    assert_ok(code, &inspection, &["task-list", "--run"]);
    assert!(inspection["result"]["tasks"].as_array().unwrap().is_empty());
    let (code, rebound) = coordinator_call(
        &data_dir,
        &["orchestration", "run-use", "--id", &b, "--from", &session],
    );
    assert_ok(code, &rebound, &["run-use"]);
    let (code, late_replay) = coordinator_call(
        &data_dir,
        &[
            "--request-id",
            "source-use-a",
            "orchestration",
            "run-use",
            "--id",
            &a,
            "--from",
            &session,
        ],
    );
    assert_ne!(
        code, 0,
        "replaying a fenced bind must not take the run over again: {late_replay}"
    );
    assert_eq!(late_replay["error"]["code"], "consumer_fenced");
    let closed = guard.close("terminal coordinator fixture");
    assert_eq!(closed["result"]["verdict"], "exited");
    let (code, missing) = coordinator_call(
        &data_dir,
        &["orchestration", "run-current", "--from", &session],
    );
    assert_ne!(code, 0);
    assert_eq!(missing["error"]["code"], "not_found");
    let closed_caller = serde_json::json!({"contractVersion": 1, "hostId": terminal["result"]["hostId"], "coordinatorId": owner,
        "objective": "closed caller", "caller": {"sessionId": session, "incarnation": terminal["result"]["incarnation"]}}).to_string();
    let (code, refused) = coordinator_call(
        &data_dir,
        &["rpc", "orchestration.runCreate", "--params", &closed_caller],
    );
    assert_ne!(code, 0);
    assert_eq!(refused["error"]["code"], "unverifiable");
    let (code, runs) = coordinator_call(&data_dir, &["orchestration", "run-list"]);
    assert_ok(code, &runs, &["run-list"]);
    assert_eq!(runs["result"]["runs"].as_array().unwrap().len(), 2);
    drop(daemon);
}

#[test]
fn native_daemon_and_cli_run_a_fixture_task_end_to_end() {
    let drogond_path = build_drogond();

    let scratch = tempfile::tempdir().expect("scratch tempdir");
    let data_dir = scratch.path().join("data");
    let fixture_bin_dir = scratch.path().join("fixture-bin");
    let ws_fail_dir = scratch.path().join("ws-fail");
    let ws_ok_dir = scratch.path().join("ws-ok");
    std::fs::create_dir_all(&ws_fail_dir).expect("create fail workspace dir");
    std::fs::create_dir_all(&ws_ok_dir).expect("create ok workspace dir");
    write_fixture_harness(&fixture_bin_dir);

    let daemon = Daemon::start(&drogond_path, &data_dir, Some(&fixture_bin_dir));

    // --- status: real daemon, real protocol, native capability present ---
    let (code, status) = coordinator_call(&data_dir, &["status"]);
    assert_ok(code, &status, &["status"]);
    let host_id = text_field(&status, "/result/hostId").to_string();
    let capabilities = status["result"]["capabilities"]
        .as_array()
        .expect("capabilities array");
    assert!(
        capabilities
            .iter()
            .any(|c| c.as_str() == Some("orchestration.native.v1")),
        "native orchestration capability must be advertised: {status:#}"
    );

    // --- register two workspaces (kept separate so each attempt's on-disk
    // artifact is unambiguous, with no overwrite race between attempts) ---
    let (code, ws_fail) = coordinator_call(
        &data_dir,
        &["workspace", "add", ws_fail_dir.to_str().unwrap()],
    );
    assert_ok(code, &ws_fail, &["workspace", "add"]);
    let ws_fail_id = text_field(&ws_fail, "/result/id").to_string();

    let (code, ws_ok) = coordinator_call(
        &data_dir,
        &["workspace", "add", ws_ok_dir.to_str().unwrap()],
    );
    assert_ok(code, &ws_ok, &["workspace", "add"]);
    let ws_ok_id = text_field(&ws_ok, "/result/id").to_string();

    // --- run + task creation (coordinator scope); pins the explicit --host
    // flag against the daemon's own identity from the status preflight ---
    let (code, run) = coordinator_call(
        &data_dir,
        &[
            "orchestration",
            "run-create",
            "--objective",
            "V1 dogfood: real daemon/CLI fixture task",
            "--host",
            &host_id,
        ],
    );
    assert_ok(code, &run, &["orchestration", "run-create"]);
    let run_id = text_field(&run, "/result/run/runId").to_string();
    let coordinator_id = text_field(&run, "/result/run/coordinatorId").to_string();
    assert_eq!(run["result"]["run"]["consumerGeneration"], Value::from(1));
    let (code, current) = coordinator_call(
        &data_dir,
        &[
            "orchestration",
            "run-current",
            "--coordinator-id",
            &coordinator_id,
        ],
    );
    assert_ok(code, &current, &["orchestration", "run-current"]);
    assert_eq!(current["result"]["run"], run["result"]["run"]);

    let scope_args = |args: &mut Vec<String>| {
        args.push("--run".into());
        args.push(run_id.clone());
        args.push("--coordinator-id".into());
        args.push(coordinator_id.clone());
        args.push("--consumer-generation".into());
        args.push("1".into());
    };

    let mut task_args: Vec<String> = vec!["orchestration".into(), "task-create".into()];
    scope_args(&mut task_args);
    task_args.extend(
        [
            "--spec",
            "Write a fixture artifact file and report the exact outcome.",
            "--task-title",
            "V1 dogfood fixture task",
        ]
        .map(String::from),
    );
    let task_args_ref: Vec<&str> = task_args.iter().map(String::as_str).collect();
    let (code, task) = coordinator_call(&data_dir, &task_args_ref);
    assert_ok(code, &task, &["orchestration", "task-create"]);
    let task_id = text_field(&task, "/result/task/taskId").to_string();
    assert_eq!(text_field(&task, "/result/task/status"), "ready");

    let mut dependent_ids = Vec::new();
    for deps in [
        serde_json::json!([task_id]).to_string(),
        format!("[{task_id}]"),
    ] {
        let mut dependent_args = vec!["orchestration".to_string(), "task-create".to_string()];
        scope_args(&mut dependent_args);
        dependent_args
            .extend(["--spec", "wait for the worker report", "--deps", &deps].map(String::from));
        let args: Vec<_> = dependent_args.iter().map(String::as_str).collect();
        let (code, dependent) = coordinator_call(&data_dir, &args);
        assert_ok(code, &dependent, &args);
        assert_eq!(dependent["result"]["task"]["status"], "pending");
        assert_eq!(
            dependent["result"]["task"]["dependsOn"],
            serde_json::json!([task_id])
        );
        dependent_ids.push(text_field(&dependent, "/result/task/taskId").to_string());
    }

    // Source ask is bare JSON; a durable answer makes the long-budget resume immediate.
    let mut ask_args = vec!["orchestration".to_string(), "ask".to_string()];
    scope_args(&mut ask_args);
    ask_args.extend(
        [
            "--question",
            "Proceed?",
            "--options",
            "yes,yes,no",
            "--timeout-ms",
            "1",
        ]
        .map(String::from),
    );
    let args: Vec<_> = ask_args.iter().map(String::as_str).collect();
    let (code, pending) = coordinator_call(&data_dir, &args);
    assert_eq!(code, 1, "{pending:#}");
    assert_eq!(pending["timedOut"], true);
    let question = text_field(&pending, "/messageId").to_string();
    let mut reply_args = vec!["orchestration".to_string(), "reply".to_string()];
    scope_args(&mut reply_args);
    reply_args.extend(["--id", &question, "--body", "approved ✓"].map(String::from));
    let args: Vec<_> = reply_args.iter().map(String::as_str).collect();
    let (code, replied) = coordinator_call(&data_dir, &args);
    assert_ok(code, &replied, &args);
    let mut resume_args = vec!["orchestration".to_string(), "ask".to_string()];
    scope_args(&mut resume_args);
    resume_args
        .extend(["--resume", &question, "--timeout-ms", "9007199254740991"].map(String::from));
    let args: Vec<_> = resume_args.iter().map(String::as_str).collect();
    let (code, answered) = coordinator_call(&data_dir, &args);
    assert_eq!(code, 0, "{answered:#}");
    assert_eq!(answered["answer"], "approved ✓");
    assert_eq!(answered["messageId"], question);
    assert_eq!(answered["timeoutMs"], 1_800_000);
    assert!(answered.get("result").is_none());

    // Status updates traverse the real CLI and daemon, preserving an explicit
    // result across a later update that omits --result.
    for (status, report) in [("blocked", Some("review before launch ✓")), ("ready", None)] {
        let mut update_args = vec!["orchestration".to_string(), "task-update".to_string()];
        scope_args(&mut update_args);
        update_args.extend(["--id", &task_id, "--status", status].map(String::from));
        if let Some(report) = report {
            update_args.extend(["--result", report].map(String::from));
        }
        let args: Vec<_> = update_args.iter().map(String::as_str).collect();
        let (code, updated) = coordinator_call(&data_dir, &args);
        assert_ok(code, &updated, &args);
        assert_eq!(updated["result"]["task"]["status"], status);
        assert_eq!(
            updated["result"]["task"]["result"],
            "review before launch ✓"
        );
    }

    let mut gate_args = vec!["orchestration".to_string(), "gate-create".to_string()];
    scope_args(&mut gate_args);
    gate_args.extend(
        [
            "--task",
            &task_id,
            "--question",
            "Proceed?",
            "--options",
            "[\"yes\",\"no\"]",
        ]
        .map(String::from),
    );
    let args: Vec<_> = gate_args.iter().map(String::as_str).collect();
    let (code, gate) = coordinator_call(&data_dir, &args);
    assert_ok(code, &gate, &args);
    let gate_id = text_field(&gate, "/result/gate/id").to_string();
    assert_eq!(gate["result"]["gate"]["status"], "pending");
    let mut list_args = vec!["orchestration".to_string(), "gate-list".to_string()];
    scope_args(&mut list_args);
    list_args.extend(["--task", &task_id, "--status", "pending"].map(String::from));
    let args: Vec<_> = list_args.iter().map(String::as_str).collect();
    let (code, gates) = coordinator_call(&data_dir, &args);
    assert_ok(code, &gates, &args);
    assert_eq!(gates["result"]["count"], 1);
    assert_eq!(gates["result"]["gates"][0]["id"], gate_id);
    let mut resolve_args = vec!["orchestration".to_string(), "gate-resolve".to_string()];
    scope_args(&mut resolve_args);
    resolve_args.extend(["--id", &gate_id, "--resolution", "yes"].map(String::from));
    let args: Vec<_> = resolve_args.iter().map(String::as_str).collect();
    let (code, resolved) = coordinator_call(&data_dir, &args);
    assert_ok(code, &resolved, &args);
    assert_eq!(resolved["result"]["gate"]["status"], "resolved");

    // --- attempt 1: fresh launch, fixture harness reports FAILURE ---
    let mut start1_args: Vec<String> = vec!["orchestration".into(), "worker-start".into()];
    scope_args(&mut start1_args);
    start1_args.extend(
        [
            "--task",
            &task_id,
            "--workspace",
            &ws_fail_id,
            "--harness",
            "claude",
            "--model",
            "fixture-fail",
            "--permission-mode",
            "unattended",
        ]
        .map(String::from),
    );
    let start1_ref: Vec<&str> = start1_args.iter().map(String::as_str).collect();
    let (code, start1) = coordinator_call(&data_dir, &start1_ref);
    let dispatch1 = text_field(&start1, "/result/dispatchId").to_string();
    assert_eq!(
        code, 0,
        "fresh worker-start must be accepted (ready/completed): {start1:#}"
    );

    let first_report_1 = ws_fail_dir.join("first-report.json");
    assert!(
        wait_for_file(&ws_fail_dir.join("done"), SCRIPT_TIMEOUT),
        "fixture harness did not finish (no done marker) in {}",
        ws_fail_dir.display()
    );

    let artifact1 =
        std::fs::read_to_string(ws_fail_dir.join("artifact.txt")).expect("read artifact1");
    assert!(
        artifact1.contains(&format!("dispatch={dispatch1}")),
        "artifact1 must name its own dispatch: {artifact1:?}"
    );
    assert!(
        artifact1.contains("mode=fixture-fail"),
        "artifact1 must record the failure mode: {artifact1:?}"
    );

    let first_report_1_text = std::fs::read_to_string(&first_report_1).expect("read report1");
    let first_report_1_json: Value =
        serde_json::from_str(&first_report_1_text).unwrap_or_else(|err| {
            let debug_stderr = std::fs::read_to_string(ws_fail_dir.join("first-report.stderr"))
                .unwrap_or_default();
            panic!(
                "parse report1 json: {err}\nstdout={first_report_1_text:?}\nstderr={debug_stderr:?}"
            )
        });
    assert_eq!(first_report_1_json["ok"], Value::Bool(true));
    assert_eq!(
        first_report_1_json["result"]["lifecycle"]["action"],
        Value::from("settled")
    );
    assert_eq!(
        first_report_1_json["result"]["lifecycle"]["outcome"],
        Value::from("failed")
    );

    let mut show1_args: Vec<String> = vec!["orchestration".into(), "worker-show".into()];
    scope_args(&mut show1_args);
    show1_args.extend(["--dispatch".to_string(), dispatch1.clone()]);
    let show1_ref: Vec<&str> = show1_args.iter().map(String::as_str).collect();
    let (code, show1) = coordinator_call(&data_dir, &show1_ref);
    assert_ok(code, &show1, &["orchestration", "worker-show"]);
    assert_eq!(text_field(&show1, "/result/assignmentState"), "failed");
    assert_eq!(text_field(&show1, "/result/outcome"), "failed");
    // The exited fixture's wait observation is evaluated and empty: distinct
    // from "never evaluated" (absent) and from an active wait.
    assert!(
        show1["result"]["observation"]["agentWait"].is_null(),
        "exited worker has an evaluated empty wait observation: {show1:#}"
    );

    let mut task_show_args: Vec<String> = vec!["orchestration".into(), "task-show".into()];
    scope_args(&mut task_show_args);
    task_show_args.extend(["--task".to_string(), task_id.clone()]);
    let task_show_ref: Vec<&str> = task_show_args.iter().map(String::as_str).collect();
    let (code, task_show_1) = coordinator_call(&data_dir, &task_show_ref);
    assert_ok(code, &task_show_1, &["orchestration", "task-show"]);
    assert_eq!(text_field(&task_show_1, "/result/task/status"), "failed");
    for id in &dependent_ids {
        let mut args = vec!["orchestration".to_string(), "task-show".to_string()];
        scope_args(&mut args);
        args.extend(["--task", id].map(String::from));
        let args: Vec<_> = args.iter().map(String::as_str).collect();
        let (code, dependent) = coordinator_call(&data_dir, &args);
        assert_ok(code, &dependent, &args);
        assert_eq!(dependent["result"]["task"]["status"], "pending");
    }

    // --- attempt 2: explicit retry of the failed attempt, fixture harness
    // reports SUCCESS and additionally sends a genuine late/conflicting
    // final report from its own (still-valid-for-this-purpose) credential ---
    let mut start2_args: Vec<String> = vec!["orchestration".into(), "worker-start".into()];
    scope_args(&mut start2_args);
    start2_args.extend(
        [
            "--task",
            &task_id,
            "--workspace",
            &ws_ok_id,
            "--harness",
            "claude",
            "--model",
            "fixture-succeed",
            "--permission-mode",
            "unattended",
            "--retry-of",
            &dispatch1,
        ]
        .map(String::from),
    );
    let start2_ref: Vec<&str> = start2_args.iter().map(String::as_str).collect();
    let (code, start2) = coordinator_call(&data_dir, &start2_ref);
    let dispatch2 = text_field(&start2, "/result/dispatchId").to_string();
    assert_eq!(
        code, 0,
        "retry worker-start must be accepted (ready/completed): {start2:#}"
    );
    assert_ne!(dispatch2, dispatch1, "a retry must mint a new dispatch id");

    let late_exit_path = ws_ok_dir.join("late-report.exit");
    assert!(
        wait_for_file(&ws_ok_dir.join("done"), SCRIPT_TIMEOUT),
        "fixture harness did not finish (no done marker) in {}",
        ws_ok_dir.display()
    );

    let artifact2 =
        std::fs::read_to_string(ws_ok_dir.join("artifact.txt")).expect("read artifact2");
    assert!(
        artifact2.contains(&format!("dispatch={dispatch2}")),
        "artifact2 must name its own dispatch: {artifact2:?}"
    );
    assert!(
        artifact2.contains("mode=fixture-succeed"),
        "artifact2 must record the success mode: {artifact2:?}"
    );

    let first_report_2_text =
        std::fs::read_to_string(ws_ok_dir.join("first-report.json")).expect("read report2");
    let first_report_2_json: Value =
        serde_json::from_str(&first_report_2_text).expect("parse report2 json");
    assert_eq!(first_report_2_json["ok"], Value::Bool(true));
    assert_eq!(
        first_report_2_json["result"]["lifecycle"]["action"],
        Value::from("settled")
    );
    assert_eq!(
        first_report_2_json["result"]["lifecycle"]["outcome"],
        Value::from("succeeded")
    );
    assert_eq!(
        first_report_2_json["result"]["lifecycle"]["duplicate"],
        Value::Bool(false)
    );
    // The structured payload flags built the worker_done payload object.
    let report_message = first_report_2_json["result"]["message"]["messageId"]
        .as_str()
        .expect("report message id")
        .to_string();
    let (code, inbox) = coordinator_call(&data_dir, &["orchestration", "inbox", "--limit", "5"]);
    assert_ok(code, &inbox, &["orchestration", "inbox"]);
    let report_row = inbox["result"]["messages"]
        .as_array()
        .and_then(|rows| rows.iter().find(|row| row["messageId"] == report_message))
        .expect("inbox must list the worker_done message");
    assert_eq!(report_row["payload"]["taskId"], task_id);
    assert_eq!(
        report_row["payload"]["filesModified"],
        serde_json::json!(["artifact.txt", "done"])
    );

    // The core assertion: a late, conflicting final report from the exact
    // dispatch that already settled is REFUSED, not silently accepted or
    // recorded as a second success.
    let late_exit_text = std::fs::read_to_string(&late_exit_path).expect("read late exit code");
    assert_eq!(
        late_exit_text.trim(),
        "1",
        "a conflicting late final report must exit non-zero"
    );
    let late_report_text =
        std::fs::read_to_string(ws_ok_dir.join("late-report.json")).expect("read late report");
    let late_report_json: Value = serde_json::from_str(&late_report_text).unwrap_or_else(|err| {
        panic!("late-report.json was not valid JSON: {err}\ncontent={late_report_text:?}")
    });
    assert_eq!(
        late_report_json["ok"],
        Value::Bool(false),
        "late report must be refused, not accepted: {late_report_json:#}"
    );
    assert_eq!(
        late_report_json["error"]["code"],
        Value::from("report_conflict"),
        "late report refusal must carry the report_conflict code: {late_report_json:#}"
    );

    let mut show2_args: Vec<String> = vec!["orchestration".into(), "worker-show".into()];
    scope_args(&mut show2_args);
    show2_args.extend(["--dispatch".to_string(), dispatch2.clone()]);
    let show2_ref: Vec<&str> = show2_args.iter().map(String::as_str).collect();
    let (code, show2) = coordinator_call(&data_dir, &show2_ref);
    assert_ok(code, &show2, &["orchestration", "worker-show"]);
    assert_eq!(text_field(&show2, "/result/assignmentState"), "completed");
    assert_eq!(text_field(&show2, "/result/outcome"), "succeeded");

    let mut task_show_2_args: Vec<String> = vec!["orchestration".into(), "task-show".into()];
    scope_args(&mut task_show_2_args);
    task_show_2_args.extend(["--task".to_string(), task_id.clone()]);
    let task_show_2_ref: Vec<&str> = task_show_2_args.iter().map(String::as_str).collect();
    let (code, task_show_2) = coordinator_call(&data_dir, &task_show_2_ref);
    assert_ok(code, &task_show_2, &["orchestration", "task-show"]);
    assert_eq!(text_field(&task_show_2, "/result/task/status"), "completed");
    for id in dependent_ids {
        let mut args = vec!["orchestration".to_string(), "task-show".to_string()];
        scope_args(&mut args);
        args.extend(["--task", &id].map(String::from));
        let args: Vec<_> = args.iter().map(String::as_str).collect();
        let (code, dependent) = coordinator_call(&data_dir, &args);
        assert_ok(code, &dependent, &args);
        assert_eq!(dependent["result"]["task"]["status"], "ready");
    }

    // --- exact release: both settled attempts release their session
    // resources; the process already exited on its own after reporting ---
    for dispatch in [&dispatch1, &dispatch2] {
        let mut release_args: Vec<String> = vec!["orchestration".into(), "worker-release".into()];
        scope_args(&mut release_args);
        release_args.extend(["--dispatch".to_string(), dispatch.clone()]);
        let mut retain_args = release_args.clone();
        retain_args[1] = "worker-retain".into();
        let retain_ref: Vec<_> = retain_args.iter().map(String::as_str).collect();
        let (code, retained) = coordinator_call(&data_dir, &retain_ref);
        assert_ok(code, &retained, &retain_ref);
        assert_eq!(retained["result"]["state"], "retained");
        assert_eq!(retained["result"]["processAction"], "none");
        for resource in retained["result"]["residualResources"].as_array().unwrap() {
            if resource["kind"] == "session" {
                assert_eq!(resource["disposition"], "retained");
            }
        }
        let release_ref: Vec<&str> = release_args.iter().map(String::as_str).collect();
        let (code, release) = coordinator_call(&data_dir, &release_ref);
        assert_eq!(
            code, 0,
            "release of a settled, already-exited attempt must succeed: {release:#}"
        );
        assert_eq!(text_field(&release, "/result/disposition"), "released");
        let (code, retained_after) = coordinator_call(&data_dir, &retain_ref);
        assert_ok(code, &retained_after, &retain_ref);
        assert_eq!(retained_after["result"]["state"], "already_released");
    }

    for state in [
        "active",
        "reclaimable",
        "retained",
        "release_pending",
        "release_unknown",
        "released",
    ] {
        let args = [
            "orchestration",
            "worker-list",
            "--run",
            &run_id,
            "--terminal-state",
            state,
        ];
        let (code, listed) = coordinator_call(&data_dir, &args);
        assert_ok(code, &listed, &args);
        assert_eq!(
            listed["result"]["counts"],
            serde_json::json!({"released": 2})
        );
        let workers = listed["result"]["workers"].as_array().unwrap();
        assert_eq!(workers.len(), if state == "released" { 2 } else { 0 });
        if state == "released" {
            assert_eq!(workers[0]["workerState"], "failed");
            assert_eq!(workers[0]["dispatchStatus"], "failed");
            assert_eq!(workers[1]["workerState"], "succeeded");
            assert_eq!(workers[1]["dispatchStatus"], "completed");
        }
    }

    // `daemon` and `scratch` drop here: the daemon process is signaled and
    // reaped (see `Daemon::drop`), then the ephemeral data/workspace
    // directories are removed. No process, socket file or workspace
    // directory outlives this test.
    drop(daemon);
    drop(scratch);
}

/// The opt-in is satisfied ONLY by the exact value `1`. Unset, empty, `0` or
/// any other value skips the leg before any build, daemon, session or spend.
fn real_model_opted_in() -> bool {
    matches!(std::env::var(REAL_MODEL_OPT_IN_ENV).as_deref(), Ok("1"))
}

/// Negative gate coverage for BOTH real-model legs: with the variable unset,
/// empty, `0` or any non-`1` value, each must take the fast skip path — exit
/// 0, printed skip note, no build, no daemon, no session/dispatch, no spend
/// (a subprocess per variant keeps the parent's env free of process-global
/// mutation).
#[test]
fn real_model_legs_skip_without_spending_unless_opt_in_is_exactly_one() {
    let exe = std::env::current_exe().expect("test binary path");
    for test_name in [
        "real_model_probe_reaches_a_daemon_spawned_session",
        "real_model_coordinated_journey_creates_and_reports_an_owned_artifact",
    ] {
        for (label, value) in [
            ("unset", None),
            ("zero", Some("0")),
            ("empty", Some("")),
            ("non-one-word", Some("yes")),
        ] {
            let mut command = Command::new(&exe);
            command
                .args(["--exact", test_name, "--nocapture", "--test-threads", "1"])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            match value {
                Some(v) => {
                    command.env(REAL_MODEL_OPT_IN_ENV, v);
                }
                None => {
                    command.env_remove(REAL_MODEL_OPT_IN_ENV);
                }
            }
            let start = Instant::now();
            let output = command.output().expect("spawn skip-path subprocess");
            let elapsed = start.elapsed();
            assert!(
                output.status.success(),
                "{test_name} opt-in {label}: skip path must exit 0: {:?}",
                output
            );
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(
                text.contains("skipping real-model leg"),
                "{test_name} opt-in {label}: skip note must be printed, got:\n{text}"
            );
            assert!(
                elapsed < Duration::from_secs(30),
                "{test_name} opt-in {label}: skip must be fast (no 300s build, \
                 no daemon, no session/dispatch, no spend), took {elapsed:?}"
            );
        }
    }
}

/// Real-model leg: one bounded, non-agentic completion through a real,
/// already-authenticated `claude --print` binary found on `PATH`, spawned by
/// the real daemon's ordinary `session.start` path (`terminal create`) —
/// the identical spawn engine (`session_admission::reserve`/`launch_reserved`
/// -> `spawn_pty`) that `harness.start` and `orchestration.workerStart` use
/// for a fresh launch, minus the worker-credential/report-back wiring that
/// the fixture leg above already exercises with a controlled stand-in. This
/// is deliberately *not* a full autonomous agentic run (no
/// `--dangerously-skip-permissions`, no multi-turn tool use): `--print` asks
/// for exactly one completion and exits on its own, which is what makes a
/// tight, deterministic timeout possible for a real network-backed model
/// call. Skips (not fails) unless explicitly opted into, since it spends
/// real provider tokens and depends on host-local credentials this suite
/// must never provision or persist itself.
#[test]
fn real_model_probe_reaches_a_daemon_spawned_session() {
    if !real_model_opted_in() {
        eprintln!(
            "skipping real-model leg: set {REAL_MODEL_OPT_IN_ENV}=1 to run it \
             (it reaches the network and spends real provider tokens)"
        );
        return;
    }

    let drogond_path = build_drogond();

    let scratch = tempfile::tempdir().expect("scratch tempdir");
    let data_dir = scratch.path().join("data");
    let ws_dir = scratch.path().join("ws-real-model");
    std::fs::create_dir_all(&ws_dir).expect("create real-model workspace dir");

    // No fixture bin dir prepended: `PATH` is exactly what this test process
    // inherited, so the daemon's own `drogon_harness::discover` (and, here,
    // plain `PATH` lookup for `terminal create`) finds whatever is genuinely
    // installed on this host, not a stand-in.
    let daemon = Daemon::start(&drogond_path, &data_dir, None);

    let (code, ws) = coordinator_call(&data_dir, &["workspace", "add", ws_dir.to_str().unwrap()]);
    assert_ok(code, &ws, &["workspace", "add"]);
    let ws_id = text_field(&ws, "/result/id").to_string();

    const MARKER: &str = "DROGON-REAL-MODEL-OK";
    let prompt = format!(
        "Reply with exactly this text and nothing else, no other words, no punctuation added: {MARKER}"
    );

    let started_at = Instant::now();
    let (code, created) = coordinator_call(
        &data_dir,
        &[
            "terminal",
            "create",
            "--workspace",
            &ws_id,
            "--",
            "claude",
            "--model",
            "claude-sonnet-5",
            "--print",
            "--output-format",
            "json",
            &prompt,
        ],
    );
    assert_ok(code, &created, &["terminal", "create"]);
    let session_id = text_field(&created, "/result/id").to_string();
    let incarnation = text_field(&created, "/result/incarnation").to_string();

    // The session is tracked from creation and closed on every path: the
    // explicit close below asserts its observed end, and the guard's
    // best-effort unwind close (assertion failure or timeout) runs while the
    // daemon is still alive and reports honestly whether closure was proven
    // — it cannot assert, so a failed unwind close is reported as
    // unverifiable/cleanup-failed, never silently claimed.
    let mut session_guard = Some(SessionGuard {
        data_dir: data_dir.clone(),
        session_id: session_id.clone(),
        incarnation: incarnation.clone(),
        closed: false,
    });

    let mut exited = false;
    let last_read = loop {
        let (code, read) = coordinator_call(
            &data_dir,
            &[
                "terminal",
                "read",
                "--session",
                &session_id,
                "--incarnation",
                &incarnation,
                "--limit-bytes",
                "65536",
            ],
        );
        assert_eq!(
            code, 0,
            "terminal read must succeed while polling: {read:#}"
        );
        if read["result"]["session"]["verdict"] == "exited" {
            exited = true;
            break read;
        }
        if started_at.elapsed() > REAL_MODEL_TIMEOUT {
            break read;
        }
        std::thread::sleep(POLL_INTERVAL * 4);
    };
    let latency = started_at.elapsed();
    assert!(
        exited,
        "real claude --print session did not exit within {REAL_MODEL_TIMEOUT:?}; \
         last observed read: {last_read:#}"
    );
    let daemon_exit_code = last_read["result"]["session"]["exitCode"].clone();
    assert_eq!(
        daemon_exit_code,
        Value::from(0),
        "daemon-observed exit code must be 0: {last_read:#}"
    );

    // The child's answer must be exactly one `claude --print` JSON envelope:
    // `is_error:false`, `result` exactly the requested marker. Only the
    // trailing PTY cursor-show escape may follow the envelope — any other
    // trailing bytes are a corrupted stream and must fail loudly here.
    let data_base64 = text_field(&last_read, "/result/dataBase64");
    let raw_bytes = STANDARD
        .decode(data_base64)
        .expect("session output must be valid base64");
    const CURSOR_SHOW: &str = "\u{1b}[?25h";
    let mut envelope_text = String::from_utf8(raw_bytes.clone())
        .expect("real model output must be UTF-8 (no escape stripping before this check)");
    envelope_text = envelope_text
        .trim_end_matches(['\r', '\n', ' ', '\t'])
        .to_string();
    if let Some(rest) = envelope_text.strip_suffix(CURSOR_SHOW) {
        envelope_text = rest.trim_end_matches(['\r', '\n', ' ', '\t']).to_string();
    }
    let envelope: Value = serde_json::from_str(&envelope_text).unwrap_or_else(|err| {
        panic!(
            "expected exactly one claude --print JSON envelope (only a trailing \
             PTY cursor-show escape may follow it): {err}\nraw output bytes={raw_bytes:?}"
        )
    });
    assert_eq!(
        envelope["is_error"],
        Value::Bool(false),
        "the real completion must not be an error: {envelope:#}"
    );
    assert_eq!(
        envelope["result"],
        Value::String(MARKER.to_string()),
        "the model result must be EXACTLY the requested marker, not merely \
         contain it: {envelope:#}"
    );

    // Explicit close before any teardown: the daemon observes the session's
    // end instead of being killed with a live PTY child underneath it.
    let closed = session_guard
        .take()
        .expect("session guard still armed")
        .close("explicit close before daemon shutdown");

    let evidence = format!(
        "V1 dogfood real-model leg: PASSED\n\
         command: claude --print --output-format json <prompt>\n\
         session_id: {session_id}\n\
         incarnation: {incarnation}\n\
         daemon-observed exit code: {daemon_exit_code:?}\n\
         close-observed verdict: {closed:#}\n\
         wall latency (session create -> observed exited verdict): {latency:?}\n\
         envelope: {envelope:#}\n\
         output bytes ({} bytes, base64-decoded from the real daemon session read)\n",
        raw_bytes.len(),
    );
    // Printed (not written under `scratch`, which is removed on drop below):
    // run with `-- --nocapture` to capture this into the evidence doc.
    eprint!("{evidence}");

    drop(daemon);
    drop(scratch);
}

/// The exact literal shell script the real-model coordinated-journey leg asks
/// the model to run, via exactly one tool call. This is NOT open-ended task
/// interpretation: the model is handed a fully specified command sequence and
/// asked to execute it verbatim, which is what makes a bounded turn/time
/// budget realistic for a genuinely autonomous tool-using agent — as opposed
/// to the fixture leg's static stand-in script (no model involved at all) or
/// the `--print` probe leg's single non-agentic completion. Uses exactly the
/// env vars the daemon injects into every worker process
/// (`session_admission::WorkerEnvironment::apply_to_command`), the same ones
/// the fixture harness script above already exercises for real.
const REAL_MODEL_JOURNEY_SCRIPT: &str = r#"printf 'DROGON-REAL-ARTIFACT dispatch=%s task=%s\n' "$DROGON_DISPATCH_ID" "$DROGON_TASK_ID" > artifact.txt
"$DROGON_CLI_COMMAND" --data-dir "$DROGON_DATA_DIR" --json orchestration send --kind final-report --subject "real-model artifact" --outcome succeeded --body "real-model worker report" > first-report.json 2> first-report.stderr
first_status=$?
"$DROGON_CLI_COMMAND" --data-dir "$DROGON_DATA_DIR" --json orchestration send --kind final-report --subject "late duplicate" --outcome failed --body "late duplicate report from the same settled worker, sent deliberately to verify the daemon refuses it" > late-report.json 2> late-report.stderr
echo "$?" > late-report.exit
touch done"#;

/// Task instructions handed to `orchestration task-create`, which the
/// daemon's own `plan_coordination_launch` wraps with a fixed preamble that
/// already tells the model to "send exactly one orchestration send --kind
/// final-report". This text explicitly overrides that default guidance for
/// this one verification task, since proving the late-report refusal
/// requires a second, deliberately conflicting report from the same settled
/// attempt.
fn real_model_journey_instructions() -> String {
    format!(
        "This is a bounded, scripted verification task, not an open-ended \
         coding task. Do not explore the repository, do not ask questions, do \
         not write or modify any code. Use exactly ONE tool call (a single \
         bash command) and no other tool call before or after it: run this \
         exact script verbatim in your current working directory (every \
         variable below is already set in your process environment; \
         substitute nothing else):\n\n{script}\n\nOverride note: this \
         OVERRIDES the general \"send exactly one final report\" guidance \
         above for this specific verification task — sending the SECOND, \
         deliberately conflicting final-report call is REQUIRED. That second \
         call is EXPECTED to fail (non-zero exit, an ok:false JSON error) \
         because your first report already settled this attempt; that \
         failure is the correct, intended outcome, not an error to fix or \
         retry. After the script's last line (`touch done`) returns, stop: no \
         further tool calls, retries, or reports.",
        script = REAL_MODEL_JOURNEY_SCRIPT,
    )
}

// Explicit disclosure: nothing in this file enforces a hard turn cap or a
// spend ceiling for this leg. "Use exactly ONE tool call" above is stated
// only as a prompt instruction the model is asked to follow — a request,
// not a runtime constraint — because `drogon-harness/src/launch.rs::
// plan_launch` has no `--max-turns`-equivalent passthrough for any harness
// on this native path (no CLI lever exists to add one from this test). The
// "low tens-of-cents at most" figure this suite's evidence doc quotes for a
// compliant run is an ESTIMATE extrapolated from the probe leg's
// single-completion cost, not a value this test asserts, measures, or caps.
// A model that ignores the instruction, retries, or otherwise runs longer
// is bounded only by `REAL_MODEL_JOURNEY_TIMEOUT` (wall-clock) — never by
// turn count or by cost.

/// Real-model coordinated-journey leg: the follow-up this suite's own
/// evidence doc explicitly deferred ("a real model autonomously completing an
/// `orchestration.workerStart` fresh launch end to end including its own
/// final-report... should be its own explicitly scoped, explicitly costed
/// checkpoint"). Unlike the fixture leg (a static script, no model) and the
/// `--print` probe leg (one non-agentic completion via plain `terminal
/// create`), this drives the exact same native `task-create` ->
/// `worker-start` path the fixture leg exercises, with a genuinely installed
/// `claude` harness instead of the fixture stand-in, in unattended
/// (`--dangerously-skip-permissions`) mode. The model is asked to run one
/// fully specified, literal shell script (`REAL_MODEL_JOURNEY_SCRIPT`): real
/// tool-using model autonomy, but scripted execution, not open-ended task
/// interpretation — never conflate this leg's genuine agentic tool use with
/// the fixture leg's shim. Because the underlying real `claude` process is a
/// persistent interactive session with no natural exit once it finishes
/// responding (unlike `--print`, which exits on its own), this leg always
/// explicitly force-stops it (`worker-stop`, safe/idempotent even if it
/// already exited) before releasing. This is an honest bound, not an
/// absolute guarantee: the force-stop signal alone proves nothing by
/// itself, so cleanup is asserted only after a bounded observation window
/// (`STOP_OBSERVATION_TIMEOUT`) during which the daemon must report an
/// explicit `exited` verdict — `unverifiable` (lost contact) never counts as
/// proof of exit. If that verdict never resolves to `exited` within the
/// window, this leg fails closed: the happy path (`stop_and_release`) fails
/// the test loudly instead of claiming release, and the unwind path
/// (`best_effort_stop_and_release`) reports the outcome as unverifiable
/// instead of `released`. An orphaned process therefore remains a possible,
/// disclosed outcome when the verdict never resolves — never silently
/// claimed away.
#[test]
fn real_model_coordinated_journey_creates_and_reports_an_owned_artifact() {
    if !real_model_opted_in() {
        eprintln!(
            "skipping real-model leg: set {REAL_MODEL_OPT_IN_ENV}=1 to run it \
             (it launches a real, unattended, tool-using model session through \
             orchestration worker-start, reaches the network and spends real \
             provider tokens)"
        );
        return;
    }

    let drogond_path = build_drogond();

    let scratch = tempfile::tempdir().expect("scratch tempdir");
    let data_dir = scratch.path().join("data");
    let ws_dir = scratch.path().join("ws-real-journey");
    std::fs::create_dir_all(&ws_dir).expect("create real-journey workspace dir");

    // No fixture bin dir prepended: PATH is exactly what this test process
    // inherited, so drogon_harness::discover finds the genuinely installed
    // `claude` binary, never a stand-in.
    let daemon = Daemon::start(&drogond_path, &data_dir, None);

    let (code, status) = coordinator_call(&data_dir, &["status"]);
    assert_ok(code, &status, &["status"]);
    let host_id = text_field(&status, "/result/hostId").to_string();

    let (code, ws) = coordinator_call(&data_dir, &["workspace", "add", ws_dir.to_str().unwrap()]);
    assert_ok(code, &ws, &["workspace", "add"]);
    let ws_id = text_field(&ws, "/result/id").to_string();

    let (code, run) = coordinator_call(
        &data_dir,
        &[
            "orchestration",
            "run-create",
            "--objective",
            "V1 dogfood: real-model coordinated journey",
            "--host",
            &host_id,
        ],
    );
    assert_ok(code, &run, &["orchestration", "run-create"]);
    let run_id = text_field(&run, "/result/run/runId").to_string();
    let coordinator_id = text_field(&run, "/result/run/coordinatorId").to_string();

    let scope_args = |args: &mut Vec<String>| {
        args.push("--run".into());
        args.push(run_id.clone());
        args.push("--coordinator-id".into());
        args.push(coordinator_id.clone());
        args.push("--consumer-generation".into());
        args.push("1".into());
    };

    let mut task_args: Vec<String> = vec!["orchestration".into(), "task-create".into()];
    scope_args(&mut task_args);
    task_args.push("--instructions".into());
    task_args.push(real_model_journey_instructions());
    task_args.push("--title".into());
    task_args.push("V1 dogfood real-model coordinated journey".into());
    let task_args_ref: Vec<&str> = task_args.iter().map(String::as_str).collect();
    let (code, task) = coordinator_call(&data_dir, &task_args_ref);
    assert_ok(code, &task, &["orchestration", "task-create"]);
    let task_id = text_field(&task, "/result/task/taskId").to_string();

    let mut start_args: Vec<String> = vec!["orchestration".into(), "worker-start".into()];
    scope_args(&mut start_args);
    start_args.push("--task".into());
    start_args.push(task_id.clone());
    start_args.push("--workspace".into());
    start_args.push(ws_id);
    start_args.push("--harness".into());
    start_args.push("claude".into());
    start_args.push("--model".into());
    start_args.push(REAL_MODEL_JOURNEY_MODEL_ID.into());
    start_args.push("--permission-mode".into());
    start_args.push("unattended".into());
    start_args.push("--timeout-ms".into());
    start_args.push(REAL_MODEL_JOURNEY_TIMEOUT.as_millis().to_string());
    let start_ref: Vec<&str> = start_args.iter().map(String::as_str).collect();
    let (code, start) = coordinator_call(&data_dir, &start_ref);
    assert_eq!(
        code, 0,
        "real-model worker-start must be accepted (ready/completed): {start:#}"
    );
    let dispatch_id = text_field(&start, "/result/dispatchId").to_string();

    let mut dispatch_guard = Some(DispatchGuard {
        data_dir: data_dir.clone(),
        run_id: run_id.clone(),
        coordinator_id: coordinator_id.clone(),
        dispatch_id: dispatch_id.clone(),
        settled: false,
    });

    let done_marker = ws_dir.join("done");
    let settled_in_time = wait_for_file(&done_marker, REAL_MODEL_JOURNEY_TIMEOUT);

    // Diagnostic only (never a pass/fail assertion by itself): a bounded read
    // of the real model's own session output, capped explicitly, kept for
    // evidence and for the panic message below if the model didn't finish.
    let mut diag_args: Vec<String> = vec!["orchestration".into(), "worker-read".into()];
    scope_args(&mut diag_args);
    diag_args.push("--dispatch".into());
    diag_args.push(dispatch_id.clone());
    diag_args.push("--limit".into());
    diag_args.push(REAL_MODEL_JOURNEY_READ_LIMIT.to_string());
    let diag_ref: Vec<&str> = diag_args.iter().map(String::as_str).collect();
    let (_diag_code, diag_read) = coordinator_call(&data_dir, &diag_ref);

    assert!(
        settled_in_time,
        "real-model coordinated journey did not finish (no done marker) in \
         {REAL_MODEL_JOURNEY_TIMEOUT:?}; last bounded worker-read (limit \
         {REAL_MODEL_JOURNEY_READ_LIMIT} entries): {diag_read:#}"
    );

    let artifact = std::fs::read_to_string(ws_dir.join("artifact.txt")).expect("read artifact");
    assert_eq!(
        artifact,
        format!("DROGON-REAL-ARTIFACT dispatch={dispatch_id} task={task_id}\n"),
        "the real worker's artifact must carry EXACT bytes naming its own \
         dispatch/task provenance, not merely contain them"
    );

    let first_report_text = std::fs::read_to_string(ws_dir.join("first-report.json"))
        .unwrap_or_else(|err| {
            let stderr_text =
                std::fs::read_to_string(ws_dir.join("first-report.stderr")).unwrap_or_default();
            panic!("read first-report.json: {err}\nstderr={stderr_text:?}")
        });
    let first_report_json: Value = serde_json::from_str(&first_report_text)
        .unwrap_or_else(|err| panic!("parse first-report.json: {err}\n{first_report_text:?}"));
    assert_eq!(first_report_json["ok"], Value::Bool(true));
    assert_eq!(
        first_report_json["result"]["lifecycle"]["action"],
        Value::from("settled")
    );
    assert_eq!(
        first_report_json["result"]["lifecycle"]["outcome"],
        Value::from("succeeded")
    );

    // The core assertion this leg exists for: a genuine second, conflicting
    // final report from the SAME real worker (after its first report already
    // settled the attempt) is REFUSED by the daemon, not silently accepted.
    let late_exit_text = std::fs::read_to_string(ws_dir.join("late-report.exit"))
        .expect("read late-report.exit (the worker must have attempted the second report)");
    assert_eq!(
        late_exit_text.trim(),
        "1",
        "the deliberate late/conflicting final report must exit non-zero"
    );
    let late_report_text =
        std::fs::read_to_string(ws_dir.join("late-report.json")).expect("read late-report.json");
    let late_report_json: Value = serde_json::from_str(&late_report_text).unwrap_or_else(|err| {
        panic!("late-report.json was not valid JSON: {err}\ncontent={late_report_text:?}")
    });
    assert_eq!(
        late_report_json["ok"],
        Value::Bool(false),
        "the late report must be refused, not accepted: {late_report_json:#}"
    );
    assert_eq!(
        late_report_json["error"]["code"],
        Value::from("report_conflict"),
        "the late-report refusal must carry the report_conflict code: {late_report_json:#}"
    );

    let mut show_args: Vec<String> = vec!["orchestration".into(), "worker-show".into()];
    scope_args(&mut show_args);
    show_args.push("--dispatch".into());
    show_args.push(dispatch_id.clone());
    let show_ref: Vec<&str> = show_args.iter().map(String::as_str).collect();
    let (code, show) = coordinator_call(&data_dir, &show_ref);
    assert_ok(code, &show, &["orchestration", "worker-show"]);
    assert_eq!(text_field(&show, "/result/assignmentState"), "completed");
    assert_eq!(text_field(&show, "/result/outcome"), "succeeded");

    let mut task_show_args: Vec<String> = vec!["orchestration".into(), "task-show".into()];
    scope_args(&mut task_show_args);
    task_show_args.push("--task".into());
    task_show_args.push(task_id.clone());
    let task_show_ref: Vec<&str> = task_show_args.iter().map(String::as_str).collect();
    let (code, task_show) = coordinator_call(&data_dir, &task_show_ref);
    assert_ok(code, &task_show, &["orchestration", "task-show"]);
    assert_eq!(text_field(&task_show, "/result/task/status"), "completed");

    // Exact release: the real underlying `claude` process has no natural exit
    // once it finishes responding (unlike `--print`), so this always
    // explicitly force-stops it before releasing (see `DispatchGuard`).
    let release = dispatch_guard
        .take()
        .expect("dispatch guard still armed")
        .stop_and_release();

    eprintln!(
        "V1 dogfood real-model coordinated-journey leg: PASSED\n\
         dispatch_id: {dispatch_id}\n\
         task_id: {task_id}\n\
         artifact bytes: {artifact:?}\n\
         first report: {first_report_json:#}\n\
         late report refusal: {late_report_json:#}\n\
         worker-show: {show:#}\n\
         release: {release:#}\n"
    );

    drop(daemon);
    drop(scratch);
}

/// Tracks the real-model session and closes it exactly once: `close` asserts
/// the daemon-observed end on the happy path; `Drop` is the best-effort
/// unwind path — it never panics (a panic in drop aborts the process), runs
/// while the daemon is still alive, and REPORTS whether closure was actually
/// proven instead of claiming it.
struct SessionGuard {
    data_dir: PathBuf,
    session_id: String,
    incarnation: String,
    closed: bool,
}

impl SessionGuard {
    fn close(mut self, context: &str) -> Value {
        let (code, closed) = coordinator_call(
            &self.data_dir,
            &[
                "terminal",
                "close",
                "--session",
                &self.session_id,
                "--incarnation",
                &self.incarnation,
            ],
        );
        assert_ok(code, &closed, &["terminal", "close"]);
        assert_eq!(
            closed["result"]["verdict"],
            Value::from("exited"),
            "the daemon must observe the session end on {context}: {closed:#}"
        );
        self.closed = true;
        closed
    }
}

impl Drop for SessionGuard {
    fn drop(&mut self) {
        if self.closed {
            return;
        }
        // Inspect, don't assert: closure is PROVEN only when the CLI spawned,
        // exited successfully, and the daemon observed `exited`. Every other
        // outcome — including a CLI spawn failure — is reported as
        // unverifiable/cleanup-failed instead of panicking, because a panic
        // inside Drop during unwind aborts the whole process.
        match best_effort_close(
            Path::new(env!("CARGO_BIN_EXE_drogon-cli")),
            &self.data_dir,
            &self.session_id,
            &self.incarnation,
        ) {
            Ok(verdict) if verdict == "exited" => {
                eprintln!(
                    "closed real-model session {} on the unwind path \
                     (daemon observed exited)",
                    self.session_id
                );
            }
            outcome => {
                eprintln!(
                    "WARNING: real-model session {} unwind closure is \
                     unverifiable/cleanup-failed (outcome: {outcome:?})",
                    self.session_id
                );
            }
        }
    }
}

/// The Drop path's own fallible best-effort close, used ONLY there: unlike
/// `run_cli`/`coordinator_call` (whose `.expect` on spawn is correct on the
/// normal path but would double-panic during unwind), this adapter maps
/// every failure mode — spawn io::Error, non-zero CLI exit, unparsable or
/// refused output, missing verdict — into a reported `Err`, and returns
/// `Ok(verdict)` only for a fully proven observation. It never panics and
/// never catches broader panics.
fn best_effort_close(
    cli: &Path,
    data_dir: &Path,
    session_id: &str,
    incarnation: &str,
) -> Result<String, String> {
    let output = Command::new(cli)
        .args([
            "--json",
            "terminal",
            "close",
            "--session",
            session_id,
            "--incarnation",
            incarnation,
        ])
        .env("DROGON_DATA_DIR", data_dir)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("spawn drogon-cli: {error}"))?;
    if !output.status.success() {
        return Err(format!("cli exit {:?}", output.status.code()));
    }
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    let value: Value = serde_json::from_str(&text)
        .map_err(|error| format!("unparsable close output: {error}; stdout={text:?}"))?;
    if value["ok"] != Value::Bool(true) {
        return Err(format!("close refused: {text:?}"));
    }
    value["result"]["verdict"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| format!("close result carries no verdict: {text:?}"))
}

/// The adapter's failure mapping is deterministic: a bogus argv0 (inside a
/// directory that does not exist) fails the spawn with an io::Error, which
/// surfaces as `Err` carrying the spawn reason — never as a panic.
#[test]
fn unwind_close_adapter_maps_spawn_failure_to_unverifiable_without_panicking() {
    let absent_dir = std::env::temp_dir().join("drogon-dogfood-no-such-cli-dir");
    let bogus_cli = absent_dir.join("no-such-cli");
    let data_dir = std::env::temp_dir().join("drogon-dogfood-no-such-data-dir");
    let outcome = best_effort_close(&bogus_cli, &data_dir, "session-x", "incarnation-x");
    let reason = outcome.expect_err("a spawn failure must map to Err, never panic, on any uid");
    assert!(
        reason.contains("spawn drogon-cli"),
        "the failure must name the spawn step: {reason}"
    );
}

/// Owns a real-model coordinated-journey dispatch for the test's lifetime.
/// The underlying real `claude` process, spawned via `orchestration
/// worker-start`, is a persistent interactive session with no natural exit
/// once it finishes responding — unlike the fixture leg's script (which
/// exits on its own) or the `--print` probe leg (which is genuinely
/// one-shot) — so the happy path here always force-stops it via
/// `worker-stop` (safe/idempotent even if it already exited) before
/// releasing. `Drop` mirrors `SessionGuard`'s unwind semantics exactly: a
/// best-effort, non-panicking stop-then-release that REPORTS whether cleanup
/// was actually proven instead of claiming it (a panic inside `Drop` during
/// unwind would abort the whole process).
struct DispatchGuard {
    data_dir: PathBuf,
    run_id: String,
    coordinator_id: String,
    dispatch_id: String,
    settled: bool,
}

/// The only value that proves a worker's underlying process actually ended.
/// Mirrors `SessionGuard`'s own exact-string idiom (`verdict == "exited"`)
/// rather than inventing a new rule for `DispatchGuard`: per this project's
/// liveness contract (`live` / `unverifiable` / `exited`), a missing field,
/// `live`, `unverifiable` (lost contact — "never proof of process exit"), or
/// any other/unrecognized string must all fail closed identically. Only
/// `"exited"` may be treated as cleanup proof.
fn is_proven_exited(verdict: &Value) -> bool {
    verdict.as_str() == Some("exited")
}

impl DispatchGuard {
    fn scope_args(&self, args: &mut Vec<String>) {
        args.push("--run".into());
        args.push(self.run_id.clone());
        args.push("--coordinator-id".into());
        args.push(self.coordinator_id.clone());
        args.push("--consumer-generation".into());
        args.push("1".into());
        args.push("--dispatch".into());
        args.push(self.dispatch_id.clone());
    }

    /// Happy path: explicit `worker-stop` (fences and force-signals; safe
    /// even if the process already exited on its own), a bounded wait for the
    /// daemon to actually observe it leave `live`, then explicit
    /// `worker-release`, asserting a clean, non-live disposition. Consumes
    /// self so `Drop` never re-runs any of this.
    fn stop_and_release(mut self) -> Value {
        let mut stop_args: Vec<String> = vec!["orchestration".into(), "worker-stop".into()];
        self.scope_args(&mut stop_args);
        let stop_ref: Vec<&str> = stop_args.iter().map(String::as_str).collect();
        let (code, stop) = coordinator_call(&self.data_dir, &stop_ref);
        assert_eq!(code, 0, "worker-stop must be accepted: {stop:#}");

        let start = Instant::now();
        let last_show = loop {
            let mut show_args: Vec<String> = vec!["orchestration".into(), "worker-show".into()];
            self.scope_args(&mut show_args);
            let show_ref: Vec<&str> = show_args.iter().map(String::as_str).collect();
            let (code, show) = coordinator_call(&self.data_dir, &show_ref);
            assert_ok(code, &show, &["orchestration", "worker-show"]);
            if is_proven_exited(&show["result"]["processVerdict"])
                || start.elapsed() > STOP_OBSERVATION_TIMEOUT
            {
                break show;
            }
            std::thread::sleep(POLL_INTERVAL * 4);
        };
        // Fail closed: process cleanup may be asserted ONLY on an explicit
        // `exited` verdict. `live`, `unverifiable` (lost contact — never
        // proof of exit), a missing field, and any other/unrecognized string
        // are all treated identically here — none of them proves the
        // process ended, so none may be silently accepted as cleanup
        // evidence before the guard is marked settled.
        assert!(
            is_proven_exited(&last_show["result"]["processVerdict"]),
            "process cleanup requires an explicit `exited` verdict before it \
             can be asserted — live/unverifiable/missing/unknown are NOT \
             cleanup proof and must fail closed: {last_show:#}"
        );

        let mut release_args: Vec<String> = vec!["orchestration".into(), "worker-release".into()];
        self.scope_args(&mut release_args);
        let release_ref: Vec<&str> = release_args.iter().map(String::as_str).collect();
        let (code, release) = coordinator_call(&self.data_dir, &release_ref);
        assert_eq!(
            code, 0,
            "release of a stopped attempt must succeed: {release:#}"
        );
        assert_eq!(
            text_field(&release, "/result/disposition"),
            "released",
            "the dispatch's process/handle must be exactly released, not \
             retained: {release:#}"
        );
        assert!(
            is_proven_exited(&release["result"]["processVerdict"]),
            "release must report an explicit `exited` processVerdict before \
             the guard is marked settled — live/unverifiable/missing/unknown \
             are not proof no process/handle survived: {release:#}"
        );
        self.settled = true;
        release
    }
}

impl Drop for DispatchGuard {
    fn drop(&mut self) {
        if self.settled {
            return;
        }
        match best_effort_stop_and_release(
            Path::new(env!("CARGO_BIN_EXE_drogon-cli")),
            &self.data_dir,
            &self.run_id,
            &self.coordinator_id,
            &self.dispatch_id,
        ) {
            Ok(disposition) if disposition == "released" => {
                eprintln!(
                    "stopped and released real-model journey dispatch {} on the \
                     unwind path",
                    self.dispatch_id
                );
            }
            outcome => {
                eprintln!(
                    "WARNING: real-model journey dispatch {} unwind stop/release \
                     is unverifiable/cleanup-failed (outcome: {outcome:?})",
                    self.dispatch_id
                );
            }
        }
    }
}

/// The Drop path's own fallible best-effort stop-then-release, used ONLY
/// there, mirroring `best_effort_close` exactly: no `.expect`/`.unwrap`, no
/// broad panic catching, every failure mode mapped to a reported `Err`, and
/// `Ok(disposition)` returned only for a fully proven `released` outcome.
/// Fixed to the real `STOP_OBSERVATION_TIMEOUT` bound — see
/// `best_effort_stop_and_release_bounded` for the parameterized body this
/// delegates to (parameterized only so the fail-closed unit test below can
/// prove the same rule quickly, without waiting out the full real-world
/// bound for every non-exited case).
fn best_effort_stop_and_release(
    cli: &Path,
    data_dir: &Path,
    run_id: &str,
    coordinator_id: &str,
    dispatch_id: &str,
) -> Result<String, String> {
    best_effort_stop_and_release_bounded(
        cli,
        data_dir,
        run_id,
        coordinator_id,
        dispatch_id,
        STOP_OBSERVATION_TIMEOUT,
    )
}

/// Disposition alone (the pre-correction check) is not cleanup proof: this
/// now applies the exact same fail-closed rule as `stop_and_release`
/// (`is_proven_exited`), plus the same bounded observation between stop and
/// release. `unverifiable` (lost contact), `live`, a missing field, or any
/// other/unrecognized processVerdict all map to `Err` (evidence retained,
/// reported by the caller as a WARNING) rather than a silently claimed
/// `Ok("released")`.
fn best_effort_stop_and_release_bounded(
    cli: &Path,
    data_dir: &Path,
    run_id: &str,
    coordinator_id: &str,
    dispatch_id: &str,
    observation_timeout: Duration,
) -> Result<String, String> {
    let scope = [
        "--run",
        run_id,
        "--coordinator-id",
        coordinator_id,
        "--consumer-generation",
        "1",
        "--dispatch",
        dispatch_id,
    ];
    let call = |verb: &str| -> Result<Value, String> {
        let mut args = vec!["--json", "orchestration", verb];
        args.extend_from_slice(&scope);
        let output = Command::new(cli)
            .args(&args)
            .env("DROGON_DATA_DIR", data_dir)
            .stdin(Stdio::null())
            .output()
            .map_err(|error| format!("spawn drogon-cli {verb}: {error}"))?;
        if !output.status.success() {
            return Err(format!("cli {verb} exit {:?}", output.status.code()));
        }
        let text = String::from_utf8_lossy(&output.stdout).into_owned();
        let value: Value = serde_json::from_str(&text)
            .map_err(|error| format!("unparsable {verb} output: {error}; stdout={text:?}"))?;
        if value["ok"] != Value::Bool(true) {
            return Err(format!("{verb} refused: {text:?}"));
        }
        Ok(value)
    };

    call("worker-stop")?;

    // Bounded observation, mirroring `stop_and_release`'s own poll: only an
    // explicit `exited` verdict proves cleanup, and this loop never returns
    // early on anything less than that.
    let start = Instant::now();
    let last_verdict = loop {
        let show = call("worker-show")?;
        let verdict = show["result"]["processVerdict"].clone();
        if is_proven_exited(&verdict) || start.elapsed() > observation_timeout {
            break verdict;
        }
        std::thread::sleep(POLL_INTERVAL * 4);
    };
    if !is_proven_exited(&last_verdict) {
        return Err(format!(
            "process cleanup not proven within {observation_timeout:?}: observed \
             processVerdict {last_verdict:?} (live/unverifiable/missing/unknown are \
             not exited proof; evidence retained, not force-closed)"
        ));
    }

    let release = call("worker-release")?;
    let disposition = release["result"]["disposition"]
        .as_str()
        .ok_or_else(|| format!("release result carries no disposition: {release:?}"))?
        .to_string();
    if disposition != "released" {
        return Err(format!("release disposition not `released`: {disposition}"));
    }
    if !is_proven_exited(&release["result"]["processVerdict"]) {
        return Err(format!(
            "release did not report an explicit exited processVerdict: {release:?}"
        ));
    }
    Ok(disposition)
}

/// Mirrors `unwind_close_adapter_maps_spawn_failure_to_unverifiable_without_panicking`
/// for the new adapter: a bogus argv0 fails the spawn with an io::Error,
/// surfaced as `Err` naming the spawn step — never a panic.
#[test]
fn unwind_stop_release_adapter_maps_spawn_failure_to_unverifiable_without_panicking() {
    let absent_dir = std::env::temp_dir().join("drogon-dogfood-no-such-cli-dir-2");
    let bogus_cli = absent_dir.join("no-such-cli");
    let data_dir = std::env::temp_dir().join("drogon-dogfood-no-such-data-dir-2");
    let outcome = best_effort_stop_and_release(
        &bogus_cli,
        &data_dir,
        "run-x",
        "coordinator-x",
        "dispatch-x",
    );
    let reason = outcome.expect_err("a spawn failure must map to Err, never panic, on any uid");
    assert!(
        reason.contains("spawn drogon-cli"),
        "the failure must name the spawn step: {reason}"
    );
}

/// Exhaustive coverage of the fail-closed exact-`exited` rule shared by
/// `stop_and_release` and `best_effort_stop_and_release_bounded`: only the
/// literal string `"exited"` proves cleanup. `live`, `unverifiable` (lost
/// contact — see this project's `live`/`unverifiable`/`exited` liveness
/// contract), a missing field, and any other/unrecognized string must all
/// fail closed identically.
#[test]
fn only_explicit_exited_verdict_proves_cleanup_all_others_fail_closed() {
    let cases: [(&str, Value, bool); 5] = [
        ("live", Value::from("live"), false),
        ("unverifiable", Value::from("unverifiable"), false),
        ("missing", Value::Null, false),
        ("unknown", Value::from("some-unrecognized-value"), false),
        ("exited", Value::from("exited"), true),
    ];
    for (label, verdict, expected) in cases {
        assert_eq!(
            is_proven_exited(&verdict),
            expected,
            "case {label}: verdict {verdict:?} must map to is_proven_exited() == {expected}"
        );
    }
}

/// Fixture stub standing in for `drogon-cli` itself, used only by
/// `best_effort_stop_and_release_fails_closed_for_every_non_exited_verdict`
/// below: a real subprocess is still spawned (exercising the function's
/// actual spawn/parse/retry plumbing for real, not a mocked-out call
/// closure), but every response is fully controlled. It reads its verdict
/// back out of the value that follows `--run` in argv (the one flag this
/// stub actually inspects; the real function is never told this value means
/// anything beyond an opaque scope id, so this is purely a test-fixture
/// signaling channel, not a claim about what `--run` means in production),
/// so the fail-closed behavior can be proven for every verdict case without
/// a real daemon, process, or dispatch. `worker-release` always reports
/// `disposition: "released"` so the only varying factor across cases is
/// `processVerdict`, isolating exactly the rule under test.
const STUB_STOP_RELEASE_CLI_SCRIPT: &str = r#"#!/usr/bin/env bash
set -u

verb=""
verdict="exited"
prev=""
for arg in "$@"; do
  if [ "$prev" = "--run" ]; then
    verdict="$arg"
  fi
  case "$arg" in
    worker-stop|worker-show|worker-release)
      verb="$arg"
      ;;
  esac
  prev="$arg"
done

case "$verb" in
  worker-stop)
    printf '{"ok":true,"result":{}}\n'
    ;;
  worker-show)
    if [ "$verdict" = "__missing__" ]; then
      printf '{"ok":true,"result":{}}\n'
    else
      printf '{"ok":true,"result":{"processVerdict":"%s"}}\n' "$verdict"
    fi
    ;;
  worker-release)
    if [ "$verdict" = "__missing__" ]; then
      printf '{"ok":true,"result":{"disposition":"released"}}\n'
    else
      printf '{"ok":true,"result":{"disposition":"released","processVerdict":"%s"}}\n' "$verdict"
    fi
    ;;
  *)
    printf '{"ok":false,"error":{"code":"unknown_verb"}}\n' >&2
    exit 1
    ;;
esac
"#;

fn write_stub_stop_release_cli(bin_dir: &Path) -> PathBuf {
    std::fs::create_dir_all(bin_dir).expect("create stub cli bin dir");
    let path = bin_dir.join("stub-drogon-cli");
    std::fs::write(&path, STUB_STOP_RELEASE_CLI_SCRIPT).expect("write stub cli script");
    let mut perms = std::fs::metadata(&path)
        .expect("stat stub cli script")
        .permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&path, perms).expect("chmod stub cli script");
    path
}

/// Proves the fail-closed rule end to end through the real function (not
/// just the pure `is_proven_exited` helper): `worker-show` reporting
/// anything other than an explicit `exited` verdict must never produce
/// `Ok("released")`, no matter what `disposition` says. Uses a short
/// `observation_timeout` (not the real `STOP_OBSERVATION_TIMEOUT`) purely so
/// the four non-exited cases below don't each wait out the full real-world
/// bound; the rule exercised is identical either way.
#[test]
fn best_effort_stop_and_release_fails_closed_for_every_non_exited_verdict() {
    let scratch = tempfile::tempdir().expect("scratch tempdir for stub cli");
    let stub_cli = write_stub_stop_release_cli(&scratch.path().join("stub-bin"));
    let data_dir = scratch.path().join("unused-data-dir");
    let fast_timeout = Duration::from_millis(200);

    for (label, verdict) in [
        ("live", "live"),
        ("unverifiable", "unverifiable"),
        ("missing", "__missing__"),
        ("unknown", "some-unrecognized-value"),
    ] {
        let outcome = best_effort_stop_and_release_bounded(
            &stub_cli,
            &data_dir,
            verdict,
            "coordinator-x",
            "dispatch-x",
            fast_timeout,
        );
        assert!(
            outcome.is_err(),
            "verdict case {label} ({verdict}) must fail closed (Err, evidence \
             retained), never silently report Ok(\"released\"): {outcome:?}"
        );
    }

    let proven = best_effort_stop_and_release_bounded(
        &stub_cli,
        &data_dir,
        "exited",
        "coordinator-x",
        "dispatch-x",
        fast_timeout,
    );
    assert_eq!(
        proven.as_deref(),
        Ok("released"),
        "an explicit `exited` verdict must be the one case that proves a \
         released outcome: {proven:?}"
    );
}
