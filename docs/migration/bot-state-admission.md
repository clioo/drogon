# Bot/Automation storage admission and aggregate startup gate

## Root verification — 2026-09-06

After the worker settled, root formatted the transferred Rust slice and ran
`CARGO_BUILD_JOBS=2 cargo test --workspace --locked --offline --quiet`:
**295 passed, 0 failed, 0 ignored**. Strict workspace/all-target Clippy and
`git diff --check` passed. Root inspected the real Engine startup transaction
and the three failure fixtures; these prove rollback of the asserted schema,
version, recovery and identity state, not byte-for-byte filesystem immutability
(opening SQLite can change journal metadata). The worker counts and format
limitations below are historical; root's current checks supersede them.

Status remains pending PR review and integration. No Bot RPC, scheduler, SSH
authority fence, UI, or new installed preview is admitted by these checks.

Status: **narrow-scope review complete; a real single-transaction aggregate
startup gate is now wired into `Engine::open`; full Bot feature still not
admitted**. This is a direct depth-1 leaf task under root Astra, scoped to
reviewing the preserved native Bot/Automation storage slice
(`docs/migration/sol-wave/cap-bots/native-state.md`/`.json`,
`docs/migration/worktree-bots-transfer.json`) and closing one specific
integration gap in `Engine::open`. Nothing outside that gap was implemented.

## Correction to this document's prior revision (this task)

An earlier revision of this document (below, kept for provenance under
"Superseded first pass") described a `check_schema_not_ahead`-precheck-then-
`migrate` design as "the single atomic startup migration gate" and reported it
as done. Root review rejected that as **not actually atomic**, for concrete,
reproducible reasons: `Engine::open` called `db::create_tables` for the main
schema *before* any capability-schema check ever ran (auto-committing
immediately, in SQLite's default autocommit mode, since it wasn't wrapped in
any transaction at all), and separately ran prior-instance session/request
recovery before the capability check too. So a startup attempt that
ultimately failed could still have durably created the main schema and
flipped `pending`/`live` rows to `unverifiable`/`done` -- and even between the
two capability components, a genuine SQL failure (not just a version
mismatch) partway through the second component's migration left the first
component's already-applied steps durably committed, because each component's
`migrate` commits every step immediately as its own transaction.

