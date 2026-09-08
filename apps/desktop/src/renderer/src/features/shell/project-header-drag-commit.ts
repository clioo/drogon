/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/project-header-drag-commit.ts
   (commitProjectHeaderDragDrop). Adapter: single ordering path (no
   project-group rank branch); the visible->full index map and the
   insert apply live in sidebar-order.ts. The "Why" comments below are
   the source's. */

import {
  applyOrderInsertAt,
  mapVisibleDropIndexToInsertAt,
} from "./sidebar-order";
import type { ProjectHeaderDragSession } from "./project-header-drag-contract";

export function commitProjectHeaderDragDrop(args: {
  session: ProjectHeaderDragSession;
  sidebarDropIndex: number;
  allProjectIds: readonly string[];
  onCommitProjectOrder: (orderedIds: string[]) => void;
}): void {
  const sidebarProjectHeaderIds = args.session.sidebarProjectHeaderIds;
  const sourceIndex = sidebarProjectHeaderIds.indexOf(args.session.projectId);
  // Why: both slots bordering the dragged header are visual no-ops. In
  // particular, do not compact paired-host occurrences on an unchanged drop.
  if (
    sourceIndex === -1 ||
    args.sidebarDropIndex === sourceIndex ||
    args.sidebarDropIndex === sourceIndex + 1
  ) {
    return;
  }

  const insertAt = mapVisibleDropIndexToInsertAt(
    args.sidebarDropIndex,
    sidebarProjectHeaderIds,
    args.allProjectIds,
  );
  const next = applyOrderInsertAt(args.allProjectIds, args.session.projectId, insertAt);
  if (!next) {
    return;
  }
  args.onCommitProjectOrder(next);
}
