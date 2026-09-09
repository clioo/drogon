//! Native orchestration CLI subprocess tests.
//!
//! Real compiled `drogon-cli` binary against an isolated mock transport
//! (protocol peer only). These tests prove CLI behavior — argument mapping to
//! the typed RPC contracts, scope/credential handling, preflight and
//! exit codes — NOT native engine parity. Data dirs, sockets and token files
//! are real; every child runs with a cleared environment and a hard timeout
//! with exact owned cleanup. All credentials are synthetic test literals.
//! Unix-only, like the existing suites.

#![cfg(unix)]

mod common;

use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use common::{Action, Behavior, MockService, TOKEN, error_envelope, ok_envelope};

const SCOPED_CREDENTIAL: &str = "synthetic-native-cli-worker-0001";
const CHILD_TIMEOUT: Duration = Duration::from_secs(60);
const HOST: &str = "host-1";

/// One CLI invocation's resolved view.
struct Invocation {
    exit_code: i32,
    stdout: String,
    stderr: String,
}

/// Runs the built binary with a cleared environment: only the data dir and
/// explicitly listed variables are set, so no live user daemon or inherited
/// identity can leak in. Bounded pipe draining on dedicated threads and a
/// deadline kill of the exact child.
fn run_cli(data_dir: &Path, args: &[&str], env: &[(&str, &OsString)]) -> Invocation {
    let mut child = Command::new(env!("CARGO_BIN_EXE_drogon-cli"));
    child
        .env_clear()
        .env("DROGON_DATA_DIR", data_dir)
        .args(args);
    for (key, value) in env {
        child.env(key, value);
    }
    child
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = child.spawn().expect("spawn drogon-cli");
    let mut stdout_pipe = child.stdout.take().expect("stdout pipe");
    let mut stderr_pipe = child.stderr.take().expect("stderr pipe");
    let stdout_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout_pipe.read_to_end(&mut bytes);
        String::from_utf8_lossy(&bytes).into_owned()
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr_pipe.read_to_end(&mut bytes);
        String::from_utf8_lossy(&bytes).into_owned()
    });
    let deadline = Instant::now() + CHILD_TIMEOUT;
    loop {
        match child.try_wait().expect("poll child") {
            Some(status) => {
                return Invocation {
                    exit_code: status.code().unwrap_or(-1),
                    stdout: stdout_reader.join().expect("stdout reader"),
                    stderr: stderr_reader.join().expect("stderr reader"),
                };
            }
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                panic!("drogon-cli subprocess exceeded 60s");
            }
            None => std::thread::sleep(Duration::from_millis(10)),
        }
    }
}

fn temp_dir(name: &str) -> PathBuf {
    // Kept alive for the whole test via PathBuf; cleaned by each test's tail.
    tempfile::Builder::new()
        .prefix(&format!("dg-native-{name}-"))
        .tempdir()
        .expect("tempdir")
        .keep()
}

fn os(value: &str) -> OsString {
    OsString::from(value)
}

/// Standard mock: read-only status advertising the native capability plus a
/// canned answer per orchestration method.
fn mock_behavior(advertise: bool, canned: Vec<(&str, Value)>) -> Behavior {
    // Responses are consumed in order per method: two entries for one method
    // answer the first and second calls respectively.
    let canned: Arc<Mutex<Vec<(String, Value)>>> = Arc::new(Mutex::new(
        canned
            .into_iter()
            .map(|(m, v)| (m.to_string(), v))
            .collect(),
    ));
    Arc::new(move |request| {
        let request_id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => {
                let capabilities = if advertise {
                    json!(["workspace.v1", "orchestration.native.v1"])
                } else {
                    json!(["workspace.v1"])
                };
                Action::Respond(ok_envelope(
                    &request_id,
                    json!({
                        "hostId": HOST,
                        "serviceInstanceId": "svc-1",
                        "protocol": 1,
                        "capabilities": capabilities,
                        "version": "0.1.0"
                    }),
                ))
            }
            Some(method) => {
                let mut queue = canned.lock().expect("canned lock");
                match queue.iter().position(|(name, _)| name == method) {
                    Some(index) => {
                        let (_, result) = queue.remove(index);
                        Action::Respond(ok_envelope(&request_id, result))
                    }
                    None => Action::Respond(error_envelope(
                        &request_id,
                        "method_not_found",
                        "mock lacks this method",
                    )),
                }
            }
            None => Action::Respond(error_envelope(&request_id, "invalid_argument", "bad")),
        }
    })
}

