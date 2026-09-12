---
name: drogon-cli
description: >-
  Drive Drogon through the public `drogon-cli`: resolve the executable, check
  status and capabilities, manage workspaces, projects and worktrees,
  operate terminals (create, list, send, read, wait, close) and the embedded
  browser pane (open, navigate, snapshot, click, fill, tabs), launch
  harnesses, create and run cron automations, manage Bots and their
  self-managed automations, monitors and monitor actions, seal and grant
  integration secrets, list and restore pre-migration backups, and use the
  optional work-graph recipe environment (the `mentu` verbs: status, open,
  run, follow, cancel). Use for terminal control, lightweight prompts and
  shell commands. Use the orchestration guide for supervised multi-agent
  coordination.
---

# Drogon CLI

This file is a discovery stub, not the usage guide. The full, version-matched Drogon CLI
reference is served by the `drogon-cli` binary itself — kept out of this file on purpose
so it can never drift from the binary that will actually run your commands.

Engage Drogon whenever its running daemon is the source of truth: Drogon-managed
workspaces, projects, worktrees, terminals, automations, and the browser embedded inside
the Drogon app. Triggers include "$drogon-cli", "Drogon worktree", "child worktree",
"spawn codex/claude in a worktree", "read/wait/send Drogon terminal", "full handoff" /
"handover" / "give this to another agent", and "control the browser inside Drogon". Use
plain shell tools when Drogon state does not matter.

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
next commands — worktrees, handoffs, terminals, automations, and the built-in browser.
Read it first, then run the specific command you need.

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
