# Reference UI surface catalog: orca-drogon → Drogon

Scope: every user-facing surface of the read-only reference
(`/Users/carlos/Documents/Drogon-mentu-session`, Orca 1.4.197 + Drogon fork)
that falls inside the Drogon MVP (journeys J1–J12,
`docs/migration/rewrite-mvp-plan.md` §2). Out of scope and intentionally
absent below: voice, computer use, emulator, mobile, AI Vault, plugins,
cloud, SSH remote, Linear, Jira, GitLab, Meetings, updater.

Method: fork source first (component tree, keybinding definitions), confirmed
against the live reference over CDP (`http://127.0.0.1:9445`) with read-only
navigation only — sidebar nav clicks into Tasks/Automations/Bots/Settings and
back, `ariaSnapshot()` + screenshots stored under `.preflight/ui-audit/`
(not committed):
`01-main`, `05-palette-cmdk`, `06-tasks`, `07-automations`, `08-bots`,
`09-settings`, `10-sessions-back`. Nothing was created, renamed, deleted, or
typed into a terminal in the reference. Chords ⌘J/⌘P/⌘, did not open overlays
from the focused terminal in the probe, so palette rows are sourced from fork
components + Drogon keybindings, not from a rendered overlay capture.

Legend — oracle states live in `scripts/fidelity/compare-surfaces.mjs`
(`ALL_STATES`, 43 states on main: `empty`, `worktree-card-rows`,
`browser-tab-loading`, `editor-header`, `address-bar-suggestions`,
`project-terminal`, `palette`, `quick-open`, `command-palette`,
`launch-dialog`, `settings-shortcuts-rebind`, `settings-appearance`,
`changes`, `automations`, `browser`, `tasks`, `tasks-rows`, `tasks-filters`,
`bots`, `statusbar-strip`, `explorer`, `source-control`,
`source-control-dirty`, `create-menu`, `sidebar-menus`, `tab-menus`,
`right-rail`, `dialogs`, `settings-general`, `settings-terminal`,
`settings-agents`, `settings-notifications`, `settings-git`,
`settings-shortcuts`, `terminal-find`, `browser-find`, `mentu`,
`session-details`, `automation-runs`, `bot-responsibilities`, `toasts`,
`editor-tab`, `split-terminal`, `agent-state`). "Oracle" column names the
covering state or proposes a new `state-id` (collected in
[Missing oracle states](#missing-oracle-states) with navigation steps).

## 1. Landing / empty states

| Surface | Reach in fork | Fork source | Drogon equivalent + reach | Oracle | Visual notes |
|---|---|---|---|---|---|
| No-project landing | Launch with no projects | `components/drogon/` (fork landing), `components/Sidebar.tsx` empty state | `features/landing/Landing.tsx` (rendered when project list empty) | `shell-sidebar` (partial) | Fork header copy + "Star on GitHub" row; Drogon `github-star.tsx`; Geist, monochrome icons |
| Empty project (no worktrees) | Select project with zero worktrees | `components/sidebar/empty-project-placeholder-repos.ts` | `SidebarNav.tsx` empty block | `shell-sidebar` | Keep placeholder copy exact; "New workspace" CTA |
| Empty worktree list | Project expanded, no worktrees match filter | `components/sidebar/worktree-jump-palette-empty-state.ts` | Sidebar empty text | `shell-sidebar` | Muted 13px copy |
| No Bots / No automations | Bots page / Automations page with zero rows (captured: `08-bots`, `07-automations`) | `components/bots/BotsPage.tsx`, `components/automations/AutomationsPage.tsx` | `BotsPanel.tsx` empty state, `AutomationsListPanel.tsx` / `AutomationListEmptyView.tsx` | `bots`, `automations` | Bots: "No Bots yet / Give a character a purpose… / Create Bot"; Automations: template cards (Repo health, Release prep, Recurring review, Maintenance) + "Add new" |

## 2. Sidebar (left)

| Surface | Reach in fork | Fork source | Drogon equivalent + reach | Oracle | Visual notes |
|---|---|---|---|---|---|
| Shell column + resize | Always; drag right edge | `components/sidebar/index.tsx` (MIN/MAX_WIDTH), `components/Sidebar.tsx` | `features/shell/Sidebar.tsx`, `sidebar-width.ts` (default 280, min 220, max 500) | `shell-sidebar` | Width 280 default; resize handle `WORKTREE_SIDEBAR_RESIZE_HANDLE_CLASS_NAME`; oracle Δ0 (R6-A) |
| Titlebar-in-sidebar (Back/Forward, search, traffic lights) | Top of sidebar column | `components/TerminalTitlebarTabs.tsx`, `components/sidebar/host-header-*` | `features/shell/TitlebarLeftControls.tsx`, `tab-chrome.ts` | `shell-sidebar` | Back enabled/disabled with history; "Search worktrees and browser tabs" button; R9-B |
| Projects header ("Projects", View activity, Workspace options, New workspace) | Sidebar top (captured: `01-main`) | `components/sidebar/SidebarHeader.tsx`, `SidebarNav.tsx` | `features/shell/SidebarNav.tsx`, `ProjectList.tsx` | `shell-sidebar` | Exact header copy; "New workspace" `+` button opens composer |
| Project rows (icon, name, expand, unread) | Click row toggles worktree list | `components/sidebar/` project-row components, `folder-workspace-*` | `ProjectList.tsx`, `project-adapter.ts` | `shell-sidebar` | Chevron + provider/avatar icon; "Mark as unread" per row (seen in `01-main`) |
| Worktree cards (agent state dot, branch, badges, ports, PR link) | Under expanded project (captured: `01-main`: Active/Inactive, Linked PR #n, "4 live ports") | `components/sidebar/` worktree-card components, `workspace-status-icon-options.ts` | `features/shell/WorktreeCard.tsx`, `WorktreeCardMetaBadges.tsx`, `worktree-card-*.ts`, `agent-state.ts` | `shell-sidebar` | State dot (working/idle/waiting); PR badge; ports pill opens Ports panel; detached-HEAD row copy |
| Worktree context menu (Reveal, Open in editor, rename, delete with counts) | Right-click worktree card | `components/terminal-pane/terminal-pane-menu-*`, `components/sidebar/delete-worktree-*` | `WorktreeContextMenu.tsx`, `worktree-context-menu-policy.ts`, `WorktreeTitleInlineRename.tsx`, `DeleteWorktreeDialog.tsx` | `sidebar-menus` | Inline rename input; delete dialog shows dirty-change counts (R9-A) |
| Options menu ("Workspace options": Show/Hide rows, sort) | "Workspace options" button in Projects header | `components/sidebar/SidebarSettingsHelpMenu.tsx`, `FilterToggleRow.tsx` | `sidebar-options-show.ts`, `sidebar-footer.tsx` | `sidebar-menus` | Rows: Show sleeping/hidden sources; R14-A |
| Project actions menu (Project Settings…, Remove Project…) | "Project actions for {name}" button on project row (captured: `01-main`) | `components/sidebar/` host-header-menu-items, `RepositoryPane.tsx` (settings) | `project-actions-menu.tsx`, `RemoveProjectDialog.tsx` (`remove-project-dialog-copy.ts`), `settings/.../project-settings-section.tsx` | `sidebar-menus` | R14-A; delete dialog copy from `delete-worktree-dialog-copy.ts` pattern |
| New-workspace composer (project picker, name, agent, run target, advanced) | "New workspace" / "Create new worktree for {project}" / `+` | `components/new-workspace/` (`NewWorkspaceComposer*`, `ProjectCombobox*`, `SmartWorkspaceNameField*`), `components/worktree-creation/WorktreeCreationPanel.tsx` | `features/new-workspace/NewWorkspaceComposer.tsx` (+ `.Modal`), `composer-submit.ts`, `AddProjectDialog.tsx`, `AddProjectFromFolderDialog` port in shell | `shell-sidebar` (composer Δ0 per R7-A) | Modal card layout; parent-worktree picker; R7-A removed legacy form |

## 3. Titlebar / tab strip

| Surface | Reach in fork | Fork source | Drogon equivalent + reach | Oracle | Visual notes |
|---|---|---|---|---|---|
| Tab strip (terminal/browser/task tabs, agent spinner, dirty dot) | Top center, one tab per open tab (captured: `01-main` "Terminal 1") | `components/tab-bar/` (`TabBar.tsx`, `tab-bar-surface.tsx`, `SortableTab.tsx`, `tab-width-rules.ts`) | `features/shell/TabBar.tsx`, `SortableTab.tsx`, `tab-strip/` (`SortableBrowserTab.tsx`, `tab-strip-overflow.ts`), `tab-order.ts` | `tab-bar` | dnd-kit reorder, pinned tabs, chevron overflow; R12-D |
| `+` (New tab) menu (New terminal, New browser, split options) | "New tab" button right of strip | `components/tab-bar/` new-tab menu, `terminal-tab-create.ts` | `TabCreateMenu.tsx` | `tab-menus` | Static menu (R6-B: "menú + estático"); icons per type |
| Tab context menu (pin, rename, close variants, reopen) | Right-click tab | `components/terminal/` (`terminal-tab-actions.ts`, `terminal-tab-bulk-actions.ts`), `PinnedTabCloseDialog.tsx` | `TabContextMenu.tsx` (+ `.test`), `tab-order.ts` | `tab-menus` | Close / Close others / Close to right / Reopen closed (`tab.reopenClosed`); R12-D |
| Go back / Go forward (worktree history) | Titlebar arrows (captured: Back enabled, Forward disabled) | `components/sidebar/` history nav, `use-worktree-*selection*` | `view-history.ts`, `TitlebarLeftControls.tsx` | `shell-sidebar` | Disabled state styling; chords `worktree.history.back/forward` |

## 4. Terminal pane

| Surface | Reach in fork | Fork source | Drogon equivalent + reach | Oracle | Visual notes |
|---|---|---|---|---|---|
| xterm pane (theme per scheme, WebGL, zoom, GPU) | Any terminal tab | `components/terminal-pane/TerminalPane.tsx`, `terminal-appearance.ts`, `terminal-renderer-policy.ts` | `features/terminal/TerminalPane.tsx`, `terminal-appearance.ts`, `terminal-renderer-policy.ts`, `terminal-font-zoom.ts` | `terminal` | `terminal.css`; font follow system + weights 500/700 (R14-E); GPU toggle single-writer (R11-A) |
| Find in terminal (⌘F bar, match count) | ⌘F with terminal focused | `components/terminal-pane/` search modules | `TerminalSearch.tsx`, `find-query-bounds.ts`, `terminal-search-safe-find.ts` | `terminal` | Match count bounds; safe-find; R8-O2 |
| Link popover (file/URL actions: open, reveal, copy) | Hover/Cmd-click link in output | `components/terminal-pane/terminal-link-*.ts`, `TerminalLinkActionPopover.tsx` | `TerminalLinkActionPopover.tsx`, `terminal-link-action-*.ts`, `terminal-file-link.ts`, `terminal-http-url-extraction.ts` | `terminal` | Bracketed-paste limits; OSC8 + path detection; R12-E |
| Restart / process-exit overlay (same harness relaunch) | Exit overlay "Restart" or context menu | `components/terminal-pane/TerminalProcessExitOverlay.tsx`, `terminal-process-exit-restart.ts` | `TerminalProcessExitOverlay.tsx`, `terminal-process-exit.ts`, `terminal-restart-launch.ts` | `terminal` | Relaunch keeps `harnessId`; R12-E |
| Terminal context menu (copy, paste policy, clear, split, open external) | Right-click pane | `components/terminal-pane/terminal-pane-menu-*.ts`, `TerminalContextMenu.tsx` | `TerminalContextMenu.tsx`, `terminal-pane-paste.ts`, `terminal-clear` (`keybindings`), `shell.openExternal` http(s) (R10-C) | `terminal` | Multiline-paste confirm; `shell.openExternal` only http(s) |
| Editor tabs + diff viewer (Monaco, autosave, DiffViewer, CSV) | Double-click file / diff from Changes | `components/editor/`, `components/right-sidebar/source-control/*diff*` | `features/editor/` (Monaco workers local, `editor-save-queue.ts`, `editor-autosave-controller.ts`, `CsvViewer.tsx`, diff viewer) | `changes` (partial) | R12-A; file-tree toggle, whitespace + word-wrap settings mirror |

## 5. Browser tab

| Surface | Reach in fork | Fork source | Drogon equivalent + reach | Oracle | Visual notes |
|---|---|---|---|---|---|
| Address bar (edit session, suggestions, recent, overlay at narrow widths) | Browser tab top | `components/browser-pane/` (`BrowserPane.tsx`, `ClientHostedBrowserPagePane.tsx`, `assemble-chrome/`, `navigate/`) | `features/browser/browser-address-bar.tsx`, `browser-address-bar-edit-session.ts`, `browser-address-bar-suggestions.ts`, `browser-recent-urls.ts`, `browser-chrome-address-slot.ts` | `browser` | R15-B: overlay-on-focus at narrow widths (qa #114); suggestion list ARIA |
| Nav controls (Back/Forward/Reload/Home, loading state) | Left of address bar | `components/browser-pane/host-guest/`, `navigate/` | `browser-navigation-control-row.tsx`, `browser-nav-state.ts`, `browser-reload-*.ts` | `browser` | Disabled states; reload spinner |
| Banners (permission/popup/download notices, recovery) | Below chrome on trigger | `components/browser-pane/browser-client-hosted-*-notices.ts` | `browser-chrome-banners.tsx`, `browser-viewport-overlays.tsx` | `browser` | Copy exact; dismiss persists |
| Browser menu (⋯: zoom, find, history, profile, import) | Right of address bar | `components/browser-pane/assemble-chrome/` | `browser-toolbar-menu.tsx`, `browser-menu-policy.test.ts` | `browser` | Menu rows per policy test |
| Find in page (⌘F bar over guest) | ⌘F with guest focused (chords pending per R11-B note) | `components/browser-pane/` find modules | `browser-find-bar.tsx`, `browser-find-state.ts` | `browser-find` | Match x/y, Enter/Shift+Enter; guest-focused chords ⌘L/R/F fixed in R12-E |
| Page context menu | Right-click guest | `components/browser-pane/` context modules | `browser-page-context-menu.tsx` | `browser-find` | Back/Reload/Save-as/Inspect subset |
| Ports → open in browser | Ports panel "open" action | `components/right-sidebar/local-workspace-ports-panel.tsx` | `features/ports/` + `browser-tab.ts`, `window-open-authority.ts` | `browser` | R13-B; localhost worktree labels setting |

## 6. Right sidebar

| Surface | Reach in fork | Fork source | Drogon equivalent + reach | Oracle | Visual notes |
|---|---|---|---|---|---|
| Activity bar (Explorer ⌘⇧E, Mentu, Source Control ⌘⇧G, Checks, Ports ⌘⇧I, …) | Right edge rail (captured: `01-main`) | `components/right-sidebar/activity-bar-buttons.tsx`, `right-sidebar-width.ts` | `features/right-sidebar/ActivityBarButton.tsx`, `activity-bar-items.ts` (explorer/mentu/source-control/ports), `RightSidebar.tsx` | `right-rail` | Icon-only rail; shortcuts in tooltips; Mentu gated by `mentu.v1`; vault/checks/plugin tabs out of MVP |
| Explorer (tree, filter Names/Contents, toolbar, collapse-all, refresh) | Activity bar → Explorer (captured: `01-main` tree + "Find files") | `components/right-sidebar/FileExplorer*.tsx`, `file-explorer-*.ts` | `features/file-explorer/FileExplorer.tsx` (+ `TreePane`, `Toolbar`, `NameFilter`, `Row`), `features/right-sidebar/SessionDetailsPanel.tsx` for session | `right-rail` | R10-D; reveal-from-quick-open; row icons per extension tables |
| Explorer row/background context menus (new/rename/delete/duplicate, refresh) | Right-click row or empty tree | `components/right-sidebar/file-explorer-row-context-menu.tsx`, `FileExplorerBackgroundMenu.tsx`, `useFileExplorerNodeCommands.ts` | `features/file-explorer/FileExplorerMenus.tsx`, `InlineInputRow.tsx`, `explorer-policy.ts` | `right-rail` | Inline input row; delete classification; `files.create/rename/delete` RPC |
| Source Control (sections: staged/unstaged/untracked, rows, commit box, sync, Create PR) | Activity bar → Source Control | `components/right-sidebar/source-control/` + `components/right-sidebar/SourceControl.tsx`, `checks-panel/` | `features/source-control/ChangesPanel.tsx`, `commit-area.tsx`, `commit-message-composer.tsx`, `commit-action-menu.tsx`, `branch-context-row.tsx` | `changes` | R10-B: section order, amend, discard dialog, too-many-changes banner; hosted-review header |
| Mentu panel + session tab (recipes, Draft/Graph/Metrics, run controls, evidence, retry) | Activity bar → Mentu; "Open full tab" | `components/mentu/` | `features/mentu/MentuPanel.tsx`, `RecipePane*.tsx` (Header/Content/Inspector/RunControls/Graph/Evidence/Verification), `mentu-panel-descriptor.ts` | `mentu` | R11-D literal port; recipe editor + validation (`mentu.recipe_save`, R12-H); evidence rows stdout/stderr truncated (R14-D) |
| Session details panel | Right sidebar session item | `components/right-sidebar/SessionRowTrailingActions.tsx`, `AiVaultSessionDetails.tsx` (pattern) | `features/right-sidebar/SessionDetailsPanel.tsx` | `right-rail` | R6-B persisted; trailing actions |
| Ports panel (workspace sections, row, details dialog, copy, open in browser) | Activity bar → Ports (⌘⇧I) | `components/right-sidebar/local-workspace-ports-panel.tsx`, `local-port-*.tsx` | `features/ports/PortsPanel.tsx`, `local-workspace-ports-panel.tsx`, `local-port-details-dialog.tsx` | `right-rail` | R13-B; "4 workspace ports" pill (captured: `01-main`); `drogon:workspacePorts` |

## 7. Palette, quick open, settings entry

| Surface | Reach in fork | Fork source | Drogon equivalent + reach | Oracle | Visual notes |
|---|---|---|---|---|---|
| Jump palette ⌘J (worktrees, quick actions, recent tabs, sections) | ⌘J anywhere (`worktree.palette`) | `components/WorktreeJumpPalette.tsx`, `use-worktree-jump-palette-*.ts`, `worktree-jump-palette-*.tsx/ts` | `features/jump-palette/JumpPalette.tsx` (+ `jump-palette-filter.ts`, `jump-palette-sections.ts`, `jump-palette-model.ts`); chord `Mod+J` darwin / `Mod+Shift+J` elsewhere (`keybindings/definitions.ts`) | `palette` | R12-B; interleaved sections; status inputs; "Jump to…" titles (R11-A) |
| Quick open ⌘P (files, `files.search`, reveal in Explorer) | ⌘P anywhere (`worktree.quickOpen` → `Mod+P` all platforms) | `components/cmd-j/` filter/results modules (shared), file-search runtime client | `features/quick-open/QuickOpen.tsx` (+ `quick-open-search.ts`); daemon `files.search` (git ls-files + bounded walk); reveal in Explorer | `palette` | R12-B; git-aware ranking; reveal-on-select |
| Command palette ⌘K (commands + filter chips) | ⌘K (oracle label "Palette (Cmd+K)") | `components/cmd-j/` (`palette-filter.ts`, `palette-results.ts`, `PaletteFilterChips.tsx`, `PaletteFilterMenu.tsx`, `quick-actions.ts`) | `components/command-palette/CommandPalette.tsx`, `features/shell/open-palette.ts`, `shortcuts.ts` | `palette` | Filter chips; live agent status rows; titles per R11-A |
| Settings entry (⌘,, dock/menu, sidebar gear) | ⌘, / Settings button (captured: `09-settings`) / gear in sidebar footer | Settings route + `Settings.tsx` | `settings-panel.tsx`, `settings-route.ts`, `features/settings/SettingsPage.tsx` | `settings` | Full-page (not dialog) since R6-C |

## 8. Settings panes

Fork has ~40 panes (captured nav: `09-settings`); MVP covers the J10 minimum.
Out-of-MVP panes (Accounts, Integrations incl. GitHub/Tasks-pane cards, SSH,
Mobile, Plugins, Experimental, Advanced, DevTools, Privacy…) are excluded —
no rows below.

| Surface | Reach in fork | Fork source | Drogon equivalent + reach | Oracle | Visual notes |
|---|---|---|---|---|---|
| Appearance (theme, sidebar, zoom, window) | Settings → Appearance | `components/settings/AppearancePane.tsx`, `AppearanceInterfaceSection.tsx`, `AppearanceWindowSidebarSection.tsx`, `AppearanceSection.tsx` | `features/settings/appearance-section.tsx`, `SettingsPage.tsx` | `settings` | Order mirrors fork; theme segmented control |
| Terminal typography + GPU (family, size, weight, rendering) | Settings → Terminal → Typography/Rendering | `components/settings/TerminalPane.tsx`, `TerminalAdvancedTypographyControls.tsx`, `TerminalAppearanceSection.tsx`, `TerminalRenderingSection.tsx`, `terminal-typography-search.ts` | `features/settings/terminal-typography.ts` (+ test), appearance section; GPU single-writer in App | `settings` | R14-E: system-font lookup, weights 500/700; R11-A: GPU toggle; font-size row pending (R4-J10 note) |
| General (workspace defaults, navigation, editor, CLI, updates, support) | Settings → General (captured: `09-settings` default view) | `components/settings/GeneralPane.tsx`, `GeneralWorkspaceSettingsSection.tsx`, `GeneralEditorSettingsSection.tsx`, `CliSection.tsx` | Missing: Drogon `SETTINGS_SECTIONS` has no General (comment in `settings-sections.ts`: "omitted: no MVP row is backed by a real setting") | `settings-general` | Fork rows: Tab Order combobox, Workspace Directory + Browse, Nest Workspaces, Ask-before-delete ×3, Auto Save + delay, Diff view/word-wrap/whitespace, Minimap, CLI skill status, Updates, Star Drogon |
| Agents (default harness, launch defaults, CLI skill) | Settings → Agents | `components/settings/AgentsPane.tsx`, `AgentDefaultSetting.tsx`, `AgentLaunchDefaultsEditor.tsx` | `features/settings/agents-section.tsx`, `agent-defaults.ts`, `cli-section.tsx` (real CLI probe) | `settings` | R12-I; CLI section with live status probe |
| Notifications (toggles, sounds) | Settings → Notifications | `components/settings/NotificationsPane.tsx`, `NotificationSettingToggle.tsx`, `NotificationSoundSection.tsx` | `features/settings/notifications-section.tsx` | `settings` | Toggle copy from `notification-settings-copy.ts` |
| Git and GitHub (identity read-only, login status) | Settings → Git & Source Control / Accounts | `components/settings/GitPane.tsx`, `RepositoryPane.tsx`, accounts codex/github rows | `features/settings/git-section.tsx` ("Git and GitHub": read-only identity + login) | `settings` | Honest MVP title ("Git and GitHub", not "Git & Source Control"); R12-I |
| Keyboard shortcuts (table, dispatcher, conflicts) | Settings → Shortcuts | `components/settings/ShortcutsPane.tsx`, `shortcut-definition-catalog.ts`, `shortcut-groups.ts`, `use-mac-captured-digit-chords.ts` | `features/settings/shortcuts-section.tsx`, `keybindings/` (`definitions.ts` 30 ids, `dispatcher.ts`, `scopes.ts`, `registry.ts`), `components/shortcut-labels.ts`, `ShortcutKeyCombo.tsx` | `settings` | R7-I: 30 ids with per-platform chords; key glyphs per R11-A |

## 9. Tasks page (Issues + PRs)

| Surface | Reach in fork | Fork source | Drogon equivalent + reach | Oracle | Visual notes |
|---|---|---|---|---|---|
| Frame + source bar (GitHub/Jira tabs, Issues/PRs/Projects modes) | Tasks nav → Tasks (captured: `06-tasks`: GitHub pressed, Jira, Issues, PRs, Projects) | `components/task-page/TaskPage.tsx`, `ListChrome.tsx` | `features/tasks/TasksPage.tsx`, `task-page/` chrome | `tasks` | R8-G1 frame/source bar; Jira/Projects tabs visible but out-of-MVP (GitHub only wired) |
| Issues mode (table ID/Title/Context/Assignees/Status/Updated, search `is:issue is:open`, filters, new issue) | Issues mode (captured: `06-tasks`) | `components/task-page/github/List.tsx`, `use-task-page-github-list-*.ts` | `features/tasks/task-page/` (list, filters, localized options), `issue-links.ts` | `tasks` | Filter menu + assignee "Assigned to me"; default query `is:issue is:open`; "New GitHub issue" |
| Paging (1..10 × 36) | Bottom of list | `components/task-page/` pagination | `task-page-pagination-page-numbers.ts`, daemon `tasks.list` paging | `tasks` | R8-G1; page numbers, 36/page |
| PR mode (review/checks/merge cells, start-from-PR worktree) | PRs mode | `components/task-page/github/` PR cells, `pull-request-page/`, `github-pr-*.ts` | `TasksPagePR.test.tsx` + `task-page-github-pr-review.ts`, `task-page-checks-pill.ts` | `tasks` | R12-G; review + checks + merge cells; start creates worktree with `#n` badge (R3-J6) |
| GitHub project picker + Open in GitHub | Source bar combobox + Open button (captured: `06-tasks`) | `components/github-project/`, `github-item-dialog/` | `repo-badge-label.tsx`, `github-icon.tsx`, `github-user-avatar.tsx` | `tasks` | "All projects" combobox; per-project open |

## 10. Automations page

| Surface | Reach in fork | Fork source | Drogon equivalent + reach | Oracle | Visual notes |
|---|---|---|---|---|---|
| List (search, filters, refresh, status/last-run cells, templates empty state) | Automations nav (captured: `07-automations`) | `components/automations/AutomationsPage.tsx`, `automation-page-parts.tsx` | `features/automations/AutomationsPageSurface.tsx`, `AutomationsListPanel.tsx`, `AutomationList*` (Toolbar/SearchField/FilterMenu/TableHeader/StatusCell/LastRunCell/LocalRows), `AutomationListEmptyView.tsx` | `automations` | R8-O1; local-time schedules; "New Automation" top-right; external-managers notice |
| Editor dialog (schedule picker, custom cron, validation) | "New Automation" / row edit | `components/automations/AutomationEditorDialog.tsx` | `AutomationEditorDialog.tsx`, `AutomationSchedulePicker.tsx`, `AutomationTimeField.tsx`, `AutomationCustomCronPanel.tsx`, `automation-editor-validation.ts`, `automation-cron-preview.ts` | `automations` | R8-O1; cron preview; validation copy |
| Detail pane (breadcrumb, tabs, prompt disclosure, delete dialogs) | Click row | `components/automations/` detail modules | `AutomationsDetailPane.tsx`, `AutomationDetail.tsx`, `AutomationsPageBreadcrumb.tsx`, `automation-detail-tab-navigation.ts`, `AutomationPromptDisclosure.tsx`, `AutomationDeleteDialogs.tsx` | `automations` | Breadcrumb back; delete asks per preference |
| History (per-automation runs) | Detail → History | `components/automations/` history | `AutomationRunHistory.tsx`, `automation-run-history-*.ts` | `automations` | Keyboard nav; workspace display |
| Runs dashboard + run detail (output snapshot) | "Runs" button (captured: `07-automations`) | (fork: runs views; external scopes out) | `AutomationRunsDashboard*.tsx`, `AutomationRunsTable.tsx`, `AutomationRunDetailsPage.tsx`, `AutomationRunPageFrame.tsx`, `automation-runs-dashboard-model.ts`, `automation-run-content.ts`; daemon `automation.runs_all` / `automation.run` | `automation-runs` | R12-F; honest output snapshot; UTC→local fixed in R8-O1 |

## 11. Bots page

| Surface | Reach in fork | Fork source | Drogon equivalent + reach | Oracle | Visual notes |
|---|---|---|---|---|---|
| List (Back, Refresh, New Bot, empty state) | Bots nav (captured: `08-bots`: "Your team of agents, with memory and a purpose." / "No Bots yet" / Create Bot) | `components/bots/BotsPage.tsx` | `features/bots/BotsPanel.tsx`, `BotsPageStates.tsx`, `bots-page-model.ts`, `bots-panel-descriptor.ts` | `bots` | R13-A composition over primitives; avatar = initials (art not redistributed) |
| Create form (name, preset, character) | "New Bot" / "Create Bot" | `components/bots/BotsPageForms.tsx`, `use-bots-page-controller.ts` | `BotCreationForm.tsx`, `BotsPageForms.tsx`, `use-bots-page-controller.ts` | `bots` | Preset select; validation copy |
| Character picker | Inside create form | `components/bots/` character modules | `BotCharacterPicker.tsx`, `bot-characters.ts` | `bots` | Grid of characters; keyboard nav |
| Chat (visible `bot.run` conversation) | Open bot → conversation | `components/bots/` chat | `BotConversation.tsx`; daemon `bot.create`/`bot.run`/`bot.snapshot` (`bot.snapshot.v1`) | `bots` | R2-J8; messages stream visibly |
| Responsibility form + card (cron, history, Back) | Bot → Responsibilities | (fork responsibilities; R7-E port) | `BotResponsibilityCard.tsx`, `bot-responsibility-bridge` (`bot.responsibility_create/delete` over bot automations) | `bot-responsibilities` | R7-E; header Back wired; per-bot history |
| History (runs incl. scheduled) + header actions + delete | Bot → History | `components/bots/` history | `bots-page-model.ts` history projection; `bot.delete`; scheduled/manual labels | `bots` | R9-C known deviation: confirm dialog + Scheduled/Manual tags the fork lacks |

## 12. Status bar

| Surface | Reach in fork | Fork source | Drogon equivalent + reach | Oracle | Visual notes |
|---|---|---|---|---|---|
| Settings + Help (left) | Bottom-left gear + `?` (captured: `01-main`, `09-settings`) | `components/status-bar/StatusBar.tsx`, `StatusBarSurface.tsx` | `components/status-bar/StatusBar.tsx`, `status-bar-copy.ts` | `status-bar` | J12; oracle Δ0 (R6-A) |
| Provider usage meters (Claude window + week, Codex, refresh) | Bottom bar "47% used …" + refresh (captured all snaps) | `components/status-bar/InlineProviderUsage.tsx` | `StatusBar.tsx` + `window.drogon.usage` snapshot, `provider-icons.tsx` | `status-bar` | J12; percent + remaining copy; "Refresh rate limits" |
| Awake toggle (On/Off) | "Keep computer awake, Off" (captured) | `components/status-bar/CaffeinateStatusSegment.tsx` | `StatusBar.tsx` `handleAwake`, `shared/usage-contract.ts` (`AwakeMode`) | `status-bar` | Toggle with Inactive reason; R1-J12 |
| Memory + terminal count | "888.3 MB · 1" (captured) | `components/status-bar/ResourceUsageStatusSegment.tsx`, `resource-memory-metric-copy.ts` | `memoryLabel/memoryTitle`, `terminalsTitle` in `status-bar-copy.ts` | `status-bar` | R11-A ports/memory wording |
| Ports pill | "4" with plug icon (captured) | `components/status-bar/PortsStatusSegment.tsx` | `portsLabel/portsAriaLabel/portsTitle`; opens Ports panel | `status-bar` | Click → right sidebar Ports |
| Notifications region (`alt+T`) | Bottom-right bell (captured) | notifications components | `region "Notifications alt+T"`; native notifications on needs_input (R3-J1) | `status-bar` | Badge on pending; `alt+T` chord |

## 13. Toasts + dialogs

| Surface | Reach in fork | Fork source | Drogon equivalent + reach | Oracle | Visual notes |
|---|---|---|---|---|---|
| Toasts (sonner: worktree, source-control, terminal, editor, automations) | Bottom (?) on action success/failure | sonner `Toaster` + call sites | `App.tsx` Toaster + `delete-worktree-toast.ts`, `delete-worktree-failure-toast.tsx`, `delete-worktree-preference-toast.ts`, `discard-failure-toast.ts`, `osc52-clipboard-toast.ts`, terminal/editor/automation toasts | `toasts` | R13-C: Toaster + copy exact |
| Delete-worktree dialog (counts, lineage, force fallback, skip-confirm) | Worktree context menu → Delete | `components/sidebar/DeleteWorktreeDialog*.tsx`, `delete-worktree-dialog-copy.ts`, `delete-worktree-dirty-change-counts.ts` | `features/shell/DeleteWorktreeDialog*.tsx`, `delete-worktree-dialog-copy.ts` (+ copy test), `delete-worktree-dirty-change-counts.ts` | `dialogs` | R9-A: counts, lineage notice, Force Delete fallback |
| Remove-project dialog | Project actions → Remove Project | host-header-menu / repository remove | `RemoveProjectDialog.tsx`, `remove-project-dialog-copy.ts` (+ test) | `dialogs` | R14-A; removes project, keeps disk |
| Project settings (per-project rows) | Project actions → Project Settings | `components/settings/RepositoryPane.tsx` | `features/settings/project-settings-section.tsx` | `dialogs` | R14-A section rows |
| Close/pinned-tab + generic confirms | Tab close with running work; pinned close | `components/terminal-pane/CloseTerminalDialog.tsx`, `RunningTerminalCloseDialog.tsx`, `PinnedTabCloseDialog.tsx`, `confirmation-dialog.tsx` | `terminal-process-exit.ts` overlay; pinned confirm (General fork row has no Drogon row — see `settings-general`) | `dialogs` | Copy per fork confirm dialogs |

## 14. Native shell (menu, window, dock)

| Surface | Reach in fork | Fork source | Drogon equivalent + reach | Oracle | Visual notes |
|---|---|---|---|---|---|
| App menu → View → Appearance (toggle sidebars/status bar/Tasks/Automations buttons) | Native menu bar | `src/main/menu/register-app-menu.ts` (View → Appearance submenu mirroring VS Code; `AppearanceMenuState`, `AppearanceMenuKey`) | `apps/desktop/src/main/menu/register-app-menu.ts` (R14-B port, chords from the shared keybinding table) | Proposed `native-menu` | Items: Toggle Left/Right Sidebar (with chords), Show Status Bar, Show Tasks/Automations Button; R14-B landed, oracle state still missing |
| Window bounds persistence | Relaunch restores size/position | main window-state module | `apps/desktop/src/main/window/window-state.ts` (R14-B port) | Proposed `native-menu` | R14-B scope |
| Dock unread badge | Dock icon badge on unread/needs_input | `src/main/dock/unread-badge.ts` (`app.dock?.setBadge(label)`) | `apps/desktop/src/main/dock/unread-badge.ts` (R14-B port) | Proposed `native-menu` | Label format per `unread-badge.ts` |
| Background window for tests (`DROGON_BACKGROUND_WINDOW=1`) | n/a (test-only) | n/a | Acceptance/probe scripts set `showInactive` + accessory policy | n/a | R14-infra; no user surface |

## Missing oracle states

Regenerated against the current `ALL_STATES` in
`scripts/fidelity/compare-surfaces.mjs` (43 states). 11 of the 12 states
originally proposed here have since landed; each bullet names its covering
state and keeps the reference/candidate navigation for reuse. Only
`native-menu` remains unimplemented.

- `sidebar-menus` — COVERED by `sidebar-menus`. Ref: right-click a worktree
  card (context menu), click "Workspace options", click "Project actions for
  {project}"; Esc closes each. Cand: same on `WorktreeContextMenu` /
  options / `project-actions-menu`.
- `tab-menus` — COVERED by `tab-menus` (+ `create-menu` for the static `+`
  menu). Ref: click "New tab" (`+`), then right-click a tab; Esc closes.
  Cand: `TabCreateMenu`, `TabContextMenu`.
- `terminal` — COVERED by `terminal-find` (⌘F find bar) + `split-terminal`
  (pane context menu, "Split Terminal Right", header overlay). The
  link-hover popover (`TerminalLinkActionPopover`) and the process-exit
  overlay have no dedicated state; the restart seam is exercised inside
  `split-terminal`'s ref files (`TerminalProcessExitOverlay.tsx`).
  Ref: focus a terminal tab, ⌘F, hover a link, tab context menu → Restart;
  Esc closes. Cand: `TerminalSearch`, popover, `TerminalContextMenu`.
- `browser-find` — COVERED by `browser-find`. Ref: open a browser tab, ⌘F
  (find bar), right-click guest (page context menu); Esc closes. Cand:
  `browser-find-bar`, `browser-page-context-menu`.
- `right-rail` — COVERED by `right-rail` (with `explorer`,
  `source-control`, `session-details` covering the individual panels). Ref:
  click each activity-bar item (Explorer, Mentu, Source Control, Ports) +
  right-click an Explorer row; back to Sessions after. Cand: same on
  `RightSidebar` items + `FileExplorerMenus`.
- `mentu` — COVERED by `mentu`. Ref: Mentu activity item → recipe
  draft/graph/evidence; "Open full tab". Cand: `MentuPanel` / `RecipePane*`.
- `automation-runs` — COVERED by `automation-runs`. Ref: Automations →
  "Runs" dashboard → open a run. Cand: `AutomationRunsDashboard` →
  `AutomationRunDetailsPage`.
- `bot-responsibilities` — COVERED by `bot-responsibilities`. Ref: Bots →
  open bot → Responsibilities → new responsibility form. Cand:
  `BotResponsibilityCard` + form.
- `settings-general` — COVERED by `settings-general` (R16-G). Ref: Settings →
  General (default view, captured in `09-settings`). Cand: the General pane
  and its navigation now exist (`settings-general` Δ0 in QA r6).
- `toasts` — COVERED by `toasts`. Ref/cand: trigger a worktree delete-cancel
  + a discard (dialogs closed without confirming) and capture the toast
  region. Read-only if the dialogs are cancelled.
- `dialogs` — COVERED by `dialogs`. Ref: open Delete-worktree and
  Remove-project dialogs, capture, Cancel (no mutation). Cand:
  `DeleteWorktreeDialog`, `RemoveProjectDialog`.
- `native-menu` — STILL MISSING from `ALL_STATES`. Ref/cand: read
  `Menu.getApplicationMenu()` template over CDP (`window` bridge) or a
  main-process snapshot; compare View → Appearance items + dock badge
  label. No renderer capture. R14-B landed the menu/window/dock ports, so
  this is the only remaining gap for full native-shell coverage.

