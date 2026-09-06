# E5 final-source-gate leaf: D-CLOUD-COLLAB six-file closure candidate

Candidate leaf audit, **not** root acceptance. Parent independently reviews
this evidence. This leaf never expanded audit percentage and never ran,
built, deployed, installed, or executed anything.

- Task `task_45110ec5a842`, Dispatch `ctx_b8b7e5673b90`, parent terminal
  `term_86e2b660-83d2-4440-811e-50467ae6fed8`, depth 2, no descendants.
- Source read-only: `/Users/carlos/Documents/Drogon-mentu-session` pinned
  `c97906287bb7a390b25e2025b600d9fb3c25d9c3` (verified via `git rev-parse
  HEAD`, read-only — no other Git command run, not even read-only log/show
  beyond the one revision check).
- Owns only `docs/migration/audit-closure/e5-platform/
  final-source-gate-leaf/cloud-collab.md` and `.json`. The accepted
  `services-final.md`/`.json` (which named this exact six-file set as
  `D-CLOUD-COLLAB — explicit-external-source-boundary`) are preserved
  unchanged and not edited by this leaf.
- No test/import execution, no installs, no cloud operations, no secrets,
  no source/product/global-config writes, no Git writes (or any Git
  command beyond the one read-only revision check above).
- Scope is exactly the six named files, all in
  `cloud/apps/relay/src/`: `cell-admission-selector.ts`,
  `cell-admission-migration-registration.ts`,
  `assignment-connection-headroom-query.ts`,
  `assignment-identity-queue.ts`, `regional-rehome-safety.ts`,
  `registered-migration-abandonment.ts`. No recursive import census: this
  leaf does not expand into `database.ts`, `@orca-cloud/relay-contract`,
  `relay-observability.ts`, or `assignment-store.ts` beyond citing them as
  the external callers/collaborators these six files are written against.

## Read coverage (complete, whole-file)

All six source files were read in full, plus every test file that
directly and exclusively tests one of the six (as opposed to testing
`assignment-store.ts`'s *use* of them, which remains a downstream
boundary per the accepted `services-final.md` disposition):

| File | Lines | SHA-256 |
| --- | --- | --- |
| `cell-admission-selector.ts` | 1–505 (whole file) | `0bc2f18a5931334865f2ed27a83df9bcfeeaec45bd8285bb9419719cd06d221b` |
| `cell-admission-migration-registration.ts` | 1–346 (whole file) | `9f2a592dc9299343e43c2f6a0959cf45a91d2c6f89e96ce4c8ab3cec9f0c926d` |
| `assignment-connection-headroom-query.ts` | 1–15 (whole file) | `388d5a8d8332da952cf8fe75d5d6a20ea141131ae5719cc36ca2473bdc9514fe` |
| `assignment-identity-queue.ts` | 1–24 (whole file) | `c070ae8e07e06ff4a98cb3cda3df25abede52d3ae3aa5cea293b4a24c7e7dab4` |
| `regional-rehome-safety.ts` | 1–86 (whole file) | `c7707d914017101684ad82fd46968af11c2ffe9bf194d2b5298f91045489b635` |
| `registered-migration-abandonment.ts` | 1–81 (whole file) | `17adaf0e9f99410a186cbb4aab4a55a3ba736b9b490048d880d7f5a355822af8` |
| `cell-admission-selector.test.ts` | 1–580 (whole file, all 14 `it`s) | `8e6052e68953d5e48637df440189a981edc1c76e2ce6e7e54b9c331ec8f2a09e` |
| `assignment-identity-queue.test.ts` | 1–70 (whole file, all 3 `it`s) | `dab786e0cbe6d182633e1bedf654e83acff0c4c5bf951232e8dc069f8dd7ee37` |
| `regional-rehome-safety.test.ts` | 1–109 (whole file, all 7 `it`s) | `77980bf5fe7f764cb21780acda9ccf61965799f0027cac0dd0aca62fdcba61e5` |

