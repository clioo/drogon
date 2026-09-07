# Native mail RPC implementation (`orchestration.send` / `orchestration.check` / `ask` / `reply` routing)

## Root acceptance corrections, 2026-09-07

After the final stable worker handoff, root took ownership of the remaining
files. The historical worker evidence below is not combined acceptance.
Root reproduced acceptance of an invalid stored report outcome and delivery
to a nonexistent dispatch, then fixed both with passing regression tests.
Recovery now decodes the typed attempt, verifies its run/task/dispatch
identity and valid outcome, and requires its own final-report message in
the same host/run. Missing or mismatched report evidence cannot authorize
recovery. Direct dispatch sends require a current unfenced target.

Wait snapshots now reauthorize on each observation and propagate storage
errors. Receipt prechecks reuse the bounded receipt inspector inside an
authorized snapshot; they do not return saved data outside normal atomic
replay/fingerprint validation. A real takeover-during-wait regression proves
prompt fencing. Root reran `--lib --test native_mail_rpc --test native_question_rpc`:
151 unit, 18 mail and 7 question tests passed. Full integrated suite and
real CLI acceptance remain pending at this checkpoint.

Scope: current-wave mail final integration (`task_461fc587dd5d` →
`task_29d8fc9a06d6`, same AUTH checkout). `orchestration.native.v1` remains
disabled; this is server-side plumbing only.

Ownership split: I own `lib.rs` dispatch wiring, `coordination_access.rs`,
`coordination_mail*.rs`, `coordination_worker_control.rs`, `db.rs`, and this
doc. Root owns `coordination_question_rpc.rs` and
`tests/native_question_rpc.rs` exclusively — neither is edited here, only
routed to.

## What is wired

- `orchestration.send` and `orchestration.check`, dispatched from both the
  admin/coordinator path (`Engine::dispatch_admin_mail`, trusted, no
  credential) and the authenticated worker path
  (`Engine::dispatch_worker_mail`, real dispatch credential), in
  `crates/drogon-core/src/coordination_mail_rpc.rs`.
- `send` for a non-`finalReport` kind: appends the message via
  `coordination_mail::append_message_in_tx` inside the caller's one
  ledger-atomic transaction (`Engine::coordination_mutation`), so generation/
  host/attempt fences are rechecked on every call, including replay. A
  `kind: "question"` send additionally correlates atomically
  (`questions::correlate_question_in_tx`, shared with the dedicated `ask`
  path) so a later `reply`/resume finds it — a generic `send` of a question
  is a first-class way to start one, not just `ask`.
- `send` for `kind: "finalReport"`: peeks the attempt's existing outcome
  *before* writing anything. If unset, it fences (`require_current_unfenced`),
  appends the report message, calls `coordination_attempts::settle`,
  transitions the task (`Completed`/`Failed`), revokes the dispatch's
  credential (reason `"reported"`), and closes its pending questions
  (`questions::close_dispatch_questions_in_tx`) — all in that one transaction.
  If an outcome is already set: matching outcome returns the original
  message's duplicate receipt (no new message row, no re-settlement, no
  re-revoke); a differing outcome is refused with `report_conflict` and no
  effect.
- Narrow settled-report recovery (`coordination_access.rs`): a credential
  revoked specifically for reason `"reported"` may authenticate for exactly
  `status`, `orchestration.send`, and `orchestration.requestShow` — never
  `orchestration.check`/`ask`/`reply` — *and only if* its exact
  `orchestration_attempts` row is still `is_current = 1` for its task *and*
  carries a non-null `outcome`. The `revocation_reason` string is treated as
  a hint, never proof: `revoked_for_report_recovery` →
  `attempt_is_current_and_settled` cross-checks the durable attempt state
  before granting anything. This closes two distinct gaps: (1) a
  stale/corrupted `"reported"` reason with no matching settlement is
  refused, and (2) a dispatch that genuinely reported but whose attempt has
  since been retried and replaced (`is_current = 0`) can no longer recover
  through its old, retired credential — only the *current* attempt's own
  settlement counts. `"stopped"`/`"abandoned"`/`"superseded"` reasons never
  qualify regardless of attempt state. The same (never a second) credential
  is used for all of this — there is no legitimate product path that mints a
  second credential for one dispatch.
