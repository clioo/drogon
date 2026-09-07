# BotsPanel (exported-but-unmounted) — RED→GREEN evidence

Worker: V4-B (task_de6680399532, dispatch ctx_f035020e4207), 2026-09-07.
Runner: repo-pinned Node 24 (`/Users/carlos/.cache/codex-runtimes/
codex-primary-runtime/dependencies/node/bin/node`, v24.19.0) driving the
worktree-installed vitest 5.0.0 from `apps/desktop/node_modules`.

## Commands (exact, from the worktree root)

```sh
node apps/desktop/node_modules/vitest/vitest.mjs run --root apps/desktop src/renderer/src/features/bots
node apps/desktop/node_modules/vitest/vitest.mjs run --root apps/desktop          # full desktop suite
cd apps/desktop && ./node_modules/.bin/tsc --noEmit               # typecheck
node_modules/.bin/prettier --check "apps/desktop/src/renderer/src/features/bots/**"
```

## Sequence

1. **RED-1 (candidate absent, test first).** Only
   `BotsPanel.contract.test.ts` existed. Result: `Test Files 1 failed (1)`,
   `Tests no tests` — `Cannot find module './BotsPanel'`. Recorded as **test
   preparation (module absent), not behavioral RED**.
2. **RED-2 (compilable stubs, behavioral).** Types + empty projection arrays +
   `BotsPanel` rendering a bare `div`. Result: **8 failed | 4 passed (12)** —
   genuine assertion failures on ordering, trigger/manual-run rules, history
   null joins, empty state, card content, dispatch payload, observation labels.
3. Two test-authoring defects found during the loop were fixed without
   weakening assertions: a projection accessor (`runId`, not `run.id`) and a
   missing `onRunResponsibility` prop in one render case (the panel correctly
   renders no run control without a callback — the case now pins that twice).
4. **GREEN.** Full implementation. Result: **Test Files 1 passed (1), Tests
   12 passed (12)**.
5. **No regressions.** Full desktop suite after implementation + prettier:
   **Test Files 15 passed (15), Tests 126 passed (126)**; `tsc --noEmit` clean;
   prettier clean.

## Contracts consumed (not modified)

- `crates/drogon-core/src/bots/records.rs` +
  `crates/drogon-core/src/automations/records.rs` (admitted native storage,
  serde camelCase JSON shapes) via `docs/migration/native-bot-state-contract.md`.
