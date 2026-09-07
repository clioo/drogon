# V2 checkpoint-003: theme/chrome wired to settings store

Vertical / scope / base SHA / head SHA / branch / worktree:
V2 desktop/settings; theme application + inspector persistence wired
into App chrome. Base 625544e; head this commit; branch
codex/vertical-02-desktop-settings; worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-02-desktop-settings.

Capabilities and original contract/test IDs:
WP-UI-SETTINGS continuation (settings-store theme/inspectorVisible now
consumed by real chrome); source STYLEGUIDE/tokens reused, no visual
redesign (zero CSS changes; existing `.dark` custom-variant hook).

Changed paths; shared-file patch requested:
apps/desktop/src/renderer/src/theme.ts (new, pure helpers, no
document/matchMedia access: resolveEffectiveTheme,
applyThemeToRoot, resolveInspectorDefault).
apps/desktop/src/renderer/src/theme.test.ts (new, 7 tests).
apps/desktop/src/renderer/src/App.tsx (M): lazy single uiSettings()
store (namespace "ui", no window touch on import), theme state +
documentElement .dark application with system-listener lifecycle,
inspector initial value prefers saved choice over viewport default,
inspector toggles persisted. No shared-file edits; no patch requested.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
theme.test.ts 7/7 failing on no-behavior stub (behavioral RED), then
7/7 GREEN. Combined (apps/desktop, Node24): vitest run -> 19 files,
197 tests passed, exit 0; tsc --noEmit -> exit 0.

Integrated/rendered/platform evidence; exact package identity if applicable:
Unit + typecheck. CDP keyboard/focus evidence for the shortcuts rewire
plus theme-rendered states are the next review step (committed
cleanup-seam probe planned per ROOT guidance). darwin dev. No packaging.

Unverified, missing, source defects, deliberate approved deltas:
locale key present in store but no i18n consumer yet (explicitly out
of scope). Full 88+36 catalog and 214-field closure still open. No
deliberate deltas.

Dependencies requested; next bounded checkpoint:
None blocking. Next: first V3 files-panel mount gated by
checkAvailability once ROOT publishes exact preload TS names (V2
replied ACK to ROOT question; uncorrected ff327a56 will not mount).

Owned processes: session/incarnation/host, settlement/release receipts:
Theme GLM leaf ctx_a30e48ca99a3 worker_done accepted, inspected,
re-verified, release retained/no_owned_resource (leader-created
term_a0ebf8a9 retained live for reuse). No probe processes spawned
this checkpoint.

Rollback; data/credentials/privacy check:
git revert of this checkpoint commit; ui settings key view-only,
shape-validated, best-effort. No credentials, no real user data.

Ready for independent review: yes (not self-accepted).
