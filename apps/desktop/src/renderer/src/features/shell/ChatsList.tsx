/* MIT Copyright (c) 2026 Lovecast Inc.
   User-feature-closure item 3: standalone quick sessions ("Chats") had no
   sidebar surface at all — Sidebar.tsx filters every `project.quickSession`
   group out of ProjectList (`groups.filter((group) => !group.project.quickSession)`)
   and nothing else rendered them, so a created quick session (real,
   durable `projects` row — project.rs's `do_project_quick_session_create`)
   was invisible until reopened through the composer. This section renders
   below ProjectList (Sidebar mounts it after) and reuses the exact same
   WorktreeCard/RemoveProjectDialog primitives ProjectList already uses for
   every other folder project — same selection, same session rows, same
   agent-state indicator, same confirmation-before-delete flow — so a Chat
   behaves like any other card except for the copy naming what deleting it
   actually does (see remove-project-dialog-copy.ts).

   A real duplication existed here: the pre-existing RecentSessions section
   (features/sessions/RecentSessions.tsx)
   already listed every quick-session group -- unconditionally, its whole
   `groups.filter((g) => g.project.quickSession)` -- above Projects, with a
   "New session" trigger and no delete affordance. Sidebar mounted it AND
   this component, so every Chat rendered twice. RecentSessions is now
   unmounted (its own file deleted -- nothing else referenced it); this
   header absorbs its create-a-Chat entry point (`onCreate`, wired from
   Sidebar's existing `onNewSession`/App.tsx's NewSessionDialog trigger, the
   exact same handler RecentSessions used to call) so a Chat has exactly
   one home and creating one still works from that home. The header (and
   its create button) always renders, even with zero Chats yet -- otherwise
   the only way to make the first one would disappear along with the empty
   list. */
import { useState } from "react";
import { SquarePen } from "lucide-react";
import type {
  Project,
  Session,
  Workspace,
} from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";
import { RemoveProjectDialog } from "./RemoveProjectDialog";
import type { TabStripState } from "./tab-order";
import { WorktreeCard } from "./WorktreeCard";

export function ChatsList({
  groups,
  workspaces,
  sessions,
  selectedWorkspaceId,
  activeSessionId,
  tabStrip,
  disabled,
  onSelectWorkspace,
  onSelectSession,
  onSubmitRemove,
  onCreate,
}: {
  /** Every quick-session group, unfiltered by the caller's own criteria —
   *  Sidebar passes `groups.filter((g) => g.project.quickSession)`. */
  groups: ProjectGroup[];
  workspaces: Workspace[];
  sessions: Session[];
  selectedWorkspaceId: string | null;
  activeSessionId?: string;
  tabStrip?: TabStripState;
  disabled: boolean;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectSession?: (sessionId: string) => void;
  /** Same daemon call as ProjectList's regular project removal
   *  (project.remove); the daemon itself decides the file-deletion
   *  semantics per project kind (see project.rs's cleanup_quick_session_scratch). */
  onSubmitRemove: (project: Project) => Promise<string | null>;
  /** Opens the New Chat (quick session) dialog -- RecentSessions' former
   *  "New session" trigger. Null hides the header button (parity with
   *  Sidebar's own `onNewSession && <RecentSessions .../>` guard). */
  onCreate: (() => void) | null;
}): React.JSX.Element {
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  return (
    <div className="shell-chats" data-testid="sidebar-chats-section">
      <div className="shell-chats-header mt-2 flex h-8 min-w-0 items-center justify-between gap-1.5 px-2">
        <span
          className="select-none pl-2 pr-0.5 text-xs font-semibold text-muted-foreground/80"
          data-sidebar-section-title="chats"
        >
          Chats
        </span>
        {onCreate && (
          <button
            type="button"
            aria-label="New chat"
            title="New chat"
            disabled={disabled}
            onClick={onCreate}
            className="shell-icon-button"
          >
            <SquarePen size={15} />
          </button>
        )}
      </div>
      {groups.length === 0 && (
        <p className="px-4 py-2 text-[11px] text-muted-foreground">
          No chats yet
        </p>
      )}
      {groups.map((group) => {
        // A folder project's implicit worktree (worktree.list synthesizes
        // exactly one, id === project.id — worktree_rpc.rs's do_worktree_list);
        // App.tsx's project.list + worktree.list combine is what actually
        // populates this, same as every other folder project ProjectList
        // renders. No worktree yet (e.g. the very first fetch after
        // creation) means nothing to select — skip, don't render a dead row.
        const worktree = group.worktrees[0];
        if (!worktree) return null;
        return (
          <WorktreeCard
            key={group.project.id}
            worktree={worktree}
            workspaces={workspaces}
            sessions={sessions}
            selected={worktree.workspaceId === selectedWorkspaceId}
            disabled={disabled}
            projectKind={group.project.kind}
            implicitFolderWorktree
            onSelect={onSelectWorkspace}
            onSelectSession={onSelectSession ?? null}
            activeSessionId={activeSessionId}
            tabStrip={tabStrip}
            onRemove={() => setRemoveTarget(group.project)}
            onRename={null}
          />
        );
      })}
      {removeTarget && (
        <RemoveProjectDialog
          project={removeTarget}
          disabled={disabled}
          onSubmit={async (project) => {
            const failure = await onSubmitRemove(project);
            if (!failure) setRemoveTarget(null);
            return failure;
          }}
          onClose={() => setRemoveTarget(null)}
        />
      )}
    </div>
  );
}
