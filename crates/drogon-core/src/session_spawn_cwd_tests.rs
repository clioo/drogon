//! Regression for the `$HOME` cwd fallback (audit finding: a session could
//! run in the owner's home directory under a workspace that no longer
//! exists).
//!
//! `spawn_child_unix` used to mirror portable-pty's `CommandBuilder`: a cwd
//! that failed its `is_dir()` test was silently replaced with `$HOME`. A
//! workspace whose folder was deleted externally therefore started a real
//! shell/agent in `~` while the session row and its sidebar card still named
//! the dead worktree. The spawn now carries the caller's cwd verbatim, so a
//! folder that disappears between admission and spawn fails the spawn.
//!
//! These tests drive the private spawn directly, bypassing admission: the
//! point is that the *spawn layer itself* can never substitute a directory.

#![cfg(unix)]

use std::path::Path;
use std::time::{Duration, Instant};

use super::spawn_pty;

fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

#[test]
fn a_missing_cwd_fails_the_spawn_instead_of_running_in_home() {
    let data_dir = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let removed = root.path().join("worktree-that-is-gone");
    std::fs::create_dir(&removed).unwrap();
    std::fs::remove_dir(&removed).unwrap();

    let spawned = spawn_pty(
        data_dir.path(),
        "ws-1",
        "session-1",
        removed.to_str().unwrap(),
        "/bin/sh",
        &args(&["-c", "exit 0"]),
        80,
        24,
        None,
        &[],
    );

    match spawned {
        Ok((_master, _writer, _reader, mut child)) => {
            // The bug's shape: the spawn "succeeded" because the child was
            // moved to $HOME. Kill it before failing so the regression run
            // leaves nothing behind.
            let _ = child.kill();
            let _ = child.wait();
            panic!("a session was spawned for a cwd that does not exist");
        }
        Err(error) => {
            assert_eq!(error.code, "io_error", "message: {}", error.message);
            assert!(
                error.message.contains("spawn failed"),
                "the failure must name the spawn: {}",
                error.message
            );
        }
    }
}

#[test]
fn an_existing_cwd_is_still_the_childs_working_directory() {
    let data_dir = tempfile::tempdir().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    let marker = workspace.path().join("child-cwd.txt");
    // `pwd -P` resolves symlinks, so compare against the canonical root:
    // macOS puts /var behind /private/var and the assertion has to match the
    // directory the kernel hands the child.
    let expected = std::fs::canonicalize(workspace.path()).unwrap();
    let script = format!("pwd -P > {}", marker.display());

    let (_master, _writer, _reader, mut child) = spawn_pty(
        data_dir.path(),
        "ws-1",
        "session-2",
        workspace.path().to_str().unwrap(),
        "/bin/sh",
        &args(&["-c", &script]),
        80,
        24,
        None,
        &[],
    )
    .expect("a real workspace must still spawn");

    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Ok(text) = std::fs::read_to_string(&marker) {
            assert_eq!(text.trim(), expected.to_str().unwrap());
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the fixture child never wrote its working directory"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    let _ = child.wait();
}

/// The regression this module exists for must stay pinned to a real directory
/// check: a path that exists but is a file is not a working directory either.
#[test]
fn a_file_cwd_is_not_accepted_as_a_working_directory() {
    let data_dir = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("not-a-directory");
    std::fs::write(&file, "x").unwrap();
    assert!(Path::new(&file).is_file());

    let spawned = spawn_pty(
        data_dir.path(),
        "ws-1",
        "session-3",
        file.to_str().unwrap(),
        "/bin/sh",
        &args(&["-c", "exit 0"]),
        80,
        24,
        None,
        &[],
    );
    match spawned {
        Ok((_master, _writer, _reader, mut child)) => {
            let _ = child.kill();
            let _ = child.wait();
            panic!("a session was spawned with a file as its cwd");
        }
        Err(error) => assert_eq!(error.code, "io_error", "message: {}", error.message),
    }
}
