# run-baseline.mjs CLI contract review

Scope: `tests/parity/ports/WP-CAP-BOTS/source-baselines/bots-page/run-baseline.mjs`
and its `cli-contract.test.mjs` only. All prior stages, `manifest.json`,
`evidence.json`, and `standins/` are unchanged. Machine-readable detail is
in `runner-review.json`.

## Pass 1: CLI contract + classification guard + injectable no-write proof

The runner previously executed unconditionally on load (stage the capsule,
link runtime packages, spawn the real Vitest suite) with no CLI parsing at
all. It now has an explicit CLI contract, guarded by an `isMainModule`
check so **importing the module executes and stages nothing**:

- No arguments, or `--check`: read-only validation only. No capsule
  directory, cache, temp directory, or child test process.
- `--execute`: the only mode that stages the capsule, links runtime
  packages, writes the generated Vitest config, and spawns the pinned
  Vitest entry — unchanged from the prior always-on behavior.
- Rejected before any side effect: unknown flags, positional arguments,
  duplicate flags, and `--check`/`--execute` together (mutually
  exclusive).

## Pass 2: coordinator focused-review corrections

A coordinator review of pass 1 found the classification guard too
permissive and the test suite's no-write proof not concurrency-safe. Both
were corrected:

- **`classifyExecution` tightened.** `source_behavioral_failure` now
  requires *all* of: no spawn error, unsignaled, non-timeout, a parseable
  results file, every required count field a finite non-negative integer,
  internally coherent counts (`passed+failed+pending+todo === total`), the
  exact manifest-pinned denominator, zero pending/todo tests, a per-case
  list whose length and passed/failed split agree exactly with the
  reported counts, and at least one genuinely failed assertion. A
  failed-suite-only report with zero failed assertions — previously
  treated as a behavioral failure — is now `setup_block`, since it can't
  be trusted as a genuine per-assertion result.
- **Raw spawn evidence retained.** `runExecute` now records `run.error`
  (a genuine spawn-level failure, e.g. `ENOENT`) verbatim, distinct from
  `exitCode`/`signal`, in a new `report.spawn` block.
- **Injectable roots/boundaries replace the shared-directory oracle.**
  `resolveSupplementalRuntime`, `readOnlyStandinsCheck`,
  `readOnlySourceRevisionCheck`, and `readOnlyBinaryCheck` now take
  injectable root/path parameters (defaulting to the real locations), and
  `main()` takes an injectable `argv` array plus a `{ runCheckImpl,
  runExecuteImpl }` boundary (defaulting to the real `runCheck`/
  `runExecute`). Tests substitute tripwires and throwaway fixture
  directories instead of diffing the real, shared
  `.preflight/parity-baseline` listing — a mutable location other
  concurrent capsules write into, so it was never an isolated or
  concurrency-safe oracle. One narrow real default/`--check` smoke is
  retained, asserting only exit code and report shape, never a directory
  diff.

## Pass 3: this correction (mid-turn root feedback)

Root flagged two remaining issues in pass 2 before accepting it:

1. **`timedOut` must be keyed to a spawn error code, not elapsed time.**
   Pass 2 computed `timedOut` from wall-clock elapsed time against the
   configured timeout (with a jitter tolerance) because `spawnSync`
   appears to expose a timeout kill only via `signal`. That heuristic is
   an approximation and could misclassify an ordinary early/late external
   signal as a timeout, or vice versa. Verified empirically against this
   runtime's Node (three `node -e` probes, recorded in
   `runner-review.json.commandsRun`):
   - Node's own configured `timeout` option surfaces as
     **`error.code === 'ETIMEDOUT'`** on the returned error object, in
     *addition* to killing the child and setting `signal`.
   - An ordinary external signal (a child that sends itself `SIGKILL`
     well inside a generous timeout) leaves `error` **null** and only
     sets `signal`.
   - A genuine spawn failure (nonexistent executable) sets a *different*
     error code (`ENOENT`), with `signal` null.

   Added `deriveTimedOut(spawnError)` — `Boolean(spawnError) &&
   spawnError.code === 'ETIMEDOUT'` — and removed the elapsed-time
   heuristic entirely. `elapsedMs`/`timeoutMs` are still recorded in
   `report.spawn` as raw telemetry, but no longer drive the `timedOut`
   decision. An ordinary signal (early or late) remains `signal`-classified
   `setup_block`, never reclassified as a timeout.

2. **Malformed results JSON must not escape as an unstructured error.**
   Pass 1/2's `JSON.parse(readFileSync(resultsPath, 'utf8'))` would throw
   an uncaught `SyntaxError` on truncated/corrupted JSON (e.g. the child
   killed mid-write), escaping to the top-level `isMainModule` catch block
   as an undifferentiated `Unexpected error` with exit code 1. Added
   `parseResultsFile(resultsPath)`, which wraps that parse in a
   `try`/`catch` and returns `{ results, resultsParseError }`:
   `resultsParseError` is `{ message, path, byteLength }` on a parse
   failure, and `null` both when parsing succeeds and when the file never
   existed (the two are kept distinguishable). `classifyExecution` gained
   an explicit `resultsParseError` check, and `report` gained a sibling
   `resultsParseError` field alongside `rawCounts`/`evaluation`/`cases`.

Both `deriveTimedOut` and `parseResultsFile` are exported and directly
unit-tested: `deriveTimedOut` against synthetic error objects (no spawn
needed), `parseResultsFile` against throwaway fixture files (a
well-formed file, a deliberately truncated one, and a missing one),
confirming the diagnostic is structured (never an escaped throw) and
downstream classification is `setup_block` in both the malformed-JSON and
ETIMEDOUT-timeout cases.

