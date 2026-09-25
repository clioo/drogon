---
name: drogon-cli
description: >-
  Drive Drogon through the public `drogon-cli`: resolve the executable, check
  status and capabilities, manage workspaces, projects and worktrees,
  operate terminals (create, list, send, read, wait, close) and the embedded
  browser pane (open, navigate, snapshot, click, fill, tabs), launch
  harnesses, create and run cron automations, work the Work board (Drogon
  tickets such as DRG-41, their columns and the prompts a column types into
  the sessions linked to its tickets: create, link, move, configure, send;
  import Jira, Linear and GitHub boards and sync, push and carry tickets
  across sprints),
  manage Bots and their self-managed automations, monitors and monitor
  actions, seal and grant integration secrets, and list and restore
  pre-migration backups. Use for terminal control, lightweight prompts and
  shell commands. Use the orchestration guide for supervised multi-agent
  coordination.
---

# Drogon CLI

Use `drogon-cli` when the Drogon daemon is the source of truth. It is the
only supported way for an agent inside a Drogon terminal to inspect or drive
Drogon state: never reach into daemon files or sockets directly. Reading
Drogon's generated `AGENTS.md` in your own Bot home is supported session
context, not an inspection of the daemon's private state.

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

For a simple repository question, do not launch a harness, create a worktree,
or delegate merely to run `git` or `gh`. Resolve the repository from the
current checkout or, in a Bot workspace, from `drogon-cli project list --json`;
then run the read-only command yourself, for example
`gh issue list --repo OWNER/REPO`. A direct request to edit or fix something
also permits this agent to make the change itself. Launch another agent only
for an explicit handoff or work that genuinely benefits from parallelism or
specialization.

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
self-management verbs, `bot.snapshot.v1` for `bot whoami`,
`bot.secrets.v1` for the secret verbs, and `graph.v1` for the native
work-graph verbs.

Run `drogon-cli status --json` first, then the narrowest command for the
job. The full guide for supervised coordination is one guide away:
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

A worktree created from inside a Drogon session nests under the calling
session's worktree in the sidebar (the daemon exports `DROGON_WORKSPACE_ID`
into every session; outside a session the worktree that contains the
current directory counts instead). That is how a subagent's worktree shows
up under its coordinator. Pass `--parent <ID>` (a worktree id or workspaceId
of the same project) to choose the parent yourself, or `--no-parent` for a
top-level worktree; an explicit parent that is not in the project refuses
the create.

## Terminals

Sessions are PTY processes with a stable id plus an incarnation token:
every `send`, `read`, `resize`, `wait` and `close` needs both. Start one
with `drogon-cli terminal create --workspace <ID> -- echo hi` (everything
after `--` becomes argv verbatim, no shell interpolation), and scope a
listing with `drogon-cli terminal list --workspace <ID>` or list all with
`drogon-cli terminal list --json`.

Write input with `drogon-cli terminal send --session <ID> --incarnation <TOKEN> --text <TEXT>`.
To send Enter, end the value with a real newline (shell `$'...'` quoting),
not the two characters backslash-n; a trailing carriage return or CRLF means
the same thing. That trailing terminator is delivered as one carriage
return — the byte a terminal puts on the wire when you press Enter, and the
only byte a raw-mode TUI reads as submit. Every other byte is delivered
unchanged, so a message whose lines end in LF lands in the composer whole
and the one Return at the end submits it as a single turn.
A carriage return INSIDE the value is Enter too, so convert CRLF line
endings to LF before sending a multi-line message, or each CR will submit
early.

That Return goes out as its own keypress: the body is written and flushed
first, and only then the Return — and when the far end reads a paste as
text, the body is wrapped in paste markers so the Return lands *after*
the marker that closes the paste. Without that, a long message and its
Return arrive in one read on a session that is mid-turn, the TUI's paste
heuristic takes the whole burst as pasted text, and the message sits in
the composer unsubmitted.

"Reads a paste as text" means the far end turned bracketed paste on and
is either a harness Drogon launched (every one of them is an agent
composer, whatever screen it paints on — Claude Code, Codex and Pi use
the normal screen, Antigravity the alternate one) or, for a session you
started yourself, a program on the normal screen. A full-screen
application you launched in a plain session (vim, `less`, `nano`) is
never framed for, because a paste there is text in a buffer rather than
the keystrokes you meant — `:wq` would be typed, not run. Those far ends
still get the paced Return; `bracketedPaste` in the result tells you
which happened.

Two things follow. A send costs about 40 ms more than it used to, so a
relay nudging many sessions pays that per session. And because the body
and the Return are separate writes, a session that dies between them
fails with an error naming what got through — resend just a Return, not
the whole message, or it is typed twice.

