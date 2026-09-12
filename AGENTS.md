# Drogon rewrite

Read `README.md` for what the product is and `docs/SUBMISSION.md` for how it is
built and validated. Drogon is its own product now: the migration corpus that
tracked its origin as a port has been removed, and no plan document defines the
scope any more — the shipped behaviour, its tests, and the packaged acceptance do.

- Drogon is a standalone repository: Rust core, `drogond` daemon and
  `drogon-cli`, plus an Electron/React desktop. It does not depend on any other
  runtime to execute anything.
- The desktop UI began as a component-by-component port of the Orca source
  (MIT, © Lovecast Inc.). That attribution is permanent and non-negotiable:
  keep the notice `MIT Copyright (c) 2026 Lovecast Inc.` in every file that
  carries it, never strip one, and leave `THIRD_PARTY_NOTICES.md` intact. If you
  ever do port more MIT code, add the notice and list the source paths in your PR.
- Work only in your assigned worktree and the paths your Task names. Deliver by
  PR against `main` in `clioo/drogon`; never push to `main`. The PR
  description is your report: no new documents, inventories or plans.
- Coordinator-owned files unless your Task grants them: `package.json`,
  `pnpm-lock.yaml`, `Cargo.toml`, `Cargo.lock`, `crates/drogon-protocol/**`,
  `crates/drogon-core/src/lib.rs`, `apps/desktop/src/preload/**`,
  `apps/desktop/src/shared/**`, `apps/desktop/src/renderer/src/App.tsx`,
  `AGENTS.md`, `THIRD_PARTY_NOTICES.md`.
- Never modify credentials, global settings, `~/.claude`, `~/.codex`, the
  user's installed Orca, or frozen inputs. Never run real model inference from
  inside the app; use shell fixtures.
- Node 24 is `/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`;
  do not scan the home directory to rediscover it. pnpm 11.19.0 via
  `packageManager`.
- Every feature needs real tests. Skipped tests are not PASS, compile failures
  are not behavioral failures, and mocks of missing product behavior prove
  nothing. Liveness verdicts are `live`, `unverifiable` or `exited`; loss of
  contact never proves exit.
- Drogon's design is its own. Match the product as it ships — its existing
  components, tokens, copy, icons, keyboard and ARIA conventions — so a new
  surface is indistinguishable from the ones beside it. Where the owner supplies
  a design, that design wins. "The original did it this way" is no longer a
  reason for anything; a behaviour is justified by what serves the user and by
  the tests that prove it. Validate rendered UI with Playwright over CDP, not
  computer-use. Use domain-specific filenames and concise comments only where the
  code is non-obvious.
- Use `apply_patch` for edits when your harness offers it. Never commit
  secrets or raw provider transcripts.
- Workers with a live Orca dispatch preamble send `worker_done` exactly once
  after the PR exists; if the send fails, the PR is still the deliverable.

## Build fresh main

- Run `./scripts/build-main.sh` to package fresh `origin/main` in an isolated
  checkout; add `--verify` to run packaged acceptance in the background.
  This builds remote main, NOT uncommitted changes or the current feature branch.
- The command prepares Node 24 when available at the path above, installs the
  source's pinned pnpm locally and locked dependencies, then runs the official
  packager. Build directories and receipts remain in `.preflight/build-main/`.
  It never replaces an installed app, changes the caller's branch, stashes work,
  or stops user sessions. The package receipt identifies the revision and bundle.
- Regression tests: `node --test scripts/build-main.test.mjs`.

## Keep agent validation out of the foreground

- All agents and subagents must preserve the developer's OS focus, including
  during ad hoc Playwright/CDP checks. Launch a dedicated test instance with
  `DROGON_BACKGROUND_WINDOW=1` and separate temporary `DROGON_DATA_DIR` and
  `DROGON_ELECTRON_PROFILE` directories. Reuse existing Drogon launchers; do
  not drive the developer's working instance for interactive tests.
- Never call `page.bringToFront()`, CDP `Page.bringToFront`, `app.focus()`,
  `BrowserWindow.focus()`, or OS activation commands to make a check pass.
  Background validation windows must stay hidden, including during reloads
  and saved-window restoration; neither `show()` nor `showInactive()` belongs
  in that path. Verify OS activation and window visibility, not only DOM focus.
- Tests specifically exercising native foreground focus require an explicit
  user request and a documented reason. Never disable background mode as a
  generic retry or workaround for a failing test.
- On macOS, run `DROGON_VERIFY_OS_FOCUS=1 node scripts/accept-desktop.mjs`
  against a current build to record OS activation events and on-screen window
  owners from before launch through shutdown. This requires the Swift compiler;
  functional acceptance alone is not evidence that focus was preserved.

## Clean up every test-owned process

- Every agent owns cleanup of the processes it starts for validation: Electron
  helpers, detached daemons, PTYs, dev servers, and fixture servers. Use
  `try/finally` or equivalent teardown on success, failure, timeout, and
  cancellation. Reuse existing Drogon teardown code before writing new logic.
- Track process identities and isolated directories from launch. Capture
  descendants before closing their parent; closing a window or passing a test
  does not prove the daemon or its children exited. Close gracefully, wait with
  a bounded timeout, then terminate confirmed test-owned survivors, using force
  only if needed and rechecking identity before signaling to avoid PID reuse.
- Verify all owned processes exited before deleting their directories or
  reporting completion; include scoped process-check evidence in the PR.
  Never use broad executable-name `pkill`/`killall` commands. PPID 1, age, or
  high RAM alone does not prove abandonment; preserve other active sessions.
- Verify on the host that owns execution. If ownership or exit cannot be
  established, report remaining processes as `unverifiable` rather than
  killing unrelated work or claiming cleanup succeeded.
