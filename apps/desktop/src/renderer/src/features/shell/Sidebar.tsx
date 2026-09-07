/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/index.tsx shell recipe and
   SidebarSettingsHelpMenu.tsx footer recipe (adapter: props, no store). */
import { useState } from "react";
import { LifeBuoy, Settings } from "lucide-react";
import type { ReactNode } from "react";
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

/**
 * Orca-style left sidebar: top nav (Search / live panels / Tasks /
 * Automations placeholders), Projects with worktree cards, the existing
 * add-folder form slot, and a footer with service identity plus
 * settings and help icons.
 */
export function Sidebar({
  route,
  panelsDisabled,
  filesAvailable,
  changesAvailable,
  botsAvailable,
  browserEnabled,
  automationsAvailable,
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
  worktreesAvailable,
  projectAction,
  onOpenProjectAction,
  onCloseProjectAction,
  onBrowseProject,
  onSubmitAddProject,
  onSubmitWorktree,
  onSubmitRemoveWorktree,
  addSlot,
  serviceLabel,
  buildRevision,
  buildTitle,
  onOpenSettings,
  settingsExpanded,
}: {
  route: string | null;
  panelsDisabled: boolean;
  filesAvailable: boolean;
  changesAvailable: boolean;
  botsAvailable: boolean;
  browserEnabled: boolean;
  automationsAvailable: boolean;
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
  worktreesAvailable: boolean;
  projectAction: ProjectAction | null;
  onOpenProjectAction: (action: ProjectAction) => void;
  onCloseProjectAction: () => void;
  onBrowseProject: () => Promise<string | null>;
  onSubmitAddProject: (input: {
    path: string;
    name?: string;
  }) => Promise<string | null>;
  onSubmitWorktree: (input: {
    projectId: string;
    name: string;
    baseRef?: string;
  }) => Promise<string | null>;
  onSubmitRemoveWorktree: (
    worktree: Worktree,
    force: boolean,
  ) => Promise<string | null>;
  /** The existing add-folder form / empty-state markup, owned by App. */
  addSlot: ReactNode;
  serviceLabel: string;
  buildRevision: string | null;
  buildTitle?: string;
  onOpenSettings: () => void;
  settingsExpanded: boolean;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <aside className="workspace-sidebar shell-sidebar" aria-label="Sidebar">
      <header className="brand">Drogon</header>
      <SidebarNav
        route={route}
        panelsDisabled={panelsDisabled}
        filesAvailable={filesAvailable}
        changesAvailable={changesAvailable}
        botsAvailable={botsAvailable}
        browserEnabled={browserEnabled}
        automationsAvailable={automationsAvailable}
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
          onOpenAction={onOpenProjectAction}
          onCloseAction={onCloseProjectAction}
          onBrowse={onBrowseProject}
          onSubmitAdd={onSubmitAddProject}
          onSubmitWorktree={onSubmitWorktree}
          onSubmitRemove={onSubmitRemoveWorktree}
        />
        {addSlot}
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
            Press Cmd+K for commands, Cmd+P to jump to a workspace or
            session. Sessions stay with the service when this window
            closes.
          </p>
        )}
      </footer>
    </aside>
  );
}
