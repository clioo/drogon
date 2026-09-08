//! Issue #273: a PTY session child must not inherit ignored signal
//! dispositions from the daemon. POSIX keeps ignored dispositions across
//! exec and a non-interactive shell cannot trap or reset a signal that was
//! ignored on entry, so `spawn_pty`'s pre-exec hook is the only place the
//! child can recover SIGINT/SIGQUIT/SIGPIPE/SIGTERM default behavior.

use super::*;
use crate::{Engine, PROTOCOL_VERSION, Request};

/// Restores process-wide dispositions on drop; tests run multi-threaded in
/// one process, so the ignored window stays inside a single quick test.
struct SignalGuard(Vec<(libc::c_int, libc::sighandler_t)>);

impl SignalGuard {
    fn ignore(signos: &[libc::c_int]) -> Self {
        let saved = signos
            .iter()
            .map(|&signo| {
                let prev = unsafe { libc::signal(signo, libc::SIG_IGN) };
                (signo, prev)
            })
            .collect();
        SignalGuard(saved)
    }
}

impl Drop for SignalGuard {
    fn drop(&mut self) {
        for (signo, prev) in &self.0 {
            unsafe {
                libc::signal(*signo, *prev);
            }
        }
    }
}

fn start_sleep_session(dir: &tempfile::TempDir) -> (Engine, Arc<SessionHandle>) {
    let engine = Engine::open(dir.path()).unwrap();
    let invoke = |id: &str, method: &str, params: Value| {
        let response = engine.dispatch(Request {
            protocol: PROTOCOL_VERSION,
            request_id: id.into(),
            auth: None,
            method: method.into(),
            params,
        });
        assert!(response.ok, "{:?}", response.error);
        response.result.unwrap()
    };
    let workspace = invoke(
        "workspace",
        "workspace.register",
        json!({ "path": dir.path() }),
    );
    let session = invoke(
        "start",
        "session.start",
        json!({
            "workspaceId": workspace["id"],
            "command": "/bin/sh",
            "args": ["-c", "exec sleep 30"],
        }),
    );
    let handle = engine.sessions.lock().unwrap()[session["id"].as_str().unwrap()].clone();
    (engine, handle)
}

/// End-to-end over the daemon path: with SIGINT/SIGQUIT/SIGTERM ignored in
/// the daemon process (the detached-service launch context that caused
/// #273), a `sleep 30` session must still die when 0x03 is written to the
/// PTY master. Before the pre-exec reset, the ignored SIGINT survived exec
/// and the sleep ran to completion.
#[test]
fn ctrl_c_kills_session_child_within_two_seconds() {
    let _guard = SignalGuard::ignore(&[libc::SIGINT, libc::SIGQUIT, libc::SIGTERM]);
    let dir = tempfile::tempdir().unwrap();
    let (_engine, handle) = start_sleep_session(&dir);

    // Let the child exec and take the controlling terminal before the
    // interrupt byte arrives.
    std::thread::sleep(Duration::from_millis(200));
    write(&handle, b"\x03").unwrap();

    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while !handle.is_exited() && std::time::Instant::now() < deadline {
        std::thread::sleep(CHILD_POLL_INTERVAL);
    }
    if !handle.is_exited() {
        let _ = stop(&handle);
        panic!("session child survived 0x03 for 2s: SIGINT was inherited as ignored");
    }
}

/// Disposition-level proof through `spawn_pty` itself: with SIGPIPE ignored
/// in the daemon (Rust's runtime ignores SIGPIPE at startup, and the pty
/// crate's own pre-exec hook never reset it), the child's pipeline writer
/// must die by SIGPIPE (`seq` exit 141 = 128+13) instead of seeing EPIPE
/// with the signal ignored (exit 0 on macOS seq).
#[test]
fn child_recovers_default_sigint_and_sigpipe() {
    let _guard = SignalGuard::ignore(&[libc::SIGINT, libc::SIGQUIT, libc::SIGPIPE]);
    let dir = tempfile::tempdir().unwrap();
    let (master, _writer, mut reader, mut child) = spawn_pty(
        dir.path(),
        "ws-signal-test",
        "session-signal-test",
        &dir.path().to_string_lossy(),
        "/bin/bash",
        &[
            "-c".to_string(),
            "seq 1 500000 | head -1 >/dev/null; echo SEQ=${PIPESTATUS[0]}".to_string(),
        ],
        80,
        24,
        None,
        &[],
    )
    .unwrap();

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut collected = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => collected.extend_from_slice(&buf[..n]),
                Err(_) => break,
            }
            if collected.len() > 64 * 1024 {
                break;
            }
        }
        let _ = tx.send(collected);
    });
    let output = rx
        .recv_timeout(Duration::from_secs(5))
        .expect("child did not finish within 5s");
    let _ = child.wait();
    drop(master);

    let text = String::from_utf8_lossy(&output);
    assert!(
        text.contains("SEQ=141"),
        "seq was not killed by SIGPIPE (disposition inherited as ignored): {text:?}"
    );
}
