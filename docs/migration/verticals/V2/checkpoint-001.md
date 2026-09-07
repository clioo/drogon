# V2 checkpoint-001: nav defects fixed + mount contract published

Vertical / scope / base SHA / head SHA / branch / worktree:
V2 desktop/settings; nav-defect repair (UX-NAV-ACTIVE-WORKSPACE,
UX-NAV-RESTORE-WORKSPACE) + typed route/panel mounting contract for V3/V4.
Base 596ddbd9e8b6fdc5d5fa26616479e910b34ba604; head this commit;
branch codex/vertical-02-desktop-settings;
worktree /Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-02-desktop-settings.

Capabilities and original contract/test IDs:
UX-NAV-ACTIVE-WORKSPACE (P1, rewrite) and UX-NAV-RESTORE-WORKSPACE (P1,
missing) from docs/migration/ux-parity-audit-252de85/matrix.json; handoff
section 5 row "Rutas y paneles" (V2 <- V3/V4). WP-UI-SHELL-NAV, WP-UI-STATE,
WP-UI-CORE (mounting part only).

Changed paths; shared-file patch requested:
apps/desktop/src/renderer/src/App.tsx (M, +25/-2: idempotent workspace
re-click, saved-selection restore/persist wiring; session-identity helpers
untouched).
apps/desktop/src/renderer/src/workspace-selection.ts (new, 80 lines).
apps/desktop/src/renderer/src/workspace-selection.test.ts (new, 11 tests).
apps/desktop/src/renderer/src/route-panel-contract.ts (new, 167 lines).
apps/desktop/src/renderer/src/route-panel-contract.test.ts (new, 16 tests).
No shared-file edits; no patch requested from ROOT. Mount contract for
V3/V4: apps/desktop/src/renderer/src/route-panel-contract.ts exports
RouteId/routeId, PanelProps {routeId, session, workspace, status,
restoreState?, focusTarget}, PanelDescriptor {id, title, component,
capability?, restoreState?, onFocus?, onCleanup?}, createRouteRegistry,
registerRoute, resolveRoute, applyPanelFocus, releasePanel,
serializeRouteState, restoreRouteState. V3/V4 mint ids via routeId() and
register; App stays the only mount point.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Baseline: archived matrix rows (candidate 252de85: 1->0 tabs on active
re-click with service live; reload returns to first folder).
Unit RED: workspace-selection.test.ts 3/11 behaviorally failing against a
stub (Sonnet leaf); route-panel-contract.test.ts RED was absence-RED
(module missing, exit 1), GREEN assertions are behavioral (reject
malformed/duplicate/unknown-capability, explicit fallback, state
round-trip) — recorded honestly, not equivalent to candidate behavioral
RED for that new file.
CDP RED (leader, pre-fix seed via git stash -u + rebuilt out/):
active-click 0 tabs vs service live; restore returned "folder" —
matches the archived defects exactly.
CDP GREEN (leader, fixed code, real target/debug/drogond + dev Electron
over Playwright CDP, probe /tmp/v2-nav-cdp.mjs): UX-NAV-ACTIVE-WORKSPACE
1 tab, same session id, verdict live; UX-NAV-RESTORE-WORKSPACE heading
"second-folder" after reload. status PASSED.
GREEN commands (worktree apps/desktop, Node24): vitest run -> 16 files,
141 tests passed, exit 0; tsc --noEmit -> exit 0.

Integrated/rendered/platform evidence; exact package identity if applicable:
Rendered dev-Electron 1440x1000 light; shots /tmp/v2-nav-B52Kn8/shots/
(active-workspace-click.png, selected-second-workspace.png,
workspace-selection-after-reload.png). darwin only; no packaged build
(packaging/installation stays V5/integrator-owned).

Unverified, missing, source defects, deliberate approved deltas:
CDP ran in dev mode, not against a sealed packaged bundle (needs
V5/integrator pipeline). Mount contract has no App.tsx consumer wiring
yet (V2 mounts first V3/V4 panel in a later checkpoint). No deliberate
deltas; source counterparts read, not re-executed.

Dependencies requested; next bounded checkpoint:
None. Next: settings/theme/shortcut restore map with consumers
(WP-UI-SETTINGS) + first V3/V4 panel mount against the published
contract; CDP keyboard/focus evidence.

Owned processes: session/incarnation/host, settlement/release receipts:
Leaf-A Sonnet ctx_8196ac7dfc79 worker_done accepted, inspected,
re-verified, released (closed_agent_terminal, transcript captured).
Leaf-B GLM ctx_5bd5c8e52fd4 worker_done accepted, inspected,
re-verified, release returned retained/no_owned_resource (terminal was
leader-created term_a0ebf8a9-cf52-4b89-9153-dbd514f3b42e); kept live for
bounded reuse, never force-closed. CDP probe processes (own drogond +
Electron) SIGKILLed after each run; fixture dirs under /tmp.

Rollback; data/credentials/privacy check:
git revert of this checkpoint commit restores seed behavior; no data
migration (localStorage key drogon:selected-workspace is view-only,
shape-validated, best-effort). Fixture-only folders/sessions under /tmp;
no credentials, no real user data touched.

Ready for independent review: yes (not self-accepted).
