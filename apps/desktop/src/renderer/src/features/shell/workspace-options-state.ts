/* MIT Copyright (c) 2026 Lovecast Inc.
   User-feature-closure item 4: the "Workspace options" reference menu
   (sidebar-options-show.ts's own doc comment: "Sort by / Project order /
   card display / workspace filters ride sort/group/display stores the MVP
   lacks; they are listed as not-ported in the PR") gains real, persisted
   controls here — Group by, Sort by, Card layout, Show properties, and the
   hide-* filters. Every control here acts on data this repo actually has:
   Group by None/Project (no PR/Status tracking exists anywhere in this
   renderer to group by — adding those options without real data would be
   exactly the inert mock UI the task forbids), Sort by Name/Recent/Manual,
   hide Default branch and hide Detached HEAD (derived from
   Worktree.branch/Project.defaultBaseRef), hide Sleeping (derived from
   Session.verdict). "automation-created"/"CLI-created" have no daemon-side
   provenance column (grep confirms no creation-source data exists on the
   worktrees table) — real filtering there needs a schema addition; see the
   PR description for that explicit gap.
   Persistence mirrors sidebar-order.ts's `drogon:shell:` localStorage
   convention exactly (same storage-param injection for testability, same
   try/catch-and-degrade-to-default on a blocked/full store). Pure,
   unit-tested. */
import type {
  Project,
  Session,
  Worktree,
} from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";

export type WorkspaceGroupBy = "none" | "project";
export type WorkspaceSortBy = "manual" | "name" | "recent";
export type WorkspaceCardLayout = "comfortable" | "compact";

export type WorkspaceShowProperties = {
  /** Branch name + ahead/behind badges. */
  branch: boolean;
  /** PR chip. */
  pr: boolean;
};

export type WorkspaceHideFilters = {
  sleeping: boolean;
  defaultBranch: boolean;
  detachedHead: boolean;
};

export type WorkspaceOptionsState = {
  groupBy: WorkspaceGroupBy;
  sortBy: WorkspaceSortBy;
  cardLayout: WorkspaceCardLayout;
  showProperties: WorkspaceShowProperties;
  hide: WorkspaceHideFilters;
};

export const DEFAULT_WORKSPACE_OPTIONS_STATE: WorkspaceOptionsState = {
  groupBy: "project",
  sortBy: "manual",
  cardLayout: "comfortable",
  showProperties: { branch: true, pr: true },
  hide: { sleeping: false, defaultBranch: false, detachedHead: false },
};

const STORAGE_KEY = "drogon:shell:workspace-options";

function isWorkspaceGroupBy(value: unknown): value is WorkspaceGroupBy {
  return value === "none" || value === "project";
}
function isWorkspaceSortBy(value: unknown): value is WorkspaceSortBy {
  return value === "manual" || value === "name" || value === "recent";
}
function isWorkspaceCardLayout(value: unknown): value is WorkspaceCardLayout {
  return value === "comfortable" || value === "compact";
}

/** Merges a possibly-partial/stale stored envelope onto the defaults field
 *  by field, so a future release adding a new field never resets a user's
 *  existing choices for the fields that already existed. */
export function loadWorkspaceOptionsState(
  storage: Pick<Storage, "getItem">,
): WorkspaceOptionsState {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WORKSPACE_OPTIONS_STATE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null)
      return DEFAULT_WORKSPACE_OPTIONS_STATE;
    const state = parsed as Partial<WorkspaceOptionsState>;
    return {
      groupBy: isWorkspaceGroupBy(state.groupBy)
        ? state.groupBy
        : DEFAULT_WORKSPACE_OPTIONS_STATE.groupBy,
      sortBy: isWorkspaceSortBy(state.sortBy)
        ? state.sortBy
        : DEFAULT_WORKSPACE_OPTIONS_STATE.sortBy,
      cardLayout: isWorkspaceCardLayout(state.cardLayout)
        ? state.cardLayout
        : DEFAULT_WORKSPACE_OPTIONS_STATE.cardLayout,
      showProperties: {
        branch:
          typeof state.showProperties?.branch === "boolean"
            ? state.showProperties.branch
            : DEFAULT_WORKSPACE_OPTIONS_STATE.showProperties.branch,
        pr:
          typeof state.showProperties?.pr === "boolean"
            ? state.showProperties.pr
            : DEFAULT_WORKSPACE_OPTIONS_STATE.showProperties.pr,
      },
      hide: {
        sleeping:
          typeof state.hide?.sleeping === "boolean"
            ? state.hide.sleeping
            : DEFAULT_WORKSPACE_OPTIONS_STATE.hide.sleeping,
        defaultBranch:
          typeof state.hide?.defaultBranch === "boolean"
            ? state.hide.defaultBranch
            : DEFAULT_WORKSPACE_OPTIONS_STATE.hide.defaultBranch,
        detachedHead:
          typeof state.hide?.detachedHead === "boolean"
            ? state.hide.detachedHead
            : DEFAULT_WORKSPACE_OPTIONS_STATE.hide.detachedHead,
      },
    };
  } catch {
    return DEFAULT_WORKSPACE_OPTIONS_STATE;
  }
}