## Pass 4: this correction (root's blocking matrix + a doc-comment overclaim)

Root judged the blocking matrix still under-specified despite 55 passing
tests, and flagged one remaining doc-comment overclaim:

- **Explicit blocking-matrix regressions.** Tracing `classifyExecution`
  confirmed its existing branches already gated all four scenarios
  correctly — this pass adds the missing tests that pin that behavior
  explicitly, rather than changing any classification logic. Added 5 new
  tests, each building the *same* genuine full 8-total/6-passed/2-failed
  results shape (8 per-case entries, 2 with `status: 'failed'` — the same
  shape as the admitted `evidence.json` baseline) and varying only the
  surrounding spawn-level evidence:
  1. `signal: 'SIGKILL'` with `exitCode: null` → `setup_block`.
  2. `spawnError: { code: 'ENOENT' }` with `exitCode: null` → `setup_block`.
  3. Unsignaled, no spawn error, but `exitCode: null` → `setup_block`.
  4. Unsignaled, no spawn error, `exitCode` entirely *absent* (`delete`d,
     not merely `null`, asserted via `toBeUndefined()`) → `setup_block`.
  5. The same shape with `numTodoTests: 1` alongside the 2 genuine
     failures (`5 passed + 2 failed + 1 todo = 8`, still internally
     coherent) → `setup_block`.

  Every one of these 5 tests also asserts
  `evaluation.counts.numFailedTests === 2` (case 1 additionally asserts
  the case-level failed count), directly proving the raw failure evidence
  stays observable even though the run is refused as a completed source
  result. The pre-existing controls — the genuine spawn-clean full 8/6/2
  failure (`source_behavioral_failure`) and the genuine full 8/8/0 pass
  (`source_pass`) — were left unchanged and still pass, confirming no
  classification behavior regressed. Full matrix recorded in
  `runner-review.json.blockingMatrixRegressions`.
- **Doc-comment correction near `runCheck`.** The comment previously
  claimed check mode creates "no capsule directory, cache, temp
  directory, or process spawn" — but `readOnlySourceRevisionCheck` does
  spawn one read-only `git rev-parse` child process to confirm the pinned
  source revision. Corrected to say check mode creates no capsule
  directory, cache, temp directory, or *test* process, with an explicit
  note that the one read-only `git rev-parse` spawn is a read, not a
  write, and is not the vitest test process `--execute` would spawn. The
  report's own `sideEffects` string was already accurate (it only ever
  said "no ... test process was created") and needed no change.

## Tests

`cli-contract.test.mjs`, 1 test file, **60 tests, 60 passed, 0 failed**:

- `parseCliArgs` (9): default/`--check`/`--execute`, unknown flag,
  positional (alone and with a valid flag), duplicate `--check`,
  duplicate `--execute`, `--check`+`--execute` together.
- `main() dispatch boundary` (7): invalid argv/positional/duplicate/
  mutually-exclusive never reach the execute tripwire; no-args/`--check`
  route to the check boundary only; `--execute` routes to the execute
  boundary only, without ever invoking the real `runExecute`.
- `read-only helpers against injected throwaway roots` (7):
  `readOnlyStandinsCheck`, `readOnlySourceRevisionCheck` (with a real
  throwaway git fixture repo), `resolveSupplementalRuntime`, and
  `readOnlyBinaryCheck`, each against per-test `mkdtempSync` fixtures,
  covering both matching and mismatched/missing cases.
- `deriveTimedOut` (3): true only for `ETIMEDOUT`; false for another code
  (`ENOENT`); false for no spawn error at all.
- `parseResultsFile` (3): well-formed JSON; malformed/truncated JSON
  (asserts it does not throw, and returns a structured diagnostic); a
  missing file (distinct null/null from a malformed file).
- `classifyExecution` (19): spawn error, ordinary signal (with
  `deriveTimedOut(null)` explicitly asserted false), ETIMEDOUT-derived
  timeout (with `deriveTimedOut` explicitly asserted true), signal vs.
  timeout treated as distinct evidence, missing results, malformed
  results (`resultsParseError` set), count mismatch, malformed/incoherent
  counts, pending/skipped full total, incomplete `assertionResults`,
  per-case/count mismatch, genuine full-count failure (including one
  alongside another integrity problem), failed-suite-only with zero
  failed assertions (now `setup_block`, not a behavioral failure),
  full-count all-passing, full-count-but-otherwise-broken, zero-total.
- `classifyExecution` → root's blocking matrix (5): see pass 4 above —
  SIGKILL, spawnError ENOENT, null exitCode, missing (`undefined`)
  exitCode, and a full total including a todo, each against the identical
  genuine full 8/6/2 failed-assertion results shape.
- `narrow real default/check smoke` (7): import-only side-effect
  freedom, default/`--check` report shape, and each invalid-argv case via
  the real CLI (`spawnSync`) — exit code/stderr/stdout only, no directory
  diff.

Exact commands (including the three empirical Node probes that motivated
the `ETIMEDOUT` design) and their results are recorded in
`runner-review.json`. The costly real `--execute` UI baseline (staging the
pinned `Drogon-mentu-session` source and spawning the real Vitest suite)
was **not** rerun in this review, per instruction to ask through Orca
first; `evidence.json`'s admitted result (6 passed / 2 failed of 8,
`source_behavioral_failure`) stands unchanged, and its shape remains
compatible with the new `report.spawn`/`report.resultsParseError` fields.

## Not in scope of this review

No dependency, settings, Git, PR, install, or service action was taken.
`/Users/carlos/Documents/Drogon-mentu-session` was read only (via `git
rev-parse` and package-metadata reads already present in the runner), and
was never used as a cwd or write target.
