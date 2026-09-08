/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-sidebar-drag-geometry.ts
   (getWorktreeSidebarDragReferenceY, shouldReevaluateWorktreeSidebarDropAnchor,
   resolveWorktreeSidebarDropAnchorIndex, getWorktreeSidebarDropAnchorId,
   getWorktreeSidebarDragGrab) and the card-slot half of
   src/renderer/src/components/sidebar/worktree-sidebar-header-drop-preview.ts
   (computeWorktreeSidebarHeaderDropPreview). Adapter: cards of one project
   instead of headers of one bucket; no virtual rows or section ends, so
   tops are container-relative and the boundary math below is the source's
   getWorktreeSidebarBoundaryDrop operating on card bands. The "Why"
   comments below are the source's. */

import type { WorktreeCardDragRect } from "./worktree-card-drag-contract";

export type WorktreeCardDragGrab = {
  // Distance from the dragged card's top to the grab point, captured at drag start.
  offsetY: number;
  height: number;
};

export type WorktreeCardDropAnchor = {
  // Identity of the card the dragged card inserts before; null means end-of-project.
  beforeWorktreeId: string | null;
  pointerY: number;
  scrollTop: number;
};

export type WorktreeCardDropPreview = {
  dropIndex: number;
  dropIndicatorY: number;
  // Identity of the card the drop inserts before, so the next frame can hold this
  // decision through a card resize instead of re-deciding from moved geometry.
  dropAnchorId: string | null;
};

// Why: sub-pixel pointer jitter and scroll rounding must not count as intent.
const ANCHOR_REEVALUATE_EPSILON_PX = 0.5;
const INDICATOR_GAP_PX = 4;
const EDGE_ZONE_PX = 56;
const DROP_BOUNDS_PADDING_PX = 8;

/**
 * Why: the pointer is not what the user is placing — the card is. Hit-testing the
 * bare pointer makes the same visual placement resolve differently depending on
 * where the card was grabbed, which is the "unnatural" part with tall expanded
 * agent cards: grab one near its bottom and it drops a slot late.
 *
 * Project the dragged card from the pointer and compare its center instead, so
 * the drop follows where the card actually sits.
 */
export function getWorktreeCardDragReferenceY(args: {
  localY: number;
  grab: WorktreeCardDragGrab | null;
  activeHeight: number;
}): number {
  if (!args.grab) {
    return args.localY;
  }
  const height = args.grab.height > 0 ? args.grab.height : args.activeHeight;
  return args.localY - args.grab.offsetY + height / 2;
}

/**
 * Why: cards resize constantly mid-drag — agent statuses stream in and expansion
 * panels animate open — so re-deciding the slot from geometry every frame lets a
 * card growing under a still pointer move the drop target with zero input.
 *
 * Hold the *decision* (insert before this card) rather than the *geometry* it was
 * made from. Re-deriving that identity against live rects each frame keeps the
 * indicator and row previews on one honest coordinate space, while only real
 * pointer or scroll movement can pick a different neighbour.
 */
export function shouldReevaluateWorktreeCardDropAnchor(args: {
  anchor: WorktreeCardDropAnchor | null;
  pointerY: number;
  scrollTop: number;
}): boolean {
  if (!args.anchor) {
    return true;
  }
  return (
    Math.abs(args.anchor.pointerY - args.pointerY) > ANCHOR_REEVALUATE_EPSILON_PX ||
    Math.abs(args.anchor.scrollTop - args.scrollTop) > ANCHOR_REEVALUATE_EPSILON_PX
  );
}

/**
 * Resolve a held anchor back to a drop index in the current layout. Returns null
 * when the anchored card is gone (deleted or filtered), so the caller falls
 * back to a fresh geometric decision.
 */
export function resolveWorktreeCardDropAnchorIndex(args: {
  anchor: WorktreeCardDropAnchor;
  cardIds: readonly string[];
}): number | null {
  if (args.anchor.beforeWorktreeId === null) {
    return args.cardIds.length;
  }
  const targetIndex = args.cardIds.indexOf(args.anchor.beforeWorktreeId);
  return targetIndex !== -1 ? targetIndex : null;
}

export function getWorktreeCardDropAnchorId(args: {
  cardIds: readonly string[];
  dropIndex: number;
}): string | null {
  return args.cardIds[args.dropIndex] ?? null;
}

