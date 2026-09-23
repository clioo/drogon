/* MIT Copyright (c) 2026 Lovecast Inc.
   Sidebar multi-selection model for worktree cards: the pure state
   machine behind Cmd/Ctrl+click (toggle), Shift+click (range) and the
   plain click that collapses a selection back to one workspace. Kept
   free of React so the gesture rules are testable on their own and the
   sidebar keeps exactly one authority for "which cards are selected".

   Selection is a set of worktree ids ordered by the sidebar's rendered
   order, so a bulk action reads top-to-bottom like the list the user is
   looking at, regardless of the order the clicks happened in. */

export type WorktreeSelectionState = {
  /** Selected worktree ids, in rendered sidebar order. */
  readonly ids: readonly string[];
  /** The last card a selection gesture pivoted on; Shift extends from here. */
  readonly anchorId: string | null;
};

export const EMPTY_WORKTREE_SELECTION: WorktreeSelectionState = {
  ids: [],
  anchorId: null,
};

export type WorktreeSelectionModifiers = {
  /** Cmd (macOS) / Ctrl: add or remove one card. */
  readonly toggle: boolean;
  /** Shift: select the span between the anchor and this card. */
  readonly range: boolean;
};

/** Reads the platform modifiers off a mouse/keyboard event. */
export function worktreeSelectionModifiers(event: {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
}): WorktreeSelectionModifiers {
  return {
    toggle: Boolean(event.metaKey) || Boolean(event.ctrlKey),
    range: Boolean(event.shiftKey),
  };
}

/** Whether a click carries a selection intent instead of "open this workspace". */
export function isWorktreeSelectionGesture(
  modifiers: WorktreeSelectionModifiers,
): boolean {
  return modifiers.toggle || modifiers.range;
}

function orderSelection(
  ids: Iterable<string>,
  order: readonly string[],
): string[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  const unique = [...new Set(ids)];
  return unique.sort((a, b) => {
    const aRank = rank.get(a);
    const bRank = rank.get(b);
    // Ids the sidebar is not currently rendering (filtered/collapsed away)
    // keep a stable tail position instead of jumping the list.
    if (aRank === undefined && bRank === undefined) return a.localeCompare(b);
    if (aRank === undefined) return 1;
    if (bRank === undefined) return -1;
    return aRank - bRank;
  });
}

/**
 * Next selection after a click on `worktreeId`.
 *
 * - Shift with a live anchor selects the inclusive span between them.
 * - Cmd/Ctrl toggles the one card and re-anchors on it.
 * - A plain click clears the selection (the caller then opens the workspace).
 */
export function applyWorktreeSelectionClick({
  selection,
  worktreeId,
  modifiers,
  order,
}: {
  selection: WorktreeSelectionState;
  worktreeId: string;
  modifiers: WorktreeSelectionModifiers;
  /** Rendered sidebar order; the domain Shift ranges are measured in. */
  order: readonly string[];
}): WorktreeSelectionState {
  if (modifiers.range) {
    const anchorIndex =
      selection.anchorId === null ? -1 : order.indexOf(selection.anchorId);
    const targetIndex = order.indexOf(worktreeId);
    if (anchorIndex === -1 || targetIndex === -1) {
      // No usable anchor (first Shift+click, or the anchor scrolled out of
      // the rendered set): start a fresh single-card selection here.
      return { ids: [worktreeId], anchorId: worktreeId };
    }
    const from = Math.min(anchorIndex, targetIndex);
    const to = Math.max(anchorIndex, targetIndex);
    return {
      ids: order.slice(from, to + 1),
      // The anchor is held so repeated Shift+clicks re-measure the span
      // from the same pivot instead of walking it.
      anchorId: selection.anchorId,
    };
  }
  if (modifiers.toggle) {
    if (selection.ids.includes(worktreeId)) {
      const ids = selection.ids.filter((id) => id !== worktreeId);
      return {
        ids,
        anchorId: ids.length === 0 ? null : (ids[ids.length - 1] ?? null),
      };
    }
    return {
      ids: orderSelection([...selection.ids, worktreeId], order),
      anchorId: worktreeId,
    };
  }
  return EMPTY_WORKTREE_SELECTION;
}

/**
 * Right-click rule: a secondary click inside a multi-selection keeps it
 * (the menu acts on every selected card); a right-click on any other card
 * collapses the selection so the menu can never act on cards the user is
 * not pointing at.
 */
export function selectionForContextMenu({
  selection,
  worktreeId,
}: {
  selection: WorktreeSelectionState;
  worktreeId: string;
}): WorktreeSelectionState {
  if (selection.ids.includes(worktreeId)) return selection;
  return EMPTY_WORKTREE_SELECTION;
}

/** The ids a card's context menu acts on: the selection when this card is
 *  part of a real multi-selection, otherwise null (single-card menu). */
export function bulkTargetIds({
  selection,
  worktreeId,
}: {
  selection: WorktreeSelectionState;
  worktreeId: string;
}): readonly string[] | null {
  if (selection.ids.length < 2) return null;
  if (!selection.ids.includes(worktreeId)) return null;
  return selection.ids;
}

/** Drops ids that no longer exist (deleted worktrees, removed projects). */
export function pruneWorktreeSelection(
  selection: WorktreeSelectionState,
  knownIds: Iterable<string>,
): WorktreeSelectionState {
  const known = new Set(knownIds);
  const ids = selection.ids.filter((id) => known.has(id));
  if (ids.length === selection.ids.length) return selection;
  const anchorId =
    selection.anchorId !== null && known.has(selection.anchorId)
      ? selection.anchorId
      : (ids[ids.length - 1] ?? null);
  return { ids, anchorId };
}

/** Accessible summary for the sidebar's selection status line. */
export function formatWorktreeSelectionSummary(count: number): string {
  if (count <= 0) return "";
  return `${count} workspace${count === 1 ? "" : "s"} selected`;
}
