# WP-CAP-INT / bitbucket-status — status

- Original: `src/main/bitbucket/status-no-decrypt.test.ts`
  (sha256 `63937e170d202c5091c8a2d8391347ce72ea313efa6635a1130f1c519d0a8755`,
  3 cases, pinned `c97906287bb7a390b25e2025b600d9fb3c25d9c3`).
- Port: byte-identical copy at the mirrored path in this directory; sha256
  verified equal to the pinned blob at record time and re-verified by
  `pending-register/int-pending.contract.test.ts` on each run. Original
  relative import specifiers preserved. `../git/runner` is statically
  mocked; `../../shared/secret-store`, `./repository-ref`,
  `./credential-store`, `./client`, and `./credential-connection` are loaded
  via dynamic `import()` inside a shared `loadModules()` helper rather than
  static top-level imports.
- Binding: **blocked** — none of `apps/desktop/src/{shared/secret-store,
  main/bitbucket/{repository-ref,credential-store,client,
  credential-connection}}` exists in the rewrite (verified by repo search
  2026-09-07).
- Attempted run (repo runner, this worktree, pinned Node24 vitest 5.0.0):

  ```sh
  node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-INT/bitbucket-status src/main/bitbucket/status-no-decrypt.test.ts
  ```

  Result: **3 tests collected, 3 failed at runtime** — each test's
  `loadModules()` call throws `Cannot find module
  '/src/shared/secret-store'` from its dynamic `import()`. Because the
  missing import is dynamic rather than static, vitest reports per-test
  failures instead of a single collection-time failure; the root cause is
  identical (no candidate module exists) and this is recorded as **test
  preparation (blocked binding), not behavioral RED, not a skip, and not a
  pass** — the distinction is the reporting shape, not the verdict.

- What the 3 cases pin once bound: a relaunch with a cold in-memory
  credential cache renders connected status from plaintext stored metadata
  without decrypting the secret or making a network call; repeated status
  reads stay cold (zero decrypt calls) and the secret is decrypted exactly
  once only when a real API call (fetching a pull request) requires it; and
  a warm-cache status check that calls `/user` to revalidate still never
  decrypts the stored secret. No real Bitbucket account, keychain, or
  network endpoint is touched — `fetch` and the OS keychain path are
  fully stubbed.
