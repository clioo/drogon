# V5 checkpoint 007 — scheduled automationId wire projection (bots array)

Vertical / scope / base SHA / head SHA / branch / worktree:
V5 platform/release, same narrow bot.snapshot ownership. Scope: additive
camelCase automationId projection for scheduled triggers (history entries
+ bots-array responsibilities). Base
596ddbd9e8b6fdc5d5fa26616479e910b34ba604. Head: this commit. Branch
codex/vertical-05-platform-release. Worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-05-platform-release.

Capabilities and original contract/test IDs:
WP-CAP-BOTS (bot.snapshot boundary only). Follows checkpoint-006 lane.
ROOT repro tests/native_bot_wire.rs (cce319e, ROOT-owned) consumed
read-only for verification, never edited, never committed — ROOT
integrates it; analogous regression lives in native_bot_snapshot.rs.

Changed paths; shared-file patch requested:
Modified: crates/drogon-core/src/bot_snapshot_rpc.rs +
tests/native_bot_snapshot.rs ONLY (J history projection + K bots-array
projection). No shared-file patch; no storage/protocol/migration/wire
removals; automation_id retained alongside automationId; DB untouched.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
RED (leader-observed): staged ROOT repro failed 2 pass / 1 fail
(scheduled_snapshot camel contract); J's history-only fix left it RED —
reported honestly, then fixed at the diagnosed location. Leader-observed
GREEN: cargo test -p drogon-core --locked --test native_bot_wire → 3/3
pass exit 0; --test native_bot_snapshot → 12/12 pass exit 0; cargo clippy
-p drogon-core --locked --tests -- -D warnings exit 0; cargo fmt
--check -p drogon-core exit 0. Projection is in-place JSON post-processing
(non-matching shapes skipped); final exact byte check covers projected
bytes; fence/malformed paths untouched.

Integrated/rendered/platform evidence; exact package identity if applicable:
None new. 83e9eca untouched. No harness/packaging run.

Unverified, missing, source defects, deliberate approved deltas:
P2-1 bot-id scope with V4. Windows real-pipe behavior unverified. E5,
harness receipts, combined-head acceptance pending ROOT.

Dependencies requested; next bounded checkpoint:
None. Next: ROOT integration; V1 seam relay; PR15 merge order.

Owned processes: session/incarnation/host, settlement/release receipts:
Child Run run_3de36bede2a3. Leaf J task_0de6fa70ed66/ctx_cc98da687b6a
and leaf K task_4972b722c05d/ctx_c2e044a77e3e depth 2 completed,
released (transcripts archived). Terminal term_b8dad58b retained idle
reusable. Zero active leaves.

Rollback; data/credentials/privacy check:
Rollback: revert this commit (lane baseline stays). No data, credentials,
sessions, installs, provisioning, or publishing touched.

Ready for independent review: yes (not self-accepted).
