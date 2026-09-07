# Native coordination mail/question domain

Transaction-only implementation of the mail/question half of the frozen
`orchestration_mail.rs`/`orchestration_question.rs` wire contract, in
`crates/drogon-core/src/coordination_mail*.rs`. Every function takes the
caller's own `&rusqlite::Transaction`; this module opens no connection,
mints no ids/timestamps, and does no process/network/filesystem I/O. It is
not wired into any RPC, the daemon, or `db::migrate_and_recover` — that is
root's integration, matching how `coordination_attempts.rs` (this run's
sibling domain) is also still unwired. Base: `729808a` (`705b79d` merged).

## Files

- `coordination_mail.rs` — additive v1 schema (`migrate_in_tx`), the shared
  `Actor`/`Recipient` identity types, `append_message_in_tx`,
  `get_message_in_tx`. Declares `pub(crate) mod delivery;` / `mod
  questions;` pointing at the two companion files below (so `lib.rs` gets
  exactly one `mod coordination_mail;` line, per scope).
- `coordination_mail_delivery.rs` — `check_unread_in_tx` (consuming
  check+ACK), `inspect_in_tx` (peek/all), `Consumer`, `CheckOutcome`.
- `coordination_mail_questions.rs` — `ask_new_in_tx`, `ask_resume_in_tx`,
  `reply_in_tx`, `close_dispatch_questions_in_tx`, `QuestionRecord`.
- `coordination_mail_tests.rs` / `coordination_mail_delivery_tests.rs` /
  `coordination_mail_questions_tests.rs` — real SQLite, no mocks.

## Schema (additive v1, one component: `orchestration_mail`)

- `orchestration_mail_messages` — immutable rows: kind, `from_kind`/
  `from_coordinator_id`/`from_dispatch_id`, `to_dispatch_id` (`''` sentinel
  = run home), subject/body/payload, thread, `origin_request_id`. Recipient
  and sender identity are separate columns, never delimiter-joined.
  `sequence` (AUTOINCREMENT) is the only ordering; no timestamp ordering.
- `orchestration_mail_read_pointers` — one row per `(host, run,
  recipient)`, tracking `read_through_sequence`. Shared across coordinator
  generations for the run-home mailbox (a takeover's new generation reads
  from the same unmoved pointer, so it never loses mail the old generation
  never acknowledged).
- `orchestration_mail_deliveries` — one row per allocated batch, keyed by
  `(host, run, recipient, consumer)`; a partial unique index enforces at
  most one unacknowledged row per exact key. `consumer` is
  `(coordinator_id, generation)` for the run-home mailbox or implicit
  (`Consumer::Dispatch`) for a dispatch's own inbox.
- `orchestration_mail_questions` — correlates to a `Question`-kind message
  by `question_message_id`; stores only `thread_id`/`closed`/
  `closed_reason`/answer fields. Asker/addressee are read from the
  correlated message row (`from`/`to`), not duplicated.

`migrate_in_tx` refuses a recorded future version before creating any
table; a caller rollback undoes every table (`migration_rollback_undoes_every_table`,
`future_schema_version_is_refused_before_touching_tables`).

## Exported API map (`pub(crate)`)

| Function | Purpose |
| --- | --- |
| `coordination_mail::migrate_in_tx` | Additive v1 schema |
| `coordination_mail::append_message_in_tx` | Append one immutable message |
| `coordination_mail::get_message_in_tx` | Exact read by id |
| `coordination_mail::Actor`, `Recipient` | Sender/recipient identity |
| `coordination_mail::delivery::check_unread_in_tx` | Consuming check + optional ACK, one poll |
| `coordination_mail::delivery::inspect_in_tx` | Peek (`unread_only=true`) / all, paginated |
| `coordination_mail::delivery::Consumer` | Reader identity (coordinator+generation, or dispatch) |
| `coordination_mail::questions::ask_new_in_tx` | Atomic question + mail |
| `coordination_mail::questions::ask_resume_in_tx` | Pure read, never mutates |
| `coordination_mail::questions::reply_in_tx` | Addressed-actor-only, idempotent-by-body answer |
| `coordination_mail::questions::close_dispatch_questions_in_tx` | Close unresolved questions for a dispatch, both directions |

## Semantics implemented and tested (31 tests, all real SQLite)

- FIFO batch cap of 50, ordered (`fifo_batch_is_ordered_and_capped_at_fifty`).
- One outstanding delivery per exact consumer key, replayed identically
  until whole ACK, including a genuine two-real-connection race using
  `TransactionBehavior::Immediate` so the check is a real serialization,
  not an in-process ordering assumption (`real_two_connection_race_serializes_to_one_delivery`).
