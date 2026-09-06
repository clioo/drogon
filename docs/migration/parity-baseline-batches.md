# Bounded parallel source-baseline execution

Test infrastructure, 2026-09-06. This adds a batch coordinator around the existing capsule runner; it does not replace staging, manifest approval, source/license verification or result evaluation. Product implementation remains gated on the audit.

## Contract

- A batch explicitly lists 1–256 manifest paths and their previously approved SHA256 digests. There is no filesystem discovery, automatic approval or default source checkout. Keep batch files in `tests/parity/baseline-batches/`, separate from individual manifests.
- All manifest bindings, positive expected case counts and unique paths/IDs are checked before any worker starts. Each worker checks the binding again, stages a fresh capsule through the existing runner, and verifies its stage-time digest before execution.
- Default is **stage-only**, not a test pass. Execution additionally requires `--execute` and an explicit absolute installed Vitest entry. The Node binary defaults to the current executable and is recorded.
- Concurrency defaults to 2 and is limited to 1–4. Each approved entry runs once; failures remain failures, independent entries continue, output ordering matches the plan, and the CLI exits nonzero if any outcome fails. No retry, prior-result overwrite or dependency installation occurs.
- Results and stage receipts remain in separate nonce directories under `.preflight/parity-baseline/`. The batch prints JSON to stdout; preserve it as evidence. Staging failures before a receipt exists may leave a partial nonce directory, as in the underlying runner; they never count as successful tests.

Example from the rewrite repository, using an explicitly selected Node runtime:

```sh
node scripts/run-parity-baseline-batch.mjs \
  --batch tests/parity/baseline-batches/wsl-discovery.json \
  --source-root /absolute/read-only/source-checkout \
  --vitest-entry /absolute/read-only/source-checkout/node_modules/vitest/vitest.mjs \
  --execute --concurrency 2 --timeout-ms 30000
```

The batch is not a security sandbox. Every capsule still needs a complete dependency/effect review and its runtime/config differences recorded before admission. Worker threads reuse the original runner's environment and single-child timeout semantics. A child that ignores termination or detaches descendants is not bounded as a process tree; no universal wall-time guarantee or cancellation protocol is claimed. Do not admit external-service, personal-profile or otherwise unsafe suites just because their manifest hashes match.

## Observed verification

- New batch tests: **11/11** under Node 24.19.0, including bounded concurrent admission/order, rejected later approvals producing no staging, distinct real worker-thread capsules, source drift, controlled failing child execution and stage-only behavior. Fixture Vitest is explicitly synthetic and is not counted as original-source coverage.
- Existing capsule-runner regressions: **71/71**, Vitest 5.0.0. The original runner and assertions were not modified.
- Actual batch pilot: the unchanged WSL discovery suites passed **9 + 8 = 17** original cases under source Vitest 4.1.11 / Node 24.19.0, darwin-arm64. Root independently reopened result JSON, stage receipts and staged source/license bytes. This repeats the earlier17 cases to verify the new execution path; it does not add17 unique cases to coverage. No native WSL, Electron or model inference occurred.

Exact receipts/fingerprints and assertion outcomes: `parity-baseline-batch-evidence.json`. Machinery tests are not candidate behavioral RED/GREEN, cross-platform runtime validation, complete test migration or product parity. Future Sol leads must still review test equivalence and complete each capability's actual acceptance obligations. Audit remains9/12 (75%, medium-low confidence); E1/E3/E5 are open.
