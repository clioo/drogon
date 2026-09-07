# WP-CAP-MEET — Meetings/speech/account-catalog contract preservation ports (V4-B)

Source pin: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`
(`/Users/carlos/Documents/Drogon-mentu-session`, read-only; every read used
`git -C <reference> show <pin>:<path>` from this worktree's cwd, never the
reference as cwd). Lovecast Inc. MIT provenance: `tests/parity/ports/LICENSE.orca`.

This package preserves the *descriptive* Meetings, speech-separation and
account-catalog contracts of the pinned source and pins the historically-pending
obligations so they can neither pass silently nor disappear. It is **not** a
completed port, an implementation, or an acceptance claim.

## Layout

| Path | Contents | Binding status |
| --- | --- | --- |
| `source-baselines/manifest.json` | 45 source files (Meetings transcripts/Q&A/availability + speech separation/runtime + speech model catalog + account catalogs) with sha256, revision proof, frozen-copy cross-check | recorded evidence |
| `page-runtime/` | byte-identical `src/renderer/src/components/meetings/meetings-page-runtime.test.ts` (2 cases; transcript mounting + ask-through-Drogon) | blocked binding **and** missing `happy-dom` environment |
| `speech-catalog/` | byte-identical `src/main/speech/model-catalog.test.ts` (5 cases) | blocked binding |
| `catalogs/` | byte-identical `accounts-search.test.ts` (3 cases) + `provider-account-scope.test.ts` (5 cases) | blocked binding |
| `pending-register/meet-pending.contract.test.ts` | runnable register of historically-pending items (`it.todo`, never `pass`) + frozen-copy hash self-check | runs GREEN as a register |

## Rules this package follows

- Frozen files are byte-identical to the pinned blobs (sha256 verified at record
  time; re-verified by the pending-register self-check on every run). Original
  relative import specifiers are preserved so each file runs unmodified once a
  real candidate module tree exists at those paths.
- A collection-time import failure is **test preparation, not behavioral RED**.
  The `page-runtime` suite additionally declares `@vitest-environment happy-dom`,
  which is not installed in this worktree; that is a second, separate blocked
  dependency disclosed in its `STATUS.md`.
- No microphone, recording, real account, credential, network or cloud
  transcription access was used; the speech model catalog rows were recorded
  from source literals only (`docs/migration/parity-speech-catalog.md`).
- Implementation ownership note: account-catalog surfaces are recorded here per
  the task grouping; their implementation owners remain WP-CAP-INT /
  WP-CAP-DEVICE per the audit allocation. This port claims none of it.

## Runner

From the worktree root:

```sh
node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-MEET/pending-register
node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-MEET/speech-catalog src/main/speech/model-catalog.test.ts
# (page-runtime / catalogs analogous)
```

Exact commands, counts and outcomes are recorded in each suite's `STATUS.md`.