The result reports `acceptedBytes` (what reached the PTY — a trailing
CRLF is the one byte Return really is), `submittedEnter` (a Return
reached the PTY) and `enterDelivery`, which is the one to check:
`keypress` means it went out as a discrete keystroke, `inline` means it
was fused into the body's burst and a paste-detecting TUI may not submit
it, `none` means there was no Return to send. None of them is proof the
agent actually started a turn — a send is delivery, not receipt. Confirm
with `terminal read` (or `terminal wait --for output`) when it matters.
Pass `--literal` to write the bytes verbatim instead, with no Return
translation and no Enter, when you are piping data rather than typing a
message. Read bounded output with
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

## Work (tickets, columns and their prompts)

The Work board (service capability `work.v1`) is where the owner tracks
work across projects. A **ticket** is a Drogon record with its own key
(`DRG-41`: the project's initials, `WRK-n` without a project). It can link
the issue it tracks in another system (`--source <URL>`: GitHub, Jira,
Linear…), a pull request (`--pr <URL|#N>`), a workspace, and the
**sessions** working on it. Tickets sit in **columns** (To do, In progress,
Review, QA, Done by default; all configurable), and a column can type a
**prompt** into the sessions linked to its tickets:

- when a ticket **enters** the column (moved there, or created in it);
- on a **schedule** (`15m`, `2h`, `1d` or a UTC cron): every ticket in it;
- when the ticket's **pull request changes** (state, review, checks,
  updates; polled through `gh` every 5 minutes);
- on demand (`work column send`, the board's "Send now").

Delivery follows one rule per linked session: a **live** session is typed
into right away (a normal user turn in its composer); a session that is
**no longer live** is resumed with the prompt as its first turn (or started
fresh when the harness has nothing to resume); a ticket with **no** session
gets a new one in its workspace (else its project's), with the column's
harness or the default agent. A replacement session takes the old one's
place on the ticket, including when the terminal pane restarts it. Every
send is recorded with what happened to each session.

Read the board, and find the ticket you are working on:

```text
drogon-cli work board --json
drogon-cli work ticket list --column Review
drogon-cli work ticket show --ticket DRG-42 --json
```

When you start on a ticket, link the session you are in, so the column's
prompts reach you (inside a Drogon terminal `DROGON_SESSION_ID` names it):

```text
drogon-cli work ticket link --ticket DRG-42 --session <SESSION_ID>
```

When your part is done, move the ticket to the column that owns the next
step. Entering a column with an on-enter prompt sends it at once; the reply's
`delivery` says which sessions got it and how (`sent`, `resumed`, `started`,
`skipped`, `failed`):

```text
drogon-cli work ticket move --ticket DRG-42 --column QA --json
```

Create tickets (keys are assigned; quote a title with spaces), edit them
(`none` clears a link), open a ticket's session (resumed if it is no longer
running), detach a session, or delete a ticket (its sessions keep running):

```text
drogon-cli work ticket create --title <TITLE> --project Drogon --column Review --pr 648 --source https://jira.example.com/browse/DRG-9 --session <SESSION_ID>
drogon-cli work ticket update --ticket DRG-42 --next <TEXT> --pr none
drogon-cli work ticket open --ticket DRG-42 --session <SESSION_ID>
drogon-cli work ticket unlink --ticket DRG-42 --session <SESSION_ID>
drogon-cli work ticket delete --ticket DRG-42
```

Configure a column. The prompt (`--message <TEXT>`, or `--message-file`
for a longer one) supports `{ticket.id}` `{ticket.title}` `{ticket.pr}`
`{ticket.pr_number}` `{ticket.url}` `{ticket.description}` `{ticket.next}`
`{ticket.project}` `{ticket.column}` `{ticket.status}` `{ticket.drogon_key}`; `--recipients primary` sends only to
the first linked session. Write prompts that say what "done" means and how
to hand the ticket on, because the receiving agent acts on exactly that
text. A Review prompt, for example: "Review {ticket.pr} for {ticket.id}.
Check new feedback, approvals and required checks. When GitHub confirms the
merge, run `drogon-cli work ticket move --ticket {ticket.id} --column QA`."

```text
drogon-cli work column list --json
drogon-cli work column update --column Review --on-enter true --pr-watch true --schedule 15m --message-file review-prompt.md
drogon-cli work column create --name Blocked --icon blocked --index 2
drogon-cli work column preview --column Review
drogon-cli work column send --column Review --ticket DRG-42
drogon-cli work column delete --column Blocked --move-to Review
drogon-cli work sends --ticket DRG-42
```

Preview first when unsure: it changes nothing and names the action per
session (`send`, `resume`, `start`). A column that still holds tickets is
deleted only with `--move-to <COLUMN>`. Do not send the same prompt again
to "make sure": check `work sends` and read the session instead.

### Imported boards (Jira, Linear, GitHub)

With the service capabilities `work.boards.v1` and `work.sources.v1`, a
board can come from a ticket source: a **Jira** board, a **Linear** team
(its workflow states as columns, its cycles as sprints) or a **GitHub**
Project (its Status field as columns, its Iteration field as sprints) or a
repository's issues (Open and Closed). The board picker holds **My work**
(the local board above) and one board per import. Importing picks the
source's board as the frame: its columns become the board's columns, each
mapped to the statuses it stands for, and only the issues you choose come
in. Each imported ticket shows its source key (`APP-128`, `ENG-12`,
`owner/repo#12`) and keeps a hidden Drogon key (`key` in JSON); both are
accepted wherever a ticket is expected.

Every source starts allowed; the owner can turn any of them off (a source
that is off is never read or written). Jira uses the Tasks page's
connection; Linear takes a personal API key; GitHub uses the `gh` login, or
a token. Keys are read from stdin so they stay out of shell history:

```text
drogon-cli work sources
drogon-cli work source connect --provider linear --api-key-stdin
drogon-cli work source connect --provider github
drogon-cli work source disable --provider jira
drogon-cli work source enable --provider jira
drogon-cli work source disconnect --provider linear
```

Find a board, preview it, import the chosen issues. A board usually spans
several projects and people: import what is yours (`--mine`) plus what you
pick, and filter the preview by person (`--assignee me|none|<id>`), project,
status or words (`--open` leaves out finished issues). `--auto-import-mine true`
keeps bringing in new open issues assigned to you on every sync. `work import
settings` changes that later, and its `--project` sets where the board's
sessions start (New session and column prompts need a Drogon project):

```text
drogon-cli work import boards --provider linear --json
drogon-cli work import preview --provider linear --board <TEAM_ID> --assignee me --open
drogon-cli work import preview --provider github --board project:PVT_kwHO --scope backlog --search login
drogon-cli work import run --provider linear --board <TEAM_ID> --mine --auto-import-mine true
drogon-cli work import run --board 7 --issue APP-128 --issue APP-142 --project Drogon
drogon-cli work import settings --board 7 --auto-import-mine false
drogon-cli work import settings --board 7 --project Drogon
drogon-cli work boards
drogon-cli work board --board 7 --sprint backlog --json
```

Sync runs every 5 minutes (`work sync --board <BOARD>` runs it now). The
source wins for title, description, type, priority, assignee and sprint.
Status is the field both sides move, and the ticket's `sync` says where it
stands:

- `pending`: you moved the card into a mapped column; Drogon only until
  pushed (`work push --ticket <KEY>` or `work push --board <BOARD>`).
- `error`: the source refused the push (`pushError` says why); the card
  stays.
- `conflict`: the source changed the status while your move was unsynced;
  `work ticket resolve --ticket <KEY> --keep theirs` takes the source's (the
  card goes to its column), `--keep ours` pushes yours.
