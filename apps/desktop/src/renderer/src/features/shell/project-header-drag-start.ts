/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/project-header-drag-start.ts
   (createProjectHeaderDragSession). Adapter: single flat project list
   (no buckets); the known-project set replaces the fork's repo map. The
   "Why" comments below are the source's. */

import { measureProjectHeaderDragRects } from "./sidebar-project-drop";
import {
  isProjectHeaderDragHandleTarget,
  isProjectHeaderActionTarget,
  type ProjectHeaderDragSession,
} from "./project-header-drag-contract";

export function createProjectHeaderDragSession(args: {
  event: React.PointerEvent<HTMLElement>;
  projectId: string;
  knownProjectIds: ReadonlySet<string>;
  visibleProjectIds: readonly string[];
  getScrollContainer: () => HTMLElement | null;
}): ProjectHeaderDragSession | null {
  if (args.event.button !== 0) {
    return null;
  }
  if (
    !isProjectHeaderDragHandleTarget(args.event.target, args.event.currentTarget)
  ) {
    return null;
  }
  if (isProjectHeaderActionTarget(args.event.target, args.event.currentTarget)) {
    return null;
  }
  if (!args.knownProjectIds.has(args.projectId)) {
    return null;
  }
  const sidebarProjectHeaderIds = args.visibleProjectIds;
  // Why: a single project in its bucket has nowhere to land, so skip arming
  // drag and let the header click toggle collapse instead.
  if (sidebarProjectHeaderIds.length <= 1) {
    return null;
  }
  const container = args.getScrollContainer();
  if (!container) {
    return null;
  }
  const handleEl = args.event.currentTarget;
  // Why: defer setPointerCapture until the drag threshold is crossed so a
  // header click still reaches the inner collapse handler on pointerup.
  return {
    projectId: args.projectId,
    sidebarProjectHeaderIds,
    pointerId: args.event.pointerId,
    headerRects: measureProjectHeaderDragRects(container),
    handleEl,
    startX: args.event.clientX,
    startY: args.event.clientY,
    latestPointerY: args.event.clientY,
    promoted: false,
  };
}
