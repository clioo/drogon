/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/project-header-drag-contract.ts
   (RepoDragState, session, threshold, handle/action target predicates).
   Adapter: Repo -> Project (Drogon has one flat project list, no paired
   hosts or project groups), React import type only. The "Why" comments
   below are the source's. */

export type ProjectDragState = {
  draggingProjectId: string | null;
  dropIndex: number | null;
  dropIndicatorY: number | null;
};

export const INITIAL_PROJECT_DRAG_STATE: ProjectDragState = {
  draggingProjectId: null,
  dropIndex: null,
  dropIndicatorY: null,
};

export type UseProjectHeaderDragArgs = {
  /** Full project order (stored order reconciled with every group). */
  allProjectIds: readonly string[];
  /** Project ids currently rendered as headers (after filtering). */
  visibleProjectIds: readonly string[];
  knownProjectIds: ReadonlySet<string>;
  onCommitProjectOrder: (orderedIds: string[]) => void;
  getScrollContainer: () => HTMLElement | null;
};

export type ProjectHeaderDragController = {
  state: ProjectDragState;
  onHandlePointerDown: (
    event: React.PointerEvent<HTMLElement>,
    projectId: string,
  ) => void;
};

export type ProjectHeaderDragSession = {
  projectId: string;
  sidebarProjectHeaderIds: readonly string[];
  pointerId: number;
  headerRects: ProjectHeaderDragRect[];
  handleEl: HTMLElement;
  startX: number;
  startY: number;
  latestPointerY: number;
  promoted: boolean;
};

export type ProjectHeaderDragRect = {
  projectId: string;
  /** Index among the visible project headers, not the mounted subset. */
  headerIndex: number;
  top: number;
  bottom: number;
};

export const PROJECT_HEADER_DRAG_THRESHOLD_PX = 4;

const PROJECT_HEADER_DRAG_HANDLE_SELECTOR = "[data-project-header-drag-handle]";

// Shared with the worktree card: both reuse the project header actions markup.
export const PROJECT_HEADER_ACTION_SELECTOR =
  '[data-project-header-actions], [data-project-header-action], button, a, input, textarea, select, [contenteditable=""], [contenteditable="true"]';

export function isProjectHeaderDragHandleTarget(
  target: EventTarget | null,
  currentTarget: HTMLElement,
): boolean {
  // Why: the project icon renders as an <svg>, so pressing it makes the event
  // target an SVGElement (not an HTMLElement). Match Element so dragging by the
  // icon still arms the drag; closest/contains work on any Element.
  if (!(target instanceof Element)) {
    return false;
  }
  const dragHandle = target.closest(PROJECT_HEADER_DRAG_HANDLE_SELECTOR);
  return dragHandle !== null && currentTarget.contains(dragHandle);
}

export function isProjectHeaderActionTarget(
  target: EventTarget | null,
  currentTarget: HTMLElement,
): boolean {
  // Why: an <svg> icon inside an action button is an SVGElement, so match
  // Element to still treat it as an action target and not arm a drag.
  if (!(target instanceof Element) || target === currentTarget) {
    return false;
  }
  return (
    currentTarget.contains(target) &&
    target.closest(PROJECT_HEADER_ACTION_SELECTOR) !== null
  );
}
