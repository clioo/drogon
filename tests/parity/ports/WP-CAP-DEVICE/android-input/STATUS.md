# WP-CAP-DEVICE / android-input — status

- Original: `src/main/emulator/android/android-input-mapping.test.ts`
  (sha256 `ca913619e2f37e15689a8d72ead03a5b1366fe65d788937f65d815ee938dd7ea`,
  8 cases, pinned `c97906287bb7a390b25e2025b600d9fb3c25d9c3`).
- Port: byte-identical copy at the mirrored path in this directory; sha256
  verified equal to the pinned blob at record time and re-verified by
  `pending-register/device-pending.contract.test.ts` on each run. Original
  relative import specifiers preserved.
- Binding: **blocked** — neither
  `apps/desktop/src/main/emulator/android/android-input-mapping` nor
  `apps/desktop/src/main/emulator/emulator-errors` exists in the rewrite
  (verified by repo search 2026-09-07).
- Attempted run (repo runner, this worktree, pinned Node24 vitest 5.0.0):

  ```sh
  node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-DEVICE/android-input src/main/emulator/android/android-input-mapping.test.ts
  ```

  Result: **FAIL at collection, 0 tests run** — `Cannot find module
  '../emulator-errors'`. Recorded as **test preparation (blocked binding),
  not behavioral RED, not a skip, and not a pass**.

- What the 8 cases pin once bound: pure normalized-coordinate → device-pixel
  mapping for a Pixel-7-sized screen (center, corners, negative/over-1
  clamping, nearest-pixel rounding) and the android hardware-button name →
  keycode table (home/back/recents/app_switch/recent/overview → 3/4/187,
  power/lock → 26, volume_up/volup → 24, volume_down/voldown → 25), plus
  `EmulatorError` with code `emulator_error` for an unrecognized button name.
  No adb/scrcpy device or emulator process is touched by these cases.