- `unmapped`: the source's status has no column; the card stays until a
  column adopts it (`work column update --column Blocked --statuses Blocked`).
- `removed`: the issue is not in the source anymore; kept, never deleted.

A status change in the source on a card with nothing pending moves the card
to the mapped column, logs "Moved by Jira" (or Linear, GitHub), and fires
the column's on-enter prompt.

Sprint boards show one sprint (cycle, iteration) at a time, by default the
active one, or the backlog, or a closed one. **Prompts fire only in the
active sprint.** A closed sprint is read-only; its reply carries
`view.outcome` (completed, carried forward, returned to backlog). Carry a
ticket over or send it back, then push, like a status move:

```text
drogon-cli work ticket sprint --ticket APP-122 --to active
drogon-cli work push --ticket APP-122
drogon-cli work ticket new-session --ticket APP-128 --harness claude
drogon-cli work ticket rename-session --ticket APP-128 --session <SESSION_ID> --title Implement
drogon-cli work import remove --board 7
```

In a prompt on an imported ticket, `{ticket.id}` and `{ticket.key}` are the
source key, `{ticket.status}` its status there and `{ticket.drogon_key}` the
Drogon key. Do not edit an imported ticket's title or description in Drogon
(refused); change it in the source and sync.

## Bots (self-management)

A Bot is a persistent agent identity with its own workspace, harness and
purpose. A Bot manages its OWN automations and monitors through the
`bot` verbs. Start with `bot whoami` to discover your identity; resource
commands then need `--bot <ID> --workspace <ID>` and the service capability
`bot.self.v1`.

### Find your own Bot ID

Run this FIRST inside your current Drogon Bot session:

```text
drogon-cli bot whoami --json
```

