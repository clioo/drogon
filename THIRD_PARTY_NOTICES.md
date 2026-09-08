# Third-party notices

## Orca

The Rust provider-session record/handle model and transition in
`crates/drogon-core/src/session_authority/`, its migrated tests, and its frozen
source-oracle cases derive from the same pinned Orca revision identified below.
Source paths, hashes and case mappings are recorded under
`tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/`.
The original MIT notice is retained below and in `tests/parity/ports/LICENSE.orca`.

The selected tokens in `apps/desktop/src/renderer/src/assets/main.css` and the Button/Input adaptations in `apps/desktop/src/renderer/src/components/ui/` derive from Orca's corresponding renderer files at source revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. The source migration inventories document additional behavior used as reference. Drogon does not include Orca's telemetry, update service, account credentials or runtime as an execution dependency.

The native Bot/Automation record and storage ports in
`crates/drogon-core/src/{bots,automations}` and their parity tests adapt the
same pinned Orca implementation. Source paths, hashes and remaining behavioral
gaps are recorded in `tests/parity/ports/WP-CAP-BOTS/native-state/case-map.json`
and `docs/migration/sol-wave/cap-bots/native-state.md`. The locale comparator
uses the ICU4X dependencies already pinned in Cargo.lock; their redistribution
licenses must be included in packaged dependency notices.

The command palette in `apps/desktop/src/renderer/src/components/command-palette/`
ports focus-restore, section render-cap and result-ranking logic from Orca's
`src/renderer/src/components/cmd-j/{palette-focus-restore-target,palette-section-render-cap,palette-query-tokens,palette-results}.ts`
and the `.jump-palette-item[data-selected='true']` recipe from
`src/renderer/src/assets/main.css`, all at the pinned source revision above.
Each ported file keeps the MIT notice in its header comment.

The bottom status bar in `apps/desktop/src/renderer/src/components/status-bar/`,
its usage readers in `apps/desktop/src/main/usage/` and the contract in
`apps/desktop/src/shared/usage-contract.ts` port Orca's
`src/renderer/src/components/status-bar/{StatusBarSurface,InlineProviderUsage,CaffeinateStatusSegment,PortsStatusSegment,ResourceUsageStatusSegment}.tsx`,
`resource-memory-metric-copy.ts`, `icons.tsx`, `tooltip.tsx`,
`src/renderer/src/lib/window-label-formatter.ts`, `settings/agent-awake-copy.ts`,
`src/shared/{rate-limit-types,rate-limit-reset-format,usage-percentage-display,claude-statusline-rate-limits}.ts`,
`src/main/rate-limits/{claude-usage-window,claude-oauth-credentials,claude-oauth-usage-request,codex-auth-presence,codex-rpc-rate-limit-probe,codex-rate-limit-window-classification,codex-rate-limit-window-mapper,codex-pty-status-parser}.ts`,
`src/main/codex-cli/codex-read-only-app-server-args.ts` and
`src/main/macos-system-sleep-assertion.ts`, all at the pinned source revision
above. Each ported file keeps the MIT notice in its header comment.

The shell sidebar, project/worktree cards and agent-state tab bar in
`apps/desktop/src/renderer/src/features/shell/` port Orca's
`src/renderer/src/components/{AgentWorkingSpinner,AgentStateDot,AgentQuestionIcon}.tsx`,
`components/sidebar/{SidebarNav,index,SidebarSettingsHelpMenu,SidebarHeader,worktree-card-surface,worktree-card-header}.tsx`,
`components/tab-bar/SortableTab.tsx` and the worktree-card/agent-spinner CSS
recipes. The Settings surface in `apps/desktop/src/renderer/src/features/settings/`
ports `components/settings/{SettingsSidebar,SettingsSection,SettingsFormControls,ShortcutRowsList}.tsx`.
All at the pinned source revision above; each ported file keeps the MIT notice.

