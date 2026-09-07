//! V1 CLI argument-parity tests: the source CLI argument contract
//! (`docs/migration/parity-cli-argument-contract.md`, pinned legacy checkout
//! c9790628) ported one-to-one onto the candidate `drogon-cli` grammar at
//! source assertion strength.
//!
//! Each test names its source anchor. Tests marked RED BY DESIGN assert the
//! source behavior verbatim; the candidate lacks that behavior, so the test
//! fails behaviorally and the gap is recorded in
//! `docs/migration/verticals/V1/cli-parity-gaps.md` instead of weakening the
//! assertion.

use std::process::Command;

fn run(args: &[&str]) -> std::process::Output {
    let data_dir = tempfile::tempdir().expect("isolated parity data directory");
    Command::new(env!("CARGO_BIN_EXE_drogon-cli"))
        .args(args)
        .env("DROGON_DATA_DIR", data_dir.path())
        .env_remove("DROGON_DISPATCH_CAPABILITY")
        .output()
        .expect("spawn drogon-cli")
}

fn stdout(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn stderr(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

/// Source parse-level assertions (`src/cli/args.test.ts` parseArgs cases),
/// ported onto the equivalent candidate grammar positions.
mod tokenization {
    use super::parse_cli::parse;
    use drogon_cli::cli::{Command, WorkspaceAction};

    #[test]
    fn equals_form_splits_on_the_first_equals_so_values_may_contain_equals() {
        // Source: src/cli/args.test.ts:29-33 (`--value=a=b=c` -> `a=b=c`).
        let cli = parse(&["rpc", "m", "--params={\"q\":\"a=b\"}"]).expect("parse");
        let Command::Rpc { method, params } = cli.command else {
            panic!("wrong subcommand");
        };
        assert_eq!(method, "m");
        assert_eq!(params.as_deref(), Some("{\"q\":\"a=b\"}"));
    }

    #[test]
    fn equals_form_empty_value_is_an_empty_string_not_absence() {
        // Source: src/cli/args.test.ts:35-39 (`--value=` -> empty string).
        let cli = parse(&["rpc", "m", "--params="]).expect("parse");
        let Command::Rpc { params, .. } = cli.command else {
            panic!("wrong subcommand");
        };
        assert_eq!(params.as_deref(), Some(""));
    }

    #[test]
    fn equals_form_is_the_only_way_a_value_may_start_with_double_dash() {
        // Source: src/cli/args.test.ts:22-27 (`--text=--help` -> `--help`).
        let cli = parse(&["rpc", "m", "--params=--help"]).expect("parse");
        let Command::Rpc { params, .. } = cli.command else {
            panic!("wrong subcommand");
        };
        assert_eq!(params.as_deref(), Some("--help"));
    }

    #[test]
    fn repeated_non_repeatable_flag_last_value_wins() {
        // RED BY DESIGN.
        // Source: src/cli/args.test.ts:179-183 (a second occurrence of an
        // ordinary string flag overwrites: `--workspace old --workspace new`
        // parses to `new`). The candidate clap grammar refuses multiple
        // occurrences of `--name` outright, so this source-strength assertion
        // fails behaviorally; recorded as gap V1-G1.
        let cli = parse(&["workspace", "add", "/tmp/x", "--name", "a", "--name", "b"])
            .expect("source contract: last value wins on a repeated non-repeatable flag");
        let Command::Workspace {
            action: WorkspaceAction::Add { name, .. },
        } = cli.command
        else {
            panic!("wrong subcommand");
        };
        assert_eq!(name.as_deref(), Some("b"));
    }

    #[test]
    fn flag_followed_by_flag_shaped_token_stores_implicit_boolean() {
        // RED BY DESIGN.
        // Source: src/cli/args.ts:70-72 (a non-boolean flag whose next token
        // starts with `--` stores boolean true; args.test.ts:49-54 exercises
        // it at parse level), i.e. the only type inference the source parser
        // performs. The candidate requires a value for `--data-dir` and
        // aborts the parse instead; recorded as gap V1-G2.
        let cli = parse(&["--data-dir", "--json", "status"])
            .expect("source contract: implicit boolean for a flag followed by a flag token");
        assert!(cli.json);
        assert!(matches!(cli.command, Command::Status));
    }
}

mod parse_cli {
    use clap::Parser as _;
    use drogon_cli::cli::Cli;

    pub fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        Cli::try_parse_from(std::iter::once("drogon-cli").chain(args.iter().copied()))
    }
}

/// Unknown command / unknown flag refusals and did-you-mean suggestion text
/// (source `validateCommandAndFlags` + `command-suggestion.ts`).
mod unknown_command_and_flag {
    use super::{run, stderr, stdout};

    #[test]
    fn unknown_flag_refused_on_a_subcommand() {
        // Source: src/cli/args.test.ts:297-303 (unknown command-specific flag
        // is rejected as invalid_argument). parser.rs only covers `status`;
        // this covers the depth-2 surface.
        let output = run(&["workspace", "list", "--bogus"]);
        assert_eq!(output.status.code(), Some(2));
        assert!(stdout(&output).is_empty(), "usage errors never emit JSON");
    }

    #[test]
    fn unknown_pre_command_flag_refused() {
        // Source: src/cli/args.test.ts:49-54 end state (a mistyped global
        // flag before the command never reaches dispatch).
        let output = run(&["--jso", "status"]);
        assert_eq!(output.status.code(), Some(2));
        assert!(stdout(&output).is_empty());
    }

    #[test]
    fn unknown_command_refused_at_depth_two() {
        // Source: src/cli/args.ts:230-238 (unknown command -> invalid_argument
        // "Unknown command: ..."). The candidate refuses nested unknown verbs.
        let output = run(&["terminal", "cread"]);
        assert_eq!(output.status.code(), Some(2));
        assert!(stdout(&output).is_empty());
    }

    #[test]
    fn unknown_command_error_suggests_the_intended_command() {
        // Source: src/cli/args.test.ts:328-347 (error data.suggestions names
        // the intended path; nextSteps carry a did-you-mean recovery hint).
        let output = run(&["statuz"]);
        assert_eq!(output.status.code(), Some(2));
        let text = stderr(&output);
        assert!(text.contains("tip:"), "missing suggestion tip: {text}");
        assert!(text.contains("'status'"), "missing intended verb: {text}");
    }

    #[test]
    fn unknown_flag_error_suggests_the_intended_flag() {
        // Source: src/cli/args.test.ts:305-326 (nextSteps suggest the
        // near-miss flag `--force`). Candidate: clap tip names `--session`.
        let output = run(&["terminal", "read", "--sesion", "s", "--incarnation", "i"]);
        assert_eq!(output.status.code(), Some(2));
        let text = stderr(&output);
        assert!(text.contains("'--session'"), "missing flag tip: {text}");
    }

    #[test]
    fn unknown_flag_error_enumerates_the_valid_flags() {
        // RED BY DESIGN.
        // Source: src/cli/args.test.ts:305-326 + src/cli/command-suggestion.ts:122
        // (unknownFlagData ALWAYS appends a `Valid flags: ...` next step, even
        // with zero suggestions). The candidate prints only a usage line;
        // recorded as gap V1-G3.
        let output = run(&["terminal", "read", "--sesion", "s", "--incarnation", "i"]);
        assert_eq!(output.status.code(), Some(2));
        assert!(
            stderr(&output).contains("Valid flags:"),
            "source contract: unknown-flag errors enumerate the valid flags"
        );
    }

    #[test]
    fn unknown_depth_two_subcommand_suggests_similar_commands() {
        // Source: src/cli/command-suggestion.test.ts:86-89 (closer matches
        // rank first; same-depth candidates are suggested).
        let output = run(&["terminal", "cread"]);
        assert_eq!(output.status.code(), Some(2));
        let text = stderr(&output);
        assert!(text.contains("'create'"), "missing tip: {text}");
        assert!(text.contains("'read'"), "missing tip: {text}");
    }
}

/// Global-flag semantics: allowed on every command without per-command
/// declaration, value flags require a non-empty value (source
/// `args.ts:250-261`, `args.test.ts:272-295`).
mod global_flags {
    use super::{run, stderr, stdout};

    #[test]
    fn global_value_flag_empty_equals_value_refused() {
        // Source: src/cli/args.test.ts:291-295 (`--flag=` on a required-value
        // global flag is rejected).
        let output = run(&["--request-id=", "status"]);
        assert_eq!(output.status.code(), Some(2));
        assert!(stdout(&output).is_empty());
        assert!(stderr(&output).contains("--request-id"));
    }

    #[test]
    fn global_value_flag_missing_value_token_refused() {
        // Source: src/cli/args.ts:250-254 (a global value flag with no value
        // is rejected: "Flag --<name> requires a value.").
        let output = run(&["status", "--data-dir"]);
        assert_eq!(output.status.code(), Some(2));
        assert!(stderr(&output).contains("--data-dir"));
    }

    #[test]
    fn global_flag_accepted_after_subcommand_without_declaration() {
        // Source: src/cli/args.test.ts:272-283 (global flags pass validation
        // even when the command spec omits them). With no runtime reachable
        // the invocation must fail as transport (exit 1), never as usage (2).
        let output = run(&["status", "--request-id", "abc-123"]);
        assert_eq!(output.status.code(), Some(1), "stderr: {}", stderr(&output));
        assert!(stderr(&output).contains("unverifiable"));
    }
}

/// Command-boundary detection: a pre-command value flag consumes its value
/// even when that value is itself a registered command or group, and the
/// real command still resolves (source `cli-argument-boundary.ts:68-96`,
/// `args.test.ts:89-124`).
mod command_boundary {
    use super::{run, stderr};

    #[test]
    fn pre_command_value_consumed_and_command_still_resolves() {
        // Source: src/cli/args.test.ts:89-94 (preserves existing pre-command
        // selector values). The value must feed `--data-dir`, not the grammar.
        let base = tempfile::tempdir().expect("tempdir");
        let missing = base.path().join("does-not-exist");
        let output = run_with_env_data_dir(
            &["--data-dir", missing.to_str().expect("utf8 path"), "status"],
            base.path(),
        );
        assert_eq!(output.status.code(), Some(1), "stderr: {}", stderr(&output));
        let text = stderr(&output);
        assert!(text.contains("data directory does not exist"), "{text}");
        assert!(
            text.contains("does-not-exist"),
            "pre-command value not consumed as --data-dir: {text}"
        );
    }

    #[test]
    fn value_matching_a_registered_verb_consumed_as_value() {
        // Source: src/cli/args.test.ts:106-114 (`--environment status ...`
        // keeps `status` as the VALUE; the command resolves after it).
        let output = run(&["--data-dir", "status", "status"]);
        assert_eq!(output.status.code(), Some(1), "stderr: {}", stderr(&output));
        assert!(
            stderr(&output).contains("reachable at status"),
            "verb-named value must be consumed as the flag value: {}",
            stderr(&output)
        );
    }

    #[test]
    fn value_matching_a_command_group_consumed_as_value() {
        // Source: src/cli/args.test.ts:116-124 (`--environment worktree
        // status` resolves the command `status`, value `worktree`).
        let output = run(&["--data-dir", "worktree", "status"]);
        assert_eq!(output.status.code(), Some(1), "stderr: {}", stderr(&output));
        assert!(
            stderr(&output).contains("reachable at worktree"),
            "group-named value must be consumed as the flag value: {}",
            stderr(&output)
        );
    }

    #[test]
    fn bare_double_dash_does_not_block_command_resolution() {
        // RED BY DESIGN.
        // Source: src/shared/cli-argument-boundary.test.ts:21 (a bare `--`
        // token has no terminator meaning; the following token still starts
        // the command path, expected index 1). The candidate treats `--` as a
        // hard escape and refuses `-- status` with a usage error; recorded as
        // gap V1-G4.
        let output = run(&["--", "status"]);
        assert_eq!(
            output.status.code(),
            Some(1),
            "source contract: the command after a bare `--` still resolves; stderr: {}",
            stderr(&output)
        );
        assert!(stderr(&output).contains("unverifiable"));
    }

    fn run_with_env_data_dir(args: &[&str], data_dir: &std::path::Path) -> std::process::Output {
        std::process::Command::new(env!("CARGO_BIN_EXE_drogon-cli"))
            .args(args)
            .env("DROGON_DATA_DIR", data_dir)
            .env_remove("DROGON_DISPATCH_CAPABILITY")
            .output()
            .expect("spawn drogon-cli")
    }
}

/// Passthrough semantics: tokens past the candidate's argv boundary
/// (`terminal create ... -- COMMAND ARGS`) must bypass flag validation
/// entirely, exactly like the source `argumentMode: 'passthrough'` command
/// (`args.ts:135-146`, catalog command `claude-teams`).
mod passthrough {
    use super::{run, stderr};

    #[test]
    fn flag_shaped_tokens_after_the_argv_boundary_are_not_validated() {
        let output = run(&[
            "terminal",
            "create",
            "--workspace",
            "w",
            "--",
            "python",
            "-u",
            "--flag-like",
            "value",
        ]);
        assert_eq!(
            output.status.code(),
            Some(1),
            "flag-shaped argv after `--` must not be a usage error: {}",
            stderr(&output)
        );
        assert!(stderr(&output).contains("unverifiable"));
    }
}

/// Help resolution: two independent triggers, neither gated by validation
/// (source `args.ts:81-89`).
mod help_resolution {
    use super::{run, stdout};

    #[test]
    fn help_as_first_token_resolves_the_remaining_path() {
        // Source: resolveHelpPath rule 1 (commandPath[0] === 'help').
        let output = run(&["help", "terminal"]);
        assert!(output.status.success());
        assert!(
            stdout(&output).contains("create"),
            "help must target the remaining path 'terminal': {}",
            stdout(&output)
        );
    }

    #[test]
    fn help_flag_short_circuits_per_command_validation() {
        // Source: resolveHelpPath rule 2 (flags.has('help')) — `--help` is
        // global and never gated by required-flag validation, so it must work
        // even where required flags are missing (terminal create).
        let output = run(&["terminal", "create", "--help"]);
        assert!(output.status.success());
        assert!(stdout(&output).contains("--workspace"));
    }
}
