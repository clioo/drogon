# Drogon rewrite

Read `docs/migration/rewrite-mvp-plan.md` first. It is the only current scope
and orchestration reference; older files under `docs/migration/` are history.

- Drogon is a from-zero repository: Rust core, `drogond` daemon and
  `drogon-cli`, plus an Electron/React desktop. Do not depend on Orca's runtime
  to execute anything.
- `/Users/carlos/Documents/Drogon-mentu-session` is a read-only reference
  (Orca 1.4.197 plus the Drogon fork). Never run builds or tests with it as cwd
  and never edit it. Copying MIT code from it is allowed: keep the notice
  `MIT Copyright (c) 2026 Lovecast Inc.` in each ported file and list source
  paths in your PR; the coordinator updates `THIRD_PARTY_NOTICES.md`.
- Work only in your assigned worktree and the paths your Task names. Deliver by
  PR against `main` in `clioo/drogon`; never push to `main`. The PR
  description is your report: no new documents, inventories or plans.
- Coordinator-owned files unless your Task grants them: `package.json`,
  `pnpm-lock.yaml`, `Cargo.toml`, `Cargo.lock`, `crates/drogon-protocol/**`,
  `crates/drogon-core/src/lib.rs`, `apps/desktop/src/preload/**`,
  `apps/desktop/src/shared/**`, `apps/desktop/src/renderer/src/App.tsx`,
  `AGENTS.md`, `THIRD_PARTY_NOTICES.md`, the plan.
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
- Fidelity is exact: the experience and UI must match orca-drogon. Port
  components from the read-only reference SOURCE as literally as possible
  (structure, Tailwind classes and tokens, copy, icons, keyboard, ARIA) and
  adapt only the data layer; the source code is the source of truth and the
  running orca-drogon instance only confirms the render. Validate rendered UI
  with Playwright over CDP, not computer-use. Use domain-specific filenames and
  concise comments only where the code is non-obvious.
- Use `apply_patch` for edits when your harness offers it. Never commit
  secrets or raw provider transcripts.
- Workers with a live Orca dispatch preamble send `worker_done` exactly once
  after the PR exists; if the send fails, the PR is still the deliverable.

## Keep agent validation out of the foreground

- All agents and subagents must preserve the developer's OS focus, including
  during ad hoc Playwright/CDP checks. Launch a dedicated test instance with
  `DROGON_BACKGROUND_WINDOW=1` and separate temporary `DROGON_DATA_DIR` and
  `DROGON_ELECTRON_PROFILE` directories. Reuse existing Drogon launchers; do
  not drive the developer's working instance for interactive tests.
- Never call `page.bringToFront()`, CDP `Page.bringToFront`, `app.focus()`,
  `BrowserWindow.focus()`, or OS activation commands to make a check pass.
  Use `showInactive()` when revealing a test window. Background mode may
  display an inactive window; do not claim it is headless or invisible.
- Tests specifically exercising native foreground focus require an explicit
  user request and a documented reason. Never disable background mode as a
  generic retry or workaround for a failing test.

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
