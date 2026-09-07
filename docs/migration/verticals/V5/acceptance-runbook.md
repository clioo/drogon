# V5 acceptance runbook — per-vertical and combined acceptance from a clean seed checkout

2026-09-07. Head observed: `2d9990e` (checkpoint-001 docs present). Doc-first
deliverable: this file only; no harness was executed while writing it
(inspection of `scripts/accept-core-cli.mjs`, `scripts/accept-desktop.mjs`,
`package.json` lanes, `docs/migration/packaged-integrated-acceptance.md`,
`docs/migration/verticals/V5/acceptance-e5-decision-prep.md`,
`docs/migration/verticals/V5/checkpoint-001.md`). Nothing installed.

## 0. Ownership split (vertical leaves vs ROOT)

- **Vertical leaves** (V1–V5, in their own Orca worktrees, branches
  `codex/vertical-*`): run the offline contract lanes and, when their
  assignment authorizes it, the service/CLI or development desktop harness
  **from their own worktree only**; record exact command, runtime, exit code
  and counts in their checkpoint file; never touch another worker's worktree
  or dirty files.
- **ROOT only**: `package:desktop` (build + notices), packaged acceptance
  `accept:desktop --bundle`, `install:preview` and installed-artifact
  verification, the integrated combined gate on the integrated checkout,
  PR integration, merges to `main`/release, and any publishing decision.
  No vertical ever packages, installs, publishes, provisions or submits
  real data.
- Commits: a vertical commits only on its own branch as its assignment
  directs; ROOT owns merge order and the final combined gate.

## 1. Prerequisites (verify before running anything)

1. Clean seed checkout: `git pull --ff-only`, then `git status` must be clean.
   Work in your assigned worktree; never `/Users/carlos/Documents/Drogon-mentu-session`
   (READ-ONLY reference; never a cwd, never modified, nothing ever executed
   from it).
2. Node 24 runtime at the known cache path
   `/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`
   (system `node` may differ, e.g. v26; declared engine era is Node 24). Do
   not rediscover it by scanning the home directory; do not install Node.
3. pnpm and the Rust toolchain (cargo) available. `cargo build --workspace
   --locked` must have produced `target/debug/drogond` and
   `target/debug/drogon-cli` before any harness that needs them
   (`accept-core-cli` asserts their presence and exits otherwise).
4. Dependencies already present — do NOT reinstall: root `node_modules/.bin`
   has only `electron-packager`, `playwright`, `prettier`;
   `apps/desktop/node_modules/.bin` has `vitest` and `tsc` (leader-verified).
   If something is missing, report it; never fix via lockfile/global changes.
5. Harness reality check: `accept-core-cli.mjs` and `accept-desktop.mjs`
   spawn real daemons (and Electron + CDP for desktop). They isolate all
   state in OS tmpdirs, never touch user sessions, and use no models or
   credentials. Run them only from your own worktree, only when your
   assignment includes harness execution.

## 2. Commands in order (offline first, then harnesses)

Run each from your worktree root as cwd. Record command + runtime + exit
code + counts after every step. An env failure is reported, never "fixed".

### 2.1 Offline contract lanes (no daemon, no Electron)

1. Sealed-bundle admission (single file; observed in this seed, Node24):
   `/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/parity/ports/WP-ENG-RUNTIME/package-admission/sealed-bundle-identity.test.mjs`
   Expected: exit 0, `tests 15 / pass 15 / fail 0 / skipped 0` (observed
   263 ms here; leader re-observed 15/15). Tree stays clean (tmpdir only).
2. Combined packaging lane (8 test files):
   `pnpm test:packaging`
   **Leader-observed seed receipt (V5 review, 2026-09-07, this worktree as
   cwd, Node24): tests 70 / pass 70 / fail 0 / cancelled 0 / skipped 0 /
   exit 0.** Equivalent direct invocation of all eight files also ran
   green. Expected on rerun: exit 0 with fresh counts recorded per run;
   Node `--test` prints ✔/✖ lines plus `ℹ tests/pass/fail` counters.
3. Renderer contracts + typecheck (vitest/tsc from apps/desktop):
   `pnpm test:renderer-contracts` and
   `pnpm typecheck:renderer-contracts`
   Reference expectation from the root integrated acceptance: 72
   renderer-contract tests and both typechecks pass. Record fresh counts.
4. Rust workspace + desktop suites (heavier; needs cargo):
   `pnpm test` (= `cargo test --workspace --locked && pnpm --filter
   @drogon/desktop test`). Reference: 114 desktop tests passed on the
   accepted candidate. Record fresh counts.
5. Scoped desktop vitest subsets (per-vertical; two leader-observed
   examples from this seed): `apps/desktop/node_modules/.bin/vitest run
   src/main/native-runtime-bootstrap.test.ts` → 24/24;
   `native-client.test.ts` + `daemon-path.test.ts` → 17/17.

