# E3 leaf S-FACTORIES: domain usage factories (24 channels)

Candidate leaf audit, **not** closure. Root E3 lead owns integration and
review. No recensus was performed: the 24 channels (3 providers × 8 ops) are
reconciled against existing evidence, never re-extracted.

- Task `task_f6eae017c314`, Dispatch `ctx_1b83d1a79421`, parent terminal
  `term_233f0742-c797-43da-b5b9-0efd8e91ad43`.
- This worker runs on terminal `term_517b3e95-5910-4621-8141-29b5a38f4517` at
  dispatched depth 2 (leaf, no descendants). Authorized launch
  `opencode --model opencode-go/muse-spark-1.3-contributor --auto`; routing
  receipt only, no self-authentication. No child Run was created.
- Source read-only: `/Users/carlos/Documents/Drogon-mentu-session` pinned
  `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. Work limited to
  `/Users/carlos/Documents/Drogon-rewrite`. Earlier artifacts preserved. No
  tests executed, no installs, no product edits, no Git operations.
- Machine companion: `domain-usage-factories.json` (8 operation contracts,
  provider differences, 22 verified whole-file hashes, 4 test files).
- Global audit stays 75% = 9/12, medium-low; no automatic acceptance.

## The 24 channels

One generic factory on each side, instantiated 3 times. Preload
(`src/preload/usage-provider-api.ts:8-29`): `createUsageProviderApi(ipc,
prefix)` maps 8 methods to `` `${prefix}:<op>` `` invokes for `claudeUsage |
codexUsage | openCodeUsage` (bridges are 8-line re-exports). Main
(`src/main/ipc/usage-provider-handlers.ts:30-68`): `registerProviderHandlers`
installs 8 `ipcMain.handle` routes per prefix; `registerUsageProviderHandlers`
(64-68) wires the three real stores, called once under the core-registration
guard (`register-core-handlers.ts:145`). Ops: `getScanState`, `setEnabled`,
`refresh`, `getSnapshot`, `getSummary`, `getDaily`, `getBreakdown`,
`getRecentSessions`.

## Store / result / state / error / refresh boundaries

All three stores extend the shared `UsageProviderStoreLifecycle`
(`usage-provider-store-lifecycle.ts:51-170`): sync `getScanState` (persisted
scan fields + live `isScanning` + computed presence flag), `setEnabled`
(assign + awaited disk write, no scan), `refresh(force)` (disabled → no-op;
else 5-minute `STALE_MS` + worktree-fingerprint short-circuit unless forced;
single-flight scans; scan errors captured to `lastScanError` and resolved, not
rejected; post-scan persistence best-effort), JSON cache on disk with schema-
versioned invalidation that always preserves the `enabled` flag.

Per-operation truth (see JSON for full shapes): `getScanState` is arg-less;
`setEnabled` requires `{enabled}` (destructured — undefined whole-args
throws `TypeError`; values unvalidated); `refresh` tolerates fully-absent args
(`args?.force ?? false`); `getSnapshot` is a **stale-capable sync projection**
(no refresh) defaulting `limit` to 10 everywhere; `getSummary`/`getDaily`/
`getBreakdown`/`getRecentSessions` always `refresh(false)` first. Recent-
sessions default limit diverges: 12 (claude/codex) vs 10 (opencode). Unknown
scope/range/kind strings are never validated — builders filter to empty
projections rather than throwing.

## Provider differences

- Billing model: Claude counts **turns** with peer cache buckets
  (`cacheRead/cacheWrite`, `cacheReuseRate`, `zeroCacheReadTurns`, `topModel`/
  `topProject`, per-session `branch`); Codex/OpenCode count **events** with
  subset `cachedInputTokens` + `reasoningOutputTokens`/`totalTokens`. The
  contract header states why no record is normalized
  (`usage-provider-contract.ts:1-8`).
- `hasInferredPricing` exists on Codex breakdown/session rows only.
- Source keys: `processedFiles` (claude, codex) vs `processedDatabases`
  (opencode); schema versions 6/5/2; cache files `orca-{claude,codex,
  opencode}-usage.json`; presence keys `hasAny{Claude,Codex,OpenCode}Data`.
- Codex omits `jsonIndent` (compact file); claude/opencode use indent 2.
  Codex same-version normalize backfills `locationModelBreakdown ?? []`.
- Scopes (`orca|all`), ranges (`7d|30d|90d|all`), breakdown kinds
  (`model|project`) are identical unions, all runtime-unvalidated.
- Scanner bodies (file vs database ingestion) are the explicit external-
  provider fixture boundary and were not expanded.

## Optional / null / runtime-validation distinctions

Timestamps are `number|null` (null until first scan); `lastScanError` null
until first failure and cleared on next start and success; presence flags are
always boolean, never null; cost/reuse/tops are `number|string|null` with null
until computable; session `branch`/`model` null until known. `refresh()` with
no args passes `undefined` over IPC (test-pinned) and means non-forced;
`force: null` also means non-forced; only `true` forces. `limit: undefined`
takes the default; `null`/0/negative flow through unvalidated.

## Immediate UI consumption

The zustand slices (`usage-provider-slices.ts:266-299`, shared factory
123-256) consume **4 of 8** ops per provider: `getScanState`, `setEnabled`,
`refresh`, `getSnapshot`. `fetchUsage` returns early on `undefined` scanState
(paired web client), stops when disabled, conditionally writes the first
snapshot, refreshes, then unconditionally writes the second; errors are caught
and logged, never surfaced. Initial state: scope `orca`, range `30d`, null
scan/summary, empty arrays — identical across providers. The remaining four
channels (`getSummary`/`getDaily`/`getBreakdown`/`getRecentSessions`) have **no
caller in the desktop slice** — only test-harness mocks reference them. That
is stated as exposed API surface, not as a claim of dead code.

## Tests (exact anchors, still unrun)

- `src/preload/usage-provider-api.test.ts` (33 lines): 1 `it` fully read —
  per-prefix exact invoke channel+arg sequence for all 8 ops.
- `src/main/ipc/usage-provider-handlers.test.ts` (65 lines): 1 `it` fully
  read — 24-channel registration order plus claude forwarding exactness
  (`refresh` → `[false]`/`[true]`; snapshot deconstructed to positional
  scope/range/limit). Store doubles; codex/opencode asserted for scan-state
  only.
- `usage-web-client-fallback.test.ts` (65 lines): 4 `it`s fully read —
  undefined-API no-throw with null state preserved, all three slices.
- `usage-snapshot-refresh.benchmark.test.ts` (135 lines): harness read;
  timing bounds not inventoried (benchmark, not contract proof).
- `usage-provider-store-lifecycle.test.ts` is referenced as a remaining
  whole-file gate; its body was not read in this leaf.

## Honest defects vs intended (coordinator dispositions, not fixes)

1. **No sender gate** on any of the 24 handlers (raw `ipcMain.handle`) —
   any renderer can read caches, toggle tracking, force rescans. Observed
   weakness candidate; do not silently reproduce without disposition.
2. **No runtime validation** — malformed args either throw `TypeError` or
   persist silently; pin behavior before adding any schema.
3. **Stale-read asymmetry** (`getSnapshot` vs refreshing getters) and
   **limit/format asymmetries** (12 vs 10; indent; backfill) — preserved as
   observed until root rules.
4. Scanner internals, rollup bucket rules, and automation-attribution lookups
   (`getAutomationRunUsage` per store) were not expanded; per-method result
   population beyond the snapshot unions remains open.

Still-unrun acceptance is enumerated in the JSON: whole-file execution of all
five test files, malformed-arg regression pins, freshness/concurrency/schema
gates, and real Electron delivery for all 24 channels.
