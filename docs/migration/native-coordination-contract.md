# Native coordination contract

Status: coordinator design, awaiting the selected source-test baseline gates. No
coordination capability is implemented or advertised by this document. This wave
advances the full rewrite; it does not redefine Orca parity as this smaller slice.

Baseline: Drogon `252de85c2fd28bbdc4c09c70c16063a0c7eb901e`; preserved Orca
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`. Follow `next-wave-contract.md` and
the full source-test map. The current installed preview remains unchanged until
the integrated replacement passes packaged and installed acceptance.

## Boundaries and ownership

- Root owns protocol types, manifests/lockfiles, authentication, engine integration,
  Git, acceptance and merge order.
- Store leaf first establishes original lifecycle/database test baselines; its
  implementation will live in `crates/drogon-orchestration/` after gate acceptance.
- CLI leaf first establishes original command tests; its implementation will live
  in domain-specific modules under `crates/drogon-cli/` after gate acceptance.
- No nested workers. At most three approved non-OpenAI direct leaves. Experimental
  inference remains Pi + DGX Spark, default `qwen3.8-flash-next-nvidia-nvfp4`.

The domain crate uses the **existing** host SQLite connection. It opens no database,
launches no process, holds no global mutex, and does no network or filesystem I/O.
The engine retains all PTY handles. CLI and Electron are clients of this engine;
neither invokes Orca to implement Drogon coordination.

## Wire and actor boundary

Keep the protocol-v1 request/response envelope and existing methods unchanged.
Coordination method params require `contractVersion: 1` and an explicit `hostId`.
The CLI negotiates a new `orchestration.native.v1` capability before mutation; the
service advertises it only when the complete promised method group is implemented.
No federation capability is implied. Unsupported hosts fail before effects, not
through a local fallback. Unknown optional response fields remain additive.

Use the existing redacted `auth` envelope field for either the service credential
or a dispatch-scoped credential. Do not put capabilities in params or introduce
another unauthenticated identity field. The server distinguishes:

1. Service credential: coordinator/admin actor. Existing non-coordination calls
   retain their current behavior and receipt namespace.
2. Dispatch credential: worker actor derived by the engine from a stored hash and
   bound run/task/dispatch/host/session/incarnation. It has only the worker methods
   below; it cannot invoke raw session writes, workspace changes, launch, shutdown,
   takeover, or another worker's methods.
3. Anything else: `unauthorized`, before receipt lookup or effects.

Do not treat a supplied `from`, task label, terminal handle or provider session ID
as authentication. The credential is a high-entropy service-generated secret,
hashed at rest. Status, errors, receipt payloads, launch argv, prompt text and
Debug output must not disclose it. A worker receives it through its scoped process
environment; the CLI must not fall back to the service credential when that
environment is present but invalid. Clear inherited Drogon/Orca dispatch identity
before applying the new context. Same-user access is not a hostile-process sandbox.

Run ownership is a durable opaque coordinator ID plus consumer generation.
Admin authentication allows an explicit takeover, not a silent default to the
latest run. Every coordinator mutation of an existing run supplies both values;
the store checks them in the transaction that changes state. Restarting the UI
recovers its saved binding; opening a different coordinator does not consume mail.

## Method group to freeze after source gates

Names below follow Orca's public lifecycle concepts under Drogon's own protocol.
The final typed structs and parser tests must resolve all fields before production
implementation begins; this table does not authorize workers to invent variants.

| CLI under `drogon-cli orchestration` | RPC | Authority and behavior |
| --- | --- | --- |
| `run-create`, `run-list`, `run-show`, `run-use` | `orchestration.runCreate/runList/runShow/runUse` | Admin creates/reads/binds; takeover explicitly advances generation |
| `task-create`, `task-list`, `task-show` | `orchestration.taskCreate/taskList/taskShow` | Bound coordinator; immutable existing same-run dependencies |
| `worker-start`, `worker-show`, `worker-read` | `orchestration.workerStart/workerShow/workerRead` | Coordinator creates one attempt; reads include exact owned session identity |
| `worker-stop`, `worker-abandon`, `worker-release` | `orchestration.workerStop/workerAbandon/workerRelease` | Fence before effects; abandon never signals; release only after settlement |
| `send` | `orchestration.send` | Scoped status/question/heartbeat/final report; coordinator guidance addresses a dispatch |
| `check`, `reply`, `ask` | `orchestration.check/reply/ask` | Whole-batch mail delivery, correlated replies and resumable questions |
| `request-show` | `orchestration.requestShow` | Actor-scoped read-only receipt recovery; absence is not proof of no effects |

Keep explicit request IDs for every mutation, including consuming checks and ACKs.
An `ask` commit and its wait/resume are separate: timeout leaves the same question
pending. Waiting neither recreates the question nor fabricates an answer. A bounded
wait releases database and admission locks between observations. Non-consuming
inspection must not create a Delivery. Do not expose retired scheduler/reset
commands as working aliases or claim gates/federation are covered by this group.

## Persistence and transaction rules

Reuse the engine's admission ledger and same database, extending it deliberately:

- Existing methods retain their receipt keys/fingerprints. New coordination keys
  bind authenticated actor, run generation or dispatch attempt, request ID, method
  and canonical semantic payload. A worker must never retrieve an admin receipt by
  guessing its request ID. Use unambiguous tuple encoding, not delimiter joining.
- Authorization happens before lookup. A known credential for a settled attempt
  may recover its exact already-committed report receipt, but cannot create a new
  report or mutate a replacement. A cancelled/superseded attempt cannot settle a
  task. Every fresh effect revalidates authority in the state transaction.
- For database-only operations, domain state, mailbox output and successful receipt
  commit atomically. The existing external-effect ledger's separate finish step
  alone is insufficient proof of atomic database mutation. Extend that ledger with
  a transaction-aware path; do not create a competing JSON receipt system.
- Launch has durable admission before any process creation. Persist the reserved
  dispatch and exact future session/incarnation together, then launch outside the
  transaction. Register the real handle before persisting final attachment. If
  persistence fails after spawn, retain the owned handle and return `unverifiable`;
  retrying the same operation never launches a second process.
- Stop/cancel commits its fence before attempting an exact process operation.
  A write failure means no signal. Response loss cannot undo the fence. Repeated
  release joins/replays its owned operation; it cannot target a reused terminal.
- Startup migration is additive, versioned and part of the existing atomic startup
  gate. Interrupted admissions become inspectable `unverifiable` attempts, not
  retryable spawn instructions. Existing workspace/session recovery is preserved.

Core must not hold SQLite or receipt-map locks across spawn, PTY I/O, wait or kill.
All mutation paths participate in the current lifecycle admission/freeze gate.
Quiescent shutdown cannot race a coordination launch or successful final receipt.

## State invariants

Tasks have immutable specs and existing same-run dependencies. Deduplicate
dependency IDs, reject self/cross-run/missing dependencies, and dispatch only when
all prerequisites have successful final reports. Artifact acceptance remains a
separate root decision; a future policy may require it without changing what
`worker_done` means. Failed/cancelled prerequisites never silently satisfy a DAG.

One active attempt per task. Replacement is explicit and refers to its prior
failed/stopped/abandoned attempt. A report is bound to the exact attempt; late
reports cannot settle its replacement. Preserve every attempt's history.

Do not overload one status field. Track assignment state, reported outcome,
readiness evidence and process verdict independently. Spawn acceptance is not
TUI readiness; TUI readiness is not a worker handshake or model response. Only
`live`, `unverifiable`, `exited` describe process liveness.

Mail is immutable and ordered by database sequence, not timestamp. At most one
outstanding Delivery per recipient and consumer generation. A consuming check
returns the exact same ordered message IDs until full ACK; concurrent checks
cannot allocate two batches. A wake-type filter may wait for a matching message,
but cannot exclude earlier messages from the returned FIFO batch. Cap batches at
50. ACK validates recipient, run and generation, then marks the whole batch read
in one transaction. Duplicate ACK is idempotent. Takeover fences the old Delivery
without losing unread messages; no stale ACK can consume the new generation's mail.

Worker guidance uses the same durable discipline with a dispatch-scoped inbox.
An answered question retains its original correlation ID. Cancellation and final
reporting serialize against the same attempt record: exactly one terminal outcome
wins, with the loser refused and no duplicate final mailbox message.

## Launch and cleanup

Use the existing discovered harness executable and validated literal argv plan.
Root extends its session admission seam to accept reserved identity and private
environment; do not make the generic client choose arbitrary dispatch credentials.
Permissions are explicit per launch, never a global setting. Preamble includes the
host's exact installed Drogon CLI path, task scope, IDs, report/recovery commands,
and no-nesting rule, but no credential value. Task text remains data, not shell code.

Initial workspaces may be registered ordinary folders or worktrees; a Git checkout
is not required. Do not create a parallel workspace registry. An existing external
terminal is not implicitly cleanup-owned; post-completion release may honestly say
retained/no-owned-resource. Do not derive a kill target from a persisted PID.

After daemon restart, missing retained handles mean `unverifiable`. No PID probe,
automatic respawn or local substitution may turn that into exit evidence. Retain
the original attempt and provide explicit recovery/abandonment guidance. A future
reattachment path must prove execution-host identity before restoring authority.

## Integration order and acceptance

1. Accept source baselines/maps for the selected CLI and store families; account
   for every uncovered invariant. Isolated setup failures are gaps, not RED tests.
2. Freeze typed protocol/domain seam and executable candidate contract tests.
   Establish behavioral RED against the unchanged candidate before implementing.
3. Store implementation and CLI implementation proceed in separate worktrees.
   Root integrates auth, session admission, ledger and lifecycle gate changes.
4. Run deterministic races/restart/persistence fault injection plus real native
   daemon/CLI tests. Test old client/new host and new client/old host negotiation.
5. Dogfood one real bounded file task through installed Drogon, reload Electron
   mid-run, inspect durable mail, independently verify output and release exactly.
   Repeat failure/replacement and reject a late original report.
6. Review the combined diff, CI, package and installed build before replacing the
   preview. Record source revision and evidence; no global parity claim follows.

Additional mandatory negative tests: raw RPC worker privilege escalation;
same request ID across actors; credential leakage through argv/status/receipts;
duplicate same-ID and new-ID final reports; stale consumer with an old receipt;
cross-run ACK; cancelled launch before/after spawn; persistence failure after
child exists; lost stop response; shutdown during dispatch; unsupported host;
Windows build and Unix runtime coverage stated separately.

## Source anchors

Read at the pinned Orca revision: `src/shared/orchestration-rpc-contract.ts`,
`src/main/runtime/orchestration/db/runs/run-delivery.ts`,
`src/main/runtime/orchestration/db/dispatch-capability-hash.ts`,
`docs/reference/remote-wire-compatibility.md`, and
`docs/reference/ssh-execution-boundary.md`. Preserve attribution for adapted code.
Current Drogon integration seams: `crates/drogon-core/src/requests.rs`, `db.rs`,
`session.rs`, `harness.rs`, `lib.rs`, `crates/drogond/src/server.rs`, and
`crates/drogon-harness/src/launch.rs`. Original test baselines, not this design
record, must establish which asserted source behaviors are actually preserved.
