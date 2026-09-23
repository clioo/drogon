/* Issue #606: subagents get their own strip tab beside the leader that
   spawned them, so a fan-out fills the strip with rows that all look like
   a place to type. The worktree card already solved the grouping half
   with `parentSessionId` (worktree-agent-lineage.ts + the chevron in
   WorktreeAgentRow); this module reuses that exact tree — no second
   lineage rule — and answers the three questions the strip has that a
   sidebar list does not: what order keeps a group contiguous, which tabs
   a collapsed group hides, and which session the prompt belongs to while
   it is hidden. Pure functions, unit-tested. */
import { bulkCloseTargets } from "../tab-order";
import {
  buildSessionLineageTree,
  type SessionLineageNode,
} from "../worktree-agent-lineage";

/** A strip session reduced to what the lineage tree reads. */
export type TabLineageSession = {
  id: string;
  parentSessionId?: string | null;
};

export type TabStripLineage = {
  /**
   * The strip order with every group made contiguous: a leader is
   * immediately followed by its descendants, depth-first, each kept in the
   * relative position the stored order gave it, and pinned groups moved to
   * the front as whole runs. Non-session ids (browser, editor, Mentu) keep
   * their own positions and pin like the singletons they are.
   */
  order: string[];
  /** `order` minus the tabs a collapsed group is currently hiding. */
  visibleOrder: string[];
  /** Direct children per leader session id; only leaders that have any. */
  childrenByLeaderId: ReadonlyMap<string, string[]>;
  /** Every descendant of a leader, depth-first (its whole group). */
  descendantsByLeaderId: ReadonlyMap<string, string[]>;
  /** Hidden session id -> the collapsed leader whose group hides it. */
  hiddenBy: ReadonlyMap<string, string>;
  /** Nesting depth per session id; 0 for a leader / ungrouped session. */
  depthById: ReadonlyMap<string, number>;
  /** The group root every session belongs to; a root maps to itself. */
  rootBySessionId: ReadonlyMap<string, string>;
};

export type TabStripLineageInput = {
  /** Reconciled strip order (session, browser, editor and Mentu ids). */
  order: readonly string[];
  /** The sessions that own strip tabs, in any order. */
  sessions: readonly TabLineageSession[];
  /** Leaders the user has folded shut. */
  collapsedLeaderIds?: readonly string[] | ReadonlySet<string>;
  /**
   * Pinned tab ids. Pinning is partitioned again AFTER grouping, at group
   * granularity: pinning a leader carries its group to the front instead of
   * leaving unpinned subagents stranded inside the pinned run.
   */
  pinnedIds?: readonly string[] | ReadonlySet<string>;
};

const EMPTY_LINEAGE: TabStripLineage = {
  order: [],
  visibleOrder: [],
  childrenByLeaderId: new Map(),
  descendantsByLeaderId: new Map(),
  hiddenBy: new Map(),
  depthById: new Map(),
  rootBySessionId: new Map(),
};

/**
 * Group the strip's session tabs under the leaders that spawned them.
 *
 * Only sessions that hold a tab in `order` take part, so a parent whose
 * own tab was closed leaves its children as roots — the card's
 * dangling-parent rule, and the reason a collapsed group can never hide a
 * tab whose leader is not on screen to unfold it again.
 */
