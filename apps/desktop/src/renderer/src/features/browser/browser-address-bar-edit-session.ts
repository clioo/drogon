// MIT Copyright (c) 2026 Lovecast Inc.
// Ported verbatim from the Orca reference (read-only):
//   src/renderer/src/components/browser-pane/assemble-chrome/browser-address-bar-edit-session.ts
// No adaptation: the pane remounts the address bar per tab, so the tab id is
// the identity that survives the swap, exactly like the source's page id.

/** Where the caret sits in the address bar, in the shape `setSelectionRange` wants it back. */
export type BrowserAddressBarSelection = {
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
};

/** A highlighted suggestion standing in the input in place of what the user typed. */
export type BrowserAddressBarPreview = {
  /** The typed query the input showed before the preview replaced it; what Escape goes back to. */
  typedQuery: string;
  /** The suggestion URL currently filling the input. */
  previewedUrl: string;
};

/** An address-bar edit that was in progress when the chrome around it was torn down. */
export type BrowserAddressBarEditSession = {
  draft: string;
  selection: BrowserAddressBarSelection;
  suggestionsOpen: boolean;
  /** Set only while a suggestion is being previewed, so the typed query is not lost with it. */
  preview: BrowserAddressBarPreview | null;
};

// Why this exists outside React: switching the active tab swaps the address
// bar under a live edit, so the whole bar unmounts mid-typing. The tab id is
// the one identity that survives that swap, so it keys what the remounting
// bar picks back up.
const editSessionsByTabId = new Map<string, BrowserAddressBarEditSession>();

export function saveBrowserAddressBarEditSession(
  tabId: string,
  session: BrowserAddressBarEditSession,
): void {
  editSessionsByTabId.set(tabId, session);
  // Why a microtask rather than a timeout: React deletes the old pane and inserts the new one in
  // one synchronous commit, and the resuming layout effect runs before the stack unwinds — so a
  // swap always beats this. Anything arriving later is a different mount, such as a tab revisited
  // or a worktree switched back to, where seizing focus would be the bug rather than the fix.
  queueMicrotask(() => {
    if (editSessionsByTabId.get(tabId) === session) {
      editSessionsByTabId.delete(tabId);
    }
  });
}

export function consumeBrowserAddressBarEditSession(
  tabId: string,
): BrowserAddressBarEditSession | null {
  const session = editSessionsByTabId.get(tabId) ?? null;
  editSessionsByTabId.delete(tabId);
  return session;
}

/**
 * Drop a tab's parked edit. The microtask above already bounds every write to the commit that
 * made it, so this is hygiene rather than correctness: it keeps a closing tab from leaving an
 * entry behind for the rest of the tick.
 */
export function clearBrowserAddressBarEditSession(tabId: string): void {
  editSessionsByTabId.delete(tabId);
}
