//! Argparse surface: the frozen first-slice verbs, plus client-side input
//! validation that maps to exit code 2 before any I/O happens.

use std::path::PathBuf;

use clap::{Parser, Subcommand};

use crate::error::CliError;
use crate::orchestration_cli::OrchestrationCommand;

#[derive(Parser, Debug)]
#[command(
    name = "drogon-cli",
    version,
    about = "Start with `drogon-cli skills get --topic drogon-cli` for the version-matched agent guide.\nCommand-line client for the Drogon runtime (protocol v1)",
    args_override_self = true,
    override_usage = "drogon-cli [OPTIONS] <COMMAND>\nValid flags: --data-dir, --help, --json, --request-id, --retry-request"
)]
pub struct Cli {
    /// Drogon data directory (default: DROGON_DATA_DIR, else platform default)
    ///
    /// Accepts an optional value: a following flag-shaped token leaves the
    /// implicit-presence marker, which `validate` then refuses as
    /// `Flag --data-dir requires a value.`
    #[arg(
        long,
        global = true,
        value_name = "PATH",
        num_args = 0..=1,
        default_missing_value = IMPLICIT_FLAG_PRESENCE
    )]
    pub data_dir: Option<PathBuf>,

    /// Print one JSON envelope on stdout instead of human text
    #[arg(long, global = true)]
    pub json: bool,

    /// Caller-chosen request id so a mutation can be replayed byte-equivalently
    #[arg(
        long,
        global = true,
        value_name = "ID",
        num_args = 0..=1,
        default_missing_value = IMPLICIT_FLAG_PRESENCE
    )]
    pub request_id: Option<String>,

    /// Alias for --request-id for retry workflows; giving both requires
    /// equal values (a contradiction is a usage error)
    #[arg(
        long,
        global = true,
        value_name = "ID",
        num_args = 0..=1,
        default_missing_value = IMPLICIT_FLAG_PRESENCE
    )]
    pub retry_request: Option<String>,

    #[command(subcommand)]
    pub command: Command,
}

/// Stands in for the source parser's implicit boolean `true` (`args.ts:70-72`).
/// NUL is unambiguous: `execve` argv can never contain it, so no real value
/// can collide with the marker.
const IMPLICIT_FLAG_PRESENCE: &str = "\u{0}";

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Show runtime identity, protocol version and capabilities
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli status\nValid flags: --data-dir, --help, --json, --request-id, --retry-request"
    )]
    Status,
    /// Print the machine-readable command schema for agents (local, no
    /// runtime needed)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli agent-context\nValid flags: --data-dir, --help, --json, --request-id, --retry-request"
    )]
    AgentContext,
    /// Workspaces: registered directories that own terminal sessions
    Workspace {
        #[command(subcommand)]
        action: WorkspaceAction,
    },
    /// Projects: a git repository or a plain folder that owns Worktrees
    Project {
        #[command(subcommand)]
        action: ProjectAction,
    },
    /// Worktrees of a git Project (or the implicit one of a folder Project)
    Worktree {
        #[command(subcommand)]
        action: WorktreeAction,
    },
    /// Terminals: PTY sessions with a stable id plus an incarnation token
    Terminal {
        #[command(subcommand)]
        action: TerminalAction,
    },
    /// Embedded browser pane, driven through the daemon's desktop command
    /// relay (requires the service capability browser.relay.v1 and a
    /// connected Drogon desktop; without one the call fails
    /// desktop_not_connected inside its timeout)
    Browser {
        #[command(subcommand)]
        action: BrowserAction,
    },
    /// Harness discovery and launch (requires service capabilities
    /// harness.catalog.v1 / harness.launch.v1)
    Harness {
        #[command(subcommand)]
        action: HarnessAction,
    },
    /// Cron automations: create, list, run now, and run history (requires
    /// the service capability automation.v1)
    Automation {
        #[command(subcommand)]
        action: AutomationAction,
    },
    /// Scoped Bot self-management: a Bot lists/creates/edits/enables/
    /// disables/deletes/tests its OWN automations and monitors (requires
    /// the service capability bot.self.v1; every mutation records the
    /// acting Bot's id as audit actor and denies cross-Bot scope, stale
    /// revisions and scope escape)
    Bot {
        #[command(subcommand)]
        action: BotAction,
    },
    /// Mentu recipes (requires the service capability mentu.v1): inspect
    /// whether the optional Mentu environment (pinned runtime + workspace
    /// recipes) is really present on this host, and open the workspace's
    /// Mentu tab in the running Drogon desktop so a human can see the
    /// recipe.
    Mentu {
        #[command(subcommand)]
        action: MentuAction,
    },
    /// The work graph (`.drogon/graph.json`): read the human-owned `intent`
    /// half and the daemon-owned `state` half, compile a node plus its
    /// transitive dependencies into the Mentu recipe the system runs, and
    /// resume/retry a single node without redoing the graph (requires the
    /// service capability graph.v1).
    Graph {
        #[command(subcommand)]
        action: GraphAction,
    },
    /// Meetings: the owner's own Write That Down Markdown notes, indexed
    /// read-only from this host's notes directory (requires the service
    /// capability meetings.v1). There is no API and no credential in this
    /// path: the notes are files, so a Bot discovers conversations the same
    /// way the desktop surface lists them.
    Meeting {
        #[command(subcommand)]
        action: MeetingAction,
    },
    /// Integration secrets: seal a value into the daemon's 0600 store or
    /// list configured names (user-only; values are read from stdin for
    /// `set`, never echoed, and never appear in argv; requires the service
    /// capability bot.secrets.v1). Granting a name to a Bot is
    /// `drogon-cli bot grant-secret`.
    Secrets {
        #[command(subcommand)]
        action: SecretsAction,
    },
    /// Native coordination (requires the service capability
    /// orchestration.native.v1; the preflight decides before any method)
    Orchestration {
        #[command(subcommand)]
        command: Box<OrchestrationCommand>,
    },
    /// Service-internal callbacks (hook events from harness settings files).
    /// Hidden: not a user verb, only invoked by generated hook commands.
    #[command(hide = true)]
    Internal {
        #[command(subcommand)]
        action: InternalAction,
    },
    /// Diagnostic passthrough for a raw protocol method
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli rpc <METHOD> [--params <JSON>]\nValid flags: --data-dir, --help, --json, --params, --request-id, --retry-request"
    )]
    Rpc {
        /// Method name, e.g. session.read
        method: String,
        /// JSON object of params (default {})
        #[arg(long, value_name = "JSON")]
        params: Option<String>,
    },
    /// Version-matched agent guides bundled with this CLI (local, no runtime needed)
    Skills {
        #[command(subcommand)]
        action: SkillsAction,
    },
}

#[derive(Subcommand, Debug)]
pub enum MeetingAction {
    /// List indexed meeting notes, newest first, with the folder they came
    /// from and the honest reason when there are none
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli meeting list [--limit <N>] [--offset <N>]\nValid flags: --data-dir, --help, --json, --limit, --offset, --request-id, --retry-request"
    )]
    List {
        /// Page size (1..=200, default 50)
        #[arg(long, value_name = "N")]
        limit: Option<u32>,
        /// Skip this many meetings before the page starts
        #[arg(long, value_name = "N")]
        offset: Option<u32>,
    },
    /// Read one transcript by the id `meeting list` printed
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli meeting read --id <ID> [--max-bytes <N>]\nValid flags: --data-dir, --help, --id, --json, --max-bytes, --request-id, --retry-request"
    )]
    Read {
        /// Transcript id, exactly as printed by `meeting list`
        #[arg(long, value_name = "ID", allow_hyphen_values = true)]
        id: String,
        /// Byte budget for the returned content (1..=5242880)
        #[arg(long, value_name = "N")]
        max_bytes: Option<u64>,
    },
}

#[derive(Subcommand, Debug)]
pub enum MentuAction {
    /// Report honestly whether the optional Mentu environment is installed
    /// on this host: the pinned runtime's presence and lock state, and —
    /// with `--workspace` — how many recipes that workspace's `.mentu/recipes`
    /// actually holds. Never an optimistic guess.
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli mentu status [--workspace <ID>]\nValid flags: --data-dir, --help, --json, --request-id, --retry-request, --workspace"
    )]
    Status {
        /// Also report this workspace's recipe inventory
        #[arg(long, value_name = "ID")]
        workspace: Option<String>,
    },
    /// Open (or focus) the workspace's Mentu tab in the connected Drogon
    /// desktop, optionally focused on one recipe. Requires the service
    /// capability browser.relay.v1 plus a connected Drogon desktop; the
    /// desktop's own verdict is the result, so an open that did not happen
    /// is reported as a failure.
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli mentu open --workspace <ID> [--recipe <ID>] [--timeout-ms <MS>]\nValid flags: --data-dir, --help, --json, --recipe, --request-id, --retry-request, --timeout-ms, --workspace"
    )]
    Open {
        #[arg(long, value_name = "ID")]
        workspace: String,
        /// Recipe id to select in the Mentu tab (`mentu status --workspace`
        /// lists the ids this workspace exposes)
        #[arg(long, value_name = "ID")]
        recipe: Option<String>,
        /// Bounded wait for the desktop to confirm the tab, in ms (1..=25000)
        #[arg(long, value_name = "MS", default_value_t = 15_000)]
        timeout_ms: u64,
    },
    /// Start a recipe through the daemon's own execution path (the same
    /// `mentu.run` call the desktop's Run button uses; there is no second
    /// engine). Requires the service capability mentu.v1 AND an existing
    /// approval bound to the recipe's exact current bytes: this verb never
    /// approves anything. Omit `--approval` to use the recipe's pending
    /// approval (`mentu.pending_approval`); an edited recipe therefore
    /// refuses with `mentu_approval_required` until a human approves the
    /// new content.
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli mentu run --workspace <ID> --recipe <ID> [--approval <ID>] [--follow] [--timeout-ms <MS>]\nValid flags: --approval, --data-dir, --follow, --help, --json, --recipe, --request-id, --retry-request, --timeout-ms, --workspace"
    )]
    Run {
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "ID")]
        recipe: String,
        /// Exact approval id to consume. Omit to use the recipe's pending
        /// approval; a supplied id is still verified by the daemon (it must
        /// name this workspace/recipe and be unconsumed).
        #[arg(long, value_name = "ID")]
        approval: Option<String>,
        /// Poll until the run reaches a terminal status (succeeded, failed,
        /// cancelled, unavailable) instead of returning as soon as it starts
        #[arg(long)]
        follow: bool,
        /// Bound for `--follow`, in ms (1..=3600000; default 900000). A
        /// blown budget exits 1 with the last observed status.
        #[arg(long, value_name = "MS", default_value_t = 900_000)]
        timeout_ms: u64,
    },
    /// Report one run once, by the daemon's run id: status, per-step
    /// outcome, evidence paths and counts. Safe to poll from an agent.
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli mentu run-status --run <ID>\nValid flags: --data-dir, --help, --json, --request-id, --retry-request, --run"
    )]
    RunStatus {
        #[arg(long, value_name = "ID")]
        run: String,
    },
    /// List a workspace's runs, newest first (default 50, max 200)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli mentu runs --workspace <ID> [--limit <N>]\nValid flags: --data-dir, --help, --json, --limit, --request-id, --retry-request, --workspace"
    )]
    Runs {
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "N")]
        limit: Option<u32>,
    },
    /// Cancel a running run by its daemon run id. Works no matter who
    /// started it, so a run an agent began stays stoppable from here (or
    /// from the Mentu tab's Cancel).
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli mentu cancel --run <ID>\nValid flags: --data-dir, --help, --json, --request-id, --retry-request, --run"
    )]
    Cancel {
        #[arg(long, value_name = "ID")]
        run: String,
    },
    /// Rerun the steps of a past run that did not succeed, through the
    /// runtime's own `resume` (the same run directory, new attempts
    /// appended). Unlike `mentu run` this starts no new recipe run.
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli mentu resume --run <ID> [--follow] [--timeout-ms <MS>]\nValid flags: --data-dir, --follow, --help, --json, --request-id, --retry-request, --run, --timeout-ms"
    )]
    Resume {
        #[arg(long, value_name = "ID")]
        run: String,
        /// Poll until the relaunched run reaches a terminal status
        #[arg(long)]
        follow: bool,
        /// Bound for `--follow`, in ms (1..=3600000; default 900000)
        #[arg(long, value_name = "MS", default_value_t = 900_000)]
        timeout_ms: u64,
    },
    /// Rerun exactly ONE step of a past run, through the runtime's own
    /// `retry-step <run-id> <label>`. The failing node is fixed without
    /// redoing the rest of the graph.
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli mentu retry-step --run <ID> --step <LABEL> [--follow] [--timeout-ms <MS>]\nValid flags: --data-dir, --follow, --help, --json, --request-id, --retry-request, --run, --step, --timeout-ms"
    )]
    RetryStep {
        #[arg(long, value_name = "ID")]
        run: String,
        /// Exact step label to rerun (the graph compiler emits the node id
        /// as its label)
        #[arg(long, value_name = "LABEL")]
        step: String,
        /// Poll until the relaunched run reaches a terminal status
        #[arg(long)]
        follow: bool,
        /// Bound for `--follow`, in ms (1..=3600000; default 900000)
        #[arg(long, value_name = "MS", default_value_t = 900_000)]
        timeout_ms: u64,
    },
}

