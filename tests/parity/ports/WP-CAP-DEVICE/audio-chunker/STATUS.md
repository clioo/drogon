# WP-CAP-DEVICE / audio-chunker — status

- Original: `src/main/speech/stt-offline-audio-chunker.test.ts`
  (sha256 `c0eda15494dba60a2126ab50b50f5ee7853d8ad787b2e526ad501f8d9d61de42`,
  7 cases, pinned `c97906287bb7a390b25e2025b600d9fb3c25d9c3`).
- Port: byte-identical copy at the mirrored path in this directory; sha256
  verified equal to the pinned blob at record time and re-verified by
  `pending-register/device-pending.contract.test.ts` on each run. Original
  relative import specifiers preserved.
- Binding: **blocked** — `apps/desktop/src/main/speech/stt-offline-audio-chunker`
  does not exist in the rewrite (verified by repo search 2026-09-07).
- Attempted run (repo runner, this worktree, pinned Node24 vitest 5.0.0):

  ```sh
  node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-DEVICE/audio-chunker src/main/speech/stt-offline-audio-chunker.test.ts
  ```

  Result: **FAIL at collection, 0 tests run** — `Cannot find module
  './stt-offline-audio-chunker'`. Recorded as **test preparation (blocked
  binding), not behavioral RED, not a skip, and not a pass**.

- What the 7 cases pin once bound: below-limit audio is buffered without
  emitting; the chunk limit (`OFFLINE_DECODE_CHUNK_SECONDS` * sample rate) is
  never exceeded across a single oversized push, many small pushes, or a
  multi-chunk oversized push; a chunk boundary prefers a silent pause inside
  its search window over a mid-speech cut; sample values are conserved
  byte-for-byte across a split; and `flush()` returns `null` when nothing is
  buffered. All cases operate on synthetic `Float32Array` signals — no
  microphone or real audio device was accessed.
