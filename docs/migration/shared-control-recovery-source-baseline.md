# Shared-control recovery: original-source baseline

## Result

**45 newly admitted original cases passed**, plus **2 previously admitted liveness cases passed again**. All five complete source suites are unchanged:47 passing executions, zero failures/skips/todos. The standing-intent suite ran first; the other four ran with three bounded test workers, Node24.19.0 and source Vitest4.1.11 on darwin-arm64.

| Whole original suite | Passed | Evidence scope |
| --- | ---: | --- |
| Standing intent | 14 | Two real encrypted-loopback reconnect cases; twelve original fake-clock/private-state cases |
| Shared-control connection | 28 | Real fixture transport plus original synthetic cases; request/subscription multiplexing, cleanup, deadlines, reconnect/replay and local no-pong detection |
| Reconnect scheduler | 2 | Fake-clock callback consumption and cleared/intentional-close behavior |
| Socket generation | 1 | In-memory stale/duplicate callback rejection and throwing-consumer isolation |
| Socket liveness | 2 | Previously admitted fake-clock suspend/probe cases; compatibility rerun, not new coverage |

[Exact assertions, hashes and result paths](shared-control-recovery-source-baseline.json) distinguish those scopes. No candidate implementation or preview installation occurred.

## What the original behavior establishes

- A dropped idle control connection retains standing retry intent; closing the last subscription does not automatically abandon recovery.
- Active and idle backoff ceilings differ. Four simulated capped retries check bounded jitter; the test name's “indefinitely” is not an infinite-duration operational test.
- A pending callback can be advanced once without resurrecting cleared work. A stale or duplicate socket-close generation cannot own another recovery.
- A real loopback fixture with automatic pong disabled causes the original client to terminate its silent socket, reconnect, replay the logical subscription and tag a delivered replay response. This models no-pong silence, not an actual TCP/NAT/SSH outage; the fixture still implements response handling.
- Cleanup requests are explicit and repeated close does not duplicate file-watch cleanup. Fixture method names do not execute real watchers or orchestration endpoints.
- One short RPC timing out does not discard unrelated pending work. Retained-byte admission is released after settlement/close; counters and3MiB fixture payloads are not process-RSS or production-throughput measurements.

## Admission and independent checks

Root read all added source bodies and the complete original tests, reusing exact hashes for the already-reviewed request transport. The combined set has60 distinct source files plus the MIT license at `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. All61 files were compared with staged bytes, the source working tree and pinned Git blobs. No tests, imports or expectations were rewritten.

Real installed ws8.21.3, tweetnacl1.0.3 and zod4.5.4 are linked only inside each new transport capsule, with complete858-file package-tree fingerprints rechecked after execution. The generation suite imports only zod from those packages; ws/tweetnacl are linked but unused. The earlier liveness capsule needs none. Child-only optional-native-peer exclusions remain unchanged; no package installation, profile write or global setting change.

Root reopened all five actual `vitest-results.json` files and stage receipts, checked every assertion/status/count and verified the unchanged WP-ENG-SHARED ownership and46-package/9037-file allocation. An initial inspection used the wrong result filename and failed; it was corrected without rerunning or weakening tests.

The minimal node configuration is not the full original environment. Omitted DOM/GC/host-port setup is irrelevant to the reviewed fixtures; real-server cases bind ephemeral127.0.0.1 explicitly. Source cleanup closes owned sockets/servers/timers. The bounded runner remains a guardrail, not a security sandbox or universal process-tree cleanup guarantee.

## Reproduce

With Node24.19.0 and the existing source dependencies:

```sh
node scripts/run-parity-baseline-capsule.mjs \
  --manifest tests/parity/baseline-capsules/remote-runtime-standing-intent.json \
  --source-root /Users/carlos/Documents/Drogon-mentu-session \
  --execute \
  --vitest-entry /Users/carlos/Documents/Drogon-mentu-session/node_modules/vitest/vitest.mjs \
  --approved-manifest-sha256 6c7805e039405f87dbaefdaab25ea74148d786f19a27c1d8eefe0725f407c82e \
  --timeout-ms 30000

node scripts/run-parity-baseline-batch.mjs \
  --batch tests/parity/baseline-batches/shared-control-recovery.json \
  --source-root /Users/carlos/Documents/Drogon-mentu-session \
  --execute \
  --vitest-entry /Users/carlos/Documents/Drogon-mentu-session/node_modules/vitest/vitest.mjs \
  --concurrency 3 --timeout-ms 30000
```

## Remaining gates

These tests do not prove actual SSH/Tailscale behavior, OS suspend/resume, remote process death, independent cryptographic interoperability, production RPC authorization or rewritten Drogon/Electron parity. Loss of contact remains `unverifiable`, not proof of process exit.

The original shared-control architectural-boundary test scans both full source subtrees and requires `typescript-api`; it was inspected but not admitted or run with an incomplete capsule. Other subscription/keepalive original suites retain their own pending baseline obligations. Faithful ports, candidate behavioral RED, implementation and integrated GREEN remain subsequent gates.

Audit11/12=91.7%, delta0, medium source-characterization confidence. E5 publication/provenance/service dispositions remain open; full-fidelity24-hour target remains high risk/no defensible ETA. Actual Sol leads and approved workers follow complete source-audit acceptance; Astra is audit-only.
