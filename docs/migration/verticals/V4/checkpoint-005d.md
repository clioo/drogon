# V4 checkpoint-005d: atomic both-row record transaction (A5c)

Vertical / scope / base SHA / head SHA / branch / worktree:
V4 Capabilities on codex/vertical-04-capabilities, worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-04-capabilities.
Follows checkpoint-005c (580e604). A5c scope only (ROOT-gating
atomicity correction). Excludes active B6 bot.create WIP.

Capabilities and original contract/test IDs:
WP-CAP-AUTO runner record atomicity (ROOT-gating finding on 3406c68).

Changed paths; shared-file patch requested:
- crates/drogon-core/src/automations/runner.rs: upsert returns explicit
  AcceptedOutcome {AcceptedNew|KeptExisting|RejectedStale}; projection
  switches on it (RejectedStale -> existing responsibility row kept
  byte-identical, no write); record path opens ONE BEGIN IMMEDIATE tx;
  session/incarnation fence (mismatch -> OwnershipViolation, same
  request id never overwrites linkage).
- crates/drogon-core/src/bots/storage.rs: NARROW extraction only —
  pub(crate) record_responsibility_run_in_tx reusing the merge body
  untouched; public wrapper keeps begin/commit. Nothing else.
- crates/drogon-core/tests/automation_runner.rs: 28 -> 31 (stale-
  nonterminal preservation, session-mismatch fence, injected
  mid-transaction failure proving both-rows rollback).
- This doc. No DDL/migration/duplication; no patch requested.

Baseline evidence; behavioral RED (honestly labeled); GREEN + counts:
Genuine RED leader-proven: stale-skip neutralized (if true, still
compiles) -> stale-nonterminal test fails on assertion; byte-exact
restore -> 31/31. Worker file-copy-swap RED consistent. Leader
independently re-ran: automation_runner 31/31, full crate 34 suites
0 fail, clippy -D warnings 0 errors, fmt clean. Design code-verified
(single tx, AcceptedOutcome switch, fence).

Integrated/rendered/platform evidence; exact package identity if applicable:
None (domain logic; bridge ROOT-owned).

Unverified, missing, source defects, deliberate approved deltas:
No live-Engine dispatch exercised; occurrence counters untouched (kept).

Dependencies requested; next bounded checkpoint:
B6 bot.create review -> checkpoint-005e.

Owned processes: session/incarnation/host, settlement/release receipts:
Run run_5040a80fa6dd. A5c ctx_29251d578c24 accepted, released/closed.
B6 ctx_fda0c3f90ef5 active (was briefly idled on a misread revoked
heartbeat for the prior dispatch; corrected terminal-direct, dispatch
verified active, work resumed). All depth 2.

Rollback; data/credentials/privacy check:
Revert this commit to return to 580e604. No credentials, network, mic,
recordings, real accounts, or source writes.

Ready for independent review: yes (not self-accepted).
