# V4 PR13 checkpoint-0062 — leaf L2 (implement + admission assessment)

Run `run_9d01c7b856ee`, task `task_98afd9a74266`. Checkout
`codex-vertical-04-capabilities`, branch `codex/vertical-04-capabilities`
(V4 owns PR13; V1 owns PR14). Base HEAD verified `ecd828a` before starting;
HEAD unchanged (`ecd828a0c3664ae561ee4b8d9980f30611c84eaf`) — no commit made,
per leaf scope. L1's report
(`docs/migration/verticals/V4/leaf-L1-audit-2026-09-07.md`) was read only,
never edited.

## Scope

- **Part A**: complete the two untracked, pre-existing WP-CAP-DEVICE /
  WP-CAP-INT parity ports per L1's finding — add the two
  `pending-register/*.contract.test.ts` files and the 11 missing per-suite
  `STATUS.md` files. No Rust source, no `lib.rs`/`db.rs`/protocol/manifest
  file, no L1 report was touched.
- **Part B**: `bot.run` admission assessment — proposal-only document, no
  integration edits.
- **Part C**: this checkpoint.

## Changed paths (all new files; nothing modified or deleted)

```
tests/parity/ports/WP-CAP-DEVICE/pending-register/device-pending.contract.test.ts
tests/parity/ports/WP-CAP-DEVICE/computer-verification/STATUS.md
tests/parity/ports/WP-CAP-DEVICE/android-input/STATUS.md
tests/parity/ports/WP-CAP-DEVICE/audio-chunker/STATUS.md
tests/parity/ports/WP-CAP-DEVICE/speech-deletion/STATUS.md
tests/parity/ports/WP-CAP-DEVICE/model-config/STATUS.md
tests/parity/ports/WP-CAP-INT/pending-register/int-pending.contract.test.ts
tests/parity/ports/WP-CAP-INT/jira-mutations/STATUS.md
tests/parity/ports/WP-CAP-INT/linear-teams/STATUS.md
tests/parity/ports/WP-CAP-INT/github-auto-merge/STATUS.md
tests/parity/ports/WP-CAP-INT/gitlab-mr-rate-limit/STATUS.md
tests/parity/ports/WP-CAP-INT/bitbucket-status/STATUS.md
tests/parity/ports/WP-CAP-INT/github-identity-key/STATUS.md
docs/migration/verticals/V4/leaf-L2-admission-2026-09-07.md
docs/migration/verticals/V4/checkpoint-0062.md   (this file)
```

`git status --short` before/after confirms only these files plus L1's
pre-existing untracked report and the two port directories are affected;
`node_modules/.vite/**` vitest cache artifacts left behind by running the
suites are gitignored (`node_modules/` in `.gitignore`) and match the
existing pattern already present in the admitted WP-CAP-MEET/WP-CAP-MENTU
ports (same cache path shape there).

## Test evidence (this worktree as cwd, pinned Node24 at
`/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`,
vitest 5.0.0; the read-only reference `/Users/carlos/Documents/Drogon-mentu-session`
was never used as cwd)

**New pending-register suites (must run GREEN as registers):**

| Suite | Passed | Todo | Total |
| --- | ---: | ---: | ---: |
| `WP-CAP-DEVICE/pending-register` | 5 | 6 | 11 |
| `WP-CAP-INT/pending-register` | 6 | 6 | 12 |

Both are `Test Files 1 passed (1)`. The 5/6 passing assertions are the
frozen-port sha256 + `it(`/`it.each(` occurrence-count self-checks (one per
frozen suite in that package); the 6 todo items per package are the
historically-pending obligations declared with `it.todo` (never satisfiable
as `pass` by construction — vitest reports todo separately).

**Existing 11 frozen per-suite tests, re-run for STATUS.md evidence (all
already existed before this task; behavior unchanged by this task, run
count included for completeness of the checkpoint record):**

| Suite | Result |
| --- | --- |
| WP-CAP-DEVICE/computer-verification | FAIL at collection, 0 run (`Cannot find module`) |
| WP-CAP-DEVICE/android-input | FAIL at collection, 0 run |
| WP-CAP-DEVICE/audio-chunker | FAIL at collection, 0 run |
| WP-CAP-DEVICE/speech-deletion | FAIL at collection, 0 run |
| WP-CAP-DEVICE/model-config | FAIL at collection, 0 run |
| WP-CAP-INT/jira-mutations | 6 collected, 6 failed at runtime (dynamic import) |
| WP-CAP-INT/linear-teams | FAIL at collection, 0 run |
| WP-CAP-INT/github-auto-merge | FAIL at collection, 0 run |
| WP-CAP-INT/gitlab-mr-rate-limit | FAIL at collection, 0 run |
| WP-CAP-INT/bitbucket-status | 3 collected, 3 failed at runtime (dynamic import) |
| WP-CAP-INT/github-identity-key | FAIL at collection, 0 run |

