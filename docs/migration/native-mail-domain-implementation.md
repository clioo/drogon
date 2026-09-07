# Native coordination mail/question domain

Transaction-only implementation of the mail/question half of the frozen
`orchestration_mail.rs`/`orchestration_question.rs` wire contract, in
`crates/drogon-core/src/coordination_mail*.rs`. Every function takes the
caller's own `&rusqlite::Transaction`; this module opens no connection,
mints no ids/timestamps, and does no process/network/filesystem I/O. It is
not wired into any RPC, the daemon, or `db::migrate_and_recover` — that is
root's integration, matching how `coordination_attempts.rs` (this run's
sibling domain) is also still unwired. Base: `729808a` (`705b79d` merged);
this revision starts from the retained candidate `3c290ba`.

## Root review correction (this revision)

Root retained `3c290ba` (31 tests passing) without accepting it, and found
six real defects by reading the bodies. All six are fixed here, each with a
compiled behavioral RED captured against the unfixed candidate before the
fix, then green after:

1. **`inspect_in_tx` filtered kinds in Rust after a bounded, unfiltered
   fetch.** A small `limit` produced a small unfiltered probe window; if
   none of those rows matched the kind filter, the call returned empty with
   no cursor, hiding a real later match. Fixed by pushing the kind
   predicate into the SQL `WHERE` clause itself, so `LIMIT` applies after
   filtering. RED: `inspect_kind_filter_does_not_lose_matching_rows_beyond_the_probe_window`
   failed with `left: 0, right: 1` (the matching message was invisible).
   Also added the local `1..=MAX_PAGE_LIMIT` enforcement `inspect_in_tx`
   claimed but never performed.
2. **The consuming-check wake-kind filter only searched the (at most 50)
   already-fetched candidates**, so a matching message at position 51+
   never woke the caller — an effective infinite wait. Fixed with a
   separate, SQL-pushed `any_unread_matches_kind` existence check that
   scans the *entire* unread backlog (unbounded by the 50-message delivery
   cap); once a match exists anywhere, the oldest FIFO prefix (still capped
   at 50, still including older nonmatching messages) is delivered — the
   triggering message itself may arrive in a later batch. RED:
   `wake_kind_beyond_first_fifty_candidates_still_wakes_and_delivers_oldest_prefix`
   panicked with "a match exists ... and must still wake" (no delivery was
   allocated at all).
