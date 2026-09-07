# WP-CAP-INT / linear-teams — status

- Original: `src/main/linear/teams.test.ts`
  (sha256 `cd5528c5f72ee4d20573618d9f275c969ed2f9fa75469fbe0942b7f2f34be54f`,
  8 cases, pinned `c97906287bb7a390b25e2025b600d9fb3c25d9c3`).
- Port: byte-identical copy at the mirrored path in this directory; sha256
  verified equal to the pinned blob at record time and re-verified by
  `pending-register/int-pending.contract.test.ts` on each run. Original
  relative import specifiers preserved (`./client`,
  `../../shared/integration-credential-errors`, `./linear-request-concurrency`,
  `./linear-token-store`).
- Binding: **blocked** — none of `apps/desktop/src/main/linear/{client,
  linear-request-concurrency,linear-token-store}` nor
  `apps/desktop/src/shared/integration-credential-errors` exists in the
  rewrite (verified by repo search 2026-09-07). Note: the rewrite has
  type-only extractions `apps/desktop/src/shared/persistence-contracts/
  linear-project-types.ts` and `linear-workspace-types.ts`, which carry no
  runtime behavior and are not imported by this test.
- Attempted run (repo runner, this worktree, pinned Node24 vitest 5.0.0):

  ```sh
  node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-INT/linear-teams src/main/linear/teams.test.ts
  ```

  Result: **FAIL at collection, 0 tests run** — `Cannot find module
  '../../shared/integration-credential-errors'`. Recorded as **test
  preparation (blocked binding), not behavioral RED, not a skip, and not a
  pass**.

- What the 8 cases pin once bound: paginated team/label/member/state
  fetching against a mocked Linear GraphQL client, including the
  early-permit-release correction (the four-permit concurrency limiter is
  released as soon as a page's network round-trip completes, not held for
  the full multi-page walk), auth-error propagation via `isAuthError` /
  `clearToken`, and credential-decryption-failure surfacing through
  `credentialDecryptionMessage`. No real Linear workspace, credential, or
  network call is touched.