**No dedicated standalone test file exists** for
`cell-admission-migration-registration.ts`,
`assignment-connection-headroom-query.ts`, or
`registered-migration-abandonment.ts`. Their behavior is exercised only
through `assignment-store.ts` consumer tests — for
`cell-admission-migration-registration.ts`, the last two `it`s in
`cell-admission-selector.test.ts` (`'atomically adds exact migration-only
cells after the selector boundary'` and `'rejects additive cells before
cutover and exact-attempt config reuse'`) directly exercise
`RelayMigrationCellRegistrar.add` through `store.addMigrationCells` and
are counted as real assertion evidence for that file above. For the other
two, only consumer-side named test files exist and were **not opened**
this leaf (they test `assignment-store.ts`'s query construction, not
these files' own logic, which for `assignment-connection-headroom-query.ts`
is a single exported SQL string with no logic to unit-test in isolation):
`assignment-connection-headroom-postgres.test.ts` (348 lines),
`registered-migration-inventory.test.ts` (117 lines),
`registered-migration-inventory-postgres.test.ts` (139 lines).

## `cell-admission-selector.ts` (505 lines)

**Immediate bodies.** Defines the `CellAdmissionState` enum
(`existing-only`/`migration-only`/`general`) and exports the
`RelayCellAdmissionSelector` class plus a library of free functions
(`ensureCellAdmission`, `cellAdmissionState(s)`,
`setCellAdmissionBeforeBoundary`, `synchronizeCellAdmissionBoundary`,
`lockedSelector`, `requireSelectorMatchesAdmission`,
`normalizeMembership`, `encodeMembership`/`decodeMembership`,
`stateFromEnabled`/`enabledForState`/`parseCellAdmissionState`) that
`assignment-store.ts` imports directly (confirmed by the prior
services-leaf pass's grep of that file's import block).

**State owned.** The `relay_admission_selectors` singleton row
(`selector_id='general'`, `generation`, `attempt_id`, `membership_json`),
`relay_admission_selector_intents` (durable pre-commit record of a CAS
attempt, one row per `attemptId`, `committed_at` set only on success),
and it writes through to `relay_cells.enabled` / `relay_cell_admission`
for every cell whose state the selector governs. Below generation 0 (no
selector boundary ever cut over), the selector's own membership row is
kept in lockstep with the live `relay_cells`/`relay_cell_admission` state
by `synchronizeCellAdmissionBoundary` on every reconcile — the selector
starts as a passive mirror, not an active gate.

**Auth/lifecycle (the CAS protocol).** `apply()` is a two-phase
commit-like protocol: `persistIntent` durably records the caller's
intended `(attemptId, expectedGeneration, expectedGeneration+1,
previousMembership, membership)` tuple in its own transaction *before* the
mutating transaction runs, specifically so a caller can safely retry an
ambiguous outcome (see failure/cancel below). The mutating transaction
then: (1) locks the full cell inventory and `requireExactMembership`s it
against the caller's proposed membership (every cell must appear exactly
once — `admission_selector_incomplete_membership` otherwise); (2) if the
selector has *already* advanced to exactly
`(expectedGeneration+1, attemptId, encoded-membership)`, returns
`{changed:false}` idempotently (safe replay of an already-committed
attempt); (3) otherwise requires `selector.generation ===
expectedGeneration` exactly (`admission_selector_generation_mismatch`);
(4) `requireExpectedMembership` re-verifies the caller's
`expectedMembershipSha256` (mandatory at generation 0 —
`admission_selector_membership_fingerprint_required` if omitted, but
optional at generation>0) against a SHA-256 of the *current* selector
membership, closing the exact race window demonstrated by the
`'rejects a generation-zero membership change between intent and commit'`
test below; (5) `requireSelectorMatchesAdmission` re-derives live
membership from `relay_cells`/`relay_cell_admission` and requires it to
still equal the selector's own recorded membership
(`admission_selector_membership_drift` otherwise) — protecting against a
concurrent direct cell mutation outside the selector's own write path;
(6) once generation>0 (a boundary is already active), refuses to move any
cell *out of* `existingOnly` back into `migrationOnly`/`general` unless it
is *already* in the target sets (`admission_selector_legacy_reenable`) —
the one-way-door invariant that legacy (existing-only) cells can never be
reintroduced to migration/general admission once a cutover boundary is
live; (7) writes every per-cell `relay_cell_admission`/`relay_cells.enabled`
row, then advances the selector row via a **conditional** `UPDATE ...
WHERE selector_id = ? AND generation = ?` whose `changes` count is the
actual optimistic-concurrency gate (a concurrent winner's earlier commit
makes this `UPDATE` affect zero rows, thrown as
`admission_selector_generation_mismatch` — this is the real CAS
mechanism, not the earlier read-then-compare check, which can only ever
be advisory given the read happens outside the final write's own lock
scope).