#[derive(Subcommand, Debug)]
pub enum GraphAction {
    /// Read the whole graph: the human-owned `intent` half and the
    /// daemon-owned `state` half, projected from real observation (a
    /// `running` node is only reported when a live process is confirmed;
    /// loss of contact is `unverifiable`).
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli graph read --workspace <ID>\nValid flags: --data-dir, --help, --json, --request-id, --retry-request, --workspace"
    )]
    Read {
        #[arg(long, value_name = "ID")]
        workspace: String,
    },
    /// Replace the human-owned `intent` half from a JSON file (or stdin with
    /// `-`). The daemon-owned `state` half is preserved; a payload that
    /// carries `state` is refused, never silently ignored.
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli graph write-intent --workspace <ID> --file <PATH|->\nValid flags: --data-dir, --file, --help, --json, --request-id, --retry-request, --workspace"
    )]
    WriteIntent {
        #[arg(long, value_name = "ID")]
        workspace: String,
        /// Path to a JSON intent file, or `-` for stdin
        #[arg(long, value_name = "PATH")]
        file: String,
    },
    /// Compile a node (or explicit selection) plus its transitive
    /// dependencies into a Mentu recipe and validate it with the pinned
    /// runtime's own `check`/`doctor --strict`. Writes the compiled recipe
    /// to `.mentu/recipes`; runs nothing.
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli graph compile --workspace <ID> (--node <ID> | --nodes <ID,ID>) [--output <PATH>]\nValid flags: --data-dir, --help, --json, --node, --nodes, --output, --request-id, --retry-request, --workspace"
    )]
    Compile {
        #[arg(long, value_name = "ID")]
        workspace: String,
        /// Target node: the node plus its transitive dependencies
        #[arg(long, value_name = "ID", conflicts_with = "nodes")]
        node: Option<String>,
        /// Explicit selection: comma-separated node ids, still closed over
        /// their dependencies
        #[arg(long, value_name = "ID,ID")]
        nodes: Option<String>,
        /// Write the emitted recipe JSON to this path (default: stdout)
        #[arg(long, value_name = "PATH")]
        output: Option<PathBuf>,
    },
    /// Compile and run a node's subgraph through the daemon's one execution
    /// path (`mentu.run` on the approved, validated recipe). Refuses a graph
    /// the runtime would not validate, and a node that already has a live
    /// run.
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli graph run --workspace <ID> --node <ID> [--follow] [--timeout-ms <MS>]\nValid flags: --data-dir, --follow, --help, --json, --node, --request-id, --retry-request, --timeout-ms, --workspace"
    )]
    Run {
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "ID")]
        node: String,
        /// Poll until the run reaches a terminal status
        #[arg(long)]
        follow: bool,
        /// Bound for `--follow`, in ms (1..=3600000; default 900000)
        #[arg(long, value_name = "MS", default_value_t = 900_000)]
        timeout_ms: u64,
    },
    /// Resume the node's latest run (rerun only the steps that did not
    /// succeed) without redoing the graph.
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli graph resume --workspace <ID> --node <ID> [--follow] [--timeout-ms <MS>]\nValid flags: --data-dir, --follow, --help, --json, --node, --request-id, --retry-request, --timeout-ms, --workspace"
    )]
    Resume {
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "ID")]
        node: String,
        #[arg(long)]
        follow: bool,
        #[arg(long, value_name = "MS", default_value_t = 900_000)]
        timeout_ms: u64,
    },
    /// Retry exactly one node's step of its latest run, without redoing the
    /// graph. `--step` defaults to the node id (the label the compiler
    /// emits).
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli graph retry-step --workspace <ID> --node <ID> [--step <LABEL>] [--follow] [--timeout-ms <MS>]\nValid flags: --data-dir, --follow, --help, --json, --node, --request-id, --retry-request, --step, --timeout-ms, --workspace"
    )]
    RetryStep {
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "ID")]
        node: String,
        #[arg(long, value_name = "LABEL")]
        step: Option<String>,
        #[arg(long)]
        follow: bool,
        #[arg(long, value_name = "MS", default_value_t = 900_000)]
        timeout_ms: u64,
    },
    /// Read one node's observed state (the same projection `graph read`
    /// returns, without the whole file).
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli graph node-state --workspace <ID> --node <ID>\nValid flags: --data-dir, --help, --json, --node, --request-id, --retry-request, --workspace"
    )]
    NodeState {
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "ID")]
        node: String,
    },
}

#[derive(Subcommand, Debug)]
pub enum HarnessAction {
    /// List harnesses discovered on the service's execution host
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli harness list\nValid flags: --data-dir, --help, --json, --request-id, --retry-request"
    )]
    List,
    /// Start a session running a harness; the service resolves the host
    /// executable, so there is nothing to point at a local binary
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli harness start --workspace <ID> --harness <ID> [OPTIONS]\nValid flags: --data-dir, --effort, --help, --harness, --json, --model, --permission-mode, --provider, --prompt, --request-id, --retry-request, --workspace"
    )]
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
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, clap::ValueEnum)]
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
pub enum AutomationAction {
    /// Create a cron automation (schedule runs in UTC)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli automation create --name <NAME> --cron <EXPR> --workspace <ID> --harness <ID> --prompt <TEXT> [--disabled] [--grace-minutes <N>]\nValid flags: --cron, --data-dir, --disabled, --grace-minutes, --harness, --help, --json, --name, --prompt, --request-id, --retry-request, --workspace"
    )]
    Create {
        #[arg(long, value_name = "NAME")]
        name: String,
        /// Standard 5-field cron expression (UTC), e.g. "* * * * *"
        #[arg(long, value_name = "EXPR")]
        cron: String,
        #[arg(long, value_name = "ID")]
        workspace: String,
        /// Harness id as advertised by `harness list`
        #[arg(long, value_name = "ID")]
        harness: String,
        /// Literal initial prompt: forwarded as one JSON string, never shell
        /// interpolated, never @-file expanded
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        prompt: String,
        /// Create the automation disabled (it will not fire on schedule)
        #[arg(long)]
        disabled: bool,
        /// Missed-run grace in minutes (a slot past grace is skipped, never
        /// run as catch-up)
        #[arg(long, value_name = "N")]
        grace_minutes: Option<f64>,
    },
    /// List automations with next run time and last outcome
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli automation list\nValid flags: --data-dir, --help, --json, --request-id, --retry-request"
    )]
    List,
    /// Run an automation now (manual trigger, recorded in history)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli automation run --id <ID>\nValid flags: --data-dir, --help, --id, --json, --request-id, --retry-request"
    )]
    Run {
        #[arg(long, value_name = "ID")]
        id: String,
    },
    /// Show an automation's run history, newest first
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli automation history --id <ID> [--limit <N>]\nValid flags: --data-dir, --help, --id, --json, --limit, --request-id, --retry-request"
    )]
    History {
        #[arg(long, value_name = "ID")]
        id: String,
        #[arg(long, value_name = "N")]
        limit: Option<u64>,
    },
}

/// Hidden service-internal callbacks. Only the hook-event callback exists:
/// invoked by a harness's own hook mechanism to report a wait/clear signal
/// for `session.hook_event` — Claude Code's `Notification`/`Stop` hooks in
/// its per-session `--settings` file, OpenCode's status plugin (installed
/// into an `OPENCODE_CONFIG_DIR` overlay), Pi's agent-status extension
/// (loaded with `--extension`), or Codex's managed `CODEX_HOME/hooks.json`.
/// Hook payloads on stdin are drained and ignored (the invocation already
/// names the session, incarnation and event via flags). `event` is validated
/// server-side against the known set for all four
/// (`drogon_core::agent_state::classify_hook_event`).
#[derive(Subcommand, Debug)]
pub enum InternalAction {
    HookEvent {
        #[arg(long, value_name = "ID")]
        session: String,
        #[arg(long, value_name = "TOKEN")]
        incarnation: String,
        #[arg(long, value_name = "NAME")]
        event: String,
    },
}

#[derive(Subcommand, Debug)]
pub enum WorkspaceAction {
    /// Register an existing directory as a workspace
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli workspace add [OPTIONS] <PATH>\nValid flags: --data-dir, --help, --json, --name, --request-id, --retry-request"
    )]
    Add {
        /// Path to an existing directory
        path: PathBuf,
        #[arg(long, value_name = "NAME")]
        name: Option<String>,
    },
    /// List registered workspaces
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli workspace list\nValid flags: --data-dir, --help, --json, --request-id, --retry-request"
    )]
    List,
}

#[derive(Subcommand, Debug)]
pub enum ProjectAction {
    /// Register a git repository or a plain folder as a Project
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli project add [OPTIONS] <PATH>\nValid flags: --data-dir, --help, --json, --name, --request-id, --retry-request"
    )]
    Add {
        /// Path to an existing directory
        path: PathBuf,
        #[arg(long, value_name = "NAME")]
        name: Option<String>,
    },
    /// List registered Projects
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli project list\nValid flags: --data-dir, --help, --json, --request-id, --retry-request"
    )]
    List,
    /// Remove a Project registration; files on disk are untouched
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli project remove <ID>\nValid flags: --data-dir, --help, --json, --request-id, --retry-request"
    )]
    Remove {
        /// Project id, as listed by `project list`
        id: String,
    },
}

