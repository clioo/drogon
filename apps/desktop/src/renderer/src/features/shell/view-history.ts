/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/store/slices/worktree-nav-history.ts (adapter: plain
   value + pure helpers instead of the zustand slice; entries are this
   repo's {route, workspaceId} pairs instead of worktree ids + page
   sentinels; the shell owns the state and applies entries itself).
   Back/forward span the workspace/view history. Like the source, the
   history is a linear list with an index, consecutive duplicates
   coalesce, pushing drops the forward branch, and canGo/go skip entries
   whose workspace no longer exists instead of landing on them. */

export type ViewEntry = {
  route: string | null;
  workspaceId: string;
};

export type ViewHistory = {
  /** Oldest -> newest; index points at the active entry (-1 when empty). */
  entries: ViewEntry[];
  index: number;
};

/** Live workspace ids for the liveness check; null/omitted means all live. */
export type LiveViewScope = ReadonlySet<string> | null | undefined;

// Why: bound per-session history growth; 50 keeps the back/forward scans
// cheap yet is never hit in normal use.
const MAX_VIEW_HISTORY = 50;

function sameEntry(a: ViewEntry, b: ViewEntry): boolean {
  return a.route === b.route && a.workspaceId === b.workspaceId;
}

/** Entries with no workspace (landing) are live; the rest need a workspace. */
function isLiveEntry(entry: ViewEntry, scope: LiveViewScope): boolean {
  if (scope === null || scope === undefined) return true;
  return entry.workspaceId === "" || scope.has(entry.workspaceId);
}

export function initialViewHistory(entry: ViewEntry): ViewHistory {
  return { entries: [entry], index: 0 };
}

/** Pushes a new entry; consecutive duplicates are coalesced, forward is dropped. */
export function pushView(history: ViewHistory, entry: ViewEntry): ViewHistory {
  const current = history.entries[history.index];
  if (current !== undefined && sameEntry(current, entry)) return history;
  const truncated = history.entries.slice(0, history.index + 1);
  truncated.push(entry);
  let index = history.index + 1;
  if (truncated.length > MAX_VIEW_HISTORY) {
    const evict = truncated.length - MAX_VIEW_HISTORY;
    truncated.splice(0, evict);
    index = Math.max(0, index - evict);
  }
  return { entries: truncated, index };
}

function findPrevLiveIndex(
  history: ViewHistory,
  scope: LiveViewScope,
): number | null {
  for (let i = history.index - 1; i >= 0; i--) {
    if (isLiveEntry(history.entries[i], scope)) return i;
  }
  return null;
}

function findNextLiveIndex(
  history: ViewHistory,
  scope: LiveViewScope,
): number | null {
  for (let i = history.index + 1; i < history.entries.length; i++) {
    if (isLiveEntry(history.entries[i], scope)) return i;
  }
  return null;
}

export function canGoBackView(
  history: ViewHistory,
  scope?: LiveViewScope,
): boolean {
  return findPrevLiveIndex(history, scope) !== null;
}

export function canGoForwardView(
  history: ViewHistory,
  scope?: LiveViewScope,
): boolean {
  return findNextLiveIndex(history, scope) !== null;
}

export function goBackView(
  history: ViewHistory,
  scope?: LiveViewScope,
): ViewHistory {
  const target = findPrevLiveIndex(history, scope);
  if (target === null) return history;
  return { entries: history.entries, index: target };
}

export function goForwardView(
  history: ViewHistory,
  scope?: LiveViewScope,
): ViewHistory {
  const target = findNextLiveIndex(history, scope);
  if (target === null) return history;
  return { entries: history.entries, index: target };
}

/** The active entry (present) for applying to the shell. */
export function currentView(history: ViewHistory): ViewEntry {
  return history.entries[history.index];
}
