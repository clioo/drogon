# WP-UI-PRELOAD authority-recovery test-port wave

Source pin: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. This report covers the complete finite assignment of four original suites, not sample cases:

- `src/preload/close-active-tab-payload-admission.test.ts`
- `src/preload/browser-window-close.test.ts`
- `src/preload/ssh-authority-forwarding.test.ts`
- `src/preload/renderer-restart-wiring.test.ts`

The allocation manifest SHA256 is `e1ffc0deee15b2b8ae0a7a0ca91ef624384b3903d7c92f2606df423282e83d9a`. No product implementation, dependency or manifest change, installation, service, credential, public asset, recipe, global setting, commit, push, PR, or background service is part of this result. Existing candidate product files and the pinned source checkout were read only.

## Outcome

All **4/4 assigned original suites** are frozen under `tests/parity/ports/WP-UI-PRELOAD/authority-recovery/`, preserving **18/18 source cases**, **25 runtime `expect(...)` call sites**, **one `expectTypeOf(...)` probe**, and **31 total assertion evaluations**. No case or assertion was skipped. The aggregate source-to-contract index is `tests/parity/ports/WP-UI-PRELOAD/authority-recovery/assertion-binding-map.json`; per-case maps are beside each port.

Three parent-owned ports preserve the literal test bodies after a two-line provenance notice and import-only candidate path rewrites. Normalized comparisons against the pinned source were equal. The child-owned SSH port is byte-identical to source; both SHA256 values are `f404e56769d4ebd209972af64e5f263a5f4062bc2e3ca9fe7a60d573ea34da5a`.

No genuine candidate interface exists for any assigned suite. Candidate collection attempts for the three direct ports exited 1 before running a test. The frozen SSH run reported five import failures and one passing `expectTypeOf` case, but that type assertion is a runtime no-op; zero product assertions executed. These results are **binding/setup failures**, not behavioral RED, not GREEN, and not product parity.

## Source baseline, port validation, and candidate parity

These states are intentionally separate:

| Original suite | Cases / evaluations | Source baseline | Port validation | Candidate verdict |
| --- | ---: | --- | --- | --- |
| close-active-tab payload admission | 8 / 8 | 8/8 PASS in isolated pinned capsule | literal body, import-only rewrite | missing admission module; no tests |
| browser window close | 1 / 3 | 1/1 PASS in isolated pinned capsule | literal body, import-only rewrite | missing installation module; no tests |
| renderer restart wiring | 3 / 10 | 3/3 PASS in isolated pinned capsule | literal body, import-only rewrites | missing wiring/shared-event modules; no tests |
| SSH authority forwarding | 6 / 10 | **not established**; closure plan is explicitly non-executable | byte-identical | five `./index` setup failures plus one type-only runtime no-op; zero product assertions |

The source baseline therefore covers **3/4 suites and 12/18 cases**. It used the existing capsule runner from the rewrite checkout, Node 24.19.0, and the source-installed Vitest 4.1.11; exact pinned bytes were staged to fresh nonce directories under `.preflight/parity-baseline`. The three complete manifests have digests `ced5cb...`, `c8ea2c...`, and `09a799...`, and all returned exit 0 with zero failed or pending tests. Exact roots, receipt/result hashes, and candidate commands are recorded in `tests/parity/ports/WP-UI-PRELOAD/authority-recovery/execution-evidence.json`.

The SSH `source-baseline-plan.json` declares `executable: false`. Its listed files are only the directly exercised subset; the 205-line source preload index composes a larger `src/preload/api/` fan-in. Running that incomplete plan would turn missing closure into a setup failure, so it was not submitted to the capsule runner and no source PASS/RED is claimed.

## Preserved obligations

Close-active-tab admission is portable behavior: omitted input retains the legacy form, a nonempty source id is preserved exactly, and all six malformed table rows are rejected. The source type/module name is an architectural detail.

Browser-window-close installation is coupled to an Electron preload/page-world surface, but its observable safety contract is portable wherever an equivalent browser page surface exists: the installed close operation returns `undefined`, replaces the native closer, and cannot be overwritten with `Reflect.set`.

