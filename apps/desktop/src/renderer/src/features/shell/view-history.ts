/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/store/slices/worktree-nav-history.ts (adapter: plain
   value + pure helpers instead of the zustand slice; the shell owns the
   state). Back/forward span the workspace/view history. */

export type ViewEntry = {
  route: string | null;
  workspaceId: string;
};

export type ViewHistory = {
  past: ViewEntry[];
  present: ViewEntry;
  future: ViewEntry[];
};

function sameEntry(a: ViewEntry, b: ViewEntry): boolean {
  return a.route === b.route && a.workspaceId === b.workspaceId;
}

export function initialViewHistory(entry: ViewEntry): ViewHistory {
  return { past: [], present: entry, future: [] };
}

/** Pushes a new entry; consecutive duplicates are coalesced, forward is dropped. */
export function pushView(history: ViewHistory, entry: ViewEntry): ViewHistory {
  if (sameEntry(history.present, entry)) return history;
  return {
    past: [...history.past, history.present].slice(-50),
    present: entry,
    future: [],
  };
}

export function canGoBackView(history: ViewHistory): boolean {
  return history.past.length > 0;
}

export function canGoForwardView(history: ViewHistory): boolean {
  return history.future.length > 0;
}

export function goBackView(history: ViewHistory): ViewHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function goForwardView(history: ViewHistory): ViewHistory {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}
