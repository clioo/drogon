# V2 checkpoint-007: redundant cleanup + runtime fence per ROOT review

Vertical / scope / base SHA / head SHA / branch / worktree:
V2 desktop/settings; probe hardening round 2 (no product behavior
changes). Base 771da7d; head this commit; branch
codex/vertical-02-desktop-settings; worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-02-desktop-settings.

Capabilities and original contract/test IDs:
ROOT 771da7d review (all-exited invariant, crash-path independent
channel, runtime.shutdown fence, concise comments). Service
quiescence contract (capability-gated shutdown, exact host/
serviceInstance fence, sessions-first rule).

Changed paths; shared-file patch requested:
docs/migration/verticals/V2/probes/keyboard-focus-cdp.mjs (M):
page/CLI redundant control channels (execFile drogon-cli against
same data dir); final invariant every retained verdict===exited
with honest per-verdict counts (unverifiable no longer counts as
clean); runtimeFence checks runtime.quiescent-shutdown.v1 then
rpc runtime.shutdown with exact fence, else explicit fallback
entry; stopOwned/bad-cleanup fails report; fileURLToPath ROOT,
win32 .exe, conditional SHELL, UNVERIFIED+exit-2 Windows gate.
apps/desktop/src/renderer/src/assets/main.css (M): 6-line comment
trimmed to 2, tokens untouched. No shared-file edits; no patch
requested.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Probe PASSED exit 0: 9 functional + session-cleanup-list-via-page(2)
+ exact exits x2 + session-cleanup-all-exited({"exited":2}) +
runtime-fence shutdown admitted + desktop/daemon exited clean.
CLI channel proven independently (/tmp/v2-cli-chan.mjs): status 9
caps, workspace add, create live, list 1, close exited, no strays.

Integrated/rendered/platform evidence; exact package identity if applicable:
Real drogond + dev Electron CDP, darwin; shots .preflight/
(gitignored). Windows UNVERIFIED by gate.

Unverified, missing, source defects, deliberate approved deltas:
Page-dead CLI fallback path implemented but not force-exercised
(its primitives are proven both sides: probe page path live, CLI
script live). No deliberate deltas.

Dependencies requested; next bounded checkpoint:
V3 factory + files.v1 advertisement still awaited (ROOT relay).

Owned processes: session/incarnation/host, settlement/release receipts:
Probe sessions exact-stopped + observed exited; runtime.shutdown
admitted; processes exited clean; ps confirms no strays. No active
leaves; GLM terminal retained live.

Rollback; data/credentials/privacy check:
git revert of this checkpoint commit. Fixture /tmp only. No
credentials, no real user data.

Ready for independent review: yes (not self-accepted).