/**
 * Where inside the dragged card the pointer grabbed it. The floating drag preview
 * is a fixed-size clone of the source row, so these are exactly the numbers that
 * place it on screen — reusing them keeps hit testing agreeing with what the user
 * sees. Returns null for an unmeasured row, degrading to bare-pointer hit testing
 * rather than to a wrong offset.
 */
export function getWorktreeCardDragGrab(args: {
  offsetY: number;
  height: number;
}): WorktreeCardDragGrab | null {
  if (!Number.isFinite(args.offsetY) || !Number.isFinite(args.height) || args.height <= 0) {
    return null;
  }
  return {
    offsetY: Math.min(Math.max(args.offsetY, 0), args.height),
    height: args.height,
  };
}

export function measureWorktreeCardDragRects(
  container: HTMLElement,
  projectId: string,
): WorktreeCardDragRect[] {
  const containerRect = container.getBoundingClientRect();
  const rects: WorktreeCardDragRect[] = [];
  container
    .querySelectorAll<HTMLElement>(`[data-worktree-card-project="${CSS.escape(projectId)}"]`)
    .forEach((element) => {
      const worktreeId = element.getAttribute("data-worktree-card-id");
      const rawCardIndex = element.getAttribute("data-worktree-card-index");
      const cardIndex = rawCardIndex === null ? Number.NaN : Number(rawCardIndex);
      if (!worktreeId || !Number.isFinite(cardIndex)) {
        return;
      }
      const rect = element.getBoundingClientRect();
      const top = rect.top - containerRect.top + container.scrollTop;
      rects.push({
        worktreeId,
        cardIndex,
        top,
        bottom: top + rect.height,
      });
    });
  rects.sort((left, right) => left.top - right.top);
  return rects;
}

type CardBoundaryDrop =
  | { kind: "drop"; dropIndex: number; indicatorY: number }
  | { kind: "inside" }
  | { kind: "outside" };

function getCardBoundaryDrop(args: {
  localY: number;
  firstRect: { cardIndex: number; top: number; bottom: number };
  lastRect: { cardIndex: number; top: number; bottom: number };
  sourceGroupSize: number;
}): CardBoundaryDrop {
  if (args.localY < args.firstRect.top - DROP_BOUNDS_PADDING_PX) {
    if (
      args.firstRect.cardIndex === 0 &&
      args.localY >= args.firstRect.top - EDGE_ZONE_PX
    ) {
      return {
        kind: "drop",
        dropIndex: 0,
        indicatorY: Math.max(0, args.firstRect.top - 3),
      };
    }
    return { kind: "outside" };
  }

  if (args.localY > args.lastRect.bottom + DROP_BOUNDS_PADDING_PX) {
    const lastGroupIndex = args.sourceGroupSize - 1;
    if (
      args.lastRect.cardIndex === lastGroupIndex &&
      args.localY <= args.lastRect.bottom + EDGE_ZONE_PX
    ) {
      return {
        kind: "drop",
        dropIndex: args.sourceGroupSize,
        indicatorY: args.lastRect.bottom + 3,
      };
    }
    return { kind: "outside" };
  }

  return { kind: "inside" };
}

/**
 * Re-derive the drop line for a held anchor against live rects: the held
 * *decision* (insert before this card) stays fixed while the *geometry*
 * it renders from follows the current layout.
 */
export function indicatorYForHeldDropIndex(args: {
  rects: readonly WorktreeCardDragRect[];
  dropIndex: number;
  scrollTop: number;
}): number | null {
  if (args.rects.length === 0) {
    return null;
  }
  const sorted = [...args.rects].sort((left, right) => left.cardIndex - right.cardIndex);
  const atOrAfter = sorted.find((rect) => rect.cardIndex >= args.dropIndex);
  const indicatorY = atOrAfter
    ? Math.max(0, atOrAfter.top - INDICATOR_GAP_PX)
    : sorted.at(-1)!.bottom + INDICATOR_GAP_PX;
  return Math.max(args.scrollTop, indicatorY);
}

