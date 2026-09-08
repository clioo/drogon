# Desktop acceptance checks

`scripts/accept-desktop.mjs` drives the real desktop (packaged bundle via
`--bundle`, dev build via `--files` or `--harness pi`) over CDP and records
one named check per proven behavior. A run passes only when every check
names something the probe observed in the rendered app; the check names of
the final green run are the report.

Every wait is bounded; nothing in a run may depend on paid inference. The
model-dependent journeys talk only to the team-local model
`dgx-spark/qwen3.8-flash-next-nvidia-nvfp4` (`http://100.85.64.21:9292/v1`),
seeded per run through the daemon's provider store and a fixture
`PI_CODING_AGENT_DIR` so `pi` resolves it unattended. Journeys that create
bots, automations, worktrees or projects remove them again before the run
ends (`leave nothing behind`).

## J1 — Sessions (Pi local model, working → settled)

| Check | Proves |
| --- | --- |
| `pi-local-session-shows-working-then-idle-in-tab-badge` | a `pi` session on the local model reaches `Working` in its tab badge while the model streams, then a settled `Idle` or `Waiting for input` state after the turn |
| `pi-local-session-shows-working-then-idle-in-worktree-card-row` | the same working → settled transition renders in the worktree card's session row |

Pi's native `AgentEnd` hook classifies a completed interactive turn as
`needs_input`, rendered as `Waiting for input`; builds without that hook settle
as `Idle`. The probe requires both tab and card to agree and accepts only those
two post-turn states (never a premature `Working`).

## J5 — Jump palette (⌘J)

| Check | Proves |
| --- | --- |
| `palette-opens-from-registry-chord-Mod-J` | the jump palette opens from the chord recorded in the real pi keybinding registry |
| `jump-palette-switches-workspace-and-back-Mod-J` | choosing another workspace from the palette switches the selection (sidebar card carries `aria-current="page"`) and switches back |

## J6 — Tasks (Start from issue)

| Check | Proves |
| --- | --- |
| `tasks-page-renders-honest-state-with-gh-outside-fixture-path:no-github-remote` | with no reachable `gh`/remote the page names the blocker instead of hanging (pre-existing) |
| `tasks-start-from-issue-creates-worktree-with-issue-badge` | Start from issue (via fixture `gh`) creates the `issue-N-<slug>` worktree, badged `#N` with title `Started from issue #N` |
| `tasks-start-leaves-no-worktree-or-project-behind` | the run's own worktree and project are removed again before the run ends |

## J7 — Automations (Run Now)

| Check | Proves |
| --- | --- |
| `automations-page-lists-empty-with-create-entry` | the page renders its empty state with a create entry (pre-existing) |
| `automations-cli-create-lists-new-automation` | CLI creation lists in the UI (pre-existing) |
| `automations-page-renders-created-row` | the created row renders (pre-existing) |
| `automations-manual-run-recorded-once:dispatched` | a manual run is recorded exactly once (pre-existing) |
| `automations-run-now-button-records-succeeded-run-row` | the UI Run Now button records a new run row that settles as the UI's `Done` (`succeeded`) state on the free local model (bounded retries while the shared server is busy) |
| `automations-run-detail-renders-output-snapshot-with-marker` | the run detail page renders the persisted output snapshot containing the run's marker |

## J8 — Bots (preset create + manual run)

| Check | Proves |
| --- | --- |
| `bots-page-renders-empty-with-create-entry` | the page renders its empty state with a create entry (pre-existing) |
| `bots-ui-create-renders-bot-in-list` | creating the preset bot (`dgx-spark/qwen3.8-flash-next-nvidia-nvfp4`) renders it in the list |
| `bots-responsibility-card-renders-saved-duty-with-run` | the saved responsibility card renders with its Run button |
| `bots-preset-create-with-local-pi-model` | the bot persists with the free local model selected (CLI cross-check) |
| `bots-manual-responsibility-run-history-row-exited` | a manual run records a visible history row that settles `· exited` (bounded retries while the shared server is busy) |
| `bots-run-output-visible-in-automation-detail` | the responsibility persists as a bot-owned automation whose run detail shows the model output |

The created bot and its responsibility are deleted through the UI before
the run continues.

## J9 — Mentu (approve + run)

| Check | Proves |
| --- | --- |
| `right-sidebar-mentu-lists-fixture-recipe-with-steps` | the panel lists the two-step shell fixture recipe (pre-existing) |
| `mentu-approve-and-run-two-step-recipe-succeeds` | Review Run → Approve & run executes both shell steps and the run settles `Succeeded` |
| `mentu-evidence-shows-both-step-statuses-and-outputs` | the Evidence view shows both steps with passing statuses and the captured stdout of each step (`write-marker` output, `read-marker` output) |

The fixture recipe and its run artifacts live in the scratch workspace,
which the run removes.

## J10 — Settings (theme persists)

