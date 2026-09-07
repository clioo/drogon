# V4 PR13 leaf L2 — `bot.run` admission assessment (2026-09-07)

Worktree: `codex-vertical-04-capabilities`, base HEAD `ecd828a`. Read-only
assessment; no `lib.rs`, `db.rs`, `bot_mutation_rpc.rs`,
`native_bot_create_engine.rs`, `crates/drogon-protocol/**`, manifest or CI
file was edited by this report. **Proposal only — nothing below is applied.**

## 0. Framing: module vs. product

`crates/drogon-core/src/bot_run_rpc.rs` (referred to below as the *bridge*)
is a compiled, unit-tested library module. It exposes seven free
functions/methods (`authorize_caller`, `parse_bot_run_request`,
`revalidate_run_scope`, `authorized_prepare`, `execute`, `record`,
`build_receipt`) and is exercised by
`crates/drogon-core/tests/native_bot_run.rs` (15 tests, confirmed 15/15 by
L1's baseline). **None of this is reachable from a real `bot.run` JSON-RPC
call today.** Three independent facts establish that:

1. `bot_run_rpc` is not declared as a module in `lib.rs` (no `mod
   bot_run_rpc;` line exists) — confirmed by L1's reconciliation (item (c))
   and re-confirmed here (`grep -n "mod bot_run_rpc" crates/drogon-core/src/lib.rs`
   returns nothing).
2. `dispatch_inner`'s method match (`lib.rs:318-...`) has no `"bot.run" =>`
   arm — the only registered bot method is `"bot.create" =>
   self.bot_create(request)` (`lib.rs:324`).
3. Even the test file itself documents this as a **provisional binding
   seam**: it compiles the bridge via `#[path = "../src/bot_run_rpc.rs"]
   mod bot_run_rpc;` inside the integration-test crate and reimplements
   `run_staged`'s admission *sequencing* in a local `ScopeLedgerDouble` (see
   its own doc comment, `native_bot_run.rs:9-20`) — an explicit
   acknowledgment that the real `RequestLedger::run_staged` composition is
   not wired, so the test cannot use it directly.

So: "bot.run has 15 passing tests" is true of the *staged-primitives
module*, and is a category error if read as "the Bots `bot.run` journey is
executable in the product." No `Engine::bot_run` method exists, no dispatch
arm exists, and no user- or scheduler-triggered path reaches
`bot_run_rpc::authorized_prepare`/`execute`/`record` outside this test's own
hand-rolled double. This report treats that distinction as load-bearing
throughout.

## 1. Minimal safe canonical admission — ROOT-owned hunks (NOT applied)

`RequestLedger::run_staged` (`crates/drogon-core/src/requests_staged.rs:21`)
is the already-admitted staged primitive — it is not a new API; two
production call sites already use it today
(`coordination_worker_control.rs:64,123`, `coordination_launch.rs:47`), so
no ledger/fingerprint API addition is needed, matching the module's own A6d
constraint. `run_staged`'s callback shape is:

```rust
pub(crate) fn run_staged<P>(
    &self, db: &Mutex<Connection>, key: &str, method: &str, params: &Value,
    authorize: impl FnOnce(&Transaction<'_>) -> Result<(), RpcError>,
    prepare: impl FnOnce(&Transaction<'_>) -> Result<P, RpcError>,
    effect: impl FnOnce(P) -> ReceiptOutcome,          // ReceiptOutcome = Result<Value, RpcError>
    finalize: impl FnOnce(&Transaction<'_>, &ReceiptOutcome) -> Result<(), RpcError>,
) -> ReceiptOutcome
```

`Transaction` derefs to `Connection`, so `revalidate_run_scope(conn, ...)`
and `authorized_prepare(conn, ...)` (both take `&Connection`) slot into
`authorize`/`prepare` without signature changes.

### 1a. A genuine wiring problem, not just a registration gap