**Failure/cancel semantics.** An error thrown from *inside* the mutating
transaction (after `persistIntent` already committed) leaves a durable,
uncommitted intent row behind — `inspect()` reports this as `intent:
{state: 'unchanged'}` if the selector never advanced, letting the caller
safely retry the identical `apply()` call (idempotent replay via the
persisted intent's own equality check in `persistIntent` itself — a
second `persistIntent` call with identical input for the same `attemptId`
is a silent no-op, `return` at line 310, while any field mismatch is
`admission_selector_attempt_mismatch`). This two-phase intent-then-commit
split is explicitly what makes an **ambiguous** commit response (e.g. a
network failure after the DB actually committed) recoverable: the caller
retries the exact same input, and either sees `changed:false` (it already
landed) or completes it now.

**Concurrency.** `apply()` provides no in-process serialization of its
own (unlike `assignment-store.ts`'s `serializeAssignment` mutex for
placement) — concurrent `apply()` calls for the *same* `expectedGeneration`
race purely on the database's row lock and the conditional `UPDATE`'s
affected-row count; exactly one wins, the other's `UPDATE` affects 0 rows
and throws `admission_selector_generation_mismatch`, confirmed directly by
the `'allows only one concurrent CAS and never re-enables legacy cells'`
test (`Promise.allSettled` on two concurrent `apply()` calls at the same
`expectedGeneration`: exactly 1 fulfilled, exactly 1 rejected).

## `cell-admission-migration-registration.ts` (346 lines)

**Immediate bodies.** `RelayMigrationCellRegistrar` with a single public
method `add(input)`, plus free helpers `normalizeMigrationCells`,
`validateMigrationCell`, `membershipAfterAddition`, `requireExactAddedCells`,
`insertCell`, `encodeCells`. Imports `lockedSelector`,
`requireSelectorMatchesAdmission`, `encodeMembership`/`decodeMembership`,
`normalizeMembership` directly from `cell-admission-selector.ts` — this is
the one file among the six with a direct source-level dependency on
another of the six, not merely a shared consumer (`assignment-store.ts`).

**State owned.** Inserts brand-new rows into `relay_cells`
(`enabled=1` unconditionally — a newly-added migration cell always starts
enabled at the row level, with the *admission* state, not the enabled
flag, controlling whether it actually receives traffic),
`relay_cell_regions`, `relay_cell_admission`
(`admission_state='migration-only'` unconditionally — a cell can only
ever be *added* as migration-only, never directly as general or
existing-only), and `relay_cell_connection_limits`. Also writes
`relay_admission_selector_intents` and
`relay_admission_selector_cell_additions` (a second intent-tracking table
specific to this operation, storing the exact `cells_json` payload
alongside the shared intents table) and advances the shared
`relay_admission_selectors` row exactly as `apply()` does.

