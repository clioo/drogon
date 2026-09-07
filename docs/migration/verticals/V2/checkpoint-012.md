# V2 checkpoint-012: Bots mount wired (capability-dark)

Vertical / scope / base SHA / head SHA / branch / worktree:
V2 desktop/settings; Bots snapshot mount integration behind
bot.snapshot.v1 (dark). Base 535f037; head this commit; branch
codex/vertical-02-desktop-settings; worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-02-desktop-settings.

Capabilities and original contract/test IDs:
ROOT-approved Bots plan (routeId("bots") confirmed). Central
picks bab4cdf (aa32d16, DU resolved to shared DTO only) +
28c1c10 (2abfe71, clean). 7 V4 code/test blobs at 053c89f
(EVIDENCE/docs excluded). bot.snapshot.v1 DARK; no run control
(BotRun bridge unaccepted); V5 query-bound fix active elsewhere.

Changed paths; shared-file patch requested:
bots-mount.ts (new, leaf) + bots-mount.test.ts (15/15, 12 RED on
stub): BOTS_CAPABILITY local, BOTS_ROUTE_ID, isBotsAvailable,
gated BotBridge twin, buildBotsPanelProps (actual data only, no
dispatch/liveness invention), registerBotsRoute via real factory.
bots-loader.ts (new, leaf) + bots-loader.test.ts (7/7 RED on
stub): scope-keyed load machine, too_large distinct,
invalid_snapshot on malformed-ok (never empty-success), verbatim
errors, fresh retry, no scope crossing; reuses shared validators.
App.tsx (M, leader integration): Bots Panels entry (disabled
with reason while dark), scope-exact snapshot loading through
the gated bridge, loading/error-retry/too_large UI (no
empty-success), keep-alive + immediate-withhold + focus handling
mirroring files, no run surfaces, session passed null.
probes/keyboard-focus-cdp.mjs (M): hidden-bots-mount CDP asserts.
No shared-file edits beyond approved picks; no V4 edits; no
patch requested.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Mount 12/15 RED on stub -> 15/15 GREEN; loader 7/7 RED -> 7/7
GREEN (both leaves, behavioral). Combined (apps/desktop,
Node24): vitest 36 files/398 passed, exit 0; tsc clean. CDP
probe: 35 checks PASS incl. hidden-bots-mount disabled with
reason, no Bots section, terminal intact; exact cleanup +
shutdown fence + clean exits.

Integrated/rendered/platform evidence; exact package identity if applicable:
Real drogond + dev Electron CDP, darwin; shots .preflight/
(gitignored). Available-path listing awaits advertisement +
V3/V4 corrections; SSR + unit evidence meanwhile.

Unverified, missing, source defects, deliberate approved deltas:
No deliberate deltas. V3 scoped-draft hoisting still their item.

Dependencies requested; next bounded checkpoint:
files.v1 / bot.snapshot.v1 advertisement + V3/V4 corrections
(ROOT relay). CSS lane continues otherwise.

Owned processes: session/incarnation/host, settlement/release receipts:
Mount Sonnet ctx_3859901feaf7 + loader GLM ctx_4d597912c2cb
accepted/inspected/re-verified, both released (Sonnet terminal
closed, GLM terminal retained). Probe processes clean, no
strays. No active leaves.

Rollback; data/credentials/privacy check:
git revert of this checkpoint commit (picks + assembly separate
below). Fixture /tmp only. No credentials, no real user data.

Ready for independent review: yes (not self-accepted).
