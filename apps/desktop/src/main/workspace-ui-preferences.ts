/* MIT Copyright (c) 2026 Lovecast Inc. Shared Workspace Options UI
   preferences: real, main-process-owned JSON persistence (window-state.ts's
   own pattern -- a debounce-free, synchronous JSON file under
   app.getPath("userData")), replacing the reduced worker's shell-only
   localStorage model. `Pick`s its shape straight off the shared
   `PersistedUIState` contract (persistence-contracts/persisted-ui-state-types.ts)
   via workspace-ui-preferences-contract.ts -- root has approved that
   source's semantics, so this module never invents alternate enums. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { WorkspaceUIPreferences } from "../shared/workspace-ui-preferences-contract";
import {
  cloneDefaultWorkspaceStatuses,
  clampWorkspaceBoardColumnWidth,
  clampWorkspaceBoardOpacity,
  normalizePersistedWorkspaceStatuses,
  WORKSPACE_BOARD_COLUMN_WIDTH_DEFAULT,
} from "../shared/workspace-statuses";
import type { WorktreeCardProperty } from "../shared/persistence-contracts/ui-chrome-types";
import { DEFAULT_WORKTREE_CARD_PROPERTIES, normalizeWorktreeCardProperties as normalizeSourceCardProperties } from "../shared/worktree/card-properties";

export const WORKSPACE_UI_PREFERENCES_FILE_NAME = "workspace-ui-preferences.json";

const GROUP_BY_VALUES = ["none", "workspace-status", "repo", "pr-status"] as const;
const SORT_BY_VALUES = ["name", "smart", "recent", "repo", "manual"] as const;
const PROJECT_ORDER_BY_VALUES = ["manual", "recent"] as const;
const CARD_LAYOUT_VALUES = ["comfortable", "compact"] as const;

export const DEFAULT_WORKSPACE_UI_PREFERENCES: WorkspaceUIPreferences = {
  groupBy: "repo",
  sortBy: "recent",
  projectOrderBy: "manual",
  cardLayout: "comfortable",
  hideSleepingWorkspaces: false,
  hideDefaultBranchWorkspace: false,
  hideDetachedHeadWorkspaces: false,
  hideAutomationGeneratedWorkspaces: false,
  hideCliCreatedWorkspaces: false,
  worktreeCardProperties: [...DEFAULT_WORKTREE_CARD_PROPERTIES],
  agentActivityDisplayMode: "compact",
  _expandedWorktreeCardPropertiesDefaulted: true,
  workspaceStatuses: cloneDefaultWorkspaceStatuses(),
  workspaceBoardOpacity: 1,
  workspaceBoardColumnWidth: WORKSPACE_BOARD_COLUMN_WIDTH_DEFAULT,
  syncTaskStatusFromWorkspaceBoard: false,
  // A fresh profile has nothing to migrate, so every one-shot stamp is
  // already true in steady state -- `normalizeWorkspaceUIPreferences`
  // always returns them true (each migration/repair option either ran or
  // correctly no-op'd), so this is the value `get()` actually converges
  // to, not merely a nominal "unstamped" placeholder.
  _workspaceStatusesDefaultOrderMigrated: true,
  _workspaceStatusesReorderedDefaultRepaired: true,
  _workspaceStatusesDefaultWorkflowMigrated: true,
  _workspaceStatusesDefaultVisualsMigrated: true,
};

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function normalizeGroupBy(value: unknown): WorkspaceUIPreferences["groupBy"] {
  return (GROUP_BY_VALUES as readonly unknown[]).includes(value)
    ? (value as WorkspaceUIPreferences["groupBy"])
    : DEFAULT_WORKSPACE_UI_PREFERENCES.groupBy;
}

function normalizeSortBy(value: unknown): WorkspaceUIPreferences["sortBy"] {
  return (SORT_BY_VALUES as readonly unknown[]).includes(value)
    ? (value as WorkspaceUIPreferences["sortBy"])
    : DEFAULT_WORKSPACE_UI_PREFERENCES.sortBy;
}

function normalizeProjectOrderBy(value: unknown): WorkspaceUIPreferences["projectOrderBy"] {
  return (PROJECT_ORDER_BY_VALUES as readonly unknown[]).includes(value)
    ? (value as WorkspaceUIPreferences["projectOrderBy"])
    : DEFAULT_WORKSPACE_UI_PREFERENCES.projectOrderBy;
}

function normalizeCardLayout(value: unknown): WorkspaceUIPreferences["cardLayout"] {
  return (CARD_LAYOUT_VALUES as readonly unknown[]).includes(value)
    ? (value as WorkspaceUIPreferences["cardLayout"])
    : DEFAULT_WORKSPACE_UI_PREFERENCES.cardLayout;
}

function normalizeWorktreeCardProperties(value: unknown): WorktreeCardProperty[] {
  return normalizeSourceCardProperties(Array.isArray(value) ? value : undefined);
}

/**
 * Merges a possibly-partial/stale stored envelope onto the defaults,
 * field by field (a future release adding a field never resets a user's
 * existing choices for fields that already existed), and applies the
 * `workspace-statuses.ts` one-shot migrations gated on their own stamps --
 * each stamp is set once it has had the chance to fire, exactly like the
 * reference's own hydration, never re-run once true.
 */
