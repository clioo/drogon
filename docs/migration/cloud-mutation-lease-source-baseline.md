# Cloud mutation-lease original baseline

2026-09-06: **5/5 unchanged original tests passed**, Vitest4.1.9 / Node24.19.0 / darwin-arm64, source pin `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. No skips, failures or timeout. The exact manifest, stage/results hashes and five assertion names are in `cloud-mutation-lease-source-baseline.json`; original MIT/Lovecast notice was staged and rechecked.

Root read the entire original test, lease module and metadata import before admission. Every case supplies a synthetic fetcher and deterministic clock; none reaches Google metadata/storage, actual credentials or external processes. The existing capsule runner and the separate cloud toolchain were reused without changing assertions or root/source dependencies. The fixture lock is not represented as the entire original cloud workspace lock.

The tests assert generation-bound create/delete, conflicting live request rejection, expired takeover, exact authorized live takeover and generation-mismatch rejection. The final title says “any expected field,” but its body only changes generation: it does not prove operation-ID/digest mismatch coverage. Same-digest renewal, read-generation races, ambiguous writes,412 conflicts, metadata authentication and release failures remain separate obligations.

This is RP-C4 source-baseline evidence, not actual storage concurrency, full cloud-suite success or rewritten-product parity. Full9037-test allocation and candidate behavioral RED/GREEN remain. Audit stays10/12 (83.3%, medium-low confidence), delta0.
