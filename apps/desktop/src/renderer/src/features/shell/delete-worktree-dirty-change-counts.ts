/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/delete-worktree-dirty-change-counts.ts
   (adapter: MVP subset — the reference merges store status maps across
   execution hosts with a force-delete-reason fallback; this repo reads
   one live `git.status` entry list, so the count is its length. Folder
   deletes remove only the Drogon registration, never files, so they
   never carry a dirty hint. Pure, unit-tested.) */

/**
 * Dirty change count for the delete hint: undefined when no hint applies
 * (folder deletes, clean checkouts), otherwise the live `git.status`
 * entry count. A zero from a proven-dirty refusal keeps the warning
 * visible without inventing a file count — the source's `forceDeleteReason
 * === 'dirty'` fallback.
 */
export function getDeleteWorktreeDirtyChangeCount(args: {
  isFolderWorkspaceDelete: boolean;
  entryCount: number | null;
  provenDirty?: boolean;
}): number | undefined {
  if (args.isFolderWorkspaceDelete) return undefined;
  if ((args.entryCount ?? 0) > 0) return args.entryCount ?? 0;
  if (args.provenDirty) return 0;
  return undefined;
}

/** Hint text for a count: "N uncommitted or untracked change(s)". */
export function formatDirtyChangeLabel(changeCount: number): string {
  return changeCount > 0
    ? `${changeCount} uncommitted or untracked ${changeCount === 1 ? "change" : "changes"}`
    : "Uncommitted or untracked changes";
}
