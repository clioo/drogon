# Renderer shutdown-checkpoint migration — leaf implementation report

2026-09-06 (rev. 2, root-review corrections applied). Sole OpenCode GLM leaf,
no delegation. Task `task_e205a588e3e9` delivery corrected under
`task_e9fef7c6ca57`; review gate obeyed:
`docs/migration/renderer-checkpoint-dependency-contract.md` ("Review gate:
test adapters are not product failures"). Source baseline pin: read-only
`/Users/carlos/Documents/Drogon-mentu-session` at
`c97906287bb7a390b25e2025b600d9fb3c25d9c3` (never used as a test cwd).

## Scope

Exclusive paths (confirmed absent before first write; no overlap):

- `apps/desktop/src/renderer/src/app-shell/shutdown-checkpoint-persist.ts`
  (SHA256 `3fc677478c98191551fe57796feedd3e77bec8bfd3252ebd3ea94757788fc911`,
  unchanged by this correction)
- `apps/desktop/src/renderer/src/lib/shutdown-checkpoint-guard.ts`
  (SHA256 `8ed519a27267ed96633ef8bc65110f8bc8bd8ea795f22509b93a2b90c680b17d`,
  unchanged by this correction)
- `tests/parity/ports/WP-UI-PRELOAD/shutdown-checkpoint/**`

Ported pinned originals (SHA256 verified):
`…/shutdown-checkpoint-persist.ts` `4516edf3…`,
`…/shutdown-checkpoint-guard.ts` `12731c56…`.

Contract: root decision + dependency-contract gate — generic `TSnapshot` /
`TUi extends object` pass-through; required injected best-effort breadcrumb
sink on both entry points with exact source breadcrumb names/data
(`renderer_shutdown_sleeping_capture_failed`, `renderer_shutdown_checkpoint_failed`,
each `{ message }`), sink failures wrapped so they never mask the checkpoint
verdict; console + failure-reason DOM behavior unchanged; no
window.api/structural-substitute declarations in product code. Rust remains
the durable execution owner.

## RED classification correction (per review gate)

The retained run `6 failed | 23 passed (29)` is reclassified: those were
candidate-harness SIGNATURE/ADAPTER failures — unbound required breadcrumb
sinks and the abandon argument bound into the sink position (with its
retry-state consequences) — caused by the approved dependency change. They are
NOT behavioral RED and are not evidence of wrong checkpoint policy in a
correctly bound production module; they are retained as adapter-failure
evidence only. Historical behavioral RED is therefore UNAVAILABLE for this
delivery: no correctly bound, unchanged regression suite has yet demonstrated
a real checkpoint-policy defect in the candidate modules. None was manufactured
and assertions were not weakened to fill that evidence field. A future RED
claim requires a real policy failure demonstrated before its production fix.

## Source baselines (capsules; byte/provenance + executed cases)

Staged/executed with the existing candidate capsule runner
`scripts/run-parity-baseline-capsule.mjs` (pinned-byte manifests, stage
receipts under `.preflight/parity-baseline`) with Node24
`/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`.

Tooling limitation (documented, honest wording): the assignment's "installed
candidate tooling" phrasing is NOT fully met for the source baselines — the
runner's renderer runtime staging (react/react-dom/happy-dom from the pinned
source `node_modules`) and the suites' original Vitest-4.1.11 semantics require
the SOURCE-PINNED runtime; the five source suites were executed with
`--vitest-entry /Users/carlos/Documents/Drogon-mentu-session/node_modules/vitest/vitest.mjs`
(4.1.11). The candidate suites themselves run on the installed candidate
tooling (Node24 + candidate Vitest 5.0.0). No installs or manifest alterations
were made.

| Capsule | Approved manifest SHA256 | Tests | Result |
| --- | --- | --- | --- |
| shutdown-checkpoint-persist | `c97a62f4ac0e90ba9b300b89156e8d7f669ed880574f80fdbc5fe3b583d57a53` | 12/12 | success |
| shutdown-checkpoint-guard | `b90f97a5686c3ad03ec651c036d449012c416cae96eb8dc5499b1ce06cf22483` | 15/15 (incl. both caller-wiring pins against staged caller bytes) | success |
| shutdown-checkpoint-restart-lifecycle | `7f663ecf6639cafda8e054b5e656210e6eff06749bfd52686e322d8083664c04` | 4/4 | success |
| main-ipc-renderer-shutdown-checkpoint | `5f1196246c1cfbebfa24c3ce7caf7e84556de7f351412ea5321369d91dbde19d` | 8/8 | success |
| preload-app-restart-checkpoint-routing | `b94dcd7c017adc8ccc3b50007af09a8c69c6874e9db7a4d7c83b8368b1d58541` | 6/6 | success (pinned transport runtime supplies zod; first attempt without it failed 6/6 `Cannot find package 'zod'`, retained) |

Manifest coverage: root verified 149 manifest source/license entries across
135 unique paths — that proves bytes/provenance only, not execution or full
dependency closure, and is not claimed as closure. The main/ipc and preload
routing suites (6 + 8 = 14 source cases) are separate source baselines and
root implementation-map items only; they are not renderer candidate coverage
and no fake main handler exists.

## Candidate suite reconciliation (post-correction run)

Command: `node apps/desktop/node_modules/vitest/vitest.mjs run
tests/parity/ports/WP-UI-PRELOAD/shutdown-checkpoint/{shutdown-checkpoint-persist,shutdown-checkpoint-guard,shutdown-checkpoint-restart-lifecycle}.test.ts
--environment node --reporter dot` (Node24, cwd repo root) →
`Test Files 3 passed (3)`, `Tests 34 passed (34)`, exit 0.

