# Original packaged-daemon-entry baseline

4 unchanged original cases passed, zero failed/skipped/todo; exit0, no timeout. Node24.19.0 / Vitest4.1.11 / macOS arm64. One result file, not the Vitest describe-container count.

Source c97906287bb7a390b25e2025b600d9fb3c25d9c3. Manifest: tests/parity/baseline-capsules/packaged-daemon-entry.json; SHA256 df06d3cf196b7d48c32e99312168c980d9d489eecfa54431ef8d57b5c3d36eeb. Stage: /Users/carlos/Documents/Drogon-rewrite/.preflight/parity-baseline/audit-packaged-daemon-entry-kfU3U0. Archived JSON preserves actual execution values. Source closure and MIT LICENSE matched both checkout and pinned Git blobs, and staged bytes were verified before execution.

Effects reviewed: Creates only owned temporary package directories. Spawns short Node children containing fixed test snippets: emit usage then exit1, require a deliberately absent package, or exit0. No real daemon, PTY or service. Original cleanup removes owned directories only.

Evidence boundary: Verifier unit behavior, not boot of a real packaged service. No executable architecture, OS, timeout/signal, credential or module-closure completeness proof.

No original assertions or imports were changed. The runner selects the declared .test.ts or .test.mjs extension without enabling unrelated test extensions or adopting the full original config. This is an original baseline, not rewritten Drogon or full package acceptance. No product/installation/signing/network/model operation took place.