3. **No serialized-byte budget backed a check delivery or a replay, and
   `inspect`/`enforce_message_size` measured raw string length, not the
   actual wire shape.** A raw-length check misses JSON-escaping blowup
   (every `"`/`\` roughly doubles) and ignores every field but body/payload
   (ids, kind, subject, from/to). Fixed with `message_wire_size`: it
   serializes the real `MessageSummary` and adds a conservative flat
   per-message overhead (`PER_MESSAGE_WIRE_OVERHEAD_BYTES = 256`, covering
   the id's duplicate appearance in `delivery.messageIds`/
   `acknowledged.messageIds` and JSON punctuation — not an exact accounting
   of a same-call ACK's own, separately already-budgeted, delivery).
   `check_unread_in_tx` now trims its candidate batch to a prefix that
   actually fits `RESPONSE_BUDGET_BYTES`, freezes exactly that (never
   re-trims on replay, since replay only ever reloads the exact stored
   `message_ids_json`), and refuses explicitly — never an oversized
   delivery, never a silent empty-batch livelock — if even the single
   oldest candidate cannot fit alone (corrupted/legacy oversized row).
   RED evidence: `high_escape_body_is_measured_by_actual_serialized_size_not_raw_length`
   failed to error on a body of pure `"` characters whose raw length was
   under budget but whose real JSON size was not;
   `check_delivery_batch_respects_the_response_byte_budget_and_freezes_on_replay`
   failed because the old code allocated all 3 oversize-combined messages
   in one delivery; `corrupted_oversized_existing_row_is_refused_explicitly_not_delivered_or_silently_empty`
   failed because the old code happily delivered the ~1 MiB row it had no
   size check for at all.
4. **A cursor sequence above `i64::MAX` wrapped negative under `as i64`**,
   turning `sequence > after` into "matches everything" and silently
   restarting pagination; **a negative or impossibly-large stored read
   pointer, an unrecognized `from_kind`, and a recorded schema value other
   than exactly `1`** were all silently coerced instead of refused. Fixed:
   `decode_cursor` now rejects a sequence `> i64::MAX`; `read_pointer_in_tx`
   rejects a negative value and a value exceeding `MAX(sequence)` across
   the whole messages table (a read pointer can only ever legitimately be
   set from a real delivered batch's own max sequence, so anything beyond
   that is corruption, not "caught up"); `decode_row` now requires
   `from_kind` to be exactly `coordinator` or `dispatch` with a matching
   non-empty identity column, refusing anything else instead of defaulting
   to `Actor::Dispatch("")`; `migrate_in_tx` refuses any recorded version
   other than exactly `SCHEMA_VERSION` (previously `0`, or any value below
   the current version, silently proceeded as if absent). RED evidence
   (all captured against the unfixed candidate): the from-kind case
   produced `from_actor: "dispatch:"` (an empty-id actor) instead of an
   error; the schema case returned `Ok(())` for a stored `0`; the cursor
   and read-pointer cases returned `Ok` results instead of the expected
   `Err`. Scope validation otherwise remains root's authentication
   responsibility; this module does not invent any new authentication.
5. **SQLite errors went through the crate-wide `error::from_sqlite`, which
   embeds the driver's own message text** — including whatever a trigger
   or constraint raises, which can itself echo bound values such as a
   stored subject/body. Fixed with a new *local* `mail_storage_error`
   mapper (added only in `coordination_mail.rs`, `error.rs` untouched)
   that returns one fixed, generic message for every mail-storage failure;
   every `error::from_sqlite` call site in all three `coordination_mail*.rs`
   files now goes through it. RED/regression:
   `sentinel_trigger_proves_no_raw_driver_text_echo` installs a real
   temporary SQLite trigger that raises an error embedding a sentinel
   string on a specific subject, and asserts the sentinel is absent from
   the returned `RpcError`; against the unfixed candidate this failed with
   the sentinel verbatim in `message: "storage failure: SENTINEL-..."`.
6. **`StoredMessage`/`get_message_in_tx` exposed no typed sender identity or
   originating request id**, so `reply_in_tx` had to parse the opaque
   `"coordinator:id"`/`"dispatch:id"` wire string back apart with
   `strip_prefix`, and root would have had to do the same for ask-resume
   authorization or `DuplicateReportReceipt` recovery. Fixed:
   `StoredMessage` now carries `from: Actor` and `origin_request_id: String`
   directly (both already resolved during row decode); `reply_in_tx` uses
   `question.from` instead of string-parsing. This is an API-shape defect,
   not an observable runtime bug, so it has a confirming test
   (`origin_request_id_and_typed_sender_survive_a_real_read`) rather than a
   RED/GREEN pair. Group fanout must occur inside the **one** caller
   transaction that also produces the send's own receipt — one
   `append_message_in_tx` call per member, all in that same transaction,
   never one transaction per member (a partial fanout must never commit);
   the module doc comment and this file previously said the opposite and
   are corrected.

Independent full-suite verification after all six fixes: `cargo test
--offline -p drogon-core --lib coordination_mail` — 42 passed, 0 failed (the
original 31 assertions all retained unmodified, plus 11 new regression
tests); `cargo test --offline -p drogon-core` (whole crate) — 139/139 in the
lib target, only the same 14 pre-existing unrelated `run_create_*`/
`task_create_*` failures (confirmed already failing on `729808a` before any
of this work, via `git stash`); `cargo clippy --offline -p drogon-core
--all-targets` — 0 errors, only the same dead-code warning class as before
(this still-unwired module, plus pre-existing unrelated seams); `cargo fmt
-p drogon-core -- --check` — clean.

## Root review correction (integration blockers, this revision)

Root re-inspected the corrected candidate (`3c290ba`, 42/42 passing) and
found three further real defects, closed here with a compiled RED before
each fix:

1. **The 256-byte per-message overhead didn't reserve room for a prior
   ACK's own up-to-50 escaped ids riding in the same response.** A single
   near-512KiB message could be packed while a same-call ACK echo pushed
   the real combined `Response` over the wire budget. Fixed with
   `RESPONSE_ENVELOPE_RESERVE_BYTES` (32 KiB, measured against a real
   worst-case 50-id ACK + 50-id delivery + `CheckResult`/`Response`
   skeleton with maximally-escaped 128-byte ids, which serializes to 26497
   bytes — the constant is proven sufficient by
   `near_budget_message_with_full_ack_still_fits_the_wire_budget`, not
   merely asserted) and `PACKING_BUDGET_BYTES = RESPONSE_BUDGET_BYTES -
   RESPONSE_ENVELOPE_RESERVE_BYTES`, now the actual ceiling for every
   packing decision (`check_unread_in_tx`'s batch trim, `inspect_in_tx`'s
   page trim, and the corrupted-row refusal in both). RED:
   `oversized_combined_response_is_never_silently_allowed` failed against
   the unfixed code because a message sized to pass the old
   per-message-only check produced a genuinely oversized serialized
   `Response`.
2. **`inspect_in_tx`'s oversized-row guard required `!included.is_empty()`**,
   so a corrupt individually-oversized row landing first on a page was
   included anyway instead of refused. Fixed by checking `row_size >
   PACKING_BUDGET_BYTES` unconditionally, before the page-boundary check,
   regardless of position. RED:
   `inspect_refuses_a_corrupted_first_row_that_is_individually_oversized`
   failed (the corrupted row was returned, not refused).
3. **Replay and ACK trusted the stored batch blindly** — id count,
   uniqueness, order, recipient and size were never re-verified, and
   `max_sequence` was applied to the read pointer without checking it
   matched the batch's real last message. Fixed with
   `validate_delivery_batch`, called by both the replay path in
   `check_unread_in_tx` and by `ack_in_tx` before any consumption: it
   re-validates `OutstandingDelivery` shape, confirms every message's `to`
   equals the expected recipient, requires strictly increasing sequences,
   recomputes real total wire size against `PACKING_BUDGET_BYTES`, and
   requires the stored `max_sequence` to equal the batch's true last
   sequence — refusing the whole batch on any mismatch, never shrinking it.
   RED: `replay_refuses_a_delivery_batch_tampered_to_a_foreign_recipient_message`
   failed (a tampered batch referencing another mailbox's message was
   delivered); `ack_refuses_a_tampered_max_sequence_without_consuming_anything`
   failed (an ACK with an undershot `max_sequence` succeeded, silently
   under-advancing the read pointer).

All three fixes reuse the same validator/threshold uniformly rather than
duplicating logic per call site. Verification: `cargo test --offline -p
drogon-core --lib coordination_mail` — 47 passed, 0 failed (the original 42
assertions unchanged, 5 new); `cargo test --offline -p drogon-core` — same
144/144 lib-target pass rate plus the identical 14 pre-existing unrelated
failures; `cargo clippy --offline -p drogon-core --all-targets` — 0 errors;
`cargo fmt -p drogon-core -- --check` — clean.

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
| `coordination_mail::get_message_in_tx` | Exact read by id; `StoredMessage` carries the frozen `summary`, the typed `to: Recipient` and `from: Actor`, and `origin_request_id: String` |
| `coordination_mail::message_wire_size` | Actual serialized wire size of one message (real JSON bytes + conservative per-message overhead) |
| `coordination_mail::PACKING_BUDGET_BYTES` | Real ceiling for packing (wire budget minus the worst-case envelope reserve); used everywhere a delivery/page is assembled |
| `coordination_mail::mail_storage_error` | Local safe SQLite-error mapper (never echoes driver/trigger text) |
| `coordination_mail::Actor`, `Recipient` | Sender/recipient identity |
| `coordination_mail::delivery::check_unread_in_tx` | Consuming check + optional ACK, one poll |
| `coordination_mail::delivery::inspect_in_tx` | Peek (`unread_only=true`) / all, paginated |
| `coordination_mail::delivery::Consumer` | Reader identity (coordinator+generation, or dispatch) |
| `coordination_mail::questions::ask_new_in_tx` | Atomic question + mail |
| `coordination_mail::questions::ask_resume_in_tx` | Pure read, never mutates |
| `coordination_mail::questions::reply_in_tx` | Addressed-actor-only, idempotent-by-body answer |
| `coordination_mail::questions::close_dispatch_questions_in_tx` | Close unresolved questions for a dispatch, both directions |

## Semantics implemented and tested (47 tests, all real SQLite)

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

See "Root review correction" above for the exact commands/counts run after
the six fixes (42 passed, 0 failed; clippy/fmt clean).

## Gaps / not claimed (explicit)

- **Nothing calls any of this yet.** No RPC handler, no daemon wiring, no
  `db::migrate_and_recover` hook — root owns all of that, plus deciding how
  `Engine::dispatch_worker`/coordinator dispatch construct `Actor`/
  `Recipient`/`Consumer` from an authenticated request and call in.
- **Group addressing is entirely root's responsibility.** This domain has
  no `Recipient::Group` variant; root must resolve/refuse
  `SendTarget::Group` before calling `append_message_in_tx`, and any group
  fanout must happen inside the **one** transaction that also produces the
  send's own receipt (one call per member, all in that same transaction —
  never one transaction per member, since a partial fanout must never
  commit).
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
- **The per-message wire-size overhead is a conservative flat constant
  (`PER_MESSAGE_WIRE_OVERHEAD_BYTES = 256`), not an exact accounting of a
  same-call ACK's own delivery riding alongside a new one in one response.**
  A same-call ACK's own message set was already budget-checked at the time
  *it* was minted; this module does not re-derive a combined worst-case for
  both appearing in one response together. This is a disclosed
  simplification, not a silent gap.
- **`read_pointer_in_tx`'s "impossible pointer" check uses the messages
  table's global `MAX(sequence)`**, not a per-mailbox maximum, since
  `sequence` is one shared counter across every mailbox. This still
  correctly catches any pointer that could not have come from a real
  delivery anywhere, but a corrupt pointer that happens to sit below the
  *global* max while still exceeding its own mailbox's real messages is not
  separately detected.
