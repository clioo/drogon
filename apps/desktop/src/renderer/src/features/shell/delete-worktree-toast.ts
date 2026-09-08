// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/sidebar/delete-worktree-toast.ts.
// Adapter: literal English copy (no i18n in this repo); the locked/proven-live
// classifiers are inlined from Orca's shared/worktree/removal matchers
// (locked-working-tree wording, unstopped-PTY live marker) since
// apps/desktop/src/shared is coordinator-owned. Pure, unit-tested.
export type WorktreeForceDeleteReason =
  | "dirty"
  | "orphan-directory"
  | "missing-registration"
  | "unstopped-pty";

export type DeleteWorktreeToastCopy = {
  title: string;
  description?: string;
  isDestructive: boolean;
};

export function isLockedWorktreeRemovalError(error: string): boolean {
  return (
    error.includes("locked working tree") ||
    error.includes("cannot remove a locked working tree")
  );
}

export function isProvenLivePtyRemovalError(error: string): boolean {
  return error.includes("still live:");
}

export function getDeleteWorktreeToastCopy(
  worktreeName: string,
  forceDeleteReason: WorktreeForceDeleteReason | null,
  error: string,
  lockReason: string | null = null,
): DeleteWorktreeToastCopy {
  if (isLockedWorktreeRemovalError(error)) {
    return {
      title: `Failed to delete workspace ${worktreeName}`,
      description: lockReason
        ? `This workspace is locked by Git. Git reported: ${lockReason}. Run git worktree unlock <worktree-path> from its repository, then retry deletion.`
        : "This workspace is locked by Git. Run git worktree unlock <worktree-path> from its repository, then retry deletion.",
      isDestructive: false,
    };
  }

  if (forceDeleteReason) {
    if (forceDeleteReason === "orphan-directory") {
      return {
        title: `Failed to delete workspace ${worktreeName}`,
        description:
          "Git already forgot this workspace, but its directory is still on disk. Use Force Delete to remove the orphaned directory.",
        isDestructive: false,
      };
    }
    if (forceDeleteReason === "unstopped-pty") {
      return {
        title: `Failed to delete workspace ${worktreeName}`,
        // Why: Force Delete proceeds either way, so the copy must say which case this is.
        // Telling a user "could not confirm" about terminals Orca watched stay alive asks
        // them to waive a doubt that does not exist, and any running agent's work dies with it.
        description: isProvenLivePtyRemovalError(error)
          ? "This workspace still has running terminals, so Orca stopped before deleting any files. Force Delete will kill them and discard any uncommitted work they hold."
          : "Orca could not confirm every terminal in this workspace has exited, so it stopped before deleting any files. Use Force Delete to remove it anyway.",
        isDestructive: false,
      };
    }
    if (forceDeleteReason === "missing-registration") {
      return {
        title: `Failed to delete workspace ${worktreeName}`,
        description:
          "Git already removed this workspace. Use Force Delete to clear it from Orca.",
        isDestructive: false,
      };
    }
    return {
      title: `Failed to delete workspace ${worktreeName}`,
      description: "It has changed files. Use Force Delete to delete it anyway.",
      // Why: git commonly refuses the first delete when the worktree still has
      // modified or untracked files. Showing raw stderr in a destructive toast
      // made a normal cleanup step look like an Orca bug, so this common case
      // gets a concise explanation plus the force-delete path instead.
      isDestructive: false,
    };
  }

  return {
    title: `Failed to delete workspace ${worktreeName}`,
    description: error,
    isDestructive: true,
  };
}
