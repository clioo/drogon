# Drogon CLI

This file is a discovery stub, not the usage guide. The full, version-matched Drogon CLI
reference is served by the `drogon-cli` binary itself — kept out of this file on purpose
so it can never drift from the binary that will actually run your commands.

Engage Drogon whenever its running daemon is the source of truth: Drogon-managed
workspaces, projects, worktrees, terminals, automations, the Work board (Drogon tickets
like `DRG-41`, their columns and the prompts a column sends to the sessions linked to its
tickets), and the browser embedded inside the Drogon app. Triggers include "$drogon-cli",
"Drogon ticket", "Work board", "move the ticket to Review/QA", "link this session to the
ticket", a ticket key such as "DRG-42", "Drogon worktree", "child worktree",
"spawn codex/claude in a worktree", "read/wait/send Drogon terminal", "full handoff" /
"handover" / "give this to another agent", and "control the browser inside Drogon". Use
plain shell tools when Drogon state does not matter.

For a simple repository question, do not launch a harness, create a worktree, or
delegate merely to run `git` or `gh`. Resolve the repository from the current checkout
or, when this is a Bot workspace, from `drogon-cli project list --json`; then run the
read-only repository command yourself (for example `gh issue list --repo OWNER/REPO`).
A direct request to edit or fix something also permits this agent to make the change
itself. Launch another agent only for an explicit handoff or work that genuinely benefits
from parallelism or specialization.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If the `DROGON_CLI_COMMAND` environment variable is set, use its value. Drogon exports
  this for managed sessions.
- Otherwise, use `drogon-cli`.

Below, `DROGON` is a placeholder for the executable you resolved. Substitute it before
running anything; do not create a shell variable or run `DROGON` literally. This works the
same way in POSIX shells, PowerShell, and cmd.exe.

If the selected executable cannot run, report its exact error and stop. Do not fall
through to another executable, which could silently target a different Drogon build.

## Load the full guide before running Drogon commands

```text
DROGON skills get --topic drogon-cli
```

That prints the complete, version-matched guide for the exact binary that will handle your
next commands — worktrees, handoffs, terminals, automations, the Work board, and the
built-in browser. When a message names a Drogon ticket (or you were started by a Work
column's prompt), read its **Work** section: link your session to the ticket and move the
ticket when your step is done.
Read it first, then run the specific command you need. For Bot self-management,
start with its **Find your own Bot ID** section: it explains how to query your
identity from the daemon in the current session, even if your generated
`AGENTS.md` is old or missing. Do not guess the ID from a name or folder, or
ask the owner to reopen a live Bot or copy an ID from the desktop.

Don't guess subcommands or flags from memory or from a cached copy of this stub. They
change between Drogon releases, and this file deliberately no longer lists them. Confirm
the daemon is up with `DROGON status --json`, and prefer `--json` for agent-driven calls.

## If an older Drogon does not recognize `skills get`

Use this fallback only when the selected binary explicitly reports that `skills get` is an
unknown command. Another failure is not proof of an older binary; report it rather than
guessing or changing executables. For a confirmed pre-guide binary, use only this bounded,
read-only bootstrap to orient. Do not dead-end and do not invent commands:

```text
DROGON status --json
DROGON worktree list --json
DROGON terminal list --json
```

Then tell the user that updating Drogon restores the full, version-matched guide via
`DROGON skills get --topic drogon-cli`. Beyond these commands, ask the user rather than
guessing a command surface this older binary may not support.