- Source BotsPage display fallbacks (title → instructions → "Ready for a
  purpose", harness-default model) per the WP-CAP-BOTS bots-page port.

## Deliberate non-claims

- This panel is exported for V2's single App mount point; nothing is mounted
  here, no store/RPC/session access exists, and no run/result semantics are
  invented: host observations render verbatim as evidence labels only,
  reactive responsibilities never get a manual run control (source refuses
  manual reactive runs), history order is preserved from the caller (the
  store provides newest-first) and orphaned rows keep explicit null-join
  markers instead of invented links.
- Interactive click binding needs a DOM test environment that this worktree
  does not provide (happy-dom/@testing-library not installed); dispatch
  payloads are pinned via the run button's `data-bot-id` /
  `data-responsibility-id` attributes.

## V4-B3 — liveness honesty + control gating (task_6ac72f93b8ba, 2026-09-07)

### ROOT-review finding (a): persisted-session association rendered as live

`projectBotRows` derived `sessionActive = currentSession !== null` and the
panel rendered "session active" — a liveness inference from storage presence.
Per `docs/migration/native-bot-state-contract.md` ("A stored session reference
is not proof of process liveness") this is now impossible:

- Projection: `sessionActive: boolean` replaced by
  `sessionLink: 'linked' | 'none'` (persisted association only), rendered as
  "Session linked" / "No session linked".
- Liveness is exclusively caller-supplied via the new
  `observedLivenessByBotId?: Record<string, 'live' | 'unverifiable' | 'exited'>`
  prop and `projectSessionLiveness()`; the projection never reads the bot
  record, renders the verdict verbatim ("Observed liveness: …"), and an
  unobserved bot renders no liveness claim at all.
- New regression pins: a stored-but-stale `currentSession` renders the link
  wording and never the words "session active" or "live"; injected
  live/unverifiable/exited verdicts render verbatim; the projection helper
  returns `null` for absent callers/bot IDs and never derives a verdict.

### ROOT-review finding (b): nonfunctional Create Bot control

The "Create Bot" button and its `onCreateBot` prop are removed until the
Bot-create service capability lands in the rewrite (no service behind it —
rendering the control invited a dead end). Callback gating remains for run
controls: no run button renders without `onRunResponsibility`, and its
`data-bot-id` / `data-responsibility-id` payload pins are unchanged. The
empty-state test was updated to the corrected wording (empty state, no create
control); no other assertion was weakened.

### RED-before-GREEN (commands from worktree root, Node 24.19.0 runner)

```sh
node apps/desktop/node_modules/vitest/vitest.mjs run --root apps/desktop src/renderer/src/features/bots
cd apps/desktop && ./node_modules/.bin/tsc --noEmit
node apps/desktop/node_modules/vitest/vitest.mjs run --root apps/desktop
```

1. RED (tests first, implementation unchanged): **4 failed | 12 passed (16)** —
   session-link wording, never-live stale-session pin, caller-supplied
   liveness rendering, and the liveness-projection helper all failed against
   the old `sessionActive` implementation. The corrected empty-state assertion
   passed against the old code only because the old panel also rendered no
   create control without a callback; its `not.toContain("Create Bot")` now
   pins the removal unconditionally.
2. GREEN after implementation: **Test Files 1 passed (1), Tests 16 passed
   (16)**.
3. Full desktop suite: **Test Files 15 passed (15), Tests 130 passed (130)**;
   `tsc --noEmit` clean; prettier clean.

### V2-mount seam proposal (c) — documented, not implemented

No PanelDescriptor/route-panel contract exists in this worktree and none is
invented here (ROOT owns shared TS/IPC after the runner proposal). The
proposal below is the exact seam V2 would consume when mounting this panel;
it is a documentation commitment about this package's exports, not code:

- **Factory inputs (all caller-supplied, no store invention):**
  1. `snapshot: BotsPanelSnapshot` — `bots: BotsPanelBot[]` (list projection:
     id, characterPreset, displayIdentity{displayName, handle, title},
     harnessPolicy{defaultHarness, explicitModel}, instructions, memories,
     responsibilities[] with discriminated reactive/scheduled triggers,
     nullable recipe link, nullable currentSession) and
     `history: BotsPanelHistoryEntry[]` (newest-first as supplied, nullable
     responsibility/automation/run joins, nullable hostObservation).
  2. `session` — **nullable**: the panel accepts a bot whose
     `currentSession` is `null` or a stored (possibly stale) session and
     renders link wording only; V2 must pass any live-process verdict it
     observes separately via `observedLivenessByBotId`, never by wrapping the
     stored session.
  3. Injected bridge/dispatch callback:
     `onRunResponsibility?: ({botId, responsibilityId}) => void` — the only
     control that renders is the scheduled manual-run button, gated on this
     callback; payload keys are pinned by `data-bot-id` /
     `data-responsibility-id` attributes because click binding needs a DOM
     environment this worktree does not provide.
- **Mount contract**: `BotsPanel` (default + named export) stays
  exported-but-unmounted; V2 owns the single App mount point, supplies
  `key`s from bot IDs, and owns focus/cleanup per the handoff's "Rutas y
  paneles" freeze (props tipadas, descriptor de ruta, foco, estado persistido
  y cleanup). No panel registers itself anywhere; no descriptor type is
  introduced until ROOT ratifies the shared contract.

## V4-B4 — PanelDescriptor factory export (task_c75f45a11f4e, 2026-09-07)

### Contract adaptation

The shared route/panel contract lives at
`c5fea1d:apps/desktop/src/renderer/src/route-panel-contract.ts` (commit
V2-002, branch `codex/vertical-integration`) and is **not present at this
branch's HEAD**, so `bots-panel-descriptor.ts` adapts to it structurally via a
prior `git show` read only: the contract file is neither imported (impossible
at this HEAD) nor copied into this package. `createBotsPanelDescriptor`
builds the `PanelDescriptor` shape — `{id, title, component, capability?,
restoreState?, onFocus?, onCleanup?}` — from caller-supplied inputs only and
mirrors exactly one contract invariant locally (non-empty route id, as
`routeId()` enforces); the capability gate is threaded verbatim and validated
at registration by the registry, never guessed here. Decisions the contract
leaves to ROOT/V2 stay explicit parameters: the concrete route-id string,
title, capability, default restore state and focus/cleanup hooks. The
descriptor's `component` names only `session` from the shared mount props,
typed nullable and deliberately unconsumed: the bridge session is never a
liveness source (V4-B3 invariant re-pinned at the descriptor level), and
liveness renders exclusively from the caller-supplied
`observedLivenessByBotId` map carried in `panel`.

### Mount/registration discipline

The factory registers and mounts nothing: no `registerRoute` call, no
registry, no App/main edits, no side effects — V2 stays the single mount
point and calls the factory with a minted route id when wiring the panel.
`index.ts` gained only the export lines for
`createBotsPanelDescriptor` + its two types.

### RED-before-GREEN (commands from worktree root, Node 24.19.0 runner)

```sh
node apps/desktop/node_modules/vitest/vitest.mjs run --root apps/desktop src/renderer/src/features/bots/bots-panel-descriptor
node apps/desktop/node_modules/vitest/vitest.mjs run --root apps/desktop src/renderer/src/features/bots
node apps/desktop/node_modules/vitest/vitest.mjs run --root apps/desktop
cd apps/desktop && ./node_modules/.bin/tsc --noEmit
```

1. RED-1 (test written first, candidate absent): `Test Files 1 failed (1)`,
   `Tests no tests` — `Cannot find module './bots-panel-descriptor'`;
   preparation failure, not behavioral RED.
2. RED-2 (compilable stub returning an empty object): **7 failed (7)** —
   genuine behavioral failures on id/title/component shape, route-id
   rejection, verbatim threading, nullable-session rendering, callback
   threading and the exact descriptor surface.
3. GREEN (real factory): descriptor suite **7 passed (7)**; bots package
   **Test Files 2 passed (2), Tests 23 passed (23)** (B3's 16 unmodified plus
   these 7); full desktop suite **Test Files 16 passed (16), Tests 137 passed
   (137)**; `tsc --noEmit` clean; prettier clean.
