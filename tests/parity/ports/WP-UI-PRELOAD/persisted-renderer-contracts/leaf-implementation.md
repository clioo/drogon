# Persisted renderer contract migration — leaf implementation report

2026-09-06 (rev. 2, root AST-review corrections applied). Sole OpenCode GLM
leaf, no delegation. Tasks `task_fc98ab95eee9` delivery corrected under
`task_fa4d182c67ce`. Source pin: read-only
`/Users/carlos/Documents/Drogon-mentu-session` at
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`, never used as a test cwd. Gate
document: `docs/migration/persisted-renderer-contract-migration.md`.

## Delivered (all inside exclusive ownership)

- `apps/desktop/src/shared/persistence-contracts/` — 38 TypeScript files
  INCLUDING `checkpoint-staging-envelope.ts`: the complete pinned
  `WorkspaceSessionState` + `PersistedUIState` contracts, the actual
  referenced type closure, `WorkspaceSessionHostSnapshot`, and the envelope
  binding `ShutdownCheckpointStageArgs<WorkspaceSessionHostSnapshot,
  Partial<PersistedUIState>>` plus `BoundCheckpointPersistDeps =
  ShutdownCheckpointPersistDeps<WorkspaceSessionHostSnapshot,
  Partial<PersistedUIState>>` — imported directly from the accepted generic
  factory module, with NO hand-copied dependency field list.
- `apps/desktop/src/renderer/src/lib/updater-beforeunload.ts` — faithful port
  of the pinned implementation (source SHA256
  `79b67eb76e596dd79d1373205ffc2333c312cd45614e69cf60f110a98a4c8886`).
- `tests/parity/ports/WP-UI-PRELOAD/persisted-renderer-contracts/**` — ported
  `updater-beforeunload.test.ts` (4 source cases), `positive-fixtures.test.ts`
  (full source-faithful local/SSH/runtime snapshots + full UI patch bound to
  the factory), `negative-compile-cases.ts` (15 compile-time rejection
  assertions via `@ts-expect-error`, which fail the gate if unused — including
  an invalid `automaticResumeBlockedBy` discriminator), owned `tsconfig.json`,
  `declaration-mapping.md`, this report.
- `tests/parity/ports/WP-UI-PRELOAD/shutdown-checkpoint/
  shutdown-checkpoint-restart-lifecycle.test.ts` — inline updater copy removed;
  harness imports the real candidate module; all original assertion bodies
  unchanged.

Per-file declaration/hash/boundary mapping with closure limits:
`declaration-mapping.md` in this directory. All eight extracted constant
declarations re-diffed against the pin: 8/8 identical.

## skipLibCheck classification

The owned `tsconfig.json` OVERRIDES the inherited `skipLibCheck: true` with
`skipLibCheck: false` and passes. No skip/error-ignore is in effect for this
gate; nothing is hidden by transpile-only checking.

## Exact commands and results (Node24
`/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`,
cwd `/Users/carlos/Documents/Drogon-rewrite`)

1. `node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.json`
   → exit 0 (`DESKTOP-TS-OK`). Typechecks the complete candidate closure
   without skips; during the original delivery this compiler-driven closure
   check caught two invented fixture fields which were removed.
2. `node apps/desktop/node_modules/typescript/bin/tsc -p
   tests/parity/ports/WP-UI-PRELOAD/persisted-renderer-contracts/tsconfig.json
   --noEmit` → exit 0 with `skipLibCheck: false`. This includes
   `negative-compile-cases.ts`: tsc passing proves all 15 expected compile
   rejections occur (an unused `@ts-expect-error` fails the run).
3. `node apps/desktop/node_modules/vitest/vitest.mjs run
   tests/parity/ports/WP-UI-PRELOAD/persisted-renderer-contracts/updater-beforeunload.test.ts
   tests/parity/ports/WP-UI-PRELOAD/persisted-renderer-contracts/positive-fixtures.test.ts
   tests/parity/ports/WP-UI-PRELOAD/shutdown-checkpoint/{shutdown-checkpoint-persist,shutdown-checkpoint-guard,shutdown-checkpoint-restart-lifecycle}.test.ts
   --environment node --reporter dot` → `Test Files 5 passed (5)`,
   `Tests 39 passed (39)`, exit 0 — 4 updater-beforeunload cases + 1 envelope
   binding case + the unchanged 34 shutdown-checkpoint cases.

Admitted shutdown-checkpoint source capsules were reused for attribution, not
rerun (persist 12/12, guard 15/15, lifecycle 4/4, main/ipc 8/8, preload 6/6
per the sibling leaf report). The main/ipc and preload routing suites remain
separate source baselines / root implementation-map items.

## Evidence classification

Delivered: TYPE compatibility of the complete closure, compile-time
positive/negative fixtures, behavioral unit evidence for the ported
`updater-beforeunload` and the unchanged checkpoint policy suites against the
real module. NOT delivered / distinguished: runtime validation (zod
admission), serialization, database ownership, durable round-trip
persistence, DOM/Electron/caller wiring, real Electron acceptance — open root
gates. No behavioral RED was manufactured and none was required.

## Limitations

- Type-only extraction is provenance-marked per file; runtime siblings remain
  only in the pinned source (per-row notes in `declaration-mapping.md`).
- `ReleaseChannel` reuses the accepted candidate `update-status-types`
  declaration after structural comparison; not duplicated.
- Negative fixtures prove compile-time rejection only; runtime admission is a
  separate root gate.

## Exact SHA256 hashes (changed candidate artifacts; full digests)

Candidate persistence-contracts/ (38 files, full digests; updater-beforeunload listed at its renderer/lib path):

```
0869d62614f45ab5216be56bd6a73b27b631f2fab1b8eef821c9206da3374d10  persistence-contracts/agent-session-resume.ts
29e33c17ced28182807458fe0e7b4ac9e23cd5e09b4b052bdc04b53e6df75fa6  persistence-contracts/agent-status-types.ts
7519efd8859c79a4208ca30a9f60d88aa50951316b8d5c03ad9668845be139ef  persistence-contracts/agents-view-thread-filters.ts
f0a4bdfce15e6e30d22eda0eafd79c92f30a9403684d225bfc873bd0bbc7b511  persistence-contracts/ai-vault-session-title.ts
97e289eb76287ddb715ea71ffb8d277e613036c2407425c9813562993030c13f  persistence-contracts/ai-vault-types.ts
b3a01e01bf3af2bffa99a048679f994d5ac6d6d4c9965a17d27fbaaf085a94b6  persistence-contracts/automation-host-filter.ts
c46599dd04df6c3637a0ce0d9b847704f6fec8e23e35c195d385009430a47315  persistence-contracts/browser-workspace-types.ts
80d30469f794b57b6b6695a07b3e962f7281a2d668cde6ce760b6d10341912a8  persistence-contracts/checkpoint-staging-envelope.ts
1af7c14523b1e35fdc7f0466ef2ff3ca8bd5c3d77bb4df3a993623c6d80e5fa0  persistence-contracts/client-hosted-browser-close-intent.ts
6326a46f22a429d468f9a9389b27eb82dd773861b49338e7e968c26343751f2a  persistence-contracts/client-hosted-browser-page-record.ts
164513cce32e9119f0a5fe42131266bff94837e9a6932ff58b1ec5b627f5153a  persistence-contracts/closed-terminal-tab-tombstones.ts
1d30058a03f9da6e7ff3b02b368e813c144bae1b0bb938179ff2c91616d42064  persistence-contracts/contextual-tours.ts
c3717903bb5e69056ebe811806bec0ae4c4ec05cf319d3862fe70298f2c67dd5  persistence-contracts/execution-host.ts
d0e15756981a96c55b2a8c945763dd747346bc1e1ea6476726e89fd43514d601  persistence-contracts/feature-interaction-catalog.ts
0816bd3ceb3d00d581abd3526182b6bb7d9304822c1ad3c31758e4f47540c213  persistence-contracts/feature-interactions.ts
6ad27ae495666e77321a40e74680ec45c09032cb0bdeb93a12e9d072ca89978e  persistence-contracts/feature-tips.ts
6b6817d5be299ed9bdf4e94a139a62c8acbd0ac3238d20b48813fbb4b367926f  persistence-contracts/folder-workspace-types.ts
a69e51066a951eadb978c7ac9cab186f28cf2f3a3dc3e227437977d25fd4b3b5  persistence-contracts/hosted-review.ts
c9cc306ee17e66ef3039ed83769de9634beb6a5b63447d296dfaa5545396b7ac  persistence-contracts/linear-project-types.ts
235672855b51ffed71c1db9499bbe74aca7d38bd9f1830bb0e74d4e86e0ca3eb  persistence-contracts/linear-workspace-types.ts
d846356fd0a0d3da5f3583d647fbde7f43d55efe21e567d15abe5cacb1562569  persistence-contracts/mentu-pane-types.ts
7fe7a4539a6fa3f286a5d61b1ec6e6c8e3410ae79e1037a7b2c440ef4d34f5fe  persistence-contracts/mentu-session-state-types.ts
1db63f5fbdf4b74552d876ca33f576b1bcbf68e4242501e0bbc279af50473871  persistence-contracts/orca-yaml-hook-types.ts
d7582fb697d78740694280d7facc2b9737e032609d6a4810a66aabd0b83af13a  persistence-contracts/persisted-ui-state-types.ts
c0137774c6289c77bf97a382aa586cab3d511c9c02e863955f56212270e50458  persistence-contracts/pet-types.ts
5d357ff9bb20775803d69d4d427efd47e795f367482684127c49709c5257c3eb  persistence-contracts/status-bar-usage-mode.ts
a7907c63a92e85f7e0ed7c3b832e5a90f4178fd39d99fbd0991c9f24fa935e2e  persistence-contracts/tab-types.ts
6832e665c66ce614bba8d40dc3bfc0f347f9b33e16d35183d2142f413cdb9687  persistence-contracts/terminal-tab-types.ts
ecb8962410211d823e63e90ae710a07e23ee43fb3e60e2d9b9bbf107baa12725  persistence-contracts/tui-agent.ts
1ae3cc25849f26665938fc9151e4e2343b69102a16667eb74a02ce64820429a5  persistence-contracts/ui-chrome-types.ts
dc946f61423b7f38da0790f4b39e7e44ee10d560e7a591dfa3b33a895934c0ec  persistence-contracts/usage-percentage-display.ts
770beb70fadee1216cacdf6b143f647ee6e3a0899214d27d62be8ae9f8b7597c  persistence-contracts/workspace-cleanup-browse-state.ts
a8590f959b460e07c344de2a72fe24163878f45b3cd0739cdae67d28a8b7512a  persistence-contracts/workspace-cleanup-filter-model.ts
1ade97240238a68e4dcb3dd1338b199f7f8904b3ce6ca3075cc64b9f452a2865  persistence-contracts/workspace-cleanup.ts
fa1c2039e188f9c2efa0b1c25ca2f7a2784017b8f6d234fa159961bab5c16a0e  persistence-contracts/workspace-doc-history.ts
c3458b2fa5ab8a332dcb85e358df83b634a8c8f43f0402355b82345351e95175  persistence-contracts/workspace-session-host-persistence.ts
7d06ef1c7d4fe563d864bd37d97cb4a9e395749acc5e8ec0d0a202b428bc42e1  persistence-contracts/workspace-session-state-types.ts
d99f9dee13c18f36c2ba5bd1f1e3d62c3cb73be39c4aa3161ef3ebc9cca64958  persistence-contracts/worktree-types.ts
9411cce3562eb49c173e493eb75103e3a7e1dcbf08008f8945ed2a9a16d20c9e  updater-beforeunload.ts
```

Tests/evidence (candidate):

```
a2ef75fcb69669622dbb855fa989ec0d9fc3a94a44fe2115e67b956018aa416f  persisted-renderer-contracts/positive-fixtures.test.ts
5d7e8451219c7a3b54d1fc2418ebdb17953cbd045f37eefb938af09db0a8c07f  persisted-renderer-contracts/updater-beforeunload.test.ts
ae6a3fe2a502e6a76bb73f9778fdd154935dfc12b072f3057b40a7eedf05d8c1  persisted-renderer-contracts/negative-compile-cases.ts
6f04260a54c28cecfea520e6ddf23cacc518ed756a9a220fccf5c3fea89f9eeb  persisted-renderer-contracts/tsconfig.json
66a27986514a90b62214bea5653392619d288536fa1f432acf160b32013d9971  shutdown-checkpoint/shutdown-checkpoint-restart-lifecycle.test.ts
```

Source reference digests required by the review:

```
64c8e09e771fbc9ef3d5806698f0c6b1cadc44bdea3d4d1ad2652dffe19b7e68  pinned src/renderer/src/lib/updater-beforeunload.test.ts
ea143e54f7264dabecd04305c1ab7e1ce0491e14f4d4a93ce39121585354723f  pinned src/shared/release-channel.ts
b75c4c98aaf984e1d3b18aac0d75ffbf8f7d2e7dac683c6d78d72d2d459336fc  reused candidate apps/desktop/src/shared/update-status-types.ts
```

(This report is excluded from its own artifact-hash list: a final self-digest
cannot be embedded without changing the file.)
