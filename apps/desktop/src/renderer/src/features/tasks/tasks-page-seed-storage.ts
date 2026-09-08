// MIT Copyright (c) 2026 Lovecast Inc.
// Persisted seed for the Tasks result cache (R16-BF): the module map in
// TasksPage keeps last rows across tab switches, but a renderer restart
// drops it and the next cold open replays the full `gh` round trip before
// any row paints. This layer persists the same per-request results in
// localStorage so a post-restart open paints last session's rows instantly
// and revalidates underneath — the fork's stale-while-revalidate across
// navigations, extended across restarts. The seed only ever skips the
// skeleton, never the fetch; a corrupt, foreign-shaped, or overgrown entry
// is ignored. Storage failures (private mode, quota) never throw.

import type { TasksPageCachedResult, TasksPageCacheKey } from "./TasksPage";

const STORAGE_KEY = "drogon:tasks-page-seeds:v1";
const MAX_ENTRIES = 64;
const MAX_WORK_ITEMS = 100;

type StoredSeed = {
  savedAt: number;
  result: TasksPageCachedResult;
};

function seedKeyString(key: TasksPageCacheKey): string {
  return [key.projectId ?? "", key.kind, key.state, key.query ?? "", String(key.page), key.source].join("|");
}

function isWorkItemLike(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.number === "number" && typeof item.title === "string";
}

function isCachedResultLike(value: unknown): value is TasksPageCachedResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    Array.isArray(result.workItems) &&
    result.workItems.every(isWorkItemLike) &&
    typeof result.hasNextPage === "boolean" &&
    typeof result.furthestPage === "number"
  );
}

function readAll(storage: Pick<Storage, "getItem">): Record<string, StoredSeed> {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      ([, seed]) =>
        typeof seed === "object" &&
        seed !== null &&
        typeof (seed as StoredSeed).savedAt === "number" &&
        isCachedResultLike((seed as StoredSeed).result),
    );
    return Object.fromEntries(entries) as Record<string, StoredSeed>;
  } catch {
    return {};
  }
}

/** Last session's rows for this request key, if any survived the restart. */
export function readTasksPageSeed(
  key: TasksPageCacheKey,
  storage: Pick<Storage, "getItem"> = localStorage,
): TasksPageCachedResult | undefined {
  return readAll(storage)[seedKeyString(key)]?.result;
}

/** Persists one successful result for the next restart's instant paint. */
export function writeTasksPageSeed(
  key: TasksPageCacheKey,
  result: TasksPageCachedResult,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = localStorage,
): void {
  try {
    const all = readAll(storage);
    all[seedKeyString(key)] = {
      savedAt: Date.now(),
      result: { ...result, workItems: result.workItems.slice(0, MAX_WORK_ITEMS) },
    };
    const ordered = Object.entries(all).sort(([, a], [, b]) => a.savedAt - b.savedAt);
    while (ordered.length > MAX_ENTRIES) ordered.shift();
    storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(ordered)));
  } catch {
    // A lost seed only costs the next cold open its instant paint.
  }
}

/** Test seam: drops every persisted seed. */
export function clearTasksPageSeedStorage(
  storage: Pick<Storage, "removeItem"> = localStorage,
): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear through.
  }
}
