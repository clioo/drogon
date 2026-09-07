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
- UI follows Orca's monochrome token system already in
  `apps/desktop/src/renderer/src/assets/main.css`; validate rendered UI with
  Playwright over CDP, not computer-use. Use domain-specific filenames and
  concise comments only where the code is non-obvious.
- Use `apply_patch` for edits when your harness offers it. Never commit
  secrets or raw provider transcripts.
- Workers with a live Orca dispatch preamble send `worker_done` exactly once
  after the PR exists; if the send fails, the PR is still the deliverable.
