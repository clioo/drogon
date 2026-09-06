# Parity Baseline Capsule Runner

Test-infrastructure only. Not a product implementation and does not
establish feature parity for any UI surface. Builds and validates one
reusable mechanism — a "capsule" — for running a pinned, hash-verified
slice of the read-only legacy source
(`/Users/carlos/Documents/Drogon-mentu-session`, read-only reference) in
isolation, piloted on one target: the pure orchestration-ask timeout clamp
policy.

**Coordinator checkpoint (22:40 UTC):** the worker history below is superseded
for current verification by `tests-first-checkpoint.md`. Three additional
regressions reproduced config-content drift, removed receipt obligations and
dangling results-path symlinks; targeted fixes brought the suite from 63/66 to
66/66 passing. A fresh coordinator pilot also passed 2/2 using the original
installed Vitest 4.1.11, Node 24.19.0 and unchanged source assertions. This
accepts the named pure pilot and tested machinery, not arbitrary manifests as
safe executable code, full-suite parity or a security sandbox. Each additional
capsule still needs its own dependency/effect and equivalence review.

**Coordinator acceptance status:** this is a worker-authored implementation
and its own worker-authored test evidence; it is not itself a coordinator
acceptance record. This is the **second** correction pass. The first pass's
claims were rejected (arbitrary `capsuleRoot` acceptance, an unenforced
"only approved manifests execute" claim, a CLI that exited 0 after a failed
test run, execution through the `apps/desktop/node_modules/.bin` shell
shim). The **second** review found the first pass's fixes still incomplete
— an unsanitized `capsuleId`/`--label` reaching `mkdtemp`, an
`evaluateExecution` that accepted an all-pending/zero-passed/`success:false`
report as "ok", an execution-approval digest that reread a manifest file
that could have changed since staging, a hardcoded personal Node path, and
an exact-casing requirement on the fixture commit trailer that the first
pass got wrong. This document describes the **second** round of fixes below,
again with what is actually runtime-enforced (verified by
`scripts/run-parity-baseline-capsule.test.mjs` and the live commands in
§"Exact commands run and results"). Stating a property is enforced here is
a claim by the worker; it becomes an accepted fact only when the coordinator
says so.

