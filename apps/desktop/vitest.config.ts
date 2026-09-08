import { defineConfig } from "vitest/config";

// R16-BL (clioo/drogon#312): with the default `isolate: true` the forks pool
// spawns a fresh worker process per test file and SIGTERMs it afterwards —
// ~335 short-lived forks and ~335 child SIGTERMs per suite run. Since main
// b1beaa6, ubuntu-22.04 hosted runners deterministically kill the whole step
// tree with an external SIGTERM after ~50 of those worker-recycle cycles
// (strace shows the sender is outside the vitest process tree; macos-14,
// windows and dev machines are unaffected). Reusing one worker per
// environment removes the churn entirely (a handful of long-lived forks) and
// runs the suite ~2.5x faster. Set DROGON_VITEST_ISOLATE=1 to restore
// per-file process isolation while hunting a cross-file pollution bug.
const isolate = process.env.DROGON_VITEST_ISOLATE === "1";

export default defineConfig({
  test: {
    isolate,
  },
});
