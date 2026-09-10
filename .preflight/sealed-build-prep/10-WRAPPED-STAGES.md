# Per-stage wrapped commands (DRAFT for the gated execution lane)

Conventions (set once in the exec shell; never exported globally beyond it):

```sh
EXECROOT="$(pwd)"   # caller repo root; must satisfy the S0 check first
PREP="$EXECROOT/.preflight/sealed-build-prep"
NODE24="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
export PATH="$NODE24:$PATH"
```

`run-stage.mjs` (this directory) spawns one stage with
`shell:false, windowsHide:true, detached:true` (new process group), pipes
output to the retained log *and* the console (replacing the script's `| tee`
without a shell pipeline), enforces `--deadline-ms`, then performs bounded
group teardown: SIGTERM to `-pgid` → 5 s grace → SIGKILL to `-pgid` → 2 s
force wait. Receipts append to `$RECEIPTS/stage-receipts.jsonl`. Verdict
`exited` appears only on observed child exit; all else is `unverifiable`.

Global pre-check (S0, no child — pure shell preamble, mirrors
`scripts/build-main.sh` arg gate + regression contract in
`scripts/build-main.test.mjs`):

```sh
test "$(git -C "$EXECROOT" rev-parse HEAD)" = "59ed9740a4b84f73df1c41eef522ba347771d413" \
  || { echo "EXECROOT is not the sealed source HEAD; refuse"; exit 2; }
node --test scripts/build-main.test.mjs   # regression contract must pass first
```

## S1 — toolchain assertion (60 s)

