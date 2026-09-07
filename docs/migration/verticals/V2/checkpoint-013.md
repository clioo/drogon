# V2 checkpoint-013: Bots mount behind dark capability

Vertical / scope / base SHA / head SHA / branch / worktree:
V2 desktop/settings; Bots snapshot mount integration (dark).
Base 9a45524; head 1e23d73; branch
codex/vertical-02-desktop-settings; worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-02-desktop-settings.

Capabilities and original contract/test IDs:
ROOT-approved Bots plan (routeId("bots") confirmed). Central
picks bab4cdf (aa32d16, DU resolved to shared DTO only) +
28c1c10 (2abfe71, clean). 7 V4 code/test blobs at 053c89f
(EVIDENCE/docs excluded). bot.snapshot.v1 DARK; BotRun bridge
unaccepted (no run control); V5 query-bound fix active
elsewhere. ROOT loader review (throw-safety, scope validation,
reload clearing, stable files base).

Changed paths; shared-file patch requested:
Shared/central (approved picks only): shared/bot-contract.ts
(new), shared/bot-validation.ts (new), main/bot-bridge.ts +
test (new), preload +1, bridge-validation +2, session-contract
delta. No other shared edits; no patch requested.
features/bots/* (7 files, NEW, unmodified assembly).
bots-mount.ts (new, leaf; 15/15, 12 RED on stub) +
bots-loader.ts (new, leaf; 7/7 RED on stub; +2 review
regressions = 9/9): gate twin, scope fencing, too_large
distinct, invalid_snapshot (never empty-success), throw ->
snapshot_transport retryable, response scope_mismatch
rejection, fresh retry, no scope crossing.
App.tsx (M, leader integration): scope-exact loading, stale
clearing, loading/error-retry/too_large UI, keep-alive +
immediate withhold + focus mirroring files, session null.
probes/keyboard-focus-cdp.mjs (M): hidden-bots-mount asserts.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Mount 12/15 RED -> 15/15; loader 7/7 RED -> 7/7 (+2 review
regressions GREEN). Combined (apps/desktop, Node24): vitest 36
files/400 passed, exit 0; tsc clean. CDP probe: 35 checks PASS
incl. hidden-bots-mount, exact cleanup, shutdown fence.

Integrated/rendered/platform evidence; exact package identity if applicable:
Real drogond + dev Electron CDP, darwin; shots .preflight/
(gitignored). Available-path listing awaits advertisement +
V4 corrections.

Unverified, missing, source defects, deliberate approved deltas:
V3/V4 correction items theirs. No deliberate deltas.

Dependencies requested; next bounded checkpoint:
Advertisement + corrections (ROOT relay).

Owned processes: session/incarnation/host, settlement/release receipts:
Mount Sonnet + loader GLM leaves accepted/inspected/
re-verified, both released (GLM terminal retained live, no
active dispatch). Probe processes clean, no strays. No active
leaves.

Rollback; data/credentials/privacy check:
git revert (picks aa32d16/2abfe71 + assembly 535f037 separate
below). Fixture /tmp only. No credentials, no real user data.

Ready for independent review: yes (not self-accepted).
