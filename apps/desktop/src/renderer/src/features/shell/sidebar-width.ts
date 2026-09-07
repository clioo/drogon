/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/index.tsx (MIN_WIDTH/MAX_WIDTH and
   the `--workspace-sidebar-live-width` draft variable) plus the sidebar
   width half of use-app-chrome-layout.ts (adapter: localStorage owned by
   the shell instead of the zustand settings slice). */

export const SIDEBAR_DEFAULT_WIDTH = 280;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 500;

/** Straddles the sidebar/terminal seam so the divider sits on the border. */
export const SIDEBAR_RESIZE_HANDLE_CLASS_NAME =
  "group absolute -right-1.5 top-0 z-10 flex h-full w-3 cursor-col-resize items-stretch justify-center";
export const SIDEBAR_RESIZE_HANDLE_LINE_CLASS_NAME =
  "h-full w-px bg-transparent transition-colors group-hover:bg-ring/50 group-active:bg-ring";

export const SIDEBAR_WIDTH_STORAGE_KEY = "drogon:shell:sidebar-width";
export const SIDEBAR_OPEN_STORAGE_KEY = "drogon:shell:sidebar-open";
export const SIDEBAR_LIVE_WIDTH_VAR = "--workspace-sidebar-live-width";

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)),
  );
}

export function loadSidebarWidth(storage: Pick<Storage, "getItem">): number {
  try {
    const raw = storage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (raw === null) return SIDEBAR_DEFAULT_WIDTH;
    return clampSidebarWidth(Number(raw));
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

export function saveSidebarWidth(
  storage: Pick<Storage, "setItem">,
  width: number,
): void {
  try {
    storage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(width)));
  } catch {
    // No durability promise; in-memory state stays authoritative.
  }
}

export function loadSidebarOpen(storage: Pick<Storage, "getItem">): boolean {
  try {
    const raw = storage.getItem(SIDEBAR_OPEN_STORAGE_KEY);
    return raw === null ? true : raw !== "0";
  } catch {
    return true;
  }
}

export function saveSidebarOpen(
  storage: Pick<Storage, "setItem">,
  open: boolean,
): void {
  try {
    storage.setItem(SIDEBAR_OPEN_STORAGE_KEY, open ? "1" : "0");
  } catch {
    // No durability promise; in-memory state stays authoritative.
  }
}

/** Draft width while resizing so portal surfaces can reserve the chrome. */
export function setLiveSidebarWidth(width: number): void {
  document.documentElement.style.setProperty(
    SIDEBAR_LIVE_WIDTH_VAR,
    `${width}px`,
  );
}

export function clearLiveSidebarWidth(): void {
  document.documentElement.style.removeProperty(SIDEBAR_LIVE_WIDTH_VAR);
}

/** Pointer delta for a left-edge sidebar drag (dragging right widens). */
export function nextSidebarWidth(
  startWidth: number,
  startX: number,
  clientX: number,
): number {
  return clampSidebarWidth(startWidth + (clientX - startX));
}
