# Persisted renderer contracts — Sol-UI handoff

Date: 2026-09-06. Status: scoped type/policy migration accepted for root review;
the full persistence feature is **not** globally green.

## Outcome

The delegated GLM leaf created the complete persisted renderer type surface in
`apps/desktop/src/shared/persistence-contracts/` (38 TypeScript files including
the host-qualified checkpoint envelope), ported the real
`apps/desktop/src/renderer/src/lib/updater-beforeunload.ts`, added its four
source tests and compile fixtures, and replaced the restart-lifecycle test's
inline updater copy with the real module import. The candidate preserves the
full `WorkspaceSessionState` (33 fields), `PersistedUIState` (115 fields),
`PersistedOpenFile` (11 fields), host-qualified snapshots, folder/local/SSH/runtime
identity, dirty editor content/signatures, terminal authority and resume state,
browser ownership/deferred closes, UI navigation and Mentu state; it does not
substitute the thin process `Session` or generic JSON.

Root's normalized declaration-AST review found 119/120 exact bodies in the
first delivery. The same leaf then restored the two omitted fields in the
remaining `SleepingAgentSessionRecord` body:
`automaticResumeBlockedBy?: 'legacy-orchestration-worker'` and
`restoreOnTabOpenOnly?: boolean`, with exact pinned comments/order, a populated
positive fixture, and an invalid-discriminator negative fixture. Focused lead
review compared that repaired declaration directly to the pin, confirmed the
checkpoint envelope now directly instantiates the accepted exported
`ShutdownCheckpointPersistDeps` generic, and recomputed all 47 hashes listed
by the leaf with 47/47 matches.

The exact source-to-candidate declaration/field map, source hashes and closure
boundaries are in
`tests/parity/ports/WP-UI-PRELOAD/persisted-renderer-contracts/declaration-mapping.md`.
The full 47-entry candidate/source hash manifest and leaf evidence are in
`tests/parity/ports/WP-UI-PRELOAD/persisted-renderer-contracts/leaf-implementation.md`.
Lead-computed hashes omitted from that self-referential manifest are:

- `4124c8bae5588f64b51afb4528e2a2027c1a2c754eda4758d9b333e380b3bee9` — `declaration-mapping.md`
- `28db54dfd7a3ebf85c0dc7fe71f3bcd5c2aa68b7688300ed23b9d089e22b2a8c` — `leaf-implementation.md`

Key pinned/reused provenance:

- source revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`
- `WorkspaceSessionState` source `fc6c6c52c303fd50fbb9720b94e9cd9e1c98cff9fffa084623530a41892a0fcd`
- `PersistedUIState` source `b7162f2c1982b2353d4cc6db11c68077909236546e3414509e96f3c057434244`
- host snapshot source `cc4edd0b06b6bda36bf76e0ff38962768f7e0780944335483724d0ed000041e1`
- updater implementation source `79b67eb76e596dd79d1373205ffc2333c312cd45614e69cf60f110a98a4c8886`
- updater test source `64c8e09e771fbc9ef3d5806698f0c6b1cadc44bdea3d4d1ad2652dffe19b7e68`
- release-channel source `ea143e54f7264dabecd04305c1ab7e1ce0491e14f4d4a93ce39121585354723f`
- reused candidate `update-status-types.ts` `b75c4c98aaf984e1d3b18aac0d75ffbf8f7d2e7dac683c6d78d72d2d459336fc`

Every new product module carries scoped Lovecast Inc. MIT provenance. The
leaf reports its extracted constant comparison as 8/8 exact and compilation
resolved the full candidate import graph.

## Validation

Runtime binary for all recorded gates:
`/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`
(Node 24). Candidate cwd only: `/Users/carlos/Documents/Drogon-rewrite`.

```text
/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.json
exit 0

/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node apps/desktop/node_modules/typescript/bin/tsc -p tests/parity/ports/WP-UI-PRELOAD/persisted-renderer-contracts/tsconfig.json --noEmit
exit 0; skipLibCheck is explicitly false; 15 active @ts-expect-error rejection cases

/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node apps/desktop/node_modules/vitest/vitest.mjs run tests/parity/ports/WP-UI-PRELOAD/persisted-renderer-contracts/updater-beforeunload.test.ts tests/parity/ports/WP-UI-PRELOAD/persisted-renderer-contracts/positive-fixtures.test.ts tests/parity/ports/WP-UI-PRELOAD/shutdown-checkpoint/shutdown-checkpoint-persist.test.ts tests/parity/ports/WP-UI-PRELOAD/shutdown-checkpoint/shutdown-checkpoint-guard.test.ts tests/parity/ports/WP-UI-PRELOAD/shutdown-checkpoint/shutdown-checkpoint-restart-lifecycle.test.ts --environment node --reporter dot
exit 0; 5 files passed; 39 tests passed
```

The 39 candidate cases are four real updater tests, one full-envelope
pass-through case, and the accepted 34 checkpoint-policy/lifecycle cases now
using the real updater module. Previously admitted pinned-source capsules were
reused rather than rerun: persist 12/12, guard 15/15, restart lifecycle 4/4,
main/IPC 8/8, and preload routing 6/6. Candidate type/unit success is not source
execution evidence for the new extracted type tree and is not end-to-end
persistence evidence.

## Remaining root-owned gates

- Runtime admission/validation for the full persisted contract, including
  downgrade/legacy behavior.
- Serialization and durable native/database round-trip ownership.
- Main/preload IPC, caller installation, DOM/Electron acceptance, and actual
  session/editor/host restore wiring.
- A full post-correction normalized AST rerun was not recorded; root's first
  pass isolated the sole declaration mismatch and the targeted source comparison
  confirms its repair, but this distinction should remain visible.
- The leaf's exact command section abbreviates the executable as `node` beneath
  an explicit absolute-Node24 heading. This handoff expands the reproducible
  commands above; no raw provider transcript is treated as tracked evidence.

## Orca lifecycle

- Child Run: `run_c7e93ad3a68d`
- Initial Task/Dispatch: `task_fc98ab95eee9` / `ctx_323c1f3d8f61`
- Final correction Task/Dispatch: `task_fa4d182c67ce` / `ctx_f2f252e21be9`
- Exact terminal: `term_1a7ca3a1-3710-4f61-b349-1da5b738d37f`
- Verified session: OpenCode 1.18.29, `Build auto`, `GLM-5.3-Flash Z.AI Coding Plan`
- Final worker state: `succeeded` / `settled` at 2026-09-06 18:15:50 UTC
- Release: `retained`, reason `external_terminal`, `processAction: none`; no force close
- Delivery `delivery_25cd864498da` acknowledged after release

## Progress accounting

For this finite migration block, source/type audit closure is 100% of the two
entry contracts plus their compiled transitive closure (high confidence after
the root AST/leaf constant reviews); scoped test migration is 39/39 candidate
cases plus the reused 45/45 source baselines (high confidence). Whole-feature
product fidelity remains partial because runtime validation, durable storage
and actual caller/DOM integration are intentionally outside this delivery.
Change from the prior delivery is closure of the one AST mismatch, generic-deps
drift risk, and inherited `skipLibCheck` ambiguity; the next milestone is root
runtime/durable/caller acceptance, with medium 24-hour deadline risk.
