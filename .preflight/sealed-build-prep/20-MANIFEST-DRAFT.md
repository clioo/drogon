# Sealed-build manifest — DRAFT rev-3 (prep lane; `execution` filled by the gated lane)

Status: `DRAFT-rev3` (supersedes rev-2: E1-hydrated, all hashes regenerated).
Sections `source`, `assets`, `e1`, `runtime`, `helpers` are frozen from
read-only evidence below. Section `execution` is `null` until the gated lane
runs `10-WRAPPED-STAGES.md`. Hash classes stay distinct: source/asset bytes
are hashed from the exact sealed blobs (`git show $SEALED:path`, `$SEALED`
below); helper/E1 bytes are hashed from actual files by direct read;
the runtime binary hash is record-transcribed and CANNOT be regenerated —
contacting that binary is forbidden, so its entry carries provenance instead
of a fresh attestation (it is not stage input).

```json
{
 "status": "DRAFT-rev3",
 "source": {
  "repo": "clioo/drogon",
  "ref": "origin/main",
  "headSha": "59ed9740a4b84f73df1c41eef522ba347771d413",
  "treeSha": "f53ef34d2bad4196db38c8eaa4cde514ae7e3fed",
  "howVerified": "git fetch origin main (= headSha at regen); blobs git show $SEALED:<path> | sha256sum",
  "packageManager": "pnpm@11.19.0",
  "node": "24 (pinned $HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node)",
  "scripts": {
   "build-main.sh": "e9fc5ba8a835755bf4a587f8aa0a75527c54b8e4af43f93571dbf129c03f18aa",
   "build-main.test.mjs": "d0bd51aba4fca71d0df29725d3c6c40ed8c63015047cc1236bfb52ecaabb6073",
   "package-desktop.mjs": "33d5b0b8399d0a70363293e3bb2f020e6a3a24992ffc0a404e1e1367d3136264",
   "accept-desktop.mjs": "887d29ddff7234b8d357a529277f64edb346b7cb3e2d1e53450d27c1e7c870ee",
   "install-preview.mjs": "892b1fb776de634fedf3adf515a867d41e12eb26d37088486a8eda5e78f9356e",
   "desktop-artifacts.mjs": "dab8665832ceeb79eb9fa4247496a8111e8f990ae8f8d2af17f9f7a2be0ebb8c",
   "acceptance-process.mjs": "fe34d0076e4751ec766a8f961a5c6b4a5110ec81439278f835038ca39430bfa7",
   "acceptance-foreground.mjs": "f81c94de07062b53be15646ec38b80bf6a2a0b11d8c151f5f9ac32e77c22aac9",
   "acceptance-bridge-observation.mjs": "5af92c48eb712b447e2579f221872c5d4aecf7775c9371ce11fc9030ed6afdb7",
   "live-child-exit-observer.py": "825556d7ba22e6954e1ebe50a6661089555e8e00371e6582ecd18f5de08a480b",
   "sealed-model-fixture.mjs": "ebfab5a34b6fe64ba2decc0574cdf1f0d13ef0d321c6d00cf937e3b12f37856c",
   "sealed-model-fixture-lifecycle.mjs": "e3e06aaee144af3328d1a46937eb721c6ce4920cb5190bfc8041cb74bf9da45c",
   "observe-macos-foreground.swift": "70f9e94f39462fe2a1d7d9a09ab45a37ec97dbf60f635f86f4cccf9b14308f48"
  },
  "howHashed": "generator-emitted from exact sealed blobs; machine re-verified (see prep report rev-3)"
 },
 "assets": {
  "packageJson": "2a51c40a437762cccb2f8e33335ace5e52e58b294ab5c64aab514f1bed88f312",
  "pnpmLock": "8f78e2a20a60035624cacdac6d59038bd729ddd868e4d3d7c4f9140be3cb4a66",
  "cargoToml": "5809648558d17a0250ea4ded637cc29670dd1d675641dfe77ec1c81cfb850981",
  "cargoLock": "b72502f7f6adb77e3cfb5bb85a083d4f3ee162b1a0bc8ef9758577060fe9834b",
  "iconSource": {
   "path": "apps/desktop/resources/icon.svg",
   "sha256": "76f2c9b7f1c93e74fde8315f9a43b08d3dd8548a7f980b395624f835288b8a04",
   "builder": "scripts/build-app-icon.mjs (APP_ICON_SOURCE_FILE; R16-Z2 rename-before-seal in package-desktop.mjs)"
  },
  "notices": {
   "THIRD_PARTY_NOTICES.md": "21cafca260bd83c57ed14ebeeddfea771597947c559b57c68598a544c174761f",
   "verifiers": [
    "scripts/verify-final-bundle-notices.mjs",
    "scripts/verify-e5-package-notices.mjs",
    "scripts/verify-e5-font-provenance.py"
   ]
  },
  "generatedAtExecution": [
   "Drogon.app bundle bytes",
   "icon.icns",
   "sealed entry manifest (MAX_SEALED_ENTRIES=100000, MAX_SEALED_BYTES=2GiB)"
  ]
 },
 "e1": {
  "note": "E1 sealed-BUILD stage runner, CURRENT interface as read (owner path .preflight/gui-qa-build/, read-only). Replaces rev-2 E1-request for S7/S8/S9. E2 (--bundle/--files/upgrade/installed/inference) stays forbidden.",
  "files": {
   "bootstrap-build-outer.sh": "e3bf68616fe42c0f6d654982d9b322c09fd3c881dc6941bcae3e3a344906c567",
   "gui-qa-build-outer.mjs": "6e029fd9eaaac4e7664aac6695ff89cae1a7882792a5484c7b5ab23799ff3437",
   "build-manifest.mjs": "71e62a0ea8bbbcc2ddbb049e789b3820cec59e08d93df7749b3b5690f71c6721",
   "gui-qa-build-control.test.mjs": "00a16d4b43c09da54cf703e4a845d49845d5d8aa4c7513903d5484a3a4bf40c6"
  },
  "howVerified": "sha256sum actual bytes by direct read; content read in full (outer 557 lines, manifest 424 lines)",
  "cli": "--output-root <dir> --source-manifest <abs.json> --stage <s7-install|s8-fetch|s9-package> --budget-sec <N,1..3600,SECONDS,must equal manifest stage budget>",
  "manifestVersion": 1,
  "manifestShape": {
   "bannedKeys": [
    "env",
    "command",
    "argv",
    "cwd",
    "shell"
   ],
   "sha": "40-hex git HEAD (distinct from 64-hex file hashes)",
   "requiredAssets": [
    "package.json",
    "pnpm-lock.yaml",
    "Cargo.toml",
    "Cargo.lock"
   ],
   "tools": {
    "node": {
     "sha256": "64-hex"
    },
    "pnpm": {
     "sha256": "64-hex"
    },
    "cargo": {
     "path": "abs,outside runDir",
     "sha256": "64-hex"
    },
    "rustc": {
     "path": "abs,outside runDir",
     "sha256": "64-hex"
    }
   },
   "stages": [
    "s7-install",
    "s8-fetch",
    "s9-package"
   ]
  },
  "stages": {
   "s7-install": {
    "budgetSec": 1200,
    "argv": [
     "<NODE24>",
     "<runDir>/toolchain/node_modules/.bin/pnpm",
     "install",
     "--frozen-lockfile"
    ],
    "cwd": "<runDir>/source",
    "note": "pnpm JS invoked directly under pinned Node (no shebang/PATH lookup); same script file+args as build-main.sh bare pnpm (build-manifest.mjs stageArgv)"
   },
   "s8-fetch": {
    "budgetSec": 1200,
    "argv": [
     "<cargo>",
     "fetch",
     "--locked"
    ],
    "cwd": "<runDir>/source"
   },
   "s9-package": {
    "budgetSec": 1800,
    "argv": [
     "<NODE24>",
     "scripts/package-desktop.mjs"
    ],
    "cwd": "<runDir>/source"
   }
  },
  "env": {
   "base": "frozen outer allowlist verbatim (BACKGROUND=1, VERIFY_OS_FOCUS=1, private HOME/usage fixture)",
   "additions": "PATH=<nodeDir>:<toolchainBin>:<cargoDir>:/usr/bin:/bin:/usr/sbin:/sbin; CARGO_HOME/RUSTUP_HOME under retained runDir (S8 cache survives for S9); RUSTC exact; no manifest env passthrough",
   "nodeBinReferenceSha256": "27db838bb204ef7c21df2931f5656e4c8fb32e6e947f363a402b49714d32b5b1"
  },
  "gate": {
   "pre": [
    "realpath identity (runDir/sourceRoot canonical, sourceRoot==runDir/source, tools outside runDir)",
    "HEAD==manifest.sha (40-hex)",
    "status clean",
    "required asset hashes",
    "tool BYTES attested, rechecked immediately before spawn",
    "--budget-sec==manifest budget; no spawn after deadline"
   ],
   "post": [
    "tooling HEAD re-attested",
    "source HEAD/clean/assets re-attested",
    "complete logs (stdout.log/stderr.log sealed+drained, stdio eof) else FAIL",
    "observer verifies EVERY journaled owned pid for focus/windows (not only electron|drogon)"
   ]
  },
  "custody": "frozen: monotonic budget+30s reserve, handle-spawn (no shell/detached), identity+deadline rechecks before signals, every outer signal/force/rescue=>FAIL, unverifiable on unknown, roots retained"
 },
 "runtime": {
  "note": "READ-ONLY REFERENCE, provenance-only. Staged, never executed, NOT active runtime, never stage input, never contacted by this lane. Hash below is record-transcribed and deliberately NOT regenerated (regeneration requires contact).",
  "provenanceRecord": "/tmp/drogon-muse-glm-critical-qa/qa-critical-399-muse-task.txt",
  "stagedAt": "/Users/carlos/orca/workspaces/Drogon/qa-399-integrated-ui-astra/.qa/visual-PR-399 (runtime-preparation-receipt.json + runtime-staging/) \u2014 NOT CONTACTED",
  "mentuRelease": "Mentu0.5.0",
  "mentuCommit": "c82ccfa0ebbe77d62193e068821ba6e74f87a8d3",
  "binarySha256": "f00528a940185e9433ad65b02e7de251d7d3d856c9d24d38f8b1474a1ca8bc5d",
  "bundledAtExecution": "apps/desktop/resources/mentu-runtime lands as extraResource only if present in the fresh clone; fingerprinted by fingerprintBundle/sealedBundleDigest at S9, never trusted by path"
 },
 "helpers": {
  "note": "Actual-byte hashes by direct read (never transcribed tables). The stale 1ebb84a0 record line named a snapshot generation, not current bytes; entrypoint now carries actual bytes c6bd3a28. Launch/outer/bootstrap match the grant record exactly.",
  "record": "/tmp/drogon-muse-glm-critical-qa/pr399-grant-hashes.txt",
  "files": {
   "pr399-visual-entrypoint.mjs": {
    "sha256": "c6bd3a2884cb1ea6d9e6b61fe7aef6f93dbdf618007e5c53289bf34ae0453802",
    "path": "/Users/carlos/orca/workspaces/Drogon/qa-critical-399-muse/.qa/critical-PR-399/pr399-visual-entrypoint.mjs"
   },
   "gui-qa-launch.mjs": {
    "sha256": "5a199d4ec66ab7cdcca78dbe2b2a95b162963f6bd33e2b718e7f9b31ef7a7af3",
    "path": "/Users/carlos/orca/workspaces/Drogon/gui-qa-owner-muse/.preflight/gui-qa-owner/gui-qa-launch.mjs"
   },
   "gui-qa-outer.mjs": {
    "sha256": "891a05c9ca9dd74447bd09822b0d87dae3d5975fb80d9977e614843bbbcf7258",
    "path": "/Users/carlos/orca/workspaces/Drogon/gui-qa-owner-muse/.preflight/gui-qa-owner/gui-qa-outer.mjs"
   },
   "bootstrap-outer.sh": {
    "sha256": "14a1a6416a61b2a6877e8b21b481e82d971c540c3138d07b62efadebfcc2bc5f",
    "path": "/Users/carlos/orca/workspaces/Drogon/gui-qa-owner-muse/.preflight/gui-qa-owner/bootstrap-outer.sh"
   }
  }
 },
 "execution": {
  "runDir": null,
  "sourceManifest": null,
  "sourceHead": null,
  "packaged": {
   "bundle": null,
   "revision": null,
   "artifactDigest": null,
   "sealedDigest": null,
   "noticeCount": null,
   "signed": null
  },
  "acceptance": {
   "kind": null,
   "status": null,
   "reportPath": null,
   "osForeground": null
  },
  "stageReceipts": null,
  "callerTreeUnchanged": null
 }
}
```

