# Original local-preview-build-marker baseline

4 unchanged original cases passed, zero failed/skipped/todo; exit0, no timeout. Node24.19.0 / Vitest4.1.11 / macOS arm64. One result file, not the Vitest describe-container count.

Source c97906287bb7a390b25e2025b600d9fb3c25d9c3. Manifest: tests/parity/baseline-capsules/local-preview-build-marker.json; SHA256 7e5d176512e047800194ffed91df5fdda92106a1a83832950c4a2535821d3e6f. Stage: /Users/carlos/Documents/Drogon-rewrite/.preflight/parity-baseline/audit-local-preview-build-marker-kmVSu7. Archived JSON preserves actual execution values. Source closure and MIT LICENSE matched both checkout and pinned Git blobs, and staged bytes were verified before execution.

Effects reviewed: Real temporary directories, marker writes and reads; ORCA_LOCAL_PREVIEW_BUILD modified only in the test process and restored. No updater, release check, installer or external access.

Evidence boundary: Writer contract and explicit flag only. The filename test compares a literal, not the reader source; no packaged updater integration.

No original assertions or imports were changed. The runner selects the declared .test.ts or .test.mjs extension without enabling unrelated test extensions or adopting the full original config. This is an original baseline, not rewritten Drogon or full package acceptance. No product/installation/signing/network/model operation took place.
