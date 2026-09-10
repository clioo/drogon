# Sealed-build prep report (SOURCE-ONLY — nothing was built, installed, or executed)

Branch: `codex/sealed-build-prep` @ `59ed9740a4b84f73df1c41eef522ba347771d413`
Sealed source: `origin/main` HEAD (fetched 2026-09-10; worktree was cut at `76382b2`).
Method: read-only `git show origin/main:<path>` / `git rev-parse` / `sha256sum`
over pipes. No build step ran, no installer ran, no app or fixture process was
started, no user session was contacted. The prepared Mentu runtime and the
frozen gui-qa-owner helpers were never touched — their hashes below are
transcribed from the historical record, never worker-computed.

## What was inventoried

`scripts/build-main.sh` (sha256 `e9fc5ba8…f18aa`, 58 lines) decomposes into
12 stages. The script's only failure handling is an ERR trap that prints the
retained run-dir path — it performs **no descendant cleanup**, so every stage
below is wrapped in `run-stage.mjs` (this directory), which layers a detached
process group + deadline → SIGTERM → 5 s grace → SIGKILL → 2 s force wait on
top of the audited `scripts/acceptance-process.mjs` primitives
(`startAcceptanceProcess` shell:false/windowsHide:true, `waitAcceptanceExit`
with `exited`/`unverifiable` verdicts). Verdict discipline: `exited` is
recorded only when the direct child's exit is kernel-observed; every timeout,
kill, or loss of contact is `unverifiable`, never `exited`.

| Stage | Source command (unwrapped) | Deadline | Gating / notes |
|-------|----------------------------|----------|----------------|
| S0 | arg gate: only `''` / `--verify`; else exit 2, unknown `--install` rejected before any dir is created | — (exec-lane shell preamble, no child) | Proves the lane cannot install: contract test `build-main.test.mjs` asserts exit 2 |
| S1 | Node 24 PATH prep + `git node npm cargo` presence + Node-major assert | 60 000 ms | Node 24 required; pinned path `$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin` |
| S2 | `git -C "$root" remote get-url origin` | 30 000 ms | Read-only remote resolution; the URL is reused verbatim for the isolated clone |
| S3 | `mkdir -p .preflight/build-main` + `mktemp -d run-XXXXXXXX` (retained incl. failure) | 30 000 ms | Run dir is evidence; never deleted by the lane |
| S4 | `git clone --single-branch --branch main -- "$remote" "$run/source"` + `git rev-parse HEAD` | 600 000 ms | Fresh remote main, caller worktree untouched |
| S5 | `node -p 'require("./package.json").packageManager'` must match `^pnpm@[0-9]+\.[0-9]+\.[0-9]+$` (observed `pnpm@11.19.0`) | 60 000 ms | Fail-closed pin gate; no global tooling change |
| S6 | `npm install --prefix "$run/toolchain" --no-audit --no-fund --ignore-scripts "$manager"`, PATH-prepend `$run/toolchain/node_modules/.bin` | 600 000 ms | Exact pnpm installed *inside* the run dir only |
| S7 | `pnpm install --frozen-lockfile` (in `$run/source`) | 1 200 000 ms | Locked deps; contract asserts exact argv |
| S8 | `cargo fetch --locked` (offline packaging prep) | 1 200 000 ms | Locked Rust cache before packaging |
| S9 | `node scripts/package-desktop.mjs` → PACKAGED JSON `{status,bundle,revision,artifactDigest,noticeCount,signed}`; pipefail propagates failure, acceptance never runs on failure | 1 800 000 ms | Packager asserts clean `git status`, HEAD==revision, `verifiedBuildInfo`; kernel exit observer (`live-child-exit-observer.py`) may be attached to the direct child |
| S10 | `--verify` only: parse `package.log`, `findLast` `status==="PACKAGED"`, require `.bundle` | 60 000 ms | Separate gate: record bundle+revision+digest, stop for coordinator ack |
| S11 | `--verify` only: `DROGON_BACKGROUND_WINDOW=1 DROGON_VERIFY_OS_FOCUS=1 node scripts/accept-desktop.mjs --bundle "$bundle" --files` | 3 600 000 ms | Isolated `DROGON_DATA_DIR`/`DROGON_ELECTRON_PROFILE`; sealed model fixture only (fixtures-only); OS foreground observer compiled from `observe-macos-foreground.swift`; report `kind: packaged-desktop`, nonzero exit unless `PASSED` |
| S12 | Receipt print (`package.log` path; "No installed app or user data was replaced") | — (read from receipts) | Build lane installs nothing, stops nothing |

`--verify` is NEVER executed wholesale: S10 and S11 are separately wrapped
and separately gated (S10 → coordinator ack of bundle identity → S11).

## Audited primitives reused (all @ origin/main HEAD, hashes in manifest)

- `scripts/acceptance-process.mjs` — custody/spawn/teardown + verdicts.
- `scripts/live-child-exit-observer.py` — kernel exit observation (kqueue
  NOTE_EXIT / pidfd); `--probe` first; `register-error` classifies
  `unverifiable`, never `exited`.
- `scripts/acceptance-bridge-observation.mjs` — deadline polling pattern
  (default 15 s) for any readiness wait the exec lane adds.
- `scripts/sealed-model-fixture-lifecycle.mjs` — cleanup-protected fixture
  scope; close verdict must be `stopped` with zero outstanding streams/sockets.
- `scripts/acceptance-foreground.mjs` + `observe-macos-foreground.swift` —
  OS observer: swiftc compile (60 s bound), `READY\n` handshake (10 s),
  `stop\n` → exit wait (5 s), asserts test desktop never activated nor visible.
