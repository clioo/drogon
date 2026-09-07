# Native coordination combined acceptance

Checkpoint: 2026-09-07. This supersedes historical implementation notes that
describe mail/question routes as absent. It is not full Orca parity or
installed-preview acceptance. Supplemental review and its corrections are
recorded below; main integration and packaging still follow.

## Supplemental review and correction

Three independent read-only Tasks reviewed frozen clean `2ad3118`, focusing on
`0dab9a4..2ad3118` within PR9's full `252de85..2ad3118` range. Security and mail/data
used Sonnet 5 high; CLI/integration used OpenCode ZAI GLM-5.3-Flash. No dimension
hit its 180000-character cap; archived UX audit/unrelated docs were excluded.
Task/Dispatch pairs in Run `run_ddca7735397e`:
`task_66ed127461d2/ctx_b332502097cf`, `task_64d33941fcff/ctx_d5d1a1b4b767`,
`task_67a909562645/ctx_ce64a9b3f7d8`. All settled and declared no repository
modifications; root verified unchanged HEAD/status. Two owned terminals were
released/closed; the external GLM terminal was retained without process action.
All completion deliveries were acknowledged.

Root accepted one P1: generic answer-kind sends bypassed the correlated reply
operation. An Engine regression reproduced acceptance in all eight actor/target
combinations (coordinator/worker × omitted/run-home/direct/group). Shared typed
validation now refuses these before effects and directs callers to
`orchestration.reply`; existing legitimate reply tests remain green. The regression
also verifies only the original question exists and remains unanswered. This is
an intentional tightening of invalid generic-answer requests, not a removed
question/reply capability or a new wire field/opcode.

The actual worker-owned CLI now proves usage refusal (exit 2, empty stdout,
stderr directing to reply), followed by successful original-credential reporting,
replay/recovery and one-message settlement. Initial fixture expectation of a JSON
error was corrected to the existing CLI usage-error contract, not a production
error-channel change. All **26 checks passed**, report
`.preflight/acceptance/core-cli-1788778064300-ca3903f1-2e8a-4c0d-b89a-a460a33ae523.json`.
Full Rust workspace tests passed after correction (same pre-existing ignore;
25 mail RPC tests). The passing 25-check receipts below are the earlier baseline.

Three small review corrections reuse the DB filename constant, assert the
synthetic harness catalog entry, and retain the readiness caveat alongside a
post-spawn persistence warning. The warning regression was observed RED then
GREEN with the original no-duplicate-spawn assertions intact. The review's rare
PID-reuse cleanup concern remains unverified test-infrastructure risk: cleanup
deliberately fails closed, never treats uncertainty as exit or signals a reused PID.
Detailed ephemeral reports are local diagnostics, not portable source evidence.

## Implemented and exercised

The 18 typed entry points are wired for host-scoped runs/tasks, fresh worker
launch and lifecycle, bounded output, mail, questions/replies and actor-scoped
receipt recovery. `orchestration.native.v1` is enabled for this native surface.
The engine owns execution identity; neither task completion nor lost contact
is process-exit evidence. Tests include folder placement and synthetic real PTYs.

Root combined verification passed:

- `cargo test --offline --workspace --quiet` (one pre-existing ignored test
  remains ignored; this is not a claim that every source test is ported).
- `cargo clippy --offline --workspace --all-targets -- -D warnings`.
- `cargo fmt --all -- --check`.
- Desktop typecheck and 114 desktop tests; 70 packaging tests.
- `node scripts/accept-core-cli.mjs --coordination`: 25 checks passed,
  twice after fixing the duplicate-report response. The latest report is
  `.preflight/acceptance/core-cli-1788776818151-e9c994ba-e0e1-400b-9571-b45a3e017196.json`
  (local diagnostic evidence, not a portable archive).

The CLI test uses the actual daemon and typed CLI. Before starting a worker
it verifies the resolved harness is its own synthetic fixture, not an installed
model. The original private worker credential submits a final report, replays
it, recovers its receipt, obtains explicit duplicate classification, and sees
conflicting outcome and post-report mail consumption refused. There is one
report message. Metadata is preserved, process exit is independently observed,
and owned release succeeds. No model inference is part of this fixture.

## Corrections found during integration

- Invalid stored report outcomes and mismatched/missing original report
  identities cannot authorize a revoked credential. Retired attempts cannot
  recover as current ones.
- Every wait snapshot reauthorizes and propagates storage errors. Receipt
  prechecks use the existing bounded inspector after authorization.
- ACK+wait ignores the old batch using a read-only hypothetical read position,
  then commits ACK and delivery atomically. Invalid or corrupt ACKs fail
  before waiting; validation is shared with the actual ACK operation.
- Shutdown, worker revocation and coordinator takeover interrupt real waits.
- Accepted final-report metadata is persisted and projected as optional
  `workerShow.reportResult`; older hosts/records may omit it. Its serialized
  size is bounded by the existing 32 KiB task-text budget. Duplicate reports
  preserve the original metadata rather than overwriting it.
- A duplicate report returns the original message receipt, satisfying the
  typed CLI contract without appending another message. A prior Engine-only
  assertion incorrectly equated a missing receipt with no database insert;
  the regression now validates the wire shape and exact message row count.
- Direct/group messages and new questions cannot target already-reported
  attempts. Group scans bound stored JSON before allocation, validate stored
  task/run/dispatch identity, and roll back the whole batch if one insert fails.
- The aggregate startup test expects the newly migrated mail component.

Current targeted coverage: 160 core unit tests, 24 mail RPC tests, 10 group
Engine tests and 7 question RPC tests passed in the combined run.

## Remaining parity obligations

This native method surface does not implement federation, native Windows
transport, arbitrary existing-session private-context handover, TUI-idle group
selection, the full source worktree-placement composition, or every source
orchestration method. Unsupported cases fail explicitly before effects; they
are not successful no-ops. The 50-current-attempt group scan ceiling is a
documented bound, not silent truncation. These remain full-parity obligations,
not waived requirements or proof that the five verticals are complete.

The earlier independent PR review covered `252de85..0dab9a4`; the supplemental
committed-diff review and root's tested corrections are recorded at the top.
