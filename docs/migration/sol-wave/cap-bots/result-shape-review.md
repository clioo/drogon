# WP-CAP-BOTS result-shape runner review

Status: focused source-runner safety verified; root acceptance remains required. This is not product fidelity, candidate parity, or GREEN.

## Outcome

The bounded execution-report gap is closed without rerunning the costly original source suite. `runExecute` now uses the pure `normalizeResultCases` helper in its actual path, replacing direct `.flatMap`/`.map` dereferences that could throw on valid JSON with an invalid structure before the report was assembled.

Three failure domains remain distinct:

- `resultsReadError`: the results path exists but cannot be read; message, error code, and path are retained.
- `resultsParseError`: bytes were read but JSON parsing failed; message, path, and byte length are retained.
- `resultSchemaError`: JSON parsed but `testResults`, file entries, `assertionResults`, cases, or required status fields are missing, null, or wrong-shaped.

All three force `setup_block`. A missing results file is separately represented by no result and no read/parse/schema error, and still becomes `setup_block` because no completed result exists.

The normalizer never substitutes a successful result. Readable case objects retain their raw fields and status; null cases get a safe placeholder so classification cannot dereference `null`; raw counts and spawn evidence remain separate in the execution report. The first result-schema problem is retained as a structured diagnostic, matching the existing single-error style for read and parse failures.

The clean controls remain unchanged: a complete passing result is `source_pass`, while a complete assertion failure is `source_behavioral_failure`, never GREEN. Signal, spawn-error, ETIMEDOUT, pending/todo, null/missing exit, count mismatch, case mismatch, and root's full 8/6/2 blocking cases remain conservative.

## Parent review correction

The leaf's first pass safely produced `setup_block`, but it did not attach `resultSchemaError` when a file omitted `assertionResults` or when a case status was missing or invalid. I delegated that precise correction to the same leaf instead of editing its files.

The final normalizer now records structured schema diagnostics for:

- missing or non-array `testResults`;
- null/non-object file entries;
- missing, null, or non-array `assertionResults`;
- null/non-object assertion cases;
- missing, null, non-string, or empty-string case statuses.

The earlier test that treated a missing status as schema-valid was intentionally corrected to expect `resultSchemaError`; its `setup_block` result and preserved raw case remain unchanged.

## Independent verification

Working directory: `/Users/carlos/Documents/Drogon-rewrite`.

```text
PATH="/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" apps/desktop/node_modules/.bin/vitest run tests/parity/ports/WP-CAP-BOTS/source-baselines/bots-page/cli-contract.test.mjs --root . --dir tests/parity/ports/WP-CAP-BOTS/source-baselines/bots-page
```

Result: Node v24.19.0, Vitest 5.0.0, 1 file passed, 91 tests passed, 0 failed, exit 0. Independent Node 24 syntax checks for `run-baseline.mjs` and `cli-contract.test.mjs` both exited 0, and both worker and parent JSON reports parse successfully.

Exact test breakdown:

| Group | Cases |
| --- | ---: |
| CLI argument parsing | 9 |
| Main dispatch boundary | 7 |
| Read-only helpers | 7 |
| Timeout derivation | 3 |
| Result file read/parse | 4 |
| Result-case normalization | 14 |
| General classification | 21 |
| Root blocking matrix | 5 |
| Actual helper chain over throwaway files | 14 |
| Default/check/import smoke | 7 |
| Total | 91 |

The helper-chain fixtures cover full valid pass and failure controls, an unreadable directory path, malformed JSON, missing/non-array `testResults`, a null file, missing/non-array `assertionResults`, a null assertion case, and missing/null/non-string/empty status values. These call the exported production helpers used by `runExecute`; they do not implement a duplicate normalizer or invoke the real source test runner.

As a corroborating spot check, `.preflight/parity-baseline` remained at 146 entries before and after the focused test. That shared count is not treated as the isolated proof; the suite uses throwaway fixture directories and imported pure boundaries.

## Preserved evidence

No manifest, historical evidence, stand-in, stage, or prior report changed:

| File | SHA-256 |
| --- | --- |
| `manifest.json` | `187454eaab1ce24841a466131f8e99d81f1768866f930c10b1b48a580e0fb1e3` |
| `evidence.json` | `999124fea7d298a8c479523e5de4ddffccf7053fe990c1003a0eb469f8fe0436` |
| `standins/store.ts` | `f4887c12d29ff3535d5fbc392736dcacc3df5b808ef55b7680f0adb4e423ffca` |
| `standins/launch-drogon-bot-session.ts` | `4b97a9d76cc0c4d09c05ff1bcb72f7f24b8afd16b496711cbd81ff93b99662ac` |
| `standins/agent-catalog.ts` | `43e90d99bba9fe4db0387dfb6de60824a6ae4ec8454c6475f15da249abf8aa2d` |
| `runner-review.md` | `07451c936d5f97e25866c96b61fe55684eafab840ff0120d5f5b948cff46d1f8` |
| `runner-review.json` | `24a5a1426be20c1d7cf0d9f303ef927ba0795cb8e3c944a257f4bdff9fde08fa` |

No `--execute`, original-source-cwd test, candidate simulation, dependency install, service, credential, global setting, product edit, Git mutation, or shared-script change occurred.

## Delegation lifecycle

One Claude worker was supervised at depth 2 on Run `run_4bc5ca0b5d45`, using the verified retained terminal `term_92216223-9ebd-47c2-becf-81068d9830f7`. The prior Orca launch receipt for this exact still-live session records requested/effective `claude-sonnet-5`, medium effort; the terminal preview showed `bypass permissions on`, consistent with its per-invocation `--dangerously-skip-permissions` launch.

The initial Task `task_7a5bc4490f23` / Dispatch `ctx_3be216039ad7` and the parent-review correction Task `task_3dad5d4c5550` / Dispatch `ctx_68c0233b8050` used the same terminal. No second worker or descendant was created.

Final delivery `delivery_7b92d999dcbb` was released before acknowledgment. Release request `d139d52e-c0a7-4251-9fc0-e1ae53fc45ff` returned `retained`, reason `external_terminal`, `processAction:none`; the terminal was not manually closed.

## Progress and remaining gate

Audit closure remains 11 of 12 capability groups (91.7%, medium confidence), delta 0 percentage points. Test migration advanced only at this runner-safety prerequisite; product fidelity did not advance because no candidate was exercised. The next milestone is root's independent acceptance, with high 24-hour deadline risk until that gate is resolved.

Machine-readable parent evidence is in `result-shape-review.json`; detailed leaf evidence is in `tests/parity/ports/WP-CAP-BOTS/source-baselines/bots-page/result-shape-review.json`.