fn coordinator_args() -> Vec<&'static str> {
    vec![
        "--run",
        "run-1",
        "--coordinator-id",
        "coord-1",
        "--consumer-generation",
        "3",
    ]
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn run_list_human_output_matches_source_rows_and_cursor_text() {
    let dir = tempfile::tempdir().unwrap();
    let _mock = MockService::start(
        dir.path(),
        mock_behavior(
            true,
            vec![(
                "orchestration.runList",
                json!({"runs":[
                    {"runId":"run-1","objective":"first","coordinatorId":"c","consumerGeneration":1,"createdAtMs":1},
                    {"runId":"run-2","objective":"second","coordinatorId":"c","consumerGeneration":1,"createdAtMs":2}
                ],"nextCursor":"cursor-9"}),
            )],
        ),
    );
    let invocation = run_cli(dir.path(), &["orchestration", "run-list"], &[]);
    assert_eq!(invocation.exit_code, 0, "{}", invocation.stderr);
    assert_eq!(
        invocation.stdout.trim_end(),
        "run-1 first\nrun-2 second\nMore Runs: --cursor cursor-9"
    );
    let dir2 = tempfile::tempdir().unwrap();
    let _mock2 = MockService::start(
        dir2.path(),
        mock_behavior(
            true,
            vec![(
                "orchestration.runList",
                json!({"runs":[],"nextCursor":null}),
            )],
        ),
    );
    let empty = run_cli(dir2.path(), &["orchestration", "run-list"], &[]);
    assert_eq!(empty.exit_code, 0);
    assert_eq!(empty.stdout.trim_end(), "No Runs found.");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn run_show_human_output_matches_source_two_line_shape() {
    let dir = tempfile::tempdir().unwrap();
    // 2024-01-02T03:04:05Z = 1704164645000 ms.
    let _mock = MockService::start(
        dir.path(),
        mock_behavior(
            true,
            vec![(
                "orchestration.runShow",
                json!({"run":{"runId":"run-1","objective":"Ship the release","coordinatorId":"coord-1","consumerGeneration":3,"createdAtMs":1_704_164_645_000_u64}}),
            )],
        ),
    );
    let invocation = run_cli(
        dir.path(),
        &["orchestration", "run-show", "--id", "run-1"],
        &[],
    );
    assert_eq!(invocation.exit_code, 0, "{}", invocation.stderr);
    assert_eq!(
        invocation.stdout.trim_end(),
        "run-1 Ship the release\nconsumer generation 3; created 2024-01-02T03:04:05Z"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn send_to_run_id_and_at_group_use_source_target_spellings() {
    for (to, expected) in [
        ("run:run-1", json!({"kind": "runHome"})),
        ("@all", json!({"kind":"group","name":"all"})),
        (
            "@worktree:ws-9",
            json!({"kind":"group","name":"worktree:ws-9"}),
        ),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let mock = MockService::start(
            dir.path(),
            mock_behavior(
                true,
                vec![(
                    "orchestration.send",
                    json!({"message":{"messageId":"msg-1","sequence":1,"runId":"run-1","kind":"status"},"deliveries":1}),
                )],
            ),
        );
        let mut args = vec![
            "--json",
            "orchestration",
            "send",
            "--kind",
            "status",
            "--subject",
            "hi",
            "--to",
            to,
        ];
        args.extend(coordinator_args());
        let invocation = run_cli(dir.path(), &args, &[]);
        assert_eq!(
            invocation.exit_code, 0,
            "{to}: {} {}",
            invocation.stdout, invocation.stderr
        );
        let sent = mock
            .captured()
            .into_iter()
            .find(|r| r["method"] == "orchestration.send")
            .unwrap();
        assert_eq!(sent["params"]["to"], expected, "{to}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn structured_payload_flags_build_the_source_payload_object() {
    let dir = tempfile::tempdir().unwrap();
    let mock = MockService::start(
        dir.path(),
        mock_behavior(
            true,
            vec![(
                "orchestration.send",
                json!({"message":{"messageId":"msg-9","sequence":3,"runId":"run-1","kind":"finalReport"},"deliveries":1}),
            )],
        ),
    );
    let mut args: Vec<&str> = vec![
        "--json",
        "orchestration",
        "send",
        "--type",
        "worker_done",
        "--subject",
        "done",
        "--outcome",
        "succeeded",
        "--task-id",
        "task-1",
        "--dispatch-id",
        "dispatch-1",
        "--files-modified",
        " a.rs , b.rs ",
        "--report-path",
        "report.md",
    ];
    args.extend(coordinator_args());
    let invocation = run_cli(dir.path(), &args, &[]);
    assert_eq!(invocation.exit_code, 0, "{}", invocation.stderr);
    let sent = mock
        .captured()
        .into_iter()
        .find(|r| r["method"] == "orchestration.send")
        .unwrap();
    assert_eq!(
        sent["params"]["payload"],
        json!({"taskId":"task-1","dispatchId":"dispatch-1","outcome":"succeeded","filesModified":["a.rs","b.rs"],"reportPath":"report.md"})
    );
    // Mixing raw and structured payloads is the source usage error.
    let dir2 = tempfile::tempdir().unwrap();
    let _mock2 = MockService::start(dir2.path(), mock_behavior(true, vec![]));
    let mixed = run_cli(
        dir2.path(),
        &[
            "orchestration",
            "send",
            "--kind",
            "status",
            "--subject",
            "x",
            "--payload",
            "{}",
            "--phase",
            "implementing",
            "--run",
            "run-1",
            "--coordinator-id",
            "coord-1",
            "--consumer-generation",
            "3",
        ],
        &[],
    );
    assert_eq!(mixed.exit_code, 2);
    assert!(
        mixed
            .stderr
            .contains("Use either --payload or structured payload flags")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn source_mail_kinds_round_trip_as_opaque_mail() {
    for (kind, wire) in [
        ("dispatch", "dispatch"),
        ("merge_ready", "mergeReady"),
        ("handoff", "handoff"),
        ("decision_gate", "decisionGate"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let mock = MockService::start(
            dir.path(),
            mock_behavior(
                true,
                vec![(
                    "orchestration.send",
                    json!({"message":{"messageId":"msg-1","sequence":7,"runId":"run-1","kind":wire},"deliveries":1}),
                )],
            ),
        );
        let mut args = vec![
            "--json",
            "orchestration",
            "send",
            "--kind",
            kind,
            "--subject",
            "opaque",
        ];
        args.extend(coordinator_args());
        let invocation = run_cli(dir.path(), &args, &[]);
        assert_eq!(
            invocation.exit_code, 0,
            "{kind}: {} {}",
            invocation.stdout, invocation.stderr
        );
        let sent = mock
            .captured()
            .into_iter()
            .find(|r| r["method"] == "orchestration.send")
            .unwrap();
        assert_eq!(sent["params"]["kind"], json!(wire));
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn retired_coordinator_verbs_fail_before_any_runtime_contact_with_migration_data() {
    for (verb, alias) in [
        ("coordinator-start", "run"),
        ("coordinator-stop", "run-stop"),
    ] {
        for path in [verb, alias] {
            let dir = tempfile::tempdir().unwrap();
            // No mock started: the socket is absent, so any runtime contact
            // would fail transport — proving the retirement is client-side.
            let invocation = run_cli(dir.path(), &["--json", "orchestration", path], &[]);
            assert_eq!(invocation.exit_code, 1, "{path}: {}", invocation.stderr);
            let value: Value = serde_json::from_str(&invocation.stdout).unwrap_or_else(|_| {
                panic!("{path} must emit a JSON envelope: {}", invocation.stdout)
            });
            assert_eq!(value["ok"], json!(false));
            assert_eq!(value["error"]["code"], "orchestration_migration_required");
            assert!(
                value["error"]["message"]
                    .as_str()
                    .unwrap()
                    .contains("No effects were applied")
            );
            let data = &value["error"]["data"];
            assert_eq!(data["reason"], "command_retired");
            assert_eq!(data["effectsApplied"], json!(false));
            assert_eq!(
                data["nextCommandArgs"],
                json!(["skills", "get", "orchestration", "--full"])
            );
            assert_eq!(
                data["guide"],
                json!({"topic": "orchestration", "full": true})
            );
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn retain_does_not_derive_mutation_authority_from_named_run_inspection() {
    let dir = tempfile::tempdir().unwrap();
    let mock = MockService::start(dir.path(), mock_behavior(true, vec![]));
    let invocation = run_cli(
        dir.path(),
        &[
            "orchestration",
            "worker-retain",
            "--run",
            "run-1",
            "--dispatch",
            "dispatch-1",
        ],
        &[],
    );
    assert_eq!(invocation.exit_code, 2);
    assert!(
        mock.captured().is_empty(),
        "retention must not guess coordinator ownership via run-show"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn terminal_binding_capability_is_required_before_any_mutation() {
    let dir = tempfile::tempdir().unwrap();
    let mock = MockService::start(dir.path(), mock_behavior(true, vec![]));
    let invocation = run_cli(
        dir.path(),
        &[
            "--json",
            "orchestration",
            "run-create",
            "--objective",
            "fixture",
            "--from",
            "terminal-1",
        ],
        &[],
    );
    assert_ne!(invocation.exit_code, 0);
    let value: Value = serde_json::from_str(&invocation.stdout).unwrap();
    assert_eq!(value["error"]["code"], "unsupported_feature");
    assert_eq!(
        mock.captured()
            .iter()
            .map(|r| r["method"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["status"]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn root_worker_read_decodes_terminal_bytes_and_checks_cursor_span() {
    for (encoded, end, expected_exit) in
        [("aGVsbG8=", 5, 0), ("aGVsbG8=", 6, 1), ("not-base64", 5, 1)]
    {
        let dir = tempfile::tempdir().unwrap();
        let _mock = MockService::start(
            dir.path(),
            mock_behavior(
                true,
                vec![(
                    "orchestration.workerRead",
                    json!({"dispatchId":"dispatch-1","source":"terminal","processVerdict":"exited",
                "entries":[{"sequence":0,"sourceIdentity":"stream-1",
                    "content":{"dataBase64":encoded,"startCursor":0,"nextCursor":end,"truncated":false}}]}),
                )],
            ),
        );
        let mut args = vec!["orchestration", "worker-read", "--dispatch", "dispatch-1"];
        args.extend(coordinator_args());
        let invocation = run_cli(dir.path(), &args, &[]);
        assert_eq!(
            invocation.exit_code, expected_exit,
            "{} {}",
            invocation.stdout, invocation.stderr
        );
        if expected_exit == 0 {
            assert!(invocation.stdout.contains("hello"), "{}", invocation.stdout);
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn root_review_run_use_rejects_wrong_coordinator_or_generation() {
    for (coordinator, generation, takeover) in [
        ("foreign-coordinator", 3, false),
        ("coord-1", 4, false),
        ("coord-1", 3, true),
        ("coord-1", 5, true),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let result = json!({"run": {
            "runId": "run-1", "objective": "Ship it",
            "coordinatorId": coordinator, "consumerGeneration": generation,
            "createdAtMs": 1_700_000_000_000i64
        }});
        let _mock = MockService::start(
            dir.path(),
            mock_behavior(true, vec![("orchestration.runUse", result)]),
        );
        let mut args = vec!["orchestration", "run-use", "--json"];
        args.extend(coordinator_args());
        if takeover {
            args.push("--takeover");
        }
        let invocation = run_cli(dir.path(), &args, &[]);
        assert_eq!(
            invocation.exit_code, 1,
            "accepted wrong binding: {}",
            invocation.stdout
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn root_review_task_list_rejects_malformed_cursor() {
    for cursor in ["", "bad\ncursor"] {
        let dir = tempfile::tempdir().unwrap();
        let _mock = MockService::start(
            dir.path(),
            mock_behavior(
                true,
                vec![(
                    "orchestration.taskList",
                    json!({"tasks": [], "nextCursor": cursor}),
                )],
            ),
        );
        let mut args = vec!["orchestration", "task-list", "--json"];
        args.extend(coordinator_args());
        let invocation = run_cli(dir.path(), &args, &[]);
        assert_eq!(
            invocation.exit_code, 1,
            "accepted malformed cursor: {}",
            invocation.stdout
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn review_worker_read_prints_returned_content() {
    let dir = tempfile::tempdir().unwrap();
    let _mock = MockService::start(
        dir.path(),
        mock_behavior(
            true,
            vec![(
                "orchestration.workerRead",
                json!({"dispatchId":"dispatch-1", "source":"terminal",
        "processVerdict":"live", "entries":[{"sequence":1,"sourceIdentity":"session-1",
        "content":"actual worker output sentinel"}]}),
            )],
        ),
    );
    let mut args = vec!["orchestration", "worker-read", "--dispatch", "dispatch-1"];
    args.extend(coordinator_args());
    let output = run_cli(dir.path(), &args, &[]);
    assert_eq!(output.exit_code, 0, "{}", output.stderr);
    assert!(
        output.stdout.contains("actual worker output sentinel"),
        "{}",
        output.stdout
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn review_abandon_preserves_reason() {
    let dir = tempfile::tempdir().unwrap();
    let mock = MockService::start(
        dir.path(),
        mock_behavior(
            true,
            vec![(
                "orchestration.workerAbandon",
                json!({"dispatchId":"dispatch-1",
        "assignmentState":"abandoned", "residualResources":[]}),
            )],
        ),
    );
    let mut args = vec![
        "orchestration",
        "worker-abandon",
        "--dispatch",
        "dispatch-1",
        "--reason",
        "explicit uncertainty accepted",
        "--json",
    ];
    args.extend(coordinator_args());
    let output = run_cli(dir.path(), &args, &[]);
    assert_eq!(output.exit_code, 0, "{}", output.stderr);
    let calls = mock.captured();
    let request = calls
        .iter()
        .find(|r| r["method"] == "orchestration.workerAbandon")
        .unwrap();
    assert_eq!(request["params"]["reason"], "explicit uncertainty accepted");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn review_retained_release_never_claims_released() {
    let dir = tempfile::tempdir().unwrap();
    let _mock = MockService::start(
        dir.path(),
        mock_behavior(
            true,
            vec![(
                "orchestration.workerRelease",
                json!({"dispatchId":"dispatch-1",
        "disposition":"retained", "processVerdict":"live"}),
            )],
        ),
    );
    let mut args = vec![
        "orchestration",
        "worker-release",
        "--dispatch",
        "dispatch-1",
    ];
    args.extend(coordinator_args());
    let output = run_cli(dir.path(), &args, &[]);
    assert_eq!(output.exit_code, 0, "{}", output.stderr);
    assert!(output.stdout.contains("retained"));
    assert!(!output.stdout.contains("released"), "{}", output.stdout);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn review_failed_worker_start_exits_failure() {
    let dir = tempfile::tempdir().unwrap();
    let _mock = MockService::start(
        dir.path(),
        mock_behavior(
            true,
            vec![(
                "orchestration.workerStart",
                json!({"runId":"run-1", "taskId":"task-1",
        "dispatchId":"dispatch-1", "consumerGeneration":3, "workspaceId":"ws-1",
        "assignmentState":"failed", "readiness":"notObserved", "processVerdict":"unverifiable",
        "effects":[], "residualResources":[]}),
            )],
        ),
    );
    let mut args = vec![
        "orchestration",
        "worker-start",
        "--task",
        "task-1",
        "--workspace",
        "ws-1",
        "--harness",
        "harness-1",
        "--json",
    ];
    args.extend(coordinator_args());
    let output = run_cli(dir.path(), &args, &[]);
    assert_eq!(output.exit_code, 1, "{} {}", output.stdout, output.stderr);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn review_wrong_dispatch_result_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let _mock = MockService::start(
        dir.path(),
        mock_behavior(
            true,
            vec![(
                "orchestration.workerRelease",
                json!({"dispatchId":"unrelated-dispatch",
        "disposition":"retained", "processVerdict":"live"}),
            )],
        ),
    );
    let mut args = vec![
        "orchestration",
        "worker-release",
        "--dispatch",
        "dispatch-1",
        "--json",
    ];
    args.extend(coordinator_args());
    let output = run_cli(dir.path(), &args, &[]);
    assert_eq!(output.exit_code, 1, "{} {}", output.stdout, output.stderr);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn review_legacy_release_without_state_exits_1() {
    // Regression: a legacy `workerRelease` answer with no `state` field and
    // an `unverifiable` disposition is an honestly uncertain operation and
    // must exit 1 (restored fallback when state cannot distinguish
    // `release_pending` from `release_unknown`).
    let dir = tempfile::tempdir().unwrap();
    let _mock = MockService::start(
        dir.path(),
        mock_behavior(
            true,
            vec![(
                "orchestration.workerRelease",
                json!({"dispatchId":"dispatch-1",
        "disposition":"unverifiable", "processVerdict":"unverifiable"}),
            )],
        ),
    );
    let mut args = vec![
        "orchestration",
        "worker-release",
        "--dispatch",
        "dispatch-1",
    ];
    args.extend(coordinator_args());
    let output = run_cli(dir.path(), &args, &[]);
    assert_eq!(output.exit_code, 1, "{} {}", output.stdout, output.stderr);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn review_run_create_retry_preserves_generated_actor() {
    let dir = tempfile::tempdir().unwrap();
    let base = mock_behavior(true, vec![]);
    let mock = MockService::start(
        dir.path(),
        Arc::new(move |request| {
            if request["method"] == "orchestration.runCreate" {
                Action::Respond(ok_envelope(
                    request["requestId"].as_str().unwrap(),
                    json!({"run": {
                        "runId":"run-1", "coordinatorId":request["params"]["coordinatorId"],
                        "consumerGeneration":1,"objective":request["params"]["objective"],"createdAtMs":1
                    }}),
                ))
            } else {
                base(request)
            }
        }),
    );
    for request_flag in ["--request-id", "--retry-request"] {
        let output = run_cli(
            dir.path(),
            &[
                "orchestration",
                "run-create",
                "--objective",
                "retry this creation",
                request_flag,
                "stable-operation-1",
                "--json",
            ],
            &[],
        );
        assert_eq!(output.exit_code, 0, "{} {}", output.stdout, output.stderr);
    }
    let calls: Vec<_> = mock
        .captured()
        .into_iter()
        .filter(|r| r["method"] == "orchestration.runCreate")
        .collect();
    assert_eq!(calls.len(), 2);
    assert_eq!(
        calls[0]["params"], calls[1]["params"],
        "same retry must retain its actor namespace"
    );
}

// ---------------------------------------------------------------------------
// RED record: before implementation the compiled binary has no orchestration
// subcommand, so every desired invocation exits 2 (clap usage error) with an
// empty stdout. This first test documents that state and is replaced by the
// working suite once implemented.
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn orchestration_command_parses_instead_of_exiting_2() {
    let dir = temp_dir("red");
    let runs = json!({"runs": [], "nextCursor": null});
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.runList", runs)]),
    );
    let invocation = run_cli(&dir, &["orchestration", "run-list", "--json"], &[]);
    assert_eq!(
        invocation.exit_code, 0,
        "orchestration subcommand must exist and succeed; stderr: {}",
        invocation.stderr
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn run_create_maps_exact_params_and_returns_identity() {
    let dir = temp_dir("run-create");
    let result = json!({"run": {
        "runId": "run-1", "objective": "Ship it",
        "coordinatorId": "coord-1", "consumerGeneration": 1,
        "createdAtMs": 1_700_000_000_000i64
    }});
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.runCreate", result)]),
    );
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "run-create",
            "--json",
            "--objective",
            "Ship it",
            "--coordinator-id",
            "coord-1",
        ],
        &[],
    );
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    let requests = mock.captured();
    let create = requests
        .iter()
        .find(|r| r["method"] == "orchestration.runCreate")
        .expect("runCreate sent");
    // Exact flat keys, host context explicit.
    assert_eq!(create["params"]["objective"], json!("Ship it"));
    assert_eq!(create["params"]["coordinatorId"], json!("coord-1"));
    assert_eq!(create["params"]["contractVersion"], json!(1));
    assert_eq!(create["params"]["hostId"], json!(HOST));
    // Coordinator actor: the admin credential rides the envelope.
    assert_eq!(create["auth"], json!(TOKEN));
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn run_use_maps_scope_and_generation_fence() {
    let dir = temp_dir("run-use");
    let result = json!({"run": {
        "runId": "run-1", "objective": "Ship it",
        "coordinatorId": "coord-1", "consumerGeneration": 4,
        "createdAtMs": 1_700_000_000_000i64
    }});
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.runUse", result)]),
    );
    let mut args = vec!["orchestration", "run-use", "--json"];
    args.extend(coordinator_args());
    args.extend(["--takeover"]);
    let invocation = run_cli(&dir, &args, &[]);
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    let use_request = mock
        .captured()
        .into_iter()
        .find(|r| r["method"] == "orchestration.runUse")
        .expect("runUse sent");
    assert_eq!(use_request["params"]["runId"], json!("run-1"));
    assert_eq!(use_request["params"]["coordinatorId"], json!("coord-1"));
    assert_eq!(use_request["params"]["consumerGeneration"], json!(3));
    assert_eq!(use_request["params"]["takeover"], json!(true));
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn run_use_without_target_or_caller_does_not_guess_a_binding() {
    let dir = temp_dir("run-use-default");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let invocation = run_cli(&dir, &["orchestration", "run-use", "--json"], &[]);
    assert_eq!(
        invocation.exit_code, 2,
        "stdout must be empty: {}",
        invocation.stdout
    );
    assert!(
        invocation.stdout.is_empty(),
        "parse errors keep stdout empty"
    );
    // No method call without a complete binding.
    let captured = mock.captured();
    assert!(
        !captured
            .iter()
            .any(|r| r["method"] == "orchestration.runUse"),
        "no runUse without explicit binding"
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn task_create_maps_nested_spec_keys() {
    let dir = temp_dir("task-create");
    let result = json!({"task": {
        "taskId": "task-1", "runId": "run-1",
        "status": "pending", "dependsOn": ["task-0"]
    }});
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.taskCreate", result)]),
    );
    let mut args = vec![
        "orchestration",
        "task-create",
        "--json",
        "--instructions",
        "Do the work",
        "--title",
        "Work",
        "--depends-on",
        "task-0",
    ];
    args.extend(coordinator_args());
    let invocation = run_cli(&dir, &args, &[]);
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    let create = mock
        .captured()
        .into_iter()
        .find(|r| r["method"] == "orchestration.taskCreate")
        .expect("taskCreate sent");
    assert_eq!(
        create["params"]["spec"]["instructions"],
        json!("Do the work")
    );
    assert_eq!(create["params"]["spec"]["title"], json!("Work"));
    assert_eq!(create["params"]["spec"]["dependsOn"], json!(["task-0"]));
    assert_eq!(create["params"]["runId"], json!("run-1"));
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_start_fresh_maps_launch_and_never_carries_command_or_credential() {
    let dir = temp_dir("worker-start");
    let result = json!({
        "runId": "run-1", "taskId": "task-1", "dispatchId": "dispatch-1",
        "consumerGeneration": 3, "workspaceId": "ws-1",
        "assignmentState": "ready", "readiness": "promptObserved",
        "processVerdict": "live",
        "effects": [], "residualResources": []
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.workerStart", result)]),
    );
    let mut args = vec![
        "orchestration",
        "worker-start",
        "--json",
        "--task",
        "task-1",
        "--workspace",
        "ws-1",
        "--harness",
        "pi",
        "--model",
        "qwen3-flash",
        "--permission-mode",
        "unattended",
    ];
    args.extend(coordinator_args());
    let invocation = run_cli(&dir, &args, &[]);
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    let start = mock
        .captured()
        .into_iter()
        .find(|r| r["method"] == "orchestration.workerStart")
        .expect("workerStart sent");
    assert_eq!(start["params"]["taskId"], json!("task-1"));
    assert_eq!(start["params"]["workspaceId"], json!("ws-1"));
    assert_eq!(start["params"]["mode"], json!("fresh"));
    assert_eq!(start["params"]["launch"]["harnessId"], json!("pi"));
    assert_eq!(start["params"]["launch"]["model"], json!("qwen3-flash"));
    assert_eq!(
        start["params"]["launch"]["permissionMode"],
        json!("unattended")
    );
    // Literal argv plan only: no arbitrary command, no credential anywhere.
    assert!(start["params"].get("command").is_none());
    assert!(start["params"].get("args").is_none());
    let encoded = serde_json::to_string(&start).unwrap();
    assert!(!encoded.contains(SCOPED_CREDENTIAL));
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_start_reuse_maps_exact_session_identity() {
    let dir = temp_dir("worker-reuse");
    let result = json!({
        "runId": "run-1", "taskId": "task-1", "dispatchId": "dispatch-2",
        "consumerGeneration": 3, "workspaceId": "ws-1",
        "assignmentState": "ready", "readiness": "workerObserved",
        "processVerdict": "live",
        "sessionIdentity": {
            "sessionId": "session-1",
            "incarnation": "f2b4c995-0e6c-4a0a-9e6f-1f2a3b4c5d6e"
        },
        "effects": [], "residualResources": []
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.workerStart", result)]),
    );
    let mut args = vec![
        "orchestration",
        "worker-start",
        "--json",
        "--task",
        "task-1",
        "--workspace",
        "ws-1",
        "--reuse-session",
        "session-1",
        "--reuse-incarnation",
        "f2b4c995-0e6c-4a0a-9e6f-1f2a3b4c5d6e",
    ];
    args.extend(coordinator_args());
    let invocation = run_cli(&dir, &args, &[]);
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    let start = mock
        .captured()
        .into_iter()
        .find(|r| r["method"] == "orchestration.workerStart")
        .expect("workerStart sent");
    assert_eq!(start["params"]["mode"], json!("reuse"));
    assert_eq!(
        start["params"]["sessionIdentity"]["sessionId"],
        json!("session-1")
    );
    assert!(
        start["params"].get("launch").is_none(),
        "reuse mode must not carry launch preferences"
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn send_final_report_requires_outcome_and_maps_lifecycle_exit() {
    let dir = temp_dir("send-final");
    let settled = json!({
        "message": {"messageId": "msg-1", "sequence": 7, "runId": "run-1"},
        "lifecycle": {"action": "settled", "outcome": "succeeded", "duplicate": false},
        "warnings": []
    });
    let rejected = json!({
        "message": {"messageId": "msg-2", "sequence": 8, "runId": "run-1"},
        "lifecycle": {"action": "rejected", "code": "sender_not_assignee", "reason": "not the assignee"},
        "warnings": []
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(
            true,
            vec![
                ("orchestration.send", settled),
                ("orchestration.send", rejected),
            ],
        ),
    );
    let (run_id, task_id, dispatch_id, capability) = (
        os("run-1"),
        os("task-1"),
        os("dispatch-1"),
        os(SCOPED_CREDENTIAL),
    );
    let worker_env = [
        ("DROGON_DISPATCH_CAPABILITY", &capability),
        ("DROGON_RUN_ID", &run_id),
        ("DROGON_TASK_ID", &task_id),
        ("DROGON_DISPATCH_ID", &dispatch_id),
    ];
    let base: Vec<&str> = vec![
        "orchestration",
        "send",
        "--json",
        "--kind",
        "final-report",
        "--subject",
        "done",
        "--outcome",
        "succeeded",
    ];
    let first = run_cli(&dir, &base, &worker_env);
    assert_eq!(first.exit_code, 0, "stderr: {}", first.stderr);
    let sent = mock
        .captured()
        .into_iter()
        .find(|r| r["method"] == "orchestration.send")
        .expect("send sent");
    assert_eq!(sent["params"]["kind"], json!("finalReport"));
    assert_eq!(sent["params"]["finalReport"]["outcome"], json!("succeeded"));
    assert_eq!(sent["params"]["scope"]["actorKind"], json!("dispatch"));
    assert_eq!(sent["params"]["scope"]["dispatchId"], json!("dispatch-1"));
    assert_eq!(sent["auth"], json!(SCOPED_CREDENTIAL));

    // A negative lifecycle verdict must not exit 0.
    let second = run_cli(&dir, &base, &worker_env);
    assert_eq!(second.exit_code, 1, "rejected lifecycle must fail");
    assert!(second.stdout.contains("sender_not_assignee"));
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn final_report_without_outcome_is_usage_error() {
    let dir = temp_dir("send-no-outcome");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let (run_id, task_id, dispatch_id, capability) = (
        os("run-1"),
        os("task-1"),
        os("dispatch-1"),
        os(SCOPED_CREDENTIAL),
    );
    let worker_env = [
        ("DROGON_DISPATCH_CAPABILITY", &capability),
        ("DROGON_RUN_ID", &run_id),
        ("DROGON_TASK_ID", &task_id),
        ("DROGON_DISPATCH_ID", &dispatch_id),
    ];
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "send",
            "--json",
            "--kind",
            "final-report",
            "--subject",
            "done",
        ],
        &worker_env,
    );
    assert_eq!(invocation.exit_code, 2);
    assert!(invocation.stdout.is_empty());
    let captured = mock.captured();
    assert!(
        !captured.iter().any(|r| r["method"] == "orchestration.send"),
        "no method call for an incomplete final report"
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn check_maps_flat_mode_keys_and_ack_then_wait() {
    let dir = temp_dir("check");
    let result = json!({
        "delivery": {"deliveryId": "delivery-1", "messageIds": ["m1", "m2"]},
        "acknowledged": {"deliveryId": "delivery-0", "alreadyAcknowledged": false,
                         "messageIds": ["m9"]},
        "messages": [
            {"messageId": "m1", "sequence": 1, "kind": "guidance",
             "fromActor": "coord-1", "subject": "step one"},
            {"messageId": "m2", "sequence": 2, "kind": "escalation",
             "fromActor": "coord-1", "subject": "uh oh"}
        ],
        "timedOut": false, "cancelled": false, "connectionLost": false
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.check", result)]),
    );
    let (run_id, task_id, dispatch_id, capability) = (
        os("run-1"),
        os("task-1"),
        os("dispatch-1"),
        os(SCOPED_CREDENTIAL),
    );
    let worker_env = [
        ("DROGON_DISPATCH_CAPABILITY", &capability),
        ("DROGON_RUN_ID", &run_id),
        ("DROGON_TASK_ID", &task_id),
        ("DROGON_DISPATCH_ID", &dispatch_id),
    ];
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "check",
            "--json",
            "--ack",
            "delivery-0",
            "--wait",
            "--timeout-ms",
            "1000",
        ],
        &worker_env,
    );
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    let check = mock
        .captured()
        .into_iter()
        .find(|r| r["method"] == "orchestration.check")
        .expect("check sent");
    assert_eq!(check["params"]["mode"], json!("unread"));
    assert_eq!(check["params"]["acknowledge"], json!("delivery-0"));
    assert_eq!(check["params"]["wait"]["timeoutMs"], json!(1000));
    // Consuming output preserves the full FIFO: no local filtering.
    assert!(invocation.stdout.contains("m1"));
    assert!(invocation.stdout.contains("m2"));
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn check_mode_contradictions_are_usage_errors() {
    let dir = temp_dir("check-conflict");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let (run_id, task_id, dispatch_id, capability) = (
        os("run-1"),
        os("task-1"),
        os("dispatch-1"),
        os(SCOPED_CREDENTIAL),
    );
    let worker_env = [
        ("DROGON_DISPATCH_CAPABILITY", &capability),
        ("DROGON_RUN_ID", &run_id),
        ("DROGON_TASK_ID", &task_id),
        ("DROGON_DISPATCH_ID", &dispatch_id),
    ];
    for conflicting in [
        vec!["--peek", "--ack", "d1"],
        vec!["--all", "--ack", "d1"],
        vec!["--peek", "--all"],
        vec!["--peek", "--wait", "--timeout-ms", "100"],
    ] {
        let mut args = vec!["orchestration", "check", "--json"];
        args.extend(conflicting.iter().copied());
        let invocation = run_cli(&dir, &args, &worker_env);
        assert_eq!(invocation.exit_code, 2, "args {conflicting:?}");
        assert!(invocation.stdout.is_empty());
    }
    let captured = mock.captured();
    assert!(
        !captured
            .iter()
            .any(|r| r["method"] == "orchestration.check"),
        "contradictory checks never reach the wire"
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ask_modes_are_exclusive_with_default_and_explicit_timeout() {
    let dir = temp_dir("ask-conflict");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let (run_id, task_id, dispatch_id, capability) = (
        os("run-1"),
        os("task-1"),
        os("dispatch-1"),
        os(SCOPED_CREDENTIAL),
    );
    let worker_env = [
        ("DROGON_DISPATCH_CAPABILITY", &capability),
        ("DROGON_RUN_ID", &run_id),
        ("DROGON_TASK_ID", &task_id),
        ("DROGON_DISPATCH_ID", &dispatch_id),
    ];
    for conflicting in [
        vec!["--resume", "msg-1", "--question", "q"],
        vec!["--resume", "msg-1", "--option", "a"],
        vec!["--resume", "msg-1", "--options", "a,b"],
        vec!["--resume", "msg-1", "--options="],
        vec!["--resume", "msg-1", "--to", "run-home"],
        vec![],
    ] {
        for timeout in [vec![], vec!["--timeout-ms", "1000"]] {
            let mut args = vec!["orchestration", "ask", "--json"];
            args.extend(conflicting.iter().copied());
            args.extend(timeout);
            let invocation = run_cli(&dir, &args, &worker_env);
            assert_eq!(invocation.exit_code, 2, "args {args:?}");
            assert!(invocation.stdout.is_empty());
        }
    }
    let captured = mock.captured();
    assert!(
        !captured.iter().any(|r| r["method"] == "orchestration.ask"),
        "contradictory asks never reach the wire"
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ask_source_csv_trims_and_omits_empty_choices_without_splitting_literal_options() {
    let dir = temp_dir("ask-options");
    let pending = json!({
        "questionMessageId": "question-1", "threadId": "thread-1",
        "wait": {"outcome": "pending"},
        "effectiveTimeoutMs": 1000, "connectionLost": false
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(
            true,
            vec![
                ("orchestration.ask", pending.clone()),
                ("orchestration.ask", pending),
            ],
        ),
    );
    let env = worker_mail_env_ref();
    for (flag, choices) in [
        ("--options", "yes, no,, más tarde ,"),
        ("--option", "yes, no"),
    ] {
        let invocation = run_cli(
            &dir,
            &[
                "orchestration",
                "ask",
                "--json",
                "--question",
                "continue?",
                "--timeout-ms",
                "1000",
                flag,
                choices,
            ],
            &env,
        );
        assert_eq!(invocation.exit_code, 1, "{}", invocation.stderr);
        assert!(invocation.stdout.contains("question-1"));
    }
    let calls = mock.captured();
    let asks: Vec<_> = calls
        .iter()
        .filter(|r| r["method"] == "orchestration.ask")
        .collect();
    assert_eq!(asks.len(), 2);
    assert_eq!(
        asks[0]["params"]["options"],
        json!(["yes", "no", "más tarde"])
    );
    assert_eq!(asks[1]["params"]["options"], json!(["yes, no"]));
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ask_default_timeout_reaches_runtime_for_new_and_resumed_questions() {
    let dir = temp_dir("ask-default");
    let pending = json!({
        "questionMessageId": "question-1", "threadId": "thread-1",
        "wait": {"outcome": "pending"},
        "effectiveTimeoutMs": 600_000, "connectionLost": false
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(
            true,
            vec![
                ("orchestration.ask", pending.clone()),
                ("orchestration.ask", pending),
            ],
        ),
    );
    let env = worker_mail_env_ref();
    for intent in [["--question", "continue?"], ["--resume", "question-1"]] {
        let invocation = run_cli(
            &dir,
            &["orchestration", "ask", "--json", intent[0], intent[1]],
            &env,
        );
        assert_eq!(invocation.exit_code, 1, "{}", invocation.stderr);
        assert!(invocation.stdout.contains("question-1"));
    }
    let calls = mock.captured();
    let asks: Vec<_> = calls
        .iter()
        .filter(|r| r["method"] == "orchestration.ask")
        .collect();
    assert_eq!(asks.len(), 2);
    assert_eq!(asks[0]["params"]["intent"], "new");
    assert_eq!(asks[1]["params"]["intent"], "resume");
    for ask in asks {
        assert_eq!(ask["params"]["wait"]["timeoutMs"], 600_000);
        assert_eq!(ask["auth"], SCOPED_CREDENTIAL);
    }
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ask_json_preserves_the_source_bare_answer_contract_and_wait_verdicts() {
    for (outcome, answer, lost, code) in [
        ("answered", Some("approved ✓"), false, 0),
        ("pending", None, false, 1),
        ("cancelled", None, true, 1),
    ] {
        let dir = temp_dir("ask-source-json");
        let mut result = json!({
            "questionMessageId": "question-1", "threadId": "thread-1",
            "wait": {"outcome": outcome}, "effectiveTimeoutMs": 1_800_000,
            "connectionLost": lost, "futureField": "preserved"
        });
        if let Some(answer) = answer {
            result["answer"] = json!({"body": answer, "answerMessageId": "answer-1"});
        }
        let mock = MockService::start(
            &dir,
            mock_behavior(true, vec![("orchestration.ask", result)]),
        );
        let invocation = run_cli(
            &dir,
            &[
                "orchestration",
                "ask",
                "--json",
                "--question",
                "continue?",
                "--timeout-ms",
                "9007199254740991",
                "--options",
                "yes,yes,no",
            ],
            &worker_mail_env_ref(),
        );
        assert_eq!(invocation.exit_code, code, "{}", invocation.stderr);
        let value: Value = serde_json::from_str(&invocation.stdout).unwrap();
        assert_eq!(value["answer"], json!(answer));
        assert_eq!(value["messageId"], "question-1");
        assert_eq!(value["threadId"], "thread-1");
        assert_eq!(value["timedOut"], outcome == "pending");
        assert_eq!(value["cancelled"], outcome == "cancelled");
        assert_eq!(value["connectionLost"], lost);
        assert_eq!(value["timeoutMs"], 1_800_000);
        assert_eq!(value["futureField"], "preserved");
        assert!(value.get("result").is_none());
        assert!(value.get("wait").is_none());
        if answer.is_some() {
            assert_eq!(value["answerMessageId"], "answer-1");
        }
        let calls = mock.captured();
        let ask = calls
            .iter()
            .find(|r| r["method"] == "orchestration.ask")
            .unwrap();
        assert_eq!(ask["params"]["wait"]["timeoutMs"], 1_800_000);
        assert_eq!(ask["params"]["options"], json!(["yes", "yes", "no"]));
        drop(mock);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ask_wait_transport_timeout_covers_wait_plus_margin() {
    let dir = temp_dir("ask-margin");
    let pending = json!({
        "questionMessageId": "question-1", "threadId": "thread-1",
        "wait": {"outcome": "pending"},
        "effectiveTimeoutMs": 1000, "connectionLost": false
    });
    // The mock answers only after 3.5s: longer than the caller's 1s wait, so
    // a transport timeout shorter than wait+margin would fail the call.
    let behavior: Behavior = Arc::new(move |request| {
        let request_id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(ok_envelope(
                &request_id,
                json!({
                    "hostId": HOST, "serviceInstanceId": "svc-1",
                    "protocol": 1,
                    "capabilities": ["orchestration.native.v1"],
                    "version": "0.1.0"
                }),
            )),
            Some("orchestration.ask") => {
                std::thread::sleep(Duration::from_millis(3500));
                Action::Respond(ok_envelope(&request_id, pending.clone()))
            }
            _ => Action::Respond(error_envelope(&request_id, "method_not_found", "x")),
        }
    });
    let mock = MockService::start(&dir, behavior);
    let (run_id, task_id, dispatch_id, capability) = (
        os("run-1"),
        os("task-1"),
        os("dispatch-1"),
        os(SCOPED_CREDENTIAL),
    );
    let worker_env = [
        ("DROGON_DISPATCH_CAPABILITY", &capability),
        ("DROGON_RUN_ID", &run_id),
        ("DROGON_TASK_ID", &task_id),
        ("DROGON_DISPATCH_ID", &dispatch_id),
    ];
    let started = Instant::now();
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "ask",
            "--json",
            "--question",
            "continue?",
            "--timeout-ms",
            "1000",
        ],
        &worker_env,
    );
    // A pending ask fails the invocation (source parity: timedOut exit 1),
    // but the response DID arrive after the budget elapsed — proving the
    // transport timeout covered wait + margin instead of cutting earlier.
    assert_eq!(invocation.exit_code, 1, "stdout: {}", invocation.stdout);
    assert!(invocation.stdout.contains("question-1"));
    assert!(started.elapsed() >= Duration::from_millis(3500));
    let ask = mock
        .captured()
        .into_iter()
        .find(|r| r["method"] == "orchestration.ask")
        .expect("ask sent");
    assert_eq!(ask["params"]["intent"], json!("new"));
    assert_eq!(ask["params"]["wait"]["timeoutMs"], json!(1000));
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn capability_absent_fails_before_method_with_zero_effect() {
    let dir = temp_dir("no-cap");
    let mock = MockService::start(&dir, mock_behavior(false, vec![]));
    let invocation = run_cli(&dir, &["orchestration", "run-list", "--json"], &[]);
    assert_eq!(invocation.exit_code, 1);
    assert!(invocation.stdout.contains("orchestration.native.v1"));
    let captured = mock.captured();
    let methods: Vec<&str> = captured
        .iter()
        .filter_map(|r| r["method"].as_str())
        .collect();
    assert_eq!(methods, vec!["status"], "preflight only, zero effect");
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn host_mismatch_is_refused_before_the_method_call() {
    let dir = temp_dir("host-mismatch");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "run-list",
            "--json",
            "--host",
            "host-elsewhere",
        ],
        &[],
    );
    assert_eq!(invocation.exit_code, 1);
    assert!(invocation.stdout.contains("unsupported_host"));
    let captured = mock.captured();
    let methods: Vec<&str> = captured
        .iter()
        .filter_map(|r| r["method"].as_str())
        .collect();
    assert_eq!(methods, vec!["status"]);
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn empty_worker_credential_fails_closed_before_any_connection() {
    let dir = temp_dir("empty-cred");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let empty = os("");
    let env = [("DROGON_DISPATCH_CAPABILITY", &empty)];
    let invocation = run_cli(&dir, &["orchestration", "run-list", "--json"], &env);
    // Why exit 2: a coordinator-only verb locally refuses any worker
    // credential (even a present-but-empty one) — no administrator fallback.
    assert_eq!(invocation.exit_code, 2);
    assert!(
        invocation
            .stderr
            .contains("refuses DROGON_DISPATCH_CAPABILITY"),
        "{}",
        invocation.stderr
    );
    assert!(
        mock.captured().is_empty(),
        "present-but-empty credential never connects"
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn env_hints_fill_dispatch_scope_and_mismatch_is_refused() {
    let dir = temp_dir("hints");
    let result = json!({
        "delivery": {"deliveryId": "delivery-1", "messageIds": ["m1"]},
        "messages": [
            {"messageId": "m1", "sequence": 1, "kind": "guidance",
             "fromActor": "coord-1", "subject": "only"}
        ],
        "timedOut": false, "cancelled": false, "connectionLost": false
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.check", result)]),
    );
    let (run_id, task_id, dispatch_id, host_hint) =
        (os("run-1"), os("task-1"), os("dispatch-1"), os(HOST));
    let capability = os(SCOPED_CREDENTIAL);
    let worker_env = [
        ("DROGON_DISPATCH_CAPABILITY", &capability),
        ("DROGON_RUN_ID", &run_id),
        ("DROGON_TASK_ID", &task_id),
        ("DROGON_DISPATCH_ID", &dispatch_id),
        ("DROGON_HOST_ID", &host_hint),
    ];
    let invocation = run_cli(&dir, &["orchestration", "check", "--json"], &worker_env);
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    let check = mock
        .captured()
        .into_iter()
        .find(|r| r["method"] == "orchestration.check")
        .expect("check sent");
    assert_eq!(check["params"]["scope"]["runId"], json!("run-1"));
    assert_eq!(check["params"]["scope"]["taskId"], json!("task-1"));
    assert_eq!(check["params"]["scope"]["dispatchId"], json!("dispatch-1"));

    // An explicit flag contradicting the environment hint is refused.
    let conflicting = run_cli(
        &dir,
        &["orchestration", "check", "--json", "--run", "run-other"],
        &worker_env,
    );
    assert_eq!(conflicting.exit_code, 2, "hint mismatch is a usage error");
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn request_show_maps_explicit_scope_and_keeps_receipt_id_separate() {
    let dir = temp_dir("request-show");
    let result = json!({
        "requestId": "receipt-77",
        "state": "committed",
        "method": "orchestration.send",
        "interpretation": "committed"
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.requestShow", result)]),
    );
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "request-show",
            "--json",
            "--request",
            "receipt-77",
            "--scope",
            "bootstrap",
            "--coordinator-id",
            "coord-1",
            "--request-id",
            "envelope-1",
        ],
        &[],
    );
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    let show = mock
        .captured()
        .into_iter()
        .find(|r| r["method"] == "orchestration.requestShow")
        .expect("requestShow sent");
    // The receipt id travels in params; the envelope keeps its own id.
    assert_eq!(show["params"]["requestId"], json!("receipt-77"));
    assert_eq!(show["requestId"], json!("envelope-1"));
    assert_eq!(show["params"]["scope"]["actorKind"], json!("bootstrap"));
    assert_eq!(show["params"]["scope"]["coordinatorId"], json!("coord-1"));
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn request_ids_flow_and_retry_alias_contradiction_is_refused() {
    let dir = temp_dir("request-id");
    let result = json!({"runs": [], "nextCursor": null});
    // Two canned answers: one for the explicit --request-id call and one for
    // the --retry-request alias call.
    let mock = MockService::start(
        &dir,
        mock_behavior(
            true,
            vec![
                ("orchestration.runList", result.clone()),
                ("orchestration.runList", result),
            ],
        ),
    );
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "run-list",
            "--json",
            "--request-id",
            "op-1",
        ],
        &[],
    );
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    let listed = mock
        .captured()
        .into_iter()
        .find(|r| r["method"] == "orchestration.runList")
        .expect("runList sent");
    assert_eq!(listed["requestId"], json!("op-1"));
    assert_eq!(listed["params"]["limit"], json!(100));

    // The alias alone works and lands on the wire.
    let alias = run_cli(
        &dir,
        &[
            "orchestration",
            "run-list",
            "--json",
            "--retry-request",
            "op-2",
        ],
        &[],
    );
    assert_eq!(alias.exit_code, 0, "stderr: {}", alias.stderr);
    let captured = mock.captured();
    assert!(
        captured
            .iter()
            .any(|r| r["method"] == "orchestration.runList" && r["requestId"] == "op-2"),
        "alias value reaches the wire"
    );

    // Contradictory spellings are refused.
    let conflict = run_cli(
        &dir,
        &[
            "orchestration",
            "run-list",
            "--json",
            "--request-id",
            "a",
            "--retry-request",
            "b",
        ],
        &[],
    );
    assert_eq!(conflict.exit_code, 2);
    assert!(conflict.stdout.is_empty());
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_stop_displays_unverifiable_honestly() {
    let dir = temp_dir("worker-stop");
    let result = json!({
        "dispatchId": "dispatch-1",
        "assignmentState": "stopped",
        "processAction": "unverifiable",
        "processVerdict": "unverifiable",
        "residualResources": [
            {"kind": "session", "resourceId": "session-1",
             "incarnation": "f2b4c995-0e6c-4a0a-9e6f-1f2a3b4c5d6e",
             "action": "retained", "disposition": "unverifiable"}
        ],
        "warning": null
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.workerStop", result)]),
    );
    let mut args = vec![
        "orchestration",
        "worker-stop",
        "--json",
        "--dispatch",
        "dispatch-1",
    ];
    args.extend(coordinator_args());
    let invocation = run_cli(&dir, &args, &[]);
    // Why exit 1: an unverifiable stop is an honestly uncertain operation,
    // never a claimed success; the display still reports the exact state.
    assert_eq!(invocation.exit_code, 1, "stdout: {}", invocation.stdout);
    assert!(invocation.stdout.contains("unverifiable"));
    assert!(!invocation.stdout.contains("exited"));
    let stop = mock
        .captured()
        .into_iter()
        .find(|r| r["method"] == "orchestration.workerStop")
        .expect("workerStop sent");
    assert_eq!(stop["params"]["dispatchId"], json!("dispatch-1"));
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn check_kinds_travel_as_filter_but_fifo_output_is_preserved() {
    let dir = temp_dir("check-kinds");
    let result = json!({
        "delivery": {"deliveryId": "delivery-1", "messageIds": ["m1", "m2"]},
        "messages": [
            {"messageId": "m1", "sequence": 1, "kind": "guidance",
             "fromActor": "coord-1", "subject": "first"},
            {"messageId": "m2", "sequence": 2, "kind": "status",
             "fromActor": "coord-1", "subject": "second"}
        ],
        "timedOut": false, "cancelled": false, "connectionLost": false
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.check", result)]),
    );
    let (run_id, task_id, dispatch_id, capability) = (
        os("run-1"),
        os("task-1"),
        os("dispatch-1"),
        os(SCOPED_CREDENTIAL),
    );
    let worker_env = [
        ("DROGON_DISPATCH_CAPABILITY", &capability),
        ("DROGON_RUN_ID", &run_id),
        ("DROGON_TASK_ID", &task_id),
        ("DROGON_DISPATCH_ID", &dispatch_id),
    ];
    let invocation = run_cli(
        &dir,
        &["orchestration", "check", "--json", "--kinds", "guidance"],
        &worker_env,
    );
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    let check = mock
        .captured()
        .into_iter()
        .find(|r| r["method"] == "orchestration.check")
        .expect("check sent");
    assert_eq!(check["params"]["kinds"], json!(["guidance"]));
    // The whole FIFO batch comes back regardless of the wake filter.
    assert!(invocation.stdout.contains("first"));
    assert!(invocation.stdout.contains("second"));
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn source_worker_done_alias_maps_send_and_check_without_changing_authority() {
    let dir = temp_dir("source-worker-done");
    let mock = MockService::start(
        &dir,
        mock_behavior(
            true,
            vec![
                (
                    "orchestration.send",
                    json!({
                        "message": {"messageId": "msg-1", "sequence": 1, "runId": "run-1"},
                        "lifecycle": {"action": "settled", "outcome": "succeeded", "duplicate": false},
                        "warnings": []
                    }),
                ),
                (
                    "orchestration.check",
                    json!({
                        "messages": [], "timedOut": false, "cancelled": false, "connectionLost": false
                    }),
                ),
            ],
        ),
    );
    let env = worker_mail_env_ref();
    let sent = run_cli(
        &dir,
        &[
            "orchestration",
            "send",
            "--json",
            "--type",
            "worker_done",
            "--subject",
            "done",
            "--outcome",
            "succeeded",
            "--task-id",
            "task-1",
            "--dispatch-id",
            "dispatch-1",
        ],
        &env,
    );
    assert_eq!(sent.exit_code, 0, "{}", sent.stderr);
    let checked = run_cli(
        &dir,
        &[
            "orchestration",
            "check",
            "--json",
            "--types",
            "worker_done,escalation",
        ],
        &env,
    );
    assert_eq!(checked.exit_code, 0, "{}", checked.stderr);
    let calls = mock.captured();
    let send = calls
        .iter()
        .find(|r| r["method"] == "orchestration.send")
        .unwrap();
    assert_eq!(send["params"]["kind"], "finalReport");
    assert_eq!(send["params"]["finalReport"]["outcome"], "succeeded");
    assert_eq!(send["params"]["scope"]["dispatchId"], "dispatch-1");
    assert_eq!(send["auth"], SCOPED_CREDENTIAL);
    let check = calls
        .iter()
        .find(|r| r["method"] == "orchestration.check")
        .unwrap();
    assert_eq!(
        check["params"]["kinds"],
        json!(["finalReport", "escalation"])
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn additive_result_fields_survive_to_stdout() {
    let dir = temp_dir("additive");
    let mut result = json!({"runs": [], "nextCursor": null});
    result["futureField"] = json!({"optional": true});
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.runList", result)]),
    );
    let invocation = run_cli(&dir, &["orchestration", "run-list", "--json"], &[]);
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    assert!(
        invocation.stdout.contains("futureField"),
        "additive fields survive"
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// RED batch: each test below records a real compiled-subprocess failure for
// one remaining correction before the fix is applied.
// ---------------------------------------------------------------------------

/// 'static view of the worker mail environment for inline use.
fn worker_mail_env_ref() -> Vec<(&'static str, &'static OsString)> {
    use std::sync::LazyLock;
    static CAP: LazyLock<OsString> =
        LazyLock::new(|| OsString::from("synthetic-native-cli-worker-0001"));
    static RUN: LazyLock<OsString> = LazyLock::new(|| OsString::from("run-1"));
    static TASK: LazyLock<OsString> = LazyLock::new(|| OsString::from("task-1"));
    static DISPATCH: LazyLock<OsString> = LazyLock::new(|| OsString::from("dispatch-1"));
    vec![
        ("DROGON_DISPATCH_CAPABILITY", &CAP),
        ("DROGON_RUN_ID", &RUN),
        ("DROGON_TASK_ID", &TASK),
        ("DROGON_DISPATCH_ID", &DISPATCH),
    ]
}

fn worker_mail_env() -> Vec<(&'static str, OsString)> {
    vec![
        (
            "DROGON_DISPATCH_CAPABILITY",
            OsString::from("synthetic-native-cli-worker-0001"),
        ),
        ("DROGON_RUN_ID", OsString::from("run-1")),
        ("DROGON_TASK_ID", OsString::from("task-1")),
        ("DROGON_DISPATCH_ID", OsString::from("dispatch-1")),
    ]
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_worker_credential_with_coordinator_flags_fails_closed() {
    let dir = temp_dir("ra-coord");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let env = worker_mail_env();
    let env_ref: Vec<(&str, &OsString)> = env.iter().map(|(k, v)| (*k, v)).collect();
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "send",
            "--json",
            "--kind",
            "status",
            "--subject",
            "x",
            "--coordinator-id",
            "coord-1",
            "--consumer-generation",
            "3",
        ],
        &env_ref,
    );
    assert_eq!(invocation.exit_code, 2, "stderr: {}", invocation.stderr);
    let captured = mock.captured();
    assert!(
        !captured.iter().any(|r| r["method"] == "orchestration.send"),
        "contradictory actor flags must not reach the wire"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_coordinator_actor_with_dispatch_flags_fails_closed() {
    let dir = temp_dir("ra-disp");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let mut args = vec![
        "orchestration",
        "check",
        "--json",
        "--run",
        "run-1",
        "--coordinator-id",
        "coord-1",
        "--consumer-generation",
        "3",
        "--task",
        "task-1",
        "--dispatch",
        "dispatch-1",
    ];
    let _ = &mut args;
    let invocation = run_cli(&dir, &args, &[]);
    assert_eq!(invocation.exit_code, 2, "stderr: {}", invocation.stderr);
    let captured = mock.captured();
    assert!(
        !captured
            .iter()
            .any(|r| r["method"] == "orchestration.check"),
        "contradictory dispatch flags must not reach the wire"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_coordinator_verbs_refuse_worker_credentials() {
    let dir = temp_dir("ra-verb");
    for verb in [
        vec!["run-list", "--json"],
        vec!["run-show", "--json", "--run", "run-1"],
        vec![
            "run-use",
            "--json",
            "--run",
            "run-1",
            "--coordinator-id",
            "c",
            "--consumer-generation",
            "1",
        ],
        vec![
            "task-list",
            "--json",
            "--run",
            "run-1",
            "--coordinator-id",
            "c",
            "--consumer-generation",
            "1",
        ],
        vec![
            "worker-show",
            "--json",
            "--run",
            "run-1",
            "--coordinator-id",
            "c",
            "--consumer-generation",
            "1",
            "--dispatch",
            "d",
        ],
    ] {
        let mock = MockService::start(&dir, mock_behavior(true, vec![]));
        let mut args = vec!["orchestration"];
        args.extend(verb.iter().copied());
        let env = worker_mail_env();
        let env_ref: Vec<(&str, &OsString)> = env[..1].iter().map(|(k, v)| (*k, v)).collect();
        let invocation = run_cli(&dir, &args, &env_ref);
        assert_eq!(
            invocation.exit_code, 2,
            "verb {verb:?}: {}",
            invocation.stderr
        );
        assert!(
            mock.captured().is_empty(),
            "coordinator verb {verb:?} must refuse worker credentials before any connection"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_worker_request_show_only_dispatch_scope() {
    let dir = temp_dir("ra-rshow");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let env = worker_mail_env();
    let env_ref: Vec<(&str, &OsString)> = env[..1].iter().map(|(k, v)| (*k, v)).collect();
    for scope in ["bootstrap", "coordinator"] {
        let invocation = run_cli(
            &dir,
            &[
                "orchestration",
                "request-show",
                "--json",
                "--request",
                "receipt-1",
                "--scope",
                scope,
                "--coordinator-id",
                "coord-1",
            ],
            &env_ref,
        );
        assert_eq!(
            invocation.exit_code, 2,
            "scope {scope}: {}",
            invocation.stderr
        );
        assert!(
            mock.captured().is_empty(),
            "no connection for a refused scope"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_empty_env_hint_fails_closed() {
    let dir = temp_dir("ra-empty");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let env = [
        (
            OsString::from("DROGON_DISPATCH_CAPABILITY"),
            OsString::from("cap"),
        ),
        (OsString::from("DROGON_RUN_ID"), OsString::from("")),
    ];
    let env_ref: Vec<(&str, &OsString)> =
        env.iter().map(|(k, v)| (k.to_str().unwrap(), v)).collect();
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "send",
            "--json",
            "--kind",
            "status",
            "--subject",
            "x",
            "--run",
            "run-1",
            "--task",
            "task-1",
            "--dispatch",
            "dispatch-1",
        ],
        &env_ref,
    );
    assert_eq!(
        invocation.exit_code, 2,
        "a present-but-empty hint must fail closed instead of silently          disappearing behind the explicit flags: {}",
        invocation.stderr
    );
    assert!(mock.captured().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_invalid_utf8_env_hint_fails_closed() {
    use std::os::unix::ffi::OsStringExt;
    let dir = temp_dir("ra-utf8");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let env = [
        (
            OsString::from("DROGON_DISPATCH_CAPABILITY"),
            OsString::from("cap"),
        ),
        (
            OsString::from("DROGON_RUN_ID"),
            OsString::from_vec(vec![0xff, 0xfe]),
        ),
    ];
    let env_ref: Vec<(&str, &OsString)> =
        env.iter().map(|(k, v)| (k.to_str().unwrap(), v)).collect();
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "send",
            "--json",
            "--kind",
            "status",
            "--subject",
            "x",
        ],
        &env_ref,
    );
    assert_eq!(
        invocation.exit_code, 2,
        "invalid UTF-8 hint must fail closed"
    );
    assert!(mock.captured().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_reuse_rejects_fresh_preferences() {
    let dir = temp_dir("ra-reuse");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    for extra in [
        vec!["--model", "m1"],
        vec!["--provider", "p1"],
        vec!["--effort", "high"],
        vec!["--permission-mode", "unattended"],
        vec!["--harness", "pi"],
    ] {
        let mut args = vec![
            "orchestration",
            "worker-start",
            "--json",
            "--task",
            "task-1",
            "--workspace",
            "ws-1",
            "--reuse-session",
            "session-1",
            "--reuse-incarnation",
            "inc-1",
        ];
        args.extend(extra.iter().copied());
        args.extend(coordinator_args());
        let invocation = run_cli(&dir, &args, &[]);
        assert_eq!(
            invocation.exit_code, 2,
            "extra {extra:?}: {}",
            invocation.stderr
        );
    }
    assert!(
        mock.captured().is_empty(),
        "refused contradictions never connect"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_effort_requires_model_and_maps_to_launch() {
    let dir = temp_dir("ra-effort");
    let result = json!({
        "runId": "run-1", "taskId": "task-1", "dispatchId": "dispatch-1",
        "consumerGeneration": 3, "workspaceId": "ws-1",
        "assignmentState": "ready", "readiness": "promptObserved",
        "processVerdict": "live", "effects": [], "residualResources": []
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.workerStart", result)]),
    );
    // effort without model is a contradiction
    let mut args = vec![
        "orchestration",
        "worker-start",
        "--json",
        "--task",
        "task-1",
        "--workspace",
        "ws-1",
        "--harness",
        "pi",
        "--effort",
        "high",
    ];
    args.extend(coordinator_args());
    let invocation = run_cli(&dir, &args, &[]);
    assert_eq!(
        invocation.exit_code, 2,
        "effort requires model: {}",
        invocation.stderr
    );
    assert!(mock.captured().is_empty());

    // effort with model maps into launch.effort
    let mut args = vec![
        "orchestration",
        "worker-start",
        "--json",
        "--task",
        "task-1",
        "--workspace",
        "ws-1",
        "--harness",
        "pi",
        "--model",
        "m1",
        "--effort",
        "high",
    ];
    args.extend(coordinator_args());
    let invocation = run_cli(&dir, &args, &[]);
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    let start = mock
        .captured()
        .into_iter()
        .find(|r| r["method"] == "orchestration.workerStart")
        .expect("start sent");
    assert_eq!(start["params"]["launch"]["effort"], json!("high"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_param_invalid_argument_exits_usage_2() {
    let dir = temp_dir("ra-param");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let invocation = run_cli(
        &dir,
        &["orchestration", "run-list", "--json", "--limit", "0"],
        &[],
    );
    assert_eq!(
        invocation.exit_code, 2,
        "client-constructible invalid params are usage errors: {} {}",
        invocation.stdout, invocation.stderr
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_run_and_task_response_identity_is_enforced() {
    let dir = temp_dir("ra-run");
    // run-show: response names a different run than requested -> refusal.
    let wrong_run = json!({"run": {
        "runId": "run-other", "objective": "o", "coordinatorId": "c",
        "consumerGeneration": 1, "createdAtMs": 1
    }});
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.runShow", wrong_run)]),
    );
    let invocation = run_cli(
        &dir,
        &["orchestration", "run-show", "--json", "--run", "run-1"],
        &[],
    );
    assert_eq!(invocation.exit_code, 1, "wrong run identity must fail");
    assert!(invocation.stdout.contains("internal_error"));
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);

    // run-create: coordinator/objective/generation must echo the request.
    let dir = temp_dir("ra-create");
    let wrong_create = json!({"run": {
        "runId": "run-1", "objective": "different objective",
        "coordinatorId": "coord-1", "consumerGeneration": 2, "createdAtMs": 1
    }});
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.runCreate", wrong_create)]),
    );
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "run-create",
            "--json",
            "--objective",
            "my objective",
            "--coordinator-id",
            "coord-1",
        ],
        &[],
    );
    assert_eq!(
        invocation.exit_code, 1,
        "create identity mismatch must fail"
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);

    // task-show: run and task must echo the request.
    let dir = temp_dir("ra-task");
    let wrong_task = json!({
        "task": {"taskId": "task-other", "runId": "run-other",
                 "status": "pending", "dependsOn": []},
        "spec": {"instructions": "i", "dependsOn": []},
        "attempts": []
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.taskShow", wrong_task)]),
    );
    let mut args = vec!["orchestration", "task-show", "--json", "--task", "task-1"];
    args.extend(coordinator_args());
    let invocation = run_cli(&dir, &args, &[]);
    assert_eq!(invocation.exit_code, 1, "task identity mismatch must fail");
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_worker_show_and_stop_dispatch_identity_is_enforced() {
    let dir = temp_dir("ra-wident");
    for (method, verb, result) in [
        (
            "orchestration.workerShow",
            "worker-show",
            json!({"dispatchId": "other", "taskId": "task-1",
            "assignmentState": "ready", "readiness": "notObserved",
            "processVerdict": "live", "residualResources": []}),
        ),
        (
            "orchestration.workerStop",
            "worker-stop",
            json!({"dispatchId": "other",
            "assignmentState": "stopped", "processAction": "signalled",
            "processVerdict": "exited", "residualResources": []}),
        ),
        (
            "orchestration.workerAbandon",
            "worker-abandon",
            json!({"dispatchId": "other",
            "assignmentState": "abandoned", "residualResources": []}),
        ),
    ] {
        let _mock = MockService::start(&dir, mock_behavior(true, vec![(method, result)]));
        let mut args = vec!["orchestration", verb, "--json", "--dispatch", "dispatch-1"];
        args.extend(coordinator_args());
        let invocation = run_cli(&dir, &args, &[]);
        assert_eq!(invocation.exit_code, 1, "{method} wrong dispatch must fail");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_ask_resume_and_reply_and_receipt_identity_is_enforced() {
    let dir = temp_dir("ra-mail");
    // ask resume: response must name the resumed question.
    let wrong_resume = json!({
        "questionMessageId": "question-other", "threadId": "thread-1",
        "wait": {"outcome": "answered"},
        "answer": {"body": "yes"}, "connectionLost": false
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.ask", wrong_resume)]),
    );
    let env_ref = worker_mail_env_ref();
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "ask",
            "--json",
            "--resume",
            "question-9",
            "--timeout-ms",
            "100",
        ],
        &env_ref,
    );
    assert_eq!(
        invocation.exit_code, 1,
        "resume identity mismatch must fail"
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);

    // reply: response must name the answered question.
    let dir = temp_dir("ra-reply");
    let wrong_reply = json!({
        "message": {"messageId": "answer-1"},
        "questionMessageId": "question-other"
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.reply", wrong_reply)]),
    );
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "reply",
            "--json",
            "--question",
            "question-1",
            "--body",
            "the answer",
        ],
        &worker_mail_env_ref(),
    );
    assert_eq!(invocation.exit_code, 1, "reply identity mismatch must fail");
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);

    // request-show: response must name the requested receipt.
    let dir = temp_dir("ra-rcpt");
    let wrong_receipt = json!({
        "requestId": "receipt-other", "state": "committed",
        "interpretation": "committed"
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.requestShow", wrong_receipt)]),
    );
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "request-show",
            "--json",
            "--request",
            "receipt-1",
            "--scope",
            "bootstrap",
            "--coordinator-id",
            "coord-1",
        ],
        &[],
    );
    assert_eq!(
        invocation.exit_code, 1,
        "receipt identity mismatch must fail"
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_check_ack_must_match_requested_delivery() {
    let dir = temp_dir("ra-ack");
    let result = json!({
        "delivery": {"deliveryId": "delivery-1", "messageIds": ["m1"]},
        "acknowledged": {"deliveryId": "delivery-9", "alreadyAcknowledged": false,
                         "messageIds": ["m0"]},
        "messages": [
            {"messageId": "m1", "sequence": 1, "kind": "guidance",
             "fromActor": "coord-1", "subject": "s"}
        ],
        "timedOut": false, "cancelled": false, "connectionLost": false
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.check", result)]),
    );
    let invocation = run_cli(
        &dir,
        &["orchestration", "check", "--json", "--ack", "delivery-0"],
        &worker_mail_env_ref(),
    );
    assert_eq!(
        invocation.exit_code, 1,
        "acknowledged receipt must match the explicitly requested delivery"
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_inspection_cannot_claim_delivery_ownership() {
    let dir = temp_dir("ra-peek");
    for mode in ["peek", "all"] {
        let result = json!({
            "delivery": {"deliveryId": "delivery-1", "messageIds": ["m1"]},
            "messages": [
                {"messageId": "m1", "sequence": 1, "kind": "guidance",
                 "fromActor": "coord-1", "subject": "s"}
            ],
            "timedOut": false, "cancelled": false, "connectionLost": false
        });
        let _mock = MockService::start(
            &dir,
            mock_behavior(true, vec![("orchestration.check", result)]),
        );
        let invocation = run_cli(
            &dir,
            &["orchestration", "check", "--json", &format!("--{mode}")],
            &worker_mail_env_ref(),
        );
        assert_eq!(
            invocation.exit_code, 1,
            "{mode} result carrying a delivery claims consumption"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_task_show_human_output_includes_full_spec() {
    let dir = temp_dir("ra-thuman");
    let result = json!({
        "task": {"taskId": "task-1", "runId": "run-1",
                 "status": "ready", "dependsOn": ["task-0"]},
        "spec": {"instructions": "the full original instructions sentinel",
                 "dependsOn": ["task-0"]},
        "attempts": []
    });
    let _mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.taskShow", result)]),
    );
    let mut args = vec!["orchestration", "task-show", "--task", "task-1"];
    args.extend(coordinator_args());
    let invocation = run_cli(&dir, &args, &[]);
    assert_eq!(invocation.exit_code, 0, "{}", invocation.stderr);
    assert!(
        invocation
            .stdout
            .contains("the full original instructions sentinel"),
        "human task-show must include the actual full spec: {}",
        invocation.stdout
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_check_human_output_reports_cursor_and_interruption() {
    let dir = temp_dir("ra-chuman");
    let result = json!({
        "messages": [
            {"messageId": "m1", "sequence": 1, "kind": "guidance",
             "fromActor": "coord-1", "subject": "s"}
        ],
        "nextCursor": "inspect-more",
        "timedOut": false, "cancelled": false, "connectionLost": false
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.check", result)]),
    );
    let invocation = run_cli(
        &dir,
        &["orchestration", "check", "--peek"],
        &worker_mail_env_ref(),
    );
    assert_eq!(invocation.exit_code, 0, "{}", invocation.stderr);
    assert!(
        invocation.stdout.contains("inspect-more"),
        "{}",
        invocation.stdout
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);

    let dir = temp_dir("ra-ccancel");
    let result = json!({
        "messages": [],
        "timedOut": false, "cancelled": true, "connectionLost": false
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.check", result)]),
    );
    let invocation = run_cli(
        &dir,
        &["orchestration", "check", "--wait", "--timeout-ms", "100"],
        &worker_mail_env_ref(),
    );
    assert_eq!(invocation.exit_code, 1, "{}", invocation.stderr);
    assert!(
        invocation.stderr.contains("interrupted") || invocation.stderr.contains("cancelled"),
        "cancelled wait must be reported honestly: {}",
        invocation.stderr
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_worker_release_unverifiable_exits_failure() {
    let dir = temp_dir("ra-relunv");
    let result = json!({
        "dispatchId": "dispatch-1",
        "disposition": "unverifiable",
        "state": "release_unknown",
        "processVerdict": "unverifiable",
        "processAction": "none",
        "archive": null,
        "residualResources": [
            {"kind": "session", "resourceId": "session-1",
             "incarnation": "f2b4c995-0e6c-4a0a-9e6f-1f2a3b4c5d6e",
             "action": "retained", "disposition": "unverifiable"}
        ]
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.workerRelease", result)]),
    );
    let mut args = vec![
        "orchestration",
        "worker-release",
        "--json",
        "--dispatch",
        "dispatch-1",
    ];
    args.extend(coordinator_args());
    let invocation = run_cli(&dir, &args, &[]);
    assert_eq!(
        invocation.exit_code, 1,
        "unverifiable release must not claim success"
    );
    assert!(invocation.stdout.contains("unverifiable"));
    let captured = mock.captured();
    let release = captured
        .iter()
        .find(|r| r["method"] == "orchestration.workerRelease")
        .expect("release sent");
    assert_eq!(release["params"]["dispatchId"], json!("dispatch-1"));
}

// ---------------------------------------------------------------------------
// RED batch 2: inspection pagination and explicit-inherit permission mode.
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_check_cursor_limit_rejected_on_consuming_reads() {
    let dir = temp_dir("rb-ccursor");
    for conflicting in [
        vec!["--cursor", "page-2"],
        vec!["--limit", "25"],
        vec!["--ack", "delivery-1", "--cursor", "page-2"],
        vec!["--wait", "--timeout-ms", "100", "--limit", "25"],
    ] {
        let mock = MockService::start(&dir, mock_behavior(true, vec![]));
        let mut args = vec!["orchestration", "check", "--json"];
        args.extend(conflicting.iter().copied());
        let invocation = run_cli(&dir, &args, &worker_mail_env_ref());
        assert_eq!(
            invocation.exit_code, 2,
            "args {conflicting:?}: {} {}",
            invocation.stdout, invocation.stderr
        );
        assert!(invocation.stdout.is_empty());
        assert!(
            mock.captured().is_empty(),
            "consuming reads must refuse pagination before any connection"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_check_cursor_limit_map_for_inspection_only() {
    let dir = temp_dir("rb-cinspect");
    let result = json!({
        "messages": [
            {"messageId": "m1", "sequence": 1, "kind": "guidance",
             "fromActor": "coord-1", "subject": "s"}
        ],
        "nextCursor": "inspect-more",
        "timedOut": false, "cancelled": false, "connectionLost": false
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.check", result)]),
    );
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "check",
            "--json",
            "--peek",
            "--cursor",
            "inspect-prev",
            "--limit",
            "25",
        ],
        &worker_mail_env_ref(),
    );
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    let check = mock
        .captured()
        .into_iter()
        .find(|r| r["method"] == "orchestration.check")
        .expect("check sent");
    assert_eq!(check["params"]["mode"], json!("peek"));
    assert_eq!(check["params"]["cursor"], json!("inspect-prev"));
    assert_eq!(check["params"]["limit"], json!(25));

    // Local bounds: limit 0 and malformed cursors are usage errors, and an
    // invalid continuation cursor in a response is a protocol failure.
    for bad in [
        vec!["--peek", "--limit", "0"],
        vec!["--peek", "--cursor", "bad cursor"],
    ] {
        let mock2 = MockService::start(&dir, mock_behavior(true, vec![]));
        let mut args = vec!["orchestration", "check", "--json"];
        args.extend(bad.iter().copied());
        let invocation = run_cli(&dir, &args, &worker_mail_env_ref());
        assert_eq!(invocation.exit_code, 2, "args {bad:?}");
        assert!(
            mock2.captured().is_empty(),
            "local bounds refuse pre-connection"
        );
    }
    let bad_continuation = json!({
        "messages": [],
        "nextCursor": "bad cursor",
        "timedOut": false, "cancelled": false, "connectionLost": false
    });
    let mock3 = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.check", bad_continuation)]),
    );
    let invocation = run_cli(
        &dir,
        &["orchestration", "check", "--json", "--peek"],
        &worker_mail_env_ref(),
    );
    assert_eq!(
        invocation.exit_code, 1,
        "invalid continuation cursor must fail"
    );
    drop(mock);
    drop(mock3);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_explicit_inherit_permission_mode_is_rejected_on_reuse() {
    let dir = temp_dir("rb-inherit");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let mut args = vec![
        "orchestration",
        "worker-start",
        "--json",
        "--task",
        "task-1",
        "--workspace",
        "ws-1",
        "--reuse-session",
        "session-1",
        "--reuse-incarnation",
        "inc-1",
        "--permission-mode",
        "inherit",
    ];
    args.extend(coordinator_args());
    let invocation = run_cli(&dir, &args, &[]);
    assert_eq!(
        invocation.exit_code, 2,
        "explicitly supplied inherit is a fresh-only preference: {}",
        invocation.stderr
    );
    assert!(mock.captured().is_empty());
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// RED: a fast authenticated final report can win before launch finalization,
// so worker-start may legitimately return assignmentState=completed with
// readiness=workerObserved and an independent process verdict. The CLI must
// not signal failure for that coherent outcome.
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn red_worker_start_completed_with_live_process_is_success() {
    let dir = temp_dir("rc-c-live");
    let result = json!({
        "runId": "run-1", "taskId": "task-1", "dispatchId": "dispatch-1",
        "consumerGeneration": 3, "workspaceId": "ws-1",
        "assignmentState": "completed", "readiness": "workerObserved",
        "processVerdict": "live",
        "outcome": "succeeded",
        "sessionIdentity": {
            "sessionId": "session-1",
            "incarnation": "f2b4c995-0e6c-4a0a-9e6f-1f2a3b4c5d6e"
        },
        "effects": [], "residualResources": []
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.workerStart", result)]),
    );
    let mut args = vec![
        "orchestration",
        "worker-start",
        "--json",
        "--task",
        "task-1",
        "--workspace",
        "ws-1",
        "--harness",
        "pi",
        "--model",
        "m1",
    ];
    args.extend(coordinator_args());
    let invocation = run_cli(&dir, &args, &[]);
    assert_eq!(
        invocation.exit_code, 0,
        "a coherent completed attempt is a success, not a failure: {} {}",
        invocation.stdout, invocation.stderr
    );
    assert!(invocation.stdout.contains("completed"));
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);

    // The same acceptance must hold when the process verdict is unverifiable:
    // readiness/outcome are never invented from the process axis.
    let dir = temp_dir("rc-c-unv");
    let result = json!({
        "runId": "run-1", "taskId": "task-1", "dispatchId": "dispatch-1",
        "consumerGeneration": 3, "workspaceId": "ws-1",
        "assignmentState": "completed", "readiness": "workerObserved",
        "processVerdict": "unverifiable",
        "outcome": "succeeded",
        "effects": [], "residualResources": []
    });
    let _mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.workerStart", result)]),
    );
    let mut args = vec![
        "orchestration",
        "worker-start",
        "--json",
        "--task",
        "task-1",
        "--workspace",
        "ws-1",
        "--harness",
        "pi",
        "--model",
        "m1",
    ];
    args.extend(coordinator_args());
    let invocation = run_cli(&dir, &args, &[]);
    assert_eq!(
        invocation.exit_code, 0,
        "completed stays successful with an independent unverifiable verdict: {}",
        invocation.stderr
    );
    assert!(invocation.stdout.contains("unverifiable"));
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// worker-retain: typed params, schema checks, exit codes, credential refusal.
// ---------------------------------------------------------------------------

fn retain_result(disposition: &str, reason: &str) -> Value {
    let state = match reason {
        "already_released" => "already_released",
        "release_committed" => "release_unknown",
        _ => "retained",
    };
    json!({
        "dispatchId": "dispatch-1",
        "disposition": disposition,
        "reason": reason,
        "state": state,
        "processVerdict": "exited",
        "processAction": "none",
        "archive": null,
        "residualResources": [],
    })
}

fn retain_args(extra: &[&str]) -> Vec<String> {
    let mut args = vec![
        "orchestration".to_string(),
        "worker-retain".to_string(),
        "--dispatch".to_string(),
        "dispatch-1".to_string(),
    ];
    args.extend(extra.iter().map(|s| s.to_string()));
    args.extend(coordinator_args().iter().map(|s| s.to_string()));
    args
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_retain_records_user_requested_hold() {
    let dir = temp_dir("retain-ok");
    let mock = MockService::start(
        &dir,
        mock_behavior(
            true,
            vec![(
                "orchestration.workerRetain",
                retain_result("retained", "user_requested"),
            )],
        ),
    );
    let args = retain_args(&["--json"]);
    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    let invocation = run_cli(&dir, &args_ref, &[]);
    assert_eq!(invocation.exit_code, 0, "{}", invocation.stderr);
    let captured = mock.captured();
    let sent = captured
        .iter()
        .find(|r| r["method"] == "orchestration.workerRetain")
        .expect("retain sent");
    assert_eq!(sent["params"]["dispatchId"], json!("dispatch-1"));
    assert_eq!(sent["params"]["runId"], json!("run-1"));
    assert_eq!(sent["params"]["coordinatorId"], json!("coord-1"));
    assert_eq!(sent["params"]["consumerGeneration"], json!(3));
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_retain_human_output_names_reason() {
    let dir = temp_dir("retain-human");
    let _mock = MockService::start(
        &dir,
        mock_behavior(
            true,
            vec![(
                "orchestration.workerRetain",
                retain_result("retained", "user_requested"),
            )],
        ),
    );
    let args = retain_args(&[]);
    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    let invocation = run_cli(&dir, &args_ref, &[]);
    assert_eq!(invocation.exit_code, 0, "{}", invocation.stderr);
    assert!(
        invocation.stdout.contains("retained"),
        "{}",
        invocation.stdout
    );
    assert!(
        invocation.stdout.contains("user_requested"),
        "{}",
        invocation.stdout
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_retain_already_released_is_settled_success() {
    let dir = temp_dir("retain-released");
    let _mock = MockService::start(
        &dir,
        mock_behavior(
            true,
            vec![(
                "orchestration.workerRetain",
                retain_result("released", "already_released"),
            )],
        ),
    );
    let args = retain_args(&["--json"]);
    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    let invocation = run_cli(&dir, &args_ref, &[]);
    assert_eq!(invocation.exit_code, 0, "{}", invocation.stderr);
    assert!(
        invocation.stdout.contains("already_released"),
        "{}",
        invocation.stdout
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_retain_committed_release_exits_failure() {
    let dir = temp_dir("retain-committed");
    let _mock = MockService::start(
        &dir,
        mock_behavior(
            true,
            vec![(
                "orchestration.workerRetain",
                retain_result("unverifiable", "release_committed"),
            )],
        ),
    );
    let args = retain_args(&["--json"]);
    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    let invocation = run_cli(&dir, &args_ref, &[]);
    assert_eq!(
        invocation.exit_code, 1,
        "a committed release cannot be retained over: {}",
        invocation.stderr
    );
    assert!(
        invocation.stdout.contains("release_committed"),
        "{}",
        invocation.stdout
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_retain_release_pending_exits_success() {
    let dir = temp_dir("retain-pending");
    let pending = json!({
        "dispatchId": "dispatch-1",
        "disposition": "unverifiable",
        "reason": "release_committed",
        "state": "release_pending",
        "processVerdict": "live",
        "processAction": "none",
        "archive": null,
        "residualResources": [],
    });
    let _mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.workerRetain", pending)]),
    );
    let args = retain_args(&["--json"]);
    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    let invocation = run_cli(&dir, &args_ref, &[]);
    assert_eq!(
        invocation.exit_code, 0,
        "release_pending is not a failure: {}",
        invocation.stderr
    );
    assert!(
        invocation.stdout.contains("release_pending"),
        "{}",
        invocation.stdout
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_retain_wrong_dispatch_result_is_rejected() {
    let dir = temp_dir("retain-mismatch");
    let _mock = MockService::start(
        &dir,
        mock_behavior(
            true,
            vec![(
                "orchestration.workerRetain",
                json!({"dispatchId": "unrelated-dispatch",
                       "disposition": "retained", "reason": "user_requested",
                       "state": "retained", "processVerdict": "live",
                       "processAction": "none", "archive": null}),
            )],
        ),
    );
    let args = retain_args(&["--json"]);
    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    let invocation = run_cli(&dir, &args_ref, &[]);
    assert_eq!(invocation.exit_code, 1, "{}", invocation.stderr);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_retain_validates_state_without_discarding_additive_archive_metadata() {
    for (contradictory, expected) in [(false, 0), (true, 1)] {
        let dir = tempfile::tempdir().unwrap();
        let mut result = retain_result("retained", "user_requested");
        result["archive"] = json!({"available": true, "futureMetadata": "preserved"});
        if contradictory {
            result["disposition"] = json!("released");
        }
        let _mock = MockService::start(
            dir.path(),
            mock_behavior(true, vec![("orchestration.workerRetain", result)]),
        );
        let args = retain_args(&["--json"]);
        let args: Vec<_> = args.iter().map(String::as_str).collect();
        let invocation = run_cli(dir.path(), &args, &[]);
        assert_eq!(
            invocation.exit_code, expected,
            "{} {}",
            invocation.stdout, invocation.stderr
        );
        if !contradictory {
            let value: Value = serde_json::from_str(&invocation.stdout).unwrap();
            assert_eq!(value["result"]["archive"]["futureMetadata"], "preserved");
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_retain_unknown_reason_is_rejected() {
    let dir = temp_dir("retain-reason");
    let _mock = MockService::start(
        &dir,
        mock_behavior(
            true,
            vec![(
                "orchestration.workerRetain",
                json!({"dispatchId": "dispatch-1",
                       "disposition": "retained", "reason": "bogus",
                       "processVerdict": "live"}),
            )],
        ),
    );
    let args = retain_args(&["--json"]);
    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    let invocation = run_cli(&dir, &args_ref, &[]);
    assert_eq!(invocation.exit_code, 1, "{}", invocation.stderr);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_retain_refuses_worker_credential() {
    let dir = temp_dir("retain-cred");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let capability = os(SCOPED_CREDENTIAL);
    let env = [("DROGON_DISPATCH_CAPABILITY", &capability)];
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "worker-retain",
            "--dispatch",
            "dispatch-1",
            "--json",
        ],
        &env,
    );
    assert_eq!(invocation.exit_code, 2);
    assert!(
        invocation
            .stderr
            .contains("refuses DROGON_DISPATCH_CAPABILITY"),
        "{}",
        invocation.stderr
    );
    assert!(
        mock.captured().is_empty(),
        "refused credential never connects"
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// worker-list: typed params, full render, credential refusal (mapping only;
// engine parity is proved by native_worker_list in drogon-core).
// ---------------------------------------------------------------------------

fn list_result() -> Value {
    json!({
        "workers": [
            {"dispatchId": "dispatch-1", "taskId": "task-1", "runId": "run-1",
             "assignmentState": "ready", "outcome": null,
             "processVerdict": "live", "workerState": "ready",
             "dispatchStatus": "dispatched", "agentTerminalHandle": "sess-1",
             "terminalState": "active",
             "resource": {"state": "owned", "reason": "cleanup_owned"}},
            {"dispatchId": "dispatch-2", "taskId": "task-2", "runId": "run-1",
             "assignmentState": "stopped", "outcome": null,
             "processVerdict": "exited", "workerState": "stopped",
             "dispatchStatus": "completed", "agentTerminalHandle": "sess-2",
             "terminalState": "retained",
             "resource": {"state": "retained", "reason": "user_requested"}},
        ],
        "counts": {"active": 1, "retained": 1},
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_list_sends_host_scoped_params_without_coordinator_bindings() {
    let dir = temp_dir("list-params");
    let mut filtered = list_result();
    filtered["workers"][0]["terminalState"] = json!("retained");
    filtered["workers"][0]["resource"] = json!({"state": "retained", "reason": "user_requested"});
    filtered["counts"] = json!({"retained": 2});
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.workerList", filtered)]),
    );
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "worker-list",
            "--run",
            "run-1",
            "--terminal-state",
            "retained",
            "--json",
        ],
        &[],
    );
    assert_eq!(invocation.exit_code, 0, "{}", invocation.stderr);
    let captured = mock.captured();
    let sent = captured
        .iter()
        .find(|r| r["method"] == "orchestration.workerList")
        .expect("list sent");
    assert_eq!(sent["params"]["run"], json!("run-1"));
    assert_eq!(sent["params"]["terminalState"], json!("retained"));
    assert_eq!(sent["params"]["hostId"], json!(HOST));
    assert!(sent["params"].get("coordinatorId").is_none());
    assert!(sent["params"].get("consumerGeneration").is_none());
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_list_human_output_renders_every_row_and_counts() {
    let dir = temp_dir("list-human");
    let _mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.workerList", list_result())]),
    );
    let invocation = run_cli(&dir, &["orchestration", "worker-list"], &[]);
    assert_eq!(invocation.exit_code, 0, "{}", invocation.stderr);
    assert!(
        invocation.stdout.contains("dispatch-1"),
        "{}",
        invocation.stdout
    );
    assert!(
        invocation.stdout.contains("dispatch-2"),
        "{}",
        invocation.stdout
    );
    assert!(
        invocation.stdout.contains("terminal=active"),
        "{}",
        invocation.stdout
    );
    assert!(
        invocation.stdout.contains("terminal=retained"),
        "{}",
        invocation.stdout
    );
    assert!(
        invocation.stdout.contains("active=1"),
        "{}",
        invocation.stdout
    );
    assert!(
        invocation.stdout.contains("retained=1"),
        "{}",
        invocation.stdout
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_list_empty_renders_no_workers_found() {
    let dir = temp_dir("list-empty");
    let _mock = MockService::start(
        &dir,
        mock_behavior(
            true,
            vec![(
                "orchestration.workerList",
                json!({"workers": [], "counts": {}}),
            )],
        ),
    );
    let invocation = run_cli(&dir, &["orchestration", "worker-list"], &[]);
    assert_eq!(invocation.exit_code, 0, "{}", invocation.stderr);
    assert!(
        invocation.stdout.contains("No workers found."),
        "{}",
        invocation.stdout
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_list_rejects_row_outside_requested_filter() {
    let dir = temp_dir("list-mismatch");
    let mut bad = list_result();
    bad["workers"][0]["terminalState"] = json!("released");
    let _mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.workerList", bad)]),
    );
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "worker-list",
            "--terminal-state",
            "retained",
            "--json",
        ],
        &[],
    );
    assert_eq!(invocation.exit_code, 1, "{}", invocation.stderr);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_list_rejects_unknown_terminal_state() {
    let dir = temp_dir("list-bad-state");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "worker-list",
            "--terminal-state",
            "bogus",
            "--json",
        ],
        &[],
    );
    assert_ne!(invocation.exit_code, 0);
    assert!(mock.captured().is_empty(), "invalid flag never connects");
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn worker_list_refuses_worker_credential() {
    let dir = temp_dir("list-cred");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let capability = os(SCOPED_CREDENTIAL);
    let env = [("DROGON_DISPATCH_CAPABILITY", &capability)];
    let invocation = run_cli(&dir, &["orchestration", "worker-list", "--json"], &env);
    assert_eq!(invocation.exit_code, 2);
    assert!(
        invocation
            .stderr
            .contains("refuses DROGON_DISPATCH_CAPABILITY"),
        "{}",
        invocation.stderr
    );
    assert!(
        mock.captured().is_empty(),
        "refused credential never connects"
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// reset: typed mapping per scope, credential refusal, exactly-one-scope.
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reset_maps_each_scope_flag_to_the_typed_reset_method() {
    for (flag, scope) in [
        ("--all", "all"),
        ("--tasks", "tasks"),
        ("--messages", "messages"),
    ] {
        let dir = temp_dir("reset-scope");
        let mock = MockService::start(
            &dir,
            mock_behavior(true, vec![("orchestration.reset", json!({"reset": scope}))]),
        );
        let invocation = run_cli(&dir, &["orchestration", "reset", flag, "--json"], &[]);
        assert_eq!(invocation.exit_code, 0, "{}", invocation.stderr);
        let envelope: Value = serde_json::from_str(&invocation.stdout).expect("JSON envelope");
        assert_eq!(envelope["ok"], true);
        assert_eq!(envelope["result"]["reset"], scope);
        let seen = mock.captured();
        let call = seen
            .iter()
            .find(|request| request["method"] == "orchestration.reset")
            .expect("mock saw orchestration.reset");
        assert_eq!(call["params"]["scope"], scope);
        assert_eq!(call["params"]["hostId"], HOST);
        drop(mock);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reset_human_mode_prints_reset_scope() {
    let dir = temp_dir("reset-human");
    let mock = MockService::start(
        &dir,
        mock_behavior(
            true,
            vec![("orchestration.reset", json!({"reset": "tasks"}))],
        ),
    );
    let invocation = run_cli(&dir, &["orchestration", "reset", "--tasks"], &[]);
    assert_eq!(invocation.exit_code, 0, "{}", invocation.stderr);
    assert_eq!(invocation.stdout.trim(), "Reset: tasks");
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reset_refuses_worker_credential() {
    let dir = temp_dir("reset-cred");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let capability = os(SCOPED_CREDENTIAL);
    let env = [("DROGON_DISPATCH_CAPABILITY", &capability)];
    let invocation = run_cli(&dir, &["orchestration", "reset", "--tasks", "--json"], &env);
    assert_eq!(invocation.exit_code, 2);
    assert!(
        invocation
            .stderr
            .contains("refuses DROGON_DISPATCH_CAPABILITY"),
        "{}",
        invocation.stderr
    );
    assert!(
        mock.captured().is_empty(),
        "refused credential never connects"
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reset_requires_exactly_one_scope_flag() {
    // No scope flag: usage error, never connects.
    let dir = temp_dir("reset-noscope");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let invocation = run_cli(&dir, &["orchestration", "reset", "--json"], &[]);
    assert_eq!(invocation.exit_code, 2, "{}", invocation.stderr);
    assert!(
        invocation.stderr.contains("exactly one reset scope"),
        "{}",
        invocation.stderr
    );
    assert!(mock.captured().is_empty(), "usage error never connects");
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
    // Two scope flags: clap conflict, never connects.
    let dir = temp_dir("reset-twoscope");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let invocation = run_cli(&dir, &["orchestration", "reset", "--all", "--tasks"], &[]);
    assert_eq!(invocation.exit_code, 2, "{}", invocation.stderr);
    assert!(
        mock.captured().is_empty(),
        "conflicting flags never connect"
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn inbox_maps_limit_and_terminal_and_renders_heads() {
    let dir = temp_dir("inbox");
    let result = json!({
        "messages": [
            {"messageId": "m2", "sequence": 2, "kind": "guidance",
             "fromActor": "coordinator:coord-1", "toActor": "dispatch:dispatch-1",
             "subject": "second"},
            {"messageId": "m1", "sequence": 1, "kind": "status",
             "fromActor": "dispatch:dispatch-1", "subject": "first",
             "body": "hidden without --full", "payload": {"a": 1}},
        ],
        "count": 2,
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.inbox", result)]),
    );
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "inbox",
            "--limit",
            "10",
            "--terminal",
            "dispatch-1",
        ],
        &[],
    );
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    let inbox = mock
        .captured()
        .into_iter()
        .find(|r| r["method"] == "orchestration.inbox")
        .expect("inbox sent");
    assert_eq!(inbox["params"]["limit"], json!(10));
    assert_eq!(inbox["params"]["terminal"], json!("dispatch-1"));
    // Source head format: `<id>[tag] <from> -> <to ? ?>: "<subject>"`.
    assert!(
        invocation
            .stdout
            .contains("m2 coordinator:coord-1 -> dispatch:dispatch-1: \"second\""),
        "{}",
        invocation.stdout
    );
    assert!(
        invocation
            .stdout
            .contains("m1 dispatch:dispatch-1 -> ?: \"first\""),
        "{}",
        invocation.stdout
    );
    // Default sweep omits bodies and payloads.
    assert!(!invocation.stdout.contains("hidden without --full"));
    assert!(!invocation.stdout.contains("[payload]"));
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn inbox_full_expands_body_and_payload() {
    let dir = temp_dir("inbox-full");
    let result = json!({
        "messages": [
            {"messageId": "m1", "sequence": 1, "kind": "status",
             "fromActor": "dispatch:dispatch-1", "subject": "first",
             "body": "the body", "payload": {"a": 1}},
        ],
        "count": 1,
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.inbox", result)]),
    );
    let invocation = run_cli(&dir, &["orchestration", "inbox", "--full"], &[]);
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    assert!(
        invocation.stdout.contains("the body"),
        "{}",
        invocation.stdout
    );
    assert!(
        invocation.stdout.contains("[payload]"),
        "{}",
        invocation.stdout
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn inbox_empty_reads_no_messages() {
    let dir = temp_dir("inbox-empty");
    let mock = MockService::start(
        &dir,
        mock_behavior(
            true,
            vec![("orchestration.inbox", json!({"messages": [], "count": 0}))],
        ),
    );
    let invocation = run_cli(&dir, &["orchestration", "inbox"], &[]);
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    assert!(
        invocation.stdout.contains("No messages."),
        "{}",
        invocation.stdout
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn inbox_json_passes_the_envelope_through() {
    let dir = temp_dir("inbox-json");
    let result = json!({
        "messages": [
            {"messageId": "m1", "sequence": 1, "kind": "status",
             "fromActor": "dispatch:dispatch-1", "subject": "first"},
        ],
        "count": 1,
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.inbox", result.clone())]),
    );
    let invocation = run_cli(&dir, &["orchestration", "inbox", "--json"], &[]);
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    let envelope: Value = serde_json::from_str(&invocation.stdout).expect("json stdout");
    assert_eq!(envelope["result"], result);
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn inbox_zero_limit_is_usage_error() {
    let dir = temp_dir("inbox-zero");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let invocation = run_cli(&dir, &["orchestration", "inbox", "--limit", "0"], &[]);
    assert_eq!(invocation.exit_code, 2, "stderr: {}", invocation.stderr);
    assert!(mock.captured().is_empty(), "usage error never connects");
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dispatch_maps_flags_and_renders_human_text() {
    let dir = temp_dir("dispatch-human");
    let result = json!({
        "dispatch": {"dispatchId": "dispatch-1", "taskId": "task-1",
            "assignmentState": "ready", "readiness": "notObserved",
            "processVerdict": "live",
            "sessionIdentity": {"sessionId": "session-1", "incarnation": "i1"}},
        "injected": true, "dryRun": false, "preamble": "PREAMBLE-TEXT",
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.dispatch", result)]),
    );
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "dispatch",
            "--run",
            "run-1",
            "--coordinator-id",
            "coord-1",
            "--consumer-generation",
            "3",
            "--task",
            "task-1",
            "--to",
            "session-1",
            "--inject",
            "--return-preamble",
        ],
        &[],
    );
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    assert_eq!(
        invocation.stdout.trim_end(),
        "Dispatched task-1 -> dispatch-1 [ready]\n\n--- Preamble ---\nPREAMBLE-TEXT"
    );
    let calls = mock.captured();
    let dispatch = calls
        .iter()
        .find(|r| r["method"] == "orchestration.dispatch")
        .expect("dispatch called");
    assert_eq!(dispatch["params"]["taskId"], "task-1");
    assert_eq!(dispatch["params"]["to"], "session-1");
    assert_eq!(dispatch["params"]["inject"], true);
    assert_eq!(dispatch["params"]["dryRun"], false);
    assert_eq!(dispatch["params"]["returnPreamble"], true);
    assert_eq!(dispatch["params"]["runId"], "run-1");
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dispatch_dry_run_prints_only_the_preamble() {
    let dir = temp_dir("dispatch-dry");
    let result = json!({
        "dispatch": null, "injected": false, "dryRun": true,
        "preamble": "PREVIEW-TEXT",
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.dispatch", result)]),
    );
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "dispatch",
            "--run",
            "run-1",
            "--coordinator-id",
            "coord-1",
            "--consumer-generation",
            "3",
            "--task",
            "task-1",
            "--dry-run",
        ],
        &[],
    );
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    assert_eq!(invocation.stdout.trim_end(), "PREVIEW-TEXT");
    let calls = mock.captured();
    let dispatch = calls
        .iter()
        .find(|r| r["method"] == "orchestration.dispatch")
        .expect("dispatch called");
    assert_eq!(dispatch["params"]["dryRun"], true);
    assert!(dispatch["params"].get("to").is_none());
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dispatch_without_to_is_usage_error() {
    let dir = temp_dir("dispatch-usage");
    let mock = MockService::start(&dir, mock_behavior(true, vec![]));
    let invocation = run_cli(
        &dir,
        &[
            "orchestration",
            "dispatch",
            "--run",
            "run-1",
            "--coordinator-id",
            "coord-1",
            "--consumer-generation",
            "3",
            "--task",
            "task-1",
        ],
        &[],
    );
    assert_eq!(invocation.exit_code, 2, "stderr: {}", invocation.stderr);
    assert!(mock.captured().is_empty(), "usage error never connects");
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn check_human_wait_and_delivery_kind_priority_parity() {
    let dir = temp_dir("check-human-parity");
    let timed_out = json!({
        "messages": [],
        "timedOut": true, "cancelled": false, "connectionLost": false
    });
    let delivered = json!({
        "delivery": {"deliveryId": "d1", "messageIds": ["m1", "m2"]},
        "messages": [
            {"messageId": "m1", "sequence": 1, "kind": "finalReport",
             "fromActor": "dispatch:worker-1", "subject": "done work", "priority": "urgent"},
            {"messageId": "m2", "sequence": 2, "kind": "status",
             "fromActor": "dispatch:worker-1", "subject": "note", "priority": "high"}
        ],
        "timedOut": false, "cancelled": false, "connectionLost": false
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(
            true,
            vec![
                ("orchestration.check", timed_out),
                ("orchestration.check", delivered),
            ],
        ),
    );
    let env = worker_mail_env_ref();
    let timeout = run_cli(
        &dir,
        &["orchestration", "check", "--wait", "--timeout-ms", "1000"],
        &env,
    );
    assert_eq!(
        timeout.stdout, "Wait timed out; no messages were consumed.\n",
        "{}",
        timeout.stdout
    );
    assert!(
        timeout
            .stderr
            .contains("warning: wait timed out; no messages were consumed"),
        "{}",
        timeout.stderr
    );
    let human = run_cli(&dir, &["orchestration", "check"], &env);
    assert_eq!(human.exit_code, 0, "stderr: {}", human.stderr);
    let expected = "Delivery d1\n\
        m1 [URGENT] [worker_done] from=dispatch:worker-1 \"done work\"\n\
        m2 [HIGH] [status] from=dispatch:worker-1 \"note\"\n";
    assert_eq!(human.stdout, expected, "{}", human.stdout);
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn check_format_expands_blocks_and_passes_server_formatted_through() {
    let dir = temp_dir("check-format");
    let messages = json!([
        {"messageId": "m1", "sequence": 1, "kind": "guidance",
         "fromActor": "coordinator:owner", "subject": "orders",
         "body": "do it", "payload": {"step": 1}, "priority": "normal"}
    ]);
    let unformatted = json!({
        "messages": messages,
        "timedOut": false, "cancelled": false, "connectionLost": false
    });
    let server = json!({
        "messages": messages,
        "formatted": "SERVER BLOCK",
        "timedOut": false, "cancelled": false, "connectionLost": false
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(
            true,
            vec![
                ("orchestration.check", unformatted),
                ("orchestration.check", server),
            ],
        ),
    );
    let env = worker_mail_env_ref();
    let local = run_cli(&dir, &["orchestration", "check", "--format"], &env);
    assert_eq!(local.exit_code, 0, "stderr: {}", local.stderr);
    let out = local.stdout;
    assert!(
        out.contains("m1 [guidance] from=coordinator:owner"),
        "{out}"
    );
    assert!(out.contains("[subject]\n  orders"), "{out}");
    assert!(out.contains("[body]\n  do it"), "{out}");
    assert!(out.contains("[payload]"), "{out}");
    assert!(
        out.contains("[Reply: drogon-cli orchestration reply --id m1 --body \"...\"]"),
        "{out}"
    );
    let passthrough = run_cli(&dir, &["orchestration", "check", "--format"], &env);
    assert_eq!(
        passthrough.stdout, "SERVER BLOCK\n",
        "{}",
        passthrough.stdout
    );
    let captured = mock.captured();
    let formats: Vec<&Value> = captured
        .iter()
        .filter(|r| r["method"] == "orchestration.check")
        .collect();
    assert_eq!(formats.len(), 2);
    assert_eq!(formats[0]["params"]["format"], json!(true));
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn check_unread_flag_is_explicit_consuming_read_with_source_exclusivity_text() {
    let dir = temp_dir("check-unread");
    let result = json!({
        "delivery": {"deliveryId": "d1", "messageIds": ["m1"]},
        "messages": [
            {"messageId": "m1", "sequence": 1, "kind": "status",
             "fromActor": "dispatch:worker-1", "subject": "s"}
        ],
        "timedOut": false, "cancelled": false, "connectionLost": false
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.check", result)]),
    );
    let env = worker_mail_env_ref();
    let explicit = run_cli(&dir, &["orchestration", "check", "--unread"], &env);
    assert_eq!(explicit.exit_code, 0, "stderr: {}", explicit.stderr);
    assert!(
        explicit.stdout.starts_with("Delivery d1\n"),
        "{}",
        explicit.stdout
    );
    for conflicting in [
        vec!["--unread", "--peek"],
        vec!["--unread", "--all"],
        vec!["--unread", "--peek", "--all"],
    ] {
        let mut args = vec!["orchestration", "check"];
        args.extend(conflicting.iter().copied());
        let invocation = run_cli(&dir, &args, &env);
        assert_eq!(invocation.exit_code, 2, "args {conflicting:?}");
        assert!(invocation.stdout.is_empty());
        assert!(
            invocation
                .stderr
                .contains("Choose at most one message read mode: --unread, --peek, or --all."),
            "args {conflicting:?}: {}",
            invocation.stderr
        );
    }
    let captured = mock.captured();
    assert_eq!(
        captured
            .iter()
            .filter(|r| r["method"] == "orchestration.check")
            .count(),
        1,
        "contradictory checks never reach the wire"
    );
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn check_wait_keepalive_writes_compact_json_to_stderr_only() {
    use std::sync::LazyLock;
    static INTERVAL: LazyLock<OsString> = LazyLock::new(|| OsString::from("100"));
    let dir = temp_dir("check-keepalive");
    let result =
        json!({"messages": [], "timedOut": false, "cancelled": false, "connectionLost": false});
    let canned: Arc<Mutex<Vec<(String, Value)>>> = Arc::new(Mutex::new(vec![(
        "orchestration.check".to_string(),
        result,
    )]));
    let behavior: Behavior = Arc::new(move |request| {
        let request_id = request["requestId"].as_str().unwrap_or("").to_string();
        match request["method"].as_str() {
            Some("status") => Action::Respond(ok_envelope(
                &request_id,
                json!({"hostId": HOST, "serviceInstanceId": "svc-1", "protocol": 1,
                    "capabilities": ["workspace.v1", "orchestration.native.v1"],
                    "version": "0.1.0"}),
            )),
            Some("orchestration.check") => {
                std::thread::sleep(Duration::from_millis(650));
                let mut queue = canned.lock().expect("canned lock");
                let (_, result) = queue.remove(0);
                Action::Respond(ok_envelope(&request_id, result))
            }
            _ => Action::Respond(error_envelope(
                &request_id,
                "method_not_found",
                "mock lacks this method",
            )),
        }
    });
    let mock = MockService::start(&dir, behavior);
    let mut env = worker_mail_env_ref();
    env.push(("DROGON_KEEPALIVE_INTERVAL_MS", &INTERVAL));
    let invocation = run_cli(
        &dir,
        &["orchestration", "check", "--wait", "--timeout-ms", "5000"],
        &env,
    );
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    assert_eq!(invocation.stdout, "No messages.\n", "{}", invocation.stdout);
    assert!(
        !invocation.stdout.contains("_keepalive"),
        "{}",
        invocation.stdout
    );
    let lines: Vec<&str> = invocation
        .stderr
        .lines()
        .filter(|l| l.contains("_keepalive"))
        .collect();
    assert!(lines.len() >= 2, "stderr: {}", invocation.stderr);
    for line in lines {
        let value: Value = serde_json::from_str(line).expect("keepalive is compact JSON");
        assert_eq!(value["_keepalive"], json!(true));
        assert!(value["elapsedMs"].is_number(), "{line}");
    }
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn check_json_envelope_passes_result_through() {
    let dir = temp_dir("check-json");
    let result = json!({
        "delivery": {"deliveryId": "d9", "messageIds": ["m1"]},
        "messages": [
            {"messageId": "m1", "sequence": 7, "kind": "escalation",
             "fromActor": "dispatch:worker-1", "subject": "help", "priority": "urgent"}
        ],
        "formatted": "SERVER BLOCK",
        "timedOut": false, "cancelled": false, "connectionLost": false
    });
    let mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.check", result)]),
    );
    let invocation = run_cli(
        &dir,
        &["orchestration", "check", "--json"],
        &worker_mail_env_ref(),
    );
    assert_eq!(invocation.exit_code, 0, "stderr: {}", invocation.stderr);
    let envelope: Value = serde_json::from_str(&invocation.stdout).expect("JSON envelope");
    assert_eq!(envelope["result"]["delivery"]["deliveryId"], json!("d9"));
    assert_eq!(
        envelope["result"]["messages"][0]["priority"],
        json!("urgent")
    );
    assert_eq!(envelope["result"]["formatted"], json!("SERVER BLOCK"));
    drop(mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn task_list_human_output_matches_source_label_rules() {
    let dir = temp_dir("task-list-human");
    let long_display: String = "d".repeat(70);
    let long_spec: String = "界".repeat(100);
    let result = json!({"tasks": [
        {"taskId": "task-1", "status": "dispatched",
         "spec": "ignored spec", "specTruncated": false,
         "title": "Title One", "displayName": "Shown One",
         "assigneeHandle": "sess-1", "dispatchId": "dispatch-1"},
        {"taskId": "task-2", "status": "ready",
         "spec": "ignored spec", "specTruncated": false,
         "title": "Title Two"},
        {"taskId": "task-3", "status": "pending",
         "spec": "fallback spec", "specTruncated": false},
        {"taskId": "task-4", "status": "pending",
         "spec": "x", "specTruncated": true,
         "displayName": long_display},
        {"taskId": "task-5", "status": "pending",
         "spec": long_spec, "specTruncated": true},
    ]});
    let _mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.taskList", result)]),
    );
    let mut args = vec!["orchestration", "task-list"];
    args.extend(coordinator_args());
    let invocation = run_cli(&dir, &args, &[]);
    assert_eq!(invocation.exit_code, 0, "{}", invocation.stderr);
    let lines: Vec<&str> = invocation.stdout.lines().collect();
    // display_name wins over title and spec; dispatched rows carry the
    // assignee suffix with the dispatch id.
    assert!(
        lines.contains(&"task-1 [dispatched] Shown One -> sess-1 (dispatch-1)"),
        "dispatched line: {}",
        invocation.stdout
    );
    // Title wins over spec when no display name is present.
    assert!(
        lines.contains(&"task-2 [ready] Title Two"),
        "title line: {}",
        invocation.stdout
    );
    // Spec is the fallback label.
    assert!(
        lines.contains(&"task-3 [pending] fallback spec"),
        "spec line: {}",
        invocation.stdout
    );
    // 60-character truncation, counted in characters, with no marker.
    let display_line = lines
        .iter()
        .find(|line| line.starts_with("task-4 "))
        .expect("task-4 line");
    assert_eq!(
        *display_line,
        &format!("task-4 [pending] {}", "d".repeat(60)),
        "display truncation: {display_line}",
    );
    let spec_line = lines
        .iter()
        .find(|line| line.starts_with("task-5 "))
        .expect("task-5 line");
    assert_eq!(
        *spec_line,
        &format!("task-5 [pending] {}", "界".repeat(60)),
        "multibyte truncation: {spec_line}",
    );
    assert!(
        !invocation.stdout.contains('…'),
        "source human lines print no truncation marker: {}",
        invocation.stdout
    );
    drop(_mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn task_list_human_output_empty_reports_no_tasks() {
    let dir = temp_dir("task-list-empty");
    let _mock = MockService::start(
        &dir,
        mock_behavior(true, vec![("orchestration.taskList", json!({"tasks": []}))]),
    );
    let mut args = vec!["orchestration", "task-list"];
    args.extend(coordinator_args());
    let invocation = run_cli(&dir, &args, &[]);
    assert_eq!(invocation.exit_code, 0, "{}", invocation.stderr);
    assert_eq!(invocation.stdout.trim(), "No tasks.");
    drop(_mock);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn task_create_and_update_human_output_match_source_lines() {
    let dir = temp_dir("task-created-updated");
    let _mock = MockService::start(
        &dir,
        mock_behavior(
            true,
            vec![
                (
                    "orchestration.taskCreate",
                    json!({"task": {"taskId": "task-1", "runId": "run-1",
                                     "status": "pending", "dependsOn": []}}),
                ),
                (
                    "orchestration.taskUpdate",
                    json!({"task": {"taskId": "task-9", "runId": "run-1",
                                     "status": "completed", "dependsOn": []}}),
                ),
            ],
        ),
    );
    let mut create = vec![
        "orchestration",
        "task-create",
        "--instructions",
        "Do the work",
    ];
    create.extend(coordinator_args());
    let created = run_cli(&dir, &create, &[]);
    assert_eq!(created.exit_code, 0, "{}", created.stderr);
    assert_eq!(created.stdout.trim(), "Created task-1 [pending]");
    let mut update = vec![
        "orchestration",
        "task-update",
        "--task",
        "task-9",
        "--status",
        "completed",
    ];
    update.extend(coordinator_args());
    let updated = run_cli(&dir, &update, &[]);
    assert_eq!(updated.exit_code, 0, "{}", updated.stderr);
    assert_eq!(updated.stdout.trim(), "Updated task-9 -> completed");
    drop(_mock);
    let _ = std::fs::remove_dir_all(&dir);
}
