# V4 PR14 leaf L1 — reconciliation audit + baseline tests (2026-09-07)

Worktree: `codex-vertical-04-capabilities`, HEAD `ecd828a` ("V4 reconcile PR14 onto
origin/main 3a52b466"), branch verified before any check. Read-only scope;
this report is the only file written.

## 1. Reconciliation inventory

| Item | Expected | Observed | Verdict |
| --- | --- | --- | --- |
| (a) `crates/drogon-core/src/bot_mutation_rpc.rs` | equals origin/main | `git diff origin/main -- <path>` empty | CONFIRMED |
| (a1) registered `bot.create` | dispatch entry | `lib.rs:324 "bot.create" => self.bot_create(request)` | CONFIRMED |
| (a2) canonical RequestLedger `run_atomic` | ledger-bound transaction | `bot_mutation_rpc.rs:178 self.ledger.run_atomic(...)`; `Engine.ledger: RequestLedger` (`lib.rs:126`) | CONFIRMED |
| (a3) `workspace::owned_path` | scope authorization | `bot_mutation_rpc.rs:161` | CONFIRMED |
| (a4) `Engine::bot_create` | impl on `crate::Engine` | `bot_mutation_rpc.rs:175` (pub(crate), lifecycle gate + quiescence check inside `run_atomic` closure) | CONFIRMED |
| (b) `automations/runner.rs` `prepare_run_plan_in_tx` | present | line 433; wrapper `prepare_run_plan` opens/drops its own read snapshot and delegates | CONFIRMED |
| (b) `automations/runner.rs` `record_run_outcome_in_tx` | present | line 877; wrapper `record_run_outcome` opens one `automations_storage::begin_immediate`, commits once | CONFIRMED |
| (b) record-path logic == origin/main | same behavior | diff vs origin/main is only the wrapper extraction (`tx`→`conn` renames + new doc comments); `AcceptedOutcome` (line 638: `AcceptedNew`/`KeptExisting`/`RejectedStale`), `RejectedStale` skips the `ResponsibilityRun` write (line 887), single `BEGIN IMMEDIATE` for both durable writes — all preserved | CONFIRMED |
| (c) `bot_run_rpc.rs` | present, branch-only, undeclared | file exists; `lib.rs` mod list has no `bot_run_rpc`; grep of lib.rs/rpc surface finds no reference. lib.rs (ROOT-owned) NOT touched | CONFIRMED |
| (d) `tests/native_bot_create.rs` | deleted, replaced | only `tests/native_bot_create_engine.rs` exists under `crates/drogon-core/tests/` | CONFIRMED |
| (e) untracked `tests/parity/ports/WP-CAP-DEVICE/` + `WP-CAP-INT/` | preserved, 15 files | exactly 15 files (5 device frozen suites + manifest + README; 6 int frozen suites + manifest + README), `git status` shows both as untracked | CONFIRMED |

### (e) Missing items referenced by the parity READMEs

Both READMEs (WP-CAP-DEVICE, WP-CAP-INT) reference artifacts that do not exist yet:

- `tests/parity/ports/WP-CAP-DEVICE/pending-register/` — directory absent;
  README's runner section references `pending-register/device-pending.contract.test.ts`.
- `tests/parity/ports/WP-CAP-INT/pending-register/` — directory absent;
  README's runner section references `pending-register/int-pending.contract.test.ts`.
- Per-suite `STATUS.md` files — both READMEs state "Exact commands, counts and
  outcomes are recorded in each suite's STATUS.md"; no `STATUS.md` exists for any
  of the 11 frozen suites (5 device + 6 int).

(The READMEs also cite `docs/migration/parity-speech-catalog.md` and
`tests/parity/ports/LICENSE.orca`; both exist outside these port dirs.)

## 2. Baseline test runs (this worktree as cwd; never the read-only reference)

`cargo test -p drogon-core --locked --offline`, per-suite targets:

| Suite | Passed | Failed |
| --- | --- | --- |
| native_bot_run | 15 | 0 |
| native_bot_create_engine | 11 | 0 |
| automation_runner | 31 | 0 |
| automation_execution | 17 | 0 |
| bots_policy | 15 | 0 |
| bot_history_scope | 10 | 0 |
| bot_storage | 40 | 0 |
| automation_records | 21 | 0 |
| **Total** | **160** | **0** |

Desktop Bots vitest (pinned Node24 at
`/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`,
`vitest.mjs run --root apps/desktop src/renderer/src/features/bots/`):
**2 test files passed, 26/26 tests passed, 0 failed**
(`BotsPanel.contract.test.ts`, `bots-panel-descriptor.contract.test.ts`).

No failures, no ignored tests, no skips in either run.

## 3. Notes for root

- All five reconciliation expectations hold at HEAD `ecd828a`; no source drift found.
- `bot_run_rpc.rs` remains an uncompiled branch-only module (undeclared in ROOT-owned
  `lib.rs`); declaring it is root's call, untouched here.
- The WP-CAP-DEVICE / WP-CAP-INT packages are preserved but incomplete relative to
  their own READMEs: both pending-register contract tests and all per-suite STATUS.md
  files are still to be produced (matches the "recorded evidence now, binding later"
  framing in the READMEs).
