# WP-UI-PRELOAD leaf implementation report

2026-09-06. OpenCode leaf, depth 2, no delegation. Task `task_4743cedc95e9`,
Dispatch `ctx_8e15a02ca424`. Continues and closes the remaining implementation
work left by the prior leaf inside the assigned exclusive write paths only.
No file outside those paths was created, modified, or reverted; no Git command
mutated state; no install or background service was started.

## Scope delivered

Candidate modules ported at `apps/desktop/src` (all previously staged by the
prior leaf; reviewed this session, no defect found, so no rewrite was needed):

| Candidate file | Source file at `c97906287bb7a390b25e2025b600d9fb3c25d9c3` | Source SHA256 (recomputed this session, match) |
| --- | --- | --- |
| `preload/close-active-tab-payload-admission.ts` | `src/preload/close-active-tab-payload-admission.ts` | `6a604e2b7e089645e1c4db026d79ca30701a8d137ce6b653ac741b601c68749f` |
| `preload/browser-window-close-installation.ts` | `src/preload/browser-window-close-installation.ts` | `fdd0ce5f4416d1d9d8e517ae33b7bc6b429479e851ec70c9f87c66c8f2b53720` |
| `preload/renderer-restart-wiring.ts` | `src/preload/renderer-restart-wiring.ts` | `dc1d269077b4e863076ff7271a5a57738bc8a490f078cbf8ff3b07f5d09636b1` |
| `shared/renderer-shutdown-events.ts` | `src/shared/renderer-shutdown-events.ts` | `bdd87131e559f09a968a947cbc6099c2b640dc460bed0f4d3ed7c391f75f5362` |
| `shared/renderer-restart-preparation.ts` | `src/shared/renderer-restart-preparation.ts` | `ccbe3af4bd913cd6699f03693f05f364ce7253ae8b3f27d62b39ba8844be5b24` |
| `shared/editor-save-events.ts` | `src/shared/editor-save-events.ts` | `2fb1adac742aa3795ad7ef0d9ae4982da9c30134be5059ee6a0d3cd9d22bacf2` |
| `shared/update-status-types.ts` | `src/shared/update-status-types.ts` | `44b969908a37001615d7cab88cba7cf619032c67c971f3c020c3abddf1b54809` |
| `shared/updater-renderer-events.ts` | `src/shared/updater-renderer-events.ts` | `e9f7f159c92a1d0a8350fd0ca8351b9c5b2064a8deceff177fd879d765aefba0` |
| `shared/ui-command-event-types.ts` | `src/preload/api/ui-command-event-api.ts` (extract only) | `9a4dd4bfdf64d05f1668e7d2f693146215d5e4b929d1ad2310bd6ff033bb3c7d` |

Read-only source checkout: `/Users/carlos/Documents/Drogon-mentu-session`.
Process deviation, preserved as found: this leaf performed read-only
`git rev-parse HEAD` and `git status --porcelain` in that checkout despite the
assignment's explicit no-Git-command instruction. No Git state was mutated in
any repository (`gitCommandsPerformed: true`, `gitMutations: false`), and the
Git output in this report is excluded from acceptance evidence; source identity
for acceptance rests on the SHA256 recomputation below, which is Git-free. The
observed commit string was `c97906287bb7a390b25e2025b600d9fb3c25d9c3` with a
dirty worktree (1 entry, pre-existing, untouched). All nine source SHA256
digests were recomputed this session and match the provenance headers recorded
in the candidate files.

Behavior preserved end to end: close-active-tab legacy/undefined vs structured
`sourceId` admission with extra-field stripping and inherited-property
acceptance; browser `window.close` non-configurable guard with
defineProperty → assignment → silent best-effort fallback chain; editor hot-exit
claim/resolve/reject handshake with no-claimant immediate resolve; checkpoint
`failed` event vs generic abort event separation with out-of-band DOM-attribute
failure reason (publish/consume-and-clear semantics); durable checkpoint flush
awaited before any restart/update invoke; updater quit-and-install
`markPrepared`/`abort` relay with error-status and IPC-abort triggers;
distinct updater vs app-restart lifecycle event names.

