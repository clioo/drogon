//! RED: the CLI ignores `DROGON_DISPATCH_CAPABILITY` and always resolves
//! the service `auth.token`.
//!
//! These are new security requirements from the root architecture
//! (native-coordination-contract.md, "Credential and receipt
//! representation"), not claims about an existing source regression: a
//! worker-scoped CLI must use the dispatch capability as `Request.auth`
//! and never fall back to the admin token; present-but-empty or invalid
//! credentials fail closed, including raw RPC.
//!
//! Method: the real `drogon-cli` subprocess with a clean child environment
//! against the existing local `MockService` (protocol peer only). Data dir,
//! socket path, and `auth.token` resolution are real; only the service side
//! is mocked. All credentials here are synthetic test literals; no actual
//! user token is ever read.

#![cfg(unix)]

mod common;

use std::path::Path;
use std::process::Output;
use std::sync::Arc;

use serde_json::{Value, json};

use common::{Action, Behavior, MockService, error_envelope, ok_envelope, stderr, stdout};

/// Synthetic worker credential accepted by the scoped-only mock.
const SCOPED_CREDENTIAL: &str = "synthetic-worker-capability-red-0001";
/// Synthetic invalid worker credential: present, nonempty, never accepted.
const INVALID_CREDENTIAL: &str = "synthetic-worker-capability-invalid-0002";
/// The mock's own synthetic service token (`common::TOKEN`).
const ADMIN_TOKEN: &str = common::TOKEN;

fn temp_data_dir(name: &str) -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix(&format!("dg-auth-{name}-"))
        .tempdir()
        .expect("tempdir")
}

/// Spawn the real CLI with an explicitly clean environment: only the data
/// dir and, when given, the worker capability. Nothing is inherited, so no
/// ambient credential can leak in or mask the resolution under test.
fn run_worker_cli(data_dir: &Path, args: &[&str], capability: Option<&str>) -> Output {
    let mut command = std::process::Command::new(env!("CARGO_BIN_EXE_drogon-cli"));
    command
        .env_clear()
        .env("DROGON_DATA_DIR", data_dir)
        .args(args);
    if let Some(cap) = capability {
        command.env("DROGON_DISPATCH_CAPABILITY", cap);
    }
    command.output().expect("spawn drogon-cli")
}

/// Mock accepts only the scoped worker credential on any method.
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

/// Mock accepts only the service admin token on any method.
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

fn assert_no_credential_leak(output: &Output, request: &Value, label: &str) {
    for secret in [SCOPED_CREDENTIAL, INVALID_CREDENTIAL, ADMIN_TOKEN] {
        assert!(
            !stdout(output).contains(secret),
            "{label}: stdout leaks a credential"
        );
        assert!(
            !stderr(output).contains(secret),
            "{label}: stderr leaks a credential"
        );
        assert!(
            !request["params"].to_string().contains(secret),
            "{label}: params carry a credential"
        );
        assert!(
            !request["requestId"].as_str().unwrap_or("").contains(secret),
            "{label}: requestId carries a credential"
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn invalid_capability_must_not_send_admin_token() {
    let dir = temp_data_dir("inv");
    let service = MockService::start(dir.path(), scoped_only_behavior());

    let output = run_worker_cli(
        dir.path(),
        &[
            "--json",
            "rpc",
            "worker.probe",
            "--params",
            "{\"probe\":\"auth-red\"}",
            "--request-id",
            "auth-red-req-1",
        ],
        Some(INVALID_CREDENTIAL),
    );
    let seen = service.captured();
    assert_eq!(seen.len(), 1, "CLI must place exactly one request");
    // RED: the worker-scoped CLI sends the service admin token.
    assert_ne!(
        seen[0]["auth"].as_str().unwrap_or(""),
        ADMIN_TOKEN,
        "worker CLI with an invalid capability sent the admin token"
    );
    assert_no_credential_leak(&output, &seen[0], "invalid-capability");
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn empty_capability_fails_closed_without_admin_fallback() {
    let dir = temp_data_dir("empty");
    let service = MockService::start(dir.path(), scoped_only_behavior());

    let output = run_worker_cli(
        dir.path(),
        &[
            "--json",
            "rpc",
            "worker.probe",
            "--params",
            "{\"probe\":\"auth-red\"}",
            "--request-id",
            "auth-red-req-2",
        ],
        Some(""),
    );
    let seen = service.captured();
    assert!(
        seen.is_empty(),
        "empty worker credentials must be rejected before connecting"
    );
    assert_eq!(output.status.code(), Some(1));
    let response: Value = serde_json::from_str(&stdout(&output)).expect("failure envelope");
    assert_eq!(response["error"]["code"], "unauthorized");
    assert_no_credential_leak(&output, &json!({}), "empty-capability");
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn valid_scoped_credential_used_without_admin_token_file() {
    let dir = temp_data_dir("scoped");
    let service = MockService::start(dir.path(), scoped_only_behavior());
    // Normal fixture first, then remove exactly the temp auth.token: the
    // scoped credential alone must suffice for raw RPC.
    std::fs::remove_file(dir.path().join(common::TOKEN_NAME)).expect("remove temp auth.token");

    let output = run_worker_cli(
        dir.path(),
        &[
            "--json",
            "rpc",
            "worker.probe",
            "--params",
            "{\"probe\":\"auth-red\"}",
            "--request-id",
            "auth-red-req-3",
        ],
        Some(SCOPED_CREDENTIAL),
    );
    let seen = service.captured();
    // RED: without auth.token the CLI errors before connecting, so the mock
    // sees nothing although a valid scoped credential was provided.
    assert_eq!(
        seen.len(),
        1,
        "scoped CLI must authenticate without auth.token"
    );
    assert_eq!(
        seen[0]["auth"].as_str().unwrap_or(""),
        SCOPED_CREDENTIAL,
        "scoped CLI must send the dispatch capability as Request.auth"
    );
    assert_eq!(output.status.code(), Some(0));
    assert_no_credential_leak(&output, &seen[0], "scoped-no-admin-file");
    drop(service);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn absent_capability_preserves_admin_flow() {
    // Positive control: with no worker credential in the environment, the
    // admin token flow works unchanged. Must PASS on the current candidate.
    let dir = temp_data_dir("admin");
    let service = MockService::start(dir.path(), admin_only_behavior());

    let output = run_worker_cli(
        dir.path(),
        &[
            "--json",
            "rpc",
            "worker.probe",
            "--params",
            "{\"probe\":\"auth-red\"}",
            "--request-id",
            "auth-red-req-4",
        ],
        None,
    );
    assert_eq!(output.status.code(), Some(0));
    let seen = service.captured();
    assert_eq!(seen.len(), 1, "CLI must place exactly one request");
    assert_eq!(
        seen[0]["auth"].as_str().unwrap_or(""),
        ADMIN_TOKEN,
        "absent capability must keep resolving the service token"
    );
    assert_no_credential_leak(&output, &seen[0], "admin-control");
    drop(service);
}
