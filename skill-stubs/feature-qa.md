# Feature QA

This file is a discovery stub, not the usage guide. The full, version-matched
feature-QA reference is served by the `drogon-cli` binary itself — kept out of
this file on purpose so it can never drift from the binary that will actually
run your commands.

Engage feature QA whenever you must exercise Drogon's main features end to end
as a QA agent and report a verdict per spec: bot session lifecycle (close,
resume) and bot-as-operator flows (other sessions, projects, work graph
execution with the bounded adversarial loop), workspaces, projects and
worktrees, cron automations, monitors, telemetry and token usage, and the
rendered sidebar. Use the drogon-cli skill instead for ordinary terminal
control, shell commands, and worktree management with no verdict to report,
and the orchestration skill for supervised multi-agent coordination. QA
requires real Drogon runtime state; never substitute a non-Drogon subagent
tool, and never run a live lane (real harness inference) without explicit
approval for that run.

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
DROGON skills get --topic feature-qa
```

That prints the complete, version-matched guide for the exact binary that will handle your
next commands — the spec groups, their pass/fail evidence, the safe-by-default rules, and
the explicit live lanes. Read it first, then run the specific command you need.

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
DROGON project list --json
DROGON terminal list --json
```

Then tell the user that updating Drogon restores the full, version-matched guide via
`DROGON skills get --topic feature-qa`. Beyond these commands, ask the user rather than
guessing a command surface this older binary may not support.
