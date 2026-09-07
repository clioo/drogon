# V2 checkpoint-006: probe lifecycle corrections per ROOT review

Vertical / scope / base SHA / head SHA / branch / worktree:
V2 desktop/settings; committed-probe hardening only (no product
changes). Base 5800537; head this commit; branch
codex/vertical-02-desktop-settings; worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-02-desktop-settings.

Capabilities and original contract/test IDs:
ROOT probe review (session cleanup + portable paths). Handoff test
gate: no leaked shells behind PASS; explicit platform gating.

Changed paths; shared-file patch requested:
docs/migration/verticals/V2/probes/keyboard-focus-cdp.mjs (M):
fileURLToPath ROOT resolution (no .pathname); win32 drogond.exe
selection; SHELL only non-win32; explicit UNVERIFIED + exit 2 on
win32; cleanupSessions stops every probe session by exact
id+incarnation via window.drogon.stop, asserts verdict exited +
identity match, then asserts no LIVE session remains (Engine keeps
exited history: 2-exited-retained is not a leak); stopOwned and any
cleanup deviation now fail the report; order sessions -> browser ->
desktop -> daemon. No shared-file edits; no patch requested.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Hardened probe first run FAILED honestly on the old empty-list
assertion (2 exited retained), proving the cleanup section
discriminates; corrected invariant (no-live) -> PASSED, exit 0:
9 functional checks + session-cleanup-exited x2 +
session-cleanup-no-live + desktop/daemon exited (no force).

Integrated/rendered/platform evidence; exact package identity if applicable:
Real drogond + dev Electron CDP, darwin. Shots under .preflight/
(gitignored). Windows explicitly UNVERIFIED by gate (exit 2), not
silently broken.

Unverified, missing, source defects, deliberate approved deltas:
Windows run unverified. No deliberate deltas.

Dependencies requested; next bounded checkpoint:
V3 factory import path + files.v1 advertisement still awaited for
first panel mount (ROOT relay pending).

Owned processes: session/incarnation/host, settlement/release receipts:
Probe sessions stopped exact + observed exited; desktop/daemon
exited clean; ps confirms no strays. No active leaves (8 settled);
GLM terminal term_a0ebf8a9 retained live.

Rollback; data/credentials/privacy check:
git revert of this checkpoint commit. Fixture /tmp only. No
credentials, no real user data.

Ready for independent review: yes (not self-accepted).
