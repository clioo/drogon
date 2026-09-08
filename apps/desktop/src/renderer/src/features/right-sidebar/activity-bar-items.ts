/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/use-right-sidebar-activity-items.ts
   (item order and titles) and right-sidebar-activity-visibility.ts (the
   gitOnly/workspaceOnly filter). Adapter: props in place of the zustand
   store; vault/worktrees/pr-checks/checks/plugin entries are out of
   MVP scope, and the last entry hosts this repo's session-details
   inspector content, which has no source equivalent. R13-B adds the
   source's ports item (Plug icon, ⌘⇧I chord, after source-control in the
   source order); the source gates it on sshOnly, which this repo's
   all-local workspaces would never satisfy, so it is always visible and
   the panel shows the source's "No workspace selected" state instead. */
import { Files, GitBranch, Info, Network, Plug } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { RightSidebarTab } from "./right-sidebar-route";

export type ActivityBarItem = {
  id: RightSidebarTab;
  icon: LucideIcon;
  title: string;
  shortcut: string;
  /** When true, hidden while the service withholds git.v1. */
  gitOnly?: boolean;
  /** When true, hidden while the service withholds mentu.v1. */
  mentuOnly?: boolean;
};

/** Accessible name: title plus the toggle chord, exactly like the source. */
export function activityItemAriaLabel(item: ActivityBarItem): string {
  return item.shortcut ? `${item.title} (${item.shortcut})` : item.title;
}

/** Source chords for the right sidebar (definitions-core-1.ts). */
export const SIDEBAR_PORTS_TOGGLE_CHORD = "CmdOrCtrl+Shift+I";

/** Source order for the MVP-relevant entries: Explorer, Mentu, Source Control, Ports. */
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
      title: "Mentu",
      shortcut: "",
      mentuOnly: true,
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
    },
    {
      id: "session",
      icon: Info,
      title: "Session details",
      shortcut: "",
    },
  ];
}

/** Port of getVisibleRightSidebarActivityItems for the MVP item flags. */
export function getVisibleRightSidebarActivityItems(
  items: ActivityBarItem[],
  state: { gitAvailable: boolean; mentuAvailable: boolean },
): ActivityBarItem[] {
  return items.filter(
    (item) =>
      (!item.gitOnly || state.gitAvailable) &&
      (!item.mentuOnly || state.mentuAvailable),
  );
}
