# Build + distribution entrypoints (G8, G7-U4) — repaired

Later coordinator review: [packaging contracts and20 original unit cases](parity-packaging-coordinator-review.md). Full builder/test bodies and selected modules reviewed; M8 traversal is LIFO, not BFS, and inherited-env probes are not hermetic. Original leaf tiers below are historical. G8 remains open.

Status `leaf-reported-pending-coordinator-review`. No G8 closure.
Frozen source `c9790628` read-only; no execution/packaging/network.
Full matrix + hashes: companion JSON (schema v3). No secrets recorded.

## Restored entrypoint matrix (21 entries, anchors reverified)

config/ build dir (U4: builder config, update channel, nsis/, 454
scripts, tsconfigs, vitest/lint/gate configs, docker/, patches/,
relay-assets/). dev-app-update.yml (4 lines, full body: GitHub
provider + public coordinates only). Casks stable+RC (per-arch pin,
verified-domain download, livecheck, auto_updates; skew 1.3.24 vs
1.4.197 — release-driven bump). resources/ (entitlements, icons,
per-OS bin shims, tray, sounds, plugins/skills). package.json scripts
(build/desktop/cli/unpack/mac-release/orcad/relay/native chains).
build-orcad.mjs head (Node-only runtime, Node 18 floor rationale).
electron.vite.config.ts (NSIS asar ordering note). CI: release-cut
(2252 lines: cut/publish/gates/preflight/build/docs/cask jobs),
release-mac-build, homebrew-bump (desktop-tags-only guard),
58-workflow platform set (desktop + mobile-adjacent + 20 cloud-*).
Cloud: relay app.ts Hono entry + Dockerfile (node:24-alpine, frozen
lockfile), relay-contract package, fence-broker entry, relay-ops UI,
terraform tree (values never reproduced). MIT LICENSE (Lovecast 2026).

## Builder config (full body, 842 lines)

Dev-channel identity envs + separate `orca-hourly/-daily/-adhoc`
repos; appId; `orca://`. extraResources (relay, plugins, skills,
emoji single-file, pinned mentu runtime, per-arch speech, deb/rpm
deps). All-negation `files` exclusions; asarUnpack entries each with
`ELECTRON_RUN_AS_NODE` rationale; AppImage ELF hook. afterPack: glibc
floor, resources throw, mentu prepare, linux `package-type` marker,
platform-ungated preview marker, darwin compat file, CLI stamp
(throws), prune/deps verify, arch-gated daemon checks, plugin verify,
chmods, darwin signing; afterSign mentu re-verify. win: SignPath
release-only, NSIS single include. mac: Alternate-rank markdown,
entitlements, 10 usage strings, hardened/notarize/force-sign
release-only, MacOS helpers, dmg+zip. linux: markdown mime only,
`orca-ide` name, WMClass, AppImage+deb+rpm, xvfb/python deps,
postinst/prerm, npmRebuild true, github publish. Helpers: CLI stamp,
chmods, nested-first signing (CSC_LINK/CSC_NAME/keychain/ad-hoc).

## Referenced modules (exact intervals)

Full body: M1 native-rebuild (65), M2 daemon-entry (58), M5 mac
compat (34), M6 plugin resources (111), M7 node-pty (25), M10a preview
marker (31). Leaf-reported-partial: M3 lines 145-229 of 525; M4 lines
1-40 of 493; M8 lines 107-166 of 229; M9 lines 25-94 of 260; M10b
lines 27-226 of 227 (lines 1-26 unopened). Remainders are explicit
unknowns below — no full-body claim attaches to them.

## Coordinator corrections preserved

Linux install checks THREE FIXED `/opt` locations (`/opt/Orca`,
`/opt/orca-ide`, `/opt/orca`) — prior "no hardcoded dir" phrasing
withdrawn. Removal uses RAW `readlink` against three LITERAL prefixes
(`/opt/Orca/*`, `/opt/orca-ide/*`, `/opt/orca/*`) — not canonicalized.
Mentu provision is copy-to-tmp + chmod + staged re-verify, then
remove-existing, then rename — NOT atomic, NO fsync. Single-platform
lock is an INTEGRATION PACKAGING constraint (unsupported ships
nothing); not evidence about upstream Mentu support; no PR asserted.
NSIS (79 lines, full body): additive markdown OpenWith, genuine-
uninstall-only daemon sweep (`${isUpdated}` guard), daemon names sync
`daemon-host-relocation.ts`. Linux scripts full bodies: sandbox 4755,
owned-symlink-only install; lifecycle-gated removal.

## Test mapping (all ~30 assertions read, never passed)

Builder test 461 lines: identity, asar exclusions, hostile-panel
regression (1.4.160-rc.3), electron-dev, extraResources, win32 shim
(#7351), MacOS helpers (#7929), asarUnpack incl. 3-leg OpenCode
check, linux targets/names/deps, AppImage ELF + arm64 matrix, semver
discipline, rebuild hook, root-package recovery, preview marker.
Titles-only: orcad-prebuilds (5), per-platform/version-stamper tests
found unopened, glibc-floor test bodies unopened.

## Cloud KEEP — independent authority

KEEP = required capability to implement-or-interoperate with (wire
shapes per accepted relay-mobile-wire v3). NOT permission to reuse
credentials, infrastructure, endpoints, terraform values, or tokens;
NOT a proprietary-backend dependency. Drogon re-provisions and
re-credentials independent instances.

## Platform/SSH + unknowns

mac signed dmg/zip; linux AppImage/deb/rpm + glibc floor + PATH +
Xvfb serve; win signed NSIS + daemon survival; orcad slots + `orca
serve` for shell-only hosts; live/unverifiable/exited.
Unknowns: module remainders (WP-ENG-INSTALL), CI bodies + mobile
(WP-ENG-INSTALL/WP-CAP-MOBILE), terraform values/relay-ops
(WP-ENG-CLOUD, never reproduced). Mentu: no upstream-PR gap in scope.
