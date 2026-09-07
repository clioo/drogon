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
//! runs when explicitly opted into via `DROGON_DOGFOOD_REAL_MODEL=1`;
//! otherwise it records why it skipped and passes, so routine runs of this
//! suite never silently spend money or flake on network availability.

#![cfg(unix)]

mod common;

use std::io::Read as _;
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
    let mut out = String::new();
    let mut err = String::new();
    if let Some(mut pipe) = child.stdout.take() {
        let _ = pipe.read_to_string(&mut out);
    }
    if let Some(mut pipe) = child.stderr.take() {
        let _ = pipe.read_to_string(&mut err);
    }
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
  --kind final-report --subject "fixture $mode" --outcome "$outcome" \
  --body "fixture worker report" > first-report.json 2> first-report.stderr
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
            "--instructions",
            "Write a fixture artifact file and report the exact outcome.",
            "--title",
            "V1 dogfood fixture task",
        ]
        .map(String::from),
    );
    let task_args_ref: Vec<&str> = task_args.iter().map(String::as_str).collect();
    let (code, task) = coordinator_call(&data_dir, &task_args_ref);
    assert_ok(code, &task, &["orchestration", "task-create"]);
    let task_id = text_field(&task, "/result/task/taskId").to_string();
    assert_eq!(text_field(&task, "/result/task/status"), "ready");

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

    let mut task_show_args: Vec<String> = vec!["orchestration".into(), "task-show".into()];
    scope_args(&mut task_show_args);
    task_show_args.extend(["--task".to_string(), task_id.clone()]);
    let task_show_ref: Vec<&str> = task_show_args.iter().map(String::as_str).collect();
    let (code, task_show_1) = coordinator_call(&data_dir, &task_show_ref);
    assert_ok(code, &task_show_1, &["orchestration", "task-show"]);
    assert_eq!(text_field(&task_show_1, "/result/task/status"), "failed");

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

    // --- exact release: both settled attempts release their session
    // resources; the process already exited on its own after reporting ---
    for dispatch in [&dispatch1, &dispatch2] {
        let mut release_args: Vec<String> = vec!["orchestration".into(), "worker-release".into()];
        scope_args(&mut release_args);
        release_args.extend(["--dispatch".to_string(), dispatch.clone()]);
        let release_ref: Vec<&str> = release_args.iter().map(String::as_str).collect();
        let (code, release) = coordinator_call(&data_dir, &release_ref);
        assert_eq!(
            code, 0,
            "release of a settled, already-exited attempt must succeed: {release:#}"
        );
        assert_eq!(text_field(&release, "/result/disposition"), "released");
    }

    // `daemon` and `scratch` drop here: the daemon process is signaled and
    // reaped (see `Daemon::drop`), then the ephemeral data/workspace
    // directories are removed. No process, socket file or workspace
    // directory outlives this test.
    drop(daemon);
    drop(scratch);
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
    if std::env::var_os(REAL_MODEL_OPT_IN_ENV).is_none() {
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
            "--print",
            "--output-format",
            "json",
            &prompt,
        ],
    );
    assert_ok(code, &created, &["terminal", "create"]);
    let session_id = text_field(&created, "/result/id").to_string();
    let incarnation = text_field(&created, "/result/incarnation").to_string();

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

    let data_base64 = text_field(&last_read, "/result/dataBase64");
    let raw_bytes = STANDARD
        .decode(data_base64)
        .expect("session output must be valid base64");
    let output_text = String::from_utf8_lossy(&raw_bytes).into_owned();
    assert!(
        output_text.contains(MARKER),
        "real model output did not contain the requested marker.\n\
         latency={latency:?}\nraw output bytes={raw_bytes:?}\ntext={output_text:?}"
    );

    let exit_code = last_read["result"]["session"]["exitCode"].clone();

    let evidence = format!(
        "V1 dogfood real-model leg: PASSED\n\
         command: claude --print --output-format json <prompt>\n\
         session_id: {session_id}\n\
         incarnation: {incarnation}\n\
         daemon-observed exit code: {exit_code:?}\n\
         wall latency (session create -> observed exited verdict): {latency:?}\n\
         output bytes ({} bytes, base64-decoded from the real daemon session read): {output_text:?}\n",
        raw_bytes.len(),
    );
    // Printed (not written under `scratch`, which is removed on drop below):
    // run with `-- --nocapture` to capture this into the evidence doc.
    eprint!("{evidence}");

    drop(daemon);
    drop(scratch);
}
