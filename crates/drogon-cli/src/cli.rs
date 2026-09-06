//! Argparse surface: the frozen first-slice verbs, plus client-side input
//! validation that maps to exit code 2 before any I/O happens.

use std::path::PathBuf;

use clap::{Parser, Subcommand};

use crate::error::CliError;

#[derive(Parser, Debug)]
#[command(
    name = "drogon-cli",
    version,
    about = "Command-line client for the Drogon runtime (protocol v1)"
)]
pub struct Cli {
    /// Drogon data directory (default: DROGON_DATA_DIR, else platform default)
    #[arg(long, global = true, value_name = "PATH")]
    pub data_dir: Option<PathBuf>,

    /// Print one JSON envelope on stdout instead of human text
    #[arg(long, global = true)]
    pub json: bool,

    /// Caller-chosen request id so a mutation can be replayed byte-equivalently
    #[arg(long, global = true, value_name = "ID")]
    pub request_id: Option<String>,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Show runtime identity, protocol version and capabilities
    Status,
    Workspace {
        #[command(subcommand)]
        action: WorkspaceAction,
    },
    Terminal {
        #[command(subcommand)]
        action: TerminalAction,
    },
    /// Harness discovery and launch (requires service capabilities
    /// harness.catalog.v1 / harness.launch.v1)
    Harness {
        #[command(subcommand)]
        action: HarnessAction,
    },
    /// Diagnostic passthrough for a raw protocol method
    Rpc {
        /// Method name, e.g. session.read
        method: String,
        /// JSON object of params (default {})
        #[arg(long, value_name = "JSON")]
        params: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
pub enum HarnessAction {
    /// List harnesses discovered on the service's execution host
    List,
    /// Start a session running a harness; the service resolves the host
    /// executable, so there is nothing to point at a local binary
    Start {
        #[arg(long, value_name = "ID")]
        workspace: String,
        /// Harness id as advertised by `harness list` (server-authoritative;
        /// aliases like `agy` are resolved by the service)
        #[arg(long, value_name = "ID")]
        harness: String,
        /// Exact opaque model id; never guessed, never defaulted
        #[arg(long, value_name = "MODEL-ID")]
        model: Option<String>,
        /// Pi-only provider selection (server validates adapter policy)
        #[arg(long, value_name = "PROVIDER")]
        provider: Option<String>,
        /// Adapter-specific effort value (server validates against the
        /// adapter's documented CLI surface)
        #[arg(long, value_name = "VALUE")]
        effort: Option<String>,
        /// Literal initial prompt: forwarded as one JSON string, never shell
        /// interpolated, never @-file expanded
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        prompt: Option<String>,
        #[arg(long, value_enum, default_value_t = PermissionModeArg::Inherit)]
        permission_mode: PermissionModeArg,
    },
}

/// Permission mode mirroring the wire enum; the service maps it to
/// adapter-specific flags.
#[derive(Debug, Clone, Copy, Default, clap::ValueEnum)]
pub enum PermissionModeArg {
    #[default]
    Inherit,
    Unattended,
}

impl PermissionModeArg {
    pub fn as_wire(self) -> &'static str {
        match self {
            PermissionModeArg::Inherit => "inherit",
            PermissionModeArg::Unattended => "unattended",
        }
    }
}

#[derive(Subcommand, Debug)]
pub enum WorkspaceAction {
    /// Register an existing directory as a workspace
    Add {
        /// Path to an existing directory
        path: PathBuf,
        #[arg(long, value_name = "NAME")]
        name: Option<String>,
    },
    /// List registered workspaces
    List,
}

#[derive(Subcommand, Debug)]
pub enum TerminalAction {
    /// Start a PTY session running COMMAND with ARGS (after `--`)
    Create {
        #[arg(long, value_name = "ID")]
        workspace: String,
        /// Everything after `--`: argv[0] is the executable, rest are args.
        /// No shell interpolation happens anywhere.
        #[arg(last = true, value_name = "COMMAND")]
        command: Vec<String>,
    },
    /// List sessions, optionally scoped to one workspace
    List {
        #[arg(long, value_name = "ID")]
        workspace: Option<String>,
    },
    /// Read bounded output from a session
    Read {
        #[arg(long, value_name = "ID")]
        session: String,
        #[arg(long, value_name = "TOKEN")]
        incarnation: String,
        /// Absolute byte offset to read from (protocol default 0)
        #[arg(long, value_name = "N")]
        cursor: Option<u64>,
        /// Maximum bytes to return (protocol default and maximum 65536)
        #[arg(long, value_name = "BYTES")]
        limit_bytes: Option<u64>,
    },
    /// Write UTF-8 text to a session (encoded to base64 exactly once)
    Send {
        #[arg(long, value_name = "ID")]
        session: String,
        #[arg(long, value_name = "TOKEN")]
        incarnation: String,
        #[arg(long, value_name = "TEXT")]
        text: String,
    },
    /// Resize a session's PTY
    Resize {
        #[arg(long, value_name = "ID")]
        session: String,
        #[arg(long, value_name = "TOKEN")]
        incarnation: String,
        #[arg(long)]
        cols: u16,
        #[arg(long)]
        rows: u16,
    },
    /// Stop a session and wait for the observed exit
    Close {
        #[arg(long, value_name = "ID")]
        session: String,
        #[arg(long, value_name = "TOKEN")]
        incarnation: String,
    },
}

impl Cli {
    /// Client-side validation: anything provably wrong before contacting the
    /// runtime is a usage error (exit 2), not a round trip.
    pub fn validate(&self) -> Result<(), CliError> {
        if let Some(request_id) = &self.request_id {
            validate_request_id(request_id)?;
        }
        match &self.command {
            Command::Workspace { action } => match action {
                WorkspaceAction::Add { path, name } => {
                    if path.as_os_str().is_empty() {
                        return Err(CliError::Usage("workspace add requires a PATH".into()));
                    }
                    if let Some(name) = name {
                        require_nonempty("name", name)?;
                    }
                }
                WorkspaceAction::List => {}
            },
            Command::Terminal { action } => match action {
                TerminalAction::Create { workspace, command } => {
                    require_nonempty("workspace", workspace)?;
                    if command.is_empty() {
                        return Err(CliError::Usage(
                            "terminal create requires `-- COMMAND [ARGS...]`; \
                             everything after -- becomes argv with no shell interpolation"
                                .into(),
                        ));
                    }
                    for arg in command {
                        if arg.as_bytes().contains(&0) {
                            return Err(CliError::Usage(
                                "terminal create arguments must not contain NUL bytes".into(),
                            ));
                        }
                    }
                }
                TerminalAction::List { workspace } => {
                    if let Some(workspace) = workspace {
                        require_nonempty("workspace", workspace)?;
                    }
                }
                TerminalAction::Read {
                    session,
                    incarnation,
                    limit_bytes,
                    ..
                } => {
                    require_nonempty("session", session)?;
                    require_nonempty("incarnation", incarnation)?;
                    if let Some(limit) = limit_bytes
                        && !(1..=65536).contains(limit)
                    {
                        return Err(CliError::Usage("--limit-bytes must be in 1..=65536".into()));
                    }
                }
                TerminalAction::Send {
                    session,
                    incarnation,
                    ..
                } => {
                    require_nonempty("session", session)?;
                    require_nonempty("incarnation", incarnation)?;
                }
                TerminalAction::Resize {
                    session,
                    incarnation,
                    cols,
                    rows,
                } => {
                    require_nonempty("session", session)?;
                    require_nonempty("incarnation", incarnation)?;
                    validate_dimension("cols", *cols)?;
                    validate_dimension("rows", *rows)?;
                }
                TerminalAction::Close {
                    session,
                    incarnation,
                } => {
                    require_nonempty("session", session)?;
                    require_nonempty("incarnation", incarnation)?;
                }
            },
            Command::Harness { action } => match action {
                HarnessAction::List => {}
                HarnessAction::Start {
                    workspace,
                    harness,
                    model,
                    provider,
                    effort,
                    prompt,
                    ..
                } => {
                    require_nonempty("workspace", workspace)?;
                    validate_opaque_id("harness", harness)?;
                    for (name, value) in
                        [("model", model), ("provider", provider), ("effort", effort)]
                    {
                        if let Some(value) = value {
                            validate_preference(name, value)?;
                        }
                    }
                    if let Some(prompt) = prompt {
                        if prompt.trim().is_empty() {
                            return Err(CliError::Usage(
                                "--prompt must contain visible text".into(),
                            ));
                        }
                        if prompt.len() > 32768 {
                            return Err(CliError::Usage(
                                "--prompt must be at most 32768 UTF-8 bytes".into(),
                            ));
                        }
                        if prompt.contains('\0') {
                            return Err(CliError::Usage("--prompt must not contain NUL".into()));
                        }
                    }
                }
            },
            Command::Rpc { method, params } => {
                validate_method_name(method)?;
                if let Some(params) = params {
                    let value: serde_json::Value = serde_json::from_str(params).map_err(|err| {
                        CliError::Usage(format!("--params is not valid JSON: {err}"))
                    })?;
                    if !value.is_object() {
                        return Err(CliError::Usage("--params must be a JSON object".into()));
                    }
                }
            }
            Command::Status => {}
        }
        Ok(())
    }
}

fn require_nonempty(flag: &str, value: &str) -> Result<(), CliError> {
    if value.is_empty() {
        return Err(CliError::Usage(format!("--{flag} must not be empty")));
    }
    Ok(())
}

fn validate_dimension(flag: &str, value: u16) -> Result<(), CliError> {
    if !(1..=1000).contains(&value) {
        return Err(CliError::Usage(format!("--{flag} must be in 1..=1000")));
    }
    Ok(())
}

fn validate_request_id(request_id: &str) -> Result<(), CliError> {
    if request_id.is_empty() || request_id.len() > 128 || request_id.chars().any(char::is_control) {
        return Err(CliError::Usage(
            "--request-id must be 1..=128 characters without control characters".into(),
        ));
    }
    Ok(())
}

/// Harness ids are server-authoritative (additive future harnesses must keep
/// working), so only shape is checked here: nonempty, bounded, printable.
fn validate_opaque_id(flag: &str, value: &str) -> Result<(), CliError> {
    if value.is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        return Err(CliError::Usage(format!(
            "--{flag} must be 1..=128 characters without control characters"
        )));
    }
    Ok(())
}

