# V5 offline acceptance sweep receipts — task N

2026-09-07. Worktree `codex-vertical-05-platform-release`, branch
`codex/vertical-05-platform-release`. RUN-ONLY sweep: no fixes, no
cross-domain edits, no installs, no harness/daemon/Electron, no cargo
workspace tests, no full desktop vitest. This file is the only artifact.

## Clean-tree gate (before)

- `git status --porcelain` → empty output (exit 0) — **clean, gate passed**.
- `git rev-parse HEAD` → `f9b7d29de16f6b3c0ed422cf4ed9fa6c32876aa6`.

## Lane 1 — 8-file packaging lane

- Command (exact, from worktree root):
  `/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test scripts/acceptance-bridge-observation.test.mjs scripts/acceptance-process.test.mjs scripts/desktop-artifacts.test.mjs scripts/packaged-runtime-admission.test.mjs scripts/packaged-fixture-daemon.test.mjs scripts/preview-install-lock.test.mjs scripts/probe-rendered-harness.test.mjs tests/parity/ports/WP-ENG-RUNTIME/package-admission/sealed-bundle-identity.test.mjs`
- Runtime: Node v24.19.0 (Node24 cache binary).
- Exit code: **0**.
- Counts: **tests 70, pass 70, fail 0, cancelled 0, skipped 0, todo 0**.

## Lane 2 — renderer contracts + typecheck

Script names resolved from root `package.json` first, exactly as expected:
`test:renderer-contracts` and `typecheck:renderer-contracts`.

- **Environment finding (recorded verbatim, no fix made):**
  `pnpm run test:renderer-contracts` → `zsh:1: command not found: pnpm`,
  exit **127**; `which pnpm` → "pnpm not found". The pnpm wrapper is absent
  from this shell's PATH. The lane was then executed via its exact resolved
  underlying command (no installation, no PATH change, no edit):

### Lane 2a — `test:renderer-contracts`

- Resolved command (exact):
  `node apps/desktop/node_modules/vitest/vitest.mjs run tests/parity/ports/WP-UI-PRELOAD/implementation-checks tests/parity/ports/WP-UI-PRELOAD/authority-recovery/browser-window-close tests/parity/ports/WP-UI-PRELOAD/authority-recovery/close-active-tab tests/parity/ports/WP-UI-PRELOAD/authority-recovery/renderer-restart tests/parity/ports/WP-UI-PRELOAD/persisted-renderer-contracts tests/parity/ports/WP-UI-PRELOAD/shutdown-checkpoint`
- Runtime: node v26.8.1 (the `node` the script itself would resolve).
- Exit code: **0**.
- Counts: **Test Files 10 passed (10); Tests 72 passed (72); 0 failed,
  0 skipped**; duration 225 ms.

### Lane 2b — `typecheck:renderer-contracts`

- Resolved command (exact):
  `node apps/desktop/node_modules/typescript/bin/tsc --noEmit --skipLibCheck false -p tests/parity/ports/WP-UI-PRELOAD/persisted-renderer-contracts/tsconfig.json`
- Runtime: node v26.8.1.
- Exit code: **0**.
- Counts: **typecheck errors 0** (empty output, 0 bytes).

## Clean-tree gate (after)

- `git status --porcelain` → empty output — **tree still clean**; this
  receipt file was created after the gate re-check, untracked.

## Summary

All executed lanes green: 70/70 packaging, 72/72 renderer contracts, 0
typecheck errors. One environment finding: `pnpm` missing from PATH (exit
127, verbatim above) — lanes were run via their exact package.json-resolved
commands instead; no fix was applied.
