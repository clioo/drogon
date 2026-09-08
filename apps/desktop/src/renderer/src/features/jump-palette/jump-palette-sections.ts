/* MIT Copyright (c) 2026 Lovecast Inc.
 * Section projection ported from the read-only reference
 * `use-worktree-jump-palette-{sections,list-entries}.ts`: section order
 * (recent tabs, worktrees grouped by project, open browser tabs, quick
 * actions, create-worktree row), empty-query caps and the overflow trim.
 * Pure: all inputs are plain data so the projection is unit-testable.
 */
import type {
  AgentState,
  Session,
} from "../../../../shared/session-contract";
import { editorTabLabel, type EditorTabState } from "../shell/editor-tab";
import type { ProjectGroup } from "../shell/project-adapter";
import type { BrowserTabState } from "../../../../shared/browser-contract";
import { rankJumpRows } from "./jump-palette-filter";
import {
  EMPTY_QUERY_RECENT_TAB_CAP,
  EMPTY_QUERY_ROW_BUDGET,
  EMPTY_QUERY_WORKTREE_CAP,
  JUMP_LABELS,
  JUMP_SECTION_RENDER_CAP,
  type JumpBrowserTab,
  type JumpEditorTab,
  type JumpItem,
  type JumpQuickAction,
  type JumpQuickActionId,
  type JumpSection,
  type JumpTab,
  type JumpWorktree,
} from "./jump-palette-model";

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

/** Agent rollup over one worktree's sessions for the status dot. */
export function rollupAgentState(states: readonly AgentState[]): AgentState | null {
  if (states.length === 0) return null;
  if (states.includes("working")) return "working";
  if (states.includes("needs_input")) return "needs_input";
  if (states.includes("idle")) return "idle";
  if (states.includes("unknown")) return "unknown";
  return "exited";
}

export function sessionTitle(session: Session): string {
  const command = session.command.trim();
  return command === "" ? session.id : command;
}

export function buildJumpTabs(
  sessions: readonly Session[],
  activeSessionId: string,
): JumpTab[] {
  return sessions.map((session) => ({
    id: session.id,
    workspaceId: session.workspaceId,
    title: sessionTitle(session),
    agentState: session.agentState ?? "unknown",
    isActive: session.id === activeSessionId,
  }));
}

