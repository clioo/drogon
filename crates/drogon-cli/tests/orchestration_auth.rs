//! Dispatch-credential selection in the real CLI subprocess.
//!
//! Requirement: `DROGON_DISPATCH_CAPABILITY`, when present, is the only
//! credential source — sent verbatim, never falling back to `auth.token`;
//! empty/whitespace/control/non-UTF8/overlong values fail `unauthorized`
//! before connecting. The mock is the protocol peer only; data dir, socket,
//! and token-file resolution are real. All credentials are synthetic test
//! literals. Unix-only, like the existing harness; not a Windows proof.

#![cfg(unix)]

mod common;

use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::os::unix::ffi::OsStringExt;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use common::{Action, Behavior, MockService, error_envelope, ok_envelope, stderr, stdout};

const SCOPED_CREDENTIAL: &str = "synthetic-worker-capability-green-0001";
const INVALID_CREDENTIAL: &str = "synthetic-worker-capability-invalid-0002";
const DECOY_TOKEN: &str = "synthetic-decoy-admin-token-9999";
const ADMIN_TOKEN: &str = common::TOKEN;
const CHILD_TIMEOUT: Duration = Duration::from_secs(60);

fn temp_data_dir(name: &str) -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix(&format!("dg-auth-{name}-"))
        .tempdir()
        .expect("tempdir")
}

