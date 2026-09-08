// R5-F fidelity oracle: source-anchored rendered comparison of orca-drogon
// (reference, read-only) vs the Drogon rewrite candidate (owned processes).
//
// Usage:
//   node scripts/fidelity/compare-surfaces.mjs --ref <cdp-url> --out <dir>
//     [--cand <cdp-url>] [--states a,b,c] [--no-dark] [--keep]
//
// --ref  CDP http endpoint of the running orca-drogon dev app (confirmation
//        only: the script never creates data there, only navigates views and
//        opens/closes ephemeral overlays). Defaults to $ORCA_REFERENCE_CDP
//        when --ref is absent.
// --out  Output dir; default .preflight/fidelity/<timestamp>/.
// --cand Optional existing candidate CDP endpoint. When absent the script
//        launches its OWN production candidate: target/debug/drogond plus
//        Electron on apps/desktop (out/ production bundle) with
//        --remote-debugging-port=0, all inside a temp fixture it cleans up.
// --keep Leave owned candidate processes running (debugging only).
//
// Per state and per color scheme (light + dark at the requested viewport) it captures:
//   <state>.{ref,cand}.{png,aria.yaml,dom.json}
// plus a cropped status-bar strip, then writes report.md (ranked differences,
// each citing the reference SOURCE file and the candidate file to change)
// and index.html (side-by-side viewer). Exits 0 with a report on success.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { inflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { execFile } from "node:child_process";
import { chromium } from "playwright";
import {
  startAcceptanceProcess,
  stopAcceptanceProcess,
  runAcceptanceProcess,
} from "../acceptance-process.mjs";
import { emulatePageFocus } from "../acceptance-page-focus.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
// No implicit reference checkout: export $DROGON_SOURCE_ROOT (the read-only
// reference root the source inventory reads at runtime).
const REF_ROOT = process.env.DROGON_SOURCE_ROOT ?? null;
assert.ok(
  REF_ROOT,
  "Missing reference source root: set $DROGON_SOURCE_ROOT " +
    "to the read-only reference checkout for source-anchored diffs.",
);
const args = process.argv.slice(2);

// The normal oracle remains the 1440×900 desktop comparison. Narrow sweeps
// opt into the same state drivers with a real viewport override, allowing the
// source's responsive tiers to be compared without duplicating the drivers.
const viewportFlag = flag("--viewport", null);
const viewportMatch =
  typeof viewportFlag === "string" ? viewportFlag.match(/^(\d+)x(\d+)$/) : null;
assert.ok(
  viewportFlag === null || viewportMatch,
  `Invalid --viewport: ${String(viewportFlag)} (expected WIDTHxHEIGHT)`,
);
const requestedWidth = Number(flag("--width", viewportMatch ? viewportMatch[1] : 1440));
const requestedHeight = Number(flag("--height", viewportMatch ? viewportMatch[2] : 900));
assert.ok(
  Number.isFinite(requestedWidth) && requestedWidth > 0,
  `Invalid --width: ${requestedWidth}`,
);
assert.ok(
  Number.isFinite(requestedHeight) && requestedHeight > 0,
  `Invalid --height: ${requestedHeight}`,
);
const VIEWPORT = { width: requestedWidth, height: requestedHeight };

function flag(name, def = null) {
  const i = args.indexOf(name);
  if (i === -1) return def;
  if (i + 1 < args.length && !args[i + 1].startsWith("--")) return args[i + 1];
  return true;
}
const REF_CDP = flag("--ref", process.env.ORCA_REFERENCE_CDP ?? null);
assert.ok(
  REF_CDP,
  "Missing reference CDP endpoint: pass --ref <cdp-url> or set " +
    "ORCA_REFERENCE_CDP to the read-only orca-drogon dev app's CDP http endpoint.",
);
const CAND_CDP = flag("--cand", null);
const OUT = flag("--out", null);
const NO_DARK = args.includes("--no-dark");
const KEEP = args.includes("--keep");
const STATES_FILTER = flag("--states", null)?.split(",").map((s) => s.trim());
const WORKTREE_CARD_ROWS_WANTED =
  !STATES_FILTER ||
  STATES_FILTER.includes("worktree-card-rows") ||
  STATES_FILTER.includes("automation-run-detail") ||
  STATES_FILTER.includes("bots-history");
const BROWSER_FIXTURE_WANTED =
  !STATES_FILTER ||
  STATES_FILTER.includes("browser-tab-loading") ||
  STATES_FILTER.includes("address-bar-suggestions");

