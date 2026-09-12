//! MIT Copyright (c) 2026 Lovecast Inc.
//! Install-resilience P4/P5: `status` must expose the daemon's verifiable
//! identity — the monotonic `featureProtocol` floor and the sha256 of the
//! daemon process's own binary — so a freshly-installed desktop can detect
//! a changed `drogond` behind a still-running detached process instead of
//! silently attaching to it. Fails on `origin/main`, where neither field
//! exists and two builds of the same `CARGO_PKG_VERSION` are
//! indistinguishable.

use serde_json::{Value, json};

use drogon_core::Engine;
use drogon_protocol::{FEATURE_PROTOCOL_VERSION, PROTOCOL_VERSION, Request, Response};

fn call(engine: &Engine, request_id: &str, method: &str, params: Value) -> Response {
    engine.dispatch(Request {
        protocol: PROTOCOL_VERSION,
        request_id: request_id.into(),
        auth: None,
        method: method.into(),
        params,
    })
}

fn status(engine: &Engine) -> Value {
    let response = call(engine, "identity-1", "status", json!({}));
    assert!(response.ok, "status must answer: {:?}", response.error);
    response
        .result
        .expect("a successful status carries a result payload")
}

#[test]
fn status_reports_the_feature_protocol_floor() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let status = status(&engine);
    assert_eq!(
        status["featureProtocol"],
        json!(FEATURE_PROTOCOL_VERSION),
        "status must report the additive feature-protocol floor for desktop skew gates"
    );
}

#[test]
fn status_reports_the_daemon_binary_digest_of_its_own_process() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let status = status(&engine);
    let reported = status["daemonArtifactSha256"]
        .as_str()
        .expect("status must report the daemon's own binary digest");
    assert_eq!(reported.len(), 64, "sha256 hex, not a truncated digest");
    assert!(
        reported.chars().all(|c| c.is_ascii_hexdigit()),
        "digest must be plain hex: {reported}"
    );
    // The Engine answers in-process, so the reported digest must be the
    // digest of THIS test binary — the exact bytes `current_exe()` names.
    let exe = std::env::current_exe().unwrap();
    let bytes = std::fs::read(exe).unwrap();
    use sha2::{Digest, Sha256};
    let expected: String = Sha256::digest(&bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    assert_eq!(
        reported, expected,
        "the digest must hash the daemon process's own executable bytes"
    );
}

#[test]
fn status_digest_is_stable_across_calls_within_one_process() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Engine::open(dir.path()).unwrap();
    let first = status(&engine)["daemonArtifactSha256"].clone();
    let second = status(&engine)["daemonArtifactSha256"].clone();
    assert_eq!(first, second, "the identity is per-binary, not per-call");
}
