---
name: feature-qa
description: >-
  Exercise Drogon's main features end to end as a QA agent: bot session
  lifecycle and bot-as-operator flows, workspaces/projects/worktrees, cron
  automations, monitors, work graph execution with the bounded adversarial
  loop, telemetry and token usage, and the rendered sidebar. Safe by default,
  with explicit live lanes for real-harness behavior.
---

# Feature QA

Run the product's main features the way an owner would, then report a
verdict per spec with the evidence that proves it. This guide owns the
procedures; the command reference lives in
`drogon-cli skills get --topic drogon-cli` and the execution-mode
definitions in `drogon-cli skills get --topic orchestration`. Read those
two first when a step below names a verb you have not used.

Every group runs against the live daemon through the public CLI. Nothing
here reads daemon files or sockets directly, and nothing invents product
behavior with mocks: a check that cannot observe the real thing is
`unverifiable`, never a pass.

## Rules of the lane

Safe by default. Steps marked live launch real harnesses and spend real
inference on the owner's configured accounts: run them only with explicit
approval for that run, keep the fixture task small, and prefer a free
local runtime from the workspace Subagent policy when one is available.
A skipped live lane is reported as skipped, never as passed.

Name every fixture `qa-<UTCSTAMP>-<WHAT>` and touch nothing else. If a
list shows a non-qa row where you expected only fixtures, stop and report
instead of guessing which row is yours.

Prefer `--json` for every call and assert one thing per step. Verdicts
are `pass`, `fail`, `unverifiable`, or `skip`: fail carries the command
and output that proves the deviation; agent behavior varies run to run,
so assert outcomes (structure, bounds, recorded evidence), never exact
transcripts.

Gate each group on its capabilities from
`drogon-cli status --json`: `project.v1` and `worktree.v1` for W,
`automation.v1` for C, `bot.self.v1` for B and M, `graph.v1` for G and
T, `orchestration.native.v1` for B6, `harness.catalog.v1` and
`harness.launch.v1` for every live lane. A missing capability skips its
group with the capability named.

Teardown is part of every group, in dependency order: monitors and
automations first, then the bot, then sessions, then the worktree, then
the project, then the fixture files. Verify the lists are empty of
`qa-*` afterwards, except `workspace list`: workspaces have no remove
verb, so their rows outlive the run and only a disposable data dir
clears them.

## Setup

```text
drogon-cli status --json
drogon-cli harness list --json
```

Record `hostId` from status: the `bot.*` RPC calls below need it. For
the full machine-readable surface run
`drogon-cli agent-context --json` (local, no daemon needed).

Make one fixture root outside any registered project (`mktemp -d` plus
`git init` plus one commit), and register projects from directories
inside it only.

## W Workspaces, projects, worktrees

W1 Register one git project and one folder project with
`drogon-cli project add <PATH> --name <NAME>`, confirm both in
`drogon-cli project list --json` with the expected `kind`, then drop
each with `drogon-cli project remove <ID>` and confirm the files on
disk are untouched: removal is bookkeeping only.

W2 From the git project, create a worktree with
`drogon-cli worktree create --project <ID> --name <NAME>`, read its
`id`, `workspaceId`, and `path` from the reply, and confirm it in
`drogon-cli worktree list --project <ID> --json`. Dirty the checkout
(one edited file, uncommitted) and confirm
`drogon-cli worktree rm <ID>` refuses without `--force`, then remove it
with `drogon-cli worktree rm <ID> --force`. A folder project has
exactly one synthesized worktree row in
`drogon-cli worktree list --project <ID> --json`: use its
`workspaceId` and never try to create a worktree for it.

