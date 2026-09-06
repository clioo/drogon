# Packaged preview identity follow-up

Root review, 2026-09-06. Keep the currently verified installed preview intact.
This bounded follow-up is queued after native foundation corrections and the
current persisted-renderer contract migration, not a fourth active worker.

Queued Task `task_f97178f8b8fa` depends on `task_3555b53c24b1` and
`task_2ae98477787f`; it is not dispatched or implemented yet.

Root read `desktop-artifacts.mjs`, its tests, `package-desktop.mjs`,
`package-notices.mjs` and `install-preview.mjs`. The two existing artifact tests
passed independently under Node 24 on macOS. They exercise changed CLI bytes,
dirty metadata and a desktop-tree redirect; they do not cover the complete
packaged runtime. This is fixture validation, not packaged-app acceptance.

## Finding and required proof

`fingerprintBundle` hashes the daemon, CLI and renderer/main/preload app tree.
`verifiedBuildInfo` only checks that the Electron executable is an ordinary
file; it does not fingerprint that executable, frameworks, package metadata or
dependency notices. The installer compares the report against this partial
fingerprint. Code-signature verification remains necessary but is not a
comparison with the exact runtime used by the earlier acceptance run.

Reproduce the coverage gap with an owned package fixture, then make the final
acceptance receipt identify all installed runtime bytes and required notices.
Use a deterministic, bounded tree identity or an equally complete manifest,
including legitimate in-bundle Electron framework symlinks without following
links outside the bundle. Fail safely on missing, substituted, special or
redirected files. Distinguish metadata describing the build from proof of the
tested artifact. Preserve old managed builds and all user data.

Avoid a circular self-hash: the final sealed-bundle identity can live in the
detached acceptance report, computed after packaging/signing and verified before
and after staging the exact install candidate. Do not repeatedly re-sign to
chase a digest embedded in the bytes being hashed. Existing metadata-only
previews must remain recoverable; do not silently reuse a weaker old report to
authorize a newly installed build. Preserve source-build acceptance separately.

## Delegated scope

Sol-ENG directs one existing approved Kimi leaf after its current work and
foundation follow-up settle. It may edit only:

- `scripts/desktop-artifacts.mjs` and `scripts/desktop-artifacts.test.mjs`
- `scripts/package-desktop.mjs`, `scripts/install-preview.mjs`
- `scripts/accept-desktop.mjs` (only packaged identity/receipt admission)
- `tests/parity/ports/WP-ENG-RUNTIME/package-admission/**`

These pre-existing dirty files must be preserved and narrowly extended, not
overwritten or attributed wholesale to the new leaf. Sol writes only its
`docs/migration/sol-wave/eng-identity/package-admission.md` and `.json` reports.
Root retains dependency/manifest/notices-policy ownership, actual signing,
packaging, installation, commits and independent acceptance. No installs,
downloads, source cwd runs, services, user-profile changes or extra descendants.

Require candidate RED before the fix for executable/runtime/notice mutation,
deterministic repeated identity, allowed internal symlinks, refused escape,
and install-candidate substitution checks. Rerun existing artifact tests and
relevant acceptance-runner tests without launching user processes. Report
macOS fixture coverage separately from actual signed-package, Linux and
Windows evidence. Root must still run the genuine packaged app and verify
its exact final receipt before installing anything.
