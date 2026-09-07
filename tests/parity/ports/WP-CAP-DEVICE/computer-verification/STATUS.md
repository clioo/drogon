# WP-CAP-DEVICE / computer-verification — status

- Original: `src/main/computer/computer-action-verification-normalization.test.ts`
  (sha256 `a6d534d37151777d419505f724a0fb3ad6d6d6ccccd3ce036759d8a913af1d37`,
  1 case, pinned `c97906287bb7a390b25e2025b600d9fb3c25d9c3`).
- Port: byte-identical copy at the mirrored path in this directory; sha256
  verified equal to the pinned blob at record time and re-verified by
  `pending-register/device-pending.contract.test.ts` on each run. Original
  relative import specifiers preserved.
- Binding: **blocked** — neither
  `apps/desktop/src/main/computer/computer-action-verification-normalization`
  nor `apps/desktop/src/main/computer/shared/runtime-types` exists in the
  rewrite (verified by repo search 2026-09-07).
- Attempted run (repo runner, this worktree, pinned Node24 vitest 5.0.0):

  ```sh
  node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-DEVICE/computer-verification src/main/computer/computer-action-verification-normalization.test.ts
  ```

  Result: **FAIL at collection, 0 tests run** — `Cannot find module
  './computer-action-verification-normalization'`. Recorded as **test
  preparation (blocked binding), not behavioral RED, not a skip, and not a
  pass**.

- What the 1 case pins once bound: an accessibility-path computer-use action
  without a post-state assertion is normalized to
  `{ state: 'unverified', reason: 'accessibility_action_unasserted' }` — an
  accessibility click is never reported as a verified outcome absent an
  explicit post-state check.