export function normalizeWorkspaceUIPreferences(raw: unknown): WorkspaceUIPreferences {
  const state = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const limitedMenuProfile = state._expandedWorktreeCardPropertiesDefaulted !== true
    && Array.isArray(state.worktreeCardProperties)
    && state.worktreeCardProperties.every((id) => id === "branch" || id === "pr" || id === "issue");
  let properties = normalizeWorktreeCardProperties(state.worktreeCardProperties);
  if (limitedMenuProfile) {
    // The old menu never controlled these properties; preserve the Notes and
    // agent rows it always rendered without restoring a user's unchecked PR/Branch.
    properties = state.cardLayout === "compact" ? normalizeSourceCardProperties(["status"])
      : normalizeSourceCardProperties([...properties, ...DEFAULT_WORKTREE_CARD_PROPERTIES.filter((id) => id !== "pr")]);
  }
  const reorderedRepaired = isBoolean(state._workspaceStatusesReorderedDefaultRepaired)
    ? state._workspaceStatusesReorderedDefaultRepaired
    : false;
  const workflowMigrated = isBoolean(state._workspaceStatusesDefaultWorkflowMigrated)
    ? state._workspaceStatusesDefaultWorkflowMigrated
    : false;
  const visualsMigrated = isBoolean(state._workspaceStatusesDefaultVisualsMigrated)
    ? state._workspaceStatusesDefaultVisualsMigrated
    : false;

  return {
    groupBy: normalizeGroupBy(state.groupBy),
    sortBy: normalizeSortBy(state.sortBy),
    projectOrderBy: normalizeProjectOrderBy(state.projectOrderBy),
    cardLayout: normalizeCardLayout(state.cardLayout),
    agentActivityDisplayMode: state.agentActivityDisplayMode === "full" || state.agentActivityDisplayMode === "compact"
      ? state.agentActivityDisplayMode : limitedMenuProfile ? "full" : "compact",
    _expandedWorktreeCardPropertiesDefaulted: true,
    hideSleepingWorkspaces: isBoolean(state.hideSleepingWorkspaces)
      ? state.hideSleepingWorkspaces
      : DEFAULT_WORKSPACE_UI_PREFERENCES.hideSleepingWorkspaces,
    hideDefaultBranchWorkspace: isBoolean(state.hideDefaultBranchWorkspace)
      ? state.hideDefaultBranchWorkspace
      : DEFAULT_WORKSPACE_UI_PREFERENCES.hideDefaultBranchWorkspace,
    hideDetachedHeadWorkspaces: isBoolean(state.hideDetachedHeadWorkspaces)
      ? state.hideDetachedHeadWorkspaces
      : DEFAULT_WORKSPACE_UI_PREFERENCES.hideDetachedHeadWorkspaces,
    hideAutomationGeneratedWorkspaces: isBoolean(state.hideAutomationGeneratedWorkspaces)
      ? state.hideAutomationGeneratedWorkspaces
      : DEFAULT_WORKSPACE_UI_PREFERENCES.hideAutomationGeneratedWorkspaces,
    hideCliCreatedWorkspaces: isBoolean(state.hideCliCreatedWorkspaces)
      ? state.hideCliCreatedWorkspaces
      : DEFAULT_WORKSPACE_UI_PREFERENCES.hideCliCreatedWorkspaces,
    worktreeCardProperties: properties,
    workspaceStatuses: normalizePersistedWorkspaceStatuses(state.workspaceStatuses, {
      migrateDefaultWorkflowStatuses: !workflowMigrated,
      repairReorderedDefaultStatuses: !reorderedRepaired,
      migrateLegacyDefaultStatusVisuals: !visualsMigrated,
    }),
    workspaceBoardOpacity: clampWorkspaceBoardOpacity(state.workspaceBoardOpacity),
    workspaceBoardColumnWidth: clampWorkspaceBoardColumnWidth(state.workspaceBoardColumnWidth),
    syncTaskStatusFromWorkspaceBoard: isBoolean(state.syncTaskStatusFromWorkspaceBoard)
      ? state.syncTaskStatusFromWorkspaceBoard
      : DEFAULT_WORKSPACE_UI_PREFERENCES.syncTaskStatusFromWorkspaceBoard,
    // All four stamp true after this hydration, whatever they were before:
    // each one-shot migration/repair option above ran (or correctly
    // no-op'd, gated on its OWN prior stamp) exactly once on the way here,
    // so retrying it on a later hydration would never be correct --
    // matches the reference's "once stamped, never re-inferred" contract
    // for every one of the four (see persisted-ui-state-types.ts's own
    // field docs). Drogon has no pre-v1 legacy payloads of its own, so in
    // practice every stamp goes true on this profile's very first
    // hydration; the gating still protects a future profile carrying an
    // imported/ported payload that predates these stamps.
    _workspaceStatusesDefaultOrderMigrated: true,
    _workspaceStatusesReorderedDefaultRepaired: true,
    _workspaceStatusesDefaultWorkflowMigrated: true,
    _workspaceStatusesDefaultVisualsMigrated: true,
  };
}

export class WorkspaceUIPreferencesStore {
  /** Null means memory-only (tests); otherwise the JSON file path. */
  readonly #file: string | null;
  #state: WorkspaceUIPreferences;

  constructor(file: string | null) {
    this.#file = file;
    this.#state = normalizeWorkspaceUIPreferences(this.#read());
    this.#persist();
  }

  #read(): unknown {
    if (!this.#file) return {};
    try {
      return JSON.parse(readFileSync(this.#file, "utf8"));
    } catch {
      return {};
    }
  }

  #persist(): void {
    if (!this.#file) return;
    try {
      mkdirSync(dirname(this.#file), { recursive: true });
      writeFileSync(this.#file, JSON.stringify(this.#state, null, 2));
    } catch (error) {
      console.error("[workspace-ui-preferences] Failed to persist:", error);
    }
  }

  get(): WorkspaceUIPreferences {
    return { ...this.#state };
  }

  set(partial: Partial<WorkspaceUIPreferences>): WorkspaceUIPreferences {
    this.#state = normalizeWorkspaceUIPreferences({ ...this.#state, ...partial });
    this.#persist();
    return this.get();
  }
}
