# ENG identity/lease original-source baselines

Status: **admitted for all three assigned original suites** at source revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. The admitted executions contain 3 suites, 7 original cases, 18 original assertion evaluations, 0 failed cases, and 0 pending/todo cases. This is original-source baseline evidence only; it is neither candidate parity nor an integrated product result.

The machine-readable record is `docs/migration/sol-wave/eng-identity/source-baselines.json`. Its three manifests and dependency evidence are under `tests/parity/ports/WP-ENG-RUNTIME/identity-leases/source-baselines/`.

## Admission result

| Original source suite | Source SHA-256 | First-party runtime closure | Admitted result | Retained nonce stage |
| --- | --- | ---: | --- | --- |
| `src/main/runtime/agent-session-claim-identity.test.ts` | `d4d84f3cc3f85b03347a0d645e8672997710cb58afb55797e305839bfe3fe28d` | 10 files | 3/3 passed | `.preflight/parity-baseline/eng-identity-claim-20260906-a1-vkr7Zn` |
| `src/main/runtime/agent-session-lease-renewal.test.ts` | `901b96b322a1f040fe6dd037fd4ab0d12de9b6210ba982485a4c3800155d530d` | 38 files | 2/2 passed | `.preflight/parity-baseline/eng-identity-lease-20260906-a2-wBfJh5` |
| `src/main/runtime/agent-session-provider-handle-transition.test.ts` | `90affd020385be83ca5fe351272219710d4734f1bee163ff1085a6e9345138f1` | 5 files | 2/2 passed | `.preflight/parity-baseline/eng-identity-provider-20260906-a1-p6nXh6` |

The manifests contain the complete per-suite runtime source closure and a SHA-256 for every source file and the upstream MIT license. There are 53 manifest entries including overlap, 43 unique first-party files. Closure discovery used the source-installed esbuild in read-only `bundle: true`, `write: false`, `platform: node`, `packages: external` mode; every resulting file and effect surface was then reviewed before execution. Type-only imports are not runtime closure because Vitest/esbuild erases them.

The capsule runner rechecked the pinned source revision and each working-tree and pinned-revision blob, copied the exact bytes to rewrite-side nonce directories, and re-verified the staged bytes before launch. Its generated config keeps `environment: node` while omitting source-wide DOM setup, feature define, GC/Web Storage flags, and broad-suite timeouts that these closures do not use. All executions explicitly used:

- Node: `/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node` (`v24.19.0`)
- Vitest entry: `/Users/carlos/Documents/Drogon-mentu-session/node_modules/vitest/vitest.mjs` (`vitest/4.1.11 darwin-arm64 node-v24.19.0`)
- command cwd: `/Users/carlos/Documents/Drogon-rewrite`

The source checkout was never a runner cwd.

## Rejected setup attempt kept distinct

The first lease capsule, retained at `.preflight/parity-baseline/eng-identity-lease-20260906-a1-Jx9Z01`, staged all 38 first-party files successfully but exited 1 before collection: 0 tests, 1 failed suite, `Cannot find package 'proper-lockfile'`. This is a setup failure, not behavioral RED and not an admitted baseline.

The admitted lease retry uses the task-owned `run-lease-baseline.mjs` to compose the existing reviewed capsule runner with its existing generic package-link helper. Before staging and after execution, it verifies the complete resolved trees of `proper-lockfile@4.1.2`, `graceful-fs@4.2.11`, `retry@0.12.0`, and `signal-exit@3.0.7` against `dependency-lock.json` (37 files, package versions, individual file hashes, and tree hashes). It creates only four capsule-side symlinks; it installs, copies, or modifies no dependency and mocks no behavior. This extra dependency binding is verified by the task launcher/verifier, not stored as fields in the base runner receipt, which remains a stated limitation.

## Assertion-to-Rust observable proposal

These bindings are architecture proposals for root review, not implemented candidate seams. Durable ownership and leases belong in Rust on the execution host. A parallel stateful TypeScript backend merely preserving legacy import paths would split authority and is explicitly rejected.

### Claim identity — 7 evaluations

- Source lines 32–35: a genuine versioned Rust claim-authority request should return equal DTOs for identical inputs within one signer/key incarnation, keep the provider session id out of the identity digest, keep that digest stable across worktrees, and vary the worktree-scope digest.
- Source lines 39 and 42: the Rust identity canonicalizer should return typed `agent_session_identity_required` for malformed Codex identity and unsupported provider.
- Source line 53: the execution-host Rust canonicalizer should return the real canonical Prime transcript path while preserving agent/key/id.

The port should invoke the real Rust contract through a versioned library/IPC/CLI test seam. TypeScript may serialize the request/result for Electron, but must not own the signer or canonicalization state.

### Lease renewal — 7 evaluations

- Source lines 81 and 86: Rust renewal at a stale exact `runtimeFence` should return `agent_session_checkpoint_stale` and leave `lastRenewedAt` unchanged.
- Source lines 100, 107, 108, 110, and 116: one later stale renewal should reject the whole Rust transaction; the earlier in-memory record and exact durable bytes must roll back; reopening must return both session ids and retain every provider handle chain.

The real candidate seam should expose versioned reserve/commit/prove/evict/renew-batch/read/reopen behavior over a test-owned directory, including the exact owner incarnation and fence. Execution-host Rust must distinguish `live`, `unverifiable`, and `exited`; loss of contact is `unverifiable`, never evidence of exit. TypeScript remains a thin RPC consumer and does not keep a competing durable or in-memory lease authority.

