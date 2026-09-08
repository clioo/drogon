/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-context-menu-policy.ts and
   the delete-row copy rules in WorktreeContextMenuView.tsx (the
   destructive row reads "Delete" with the workspace.delete chord for git
   worktrees and "Remove Workspace" for folder workspaces; the primary
   checkout never appears as a card in this repo, so its disabled
   "Delete Worktree" + "Remove Project from Orca" pair has no case to
   render). Adapter: MVP subset — pins, read state, statuses, groups,
   lineage, sleep and developer items route through zustand stores this
   repo does not have and are not ported (listed in the PR). Pure
   functions, unit-tested. */

/** Milliseconds after a right-click during which a follow-up click is swallowed. */
export const CONTEXT_MENU_CLICK_SUPPRESSION_MS = 500;

export function shouldSuppressContextMenuFollowUpClick(
  contextMenuOpenedAt: number,
  now: number,
): boolean {
  return (
    now - contextMenuOpenedAt >= 0 &&
    now - contextMenuOpenedAt <= CONTEXT_MENU_CLICK_SUPPRESSION_MS
  );
}

/**
 * The destructive row the card's context menu ends with, mirroring the
 * source's label ladder: git worktrees delete ("Delete"), the primary
 * checkout cannot be git-worktree-removed so the row pair becomes a
 * disabled "Delete Worktree" plus "Remove Project from Drogon", and
 * folder projects expose one implicit worktree — the folder itself —
 * which the source removes from the app instead ("Remove Workspace").
 */
export type WorktreeDeleteRowKind = "delete" | "remove-workspace" | "primary-checkout";

/** The primary checkout is the worktree sitting at the project path. */
export function isPrimaryCheckoutWorktree(args: {
  projectKind: "git" | "folder";
  projectPath: string;
  worktreePath: string;
}): boolean {
  return args.projectKind === "git" && args.projectPath === args.worktreePath;
}

export function worktreeDeleteRowKind(args: {
  projectKind: "git" | "folder";
  implicitFolderWorktree: boolean;
  primaryCheckout: boolean;
}): WorktreeDeleteRowKind {
  if (args.projectKind === "folder" || args.implicitFolderWorktree) {
    return "remove-workspace";
  }
  return args.primaryCheckout ? "primary-checkout" : "delete";
}

/**
 * Destructive row label (source copy: 'Delete' / 'Remove Workspace' /
 * 'Remove Project from Orca', rebranded to Drogon here).
 */
export function getWorktreeDeleteLabel(kind: WorktreeDeleteRowKind): string {
  if (kind === "remove-workspace") return "Remove Workspace";
  if (kind === "primary-checkout") return "Remove Project from Drogon";
  return "Delete";
}

/**
 * Source tooltip copy on the primary checkout's disabled Delete Worktree
 * row ('Primary worktree — can't be deleted. Remove the project instead.').
 */
export const PRIMARY_CHECKOUT_DELETE_DISABLED_HINT =
  "Primary worktree — can't be deleted. Remove the project instead.";

/**
 * Whether the card offers renaming. The implicit folder worktree's title
 * is its folder; renaming it is a project concern, not a card one.
 */
export function isWorktreeRenamable(args: {
  implicitFolderWorktree: boolean;
}): boolean {
  return !args.implicitFolderWorktree;
}

/**
 * Shortcut chip next to Delete, mirroring the source's
 * `useOptionalShortcutLabel('workspace.delete')` (`Mod+Shift+Backspace`).
 * Rendered from the platform because this repo must not touch the
 * keybindings registry: the chord text matches the source definition.
 * Takes the raw `navigator.platform` value (`MacIntel`, `Win32`, …).
 */
export function getWorktreeDeleteShortcutLabel(platform: string): string {
  return /mac/i.test(platform) ? "⌘⇧⌫" : "Ctrl+Shift+Backspace";
}

/**
 * File-manager entry label inside the "Open in" submenu, mirroring the
 * source's getLocalFileManagerLabel (the app name, not an action phrase).
 * Takes the raw `navigator.userAgent` value.
 */
export function getFileManagerLabel(userAgent: string): string {
  if (userAgent.includes("Mac")) return "Finder";
  if (userAgent.includes("Windows")) return "File Explorer";
  return "File Manager";
}
