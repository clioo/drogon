//! Pipe naming is cross-platform; actual transport tests require a Windows runner.

use drogond::endpoint::windows_pipe_name;

#[test]
fn pipe_name_has_the_frozen_contract_shape() {
    let name = windows_pipe_name("/home/tester/.local/share/drogon");
    assert!(name.starts_with(r"\\.\pipe\drogon-v1-"));
    let suffix = &name[r"\\.\pipe\drogon-v1-".len()..];
    assert_eq!(
        suffix.len(),
        24,
        "pipe name must carry a 24-hex-char digest"
    );
    assert!(
        suffix
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
        "digest must be lowercase hex: {suffix}"
    );
}

#[test]
fn pipe_name_is_deterministic_and_input_sensitive() {
    let a = windows_pipe_name("/home/tester/.local/share/drogon");
    let b = windows_pipe_name("/home/tester/.local/share/drogon");
    let c = windows_pipe_name("/home/other/.local/share/drogon");
    assert_eq!(
        a, b,
        "same canonical input must always yield the same pipe name"
    );
    assert_ne!(a, c, "different data directories must not collide");
}

// Frozen digest agrees with the independently implemented CLI contract.
#[test]
fn pipe_name_matches_the_drogon_cli_algorithm() {
    let name = windows_pipe_name("/home/tester/.local/share/drogon");
    assert_eq!(name, r"\\.\pipe\drogon-v1-44bca9b408bb8c048e5a2201");
}

// A client-free poll must not keep the accept loop from observing shutdown.
#[cfg(windows)]
#[test]
fn accept_with_no_client_reports_wouldblock_within_the_poll_timeout() {
    use std::io::ErrorKind;
    use std::time::{Duration, Instant};

    let dir = tempfile::tempdir().unwrap();
    let mut listener = drogond::endpoint::establish(dir.path()).unwrap();
    let poll = Duration::from_millis(50);
    let started = Instant::now();
    let err = listener.accept(poll).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::WouldBlock);
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "a poll-timeout accept must not block far past its timeout"
    );
}
