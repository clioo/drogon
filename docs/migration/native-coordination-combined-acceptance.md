# Native coordination combined acceptance

Checkpoint: 2026-09-07. This supersedes historical implementation notes that
describe mail/question routes as absent. It is not full Orca parity or
installed-preview acceptance. PR review, main integration and packaging follow.

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

The earlier independent PR review covered `252de85..0dab9a4`, not these later
mail changes. A supplemental committed-diff review is still required.
