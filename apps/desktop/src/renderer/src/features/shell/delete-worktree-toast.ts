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

/**
 * The daemon's refusal for a workspace whose terminals it could not settle
 * (issue #621). `worktree.remove` refuses before touching git or files and
 * names which case it is; the bridge hands the renderer the message alone,
 * so these two markers — `still live:` for a PTY Drogon holds unreaped, and
 * this one for records it cannot act on — are the whole contract. They are
 * the literals `workspace_session_settle.rs` builds its refusals from, and
 * `delete-worktree-toast.test.ts` pins the exact daemon strings.
 */
export function isUnsettledSessionRemovalError(error: string): boolean {
  return (
    isProvenLivePtyRemovalError(error) ||
    error.includes("could not confirm every terminal")
  );
}

/**
 * Which force-delete recovery a failed removal offers, or null when the
 * failure is not one force can clear. Only an unforced attempt classifies:
 * telling someone who already forced to "use Force Delete" would send them
 * back to the button they just pressed.
 */
export function classifyWorktreeRemovalFailure(
  error: string,
  forced: boolean,
): WorktreeForceDeleteReason | null {
  if (forced) return null;
  return isUnsettledSessionRemovalError(error) ? "unstopped-pty" : null;
}

/**
 * Whether the toast may offer the Force Delete button at all. Both unsettled
 * cases get the unstopped-pty copy, but only a terminal this Drogon still
 * holds can be stopped by forcing; a record it has lost contact with refuses
 * the forced delete for the very same reason, so the button would be a dead
 * end dressed as a recovery.
 */
export function canForceDeleteAfterRemovalFailure(
  error: string,
  forced: boolean,
): boolean {
  return (
    classifyWorktreeRemovalFailure(error, forced) !== null &&
    isProvenLivePtyRemovalError(error)
  );
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
      // Force passes git's `remove -f -f`, so deleting a locked workspace from
      // here works (#604); unlocking first stays the way to keep the checkout.
      description: lockReason
        ? `This workspace is locked by Git. Git reported: ${lockReason}. Use Force Delete to delete it anyway, or run git worktree unlock <worktree-path> from its repository and retry.`
        : "This workspace is locked by Git. Use Force Delete to delete it anyway, or run git worktree unlock <worktree-path> from its repository and retry.",
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
        // Why: the two cases have different exits, so the copy must say which one this is.
        // Telling a user "could not confirm" about terminals Drogon watched stay alive asks
        // them to waive a doubt that does not exist, and any running agent's work dies with it.
        // The reverse is worse: force can only settle a PTY this process still holds, so
        // offering it for a record Drogon has lost contact with would promise a kill it
        // cannot perform — and the delete would refuse again for the same reason.
        description: isProvenLivePtyRemovalError(error)
          ? "This workspace still has running terminals, so Drogon stopped before deleting any files. Force Delete will kill them and discard any uncommitted work they hold."
          : "Drogon could not confirm every terminal in this workspace has exited, so it stopped before deleting any files. Force Delete cannot settle a terminal it has lost contact with — close those terminals, then delete again.",
        isDestructive: false,
      };
    }
    if (forceDeleteReason === "missing-registration") {
      return {
        title: `Failed to delete workspace ${worktreeName}`,
        description:
          "Git already removed this workspace. Use Force Delete to clear it from Drogon.",
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