export function saveWorkspaceOptionsState(
  storage: Pick<Storage, "setItem">,
  state: WorkspaceOptionsState,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // No durability promise; in-memory state stays authoritative.
  }
}

/** "None" flattens every project's worktrees into one unheadered list,
 *  still respecting each group's own worktree order. "Project" is this
 *  repo's existing default shape (one header per project). */
export function applyWorkspaceGroupBy(
  groups: readonly ProjectGroup[],
  groupBy: WorkspaceGroupBy,
): readonly ProjectGroup[] {
  if (groupBy !== "none" || groups.length === 0) return groups;
  const worktrees = groups.flatMap((group) => group.worktrees);
  // A synthetic single group; callers that key off `project.id` in a list
  // (not object identity) still render every worktree exactly once. Reuses
  // the first group's project as the nominal owner -- purely a rendering
  // convenience, ungrouped mode is not meant to expose per-card project
  // identity distinctly (the point of the mode is to drop that grouping).
  return [{ project: groups[0]!.project, worktrees }];
}

/** A worktree is on its project's default branch when the project records
 *  one and the worktree's branch matches it exactly. A folder project (no
 *  branch concept) or a project with no recorded default never matches. */
export function isDefaultBranchWorktree(
  worktree: Worktree,
  project: Project,
): boolean {
  return (
    project.kind === "git" &&
    project.defaultBaseRef !== null &&
    worktree.branch === project.defaultBaseRef
  );
}

/** A detached HEAD has no branch name at all -- git.rs never invents one.
 *  A folder project's synthesized implicit worktree also reports an empty
 *  branch (worktree_rpc.rs's do_worktree_list), but it is not a git
 *  worktree and must never be treated as "detached". */
export function isDetachedHeadWorktree(
  worktree: Worktree,
  project: Project,
): boolean {
  return project.kind === "git" && worktree.branch === "";
}

/** "Sleeping": no session with a live verdict is currently attached to
 *  this worktree's workspace -- exited/unverifiable sessions (or none at
 *  all) both count as asleep, matching the plain-language sense used
 *  throughout this menu's own labels. */
export function isSleepingWorktree(
  worktree: Worktree,
  sessions: readonly Session[],
): boolean {
  return !sessions.some(
    (session) =>
      session.workspaceId === worktree.workspaceId &&
      session.verdict === "live",
  );
}

/** Applies every enabled hide-* filter to one project's worktrees. Never
 *  drops the group itself (an empty group still renders its header with
 *  no cards, exactly like an existing empty-filter-result project) --
 *  hiding is a display filter over cards, not project visibility. */
export function applyWorkspaceHideFilters(
  worktrees: readonly Worktree[],
  project: Project,
  sessions: readonly Session[],
  hide: WorkspaceHideFilters,
): Worktree[] {
  return worktrees.filter((worktree) => {
    if (hide.sleeping && isSleepingWorktree(worktree, sessions)) return false;
    if (hide.defaultBranch && isDefaultBranchWorktree(worktree, project))
      return false;
    if (hide.detachedHead && isDetachedHeadWorktree(worktree, project))
      return false;
    return true;
  });
}

/** Stable sort so ties (identical name, or identical/absent activity) keep
 *  their incoming relative order -- "manual" is a no-op here; the caller's
 *  existing drag-order (applyStoredSidebarOrder) already produced it. */
export function sortWorktreesForDisplay(
  worktrees: readonly Worktree[],
  sortBy: WorkspaceSortBy,
  latestActivityAt: (worktree: Worktree) => string | null,
): Worktree[] {
  if (sortBy === "manual") return [...worktrees];
  if (sortBy === "name") {
    return [...worktrees].sort((a, b) =>
      worktreeDisplayLabel(a).localeCompare(worktreeDisplayLabel(b)),
    );
  }
  // "recent": most-recent activity first; a worktree with no recorded
  // activity sorts after every worktree that has some, keeping its
  // relative position among other activity-less worktrees (Array.sort is
  // stable in every JS engine this app ships on).
  return [...worktrees].sort((a, b) => {
    const aTime = latestActivityAt(a);
    const bTime = latestActivityAt(b);
    if (aTime === null && bTime === null) return 0;
    if (aTime === null) return 1;
    if (bTime === null) return -1;
    return bTime.localeCompare(aTime);
  });
}

function worktreeDisplayLabel(worktree: Worktree): string {
  if (worktree.title) return worktree.title;
  const base = worktree.path.split("/").filter(Boolean).at(-1);
  return base ?? worktree.path;
}
