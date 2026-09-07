# WP-CAP-INT / jira-mutations — status

- Original: `src/main/jira/jira-issue-mutations.test.ts`
  (sha256 `818d5a1f26a14d5123303cc688ccad3762a56c0770c96de39d6dc5bd90c7ecca`,
  6 cases, pinned `c97906287bb7a390b25e2025b600d9fb3c25d9c3`).
- Port: byte-identical copy at the mirrored path in this directory; sha256
  verified equal to the pinned blob at record time and re-verified by
  `pending-register/int-pending.contract.test.ts` on each run. Original
  relative import specifiers preserved. The candidate under test
  (`./issues`) is loaded via a dynamic `await import('./issues')` inside each
  test body rather than a static top-level import; `./authenticated-request`,
  `./request-queue` and `./client` are statically mocked with `vi.mock`.
- Binding: **blocked** — `apps/desktop/src/main/jira/issues` does not exist
  in the rewrite (verified by repo search 2026-09-07).
- Attempted run (repo runner, this worktree, pinned Node24 vitest 5.0.0):

  ```sh
  node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-INT/jira-mutations src/main/jira/jira-issue-mutations.test.ts
  ```

  Result: **6 tests collected, 6 failed at runtime** — each test's dynamic
  `await import('./issues')` throws `Cannot find module
  '/src/main/jira/issues'`. Because the missing import is dynamic rather
  than static, vitest reports per-test failures instead of a single
  collection-time failure; the root cause is identical (no candidate module
  exists) and this is recorded as **test preparation (blocked binding), not
  behavioral RED, not a skip, and not a pass** — the distinction is the
  reporting shape, not the verdict.

- What the 6 cases pin once bound: Jira issue creation/update send
  plain-text (v2, ADF-free) bodies against the corrected v2 REST path for
  self-hosted (server-auth) sites; user-typed assignee/reporter fields are
  shaped into Jira `accountId`-keyed user objects on cloud sites and into
  bare `name`-keyed objects on self-hosted sites; fields with no declared
  user keys pass through untouched; and both unassign and assign-by-username
  operate correctly on self-hosted sites. No real Jira site, credential, or
  network call is touched.
