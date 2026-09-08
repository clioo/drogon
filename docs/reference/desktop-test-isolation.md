# Desktop test worker reuse on CI (R16-BL)

`apps/desktop/vitest.config.ts` sets `test.isolate: false` (opt back in with
`DROGON_VITEST_ISOLATE=1`).

Vitest 5's default `isolate: true` spawns a fresh forks-pool worker per test
file and SIGTERMs the old one: ~335 child processes and ~335 SIGTERMs per
suite run. Since 2026-09-08 (~11:49Z) the ubuntu-22.04 hosted runners kill
the entire step tree with an external SIGTERM once a single vitest process
has recycled roughly 50 workers (clioo/drogon#312 — the Foundation job
failed on every main push and PR with `Command failed with signal
"SIGTERM"` after the same ~49 passing files, while macos-14, windows and dev
machines were unaffected). strace in a debug run (PR #320) showed the sender
sits outside the vitest process tree; systemd-oomd/earlyoom are absent,
memory is 14 GB free, and the trigger tracks the worker-recycle count, not
time, output volume, worker count, or a specific test file. Because the
sender is not part of the job, this cannot be fixed in-repo — worker reuse
removes the churn and is the only configuration observed green on ubuntu
since the regression began (Foundation runs 34243171831 and 34244706496).

Consequences of worker reuse:

- All 339 files / 2670 tests still run; the suite is ~2.5x faster
  (19.7s → 7.6s locally).
- Test files sharing a worker must not rely on `vi.mock` fully replacing a
  module that another file also mocks or imports (mock registries can bleed
  across files in one worker; observed as a flaky "`Tooltip` must be used
  within `TooltipProvider`" in `worktree-card-rows.test.tsx` and stale state
  in `AgentStateIcon.test.tsx`). Prefer rendering with the real component
  plus explicit providers over broad `vi.mock` factories for UI kit modules.
- If you need per-file process isolation while debugging a suspicion of
  cross-file pollution, run:

```sh
DROGON_VITEST_ISOLATE=1 pnpm --filter @drogon/desktop test
```