This task replaces that design with a real single SQL transaction (see "The
real fix" below) and adds deterministic tests
(`tests/bot_automation_startup_atomicity.rs`) that were first run against the
rejected design to confirm they fail there (RED), then against the new design
to confirm they pass (GREEN). Both runs are recorded verbatim under "RED/GREEN
evidence" below. The rejected design's own doc claims ("this is the single
atomic startup migration gate") were incorrect and are superseded by this
correction, not merely restated in different words.

## The real fix

`crates/drogon-core/src/db.rs`'s `open()` no longer creates the main schema at
all -- it only opens the connection and sets pragmas (WAL, synchronous,
busy timeout). A new `db::migrate_and_recover(conn) -> Result<String,
StartupError>` does everything else in **one** transaction, opened via
`automations_storage::begin_immediate` (`BEGIN IMMEDIATE`, the same
transaction mechanism `automations::storage`'s own multi-step writers already
use -- reused, not a second connection/transaction architecture):

1. `create_tables(&tx)` -- the main (meta/workspaces/sessions/requests) schema.
2. `automations::storage::apply_pending_steps_in_tx(&tx)` -- new: applies
   every pending `automations` migration step using the caller's transaction,
   without opening or committing one of its own.
3. `bots::storage::apply_pending_steps_in_tx(&tx)` -- the `bots` equivalent.
4. `recover_from_prior_instance(&tx)` -- the same session/request recovery
   SQL as before, now inside the transaction instead of run separately
   beforehand.
5. `read_or_create_host_id(&tx)` -- moved here from `lib.rs` for the same
   reason: a freshly-created host id must not survive a rollback.
6. `tx.commit()` -- exactly once, at the very end.

On any error at any step, the `Transaction` is dropped without a `commit()`
call, which makes `rusqlite` issue a real `ROLLBACK`. That undoes every change
in this attempt: main schema creation (if this was a fresh database), both
components' schema/version rows and tables, prior-instance recovery's
session/request updates, and any newly created host id -- regardless of which
step failed or how late in the sequence.

`automations::storage::migrate` and `bots::storage::migrate` (the standalone,
per-step-committing entry points used directly by `tests/bot_storage.rs` and
`tests/automation_records.rs`) are unchanged in behavior and still exist
exactly as before, per this task's explicit instruction that the standalone
public `migrate` may preserve its documented stepwise behavior; only the
*aggregate* `Engine::open` path was wrong, and only that path was changed to
call the new `apply_pending_steps_in_tx` functions instead.

One additional, unrelated-but-real bug surfaced while writing the concurrent-
startup test: two connections racing to switch a brand-new database file from
its default rollback-journal mode to WAL can hit `SQLITE_BUSY`/`SQLITE_LOCKED`
on that one-time mode switch in a way `busy_timeout`'s handler does not always
retry. `db::open` now retries that specific pragma for up to two seconds
(`set_wal_journal_mode_with_retry`) -- a narrow, bounded retry on a documented
one-time SQLite startup race, not a general error-swallowing loop.

`db.rs`/`lib.rs`'s combined diff for this correction is additive/replacing
within the same narrow integration surface this task owns (`Engine::open` and
its direct `db.rs` helpers); no other method, RPC, or table was touched.

## RED/GREEN evidence

`crates/drogon-core/tests/bot_automation_startup_atomicity.rs` (5 new tests)
drives real `Engine::open` (never `db::migrate_and_recover` or either
storage module's `migrate` called directly) and snapshots every
schema/content fact this task's atomicity guarantee covers (every
`sqlite_master` object and its exact `sql`, both components' `schema_versions`
rows, every session's verdict, every request's status/error, and the host
id) before and after a call, asserting byte-for-byte equality whenever
`Engine::open` returns an error:

1. `refused_future_bots_version_leaves_missing_main_tables_missing_and_older_automations_untouched`
   -- future `bots` version, no main tables yet, a genuine older-but-supported
   `automations` v1 schema.
2. `refused_future_automations_version_leaves_pending_live_sessions_and_requests_untouched`
   -- a fully-migrated database with a real `live` session, a real `pending`
   session, and a real `pending` request, then `automations` bumped to a
   future version.
3. `a_genuine_sql_failure_in_the_second_component_rolls_back_the_first_components_migration_too`
   -- both components at a genuine, real, supported v1 needing to step to v2;
   a real conflicting `TABLE` occupies the exact name `bots`' v1->v2 step
   needs for `CREATE UNIQUE INDEX IF NOT EXISTS`, which SQLite refuses (a
   genuine SQL error, not a version mismatch) even with `IF NOT EXISTS`,
   because the existing object is a different kind. Verified with the
   `sqlite3` CLI first (`CREATE TABLE conflict_name (x INTEGER); CREATE INDEX
   IF NOT EXISTS conflict_name ON conflict_name(x);` -> `Error: in prepare,
   there is already a table named conflict_name`) before relying on it here.
4. `reopening_after_a_refusal_reproduces_the_identical_error_and_state_with_no_drift`
   -- three successive refused `Engine::open` calls against the same
   future-versioned database must all fail identically with zero cumulative
   drift.
5. `two_concurrent_engine_open_calls_against_the_same_data_dir_both_succeed_consistently`
   -- two real OS threads calling `Engine::open` against the same fresh data
   directory concurrently; both must succeed and agree on the same host id.

### RED run (against the rejected precheck-then-independently-commit design)

The rejected design (this document's "Superseded first pass" below) was
temporarily restored (`db.rs`/`lib.rs` only; the storage-module additions are
additive and harmless either way) and the same test file run against it:

```text
cargo test -p drogon-core --locked --offline --test bot_automation_startup_atomicity -- --nocapture
```
Result: **2 passed, 3 failed** (scenarios 4 and 5 happened to still pass --
reopen self-consistency and concurrency are not what that design got wrong;
scenarios 1-3 are exactly what it got wrong):

- Scenario 1 FAILED: after refusal, `meta`/`sessions`/`workspaces`/`requests`
  existed in `sqlite_master` (main schema was created unconditionally before
  the capability check ever ran).
- Scenario 2 FAILED: after refusal, both sessions had been flipped to
  `unverifiable` and the request to `done` with a synthesized
  `error_json` (recovery ran, and committed, before the capability check).
- Scenario 3 FAILED: after the genuine SQL failure in `bots`' step,
  `automations` was recorded at version 2 (not 1) and its
  `automation_runs_automation_id_id` index existed -- its successful step had
  already committed independently before `bots` ever failed.

### GREEN run (against this task's real single-transaction fix)

The fix was restored and the identical test file re-run:

```text
cargo test -p drogon-core --locked --offline --test bot_automation_startup_atomicity -- --nocapture
```
Result: **5 passed, 0 failed**, run 15 consecutive times with no flakes
(the concurrency scenario is timing-sensitive by nature, hence the repeated
runs rather than a single pass).

```text
cargo test -p drogon-core --locked --offline --test bot_storage --test automation_records --test locale_ordering --test bot_automation_engine_startup --test bot_automation_startup_atomicity
```
Result: exit 0; **74 passed, 0 failed, 0 ignored** (the 64 previously-admitted
tests, unchanged; the 5 from the prior pass's `bot_automation_engine_startup.rs`,
unchanged in outcome though its doc comments were corrected to stop
referencing the now-removed `db::migrate_capability_schemas`; and the 5 new
atomicity tests above).

```text
cargo test -p drogon-core --locked --offline
```
Result: exit 0; whole-crate run, **149 passed, 0 failed, 0 ignored** across
all 15 test binaries (the 5 above plus `engine`, `database-path-safety`,
`harness_catalog`, `exit-observation`, `session-persistence`, `claim_identity`,
`bot_input`, `workspace-path-safety`, plus doc-tests). No regression in any
pre-existing suite, including the ones exercising real PTY sessions and
crash-recovery, and including the pre-existing concurrent-connection tests in
`bot_storage.rs`/`automation_records.rs`.

```text
cargo clippy -p drogon-core --locked --offline --all-targets -- -D warnings
```
Result: exit 0.

`cargo fmt --all -- --check` still reports diffs, but none in any file this
task touched (`db.rs`, `lib.rs`, `automations/storage.rs`, `bots/storage.rs`,
`tests/bot_automation_engine_startup.rs`, `tests/bot_automation_startup_atomicity.rs`
are all clean); the remaining diffs are the same pre-existing ones recorded in
`native-state.md` (unrelated dirty files and lines this task did not touch),
left alone per the same nearest-stable-handoff instruction that produced that
prior report.

All commands ran `--locked --offline` with `CARGO_BUILD_JOBS=2` from this
worktree's own `cargo` target, never from the read-only source checkout.

## What this does NOT do (explicitly out of scope for this task)

- **No SSH host-authority fence.** The Bot-ID `AutomationOwnerPrecondition`
  used by `bots::storage` is a Bot-ownership check only; it is not and does
  not approximate the source's `assertAutomationOwnerFence` (self/ssh
  target-generation/orphan resolution against live SSH state). That fence
  remains fully open, per `native-state.md`.
- **No global Automation mutation/deletion RPC, scheduler, network, or UI
  exposure.** `Engine::dispatch`'s method table is unchanged; this task only
  makes the storage schemas exist and be usable, atomically, at startup.
- **No host-default locale binding.** `bots::storage::list_bots` still takes
  an explicit `host_locale` argument from its caller; nothing in this task
  discovers or binds a real per-host default.
- **The five partial / three open source cases** from the 20-case native
  Bot/Automation map (`tests/parity/ports/WP-CAP-BOTS/native-state/case-map.json`)
  are unchanged by this task -- it only concerns database startup atomicity
  for the already-covered/partial storage slice, not completing those cases.
- **No new schema-versioning infrastructure for the main (session/workspace/
  request) schema.** It still uses unversioned `CREATE TABLE IF NOT EXISTS`,
  unchanged; only the `bots`/`automations` components have version rows, as
  scoped ("main/Bot/Automation schemas" meaning the main schema's table
  creation now runs inside the same one transaction as the capability
  components, not that it gained future-version refusal semantics of its
  own).

## Files touched by this task (this correction)

| File | Change |
|---|---|
| `crates/drogon-core/src/db.rs` | Removed unconditional `create_tables` call from `open()`. Replaced `CapabilitySchemaError`/`migrate_capability_schemas` with `StartupError`/`migrate_and_recover`, a real single-transaction gate covering main schema, both capability components, recovery, and host-id creation. Moved `read_or_create_host_id` here from `lib.rs`. Added `set_wal_journal_mode_with_retry` for the concurrent-startup WAL-switch race. |
| `crates/drogon-core/src/lib.rs` | `Engine::open` now calls `db::migrate_and_recover(&conn)` once instead of the three separate prior calls; removed the now-dead local `read_or_create_host_id`. |
| `crates/drogon-core/src/automations/storage.rs` | Added `apply_pending_steps_in_tx(tx: &Transaction)`, the transaction-internal step applier `migrate_and_recover` calls; `migrate` (standalone) unchanged in behavior. |
| `crates/drogon-core/src/bots/storage.rs` | Same addition as above, `bots` component. |
| `crates/drogon-core/tests/bot_automation_startup_atomicity.rs` | New: the 5 RED/GREEN atomicity tests above. |
| `crates/drogon-core/tests/bot_automation_engine_startup.rs` | Doc-comment corrections only (no longer references the removed `db::migrate_capability_schemas`); its 5 tests are unchanged and still pass. |

---

## Superseded first pass (kept for provenance; see "Correction" above)

*(The following is this document's original content from before root review.
It is preserved verbatim for historical provenance; its "single atomic
startup migration gate" framing is incorrect and is corrected above, not by
editing the text below.)*

`crates/drogon-core/src/{bots,automations}/storage.rs` each already had a
correct, tested, step-wise `migrate(conn)` function sharing one
`schema_versions` table on the same connection. But `Engine::open`
(`crates/drogon-core/src/lib.rs`) never called either one -- it only ran
`db::create_tables` for the main (session/workspace/request) schema. So the
previously-delivered Bot/Automation storage modules were reachable by tests
that opened their own raw connection, but were never actually created by the
real `Engine::open` startup path at all.

Inspecting the two `migrate` functions together also surfaced a real
ordering hazard for the fix: each component's `migrate` only checks *its
own* recorded schema version against what it supports. Calling
`automations::storage::migrate` then `bots::storage::migrate` in sequence
(the naive way to wire both into startup) lets an earlier component durably
commit its own schema before a later component discovers a recorded version
newer than this build supports and refuses -- so the database ends up
partially altered even though the aggregate startup as a whole reports
failure.

Both `automations::storage` and `bots::storage` gained a
`check_schema_not_ahead(conn)` read-only precondition (extracted from the
front of each `migrate`, which now calls it too): it refuses -- without
creating or altering any component table -- if the recorded version is newer
than supported.

`crates/drogon-core/src/db.rs` added `migrate_capability_schemas(conn)`: a
check-then-act aggregate gate, described at the time as "not a single
wrapping SQL transaction" and as "atomic" only in the sense that both
components' `check_schema_not_ahead` ran before either applied a step. Root
rejected this framing (see "Correction" above): main schema creation and
prior-instance recovery still ran completely outside of any transaction at
all, and a genuine SQL failure (as opposed to a version mismatch) in the
second component still left the first component's independently-committed
steps in place.
