# WP-CAP-BOTS source-baseline runner hardening

Status: focused runner contract verified; root acceptance remains required. This work changes no candidate implementation and makes no GREEN claim.

## Outcome

The BotsPage original-source baseline runner now has an explicit safe CLI boundary. No arguments and `--check` perform read-only validation; only `--execute` may stage the capsule and invoke the pinned source Vitest. Unknown flags, positionals, duplicate flags, and `--check --execute` are rejected before side effects, and importing the module cannot invoke the runner.

Root's blocking review is covered by exact regressions. A signal, spawn error, null or missing exit status, malformed/missing/incomplete results, non-integer or inconsistent counts, a denominator mismatch, pending/todo tests, or mismatched assertion results all classify as `setup_block`, even if a result file contains genuine failed assertions. Raw exit, signal, spawn error, timeout, count, case, and JSON-parse evidence stays separate and observable; `timedOut` is true only for `spawnError.code === 'ETIMEDOUT'`.

The clean controls remain intentionally distinct: a complete, normally spawned 8/6/2 source result is `source_behavioral_failure`, and a complete 8/8/0 result is `source_pass`. The existing admitted baseline remains frozen at 6 passed and 2 failed of 8; it is original-source evidence only, not candidate parity.

## Independent verification

Working directory: `/Users/carlos/Documents/Drogon-rewrite`.

Focused command:

```text
PATH="/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" apps/desktop/node_modules/.bin/vitest run tests/parity/ports/WP-CAP-BOTS/source-baselines/bots-page/cli-contract.test.mjs --root . --dir tests/parity/ports/WP-CAP-BOTS/source-baselines/bots-page
```

Result: Vitest 5.0.0, 1 test file passed, 60 tests passed, 0 failed, exit 0. A Node 24 syntax check of `run-baseline.mjs` also exited 0, and `runner-review.json` parsed successfully.

The root regression matrix contributes five explicit cases:

1. `SIGKILL`, null exit, full 8/6/2 failed JSON -> `setup_block`.
2. `ENOENT` spawn error, null exit, full 8/6/2 failed JSON -> `setup_block`.
3. No signal/spawn error, null exit, full 8/6/2 failed JSON -> `setup_block`.
4. No signal/spawn error, missing exit, full 8/6/2 failed JSON -> `setup_block`.
5. Five passed, two failed, one todo of eight -> `setup_block`.

The test suite uses injectable execution boundaries and throwaway fixture roots for its no-side-effect proof. As a corroborating spot check, `.preflight/parity-baseline` remained at 146 entries before and after the focused run; that shared-directory count is not treated as the concurrency-safe oracle.

No costly real `--execute` run occurred. The original checkout was never a runner working directory or write target, and no dependency install, service, global setting, Git mutation, source edit, historical evidence edit, or manifest edit was performed.

## Frozen evidence integrity

The reviewed historical inputs retain these SHA-256 digests:

| File | SHA-256 |
| --- | --- |
| `manifest.json` | `187454eaab1ce24841a466131f8e99d81f1768866f930c10b1b48a580e0fb1e3` |
| `evidence.json` | `999124fea7d298a8c479523e5de4ddffccf7053fe990c1003a0eb469f8fe0436` |
| `standins/store.ts` | `f4887c12d29ff3535d5fbc392736dcacc3df5b808ef55b7680f0adb4e423ffca` |
| `standins/launch-drogon-bot-session.ts` | `4b97a9d76cc0c4d09c05ff1bcb72f7f24b8afd16b496711cbd81ff93b99662ac` |
| `standins/agent-catalog.ts` | `43e90d99bba9fe4db0387dfb6de60824a6ae4ec8454c6475f15da249abf8aa2d` |

## Delegation and lifecycle

One actual Claude worker was used at depth 2 on Run `run_d8c2d8a18b0d`, terminal `term_92216223-9ebd-47c2-becf-81068d9830f7`. Orca recorded requested/effective agent `claude`, model `claude-sonnet-5`, and effort `medium`; the terminal showed `bypass permissions on`, consistent with the inspected per-invocation `--dangerously-skip-permissions` launcher option.

The same retained Claude terminal handled the initial Task `task_20f54b0c0cc0` / Dispatch `ctx_962337f3057b`, the two focused behavior corrections `task_be6a81bc1f7d` / `ctx_5bb26fee1ef9` and `task_0c89fbad5f94` / `ctx_8b25853f9f53`, and the metadata-only exact-count correction `task_aa51de9d69d5` / `ctx_3a0146d98a26`. No second worker or descendant was created. I reviewed the output independently rather than editing the worker-owned files.

Final delivery `delivery_6af4cbefafc2` was released before acknowledgment. Orca release request `ba4cc56f-24b8-452e-9df7-6ec0e700fa03` returned `retained`, reason `external_terminal`, `processAction:none`; the terminal was not manually closed.

## Progress and remaining gate

Audit closure remains 11 of 12 capability groups, 91.7%, medium confidence, delta 0 percentage points. Test migration advanced only at the runner-safety prerequisite; product fidelity did not advance because no candidate was exercised. The next milestone is root's independent acceptance and T2 decision, with high 24-hour deadline risk until that gate is resolved.

Machine-readable detail is in `runner-hardening.json`; the worker's detailed evidence is in `tests/parity/ports/WP-CAP-BOTS/source-baselines/bots-page/runner-review.json`.
