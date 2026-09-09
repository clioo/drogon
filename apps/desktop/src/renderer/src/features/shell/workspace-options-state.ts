/* MIT Copyright (c) 2026 Lovecast Inc.
   User-feature-closure item 4: the full "Workspace options" reference menu
   -- Group by, Sort by, Project order, Card layout, Show properties, and
   every Hide filter -- now acts on real, backend-durable data instead of
   the reduced worker's shell-only localStorage model with two disabled
   filters. Sources:
   - groupBy/sortBy/hide filters/worktreeCardProperties/workspaceStatuses/
     board prefs: `apps/desktop/src/shared/workspace-ui-preferences-contract.ts`
     (`Pick`s off the shared `PersistedUIState` scaffold; root-approved
     enums, never redeclared here).
   - Per-worktree metadata (workspaceStatus, isPinned, sortOrder,
     manualOrder, lastActivityAt, creator): `Worktree` fields backed by
     `crates/drogon-protocol/src/worktree.rs` (schema v5), real and
     durable, not derived client-side.
   - PR status: `workspace-pr-status.ts`, correlating the existing
     `tasks.list(mode: "pulls")` provider bridge by branch (see that
     module's own doc for the exact boundary: real open/draft/merged/
     closed state, `unavailable` when the provider call itself fails --
     never a fabricated status).
   Every field in `WorkspaceOptionsState` -- including `cardLayout` and
   `showProperties`, which have no direct field in the pinned
   `PersistedUIState` scaffold -- round-trips through the ONE shared
   `window.drogon.ui.get/set` store (main/workspace-ui-preferences.ts) via
   `toSharedUIPreferences`/`fromSharedUIPreferences` below:
   `showProperties.{branch,pr}` maps onto real `worktreeCardProperties`
   array membership (no parallel boolean pair in the persisted shape) and
   `cardLayout` rides the store's own additive Drogon-local field. There is
   no second, private localStorage authority for any of this -- see
   ProjectList.tsx's hydration/one-time-migration effect, which is the only
   remaining reader of the legacy `drogon:shell:workspace-options` key
   (`loadWorkspaceOptionsState`/`saveWorkspaceOptionsState` below stay only
   for that one-shot migration and for tests that inject a bare
   `Storage`-like double).
   Pure, unit-tested. */
import type {
  Project,
  Session,
  Worktree,
} from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";
import type { WorkspaceStatusDefinition } from "../../../../shared/persistence-contracts/worktree-types";
import {
  cloneDefaultWorkspaceStatuses,
  DEFAULT_WORKSPACE_STATUS_ID,
  getWorkspaceStatus,
  WORKSPACE_BOARD_COLUMN_WIDTH_DEFAULT,
} from "../../../../shared/workspace-statuses";
import {
  derivePrStatusBucket,
  type WorkspacePrStatusBucket,
} from "../../../../shared/workspace-pr-status";
import type { TaskPullRequest } from "../../../../shared/tasks-contract";
import type { WorkspaceUIPreferences } from "../../../../shared/workspace-ui-preferences-contract";

export type WorkspaceGroupBy = "none" | "workspace-status" | "repo" | "pr-status";
export type WorkspaceSortBy = "manual" | "name" | "recent" | "smart" | "repo";
export type WorkspaceProjectOrderBy = "manual" | "recent";
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
  /** Real filter: `Worktree.creator === "automation"` (schema v5).
   *  Always empty today -- automation-dispatched workspace creation is
   *  unwired anywhere in this build
   *  (`bot_run_rpc::RunUnsupported::NewPerRunWorkspaceMode`, confirmed the
   *  same in the plain `automations::runner`/`direct` dispatch paths too)
   *  -- but the filter itself is real, not faked, and will start doing
   *  something the day that scheduler mode ships. */
  automationCreated: boolean;
  /** Real filter: `Worktree.creator === "cli"`, set by every
   *  `drogon-cli worktree create` call. */
  cliCreated: boolean;
};

export type WorkspaceOptionsState = {
  groupBy: WorkspaceGroupBy;
  sortBy: WorkspaceSortBy;
  projectOrderBy: WorkspaceProjectOrderBy;
  cardLayout: WorkspaceCardLayout;
  showProperties: WorkspaceShowProperties;
  hide: WorkspaceHideFilters;
};