**Auth/lifecycle.** `add()` requires the selector boundary to already be
active (`selector.generation < 1` → `admission_selector_boundary_inactive`)
— cells can only be added to an *already-cutover* migration/general
split, matching the accepted `RP-C4`/services-final characterization that
addition follows cutover, never precedes it. Validates every cell
individually (`validateMigrationCell`: id/url length bounds, capacity
1..100,000, a legal `RelayCellConnectionHardCap` value from
`@orca-cloud/relay-contract`, unobserved-bound within
`relayCellAdmissionBounds(hardCap).maxUnobservedBound`, region a legal
`RELAY_REGIONS` member) and as a batch (1..128 cells, no duplicate id or
url within the batch — `admission_selector_duplicate_cell`), then
requires none of the cells' id or url already exists in the live
inventory (`admission_selector_cell_already_exists`) before committing.
The idempotent-replay branch (lines 73–97) is structurally identical to
`apply()`'s but additionally cross-checks that BOTH the shared intent row
AND the operation-specific cell-additions row exist together
(`Boolean(intent) !== Boolean(addition)` → `admission_selector_attempt_mismatch`
— a torn write where one table has the record and the other doesn't is
treated as a hard error, not an ambiguous-retry case) and, on confirmed
prior success, re-verifies the added cells' live state matches exactly
via `requireExactAddedCells` (url, enabled=1, capacity, region, admission
state, hard cap, unobserved bound — a full field-by-field replay
verification, stricter than `apply()`'s own idempotent-replay check, which
only re-derives the encoded membership string, not every underlying cell
field).

**Failure/cancel semantics.** Same intent-durability shape as `apply()` —
an interrupted commit after the intents/additions rows are written but
before the selector row advances leaves a recoverable, retryable state;
confirmed indirectly (not by a dedicated fault-injection test for this
file, unlike `cell-admission-selector.test.ts`'s
`FailAfterIntentDatabase`/`AfterTransactionDatabase` harnesses, which this
leaf did not find reused against `addMigrationCells`).

**Concurrency.** No dedicated mutex; relies on the same conditional
`UPDATE ... WHERE generation = ?` CAS mechanism as `apply()`, inheriting
the identical single-winner-under-race guarantee, but this leaf found
**no test exercising two concurrent `addMigrationCells` calls** the way
`cell-admission-selector.test.ts` explicitly tests two concurrent `apply()`
calls — this is a discriminating gap named below, not assumed safe by
analogy alone.

## `assignment-connection-headroom-query.ts` (15 lines)

**Immediate body.** A single exported string constant,
`ASSIGNMENT_CONNECTION_HEADROOM_QUERY` — no function, no class, no logic.
It is a `LEFT JOIN` across `relay_cell_connection_limits`,
`relay_cell_connection_snapshots`, and `relay_cell_runtime`, plus a
correlated subquery counting `relay_control_connection_reservations` rows
in states `('reserved','late-arrival-debt','claimed')` per cell.

**State/auth/lifecycle/failure/cancel/concurrency.** None of these
dimensions apply to a static SQL string with no execution semantics of
its own; every behavioral guarantee (freshness window, incarnation
matching, headroom arithmetic) lives entirely in the caller
(`assignment-store.ts`'s `connectionHeadroomByCell`, already fully
characterized in the prior services-leaf pass) that interprets this
query's result rows. This leaf's only obligation for this file is exact
textual/hash identity and confirming the query shape matches what its
sole caller expects — both confirmed by direct reading; no source
defect or intended-correction candidate was found (a 15-line constant
has essentially no surface for either).

## `assignment-identity-queue.ts` (24 lines)

**Immediate body.** `AssignmentIdentityQueue` — a single class with one
public method `run<T>(identity, operation)`, implementing a per-key
serial-execution queue via a `Map<string, Promise<void>>` of chained tail
promises, keyed by `JSON.stringify([userId, relayHostId])`.

**State owned.** Purely in-memory, per-process — the `tails` map. No
database, no cross-process coordination; this is process-local
serialization only, matching its sole use in `assignment-store.ts` to
serialize `changeActivity`/`acquireActivity`/`releaseActivity`/
`activateControl` per identity within one director/cell process.

