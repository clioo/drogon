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
fn source_ask_uses_ten_minute_default_without_timeout_flag() {
    let OrchestrationCommand::Ask { timeout_ms, .. } =
        parse(&["orchestration", "ask", "--question", "continue?"])
    else {
        panic!("expected ask")
    };
    assert_eq!(timeout_ms, 600_000);
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
