---
name: drogon-cli
description: >-
  Drive Drogon through the public `drogon-cli`: resolve the executable, check
  status and capabilities, manage workspaces, projects and worktrees,
  operate terminals (create, list, send, read, wait, close) and the embedded
  browser pane (open, navigate, snapshot, click, fill, tabs), launch
  harnesses, create and run cron automations, manage Bots and their
  self-managed automations, monitors and monitor actions, seal and grant
  integration secrets, and use the optional Mentu recipe environment
  (status, open, run, follow, cancel). Use for terminal control, lightweight
  prompts and shell commands. Use the orchestration guide for supervised
  multi-agent coordination.
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
For the full machine-readable surface, run
`drogon-cli agent-context --json` (local, no daemon needed).

Recipes are optional work; the Mentu section below says how to find out
whether this host can run one before you say you made one.

## Inside A Drogon Terminal

Every shell or agent the daemon spawns already has Drogon on `PATH`: the
daemon prepends its `<data-dir>/bin` directory, which holds two names for
the same CLI — `drogon-cli` and the shorter alias `drogon`. Inside, drop
`--data-dir`: the shim binds the running daemon's data directory on its
own, and the session environment already exports `DROGON_DATA_DIR`,
`DROGON_WORKSPACE_ID`, `DROGON_SESSION_ID` and `DROGON_TERMINAL=1`.

```text
drogon-cli status --json
drogon-cli terminal list --json
```

Prefer `drogon-cli` in scripts and shared prompts; `drogon` is a
keystroke-saver for interactive use. Both resolve to the CLI that belongs
to the running daemon, never to another install on `PATH`.

## Status And Capabilities

`drogon-cli status` shows the daemon identity, protocol version and
capability list. Gate optional work on capabilities: `harness.catalog.v1`
and `harness.launch.v1` for harness commands, `orchestration.native.v1`
for the orchestration verbs, `project.v1` and `worktree.v1` for projects
and worktrees, `git.v1` for Git operations, `session.agent-state.v1`
for agent-state fields on sessions, `browser.relay.v1` for the browser
commands below (which additionally need a connected Drogon desktop),
`automation.v1` for the cron automation verbs, `bot.self.v1` for the Bot
self-management verbs, `bot.secrets.v1` for the secret verbs, and
`mentu.v1` for the Mentu recipe verbs below, and `graph.v1` for the
work-graph verbs.

Run `drogon-cli status --json` first, then the narrowest command for the
job. Before promising a Mentu recipe, run
`drogon-cli mentu status --workspace <ID> --json` — the runtime is
optional, and a recipe can only run once a human has approved its current
content (`mentu run` refuses otherwise). The full guide for supervised
coordination is one guide away:
`drogon-cli skills get --topic orchestration`.

## Workspaces

A workspace is a registered directory that owns terminal sessions. List
them with `drogon-cli workspace list --json`, and register one with
`drogon-cli workspace add <PATH> --name <NAME>`.

## Projects And Worktrees

A project is a Git repository or a plain folder that owns worktrees.
Register one with `drogon-cli project add <PATH> --name <NAME>`, list
them with `drogon-cli project list --json`, and drop a registration with
`drogon-cli project remove <ID>` (bookkeeping only: files on disk are
untouched). Create a worktree on a branch
with `drogon-cli worktree create --project <ID> --name <NAME> --base <REF>`
(`--base-branch` spells the same flag),
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
`drogon-cli terminal wait --session <ID> --incarnation <TOKEN> --for tui-idle --timeout-ms 60000`
exits 0 once the agent goes quiet (an exited session also satisfies an
idle wait, since it will never work again), and
`--for` also accepts the fork spellings `exit` (= `exited`) and
`tui-idle` (= `idle`):
`drogon-cli terminal wait --session <ID> --incarnation <TOKEN> --for output --timeout-ms 60000`
exits 0 once any terminal output exists or arrives. A blown budget exits
non-zero with a `timeout` reason naming the last observed state. Always
pass `--timeout-ms` (1 to 900000).

## Browser

The desktop owns one embedded browser pane per workspace. Each command
enqueues a relay request and waits (bounded, `--timeout-ms 5000` overrides
the 15000 default, range 1 to 25000) for the connected desktop to execute
it; with no desktop connected the call fails with `desktop_not_connected`
inside the timeout. Open a URL with
`drogon-cli browser open --workspace <ID> <URL>`, move an open tab with
`drogon-cli browser navigate --tab <ID> <URL>`, and read a tab's URL, title
and bounded DOM text with `drogon-cli browser snapshot --tab <ID>`.
Interact with the page through CSS selectors resolved with
`document.querySelector` in the guest:
`drogon-cli browser click --tab <ID> --selector <CSS>` clicks the match and
`drogon-cli browser fill --tab <ID> --selector <CSS> --text <TEXT>` fills
it. List a workspace's tabs with `drogon-cli browser tabs --workspace <ID>`.
Inside a Drogon terminal both spellings work with no `--data-dir` flag:
`drogon-cli browser open --workspace <ID> <URL>` or the shorter `drogon`
alias — the shim is already on `PATH`.