No `--bot` or `--workspace` is required. The command reads the existing
`DROGON_WORKSPACE_ID` environment and asks the daemon for the Bot whose
provisioned home owns that workspace. It uses the already-shipped
`bot.snapshot.v1` capability, including when the Bot record belongs to a
different project workspace. It does not read `AGENTS.md`, infer an ID from
names or paths, mutate the Bot, or restart the session. Changing your shell's
current directory does not change your identity.

Read `.result.botId` and `.result.workspaceId` from the successful JSON
response. Use those exact values with `drogon-cli bot list --bot <ID>
--workspace <ID> --json`, then reuse them for automations and monitors.
`bot list` lists ONE Bot's resources; it is not a bot catalog.

A generated `AGENTS.md` may also show `- Bot ID: <ID>` under `## Identity`,
but that is supplementary context, NOT a prerequisite. If your file lacks
that line, run `bot whoami` anyway. Do not ask the owner to regenerate files,
reopen the Bot, or copy an ID from Desktop just because the file is stale.
Your display name, `@handle`, folder basename (even `bot-175f377c`), and
`DROGON_SESSION_ID` are NOT substitutes for a Bot ID.

If the selected CLI does not recognize `bot whoami`, that CLI needs the
updated command; reloading a skill does not add executable behavior. Do not
silently switch binaries or data directories. If `DROGON_WORKSPACE_ID` is
missing, run the command in a Drogon-launched Bot session. A missing or
ambiguous daemon match, unsupported capability, or transport/snapshot error
must be reported as that exact failure, never replaced with a guessed ID or
an instruction to restart a live Bot solely to rewrite `AGENTS.md`.

### Provision and inspect

Provision the Bot's dedicated working folder with `drogon-cli bot
provision --bot <ID> --workspace <ID>` (automations and monitors live in
that home), and read everything the Bot owns with `drogon-cli bot list
--bot <ID> --workspace <ID> --json` (automations, monitors with their
health and revisions, home profile, audit count).

`bot list` also reports `folder` (where the Bot's record actually lives)
and `workspaceId` (the workspace that folder is registered under, which is
NOT the home workspace `bot whoami` returns). A `workspaceId` of `null`
with a `notice` means that folder has left the workspace registry — the
project or worktree it was created in was removed. The read still answers
in full, because the Bot's automations, monitors, home and audit trail are
untouched, and `bot test-monitor` still dry-runs, since it commits nothing.
Anything that must target a live workspace — creating or changing an
automation or monitor, and `bot test-automation`, which really can dispatch
— is refused with `workspace_deregistered` until the folder is registered
again with `drogon-cli workspace add <FOLDER>`. That code means the Bot is
intact; `unknown_workspace` means the id you passed names nothing on this
host.

### GitHub watches: pull requests and issues

Two verbs, one machinery:

- `drogon-cli bot watch-pr --bot <ID> --workspace <ID> --repo <OWNER/NAME>`
  watches a repository's PULL REQUESTS (`--filter` `opened` (default),
  `assigned` or `review_requested`; the last two need `--login <LOGIN>`).
- `drogon-cli bot watch-issue --bot <ID> --workspace <ID> --repo
  <OWNER/NAME>` watches its ISSUES (`--filter` `opened` (default) or
  `assigned`; `assigned` needs `--login <LOGIN>`). An issue cannot request
  a review, so `review_requested` is refused here.

Each releases the Bot's action once per NEW pull request (or issue). Unlike
a file monitor these are the USER lane (`bot.monitor_create` spells
`kind: github_pr.v1` / `kind: github_issue.v1`), so the rule's project is
the project workspace the Bot lives in and the released session opens a
WORKTREE OF THAT PROJECT — not of the Bot's home.

GitHub's issue list also returns pull requests; an issue watch drops them,
so a PR never releases an issue action.

**Never hand-roll either of these with `bot create-automation`.** An
automation that lists issues and keeps its own JSON "already seen" file has
no baseline step, so its FIRST run treats every currently-open issue as new
and fires one session per issue at once, with no cap — and its dedupe is
only as reliable as a model remembering to write the file. `watch-pr` and
`watch-issue` get both guarantees from the daemon.

Two optional flags are the case's dispatch choices, and both ride inside
the approval hash:

- `--harness <ID>` — the harness the dispatched session must use
  (`codex`, `claude`, `pi`, `opencode`). Without it the Bot's own harness
  policy decides.
- `--skill <NAME>` (repeatable) — the skills the dispatched session must
  use, so a frontend watch can say `--skill frontend-review` while a
  backend watch names another set.

The token is named by REFERENCE only: `--secret-ref GITHUB_TOKEN_REF`
(store the value with `secrets set --kind github`, grant it with `bot
grant-secret`). This watch goes through the network, so it is NEVER
auto-approved: `--approve` arms the exact rule hash in the same command,
and without it the watch stays parked at needs-approval and releases
nothing. `--api-base <URL>` points at a GitHub Enterprise host (defaults to
`https://api.github.com`).

