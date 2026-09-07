# V5 checkpoint 010 — PR10 reconciliation, withDaemon diagnostics, Windows CI wiring

Vertical / scope / base SHA / head SHA / branch / worktree:
V5 platform/release. Scope: merge origin/main (PR10 squash 3a52b46) into
PR15 without regressing ROOT-integrated fixes; fresh leaf audit/fix of the
withDaemon teardown diagnostics; Windows CI acceptance wiring. Base
3a17a17 (pre-merge HEAD). Head: this commit. Branch
codex/vertical-05-platform-release. Worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-05-platform-release.

Capabilities and original contract/test IDs:
WP-ENG-NATIVE (Windows runner), WP-SUP-CI (evidence), WP-SUP-SCRIPTS
(runners), E5 AO set (decisions only, unchanged). No paid harness; no full
cargo/desktop sweep (ROOT running combined).

Changed paths; shared-file reconciliation:
Merge origin/main 3a52b46 (V1-V4 checkpoints, ROOT boundary notes,
windows CI daemon build, bot.create/files.* core routes). Two conflicts,
both resolved preserving both sides, no behavior edits: lib.rs takes
main's bot_mutation_rpc/workspace_file_rpc/workspace_files additions
(V5 adds nothing there); .preflight/nr1-notice-corpus.json takes main's
trailing-newline form (content otherwise byte-identical). All other V5
overlap files (checkpoints 001-005/007-008, runbook, e5-decision-prep,
seam plan, verifier + transport scripts) were already byte-identical:
PR10 snapshotted them unchanged.
Leaf A (owned file only): scripts/windows-named-pipe-acceptance.test.mjs,
two diagnostic-masking fixes, message-only, no control-flow change:
shutdown-attempt error kept as shutdownAttemptError and surfaced, plus
stopAcceptanceProcess's own result.error surfaced as stopDetail, in the
fixture-preservation log + loud failure.
Leaf B (owned file only): .github/workflows/foundation.yml, one new
windows-compilation step 'Windows named-pipe cross-process acceptance'
running `node --test scripts/windows-named-pipe-acceptance.test.mjs`
immediately after the native-binary build step, ungated, timeout unchanged.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Coordinator-observed on merged tree, pinned Node24 v24.19.0, darwin:
cargo check -p drogon-core --locked --offline -> exit 0 (merged lib.rs
compiles with main's new modules). node --test
scripts/verify-final-bundle-notices.test.mjs -> exit 0, 24/24 pass (E5
gate preserved). node --test scripts/windows-native-transport.test.mjs
-> exit 0, 21 pass / 7 honest win32 skips. node --test
scripts/windows-named-pipe-acceptance.test.mjs -> exit 0, 1 NOT-RUN pass
/ 6 win32 skips, identical before/after Leaf A. node --test
scripts/acceptance-process.test.mjs -> exit 0, 6/6 pass. YAML_PARSE_OK
for foundation.yml with the new step listed in job order.

Integrated/rendered/platform evidence; exact package identity if applicable:
None new. No Windows host run here; no Windows pass claimed.

Unverified, missing, source defects, deliberate approved deltas:
Real win32 behavior of the acceptance suite (including the two newly
surfaced error paths) remains UNVERIFIED; the new CI step's outcome is
pending observation of a real windows-2022 run — wiring is not a result.
drogond's Windows listener remains V1-owned; E5 AO-RIGHTS/AO-RECORDINGS/
AO-NOTICES/AO-SERVICE decisions remain with Carlos. opencode agent
rejected launch-time --model in Orca (invalid_argument), so both leaves
ran claude/sonnet/high with effective launch verified, no substitution.

Dependencies requested; next bounded checkpoint:
ROOT: observe windows-2022 result for the new acceptance step; own merge
order of PR15; combined-head acceptance. V5 proposes no further edits
pending that signal.

Owned processes: Run run_842f2b73a517. Leaf A task_01d0efb3f4fd /
ctx_f7c4609b7e5f claude/sonnet/high completed, terminal released.
Leaf B task_f3b1c5f8383d / ctx_4935cc75043a claude/sonnet/high
completed, terminal retained (user_takeover, no live process). Zero
active leaves.

Rollback; data/credentials/privacy check:
Rollback: revert the two leaf commits (message-only test diagnostics;
CI yaml step). Merge resolution is additive on both sides. No data,
credentials, sessions, installs, provisioning, or publishing touched.
Services and user data untouched.

Ready for independent review: yes (not self-accepted).
