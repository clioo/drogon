/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/dashboard/agent-row-lineage-model.ts
   (buildAgentRowLineageTree / resolveAgentRowParentPaneKey: explicit
   parentPaneKey membership check, parentTerminalHandle fallback,
   cycle-unwind, unreachable-row normalization).
   Adapter: Orca rows are hook-reported agent entries keyed by pane and
   fall back to a parent terminal handle resolved through the row set;
   this repo's Session contract carries the already-recorded
   `parentSessionId` (issue #359), so only the explicit-membership half
   ports — a session whose parent is absent from the same card's row set
   renders as a flat root, exactly the fork's dangling-parent rule. Pure
   functions, unit-tested. */
import type { WorktreeAgentRow } from "./worktree-agent-rows";

export type WorktreeAgentRowTree = {
  rootRows: WorktreeAgentRow[];
  childrenByParentSessionId: Map<string, WorktreeAgentRow[]>;
  childSessionIds: Set<string>;
};

/** The recorded parent when it names another row in the same card. */
export function resolveRowParentSessionId(
  row: WorktreeAgentRow,
  rowsBySessionId: ReadonlyMap<string, WorktreeAgentRow>,
): string | undefined {
  const parentSessionId = row.session.parentSessionId ?? null;
  if (
    parentSessionId &&
    parentSessionId !== row.session.id &&
    rowsBySessionId.has(parentSessionId)
  ) {
    return parentSessionId;
  }
  return undefined;
}

/**
 * Group the card's ordered rows into the fork's lineage tree: every row
 * whose recorded parent is also in the set becomes a child, everything
 * else stays a root. Malformed metadata that would close a cycle keeps
 * every row visible as a flat root instead of hiding all participants,
 * and rows unreachable from any root are normalized back to roots (their
 * children re-attach to the root list) — both fork-verbatim.
 */
export function buildWorktreeAgentRowTree(
  rows: readonly WorktreeAgentRow[],
): WorktreeAgentRowTree {
  const rowsBySessionId = new Map<string, WorktreeAgentRow>();
  for (const row of rows) {
    if (!rowsBySessionId.has(row.session.id)) {
      rowsBySessionId.set(row.session.id, row);
    }
  }
  const childrenByParentSessionId = new Map<string, WorktreeAgentRow[]>();
  const childSessionIds = new Set<string>();

  for (const row of rows) {
    const parentSessionId = resolveRowParentSessionId(row, rowsBySessionId);
    if (!parentSessionId) {
      continue;
    }
    childSessionIds.add(row.session.id);
    const siblings = childrenByParentSessionId.get(parentSessionId);
    if (siblings) {
      siblings.push(row);
    } else {
      childrenByParentSessionId.set(parentSessionId, [row]);
    }
  }

  const rootRows = rows.filter((row) => !childSessionIds.has(row.session.id));
  if (rootRows.length === 0 && rows.length > 0) {
    // Why: malformed orchestration metadata can form a closed cycle. Keep
    // every row visible as a flat root instead of hiding all participants.
    return {
      rootRows: [...rows],
      childrenByParentSessionId: new Map(),
      childSessionIds: new Set(),
    };
  }

  const reachableSessionIds = new Set<string>();
  const markReachable = (
    row: WorktreeAgentRow,
    ancestorSessionIds: ReadonlySet<string> = new Set(),
  ): void => {
    if (
      reachableSessionIds.has(row.session.id) ||
      ancestorSessionIds.has(row.session.id)
    ) {
      return;
    }
    reachableSessionIds.add(row.session.id);
    const descendantAncestorSessionIds = new Set(ancestorSessionIds);
    descendantAncestorSessionIds.add(row.session.id);
    for (const childRow of childrenByParentSessionId.get(row.session.id) ??
      []) {
      markReachable(childRow, descendantAncestorSessionIds);
    }
  };
  for (const rootRow of rootRows) {
    markReachable(rootRow);
  }

  const unreachableRows = rows.filter(
    (row) => !reachableSessionIds.has(row.session.id),
  );
  if (unreachableRows.length === 0) {
    return { rootRows, childrenByParentSessionId, childSessionIds };
  }

  const normalizedChildrenByParentSessionId = new Map(
    childrenByParentSessionId,
  );
  const normalizedChildSessionIds = new Set(childSessionIds);
  for (const row of unreachableRows) {
    if (!rootRows.some((rootRow) => rootRow.session.id === row.session.id)) {
      rootRows.push(row);
    }
    normalizedChildSessionIds.delete(row.session.id);
    normalizedChildrenByParentSessionId.delete(row.session.id);
    for (const [parentSessionId, siblings] of normalizedChildrenByParentSessionId) {
      const visibleSiblings = siblings.filter(
        (sibling) => sibling.session.id !== row.session.id,
      );
      if (visibleSiblings.length === 0) {
        normalizedChildrenByParentSessionId.delete(parentSessionId);
      } else if (visibleSiblings.length !== siblings.length) {
        normalizedChildrenByParentSessionId.set(parentSessionId, visibleSiblings);
      }
    }
  }

  return {
    rootRows,
    childrenByParentSessionId: normalizedChildrenByParentSessionId,
    childSessionIds: normalizedChildSessionIds,
  };
}
