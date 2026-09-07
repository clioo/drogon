---
name: drogon-cli
description: >-
  Drive Drogon through the public `drogon-cli`: resolve the executable, check
  status and capabilities, manage workspaces, projects and worktrees, and
  operate terminals (create, list, send, read, wait, close) plus harness
  launch. Use for terminal control, lightweight prompts and shell commands.
  Use the orchestration guide for supervised multi-agent coordination.
---

# Drogon CLI

Use `drogon-cli` when the Drogon daemon is the source of truth. It is the
only supported way for an agent inside a Drogon terminal to inspect or drive
Drogon state: never reach into daemon files or sockets directly.

## Start Here

The executable is `drogon-cli` on `PATH`. It talks to the local daemon over
the data directory: pass `--data-dir <PATH>` or export `DROGON_DATA_DIR`.
Prefer `--json` for agent-driven calls; human output is a summary of the
same result.

```text
drogon-cli status --json
```

If the CLI is missing, say so explicitly instead of inspecting source files.

## Status And Capabilities

`drogon-cli status` shows the daemon identity, protocol version and
capability list. Gate optional work on capabilities: `harness.catalog.v1`
and `harness.launch.v1` for harness commands, `orchestration.native.v1`
for the orchestration verbs, `project.v1` and `worktree.v1` for projects
and worktrees, `git.v1` for Git operations, and `session.agent-state.v1`
for agent-state fields on sessions.

Run `drogon-cli status --json` first, then the narrowest command for the
job. The full guide for supervised coordination is one guide away:
`drogon-cli skills get orchestration`.

## Workspaces

A workspace is a registered directory that owns terminal sessions. List
them with `drogon-cli workspace list --json`, and register one with
`drogon-cli workspace add <PATH> --name <NAME>`.

## Projects And Worktrees

A project is a Git repository or a plain folder that owns worktrees.
Register one with `drogon-cli project add <PATH> --name <NAME>` and list
them with `drogon-cli project list --json`. Create a worktree on a branch
with `drogon-cli worktree create --project <ID> --name <NAME> --base <REF>`,
list a project's worktrees with `drogon-cli worktree list --project <ID>`,
and remove one with `drogon-cli worktree rm <ID> --force`. Removal refuses
a dirty checkout unless `--force` is passed.

## Terminals

Sessions are PTY processes with a stable id plus an incarnation token:
every `send`, `read`, `resize`, `wait` and `close` needs both. Start one
with `drogon-cli terminal create --workspace <ID> -- echo hi` (everything
after `--` becomes argv verbatim, no shell interpolation), and scope a
listing with `drogon-cli terminal list --workspace <ID>` or list all with
`drogon-cli terminal list --json`.

Write input with `drogon-cli terminal send --session <ID> --incarnation <TOKEN> --text <TEXT>`.
To send Enter, end the value with a real newline (shell `$'...'` quoting),
not the two characters backslash-n. Read bounded output with
`drogon-cli terminal read --session <ID> --incarnation <TOKEN> --cursor 0 --limit-bytes 4096`,
then keep paging with the returned `nextCursor` while `truncated` is true.
Resize with `drogon-cli terminal resize --session <ID> --incarnation <TOKEN> --cols 80 --rows 24`,
and stop a session with `drogon-cli terminal close --session <ID> --incarnation <TOKEN>`.

Wait client-side instead of sleeping: `drogon-cli terminal wait --session <ID> --incarnation <TOKEN> --for exited --timeout-ms 5000`
exits 0 once the session exits, while
`drogon-cli terminal wait --session <ID> --incarnation <TOKEN> --for idle --timeout-ms 60000`
exits 0 once the agent goes quiet (an exited session also satisfies an
idle wait, since it will never work again), and
`drogon-cli terminal wait --session <ID> --incarnation <TOKEN> --for output --timeout-ms 60000`
exits 0 once any terminal output exists or arrives. A blown budget exits
non-zero with a `timeout` reason naming the last observed state. Always
pass `--timeout-ms` (1 to 900000).

## Harness Launch

`drogon-cli harness list --json` shows the harnesses the service host can
actually run. Launch one with
`drogon-cli harness start --workspace <ID> --harness <HARNESS> --prompt <PROMPT>`,
optionally pinning the model and permission mode:
`drogon-cli harness start --workspace <ID> --harness <HARNESS> --model <MODEL> --permission-mode unattended --prompt <PROMPT>`.
The service resolves the host executable, so there is never a local binary
to point at. A harness id is server-authoritative: pass it through
verbatim as advertised by `harness list`.

## Liveness And Agent State

Every session reports a liveness verdict and an agent state. Verdicts are
`live`, `unverifiable` or `exited`: loss of contact never proves exit, so
treat `unverifiable` as unknown and keep the session identity for a later
read. Agent states are `working` (output within the last few seconds),
`idle` (quiet after earlier activity), `needs_input` (the agent asked for
input), `exited`, and `unknown` (no output observed yet, so idleness was
never established). Only an observed exit is an exit.

## Errors

- Usage errors (bad flags, missing `--timeout-ms`, empty ids) exit 2 with
  a message on stderr and nothing on stdout.
- Operation failures exit 1. Under `--json` the failure envelope goes to
  stdout; otherwise `error: <code>: <message>` goes to stderr.
- `terminal close` exits 1 when the runtime cannot confirm the session
  exited, even though it prints the session line.
- `terminal wait` exits 1 with code `timeout` when the budget expires.
- The diagnostic passthrough `drogon-cli rpc status` sends one raw
  protocol method and prints the validated envelope.

## Next Action

Confirm `drogon-cli status --json` unless already checked this turn, then
choose the narrowest command: `workspace list`, `project list`,
`worktree list --project <ID>`, `terminal list`, `terminal read`, or
`terminal wait`. For supervised work with task ownership and completion
tracking, read `drogon-cli skills get orchestration`.
