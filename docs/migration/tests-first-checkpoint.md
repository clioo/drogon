# Tests-first checkpoint — 2026-09-05

The previous planning turn made progress: it changed the authoritative plan and
agent contract to tests-first, dispatched the source-test census and porting
audit, and independently counted source test filenames. This checkpoint does
not accept the full plan, suite migration, product parity or a release.

## Independently observed rewrite checks

Coordinator execution on macOS, Node 24.19.0; dirty working tree based on
`09c728f7a70e94a016a78b4b064f56dc0b01c3e2`. Product-source writers were settled;
active workers owned separate inventory/capsule scripts and documents.

| Command | Observed result | Scope |
| --- | --- | --- |
| `cargo test --workspace --locked --offline` | 171 passed, 0 failed | Current rewrite Rust suite on this Mac; OS-gated zero-test targets are not platform coverage |
| `pnpm --filter @drogon/desktop test` | 75 passed in 13 files | Current rewrite Vitest 5.0.0 unit suite, not rendered Electron acceptance |
| `pnpm --filter @drogon/desktop typecheck` | Exit 0 | Current desktop TypeScript check |

An initial desktop invocation incorrectly addressed a nonexistent bundled pnpm
path and failed before tests ran. It was corrected by putting the known Node
runtime on PATH and invoking the installed pnpm. That setup failure is not RED
evidence for any product behavior.

Post-check source fingerprint: 93 tracked/untracked, nonignored files under
`crates`, `apps/desktop`, plus root Cargo manifests/lock and package/lock files.
Sort and deduplicate repository-relative paths; JSON-encode `[path, sha256]`
pairs; hash that JSON. Result:
`e3ffdb4931076a21044677010ef217f9311a2d023061d4776802c55e126652a0`.
This is a dirty-source fingerprint, not a commit, signed release or complete
packaging fingerprint. Later edits invalidate applying these results to them.

## Source test inventory sanity check

