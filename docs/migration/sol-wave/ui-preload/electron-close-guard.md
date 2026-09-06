# Electron close-guard acceptance

2026-09-06. This bounded acceptance block proves the current production
main-world `window.close` boundary before root wires the accepted guard module.
It does not edit product code, start `drogond`, use a default user profile, or
claim that the desktop application is globally GREEN.

## Result

The actual built desktop launched under Electron 44.2.0 with a nonce profile,
published a random loopback CDP endpoint, and was inspected through Playwright
1.63.0. The behavioral result is a genuine **RED**: main-world `window.close`
is still Chromium's native own function and its descriptor is
`configurable: true`, `writable: true`, `enumerable: true`. The required guard
is a non-native no-op with all three flags false.

The RED is bound to these built artifacts, rather than to a moving repository
HEAD:

- built main SHA256:
  `65cf7afdb764e3c0a561cd22feac7a24c03af7bc4b956a0a7bfc33505d122dfe`
- built preload SHA256:
  `77f87eb59169e9f52693fc2e0ab9146fa6e0d50c931cfb9b3b23cd030bf6f735`
- base module revision: `bb85b83` (not the tested candidate revision)
- repository HEAD observed by direct `.git` file reads immediately after the
  RED: `81d3a34259e0e3d31701fd33344b2f9cd83f8854`; working-tree changes may have
  existed and cleanliness is not asserted. Root-owned commits moved HEAD while
  the review continued, so the build digests above are the authoritative
  behavioral identity.

The isolated renderer also exposed `window.drogon.status` while `require`,
`process`, `module`, `global`, and `Buffer` were absent. The built main entry
corroborates `contextIsolation: true`, `sandbox: true`, and
`nodeIntegration: false`. This is boundary-specific evidence only; the expected
service-unavailable UI was visible because no daemon was started.

`window.close()` was not called after the descriptor failed. Both retained
screenshots are 2800 x 1776 and byte-identical, confirming that the same page
remained visible across the safe before/after capture without exercising the
unsafe native close. The self-contained RED evidence is
`tests/parity/ports/WP-UI-PRELOAD/electron-close-guard/2026-09-06T16-01-47-784Z/`.

## Source baseline, port validation, and candidate parity

These are separate gates:

1. **Source baseline.** The pinned source is
   `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. The original
   `src/preload/browser-window-close-installation.ts` SHA256 is
   `fdd0ce5f4416d1d9d8e517ae33b7bc6b429479e851ec70c9f87c66c8f2b53720`;
   its complete frozen suite was previously accepted 1/1.
2. **Port validation.** The accepted candidate module
   `apps/desktop/src/preload/browser-window-close-installation.ts` SHA256 is
   `96d421c52268a7b48d35ecb710bf60fd4b0d4337587f6a8cd00636bed66c8605`.
   The final harness unit/CLI seam suite passes 19/19 and read-only `--check`
   succeeds.
3. **Candidate parity.** The actual built preload does not import or call that
   module. The Electron/CDP probe therefore reports behavioral RED. Module
   correctness is not live binding parity.

The first product launch reached the real CDP page but exposed a harness defect:
Playwright string evaluation returned an unevaluated function, so the posture
probe result was undefined. That attempt is retained at
`2026-09-06T16-00-04-428Z/report.json` as `NOT_OBSERVED` plumbing/setup evidence,
not behavioral RED. The probe was wrapped as a self-invoking expression and the
second launch produced the sole genuine RED; Electron was not launched again.

## Runner contract and focused review

`scripts/accept-preload-close-guard.mjs` is import-effect-free. No arguments and
`--check` are read-only and spawn-free; only `--execute` creates the nonce
fixture or starts Electron. Unknown, duplicate, conflicting, positional, and
combined `--help` flags are rejected before effects. Every stage wait is capped
at 30 seconds and process creation reuses the existing `shell: false` helper.

Root's early review found and delegated five focused corrections to the same
GLM leaf: base-module versus candidate/build provenance, `--help` isolation,
behavior/evidence/cleanup verdict separation, definitive persistence ordering,
and a nonzero missing-build CLI exit. The final runner now composes status before
its definitive report write, checks the persisted verdicts against the returned
result and CLI summary, and cannot claim success when screenshot/report evidence
is incomplete or owned-process cleanup is unverifiable. An injected empty-build
fixture proves the missing-build path returns `NOT_OBSERVED`, creates no fixture,
does not launch Electron, and sets exit code 1.

The exact final focused commands, from
`/Users/carlos/Documents/Drogon-rewrite`, were:

```text
/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test scripts/accept-preload-close-guard.test.mjs
# exit 0; 19 passed, 0 failed, 0 skipped

/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/accept-preload-close-guard.mjs --check
# exit 0; ok:true; Electron 44.2.0; Playwright 1.63.0; Node v24.19.0
```

The executed behavioral command was:

```text
/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/accept-preload-close-guard.mjs --execute
# exit 1 by contract; behavioral RED, failureClass guard-not-replaced-native
```

The CDP browser session closed and the owned Electron process reached `exited`;
a focused post-run process check found no process containing either nonce. The
two nonce profile directories remain isolated under `.preflight/acceptance` as
local diagnostic state and were never default/user profiles. No existing Orca
or Drogon session was signalled or closed.

## Delegation and remaining integration

The Sol lead reused the previously settled OpenCode terminal only after Orca
proved its prior Dispatch completed. The terminal showed OpenCode 1.18.29,
`Build auto · GLM-5.3-Flash Z.AI Coding Plan`, from the verified invocation
`opencode --model zai-coding-plan/glm-5.3-flash --auto`. Run
`run_7b409d221a8a` supervised initial Task `task_628785b1ed30` / Dispatch
`ctx_78a2b0d5fe44`, root-review Task `task_1402172b896f` / Dispatch
`ctx_93a4537c9717`, and final consistency Task `task_f31fb082cb32` / Dispatch
`ctx_36c85d8b5258`. The same leaf session handled every correction; no second
leaf or nested delegation was used.

Final `worker-release` returned
`retained / external_terminal / processAction:none`, so no terminal was
force-closed, and delivery was acknowledged only afterward. The lead read the
runner and both reports, checked the retained screenshot, recomputed all
artifact digests, and independently reran only the final 19-test unit/CLI seam
suite plus read-only `--check`; it did not rerun Electron.

Root still owns the only next product change: call the accepted guard installer
from the actual preload entry, rebuild, and run this same `--execute` harness for
GREEN. A future GREEN must prove the exact descriptor, call the guarded close,
show the same page remains usable, and reject both assignment and
`defineProperty` replacement. This report is not authority to modify product
code, package the app, install it, or start a service.

- Audit closure remains **11/12 = 91.7%**, medium confidence, change **+0**;
  E5 publication/resources/services remain held.
- Test migration: source guard suite **1/1 accepted**; acceptance harness seams
  **19/19 GREEN**.
- Product fidelity: guard module **1/1 validated**, production main-world
  binding **0/1** and behaviorally RED.
- Next milestone: root wires the preload entry and reruns this same Electron/CDP
  acceptance for a real GREEN.
- Flexible 24-hour whole-product fidelity risk remains **high**; this closes one
  integration boundary, not the remaining audit capability or global parity.
