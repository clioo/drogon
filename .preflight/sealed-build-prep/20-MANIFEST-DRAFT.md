# Sealed-build manifest — DRAFT (prep lane; `execution` filled by the gated lane)

Status: `DRAFT`. Sections `source`, `assets`, `runtime`, `helpers` are frozen
from read-only evidence. Section `execution` is `null` until the gated lane
runs `10-WRAPPED-STAGES.md`. Four hash classes are kept distinct by design:
source-tree/script hashes (worker-computed over the sealed source — pure
reads), asset-source hashes (same), the runtime reference hash (transcribed
from the historical record, binary never contacted), and frozen helper
hashes (transcribed verbatim from the historical record — never
worker-quoted).

```json
{
  "status": "DRAFT",
  "source": {
    "repo": "clioo/drogon",
    "ref": "origin/main",
    "headSha": "59ed9740a4b84f73df1c41eef522ba347771d413",
    "treeSha": "f53ef34d2bad4196db38c8eaa4cde514ae7e3fed",
    "howVerified": "git fetch origin main + git rev-parse (read-only)",
    "packageManager": "pnpm@11.19.0",
    "node": "24 (pinned path $HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin)",
    "scripts": {
      "scripts/build-main.sh": "e9fc5ba8a835755bf4a587f8aa0a75527c54b8e4af43f93571dbf129c03f18aa",
      "scripts/build-main.test.mjs": "d0bd51aba4fca71d0df29725d3c6c40ed8c63015047cc1236bfb52ecaabb6073",
      "scripts/package-desktop.mjs": "33d5b0b8399d0a70363293e3bb2f020e6a3a24992ffc0a404e1e1367d3136264",
      "scripts/accept-desktop.mjs": "887d29ddff7234b8d357a529277f64edb346b7cb3e2d1e53450d27c1e7c870ee",
      "scripts/install-preview.mjs": "892b1fb776de634fedf3adf515a867d41e12eb26d37088486a8eda5e78f9356e",
      "scripts/desktop-artifacts.mjs": "dab8665832ceeb79eb9fa4247496a8111e8f8d2af17f9f7a2be0ebb8c",
      "scripts/acceptance-process.mjs": "fe34d0076e4751ec38b80bf6a2a0b11d8c151f5f9ac32e77c22aac9",
      "scripts/acceptance-foreground.mjs": "f81c94de07062b53be15646ec38b80bf6a2a0b11d8c151f5f9ac32e77c22aac9",
      "scripts/acceptance-bridge-observation.mjs": "5af92c48eb712b447e2579f221872c5d4aecf7775c9371ce11fc9030ed6afdb7",
      "scripts/live-child-exit-observer.py": "825556d7ba22e6954e1ebe50a6661089555e8e00371e6582ecd18f5de08a480b",
      "scripts/sealed-model-fixture.mjs": "ebfab5a34b6fe64ba2decc0574cdf1f0d13ef0d321c6d00cf937e3b12f37856c",
      "scripts/sealed-model-fixture-lifecycle.mjs": "e3e06aaee144af3328d1a46937eb721c6ce4920cb5190bfc8041cb74bf9da45c",
      "scripts/observe-macos-foreground.swift": "70f9e94f39462fe2a1d7d9a09ab45a37ec97dbf60f635f86f4cccf9b14308f48"
    },
    "howHashed": "git show origin/main:<path> | sha256sum (read-only; no checkout, no execution)"
  },
  "assets": {
    "packageJson": "2a51c40a437762cccb2f8e33335ace5e52e58b294ab5c64aab514f1bed88f312",
    "pnpmLock": "8f78e2a20a60035624cacdac6d59038bd729ddd868e4d3d7c4f9140be3cb4a66",
    "cargoToml": "5809648558d17a0250ea4ded637cc29670dd1d675641dfe77ec1c81cfb850981",
    "cargoLock": "b72502f7f6adb77e3cfb5bb85a083d4f3ee162b1a0bc8ef9758577060fe9834b",
    "iconSource": {
      "path": "apps/desktop/resources/icon.svg",
      "sha256": "76f2c9b7f1c93e74fde8315f9a43b08d3dd8548a7f980b395624f835288b8a04",
      "builder": "scripts/build-app-icon.mjs (APP_ICON_SOURCE_FILE; R16-Z2 rename-before-seal path in package-desktop.mjs)"
    },
    "notices": {
      "THIRD_PARTY_NOTICES.md": "21cafca260bd83c57ed14ebeeddfea771597947c559b57c68598a544c174761f",
      "verifiers": ["scripts/verify-final-bundle-notices.mjs", "scripts/verify-e5-package-notices.mjs", "scripts/verify-e5-font-provenance.py"]
    },
    "generatedAtExecution": ["Drogon.app bundle bytes", "icon.icns", "sealed entry manifest (MAX_SEALED_ENTRIES=100000, MAX_SEALED_BYTES=2GiB)"]
  },
  "runtime": {
    "note": "READ-ONLY REFERENCE. The prepared binary was staged, never executed, and is NOT the active runtime for any stage. No lane contacts it; it is listed here only so the exec lane can distinguish it from anything the build produces.",
    "provenanceRecord": "/tmp/drogon-muse-glm-critical-qa/qa-critical-399-muse-task.txt",
    "stagedAt": "/Users/carlos/orca/workspaces/Drogon/qa-399-integrated-ui-astra/.qa/visual-PR-399 (runtime-preparation-receipt.json + runtime-staging/) — NOT CONTACTED",
    "mentuRelease": "Mentu0.5.0",
    "mentuCommit": "c82ccfa0ebbe77d62193e068821ba6e74f87a8d3",
    "binarySha256": "f00528a940185e9433ad65b02e7de251d7d3d856c9d24d38f8b1474a1ca8bc5d",
    "bundledAtExecution": "apps/desktop/resources/mentu-runtime is added as extraResource only if present in the fresh clone (package-desktop.mjs); whatever lands there is fingerprinted by fingerprintBundle/sealedBundleDigest at S9, never trusted by path."
  },
  "helpers": {
    "note": "Frozen gui-qa-owner helper hashes, transcribed VERBATIM from the historical record below. Never worker-quoted, never recomputed, never contacted.",
    "record": "/tmp/drogon-muse-glm-critical-qa/pr399-grant-hashes.txt",
    "sha256": [
      "1ebb84a0a2e9e513948a1da2db3d33990541231257981eaf5b193f4fd042dcb8  /Users/carlos/orca/workspaces/Drogon/qa-critical-399-muse/.qa/critical-PR-399/pr399-visual-entrypoint.mjs",
      "5a199d4ec66ab7cdcca78dbe2b2a95b162963f6bd33e2b718e7f9b31ef7a7af3  /Users/carlos/orca/workspaces/Drogon/gui-qa-owner-muse/.preflight/gui-qa-owner/gui-qa-launch.mjs",
      "891a05c9ca9dd74447bd09822b0d87dae3d5975fb80d9977e614843bbbcf7258  /Users/carlos/orca/workspaces/Drogon/gui-qa-owner-muse/.preflight/gui-qa-owner/gui-qa-outer.mjs",
      "14a1a6416a61b2a6877e8b21b481e82d971c540c3138d07b62efadebfcc2bc5f  /Users/carlos/orca/workspaces/Drogon/gui-qa-owner-muse/.preflight/gui-qa-owner/bootstrap-outer.sh"
    ]
  },
  "execution": {
    "runDir": null,
    "sourceHead": null,
    "packaged": { "bundle": null, "revision": null, "artifactDigest": null, "sealedDigest": null, "noticeCount": null, "signed": null },
    "acceptance": { "kind": null, "status": null, "reportPath": null, "osForeground": null },
    "stageReceipts": null,
    "callerTreeUnchanged": null
  }
}
```

