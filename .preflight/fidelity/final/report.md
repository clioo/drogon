# R5-F fidelity report — 2026-09-07T20-22-00

Viewport 1440x900, schemes: light + dark.
Reference (read-only, confirmation only): CDP http://127.0.0.1:9445 — title "Drogon", url http://localhost:5174/.
Candidate: owned production bundle (apps/desktop/out) + real drogond in a temp data dir, --remote-debugging-port=0.
Candidate versions: {"status":{"hostId":"58c33843-9d3e-4112-a8cf-3f625dffa6e0","serviceInstanceId":"20aa2262-7b33-4de9-bb33-ade3d481eb16","protocol":1,"capabilities":["automation.v1","orchestration.native.v1","workspace.v1","files.v1","session.pty.v1","session.cursor-read.v1","session.incarnation.v1","request.idempotency.v1","harness.catalog.v1","harness.launch.v1","git.v1","runtime.quiescent-shutdown.v1","project.v1

Method: the SOURCE OF TRUTH is the reference source code. Expected structure, classes/tokens, copy, shortcuts and behavior come from the inventoried files below; the running reference instance only confirms the rendered result. Sensitive text (paths, usernames, hashes, durations) is normalized to placeholders before diffing and is never a difference. Where a surface does not exist on one side, the state records "missing" explicitly.

## 1. Source component inventory (reference)

| MVP surface | Reference source (exists?) | Expected-value probes | Candidate owner |
|---|---|---|---|
| Shell + sidebar | src/renderer/src/components/Sidebar.tsx<br>src/renderer/src/components/sidebar/index.tsx<br>src/renderer/src/components/sidebar/SidebarNav.tsx<br>src/renderer/src/components/sidebar/workspace-chrome-metrics.ts<br>src/renderer/src/components/sidebar/SidebarHeader.tsx | sidebar: export { default } from './sidebar/index'<br>width: document.documentElement.style.setProperty('--workspace-sidebar-live-width', `${width}px`)<br>sidebarWidth: const sidebarWidth = useAppStore((s) => s.sidebarWidth) | apps/desktop/src/renderer/src/features/shell/Sidebar.tsx |
| Tab bar | src/renderer/src/components/tab-bar/TabBar.tsx<br>src/renderer/src/components/tab-bar/tab-bar-surface.tsx<br>src/renderer/src/components/tab-bar/tab-width-rules.ts<br>src/renderer/src/components/tab-bar/SortableTab.tsx | h-: className="flex items-stretch h-full overflow-hidden flex-1 min-w-0"<br>aria-label: aria-label={translate(<br>h-: className="mx-0.5 my-auto h-6 w-5 text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-35" | apps/desktop/src/renderer/src/features/shell/TabBar.tsx |
| Status bar | src/renderer/src/components/status-bar/StatusBar.tsx<br>src/renderer/src/components/status-bar/StatusBarSurface.tsx<br>src/renderer/src/components/status-bar/icons.tsx | usage: export { InlineUsageBars } from './InlineProviderUsage'<br>height: // bar instead of overlapping it — bottom padding ≈ footer height.<br>h-: className="flex items-center h-6 min-h-[24px] px-3 gap-4 border-t border-border bg-[var(--bg-titlebar,var(--card))] text-xs select-none shrink-0 relative" | apps/desktop/src/renderer/src/components/status-bar/StatusBar.tsx |
| Palette (Cmd+K) + quick open (Cmd+P) | src/renderer/src/components/cmd-j/palette-filter.ts<br>src/renderer/src/components/cmd-j/palette-results.ts<br>src/renderer/src/components/cmd-j/PaletteFilterChips.tsx | cmd: cmdJPaletteTokenScore,<br>shortcut: shortcuts: ['keyboard shortcuts'],<br>cmd: isCmdJPaletteQueryOverTokenLimit, | apps/desktop/src/renderer/src/components/command-palette/CommandPalette.tsx<br>apps/desktop/src/renderer/src/shortcuts.ts |
| Settings (Appearance) | src/renderer/src/components/settings/AppearancePane.tsx<br>src/renderer/src/components/settings/AppearanceInterfaceSection.tsx<br>src/renderer/src/components/settings/AdvancedPane.tsx | Appearance: translate('auto.components.settings.AppearancePane.terminalDefaultFont', 'Default font')<br>Theme: getThemeEntries,<br>Appearance: title={translate('auto.components.settings.AppearancePane.ca1590d42f', 'App Icon')} | apps/desktop/src/renderer/src/settings-panel.tsx |
| Changes / diff | src/renderer/src/components/right-sidebar/source-control/panel/panel-content.tsx<br>src/renderer/src/components/right-sidebar/source-control/panel/commit-surface.tsx<br>src/renderer/src/components/right-sidebar/source-control/listing/uncommitted-sections.tsx<br>src/renderer/src/components/right-sidebar/source-control/review/hosted-review-header-chrome.tsx | Stage: handleStage,<br>Commit: /** The scrolling surface: status, commit affordances, the file sections and the history dock. */<br>Push: <SourceControlForkPushNotice pushTarget={activeWorktree.pushTarget ?? null} /> | apps/desktop/src/renderer/src/features/source-control/ |
| Automations page | src/renderer/src/components/automations/AutomationsPage.tsx<br>src/renderer/src/components/automations/AutomationEditorDialog.tsx<br>src/renderer/src/components/automations/automation-page-parts.tsx | Automations: export default function AutomationsPage(): React.JSX.Element {<br>Automations: const controller = useAutomationsPageController()<br>Automations: return <AutomationsPageSurface controller={controller} /> | apps/desktop/src/renderer/src/features/automations/ |
| Browser pane | src/renderer/src/components/browser-pane/BrowserPane.tsx<br>src/renderer/src/components/browser-pane/ClientHostedBrowserPagePane.tsx | address: const addressBarInputRef = useRef<HTMLInputElement | null>(null)<br>Back: <div className="relative flex h-full min-h-0 flex-1 flex-col bg-background"><br>Forward: canGoForward: metadata.canGoForward, | apps/desktop/src/renderer/src/features/browser/ |
| Tasks page | src/renderer/src/components/task-page/TaskPage.tsx<br>src/renderer/src/components/task-page/ListChrome.tsx<br>src/renderer/src/components/task-page/github/List.tsx | Tasks: <span className="min-w-0 truncate">{taskSourceAvailabilityNotice.label}</span><br>Filter: <TaskPageProviderFilters model={model} /><br>Tasks: const { taskSourceAvailabilityNotice, taskPageListChromeHidden } = model | apps/desktop/src/renderer/src/features/shell/SidebarNav.tsx |
| Bots page | src/renderer/src/components/bots/BotsPage.tsx<br>src/renderer/src/components/bots/BotsPageForms.tsx<br>src/renderer/src/components/bots/use-bots-page-controller.ts | Bots: <div className="space-y-4" role="list" aria-label="Bots"><br>Bots: <Button variant="outline" size="sm" onClick={closeBotsPage} className="shrink-0 gap-1.5"><br>aria-label: aria-label="Refresh Bots" | apps/desktop/src/renderer/src/features/bots/ |
| Design tokens + styleguide | src/renderer/src/assets/main.css<br>docs/STYLEGUIDE.md | --background: --color-background: var(--background);<br>--sidebar: border-right: 1px solid var(--sidebar-border, var(--border));<br>--font-sans: --font-sans: var(--app-font-family); | apps/desktop/src/renderer/src/assets/main.css |

Exact source components per surface (`<dir>`: first files, tests last):

- Shell + sidebar — `src/renderer/src/components/sidebar`: active-worktree-focus-after-delete.ts, add-remote-host-ssh-actions.ts, add-repo-browse-authority.ts, add-repo-dialog-types.ts, add-repo-existing-workspaces-telemetry.ts, add-repo-host-availability.ts, add-repo-local-start-actions.ts, add-repo-runtime-owner.ts, add-repo-skip-finalization.ts, add-repo-store-upsert.ts, AddProjectFromFolderDialog.tsx, AddRemoteHostDialog.tsx, AddRemoteHostFields.tsx, AddRemoteHostServerFormPanel.tsx
- Tab bar — `src/renderer/src/components/tab-bar`: BrowserTab.tsx, client-hosted-browser-row-label.ts, client-hosted-browser-row-strip-placement.ts, ClientHostedBrowserTab.tsx, ClientHostedBrowserTabRows.tsx, drop-indicator.ts, editor-tab-local-open-guard.ts, EditorFileTab.tsx, EditorFileTabCloseButton.tsx, EditorFileTabContextMenu.tsx, group-tab-order.ts, hosted-terminal-quick-command-search.ts, lucide-icon-stub-fixture.ts, middle-button-default-guard.ts
- Status bar — `src/renderer/src/components/status-bar`: CaffeinateStatusSegment.tsx, ClaudeSwitcherMenu.tsx, codex-restart-status-summary.ts, codex-sign-in-action.ts, codex-switcher-projection.ts, CodexSwitcherMenu.tsx, daemon-session-inventory-invalidation.ts, icons.tsx, InlineProviderUsage.tsx, mergeSnapshotAndSessions.ts, PetStatusSegment.tsx, ports-status-popover-rows.tsx, PortsStatusSegment.tsx, ProviderDetailsMenu.tsx
- Palette (Cmd+K) + quick open (Cmd+P) — `src/renderer/src/components/cmd-j`: palette-filter-option-list.ts, palette-filter-options.ts, palette-filter.ts, palette-focus-restore-target.ts, palette-host-badge.ts, palette-list-entry-render-keys.ts, palette-live-status.tsx, palette-project-results.ts, palette-query-tokens.ts, palette-results.ts, palette-section-render-cap.ts, palette-session-age.ts, PaletteCreateWorktreeRow.tsx, PaletteFilterChips.tsx
- Settings (Appearance) — `src/renderer/src/components/settings`: __snapshots__, accounts-pane-account-actions.ts, accounts-pane-action-errors.ts, accounts-pane-claude-section.tsx, accounts-pane-codex-account-row.tsx, accounts-pane-codex-section.tsx, accounts-pane-config-sync.ts, accounts-pane-location-section.tsx, accounts-pane-minimax-actions.ts, accounts-pane-minimax-section.tsx, accounts-pane-provider-setting-sections.tsx, accounts-pane-removal-dialogs.tsx, accounts-pane-runtime.ts, accounts-pane-types.ts
- Changes / diff — `src/renderer/src/components/right-sidebar/source-control`: ai, commit, listing, notes, panel, review, sync
- Automations page — `src/renderer/src/components/automations`: automation-authority-identity.ts, automation-capability-probe.ts, automation-captured-owner.ts, automation-create-destination.ts, automation-create-projects.ts, automation-delete-confirm-preference.ts, automation-detail-tab-navigation.ts, automation-draft-model.ts, automation-edit-draft.ts, automation-editor-prompt-options.ts, automation-external-target-match.ts, automation-hermes-save.ts, automation-host-cache-controller.ts, automation-host-cache-error.ts
- Browser pane — `src/renderer/src/components/browser-pane`: annotate, assemble-chrome, browser-client-hosted-download-notices.ts, browser-client-hosted-permission-notices.ts, browser-client-hosted-popup-notices.ts, browser-client-page-guest-metadata.ts, browser-client-page-metadata-publish-e2e-fault.ts, browser-client-page-metadata-publisher.ts, browser-client-page-metadata-reporting.ts, browser-client-page-position-driver.ts, browser-client-page-renderer-installation.ts, browser-client-page-retained-elements.ts, browser-client-page-retained-host-fixture.ts, browser-client-page-retained-key.ts
- Tasks page — `src/renderer/src/components/task-page`: Content.tsx, Frame.tsx, github, gitlab, jira, linear, ListChrome.tsx, PaginationBar.tsx, ProviderFilters.tsx, SourceBar.tsx, Surface.tsx, TaskPage.tsx
- Bots page — `src/renderer/src/components/bots`: BotCharacterPicker.tsx, BotCreationForm.tsx, BotResponsibilityCard.tsx, bots-page-model.ts, BotsPage.tsx, BotsPageForms.tsx, BotsPageStates.tsx, DrogonBotAvatar.tsx, use-bots-page-controller.ts, BotsPage.test.tsx
- Design tokens + styleguide — `src/renderer/src/assets`: bots, fonts, main.css, markdown-preview.css, mobile-page.css, rich-markdown-editor.css, terminal.css, mobile-page-qr-layout.test.ts, rich-markdown-task-list-style.test.ts, terminal-container-geometry.test.ts, terminal-scrollbar-style.test.ts, worktree-card-active-style.test.ts

Reference token anchors (`src/renderer/src/assets/main.css`): `--app-font-family: 'Geist', …`, `--font-mono: 'SF Mono', …`, `--radius: 0.625rem`, monochrome roles (`background/foreground`, `sidebar/*`, `muted`, `accent`, `border`, `ring`), git decoration tokens; see `docs/STYLEGUIDE.md` for roles. Candidate must adopt the same variables in `apps/desktop/src/renderer/src/assets/main.css`.

## 2. Per-state results

### empty

- ARIA: ref 49 lines vs cand 45 lines — missing 40, added 36, changed 2.
- Geometry sidebar: ref 280x840 @([class*="sidebar"]) vs cand 240x874 @(aside[aria-label="Sidebar"]) — Δw -40, Δh 34, Δx 0, Δy -36.
- Geometry tablist: not measurable on one side(s) (ref sel —, cand sel [role="tablist"]).
- Geometry statusbar: ref 1440x24 @(bottom-bar-heuristic) vs cand 1440x26 @([class*="status-bar"]) — Δw 0, Δh 2, Δx 0, Δy -2.
- Geometry heading: ref 122x40 @(h1) vs cand 226x27 @(h1) — Δw 104, Δh -13, Δx -197, Δy 72.
- Headline: ref "Drogon" 36px/700 Geist vs cand "A place for your next task" 18px/600 Geist Variable.
  - text: ref "- button "Bots"" → cand "- button "Bots" [disabled]"
  - text: ref "- button "Automations"" → cand "- button "Automations" [disabled]"
  - ref-only: "- button "Toggle sidebar""
  - ref-only: "- button "Go back""
  - ref-only: "- button "Go forward" [disabled]"
  - ref-only: "- button "Search worktrees and browser tabs": Search"
  - ref-only: "- button "Sessions""
  - ref-only: "- button "Meetings""
  - cand-only: "- complementary "Sidebar":"
  - cand-only: "- button "Search workspaces and sessions": Search"
  - cand-only: "- button "Terminals" [disabled]"
  - cand-only: "- button "Files" [disabled]"
  - cand-only: "- button "Changes" [disabled]"
  - cand-only: "- button "Browser" [disabled]"
- ref note: ref as-is: title=Drogon
- cand note: fresh empty app

### project-terminal

- ARIA: ref 49 lines vs cand 111 lines — missing 40, added 102, changed 1.
- Geometry sidebar: ref 280x840 @([class*="sidebar"]) vs cand 240x874 @(aside[aria-label="Sidebar"]) — Δw -40, Δh 34, Δx 0, Δy -36.
- Geometry tablist: not measurable on one side(s) (ref sel —, cand sel [role="tablist"]).
- Geometry statusbar: ref 1440x24 @(bottom-bar-heuristic) vs cand 1440x26 @([class*="status-bar"]) — Δw 0, Δh 2, Δx 0, Δy -2.
- Geometry heading: ref 122x40 @(h1) vs cand 217x20 @(h2) — Δw 95, Δh -20, Δx 408, Δy -300.
- Headline: ref "Drogon" 36px/700 Geist vs cand "Session" 13px/600 Geist Variable.
  - text: ref "- button "Bots"" → cand "- button "Bots" [disabled]"
  - ref-only: "- button "Toggle sidebar""
  - ref-only: "- button "Go back""
  - ref-only: "- button "Go forward" [disabled]"
  - ref-only: "- button "Search worktrees and browser tabs": Search"
  - ref-only: "- button "Sessions""
  - ref-only: "- button "Meetings""
  - cand-only: "- complementary "Sidebar":"
  - cand-only: "- button "Search workspaces and sessions": Search"
  - cand-only: "- button "Terminals""
  - cand-only: "- button "Files""
  - cand-only: "- button "Changes""
  - cand-only: "- button "Browser""
- ref note: tabs visible: 0
- ref MISSING: ref project+terminal fixture intentionally not created (reference is read-only); captured current view
- cand note: folder project registered at <TMP>/folder
- cand note: harness menu: plain New terminal chosen
- cand note: live terminal with marker output
- cand note: teardown: returned to Terminals route

### palette

- ARIA: ref 49 lines vs cand 129 lines — missing 40, added 120, changed 1.
- Geometry sidebar: ref 280x840 @([class*="sidebar"]) vs cand 240x874 @(aside[aria-label="Sidebar"]) — Δw -40, Δh 34, Δx 0, Δy -36.
- Geometry tablist: not measurable on one side(s) (ref sel —, cand sel [role="tablist"]).
- Geometry statusbar: ref 1440x24 @(bottom-bar-heuristic) vs cand 1440x26 @([class*="status-bar"]) — Δw 0, Δh 2, Δx 0, Δy -2.
- Geometry heading: ref 122x40 @(h1) vs cand 217x20 @(h2) — Δw 95, Δh -20, Δx 408, Δy -300.
- Headline: ref "Drogon" 36px/700 Geist vs cand "Session" 13px/600 Geist Variable.
  - text: ref "- button "Bots"" → cand "- button "Bots" [disabled]"
  - ref-only: "- button "Toggle sidebar""
  - ref-only: "- button "Go back""
  - ref-only: "- button "Go forward" [disabled]"
  - ref-only: "- button "Search worktrees and browser tabs": Search"
  - ref-only: "- button "Sessions""
  - ref-only: "- button "Meetings""
  - cand-only: "- complementary "Sidebar":"
  - cand-only: "- button "Search workspaces and sessions": Search"
  - cand-only: "- button "Terminals""
  - cand-only: "- button "Files""
  - cand-only: "- button "Changes""
  - cand-only: "- button "Browser""
- ref note: spec Cmd+K chord Meta+K: no overlay appeared
- ref note: source: Cmd+K is terminal.clear (definitions-core-3.ts); trying source chord Mod+J (worktree.palette)
- ref note: source Mod+J chord Meta+J: no overlay appeared
- ref MISSING: no palette overlay via Cmd+K nor Cmd+J
- cand note: palette.openCommands chord Meta+K: overlay open (dialogs=0 menus=0 palettes=1)
- cand note: cleaned 1 overlay round(s) before setup
- cand note: teardown: returned to Terminals route

### quick-open

- ARIA: ref 49 lines vs cand 115 lines — missing 40, added 106, changed 1.
- Geometry sidebar: ref 280x840 @([class*="sidebar"]) vs cand 240x874 @(aside[aria-label="Sidebar"]) — Δw -40, Δh 34, Δx 0, Δy -36.
- Geometry tablist: not measurable on one side(s) (ref sel —, cand sel [role="tablist"]).
- Geometry statusbar: ref 1440x24 @(bottom-bar-heuristic) vs cand 1440x26 @([class*="status-bar"]) — Δw 0, Δh 2, Δx 0, Δy -2.
- Geometry heading: ref 122x40 @(h1) vs cand 217x20 @(h2) — Δw 95, Δh -20, Δx 408, Δy -300.
- Headline: ref "Drogon" 36px/700 Geist vs cand "Session" 13px/600 Geist Variable.
  - text: ref "- button "Bots"" → cand "- button "Bots" [disabled]"
  - ref-only: "- button "Toggle sidebar""
  - ref-only: "- button "Go back""
  - ref-only: "- button "Go forward" [disabled]"
  - ref-only: "- button "Search worktrees and browser tabs": Search"
  - ref-only: "- button "Sessions""
  - ref-only: "- button "Meetings""
  - cand-only: "- complementary "Sidebar":"
  - cand-only: "- button "Search workspaces and sessions": Search"
  - cand-only: "- button "Terminals""
  - cand-only: "- button "Files""
  - cand-only: "- button "Changes""
  - cand-only: "- button "Browser""
- ref note: Cmd+P chord Meta+P: no overlay appeared
- ref MISSING: Cmd+P (worktree.quickOpen) opened no overlay in the empty ref
- cand note: palette.openQuickOpen chord Meta+P: overlay open (dialogs=0 menus=0 palettes=1)
- cand note: cleaned 1 overlay round(s) before setup
- cand note: teardown: returned to Terminals route

### settings-appearance

- ARIA: ref 199 lines vs cand 131 lines — missing 187, added 119, changed 0.
- Geometry sidebar: ref 280x840 @(aside) vs cand 240x874 @(aside[aria-label="Sidebar"]) — Δw -40, Δh 34, Δx 0, Δy -36.
- Geometry tablist: not measurable on one side(s) (ref sel —, cand sel [role="tablist"]).
- Geometry statusbar: ref 1440x24 @(bottom-bar-heuristic) vs cand 1440x26 @([class*="status-bar"]) — Δw 0, Δh 2, Δx 0, Δy -2.
- Geometry heading: ref 449x30 @(h2) vs cand 650x24 @(h2) — Δw 201, Δh -6, Δx 41, Δy 142.
- Headline: ref "Appearance" 24px/600 Geist vs cand "Settings" 14px/600 Geist Variable.
  - ref-only: "- complementary:"
  - ref-only: "- button "Back to app""
  - ref-only: "- textbox "Search settings""
  - ref-only: "- text: ⌘ F"
  - ref-only: "- button "Onboarding checklist, 4 of 8 done. Show setup guide.": Onboarding checklist"
  - ref-only: "- paragraph: AI Capabilities"
  - cand-only: "- complementary "Sidebar":"
  - cand-only: "- text: Drogon"
  - cand-only: "- button "Search workspaces and sessions": Search"
  - cand-only: "- button "Terminals""
  - cand-only: "- button "Files""
  - cand-only: "- button "Changes""
- ref note: Settings opened via Settings button
- ref note: teardown: Back to app from full-page view
- cand note: Settings panel opened
- cand note: teardown: dialog dismissed via Close button
- cand note: teardown: returned to Terminals route

### changes

- ARIA: ref 49 lines vs cand 68 lines — missing 40, added 59, changed 1.
- Geometry sidebar: ref 280x840 @([class*="sidebar"]) vs cand 240x874 @(aside[aria-label="Sidebar"]) — Δw -40, Δh 34, Δx 0, Δy -36.
- Geometry tablist: not measurable on one side(s) (ref sel —, cand sel [role="tablist"]).
- Geometry statusbar: ref 1440x24 @(bottom-bar-heuristic) vs cand 1440x26 @([class*="status-bar"]) — Δw 0, Δh 2, Δx 0, Δy -2.
- Geometry heading: ref 122x40 @(h1) vs cand 217x20 @(h2) — Δw 95, Δh -20, Δx 408, Δy -300.
- Headline: ref "Drogon" 36px/700 Geist vs cand "Staged (1)" 12px/400 Geist Variable.
  - text: ref "- button "Bots"" → cand "- button "Bots" [disabled]"
  - ref-only: "- button "Toggle sidebar""
  - ref-only: "- button "Go back""
  - ref-only: "- button "Go forward" [disabled]"
  - ref-only: "- button "Search worktrees and browser tabs": Search ⌘ J"
  - ref-only: "- button "Sessions""
  - ref-only: "- button "Meetings""
  - cand-only: "- complementary "Sidebar":"
  - cand-only: "- button "Search workspaces and sessions": Search"
  - cand-only: "- button "Terminals""
  - cand-only: "- button "Files""
  - cand-only: "- button "Changes""
  - cand-only: "- button "Browser""
- ref note: no Changes nav; captured current view
- ref note: teardown: returned home via Sessions
- ref MISSING: ref git fixture intentionally not created (reference is read-only)
- cand note: git fixture: one modified tracked file
- cand note: Changes route opened
- cand note: teardown: returned to Terminals route

### automations

- ARIA: ref 60 lines vs cand 56 lines — missing 49, added 45, changed 2.
- Geometry sidebar: ref 280x840 @([class*="sidebar"]) vs cand 240x874 @(aside[aria-label="Sidebar"]) — Δw -40, Δh 34, Δx 0, Δy -36.
- Geometry tablist: not measurable on one side(s) (ref sel —, cand sel [role="tablist"]).
- Geometry statusbar: ref 1440x24 @(bottom-bar-heuristic) vs cand 1440x26 @([class*="status-bar"]) — Δw 0, Δh 2, Δx 0, Δy -2.
- Geometry heading: ref 99x32 @(h1) vs cand 502x20 @(h2) — Δw 403, Δh -12, Δx -60, Δy 34.
- Headline: ref "Automations" 16px/600 Geist vs cand "Staged (1)" 12px/400 Geist Variable.
  - text: ref "- button "Bots"" → cand "- button "Bots" [disabled]"
  - text: ref "- heading "Automations" [level=1]" → cand "- heading "Automations" [level=2]"
  - ref-only: "- button "Toggle sidebar""
  - ref-only: "- button "Go back""
  - ref-only: "- button "Go forward" [disabled]"
  - ref-only: "- button "Search worktrees and browser tabs": Search"
  - ref-only: "- button "Sessions""
  - ref-only: "- button "Meetings""
  - cand-only: "- complementary "Sidebar":"
  - cand-only: "- button "Search workspaces and sessions": Search"
  - cand-only: "- button "Terminals""
  - cand-only: "- button "Files""
  - cand-only: "- button "Changes""
  - cand-only: "- button "Browser""
- ref note: Automations opened
- ref note: teardown: returned home via Sessions
- cand note: Automations nav opened
- cand note: teardown: returned to Terminals route

### browser

- ARIA: ref 49 lines vs cand 68 lines — missing 40, added 59, changed 1.
- Geometry sidebar: ref 280x840 @([class*="sidebar"]) vs cand 240x874 @(aside[aria-label="Sidebar"]) — Δw -40, Δh 34, Δx 0, Δy -36.
- Geometry tablist: not measurable on one side(s) (ref sel —, cand sel [role="tablist"]).
- Geometry statusbar: ref 1440x24 @(bottom-bar-heuristic) vs cand 1440x26 @([class*="status-bar"]) — Δw 0, Δh 2, Δx 0, Δy -2.
- Geometry heading: ref 122x40 @(h1) vs cand 217x20 @(h2) — Δw 95, Δh -20, Δx 408, Δy -300.
- Headline: ref "Drogon" 36px/700 Geist vs cand "Staged (1)" 12px/400 Geist Variable.
  - text: ref "- button "Bots"" → cand "- button "Bots" [disabled]"
  - ref-only: "- button "Toggle sidebar""
  - ref-only: "- button "Go back""
  - ref-only: "- button "Go forward" [disabled]"
  - ref-only: "- button "Search worktrees and browser tabs": Search"
  - ref-only: "- button "Sessions""
  - ref-only: "- button "Meetings""
  - cand-only: "- complementary "Sidebar":"
  - cand-only: "- button "Search workspaces and sessions": Search"
  - cand-only: "- button "Terminals""
  - cand-only: "- button "Files""
  - cand-only: "- button "Changes""
  - cand-only: "- button "Browser""
- ref note: captured current view instead
- ref note: teardown: returned home via Sessions
- ref MISSING: no Browser nav button in ref sidebar
- cand note: Browser route opened
- cand note: local file navigated in pane
- cand note: teardown: returned to Terminals route

### tasks

- ARIA: ref 60 lines vs cand 111 lines — missing 51, added 102, changed 1.
- Geometry sidebar: ref 280x840 @([class*="sidebar"]) vs cand 240x874 @(aside[aria-label="Sidebar"]) — Δw -40, Δh 34, Δx 0, Δy -36.
- Geometry tablist: not measurable on one side(s) (ref sel —, cand sel [role="tablist"]).
- Geometry statusbar: ref 1440x24 @(bottom-bar-heuristic) vs cand 1440x26 @([class*="status-bar"]) — Δw 0, Δh 2, Δx 0, Δy -2.
- Geometry heading: not measurable on one side(s) (ref sel —, cand sel h2).
  - text: ref "- button "Bots"" → cand "- button "Bots" [disabled]"
  - ref-only: "- button "Toggle sidebar""
  - ref-only: "- button "Go back""
  - ref-only: "- button "Go forward" [disabled]"
  - ref-only: "- button "Search worktrees and browser tabs": Search"
  - ref-only: "- button "Sessions""
  - ref-only: "- button "Meetings""
  - cand-only: "- complementary "Sidebar":"
  - cand-only: "- button "Search workspaces and sessions": Search"
  - cand-only: "- button "Terminals""
  - cand-only: "- button "Files""
  - cand-only: "- button "Changes""
  - cand-only: "- button "Browser""
- ref note: Tasks opened
- ref note: teardown: returned home via Sessions
- cand note: Tasks nav opened (may be coming-soon placeholder)
- cand note: teardown: returned to Terminals route

### bots

- ARIA: ref 51 lines vs cand 110 lines — missing 41, added 100, changed 1.
- Geometry sidebar: ref 280x840 @([class*="sidebar"]) vs cand 240x874 @(aside[aria-label="Sidebar"]) — Δw -40, Δh 34, Δx 0, Δy -36.
- Geometry tablist: not measurable on one side(s) (ref sel —, cand sel [role="tablist"]).
- Geometry statusbar: ref 1440x24 @(bottom-bar-heuristic) vs cand 1440x26 @([class*="status-bar"]) — Δw 0, Δh 2, Δx 0, Δy -2.
- Geometry heading: ref 877x24 @(h1) vs cand 217x20 @(h2) — Δw -660, Δh -4, Δx 819, Δy 66.
- Headline: ref "Bots" 16px/600 Geist vs cand "Staged (1)" 12px/400 Geist Variable.
  - text: ref "- button "Bots"" → cand "- button "Bots" [disabled]"
  - ref-only: "- button "Toggle sidebar""
  - ref-only: "- button "Go back""
  - ref-only: "- button "Go forward" [disabled]"
  - ref-only: "- button "Search worktrees and browser tabs": Search"
  - ref-only: "- button "Sessions""
  - ref-only: "- button "Meetings""
  - cand-only: "- complementary "Sidebar":"
  - cand-only: "- button "Search workspaces and sessions": Search"
  - cand-only: "- button "Terminals""
  - cand-only: "- button "Files""
  - cand-only: "- button "Changes""
  - cand-only: "- button "Browser""
- ref note: Bots opened
- ref note: teardown: returned home via Sessions
- cand note: teardown: returned to Terminals route
- cand MISSING: no Bots nav reachable

### statusbar-strip

- ARIA: ref 49 lines vs cand 110 lines — missing 40, added 101, changed 1.
- Geometry sidebar: ref 280x840 @([class*="sidebar"]) vs cand 240x874 @(aside[aria-label="Sidebar"]) — Δw -40, Δh 34, Δx 0, Δy -36.
- Geometry tablist: not measurable on one side(s) (ref sel —, cand sel [role="tablist"]).
- Geometry statusbar: ref 1440x24 @(bottom-bar-heuristic) vs cand 1440x26 @([class*="status-bar"]) — Δw 0, Δh 2, Δx 0, Δy -2.
- Geometry heading: ref 122x40 @(h1) vs cand 217x20 @(h2) — Δw 95, Δh -20, Δx 408, Δy -300.
- Headline: ref "Drogon" 36px/700 Geist vs cand "Staged (1)" 12px/400 Geist Variable.
  - text: ref "- button "Bots"" → cand "- button "Bots" [disabled]"
  - ref-only: "- button "Toggle sidebar""
  - ref-only: "- button "Go back""
  - ref-only: "- button "Go forward" [disabled]"
  - ref-only: "- button "Search worktrees and browser tabs": Search"
  - ref-only: "- button "Sessions""
  - ref-only: "- button "Meetings""
  - cand-only: "- complementary "Sidebar":"
  - cand-only: "- button "Search workspaces and sessions": Search"
  - cand-only: "- button "Terminals""
  - cand-only: "- button "Files""
  - cand-only: "- button "Changes""
  - cand-only: "- button "Browser""
- ref note: full-page capture; strip cropped in post
- ref note: cropped status strip saved as .strip.png
- cand note: full-page capture; strip cropped in post
- cand note: cropped status strip saved as .strip.png
- cand note: teardown: returned to Terminals route

## 3. Ranked differences (top 30 by user visibility)

Layout regions first, then typography, then copy/icons, then interactions. `both` = confirmed by source reading AND rendered comparison; `rendered-only` = seen rendered, source value to adopt is cited from the inventory file.

### 1. [layout] [both] [11 states: empty, project-terminal, palette, quick-open, settings-appearance, changes, automations, browser, tasks, bots, statusbar-strip] sidebar geometry differs (ref 280x840 vs cand 240x874)

- State: empty. Kind: geometry.
- Source (adopt this): `src/renderer/src/components/sidebar/index.tsx` — MIN_WIDTH: minWidth: MIN_WIDTH,
- Candidate file to change: `apps/desktop/src/renderer/src/features/shell/Sidebar.tsx, ProjectList.tsx, WorktreeCard.tsx`
- Detail: Δw -40px, Δh 34px, Δx 0px, Δy -36px.

### 2. [structure] [both] [10 states: empty, project-terminal, palette, quick-open, changes, automations, browser, tasks, bots, statusbar-strip] in ref but not candidate: "- button "Toggle sidebar""

- State: empty. Kind: aria-missing.
- Source (adopt this): `src/renderer/src/app-shell/TitlebarLeftControls.tsx` — Toggle sidebar: aria-label={translate('auto.App.e4b9e7dff7', 'Toggle sidebar')}
- Candidate file to change: `apps/desktop/src/renderer/src/features/shell/Sidebar.tsx`
- Detail: "- button "Toggle sidebar""

### 3. [structure] [both] [10 states: empty, project-terminal, palette, quick-open, changes, automations, browser, tasks, bots, statusbar-strip] in ref but not candidate: "- button "Go back""

- State: empty. Kind: aria-missing.
- Source (adopt this): `src/renderer/src/app-shell/TitlebarLeftControls.tsx` — Go back: aria-label={translate('auto.App.064bd07810', 'Go back')}
- Candidate file to change: `apps/desktop/src/renderer/src/features/shell/Sidebar.tsx`
- Detail: "- button "Go back""

### 4. [structure] [both] [10 states: empty, project-terminal, palette, quick-open, changes, automations, browser, tasks, bots, statusbar-strip] in ref but not candidate: "- button "Go forward" [disabled]"

- State: empty. Kind: aria-missing.
- Source (adopt this): `src/renderer/src/app-shell/TitlebarLeftControls.tsx` — Go forward: aria-label={translate('auto.App.cf9099fe98', 'Go forward')}
- Candidate file to change: `apps/desktop/src/renderer/src/features/shell/Sidebar.tsx`
- Detail: "- button "Go forward" [disabled]"

### 5. [structure] [both] [9 states: empty, project-terminal, palette, quick-open, automations, browser, tasks, bots, statusbar-strip] in ref but not candidate: "- button "Search worktrees and browser tabs": Search"

- State: empty. Kind: aria-missing.
- Source (adopt this): `src/renderer/src/components/sidebar/SidebarNav.tsx` — Search worktrees and browser tabs: 'Search worktrees and browser tabs'
- Candidate file to change: `apps/desktop/src/renderer/src/features/shell/SidebarNav.tsx`
- Detail: "- button "Search worktrees and browser tabs": Search"

### 6. [structure] [both] [changes] in ref but not candidate: "- button "Search worktrees and browser tabs": Search ⌘ J"

- State: changes. Kind: aria-missing.
- Source (adopt this): `src/renderer/src/components/sidebar/SidebarNav.tsx` — Search worktrees and browser tabs: 'Search worktrees and browser tabs'
- Candidate file to change: `apps/desktop/src/renderer/src/features/shell/SidebarNav.tsx`
- Detail: "- button "Search worktrees and browser tabs": Search ⌘ J"

### 7. [typography] [rendered-only] [empty] headline type differs (ref "Drogon" 36px/700 vs cand "A place for your next task" 18px/600)

- State: empty. Kind: headline.
- Source (adopt this): `src/renderer/src/assets/main.css` — --font-sans: --font-sans: var(--app-font-family);
- Candidate file to change: `apps/desktop/src/renderer/src/assets/main.css`

### 8. [typography] [rendered-only] [3 states: project-terminal, palette, quick-open] headline type differs (ref "Drogon" 36px/700 vs cand "Session" 13px/600)

- State: project-terminal. Kind: headline.
- Source (adopt this): `src/renderer/src/assets/main.css` — --font-sans: --font-sans: var(--app-font-family);
- Candidate file to change: `apps/desktop/src/renderer/src/assets/main.css`

### 9. [typography] [rendered-only] [settings-appearance] headline type differs (ref "Appearance" 24px/600 vs cand "Settings" 14px/600)

- State: settings-appearance. Kind: headline.
- Source (adopt this): `src/renderer/src/assets/main.css` — --font-sans: --font-sans: var(--app-font-family);
- Candidate file to change: `apps/desktop/src/renderer/src/assets/main.css`

### 10. [typography] [rendered-only] [3 states: changes, browser, statusbar-strip] headline type differs (ref "Drogon" 36px/700 vs cand "Staged (1)" 12px/400)

- State: changes. Kind: headline.
- Source (adopt this): `src/renderer/src/assets/main.css` — --font-sans: --font-sans: var(--app-font-family);
- Candidate file to change: `apps/desktop/src/renderer/src/assets/main.css`

### 11. [typography] [rendered-only] [automations] headline type differs (ref "Automations" 16px/600 vs cand "Staged (1)" 12px/400)

- State: automations. Kind: headline.
- Source (adopt this): `src/renderer/src/assets/main.css` — --font-sans: --font-sans: var(--app-font-family);
- Candidate file to change: `apps/desktop/src/renderer/src/assets/main.css`

### 12. [typography] [rendered-only] [bots] headline type differs (ref "Bots" 16px/600 vs cand "Staged (1)" 12px/400)

- State: bots. Kind: headline.
- Source (adopt this): `src/renderer/src/assets/main.css` — --font-sans: --font-sans: var(--app-font-family);
- Candidate file to change: `apps/desktop/src/renderer/src/assets/main.css`

### 13. [structure] [rendered-only] [11 states: empty, project-terminal, palette, quick-open, settings-appearance, changes, automations, browser, tasks, bots, statusbar-strip] in candidate but not ref: "- complementary "Sidebar":"

- State: empty. Kind: aria-added.
- Source (adopt this): `src/renderer/src/components/sidebar/index.tsx` — MIN_WIDTH: minWidth: MIN_WIDTH,
- Candidate file to change: `apps/desktop/src/renderer/src/features/shell/Sidebar.tsx, ProjectList.tsx, WorktreeCard.tsx`
- Detail: "- complementary "Sidebar":"

### 14. [structure] [rendered-only] [11 states: empty, project-terminal, palette, quick-open, settings-appearance, changes, automations, browser, tasks, bots, statusbar-strip] in candidate but not ref: "- button "Search workspaces and sessions": Search"

- State: empty. Kind: aria-added.
- Source (adopt this): `src/renderer/src/components/sidebar/index.tsx` — MIN_WIDTH: minWidth: MIN_WIDTH,
- Candidate file to change: `apps/desktop/src/renderer/src/features/shell/Sidebar.tsx, ProjectList.tsx, WorktreeCard.tsx`
- Detail: "- button "Search workspaces and sessions": Search"

### 15. [structure] [rendered-only] [empty] in candidate but not ref: "- button "Terminals" [disabled]"

- State: empty. Kind: aria-added.
- Source (adopt this): `src/renderer/src/components/sidebar/index.tsx` — MIN_WIDTH: minWidth: MIN_WIDTH,
- Candidate file to change: `apps/desktop/src/renderer/src/features/shell/Sidebar.tsx, ProjectList.tsx, WorktreeCard.tsx`
- Detail: "- button "Terminals" [disabled]"

### 16. [structure] [rendered-only] [empty] in candidate but not ref: "- button "Files" [disabled]"

- State: empty. Kind: aria-added.
- Source (adopt this): `src/renderer/src/components/sidebar/index.tsx` — MIN_WIDTH: minWidth: MIN_WIDTH,
- Candidate file to change: `apps/desktop/src/renderer/src/features/shell/Sidebar.tsx, ProjectList.tsx, WorktreeCard.tsx`
- Detail: "- button "Files" [disabled]"

### 17. [structure] [rendered-only] [project-terminal] reference side: ref project+terminal fixture intentionally not created (reference is read-only); captured current view

- State: project-terminal. Kind: ref-missing.
- Source (adopt this): `src/renderer/src/components/tab-bar/tab-bar-surface.tsx` — h-: className="group/tab-strip relative flex min-h-0 min-w-0 max-w-full flex-[0_1_auto]"
- Candidate file to change: `apps/desktop/src/renderer/src/features/shell/TabBar.tsx`
- Detail: "ref project+terminal fixture intentionally not created (reference is read-only); captured current view"

### 18. [structure] [rendered-only] [10 states: project-terminal, palette, quick-open, settings-appearance, changes, automations, browser, tasks, bots, statusbar-strip] in candidate but not ref: "- button "Terminals""

- State: project-terminal. Kind: aria-added.
- Source (adopt this): `src/renderer/src/components/tab-bar/tab-bar-surface.tsx` — h-: className="group/tab-strip relative flex min-h-0 min-w-0 max-w-full flex-[0_1_auto]"
- Candidate file to change: `apps/desktop/src/renderer/src/features/shell/TabBar.tsx`
- Detail: "- button "Terminals""

### 19. [structure] [rendered-only] [9 states: project-terminal, palette, quick-open, changes, automations, browser, tasks, bots, statusbar-strip] in candidate but not ref: "- button "Files""

- State: project-terminal. Kind: aria-added.
- Source (adopt this): `src/renderer/src/components/tab-bar/tab-bar-surface.tsx` — h-: className="group/tab-strip relative flex min-h-0 min-w-0 max-w-full flex-[0_1_auto]"
- Candidate file to change: `apps/desktop/src/renderer/src/features/shell/TabBar.tsx`
- Detail: "- button "Files""

### 20. [structure] [rendered-only] [palette] reference side: no palette overlay via Cmd+K nor Cmd+J

- State: palette. Kind: ref-missing.
- Source (adopt this): `src/renderer/src/components/cmd-j/palette-results.ts` — shortcut: shortcuts: ['keyboard shortcuts'],
- Candidate file to change: `apps/desktop/src/renderer/src/components/command-palette/CommandPalette.tsx + shortcuts.ts`
- Detail: "no palette overlay via Cmd+K nor Cmd+J"

### 21. [structure] [rendered-only] [quick-open] reference side: Cmd+P (worktree.quickOpen) opened no overlay in the empty ref

- State: quick-open. Kind: ref-missing.
- Source (adopt this): `src/renderer/src/components/cmd-j/palette-results.ts` — shortcut: shortcuts: ['keyboard shortcuts'],
- Candidate file to change: `apps/desktop/src/renderer/src/components/command-palette/CommandPalette.tsx + shortcuts.ts`
- Detail: "Cmd+P (worktree.quickOpen) opened no overlay in the empty ref"

### 22. [structure] [rendered-only] [settings-appearance] in ref but not candidate: "- complementary:"

- State: settings-appearance. Kind: aria-missing.
- Source (adopt this): `src/renderer/src/components/settings/AppearanceInterfaceSection.tsx` — aria-label: <SelectTrigger size="sm" className="min-w-[220px]" aria-label={languageTitle}>
- Candidate file to change: `apps/desktop/src/renderer/src/settings-panel.tsx`
- Detail: "- complementary:"

### 23. [structure] [rendered-only] [settings-appearance] in ref but not candidate: "- button "Back to app""

- State: settings-appearance. Kind: aria-missing.
- Source (adopt this): `src/renderer/src/components/settings/AppearanceInterfaceSection.tsx` — aria-label: <SelectTrigger size="sm" className="min-w-[220px]" aria-label={languageTitle}>
- Candidate file to change: `apps/desktop/src/renderer/src/settings-panel.tsx`
- Detail: "- button "Back to app""

### 24. [structure] [rendered-only] [settings-appearance] in ref but not candidate: "- textbox "Search settings""

- State: settings-appearance. Kind: aria-missing.
- Source (adopt this): `src/renderer/src/components/settings/AppearanceInterfaceSection.tsx` — aria-label: <SelectTrigger size="sm" className="min-w-[220px]" aria-label={languageTitle}>
- Candidate file to change: `apps/desktop/src/renderer/src/settings-panel.tsx`
- Detail: "- textbox "Search settings""

### 25. [structure] [rendered-only] [settings-appearance] in ref but not candidate: "- text: ⌘ F"

- State: settings-appearance. Kind: aria-missing.
- Source (adopt this): `src/renderer/src/components/settings/AppearanceInterfaceSection.tsx` — aria-label: <SelectTrigger size="sm" className="min-w-[220px]" aria-label={languageTitle}>
- Candidate file to change: `apps/desktop/src/renderer/src/settings-panel.tsx`
- Detail: "- text: ⌘ F"

### 26. [structure] [rendered-only] [settings-appearance] in candidate but not ref: "- text: Drogon"

- State: settings-appearance. Kind: aria-added.
- Source (adopt this): `src/renderer/src/components/settings/AppearanceInterfaceSection.tsx` — aria-label: <SelectTrigger size="sm" className="min-w-[220px]" aria-label={languageTitle}>
- Candidate file to change: `apps/desktop/src/renderer/src/settings-panel.tsx`
- Detail: "- text: Drogon"

### 27. [structure] [rendered-only] [changes] reference side: ref git fixture intentionally not created (reference is read-only)

- State: changes. Kind: ref-missing.
- Source (adopt this): `src/renderer/src/components/right-sidebar/source-control/panel/panel-content.tsx` — Stage: handleStage,
- Candidate file to change: `apps/desktop/src/renderer/src/features/source-control/`
- Detail: "ref git fixture intentionally not created (reference is read-only)"

### 28. [structure] [rendered-only] [browser] reference side: no Browser nav button in ref sidebar

- State: browser. Kind: ref-missing.
- Source (adopt this): `src/renderer/src/components/browser-pane/ClientHostedBrowserPagePane.tsx` — Back: <div className="relative flex h-full min-h-0 flex-1 flex-col bg-background">
- Candidate file to change: `apps/desktop/src/renderer/src/features/browser/`
- Detail: "no Browser nav button in ref sidebar"

### 29. [copy] [rendered-only] [10 states: empty, project-terminal, palette, quick-open, changes, automations, browser, tasks, bots, statusbar-strip] text differs: ref "- button "Bots"" vs cand "- button "Bots" [disabled]"

- State: empty. Kind: text.
- Source (adopt this): `src/renderer/src/components/sidebar/index.tsx` — MIN_WIDTH: minWidth: MIN_WIDTH,
- Candidate file to change: `apps/desktop/src/renderer/src/features/shell/Sidebar.tsx, ProjectList.tsx, WorktreeCard.tsx`
- Detail: ref "- button "Bots"" vs cand "- button "Bots" [disabled]".

### 30. [copy] [rendered-only] [empty] text differs: ref "- button "Automations"" vs cand "- button "Automations" [disabled]"

- State: empty. Kind: text.
- Source (adopt this): `src/renderer/src/components/sidebar/index.tsx` — MIN_WIDTH: minWidth: MIN_WIDTH,
- Candidate file to change: `apps/desktop/src/renderer/src/features/shell/Sidebar.tsx, ProjectList.tsx, WorktreeCard.tsx`
- Detail: ref "- button "Automations"" vs cand "- button "Automations" [disabled]".

## 4. Artifacts

- `.preflight/fidelity/<run>/<state>.{ref,cand}.{png,aria.yaml,dom.json}` (+ `.dark.*`, `statusbar-strip.*.strip.png`). PNG/HTML stay git-ignored; only this report.md is committed.
- `index.html` (ignored): side-by-side viewer for this run.
- Run dir: /Users/carlos/orca/workspaces/Drogon-rewrite/r5-f-fidelity/.preflight/fidelity/final
