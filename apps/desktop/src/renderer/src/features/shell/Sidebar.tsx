/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/index.tsx shell recipe and
   SidebarToolbar.tsx footer recipe (adapter: props, no store; the
   worktree list, kanban board and dialogs are this repo's own).
   Like the source this is a plain div, not a landmark: the reference
   sidebar carries no complementary role. */
import { useRef, useState } from "react";
import type {
  Project,
  Session,
  Worktree,
  Workspace,
} from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";
import { SidebarNav } from "./SidebarNav";
import type { TabStripState } from "./tab-order";
import { ProjectList } from "./ProjectList";
import type { ProjectAction } from "./ProjectList";
import { SidebarFooter } from "./sidebar-footer";
import type { SettingsSectionId } from "../settings/settings-sections";
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
  activeSessionId,
  tabStrip,
  onSelectSession,
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
  onSubmitRemoveProject,
  onSubmitRenameWorktree,
  onOpenProjectSettings,
  onOpenSettings,
  showTasksButton = true,
  showAutomationsButton = true,
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
  /** Active session tab id for the card rows' focused highlight. */
  activeSessionId: string;
  /** Strip order/pins/renames so card rows read exactly like tab titles. */
  tabStrip: TabStripState;
  /** Selects a session tab when a nested card row is clicked. */
  onSelectSession: (sessionId: string) => void;
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
  onSubmitRemoveProject: (project: Project) => Promise<string | null>;
  onSubmitRenameWorktree: (
    worktree: Worktree,
    name: string,
  ) => Promise<string | null>;
  /** Opens the settings page on the given project's section. */
  onOpenProjectSettings: (project: Project) => void;
  onOpenSettings: (initialSection?: SettingsSectionId) => void;
  /** Appearance flags (source showTasksButton / showAutomationsButton, default-on). */
  showTasksButton?: boolean;
  showAutomationsButton?: boolean;
}) {
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef({ startX: 0, startWidth: width });
  dragRef.current.startWidth = resizing ? dragRef.current.startWidth : width;
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

  const revealActiveWorkspace = () => {
    scrollRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div
      className="workspace-sidebar shell-sidebar relative min-h-0 flex-shrink-0 bg-worktree-sidebar flex flex-col overflow-hidden"
      style={open ? { width } : { width: 0, borderRightWidth: 0 }}
    >
      {open && (
        <>
          <SidebarNav
            route={route}
            onSelectRoute={onSelectRoute}
            onOpenPalette={onOpenPalette}
            showTasksButton={showTasksButton}
            showAutomationsButton={showAutomationsButton}
          />
          <div ref={scrollRef} className="shell-sidebar-scroll">
            <ProjectList
              groups={groups}
              workspaces={workspaces}
              sessions={sessions}
              selectedWorkspaceId={selectedWorkspaceId}
              activeSessionId={activeSessionId}
              tabStrip={tabStrip}
              onSelectSession={onSelectSession}
              disabled={workspaceDisabled}
              addDisabled={addDisabled}
              sidebarWidth={width}
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
              onSubmitRemoveProject={onSubmitRemoveProject}
              onSubmitRename={onSubmitRenameWorktree}
              onOpenProjectSettings={onOpenProjectSettings}
            />
          </div>
          <SidebarFooter
            onOpenSettings={onOpenSettings}
            onRevealActiveWorkspace={revealActiveWorkspace}
          />
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
