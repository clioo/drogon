# E5 services leaf: O-CLOUD-STATE correction pass — assignment-store.ts complete public-operation grounding

**This supersedes the prior candidate's assignment-store.ts coverage.** The
prior pass left 57 of 62 public methods unread and was rejected on that
basis. This pass fully reads all 8463 lines of
`cloud/apps/relay/src/assignment-store.ts` — the entire class body
(`RelayAssignmentStore`, lines 410–7729) plus every module-level helper
before and after it (lines 1–409, 7731–8463) — in 20 sequential offset
reads with no gaps. The six other O-CLOUD-STATE files
(`relay-server.ts`, `database.ts`, `regional-rehome-worker.ts`,
`deploy-relay-gce-multi-target.mjs`, `power-staging-relay.mjs`,
`infra.mjs`) were already fully read in the prior pass and are unchanged
here — this correction is scoped to the one file that was incomplete.

- Task `task_dff08031efc7`, Dispatch `ctx_3145a003a849`, parent terminal
  `term_86e2b660-83d2-4440-811e-50467ae6fed8`, depth 2, no descendants.
- Source read-only: `/Users/carlos/Documents/Drogon-mentu-session` pinned
  `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. No tests, builds, installs,
  service starts, source-import execution, Git operations, credential
  values, or provider/deployment effects. No workflow/IAM/assets audits
  (out of scope, owned by another Astra).
- Owns only `docs/migration/audit-closure/e5-platform/services-leaf/
  cloud-state.md` and `.json` (both revised in place); the frozen
  `leaf/cloud-boundaries.md/.json` are untouched.
- File hash: `cloud/apps/relay/src/assignment-store.ts`
  sha256 `3318f12e4f0fae9810588644372045f094a5f79846b11873512ed7869dfcf6d3`,
  8463 lines. No recursive expansion into this file's external imports
  (`cell-admission-selector.ts`, `cell-admission-migration-registration.ts`,
  `assignment-connection-headroom-query.ts`, `assignment-identity-queue.ts`,
  `regional-rehome-safety.ts`, `registered-migration-abandonment.ts`,
  `config.ts`, `relay-observability.ts`) per the task's finite-single-file
  instruction — these remain named downstream/upstream boundaries.
- Root index stays 9/12 (75%). No claim of increase from this pass.

## What "complete" means here

The JSON companion (`cloud-state.json`, schema
`drogon.audit.e5-services-leaf-cloud-state/2`) contains one table row per
public method (all 62) plus the one exported free function
(`cellInventoryLockOptions`), each with five fields read directly off the
source: **owned state** (exact tables/columns touched), **auth/fencing**
(the concrete invariant that gates the mutation), **error taxonomy**
(every distinct thrown-error string observed in that method's body),
**transaction/race/retry** (lock mode, retry wrapper if any, and any
self-healing repair-then-retry behavior), and an **anchor** giving exact
line ranges for the public method and every private helper it exclusively
depends on. Shared low-level infrastructure used by many methods (lock
primitives, connection-headroom gates, fencing predicates, the
activity/reservation-lifecycle library, and ~40 pure module-level helper
functions) is listed once in `sharedPrivateInfrastructureNamedNotSeparatelyTabulated`
rather than repeated in every row that calls it — repeating it would have
inflated the table without adding information.

## Real assertion-body evidence (sampled, not exhaustive)

Per the task's instruction to read actual assertion bodies for
discriminating branches while preserving the full suite as unrun, this
pass opened and read in full:

- **`assignment-store.test.ts`** (4471 lines, ~95 `it`s) — 3 `it`s read in
  full: the receipt-relative drain-state lifecycle test (confirms the
  exact `retryAfter` arithmetic and the `drain_recovery_too_early` →
  ready-once → not-again transition), the dead-cell-fence-gated
  reassignment test (confirms `evacuateDeadCells` returns 0 until the full
  Terraform fence chain completes, then 1), and the fence-attestation
  binding test (confirms `bindCellFencePlanGeneration`'s write-once
  semantics, `startCellFenceApply`'s 9-field evidence match, and
  `attestCellFenceAttempt`'s indefinite-re-attestation-after-completion
  behavior). The remaining ~92 `it`s are named, unread, unrun.
- **`regional-rehome-store.test.ts`** (1781 lines, ~40 `it`s) — 2 `it`s
  read in full: the three-strikes-then-CAS-only-resume test (confirms
  `recordRegionalRehomeDispatchFailure` × 3 → control disabled + 5-minute
  pause → only `applyRegionalRehomeControl` with the correct
  `expectedGeneration` re-enables → retry claims the SAME `attemptId` with
  `sendAttempts` incremented, not a fresh attempt) and the
  redrain-after-grace-elapses test (confirms the exact redrain spacing,
  the `drainGraceMs:0` override on redrain, and that a fresh receipt
  replaces the prior one without a mismatch error). The remaining ~38
  `it`s, including the fleet-safety pool-pressure/reconnect-storm latch
  tests and all six contended-inventory-tick tests, are named, unread,
  unrun.
- **`assignment-store-lock-order.test.ts`** (486 lines) — 4 `it`s read in
  full, directly confirming the `assign`/`assignOnce` inventory-scope
  escalation mechanism: a brand-new assignment locks only
  general-admission inventory; a lock-retry on a brand-new assignment
  stays scoped to general; but if an assignment row *appears* mid-retry
  (a concurrent grant raced ahead), the retry restarts scoped to the full
  inventory (`AssignmentInventoryScopeChanged`), producing the exact lock
  sequence `['general', 'general', 'all']`. A fourth test confirms the
  assignment-first → single-cell-probe → full-inventory lock order for
  dead-cell reassignment. The remaining ~6 `it`s in this file are named,
  unread, unrun.

**Named discriminating tests not opened this pass** (postgres-suffixed
files require a real database and were not run by any leaf):
`control-renewal-postgres.test.ts` and `control-lease-recovery-postgres.test.ts`
(the dedicated suite for `renewPostgresControlActivity`'s CTE branch),
`assignment-connection-headroom{,-postgres}.test.ts`,
`assignment-control-supersession-postgres.test.ts`,
`assignment-deployment-status-postgres.test.ts`,
`assignment-identity-queue.test.ts`, `assignment-inventory-snapshot.test.ts`,
`assignment-rejection-log{-window,ging}.test.ts`,
`cell-admission-selector.test.ts`, `cell-admission-startup{,-postgres}.test.ts`,
`cell-fence-legacy-adoption-postgres.test.ts`, `postgres-drain-send-locking.test.ts`,
`public-assignment-{admission,circuit-breaker,overload,reconnect-lane}.test.ts`,
`regional-host-drain-app.test.ts`, `regional-rehome-postgres.test.ts`,
`regional-rehome-safety.test.ts`, `regional-rehome-target-selection.test.ts`,
`regional-rehome-worker.test.ts`, `staging-asia-proof-admission.test.ts`.

## The three most structurally significant findings from full-body reading

1. **`claimRegionalRehome` (5074–5811, 738 lines) is the single largest
   method in the file and the one most load-bearing gap from the prior
   pass.** It runs one candidate class at a time in strict priority order
   — retry, then redrain, then fresh candidates — all inside one
   transaction per tick, with fleet-safety re-checked against a fresh
   locked snapshot immediately before any actual claim (not just once at
   the top of the tick). It deliberately has **no lock-retry wrapper**:
   a contended tick is wholly abandoned (every untried candidate in that
   tick is lost) rather than retried, because "a Postgres transaction is
   unusable after a NOWAIT abort" (source comment, line 5095). Every other
   mutating method in the file that can hit `database_lock_unavailable`
   either retries via `withAssignmentLockRetry`/`assignWithLockRetry` or
   isolates the failure per-candidate in a sweep loop; this method is the
   one exception, by explicit design.
2. **Two self-healing repair-then-retry-once patterns exist, structured
   identically but independently implemented**: `beginCellDrainSend`
   catches exactly `migration_activity_accounting_mismatch`, runs a
   bounded (3-attempt) accounting-repair pass, then retries once more
   (a second failure propagates); `completeRegionalRehomeCandidate`
   (inside `completeReadyRegionalRehomes`) catches the same error class
   for a different domain, overwrites the assignment's activity counters
   from the locked lease rows, and re-asserts once. Neither reuses the
   other's repair logic, and `supersedeRegisteredCellEvacuations` has a
   third, differently-scoped variant (one reconciliation attempt per
   *whole sweep*, not per candidate, via a `reconciledAccounting` flag).
   Three independent implementations of "detect drift, repair once, don't
   retry a repair failure" is a pattern worth naming for a future
   consolidation, not treated as one shared mechanism.
3. **`renewControlActivity` forks into two dialect-specific
   implementations of the identical contract**: the Postgres path
   (`renewPostgresControlActivity`, 3333–3423) is a single five-CTE
   statement with `FOR UPDATE` row locks scoped to exactly the rows
   touched, chosen because this is the hottest write path in the file
   (fires on every control-ping interval for every live connection); the
   generic/SQLite path (`renewTransactionalControlActivity`, 3425–3492)
   does the same authorization-then-renewal decision as four sequential
   statements inside one `database.transaction()` call. This is the only
   place in the file using raw CTEs instead of the shared `queryLocked`
   helper, and the only concurrency-critical method that explicitly
   bypasses the per-identity `activityQueue` serialization used by every
   other activity-lease-mutating method ("a network-stalled activity call
   cannot suppress renewal" — source comment, line 3430).

## Source defects vs. intended corrections (kept explicitly separate)

Three observations from full-body reading, none of which are confirmed
behavioral defects — all are either deliberate design choices with
identifiable rationale, or code-shape inconsistencies worth flagging for a
future cleanup without asserting they are wrong:

- **SD1 (intended-correction-candidate, not a defect).**
  `claimRegionalRehome`'s three return points construct
  `RegionalRehomeAttempt` two different ways: the fresh-candidate path
  builds a typed object from scratch in `startRegionalRehomeCandidate`,
  while the retry and redrain paths mutate a raw SQL row in place and
  coerce it through `regionalRehomeAttempt()`. Functionally consistent
  (the DB write already happened), just a code-shape asymmetry.
- **SD2 (explicit source behavior, not a defect).** `assignOnce`'s
  forced-dead/stranded reassignment path does an unconditional
  `DELETE FROM relay_assignment_activity_leases WHERE user_id = ? AND
  relay_host_id = ?` with no `cell_id` guard, deleting *every* lease the
  identity holds, not just leases on the stale source cell. The source
  comment states this is intentional (those leases are "the loop's own
  unclaimed grant artifacts"), but the delete itself has no defensive
  scoping, so an upstream accounting bug that left a lease on an
  unexpected cell would be silently erased rather than surfaced.
- **SD3 (intended-correction-candidate, not a defect).** `changeActivity`
  is the one activity-lease-mutating write path in the file that relies
  entirely on `adjustCellReservationAtomically`'s single conditional
  `UPDATE ... RETURNING` for concurrency safety, rather than the explicit
  lock-then-write pattern used everywhere else (`acquireActivity`,
  `activateControl`, `assign`, evacuation methods). It also silently
  clamps a would-go-negative delta to zero rather than surfacing a
  capacity-exceeded error the way `assign`/`acquireActivity` do. Likely
  deliberate (a lighter-weight path for a counter that doesn't need
  cross-cell atomicity), but it is the one outlier from the file's
  otherwise-consistent locking convention.

## Remaining execution debt (separate from source characterization)

- Zero lines of this file have been executed by any leaf in this audit
  lineage. Every claim above is a source-reading claim, not a
  test-passing claim — this correction pass fixes *coverage breadth*,
  not *execution depth*.
- The Postgres-dialect branch and every `*-postgres.test.ts` file require
  a real PostgreSQL instance; none has been run.
- ~90 of ~95 `it`s in `assignment-store.test.ts` and ~38 of ~40 `it`s in
  `regional-rehome-store.test.ts` remain named-only, unread, unrun.
- The six external files this module imports and delegates to
  (admission selector, migration-cell registrar, connection-headroom
  query, identity queue, rehome-safety scoring, migration-abandonment
  timing) are named boundaries only — their own correctness is a
  downstream obligation outside this leaf's finite-single-file scope.
- No concurrency/load evidence was read beyond the four lock-order `it`s
  cited above; the broader claim (asserted only in source comments) that
  no lock-cycle is reachable across all 62 methods was not independently
  verified by execution.

See `cloud-state.json` for the complete 62-operation table with exact
anchors, the shared-infrastructure index, and the full
`remainingExecutionDebt` list.
