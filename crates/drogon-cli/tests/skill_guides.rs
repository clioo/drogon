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
use drogon_cli::skills::canonical_guides;
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
    let guides = canonical_guides();
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
    let guides = canonical_guides();
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
        "project remove",
        "agent-context",
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
    let names: Vec<&str> = envelope["topics"]
        .as_array()
        .expect("topics array")
        .iter()
        .map(|topic| topic["name"].as_str().expect("topic name"))
        .collect();
    assert_eq!(names, vec!["drogon-cli", "orchestration"]);
    for topic in envelope["topics"].as_array().expect("topics array") {
        assert!(topic["description"].as_str().is_some_and(|d| !d.is_empty()));
    }

    let output = run_cli(&data_dir, &["skills", "get", "--topic", "drogon-cli"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let text = stdout(&output);
    assert!(
        text.contains("# Drogon CLI"),
        "stdout head: {}",
        &text[..text.len().min(200)]
    );
    assert!(text.contains("terminal wait"), "stdout: {text}");

    let output = run_cli(
        &data_dir,
        &["--json", "skills", "get", "--topic", "orchestration"],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON get");
    assert_eq!(envelope["name"], Value::from("orchestration"));
    assert_eq!(envelope["full"], Value::from(false));
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
    let output = run_cli(&data_dir, &["skills", "get", "--topic", "nope"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(stdout(&output).is_empty(), "usage errors never emit stdout");
    let text = stderr(&output);
    assert!(text.contains("nope"), "stderr: {text}");
    assert!(text.contains("drogon-cli"), "stderr names topics: {text}");
}

/// Reference parity for the install flow's no-runtime-required surfaces:
/// selection help, dry-run argv, and the JSON restriction. A real npx spawn is
/// covered by the dry-run path only — CI never installs skills for real.
#[test]
fn skills_install_dry_run_and_selection_parity() {
    let (_hold, data_dir) = missing_data_dir();

    // No selection prints the picker-style help.
    let output = run_cli(&data_dir, &["skills", "install"]);
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let text = stdout(&output);
    assert!(
        text.starts_with("Choose one or more skills to install:"),
        "{text}"
    );
    assert!(
        text.contains("Usage: drogon-cli skills install --skill <name>"),
        "{text}"
    );

    // --all + --skill is rejected before anything runs.
    let output = run_cli(
        &data_dir,
        &["skills", "install", "--all", "--skill", "drogon-cli"],
    );
    assert_eq!(output.status.code(), Some(2));
    assert!(stderr(&output).contains("Use either --all or --skill, not both."));

    // Unknown skill names are usage errors listing the topics.
    let output = run_cli(&data_dir, &["skills", "update", "--skill", "nope"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(stderr(&output).contains("Unknown skill \"nope\". Available skills:"));

    // Dry run prints the exact argv without touching npx.
    let output = run_cli(
        &data_dir,
        &[
            "skills",
            "install",
            "--skill",
            "drogon-cli",
            "--agent",
            "universal",
            "--dry-run",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let text = stdout(&output);
    assert_eq!(
        text.trim_end(),
        "npx --yes skills add https://github.com/clioo/drogon --skill drogon-cli --global --agent universal -y\n\nRerun without --dry-run to install now."
    );

    // JSON dry run is the machine-readable form of the same answer.
    let output = run_cli(
        &data_dir,
        &[
            "--json",
            "skills",
            "update",
            "--all",
            "--local",
            "--dry-run",
        ],
    );
    assert_eq!(output.status.code(), Some(0), "stderr: {}", stderr(&output));
    let envelope: Value = serde_json::from_str(&stdout(&output)).expect("JSON dry run");
    assert_eq!(envelope["executed"], Value::from(false));
    assert_eq!(envelope["global"], Value::from(false));
    assert_eq!(
        envelope["command"],
        Value::from("npx --yes skills update drogon-cli orchestration --project -y")
    );

    // --json on a real run is refused: npx's own stream is not JSON.
    let output = run_cli(
        &data_dir,
        &[
            "--json",
            "skills",
            "install",
            "--skill",
            "drogon-cli",
            "--agent",
            "universal",
        ],
    );
    assert_eq!(output.status.code(), Some(2));
    assert!(stderr(&output).contains("--json only supports --dry-run"));
}

/// Install target validation, ported from the reference `resolveInstallAgentKeys`.
#[test]
fn skills_install_agent_validation_parity() {
    let (_hold, data_dir) = missing_data_dir();

    // A comma-only value parses to nothing and must not fall through to
    // detection.
    let output = run_cli(&data_dir, &["skills", "install", "--all", "--agent", ","]);
    assert_eq!(output.status.code(), Some(2));
    assert!(stderr(&output).contains("Missing required --agent"));

    // A value the skills CLI would drop is refused loudly.
    let output = run_cli(&data_dir, &["skills", "install", "--all", "--agent", "-y"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(stderr(&output).contains(
        "Invalid --agent value \"-y\". Pass agent names such as claude-code, codex, or universal."
    ));
}

fn repo_root() -> std::path::PathBuf {
    // CARGO_MANIFEST_DIR is crates/drogon-cli.
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn normalize(markdown: &str) -> String {
    markdown.replace("\r\n", "\n").replace('\r', "\n")
}

/// Ported reference contract: a stubbed topic's installable projection is the
/// guide's own frontmatter block (byte-identical discovery surface) plus the
/// stub body from `skill-stubs/<topic>.md` (LF, exactly one trailing newline).
/// This is the Rust-side twin of
/// `node scripts/generate-bundled-skill-guides.mjs --check`.
#[test]
fn skill_projections_compose_guide_frontmatter_with_stub_bodies() {
    let root = repo_root();
    let guides = canonical_guides();
    assert_eq!(guides.len(), 2);
    for guide in guides {
        let guide_source = normalize(
            &std::fs::read_to_string(root.join("skill-guides").join(format!("{}.md", guide.name)))
                .expect("guide source exists"),
        );
        assert_eq!(
            guide.markdown, guide_source,
            "embedded guide must match source"
        );

        let frontmatter_end = guide_source
            .find("\n---\n")
            .map(|index| index + "\n---\n".len())
            .expect("guide has a frontmatter block");
        let frontmatter = &guide_source[..frontmatter_end];
        let stub_body = normalize(
            &std::fs::read_to_string(root.join("skill-stubs").join(format!("{}.md", guide.name)))
                .expect("stub source exists"),
        );
        let body = format!("{}\n", stub_body.trim_matches('\n'));
        let projection =
            std::fs::read_to_string(root.join("skills").join(guide.name).join("SKILL.md"))
                .expect("installable SKILL.md projection exists");
        assert_eq!(
            projection,
            format!("{frontmatter}\n{body}"),
            "stale projection for {}; run node scripts/generate-bundled-skill-guides.mjs --write",
            guide.name
        );
        // The projection keeps the guide's routing frontmatter byte-identical.
        assert!(projection.starts_with(frontmatter));
        // Every topic is a stub topic, so the projection must NOT carry the
        // full guide body.
        assert!(!projection.contains(&guide_source[frontmatter_end..]));
    }
}