W3 In the worktree's workspace, start a quick session with
`drogon-cli terminal create --workspace <ID> -- echo hi` and wait
for exit with
`drogon-cli terminal wait --session <ID> --incarnation <TOKEN> --for exited --timeout-ms 60000`.
For send and read, use a session that stays alive (it exits too
fast to receive input otherwise): create it with
`drogon-cli terminal create --workspace <ID> -- cat`, then
`drogon-cli terminal send --session <ID> --incarnation <TOKEN> --text <TEXT>`
and read the echo back with
`drogon-cli terminal read --session <ID> --incarnation <TOKEN> --limit-bytes 65536`.
Confirm `drogon-cli terminal list --workspace <ID> --json`
scopes to that workspace while
`drogon-cli terminal list --json` sees every workspace.

W4 Register a plain directory with
`drogon-cli workspace add <PATH> --name <NAME>`, confirm it in
`drogon-cli workspace list --json`, run one echo session there, and
close it with
`drogon-cli terminal close --session <ID> --incarnation <TOKEN>`.

## C Cron automations

C1 Create one automation paused on a future-only schedule
(`0 0 1 1 *` never fires during the run) with
`drogon-cli automation create --name <NAME> --cron <EXPR> --workspace <ID> --harness <ID> --prompt <TEXT> --disabled`,
taking the harness id from
`drogon-cli harness list --json`. Confirm
`drogon-cli automation list --json` shows it disabled with a coherent
next run.

C2 Read `drogon-cli automation history --id <ID> --limit 20 --json`
and confirm newest-first order once the automation has runs (C3
produces the first one). An automation with no runs reports empty
history, never an error.

C3 Live. Fire it once with `drogon-cli automation run --id <ID>`
(this dispatches the harness for real) and confirm the run lands in
`drogon-cli automation history --id <ID> --json` with its outcome.
Without live approval, skip C3 explicitly: C1 and C2 still stand.

Teardown has no top-level delete verb: remove the automation with
`drogon-cli rpc automation.delete --params <JSON>` carrying
`{"id": "<ID>"}`.

## M Monitors

M0 needs a bot: run B5 first, or reuse the `botId` and home
workspace your run already created.

M1 Create an observe-only file monitor (no responsibility, so it
records and releases nothing) with
`drogon-cli bot create-monitor --bot <ID> --workspace <ID> --resource <PATH> --manual`
over a fixture file in the bot's home. Dry-run it with
`drogon-cli bot test-monitor --bot <ID> --workspace <ID> --monitor <ID>`:
it reads real bytes and commits nothing, so two dry-runs in a row
both succeed with no firing recorded in
`drogon-cli bot list --bot <ID> --workspace <ID> --json`.

M2 Live firing. Create a second monitor with a short poll
(`drogon-cli bot create-monitor --bot <ID> --workspace <ID> --resource <PATH> --cron <EXPR>`,
one-minute schedule), append one line to the watched file, then poll
`drogon-cli bot list --bot <ID> --workspace <ID> --json` until the
monitor row records the check. For an observe-only monitor `firing`
stays null; the record is `lastCheckOutcome` with its `lastEventId`.

M3 Live action. Bind one monitor to a fresh reactive responsibility
with
`drogon-cli bot bind-monitor --bot <ID> --workspace <ID> --monitor <ID> --expected-rev 3 --responsibility-name <NAME>`
(the revision comes from `bot list`), change the file once, and
confirm the daemon dispatches exactly one headless run for that
event: replays join it instead of opening a second run, and the
firing outcome (`dispatched`, `joined_existing`, `refused`,
`orphaned`, `cap_exceeded`, `stale_skipped`) is recorded, never
silent.

M4 Rewrite the watch with
`drogon-cli bot update-monitor --bot <ID> --workspace <ID> --monitor <ID> --expected-rev 3 --resource <PATH>`
(the `3` is illustrative: revisions start at 0, so read the current
one from `bot list`) and confirm a stale `--expected-rev` is
refused, not applied. Pause and resume with the `bot
disable-monitor` / `bot enable-monitor` verbs, then delete with
`bot delete-monitor`: the delete receipt accounts abandoned events,
and no CLI verb reads a deleted monitor's history, so retention
past that receipt is unverifiable from the CLI.

## B Bots

