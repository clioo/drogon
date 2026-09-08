/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-sidebar-pointer-drag-dom.ts
   (isSidebarPointerDragBlocked, setSidebarPointerDragDocumentStyles,
   createSidebarDragPreview, updateSidebarDragPreviewPosition) and
   src/renderer/src/components/sidebar/worktree-list/drag/row-state.ts
   (WorktreeRowDragState). Adapter: single-card drags only (Drogon has no
   sidebar multi-select, so the count badge is absent); the dragged card
   is a worktree card inside one project. The "Why" comments below are
   the source's. */

export type WorktreeCardDragState = {
  draggingWorktreeId: string | null;
  sourceProjectId: string | null;
  dropIndex: number | null;
  dropIndicatorY: number | null;
};

export const INITIAL_WORKTREE_CARD_DRAG_STATE: WorktreeCardDragState = {
  draggingWorktreeId: null,
  sourceProjectId: null,
  dropIndex: null,
  dropIndicatorY: null,
};

export type UseWorktreeCardDragArgs = {
  /** Visible card ids per project (after filtering), in render order. */
  visibleCardIdsByProject: ReadonlyMap<string, readonly string[]>;
  /** Full card ids per project (stored order reconciled with every card). */
  fullCardIdsByProject: ReadonlyMap<string, readonly string[]>;
  onCommitWorktreeOrder: (projectId: string, orderedIds: string[]) => void;
  getScrollContainer: () => HTMLElement | null;
};

export type WorktreeCardDragController = {
  state: WorktreeCardDragState;
  onCardPointerDown: (
    event: React.PointerEvent<HTMLElement>,
    projectId: string,
    worktreeId: string,
  ) => void;
  /** Capture-phase click guard: swallows the select click after a drag. */
  onCardClickCapture: (event: React.MouseEvent<HTMLElement>) => void;
};

export type WorktreeCardDragSession = {
  worktreeId: string;
  projectId: string;
  sidebarCardIds: readonly string[];
  pointerId: number;
  cardRects: WorktreeCardDragRect[];
  sourceRow: HTMLElement;
  startX: number;
  startY: number;
  latestPointerX: number;
  latestPointerY: number;
  promoted: boolean;
  preview: HTMLElement | null;
  previewOffsetX: number;
  previewOffsetY: number;
  dropAnchorId: string | null;
};

export type WorktreeCardDragRect = {
  worktreeId: string;
  /** Index among the visible cards of the project, not the mounted subset. */
  cardIndex: number;
  top: number;
  bottom: number;
};

export const WORKTREE_CARD_DRAG_THRESHOLD_PX = 4;

const INTERACTIVE_DRAG_BLOCKER_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="menuitem"]',
  "[data-radix-collection-item]",
].join(",");

/**
 * The card's own select surface. Drogon wraps the whole card face in one
 * <button> (the fork's rows are plain divs), so without this carve-out the
 * blocker below would veto every grab. A promoted drag swallows the
 * follow-up click and a plain click still selects, so starting the
 * session here is safe; narrower controls inside keep blocking.
 */
const CARD_SELECT_SURFACE_SELECTOR = ".shell-worktree-card-select";

export function isWorktreeCardDragBlocked(
  target: EventTarget | null,
  row: HTMLElement,
): boolean {
  if (!(target instanceof Node)) {
    return false;
  }
  // Why: Radix hover cards portal outside the row, but React still bubbles their
  // pointer events through row handlers; text selection there must not drag rows.
  if (!row.contains(target)) {
    return true;
  }
  if (!(target instanceof Element)) {
    return false;
  }
  const blocker = target.closest(INTERACTIVE_DRAG_BLOCKER_SELECTOR);
  if (blocker === null || !row.contains(blocker) || blocker === row) {
    return false;
  }
  if (blocker.matches(CARD_SELECT_SURFACE_SELECTOR)) {
    return false;
  }
  return true;
}

export function setWorktreeCardDragDocumentStyles(enabled: boolean): void {
  // Why: sidebar cards are click-first; the drop line/preview show drag state
  // without replacing the normal pointer cursor while crossing targets.
  document.body.style.userSelect = enabled ? "none" : "";
}

function stripDuplicatePreviewAttributes(preview: HTMLElement): void {
  preview.removeAttribute("id");
  preview.removeAttribute("aria-describedby");
  preview.removeAttribute("data-worktree-card-id");
  preview
    .querySelectorAll<HTMLElement>("[id],[aria-describedby]")
    .forEach((element) => {
      element.removeAttribute("id");
      element.removeAttribute("aria-describedby");
    });
  preview
    .querySelectorAll<HTMLElement>("[data-worktree-card-id]")
    .forEach((element) => {
      element.removeAttribute("data-worktree-card-id");
    });
}

export function updateWorktreeCardPreviewPosition(args: {
  preview: HTMLElement;
  pointerX: number;
  pointerY: number;
  offsetX: number;
  offsetY: number;
}): void {
  const x = args.pointerX - args.offsetX;
  const y = args.pointerY - args.offsetY;
  args.preview.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.015)`;
}

export function createWorktreeCardPreview(args: {
  sourceRow: HTMLElement;
  pointerX: number;
  pointerY: number;
}): {
  preview: HTMLElement;
  offsetX: number;
  offsetY: number;
  height: number;
} {
  const rect = args.sourceRow.getBoundingClientRect();
  const preview = document.createElement("div");
  const clone = args.sourceRow.cloneNode(true) as HTMLElement;
  const offsetX = Math.min(Math.max(args.pointerX - rect.left, 0), rect.width);
  const offsetY = Math.min(Math.max(args.pointerY - rect.top, 0), rect.height);

  stripDuplicatePreviewAttributes(clone);
  preview.setAttribute("data-worktree-card-drag-preview", "true");
  preview.setAttribute("aria-hidden", "true");
  preview.appendChild(clone);

  preview.style.position = "fixed";
  preview.style.left = "0";
  preview.style.top = "0";
  preview.style.width = `${rect.width}px`;
  preview.style.height = `${rect.height}px`;
  preview.style.pointerEvents = "none";
  preview.style.transformOrigin = "top left";
  updateWorktreeCardPreviewPosition({
    preview,
    pointerX: args.pointerX,
    pointerY: args.pointerY,
    offsetX,
    offsetY,
  });
  document.body.appendChild(preview);
  return { preview, offsetX, offsetY, height: rect.height };
}

export function removeWorktreeCardPreview(
  preview: HTMLElement | null,
): void {
  preview?.remove();
}
