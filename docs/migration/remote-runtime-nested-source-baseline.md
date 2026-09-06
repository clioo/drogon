# Original nested requests and recovery-error baseline

2026-09-06. Three complete unchanged source suites passed **27/27**, zero failures, skips or todos, at revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. These are separate from the26 admission and31 transport-lifecycle cases, not reruns counted as new tests.

| Suite | Cases | Observed scope |
| --- | ---: | --- |
| `remote-runtime-subscription-request.test.ts` | 10 | Real encrypted ephemeral-loopback subscription requests, response-id routing including out-of-order/unknown/duplicate responses,32-pending admission, serialization refusal, shared timeout rejection, close cleanup and injected queue/socket budget failures. |
| `remote-runtime-transport-error-agreement.test.ts` | 7 | Differential consistency of a manually assembled error corpus and real constructor/parser outputs; code/message precedence and fallback coverage. No transport is opened by these assertions. |
| `remote-runtime-tailscale-hint.test.ts` | 10 | Pure endpoint and message classification: MagicDNS, CGNAT, IPv6, false-positive boundaries, bare/empty hosts, contextual guidance and idempotence. No tailnet operation. |

## Important limitation preserved, not fixed

The original agreement suite explicitly asserts that `remote_runtime_busy` remains outside the recoverable-code set and that its four sampled messages match no recovery fragment. Its last passing case documents the guard's blind spot (source reference STA-3479); it is not a regression fix or proof that reconnect UX handles saturation correctly. A future candidate correction needs a separately explicit behavioral test and reviewed policy; do not weaken the inherited baseline to manufacture parity.

The corpus's57-or-more coded entries are not57 test cases or proof that every current producer was executed. Several labels/message strings are manually reconstructed historical data: for example, the copied JSON-limit message says8388608 bytes whereas the current implementation's limit is4194304. The test's broad name does not certify current-source enumeration. Root retained all original bytes and qualifies what its seven checks establish.

## Verification and reproducibility

Root read all487/359/106 source-test lines and complete Tailscale hint and nested-request-channel implementations. The other runtime modules reuse previously reviewed exact fingerprints. Static runtime import/export discovery, excluding type-only imports, found no dynamic import/require expressions. The manifests stage29/28/2 source files. Root independently verified all35 distinct source/license files against the original checkout, pinned Git blobs and staged bytes before and after execution. MIT Copyright2026 Lovecast Inc. remains preserved; all tests retain WP-ENG-SHARED ownership within the unchanged46-package/9037-file allocation.

The existing bounded runner executed three workers with Node24.19.0, original installed Vitest4.1.11 and30-second per-capsule limits; all exited0 without timeout. Minimal-node configuration differences remain explicit in the manifests. The two transport-enabled capsules' pinned ws8.21.3/tweetnacl1.0.3/zod4.5.4 trees and links were revalidated after execution (same858 dependency files). Optional ws native peers were disabled per child only; Tailscale hints need no transport dependencies. Subscription fixtures own and close all localhost servers/clients; browser-method names return synthetic fixture results, not actual browser actions. No models, credentials, downloads, global settings or remote services were used.

`tests/parity/baseline-batches/remote-runtime-nested-requests-and-errors.json` fixes approved manifest digests. Reproduce using `scripts/run-parity-baseline-batch.mjs` with explicit read-only source root, pinned Node/Vitest paths, concurrency3, `--execute` and timeout30000. `remote-runtime-nested-source-baseline.json` records actual local capsule roots, receipt/result hashes, expanded assertion names/statuses and dependency fingerprints; root reopened all results independently.

These source observations are not candidate test ports, behavioral RED/GREEN, real SSH/Tailscale outages, native memory accounting, mixed-version executables, Electron UI or packaged-product parity. Audit remains11/12 (91.7%, medium source confidence), E5 open. Actual Sol implementation remains gated, with no product edits or preview update. The flexible24-hour full-fidelity target remains high risk/no defensible ETA.
