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