function pickNearestCardBoundarySlot(
  rects: readonly WorktreeCardDragRect[],
  localY: number,
): { dropIndex: number; indicatorY: number } | null {
  let prevRect: WorktreeCardDragRect | undefined;
  let nextRect: WorktreeCardDragRect | undefined;
  for (const rect of rects) {
    if (rect.top <= localY) {
      prevRect = rect;
    } else if (nextRect === undefined) {
      nextRect = rect;
    }
  }

  const afterPrev = prevRect
    ? {
        dropIndex: prevRect.cardIndex + 1,
        indicatorY: prevRect.bottom + INDICATOR_GAP_PX,
      }
    : null;
  const beforeNext = nextRect
    ? {
        dropIndex: nextRect.cardIndex,
        indicatorY: Math.max(0, nextRect.top - INDICATOR_GAP_PX),
      }
    : null;

  if (!afterPrev) return beforeNext;
  if (!beforeNext) return afterPrev;
  // Ties (localY at the span midpoint) resolve to the next card's boundary.
  return Math.abs(localY - beforeNext.indicatorY) <=
    Math.abs(localY - afterPrev.indicatorY)
    ? beforeNext
    : afterPrev;
}

/**
 * Geometric slot decision for one pointer position: boundary slots above
 * the first / below the last card, midpoint split over a hovered card,
 * nearest-boundary snap inside a card gap. localY is the grab-projected
 * card center in scroll-content coordinates.
 */
export function computeWorktreeCardDropSlot(args: {
  localY: number;
  scrollTop: number;
  rects: readonly WorktreeCardDragRect[];
  cardIds: readonly string[];
  cardCount: number;
  contentBottom?: number;
}): WorktreeCardDropPreview | null {
  if (args.rects.length === 0 || args.cardCount === 0) {
    return null;
  }
  // Why: every preview branch, including estimated edge slots, must stay
  // inside the measured list content rather than fabricate a reorder below it.
  if (args.contentBottom !== undefined && args.localY > args.contentBottom) {
    return null;
  }
  const first = args.rects[0]!;
  const last = args.rects.at(-1)!;
  const boundaryDrop = getCardBoundaryDrop({
    localY: args.localY,
    firstRect: { cardIndex: first.cardIndex, top: first.top, bottom: first.bottom },
    lastRect: { cardIndex: last.cardIndex, top: last.top, bottom: last.bottom },
    sourceGroupSize: args.cardCount,
  });
  if (boundaryDrop.kind === "outside") {
    return null;
  }
  if (boundaryDrop.kind === "drop") {
    return {
      dropIndex: boundaryDrop.dropIndex,
      dropIndicatorY: Math.max(args.scrollTop, boundaryDrop.indicatorY),
      dropAnchorId: getWorktreeCardDropAnchorId({
        cardIds: args.cardIds,
        dropIndex: boundaryDrop.dropIndex,
      }),
    };
  }

  const hoveredRect = args.rects.find(
    (rect) => args.localY >= rect.top && args.localY <= rect.bottom,
  );
  if (hoveredRect) {
    const mid = (hoveredRect.top + hoveredRect.bottom) / 2;
    const dropIndex =
      args.localY < mid ? hoveredRect.cardIndex : hoveredRect.cardIndex + 1;
    const nextRect =
      args.localY < mid
        ? hoveredRect
        : args.rects.find((rect) => rect.cardIndex >= dropIndex);
    const indicatorY = nextRect
      ? Math.max(0, nextRect.top - INDICATOR_GAP_PX)
      : hoveredRect.bottom + INDICATOR_GAP_PX;
    return {
      dropIndex,
      dropIndicatorY: Math.max(args.scrollTop, indicatorY),
      dropAnchorId: getWorktreeCardDropAnchorId({ cardIds: args.cardIds, dropIndex }),
    };
  }

  // localY is in a card gap, not a card band. Snap to the nearer boundary
  // slot instead of returning null so the drop never silently no-ops.
  const boundary = pickNearestCardBoundarySlot(args.rects, args.localY);
  if (!boundary) {
    return null;
  }
  return {
    dropIndex: boundary.dropIndex,
    dropIndicatorY: Math.max(args.scrollTop, boundary.indicatorY),
    dropAnchorId: getWorktreeCardDropAnchorId({
      cardIds: args.cardIds,
      dropIndex: boundary.dropIndex,
    }),
  };
}
