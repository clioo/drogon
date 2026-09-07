# WP-CAP-MENTU / session-execution-suite — status

- Original: `src/main/mentu/mentu-session-execution.test.ts`
  (sha256 `c1ba4423275ca6f4293ede33217919c94a73de4f63b090a2bed46a68f000f80e`,
  pinned `c97906287bb7a390b25e2025b600d9fb3c25d9c3`).
- Port: byte-identical copy at `src/main/mentu/mentu-session-execution.test.ts`
  here; hash verified against the pinned blob at record time and re-verified by
  the pending-register self-check. 13 cases (one `it.each` over exit
  codes 1/null), original relative imports preserved.
- Binding: **blocked** — no
  `apps/desktop/src/main/mentu/mentu-session-execution` /
  `mentu-runtime` / `shared/mentu-session-approval` /
  `shared/child-process/run-process` candidates exist in the rewrite.
- Attempted run (repo runner, this worktree):

  ```sh
  node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-MENTU/session-execution-suite src/main/mentu/mentu-session-execution.test.ts
  ```

  Result: **FAIL at collection, 0 tests run** — cannot resolve
  `./mentu-runtime`. **Test preparation (blocked binding), not behavioral RED /
  skip / pass.**

- What the 13 cases pin once bound: legacy direct-run refusal (M-direct),
  blocking findings before approval (M-review-block), nested provider routing
  and child-input invalidation (M-nested), review coalescing/request keys
  (M-coalesce), review refresh after edit (M-refresh), failure precedence over
  stale nested evidence (M-old-evidence), missing-evidence handling
  (M-missing-evidence), recovery substitution refusal (M-recovery-vars),
  cancellation before further work (M-cancel-review), recovery
  review/execute/retry of the host-owned run (M-recovery), bounded
  child-process cancellation (M-cancel-process), folder ownership + remote loss
  `unverifiable` (M-owner), and host-owned terminal-evidence restore after
  restart (M-record-liveness).