#[derive(Subcommand, Debug)]
pub enum WorktreeAction {
    /// Create a git worktree for a Project on branch NAME
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli worktree create --project <ID> --name <NAME> [--base <REF>]\nValid flags: --base, --base-branch, --data-dir, --help, --json, --name, --project, --request-id, --retry-request"
    )]
    Create {
        #[arg(long, value_name = "ID")]
        project: String,
        #[arg(long, value_name = "NAME")]
        name: String,
        /// Start point for the new branch; omitted means the Project's
        /// current HEAD. `--base-branch` is the fork's name for the same
        /// flag; both spellings map to the one `baseRef` param.
        #[arg(long, visible_alias = "base-branch", value_name = "REF")]
        base: Option<String>,
    },
    /// List a Project's worktrees
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli worktree list --project <ID>\nValid flags: --data-dir, --help, --json, --project, --request-id, --retry-request"
    )]
    List {
        #[arg(long, value_name = "ID")]
        project: String,
    },
    /// Remove a worktree; refuses a dirty checkout unless --force
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli worktree rm <ID> [--force]\nValid flags: --data-dir, --force, --help, --json, --request-id, --retry-request"
    )]
    Rm {
        id: String,
        #[arg(long)]
        force: bool,
    },
}

#[derive(Subcommand, Debug)]
pub enum TerminalAction {
    /// Start a PTY session running COMMAND with ARGS (after `--`)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli terminal create --workspace <ID> -- <COMMAND> [ARGS...]\nValid flags: --data-dir, --help, --json, --request-id, --retry-request, --workspace"
    )]
    Create {
        #[arg(long, value_name = "ID")]
        workspace: String,
        /// Everything after `--`: argv[0] is the executable, rest are args.
        /// No shell interpolation happens anywhere.
        #[arg(last = true, value_name = "COMMAND")]
        command: Vec<String>,
    },
    /// List sessions, optionally scoped to one workspace
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli terminal list [--workspace <ID>]\nValid flags: --data-dir, --help, --json, --request-id, --retry-request, --workspace"
    )]
    List {
        #[arg(long, value_name = "ID")]
        workspace: Option<String>,
    },
    /// Read bounded output from a session
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli terminal read --session <ID> --incarnation <TOKEN> [--cursor <N>] [--limit-bytes <BYTES>]\nValid flags: --cursor, --data-dir, --help, --incarnation, --json, --limit-bytes, --request-id, --retry-request, --session"
    )]
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
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli terminal send --session <ID> --incarnation <TOKEN> --text <TEXT>\nValid flags: --data-dir, --help, --incarnation, --json, --request-id, --retry-request, --session, --text"
    )]
    Send {
        #[arg(long, value_name = "ID")]
        session: String,
        #[arg(long, value_name = "TOKEN")]
        incarnation: String,
        #[arg(long, value_name = "TEXT")]
        text: String,
    },
    /// Resize a session's PTY
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli terminal resize --session <ID> --incarnation <TOKEN> --cols <COLS> --rows <ROWS>\nValid flags: --cols, --data-dir, --help, --incarnation, --json, --request-id, --retry-request, --rows, --session"
    )]
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
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli terminal close --session <ID> --incarnation <TOKEN>\nValid flags: --data-dir, --help, --incarnation, --json, --request-id, --retry-request, --session"
    )]
    Close {
        #[arg(long, value_name = "ID")]
        session: String,
        #[arg(long, value_name = "TOKEN")]
        incarnation: String,
    },
    /// Poll a session until a condition holds (client-side over session.read)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli terminal wait --session <ID> --incarnation <TOKEN> --for <exited|idle|output> --timeout-ms <MS>\nValid flags: --data-dir, --for, --help, --incarnation, --json, --request-id, --retry-request, --session, --timeout-ms"
    )]
    Wait {
        #[arg(long, value_name = "ID")]
        session: String,
        #[arg(long, value_name = "TOKEN")]
        incarnation: String,
        /// Wait for the session to exit, to report agentState idle (an
        /// exited session also satisfies idle: it will never work again),
        /// or for any terminal output to exist or arrive
        #[arg(long, value_enum, value_name = "COND")]
        r#for: WaitFor,
        /// Bounded wait budget in ms (1..=900000)
        #[arg(long, value_name = "MS")]
        timeout_ms: u64,
    },
}

/// Browser pane control through the daemon relay: the daemon enqueues one
/// command per invocation and waits (bounded) for the connected desktop to
/// execute it against the embedded browser host.
#[derive(Subcommand, Debug)]
pub enum BrowserAction {
    /// Open a URL in a new pane tab for a workspace
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli browser open --workspace <ID> <URL> [--timeout-ms <MS>]\nValid flags: --data-dir, --help, --json, --request-id, --retry-request, --timeout-ms, --workspace"
    )]
    Open {
        #[arg(long, value_name = "ID")]
        workspace: String,
        /// URL to open (positional, verbatim)
        #[arg(value_name = "URL")]
        url: String,
        /// Bounded wait for the desktop to execute, in ms (1..=25000)
        #[arg(long, value_name = "MS", default_value_t = 15_000)]
        timeout_ms: u64,
    },
    /// Navigate an open tab to a URL
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli browser navigate --tab <ID> <URL> [--timeout-ms <MS>]\nValid flags: --data-dir, --help, --json, --request-id, --retry-request, --tab, --timeout-ms"
    )]
    Navigate {
        #[arg(long, value_name = "ID")]
        tab: String,
        /// URL to navigate to (positional, verbatim)
        #[arg(value_name = "URL")]
        url: String,
        /// Bounded wait for the desktop to execute, in ms (1..=25000)
        #[arg(long, value_name = "MS", default_value_t = 15_000)]
        timeout_ms: u64,
    },
    /// Snapshot a tab's URL, title and bounded DOM text
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli browser snapshot --tab <ID> [--timeout-ms <MS>]\nValid flags: --data-dir, --help, --json, --request-id, --retry-request, --tab, --timeout-ms"
    )]
    Snapshot {
        #[arg(long, value_name = "ID")]
        tab: String,
        /// Bounded wait for the desktop to execute, in ms (1..=25000)
        #[arg(long, value_name = "MS", default_value_t = 15_000)]
        timeout_ms: u64,
    },
    /// Click the element matching a CSS selector in a tab
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli browser click --tab <ID> --selector <CSS> [--timeout-ms <MS>]\nValid flags: --data-dir, --help, --json, --request-id, --retry-request, --selector, --tab, --timeout-ms"
    )]
    Click {
        #[arg(long, value_name = "ID")]
        tab: String,
        /// CSS selector resolved with document.querySelector in the guest
        #[arg(long, value_name = "CSS")]
        selector: String,
        /// Bounded wait for the desktop to execute, in ms (1..=25000)
        #[arg(long, value_name = "MS", default_value_t = 15_000)]
        timeout_ms: u64,
    },
    /// Fill the element matching a CSS selector with text
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli browser fill --tab <ID> --selector <CSS> --text <TEXT> [--timeout-ms <MS>]\nValid flags: --data-dir, --help, --json, --request-id, --retry-request, --selector, --tab, --text, --timeout-ms"
    )]
    Fill {
        #[arg(long, value_name = "ID")]
        tab: String,
        /// CSS selector resolved with document.querySelector in the guest
        #[arg(long, value_name = "CSS")]
        selector: String,
        /// Literal text to fill in (never shell interpolated)
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        text: String,
        /// Bounded wait for the desktop to execute, in ms (1..=25000)
        #[arg(long, value_name = "MS", default_value_t = 15_000)]
        timeout_ms: u64,
    },
    /// List a workspace's open pane tabs
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli browser tabs --workspace <ID> [--timeout-ms <MS>]\nValid flags: --data-dir, --help, --json, --request-id, --retry-request, --timeout-ms, --workspace"
    )]
    Tabs {
        #[arg(long, value_name = "ID")]
        workspace: String,
        /// Bounded wait for the desktop to execute, in ms (1..=25000)
        #[arg(long, value_name = "MS", default_value_t = 15_000)]
        timeout_ms: u64,
    },
}

/// What `terminal wait --for` polls for. Clap renders these kebab-case, so
/// the wire values are exactly `exited|idle|output`. The `exit`/`tui-idle`
/// aliases are the fork's `terminal wait --for` spellings (`exit|tui-idle`);
/// they map to the same conditions and the same wire values. `close` stays
/// the separate `terminal close` verb, never a wait condition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum WaitFor {
    #[value(alias = "exit")]
    Exited,
    #[value(alias = "tui-idle")]
    Idle,
    Output,
}

impl WaitFor {
    pub fn as_wire(self) -> &'static str {
        match self {
            WaitFor::Exited => "exited",
            WaitFor::Idle => "idle",
            WaitFor::Output => "output",
        }
    }
}

#[derive(Subcommand, Debug)]
pub enum SkillsAction {
    /// List version-matched skill guides bundled with this CLI
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli skills list\nValid flags: --data-dir, --help, --json, --request-id, --retry-request"
    )]
    List,
    /// Print a version-matched skill guide as Markdown
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli skills get --topic <TOPIC> [--full]\nValid flags: --data-dir, --full, --help, --json, --request-id, --retry-request, --topic"
    )]
    Get {
        /// Guide topic, e.g. drogon-cli
        #[arg(long)]
        topic: String,
        /// Print the full guide including bundled reference documents
        #[arg(long)]
        full: bool,
    },
    /// Install skills into the coding agents detected on this host
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli skills install (--skill <NAME> [--skill <NAME> ...] | --all) [--agent <NAME>[,<NAME>...]] [--local] [--dry-run]\nValid flags: --agent, --all, --data-dir, --dry-run, --help, --json, --local, --request-id, --retry-request, --skill"
    )]
    Install {
        /// Skill to install; repeat for several
        #[arg(long = "skill", value_name = "NAME")]
        skills: Vec<String>,
        /// Install every bundled skill
        #[arg(long)]
        all: bool,
        /// Comma-separated skills-CLI agent keys; defaults to host detection
        // Why allow_hyphen_values: the reference rejects values like `-y` with
        // its own copy because the skills CLI would silently drop them; clap
        // would otherwise answer with a parse error before that check runs.
        #[arg(long, allow_hyphen_values = true)]
        agent: Option<String>,
        /// Install into the current project instead of globally
        #[arg(long)]
        local: bool,
        /// Print the command without running it
        #[arg(long)]
        dry_run: bool,
    },
    /// Update already-installed skills
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli skills update (--skill <NAME> [--skill <NAME> ...] | --all) [--local] [--dry-run]\nValid flags: --all, --data-dir, --dry-run, --help, --json, --local, --request-id, --retry-request, --skill"
    )]
    Update {
        /// Skill to update; repeat for several
        #[arg(long = "skill", value_name = "NAME")]
        skills: Vec<String>,
        /// Update every bundled skill
        #[arg(long)]
        all: bool,
        /// Update the current project's copy instead of the global one
        #[arg(long)]
        local: bool,
        /// Print the command without running it
        #[arg(long)]
        dry_run: bool,
    },
}