- Whole ACK advances the shared read pointer and allows the next
  allocation; duplicate ACK is idempotent; wrong run/recipient/host/
  generation (including a stale generation's *own* delivery id) is
  rejected before consumption.
- Takeover: a newer generation allocates the same still-unread mail; the
  fix here is a generation-floor check inside ACK itself (`MAX(consumer_generation)`
  ever observed for that mailbox) — an old generation's delivery id still
  matches its own row by exact key, so exact-key matching alone cannot
  fence a takeover; this was a real bug the tests caught and this revision
  fixes (see `old_delivery_id_cannot_be_acked_but_new_generation_still_gets_the_unread_mail`).
- Kind filter is wake-only: it can suppress allocation entirely
  (`no_matching_wake_kind_allocates_nothing`) but never trims an allocated
  batch or skips earlier non-matching messages
  (`kind_filter_never_skips_earlier_nonmatching_messages`); an existing
  delivery replays regardless of a new filter.
- Peek/all create no delivery and touch no read pointer; peek is
  unread-only, all includes acknowledged mail.
- Cursors are fixed-width binary (`sequence:u64 || SHA-256 fingerprint`) of
  `(host, run, recipient, mode, sorted kinds)`, base64-encoded via the
  crate's existing `session::base64_encode`/`decode` — no new dependency.
  A cursor from a different scope/filter is rejected
  (`cursor_paginates_without_skipping_and_rejects_foreign_scope`).
- Response budget (512 KiB) is enforced both per-message (before insert,
  `oversized_body_is_refused_before_any_mutation`) and per-page (stops
  without omitting the boundary row, `response_budget_stops_a_page_without_omitting_the_boundary_message`).
- Questions: atomic append+correlation row, real rollback undoes both;
  resume never mutates or creates mail; only the addressed actor may
  reply (run-home addressee accepts any coordinator identity — root
  already authenticated "current"; dispatch addressee requires that exact
  dispatch); first reply wins, an exact repeat of the same body replays
  the original answer, any other body is `answer_conflict`; a supplied
  reply thread that disagrees with the question's own thread is refused
  before any message is appended; both directions (run-home→dispatch,
  dispatch→run-home) work; closing affects only unresolved questions for
  the named dispatch in either party role and never touches history rows
  or already-answered questions.
- Genuine commit persists across a real file reopen
  (`genuine_commit_persists_across_reopen`).

Commands run: `cargo test --offline -p drogon-core --lib coordination_mail`
(31 passed) and `cargo clippy --offline -p drogon-core --all-targets`
(0 errors; only dead-code warnings, all for this now-also-unwired module
plus the pre-existing unrelated seams already present on `729808a` —
verified identical baseline via `git stash`). `cargo fmt -p drogon-core --
--check` is clean. The 14 pre-existing failures in
`crates/drogon-core/tests/` (`run_create_*`, `task_create_*`, etc.) are
unrelated staged behavioral-RED tests for a different domain and were
already failing on `729808a` before this change (verified via `git
stash`); this task did not touch or alter them.

## Gaps / not claimed (explicit)

- **Nothing calls any of this yet.** No RPC handler, no daemon wiring, no
  `db::migrate_and_recover` hook — root owns all of that, plus deciding how
  `Engine::dispatch_worker`/coordinator dispatch construct `Actor`/
  `Recipient`/`Consumer` from an authenticated request and call in.
- **Group addressing is entirely root's responsibility.** This domain has
  no `Recipient::Group` variant; root must resolve/refuse
  `SendTarget::Group` before calling `append_message_in_tx` (once per
  member, in its own transaction, per the contract).
- **Generation currency beyond the ACK fence is root's job.** This domain
  only refuses an ACK from a generation strictly older than one it has
  itself observed on a later delivery; it cannot detect a stale generation
  that never lost a race here. The contract's "root rechecks current
  coordinator before each call" is a separate, necessary auth-layer check
  this module does not and cannot perform.
- **Concurrency safety assumes the caller begins transactions
  `IMMEDIATE`** (or otherwise takes the write lock before this module's
  first read). A `DEFERRED` transaction that reads before writing could
  race two allocations into a assert-fail on the partial unique index
  instead of one replaying the other's delivery; the real two-connection
  test uses `Immediate` deliberately and this requirement is not enforced
  by this module itself (it takes `&Transaction`, not transaction control).
- **No size/rate limiting beyond the single-message and per-page byte
  budgets** — no cap on total messages per run/mailbox, no automatic
  retention/garbage collection (matching the contract's explicit "no GC
  here").
- **`origin_request_id` is stored but not yet used for idempotent replay**
  of `send`/`ask` at this layer — duplicate-request detection against the
  request ledger is root's existing `requests.rs` responsibility, untouched
  by this task; this module only persists the field for that future wiring
  and for `DuplicateReportReceipt`-style recovery.
- Windows/remote-host behavior is not addressed; this is pure SQL logic
  with no platform dependency, but has not been evaluated for that context.
