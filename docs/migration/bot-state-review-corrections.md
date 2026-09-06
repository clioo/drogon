# Post-review corrections to the PR #3 Bot/Automation storage slice

Status: **root-directed depth-1 correction task complete; uncommitted in this
worktree (commits/push remain root-owned)**. Base: root merged `main`
(`2b6b163`) into candidate `6ae8ea2` with exact module-union resolution;
work began at HEAD `c09e5ef` (clean). The new `session_authority` module from
that merge is root-owned and was not touched. This addresses the accepted
findings from the three settled PR #3 reviews; it is not a re-review.

Reviewer-overlap note: the review that identified the findings below
explicitly confirmed the aggregate single-transaction gate itself
(`db::migrate_and_recover`), the bounded WAL-switch retry, the `rev`-CAS
fence, concurrent `Engine::open`, and the responsibility-run dedupe as sound
and genuinely tested. Nothing in this task re-opens those.

## 1. `Engine::open` permission hardening now covers the refusal path

Accepted finding: `Engine::open` invoked `db::migrate_and_recover` **before**
`db::harden_permissions`, so a refused capability gate (e.g. a future schema
version) returned before the chmod, leaving the database file the attempt
created/left behind at umask-default permissions (typically 0644) until some
later successful startup.

Evidence (genuine behavior RED first, per instruction):

```text
CARGO_BUILD_JOBS=2 cargo test -p drogon-core --locked --offline --test bot_automation_engine_startup
```

- Before the fix, with the new test
  `refused_startup_still_hardens_the_database_file_it_leaves_behind`
  (seeds a future-version `bots` database, forces its mode to 0644, calls
  the real `Engine::open`, expects the refusal AND mode 0600 afterwards):
  **6 passed, 1 FAILED** — the refusal left the file at `0o644` (420)
  instead of `0o600` (384). The companion success-path test
  `successful_startup_leaves_database_and_wal_sidecars_owner_only` was
  already GREEN (the old ordering did harden on success) and is kept as
  explicit coverage that db/WAL/SHM are all owner-only while the engine
  holds the connection open.
- Fix (`crates/drogon-core/src/lib.rs`): `migrate_and_recover`'s result is
  captured, `harden_permissions` runs **regardless of the gate's outcome**,
  chmod failures are propagated (`io_error`, never swallowed, and they take
  error precedence over the gate's refusal since a failed chmod is the more
  security-critical signal), and only then is the gate result mapped to the
  usual `internal_error("startup schema/recovery gate: …")`. Rollback
  semantics are untouched: hardening is a file-mode operation and cannot
  weaken the startup transaction.
- After the fix: same command, **7 passed, 0 failed**.

Sidecars: pre-planting fake `-wal`/`-shm` files is not reproducible (SQLite
may reset or reject a foreign WAL header, and a clean close deletes them),
so the refusal test asserts the main db unconditionally and any sidecars the
refused attempt produced conditionally (present ⇒ must be 0600). The
success-path test asserts all three unconditionally (they exist while the
engine is open).

Residual failure paths, deliberately not fixed and not claimed as secure
(no broadening beyond the accepted finding): if `db::open` itself fails
after creating the file (e.g. the bounded WAL-switch retry exhausting), or
`validate_files` rejects the data dir, `Engine::open` still returns before
any hardening of whatever bytes exist. These predate this PR's ordering
change, are unchanged by it, and would require a broader error-path
redesign; they are recorded here so nobody mistakes the fixed gate-refusal
path for a guarantee about every early-failure path. No global umask
mutation was made or considered.

## 2. Production docs corrected; WAL fail-closed semantics documented and covered

- `bots::storage` and `automations::storage` module docs no longer claim
  `migrate` is "proposed, not durable, until root calls it from
  `Engine::open`": the aggregate startup **is** wired via
  `db::migrate_and_recover`. The standalone `migrate` entry points keep
  their documented per-step-committing behavior for direct callers; the two
  call shapes are stated as such, not as two schema policies.
