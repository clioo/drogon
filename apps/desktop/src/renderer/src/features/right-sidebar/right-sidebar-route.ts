/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/store/right-sidebar-route.ts (adapter: the MVP tab set is
   explorer/mentu/source-control/session plus R13-B's ports item — vault,
   worktrees, pr-checks, checks and plugin tabs are out of scope; like the
   source, an unknown persisted value falls back to Explorer). */

/** Activity-bar tabs the right sidebar can show in this build. */
export type RightSidebarTab =
  | "explorer"
  | "mentu"
  | "source-control"
  | "ports"
  | "session";

export const RIGHT_SIDEBAR_TAB_STORAGE_KEY = "drogon:right-sidebar:tab";

/**
 * Default panel the fork shows whenever the right sidebar is open: the
 * sidebar never renders a blank panel.
 */
export const DEFAULT_RIGHT_SIDEBAR_TAB: RightSidebarTab = "explorer";

/** Nullable read of the saved tab: null means nothing was saved yet. */
export function loadRightSidebarTab(
  storage: Pick<Storage, "getItem">,
): RightSidebarTab | null {
  try {
    const raw = storage.getItem(RIGHT_SIDEBAR_TAB_STORAGE_KEY);
    return raw === null ? null : normalizeRightSidebarTab(raw);
  } catch {
    return null;
  }
}

export function saveRightSidebarTab(
  storage: Pick<Storage, "setItem">,
  tab: RightSidebarTab,
): void {
  try {
    storage.setItem(RIGHT_SIDEBAR_TAB_STORAGE_KEY, tab);
  } catch {
    // No durability promise; in-memory state stays authoritative.
  }
}

/**
 * Initial tab: a stored tab wins; nothing stored (or anything unknown)
 * resolves to the default Explorer panel, so an opened sidebar never
 * renders blank. A fresh default counts as routed Explorer — the caller
 * must mount the panel without waiting for an explicit routing event.
 */
export function resolveInitialRightSidebarTab(
  storage: Pick<Storage, "getItem">,
): RightSidebarTab {
  return loadRightSidebarTab(storage) ?? DEFAULT_RIGHT_SIDEBAR_TAB;
}

/** Port of normalizeRightSidebarRoute: unknown persisted tabs reset to Explorer. */
export function normalizeRightSidebarTab(tab: unknown): RightSidebarTab {
  if (
    tab === "mentu" ||
    tab === "source-control" ||
    tab === "ports" ||
    tab === "session"
  )
    return tab;
  return "explorer";
}

/**
 * Port of resolveRightSidebarEffectiveTab (folder-workspace memory omitted:
 * no folder-only tabs exist in the MVP set). A stored tab that is not
 * currently visible (e.g. Source Control while git.v1 is withheld) renders
 * a visible fallback without overwriting the stored route.
 */
export function resolveRightSidebarEffectiveTab(
  normalized: RightSidebarTab,
  visibleIds: readonly RightSidebarTab[],
): RightSidebarTab {
  if (visibleIds.length === 0)
    throw new Error(
      "Right sidebar activity items must include at least one visible tab",
    );
  if (visibleIds.includes(normalized)) return normalized;
  return visibleIds[0];
}
