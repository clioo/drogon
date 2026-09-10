---
name: orchestration
description: >-
  Use Drogon native orchestration for supervised multi-agent coordination:
  run and task ownership, worker dispatch, scoped send and check mail,
  blocking ask and reply flows, and worker_done completion tracking. Use the
  drogon-cli guide for full ownership handoffs, terminal control and
  worktree management instead.
---

# Drogon Native Orchestration

Orchestration is Drogon's supervised coordination layer: a run owns tasks,
tasks own worker dispatches, and workers report back with scoped messages.
Use it when coordination state matters: task ownership, waiting on a
worker, decision gates, or ask and reply flows.

Do not use it for full ownership handoffs. Requests phrased as hand off,
handoff, handover, give this to another agent, or another worktree transfer
ownership and the original agent stops: deliver the prompt with worktree
and terminal commands from `drogon-cli skills get --topic drogon-cli` and stop
monitoring.

## Preconditions

```text
drogon-cli status --json
```

`status` must advertise `orchestration.native.v1`. Every verb below is one
RPC to the running daemon; prefer `--json` for agent-driven calls.

## The Loop

Create a run, create a task, dispatch a worker, wait for its report:

Run `drogon-cli orchestration run-create --objective <TEXT>` to open a run
bound to a fresh coordinator binding, then
`drogon-cli orchestration task-create --run <ID> --coordinator-id <ID> --consumer-generation 3 --instructions <TEXT>`
to record the work. Title it when it helps triage:
`drogon-cli orchestration task-create --run <ID> --coordinator-id <ID> --consumer-generation 3 --instructions <TEXT> --title <TITLE>`.
List ready work with
`drogon-cli orchestration task-list --run <ID> --coordinator-id <ID> --consumer-generation 3 --ready --json`
and inspect one task with
`drogon-cli orchestration task-show --run <ID> --coordinator-id <ID> --consumer-generation 3 --task <ID>`.

Dispatch the task to a worker session with
`drogon-cli orchestration worker-start --run <ID> --coordinator-id <ID> --consumer-generation 3 --task <ID> --workspace <ID> --harness <HARNESS>`,
or attach an existing session explicitly with
`drogon-cli orchestration worker-start --run <ID> --coordinator-id <ID> --consumer-generation 3 --task <ID> --workspace <ID> --reuse-session <SESSION> --reuse-incarnation <TOKEN>`.
Watch it with
`drogon-cli orchestration worker-show --run <ID> --coordinator-id <ID> --consumer-generation 3 --dispatch <ID>`
and read bounded output with
`drogon-cli orchestration worker-read --run <ID> --coordinator-id <ID> --consumer-generation 3 --dispatch <ID> --limit 50`.
Stop a worker with
`drogon-cli orchestration worker-stop --run <ID> --coordinator-id <ID> --consumer-generation 3 --dispatch <ID>`.

Wait for completion with a bounded blocking check:
`drogon-cli orchestration check --run <ID> --coordinator-id <ID> --consumer-generation 3 --wait --timeout-ms 60000`.
Always pass `--timeout-ms` (1 to 900000) with `--wait`. Peek without
consuming with
`drogon-cli orchestration check --run <ID> --coordinator-id <ID> --consumer-generation 3 --peek --json`.

## Worker Reports And Mail

A worker inside its dispatched terminal reports completion through its
scoped credential and environment hints, with no explicit bindings:
`drogon-cli orchestration send --kind final-report --subject <TEXT> --outcome succeeded --body <REPORT>`.
The outcome is `succeeded` or `failed`, and it is required for
`final-report` kinds. Send exactly one final report per dispatch; a second,
conflicting report is refused.

Coordinators send with explicit scope instead. Post a status note home with
`drogon-cli orchestration send --run <ID> --coordinator-id <ID> --consumer-generation 3 --kind status --subject <TEXT> --to run-home`,
and ask a worker a direct question with
`drogon-cli orchestration send --run <ID> --coordinator-id <ID> --consumer-generation 3 --kind question --subject <TEXT> --to dispatch:<ID>`.
Targets are `run-home`, `dispatch:<ID>` or `group:<NAME>`.

## Ask And Reply