- Install gate (out of scope for the build lane, documented for rollback):
  `scripts/install-preview.mjs` + `scripts/desktop-artifacts.mjs` +
  `scripts/preview-install-lock.mjs`.

## Constraint compliance (recorded cross-run rules)

- Fixtures-only: S11 uses the sealed model fixture (`startAndSeedModelFixture`);
  no real model inference path is invoked by any stage.
- Background-hidden: S11 env forces `DROGON_BACKGROUND_WINDOW=1`; no stage
  calls focus/activation APIs (`bringToFront`, `focus`, `show` are absent from
  the entire chain — verified by read, not by run).
- Cleanup: every stage owns its descendants via process-group kill with the
  bounds above; run dirs are retained as evidence, never swept.
- No credentials, no global machine changes: S6 installs pnpm into the run
  dir; PATH scoping is per-stage env, never exported globally.
- Lane isolation: prep docs live only under `.preflight/sealed-build-prep/`;
  `features/mentu/**`, active-lane files, and coordinator-owned files were read
  only (or not at all). The prepared runtime binary was not executed/contacted
  BY THIS PREP LANE (historical PR399 executed this runtime; it is NOT a
  currently accepted stage input); other worktrees were never contacted.

## Rev-2 rework record (frozen-helper custody; supersedes rev-1 wrapper)

Rev-1 `run-stage.mjs` (custom detached-pgroup supervisor) was denied for
execution and is DELETED in the rework commit (history preserves commit
`8964399e` as evidence). Denial map D1–D8 lives in `10-WRAPPED-STAGES.md` §0.
What changed: all finite stages run under the actual frozen helpers
`bootstrap-outer.sh` + `gui-qa-outer.mjs` (hashes in §1, verified by direct
read against `/tmp/drogon-muse-glm-critical-qa/pr399-grant-hashes.txt`);
S0 gates sealed CONTENT (D8); S4 detaches to the exact sealed SHA (D7);
stages needing foreign cwd (S7/S8/S9) or bundle argv (S11) are specified as
owner extensions E1/E2 with review/tests — never a competing supervisor.
Prep docs stay on `codex/sealed-build-prep` and never merge as-is.

## Rev-3 rework record (E1 hydration + hash corrigenda; machine-verified)

E1 shipped under the same ownership (`.preflight/gui-qa-build/`: bootstrap
`e3bf6861…` (still matching live at rev-4), outer `6e029fd9…` 557 lines,
`build-manifest.mjs` `71e62a0e…`
424 lines/MANIFEST_VERSION=1, control tests `00a16d4b…` 512 lines — all read
in full at rev-3; the latter three are HISTORICAL alignment at rev-4, live
bytes differ under owner EOF1 correction, never current qualification;
all four hashed by direct read). `10-WRAPPED-STAGES.md` S7/S8/S9 now invoke
the E1 outer via a per-run source manifest authored post-S6 (budgets
1200/1200/1800 s, exact argv table, byte-attested tools, complete-log and
owned-pid focus gates); S10 parses the E1 complete `stdout.log`. E2
(--bundle/--files) remains refused and owner-pending.
Independent-audit hash fixes (all regenerated, none transcribed):
`scripts/desktop-artifacts.mjs` was 57 chars → full 64-hex;
`scripts/acceptance-process.mjs` was 55 chars → full 64-hex; PR399
entrypoint `1ebb84a0…` (stale snapshot line) → actual helper bytes
`c6bd3a28…`. Generation: `git show $SEALED:<path> | sha256sum` for sealed
blobs ($SEALED=59ed97…, origin/main verified equal), `sha256sum` direct
reads for helper/E1 bytes; every embedded hash re-verified by extraction
against fresh computation before commit (27/27 valid, all 64-hex). The
prepared-runtime binary hash stays record-transcribed by rule (contact
forbidden; provenance-only, never stage input).

## Rev-4 audit corrections (this commit)

(1) E1 drift: live re-hash shows `gui-qa-build-outer.mjs`,
`build-manifest.mjs`, `gui-qa-build-control.test.mjs` differ from the rev-3
pins (owner correcting EOF1); manifest `e1.files[]` now carries per-entry
`HISTORICAL` vs `CURRENT` status, and the pin is never presented as current
— the exec lane must re-read E1 source before authoring any per-run
manifest. (2) Runtime wording replaced verbatim: not executed/contacted BY
THIS PREP LANE; historical PR399 executed this runtime; NOT a currently
accepted stage input (manifest `runtime`, report constraints, stagedAt).
(3) Every `execution` null is now an explicit `"TODO-EXECUTION-GATE"`
string (15 fields) — no invented runDir/manifest/tool values anywhere.
(4) Non-qualification footer added (manifest JSON key + prose): 59ed is not
an accepted combined candidate; no native/build/E2/install permission
follows from metadata.

## Left for the gated execution lane

1. Coordinator gates: G1 (approve S0–S8 execution), G2 (ack S9 PACKAGED
   identity: revision + artifactDigest + sealedDigest), G3 (approve S11
   acceptance window), G4 (accept receipts; install remains a separate
   dispatch behind `install-preview.mjs` + rollback plan).
2. Fill the `execution` section of `20-MANIFEST-DRAFT.md` (run dir, clone HEAD,
   PACKAGED record, acceptance report, OS observation summary).
3. `node --test scripts/build-main.test.mjs` must pass on the exec host before
   S4 (regression contract for the script being wrapped).
4. Any stage ending `unverifiable` with surviving pids is escalated, never
   reaped with broad `pkill`/`killall`, and never recorded as `exited`.