### 2.2 Service/CLI acceptance harness (spawns a real daemon)

6. `pnpm accept:core-cli` (variants: `--coordination` adds native
   coordination/worker-report probes; `--harness pi` adds the installed Pi
   harness launch with an isolated no-credential profile).
   Requires step 1 prerequisites (debug binaries exist).
   Expected stdout: one JSON line `{"status":"PASSED","checks":[…],
   "report":".preflight/acceptance/core-cli-<ts>-<uuid>.json"}`, exit 0.
   Checks include `daemon-start-and-cli-status`,
   `second-start-refuses-without-mutating-incumbent`,
   `concurrent-admission-replay-and-conflicting-request-id`,
   `pty-input-output-across-independent-cli-connections`,
   `actual-service-crash-preserves-identity-records-and-completed-receipts`.
   Exit 1 + `status:"FAILED"` with `report.error` on any failure; cleanup
   verdicts must read `exited`, never forced.

### 2.3 Desktop acceptance (spawns drogond + Electron via CDP)

7. Development mode: `pnpm accept:desktop`
   (daemon from `target/debug`, Electron from apps/desktop; renderer
   identity `source-build-not-final-artifact`).
8. Packaged mode (ROOT only, after `pnpm package:desktop`):
   `pnpm accept:desktop --bundle dist/<Drogon.app>` (macOS-enforced).
   Expected: stdout JSON `status:"PASSED"`, `identityProof:"sealed-final-artifact"`
   with `sealedVersion/sealedDigest/sealedFileCount/sealedTotalBytes`, a
   `.preflight/acceptance/desktop-<ts>-<uuid>/` directory containing
   `report.json`, `light.png`, `dark.png`, `narrow.png` (`failure.png` +
   `failureUi` on failure), exit 0. The accepted corrected instrument ran 14
   checks, ending with
   `sealed-final-artifact-identity-unchanged-after-acceptance`; a bundle
   changed mid-run fails closed.

## 3. What must NOT run

- `pnpm install:preview` — ROOT-only, and only as part of an accepted
  handoff; never to replace a live installed preview or user sessions.
- Any provisioning, publishing, service deployment, real-data submission or
  telemetry destination; acceptance fixtures use isolated tmpdir profiles
  with no models, credentials or user data.
- `scripts/verify-e5-package-notices.mjs` against this seed as SOURCE_ROOT:
  it asserts `git rev-parse HEAD == c97906287bb7a390b25e2025b600d9fb3c25d9c3`
  and would fail by design here (it audits the pinned read-only reference
  and needs registry network). Not part of acceptance.
- Legacy E2E helpers from the source reference (parity-runner matrix §2
  prohibitions): never execute them; they are reuse candidates only.
- Any edit to manifests, lockfiles, protocol, CI or scripts to make a
  failing environment pass — report the failure instead.
- Running anything from another worker's worktree or from the read-only
  reference.

## 4. Per-vertical selection and checkpoint evidence plug-in

The runners are shared; each vertical runs the subset matching its
five-vertical-handoff ownership and records it in its checkpoint doc
(pattern: `docs/migration/verticals/V5/checkpoint-001.md`):

| Vertical evidence | Lanes that feed it |
| --- | --- |
| V1 core/protocol | `pnpm test` (Rust), `accept:core-cli` (+ `--coordination` when authorized) |
| V2 renderer/UI | `test:renderer-contracts`, `typecheck:renderer-contracts`, scoped desktop vitest, `accept:desktop` dev mode |
| V3 bridge/services | `pnpm test`, `accept:core-cli`, session/liveness probes |
| V4 bots/schedule/history | scoped desktop vitest + Rust domain tests |
| V5 platform/release | `test:packaging`, sealed-bundle admission, `package:desktop`/packaged acceptance (ROOT), E5 notice/resource evidence |

Checkpoint fields fed by this runbook: base/head SHAs + clean status (§1),
GREEN commands with exit codes/counts (§2), integrated/platform evidence and
exact package identity — sealed digest + report path for packaged runs (§2.3),
unverified items and env failures recorded verbatim (§3), owned
sessions/processes with settlement verdicts copied from the harness report
cleanup array. ROOT integration then: collects checkpoints, runs its combined
gate (`pnpm test` + `test:packaging` + typechecks + `package:desktop` +
packaged acceptance) on the integrated checkout, and only ROOT proceeds to
install/preview verification and release decisions per the E5 decision-prep
options.

## 5. Limits

Counts cited as "reference expectation" come from root's accepted integrated
candidate, not from this seed; every run records its own fresh counts. No
harness was executed for this document; §2 expected outputs are derived from
the harness sources and the accepted integrated-acceptance receipt.
