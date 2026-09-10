/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/SidebarHeader.tsx (header recipe:
   title + activity toggle + options + new-workspace, with the compact
   branch below SIDEBAR_HEADER_WIDE_MIN_WIDTH) and
   sidebar-header-actions.tsx (adapter: props instead of the project
   store; the options menu carries this repo's text filter and Add
   Project entry instead of the source's sort/group/host sections, which
   need Orca runtime; the activity toggle narrows to groups with a live
   session instead of the source's agents view, which is out of MVP
   scope). The "+" opens the new-workspace composer (preselected per
   row, unselected in the header), like the source's "New workspace"
   control; each removable card's kebab menu opens the remove confirm
   dialog. All RPCs run in App; every submit resolves a verbatim error
   string or null on success. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CircleX,
  Ellipsis,
  FolderGit2,
  FolderPlus,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { DropdownMenu, Tooltip } from "radix-ui";
import type {
  Project,
  Session,
  Worktree,
  Workspace,
} from "../../../../shared/session-contract";
import type { TaskPullRequest } from "../../../../shared/tasks-contract";
import { Button } from "../../components/ui/button";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../../components/ui/dropdown-menu";
import type { ProjectGroup } from "./project-adapter";
import {
  filterProjectGroups,
  nestProjectWorktrees,
  windowProjectBridge,
  windowTasksBridge,
  windowUiBridge,
} from "./project-adapter";
import { isWideSidebarHeader } from "./app-chrome-layout";
import { AddProjectDialog } from "./AddProjectDialog";
import { DeleteWorktreeDialog } from "./DeleteWorktreeDialog";
import { readSkipDeleteWorktreeConfirm } from "./DeleteWorktreeSkipConfirmOption";
import {
  PROJECT_HEADER_ACTIONS_CLASS_NAME,
  ProjectActionsMenu,
} from "./project-actions-menu";
import { RemoveProjectDialog } from "./RemoveProjectDialog";
import {
  filterGroupsBySelectedProjects,
  getProjectsFilterVisibilityLabel,
} from "./sidebar-options-show";
import {
  loadSidebarProjectOrder,
  orderedProjectIds,
  orderProjectGroups,
  saveSidebarProjectOrder,
} from "./sidebar-order";
import {
  applyWorkspaceHideFilters,
  DEFAULT_WORKSPACE_OPTIONS_STATE,
  fromSharedUIPreferences,
  groupWorktreesByPrStatus,
  groupWorktreesByWorkspaceStatus,
  INITIAL_SHARED_UI_PREFERENCES,
  loadWorkspaceOptionsState,
  manualOrderRanksFromOrderedIds,
  sharedUIPreferencesAreUntouched,
  sortWorktreesForDisplay,
  toSharedUIPreferences,
  type WorkspaceEntryGroup,
  type WorkspaceOptionsState,
} from "./workspace-options-state";
import type { WorkspaceUIPreferences } from "../../../../shared/workspace-ui-preferences-contract";
import { WorkspaceOptionsMenuSections } from "./WorkspaceOptionsMenuSections";
import { resolveCardPullRequest } from "./worktree-card-pr-display";
import { useWorkspaceCardPorts } from "./use-workspace-card-ports";
import { useWorktreeIssueLinks } from "./use-worktree-issue-links";
import type { WorktreeIssueLink } from "../../../../shared/worktree-issue-contract";
import { useProjectHeaderDrag } from "./project-header-drag";
import { useWorktreeCardDrag } from "./worktree-card-drag";
import { WorktreeCard } from "./WorktreeCard";
import type { TabStripState } from "./tab-order";

/**
 * Drop line between project headers / worktree cards while dragging.
 * Ports the fork's WorktreeSidebarDropIndicator structure and classes
 * (dot-line-dot on the worktree-sidebar ring token).
 */
function SidebarDropIndicator({ y }: { y: number }): React.JSX.Element {
  return (
    <div
      role="presentation"
      aria-hidden="true"
      className="pointer-events-none absolute left-3 right-2 z-30 flex h-3 -translate-y-1/2 items-center"
      style={{ top: `${y}px` }}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-worktree-sidebar-ring shadow-[0_0_0_2px_var(--worktree-sidebar)]" />
      <span className="h-0.5 flex-1 rounded-full bg-worktree-sidebar-ring shadow-[0_0_0_2px_var(--worktree-sidebar)]" />
      <span className="size-1.5 shrink-0 rounded-full bg-worktree-sidebar-ring shadow-[0_0_0_2px_var(--worktree-sidebar)]" />
    </div>
  );
}

function readStoredProjectOrder(): string[] {
  if (typeof localStorage === "undefined") return [];
  return loadSidebarProjectOrder(localStorage);
}

/** Pre-hydration seed only (see the hydration effect below): the legacy
 *  `drogon:shell:workspace-options` localStorage entry, read once so the
 *  very first render shows a familiar state instead of a flash of
 *  defaults while `window.drogon.ui.get()` is in flight. Never written to
 *  again once the shared store namespace exists -- `commitWorkspaceOptions`
 *  persists only through `window.drogon.ui.set`. */
function readLegacyWorkspaceOptions(): WorkspaceOptionsState {
  if (typeof localStorage === "undefined")
    return DEFAULT_WORKSPACE_OPTIONS_STATE;
  return loadWorkspaceOptionsState(localStorage);
}

/** Most-recent session activity for a worktree, falling back to its
 *  creation time so an ever-quiet worktree still ranks (oldest last)
 *  under Sort by: Recent instead of colliding at "no activity". */
function latestWorktreeActivityAt(
  worktree: Worktree,
  sessions: readonly Session[],
): string {
  let freshest = worktree.createdAt;
  let freshestMs = Date.parse(worktree.createdAt);
  for (const session of sessions) {
    if (session.workspaceId !== worktree.workspaceId) continue;
    if (!session.agentStateAt) continue;
    const at = Date.parse(session.agentStateAt);
    if (Number.isNaN(at) || at <= freshestMs) continue;
    freshestMs = at;
    freshest = session.agentStateAt;
  }
  return freshest;
}