Renderer restart tests couple exact Electron IPC channels and DOM event names to the source architecture. Their portable lifecycle obligations are the relay effects, status passthrough, abort signals, checkpoint-before-install ordering, rethrow on invoke failure, and the fence that prevents install/prepared state after checkpoint persistence fails.

SSH forwarding couples `contextBridge`, `ipcRenderer`, the composed `api` global, and source `PreloadApi`/SSH/worktree type names to the current architecture. The portable behaviors are exact channel/argument forwarding, identity preservation for a complete authority pair, normalization of a partial compatibility authority to unknown, rejection of malformed full authority before renderer delivery, and the variable-form `listDetected` result union. The detailed map distinguishes its nine runtime expectations from the one compile-time type probe.

The current candidate `apps/desktop/src/preload/index.ts` exposes only `window.drogon: DesktopBridge`; it does not supply the source `api` global or SSH/worktree surfaces. Root owns whether these contracts are translated or exposed through reviewed new interfaces.

## Child orchestration and independent review

Orca Run `run_2e9a25ad3dfd` supervised the one authorized OpenCode leaf in the current checkout. A current `opencode --help` check confirmed per-invocation `--auto`, `opencode models opencode-go` listed `opencode-go/muse-spark-1.3-contributor`, and the fresh terminal `term_327bfcca-925c-47bb-87a3-d4904dfd7fd2` visibly showed `Build auto · Muse Spark 1.3 Contributor OpenCode Go` after launch with `opencode --model opencode-go/muse-spark-1.3-contributor --auto`. The OpenCode terminal transcript source was a provider fallback in the Orca reader, so this records the verified CLI/TUI route rather than claiming backend attestation unavailable from that reader.

Initial Task `task_96147e97e7e0` / Dispatch `ctx_dd3da0999525` produced an assertion map and a hybrid rewritten test. Parent review rejected the hybrid because its test-local structural types could drift from the source contract and because it counted the runtime-noop type probe too generously. The same leaf—not a second child—corrected the artifact under Task `task_4fd946122966` / Dispatch `ctx_6ccd74586fb1` to a byte-identical frozen source-relative port, nine runtime expectations plus one type probe, and a non-executable baseline plan.

The parent independently read the complete source and child artifacts, verified byte identity and both JSON files, and repeated the exact Node 24/Vitest 5 candidate run. That confirmed five `ERR_MODULE_NOT_FOUND` runtime cases, the single type-probe runtime no-op, and zero product assertions. The review run recreated an ignored `.vite` cache inside the child subtree, so the same leaf performed a final bounded cleanup under Task `task_d6a6168686c5` / Dispatch `ctx_4c6cb7e8f348`, updated its deviation record, and validated JSON without rerunning Vitest.

All three child Dispatches completed and sent `worker_done`; their deliveries were processed. Final `worker-release` returned `retained / external_terminal / processAction:none` because the OpenCode terminal was custom-created. The settled capability is revoked, the retained external terminal was not force-closed, and no `live` state is relabeled `exited`.

The child process deviations are retained rather than hidden: the initial child used manual read-only `git show/status/check-ignore` despite the no-Git instruction, staged an intermediate file through `/tmp`, and used shell file operations instead of `apply_patch`; no Git mutation or source-tree edit was observed. Its provider also performed automatic same-model retries after rate limiting, with no model/provider fallback. The rejected hybrid result is not acceptance evidence, and all ignored child-subtree `.vite` caches were removed.

## Gate status and next milestone

- Audit closure: **11/12 = 91.7%**, medium confidence, change **+0**. E5 publication/resources/services remain held.
- Test migration for this finite assignment: **4/4 suites frozen**, **3/4 source-baselined (12/12 cases in those suites)**, **0/4 candidate-bound**, **0/4 behavioral RED**, and **0/4 GREEN**.
- Product fidelity: **0/4 proven**; no candidate product assertion executed.
- Next closure milestone: root accepts these maps/ports, completes the missing SSH source closure if needed, and ratifies reviewed candidate preload/shared contract paths before implementation RED/GREEN work.
- Flexible 24-hour full-fidelity deadline risk: **high**; missing candidate interfaces and the incomplete SSH source closure leave no defensible full-parity ETA.
