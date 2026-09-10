//! `agent-context`: the machine-readable command schema for agents (journey J3).
//!
//! MIT Copyright (c) 2026 Lovecast Inc.
//!
//! Ported shape: the reference's `src/cli/agent-context.ts`
//! (`buildAgentContext` / `formatAgentContextSummary`): `{schemaVersion,
//! commandCount, commands[]}` sorted by command, each entry carrying
//! `{command, path, aliases, argumentMode, summary, usage, flags,
//! positionalArgs, examples, notes}`. Adapted to this repo's contracts: the
//! table describes `drogon-cli`'s own verbs (including the orchestration
//! verbs and the hidden hook callback agents debug through), and — like the
//! source's "pure local read" note — it is served locally with no runtime
//! needed, so it works over SSH and in headless contexts.

use crate::commands::RunOutcome;
use crate::error::{CliError, internal_error};

const SCHEMA_VERSION: u8 = 1;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCommand {
    pub command: &'static str,
    pub path: Vec<&'static str>,
    pub aliases: Vec<Vec<&'static str>>,
    pub argument_mode: &'static str,
    pub summary: &'static str,
    pub usage: &'static str,
    pub flags: Vec<&'static str>,
    pub positional_args: Vec<&'static str>,
    pub examples: Vec<&'static str>,
    pub notes: Vec<&'static str>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Schema<'a> {
    schema_version: u8,
    command_count: usize,
    commands: &'a [AgentCommand],
}

/// Global flags every verb accepts, in the sorted order the schema uses.
fn flags(extra: &[&'static str]) -> Vec<&'static str> {
    let mut all: Vec<&'static str> = extra.to_vec();
    all.extend(["data-dir", "help", "json", "request-id", "retry-request"]);
    all.sort_unstable();
    all.dedup();
    all
}

#[allow(clippy::too_many_arguments)]
fn entry(
    command: &'static str,
    path: &[&'static str],
    summary: &'static str,
    usage: &'static str,
    extra_flags: &[&'static str],
    positional_args: &[&'static str],
    examples: &[&'static str],
    notes: &[&'static str],
) -> AgentCommand {
    let mut command_flags = extra_flags.to_vec();
    // Shared clap scope groups carry the same caller selectors on every verb.
    if path.first() == Some(&"orchestration") && extra_flags.contains(&"consumer-generation") {
        command_flags.push("from");
        if extra_flags.contains(&"task") && extra_flags.contains(&"dispatch") {
            command_flags.push("terminal");
        }
    }
    AgentCommand {
        command,
        path: path.to_vec(),
        aliases: Vec::new(),
        argument_mode: "parsed",
        summary,
        usage,
        flags: flags(&command_flags),
        positional_args: positional_args.to_vec(),
        examples: examples.to_vec(),
        notes: notes.to_vec(),
    }
}

/// Shared note for the supervised-coordination verbs.
const ORCHESTRATION_CAPABILITY: &str = "Requires the service capability orchestration.native.v1; the preflight decides before any method.";
const COORDINATOR_BINDING: &str = "Use the current Drogon terminal or --from to resolve the daemon's bound run. Explicit native bindings remain supported; stale generations are never repaired. Terminal resolution requires orchestration.terminal-bindings.v1.";

/// The full verb table, sorted by command. Keep each `usage` in the same
/// shape as the verb's clap `override_usage` line where one exists.
pub fn all_commands() -> Vec<AgentCommand> {
    let mut commands = vec![
        entry(
            "agent-context",
            &["agent-context"],
            "Print the machine-readable command schema for agents",
            "drogon-cli agent-context",
            &[],
            &[],
            &["drogon-cli agent-context --json"],
            &[
                "Pure local read of the command table — works without a running daemon, so it is safe over SSH and in headless contexts.",
            ],
        ),
        entry(
            "status",
            &["status"],
            "Show runtime identity, protocol version and capabilities",
            "drogon-cli status",
            &[],
            &[],
            &["drogon-cli status --json"],
            &[
                "Gate optional work on capabilities: harness.catalog.v1 / harness.launch.v1, orchestration.native.v1, project.v1, worktree.v1, git.v1, session.agent-state.v1, browser.relay.v1.",
            ],
        ),
        entry(
            "workspace add",
            &["workspace", "add"],
            "Register an existing directory as a workspace",
            "drogon-cli workspace add [OPTIONS] <PATH>",
            &["name"],
            &["PATH"],
            &["drogon-cli workspace add /tmp/work --name demo --json"],
            &["Relative paths resolve against the CLI process's own working directory."],
        ),
        entry(
            "workspace list",
            &["workspace", "list"],
            "List registered workspaces",
            "drogon-cli workspace list",
            &[],
            &[],
            &["drogon-cli workspace list --json"],
            &[],
        ),
        entry(
            "project add",
            &["project", "add"],
            "Register a git repository or a plain folder as a Project",
            "drogon-cli project add [OPTIONS] <PATH>",
            &["name"],
            &["PATH"],
            &["drogon-cli project add /tmp/repo --name demo --json"],
            &[
                "A git checkout registers as kind git; any other directory registers as kind folder with one implicit worktree.",
            ],
        ),
        entry(
            "project list",
            &["project", "list"],
            "List registered Projects",
            "drogon-cli project list",
            &[],
            &[],
            &["drogon-cli project list --json"],
            &[],
        ),
        entry(
            "project remove",
            &["project", "remove"],
            "Remove a Project registration (files on disk are untouched)",
            "drogon-cli project remove <ID>",
            &[],
            &["ID"],
            &["drogon-cli project remove proj-1 --json"],
            &[
                "Registration bookkeeping only: git worktrees, branches and files are untouched, exactly like worktree checkouts becoming unmanaged.",
                "Unknown ids fail with not_found.",
            ],
        ),
        entry(
            "worktree create",
            &["worktree", "create"],
            "Create a git worktree for a Project on branch NAME",
            "drogon-cli worktree create --project <ID> --name <NAME> [--base <REF>]",
            &["base", "base-branch", "name", "project"],
            &[],
            &["drogon-cli worktree create --project proj-1 --name feature --base main --json"],
            &[
                "--base-branch is an alias of --base: the new branch starts at that ref, otherwise at the project's HEAD.",
                "Refuses when a worktree with NAME already exists.",
                "Requires a git project; a folder project has one implicit worktree.",
            ],
        ),
        entry(
            "worktree list",
            &["worktree", "list"],
            "List a Project's worktrees",
            "drogon-cli worktree list --project <ID>",
            &["project"],
            &[],
            &["drogon-cli worktree list --project proj-1 --json"],
            &[],
        ),
        entry(
            "worktree rm",
            &["worktree", "rm"],
            "Remove a worktree; refuses a dirty checkout unless --force",
            "drogon-cli worktree rm <ID> [--force]",
            &["force"],
            &["ID"],
            &["drogon-cli worktree rm wt-1 --json"],
            &["Refuses a dirty checkout unless --force is passed."],
        ),
        entry(
            "terminal create",
            &["terminal", "create"],
            "Start a PTY session running COMMAND with ARGS (after --)",
            "drogon-cli terminal create --workspace <ID> -- <COMMAND> [ARGS...]",
            &["workspace"],
            &["COMMAND"],
            &["drogon-cli terminal create --workspace ws-1 -- echo hi --json"],
            &[
                "Everything after -- becomes argv verbatim with no shell interpolation.",
                "The session environment carries DROGON_* identity with <data-dir>/bin first on PATH, so drogon-cli works inside with no --data-dir flag.",
            ],
        ),
        entry(
            "terminal list",
            &["terminal", "list"],
            "List sessions, optionally scoped to one workspace",
            "drogon-cli terminal list [--workspace <ID>]",
            &["workspace"],
            &[],
            &["drogon-cli terminal list --json"],
            &[],
        ),
        entry(
            "terminal read",
            &["terminal", "read"],
            "Read bounded output from a session",
            "drogon-cli terminal read --session <ID> --incarnation <TOKEN> [--cursor <N>] [--limit-bytes <BYTES>]",
            &["cursor", "incarnation", "limit-bytes", "session"],
            &[],
            &[
                "drogon-cli terminal read --session sess-1 --incarnation tok --cursor 0 --limit-bytes 4096 --json",
            ],
            &[
                "Human output decodes the bytes for display; --json preserves the wire dataBase64/cursor fields untouched.",
                "Keep paging with the returned nextCursor while truncated is true.",
            ],
        ),
        entry(
            "terminal send",
            &["terminal", "send"],
            "Write UTF-8 text to a session (encoded to base64 exactly once)",
            "drogon-cli terminal send --session <ID> --incarnation <TOKEN> --text <TEXT>",
            &["incarnation", "session", "text"],
            &[],
            &[
                "drogon-cli terminal send --session sess-1 --incarnation tok --text 'echo hi' --json",
            ],
            &[
                "Text is encoded to base64 exactly once here, never shell interpolated anywhere.",
                "To send Enter, end the value with a real newline, not the two characters backslash-n.",
            ],
        ),
        entry(
            "terminal resize",
            &["terminal", "resize"],
            "Resize a session's PTY",
            "drogon-cli terminal resize --session <ID> --incarnation <TOKEN> --cols <COLS> --rows <ROWS>",
            &["cols", "incarnation", "rows", "session"],
            &[],
            &[
                "drogon-cli terminal resize --session sess-1 --incarnation tok --cols 120 --rows 40 --json",
            ],
            &[],
        ),
        entry(
            "terminal close",
            &["terminal", "close"],
            "Stop a session and wait for the observed exit",
            "drogon-cli terminal close --session <ID> --incarnation <TOKEN>",
            &["incarnation", "session"],
            &[],
            &["drogon-cli terminal close --session sess-1 --incarnation tok --json"],
            &[
                "Only an observed exit is a successful close: a live or unverifiable session still prints its line but the invocation exits 1.",
            ],
        ),
        entry(
            "terminal wait",
            &["terminal", "wait"],
            "Poll a session until a condition holds (client-side over session.read)",
            "drogon-cli terminal wait --session <ID> --incarnation <TOKEN> --for <exited|idle|output> --timeout-ms <MS>",
            &["for", "incarnation", "session", "timeout-ms"],
            &[],
            &[
                "drogon-cli terminal wait --session sess-1 --incarnation tok --for tui-idle --timeout-ms 60000 --json",
            ],
            &[
                "--for accepts the fork spellings exit (= exited) and tui-idle (= idle); close is the separate terminal close verb, not a wait condition.",
                "An exited session also satisfies an idle wait: it will never work again.",
                "Budget exhaustion exits 1 with code timeout naming the last observed state, never a guess about what happened after the deadline.",
            ],
        ),
        entry(
            "browser open",
            &["browser", "open"],
            "Open a URL in a new pane tab for a workspace",
            "drogon-cli browser open --workspace <ID> <URL> [--timeout-ms <MS>]",
            &["timeout-ms", "workspace"],
            &["URL"],
            &["drogon-cli browser open --workspace ws-1 https://example.com --json"],
            &[
                "Requires the service capability browser.relay.v1 and a connected Drogon desktop; without one the call fails desktop_not_connected inside its timeout.",
            ],
        ),
        entry(
            "browser navigate",
            &["browser", "navigate"],
            "Navigate an open tab to a URL",
            "drogon-cli browser navigate --tab <ID> <URL> [--timeout-ms <MS>]",
            &["tab", "timeout-ms"],
            &["URL"],
            &["drogon-cli browser navigate --tab tab-1 https://example.com/login --json"],
            &["Same desktop relay requirement as browser open."],
        ),
        entry(
            "browser snapshot",
            &["browser", "snapshot"],
            "Snapshot a tab's URL, title and bounded DOM text",
            "drogon-cli browser snapshot --tab <ID> [--timeout-ms <MS>]",
            &["tab", "timeout-ms"],
            &[],
            &["drogon-cli browser snapshot --tab tab-1 --json"],
            &["Same desktop relay requirement as browser open."],
        ),
        entry(
            "browser click",
            &["browser", "click"],
            "Click the element matching a CSS selector in a tab",
            "drogon-cli browser click --tab <ID> --selector <CSS> [--timeout-ms <MS>]",
            &["selector", "tab", "timeout-ms"],
            &[],
            &["drogon-cli browser click --tab tab-1 --selector '#submit' --json"],
            &[
                "The selector is resolved with document.querySelector in the guest.",
                "Same desktop relay requirement as browser open.",
            ],
        ),
        entry(
            "browser fill",
            &["browser", "fill"],
            "Fill the element matching a CSS selector with text",
            "drogon-cli browser fill --tab <ID> --selector <CSS> --text <TEXT> [--timeout-ms <MS>]",
            &["selector", "tab", "text", "timeout-ms"],
            &[],
            &["drogon-cli browser fill --tab tab-1 --selector '#q' --text hello --json"],
            &[
                "The selector is resolved with document.querySelector in the guest.",
                "Same desktop relay requirement as browser open.",
            ],
        ),
        entry(
            "browser tabs",
            &["browser", "tabs"],
            "List a workspace's open pane tabs",
            "drogon-cli browser tabs --workspace <ID> [--timeout-ms <MS>]",
            &["timeout-ms", "workspace"],
            &[],
            &["drogon-cli browser tabs --workspace ws-1 --json"],
            &["Same desktop relay requirement as browser open."],
        ),
        entry(
            "harness list",
            &["harness", "list"],
            "List harnesses discovered on the service's execution host",
            "drogon-cli harness list",
            &[],
            &[],
            &["drogon-cli harness list --json"],
            &[
                "Requires the service capability harness.catalog.v1; unknown future harness ids render verbatim.",
            ],
        ),
        entry(
            "harness start",
            &["harness", "start"],
            "Start a session running a harness; the service resolves the host executable",
            "drogon-cli harness start --workspace <ID> --harness <ID> [OPTIONS]",
            &[
                "effort",
                "harness",
                "model",
                "permission-mode",
                "provider",
                "prompt",
                "workspace",
            ],
            &[],
            &[
                "drogon-cli harness start --workspace ws-1 --harness pi --prompt 'fix the typo' --json",
            ],
            &[
                "Requires the service capability harness.launch.v1.",
                "The model id is exact and opaque: never guessed, never defaulted. There is nothing to point at a local binary.",
            ],
        ),
        entry(
            "automation create",
            &["automation", "create"],
            "Create a cron automation (schedule runs in UTC)",
            "drogon-cli automation create --name <NAME> --cron <EXPR> --workspace <ID> --harness <ID> --prompt <TEXT> [--disabled] [--grace-minutes <N>]",
            &[
                "cron",
                "disabled",
                "grace-minutes",
                "harness",
                "name",
                "prompt",
                "workspace",
            ],
            &[],
            &[
                "drogon-cli automation create --name nightly --cron '0 2 * * *' --workspace ws-1 --harness pi --prompt 'run the checks' --json",
            ],
            &["Requires the service capability automation.v1."],
        ),
        entry(
            "automation list",
            &["automation", "list"],
            "List automations with next run time and last outcome",
            "drogon-cli automation list",
            &[],
            &[],
            &["drogon-cli automation list --json"],
            &["Requires the service capability automation.v1."],
        ),
        entry(
            "automation run",
            &["automation", "run"],
            "Run an automation now (manual trigger, recorded in history)",
            "drogon-cli automation run --id <ID>",
            &["id"],
            &[],
            &["drogon-cli automation run --id auto-1 --json"],
            &["Requires the service capability automation.v1."],
        ),
        entry(
            "automation history",
            &["automation", "history"],
            "Show an automation's run history, newest first",
            "drogon-cli automation history --id <ID> [--limit <N>]",
            &["id", "limit"],
            &[],
            &["drogon-cli automation history --id auto-1 --limit 10 --json"],
            &["Requires the service capability automation.v1."],
        ),
        entry(
            "bot provision",
            &["bot", "provision"],
            "Provision the Bot's dedicated working folder and profile",
            "drogon-cli bot provision --bot <ID> --workspace <ID>",
            &["bot", "workspace"],
            &[],
            &["drogon-cli bot provision --bot bot-1 --workspace ws-1 --json"],
            &["Requires the service capability bot.self.v1."],
        ),
        entry(
            "bot list",
            &["bot", "list"],
            "List the Bot's own automations, monitors, home and audit count",
            "drogon-cli bot list --bot <ID> --workspace <ID>",
            &["bot", "workspace"],
            &[],
            &["drogon-cli bot list --bot bot-1 --workspace ws-1 --json"],
            &["Requires the service capability bot.self.v1."],
        ),
        entry(
            "bot create-automation",
            &["bot", "create-automation"],
            "Create one of the Bot's own scheduled automations",
            "drogon-cli bot create-automation --bot <ID> --workspace <ID> --name <NAME> --schedule <EXPR> --prompt <TEXT> [--disabled]",
            &["bot", "disabled", "name", "prompt", "schedule", "workspace"],
            &[],
            &[
                "drogon-cli bot create-automation --bot bot-1 --workspace ws-1 --name nightly --schedule '0 2 * * *' --prompt 'run the checks' --json",
            ],
            &["Requires the service capability bot.self.v1."],
        ),
        entry(
            "bot update-automation",
            &["bot", "update-automation"],
            "Edit one of the Bot's own automations (CAS on the Bot revision)",
            "drogon-cli bot update-automation --bot <ID> --workspace <ID> --responsibility <ID> --expected-bot-rev <N> [--name <NAME>] [--prompt <TEXT>] [--schedule <EXPR>]",
            &[
                "bot",
                "expected-bot-rev",
                "name",
                "prompt",
                "responsibility",
                "schedule",
                "workspace",
            ],
            &[],
            &[
                "drogon-cli bot update-automation --bot bot-1 --workspace ws-1 --responsibility resp-1 --expected-bot-rev 3 --name nightly --json",
            ],
            &["Requires the service capability bot.self.v1."],
        ),
        entry(
            "bot enable-automation",
            &["bot", "enable-automation"],
            "Enable one of the Bot's own automations (CAS on the Bot revision)",
            "drogon-cli bot enable-automation --bot <ID> --workspace <ID> --responsibility <ID> --expected-bot-rev <N>",
            &["bot", "expected-bot-rev", "responsibility", "workspace"],
            &[],
            &[
                "drogon-cli bot enable-automation --bot bot-1 --workspace ws-1 --responsibility resp-1 --expected-bot-rev 3 --json",
            ],
            &["Requires the service capability bot.self.v1."],
        ),
        entry(
            "bot disable-automation",
            &["bot", "disable-automation"],
            "Disable one of the Bot's own automations (CAS on the Bot revision)",
            "drogon-cli bot disable-automation --bot <ID> --workspace <ID> --responsibility <ID> --expected-bot-rev <N>",
            &["bot", "expected-bot-rev", "responsibility", "workspace"],
            &[],
            &[
                "drogon-cli bot disable-automation --bot bot-1 --workspace ws-1 --responsibility resp-1 --expected-bot-rev 3 --json",
            ],
            &["Requires the service capability bot.self.v1."],
        ),
        entry(
            "bot delete-automation",
            &["bot", "delete-automation"],
            "Delete one of the Bot's own automations (run history is retained)",
            "drogon-cli bot delete-automation --bot <ID> --workspace <ID> --responsibility <ID>",
            &["bot", "responsibility", "workspace"],
            &[],
            &[
                "drogon-cli bot delete-automation --bot bot-1 --workspace ws-1 --responsibility resp-1 --json",
            ],
            &["Requires the service capability bot.self.v1."],
        ),
        entry(
            "bot test-automation",
            &["bot", "test-automation"],
            "Admission-only test of one of the Bot's own automations (no dispatch)",
            "drogon-cli bot test-automation --bot <ID> --workspace <ID> --responsibility <ID>",
            &["bot", "responsibility", "workspace"],
            &[],
            &[
                "drogon-cli bot test-automation --bot bot-1 --workspace ws-1 --responsibility resp-1 --json",
            ],
            &["Requires the service capability bot.self.v1."],
        ),
        entry(
            "bot create-monitor",
            &["bot", "create-monitor"],
            "Create one of the Bot's own file monitors (in-scope resources only)",
            "drogon-cli bot create-monitor --bot <ID> --workspace <ID> --resource <PATH> [--max-bytes <N>] [--cron <EXPR> | --manual] [--disabled]",
            &[
                "bot",
                "cron",
                "disabled",
                "manual",
                "max-bytes",
                "resource",
                "workspace",
            ],
            &[],
            &[
                "drogon-cli bot create-monitor --bot bot-1 --workspace ws-1 --resource notes.md --cron '* * * * *' --json",
            ],
            &["Requires the service capability bot.self.v1."],
        ),
        entry(
            "bot update-monitor",
            &["bot", "update-monitor"],
            "Edit one of the Bot's own monitors (CAS on the monitor revision)",
            "drogon-cli bot update-monitor --bot <ID> --workspace <ID> --monitor <ID> --expected-rev <N> [--resource <PATH>] [--max-bytes <N>] [--cron <EXPR> | --manual]",
            &[
                "bot",
                "cron",
                "expected-rev",
                "manual",
                "max-bytes",
                "monitor",
                "resource",
                "workspace",
            ],
            &[],
            &[
                "drogon-cli bot update-monitor --bot bot-1 --workspace ws-1 --monitor mon-1 --expected-rev 1 --resource notes.md --json",
            ],
            &["Requires the service capability bot.self.v1."],
        ),
        entry(
            "bot enable-monitor",
            &["bot", "enable-monitor"],
            "Enable one of the Bot's own monitors (CAS on the monitor revision)",
            "drogon-cli bot enable-monitor --bot <ID> --workspace <ID> --monitor <ID> --expected-rev <N>",
            &["bot", "expected-rev", "monitor", "workspace"],
            &[],
            &[
                "drogon-cli bot enable-monitor --bot bot-1 --workspace ws-1 --monitor mon-1 --expected-rev 1 --json",
            ],
            &["Requires the service capability bot.self.v1."],
        ),
        entry(
            "bot disable-monitor",
            &["bot", "disable-monitor"],
            "Disable one of the Bot's own monitors (CAS on the monitor revision)",
            "drogon-cli bot disable-monitor --bot <ID> --workspace <ID> --monitor <ID> --expected-rev <N>",
            &["bot", "expected-rev", "monitor", "workspace"],
            &[],
            &[
                "drogon-cli bot disable-monitor --bot bot-1 --workspace ws-1 --monitor mon-1 --expected-rev 1 --json",
            ],
            &["Requires the service capability bot.self.v1."],
        ),
        entry(
            "bot delete-monitor",
            &["bot", "delete-monitor"],
            "Delete one of the Bot's own monitors (check history is retained)",
            "drogon-cli bot delete-monitor --bot <ID> --workspace <ID> --monitor <ID>",
            &["bot", "monitor", "workspace"],
            &[],
            &["drogon-cli bot delete-monitor --bot bot-1 --workspace ws-1 --monitor mon-1 --json"],
            &["Requires the service capability bot.self.v1."],
        ),
        entry(
            "bot test-monitor",
            &["bot", "test-monitor"],
            "Dry-run test of one of the Bot's own monitors (no cursor commit)",
            "drogon-cli bot test-monitor --bot <ID> --workspace <ID> --monitor <ID>",
            &["bot", "monitor", "workspace"],
            &[],
            &["drogon-cli bot test-monitor --bot bot-1 --workspace ws-1 --monitor mon-1 --json"],
            &["Requires the service capability bot.self.v1."],
        ),
        entry(
            "bot grant-secret",
            &["bot", "grant-secret"],
            "Grant an integration secret reference to a Bot (user-only; the value stays in the sealed store, grant and user are audited; revocation hits the NEXT tick)",
            "drogon-cli bot grant-secret --bot <ID> --workspace <ID> --secret-ref <NAME> --kind <KIND> [--granted-by <USER>]",
            &["bot", "granted-by", "kind", "secret-ref", "workspace"],
            &[],
            &[
                "drogon-cli bot grant-secret --bot bot-1 --workspace ws-1 --secret-ref GITHUB_TOKEN_REF --kind github --granted-by carlos --json",
            ],
            &["Requires the service capability bot.secrets.v1."],
        ),
        entry(
            "bot revoke-secret",
            &["bot", "revoke-secret"],
            "Revoke a Bot's secret reference grant (user-only; the Bot's next monitor tick refuses)",
            "drogon-cli bot revoke-secret --bot <ID> --workspace <ID> --secret-ref <NAME>",
            &["bot", "secret-ref", "workspace"],
            &[],
            &[
                "drogon-cli bot revoke-secret --bot bot-1 --workspace ws-1 --secret-ref GITHUB_TOKEN_REF --json",
            ],
            &["Requires the service capability bot.secrets.v1."],
        ),
        entry(
            "bot list-grants",
            &["bot", "list-grants"],
            "List a Bot's secret reference grants (names and metadata, never values)",
            "drogon-cli bot list-grants --bot <ID> --workspace <ID>",
            &["bot", "workspace"],
            &[],
            &["drogon-cli bot list-grants --bot bot-1 --workspace ws-1 --json"],
            &["Requires the service capability bot.secrets.v1."],
        ),
        entry(
            "secrets set",
            &["secrets", "set"],
            "Seal an integration secret value into the daemon store (value from stdin, never argv or echo)",
            "drogon-cli secrets set --kind <KIND> --name <NAME> < value-on-stdin",
            &["kind", "name"],
            &[],
            &[
                "printf '%s' \"$GITHUB_TOKEN\" | drogon-cli secrets set --kind github --name GITHUB_TOKEN_REF --json",
            ],
            &["Requires the service capability bot.secrets.v1."],
        ),
        entry(
            "secrets list",
            &["secrets", "list"],
            "List configured secret names for an integration kind (never values)",
            "drogon-cli secrets list --kind <KIND>",
            &["kind"],
            &[],
            &["drogon-cli secrets list --kind github --json"],
            &["Requires the service capability bot.secrets.v1."],
        ),
        entry(
            "secrets delete",
            &["secrets", "delete"],
            "Delete a sealed integration secret value (grants stay; resolution reports missing until re-set)",
            "drogon-cli secrets delete --kind <KIND> --name <NAME>",
            &["kind", "name"],
            &[],
            &["drogon-cli secrets delete --kind github --name GITHUB_TOKEN_REF --json"],
            &["Requires the service capability bot.secrets.v1."],
        ),
        entry(
            "orchestration run-create",
            &["orchestration", "run-create"],
            "Create a run bound to a coordinator (initial generation is server-owned)",
            "drogon-cli orchestration run-create --objective <TEXT> [--coordinator-id <ID>]",
            &["coordinator-id", "from", "host", "objective"],
            &[],
            &["drogon-cli orchestration run-create --objective 'fix the bug' --json"],
            &[ORCHESTRATION_CAPABILITY],
        ),
        entry(
            "orchestration run-current",
            &["orchestration", "run-current"],
            "Show the run explicitly bound to a coordinator identity",
            "drogon-cli orchestration run-current --coordinator-id <ID>",
            &["coordinator-id", "from", "host"],
            &[],
            &["drogon-cli orchestration run-current --coordinator-id coord-1 --json"],
            &[
                ORCHESTRATION_CAPABILITY,
                "Reads the persisted binding; never guesses the latest run.",
            ],
        ),
        entry(
            "orchestration run-list",
            &["orchestration", "run-list"],
            "List runs (bounded pagination, default limit 100)",
            "drogon-cli orchestration run-list [--limit <N>] [--cursor <TOKEN>]",
            &["cursor", "host", "limit"],
            &[],
            &["drogon-cli orchestration run-list --json"],
            &[ORCHESTRATION_CAPABILITY],
        ),
        entry(
            "orchestration run-show",
            &["orchestration", "run-show"],
            "Show one run",
            "drogon-cli orchestration run-show --run <ID>",
            &["host", "id", "run"],
            &[],
            &["drogon-cli orchestration run-show --run run-1 --json"],
            &[ORCHESTRATION_CAPABILITY],
        ),
        entry(
            "orchestration run-use",
            &["orchestration", "run-use"],
            "Bind this coordinator to a run (takeover explicitly advances the fence)",
            "drogon-cli orchestration run-use --run <ID> --coordinator-id <ID> --consumer-generation <N> [--takeover]",
            &[
                "consumer-generation",
                "coordinator-id",
                "host",
                "id",
                "run",
                "takeover",
            ],
            &[],
            &[
                "drogon-cli orchestration run-use --run run-1 --coordinator-id coord-1 --consumer-generation 1 --json",
            ],
            &[ORCHESTRATION_CAPABILITY, COORDINATOR_BINDING],
        ),
        entry(
            "orchestration task-create",
            &["orchestration", "task-create"],
            "Create a task with an immutable spec",
            "drogon-cli orchestration task-create --run <ID> --coordinator-id <ID> --consumer-generation <N> --instructions <TEXT>",
            &[
                "consumer-generation",
                "coordinator-id",
                "depends-on",
                "display-name",
                "host",
                "instructions",
                "spec",
                "task-title",
                "deps",
                "parent",
                "run",
                "title",
            ],
            &[],
            &[
                "drogon-cli orchestration task-create --run run-1 --coordinator-id coord-1 --consumer-generation 1 --instructions 'do it' --json",
            ],
            &[ORCHESTRATION_CAPABILITY, COORDINATOR_BINDING],
        ),
        entry(
            "orchestration gate-create",
            &["orchestration", "gate-create"],
            "Block a task on a durable decision gate",
            "drogon-cli orchestration gate-create --run <ID> --coordinator-id <ID> --consumer-generation <N> --task <ID> --question <TEXT> [--options <JSON>]",
            &[
                "run",
                "coordinator-id",
                "consumer-generation",
                "task",
                "question",
                "options",
                "host",
            ],
            &[],
            &[
                "drogon-cli orchestration gate-create --run run-1 --coordinator-id coord-1 --consumer-generation 1 --task task-1 --question 'Deploy?' --json",
            ],
            &[ORCHESTRATION_CAPABILITY, COORDINATOR_BINDING],
        ),
        entry(
            "orchestration gate-resolve",
            &["orchestration", "gate-resolve"],
            "Resolve a gate and return its task to ready",
            "drogon-cli orchestration gate-resolve --run <ID> --coordinator-id <ID> --consumer-generation <N> --id <ID> --resolution <TEXT>",
            &[
                "run",
                "coordinator-id",
                "consumer-generation",
                "id",
                "resolution",
                "host",
            ],
            &[],
            &[
                "drogon-cli orchestration gate-resolve --run run-1 --coordinator-id coord-1 --consumer-generation 1 --id gate-1 --resolution approved --json",
            ],
            &[ORCHESTRATION_CAPABILITY, COORDINATOR_BINDING],
        ),
        entry(
            "orchestration gate-list",
            &["orchestration", "gate-list"],
            "List decision gates in the bound run",
            "drogon-cli orchestration gate-list --run <ID> --coordinator-id <ID> --consumer-generation <N> [--task <ID>] [--status <STATUS>]",
            &[
                "run",
                "coordinator-id",
                "consumer-generation",
                "task",
                "status",
                "host",
            ],
            &[],
            &[
                "drogon-cli orchestration gate-list --run run-1 --coordinator-id coord-1 --consumer-generation 1 --status pending --json",
            ],
            &[ORCHESTRATION_CAPABILITY, COORDINATOR_BINDING],
        ),
        entry(
            "orchestration task-update",
            &["orchestration", "task-update"],
            "Update task status after its active worker has stopped or settled",
            "drogon-cli orchestration task-update --run <ID> --coordinator-id <ID> --consumer-generation <N> --id <ID> --status <STATUS> [--result <TEXT>]",
            &[
                "run",
                "coordinator-id",
                "consumer-generation",
                "task",
                "id",
                "status",
                "result",
                "host",
            ],
            &[],
            &[
                "drogon-cli orchestration task-update --run run-1 --coordinator-id coord-1 --consumer-generation 1 --id task-1 --status completed --json",
            ],
            &[ORCHESTRATION_CAPABILITY, COORDINATOR_BINDING],
        ),
        entry(
            "orchestration task-list",
            &["orchestration", "task-list"],
            "List tasks in the bound run",
            "drogon-cli orchestration task-list --run <ID> --coordinator-id <ID> --consumer-generation <N>",
            &[
                "brief",
                "consumer-generation",
                "coordinator-id",
                "cursor",
                "host",
                "limit",
                "ready",
                "run",
                "status",
            ],
            &[],
            &[
                "drogon-cli orchestration task-list --run run-1 --coordinator-id coord-1 --consumer-generation 1 --json",
            ],
            &[ORCHESTRATION_CAPABILITY, COORDINATOR_BINDING],
        ),
        entry(
            "orchestration task-show",
            &["orchestration", "task-show"],
            "Show one task with its full spec and attempt history",
            "drogon-cli orchestration task-show --run <ID> --coordinator-id <ID> --consumer-generation <N> --task <ID>",
            &[
                "consumer-generation",
                "coordinator-id",
                "host",
                "run",
                "task",
            ],
            &[],
            &[
                "drogon-cli orchestration task-show --run run-1 --coordinator-id coord-1 --consumer-generation 1 --task task-1 --json",
            ],
            &[ORCHESTRATION_CAPABILITY, COORDINATOR_BINDING],
        ),
        entry(
            "orchestration worker-start",
            &["orchestration", "worker-start"],
            "Start exactly one worker attempt in a registered workspace",
            "drogon-cli orchestration worker-start --run <ID> --coordinator-id <ID> --consumer-generation <N> --task <ID> --workspace <ID>",
            &[
                "comment",
                "consumer-generation",
                "coordinator-id",
                "display-name",
                "effort",
                "harness",
                "host",
                "model",
                "permission-mode",
                "provider",
                "retry-of",
                "reuse-incarnation",
                "reuse-session",
                "run",
                "task",
                "timeout-ms",
                "workspace",
            ],
            &[],
            &[
                "drogon-cli orchestration worker-start --run run-1 --coordinator-id coord-1 --consumer-generation 1 --task task-1 --workspace ws-1 --harness pi --json",
            ],
            &[
                ORCHESTRATION_CAPABILITY,
                COORDINATOR_BINDING,
                "Fresh launch (--harness) and reuse (--reuse-session) are exclusive.",
            ],
        ),
        entry(
            "orchestration worker-show",
            &["orchestration", "worker-show"],
            "Show one worker attempt with exact session identity",
            "drogon-cli orchestration worker-show --run <ID> --coordinator-id <ID> --consumer-generation <N> --dispatch <ID>",
            &[
                "consumer-generation",
                "coordinator-id",
                "dispatch",
                "host",
                "run",
            ],
            &[],
            &[
                "drogon-cli orchestration worker-show --run run-1 --coordinator-id coord-1 --consumer-generation 1 --dispatch disp-1 --json",
            ],
            &[ORCHESTRATION_CAPABILITY, COORDINATOR_BINDING],
        ),
        entry(
            "orchestration worker-read",
            &["orchestration", "worker-read"],
            "Read bounded worker output with opaque cursors",
            "drogon-cli orchestration worker-read --run <ID> --coordinator-id <ID> --consumer-generation <N> --dispatch <ID>",
            &[
                "consumer-generation",
                "coordinator-id",
                "cursor",
                "dispatch",
                "host",
                "limit",
                "run",
                "source",
            ],
            &[],
            &[
                "drogon-cli orchestration worker-read --run run-1 --coordinator-id coord-1 --consumer-generation 1 --dispatch disp-1 --json",
            ],
            &[ORCHESTRATION_CAPABILITY, COORDINATOR_BINDING],
        ),
        entry(
            "orchestration worker-stop",
            &["orchestration", "worker-stop"],
            "Stop a worker: fence commits before any signal attempt",
            "drogon-cli orchestration worker-stop --run <ID> --coordinator-id <ID> --consumer-generation <N> --dispatch <ID>",
            &[
                "consumer-generation",
                "coordinator-id",
                "dispatch",
                "host",
                "run",
            ],
            &[],
            &[
                "drogon-cli orchestration worker-stop --run run-1 --coordinator-id coord-1 --consumer-generation 1 --dispatch disp-1 --json",
            ],
            &[ORCHESTRATION_CAPABILITY, COORDINATOR_BINDING],
        ),
        entry(
            "orchestration worker-abandon",
            &["orchestration", "worker-abandon"],
            "Abandon a worker without ever signalling its process",
            "drogon-cli orchestration worker-abandon --run <ID> --coordinator-id <ID> --consumer-generation <N> --dispatch <ID>",
            &[
                "consumer-generation",
                "coordinator-id",
                "dispatch",
                "host",
                "reason",
                "run",
            ],
            &[],
            &[
                "drogon-cli orchestration worker-abandon --run run-1 --coordinator-id coord-1 --consumer-generation 1 --dispatch disp-1 --json",
            ],
            &[ORCHESTRATION_CAPABILITY, COORDINATOR_BINDING],
        ),
        entry(
            "orchestration worker-release",
            &["orchestration", "worker-release"],
            "Release a settled worker's resources (retained/no-owned-resource honest)",
            "drogon-cli orchestration worker-release --run <ID> --coordinator-id <ID> --consumer-generation <N> --dispatch <ID>",
            &[
                "consumer-generation",
                "coordinator-id",
                "dispatch",
                "host",
                "run",
            ],
            &[],
            &[
                "drogon-cli orchestration worker-release --run run-1 --coordinator-id coord-1 --consumer-generation 1 --dispatch disp-1 --json",
            ],
            &[ORCHESTRATION_CAPABILITY, COORDINATOR_BINDING],
        ),
        entry(
            "orchestration worker-retain",
            &["orchestration", "worker-retain"],
            "Retain a worker's resources (durable user-requested hold, no process effects)",
            "drogon-cli orchestration worker-retain --run <ID> --coordinator-id <ID> --consumer-generation <N> --dispatch <ID>",
            &[
                "consumer-generation",
                "coordinator-id",
                "dispatch",
                "host",
                "run",
            ],
            &[],
            &[
                "drogon-cli orchestration worker-retain --run run-1 --coordinator-id coord-1 --consumer-generation 1 --dispatch disp-1 --json",
            ],
            &[ORCHESTRATION_CAPABILITY, COORDINATOR_BINDING],
        ),
        entry(
            "orchestration send",
            &["orchestration", "send"],
            "Send a scoped coordination message",
            "drogon-cli orchestration send --kind <KIND> --subject <TEXT>",
            &[
                "body",
                "consumer-generation",
                "coordinator-id",
                "dispatch",
                "host",
                "kind",
                "type",
                "task-id",
                "dispatch-id",
                "outcome",
                "payload",
                "result",
                "run",
                "subject",
                "task",
                "thread-id",
                "to",
            ],
            &[],
            &[
                "drogon-cli orchestration send --run run-1 --coordinator-id coord-1 --consumer-generation 1 --kind heartbeat --subject alive --json",
            ],
            &[
                ORCHESTRATION_CAPABILITY,
                "Dual-actor verb: pass either the coordinator binding or the dispatch binding.",
            ],
        ),
        entry(
            "orchestration check",
            &["orchestration", "check"],
            "Consume or inspect the actor's mailbox (whole-FIFO batch, explicit ACK)",
            "drogon-cli orchestration check [--peek] [--wait --timeout-ms <MS>]",
            &[
                "ack",
                "all",
                "consumer-generation",
                "coordinator-id",
                "cursor",
                "dispatch",
                "host",
                "inject",
                "kinds",
                "types",
                "task-id",
                "dispatch-id",
                "limit",
                "peek",
                "run",
                "task",
                "timeout-ms",
                "wait",
            ],
            &[],
            &[
                "drogon-cli orchestration check --run run-1 --coordinator-id coord-1 --consumer-generation 1 --peek --json",
            ],
            &[
                ORCHESTRATION_CAPABILITY,
                "Dual-actor verb: pass either the coordinator binding or the dispatch binding.",
            ],
        ),
        entry(
            "orchestration reply",
            &["orchestration", "reply"],
            "Answer a question, retaining its correlation id",
            "drogon-cli orchestration reply --question <MSG-ID> --body <TEXT>",
            &[
                "body",
                "consumer-generation",
                "coordinator-id",
                "dispatch",
                "host",
                "id",
                "task-id",
                "dispatch-id",
                "question",
                "run",
                "task",
                "thread-id",
            ],
            &[],
            &[
                "drogon-cli orchestration reply --run run-1 --coordinator-id coord-1 --consumer-generation 1 --question msg-1 --body yes --json",
            ],
            &[
                ORCHESTRATION_CAPABILITY,
                "Dual-actor verb: pass either the coordinator binding or the dispatch binding.",
            ],
        ),
        entry(
            "orchestration ask",
            &["orchestration", "ask"],
            "Ask a question (commit + bounded wait) or resume a pending one",
            "drogon-cli orchestration ask --question <TEXT> [--options <CSV>] [--timeout-ms <MS>]",
            &[
                "consumer-generation",
                "coordinator-id",
                "dispatch",
                "host",
                "option",
                "options",
                "task-id",
                "dispatch-id",
                "question",
                "resume",
                "run",
                "task",
                "timeout-ms",
                "to",
            ],
            &[],
            &[
                "drogon-cli orchestration ask --run run-1 --coordinator-id coord-1 --consumer-generation 1 --question 'proceed?' --timeout-ms 600000 --json",
            ],
            &[
                ORCHESTRATION_CAPABILITY,
                "Dual-actor verb: pass either the coordinator binding or the dispatch binding.",
            ],
        ),
        entry(
            "orchestration request-show",
            &["orchestration", "request-show"],
            "Recover a receipt by id from an explicit receipt scope",
            "drogon-cli orchestration request-show --request <ID> --scope <SCOPE>",
            &[
                "bootstrap-coordinator-id",
                "consumer-generation",
                "coordinator-id",
                "dispatch",
                "host",
                "request",
                "task-id",
                "dispatch-id",
                "run",
                "scope",
                "task",
            ],
            &[],
            &[
                "drogon-cli orchestration request-show --request req-1 --scope bootstrap --bootstrap-coordinator-id coord-1 --json",
            ],
            &[ORCHESTRATION_CAPABILITY],
        ),
        entry(
            "internal hook-event",
            &["internal", "hook-event"],
            "Service-internal callback: report a harness wait/clear signal for a session",
            "drogon-cli internal hook-event --session <ID> --incarnation <TOKEN> --event <NAME>",
            &["event", "incarnation", "session"],
            &[],
            &[],
            &[
                "Hidden: not a user verb, only invoked by generated hook commands (Claude settings hooks, the OpenCode status plugin, the Pi agent-status extension).",
                "Hook payloads on stdin are drained and ignored; the invocation already names session, incarnation and event via flags.",
            ],
        ),
        entry(
            "rpc",
            &["rpc"],
            "Diagnostic passthrough for a raw protocol method",
            "drogon-cli rpc <METHOD> [--params <JSON>]",
            &["params"],
            &["METHOD"],
            &["drogon-cli rpc status --json"],
            &[
                "Prints the validated wire envelope in both modes; there is no human form and no invariant checks for arbitrary methods.",
            ],
        ),
        entry(
            "skills list",
            &["skills", "list"],
            "List version-matched skill guides bundled with this CLI",
            "drogon-cli skills list",
            &[],
            &[],
            &["drogon-cli skills list --json"],
            &["Pure local read of bundled guide metadata — works without a running daemon."],
        ),
        entry(
            "mentu open",
            &["mentu", "open"],
            "Open (or focus) the workspace's Mentu tab in the connected Drogon desktop",
            "drogon-cli mentu open --workspace <ID> [--recipe <ID>] [--timeout-ms <MS>]",
            &["recipe", "timeout-ms", "workspace"],
            &[],
            &[
                "drogon-cli mentu open --workspace ws-1 --recipe hello",
                "drogon-cli mentu open --workspace ws-1",
            ],
            &[
                "Requires mentu.v1 for the tab and browser.relay.v1 plus a connected Drogon desktop for the transport; without a desktop the call fails desktop_not_connected inside its timeout.",
                "Success means the desktop's own renderer confirmed the tab — a refusal (desktop_unavailable, mentu_unavailable, mentu_workspace_unknown, mentu_open_timeout) is an RPC error, never a silent success.",
                "Use this to hand a human the recipe you just wrote; it never runs the recipe.",
            ],
        ),
        entry(
            "mentu status",
            &["mentu", "status"],
            "Report honestly whether the optional Mentu environment is installed on this host",
            "drogon-cli mentu status [--workspace <ID>]",
            &["workspace"],
            &[],
            &[
                "drogon-cli mentu status --workspace ws-1 --json",
                "drogon-cli mentu status",
            ],
            &[
                "Requires the service capability mentu.v1; without it the daemon has no Mentu surface to report on.",
                "verdict is installed, not_installed or partially_available — check it BEFORE promising a recipe, because the Mentu runtime is optional.",
                "With --workspace the result also counts that workspace's .mentu/recipes entries and lists each invalid one's issue.",
            ],
        ),
        entry(
            "skills get",
            &["skills", "get"],
            "Print a version-matched skill guide as Markdown",
            "drogon-cli skills get --topic <TOPIC> [--full]",
            &[],
            &[],
            &["drogon-cli skills get --topic drogon-cli"],
            &[
                "Pure local read of bundled guide content — works without a running daemon.",
                "Unknown topics are usage errors (exit 2).",
                "For supervised multi-agent coordination, read the orchestration guide.",
            ],
        ),
        entry(
            "skills install",
            &["skills", "install"],
            "Install skills into the coding agents detected on this host",
            "drogon-cli skills install (--skill <NAME> [--skill <NAME> ...] | --all) [--agent <NAME>[,<NAME>...]] [--local] [--dry-run]",
            &["agent", "all", "dry-run", "local", "skill"],
            &[],
            &["drogon-cli skills install --skill drogon-cli --dry-run"],
            &[
                "Pure local command surface — works without a running daemon; the real install runs npx with inherited stdio.",
                "--agent universal writes only the shared .agents/skills directory that Drogon reads.",
                "--json only supports --dry-run.",
            ],
        ),
        entry(
            "skills update",
            &["skills", "update"],
            "Update already-installed skills",
            "drogon-cli skills update (--skill <NAME> [--skill <NAME> ...] | --all) [--local] [--dry-run]",
            &["all", "dry-run", "local", "skill"],
            &[],
            &["drogon-cli skills update --all --dry-run"],
            &[
                "Update only refreshes what is already placed; it takes no --agent targets.",
                "Pure local command surface — works without a running daemon.",
            ],
        ),
    ];
    commands.sort_by(|left, right| left.command.cmp(right.command));
    commands
}

/// Human summary: bounded, pointing at `--json` for the full surface, like
/// the source's `formatAgentContextSummary`.
pub fn summary_text(commands: &[AgentCommand]) -> String {
    format!(
        "{} commands (schema v{}).\nRun `drogon-cli agent-context --json` for the full machine-readable command schema.",
        commands.len(),
        SCHEMA_VERSION
    )
}

pub fn run(request_id: &str, json: bool) -> Result<RunOutcome, CliError> {
    let commands = all_commands();
    if json {
        let schema = Schema {
            schema_version: SCHEMA_VERSION,
            command_count: commands.len(),
            commands: &commands,
        };
        let stdout = serde_json::to_string_pretty(&schema).map_err(|err| {
            CliError::local(
                internal_error(format!("cannot encode response: {err}")),
                request_id,
            )
        })?;
        Ok(RunOutcome {
            stdout,
            exit_code: 0,
            stderr_note: None,
        })
    } else {
        Ok(RunOutcome {
            stdout: summary_text(&commands),
            exit_code: 0,
            stderr_note: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory as _;

    use crate::cli::Cli;

    #[test]
    fn schema_counts_and_sorts_everything() {
        let commands = all_commands();
        assert!(
            commands.len() >= 50,
            "the table must cover the whole surface, got {}",
            commands.len()
        );
        let mut names: Vec<&str> = commands.iter().map(|entry| entry.command).collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        assert_eq!(names, sorted, "entries must be sorted by command");
        names.dedup();
        assert_eq!(names.len(), commands.len(), "command names must be unique");
        for entry in &commands {
            assert_eq!(
                entry.command,
                entry.path.join(" "),
                "command must equal its joined path"
            );
            assert!(
                entry.flags.contains(&"json") && entry.flags.contains(&"help"),
                "{:?} must list the global flags",
                entry.path
            );
            let mut flags = entry.flags.clone();
            flags.sort_unstable();
            assert_eq!(flags, entry.flags, "{:?} flags must be sorted", entry.path);
        }
    }

    /// The schema cannot drift from the grammar: every table path resolves
    /// to a real clap subcommand, and every clap leaf has a table row.
    #[test]
    fn every_table_path_resolves_in_the_clap_grammar() {
        fn find<'cmd>(cmd: &'cmd clap::Command, path: &[&str]) -> Option<&'cmd clap::Command> {
            let mut current = cmd;
            for segment in path {
                current = current.find_subcommand(*segment)?;
            }
            Some(current)
        }
        let root = Cli::command();
        for entry in all_commands() {
            assert!(
                find(&root, &entry.path).is_some(),
                "agent-context path {:?} has no clap subcommand",
                entry.path
            );
        }
    }

    #[test]
    fn orchestration_flags_and_visible_aliases_match_the_agent_schema() {
        let mut root = Cli::command();
        root.build();
        for entry in all_commands()
            .into_iter()
            .filter(|e| e.path[0] == "orchestration")
        {
            let mut command = &root;
            for segment in &entry.path {
                command = command.find_subcommand(*segment).unwrap();
            }
            let mut grammar = std::collections::BTreeSet::new();
            for arg in command.get_arguments() {
                if let Some(long) = arg.get_long() {
                    grammar.insert(long);
                }
                if let Some(aliases) = arg.get_visible_aliases() {
                    grammar.extend(aliases);
                }
            }
            let advertised: std::collections::BTreeSet<_> = entry.flags.into_iter().collect();
            assert_eq!(
                advertised, grammar,
                "{} flags drifted from the parser",
                entry.command
            );
        }
    }

    #[test]
    fn clap_leaves_all_appear_in_the_table() {
        fn leaves(cmd: &clap::Command, prefix: Vec<String>, out: &mut Vec<String>) {
            let subs: Vec<&clap::Command> = cmd.get_subcommands().collect();
            if subs.is_empty() {
                out.push(prefix.join(" "));
                return;
            }
            for sub in subs {
                let mut next = prefix.clone();
                next.push(sub.get_name().to_string());
                leaves(sub, next, out);
            }
        }
        let mut uncovered = Vec::new();
        leaves(&Cli::command(), Vec::new(), &mut uncovered);
        let known: std::collections::HashSet<String> = all_commands()
            .into_iter()
            .map(|entry| entry.command.to_string())
            .collect();
        let missing: Vec<String> = uncovered
            .into_iter()
            .filter(|leaf| !known.contains(leaf))
            .collect();
        assert!(
            missing.is_empty(),
            "clap verbs missing from agent-context: {missing:?}"
        );
    }

    #[test]
    fn examples_use_protocol_valid_consumer_generations() {
        for entry in all_commands() {
            for example in entry.examples {
                let words: Vec<_> = example.split_whitespace().collect();
                for pair in words.windows(2) {
                    if pair[0] == "--consumer-generation" {
                        let generation = pair[1].parse().expect("numeric generation example");
                        drogon_protocol::orchestration_common::validate_consumer_generation(
                            generation,
                        )
                        .unwrap_or_else(|error| panic!("{example}: {error}"));
                    }
                }
            }
        }
    }

    #[test]
    fn journey_verbs_are_present() {
        let known: std::collections::HashSet<String> = all_commands()
            .into_iter()
            .map(|entry| entry.command.to_string())
            .collect();
        for verb in [
            "agent-context",
            "status",
            "project add",
            "project list",
            "project remove",
            "worktree create",
            "worktree list",
            "worktree rm",
            "terminal create",
            "terminal list",
            "terminal send",
            "terminal read",
            "terminal wait",
            "terminal close",
            "browser open",
            "browser tabs",
            "browser snapshot",
            "browser click",
            "browser fill",
            "browser navigate",
            "skills list",
            "skills get",
            "internal hook-event",
            "orchestration ask",
            "orchestration send",
        ] {
            assert!(known.contains(verb), "agent-context is missing {verb:?}");
        }
    }
}
