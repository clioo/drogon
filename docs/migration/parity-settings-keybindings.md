# Settings/keybindings source census (bounded checkpoint, metadata only)

Static literal census at frozen source `c9790628`. Companion machine
record: `docs/migration/parity-settings-keybindings.json` (schema
`drogon.parity-settings-keybindings/1`). No expression evaluated, nothing
executed, no giant parser — constrained static reading of literal catalogs.
This is **metadata only, NOT a settings property/persistence inventory**
(global-settings-types keys, defaults, migration = explicit follow-up).

## 1. Settings targets and intents (35 + 3, exact)

`src/renderer/src/lib/settings-navigation-types.ts:15-51`
(`SETTINGS_NAV_TARGETS`, lines 16–50): general, integrations, accounts,
browser, git, tasks, appearance, input, floating-workspace, terminal,
quick-commands, notifications, computer-use, developer-permissions, privacy,
advanced, dev, voice, shortcuts, stats, ssh, experimental, plugins, agents,
orchestration, artifacts, share-skills, automations, orca-account, linear,
setup-guide, servers, mobile, mobile-emulator, repo.
Intents (`:53-57`): add-quick-command, add-remote-orca-server, add-ssh-host.
Plus 5 sub-target id constants (`:63-67`, e.g.
`general-global-worktree-visibility`).

Rendered sections are **not** the 35: assembly
(`useSettingsNavigationMetadata.ts:36-96`) composes 5 builder modules
driven by runtime flags (isMac/isWindows/isWebClient/isDev/
isLinearConnected/repos); per-repo collapsed panes
(`settings-navigation-foundations.ts:59-69`); conditional install-status
badges (`use-settings-navigation-model.ts:54-101`); search-ranked
visibility + lazy mounting (`:135-193`); 8 nav groups
(`settings-navigation-foundations.ts:10-47`). Dynamic per-repo/plugin
expansions are explicitly **not** part of the finite 35 total.

## 2. Keybindings (88 static + 36 dynamic = 124 reachable)

- Static: 88 definitions across `definitions-core-{1..4}.ts`
  (25/28/30/5), zero in-file or cross-shard duplicates; every id present in
  the `KeybindingActionId` union (`types.ts:27-117`), which additionally
  carries the dynamic `tab.newAgent.${TuiAgent}` and open-ended
  ``plugin:${string}`` members. The prior sanity-88 is therefore the
  **static core count, confirmed — not a forced total**.
- Per-row fields in JSON: id/title/group/scope, darwin/linux/win32 default
  chords (67 shared-helper literals via `platformBindings`, 21 explicit
  per-platform objects, 0 non-literal), `allowInTerminal` (11 true),
  `allowBareKeybindings` (3 true), `allowShiftOnlyKeybindings` (1 true:
  `terminal.switchInputSource`), `conflictGroup` (editor/global/menu/
  workspace-shell), each with `file:line` anchor. No `when`/editable/
  availability fields exist on the definition — availability is scope +
  flags + main-window allowlist (`definitions-core-2.ts:245` comment).
- Dynamic agent tabs: `tab.newAgent.<agent>` × 36 `ALL_TUI_AGENTS`
  members (`definitions.ts:18-35`; list `tui-agent-display-names.ts:8-45`),
  group Agents, scope tabs, empty defaults; disabled agents hidden at
  catalog build (`shortcut-groups.ts:23-41`); plugin commands appended with
  conflict surfacing (`shortcut-definition-catalog.ts:25-60`).
- Aux: digit-index actions (`definitions.ts:61-71`), legacy tab-switch
  bindings (`:45-51`), 9 presentation groups, mac symbolic-hotkey conflict
  detection (imported, bodies not inventoried).

## 3. Source hashes (read files)

Recorded per file in JSON `files`: settings-navigation-types
`baf9d817…`, definitions `0ae10b09…`, definitions-support `b5538de5…`,
core-1..4 `423acb47…`/`f92e21d6…`/`74926564…`/`dfa55e2a…`, types
`497bbd24…`, tui-agent `7c470c85…`, display-names `1a4b102b…`,
foundations `18dd05d7…`, shortcut-groups `1a814631…`,
definition-catalog `b55464d7…`, metadata hook `2e86e0a9…`,
navigation-model (read 207 lines; hash in JSON).

## 4. Counts derived, discrepancies explained

`settingsTargets 35`, `settingsIntents 3`, `keybindingStatic 88`,
`keybindingAgentDynamic 36`, `keybindingReachable 124`,
`duplicateIdsAcrossShards 0`. 88 ≠ 124 is static-vs-reachable, not a
conflict; `plugin:` ids are unbounded by construction.

## 5. Gaps (explicit follow-ups, not deferrals)

Runtime per-action gating; Mod expansion in normalization/matching;
plugin-contributed rows (runtime data); full property/persistence
inventory; localized-title cross-check. See JSON `gaps`.