`bot_run_rpc::record` needs a `&Connection` and the concrete `RunPlan` +
`RunnerOutcome` values (`record_run_outcome_in_tx(conn, plan, outcome,
observed_at)`), and its own doc comment says it is "meant to run inside
`run_staged`'s own `finalize` transaction". But `run_staged`'s `finalize`
callback only receives `&ReceiptOutcome` — the *already-built* `Result<Value,
RpcError>` receipt — not the `RunPlan`/`RunnerOutcome` that produced it, and
`effect` (which does have those) runs with **no** `Connection` in scope by
`run_staged`'s own contract ("`effect` runs with neither ledger nor database
mutex held"). `record()` therefore cannot be called from inside `effect`
either. This is a real shape mismatch between the bridge's stated design and
`run_staged`'s generic contract, not a cosmetic gap.

The established precedent for this exact shape (`coordination_launch.rs:47`)
resolves it by having `effect` return a Value that `finalize` re-decodes
(`decode(value)?` at `coordination_launch.rs:66`) to recover typed data for
transaction-scoped bookkeeping. That pattern is insufficient here because
`RunPlan`/`RunnerOutcome` are not (and should not become) JSON-round-trippable
domain types for this purpose. The minimal safe alternative — no ledger API
change, no new field on any admitted type — is a **closure-captured
side-channel** local to `Engine::bot_run`'s own call to `run_staged`: a
`Cell<Option<(RunPlan, RunnerOutcome, f64)>>` declared in the method body,
written by `effect` (the only closure that computes those values), read by
`finalize` (which needs them to call `record`). Both closures already
capture `&self` and `&request` by reference in every existing `run_staged`
call site, so capturing one more local by reference is consistent with the
existing style, not a new mechanism.

### 1b. Exact hunks (file paths + precise diffs), not applied

**`crates/drogon-core/src/lib.rs`** — module declaration, alongside the
existing `mod bot_mutation_rpc;` (line 7):

```diff
 mod bot_mutation_rpc;
+mod bot_run_rpc;
 mod bot_snapshot_rpc;
```

**`crates/drogon-core/src/lib.rs`** — dispatcher registration, in
`dispatch_inner`'s match, immediately after the existing `"bot.create"` arm
(line 324). `bot.run` is desktop-only (the bridge's own `authorize_caller`
denies `BotRunCaller::Worker`), so it belongs in the **trusted `dispatch()`
path** (`dispatch_inner`), never in `dispatch_worker`'s explicit allow-list
(see §2d for why this placement itself is part of the security boundary):

```diff
             "bot.create" => self.bot_create(request),
+            "bot.run" => self.bot_run(request),
             "files.list" => self.do_files_list(&request.params),
```

