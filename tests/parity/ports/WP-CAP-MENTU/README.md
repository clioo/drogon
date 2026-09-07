# WP-CAP-MENTU — Mentu contract preservation ports (V4-B)

Source pin: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`
(`/Users/carlos/Documents/Drogon-mentu-session`, read-only; every read used
`git -C <reference> show <pin>:<path>` from this worktree's cwd, never the
reference as cwd). Lovecast Inc. MIT provenance: `tests/parity/ports/LICENSE.orca`.

This package preserves the *descriptive* Mentu contracts of the pinned source and
pins the historically-pending obligations so they can neither pass silently nor
disappear. It is **not** a completed port, an implementation, or an acceptance
claim.

## Layout

| Path | Contents | Binding status |
| --- | --- | --- |
| `source-baselines/manifest.json` | 66 source files (workbench/review/execute/evidence/retry/quarantine + skills/provider catalogs) with sha256, revision proof, frozen-copy cross-check | recorded evidence |
| `recipe-contract/` | byte-identical `src/shared/mentu-recipe-contract.test.ts` (7 cases) | blocked binding (candidate `./mentu-recipe-contract` absent) |
| `runtime-suite/` | byte-identical `src/main/mentu/mentu-runtime.test.ts` (12 cases; capability/discovery/save/evidence/quarantine/argv/WSL) | blocked binding |
| `session-execution-suite/` | byte-identical `src/main/mentu/mentu-session-execution.test.ts` (13 cases; admission/review/execute/cancel/recovery) | blocked binding |
| `catalogs/` | byte-identical `src/shared/agent-skill-sharing-contract.test.ts` (2 cases) | blocked binding |
| `pending-register/mentu-pending.contract.test.ts` | runnable register of historically-pending items (`it.todo`, never `pass`) + frozen-copy hash self-check | runs GREEN as a register |

## Rules this package follows

- Frozen files are byte-identical to the pinned blobs (sha256 verified at record
  time; re-verified by the pending-register self-check on every run). Original
  relative import specifiers are preserved so each file runs unmodified once a
  real candidate module tree exists at those paths.
- A collection-time import failure is **test preparation, not behavioral RED**.
  Missing candidate modules are reported as blocked bindings, never as passing,
  skipped, or failing product behavior.
- `pending-register/` marks every historically-pending item as an explicit
  `it.todo` (vitest reports these as `todo`, a distinct outcome from `pass`):
  reactive/proactive responsibility execution, recipe-81/90, shared-spaces,
  Commitment Protocol overreach, synthesized run-evidence liveness, legacy
  bypass refusal vs. darwin-arm64-only admitted execution, partial recovery
  digest, busy-text/TOCTOU admission, and guarded-save durability.
- No mock, fixture, or adapter fabricates missing product behavior. Nothing here
  claims review/execute/evidence parity; the E3 follow-up acceptance items
  (BM-AUTH … BM-EVIDENCE in `docs/migration/audit-closure/e3-bridge/followup-bots-mentu.md`)
  remain the open obligations.

## Runner

From the worktree root (Node 24 at
`/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`
is the repo-pinned runtime if needed):

```sh
node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-MENTU/pending-register
node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-MENTU/recipe-contract src/shared/mentu-recipe-contract.test.ts
# (runtime-suite / session-execution-suite / catalogs analogous)
```

Exact commands, counts and outcomes are recorded in each suite's `STATUS.md`.
