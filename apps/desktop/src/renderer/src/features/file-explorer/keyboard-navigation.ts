/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/file-explorer-keyboard-navigation.ts.
   Adapted: the projection interface is the local flat-row shape
   (tree-model.ts) instead of the source's FileExplorerRowProjection; the
   resolution semantics (VS Code-style arrows, Home/End/PageUp/PageDown,
   Left/Right collapse/expand and parent/child steps, Shift+arrow ranges)
   are unchanged. */

export type NavigationKey =
  | "ArrowDown"
  | "ArrowUp"
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown";

export type ResolvedNavigation =
  | { type: "move"; targetIndex: number }
  | { type: "toggle-expand"; currentIndex: number; dirPath: string }
  | { type: "toggle-collapse"; currentIndex: number; dirPath: string }
  | { type: "no-op" }
  | { type: "unhandled" };

export type SelectionMode = "replace" | "toggle" | "range" | "additive-range";

/** Minimal visible-order projection the navigation resolves against. */
export interface NavigationProjection {
  getVisibleCount(): number;
  getRowAtIndex(index: number): { path: string; isDirectory: boolean } | null;
  getParentIndex(index: number): number | null;
  getFirstChildIndex(index: number): number | null;
}

/**
 * Resolve a tree-navigation key to a target row index, mirroring the VS Code
 * Explorer tree: arrow keys move within the flat visible order, Left/Right
 * collapse/expand folders or step across parent/child boundaries, and
 * Home/End/PageUp/PageDown jump along the visible list.
 */
export function resolveNavigationTarget(args: {
  key: NavigationKey;
  currentIndex: number | null;
  rowProjection: NavigationProjection;
  total: number;
  isExpanded: (path: string) => boolean;
}): ResolvedNavigation {
  const { key, currentIndex, rowProjection, total, isExpanded } = args;
  if (total === 0) return { type: "no-op" };

  if (currentIndex === null) {
    if (key === "ArrowDown" || key === "End" || key === "PageDown") {
      return { type: "move", targetIndex: 0 };
    }
    if (key === "ArrowUp" || key === "Home" || key === "PageUp") {
      return { type: "move", targetIndex: total - 1 };
    }
    return { type: "unhandled" };
  }

  switch (key) {
    case "ArrowDown":
      return { type: "move", targetIndex: Math.min(total - 1, currentIndex + 1) };
    case "ArrowUp":
      return { type: "move", targetIndex: Math.max(0, currentIndex - 1) };
    case "Home":
      return { type: "move", targetIndex: 0 };
    case "End":
      return { type: "move", targetIndex: total - 1 };
    case "PageDown": {
      const pageSize = Math.max(1, Math.floor(total / 10));
      return {
        type: "move",
        targetIndex: Math.min(total - 1, currentIndex + pageSize),
      };
    }
    case "PageUp": {
      const pageSize = Math.max(1, Math.floor(total / 10));
      return {
        type: "move",
        targetIndex: Math.max(0, currentIndex - pageSize),
      };
    }
    case "ArrowRight": {
      const node = rowProjection.getRowAtIndex(currentIndex);
      if (!node || !node.isDirectory) {
        return { type: "move", targetIndex: currentIndex };
      }
      if (!isExpanded(node.path)) {
        return { type: "toggle-expand", currentIndex, dirPath: node.path };
      }
      const firstChild = rowProjection.getFirstChildIndex(currentIndex);
      return { type: "move", targetIndex: firstChild ?? currentIndex };
    }
    case "ArrowLeft": {
      const node = rowProjection.getRowAtIndex(currentIndex);
      if (!node) return { type: "no-op" };
      if (node.isDirectory && isExpanded(node.path)) {
        return { type: "toggle-collapse", currentIndex, dirPath: node.path };
      }
      const parent = rowProjection.getParentIndex(currentIndex);
      if (parent === null) return { type: "no-op" };
      return { type: "move", targetIndex: parent };
    }
  }
}

const NAVIGATION_KEY_SET: Record<NavigationKey, true> = {
  ArrowDown: true,
  ArrowUp: true,
  ArrowLeft: true,
  ArrowRight: true,
  Home: true,
  End: true,
  PageUp: true,
  PageDown: true,
};

export function isNavigationKey(key: string): key is NavigationKey {
  return key in NAVIGATION_KEY_SET;
}

export type NavigationHandlers = {
  moveSelection: (targetPath: string, mode: SelectionMode) => void;
  toggleDir: (dirPath: string) => void;
  scrollToIndex: (index: number) => void;
  focusRowAtIndex: (index: number) => void;
};

export type NavigationContext = {
  rowProjection: NavigationProjection;
  selectedPath: string | null;
  isExpanded: (path: string) => boolean;
  findFocusedIndex: () => number | null;
  indexOfSelected: () => number | null;
  handlers: NavigationHandlers;
};

/**
 * Apply a tree-navigation key to the explorer: resolve the target, then
 * move the selection (or toggle a directory) and bring the new row into
 * view. Returns true if the key was handled. Modifier-held keys are never
 * handled here (the caller owns Enter/F2/Delete and clipboard chords).
 */
export function applyNavigation(
  ctx: NavigationContext,
  e: KeyboardEvent,
): boolean {
  if (e.altKey || e.metaKey || e.ctrlKey) return false;
  if (!isNavigationKey(e.key)) return false;
  const total = ctx.rowProjection.getVisibleCount();
  const focusedIndex = ctx.findFocusedIndex();
  const activeIndex = ctx.indexOfSelected();
  const currentIndex = focusedIndex ?? activeIndex;

  const resolved = resolveNavigationTarget({
    key: e.key,
    currentIndex,
    rowProjection: ctx.rowProjection,
    total,
    isExpanded: ctx.isExpanded,
  });

  if (resolved.type === "unhandled" || resolved.type === "no-op") return false;

  if (
    resolved.type === "toggle-expand" ||
    resolved.type === "toggle-collapse"
  ) {
    e.preventDefault();
    e.stopPropagation();
    ctx.handlers.toggleDir(resolved.dirPath);
    return true;
  }

  const targetNode = ctx.rowProjection.getRowAtIndex(resolved.targetIndex);
  if (!targetNode) return false;

  e.preventDefault();
  e.stopPropagation();

  // VS Code replaces the selection on bare arrow keys and extends it (from
  // the anchor) on Shift+arrow — the same modes the click handler uses.
  const mode: SelectionMode =
    e.shiftKey && currentIndex !== null ? "range" : "replace";
  ctx.handlers.moveSelection(targetNode.path, mode);

  // Focusing the row button keeps subsequent arrow keys anchored to the new
  // row and lets Enter/Delete pick it up without a separate focus call.
  requestAnimationFrame(() => {
    ctx.handlers.focusRowAtIndex(resolved.targetIndex);
    ctx.handlers.scrollToIndex(resolved.targetIndex);
  });
  return true;
}
