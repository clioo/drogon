import type { Workspace } from "../../shared/session-contract";

const STORAGE_KEY = "drogon:selected-workspace";

export type SavedWorkspaceSelection = { workspaceId: string; hostId: string };

export type WorkspaceSelectionResolution =
  | { changed: false }
  | { changed: true; selected: string };

/**
 * Clicking the already-selected workspace is a no-op signal — callers must
 * not clear the visible session projection (active tab/sessions) for a
 * workspace that was already current.
 */
export function resolveWorkspaceSelection(
  current: string,
  target: string,
): WorkspaceSelectionResolution {
  if (current === target) return { changed: false };
  return { changed: true, selected: target };
}

/**
 * Reads the last confirmed workspace selection. Anything that is not
 * exactly `{ workspaceId: string; hostId: string }` is treated as absent
 * rather than trusted, since this is only view-restoration state.
 */
export function loadSavedSelection(
  storage: Pick<Storage, "getItem"> = localStorage,
): SavedWorkspaceSelection | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as SavedWorkspaceSelection).workspaceId !== "string" ||
      typeof (parsed as SavedWorkspaceSelection).hostId !== "string"
    )
      return null;
    const { workspaceId, hostId } = parsed as SavedWorkspaceSelection;
    return { workspaceId, hostId };
  } catch {
    return null;
  }
}

/** Best-effort persistence; a private-mode/quota write failure must not block selection. */
export function saveSavedSelection(
  selection: SavedWorkspaceSelection,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Best-effort view state; ignored.
  }
}

/**
 * Restoration prefers the saved workspace (scoped by both id and host, so a
 * reused id on a different host is never trusted) over the first-workspace
 * default. A saved selection that is missing/unavailable falls back
 * explicitly to the first workspace, never throwing or leaving a stale id.
 */
export function resolveRestoredSelection(
  workspaces: Workspace[],
  saved: SavedWorkspaceSelection | null,
): string {
  if (
    saved &&
    workspaces.some(
      (item) => item.id === saved.workspaceId && item.hostId === saved.hostId,
    )
  )
    return saved.workspaceId;
  return workspaces[0]?.id ?? "";
}
