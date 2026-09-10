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
import { useCallback, useMemo, useRef, useState } from "react";
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
import { filterProjectGroups, nestProjectWorktrees } from "./project-adapter";
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
  applyStoredSidebarOrder,
  loadSidebarProjectOrder,
  loadSidebarWorktreeOrder,
  orderedProjectIds,
  saveSidebarProjectOrder,
  saveSidebarWorktreeOrder,
} from "./sidebar-order";
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

function readStoredWorktreeOrder(): Record<string, string[]> {
  if (typeof localStorage === "undefined") return {};
  return loadSidebarWorktreeOrder(localStorage);
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
}: {
  groups: ProjectGroup[];
  selectedProjectIds: readonly string[];
  onToggleProject: (projectId: string) => void;
  onClearProjects: () => void;
  filter: string;
  onFilterChange: (value: string) => void;
  addDisabled: boolean;
  onAddProject: () => void;
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
  // Persisted manual order (fork parity: pointer drag on headers/cards).
  // Applied before filtering so a reorder survives reload; the stored
  // lists only ever reorder ids the daemon still advertises.
  const [projectOrder, setProjectOrder] = useState<string[]>(
    readStoredProjectOrder,
  );
  const [worktreeOrder, setWorktreeOrder] = useState<Record<string, string[]>>(
    readStoredWorktreeOrder,
  );
  const sectionRef = useRef<HTMLElement | null>(null);
  const getScrollContainer = useCallback(
    (): HTMLElement | null =>
      (sectionRef.current?.closest(
        ".shell-sidebar-scroll",
      ) as HTMLElement | null) ?? null,
    [],
  );
  const ordered = useMemo(
    () => applyStoredSidebarOrder(groups, projectOrder, worktreeOrder),
    [groups, projectOrder, worktreeOrder],
  );
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
  const commitWorktreeOrder = useCallback(
    (projectId: string, next: string[]) => {
      setWorktreeOrder((current) => {
        const updated = { ...current, [projectId]: next };
        if (typeof localStorage !== "undefined")
          saveSidebarWorktreeOrder(localStorage, updated);
        return updated;
      });
    },
    [],
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
      {active.map((group, headerIndex) => (
        <ProjectRow
          key={group.project.id}
          group={group}
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
          onRemoveWorktree={(worktree) => {
            // The persisted "Don't ask again" preference bypasses the
            // dialog; a failure reopens it so the error stays visible.
            if (
              readSkipDeleteWorktreeConfirm() &&
              !isImplicitFolderWorktree(worktree)
            ) {
              void onSubmitRemove(worktree, false).then((failure) => {
                if (failure)
                  onOpenAction({ kind: "remove", worktreeId: worktree.id });
              });
              return;
            }
            onOpenAction({ kind: "remove", worktreeId: worktree.id });
          }}
          onRenameWorktree={(worktree, name) => onSubmitRename(worktree, name)}
          onOpenProjectSettings={onOpenProjectSettings}
          onRemoveProject={(project) =>
            onOpenAction({ kind: "remove-project", projectId: project.id })
          }
        />
      ))}
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

function ProjectRow({
  group,
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
}: {
  group: ProjectGroup;
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
}) {
  const project: Project = group.project;
  const canCreate =
    worktreesAvailable &&
    project.kind === "git" &&
    !project.id.startsWith("folder:");
  return (
    <div className="shell-project">
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
                className={
                  depth > 0 ? "ml-3 border-l border-border/50 pl-2" : undefined
                }
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
