# Runtime admission and cancellation — original baseline

Four complete original suites passed **18/18 cases**, zero failed/skipped, on 2026-09-06 with Node 24.19.0 and the source-installed Vitest 4.1.11 (darwin-arm64). Three bounded test workers ran the four capsules; these are test-runner workers, not newly launched AI leads. Exact results, assertion names and receipt hashes are in `runtime-admission-source-baseline.json`.

| Original suite | Cases | What its original assertions establish |
| --- | ---: | --- |
| runtime-rpc-call-queue | 8 | Foreground/background admission, synchronous failure recovery, pre-start abort, 71-call ordering, selector/global overload and retained-byte recovery |
| shared-control-retired-request-ids | 4 | TTL expiry, bounded oldest-ID eviction, refreshed rank and backward clock movement |
| promise-settlement-waiters | 3 | 10,000 cancellations with one anchor, timeout cleanup and already-aborted ownership notification |
| remote-runtime-memory-limits | 3 | Exact JSON, subscription-parameter and binary-frame byte limits, plus next-byte refusal |

## Admission and independent verification

Root read each whole test and its runtime import closure before admission. These files use in-memory promises, callbacks, arrays, clocks and scoped fake timers; they do not open sockets, spawn harnesses, read profiles or credentials, change global settings, or contact services. Type-only imports are erased by the same original Vitest transform; this is not whole-source typechecking.

The capsule runner staged fresh nonce directories, checked source HEAD and exact pinned blobs, and bound execution to the predeclared manifest digests. Root then reopened all four result files and stage receipts and independently compared all staged source/license bytes against both source files and pinned Git blobs. There are 12 distinct pinned files including LICENSE. Each original entry test still maps, by unchanged hash, to `WP-ENG-SHARED`; the 9,037-file/46-package allocation is unchanged.

The minimal capsule config omits source renderer aliases, DOM/canvas/host-port setup, feature-wall define, GC/WebStorage flags and extended timeouts. The reviewed suites do not use these hooks. This is scoped runtime equivalence for these in-memory original tests, not general configuration or platform equivalence.

Reproduce from the rewrite repository with the admitted batch:

```sh
/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  scripts/run-parity-baseline-batch.mjs \
  --batch tests/parity/baseline-batches/runtime-admission-and-cancellation.json \
  --source-root /Users/carlos/Documents/Drogon-mentu-session \
  --vitest-entry /Users/carlos/Documents/Drogon-mentu-session/node_modules/vitest/vitest.mjs \
  --execute --concurrency 3 --timeout-ms 30000
```

Prior evidence directories are preserved. Each rerun gets a new nonce; do not overwrite results or count repeated cases as new coverage.

## Limits and Sol handoff

- The 10,000-caller scenario is one original case, not 10,000 tests or a measured heap-retention proof. It asserts waiter count and a single attached base-promise reaction.
- Queued abort does not prove cancellation of an already-started remote operation. A discarded request ID does not establish process death, network acknowledgment or durable subscription cleanup.
- The 71-call ordering case and tested byte limits are bounded fixtures, not throughput or peak-memory certification.
- Socket reconnect and subscription-close suites remain allocated. Their imports pull in additional transport/crypto code; they were inspected as candidates but not admitted by replacing those imports with mocks or deleting assertions. They need their own complete dependency/effect review and real boundary tests.
- These are unchanged original baselines, not assertion-preserving ports or candidate behavioral RED/GREEN. Sol must still port the assertions, show actual behavioral failures before feature implementation, implement the contract, then verify integrated behavior and real SSH/folder/version/recovery cases.

Product code, the installed preview and original source were not changed. This is permissible baseline preparation while E5 decisions are outstanding, not a premature Sol implementation phase. The audit remains **11/12 = 91.7%**, delta 0 groups; E5 asset/service decisions and remaining notice obligations stay open. The flexible 24-hour full-fidelity target remains high risk with no defensible ETA.
