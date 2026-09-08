# Desktop test worker isolation (R16-BL)

`apps/desktop/vitest.config.ts` sets `test.isolate: false` (opt back in with
`DROGON_VITEST_ISOLATE=1`).

Vitest 5's default spawns a fresh forks-pool worker per test file and
SIGTERMs it afterwards: ~335 child processes and ~335 SIGTERMs per suite run.
Since 2026-09-08 the ubuntu-22.04 hosted runners kill the entire step with an
external SIGTERM after ~50 of those worker-recycle cycles
(clioo/drogon#312 — the Foundation job failed on every main push and PR with
`Command failed with signal "SIGTERM"` after the same 49 passing files, while
macos-14, windows and dev machines were unaffected). Reusing one worker per
environment removes the process churn and runs the suite ~2.5x faster
(19.7s → 7.6s on a 2024 MacBook Pro).

Consequence: test files share one worker per environment, so they must not
depend on or mutate worker-global state (module registry and jsdom globals
are still reset by vitest between files; `testing-library` auto-cleanup still
runs per test). If you need per-file process isolation while debugging a
suspicion of cross-file pollution, run:

```sh
DROGON_VITEST_ISOLATE=1 pnpm --filter @drogon/desktop test
```