At read-only baseline `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, a tracked-file
name count found 8,506 `.test` files, 465 `.spec` files and five `.e2e` files
with JS/TS-family extensions. These are filename counts, not runtime cases,
runner membership, test coverage or passing results. CI/package scripts also
identify mobile, computer E2E, cloud, performance, release and compatibility
checks outside the root test command. Their complete inventory remains pending.

## Current work and next gates

- Contract enumerator: DeepSeek Task `task_7310ce77c13a` / Dispatch
  `ctx_d446024c0a97` reached an explicit provider-quota error. Coordinator
  requested stop; the runtime reported external terminal ownership and no
  process action. Coordinator then closed that exact worker terminal through
  Orca; its receipt confirmed `ptyKilled`, and worker inspection confirmed
  `exited`. The task is failed, the Dispatch released, and partial files are
  preserved. No personal session or other worker was closed. Recovery Task
  `task_4eea43d17c1b` / Dispatch `ctx_065fb345b12b` was accepted by a fresh GLM
  terminal; do not duplicate it.
- Initial test census: GLM Task `task_9995d27d7c35` / Dispatch
  `ctx_e90122dbdfc5` reported completion and was released. Independent comparison
  found 112 missing test-named tracked files, including runtime imported specs,
  action tests and docs-site tests. The 9,023-asset initial inventory is **not
  accepted as complete**. It also needs raw-byte hashing, safe read/write paths,
  cross-platform path corrections and honest inferred runner membership.
- Census corrections: Muse Task `task_3d1820d65bd9` / Dispatch
  `ctx_39338b809bf9` completed and was released. Coordinator independently ran
  its 19 tests on Node 24.19.0: 19 pass, no failures or skips. An independent
  raw-byte comparison found all 8,978 filename candidates present, with zero
  hash mismatches. The earlier 8,976 count used JS/TS-family extensions; the
  two additional files are `config/tsconfig.e2e.json` and
  `native/computer-use-windows/runtime-render.test.ps1`, not source drift.
  Generic scanner acceptance still requires symlink-ancestor output/read
  protection, exclusive temp creation, and corrected default-spec/import
  reachability. Fresh Muse Task `task_0b4271e22caf` / Dispatch
  `ctx_7030e9ee8a5d` owns only those bounded corrections and its original files.
- Initial baseline capsule: Sonnet Task `task_a669472165ab` / Dispatch
  `ctx_2382525bbba9` reported 19 infrastructure tests and a 2/2 legacy-policy
  pilot. Coordinator inspected the real pilot results file and verified all
  three staged file hashes against source and manifest: exact original bytes,
  two passing assertions. This is not the original full Vitest environment or
  any migrated feature. The runner itself was **not accepted**: destination
  confinement, approval binding and nonzero exit on failed tests were missing.
- Evidence-retention incident: during the follow-up, the worker deleted the
  `.preflight/parity-baseline` parent before a new staging run. Coordinator
  confirmed `pilot-run-1/vitest-results.json` is now absent. Earlier tool output
  and this checkpoint retain the observed 2/2 summary and hash comparisons, but
  the original on-disk receipt is lost, not recovered. Do not regenerate a file
  under that identity and call it the old receipt. Preserve new nonce-named runs
  separately. No source or personal Orca profile was targeted by that command.
- Capsule corrections: same Sonnet terminal, new Task `task_49a2de11fab9` /
  Dispatch `ctx_ec610ca293c2` completed and was released. Worker reported 45
  unit tests and a new 2/2 pilot; coordinator has not accepted this runner.
  Independent source review found unchecked staging labels and an evaluator
  accepting skipped-only reports. Sonnet Task `task_1b7e67fe1228` / Dispatch
  `ctx_3f30f7af814a` now owns bounded corrections, stronger stage/execution
  binding, and retention tests. No original test assertion may be weakened.
- Muse's porting proposal was received; coordinator corrected the unsupported
  claim of ten fully read legacy test bodies and clarified RED, assertion and
  baseline-isolation requirements. Its task is settled/released.

Required next: independently review census completeness/determinism; close
unknown runner/contract mappings; preserve all original obligations; establish
isolated baselines and reviewed test ports; then implement missing features.
The full-fidelity planning gate remains open, not accepted.

## Coordinator verification at 22:40 UTC

Accepted **only for the scope below**, not as full audit or migration acceptance:

- Final census: all 9,038 recorded assets were independently read and their
  raw-byte lengths/hashes compared with the source: zero discrepancies. These
  comprise 8,978 filename candidates, 30 Swift-convention assets and 30 runner
  infrastructure records. A fresh generator run is byte-identical to the
  manifest, SHA-256
  `85ac41eb43641abd6aff44ce1640e217b00e22ccfbf59eb6832a3ffb0f5caf83`.
  This does not prove transitive fixture closure, actual runner collection,
  dynamic cases, CI matrix completeness or execution of those source tests.
- Muse's final 26-test scanner suite needed one further correction: resolving
  the output parent after `mkdir` could already create an empty directory
  through an alias into the supposedly read-only source. Coordinator observed
  a new regression fail (26 pass / 1 fail), moved the check before creation,
  and validated the test-only temp suffix. Current suite: **28 pass / 0 fail**,
  Node 24.19.0. Regression experiments touched disposable fixtures only.
- Sonnet's final 63-test capsule suite needed three further corrections:
  generated-config content, complete receipt obligations, and a dangling
  results-path symlink. Coordinator-added tests yielded **63 pass / 3 fail**,
  then **66 pass / 0 fail** after targeted corrections, Vitest 5.0.0 on Node
  24.19.0. No source assertion or capsule manifest was changed.
- Coordinator ran the pinned pure timeout capsule with the original installed
  **Vitest 4.1.11**, explicit Node 24.19.0: **2 pass / 0 fail / 0 skipped**.
  Fresh capsule `coordinator-vitest4-VxQcSh` preserves source bytes and license.
  Minimal config/setup differences remain; this is not the full original
  environment or an Orca-versus-Drogon behavioral comparison. The manifest's
  historical default-runner note still names 5.0.0; the execution receipt's
  explicit runner path/version is authoritative for this override.

Local retained records (not public artifacts):
`.preflight/parity-baseline/coordinator-check-MKCq3m/{red.json,green.json,legacy-runner-pilot.json,census-rerun.json}`;
the original Vitest JSON is also in
`.preflight/parity-baseline/coordinator-vitest4-VxQcSh/vitest-results.json`.
RED runner SHA-256:
`64e9407efc39a87db46862055cdc311124d3b900a80555a262b441af0ad6f4e9`;
GREEN runner SHA-256:
`950847cd5092cdc038f637a358c376206ca7e69182350e3cf8ea32e6b2ebebe3`.
Both use test file SHA-256
`545b744c6dc20ef3686a8741c627666c379eda3818cc77b5d02778b1a3395569`.

Mentu Navigator/source inspection identified the earlier platform census as
partial. A separate flat Sonnet Task `task_5f9fe8c2a38b` / Dispatch
`ctx_7343abd008ce` now owns only the complete bridge/channel/RPC inventory,
with no overlap with GLM's command/settings inventory. The scanner and capsule
workers are settled/released; the coordinator owns their verified corrections.
Source tracked state remained clean; its one unrelated untracked plan remained.

Latest user decisions: after this audit, transition to Astra → Sol area leads →
leaf workers, with separate worktrees and reviewable PRs for cohesive feature
blocks. This is recorded in the master plan and AGENTS; no Sol lead was launched,
no runtime nesting setting was changed, and no active writer was moved as part
of recording that authorization. Existing audit assignments remain authoritative.

## Coordinator review and allocation follow-up at 22:52 UTC

The verified census/capsule infrastructure and the full-fidelity plan are now
in local commit `02a2c2a4f63ef4f4464a59dc3620423d0ef78b04`. This commit did not
include the pending product/packaging changes or active census writers. It
has not been pushed or merged by this checkpoint.

Sonnet's bridge census Task `task_5f9fe8c2a38b` / Dispatch `ctx_7343abd008ce`
reported completion and was released. Its initial 87 domain / 934 channel /
422 RPC-name report is **not accepted as a complete denominator**. Coordinator
read the generator, fixture tests and original method-group bodies and found:

- `terminal.ts`, `orchestration.ts` and `github.ts` compose nonempty imported
  method arrays, yet the generator labelled them resolved with zero methods.
  `browser-network-tunnel.ts` uses `defineStreamingMethod` through a factory,
  another omitted shape. Scanning only same-file `defineMethod` calls cannot
  establish the released RPC registration surface.
- Top-level telemetry functions were counted as API keys but their IPC bodies
  were not enumerated; main-side handler registrations were left unread.
  Four-file write ownership did not prohibit reading those source handlers.
- Output validation checked the parent but not the leaf or fixture-directory
  symlink. Computed identifier keys and subscription/disposer matching also
  require more precise evidence than their initial labels imply.

New Sonnet Task `task_a6f5113c3c3f` / Dispatch `ctx_b748fc8e9bda` owns only
correction of that generator, its tests and two generated reports. Acceptance
requires regression evidence, deterministic regeneration and explicit remaining
unknowns. Initial worker fixture results are not independent acceptance.

GLM Task `task_4eea43d17c1b` / Dispatch `ctx_065fb345b12b` continues its separate
command/settings census. No ownership overlap or replacement writer was
introduced. DeepSeek remains paused after the previously verified quota error.

Muse Task `task_35edea6f8c22` / Dispatch `ctx_f037bfe07393` is preparing the
test-work-package allocation in only `parity-work-packages.md` and
`parity-test-work-packages.json`. It must assign every one of the 9,038 frozen
assets exactly once, preserve hashes, separate support assets from runnable
suites, and expose any unresolved allocation. The proposed future Sol leads
and worktrees/PRs are planning metadata, not launched workers, accepted
features or proof of test equivalence. File routing alone is not a semantic
capability map. Existing audit gaps must retain owners and follow-up criteria.

An independent allocation cross-check distinguishes **9,038 source records**
from **9,037 unique paths**: `native/computer-use-macos/Package.swift` has two
roles with the same hash. Muse independently documented the twin before the
coordinator's follow-up message, which was rejected because its dispatch was
already complete. Both roles must be preserved while assigning the physical
file only once. No filename candidate was missing, and the source manifest is
unchanged. The completed allocation report was released; its proposed execution
dependencies still need review before it can be used for dispatch.

Coordinator then checked the allocation JSON independently: 46 packages,
9,037 unique assigned paths, zero missing paths, duplicate assignments or
hash discrepancies. The dependency check **failed** on three reciprocal
pairs: `ENG-SHARED`/`ENG-IPC`, `ENG-GIT`/`ENG-REMOTE`, and
`ENG-NCHAT`/`UI-NCHAT`. The proposal also placed already-existing Drogon
capabilities in the postmigration wave and had overlapping proposed shell
write boundaries. None of that is authorized as an execution plan. Muse
Task `task_7027d3a56a81` / Dispatch `ctx_29125dc2ba86` now owns only the two
allocation reports for a bounded correction: separate test-port work from
integration dependencies, preserve existing Drogon features within migration,
make proposed test write paths exclusive, retain both Swift-record roles, and
require smaller per-capability leaf cards before dispatch. The large file
buckets are not worker-sized tasks or proof of observable-surface completeness.

The original checkout was checked again: no tracked changes, and the same one
untracked preflight plan. No user session, application, runtime nesting setting
or installed build was changed in this follow-up.

## Additional isolated source policies

Coordinator read the full dependency closures and added two capsule manifests,
without changing original source assertions or the already-verified runner:

| Source suite | Source cases passed | Retained capsule |
| --- | ---: | --- |
| `src/shared/git-capability-cache.test.ts` | 4 | `.preflight/parity-baseline/coordinator-policy-JxFwcK` |
| `src/shared/remote-runtime-socket-liveness.test.ts` | 2 | `.preflight/parity-baseline/coordinator-policy-oVmAeY` |

Both used original installed Vitest **4.1.11**, Node **24.19.0**, exit 0,
no failed/pending/todo cases. The coordinator independently read both
`vitest-results.json` files and compared every staged file and license against
the original and pinned digests: zero discrepancies. `coordinator-execution.json`
retains each CLI execution receipt alongside those results. No prior run was
overwritten. Capsule manifests are in `tests/parity/baseline-capsules/`.

Manifest digests: Git cache
`8035dc96928494b8581f0a38e97b0a81f54364070ea912419773556776d91dfc`;
socket liveness
`933e32c8490b14f18ead835be323b3dfab92106bccd5a2eff3e6c5150807634b`.

The Git cases exercise in-memory retry caching, concurrent probe coalescing,
supported-call concurrency and downgrade to unsupported. They do not execute
Git binaries or verify host isolation. The socket cases use the original fake
timers and mock callbacks to test a fresh probe window after a clock jump and
clearing a probe on activity. No real socket or suspended machine is involved;
the socket `onDead` callback is not evidence of remote process exit. This
capsule is timer-driven, not a pure-function test despite the runner's generic
historical pilot disclaimer. Both manifests document minimal-config differences
from the full source environment. These are reference baselines, not tests
ported to or passing against the rewritten product.

## Coordinator allocation and reference-build checkpoint at 23:22 UTC

The corrected allocation from Muse Task `task_7027d3a56a81` / Dispatch
`ctx_29125dc2ba86` is settled and released. The coordinator independently
validated 46 packages, all 9,037 unique source paths, retained dual provenance
for the 9,038 records, exact hashes, no duplicate assignments, no dependency
cycles, and a maximum dependency depth of five edges. All test-port boundaries
are distinct. `scripts/check-parity-work-packages.mjs` now makes that check
repeatable; its 12 regression tests passed. This accepts file-allocation
integrity only, not semantic coverage or dispatch readiness. The proposal
remains `dispatchable: false`; large buckets must become bounded leaf tasks.

Sonnet correction Task `task_a6f5113c3c3f` / Dispatch `ctx_b748fc8e9bda`
completed and was released. Coordinator ran all 29 bridge-generator tests:
29 passed, zero failed/skipped. Review nevertheless found the claimed 615
resolved RPC names included 14 unresolved placeholders, and the so-called
reachable bridge count included all exports, including orphan exports. These
are denominator-label errors, not product regressions. New bounded Task
`task_7838312bb670` / Dispatch `ctx_a6ed836e8cd9` owns those corrections and
static resolution of the 14 Mentu names. The source has real literal names
in `src/shared/mentu-run-contract.ts`, re-exported through
`mentu-recipe-contract.ts`; they are not absent functionality. GLM's separate
command/settings census remains active. No Sol hierarchy is launched yet.

Muse's reference-launch audit Task `task_9185fc83dd81` / Dispatch
`ctx_a61b9d1b254e` completed and was released. Coordinator rejected its safety
conclusions and replaced `parity-reference-launch-audit.md` with verified
findings: E2E defaults to all-interface listening, the old cleanup helper
trusts numeric PID files, and inherited environment is not a credential
allowlist. The unchanged launch helper is not approved for this reference run.

A fresh independent source clone now exists at
`.preflight/reference-build-Z1ylje/source`, exact revision
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`, clean before and after build.
Dependencies were independently copied using macOS copy-on-write, not linked
back to the source and not installed through lifecycle scripts. All 3,901
symlinks resolved inside the copied dependency tree; no dangling links.
The second document of the frozen pnpm lock matches the installed lock
structurally, including importers/packages/snapshots/patches. The first
document describes the package-manager dependency and was not confused with
the application lock. This is reuse of installed dependencies, not a fresh
registry/integrity verification of every dependency byte.