31 original renderer cases reconciled by exact names/rows:

- persist — 12 executed (original bodies + exact source fixture values
  `{ state: { activeTabId: "t1" } }` / `{ activeView: "workspace" }`):
  1. does not fail the checkpoint when the sleeping-agent quit capture throws (STA-5505)
  2. keeps sleeping-capture diagnostics non-throwing for unstringifiable values
  3. keeps the first full-staging failure a visible, retryable error (STA-5505)
  4. degrades to durable-only staging when full staging fails again on retry (STA-5505)
  5. stages the full snapshot when a retry after a transient staging failure succeeds
  6. still fails the checkpoint when staging throws and dirty editor buffers exist
  7. still fails the checkpoint when staging throws outside a degradable shutdown
  8. fails the checkpoint when even durable-only staging throws
  9. keeps the durable-session fallback for snapshot build failures
  10. rethrows snapshot build failures when dirty editor buffers exist
  11. skips capture and stages empty sessions before hydration completes
  12. forgets a failed attempt when an aborted shutdown resets the lifecycle
- guard — 13 behavioral executed:
  1. dedupes the synthetic and native unload events in one close attempt
  2. allows a new checkpoint after an aborted restart resets the attempt
  3. retries when the blocking checkpoint throws
  4. publishes the failure cause and records a crash breadcrumb (STA-5505)
  5. clears a stale failure cause once a later checkpoint succeeds (STA-5505)
  6. keeps failure reporting non-throwing for unstringifiable thrown values
  7. uses a fallback reason when an Error has an empty message
  8. resets state owned by the persist attempt lifecycle
  9. preserves persist retry state when the checkpoint itself aborts the restart
  10. reports checkpoint failure separately from the unload verdict
  11. retries after a prevented reload resets the completed checkpoint
  12. cancels unload when persistence fails and remains retryable
  13. resets after a paired-web dirty-file veto regardless of listener order
- guard — 2 caller pins mapped/open (executed only in the pinned-source
  capsule; pinned caller files are out of leaf scope):
  - "runs the quit checkpoint inside the window-close scope and surfaces a vetoed quit (STA-5505/#15352)"
  - "wires dirty editor unload vetoes to the paired-web checkpoint reset"
- restart-lifecycle — 4 executed rows:
  1. preserves retry-then-degrade across a checkpoint-caused app restart abort
  2. preserves retry-then-degrade across a checkpoint-caused updater install abort
  3. abandons retry state when a later restart attempt is independently canceled
  4. names the snapshot-build cause when dirty drafts block the checkpoint

Executed original behavioral cases: 12 + 13 + 4 = 29. Guard caller pins: 2
mapped/open as above. Supplemental candidate cases (separate, labeled
`strengthening:`, never inside original case bodies): 5 — persist 4
(host-qualified staging identity; exact sleeping-capture breadcrumb name/data;
fallback reason for unstringifiable failures; throwing-sink robustness), guard
1 (throwing-sink robustness). 29 + 5 = 34 executed.

Signature-only adaptations (source-to-test mapping): injected `recordCrashBreadcrumb`
sink arguments at factory call sites; the guard breadcrumb assertion keeps the
ORIGINAL object envelope `recordBreadcrumb({ name, data })` via a
signature-only sink adapter — the original assertion body is unchanged.
Lifecycle's unmigrated `lib/updater-beforeunload.ts` is a provenance-marked
faithful test-local closure in the owned test tree (test closure only, not
migrated product behavior).

## Adapted-test typecheck (new gate)

Owned config `tests/parity/ports/WP-UI-PRELOAD/shutdown-checkpoint/tsconfig.json`
(extends `apps/desktop/tsconfig.json`; includes exactly the three adapted test
files — apps/desktop/tsconfig excludes them). Command: `node
apps/desktop/node_modules/typescript/bin/tsc -p
tests/parity/ports/WP-UI-PRELOAD/shutdown-checkpoint/tsconfig.json --noEmit`
→ exit 0. Product modules also re-verified: `tsc --noEmit -p
apps/desktop/tsconfig.json` → exit 0.

## Artifact hashes (post-correction)

- `5f831ca4a767a8a62d40fcf051dd1e64609878630d6dc9d3429ea066c1fbc977` shutdown-checkpoint-persist.test.ts
- `ca69b4defc5542f4b924c1613653174419c39d128b1742c255e6f03792d41050` shutdown-checkpoint-guard.test.ts
- `e76e4d1c4fe084a98862327dd7abc44598342af638e55dd94780b11ab79eb0d9` shutdown-checkpoint-restart-lifecycle.test.ts
- `17deccdb3c62645397efdd0998283164213ee04d980299692ae839a7bf0dd6d0` tsconfig.json (owned test-typecheck config)

This report is excluded from its own artifact-hash list: a final self-digest
cannot be embedded without changing the file, so any embedded self-hash would
be stale by construction.

## Integration limits (unchanged ownership)

- The two modules are unwired: no caller/main/preload/shared-type changes;
  root/caller integration must bind the full real domain types and a real
  recorder (a no-op sink is not accepted integration) and join real
  durability (20-second flush deadline semantics in the source main handler).
- `lib/updater-beforeunload.ts` remains unmigrated product code (test-local
  closure only).
- Behavioral RED is unavailable as classified above; GREEN here means the
  unchanged suite passes against the candidate modules, not proven-production
  parity. Real Electron acceptance, IPC admission, durable native
  staging/flush, caller integration and packaging remain root obligations.
