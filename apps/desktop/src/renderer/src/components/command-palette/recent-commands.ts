import { settingsStorageKey, type StorageLike } from "../../settings-store";

/** Most-recent-first command ids, persisted under the palette namespace. */
export const MAX_RECENT_COMMANDS = 8;

function recentKey(): string {
  return settingsStorageKey("palette");
}

function parseRecentIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return [];
    const ids = (parsed as { settings?: unknown }).settings;
    const list =
      typeof ids === "object" && ids !== null && !Array.isArray(ids)
        ? (ids as Record<string, unknown>).recentCommandIds
        : ids;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0,
    );
  } catch {
    return [];
  }
}

export function loadRecentCommands(storage: StorageLike): string[] {
  try {
    return parseRecentIds(storage.getItem(recentKey())).slice(
      0,
      MAX_RECENT_COMMANDS,
    );
  } catch {
    return [];
  }
}

export function recordRecentCommand(
  storage: StorageLike,
  commandId: string,
): string[] {
  const next = [
    commandId,
    ...loadRecentCommands(storage).filter((id) => id !== commandId),
  ].slice(0, MAX_RECENT_COMMANDS);
  try {
    storage.setItem(
      recentKey(),
      JSON.stringify({ settings: { recentCommandIds: next } }),
    );
  } catch {
    // Storage unavailable: the in-memory order is still returned.
  }
  return next;
}
