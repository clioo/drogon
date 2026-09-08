/* MIT Copyright (c) 2026 Lovecast Inc.
 * Ports the section order, caps and copy of the read-only reference
 * `src/renderer/src/components/WorktreeJumpPalette.tsx`,
 * `worktree-jump-palette-surface.tsx`, `worktree-jump-palette-model.ts`,
 * `worktree-jump-palette-empty-state.ts` and
 * `use-worktree-jump-palette-{sections,list-entries}.ts`, adapted to this
 * repo's contracts: projects/worktrees come from the shell ProjectGroup
 * projection, tabs from sessions with agentState, browser tabs from the
 * browser bridge. Linear/Jira/task-url rows, simulator rows and the filter
 * menu are not ported (out of MVP scope).
 */
import type { AgentState } from "../../../../shared/session-contract";

/** One open terminal/chat tab (a live session) in the palette. */
export interface JumpTab {
  id: string;
  workspaceId: string;
  title: string;
  agentState: AgentState;
  isActive: boolean;
}

/** One worktree row, already joined to its owning project. */
export interface JumpWorktree {
  id: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  projectKind: "git" | "folder";
  /** Branch label ("" for plain folders); shown dimmed after the name. */
  branch: string;
  /** Display name: branch for git worktrees, folder name otherwise. */
  name: string;
  /** Agent rollup over the worktree's sessions; null when it has none. */
  agentState: AgentState | null;
  sessionCount: number;
  isCurrent: boolean;
}

/** One open editor tab (an open file in the main tab group) in the palette. */
export interface JumpEditorTab {
  tabId: string;
  workspaceId: string;
  /** Workspace-relative path; the row shows the name with this dimmed. */
  path: string;
  /** Tab-strip label: the base name, matching the fork's editor tabs. */
  name: string;
  dirty: boolean;
  isActive: boolean;
}

/** One open browser tab in the palette. */
export interface JumpBrowserTab {
  tabId: string;
  workspaceId: string;
  title: string;
  url: string;
  loading: boolean;
  isActive: boolean;
}

/** Quick-action ids the source palette offers and Drogon implements. */
export type JumpQuickActionId =
  | "worktree.new"
  | "terminal.new"
  | "browser.new"
  | "project.add"
  | "settings.open";

export interface JumpQuickAction {
  id: JumpQuickActionId;
  title: string;
  description: string;
}

export type JumpSectionId =
  | "recent-tabs"
  | "worktrees"
  | "open-tabs"
  | "quick-actions";

export interface JumpSection {
  id: JumpSectionId;
  /** Source section copy. */
  label: string;
  items: JumpItem[];
}

export type JumpItem =
  | { kind: "tab"; tab: JumpTab }
  | { kind: "editor-tab"; tab: JumpEditorTab }
  | { kind: "worktree"; worktree: JumpWorktree }
  | { kind: "browser-tab"; tab: JumpBrowserTab }
  | { kind: "quick-action"; action: JumpQuickAction }
  | { kind: "create-worktree"; name: string };

export function jumpItemId(item: JumpItem): string {
  switch (item.kind) {
    case "tab":
      return `tab:${item.tab.id}`;
    case "editor-tab":
      return `editor-tab:${item.tab.tabId}`;
    case "worktree":
      return `worktree:${item.worktree.id}`;
    case "browser-tab":
      return `browser-tab:${item.tab.tabId}`;
    case "quick-action":
      return `action:${item.action.id}`;
    case "create-worktree":
      return "create-worktree";
  }
}

/** Source caps (`worktree-jump-palette-model.ts`). */
export const EMPTY_QUERY_RECENT_TAB_CAP = 6;
export const EMPTY_QUERY_WORKTREE_CAP = 5;
export const EMPTY_QUERY_ROW_BUDGET = 10;
export const JUMP_SECTION_RENDER_CAP = 50;

/** Source section copy. */
export const JUMP_LABELS = {
  recentTabs: "Recent Chats & Terminals",
  openTabsQuery: "Open Tabs",
  recentWorktrees: "Recent Worktrees",
  worktreesQuery: "Worktrees",
  browserTabs: "Open Tabs",
  actionsSettings: "Actions & Settings",
  paletteTitle: "Jump to...",
  paletteDescription: "Search chats, terminals, worktrees, settings, and actions",
  inputPlaceholder: "Search chats, terminals, worktrees, settings, and actions...",
  emptyNoResultsTitle: "No results match your search",
  emptyNoResultsSubtitle:
    "Try a worktree, project, setting, action, tab title, agent prompt, or URL.",
  emptyNothingTitle: "No active worktrees, settings, actions, or open tabs",
  emptyNothingSubtitle: "Create a worktree or open a tab in Drogon to get started.",
  createWorktreePrefix: "Create worktree",
} as const;

/** Status-dot copy for agent states (source `palette-live-status`). */
export function jumpAgentStatusLabel(state: AgentState): string {
  switch (state) {
    case "working":
      return "Agent working";
    case "needs_input":
      return "Agent waiting for input";
    case "idle":
      return "Agent idle";
    case "exited":
      return "Session ended";
    case "unknown":
      return "Agent status unknown";
  }
}
