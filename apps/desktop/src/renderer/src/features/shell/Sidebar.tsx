/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/index.tsx shell recipe and
   SidebarSettingsHelpMenu.tsx footer recipe (adapter: props, no store;
   the worktree list, kanban board and dialogs are this repo's own).
   Like the source this is a plain div, not a landmark: the reference
   sidebar carries no complementary role. */
import { useRef, useState } from "react";
import { LifeBuoy, Settings } from "lucide-react";
import type {
  Session,
  Worktree,
  Workspace,
} from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";
import { SidebarNav } from "./SidebarNav";
import { ProjectList } from "./ProjectList";
import type { ProjectAction } from "./ProjectList";
import { ShellIconButton } from "./ShellIconButton";
import {
  clearLiveSidebarWidth,
  nextSidebarWidth,
  setLiveSidebarWidth,
  SIDEBAR_RESIZE_HANDLE_CLASS_NAME,
  SIDEBAR_RESIZE_HANDLE_LINE_CLASS_NAME,
} from "./sidebar-width";

export function Sidebar({
  open,
  width,
  onWidthChange,
  route,
  onSelectRoute,
  onOpenPalette,
  groups,
  workspaces,
  sessions,
  selectedWorkspaceId,
  workspaceDisabled,
  addDisabled,
  onSelectWorkspace,
  onAddProject,
  onCreateWorkspace,
  worktreesAvailable,
  projectAction,
  onOpenProjectAction,
  onCloseProjectAction,
  onBrowseProject,
  onSubmitAddProject,
  onSubmitRemoveWorktree,
  serviceLabel,
  buildRevision,
  buildTitle,
  onOpenSettings,
  settingsExpanded,
}: {
  open: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  route: string | null;
  onSelectRoute: (route: string | null) => void;
  onOpenPalette: () => void;
  groups: ProjectGroup[];
  workspaces: Workspace[];
  sessions: Session[];
  selectedWorkspaceId: string;
  workspaceDisabled: boolean;
  addDisabled: boolean;
  onSelectWorkspace: (workspaceId: string) => void;
  onAddProject: () => void;
  /** Opens the new-workspace composer, preselected when given a project. */
  onCreateWorkspace: (projectId?: string) => void;
  worktreesAvailable: boolean;
  projectAction: ProjectAction | null;
  onOpenProjectAction: (action: ProjectAction) => void;
  onCloseProjectAction: () => void;
  onBrowseProject: () => Promise<string | null>;
  onSubmitAddProject: (input: {
    path: string;
    name?: string;
  }) => Promise<string | null>;
  onSubmitRemoveWorktree: (
    worktree: Worktree,
    force: boolean,
  ) => Promise<string | null>;
  serviceLabel: string;
  buildRevision: string | null;
  buildTitle?: string;
  onOpenSettings: () => void;
  settingsExpanded: boolean;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef({ startX: 0, startWidth: width });
  dragRef.current.startWidth = resizing ? dragRef.current.startWidth : width;

  const onResizeStart = (event: React.MouseEvent) => {
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: width };
    setResizing(true);
    const onMove = (move: MouseEvent) => {
      setLiveSidebarWidth(
        nextSidebarWidth(dragRef.current.startWidth, dragRef.current.startX, move.clientX),
      );
    };
    const onUp = (up: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setResizing(false);
      clearLiveSidebarWidth();
      onWidthChange(
        nextSidebarWidth(dragRef.current.startWidth, dragRef.current.startX, up.clientX),
      );
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className="workspace-sidebar shell-sidebar relative min-h-0 flex-shrink-0 flex flex-col overflow-hidden"
      style={open ? { width } : { width: 0, borderRightWidth: 0 }}
    >
      {open && (
        <>
          <SidebarNav
            route={route}
            onSelectRoute={onSelectRoute}
            onOpenPalette={onOpenPalette}
          />
          <div className="shell-sidebar-scroll">
            <ProjectList
              groups={groups}
              workspaces={workspaces}
              sessions={sessions}
              selectedWorkspaceId={selectedWorkspaceId}
              disabled={workspaceDisabled}
              addDisabled={addDisabled}
              worktreesAvailable={worktreesAvailable}
              action={projectAction}
              onSelectWorkspace={onSelectWorkspace}
              onAddProject={onAddProject}
              onCreateWorkspace={onCreateWorkspace}
              onOpenAction={onOpenProjectAction}
              onCloseAction={onCloseProjectAction}
              onBrowse={onBrowseProject}
              onSubmitAdd={onSubmitAddProject}
              onSubmitRemove={onSubmitRemoveWorktree}
            />
            {groups.length === 0 && (
              <p className="sidebar-empty">
                Open a folder or repository to begin.
              </p>
            )}
          </div>
          <footer className="sidebar-footer shell-footer">
            <span className="shell-footer-row">
              <span>{serviceLabel}</span>
              <span className="shell-footer-actions">
                <ShellIconButton
                  label="Settings"
                  aria-expanded={settingsExpanded}
                  onClick={onOpenSettings}
                >
                  <Settings size={16} />
                </ShellIconButton>
                <ShellIconButton
                  label="Help"
                  aria-expanded={helpOpen}
                  onClick={() => setHelpOpen((value) => !value)}
                >
                  <LifeBuoy size={16} />
                </ShellIconButton>
              </span>
            </span>
            {buildRevision && (
              <span className="build-revision" title={buildTitle}>
                {buildRevision}
              </span>
            )}
            {helpOpen && (
              <p className="shell-help-popover" role="status">
                Press ⌘J for the worktree palette, ⌘P to jump to a file.
                Sessions stay with the service when this window closes.
              </p>
            )}
          </footer>
        </>
      )}
      {open && (
        <div
          data-sidebar-resize-handle=""
          className={`${SIDEBAR_RESIZE_HANDLE_CLASS_NAME}${resizing ? " bg-ring/10" : ""}`}
          onMouseDown={onResizeStart}
        >
          <div
            className={`${SIDEBAR_RESIZE_HANDLE_LINE_CLASS_NAME}${resizing ? " bg-ring" : ""}`}
          />
        </div>
      )}
    </div>
  );
}
