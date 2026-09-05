# Next wave: native coordination and useful workspaces

Coordinator design record, not an implemented feature or an executed Mentu recipe. Begin the next implementation wave only after the current Electron → native service → installed harness slice passes rendered acceptance. The active rewrite goal and original feature requirements remain unchanged.

## Priorities and ownership

1. **Native coordination:** preserve the Run → Task → Dispatch lifecycle, durable messages and exact worker ownership. This is the dependency for dogfooding Drogon without an Orca runtime proxy.
2. **Useful workspaces:** file explorer/editor, Git status/diffs and safe worktree creation, preserving ordinary folders. These are adjacent vertical slices, not a wholesale renderer redesign.
3. **Deployment boundaries:** bundled daemon/CLI startup and installation, Windows same-user IPC, SSH execution-host routing and mixed-version checks. A macOS walkthrough does not waive these requirements.

After the current slice settles, assign Sonnet a domain-limited Rust coordination implementation, GLM its typed CLI surface/tests, and the coordinator integration and desktop acceptance. AGY remains unavailable due to its observed quota; do not launch replacement work speculatively or change subscriptions. Shared manifests, schema/wire contracts, Git and integration remain coordinator-owned. No nested agents or simultaneous edits to the same module.

## Contracts to preserve from Orca

- Runs have explicit owner/consumer generation; consumer takeover fences stale deliveries instead of silently sharing an inbox.
- Tasks declare dependencies and a concrete spec; dependencies belong to the same run. No dispatch until all prerequisites succeed. Reject cycles or forward references if the first implementation only permits immutable existing dependencies.
- Each dispatch is a distinct attempt with its own unpredictable capability and exact execution-host/session/incarnation identity. A late report from an old or cancelled attempt cannot complete a replacement attempt.
- Message delivery is a bounded, ordered batch. An outstanding batch is replayed unchanged until acknowledged in full. Filtering wake conditions must not silently drop earlier messages from that batch. Concurrent readers cannot both create outstanding deliveries for one consumer.
- `worker_done` is the worker's report, not independent proof that its artifact is correct or its process exited. Coordinator acceptance examines real changes/tests; resource release follows settlement separately.
- Cancellation fences the attempt before process action. Release can stop only a proven owned incarnation; it never closes arbitrary user/external terminals. Loss of contact produces `unverifiable`, not evidence of death.
- Request receipts bind caller/attempt, request ID, method and semantic payload. Replayed mutations cannot duplicate messages, dispatches or process launches. A response-loss probe must preserve the identity needed for recovery.

References inspected at the preserved source revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`: `src/shared/orchestration-rpc-contract.ts`, `src/main/runtime/orchestration/db/schema/create-core-tables-sql.ts`, `db/runs/run-delivery.ts`, `db/dispatch-capability-hash.ts`, plus the version-matched official Orca orchestration skill. Reuse the invariants, not legacy migration baggage or known cleanup defects. Preserve attribution if source code is adapted.

## Runtime boundary

Use the existing Drogon SQLite store, authenticated native transport, admission ledger and PTY engine. Do not build a parallel process registry, second daemon, mutable JSON database or hidden call to Orca. Coordination persistence should live in a domain crate with short transactions and no locks held across process launch, wait or terminal I/O; the core owns effects and host identity. Migrations must be versioned and safe to rerun.

Service capabilities must distinguish implemented coordination methods from future federation features. Final method/field shapes are frozen by the coordinator before worker dispatch; this document is not permission to invent conflicting wire shapes independently. Every operation must reject an unsupported host instead of using local execution. Mixed-version clients must receive an actionable refusal before optional mutations.

Coordinator/admin calls and dispatch-scoped worker calls are distinct actors. Derive worker identity from the service-issued dispatch capability, never a user-supplied sender label. Store capability hashes; redact capabilities from status, logs, prompt archives and public run records. Child launch clears stale runtime identity and injects only the new attempt's context. Same-OS-user access is not an OS sandbox: do not claim these cooperative capability checks isolate a malicious local process that can read the user's files.

Launch preambles include the exact Drogon CLI executable on the execution host, run/task/dispatch identity, scope, reporting commands, no nested workers, and the task spec. Never paste shell strings built from task text into a terminal; use the existing validated harness argv plan. Explicit unattended permissions remain per invocation. Readiness must distinguish spawn, TUI output, worker handshake and actual model response.

## Acceptance before claiming native dogfooding

- Deterministic store tests: dependency gating, conflicting request reuse, duplicate dispatch/report, invalid actor/cross-run injection, stale attempt, cancellation/report race, whole-batch ack and stale consumer generation.
- Failure tests: restart between admission and attachment, report saved but response lost, lost contact while stopping, and persistence failure after a child exists. Preserve evidence and owned handles; do not blindly retry a spawn.
- Real native CLI + installed harness: one bounded development task writes only its assigned fixture, reports through Drogon, and yields a result independently checked by the coordinator. Do not count a model echo or a synthetic success event as that task.
- Reload Electron while the task is running, recover the same run/session/incarnation and inspect the same durable messages and evidence.
- Prove exact release and no extra worker sessions afterward. Keep a report that distinguishes artifact acceptance from process exit and records binary/source revisions.
- Repeat with an induced task failure and a replacement attempt; a late original report must be refused.

The matched Mentu experiment remains a later, separate Pi + DGX Spark-only benchmark. Developing the coordinator with Sonnet/GLM does not authorize cloud inference for that experiment.
