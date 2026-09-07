# V2 checkpoint-005: recovery affordances + explicit-theme palette fix

Vertical / scope / base SHA / head SHA / branch / worktree:
V2 desktop/settings; session-recovery affordances, explicit-theme
palette fix, settings unknown-key passthrough, 6-combo CDP theme
proof. Base d5c6fd1 (incl. ROOT files-contract cherry-pick); head
this commit; branch codex/vertical-02-desktop-settings; worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-02-desktop-settings.

Capabilities and original contract/test IDs:
WP-UI-TERM/WP-UI-PANES (recovery presentation), WP-UI-SETTINGS
(palette consumer proof, flush forward-compat). AGENTS.md liveness
rule (unverifiable never exited). PUI-CONN-001 note (reconnect-or-
degrade path). ROOT theme-palette review + settings-flush question.
ROOT files contract 7a8bcd9 cherry-picked as d5c6fd1 (central
bridge/protocol only; capability NOT enabled).

Changed paths; shared-file patch requested:
apps/desktop/src/renderer/src/session-recovery.ts (new, 55 lines) +
session-recovery.test.ts (new, 10 tests): recoveryActionFor
(live->none, unverifiable->retry-connection, unexpected-exit->
reveal-output+offer-new, user-exit->none; no respawn exists),
recoveryTabLabel (keeps id:incarnation during unverifiable),
retryAffordanceDisabled.
apps/desktop/src/renderer/src/App.tsx (M): Retry connection
affordance on unverifiable tabs (existing refresh path only);
role=status banner + New terminal offer over preserved xterm output
for unexpected exits; failed retry keeps verdict + error text.
apps/desktop/src/renderer/src/assets/main.css (M, +48): :root.dark
dark tokens + :root:not(.dark) light guard in second dark-media
block; token values byte-identical, specificity (0,2,0) documented;
color-scheme follows applied theme. No restyle.
apps/desktop/src/renderer/src/settings-store.ts (M) +
settings-store.test.ts (+4 tests): parseUnknownSettingsKeys captures
non-subset envelope keys at read, flush merges them back verbatim.
Decision: extras keyed by name only, never invented/never dropped;
known-key malformed values still defaulted, not treated as unknown.
docs/migration/verticals/V2/probes/keyboard-focus-cdp.mjs (M):
theme-matrix section (6 combos, settled-state waits).
No shared-file edits by leaves; no patch requested from ROOT.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
session-recovery.test.ts 10/10 failing on stub (behavioral RED) ->
10/10 GREEN. Unknown-key tests 4 added, 2 failing pre-fix ->
21/21 settings-store GREEN. Combined (apps/desktop, Node24): vitest
run -> 21 files, 220 tests passed, exit 0; tsc --noEmit -> exit 0.
CDP theme matrix (computed --background/--foreground + color-scheme,
system/light/dark x dark/light OS): pre-fix CSS -> FAILED (RED);
fixed CSS -> 6/6 PASS, plus prior probe checks green, desktop+daemon
exited clean. Rebuilt out/ from fixed tree both directions.

Integrated/rendered/platform evidence; exact package identity if applicable:
Real drogond + dev Electron CDP, 1440x1000. Shots under .preflight/
(gitignored). darwin dev. No packaging.

Unverified, missing, source defects, deliberate approved deltas:
IME validation not run. First V3 files-panel mount still awaits V3
corrected factory + files.v1 advertisement (ROOT relay pending). No
deliberate deltas.

Dependencies requested; next bounded checkpoint:
None blocking. Next independent: empty-state/onboarding polish or
V3 mount on factory arrival.

Owned processes: session/incarnation/host, settlement/release receipts:
Recovery GLM ctx_4beac249e9df accepted/inspected/re-verified,
release retained (leader terminal). Palette Sonnet ctx_06af4754384e
accepted/inspected/re-verified, released (closed_agent_terminal).
Probe processes exited clean, no strays (ps verified).

Rollback; data/credentials/privacy check:
git revert of this checkpoint commit (cherry-pick d5c6fd1 kept
separate below it). View-only storage keys; fixture /tmp only. No
credentials, no real user data.

Ready for independent review: yes (not self-accepted).
