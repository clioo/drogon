//! Argv-boundary tests that run the real binary with no server: help/version
//! exit codes, usage-error exit codes, and the `-- COMMAND ARGS` boundary.

use std::process::Command;

fn run(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_drogon-cli"))
        .args(args)
        .env_remove("DROGON_DATA_DIR")
        .output()
        .expect("spawn drogon-cli")
}

fn stdout(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn stderr(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

#[test]
fn help_exits_zero() {
    let output = run(&["--help"]);
    assert!(output.status.success());
    let text = stdout(&output);
    assert!(text.contains("status"));
    assert!(text.contains("workspace"));
    assert!(text.contains("terminal"));
    assert!(text.contains("rpc"));
}

#[test]
fn version_exits_zero() {
    let output = run(&["--version"]);
    assert!(output.status.success());
    assert_eq!(
        stdout(&output).trim(),
        format!("drogon-cli {}", env!("CARGO_PKG_VERSION"))
    );
}

#[test]
fn unknown_verb_exits_two() {
    let output = run(&["bogus"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(stdout(&output).is_empty());
    assert!(!stderr(&output).is_empty());
}

#[test]
fn unknown_flag_exits_two_even_with_json() {
    let output = run(&["status", "--json", "--screen"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(stdout(&output).is_empty(), "usage errors never emit JSON");
}

#[test]
fn terminal_create_requires_the_double_dash_separator() {
    let output = run(&["terminal", "create", "--workspace", "w", "cargo", "run"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(stdout(&output).is_empty());
}

#[test]
fn missing_required_flag_exits_two() {
    let output = run(&["terminal", "create"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(stderr(&output).contains("--workspace"));
}

#[test]
fn rpc_without_params_is_well_formed_enough_to_reach_validation() {
    // No server: this must fail at the connection stage (exit 1,
    // unverifiable), never with a usage error (exit 2).
    let output = run(&["rpc", "status"]);
    assert_eq!(output.status.code(), Some(1), "stderr: {}", stderr(&output));
    assert!(stderr(&output).contains("unverifiable"));
}