B1 Close a session. Stop-only is
`drogon-cli rpc session.stop --params <JSON>` with
`{"sessionId": "<ID>", "incarnation": "<TOKEN>"}`: the row stays
`exited` with its code, the scrollback survives
(`drogon-cli terminal read --session <ID> --incarnation <TOKEN> --limit-bytes 65536`
still serves output), and `send` plus
`drogon-cli terminal resize --session <ID> --incarnation <TOKEN> --cols 120 --rows 30`
refuse the exited session. Forgetting is stricter:
`drogon-cli rpc session.forget --params <JSON>` with the same shape
refuses a live session (`session is live; close it instead`) and
drops an exited one from `drogon-cli terminal list --json`.
`drogon-cli terminal close --session <ID> --incarnation <TOKEN>`
is the one-step final close (stop plus forget): afterwards the row
is gone and read, send, and resize answer `not_found`. The same
final close by RPC is `drogon-cli rpc session.close --params <JSON>`.

B2 Resume. Stopping is final for the process: resuming means
relaunching the session's recorded argv as a new session in the
same workspace, which must come up `live` while the old row stays
`exited` with readable history. A bot's linked session reopens
through a promptless open-session dispatch,
`drogon-cli rpc bot.run --params <JSON>` with
`{"workspaceId": "<ID>", "hostId": "<HOST>", "botId": "<BOT>", "interactive": true, "resume": true}`.
Harness-level conversation resume is harness-specific and out of
CLI scope: note it, never fake it.

B3 Operate other sessions from the bot. Inside the bot's own
session, `drogon-cli terminal list --json` sees every workspace
while `drogon-cli terminal list --workspace <ID> --json` scopes to
one. Read, send to, and wait on a sibling session's id plus
incarnation and confirm the echo; a wrong incarnation fails with
`stale_incarnation` and an unknown id with `not_found`. Spawn one
session in a foreign workspace, confirm it lands there, then close
it: the bot's own `DROGON_WORKSPACE_ID` never limits where it may
operate.

B4 Add projects from the bot. Register the fixture repo with
`drogon-cli project add <PATH> --name <NAME>`, cut a worktree with
`drogon-cli worktree create --project <ID> --name <NAME>`, and open
a session in the returned workspace. The worktree nests under the
calling session's worktree by default; pass `--no-parent` for a
top-level one. `drogon-cli project remove <ID>` unregisters only.

B5 Identity and chat. Create the bot with
`drogon-cli rpc bot.create --params <JSON>`:

```json
{
  "workspaceId": "<ID>",
  "hostId": "<HOST>",
  "botId": "qa-bot-<UTCSTAMP>",
  "locale": "en-US",
  "body": {
    "characterPreset": "arya",
    "displayIdentity": {
      "displayName": "QA bot",
      "handle": "qa-bot",
      "title": "Fixture reviewer"
    },
    "harnessPolicy": {
      "defaultHarness": "pi",
      "explicitModel": null
    },
    "instructions": "Review the fixture and report one finding.",
    "memories": ["This is a disposable QA fixture."]
  }
}
```

Provision its home with
`drogon-cli bot provision --bot <ID> --workspace <ID>`, resolve the
id from a bot session with `drogon-cli bot whoami --json`, and read
`drogon-cli bot list --bot <ID> --workspace <ID> --json`
(automations, monitors, home, audit count). Give it a paused
responsibility with
`drogon-cli bot create-automation --bot <ID> --workspace <ID> --name <NAME> --schedule <EXPR> --prompt <TEXT> --disabled`
(future-only schedule), confirm
`drogon-cli bot test-automation --bot <ID> --workspace <ID> --responsibility <ID>`
reports admission only (`eligible` never dispatches), then exercise
update/enable/disable through the CAS verbs and confirm a stale
revision is refused. Deletion (`bot delete-automation`) carries no
CAS flag, so it has no stale-revision refusal. A chat turn,
`drogon-cli rpc bot.run --params <JSON>` with
`{"workspaceId": "<ID>", "hostId": "<HOST>", "botId": "<BOT>", "prompt": "<TEXT>"}`,
runs inference for real: live lane only. Teardown removes the bot
(and its owned automations) with
`drogon-cli rpc bot.delete --params <JSON>` carrying
`{"workspaceId": "<ID>", "hostId": "<HOST>", "botId": "<BOT>"}`.