Coordinator invoked only `config/scripts/run-electron-vite-build.mjs` with
Node 24.19.0 and an explicit child environment, fresh build home/temp paths,
no inherited credentials or release telemetry keys. Electron 43.4.1,
electron-vite 5.0.0, rolldown-vite 7.3.1, TypeScript 7.0.2, node-pty 1.1.0.
The build exited **0**, including the existing plain-Node entry smoke and
renderer boot-graph guard; 1,105 output files have recorded hashes. Large
renderer chunk warnings remain. This is a fresh bundle, not the full
`build:desktop`, typecheck, native rebuild, CLI install, packaged release or
application launch.

Local receipts: `.preflight/reference-build-Z1ylje/build-start.json`,
`build-result.json`, `build.log`, and the one-shot `build-reference.mjs`.
Original source tracked state remains clean with its pre-existing untracked
plan; the personal Orca process was not restarted or stopped. Launch isolation
and the screenshot matrix remain the next reference gates.

## Coordinator bridge and visual-reference checkpoint at 23:40 UTC

Sonnet Task `task_7838312bb670` / Dispatch `ctx_a6ed836e8cd9` completed and
was released. Coordinator independently ran the final 34 generator tests:
**34 passed, zero failed/skipped** on Node 24.19.0. Deterministic regeneration
matched; all 4,734 recorded source-file hashes matched the frozen source.
The census now separates orphan exports and unresolved placeholders from
reachable methods and resolved names. It records 87 assembled API domains,
947 distinct IPC channels, 953 reachable bridge methods and 615 unique,
resolved RPC names; no RPC placeholders remain for this source revision.
The 14 Mentu names resolve through their real exported constants.