export function buildJumpWorktrees(
  groups: readonly ProjectGroup[],
  sessions: readonly Session[],
  selectedWorkspaceId: string,
): JumpWorktree[] {
  const statesByWorkspace = new Map<string, AgentState[]>();
  for (const session of sessions) {
    const list = statesByWorkspace.get(session.workspaceId) ?? [];
    list.push(session.agentState ?? "unknown");
    statesByWorkspace.set(session.workspaceId, list);
  }
  const rows: JumpWorktree[] = [];
  for (const group of groups) {
    for (const worktree of group.worktrees) {
      const states = statesByWorkspace.get(worktree.workspaceId) ?? [];
      const branch = worktree.branch;
      rows.push({
        id: worktree.id,
        workspaceId: worktree.workspaceId,
        projectId: group.project.id,
        projectName: group.project.name,
        projectKind: group.project.kind,
        branch,
        name: branch !== "" ? branch : basename(worktree.path),
        agentState: rollupAgentState(states),
        sessionCount: states.length,
        isCurrent: worktree.workspaceId === selectedWorkspaceId,
      });
    }
  }
  // Grouped by project: rows sort under their project heading order.
  rows.sort((a, b) =>
    a.projectName.localeCompare(b.projectName, undefined, {
      sensitivity: "base",
    }) ||
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  return rows;
}

/**
 * Editor tabs for the jump palette, in strip order. Like the source's
 * workspace-tab rows, open files sit with the terminal tabs: the caller
 * passes the current workspace's tabs (the same set the strip renders).
 */
export function buildJumpEditorTabs(
  tabs: readonly EditorTabState[],
  activeEditorTabId: string | null,
): JumpEditorTab[] {
  return tabs.map((tab) => ({
    tabId: tab.tabId,
    workspaceId: tab.workspaceId,
    path: tab.path,
    name: editorTabLabel(tab.path),
    dirty: tab.dirty,
    isActive: tab.tabId === activeEditorTabId,
  }));
}

export function buildJumpBrowserTabs(
  tabs: readonly BrowserTabState[],
  activeBrowserTabId: string | null,
): JumpBrowserTab[] {
  return tabs.map((tab) => ({
    tabId: tab.tabId,
    workspaceId: tab.workspaceId,
    title: tab.title.trim() === "" ? tab.url : tab.title,
    url: tab.url,
    loading: tab.loading,
    isActive: tab.tabId === activeBrowserTabId,
  }));
}

export interface JumpActionAvailability {
  canCreateWorktree: boolean;
  canNewTerminal: boolean;
  canNewBrowserTab: boolean;
  canAddProject: boolean;
}

const ALL_QUICK_ACTIONS: ReadonlyArray<{
  id: JumpQuickActionId;
  title: string;
  description: string;
  available: (flags: JumpActionAvailability) => boolean;
}> = [
  {
    id: "worktree.new",
    title: "Create Worktree",
    description: "Create a worktree in a git project",
    available: (flags) => flags.canCreateWorktree,
  },
  {
    id: "terminal.new",
    title: "New Terminal Tab",
    description: "Open a terminal in the current workspace",
    available: (flags) => flags.canNewTerminal,
  },
  {
    id: "browser.new",
    title: "New Browser Tab",
    description: "Open a browser tab in the current workspace",
    available: (flags) => flags.canNewBrowserTab,
  },
  {
    id: "project.add",
    title: "Add Project",
    description: "Add a repository or folder project",
    available: (flags) => flags.canAddProject,
  },
  {
    id: "settings.open",
    title: "Open settings",
    description: "Preferences and shortcuts",
    available: () => true,
  },
];

export function buildJumpQuickActions(
  flags: JumpActionAvailability,
): JumpQuickAction[] {
  return ALL_QUICK_ACTIONS.filter((action) => action.available(flags)).map(
    ({ id, title, description }) => ({ id, title, description }),
  );
}

export interface JumpSectionsInput {
  tabs: readonly JumpTab[];
  editorTabs: readonly JumpEditorTab[];
  worktrees: readonly JumpWorktree[];
  browserTabs: readonly JumpBrowserTab[];
  quickActions: readonly JumpQuickAction[];
  query: string;
  canCreateWorktree: boolean;
}

export interface JumpSectionsResult {
  sections: JumpSection[];
  /** Non-null when the create-worktree-from-query row shows. */
  createWorktreeName: string | null;
  resultCount: number;
}

function tabHaystack(tab: JumpTab): readonly string[] {
  return [tab.title];
}

function worktreeHaystack(worktree: JumpWorktree): readonly string[] {
  return [worktree.name, worktree.branch, worktree.projectName];
}

function browserHaystack(tab: JumpBrowserTab): readonly string[] {
  return [tab.title, tab.url];
}

function actionHaystack(action: JumpQuickAction): readonly string[] {
  return [action.title, action.description];
}

function editorHaystack(tab: JumpEditorTab): readonly string[] {
  return [tab.name, tab.path];
}

type TabPoolEntry =
  | { kind: "tab"; tab: JumpTab; haystack: readonly string[] }
  | { kind: "editor-tab"; tab: JumpEditorTab; haystack: readonly string[] };

/**
 * Sessions and open files share the tab sections, like the source's
 * workspace-tab rows (terminal and editor content in one list). Sessions
 * lead ties: they precede editor tabs in the pool and the rank is stable.
 */
function tabPool(
  tabs: readonly JumpTab[],
  editorTabs: readonly JumpEditorTab[],
): TabPoolEntry[] {
  return [
    ...tabs.map((tab) => ({ kind: "tab" as const, tab, haystack: tabHaystack(tab) })),
    ...editorTabs.map((tab) => ({
      kind: "editor-tab" as const,
      tab,
      haystack: editorHaystack(tab),
    })),
  ];
}

function isPoolEntryActive(entry: TabPoolEntry): boolean {
  return entry.tab.isActive;
}

function toTabItem(entry: TabPoolEntry): JumpItem {
  return entry.kind === "tab"
    ? { kind: "tab", tab: entry.tab }
    : { kind: "editor-tab", tab: entry.tab };
}

/**
 * Projects palette sections in source order. Empty query shows recent
 * tabs (active first) and recent worktrees under their caps; a typed
 * query filters every section and appends the create-worktree row when
 * the query names something new.
 */
export function projectJumpSections(input: JumpSectionsInput): JumpSectionsResult {
  const { tabs, editorTabs, worktrees, browserTabs, quickActions, query } = input;
  const hasQuery = query.trim() !== "";
  const sections: JumpSection[] = [];

  if (hasQuery) {
    const visibleTabs = rankJumpRows(tabPool(tabs, editorTabs), (entry) => entry.haystack, query).slice(
      0,
      JUMP_SECTION_RENDER_CAP,
    );
    if (visibleTabs.length > 0) {
      sections.push({
        id: "recent-tabs",
        label: JUMP_LABELS.openTabsQuery,
        items: visibleTabs.map(toTabItem),
      });
    }
    const visibleWorktrees = rankJumpRows(worktrees, worktreeHaystack, query).slice(
      0,
      JUMP_SECTION_RENDER_CAP,
    );
    if (visibleWorktrees.length > 0) {
      sections.push({
        id: "worktrees",
        label: JUMP_LABELS.worktreesQuery,
        items: visibleWorktrees.map((worktree) => ({
          kind: "worktree" as const,
          worktree,
        })),
      });
    }
    const visibleBrowser = rankJumpRows(browserTabs, browserHaystack, query).slice(
      0,
      JUMP_SECTION_RENDER_CAP,
    );
    if (visibleBrowser.length > 0) {
      sections.push({
        id: "open-tabs",
        label: JUMP_LABELS.browserTabs,
        items: visibleBrowser.map((tab) => ({
          kind: "browser-tab" as const,
          tab,
        })),
      });
    }
    const visibleActions = rankJumpRows(quickActions, actionHaystack, query);
    if (visibleActions.length > 0) {
      sections.push({
        id: "quick-actions",
        label: JUMP_LABELS.actionsSettings,
        items: visibleActions.map((action) => ({
          kind: "quick-action" as const,
          action,
        })),
      });
    }
    const trimmed = query.trim();
    const exactWorktree = worktrees.some(
      (worktree) =>
        worktree.name.toLowerCase() === trimmed.toLowerCase() ||
        worktree.branch.toLowerCase() === trimmed.toLowerCase(),
    );
    const createWorktreeName =
      input.canCreateWorktree && trimmed !== "" && !exactWorktree ? trimmed : null;
    const resultCount =
      visibleTabs.length +
      visibleWorktrees.length +
      visibleBrowser.length +
      visibleActions.length;
    return { sections, createWorktreeName, resultCount };
  }

  // Empty query: recent tabs first (active tab leads), then worktrees.
  // Open files follow sessions, active first within each kind — one
  // shared recent cap.
  const recentPool = tabPool(tabs, editorTabs);
  const activeFirst = [...recentPool].sort((a, b) => {
    const kindOrder = Number(a.kind === "editor-tab") - Number(b.kind === "editor-tab");
    return (
      kindOrder ||
      Number(isPoolEntryActive(b)) - Number(isPoolEntryActive(a))
    );
  });
  const visibleTabs = activeFirst.slice(0, EMPTY_QUERY_RECENT_TAB_CAP);
  if (visibleTabs.length > 0) {
    sections.push({
      id: "recent-tabs",
      label: JUMP_LABELS.recentTabs,
      items: visibleTabs.map(toTabItem),
    });
  }
  const worktreeCap = Math.min(
    visibleTabs.length === 0 ? EMPTY_QUERY_ROW_BUDGET : EMPTY_QUERY_WORKTREE_CAP,
    Math.max(1, EMPTY_QUERY_ROW_BUDGET - visibleTabs.length),
  );
  const visibleWorktrees = worktrees.slice(0, worktreeCap);
  if (visibleWorktrees.length > 0) {
    sections.push({
      id: "worktrees",
      label: JUMP_LABELS.recentWorktrees,
      items: visibleWorktrees.map((worktree) => ({
        kind: "worktree" as const,
        worktree,
      })),
    });
  }
  const visibleBrowser = browserTabs.slice(0, JUMP_SECTION_RENDER_CAP);
  if (visibleBrowser.length > 0) {
    sections.push({
      id: "open-tabs",
      label: JUMP_LABELS.browserTabs,
      items: visibleBrowser.map((tab) => ({
        kind: "browser-tab" as const,
        tab,
      })),
    });
  }
  if (quickActions.length > 0) {
    sections.push({
      id: "quick-actions",
      label: JUMP_LABELS.actionsSettings,
      items: quickActions.map((action) => ({
        kind: "quick-action" as const,
        action,
      })),
    });
  }
  const resultCount =
    visibleTabs.length + visibleWorktrees.length + visibleBrowser.length + quickActions.length;
  return { sections, createWorktreeName: null, resultCount };
}
