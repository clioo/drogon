# Drogon demo script (5 minutes)

A presenter-ready path through the twelve MVP journeys in five minutes. Timings are
cumulative; keep the app warm and logged in before the audience arrives.

## Before you go on stage (not timed)

- Use the **installed preview** (`~/Applications/Drogon.app`, installed via
  `scripts/install-preview.mjs`) or a release dev build — not `pnpm dev`.
- Theme: dark, window maximized, system notifications allowed (the
  `needs_input` notification is a highlight of the demo).
- Have a throwaway Git repository ready, e.g. `~/drogon-demo` — a small web or
  CLI project with 2–3 files, committed on `main`, pushed nowhere.
- Have **one coding harness installed and authenticated**. Recommended: **Pi with
  the local model** (`dgx-spark/qwen3.8-flash-next-nvidia-nvfp4`) for a zero-cost
  run, or Claude Code with a small model for the best-looking status transitions.
- `gh` authenticated for the Tasks segment (optional; the page renders a clear
  empty state without it).
- Warm-up: add the project, create the worktree, open the tab — then close the
  tab without killing the session so the demo starts from a warm workspace list.

## The script

### 0:00–0:30 — One-liner and the shell (J1)

> “Drogon is an open-source rewrite of the Orca desktop: a Rust daemon owns your
> terminals, worktrees, and agents; this Electron desktop is just the view. If the
> app crashes, your sessions don't.”

Show the empty-but-warm window. Point at the sidebar: the **demo project card**
with its worktree and the session row that survived the warm-up restart.

### 0:30–1:30 — Backbone live (J1, J12)

1. Click the worktree card → the workspace opens with the restored **Terminal 1**
   tab and its scrollback intact.
2. Press `⌘N` (or **New workspace**) — say: “every task gets its own worktree,
   its own branch, its own agent.” Create a worktree named `demo-fix`.
3. Launch an agent from the **+** menu: choose the harness and the small model.
   While it starts, point at the **tab strip and sidebar**: idle → working.
4. Give the agent one instruction, e.g. _“list the files and summarize what this
   project does in one sentence.”_ Watch the terminal scroll (J1 state + visible
   run).
5. Glance at the **status bar** (J12): connection segment, memory, session count,
   provider usage meter. “The bottom bar is Orca's: usage, awake toggle, ports.”

### 1:30–2:15 — Review where the work happens (J2, J5)

1. When the agent finishes, open the changed file from the terminal link or
   **⌘P quick open** → the **Monaco editor tab** (J5: mention `⌘J` jumps between
   workspaces/sessions, `⌘K` runs commands).
2. Open the **Source Control** panel on the right rail: diff, stage, and
   **commit** the change in-app. “Review, stage, commit, push, and PR — without
   leaving the workspace.” (Skip push/PR live if the repo has no remote.)

### 2:15–3:00 — Tasks and browser (J6, J4)

1. Click **Tasks**: GitHub Issues for the current repo via `gh`, with filters and
   pagination. Say: “an issue is a starting point, not a URL.”
2. If a networked repo is available, press **Start** on an issue → a worktree with
   the issue badge appears. Otherwise show the page and move on.
3. Open the **browser tab** (J4): navigate to the project's local preview URL or
   any page. Mention: “agents drive this same browser through `drogon-cli` —
   `browser open`, `snapshot`, `click`, `fill` — so web checks happen inside the
   task, not in a side window.”

### 3:00–3:45 — Recurring work: Automations and Bots (J7, J8)

1. **Automations**: show the morning-brief example draft — workspace, harness,
   cron in local time. Click **Run now** against the `demo-fix` workspace.
2. Open the **Runs dashboard**: the run appears with live status; open the run
   detail for the output snapshot.
3. **Bots**: show a bot card with its responsibilities (cron-backed) and history.
   One sentence only: “bots own recurring duties; automations own recurring
   prompts; both leave a trace you can inspect.”

### 3:45–4:30 — Approval-driven work: Mentu (J9)

1. Open **Mentu**, pick a small recipe (e.g. a lint-and-report recipe). The recipe
   renders as a graph; **Approve** pins the exact content hash.
2. **Run** it with the pinned runtime; expand a step's **evidence** (stdout/stderr
   per step). Mention cancel/retry. “Approval by hash: what you approved is
   exactly what ran, and the evidence is attached.”

### 4:30–5:00 — Close and Q&A hooks

1. Restart the daemon from **Settings → Restart daemon** (or quit and reopen the
   app). Sessions come back with their state — “the daemon, not the window, owns
   the work.”
2. Land on the license slide: MIT, attribution to Orca/Lovecast for the ported UI,
   Bots/Automations/Mentu concepts from the fork. Invite people to
   `github.com/clioo/drogon`.

## Fallbacks

- **No network / no model provider**: replace the agent launch with a plain shell
  tab and drive it with `drogon-cli terminal send` from another terminal — the
  state machine, persistence, and UI behave identically. Say so; judges value the
  honesty.
- **`gh` not authenticated**: Tasks shows its empty state; pivot to “add a project
  from a folder instead of a repo.”
- **Notification permission missing**: show the in-app state badge instead of the
  native notification; re-enable later in Settings.
