/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/project-header-drop.ts
   (measureProjectHeaderDragRects, computeProjectHeaderDropPreview),
   src/renderer/src/components/sidebar/worktree-sidebar-header-drop-preview.ts
   (the shared header-slot math both header tiers delegate to) and the
   autoscroll/boundary helpers of
   src/renderer/src/components/sidebar/worktree-sidebar-drag-autoscroll.ts
   (getWorktreeSidebarDragAutoscroll, getWorktreeSidebarBoundaryDrop).
   Adapter: Repo -> Project, single flat list (no buckets, no virtual
   rows, no section ends); the dragged header keeps its slot while the
   drop line shows the target, exactly like the source. The "Why"
   comments below are the source's. */

import type { ProjectHeaderDragRect } from "./project-header-drag-contract";

export type SidebarHeaderDropPreview = {
  dropIndex: number;
  dropIndicatorY: number;
};

const INDICATOR_GAP_PX = 4;
const EDGE_ZONE_PX = 56;
const MAX_OUTSIDE_EDGE_PX = 48;
const MAX_SCROLL_SPEED_PX_PER_SECOND = 960;
const MAX_FRAME_MS = 32;
const DROP_BOUNDS_PADDING_PX = 8;

export function measureProjectHeaderDragRects(
  container: HTMLElement,
): ProjectHeaderDragRect[] {
  const containerRect = container.getBoundingClientRect();
  const rects: ProjectHeaderDragRect[] = [];
  container
    .querySelectorAll<HTMLElement>("[data-project-header-id]")
    .forEach((element) => {
      const projectId = element.getAttribute("data-project-header-id");
      const rawHeaderIndex = element.getAttribute("data-project-header-index");
      const headerIndex = rawHeaderIndex === null ? Number.NaN : Number(rawHeaderIndex);
      if (!projectId || !Number.isFinite(headerIndex)) {
        return;
      }
      const rect = element.getBoundingClientRect();
      const top = rect.top - containerRect.top + container.scrollTop;
      rects.push({
        projectId,
        headerIndex,
        top,
        bottom: top + rect.height,
      });
    });
  rects.sort((left, right) => left.top - right.top);
  return rects;
}

type BoundaryDropResult =
  | { kind: "drop"; dropIndex: number; indicatorY: number }
  | { kind: "inside" }
  | { kind: "outside" };

