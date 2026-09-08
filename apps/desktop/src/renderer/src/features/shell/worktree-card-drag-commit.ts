/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-manual-order.ts
   (moveWorktreeIdsWithinGroup). Adapter: single-card drags only, so the
   dragged set holds one id; the multi-select expansion and lineage units
   of the source have no counterpart in this repo. The "Why" comments
   below are the source's (trimmed to the kept path). */

import {
  applyOrderInsertAt,
  mapVisibleDropIndexToInsertAt,
} from "./sidebar-order";
import type { WorktreeCardDragSession } from "./worktree-card-drag-contract";

export function moveWorktreeIdsWithinGroup(
  groupIds: readonly string[],
  draggedIds: readonly string[],
  dropIndex: number,
): string[] {
  if (groupIds.length === 0 || draggedIds.length === 0) {
    return [...groupIds];
  }

  const groupIdSet = new Set(groupIds);
  const draggedSet = new Set<string>();
  const orderedDraggedIds: string[] = [];
  for (const id of draggedIds) {
    if (!groupIdSet.has(id) || draggedSet.has(id)) {
      continue;
    }
    draggedSet.add(id);
  }
  for (const id of groupIds) {
    if (draggedSet.has(id)) {
      orderedDraggedIds.push(id);
    }
  }
  if (orderedDraggedIds.length === 0) {
    return [...groupIds];
  }

  const boundedDropIndex = Math.max(0, Math.min(groupIds.length, dropIndex));
  let removedBeforeDrop = 0;
  for (let i = 0; i < boundedDropIndex; i++) {
    const id = groupIds[i];
    if (id !== undefined && draggedSet.has(id)) {
      removedBeforeDrop++;
    }
  }

  const remaining = groupIds.filter((id) => !draggedSet.has(id));
  const insertAt = Math.max(
    0,
    Math.min(remaining.length, boundedDropIndex - removedBeforeDrop),
  );
  const next = remaining.slice();
  // Why: generated workspace fleets can exceed V8's argument limit for
  // `push(...ids)` while manual ordering still needs the full visible order.
  const tail = next.splice(insertAt);
  for (const id of orderedDraggedIds) {
    next.push(id);
  }
  for (const id of tail) {
    next.push(id);
  }
  return next;
}

export function commitWorktreeCardDragDrop(args: {
  session: WorktreeCardDragSession;
  sidebarDropIndex: number;
  fullCardIds: readonly string[];
  onCommitWorktreeOrder: (orderedIds: string[]) => void;
}): void {
  const sidebarCardIds = args.session.sidebarCardIds;
  const sourceIndex = sidebarCardIds.indexOf(args.session.worktreeId);
  // Both slots bordering the dragged card are visual no-ops.
  if (
    sourceIndex === -1 ||
    args.sidebarDropIndex === sourceIndex ||
    args.sidebarDropIndex === sourceIndex + 1
  ) {
    return;
  }

  // Fast path when the visible list is the full order.
  if (
    sidebarCardIds.length === args.fullCardIds.length &&
    sidebarCardIds.every((id, index) => id === args.fullCardIds[index])
  ) {
    const next = moveWorktreeIdsWithinGroup(
      args.fullCardIds,
      [args.session.worktreeId],
      args.sidebarDropIndex,
    );
    if (next.every((id, index) => id === args.fullCardIds[index])) {
      return;
    }
    args.onCommitWorktreeOrder(next);
    return;
  }

  const insertAt = mapVisibleDropIndexToInsertAt(
    args.sidebarDropIndex,
    sidebarCardIds,
    args.fullCardIds,
  );
  const next = applyOrderInsertAt(
    args.fullCardIds,
    args.session.worktreeId,
    insertAt,
  );
  if (!next) {
    return;
  }
  args.onCommitWorktreeOrder(next);
}
