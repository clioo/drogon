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

## Still not proven

No full Orca suite run, no full test migration, no new rendered acceptance,
no package acceptance or new installation, no platform parity, and no new
Pi/Spark comparison occurred in this checkpoint. Passing the small rewrite
suite cannot substitute for the original product's full test obligations.
Packaging/bootstrap review concerns from the previous checkpoint still need
resolution; a green unit suite does not waive them.
