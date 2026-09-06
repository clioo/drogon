# run-baseline.mjs result-shape hardening review

Scope: `tests/parity/ports/WP-CAP-BOTS/source-baselines/bots-page/run-baseline.mjs`
and its `cli-contract.test.mjs` only, plus this pair of new report files.
`manifest.json`, `evidence.json`, `standins/`, and `runner-review.md`/`.json`
are unchanged (sha256 hashes recorded in `result-shape-review.json` under
`preservedFileSha256`). Machine-readable detail is in
`result-shape-review.json`.

## Bounded defect

`runExecute` built the per-case list with:

```js
const cases = (results?.testResults ?? []).flatMap((file) =>
  (file.assertionResults ?? []).map((testCase) => ({ ...testCase.status, ... }))
)
```

*before* it assembled raw process evidence. Valid, successfully-parsed
JSON with a wrong shape could still crash this:

- `results.testResults` as a non-array (e.g. an object `{}`) — `.flatMap`
  is not a function on a non-array.
- a `null` entry inside `testResults` — `file.assertionResults` throws
  reading a property of `null`.
- `assertionResults` as a non-array — `.map` is not a function.
- a `null` entry inside `assertionResults` — `testCase.ancestorTitles`
  throws reading a property of `null`.

Separately, `parseResultsFile`'s `readFileSync(resultsPath, 'utf8')` call
was *outside* its `try`/`catch` (only the subsequent `JSON.parse` was
guarded), so a filesystem-read failure on an existing-but-unreadable path
(e.g. the results path turning out to be a directory) would escape as an
unstructured, uncaught error instead of becoming structured evidence.

Net effect: a malformed-but-parseable Vitest reporter output, or an
unreadable results path, could crash the runner with an unhandled
exception instead of producing a diagnosable `setup_block` report — the
opposite of the fail-closed contract this runner is supposed to guarantee.

## Fix

- **`parseResultsFile`** now wraps the `readFileSync` call in its own
  `try`/`catch`, returning a new `resultsReadError: { message, code,
  path }` on failure — distinct and mutually exclusive from the
  pre-existing `resultsParseError` (a `JSON.parse` failure on bytes that
  *were* read). A missing file still yields `results`, `resultsReadError`,
  and `resultsParseError` all `null`.
- **New `normalizeResultCases(results)`** — a pure function, not a
  test-only reimplementation; `runExecute` calls this exact function.
  It walks `results.testResults` → per-file `assertionResults` → per-case
  entries, validating each level's shape *before* touching it. Any
  non-array `testResults`, null/non-object file entry, non-array
  `assertionResults`, or null/non-object case entry is recorded as a
  single structured `resultSchemaError` (the first one encountered, with
  a `reason` string and a `{ type }` detail) instead of throwing. A
  null/malformed case entry is replaced with an all-`null` placeholder so
  the returned `cases` array is always a plain array of plain objects,
  never containing `null`. A case that's a valid object but missing its
  `status` field is left as-is — that's not a schema error (the object
  itself is well-formed), and is already safely caught downstream by
  `classifyExecution`'s pre-existing `typeof testCase.status !== 'string'`
  check, which needed no change.
- **`classifyExecution`** gained two new early gates —
  `if (execution.resultsReadError) return 'setup_block'` and
  `if (execution.resultSchemaError) return 'setup_block'` — alongside the
  pre-existing `resultsParseError` gate. Every other gate (signal, spawn
  error, timeout, exit-code, count coherence, denominator, pending/todo,
  per-case agreement) and the pass/fail split are unchanged.
- **`runExecute`** now reads `const { results, resultsReadError,
  resultsParseError } = parseResultsFile(resultsPath)` followed by
  `const { cases, resultSchemaError } = normalizeResultCases(results)`,
  replacing the inline `.flatMap`/`.map` chain entirely. The `execution`
  object and the `--execute` JSON report both gained `resultsReadError`
  and `resultSchemaError` fields (mirroring `resultsParseError`), each
  `null` unless its specific failure occurred. Raw spawn evidence
  (`report.spawn`), raw counts (`report.rawCounts`), and the full
  per-case list (`report.cases`) are unchanged in shape.

