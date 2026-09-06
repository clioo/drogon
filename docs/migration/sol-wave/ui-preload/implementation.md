# WP-UI-PRELOAD boundary implementation review

2026-09-06. Source pin `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.
This finite block implements the three source-baselined TypeScript preload
boundaries and their owned event/type/preparation closure. It does not modify
`preload/index.ts`, wire a live application path, install a package, start a
service, or establish packaged-app parity.

## Result

The nine new product modules are present at the root-ratified paths. The three
unchanged frozen candidate suites pass **12/12** with candidate Vitest 5.0.0 and
Node 24.19.0. Supplemental negative-path and ordering checks pass **21/21**,
for a combined **33/33 across five files**. Desktop TypeScript validation is
clean, the supplemental/frozen test TypeScript project is clean, and the
existing `apps/desktop/src` suite passes **75/75 across 13 files**.

This is a module-contract GREEN for the three implemented boundaries, not a
global GREEN. The live preload entry remains untouched, so none of the three
is yet proven through the packaged renderer/main integration.

## Source reuse and binding differences

Each reused module carries an in-file Lovecast Inc. MIT provenance comment with
the pinned source path and SHA256. Exact source and candidate digests are in
`implementation.json` and the leaf report.

The complete binding differences are:

1. Close-active-tab admission imports the one-field payload contract from the
   new bounded `shared/ui-command-event-types.ts`, rather than importing the
   source's large `preload/api/ui-command-event-api.ts` surface.
2. `ui-command-event-types.ts` contains only the source
   `CloseActiveTabPayload = { sourceId: string }`; the rest of the old UI API is
   intentionally not introduced.
3. `update-status-types.ts` reproduces the source `ReleaseChannel`,
   `DedicatedRepoChannel`, and `ReleaseBuild` shapes locally because the old
   release/update implementation is not ported in this block.
4. Formatting, condensed explanatory comments, and provenance headers differ;
   the runtime control flow and values are preserved.

The initial seam-only desktop typecheck passed before the runtime modules were
added. No stub implementation was used or left behind, so there is no
stub-stage behavioral RED to report. The earlier missing-module candidate
attempts remain setup failures, never RED.

## Preserved behavior

- Close-active-tab admission distinguishes legacy omission, valid nonempty
  source identity, and invalid payloads; it copies only `sourceId`.
- The browser close guard first defines a non-configurable/non-writable no-op,
  falls back to assignment, and remains non-throwing if both mechanisms fail.
- Restart preparation requests and awaits a claimed editor hot-exit backup but
  resolves immediately when no controller claims it.
- A dedicated checkpoint-failed event is distinguished from unrelated unload
  vetoes and generic restart abortion; its DOM-attribute failure reason is
  consumed and cleared.
- Durable checkpoint persistence completes before updater or app restart IPC,
  and persistence/IPC failures preserve the source abort and rethrow ordering.
- Updater error status and explicit quit/install abortion reset a prepared
  restart once; updater and app restart lifecycle event names remain distinct.

## Delegated completion and review

The Sol lead created the partial modules/tests and completed initial validation
before the user policy correction arrived. That correction was then followed
without undoing completed work: the remaining verification, test completion,
and leaf evidence were transferred exclusively to one depth-two OpenCode leaf,
Task `task_4743cedc95e9`, Dispatch `ctx_8e15a02ca424`. The actual launch was
`opencode --model zai-coding-plan/glm-5.3-flash --auto`; OpenCode 1.18.29 showed
`Build auto · GLM-5.3-Flash Z.AI Coding Plan`.

The leaf reviewed the existing nine modules, retained them unchanged, executed
the final gates, and wrote `leaf-implementation.md/json`. Focused lead review
recomputed all candidate hashes, parsed the JSON, and independently reran only
the three frozen suites (**12/12**) plus desktop typecheck (exit 0). It found no
product defect.

The first leaf report used read-only `git rev-parse`/`git status` despite the
explicit no-Git-command instruction. Those results are excluded from acceptance
evidence. The same leaf corrected only its reports under Task
`task_57e9c6db0603`, Dispatch `ctx_767afff4ac1b`, explicitly recording
`gitCommandsPerformed: true` and `gitMutations: false`, and replacing abbreviated
commands with the exact Node 24 executable. No test or product rerun occurred in
that correction. `worker-release` returned
`retained / external_terminal / processAction:none`; the terminal was not
force-closed, and both Dispatches are settled.

## Evidence and limits

The final executable paths were:

- Node: `/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`
- candidate Vitest: `apps/desktop/node_modules/vitest/vitest.mjs` (5.0.0)
- candidate TypeScript: `apps/desktop/node_modules/typescript/bin/tsc`
- cwd for every test/typecheck: `/Users/carlos/Documents/Drogon-rewrite`

Exact commands, results, candidate/source hashes, exploratory harness failures,
and count composition are recorded in `implementation.json`; full leaf evidence
is in `leaf-implementation.md/json`. No test used the read-only source checkout
as cwd.

Remaining integration belongs to root: wire the reviewed functions into the
existing dirty preload/main/renderer surfaces, add real IPC ownership at those
boundaries, and test the packaged path without weakening the module contracts.
SSH authority forwarding remains a separate unbaselined/open contract.

- Audit closure remains **11/12 = 91.7%**, medium confidence, change **+0**;
  E5 publication/resources/services remain held.
- Test migration for this finite block: **3/3 source-baselined suites**, **3/3
  candidate module-bound**, and **12/12 frozen cases GREEN**.
- Product fidelity: module behavior is proven for **3/3 boundaries**; live
  preload integration and packaged behavior are **0/3 proven**.
- Next milestone: root independently reviews and wires these modules, then adds
  integration-level RED/GREEN coverage without reopening the frozen contracts.
- Flexible 24-hour full-fidelity deadline risk remains **high**; this bounded
  GREEN does not supply a defensible whole-product parity ETA.
