# Rollback-plan skeleton (acceptance + rollback required before ANY install)

Scope: the sealed-build lane (`scripts/build-main.sh`, with or without
`--verify`) has NO install path — unknown options (including `--install`)
exit 2 before any directory is created, and the receipt states "No installed
app or user data was replaced." This plan therefore covers (A) build-lane
rollback, which is purely process + evidence hygiene, and (B) the
acceptance gate that any FUTURE install dispatch must satisfy via
`scripts/install-preview.mjs`. No install happens in the build lane, ever.

## A. Build-lane rollback (this lane)

Trigger: any stage receipt with nonzero exit, `verdict: unverifiable`, or
coordinator abort; or a failed S0 pre-check.

1. Stop owned processes, bounded: for each live stage, SIGTERM to the
   detached `-pgid` → 5 s grace (`waitAcceptanceExit`) → SIGKILL to `-pgid`
   → 2 s force wait (`run-stage.mjs` does this automatically on deadline;
   on manual abort the coordinator replays the same sequence per pid in
   `stage-receipts.jsonl`).
2. Classify, never overclaim: a pid whose exit was not kernel-observed
   (direct-child `exit` event or `live-child-exit-observer.py` `exit` line)
   is `unverifiable`, never `exited`. Survivors after SIGKILL are escalated
   with pid + pgid + log offset; broad `pkill`/`killall` by executable name
   is forbidden (other sessions share the host).
3. Retain evidence: `$RUN` (source clone, toolchain, logs, receipts) is
   kept, including on failure — the script's ERR-trap semantics. Deletion
   requires explicit coordinator ack AFTER receipts and the manifest
   `execution` section are recorded.
4. Prove the caller is untouched: `git status --porcelain -- :!.preflight`
   in `$EXECROOT` must equal its pre-run value (the `build-main.test.mjs`
   contract); the only sanctioned delta is the retained
   `.preflight/build-main/run-*` directory.
5. No system state to revert: no global installs (S6 targets `$RUN/toolchain`
   only), no daemons registered, no user data paths written (S11 fixture
   dirs are temp-only and closed with `stopped` + zero outstanding
   streams/sockets, else the run fails).

## B. Acceptance gate before any install (future dispatch, NOT this lane)

`scripts/install-preview.mjs --bundle <Drogon.app> --report <report>` fails
closed unless ALL hold (read from source @ origin/main HEAD):

1. Report admission: `report.kind === "packaged-desktop"`,
   `report.status === "PASSED"`, `report.revision` and
   `report.artifactDigest` equal `verifiedBuildInfo(bundle)`, and
   `realpath(report.bundle) === bundle`. Legacy metadata-only reports
   without a detached sealed identity never authorize an install
   (`verifySealedBundle` + `assertSealedInstallAuthorization`, sealed
   version 3; staged copy and final target are each re-verified, never
   trusted from an earlier check).
2. Platform identity: `/usr/bin/codesign --verify --deep --strict`,
   `CFBundleIdentifier === ai.clioo.drogon`, per-user
   `~/Applications` + `~/Applications/.drogon-builds` (mode 0700) that pass
   the symlink-redirect refusal checks, all under `preview-install-lock.mjs`.
3. Rollback artifact: the pre-existing `Drogon.app` symlink target inside
   `.drogon-builds` is recorded as `previousBundle` (lenient check only —
   warns via `PREVIOUS-BUILD-LENIENT`, never blocks the verified incoming
   bundle). Install = copy → re-verify → atomic symlink rename; no process
   is stopped and user data is retained.
4. Install rollback: re-point `~/Applications/Drogon.app` at
   `previousBundle`, re-run `verifiedBuildInfo` + `verifySealedBundle` on
   it, emit the `INSTALLED`-shaped receipt naming the restored bundle.

## C. Sign-off checklist (coordinator)

- [ ] G1: S0 pre-check green (`rev-parse HEAD` = manifest `headSha`;
      `build-main.test.mjs` passes) → approve S1–S8.
- [ ] G2: S9 PACKAGED identity acked (revision + artifactDigest +
      sealedDigest) → manifest `execution.packaged` filled.
- [ ] G3: S11 window approved (background-hidden asserted; Swift observer
      available) → acceptance runs.
- [ ] G4: receipts reviewed (`stage-receipts.jsonl`, `package.log`,
      `acceptance.log`); manifest `execution` complete; `$RUN` retained.
- [ ] Install remains a separate dispatch: B.1–B.4 satisfied AND this
      checklist signed before `install-preview.mjs` is ever invoked.