/** Sorts a cross-project `WorkspaceEntryGroup`'s entries by delegating to
 *  the same tested `sortWorktreesForDisplay` the single-project path uses
 *  -- Sort by "Repo" is where this actually differs from a same-project
 *  sort, since entries here can carry different real owning projects. */
function sortEntriesForDisplay(
  entries: readonly { worktree: Worktree; project: Project }[],
  sortBy: WorkspaceOptionsState["sortBy"],
  latestActivityAt: (worktree: Worktree) => string | null,
): { worktree: Worktree; project: Project }[] {
  const projectNameById = new Map(
    entries.map((entry) => [entry.worktree.id, entry.project.name]),
  );
  const byWorktreeId = new Map(entries.map((entry) => [entry.worktree.id, entry]));
  const sortedWorktrees = sortWorktreesForDisplay(
    entries.map((entry) => entry.worktree),
    sortBy,
    latestActivityAt,
    (worktree) => projectNameById.get(worktree.id) ?? "",
  );
  return sortedWorktrees.map((worktree) => byWorktreeId.get(worktree.id)!);
}

/** Real, most-recent activity across a project's own worktrees --
 *  `Worktree.lastActivityAt` (schema v5) falling back to `createdAt`,
 *  never "no activity" (a project with only ever-quiet worktrees still
 *  ranks, oldest last). */
function mostRecentProjectActivity(worktrees: readonly Worktree[]): string | null {
  let best: string | null = null;
  for (const worktree of worktrees) {
    const at = worktree.lastActivityAt ?? worktree.createdAt;
    if (best === null || at > best) best = at;
  }
  return best;
}

/** Workspace Options "Project order: Recent" (`projectOrderBy`) -- headers
 *  ranked by their own most-recent real worktree activity, independent of
 *  `sortBy` (which orders CARDS, not headers). "Manual" project order
 *  keeps the existing drag-authored `projectOrder` list (no backend field
 *  names a project's own manual rank, so there is nothing to migrate this
 *  onto). */
function projectIdsByRecentActivity(groups: readonly ProjectGroup[]): string[] {
  return [...groups]
    .sort((a, b) => {
      const aTime = mostRecentProjectActivity(a.worktrees);
      const bTime = mostRecentProjectActivity(b.worktrees);
      if (aTime === null && bTime === null) return 0;
      if (aTime === null) return 1;
      if (bTime === null) return -1;
      return bTime.localeCompare(aTime);
    })
    .map((group) => group.project.id);
}

/** Which project dialog the sidebar currently shows, if any. */
export type ProjectAction =
  | { kind: "add" }
  | { kind: "remove"; worktreeId: string }
  | { kind: "remove-project"; projectId: string };

