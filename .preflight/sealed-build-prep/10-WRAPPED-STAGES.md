# Per-stage wrapped commands, rev 2 — frozen-helper custody ONLY (DRAFT for the gated execution lane)

No custom supervisor exists in this lane. `run-stage.mjs` (rev 1) was denied
for execution and is DELETED in the rework commit; every finite stage below
runs under the ACTUAL frozen gui-qa-owner helpers, cited by file, line, and
verified sha256. Extensions E1/E2 go to the helper owner with separate
review/tests — this lane specifies the request, never the implementation.

## §0 Denial-point → fix map (rev-1 wrapper denied)

| # | Denied (rev 1) | Fix (rev 2, this doc) |
|---|----------------|------------------------|
| D1 | Custom `detached:true` + negative-pgid SIGTERM→SIGKILL group-kill | Deleted. Direct child stopped via frozen `stopOwnedChild` handle (`gui-qa-launch.mjs:158-198`); descendants swept only after pid+birth(lstart)+command re-verification (`gui-qa-outer.mjs` `same()` + `signalConfirmed`, pre-query + recheck guards). No `detached`, no `-pgid`, no broad kill. |
| D2 | Inherited HOME/PATH (`{...process.env}` spread, shell `which`) | Frozen `bootstrap-outer.sh:8-16`: `exec env -i` with fixed PATH, private mktemp HOME/TMPDIR (0700), known-absolute NODE_BIN. Outer runner env is a fixed allowlist (`gui-qa-outer.mjs:66-78`); stage payloads assert it (s1 payload). |
| D3 | Observer optional, attached only to S9/S11 | Outer observes THROUGHOUT every stage: OS observer started BEFORE spawn (`gui-qa-outer.mjs:151-152`), 75 ms identity journal during work (`:177-179`), final sweep, observer stopped AFTER sweep under its own 5 s lifecycle (`:242-256`). |
| D4 | Post-deadline grace (timer fires, then grace begins) | Monotonic `performance.now()` budget/reserve split (`gui-qa-launch.mjs:51-64`): work loop stops at `workEnd`, teardown spends only the 30 s reserve; `shouldSignal` withholds EVERY signal past `hardEnd`, `capToReserve` bounds each wait; KILL withheld past hardEnd stays `unverifiable` (`gui-qa-launch.mjs:181-184`). |
| D5 | Direct-child-only evidence for descendants (group-kill, no identities) | Retained-runner exit checked independently (nonzero/null exit throws, `:177-190`); descendants tracked in a ppid-chained identity journal (`:100-130`), sweep verdict scoped to the owned journal (`:237`); EVERY successful external signal marks rescue and forces FAIL (`:138-148`, `:265-266`). |
| D6 | Called "audited" without review | No new supervisor; every stage cites frozen source lines + verified hashes (§1). Any custody change is owner extension E1/E2 with review/tests. |
| D7 | Moving-main clone (`--branch main`, HEAD trusted) | Clone, then `checkout --detach $SEALED_SHA` + `rev-parse` assert (S4b/S4c). Mismatch aborts: main moved → re-prep required, never a silent moving target. |
| D8 | S0 `rev-parse HEAD == 59ed…` vs prep HEAD 8964… skew | S0 asserts sealed CONTENT, not branch HEAD: `origin/main == $SEALED`, non-prep tree diff-empty vs `$SEALED`, status clean outside prep docs. Prep HEAD is accepted only with its delta confined to `.preflight/sealed-build-prep/`. |

## §1 Frozen helpers (read from source, hashes verified by direct read 2026-09-10)