**Auth/lifecycle.** None — this is a pure concurrency primitive with no
authorization surface.

**Failure/cancel semantics.** `run()` chains the next operation onto
`previous.catch(() => undefined).then(operation)` — a rejected prior
operation does **not** propagate to or block the next queued operation
for the same key; the queue's own tail-tracking (`tail = result.then(()
=> undefined, () => undefined)`) similarly swallows both outcomes so the
map entry is always cleanly removable. The caller of `run()` still
receives the *original* rejection via `return await result` — only the
*queue's internal chain* is failure-transparent, not the caller's own
promise. Confirmed exactly by the `'continues after a rejected operation'`
test: a failing first operation rejects its own caller with `'failed'`,
while a second operation queued for the same identity still resolves
normally with `'recovered'`.

**Concurrency.** Confirmed by direct test evidence: operations for the
**same** identity are strictly serialized (the `'serializes operations
for the same assignment'` test proves the second operation's body does
not start until the first's `deferred()` promise is explicitly resolved,
via an execution-order array assertion); operations for **different**
identities run **fully concurrently** with no queueing at all (the
`'allows different assignments to run concurrently'` test proves a
second-identity operation completes and is observed *before* the first
identity's still-blocked operation releases). The `finally` block's
`if (this.tails.get(key) === tail) this.tails.delete(key)` guard prevents
a completed operation from deleting a *newer* tail that has since
replaced it in the map — a correct cleanup-race guard, confirmed by
reading (not by a dedicated test for this specific guard; no test in the
70-line file specifically targets a three-operation interleaving that
would exercise this exact comparison).

## `regional-rehome-safety.ts` (86 lines)

**Immediate bodies.** Six named numeric constants (all with source
comments citing specific production measurement dates/values —
`REGIONAL_REHOME_RECONNECTS_PER_CELL_LIMIT=250`,
`REGIONAL_REHOME_POOL_WAITERS_MAX_LIMIT=16`,
`REGIONAL_REHOME_POOL_WAIT_MS_MAX_LIMIT=250`,
`REGIONAL_REHOME_SQL_FAILURES_LIMIT=250`,
`REGIONAL_REHOME_SQL_FAILURES_PER_CELL_LIMIT=40`) and three pure functions:
`regionalRehomePoolPressure`, `regionalRehomeSafetyFailure`,
`combineRegionalRehomeSafety`.

**State/auth.** None — pure functions over caller-supplied snapshot
objects; no I/O, no database access. This file is a scoring/policy layer
consumed by `assignment-store.ts`'s `claimRegionalRehome` (already fully
characterized in the prior services-leaf pass) to decide whether the
regional-rehome worker may proceed on a given tick.

**Lifecycle/decision logic (`regionalRehomeSafetyFailure`).** Checked in
a fixed priority order, first match wins: (1) `monitoring_stale` if
`observedAt===0` OR the snapshot is older than 60s relative to `now`;
(2) `sql_failures` if `sqlFailures` strictly exceeds the fleet-wide limit
(250, confirmed exclusive-at-the-limit by the
`'still fails closed on a sql failure storm'` test's third assertion —
exactly 250 passes, 251 fails); (3) `database_pool_pressure` via
`regionalRehomePoolPressure` (either pool-waiters-max OR pool-wait-ms-max
strictly exceeding their limits); (4) `control_recovery_failures` if
**any** (`>0`, zero-tolerance, no threshold) control-activity-recovery
failure is observed — the one metric in this scoring function with no
grace band at all; (5) `elevated_reconnects` if `reconnects` exceeds
`Math.max(1, requiredCells) * 250` — a **scaled**, not fixed, limit,
confirmed by both the `'passes routine client reconnect churn'` test
(19 cells × 80 reconnects passes) and `'still fails closed on a reconnect
storm'` test (19 × 250 + 1 fails); otherwise `null` (no failure).

**Failure/cancel semantics.** N/A — this is a read-only scoring function,
not a state-mutating operation; "failure" here means the *scored
condition*, not an exception. No function in this file throws.