Ask blocks for an answer inside one bounded budget:
`drogon-cli orchestration ask --run <ID> --coordinator-id <ID> --consumer-generation 3 --question <TEXT> --timeout-ms 60000`.
A worker asks from its own terminal with
`drogon-cli orchestration ask --task <ID> --dispatch <ID> --question <TEXT> --timeout-ms 60000`
when it needs the coordinator, and a coordinator answers a pending
question with
`drogon-cli orchestration reply --run <ID> --coordinator-id <ID> --consumer-generation 3 --question <MSG> --body <TEXT>`.
Answer with `reply`, never with a second `ask`: the question id keeps the
correlation. Resume a pending ask by its message id rather than opening a
duplicate. Without `--timeout-ms`, the budget is ten minutes; larger explicit
budgets are clamped to thirty minutes. `--options` accepts comma-separated
choices, while repeatable `--option` keeps each choice literal.

Unlike other RPC commands, `ask --json` returns a bare object: read `.answer`,
`.messageId`, `.threadId`, `.timedOut`, `.cancelled` and `.connectionLost` directly.
A pending or cancelled wait exits 1; a timeout never closes the question.

## Task Status And Decision Gates

`drogon-cli orchestration task-update --run <ID> --coordinator-id <ID> --consumer-generation 3 --id <TASK> --status completed --result <TEXT>`
updates a task after its active worker has settled or stopped. Omitting
`--result` preserves the previous result. Completing prerequisites promotes
their eligible dependent tasks; a status label never proves process exit.

`drogon-cli orchestration gate-create --run <ID> --coordinator-id <ID> --consumer-generation 3 --task <TASK> --question <TEXT>`
creates a durable decision gate and blocks the task. Gate `--options` is a JSON
array of strings, unlike ask's CSV form.
`drogon-cli orchestration gate-list --run <ID> --coordinator-id <ID> --consumer-generation 3 --status pending`
lists pending gates, optionally filtered by `--task`.
`drogon-cli orchestration gate-resolve --run <ID> --coordinator-id <ID> --consumer-generation 3 --id <GATE> --resolution <TEXT>`
resolves a gate and returns its task to ready. Creation and resolution refuse
an active supervised worker rather than silently discarding its assignment.

`drogon-cli orchestration worker-retain --dispatch <ID> --from <TERMINAL>`
records a durable debugging hold without stopping the worker, including an active
worker. An explicit `worker-release` clears that hold. Retain cannot undo a
committed release; a pending release is distinct from an uncertain outcome.
Retention never resurrects an exited process. Output archive parity is not yet implemented.

## Scope And Credentials

Bound coordinator verbs (`run-use`, `task-create`, `task-update`, `task-list`,
`task-show`, `gate-create`, `gate-resolve`, `gate-list`, `worker-start`,
`worker-show`, `worker-read`, `worker-stop`, `worker-abandon`, `worker-release`, `worker-retain`) accept
explicit `--run`, `--coordinator-id` and `--consumer-generation` bindings.
With `orchestration.terminal-bindings.v1`, the current Drogon terminal or
`--from <terminal-id>` resolves the daemon's persisted binding instead:
`drogon-cli orchestration run-create --objective <TEXT> --from <TERMINAL>`,
`drogon-cli orchestration run-current --from <TERMINAL>` and
`drogon-cli orchestration task-create --spec <TEXT> --from <TERMINAL>`.
`drogon-cli orchestration run-use --id <RUN> --from <TERMINAL>` explicitly
moves that terminal to a run, fencing its previous run. No run is guessed
from global recency, and explicit stale generations are never repaired.
A lost or replaced terminal is refused; use a new live terminal to bind again.
Named-run task and gate inspection does not require a terminal binding. Mail verbs
(`send`, `check`, `reply`, `ask`) accept either the coordinator binding or
the dispatch binding (`--task`, `--dispatch`); a dispatched worker's own
terminal fills missing dispatch fields from scoped hints. Explicit worker
fields must agree with those hints. Coordinator-only verbs refuse a worker credential
outright. Take over a run explicitly with
`drogon-cli orchestration run-use --run <ID> --coordinator-id <ID> --consumer-generation 3 --takeover`.

## Liveness

Worker completion arrives as `final-report` mail or an `escalation`
message kind, never as a bare process exit: always `check --wait` for the
report rather than inferring success from `terminal wait --for exited`.
Liveness verdicts on the underlying sessions stay `live`,
`unverifiable` or `exited`, and loss of contact never proves exit.

## Next Action

Confirm `drogon-cli status --json` unless already checked this turn, then
`run-create`, `task-create`, `worker-start`, and `check --wait` for the
`final-report`. Full command shapes live behind the prose names above;
terminal control and worktrees are in
`drogon-cli skills get --topic drogon-cli`.