The only behavioral change to `--execute` is fail-closed structured
normalization: a run that previously would have thrown a `TypeError` or
let an fs error escape now instead produces a normal JSON report with
`classification: setup_block` and a structured `resultSchemaError`/
`resultsReadError` field. Every other code path (staging, supplemental
runtime, standins, execution config, the `spawnSync` call and its
args/env/timeout, spawn-evidence capture, `evaluateExecution`, raw counts,
cases for well-formed input, limitations) is untouched.

## Correction pass (parent review of the above)

Parent review found `normalizeResultCases` still had a gap contradicting
its own contract: it returned *without* a `resultSchemaError` in two
cases it should have flagged, even though `classifyExecution`'s
independent per-case status check still correctly forced `setup_block`
downstream — the diagnostic just wasn't structured/attributable at the
normalization layer itself.

1. **A file object that omitted `assertionResults` entirely** (`undefined`,
   not merely a wrong type) hit a special-cased early return —
   `if (assertionResultsRaw === undefined) return` — and was silently
   tolerated. **Fixed**: that early return was removed; a missing
   `assertionResults` now falls into the same `!Array.isArray(...)`
   branch as any other non-array value, with the reason distinguishing
   `'... assertionResults is missing'` (truly `undefined`) from
   `'... assertionResults is not an array'` (any other non-array, e.g.
   `{}`), so both remain separately greppable.
2. **A case object whose `status` was missing, `null`, non-string, or an
   empty string** was pushed into `cases` with no schema error recorded
   at all. **Fixed**: added `isValidStatus(value) => typeof value ===
   'string' && value.length > 0`; any case failing that check now records
   a `resultSchemaError` with reason `...status is missing or invalid`
   and a `{ type, value? }` detail (the raw string is included in the
   detail only when the status actually *is* a string, so an empty
   string is distinguishable from "no status at all" or a wrong type).
   The case itself is still pushed with its raw status preserved — no
   safe raw evidence is dropped.

Only `normalizeResultCases`'s internal validation changed;
`classifyExecution`, `runExecute`, and `parseResultsFile` are untouched in
this pass. The one pre-existing test that asserted the now-corrected
(wrong) tolerant behavior was updated to assert the corrected behavior and
retitled to note the correction; no other existing test's expected
outcome changed.

## Tests

`cli-contract.test.mjs`, 1 test file, **91 tests, 91 passed, 0 failed**
(up from 80 in the first result-shape pass, up from 60 before that — every
prior regression still passes or, for the one test whose expectation was
itself wrong, was intentionally corrected; see above). Breakdown
(9+7+7+3+4+14+21+5+14+7 = 91):

- `parseCliArgs` (9), `main() dispatch boundary` (7), `read-only helpers
  against injected throwaway roots` (7), `deriveTimedOut` (3): unchanged
  from the prior review pass.
- `parseResultsFile` (4): unchanged from the prior pass — a real
  filesystem-read-failure case (a throwaway directory used as the results
  path), asserting `resultsReadError` is set, `resultsParseError` stays
  `null`, and nothing throws.
- `normalizeResultCases` (14, was 8): well-formed full-passing and
  full-failing shapes (no schema error); null/undefined results (no
  cases, no schema error); **`testResults` entirely missing** (`results =
  {}`, new); `testResults` as an object `{}`; a `null` file entry inside
  `testResults`; **`assertionResults` entirely missing from a file object**
  (new — corrects the gap parent review found); `assertionResults` as an
  object `{}`; a `null` assertion-case entry (schema error + safe
  placeholder); a case missing its required `status` field (**now a
  schema error, corrected** — the case is still preserved with its raw
  status); **a case with a `null` status** (new); **a case with a
  non-string status** (new); **a case with an empty-string status**
  (new); **only the first schema problem is recorded across multiple
  invalid-status cases** (new).
- `classifyExecution` (general, 21): unchanged from the prior pass —
  `resultsReadError` present → `setup_block`, and `resultSchemaError`
  present → `setup_block`.
- `classifyExecution` → root's blocking matrix (5): unchanged from the
  prior review pass.