The same pull request (or issue) never fires twice — dedupe is per NUMBER,
not a digest of the response, so a comment on an already-handled one is
quiet — and a watch that was not running (its first check ever, or a gap
wider than the greater of thirty minutes and twice its own cron interval)
SEEDS its baseline instead of replaying the backlog. Manual-trigger watches
use the thirty-minute grace. A burst drains one case per tick, oldest
first, and the per-Bot daily delegation cap still applies.

When it fires, the prompt it releases tells the Bot to open a worktree
named after the case (`review-pr-<n>-<repo>` or `issue-<n>-<repo>`), start
the session with `--harness <your choice>` and `--caused-by-event <event
id>`, and use the skills the watch names. It also names the case in the
right words and hands over the right command — `gh pr checkout <n>` /
`gh pr diff <n>` for a pull request, `gh issue view <n>` for an issue. The
session that appears therefore carries the event id, so "why did this
session appear?" has an answer in Session details and in the monitor's own
firing history.

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
the watched file stays in the home. No human approval is involved in that
self-lane edit loop.

A monitor observes by default — it records events and releases nothing.
Declare the ACTION it releases with --responsibility-name (plus optional
--instructions), which mints an enabled reactive responsibility and binds
it in the same call, or --responsibility-id to bind an existing reactive
one. A bound monitor's change event
makes the daemon dispatch a headless run of that responsibility: the
prompt is a template of event metadata plus the responsibility's standing
instructions (the watched file's bytes never enter it), the run is
idempotent per event (a replay joins the existing run instead of opening
a second one), and a bot-wide per-day cap bounds flood. The released monitor session
runs in the Bot's record-folder project workspace, while interactive Bot
sessions run in the provisioned home. The same binding
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

### Direct project work and delegation

A Bot may answer repository questions and perform project work itself when
the owner asks directly. For a simple lookup, resolve the project and run
normal `git` or `gh` commands directly; never launch a harness merely to list
an issue, inspect a PR, or read a file. For a bounded requested change, work
in the resolved folder or an isolated Drogon worktree without starting a
second agent.

Use the following delegation recipe only for an explicit handoff, unattended
monitor/schedule work, or a task that genuinely benefits from a separate
specialist or parallel worker:

1. Find the project: `drogon-cli project list --json`, matching the name or
   path the request names and reading its `id`, `kind` and `defaultBaseRef`.
   Nothing matching means stop and say so, never guess a path.
2. Get a workspace for the work, by the project's `kind`:
   - `git` — `drogon-cli worktree create --project <ID> --name <NAME>
     --json`, adding `--base <REF>` when the project has a `defaultBaseRef`.
     Read `.result.workspaceId`. A worktree created from a Bot's own home
     already lands top-level, directly under the project's row in the
     sidebar, because the home is a different workspace than the target
     project (see Projects And Worktrees above) — no `--parent` bookkeeping
     needed.
   - `folder` — a folder project has exactly one synthesized worktree row:
     `drogon-cli worktree list --project <ID> --json`, and use
     `.result.worktrees[0].workspaceId`. Never try to create a worktree for
     a folder project.
3. Start the session there: `drogon-cli harness start --workspace <ID>
   --harness <HARNESS> --permission-mode unattended --prompt <TEXT> --json`,
   with the harness/model the request names or the Bot's own default
   (`bot.harness_policy`) rendered literally, never a placeholder. Add
   `--caused-by-event <mev_…>` only when a monitor event caused this
   delegation. Read `.result.id` and `.result.incarnation`.
4. Follow it: `drogon-cli terminal wait --session <ID> --incarnation <TOKEN>
   --for idle --timeout-ms 900000`, then `drogon-cli terminal read --session
   <ID> --incarnation <TOKEN> --cursor 0 --limit-bytes 4096`. Report the
   session id, the worktree path/branch, and only what that read actually
   shows — never a result you did not observe.
5. A long-running or repeatable unattended request can become a responsibility
   instead of a one-off session — `bot create-automation` or
   `bot create-monitor` (above).

## Meetings

The owner's meeting notes come from **Write That Down**, a local-first macOS
meeting copilot that saves each finished conversation as plain Markdown
under `~/Transcripts/<YYYY-MM-DD>/<HH-MM>_<n>min.md`. There is no API, no
OAuth and no credential anywhere in this path: the notes are files, so
discover them with `drogon-cli meeting list --json` (newest first, with each
note's date, duration, path and id) and read one with `drogon-cli meeting
read --id <ID> --json`. Both require the service capability `meetings.v1`.

The folder is a corpus, not a list: with hundreds of transcripts, search it
instead of paging through it. `--query <TEXT>` is a case-insensitive
full-text search over each note and returns, per row, `matchCount` plus up to
three `matches` with the transcript line **and its line number**.
`--from <YYYY-MM-DD>` / `--to <YYYY-MM-DD>` bound the meeting date (inclusive)
and `--min-minutes <N>` / `--max-minutes <N>` bound the duration — a duration
filter only ever matches a finalized transcript, never a `recording` one.
The response echoes the filters it applied under `filters`, sets `searched`
and reports how many transcript files were read (`scanned`). A search that
finds nothing is not an empty folder: check `availability.reason` before you
say `empty`.

`meeting list` always reports where the folder came from and what state it
is in, as `availability.transcriptRoot`, `transcriptRootSource`
(`default` = `~/Transcripts`, `config` = the tool's own `config.json`, or
`environment` = `WTD_OUTPUT_DIR`) and `transcriptRootState` (`readable`,
`missing` or `unreadable`). Read `availability.reason` before you conclude
anything: `not-installed`, `transcript-root-missing` and
`transcript-root-unreadable` mean you cannot see the notes, which is NOT the
same as `empty` (the folder is readable and truly has no transcripts). A
file that fails to parse is still listed, as `status: "failed"` with its
`failureReason` and `filePath`, so name the file instead of skipping it.

Read-only by construction: Drogon indexes and displays these notes and
never edits, moves or deletes them (the wire says `readOnly: true`). Use
`--limit <N>` and `--offset <N>` to page (1..=200 per page; `hasMore` tells
you whether to keep going, and `scanTruncated` means the index stopped
early so `total` is a lower bound). `meeting read` refuses any id outside
the resolved notes folder, and `--max-bytes <N>` caps the returned content.

### From a meeting to tracked work

`drogon-cli meeting analyze --id <ID> --json` reads one note and returns
`suggested` decisions, actions and open questions, each with the verbatim
transcript `quote` it came from and that quote's `line`. It requires the
capability `meetings.actions.v1`.

Three rules make the output safe to act on, and they are enforced by the
daemon, not by the prompt:

- Analysis runs only after this explicit command and inherits the provider
  and model configured in Pi. Drogon neither selects nor overrides them, so
  check your Pi configuration before running it. Listing, searching and
  reading meetings never launch inference. When Pi is not installed the verb
  fails with `meeting_analysis_unavailable` and says so.
- A suggestion whose `quote` is not found **verbatim** in the note (or is
  shorter than 12 characters) is **discarded**, not shown. The answer reports
  `discardedCount` and the discarded items with their reason
  (`quote-not-found`, `quote-too-short`, `empty-text`). Treat everything in
  `decisions`/`actions`/`openQuestions` as verified against the transcript and
  everything in `discarded` as rejected evidence.
- `analyze` creates nothing. It returns suggestions; turning one into tracked
  work is an explicit act.

The ledger of accepted commitments is Drogon's own file
(`<data-dir>/meeting-commitments.json`); the notes folder is only ever read.
Record what the owner accepts with `meeting actions add --meeting-id <ID>
--text <TEXT> --quote "<line copied from the note>" [--owner <NAME>]
[--source suggested|owner]`. The daemon re-reads the note and verifies the
quote before storing anything: an unsupported claim is refused with
`commitment_quote_not_found` and nothing is written. `--source suggested`
records that the local model proposed it and the owner accepted it; `owner`
means the owner wrote it himself.

Across the corpus, `meeting actions list --open --json` answers the question
a large archive makes possible: what was promised and never closed. Filter
with `--status open|done|dismissed` or `--query <TEXT>` (matches the text,
owner, quote, meeting title and date). Every row carries `meetingId`,
`meetingTitle`, `meetingDate`, the `quote`, the `line` and the `id`; close one
with `meeting actions done --id <ID>` or `meeting actions dismiss --id <ID>`
(dismissed and done are deliberately different answers).

A typical Bot flow — a morning brief of yesterday's meetings with
recommended actions — is one automation whose prompt tells the harness to
run `drogon-cli meeting list --limit 20 --json`, filter the dates it cares
about, `drogon-cli meeting analyze --id <ID>` the notes that matter, and
deliver the brief the Bot already knows how to deliver. The same Bot can add
what the owner confirms with `meeting actions add` and report the open ones
with `meeting actions list --open`. Nothing in that chain needs a new
integration: the meetings come from the CLI and the schedule comes from the
`bot create-automation` verb.

## Backups (pre-migration restore)

Every forward schema migration snapshots the database first, into
`<data-dir>/backups/pre-migration-<STAMP>/` (newest 3 kept). When an older
Drogon build refuses a data directory that a newer build migrated forward
(`drogond` exits with "is newer than ..."), these backups are the way back:

```text
drogon-cli backups list --data-dir <PATH> --json
drogon-cli backups restore pre-migration-<STAMP> --data-dir <PATH>
```

`backups list` works with no daemon running and reports, per backup, the
creation timestamp, size, component versions at backup time, and whether
THIS build may restore it. A backup whose recorded schema is NEWER than this
build is listed but refused on restore — restoring it would land in the same
downgrade refusal. `backups restore` refuses while a daemon holds the data
directory (code `runtime_busy`), refuses backups whose manifest does not
match their contents (`invalid_argument`), and snapshots the current live
database into a `backups/pre-restore-<STAMP>/` folder before overwriting
anything, so a restore is itself reversible. After a successful restore,
relaunch Drogon; the refusing build starts normally.

## Secrets

`drogon-cli secrets set --kind <KIND> --name <NAME>` seals one integration
secret value into the daemon store — the value is read from stdin, never
argv or echo: `printf '%s' "$GITHUB_TOKEN" | drogon-cli secrets set --kind
github --name GITHUB_TOKEN_REF`. `secrets list --json` shows what is
sealed (names and kinds, never values) and `secrets delete --kind <KIND>
--name <NAME>` removes one. Grant a sealed reference to a Bot with
`drogon-cli bot grant-secret --bot <ID> --workspace <ID> --secret-ref <NAME>
--kind <KIND>` (above).

## Work Graphs

A workspace can own a work graph: `<workspace>/.drogon/graph.json`
describes nodes, dependencies, native orchestration policy, evidence, and
usage. These verbs need the service capability `graph.v1`.

Read the graph with `drogon-cli graph read --workspace <ID> --json` —
each node's status is projected from real observation (`running` requires
a confirmed live process; loss of contact is `unverifiable`, never
failed), or inspect one node with
`drogon-cli graph node-state --workspace <ID> --node <ID>`. Write only the
human-owned intent with
`drogon-cli graph write-intent --workspace <ID> --file graph-intent.json`.
For example, `graph-intent.json` can contain:

```json
{
  "nodes": [],
  "policy": {
    "approvedRuntimes": [
      {
        "harness": "pi",
        "provider": "openai-codex",
        "model": "gpt-5.6-luna"
      }
    ],
    "fallbackRuntime": {
      "harness": "claude",
      "model": "claude-sonnet-5"
    },
    "adversarial": {
      "enabled": true,
      "maxIterations": 3
    },
    "delegate": false
  }
}
```

A payload carrying `state` is refused, and a newer file version is refused
rather than rewritten. In this example `delegate` is false because the two
stored selectors are mutually exclusive; Adversarial itself already implies
delegation.

### Subagent Policy And The Adversarial Loop

The canonical mode definitions and the leader-driven adversarial procedure live
in `drogon-cli skills get --topic orchestration`; read its **Read The Workspace
Policy Before Delegating** section before acting on a policy. Do not reinterpret
the mutual-exclusion rule as an instruction to implement directly:
Adversarial means Delegate plus the critique/correction loop. The leader does
not implement in either delegated mode. The adversarial loop exits as soon as a
round finds nothing adversarial and otherwise stops at `maxIterations`.

A graph's intent carries its Subagent policy at `intent.policy` (visible in
`drogon-cli graph read --workspace <ID> --json`). The main agent MUST read that
result and `drogon-cli graph observability --workspace <ID> --json` before it
plans or delegates. These are the native `.drogon` policy, evidence, and usage
records: use them to avoid duplicating completed work and to choose the configured
runtime order without guessing. A simple lookup, repository discovery, or
ordinary `gh` command remains direct coordination work and does not require a
worker.

A workspace with no configured policy has no Drogon-managed policy block in
`AGENTS.md`: no policy block means Delegate OFF, Adversarial OFF, and no
approved runtimes. Read the graph to confirm before deciding how to act. A
configured policy is delivered into the next session's managed block; returning
to the default removes that block without touching owner content. A policy with
both stored selectors true is invalid and is refused.

`policy.approvedRuntimes` is ordered, and `policy.fallbackRuntime` is tried only
after the approved entries fail to execute. Each runtime entry stores only
`harness`, `provider`, and `model`; provider and model are an inseparable
selection, and a worker must never guess a provider for an ambiguous model id.
There is currently no effort field in a policy runtime, so an effort level shown
by a runtime picker is not persisted in `approvedRuntimes` and cannot be passed
to policy-selected workers from that entry. Adding policy-runtime effort is a
follow-up, not part of this schema.

After `run-create`, use the returned `consumerGeneration` in
`drogon-cli orchestration worker-start --run <ID> --coordinator-id <ID> --consumer-generation <GENERATION> --task <ID> --workspace <ID>`.
That command applies the policy order and records the actual pair. An explicit
`--harness --provider --model` is an intentional override; omitting those fresh
flags lets the daemon select from policy.

The Orchestrator accepts one main-task node: the normal `GraphNodeIntent` JSON
shape with an enabled node and no dependencies. For example,
`main-task.json` can contain:

```json
{
  "id": "main",
  "title": "Implement the requested change",
  "harness": "claude",
  "model": "claude-sonnet-5",
  "prompt": "Implement the requested change, validate it, and report the evidence.",
  "enabled": true,
  "dependsOn": []
}
```

The desktop saves the task and policy automatically. A run captures their
configuration, and closing a view does not stop it. The same admission and
control surface is available to agents:

```sh
drogon-cli graph orchestrator-start --workspace <ID> --file main-task.json
drogon-cli graph orchestrator-status --workspace <ID> --json
drogon-cli graph orchestrator-stop --workspace <ID> --run <RUN_ID>
drogon-cli graph orchestrator-resume --workspace <ID> --run <RUN_ID>
```

Status includes the captured policy, iterations, evaluations and actual
runtime attempts. Policy edits apply to the next run. Stop requests
cancellation: wait for `stopped` before treating work as stopped. Resume
retains completed roles and refuses an unverifiable run. Every authored child
brief must prohibit further delegation so all workers remain at depth one.
This is not a sandbox restriction on arbitrary commands an agent can run.

### Native Evidence And Usage

The lead agent keeps human-readable progress in Drogon's native workspace
ledgers. Record a checkpoint after a meaningful result, finding,
blocker, or completion (not after every tool call):

```sh
drogon-cli graph evidence-add --workspace <ID> --status progress --summary <SUMMARY> --detail <DETAIL> --artifact reports/unit.txt --agent leader --role implementation
```

Statuses are `progress`, `finding`, `blocked`, `completed`, and `failed`.
Entries are stored in `.drogon/evidence.json`; the desktop Evidence tab and a
plain text editor read the same file. Include only workspace-relative artifact
references or concise external references—never credentials or provider
transcripts.

Every agent and subagent should report exact token counts when its harness
provides them:

```sh
drogon-cli graph usage-add --workspace <ID> --input 1200 --output 340 --cache-read 800 --harness pi --model <MODEL> --agent <AGENT_ID> --role review
```

Each usage entry is an incremental measurement; do not submit a cumulative
session total twice. Omit fields the harness did not report—missing usage is
unknown, never zero. The native `.drogon/usage.json` ledger and Usage tab sum
only reported values. Read both ledgers with
`drogon-cli graph observability --workspace <ID> --json`.

Work Graph opens the Orchestrator directly. The manual node designer and
named-workflow desktop review flow are retired from the UI; the sidebar
opens the same Work Graph tab. Existing graph and workflow files are preserved.
Use the Orchestrator commands above for durable test/review cycles and
independent execution/evaluation results.

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
The daemon injects Drogon runtime context on the first turn of every harness
without creating a policy file in an unconfigured workspace. That context says
that delegation goes through the managed `drogon-cli`, directs the harness to
read `drogon-cli skills get --topic orchestration`, and includes the Work Graph
provider/model order. A harness must use `orchestration worker-start` without
fresh runtime flags to honor that policy; children finish with
`drogon-cli orchestration send --kind worker_done --subject <TEXT> --outcome succeeded --body <TEXT>`.
The service resolves the host executable, so there is never a local binary
to point at. A harness id is server-authoritative: pass it through
verbatim as advertised by `harness list`.

When a monitor event caused the session, say so: `--caused-by-event
<mev_…>` records that monitor event id on the session, so anyone looking
at it can see WHY it appeared (and cross-check the firing in `bot list` /
the Bots page). The value must be a real event id (`mev_` plus 32 hex);
anything else is refused. A delegated run passes this flag on both hops:
the Bot's own run and the review session it dispatches.

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
- The diagnostic passthrough `drogon-cli rpc status` sends one raw
  protocol method and prints the validated envelope.

## Next Action

Confirm `drogon-cli status --json` unless already checked this turn, then
choose the narrowest command: `workspace list`, `project list`,
`worktree list --project <ID>`, `terminal list`, `terminal read`, or
`terminal wait`. For tracked work, start from `work board --json`: link
your session to its ticket and move the ticket when your step is done.
To give a Bot a purpose that fires on change, bind a monitor action with
`drogon-cli bot bind-monitor --bot <ID> --workspace <ID> --monitor <ID>
--expected-rev 3 --responsibility-name <NAME>`. When discovering flags
from scratch, prefer
`drogon-cli agent-context --json` over guessing. For supervised work with
task ownership and completion tracking, read
`drogon-cli skills get --topic orchestration`.
