/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/right-sidebar-width.ts
   (clamp/max math verbatim) plus the createRightSidebarState defaults
   (width 280, min 220). Adapter: zustand persistence becomes the shell's
   own localStorage keys, mirroring features/shell/sidebar-width.ts; the
   top activity-bar layout has no side strip, so renderedExtraWidth is 0. */

export const RIGHT_SIDEBAR_DEFAULT_WIDTH = 280;
export const RIGHT_SIDEBAR_MIN_WIDTH = 220;
export const RIGHT_SIDEBAR_MIN_NON_SIDEBAR_AREA = 320;
export const RIGHT_SIDEBAR_ABSOLUTE_FALLBACK_MAX_WIDTH = 2000;

export const RIGHT_SIDEBAR_WIDTH_STORAGE_KEY = "drogon:right-sidebar:width";
export const RIGHT_SIDEBAR_OPEN_STORAGE_KEY = "drogon:right-sidebar:open";

export function computeMaxRightSidebarPanelWidth(
  windowWidth: number | null | undefined,
): number {
  if (typeof windowWidth !== "number" || !Number.isFinite(windowWidth)) {
    return RIGHT_SIDEBAR_ABSOLUTE_FALLBACK_MAX_WIDTH;
  }
  return Math.max(
    RIGHT_SIDEBAR_MIN_WIDTH,
    windowWidth - RIGHT_SIDEBAR_MIN_NON_SIDEBAR_AREA,
  );
}

export function clampRightSidebarPanelWidth(
  width: number,
  windowWidth: number | null | undefined,
): number {
  return Math.min(
    computeMaxRightSidebarPanelWidth(windowWidth),
    Math.max(RIGHT_SIDEBAR_MIN_WIDTH, width),
  );
}

export function loadRightSidebarWidth(
  storage: Pick<Storage, "getItem">,
): number {
  try {
    const raw = storage.getItem(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY);
    if (raw === null) return RIGHT_SIDEBAR_DEFAULT_WIDTH;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return RIGHT_SIDEBAR_DEFAULT_WIDTH;
    return Math.min(
      RIGHT_SIDEBAR_ABSOLUTE_FALLBACK_MAX_WIDTH,
      Math.max(RIGHT_SIDEBAR_MIN_WIDTH, Math.round(parsed)),
    );
  } catch {
    return RIGHT_SIDEBAR_DEFAULT_WIDTH;
  }
}

export function saveRightSidebarWidth(
  storage: Pick<Storage, "setItem">,
  width: number,
): void {
  try {
    storage.setItem(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // No durability promise; in-memory state stays authoritative.
  }
}

/**
 * Nullable read of the saved open choice: null means nothing was saved yet
 * and the caller falls back to the inspector default for the viewport.
 */
export function loadRightSidebarOpen(
  storage: Pick<Storage, "getItem">,
): boolean | null {
  try {
    const raw = storage.getItem(RIGHT_SIDEBAR_OPEN_STORAGE_KEY);
    if (raw === null) return null;
    return raw !== "0";
  } catch {
    return null;
  }
}

export function saveRightSidebarOpen(
  storage: Pick<Storage, "setItem">,
  open: boolean,
): void {
  try {
    storage.setItem(RIGHT_SIDEBAR_OPEN_STORAGE_KEY, open ? "1" : "0");
  } catch {
    // No durability promise; in-memory state stays authoritative.
  }
}

/** Pointer delta for the sidebar's LEFT-edge drag (dragging left widens). */
export function nextRightSidebarWidth(
  startWidth: number,
  startX: number,
  clientX: number,
  windowWidth: number | null | undefined,
): number {
  return clampRightSidebarPanelWidth(
    startWidth - (clientX - startX),
    windowWidth,
  );
}