| File | sha256 (observed == record) | Cited contract |
|------|-----------------------------|----------------|
| `…/.preflight/gui-qa-owner/bootstrap-outer.sh` | `14a1a641…bcc2bc5f` | `:8-16` env -i envelope: known-absolute NODE_BIN (`:5`), private OWNER_HOME/OWNER_SCRATCH 0700 (`:7-9`), fixed PATH/HOME/TMPDIR/LANG (`:11-14`), forwards `--output-root [--budget-ms] [--cwd] --command` (`:3-4,16`) |
| `…/.preflight/gui-qa-owner/gui-qa-outer.mjs` | `891a05c9…43bbbcf7258` | `:34` usage; `:42` --cwd/--command honored; `:47` cwd guard (helper-worktree scope or `smoke-scenario` exe); `:48` `--bundle`/`--files` elements refused; `:49` upgrade path refused; `:51` budget + 30 s reserve; `:66-78` fixed private runner env (BACKGROUND=1, VERIFY_OS_FOCUS=1, private usage fixture); `:151-160` observer-before-spawn + tooling sha-before; `:165` handle-spawn (no shell, no detached); `:177-190` work loop + independent runner-exit check; `:193-202` owned-child stop vs already-exited record; `:204-240` identity-verified sweep; `:242-266` observer-after-sweep, sha-after assert, rescue accounting; `:268-288` PASSED/FAILED + exit code |
| `…/.preflight/gui-qa-owner/gui-qa-launch.mjs` | `5a199d4e…31ef7a7af3` | `:51-64` monotonic deadlines; `:150-156` rescue classification; `:158-198` `stopOwnedChild` (handle kills, hardEnd recheck before KILL); `:236+` private usage fixture |
| outer's primitive linkage | hash-identical to sealed manifest | helper-worktree `scripts/acceptance-process.mjs` = `fe34d007…9430bfa7`, `acceptance-foreground.mjs` = `f81c94de…22aac9`, `acceptance-bridge-observation.mjs` = `5af92c48…6afdb7`, `live-child-exit-observer.py` = `825556d7…8a480b` — all equal the sealed-source values in `20-MANIFEST-DRAFT.md` |

Full paths: helper root `/Users/carlos/orca/workspaces/Drogon/gui-qa-owner-muse`;
`OUTER` below = `…/.preflight/gui-qa-owner/bootstrap-outer.sh`;
`QAROOT` = helper worktree root (the outer's default `--cwd`, `:42`).

Conventions for the exec shell:

```sh
SEALED=59ed9740a4b84f73df1c41eef522ba347771d413   # manifest source.headSha
EXECROOT="$(pwd)"                                 # sealed-content checkout (S0 gates it)
PREP="$EXECROOT/.preflight/sealed-build-prep"     # this lane's docs+payloads (read-only at exec)
OUTER=/Users/carlos/orca/workspaces/Drogon/gui-qa-owner-muse/.preflight/gui-qa-owner/bootstrap-outer.sh
NODE_BIN=/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node  # bootstrap :5
```

Readback rule (outer `:165-176,268-286`): runner stdout/stderr land ONLY in
`<output>/runner.log`; verdict in `<output>/outer-report.json` (+ console
summary `{status, output, captured, cleanup}`); exit code mirrors PASSED/FAILED
(`:288`). The exec lane reads values from `runner.log`, never from a pipe.

## E0 — tooling attestation (before any stage; outer as-is, cwd default)

```sh
"$OUTER" --output-root "$PREP/outer-runs" --budget-ms 60000 --command /usr/bin/shasum -a 256 \
  "$OUTER_DIR/gui-qa-outer.mjs" "$OUTER_DIR/gui-qa-launch.mjs" "$OUTER_DIR/bootstrap-outer.sh"
```

(`OUTER_DIR` = dirname of OUTER.) Success: exit 0 AND `runner.log` shows
`891a05c9…`, `5a199d4e…`, `14a1a641…` (== §1 table; record
`/tmp/drogon-muse-glm-critical-qa/pr399-grant-hashes.txt`). Mismatch aborts
the lane — helpers moved → re-freeze required. (Outer `:157-160,259-261`
additionally attests its own tooling sha before/after every stage.)

## S0 — sealed-content gate (no child; git object store is the mechanism)

```sh
git -C "$EXECROOT" fetch origin main
test "$(git -C "$EXECROOT" rev-parse origin/main)" = "$SEALED" \
  || { echo "origin/main moved; re-prep required"; exit 2; }
git -C "$EXECROOT" diff --quiet "$SEALED" HEAD -- . ':!.preflight/sealed-build-prep' \
  || { echo "non-prep tree differs from sealed source"; exit 2; }
test -z "$(git -C "$EXECROOT" status --porcelain -- . ':!.preflight')" \
  || { echo "caller tree not clean"; exit 2; }
node --test scripts/build-main.test.mjs   # regression contract for the wrapped script
```

Resolves D8: branch HEAD (prep commit) is irrelevant; only sealed content matters.

## S1 — toolchain assertion under frozen env (outer as-is)

```sh
"$OUTER" --output-root "$PREP/outer-runs" --budget-ms 60000 \
  --command "$NODE_BIN" "$PREP/s1-toolchain-assert.mjs"
```

Payload asserts Node 24 + git/node/npm on the outer's FIXED PATH (D2: the PATH
under test is the frozen allowlist, `gui-qa-outer.mjs:67`, never ambient).
Cargo is asserted at the S8 gate (E1 blesses its absolute path).

