/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca
   src/renderer/src/components/sidebar/workspace-kanban-worktree-groups.ts at
   pinned source c9790628 (clioo/drogon-orca), with its tie-break helper from
   src/renderer/src/lib/worktree-display-name-order.ts. Adaptation (data
   layer): Orca's non-manual comparator orders by `isPinned` then
   `lastActivityAt`; a Drogon worktree row carries neither field, so the
   non-manual order degrades to the source's own final tie-break
   (compareWorktreeDisplayName). Manual order keeps the exact source
   comparator: `(manualOrder ?? sortOrder) desc || displayName`. */
import type {
  WorkspaceStatus,
  WorkspaceStatusDefinition,
} from "./workspace-status";
import type { KanbanWorktree } from "./kanban-worktree";
import { getWorkspaceStatus } from "./workspace-status";
import { getWorktreeHostIdentity } from "./host-identity";

/** Orca's SortBy for the board, narrowed to the values a Drogon row can serve. */
export type KanbanSortBy = "manual" | "recent";

// Why: displayName is typed non-optional but arrives undefined at runtime for
// persisted/discovered worktrees (crash 99657ab1); coalesce so it can't throw.
export function compareWorktreeDisplayName(
  a: KanbanWorktree,
  b: KanbanWorktree,
): number {
  return (a.displayName ?? "").localeCompare(b.displayName ?? "");
}

function sortManualBoardWorktrees(
  a: KanbanWorktree,
  b: KanbanWorktree,
): number {
  const left = a.manualOrder ?? 0;
  const right = b.manualOrder ?? 0;
  return right - left || compareWorktreeDisplayName(a, b);
}

export function groupWorkspaceKanbanWorktrees(params: {
  worktrees: readonly KanbanWorktree[];
  visibleWorktreeIds: ReadonlySet<string>;
  workspaceStatuses: readonly WorkspaceStatusDefinition[];
  sortBy: KanbanSortBy;
}): Map<WorkspaceStatus, KanbanWorktree[]> {
  const { worktrees, visibleWorktreeIds, workspaceStatuses, sortBy } = params;
  const grouped = new Map<WorkspaceStatus, KanbanWorktree[]>(
    workspaceStatuses.map((status) => [status.id, []]),
  );

  for (const worktree of worktrees) {
    if (!visibleWorktreeIds.has(getWorktreeHostIdentity(worktree))) {
      continue;
    }
    grouped
      .get(getWorkspaceStatus(worktree, workspaceStatuses))!
      .push(worktree);
  }

  for (const items of grouped.values()) {
    items.sort(
      sortBy === "manual"
        ? sortManualBoardWorktrees
        : (a, b) => compareWorktreeDisplayName(a, b),
    );
  }
  return grouped;
}