/// Model/provider/effort are opaque preference values. Shape-only checks that
/// mirror the service's own validation; adapter policy (effort enums,
/// Pi-only provider) stays server-side on purpose.
fn validate_preference(flag: &str, value: &str) -> Result<(), CliError> {
    if value.is_empty() {
        return Err(CliError::Usage(format!("--{flag} must not be empty")));
    }
    if value.len() > 512 {
        return Err(CliError::Usage(format!(
            "--{flag} must be at most 512 UTF-8 bytes"
        )));
    }
    if value.chars().any(char::is_control) {
        return Err(CliError::Usage(format!(
            "--{flag} must not contain control characters"
        )));
    }
    // A leading dash would be a flag injection, not a model id.
    if value.starts_with('-') {
        return Err(CliError::Usage(format!(
            "--{flag} takes the exact value verbatim; values starting with '-' are refused"
        )));
    }
    Ok(())
}

fn validate_method_name(method: &str) -> Result<(), CliError> {
    if method.is_empty() || method.len() > 128 || method.chars().any(char::is_control) {
        return Err(CliError::Usage(
            "rpc METHOD must be 1..=128 characters without control characters".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        Cli::try_parse_from(std::iter::once("drogon-cli").chain(args.iter().copied()))
    }

    #[test]
    fn cli_definitions_are_well_formed() {
        Cli::command().debug_assert();
    }

    #[test]
    fn status_with_global_flags_in_both_positions() {
        let cli = parse(&["--json", "--data-dir", "/tmp/d", "status"]).unwrap();
        assert!(cli.json);
        assert_eq!(
            cli.data_dir.as_deref(),
            Some(std::path::Path::new("/tmp/d"))
        );
        assert!(matches!(cli.command, Command::Status));

        let cli = parse(&["status", "--json", "--data-dir", "/tmp/d"]).unwrap();
        assert!(cli.json);
    }

    #[test]
    fn terminal_create_captures_argv_after_double_dash() {
        let cli = parse(&[
            "terminal",
            "create",
            "--workspace",
            "ws1",
            "--",
            "cargo",
            "run",
            "--release",
            "--features",
            "big name",
        ])
        .unwrap();
        let Command::Terminal {
            action: TerminalAction::Create { workspace, command },
        } = cli.command
        else {
            panic!("wrong subcommand");
        };
        assert_eq!(workspace, "ws1");
        assert_eq!(
            command,
            vec!["cargo", "run", "--release", "--features", "big name"]
        );
    }

    #[test]
    fn terminal_create_without_command_is_a_usage_error() {
        let cli = parse(&["terminal", "create", "--workspace", "ws1"]).unwrap();
        assert!(matches!(cli.validate(), Err(CliError::Usage(_))));
    }

    #[test]
    fn workspace_add_keeps_paths_with_spaces_verbatim() {
        let cli = parse(&[
            "workspace",
            "add",
            "/tmp/dir with spaces/sub dir",
            "--name",
            "My Space",
        ])
        .unwrap();
        let Command::Workspace {
            action: WorkspaceAction::Add { path, name },
        } = &cli.command
        else {
            panic!("wrong subcommand");
        };
        assert_eq!(path, &PathBuf::from("/tmp/dir with spaces/sub dir"));
        assert_eq!(name.as_deref(), Some("My Space"));
        assert!(cli.validate().is_ok());
    }

    #[test]
    fn resize_rejects_out_of_range_dimensions_as_usage() {
        let cli = parse(&[
            "terminal",
            "resize",
            "--session",
            "s",
            "--incarnation",
            "i",
            "--cols",
            "0",
            "--rows",
            "24",
        ])
        .unwrap();
        assert!(matches!(cli.validate(), Err(CliError::Usage(_))));

        let cli = parse(&[
            "terminal",
            "resize",
            "--session",
            "s",
            "--incarnation",
            "i",
            "--cols",
            "1001",
            "--rows",
            "24",
        ])
        .unwrap();
        assert!(matches!(cli.validate(), Err(CliError::Usage(_))));

        let cli = parse(&[
            "terminal",
            "resize",
            "--session",
            "s",
            "--incarnation",
            "i",
            "--cols",
            "120",
            "--rows",
            "40",
        ])
        .unwrap();
        assert!(cli.validate().is_ok());
    }

    #[test]
    fn rpc_requires_a_json_object_params() {
        let cli = parse(&["rpc", "session.read", "--params", "{\"sessionId\":\"s\"}"]).unwrap();
        assert!(cli.validate().is_ok());

        let cli = parse(&["rpc", "session.read", "--params", "[1]"]).unwrap();
        assert!(matches!(cli.validate(), Err(CliError::Usage(_))));

        let cli = parse(&["rpc", "session.read", "--params", "{broken"]).unwrap();
        assert!(matches!(cli.validate(), Err(CliError::Usage(_))));
    }

    #[test]
    fn request_id_is_validated_like_the_envelope() {
        let cli = parse(&["--request-id", "abc-123", "status"]).unwrap();
        assert!(cli.validate().is_ok());

        let cli = parse(&["--request-id", "", "status"]).unwrap();
        assert!(matches!(cli.validate(), Err(CliError::Usage(_))));

        let long = "x".repeat(129);
        let cli = parse(&["--request-id", &long, "status"]).unwrap();
        assert!(matches!(cli.validate(), Err(CliError::Usage(_))));

        let cli = parse(&["--request-id", "bad\nid", "status"]).unwrap();
        assert!(matches!(cli.validate(), Err(CliError::Usage(_))));
    }

    #[test]
    fn empty_flag_values_are_usage_errors() {
        let cli = parse(&["terminal", "read", "--session", "", "--incarnation", "tok"]).unwrap();
        assert!(matches!(cli.validate(), Err(CliError::Usage(_))));
    }

    #[test]
    fn unknown_flags_are_argparse_errors() {
        assert!(parse(&["status", "--screen"]).is_err());
        assert!(parse(&["bogus"]).is_err());
    }
}

#[cfg(test)]
mod harness_tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        Cli::try_parse_from(std::iter::once("drogon-cli").chain(args.iter().copied()))
    }

    #[test]
    fn permission_mode_defaults_to_inherit_and_maps_to_wire() {
        let cli = parse(&["harness", "start", "--workspace", "w", "--harness", "pi"]).unwrap();
        let Command::Harness {
            action: HarnessAction::Start {
                permission_mode, ..
            },
        } = cli.command
        else {
            panic!("wrong subcommand");
        };
        assert!(matches!(permission_mode, PermissionModeArg::Inherit));
        assert_eq!(permission_mode.as_wire(), "inherit");
        assert_eq!(PermissionModeArg::Unattended.as_wire(), "unattended");
    }

    #[test]
    fn permission_mode_rejects_unknown_values() {
        assert!(
            parse(&[
                "harness",
                "start",
                "--workspace",
                "w",
                "--harness",
                "pi",
                "--permission-mode",
                "yolo"
            ])
            .is_err()
        );
        let cli = parse(&[
            "harness",
            "start",
            "--workspace",
            "w",
            "--harness",
            "pi",
            "--permission-mode",
            "unattended",
        ])
        .unwrap();
        assert!(cli.validate().is_ok());
    }

    #[test]
    fn model_values_starting_with_dash_are_refused_as_usage() {
        // Space form: clap itself refuses the flag-shaped value (exit 2).
        assert!(
            parse(&[
                "harness",
                "start",
                "--workspace",
                "w",
                "--harness",
                "claude",
                "--model",
                "-experimental",
            ])
            .is_err()
        );
        // Equals form reaches the CLI's own validation and is also a usage error.
        let cli = parse(&[
            "harness",
            "start",
            "--workspace=w",
            "--harness=claude",
            "--model=-experimental",
        ])
        .unwrap();
        let err = cli.validate().unwrap_err();
        assert!(err.to_string().contains("verbatim"), "err: {err}");
    }

    #[test]
    fn preference_shape_checks() {
        let empty = parse(&[
            "harness",
            "start",
            "--workspace",
            "w",
            "--harness",
            "pi",
            "--model",
            "",
        ])
        .unwrap();
        assert!(empty.validate().is_err());

        let long = "m".repeat(513);
        let too_long = parse(&[
            "harness",
            "start",
            "--workspace",
            "w",
            "--harness",
            "pi",
            "--provider",
            &long,
        ])
        .unwrap();
        assert!(too_long.validate().is_err());

        let control = parse(&[
            "harness",
            "start",
            "--workspace",
            "w",
            "--harness",
            "pi",
            "--effort",
            "hi\ngh",
        ])
        .unwrap();
        assert!(control.validate().is_err());

        let ok = parse(&[
            "harness",
            "start",
            "--workspace",
            "w",
            "--harness",
            "pi",
            "--effort",
            "xhigh",
        ])
        .unwrap();
        assert!(ok.validate().is_ok());
    }

    #[test]
    fn harness_id_is_shape_checked_not_enumerated() {
        // Server-authoritative: an unknown-but-well-formed id passes CLI
        // validation and becomes a server-side not_found.
        let cli = parse(&[
            "harness",
            "start",
            "--workspace",
            "w",
            "--harness",
            "future-harness-9",
        ])
        .unwrap();
        assert!(cli.validate().is_ok());

        let empty = parse(&["harness", "start", "--workspace", "w", "--harness", ""]).unwrap();
        assert!(empty.validate().is_err());

        let control = parse(&[
            "harness",
            "start",
            "--workspace",
            "w",
            "--harness",
            "pi\nagy",
        ])
        .unwrap();
        assert!(control.validate().is_err());
    }

    #[test]
    fn prompt_is_literal_and_allows_flag_like_text() {
        let cli = parse(&[
            "harness",
            "start",
            "--workspace",
            "w",
            "--harness",
            "opencode",
            "--prompt",
            "--looks-like-a-flag but is not",
        ])
        .unwrap();
        assert!(cli.validate().is_ok(), "flag-like prompts must parse");

        let blank = parse(&[
            "harness",
            "start",
            "--workspace",
            "w",
            "--harness",
            "pi",
            "--prompt",
            "   ",
        ])
        .unwrap();
        assert!(blank.validate().is_err());

        let huge = "x".repeat(32769);
        let too_long = parse(&[
            "harness",
            "start",
            "--workspace",
            "w",
            "--harness",
            "pi",
            "--prompt",
            &huge,
        ])
        .unwrap();
        assert!(too_long.validate().is_err());
    }
}
