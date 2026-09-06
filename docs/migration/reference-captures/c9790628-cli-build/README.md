# Frozen original CLI build receipt

Original Drogon/Orca source `c97906287bb7a390b25e2025b600d9fb3c25d9c3`,
independently cloned without hardlinks into a disposable fixture. No source
patches. Dependencies were independently copied on write from the reviewed
reference dependency tree; 3,901 dependency symlinks resolved inside that
copy, with no missing or external targets. No install scripts were run.

The original CLI TypeScript compilation command completed with exit 0 using
Node 24.19.0 and TypeScript 7.0.2 on macOS arm64. The log is empty. The result
records 2,239 output files and their SHA-256 hashes; the coordinator reread
and independently verified every output hash. The clone remained clean.

Only the compiler portion of `build:cli` ran: no package metadata/executable
fixer and no `install-dev-cli.mjs`. This does **not** prove CLI commands work,
launch a CLI runtime, install `orca`/`drogon-cli`, pass behavioral tests or
accept the rewrite. The existing personal application was not affected.

`build-cli.mjs` is the exact archival runner matching the hash in the receipt.
It expects an adjacent fresh `source/` clone and dependency tree and is not a
self-contained runnable dispatch from this archive directory. Its allowlisted
child environment and compiler-only command are recorded in `build-result.json`.
The local fixture is `.preflight/reference-cli-cRLmbn/` in the rewrite checkout.
