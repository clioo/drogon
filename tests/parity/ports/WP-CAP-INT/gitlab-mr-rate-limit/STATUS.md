# WP-CAP-INT / gitlab-mr-rate-limit — status

- Original: `src/main/gitlab/client-mr-auth-rate-limit.test.ts`
  (sha256 `809df2df8e5a0d0621a1216005ad15993d252d1018cbbbbf764fa4232278b343`,
  5 cases, pinned `c97906287bb7a390b25e2025b600d9fb3c25d9c3`).
- Port: byte-identical copy at the mirrored path in this directory; sha256
  verified equal to the pinned blob at record time and re-verified by
  `pending-register/int-pending.contract.test.ts` on each run. Original
  relative import specifiers preserved. `../git/runner` and `./gl-utils` are
  statically mocked with `vi.mock` (the latter via `vi.importActual` partial
  mock); the candidate under test (`./client`) and its sibling fixture
  `./client-mr-test-harness` are imported directly and are **not** part of
  this frozen port (only the test file itself is frozen).
- Binding: **blocked** — neither `apps/desktop/src/main/gitlab/client` nor
  `apps/desktop/src/main/gitlab/client-mr-test-harness` exists in the
  rewrite (verified by repo search 2026-09-07); binding this suite requires
  both.
- Attempted run (repo runner, this worktree, pinned Node24 vitest 5.0.0):

  ```sh
  node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-INT/gitlab-mr-rate-limit src/main/gitlab/client-mr-auth-rate-limit.test.ts
  ```

  Result: **FAIL at collection, 0 tests run** — `Cannot find module
  '/src/main/gitlab/client'`. Recorded as **test preparation (blocked
  binding), not behavioral RED, not a skip, and not a pass**.

- What the 5 cases pin once bound: `diagnoseAuth` reports the active `glab`
  host from auth status and merges many authenticated hosts with exactly one
  known-host cache scan (not one scan per host); `getRateLimit` parses
  GitLab REST rate-limit headers into a typed snapshot, reports a `null`
  bucket when a host omits those headers, and bounds the cached snapshot
  count at 64 across many distinct hosts (LRU-style eviction, not unbounded
  growth). No real GitLab host, credential, or network call is touched.