| Check | Proves |
| --- | --- |
| `settings-page-opens-from-shortcut` | ⌘, opens Settings (pre-existing) |
| `settings-page-returns-to-prior-view` | leaving Settings returns to the prior view (pre-existing) |
| `settings-theme-dark-persists-across-packaged-relaunch` | flipping the theme persists across a real quit + relaunch of the app (restored after the proof) |

## J12 — Status bar (1440 / 760)

| Check | Proves |
| --- | --- |
| `status-bar-present-at-24px-matching-stylesheet-24px` | the bar renders at its 24px height (pre-existing) |
| `status-bar-no-overflow-at-760-and-1440` | no horizontal overflow at either width (pre-existing) |
| `status-bar-segments-present-at-760-and-1440` | Settings, Help, Claude/Codex usage meters, awake, Memory, live-terminal and ports segments render at both widths |

## Surfaces, shell and resilience (pre-existing)

| Check | Proves |
| --- | --- |
| `composer-opens-folder-implicit-workspace` | opening a folder registers its implicit workspace |
| `composer-creates-git-worktree-and-selects-it` | the composer creates a worktree and selects it |
| `new-workspace-composer-lists-folder-project-and-cancels` | the worktree composer lists the folder project and cancels cleanly |
| `add-project-dialog-renders-path-field-and-cancels` | the add-project dialog renders its path field and cancels cleanly |
| `folder-project-renders-row-with-implicit-card` | the folder project row renders with its implicit card |
| `isolated-renderer-and-real-folder-registration` | the renderer loads isolated and the folder registers for real |
| `rendered-terminal-command-output` | a rendered terminal shows live command output |
| `renderer-reload-retains-exact-session-and-output` | reload retains the exact session and its output |
| `tab-strip-plus-menu-creates-terminal-with-live-output` | the + menu creates a terminal with live output |
| `tab-strip-plus-menu-creates-browser-tab-rendering-guest` | the + menu creates a browser tab rendering the guest page |
| `cli-browser-snapshot-proves-ui-created-guest` | the CLI snapshot proves the UI-created guest is a real session |
| `keyboard-tab-navigation-and-sibling-close` | keyboard tab navigation and sibling close behave |
| `exact-session-close-through-ui` | closing a session through the UI is exact |
| `explicitly-closed-tabs-stay-dismissed-after-reload` | explicitly closed tabs stay dismissed across reload |
| `light-dark-captures-and-narrow-no-overflow` | light/dark captures render without overflow at narrow widths |
| `right-sidebar-explorer-opens-fixture-file-into-editor` | the explorer opens a fixture file into the editor |
| `right-sidebar-source-control-stages-unstaged-edit` | source control stages an unstaged edit |
| `right-sidebar-session-details-empty-without-sessions` | session details render its empty state |
| `right-sidebar-session-details-shows-live-session` | session details show the live session |
| `changes-panel-renders-unstaged-edit-for-fixture-repo` | the changes panel renders the fixture repo's unstaged edit |
| `terminal-registry-exposes-live-buffers-x1` | the terminal registry exposes live buffers |
| `daemon-restart-renders-session-list-with-new-tab` | after kill -9 + restart the session list still renders with New tab |
| `daemon-restart-keeps-terminal-list-with-exited-history` | the terminal list keeps exited history across the restart |
| `daemon-restart-exited-stub-tab-close-forgets-record` | closing an exited stub's tab forgets its record |
| `daemon-restart-exited-stub-retry-offers-recovery-overlay-with-restart` | Retry on a stub offers the recovery overlay with Restart |
| `daemon-restart-exited-stub-kill-all-clears-stubs-and-live-sessions` | Kill all sessions clears stubs and live sessions alike |
| `bundled-cli-resolves-inside-app-with-hook-event` | the bundled CLI resolves inside the app and emits its hook event |

## Runs

- `node scripts/accept-desktop.mjs --files` — dev-build acceptance.
- `node scripts/accept-desktop.mjs --files --harness pi` — plus the pi
  harness surfaces.
- `node scripts/accept-desktop.mjs --bundle <Drogon.app>` — sealed
  packaged acceptance (macOS): the bundle digest is verified before and
  after the run (`sealed-final-artifact-identity-unchanged-after-acceptance`).
- `node scripts/accept-desktop.mjs --bundle <Drogon.app> --files` —
  packaged acceptance with the surfaces probes, which is where the sealed
  journey checks (J1, J5–J10, J12) run.
- Pure helpers of the journey probes are unit-tested by
  `node --test scripts/probe-sealed-journeys.test.mjs` (part of
  `pnpm test:packaging`).
- `DROGON_SKIP_MODEL_JOURNEYS=1` skips only J1/J7/J8 (the shared local
  model is unavailable); it exists for local iteration and never defaults.

A typical sealed run with surfaces takes under eight minutes end to end.
