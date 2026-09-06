# Original Bot ownership baseline

**11/11 passing, no failed, skipped or todo cases**, one original test file.
Source revision: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.
Runtime: Node24.19.0, original installed Vitest4.1.11, macOS arm64.
This is an isolated original unit baseline, not rewrite parity or real Bot
execution. The12 pinned files and MIT license were staged unchanged and
verified against both working-tree bytes and original Git blobs.

Manifest: `tests/parity/baseline-capsules/bot-responsibility-owner.json`.
Approved manifest digest:
`801d9b00b65aaa0ce8ddfb6603f26c1c0b9d3866c42c7f780f15d73caf176580`.
Runner: `scripts/run-parity-baseline-capsule.mjs`, execute mode,30s outer
timeout, explicit Node/Vitest paths recorded in stdout.json. Environment
cleared before launch; only PATH (Node24 and system binaries), LANG and CI
were supplied. No credentials or HOME passed, dependencies not installed.

Retained fresh stage:
`.preflight/parity-baseline/coordinator-bot-owner-UYe7Am/`.
Tests: `src/main/bots/bot-responsibility-owner.test.ts:55-323`.
Independent AST inspection confirms11 direct cases and18 runtime import
declarations across the12 staged files. Relative runtime imports close within
that set; external imports are vitest and node:crypto. Type-only dependency
chains are intentionally not staged; this is not a typecheck.

## What passed and what did not run

Assertions cover ownership repair/drop, joined history, in-memory mutation and
session rotation, scheduled responsibility creation, linked scheduler history,
reactive manual-run rejection, current identity/memory hydration and idempotent
history recording with rejection of an invented automation run.

The original test supplies an in-memory state object, flush spy and Store/
scheduler doubles. It does not demonstrate durable disk writes, real scheduling,
event monitoring, harness delegation, UI or process/host recovery. No original
assertion was altered or skipped. Minimal config differences from the source
suite are declared in the manifest and stdout.json, not hidden as equivalence.

## Archived receipts

The archive preserves parsed JSON values, adding a final newline; it is not
byte-identical to the retained raw files. stdout.json is the formatted observed
runner report. Raw results contain11 assertionResults, all passed.

| File | Raw SHA-256 | Archive SHA-256 |
| --- | --- | --- |
| stage-receipt.json | `a1d239f5bb7a1528c85971283b1829c5e147c4a210504e4fc62cb149fa433408` | `77cdcdbf33e90c482c92eff2cdf08523094d28f7ea34b97cb9cd7e3ca49ddd1e` |
| vitest-results.json | `97559a90d84e78bb5823e31c6142d8ae9286c5ea44ed7ea32c9436a1454b762d` | `6d281c04b5db0f8242d124009c64b5156ebd72b90b31a9f3b9b2aff90ffa0171` |

The distinct original baseline now totals93 cases across7 capsules; prior6
receipts and raw test results were rechecked, not re-executed. No full-suite,
candidate, UI, platform, real scheduler or Pi/Spark acceptance is implied.
