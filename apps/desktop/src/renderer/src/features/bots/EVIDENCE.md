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
