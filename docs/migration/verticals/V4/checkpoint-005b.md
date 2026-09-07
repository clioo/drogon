# V4 checkpoint-005b: scope-safe history write fence (W1/W2/W3)

Vertical / scope / base SHA / head SHA / branch / worktree:
V4 Capabilities on codex/vertical-04-capabilities, worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-04-capabilities.
Follows checkpoint-005a (3406c68). FENCE scope only (V5 P2-1 closure):
W1 create-deny, W2 partial-stamp fail-closed, W3 dedup restamp guard.
Excludes active A6c bot.run ledger redirect (separate checkpoint).

Capabilities and original contract/test IDs:
WP-CAP-BOTS history identity (V5 P2-1). No source ports; prior evidence
stands.

Changed paths; shared-file patch requested:
- crates/drogon-core/src/bots/storage.rs ONLY: (W1) create_bot probes
  bot_responsibility_runs and denies ANY id reuse with retained rows via
  new BotIdCollision variant (mirrors AutomationIdCollision; same-scope
  recreate denied too — legacy origin indistinguishable); (W2) envelope
  with exactly one of scope_host/scope_folder -> PartialScopeStamp
  variant (fail closed, never legacy); (W3) dedup-merge refuses
  cross-scope restamp with OwnershipViolation, never adopts incoming
  stamps onto unstamped legacy rows; legacy-rule + residual docs.
- crates/drogon-core/tests/bot_history_scope.rs: 3 -> 10 (deny
  same/cross-scope, partial fail-closed, dedup replay refused, legacy
  visibility unchanged, disk-evidence row counts).
- This doc. No migration/DDL/backfill; no shared files; no patch requested.

Baseline evidence; behavioral RED (honestly labeled); GREEN + counts:
Genuine RED leader-proven: probe neutralized (AND 1=0, still compiles)
-> exactly the 2 create-deny tests fail on assertion; byte-exact restore
-> 10/10. Worker RED (file-copy swap per item) consistent. Leader
re-ran: bot_history_scope 10/10, bot_storage 40/40, fmt clean on both
files, clippy clean on W scope (the single clippy error in-tree sits in
A6c-owned native_bot_run, owned by that track). Variants + probe +
guards code-verified.

Integrated/rendered/platform evidence; exact package identity if applicable:
None (storage domain; bridge ROOT-owned).

Unverified, missing, source defects, deliberate approved deltas:
RESIDUAL (documented in module doc): pre-fence databases already
coexisting x-in-A-with-runs + x-in-B still show A legacy rows under B;
closable only by backfill (not proposed). Legacy unstamped rows stay
visible under bot-id match (documented rule).

Dependencies requested; next bounded checkpoint:
A6c bot.run ledger redirect -> checkpoint-005c; A5c atomicity fix after W
handoff (approved design) on next free slot; bot.create implementation
after (approved, queued).

Owned processes: session/incarnation/host, settlement/release receipts:
Run run_5040a80fa6dd. W ctx_4f1e4ad1be23 accepted, released/closed.
A6c ctx_6c8187bbdc00 active. All depth 2.

Rollback; data/credentials/privacy check:
Revert this commit to return to 3406c68. No credentials, network, mic,
recordings, real accounts, or source writes.

Ready for independent review: yes (not self-accepted).
