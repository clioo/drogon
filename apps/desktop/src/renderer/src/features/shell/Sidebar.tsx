/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/index.tsx shell recipe and
   SidebarSettingsHelpMenu.tsx footer recipe (adapter: props, no store). */
import { useState } from "react";
import { LifeBuoy, Settings } from "lucide-react";
import type { ReactNode } from "react";
import type { Session, Workspace } from "../../../../shared/session-contract";
import type { ProjectGroup } from "./project-adapter";
import { SidebarNav } from "./SidebarNav";
import { ProjectList } from "./ProjectList";
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
          onSelectWorkspace={onSelectWorkspace}
          onAddProject={onAddProject}
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