### Provider-handle transition — 4 evaluations

- Source lines 28 and 29: a resumed Claude link at the current exact fence becomes the chain head, and only a `live` lease advances `provenHandleLinkId` to that link.
- Source lines 45 and 46: `new-owner-proving` may append the leaf but must retain `claimStatus: reserved` and `provenHandleLinkId: null`; recording a handle is not ownership proof.

The Rust session domain should own this transition and return a versioned record DTO. A test should assert the returned chain head and lease status directly from the genuine Rust result, not from a duplicate TypeScript state machine.

## Source baseline vs port vs candidate

- **Source baseline:** admitted, 3/3 suites, 7/7 cases, 18/18 assertion evaluations.
- **Port validation:** the existing assertion-preserving ports and maps remain unchanged. This follow-up did not edit or reclassify prior evidence; their embedded `sourceBaseline: not_established` strings are stale by design because this Task allowed only additive new paths, and this report supersedes only that baseline status.
- **Candidate parity:** still blocked. No genuine Rust/candidate identity authority, durable lease store, or provider-handle transition contract exists for these ports, so candidate-bound suites = 0, behavioral RED = 0, GREEN = 0. Import/collection failures remain setup failures.

## Exact executions

All commands ran from `/Users/carlos/Documents/Drogon-rewrite`.

```text
/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/run-parity-baseline-capsule.mjs --manifest tests/parity/ports/WP-ENG-RUNTIME/identity-leases/source-baselines/agent-session-claim-identity.manifest.json --source-root /Users/carlos/Documents/Drogon-mentu-session --execute --timeout-ms 30000 --node-bin /Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --vitest-entry /Users/carlos/Documents/Drogon-mentu-session/node_modules/vitest/vitest.mjs --approved-manifest-sha256 841b12542b4fe2392dee2c7c4aa8c2c014236bff0a3d5d826364525fdb96d963 --label eng-identity-claim-20260906-a1
```

Exit 0; 3 passed, 0 failed/pending/todo.

```text
/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/run-parity-baseline-capsule.mjs --manifest tests/parity/ports/WP-ENG-RUNTIME/identity-leases/source-baselines/agent-session-lease-renewal.manifest.json --source-root /Users/carlos/Documents/Drogon-mentu-session --execute --timeout-ms 30000 --node-bin /Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --vitest-entry /Users/carlos/Documents/Drogon-mentu-session/node_modules/vitest/vitest.mjs --approved-manifest-sha256 8ea3b6efbbaf1cb24afe43e431346ba5bdda0988de8551ae28df5b51914e7675 --label eng-identity-lease-20260906-a1
```

Exit 1; 0 collected, setup failure on missing `proper-lockfile`; rejected and retained.

```text
/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node tests/parity/ports/WP-ENG-RUNTIME/identity-leases/source-baselines/run-lease-baseline.mjs
```

Exit 0; 2 passed, 0 failed/pending/todo; all four dependency trees matched before and after.

```text
/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/run-parity-baseline-capsule.mjs --manifest tests/parity/ports/WP-ENG-RUNTIME/identity-leases/source-baselines/agent-session-provider-handle-transition.manifest.json --source-root /Users/carlos/Documents/Drogon-mentu-session --execute --timeout-ms 30000 --node-bin /Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --vitest-entry /Users/carlos/Documents/Drogon-mentu-session/node_modules/vitest/vitest.mjs --approved-manifest-sha256 f38718fcc8f000a67eafc8166d96141d6a9a6a6ba052370714b1df4e89e32eda --label eng-identity-provider-20260906-a1
```

Exit 0; 2 passed, 0 failed/pending/todo.

```text
/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node tests/parity/ports/WP-ENG-RUNTIME/identity-leases/source-baselines/verify-source-baselines.mjs
```

Exit 0:

```json
{"ok":true,"admittedSuites":3,"admittedTests":7,"admittedAssertionEvaluations":18,"rejectedSetupAttempts":1,"rejectedCollectedTests":0,"sourceRevision":"c97906287bb7a390b25e2025b600d9fb3c25d9c3"}
```

## Side effects and limits

Four nonce stages are retained: the three admitted runs and the one rejected lease setup attempt. Each contains its pinned source copy, license, stage receipt, generated config, JSON result, and Vitest `.vite` cache; the admitted lease stage additionally retains four verified dependency symlinks and an empty `.vite-temp` directory.

The original claim test created and removed a Prime transcript tree under the OS temp root. The lease tests created chmodded store directories, `agent-sessions.json`, backup/temp files, and `proper-lockfile` lock directories under their own OS temp trees; they fsynced/renamed files, registered `signal-exit` cleanup, used short unref'd lock renewal timers, released locks in `finally`, and removed all test trees in `afterEach`. A post-run scan found no `orca-prime-claim-*` or `orca-lease-renewal-batch-*` remnants. No provider/session, network, service, credential, install, settings, product, or source write was used.

This proves the exact original assertions only on the recorded Darwin arm64 Node/Vitest runtime. It does not prove remote mixed-version behavior, integrated application behavior, or candidate parity.

Audit closure remains **11/12 = 91.7%**, medium confidence, change **+0**. The next closure milestone is root acceptance of shared/versioned Rust contracts and genuine binding of these admitted assertions. The 24-hour risk remains **high** until those contracts exist, although the mandatory original-source baseline prerequisite is now complete.