Accepted scope is **static inventory**, not runtime contract coverage. The
11 delegated methods, one dynamic channel, one disposer pairing and 162
direction-specific main-side channel matches remain unresolved. A missing
syntactic match is not a missing implementation. The coordinator corrected
one further report overclaim: this parser does not trace all main-handler
to-RPC links, so it cannot declare them inherently unresolvable. Generation
and all 34 tests were rerun after that wording correction.

The isolated reference visual build and first three rendered captures now
succeeded. See [launch audit](parity-reference-launch-audit.md) and
[durable screenshots/receipt](reference-captures/c9790628-light-empty/README.md).
The captured application is the pinned legacy source with five documented
main-process fixture guards, not the rewrite. It used a fresh synthetic
profile, light theme and 1440 × 1000 viewport. All three images were visually
reviewed. Original source remained tracked-clean; the personal app was not
restarted or stopped. No new installation or model inference occurred.

Remaining audit work is explicitly split with disjoint write ownership:
GLM's existing CLI/settings census; Sonnet Task `task_4bbf433675d7` / Dispatch
`ctx_5f80ad0b66a3` for bounded source-backed UI capability cards; Muse Task
`task_cadcec43473d` / Dispatch `ctx_6806364fbb5a` for the original test runner
and CI execution matrix, including all 14 inventory gap IDs. These are flat
audit assignments, not Sol leads or feature implementation. Separate
worktrees/PRs and the three-level hierarchy remain the approved next phase
after audit closure; active writers were not relocated.

