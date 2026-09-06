# Original relay-protocol-backpressure capsule

Pinned source: `c97906287bb7a390b25e2025b600d9fb3c25d9c3` (read-only). Original unchanged assertions and complete runtime imports reviewed before execution. Node24.19.0 / original Vitest4.1.11, macOS arm64.

Observed: 9 passed, zero failed/skipped/todo; one actual test file, exit0, no timeout. Manifest: `tests/parity/baseline-capsules/relay-protocol-backpressure.json`; digest `7aee5a85cb8078fd05de656b6c5a3b83c3059527ad87c4fb373b721deba83af0`.

Stage: `/Users/carlos/Documents/Drogon-rewrite/.preflight/parity-baseline/audit-relay-protocol-backpressure-XeTzCH`. Raw stdout, stage receipt and full test results retained here; only a final newline normalized. Bytes match frozen source and pinned Git blobs. MIT license preserved by the stage.

These are Buffer-based protocol tests, not a live SSH/daemon handshake, dispatcher, mobile, candidate or cross-version run. Backpressure uses existing in-memory schedulers/callbacks; the maximum-payload tests allocate bounded tens of MiB. The runner's generic “pure-function” wording is narrower than the stateful decoder tests; the manifest and assertion bodies define actual scope. No network, Electron, models or user profiles accessed by tested code.
