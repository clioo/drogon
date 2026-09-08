/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-context-menu-policy.ts
   (adapter: MVP subset — the reference gates a large menu with store
   state for lineage, pins, sleep and multi-select; this repo's card menu
   holds Open in editor / Reveal in Finder / Copy path, Rename, Create
   worktree from here and Delete worktree, so only the enabled/disabled
   policy for those items is ported. Pure functions, unit-tested.) */

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
 * Whether the card offers worktree deletion at all. Mirrors the source's
 * `isContextWorktreeDeletable` (repo-owned, non-primary worktree): folder
 * projects expose one implicit worktree — the folder itself — with
 * nothing to delete, so the menu hides Delete for them.
 */
export function isWorktreeDeletable(args: {
  projectKind: "git" | "folder";
  implicitFolderWorktree: boolean;
}): boolean {
  return args.projectKind === "git" && !args.implicitFolderWorktree;
}

/**
 * Whether the card offers renaming. The implicit folder worktree's title
 * is its folder; renaming it is a project concern, not a card one.
 */
export function isWorktreeRenamable(args: {
  implicitFolderWorktree: boolean;
}): boolean {
  return !args.implicitFolderWorktree;
}

/** Whether the card can be the source of a new worktree. */
export function isWorktreeCreatable(args: {
  projectKind: "git" | "folder";
}): boolean {
  return args.projectKind === "git";
}

/** Delete item label: the source's destructive row reads "Delete Worktree". */
export function getWorktreeDeleteLabel(): string {
  return "Delete Worktree";
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
 * File-manager item label, mirroring the source's platform label.
 * Takes the raw `navigator.platform` value.
 */
export function getFileManagerLabel(platform: string): string {
  return /mac/i.test(platform) ? "Reveal in Finder" : "Show in folder";
}
