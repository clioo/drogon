# V5 checkpoint 008 — consolidated budget: per-reference accounting

Vertical / scope / base SHA / head SHA / branch / worktree:
V5 platform/release, same narrow bot.snapshot ownership. Scope: remove
redundant history automationId projection; per-reference linked-budget
accounting with UTF-8 byte lengths; 200KBx4 regression. Base
596ddbd9e8b6fdc5d5fa26616479e910b34ba604. Head: this commit. Branch
codex/vertical-05-platform-release. Worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-05-platform-release.

Capabilities and original contract/test IDs:
WP-CAP-BOTS (bot.snapshot boundary only). Consolidates prior ctx guidance;
44034a3 accounting superseded by this commit. ROOT 90efafa wire blob
consumed read-only (RED 3/1 observed, then 4/4 GREEN), never edited,
never committed — ROOT integrates it.

Changed paths; shared-file patch requested:
Modified: crates/drogon-core/src/bot_snapshot_rpc.rs +
tests/native_bot_snapshot.rs ONLY. No shared-file patch; no
storage/protocol/migration/wire changes; DB untouched; bots-array trigger
projection (3fe9076) kept.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
RED (leader-observed on staged ROOT blob): 3 pass / 1 fail (budget test,
storage_error instead of too_large). Leader-observed GREEN: cargo test
-p drogon-core --locked --test native_bot_wire → 4/4 pass exit 0;
--test native_bot_snapshot → 12/12 pass exit 0; cargo clippy -p
drogon-core --locked --tests -- -D warnings exit 0; cargo fmt
--check -p drogon-core exit 0. Design: JOIN per-referencing-row linked
sums + repeated-responsibility budget, LENGTH(CAST(... AS BLOB)),
pre-materialization, same snapshot_too_large, final exact cap kept.

Integrated/rendered/platform evidence; exact package identity if applicable:
None new. 83e9eca untouched. Activation per ROOT (4/4 GREEN met).

Unverified, missing, source defects, deliberate approved deltas:
P2-1 bot-id scope with V4. Windows real-pipe behavior unverified. E5,
harness receipts, combined-head acceptance pending ROOT.

Dependencies requested; next bounded checkpoint:
None. Next: ROOT integration/activation; V1 seam relay; PR15 merge order.

Owned processes: session/incarnation/host, settlement/release receipts:
Child Run run_3de36bede2a3. Leaf L task_6c513ec75629/ctx_af18ec0087b1
depth 2 completed, released (transcript archived). Terminal term_b8dad58b
retained idle reusable. Zero active leaves.

Rollback; data/credentials/privacy check:
Rollback: revert this commit. No data, credentials, sessions, installs,
provisioning, or publishing touched.

Ready for independent review: yes (not self-accepted).
