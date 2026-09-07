/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/SidebarHeader.tsx project-group
   recipe (adapter: props instead of the project store; add opens the
   existing folder form, filter narrows the visible cards). */
import { useState } from "react";
import { FolderGit2, FolderPlus, Plus, SlidersHorizontal } from "lucide-react";
import type {
  Project,
  Session,
  Worktree,
  Workspace,
} from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";
import { filterProjectGroups } from "./project-adapter";
import { AddProjectDialog } from "./AddProjectDialog";
import { NewWorktreeForm } from "./NewWorktreeForm";
import { RemoveWorktreeDialog } from "./RemoveWorktreeDialog";
import { WorktreeCard } from "./WorktreeCard";

/** Which project/worktree dialog the sidebar currently shows, if any. */
export type ProjectAction =
  | { kind: "add" }
  | { kind: "worktree"; projectId: string }
  | { kind: "remove"; worktreeId: string };

/**
 * Projects section: header with add/filter icons, one row per project
 * with its worktree cards underneath. Git rows carry a "New worktree"
 * icon that opens the inline form; each removable card's kebab menu
 * opens the remove confirm dialog. All RPCs run in App; every submit
 * resolves a verbatim error string or null on success.
 */
export function ProjectList({
  groups,
  workspaces,
  sessions,
  selectedWorkspaceId,
  disabled,
  addDisabled,
  worktreesAvailable,
  action,
  onSelectWorkspace,
  onAddProject,
  onOpenAction,
  onCloseAction,
  onBrowse,
  onSubmitAdd,
  onSubmitWorktree,
  onSubmitRemove,
}: {
  groups: ProjectGroup[];
  workspaces: Workspace[];
  sessions: Session[];
  selectedWorkspaceId: string;
  disabled: boolean;
  addDisabled: boolean;
  worktreesAvailable: boolean;
  action: ProjectAction | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onAddProject: () => void;
  onOpenAction: (action: ProjectAction) => void;
  onCloseAction: () => void;
  onBrowse: () => Promise<string | null>;
  onSubmitAdd: (input: {
    path: string;
    name?: string;
  }) => Promise<string | null>;
  onSubmitWorktree: (input: {
    projectId: string;
    name: string;
    baseRef?: string;
  }) => Promise<string | null>;
  onSubmitRemove: (worktree: Worktree, force: boolean) => Promise<string | null>;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const visible = filterProjectGroups(groups, workspaces, filter);
  const removeTarget = findWorktree(groups, action);
  return (
    <section aria-label="Projects" className="shell-projects">
      <div className="shell-section-header">
        <span>Projects</span>
        <span className="shell-section-actions">
          <button
            type="button"
            className="shell-icon-button"
            aria-label="Add project"
            aria-expanded={undefined}
            disabled={addDisabled}
            title="Add a folder or repository"
            onClick={onAddProject}
          >
            <FolderPlus size={15} />
          </button>
          <button
            type="button"
            className="shell-icon-button"
            aria-label="Filter projects"
            aria-expanded={filterOpen}
            title="Filter projects and worktrees"
            onClick={() => {
              setFilterOpen((value) => !value);
              setFilter("");
            }}
          >
            <SlidersHorizontal size={15} />
          </button>
        </span>
      </div>
      {action?.kind === "add" && (
        <AddProjectDialog
          disabled={disabled}
          onBrowse={onBrowse}
          onSubmit={onSubmitAdd}
          onClose={onCloseAction}
        />
      )}
      {filterOpen && (
        <input
          className="shell-filter-input"
          aria-label="Filter projects and worktrees"
          placeholder="Filter projects…"
          autoFocus
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      )}
      {visible.map((group) => (
        <ProjectRow
          key={group.project.id}
          group={group}
          workspaces={workspaces}
          sessions={sessions}
          selectedWorkspaceId={selectedWorkspaceId}
          disabled={disabled}
          worktreesAvailable={worktreesAvailable}
          worktreeFormOpen={
            action?.kind === "worktree" && action.projectId === group.project.id
          }
          onSelectWorkspace={onSelectWorkspace}
          onNewWorktree={() =>
            onOpenAction({ kind: "worktree", projectId: group.project.id })
          }
          onCloseWorktree={onCloseAction}
          onSubmitWorktree={onSubmitWorktree}
          onRemoveWorktree={(worktree) =>
            onOpenAction({ kind: "remove", worktreeId: worktree.id })
          }
        />
      ))}
      {removeTarget && (
        <RemoveWorktreeDialog
          worktree={removeTarget}
          workspaces={workspaces}
          disabled={disabled}
          onSubmit={(force) => onSubmitRemove(removeTarget, force)}
          onClose={onCloseAction}
        />
      )}
      {groups.length > 0 && visible.length === 0 && (
        <p className="sidebar-empty">No projects match this filter.</p>
      )}
    </section>
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
  worktreeFormOpen,
  onSelectWorkspace,
  onNewWorktree,
  onCloseWorktree,
  onSubmitWorktree,
  onRemoveWorktree,
}: {
  group: ProjectGroup;
  workspaces: Workspace[];
  sessions: Session[];
  selectedWorkspaceId: string;
  disabled: boolean;
  worktreesAvailable: boolean;
  worktreeFormOpen: boolean;
  onSelectWorkspace: (workspaceId: string) => void;
  onNewWorktree: () => void;
  onCloseWorktree: () => void;
  onSubmitWorktree: (input: {
    projectId: string;
    name: string;
    baseRef?: string;
  }) => Promise<string | null>;
  onRemoveWorktree: (worktree: Worktree) => void;
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
            aria-expanded={worktreeFormOpen}
            title={`New worktree in ${project.name}`}
            disabled={disabled}
            onClick={onNewWorktree}
          >
            <Plus size={15} />
          </button>
        )}
      </div>
      {worktreeFormOpen && (
        <NewWorktreeForm
          project={project}
          disabled={disabled}
          onSubmit={onSubmitWorktree}
          onClose={onCloseWorktree}
        />
      )}
      <div className="shell-project-cards">
        {group.worktrees.map((worktree) => (
          <WorktreeCard
            key={worktree.id}
            worktree={worktree}
            workspaces={workspaces}
            sessions={sessions}
            selected={worktree.workspaceId === selectedWorkspaceId}
            disabled={disabled}
            onSelect={onSelectWorkspace}
            onRemove={
              worktreesAvailable && !isImplicitFolderWorktree(worktree)
                ? () => onRemoveWorktree(worktree)
                : null
            }
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