## Automation

A workspace can own cron automations the daemon's scheduler fires. Create
one with `drogon-cli automation create --name <NAME> --cron <EXPR>
--workspace <ID> --harness <ID> --prompt <TEXT>` (schedules are evaluated
in UTC; `--disabled` stages it paused and `--grace-minutes <N>` bounds the
missed-run catch-up), list them with `drogon-cli automation list --json`,
fire one immediately with `drogon-cli automation run --id <ID>`, and read
an automation's past runs with `drogon-cli automation history --id <ID>
--json`.

## Bots (self-management)

A Bot is a persistent agent identity with its own workspace, harness and
purpose. A Bot manages its OWN automations and monitors through the
`bot` verbs; every call needs `--bot <ID> --workspace <ID>` and the
service capability `bot.self.v1`.

Provision the Bot's dedicated working folder with `drogon-cli bot
provision --bot <ID> --workspace <ID>` (automations and monitors live in
that home), and read everything the Bot owns with `drogon-cli bot list
--bot <ID> --workspace <ID> --json` (automations, monitors with their
health and revisions, home profile, audit count).

### Bot automations

`drogon-cli bot create-automation --bot <ID> --workspace <ID> --name
<NAME> --schedule <EXPR> --prompt <TEXT>` gives the Bot a scheduled
responsibility that runs in its home under its own harness. Edit it with
`drogon-cli bot update-automation --bot <ID> --workspace <ID>
--responsibility <ID> --expected-bot-rev 3` (CAS: the current bot
revision is in `bot list`), pause or resume it with `bot enable-automation` / `bot disable-automation`
(same CAS flags), remove it with `bot delete-automation`
(history is retained), and dry-run admission with `bot test-automation` —
`eligible` is an admission verdict only, never a dispatch.

### Bot monitors and the action they release

A monitor watches one file in the Bot's home and writes a durable change
event each time the content changes. Create one with `drogon-cli bot
create-monitor --bot <ID> --workspace <ID> --resource <PATH>`, adding
`--max-bytes <N>` for the size bound, `--cron <EXPR>` (default every
minute) or `--manual` for the trigger, and `--disabled` to stage it
paused. File-digest monitors self-approve; an edit re-approves only while
the watched file stays in the home.

A monitor observes by default — it records events and releases nothing.
Declare the ACTION it releases with --responsibility-name (plus optional
--instructions), which mints an enabled reactive responsibility and binds
it in the same call, or --responsibility-id to bind an existing reactive
one. A bound monitor's change event
makes the daemon dispatch a headless run of that responsibility: the
prompt is a template of event metadata plus the responsibility's standing
instructions (the watched file's bytes never enter it), the run is
idempotent per event (a replay joins the existing run instead of opening
a second one), and a bot-wide per-day cap bounds flood. The same binding
is available after creation:

```text
drogon-cli bot bind-monitor --bot bot-1 --workspace ws-1 --monitor mon-1 --expected-rev 3 --responsibility-name Triage --instructions Check-the-diff-and-report.
```

`bind-monitor` is CAS on the monitor revision (`--expected-rev <N>` from
`bot list`) and lives outside approval: it changes what a committed change
does, never what is watched, so it never parks or unparks the monitor.
Every firing is recorded with its outcome — `dispatched` (run id
included), `joined_existing`, `refused`, `orphaned`, `cap_exceeded` or
`stale_skipped` — and surfaces in `bot list` under each monitor's
`firing` and in the desktop Bots page, so a monitor that could not act
says so instead of failing silently.

Edit the watch with `drogon-cli bot update-monitor --bot <ID> --workspace
<ID> --monitor <ID> --expected-rev 3 --resource <PATH>` (every other
field is optional), pause or resume with `bot enable-monitor`
/ `bot disable-monitor`, dry-run with
`bot test-monitor` (reads real bytes, commits nothing), and
delete with `bot delete-monitor` (check history is retained).

### Bot secret grants

Integration secret VALUES stay in the daemon's sealed store (see Secrets
below). Grant a Bot the right to USE one by reference with `drogon-cli bot
grant-secret --bot <ID> --workspace <ID> --secret-ref <NAME> --kind <KIND>`
(user-only; optional --granted-by names the human who granted it, and
revocation hits the bot's next tick),
review grants with `drogon-cli bot list-grants --bot <ID> --workspace <ID>
--json`, and revoke with `drogon-cli bot revoke-secret --bot <ID>
--workspace <ID> --secret-ref <NAME>`.

## Secrets

`drogon-cli secrets set --kind <KIND> --name <NAME>` seals one integration
secret value into the daemon store — the value is read from stdin, never
argv or echo: `printf '%s' "$GITHUB_TOKEN" | drogon-cli secrets set --kind
github --name GITHUB_TOKEN_REF`. `secrets list --json` shows what is
sealed (names and kinds, never values) and `secrets delete --kind <KIND>
--name <NAME>` removes one. Grant a sealed reference to a Bot with
`drogon-cli bot grant-secret --bot <ID> --workspace <ID> --secret-ref <NAME>
--kind <KIND>` (above).

## Mentu Recipes

Mentu is Drogon's recipe runner: a recipe is a JSON file under the
workspace's `.mentu/recipes` directory describing steps in a dependency
graph. Its runtime is OPTIONAL, so check before you promise anything:
`drogon-cli mentu status --workspace <ID> --json` reports a `verdict` of
`installed`, `not_installed` or `partially_available` plus the workspace's
recipe inventory (total, valid, and each invalid entry's issue). The
verdict comes from the daemon's own probe of the pinned runtime's bytes and
lock hash — never from an assumption about the host — and requires the
service capability `mentu.v1`.

Write a recipe when the work is repeatable, has more than one ordered
step, and per-step evidence is worth keeping (a build-and-verify chain, a
release check, a migration you will re-run). Write a plain answer, not a
recipe, when the request is a question, a single command, or exploratory
work whose steps you cannot state yet. `drogon-cli mentu status --workspace <ID>`
afterwards proves the file you wrote is actually discovered and valid — an
invalid recipe is listed with its issue instead of being hidden.

Hand the human the recipe with
`drogon-cli mentu open --workspace <ID> --recipe <ID>` (or without
`--recipe` to reopen the tab on whatever was selected). It enqueues one
relay request and waits (bounded, `--timeout-ms 5000` overrides the 15000
default, range 1 to 25000) for the connected Drogon desktop, which opens or
focuses the workspace's Mentu tab and answers with its own verdict: a
refusal is an error (`desktop_unavailable`, `mentu_unavailable`,
`mentu_workspace_unknown`, `mentu_open_timeout`), never a silent success.
With no desktop connected the call fails with `desktop_not_connected`
inside the timeout, like the browser commands above. This verb shows a
recipe; it never runs one.

### Run A Recipe

Running a recipe is a daemon operation you start and then follow. It needs
an approval bound to the recipe's EXACT current bytes: `mentu run` never
approves anything itself, so an edited recipe has to be re-approved by a
human (the Drogon Mentu tab's Run Recipe action) before the CLI can run it.

```text
drogon-cli mentu run --workspace <ID> --recipe <ID> --follow --timeout-ms 900000
```

- Without `--approval`, the verb resolves the recipe's pending approval
  (`mentu.pending_approval`: the newest unconsumed approval whose content
  hash equals the recipe on disk). Pass `--approval <ID>` to consume one
  specific approval instead — that is what the Mentu tab's Run Recipe
  button does when it hands you the id it just approved.
- With no matching approval the call fails with `mentu_approval_required`
  (exit 1). Do not look for a way to approve it yourself: report the
  recipe and ask the human to approve it in the Mentu tab, then run again.
- `--follow` polls `mentu.run_status` until the run settles, bounded by
  `--timeout-ms` (default 900000, range 1 to 3600000). Without `--follow`
  the verb returns as soon as the daemon has recorded the `running` row.
- Exit status is the truth, not the prose: `0` only when the run succeeded
  (or is still running), `1` when it failed, was cancelled, or is
  `unavailable` (the host never confirmed an outcome), and `1` with code
  `timeout` when the follow budget ran out. A timeout names the last
  observed status; it never claims the run died.
- Inside a Drogon terminal drop `--data-dir`; the shim already binds the
  running daemon.

Follow or report a run by its daemon run id (the `id` from `mentu run`, not
the runtime's `run_...` id):

```text
drogon-cli mentu run-status --run <RUN-ID> --json
drogon-cli mentu runs --workspace <ID> --limit 10 --json
```

`mentu run-status` exits 0 while a run is running or succeeded and 1 once
it settled as failed/cancelled/unavailable, so a shell `if` can branch on
it. Its `steps[]` fill in as the run progresses — the daemon mirrors the
runtime's own run record while the process is alive — and each step carries
`outputPath`/`errorPath` for the captured streams, so report the failing
step's label, exit code and error instead of paraphrasing the run.

Stop a run with:

```text
drogon-cli mentu cancel --run <RUN-ID>
```

Cancellation is asynchronous: the returned row may still read `running`, so
poll `mentu run-status` until it settles as `cancelled`. It works on any run
row, including one another agent started, which is why a run started from
the Mentu tab stays stoppable by the human (the tab's Cancel) and by you.

When a recipe is worth writing, its steps should be independently
verifiable: give each step a `shell` command whose exit code means
something, then run it and read the evidence back rather than asserting
success.

### Resume And Retry A Recipe Run

An in-flight or failed run can be continued without starting over.
`drogon-cli mentu resume --run <RUN-ID> --follow` relaunches the run in
its SAME run directory, rerunning only the steps that did not succeed (a
still-running prior run is refused until it settles). Retry one step with
`drogon-cli mentu retry-step --run <RUN-ID> --step <LABEL> --follow` —
the graph compiler emits each node id as its step label, so a graph node
retries with its node id, and succeeded steps are never redone. Exit
status follows the same truth table as `mentu run`.

## Work Graphs

A workspace can own a work graph: `<workspace>/.drogon/graph.json`
describes nodes with dependencies, and the daemon compiles it into Mentu
recipes. These verbs need the service capability `graph.v1`.

Read the graph with `drogon-cli graph read --workspace <ID> --json` —
each node's status is projected from real observation (`running` requires
a confirmed live process; loss of contact is `unverifiable`, never
failed), or inspect one node with
`drogon-cli graph node-state --workspace <ID> --node <ID>`. Write your
graph INTENT with
`drogon-cli graph write-intent --workspace <ID> --file graph-intent.json`
(intent only: a payload carrying `state` is refused, and a newer file
version is refused rather than rewritten).

Compile a node and its dependencies into a validated recipe with
`drogon-cli graph compile --workspace <ID> --node <ID>` (or
`--nodes <ID,ID>`; `--output` overrides the emitted path). Compilation
validates with the runtime's own check and doctor — it runs nothing —
and findings are attributed to the node that caused them.

Run the compiled node with
`drogon-cli graph run --workspace <ID> --node <ID> --follow`: the daemon
mints the approval for the exact compiled bytes and executes through the
Mentu run path, so there is no second engine. Resume or retry follow the
same seams as above (`graph resume` reruns every non-succeeded step,
`graph retry-step` reruns one), and `--follow` polls until the run
settles with the same exit-status truth table.

## Skill Topics

The `drogon-cli` guide and the orchestration guide are installable into
other agents' skill systems: `drogon-cli skills list --json` lists the
topics, `drogon-cli skills get --topic <TOPIC>` prints one, and
`drogon-cli skills install --skill <TOPIC> --agent <AGENT>` (or
`skills update`, `--all`; add `--dry-run` to preview the argv) installs or
refreshes them through the community `skills` CLI. `--dry-run` prints the exact npx argv without
running it, and installation never needs a running daemon.

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
- `browser` commands exit 1 with code `desktop_not_connected` when no
  Drogon desktop is connected to execute them.
- `mentu open` refuses with `method_not_found` when the service does not
  advertise `mentu.v1` or `browser.relay.v1`, with `desktop_not_connected`
  when no desktop is connected, and with the desktop's own refusal code
  when the window would not open the tab.
- `mentu run` exits 1 with `mentu_approval_required` when the recipe's
  current bytes have no approval, with `timeout` when `--follow` exhausts
  its budget, and with the daemon's own code (`not_found`,
  `invalid_argument`) for an unknown recipe or an approval that does not
  match it. It exits 1, never 0, for a run that settled as failed,
  cancelled or unavailable.
- The diagnostic passthrough `drogon-cli rpc status` sends one raw
  protocol method and prints the validated envelope.

## Next Action

Confirm `drogon-cli status --json` unless already checked this turn, then
choose the narrowest command: `workspace list`, `project list`,
`worktree list --project <ID>`, `terminal list`, `terminal read`, or
`terminal wait`. To run a Mentu recipe the human approved, use
`drogon-cli mentu run --workspace <ID> --recipe <ID> --follow`; to report on
one that is already in flight, `drogon-cli mentu run-status --run <RUN-ID>`.
To give a Bot a purpose that fires on change, bind a monitor action with
`drogon-cli bot bind-monitor --bot <ID> --workspace <ID> --monitor <ID>
--expected-rev 3 --responsibility-name <NAME>`. When discovering flags
from scratch, prefer
`drogon-cli agent-context --json` over guessing. For supervised work with
task ownership and completion tracking, read
`drogon-cli skills get --topic orchestration`.