## Provenance notes

- Sealed source `$SEALED=59ed9740a4b84f73df1c41eef522ba347771d413`
  (`origin/main` verified equal at regen time; blobs read as
  `git show $SEALED:<path> | sha256sum` — immune to ref movement).
- Every `source.scripts` / `assets` hash above was emitted by the generator,
  never hand-copied; the rework commit includes a machine check that each
  embedded hash re-verifies against its blob (see prep report rev-3).
- Rev-2 corrigenda: `scripts/desktop-artifacts.mjs` and
  `scripts/acceptance-process.mjs` were 57/55-char transcription corruptions;
  both are 64-hex above. The `1ebb84a0…` PR399 entrypoint line was a stale
  record entry (it names the `.1ebb84a0.snapshot.mjs` generation, not current
  bytes); `helpers` now carries the actual-byte hash `c6bd3a28…`.
- `runtime.binarySha256` is transcribed from
  `/tmp/drogon-muse-glm-critical-qa/qa-critical-399-muse-task.txt` ("staged
  NOT executed"). Regenerating it would require contacting the binary's host
  path, which the lane rules forbid; it stays provenance-only and is never
  stage input — the E1 gate attests only what the fresh clone contains.
- `e1` pins are interface alignment, not copied tool bytes: E1 attests
  per-run tool bytes from the execution `sourceManifest` (authored post-S6);
  the owner test-fixture paths (`/opt/homebrew/bin/cargo`) are convention
  examples, never pins. `nodeBinReferenceSha256` is an informational read of
  the prep host's Node24 binary, re-attested per run by the E1 outer itself.
- `execution.sourceManifest` is the per-run E1 manifest the exec lane authors
  post-S6 (`$RUN/source-manifest.json`, shape `build-manifest.mjs`
  `validateBuildManifestShape`, version 1); `sealedDigest` comes from
  `sealedBundleDigest` at S9/S11, never from legacy metadata.
