# V4 checkpoint-005c: bot.run ledger-delegated module (A6c)

Vertical / scope / base SHA / head SHA / branch / worktree:
V4 Capabilities on codex/vertical-04-capabilities, worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-04-capabilities.
Follows checkpoint-005b (0d0dedc). A6c scope only: ledger redirect +
contract alignment. A5c-atomicity and bot.create queue separately.

Capabilities and original contract/test IDs:
WP-CAP-AUTO bot.run bridge module (producer side; registration + Engine
wiring + validator ROOT-owned).

Changed paths; shared-file patch requested:
- crates/drogon-core/src/bot_run_rpc.rs (new, provisional: NOT in lib
  tree, bound via test #[path] seam until ROOT registers): strict parse
  (requestId envelope-explicit, params-requestId denied), scope/host
  tripwires, explicit reason enum, worker-denied auth path, pure
  parse/fingerprint/build_receipt functions, ReceiptLedger delegation
  trait, LedgerDouble only in tests. NO DDL, NO receipts table (deleted),
  no persistence invented.
- crates/drogon-core/tests/native_bot_run.rs (9 tests incl. no-DDL guard
  asserting the table absent, envelope/deny/fingerprint/structured
  shapes/observedAt/numeric-recordedAt pins, ledger-double replay +
  conflict + pass-through).
- This doc. REQUESTED (reported, not applied): narrow adapter hunk —
  RequestLedger.run_with_fingerprint(db, request_id, method, fingerprint,
  params, work) with internals private; Engine wrapper wiring
  auth->admit->lock/prepare->drop->dispatch->relock->record->finish;
  registration cleanups (crate:: swap, owned_path/rfc3339/error-fn reuse,
  test seam swap); ROOT-wiring E2E replay test plan. Full hunk text in
  the A6c completion report (Run run_5040a80fa6dd archive).

Baseline evidence; behavioral RED (honestly labeled); GREEN + counts:
Genuine RED (targeted break/restore): re-admitting params requestId
fails the strict test; flattening structured refusal fails the shape
test; reintroducing persistence fails the no-DDL guard. Leader
independently re-ran: native_bot_run 9/9, full crate 34 suites 0 fail,
clippy -D warnings 0 errors, fmt clean. Zero CREATE TABLE/table refs in
module; the 2 test refs are the absence guard.

Integrated/rendered/platform evidence; exact package identity if applicable:
None (unregistered module; bridge/validator ROOT-owned).

Unverified, missing, source defects, deliberate approved deltas:
Ledger-backed end-to-end replay untested at this layer (ROOT wiring
tests per hunk plan); successful-dispatch paths via fake seam only (no
real spawn ever); observedAt = poll-time now_unix (documented; finer
granularity needs the async scheduler loop).

Dependencies requested; next bounded checkpoint:
A5c atomicity (approved design, storage extraction) + bot.create
(approved scope) -> checkpoint-005d.

Owned processes: session/incarnation/host, settlement/release receipts:
Run run_5040a80fa6dd. A6b ctx_911aed7e3130 superseded by A6c (same
terminal, ownership transferred); A6c ctx_6c8187bbdc00 accepted,
retained-external (GLM terminal live-idle). All depth 2.

Rollback; data/credentials/privacy check:
Revert this commit to return to 0d0dedc. No credentials, network, mic,
recordings, real accounts, or source writes.

Ready for independent review: yes (not self-accepted).