- `check_schema_not_ahead` docs in both modules no longer reference the
  removed `db::migrate_capability_schemas` (repo-wide grep now has zero
  matches) and no longer describe a "check every component before any
  applies a step" precheck. The actual mechanism is stated: components are
  applied sequentially inside **one** transaction, and the
  no-partial-state property comes from that transaction's
  rollback-on-any-failure — a later component's refusal undoes an earlier
  component's already-applied steps.
- Owner-fence docs (`automations::storage::assert_owner_fence`,
  `bots::storage::delete_automation_everywhere`): the nonexistent test name
  `delete_automation_everywhere_refuses_when_a_concurrent_connection_changed_ownership`
  is replaced with the real test
  (`delete_automation_everywhere_detects_ownership_changed_by_a_concurrent_connection`).
  The claim is now scoped to what the fence actually does: a structured
  `AutomationOwnerConflict` covers an ownership change that committed
  **before the caller's read**; a change landing **during** the call, after
  the caller's WAL read snapshot, fails closed with a SQLite
  busy/snapshot error and full rollback. No structured mid-call conflict is
  promised; the fail-closed WAL SQLite-error semantics are retained, not
  replaced. No new SSH-authority fence was fabricated.
- New deterministic WAL-mode two-connection coverage (no threads, no
  sleeps — the interleaving is sequenced explicitly through transaction
  state): `wal_mode_ownership_change_during_a_stale_snapshot_fails_closed_not_with_a_structured_conflict`
  in `tests/bot_storage.rs` pins that c2's write through a snapshot that c1
  invalidated fails with `ErrorCode::DatabaseBusy` (fail closed, no partial
  state), c1's committed change survives, and the documented structured
  refusal then applies through the real `delete_automation_everywhere` once
  the change precedes the caller's read.

Coverage boundary: the WAL test sequences `get_automation` and
`upsert_automation` directly inside an explicit transaction. It proves SQLite
stale-snapshot refusal and separately calls the real deletion entry point
after reassignment; it does **not** inject a concurrent write midway through
`delete_automation_everywhere` itself.

## 3. `migrate_ownership` retain-closure error handling

Review context: an external review claim said a corrupt automation payload
could make `migrate_ownership` silently commit a Bot whose scheduled
responsibility was dropped (the retain closure coerces a lookup `Err` into
"missing" ⇒ drop). Root's trace: the lookup and the later
`list_all_automations()?` run in the **same transaction**, so the
persistent corrupt payload repeats the failure there, the transaction is
dropped, and the whole repair rolls back — the "silent commit" claim is
**not proved**, and the durable behavior was already fail-safe.

Actions:

- New regression
  `migrate_ownership_rolls_back_completely_when_an_automation_payload_is_corrupt`
  (`tests/bot_storage.rs`): plants a non-JSON `automations.payload_json`,
  expects `migrate_ownership` to error, and verifies after a genuine reopen
  that the Bot's scheduled responsibility was **not** durably dropped and
  the corrupt row is untouched. Run against the **unmodified** production
  code first: GREEN (the `migrate_ownership`-filtered run — 4 pre-existing
  tests plus the new regression — passed; the file held 39 tests at that
  point). This is a GREEN coverage addition pinning the rollback guarantee
  — not an invented RED; no failure was fabricated to justify a fix.
- Narrow robustness refactor (`bots::storage::migrate_ownership`): the
  retain closure is replaced by an explicit loop that propagates lookup
  errors with `?`/`return Err` (transaction dropped ⇒ rollback) instead of
  coercing them to "missing"; genuinely missing automations still drop
  their responsibility projection; already-claimed automations still lose
  the later Bot's claim (first-Bot-wins by insertion order); the
  cross-scope ownership rules (only touch automations claimed in scope or
  with an in-scope dangling owner) are unchanged, as are all pre-existing
  tests (`migrate_ownership_*`, including the cross-scope isolation tests,
  pass unchanged).

## 4. Locale ordering: byte-distinct canonical-equivalent tie