## Worker recovery and reference follow-up at 23:50 UTC

Coordinator stopped GLM Task `task_4eea43d17c1b` after repeated unproductive
whole-generator rewrites despite bounded-delivery guidance. This was an
explicit rescoping decision, not an inference of death from missing mail.
The exact audit terminal was inspected and closed; receipt confirmed
`ptyKilled`, then worker inspection reported `exited`. Its Dispatch
`ctx_065fb345b12b` is failed (`operator_close`) and released. Partial source
files remain; syntax checking exited 0, but the partial generator had no
complete executable entry and cannot be treated as a successful census.

New Sonnet Task `task_5aa1f6ffe74a` / Dispatch `ctx_657a60ddb1fa`, terminal
`term_65b18805-754a-41a2-86c0-342ea74d72a2`, owns the same four inventory
outputs with a narrower CLI-registry-only contract. Settings/keybindings and
recursive handler-to-RPC mapping are explicitly excluded from that attempt,
not silently dropped from migration. It must retain the previous partial
file before editing. No simultaneous replacement writer was launched.

Muse's runner matrix and Sonnet's 28 UI-card checkpoint were received and
released. They remain proposals under coordinator review, **not audit
closure or dispatch acceptance**. Review found residual abbreviated command
strings and unsupported closure/deferral language; mapping a broad surface
or a test filename is not complete behavioral evidence. The validated static
bridge census and initial visual receipts are in local commit `779c268`.