impl Cli {
    /// Binary entry parse. Shadows `clap::Parser::try_parse` (inherent
    /// methods win) so the real argv passes through the source contract's
    /// boundary rule first: a leading bare `--` is an inert empty-named flag
    /// token, never a hard escape that blocks command resolution
    /// (`cli-argument-boundary.test.ts:21`). Mid-argv `--` (terminal create)
    /// is untouched.
    pub fn try_parse() -> Result<Cli, clap::Error> {
        let mut argv: Vec<std::ffi::OsString> = std::env::args_os().collect();
        let program = if argv.is_empty() {
            None
        } else {
            Some(argv.remove(0))
        };
        while argv
            .first()
            .is_some_and(|token| token.as_os_str().to_str() == Some("--"))
        {
            argv.remove(0);
        }
        <Cli as clap::Parser>::try_parse_from(program.into_iter().chain(argv))
    }

    /// Client-side validation: anything provably wrong before contacting the
    /// runtime is a usage error (exit 2), not a round trip.
    pub fn validate(&self) -> Result<(), CliError> {
        if let Some(dir) = &self.data_dir
            && dir.as_os_str() == std::ffi::OsStr::new(IMPLICIT_FLAG_PRESENCE)
        {
            // Source wording: args.ts:250-254, `Flag --<name> requires a value.`
            return Err(CliError::Usage("Flag --data-dir requires a value.".into()));
        }
        if let Some(request_id) = &self.request_id {
            validate_request_id(request_id)?;
        }
        if let Some(retry_request) = &self.retry_request {
            validate_request_id(retry_request)?;
            // Why: one operation identity per invocation; two different ids
            // would make replay ambiguous.
            if let Some(request_id) = &self.request_id
                && request_id != retry_request
            {
                return Err(CliError::Usage(
                    "--request-id and --retry-request name different operations".into(),
                ));
            }
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
            Command::Project { action } => match action {
                ProjectAction::Add { path, name } => {
                    if path.as_os_str().is_empty() {
                        return Err(CliError::Usage("project add requires a PATH".into()));
                    }
                    if let Some(name) = name {
                        require_nonempty("name", name)?;
                    }
                }
                ProjectAction::List => {}
                ProjectAction::Remove { id } => {
                    require_nonempty("id", id)?;
                }
            },
            Command::Worktree { action } => match action {
                WorktreeAction::Create {
                    project,
                    name,
                    base,
                } => {
                    require_nonempty("project", project)?;
                    require_nonempty("name", name)?;
                    if let Some(base) = base {
                        require_nonempty("base", base)?;
                    }
                }
                WorktreeAction::List { project } => {
                    require_nonempty("project", project)?;
                }
                WorktreeAction::Rm { id, .. } => {
                    require_nonempty("id", id)?;
                }
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
                TerminalAction::Wait {
                    session,
                    incarnation,
                    timeout_ms,
                    ..
                } => {
                    require_nonempty("session", session)?;
                    require_nonempty("incarnation", incarnation)?;
                    if *timeout_ms == 0 || *timeout_ms > 900_000 {
                        return Err(CliError::Usage("--timeout-ms must be in 1..=900000".into()));
                    }
                }
            },
            Command::Browser { action } => match action {
                BrowserAction::Open {
                    workspace,
                    url,
                    timeout_ms,
                } => {
                    require_nonempty("workspace", workspace)?;
                    validate_browser_url(url)?;
                    validate_relay_timeout(*timeout_ms)?;
                }
                BrowserAction::Navigate {
                    tab,
                    url,
                    timeout_ms,
                } => {
                    require_nonempty("tab", tab)?;
                    validate_browser_url(url)?;
                    validate_relay_timeout(*timeout_ms)?;
                }
                BrowserAction::Snapshot { tab, timeout_ms } => {
                    require_nonempty("tab", tab)?;
                    validate_relay_timeout(*timeout_ms)?;
                }
                BrowserAction::Click {
                    tab,
                    selector,
                    timeout_ms,
                } => {
                    require_nonempty("tab", tab)?;
                    validate_selector(selector)?;
                    validate_relay_timeout(*timeout_ms)?;
                }
                BrowserAction::Fill {
                    tab,
                    selector,
                    text,
                    timeout_ms,
                } => {
                    require_nonempty("tab", tab)?;
                    validate_selector(selector)?;
                    validate_fill_text(text)?;
                    validate_relay_timeout(*timeout_ms)?;
                }
                BrowserAction::Tabs {
                    workspace,
                    timeout_ms,
                } => {
                    require_nonempty("workspace", workspace)?;
                    validate_relay_timeout(*timeout_ms)?;
                }
            },
            Command::Mentu { action } => match action {
                MentuAction::Status { workspace } => {
                    if let Some(workspace) = workspace {
                        require_nonempty("workspace", workspace)?;
                    }
                }
                MentuAction::Open {
                    workspace,
                    recipe,
                    timeout_ms,
                } => {
                    require_nonempty("workspace", workspace)?;
                    if let Some(recipe) = recipe {
                        require_nonempty("recipe", recipe)?;
                    }
                    validate_relay_timeout(*timeout_ms)?;
                }
                MentuAction::Run {
                    workspace,
                    recipe,
                    approval,
                    timeout_ms,
                    ..
                } => {
                    require_nonempty("workspace", workspace)?;
                    require_nonempty("recipe", recipe)?;
                    if let Some(approval) = approval {
                        validate_opaque_id("approval", approval)?;
                    }
                    validate_follow_timeout(*timeout_ms)?;
                }
                MentuAction::RunStatus { run } | MentuAction::Cancel { run } => {
                    require_nonempty("run", run)?;
                }
                MentuAction::Runs { workspace, limit } => {
                    require_nonempty("workspace", workspace)?;
                    if let Some(limit) = limit
                        && (*limit == 0 || *limit > 200)
                    {
                        return Err(CliError::Usage("--limit must be in 1..=200".into()));
                    }
                }
                MentuAction::Resume {
                    run, timeout_ms, ..
                } => {
                    require_nonempty("run", run)?;
                    validate_follow_timeout(*timeout_ms)?;
                }
                MentuAction::RetryStep {
                    run,
                    step,
                    timeout_ms,
                    ..
                } => {
                    require_nonempty("run", run)?;
                    require_nonempty("step", step)?;
                    validate_follow_timeout(*timeout_ms)?;
                }
            },
            Command::Graph { action } => match action {
                GraphAction::Read { workspace } | GraphAction::WriteIntent { workspace, .. } => {
                    require_nonempty("workspace", workspace)?;
                }
                GraphAction::NodeState { workspace, node } => {
                    require_nonempty("workspace", workspace)?;
                    require_nonempty("node", node)?;
                }
                GraphAction::Compile {
                    workspace,
                    node,
                    nodes,
                    ..
                } => {
                    require_nonempty("workspace", workspace)?;
                    match (node, nodes) {
                        (Some(node), None) => require_nonempty("node", node)?,
                        (None, Some(nodes)) => {
                            if nodes.split(',').all(|id| id.trim().is_empty()) {
                                return Err(CliError::Usage(
                                    "graph compile --nodes needs at least one node id".into(),
                                ));
                            }
                        }
                        _ => {
                            return Err(CliError::Usage(
                                "graph compile takes exactly one of --node or --nodes".into(),
                            ));
                        }
                    }
                }
                GraphAction::Run {
                    workspace,
                    node,
                    timeout_ms,
                    ..
                }
                | GraphAction::Resume {
                    workspace,
                    node,
                    timeout_ms,
                    ..
                } => {
                    require_nonempty("workspace", workspace)?;
                    require_nonempty("node", node)?;
                    validate_follow_timeout(*timeout_ms)?;
                }
                GraphAction::RetryStep {
                    workspace,
                    node,
                    step,
                    timeout_ms,
                    ..
                } => {
                    require_nonempty("workspace", workspace)?;
                    require_nonempty("node", node)?;
                    if let Some(step) = step {
                        require_nonempty("step", step)?;
                    }
                    validate_follow_timeout(*timeout_ms)?;
                }
            },
            // Meetings: `list` takes optional paging, `read` needs a
            // non-empty id. Both bounds are refused here, before any
            // transport work, so a typo never reaches the daemon.
            Command::Meeting { action } => match action {
                MeetingAction::List { limit, offset } => {
                    if let Some(limit) = limit
                        && (*limit == 0 || *limit > 200)
                    {
                        return Err(CliError::Usage("--limit must be between 1 and 200".into()));
                    }
                    if let Some(offset) = offset
                        && *offset > 1_000_000
                    {
                        return Err(CliError::Usage(
                            "--offset must be between 0 and 1000000".into(),
                        ));
                    }
                }
                MeetingAction::Read { id, max_bytes } => {
                    require_nonempty("id", id)?;
                    if let Some(max_bytes) = max_bytes
                        && (*max_bytes == 0 || *max_bytes > 5_242_880)
                    {
                        return Err(CliError::Usage(
                            "--max-bytes must be between 1 and 5242880".into(),
                        ));
                    }
                }
            },
            Command::Automation { action } => match action {
                AutomationAction::Create {
                    name,
                    cron,
                    workspace,
                    harness,
                    prompt,
                    grace_minutes,
                    ..
                } => {
                    require_nonempty("name", name)?;
                    require_nonempty("cron", cron)?;
                    require_nonempty("workspace", workspace)?;
                    validate_opaque_id("harness", harness)?;
                    if prompt.trim().is_empty() {
                        return Err(CliError::Usage("--prompt must contain visible text".into()));
                    }
                    if prompt.len() > 32768 {
                        return Err(CliError::Usage(
                            "--prompt must be at most 32768 UTF-8 bytes".into(),
                        ));
                    }
                    if prompt.contains('\0') {
                        return Err(CliError::Usage("--prompt must not contain NUL".into()));
                    }
                    if let Some(grace) = grace_minutes
                        && (!grace.is_finite() || *grace < 0.0 || *grace > 10_080.0)
                    {
                        return Err(CliError::Usage(
                            "--grace-minutes must be within 0..=10080".into(),
                        ));
                    }
                }
                AutomationAction::List => {}
                AutomationAction::Run { id } => {
                    require_nonempty("id", id)?;
                }
                AutomationAction::History { id, limit } => {
                    require_nonempty("id", id)?;
                    if let Some(limit) = limit
                        && (*limit == 0 || *limit > 200)
                    {
                        return Err(CliError::Usage("--limit must be within 1..=200".into()));
                    }
                }
            },
            Command::Bot { action } => match action {
                BotAction::Provision { bot, workspace } | BotAction::List { bot, workspace } => {
                    require_nonempty("bot", bot)?;
                    require_nonempty("workspace", workspace)?;
                }
                BotAction::CreateAutomation {
                    bot,
                    workspace,
                    name,
                    schedule,
                    prompt,
                    ..
                } => {
                    require_nonempty("bot", bot)?;
                    require_nonempty("workspace", workspace)?;
                    require_nonempty("name", name)?;
                    require_nonempty("schedule", schedule)?;
                    if prompt.trim().is_empty() {
                        return Err(CliError::Usage("--prompt must contain visible text".into()));
                    }
                }
                BotAction::UpdateAutomation {
                    bot,
                    workspace,
                    responsibility,
                    name,
                    prompt,
                    schedule,
                    ..
                } => {
                    require_nonempty("bot", bot)?;
                    require_nonempty("workspace", workspace)?;
                    require_nonempty("responsibility", responsibility)?;
                    if name.is_none() && prompt.is_none() && schedule.is_none() {
                        return Err(CliError::Usage(
                            "update-automation requires at least one of --name, --prompt, --schedule"
                                .into(),
                        ));
                    }
                }
                BotAction::EnableAutomation {
                    bot,
                    workspace,
                    responsibility,
                    ..
                }
                | BotAction::DisableAutomation {
                    bot,
                    workspace,
                    responsibility,
                    ..
                }
                | BotAction::DeleteAutomation {
                    bot,
                    workspace,
                    responsibility,
                }
                | BotAction::TestAutomation {
                    bot,
                    workspace,
                    responsibility,
                } => {
                    require_nonempty("bot", bot)?;
                    require_nonempty("workspace", workspace)?;
                    require_nonempty("responsibility", responsibility)?;
                }
                BotAction::CreateMonitor {
                    bot,
                    workspace,
                    resource,
                    cron,
                    manual,
                    responsibility_id,
                    responsibility_name,
                    instructions,
                    ..
                } => {
                    require_nonempty("bot", bot)?;
                    require_nonempty("workspace", workspace)?;
                    require_nonempty("resource", resource)?;
                    if *manual && cron.is_some() {
                        return Err(CliError::Usage("--manual takes no --cron".into()));
                    }
                    validate_monitor_action_flags(
                        responsibility_id.as_deref(),
                        responsibility_name.as_deref(),
                        instructions.as_deref(),
                    )?;
                }
                BotAction::BindMonitor {
                    bot,
                    workspace,
                    monitor,
                    expected_rev,
                    responsibility_id,
                    responsibility_name,
                    instructions,
                } => {
                    require_nonempty("bot", bot)?;
                    require_nonempty("workspace", workspace)?;
                    require_nonempty("monitor", monitor)?;
                    if *expected_rev < 0 {
                        return Err(CliError::Usage(
                            "--expected-rev must be 0 or greater".into(),
                        ));
                    }
                    validate_monitor_action_flags(
                        responsibility_id.as_deref(),
                        responsibility_name.as_deref(),
                        instructions.as_deref(),
                    )?;
                    if responsibility_id.is_none() && responsibility_name.is_none() {
                        return Err(CliError::Usage(
                            "bind-monitor requires --responsibility-id or --responsibility-name"
                                .into(),
                        ));
                    }
                }
                BotAction::UpdateMonitor {
                    bot,
                    workspace,
                    monitor,
                    resource,
                    max_bytes,
                    cron,
                    manual,
                    ..
                } => {
                    require_nonempty("bot", bot)?;
                    require_nonempty("workspace", workspace)?;
                    require_nonempty("monitor", monitor)?;
                    if resource.is_none() && max_bytes.is_none() && cron.is_none() && !manual {
                        return Err(CliError::Usage(
                            "update-monitor requires at least one of --resource, --max-bytes, --cron, --manual"
                                .into(),
                        ));
                    }
                    if *manual && cron.is_some() {
                        return Err(CliError::Usage("--manual takes no --cron".into()));
                    }
                }
                BotAction::EnableMonitor {
                    bot,
                    workspace,
                    monitor,
                    ..
                }
                | BotAction::DisableMonitor {
                    bot,
                    workspace,
                    monitor,
                    ..
                }
                | BotAction::DeleteMonitor {
                    bot,
                    workspace,
                    monitor,
                }
                | BotAction::TestMonitor {
                    bot,
                    workspace,
                    monitor,
                } => {
                    require_nonempty("bot", bot)?;
                    require_nonempty("workspace", workspace)?;
                    require_nonempty("monitor", monitor)?;
                }
                BotAction::GrantSecret {
                    bot,
                    workspace,
                    secret_ref,
                    kind,
                    ..
                } => {
                    require_nonempty("bot", bot)?;
                    require_nonempty("workspace", workspace)?;
                    require_nonempty("secret-ref", secret_ref)?;
                    require_nonempty("kind", kind)?;
                }
                BotAction::RevokeSecret {
                    bot,
                    workspace,
                    secret_ref,
                    ..
                } => {
                    require_nonempty("bot", bot)?;
                    require_nonempty("workspace", workspace)?;
                    require_nonempty("secret-ref", secret_ref)?;
                }
                BotAction::ListGrants { bot, workspace } => {
                    require_nonempty("bot", bot)?;
                    require_nonempty("workspace", workspace)?;
                }
            },
            Command::Secrets { action } => match action {
                SecretsAction::Set { kind, name } | SecretsAction::Delete { kind, name } => {
                    require_nonempty("kind", kind)?;
                    require_nonempty("name", name)?;
                }
                SecretsAction::List { kind } => {
                    require_nonempty("kind", kind)?;
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
            Command::Skills { action } => match action {
                SkillsAction::List => {}
                SkillsAction::Get { topic, .. } => {
                    require_nonempty("topic", topic)?;
                }
                SkillsAction::Install { skills, .. } | SkillsAction::Update { skills, .. } => {
                    for skill in skills {
                        require_nonempty("skill", skill)?;
                    }
                }
            },
            Command::Orchestration { command } => {
                // Purely local actor/flag contradictions (worker credential
                // vs coordinator bindings, reuse-vs-fresh preferences,
                // request-show scope) fail closed here, before any
                // connection is attempted.
                crate::orchestration_commands::validate_actor_flags(command)?;
            }
            Command::Internal { action } => match action {
                InternalAction::HookEvent {
                    session,
                    incarnation,
                    event,
                } => {
                    require_nonempty("session", session)?;
                    require_nonempty("incarnation", incarnation)?;
                    require_nonempty("event", event)?;
                }
            },
            Command::Status => {}
            Command::AgentContext => {}
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

/// Monitor action flags are shared by `create-monitor` and `bind-monitor`:
/// the id and the name are mutually exclusive, and standing instructions
/// only make sense attached to a (minted) responsibility name.
fn validate_monitor_action_flags(
    responsibility_id: Option<&str>,
    responsibility_name: Option<&str>,
    instructions: Option<&str>,
) -> Result<(), CliError> {
    if responsibility_id.is_some() && responsibility_name.is_some() {
        return Err(CliError::Usage(
            "--responsibility-id and --responsibility-name are mutually exclusive".into(),
        ));
    }
    if responsibility_id.is_none() && responsibility_name.is_none() && instructions.is_some() {
        return Err(CliError::Usage(
            "--instructions needs --responsibility-name to attach to".into(),
        ));
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

/// Relay waits are client-bounded well under the 30s transport budget so a
/// `desktop_not_connected` timeout always arrives as a typed service error,
/// never a transport loss.
fn validate_relay_timeout(timeout_ms: u64) -> Result<(), CliError> {
    if timeout_ms == 0 || timeout_ms > 25_000 {
        return Err(CliError::Usage("--timeout-ms must be in 1..=25000".into()));
    }
    Ok(())
}

/// `mentu run --follow` polls the daemon's own run record, so its budget is
/// a wall-clock wait over many short RPCs rather than one relay round trip:
/// bounded at an hour, and 1 is the smallest honest budget.
fn validate_follow_timeout(timeout_ms: u64) -> Result<(), CliError> {
    if timeout_ms == 0 || timeout_ms > 3_600_000 {
        return Err(CliError::Usage(
            "--timeout-ms must be in 1..=3600000".into(),
        ));
    }
    Ok(())
}

fn validate_browser_url(url: &str) -> Result<(), CliError> {
    if url.is_empty() || url.len() > 2048 || url.contains('\0') {
        return Err(CliError::Usage(
            "URL must be 1..=2048 characters without NUL".into(),
        ));
    }
    Ok(())
}

fn validate_selector(selector: &str) -> Result<(), CliError> {
    if selector.is_empty() || selector.len() > 1024 || selector.contains('\0') {
        return Err(CliError::Usage(
            "--selector must be 1..=1024 characters without NUL".into(),
        ));
    }
    Ok(())
}

fn validate_fill_text(text: &str) -> Result<(), CliError> {
    if text.len() > 8192 || text.contains('\0') {
        return Err(CliError::Usage(
            "--text must be at most 8192 UTF-8 bytes without NUL".into(),
        ));
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
    fn full_grammar_parses_on_the_provisioned_cli_stack() {
        // Regression guard for the Windows named-pipe acceptance failure:
        // clap derive construction recurses with grammar size and overflowed
        // the 1 MiB main-thread stack Windows grants drogon-cli.exe (fatal
        // `thread 'main' has overflowed its stack` on every invocation, so
        // the daemon never saw a ready status). The binary routes its whole
        // main through `run_on_cli_stack`; this test drives the real parse
        // through that same provisioned path.
        let handle = crate::run_on_cli_stack(|| {
            Cli::command().debug_assert();
            <Cli as clap::Parser>::try_parse_from(["drogon-cli", "status"])
                .expect("status parses on the provisioned stack");
        });
        handle.join().expect("CLI work thread panicked");
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
    fn project_add_and_list_parse() {
        let cli = parse(&["project", "add", "/tmp/repo", "--name", "My Repo"]).unwrap();
        let Command::Project {
            action: ProjectAction::Add { path, name },
        } = &cli.command
        else {
            panic!("wrong subcommand");
        };
        assert_eq!(path, &PathBuf::from("/tmp/repo"));
        assert_eq!(name.as_deref(), Some("My Repo"));
        assert!(cli.validate().is_ok());

        let cli = parse(&["project", "list"]).unwrap();
        assert!(matches!(
            cli.command,
            Command::Project {
                action: ProjectAction::List
            }
        ));
        assert!(cli.validate().is_ok());
    }

    #[test]
    fn worktree_create_list_and_rm_parse() {
        let cli = parse(&[
            "worktree",
            "create",
            "--project",
            "p1",
            "--name",
            "feature",
            "--base",
            "main",
        ])
        .unwrap();
        let Command::Worktree {
            action:
                WorktreeAction::Create {
                    project,
                    name,
                    base,
                },
        } = &cli.command
        else {
            panic!("wrong subcommand");
        };
        assert_eq!(project, "p1");
        assert_eq!(name, "feature");
        assert_eq!(base.as_deref(), Some("main"));
        assert!(cli.validate().is_ok());

        let cli = parse(&["worktree", "list", "--project", "p1"]).unwrap();
        assert!(cli.validate().is_ok());

        let cli = parse(&["worktree", "rm", "w1", "--force"]).unwrap();
        let Command::Worktree {
            action: WorktreeAction::Rm { id, force },
        } = &cli.command
        else {
            panic!("wrong subcommand");
        };
        assert_eq!(id, "w1");
        assert!(*force);
        assert!(cli.validate().is_ok());
    }

    #[test]
    fn worktree_create_accepts_base_branch_as_base_alias() {
        for args in [
            vec![
                "worktree",
                "create",
                "--project",
                "p1",
                "--name",
                "feature",
                "--base",
                "main",
            ],
            vec![
                "worktree",
                "create",
                "--project",
                "p1",
                "--name",
                "feature",
                "--base-branch",
                "main",
            ],
        ] {
            let cli = parse(&args).unwrap();
            let Command::Worktree {
                action:
                    WorktreeAction::Create {
                        project,
                        name,
                        base,
                    },
            } = &cli.command
            else {
                panic!("wrong subcommand");
            };
            assert_eq!(project, "p1");
            assert_eq!(name, "feature");
            assert_eq!(base.as_deref(), Some("main"));
            assert!(cli.validate().is_ok());
        }
    }

    #[test]
    fn project_remove_takes_a_positional_id() {
        let cli = parse(&["project", "remove", "proj-1"]).unwrap();
        let Command::Project {
            action: ProjectAction::Remove { id },
        } = &cli.command
        else {
            panic!("wrong subcommand");
        };
        assert_eq!(id, "proj-1");
        assert!(cli.validate().is_ok());

        let cli = parse(&["project", "remove", ""]).unwrap();
        assert!(matches!(cli.validate(), Err(CliError::Usage(_))));
    }

    #[test]
    fn agent_context_parses() {
        let cli = parse(&["agent-context"]).unwrap();
        assert!(matches!(cli.command, Command::AgentContext));
        assert!(cli.validate().is_ok());
    }

    #[test]
    fn worktree_create_requires_project_and_name() {
        let cli = parse(&["worktree", "create", "--project", "", "--name", "feature"]).unwrap();
        assert!(matches!(cli.validate(), Err(CliError::Usage(_))));
        let cli = parse(&["worktree", "create", "--project", "p1", "--name", ""]).unwrap();
        assert!(matches!(cli.validate(), Err(CliError::Usage(_))));
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
    fn terminal_wait_parses_conditions_and_bounds_the_budget() {
        for condition in ["exited", "idle", "output"] {
            let cli = parse(&[
                "terminal",
                "wait",
                "--session",
                "s",
                "--incarnation",
                "i",
                "--for",
                condition,
                "--timeout-ms",
                "5000",
            ])
            .unwrap();
            let Command::Terminal {
                action: TerminalAction::Wait { timeout_ms, .. },
            } = &cli.command
            else {
                panic!("wrong subcommand");
            };
            assert_eq!(*timeout_ms, 5000);
            assert!(cli.validate().is_ok());
        }

        // The fork's spellings map to the same conditions and wire values.
        for (spelling, expected) in [("exit", WaitFor::Exited), ("tui-idle", WaitFor::Idle)] {
            let cli = parse(&[
                "terminal",
                "wait",
                "--session",
                "s",
                "--incarnation",
                "i",
                "--for",
                spelling,
                "--timeout-ms",
                "5000",
            ])
            .unwrap();
            let Command::Terminal {
                action: TerminalAction::Wait { r#for, .. },
            } = &cli.command
            else {
                panic!("wrong subcommand");
            };
            assert_eq!(*r#for, expected, "--for {spelling}");
            assert!(cli.validate().is_ok());
        }
        assert_eq!(WaitFor::Exited.as_wire(), "exited");
        assert_eq!(WaitFor::Idle.as_wire(), "idle");

        // Unknown conditions never reach the daemon. `close` is the separate
        // `terminal close` verb, never a wait condition.
        for condition in ["close", "tui_idle", "EXITED"] {
            assert!(
                parse(&[
                    "terminal",
                    "wait",
                    "--session",
                    "s",
                    "--incarnation",
                    "i",
                    "--for",
                    condition,
                    "--timeout-ms",
                    "5000",
                ])
                .is_err(),
                "--for {condition} must not parse"
            );
        }

        for budget in ["0", "900001"] {
            let cli = parse(&[
                "terminal",
                "wait",
                "--session",
                "s",
                "--incarnation",
                "i",
                "--for",
                "exited",
                "--timeout-ms",
                budget,
            ])
            .unwrap();
            assert!(matches!(cli.validate(), Err(CliError::Usage(_))));
        }
    }

    #[test]
    fn skills_list_and_get_parse() {
        let cli = parse(&["skills", "list"]).unwrap();
        assert!(matches!(
            cli.command,
            Command::Skills {
                action: SkillsAction::List
            }
        ));
        assert!(cli.validate().is_ok());

        let cli = parse(&["skills", "get", "--topic", "drogon-cli"]).unwrap();
        let Command::Skills {
            action: SkillsAction::Get { topic, full },
        } = &cli.command
        else {
            panic!("wrong subcommand");
        };
        assert_eq!(topic, "drogon-cli");
        assert!(!*full);
        assert!(cli.validate().is_ok());

        let cli = parse(&["skills", "get", "--topic", "orchestration", "--full"]).unwrap();
        let Command::Skills {
            action: SkillsAction::Get { full, .. },
        } = &cli.command
        else {
            panic!("wrong subcommand");
        };
        assert!(*full);

        let cli = parse(&["skills", "get", "--topic", ""]).unwrap();
        assert!(matches!(cli.validate(), Err(CliError::Usage(_))));
    }

    #[test]
    fn skills_install_and_update_parse() {
        let cli = parse(&[
            "skills",
            "install",
            "--skill",
            "drogon-cli",
            "--agent",
            "universal",
        ])
        .unwrap();
        let Command::Skills {
            action:
                SkillsAction::Install {
                    skills,
                    all,
                    agent,
                    local,
                    dry_run,
                },
        } = &cli.command
        else {
            panic!("wrong subcommand");
        };
        assert_eq!(skills, &["drogon-cli".to_string()]);
        assert!(!*all);
        assert_eq!(agent.as_deref(), Some("universal"));
        assert!(!*local);
        assert!(!*dry_run);
        assert!(cli.validate().is_ok());

        let cli = parse(&[
            "skills",
            "install",
            "--all",
            "--local",
            "--dry-run",
            "--skill",
            "drogon-cli",
            "--skill",
            "orchestration",
        ])
        .unwrap();
        let Command::Skills {
            action:
                SkillsAction::Install {
                    all,
                    local,
                    dry_run,
                    ..
                },
        } = &cli.command
        else {
            panic!("wrong subcommand");
        };
        assert!(*all);
        assert!(*local);
        assert!(*dry_run);
        assert!(cli.validate().is_ok());

        let cli = parse(&["skills", "update", "--all"]).unwrap();
        assert!(matches!(
            cli.command,
            Command::Skills {
                action: SkillsAction::Update { .. }
            }
        ));
        assert!(cli.validate().is_ok());

        // An empty --skill value is a bad invocation, like an empty topic.
        let cli = parse(&["skills", "install", "--skill", ""]).unwrap();
        assert!(matches!(cli.validate(), Err(CliError::Usage(_))));
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

#[cfg(test)]
mod browser_tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        Cli::try_parse_from(std::iter::once("drogon-cli").chain(args.iter().copied()))
    }

    #[test]
    fn browser_verbs_parse_with_positional_urls() {
        let cli = parse(&[
            "browser",
            "open",
            "--workspace",
            "w1",
            "https://example.test/",
        ])
        .unwrap();
        let Command::Browser {
            action:
                BrowserAction::Open {
                    workspace,
                    url,
                    timeout_ms,
                },
        } = &cli.command
        else {
            panic!("wrong subcommand");
        };
        assert_eq!(workspace, "w1");
        assert_eq!(url, "https://example.test/");
        assert_eq!(*timeout_ms, 15_000);
        assert!(cli.validate().is_ok());

        let cli = parse(&[
            "browser",
            "navigate",
            "--tab",
            "browser-tab-1",
            "https://example.test/next",
        ])
        .unwrap();
        assert!(cli.validate().is_ok());

        let cli = parse(&["browser", "snapshot", "--tab", "browser-tab-1"]).unwrap();
        assert!(cli.validate().is_ok());

        let cli = parse(&[
            "browser",
            "fill",
            "--tab",
            "browser-tab-1",
            "--selector",
            "#name",
            "--text",
            "Ada",
        ])
        .unwrap();
        assert!(cli.validate().is_ok());

        let cli = parse(&["browser", "tabs", "--workspace", "w1"]).unwrap();
        assert!(cli.validate().is_ok());
    }

    #[test]
    fn browser_open_requires_workspace_and_url() {
        assert!(parse(&["browser", "open", "https://example.test/"]).is_err());
        assert!(parse(&["browser", "open", "--workspace", "w1"]).is_err());
    }

    #[test]
    fn browser_timeouts_are_bounded_client_side() {
        let cli = parse(&[
            "browser",
            "snapshot",
            "--tab",
            "browser-tab-1",
            "--timeout-ms",
            "0",
        ])
        .unwrap();
        assert!(cli.validate().is_err());
        let cli = parse(&[
            "browser",
            "snapshot",
            "--tab",
            "browser-tab-1",
            "--timeout-ms",
            "25001",
        ])
        .unwrap();
        assert!(cli.validate().is_err());
        let cli = parse(&[
            "browser",
            "snapshot",
            "--tab",
            "browser-tab-1",
            "--timeout-ms",
            "5000",
        ])
        .unwrap();
        assert!(cli.validate().is_ok());
    }

    #[test]
    fn browser_selector_and_text_shapes_are_checked() {
        let cli = parse(&[
            "browser",
            "click",
            "--tab",
            "browser-tab-1",
            "--selector",
            "",
        ])
        .unwrap();
        assert!(cli.validate().is_err());
        let big_selector = "#".to_string() + &"x".repeat(1024);
        let cli = parse(&[
            "browser",
            "click",
            "--tab",
            "browser-tab-1",
            "--selector",
            &big_selector,
        ])
        .unwrap();
        assert!(cli.validate().is_err());
        let big_text = "x".repeat(8193);
        let cli = parse(&[
            "browser",
            "fill",
            "--tab",
            "browser-tab-1",
            "--selector",
            "#a",
            "--text",
            &big_text,
        ])
        .unwrap();
        assert!(cli.validate().is_err());
        // Flag-like fill text is literal data, not a flag.
        let cli = parse(&[
            "browser",
            "fill",
            "--tab",
            "browser-tab-1",
            "--selector",
            "#a",
            "--text",
            "--looks-like-a-flag but is not",
        ])
        .unwrap();
        assert!(cli.validate().is_ok());
    }
}

/// Scoped Bot self-management verbs: `--bot` names both actor and target
/// (the service denies any cross-Bot spelling); `--workspace` is the scope
/// assertion, resolved to the Bot's owning folder server-side like every
/// other `bot.*` method.
#[derive(Subcommand, Debug)]
pub enum BotAction {
    /// Provision the Bot's dedicated working folder and profile
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli bot provision --bot <ID> --workspace <ID>\nValid flags: --bot, --data-dir, --help, --json, --request-id, --retry-request, --workspace"
    )]
    Provision {
        #[arg(long, value_name = "ID")]
        bot: String,
        #[arg(long, value_name = "ID")]
        workspace: String,
    },
    /// List the Bot's own automations, monitors, home and audit count
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli bot list --bot <ID> --workspace <ID>\nValid flags: --bot, --data-dir, --help, --json, --request-id, --retry-request, --workspace"
    )]
    List {
        #[arg(long, value_name = "ID")]
        bot: String,
        #[arg(long, value_name = "ID")]
        workspace: String,
    },
    /// Create one of the Bot's own scheduled automations (runs in the
    /// provisioned home workspace under the Bot's harness)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli bot create-automation --bot <ID> --workspace <ID> --name <NAME> --schedule <EXPR> --prompt <TEXT> [--disabled]\nValid flags: --bot, --data-dir, --disabled, --help, --json, --name, --prompt, --request-id, --retry-request, --schedule, --workspace"
    )]
    CreateAutomation {
        #[arg(long, value_name = "ID")]
        bot: String,
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "NAME")]
        name: String,
        #[arg(long, value_name = "EXPR")]
        schedule: String,
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        prompt: String,
        #[arg(long)]
        disabled: bool,
    },
    /// Edit one of the Bot's own automations (CAS on the Bot revision)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli bot update-automation --bot <ID> --workspace <ID> --responsibility <ID> --expected-bot-rev <N> [--name <NAME>] [--prompt <TEXT>] [--schedule <EXPR>]\nValid flags: --bot, --data-dir, --expected-bot-rev, --help, --json, --name, --prompt, --request-id, --responsibility, --retry-request, --schedule, --workspace"
    )]
    UpdateAutomation {
        #[arg(long, value_name = "ID")]
        bot: String,
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "ID")]
        responsibility: String,
        #[arg(long, value_name = "N")]
        expected_bot_rev: i64,
        #[arg(long, value_name = "NAME")]
        name: Option<String>,
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        prompt: Option<String>,
        #[arg(long, value_name = "EXPR")]
        schedule: Option<String>,
    },
    /// Enable one of the Bot's own automations (CAS on the Bot revision)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli bot enable-automation --bot <ID> --workspace <ID> --responsibility <ID> --expected-bot-rev <N>\nValid flags: --bot, --data-dir, --expected-bot-rev, --help, --json, --request-id, --responsibility, --retry-request, --workspace"
    )]
    EnableAutomation {
        #[arg(long, value_name = "ID")]
        bot: String,
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "ID")]
        responsibility: String,
        #[arg(long, value_name = "N")]
        expected_bot_rev: i64,
    },
    /// Disable one of the Bot's own automations (CAS on the Bot revision)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli bot disable-automation --bot <ID> --workspace <ID> --responsibility <ID> --expected-bot-rev <N>\nValid flags: --bot, --data-dir, --expected-bot-rev, --help, --json, --request-id, --responsibility, --retry-request, --workspace"
    )]
    DisableAutomation {
        #[arg(long, value_name = "ID")]
        bot: String,
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "ID")]
        responsibility: String,
        #[arg(long, value_name = "N")]
        expected_bot_rev: i64,
    },
    /// Delete one of the Bot's own automations (run history is retained)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli bot delete-automation --bot <ID> --workspace <ID> --responsibility <ID>\nValid flags: --bot, --data-dir, --help, --json, --request-id, --responsibility, --retry-request, --workspace"
    )]
    DeleteAutomation {
        #[arg(long, value_name = "ID")]
        bot: String,
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "ID")]
        responsibility: String,
    },
    /// Admission-only test of one of the Bot's own automations (no dispatch)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli bot test-automation --bot <ID> --workspace <ID> --responsibility <ID>\nValid flags: --bot, --data-dir, --help, --json, --request-id, --responsibility, --retry-request, --workspace"
    )]
    TestAutomation {
        #[arg(long, value_name = "ID")]
        bot: String,
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "ID")]
        responsibility: String,
    },
    /// Create one of the Bot's own file monitors (in-scope resources only);
    /// declare the action it releases with --responsibility-name (mints a
    /// reactive responsibility) or --responsibility-id (binds an existing
    /// reactive one); without either the monitor observes and records only
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli bot create-monitor --bot <ID> --workspace <ID> --resource <PATH> [--max-bytes <N>] [--cron <EXPR> | --manual] [--disabled] [--responsibility-id <ID> | --responsibility-name <NAME> [--instructions <TEXT>]]\nValid flags: --bot, --cron, --data-dir, --disabled, --help, --instructions, --json, --manual, --max-bytes, --request-id, --resource, --responsibility-id, --responsibility-name, --retry-request, --workspace"
    )]
    CreateMonitor {
        #[arg(long, value_name = "ID")]
        bot: String,
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "PATH")]
        resource: String,
        #[arg(long, value_name = "N")]
        max_bytes: Option<u64>,
        #[arg(long, value_name = "EXPR")]
        cron: Option<String>,
        #[arg(long)]
        manual: bool,
        #[arg(long)]
        disabled: bool,
        #[arg(long, value_name = "ID")]
        responsibility_id: Option<String>,
        #[arg(long, value_name = "NAME")]
        responsibility_name: Option<String>,
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        instructions: Option<String>,
    },
    /// Bind an action to an existing Bot-owned monitor: the reactive
    /// responsibility the delegation drain dispatches when the watch
    /// fires (CAS on the monitor revision; never parks approval)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli bot bind-monitor --bot <ID> --workspace <ID> --monitor <ID> --expected-rev <N> (--responsibility-id <ID> | --responsibility-name <NAME>) [--instructions <TEXT>]\nValid flags: --bot, --data-dir, --expected-rev, --help, --instructions, --json, --monitor, --request-id, --responsibility-id, --responsibility-name, --retry-request, --workspace"
    )]
    BindMonitor {
        #[arg(long, value_name = "ID")]
        bot: String,
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "ID")]
        monitor: String,
        #[arg(long, value_name = "N")]
        expected_rev: i64,
        #[arg(long, value_name = "ID")]
        responsibility_id: Option<String>,
        #[arg(long, value_name = "NAME")]
        responsibility_name: Option<String>,
        #[arg(long, value_name = "TEXT", allow_hyphen_values = true)]
        instructions: Option<String>,
    },
    /// Edit one of the Bot's own monitors (CAS on the monitor revision)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli bot update-monitor --bot <ID> --workspace <ID> --monitor <ID> --expected-rev <N> [--resource <PATH>] [--max-bytes <N>] [--cron <EXPR> | --manual]\nValid flags: --bot, --cron, --data-dir, --expected-rev, --help, --json, --manual, --max-bytes, --monitor, --request-id, --resource, --retry-request, --workspace"
    )]
    UpdateMonitor {
        #[arg(long, value_name = "ID")]
        bot: String,
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "ID")]
        monitor: String,
        #[arg(long, value_name = "N")]
        expected_rev: i64,
        #[arg(long, value_name = "PATH")]
        resource: Option<String>,
        #[arg(long, value_name = "N")]
        max_bytes: Option<u64>,
        #[arg(long, value_name = "EXPR")]
        cron: Option<String>,
        #[arg(long)]
        manual: bool,
    },
    /// Enable one of the Bot's own monitors (CAS on the monitor revision)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli bot enable-monitor --bot <ID> --workspace <ID> --monitor <ID> --expected-rev <N>\nValid flags: --bot, --data-dir, --expected-rev, --help, --json, --monitor, --request-id, --retry-request, --workspace"
    )]
    EnableMonitor {
        #[arg(long, value_name = "ID")]
        bot: String,
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "ID")]
        monitor: String,
        #[arg(long, value_name = "N")]
        expected_rev: i64,
    },
    /// Disable one of the Bot's own monitors (CAS on the monitor revision)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli bot disable-monitor --bot <ID> --workspace <ID> --monitor <ID> --expected-rev <N>\nValid flags: --bot, --data-dir, --expected-rev, --help, --json, --monitor, --request-id, --retry-request, --workspace"
    )]
    DisableMonitor {
        #[arg(long, value_name = "ID")]
        bot: String,
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "ID")]
        monitor: String,
        #[arg(long, value_name = "N")]
        expected_rev: i64,
    },
    /// Delete one of the Bot's own monitors (check history is retained)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli bot delete-monitor --bot <ID> --workspace <ID> --monitor <ID>\nValid flags: --bot, --data-dir, --help, --json, --monitor, --request-id, --retry-request, --workspace"
    )]
    DeleteMonitor {
        #[arg(long, value_name = "ID")]
        bot: String,
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "ID")]
        monitor: String,
    },
    /// Dry-run test of one of the Bot's own monitors (no cursor commit)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli bot test-monitor --bot <ID> --workspace <ID> --monitor <ID>\nValid flags: --bot, --data-dir, --help, --json, --monitor, --request-id, --retry-request, --workspace"
    )]
    TestMonitor {
        #[arg(long, value_name = "ID")]
        bot: String,
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "ID")]
        monitor: String,
    },
    /// Grant an integration secret reference to the Bot (user-only; the
    /// value stays in the sealed store, only the reference is granted;
    /// requires the service capability bot.secrets.v1)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli bot grant-secret --bot <ID> --workspace <ID> --secret-ref <NAME> --kind <KIND> [--granted-by <USER>]\nValid flags: --bot, --data-dir, --granted-by, --help, --json, --kind, --request-id, --retry-request, --secret-ref, --workspace"
    )]
    GrantSecret {
        #[arg(long, value_name = "ID")]
        bot: String,
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "NAME")]
        secret_ref: String,
        #[arg(long, value_name = "KIND")]
        kind: String,
        #[arg(long, value_name = "USER")]
        granted_by: Option<String>,
    },
    /// Revoke the Bot's secret reference grant (user-only; takes effect on
    /// the Bot's NEXT monitor tick)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli bot revoke-secret --bot <ID> --workspace <ID> --secret-ref <NAME> [--granted-by <USER>]\nValid flags: --bot, --data-dir, --granted-by, --help, --json, --request-id, --retry-request, --secret-ref, --workspace"
    )]
    RevokeSecret {
        #[arg(long, value_name = "ID")]
        bot: String,
        #[arg(long, value_name = "ID")]
        workspace: String,
        #[arg(long, value_name = "NAME")]
        secret_ref: String,
        #[arg(long, value_name = "USER")]
        granted_by: Option<String>,
    },
    /// List the Bot's secret reference grants (names and metadata, never
    /// values)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli bot list-grants --bot <ID> --workspace <ID>\nValid flags: --bot, --data-dir, --help, --json, --request-id, --retry-request, --workspace"
    )]
    ListGrants {
        #[arg(long, value_name = "ID")]
        bot: String,
        #[arg(long, value_name = "ID")]
        workspace: String,
    },
}

