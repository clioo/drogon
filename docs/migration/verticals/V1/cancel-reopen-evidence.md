# V1 historic-cancel/reopen evidence

Vertical: V1 runtime-cli. Task: `task_a313f1601862` (dispatch
`ctx_097385883e6d`). Companion suite:
`crates/drogon-core/tests/native_attempt_cancel_reopen.rs` (self-contained;
public engine seams only — `Engine::open` + `with_worker_cli` + `dispatch` /
`dispatch_authenticated` against real SQLite and real PTYs).

- Fixture pattern reused from `tests/native_worker_lifecycle/`: each parent
  test re-executes the test binary as an isolated subprocess with a fake
  installed `claude` harness on `PATH`; cleanup stays cooperative (stop
  marker, bounded self-expiry, read-only `kill -0` liveness, no discovered-PID
  signaling).
- Storage-seam faults follow `probes_faults.rs`: a narrowly scoped SQLite
  trigger (`WHEN NEW.retry_of IS NOT NULL` on `orchestration_attempts`)
  aborts exactly the replacement-attempt INSERT, which sits before the
  task-status write and the child spawn inside the admission transaction
  (`coordination_launch.rs`: credential → `attempts::admit` →
  `tasks::set_status_in_tx` → spawn), so the forced rollback is clean.
- Domain anchors: unit tests `stop_cannot_overwrite_a_final_report`,
  `rolled_back_replacement_restores_prior_authority_and_history`
  (`src/coordination_attempts_tests.rs`).

## Result

`cargo test -p drogon-core --test native_attempt_cancel_reopen --locked`:
**GREEN 5 / RED 0** (4 behavioral parent tests + the inert probe entry),
stable across three consecutive runs. No REDs: every requested behavior is
implemented by the candidate; no assertion was weakened.

## Behavior → test mapping

| Behavior | Test (probe) | Evidence asserted |
| --- | --- | --- |
| Cancel of a historic (settled) attempt is refused without mutating state | `settled_cancel_refused` | Worker settles via authenticated `finalReport` (lifecycle `succeeded`, task → `completed`, attempt → `completed`/`workerObserved`). New-request `workerStop` AND `workerAbandon` both refuse with `attempt_settled`. The `orchestration_attempts` row (is_current, fenced, state_json bytes), the attempts table size, the task status and the full `workerShow` projection are byte-identical after both refusals. The request ledger records exactly one failure receipt per refused call and leaves neither `pending`. |
| Concurrent cancels serialize; exactly one winner | `concurrent_cancel_single_winner` | Two threads issue `workerStop` with distinct request ids against one live worker. Both responses are ok with `assignmentState: stopped` (idempotent fence), but exactly one carries `processAction: signalled`; the loser reports `none`. The task transitions to `blocked`, the child exits (observed, not assumed), attempts stay at 1 row, and no process is launched or respawned. |
| Rollback of a failed attempt restores pre-attempt state | `failed_retry_rollback_restores_state` | With the retry-of trigger aborting the replacement INSERT, `workerStart retryOf=A` fails and rolls back: attempt A keeps its exact pre-retry row (current + unfenced authority restored), no replacement row, no new session or credential rows, the task keeps `blocked`, no child spawns, and A remains inspectable via `workerShow`. |
| Reopen of a rolled-back attempt yields a new attempt id with prior history preserved | `reopen_after_rollback_preserves_history` | After the rolled-back retry, dropping the fault and retrying the same `retryOf=A` admits a NEW attempt (distinct dispatch id, distinct session), the task is `dispatched` again, history shows exactly two rows — A still fenced with its stored `state_json` byte-identical to before the reopen, and the replacement current/unfenced carrying `retry_of = A` — and both attempts stay inspectable (`stopped` historic, `ready` replacement owning its live child). |

## Notes and scope boundaries

- The engine's request ledger intentionally records refused lifecycle calls
  as durable failure receipts; that is an append-only audit record, not a
  mutation of attempt/task state, so the ledger assertions pin the exact
  delta (+1 per refusal, none pending) instead of zero growth.
- All four behaviors required no RED: the candidate implementation already
  satisfies the contract at the behavioral level. The in-src unit tests
  cover the same semantics at the transaction level; this suite adds the
  end-to-end/public-seam (RPC + real storage + real process) layer.
- Nothing outside the two exclusive files was created or modified; no Git
  operations were performed.

---

## Fixture Fixes (task_fe2272e9d9c6): ROOT fixture review — liveness + cleanup honesty

