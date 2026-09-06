# E3 platform candidate — independent verification checkpoint

2026-09-06. This is a provenance and identity checkpoint, **not acceptance of the complete platform source audit or product parity**. Source pin: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.

## Verified by root

- Frozen candidate `audit-closure/e3-bridge/result-platform/contracts.json`: SHA-256 `5269e951e15986e04f2ed0a2373b943d9c4a522389bcb308bf4d00d451cd9093`. Its report: `d2c0d0af5a50dbb9785407378ddbe7a017f369dbb9e6b7b094e0cad4b2e67471`.
- All six input hashes match current files. The source checkout HEAD matches the declared pin.
- All 342 evidence records match current whole-file and indicated range hashes: 164 parent observations, 126 receiver records, 11 original assertion records and 41 leaf records, spanning 200 distinct files. Matching hashes establish provenance, not that root read every body or executed it.
- Exact 21-group / 126-method partition: no missing, extra or duplicate method identities. All receiver names and normalized `DR-` group identities match their original receiver pointers. Original test, acceptance, fixture and ownership pointers resolve.
- All 61 reused Skills range hashes match. All 14 reused rule IDs and behavior strings match their original referenced rules. This preserves their documented limits, not unlimited transitive extractor or placement coverage.
- All 16 allocation pointers retain their original file counts; the inherited queues retain 33 original test records and 70 execution entries. All 47 inherited gate IDs match their references. The global 9,037 original test-file allocations remain unchanged.

The verifier distinguishes a receiver's `name` from the candidate's `method`, normalizes the candidate's `DR-` prefix, and treats reused Skills `sha256` as a **range** hash rather than a whole-file hash. Preliminary mismatches from those verifier assumptions were resolved; they were not source defects.

## Independent source samples

Root read the complete `runtime-subscription-registry.ts`, `mobile-notification-replay.ts` and `runtime/rpc/methods/notifications.ts` bodies. Notification replay is an in-memory, bounded sequence/epoch buffer, not a durable or unbounded delivery guarantee. A different epoch returns the retained buffer; legacy callers without an epoch retain sequence-only behavior. The registry's cleanup can complete asynchronously, reject and retain the current registration for retry. Notification unsubscribe directly requests cleanup and returns `{ unsubscribed: true }`; it neither verifies connection ownership at this receiver nor waits for cleanup to settle. Stream cleanup can be interrupted by listener/emit exceptions.

The source comments' repeated-watermark/idempotency wording does not imply that subsequent calls return an immutable set while new notifications arrive, or that a client's failure to advance its watermark cannot replay an event. Preserve the actual buffer predicate and client deduplication obligations.

Root's separate committed `rate-limit-source-review.md/json` covers the local account refresh service, its unchanged 17-case original baseline and the separately reproduced `RATE-QUEUE-001` source defect. This checkpoint executes no new tests and claims no raw provider parser coverage.

## Remaining acceptance and coordination

The frozen platform candidate explicitly leaves eight source residuals. Its original Task `task_d472a9fbf442` / Dispatch `ctx_76d7be38749c` reported failed rather than claiming closure. Fresh audit-only Task `task_487675cb5877` / Dispatch `ctx_9b21fa561b55` owns finite final-local joins; account-service evidence is root-owned, speech internals are E5-owned, and terminal/worktree joins remain assigned to their respective leads. The six `P-EXEC-*` obligations and all inherited BM/R/F/D gates remain outstanding at their required execution phase.

Consumer Task `task_d34d2e7f2d03` / Dispatch `ctx_2e817dfed909` delivered four candidate files at 09:45:21 UTC. Root officially released it with receipt `0c8b1183-e94b-4240-a6d9-3cc797380e9c`: `retained`, `external_terminal`, `processAction: none`. This does not assert process exit. Its candidate is awaiting independent review; it does not close E3. Four audit leads remain active after this settlement.

Audit remains **10/12 = 83.3%, medium-low confidence, delta 0**. E3/E5 stay open. The user reaffirmed that Astra area leads are only for audit; after complete source acceptance, actual Sol leads will coordinate implementation workers. Root retains orchestration, integration and independent verification. No implementation phase or model substitution was started by this checkpoint. The flexible 24-hour full-fidelity target remains high risk; there is no defensible completion ETA.
