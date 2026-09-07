# WP-CAP-INT / github-identity-key — status

- Original: `src/shared/github/repository-identity-key.test.ts`
  (sha256 `2a50bd0267389c62476ef85a52bd6a394dcc89ec7b2c8d2a21bbfe46dc66594b`,
  1 case, pinned `c97906287bb7a390b25e2025b600d9fb3c25d9c3`).
- Port: byte-identical copy at the mirrored path in this directory; sha256
  verified equal to the pinned blob at record time and re-verified by
  `pending-register/int-pending.contract.test.ts` on each run. Original
  relative import specifier preserved.
- Binding: **blocked** — `apps/desktop/src/shared/github/repository-identity-key`
  does not exist in the rewrite (verified by repo search 2026-09-07).
- Attempted run (repo runner, this worktree, pinned Node24 vitest 5.0.0):

  ```sh
  node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-INT/github-identity-key src/shared/github/repository-identity-key.test.ts
  ```

  Result: **FAIL at collection, 0 tests run** — `Cannot find module
  './repository-identity-key'`. Recorded as **test preparation (blocked
  binding), not behavioral RED, not a skip, and not a pass**.

- What the 1 case pins once bound: `isDefaultGitHubHost` normalizes case and
  harmless surrounding whitespace (`' GitHub.com '` → default host); pure
  `githubRepoIdentityKey` lower-cases owner/repo into `owner/repo` for the
  default host while preserving a non-default GHES host (with port) in the
  identity key without merging it into the default-host namespace. No real
  GitHub host, credential, or network call is touched.