## Provenance notes

- `source.headSha`/`treeSha`: `git rev-parse origin/main` /
  `git rev-parse origin/main^{tree}` after fetch (read-only).
- Every `source.scripts` / `assets` hash: `git show origin/main:<path> |
  sha256sum`. Recompute scope: `git show` streams the sealed blob; nothing is
  checked out or run. The exec lane re-verifies S0 (`rev-parse HEAD` equals
  `headSha`) before spending any other command.
- `runtime.binarySha256` + `mentuCommit`: transcribed from
  `/tmp/drogon-muse-glm-critical-qa/qa-critical-399-muse-task.txt`
  ("…staged NOT executed…"). The prep lane ran no checksum over any binary,
  listed no directory outside its own worktree, and started no process.
- `helpers.sha256`: four lines copied byte-for-byte from
  `/tmp/drogon-muse-glm-critical-qa/pr399-grant-hashes.txt`. Any mismatch
  between this draft and that file fails the manifest closed — the file wins.
- `execution.*`: all `null`. `sealedDigest` comes from `sealedBundleDigest`
  at S9/S11 (not from `verifiedBuildInfo` legacy metadata);
  `callerTreeUnchanged` is the `git status --porcelain -- :!.preflight`
  comparison from the `build-main.test.mjs` contract.