## S2 — remote resolution, read-only (outer as-is; `git -C`, cwd-independent)

```sh
"$OUTER" --output-root "$PREP/outer-runs" --budget-ms 30000 \
  --command /usr/bin/git -C "$EXECROOT" remote get-url origin
```

Record `runner.log` (single line) as `$REMOTE` for S4; used verbatim.
(Absolute `/usr/bin/git` mirrors frozen `gitSha`, `gui-qa-outer.mjs:154-156`.)

## S3 — retained run dir (outer as-is; absolute argv, cwd-independent)

```sh
"$OUTER" --output-root "$PREP/outer-runs" --budget-ms 30000 \
  --command "$NODE_BIN" "$PREP/s3-make-rundir.mjs" "$EXECROOT"
```

Record `runner.log` as `$RUN`. Retained including on failure (rollback keeps
evidence; deletion needs coordinator ack). Then `RECEIPTS="$RUN"`.

## S4 — isolated clone + exact-SHA pin (outer as-is; D7)

```sh
"$OUTER" --output-root "$RUN" --budget-ms 600000 \
  --command /usr/bin/git clone --single-branch --branch main -- "$REMOTE" "$RUN/source"
"$OUTER" --output-root "$RUN" --budget-ms 60000 \
  --command /usr/bin/git -C "$RUN/source" checkout --detach "$SEALED"
"$OUTER" --output-root "$RUN" --budget-ms 60000 \
  --command /usr/bin/git -C "$RUN/source" rev-parse HEAD
```

Success: third stage's `runner.log` == `$SEALED`, and
`git -C "$RUN/source" status --porcelain` (via the same form if needed) is
empty. Caller worktree untouched — the clone lands in `$RUN/source` only.
A moved main still clones, but the detach fails/attestation mismatches → abort.

## S5 — packageManager pin gate, fail-closed (outer as-is)

```sh
"$OUTER" --output-root "$RUN" --budget-ms 60000 --command "$NODE_BIN" \
  -p 'require(process.argv[1]).packageManager' "$RUN/source/package.json"
```

Success: `runner.log` matches `^pnpm@[0-9]+\.[0-9]+\.[0-9]+$` (sealed:
`pnpm@11.19.0`). Absolute require path keeps the stage cwd-independent under
the `:47` guard. Record as `$MANAGER`. No global tooling change, ever.

## S6 — exact pnpm into the run dir only (outer as-is)

```sh
NPM_ABS="$(dirname "$NODE_BIN")/npm"
"$OUTER" --output-root "$RUN" --budget-ms 600000 \
  --command "$NPM_ABS" install --prefix "$RUN/toolchain" \
  --no-audit --no-fund --ignore-scripts "$MANAGER"
```

