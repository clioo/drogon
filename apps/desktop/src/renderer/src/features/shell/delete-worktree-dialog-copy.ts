/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/delete-worktree-dialog-copy.ts
   (adapter: MVP subset — the reference covers batch deletes, lineage
   children and folder-workspace mixes; this repo deletes one worktree at
   a time with no lineage, so only the single-target copy remains. Pure,
   unit-tested.) */

export function getDeleteWorktreeDialogCopy(args: {
  displayName: string;
  isFolderWorkspaceDelete: boolean;
}): {
  targetLabel: string;
  targetClassName: string;
  descriptionSuffix: string;
  mainWorktreeBlocker: string;
} {
  return {
    targetLabel: args.displayName,
    targetClassName: "break-all font-medium text-foreground",
    descriptionSuffix: args.isFolderWorkspaceDelete
      ? "from Drogon. The project folder on disk will not be deleted."
      : "from git and delete its workspace folder.",
    mainWorktreeBlocker: args.isFolderWorkspaceDelete
      ? "Remove the folder project instead of deleting this workspace."
      : "Git does not allow removing the main worktree.",
  };
}
