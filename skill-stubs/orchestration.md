# Drogon Orchestration

This file is a discovery stub, not the usage guide. The full, version-matched Drogon
orchestration reference is served by the `drogon-cli` binary itself — kept out of this
file on purpose so it can never drift from the binary that will actually run your
commands.

Engage Drogon orchestration whenever you need structured multi-agent coordination: scoped
send and check mail, blocking ask/reply flows, task dispatch, worker_done/escalation
waits, task DAGs, decision gates, coordinator loops, or decomposing work across agents.
Use the drogon-cli skill instead for full ownership handoffs ("hand off", "handoff",
"handover", "give this to another agent", "another worktree") when the user did not ask
to supervise, monitor, wait for results, or coordinate a DAG — and for ordinary terminal
control, shell commands, worktree management, and the built-in browser. Coordination
requires real Drogon runtime state; never substitute a non-Drogon subagent tool.

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
DROGON skills get --topic orchestration
```

That prints the complete, version-matched guide for the exact binary that will handle your
next commands — task creation and dispatch, worker_done authority, decision gates, and
coordinator loops. Read it first, then run the specific command you need.

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
DROGON orchestration task-list --json
DROGON terminal list --json
```

Then tell the user that updating Drogon restores the full, version-matched guide via
`DROGON skills get --topic orchestration`. Beyond these commands, ask the user rather than
guessing a command surface this older binary may not support.
