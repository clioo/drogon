# Desktop test SIGTERM resilience on CI (R16-BL)

The Foundation workflow's `pnpm --filter @drogon/desktop test` step runs the
suite inside a small retry wrapper (up to 3 attempts) with a 15-minute step
timeout.

Why: with the default `isolate: true`, vitest 5's forks pool spawns a fresh
worker process per test file and SIGTERMs the old one — ~335 child processes
and ~335 SIGTERMs per suite run. Since 2026-09-08 (~11:49Z) the ubuntu-22.04
hosted runners kill the entire step tree with an external SIGTERM once a
single vitest process has recycled roughly 50 workers (clioo/drogon#312:
`Command failed with signal "SIGTERM"` after the same ~49 passing files on
every main push and PR, while macos-14, windows and dev machines were
unaffected). strace in a debug run (PR #320) showed the sender sits outside
the vitest process tree; systemd-oomd/earlyoom are absent, memory is 14 GB
free, and the trigger tracks the worker-recycle count, not time, output
volume, worker count, or a specific test file. Because the sender is not
part of the job, this cannot be fixed in-repo — debugging artifacts live in
PR #320's runs.

The resilience trick: the step's shell traps SIGTERM (survives it), so the
runner does not classify the step as canceled; the vitest tree keeps its
default disposition and dies like before; the wrapper then simply retries
the suite in a fresh process. The kill has not been observed twice within
one job, so attempt 2 completes cleanly on an affected runner. Test
semantics are exactly main's (forks pool, full per-file isolation) — no
worker reuse, no shards, no skips; all 339 files / 2670 tests run every
attempt. Alternatives measured and rejected: `isolate: false` avoids the
churn but leaks `vi.mock` module mocks across files sharing a worker
(~30% local failure rate); `--pool=threads` flakes; `--pool=vmThreads`
fails outright; sharding under the threshold still died.