// ---------------------------------------------------------------------------
// Source inventory: MVP surface -> reference source anchors (read-only).
// The oracle reads these files at runtime; missing paths are recorded, never
// created. Expected values are extracted with the listed line patterns.
// ---------------------------------------------------------------------------
const SURFACES = [
  {
    id: "worktree-card-rows",
    label: "Worktree card with nested session rows",
    refDir: "src/renderer/src/components/sidebar",
    refFiles: [
      "src/renderer/src/components/sidebar/worktree-card-compact-agents.tsx",
      "src/renderer/src/components/sidebar/WorktreeCardAgents.tsx",
      "src/renderer/src/components/sidebar/WorktreeCard.tsx",
      "src/renderer/src/components/AgentStateDot.tsx",
    ],
    probes: ["session", "agent", "Working", "Waiting for input", "row", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/shell/WorktreeCard.tsx",
      "apps/desktop/src/renderer/src/features/shell/worktree-card-agent-summary.ts",
    ],
  },
  {
    id: "browser-tab-loading",
    label: "Browser tab loading strip",
    refDir: "src/renderer/src/components/browser-pane",
    refFiles: [
      "src/renderer/src/components/browser-pane/BrowserPane.tsx",
      "src/renderer/src/components/browser-pane/assemble-chrome/browser-navigation-control-row.tsx",
      "src/renderer/src/components/browser-pane/assemble-chrome/browser-page-chrome-header.tsx",
    ],
    probes: ["loading", "Reload", "aria-label", "spinner", "className"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/browser/browser-navigation-control-row.tsx",
      "apps/desktop/src/renderer/src/features/browser/browser-panel.tsx",
      "apps/desktop/src/renderer/src/features/shell/tab-strip/SortableBrowserTab.tsx",
    ],
  },
  {
    id: "address-bar-suggestions",
    label: "Browser address-bar suggestions",
    refDir: "src/renderer/src/components/browser-pane/assemble-chrome",
    refFiles: [
      "src/renderer/src/components/browser-pane/assemble-chrome/browser-address-bar-suggestions.ts",
      "src/renderer/src/components/browser-pane/assemble-chrome/browser-chrome-address-slot.ts",
      "src/renderer/src/components/browser-pane/assemble-chrome/browser-address-bar-edit-session.ts",
      "src/renderer/src/components/browser-pane/BrowserPane.tsx",
    ],
    probes: ["Search Google for", "recent", "suggestion", "address", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/browser/browser-address-bar.tsx",
      "apps/desktop/src/renderer/src/features/browser/browser-address-bar-suggestions.ts",
      "apps/desktop/src/renderer/src/features/browser/browser-recent-urls.ts",
    ],
  },
  {
    id: "editor-header",
    label: "Editor header controls",
    refDir: "src/renderer/src/components/editor",
    refFiles: [
      "src/renderer/src/components/editor/EditorPanelHeaderPath.tsx",
      "src/renderer/src/components/editor/EditorViewToggle.tsx",
      "src/renderer/src/components/editor/EditorPanelMarkdownActionsMenu.tsx",
      "src/renderer/src/components/editor/EditorPanel.tsx",
    ],
    probes: ["More actions", "Back to Edit", "Changes", "Edit", "path", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/editor/EditorPanelHeaderPath.tsx",
      "apps/desktop/src/renderer/src/features/editor/EditorViewToggle.tsx",
      "apps/desktop/src/renderer/src/features/editor/EditorPanelMarkdownActionsMenu.tsx",
      "apps/desktop/src/renderer/src/features/editor/EditorPane.tsx",
    ],
  },
  {
    id: "shell-sidebar",
    label: "Shell + sidebar",
    refDir: "src/renderer/src/components/sidebar",
    refFiles: [
      "src/renderer/src/components/Sidebar.tsx",
      "src/renderer/src/components/sidebar/index.tsx",
      "src/renderer/src/components/sidebar/SidebarNav.tsx",
      "src/renderer/src/components/sidebar/workspace-chrome-metrics.ts",
      "src/renderer/src/components/sidebar/SidebarHeader.tsx",
    ],
    probes: ["width", "w-[", "sidebar", "Projects", "aria-label", "sidebarWidth", "MIN_WIDTH", "MAX_WIDTH"],
    candFiles: ["apps/desktop/src/renderer/src/features/shell/Sidebar.tsx"],
  },
  {
    id: "tab-bar",
    label: "Tab bar",
    refDir: "src/renderer/src/components/tab-bar",
    refFiles: [
      "src/renderer/src/components/tab-bar/TabBar.tsx",
      "src/renderer/src/components/tab-bar/tab-bar-surface.tsx",
      "src/renderer/src/components/tab-bar/tab-width-rules.ts",
      "src/renderer/src/components/tab-bar/SortableTab.tsx",
    ],
    probes: ["height", "h-", "aria-selected", "role=\"tab\"", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/shell/TabBar.tsx"],
  },
  {
    id: "status-bar",
    label: "Status bar",
    refDir: "src/renderer/src/components/status-bar",
    refFiles: [
      "src/renderer/src/components/status-bar/StatusBar.tsx",
      "src/renderer/src/components/status-bar/StatusBarSurface.tsx",
      "src/renderer/src/components/status-bar/icons.tsx",
    ],
    probes: ["height", "h-", "Settings", "Help", "usage", "awake", "Ports"],
    candFiles: [
      "apps/desktop/src/renderer/src/components/status-bar/StatusBar.tsx",
    ],
  },
  {
    id: "palette",
    label: "Palette (Cmd+K) + quick open (Cmd+P)",
    refDir: "src/renderer/src/components/cmd-j",
    refFiles: [
      "src/renderer/src/components/cmd-j/palette-filter.ts",
      "src/renderer/src/components/cmd-j/palette-results.ts",
      "src/renderer/src/components/cmd-j/PaletteFilterChips.tsx",
    ],
    probes: ["cmd", "ctrl", "meta", "shortcut", "placeholder", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/components/command-palette/CommandPalette.tsx",
      "apps/desktop/src/renderer/src/shortcuts.ts",
    ],
  },
  {
    // R6: the "+" create menu's agent rows and the harness launch form
    // (Model / Initial prompt / Advanced / Launch). The fork launches
    // agents straight from QuickLaunchButton menu rows (no form); the
    // candidate opens a Pi form whose Model error is fork-exact.
    id: "launch-dialog",
    label: "Agent launch dialog (+ menu Pi form)",
    refDir: "src/renderer/src/components/tab-bar",
    refFiles: [
      "src/renderer/src/components/tab-bar/QuickLaunchButton.tsx",
      "src/renderer/src/components/tab-bar/tab-agent-launch-options.ts",
      "src/renderer/src/lib/launch-drogon-bot-session.ts",
    ],
    probes: ["Launch", "provider/model", "Model", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/shell/TabCreateMenu.tsx",
      "apps/desktop/src/renderer/src/features/shell/pi-model-mapping.ts",
    ],
  },
  {
    id: "workspace-composer",
    label: "New workspace composer",
    refDir: "src/renderer/src/components/new-workspace",
    refFiles: [
      "src/renderer/src/components/NewWorkspaceComposerCard.tsx",
      "src/renderer/src/components/NewWorkspaceComposerModal.tsx",
      "src/renderer/src/components/new-workspace/NewWorkspaceComposerProjectSection.tsx",
      "src/renderer/src/components/new-workspace/NewWorkspaceComposerAdvancedSection.tsx",
    ],
    probes: ["New workspace", "Project", "Agent", "Run target", "Advanced", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/new-workspace/NewWorkspaceComposer.tsx",
      "apps/desktop/src/renderer/src/features/new-workspace/NewWorkspaceComposerModal.tsx",
      "apps/desktop/src/renderer/src/features/new-workspace/composer-submit.ts",
    ],
  },
  {
    id: "settings",
    label: "Settings (Appearance)",
    refDir: "src/renderer/src/components/settings",
    refFiles: [
      "src/renderer/src/components/settings/AppearancePane.tsx",
      "src/renderer/src/components/settings/AppearanceInterfaceSection.tsx",
      "src/renderer/src/components/settings/AdvancedPane.tsx",
    ],
    probes: ["Appearance", "Theme", "aria-label", "role=\"dialog\""],
    candFiles: ["apps/desktop/src/renderer/src/settings-panel.tsx"],
  },
  {
    id: "settings-appearance-system",
    label: "Settings (Appearance — System theme)",
    refDir: "src/renderer/src/components/settings",
    refFiles: [
      "src/renderer/src/components/settings/AppearancePane.tsx",
      "src/renderer/src/components/settings/AppearanceInterfaceSection.tsx",
      "src/renderer/src/components/settings/AdvancedPane.tsx",
    ],
    probes: ["Theme", "System", "Dark", "Light", "prefers-color-scheme", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/settings/appearance-section.tsx",
      "apps/desktop/src/renderer/src/features/settings/native-theme-sync.ts",
      "apps/desktop/src/renderer/src/theme.ts",
    ],
  },
  {
    id: "changes",
    label: "Changes / diff",
    refDir: "src/renderer/src/components/right-sidebar/source-control",
    refFiles: [
      "src/renderer/src/components/right-sidebar/source-control/panel/panel-content.tsx",
      "src/renderer/src/components/right-sidebar/source-control/panel/commit-surface.tsx",
      "src/renderer/src/components/right-sidebar/source-control/listing/uncommitted-sections.tsx",
      "src/renderer/src/components/right-sidebar/source-control/review/hosted-review-header-chrome.tsx",
    ],
    probes: ["Stage", "Commit", "Push", "aria-label", "diff"],
    candFiles: ["apps/desktop/src/renderer/src/features/source-control/"],
  },
  {
    id: "explorer",
    label: "Explorer panel",
    refDir: "src/renderer/src/components/right-sidebar",
    refFiles: [
      "src/renderer/src/components/right-sidebar/FileExplorerToolbar.tsx",
      "src/renderer/src/components/right-sidebar/FileExplorerNameFilter.tsx",
      "src/renderer/src/components/right-sidebar/file-explorer-entries.ts",
    ],
    probes: ["Find files", "Collapse All", "Explorer", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/file-explorer/"],
  },
  {
    id: "automations",
    label: "Automations page",
    refDir: "src/renderer/src/components/automations",
    refFiles: [
      "src/renderer/src/components/automations/AutomationsPage.tsx",
      "src/renderer/src/components/automations/AutomationEditorDialog.tsx",
      "src/renderer/src/components/automations/automation-page-parts.tsx",
    ],
    probes: ["Automations", "Schedule", "cron", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/automations/"],
  },
  {
    id: "shortcuts-status-rail",
    label: "Settings (Shortcut status rail)",
    refDir: "src/renderer/src/components/settings",
    refFiles: [
      "src/renderer/src/components/settings/ShortcutsPane.tsx",
      "src/renderer/src/components/settings/ShortcutFilterRail.tsx",
      "src/renderer/src/components/settings/ShortcutRowsList.tsx",
    ],
    probes: ["Modified", "Unassigned", "Conflicts", "Shortcut status", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/settings/shortcuts-section.tsx",
      "apps/desktop/src/renderer/src/features/settings/shortcut-status-rail.tsx",
    ],
  },
  {
    id: "automation-editor-cron-preview",
    label: "Automation editor (custom cron preview)",
    refDir: "src/renderer/src/components/automations",
    refFiles: [
      "src/renderer/src/components/automations/AutomationEditorDialog.tsx",
      "src/renderer/src/components/automations/AutomationSchedulePicker.tsx",
      "src/renderer/src/components/automations/AutomationCustomCronPanel.tsx",
    ],
    probes: ["Custom cron", "Cron expression", "Next runs", "preview", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/automations/AutomationEditorDialog.tsx",
      "apps/desktop/src/renderer/src/features/automations/AutomationSchedulePicker.tsx",
      "apps/desktop/src/renderer/src/features/automations/AutomationCustomCronPanel.tsx",
    ],
  },
  {
    id: "browser",
    label: "Browser pane",
    refDir: "src/renderer/src/components/browser-pane",
    refFiles: [
      "src/renderer/src/components/browser-pane/BrowserPane.tsx",
      "src/renderer/src/components/browser-pane/ClientHostedBrowserPagePane.tsx",
    ],
    probes: ["address", "Back", "Forward", "Reload", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/browser/"],
  },
  {
    id: "tasks",
    label: "Tasks page",
    refDir: "src/renderer/src/components/task-page",
    refFiles: [
      "src/renderer/src/components/task-page/TaskPage.tsx",
      "src/renderer/src/components/task-page/ListChrome.tsx",
      "src/renderer/src/components/task-page/github/List.tsx",
    ],
    probes: ["Tasks", "Issues", "Filter", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/shell/SidebarNav.tsx"],
  },
  {
    // R16-P: the only state with deterministic rows. The candidate
    // daemon resolves `gh` from a fixture bin dir (see
    // ensureTasksRowsFixtureBin) that answers `issue/pr list` from
    // canned JSON, so no GitHub account or network is touched; the
    // reference side only navigates and lists its real rows.
    id: "tasks-rows",
    label: "Tasks page with rows (fixture GitHub data)",
    refDir: "src/renderer/src/components/task-page",
    refFiles: [
      "src/renderer/src/components/task-page/github/Rows.tsx",
      "src/renderer/src/components/task-page/github/List.tsx",
      "src/renderer/src/components/task-page/PaginationBar.tsx",
    ],
    probes: ["github-task-row", "Start workspace", "Pagination", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/tasks/task-page/github/Rows.tsx"],
  },
  {
    // R5: the only state with a dirty git worktree. The candidate
    // registers a real git project through drogon-cli (the right
    // activity bar's gitOnly gate hides Source Control for folder
    // projects), then dirties one tracked file plus one untracked
    // file; the reference side only opens its own panel
    // (navigate-only, ref owns its data).
    id: "source-control-dirty",
    label: "Source Control panel with uncommitted changes (git fixture)",
    refDir: "src/renderer/src/components/right-sidebar/source-control",
    refFiles: [
      "src/renderer/src/components/right-sidebar/source-control/panel/panel-content.tsx",
      "src/renderer/src/components/right-sidebar/source-control/listing/uncommitted-sections.tsx",
      "src/renderer/src/components/right-sidebar/source-control/listing/section-header.tsx",
    ],
    probes: ["Unstaged", "Untracked", "Commit message", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/source-control/uncommitted-sections.tsx"],
  },
  {
    id: "bots-empty-and-list",
    label: "Bots page (empty and list states)",
    refDir: "src/renderer/src/components/bots",
    refFiles: [
      "src/renderer/src/components/bots/BotsPage.tsx",
      "src/renderer/src/components/bots/BotsPageStates.tsx",
      "src/renderer/src/components/bots/BotResponsibilityCard.tsx",
    ],
    probes: ["No Bots yet", "Create Bot", "role=\"list\"", "Bots", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/bots/BotsPanel.tsx",
      "apps/desktop/src/renderer/src/features/bots/BotsPageStates.tsx",
      "apps/desktop/src/renderer/src/features/bots/BotResponsibilityCard.tsx",
    ],
  },
  {
    id: "bots",
    label: "Bots page",
    refDir: "src/renderer/src/components/bots",
    refFiles: [
      "src/renderer/src/components/bots/BotsPage.tsx",
      "src/renderer/src/components/bots/BotsPageForms.tsx",
      "src/renderer/src/components/bots/use-bots-page-controller.ts",
    ],
    probes: ["Bots", "preset", "chat", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/bots/"],
  },
  {
    id: "sidebar-menus",
    label: "Sidebar menus (worktree, options, project actions)",
    refDir: "src/renderer/src/components/sidebar",
    refFiles: [
      "src/renderer/src/components/sidebar/SidebarSettingsHelpMenu.tsx",
      "src/renderer/src/components/sidebar/FilterToggleRow.tsx",
      "src/renderer/src/components/sidebar/DeleteWorktreeDialog.tsx",
    ],
    probes: ["Workspace options", "Project actions", "Delete", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/shell/project-actions-menu.tsx",
      "apps/desktop/src/renderer/src/features/shell/WorktreeContextMenu.tsx",
    ],
  },
  {
    id: "tab-menus",
    label: "Tab menus (create + context)",
    refDir: "src/renderer/src/components/tab-bar",
    refFiles: [
      "src/renderer/src/components/tab-bar/tab-bar-static-create-menu.tsx",
      "src/renderer/src/components/terminal/terminal-tab-actions.ts",
      "src/renderer/src/components/terminal/terminal-tab-bulk-actions.ts",
    ],
    probes: ["New Terminal", "Pin", "Close", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/shell/TabCreateMenu.tsx",
      "apps/desktop/src/renderer/src/features/shell/TabContextMenu.tsx",
    ],
  },
  {
    id: "right-rail",
    label: "Right activity rail + panels",
    refDir: "src/renderer/src/components/right-sidebar",
    refFiles: [
      "src/renderer/src/components/right-sidebar/activity-bar-buttons.tsx",
      "src/renderer/src/components/right-sidebar/FileExplorerToolbar.tsx",
      "src/renderer/src/components/right-sidebar/local-workspace-ports-panel.tsx",
    ],
    probes: ["Explorer", "Source Control", "Ports", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/right-sidebar/RightSidebar.tsx",
      "apps/desktop/src/renderer/src/features/file-explorer/FileExplorerMenus.tsx",
      "apps/desktop/src/renderer/src/features/ports/PortsPanel.tsx",
    ],
  },
  {
    id: "dialogs",
    label: "Confirm dialogs (delete worktree, remove project)",
    refDir: "src/renderer/src/components/sidebar",
    refFiles: [
      "src/renderer/src/components/sidebar/DeleteWorktreeDialog.tsx",
      "src/renderer/src/components/settings/RepositoryPane.tsx",
      "src/renderer/src/components/terminal-pane/CloseTerminalDialog.tsx",
    ],
    probes: ["Delete", "Remove", "Cancel", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/shell/DeleteWorktreeDialog.tsx",
      "apps/desktop/src/renderer/src/features/shell/RemoveProjectDialog.tsx",
    ],
  },
  {
    id: "settings-general",
    label: "Settings (General pane)",
    refDir: "src/renderer/src/components/settings",
    refFiles: [
      "src/renderer/src/components/settings/GeneralPane.tsx",
      "src/renderer/src/components/settings/GeneralWorkspaceSettingsSection.tsx",
      "src/renderer/src/components/settings/CliSection.tsx",
    ],
    probes: ["General", "Workspace Directory", "Auto Save", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/settings/SettingsPage.tsx",
      "apps/desktop/src/renderer/src/features/settings/settings-sections.ts",
    ],
  },
  {
    id: "tokens",
    label: "Design tokens + styleguide",
    refDir: "src/renderer/src/assets",
    refFiles: ["src/renderer/src/assets/main.css", "docs/STYLEGUIDE.md"],
    probes: [
      "--background",
      "--sidebar",
      "--font-sans",
      "--radius",
      "--muted-foreground",
      "monochrome",
    ],
    candFiles: ["apps/desktop/src/renderer/src/assets/main.css"],
  },
  {
    id: "settings-terminal",
    label: "Settings (Terminal pane)",
    refDir: "src/renderer/src/components/settings",
    refFiles: [
      "src/renderer/src/components/settings/TerminalPane.tsx",
      "src/renderer/src/components/settings/TerminalAppearanceSection.tsx",
    ],
    probes: ["Terminal", "font", "GPU", "rendering", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/settings/terminal-typography.ts"],
  },
  {
    id: "settings-agents",
    label: "Settings (Agents pane)",
    refDir: "src/renderer/src/components/settings",
    refFiles: [
      "src/renderer/src/components/settings/AgentsPane.tsx",
      "src/renderer/src/components/settings/AgentDefaultSetting.tsx",
    ],
    probes: ["Agents", "harness", "default", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/settings/agents-section.tsx"],
  },
  {
    id: "settings-notifications",
    label: "Settings (Notifications pane)",
    refDir: "src/renderer/src/components/settings",
    refFiles: [
      "src/renderer/src/components/settings/NotificationsPane.tsx",
      "src/renderer/src/components/settings/NotificationSoundSection.tsx",
    ],
    probes: [
      "Notifications",
      "Enable Notifications",
      "Agent Task Complete",
      "Terminal Bell",
      "Suppress While Focused",
      "aria-label",
    ],
    candFiles: ["apps/desktop/src/renderer/src/features/settings/notifications-section.tsx"],
  },
  {
    id: "settings-git",
    label: "Settings (Git pane)",
    refDir: "src/renderer/src/components/settings",
    refFiles: [
      "src/renderer/src/components/settings/GitPane.tsx",
      "src/renderer/src/components/settings/CompareAgainstUpstreamSetting.tsx",
    ],
    probes: ["Git", "Branch Prefix", "Compare Base", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/settings/git-section.tsx"],
  },
  {
    id: "settings-shortcuts",
    label: "Settings (Shortcuts pane)",
    refDir: "src/renderer/src/components/settings",
    refFiles: [
      "src/renderer/src/components/settings/ShortcutsPane.tsx",
      "src/renderer/src/components/settings/shortcut-groups.ts",
    ],
    probes: ["Shortcuts", "chord", "shortcut", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/settings/shortcuts-section.tsx"],
  },
  {
    id: "terminal-find",
    label: "Terminal find bar",
    refDir: "src/renderer/src/components",
    refFiles: [
      "src/renderer/src/components/TerminalSearch.tsx",
      "src/renderer/src/components/terminal-search-safe-find.ts",
    ],
    probes: ["search", "find", "match", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/terminal/TerminalSearch.tsx"],
  },
  {
    id: "browser-find",
    label: "Browser find in page",
    refDir: "src/renderer/src/components/browser-pane/assemble-chrome",
    refFiles: [
      "src/renderer/src/components/browser-pane/assemble-chrome/BrowserFind.tsx",
      "src/renderer/src/components/browser-pane/assemble-chrome/browser-page-context-menu.tsx",
    ],
    probes: ["find", "match", "menu", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/browser/browser-find-bar.tsx",
      "apps/desktop/src/renderer/src/features/browser/browser-find-state.ts",
      "apps/desktop/src/renderer/src/features/browser/browser-page-context-menu.tsx",
    ],
  },
  {
    id: "mentu",
    label: "Mentu panel",
    refDir: "src/renderer/src/components/mentu",
    refFiles: [
      "src/renderer/src/components/mentu/MentuPanel.tsx",
      "src/renderer/src/components/mentu/RecipePaneHeader.tsx",
    ],
    probes: ["recipe", "run", "evidence", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/mentu/MentuPanel.tsx"],
  },
  {
    id: "session-details",
    label: "Session details panel",
    refDir: "src/renderer/src/components/right-sidebar",
    refFiles: [
      "src/renderer/src/components/right-sidebar/SessionRowTrailingActions.tsx",
    ],
    probes: ["session", "details", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/right-sidebar/SessionDetailsPanel.tsx"],
  },
  {
    id: "automation-runs",
    label: "Automation runs dashboard",
    refDir: "src/renderer/src/components/automations",
    refFiles: [
      "src/renderer/src/components/automations/AutomationRunsDashboard.tsx",
      "src/renderer/src/components/automations/AutomationsPageBreadcrumb.tsx",
      "src/renderer/src/components/automations/ExternalAutomationRunTable.tsx",
    ],
    probes: ["Runs", "dashboard", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/automations/AutomationRunsDashboard.tsx"],
  },
  {
    id: "bot-responsibilities",
    label: "Bot responsibilities",
    refDir: "src/renderer/src/components/bots",
    refFiles: [
      "src/renderer/src/components/bots/BotsPage.tsx",
      "src/renderer/src/components/bots/BotResponsibilityCard.tsx",
      "src/renderer/src/components/bots/BotsPageForms.tsx",
    ],
    probes: ["Responsibility", "history", "cron", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/bots/BotResponsibilityCard.tsx"],
  },
  {
    id: "toasts",
    label: "Toasts (sonner)",
    refDir: "src/renderer/src/components/ui",
    refFiles: [
      "src/renderer/src/components/ui/sonner.tsx",
      "src/renderer/src/components/terminal-pane/TerminalContextMenu.tsx",
    ],
    probes: ["toast", "Toaster", "Copy Terminal ID", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/components/ui/sonner.tsx"],
  },
  {
    id: "editor-tab",
    label: "Editor file tab",
    refDir: "src/renderer/src/components/tab-bar",
    refFiles: [
      "src/renderer/src/components/tab-bar/EditorFileTab.tsx",
      "src/renderer/src/components/tab-bar/EditorFileTabCloseButton.tsx",
      "src/renderer/src/components/tab-group/TabGroupPanel.tsx",
    ],
    probes: ["isDirty", "dirty", "Save", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/shell/editor-tab.ts",
      "apps/desktop/src/renderer/src/features/editor/EditorPane.tsx",
    ],
  },
  {
    id: "split-terminal",
    label: "Split terminal right",
    refDir: "src/renderer/src/components/terminal-pane",
    refFiles: [
      "src/renderer/src/components/terminal-pane/TerminalContextMenu.tsx",
      "src/renderer/src/components/terminal-pane/TerminalPaneHeaderOverlay.tsx",
      "src/renderer/src/components/tab-group/TabGroupSplitLayout.tsx",
    ],
    probes: ["Split Terminal Right", "split", "sash", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/terminal/TerminalSplitHost.tsx",
      "apps/desktop/src/renderer/src/features/terminal/TerminalSplitHeaderOverlay.tsx",
      "apps/desktop/src/renderer/src/features/terminal/TerminalContextMenu.tsx",
    ],
  },
  {
    id: "agent-state",
    label: "Agent-state visuals",
    refDir: "src/renderer/src/components",
    refFiles: [
      "src/renderer/src/components/AgentStateDot.tsx",
      "src/renderer/src/components/AgentWorkingSpinner.tsx",
      "src/renderer/src/components/tab-bar/TerminalTabLeadingIcon.tsx",
      "src/renderer/src/components/sidebar/worktree-card-compact-agents.tsx",
    ],
    probes: ["Working", "Waiting for input", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/shell/agent-state.ts",
      "apps/desktop/src/renderer/src/features/shell/AgentStateIcon.tsx",
      "apps/desktop/src/renderer/src/features/shell/worktree-card-agent-summary.ts",
    ],
  },
  {
    id: "workspace-composer",
    label: "New workspace composer",
    refDir: "src/renderer/src/components/new-workspace",
    refFiles: [
      "src/renderer/src/components/NewWorkspaceComposerCard.tsx",
      "src/renderer/src/components/NewWorkspaceComposerModal.tsx",
      "src/renderer/src/components/new-workspace/NewWorkspaceComposerProjectSection.tsx",
      "src/renderer/src/components/new-workspace/NewWorkspaceComposerAdvancedSection.tsx",
    ],
    probes: ["New workspace", "Project", "Agent", "Run target", "Advanced", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/new-workspace/NewWorkspaceComposer.tsx",
      "apps/desktop/src/renderer/src/features/new-workspace/NewWorkspaceComposerModal.tsx",
      "apps/desktop/src/renderer/src/features/new-workspace/composer-submit.ts",
    ],
  },
  {
    id: "session-details-panel",
    label: "Session details panel",
    refDir: "src/renderer/src/components/right-sidebar",
    refFiles: [
      "src/renderer/src/components/right-sidebar/SessionRowTrailingActions.tsx",
      "src/renderer/src/components/right-sidebar/AiVaultSessionDetails.tsx",
      "src/renderer/src/components/right-sidebar/AiVaultSessionRow.tsx",
    ],
    probes: ["Session details", "Details", "harness", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/right-sidebar/SessionDetailsPanel.tsx",
      "apps/desktop/src/renderer/src/features/shell/WorktreeAgentRow.tsx",
    ],
  },
  {
    id: "ports-listening",
    label: "Ports panel with listening server",
    refDir: "src/renderer/src/components/right-sidebar",
    refFiles: [
      "src/renderer/src/components/right-sidebar/local-workspace-ports-panel.tsx",
      "src/renderer/src/components/right-sidebar/local-port-section.tsx",
      "src/renderer/src/components/right-sidebar/local-port-details-dialog.tsx",
    ],
    probes: ["Ports", "Listening", "Open in Browser", "Details", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/ports/PortsPanel.tsx",
      "apps/desktop/src/renderer/src/features/ports/local-workspace-ports-panel.tsx",
      "apps/desktop/src/renderer/src/features/ports/local-port-details-dialog.tsx",
    ],
  },
  {
    id: "explorer-selected-file",
    label: "Explorer nested tree with selected file",
    refDir: "src/renderer/src/components/right-sidebar",
    refFiles: [
      "src/renderer/src/components/right-sidebar/FileExplorer.tsx",
      "src/renderer/src/components/right-sidebar/file-explorer-entries.ts",
      "src/renderer/src/components/right-sidebar/FileExplorerToolbar.tsx",
    ],
    probes: ["Find files", "Collapse All", "selected", "tree", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/file-explorer/FileExplorer.tsx",
      "apps/desktop/src/renderer/src/features/file-explorer/FileExplorerTreePane.tsx",
      "apps/desktop/src/renderer/src/features/file-explorer/FileExplorerRow.tsx",
    ],
  },
  {
    id: "editor-dirty-close",
    label: "Dirty editor tab close confirmation",
    refDir: "src/renderer/src/components/tab-bar",
    refFiles: [
      "src/renderer/src/components/tab-bar/EditorFileTab.tsx",
      "src/renderer/src/components/tab-bar/EditorFileTabCloseButton.tsx",
      "src/renderer/src/components/tab-group/useTabGroupTabCloseCommands.ts",
      "src/renderer/src/components/editor/editor-autosave.ts",
    ],
    probes: ["isDirty", "unsaved", "Save", "Discard", "close", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/shell/tab-strip/EditorStripTab.tsx",
      "apps/desktop/src/renderer/src/features/shell/TabBar.tsx",
      "apps/desktop/src/renderer/src/App.tsx",
    ],
  },
  {
    id: "automation-run-detail",
    label: "Automation run detail",
    refDir: "src/renderer/src/components/automations",
    refFiles: [
      "src/renderer/src/components/automations/AutomationRunsDashboard.tsx",
      "src/renderer/src/components/automations/AutomationRunDetailsPage.tsx",
      "src/renderer/src/components/automations/AutomationRunPageFrame.tsx",
    ],
    probes: ["Run details", "Output", "Host", "Prompt", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/automations/AutomationRunDetailsPage.tsx",
      "apps/desktop/src/renderer/src/features/automations/AutomationRunPageFrame.tsx",
      "apps/desktop/src/renderer/src/features/automations/automation-run-content.ts",
    ],
  },
  {
    id: "bots-history",
    label: "Bots history",
    refDir: "src/renderer/src/components/bots",
    refFiles: [
      "src/renderer/src/components/bots/BotsPage.tsx",
      "src/renderer/src/components/bots/BotResponsibilityCard.tsx",
      "src/renderer/src/components/bots/bots-page-model.ts",
    ],
    probes: ["History", "Responsibility history", "Scheduled", "Manual", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/bots/BotsPanel.tsx",
      "apps/desktop/src/renderer/src/features/bots/BotResponsibilityCard.tsx",
      "apps/desktop/src/renderer/src/features/bots/bots-panel-projection.ts",
    ],
  },
  {
    id: "mentu-evidence",
    label: "Mentu Evidence tab",
    refDir: "src/renderer/src/components/mentu",
    refFiles: [
      "src/renderer/src/components/mentu/MentuPanel.tsx",
      "src/renderer/src/components/mentu/recipe-pane-views.tsx",
      "src/renderer/src/components/mentu/recipe-pane-inspector.tsx",
    ],
    probes: ["Evidence", "stdout", "stderr", "No evidence", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/features/mentu/MentuPanel.tsx",
      "apps/desktop/src/renderer/src/features/mentu/RecipePaneContent.tsx",
      "apps/desktop/src/renderer/src/features/mentu/RecipePaneInspector.tsx",
    ],
  },
];

function scoreProbeLine(line) {
  const l = line.toLowerCase();
  let score = 0;
  if (l.includes("classname")) score += 3;
  if (l.includes("aria-")) score += 3;
  if (/\d+px/.test(l)) score += 3;
  if (l.includes("width") || l.includes("height")) score += 2;
  if (l.includes("--")) score += 2;
  if (l.includes("translate(") || l.includes("copy")) score += 1;
  if (l.includes("import ")) score -= 4;
  if (l.trim().startsWith("//") || l.trim().startsWith("*")) score -= 2;
  return score;
}

async function buildInventory() {
  const { readdir } = await import("node:fs/promises");
  const entries = [];
  for (const surface of SURFACES) {
    const found = [];
    for (const rel of surface.refFiles) {
      const abs = path.join(REF_ROOT, rel);
      if (!existsSync(abs)) {
        found.push({ file: rel, exists: false, matches: [] });
        continue;
      }
      let text = null;
      try {
        text = await readFile(abs, "utf8");
      } catch {
        found.push({ file: rel, exists: true, matches: ["(unreadable)"] });
        continue;
      }
      // Round-robin across probes (rank 0 of every probe, then rank 1, …)
      // up to 8: every probe stays represented, otherwise px-heavy lines
      // starve the font probes.
      const seen = new Set();
      const matches = [];
      const groups = surface.probes.map((probe) => {
        const group = [];
        for (const line of text.split("\n")) {
          if (line.toLowerCase().includes(probe.toLowerCase())) {
            const trimmed = line.trim().slice(0, 170);
            if (trimmed && !group.some((g) => g.line === trimmed))
              group.push({ probe, line: trimmed, score: scoreProbeLine(line) });
          }
        }
        group.sort((a, b) => b.score - a.score);
        return group.slice(0, 3);
      });
      for (let rank = 0; rank < 3 && matches.length < 8; rank++) {
        for (const group of groups) {
          if (matches.length >= 8) break;
          const s = group[rank];
          if (!s || seen.has(s.line)) continue;
          seen.add(s.line);
          matches.push(`${s.probe}: ${s.line}`);
        }
      }
      found.push({ file: rel, exists: true, matches });
    }
    // Exact source components: list the surface directory (non-test first).
    let dirListing = [];
    if (surface.refDir) {
      try {
        const names = await readdir(path.join(REF_ROOT, surface.refDir));
        const rank = (n) =>
          n.endsWith(".test.tsx") || n.endsWith(".test.ts") ? 2 : n.startsWith("use-") ? 1 : 0;
        dirListing = names
          .filter((n) => !n.startsWith("."))
          .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
          .slice(0, 24);
      } catch {
        dirListing = ["(dir not found)"];
      }
    }
    entries.push({ ...surface, ref: found, dirListing });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Normalization: paths/usernames are never differences.
// ---------------------------------------------------------------------------
export function normalizeText(value) {
  return String(value)
    .replace(/\/Users\/[^/\s]+/g, "<HOME>")
    .replace(/\/private\/var\/folders\/[^\s"']*/g, "<TMP>")
    .replace(/\/var\/folders\/[^\s"']*/g, "<TMP>")
    .replace(/\/tmp\/[^\s"']*/g, "<TMP>")
    .replace(/\b[a-f0-9]{7,40}\b/gi, "<HASH>")
    .replace(/[0-9]+h\s+[0-9]+m/g, "<DUR>")
    .replace(/[0-9]+d\s+[0-9]+h/g, "<DUR>")
    .replace(/\s+/g, " ")
    .trim();
}

function ariaLines(snapshot) {
  return String(snapshot || "")
    .split("\n")
    .map((l) => normalizeText(l))
    .filter(Boolean);
}

// Multiset diff with "changed" pairing: a ref-only line and a cand-only line
// sharing the same `- <role>` prefix and indentation count as a text change.
export function diffAria(refSnap, candSnap) {
  const ref = ariaLines(refSnap);
  const cand = ariaLines(candSnap);
  const refCount = new Map();
  const candCount = new Map();
  for (const l of ref) refCount.set(l, (refCount.get(l) ?? 0) + 1);
  for (const l of cand) candCount.set(l, (candCount.get(l) ?? 0) + 1);
  const refOnly = [];
  const candOnly = [];
  for (const [l, n] of refCount) {
    const m = candCount.get(l) ?? 0;
    for (let i = 0; i < n - Math.min(n, m); i++) refOnly.push(l);
  }
  for (const [l, n] of candCount) {
    const m = refCount.get(l) ?? 0;
    for (let i = 0; i < n - Math.min(n, m); i++) candOnly.push(l);
  }
  // Pair key: ARIA role plus the control's accessible name (first quoted
  // string). The same control in a different state (e.g. [disabled] toggled)
  // pairs as "changed"; different controls fall to missing/added instead of
  // being force-paired into misleading "text differs" rows.
  const pairKey = (l) => {
    const m = l.match(/^(\s*-\s*[\w]+)(.*)$/);
    if (!m) return l.slice(0, 40);
    const q = m[2].match(/"([^"]*)"/);
    return q ? `${m[1].trim()}|${q[1].slice(0, 60)}` : `${m[1].trim()}|${m[2].trim().slice(0, 60)}`;
  };
  const prefix = pairKey;
  const changed = [];
  const usedCand = new Set();
  const missing = [];
  for (const r of refOnly) {
    const idx = candOnly.findIndex(
      (c, i) => !usedCand.has(i) && prefix(c) === prefix(r),
    );
    if (idx !== -1) {
      usedCand.add(idx);
      changed.push({ ref: r, cand: candOnly[idx] });
    } else missing.push(r);
  }
  const added = candOnly.filter((_, i) => !usedCand.has(i));
  return { refLines: ref.length, candLines: cand.length, missing, added, changed };
}

// ---------------------------------------------------------------------------
// Rendered capture: PNG + ARIA snapshot + normalized DOM outline.
// ---------------------------------------------------------------------------
const REGION_QUERIES = {
  sidebar: [
    'aside[aria-label="Sidebar"]',
    "aside",
    '[class*="sidebar"]',
    '[class*="shell-sidebar"]',
  ],
  tablist: ['[role="tablist"]', '[class*="tab-strip"]', '[class*="terminal-tabs"]'],
  statusbar: [
    '[class*="status-bar"]',
    "footer",
    '[aria-label*="Usage"]',
    '[class*="statusbar"]',
  ],
  heading: ["h1", '[role="heading"]', "h2"],
};

async function domOutline(page) {
  return page.evaluate((queries) => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    };
    const regions = {};
    for (const [key, sels] of Object.entries(queries)) {
      // Several selectors can match incidental children (icons, buttons), so
      // score every match and keep the largest by area: the region container.
      let best = null;
      // The shell sidebar is the LEFT-anchored panel in both apps; scoring
      // by raw area alone compared the fork's 350px right rail (bg-sidebar)
      // against the candidate's 280px left sidebar and reported a bogus
      // 70px width delta (r9, issue #300). Prefer left-edge matches.
      let bestLeft = null;
      for (const sel of sels) {
        let els = [];
        try {
          els = [...document.querySelectorAll(sel)];
        } catch {
          continue;
        }
        for (const el of els) {
          const r = rect(el);
          const area = r.w * r.h;
          if (!best || area > best.area) {
            const cs = getComputedStyle(el);
            best = {
              sel,
              rect: r,
              area,
              fontSize: cs.fontSize,
              fontWeight: cs.fontWeight,
              color: cs.color,
              background: cs.backgroundColor,
            };
          }
          if (r.x <= 4 && r.w > 0 && (!bestLeft || area > bestLeft.area)) {
            const cs = getComputedStyle(el);
            bestLeft = {
              sel,
              rect: r,
              area,
              fontSize: cs.fontSize,
              fontWeight: cs.fontWeight,
              color: cs.color,
              background: cs.backgroundColor,
            };
          }
        }
      }
      regions[key] = key === "sidebar" && bestLeft ? bestLeft : best;
    }
    // The status strip is a thin full-width bar pinned to the viewport
    // bottom. Segment buttons (usage, ports) also match the selectors but are
    // small; if the winner is not bar-shaped, fall back to bottom-bar
    // geometry so cross-app deltas compare containers, not segments.
    const sb = regions.statusbar;
    if (!sb || sb.rect.h > 44 || sb.rect.w < Math.min(900, innerWidth * 0.6)) {
      let bar = null;
      for (const el of document.querySelectorAll("body *")) {
        const r = rect(el);
        const bottom = r.y + r.h;
        if (
          bottom >= innerHeight - 4 &&
          r.h > 0 &&
          r.h <= 48 &&
          r.w >= Math.min(900, innerWidth * 0.6)
        ) {
          if (!bar || r.width * r.height > bar.area) {
            const cs = getComputedStyle(el);
            bar = {
              sel: "bottom-bar-heuristic",
              rect: r,
              area: r.width * r.height,
              fontSize: cs.fontSize,
              fontWeight: cs.fontWeight,
              color: cs.color,
              background: cs.backgroundColor,
            };
          }
        }
      }
      if (bar) regions.statusbar = bar;
    }
    const headlines = [];
    for (const el of document.querySelectorAll("h1,h2,h3,[role='heading']")) {
      if (headlines.length >= 12) break;
      const text = (el.textContent || "").trim().slice(0, 160);
      if (!text) continue;
      const cs = getComputedStyle(el);
      headlines.push({
        tag: el.tagName.toLowerCase(),
        text,
        rect: rect(el),
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        color: cs.color,
        fontFamily: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
      });
    }
    const tabs = [...document.querySelectorAll('[role="tab"]')].slice(0, 12).map((el) => ({
      label: el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 80),
      selected: el.getAttribute("aria-selected"),
      rect: rect(el),
    }));
    return {
      url: location.href,
      title: document.title,
      nodeCount: document.querySelectorAll("body *").length,
      regions,
      headlines,
      tabs,
    };
  }, REGION_QUERIES);
}

function geomDelta(a, b) {
  if (!a || !b) return null;
  return {
    dw: b.rect.w - a.rect.w,
    dh: b.rect.h - a.rect.h,
    dx: b.rect.x - a.rect.x,
    dy: b.rect.y - a.rect.y,
  };
}

async function captureTriple(page, base, scheme) {
  await page.emulateMedia({ colorScheme: scheme });
  await delay(450);
  const suffix = scheme === "dark" ? ".dark" : "";
  const png = `${base}${suffix}.png`;
  await page.screenshot({ path: png, animations: "disabled" });
  let aria = "";
  try {
    aria = await page.locator("body").ariaSnapshot({ timeout: 8000 });
  } catch (error) {
    aria = `(aria snapshot unavailable: ${error.message.split("\n")[0]})`;
  }
  const dom = await domOutline(page);
  // Stored artifacts are normalized too: temp paths, hashes and durations
  // become placeholders so no username or machine path persists on disk.
  const storedAria = String(aria)
    .split("\n")
    .map((line) =>
      line
        .replace(/\/Users\/[^/\s"']+/g, "<HOME>")
        .replace(/\/private\/var\/folders\/[^\s"']*/g, "<TMP>")
        .replace(/\/var\/folders\/[^\s"']*/g, "<TMP>")
        .replace(/\/tmp\/[^\s"']*/g, "<TMP>")
        .replace(/\b[a-f0-9]{7,40}\b/gi, "<HASH>"),
    )
    .join("\n");
  await writeFile(`${base}${suffix}.aria.yaml`, storedAria.endsWith("\n") ? storedAria : `${storedAria}\n`);
  await writeFile(`${base}${suffix}.dom.json`, JSON.stringify(dom, null, 2) + "\n");
  return { png, aria, dom };
}

// Small dependency-free PNG reader for report evidence. Electron screenshots
// are 8-bit RGB/RGBA PNGs; supporting the basic filter set keeps the oracle
// self-contained and makes each issue cite a reproducible percentage.
function decodePng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(buffer.subarray(0, 8).equals(signature), "PNG signature missing");
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  let bitDepth = 8;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  assert.equal(bitDepth, 8, `unsupported PNG bit depth ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  assert.ok(channels > 0, `unsupported PNG color type ${colorType}`);
  const rowBytes = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const rows = Buffer.alloc(height * rowBytes);
  let source = 0;
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source++];
    const rowStart = y * rowBytes;
    const priorStart = (y - 1) * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const value = raw[source++];
      const left = x >= channels ? rows[rowStart + x - channels] : 0;
      const up = y > 0 ? rows[priorStart + x] : 0;
      const upLeft = y > 0 && x >= channels ? rows[priorStart + x - channels] : 0;
      rows[rowStart + x] = filter === 0 ? value
        : filter === 1 ? (value + left) & 255
        : filter === 2 ? (value + up) & 255
        : filter === 3 ? (value + Math.floor((left + up) / 2)) & 255
        : filter === 4 ? (value + paeth(left, up, upLeft)) & 255
        : value;
    }
  }
  return { width, height, channels, rows };
}

export async function pixelDiffPercent(referencePng, candidatePng) {
  const reference = decodePng(await readFile(referencePng));
  const candidate = decodePng(await readFile(candidatePng));
  const width = Math.min(reference.width, candidate.width);
  const height = Math.min(reference.height, candidate.height);
  const rgba = (image, x, y) => {
    const index = y * image.width * image.channels + x * image.channels;
    const value = image.rows;
    if (image.channels === 4) return [value[index], value[index + 1], value[index + 2], value[index + 3]];
    if (image.channels === 3) return [value[index], value[index + 1], value[index + 2], 255];
    const gray = value[index];
    return [gray, gray, gray, 255];
  };
  let changed = 0;
  let totalDelta = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = rgba(reference, x, y);
      const b = rgba(candidate, x, y);
      const delta = Math.max(...a.map((channel, index) => Math.abs(channel - b[index])));
      totalDelta += delta;
      if (delta > 12) changed += 1;
    }
  }
  const total = width * height;
  return {
    changedPixels: changed,
    comparedPixels: total,
    percent: total ? Number(((changed / total) * 100).toFixed(3)) : null,
    meanDelta: total ? Number((totalDelta / total).toFixed(3)) : null,
    dimensions: `${reference.width}x${reference.height} vs ${candidate.width}x${candidate.height}`,
  };
}

async function dismissOverlays(page) {
  for (let i = 0; i < 3; i++) {
    try {
      const escape = () => page.keyboard.press("Escape");
      if (REFERENCE_PAGES.has(page)) await refInteract(page, "press Escape", escape);
      else await escape();
      await delay(150);
    } catch {
      break;
    }
  }
}

// Reference pages are read-only. Keep the guard attached to the page object so
// every shared click/chord helper rejects destructive affordances on the ref,
// while the owned candidate can still exercise those controls in its fixtures.
const REFERENCE_PAGES = new WeakSet();
const REF_FORBIDDEN_ACTION = /\b(close|remove|delete|trash|discard|kill|terminate)\b/i;

export function guardReferencePage(page) {
  REFERENCE_PAGES.add(page);
  return page;
}

export async function refInteract(page, description, operation) {
  if (REF_FORBIDDEN_ACTION.test(description)) {
    throw new Error(`reference destructive interaction rejected: ${description}`);
  }
  return operation();
}

// Best-effort click with EXACT accessible-name matching (substring matches
// previously opened the wrong surface). Returns true when it acted.
async function tryClick(page, role, name, timeout = 2500) {
  const interact = async () => {
    try {
      const loc = page.getByRole(role, { name, exact: true });
      if ((await loc.count()) === 0) return false;
      await loc.first().click({ timeout });
      await delay(350);
      return true;
    } catch {
      return false;
    }
  };
  if (REFERENCE_PAGES.has(page)) {
    return refInteract(page, `click ${role} ${name}`, interact);
  }
  return interact();
}

// Overlay census: native dialogs/menus plus the candidate's cmdk palette,
// which is a NON-MODAL plain-div overlay (no role=dialog, no aria-hidden
// backdrop) that still swallows all pointer events while open.
async function overlayState(page) {
  try {
    return await page.evaluate(() => ({
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      menus: document.querySelectorAll('[role="menu"]').length,
      palettes: document.querySelectorAll(".command-palette-overlay").length,
    }));
  } catch {
    return { dialogs: -1, menus: -1, palettes: -1 };
  }
}

function overlayCount(o) {
  return (o.dialogs || 0) + (o.menus || 0) + (o.palettes || 0);
}

// Verified-clean start: dismiss until no dialog/menu remains (or give up and
// say so). Residue from a prior state must never leak into the next capture.
async function ensureClean(page, notes) {
  for (let i = 0; i < 6; i++) {
    const seen = await overlayState(page);
    if (overlayCount(seen) === 0) {
      if (i > 0) notes.push(`cleaned ${i} overlay round(s) before setup`);
      return;
    }
    try {
      const escape = () => page.keyboard.press("Escape");
      if (REFERENCE_PAGES.has(page)) await refInteract(page, "press Escape", escape);
      else await escape();
      await delay(250);
    } catch {
      break;
    }
  }
  let left = await overlayState(page);
  if (!REFERENCE_PAGES.has(page) && left.palettes > 0) {
    try {
      await page.locator(".command-palette-overlay").first().click({ position: { x: 4, y: 4 } });
      await delay(250);
      left = await overlayState(page);
      if (overlayCount(left) === 0) notes.push("cleaned command palette via backdrop");
    } catch {
      /* keep the explicit residue note below */
    }
  }
  if (overlayCount(left) > 0) {
    notes.push(
      `overlays remain before setup (dialogs=${left.dialogs} menus=${left.menus} palettes=${left.palettes})`,
    );
  }
}

async function tryKeys(page, chord) {
  const interact = async () => {
    try {
      await page.keyboard.press(chord);
      await delay(500);
      return true;
    } catch {
      return false;
    }
  };
  if (REFERENCE_PAGES.has(page)) {
    return refInteract(page, `press ${chord}`, interact);
  }
  return interact();
}

// Best-effort wait for an ARIA marker (proves navigation landed before the
// capture fires; r3 showed captures racing the settings page load).
async function waitForAria(page, role, name, timeout = 4000) {
  try {
    await page.getByRole(role, { name }).first().waitFor({ timeout });
    return true;
  } catch {
    return false;
  }
}

// Visible menuitem census: dismissed menus leave no DOM trace, so record
// their entries in notes while open (r3 menu states captured empty menus).
// Limit 24 covers the full New-tab menu (static + harness + settings rows).
async function menuItemNames(page, limit = 24) {
  try {
    return await page.evaluate((max) => {
      const out = [];
      for (const el of document.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')) {
        if (el.offsetParent === null) continue;
        const t = (el.getAttribute("aria-label") || el.textContent || "")
          .trim().replace(/\s+/g, " ");
        if (t) out.push(t.slice(0, 80));
        if (out.length >= max) break;
      }
      return out;
    }, limit);
  } catch {
    return [];
  }
}

// Visible toast census (sonner renders li[data-sonner-toast], exposed as
// listitem/status): record copy even when the PNG misses the 4s window.
async function toastTexts(page, limit = 6) {
  try {
    return await page.evaluate((max) => {
      const out = [];
      for (const el of document.querySelectorAll("[data-sonner-toast]")) {
        const t = (el.textContent || "").trim().replace(/\s+/g, " ");
        if (t) out.push(t.slice(0, 160));
        if (out.length >= max) break;
      }
      return out;
    }, limit);
  } catch {
    return [];
  }
}

// Known-home start: dismiss overlays, leave full-page views the way a user
// would (Settings via its back row, Bots/Tasks/Automations via Sessions
// nav), so one state's page never leaks into the next capture. View
// navigation only; every step is recorded.
async function ensureHome(page, notes) {
  await ensureClean(page, notes);
  // The settings full-page view is identified by its visible search field;
  // a lone button/name match must never drive navigation.
  const settingsSearch = page.getByRole("textbox", { name: "Search settings" }).first();
  const settingsOpen = async () =>
    (await settingsSearch.count().catch(() => 0)) > 0 &&
    await settingsSearch.isVisible().catch(() => false);
  if (await settingsOpen()) {
    const back = page.getByRole("button", { name: "Back to app", exact: true }).first();
    if ((await back.count().catch(() => 0)) > 0) {
      await refInteract(page, "click Back to app", () => back.click({ timeout: 2500, force: true })).catch(() => {});
      notes.push("home: Back to app from full-page view");
      await delay(500);
    }
    await ensureClean(page, notes);
  }
  try {
    const sessions = page.getByRole("button", { name: "Sessions", exact: true });
    if ((await sessions.count()) > 0) {
      await sessions.first().click({ timeout: 1500 });
      await delay(350);
      notes.push("home: Sessions nav selected");
    }
  } catch {
    /* stay where we are */
  }
}

// ---------------------------------------------------------------------------
// tasks-rows fixture (R16-P): a deterministic `gh` for the owned candidate
// daemon. Precedent: crates/drogon-core/tests/tasks.rs fakes `gh` by
// binary path through `tasks_rpc::set_gh_bin_override`; here the whole
// daemon process resolves `gh` from a fixture bin dir prepended to its
// PATH, so no product code changes, no GitHub account and no network.
// Installed only when the run includes `tasks-rows`; every other state
// keeps the real PATH. Shapes mirror the Rust test fixtures.
// ---------------------------------------------------------------------------
// R6: tasks-filters reuses the same deterministic gh fixture (PR-mode
// chrome over the fixture pulls).
const TASKS_ROWS_WANTED =
  !STATES_FILTER ||
  STATES_FILTER.includes("tasks-rows") ||
  STATES_FILTER.includes("tasks-filters");

// R9 status-bar fixture: the usage store accepts an env-gated JSON snapshot
// (DROGON_USAGE_FIXTURE). Keep the default candidate capture on the data
// variant, while status-bar-usage-states cycles loading and signed-out files
// before capturing the data variant as the comparable state.
const STATUS_USAGE_FIXTURE_WANTED =
  !STATES_FILTER ||
  STATES_FILTER.includes("statusbar-strip") ||
  STATES_FILTER.includes("status-bar-usage-states");

function usageWindow(usedPercent, windowMinutes, resetDescription) {
  return {
    usedPercent,
    windowMinutes,
    resetsAt: Date.now() + windowMinutes * 60_000,
    resetDescription,
  };
}

function usageProvider(provider, status, session = null, weekly = null, fableWeekly = null, error = null) {
  return {
    provider,
    session,
    weekly,
    fableWeekly,
    updatedAt: Date.now(),
    error,
    status,
  };
}

function statusUsageFixture(variant) {
  const memory = { rssBytes: 888 * 1024 * 1024, processCount: 4, unavailableReason: null };
  const ports = {
    listening: [{ port: 43123, process: "fidelity-fixture" }],
    unavailableReason: null,
  };
  if (variant === "loading") {
    return {
      claude: usageProvider("claude", "fetching"),
      codex: usageProvider("codex", "unavailable", null, null, null, "Codex is not signed in."),
      memory,
      ports,
    };
  }
  if (variant === "signed-out") {
    return {
      claude: usageProvider("claude", "unavailable", null, null, null, "Claude is not signed in."),
      codex: usageProvider("codex", "unavailable", null, null, null, "Codex is not signed in."),
      memory,
      ports,
    };
  }
  return {
    claude: usageProvider(
      "claude",
      "ok",
      usageWindow(38, 300, "2h 6m"),
      usageWindow(67, 10080, "3d 22h"),
      usageWindow(58, 10080, "Fable"),
    ),
    codex: usageProvider(
      "codex",
      "ok",
      usageWindow(24, 300, "2h 44m"),
      usageWindow(53, 10080, "4d 1h"),
    ),
    memory,
    ports,
  };
}

async function writeStatusUsageFixture(file, variant = "data") {
  assert.ok(file, "status-bar fixture path is required");
  await writeFile(file, JSON.stringify(statusUsageFixture(variant), null, 2) + "\n");
}

const TASKS_ROWS_FIXTURE_GH = `#!/usr/bin/env node
// R16-P fidelity fixture: deterministic \`gh issue/pr list|view\` answers.
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 || i + 1 >= args.length ? null : args[i + 1];
};
const fail = (message) => {
  console.error("fixture gh: " + message);
  process.exit(1);
};
const LABELS = [
  [{ name: "bug", color: "d73a4a" }],
  [{ name: "enhancement", color: "a2eeef" }],
  [],
  [{ name: "docs", color: "0075ca" }],
];
const ASSIGNEES = [[{ login: "octocat" }], [], [{ login: "helix" }]];
const AUTHORS = [{ login: "helix" }, { login: "octocat" }, null];
const UPDATED = ["2026-09-06T12:00:00Z", "2026-09-05T09:30:00Z", "2026-09-04T16:45:00Z"];
const AREAS = ["sidebar", "terminal", "browser", "tasks", "settings", "worktree"];
// One row past TASKS_PAGE_SIZE=36: the daemon's fetch-one-extra probe sets
// hasNextPage, so the pagination strip renders on page one.
const OPEN_ISSUES = Array.from({ length: 37 }, (_, i) => {
  const number = 137 - i;
  return {
    number,
    title: "Fixture " + AREAS[i % AREAS.length] + " issue " + number,
    state: "OPEN",
    labels: LABELS[i % LABELS.length],
    assignees: ASSIGNEES[i % ASSIGNEES.length],
    author: AUTHORS[i % AUTHORS.length],
    updatedAt: UPDATED[i % UPDATED.length],
    url: "https://github.com/example/repo/issues/" + number,
  };
});
const CLOSED_ISSUES = [201, 202].map((number) => ({
  number,
  title: "Fixture closed issue " + number,
  state: "CLOSED",
  labels: [],
  assignees: [],
  author: { login: "helix" },
  updatedAt: "2026-08-20T10:00:00Z",
  url: "https://github.com/example/repo/issues/" + number,
}));
const PULLS = [
  { number: 12, title: "Fixture PR adds the review flow", state: "OPEN", isDraft: false,
    labels: [{ name: "enhancement", color: "a2eeef" }], assignees: [{ login: "octocat" }],
    author: { login: "helix" }, reviewDecision: "APPROVED",
    statusCheckRollup: [
      { name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
      { name: "lint", status: "COMPLETED", conclusion: "SUCCESS" },
      { name: "e2e", status: "IN_PROGRESS", conclusion: "" },
    ],
    mergeable: "MERGEABLE", headRefName: "add-pr-flow", baseRefName: "main",
    updatedAt: "2026-09-06T14:00:00Z", url: "https://github.com/example/repo/pull/12" },
  { number: 13, title: "Fixture draft release notes", state: "OPEN", isDraft: true,
    labels: [], assignees: [], author: { login: "helix" }, reviewDecision: "",
    statusCheckRollup: [], mergeable: "UNKNOWN",
    headRefName: "draft-work", baseRefName: "main",
    updatedAt: "2026-09-05T10:00:00Z", url: "https://github.com/example/repo/pull/13" },
  { number: 14, title: "Fixture PR needs rework", state: "OPEN", isDraft: false,
    labels: [{ name: "bug", color: "d73a4a" }], assignees: [{ login: "helix" }],
    author: { login: "octocat" }, reviewDecision: "CHANGES_REQUESTED",
    statusCheckRollup: [
      { name: "build", status: "COMPLETED", conclusion: "FAILURE" },
      { name: "lint", status: "COMPLETED", conclusion: "SUCCESS" },
    ],
    mergeable: "CONFLICTING", headRefName: "rework-flow", baseRefName: "main",
    updatedAt: "2026-09-04T11:20:00Z", url: "https://github.com/example/repo/pull/14" },
  { number: 15, title: "Fixture PR shipped the palette", state: "MERGED", isDraft: false,
    labels: [], assignees: [], author: { login: "helix" }, reviewDecision: "APPROVED",
    statusCheckRollup: [{ name: "build", status: "COMPLETED", conclusion: "SUCCESS" }],
    mergeable: "MERGEABLE", headRefName: "palette-ship", baseRefName: "main",
    updatedAt: "2026-09-03T08:00:00Z", url: "https://github.com/example/repo/pull/15" },
];
const limit = () => {
  const raw = parseInt(opt("--limit") ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 100) : 30;
};
const stateFilter = () => String(opt("--state") ?? "open").toLowerCase();
if (args[0] === "issue" && args[1] === "list") {
  const pool = stateFilter() === "closed" ? CLOSED_ISSUES
    : stateFilter() === "all" ? [...OPEN_ISSUES, ...CLOSED_ISSUES] : OPEN_ISSUES;
  console.log(JSON.stringify(pool.slice(0, limit())));
} else if (args[0] === "pr" && args[1] === "list") {
  console.log(JSON.stringify(PULLS.slice(0, limit())));
} else if (args[0] === "issue" && args[1] === "view") {
  const found = [...OPEN_ISSUES, ...CLOSED_ISSUES].find((i) => String(i.number) === String(args[2]));
  if (!found) fail("could not resolve to an Issue");
  else console.log(JSON.stringify({ ...found, body: "Fixture body for issue " + found.number + "." }));
} else if (args[0] === "pr" && args[1] === "view") {
  const found = PULLS.find((p) => String(p.number) === String(args[2]));
  if (!found) fail("could not resolve to a Pull Request");
  else console.log(JSON.stringify(found));
} else {
  fail("unsupported argv: " + args.join(" "));
}
`;

async function ensureTasksRowsFixtureBin(fixture) {
  const binDir = path.join(fixture, "tasks-fixture-bin");
  await mkdir(binDir, { recursive: true });
  const ghPath = path.join(binDir, "gh");
  await writeFile(ghPath, TASKS_ROWS_FIXTURE_GH, { mode: 0o755 });
  try {
    await execFileAsync("chmod", ["+x", ghPath]);
  } catch {
    /* the writeFile mode already covers unix */
  }
  return binDir;
}

// A Pi-shaped executable keeps the card-row fixture deterministic. It prints
// shell output and sleeps; no provider/model inference runs during fidelity.
const PI_CARD_ROWS_FIXTURE =
  STATES_FILTER?.includes("bots-history") &&
  !STATES_FILTER.includes("worktree-card-rows") &&
  !STATES_FILTER.includes("automation-run-detail")
    ? `#!/bin/sh
printf 'Drogon Pi history fixture\\n'
printf 'fixture completed\\n'
`
    : `#!/bin/sh
printf 'Drogon Pi local-model fixture\\n'
while :; do
  printf 'fixture heartbeat\\n'
  sleep 1
done
`;

async function ensurePiCardRowsFixture(binDir) {
  const piPath = path.join(binDir, "pi");
  await writeFile(piPath, PI_CARD_ROWS_FIXTURE, { mode: 0o755 });
  try {
    await execFileAsync("chmod", ["+x", piPath]);
  } catch {
    /* the writeFile mode already covers unix */
  }
}

// Browser fixture pages are served by this process, not a child process, so
// teardown can close the exact server and sockets it owns. The slow response
// intentionally remains pending long enough for the strip loading state.
async function startBrowserFixtureServer() {
  const timers = new Set();
  const sockets = new Set();
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/slow") {
      const timer = setTimeout(() => {
        timers.delete(timer);
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<title>Slow fixture</title><main>slow fixture complete</main>");
      }, 30000);
      timers.add(timer);
      response.once("close", () => {
        clearTimeout(timer);
        timers.delete(timer);
      });
      return;
    }
    const label = pathname === "/recent-a" ? "Recent fixture alpha" :
      pathname === "/recent-b" ? "Recent fixture beta" : "Search fixture";
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<title>${label}</title><main>${label}</main>`);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object", "browser fixture must bind a TCP port");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    server,
    slowUrl: `${baseUrl}/slow`,
    recentUrls: [`${baseUrl}/recent-a`, `${baseUrl}/recent-b`],
    async close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

// ---------------------------------------------------------------------------
// Candidate lifecycle (owned processes): real drogond + production Electron.
// ---------------------------------------------------------------------------
async function launchCandidate() {
  const appDir = path.join(root, "apps", "desktop");
  const appRequire = createRequire(path.join(appDir, "package.json"));
  const electron = appRequire("electron");
  assert.ok(
    existsSync(path.join(appDir, "out", "renderer", "index.html")),
    "Production bundle missing: run `pnpm --filter @drogon/desktop build` first",
  );
  const daemonBin = path.join(
    root, "target", "debug", process.platform === "win32" ? "drogond.exe" : "drogond",
  );
  const cliBin = path.join(
    root, "target", "debug", process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli",
  );
  assert.ok(existsSync(daemonBin), `drogond missing at ${daemonBin}`);
  const fixture = await mkdtemp(path.join(tmpdir(), "r5f-fidelity-"));
  const dataDir = path.join(fixture, "data");
  await mkdir(dataDir, { recursive: true });
  const workspace = path.join(fixture, "folder");
  await mkdir(workspace, { recursive: true });

  // Deterministic row fixtures resolve `gh` and the Pi-shaped shell fixture
  // from a temp bin dir. Runs without these states keep the real PATH.
  let daemonEnv = null;
  if ((TASKS_ROWS_WANTED || WORKTREE_CARD_ROWS_WANTED) && process.platform !== "win32") {
    const fixtureBin = await ensureTasksRowsFixtureBin(fixture);
    if (WORKTREE_CARD_ROWS_WANTED) await ensurePiCardRowsFixture(fixtureBin);
    daemonEnv = {
      ...process.env,
      PATH: `${fixtureBin}${path.delimiter}${process.env.PATH ?? ""}`,
    };
  }
  let usageFixturePath = null;
  if (STATUS_USAGE_FIXTURE_WANTED) {
    usageFixturePath = path.join(fixture, "usage-fixture.json");
    await writeStatusUsageFixture(usageFixturePath, "data");
    daemonEnv = daemonEnv ?? { ...process.env };
    daemonEnv.DROGON_USAGE_FIXTURE = usageFixturePath;
  }
  const browserFixture = BROWSER_FIXTURE_WANTED ? await startBrowserFixtureServer() : null;
  const daemon = startAcceptanceProcess(daemonBin, ["--data-dir", dataDir], {
    stdio: "ignore",
    ...(daemonEnv ? { env: daemonEnv } : {}),
  });
  let daemonError = null;
  daemon.on("error", (error) => {
    daemonError = error;
  });
  const deadline = Date.now() + 12000;
  for (;;) {
    if (daemonError) throw daemonError;
    try {
      const response = await runAcceptanceProcess(
        cliBin, ["--data-dir", dataDir, "--json", "status"], { timeout: 1500 },
      );
      assert.equal(JSON.parse(response.stdout).ok, true);
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(100);
    }
  }
  const desktop = startAcceptanceProcess(electron, [appDir, "--remote-debugging-port=0"], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"),
      DROGON_BACKGROUND_WINDOW: "1",
      ...(usageFixturePath ? { DROGON_USAGE_FIXTURE: usageFixturePath } : {}),
      // Real window sized for a 1440x900 content area, parked off the user's
      // work area: viewport emulation made xterm render at the wrong scale.
      DROGON_WINDOW_BOUNDS: `${VIEWPORT.width}x${VIEWPORT.height + 28}+4000+4000`,
      ...(process.platform !== "win32" ? { SHELL: "/bin/sh" } : {}),
    },
  });
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timeout = setTimeout(
      () => reject(new Error(`Electron did not publish a debugging endpoint: ${tail}`)),
      25000,
    );
    desktop.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    desktop.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error(`Electron exited before connection: ${tail}`));
    });
    desktop.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const match = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
  const browser = await chromium.connectOverCDP(endpoint);
  let page = null;
  for (let i = 0; i < 200 && !page; i++) {
    page = browser.contexts()[0]?.pages()[0] ?? null;
    if (!page) await delay(50);
  }
  assert.ok(page, "Electron must create a rendered page");
  await emulatePageFocus(page);
  page.setDefaultTimeout(15000);
  // R9-B: the sidebar footer is the source toolbar now (settings, help,
  // reveal) — the "Service x.y.z" text is gone, so readiness waits for it.
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor({ timeout: 25000 });
  await ensureCandidateViewport(page);
  return {
    browser,
    page,
    desktop,
    daemon,
    fixture,
    dataDir,
    workspace,
    browserFixture,
    usageFixturePath,
  };
}

async function stopCandidate(owned) {
  if (!owned) return [];
  const notes = [];
  try {
    await owned.browser?.close().catch(() => {});
    notes.push("candidate CDP browser: closed");
  } catch {
    notes.push("candidate CDP browser: unverifiable");
  }
  for (const [child, label] of [[owned.desktop, "candidate electron"], [owned.daemon, "candidate drogond"]]) {
    if (!child) continue;
    try {
      const result = await stopAcceptanceProcess(child);
      notes.push(`${label}: ${result.verdict}${result.forced ? " (forced)" : ""}`);
    } catch (error) {
      notes.push(`${label}: stop failed (${error.message.split("\n")[0]})`);
    }
  }
  if (owned.browserFixture) {
    try {
      await owned.browserFixture.close();
      notes.push("browser fixture server: closed");
    } catch (error) {
      notes.push(`browser fixture server: close failed (${error.message.split("\\n")[0]})`);
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// State drivers. Each setup(side) returns { notes[], missing[] } and must be
// non-destructive on the reference side: no projects, sessions, files, or
// settings are created there — only view navigation and ephemeral overlays.
// The candidate side may use its own temp fixture freely.
// ---------------------------------------------------------------------------
const MOD = process.platform === "darwin" ? "Meta" : "Control";

async function refSetup(page, state, ctx) {
  const notes = [];
  const missing = [];
  await page.setViewportSize(VIEWPORT);
  await ensureHome(page, notes);
  const chordOverlay = async (chord, label) => {
    await tryKeys(page, chord);
    await delay(1200);
    const seen = await overlayState(page);
    if (overlayCount(seen) > 0) {
      notes.push(
        `${label} chord ${chord}: overlay open (dialogs=${seen.dialogs} menus=${seen.menus} palettes=${seen.palettes})`,
      );
      return true;
    }
    notes.push(`${label} chord ${chord}: no overlay appeared`);
    return false;
  };
  // R6: filter-only query for palette result rows. Types into the open
  // palette's filter field and never presses Enter (that would jump the
  // selection and, on the reference, navigate away). Teardown Escape
  // dismisses the palette on both sides.
  const typePaletteQuery = async (query) => {
    try {
      let field = page.getByRole("combobox", { name: "Go to file", exact: true }).first();
      if ((await field.count()) === 0) {
        field = page.locator(".command-palette-overlay input.command-palette-input").first();
      }
      if ((await field.count()) === 0) {
        field = page.getByRole("combobox").first();
      }
      if ((await field.count()) === 0) {
        return "query field not found (captured unfiltered)";
      }
      await field.fill(query);
      await delay(900);
      const rows = await page.getByRole("option").count().catch(() => -1);
      const items = await page.getByRole("menuitem").count().catch(() => -1);
      return `query "${query}" typed (filter-only): options=${rows} menuitems=${items}`;
    } catch (error) {
      return `query typing best-effort only: ${error.message.split("\n")[0]}`;
    }
  };
  const openRefSettings = async () => {
    const search = page.getByRole("textbox", { name: "Search settings" }).first();
    if ((await search.count().catch(() => 0)) > 0 && await search.isVisible().catch(() => false)) return true;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const button = page.getByRole("button", { name: "Settings", exact: true }).first();
        await button.waitFor({ state: "visible", timeout: 3500 });
        await refInteract(page, "click reference Settings", () => button.click({ timeout: 3500, force: true }));
        await page.getByRole("textbox", { name: "Search settings" }).waitFor({ timeout: 5000 });
        return true;
      } catch {
        await delay(500);
      }
    }
    return false;
  };
  const openRefNav = async (name, markerRole, markerName) => {
    const marker = page.getByRole(markerRole, { name: markerName }).first();
    if ((await marker.count().catch(() => 0)) > 0 && await marker.isVisible().catch(() => false)) return true;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const button = page.getByRole("button", { name, exact: true }).first();
        await button.waitFor({ state: "visible", timeout: 3500 });
        await refInteract(page, `click reference ${name}`, () => button.click({ timeout: 3500, force: true }));
        await page.getByRole(markerRole, { name: markerName }).first().waitFor({ timeout: 5000 });
        return true;
      } catch {
        await delay(500);
      }
    }
    return false;
  };
  switch (state) {
    case "worktree-card-rows":
      missing.push("ref non-coverage: creating 2–3 sessions (including Pi local-model) is forbidden on the reference");
      notes.push("ref unchanged: nested worktree-card session rows compared from fork source anchors");
      break;
    case "browser-tab-loading":
      missing.push("ref non-coverage: opening a new browser tab/loading fixture is forbidden on the reference");
      notes.push("ref unchanged: loading strip compared from browser navigation source anchors");
      break;
    case "editor-header":
      missing.push("ref non-coverage: opening a file/editor tab is forbidden on the reference");
      notes.push("ref unchanged: editor path/Edit-Changes/More actions compared from fork source anchors");
      break;
    case "address-bar-suggestions":
      missing.push("ref non-coverage: opening a browser tab and typing a suggestion query is forbidden on the reference");
      notes.push("ref unchanged: Search Google and recent URL suggestions compared from fork source anchors");
      break;
    case "empty":
      notes.push(`ref as-is: title=${await page.title().catch(() => "?")}`);
      break;
    case "project-terminal":
      missing.push("ref project+terminal fixture intentionally not created (reference is read-only); captured current view");
      notes.push(`tabs visible: ${await page.getByRole("tab").count().catch(() => "?")}`);
      break;
    case "palette":
      // Spec chord first; the reference source binds no command palette to
      // Cmd+K (src/shared/keybindings: Cmd+K is terminal.clear, the worktree
      // "Jump to..." palette is worktree.palette on Mod+J), so fall back to
      // the SOURCE chord and record both attempts honestly.
      if (!(await chordOverlay(`${MOD}+K`, "spec Cmd+K"))) {
        notes.push("source: Cmd+K is terminal.clear (definitions-core-3.ts); trying source chord Mod+J (worktree.palette)");
        if (!(await chordOverlay(`${MOD}+J`, "source Mod+J"))) {
          missing.push("no palette overlay via Cmd+K nor Cmd+J");
        }
      }
      break;
    case "quick-open": {
      // R6: type a one-char filter for results (filter-only: Enter would
      // jump the selection, so it is never pressed; teardown Escape
      // dismisses the palette). Source: worktree.quickOpen "Go to File"
      // defaults to Mod+P (definitions-core-1.ts) — same chord as spec.
      if (!(await chordOverlay(`${MOD}+P`, "Cmd+P"))) {
        missing.push("Cmd+P (worktree.quickOpen) opened no overlay in the empty ref");
        break;
      }
      notes.push(await typePaletteQuery("e"));
      break;
    }
    case "command-palette": {
      // R6: the coordinator asked for ⌘K, but the fork binds no command
      // palette to Cmd+K (terminal.clear, definitions-core-3.ts) — press
      // it and record the (non-)effect honestly, then the source chord
      // Mod+J (worktree.palette, commands mode) plus a typed query for
      // results. Filter-only typing, never Enter; teardown Escape closes.
      await tryKeys(page, `${MOD}+K`);
      await delay(1200);
      const kSeen = await overlayState(page);
      notes.push(
        overlayCount(kSeen) > 0
          ? `spec Cmd+K unexpectedly opened an overlay (dialogs=${kSeen.dialogs} menus=${kSeen.menus} palettes=${kSeen.palettes})`
          : "spec Cmd+K opened no palette (source: terminal.clear)",
      );
      if (!(await chordOverlay(`${MOD}+J`, "source Mod+J"))) {
        missing.push("no commands palette via source chord Mod+J");
        break;
      }
      notes.push(await typePaletteQuery("a"));
      break;
    }
    case "launch-dialog": {
      // R6: "+" opens the create menu (creates nothing). Selecting an
      // agent row would launch a terminal tab in the reference, which
      // the read-only rule forbids — so the open menu is the capture and
      // the candidate's Pi form compares against QuickLaunchButton.tsx
      // (direct-launch rows, no form) instead.
      const tabsBefore = await page.getByRole("tab").count().catch(() => -1);
      if (await tryClick(page, "button", "New tab")) {
        await delay(600);
        const seen = await overlayState(page);
        if ((seen.menus || 0) > 0) {
          notes.push(`launch menu open (dialogs=${seen.dialogs} menus=${seen.menus} palettes=${seen.palettes})`);
          const items = await menuItemNames(page);
          if (items.length) notes.push(`launch menu items: ${items.join(" | ")}`);
        } else {
          const tabsAfter = await page.getByRole("tab").count().catch(() => -1);
          if (tabsBefore >= 0 && tabsAfter > tabsBefore) {
            missing.push(`New tab click created a tab instead of a menu (tabs ${tabsBefore} -> ${tabsAfter}); left for the human, ref otherwise untouched`);
          } else missing.push("New tab click opened no menu");
        }
        const tabsEnd = await page.getByRole("tab").count().catch(() => -1);
        if (tabsBefore >= 0 && tabsEnd !== tabsBefore) {
          missing.push(`tab count changed during launch-dialog setup (${tabsBefore} -> ${tabsEnd}); recorded, ref otherwise untouched`);
        }
      } else missing.push("no New tab affordance reachable (page view has no strip)");
      break;
    }
    case "workspace-composer": {
      // The composer is a view-only draft surface here. Opening it does not
      // create a workspace; no field is filled and no submit is pressed.
      let opened = await tryClick(page, "button", "Create workspace", 2500);
      if (!opened) opened = await tryClick(page, "button", "New workspace", 2500);
      if (opened) {
        await delay(500);
        notes.push("workspace composer opened without submitting");
        const advanced = page.getByRole("button", { name: "Advanced", exact: true }).first();
        if ((await advanced.count()) > 0) {
          await advanced.click({ timeout: 2500 });
          await delay(300);
          notes.push("Advanced section expanded (view-only)");
        }
      } else {
        missing.push("no Create workspace/New workspace affordance reachable");
      }
      break;
    }
    case "settings-shortcuts-rebind": {
      // R6: open Shortcuts and start recording on the first recorder
      // (click only — pressing any chord here would rebind reference
      // settings). The "Press shortcut keys" hint is the capture;
      // teardown Escape cancels recording. Conflict copy compares from
      // the fork's shortcut-binding-list-mutations source instead.
      if (await tryClick(page, "button", "Settings")) {
        if (!(await waitForAria(page, "textbox", "Search settings"))) {
          missing.push("Settings click acted but the settings marker never appeared");
          break;
        }
        notes.push("Settings opened via Settings button (marker visible)");
        let opened = await tryClick(page, "button", "Shortcuts", 1500);
        if (!opened) {
          try {
            await page.getByRole("tab", { name: "Shortcuts" }).first().click({ timeout: 1500 });
            await delay(350);
            opened = true;
          } catch {
            opened = false;
          }
        }
        if (!opened) {
          missing.push("no Shortcuts nav reachable");
          break;
        }
        notes.push("Shortcuts pane opened");
        try {
          const recorder = page.getByRole("button", { name: /^Change shortcut for/ }).first();
          if ((await recorder.count()) > 0) {
            // Read the label BEFORE clicking: once recording starts the
            // button's name becomes the hint, so this same locator would
            // re-resolve to the next recorder.
            const label = await recorder.getAttribute("aria-label").catch(() => "?");
            await recorder.click({ timeout: 2500 });
            await delay(600);
            const active = await page
              .getByRole("button", { name: /Press shortcut keys/ })
              .count()
              .catch(() => 0);
            notes.push(
              active > 0
                ? `recording started on "${(label ?? "?").slice(0, 60)}" (hint visible, no chord pressed)`
                : "recorder clicked but no recording hint appeared",
            );
          } else missing.push("no shortcut recorder button reachable");
        } catch {
          missing.push("recorder click best-effort only");
        }
      } else missing.push("no Settings button reachable");
      break;
    }
    case "tasks-filters": {
      // R6: same navigate-only Tasks walk as tasks-rows, then the PRs
      // mode tab (a view switch, no data change) for the PR chrome
      // (Mine preset, Reviewers/Checks/Merge cells, New-issue affordance).
      if ((await tryClick(page, "button", "Tasks")) || (await tryClick(page, "button", "Open GitHub tasks", 1200))) {
        // Either mode marker counts: the page persists its last mode, so
        // it can open directly in PRs.
        const issuesMarker = await waitForAria(page, "textbox", "Search GitHub issues...", 6000);
        const prsMarker = issuesMarker
          ? false
          : await waitForAria(page, "textbox", "Search GitHub PRs...", 4000);
        if (!issuesMarker && !prsMarker) {
          missing.push("Tasks click acted but no list marker appeared");
          break;
        }
        notes.push("Tasks opened (marker visible)");
        if (prsMarker) {
          notes.push("Tasks already in PRs mode (persisted view, no switch needed)");
        } else if (await tryClick(page, "button", "PRs", 2000)) {
          await delay(1200);
          notes.push("PRs mode selected (view switch only)");
        } else missing.push("no PRs mode tab reachable");
      } else missing.push("no Tasks nav reachable");
      break;
    }
    case "settings-appearance":
      if (await tryClick(page, "button", "Settings")) {
        await tryClick(page, "button", "Appearance", 1200).catch(() => {});
        await tryClick(page, "tab", "Appearance", 1200).catch(() => {});
        if (await waitForAria(page, "textbox", "Search settings")) {
          notes.push("Settings opened via Settings button (marker visible)");
        } else missing.push("Settings click acted but the settings marker never appeared (capture may show the previous view)");
      } else missing.push("no Settings button reachable");
      break;
    case "settings-appearance-system": {
      // R8: inspect the persisted System choice without changing the
      // reference. The dark/light captures below emulate the OS media query;
      // the source's System branch should follow that signal.
      if (await openRefSettings()) {
        await tryClick(page, "button", "Appearance", 1500).catch(() => {});
        await tryClick(page, "tab", "Appearance", 1500).catch(() => {});
        if (!(await waitForAria(page, "textbox", "Search settings"))) {
          missing.push("Settings click acted but the settings marker never appeared");
          break;
        }
        const system = page.getByRole("radio", { name: "System", exact: true }).first();
        const count = await system.count().catch(() => 0);
        if (count === 0) {
          missing.push("reference Theme/System control unavailable");
        } else {
          const checked = await system.getAttribute("aria-checked").catch(() => null);
          notes.push(`reference Theme=System checked=${checked ?? "unknown"}`);
          if (checked !== "true") missing.push("reference persisted theme is not System; left unchanged");
        }
        notes.push(`reference OS media dark=${await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches).catch(() => false)}`);
      } else missing.push("no Settings button reachable");
      break;
    }
    case "shortcuts-status-rail": {
      if (await openRefSettings()) {
        let opened = await tryClick(page, "button", "Shortcuts", 1800);
        if (!opened) {
          try {
            await page.getByRole("tab", { name: "Shortcuts" }).first().click({ timeout: 1800 });
            await delay(350);
            opened = true;
          } catch {
            opened = false;
          }
        }
        if (!opened) {
          missing.push("no Shortcuts nav reachable");
          break;
        }
        const rail = page.getByRole("navigation", { name: "Shortcut status filters" }).first();
        try {
          await rail.waitFor({ state: "visible", timeout: 8000 });
        } catch {
          missing.push("Shortcut status filter rail missing");
          break;
        }
        notes.push("Shortcuts status rail opened");
        const modified = page.getByRole("button", { name: /^Modified\b/ }).first();
        if ((await modified.count()) > 0) {
          await refInteract(page, "click Modified shortcut status filter", () => modified.click({ timeout: 2500 }));
          await delay(350);
          notes.push("Modified status filter selected (view-only)");
        } else missing.push("Modified status filter unavailable");
      } else missing.push("no Settings button reachable");
      break;
    }
    case "changes":
      missing.push("ref git fixture intentionally not created (reference is read-only)");
      if (await tryClick(page, "button", "Changes", 1200)) notes.push("Changes view opened");
      else notes.push("no Changes nav; captured current view");
      break;
    case "automations":
      if (await openRefNav("Automations", "heading", "Automations")) notes.push("Automations opened (marker visible)");
      else missing.push("no Automations nav reachable");
      break;
    case "automation-editor-cron-preview": {
      // Opening the reference editor is safe, but creating an automation or
      // typing a yearly expression would mutate its draft/data. Capture the
      // source-backed editor only and record that non-coverage explicitly.
      if (!openRefNav("Automations", "heading", "Automations")) {
        missing.push("no Automations nav reachable");
        break;
      }
      let opened = false;
      for (const label of ["New Automation", "New automation"]) {
        if (opened) break;
        const trigger = page.getByRole("button", { name: label, exact: true }).first();
        try {
          await trigger.waitFor({ state: "visible", timeout: 8000 });
          await refInteract(page, `click reference ${label}`, () => trigger.click({ timeout: 3500, force: true }));
          opened = true;
        } catch {
          /* try the alternate label */
        }
      }
      if (opened) {
        try {
          await page.getByRole("dialog").first().waitFor({ state: "visible", timeout: 8000 });
          notes.push("automation editor opened without changing reference data");
        } catch {
          missing.push("New Automation editor unavailable on reference");
        }
      } else {
        missing.push("New Automation editor unavailable on reference");
      }
      missing.push("ref non-coverage: typing a yearly cron in the reference editor is forbidden; compare source and candidate fixture");
      break;
    }
    case "browser":
      if (await tryClick(page, "button", "Browser", 1200)) notes.push("Browser opened");
      else {
        missing.push("no Browser nav button in ref sidebar");
        notes.push("captured current view instead");
      }
      break;
    case "tasks":
      if ((await tryClick(page, "button", "Tasks")) || (await tryClick(page, "button", "Open GitHub tasks", 1200))) {
        if (await waitForAria(page, "textbox", "Search GitHub issues...")) notes.push("Tasks opened (marker visible)");
        else missing.push("Tasks click acted but the list marker never appeared");
      } else missing.push("no Tasks nav reachable");
      break;
    case "tasks-rows":
      // Navigate only: the reference lists its real rows; nothing is
      // created, typed, filtered, or changed there.
      if ((await tryClick(page, "button", "Tasks")) || (await tryClick(page, "button", "Open GitHub tasks", 1200)))
        notes.push("Tasks opened (real rows listed, navigate-only)");
      else missing.push("no Tasks nav reachable");
      break;
    case "bots":
      if (await openRefNav("Bots", "heading", "Bots")) notes.push("Bots opened (marker visible)");
      else missing.push("no Bots nav reachable");
      break;
    case "bots-empty-and-list": {
      if (!openRefNav("Bots", "heading", "Bots")) {
        missing.push("no Bots nav reachable");
        break;
      }
      const empty = await page.getByText("No Bots yet", { exact: true }).count().catch(() => 0);
      notes.push(empty > 0 ? "reference empty Bots state visible" : "reference Bots list/empty state captured as-is");
      notes.push("ref non-coverage: creating the requested bot is forbidden on the reference");
      break;
    }
    case "explorer": {
      // View navigation only: open the panel when closed, never toggle a
      // visible panel shut. The activity button precedes panel content in DOM
      // order, so the first substring match is the trigger.
      const open = await page.getByRole("textbox", { name: "Find files" }).count().catch(() => 0);
      if (open > 0) notes.push("Explorer panel already open; captured as-is");
      else if (await tryClick(page, "button", "Explorer (⌘⇧E)", 2500)) notes.push("Explorer opened via activity bar");
      else {
        try {
          await page.getByRole("button", { name: "Explorer" }).first().click({ timeout: 2500 });
          await delay(350);
          notes.push("Explorer opened via fallback match");
        } catch {
          missing.push("no Explorer activity button reachable");
        }
      }
      break;
    }
    case "source-control": {
      const open = await page.getByRole("region", { name: "Changes" }).count().catch(() => 0);
      if (open > 0) notes.push("Source Control panel already open; captured as-is");
      else if (await tryClick(page, "button", "Source Control (⌘⇧G)", 2500)) notes.push("Source Control opened via activity bar");
      else {
        try {
          await page.getByRole("button", { name: "Source Control" }).first().click({ timeout: 2500 });
          await delay(350);
          notes.push("Source Control opened via fallback match");
        } catch {
          missing.push("no Source Control activity button reachable");
        }
      }
      break;
    }
    case "source-control-no-remote": {
      const open = await page.getByRole("region", { name: "Changes" }).count().catch(() => 0);
      if (open > 0) notes.push("Source Control panel already open; captured as-is (candidate owns no-remote fixture)");
      else if (await tryClick(page, "button", "Source Control (⌘⇧G)", 2500)) notes.push("Source Control opened via activity bar (candidate owns no-remote fixture)");
      else {
        try {
          await page.getByRole("button", { name: "Source Control" }).first().click({ timeout: 2500 });
          await delay(350);
          notes.push("Source Control opened via fallback match (candidate owns no-remote fixture)");
        } catch {
          missing.push("no Source Control activity button reachable");
        }
      }
      missing.push("ref non-coverage: creating a fixture repository without remotes is forbidden on the reference");
      break;
    }
    case "source-control-dirty": {
      // Navigate-only like source-control: dirty content is ref-owned
      // (nothing created or modified here). When the ref panel shows
      // no changes, the candidate compares against the fork SOURCE
      // (uncommitted-sections.tsx) instead — recorded as non-coverage.
      const open = await page.getByRole("region", { name: "Changes" }).count().catch(() => 0);
      if (open > 0) notes.push("Source Control panel already open; captured as-is (ref owns dirty content)");
      else if (await tryClick(page, "button", "Source Control (⌘⇧G)", 2500)) notes.push("Source Control opened via activity bar (ref owns dirty content)");
      else {
        try {
          await page.getByRole("button", { name: "Source Control" }).first().click({ timeout: 2500 });
          await delay(350);
          notes.push("Source Control opened via fallback match (ref owns dirty content)");
        } catch {
          missing.push("no Source Control activity button reachable");
        }
      }
      break;
    }
    case "create-menu": {
      // The "+" trigger is a Radix DropdownMenuTrigger (fork
      // tab-bar/tab-bar-surface.tsx): clicking opens a menu and creates
      // nothing. Verify the menu census so a behavior change is recorded,
      // never silently acted on.
      const tabsBefore = await page.getByRole("tab").count().catch(() => -1);
      if (await tryClick(page, "button", "New tab")) {
        await delay(600);
        const seen = await overlayState(page);
        if ((seen.menus || 0) > 0) {
          notes.push(`create menu open (dialogs=${seen.dialogs} menus=${seen.menus} palettes=${seen.palettes})`);
          const items = await menuItemNames(page);
          if (items.length) notes.push(`create menu items: ${items.join(" | ")}`);
        } else {
          const tabsAfter = await page.getByRole("tab").count().catch(() => -1);
          if (tabsBefore >= 0 && tabsAfter > tabsBefore) {
            missing.push(`New tab click created a tab instead of a menu (tabs ${tabsBefore} -> ${tabsAfter}); left for the human, ref otherwise untouched`);
          } else missing.push("New tab click opened no menu");
        }
      } else missing.push("no New tab affordance reachable (page view has no strip)");
      break;
    }
    case "sidebar-menus": {
      // Catalog `sidebar-menus`: worktree context menu, Workspace options,
      // Project actions. View navigation plus ephemeral menus only; Esc
      // between menus, the Project actions menu stays open for capture.
      try {
        const card = page.locator('[class*="worktree-card"], .shell-project-row, [class*="project-row"]').first();
        if ((await card.count()) > 0) {
          await card.click({ button: "right", timeout: 2500 });
          await delay(600);
          const seen = await overlayState(page);
          notes.push(seen.menus > 0 ? `worktree context menu open (menus=${seen.menus})` : "worktree right-click opened no menu");
          const items = await menuItemNames(page);
          if (items.length) notes.push(`worktree context menu items: ${items.join(" | ")}`);
        } else notes.push("no worktree/project row to right-click");
      } catch {
        notes.push("worktree right-click best-effort only");
      }
      await dismissOverlays(page);
      let optionsOk = false;
      try {
        const trigger = page.getByRole("button", { name: "Workspace options" }).first();
        if ((await trigger.count()) > 0) {
          await trigger.click({ timeout: 2500 });
          await delay(600);
          const seen = await overlayState(page);
          optionsOk = (seen.menus || 0) > 0;
          notes.push(optionsOk ? `Workspace options open (menus=${seen.menus})` : "Workspace options click opened no menu");
          const items = await menuItemNames(page);
          if (items.length) notes.push(`Workspace options items: ${items.join(" | ")}`);
        } else notes.push("no Workspace options button reachable");
      } catch {
        notes.push("Workspace options best-effort only");
      }
      await dismissOverlays(page);
      let actionsOpen = false;
      try {
        const trigger = page.getByRole("button", { name: "Project actions for" }).first();
        if ((await trigger.count()) > 0) {
          await trigger.click({ timeout: 2500 });
          await delay(600);
          const seen = await overlayState(page);
          actionsOpen = (seen.menus || 0) > 0;
          notes.push(actionsOpen ? `Project actions menu open (menus=${seen.menus})` : "Project actions click opened no menu");
          const items = await menuItemNames(page);
          if (items.length) notes.push(`Project actions items: ${items.join(" | ")}`);
          if (!actionsOpen) await dismissOverlays(page);
        } else notes.push("no Project actions trigger reachable");
      } catch {
        notes.push("Project actions best-effort only");
      }
      if (!actionsOpen && optionsOk) {
        // Fallback capture: the next-best menu, left open.
        try {
          await page.getByRole("button", { name: "Workspace options" }).first().click({ timeout: 2500 });
          await delay(600);
          notes.push("capture fallback: Workspace options left open");
          actionsOpen = true;
        } catch {
          notes.push("capture fallback reopen failed");
        }
      }
      if (!actionsOpen) missing.push("no sidebar menu left open for capture (empty ref has no rows)");
      break;
    }
    case "tab-menus": {
      // Catalog `tab-menus`: the "+" create menu, then the tab context menu
      // (pin/rename/close variants). The context menu stays open for capture;
      // `create-menu` keeps covering the "+" menu on its own.
      if (await tryClick(page, "button", "New tab")) {
        const seen = await overlayState(page);
        notes.push(seen.menus > 0 ? `create menu open (menus=${seen.menus})` : "New tab click opened no menu");
        const items = await menuItemNames(page);
        if (items.length) notes.push(`create menu items: ${items.join(" | ")}`);
      } else notes.push("no New tab affordance reachable (page view has no strip)");
      await dismissOverlays(page);
      try {
        const tab = page.getByRole("tab").first();
        if ((await tab.count()) > 0) {
          await tab.click({ button: "right", timeout: 2500 });
          await delay(600);
          const seen = await overlayState(page);
          if ((seen.menus || 0) > 0) {
            notes.push(`tab context menu open (menus=${seen.menus})`);
            const items = await menuItemNames(page);
            if (items.length) notes.push(`tab context menu items: ${items.join(" | ")}`);
          } else missing.push("tab right-click opened no menu");
        } else missing.push("no tab to right-click (empty ref has no strip)");
      } catch {
        missing.push("tab right-click best-effort only");
      }
      break;
    }
    case "right-rail": {
      // Catalog `right-rail`: cycle the activity bar (Explorer, Mentu,
      // Source Control, Ports) plus an Explorer row menu; ends on Ports.
      // View navigation plus one ephemeral menu only.
      for (const name of ["Explorer", "Mentu", "Source Control"]) {
        try {
          const trigger = page.getByRole("button", { name }).first();
          if ((await trigger.count()) > 0) {
            await trigger.click({ timeout: 2500 });
            await delay(350);
            notes.push(`${name} panel opened`);
          } else notes.push(`no ${name} activity button reachable`);
        } catch {
          notes.push(`${name} best-effort only`);
        }
      }
      try {
        const row = page.locator('[role="treeitem"]').first();
        if ((await row.count()) > 0) {
          await row.click({ button: "right", timeout: 2500 });
          await delay(600);
          const seen = await overlayState(page);
          notes.push(seen.menus > 0 ? `Explorer row menu open (menus=${seen.menus})` : "Explorer row right-click opened no menu");
        } else notes.push("no Explorer row to right-click");
      } catch {
        notes.push("Explorer row menu best-effort only");
      }
      await dismissOverlays(page);
      try {
        const trigger = page.getByRole("button", { name: "Ports" }).first();
        if ((await trigger.count()) > 0) {
          await trigger.click({ timeout: 2500 });
          await delay(350);
          notes.push("Ports panel opened for capture");
        } else notes.push("no Ports activity button reachable");
      } catch {
        notes.push("Ports best-effort only");
      }
      break;
    }
    case "dialogs":
      // Opening Delete Worktree / Remove Project would click a destructive
      // affordance in the live reference. Keep the reference untouched and
      // compare the candidate dialog against the fork source instead.
      missing.push("ref non-coverage: destructive Delete Worktree and Remove Project affordances are never clicked");
      notes.push("ref unchanged: dialog anatomy must be compared from source anchors");
      break;
    case "settings-general": {
      // Catalog `settings-general`: Settings → General (the fork default
      // view, captured in `09-settings`).
      if (await tryClick(page, "button", "Settings")) {
        if (!(await waitForAria(page, "textbox", "Search settings"))) {
          missing.push("Settings click acted but the settings marker never appeared");
          break;
        }
        notes.push("Settings opened via Settings button (marker visible)");
        let general = await tryClick(page, "button", "General", 1500);
        if (!general) {
          try {
            await page.getByRole("tab", { name: "General" }).first().click({ timeout: 1500 });
            await delay(350);
            general = true;
          } catch {
            general = false;
          }
        }
        if (general && (await waitForAria(page, "heading", "General"))) notes.push("General pane opened (marker visible)");
        else if (general) notes.push("General pane clicked (marker not confirmed)");
        else missing.push("no General nav reachable");
      } else missing.push("no Settings button reachable");
      break;
    }
    case "settings-terminal":
    case "settings-agents":
    case "settings-shortcuts":
    case "settings-notifications":
    case "settings-git": {
      // R2 settings panes: Settings → the named pane (fork workflow-group
      // "Terminal", capability-group "Agents", interface-group "Shortcuts").
      // R3 adds Notifications and Git & Source Control. The fork nav label
      // for Git differs from the candidate's honest "Git and GitHub" title,
      // so both labels are tried on each side.
      const pane =
        state === "settings-terminal" ? "Terminal"
        : state === "settings-agents" ? "Agents"
        : state === "settings-shortcuts" ? "Shortcuts"
        : state === "settings-notifications" ? "Notifications"
        : "Git & Source Control";
      const paneAlt = state === "settings-git" ? "Git and GitHub" : state === "settings-shortcuts" ? "Keyboard shortcuts" : null;
      if (await tryClick(page, "button", "Settings")) {
        if (!(await waitForAria(page, "textbox", "Search settings"))) {
          missing.push("Settings click acted but the settings marker never appeared");
          break;
        }
        notes.push("Settings opened via Settings button (marker visible)");
        let opened = await tryClick(page, "button", pane, 1500);
        if (!opened && paneAlt) opened = await tryClick(page, "button", paneAlt, 1500);
        if (!opened) {
          try {
            await page.getByRole("tab", { name: pane }).first().click({ timeout: 1500 });
            await delay(350);
            opened = true;
          } catch {
            opened = false;
          }
        }
        if (opened) notes.push(`${pane} pane opened`);
        else missing.push(`no ${pane} nav reachable`);
      } else missing.push("no Settings button reachable");
      break;
    }
    case "terminal-find": {
      // R2 terminal find: focus the first tab and press the source chord
      // (Mod+F opens TerminalSearch); the role=search bar stays open for
      // capture. View navigation plus a chord only.
      // terminal.search is terminal-scope: focus must land inside the pane.
      try {
        const panel = page.getByRole("tabpanel").first();
        if ((await panel.count()) > 0) {
          await panel.click({ timeout: 2500 });
          await delay(350);
          notes.push("tabpanel focused for find");
        } else notes.push("no tabpanel to focus (empty ref)");
      } catch {
        notes.push("tabpanel focus best-effort only");
      }
      await tryKeys(page, `${MOD}+F`);
      await delay(800);
      const bars = await page.locator('[role="search"]').count().catch(() => -1);
      if (bars > 0) notes.push(`find bar open (role=search count=${bars})`);
      else missing.push("Mod+F opened no find bar");
      break;
    }
    case "browser-find": {
      // R2 browser find: open a browser tab when reachable, focus its guest
      // and press Mod+F (BrowserFind), then right-click the guest for the
      // page context menu; Escape closes the menu, find bar left open.
      if (await tryClick(page, "button", "Browser", 1200)) notes.push("Browser opened");
      else notes.push("no Browser nav button in ref sidebar");
      try {
        const tab = page.getByRole("tab").first();
        if ((await tab.count()) > 0) {
          await tab.click({ timeout: 2500 });
          await delay(350);
        }
      } catch {
        notes.push("tab focus best-effort only");
      }
      await tryKeys(page, `${MOD}+F`);
      await delay(800);
      const bars = await page.locator('[role="search"]').count().catch(() => -1);
      if (bars > 0) notes.push(`find bar open (role=search count=${bars})`);
      else missing.push("Mod+F opened no find bar");
      try {
        await page.getByRole("tabpanel").first().click({ button: "right", timeout: 3000 });
        await delay(600);
        const seen = await overlayState(page);
        notes.push(seen.menus > 0 ? `page context menu open (menus=${seen.menus})` : "guest right-click opened no menu");
      } catch {
        notes.push("guest right-click best-effort only");
      }
      try {
        await page.keyboard.press("Escape");
        await delay(400);
        const seen = await overlayState(page);
        notes.push(seen.menus === 0 ? "Escape closed the context menu" : "Escape left a menu open");
      } catch {
        notes.push("Escape check best-effort only");
      }
      break;
    }
    case "mentu": {
      // R2 Mentu panel: activity-bar item only; the recipe draft/empty state
      // is captured as-is ("Open full tab" is never followed).
      try {
        const trigger = page.getByRole("button", { name: "Mentu" }).first();
        if ((await trigger.count()) > 0) {
          await trigger.click({ timeout: 2500 });
          await delay(350);
          notes.push("Mentu panel opened");
        } else notes.push("no Mentu activity button reachable");
      } catch {
        notes.push("Mentu best-effort only");
      }
      break;
    }
    case "workspace-composer": {
      // The composer is a view-only draft surface here. Opening it does not
      // create a workspace; no field is filled and no submit is pressed.
      let opened = await tryClick(page, "button", "Create workspace", 2500);
      if (!opened) opened = await tryClick(page, "button", "New workspace", 2500);
      if (opened) {
        await delay(500);
        notes.push("workspace composer opened without submitting");
        const advanced = page.getByRole("button", { name: "Advanced", exact: true }).first();
        if ((await advanced.count()) > 0) {
          await advanced.click({ timeout: 2500 });
          await delay(300);
          notes.push("Advanced section expanded (view-only)");
        }
      } else {
        missing.push("no Create workspace/New workspace affordance reachable");
      }
      break;
    }
    case "session-details-panel": {
      // Same read-only navigation as session-details, kept as a separate
      // oracle state so the panel anatomy has its own evidence row.
      try {
        const trigger = page.getByRole("button", { name: "Session details" }).first();
        if ((await trigger.count()) > 0) {
          await trigger.click({ timeout: 2500 });
          await delay(350);
          notes.push("Session details panel opened");
        } else missing.push("no Session details activity button reachable");
      } catch {
        missing.push("Session details best-effort only");
      }
      break;
    }
    case "ports-listening": {
      // Reference data is immutable: inspect the Ports surface without
      // creating a listener. The missing fixture is recorded explicitly.
      if (await tryClick(page, "button", "Ports", 2000)) {
        notes.push("Ports panel opened");
        missing.push("ref non-coverage: listening server cannot be created on the reference");
      } else missing.push("no Ports activity button reachable");
      break;
    }
    case "explorer-selected-file": {
      // Selecting/opening a reference file would mutate tab state, so only
      // the read-only tree surface is opened.
      if (await tryClick(page, "button", "Explorer", 2000)) {
        notes.push("Explorer panel opened");
        missing.push("ref non-coverage: selecting/opening a file is forbidden on the reference");
      } else missing.push("no Explorer activity button reachable");
      break;
    }
    case "editor-dirty-close":
      missing.push("ref non-coverage: opening and dirtying an editor tab is forbidden on the reference");
      notes.push("ref unchanged: dirty editor/close anatomy compared from source anchors");
      break;
    case "automation-run-detail": {
      if (await tryClick(page, "button", "Automations")) {
        if (!(await waitForAria(page, "heading", "Automations"))) {
          missing.push("Automations page marker never appeared");
          break;
        }
        if (await tryClick(page, "button", "Runs", 2000)) {
          await delay(700);
          const row = page.locator("table tbody tr button, [role='row'] button").first();
          if ((await row.count()) > 0) {
            await row.click({ timeout: 2500 });
            await delay(700);
            notes.push("first run row opened for detail capture");
          } else missing.push("ref non-coverage: no retained automation run to open");
        } else missing.push("no Runs button reachable on the Automations page");
      } else missing.push("no Automations nav reachable");
      break;
    }
    case "bots-history": {
      if (await tryClick(page, "button", "Bots")) {
        if (!(await waitForAria(page, "heading", "Bots"))) {
          missing.push("Bots page marker never appeared");
          break;
        }
        notes.push("Bots page opened");
        const history = page.getByText("Responsibility history", { exact: true }).first();
        if ((await history.count()) > 0) notes.push("responsibility history visible");
        else missing.push("ref non-coverage: no Bot responsibility history retained to display");
      } else missing.push("no Bots nav reachable");
      break;
    }
    case "mentu-evidence": {
      if (await tryClick(page, "button", "Mentu")) {
        await delay(350);
        const evidence = page.getByRole("tab", { name: "Evidence", exact: true }).first();
        if ((await evidence.count()) > 0) {
          await evidence.click({ timeout: 2500 });
          await delay(350);
          notes.push("Mentu Evidence tab opened");
        } else missing.push("no Mentu Evidence tab reachable");
      } else missing.push("no Mentu activity button reachable");
      break;
    }
    case "session-details": {
      // R2 session details: the right-sidebar session item, captured as-is.
      try {
        const trigger = page.getByRole("button", { name: "Session details" }).first();
        if ((await trigger.count()) > 0) {
          await trigger.click({ timeout: 2500 });
          await delay(350);
          notes.push("Session details panel opened");
        } else notes.push("no Session details activity button reachable");
      } catch {
        notes.push("Session details best-effort only");
      }
      break;
    }
    case "automation-runs": {
      // R3 runs dashboard: Automations → Runs (AutomationRunsDashboard over
      // automation.runs_all). A first run row is opened best-effort and
      // immediately backed out of; the dashboard stays for capture. View
      // navigation only.
      if (await tryClick(page, "button", "Automations")) {
        if (!(await waitForAria(page, "heading", "Automations"))) {
          missing.push("Automations page marker never appeared");
          break;
        }
        if (await tryClick(page, "button", "Runs", 2000)) {
          await delay(800);
          notes.push("Runs dashboard opened");
          try {
            const row = page.locator("table tbody tr button, [role='row'] button").first();
            if ((await row.count()) > 0) {
              await row.click({ timeout: 2500 });
              await delay(800);
              notes.push("first run row opened (detail); backing out for the dashboard capture");
              if (!(await tryClick(page, "button", "Back", 1500))) await dismissOverlays(page);
              await delay(400);
            } else notes.push("no run rows to open");
          } catch {
            notes.push("run row open best-effort only");
          }
        } else missing.push("no Runs button reachable on the Automations page");
      } else missing.push("no Automations nav reachable");
      break;
    }
    case "bot-responsibilities": {
      // R3 bot responsibilities: Bots → open a bot → Responsibilities. The
      // reference owns its data: when no bot exists nothing is created and
      // the page is captured as-is with an explicit note.
      if (await tryClick(page, "button", "Bots")) {
        if (!(await waitForAria(page, "heading", "Bots"))) {
          missing.push("Bots page marker never appeared");
          break;
        }
        notes.push("Bots page opened (marker visible)");
        try {
          const bot = page.locator("[data-testid='bot-detail'], button:has-text('Responsibilities')").first();
          if ((await bot.count()) > 0) notes.push("bot surface present; opening best-effort");
          else missing.push("no bot rows to open (reference owns its data; nothing created)");
        } catch {
          notes.push("bot open best-effort only");
        }
      } else missing.push("no Bots nav reachable");
      break;
    }
    case "toasts": {
      // R3 toasts: sonner Toaster region after a read-only trigger
      // (terminal context menu → Copy Terminal ID). Nothing is created,
      // renamed or deleted; the toast auto-dismisses.
      try {
        const panel = page.getByRole("tabpanel").first();
        if ((await panel.count()) > 0) {
          await panel.click({ timeout: 2500 });
          await delay(350);
          await panel.click({ button: "right", timeout: 2500 });
          await delay(600);
          const items = await menuItemNames(page);
          if (items.length) notes.push(`terminal context menu items: ${items.join(" | ")}`);
          const copy = page.getByRole("menuitem", { name: /copy terminal id/i }).first();
          if ((await copy.count()) > 0) {
            await copy.click({ timeout: 2500 });
            await delay(900);
            const texts = await toastTexts(page);
            notes.push(texts.length ? `toast visible: ${texts.join(" | ")}` : "Copy Terminal ID acted but no toast appeared");
          } else notes.push("no Copy Terminal ID menu entry");
          await dismissOverlays(page);
        } else notes.push("no tabpanel to focus (empty ref)");
      } catch {
        notes.push("toast trigger best-effort only");
      }
      const idle = await toastTexts(page);
      if (!idle.length) notes.push("toast region idle at capture (no toast showing)");
      break;
    }
    case "editor-tab":
      // Opening a reference file would create a tab; closing it later would
      // violate the read-only contract. Capture the unchanged reference and
      // compare editor-tab anatomy against the fork source.
      missing.push("ref non-coverage: opening a file/editor tab is forbidden on the reference");
      notes.push("ref unchanged: EditorFileTab and TabGroupPanel compared from source anchors");
      break;
    case "split-terminal":
      // Right-clicking the fork's tab close affordance would still violate
      // the read-only rule. Compare this state against the fork split sources.
      missing.push("ref non-coverage: Split Terminal Right requires a terminal tab and the reference tab affordance is never clicked");
      notes.push("ref unchanged: split menu/sash/header compared from source anchors");
      break;
    case "agent-state": {
      // J1/R16-I visuals: worktree-card dots + tab badges (fork
      // AgentStateDot). No clicks anywhere: the live sidebar/cards are
      // captured as-is and the visible state words are recorded.
      try {
        const scan = await page.evaluate(() => {
          const text = (document.body.innerText || "").replace(/\s+/g, " ");
          const words = [];
          for (const w of ["Working", "Idle", "Waiting for input", "No recent update", "Exited", "Active", "Inactive"]) {
            const n = text.split(w).length - 1;
            if (n > 0) words.push(`${w}x${n}`);
          }
          // Worktree cards live in the sidebar listbox: record their copy
          // (agent rows, badges) without clicking anything.
          const cards = [...document.querySelectorAll('[role="listbox"] [role="option"]')]
            .slice(0, 6)
            .map((el) => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120));
          return { words, cards };
        }).catch(() => null);
        if (scan) {
          notes.push(scan.words.length ? `visible state words: ${scan.words.join(" ")}` : "no Working/Idle/Waiting/Exited words visible");
          if (scan.cards.length) notes.push(`worktree cards: ${scan.cards.join(" || ")}`);
        } else notes.push("sidebar scan best-effort only");
      } catch {
        notes.push("state-word scan best-effort only");
      }
      notes.push("fork anchors: components/AgentStateDot.tsx, AgentWorkingSpinner.tsx, tab-bar/TerminalTabLeadingIcon.tsx, sidebar/worktree-card-compact-agents.tsx");
      break;
    }
    case "status-bar-usage-states":
      notes.push("usage loading/signed-out/data variants are candidate-only fixture captures; reference strip remains read-only");
      break;
    case "statusbar-strip":
      notes.push("full-page capture; strip cropped in post");
      break;
    default:
      missing.push(`unknown state ${state}`);
  }
  ctx.refNotes = notes;
  return { notes, missing };
}

async function refTeardown(page, state) {
  // Every state leaves through the known-home path (Settings back row,
  // Sessions nav) so the next setup starts clean. View navigation only —
  // no data is created or changed.
  const notes = [];
  // Reference teardown never clicks a close/remove/delete affordance. The
  // editor-tab state is explicitly source-only, so there is no tab to close.
  if (
    state === "command-palette" ||
    state === "quick-open" ||
    state === "launch-dialog" ||
    state === "workspace-composer" ||
    state === "settings-shortcuts-rebind" ||
    state === "automation-editor-cron-preview"
  ) {
    // R6: the palette / create menu / shortcut recorder are not all
    // visible to the overlay census on the reference side, so Escape
    // unconditionally (closes palettes and menus, cancels shortcut
    // recording). Escape never closes tabs; no chord is ever pressed
    // while recording, so reference settings cannot change.
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press("Escape").catch(() => {});
      await delay(200);
    }
    notes.push("teardown: Escape x2 for palette/menu/recorder/composer overlay");
  }
  await ensureHome(page, notes);
  for (const [i, n] of notes.entries()) notes[i] = n.replace(/^home:/, "teardown:");
  void state;
  return notes;
}

/**
 * The owned candidate is launched with a real window whose content area is
 * VIEWPORT; emulation (setViewportSize) is only a fallback when the window
 * could not take that size, because device-metrics emulation makes the
 * xterm canvas render at the wrong scale and misreports the layout.
 */
async function ensureCandidateViewport(page, notes = []) {
  const size = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  if (size.w === VIEWPORT.width && size.h === VIEWPORT.height) return;
  notes.push(`candidate window is ${size.w}x${size.h}; emulating ${VIEWPORT.width}x${VIEWPORT.height}`);
  await page.setViewportSize(VIEWPORT);
}

async function reloadCandidateForUsageFixture(page, notes) {
  await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
  await emulatePageFocus(page).catch(() => {});
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor({ timeout: 25000 });
  await ensureCandidateViewport(page, notes);
  await delay(500);
}

// R6 shared fixture: deterministic Tasks rows without GitHub (also used
// by tasks-filters for the PR-mode chrome). A scratch git repo with a
// GitHub-shaped remote, registered as a project with one worktree. The
// daemon's `gh` is the fixture bin (see launchCandidate), so no network
// or account is touched and no issue/PR is created or mutated.
// Registration and the worktree go through drogon-cli (same RPCs as the
// dialogs); the reload lets App.refresh pick both up, because the main
// column — Tasks included — only renders with at least one workspace.
// Runs once per oracle invocation (ctx.tasksFixtureReady skips repeats so
// a second state cannot register the repo twice). Returns true when the
// Issues-mode rows rendered.
async function setupTasksRowsFixture(page, ctx, notes, missing) {
  if (!ctx.dataDir) {
    missing.push("tasks fixture needs the owned candidate (dataDir unavailable)");
    return false;
  }
  if (process.platform === "win32") {
    missing.push("tasks fixture gh is unix-only");
    return false;
  }
  const cliBin = path.join(
    root, "target", "debug", "drogon-cli",
  );
  const tasksRepo = path.join(path.dirname(ctx.workspace), "tasks-repo");
  try {
    await mkdir(tasksRepo, { recursive: true });
    await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: tasksRepo }).catch(() => {});
    await execFileAsync("git", ["config", "user.email", "fixture@example.com"], { cwd: tasksRepo }).catch(() => {});
    await execFileAsync("git", ["config", "user.name", "fixture"], { cwd: tasksRepo }).catch(() => {});
    await writeFile(path.join(tasksRepo, "README.md"), "tasks fixture\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: tasksRepo }).catch(() => {});
    await execFileAsync("git", ["commit", "-q", "-m", "initial"], { cwd: tasksRepo }).catch(() => {});
    await execFileAsync("git", ["remote", "remove", "origin"], { cwd: tasksRepo }).catch(() => {});
    await execFileAsync("git", ["remote", "add", "origin", "https://github.com/example/repo.git"], { cwd: tasksRepo }).catch(() => {});
    // #246: a distinct upstream remote makes the candidate render the
    // fork's issue-source selector (Upstream/Origin pills), which the
    // reference shows on tasks-filters; single-remote repos correctly
    // render nothing.
    await execFileAsync("git", ["remote", "remove", "upstream"], { cwd: tasksRepo }).catch(() => {});
    await execFileAsync("git", ["remote", "add", "upstream", "https://github.com/upstream-org/repo.git"], { cwd: tasksRepo }).catch(() => {});
    notes.push("fixture: tasks-repo git repo with divergent GitHub origin+upstream remotes");
  } catch {
    missing.push("tasks-repo git fixture failed");
    return false;
  }
  let projectId = null;
  try {
    const out = await execFileAsync(cliBin, [
      "--data-dir", ctx.dataDir, "--json", "project", "add", tasksRepo,
    ]);
    projectId = JSON.parse(out.stdout).result?.id ?? null;
    notes.push("fixture: tasks-repo registered as a project");
  } catch (error) {
    missing.push(`tasks-repo registration failed: ${error.message.split("\n")[0]}`);
    return false;
  }
  try {
    await execFileAsync(cliBin, [
      "--data-dir", ctx.dataDir, "--json",
      "worktree", "create", "--project", projectId, "--name", "fixture-wt",
    ]);
    notes.push("fixture: one worktree created (main column needs a workspace)");
  } catch (error) {
    missing.push(`tasks-repo worktree failed: ${error.message.split("\n")[0]}`);
    return false;
  }
  try {
    await page.reload();
    await emulatePageFocus(page).catch(() => {});
    await page
      .getByRole("button", { name: "Reveal active workspace", exact: true })
      .waitFor({ timeout: 25000 });
    await ensureCandidateViewport(page, notes);
    notes.push("candidate reloaded around the fixture");
  } catch (error) {
    missing.push(`candidate reload failed: ${error.message.split("\n")[0]}`);
    return false;
  }
  if (await tryClick(page, "button", "Tasks")) notes.push("Tasks nav opened");
  else missing.push("no Tasks nav reachable");
  let tasksOpen = false;
  for (let i = 0; i < 3 && !tasksOpen; i++) {
    try {
      await page
        .getByPlaceholder("Search GitHub issues...")
        .first()
        .waitFor({ timeout: 8000 });
      tasksOpen = true;
    } catch {
      await tryClick(page, "button", "Tasks");
    }
  }
  if (!tasksOpen) {
    missing.push("Tasks page chrome never appeared");
    return false;
  }
  try {
    const project = page.getByRole("combobox", { name: "Project", exact: true }).first();
    if ((await project.count()) > 0) {
      await project.selectOption({ label: "tasks-repo" });
      await delay(900);
      notes.push("Tasks project selector set to tasks-repo fixture");
    }
  } catch {
    missing.push("Tasks project selector could not choose tasks-repo fixture");
  }
  try {
      await page
        .getByRole("button", { name: "Fixture sidebar issue 137" })
        .first()
        .waitFor({ timeout: 25000 });
      notes.push("fixture rows rendered (Fixture sidebar issue 137 visible)");
    } catch {
      missing.push("fixture rows did not render within 25s");
    }
  try {
    const pager = await page.getByRole("navigation", { name: "Pagination" }).count();
    notes.push(pager > 0 ? "pagination strip rendered (37-issue probe)" : "pagination strip absent (single page)");
  } catch {
    notes.push("pagination probe best-effort only");
  }
  ctx.tasksFixtureReady = true;
  return true;
}

async function candSetup(page, state, ctx) {
  const notes = [];
  const missing = [];
  await ensureCandidateViewport(page, notes);
  await ensureHome(page, notes);
  const chordOverlay = async (chord, label) => {
    await tryKeys(page, chord);
    await delay(1200);
    const seen = await overlayState(page);
    if (overlayCount(seen) > 0) {
      notes.push(
        `${label} chord ${chord}: overlay open (dialogs=${seen.dialogs} menus=${seen.menus} palettes=${seen.palettes})`,
      );
      return true;
    }
    notes.push(`${label} chord ${chord}: no overlay appeared`);
    return false;
  };
  // R6: filter-only query for palette result rows (never Enter: that
  // would jump the selection; teardown Escape dismisses the palette).
  const typePaletteQuery = async (query) => {
    try {
      let field = page.getByRole("combobox", { name: "Go to file", exact: true }).first();
      if ((await field.count()) === 0) {
        field = page.locator(".command-palette-overlay input.command-palette-input").first();
      }
      if ((await field.count()) === 0) {
        field = page.getByRole("combobox").first();
      }
      if ((await field.count()) === 0) {
        return "query field not found (captured unfiltered)";
      }
      await field.fill(query);
      await delay(900);
      const rows = await page.getByRole("option").count().catch(() => -1);
      const items = await page.getByRole("menuitem").count().catch(() => -1);
      return `query "${query}" typed (filter-only): options=${rows} menuitems=${items}`;
    } catch (error) {
      return `query typing best-effort only: ${error.message.split("\n")[0]}`;
    }
  };
  const ensureProject = async () => {
    if (ctx.candProjectId) return true;
    const count = await page.evaluate(async () => {
      try {
        const r = await window.drogon.workspaces();
        return r.ok ? r.result.workspaces.length : -1;
      } catch {
        return -1;
      }
    }).catch(() => -1);
    if (count > 0) {
      ctx.candProjectId = "existing";
      return true;
    }
    const opened =
      (await tryClick(page, "button", "Add project")) ||
      (await tryClick(page, "button", "Add Project")) ||
      (await tryClick(page, "button", "Create workspace"));
    if (!opened) {
      missing.push("no Add project/workspace affordance");
      return false;
    }
    try {
      await page.getByLabel(/^Folder( or repository)? path$/).fill(ctx.workspace);
      await page
        .getByRole("dialog", { name: "Add Project" })
        .getByRole("button", { name: "Add Project", exact: true })
        .click();
      // R9-B: the empty view is the source's "No workspaces found" block
      // now, so registration readiness waits for a project row instead.
      await page.waitForFunction(
        () => document.querySelector(".shell-project-row") !== null,
        null,
        { timeout: 8000 },
      ).catch(() => {});
      ctx.candProjectId = "created";
      notes.push(`folder project registered at <TMP>/folder`);
      return true;
    } catch (error) {
      missing.push(`project registration failed: ${error.message.split("\n")[0]}`);
      return false;
    }
  };
  const selectFixtureWorkspace = async () => {
    try {
      const fixtureName = path.basename(ctx.workspace);
      const select = page.getByRole("button", { name: new RegExp(`^Select ${fixtureName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`) }).first();
      if ((await select.count()) > 0) {
        await select.click({ timeout: 3000 });
        await delay(500);
        notes.push(`fixture workspace selected: ${fixtureName}`);
        return true;
      }
    } catch {
      /* active workspace may already be selected */
    }
    return false;
  };
  const clickActivity = async (name) => {
    try {
      const escaped = name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
      const trigger = page.getByRole("button", { name: new RegExp(`^${escaped}(?:$|\\s|\\()`) }).first();
      if ((await trigger.count()) === 0) return false;
      await trigger.click({ timeout: 3000 });
      await delay(350);
      return true;
    } catch {
      return false;
    }
  };
  const ensureTerminal = async () => {
    const terminalTabs = await page.getByRole("tab", { name: /\blive\b/i }).count().catch(() => 0);
    if (terminalTabs > 0) return true;
    if (!(await ensureProject())) return false;
    // The launcher is the tab strip "+" static create menu ("New tab"
    // button opens New Terminal / per-harness rows / New Browser Tab):
    // click through the New Terminal entry.
    if (!(await tryClick(page, "button", "New tab"))) {
      missing.push("no New tab affordance");
      return false;
    }
    await delay(600);
    try {
      const item = page.getByRole("menuitem", { name: /^New Terminal/ });
      if ((await item.count()) > 0) {
        await item.first().click({ timeout: 3000 });
        notes.push("create menu: plain New Terminal chosen");
        await delay(500);
      }
    } catch {
      /* single-action launcher: no menu */
    }
    await dismissOverlays(page);
    try {
      await page.getByRole("tab").first().waitFor({ timeout: 20000 });
      // The pty can accept input before the shell prints its first prompt;
      // wait for evidence the shell is alive so the marker is not swallowed.
      await page
        .waitForFunction(
          () => /[$#%]/.test((() => {
        const registry = window.__drogonTerminals;
        if (registry && registry.size > 0) {
          const lines = [];
          for (const terminal of registry.values()) {
            const buffer = terminal.buffer.active;
            for (let row = 0; row < buffer.length; row += 1) {
              lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
            }
          }
          return lines.join("\n");
        }
        return document.querySelector(".xterm-screen")?.textContent ?? "";
      })()),
          null,
          { timeout: 20000 },
        )
        .catch(() => {});
      await page.locator(".xterm-helper-textarea").first().focus({ timeout: 5000 });
      const marker = `FID_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      ctx.marker = marker;
      // Typed input can land while the shell is still initializing and get
      // garbled, so retry with a fresh prompt (Ctrl+C) until echoed.
      let echoed = false;
      for (let attempt = 0; attempt < 3 && !echoed; attempt++) {
        await page.locator(".xterm-helper-textarea").first().focus({ timeout: 5000 });
        await page.keyboard.press("Control+C");
        await delay(400);
        await page.keyboard.type(`printf '${marker}\\n'`);
        await page.keyboard.press("Enter");
        try {
          await page.waitForFunction(
            (value) => (() => {
        const registry = window.__drogonTerminals;
        if (registry && registry.size > 0) {
          const lines = [];
          for (const terminal of registry.values()) {
            const buffer = terminal.buffer.active;
            for (let row = 0; row < buffer.length; row += 1) {
              lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
            }
          }
          return lines.join("\n");
        }
        return document.querySelector(".xterm-screen")?.textContent ?? "";
      })().includes(value),
            marker,
            { timeout: 9000 },
          );
          echoed = true;
        } catch {
          notes.push(`marker attempt ${attempt + 1}: no echo yet, retrying`);
        }
      }
      assert.ok(echoed, `marker ${marker} never echoed in terminal`);
      notes.push("live terminal with marker output");
      return true;
    } catch (error) {
      missing.push(`terminal fixture failed: ${error.message.split("\n")[0]}`);
      return false;
    }
  };
  const reloadCandidate = async (label) => {
    try {
      await page.reload();
      await emulatePageFocus(page).catch(() => {});
      await page
        .getByRole("button", { name: "Reveal active workspace", exact: true })
        .waitFor({ timeout: 25000 });
      await ensureCandidateViewport(page, notes);
      notes.push(`${label}: candidate reloaded around the fixture`);
      return true;
    } catch (error) {
      missing.push(`${label}: candidate reload failed: ${error.message.split("\n")[0]}`);
      return false;
    }
  };
  // R5: a real git project for the Source Control panel. Folder
  // projects never pass the right activity bar's gitOnly gate, so the
  // repo is registered through drogon-cli (same RPCs as the Add
  // Project dialog, per #146/#160) and the candidate reloads so App
  // picks it up. Returns the sc-wt worktree path, or null with
  // missing noted.
  const ensureGitProject = async (label) => {
    if (!ctx.dataDir) {
      missing.push(`${label} needs the owned candidate (dataDir unavailable)`);
      return null;
    }
    if (process.platform === "win32") {
      missing.push(`${label} git fixture is unix-only`);
      return null;
    }
    const cliBin = path.join(root, "target", "debug", "drogon-cli");
    const repo = path.join(path.dirname(ctx.workspace), "sc-repo");
    try {
      await mkdir(repo, { recursive: true });
      await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: repo }).catch(() => {});
      await execFileAsync("git", ["config", "user.email", "fixture@example.com"], { cwd: repo }).catch(() => {});
      await execFileAsync("git", ["config", "user.name", "fixture"], { cwd: repo }).catch(() => {});
      await writeFile(path.join(repo, "notes.txt"), "sc fixture\n");
      await execFileAsync("git", ["add", "notes.txt"], { cwd: repo }).catch(() => {});
      // Already committed on a rerun: "nothing to commit" fails here
      // and is ignored; the tree keeps its committed base.
      await execFileAsync("git", ["commit", "-q", "-m", "initial"], { cwd: repo }).catch(() => {});
      notes.push("fixture: sc-repo git repo with one commit");
    } catch (error) {
      missing.push(`sc-repo git fixture failed: ${error.message.split("\n")[0]}`);
      return null;
    }
    if (!ctx.scProjectId) {
      try {
        const out = await execFileAsync(cliBin, [
          "--data-dir", ctx.dataDir, "--json", "project", "add", repo,
        ]);
        ctx.scProjectId = JSON.parse(out.stdout).result?.id ?? "registered";
        notes.push("fixture: sc-repo registered as a project");
      } catch (error) {
        missing.push(`sc-repo registration failed: ${error.message.split("\n")[0]}`);
        return null;
      }
      // A project is not a workspace: only a worktree becomes the
      // active workspace the panel binds to (real `git worktree add`
      // under the hood, like the Create-workspace dialog).
      try {
        const out = await execFileAsync(cliBin, [
          "--data-dir", ctx.dataDir, "--json",
          "worktree", "create", "--project", ctx.scProjectId, "--name", "sc-wt",
        ]);
        ctx.scWorktreePath = JSON.parse(out.stdout).result?.path ?? null;
        notes.push("fixture: sc-wt worktree created (active-workspace candidate)");
      } catch (error) {
        missing.push(`sc-wt worktree failed: ${error.message.split("\n")[0]}`);
        return null;
      }
      if (!ctx.scWorktreePath) {
        missing.push("sc-wt worktree path missing from CLI output");
        return null;
      }
      if (!(await reloadCandidate("fixture"))) return null;
    }
    // Prefer sc-wt as the active workspace so the panel binds to it.
    // The sidebar repopulates asynchronously after a reload, so wait
    // for the row instead of probing it once.
    try {
      const select = page.getByRole("button", { name: /^Select sc-wt/ }).first();
      await select.waitFor({ timeout: 15000 });
      await select.click({ timeout: 3000 });
      await delay(500);
      notes.push("sc-wt selected as the active workspace");
    } catch {
      notes.push("sc-wt Select unavailable (reload selection kept)");
    }
    ctx.editorWorkspacePath = ctx.scWorktreePath ?? repo;
    return ctx.editorWorkspacePath;
  };
  // The commit composer only renders with uncommitted changes, so panel
  // presence probes region "Changes", not the commit box.
  const openSourceControl = async () => {
    const panelOpen = () => page.getByRole("region", { name: "Changes" }).count().catch(() => 0);
    if ((await panelOpen()) > 0) {
      notes.push("Source Control panel already open; captured as-is");
      return true;
    }
    try {
      await page.getByRole("button", { name: "Source Control" }).first().click({ timeout: 3000 });
      await delay(500);
      const nowOpen = await panelOpen();
      notes.push(nowOpen > 0 ? "Source Control opened through the right activity bar" : "Source Control click acted but the Changes panel never appeared");
      return nowOpen > 0;
    } catch {
      missing.push("Source Control activity button unavailable (capability or fixture)");
      return false;
    }
  };
  const openBrowserTab = async () => {
    if (!(await ensureProject())) return null;
    if (!(await tryClick(page, "button", "New tab"))) {
      missing.push("no New tab affordance reachable for browser fixture");
      return null;
    }
    await delay(500);
    try {
      const entry = page.getByRole("menuitem", { name: /^New Browser Tab/ }).first();
      if ((await entry.count()) === 0) {
        missing.push("no New Browser Tab menu entry reachable");
        await dismissOverlays(page);
        return null;
      }
      await entry.click({ timeout: 3000 });
      await delay(1200);
      await dismissOverlays(page);
      const address = page.getByRole("combobox", { name: "Address", exact: true }).first();
      await address.waitFor({ timeout: 8000 });
      return address;
    } catch (error) {
      missing.push(`browser tab fixture failed: ${error.message.split("\\n")[0]}`);
      await dismissOverlays(page);
      return null;
    }
  };
  const openEditorFile = async () => {
    await ensureProject().catch(() => {});
    const editorWorkspace = ctx.editorWorkspacePath ?? ctx.workspace;
    try {
      await writeFile(path.join(editorWorkspace, "notes.txt"), "editor header fixture\\n");
      notes.push("fixture: notes.txt written");
    } catch {
      notes.push("fixture write best-effort only");
    }
    const open = await page.getByRole("textbox", { name: "Find files" }).count().catch(() => 0);
    if (open === 0) {
      try {
        await page.getByRole("button", { name: "Explorer" }).first().click({ timeout: 3000 });
        await delay(350);
      } catch {
        missing.push("Explorer activity button unavailable for editor header");
        return false;
      }
    }
    try {
      const row = page.getByRole("button", { name: "notes.txt", exact: true }).first();
      await row.waitFor({ timeout: 8000 });
      await row.click({ timeout: 3000 });
      await delay(1200);
      const editor = page.locator(".editor-pane").first();
      await editor.waitFor({ timeout: 12000 });
      notes.push("notes.txt editor opened");
      return true;
    } catch (error) {
      missing.push(`editor header fixture failed: ${error.message.split("\\n")[0]}`);
      return false;
    }
  };
  const workspaceIdForFixture = async () => {
    try {
      const response = await page.evaluate(async () => window.drogon.workspaces());
      const walk = (value) => {
        if (Array.isArray(value)) {
          for (const entry of value) {
            const found = walk(entry);
            if (found) return found;
          }
        } else if (value && typeof value === "object") {
          if (typeof value.id === "string" && typeof value.path === "string" && value.path === ctx.workspace) return value.id;
          for (const entry of Object.values(value)) {
            const found = walk(entry);
            if (found) return found;
          }
        }
        return null;
      };
      const payload = response?.result ?? response;
      const exact = walk(payload);
      if (exact) return exact;
      const listed = Array.isArray(payload)
        ? payload
        : payload?.workspaces ?? payload?.data?.workspaces ?? response?.workspaces ?? [];
      const firstListed = listed.find((entry) => typeof entry?.id === "string");
      if (firstListed) return firstListed.id;
      const anyWorkspace = (value) => {
        if (Array.isArray(value)) {
          return value.map(anyWorkspace).find(Boolean) ?? null;
        }
        if (value && typeof value === "object") {
          if (typeof value.id === "string" && typeof value.path === "string") return value.id;
          return Object.values(value).map(anyWorkspace).find(Boolean) ?? null;
        }
        return null;
      };
      return anyWorkspace(response);
    } catch {
      return null;
    }
  };
  const openPlainTerminal = async () => {
    if (!(await tryClick(page, "button", "New tab"))) return false;
    await delay(500);
    try {
      const item = page.getByRole("menuitem", { name: "New Terminal", exact: true }).first();
      if ((await item.count()) > 0) await item.click({ timeout: 3000 });
    } catch {
      return false;
    }
    await dismissOverlays(page);
    try {
      await page.getByRole("tab").last().waitFor({ timeout: 20000 });
      await delay(500);
      return true;
    } catch {
      return false;
    }
  };
  switch (state) {
    case "worktree-card-rows": {
      // Owned-only fixture: two shell sessions plus a Pi-shaped local-model
      // harness session. The fake Pi executable only prints/sleeps; no model
      // inference or provider network is used.
      if (!(await ensureProject()) || !(await ensureTerminal())) {
        missing.push("project-terminal fixture unavailable for worktree card rows");
        break;
      }
      const workspaceId = await workspaceIdForFixture();
      const cliBin = path.join(root, "target", "debug", "drogon-cli");
      if (!workspaceId || !ctx.dataDir) {
        missing.push("workspace id unavailable for Pi fixture");
        break;
      }
      try {
        await execFileAsync(cliBin, [
          "--data-dir", ctx.dataDir, "--json", "terminal", "create",
          "--workspace", workspaceId, "--", "/bin/sh",
        ]);
        notes.push("second shell session started from a shell fixture");
      } catch (error) {
        missing.push(`second shell fixture failed: ${error.message.split("\\n")[0]}`);
      }
      try {
        await execFileAsync(cliBin, [
          "--data-dir", ctx.dataDir, "--json", "harness", "start",
          "--workspace", workspaceId, "--harness", "pi",
          "--provider", "dgx-spark", "--model", "qwen3.8-flash-next-nvidia-nvfp4",
          "--permission-mode", "unattended",
        ]);
        notes.push("Pi local-model session started from a shell fixture (no inference)");
      } catch (error) {
        missing.push(`Pi local-model fixture failed: ${error.message.split("\\n")[0]}`);
      }
      let piSessionSeen = false;
      const piDeadline = Date.now() + 20000;
      while (Date.now() < piDeadline && !piSessionSeen) {
        try {
          const listed = await execFileAsync(cliBin, [
            "--data-dir", ctx.dataDir, "--json", "terminal", "list", "--workspace", workspaceId,
          ]);
          const payload = JSON.parse(listed.stdout);
          const sessions = payload.result?.sessions ?? payload.sessions ?? [];
          piSessionSeen = sessions.some((session) =>
            session.harnessId === "pi" || session.command === "pi" || session.args?.includes("dgx-spark"),
          );
        } catch {
          /* the daemon may still be persisting the harness session */
        }
        if (!piSessionSeen) await delay(500);
      }
      if (piSessionSeen) notes.push("Pi session persisted in the daemon fixture");
      try {
        await page.waitForFunction(
          () => (document.body.innerText || "").includes("Pi"),
          null,
          { timeout: 15000 },
        );
        notes.push("worktree card nested session rows rendered");
      } catch {
        missing.push(
          piSessionSeen
            ? "Pi session persisted but nested rows did not render within 15s"
            : "Pi/session rows did not render within 15s",
        );
      }
      break;
    }
    case "browser-tab-loading": {
      const address = await openBrowserTab();
      if (!address || !ctx.browserFixture) {
        missing.push("browser loading fixture unavailable");
        break;
      }
      try {
        await address.fill(ctx.browserFixture.slowUrl);
        await page.keyboard.press("Enter");
        await delay(180);
        notes.push("slow browser fixture requested; captured while loading");
        const loading = await page.locator("[aria-label*='loading' i], [data-loading='true']").count().catch(() => 0);
        notes.push(loading > 0 ? "loading indicator DOM visible" : "loading indicator DOM not exposed; strip captured during pending navigation");
      } catch (error) {
        missing.push(`browser loading navigation failed: ${error.message.split("\\n")[0]}`);
      }
      break;
    }
    case "editor-header": {
      await ensureGitProject("editor-header");
      if (!(await openEditorFile())) break;
      const pathButton = await page.locator(".editor-header-path").count().catch(() => 0);
      const edit = await page.getByRole("radio", { name: "Edit", exact: true }).count().catch(() => 0);
      const changes = await page.getByRole("radio", { name: "Changes", exact: true }).count().catch(() => 0);
      notes.push(`editor header controls: path=${pathButton} edit=${edit} changes=${changes}`);
      if (!pathButton) missing.push("editor file-path button missing");
      if (!edit || !changes) missing.push("Edit/Changes view toggle missing");
      try {
        const more = page.getByRole("button", { name: "More actions", exact: true }).first();
        if ((await more.count()) === 0) missing.push("editor More actions button missing");
        else {
          await more.click({ timeout: 3000 });
          await delay(500);
          const items = await menuItemNames(page);
          notes.push(items.length ? `editor More actions items: ${items.join(" | ")}` : "editor More actions menu opened with no visible items");
        }
      } catch (error) {
        missing.push(`editor More actions menu failed: ${error.message.split("\\n")[0]}`);
      }
      break;
    }
    case "address-bar-suggestions": {
      await ensureProject().catch(() => {});
      const historyWorkspaceId = await workspaceIdForFixture();
      notes.push(`history workspace: ${historyWorkspaceId ?? "unavailable"}`);
      if (historyWorkspaceId && ctx.browserFixture) {
        await page.evaluate(
          ({ workspaceId, recentUrls }) => {
            window.localStorage.setItem(
              `drogon.browser.recentUrls.${workspaceId}`,
              JSON.stringify(
                recentUrls.map((url, index) => ({
                  url,
                  title: `Fixture page ${index + 1}`,
                  lastVisitedAt: Date.now() - index * 1000,
                  visitCount: 1,
                })),
              ),
            );
          },
          { workspaceId: historyWorkspaceId, recentUrls: ctx.browserFixture.recentUrls },
        );
        notes.push("fixture: seeded workspace-local recent browser URLs");
      }
      const address = await openBrowserTab();
      if (!address || !ctx.browserFixture) {
        missing.push("browser suggestions fixture unavailable");
        break;
      }
      try {
        for (const url of ctx.browserFixture.recentUrls) {
          await address.fill(url);
          await page.keyboard.press("Enter");
          await delay(1100);
        }
        await page.keyboard.press("Tab");
        await delay(50);
        await address.click();
        await address.fill("fixture");
        await delay(100);
        const suggestions = await page.getByRole("option").count().catch(() => 0);
        const search = await page.getByText(/Search Google for/i).count().catch(() => 0);
        const addressDebug = await page.evaluate(() => {
          const input = document.querySelector('[data-drogon-browser-address-bar]');
          const list = document.querySelector('#browser-history-listbox');
          return {
            value: input?.getAttribute('value') ?? (input instanceof HTMLInputElement ? input.value : null),
            expanded: input?.getAttribute('aria-expanded'),
            focused: document.activeElement === input,
            bodyInputs: [...document.querySelectorAll('[data-drogon-browser-address-bar]')].map((node) => ({
              value: node instanceof HTMLInputElement ? node.value : null,
              expanded: node.getAttribute('aria-expanded'),
              focused: document.activeElement === node,
            })),
            listText: list?.textContent ?? null,
            historyKeys: Object.keys(window.localStorage).filter((key) => key.includes('recentUrls')),
          };
        }).catch(() => null);
        notes.push(`address suggestions: options=${suggestions} search-action=${search}`);
        notes.push(`address debug: ${JSON.stringify(addressDebug)}`);
        if (!suggestions && !search) missing.push("typed address word produced no suggestion list");
      } catch (error) {
        missing.push(`address suggestions fixture failed: ${error.message.split("\\n")[0]}`);
      }
      break;
    }
    case "empty":
      notes.push(ctx.candProjectId ? "project already exists; captured as-is" : "fresh empty app");
      break;
    case "project-terminal":
      if (!(await ensureTerminal())) missing.push("project-terminal fixture unavailable");
      break;
    case "palette":
      await ensureProject().catch(() => {});
      // Candidate vocabulary (shortcuts.ts PALETTE_SHORTCUTS): the command
      // palette is worktree.palette on Mod+J — Mod+K is terminal.clear and
      // must open nothing outside a terminal.
      if (!(await chordOverlay(`${MOD}+J`, "palette.worktree.palette"))) {
        missing.push("Mod+J (worktree.palette) opened no overlay");
      }
      break;
    case "quick-open": {
      // R6: one-char filter for results (filter-only, never Enter). Two
      // fixture files so the file rows (type icons, N-files-found live
      // region) render instead of the empty-workspace notice.
      await ensureProject().catch(() => {});
      try {
        await writeFile(path.join(ctx.workspace, "notes.txt"), "quick-open fixture\n");
        await writeFile(path.join(ctx.workspace, "guide.md"), "quick-open fixture\n");
        notes.push("fixture: two files written for result rows");
      } catch {
        notes.push("fixture write best-effort only");
      }
      if (!(await chordOverlay(`${MOD}+P`, "palette.worktree.quickOpen"))) {
        missing.push("Mod+P (worktree.quickOpen) opened no overlay");
        break;
      }
      notes.push(await typePaletteQuery("e"));
      break;
    }
    case "command-palette": {
      // R6: commands mode with results. Mod+K is terminal.clear, never
      // the palette (parity with the fork) — record that it opens
      // nothing — then Mod+J (worktree.palette) plus a typed query.
      await ensureProject().catch(() => {});
      await tryKeys(page, `${MOD}+K`);
      await delay(1200);
      const kSeen = await overlayState(page);
      notes.push(
        overlayCount(kSeen) > 0
          ? `Mod+K unexpectedly opened an overlay (dialogs=${kSeen.dialogs} menus=${kSeen.menus} palettes=${kSeen.palettes})`
          : "Mod+K opened no palette (terminal.clear parity)",
      );
      if (!(await chordOverlay(`${MOD}+J`, "palette.worktree.palette"))) {
        missing.push("Mod+J (worktree.palette) opened no overlay");
        break;
      }
      notes.push(await typePaletteQuery("a"));
      break;
    }
    case "launch-dialog": {
      // R7 source correction: the fork's QuickLaunchButton rows launch
      // immediately with stored defaults; there is no per-launch form. Keep
      // the create menu open as the safe, no-launch capture on the candidate.
      await ensureProject().catch(() => {});
      await ensureTerminal().catch(() => {});
      if (!(await tryClick(page, "button", "New tab"))) {
        missing.push("no New tab affordance reachable");
        break;
      }
      await delay(600);
      const seen = await overlayState(page);
      if ((seen.menus || 0) === 0) {
        missing.push("New tab create menu did not open");
        break;
      }
      notes.push(`launch menu open (dialogs=${seen.dialogs} menus=${seen.menus} palettes=${seen.palettes})`);
      const items = await menuItemNames(page);
      if (items.length) notes.push(`launch menu items: ${items.join(" | ")}`);
      break;
    }
    case "workspace-composer": {
      // Open the owned composer only. The fixture is intentionally not
      // submitted, so this state cannot create a workspace or session.
      // The git fixture project (sc-repo) makes the capture like-for-like
      // with the reference, whose selected project is a git repo (title
      // "Create worktree", git Advanced rows).
      await ensureGitProject("workspace-composer");
      let opened = await tryClick(page, "button", "Create workspace", 3000);
      if (!opened) opened = await tryClick(page, "button", "New workspace", 3000);
      if (opened) {
        await delay(500);
        notes.push("workspace composer opened without submitting");
        try {
          const picker = page.getByRole("combobox", { name: "Project" });
          await picker.click({ timeout: 3000 });
          const gitRow = page.getByRole("option", { name: /^sc-repo/ }).first();
          if ((await gitRow.count()) > 0) {
            await gitRow.click({ timeout: 3000 });
            notes.push("git project selected in the composer (view-only)");
          }
        } catch {
          notes.push("git project preselection best-effort only");
        }
        const advanced = page.getByRole("button", { name: "Advanced", exact: true }).first();
        if ((await advanced.count()) > 0) {
          await advanced.click({ timeout: 3000 });
          await delay(300);
          notes.push("Advanced section expanded");
        }
      } else missing.push("no Create workspace/New workspace affordance reachable");
      break;
    }
    case "settings-shortcuts-rebind": {
      // R6: open Keyboard shortcuts, start recording on the first
      // recorder, then press a claimed chord (Mod+J = Switch worktree)
      // so the save blocks on the standing-conflict error — nothing is
      // persisted, and the conflict copy is in the capture. Owned
      // fixture only; the reference side never presses chords.
      const opened =
        (await tryClick(page, "button", "Settings")) ||
        (await tryClick(page, "button", "Settings", 2500));
      if (!opened) {
        missing.push("no Settings affordance reachable");
        break;
      }
      if (!(await waitForAria(page, "textbox", "Search settings"))) {
        missing.push("Settings click acted but the settings marker never appeared");
        break;
      }
      notes.push("Settings opened (marker visible)");
      let done = await tryClick(page, "button", "Keyboard shortcuts", 1500);
      if (!done) {
        try {
          await page.getByRole("tab", { name: "Keyboard shortcuts" }).first().click({ timeout: 1500 });
          await delay(350);
          done = true;
        } catch {
          done = false;
        }
      }
      if (!done) {
        missing.push("no Keyboard shortcuts section reachable");
        break;
      }
      notes.push("Keyboard shortcuts pane opened");
      try {
        const recorder = page.getByRole("button", { name: /^Change shortcut for/ }).first();
        if ((await recorder.count()) === 0) {
          missing.push("no shortcut recorder button reachable");
          break;
        }
        await recorder.click({ timeout: 3000 });
        await delay(500);
        const hint = await page
          .getByText(/Press a shortcut|Press Escape to cancel/, { exact: false })
          .first()
          .count()
          .catch(() => 0);
        notes.push(hint > 0 ? "recording started (hint visible)" : "recorder clicked but no hint appeared");
        await page.keyboard.press(`${MOD}+J`);
        await delay(600);
        const alert = await page.getByRole("alert").count().catch(() => 0);
        notes.push(
          alert > 0
            ? "conflict error shown for the claimed chord (save blocked, nothing persisted)"
            : "no conflict alert after the claimed chord",
        );
      } catch {
        notes.push("rebind probe best-effort only");
      }
      break;
    }
    case "settings-appearance": {
      const opened =
        (await tryClick(page, "button", "Settings")) ||
        (await tryClick(page, "button", "Settings", 2500));
      if (opened) {
        await tryClick(page, "button", "Appearance", 1200).catch(() => {});
        await tryClick(page, "tab", "Appearance", 1200).catch(() => {});
        if (await waitForAria(page, "heading", "Appearance")) notes.push("Settings panel opened (marker visible)");
        else missing.push("Settings click acted but the Appearance marker never appeared");
      } else missing.push("no Settings affordance reachable");
      break;
    }
    case "settings-appearance-system": {
      const opened =
        (await tryClick(page, "button", "Settings")) ||
        (await tryClick(page, "button", "Settings", 2500));
      if (!opened) {
        missing.push("no Settings affordance reachable");
        break;
      }
      await tryClick(page, "button", "Appearance", 1200).catch(() => {});
      await tryClick(page, "tab", "Appearance", 1200).catch(() => {});
      if (!(await waitForAria(page, "heading", "Appearance"))) {
        missing.push("Appearance marker never appeared");
        break;
      }
      const system = page.getByRole("radio", { name: "System", exact: true }).first();
      if ((await system.count()) === 0) {
        missing.push("candidate Theme/System control unavailable");
      } else {
        const checked = await system.getAttribute("aria-checked").catch(() => null);
        if (checked !== "true") {
          await system.click({ timeout: 2500 });
          await delay(500);
        }
        notes.push(`candidate Theme=System (checked=${await system.getAttribute("aria-checked").catch(() => "unknown")})`);
      }
      notes.push(`candidate media dark=${await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches).catch(() => false)}`);
      break;
    }
    case "shortcuts-status-rail": {
      const opened =
        (await tryClick(page, "button", "Settings")) ||
        (await tryClick(page, "button", "Settings", 2500));
      if (!opened) {
        missing.push("no Settings affordance reachable");
        break;
      }
      if (!(await waitForAria(page, "textbox", "Search settings"))) {
        missing.push("Settings click acted but the settings marker never appeared");
        break;
      }
      let done = await tryClick(page, "button", "Keyboard shortcuts", 1500);
      if (!done) {
        try {
          await page.getByRole("tab", { name: "Keyboard shortcuts" }).first().click({ timeout: 1500 });
          await delay(350);
          done = true;
        } catch {
          done = false;
        }
      }
      if (!done) {
        missing.push("no Keyboard shortcuts section reachable");
        break;
      }
      const rail = page.getByRole("navigation", { name: "Shortcut status filters" }).first();
      if ((await rail.count()) === 0) {
        missing.push("Shortcut status filter rail missing");
        break;
      }
      notes.push("Shortcuts status rail opened");
      const modified = page.getByRole("button", { name: /^Modified\b/ }).first();
      if ((await modified.count()) > 0) {
        await modified.click({ timeout: 2500 });
        await delay(350);
        notes.push("Modified status filter selected");
      } else missing.push("Modified status filter unavailable");
      break;
    }
    case "changes": {
      if (await ensureProject()) {
        try {
          await execFileAsync("git", ["init"], { cwd: ctx.workspace }).catch(() => {});
          await writeFile(path.join(ctx.workspace, "notes.txt"), "fidelity fixture\n");
          await execFileAsync("git", ["add", "-A"], { cwd: ctx.workspace }).catch(() => {});
          await writeFile(path.join(ctx.workspace, "notes.txt"), "fidelity fixture modified\n");
          notes.push("git fixture: one modified tracked file");
        } catch {
          notes.push("git fixture best-effort only");
        }
        // R6-B: Changes lives in the right activity bar ("Source Control"
        // button; the accessible name carries the ⌘⇧G chord suffix, so the
        // match is non-exact).
        try {
          await page
            .getByRole("button", { name: "Source Control" })
            .first()
            .click({ timeout: 3000 });
          await delay(350);
          notes.push("Changes opened through the right activity bar");
        } catch {
          missing.push("Source Control activity button unavailable (capability or fixture)");
          notes.push("captured terminal view instead");
        }
      }
      break;
    }
    case "automations":
      await ensureProject().catch(() => {});
      if (await tryClick(page, "button", "Automations")) {
        if (await waitForAria(page, "heading", "Automations")) notes.push("Automations nav opened (marker visible)");
        else missing.push("Automations click acted but the page marker never appeared");
      } else missing.push("no Automations nav reachable");
      break;
    case "automation-editor-cron-preview": {
      // R8 owned fixture: create a disabled yearly automation through the CLI
      // (no scheduler/model work), then open its editor so the shared preview
      // renders the next yearly fires.
      await ensureProject().catch(() => {});
      const workspaceId = await workspaceIdForFixture();
      const cliBin = path.join(root, "target", "debug", process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli");
      if (!workspaceId || !ctx.dataDir) {
        missing.push("workspace id unavailable for automation fixture");
        break;
      }
      try {
        const created = await execFileAsync(cliBin, [
          "--data-dir", ctx.dataDir, "--json", "automation", "create",
          "--name", "Yearly QA fixture", "--cron", "0 0 1 1 *",
          "--workspace", workspaceId, "--harness", "pi",
          "--prompt", "Deterministic yearly QA fixture.", "--disabled",
        ]);
        const payload = JSON.parse(created.stdout);
        ctx.automationFixtureId = payload.result?.id ?? payload.id ?? null;
        notes.push("fixture: disabled yearly automation created through drogon-cli");
      } catch (error) {
        missing.push(`yearly automation fixture failed: ${error.message.split("\\n")[0]}`);
        break;
      }
      if (!(await tryClick(page, "button", "Automations"))) {
        missing.push("no Automations nav reachable");
        break;
      }
      if (!(await waitForAria(page, "heading", "Automations"))) {
        missing.push("Automations page marker never appeared");
        break;
      }
      try {
        const row = page.getByTestId(`automation-row-${ctx.automationFixtureId}`).first();
        await row.waitFor({ timeout: 15000 });
        const actions = row.getByRole("button", { name: "Automation actions for Yearly QA fixture", exact: true });
        if ((await actions.count()) > 0) {
          await actions.click({ timeout: 3000 });
          await delay(350);
          const edit = page.getByRole("menuitem", { name: "Edit", exact: true }).first();
          if ((await edit.count()) > 0) await edit.click({ timeout: 3000 });
        }
        await page.getByRole("dialog").waitFor({ timeout: 8000 });
      } catch {
        // Keep a deterministic fallback: open a blank editor and type only in
        // the owned candidate, while retaining the CLI fixture evidence.
        await tryClick(page, "button", "New Automation", 3000);
        await page.getByRole("dialog").waitFor({ timeout: 8000 }).catch(() => {});
        const cadence = page.getByRole("combobox", { name: "Cadence", exact: true }).first();
        if ((await cadence.count()) > 0) await cadence.selectOption("custom");
        const cron = page.locator('input[placeholder="0 9 * * 1-5"]').first();
        if ((await cron.count()) > 0) await cron.fill("0 0 1 1 *");
      }
      const preview = page.getByTestId("automations-preview").first();
      if ((await preview.count()) > 0) notes.push(`yearly cron preview: ${(await preview.innerText()).replace(/\\s+/g, " ").slice(0, 240)}`);
      else missing.push("automation editor preview unavailable");
      break;
    }
    case "browser":
      await ensureProject().catch(() => {});
      // R6-B: Browser is a tab, opened from the strip "+" static create
      // menu ("New tab" trigger, "New Browser Tab" entry).
      if (await tryClick(page, "button", "New tab")) {
        await delay(600);
        try {
          const entry = page.getByRole("menuitem", { name: /^New Browser Tab/ });
          if ((await entry.count()) > 0) {
            await entry.first().click({ timeout: 3000 });
            notes.push("browser tab opened through the + create menu");
            await delay(800);
          } else notes.push("no New Browser Tab menu entry; captured as-is");
        } catch {
          notes.push("create-menu selection best-effort only");
        }
        await dismissOverlays(page);
        try {
          const addr = page.getByPlaceholder(/address|url|search/i);
          if ((await addr.count()) > 0) {
            await addr.first().fill(`file://${path.join(ctx.workspace, "notes.txt")}`);
            await page.keyboard.press("Enter");
            await delay(1200);
            notes.push("local file navigated in pane");
          } else notes.push("no address field; captured pane as-is");
        } catch {
          notes.push("address navigation best-effort only");
        }
      } else missing.push("no New tab affordance reachable");
      break;
    case "tasks":
      await ensureProject().catch(() => {});
      if (await tryClick(page, "button", "Tasks")) {
        const marker =
          (await page.getByRole("button", { name: "Close tasks", exact: true }).count().catch(() => 0)) > 0 ||
          (await page.getByPlaceholder(/Search GitHub (issues|PRs)/).count().catch(() => 0)) > 0;
        if (marker) notes.push("Tasks nav opened (marker visible)");
        else missing.push("Tasks click acted but the page marker never appeared");
      } else missing.push("no Tasks nav reachable");
      break;
    case "tasks-rows":
      await setupTasksRowsFixture(page, ctx, notes, missing);
      break;
    case "tasks-filters": {
      // R6: PR-mode chrome over the same deterministic fixture (Mine
      // preset, Reviewers/Checks/Merge cells, New-issue affordance).
      // Issues-mode chrome stays covered by tasks-rows.
      if (!ctx.tasksFixtureReady) {
        if (!(await setupTasksRowsFixture(page, ctx, notes, missing))) break;
      } else {
        notes.push("fixture: tasks-repo already registered (shared with tasks-rows)");
        if (await tryClick(page, "button", "Tasks")) notes.push("Tasks nav opened");
      }
      let prsOpen = false;
      for (let i = 0; i < 3 && !prsOpen; i++) {
        try {
          await page
            .getByPlaceholder("Search GitHub PRs...")
            .first()
            .waitFor({ timeout: 8000 });
          prsOpen = true;
        } catch {
          await tryClick(page, "button", "PRs");
        }
      }
      if (!prsOpen) {
        if (await tryClick(page, "button", "PRs", 3000)) {
          await delay(1200);
          try {
            await page
              .getByPlaceholder("Search GitHub PRs...")
              .first()
              .waitFor({ timeout: 8000 });
            prsOpen = true;
          } catch {
            missing.push("PRs mode chrome never appeared");
          }
        } else missing.push("no PRs mode tab reachable");
      }
      if (prsOpen) {
        notes.push("PRs mode opened (fixture pulls)");
        try {
          const pager = await page.getByRole("navigation", { name: "Pagination" }).count();
          notes.push(pager > 0 ? "pagination strip rendered in PRs mode" : "pagination strip absent in PRs mode (single page)");
        } catch {
          notes.push("pagination probe best-effort only");
        }
      }
      break;
    }
    case "bots":
      await ensureProject().catch(() => {});
      if (await tryClick(page, "button", "Bots")) {
        if (await waitForAria(page, "heading", "Bots")) notes.push("Bots route opened (marker visible)");
        else missing.push("Bots click acted but the page marker never appeared");
      } else missing.push("no Bots nav reachable");
      break;
    case "bots-empty-and-list": {
      await ensureProject().catch(() => {});
      // Earlier Round 8 states may leave the git fixture selected. Bots are
      // scoped to the active workspace, so select the stable folder fixture
      // before creating the bot rather than creating it in a hidden scope.
      try {
        const fixtureName = path.basename(ctx.workspace);
        const select = page.getByRole("button", { name: new RegExp(`^Select ${fixtureName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`) }).first();
        await select.waitFor({ state: "visible", timeout: 6000 });
        await select.click({ timeout: 3000 });
        await delay(600);
        notes.push(`fixture workspace selected: ${fixtureName}`);
      } catch {
        notes.push("fixture workspace selection best-effort only");
      }
      if (!(await tryClick(page, "button", "Bots"))) {
        missing.push("no Bots nav reachable");
        break;
      }
      if (!(await waitForAria(page, "heading", "Bots"))) {
        missing.push("Bots page marker never appeared");
        break;
      }
      try {
        await page.getByText("No Bots yet", { exact: true }).waitFor({ timeout: 12000 });
        notes.push("candidate empty Bots state observed before fixture create");
      } catch {
        notes.push("candidate empty Bots state was not visible before fixture create");
      }
      const workspaceId = await workspaceIdForFixture();
      const cliBin = path.join(root, "target", "debug", process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli");
      if (!workspaceId || !ctx.dataDir) {
        missing.push("workspace id unavailable for bot fixture");
        break;
      }
      try {
        const statusOut = await execFileAsync(cliBin, ["--data-dir", ctx.dataDir, "--json", "status"]);
        const status = JSON.parse(statusOut.stdout);
        const hostId = status.result?.hostId ?? status.result?.status?.hostId ?? status.status?.hostId ?? status.hostId;
        if (!hostId) throw new Error("status response did not include hostId");
        const body = {
          workspaceId,
          hostId,
          locale: "en",
          body: {
            characterPreset: "arya",
            displayIdentity: { displayName: "Fidelity Bot", handle: null, title: "QA fixture" },
            harnessPolicy: { defaultHarness: "claude", explicitModel: null },
            instructions: "Deterministic fidelity bot fixture.",
            memories: [],
          },
        };
        await execFileAsync(cliBin, [
          "--data-dir", ctx.dataDir, "--json", "rpc", "bot.create", "--params", JSON.stringify(body),
        ]);
        notes.push("fixture: one bot created through drogon-cli (no run/inference)");
      } catch (error) {
        missing.push(`bot fixture failed: ${error.message.split("\\n")[0]}`);
        break;
      }
      const refresh = page.getByRole("button", { name: "Refresh Bots", exact: true }).first();
      if ((await refresh.count()) > 0) {
        await refresh.click({ timeout: 3000 });
        await delay(900);
      } else {
        await page.reload();
        await emulatePageFocus(page).catch(() => {});
        await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor({ timeout: 25000 }).catch(() => {});
        await tryClick(page, "button", "Bots");
      }
      const waitForBotList = async () => {
        await page.getByRole("list", { name: "Bots", exact: true }).waitFor({ timeout: 12000 });
        await page.getByText("Fidelity Bot", { exact: true }).waitFor({ timeout: 12000 });
      };
      try {
        await waitForBotList();
        notes.push("candidate Bots list rendered one fixture bot");
      } catch {
        // A refresh button can retain the route while the page model misses
        // the mutation event; reload the owned candidate once before calling
        // this a parity failure.
        try {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
          await emulatePageFocus(page).catch(() => {});
          await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor({ timeout: 25000 });
          await tryClick(page, "button", "Bots", 3000);
          await waitForBotList();
          notes.push("candidate Bots list rendered one fixture bot after reload");
        } catch {
          missing.push("candidate Bots list did not render the fixture bot");
        }
      }
      break;
    }
    case "explorer": {
      await ensureProject().catch(() => {});
      // Own temp fixture: one file so the tree is never empty. The reference
      // side is never touched.
      try {
        await writeFile(path.join(ctx.workspace, "notes.txt"), "explorer fixture\n");
        notes.push("fixture: notes.txt written");
      } catch {
        notes.push("fixture write best-effort only");
      }
      const open = await page.getByRole("textbox", { name: "Find files" }).count().catch(() => 0);
      if (open > 0) notes.push("Explorer panel already open; captured as-is");
      else {
        try {
          await page.getByRole("button", { name: "Explorer" }).first().click({ timeout: 3000 });
          await delay(350);
          notes.push("Explorer opened through the right activity bar");
        } catch {
          missing.push("Explorer activity button unavailable");
        }
      }
      break;
    }
    case "source-control": {
      // Clean worktree: the panel should render its committed-empty
      // state. The reference side is never touched.
      const scope = await ensureGitProject("source-control");
      if (!scope) break;
      try {
        await execFileAsync("git", ["checkout", "-q", "--", "notes.txt"], { cwd: scope }).catch(() => {});
        await rm(path.join(scope, "scratch.txt"), { force: true });
        notes.push("fixture: sc-wt restored clean");
      } catch {
        notes.push("clean restore best-effort only");
      }
      await openSourceControl();
      break;
    }
    case "source-control-no-remote": {
      const scope = await ensureGitProject("source-control-no-remote");
      if (!scope) break;
      try {
        await execFileAsync("git", ["checkout", "-q", "--", "notes.txt"], { cwd: scope }).catch(() => {});
        await rm(path.join(scope, "scratch.txt"), { force: true });
        await execFileAsync("git", ["remote", "remove", "origin"], { cwd: scope }).catch(() => {});
        await execFileAsync("git", ["remote", "remove", "upstream"], { cwd: scope }).catch(() => {});
        const remotes = (await execFileAsync("git", ["remote"], { cwd: scope })).stdout.trim();
        notes.push(remotes ? `fixture remotes unexpectedly present: ${remotes}` : "fixture: sc-wt has no git remotes");
      } catch (error) {
        missing.push(`no-remote fixture failed: ${error.message.split("\n")[0]}`);
        break;
      }
      if (!(await reloadCandidate("no-remote"))) break;
      try {
        const select = page.getByRole("button", { name: /^Select sc-wt/ }).first();
        await select.waitFor({ timeout: 15000 });
        await select.click({ timeout: 3000 });
        await delay(500);
        notes.push("sc-wt reselected after no-remote reload");
      } catch {
        notes.push("sc-wt reselect best-effort only");
      }
      await openSourceControl();
      try {
        await page.getByRole("region", { name: "Changes" }).getByText("No remote").waitFor({ timeout: 15000 });
        notes.push("Source Control rendered No remote copy");
      } catch {
        missing.push("Source Control did not render No remote copy");
      }
      break;
    }
    case "source-control-dirty": {
      // One modified tracked file plus one untracked file in sc-wt, so
      // the Unstaged/Untracked sections render. Staging is untouched
      // (R16-R2 owns stage behavior). The reference side is never
      // touched.
      const scope = await ensureGitProject("source-control-dirty");
      if (!scope) break;
      try {
        await writeFile(path.join(scope, "notes.txt"), "sc fixture modified\n");
        await writeFile(path.join(scope, "scratch.txt"), "untracked\n");
        notes.push("fixture: sc-wt dirty (modified tracked + untracked)");
      } catch (error) {
        missing.push(`dirty fixture failed: ${error.message.split("\n")[0]}`);
        break;
      }
      // The panel snapshots status on mount (manual refresh otherwise),
      // so reload onto the dirty tree before opening it.
      if (!(await reloadCandidate("dirty"))) break;
      try {
        const select = page.getByRole("button", { name: /^Select sc-wt/ }).first();
        await select.waitFor({ timeout: 15000 });
        await select.click({ timeout: 3000 });
        await delay(500);
        notes.push("sc-wt reselected after dirty reload");
      } catch {
        notes.push("sc-wt reselect best-effort only");
      }
      await openSourceControl();
      try {
        await page
          .getByRole("region", { name: "Changes" })
          .getByText("scratch.txt")
          .first()
          .waitFor({ timeout: 20000 });
        notes.push("dirty rows rendered (scratch.txt visible)");
      } catch {
        missing.push("dirty rows did not render within 20s");
      }
      break;
    }
    case "create-menu": {
      // The strip "+" opens the static create menu (New Terminal /
      // New Browser Tab entries); selecting nothing, capturing the menu open.
      const terminal = await ensureTerminal().catch(() => false);
      if (!terminal) {
        missing.push("project-terminal fixture unavailable for create menu");
        break;
      }
      if (await tryClick(page, "button", "New tab")) {
        await delay(600);
        const seen = await overlayState(page);
        if ((seen.menus || 0) > 0) {
          notes.push(`create menu open (dialogs=${seen.dialogs} menus=${seen.menus} palettes=${seen.palettes})`);
          const items = await menuItemNames(page);
          if (items.length) notes.push(`create menu items: ${items.join(" | ")}`);
        } else missing.push("New tab click opened no menu");
      } else missing.push("no New tab affordance reachable");
      break;
    }
    case "sidebar-menus": {
      // Same menu walk as the reference, on the owned fixture (a project
      // always exists here). The Project actions menu stays open for capture.
      await ensureProject().catch(() => {});
      try {
        const card = page.locator('[class*="worktree-card"], .shell-project-row, [class*="project-row"]').first();
        if ((await card.count()) > 0) {
          await card.click({ button: "right", timeout: 3000 });
          await delay(600);
          const seen = await overlayState(page);
          notes.push(seen.menus > 0 ? `worktree context menu open (menus=${seen.menus})` : "worktree right-click opened no menu");
          const items = await menuItemNames(page);
          if (items.length) notes.push(`worktree context menu items: ${items.join(" | ")}`);
        } else notes.push("no worktree/project row to right-click");
      } catch {
        notes.push("worktree right-click best-effort only");
      }
      await dismissOverlays(page);
      let optionsOk = false;
      try {
        const trigger = page.getByRole("button", { name: "Workspace options" }).first();
        if ((await trigger.count()) > 0) {
          await trigger.click({ timeout: 3000 });
          await delay(600);
          const seen = await overlayState(page);
          optionsOk = (seen.menus || 0) > 0;
          notes.push(optionsOk ? `Workspace options open (menus=${seen.menus})` : "Workspace options click opened no menu");
          const items = await menuItemNames(page);
          if (items.length) notes.push(`Workspace options items: ${items.join(" | ")}`);
        } else notes.push("no Workspace options button reachable");
      } catch {
        notes.push("Workspace options best-effort only");
      }
      await dismissOverlays(page);
      let actionsOpen = false;
      try {
        const trigger = page.getByRole("button", { name: "Project actions for" }).first();
        if ((await trigger.count()) > 0) {
          await trigger.click({ timeout: 3000 });
          await delay(600);
          const seen = await overlayState(page);
          actionsOpen = (seen.menus || 0) > 0;
          notes.push(actionsOpen ? `Project actions menu open (menus=${seen.menus})` : "Project actions click opened no menu");
          const items = await menuItemNames(page);
          if (items.length) notes.push(`Project actions items: ${items.join(" | ")}`);
          if (!actionsOpen) await dismissOverlays(page);
        } else notes.push("no Project actions trigger reachable");
      } catch {
        notes.push("Project actions best-effort only");
      }
      if (!actionsOpen && optionsOk) {
        try {
          await page.getByRole("button", { name: "Workspace options" }).first().click({ timeout: 3000 });
          await delay(600);
          notes.push("capture fallback: Workspace options left open");
          actionsOpen = true;
        } catch {
          notes.push("capture fallback reopen failed");
        }
      }
      if (!actionsOpen) missing.push("no sidebar menu left open for capture");
      break;
    }
    case "tab-menus": {
      // Create menu first (noted, dismissed), then the tab context menu via
      // right-click, left open for capture.
      const terminal = await ensureTerminal().catch(() => false);
      if (!terminal) {
        missing.push("project-terminal fixture unavailable for tab menus");
        break;
      }
      if (await tryClick(page, "button", "New tab")) {
        const seen = await overlayState(page);
        notes.push(seen.menus > 0 ? `create menu open (menus=${seen.menus})` : "New tab click opened no menu");
        const items = await menuItemNames(page);
        if (items.length) notes.push(`create menu items: ${items.join(" | ")}`);
      } else notes.push("no New tab affordance reachable");
      await dismissOverlays(page);
      try {
        const tab = page.getByRole("tab").first();
        if ((await tab.count()) > 0) {
          await tab.click({ button: "right", timeout: 3000 });
          await delay(600);
          const seen = await overlayState(page);
          if ((seen.menus || 0) > 0) {
            notes.push(`tab context menu open (menus=${seen.menus})`);
            const items = await menuItemNames(page);
            if (items.length) notes.push(`tab context menu items: ${items.join(" | ")}`);
          } else missing.push("tab right-click opened no menu");
        } else missing.push("no tab to right-click");
      } catch {
        missing.push("tab right-click best-effort only");
      }
      break;
    }
    case "right-rail": {
      // Same activity-bar cycle as the reference, on the owned fixture (one
      // file so Explorer is never empty); ends on Ports for capture.
      await ensureProject().catch(() => {});
      try {
        await writeFile(path.join(ctx.workspace, "notes.txt"), "right-rail fixture\n");
        notes.push("fixture: notes.txt written");
      } catch {
        notes.push("fixture write best-effort only");
      }
      for (const name of ["Explorer", "Mentu", "Source Control"]) {
        try {
          const trigger = page.getByRole("button", { name }).first();
          if ((await trigger.count()) > 0) {
            await trigger.click({ timeout: 3000 });
            await delay(350);
            notes.push(`${name} panel opened`);
          } else notes.push(`no ${name} activity button reachable`);
        } catch {
          notes.push(`${name} best-effort only`);
        }
      }
      try {
        const row = page.locator('[role="treeitem"]').first();
        if ((await row.count()) > 0) {
          await row.click({ button: "right", timeout: 3000 });
          await delay(600);
          const seen = await overlayState(page);
          notes.push(seen.menus > 0 ? `Explorer row menu open (menus=${seen.menus})` : "Explorer row right-click opened no menu");
        } else notes.push("no Explorer row to right-click");
      } catch {
        notes.push("Explorer row menu best-effort only");
      }
      await dismissOverlays(page);
      try {
        const trigger = page.getByRole("button", { name: "Ports" }).first();
        if ((await trigger.count()) > 0) {
          await trigger.click({ timeout: 3000 });
          await delay(350);
          notes.push("Ports panel opened for capture");
        } else missing.push("no Ports activity button reachable");
      } catch {
        missing.push("Ports best-effort only");
      }
      break;
    }
    case "dialogs": {
      // Same two-dialog walk as the reference, on the owned fixture. Both
      // dialogs are Cancel-dismissed (teardown Escape); the Remove-project
      // dialog stays open for capture. Nothing is confirmed.
      await ensureProject().catch(() => {});
      await ensureTerminal().catch(() => {});
      try {
        const card = page.locator('[class*="worktree-card"], .shell-project-row, [class*="project-row"]').first();
        if ((await card.count()) > 0) {
          await card.click({ button: "right", timeout: 3000 });
          await delay(600);
          const del = page.getByRole("menuitem", { name: "Delete Worktree" }).first();
          if ((await del.count()) > 0) {
            await del.click({ timeout: 3000 });
            await delay(600);
            const seen = await overlayState(page);
            notes.push(seen.dialogs > 0 ? `Delete-worktree dialog open (dialogs=${seen.dialogs})` : "Delete Worktree click opened no dialog");
          } else notes.push("no Delete Worktree menu entry reachable");
        } else notes.push("no worktree row to right-click");
      } catch {
        notes.push("Delete-worktree dialog best-effort only");
      }
      await dismissOverlays(page);
      let dialogOpen = false;
      try {
        const trigger = page.getByRole("button", { name: "Project actions for" }).first();
        if ((await trigger.count()) > 0) {
          await trigger.click({ timeout: 3000 });
          await delay(600);
          const remove = page.getByRole("menuitem", { name: "Remove Project" }).first();
          if ((await remove.count()) > 0) {
            await remove.click({ timeout: 3000 });
            await delay(600);
            const seen = await overlayState(page);
            dialogOpen = (seen.dialogs || 0) > 0;
            notes.push(dialogOpen ? `Remove-project dialog open (dialogs=${seen.dialogs})` : "Remove Project click opened no dialog");
            if (!dialogOpen) await dismissOverlays(page);
          } else {
            notes.push("no Remove Project menu entry reachable");
            await dismissOverlays(page);
          }
        } else notes.push("no Project actions trigger reachable");
      } catch {
        notes.push("Remove-project dialog best-effort only");
      }
      if (!dialogOpen) {
        await dismissOverlays(page);
        missing.push("no dialog left open for capture");
      }
      break;
    }
    case "settings-general": {
      // Catalog `settings-general`: Settings → General (the fork default
      // view). The candidate now ships a General pane (R16-G); click it
      // and record when the nav entry is missing.
      const opened =
        (await tryClick(page, "button", "Settings")) ||
        (await tryClick(page, "button", "Settings", 2500));
      if (!opened) {
        missing.push("no Settings affordance reachable");
        break;
      }
      if (!(await waitForAria(page, "textbox", "Search settings"))) {
        missing.push("Settings click acted but the settings marker never appeared");
        break;
      }
      notes.push("Settings opened (marker visible)");
      let general = await tryClick(page, "button", "General", 1500);
      if (!general) {
        try {
          await page.getByRole("tab", { name: "General" }).first().click({ timeout: 1500 });
          await delay(350);
          general = true;
        } catch {
          general = false;
        }
      }
      if (general) notes.push("General pane opened");
      else missing.push("no General section (catalog settings-general)");
      break;
    }
    case "settings-terminal": {
      // R16-Q ships a Terminal section (Manage Sessions; typography rows
      // stay under Appearance per the merged R16-G decision).
      const opened =
        (await tryClick(page, "button", "Settings")) ||
        (await tryClick(page, "button", "Settings", 2500));
      if (!opened) {
        missing.push("no Settings affordance reachable");
        break;
      }
      if (!(await waitForAria(page, "textbox", "Search settings"))) {
        missing.push("Settings click acted but the settings marker never appeared");
        break;
      }
      notes.push("Settings opened (marker visible)");
      let terminal = await tryClick(page, "button", "Terminal", 1500);
      if (!terminal) {
        try {
          await page.getByRole("tab", { name: "Terminal" }).first().click({ timeout: 1500 });
          await delay(350);
          terminal = true;
        } catch {
          terminal = false;
        }
      }
      if (terminal) notes.push("Terminal pane opened");
      else missing.push("no Terminal section reachable");
      break;
    }
    case "settings-agents":
    case "settings-shortcuts":
    case "settings-notifications":
    case "settings-git": {
      // Candidate sections carry the honest MVP titles ("Agents",
      // "Keyboard shortcuts", "Git and GitHub"); the fork nav says
      // "Shortcuts" and "Git & Source Control".
      const pane =
        state === "settings-agents" ? "Agents"
        : state === "settings-shortcuts" ? "Keyboard shortcuts"
        : state === "settings-notifications" ? "Notifications"
        : "Git and GitHub";
      const opened =
        (await tryClick(page, "button", "Settings")) ||
        (await tryClick(page, "button", "Settings", 2500));
      if (!opened) {
        missing.push("no Settings affordance reachable");
        break;
      }
      if (!(await waitForAria(page, "textbox", "Search settings"))) {
        missing.push("Settings click acted but the settings marker never appeared");
        break;
      }
      notes.push("Settings opened (marker visible)");
      let done = await tryClick(page, "button", pane, 1500);
      if (!done) {
        try {
          await page.getByRole("tab", { name: pane }).first().click({ timeout: 1500 });
          await delay(350);
          done = true;
        } catch {
          done = false;
        }
      }
      if (done) notes.push(`${pane} pane opened`);
      else missing.push(`no ${pane} section reachable`);
      break;
    }
    case "terminal-find": {
      // Owned fixture terminal, first tab focused, Mod+F opens
      // TerminalSearch (role=search "Terminal search"), left open.
      const terminal = await ensureTerminal().catch(() => false);
      if (!terminal) {
        missing.push("project-terminal fixture unavailable for terminal find");
        break;
      }
      // The Mod+F chord is owned by the pane container keydown handler, so
      // focus must land inside the tabpanel (the tab button is not enough).
      try {
        await page.getByRole("tabpanel").first().click({ timeout: 3000 });
        await delay(350);
        notes.push("tabpanel focused for find");
      } catch {
        notes.push("tabpanel focus best-effort only");
      }
      await tryKeys(page, `${MOD}+F`);
      await delay(800);
      const bars = await page.locator('[role="search"]').count().catch(() => -1);
      if (bars > 0) notes.push(`TerminalSearch open (role=search count=${bars})`);
      else missing.push("Mod+F opened no TerminalSearch");
      break;
    }
    case "browser-find": {
      // Owned browser tab (same path as the browser state), guest focused,
      // Mod+F opens the find bar (role=search "Find in page"), left open.
      await ensureProject().catch(() => {});
      if (await tryClick(page, "button", "New tab")) {
        await delay(600);
        try {
          const entry = page.getByRole("menuitem", { name: /^New Browser Tab/ });
          if ((await entry.count()) > 0) {
            await entry.first().click({ timeout: 3000 });
            notes.push("browser tab opened through the + create menu");
            await delay(800);
          } else notes.push("no New Browser Tab menu entry; captured as-is");
        } catch {
          notes.push("create-menu selection best-effort only");
        }
        await dismissOverlays(page);
        // The browser chrome renders async after the tab opens (r3b caught
        // it mid-render); settle before focusing the guest.
        await delay(1500);
        // Mod+F is owned by the pane container keydown handler: focus must
        // land inside the tabpanel (the tab button is not enough).
        try {
          await page.getByRole("tabpanel").first().click({ timeout: 3000 });
          await delay(350);
          notes.push("tabpanel focused for find");
        } catch {
          notes.push("tabpanel focus best-effort only");
        }
        await tryKeys(page, `${MOD}+F`);
        await delay(800);
        let bars = await page.locator('[role="search"]').count().catch(() => -1);
        if (bars > 0) notes.push(`browser find bar open via Mod+F (role=search count=${bars})`);
        else {
          // Fallback user path: the ⋯ toolbar menu documents Mod+F on its
          // "Find in page" row; open the bar through it instead.
          notes.push("Mod+F opened no browser find bar; trying toolbar menu path");
          try {
            const trigger = page.getByRole("button", { name: "Browser menu" }).first();
            if ((await trigger.count()) > 0) {
              await trigger.click({ timeout: 3000 });
              await delay(600);
              const entry = page.getByRole("menuitem", { name: "Find in page" }).first();
              if ((await entry.count()) > 0) {
                await entry.click({ timeout: 3000 });
                await delay(800);
                notes.push("Find in page chosen from toolbar menu");
              } else notes.push("no Find in page menu entry");
              // No dismissOverlays here: the menu closes itself and Escape
              // would shut the freshly opened find bar (panel-level close).
            } else notes.push("no Browser menu trigger reachable");
          } catch {
            notes.push("toolbar menu path best-effort only");
          }
          bars = await page.locator('[role="search"]').count().catch(() => -1);
          if (bars > 0) notes.push(`browser find bar open (role=search count=${bars})`);
          else missing.push("Mod+F nor toolbar menu opened the browser find bar");
        }
        // Page context menu via guest right-click (bridge onContextMenu on a
        // live page, DOM placeholder handler on blank/error states); Escape
        // closes it, find bar left open for capture.
        try {
          await page.getByRole("tabpanel").first().click({ button: "right", timeout: 3000 });
          await delay(600);
          const seen = await overlayState(page);
          notes.push(seen.menus > 0 ? `page context menu open (menus=${seen.menus})` : "guest right-click opened no menu");
        } catch {
          notes.push("guest right-click best-effort only");
        }
        try {
          await page.keyboard.press("Escape");
          await delay(400);
          const seen = await overlayState(page);
          notes.push(seen.menus === 0 ? "Escape closed the context menu" : "Escape left a menu open");
        } catch {
          notes.push("Escape check best-effort only");
        }
      } else missing.push("no New tab affordance reachable");
      break;
    }
    case "mentu": {
      // Owned fixture; the Mentu panel (recipe empty state) ends open.
      await ensureProject().catch(() => {});
      try {
        const trigger = page.getByRole("button", { name: "Mentu" }).first();
        if ((await trigger.count()) > 0) {
          await trigger.click({ timeout: 3000 });
          await delay(350);
          notes.push("Mentu panel opened");
        } else notes.push("no Mentu activity button reachable");
      } catch {
        notes.push("Mentu best-effort only");
      }
      break;
    }
    case "workspace-composer": {
      // Open the owned composer only. The fixture is intentionally not
      // submitted, so this state cannot create a workspace or session.
      let opened = await tryClick(page, "button", "Create workspace", 3000);
      if (!opened) opened = await tryClick(page, "button", "New workspace", 3000);
      if (opened) {
        await delay(500);
        notes.push("workspace composer opened without submitting");
        const advanced = page.getByRole("button", { name: "Advanced", exact: true }).first();
        if ((await advanced.count()) > 0) {
          await advanced.click({ timeout: 3000 });
          await delay(300);
          notes.push("Advanced section expanded");
        }
      } else missing.push("no Create workspace/New workspace affordance reachable");
      break;
    }
    case "session-details-panel": {
      await ensureProject().catch(() => {});
      await ensureTerminal().catch(() => {});
      try {
        const trigger = page.getByRole("button", { name: "Session details" }).first();
        if ((await trigger.count()) > 0) {
          await trigger.click({ timeout: 3000 });
          await delay(350);
          notes.push("Session details panel opened");
        } else missing.push("no Session details activity button reachable");
      } catch {
        missing.push("Session details best-effort only");
      }
      break;
    }
    case "ports-listening": {
      await ensureProject().catch(() => {});
      await selectFixtureWorkspace();
      try {
        await writeFile(path.join(ctx.workspace, "ports-fixture.txt"), "ports fixture\\n");
      } catch {
        /* the panel itself remains useful when the file watch is delayed */
      }
      // Start a deterministic local listener outside the app UI. This is an
      // owned fixture and is closed in candTeardown after the capture.
      try {
        const server = createServer((_request, response) => {
          response.writeHead(200, { "content-type": "text/plain" });
          response.end("Drogon fidelity port fixture\n");
        });
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(4173, "127.0.0.1", resolve);
        });
        ctx.portFixture = {
          server,
          async close() {
            server.closeAllConnections?.();
            await Promise.race([
              new Promise((resolve) => server.close(() => resolve())),
              delay(1500),
            ]);
          },
        };
        notes.push("fixture: listening server bound to 127.0.0.1:4173");
      } catch (error) {
        missing.push(`listening server fixture failed: ${error.message.split("\\n")[0]}`);
      }
      // Match the proven right-rail walk: the activity buttons are mounted
      // after the active workspace has a watched file, then Ports is left
      // open for the capture.
      for (const name of ["Explorer", "Mentu", "Source Control"]) {
        await clickActivity(name);
        await delay(180);
      }
      if (await clickActivity("Ports")) {
        await delay(900);
        notes.push("Ports panel opened");
      } else missing.push("no Ports activity button reachable");
      break;
    }
    case "explorer-selected-file": {
      await ensureProject().catch(() => {});
      await selectFixtureWorkspace();
      try {
        await mkdir(path.join(ctx.workspace, "src", "fixture"), { recursive: true });
        await writeFile(path.join(ctx.workspace, "src", "fixture", "selected.ts"), "export const fixture = true;\\n");
        await writeFile(path.join(ctx.workspace, "README.md"), "explorer fixture\\n");
        notes.push("fixture: nested Explorer tree files written");
      } catch {
        missing.push("Explorer nested-tree fixture write failed");
      }
      // The right rail is mounted after a watched workspace file exists.
      await writeFile(path.join(ctx.workspace, "explorer-fixture.txt"), "explorer fixture\\n").catch(() => {});
      if (!(await clickActivity("Explorer"))) {
        // Re-select Sessions once before declaring the activity rail absent;
        // this is view navigation, not a mutation.
        await tryClick(page, "button", "Sessions", 1500).catch(() => false);
        await delay(350);
      }
      if (!(await clickActivity("Explorer"))) {
        missing.push("no Explorer activity button reachable");
        break;
      }
      await delay(700);
      const find = page.getByRole("textbox", { name: "Find files" }).first();
      if ((await find.count()) === 0) missing.push("Explorer tree did not expose Find files");
      for (const directory of ["src", "fixture"]) {
        const folder = page.getByRole("button", { name: directory, exact: true }).first();
        if ((await folder.count()) > 0) {
          await folder.click({ timeout: 3000 });
          await delay(500);
        }
      }
      const row = page.getByRole("button", { name: "selected.ts", exact: true }).first();
      try {
        await row.waitFor({ timeout: 8000 });
        await row.click({ timeout: 3000 });
        await delay(500);
        notes.push("selected.ts row selected (no editor open)");
      } catch {
        missing.push("no selected.ts row in Explorer tree");
      }
      break;
    }
    case "editor-dirty-close": {
      await ensureProject().catch(() => {});
      await selectFixtureWorkspace();
      try {
        await writeFile(path.join(ctx.workspace, "dirty-fixture.txt"), "dirty editor fixture\\n");
        notes.push("fixture: dirty-fixture.txt written");
      } catch {
        missing.push("dirty editor fixture write failed");
      }
      if (!(await clickActivity("Explorer"))) {
        await tryClick(page, "button", "Sessions", 1500).catch(() => false);
        await delay(350);
      }
      if (!(await clickActivity("Explorer"))) {
        missing.push("Explorer activity button unavailable");
        break;
      }
      await delay(700);
      const row = page.getByRole("button", { name: "dirty-fixture.txt", exact: true }).first();
      if ((await row.count()) === 0) {
        missing.push("no dirty-fixture.txt Explorer row to open");
        break;
      }
      await row.click({ timeout: 3000 });
      await delay(800);
      const editor = page.locator(".monaco-editor").first();
      if ((await editor.count()) === 0) {
        missing.push("dirty-fixture.txt opened no editor");
        break;
      }
      try {
        await editor.click({ timeout: 5000 });
        await page.keyboard.type("x");
        await delay(600);
        const snap = await page.locator("body").ariaSnapshot({ timeout: 8000 }).catch(() => "");
        const markers = String(snap).split("\\n").filter((line) => /unsaved|dirty|Save|Discard/i.test(line)).slice(0, 8)
          .map((line) => line.trim().slice(0, 100));
        notes.push(markers.length ? `dirty markers: ${markers.join(" | ")}` : "dirty probe: no unsaved/dirty/Save marker in aria");
        // Leave the prompt/tab state for the screenshot; teardown reverts the
        // byte and dismisses any close prompt without confirming discard.
      } catch (error) {
        missing.push(`dirty editor probe failed: ${error.message.split("\\n")[0]}`);
      }
      break;
    }
    case "automation-run-detail": {
      await ensureProject().catch(() => {});
      if (!(await tryClick(page, "button", "Automations"))) {
        missing.push("no Automations nav reachable");
        break;
      }
      if (!(await waitForAria(page, "heading", "Automations"))) {
        missing.push("Automations page marker never appeared");
        break;
      }
      if (!(await tryClick(page, "button", "Runs", 2500))) {
        missing.push("no Runs button reachable on the Automations page");
        break;
      }
      await delay(800);
      let row = page.locator("table tbody tr button, [role='row'] button").first();
      if ((await row.count()) === 0) {
        // Use the same safe shell-backed automation fixture as the existing
        // automation-runs state, then re-open Runs for a retained row.
        const workspaceId = await page.evaluate(async () => {
          try {
            const r = await window.drogon.workspaces();
            return r.ok ? r.result.workspaces[0]?.id : null;
          } catch { return null; }
        }).catch(() => null);
        if (workspaceId && ctx.dataDir) {
          const cliBin = path.join(root, "target", "debug", process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli");
          try {
            const out = await execFileAsync(cliBin, [
              "--data-dir", ctx.dataDir, "--json", "automation", "create",
              "--workspace", workspaceId, "--name", "Fidelity run detail",
              "--harness", "pi", "--prompt", "Deterministic fidelity run fixture.",
              "--cron", "0 0 1 1 *",
            ]);
            ctx.automationDetailId = JSON.parse(out.stdout).result?.id ?? null;
            if (ctx.automationDetailId) {
              const dispatched = await execFileAsync(cliBin, [
                "--data-dir", ctx.dataDir, "--json", "automation", "run",
                "--id", ctx.automationDetailId,
              ]);
              const dispatchResult = JSON.parse(dispatched.stdout).result;
              notes.push(`automation dispatch outcome=${dispatchResult?.outcome ?? "unknown"}`);
              let historyReady = false;
              for (let attempt = 0; attempt < 20 && !historyReady; attempt += 1) {
                await delay(500);
                try {
                  const history = await execFileAsync(cliBin, [
                    "--data-dir", ctx.dataDir, "--json", "automation", "history",
                    "--id", ctx.automationDetailId, "--limit", "5",
                  ]);
                  historyReady = (JSON.parse(history.stdout).result?.runs?.length ?? JSON.parse(history.stdout).result?.length ?? 0) > 0;
                } catch {
                  /* the run ledger can become visible between polls */
                }
              }
              notes.push(historyReady ? "automation run history visible in fixture" : "automation run history not visible before capture");
            } else notes.push("fixture automation created without a readable id");
          } catch (error) {
            notes.push(`automation fixture create best-effort only: ${error.message.split("\\n")[0]}`);
          }
        }
        await delay(800);
        const refreshRuns = page.getByRole("button", { name: "Refresh runs", exact: true }).first();
        if ((await refreshRuns.count()) > 0) {
          await refreshRuns.click({ timeout: 3000 });
          await delay(1000);
        }
        row = page.getByRole("button", { name: /Fidelity run detail/ }).first();
        if ((await row.count()) === 0) {
          row = page.locator("table tbody tr button, [role='row'] button, [data-testid^='automation-run-'] button").first();
        }
      }
      if ((await row.count()) > 0) {
        await row.click({ timeout: 3000 });
        await delay(700);
        notes.push("automation run detail opened");
      } else missing.push("no automation run row to open");
      break;
    }
    case "bots-history": {
      await ensureProject().catch(() => {});
      const workspaceId = await workspaceIdForFixture();
      const cliBin = path.join(root, "target", "debug", process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli");
      if (!workspaceId || !ctx.dataDir) {
        missing.push("workspace id unavailable for Bots history fixture");
        break;
      }
      try {
        const statusOut = await execFileAsync(cliBin, ["--data-dir", ctx.dataDir, "--json", "status"]);
        const status = JSON.parse(statusOut.stdout);
        const hostId = status.result?.hostId ?? status.status?.hostId ?? status.hostId;
        if (!hostId) throw new Error("status response did not include hostId");
        const createBody = {
          workspaceId,
          hostId,
          locale: "en",
          body: {
            characterPreset: "arya",
            displayIdentity: { displayName: "Fidelity History Bot", handle: null, title: "QA history fixture" },
            harnessPolicy: { defaultHarness: "pi", explicitModel: null },
            instructions: "Deterministic Bot history fixture.",
            memories: [],
          },
        };
        const created = await execFileAsync(cliBin, [
          "--data-dir", ctx.dataDir, "--json", "rpc", "bot.create", "--params", JSON.stringify(createBody),
        ]);
        const bot = JSON.parse(created.stdout).result;
        const botId = bot?.id;
        if (!botId) throw new Error("bot.create response did not include id");
        const responsibility = await execFileAsync(cliBin, [
          "--data-dir", ctx.dataDir, "--json", "rpc", "bot.responsibility_create",
          "--params", JSON.stringify({
            workspaceId,
            hostId,
            botId,
            name: "Fidelity history responsibility",
            schedule: "0 0 1 1 *",
            prompt: "Print the deterministic fidelity history fixture and exit.",
          }),
        ]);
        const responsibilityId = JSON.parse(responsibility.stdout).result?.responsibilityId;
        if (!responsibilityId) throw new Error("responsibility_create response did not include id");
        const runOut = await execFileAsync(cliBin, [
          "--data-dir", ctx.dataDir, "--json",
          "--request-id", `fidelity-bot-run-${randomUUID()}`,
          "rpc", "bot.run",
          "--params", JSON.stringify({
            workspaceId,
            hostId,
            botId,
            responsibilityId,
            harness: { harnessId: "pi" },
            reason: "manual",
            eventIdentity: `fidelity-history-${randomUUID()}`,
          }),
        ]);
        const runResult = JSON.parse(runOut.stdout).result;
        if (runResult?.outcome && runResult.outcome !== "dispatched") {
          throw new Error(`bot.run outcome=${runResult.outcome} error=${runResult.error ?? "none"}`);
        }
        let historyReady = false;
        for (let attempt = 0; attempt < 20 && !historyReady; attempt += 1) {
          await delay(500);
          try {
            const snapshot = await execFileAsync(cliBin, [
              "--data-dir", ctx.dataDir, "--json", "rpc", "bot.snapshot",
              "--params", JSON.stringify({ workspaceId, hostId, locale: "en" }),
            ]);
            historyReady = (JSON.parse(snapshot.stdout).result?.history?.length ?? 0) > 0;
          } catch {
            /* the dispatch ledger can become visible between polls */
          }
        }
        ctx.historyBotId = botId;
        notes.push(historyReady
          ? "fixture Bot, scheduled responsibility, and manual history run created (fake pi; no model inference)"
          : "fixture Bot/run created; history ledger was not visible before capture");
      } catch (error) {
        missing.push(`Bots history fixture failed: ${error.message.split("\\n")[0]}`);
        break;
      }
      if (!(await tryClick(page, "button", "Bots", 2500))) {
        missing.push("no Bots nav reachable");
        break;
      }
      if (!(await waitForAria(page, "heading", "Bots"))) {
        missing.push("Bots page marker never appeared");
        break;
      }
      const refresh = page.getByRole("button", { name: "Refresh Bots", exact: true }).first();
      if ((await refresh.count()) > 0) {
        await refresh.click({ timeout: 3000 });
        await delay(1200);
      } else {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
        await emulatePageFocus(page).catch(() => {});
        await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor({ timeout: 25000 }).catch(() => {});
        await tryClick(page, "button", "Bots", 3000);
      }
      const history = page.getByText("Responsibility history", { exact: true }).first();
      if ((await history.count()) > 0) notes.push("responsibility history visible");
      else missing.push("Bot responsibility history did not render after refresh");
      break;
    }
    case "mentu-evidence": {
      await ensureProject().catch(() => {});
      await selectFixtureWorkspace();
      if (await clickActivity("Mentu")) {
        await delay(350);
        const evidence = page.getByRole("tab", { name: "Evidence", exact: true }).first();
        if ((await evidence.count()) > 0) {
          await evidence.click({ timeout: 3000 });
          await delay(400);
          notes.push("Mentu Evidence tab opened");
        } else missing.push("no Mentu Evidence tab reachable");
      } else missing.push("no Mentu activity button reachable");
      break;
    }
    case "session-details": {
      // Owned fixture with a live terminal so the panel has a session.
      await ensureProject().catch(() => {});
      await ensureTerminal().catch(() => {});
      try {
        const trigger = page.getByRole("button", { name: "Session details" }).first();
        if ((await trigger.count()) > 0) {
          await trigger.click({ timeout: 3000 });
          await delay(350);
          notes.push("Session details panel opened");
        } else missing.push("no Session details activity button reachable");
      } catch {
        missing.push("Session details best-effort only");
      }
      break;
    }
    case "automation-runs": {
      // Owned fixture: the Runs dashboard over automation.runs_all (no runs
      // exist in the fixture, so the empty dashboard is the honest capture).
      await ensureProject().catch(() => {});
      if (await tryClick(page, "button", "Automations")) {
        if (!(await waitForAria(page, "heading", "Automations"))) {
          missing.push("Automations page marker never appeared");
          break;
        }
        if (await tryClick(page, "button", "Runs", 2000)) {
          await delay(800);
          notes.push("Runs dashboard opened");
          const rows = await page.locator("table tbody tr").count().catch(() => -1);
          notes.push(rows > 0 ? `run rows present: ${rows}` : "no run rows in fixture (empty dashboard capture)");
        } else missing.push("no Runs button reachable on the Automations page");
      } else missing.push("no Automations nav reachable");
      break;
    }
    case "bot-responsibilities": {
      // Owned fixture: create one bot through the New Bot form, open its
      // detail, open the Add-responsibility form; the form stays for capture.
      // Everything created lives in the temp fixture.
      await ensureProject().catch(() => {});
      if (!(await tryClick(page, "button", "Bots"))) {
        missing.push("no Bots nav reachable");
        break;
      }
      if (!(await waitForAria(page, "heading", "Bots"))) {
        missing.push("Bots page marker never appeared");
        break;
      }
      try {
        if (await tryClick(page, "button", "New Bot", 2000)) {
          await page.getByLabel("Name (optional)").fill("Fidelity Bot").catch(() => {});
          await page.getByPlaceholder("What should this Bot help you with?").fill("Keep the fidelity fixtures honest.").catch(() => {});
          const create = page.getByRole("button", { name: "Create Bot", exact: true });
          if ((await create.count()) > 0) {
            await create.first().click({ timeout: 3000 });
            await delay(1200);
            notes.push("fixture bot created through the New Bot form");
          } else notes.push("no Create Bot submit; capturing list as-is");
        } else notes.push("no New Bot button; capturing list as-is");
        if (!(await waitForAria(page, "button", "Add responsibility", 3000))) {
          const row = page.getByRole("button", { name: /Fidelity Bot/ }).first();
          if ((await row.count()) > 0) {
            await row.click({ timeout: 3000 });
            await delay(800);
            notes.push("fixture bot detail opened");
          } else notes.push("no Fidelity Bot row to open");
        }
        if (await tryClick(page, "button", "Add responsibility", 2000)) {
          notes.push("Add-responsibility form opened for capture");
        } else notes.push("no Add responsibility button (list or detail captured as-is)");
      } catch (error) {
        notes.push(`bot fixture best-effort only: ${error.message.split("\n")[0]}`);
      }
      break;
    }
    case "toasts": {
      // Owned fixture: terminal context menu → Copy Terminal ID fires the
      // R13-C sonner toast (success, or the honest clipboard error). The
      // toast copy is recorded even when the PNG misses the 4s window.
      const terminal = await ensureTerminal().catch(() => false);
      if (!terminal) {
        missing.push("project-terminal fixture unavailable for toast trigger");
        break;
      }
      try {
        const panel = page.getByRole("tabpanel").first();
        await panel.click({ timeout: 3000 });
        await delay(350);
        await panel.click({ button: "right", timeout: 3000 });
        await delay(600);
        const items = await menuItemNames(page);
        if (items.length) notes.push(`terminal context menu items: ${items.join(" | ")}`);
        const copy = page.getByRole("menuitem", { name: /copy terminal id/i }).first();
        if ((await copy.count()) > 0) {
          await copy.click({ timeout: 3000 });
          await delay(900);
          const texts = await toastTexts(page);
          notes.push(texts.length ? `toast visible: ${texts.join(" | ")}` : "Copy Terminal ID acted but no toast appeared");
        } else {
          notes.push("no Copy Terminal ID menu entry");
          await dismissOverlays(page);
        }
      } catch (error) {
        notes.push(`toast trigger best-effort only: ${error.message.split("\n")[0]}`);
      }
      break;
    }
    case "editor-tab": {
      // R16-A: Explorer single-click opens the file as a main tab-group tab.
      // Owned notes.txt fixture. The dirty-dot/Save probe types one char,
      // records the markers, then undoes and saves so the file (and the
      // teardown tab-close) stays clean.
      await ensureProject().catch(() => {});
      try {
        await writeFile(path.join(ctx.workspace, "notes.txt"), "editor-tab fixture\n");
        notes.push("fixture: notes.txt written");
      } catch {
        notes.push("fixture write best-effort only");
      }
      const open = await page.getByRole("textbox", { name: "Find files" }).count().catch(() => 0);
      if (open > 0) notes.push("Explorer panel already open; captured as-is");
      else {
        try {
          await page.getByRole("button", { name: "Explorer" }).first().click({ timeout: 3000 });
          await delay(350);
          notes.push("Explorer opened through the right activity bar");
        } catch {
          missing.push("Explorer activity button unavailable");
          break;
        }
      }
      try {
        // The tree populates over the files watch: wait for the row instead
        // of racing it (r4 smoke caught the click firing before the row).
        const row = page.getByRole("button", { name: "notes.txt", exact: true }).first();
        try {
          await row.waitFor({ timeout: 8000 });
          await row.click({ timeout: 3000 });
          await delay(900);
          notes.push("notes.txt row clicked");
        } catch {
          missing.push("no notes.txt Explorer row to open");
          break;
        }
        const tab = page.getByRole("tab", { name: /notes/ }).first();
        if ((await tab.count()) > 0) notes.push("editor tab for notes.txt present in the strip");
        else missing.push("row click opened no editor tab in the strip");
        // Dirty-dot + Save probe (candidate fixture only; reverted below).
        try {
          await page.locator(".monaco-editor").first().click({ timeout: 5000 });
          await delay(300);
          await page.keyboard.type("x");
          await delay(800);
          const probe = await page.evaluate(() => ({
            tabs: [...document.querySelectorAll('[role="tab"]')].map((e) =>
              ((e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80))),
          })).catch(() => null);
          if (probe) notes.push(`dirty probe tabs: ${probe.tabs.join(" || ")}`);
          const snap = await page.locator("body").ariaSnapshot({ timeout: 8000 }).catch(() => "");
          const markers = String(snap).split("\n").filter((l) => /unsaved|dirty|•|Save/i.test(l)).slice(0, 6)
            .map((l) => l.trim().slice(0, 100));
          if (markers.length) notes.push(`dirty markers: ${markers.join(" | ")}`);
          else notes.push("dirty probe: no unsaved/dirty/Save marker in aria");
          // Left dirty for the capture (the fork comparison needs the dirty
          // anatomy); teardown undoes + saves before closing the tab.
        } catch (error) {
          notes.push(`dirty probe best-effort only: ${error.message.split("\n")[0]}`);
        }
      } catch (error) {
        missing.push(`editor-tab fixture failed: ${error.message.split("\n")[0]}`);
      }
      break;
    }
    case "split-terminal": {
      // R16-N: pane context menu → Split Terminal Right (Mod+D fallback):
      // two panes + sash + focused-pane header, compared against the fork's
      // terminal-pane split sources. The candidate fixture is owned; the
      // reference side never activates the entry (menu census only).
      // A tabpanel alone is not a terminal (the empty "Start a session"
      // view is one too): require live terminal markers, else provision.
      let terminal = false;
      try {
        terminal = (await page.locator("[data-terminal-pane-id], .xterm-helper-textarea").count().catch(() => 0)) > 0 ||
          (await ensureTerminal());
      } catch {
        terminal = false;
      }
      if (!terminal) {
        missing.push("project-terminal fixture unavailable for split");
        break;
      }
      try {
        const panel = page.getByRole("tabpanel").first();
        await panel.click({ timeout: 3000 });
        await delay(350);
        await panel.click({ button: "right", timeout: 3000 });
        await delay(600);
        const items = await menuItemNames(page);
        if (items.length) notes.push(`terminal context menu items: ${items.join(" | ")}`);
        const split = page.getByRole("menuitem", { name: "Split Terminal Right" }).first();
        if ((await split.count()) > 0) {
          await split.click({ timeout: 3000 });
          await delay(1200);
          notes.push("Split Terminal Right activated");
        } else {
          notes.push("no Split Terminal Right menu entry; trying Mod+D chord");
          await panel.click({ timeout: 3000 });
          await tryKeys(page, `${MOD}+D`);
          await delay(1200);
        }
        const census = await page.evaluate(() => {
          const ids = [...document.querySelectorAll("[data-terminal-pane-id]")]
            .map((el) => el.getAttribute("data-terminal-pane-id"));
          const activeIds = [...document.querySelectorAll("[data-active-pane]")]
            .map((el) => el.getAttribute("data-terminal-pane-id") || el.tagName);
          const host = document.querySelector('[data-split="split"]');
          const kids = host
            ? [...host.children].map((el) => `${el.tagName}[${(el.getAttribute("role") || el.className || "").toString().slice(0, 40)}]`).join(" ")
            : null;
          return {
            split: document.querySelectorAll('[data-split="split"]').length,
            paneIds: [...new Set(ids)],
            activeIds,
            sash: document.querySelectorAll('[role="separator"], [data-testid="terminal-split-divider"]').length,
            kids: (kids || "").slice(0, 300),
          };
        }).catch(() => null);
        if (census) notes.push(`split census: container=${census.split} panes=[${census.paneIds.join(",")}] active=[${census.activeIds.join(",")}] sash=${census.sash} kids=${census.kids}`);
        if (!census || census.paneIds.length < 2) missing.push("fewer than two terminal panes after split");
      } catch (error) {
        missing.push(`split-terminal fixture failed: ${error.message.split("\n")[0]}`);
      }
      break;
    }
    case "agent-state": {
      // J1/R16-I visuals: three fixture sessions showing working (ticking
      // PTY output), idle (quiet past the 3s activity window) and needs_input
      // (a real session.hook_event wait signal via the CLI rpc passthrough —
      // the documented harness-hook mechanism, no model launched).
      await ensureProject().catch(() => {});
      const cliBin = path.join(root, "target", "debug", process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli");
      const cliJson = async (cliArgs) => {
        const { stdout } = await execFileAsync(cliBin, ["--data-dir", ctx.dataDir, "--json", ...cliArgs]);
        return JSON.parse(stdout);
      };
      const sessionList = async () => {
        const walk = (v) => {
          if (Array.isArray(v)) {
            if (v.length && typeof v[0] === "object" && v[0] !== null && "id" in v[0]) return v;
            for (const el of v) {
              const hit = walk(el);
              if (hit) return hit;
            }
          } else if (v && typeof v === "object") {
            for (const el of Object.values(v)) {
              const hit = walk(el);
              if (hit) return hit;
            }
          }
          return null;
        };
        return walk(await cliJson(["terminal", "list"])) ?? [];
      };
      const openExtraTerminal = async () => {
        if (!(await tryClick(page, "button", "New tab"))) return false;
        await delay(600);
        try {
          const item = page.getByRole("menuitem", { name: "New Terminal", exact: true });
          if ((await item.count()) > 0) await item.first().click({ timeout: 3000 });
        } catch {
          /* single-action launcher */
        }
        await dismissOverlays(page);
        try {
          await page.getByRole("tab").last().waitFor({ timeout: 20000 });
          return true;
        } catch {
          return false;
        }
      };
      const focusVisibleTerm = () => page.evaluate(() => {
        const areas = [...document.querySelectorAll(".xterm-helper-textarea")];
        const vis = areas.find((el) => el.offsetParent !== null) || areas[0];
        if (!vis) return false;
        vis.focus();
        return true;
      }).catch(() => false);
      const typeInTab = async (index, text) => {
        try {
          await page.getByRole("tab").nth(index).click({ timeout: 3000 });
          await delay(400);
          await focusVisibleTerm();
          await page.keyboard.press("Control+C");
          await delay(400);
          await focusVisibleTerm();
          await page.keyboard.type(text);
          await page.keyboard.press("Enter");
          await delay(600);
          return true;
        } catch {
          return false;
        }
      };
      try {
        if (!(await ensureTerminal())) {
          missing.push("project-terminal fixture unavailable for agent states");
          break;
        }
        const before = await sessionList().catch(() => []);
        const beforeIds = new Set(before.map((s) => s.id));
        notes.push(`fixture sessions before: ${before.length}`);
        if (!(await openExtraTerminal())) missing.push("second terminal unavailable (working state)");
        if (!(await openExtraTerminal())) missing.push("third terminal unavailable (needs_input state)");
        const after = await sessionList().catch(() => []);
        const fresh = after.filter((s) => !beforeIds.has(s.id));
        notes.push(`fixture sessions after: ${after.length} (new: ${fresh.length})`);
        const tabs = await page.getByRole("tab").count().catch(() => 0);
        // Working: continuous PTY output on the first fresh session's tab
        // (tab order follows creation order; verified by polling below).
        if (fresh.length > 0 && tabs >= 2) {
          if (await typeInTab(tabs - 2, "while true; do echo tick; sleep 1; done")) notes.push("tick loop started for working state");
          else missing.push("tick loop typing failed");
        }
        // needs_input: real hook-event wait signal on the last fresh session.
        if (fresh.length > 1) {
          const target = fresh[fresh.length - 1];
          try {
            await cliJson(["rpc", "session.hook_event", "--params",
              JSON.stringify({ sessionId: target.id, incarnation: target.incarnation, event: "Notification" })]);
            notes.push("hook-event Notification sent for the last fresh session");
          } catch (error) {
            missing.push(`hook-event failed: ${error.message.split("\n")[0]}`);
          }
        }
        // Settle: the first tab stays quiet so the daemon reports it idle
        // (3s activity window); the loop keeps working; the signal holds.
        const firstId = before.length ? before[0].id : (after[0] && after[0].id);
        const workId = fresh.length > 0 ? fresh[0].id : null;
        const waitId = fresh.length > 1 ? fresh[fresh.length - 1].id : null;
        let states = {};
        const deadline = Date.now() + 20000;
        for (;;) {
          const list = await sessionList().catch(() => []);
          states = Object.fromEntries(list.map((s) => [s.id, s.agentState]));
          const okIdle = !firstId || states[firstId] === "idle";
          const okWork = !workId || states[workId] === "working";
          const okWait = !waitId || states[waitId] === "needs_input";
          if (okIdle && okWork && okWait) {
            notes.push(`agentState settled: first=${states[firstId]} work=${states[workId]} wait=${states[waitId]}`);
            break;
          }
          if (Date.now() >= deadline) {
            notes.push(`settle gave up: first=${states[firstId]} work=${states[workId]} wait=${states[waitId]}; capturing anyway`);
            break;
          }
          await delay(1000);
        }
        const badges = await page.evaluate(() => {
          const text = (document.body.innerText || "").replace(/\s+/g, " ");
          const out = [];
          for (const w of ["Working", "Idle", "Waiting for input", "No recent update", "Exited"]) {
            const n = text.split(w).length - 1;
            if (n > 0) out.push(`${w}x${n}`);
          }
          return out;
        }).catch(() => []);
        if (badges.length) notes.push(`visible state badges: ${badges.join(" ")}`);
        else notes.push("no Working/Idle/Waiting badges visible in text");
        // Decisive DOM probe: do the badges render with the fork's
        // accessible labels? The renderer merges transitions on the main
        // poll cadence, so wait for the rendered badges to track the daemon
        // truth (a badge that never tracks is a real finding, not fixture).
        const wantBadges = () => page.evaluate(() => ({
          working: document.querySelectorAll('[aria-label="Working"]').length,
          idle: document.querySelectorAll('[aria-label="Idle"]').length,
          waiting: document.querySelectorAll('[aria-label="Waiting for input"]').length,
          stale: document.querySelectorAll('[aria-label="No recent update"]').length,
          tabHtml: [...document.querySelectorAll('[role="tab"]')].slice(0, 3)
            .map((t) => (t.innerHTML || "").replace(/\s+/g, " ").slice(0, 260)),
        })).catch(() => null);
        let rendered = await wantBadges();
        const bDeadline = Date.now() + 20000;
        while (rendered && rendered.waiting < 1 && Date.now() < bDeadline) {
          await delay(1000);
          rendered = await wantBadges();
        }
        if (rendered) notes.push(`rendered badges: Working=${rendered.working} Waiting=${rendered.waiting} Idle=${rendered.idle} Stale=${rendered.stale}; tab html: ${rendered.tabHtml.join(" || ")}`);
        else notes.push("badge DOM probe best-effort only");
      } catch (error) {
        missing.push(`agent-state fixture failed: ${error.message.split("\n")[0]}`);
      }
      break;
    }
    case "status-bar-usage-states":
      await ensureProject().catch(() => {});
      if (!ctx.usageFixturePath) {
        missing.push("status-bar usage fixture path unavailable");
      } else {
        notes.push("fixture seam ready: loading, signed-out and data variants captured per state");
      }
      break;
    case "statusbar-strip":
      await ensureTerminal().catch(() => {});
      notes.push("full-page capture; strip cropped in post");
      break;
    default:
      missing.push(`unknown state ${state}`);
  }
  return { notes, missing };
}

function execFileAsync(file, args2, opts) {
  return new Promise((resolve, reject) => {
    execFile(file, args2, opts, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

async function dismissBrowserAddressEdit(page) {
  try {
    const input = page.locator('[data-drogon-browser-address-bar][aria-expanded="true"]').first();
    if ((await input.count()) === 0) return;
    await input.press("Escape").catch(() => {});
    await page.keyboard.press("Tab").catch(() => {});
    await delay(300);
  } catch {
    /* browser address chrome may already be unmounted */
  }
}

async function candTeardown(page, state, ctx) {
  const notes = [];
  if (ctx?.portFixture) {
    try {
      await ctx.portFixture.close();
      ctx.portFixture = null;
      notes.push("teardown: listening server closed");
    } catch {
      notes.push("teardown: listening server close unverifiable");
    }
  }
  await dismissBrowserAddressEdit(page);
  if (state === "launch-dialog" || state === "workspace-composer" || state === "settings-shortcuts-rebind" || state === "editor-header" || state === "automation-editor-cron-preview") {
    // R6: the harness launch Popover and the shortcut recorder are
    // invisible to the overlay census, so Escape unconditionally first
    // (closes the form, cancels recording); the generic path below
    // then closes the settings dialog and returns home.
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press("Escape").catch(() => {});
      await delay(200);
    }
    notes.push("teardown: Escape x2 for launch form / recorder / composer");
  }
  if (
    state === "worktree-card-rows" ||
    state === "browser-tab-loading" ||
    state === "address-bar-suggestions" ||
    state === "browser" ||
    state === "browser-find" ||
    state === "launch-dialog" ||
    state === "automation-editor-cron-preview" ||
    state === "editor-tab" ||
    state === "editor-dirty-close" ||
    state === "editor-header" ||
    state === "split-terminal" ||
    state === "agent-state"
  ) {
    // Close tabs these states opened (editor file tab, split tab, extra
    // agent-state terminals), highest index first; the first strip tab stays
    // so the next state always has a terminal to reuse. A dirty-editor close
    // prompt is never confirmed: Escape leaves the tab open, recorded.
    if (state === "editor-tab" || state === "editor-dirty-close") {
      // Revert the dirty probe (undo + save) so the tab closes cleanly and
      // the fixture file stays pristine for later states.
      try {
        await page.locator(".monaco-editor").first().click({ timeout: 5000 });
        await delay(300);
        await page.keyboard.press("Control+Z");
        await delay(300);
        await page.keyboard.press(`${MOD}+S`);
        await delay(800);
        notes.push("teardown: dirty probe reverted (undo + save)");
      } catch {
        notes.push("teardown dirty revert best-effort only");
      }
    }
    try {
      for (let i = 0; i < 3; i++) {
        const count = await page.getByRole("tab").count().catch(() => 0);
        if (count <= 1) break;
        await page.getByRole("tab").last().click({ button: "right", timeout: 3000 });
        await delay(600);
        const close = page.getByRole("menuitem", { name: "Close", exact: true }).first();
        if ((await close.count()) > 0) {
          await close.click({ timeout: 3000 });
          await delay(600);
          notes.push(`teardown: closed one tab (${state})`);
        } else {
          await dismissOverlays(page);
          break;
        }
        if ((await page.locator('[role="dialog"]').count().catch(() => 0)) > 0) {
          await page.keyboard.press("Escape").catch(() => {});
          await delay(300);
          notes.push("teardown: close prompt dismissed via Escape (tab left open)");
          break;
        }
      }
    } catch {
      notes.push(`teardown tab-close best-effort only (${state})`);
    }
  }
  const browserOnlyCleanupStates = new Set([
    "browser-tab-loading",
    "address-bar-suggestions",
    "browser",
    "browser-find",
  ]);
  if (browserOnlyCleanupStates.has(state)) {
    try {
      const tabs = page.getByRole("tab");
      if ((await tabs.count()) === 1 && !/\blive\b/i.test(await tabs.first().innerText())) {
        await tabs.first().click({ button: "right", timeout: 3000 });
        const close = page.getByRole("menuitem", { name: "Close", exact: true }).first();
        if ((await close.count()) > 0) {
          await close.click({ timeout: 3000 });
          await delay(500);
          notes.push(`teardown: closed browser-only tab (${state})`);
        } else {
          await dismissOverlays(page);
        }
      }
    } catch {
      notes.push(`teardown browser-only tab best-effort only (${state})`);
    }
  }
  // SettingsPanel is a native <dialog>: Escape does not reliably dismiss it,
  // so use its explicit Close button first (exact match; session closes are
  // labeled "Close <name> session" and never match).
  if (await tryClick(page, "button", "Close", 1200)) {
    notes.push("teardown: dialog dismissed via Close button");
    await delay(300);
  }
  // Known-home path (Settings back row, Sessions nav) so full pages never
  // leak into the next capture; then re-select the first strip tab.
  await ensureHome(page, notes);
  for (const [i, n] of notes.entries()) {
    if (n.startsWith("home:")) notes[i] = n.replace(/^home:/, "teardown:");
  }
  // Return to a stable view so later states start clean: select the first
  // strip tab when one exists (R6-B: no "Terminals" route button remains;
  // Files/Changes live in the right activity bar, Browser as a tab).
  try {
    if ((await page.getByRole("tab").count()) > 0) {
      await page.getByRole("tab").first().click({ timeout: 1500 });
      notes.push("teardown: selected first strip tab");
    }
  } catch {
    /* stay where we are */
  }
  await delay(250);
  return notes;
}

// ---------------------------------------------------------------------------
// Orchestration + ranking + report.
// ---------------------------------------------------------------------------
const ALL_STATES = [
  "empty",
  "worktree-card-rows",
  "browser-tab-loading",
  "editor-header",
  "address-bar-suggestions",
  "project-terminal",
  "palette",
  "quick-open",
  "command-palette",
  "launch-dialog",
  "workspace-composer",
  "settings-shortcuts-rebind",
  "settings-appearance",
  "settings-appearance-system",
  "shortcuts-status-rail",
  "changes",
  "automations",
  "automation-editor-cron-preview",
  "browser",
  "tasks",
  "tasks-rows",
  "tasks-filters",
  "bots",
  "bots-empty-and-list",
  "statusbar-strip",
  "status-bar-usage-states",
  "explorer",
  "source-control",
  "source-control-dirty",
  "source-control-no-remote",
  "create-menu",
  "sidebar-menus",
  "tab-menus",
  "right-rail",
  "dialogs",
  "settings-general",
  "settings-terminal",
  "settings-agents",
  "settings-notifications",
  "settings-git",
  "settings-shortcuts",
  "terminal-find",
  "browser-find",
  "mentu",
  "session-details",
  "automation-runs",
  "bot-responsibilities",
  "toasts",
  "editor-tab",
  "split-terminal",
  "agent-state",
  "workspace-composer",
  "session-details-panel",
  "ports-listening",
  "explorer-selected-file",
  "editor-dirty-close",
  "automation-run-detail",
  "bots-history",
  "mentu-evidence",
];

const CAND_OWNER = {
  "shell-sidebar": "apps/desktop/src/renderer/src/features/shell/Sidebar.tsx, ProjectList.tsx, WorktreeCard.tsx",
  "worktree-card-rows": "apps/desktop/src/renderer/src/features/shell/WorktreeCard.tsx, worktree-card-agent-summary.ts",
  "browser-tab-loading": "apps/desktop/src/renderer/src/features/browser/browser-navigation-control-row.tsx, browser-panel.tsx, features/shell/tab-strip/SortableBrowserTab.tsx",
  "editor-header": "apps/desktop/src/renderer/src/features/editor/EditorPane.tsx, EditorPanelHeaderPath.tsx, EditorViewToggle.tsx, EditorPanelMarkdownActionsMenu.tsx",
  "address-bar-suggestions": "apps/desktop/src/renderer/src/features/browser/browser-address-bar.tsx, browser-address-bar-suggestions.ts, browser-recent-urls.ts",
  "tab-bar": "apps/desktop/src/renderer/src/features/shell/TabBar.tsx, TabCreateMenu.tsx, tab-chrome.ts + features/browser/BrowserStripTab.tsx",
  "status-bar": "apps/desktop/src/renderer/src/components/status-bar/StatusBar.tsx",
  "source-control-no-remote": "apps/desktop/src/renderer/src/features/source-control/ChangesPanel.tsx, branch-context-row.tsx, commit-area.tsx",
  palette: "apps/desktop/src/renderer/src/components/command-palette/CommandPalette.tsx + shortcuts.ts",
  settings: "apps/desktop/src/renderer/src/settings-panel.tsx",
  changes: "apps/desktop/src/renderer/src/features/source-control/",
  automations: "apps/desktop/src/renderer/src/features/automations/",
  "automation-editor-cron-preview": "apps/desktop/src/renderer/src/features/automations/AutomationEditorDialog.tsx, AutomationSchedulePicker.tsx, AutomationCustomCronPanel.tsx",
  browser: "apps/desktop/src/renderer/src/features/browser/",
  tasks: "apps/desktop/src/renderer/src/features/shell/SidebarNav.tsx (placeholder; J6 owner builds the page)",
  "tasks-rows": "apps/desktop/src/renderer/src/features/tasks/task-page/github/Rows.tsx, List.tsx, ../PaginationBar.tsx",
  "tasks-filters": "apps/desktop/src/renderer/src/features/tasks/task-page/github/Filters.tsx, ModeControls.tsx, IssueSelectors.tsx",
  "command-palette": "apps/desktop/src/renderer/src/components/command-palette/CommandPalette.tsx + features/jump-palette/",
  "launch-dialog": "apps/desktop/src/renderer/src/features/shell/TabCreateMenu.tsx, pi-model-mapping.ts",
  "workspace-composer": "apps/desktop/src/renderer/src/features/new-workspace/NewWorkspaceComposer.tsx, NewWorkspaceComposerModal.tsx, composer-submit.ts",
  "settings-shortcuts-rebind": "apps/desktop/src/renderer/src/features/settings/shortcuts-section.tsx, keybinding-overrides.ts",
  "settings-appearance-system": "apps/desktop/src/renderer/src/features/settings/appearance-section.tsx, native-theme-sync.ts, apps/desktop/src/renderer/src/theme.ts",
  "shortcuts-status-rail": "apps/desktop/src/renderer/src/features/settings/shortcuts-section.tsx, shortcut-status-rail.tsx",
  bots: "apps/desktop/src/renderer/src/features/bots/",
  "bots-empty-and-list": "apps/desktop/src/renderer/src/features/bots/BotsPanel.tsx, BotsPageStates.tsx, BotResponsibilityCard.tsx",
  explorer: "apps/desktop/src/renderer/src/features/file-explorer/",
  "source-control-dirty": "apps/desktop/src/renderer/src/features/source-control/ChangesPanel.tsx, uncommitted-sections.tsx, section-header.tsx",
  "sidebar-menus": "apps/desktop/src/renderer/src/features/shell/ProjectList.tsx, project-actions-menu.tsx, WorktreeContextMenu.tsx",
  "tab-menus": "apps/desktop/src/renderer/src/features/shell/TabCreateMenu.tsx, TabContextMenu.tsx",
  "right-rail": "apps/desktop/src/renderer/src/features/right-sidebar/RightSidebar.tsx, features/file-explorer/FileExplorerMenus.tsx, features/ports/PortsPanel.tsx",
  dialogs: "apps/desktop/src/renderer/src/features/shell/DeleteWorktreeDialog.tsx, RemoveProjectDialog.tsx",
  "settings-general": "apps/desktop/src/renderer/src/features/settings/general-section.tsx, SettingsPage.tsx, settings-sections.ts",
  "settings-terminal": "apps/desktop/src/renderer/src/features/settings/terminal-section.tsx, SettingsPage.tsx, settings-sections.ts",
  "settings-agents": "apps/desktop/src/renderer/src/features/settings/agents-section.tsx, agent-defaults.ts",
  "settings-notifications": "apps/desktop/src/renderer/src/features/settings/notifications-section.tsx",
  "settings-git": "apps/desktop/src/renderer/src/features/settings/git-section.tsx",
  "settings-shortcuts": "apps/desktop/src/renderer/src/features/settings/shortcuts-section.tsx, keybindings/definitions.ts",
  "terminal-find": "apps/desktop/src/renderer/src/features/terminal/TerminalSearch.tsx, find-query-bounds.ts",
  "browser-find": "apps/desktop/src/renderer/src/features/browser/browser-find-bar.tsx, browser-find-state.ts, browser-page-context-menu.tsx, browser-menu-policy.ts, browser-notices.ts",
  mentu: "apps/desktop/src/renderer/src/features/mentu/MentuPanel.tsx, RecipePane*.tsx",
  "session-details": "apps/desktop/src/renderer/src/features/right-sidebar/SessionDetailsPanel.tsx",
  "automation-runs": "apps/desktop/src/renderer/src/features/automations/AutomationRunsDashboard.tsx, AutomationRunsTable.tsx, AutomationRunDetailsPage.tsx",
  "bot-responsibilities": "apps/desktop/src/renderer/src/features/bots/BotsPanel.tsx, BotResponsibilityCard.tsx",
  toasts: "apps/desktop/src/renderer/src/components/ui/sonner.tsx, App.tsx (Toaster)",
  "editor-tab": "apps/desktop/src/renderer/src/features/shell/editor-tab.ts, features/editor/EditorPane.tsx",
  "split-terminal": "apps/desktop/src/renderer/src/features/terminal/TerminalSplitHost.tsx, TerminalSplitHeaderOverlay.tsx",
  "agent-state": "apps/desktop/src/renderer/src/features/shell/agent-state.ts, AgentStateIcon.tsx",
  "workspace-composer": "apps/desktop/src/renderer/src/features/new-workspace/NewWorkspaceComposer.tsx, NewWorkspaceComposerModal.tsx, composer-submit.ts",
  "session-details-panel": "apps/desktop/src/renderer/src/features/right-sidebar/SessionDetailsPanel.tsx, features/shell/WorktreeAgentRow.tsx",
  "ports-listening": "apps/desktop/src/renderer/src/features/ports/PortsPanel.tsx, local-workspace-ports-panel.tsx, local-port-details-dialog.tsx",
  "explorer-selected-file": "apps/desktop/src/renderer/src/features/file-explorer/FileExplorer.tsx, FileExplorerTreePane.tsx, FileExplorerRow.tsx",
  "editor-dirty-close": "apps/desktop/src/renderer/src/features/shell/tab-strip/EditorStripTab.tsx, features/shell/TabBar.tsx, App.tsx",
  "automation-run-detail": "apps/desktop/src/renderer/src/features/automations/AutomationRunDetailsPage.tsx, AutomationRunPageFrame.tsx, automation-run-content.ts",
  "bots-history": "apps/desktop/src/renderer/src/features/bots/BotsPanel.tsx, BotResponsibilityCard.tsx, bots-panel-projection.ts",
  "mentu-evidence": "apps/desktop/src/renderer/src/features/mentu/MentuPanel.tsx, RecipePaneContent.tsx, RecipePaneInspector.tsx",
  tokens: "apps/desktop/src/renderer/src/assets/main.css",
};

const STATE_SURFACE = {
  empty: "shell-sidebar",
  "worktree-card-rows": "worktree-card-rows",
  "browser-tab-loading": "browser-tab-loading",
  "editor-header": "editor-header",
  "address-bar-suggestions": "address-bar-suggestions",
  "project-terminal": "tab-bar",
  palette: "palette",
  "quick-open": "palette",
  "settings-appearance": "settings",
  "settings-appearance-system": "settings-appearance-system",
  "shortcuts-status-rail": "shortcuts-status-rail",
  changes: "changes",
  automations: "automations",
  "automation-editor-cron-preview": "automation-editor-cron-preview",
  browser: "browser",
  tasks: "tasks",
  "tasks-rows": "tasks",
  "tasks-filters": "tasks",
  "command-palette": "palette",
  "launch-dialog": "launch-dialog",
  "workspace-composer": "workspace-composer",
  "settings-shortcuts-rebind": "settings-shortcuts",
  bots: "bots",
  "bots-empty-and-list": "bots-empty-and-list",
  "statusbar-strip": "status-bar",
  "status-bar-usage-states": "status-bar",
  explorer: "explorer",
  "source-control": "changes",
  "source-control-dirty": "changes",
  "create-menu": "tab-bar",
  "sidebar-menus": "sidebar-menus",
  "tab-menus": "tab-menus",
  "right-rail": "right-rail",
  dialogs: "dialogs",
  "settings-general": "settings-general",
  "settings-terminal": "settings-terminal",
  "settings-agents": "settings-agents",
  "settings-notifications": "settings-notifications",
  "settings-git": "settings-git",
  "settings-shortcuts": "settings-shortcuts",
  "terminal-find": "terminal-find",
  "browser-find": "browser-find",
  mentu: "mentu",
  "session-details": "session-details",
  "automation-runs": "automation-runs",
  "bot-responsibilities": "bot-responsibilities",
  toasts: "toasts",
  "editor-tab": "editor-tab",
  "split-terminal": "split-terminal",
  "agent-state": "agent-state",
  "workspace-composer": "workspace-composer",
  "session-details-panel": "session-details-panel",
  "ports-listening": "ports-listening",
  "explorer-selected-file": "explorer-selected-file",
  "editor-dirty-close": "editor-dirty-close",
  "automation-run-detail": "automation-run-detail",
  "bots-history": "bots-history",
  "mentu-evidence": "mentu-evidence",
};

// Preferred source-value keywords per surface: the ranked item must cite the
// exact value to adopt (a width, a token, a copy string), not an import line.
const SOURCE_PREFERENCE = {
  "shell-sidebar": ["min_width", "max_width", "sidebarwidth", "width:", "w-["],
  "worktree-card-rows": ["session", "agent", "working", "waiting", "aria-label", "classname"],
  "browser-tab-loading": ["loading", "spinner", "reload", "classname"],
  "editor-header": ["more actions", "changes", "edit", "path", "classname"],
  "address-bar-suggestions": ["search google for", "recent", "suggestion", "address", "classname"],
  "tab-bar": ["height", "h-", "min-h", "classname"],
  "status-bar": ["height", "h-6", "min-h", "classname"],
  palette: ["placeholder", "combobox", "input", "shortcut"],
  settings: ["appearance", "theme", "classname"],
  changes: ["stage", "commit", "diff", "classname"],
  automations: ["schedule", "cron", "classname"],
  browser: ["address", "url", "classname"],
  tasks: ["issue", "filter", "classname"],
  "tasks-rows": ["github-task-row", "start workspace", "pagination", "classname"],
  "launch-dialog": ["launch", "provider/model", "model", "classname"],
  "workspace-composer": ["new workspace", "project", "agent", "advanced", "classname"],
  bots: ["preset", "chat", "classname"],
  explorer: ["find files", "collapse", "explorer", "classname"],
  "sidebar-menus": ["workspace options", "project actions", "delete", "classname"],
  "tab-menus": ["new terminal", "pin", "close", "classname"],
  "right-rail": ["explorer", "ports", "activity", "classname"],
  dialogs: ["delete", "remove", "cancel", "classname"],
  "settings-general": ["general", "workspace directory", "auto save", "classname"],
  "settings-terminal": ["terminal", "sessions", "kill", "classname"],
  "settings-agents": ["agents", "harness", "default", "classname"],
  "settings-notifications": ["notifications", "enable", "sound", "classname"],
  "settings-git": ["git", "branch", "compare", "classname"],
  "settings-shortcuts": ["shortcuts", "chord", "keyboard", "classname"],
  "settings-appearance-system": ["theme", "system", "dark", "classname"],
  "shortcuts-status-rail": ["shortcut status filters", "modified", "unassigned", "conflicts", "classname"],
  "automation-editor-cron-preview": ["cron", "next runs", "preview", "classname"],
  "bots-empty-and-list": ["bots", "empty", "list", "character", "classname"],
  "terminal-find": ["search", "find", "match", "classname"],
  "browser-find": ["find in page", "match", "classname"],
  mentu: ["recipe", "run", "evidence", "classname"],
  "session-details": ["session", "details", "terminal", "classname"],
  "automation-runs": ["runs", "dashboard", "classname"],
  "bot-responsibilities": ["responsibility", "history", "classname"],
  "settings-notifications": ["notifications", "toggle", "classname"],
  "settings-git": ["git", "github", "login", "classname"],
  toasts: ["sonner", "toast", "classname"],
  "editor-tab": ["dirty", "save", "close", "classname"],
  "split-terminal": ["split", "sash", "separator", "classname"],
  "agent-state": ["working", "waiting", "idle", "classname"],
  "workspace-composer": ["new workspace", "project", "agent", "advanced", "classname"],
  "session-details-panel": ["session details", "details", "harness", "classname"],
  "ports-listening": ["listening", "open in browser", "details", "classname"],
  "explorer-selected-file": ["find files", "collapse all", "selected", "classname"],
  "editor-dirty-close": ["dirty", "unsaved", "save", "discard", "classname"],
  "automation-run-detail": ["run details", "output", "host", "prompt", "classname"],
  "bots-history": ["history", "responsibility history", "scheduled", "manual", "classname"],
  "mentu-evidence": ["evidence", "stdout", "stderr", "classname"],
  tokens: ["font", "geist", "text-", "leading", "tracking", "weight"],
};

// Title-anchored source overrides: well-known controls cite their exact
// owner file (verified by grep during R5-F), not the state surface file.
const TITLE_SOURCES = [
  // R6-B right sidebar + tab strip anchors (ordered most-specific first:
  // "Toggle sidebar" is a substring of "Toggle right sidebar").
  { match: "Toggle right sidebar", file: "src/renderer/src/components/right-sidebar/index.tsx", probes: ["Toggle right sidebar", "aria-label"], cand: "apps/desktop/src/renderer/src/features/right-sidebar/RightSidebar.tsx" },
  { match: "Source Control", file: "src/renderer/src/components/right-sidebar/activity-bar-buttons.tsx", probes: ["aria-label", "activityItemAriaLabel"], cand: "apps/desktop/src/renderer/src/features/right-sidebar/RightSidebar.tsx" },
  { match: "New Browser Tab", file: "src/renderer/src/components/tab-bar/tab-bar-static-create-menu.tsx", probes: ["New Browser Tab"], cand: "apps/desktop/src/renderer/src/features/shell/TabCreateMenu.tsx" },
  { match: "New Terminal", file: "src/renderer/src/components/tab-bar/tab-bar-static-create-menu.tsx", probes: ["New Terminal"], cand: "apps/desktop/src/renderer/src/features/shell/TabCreateMenu.tsx" },
  { match: "Toggle sidebar", file: "src/renderer/src/app-shell/TitlebarLeftControls.tsx", probes: ["Toggle sidebar", "aria-label"], cand: "apps/desktop/src/renderer/src/features/shell/Sidebar.tsx" },
  { match: "Go back", file: "src/renderer/src/app-shell/TitlebarLeftControls.tsx", probes: ["Go back", "aria-label"], cand: "apps/desktop/src/renderer/src/features/shell/Sidebar.tsx" },
  { match: "Go forward", file: "src/renderer/src/app-shell/TitlebarLeftControls.tsx", probes: ["Go forward", "aria-label"], cand: "apps/desktop/src/renderer/src/features/shell/Sidebar.tsx" },
  { match: "Search worktrees and browser tabs", file: "src/renderer/src/components/sidebar/SidebarNav.tsx", probes: ["Search worktrees and browser tabs", "aria-label"], cand: "apps/desktop/src/renderer/src/features/shell/SidebarNav.tsx" },
  { match: "Drogon logo", file: "src/renderer/src/components/Landing.tsx", probes: ["Drogon logo", "alt", "aria-label"], cand: "apps/desktop/src/renderer/src/App.tsx" },
  { match: "Star on GitHub", file: "src/renderer/src/components/StarNagCard.tsx", probes: ["Star on GitHub", "aria-label"], cand: "apps/desktop/src/renderer/src/App.tsx" },
  { match: "Create workspace", file: "src/renderer/src/components/Landing.tsx", probes: ["Create workspace", "aria-label"], cand: "apps/desktop/src/renderer/src/App.tsx" },
  { match: "Add Project", file: "src/renderer/src/components/Landing.tsx", probes: ["Add Project", "aria-label"], cand: "apps/desktop/src/renderer/src/App.tsx" },
  { match: "Show floating workspace", file: "src/renderer/src/app-shell/use-floating-workspace-panel.ts", probes: ["Show floating workspace", "aria-label"], cand: "apps/desktop/src/renderer/src/App.tsx" },
];

const titleSourceCache = new Map();
async function titleSource(title) {
  const hit = TITLE_SOURCES.find((t) => title.includes(t.match));
  if (!hit) return null;
  if (titleSourceCache.has(hit.match)) return titleSourceCache.get(hit.match);
  let value = "(no probe line matched; open the file)";
  try {
    const text = await readFile(path.join(REF_ROOT, hit.file), "utf8");
    outer: for (const probe of hit.probes) {
      for (const line of text.split("\n")) {
        if (line.includes(probe)) {
          value = `${probe}: ${line.trim().slice(0, 170)}`;
          break outer;
        }
      }
    }
  } catch {
    value = "(source file unreadable)";
  }
  const result = { file: hit.file, value, cand: hit.cand };
  titleSourceCache.set(hit.match, result);
  return result;
}

function surfaceRefFile(surfaceId, inventory) {
  const entry = inventory.find((e) => e.id === surfaceId);
  const prefs = SOURCE_PREFERENCE[surfaceId] ?? [];
  let best = null;
  for (const r of entry?.ref ?? []) {
    if (!r.exists) continue;
    for (const m of r.matches) {
      const line = m.includes(": ") ? m.slice(m.indexOf(": ") + 2) : m;
      let score = scoreProbeLine(line);
      const lower = line.toLowerCase();
      for (const p of prefs) if (lower.includes(p)) score += 5;
      if (!best || score > best.score) best = { file: r.file, value: m, score };
    }
  }
  if (best) return { file: best.file, value: best.value };
  const any = entry?.ref.find((r) => r.exists);
  if (any) return { file: any.file, value: "(no probe line matched; open the file)" };
  return { file: entry?.ref[0]?.file ?? "(unknown)", value: "(source file not found at inventoried path)" };
}

async function runState(side, page, state, outDir, ctx, setup, teardown) {
  const base = path.join(outDir, `${state}.${side}`);
  const { notes, missing } = await setup(page, state, ctx);
  const schemes = NO_DARK ? ["light"] : ["light", "dark"];
  const caps = {};
  // The usage fixture is intentionally exercised as three separate candidate
  // captures. The normal state files are the data variant, while loading and
  // signed-out retain their own PNG/ARIA/DOM artifacts for review.
  const usageVariants = state === "status-bar-usage-states"
    ? ["loading", "signed-out", "data"]
    : [null];
  for (const variant of usageVariants) {
    if (variant) {
      if (side === "cand" && ctx.usageFixturePath) {
        try {
          await writeStatusUsageFixture(ctx.usageFixturePath, variant);
          await reloadCandidateForUsageFixture(page, notes);
          notes.push(`usage fixture variant captured: ${variant}`);
        } catch (error) {
          missing.push(`${side} usage ${variant} fixture failed: ${error.message.split("\n")[0]}`);
        }
      } else if (side === "cand") {
        missing.push("status-bar usage fixture path unavailable");
      } else {
        // The reference is read-only and cannot consume the candidate seam;
        // capture the stable reference strip alongside each candidate variant.
        notes.push(`ref baseline captured for usage variant: ${variant}`);
      }
    }
    const captureBase = variant && variant !== "data" ? `${base}.${variant}` : base;
    for (const scheme of schemes) {
      try {
        const captured = await captureTriple(page, captureBase, scheme);
        // Keep the data variant as the comparable state pair in report.md.
        if (!variant || variant === "data") caps[scheme] = captured;
      } catch (error) {
        missing.push(`${side} ${variant ? `${variant} ` : ""}${scheme} capture failed: ${error.message.split("\n")[0]}`);
      }
    }
  }
  if (state === "statusbar-strip" && caps.light) {
    try {
      const strip = `${base}.strip.png`;
      const box = await page.locator("body").boundingBox();
      const h = box?.height ?? VIEWPORT.height;
      const w = box?.width ?? VIEWPORT.width;
      await page.screenshot({ path: strip, animations: "disabled", clip: { x: 0, y: Math.max(0, h - 48), width: w, height: Math.min(48, h) } });
      notes.push("cropped status strip saved as .strip.png");
    } catch {
      notes.push("strip crop best-effort only");
    }
  }
  try {
    const extra = await teardown(page, state);
    if (Array.isArray(extra)) notes.push(...extra);
  } catch {
    /* teardown is best-effort */
  }
  return { notes, missing, caps };
}

async function rankDifferences(stateResults, inventory) {
  const items = [];
  const push = (area, title, detail, surfaceId, evidence) => {
    const src = surfaceRefFile(surfaceId, inventory);
    items.push({
      area,
      title,
      detail,
      sourceFile: src.file,
      sourceValue: src.value,
      candidateFile: CAND_OWNER[surfaceId] ?? "apps/desktop/src/renderer/src/App.tsx",
      evidence,
      state: detail.state,
    });
  };
  for (const r of stateResults) {
    const surface = STATE_SURFACE[r.state] ?? "shell-sidebar";
    for (const m of r.refMissing) {
      items.push({
        area: "structure",
        title: `[${r.state}] reference side: ${m.slice(0, 120)}`,
        detail: { state: r.state, kind: "ref-missing", text: m },
        sourceFile: surfaceRefFile(surface, inventory).file,
        sourceValue: surfaceRefFile(surface, inventory).value,
        candidateFile: CAND_OWNER[surface],
        evidence: "rendered-only",
        state: r.state,
      });
    }
    for (const m of r.candMissing) {
      items.push({
        area: m.includes("fixture") || m.includes("unavailable") ? "structure" : "interaction",
        title: `[${r.state}] candidate: ${m.slice(0, 120)}`,
        detail: { state: r.state, kind: "cand-missing", text: m },
        sourceFile: surfaceRefFile(surface, inventory).file,
        sourceValue: surfaceRefFile(surface, inventory).value,
        candidateFile: CAND_OWNER[surface],
        evidence: "rendered-only",
        state: r.state,
      });
    }
    if (!r.diff) continue;
    // Chrome geometry cites the chrome owner, not the incidental state.
    const REGION_SURFACE = { sidebar: "shell-sidebar", tablist: "tab-bar", statusbar: "status-bar" };
    for (const [region, dd] of Object.entries(r.diff.geom)) {
      if (!dd || region === "heading") continue;
      if (Math.abs(dd.dw) >= 3 || Math.abs(dd.dh) >= 3) {
        push(
          "layout",
          `[${r.state}] ${region} geometry differs (ref ${dd.refW}x${dd.refH} vs cand ${dd.candW}x${dd.candH})`,
          { state: r.state, kind: "geometry", region, ...dd },
          REGION_SURFACE[region] ?? surface,
          dd.sourceBacked ? "both" : "rendered-only",
        );
      }
    }
    const head = r.diff.headline;
    if (head) {
      push(
        "typography",
        `[${r.state}] headline type differs (ref "${head.refText}" ${head.refSize}/${head.refWeight} vs cand "${head.candText}" ${head.candSize}/${head.candWeight})`,
        { state: r.state, kind: "headline", ...head },
        "tokens",
        "rendered-only",
      );
    }
    for (const c of r.diff.aria.changed.slice(0, 6)) {
      push(
        "copy",
        `[${r.state}] text differs: ref "${c.ref.slice(0, 90)}" vs cand "${c.cand.slice(0, 90)}"`,
        { state: r.state, kind: "text", ref: c.ref, cand: c.cand },
        surface,
        "rendered-only",
      );
    }
    for (const m of r.diff.aria.missing.slice(0, 4)) {
      push(
        "structure",
        `[${r.state}] in ref but not candidate: "${m.slice(0, 100)}"`,
        { state: r.state, kind: "aria-missing", text: m },
        surface,
        "rendered-only",
      );
    }
    for (const a of r.diff.aria.added.slice(0, 4)) {
      push(
        "structure",
        `[${r.state}] in candidate but not ref: "${a.slice(0, 100)}"`,
        { state: r.state, kind: "aria-added", text: a },
        surface,
        "rendered-only",
      );
    }
  }
  // The same chrome delta (sidebar/statusbar width) repeats in every state:
  // collapse identical geometry signatures into one item listing all states
  // so the top-30 has room for per-surface findings.
  const geoSeen = new Map();
  const deduped = [];
  for (const item of items) {
    if (item.detail.kind !== "geometry") {
      deduped.push(item);
      continue;
    }
    const d = item.detail;
    const key = `${d.region}|${d.dw}|${d.dh}|${d.dx}|${d.dy}`;
    const prev = geoSeen.get(key);
    if (!prev) {
      geoSeen.set(key, item);
      item.states = [item.state];
      deduped.push(item);
    } else {
      prev.states.push(item.state);
    }
  }
  // Identical copy/typography findings across states collapse the same way.
  const copySeen = new Map();
  const final = [];
  for (const item of deduped) {
    if (item.detail.kind === "geometry") {
      final.push(item);
      continue;
    }
    const key = `${item.detail.kind}|${item.title.replace(/^\[[^\]]+\]\s*/, "")}`;
    const prev = copySeen.get(key);
    if (!prev) {
      copySeen.set(key, item);
      item.states = item.states ?? [item.state];
      final.push(item);
    } else {
      prev.states.push(item.state);
    }
  }
  for (const item of final) {
    if (item.states?.length > 1) {
      item.title = item.title.replace(
        `[${item.state}]`,
        `[${item.states.length} states: ${item.states.join(", ")}]`,
      );
    }
  }
  for (const item of final) {
    if (!["aria-missing", "aria-added", "text"].includes(item.detail.kind)) continue;
    const anchor = await titleSource(`${item.title} ${item.detail.text ?? ""} ${item.detail.ref ?? ""} ${item.detail.cand ?? ""}`);
    if (anchor) {
      item.sourceFile = anchor.file;
      item.sourceValue = anchor.value;
      item.candidateFile = anchor.cand;
      if (item.evidence === "rendered-only") item.evidence = "both";
    }
  }
  const areaRank = { layout: 0, typography: 1, structure: 2, copy: 3, interaction: 4 };
  const evRank = { both: 0, "rendered-only": 1, "source-only": 2 };
  final.sort(
    (a, b) => evRank[a.evidence] - evRank[b.evidence] || areaRank[a.area] - areaRank[b.area],
  );
  return final.slice(0, 30);
}

function md(items) {
  return items.map((i) => `- ${i}`).join("\n");
}

async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = OUT ? path.resolve(OUT) : path.join(root, ".preflight", "fidelity", runId);
  await mkdir(outDir, { recursive: true });
  const states = STATES_FILTER?.length ? ALL_STATES.filter((s) => STATES_FILTER.includes(s)) : ALL_STATES;

  const inventory = await buildInventory();

  // Reference side (read-only confirmation).
  let refBrowser = null;
  let refPage = null;
  const refMeta = { initialScheme: "light", initialViewport: null };
  try {
    refBrowser = await chromium.connectOverCDP(REF_CDP);
  } catch (error) {
    console.error(
      `Reference app not reachable at ${REF_CDP}: ${error.message.split("\n")[0]}\n` +
        "Start the orca-drogon dev app on this Mac and re-run with its CDP endpoint. The candidate was not started.",
    );
    process.exitCode = 2;
    return;
  }
  // Candidate side (owned).
  let owned = null;
  let candPage = null;
  let candBrowser = null;
  try {
    refPage = refBrowser.contexts()[0]?.pages()[0];
    assert.ok(refPage, "Reference CDP has no open page");
    guardReferencePage(refPage);
    refPage.setDefaultTimeout(15000);
    refMeta.initialViewport = refPage.viewportSize();
    refMeta.initialScheme = await refPage.evaluate(() =>
      matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    ).catch(() => "light");
    refMeta.title = await refPage.title().catch(() => "?");
    refMeta.url = refPage.url();

    if (CAND_CDP) {
      candBrowser = await chromium.connectOverCDP(CAND_CDP);
      candPage = candBrowser.contexts()[0]?.pages()[0];
      assert.ok(candPage, "Candidate CDP has no open page");
      candPage.setDefaultTimeout(15000);
    } else {
      owned = await launchCandidate();
      candPage = owned.page;
    }
    const candVersions = await candPage.evaluate(async () => {
      try {
        const status = await window.drogon.status();
        const build = await window.drogon.buildInfo().catch(() => null);
        return { status: status.ok ? status.result : status, build };
      } catch (error) {
        return { error: error.message };
      }
    }).catch((error) => ({ error: error.message }));

    const ctx = {
      workspace: owned?.workspace ?? "<external-candidate>",
      // tasks-rows drives project/worktree setup through drogon-cli
      // against the owned daemon; external candidates skip that state.
      dataDir: owned?.dataDir ?? null,
      browserFixture: owned?.browserFixture ?? null,
      usageFixturePath: owned?.usageFixturePath ?? null,
    };
    const reacquire = async (browser, label) => {
      const page = browser.contexts()[0]?.pages()[0];
      assert.ok(page, `${label} CDP has no open page (reacquire)`);
      page.setDefaultTimeout(15000);
      if (label === "Reference") guardReferencePage(page);
      return page;
    };
    const safeRun = async (side, page, state, setup, teardown) => {
      try {
        return { result: await runState(side, page, state, outDir, ctx, setup, teardown), page };
      } catch (error) {
        // One bad state (transient CDP blip, HMR reload) must not kill the
        // run: record it, reacquire the page, and continue with the rest.
        console.log(`state ${state} ${side} setup error (isolated): ${error.message.split("\n")[0]}`);
        return {
          result: {
            notes: [],
            missing: [`${side} setup error (isolated, run continued): ${error.message.split("\n")[0]}`],
            caps: {},
          },
          page,
        };
      }
    };
    const stateResults = [];
    for (const state of states) {
      let ref, cand;
      ({ result: ref, page: refPage } = await safeRun("ref", refPage, state, refSetup, refTeardown));
      if (!ref.caps.light) {
        try {
          refPage = await reacquire(refBrowser, "Reference");
        } catch {
          /* keep the old handle; next state will report again */
        }
      }
      ({ result: cand, page: candPage } = await safeRun("cand", candPage, state, candSetup, candTeardown));
      const refCap = ref.caps.light;
      const candCap = cand.caps.light;
      let diff = null;
      if (refCap && candCap) {
        const aria = diffAria(refCap.aria, candCap.aria);
        const geom = {};
        for (const region of Object.keys(REGION_QUERIES)) {
          const a = refCap.dom.regions[region];
          const b = candCap.dom.regions[region];
          const dd = geomDelta(a, b);
          geom[region] = dd
            ? { ...dd, refW: a.rect.w, refH: a.rect.h, candW: b.rect.w, candH: b.rect.h, refSel: a.sel, candSel: b.sel, sourceBacked: true }
            : { missing: true, refSel: a?.sel ?? null, candSel: b?.sel ?? null, sourceBacked: false };
        }
        const rh = refCap.dom.headlines[0];
        const ch = candCap.dom.headlines[0];
        const headline =
          rh && ch && (rh.text !== ch.text || rh.fontSize !== ch.fontSize || rh.fontWeight !== ch.fontWeight)
            ? {
                refText: rh.text.slice(0, 80),
                candText: ch.text.slice(0, 80),
                refSize: rh.fontSize,
                candSize: ch.fontSize,
                refWeight: rh.fontWeight,
                candWeight: ch.fontWeight,
                refFont: rh.fontFamily,
                candFont: ch.fontFamily,
              }
            : null;
        const pixel = {};
        for (const scheme of ["light", "dark"]) {
          const refScheme = ref.caps[scheme];
          const candScheme = cand.caps[scheme];
          if (!refScheme || !candScheme) continue;
          try {
            pixel[scheme] = await pixelDiffPercent(refScheme.png, candScheme.png);
          } catch (error) {
            pixel[scheme] = { error: error.message.split("\\n")[0] };
          }
        }
        diff = { aria, geom, headline, pixel };
      }
      stateResults.push({
        state,
        refNotes: ref.notes,
        refMissing: ref.missing,
        candNotes: cand.notes,
        candMissing: cand.missing,
        diff,
      });
      console.log(
        `state ${state}: ref aria ${refCap ? ariaLines(refCap.aria).length : "?"} lines, ` +
          `cand aria ${candCap ? ariaLines(candCap.aria).length : "?"} lines` +
          (diff ? `, missing=${diff.aria.missing.length} added=${diff.aria.added.length} changed=${diff.aria.changed.length}` : "") +
          (diff?.pixel?.light?.percent != null ? ` pixel=${diff.pixel.light.percent}%` : ""),
      );
    }

    // Restore the reference page's views and appearance overrides; data untouched.
    try {
      await refPage.emulateMedia({ colorScheme: refMeta.initialScheme });
      if (refMeta.initialViewport) await refPage.setViewportSize(refMeta.initialViewport);
      const restoreNotes = [];
      await ensureClean(refPage, restoreNotes);
      await tryClick(refPage, "button", "Back to app", 1500);
      await tryClick(refPage, "button", "Sessions", 1500);
      await ensureClean(refPage, restoreNotes);
      if (restoreNotes.length) console.log(`ref restore: ${restoreNotes.join("; ")}`);
    } catch {
      /* best-effort restore */
    }

    const ranked = await rankDifferences(stateResults, inventory);
    const report = renderReport({ runId, states, inventory, stateResults, ranked, refMeta, candVersions, outDir });
    await writeFile(path.join(outDir, "report.md"), report);
    await writeFile(path.join(outDir, "index.html"), renderIndex(states));
    console.log(JSON.stringify({ status: "PASSED", report: path.join(outDir, "report.md"), states, ranked: ranked.length }));
  } finally {
    try {
      await refBrowser?.close().catch(() => {});
    } catch {
      /* nothing owned here */
    }
    if (candBrowser && !owned) {
      try {
        await candBrowser.close().catch(() => {});
      } catch {
        /* external candidate left alone */
      }
    }
    if (owned && !KEEP) {
      const notes = await stopCandidate(owned);
      for (const n of notes) console.log(`cleanup: ${n}`);
    } else if (owned && KEEP) {
      console.log(`kept: fixture ${owned.fixture}`);
    }
  }
}

function renderReport({ runId, states, inventory, stateResults, ranked, refMeta, candVersions, outDir }) {
  const lines = [];
  lines.push(`# QA UI Round 10 fidelity report — ${runId}`);
  lines.push("");
  lines.push(`Viewport ${VIEWPORT.width}x${VIEWPORT.height}, schemes: ${NO_DARK ? "light" : "light + dark"}.`);
  lines.push(`Viewport options: --viewport WIDTHxHEIGHT (or --width/--height); this run was captured at the requested native size.`);
  lines.push(`Reference (read-only, confirmation only): CDP ${REF_CDP} — title "${refMeta.title}", url ${refMeta.url}.`);
  lines.push(`Candidate: ${CAND_CDP ? `external CDP ${CAND_CDP}` : "owned production bundle (apps/desktop/out) + real drogond in a temp data dir, --remote-debugging-port=0"}.`);
  lines.push(`Candidate versions: ${JSON.stringify(candVersions).slice(0, 400)}`);
  lines.push("");
  lines.push("Method: the SOURCE OF TRUTH is the reference source code. Expected structure, classes/tokens, copy, shortcuts and behavior come from the inventoried files below; the running reference instance only confirms the rendered result. Sensitive text (paths, usernames, hashes, durations) is normalized to placeholders before diffing and is never a difference. Where a surface does not exist on one side, the state records \"missing\" explicitly.");
  lines.push("");
  lines.push("## 1. Source component inventory (reference)");
  lines.push("");
  lines.push("| MVP surface | Reference source (exists?) | Expected-value probes | Candidate owner |");
  lines.push("|---|---|---|---|");
  for (const entry of inventory) {
    const refs = entry.ref.map((r) => `${r.file}${r.exists ? "" : " (NOT FOUND)"}`).join("<br>");
    const probes = entry.ref.flatMap((r) => r.matches).slice(0, 3).join("<br>") || "—";
    lines.push(`| ${entry.label} | ${refs} | ${probes} | ${(entry.candFiles ?? []).join("<br>")} |`);
  }
  lines.push("");
  lines.push("Exact source components per surface (`<dir>`: first files, tests last):");
  lines.push("");
  for (const entry of inventory) {
    lines.push(`- ${entry.label} — \`${entry.refDir ?? "(no dir)"}\`: ${(entry.dirListing ?? []).slice(0, 14).join(", ")}`);
  }
  lines.push("");
  lines.push("Reference token anchors (`src/renderer/src/assets/main.css`): `--app-font-family: 'Geist', …`, `--font-mono: 'SF Mono', …`, `--radius: 0.625rem`, monochrome roles (`background/foreground`, `sidebar/*`, `muted`, `accent`, `border`, `ring`), git decoration tokens; see `docs/STYLEGUIDE.md` for roles. Candidate must adopt the same variables in `apps/desktop/src/renderer/src/assets/main.css`.");
  lines.push("");
  lines.push("## 2. Per-state results");
  lines.push("");
  for (const r of stateResults) {
    lines.push(`### ${r.state}`);
    lines.push("");
    if (r.diff) {
      const { aria, geom, headline, pixel } = r.diff;
      lines.push(`- ARIA: ref ${aria.refLines} lines vs cand ${aria.candLines} lines — missing ${aria.missing.length}, added ${aria.added.length}, changed ${aria.changed.length}.`);
      for (const scheme of ["light", "dark"]) {
        const value = pixel?.[scheme];
        if (value?.percent != null) {
          lines.push(`- Pixel diff (${scheme}, threshold >12/255): ${value.percent}% changed (${value.changedPixels}/${value.comparedPixels}); mean channel delta ${value.meanDelta}; ${value.dimensions}.`);
        }
      }
      for (const [region, dd] of Object.entries(geom)) {
        if (!dd || dd.missing) {
          lines.push(`- Geometry ${region}: not measurable on ${!dd ? "both" : "one"} side(s) (ref sel ${dd?.refSel ?? "—"}, cand sel ${dd?.candSel ?? "—"}).`);
        } else {
          lines.push(`- Geometry ${region}: ref ${dd.refW}x${dd.refH} @(${dd.refSel}) vs cand ${dd.candW}x${dd.candH} @(${dd.candSel}) — Δw ${dd.dw}, Δh ${dd.dh}, Δx ${dd.dx}, Δy ${dd.dy}.`);
        }
      }
      if (headline) lines.push(`- Headline: ref "${headline.refText}" ${headline.refSize}/${headline.refWeight} ${headline.refFont} vs cand "${headline.candText}" ${headline.candSize}/${headline.candWeight} ${headline.candFont}.`);
      for (const c of aria.changed.slice(0, 8)) lines.push(`  - text: ref "${c.ref.slice(0, 120)}" → cand "${c.cand.slice(0, 120)}"`);
      for (const m of aria.missing.slice(0, 6)) lines.push(`  - ref-only: "${m.slice(0, 120)}"`);
      for (const a of aria.added.slice(0, 6)) lines.push(`  - cand-only: "${a.slice(0, 120)}"`);
    } else {
      lines.push("- No light-scheme pair captured on both sides; see missing notes.");
    }
    if (r.refNotes.length) lines.push(md(r.refNotes.map((n) => `ref note: ${n}`)));
    if (r.refMissing.length) lines.push(md(r.refMissing.map((n) => `ref MISSING: ${n}`)));
    if (r.candNotes.length) lines.push(md(r.candNotes.map((n) => `cand note: ${n}`)));
    if (r.candMissing.length) lines.push(md(r.candMissing.map((n) => `cand MISSING: ${n}`)));
    lines.push("");
  }
  lines.push("## 3. Ranked differences (top 30 by user visibility)");
  lines.push("");
  lines.push("Layout regions first, then typography, then copy/icons, then interactions. `both` = confirmed by source reading AND rendered comparison; `rendered-only` = seen rendered, source value to adopt is cited from the inventory file.");
  lines.push("");
  ranked.forEach((item, i) => {
    lines.push(`### ${i + 1}. [${item.area}] [${item.evidence}] ${item.title}`);
    lines.push("");
    lines.push(`- State: ${item.state}. Kind: ${item.detail.kind}.`);
    lines.push(`- Source (adopt this): \`${item.sourceFile}\` — ${item.sourceValue}`);
    lines.push(`- Candidate file to change: \`${item.candidateFile}\``);
    if (item.detail.text) lines.push(`- Detail: "${String(item.detail.text).slice(0, 200)}"`);
    if (item.detail.kind === "geometry") lines.push(`- Detail: Δw ${item.detail.dw}px, Δh ${item.detail.dh}px, Δx ${item.detail.dx}px, Δy ${item.detail.dy}px.`);
    if (item.detail.kind === "text") lines.push(`- Detail: ref "${String(item.detail.ref).slice(0, 160)}" vs cand "${String(item.detail.cand).slice(0, 160)}".`);
    lines.push("");
  });
  if (!ranked.length) {
    lines.push("No differences recorded (both sides identical or nothing measurable — treat with suspicion, see §2).");
    lines.push("");
  }
  lines.push("## 4. Artifacts");
  lines.push("");
  lines.push(`- \`.preflight/fidelity/<run>/<state>.{ref,cand}.{png,aria.yaml,dom.json}\` (+ \`.dark.*\`, \`statusbar-strip.*.strip.png\`). PNG/HTML stay git-ignored; only this report.md is committed.`);
  lines.push("- `index.html` (ignored): side-by-side viewer for this run.");
  lines.push(`- Run dir: ${outDir}`);
  lines.push("");
  return lines.join("\n");
}

function renderIndex(states) {
  const rows = states
    .map((s) => {
      const cell = (side, dark) =>
        `<td><div>${s}.${side}${dark ? ".dark" : ""}</div><a href="${s}.${side}${dark ? ".dark" : ""}.png"><img loading="lazy" style="max-width:100%" src="${s}.${side}${dark ? ".dark" : ""}.png"></a><div><a href="${s}.${side}${dark ? ".dark" : ""}.aria.yaml">aria</a> · <a href="${s}.${side}${dark ? ".dark" : ""}.dom.json">dom</a></div></td>`;
      return `<tr><th>${s}</th>${cell("ref", false)}${cell("cand", false)}</tr>` +
        (NO_DARK ? "" : `<tr><th>${s} (dark)</th>${cell("ref", true)}${cell("cand", true)}</tr>`);
    })
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>fidelity run</title></head><body><h1>fidelity run (ref vs cand)</h1><table border="1" cellpadding="8"><tr><th>state</th><th>ref</th><th>cand</th></tr>${rows}</table></body></html>\n`;
}

await main().catch((error) => {
  console.error(`FIDELITY FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});

