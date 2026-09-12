/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/use-right-sidebar-activity-items.ts
   (item order, titles and gitOnly/folderOnly/sshOnly/workspaceOnly flags)
   and right-sidebar-activity-visibility.ts (the visibility filter).
   Adaptations: vault ("Agents"), workspaces ("Attached worktrees"),
   pr-checks and checks have no Drogon panel, so they are not built — the
   flags stay in the type and filter as a literal port for when they land.
   Ports keeps R13-B's local panel: the fork gates its bar item sshOnly and
   serves local ports from the kind-independent status-bar popover, while
   Drogon has no SSH workspaces, so the item gates workspaceOnly instead.
   Mentu and Source Control additionally require their daemon capabilities
   (mentu.v1, git.v1); the fork needs no such gate because its panels are
   local. There is deliberately no Session details item: the fork has none,
   so that panel stays reachable only through the session header toggle
   and the palette, never through the activity bar. */
import { Files, GitBranch, Network, Plug } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { RightSidebarTab } from "./right-sidebar-route";

export type ActivityBarItem = {
  id: RightSidebarTab;
  icon: LucideIcon;
  title: string;
  shortcut: string;
  /** When true, hidden for folder workspaces (meaningless for non-git). */
  gitOnly?: boolean;
  /** When true, shown only for folder workspaces (no Drogon item yet). */
  folderOnly?: boolean;
  /** When true, shown only for SSH repos (no Drogon item yet). */
  sshOnly?: boolean;
  /** When true, shown only while a workspace is selected. */
  workspaceOnly?: boolean;
};

/** Accessible name: title plus the toggle chord, exactly like the source. */
export function activityItemAriaLabel(item: ActivityBarItem): string {
  return item.shortcut ? `${item.title} (${item.shortcut})` : item.title;
}

/** Source chords for the right sidebar (definitions-core-1.ts). */
export const SIDEBAR_PORTS_TOGGLE_CHORD = "CmdOrCtrl+Shift+I";

/**
 * Source order for the entries Drogon serves: Explorer, Mentu, Source
 * Control, Ports. vault/workspaces/pr-checks/checks are omitted until
 * their panels are ported honestly (see the module note).
 */
export function buildRightSidebarActivityItems(input: {
  explorerShortcut: string;
  sourceControlShortcut: string;
  portsShortcut: string;
}): ActivityBarItem[] {
  return [
    {
      id: "explorer",
      icon: Files,
      title: "Explorer",
      shortcut: input.explorerShortcut,
    },
    {
      id: "mentu",
      icon: Network,
      title: "Work Graph",
      shortcut: "",
      workspaceOnly: true,
    },
    {
      id: "source-control",
      icon: GitBranch,
      title: "Source Control",
      shortcut: input.sourceControlShortcut,
      gitOnly: true,
    },
    {
      id: "ports",
      icon: Plug,
      title: "Ports",
      shortcut: input.portsShortcut,
      workspaceOnly: true,
    },
  ];
}

/**
 * Port of getVisibleRightSidebarActivityItems. `isFolder`,
 * `isFolderWorkspace`, `isSshRepo` and `hasActiveWorktree` are the fork's
 * workspace-kind inputs; `gitAvailable`/`mentuAvailable` are this repo's
 * daemon capability gates, which the fork does not need.
 */
export function getVisibleRightSidebarActivityItems(
  items: ActivityBarItem[],
  state: {
    isFolder: boolean;
    isFolderWorkspace: boolean;
    isSshRepo: boolean;
    hasActiveWorktree: boolean;
    gitAvailable: boolean;
    mentuAvailable: boolean;
  },
): ActivityBarItem[] {
  return items.filter(
    (item) =>
      (!item.gitOnly || (!state.isFolder && state.gitAvailable)) &&
      (!item.folderOnly || state.isFolderWorkspace) &&
      (!item.sshOnly || state.isSshRepo) &&
      (!item.workspaceOnly || state.hasActiveWorktree) &&
      // Mentu additionally requires the daemon capability behind its panel.
      (item.id !== "mentu" || state.mentuAvailable),
  );
}
