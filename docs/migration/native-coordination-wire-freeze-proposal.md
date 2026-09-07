# Native coordination wire freeze proposal (orchestration method group)

Status: worker-authored typed-params/results proposal, **root-corrected revision**.
The second worker revision still required the corrections below.
Schema only: nothing here is implemented orchestration, no capability is
advertised, and no runtime behavior changed. These are **18 native methods,
not full Orca parity**; the remaining source methods stay on the global-parity
watchlist below.

Scope: the contract's method group —
`runCreate/runList/runShow/runUse`, `taskCreate/taskList/taskShow`,
`workerStart/workerShow/workerRead/workerStop/workerAbandon/workerRelease`,
`send`, `check/reply/ask`, `requestShow`. Source anchor: pinned Orca
`c97906287bb7a390b25e2025b600d9fb3c25d9c3` (read-only bounded git show;
already-accepted source baselines were not rerun).

Files (exact task ownership): `crates/drogon-protocol/src/orchestration_common.rs`,
`orchestration_run.rs`, `orchestration_task.rs`, `orchestration_worker.rs`,
`orchestration_mail.rs`, `orchestration_question.rs`, module export lines in
`lib.rs`, `tests/orchestration_wire.rs`, this document. `orchestration_scope.rs`
is untouched and reused.

## Verification

- Root `cargo test --locked --offline -p drogon-protocol`: **29 passed, 0 failed**
  (4 envelope, 7 scope, 16 wire, 2 root regression tests).
- `cargo clippy --locked --offline -p drogon-protocol --all-targets -- -D warnings`:
  clean. `cargo fmt -p drogon-protocol` applied.
- Schema proposal only — compile/tests green is not an implementation.

## Root decisions applied (1–14)

1. **ActorScope** is explicitly internally tagged (`actorKind:
   coordinator|dispatch`) with the existing scope content flattened; custom
   `Deserialize` rejects contradictory reserved fields at JSON decoding
   (`taskId`/`dispatchId` on a coordinator scope, `coordinatorId`/
   `consumerGeneration` on a dispatch scope) while unrelated additive fields
   pass. Serialization is derived. Shape grants no authority; the runtime
   compares the credential/state binding in its transactions.
2. **`SessionIdentity.incarnation` is a `String`** (current native
   SessionSummary UUID-string vocabulary); no numeric incarnation anywhere.
3. **`TaskStatus` is exactly** `pending|ready|dispatched|completed|failed|
   blocked` (pending = deps unsatisfied; blocked = cancellation/release-style
   holds). `TaskListParams` gained `status?`, `ready` (default false),
   `brief` (default false); `ready` plus a non-ready `status` is refused
   before admission. `TaskSummary` requires `spec` + `specTruncated` so
   listings convey instructions; taskShow keeps full spec and history.
4. **Failure semantics (root a1d2073)**: `AttemptFailure` now has a stable
   `code` (e.g. `agent_prompt_stalled`). A prompt-observation failure
   serializes as `assignmentState: failed`, `readiness: notObserved`,
   `outcome: None`, independent process verdict, credential retained. Retry
   is explicit via `retryOf` naming the latest failed/stopped/abandoned
   attempt; no auto-respawn; the old attempt is fenced. Tests pin the failed
   placeholder and the late-first-report/duplicate metadata without claiming
   resume semantics.
5. **Check** models `CheckMode::Unread { acknowledge? } | Peek | All` — the
   standalone ACK variant is gone; the source CLI's `--ack` maps to
   `unread` + `acknowledge`. A response may carry `acknowledged` **and** a
   new `delivery` (ACK then consume/wait). A reserved `acknowledge` field on
   `peek`/`all` fails JSON decoding (not silently ignored). Whole-FIFO batch
   ≤ 50 with unique ordered ids is validated. `wait` is unread-only with a
   positive budget ≤ 900 000 ms. Inspection output is bounded via
   `nextCursor`.
6. **Ask** new/resume contradictions (`resume`+`question`/`options`/`to`,
   `new`+`questionMessageId`) fail at JSON decoding through a custom
   deserializer over a raw map, while valid payloads keep ergonomic Rust
   enum/struct types and unrelated additive fields survive. Wait budgets are
   positive ≤ 900 000 ms. `AskResult` requires `answer` iff `answered`.
7. **Enums use `rename_all_fields = "camelCase"` alongside
   `rename_all`**; tests assert exact wire keys (`dispatchId`,
   `questionMessageId`, `acknowledge`, `deliveryId`) and that snake_case
   spellings of required fields are unsupported input. The earlier claim
   that contradictions were "unrepresentable" is retracted: serde ignores
   unknown fields, so contradiction rejection is explicit decode logic.
8. **requestShow** takes `ReceiptScope` (tagged `actorKind:
   bootstrap|coordinator|dispatch`; bootstrap = host + `coordinatorId`, the
   others reuse the existing scopes) plus `requestId`, because the admin
   credential is shared — the engine checks auth fences before lookup, and
   this routing grants no authority. `RequestLedgerState` now has
   `Absent` (honest no-record; replaces the `unknown` placeholder, and its
   interpretation must state that absence is not proof of no effects).
   Request-id validation mirrors `Request::validate` exactly (non-empty,
   ≤ 128 bytes, no control characters — whitespace allowed), not an
   arbitrary id shape.