#[derive(Subcommand, Debug)]
pub enum SecretsAction {
    /// Seal a secret value for an integration kind. The value is read from
    /// stdin (pipe it in; do not type it as a flag).
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli secrets set --kind <KIND> --name <NAME> < value-on-stdin\nValid flags: --data-dir, --help, --json, --kind, --name, --request-id, --retry-request"
    )]
    Set {
        #[arg(long, value_name = "KIND")]
        kind: String,
        #[arg(long, value_name = "NAME")]
        name: String,
    },
    /// List configured secret NAMES for an integration kind (never values)
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli secrets list --kind <KIND>\nValid flags: --data-dir, --help, --json, --kind, --request-id, --retry-request"
    )]
    List {
        #[arg(long, value_name = "KIND")]
        kind: String,
    },
    /// Delete the sealed value for an integration kind and name
    #[command(
        args_override_self = true,
        override_usage = "drogon-cli secrets delete --kind <KIND> --name <NAME>\nValid flags: --data-dir, --help, --json, --kind, --name, --request-id, --retry-request"
    )]
    Delete {
        #[arg(long, value_name = "KIND")]
        kind: String,
        #[arg(long, value_name = "NAME")]
        name: String,
    },
}

#[cfg(test)]
mod bot_self_tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        Cli::try_parse_from(std::iter::once("drogon-cli").chain(args.iter().copied()))
    }

    #[test]
    fn bot_verbs_parse_with_scope_flags() {
        let cli = parse(&["bot", "provision", "--bot", "b1", "--workspace", "w1"]).unwrap();
        assert!(matches!(
            cli.command,
            Command::Bot {
                action: BotAction::Provision { .. }
            }
        ));
        let cli = parse(&[
            "bot",
            "create-automation",
            "--bot",
            "b1",
            "--workspace",
            "w1",
            "--name",
            "n",
            "--schedule",
            "* * * * *",
            "--prompt",
            "p",
        ])
        .unwrap();
        assert!(matches!(
            cli.command,
            Command::Bot {
                action: BotAction::CreateAutomation { .. }
            }
        ));
        let cli = parse(&[
            "bot",
            "create-monitor",
            "--bot",
            "b1",
            "--workspace",
            "w1",
            "--resource",
            "notes.md",
            "--cron",
            "* * * * *",
        ])
        .unwrap();
        assert!(matches!(
            cli.command,
            Command::Bot {
                action: BotAction::CreateMonitor { .. }
            }
        ));
    }

    #[test]
    fn bot_secret_grant_verbs_parse_and_validate() {
        let cli = parse(&[
            "bot",
            "grant-secret",
            "--bot",
            "b1",
            "--workspace",
            "w1",
            "--secret-ref",
            "GITHUB_TOKEN_REF",
            "--kind",
            "github",
            "--granted-by",
            "carlos",
        ])
        .unwrap();
        assert!(matches!(
            cli.command,
            Command::Bot {
                action: BotAction::GrantSecret { .. }
            }
        ));
        let cli = parse(&[
            "bot",
            "revoke-secret",
            "--bot",
            "b1",
            "--workspace",
            "w1",
            "--secret-ref",
            "GITHUB_TOKEN_REF",
        ])
        .unwrap();
        assert!(matches!(
            cli.command,
            Command::Bot {
                action: BotAction::RevokeSecret { .. }
            }
        ));
        let cli = parse(&["bot", "list-grants", "--bot", "b1", "--workspace", "w1"]).unwrap();
        assert!(matches!(
            cli.command,
            Command::Bot {
                action: BotAction::ListGrants { .. }
            }
        ));
        // Empty scope ids and refs are usage errors.
        let cli = parse(&[
            "bot",
            "grant-secret",
            "--bot",
            "",
            "--workspace",
            "w1",
            "--secret-ref",
            "X",
            "--kind",
            "github",
        ])
        .unwrap();
        assert!(cli.validate().is_err());
        let cli = parse(&[
            "bot",
            "grant-secret",
            "--bot",
            "b1",
            "--workspace",
            "w1",
            "--secret-ref",
            "",
            "--kind",
            "github",
        ])
        .unwrap();
        assert!(cli.validate().is_err());
    }

    #[test]
    fn secrets_verbs_parse_and_validate() {
        let cli = parse(&[
            "secrets",
            "set",
            "--kind",
            "github",
            "--name",
            "GITHUB_TOKEN_REF",
        ])
        .unwrap();
        assert!(matches!(
            cli.command,
            Command::Secrets {
                action: SecretsAction::Set { .. }
            }
        ));
        let cli = parse(&["secrets", "list", "--kind", "github"]).unwrap();
        assert!(matches!(
            cli.command,
            Command::Secrets {
                action: SecretsAction::List { .. }
            }
        ));
        let cli = parse(&["secrets", "delete", "--kind", "github", "--name", "N"]).unwrap();
        assert!(matches!(
            cli.command,
            Command::Secrets {
                action: SecretsAction::Delete { .. }
            }
        ));
        let cli = parse(&["secrets", "set", "--kind", "", "--name", "N"]).unwrap();
        assert!(cli.validate().is_err());
    }

    #[test]
    fn bot_verbs_validate_scope_and_exclusive_trigger() {
        // Empty ids are usage errors, not round trips.
        let cli = parse(&["bot", "list", "--bot", "", "--workspace", "w1"]).unwrap();
        assert!(cli.validate().is_err());
        // --manual takes no --cron.
        let cli = parse(&[
            "bot",
            "create-monitor",
            "--bot",
            "b1",
            "--workspace",
            "w1",
            "--resource",
            "notes.md",
            "--manual",
            "--cron",
            "* * * * *",
        ])
        .unwrap();
        assert!(cli.validate().is_err());
        // Updates require at least one field.
        let cli = parse(&[
            "bot",
            "update-automation",
            "--bot",
            "b1",
            "--workspace",
            "w1",
            "--responsibility",
            "r1",
            "--expected-bot-rev",
            "3",
        ])
        .unwrap();
        assert!(cli.validate().is_err());
    }
}