- `orchestration.ask` / `orchestration.reply`: routed from both
  `dispatch_inner` (admin) and `dispatch_worker` (authenticated worker) to
  root's `Engine::dispatch_coordination_question(request, Option<&WorkerBinding>) -> Result<Value, RpcError>`
  in `lib.rs`. This module now exists and compiles; the pre-wiring
  behavioral RED was an honest `method_not_found` (confirmed before wiring).
  Required `#[derive(Clone)]` on `coordination_identity::Actor` (root's
  handler clones it); no other change to root's file. Removed the earlier
  `#![allow(dead_code)]` on `coordination_mail_questions.rs` — its
  `ask_new_in_tx`/`ask_resume_in_tx`/`reply_in_tx` are genuinely reachable
  now (called by root's handler), so clippy's dead-code lint stays honest
  without a suppression.
- `orchestration.check`, `Unread` mode with a `wait` budget
  (`Engine::wait_for_unread_candidate`): a lock-free pre-check loop polls a
  read-only snapshot (`delivery::inspect_in_tx`, unread-only, limit 1) every
  50ms (or less, capped by the remaining budget), holding no
  SQLite/ledger/lifecycle lock between observations, until a candidate
  appears, the budget elapses, or `self.quiescent` flips (shutdown). Two
  correctness fixes on top of the original loop:
  - **Replay never waits.** Before looping at all, `ledger_receipt_exists`
    checks the exact ledger key (`actor.receipt_key(request_id)`, the same
    key `coordination_mutation` uses) directly against the `requests` table.
    If a receipt already exists, `run_atomic`'s fingerprint check will
    replay (or conflict) without ever invoking the work closure, so waiting
    first would only add latency to an already-decided outcome — skipped
    entirely.
  - **Shutdown cancellation is graceful, not an error.** If the wait loop
    observes `self.quiescent` (mid-wait or already-true), the dispatcher
    returns a plain `coordination_read` response with `cancelled: true`
    directly — it never calls `coordination_mutation` for this, because that
    path's own quiescent guard would otherwise turn every cancellation into
    a hard `runtime_busy` error, making `cancelled: true` unreachable in
    practice. Nothing is ledgered for a cancelled wait (no side effect
    occurred, so nothing needs a replay-stable receipt).
  When the wait does run to completion, exactly one real, ledger-atomic
  delivery attempt follows (`commit_check_unread`); if it still finds
  nothing, the result honestly reports `timedOut: true`. `Peek`/`All` are
  unaffected (`allows_wait()` already refuses a wait budget there at the
  protocol layer).
- `coordination_worker_control.rs`: `workerStop` and `workerAbandon` also
  call `questions::close_dispatch_questions_in_tx` in the same fencing
  transaction, so a pending question addressed to or from a stopped/
  abandoned dispatch closes atomically with the fence. `workerRelease` is
  unchanged: questions are already closed by the time an attempt is
  release-eligible.
- `db.rs`: `coordination_mail::migrate_in_tx` runs inside the single
  aggregate startup migration transaction, alongside the existing
  components.

## What is explicitly out of scope here

- The `orchestration.ask` / `orchestration.reply` *RPC logic itself*
  (`coordination_question_rpc.rs`) and its test file
  (`native_question_rpc.rs`) are root's exclusively — not edited, only
  routed to.
- Group addressing (`SendTarget::Group`) is refused with `invalid_argument`
  in `commit_send` — root's fanout responsibility per the task brief.

## Test evidence

- `cargo test --offline -p drogon-core --test native_mail_rpc` — 15/15 pass,
  including: send+check round trip with ACK; final report settles/revokes/
  closes questions; same-request-id replay (non-final and settled-report);
  new-request-id duplicate/conflict via the *same* original credential (no
  second seeded secret anywhere); a corrupted `"reported"` row with no
  matching attempt is refused everywhere; a generic `send` of a question is
  answerable via `reply`; entry-level stale generation-1 coordinator ACK
  refused after a real `runUse` takeover; bounded wait times out honestly,
  delivers a message that arrives mid-wait, skips the wait loop entirely on
  same-id replay, and returns a graceful `cancelled: true` (not an error) on
  shutdown.
- `cargo test --offline -p drogon-core --lib coordination_access_tests` —
  26/26 pass, including the two new negative tests:
  `reported_reason_without_any_matching_attempt_row_is_unauthorized` and
  `reported_but_retired_by_a_later_retry_is_unauthorized` (a genuinely
  reported, then retried-over attempt cannot recover), plus the pre-existing
  `superseded_reason_never_grants_settled_report_recovery`.
- `cargo test --offline -p drogon-core --test native_question_rpc` (root's
  file, unmodified) — 7/7 pass, including a real shutdown-during-wait
  cancellation test for `ask` (same graceful-not-error pattern applied here
  to `check`).
- `cargo test --offline -p drogon-core --no-fail-fast` — full crate suite:
  the only failure is the pre-existing, root-owned
  `bot_automation_startup_atomicity::two_concurrent_engine_open_calls_...`
  schema-snapshot assertion.
- `cargo clippy --offline -p drogon-core --all-targets -- -D warnings` — exit
  code 101 (not clean, reported honestly). The only remaining error is
  `session_admission.rs`'s unused `workspace_id`/`host_id` accessors,
  root-owned. Every clippy error inside files I own was fixed, including the
  question-domain dead-code that is now genuinely live.
- `cargo fmt -p drogon-core -- --check` — clean for every file I touched;
  root's `native_question_rpc.rs` untouched.
- `cargo build -p drogon-core` against root's landed
  `coordination_question_rpc.rs`/`tests/native_question_rpc.rs` — compiles
  clean; no errors to report.

## Files touched

`coordination_mail_rpc.rs`, `coordination_access.rs`,
`coordination_access_tests.rs`, `coordination_identity.rs` (added
`#[derive(Clone)]` to `Actor`), `coordination_mail_delivery.rs`,
`coordination_mail_questions.rs` (correlation helper extracted, dead-code
allow removed), `coordination_receipts.rs` (one call-site update for the
widened `recheck_in_tx` signature), `coordination_worker_control.rs`,
`db.rs`, `dispatch_authenticated_tests.rs`, `lib.rs` (mail dispatch wiring
plus the `orchestration.ask`/`orchestration.reply` route to root's handler),
`tests/coordination_access_daemon_entry.rs`, `tests/native_mail_rpc.rs`,
this doc. `coordination_question_rpc.rs` and `tests/native_question_rpc.rs`
are root's, untouched.