New test
`canonical_equivalent_byte_distinct_names_compare_equal_and_stay_in_insertion_order`
(`tests/locale_ordering.rs`): `"éclair"` precomposed NFC (U+00E9) vs `"e"`
+ combining acute (U+0301) NFD — asserted **byte-distinct** — must compare
`Ordering::Equal` (symmetrically) under every admitted locale tag
(`en-US` explicit plus the fixture-admitted `es-MX`, `sv`, `tr`, `de`, `ja`),
and, fed from unsorted input with the pair inserted NFD-first/NFC-second,
must keep that insertion order through the stable sort while distinct names
order around them. This strengthens the existing identical-byte `"dup"`
tie test: the collator must normalize before comparing, not merely detect
byte equality.

Fixture generator: `gen-locale-fixtures.mjs` contained a dead
`CASES.equal_name_ties` string entry (skipped by the generator's own loop;
the real tie case is built from `tieItems`). Removed **only after** proving
byte-identical regeneration: Node24
(`/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`,
run from this repo's own cwd, per the script's own contract) produced
sha256 `4560622c1d8dfbb2f3cb7e780c7445cdeb911651fcc6a858c805abbe799b398c`
before and after the removal — identical to each other and to the committed
`node-fixtures.json` (which matches the hash recorded in
`docs/migration/sol-wave/cap-bots/native-state.md`). The generated fixture
JSON itself is untouched; the historical oracle stands. The pinned upstream
source and all historical transfer receipts (including
`worktree-bots-transfer.json`, whose `sourceCheckout` correctly names the
original Drogon-rewrite drafts) were not read as cwd and not modified.

## Commands and counts (all `--locked --offline`, `CARGO_BUILD_JOBS=2`, this worktree's own target)

| Command | Result |
|---|---|
| `cargo test -p drogon-core --locked --offline --test bot_automation_engine_startup` (before fix) | **6 passed, 1 FAILED** — genuine RED on the permission-refusal test |
| same, after fix | **7 passed, 0 failed** |
| `cargo test -p drogon-core --locked --offline --test bot_storage migrate_ownership` (before refactor) | **5 passed** — corrupt-payload rollback GREEN on unmodified code |
| `cargo test -p drogon-core --locked --offline --test bot_storage --test automation_records --test locale_ordering --test bot_automation_engine_startup --test bot_automation_startup_atomicity` (final) | 21 + 7 + 5 + 40 + 6 = **79 passed, 0 failed** |
| `cargo fmt -p drogon-core -- --check` | clean (one rustfmt pass applied to the new test code first) |
| `cargo clippy -p drogon-core --locked --offline --all-targets -- -D warnings` | exit 0 |
| `CARGO_BUILD_JOBS=2 cargo test --workspace --locked --offline --quiet` | exit 0; **357 passed, 0 failed, 0 ignored** across all test binaries |
| `git diff --check` | clean |
| Node24 fixture regeneration ×2 | sha256 `4560622c…` identical to committed fixture |

Delta vs pre-task baseline: `bot_automation_engine_startup` 5→7 (+2
permission tests), `bot_storage` 38→40 (+1 corrupt-payload regression,
+1 WAL-mode contention test), `locale_ordering` 5→6 (+1 canonical-equivalent
tie test). No existing test was weakened, skipped, or rewritten.

## Explicitly out of scope / not done

- No `ON CONFLICT` workaround added to the fresh-database `schema_versions`
  INSERT paths: no evidence of a reachable concurrent-standalone-`migrate`
  failure in production wiring (`Engine::open` serializes via
  `BEGIN IMMEDIATE`), so the review's NIT stands unaddressed by design.
- Future-version protection is untouched: `check_schema_not_ahead`
  semantics are unchanged; nothing in this task can downgrade a recorded
  future version.
- No RPC, scheduler, UI, SSH host-authority fence, host-default locale
  discovery, provider/session-authority, dependency, commit, or push work.
- Nothing outside this worktree; `session_authority` and all shared
  contracts untouched; HEAD remains `c09e5ef` with changes left uncommitted
  for root integration.