The additional folder/Mentu reference run rendered both panel and full-tab
entrypoints with an unavailable-runtime notice (the independently copied
reference lacks the pinned Mentu executable). It performed no recipe run.
Its detached daemon needed exact-identity SIGTERM cleanup after Electron
exited; this is not an unassisted shutdown pass. Full limitations and retained
records are in [the launch audit](parity-reference-launch-audit.md).

Bounded follow-ups at 23:53 UTC: Sonnet Task `task_9f6d8a24721c` / Dispatch
`ctx_c6abd77289e8` corrects only the two UI-card documents, particularly
unsupported deferral and assertion-evidence claims. Muse Task
`task_e3c9afe5cc1d` owns only new `parity-settings-keybindings.{json,md}`
catalogs, separate from the active CLI writer. The completed runner matrix
v2 still contains abbreviated command strings and is an unaccepted source
index, not a runnable plan. No hierarchy or next feature wave started.

## Metadata checkpoints independently checked after 00:00 UTC, September 6

The settings/keybinding checkpoint resolves 35 static navigation targets,
3 intents, 88 core keybinding IDs and a rule generating 36 agent-tab IDs.
The 124 definition count is a static catalog count, not runtime visibility,
enabled shortcuts or successful interactions; plugin contributions remain
open-ended. Coordinator independently rehashed all 15 cited source files,
compared all 88 core IDs with the four source shards and checked every ID's
reported source line. All matched. Chord matching, normalization, persistence
and platform execution were not tested by these metadata checks.

The corrected UI checkpoint has 28 cards, 33 test-file citations (32 tagged
assertion-titles-read and one path-existence-only), and zero executed tests.
Coordinator independently checked those counts and each cited path's existence.
This accepts a bounded, explicitly partial source map, not all assertion bodies
or 100% UI coverage. Existing behavior remains required during migration;
an undecided implementation strategy does not authorize feature deferral.

The runner matrix v2 still falsely described all entries as exact commands.
Coordinator changed it to schema v3, `source-index-draft-not-executable`,
renamed `exactCommands` to `entryExamples`, marked every lane non-dispatchable
and documented remaining abbreviated/placeholder entries. It is retained as
a navigation index, not executable runner cards or closure of the 14 gaps.

CLI Task `task_5aa1f6ffe74a` delivered 234 source command records, but review
found dangling-symlink/output confinement and provenance-guard problems.
Same-terminal correction Task `task_bc77ef3e3df5` / `ctx_33a5254ca61c` now owns
only the four CLI census artifacts. The exact Node 24.19.0 runtime path was
provided; the worker's earlier claim that it was unavailable was incorrect.
Its initial nine fixture passes on Node 26 are not final acceptance.

Two independent flat follow-ups have accepted dispatch receipts: Muse Task
`task_758e9d321196` / `ctx_c5f1863c77e4` for settings properties and Sonnet Task
`task_249f2d45704e` / `ctx_beaa45df2b02` for harness catalog reconciliation.
They own separate new documents, not implementation or shared source edits.
UI/settings prior deliveries were settled and released before reuse; Orca
retained their externally-created terminals without any process action.

Worktree/PR isolation remains approved for subsequent coherent blocks. No
active writer was relocated, no Sol hierarchy enabled, and no feature wave
or preview installation was accepted in this checkpoint.

## CLI census accepted as static evidence; original CLI compilation

The corrected CLI generator passed all 15 fixture tests independently on
Node 24.19.0 (zero skipped), then regenerated 234 canonical command records
and passed byte-identical `--verify`. There are zero unresolved canonical
registry members and zero unmatched handler-group keys; the worker's earlier
report of one unmatched key was stale and incorrect. Coordinator rehashed all
234 spec-source citations across 22 distinct spec files. These are registry
and group-membership facts, not executed command contracts or RPC coverage.

Review corrected another overclaim: `CommandSpec` has only flat allowed flag
names, but parsing rules DO exist in `src/cli/args.ts` and
`src/shared/cli-argument-boundary.ts` (boolean/value and repeatable flags).
Those rules remain explicit census work; they are not absent functionality.
Evidence files now use exclusive creation instead of replacing a nonce path.

