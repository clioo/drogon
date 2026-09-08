# Drogon demo script (5 minutes)

A presenter-ready path through the twelve MVP journeys in five minutes. Timings are
cumulative; prepare the disposable fixture before the audience arrives.

## Before you go on stage (not timed)

- Use the **installed preview** (`~/Applications/Drogon.app`, installed via
  `scripts/install-preview.mjs`) or a release dev build — not `pnpm dev`.
- Set the theme to **dark**, maximize the window, and allow system notifications
  if you want to show the `needs_input` notification.
- Prepare the exact fixture used below while a Drogon daemon is running:

  ```sh
  node scripts/demo-fixture.mjs --qa
  ```

  The `--qa` form uses the daemon started by
  `scripts/qa/drogon-ui.mjs start`. For a non-QA daemon, pass `--data-dir` and
  `--cli` instead. The command creates `/tmp/drogon-demo`, registers the
  **Drogon demo** project and its `demo-fix` worktree, creates the
  **Drogon demo bot** with its **Manual demo review** responsibility, registers
  **Run demo shell command**, checks `demo-hello`, and installs the pinned Mentu
  runtime when it is not already present. It never starts a terminal, harness,
  model, or web server.

- If the app was already open when the CLI fixture was prepared, reload it with
  `⌘⇧R` (**Force Reload**) or quit and reopen it so the project registry and
  runtime status are loaded. Do not use `--wipe` during QA; it removes the
  disposable data before the next run.
- The fixture intentionally starts with **no session**. Set Pi's defaults under
  **Settings → Agents** before the demo if you want the agent segment; choose
  the local `dgx-spark/qwen3.8-flash-next-nvidia-nvfp4` model and do not use a
  paid fallback.
- `gh` authentication and a GitHub remote are optional. This fixture has no
  origin remote, so the Tasks page's honest local empty state is expected.

## The script

### 0:00–0:30 — One-liner and the shell (J1)

> “Drogon is an open-source rewrite of the Orca desktop: a Rust daemon owns your
> terminals, worktrees, and agents; this Electron desktop is just the view. If
> the app crashes, your sessions don't.”

Show the project card: **Drogon demo → demo-fix**. It says **No sessions yet**
because the fixture leaves the terminal creation for this live part of the demo.

### 0:30–1:30 — Backbone live (J1, J12)

1. Click **demo-fix**. The workspace opens on **Start a session**.
2. Click **New tab → New Terminal ⌘T** (or the **New terminal** button). Type
   `make hello` and press Enter. The shell prints `created greeting.txt` and the
   card changes to **1 session idle**.
3. If an agent run is part of the presentation, open **New tab** again and choose
   **Pi**. Harness rows launch immediately with the defaults from **Settings →
   Agents**; there is no second model picker in this menu. Say: “every task gets
   its own worktree, its own branch, its own agent.” Give it one instruction,
   such as _“list the files and summarize what this project does in one
   sentence.”_ Watch the tab and sidebar move from working to idle.
4. Point at the status bar (connection, usage meters, awake state, and session
   count): “The daemon owns the state; the window is only the view.”

### 1:30–2:15 — Review where the work happens (J2, J5)

1. Press `⌘P` (**Go to File**) and open `README.md` or `index.html` in the
   Monaco editor. `⌘J` switches worktrees; `⌘K` clears the active terminal, so
   use the visible tab menu for other actions.
2. Open **Source Control (⌘⇧G)** on the right rail. The `greeting.txt` change
   can be reviewed, staged, and committed in-app. “Review, stage, commit, push,
   and PR — without leaving the workspace.” (This fixture has no remote, so
   skip push/PR.)

### 2:15–3:00 — Tasks and browser (J6, J4)

1. Click **Tasks**. The fixture shows **GitHub · Local · Drogon demo** and the
   message that the repository has no origin remote pointing at GitHub. With a
   networked repository, select the project, click **Open**, and use the Issues
   filters; a task can start a worktree from an issue.
2. Return to **Sessions**. Open **New tab → New Browser Tab ⌘⇧B** and enter
   `http://127.0.0.1:4173/`. To serve the fixture first, run `make serve` in
   Terminal 1; stop it with `Ctrl+C` when the browser segment ends. The page
   title is **Drogon demo**. Agents can drive this same browser through
   `drogon-cli browser open`, `snapshot`, `click`, and `fill`.

### 3:00–3:45 — Recurring work: Automations and Bots (J7, J8)

1. Click **Automations**. The fixture lists **Manual demo review** and **Run
   demo shell command**, both enabled on `demo-fix` with a future **Custom
   schedule** and Pi routing. Open an automation's actions menu to show **Run
   Now**, **Edit**, **Pause**, and **Delete**. **Run Now** dispatches the
   configured Pi prompt; use it only when the local model is available.
2. Click **Runs** to show the cross-automation run dashboard after a local run.
   Do not claim a run exists in a fresh fixture: both rows start with **Never**.
3. Open **Bots**. Show **Drogon demo bot**, its Pi/model policy, and the
   **Manual demo review scheduled** responsibility. Its **Run Manual demo
   review** button is the manual trigger; it is intentionally not invoked in a
   no-inference rehearsal.

One sentence: “bots own recurring duties; automations own recurring prompts;
both leave a trace you can inspect.”

### 3:45–4:30 — Approval-driven work: Mentu (J9)

1. Open **Mentu** and choose **Drogon demo hello**. The three-node graph is
   `write-greeting → check-page → verify-demo`, all local shell steps.
2. Click **Review Run**. Show the content hash and **Runner: mentu-recipes
   0.4.0**, then click **Approve & run**. The pinned runtime executes the
   fixture's shell-only recipe without a model.
3. Select **Evidence**. Point to the stdout/stderr paths for each succeeded
   step. Mention cancel/retry: “Approval by hash: what you approved
   is exactly what ran, and the evidence is attached.”

### 4:30–5:00 — Close and Q&A hooks

1. Stop the preview server with `Ctrl+C` if it is still running. Restart the
   daemon from **Settings → Restart daemon** (or quit and reopen the app).
   Sessions come back with their state: “the daemon, not the window, owns the
   work.”
2. Land on the license slide: MIT, attribution to Orca/Lovecast for the ported
   UI, and Bots/Automations/Mentu concepts from the fork. Invite people to
   `github.com/clioo/drogon`.

## Fallbacks

- **No network or no model provider:** use the plain shell tab and drive it with
  `make hello` or `drogon-cli terminal send` from another terminal. This shows
  the real persistence and UI state machine without inference.
- **`gh` not authenticated or no remote:** keep the Tasks empty state on screen;
  pivot to “add a project from a folder instead of a repo.”
- **Pinned Mentu runtime unavailable:** run the fixture with the pinned source
  path available, or show the honest runtime-unavailable status and skip
  execution. Do not substitute another binary.
- **Notification permission missing:** show the in-app state badge instead of
  the native notification; re-enable later in Settings.

## Teardown

After the rehearsal, while the same daemon is running, remove only the fixture's
marked registrations and files:

```sh
node scripts/demo-fixture.mjs --qa --teardown
node scripts/qa/drogon-ui.mjs stop --wipe
```

Teardown refuses an unmarked `/tmp/drogon-demo`, removes only resources recorded
in `.preflight/demo-fixture.json`, and is safe to repeat.