- **`actual helper wiring: parseResultsFile → normalizeResultCases →
  classifyExecution` (14, was 9)**: the direct regression coverage for
  the bounded defect and its correction. Each test writes a real fixture
  file to a throwaway directory and runs it through the *actual* exported
  functions (no reimplementation, no spawn), and the `runChain` test
  helper now returns `{ classification, resultSchemaError }` so every test
  asserts *both*: full valid passing (`source_pass`, `resultSchemaError`
  `null`), full valid failing (`source_behavioral_failure`,
  `resultSchemaError` `null`), an unreadable results path (a real
  directory), malformed JSON, **`testResults` entirely missing** (new),
  `testResults` as `{}`, a `null` file entry, **`assertionResults`
  entirely missing from a file object** (new), `assertionResults` as
  `{}`, a `null` case entry, a case missing its `status` field, **a case
  with a `null` status** (new), **a case with a non-string status**
  (new), and **a case with an empty-string status** (new) — every
  malformed case asserts the chain never throws, resolves to
  `setup_block`, and (for the cases above the two valid controls) that
  `resultSchemaError` is set with the expected `reason`/`detail`.
- `narrow real default/check smoke` (7): unchanged; `--check` never calls
  `parseResultsFile`/`normalizeResultCases`, so it is unaffected by this
  fix and was re-verified as a spot check only (no directory diffing).

## Exact commands, versions, and results

| Purpose | Command | Result |
|---|---|---|
| Syntax check, runner | `node --check run-baseline.mjs` (Node24: `/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`) | exit 0 |
| Syntax check, tests | `node --check cli-contract.test.mjs` (same Node24) | exit 0 |
| Focused suite | `PATH="<Node24 bin>:$PATH" apps/desktop/node_modules/.bin/vitest run tests/parity/ports/WP-CAP-BOTS/source-baselines/bots-page/cli-contract.test.mjs --root . --dir tests/parity/ports/WP-CAP-BOTS/source-baselines/bots-page` | `Test Files 1 passed (1)` / `Tests 91 passed (91)`, exit 0 |
| Manual smoke: default | `node run-baseline.mjs` | exit 0, `mode: "check"`, `ok: true` |
| Manual smoke: `--check` | `node run-baseline.mjs --check` | exit 0 |
| Manual smoke: import-only | `node --input-type=module -e "import('./run-baseline.mjs')"` | exit 0, empty stdout |

Node: `v24.19.0`. Vitest: `vitest/5.0.0 darwin-arm64 node-v24.19.0`
(installed under `apps/desktop/node_modules`, no install performed).
`.preflight/parity-baseline` entry count: 146 before and after every
command above (spot check only; the authoritative no-write proof for
`--check`/invalid-argv paths is the pre-existing injected-tripwire
`main()` dispatch tests, unchanged in this pass).

Exact command/version/result records and the full case-count breakdown
are in `result-shape-review.json`.

## Limitations

- This is result-shape/normalization hardening only, never a candidate
  parity result or a re-run of the admitted `evidence.json` baseline. The
  real, costly UI baseline (`--execute` against the pinned
  `Drogon-mentu-session` source, spawning the real Vitest suite) was
  **not** run in this review.
- The wiring tests exercise the real `parseResultsFile` →
  `normalizeResultCases` → `classifyExecution` chain against real
  throwaway fixture files, but do not spawn a real vitest process; the
  `spawnSync`/staging portions of `runExecute` are unchanged and remain
  covered only by the frozen `evidence.json` admitted run plus the
  pre-existing spawn-evidence unit tests (signal/timeout/spawnError)
  against hand-built execution objects.
- `normalizeResultCases` records only the first schema problem
  encountered per call, matching the existing single-shot diagnostic
  style of `resultsParseError`/`resultsReadError` — it is not an
  exhaustive multi-problem report.
- `manifest.json`, `evidence.json`, `standins/*`, and `runner-review.md`/
  `.json` were confirmed byte-for-byte unchanged via sha256 (recorded in
  `result-shape-review.json`); `manifest.json`'s hash independently
  matches the `manifestSha256` already recorded in `evidence.json` and
  reproduced by `run-baseline.mjs`'s own `readManifestDigest` at run time.

## Not in scope of this review

No dependency, settings, Git, PR, install, or service action was taken.
No source checkout `cwd`, credentials, or global settings were touched.
`/Users/carlos/Documents/Drogon-mentu-session` was not used as a cwd or
write target and was not read in this pass (this fix touches only
result-JSON handling, not source staging or supplemental-runtime
resolution).
