# Core quiescence admission: P1 closure evidence

Scope-bounded worker report, 2026-09-06. Task `task_ebdce9b0affb`, Dispatch
`ctx_76fbbbccc261`, worktree `codex-service-quiescence`, base main `f12eecb`
(uncommitted, per the current no-Git-writes policy). Owner of record for this
report: drogon-core quiescence admission files only. Drogond/server work is a
peer's disjoint assignment and was not touched.

## Files changed

- `crates/drogon-core/src/lib.rs` — `do_runtime_shutdown` admission-guard
  span (the P1 fix), `mutating` read-gate span, `Engine::pre_freeze_hook`
  cfg(test) seam field, truthful gate-scope documentation.
- `crates/drogon-core/src/service_quiescence.rs` — `try_admit` split: gate
  acquisition moved to `do_runtime_shutdown`; module now owns the wire fences
  and the all-exited check (`check_all_sessions_exited`), plus the new
  `#[cfg(test)] admission_window_tests` module.
- `crates/drogon-core/src/error.rs` — unchanged this pass (the two additive
  constructors `unsupported_host` / `runtime_busy` from the preserved draft
  remain as reviewed).
- `crates/drogon-core/tests/service_quiescence.rs` — 11 existing tests
  preserved (one strengthened); 4 added.

## P1: admission is now atomic through durable freeze

Before: `try_admit` dropped the exclusive `lifecycle_gate` guard on return,
before `RequestLedger::run` persisted the receipt and before `quiescent` was
stored. Any mutation could acquire the shared side in that window and admit
work the shutdown had already (durably!) passed.

After: `do_runtime_shutdown` try-acquires the write gate inside the ledger
work closure — after ledger admission, so a concurrent duplicate requestId
still waits on this one receipt instead of refusing — and retains it in an
outer `Option<RwLockWriteGuard>` across the ledger's durable receipt persist
and the `quiescent` store. The store happens only on `result.is_ok()`, which
the ledger produces only after the accepted receipt is durably on disk; a
failed receipt write surfaces as `unverifiable` and never stores the flag.
The guard is dropped explicitly after the store on success. If persistence
fails after admission, the held guard is released without setting the flag;
an admission refusal leaves no retained guard.

### Lock-order and deadlock audit (verified, suggestion not adopted blindly)

- Uniform order everywhere: lifecycle gate first, then the short-lived DB
  mutex. The DB mutex is never held while acquiring the gate; no code path
  takes the gate while holding the DB mutex's guard.
- The write side is only ever `try_write()` — nobody ever waits on it — so a
  reader can never queue behind a pending writer, and a shutdown never blocks
  behind in-flight I/O (it refuses `runtime_busy`).
- Mutators now hold the shared side across the whole ledger interaction
  (admission → work → receipt completion), per root direction. A duplicate
  same-requestId waiter therefore holds the shared side while waiting on the
  ledger slot; readers coexist, so this cannot deadlock, and it correctly
  keeps a concurrent shutdown's try-write refusing for the whole episode.
- No `work` closure re-enters `mutating` or takes the gate recursively.

### Actual read-gate scope (attempt-review finding 3)

`Engine::mutating` holds the shared side from before its ledger admission
until after its durable receipt completion — not "only for a check" as the
old comment claimed, and not just across `work()` either. Read-only methods
(`status`, `session.read`, `session.list`, `workspace.list`, `harness.list`)
never touch the gate; shared holders never block each other. Normal unrelated
I/O is therefore not serialized, and no recursive path exists. Comments in
`lib.rs` now state this scope truthfully.

## Tests-first evidence (chronological, not relabeled)

1. RED first: the `cfg(test)` seam was added as pure instrumentation
   (dead in non-test builds), then
   `service_quiescence::admission_window_tests::a_mutation_cannot_complete_between_durable_admission_and_freeze`
   was run against the unfixed engine and failed with exactly:
   `P1: a mutation completed after the durable admission receipt but before
   the freeze store took effect`. The seam fires between the ledger's
   durable persist and the flag store and releases a real
   `workspace.register` through the public dispatch path, so the failure is
   deterministic — no timing race, no missing-symbol compile substitute, and
   a strictly stronger observation than the try_admit-return window (the
   receipt was already durable when the mutation ran).
2. Coverage tests added against the unfixed engine (they pin existing
   correct behavior and must survive the fix): all passed before the fix and
   after.
3. Fix implemented; full scoped suite re-run green.
4. Root follow-ups applied, each re-verified: the seam became
   instance-scoped (`Engine::pre_freeze_hook`, no process-global race);
   the mutator gate span was widened to cover receipt completion; and the
   window assertion was made load-independent (below). After the
   determinism rework, the regression was re-proven RED against the
   original bug shape by temporarily restoring guard-inside-work in the
   owned file — it failed deterministically with
   `P1: between the durable admission receipt and the freeze store the
   shared lifecycle side was still acquirable…` — then the fix was restored
   and everything re-run green.