9. **`MessageKind` gained `Escalation`** (source escalation workflow is
   essential); `finalReport` remains the explicit `worker_done` mapping.
   Lifecycle kinds (`heartbeat`, `finalReport`) may target only `runHome`
   or omit the target; dispatch/group targets for them are refused. Groups
   remain available for non-lifecycle traffic; guidance/reply authority is
   engine-validated.
10. **`runCreate`** carries no generation field — the initial consumer
    generation is always 1, server-owned. `RunSummary` now carries
    `coordinatorId` and `createdAtMs` alongside runId/objective/generation
    so inspection and recovery work without the creating response.
    `runShow.taskCount` stays optional.
11. **WorkspacePlan is removed.** `workerStart` requires a registered
    `workspaceId` (native execution placement — folders and Git worktrees
    both valid) and an explicit `WorkerExecution`: `fresh { launch }` or
    `reuse { sessionIdentity }`; no implicit cleanup ownership. Client
    executables/credentials remain unrepresentable. Results return the
    workspaceId, exact session identity and typed resource refs for
    recovery. Source worktree CLI flags are a **deferred parity obligation**:
    worktree creation composes through existing/future workspace APIs before
    native start, and until that composition exists the engine must answer
    unsupported-feature before effects — this is tracked in the watchlist.
12. **`ResourceEffect`/`ResidualResource` identify exact resources**: typed
    `kind` (`workspace|session`), `resourceId`, optional String
    `incarnation`, `action` (`created|reused|retained|released`), plus
    `disposition` on residuals. No PIDs, no secrets. Stop keeps
    `processAction` (`none|signalled|unverifiable`) with `processVerdict`
    separate; release reports both disposition and verdict; **abandon
    carries no process action at all** (never signals; the arbitrary
    signalled variant is gone).
13. **Cursor bound is 4096 bytes** (the earlier 256 was not source-pinned;
    host context must fit); page cap 500 and mail batch 50 remain the single
    protocol constants. Unknown message kinds are refused as unsupported
    input at decode. `OutputSource` is `auto|terminal|transcript`.
    `OutputEntry` requires `sourceIdentity` (honest stream identity, no PTY
    ownership claim), optional `fallbackReason`, pinned continuation cursor,
    with task-authored `content` as the allowed Value exception.
14. **No retired aliases exist**; the parity watchlist is retained. The
    first proposal's incorrect claims ("source only shows pending",
    "all methods frozen", "untagged disjoint", "contradictions
    unrepresentable") are removed.

## Design rules (unchanged where still true)

camelCase additive serialization with `skip_serializing_if` and no
`deny_unknown_fields` anywhere. Authority lives in the redacted envelope
`auth` field — no params/results field carries a credential, enforced by a
freeze-level key scan (`leaks_credential_shaped_key`) and a test. Evidence
axes stay independent: `AssignmentState`, `ReadinessObservation`,
`ProcessVerdict` (`live|unverifiable|exited`, exactly three), `ReportOutcome`.
Validation is shape-only and passing it grants no authority. Named
structs/enums everywhere except the four explicitly task/result-authored
`Value` fields (`TaskSpec::metadata`, `SendParams::payload`,
`OutputEntry::content`, `RequestShowResult::receipt`).

## Global-parity watchlist (source methods outside this group)

`taskUpdate`, `dispatch` (incl. `dryRun`), `workerRetain`,
`gateCreate`/`gateResolve` (gates), retired `reset`/`orchestration.run`/
`orchestration.runStop` (must not return as aliases), `federation*`,
`inbox`, `skills get orchestration` recovery guidance, and the source
worktree/repo placement CLI composition deferred per decision 11. These are
tracked for global parity; nothing here claims the frozen 18 cover them.

## Root review corrections

Independent review reproduced two failures with valid complete inputs:
resume addressing was checked after removing its key, and a delivery could
name message IDs unrelated to its returned messages. Both are corrected;
the batch now matches exact IDs and increasing sequence order. The old ask
negative fixtures were missing required `wait`, so they failed for the wrong
reason; the fixtures now include it. The 50-message positive fixture now
actually returns all 50 messages instead of one.

Task prerequisite duplicates are accepted at the wire boundary for domain
deduplication, as the root contract requires. Root reproduced the prior
incorrect rejection before removing it. The formerly uncalled process-action
roundtrip helper is now a real test. None of these shape tests proves actual
runtime authorization, receipt durability, late report settlement or FIFO
delivery. Native runtime acceptance remains mandatory.

Root accepts these typed interfaces for implementation after the corrections
and independent full protocol test/clippy run. This is an implementation
contract, not a release or a claim that every future native method is complete.
Inspection pagination, safe credential handover for reused sessions and exact
process/dispatch fencing must be resolved during runtime integration before
the capability is advertised. Schema changes discovered there remain reviewed
additive changes, never silent reductions of source behavior.

## Remaining runtime work

- Two implementation-time obligations are
  restated for the record: (a) the workspace API composition required before
  native `workerStart` can accept real placements (decision 11), and (b) the
  engine-side credential/state comparison that must back every
  scope-vs-actor check (decisions 1 and 8) — both are runtime work outside
  this schema task.
