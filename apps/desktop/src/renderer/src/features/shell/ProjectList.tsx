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
import { useState } from "react";
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
import type { ProjectGroup } from "./project-adapter";
import { filterProjectGroups } from "./project-adapter";
import { isWideSidebarHeader } from "./app-chrome-layout";
import { AddProjectDialog } from "./AddProjectDialog";
import { DeleteWorktreeDialog } from "./DeleteWorktreeDialog";
import { readSkipDeleteWorktreeConfirm } from "./DeleteWorktreeSkipConfirmOption";
import { WorktreeCard } from "./WorktreeCard";

/** Which project dialog the sidebar currently shows, if any. */
export type ProjectAction =
  | { kind: "add" }
  | { kind: "remove"; worktreeId: string };

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

/** The options menu body: Add Project plus this repo's text filter. */
function OptionsMenuContent({
  filter,
  onFilterChange,
  addDisabled,
  onAddProject,
}: {
  filter: string;
  onFilterChange: (value: string) => void;
  addDisabled: boolean;
  onAddProject: () => void;
}): React.JSX.Element {
  return (
    <>
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
  onBrowse,
  onSubmitAdd,
  onSubmitRemove,
  onSubmitRename,
}: {
  groups: ProjectGroup[];
  workspaces: Workspace[];
  sessions: Session[];
  selectedWorkspaceId: string;
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
  onBrowse: () => Promise<string | null>;
  onSubmitAdd: (input: {
    path: string;
    name?: string;
  }) => Promise<string | null>;
  onSubmitRemove: (worktree: Worktree, force: boolean) => Promise<string | null>;
  onSubmitRename: (worktree: Worktree, name: string) => Promise<string | null>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [activityOnly, setActivityOnly] = useState(false);
  const visible = filterProjectGroups(groups, workspaces, filter);
  const active = activityOnly
    ? visible.filter((group) => groupHasLiveSession(group, sessions))
    : visible;
  const filterActive = filter.trim() !== "";
  const removeTarget = findWorktree(groups, action);
  const activityLabel = activityOnly ? "Turn off activity view" : "View activity";
  const optionsLabel = filterActive
    ? "Workspace options (1 filter active)"
    : "Workspace options";
  const wide = isWideSidebarHeader(sidebarWidth);
  const clearFilters = () => {
    setFilter("");
    setActivityOnly(false);
  };
  return (
    <section className="shell-projects">
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
                      {filterActive && (
                        <span
                          aria-hidden
                          className="absolute -top-0.5 -right-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-none text-primary-foreground"
                        >
                          1
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
                      {filterActive && (
                        <span
                          aria-hidden
                          className="absolute -top-0.5 -right-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-medium leading-none text-primary-foreground"
                        >
                          1
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
      {active.map((group) => (
        <ProjectRow
          key={group.project.id}
          group={group}
          workspaces={workspaces}
          sessions={sessions}
          selectedWorkspaceId={selectedWorkspaceId}
          disabled={disabled}
          worktreesAvailable={worktreesAvailable}
          onSelectWorkspace={onSelectWorkspace}
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
      {active.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center text-[11px] text-muted-foreground">
          <span>No workspaces found</span>
          {(filterActive || activityOnly) && (
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
  const ids = new Set(
    group.worktrees.map((worktree) => worktree.workspaceId),
  );
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

function ProjectRow({
  group,
  workspaces,
  sessions,
  selectedWorkspaceId,
  disabled,
  worktreesAvailable,
  onSelectWorkspace,
  onNewWorktree,
  onRemoveWorktree,
  onRenameWorktree,
}: {
  group: ProjectGroup;
  workspaces: Workspace[];
  sessions: Session[];
  selectedWorkspaceId: string;
  disabled: boolean;
  worktreesAvailable: boolean;
  onSelectWorkspace: (workspaceId: string) => void;
  onNewWorktree: () => void;
  onRemoveWorktree: (worktree: Worktree) => void;
  onRenameWorktree: (worktree: Worktree, name: string) => Promise<string | null>;
}) {
  const project: Project = group.project;
  const canCreate =
    worktreesAvailable && project.kind === "git" && !project.id.startsWith("folder:");
  return (
    <div className="shell-project">
      <div className="shell-project-row" title={project.path}>
        {project.kind === "git" ? (
          <FolderGit2 size={15} aria-hidden="true" />
        ) : null}
        <span className="shell-project-name">{project.name}</span>
        {canCreate && (
          <button
            type="button"
            className="shell-icon-button"
            aria-label={`New worktree in ${project.name}`}
            title={`New worktree in ${project.name}`}
            disabled={disabled}
            onClick={onNewWorktree}
          >
            <Plus size={15} />
          </button>
        )}
      </div>
      <div className="shell-project-cards">
        {group.worktrees.map((worktree) => (
          <WorktreeCard
            key={worktree.id}
            worktree={worktree}
            workspaces={workspaces}
            sessions={sessions}
            selected={worktree.workspaceId === selectedWorkspaceId}
            disabled={disabled}
            projectKind={project.kind}
            implicitFolderWorktree={isImplicitFolderWorktree(worktree)}
            onSelect={onSelectWorkspace}
            onRemove={
              worktreesAvailable && !isImplicitFolderWorktree(worktree)
                ? () => onRemoveWorktree(worktree)
                : null
            }
            onRename={
              worktreesAvailable && !isImplicitFolderWorktree(worktree)
                ? (name) => onRenameWorktree(worktree, name)
                : null
            }
            onCreateWorktree={canCreate ? () => onNewWorktree() : null}
          />
        ))}
      </div>
    </div>
  );
}

/** Folder projects expose one implicit worktree (the folder itself): nothing to remove. */
function isImplicitFolderWorktree(worktree: Worktree): boolean {
  return worktree.id.startsWith("implicit:") || worktree.projectId.startsWith("folder:");
}