All 11 are **blocked binding / test preparation**, never behavioral RED,
skip, or pass — no candidate module exists anywhere in `apps/desktop/src`
for any of the 11 frozen source files (verified by repo search). The two
"collected, N failed" cases (jira-mutations, bitbucket-status) differ only
in *reporting shape*: their missing imports are dynamic (`await import(...)`
inside a test body / helper) rather than static top-level imports, so
vitest reports per-test runtime failures instead of a single collection
failure. The root cause (`Cannot find module`, no candidate exists) and the
verdict (blocked binding, not RED/skip/pass) are identical; each STATUS.md
records this distinction explicitly. Exact commands and full failure text
are recorded per-suite in each `STATUS.md`.

**Rust baseline**: not rerun. No Rust source was changed by this task
(HARD RESTRICTIONS scope: no edits to any `.rs`/`Cargo.*`/protocol file), so
L1's recorded baseline (`cargo test -p drogon-core --locked --offline`:
160/160; desktop Bots vitest: 26/26) remains the current, valid baseline per
the coordinator's instruction not to rerun it absent a Rust source change.

## Source-test map (new files only)

| New test file | Pins provenance of | Cases |
| --- | --- | --- |
| `WP-CAP-DEVICE/pending-register/device-pending.contract.test.ts` | sha256+case-count self-check of the 5 already-frozen WP-CAP-DEVICE suites (computer-verification, android-input, audio-chunker, speech-deletion, model-config); 6 historically-pending device/speech/emulator obligations as `it.todo` | 5 pass + 6 todo |
| `WP-CAP-INT/pending-register/int-pending.contract.test.ts` | sha256+case-count self-check of the 6 already-frozen WP-CAP-INT suites (jira-mutations, linear-teams, github-auto-merge, gitlab-mr-rate-limit, bitbucket-status, github-identity-key); 6 historically-pending provider-integration obligations as `it.todo` | 6 pass + 6 todo |
| 11× `STATUS.md` | Binding status, exact runner command/output, and "what the N cases pin once bound" summary for each already-frozen suite listed above | n/a (documentation) |

## Scoped coverage vs. counts

Coverage is unchanged by this task: none of the 11 frozen suites' underlying
product code exists in the rewrite, so scoped line/branch coverage of any
candidate module is **0%** — the pass/todo counts above measure register
completeness and historically-pending-obligation bookkeeping, not product
coverage. This mirrors the admitted WP-CAP-MEET/WP-CAP-MENTU precedent
exactly.

## Part B summary (full detail in `leaf-L2-admission-2026-09-07.md`)

`bot_run_rpc.rs` is a compiled, 15/15-tested library module with **no**
reachable path from a real `bot.run` request: no `mod bot_run_rpc;` in
`lib.rs`, no dispatcher arm, and `native_bot_run.rs` itself compiles the
module via `#[path]` and reimplements `run_staged`'s admission sequencing in
a local `ScopeLedgerDouble` rather than exercising the real
`RequestLedger::run_staged`. The admission doc specifies, without applying:
(1) the exact `lib.rs` `mod`/dispatch-arm hunks plus a new `impl Engine`
adapter, and identifies a genuine (not cosmetic) data-flow mismatch between
`bot_run_rpc::record`'s `&Connection` + `RunPlan`/`RunnerOutcome`
requirement and `run_staged`'s `finalize` callback shape (`&ReceiptOutcome`
only), resolved via a closure-captured `Cell` side-channel local to the new
`Engine::bot_run` method, plus a required attempt-clock-threading fix so
`recordedAt`/`observedAt` ordering stays exactly as
`native_bot_run.rs::ScriptedClock`-based tests already pin; (2) a
native-boundary regression plan (authorize-before-replay, effect-outside-DB-lock,
atomic finalize, no false live verdict) that must run against the real
dispatcher, not `ScopeLedgerDouble`; (3) an explicit split of
`native_bot_run.rs`'s 15 tests into 8 that rebase onto the canonical public
`Engine` path unchanged today vs. 7 that require registration — including a
flagged discrepancy that `bot_run_rpc::authorize_caller`'s
`BotRunCaller::Worker` denial becomes dead code under the proposed
desktop-only registration (the real worker-boundary denial would be
`dispatch_worker`'s `method_not_found` fallthrough instead), which ROOT must
explicitly resolve rather than silently inherit.

## What remains for ROOT integration

- Apply (or revise) the `lib.rs` `mod`/dispatch-arm hunks and the new
  `Engine::bot_run` adapter from the admission doc; resolve the
  effect/finalize data-flow and attempt-clock-threading issues named there
  before wiring, not after.
- Decide whether `bot.run` is ever worker-reachable (affects whether
  `authorize_caller`'s `Worker` branch is live code or should be removed/
  documented as defensive-only).
- Add the dispatcher-level regression tests from admission-doc §2 once
  registration lands; rebase the 8 named `native_bot_run.rs` tests as-is and
  add the 7 named ones against `engine.dispatch(...)`.
- WP-CAP-DEVICE/WP-CAP-INT binding remains open: no candidate module exists
  for any of the 11 frozen suites; that is implementation-owner work, not
  this leaf's scope. The two pending-register files and 11 STATUS.md files
  close L1's finding that both READMEs referenced non-existent artifacts.
