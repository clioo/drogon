/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca
   src/renderer/src/components/sidebar/worktree-manual-order-catalog.ts at
   pinned source c9790628 (clioo/drogon-orca). Adaptations (data layer only):
   Orca folds folder workspaces into rows and filters archived worktrees; a
   Drogon folder project already materializes a Worktree and a Drogon row has
   no isArchived field, so the row set is the caller's worktrees as-is. Label
   ties compare display names (the source's final tie-break) because a Drogon
   row carries no activity stamp for smart-sort labels. Rank semantics
   (manualOrder ?? sortOrder desc, dedupe by id, unison-rank map) are the
   source's. */
import type { KanbanWorktree } from "./kanban-worktree";
import { compareWorktreeDisplayName } from "./worktree-groups";

export type WorktreeManualOrderCatalog = {
  orderedIds: readonly string[];
  rankByWorktreeId: ReadonlyMap<string, number>;
};

export function buildWorktreeManualOrderCatalog(args: {
  worktrees: readonly KanbanWorktree[];
}): WorktreeManualOrderCatalog {
  const rows = [...args.worktrees];
  rows.sort(
    (left, right) =>
      (right.manualOrder ?? 0) - (left.manualOrder ?? 0) ||
      compareWorktreeDisplayName(left, right),
  );
  const rowsById = new Map<string, KanbanWorktree[]>();
  for (const row of rows) {
    const matches = rowsById.get(row.id);
    if (matches) {
      matches.push(row);
    } else {
      rowsById.set(row.id, [row]);
    }
  }

  const orderedIds = [...rowsById.keys()];
  const rankByWorktreeId = new Map<string, number>();
  for (const [worktreeId, matches] of rowsById) {
    const ranks = matches.map((row) => row.manualOrder);
    const rank = ranks[0];
    if (
      typeof rank === "number" &&
      Number.isFinite(rank) &&
      ranks.every((candidate) => candidate === rank)
    ) {
      rankByWorktreeId.set(worktreeId, rank);
    }
  }
  return { orderedIds, rankByWorktreeId };
}