**New file `crates/drogon-core/src/bot_run_engine.rs`** (or an `impl Engine`
block appended to `bot_run_rpc.rs` once it is a declared module — ROOT's
choice; sketched here as a separate adapter file to keep the bridge itself
free of `Engine`/dispatcher coupling, mirroring how `bot_mutation_rpc.rs`
keeps its own `impl Engine` block at the bottom of the same file rather than
a separate one — so the more consistent placement is actually appending this
`impl Engine` block to the end of `bot_run_rpc.rs`, matching
`bot_mutation_rpc.rs`'s own pattern exactly):

```rust
impl crate::Engine {
    pub(crate) fn bot_run(&self, request: &drogon_protocol::Request) -> Result<Value, RpcError> {
        let _gate = self.lifecycle_gate.read().unwrap();
        let caller = BotRunCaller::Desktop; // dispatch_inner is desktop-only by construction
        authorize_caller(&caller)?;
        let parsed = parse_bot_run_request(&request.params)?;
        let derived_host_id = self.host_id.clone();
        let seam = crate::automations::runner::EngineDispatchSeam::new(self);
        let outcome_slot: std::cell::Cell<Option<(RunPlan, RunnerOutcome, f64)>> =
            std::cell::Cell::new(None);
        self.ledger.run_staged(
            &self.db,
            &request.request_id,
            &request.method,
            &request.params,
            |tx| {
                if self.quiescent.load(std::sync::atomic::Ordering::Acquire) {
                    return Err(crate::error::runtime_busy(
                        "service admission is frozen for shutdown",
                    ));
                }
                revalidate_run_scope(tx, &derived_host_id, &parsed)
            },
            |tx| {
                let attempt_at = crate::now_unix_ms() as f64;
                authorized_prepare(tx, &derived_host_id, &parsed, attempt_at)
            },
            |prepared| match prepared {
                BotRunPrepare::Refused { workspace_id, refusal, error } => Ok(build_receipt(
                    &request.request_id, &derived_host_id, &workspace_id, "refused",
                    refusal, Value::Null, None, None, None,
                    Value::String(error), None, /* recorded_at */ 0.0, // see note below
                )),
                BotRunPrepare::Unsupported { workspace_id, reason, error } => Ok(build_receipt(
                    /* analogous */
                )),
                BotRunPrepare::Ready { plan, workspace_id } => {
                    let outcome = execute(&plan, &seam);
                    let observed_at = crate::now_unix_ms() as f64;
                    outcome_slot.set(Some((plan.clone(), outcome.clone(), observed_at)));
                    Ok(build_receipt(/* built from plan/outcome, as in native_bot_run.rs's ScopeLedgerDouble::call */))
                }
            },
            |tx, _result| {
                if let Some((plan, outcome, observed_at)) = outcome_slot.take() {
                    record(tx, &plan, &outcome, observed_at)?;
                }
                Ok(())
            },
        )
    }
}
```

This sketch has one open design defect ROOT must resolve, not paper over:
`recorded_at` (used both for the receipt's `recordedAt` field and as
`RunPlan::attempt_at`) must be sampled **once**, at admission, and the exact
same value must reach both `prepare` (to build the plan) and `effect`/the
final receipt (to render `recordedAt`) — but `prepare` and `effect` in
`run_staged` do not share a return channel for a bare timestamp the way
`BotRunPrepare::Ready` carries `plan.attempt_at` forward already. The
straightforward fix is to read `plan.attempt_at` back out inside `effect`
for the `Ready` arm (it is already on the plan), and to have the
`Refused`/`Unsupported` arms of `prepare` also stash their own `attempt_at`
sample into a `Cell` written in `prepare` and read in `effect` — a second,
smaller instance of the same closure-capture technique as §1a. This is
exactly the kind of one-clock-sample-must-flow-through-every-branch
correctness property `native_bot_run.rs` pins with `ScriptedClock` (e.g.
`double_click_replay_returns_the_ledger_stored_receipt_with_a_single_session`,
asserting `recordedAt` is the FIRST clock sample and `observedAt` a
strictly LATER one) — so the adapter design is not free-form; it must
preserve exactly that ordering, and doing so honestly requires the two-`Cell`
approach above rather than inventing a new timestamp inside `effect`.

**Registration is therefore not a one-line dispatcher edit.** It requires:
(i) the `mod` declaration, (ii) the dispatch arm, (iii) a new `impl Engine`
adapter that resolves the effect/finalize data-flow gap in §1a, and (iv) the
attempt-clock threading fix just described. All four are ROOT-owned; none
is applied here.

## 2. Native request-boundary regression plan

A minimal admitted regression suite for the real dispatcher path — as
opposed to the bridge's own already-good unit coverage — needs to prove
properties that only exist once `Engine::bot_run` is real, i.e. they cannot
be ported from `native_bot_run.rs` as-is (see §3):

- **Authorize-before-replay, at the real dispatcher.** `revalidate_run_scope`
  must run before the stored-row lookup for a genuine `Engine::bot_run` call
  (not just inside `ScopeLedgerDouble`, which is a hand-written reimplementation
  of that sequencing). Test: seed a workspace, admit one `bot.run` via
  `engine.dispatch(...)`, move the workspace to a different host, call
  `engine.dispatch(...)` again with the same `request_id` — assert
  `unauthorized`, assert no second `harness.start`/session row, and assert the
  originally stored receipt row is untouched byte-for-byte in the `requests`
  table. This exercises `run_staged`'s real authorize-before-lookup ordering
  (`requests_staged.rs:40-41`), which `ScopeLedgerDouble` merely asserts by
  construction rather than by exercising the production code path.
- **Effect runs outside the DB lock, for real.** Repeat
  `no_lock_is_held_on_the_database_during_execute`'s shape, but through
  `engine.dispatch(...)` with the production `EngineDispatchSeam` (not the
  test's `DuringDispatchSeam`): from inside a hooked `harness.start`
  (achievable only by first proving `EngineDispatchSeam::harness_start`
  re-enters `Engine::dispatch("harness.start", ...)`, which itself takes
  `self.lifecycle_gate.read()` — a **second** reader — so this test also
  proves `lifecycle_gate` is a genuine multi-reader lock and `bot.run`'s
  admission does not statically deadlock against its own nested dispatch).
  This is a materially different property from the bridge's unit test, which
  never calls through a second `Engine::dispatch`.
- **Atomic finalize.** Force a `finalize` failure (e.g. a poisoned/rolled-back
  second transaction) and assert the `requests` row stays `pending` (never a
  half-committed `done` with a missing `automation_runs`/
  `bot_responsibility_runs` pair) — i.e. `record`'s atomicity guarantee,
  already unit-proven in isolation by
  `callers_own_transaction_rollback_leaves_both_history_rows_absent`, must be
  re-proven with `run_staged`'s *own* `finalize` transaction (`staged_finish`,
  `requests_staged.rs:112`), since that is a different transaction object
  than the one the bridge's unit test constructs by hand.
- **No false live verdict.** `CountingSeam`/production `EngineDispatchSeam`
  path: a `session.read` that returns `verdict: "unverifiable"` (lost
  contact) must never be rendered as `"live"` or treated as proof of a
  physical exit in the receipt's `session` object — this is the AGENTS.md
  `live`/`unverifiable`/`exited` contract, and today it is enforced only by
  `SessionObservation.verdict` being carried through verbatim (`build_receipt`
  never maps/coerces it). A regression test should assert the receipt's
  `session.verdict` string is exactly whatever `EngineDispatchSeam::session_read`
  observed, with no synthesized upgrade to `"live"` on a timeout/error path
  (`RunnerOutcome::ObservationFailed` keeps the session ids but reports the
  error, never a verdict of `"live"` — assert this explicitly once real
  wiring exists).

## 3. Which `native_bot_run.rs` assertions rebase today vs. need registration

**Rebase onto the canonical public `Engine` path today, no registration
needed** — these call `bot_run_rpc::{parse_bot_run_request,
authorize_caller, authorized_prepare, revalidate_run_scope, execute,
record}` directly against a real `Engine::open` fixture already, and would
be unchanged by registration (they test the bridge's own pure/DB-scoped
functions, which are public within the crate regardless of dispatcher
wiring):

- `strict_schema_rejects_unknown_fields_missing_fields_and_non_admitted_harness`
- `requests_normalize_to_the_same_parsed_value_regardless_of_wire_key_order`
- `asserted_host_mismatch_is_refused_as_structured_foreign_workspace_host`
- `workspace_owned_by_another_host_is_refused_even_when_the_assertion_matches`
- `unknown_workspace_is_refused_as_a_structured_receipt`
- `owned_plan_outlives_the_connection_scope_that_prepared_it`
- `no_lock_is_held_on_the_database_during_execute` (the type-level/empirical
  proof about `execute` taking no `Connection` stands regardless of
  dispatcher wiring — only the *stronger* dispatcher-level version in §2
  needs registration)
- `callers_own_transaction_rollback_leaves_both_history_rows_absent`

**Require registration (i.e. currently only provable against
`ScopeLedgerDouble`, a hand-rolled stand-in for `run_staged`, not against the
real ledger)** — these assert properties of the *admission sequencing*
itself (replay/conflict/fresh-vs-cached), which is exactly the part
`ScopeLedgerDouble` reimplements rather than exercises:

- `worker_callers_are_denied_before_parsing_and_consume_no_admission` — the
  "consumes no admission" half is proven against `ScopeLedgerDouble.admits()`,
  a fake bookkeeping list, not the real `in_flight`/`requests` table; also see
  §1b/§2's placement note — the real worker-boundary denial for an
  unregistered-in-`dispatch_worker` method is `method_not_found` from
  `dispatch_worker`'s own fallthrough (`lib.rs:311-313`), not
  `bot_run_rpc::authorize_caller`'s `unauthorized`. **This is a discrepancy
  ROOT must resolve, not silently paper over**: as sketched in §1b (dispatch
  registered only in `dispatch_inner`), `authorize_caller`'s `BotRunCaller::Worker`
  branch becomes dead code in production — no real request can ever construct
  that variant, since `dispatch_authenticated` never calls into
  `dispatch_inner`. If ROOT wants `authorize_caller`'s worker path to be a
  real, exercised boundary (e.g. for future worker-triggered `bot.run`), it
  must also add `"bot.run"` to `dispatch_worker`'s explicit match and map the
  resulting `WorkerBinding` onto `BotRunCaller::Worker` — a second, distinct
  registration decision this report does not make.
- `same_envelope_request_id_with_changed_params_is_a_conflicting_params_reject`
  — the conflict path is `run_staged`'s own `fingerprint(method, params)`
  mismatch logic (`requests_staged.rs:41-46`), unexercised by the bridge in
  isolation.
- `double_click_replay_returns_the_ledger_stored_receipt_with_a_single_session`
  — replay-returns-stored-receipt-verbatim is the single most important
  property `run_staged` provides and `ScopeLedgerDouble` cannot itself prove
  about the real ledger; also depends on the §1b clock-threading fix being
  correct (recordedAt must match across the stored and replayed receipt).
- `the_bridge_creates_no_tables_and_persists_nothing_itself` — trivially true
  of the bridge alone, but the *complete* claim ("bot.run persistence is
  exactly the delegated ledger's `requests` row plus `record`'s two rows, no
  more, no less") is only checkable once a real `finalize` transaction runs.
- `absent_harness_is_unsupported_without_dispatch_or_defaults` — passes
  against `ScopeLedgerDouble` already, but should be re-run against
  `engine.dispatch(...)` once registered, since the `Unsupported` receipt
  path is exactly the one whose `attempt_at`/`recordedAt` threading (§1b) is
  least tested today (`ScopeLedgerDouble.call` builds the `Unsupported`
  receipt inline with the same `recorded_at` variable already in scope — the
  real adapter has to reconstruct that carefully, per §1b).
- `replay_authorize_denies_when_workspace_scope_changes_since_admission` and
  `replay_returns_stored_receipt_verbatim_after_readiness_is_later_revoked`
  — both are direct tests of `run_staged`'s authorize-every-time /
  prepare-fresh-only contract, which `ScopeLedgerDouble` reimplements by
  hand rather than delegates to; §2's regression plan restates these against
  the real ledger.

No claim above should be read as "the Bots journey is closed once these are
registered" — E5 recording/consent, reactive dispatch wiring, and the
harness-mapping-absent gap (`bot_run_rpc.rs`'s own `harnessMappingAbsent`,
explicitly flagged for ROOT approval) all remain open regardless of this
registration, and are unchanged by anything in this report.
