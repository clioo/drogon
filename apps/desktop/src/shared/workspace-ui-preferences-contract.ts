/* MIT Copyright (c) 2026 Lovecast Inc. Shared Workspace Options module/RPC
   contract (see the proposal sent to the coordinator for the upcoming
   controlled-props Kanban run to build against). Persists the Workspace
   Options subset of the reference's `PersistedUIState`
   (persistence-contracts/persisted-ui-state-types.ts, already ported
   wholesale as a type by the Kanban-preparation scaffold) through a real
   main-process-owned JSON file (main/workspace-ui-preferences.ts,
   window-state.ts's own pattern) instead of the reduced worker's
   shell-only localStorage model. `Pick`s the field set straight off that
   shared type rather than redeclaring parallel enums/fields -- root has
   approved that source's semantics and this module must not invent
   alternates. */
import type { PersistedUIState } from "./persistence-contracts/persisted-ui-state-types";

export type WorkspaceUIPreferences = Pick<
  PersistedUIState,
  | "groupBy"
  | "sortBy"
  | "projectOrderBy"
  | "hideSleepingWorkspaces"
  | "hideDefaultBranchWorkspace"
  | "hideDetachedHeadWorkspaces"
  | "hideAutomationGeneratedWorkspaces"
  | "hideCliCreatedWorkspaces"
  | "worktreeCardProperties"
  | "agentActivityDisplayMode"
  | "_expandedWorktreeCardPropertiesDefaulted"
  | "workspaceStatuses"
  | "workspaceBoardOpacity"
  | "workspaceBoardColumnWidth"
  | "syncTaskStatusFromWorkspaceBoard"
  | "_workspaceStatusesDefaultOrderMigrated"
  | "_workspaceStatusesReorderedDefaultRepaired"
  | "_workspaceStatusesDefaultWorkflowMigrated"
  | "_workspaceStatusesDefaultVisualsMigrated"
> & {
  /** Workspace Options "Card layout". Not part of the pinned
   *  `PersistedUIState` scaffold (the reference has no density-toggle
   *  equivalent in this contract) -- a genuine Drogon-local addition to
   *  the shared store, so it lives in the SAME single authority as every
   *  other Workspace Options field rather than a second, private
   *  localStorage-only preference. */
  cardLayout: "comfortable" | "compact";
};

export type WorkspaceUIPreferencesBridge = {
  /** Reads the current preferences, hydrating/migrating on first read. */
  get(): Promise<WorkspaceUIPreferences>;
  /** Merges a partial update and persists it; returns the full, merged
   *  and normalized state (mirrors `window.api.ui.set`'s contract). */
  set(partial: Partial<WorkspaceUIPreferences>): Promise<WorkspaceUIPreferences>;
};

// Optional like the granted `git`/`notifications`/`jira` namespaces
// (supplied at runtime by preload via Object.assign, never constructed in
// the bridge literal), so older preloads without it keep typechecking.
declare module "./session-contract" {
  interface DesktopBridge {
    ui?: WorkspaceUIPreferencesBridge;
  }
}