export const DEFAULT_WORKSPACE_OPTIONS_STATE: WorkspaceOptionsState = {
  groupBy: "repo",
  sortBy: "recent",
  projectOrderBy: "manual",
  cardLayout: "comfortable",
  showProperties: { branch: true, pr: true },
  hide: {
    sleeping: false,
    defaultBranch: false,
    detachedHead: false,
    automationCreated: false,
    cliCreated: false,
  },
};

const STORAGE_KEY = "drogon:shell:workspace-options";

function isWorkspaceGroupBy(value: unknown): value is WorkspaceGroupBy {
  return (
    value === "none" ||
    value === "workspace-status" ||
    value === "repo" ||
    value === "pr-status"
  );
}
function isWorkspaceSortBy(value: unknown): value is WorkspaceSortBy {
  return (
    value === "manual" ||
    value === "name" ||
    value === "recent" ||
    value === "smart" ||
    value === "repo"
  );
}
function isWorkspaceProjectOrderBy(value: unknown): value is WorkspaceProjectOrderBy {
  return value === "manual" || value === "recent";
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
      projectOrderBy: isWorkspaceProjectOrderBy(state.projectOrderBy)
        ? state.projectOrderBy
        : DEFAULT_WORKSPACE_OPTIONS_STATE.projectOrderBy,
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
        automationCreated:
          typeof state.hide?.automationCreated === "boolean"
            ? state.hide.automationCreated
            : DEFAULT_WORKSPACE_OPTIONS_STATE.hide.automationCreated,
        cliCreated:
          typeof state.hide?.cliCreated === "boolean"
            ? state.hide.cliCreated
            : DEFAULT_WORKSPACE_OPTIONS_STATE.hide.cliCreated,
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

/** Projects the renderer's `WorkspaceOptionsState` onto the shared
 *  `window.drogon.ui` store's shape. `showProperties` maps onto real
 *  `worktreeCardProperties` array membership -- toggling one preserves
 *  every OTHER property the array might carry (e.g. a value Kanban or a
 *  future card badge sets), so this always reads the CURRENT shared array
 *  and only adds/removes the two this menu owns, never replacing it
 *  wholesale. */
export function toSharedUIPreferences(
  state: WorkspaceOptionsState,
  currentCardProperties: readonly WorkspaceUIPreferences["worktreeCardProperties"][number][] = [],
): Partial<WorkspaceUIPreferences> {
  const properties = new Set(currentCardProperties);
  for (const property of ["branch", "pr"] as const) {
    properties.delete(property);
  }
  if (state.showProperties.branch) properties.add("branch");
  if (state.showProperties.pr) properties.add("pr");
  return {
    groupBy: state.groupBy,
    sortBy: state.sortBy,
    projectOrderBy: state.projectOrderBy,
    cardLayout: state.cardLayout,
    hideSleepingWorkspaces: state.hide.sleeping,
    hideDefaultBranchWorkspace: state.hide.defaultBranch,
    hideDetachedHeadWorkspaces: state.hide.detachedHead,
    hideAutomationGeneratedWorkspaces: state.hide.automationCreated,
    hideCliCreatedWorkspaces: state.hide.cliCreated,
    worktreeCardProperties: [...properties],
  };
}

/** The inverse of `toSharedUIPreferences`: the shared store is the single
 *  authority, so every field here reads straight off it (with an honest
 *  default for any field an older stored profile omitted). */
export function fromSharedUIPreferences(
  prefs: WorkspaceUIPreferences,
): WorkspaceOptionsState {
  return {
    groupBy: prefs.groupBy,
    sortBy: prefs.sortBy,
    projectOrderBy: prefs.projectOrderBy ?? DEFAULT_WORKSPACE_OPTIONS_STATE.projectOrderBy,
    cardLayout: prefs.cardLayout ?? DEFAULT_WORKSPACE_OPTIONS_STATE.cardLayout,
    showProperties: {
      branch: (prefs.worktreeCardProperties ?? []).includes("branch"),
      pr: (prefs.worktreeCardProperties ?? []).includes("pr"),
    },
    hide: {
      sleeping: prefs.hideSleepingWorkspaces ?? false,
      defaultBranch: prefs.hideDefaultBranchWorkspace ?? false,
      detachedHead: prefs.hideDetachedHeadWorkspaces ?? false,
      automationCreated: prefs.hideAutomationGeneratedWorkspaces ?? false,
      cliCreated: prefs.hideCliCreatedWorkspaces ?? false,
    },
  };
}

/** True when the shared store's Workspace Options fields are still at
 *  their untouched defaults -- the one-time-migration trigger: a profile
 *  that has never been written through `window.drogon.ui.set` for this
 *  domain looks exactly like `DEFAULT_WORKSPACE_OPTIONS_STATE`, so a
 *  legacy localStorage profile that differs from the defaults is real,
 *  pre-existing user customization worth migrating once. */
export function sharedUIPreferencesAreUntouched(
  prefs: WorkspaceUIPreferences,
): boolean {
  const asState = fromSharedUIPreferences(prefs);
  return (
    JSON.stringify(asState) === JSON.stringify(DEFAULT_WORKSPACE_OPTIONS_STATE)
  );
}

/** Pre-hydration seed for ProjectList.tsx's shared-preferences state: the
 *  brief window before `window.drogon.ui.get()` resolves (or on a preload
 *  that predates the namespace at all) renders with the exact same
 *  defaults `main/workspace-ui-preferences.ts` converges to -- never an
 *  invented placeholder shape, and never itself a second authority (it is
 *  only ever a seed, immediately superseded by the real hydration). */
export const INITIAL_SHARED_UI_PREFERENCES: WorkspaceUIPreferences = {
  ...(toSharedUIPreferences(DEFAULT_WORKSPACE_OPTIONS_STATE) as Omit<
    WorkspaceUIPreferences,
    | "workspaceStatuses"
    | "workspaceBoardOpacity"
    | "workspaceBoardColumnWidth"
    | "syncTaskStatusFromWorkspaceBoard"
    | "_workspaceStatusesDefaultOrderMigrated"
    | "_workspaceStatusesReorderedDefaultRepaired"
    | "_workspaceStatusesDefaultWorkflowMigrated"
    | "_workspaceStatusesDefaultVisualsMigrated"
  >),
  workspaceStatuses: cloneDefaultWorkspaceStatuses(),
  workspaceBoardOpacity: 1,
  workspaceBoardColumnWidth: WORKSPACE_BOARD_COLUMN_WIDTH_DEFAULT,
  syncTaskStatusFromWorkspaceBoard: false,
  _workspaceStatusesDefaultOrderMigrated: true,
  _workspaceStatusesReorderedDefaultRepaired: true,
  _workspaceStatusesDefaultWorkflowMigrated: true,
  _workspaceStatusesDefaultVisualsMigrated: true,
};

/** "None"/"Repo" both keep every worktree under its own real project --
 *  ProjectList.tsx's `hideHeader={groupBy === "none"}` is what actually
 *  drops the header text for "None"; the data here never lies about which
 *  project owns a card (never reassigns to `groups[0]`'s project), so
 *  every card's remove/rename/settings action keeps targeting its real
 *  project either way. */
export function applyWorkspaceGroupBy(
  groups: readonly ProjectGroup[],
  groupBy: WorkspaceGroupBy,
): readonly ProjectGroup[] {
  return groups;
}

/** One real-data bucket for a cross-project grouping mode: `key` is the
 *  stable group-by key (a workspace-status id or a PR-status bucket, see
 *  `workspace-statuses.ts`/`workspace-pr-status.ts`'s own group-key
 *  helpers), `label` is what the header shows, and each entry carries its
 *  OWN real project alongside its worktree -- never a synthetic/borrowed
 *  one, so grouping cuts across project boundaries without corrupting
 *  which project actually owns a card. */
export type WorkspaceEntryGroup = {
  key: string;
  label: string;
  entries: Array<{ worktree: Worktree; project: Project }>;
};

/** Cross-project regrouping for `groupBy: "workspace-status"`. Buckets in
 *  the user's own configured status order (`statuses`, from
 *  `workspaceStatuses` in the shared UI-prefs), each worktree resolved
 *  through `getWorkspaceStatus` (unknown/absent status falls back to the
 *  default status id -- never its own invented bucket). */
export function groupWorktreesByWorkspaceStatus(
  groups: readonly ProjectGroup[],
  statuses: readonly WorkspaceStatusDefinition[],
): WorkspaceEntryGroup[] {
  const byStatus = new Map<string, WorkspaceEntryGroup>();
  for (const status of statuses) {
    byStatus.set(status.id, { key: status.id, label: status.label, entries: [] });
  }
  for (const group of groups) {
    for (const worktree of group.worktrees) {
      const statusId = getWorkspaceStatus(worktree, statuses);
      const bucket =
        byStatus.get(statusId) ??
        byStatus.get(DEFAULT_WORKSPACE_STATUS_ID) ??
        byStatus.values().next().value;
      bucket?.entries.push({ worktree, project: group.project });
    }
  }
  return [...byStatus.values()].filter((bucket) => bucket.entries.length > 0);
}

const PR_STATUS_BUCKET_ORDER: readonly WorkspacePrStatusBucket[] = [
  "open",
  "draft",
  "merged",
  "closed",
  "none",
  "unavailable",
];
const PR_STATUS_LABEL: Record<WorkspacePrStatusBucket, string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
  none: "No pull request",
  unavailable: "PR status unavailable",
};

