# V5 checkpoint 005 — second review round: Windows-path/hang fixes + PR

Vertical / scope / base SHA / head SHA / branch / worktree:
V5 platform/release. Scope: ROOT e110500 review items (platform endpoints,
bounded double-listen, entrypoint spawn check, setup-blocked wording) + V5
PR. Base 596ddbd9e8b6fdc5d5fa26616479e910b34ba604. Head: this commit.
Branch codex/vertical-05-platform-release. Worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-05-platform-release.

Capabilities and original contract/test IDs:
WP-ENG-NATIVE (runner only, infrastructure), WP-SUP-SCRIPTS. No production
changes; V1 files closed.

Changed paths; shared-file patch requested:
Modified: scripts/windows-native-transport.mjs + .test.mjs (leaf G,
Sonnet; 136 insertions, 34 deletions). New: this checkpoint file. PR:
https://github.com/clioo/drogon/pull/15 (base main, head
codex/vertical-05-platform-release). CI patch still proposal-only.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Leader-observed GREEN (this worktree, Node24): node --test
scripts/windows-native-transport.test.mjs → tests 28 / pass 21 / fail 0 /
skipped 7 (win32-only) / exit 0 in ~0.2s, no hangs; tree clean.
mintOwnedEndpoint/attemptListen markers and setup-blocked header verified
in file. Unconditional cleanup tests now platform-appropriate (run both
platforms); double-listen closes second server on unexpected success;
entrypoint proven via bounded spawn check on win32.

Integrated/rendered/platform evidence; exact package identity if applicable:
None new. Real win32 execution awaits ROOT CI apply of the preserved patch.

Unverified, missing, source defects, deliberate approved deltas:
Windows real-pipe behavior unverified, not waived. Harness seed receipts,
E5 decisions, combined-head package acceptance pending ROOT.

Dependencies requested; next bounded checkpoint:
None. Next: CI win32 leg; ROOT integration of PR 15; combined-head
package acceptance.

Owned processes: session/incarnation/host, settlement/release receipts:
Child Run run_3de36bede2a3. Leaf G task_1d70538e74ae/ctx_5305cc9f1667
depth 2 completed, released (transcript archived). Terminal term_b8dad58b
retained idle reusable. Zero active leaves.

Rollback; data/credentials/privacy check:
Rollback: revert the commit. No data, credentials, sessions, installs,
provisioning, or publishing touched.

Ready for independent review: yes (not self-accepted).