**Concurrency.** N/A — pure functions, no shared mutable state.
`combineRegionalRehomeSafety` merges a per-process snapshot with a
fleet-wide snapshot using deliberately asymmetric combinators per field:
`observedAt` takes the **minimum** (most-stale-wins, a conservative
freshness bound), `sqlFailures` and `controlActivityRecoveryFailures`
**sum** (both signals are additive across the two scopes), `reconnects`
is taken **only from fleetSafety** (the process-level snapshot's own
`reconnects` field is discarded entirely — process-level reconnect
counting is not meaningful/available at this call site, confirmed by
this being the one field with no `processSafety` contribution at all,
worth flagging as an asymmetry a reader could easily miss), and the two
pool-pressure fields take the **maximum** across both scopes. No test in
`regional-rehome-safety.test.ts` directly exercises
`combineRegionalRehomeSafety` — it is called only from
`assignment-store.ts`'s `claimRegionalRehome`/`startRegionalRehomeCandidate`
path (already characterized in the prior services-leaf pass), and no
dedicated unit test for this specific function's field-by-field
combination logic was found in this file's own test file.

## `registered-migration-abandonment.ts` (81 lines)

**Immediate bodies.** One numeric constant
(`REGISTERED_MIGRATION_ABANDON_MS = 24h`) and two exported raw SQL
fragment strings: `DURABLY_FENCED_MIGRATION_SOURCE` (a boolean SQL
expression, not a full query) and `ABANDONED_REGISTERED_MIGRATION` (a
second boolean SQL expression that embeds the first via string
interpolation and itself takes **three** positional `?` parameters,
confirmed by reading: `migration.expires_at <= ?` (1st),
`target_admission.updated_at <= ?` (2nd), `source_admission.updated_at
<= ?` (3rd) — callers must bind exactly these three values in this exact
order, a contract enforceable only by reading the SQL text since there is
no typed parameter list).

**State/auth.** None directly — these are read-only predicate fragments
interpolated into `assignment-store.ts`'s own queries
(`abortExpiredEvacuations`'s `ABORTABLE_EXPIRED_MIGRATION` fragment and
`completeReadyEvacuations`/sweep candidate-selection queries, already
characterized in the prior services-leaf pass).

