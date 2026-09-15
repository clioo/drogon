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

## Read The Workspace Policy Before Delegating

Before a main agent creates a run or dispatches a worker, it MUST read the
workspace's native Drogon state. Simple read-only questions, repository
lookups, `gh` commands, and bounded changes should be handled directly without
creating a run:

```text
drogon-cli graph read --workspace <WORKSPACE_ID> --json
drogon-cli graph observability --workspace <WORKSPACE_ID> --json
```

Use `.drogon/graph.json` to choose the execution mode and approved/fallback
runtimes. Use the Evidence and Usage ledgers to avoid repeating work already
reported by agents. Do not infer policy from the UI or from memory.

The execution modes are mutually exclusive:

- Both Delegate and Adversarial OFF: work directly; do not proactively create
  workers, though an explicit user request may authorize delegation.
- Delegate ON: delegation is available, not mandatory. Work directly by default
  and use depth-one children only when independent work benefits from
  parallelism or specialization. A user request to make changes always permits
  the main agent to edit directly. Do not add testers.
- Adversarial ON: implement directly unless an independent subtask benefits
  from a depth-one worker. Drogon launches the bounded whole-workflow test and
  review sessions after the main work settles; do not dispatch duplicate
  testers yourself.

Every worker brief must say that it cannot dispatch another worker. All
workers remain at depth one.

A Drogon-launched harness receives this context on its first turn, without a
new `AGENTS.md` or `CLAUDE.md` in an unconfigured workspace: delegation goes
through the `drogon-cli` on its managed `PATH`, and the Work Graph policy is
authoritative for child runtimes. Read the policy's provider and model as one
pair; never resolve an ambiguous model id by guessing.

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

Dispatch the task through the Work Graph policy with
`drogon-cli orchestration worker-start --run <ID> --coordinator-id <ID> --consumer-generation 3 --task <ID> --workspace <ID>`.
This records the exact provider+model selected from the ordered approved
runtimes, then the fallback. If the workspace has no configured runtime, this
form refuses instead of inventing a model or copying a developer-only default.
A failed attempt may be retried
explicitly with `--retry-of <DISPATCH-ID>`; the next policy runtime is chosen
without the coordinator hand-picking a provider. A coordinator may override
that policy when the user explicitly requests a runtime and it deliberately
supplies the full fresh launch pair:
`drogon-cli orchestration worker-start --run <ID> --coordinator-id <ID> --consumer-generation 3 --task <ID> --workspace <ID> --harness <HARNESS> --provider <PROVIDER> --model <MODEL>`.
To attach an existing session explicitly, use
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

A worker inside its dispatched terminal receives a structured first-turn
brief with these stable sections, verbatim: `Objective`, `Scope / paths`,
`Exact instructions (verbatim)`, `Run ID`, `Task ID`, `Dispatch ID`, the
policy runtime order, and this reporting contract. It reports completion
through its scoped credential and environment hints, with no explicit
bindings:
`drogon-cli orchestration send --kind worker_done --subject <TEXT> --outcome succeeded --body <REPORT>`.
Keep `--body` last. The CLI joins all remaining shell words, including bullets
and flag-like text, so a long report needs no Python argv wrapper.
`worker_done` is the CLI alias for Drogon's `final-report` kind. The outcome
is `succeeded` or `failed`, and it is required. Send progress with
`drogon-cli orchestration send --kind status --subject <TEXT> --body <TEXT>`;
ask a blocker with
`drogon-cli orchestration ask --question <TEXT> --timeout-ms 60000`.
Send exactly one final report per dispatch; a second, conflicting report is
refused. The final body must name the outcome, modified files, and any
artifact path; a PTY line alone is not a completion report.

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
are covered below; the remaining read-and-recover verbs name their target
outright: `drogon-cli orchestration run-list --json` pages runs,
`drogon-cli orchestration run-show --run <ID> --json` shows one,
`drogon-cli orchestration request-show --request <ID> --scope dispatch`
recovers a receipt, and `drogon-cli orchestration worker-abandon --dispatch
<ID>` plus `drogon-cli orchestration worker-release --dispatch <ID>` give a
supervisor honest exits for workers it will not or cannot stop.
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

## Validation lanes

The committed CI-safe journey uses shell fixtures only:
`node scripts/accept-orchestration-e2e.mjs`. It proves the daemon/CLI boundary,
policy selection, failover, concurrent attribution, ask/reply/resume, honest
missing reports, and Claude/OpenCode context delivery without provider
inference.

Real Pi/Luna dogfood is intentionally opt-in and never runs in CI:

```text
DROGON_E2E_REAL_HARNESS=1 node scripts/e2e-orchestration-real.mjs
```

That run uses only `pi --provider openai-codex --model gpt-5.6-luna
--thinking low`, disposable Drogon data/profile directories, a background
window, bounded redacted evidence, and identity-scoped process cleanup. It
must report model confusion rather than turning a claimed PTY line into a
worker completion. Real Claude/OpenCode inference is outside the approved
model lane; their adapter delivery remains covered by the fixture journey.

## Next Action

Confirm `drogon-cli status --json` unless already checked this turn, then
`run-create`, `task-create`, `worker-start`, and `check --wait` for the
`final-report`. Full command shapes live behind the prose names above;
terminal control and worktrees are in
`drogon-cli skills get --topic drogon-cli`.
