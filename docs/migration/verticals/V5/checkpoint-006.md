# V5 checkpoint 006 — bot.snapshot P2-2 correction lane (narrow, for integration)

Vertical / scope / base SHA / head SHA / branch / worktree:
V5 platform/release, ROOT-authorized narrow lane on transferred files.
Scope: P2-2 bounded materialization + auth/locale/too-large regressions
for bot.snapshot. Base 596ddbd9e8b6fdc5d5fa26616479e910b34ba604. Head:
this commit (correction 44034a3 on prerequisite baseline; see log).
Branch codex/vertical-05-platform-release. Worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-05-platform-release.

Capabilities and original contract/test IDs:
WP-CAP-BOTS (bot.snapshot RPC, transferred narrowly; V4 retains bot-id
scope P2-1 and storage ownership). Follows V5 review ab340b9 (no P1,
2 P2 + 5 NIT). No wire fields, no SQL migration, no V4-file edits.

Changed paths; shared-file patch requested:
Commit 1 (baseline, binding, no new logic): exact 8f21da7 blobs for
crates/drogon-core/src/bot_snapshot_rpc.rs +
tests/native_bot_snapshot.rs, plus approved prerequisite hunks (lib.rs
mod + dispatch arm 2 lines; workspace.rs owned_path 30 lines).
Commit 2 (correction, this lane): the same two files only (273
insertions, 5 deletions). No shared-file patch requested; ROOT integrates
only the correction commit.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Tests-first observed: 6 new regression tests RED on old code, GREEN after.
Leader-observed GREEN: cargo test -p drogon-core --locked
--test native_bot_snapshot → 10/10 pass exit 0; cargo clippy -p
drogon-core --locked --tests -- -D warnings exit 0; cargo fmt
--check -p drogon-core exit 0. Design: COUNT/SUM(LENGTH) preflight (5000
rows, MAX_FRAME_BYTES/2 incl linked automation payloads, saturating math,
scoped subselects) runs AFTER the owned_path fence, fails with existing
snapshot_too_large (no truncate); final exact check kept; malformed-store
and fence paths untouched. Observation (not blocker): preflight reads
sibling tables via SQL, coupling to their schema without touching V4 files.

Integrated/rendered/platform evidence; exact package identity if applicable:
None new. 83e9eca untouched. No harness/packaging run in this lane.

Unverified, missing, source defects, deliberate approved deltas:
P2-1 bot-id scope stays with V4. Windows real-pipe behavior unverified.
E5 decisions, harness receipts, combined-head acceptance pending ROOT.

Dependencies requested; next bounded checkpoint:
None. Next: ROOT integration of correction commit; V1 seam relay; PR15
merge order per ROOT.

Owned processes: session/incarnation/host, settlement/release receipts:
Child Run run_3de36bede2a3. Leaf I task_077589c54c9d/ctx_1d7b58d43696
depth 2 completed, released (transcript archived). Terminal term_b8dad58b
retained idle reusable. Zero active leaves.

Rollback; data/credentials/privacy check:
Rollback: revert correction commit (baseline stays for ROOT). No data,
credentials, sessions, installs, provisioning, or publishing touched.

Ready for independent review: yes (not self-accepted).
