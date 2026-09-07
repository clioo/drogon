# V4 checkpoint-005a: responsibility projection from accepted row (history fix)

Vertical / scope / base SHA / head SHA / branch / worktree:
V4 Capabilities on codex/vertical-04-capabilities, worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-04-capabilities.
Follows checkpoint-004 (a56c6f0). INDEPENDENT history fix only (per ROOT:
ship A5b independently of A6b): A5b projection correction. Excludes
active A6b bot.run WIP and queued W-fence / bot.create work.

Capabilities and original contract/test IDs:
WP-CAP-AUTO runner record path correctness (ROOT-gating regression).

Changed paths; shared-file patch requested:
- crates/drogon-core/src/automations/runner.rs: record path derives the
  ResponsibilityRun projection from the ACCEPTED durable AutomationRun row
  (responsibility_projection fn): stored Completed always projects Exited,
  never Live/Unverifiable; dispatched_at preserves existing first
  (existing.or(new)); explicit observed_at: f64 param distinct from
  plan.attempt_at, threaded into AutomationRun.observed_at.
- crates/drogon-core/tests/automation_runner.rs: 26 -> 28 (live->exited->
  stale-live + live->exited->stale-unverifiable, asserting BOTH the
  AutomationRun row and the ResponsibilityRun row via history_for_bot,
  dispatched_at frozen, observed_at == injected times).
No shared files touched; no patch requested.

Baseline evidence; behavioral RED (honestly labeled); GREEN + counts:
Genuine RED vs pre-fix implementation (file-copy swap, no git mutation):
stale-live-after-exited assertion fails left Some(Live) vs right
Some(Exited); fix restored byte-identical -> 28/28. Leader independently
re-ran: automation_runner 28/28, full crate 34 suites 0 fail (incl. A6b
in-progress native_bot_run 7/7), clippy -D warnings clean, fmt clean.
Code-verified: responsibility_projection reads the accepted row only.

Integrated/rendered/platform evidence; exact package identity if applicable:
None (domain logic; bridge ROOT-owned).

Unverified, missing, source defects, deliberate approved deltas:
No live-Engine dispatch exercised; occurrence counters untouched (kept).

Dependencies requested; next bounded checkpoint:
W-fence (W1/W2/W3, approved) then A6b bot.run review -> checkpoint-005b;
bot.create implementation after (approved, queued).

Owned processes: session/incarnation/host, settlement/release receipts:
Run run_5040a80fa6dd. A5b ctx_ded2ae2d1465 accepted, released/closed.
A6b ctx_911aed7e3130 active (already converged to the 4-arg call site).
All depth 2.

Rollback; data/credentials/privacy check:
Revert this commit to return to a56c6f0. No credentials, network, mic,
recordings, real accounts, or source writes.

Ready for independent review: yes (not self-accepted).