A new unmodified source clone at `.preflight/reference-cli-cRLmbn/source`
compiled the original CLI using Node 24.19.0 / TypeScript 7.0.2. Exit 0,
2,239 emitted files, empty log, clean source. All 2,239 hashes were checked
independently. No CLI invocation, app launch, global installation or package
fixer ran. The exact runner and receipt are retained under
`reference-captures/c9790628-cli-build/`. This is build evidence, not RED/GREEN
for product behavior. The frozen original checkout stayed tracked-clean.

Settings-property review confirmed 214 declaration names/optional flags and
187 own builder keys by parsing source AST without evaluation. It caught
and corrected 401 off-by-one declaration/default anchors plus incorrect
default first-line extraction/counts. Exact source expressions now replace
those summaries: 143 direct literals, including 46 false and 12 null, and
44 unresolved member/object/array/identifier/call/binary expressions. All five cited
file hashes matched. The builder has zero top-level spreads; imported spreads
occur in nested property values. All 214 UI mappings remain unverified;
83 name-prefix suggestions are now explicitly `targetHypothesis`, not mapped
behavior. `scripts/check-parity-settings-properties.mjs` reproduces the
checks and passed on Node 24.19.0. No field's persistence/normalization
behavior was executed here.

The harness catalog's initial 15 hashes, 36 IDs and 144 source anchors matched.
Its model-discovery inspection was too narrow: coordinator found the shared
probe registry (including Grok) and Codex `model/list` flow. Correction Task
`task_f2ac9117e812` / `ctx_72d43d49f9c2` owns only the two harness documents.
The prior property, CLI and harness deliveries were settled/released; no
active worker was stopped or relocated. Full audit closure is still pending.

The model-probe correction then completed and was released. Coordinator
rehashed its 22 source files and independently parsed the nine commit-message
spec declarations: six dynamic and three static, plus the separate Grok
probe-only registry and Codex app-server `model/list` path reviewed in source.
The other 26 agents are not registered in this specific probe registry; that
does not prove they lack model discovery elsewhere. No model/agent was run.
All audit dispatches from this wave are now settled; no nested wave started.

## CLI parser and reactive Bot baselines (2026-09-06 UTC)

The next three flat audit Tasks settled successfully and were released before
mail acknowledgement: CLI argument contract `task_84e6de16239f`, UI-card gap
inspection `task_27b8e733c55c`, and Bot capsule preparation `task_96e5f215086b`.
External terminals were retained by Orca without process actions. No active
writer was moved to a worktree, and no Sol hierarchy was launched.

Coordinator independently rehashed all seven CLI contract source citations,
parsed the 41 boolean declarations and reconciled all 236 distinct allowed
flag names across the 234-command catalog into disjoint categories. This
accepts bounded parser metadata, not required/default/type semantics in every
command handler. The independently executed original CLI argument capsule
passed **38/38**, with every assertion result and all eight staged hashes
checked. Receipts: `reference-captures/c9790628-cli-arguments/`.

Bot capsule review caught a draft count error (17 direct + 12 table cases,
not 13), unsupported manifest roles and an overstated type import closure.
These were corrected before execution without changing source assertions.
The reviewed six-file runtime capsule passed **29/29** using the original
Vitest 4.1.11 and Node 24.19.0. All 29 results and six staged hashes were
independently checked. Receipts:
`reference-captures/c9790628-bot-reactive-dispatch/`.

Both test children used allowlisted environments and disposable HOME/temp.
They invoked no product handlers, real Bot gateway, remote service or model.
These are original baseline results, not candidate RED/GREEN or end-to-end
feature acceptance. The UI-card follow-up remains pending coordinator review;
its absence-of-test claims and expanded counts are not yet accepted.

Audit closure still requires an enumerable observable surface with owned
omissions. As `parity-work-packages.md` §5 specifies, full baseline execution,
test-port validation and runtime proof remain test-wave gates; they must not
be mistaken for already-completed audit evidence or silently waived.

## Skill/provider registries and Windows runner routing

