//! Bundled skill guides: every documented command really exists.
//!
//! Guide-writing contract (kept in sync with `skills.rs`): any single-backtick
//! span that starts with `drogon-cli ` must be a complete, literally parseable
//! invocation against the real clap grammar — concrete values for numeric
//! flags (`--timeout-ms 60000`, `--consumer-generation 3`) and value enums
//! (`--for exited`, `--kind final-report`), single-token placeholders
//! (`<ID>`, `<TEXT>`) elsewhere, no `--help`/`--version` (clap answers those
//! with a help error, not a parse success). Prose names without the
//! `drogon-cli ` prefix (`` `terminal wait` ``, `` `--timeout-ms` ``, bare
//! `` `drogon-cli` ``) are ignored by the extractor. Fenced blocks show only
//! output samples, but a fenced line starting with `drogon-cli ` is validated
//! too so examples cannot rot there either. Parse-only: nothing executes.

#![cfg(unix)]

mod common;

use clap::{CommandFactory, Parser as _};
use drogon_cli::cli::Cli;
use drogon_cli::skills::all_guides;
use serde_json::Value;

use common::{run_cli, stderr, stdout};

/// The guide contract above, as code: single-backtick spans only, fenced
/// blocks removed first so output samples never interfere.
fn backticked_spans(markdown: &str) -> Vec<String> {
    let mut without_fences = String::new();
    let mut in_fence = false;
    for line in markdown.split('\n') {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if !in_fence {
            without_fences.push_str(line);
            without_fences.push('\n');
        }
    }
    let mut spans = Vec::new();
    let mut rest = without_fences.as_str();
    while let Some(open) = rest.find('`') {
        let after_open = &rest[open + 1..];
        // A fence run that survived stripping (inline `` ``code`` ``) is not
        // an invocation span; the guides avoid that shape entirely.
        if let Some(stripped) = after_open.strip_prefix('`') {
            rest = stripped;
            continue;
        }
        let Some(close) = after_open.find('`') else {
            break;
        };
        spans.push(after_open[..close].to_string());
        rest = &after_open[close + 1..];
    }
    spans
}

fn fenced_cli_lines(markdown: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let mut in_fence = false;
    for line in markdown.split('\n') {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            let trimmed = line.trim();
            if trimmed.starts_with("drogon-cli ") {
                lines.push(trimmed.to_string());
            }
        }
    }
    lines
}

fn expect_parse(invocation: &str) {
    let args: Vec<&str> = std::iter::once("drogon-cli")
        .chain(invocation.split_whitespace().skip(1))
        .collect();
    Cli::try_parse_from(&args)
        .unwrap_or_else(|err| panic!("guide invocation does not parse: {invocation:?}: {err}"));
}

#[test]
fn every_backticked_cli_invocation_parses() {
    let guides = all_guides().expect("embedded guides parse");
    assert_eq!(guides.len(), 2, "exactly the two contracted guides");
    let mut checked = 0;
    for guide in &guides {
        for span in backticked_spans(guide.markdown) {
            if span == "drogon-cli" || !span.starts_with("drogon-cli ") {
                continue;
            }
            expect_parse(&span);
            checked += 1;
        }
        for line in fenced_cli_lines(guide.markdown) {
            expect_parse(&line);
            checked += 1;
        }
    }
    assert!(
        checked >= 30,
        "the extractor must be checking real coverage, got {checked}"
    );
}

#[test]
fn guides_cover_the_contracted_surface() {
    let guides = all_guides().expect("embedded guides parse");
    let cli = guides
        .iter()
        .find(|guide| guide.name == "drogon-cli")
        .expect("drogon-cli guide");
    let orch = guides
        .iter()
        .find(|guide| guide.name == "orchestration")
        .expect("orchestration guide");
    for needle in [
        "terminal wait",
        "worktree create",
        "project add",
        "harness start",
        "session.agent-state.v1",
    ] {
        assert!(
            cli.markdown.contains(needle),
            "drogon-cli guide is missing {needle:?}"
        );
    }
    for needle in [
        "run-create",
        "task-create",
        "worker-start",
        "check --wait",
        "final-report",
        "ask",
    ] {
        assert!(
            orch.markdown.contains(needle),
            "orchestration guide is missing {needle:?}"
        );
    }
}

#[test]
fn root_help_points_at_skills_get_first() {
    let mut buffer = Vec::new();
    Cli::command()
        .write_help(&mut buffer)
        .expect("render root help");
    let help = String::from_utf8(buffer).expect("help is UTF-8");
    let skills = help.find("skills get").expect("help mentions skills get");
    let status = help.find("status").expect("help lists status");
    assert!(
        skills < status,
        "skills get must come before any command: {help:?}"
    );
    assert!(help.contains("skills"), "help lists the skills command");
}

/// Skills commands never touch the runtime: this data directory does not
/// exist, and both verbs must still exit 0.
fn missing_data_dir() -> (tempfile::TempDir, std::path::PathBuf) {
    let hold = tempfile::tempdir().expect("hold tempdir");
    let missing = hold.path().join("no-runtime-here");
    assert!(!missing.exists());
    (hold, missing)
}

#[test]
fn skills_list_and_get_work_without_a_runtime() {
    let (_hold, data_dir) = missing_data_dir();

    let output = run_cli(&data_dir, &["skills", "list"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let text = stdout(&output);
    assert!(text.contains("drogon-cli"), "stdout: {text}");
    assert!(text.contains("orchestration"), "stdout: {text}");

    let output = run_cli(&data_dir, &["--json", "skills", "list"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON list");
    let names: Vec<&str> = envelope["guides"]
        .as_array()
        .expect("guides array")
        .iter()
        .map(|guide| guide["name"].as_str().expect("guide name"))
        .collect();
    assert_eq!(names, vec!["drogon-cli", "orchestration"]);

    let output = run_cli(&data_dir, &["skills", "get", "drogon-cli"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let text = stdout(&output);
    assert!(
        text.contains("# Drogon CLI"),
        "stdout head: {}",
        &text[..text.len().min(200)]
    );
    assert!(text.contains("terminal wait"), "stdout: {text}");

    let output = run_cli(&data_dir, &["--json", "skills", "get", "orchestration"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON get");
    assert_eq!(envelope["name"], Value::from("orchestration"));
    assert!(
        envelope["description"]
            .as_str()
            .is_some_and(|d| !d.is_empty()),
        "JSON get carries the description: {envelope}"
    );
    assert!(
        envelope["markdown"]
            .as_str()
            .is_some_and(|md| md.contains("# Drogon Native Orchestration")),
        "JSON get carries the full markdown: {envelope}"
    );
}

#[test]
fn skills_get_unknown_topic_is_a_usage_error() {
    let (_hold, data_dir) = missing_data_dir();
    let output = run_cli(&data_dir, &["skills", "get", "nope"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(stdout(&output).is_empty(), "usage errors never emit stdout");
    let text = stderr(&output);
    assert!(text.contains("nope"), "stderr: {text}");
    assert!(text.contains("drogon-cli"), "stderr names topics: {text}");
}