B6 Live: the bot runs a work graph. Write an adversarial intent
(see G1, default bound of 3), then admit the workflow with
`drogon-cli graph orchestrator-start --workspace <ID> --file <PATH>`.
Poll `drogon-cli graph orchestrator-status --workspace <ID> --json`,
`drogon-cli terminal list --json`, and
`drogon-cli orchestration run-show --run <ID> --json` until the
workflow settles, and assert the contracted shape: exactly one
Main session, live and bound to the workflow, that leads without
implementing; depth-one implementation workers, all siblings, none
dispatching another worker; one tester per implementation worker
once its `final-report` arrives; corrections as sibling workers
with fresh testers; at most 3 rounds; immediate stop when a round
finds nothing; honest open findings at the bound, never a fourth
round. Confirm attempts, runtimes, and verdicts land in the
Evidence and Usage ledgers (see T4). With Delegate and Adversarial
both off, the leader implements directly and creates no workers.
If a test or review role fails while its
`.drogon/evaluations/<node>.json` file exists, read the file and
compare it against the parser contract (verdict exactly `pass` or
`findings`, evidence a non-empty string): a well-formed verdict the
daemon rejected is a brief-vs-parser mismatch. Every deviation is a
fail with the proving output attached.

## G Work graph

G1 Intent and state. Write an intent file with
`drogon-cli graph write-intent --workspace <ID> --file <PATH>`
(the `drogon-cli` guide shows the `graph-intent.json` shape,
including an adversarial policy): the daemon-owned state half is
preserved, and a payload that carries `state` is refused, never
silently ignored. `drogon-cli graph read --workspace <ID> --json`
returns both halves: `intent` is yours, `state` is what the daemon
observed, and a node reads `running` only with a confirmed live
process behind it. `maxIterations` defaults to 3 when omitted and
refuses values outside 1 to 10. Read one node with
`drogon-cli graph node-state --workspace <ID> --node <ID>`.

G2 Policy and failover. Store approved runtimes in order plus a
fallback in the intent, then confirm the execution records which
runtime actually ran: the approved entries are tried in order and
the fallback only after they all fail, with every attempt kept on
the node and in Evidence. Execution needs a runnable runtime: use
a free local one or mark the execution half live.

G3 Nodes. With the optional Mentu runtime installed, compile and
run a shell-backed node with
`drogon-cli graph run --workspace <ID> --node <ID> --follow --timeout-ms 60000`,
then resume and retry without redoing the graph. A graph the
runtime would not validate is refused, as is a node that already
has a live run. Without the runtime installed, skip G3 explicitly:
installing it is never a QA prerequisite.

G4 Durable orchestrator. Admit a workflow (see B6), read
`drogon-cli graph orchestrator-status --workspace <ID> --json` for
the latest workflow and its role attempts, stop it with
`drogon-cli graph orchestrator-stop --workspace <ID> --run <ID>`,
and resume with
`drogon-cli graph orchestrator-resume --workspace <ID> --run <ID>`
without repeating completed roles. The daemon continues without
the desktop: status stays readable from the CLI alone.

G5 Evidence for the graph run is T4.

## T Telemetry and usage

T1 Append one checkpoint with
`drogon-cli graph evidence-add --workspace <ID> --summary <TEXT>`
and one fully attributed entry with
`drogon-cli graph evidence-add --workspace <ID> --summary <TEXT> --detail <TEXT> --run <ID> --agent <ID> --role <ROLE>`,
then confirm `drogon-cli graph observability --workspace <ID> --json`
returns both with server-assigned `id` and `timestamp` under
`.result.observability.evidence`. A summary past 4 KiB is refused.

