# Remote runtime frame and outbound admission — original baseline

2026-09-06. Source revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. All three complete, unchanged original suites passed: **26 tests, zero failures, skips or todos**. These are new source baselines, not candidate implementation or parity acceptance.

| Original suite | Cases | Evidence boundary |
| --- | ---: | --- |
| `remote-runtime-outbound-admission.test.ts` | 10 | Reject oversized requests before acquiring a socket; bound subscription, pending request, retained text and ready-waiter admission; release state after timeout/close. Real ephemeral loopback sockets intentionally stall the handshake; assertions also inspect private state and one synthetic waiter fixture. |
| `remote-runtime-client-error-classification.test.ts` | 14 | Five structured recoverable-code rows, three refusal/precedence cases and six legacy-message rows. Tests classify inputs, not actual reconnect or retry behavior. |
| `remote-runtime-request-frames.test.ts` | 2 | Accept ready/authenticated/keepalive examples; reject excessive ready-frame nesting before JSON.parse. Not exhaustive envelope validation or authentication. |

## Admission and independent verification

Root read the entire three original assertion files, the classifier and the frame-parser dependency bodies. The outbound suite's58 runtime modules match previously reviewed remote-runtime capsule fingerprints exactly; root reread the client delegates, memory limits, process-admission reservation/release and ready-waiter implementations. Static runtime import/export discovery used installed Babel parser7.29.7, excluded erased type-only imports and found no dynamic import/require expression in these closures. Discovery did not replace source review. Two guessed companion filenames were absent; actual owning implementations were resolved from imports before admission.

The three manifests contain59,2 and5 source files respectively. Root independently checked all63 distinct source/license files against the original checkout, pinned Git blobs and staged bytes before and after execution. MIT Copyright2026 Lovecast Inc. remains preserved. The unchanged allocation ledger still has46 packages and9037 files; these three tests remain WP-ENG-SHARED. Its SHA256 is `e1ffc0deee15b2b8ae0a7a0ca91ef624384b3903d7c92f2606df423282e83d9a`.

Execution used the existing bounded capsule runner, three workers, Node24.19.0 and original installed Vitest4.1.11. Minimal node configuration differences remain declared in each manifest; original imports and assertions were not rewritten. Both transport-enabled capsules revalidated the existing ws8.21.3, tweetnacl1.0.3 and zod4.5.4 package trees/links (858 files per validation), with optional ws native peers disabled only in the child environment. The frame suite uses zod but does not exercise ws/tweetnacl. Classification has no transport dependencies.

The outbound suite owns and closes its localhost servers and clients, and asserts process admission is empty after every test. The declared64MiB process retained-text accounting is not a measured whole-process memory limit: JavaScript overhead and transient allocations are additional. Client rejection before opening a socket is not proof of remote process termination. The runner allowed30 seconds per capsule; all exited normally without observation timeout.

## Reproduction and retained records

Run the existing `scripts/run-parity-baseline-batch.mjs` with `tests/parity/baseline-batches/remote-runtime-frame-admission.json`, explicit read-only source root, `--execute`, concurrency3, timeout30000 and the pinned Node/Vitest paths recorded in previous baseline guides. Every manifest has a predeclared approval digest; execution creates a new nonce capsule, never overwrites an earlier one.

`remote-runtime-admission-source-baseline.json` records the actual local capsule paths, stage-receipt and result hashes, exact expanded assertion names/statuses and verified dependency-tree fingerprints. Root reopened those records after the runner returned; no self-reported agent success is substituted for results.

This does not establish authenticated RPC execution, real SSH/Tailscale outage recovery, mixed-version compatibility, a sustained load benchmark, rewritten Rust behavior, Electron UI or packaged-product parity. Candidate test ports must preserve these assertions and demonstrate behavioral RED before implementation, then integrated GREEN. The source audit remains11/12 (91.7%, medium confidence), E5 open; Seti/Original has a separate live audit-only Astra assignment. Actual Sol implementation remains gated. No product files, global settings or installed preview changed.
