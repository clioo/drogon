# Original updater-local-preview-marker baseline

10 unchanged original cases passed, zero failed/skipped/todo; exit0, no timeout. Node24.19.0 / Vitest4.1.11 / macOS arm64. One result file, not the Vitest describe-container count.

Source c97906287bb7a390b25e2025b600d9fb3c25d9c3. Manifest: tests/parity/baseline-capsules/updater-local-preview-marker.json; SHA256 622642bea104247e931172996fe0f2a15e099968ee6302fde6bfebfbfc7d257c. Stage: /Users/carlos/Documents/Drogon-rewrite/.preflight/parity-baseline/audit-updater-local-preview-marker-Z5xcrq. Archived JSON preserves actual execution values. Source closure and MIT LICENSE matched both checkout and pinned Git blobs, and staged bytes were verified before execution.

Effects reviewed: Real temporary marker files. Electron app is mocked; fs read passes through except simulated EACCES. process.resourcesPath is replaced in the test process and restored; no Electron launch, updater or network.

Evidence boundary: Reader state and cache only; no real update entrypoint or packed application. formatVersion accepts any number; forward version policy beyond that is not asserted.

No original assertions or imports were changed. The runner selects the declared .test.ts or .test.mjs extension without enabling unrelated test extensions or adopting the full original config. This is an original baseline, not rewritten Drogon or full package acceptance. No product/installation/signing/network/model operation took place.
