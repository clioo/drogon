# WP-CAP-DEVICE / speech-deletion — status

- Original: `src/main/speech/speech-model-deletion.test.ts`
  (sha256 `f836e6983413dda6078692e7acd95548c5bae57bee4f770aac906d8569039c72`,
  4 cases, pinned `c97906287bb7a390b25e2025b600d9fb3c25d9c3`).
- Port: byte-identical copy at the mirrored path in this directory; sha256
  verified equal to the pinned blob at record time and re-verified by
  `pending-register/device-pending.contract.test.ts` on each run. Original
  relative import specifiers preserved (`../../shared/constants`,
  `../../shared/speech-types`, `../../shared/global-settings-types`,
  `./model-catalog`, `./speech-model-deletion`).
- Binding: **blocked** — none of `apps/desktop/src/main/speech/{constants,
  speech-types,global-settings-types,model-catalog,speech-model-deletion}`
  exists in the rewrite (verified by repo search 2026-09-07). Note:
  `model-catalog.ts` (the runtime module, not its test) is not frozen by any
  WP-CAP-DEVICE or WP-CAP-MEET port; only `model-catalog.test.ts` is frozen
  under `WP-CAP-MEET/speech-catalog/`. Binding this suite requires both the
  deletion module and the catalog module.
- Attempted run (repo runner, this worktree, pinned Node24 vitest 5.0.0):

  ```sh
  node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-DEVICE/speech-deletion src/main/speech/speech-model-deletion.test.ts
  ```

  Result: **FAIL at collection, 0 tests run** — `Cannot find module
  '../../shared/constants'`. Recorded as **test preparation (blocked
  binding), not behavioral RED, not a skip, and not a pass**.

- What the 4 cases pin once bound: deleting the currently-selected local
  model prepares-then-deletes (in that order) and clears the stored
  `sttModel` selection; a concurrent client re-selecting a newer model during
  deletion is not clobbered (settings updated exactly once, with the newer
  selection); a deletion failure leaves settings untouched and rejects with
  the underlying error; and unknown or cloud-provider model IDs are rejected
  (`voice_model_unknown` / `voice_model_not_deletable`) before any prepare or
  delete call.
