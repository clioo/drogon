//! Cross-host contract tests for the Windows named-pipe transport
//! (`crates/drogond/src/endpoint.rs`, `cfg(windows)` section).
//!
//! What this file DOES verify, on this (Unix) host, via the public
//! `drogond::endpoint` API: the deterministic pipe-naming algorithm that
//! both `drogond` and `drogon-cli` must independently reproduce identically
//! for the client to ever connect to the daemon's pipe. This is pure string
//! math (now `sha2`-crate-backed on both sides, plus formatting), so it is
//! fully host-independent.
//!
//! What this file explicitly does NOT and CANNOT verify here: the actual
//! `CreateNamedPipeW`/`ConnectNamedPipe`/overlapped-I/O/DACL `windows-sys`
//! code path in `endpoint.rs`'s `cfg(windows)` module. There is no Windows
//! Rust target installed on this host, so that code has never been
//! compiled, let alone executed, by this vertical — and `windows-sys` is
//! not yet a dependency of `drogond` at all (see the evidence doc's
//! Completion section for the exact blocking Cargo line). The module *is*
//! reachable now: `crates/drogond/src/lib.rs` declares `pub mod endpoint;`
//! unconditionally. Per the assignment, V5's isolated Windows runner is the
//! one that compiles and exercises the `cfg(windows)` transport, not this
//! vertical.

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

/// Independently confirms, via `shasum -a 256` on the sample input used by
/// `drogon-cli::paths::windows_pipe_name`'s own contract test, that this
/// crate's dependency-free SHA-256 (necessary because `drogond` cannot add
/// `sha2` as a non-dev dependency without a `Cargo.toml` edit outside this
/// vertical's scope) produces byte-identical output to the client's
/// `sha2`-crate-backed implementation. A future drift here would silently
/// break every client connection to the daemon's named pipe.
#[test]
fn pipe_name_matches_the_drogon_cli_algorithm() {
    let name = windows_pipe_name("/home/tester/.local/share/drogon");
    assert_eq!(name, r"\\.\pipe\drogon-v1-44bca9b408bb8c048e5a2201");
}

/// Host-gated (only runs on an actual Windows test runner, e.g. V5's — this
/// vertical has no Windows toolchain and could not execute it, so this is
/// syntax-checked here at best, never behaviorally verified): `establish`
/// binds the pipe, and a poll-timeout `accept` with no client connecting
/// must report `WouldBlock` rather than blocking indefinitely or erroring —
/// the contract `server.rs`'s generic accept loop relies on to treat this
/// exactly like the Unix nonblocking listener's "no connection pending"
/// case. Never claims this is functional Windows parity from this run
/// alone; see the evidence doc's Completion section.
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
