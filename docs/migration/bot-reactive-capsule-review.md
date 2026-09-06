# Bot reactive-dispatch baseline review

Source pinned to `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.
Manifest: `tests/parity/baseline-capsules/bot-reactive-dispatch.json`.

## Preparation corrections

Muse Task `task_96e5f215086b` prepared the manifest without executing it.
Coordinator review rejected three draft facts before staging:

- The test has **17 direct tests + 12 table rows = 29**, not 30. Both the
  actual table and an independent AST traversal establish this count.
- The runner accepts roles `test` and `module`, not `type`, and requires
  `expectedTestCounts.tests` for the exact-count execution check.
- The type-only chain was neither import-free nor fully enumerated:
  Mentu contracts have runtime re-exports and more type dependencies.
  They are not loaded by this test and were removed from the staged set.

Only the original test, dispatch implementation, validation, timeout wrapper,
timeout primitive and dispatch type definitions are staged (six raw-hash-pinned
files). No test body or assertion was modified. No typecheck is claimed.

## Coordinator execution review

Coordinator read all six complete files. Runtime effects are in-memory
repository/gateway doubles already present in the original tests, Maps/Sets,
`Date.now`, `randomUUID`, promises and bounded timers. One test injects its
own `now` clock; there are no fake timers. Default 30-second timers are
cleared when calls settle; intentional timeout tests use 10/20 milliseconds.
The tested runtime reaches no real filesystem, process, network, harness or
credential operation. The Mentu observation import is type-only and erased.

Execution used Node 24.19.0 and the independently copied original Vitest
4.1.11, an allowlisted child environment, fresh HOME/temp and the reviewed
minimal capsule configuration. The original checkout remained read-only.

**29/29 passed, zero failed/skipped/pending/todo**, at
2026-09-06 00:34:05 UTC. Coordinator independently checked all 29 assertion
results and all six staged hashes. Exact receipts are retained under
`reference-captures/c9790628-bot-reactive-dispatch/`.

This is original foundation evidence only: admission, normalization, duplicate
events, ambiguous outcomes, retry suppression and preservation of acknowledgement
evidence. Original in-memory doubles do not establish durable database behavior,
real triggers, remote delegation, rendered Bot UX or Drogon rewrite parity.