The Bots page in `apps/desktop/src/renderer/src/features/bots/` and the operating
prompt composer in `crates/drogon-core/src/bots/prompt.rs` port the Drogon fork's
`src/renderer/src/components/bots/{BotCharacterPicker,BotCreationForm,BotsPage}.tsx`
and `src/shared/{drogon-bot-characters,drogon-bot-prompt}.ts` (fork revision
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`, MIT). Character artwork was not
copied; avatars are initials on a disc. The Tasks page in
`apps/desktop/src/renderer/src/features/tasks/` follows the structure of Orca's
`src/renderer/src/components/task-page/**`. Each ported file keeps the MIT notice.

MIT License

Copyright (c) 2026 Lovecast Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The session environment and `drogon-cli` shims in
`crates/drogon-core/src/session_env.rs` port the shape of Orca's
`src/main/daemon/pty-subprocess/spawn-environment.ts`,
`src/main/cli/{linux-terminal-orca-cli-shim,bundled-cli-launcher-path,linux-bare-orca-dispatcher}.ts`
and `config/scripts/dev-cli-terminal-wrapper.mjs`, with DROGON_* names and
TERM_PROGRAM=Drogon. The Mentu runtime, recipe and run-record handling in
`crates/drogon-core/src/mentu/` and the panel in
`apps/desktop/src/renderer/src/features/mentu/` adapt the Drogon fork's
`src/main/mentu/{mentu-cli-process,mentu-session-launch,mentu-run-parsing,mentu-runtime-identity,mentu-recipe-files}.ts`
and `src/renderer/src/components/mentu/{MentuPanel,RecipePaneHeader}.tsx`
(fork revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, MIT). Each ported
file keeps the MIT notice in its header comment.

The Bots responsibility cards, forms and detail flow in
`apps/desktop/src/renderer/src/features/bots/{BotResponsibilityCard,BotsPageForms,BotsPanel}.tsx`
port the Drogon fork's `src/renderer/src/components/bots/{BotResponsibilityCard,BotsPageForms,BotsPage}.tsx`
and `use-bots-page-controller.ts`; the native responsibility RPCs in
`crates/drogon-core/src/bot_mutation_rpc.rs` and `bots/storage.rs` adapt
`src/shared/drogon-bot-contract.ts` and `src/main/bots/bot-service.ts` (fork
revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, MIT). Each ported file
keeps the MIT notice in its header comment.

The right sidebar activity bar and host in
`apps/desktop/src/renderer/src/features/right-sidebar/`, the tab strip and
its static create menu in `features/shell/{TabBar,TabCreateMenu,tab-chrome}.tsx`
and the browser strip tab in `features/browser/BrowserStripTab.tsx` port Orca's
`src/renderer/src/components/right-sidebar/{activity-bar-buttons,index,right-sidebar-top-activity-bar}.tsx`,
`right-sidebar-width.ts`, `use-right-sidebar-activity-items.ts`,
`src/renderer/src/store/right-sidebar-route.ts`,
`src/renderer/src/components/tab-bar/{TabBar,tab-bar-surface,tab-bar-static-create-menu,SortableTab,BrowserTab,drop-indicator,tab-width-rules}.tsx`
and the sidebar chords of `src/shared/keybindings/definitions-core-1.ts`, all at
the pinned source revision above. Each ported file keeps the MIT notice.

The Automations page in `apps/desktop/src/renderer/src/features/automations/`
ports Orca's `src/renderer/src/components/automations/{AutomationsPageSurface,AutomationsPageTopBar,AutomationsListPanel,AutomationsDetailPane,AutomationDetail,AutomationEditorDialog,AutomationSchedulePicker,AutomationTimeField,AutomationCustomCronPanel,AutomationDeleteDialogs,AutomationListLocalRows,AutomationListToolbar,AutomationListTableHeader,AutomationListStatusCell,AutomationListLastRunCell,AutomationListEmptyView,AutomationTemplateEmptyState,AutomationListSearchField,AutomationListFilterMenu,AutomationRunHistory,AutomationPromptDisclosure}.tsx`,
`automation-schedule-label.ts`, `automation-list-keyboard-navigation.ts`,
`automation-detail-tab-navigation.ts`, `automation-run-history-keyboard-navigation.ts`,
`automation-page-parts.tsx` and `src/shared/{automation-schedules,automation-schedule-occurrences}.ts`,
all at the pinned source revision above. Each ported file keeps the MIT notice.

The terminal pane in `apps/desktop/src/renderer/src/features/terminal/` and
`assets/terminal.css` port Orca's `src/renderer/src/assets/terminal.css` and its
asset tests, `components/{TerminalSearch}.tsx`, `terminal-search-safe-find.ts`,
`lib/find-query-bounds.ts`, and `components/terminal-pane/{terminal-appearance,useTerminalFontZoom,terminal-renderer-policy,terminal-http-url-extraction,terminal-http-link-limits,terminal-web-link-click,terminal-link-activation,terminal-file-link-actions,terminal-selection-copy,terminal-handle-copy,osc52-clipboard,terminal-process-exit-restart}.ts`,
`TerminalContextMenu.tsx` and `TerminalProcessExitOverlay.tsx`, all at the pinned
source revision above. Each ported file keeps the MIT notice.

The keybinding core in `apps/desktop/src/renderer/src/keybindings/` and the
Settings shortcuts section port Orca's `src/shared/keybindings/{definitions-core-1,definitions-core-2,definitions-core-3,definitions-core-4,definitions,types,parser,formatting,effective}.ts`,
`src/renderer/src/app-shell/use-global-keybindings.ts` and
`components/settings/ShortcutRowsList.tsx`, all at the pinned source revision
above. Each ported file keeps the MIT notice.

The Tasks page in `apps/desktop/src/renderer/src/features/tasks/` ports Orca's
`src/renderer/src/components/task-page/{TaskPage,Surface,Frame,Content,ListChrome,SourceBar,ProviderFilters,PaginationBar}.tsx`,
`task-page/github/{List,Rows,Filters,ModeControls,StatusCell,AssigneesCell,Avatars,IssueSelectors}.tsx`
and their support modules (source context, pagination page numbers, empty
state, work-item status badge, localized options, user avatar, repo badge),
all at the pinned source revision above. Each ported file keeps the MIT notice.

The titlebar chrome layout, view history model, Projects header and sidebar
footer in `apps/desktop/src/renderer/src/features/shell/{app-chrome-layout,view-history,TitlebarLeftControls,ProjectList,sidebar-footer,SidebarNav}.ts(x)`
and the Landing star button in `features/landing/github-star.tsx` port Orca's
`src/renderer/src/app-shell/{TitlebarLeftControls,use-app-chrome-layout,AppWorkspaceShell,TitlebarMainStrip}.tsx`,
`src/renderer/src/lib/{titlebar-left-chrome,titlebar-worktree-history-controls}.ts`,
`src/renderer/src/store/slices/worktree-nav-history.ts`,
`components/sidebar/{SidebarHeader,sidebar-header-actions,SidebarWorkspaceOptionsMenu,SidebarSettingsHelpMenu,SidebarToolbar,ScrollToCurrentWorkspaceToolbarButton,SidebarNav}.tsx`,
`components/worktree-list/listing/EmptyState.tsx` and `components/Landing.tsx`,
all at the pinned source revision above. Each ported file keeps the MIT notice.

The UI primitives in `apps/desktop/src/renderer/src/components/ui/` and
`lib/utils.ts` port Orca's `src/renderer/src/components/ui/*.tsx` (badge, card,
checkbox, collapsible, context-menu, dialog, dropdown-menu, hover-card, label,
popover, progress, scroll-area, select, separator, sheet, switch, tabs,
textarea, toggle, toggle-group, tooltip, command, accordion, button-group,
button, input) and `src/renderer/src/lib/utils.ts`, all at the pinned source
revision above; each ported file keeps the MIT notice. `tw-animate-css` (MIT)
is a packaged dependency imported by main.css as the source does.

The Explorer panel in `apps/desktop/src/renderer/src/features/file-explorer/`
ports Orca's `src/renderer/src/components/right-sidebar/{FileExplorer,FileExplorerToolbar,FileExplorerNameFilter,FileExplorerQueryStrip,FileExplorerFilesTreePane,FileExplorerVirtualRows,FileExplorerRow,FileExplorerTreeStatus,FileExplorerBackgroundMenu,file-explorer-inline-input-row,file-explorer-row-context-menu}.tsx`,
`file-explorer-{entries,keyboard-navigation,paths,row-projection,selection,types}.ts`,
`useFileExplorer{Keys,Reveal,AutoReveal,InlineInput,Selection}.ts`, `useFileDeletion.ts`,
`path-tree.ts` and the file-type icon tables, all at the pinned source revision
above. Each ported file keeps the MIT notice.

The Source Control panel content in `apps/desktop/src/renderer/src/features/source-control/`
ports Orca's `src/renderer/src/components/right-sidebar/source-control/{panel,listing,commit,sync}/**`
(panel-content, header-toolbar, header-overflow-menu, branch-context-row,
branch-line-total-chip, commit-surface, uncommitted-sections, section-header,
section-file-list, uncommitted-entry-row, row-layout, diff-line-counts,
content-status, entry-actions, entry-context-menu, empty-state,
too-many-changes-banner, commit-area, commit-message-composer,
commit-action-menu, bulk-action-bar, commit-notices, discard-dialog,
compare-summary and their helpers), all at the pinned source revision above.
Each ported file keeps the MIT notice.

The browser tab chrome in `apps/desktop/src/renderer/src/features/browser/`
ports Orca's `src/renderer/src/components/browser-pane/assemble-chrome/{browser-navigation-control-row,browser-reload-control,BrowserAddressBar,BrowserAddressBarSuggestionList,browser-address-bar-edit-session,browser-address-bar-suggestions,BrowserToolbarMenu,browser-toolbar-menu-dropdown,BrowserFind,browser-page-context-menu,browser-page-chrome-banners,browser-page-viewport-overlays,browser-chrome-address-slot,browser-chrome-toolbar,use-browser-page-chrome-focus,use-browser-page-find-shortcuts}.ts(x)`
and `browser-pane/navigate/**` helpers, all at the pinned source revision above.
Each ported file keeps the MIT notice.

The Mentu panel and wide tab in `apps/desktop/src/renderer/src/features/mentu/`
port the Drogon fork's `src/renderer/src/components/mentu/{MentuPanel,MentuRuntimeMessage,RecipePane,RecipePaneHeader,RecipePaneContent,RecipeVerification,recipe-pane-views,recipe-pane-inspector,recipe-pane-run-controls,recipe-graph,recipe-pane-controller,use-recipe-pane-controller}.ts(x)`
and `src/shared/{mentu-pane-types,mentu-recipe-dependencies,mentu-run-status}.ts`
(fork revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, MIT). Each ported
file keeps the MIT notice.

The worktree card actions in `apps/desktop/src/renderer/src/features/shell/`
(context menu, inline rename, delete dialog, meta badges) port Orca's
`src/renderer/src/components/sidebar/{WorktreeCard,WorktreeContextMenu,WorktreeContextMenuView,WorktreeTitleInlineRename,DeleteWorktreeDialog,DeleteWorktreeDialogDescription,DeleteWorktreeDialogFooter,DeleteWorktreeDirtyChangeHint,DeleteWorktreeTargetPreview,DeleteWorktreeWarningPanels,DeleteWorktreeSkipConfirmOption,WorktreeCardMeta,WorktreeCardMetaBadges,WorktreeCardStatusSlot,AutoRenameFailedDialog}.tsx`,
`use-worktree-context-menu-{model,commands,secondary-actions}.ts`,
`worktree-context-menu-policy.ts`, `delete-worktree-{dialog-copy,dirty-change-counts,flow}.ts`
and `worktree-card-{surface,header,meta-row,status-inputs,agent-summary,pr-display,title-display}.ts(x)`,
all at the pinned source revision above. Each ported file keeps the MIT notice.

The keycap combo (`components/ShortcutKeyCombo.tsx`), the status bar provider
and ports segments (`components/status-bar/**`, `main/usage/{workspace-ports,workspace-paths,system}.ts`)
and the Settings GPU acceleration row port Orca's `components/ShortcutKeyCombo.tsx`,
`hooks/useShortcutLabel.ts`, `components/status-bar/{StatusBarSurface,InlineProviderUsage,PortsStatusSegment,ResourceUsageStatusSegment}.tsx`,
`src/main/ports/**` and `components/settings/TerminalRenderingSection.tsx`, all at
the pinned source revision above. Each ported file keeps the MIT notice.

The Settings panes in `apps/desktop/src/renderer/src/features/settings/`
(Agents with the CLI section, Git and GitHub, Appearance, Notifications, and
the source section order) port Orca's `components/settings/{AgentsPane,CliSection,GitPane,AppearancePane,AppearanceSection,AppearanceInterfaceSection,AppearanceWindowSidebarSection,NotificationsPane,NotificationSoundSection,GeneralPane,SettingsSection}.tsx`,
all at the pinned source revision above. Each ported file keeps the MIT notice.

The tab strip interactions in `apps/desktop/src/renderer/src/features/shell/{SortableTab,TabContextMenu,tab-order}.ts(x)`
and `features/shell/tab-strip/**` port Orca's `components/tab-bar/{SortableTab,SortableTabContextMenu,BrowserTab,reconcile-order}.ts(x)`
and `store/slices/tabs/{tabs-tab-order,tabs-bulk-close-actions}.ts`, all at the
pinned source revision above. Each ported file keeps the MIT notice. `@dnd-kit/core`
and `@dnd-kit/sortable` (MIT) are packaged dependencies.

The Tasks pull-request mode in `apps/desktop/src/renderer/src/features/tasks/`
ports Orca's `components/task-page/github/{ModeControls,Rows,StatusCell,ReviewCell,ChecksCell,MergeCell,ReviewerPicker,AssigneesCell,Avatars}.tsx`
(read-only variants), all at the pinned source revision above. Each ported file
keeps the MIT notice.

The Mentu recipe editing in `apps/desktop/src/renderer/src/features/mentu/`
(draft state, inspector edit mode, validation family under `recipe-validation/`)
ports the Drogon fork's `src/renderer/src/components/mentu/{recipe-pane-editor,mentu-session-draft-state,recipe-pane-inspector}.ts(x)`
and `src/shared/{mentu-recipe-validation,mentu-recipe-entry-validation,mentu-recipe-fields,mentu-recipe-root-validation,mentu-recipe-value-validation,mentu-recipe-verify-validation,mentu-recipe-serialization,mentu-recipe-file-contract}.ts`
(fork revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, MIT). Each ported
file keeps the MIT notice.

The jump palette and quick open in
`apps/desktop/src/renderer/src/features/{jump-palette,quick-open}/` and the
palette host `components/command-palette/CommandPalette.tsx` port the Drogon
fork's `src/renderer/src/components/WorktreeJumpPalette.tsx`, its
`worktree-jump-palette-*` row modules, and `src/shared/quick-open-path-search.ts`
(fork revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, MIT). Each ported
file keeps the MIT notice.

The Bots page exactness pass in `apps/desktop/src/renderer/src/features/bots/`
(BotsPageStates, DrogonBotAvatar frame, BotCharacterPicker, BotCreationForm,
BotsPageForms, BotResponsibilityCard, use-bots-page-controller) ports the
Drogon fork's `src/renderer/src/components/bots/**` page composition, form
and controller (fork revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`,
MIT). Character artwork is not redistributed; initials render instead. Each
ported file keeps the MIT notice.

The toast layer in `apps/desktop/src/renderer/src/components/ui/sonner.tsx`
and the toast builders under `features/{shell,source-control,terminal,automations}/`
(delete-worktree toasts, discard-failure toast, osc52 clipboard toasts) port
the Drogon fork's `src/renderer/src/components/ui/sonner.tsx`, its
`[data-sonner-toaster]` styles and the corresponding `toast.*` call sites
(fork revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, MIT). Each ported
file keeps the MIT notice.

The Monaco file editor and diff viewer in
`apps/desktop/src/renderer/src/features/editor/` (MonacoFileEditor, editor
header/labels/dirty-state/pending-flush/save-queue/autosave modules, CsvViewer)
and `features/source-control/diff/` (DiffViewer, diff editor options,
hunk reconstruction, line stats, navigation context) port the Drogon fork's
`src/renderer/src/components/editor/**` and `src/renderer/src/components/diff/**`
(fork revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, MIT), on
`monaco-editor` and `@monaco-editor/react` (MIT). Each ported file keeps the
MIT notice.

The Automations Runs dashboard and run details page in
`apps/desktop/src/renderer/src/features/automations/` (AutomationRunsDashboard,
AutomationRunsDashboardSurface, AutomationRunsTable, AutomationRunDetailsPage,
AutomationRunPageFrame, AutomationsPageBreadcrumb, automation-runs-dashboard-model)
port the Drogon fork's `src/renderer/src/components/automations/**` (fork
revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, MIT). Each ported file
keeps the MIT notice.

The terminal typography settings in
`apps/desktop/src/renderer/src/features/settings/{terminal-typography,font-autocomplete}.ts(x)`,
the appearance section additions and `apps/desktop/src/main/fonts.ts` port the
Drogon fork's `src/renderer/src/components/settings/TerminalAppearanceSection.tsx`,
`terminal-typography-search.ts` and its font enumeration (fork revision
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`, MIT). Each ported file keeps the
MIT notice.

The Ports panel in `apps/desktop/src/renderer/src/features/ports/` and its
right-sidebar activity item port the Drogon fork's
`src/renderer/src/components/ports/**` and `PortsStatusSegment` helpers (fork
revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, MIT). Each ported file
keeps the MIT notice.

The project header actions in `apps/desktop/src/renderer/src/features/shell/`
(project-actions-menu, remove-project-dialog and its copy, sidebar-options-show)
and the Project Settings section port the Drogon fork's
`src/renderer/src/components/sidebar/worktree-list/rows/repo-header-project-actions.tsx`,
`ProjectHeaderActions.tsx`, `SidebarWorkspaceOptionsMenu.tsx` and
`settings-project-section-renderer.tsx` (fork revision
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`, MIT). Each ported file keeps the
MIT notice.

## Bundled fonts

Both fonts bundled under `apps/desktop/src/renderer/src/assets/fonts/` are licensed under the SIL Open Font License, Version 1.1; the full license texts ship next to the files.

- `Geist-Variable.woff2` — Geist, Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font). License: `apps/desktop/src/renderer/src/assets/fonts/Geist-OFL.txt`.
- `SymbolsNerdFontMono-Regular.woff2` — Symbols Nerd Font Mono, Copyright (c) 2014, Ryan L McIntyre (https://ryanlmcintyre.com). License: `apps/desktop/src/renderer/src/assets/fonts/SymbolsNerdFontMono-OFL.txt`.

## Packaged dependencies

Dependency versions are fixed in Cargo.lock and pnpm-lock.yaml. Their licenses must accompany redistributed artifacts. Geist is bundled directly as `Geist-Variable.woff2` under the SIL Open Font License (see "Bundled fonts" above). No Game of Thrones artwork is redistributed in this foundation.
