# Packaging coordinator review after b4a53ee

Bounded review, not G8 closure. Fifteen source files were read completely and independently fingerprinted against the read-only checkout and Git revision c97906287bb7a390b25e2025b600d9fb3c25d9c3. The companion JSON records exact paths, hashes, contracts and remaining work. E5 stays open; audit estimate remains approximately60% under audit-progress.md, with no closed-group increase.

## Verified source baseline

| Original capsule | Passed | Boundary |
| --- | --- | --- |
| local-preview-build-marker |4| Explicit flag and marker writing; filename assertion compares a literal |
| updater-local-preview-marker |10| Reader states/cache, real temp files, mocked Electron and EACCES |
| mac-build-compatibility |2| Metadata and rejected architecture, not migration/handshake |
| packaged-daemon-entry |4| Verifier runs synthetic short Node entries, not a real service |

All20 cases passed with zero failures/skips on macOS arm64, Node24.19.0 and original installed Vitest4.1.11. Exact original bytes and MIT LICENSE were staged, without changing assertions/imports. Each reference-captures/c9790628-<capsule>/ directory contains the actual runner report, stage receipt, Vitest result and scope README.

The existing capsule runner now selects the declared .test.mjs extension for packaging tests; .test.ts keeps its previous generated config byte-for-byte. Receipt/config/hash checks remain. Its68 regression cases passed, including two added extension/source-preservation cases. These are infrastructure tests, not original product cases. The disclaimer was corrected: not every capsule is a pure-function test.

## Contracts retained and claims narrowed

- Full842-line builder body and461-line builder test body reviewed. Preserve resources outside asar, forked entry placement, CLI package boundary/version, target resources, rebuild hooks, signing order and preview isolation. Reading the config is not running its hooks or producing a package.
- CLI and daemon executable probes use a host-architecture/universal check; the Windows PTY probe also requires a Windows host. Do not describe architecture-only eligibility as verified host-platform compatibility. Cross-arch existence checks are not runtime passes.
- Daemon verifier proves presence and an expected usage message, rejects spawn/missing-module errors, but does not separately check exit status/signal. Its four tests exercise synthetic entries only. A usage string is not evidence of a working daemon lifecycle.
- CLI runtime traversal uses a LIFO stack, not BFS. It finds literal require/require.resolve/dynamic-import calls, not every JS import form. Child probes clear NODE_PATH and ORCA_CLI_CWD, not the entire inherited environment. Actual packaged closure and platform execution remain required.
- Preview reader distinguishes absent, preview and unusable; malformed/unreadable markers fail closed. It accepts numeric formatVersion rather than exactly version1. The20 cases do not prove every updater entrypoint or a real packaged app is fenced.
- Mentu source/package bytes are pinned and reverified after signing. Provision copies/rechecks temporary bytes but removes the destination before rename; there is no atomic replacement or fsync guarantee. Full seven-case Mentu test body was read but not run: it imports the builder and requires the locked binary. Do not substitute a fake binary/dependency graph and report original acceptance. The lock's single platform is an integration packaging constraint, not an upstream Mentu capability limit.

Drogon must own its app identity, endpoints and release/signing setup while preserving licensing. This audit executed no publishing, installer, signing or personal-profile operation. Existing dirty product and installation work remains untouched. No Mentu PR gap is established by these packaging facts; the approved upstream PR route remains available during implementation.

## Remaining closure work

Finish coordinator review of runtime dependency closure, glibc/AppImage verification, remaining native/plugin helpers and CI matrix. The full builder and Mentu suites still need admitted isolated execution with real dependencies. Keep actual per-platform packages, update/rollback, source-to-candidate ports and installed-preview acceptance as separate unfulfilled gates. Do not repeat accepted inventories to inflate audit progress.
