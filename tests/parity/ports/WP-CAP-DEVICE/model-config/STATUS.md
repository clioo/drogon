# WP-CAP-DEVICE / model-config — status

- Original: `src/main/speech/stt-worker-model-config.test.ts`
  (sha256 `6861529a69451e9394958077942e4ae5106723f54260d9406b97d28d75672cfc`,
  5 cases, pinned `c97906287bb7a390b25e2025b600d9fb3c25d9c3`).
- Port: byte-identical copy at the mirrored path in this directory; sha256
  verified equal to the pinned blob at record time and re-verified by
  `pending-register/device-pending.contract.test.ts` on each run. Original
  relative import specifiers preserved.
- Binding: **blocked** — `apps/desktop/src/main/speech/stt-worker-model-config`
  does not exist in the rewrite (verified by repo search 2026-09-07).
- Attempted run (repo runner, this worktree, pinned Node24 vitest 5.0.0):

  ```sh
  node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-DEVICE/model-config src/main/speech/stt-worker-model-config.test.ts
  ```

  Result: **FAIL at collection, 0 tests run** — `Cannot find module
  './stt-worker-model-config'`. Recorded as **test preparation (blocked
  binding), not behavioral RED, not a skip, and not a pass**.

- What the 5 cases pin once bound: `resolveFile` locates an
  encoder/decoder/joiner triple by role name, or a single fused
  `nemo-ctc`-style model file, and throws a `No *<role>*.onnx found`-style
  error when no file matches a requested role; `resolveTokens` locates
  `tokens.txt` regardless of surrounding files and throws when it is missing.
  Purely filename-matching logic — no model file is downloaded, opened, or
  loaded by these cases.
