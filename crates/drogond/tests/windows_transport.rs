//! Pipe naming is cross-platform; actual transport tests require a Windows runner.
//!
//! Cross-host contract tests for the Windows named-pipe transport
//! (`crates/drogond/src/endpoint.rs`, `cfg(windows)` section). What this
//! file verifies on this (Unix) host via the public `drogond::endpoint`
//! API: the deterministic pipe-naming algorithm that both `drogond` and
//! `drogon-cli` must independently reproduce identically for the client to
//! ever connect to the daemon's pipe (`sha2`-crate-backed on both sides,
//! plus formatting). It does not verify the `CreateNamedPipeW` /
//! overlapped-I/O / DACL path — that code has never been compiled on this
//! vertical's Unix host and is exercised by the isolated Windows runner.

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

// Frozen digest agrees with the independently implemented CLI contract
// (cross-checked via `shasum -a 256` on the shared sample input; a drift
// here would silently break every client connection to the daemon pipe).
#[test]
fn pipe_name_matches_the_drogon_cli_algorithm() {
    let name = windows_pipe_name("/home/tester/.local/share/drogon");
    assert_eq!(name, r"\\.\pipe\drogon-v1-44bca9b408bb8c048e5a2201");
}

// A client-free poll must not keep the accept loop from observing shutdown:
// `establish` binds the pipe and a poll-timeout `accept` with no client
// must report `WouldBlock` (the contract `server.rs`'s generic accept loop
// relies on). Host-gated — runs only on a Windows runner, never verified
// on this vertical's Unix host.
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