/// Real CLI with a clean child environment and a hard timeout: only the data
/// dir and the given capability are set; expiry kills the exact child.
fn run_worker_cli(data_dir: &Path, args: &[&str], capability: Option<&OsStr>) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_drogon-cli"));
    child
        .env_clear()
        .env("DROGON_DATA_DIR", data_dir)
        .args(args);
    child
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cap) = capability {
        child.env("DROGON_DISPATCH_CAPABILITY", cap);
    }
    let mut child = child.spawn().expect("spawn drogon-cli");
    let mut stdout_pipe = child.stdout.take().expect("stdout pipe");
    let mut stderr_pipe = child.stderr.take().expect("stderr pipe");
    let stdout_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout_pipe.read_to_end(&mut bytes).expect("read stdout");
        bytes
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr_pipe.read_to_end(&mut bytes).expect("read stderr");
        bytes
    });
    let deadline = Instant::now() + CHILD_TIMEOUT;
    loop {
        match child.try_wait().expect("poll child") {
            Some(status) => {
                return Output {
                    status,
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

fn rpc_args<'a>(params: &'a str, request_id: &'a str) -> [&'a str; 7] {
    [
        "--json",
        "rpc",
        "worker.probe",
        "--params",
        params,
        "--request-id",
        request_id,
    ]
}

fn scoped_only_behavior() -> Behavior {
    Arc::new(|request| {
        let request_id = request["requestId"].as_str().unwrap_or("").to_string();
        if request["auth"].as_str() == Some(SCOPED_CREDENTIAL) {
            Action::Respond(ok_envelope(&request_id, json!({"probe": "scoped-ok"})))
        } else {
            Action::Respond(error_envelope(
                &request_id,
                "unauthorized",
                "mock accepts only the scoped credential",
            ))
        }
    })
}

fn admin_only_behavior() -> Behavior {
    Arc::new(|request| {
        let request_id = request["requestId"].as_str().unwrap_or("").to_string();
        if request["auth"].as_str() == Some(ADMIN_TOKEN) {
            Action::Respond(ok_envelope(&request_id, json!({"probe": "admin-ok"})))
        } else {
            Action::Respond(error_envelope(
                &request_id,
                "unauthorized",
                "mock accepts only the admin token",
            ))
        }
    })
}

fn assert_no_leak(output: &Output, request: Option<&Value>, secrets: &[&str], label: &str) {
    for secret in secrets {
        assert!(!stdout(output).contains(secret), "{label}: stdout leaks");
        assert!(!stderr(output).contains(secret), "{label}: stderr leaks");
        if let Some(request) = request {
            assert!(
                !request["params"].to_string().contains(secret),
                "{label}: params leak"
            );
            assert!(
                !request["requestId"].as_str().unwrap_or("").contains(secret),
                "{label}: requestId leaks"
            );
        }
    }
}

fn assert_json_unauthorized(output: &Output, request_id: &str, label: &str) {
    assert_eq!(output.status.code(), Some(1), "{label}: exit code");
    let envelope: Value =
        serde_json::from_str(stdout(output).trim()).expect("JSON failure envelope");
    assert_eq!(envelope["ok"], false, "{label}: ok flag");
    assert_eq!(envelope["error"]["code"], "unauthorized", "{label}: code");
    assert_eq!(envelope["requestId"], request_id, "{label}: requestId");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn invalid_capability_sent_verbatim_and_rejected() {
    let dir = temp_data_dir("inv");
    let service = MockService::start(dir.path(), scoped_only_behavior());
    let output = run_worker_cli(
        dir.path(),
        &rpc_args("{\"probe\":\"auth-green\"}", "auth-green-req-1"),
        Some(OsStr::new(INVALID_CREDENTIAL)),
    );
    assert_no_leak(&output, None, &[INVALID_CREDENTIAL, ADMIN_TOKEN], "invalid");
    assert_json_unauthorized(&output, "auth-green-req-1", "invalid");
    let seen = service.captured();
    assert_eq!(seen.len(), 1, "invalid: exactly one attempt, no retry");
    assert_eq!(
        seen[0]["auth"], INVALID_CREDENTIAL,
        "invalid: sent verbatim"
    );
    assert_no_leak(
        &output,
        Some(&seen[0]),
        &[INVALID_CREDENTIAL, ADMIN_TOKEN],
        "invalid",
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn valid_scoped_preferred_over_present_admin_file() {
    let dir = temp_data_dir("scoped");
    let service = MockService::start(dir.path(), scoped_only_behavior());
    let output = run_worker_cli(
        dir.path(),
        &rpc_args("{\"probe\":\"auth-green\"}", "auth-green-req-2"),
        Some(OsStr::new(SCOPED_CREDENTIAL)),
    );
    assert_no_leak(&output, None, &[SCOPED_CREDENTIAL, ADMIN_TOKEN], "scoped");
    assert_eq!(output.status.code(), Some(0));
    let seen = service.captured();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0]["auth"], SCOPED_CREDENTIAL);
    assert_no_leak(
        &output,
        Some(&seen[0]),
        &[SCOPED_CREDENTIAL, ADMIN_TOKEN],
        "scoped",
    );
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn scoped_choice_ignores_admin_token_state() {
    // Missing, unreadable, and symlinked-to-decoy admin tokens must not
    // influence the scoped choice. Isolated fixtures only.
    let missing = temp_data_dir("tk-miss");
    let unreadable = temp_data_dir("tk-unread");
    let symlinked = temp_data_dir("tk-link");
    let missing_svc = MockService::start(missing.path(), scoped_only_behavior());
    let unreadable_svc = MockService::start(unreadable.path(), scoped_only_behavior());
    let symlinked_svc = MockService::start(symlinked.path(), scoped_only_behavior());

    std::fs::remove_file(missing.path().join(common::TOKEN_NAME)).expect("remove token");
    let unreadable_token = unreadable.path().join(common::TOKEN_NAME);
    std::fs::set_permissions(&unreadable_token, std::fs::Permissions::from_mode(0o000))
        .expect("chmod token");
    let decoy = symlinked.path().join("decoy.token");
    std::fs::write(&decoy, "synthetic-decoy-admin-token-9999\n").expect("decoy");
    std::fs::remove_file(symlinked.path().join(common::TOKEN_NAME)).expect("remove token");
    std::os::unix::fs::symlink(&decoy, symlinked.path().join(common::TOKEN_NAME))
        .expect("symlink token");

    for (i, (dir, svc)) in [
        (missing.path(), &missing_svc),
        (unreadable.path(), &unreadable_svc),
        (symlinked.path(), &symlinked_svc),
    ]
    .into_iter()
    .enumerate()
    {
        let request_id = format!("auth-green-req-3-{i}");
        let output = run_worker_cli(
            dir,
            &rpc_args("{\"probe\":\"auth-green\"}", &request_id),
            Some(OsStr::new(SCOPED_CREDENTIAL)),
        );
        assert_no_leak(
            &output,
            None,
            &[SCOPED_CREDENTIAL, ADMIN_TOKEN, DECOY_TOKEN],
            "token-state",
        );
        assert_eq!(output.status.code(), Some(0), "token-state {i}");
        let seen = svc.captured();
        assert_eq!(seen.len(), 1, "token-state {i}");
        assert_eq!(seen[0]["auth"], SCOPED_CREDENTIAL, "token-state {i}");
    }
    drop((missing_svc, unreadable_svc, symlinked_svc));
    drop((missing, unreadable, symlinked));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn empty_capability_refused_before_connect() {
    // Root correction: empty refuses with 0 captured requests, exit 1, JSON
    // unauthorized — whether or not the admin file exists.
    for (i, with_token) in [true, false].into_iter().enumerate() {
        let dir = temp_data_dir(&format!("empty-{i}"));
        let service = MockService::start(dir.path(), scoped_only_behavior());
        if !with_token {
            std::fs::remove_file(dir.path().join(common::TOKEN_NAME)).expect("remove token");
        }
        let request_id = format!("auth-green-req-4-{i}");
        let output = run_worker_cli(
            dir.path(),
            &rpc_args("{\"probe\":\"auth-green\"}", &request_id),
            Some(OsStr::new("")),
        );
        assert_no_leak(&output, None, &[ADMIN_TOKEN], "empty");
        assert_json_unauthorized(&output, &request_id, "empty");
        assert_eq!(service.captured().len(), 0, "empty: refused before connect");
        drop(service);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn malformed_capabilities_refused_before_connect() {
    let overlong = "x".repeat(drogon_cli::credential::MAX_CREDENTIAL_BYTES + 1);
    let non_utf8 = OsString::from_vec(b"\xff\xfe".to_vec());
    let cases: Vec<(&str, &OsStr)> = vec![
        ("whitespace", OsStr::new("   ")),
        ("control", OsStr::new("a\x01b")),
        ("non-utf8", &non_utf8),
        ("overlong", OsStr::new(&overlong)),
    ];
    for (i, (kind, value)) in cases.into_iter().enumerate() {
        let dir = temp_data_dir(&format!("mal-{i}"));
        let service = MockService::start(dir.path(), scoped_only_behavior());
        let request_id = format!("auth-green-req-5-{i}");
        let output = run_worker_cli(
            dir.path(),
            &rpc_args("{\"probe\":\"auth-green\"}", &request_id),
            Some(value),
        );
        assert_no_leak(&output, None, &[ADMIN_TOKEN], kind);
        if let Some(secret) = value.to_str().filter(|text| !text.trim().is_empty()) {
            assert_no_leak(&output, None, &[secret], kind);
        }
        assert_json_unauthorized(&output, &request_id, kind);
        assert_eq!(output.status.code(), Some(1), "{kind}: exit code");
        let envelope: Value =
            serde_json::from_str(stdout(&output).trim()).expect("JSON failure envelope");
        assert_eq!(envelope["error"]["code"], "unauthorized", "{kind}: code");
        assert_eq!(
            service.captured().len(),
            0,
            "{kind}: refused before connect"
        );
        drop(service);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn absent_capability_preserves_admin_flow() {
    let dir = temp_data_dir("admin");
    let service = MockService::start(dir.path(), admin_only_behavior());
    let output = run_worker_cli(
        dir.path(),
        &rpc_args("{\"probe\":\"auth-green\"}", "auth-green-req-6"),
        None,
    );
    assert_no_leak(&output, None, &[ADMIN_TOKEN], "admin");
    assert_eq!(output.status.code(), Some(0));
    let seen = service.captured();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0]["auth"], ADMIN_TOKEN);
    assert_no_leak(&output, Some(&seen[0]), &[ADMIN_TOKEN], "admin");
    drop(service);
}