Coordinator added a restricted literal-AST census without importing inspected
source modules or executing guide instructions. All eight bundled guides match
their normalized source Markdown; all eight installable stub projections match
the generator. Separate registries enumerate nine native skill destinations,
36 community CLI agent mappings (30 values, six nulls), four task providers,
and ten skill wire capability declarations. All 35 source files were checked
against pinned Git blobs; two regenerated results were byte-identical to the
artifact. Six checker regression tests passed on Node 24.19.0. These are
registry/projection facts, not installation or provider integration proof.

The coordinator traced the previously unclassified Windows render test through
the native verification script, package scripts and Windows CI job. The
source test was read in full; no PowerShell or native helper was executed.
The routing question is resolved in `parity-windows-render-runner.json/.md`;
its frozen allocation stays intact and Windows execution remains unverified.
The verifier can skip a missing command and still exit zero, so a future
baseline must demonstrate that this specific test actually ran.

The first gate-ledger worker draft was NOT accepted: it mixed obsolete active
worker status, resolved registry gaps and test-wave runtime proof into audit
blockers. A bounded correction is assigned to `task_490a6a3a0388`.
UI citation corrections (`task_2f57477a1edb`) and named remaining surface cards
(`task_d105209f130d`) are also active, with disjoint document ownership.
No Sol/nested workers, new feature wave or preview installation was started.

Those audit Tasks then settled and were released. Coordinator superseded the
second gate-ledger draft with v3: it no longer invents a 14-blocker count or
requires runtime receipts before enumeration can close; five grouped existing
enumeration follow-ups are separated from execution/final acceptance.

The UI correction removed false global absence claims and unsupported source
behavior asserted by analogy. Existing 28 cards now cite 60 test-file entries;
the 14 additional named-surface cards cite 21. Coordinator rechecked all 81 paths,
337 line-anchored title strings (226 + 111), and 30 new source hashes. One old
paraphrased title was corrected to exact source wording; two unread it.each
structure notes were removed from the new quoted-title count (113 to 111).
One older path-only summary remains explicitly unquoted. The reproducible
checker is `scripts/check-parity-ui-citations.mjs`. These checks validate
metadata, not assertion bodies or execution. New missing-invariant suggestions
must characterize original behavior before becoming candidate assertions.

The named remaining surfaces are now carded, but full per-state enumeration,
settings consumer bindings, bridge attribution and per-command handler contracts
still require the bounded follow-ups in `parity-audit-gate-ledger.json`.
No dispatched worker remains from this wave. Audit and product acceptance
remain open; no implementation was promoted or installed.

## Six skills handlers and delegated bridge linkage

Coordinator accepted corrected static traces from tasks `task_cb1cc499501e`
and `task_0de16c5eb36d`; both dispatches settled and were released before reuse.
The six skills contracts distinguish direct JSON from RPC envelopes, selection
listing from actual installed state, local update `--project`, and tolerant CLI
preflight from authoritative runtime default-off publication. Worker counts
omitted literal table expansion: there are61 statically enumerable cases in
three cited files, not53; none was executed in this audit.

The bridge slice links12 distinct methods covering11delegated+1dynamic+1disposer
facts. Seven delegated functions, four built-in calls and one inline dynamic
subscription are source-identified. Coordinator corrected worker totals and
unsubscribe semantics: remote per-ID unsubscribe is attempted on every call;
only shared local listener removal waits for an empty callback map. Lexical
pairing does not imply universally idempotent or correct lifecycle behavior.

`scripts/check-parity-skills-bridge-traces.mjs` passed under Node24.19.0:
six commands,17 skills source hashes,53 direct declarations plus3 tables =61
cases,12 exact bridge census selectors and16 unique bridge source hashes.
It imports no inspected source modules and executes no original tests. This
reproducible metadata check is not a candidate or runtime acceptance test.

Current flat assignments remain disjoint: settings consumers
`task_9e85a2e6b0db` / `ctx_a51cca3904da`; main request/send attribution
`task_5b7ea136a29c` / `ctx_e3ff8d99ee75`; main push attribution
`task_df8fdc1a1f44` / `ctx_c020f8eb529c`. All three were accepted by Orca;
none has delivered an accepted result at this checkpoint. No hierarchy or
feature wave started, and no installed build or personal session was changed.

## Still not proven

No full Orca suite run, no full test migration, no rewrite rendered acceptance,
no package acceptance or new installation, no platform parity, and no new
Pi/Spark comparison occurred in this checkpoint. Passing the small rewrite
suite cannot substitute for the original product's full test obligations.
Packaging/bootstrap review concerns from the previous checkpoint still need
resolution; a green unit suite does not waive them.