```sh
node "$PREP/run-stage.mjs" --root "$EXECROOT" --stage S1 \
  --deadline-ms 60000 --log "$EXECROOT/.preflight/sealed-build-prep/s1-toolchain.log" \
  --receipt "$EXECROOT/.preflight/sealed-build-prep" --cwd "$EXECROOT" -- \
  node --input-type=module -e '
import { strict as assert } from "node:assert";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
const nodeBin = `${process.env.HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`;
assert.equal(Number(process.versions.node.split(".")[0]), 24, "Node 24 is required");
for (const tool of ["git", "node", "npm", "cargo"]) {
  let ok = false;
  for (const dir of [`${nodeBin}`, ...process.env.PATH.split(path.delimiter)]) {
    try { await access(path.join(dir, tool), constants.X_OK); ok = true; break; } catch {}
  }
  assert.ok(ok, `Required tool missing: ${tool}`);
}
console.log(JSON.stringify({ status: "TOOLCHAIN-OK", node: process.version }));'
```

## S2 — remote resolution, read-only (30 s)

```sh
RECEIPTS="$PREP"  # until S3 creates the retained run dir
node "$PREP/run-stage.mjs" --root "$EXECROOT" --stage S2 \
  --deadline-ms 30000 --log "$PREP/s2-remote.log" --receipt "$RECEIPTS" \
  --cwd "$EXECROOT" -- git -C "$EXECROOT" remote get-url origin
```

Record stdout as `$REMOTE` for S4; it must be used verbatim.

## S3 — retained run dir (30 s; the lane's only sanctioned write outside prep docs)

```sh
node "$PREP/run-stage.mjs" --root "$EXECROOT" --stage S3 \
  --deadline-ms 30000 --log "$PREP/s3-rundir.log" --receipt "$PREP" \
  --cwd "$EXECROOT" -- node --input-type=module -e '
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
mkdirSync(path.join(process.env.EXECROOT, ".preflight", "build-main"), { recursive: true });
const run = mkdtempSync(path.join(process.env.EXECROOT, ".preflight", "build-main", "run-"));
console.log(run);'   # with EXECROOT="$EXECROOT" in the environment
```

Record stdout as `$RUN`. `$RUN` is retained including on failure and is never
deleted by the lane (rollback = retain + receipts, not sweep).

```sh
RECEIPTS="$RUN"
```

## S4 — isolated clone of remote main (600 s)

```sh
node "$PREP/run-stage.mjs" --root "$EXECROOT" --stage S4-clone \
  --deadline-ms 600000 --log "$RUN/s4-clone.log" --receipt "$RECEIPTS" \
  --cwd "$RUN" -- git clone --single-branch --branch main -- "$REMOTE" "$RUN/source"
node "$PREP/run-stage.mjs" --root "$EXECROOT" --stage S4-rev \
  --deadline-ms 60000 --log "$RUN/s4-rev.log" --receipt "$RECEIPTS" \
  --cwd "$RUN/source" -- git rev-parse HEAD
```

Record stdout as `$SOURCE_HEAD` (expected: the then-current `origin/main`
HEAD; manifest `execution.sourceHead`). Caller worktree files are untouched —
the clone goes to `$RUN/source`, never to `$EXECROOT`.

## S5 — packageManager pin gate, fail-closed (60 s)

```sh
node "$PREP/run-stage.mjs" --root "$EXECROOT" --stage S5 \
  --deadline-ms 60000 --log "$RUN/s5-pin.log" --receipt "$RECEIPTS" \
  --cwd "$RUN/source" -- node -p 'require("./package.json").packageManager'
```

Success predicate: stdout matches `^pnpm@[0-9]+\.[0-9]+\.[0-9]+$`
(sealed source pins `pnpm@11.19.0`). Anything else aborts the lane here —
no global tooling is ever changed.

## S6 — exact pnpm into the run dir only (600 s)

```sh
MANAGER="$(tail -1 "$RUN/s5-pin.log" | tr -d '\n')"   # e.g. pnpm@11.19.0
node "$PREP/run-stage.mjs" --root "$EXECROOT" --stage S6 \
  --deadline-ms 600000 --log "$RUN/s6-toolchain.log" --receipt "$RECEIPTS" \
  --cwd "$RUN/source" -- npm install --prefix "$RUN/toolchain" \
  --no-audit --no-fund --ignore-scripts "$MANAGER"
```

Follow-on (no child): `TOOLBIN="$RUN/toolchain/node_modules/.bin"`, passed to
S7/S9/S11 via `--env-json` PATH prepend — never exported to the user session.

## S7 — locked JS deps (1 200 s)

```sh
node "$PREP/run-stage.mjs" --root "$EXECROOT" --stage S7 \
  --deadline-ms 1200000 --log "$RUN/s7-pnpm.log" --receipt "$RECEIPTS" \
  --cwd "$RUN/source" \
  --env-json "{\"PATH\":\"$TOOLBIN:$NODE24:$(echo "$PATH" | sed 's/"/\\"/g')\"}" -- \
  pnpm install --frozen-lockfile
```

Argv must be exactly `install --frozen-lockfile` (regression contract).

## S8 — locked Rust cache for offline packaging (1 200 s)

```sh
node "$PREP/run-stage.mjs" --root "$EXECROOT" --stage S8 \
  --deadline-ms 1200000 --log "$RUN/s8-cargo.log" --receipt "$RECEIPTS" \
  --cwd "$RUN/source" -- cargo fetch --locked
```

Argv must be exactly `fetch --locked` (regression contract).

## S9 — package the desktop bundle (1 800 s; GATE G2 after)

```sh
node "$PREP/run-stage.mjs" --root "$EXECROOT" --stage S9 \
  --deadline-ms 1800000 --log "$RUN/package.log" --receipt "$RECEIPTS" \
  --cwd "$RUN/source" \
  --env-json "{\"PATH\":\"$TOOLBIN:$NODE24:$(echo "$PATH" | sed 's/"/\\"/g')\"}" -- \
  node scripts/package-desktop.mjs
```

The driver replaces `| tee "$run/package.log"` (log + console, no shell).
Success predicate: exit 0 AND `package.log` ends with a
`{"status":"PACKAGED","bundle":…,"revision":…,"artifactDigest":…}` line.
Any failure propagates and acceptance never runs (regression contract:
exit 17 fixture analogue; `Files retained at: $RUN`).
Optional kernel-observed exit evidence: attach
`python3 $RUN/source/scripts/live-child-exit-observer.py` (`--probe` first)
to the S9 direct-child pid with the same deadline; a `register-error`
classifies the stage `unverifiable`, never `exited`.

## S10 — extract + identify the bundle (60 s; GATE: coordinator ack)

`--verify` is never run wholesale. S10 is a separate wrapped stage:

```sh
node "$PREP/run-stage.mjs" --root "$EXECROOT" --stage S10 \
  --deadline-ms 60000 --log "$RUN/s10-bundle.log" --receipt "$RECEIPTS" \
  --cwd "$RUN/source" -- node -e '
    const fs = require("node:fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n");
    const records = lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const result = records.findLast(record => record.status === "PACKAGED");
    if (!result?.bundle) throw new Error("Packager did not report a bundle");
    process.stdout.write(result.bundle);' "$RUN/package.log"
```

Record stdout as `$BUNDLE`. STOP: report `$BUNDLE` + PACKAGED
`revision`/`artifactDigest` (+ `sealedDigest` once computed) for
coordinator ack (GATE G2). S11 needs explicit approval (GATE G3).

## S11 — packaged acceptance, background-hidden (3 600 s)

Preconditions (assert before spawning; all read-only): `swiftc` present
(`/usr/bin/swiftc`, used by `startForegroundObservation` with a 60 s
compile bound), `DROGON_BACKGROUND_WINDOW=1`, `DROGON_VERIFY_OS_FOCUS=1`,
fresh temp `DROGON_DATA_DIR` + `DROGON_ELECTRON_PROFILE` (accept-desktop
builds its own isolated fixture dirs internally; the wrapper only asserts
the two env vars and never points them at user data).

```sh
node "$PREP/run-stage.mjs" --root "$EXECROOT" --stage S11 \
  --deadline-ms 3600000 --log "$RUN/acceptance.log" --receipt "$RECEIPTS" \
  --cwd "$RUN/source" \
  --env-json "{\"PATH\":\"$TOOLBIN:$NODE24:$(echo "$PATH" | sed 's/"/\\"/g')\",\"DROGON_BACKGROUND_WINDOW\":\"1\",\"DROGON_VERIFY_OS_FOCUS\":\"1\"}" -- \
  node scripts/accept-desktop.mjs --bundle "$BUNDLE" --files
```

Contract (mirrors `scripts/build-main.test.mjs` fixture): acceptance sees
exactly `DROGON_BACKGROUND_WINDOW=1`, `DROGON_VERIFY_OS_FOCUS=1` and argv
`--bundle <bundle> --files`. Pass = exit 0 with report
`kind: packaged-desktop, status: PASSED`; anything else fails closed and is
the required input to `install-preview.mjs` refusal. No focus, activation,
or window-show API is invoked by the wrapper at any point.

## S12 — receipt (no child)

```sh
echo "Build complete. Receipt: $RUN/package.log"
echo "Acceptance log:        $RUN/acceptance.log"
echo "Stage receipts:        $RECEIPTS/stage-receipts.jsonl"
echo "No installed app or user data was replaced."
```

Fill `20-MANIFEST-DRAFT.md` → `execution` from `$SOURCE_HEAD`, the PACKAGED
record, the acceptance report, and `stage-receipts.jsonl`.