**Lifecycle/decision logic.** `DURABLY_FENCED_MIGRATION_SOURCE` is
disjunctive over two independent proof paths for "this migration's source
cell cannot possibly come back": a Terraform-managed committed fence
(matching cell/incarnation across `relay_cell_committed_fences` →
`relay_cell_fence_attempts` → `relay_cell_runtime`, requiring the
attempt `completed_at IS NOT NULL AND aborted_at IS NULL` and the
committed fence's `attested_at >= source_runtime.last_heartbeat_at`) OR a
legacy attestation adoption (`relay_cell_legacy_fence_adoptions` matched
against `relay_cell_runtime` by incarnation, same `attested_at >=
last_heartbeat_at` freshness requirement). `ABANDONED_REGISTERED_MIGRATION`
requires the migration to be target-registered AND expired, THEN one of
two abandonment reasons: the **target** durably existing-only-disabled
past the abandon window, OR (the **source** existing-only-disabled past
the abandon window OR durably fenced per the above) AND the target is
live/admitted (enabled, migration-only or general) AND the source has
**zero** remaining activity leases — AND in every case, the target must
have **no live (non-pending) control lease**, i.e. abandonment never
fires while the target is genuinely in active use regardless of how the
other conditions resolve.

**Failure/cancel/concurrency.** N/A — these are pure SQL text fragments
with no independent execution; all transactional/locking guarantees
belong entirely to the caller queries in `assignment-store.ts` that embed
them (already characterized in the prior services-leaf pass).

## Real assertion evidence vs. named unrun pointers (kept explicit)

**Assertions actually read this leaf** (all `it` bodies in the three test
files listed in the coverage table, 24 `it`s total): 14 in
`cell-admission-selector.test.ts` (covering `apply()`'s full CAS
protocol including the ambiguous-commit-retry path via
`FailAfterIntentDatabase`, the exact-race membership-drift path via
`AfterTransactionDatabase`, the concurrent-CAS single-winner guarantee,
the legacy-reenable one-way-door, and — via its last two `it`s —
`RelayMigrationCellRegistrar.add`'s cutover-precedence and
exact-attempt-config-reuse behavior), 3 in
`assignment-identity-queue.test.ts` (same-identity serialization,
cross-identity concurrency, rejection-does-not-block-queue), 7 in
`regional-rehome-safety.test.ts` (every named threshold's pass/fail
boundary, including the exact-at-limit-passes edge case).

**Named unrun pointers, not opened this leaf**:
`assignment-connection-headroom-postgres.test.ts` (348 lines — requires a
real Postgres instance per naming convention; tests
`assignment-store.ts`'s consumption of `ASSIGNMENT_CONNECTION_HEADROOM_QUERY`,
not the query file's own logic, which has none),
`registered-migration-inventory.test.ts` (117 lines) and
`registered-migration-inventory-postgres.test.ts` (139 lines — same
consumer-side relationship to `registered-migration-abandonment.ts`'s SQL
fragments).

## Source defects vs. intended corrections (kept explicit)

No confirmed behavioral defect was found in any of the six files. One
observation is flagged as worth a maintainer's attention without
asserting it is wrong:

- **Asymmetric field handling in `combineRegionalRehomeSafety`
  (regional-rehome-safety.ts:62-86)**: `reconnects` is taken *only* from
  `fleetSafety`, silently discarding `processSafety.reconnects` — every
  other field in the function combines both inputs (sum, max, or min).
  This is very likely intentional (per-process reconnect counting may not
  be meaningful or even populated at this call site — the file's own
  comments discuss reconnects only in fleet-wide terms), but the function
  signature accepting a `processSafety.reconnects` field that is then
  unconditionally ignored is a footgun for a future caller who assumes
  every field is combined. Classified as **intended-correction-candidate**
  (worth an explicit code comment or a narrower parameter type), not a
  confirmed defect.

## Discriminating unrun/untested gaps (named, not read this leaf)

- **No test exercises two concurrent `RelayMigrationCellRegistrar.add()`
  calls** the way `cell-admission-selector.test.ts` explicitly tests two
  concurrent `RelayCellAdmissionSelector.apply()` calls
  (`'allows only one concurrent CAS and never re-enables legacy cells'`).
  Both share the identical conditional-`UPDATE`-as-CAS mechanism by
  direct reading, but the concurrent-single-winner guarantee for
  `addMigrationCells` specifically is unverified by any test in this
  codebase, as far as this leaf's file-bounded search found.
- **No dedicated unit test for `combineRegionalRehomeSafety`** — every
  assertion in `regional-rehome-safety.test.ts` targets
  `regionalRehomeSafetyFailure` only; the combination function's
  field-by-field logic (including the reconnects asymmetry above) is
  exercised only indirectly, if at all, through
  `assignment-store.ts`/`regional-rehome-store.test.ts` integration paths
  characterized in the prior services-leaf pass, not through any test
  scoped to this file.
- **`assignment-identity-queue.ts`'s tail-replacement cleanup guard**
  (`if (this.tails.get(key) === tail) this.tails.delete(key)`) has no
  test specifically exercising a three-or-more-operation interleaving
  that would distinguish a completed operation correctly leaving a
  *newer* tail in place versus incorrectly deleting it; the two-operation
  tests in the file do not create that specific race window.
- The three named Postgres-suffixed/consumer test files
  (`assignment-connection-headroom-postgres.test.ts`,
  `registered-migration-inventory{,-postgres}.test.ts`) were not opened;
  whether they contain any assertion that would surface a defect in
  these six files' SQL text specifically (as opposed to the caller's
  query construction) is unresolved by this leaf.
