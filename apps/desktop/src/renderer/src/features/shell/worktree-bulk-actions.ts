/* MIT Copyright (c) 2026 Lovecast Inc.
   Bulk worktree operations for a sidebar multi-selection: the copy the
   context menu and the confirm dialog show, and the sequential runners
   behind "Delete N", "Pin N" and "Move N to Status". Every runner is a
   plain function over the same single-card commits the one-card menu
   already uses (`worktree.update`, the delete submit), so a bulk action
   can never reach a code path the single action does not. */

import type { Worktree } from "../../../../shared/session-contract";

/** One card in a bulk action, with the reason it may be skipped. */
export type BulkWorktreeTarget = {
  readonly worktree: Worktree;
  /** The card title as the sidebar renders it. */
  readonly name: string;
  /**
   * Deleting this card would remove the whole project registration (a
   * folder project's implicit card, or a git project's primary checkout),
   * so bulk delete leaves it alone and says so.
   */
  readonly protectedFromDelete: boolean;
};

/**
 * The multi-selection one card's context menu acts on. Present only when
 * that card is part of a selection of two or more; the menu then replaces
 * every single-card row with its bulk equivalent, so an action can never
 * read as "this card" while silently touching five.
 */
export type WorktreeBulkMenuTarget = {
  /** Every selected worktree, for the pin intent and the row counts. */
  readonly worktrees: readonly Worktree[];
  /** Opens the bulk delete confirm; null when nothing selected can be deleted. */
  readonly onDelete: (() => void) | null;
  /** How many of the selected cards a delete would really remove. */
  readonly deletableCount: number;
  /** Pins (or unpins, when all are pinned) every selected worktree. */
  readonly onTogglePin: (() => void) | null;
  readonly onMoveToStatus: ((statusId: string | null) => void) | null;
  readonly onClearSelection: () => void;
};

export type BulkDeleteFailure = {
  readonly worktreeId: string;
  readonly name: string;
  readonly error: string;
};

export type BulkDeleteOutcome = {
  readonly deletedIds: readonly string[];
  readonly failures: readonly BulkDeleteFailure[];
};

/** "3 workspaces" / "1 workspace". */
export function formatWorkspaceCount(count: number): string {
  return `${count} workspace${count === 1 ? "" : "s"}`;
}

/** The destructive row in the bulk context menu. */
export function bulkDeleteMenuLabel(count: number): string {
  return `Delete ${formatWorkspaceCount(count)}`;
}

/**
 * Pin intent for a mixed selection: pin everything unless every selected
 * card is already pinned, in which case the row unpins. One row, one
 * predictable result — never a per-card toggle that scrambles the set.
 */
export function bulkPinIntent(
  worktrees: readonly Worktree[],
): { pin: boolean; label: string } {
  const pinned = worktrees.filter((worktree) => worktree.isPinned === true);
  const allPinned = worktrees.length > 0 && pinned.length === worktrees.length;
  return {
    pin: !allPinned,
    label: `${allPinned ? "Unpin" : "Pin"} ${formatWorkspaceCount(worktrees.length)}`,
  };
}

/** Which of the selected cards a bulk delete will actually remove. */
export function deletableTargets(
  targets: readonly BulkWorktreeTarget[],
): BulkWorktreeTarget[] {
  return targets.filter((target) => !target.protectedFromDelete);
}

export type BulkDeleteDialogCopy = {
  readonly title: string;
  readonly description: string;
  /** Null when nothing in the selection is protected. */
  readonly protectedHint: string | null;
  readonly confirmLabel: string;
};

export function getBulkDeleteDialogCopy(
  targets: readonly BulkWorktreeTarget[],
): BulkDeleteDialogCopy {
  const deletable = deletableTargets(targets);
  const protectedCount = targets.length - deletable.length;
  return {
    title: `Delete ${formatWorkspaceCount(deletable.length)}`,
    description: `This removes ${formatWorkspaceCount(deletable.length)} and their worktree directories from disk. This cannot be undone.`,
    protectedHint:
      protectedCount === 0
        ? null
        : `${formatWorkspaceCount(protectedCount)} in this selection ${protectedCount === 1 ? "is" : "are"} a project's main checkout and will be kept.`,
    confirmLabel: `Delete ${formatWorkspaceCount(deletable.length)}`,
  };
}

/**
 * Deletes each target in sequence (never in parallel: the daemon's
 * worktree removal touches the same git repository, and a serial run
 * keeps the failure list readable). Every removal goes through the same
 * submit the single-card dialog uses; a failure is recorded and the run
 * continues, so one locked worktree cannot silently abort the rest.
 */
export async function runBulkWorktreeDelete({
  targets,
  force,
  remove,
}: {
  targets: readonly BulkWorktreeTarget[];
  force: boolean;
  remove: (worktree: Worktree, force: boolean) => Promise<string | null>;
}): Promise<BulkDeleteOutcome> {
  const deletedIds: string[] = [];
  const failures: BulkDeleteFailure[] = [];
  for (const target of deletableTargets(targets)) {
    let failure: string | null;
    try {
      failure = await remove(target.worktree, force);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (failure) {
      failures.push({
        worktreeId: target.worktree.id,
        name: target.name,
        error: failure,
      });
    } else {
      deletedIds.push(target.worktree.id);
    }
  }
  return { deletedIds, failures };
}

/** The post-run summary line: what was deleted, and what refused. */
export function formatBulkDeleteResult(outcome: BulkDeleteOutcome): string {
  if (outcome.failures.length === 0)
    return `Deleted ${formatWorkspaceCount(outcome.deletedIds.length)}`;
  if (outcome.deletedIds.length === 0)
    return `Could not delete ${formatWorkspaceCount(outcome.failures.length)}`;
  return `Deleted ${formatWorkspaceCount(outcome.deletedIds.length)}, ${outcome.failures.length} failed`;
}