/** Small ghost icon button with a tooltip, like the source header uses. */
function HeaderIconButton({
  label,
  active,
  onClick,
  disabled,
  children,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          className={`size-6 text-muted-foreground${active ? " bg-primary/15 text-primary hover:bg-primary/20" : ""}`}
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" side="bottom" sideOffset={6}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/**
 * The options menu body: the source's "Workspace options" label and Show
 * section (Projects row with the nested multi-select panel), then this
 * repo's Add Project entry and text filter. Group by / Sort by / display
 * rows are absent — no backing stores in the MVP (see the PR not-ported
 * list).
 */
function OptionsMenuContent({
  groups,
  selectedProjectIds,
  onToggleProject,
  onClearProjects,
  filter,
  onFilterChange,
  addDisabled,
  onAddProject,
  workspaceOptions,
  onWorkspaceOptionsChange,
}: {
  groups: ProjectGroup[];
  selectedProjectIds: readonly string[];
  onToggleProject: (projectId: string) => void;
  onClearProjects: () => void;
  filter: string;
  onFilterChange: (value: string) => void;
  addDisabled: boolean;
  onAddProject: () => void;
  workspaceOptions: WorkspaceOptionsState;
  onWorkspaceOptionsChange: (next: WorkspaceOptionsState) => void;
}): React.JSX.Element {
  const projects = groups.map((group) => group.project);
  const selectedCount = projects.filter((project) =>
    selectedProjectIds.includes(project.id),
  ).length;
  const hasProjectsFilter = selectedCount > 0;
  const visibilityLabel = getProjectsFilterVisibilityLabel(
    projects,
    selectedProjectIds,
  );
  return (
    <>
      <DropdownMenuLabel className="pb-0 text-sm text-foreground">
        Workspace options
      </DropdownMenuLabel>
      {groups.length > 1 && (
        <>
          <DropdownMenuLabel>Show</DropdownMenuLabel>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <span className="flex flex-1 items-center justify-between gap-3">
                <span>Projects</span>
                <span className="min-w-0 truncate text-[11px] font-medium text-muted-foreground">
                  {visibilityLabel}
                </span>
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-[11px] font-semibold text-muted-foreground">
                  Projects
                  {hasProjectsFilter && (
                    <span className="ml-1.5 font-medium text-foreground">
                      · {selectedCount}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={onClearProjects}
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-transparent"
                  disabled={!hasProjectsFilter}
                >
                  Clear
                </button>
              </div>
              {projects.map((project) => (
                <DropdownMenuCheckboxItem
                  key={project.id}
                  checked={selectedProjectIds.includes(project.id)}
                  // Keep the menu open so people can compare selections
                  // without reopening the same panel.
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={() => onToggleProject(project.id)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {project.name}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
        </>
      )}
      <WorkspaceOptionsMenuSections
        state={workspaceOptions}
        onChange={onWorkspaceOptionsChange}
      />
      <DropdownMenu.Item
        className="sidebar-menu-item"
        disabled={addDisabled}
        onSelect={onAddProject}
      >
        <FolderPlus className="size-3.5" />
        Add Project
      </DropdownMenu.Item>
      <DropdownMenu.Separator className="sidebar-menu-separator" />
      <div className="sidebar-menu-filter">
        <input
          className="shell-filter-input"
          aria-label="Filter projects and worktrees"
          placeholder="Filter projects…"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
        />
      </div>
    </>
  );
}

/**
 * Projects section: header with activity/options/new-workspace controls,
 * one row per project with its worktree cards underneath. Mirrors the
 * source's SidebarHeader order: activity toggle, workspace options, "+".
 */
export function ProjectList({
  groups,
  workspaces,
  sessions,
  selectedWorkspaceId,
  activeSessionId,
  tabStrip,
  onSelectSession,
  disabled,
  addDisabled,
  sidebarWidth,
  worktreesAvailable,
  action,
  onSelectWorkspace,
  onAddProject,
  onCreateWorkspace,
  onOpenAction,
  onCloseAction,
  onOpenProjectSettings,
  onBrowse,
  onSubmitAdd,
  onSubmitRemove,
  onSubmitRemoveProject,
  onSubmitRename,
}: {
  groups: ProjectGroup[];
  workspaces: Workspace[];
  sessions: Session[];
  selectedWorkspaceId: string;
  /** Active session tab id for the card rows' focused highlight. */
  activeSessionId: string;
  /** Strip order/pins/renames so card rows read exactly like tab titles. */
  tabStrip: TabStripState;
  /** Selects a session tab when a nested card row is clicked. */
  onSelectSession: (sessionId: string) => void;
  disabled: boolean;
  addDisabled: boolean;
  sidebarWidth: number;
  worktreesAvailable: boolean;
  action: ProjectAction | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onAddProject: () => void;
  /** Opens the new-workspace composer, preselected when given a project. */
  onCreateWorkspace: (projectId?: string) => void;
  onOpenAction: (action: ProjectAction) => void;
  onCloseAction: () => void;
  /** Opens the settings page on the given project's section. */
  onOpenProjectSettings: (project: Project) => void;
  onBrowse: () => Promise<string | null>;
  onSubmitAdd: (input: {
    path: string;
    name?: string;
  }) => Promise<string | null>;
  onSubmitRemove: (
    worktree: Worktree,
    force: boolean,
  ) => Promise<string | null>;
  /** Removes the project registration (never files); resolves an error verbatim, or null. */
  onSubmitRemoveProject: (project: Project) => Promise<string | null>;
  onSubmitRename: (worktree: Worktree, name: string) => Promise<string | null>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [activityOnly, setActivityOnly] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  // Persisted manual PROJECT HEADER order (fork parity: pointer drag on
  // headers). No backend field names a project's own manual rank, so this
  // stays the real, sole authority for header order -- unlike worktree
  // order below, it is not a "second, private" copy of anything.
  const [projectOrder, setProjectOrder] = useState<string[]>(
    readStoredProjectOrder,
  );
  // The ONE shared Workspace Options authority (main/workspace-ui-preferences.ts
  // via window.drogon.ui): seeded synchronously from the legacy
  // localStorage entry so first paint has no flash of defaults, then
  // superseded by the real hydration effect below (which also runs the
  // one-time migration). `workspaceOptions` is a pure projection of this
  // state -- there is no separate `setWorkspaceOptions`.
  const [sharedPrefs, setSharedPrefs] = useState<WorkspaceUIPreferences>(() => ({
    ...INITIAL_SHARED_UI_PREFERENCES,
    ...toSharedUIPreferences(
      readLegacyWorkspaceOptions(),
      INITIAL_SHARED_UI_PREFERENCES.worktreeCardProperties,
    ),
  }));
  const workspaceOptions = useMemo(
    () => fromSharedUIPreferences(sharedPrefs),
    [sharedPrefs],
  );
  const portsByWorkspaceId = useWorkspaceCardPorts(workspaces, workspaceOptions.showProperties.ports === true);
  const issueLinksByWorktree = useWorktreeIssueLinks(groups, workspaceOptions.showProperties["linear-issue"] === true || workspaceOptions.showProperties["jira-issue"] === true);
  useEffect(() => {
    const ui = windowUiBridge(window.drogon);
    if (!ui) return;
    let cancelled = false;
    void (async () => {
      let fetched: WorkspaceUIPreferences;
      try {
        fetched = await ui.get();
      } catch {
        return;
      }
      if (cancelled) return;
      // One-time migration: the shared store has never been written for
      // this domain (still exactly the defaults) AND a legacy localStorage
      // profile carries real, pre-existing customization -- write it
      // through once so it becomes the durable, canonical value; a
      // profile that was already migrated (or never customized) just
      // adopts the fetched value as-is.
      if (
        sharedUIPreferencesAreUntouched(fetched) &&
        typeof localStorage !== "undefined"
      ) {
        const legacy = loadWorkspaceOptionsState(localStorage);
        if (
          JSON.stringify(legacy) !== JSON.stringify(DEFAULT_WORKSPACE_OPTIONS_STATE)
        ) {
          try {
            const migrated = await ui.set(
              toSharedUIPreferences(legacy, fetched.worktreeCardProperties),
            );
            if (!cancelled) setSharedPrefs(migrated);
            return;
          } catch {
            // Fall through to adopting the unmigrated fetched value below;
            // the legacy localStorage entry is left untouched, so a later
            // reload can retry the migration.
          }
        }
      }
      setSharedPrefs(fetched);
    })();
    return () => {
      cancelled = true;
    };
    // Runs once per mount: this is a one-shot hydration/migration, not a
    // live subscription (window.drogon.ui has no push channel).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const commitWorkspaceOptions = useCallback((next: WorkspaceOptionsState) => {
    setSharedPrefs((current) => {
      const partial = toSharedUIPreferences(next, current.worktreeCardProperties);
      const merged = { ...current, ...partial };
      const ui = windowUiBridge(window.drogon);
      if (ui) {
        void ui
          .set(partial)
          .then((authoritative) => setSharedPrefs(authoritative))
          .catch(() => {});
      }
      return merged;
    });
  }, []);
  const sectionRef = useRef<HTMLElement | null>(null);
  const getScrollContainer = useCallback(
    (): HTMLElement | null =>
      (sectionRef.current?.closest(
        ".shell-sidebar-scroll",
      ) as HTMLElement | null) ?? null,
    [],
  );
  // Optimistic overlay for a just-committed drag, applied on top of the
  // real `manualOrder` from `groups` until the parent's own refresh (its
  // project.changes poll / push) carries the persisted value back down --
  // never a competing authority: once `groups` reflects the write, the
  // override and the real field agree and this becomes a no-op.
  const [manualOrderOverrides, setManualOrderOverrides] = useState<
    ReadonlyMap<string, number>
  >(new Map());
  const withManualOrderOverride = useCallback(
    (worktree: Worktree): Worktree => {
      const override = manualOrderOverrides.get(worktree.id);
      return override === undefined ? worktree : { ...worktree, manualOrder: override };
    },
    [manualOrderOverrides],
  );
  const ordered = useMemo(() => {
    const headerIds =
      workspaceOptions.projectOrderBy === "recent"
        ? projectIdsByRecentActivity(groups)
        : projectOrder;
    return orderProjectGroups(groups, headerIds).map((group) => ({
      ...group,
      worktrees: sortWorktreesForDisplay(
        group.worktrees.map(withManualOrderOverride),
        "manual",
      ),
    }));
  }, [groups, projectOrder, workspaceOptions.projectOrderBy, withManualOrderOverride]);
  // `ordered` is unfiltered, so its ids are the full commit domain.
  const allProjectIds = useMemo(() => orderedProjectIds(ordered), [ordered]);
  const knownProjectIds = useMemo(
    () => new Set(groups.map((group) => group.project.id)),
    [groups],
  );
  const commitProjectOrder = useCallback((next: string[]) => {
    setProjectOrder(next);
    if (typeof localStorage !== "undefined")
      saveSidebarProjectOrder(localStorage, next);
  }, []);
  const worktreesById = useMemo(() => {
    const map = new Map<string, Worktree>();
    for (const group of groups) {
      for (const worktree of group.worktrees) map.set(worktree.id, worktree);
    }
    return map;
  }, [groups]);
  // The canonical worktree order authority: `worktree.manualOrder`
  // (schema v5), the SAME field `worktree.update` and Kanban's own
  // column-drag read/write -- no parallel private order store. A drag
  // commit renumbers the WHOLE project (stride 1000, higher first) rather
  // than splicing one value between neighbors, so the very first drag in a
  // project with no prior manual ranks still produces a fully consistent,
  // correct total order (see `manualOrderRanksFromOrderedIds`'s own doc).
  const commitWorktreeOrder = useCallback(
    (_projectId: string, next: string[]) => {
      const ranks = manualOrderRanksFromOrderedIds(next);
      setManualOrderOverrides((current) => {
        const merged = new Map(current);
        for (const [id, rank] of ranks) merged.set(id, rank);
        return merged;
      });
      const bridge = windowProjectBridge(window.drogon);
      if (!bridge.worktreeUpdate) return;
      for (const [worktreeId, manualOrder] of ranks) {
        if (worktreesById.get(worktreeId)?.manualOrder === manualOrder) continue;
        void bridge.worktreeUpdate({ worktreeId, manualOrder }).catch(() => {});
      }
    },
    [worktreesById],
  );
  const visible = filterGroupsBySelectedProjects(
    filterProjectGroups(ordered, workspaces, filter),
    selectedProjectIds,
  );
  const active = activityOnly
    ? visible.filter((group) => groupHasLiveSession(group, sessions))
    : visible;
  const filterActive = filter.trim() !== "";
  const projectsFilterCount = groups.filter((group) =>
    selectedProjectIds.includes(group.project.id),
  ).length;
  const activeFilterCount = (filterActive ? 1 : 0) + projectsFilterCount;
  const hasAnyFilter = activeFilterCount > 0;
  const activeFilterLabel = `${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"}`;
  const removeTarget = findWorktree(groups, action);
  const removeProjectTarget = findProject(groups, action);
  const activityLabel = activityOnly
    ? "Turn off activity view"
    : "View activity";
  const optionsLabel = hasAnyFilter
    ? `Workspace options (${activeFilterLabel} active)`
    : "Workspace options";
  const toggleProject = (projectId: string) => {
    setSelectedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId],
    );
  };
  const wide = isWideSidebarHeader(sidebarWidth);
  const clearFilters = () => {
    setFilter("");
    setActivityOnly(false);
    setSelectedProjectIds([]);
  };
  // Rendered headers/cards are the drag geometry domain (fork: the sidebar
  // row model); the full ordered lists are the commit domain.
  const visibleProjectIds = useMemo(
    () => active.map((group) => group.project.id),
    [active],
  );
  const visibleCardIdsByProject = useMemo(
    () =>
      new Map(
        active.map((group) => [
          group.project.id,
          group.worktrees.map((worktree) => worktree.id),
        ]),
      ),
    [active],
  );
  const fullCardIdsByProject = useMemo(
    () =>
      new Map(
        ordered.map((group) => [
          group.project.id,
          group.worktrees.map((worktree) => worktree.id),
        ]),
      ),
    [ordered],
  );
  const projectDrag = useProjectHeaderDrag({
    allProjectIds,
    visibleProjectIds,
    knownProjectIds,
    onCommitProjectOrder: commitProjectOrder,
    getScrollContainer,
  });
  const cardDrag = useWorktreeCardDrag({
    visibleCardIdsByProject,
    fullCardIdsByProject,
    onCommitWorktreeOrder: commitWorktreeOrder,
    getScrollContainer,
  });
  // Workspace options' Hide filters apply to what's *rendered*, never to
  // the drag geometry above (allProjectIds/visibleProjectIds/
  // visibleCardIdsByProject stay driven by `active`): a card hidden by a
  // filter simply isn't drawn to pick up, and its position in the
  // underlying manual order is untouched, so turning a filter back off
  // restores it exactly where it was.
  const hideFiltered = useMemo(
    () =>
      active.map((group) => ({
        ...group,
        worktrees: applyWorkspaceHideFilters(
          group.worktrees,
          group.project,
          sessions,
          workspaceOptions.hide,
        ),
      })),
    [active, sessions, workspaceOptions.hide],
  );
  // "Group by: None"/"Repo" both keep every worktree under its own real
  // ProjectGroup (ProjectRow's `hideHeader` is what drops the header text
  // for "None" -- see that component's own doc), so every card's
  // remove/rename/settings action keeps targeting its real project.
  const displayed = useMemo(
    () =>
      hideFiltered.map((group) => ({
        ...group,
        worktrees: sortWorktreesForDisplay(
          group.worktrees,
          workspaceOptions.sortBy,
          (worktree) => latestWorktreeActivityAt(worktree, sessions),
          // Every worktree in one `group` shares that group's own real
          // project by construction (project-adapter.ts's
          // groupProjectWorktrees), so Sort by "Repo" is a no-op here
          // (see `sortEntriesForDisplay` below for where it actually
          // matters: the two cross-project regroupings).
          () => group.project.name,
        ),
      })),
    [hideFiltered, sessions, workspaceOptions.sortBy],
  );
  // Cross-project regrouping (real, tested helpers in
  // workspace-options-state.ts/workspace-pr-status.ts): each entry keeps
  // its OWN real project (never a synthetic/borrowed one), so actions and
  // card/header labels stay correct regardless of which bucket visually
  // contains the card. Sorted the same way `displayed` is, just over
  // `entries` (which can span projects) instead of one group's worktrees.
  const statusGroups = useMemo(
    () =>
      groupWorktreesByWorkspaceStatus(hideFiltered, sharedPrefs.workspaceStatuses ?? []).map(
        (group) => ({
          ...group,
          entries: sortEntriesForDisplay(group.entries, workspaceOptions.sortBy, (worktree) =>
            latestWorktreeActivityAt(worktree, sessions),
          ),
        }),
      ),
    [hideFiltered, sharedPrefs.workspaceStatuses, workspaceOptions.sortBy, sessions],
  );
  const [pullsByProjectId, setPullsByProjectId] = useState<
    ReadonlyMap<string, readonly TaskPullRequest[] | null>
  >(new Map());
  // Real provider fetch (the existing `tasks.list(mode: "pulls")` bridge,
  // never a new RPC): one call per git project actually shown, cached by
  // project id, only while "PR status" grouping is selected -- never spawn
  // `gh` for a grouping mode the user is not looking at. A folder project
  // has no branch/PR concept at all, so it is seeded straight to `[]`
  // ("no pull request", never queried and never "unavailable" -- that
  // bucket is reserved for a real fetch failure). An unknown/not-yet-
  // fetched git project is left OUT of the map on purpose: `derivePrStatusBucket`
  // treats absence as `unavailable`, distinct from a real empty `none`.
  useEffect(() => {
    if (workspaceOptions.groupBy !== "pr-status" && !workspaceOptions.showProperties.pr) return;
    const bridge = windowTasksBridge(window.drogon);
    if (!bridge.tasksList) return;
    const gitProjectIds = [
      ...new Set(
        hideFiltered
          .filter((group) => group.project.kind === "git")
          .map((group) => group.project.id),
      ),
    ];
    const folderProjectIds = hideFiltered
      .filter((group) => group.project.kind === "folder")
      .map((group) => group.project.id);
    if (folderProjectIds.length > 0) {
      setPullsByProjectId((current) => {
        let changed = false;
        const next = new Map(current);
        for (const id of folderProjectIds) {
          if (!next.has(id)) {
            next.set(id, []);
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }
    const toFetch = gitProjectIds.filter((id) => !pullsByProjectId.has(id));
    if (toFetch.length === 0) return;
    let cancelled = false;
    void Promise.all(
      toFetch.map((projectId) =>
        bridge
          .tasksList!({ projectId, mode: "pulls" })
          .then((result) => [projectId, result.ok ? result.result.pulls ?? [] : null] as const)
          .catch(() => [projectId, null] as const),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setPullsByProjectId((current) => {
        const next = new Map(current);
        for (const [projectId, pulls] of entries) next.set(projectId, pulls);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [hideFiltered, workspaceOptions.groupBy, workspaceOptions.showProperties.pr, pullsByProjectId]);
  const prGroups = useMemo(
    () =>
      groupWorktreesByPrStatus(hideFiltered, pullsByProjectId).map((group) => ({
        ...group,
        entries: sortEntriesForDisplay(group.entries, workspaceOptions.sortBy, (worktree) =>
          latestWorktreeActivityAt(worktree, sessions),
        ),
      })),
    [hideFiltered, pullsByProjectId, workspaceOptions.sortBy, sessions],
  );
  // Shared by both render paths (repo/none's ProjectRow and the two
  // cross-project regroupings' EntryGroupRow) so remove/rename always
  // target the real worktree/project, whichever grouping mode drew the
  // card.
  const handleRemoveWorktree = useCallback(
    (worktree: Worktree) => {
      // The persisted "Don't ask again" preference bypasses the dialog; a
      // failure reopens it so the error stays visible.
      if (readSkipDeleteWorktreeConfirm() && !isImplicitFolderWorktree(worktree)) {
        void onSubmitRemove(worktree, false).then((failure) => {
          if (failure) onOpenAction({ kind: "remove", worktreeId: worktree.id });
        });
        return;
      }
      onOpenAction({ kind: "remove", worktreeId: worktree.id });
    },
    [onOpenAction, onSubmitRemove],
  );
  const handleRemoveProject = useCallback(
    (project: Project) => {
      onOpenAction({ kind: "remove-project", projectId: project.id });
    },
    [onOpenAction],
  );
  return (
    <section ref={sectionRef} className="shell-projects">
      <div className="mt-2 flex h-8 min-w-0 items-center justify-between gap-1.5 px-2">
        <div className="flex min-w-0 items-center gap-1">
          <span
            className="select-none pl-2 pr-0.5 text-xs font-semibold text-muted-foreground/80"
            data-sidebar-section-title="projects"
          >
            Projects
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <HeaderIconButton
            label={activityLabel}
            active={activityOnly}
            onClick={() => setActivityOnly((value) => !value)}
          >
            <Bell className="size-3.5" strokeWidth={2.25} />
          </HeaderIconButton>
          {wide ? (
            <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <DropdownMenu.Trigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      className="relative size-6 text-muted-foreground"
                      aria-label={optionsLabel}
                    >
                      <SlidersHorizontal
                        className="size-3.5"
                        strokeWidth={2.25}
                      />
                      {hasAnyFilter && (
                        <span
                          aria-hidden
                          className="absolute -top-0.5 -right-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-none text-primary-foreground"
                        >
                          {activeFilterCount > 9 ? "9+" : activeFilterCount}
                        </span>
                      )}
                    </Button>
                  </DropdownMenu.Trigger>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    className="tooltip"
                    side="bottom"
                    sideOffset={6}
                  >
                    {optionsLabel}
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="sidebar-menu"
                  side="right"
                  align="start"
                  sideOffset={8}
                >
                  <OptionsMenuContent
                    groups={groups}
                    selectedProjectIds={selectedProjectIds}
                    onToggleProject={toggleProject}
                    onClearProjects={() => setSelectedProjectIds([])}
                    filter={filter}
                    onFilterChange={setFilter}
                    addDisabled={addDisabled}
                    onAddProject={onAddProject}
                    workspaceOptions={workspaceOptions}
                    onWorkspaceOptionsChange={commitWorkspaceOptions}
                  />
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : null}
          <HeaderIconButton
            label="New workspace"
            onClick={() => onCreateWorkspace()}
            disabled={addDisabled}
          >
            <span data-contextual-tour-target="workspace-create-control">
              <Plus className="size-3.5" strokeWidth={2.25} />
            </span>
          </HeaderIconButton>
          {wide ? null : (
            <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <DropdownMenu.Trigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      className="relative size-6 text-muted-foreground"
                      aria-label="More workspace actions"
                    >
                      <Ellipsis className="size-3.5" strokeWidth={2.25} />
                      {hasAnyFilter && (
                        <span
                          aria-hidden
                          className="absolute -top-0.5 -right-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-none text-primary-foreground"
                        >
                          {activeFilterCount > 9 ? "9+" : activeFilterCount}
                        </span>
                      )}
                    </Button>
                  </DropdownMenu.Trigger>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    className="tooltip"
                    side="bottom"
                    sideOffset={6}
                  >
                    More workspace actions
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="sidebar-menu"
                  side="right"
                  align="start"
                  sideOffset={8}
                >
                  <OptionsMenuContent
                    groups={groups}
                    selectedProjectIds={selectedProjectIds}
                    onToggleProject={toggleProject}
                    onClearProjects={() => setSelectedProjectIds([])}
                    filter={filter}
                    onFilterChange={setFilter}
                    addDisabled={addDisabled}
                    onAddProject={onAddProject}
                    workspaceOptions={workspaceOptions}
                    onWorkspaceOptionsChange={commitWorkspaceOptions}
                  />
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
        </div>
      </div>
      {action?.kind === "add" && (
        <AddProjectDialog
          disabled={disabled}
          onBrowse={onBrowse}
          onSubmit={onSubmitAdd}
          onClose={onCloseAction}
        />
      )}
      {projectDrag.state.draggingProjectId !== null &&
      projectDrag.state.dropIndicatorY !== null ? (
        <SidebarDropIndicator y={projectDrag.state.dropIndicatorY} />
      ) : null}
      {cardDrag.state.draggingWorktreeId !== null &&
      cardDrag.state.dropIndicatorY !== null ? (
        <SidebarDropIndicator y={cardDrag.state.dropIndicatorY} />
      ) : null}
      {workspaceOptions.groupBy === "workspace-status" ||
      workspaceOptions.groupBy === "pr-status" ? (
        (workspaceOptions.groupBy === "workspace-status" ? statusGroups : prGroups).map(
          (group) => (
            <EntryGroupRow
              key={group.key}
              group={group}
              portsByWorkspaceId={portsByWorkspaceId}
              issueLinksByWorktree={issueLinksByWorktree}
              pullsByProjectId={pullsByProjectId}
              cardOptions={workspaceOptions}
              showBranch={workspaceOptions.showProperties.branch}
              showPr={workspaceOptions.showProperties.pr}
              cardLayout={workspaceOptions.cardLayout}
              workspaces={workspaces}
              sessions={sessions}
              selectedWorkspaceId={selectedWorkspaceId}
              disabled={disabled}
              worktreesAvailable={worktreesAvailable}
              onSelectWorkspace={onSelectWorkspace}
              activeSessionId={activeSessionId}
              tabStrip={tabStrip}
              onSelectSession={onSelectSession}
              onRemoveWorktree={handleRemoveWorktree}
              onRenameWorktree={(worktree, name) => onSubmitRename(worktree, name)}
              onRemoveProject={handleRemoveProject}
            />
          ),
        )
      ) : (
        displayed.map((group, headerIndex) => (
          <ProjectRow
            key={group.project.id}
            group={group}
            hideHeader={workspaceOptions.groupBy === "none"}
            portsByWorkspaceId={portsByWorkspaceId}
            issueLinksByWorktree={issueLinksByWorktree}
            pullsByProjectId={pullsByProjectId}
            cardOptions={workspaceOptions}
            showBranch={workspaceOptions.showProperties.branch}
            showPr={workspaceOptions.showProperties.pr}
            cardLayout={workspaceOptions.cardLayout}
            headerIndex={headerIndex}
            workspaces={workspaces}
            sessions={sessions}
            selectedWorkspaceId={selectedWorkspaceId}
            disabled={disabled}
            worktreesAvailable={worktreesAvailable}
            onProjectHandlePointerDown={projectDrag.onHandlePointerDown}
            onCardPointerDown={cardDrag.onCardPointerDown}
            onCardClickCapture={cardDrag.onCardClickCapture}
            onSelectWorkspace={onSelectWorkspace}
            activeSessionId={activeSessionId}
            tabStrip={tabStrip}
            onSelectSession={onSelectSession}
            onNewWorktree={() => onCreateWorkspace(group.project.id)}
            onRemoveWorktree={handleRemoveWorktree}
            onRenameWorktree={(worktree, name) => onSubmitRename(worktree, name)}
            onOpenProjectSettings={onOpenProjectSettings}
            onRemoveProject={handleRemoveProject}
          />
        ))
      )}
      {removeTarget && (
        <DeleteWorktreeDialog
          worktree={removeTarget}
          workspaces={workspaces}
          disabled={disabled}
          isFolderWorkspaceDelete={isImplicitFolderWorktree(removeTarget)}
          onSubmit={(force) => onSubmitRemove(removeTarget, force)}
          onClose={onCloseAction}
        />
      )}
      {removeProjectTarget && (
        <RemoveProjectDialog
          project={removeProjectTarget}
          disabled={disabled}
          onSubmit={onSubmitRemoveProject}
          onClose={onCloseAction}
        />
      )}
      {active.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center text-[11px] text-muted-foreground">
          <span>No workspaces found</span>
          {(hasAnyFilter || activityOnly) && (
            <Button
              variant="secondary"
              size="sm"
              className="gap-1.5 border border-border/80 text-[11px]"
              onClick={clearFilters}
            >
              <CircleX className="size-3.5" />
              Clear Filters
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/** Groups with at least one live session on any of their worktrees. */
function groupHasLiveSession(
  group: ProjectGroup,
  sessions: Session[],
): boolean {
  const ids = new Set(group.worktrees.map((worktree) => worktree.workspaceId));
  return sessions.some(
    (session) => session.verdict === "live" && ids.has(session.workspaceId),
  );
}

function findWorktree(
  groups: ProjectGroup[],
  action: ProjectAction | null,
): Worktree | null {
  if (action?.kind !== "remove") return null;
  for (const group of groups)
    for (const worktree of group.worktrees)
      if (worktree.id === action.worktreeId) return worktree;
  return null;
}

function findProject(
  groups: ProjectGroup[],
  action: ProjectAction | null,
): Project | null {
  if (action?.kind !== "remove-project") return null;
  return (
    groups.find((group) => group.project.id === action.projectId)?.project ??
    null
  );
}

/**
 * Renders one cross-project bucket (Workspace Options "Group by:
 * Workspace status"/"PR status" -- workspace-options-state.ts's
 * `WorkspaceEntryGroup`). Deliberately simpler than `ProjectRow`: the
 * header is a plain label (no project-header drag, no "New worktree", no
 * project-settings/remove menu -- none of those apply to a synthetic
 * bucket), but every card below still resolves its remove/rename target
 * through its OWN real `project` from the entry, exactly like `ProjectRow`
 * does for a real project group. No card drag in this mode: a manual
 * order across buckets that do not correspond to any one project has no
 * coherent meaning, so `onCardPointerDown`/`onCardClickCapture` are no-ops
 * here rather than wired to `useWorktreeCardDrag`.
 */
function EntryGroupRow({
  group,
  issueLinksByWorktree,
  workspaces,
  sessions,
  selectedWorkspaceId,
  disabled,
  worktreesAvailable,
  onSelectWorkspace,
  activeSessionId,
  tabStrip,
  onSelectSession,
  onRemoveWorktree,
  onRenameWorktree,
  onRemoveProject,
  portsByWorkspaceId,
  pullsByProjectId,
  cardOptions,
  showBranch = true,
  showPr = true,
  cardLayout = "comfortable",
}: {
  group: WorkspaceEntryGroup;
  issueLinksByWorktree?: ReadonlyMap<string, readonly WorktreeIssueLink[]>;
  workspaces: Workspace[];
  sessions: Session[];
  selectedWorkspaceId: string;
  activeSessionId: string;
  tabStrip: TabStripState;
  onSelectSession: (sessionId: string) => void;
  disabled: boolean;
  worktreesAvailable: boolean;
  onSelectWorkspace: (workspaceId: string) => void;
  onRemoveWorktree: (worktree: Worktree) => void;
  onRenameWorktree: (
    worktree: Worktree,
    name: string,
  ) => Promise<string | null>;
  onRemoveProject: (project: Project) => void;
  portsByWorkspaceId?: ReadonlyMap<string, readonly number[]>;
  pullsByProjectId?: ReadonlyMap<string, readonly TaskPullRequest[] | null>;
  cardOptions?: Pick<WorkspaceOptionsState, "showProperties" | "agentActivityDisplayMode">;
  showBranch?: boolean;
  showPr?: boolean;
  cardLayout?: "comfortable" | "compact";
}) {
  return (
    <div className="shell-project">
      <div
        className="shell-project-row group relative"
        data-entry-group-key={group.key}
      >
        <span className="shell-project-name">{group.label}</span>
      </div>
      <div className="shell-project-cards">
        {group.entries.map(({ worktree, project }, index) => {
          const implicitFolderWorktree = isImplicitFolderWorktree(worktree);
          const primaryCheckout =
            project.kind === "git" && worktree.path === project.path;
          return (
            <div
              key={worktree.id}
              className={
                cardLayout === "compact" ? "shell-workspace-card-compact" : undefined
              }
            >
              <WorktreeCard
                worktree={worktree}
                primaryCheckout={primaryCheckout}
                workspaces={workspaces}
                sessions={sessions}
                selected={worktree.workspaceId === selectedWorkspaceId}
                disabled={disabled}
                projectKind={project.kind}
                implicitFolderWorktree={implicitFolderWorktree}
                cardIndex={index}
                onCardPointerDown={() => {}}
                onCardClickCapture={() => {}}
                onSelect={onSelectWorkspace}
                onSelectSession={onSelectSession}
                activeSessionId={activeSessionId}
                tabStrip={tabStrip}
                showBranch={showBranch}
                showPr={showPr}
                ports={portsByWorkspaceId?.get(worktree.workspaceId)}
                issueLinks={issueLinksByWorktree?.get(worktree.id)}
                pr={resolveCardPullRequest(worktree, pullsByProjectId?.get(project.id) ?? [])}
                {...cardOptions}
                onRemove={
                  !worktreesAvailable
                    ? null
                    : implicitFolderWorktree || primaryCheckout
                      ? () => onRemoveProject(project)
                      : () => onRemoveWorktree(worktree)
                }
                onRename={
                  worktreesAvailable && !implicitFolderWorktree
                    ? (name) => onRenameWorktree(worktree, name)
                    : null
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProjectRow({
  group,
  issueLinksByWorktree,
  headerIndex,
  workspaces,
  sessions,
  selectedWorkspaceId,
  disabled,
  worktreesAvailable,
  onProjectHandlePointerDown,
  onCardPointerDown,
  onCardClickCapture,
  onSelectWorkspace,
  activeSessionId,
  tabStrip,
  onSelectSession,
  onNewWorktree,
  onRemoveWorktree,
  onRenameWorktree,
  onOpenProjectSettings,
  onRemoveProject,
  hideHeader = false,
  portsByWorkspaceId,
  pullsByProjectId,
  cardOptions,
  showBranch = true,
  showPr = true,
  cardLayout = "comfortable",
}: {
  group: ProjectGroup;
  issueLinksByWorktree?: ReadonlyMap<string, readonly WorktreeIssueLink[]>;
  /** Index among the rendered project headers (drag geometry). */
  headerIndex: number;
  workspaces: Workspace[];
  sessions: Session[];
  selectedWorkspaceId: string;
  activeSessionId: string;
  tabStrip: TabStripState;
  onSelectSession: (sessionId: string) => void;
  disabled: boolean;
  worktreesAvailable: boolean;
  onProjectHandlePointerDown: (
    event: React.PointerEvent<HTMLElement>,
    projectId: string,
  ) => void;
  onCardPointerDown: (
    event: React.PointerEvent<HTMLElement>,
    projectId: string,
    worktreeId: string,
  ) => void;
  onCardClickCapture: (event: React.MouseEvent<HTMLElement>) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onNewWorktree: () => void;
  onRemoveWorktree: (worktree: Worktree) => void;
  onRenameWorktree: (
    worktree: Worktree,
    name: string,
  ) => Promise<string | null>;
  onOpenProjectSettings: (project: Project) => void;
  onRemoveProject: (project: Project) => void;
  /** Workspace options "Group by: None" (workspace-options-state.ts):
   *  renders this project's cards with no header row, so consecutive
   *  projects read as one flat list. Every handler below is still wired
   *  to the *real* project (unlike a synthetic merged group), so per-card
   *  remove/rename/settings keep acting on the correct project even
   *  though its name and kebab menu are not shown here. */
  hideHeader?: boolean;
  /** Workspace options "Show properties" -- passed straight through to
   *  each card (WorktreeCard's own doc comment). */
  showBranch?: boolean;
  showPr?: boolean;
  portsByWorkspaceId?: ReadonlyMap<string, readonly number[]>;
  pullsByProjectId?: ReadonlyMap<string, readonly TaskPullRequest[] | null>;
  cardOptions?: Pick<WorkspaceOptionsState, "showProperties" | "agentActivityDisplayMode">;
  /** Workspace options "Card layout": toggles a density class on each
   *  card's wrapper only -- WorktreeCard's own markup is untouched. */
  cardLayout?: "comfortable" | "compact";
}) {
  const project: Project = group.project;
  const canCreate =
    worktreesAvailable &&
    project.kind === "git" &&
    !project.id.startsWith("folder:");
  return (
    <div className="shell-project">
      {hideHeader ? null : (
      <div
        className="shell-project-row group relative"
        title={project.path}
        data-project-header-id={project.id}
        data-project-header-index={headerIndex}
        data-project-header-drag-handle=""
        onPointerDown={(event) => onProjectHandlePointerDown(event, project.id)}
      >
        {project.kind === "git" ? (
          <FolderGit2 size={15} aria-hidden="true" />
        ) : null}
        <span className="shell-project-name">{project.name}</span>
        <div
          className={PROJECT_HEADER_ACTIONS_CLASS_NAME}
          data-project-header-actions=""
        >
          {canCreate && (
            <button
              type="button"
              className="shell-icon-button"
              data-project-header-action=""
              aria-label={`Create new worktree for ${project.name}`}
              title={`Create new worktree for ${project.name}`}
              disabled={disabled}
              onClick={onNewWorktree}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Plus size={15} />
            </button>
          )}
          <ProjectActionsMenu
            project={project}
            disabled={disabled}
            onOpenSettings={onOpenProjectSettings}
            onRemove={onRemoveProject}
          />
        </div>
      </div>
      )}
      <div className="shell-project-cards">
        {(() => {
          let cardIndex = 0;
          const renderCard = (
            worktree: Worktree,
            depth: number,
          ): React.JSX.Element => {
            const currentIndex = cardIndex++;
            const implicitFolderWorktree = isImplicitFolderWorktree(worktree);
            const primaryCheckout =
              project.kind === "git" && worktree.path === project.path;
            return (
              <div
                key={worktree.id}
                className={[
                  depth > 0 ? "ml-3 border-l border-border/50 pl-2" : "",
                  cardLayout === "compact" ? "shell-workspace-card-compact" : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined}
                data-worktree-nesting-depth={depth}
              >
                <WorktreeCard
                  worktree={worktree}
                  primaryCheckout={primaryCheckout}
                  workspaces={workspaces}
                  sessions={sessions}
                  selected={worktree.workspaceId === selectedWorkspaceId}
                  disabled={disabled}
                  projectKind={project.kind}
                  implicitFolderWorktree={implicitFolderWorktree}
                  cardIndex={currentIndex}
                  onCardPointerDown={(event) =>
                    onCardPointerDown(event, project.id, worktree.id)
                  }
                  onCardClickCapture={onCardClickCapture}
                  onSelect={onSelectWorkspace}
                  onSelectSession={onSelectSession}
                  activeSessionId={activeSessionId}
                  tabStrip={tabStrip}
                  showBranch={showBranch}
                  showPr={showPr}
                  ports={portsByWorkspaceId?.get(worktree.workspaceId)}
                  issueLinks={issueLinksByWorktree?.get(worktree.id)}
                  pr={resolveCardPullRequest(worktree, pullsByProjectId?.get(project.id) ?? [])}
                  {...cardOptions}
                  onRemove={
                    !worktreesAvailable
                      ? null
                      : implicitFolderWorktree || primaryCheckout
                        ? () => onRemoveProject(project)
                        : () => onRemoveWorktree(worktree)
                  }
                  onRename={
                    worktreesAvailable && !implicitFolderWorktree
                      ? (name) => onRenameWorktree(worktree, name)
                      : null
                  }
                />
              </div>
            );
          };
          return nestProjectWorktrees(group.worktrees).map(
            ({ worktree, depth }) => renderCard(worktree, depth),
          );
        })()}
      </div>
    </div>
  );
}

/** Folder projects expose one implicit worktree (the folder itself). */
function isImplicitFolderWorktree(worktree: Worktree): boolean {
  return (
    worktree.id.startsWith("implicit:") ||
    worktree.projectId.startsWith("folder:")
  );
}
