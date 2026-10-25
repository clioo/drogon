//! Source spellings from src/cli/specs/orchestration.ts at c9790628.
//! These aliases preserve native scope/credential requirements, not legacy authority.

use clap::Parser;
use drogon_cli::cli::{Cli, Command};
use drogon_cli::orchestration_cli::{MessageKindArg, OrchestrationCommand};

fn parse(args: &[&str]) -> OrchestrationCommand {
    let cli = Cli::try_parse_from(std::iter::once("drogon-cli").chain(args.iter().copied()))
        .expect("source flag spelling must parse");
    let Command::Orchestration { command } = cli.command else {
        panic!("expected orchestration command");
    };
    *command
}

#[test]
fn worker_done_source_spelling_preserves_dispatch_binding() {
    let OrchestrationCommand::Send { kind, actor, .. } = parse(&[
        "orchestration",
        "send",
        "--type",
        "worker_done",
        "--subject",
        "done",
        "--outcome",
        "succeeded",
        "--run",
        "run-1",
        "--task-id",
        "task-1",
        "--dispatch-id",
        "dispatch-1",
    ]) else {
        panic!("expected send")
    };
    assert_eq!(kind, MessageKindArg::FinalReport);
    assert_eq!(actor.task.as_deref(), Some("task-1"));
    assert_eq!(actor.dispatch.as_deref(), Some("dispatch-1"));
}

#[test]
fn send_accepts_an_unquoted_multiword_body_as_the_final_flag() {
    let OrchestrationCommand::Send { body, outcome, .. } = parse(&[
        "orchestration",
        "send",
        "--kind",
        "worker_done",
        "--subject",
        "done",
        "--outcome",
        "succeeded",
        "--body",
        "Report",
        "outcome",
        "is",
        "succeeded",
        "-",
        "files",
        "modified",
    ]) else {
        panic!("expected send")
    };
    assert_eq!(
        body,
        Some(vec![
            "Report".to_string(),
            "outcome".to_string(),
            "is".to_string(),
            "succeeded".to_string(),
            "-".to_string(),
            "files".to_string(),
            "modified".to_string(),
        ])
    );
    assert!(outcome.is_some());
}

#[test]
fn source_reply_id_is_the_question_not_the_request_envelope() {
    let OrchestrationCommand::Reply { question, .. } = parse(&[
        "orchestration",
        "reply",
        "--id",
        "question-1",
        "--body",
        "approved",
    ]) else {
        panic!("expected reply")
    };
    assert_eq!(question, "question-1");
}

#[test]
fn source_ask_csv_options_are_distinct_from_literal_repeatable_options() {
    let command = parse(&[
        "orchestration",
        "ask",
        "--question",
        "continue?",
        "--options",
        "yes, no,,",
    ]);
    assert!(matches!(command, OrchestrationCommand::Ask { .. }));
    assert!(
        Cli::try_parse_from([
            "drogon-cli",
            "orchestration",
            "ask",
            "--question",
            "continue?",
            "--options",
            "yes,no",
            "--option",
            "later",
        ])
        .is_err()
    );
}

#[test]
fn source_ask_timeout_accepts_exact_numeric_forms_and_clamps_at_thirty_minutes() {
    for (raw, expected) in [
        ("1e3", 1000),
        ("1000.0", 1000),
        ("1800001", 1_800_000),
        ("9007199254740991", 1_800_000),
    ] {
        let OrchestrationCommand::Ask { timeout_ms, .. } = parse(&[
            "orchestration",
            "ask",
            "--question",
            "continue?",
            "--timeout-ms",
            raw,
        ]) else {
            panic!("expected ask")
        };
        assert_eq!(timeout_ms, expected);
    }
}

#[test]
fn source_ask_uses_ten_minute_default_without_timeout_flag() {
    let OrchestrationCommand::Ask { timeout_ms, .. } =
        parse(&["orchestration", "ask", "--question", "continue?"])
    else {
        panic!("expected ask")
    };
    assert_eq!(timeout_ms, 600_000);
}

#[test]
fn source_task_create_flags_parse_without_changing_native_scope_requirements() {
    let OrchestrationCommand::TaskCreate {
        instructions,
        title,
        ..
    } = parse(&[
        "orchestration",
        "task-create",
        "--run",
        "run-1",
        "--coordinator-id",
        "coord-1",
        "--consumer-generation",
        "1",
        "--spec",
        "Implement the change",
        "--task-title",
        "Fix",
        "--deps",
        "[\"task_123456abcdef\"]",
    ])
    else {
        panic!("expected task-create")
    };
    assert_eq!(instructions, "Implement the change");
    assert_eq!(title.as_deref(), Some("Fix"));
}

#[test]
fn source_run_show_id_is_supported() {
    let OrchestrationCommand::RunShow { run, .. } =
        parse(&["orchestration", "run-show", "--id", "run-1"])
    else {
        panic!("expected run-show")
    };
    assert_eq!(run, "run-1");
}

#[test]
fn source_check_types_is_forwarded_for_native_validation() {
    let OrchestrationCommand::Check { kinds, .. } = parse(&[
        "orchestration",
        "check",
        "--types",
        "worker_done,escalation",
        "--wait",
        "--timeout-ms",
        "1000",
    ]) else {
        panic!("expected check")
    };
    assert_eq!(kinds.as_deref(), Some("worker_done,escalation"));
}

#[test]
fn aliases_follow_the_existing_last_value_wins_contract() {
    let OrchestrationCommand::Send { kind, .. } = parse(&[
        "orchestration",
        "send",
        "--type",
        "worker_done",
        "--kind",
        "status",
        "--subject",
        "done",
    ]) else {
        panic!("expected send")
    };
    assert_eq!(kind, MessageKindArg::Status);
}

/// `--body` is the greedy tail, so a structured flag written after it used to
/// land in the message text: a `worker_done` sent with
/// `--body <report> --result '{"testsPassed":7}'` reported `ok` while sending
/// no result metadata and appending `--result {...}` to the body. The CLI now
/// refuses that shape by name instead of dropping it.
#[test]
fn a_structured_flag_after_body_is_refused_instead_of_becoming_text() {
    for flag in [
        "--result",
        "--outcome",
        "--payload",
        "--thread-id",
        "--to",
        "--subject",
        "--kind",
    ] {
        let cli = Cli::try_parse_from([
            "drogon-cli",
            "orchestration",
            "send",
            "--kind",
            "worker_done",
            "--subject",
            "done",
            "--outcome",
            "succeeded",
            "--body",
            "report body",
            flag,
        ])
        .expect("the shape parses: --body takes the rest");
        let error = cli
            .validate()
            .expect_err("a swallowed structured flag must be refused");
        let message = format!("{error}");
        assert!(
            message.contains(flag) && message.contains("must precede --body"),
            "the refusal names the flag and the fix: {message}"
        );
    }
}

#[test]
fn structured_flags_before_body_still_validate() {
    let cli = Cli::try_parse_from([
        "drogon-cli",
        "orchestration",
        "send",
        "--kind",
        "worker_done",
        "--subject",
        "done",
        "--outcome",
        "succeeded",
        "--result",
        "{\"testsPassed\":7}",
        "--body",
        "report body --result stays text here",
    ])
    .expect("the supported order parses");
    cli.validate().expect("the supported order validates");
}
