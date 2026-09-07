# Packaged runtime identity admission — root RED

2026-09-06. Worktree base `14cfc74`; see `worktree-packaging-transfer.json` for preserved draft provenance. Not packaged-app acceptance.

Root ran Node v24's built-in test runner against the transferred implementation. Existing `scripts/desktop-artifacts.test.mjs`: 2 passed, 0 failed/skipped. New `scripts/packaged-runtime-admission.test.mjs`: 0 passed, 4 failed, 0 skipped, exit 1, with assertion-level digest equality despite changed bytes. Mutations independently covered the Electron executable, framework binary, Info.plist and dependency notices. All produced unchanged artifact digest `cecc040da244a37fe61c6faa3ddfd25dc64f78d9bb624450f7bb56034a495fa4`.

Each test created an owned temporary package fixture and removed only that fixture afterwards. No installed application, service, profile, signing, download or inference was used. This proves the current partial fingerprint misses those runtime bytes; it is not proof of tampering in any installed app.

The new tests initially bind to the current partial fingerprint API to reproduce the defect. If implementation introduces a separate final sealed-bundle receipt identity (recommended to avoid an embedded self-hash), rebind these four assertions to that final admission API without weakening their behavioral requirements. Keep metadata-only legacy-build recovery separate from authorization of a new install. Real packaged acceptance remains dependent on desktop/bootstrap and native lifecycle integration, then root signing/packaging/acceptance/install.
