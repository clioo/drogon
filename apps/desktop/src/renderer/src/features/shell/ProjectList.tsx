/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/SidebarHeader.tsx project-group
   recipe (adapter: props instead of the project store; add opens the
   existing folder form, filter narrows the visible cards). */
import { useState } from "react";
import { FolderGit2, FolderPlus, SlidersHorizontal } from "lucide-react";
import type { Session, Workspace } from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";
import { filterProjectGroups } from "./project-adapter";
import { WorktreeCard } from "./WorktreeCard";

/**
 * Projects section: header with add/filter icons, one row per project
 * with its worktree cards underneath.
 */
export function ProjectList({
  groups,
  workspaces,
  sessions,
  selectedWorkspaceId,
  disabled,
  addDisabled,
  onSelectWorkspace,
  onAddProject,
}: {
  groups: ProjectGroup[];
  workspaces: Workspace[];
  sessions: Session[];
  selectedWorkspaceId: string;
  disabled: boolean;
  addDisabled: boolean;
  onSelectWorkspace: (workspaceId: string) => void;
  onAddProject: () => void;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const visible = filterProjectGroups(groups, workspaces, filter);
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
        <div key={group.project.id} className="shell-project">
          <div className="shell-project-row" title={group.project.path}>
            {group.project.kind === "git" ? (
              <FolderGit2 size={15} aria-hidden="true" />
            ) : null}
            <span className="shell-project-name">{group.project.name}</span>
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
                onSelect={onSelectWorkspace}
              />
            ))}
          </div>
        </div>
      ))}
      {groups.length > 0 && visible.length === 0 && (
        <p className="sidebar-empty">No projects match this filter.</p>
      )}
    </section>
  );
}
