# Original remote transport lifecycle baseline

2026-09-06, source `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. Five whole original suites passed **31/31**, without modified assertions, failed tests, skips or todos. This batch is distinct from the26-case admission batch in11d04b7.

| Suite | Expanded cases | What actually ran |
| --- | ---: | --- |
| `remote-runtime-client.test.ts` | 23 | Real ephemeral127.0.0.1 encrypted WebSocket fixtures, original capability/envelope assertions, binary send, queue accounting and release, no-pong detection, listener cleanup, failure-stage classification, keepalive extension and abort. Four timer-delay rows are included. |
| `remote-runtime-request-response-router.test.ts` | 2 | Real encryption/decryption with a fixed synthetic key, in-memory router and callback spies: malformed versus unauthorized auth response, including pairing stage. |
| `remote-runtime-subscription-frame-router.test.ts` | 2 | Same bounded encrypted-input pattern for subscription errors, no socket. |
| `remote-runtime-request-connection-stale.test.ts` | 3 | Original mocked socket opener, private-state checks and one fake-clock case; repeat cleanup, send failure admission release, old-socket callbacks ignored after replacement. |
| `remote-runtime-request-websocket.test.ts` | 1 | Real ws object targeting127.0.0.1:1, immediately terminated after synchronous listener assertions; late synthetic error remains safe. No handshake or server setup. |

## Source admission

Root read every assertion and fixture body in all five tests, including the762-line client suite. All non-test runtime dependencies already match reviewed remote-runtime capsule hashes; root reread both routers and the socket wrapper. The closures contain28/8/8/30/26 source files respectively. Static runtime import/export discovery excludes erased type-only imports. The stale-connection suite additionally has three literal dynamic imports of `./remote-runtime-request-connection.js`; discovery resolves those to the original `.ts` module and Vitest executes the unmodified import strings. No unresolved dynamic import/require was found.

All38 distinct source/license files were independently matched against the source checkout, pinned Git blobs and staged files before/after execution. MIT Copyright2026 Lovecast Inc. remains preserved. Allocation remains46 packages/9037 files, all five suites in WP-ENG-SHARED, ledger SHA256 `e1ffc0deee15b2b8ae0a7a0ca91ef624384b3903d7c92f2606df423282e83d9a`.

Original server fixtures bind only their own ephemeral loopback ports and close their clients/servers after each test. Their method names do not cause real skill installation, session actions, browser control or orchestration mutations: responses are fixture data. Keepalive intervals clear at socket close; the one-shot fixture's550ms response callback may still run after early closure. This is retained source behavior, not a newly introduced service. Mocked stale-connection endpoints are not contacted. Fixed keys/tokens and all traffic are synthetic; no user credentials or external model inference were used.

## Execution and records

The existing bounded batch runner used three workers, Node24.19.0 and original installed Vitest4.1.11, with30 seconds allowed per capsule; all exited0 without timeout. Each manifest declares minimal-node versus full original config differences. Transport-enabled capsules pin ws8.21.3, tweetnacl1.0.3 and zod4.5.4, and optional ws native peers are disabled only in the child environment. All five package/link validations passed after execution (the same858-file dependency set, not4290 distinct dependencies).

`tests/parity/baseline-batches/remote-runtime-transport-lifecycle.json` contains the exact manifest approval digests. Reproduce with `scripts/run-parity-baseline-batch.mjs`, explicit source root, `--execute`, concurrency3, timeout30000 and the pinned Node/Vitest paths. The runner creates fresh nonce fixtures, not replacement files. `remote-runtime-transport-source-baseline.json` records the actual local roots, receipt/result hashes, package fingerprints and all expanded assertion names/statuses. Root reopened those records independently after execution.

These results do not prove actual remote execution/cancellation, independent cryptographic security, SSH/Tailscale outages, mixed installed host/client versions, native-addon performance, rewritten Rust behavior or Electron/package parity. The client capability tests exercise opt-in versus omitted wire fields in fixtures, not a real old executable. Keep source baselines, faithful test ports, behavioral RED and integrated GREEN separate.

Audit remains11/12 (91.7%, medium source-characterization confidence), with E5 still open and the finite Seti/Original Astra audit active. Sol implementation remains gated; no product edits or preview installation occurred. The flexible24-hour full-fidelity target remains high risk with no defensible ETA.