/** Cross-project regrouping for `groupBy: "pr-status"`. `pullsByProjectId`
 *  carries `tasks.list(mode: "pulls")`'s already-fetched result per
 *  project; a missing entry (the project's own pulls fetch failed or was
 *  never attempted) makes every worktree in that project bucket under
 *  `unavailable` -- real and distinct, never silently `none`. */
export function groupWorktreesByPrStatus(
  groups: readonly ProjectGroup[],
  pullsByProjectId: ReadonlyMap<string, readonly TaskPullRequest[] | null>,
): WorkspaceEntryGroup[] {
  const byBucket = new Map<WorkspacePrStatusBucket, WorkspaceEntryGroup>();
  for (const bucket of PR_STATUS_BUCKET_ORDER) {
    byBucket.set(bucket, { key: bucket, label: PR_STATUS_LABEL[bucket], entries: [] });
  }
  for (const group of groups) {
    const pulls = pullsByProjectId.has(group.project.id)
      ? pullsByProjectId.get(group.project.id)!
      : null;
    for (const worktree of group.worktrees) {
      const bucket = derivePrStatusBucket(worktree, pulls);
      byBucket.get(bucket)!.entries.push({ worktree, project: group.project });
    }
  }
  return [...byBucket.values()].filter((bucket) => bucket.entries.length > 0);
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

export function isAutomationCreatedWorktree(worktree: Worktree): boolean {
  return worktree.creator === "automation";
}

export function isCliCreatedWorktree(worktree: Worktree): boolean {
  return worktree.creator === "cli";
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
    if (hide.automationCreated && isAutomationCreatedWorktree(worktree))
      return false;
    if (hide.cliCreated && isCliCreatedWorktree(worktree)) return false;
    return true;
  });
}