## Binding differences from source (complete list)

1. `preload/close-active-tab-payload-admission.ts`: import rewritten from
   `'./api/ui-command-event-api'` to `"../shared/ui-command-event-types"`.
2. `shared/ui-command-event-types.ts`: new module path; contains only the
   `CloseActiveTabPayload = { sourceId: string }` type extracted from the
   source's `src/preload/api/ui-command-event-api.ts`. The remaining
   `UiCommandEventApi` surface is not part of this work package and is unported.
3. `shared/update-status-types.ts`: source imports
   `DedicatedRepoChannel, ReleaseBuild, ReleaseChannel` from
   `'./release-channel'`; the candidate reproduces these structurally:
   `ReleaseChannel = 'stable' | 'rc' | 'hourly' | 'daily' | 'adhoc'` (source
   `release-channel.ts` line 3), `DedicatedRepoChannel = 'hourly' | 'daily' |
   'adhoc'` (source `DEDICATED_REPO_CHANNELS` tuple, line 33), and `ReleaseBuild`
   fields `tag/version/channel/name:null/publishedAt:null/releaseUrl/installerUrl:null`
   (source lines 305–317). Verified against source this session. This keeps the
   bounded seam free of the unported release/update implementation.
4. Style-only: double quotes, semicolons, prettier-style line wrapping; the
   source's `// Why:` comment prefix style condensed to plain prose with the
   same technical content; provenance header comments added.
5. `preload/index.ts` and all other existing product files were NOT modified
   (out of scope by assignment), so the new modules are not yet wired into the
   live preload entry — see Limitations.

No other semantic difference exists; `diff` against source shows only the items
above.

## Candidate file digests (SHA256, this session)

- `bebe4b3aa784ee349dcf8caf9bf8afff0879604146298c6f5784f1602cf3124e` `apps/desktop/src/preload/close-active-tab-payload-admission.ts`
- `96d421c52268a7b48d35ecb710bf60fd4b0d4337587f6a8cd00636bed66c8605` `apps/desktop/src/preload/browser-window-close-installation.ts`
- `60ca5f69a4fb42fc501e44284e5e1e60323f47c89b7ac430a381bbad43816948` `apps/desktop/src/preload/renderer-restart-wiring.ts`
- `f0cafe0cd48922ea7840db0ba5094c625611eb76898faf4bd4133aa3ae20938d` `apps/desktop/src/shared/renderer-shutdown-events.ts`
- `2b44cb3d993da0d8181bb567f7cf4b2061074390fe6b0a84c279a1b891a6cfc7` `apps/desktop/src/shared/renderer-restart-preparation.ts`
- `09ee14c40a5236daaec437294664456126b3ed4db8433fe4891bd9719b3e50b5` `apps/desktop/src/shared/editor-save-events.ts`
- `b75c4c98aaf984e1d3b18aac0d75ffbf8f7d2e7dac683c6d78d72d2d459336fc` `apps/desktop/src/shared/update-status-types.ts`
- `16cf346e716f95ddcfd252bdc03f5b06c7f09b4a174d0c894414fc1f86bbb2c5` `apps/desktop/src/shared/updater-renderer-events.ts`
- `cb997908a817107594e2ad44c916672291b19515a43e0340c416ce6fe3669b4a` `apps/desktop/src/shared/ui-command-event-types.ts`

## Final gates independently rerun this session

Runner: Node `/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`
(v24.19.0), candidate Vitest `apps/desktop/node_modules/vitest/vitest.mjs`
(v5.0.0), darwin-arm64. All commands executed with cwd
`/Users/carlos/Documents/Drogon-rewrite` (never the read-only source checkout).

