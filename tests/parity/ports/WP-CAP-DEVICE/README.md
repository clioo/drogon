# WP-CAP-DEVICE — Voice/speech, emulator, computer-use contract preservation ports (V4-B2)

Source pin: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`
(`/Users/carlos/Documents/Drogon-mentu-session`, read-only; every read used
`git -C <reference> show <pin>:<path>` from this worktree's cwd, never the
reference as cwd). Lovecast Inc. MIT provenance: `tests/parity/ports/LICENSE.orca`.

This package preserves the *descriptive* contracts of the device surface
(voice/speech, Android/iOS emulator, computer-use) and pins the
historically-pending obligations so they can neither pass silently nor
disappear. It follows the admitted WP-CAP-MENTU / WP-CAP-MEET port pattern
from checkpoint-001. It is **not** a completed port, an implementation, or an
acceptance claim.

## Layout

| Path | Contents | Binding status |
| --- | --- | --- |
| `source-baselines/manifest.json` | all 62 canonical test files (`parity-test-work-packages.json` WP-CAP-DEVICE) with sha256; every hash cross-checked against the package manifest; revision proof; frozen-copy cross-check | recorded evidence |
| `computer-verification/` | byte-identical `src/main/computer/computer-action-verification-normalization.test.ts` (1 case) | blocked binding |
| `android-input/` | byte-identical `src/main/emulator/android/android-input-mapping.test.ts` (8 cases) | blocked binding |
| `audio-chunker/` | byte-identical `src/main/speech/stt-offline-audio-chunker.test.ts` (7 cases; pure offline chunking, no microphone) | blocked binding |
| `speech-deletion/` | byte-identical `src/main/speech/speech-model-deletion.test.ts` (4 cases) | blocked binding |
| `model-config/` | byte-identical `src/main/speech/stt-worker-model-config.test.ts` (5 cases) | blocked binding |
| `pending-register/device-pending.contract.test.ts` | runnable register of historically-pending items (`it.todo`, never `pass`) + frozen-copy hash self-check | runs GREEN as a register |

## Scope and duplication notes

- The canonical WP-CAP-DEVICE inventory is voice/speech + emulator +
  computer-use; it contains **no native-chat engine files** (those are
  WP-ENG-NCHAT, a separate V4 package not assigned to this port).
- `src/main/speech/model-catalog.test.ts` is canonically WP-CAP-DEVICE but was
  already frozen under `tests/parity/ports/WP-CAP-MEET/speech-catalog/` per the
  prior task grouping. It is recorded in this package's manifest (hash) but
  deliberately **not re-frozen** to avoid duplication; that port keeps its own
  STATUS and provenance.
- No microphone, recording, real account, credential, emulator, device binary
  (adb/scrcpy/simctl), sidecar, macOS permission prompt, or cloud call was
  accessed. No model file was downloaded or verified.

## Rules this package follows

- Frozen files are byte-identical to the pinned blobs (sha256 verified at record
  time against both the reference blob and the package manifest; re-verified by
  the pending-register self-check on every run). Original relative import
  specifiers are preserved so each file runs unmodified once a real candidate
  module tree exists at those paths.
- A collection-time import failure is **test preparation, not behavioral RED**.
  No device candidate modules exist in the rewrite; missing modules are
  reported as blocked bindings, never as passing, skipped, or failing product
  behavior.
- See `docs/migration/parity-speech-catalog.md` for the speech registry census
  (12 built-in models; owner WP-CAP-DEVICE) and its non-waived remaining proof.

## Runner

From the worktree root (Node 24 at
`/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`
is the repo-pinned runtime if needed):

```sh
node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-DEVICE/pending-register
node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-DEVICE/audio-chunker src/main/speech/stt-offline-audio-chunker.test.ts
# (computer-verification / android-input / speech-deletion / model-config analogous)
```

Exact commands, counts and outcomes are recorded in each suite's `STATUS.md`.