Owned files (unchanged scope): `scripts/run-parity-baseline-capsule.mjs`
(the runner), `scripts/run-parity-baseline-capsule.test.mjs` (its unit
tests — own throwaway git fixture and fake "repo root"; never touches the
real legacy repo or this repo's real `.preflight/parity-baseline`), and this
document. **`tests/parity/baseline-capsules/orchestration-ask-timeout.json`
was explicitly out of scope for this pass and was not modified** — its
bytes, pinned digests, and the pilot's two assertions remain exactly what
they were.

## Retained evidence: what exists, what doesn't, and why

`.preflight/parity-baseline/` (gitignored) currently contains, alongside
whatever the coordinator's own tooling has placed there
(`rerun-check.json`, not authored or touched by this worker):

- `orchestration-ask-timeout-DOPVXV/`, `orchestration-ask-timeout-xtE0IP/` —
  retained from the prior (first-correction-pass) session.
- `orchestration-ask-timeout-hxiNwk/` (stage-only) and
  `orchestration-ask-timeout-tonjK1/` (execute) — new nonce directories
  from this pass, described in §"Exact commands run and results" below.

**A named, fixed directory called `pilot-run-1/` existed in an earlier
session, before this runner switched to atomic `mkdtemp`-generated names.
That directory no longer exists; its receipt is lost.** This document does
not know, and does not claim to know, why — only that the current state of
`.preflight/parity-baseline/` does not contain it. Nothing in this pass
deleted it, and this pass did not delete or modify any other entry already
present in that directory. **The rule going forward, stated plainly because
it was violated once already: never delete `.preflight/parity-baseline`
itself, and never delete any retained pilot directory under it. The only
directories this task's own test suite removes are the exact disposable
fixture directories it creates itself under `os.tmpdir()`** (a throwaway
git source repo, a throwaway fake "repo root", and a throwaway work
directory per test run — see `beforeEach`/`afterEach` in
`scripts/run-parity-baseline-capsule.test.mjs`), never anything under this
repo's real `.preflight/`.

## What changed in this (second) pass, and why

1. **`capsuleId`/`--label` are now validated as a single safe path
   component before any `mkdir`/`mkdtemp` call.** Both flow directly into
   the prefix passed to `mkdtempSync`; an unsanitized value like
   `../../evil` would have made `mkdtemp` create its unique directory
   *outside* the canonical parent entirely. `assertSafeSingleComponentId`
   (pattern `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, plus explicit rejection of
   `/`, `\`, and null bytes) now runs on `manifest.capsuleId` inside
   `loadManifest` and on a caller-supplied `label` inside `stageCapsule`,
   **both before `ensureCanonicalCapsuleParent` — the first
   filesystem-mutating call — ever runs.** Two dedicated tests stage a
   manifest with `capsuleId: "../../escape-attempt"` and a `label:
   "../../escaped-via-label"` respectively and assert not just that
   `stageCapsule` throws, but that **the canonical parent directory was
   never created at all** (`existsSync(canonicalParent)` is `false`
   afterward) and that no directory appeared at the attempted escape
   target.
2. **`evaluateExecution` now requires genuinely coherent, successful,
   fully-passing counts**, not just a total-test-count match. The
   coordinator's adversarial example —
   `{numTotalTests:2,numPassedTests:0,numFailedTests:0,numPendingTests:2,success:false}`
   — is now rejected on at least three independent grounds: `success !==
   true`, `numPassedTests` (0) not equal to the expected passing count (2),
   and (with the default `allowPendingTests: false`, since this pilot has
   no predeclared, reviewed policy permitting skipped/todo tests) 2
   reported pending tests. Beyond that specific case,
   `numTotalTests`/`numPassedTests`/`numFailedTests`/`numPendingTests` are
   each required to be a finite non-negative integer (rejecting missing,
   string, or negative values); the four counts plus `numTodoTests` are
   required to sum to `numTotalTests` (rejecting internally incoherent
   reports); a nonzero `numFailedTestSuites` is rejected even when
   `numFailedTests` is zero (a failed-suite-with-zero-failed-tests report,
   e.g. a suite-level setup/teardown failure, no longer silently passes);
   and `numPendingTests`/`numTodoTests` above zero are rejected by default,
   with `allowPendingTests: true` available as an explicit, named opt-in
   for a future capsule whose manifest documents a reviewed policy for it
   — this pilot's manifest declares no such policy, so the default applies.
3. **Execution approval now binds the manifest bytes as staged, not a
   fresh reread at execute time.** `stageCapsule` computes
   `manifestSha256` once, from the manifest file as it existed at staging,
   and returns it (and writes it) as part of a **stage receipt**
   (`<capsuleRoot>/stage-receipt.json`). `executeCapsule` no longer takes a
   loose `{ capsuleRoot, entryTestFile, manifestPath }` triple; it takes
   the receipt object itself, cross-checks its binding fields
   (`capsuleId`, `sourceRevision`, `manifestSha256`, `entryTestFile`,
   `capsuleRoot`) against the on-disk `stage-receipt.json` at that exact
   path (refusing a fabricated or mismatched receipt, and refusing a
   `capsuleRoot` outside the canonical parent), then compares
   `approvedManifestSha256` against the receipt's `manifestSha256` — the
   value captured at stage time — never against a fresh read of the
   manifest file. A dedicated test edits the manifest file on disk *after*
   staging and confirms the resulting digest differs from what was staged,
   then confirms execution still proceeds (fails later, only on an
   unrelated missing-vitest-entry condition in the test) using the
   stage-time digest. Before spawning anything, `executeCapsule` also
   re-verifies every staged file's and the license file's current bytes
   against their recorded digests (refusing if any changed since staging)
   and confirms the generated `vitest.config.mjs` still exists — and it
   refuses outright if a `vitest-results.json` already exists at the
   target path, rather than letting vitest silently overwrite prior
   evidence.
4. **No hardcoded personal Node path.** `--node-bin` now defaults to
   `process.execPath` (whatever Node is running the script); the previous
   default silently pointed at one specific absolute path under
   `/Users/carlos/.cache/...`. `--node-bin` remains available for an
   explicit override — the pilot run below passes it explicitly to use the
   provided Node 24 runtime, and the report records exactly which binary
   and version ran, rather than assuming a default silently matched.
5. **Fixture commit trailer casing corrected to exactly
   `Co-authored-by: Codex <noreply@openai.com>`** (git's own conventional
   casing — lowercase `authored`), replacing the previous pass's
   `Co-Authored-By` variant.

## Manifest format

Unchanged; out of scope for this pass. See
`tests/parity/baseline-capsules/orchestration-ask-timeout.json`. Required
shape (`loadManifest`): `capsuleId` (non-empty string, now additionally
required to be a single safe path component — see above),
`sourceRevision` (40-hex-char git SHA), `files[]` (`{ path, role:
"test"|"module", sha256 }`, no duplicates, relative/non-aliasing/
non-escaping paths only), `entryTestFile` (must be one of `files[]`),
`license` (`{ path, sha256, spdxId?, copyright? }`). Optional pass-through
documentation fields: `sourceVitestVersion`, `sourceVitestConfigFile`,
`sourceVitestConfigDifferencesFromCapsule`, `expectedTestCounts`,
`dependencyClosureNote`, `isolationRationale`.

## Refusal guarantees (each covered by a unit test; 63 passing)

**Id/path safety:** `capsuleId`/`--label` not a single safe path component
(includes `/`, `\`, empty, non-alphanumeric leading character, or a `..`
attempt) — refused before any `mkdir`/`mkdtemp`. Manifest path: absolute;
`..` traversal; null byte; backslash; a `./`-alias form; duplicate paths; a
missing/malformed `entryTestFile` or `license` block; a missing
`capsuleId`.

**Source verification:** `git -C <source-root> rev-parse HEAD` not matching
`sourceRevision`; working-tree bytes or pinned-revision-blob bytes
(`git show <rev>:<path>`) not matching a pinned sha256; any symlinked path
component anywhere in a pinned path.

**Capsule location:** `sourceRoot`/`repoRoot` identical or nested either
direction; a symlink anywhere in the existing `.preflight`/
`.preflight/parity-baseline` ancestry; a manifest path colliding with
another manifest path, the license path, or a reserved generated filename
(`vitest.config.mjs`, `vitest-results.json`, `stage-receipt.json`); a
computed target resolving outside the freshly created capsule directory;
an exclusive-create write finding something already at the target path.

**Execution:** a receipt that isn't backed by a genuine, matching
`stage-receipt.json` on disk (fabricated receipt, or one pointed at a
`capsuleRoot` outside the canonical parent); a missing/malformed/
mismatched `approvedManifestSha256` (compared to the receipt's
stage-time digest, not a fresh manifest reread); a missing `node`/
`vitest.mjs`; any staged or license file whose current bytes no longer
match what was recorded at staging; a missing generated
`vitest.config.mjs`; an already-existing `vitest-results.json` at the
target path; (post-run) a timeout, non-zero exit, missing/unparseable
results, a non-finite/negative/incoherent count field, any failed test or
failed suite, `success !== true`, any pending/todo test (no opt-in
declared for this pilot), or a passed-count/total-count mismatch against
`expectedTestCounts`.

All of the above are exercised by 63 passing tests, run against disposable
git fixtures created inside `os.tmpdir()` (commits made with `-c
user.email=capsule-test@example.invalid -c user.name=capsule-test` plus a
`Co-authored-by: Codex <noreply@openai.com>` trailer) — never against the
real legacy repo or this repo's real `.preflight/parity-baseline`.

## Determinism

Unchanged from the prior pass: staging the same manifest twice into the
same `repoRoot` produces two different (`mkdtemp`-unique) capsule
directories whose contents are nonetheless byte-for-byte identical to each
other and to the manifest's pinned digests.

## Execution model

Execution is opt-in (`--execute` plus a required
`--approved-manifest-sha256`, checked against the stage-time receipt, not a
fresh manifest reread). When executing:

- Spawns `<nodeBin> <vitestEntry> ...args` directly — `nodeBin` defaults to
  `process.execPath`; `vitestEntry` defaults to
  `apps/desktop/node_modules/vitest/vitest.mjs`, never the `.bin` shell
  shim on any platform.
- Re-verifies every staged/license file and the generated config exist and
  match their recorded digests, and refuses to reuse an existing results
  path, before spawning anything.
- Bounded by `--timeout-ms` (default 30000, hard cap 120000) via
  `spawnSync`'s own single-child `timeout`. This signals only that one
  child process; it is not, and is not claimed to be, a general
  process-tree kill — a controlled fake-runner test proves the signal
  fires, and a second controlled fake-runner test proves a non-zero exit
  with no results file is reported, but neither test (nor anything in this
  runner) claims to bound a child that traps/ignores the signal or detaches
  a grandchild.
- No network calls, no credential access, no global settings, no app or
  service launches, and no Git mutation.

## Exact commands run and results (this pass's pilot evidence)

All commands run from `/Users/carlos/Documents/Drogon-rewrite`.

**Unit tests, under the provided Node 24 runtime's PATH:**

```
PATH="/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  apps/desktop/node_modules/.bin/vitest run scripts/run-parity-baseline-capsule.test.mjs --root . --dir scripts
```

Result: `Test Files  1 passed (1)` / `Tests  63 passed (63)`.

**New nonce stage-only run** (capsule root
`.preflight/parity-baseline/orchestration-ask-timeout-hxiNwk/`):

```
node scripts/run-parity-baseline-capsule.mjs \
  --manifest tests/parity/baseline-capsules/orchestration-ask-timeout.json \
  --source-root /Users/carlos/Documents/Drogon-mentu-session
```

Exit code 0; all 3 pinned files + `LICENSE` staged and digest-matched; no
execution attempted.

**New nonce execute run** (capsule root
`.preflight/parity-baseline/orchestration-ask-timeout-tonjK1/`, explicit
Node 24 binary, retained; prior directories `orchestration-ask-timeout-
{DOPVXV,xtE0IP}` and the coordinator's `rerun-check.json` left untouched):

```
MANIFEST_SHA=$(shasum -a 256 tests/parity/baseline-capsules/orchestration-ask-timeout.json | awk '{print $1}')
NODE24=/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
node scripts/run-parity-baseline-capsule.mjs \
  --manifest tests/parity/baseline-capsules/orchestration-ask-timeout.json \
  --source-root /Users/carlos/Documents/Drogon-mentu-session \
  --execute --timeout-ms 30000 \
  --node-bin "$NODE24" \
  --approved-manifest-sha256 "$MANIFEST_SHA"
```

Result (exit code 0):

- `sourceRevision`: `c97906287bb7a390b25e2025b600d9fb3c25d9c3` (live-verified).
- File hashes (unchanged from every prior pass, matched and re-verified):
  `orchestration-ask-timeout.test.ts` →
  `37286eff3fb99e7a1e854854c2638ccc4a5e963edc176babc9e773d15299d13b`;
  `orchestration-ask-timeout.ts` →
  `6f6cafcfd2e4133736d3f861c728db98dad615e23e54cf6b3925c76c5579f930`;
  `timer-delay.ts` →
  `7e529ed30d1b25521f5d72d7c2a6d05d16efe66faf2619b859d67b330cca767f`;
  `LICENSE` →
  `ff1b611f80580d49f4b97e93a97b24eb050b0671b26b8afe16341fab699112f3` (MIT,
  "Copyright (c) 2026 Lovecast Inc.").
- Manifest approval digest used (computed fresh via `shasum -a 256` before
  running, bound into the stage receipt at staging time):
  `7e3c58060f3727ec6b302b83551c88b973169231463f3ea9a5642dc7329d661c`.
- `nodeBin`: `/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`
  (explicitly passed via `--node-bin`, not a hardcoded default).
- `vitestEntry`: `apps/desktop/node_modules/vitest/vitest.mjs`.
- `installedVitestVersion`: `vitest/5.0.0 darwin-arm64 node-v24.19.0`.
  Source project's own pin: `^4.1.11` (not what executed).
- `testCounts`: `{numTotalTests:2, numPassedTests:2, numFailedTests:0,
  numPendingTests:0, numTodoTests:0, numFailedTestSuites:0, success:true}`
  — coherent, fully passing, matching `expectedTestCounts` (1 file, 2
  tests) exactly. `execution.ok: true`, `problems: []`.

**This is pilot evidence for two assertions in one file, under a
non-pinned vitest major version and a caller-supplied execution approval.
It is not a statement about the legacy project's test suite, this
feature's rewrite status, or any other file.**

## Compatibility differences (source vitest ^4.1.11 vs. installed 5.0.0)

Unchanged: major-version gap unverified beyond these two assertions;
source defines `ORCA_FEATURE_WALL_ENABLED`, three DOM/canvas/host-port
`setupFiles`, extended `hookTimeout`/`testTimeout`, and `execArgv` flags
the capsule does not replicate because the pinned files don't need them.

## Remaining risks / follow-ups

- **Scale.** Still one reviewed capsule.
- **The approval digest is a stage-time tamper/drift guard, not proof of
  review** — restated because it is the single easiest property to
  over-read from a passing report.
- **`pilot-run-1`'s original receipt is lost** (see §"Retained evidence"
  above); nothing after this pass's start deleted it, and nothing in this
  pass will delete any further retained pilot directory.
- **Git-based checks assume a real, reachable git repository at
  `--source-root`**; a non-git copy fails closed.
- **The 120000ms hard timeout cap is exercised only against a controlled
  fake script**, not real vitest hanging.
- **`spawnSync`'s timeout is a single-signal bound, not a process-tree
  kill** — a child that ignores `SIGTERM` or detaches a grandchild can
  outlive the configured bound.
- **The generated `vitest.config.mjs` is minimal by design** and untested
  against a capsule needing a non-default environment.
- **No CI wiring.**
