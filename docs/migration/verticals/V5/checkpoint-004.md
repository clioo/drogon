# V5 checkpoint 004 — ROOT P1 review corrections: fixed runner + real binding

Vertical / scope / base SHA / head SHA / branch / worktree:
V5 platform/release. Scope: ROOT P1 corrections to the Windows pipe
runner (isMain, sendRaw timeout, exact socket cleanup, failure probes,
reworded claims, extended CI patch) + new vitest suite binding the REAL
native-client exports. Base 596ddbd9e8b6fdc5d5fa26616479e910b34ba604.
Head: this commit. Branch codex/vertical-05-platform-release. Worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-05-platform-release.

Capabilities and original contract/test IDs:
WP-ENG-NATIVE (Windows transport seam, infrastructure-only), WP-ENG-INSTALL
/ WP-SUP-SCRIPTS (runners), WP-ENG-RUNTIME package-admission (unchanged).
V1 Sonnet Windows implementation active (ctx215670a8de05, via ROOT); V5
contact stays through ROOT relay only. V1 retains production
transport/client; no production files touched.

Changed paths; shared-file patch requested:
Modified: scripts/windows-native-transport.mjs + .test.mjs (leaf F1,
Sonnet). New: apps/desktop/src/main/
windows-native-transport-acceptance.test.ts (leaf F2, GLM; ROOT-authorized
V5-scope file, read-only import of V1 exports). Modified:
docs/migration/verticals/V5/foundation-windows-vitest.patch (standalone
probe step added; leader-verified `git apply --check` clean, NOT applied).
New: this checkpoint file. Shared request stands: ROOT applies the patch;
combined-head package acceptance next once integration lands.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
RED: old isMain never matched on win32 paths (regression test proves);
prior sendRaw could hang (leaf's own hang found and fixed pre-GREEN).
Leader-observed GREEN (this worktree, Node24): node --test
scripts/windows-native-transport.test.mjs → tests 27 / pass 21 / fail 0 /
skipped 6 (win32-only) / exit 0; node scripts/windows-native-transport.mjs
→ verdict unverified exit 0 (probe runs, honest skip); apps/desktop vitest
windows-native-transport-acceptance.test.ts → 11/11 pass exit 0 (real
exports: formula, envelope, 1 MiB refusal, POSIX present/absent, win32
gate-state). Tree clean after each run. Mirror comments now state
fixture scaffolding pinned to real vectors, never drogond proof.

Integrated/rendered/platform evidence; exact package identity if applicable:
None new. Real win32 execution only on CI after ROOT applies patch. No
partial-vertical install.

Unverified, missing, source defects, deliberate approved deltas:
Windows real-pipe behavior unverified, not waived (6 + 0 skips as labeled).
Windows error-code mapping still open (runner reports honestly on CI).
Harness lanes lack seed receipts. E5 decisions pending Carlos/ROOT.

Dependencies requested; next bounded checkpoint:
None. Next: CI win32 leg; combined-head package acceptance per ROOT;
authorized harness receipts.

Owned processes: session/incarnation/host, settlement/release receipts:
Child Run run_3de36bede2a3. Leaf F1 task_83fc50f5fb98/ctx_e4baf1b285bd
depth 2 completed, released (transcript archived). Leaf F2
task_dfd67114ea2f/ctx_208b14f6ee9a depth 2 completed, terminal
term_b8dad58b retained (external, idle, reusable). Zero active leaves.

Rollback; data/credentials/privacy check:
Rollback: revert this commit. No data, credentials, models, sessions,
installs, provisioning, or publishing touched. Canonical pipe never probed.

Ready for independent review: yes (not self-accepted).