/** Most-recent real activity for a worktree: the backend-durable
 *  `lastActivityAt` (schema v5, bumped on create/rename/note/status/pin/
 *  archive changes) when present, else its creation time -- never
 *  "no activity" (an ever-quiet worktree still ranks, oldest last, under
 *  Sort by "Recent"/"Smart" instead of colliding at absent). */
function worktreeActivityAt(worktree: Worktree): string {
  return worktree.lastActivityAt ?? worktree.createdAt;
}

/** Stable sort so ties (identical name, or identical/absent activity) keep
 *  their incoming relative order. "Manual" ranks by the real, backend-
 *  durable `manualOrder` (schema v5; higher renders first, sparse stride
 *  1000 -- see `manualOrderBetween`/`manualOrderRanksFromOrderedIds`
 *  below) -- the canonical order, the same field ProjectList.tsx's drag
 *  commit persists via `worktree.update` and the Kanban board's own
 *  column-drag will read/write. A worktree that has never been manually
 *  ranked (`manualOrder` absent) sorts after every ranked one, in the
 *  incoming array's own relative order (stable) -- never before a
 *  genuinely ranked worktree and never reordered against its unranked
 *  siblings just because the sort ran. `projectNameOf` is required only
 *  for "repo" (which project's name a worktree sorts under when the
 *  display is flattened/regrouped) and `latestActivityAt` is an optional
 *  override for "recent"/"smart" (a session-derived heuristic some
 *  callers still prefer over the stored `lastActivityAt` alone); both
 *  default to the real worktree fields. */
