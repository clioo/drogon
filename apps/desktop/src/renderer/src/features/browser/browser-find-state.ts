// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/browser-pane/assemble-chrome/BrowserFind.tsx
//   (find-session step: first request per query starts a new guest session,
//   follow-ups advance it)
// Adapted: pure state only — the bar component owns the bridge. Session-flag
// semantics are unchanged: the first request for a query starts a new
// session (findNext: true) and follow-ups advance it (findNext: false),
// because the guest treats findNext as "start over".

export type BrowserFindRequestDirection = "next" | "previous" | "start";

/**
 * Pure find-session step, exported for tests: the first request for a query
 * starts a new guest session (findNext: true); follow-ups in either
 * direction advance it (findNext: false). Null when there is no live query
 * or the debounced repeat already ran for it.
 */
export function nextFindRequest(input: {
  requestQuery: string | null;
  activeQuery: string | null;
  direction: BrowserFindRequestDirection;
}): { query: string; forward: boolean; findNext: boolean } | null {
  const { requestQuery, activeQuery, direction } = input;
  if (!requestQuery) return null;
  if (direction === "start" && activeQuery === requestQuery) return null;
  return {
    query: requestQuery,
    forward: direction !== "previous",
    findNext: activeQuery !== requestQuery,
  };
}