export function buildTabStripLineage({
  order,
  sessions,
  collapsedLeaderIds = [],
  pinnedIds = [],
}: TabStripLineageInput): TabStripLineage {
  if (order.length === 0) return EMPTY_LINEAGE;
  const sessionById = new Map<string, TabLineageSession>();
  for (const session of sessions) {
    if (!sessionById.has(session.id)) sessionById.set(session.id, session);
  }
  // Dedupe defensively: a duplicated id would otherwise emit two tabs with
  // the same React key once grouping reorders the strip.
  const seenOrderIds = new Set<string>();
  const strip = order.filter((id) => {
    if (seenOrderIds.has(id)) return false;
    seenOrderIds.add(id);
    return true;
  });
  const stripSessionIds = strip.filter((id) => sessionById.has(id));
  if (stripSessionIds.length === 0) {
    return {
      ...EMPTY_LINEAGE,
      order: strip,
      visibleOrder: strip,
    };
  }

  const nodes: SessionLineageNode[] = stripSessionIds.map((id) => ({
    session: sessionById.get(id) as TabLineageSession,
  }));
  const tree = buildSessionLineageTree(nodes);
  const childrenByLeaderId = new Map<string, string[]>();
  for (const [parentId, children] of tree.childrenByParentSessionId) {
    childrenByLeaderId.set(
      parentId,
      children.map((child) => child.session.id),
    );
  }

  // Grouped order: a leader pulls its whole subtree along, so collapsing
  // folds a contiguous run rather than scattered tabs. The subtree keeps
  // the relative order the strip already gave it, which is what a drag or
  // a pin reorder writes back.
  const positionInStrip = new Map<string, number>();
  strip.forEach((id, index) => positionInStrip.set(id, index));
  const emitted = new Set<string>();
  const depthById = new Map<string, number>();
  const rootBySessionId = new Map<string, string>();
  const groupedOrder: string[] = [];
  const emitSubtree = (sessionId: string, depth: number, rootId: string): void => {
    if (emitted.has(sessionId)) return;
    emitted.add(sessionId);
    groupedOrder.push(sessionId);
    depthById.set(sessionId, depth);
    rootBySessionId.set(sessionId, rootId);
    const children = [...(childrenByLeaderId.get(sessionId) ?? [])].sort(
      (a, b) =>
        (positionInStrip.get(a) ?? 0) - (positionInStrip.get(b) ?? 0),
    );
    for (const childId of children) emitSubtree(childId, depth + 1, rootId);
  };
  const rootSessionIds = new Set(
    tree.rootRows.map((row) => row.session.id),
  );
  for (const id of strip) {
    if (!sessionById.has(id)) {
      groupedOrder.push(id);
      continue;
    }
    // A child reached before its leader waits for the leader's subtree;
    // an unreachable one (leader gone) is already a root here.
    if (!rootSessionIds.has(id)) continue;
    emitSubtree(id, 0, id);
  }
  // Belt and braces: anything the walk could not reach still gets a tab.
  for (const id of strip) {
    if (sessionById.has(id) && !emitted.has(id)) emitSubtree(id, 0, id);
  }

  // Pinning is re-applied here, after grouping, because the caller's
  // partitionPinnedOrder ran over the flat order: pinning a leader whose
  // subagents are unpinned would otherwise seat unpinned tabs inside the
  // pinned run. A group moves as one, led by its root's pin.
  const pinned = new Set(pinnedIds);
  const runs: { rootId: string; ids: string[] }[] = [];
  for (const id of groupedOrder) {
    const rootId = rootBySessionId.get(id) ?? id;
    const openRun = runs[runs.length - 1];
    if (openRun && openRun.rootId === rootId && rootBySessionId.has(id)) {
      openRun.ids.push(id);
    } else {
      runs.push({ rootId, ids: [id] });
    }
  }
  const partitionedOrder = [
    ...runs.filter((run) => pinned.has(run.rootId)),
    ...runs.filter((run) => !pinned.has(run.rootId)),
  ].flatMap((run) => run.ids);

  const descendantsByLeaderId = new Map<string, string[]>();
  const collectDescendants = (sessionId: string): string[] => {
    const cached = descendantsByLeaderId.get(sessionId);
    if (cached) return cached;
    const out: string[] = [];
    // Guard against a cycle the tree normalizer did not already unwind.
    descendantsByLeaderId.set(sessionId, out);
    for (const childId of childrenByLeaderId.get(sessionId) ?? []) {
      out.push(childId, ...collectDescendants(childId));
    }
    return out;
  };
  for (const leaderId of childrenByLeaderId.keys()) collectDescendants(leaderId);

  const collapsed = new Set(collapsedLeaderIds);
  const hiddenBy = new Map<string, string>();
  for (const id of partitionedOrder) {
    if (!collapsed.has(id) || !childrenByLeaderId.has(id)) continue;
    // A nested collapsed leader inside an already-hidden group keeps the
    // outermost one as the owner, so unfolding it reveals the whole path.
    const owner = hiddenBy.get(id) ?? id;
    for (const descendantId of descendantsByLeaderId.get(id) ?? []) {
      if (!hiddenBy.has(descendantId)) hiddenBy.set(descendantId, owner);
    }
  }

  return {
    order: partitionedOrder,
    visibleOrder: partitionedOrder.filter((id) => !hiddenBy.has(id)),
    childrenByLeaderId,
    descendantsByLeaderId,
    hiddenBy,
    depthById,
    rootBySessionId,
  };
}