#[cfg(test)]
mod mentu_tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        Cli::try_parse_from(std::iter::once("drogon-cli").chain(args.iter().copied()))
    }

    #[test]
    fn mentu_status_parses_with_and_without_a_workspace() {
        let cli = parse(&["mentu", "status"]).unwrap();
        let Command::Mentu {
            action: MentuAction::Status { workspace },
        } = &cli.command
        else {
            panic!("wrong subcommand");
        };
        assert!(workspace.is_none());
        assert!(cli.validate().is_ok());

        let cli = parse(&["mentu", "status", "--workspace", "ws-1"]).unwrap();
        let Command::Mentu {
            action: MentuAction::Status { workspace },
        } = &cli.command
        else {
            panic!("wrong subcommand");
        };
        assert_eq!(workspace.as_deref(), Some("ws-1"));
        assert!(cli.validate().is_ok());
    }

    #[test]
    fn mentu_open_parses_recipe_and_defaults_the_timeout() {
        let cli = parse(&["mentu", "open", "--workspace", "ws-1"]).unwrap();
        let Command::Mentu {
            action:
                MentuAction::Open {
                    workspace,
                    recipe,
                    timeout_ms,
                },
        } = &cli.command
        else {
            panic!("wrong subcommand");
        };
        assert_eq!(workspace, "ws-1");
        assert!(recipe.is_none());
        assert_eq!(*timeout_ms, 15_000);
        assert!(cli.validate().is_ok());

        let cli = parse(&[
            "mentu",
            "open",
            "--workspace",
            "ws-1",
            "--recipe",
            "hello",
            "--timeout-ms",
            "5000",
        ])
        .unwrap();
        let Command::Mentu {
            action: MentuAction::Open {
                recipe, timeout_ms, ..
            },
        } = &cli.command
        else {
            panic!("wrong subcommand");
        };
        assert_eq!(recipe.as_deref(), Some("hello"));
        assert_eq!(*timeout_ms, 5000);
        assert!(cli.validate().is_ok());
    }

    #[test]
    fn mentu_open_requires_a_workspace_and_rejects_empty_ids() {
        assert!(parse(&["mentu", "open", "--recipe", "hello"]).is_err());
        let empty_workspace = parse(&["mentu", "open", "--workspace", ""]).unwrap();
        assert!(empty_workspace.validate().is_err());
        let empty_recipe =
            parse(&["mentu", "open", "--workspace", "ws-1", "--recipe", ""]).unwrap();
        assert!(empty_recipe.validate().is_err());
        let empty_status = parse(&["mentu", "status", "--workspace", ""]).unwrap();
        assert!(empty_status.validate().is_err());
    }

    #[test]
    fn mentu_timeouts_are_bounded_client_side() {
        for value in ["0", "25001"] {
            let cli = parse(&[
                "mentu",
                "open",
                "--workspace",
                "ws-1",
                "--timeout-ms",
                value,
            ])
            .unwrap();
            assert!(cli.validate().is_err(), "timeout {value} must be refused");
        }
    }

    #[test]
    fn mentu_run_parses_and_defaults_the_follow_budget() {
        let cli = parse(&["mentu", "run", "--workspace", "ws-1", "--recipe", "hello"]).unwrap();
        let Command::Mentu {
            action:
                MentuAction::Run {
                    workspace,
                    recipe,
                    approval,
                    follow,
                    timeout_ms,
                },
        } = &cli.command
        else {
            panic!("wrong subcommand");
        };
        assert_eq!(workspace, "ws-1");
        assert_eq!(recipe, "hello");
        assert!(approval.is_none());
        assert!(!follow);
        assert_eq!(*timeout_ms, 900_000);
        assert!(cli.validate().is_ok());

        let cli = parse(&[
            "mentu",
            "run",
            "--workspace",
            "ws-1",
            "--recipe",
            "hello",
            "--approval",
            "appr-1",
            "--follow",
            "--timeout-ms",
            "5000",
        ])
        .unwrap();
        let Command::Mentu {
            action: MentuAction::Run { follow, .. },
        } = &cli.command
        else {
            panic!("wrong subcommand");
        };
        assert!(follow);
        assert!(cli.validate().is_ok());
    }

    #[test]
    fn mentu_run_refuses_empty_ids_and_unbounded_follow_budgets() {
        assert!(parse(&["mentu", "run", "--recipe", "hello"]).is_err());
        for args in [
            vec!["mentu", "run", "--workspace", "", "--recipe", "hello"],
            vec!["mentu", "run", "--workspace", "ws-1", "--recipe", ""],
            vec![
                "mentu",
                "run",
                "--workspace",
                "ws-1",
                "--recipe",
                "hello",
                "--approval",
                "",
            ],
        ] {
            let cli = parse(&args).unwrap();
            assert!(cli.validate().is_err(), "{args:?} must be refused");
        }
        for value in ["0", "3600001"] {
            let cli = parse(&[
                "mentu",
                "run",
                "--workspace",
                "ws-1",
                "--recipe",
                "hello",
                "--timeout-ms",
                value,
            ])
            .unwrap();
            assert!(cli.validate().is_err(), "timeout {value} must be refused");
        }
    }

    #[test]
    fn mentu_run_status_runs_and_cancel_parse_and_validate() {
        let cli = parse(&["mentu", "run-status", "--run", "run-1"]).unwrap();
        let Command::Mentu {
            action: MentuAction::RunStatus { run },
        } = &cli.command
        else {
            panic!("wrong subcommand");
        };
        assert_eq!(run, "run-1");
        assert!(cli.validate().is_ok());

        let cli = parse(&["mentu", "runs", "--workspace", "ws-1", "--limit", "10"]).unwrap();
        let Command::Mentu {
            action: MentuAction::Runs { workspace, limit },
        } = &cli.command
        else {
            panic!("wrong subcommand");
        };
        assert_eq!(workspace, "ws-1");
        assert_eq!(*limit, Some(10));
        assert!(cli.validate().is_ok());

        let cli = parse(&["mentu", "cancel", "--run", "run-1"]).unwrap();
        let Command::Mentu {
            action: MentuAction::Cancel { run },
        } = &cli.command
        else {
            panic!("wrong subcommand");
        };
        assert_eq!(run, "run-1");
        assert!(cli.validate().is_ok());

        assert!(
            parse(&["mentu", "run-status", "--run", ""])
                .unwrap()
                .validate()
                .is_err()
        );
        assert!(
            parse(&["mentu", "runs", "--workspace", "ws-1", "--limit", "0"])
                .unwrap()
                .validate()
                .is_err()
        );
        assert!(
            parse(&["mentu", "runs", "--workspace", "ws-1", "--limit", "201"])
                .unwrap()
                .validate()
                .is_err()
        );
        assert!(
            parse(&["mentu", "cancel", "--run", ""])
                .unwrap()
                .validate()
                .is_err()
        );
    }
}
