# V2 checkpoint-004: keyboard/focus/theme CDP evidence (committed probe)

Vertical / scope / base SHA / head SHA / branch / worktree:
V2 desktop/settings; committed CDP probe proving shortcuts rewire +
tab keyboard nav + theme application on real dev Electron + real
drogond. Base f540e54; head this commit; branch
codex/vertical-02-desktop-settings; worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-02-desktop-settings.

Capabilities and original contract/test IDs:
WP-UI-SHELL-NAV (keyboard/focus), WP-UI-SETTINGS (theme consumer).
Handoff V2 gate: keyboard/focus/IME where applicable; no snapshots
auto-accepted; electron skill + Playwright CDP, not computer use.

Changed paths; shared-file patch requested:
docs/migration/verticals/V2/probes/keyboard-focus-cdp.mjs (new,
committed V2-owned probe; lifecycle via existing
scripts/acceptance-process.mjs seams, read-only reuse, no edits
there). No product-code changes; no shared-file edits; no patch
requested.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
No product RED in this checkpoint (probe is review evidence for
checkpoints 002-003 behavior). Command: Node24
docs/migration/verticals/V2/probes/keyboard-focus-cdp.mjs -> status
PASSED, exit 0: keyboard-shortcut-creates-terminal (Meta+Shift+N ->
1 tab), arrow-home-tab-navigation-moves-selection-and-focus
(Home/ArrowRight move aria-selected + document.activeElement),
system-theme-toggles-dark-class (emulated dark/light flips
documentElement .dark), desktop: exited, daemon: exited (no force).

Integrated/rendered/platform evidence; exact package identity if applicable:
Real target/debug/drogond + dev Electron (rebuilt out/ from f540e54)
over Playwright CDP, viewport 1440x1000. Shots (gitignored):
.preflight/v2-kbd-1788780809625/ (kbd-new-terminal.png,
kbd-tab-nav.png, theme-dark.png, theme-light.png). darwin dev only;
no packaging (V5/integrator-owned).

Unverified, missing, source defects, deliberate approved deltas:
IME-specific validation not run. No deliberate deltas.

Dependencies requested; next bounded checkpoint:
Blocked item unchanged: first V3 files-panel mount awaits ROOT's
exact preload TS names (V2 ACK sent). Next independent: empty/error/
recovery states + onboarding/dashboard per handoff V2 delivery 3.

Owned processes: session/incarnation/host, settlement/release receipts:
Probe-owned desktop + daemon stopped via stopAcceptanceProcess
(exited, no force); ps confirms no v2 fixture strays. All 6 V2 leaves
across checkpoints 001-003 settled/released; GLM terminal
term_a0ebf8a9 retained live for reuse.

Rollback; data/credentials/privacy check:
git revert of this checkpoint commit. Fixture-only dirs under /tmp;
no credentials, no real user data.

Ready for independent review: yes (not self-accepted).