export function sortWorktreesForDisplay(
  worktrees: readonly Worktree[],
  sortBy: WorkspaceSortBy,
  latestActivityAt?: (worktree: Worktree) => string | null,
  projectNameOf?: (worktree: Worktree) => string,
): Worktree[] {
  const activityOf = latestActivityAt ?? worktreeActivityAt;
  if (sortBy === "manual") {
    return [...worktrees].sort((a, b) => {
      const aRank = a.manualOrder ?? null;
      const bRank = b.manualOrder ?? null;
      if (aRank === null && bRank === null) return 0;
      if (aRank === null) return 1;
      if (bRank === null) return -1;
      return bRank - aRank;
    });
  }
  if (sortBy === "name") {
    return [...worktrees].sort((a, b) =>
      worktreeDisplayLabel(a).localeCompare(worktreeDisplayLabel(b)),
    );
  }
  if (sortBy === "repo") {
    const nameOf = projectNameOf ?? (() => "");
    return [...worktrees].sort(
      (a, b) => nameOf(a).localeCompare(nameOf(b)) || worktreeDisplayLabel(a).localeCompare(worktreeDisplayLabel(b)),
    );
  }
  if (sortBy === "smart") {
    // Pinned first (each side keeping its own recency order), then every
    // unpinned worktree by recency -- the same two-tier shape Sort by
    // "Recent" alone doesn't give a pinned worktree.
    return [...worktrees].sort((a, b) => {
      const pinnedDelta = Number(b.isPinned ?? false) - Number(a.isPinned ?? false);
      if (pinnedDelta !== 0) return pinnedDelta;
      return recentCompare(a, b, activityOf);
    });
  }
  // "recent": most-recent activity first; a worktree with no recorded
  // activity sorts after every worktree that has some, keeping its
  // relative position among other activity-less worktrees (Array.sort is
  // stable in every JS engine this app ships on).
  return [...worktrees].sort((a, b) => recentCompare(a, b, activityOf));
}

function recentCompare(
  a: Worktree,
  b: Worktree,
  activityOf: (worktree: Worktree) => string | null,
): number {
  const aTime = activityOf(a);
  const bTime = activityOf(b);
  if (aTime === null && bTime === null) return 0;
  if (aTime === null) return 1;
  if (bTime === null) return -1;
  return bTime.localeCompare(aTime);
}

function worktreeDisplayLabel(worktree: Worktree): string {
  if (worktree.title) return worktree.title;
  const base = worktree.path.split("/").filter(Boolean).at(-1);
  return base ?? worktree.path;
}

/** Sparse-rank stride for `manualOrder` (higher renders first): leaves
 *  999 numeric slots between adjacent worktrees so most re-drags land a
 *  new value strictly between its neighbors without renumbering the rest
 *  of the list. Shared with the Kanban board's own column-drag ordering
 *  (same field, same stride -- see the shared contract proposal). */
export const MANUAL_ORDER_STRIDE = 1000;

/** The `manualOrder` value to persist for a worktree dropped between
 *  `before`/`after` (by their OWN current `manualOrder`, in render order
 *  -- `null` for either end of the list). Falls back to a full-stride step
 *  above/below the one real neighbor when the other end is absent, and to
 *  the canonical first stride value when the list is empty entirely. */
export function manualOrderBetween(
  before: number | null,
  after: number | null,
): number {
  if (before === null && after === null) return MANUAL_ORDER_STRIDE;
  if (before === null) return after! + MANUAL_ORDER_STRIDE;
  if (after === null) return before - MANUAL_ORDER_STRIDE;
  const midpoint = Math.round((before + after) / 2);
  // Adjacent ranks with no room between them: renumbering the rest of the
  // list is the caller's job (out of this pure helper's scope); returning
  // the closer neighbor's own value here would collide, so widen by one
  // instead -- still correctly orders relative to `after`, just not
  // perfectly centered.
  return midpoint === after ? after + 1 : midpoint;
}

/** The canonical `manualOrder` rank for every id in a freshly-dropped
 *  order (ProjectList.tsx's drag commit gives the FULL new order for one
 *  project, `worktree-card-drag-commit.ts`'s `onCommitWorktreeOrder`).
 *  Full stride-1000 renumbering, not a single-item `manualOrderBetween`
 *  splice: this is what makes a reorder correct and idempotent even the
 *  very first time a project's worktrees are dragged (when every one of
 *  them still has `manualOrder: null` and there is no existing neighbor
 *  rank to splice between at all), and it is what the interaction tests
 *  verify survives a reload as the CANONICAL rank, not merely "some order
 *  that happens to render right". Higher renders first, so the first id
 *  in `orderedIds` gets the highest rank. */
export function manualOrderRanksFromOrderedIds(
  orderedIds: readonly string[],
): Map<string, number> {
  const ranks = new Map<string, number>();
  const count = orderedIds.length;
  orderedIds.forEach((id, index) => {
    ranks.set(id, (count - index) * MANUAL_ORDER_STRIDE);
  });
  return ranks;
}
