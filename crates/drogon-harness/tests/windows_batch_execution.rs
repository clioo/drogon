//! Execution-level (not just plan-level) coverage for the `.cmd`/`.bat`
//! adapter: actually spawns a fixture script and inspects what it received.
//! Windows-only — `is_script_launcher` is `cfg!(windows)`-gated so a `.cmd`
//! path is never treated as a batch launcher on any other host, and this
//! Linux CI host has no Windows target to run these on regardless (verified
//! manually; see the worker report for this vertical).
#![cfg(windows)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use drogon_harness::{HarnessId, HarnessLaunchRequest, PermissionMode, plan_launch};

fn request(id: HarnessId) -> HarnessLaunchRequest {
    HarnessLaunchRequest {
        harness_id: id,
        model: None,
        effort: None,
        provider: None,
        prompt: None,
        permission_mode: PermissionMode::Inherit,
        headless: false,
        resume: false,
        agent_session_id: None,
        agent_session_transcript_path: None,
    }
}

/// Spaces, parens (deliberately exempt from the unsafe-character set) and
/// non-ASCII — the shape of path this adapter must survive byte-for-byte
/// (`C:\Program Files (x86)\...`-style installs).
fn tricky_fixture_dir(temp: &Path) -> PathBuf {
    let dir = temp.join("space (x86) café 日本語");
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// An echo-only `.cmd` fixture: it appends each argument it receives, one
/// per line, to `capture.txt` next to itself. There is no `%*` and no
/// `call` anywhere in it, so a received argument can only ever become an
/// inert text line — this fixture must never execute anything it is handed.
/// `chcp 65001` first: without it, `>>` redirection encodes in the console
/// OEM codepage and non-ASCII args (the Unicode prompt below) would mangle
/// or fail UTF-8 comparison for reasons unrelated to the adapter.
fn write_capture_fixture(dir: &Path) -> PathBuf {
    let script = dir.join("capture.cmd");
    fs::write(
        &script,
        "@echo off\r\n\
         chcp 65001>nul\r\n\
         :loop\r\n\
         if \"%~1\"==\"\" goto done\r\n\
         echo %~1>>\"%~dp0capture.txt\"\r\n\
         shift\r\n\
         goto loop\r\n\
         :done\r\n",
    )
    .unwrap();
    script
}

#[test]
fn literal_args_survive_a_tricky_path_and_a_safe_prompt() {
    let temp = tempfile::tempdir().unwrap();
    let dir = tricky_fixture_dir(temp.path());
    let script = write_capture_fixture(&dir);
    let capture_file = dir.join("capture.txt");
    assert!(!capture_file.exists());

    let mut req = request(HarnessId::Claude);
    req.prompt = Some("safe (parenthetical) café 日本語 prompt".into());
    let plan = plan_launch(&req, &script).unwrap();

    let status = Command::new(&plan.command)
        .args(&plan.args)
        .status()
        .unwrap();
    assert!(status.success());

    let captured = fs::read_to_string(&capture_file).unwrap();
    assert_eq!(
        captured.lines().collect::<Vec<_>>(),
        ["--", req.prompt.as_deref().unwrap()],
        "the script's own %1/%2 must see exactly what plan_launch computed, unmangled"
    );
}

#[test]
fn pi_prompt_is_refused_at_plan_time_with_scoped_message() {
    let temp = tempfile::tempdir().unwrap();
    let dir = tricky_fixture_dir(temp.path());
    let script = write_capture_fixture(&dir);
    let capture_file = dir.join("capture.txt");

    let mut req = request(HarnessId::Pi);
    req.prompt = Some("a perfectly safe single-line prompt".into());
    let err = plan_launch(&req, &script).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    assert!(
        err.message.contains("session.write"),
        "must name the real fix (post-spawn stdin delivery): got {:?}",
        err.message
    );

    assert!(
        !capture_file.exists(),
        "a plan-time refusal must never reach a spawn"
    );
}

#[test]
fn metacharacter_payload_is_refused_at_plan_time_with_no_side_effects() {
    let temp = tempfile::tempdir().unwrap();
    let dir = tricky_fixture_dir(temp.path());
    let script = write_capture_fixture(&dir);
    let capture_file = dir.join("capture.txt");

    let mut req = request(HarnessId::Claude);
    req.prompt = Some("safe prefix & calc.exe".into());
    assert!(plan_launch(&req, &script).is_err());

    assert!(
        !capture_file.exists(),
        "a refused metacharacter payload must leave the canary file untouched"
    );
}
