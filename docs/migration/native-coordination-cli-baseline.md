# Native Coordination CLI — Source Baseline (WP-ENG-RUNTIME)

Worker-produced baseline evidence for six selected orchestration-handler
source test families from the read-only legacy source
(`/Users/carlos/Documents/Drogon-mentu-session`, pinned
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`), executed in isolated,
hash-verified capsules under the source's own installed Vitest 4.1.11 and
Node 24.19.0. Root independently accepted the selected source baseline on
2026-09-07: 29 actual passed assertions, six matching entry files, zero
failed/pending/todo cases, successful execution receipts, all 846 staged
source/license references, 146 unique pinned source blobs, and every declared
third-party package file were checked. This is **not** candidate or
full-suite parity: six families are 6 of the 18
`orchestration*.test.ts` files under `src/cli/handlers/` at the pinned
revision (further orchestration-related tests exist in `src/cli/specs/`,
`src/cli/index-orchestration.test.ts`, `src/cli/orchestration-mutation-recovery.test.ts`
and `src/cli/runtime/`), and the assertions prove CLI flag→RPC mapping and
output formatting over a supplied mock transport, not real transport,
runtime-server, or process-spawning behavior.

## Result summary

| Family (source entry test) | Tests passed | Capsule root (`.preflight/parity-baseline/`) | Manifest approval digest (sha256) |
| --- | --- | --- | --- |
| `orchestration-check-identity.test.ts` | 3/3 | `native-coord-check-identity-Li4gRM` | `ab32e3865fcd677830a4c41f191b9b1b3ea34d367c211af96277ccc44bf7c7b0` |
| `orchestration-lifecycle-json-rejection.test.ts` | 1/1 | `native-coord-lifecycle-json-rejection-vsTGpF` | `10251527f86b0cc090bb8685295025044f7838c6395714bfa026d20277ba34eb` |
| `orchestration-request-show-cli.test.ts` | 3/3 | `native-coord-request-show-cli-cHGCVA` | `871514a4e6c8a24eface8124caee3a63dc59684c750a4b6e7c6f6e304c4e3b3c` |
| `orchestration-run-cli.test.ts` | 12/12 | `native-coord-run-cli-L7jA95` | `4a931fc3447e882fe12008955735e82d5ec0ee6e796bf47e9a464ed6c97b0122` |
| `orchestration-task-create-cli.test.ts` | 1/1 | `native-coord-task-create-cli-j1BDcS` | `8a96f4e1d249a98fbf3df7f49f18762983016c08a9fd67083801b4d1fd4beff7` |
| `orchestration-worker-cli.test.ts` | 9/9 | `native-coord-worker-cli-wmvFyz` | `0ce9120c3b1f8f4a9102201b83c8852f99fca812cc40c11e7781601ad46ef56c` |

**Total: 29/29 tests passed, 0 failed, 0 pending, 0 todo, across 6 files.**
Every capsule's runner report records `ok: true`, `problems: []`,
`exitCode: 0`, and `testCounts` matching the manifest's
`expectedTestCounts` (which itself was cross-checked against the static
`it()`/`it.each`-case structure of each pinned test file before staging).
All runs used `installedVitestVersion: vitest/4.1.11 darwin-arm64
node-v24.19.0` — the source project's own pin (`^4.1.11`), so the earlier
pilot's vitest 5.0.0 major-version compatibility gap does not apply to
these capsules.

Each capsule stages 140 first-party files (the entry test plus 139
transitive runtime modules) plus the source `LICENSE` (MIT, "Copyright (c)
2026 Lovecast Inc.", sha256
`ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3`),
re-verified at both staging and execution time against the pinned revision
blob and the working tree. Source assertions are unmodified: every staged
byte is digest-pinned to `git show c9790628…:<path>`.

## Recovery from the abandoned prior session

The prior GLM session (root-abandoned `ctx_db01ca2b3a99`, process visibly
exited with `zsh: killed`) left six manifests under
`tests/parity/ports/WP-ENG-RUNTIME/native-coordination-cli/source-baselines/`
and two capsule directories under `.preflight/parity-baseline/`. This task
did not reuse its lifecycle IDs and did not delete its evidence:

- `native-coord-run-cli-1uPjs7/` — stage-only capsule (no execution).
- `native-coord-run-cli-WvW5x8/` — executed capsule whose
  `vitest-results.json` records the preparation failure:
  `Cannot find module '../shared/cli-argument-boundary' imported from
  …/native-coord-run-cli-WvW5x8/src/cli/args.ts`, with
  `numTotalTests: 0` and `success: false`. **This was a staging/closure
  failure before any test ran — a preparation failure, not a behavioral
  RED.**

Both directories are preserved untouched. The original six partial
manifests remain local, uncommitted recovery evidence preserved verbatim under
`tests/parity/ports/WP-ENG-RUNTIME/native-coordination-cli/source-baselines/_original-partial-manifests-ctx_db01ca2b3a99/`.

## Closure correction: esbuild metafile, not an import regex

The prior manifests' `files[]` were computed with a hand-written import
regex and shared one identical 48-module list. That closure was wrong in
two independent ways:

1. **Multi-line import missed.** `src/cli/args.ts` imports
   `src/shared/cli-argument-boundary.ts` via a multi-line `import { … }
   from '../shared/cli-argument-boundary'`; the regex missed it, so every
   manifest that staged `args.ts` was missing that module. This is what
   failed the run-cli capsule above.
2. **Third-party runtime reachability missed.** The prior closure note
   claimed "no zod, ws or tweetnacl binding is reachable". The esbuild
   metafile shows the opposite: static `import-statement` edges from
   `src/shared/runtime-rpc-envelope.ts` and
   `src/shared/runtime-environments.ts`,
   `src/shared/mobile-relay-pairing-offer.ts`,
   `src/shared/ephemeral-vm-recipes.ts` (→ `zod`),
   `src/shared/remote-runtime-request-socket.ts`,
   `src/shared/remote-runtime-subscription-outbound.ts`,
   `src/shared/remote-runtime-subscription-transport.ts` (→ `ws`), and
   `src/shared/e2ee-crypto.ts` (→ `tweetnacl`) are all runtime-reachable
   from each entry test through the orchestration handler aggregator and
   runtime-client chain. Without these packages loadable, every capsule
   would fail at module load.

The corrected closure was computed with the legacy source's own installed
esbuild 0.25.12 (`tooling:` `.preflight/closure-tools/compute-closure.mjs`,
evidence: `.preflight/closure-tools/closure-report.json`): bundle the entry
test (platform node, format esm, `vitest` external), take all `src/**`
metafile inputs (type-only imports are erased by the TS transform exactly
as at runtime; `.js` specifiers resolve to their `.ts` files), add any
`vi.mock('<literal>')` targets (all resolve to modules already in the
static closure), and iterate to fixpoint. Result: 140 first-party files per
entry; every other input is a `node:` builtin, `vitest` itself, or one of
the three pinned packages below. No `import.meta.glob` and no non-literal
`vi.mock` exists in the closure (both would have been refused).

The three packages are pinned in each manifest's `transportRuntime`
declaration and staged by the existing runner as verified junction links
into the source's already-installed `node_modules` (read-only; nothing
copied or installed), with `WS_NO_BUFFER_UTIL=1` and
`WS_NO_UTF_8_VALIDATE=1` so ws's optional native peers stay outside the
pinned closure:

| Package | Version | Tree sha256 |
| --- | --- | --- |
| ws | 8.21.3 | `aad13c0d5b988c454b067e8f6d9d0e8ed938293ec60989a2207cf8614ef9a4a0` |
| tweetnacl | 1.0.3 | `79d76ce10a07a02d66cba99b0f11b00724e8095e0a5004ed62c8bc2f43183793` |
| zod | 4.5.4 | `8675df81babc63b169f49743e654198f574342b364a9bf831eb39f4e881ba63f` |

## Method (existing runner, unmodified)

`scripts/run-parity-baseline-capsule.mjs` (covered by its own 63-test unit
suite, per `docs/migration/parity-baseline-capsule.md`) staged each
manifest — verifying the source HEAD revision, every file digest against
both the working tree and the pinned revision blob, and no symlinked path
components — into a fresh `mkdtemp` capsule, wrote a stage receipt binding
the stage-time manifest digest, then executed with an explicit approval
digest and `--vitest-entry` pointed at the source's own
`node_modules/vitest/vitest.mjs` (4.1.11), `--node-bin` the provided Node 24
runtime. Vitest ran with the capsule as cwd/root via the generated minimal
`vitest.config.mjs`; results JSON landed inside each capsule. Exact
invocation (per family):

```
NODE24=/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
node scripts/run-parity-baseline-capsule.mjs \
  --manifest tests/parity/ports/WP-ENG-RUNTIME/native-coordination-cli/source-baselines/<family>.manifest.json \
  --source-root /Users/carlos/Documents/Drogon-mentu-session \
  --execute --timeout-ms 120000 \
  --node-bin "$NODE24" \
  --vitest-entry /Users/carlos/Documents/Drogon-mentu-session/node_modules/vitest/vitest.mjs \
  --approved-manifest-sha256 <digest from the table above>
```

Runner reports (stage file lists, digests, counts) are retained at
`.preflight/closure-tools/run-reports/<family>.json`. **Hash validation
alone is not test execution** — the per-capsule `vitest-results.json` and
runner reports above are the execution evidence; the approval digest is a
tamper/drift binding, not proof of independent review.

## Per-source-case map

### `orchestration-check-identity.test.ts` — 3/3 (identity)

- *carries the caller pane key when the environment handle may be stale* —
  `orchestration check` sends both `terminal` (env handle) and
  `terminalPaneKey` (env pane key) and does not consult the
  terminal-handle selector when a pane key is present.
- *keeps an explicit legacy terminal handle scoped to that handle* — an
  explicit `--terminal` overrides the env handle and sends
  `terminalPaneKey: undefined`.
- *preserves the pinned legacy `--inject` check signature* — `unread` +
  `inject` flags pass through to the `orchestration.check` RPC payload
  unchanged.

### `orchestration-lifecycle-json-rejection.test.ts` — 1/1 (negative)

- *prints a rejected lifecycle verdict as a JSON failure envelope* —
  `orchestration send` whose lifecycle verdict is rejected
  (`sender_not_assignee`) prints `ok:false` with the runtime's own `code`
  and `reason` rather than a generic error.

### `orchestration-request-show-cli.test.ts` — 3/3

- *asks the runtime without sending a mutation request id* — `request-show`
  is read-only: no mutation-request id is sent.
- *renders the state and the honest reading of it* — output renders the
  returned state plus its explicit interpretation.
- *names the version gap when the server predates the command* —
  `method_not_found` converts into an actionable `incompatible_runtime`
  version-gap error (negative-path compatibility behavior).

### `orchestration-run-cli.test.ts` — 12/12 (10 `it` + one `it.each` with 2 cases)

- Run lifecycle flag→RPC mapping: `run-create` resolves the coordinator
  terminal (`ORCA_TERMINAL_HANDLE`); `run-use`/`run-current` share the
  explicit binding path; pagination flags forward; bounded pagination is
  the default; legacy takeover passes only when requested.
- Reset scope parsing (negative parser behavior): a bare `reset` rejects
  with `invalid_argument` before any RPC; `--tasks` and `--all` map to
  exactly one scope each; the `it.each` table rejects two combinations of
  multiple scopes (`{tasks,messages}` and `{all,tasks}`) before calling
  the runtime.
- Task-list brief output: server-side brief is requested and falls back
  client-side for older runtimes; server-abbreviated rows pass through
  untouched.

### `orchestration-task-create-cli.test.ts` — 1/1

- *passes PowerShell-stripped deps through to the runtime* — deps are
  quote-stripped for PowerShell, optional fields are `undefined`, the
  caller terminal handle comes from `ORCA_TERMINAL_HANDLE`, and the second
  RPC call carries the `taskCreate` payload.

### `orchestration-worker-cli.test.ts` — 9/9 (worker contract + negative)

- *passes the complete supported creation contract and retry receipt*.
- *capability-gates and forwards per-invocation launch preferences* /
  *fails before worker-start when the runtime would strip launch
  preferences* (negative: refuses rather than silently degrade).
- *sets an unsuccessful exit code for failed and unknown receipts*
  (negative receipt semantics).
- *prints the Structured Chat recovery action for a refused worker start*;
  *prints a reveal warning for a live background worker*; *prints the
  retained-process warning for a manual worker-stop* (worker lifecycle
  output semantics: a retained/external process is reported, never claimed
  exited).
- Worker output paging: *allows the initial zero cursor*; *passes opaque
  source-pinned cursors and explicit source selection*.

## Uncovered semantics (honest gaps)

- **Mock seams.** All six families inject `client: { call: callMock }` and
  `vi.mock` `../format`/`../selectors` at the CLI→transport and CLI→console
  seams (the source tests' own substitutions, staged unmodified). These
  tests therefore prove flag→payload mapping and printed-output shaping,
  **not** real `RuntimeClient`/ws transport behavior, real runtime-server
  semantics, real console formatting (mocked), or real child-process
  spawning. `ws`/`tweetnacl`/`zod` are staged, load, and (for zod schema
  modules) partially execute during import, but their network/crypto
  behavior is not asserted by these families.
- **Not executed here:** the other 12 `orchestration*.test.ts` handler
  files at the pinned revision (`orchestration.test.ts`,
  `orchestration-gate-cli`, `orchestration-timeout`,
  `orchestration-timeout-cli`, `orchestration-windows-ask-cli`,
  `orchestration-worker-show-wait-cli`, `orchestration-send-receipt-warnings`,
  `orchestration-lifecycle-rejection`,
  `orchestration-federated-legacy-settlement`,
  `orchestration-legacy-read-only`, `orchestration-migration`,
  `orchestration-module-boundaries`) plus orchestration-related tests in
  `src/cli/specs/`, `index-orchestration.test.ts`,
  `orchestration-mutation-recovery.test.ts`,
  `runtime/orchestration-recovery-command.test.ts`, `args.test.ts` and the
  rest of the CLI suite. A passing capsule says nothing about those.
- **Platform paths.** Windows/WSL modules
  (`windows-command-line`, `windows-terminal-shell`, `wsl-paths`,
  `powershell-native-argument`) are staged and load, but no Windows/WSL
  behavior is asserted on this darwin host beyond the quote-stripping
  mapping assertions above.
- **Timers/keepalive.** `check-keepalive.ts`/`timer-delay.ts` are in the
  closure but no keepalive timing is exercised; the capsule uses Vitest
  default timeouts (source sets 30s/60s for its heavier suite).
- **Environment deltas** remain as documented per manifest in
  `sourceVitestConfigDifferencesFromCapsule` (no `ORCA_FEATURE_WALL_ENABLED`
  define, no source setupFiles, no execArgv flags) — none reachable from
  these pinned files, but each additional capsule still needs its own
  dependency/effect review.

## Evidence index

- Manifests (corrected): `tests/parity/ports/WP-ENG-RUNTIME/native-coordination-cli/source-baselines/*.manifest.json`
- Original partial manifests (preserved): `…/source-baselines/_original-partial-manifests-ctx_db01ca2b3a99/`
- Per-capsule execution evidence: `vitest-results.json`, `stage-receipt.json`, `vitest.config.mjs` inside each capsule root listed above (gitignored, retained)
- Runner reports: `.preflight/closure-tools/run-reports/*.json`
- Closure tooling + report: `.preflight/closure-tools/compute-closure.mjs`, `compute-transport-declaration.mjs`, `generate-manifests.mjs`, `closure-report.json`, `last-run.log`
- Prior failed capsules (preserved, untouched): `.preflight/parity-baseline/native-coord-run-cli-1uPjs7/`, `.preflight/parity-baseline/native-coord-run-cli-WvW5x8/`
- Runner under test: `scripts/run-parity-baseline-capsule.mjs` (unmodified), documented in `docs/migration/parity-baseline-capsule.md`

## Suggested next steps (coordinator-owned)

1. Review/accept these six capsules as the first native-coordination-cli
   baseline wave (or name required corrections).
2. Scope the remaining orchestration-handler families (12 handler files +
   specs/index/runtime orchestration tests) into follow-up baseline batches.
3. The rewritten Rust CLI should target the behaviors captured in the
   per-source-case map above, with the uncovered-semantics list used to
   plan its own real (non-mock-only) contract tests.
