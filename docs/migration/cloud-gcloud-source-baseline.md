# Cloud credential-cache original baseline

2026-09-06: **2/2 unchanged original cases passed**, Vitest4.1.9 / Node24.19.0 / darwin-arm64. Source revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`; original MIT/Lovecast notice retained. Exact stage, result, manifest and toolchain fingerprints are in `cloud-gcloud-source-baseline.json`.

The complete original gcloud-client module and test were read before admission. Both tests inject synthetic tokenCommand functions, so the default gcloud child-process function is never called. No real credentials, cloud requests, user profiles or provider agents were used. The first test checks concurrent access refresh count, returned values and cache reuse; only the identity test checks the exact command arguments. Neither validates authenticity, expiry, concurrent identity refresh, default subprocess failures or the rewritten product.

The existing capsule runner staged fresh source/test/license bytes, verified them against working and pinned Git content, and executed the exact approved manifest `tests/parity/baseline-capsules/cloud-gcloud-client.json` (SHA256 `511e7f708f71867f3660a1aba2070947eac3a6d04e3a1f0218d91892bc65dc32`). Root separately reopened both assertion results, stage receipt and all staged byte hashes. No assertions or runner machinery changed.

## Isolated toolchain

The cloud source pins Vitest4.1.9 rather than the desktop's4.1.11. A separate temporary tool directory was installed with lifecycle scripts disabled and workspace inheritance disabled. The five explicitly pinned versions are Vitest4.1.9, Vite8.0.16, esbuild0.28.1, tsx4.22.4 and @types/node24.13.2. Installation used pnpm11.19.0 under Node26; actual test execution explicitly selected Node24.19.0. The new transitive lock is recorded, not represented as byte-equivalent to the entire original cloud workspace lock. Root/source dependencies, user settings and installed app were not modified.

Portable manifest and lock are under `tests/parity/toolchains/cloud-vitest419/`. Future admitted baseline runs can install that isolated toolchain with `pnpm --dir tests/parity/toolchains/cloud-vitest419 install --ignore-workspace --ignore-scripts --frozen-lockfile`, then pass its absolute `node_modules/vitest/vitest.mjs` and an explicitly selected Node24 binary to the existing capsule runner. Dependency installation is a scoped setup operation, not a passing test. Every additional capsule still needs independent dependency/effect review; do not admit arbitrary cloud suites using this precedent.

Audit remains10/12 (83.3%, medium-low confidence). These two cases are source-baseline evidence, not another closed source group, candidate behavioral RED/GREEN or full-feature parity.
