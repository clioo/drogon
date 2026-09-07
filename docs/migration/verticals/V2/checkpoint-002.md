# V2 checkpoint-002: settings store + shortcuts registry + contract corrections

Vertical / scope / base SHA / head SHA / branch / worktree:
V2 desktop/settings; settings-store foundation, shortcuts registry core
with App rewire, ROOT-requested mount-contract corrections. Base
518e4cb; head this commit; branch codex/vertical-02-desktop-settings;
worktree /Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-02-desktop-settings.

Capabilities and original contract/test IDs:
parity-settings-persistence-contracts.md SP01-SP13 distinctions;
parity-settings-properties.json schema
drogon.parity-settings-properties/2 (declared names + builder defaults;
per-field UI mapping unverified, no 214-field closure claimed);
parity-settings-keybindings.md/.json (88 static + 36 dynamic; this
checkpoint ports the registry core + the ONE existing binding only).
ROOT review corrections on checkpoint-001 mount contract. WP-UI-SETTINGS
(foundation), WP-UI-SHELL-NAV (shortcuts part).

Changed paths; shared-file patch requested:
apps/desktop/src/renderer/src/settings-store.ts (new, 177 lines) +
settings-store.test.ts (new, 17 tests): Theme, SettingsSubset
{theme, inspectorVisible, locale}, SETTINGS_DEFAULTS,
mergeSettingLayers defaults<persisted<migration<launchOverride with
explicit-false surviving absent upper layers, parsePersistedSettings
(never throws), SettingsStore with injectable storage, 1s debounce / 5s
max-pending. theme catalog-anchored (system/dark/light, default
system); inspectorVisible/locale provisional renderer keys; extension
point documented for the remaining catalog.
apps/desktop/src/renderer/src/shortcuts.ts (new, 132 lines) +
shortcuts.test.ts (new, 23 tests): resolveModifier (injected platform,
darwin->meta else ctrl), parseChord/matchesChord, registry
register/matchKeyEvent/unregister with duplicate rejection,
guardHandler busy guard; 88-action catalog extension point documented.
apps/desktop/src/renderer/src/App.tsx (M): keydown rewire to
registry-backed CmdOrCtrl+Shift+N workspace.newTerminal with identical
guard semantics; userAgent sniff stays only as platform-string input,
not inside matching.
apps/desktop/src/renderer/src/route-panel-contract.ts (M, +42/-):
PanelProps.session is Session|null; new pure
checkAvailability(descriptor, serviceCaps) split from the declared
knownCapabilities vocabulary; resolveRoute returns built-in
{__unavailable__, Unavailable, ()=>null} instead of throwing when id
and fallbackId are both unregistered. route-panel-contract.test.ts
+102 (8 new tests).
No shared-file edits; no patch requested from ROOT.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
settings-store.test.ts: 17/17 failing on no-behavior stub, exit 1
(behavioral RED), then 17/17 GREEN. shortcuts.test.ts RED was
absence-RED (module missing), GREEN assertions behavioral
(modifier/chord/registry/guard). Contract extension tests: 6
failing/19 passing pre-fix (behavioral RED), 25/25 post-fix.
Combined (apps/desktop, Node24): vitest run -> 18 files, 190 tests
passed, exit 0; tsc --noEmit -> exit 0.

Integrated/rendered/platform evidence; exact package identity if applicable:
Unit + typecheck only this checkpoint (checkpoint-001 holds the CDP
evidence for nav; shortcuts rewire preserves identical chord/guards and
is covered by registry tests). darwin dev. No packaging.

Unverified, missing, source defects, deliberate approved deltas:
Full 88+36 keybinding catalog NOT ported (registry core only).
Remaining 214-field settings catalog NOT closed (precedence core +
3-key subset). Mount contract still not consumed by a real V3/V4 panel
(App mount wiring is the next step). No deliberate deltas.

Dependencies requested; next bounded checkpoint:
None. Next: theme/inspector locale wiring into App chrome + first
V3/V4 panel mount against the corrected contract; CDP keyboard/focus
evidence via committed cleanup-seam probe.

Owned processes: session/incarnation/host, settlement/release receipts:
Leaf-C GLM settings ctx_dfcf34cfacba worker_done accepted, inspected,
re-verified, release retained/no_owned_resource (leader-created
term_a0ebf8a9 retained live for reuse). Leaf-D Sonnet shortcuts
ctx_67912f24c3fe accepted, inspected, re-verified, released
(closed_agent_terminal, transcript captured). Correction Sonnet
ctx_3ce67aa1b391 accepted, inspected, re-verified, released
(closed_agent_terminal). No stray v2-nav fixture processes (ps
verified; only pre-existing user daemons untouched).

Rollback; data/credentials/privacy check:
git revert of this checkpoint commit; settings localStorage key
drogon:settings:<namespace> view-only, shape-validated, best-effort.
No credentials, no real user data.

Ready for independent review: yes (not self-accepted).