### Load-independence of the P1 regression

The load-bearing assertion is recorded synchronously inside the window, on
the shutdown thread itself: the hook calls `try_read()` on the lifecycle
gate at the post-persist/pre-store instant and the test asserts it observed
`Some(false)` (shared side not acquirable while the exclusive admission is
held). That is a structural fact, not a timing observation. The mutator's
own assertions (`runtime_busy` outcome, zero registered workspaces) are
checked after a plain `join()`, so they are outcome/order-based. Only the
handshake waits carry timeouts (30s), and only so a broken handshake fails
with a clear message instead of hanging. The fast-refusal test likewise
dropped its elapsed-time bound: if shutdown ever blocked on the gate, the
test would deadlock on its own held guard — a load-independent failure the
harness reports.

### Test inventory

Preserved integration tests (11): all prior tests in
`tests/service_quiescence.rs` keep their assertions.
`a_replacement_instance_rejects_an_old_instances_receipt` was strengthened to
create a real durably accepted shutdown receipt in the old instance (the old
version fabricated no receipt — review finding 4), to assert the old
requestId cannot be recycled under new fences (`request_conflict`), and that
the replacement can still shut down under a fresh id.

Added integration tests (4):

- `a_failed_receipt_write_never_authorizes_exit` — SQLite `RAISE(ABORT)`
  trigger on `UPDATE requests`: admission INSERT succeeds, durable finish
  fails → `unverifiable`, `is_quiescent()` stays false, same-requestId retry
  neither re-runs nor authorizes.
- `concurrent_duplicate_shutdown_requests_produce_one_effect_and_the_same_outcome`
  — 4 barrier-synchronized racers on one requestId: identical accepted
  results, exactly one durable `done` receipt row.
- `a_request_id_already_used_by_another_method_conflicts_and_never_admits` —
  cross-method requestId reuse is `request_conflict` and never admits.
- `read_only_methods_still_work_after_freeze` — status/list/not_found all
  live after `accepted:true`; the freeze fences admission, not liveness.

Added in-crate tests (2, `#[cfg(test)]`, private seams only — no production
test-only public API):

- the P1 pre-freeze interleave regression described above;
- `shutdown_refuses_fast_while_a_mutation_holds_the_gate_and_normal_io_still_runs`
  — with the shared gate held mid-mutation, shutdown returns `runtime_busy`
  without waiting (`try_write`, never queued), and unrelated
  read-only I/O still runs.

Seam notes (per root's mid-run directives): the seam is instance-scoped —
an `Engine::pre_freeze_hook` field under `cfg(test)` receiving `&Engine`
(initialized `None` in `Engine::open`), not a process global, so parallel
unit tests can never consume each other's hook — and the mutator gate span
now covers admission, work, and receipt completion per root direction. The
seam is invisible to other crates and absent from production builds.

## Commands and scoped results

`CARGO_BUILD_JOBS=2 cargo test --locked --offline -p drogon-core` (and
`--lib` / `--test service_quiescence` filters, 5 repeat runs for the
concurrency suites): 245 passed, 0 failed, 1 ignored — the ignored marker is
pre-existing and unrelated. `rustfmt --edition 2024` on exactly the four
owned files (no workspace-wide formatter run). `cargo clippy --locked
--offline -p drogon-core --all-targets`: clean.

These are drogon-core-scoped counts as required. They are not the combined
workspace count; drogond integration and the final combined test gate remain
root's.

## Root follow-up after worker settlement

Root shortened the production admission comments, drops the private hook mutex
before invoking its callback, and replaced the racing-start test's one-second
child with a child waiting for explicit input. The latter prevents machine load
from turning a legitimate natural exit into a false shutdown-regression failure.
Root independently reran the 15 integration cases and two in-crate admission
cases, then the complete `cargo test --locked --offline -p drogon-core` suite:
all passed after these edits (one pre-existing probe entry remains ignored at
top level and is invoked by its owning test). These results overlap the worker
suite; they are not additional unique coverage. The combined workspace and
real service-exit gates still remain open.

## Explicitly out of scope / remaining

- Drogond: capability consumers, listener wake/stop after response, bounded
  connection disposal, observed process exit (peer + root).
- Root's kernel process-watch acceptance step before replacing packaged
  cleanup.
- The P2 admission-vs-server ordering cannot be closed from core alone; the
  freeze flag is now honest, but "capability advertised before the server can
  shut down" still stands until the server work lands.
