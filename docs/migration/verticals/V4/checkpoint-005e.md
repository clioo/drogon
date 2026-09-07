# V4 checkpoint-005e: bot.create ledger-delegated module (B6)

Vertical / scope / base SHA / head SHA / branch / worktree:
V4 Capabilities on codex/vertical-04-capabilities, worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-04-capabilities.
Follows checkpoint-005d (3adc0e7). B6 scope only (approved bot.create).

Capabilities and original contract/test IDs:
WP-CAP-BOTS Create->View path (producer side; registration + Engine
adapter + validator ROOT-owned).

Changed paths; shared-file patch requested:
- crates/drogon-core/src/bot_mutation_rpc.rs (new, provisional #[path]
  seam like bot_run_rpc): strict outer parse (unknown-field deny incl.
  smuggled params requestId; envelope request_id explicit param), FULL
  parse_bot_create body only, workspace-ownership tripwire lookup,
  botId as-given-or-minted, born-empty enforcement, frozen codes only,
  CreateLedger delegation trait, run_atomic-compatible DB-only body
  (never reacquires/locks/begins), no seam parameter (cannot spawn).
- crates/drogon-core/tests/native_bot_create.rs (7 tests: strict/shape/
  partial/born denials, minted-id exact-DTO replay via double with one
  bot row, changed-params conflict, foreign-scope no-leakage,
  worker-denied no-admission, no-DDL guard).
- This doc. REQUESTED (reported, not applied): CreateLedger adapter
  hunk (fingerprint-accepting admit + Engine wrapper sequence) and
  registration cleanups (crate:: swap, owned_path/error-fn reuse, seam
  swap). No DDL, no new tables, no new codes.

Baseline evidence; behavioral RED (honestly labeled); GREEN + counts:
Genuine RED (break born-empty -> test fails on non-null session;
restore). Leader independently re-ran: native_bot_create 7/7, full
crate 35 suites 0 fail, clippy -D warnings 0 errors, fmt clean. Zero
CREATE TABLE refs in module.

Integrated/rendered/platform evidence; exact package identity if applicable:
None (unregistered module; bridge/validator ROOT-owned).

Unverified, missing, source defects, deliberate approved deltas:
Ledger-backed end-to-end replay untested at this layer (ROOT wiring
tests per hunk plan); no spawn path exists by construction.

Dependencies requested; next bounded checkpoint:
None queued — V4 domain tracks complete pending ROOT integration
(bridge/mount/merge). Awaiting direction; vertical remains owned.

Owned processes: session/incarnation/host, settlement/release receipts:
Run run_5040a80fa6dd. B6 ctx_fda0c3f90ef5 accepted after independent
re-run; first worker_done rejected on a truncated sender handle, worker
re-sent cleanly on instruction, dispatch completed, terminal
retained-external (GLM live-idle). All depth 2.

Rollback; data/credentials/privacy check:
Revert this commit to return to 3adc0e7. No credentials, network, mic,
recordings, real accounts, or source writes.

Ready for independent review: yes (not self-accepted).
