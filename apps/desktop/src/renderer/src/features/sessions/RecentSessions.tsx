import { SquarePen, SquareTerminal } from "lucide-react";
import type { ProjectGroup } from "../shell/project-adapter";
import type { Workspace } from "../../../../shared/session-contract";

export function RecentSessions({
  groups,
  workspaces,
  selectedWorkspaceId,
  active,
  disabled,
  onSelect,
  onNew,
}: {
  groups: ProjectGroup[];
  workspaces: Workspace[];
  selectedWorkspaceId: string;
  active: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const recent = groups
    .filter((group) => group.project.quickSession)
    .flatMap((group) => {
      const workspace = workspaces.find(
        (item) => item.path === group.project.path,
      );
      return workspace ? [{ project: group.project, workspace }] : [];
    })
    .reverse();
  return (
    <section aria-label="Recent sessions" className="px-2 py-2">
      <div className="mb-1 flex items-center justify-between px-2 text-xs text-muted-foreground">
        <span>Recents</span>
        <button
          aria-label="New session"
          title="New session"
          disabled={disabled}
          onClick={onNew}
          className="rounded p-1 hover:bg-accent disabled:opacity-50"
        >
          <SquarePen size={15} />
        </button>
      </div>
      {recent.map(({ project, workspace }) => (
        <button
          key={workspace.id}
          data-recent-session-workspace={workspace.id}
          disabled={disabled}
          aria-current={
            active && selectedWorkspaceId === workspace.id ? "page" : undefined
          }
          onClick={() => onSelect(workspace.id)}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-worktree-sidebar-accent ${active && selectedWorkspaceId === workspace.id ? "bg-worktree-sidebar-accent text-foreground" : "text-muted-foreground"}`}
        >
          <SquareTerminal size={15} className="shrink-0" />
          <span className="truncate">{project.name}</span>
        </button>
      ))}
      {recent.length === 0 && (
        <p className="px-2 py-2 text-xs text-muted-foreground">
          No sessions yet
        </p>
      )}
    </section>
  );
}