T2 Append a partial measurement with
`drogon-cli graph usage-add --workspace <ID> --input 100 --output 50`
and confirm the missing token fields stay absent under
`.result.observability.usage`: missing is never zero. Then append
a fully attributed measurement with
`drogon-cli graph usage-add --workspace <ID> --input 100 --output 50 --cache-read 10 --cache-write 5 --agent <ID> --harness <HARNESS> --model <MODEL> --role <ROLE> --run <ID>`
and confirm the exact round-trip of every field.

T3 An untouched workspace reports empty `evidence` and `usage`
arrays plus a present-but-empty `updatedAt`: honest emptiness,
never an error.

T4 After a live B6 or G4 run, confirm the daemon wrote its own
entries unprompted: every attempt with its runtime, every verdict
with the agent's evidence, and token measurements attributed by
agent and runtime. Cross-check the ledger rows against
`drogon-cli graph orchestrator-status --workspace <ID> --json`: no
observed attempt may lack its ledger row.

T5 Missing is never zero, end to end: re-read the raw JSON from
T2 and T4 and confirm no reader turned an absent token field into
a zero.

## S Rendered sidebar

Group S needs a repo checkout: drive the desktop through
`scripts/qa/drogon-ui.mjs`, one shell command at a time, and look
at the screenshots like a human. Seed product data through the CLI
first, reuse the `gh` stub and provider helpers from
`scripts/probe-sealed-journeys.mjs`, and never hand-roll stubs the
repo already owns. The window stays in the background for the
whole group; `stop` owns teardown and you verify its processes are
gone with a scoped identity check, never a broad `pkill`.

```text
node scripts/qa/drogon-ui.mjs start
node scripts/qa/drogon-ui.mjs cli project list --json
node scripts/qa/drogon-ui.mjs snapshot --max-lines 200
node scripts/qa/drogon-ui.mjs screenshot s0-seeded.png
```

S1 Seed one pull request per state through the stubbed `gh`, then
screenshot the sidebar once per state and confirm the contracted
mapping: merged renders green with a check, confirmed-ready
renders cyan, drafts stay neutral, conflicts render red,
review-required/pending/unknown stay neutral, and a provider
error renders unavailable, never empty.

S2 Build a project with a parent worktree, a nested child
worktree, and sessions in each. Confirm the three-level tree: the
root row names the agent (never a bare `terminal-1-zsh`), every
row states its condition, the card states its agent activity in
words, and the card ring carries the workspace status.

S3 Collapse and expand with a screenshot per state: the card
chevron folds and restores the whole tree, collapsing the root
hides both descendants, collapsing depth two keeps depth one
visible, the fold survives a reload, and expanding restores the
whole path.

S4 Dispatch depth-one workers (see B6) and confirm they nest under
the session that started them, with subagent tab groups, working
badges on hooks, and collapse/expand of the subagent group. A
late observation updates the same row: no duplicate rows for one
session, ever.

S5 Click a row and confirm that session focuses without
dispatching a duplicate; a session waiting for input shows its
badge; an exited session reads exited.

```text
node scripts/qa/drogon-ui.mjs stop
```

## Verdict report

One row per spec: the id (W1, C3, M2, B6, G4, T4, S3), the verdict,
and the evidence (the command plus the output line that proves
it). Fail on the first deviation with its proof attached; mark
`unverifiable` when ownership or exit cannot be established; mark
`skip` with the named reason (missing capability, no live
approval, no checkout for S). A skipped spec is never a pass.

## Teardown

Reverse the setup: delete monitors and automations, delete the
bot, stop, close, and forget the sessions, remove the worktree with
`drogon-cli worktree rm <ID> --force`, remove the project with
`drogon-cli project remove <ID>`, then delete the fixture
directories. Re-run the list commands and confirm no `qa-*` row
remains anywhere except `workspace list`, which has no remove verb.
