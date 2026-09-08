# Desktop test sharding on CI (R16-BL)

The Foundation workflow runs `pnpm --filter @drogon/desktop test` in 8 shards
(`vitest run --shard=$i/8`), each a separate vitest process, instead of one
process for the whole suite.

Why: with the default `isolate: true`, vitest 5's forks pool spawns a fresh
worker process per test file and SIGTERMs the old one — ~335 child processes
and ~335 SIGTERMs per suite run. Since 2026-09-08 (~11:49Z) the ubuntu-22.04
hosted runners kill the entire step tree with an external SIGTERM once a
single vitest process has recycled roughly 50 workers (clioo/drogon#312:
`Command failed with signal "SIGTERM"` after the same ~49 passing files on
every main push and PR, while macos-14, windows and dev machines were
unaffected). strace in a debug run (PR #320) showed the sender sits outside
the vitest process tree; the trigger tracks the worker-recycle count, not
time, output volume, worker count, or a specific test file. Eight shards cap
each process at ~43 recycles, under the observed threshold, while running
every file with unchanged isolation semantics.

Consequences:

- All 339 files / 2670 tests still run; a shard failing fails the step.
- The step costs ~8 extra vitest startups (~1.5 min on CI).
- Locally nothing changes: `pnpm --filter @drogon/desktop test` still runs
  the whole suite in one process.