`--prefix` is absolute → cwd-independent under the `:47` guard. npm
cache/config land in the outer's private HOME (`:68-73`, D2). Record
`TOOLBIN="$RUN/toolchain/node_modules/.bin"` for E1 stages.

## S7/S8/S9 — OWNER EXTENSION E1 REQUIRED (blocked; specified, not implemented)

Requested of the helper owner (separate review/tests, per lane rule 5): extend
the `:47` cwd guard with an allowlisted run-dir scope (exact `$RUN`, recorded
per-invocation in `launch.json`, `:168-176`) and bless a known-absolute cargo
path (none exists in evidence; S1 does not assert cargo). Everything else —
env -i envelope, monotonic budget+reserve, identity-verified sweep, observer
throughout, rescue accounting — stays frozen. Owner adds a `gui-qa-control`
test pinning the new guard exactly as `:47` is pinned today. Intended
post-grant invocations (argv byte-identical to `scripts/build-main.sh`):

```sh
# S7 --cwd "$RUN/source" --command "$TOOLBIN/pnpm" install --frozen-lockfile   (budget 1200000)
# S8 --cwd "$RUN/source" --command <blessed-cargo> fetch --locked              (budget 1200000)
# S9 --cwd "$RUN/source" --command "$NODE_BIN" scripts/package-desktop.mjs     (budget 1800000)
```

S9 success: exit 0 AND a `{"status":"PACKAGED",…}` terminal record in
`runner.log` (copied verbatim to `$RUN/package.log` via an as-is
`/bin/cp <output>/runner.log "$RUN/package.log"` stage for the S10 contract).
Cwd workarounds (`--dir`, absolute script paths) were rejected: they change
argv or the packager's git-cwd assumptions versus the reviewed script, and
only the owner can bless such a delta.

## S10 — extract + identify the bundle (outer as-is; GATE G2 after)

```sh
"$OUTER" --output-root "$RUN" --budget-ms 60000 \
  --command "$NODE_BIN" "$PREP/s10-extract-bundle.mjs" "$RUN/package.log"
```

Argv elements contain no `--bundle`/`--files` (`:48` safe by construction).
Record `runner.log` as `$BUNDLE`. STOP: report `$BUNDLE` + PACKAGED
`revision`/`artifactDigest` (+ `sealedDigest` via the S9 tree) for coordinator
ack (G2). S11 needs explicit approval (G3) AND owner grant E2.

## S11 — packaged acceptance (OWNER EXTENSION E2 REQUIRED; never bypassed)

The frozen outer as-is REFUSES this stage three times over: `:48` bans
`--bundle`/`--files` elements, `:76` hardcodes `DROGON_SKIP_MODEL_JOURNEYS=1`
(full acceptance needs model journeys via the sealed fixture), and `:47`
forbids the `$RUN/source` cwd. Requested of the helper owner (separate
review/tests): a bundle-acceptance form — allowlisted `--bundle/--files`
argv, full-journey env variant (sealed fixture only; fixtures-only rule
stands), run-dir cwd scope (shared with E1) — with the envelope, deadlines,
identity sweep, observer, and rescue accounting frozen. The outer already
forces `DROGON_BACKGROUND_WINDOW=1` + `DROGON_VERIFY_OS_FOCUS=1` (`:74-75`),
matching the `--verify` contract. Until E2 is granted the lane ends at S10;
no competing runner, no flag-stripping, no env smuggling.

## S12 — receipt (no child)

```sh
echo "Build complete. Receipt: $RUN/package.log"
echo "Outer reports:         $RUN/outer-*/outer-report.json"
echo "No installed app or user data was replaced."
```

Fill `20-MANIFEST-DRAFT.md` → `execution` from the S4 pin, PACKAGED record,
acceptance report (post-E2), and retained outer reports.