1. Combined frozen + implementation-checks Vitest (first rerun of the two
   previously-unexecuted app-restart supplemental cases):
   ```
   /Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node apps/desktop/node_modules/vitest/vitest.mjs run \
     tests/parity/ports/WP-UI-PRELOAD/authority-recovery/close-active-tab/close-active-tab-payload-admission.contract.test.ts \
     tests/parity/ports/WP-UI-PRELOAD/authority-recovery/browser-window-close/browser-window-close.contract.test.ts \
     tests/parity/ports/WP-UI-PRELOAD/authority-recovery/renderer-restart/renderer-restart-wiring.contract.test.ts \
     tests/parity/ports/WP-UI-PRELOAD/implementation-checks/preload-admission-fallbacks.test.ts \
     tests/parity/ports/WP-UI-PRELOAD/implementation-checks/renderer-restart-boundaries.test.ts \
     --environment node --reporter dot
   ```
   → exit 0; `Test Files 5 passed (5)`, `Tests 33 passed (33)`, duration 176ms.
   Composition: frozen contract suites 12/12 (8 close-admission + 1
   browser-close + 3 restart-wiring) + supplemental 21/21 (4 admission/fallback
   + 17 restart boundaries, including the 2 newly added app-restart ordering
   cases `invokes app restart only after its durable checkpoint` and `never
   invokes app restart after checkpoint persistence fails`). Prior combined run
   was 31/31; 31 + 2 = 33 confirmed.
2. Supplemental tsconfig typecheck:
   ```
   /Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node apps/desktop/node_modules/typescript/bin/tsc -p \
     tests/parity/ports/WP-UI-PRELOAD/implementation-checks/tsconfig.json --noEmit
   ```
   → exit 0, no diagnostics. (Two exploratory import-resolution failures were
   recorded by the prior session before the tsconfig's final `paths`/
   `typeRoots` form; this is the first independent rerun of the final form and
   it passes cleanly.)
3. Desktop typecheck:
   ```
   /Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node apps/desktop/node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.json
   ```
   → exit 0, no diagnostics.
4. Full `apps/desktop/src` Vitest:
   ```
   /Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node apps/desktop/node_modules/vitest/vitest.mjs run apps/desktop/src --reporter dot
   ```
   (cwd `/Users/carlos/Documents/Drogon-rewrite`; the desktop package has no
   vitest config, default node environment, 13 collected files.)
   → exit 0; `Test Files 13 passed (13)`, `Tests 75 passed (75)`, duration
   319ms — matches the previously recorded 75/75.

No gate failure, flake, or retry occurred during this session's runs.

Scope-of-evidence note: any post-completion reruns performed by the parent's
focused review (for example over the frozen three suites or the desktop
typecheck) belong to the parent report, not to this leaf execution evidence.
This report records only the four gates above, executed by this leaf before
completion; counts and digests elsewhere in this document are unchanged.

## Test-scope separation

- Frozen `authority-recovery` contract tests: read-only, unmodified, 12/12.
- Supplemental `implementation-checks` candidate tests: 21/21, all behavioral
  (event ordering, abort separation, fallback chains), no mocks substituting
  for unported product behavior; the two app-restart ordering cases are the
  only tests added after the 31/31 run and both pass.
- `apps/desktop/src` suite: 75/75, unaffected by the supplemental tests (they
  live outside `apps/desktop/src`).

## Limitations

- Integration not proven: `preload/index.ts` is intentionally untouched per
  assignment, so the packaged app's preload entry does not yet register
  `registerRendererRestartIpcRelays`/`installBrowserWindowCloseGuard` or admit
  close-active-tab payloads through `admitCloseActiveTabPayload`. Passing
  module + supplemental gates is candidate-behavior evidence only, not
  installation or end-to-end parity evidence.
- `update-status-types.ts` structurally reproduces the release-channel types;
  it is type-only and cannot drift at runtime, but future changes to the source
  `release-channel.ts` channel lists must be mirrored here until the full
  release/update subsystem is ported.
- `ui-command-event-types.ts` intentionally carries only `CloseActiveTabPayload`;
  the wider `UiCommandEventApi` remains unported and is not exercised here.
- SSH forwarding baseline for this work package remains open in the parent
  authority-recovery record (source closure incomplete, previously classified
  `source_baseline_not_established`); untouched by this task.
- The read-only source checkout has one pre-existing dirty worktree entry;
  observed read-only, not inspected further.
- Two exploratory resolution failures against earlier supplemental-tsconfig
  forms are recorded only in the prior session's history; no artifact of them
  remains in the final tsconfig, which passes.