function getHeaderBoundaryDrop(args: {
  localY: number;
  firstRect: { groupIndex: number; top: number; bottom: number };
  lastRect: { groupIndex: number; top: number; bottom: number };
  sourceGroupSize: number;
}): BoundaryDropResult {
  if (args.localY < args.firstRect.top - DROP_BOUNDS_PADDING_PX) {
    if (
      args.firstRect.groupIndex === 0 &&
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
      args.lastRect.groupIndex === lastGroupIndex &&
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

type HeaderBoundarySlot = {
  dropIndex: number;
  indicatorY: number;
};

function pickNearestHeaderBoundarySlot(
  rects: readonly ProjectHeaderDragRect[],
  localY: number,
): HeaderBoundarySlot | null {
  let prevRect: ProjectHeaderDragRect | undefined;
  let nextRect: ProjectHeaderDragRect | undefined;
  for (const rect of rects) {
    if (rect.top <= localY) {
      prevRect = rect;
    } else if (nextRect === undefined) {
      nextRect = rect;
    }
  }

  const afterPrev: HeaderBoundarySlot | null = prevRect
    ? {
        dropIndex: prevRect.headerIndex + 1,
        indicatorY: prevRect.bottom + INDICATOR_GAP_PX,
      }
    : null;
  const beforeNext: HeaderBoundarySlot | null = nextRect
    ? {
        dropIndex: nextRect.headerIndex,
        indicatorY: Math.max(0, nextRect.top - INDICATOR_GAP_PX),
      }
    : null;

  if (!afterPrev) return beforeNext;
  if (!beforeNext) return afterPrev;
  // Ties (localY at the span midpoint) resolve to the next header's boundary.
  return Math.abs(localY - beforeNext.indicatorY) <=
    Math.abs(localY - afterPrev.indicatorY)
    ? beforeNext
    : afterPrev;
}

export function computeProjectHeaderDropPreview(args: {
  pointerY: number;
  containerTop: number;
  scrollTop: number;
  rects: readonly ProjectHeaderDragRect[];
  headerCount: number;
  /** Measured scroll-content height; bounds the interior snap so it cannot fabricate a slot below the real list end. */
  contentBottom?: number;
}): SidebarHeaderDropPreview | null {
  if (args.rects.length === 0 || args.headerCount === 0) {
    return null;
  }

  const localY = args.pointerY - args.containerTop + args.scrollTop;
  // Why: every preview branch, including estimated edge slots, must stay
  // inside the measured list content rather than fabricate a reorder below it.
  if (args.contentBottom !== undefined && localY > args.contentBottom) {
    return null;
  }
  const first = args.rects[0]!;
  const last = args.rects.at(-1)!;
  const boundaryDrop = getHeaderBoundaryDrop({
    localY,
    firstRect: {
      groupIndex: first.headerIndex,
      top: first.top,
      bottom: first.bottom,
    },
    lastRect: {
      groupIndex: last.headerIndex,
      top: last.top,
      bottom: last.bottom,
    },
    sourceGroupSize: args.headerCount,
  });
  if (boundaryDrop.kind === "outside") {
    return null;
  }
  if (boundaryDrop.kind === "drop") {
    return {
      dropIndex: boundaryDrop.dropIndex,
      dropIndicatorY: Math.max(args.scrollTop, boundaryDrop.indicatorY),
    };
  }

  const hoveredRect = args.rects.find(
    (rect) => localY >= rect.top && localY <= rect.bottom,
  );
  if (hoveredRect) {
    const mid = (hoveredRect.top + hoveredRect.bottom) / 2;
    const dropIndex =
      localY < mid ? hoveredRect.headerIndex : hoveredRect.headerIndex + 1;
    const nextRect =
      localY < mid
        ? hoveredRect
        : args.rects.find((rect) => rect.headerIndex >= dropIndex);
    const indicatorY = nextRect
      ? Math.max(0, nextRect.top - INDICATOR_GAP_PX)
      : hoveredRect.bottom + INDICATOR_GAP_PX;

    return {
      dropIndex,
      dropIndicatorY: Math.max(args.scrollTop, indicatorY),
    };
  }

  // localY is in a section body or interior gap, not a header band. Snap to the
  // nearer boundary slot instead of returning null: this interior dead zone was
  // accidental scope of 22d5989ed (#6609 only required correct reorder indices),
  // and vanishing here makes the drop a silent no-op.
  const boundary = pickNearestHeaderBoundarySlot(args.rects, localY);
  if (!boundary) {
    return null;
  }
  return {
    dropIndex: boundary.dropIndex,
    dropIndicatorY: Math.max(args.scrollTop, boundary.indicatorY),
  };
}

export function getSidebarDragAutoscroll(args: {
  point: { clientX: number; clientY: number };
  containerRect: Pick<DOMRect, "left" | "right" | "top" | "bottom">;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  elapsedMs: number;
}): { scrollTop: number } | null {
  const { point, containerRect } = args;
  if (point.clientX < containerRect.left || point.clientX > containerRect.right) {
    return null;
  }

  const maxScrollTop = Math.max(0, args.scrollHeight - args.clientHeight);
  if (maxScrollTop <= 0) {
    return null;
  }

  const scrollTop = Math.max(0, Math.min(maxScrollTop, args.scrollTop));
  const elapsedMs = Math.max(0, Math.min(MAX_FRAME_MS, args.elapsedMs));
  if (elapsedMs <= 0) {
    return null;
  }

  const edge = getVerticalEdgeIntensity(point.clientY, containerRect);
  if (!edge) {
    return null;
  }

  const nextScrollTop = Math.max(
    0,
    Math.min(
      maxScrollTop,
      scrollTop +
        edge.direction * edge.intensity * MAX_SCROLL_SPEED_PX_PER_SECOND * (elapsedMs / 1000),
    ),
  );
  return nextScrollTop === scrollTop ? null : { scrollTop: nextScrollTop };
}

function getVerticalEdgeIntensity(
  clientY: number,
  containerRect: Pick<DOMRect, "top" | "bottom">,
): { direction: -1 | 1; intensity: number } | null {
  if (clientY < containerRect.top - MAX_OUTSIDE_EDGE_PX) {
    return null;
  }
  if (clientY > containerRect.bottom + MAX_OUTSIDE_EDGE_PX) {
    return null;
  }
  if (clientY <= containerRect.top + EDGE_ZONE_PX) {
    return {
      direction: -1,
      intensity: Math.min(1, (containerRect.top + EDGE_ZONE_PX - clientY) / EDGE_ZONE_PX),
    };
  }
  if (clientY >= containerRect.bottom - EDGE_ZONE_PX) {
    return {
      direction: 1,
      intensity: Math.min(1, (clientY - (containerRect.bottom - EDGE_ZONE_PX)) / EDGE_ZONE_PX),
    };
  }
  return null;
}