/**
 * Where the prompt goes: a hidden subagent never owns the input, so while
 * its group is collapsed the leader answers for it. Any other tab — a
 * visible subagent, a browser tab, nothing selected — is returned
 * unchanged, so this can sit on every selection path without inventing a
 * target of its own.
 */
export function resolveTabPromptTarget(
  activeSessionId: string,
  lineage: Pick<TabStripLineage, "hiddenBy">,
): string {
  return lineage.hiddenBy.get(activeSessionId) ?? activeSessionId;
}

/**
 * Toggle one leader's fold.
 *
 * Ids for sessions that no longer exist are dropped so the persisted set
 * cannot grow with every finished fan-out; a leader whose children have
 * merely exited keeps its fold, because the group is the same group when
 * it spawns the next worker. `knownSessionIds` empty means "not known
 * yet" (a workspace whose sessions have not loaded) and prunes nothing.
 */
export function toggleCollapsedLeader(
  collapsedLeaderIds: readonly string[],
  leaderId: string,
  knownSessionIds: ReadonlySet<string>,
): string[] {
  const next = new Set(collapsedLeaderIds);
  if (next.has(leaderId)) next.delete(leaderId);
  else next.add(leaderId);
  if (knownSessionIds.size === 0) return [...next];
  return [...next].filter((id) => knownSessionIds.has(id));
}

/**
 * Bulk close ("others" / "to the right" / "to the left") over what the strip
 * actually shows.
 *
 * Run over the flat order instead, "to the right" of a leader closes tabs
 * that grouping moved elsewhere, and "others" reaches into folded groups and
 * stops PTYs the user cannot see. Closing is destructive, so it follows the
 * visible order — and a folded group goes with the leader it is folded into,
 * because that tab is what stands for it on screen.
 */
export function foldAwareBulkCloseTargets({
  lineage,
  pinnedIds,
  anchorId,
  mode,
}: {
  lineage: Pick<
    TabStripLineage,
    "visibleOrder" | "descendantsByLeaderId" | "hiddenBy"
  >;
  pinnedIds: ReadonlySet<string> | readonly string[];
  anchorId: string;
  mode: "others" | "to-right" | "to-left";
}): string[] {
  const pinned = new Set(pinnedIds);
  const visible = bulkCloseTargets(
    lineage.visibleOrder,
    pinned,
    anchorId,
    mode,
  );
  return visible.flatMap((id) => [
    id,
    // Only the tabs THIS leader is hiding: a nested fold under a visible
    // leader is carried by that leader's own entry in `visible`.
    //
    // Why the pin check repeats here: bulkCloseTargets can only filter pins
    // it can see, and a folded tab is not in `visibleOrder`. Without this, a
    // subagent the user pinned and then folded away would be closed by a
    // bulk action — the one thing a pin is a promise against.
    ...(lineage.descendantsByLeaderId.get(id) ?? []).filter(
      (descendantId) =>
        lineage.hiddenBy.get(descendantId) === id && !pinned.has(descendantId),
    ),
  ]);
}