Scope: `tests/native_worker_lifecycle/harness.rs` (shared V1 fixture),
`tests/native_attempt_cancel_reopen.rs`, this section. No production files,
no other test files touched.

### Correction verdicts

1. **Three-valued liveness observer replaces the buggy bool — DONE.**
   `harness.rs` now owns ONE narrow observer:
   `observe_liveness(pid) -> Liveness` (`Live`/`Exited`/`Unverifiable`),
   backed by the pure `classify_kill_output(success, stderr)` mapping where
   ONLY a proven ESRCH ("No such process" from `kill -0`) counts as
   `Exited`; permission errors (e.g. EPERM), usage errors and kill-spawn
   failures are `Unverifiable`. The observer is strictly read-only
   (signal 0, never anything else) and is shared by both V1 test scopes:
   the cancel/reopen suite now includes the harness by path
   (`#[path = "native_worker_lifecycle/harness.rs"]`) instead of carrying a
   copied fixture, so no second (buggy) bool exists anywhere. The legacy
   `liveness_probe(pid) -> bool` remains ONLY as a proven-live wrapper for
   the read-only probe assertions in the lifecycle suite (whose files are
   outside this task's edit scope), with documentation warning that cleanup
   must never consume the bool.
   **Cleanup semantics fixed accordingly**: `Fixture::try_cleanup_within`
   removes the fixture tree only when every recorded child has PROVEN its
   exit (ESRCH) or none was recorded; a provably-live or unverifiable child
   keeps the tree on disk and yields a typed `Err(reason)`. `cleanup()` now
   panics WITH the preservation notice (including the reason and the
   preserved path) instead of silently claiming success. The old bug —
   `!liveness_probe(pid)` treating permission/spawn failures as exit and
   deleting fixtures over a possibly-live child — is gone.
   **Controlled error-path tests added** (in the cancel/reopen suite):
   `liveness_observer_counts_only_proven_esrch_as_exit` (pure mapping:
   success→Live, ESRCH→Exited, EPERM/usage/empty-stderr→Unverifiable, plus
   one real live-process observation) and
   `cleanup_preserves_fixtures_while_a_child_is_live_and_cleans_after_proven_exit`
   (an owned blocking child: bounded cleanup refuses with
   "provably live" and PRESERVES the fixture dir; after the child proves its
   exit the same cleanup removes it — with a drop-guard releasing the child
   even on assertion failure).
2. **Timeout ordering fixed — DONE.** `Fixture::run_using` (new; `run` kept
   as the lifecycle-suite wrapper for compatibility with its read-only
   callers) now, on the 120s bound: publishes the cooperative stop-marker
   FIRST, then gives the probe child and fixture children a bounded (5s)
   window to self-exit, only then kills the EXACT retained child handle
   (never a broad PID kill), and finally runs the same provable-exit-only
   cleanup — so an unverifiable outcome preserves fixtures (cleanup panics
   with the preservation notice) instead of deleting them. Guarantee
   mechanism documented on `StopMarkerGuard` and in the timeout path: the
   child-side guard's Drop cannot run once the child is killed, so the
   PARENT's own marker publish is what holds the guarantee in that case;
   the guard remains the normal-unwind path.

### Suites run (all green)

- `cargo test -p drogon-core --test native_attempt_cancel_reopen --locked`:
  **7 passed / 0 failed** (4 behavioral probes + probe entry + 2 new
  fixture error-path tests), re-run twice, stable.
- `cargo test -p drogon-core --locked --test native_worker_lifecycle
  --test native_receipt_recovery --test orchestration_worker_boundary
  --test engine`: native_worker_lifecycle **9 passed / 0 failed**,
  native_receipt_recovery **6 passed / 0 failed**,
  orchestration_worker_boundary **2 passed / 0 failed**, engine
  **18 passed / 0 failed (1 ignored, pre-existing)** — every pre-existing
  consumer of the shared harness stays green with the corrected fixture.
- `cargo clippy -p drogon-core --all-targets --locked -- -D warnings`:
  clean (exit 0).
- `cargo fmt -p drogon-core -- --check`: clean (exit 0).

### Notes

- One intermediate bug in my own cleanup restructure (the all-children-
  exited case never reached the removal branch and timed out with a stale
  reason) was caught by this suite's very first run and fixed before
  delivery; final state is as described above.
- The EPERM→Unverifiable mapping is covered at the pure-classifier level
  (`classify_kill_output`) rather than by asserting on a real root-owned
  process, so the test does not depend on the runner's uid.
- What remains: nothing for this checkpoint; both corrections are landed
  and every consuming suite is green.
