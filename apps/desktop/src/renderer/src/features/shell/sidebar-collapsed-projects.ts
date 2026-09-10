/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's collapsed-group
   store slice (src/renderer/src/store/slices/ui/ui-slice-preference-actions.ts,
   `collapsedWorktreeGroups`) as a localStorage adapter over project ids —
   the same persistence pattern this repo's sidebar-order.ts uses. Which
   project sections the user folded survives a reload. */

const STORAGE_KEY = "drogon:shell:collapsed-projects";

export function loadCollapsedProjectIds(
  storage: Pick<Storage, "getItem">,
): string[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export function saveCollapsedProjectIds(
  storage: Pick<Storage, "setItem">,
  ids: readonly string[],
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage may be unavailable (quota, privacy mode); collapse state is
    // cosmetic, so a failed write just means it resets on reload.
  }
}
