// Pure per-tab navigation state for the browser host. The guest view is
// the truth for pixels; this is the truth for what the renderer displays
// (tab strip, address bar, loading/error/blocked states).

import type { BrowserTabState } from "../../shared/browser-contract";

export type BrowserTabPhase = "idle" | "loading" | "ready" | "error" | "blocked";

export type HostTabRecord = {
  tabId: string;
  workspaceId: string;
  url: string;
  title: string;
  phase: BrowserTabPhase;
  message: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  /** True once a page committed in this tab; fresh tabs show DOM states. */
  committed: boolean;
};

export type BrowserHostSnapshot = {
  tabs: HostTabRecord[];
  activeTabId: string | null;
};

export type HostAction =
  | { type: "tab-opened"; tabId: string; workspaceId: string; url: string }
  | { type: "tab-closed"; tabId: string }
  | { type: "active-changed"; tabId: string | null }
  | { type: "load-started"; tabId: string; url: string }
  | { type: "load-stopped"; tabId: string; url: string }
  | { type: "load-failed"; tabId: string; message: string }
  | { type: "load-blocked"; tabId: string; url: string; reason: string }
  | { type: "title-changed"; tabId: string; title: string }
  | { type: "history-changed"; tabId: string; canGoBack: boolean; canGoForward: boolean };

export function initialHostSnapshot(): BrowserHostSnapshot {
  return { tabs: [], activeTabId: null };
}

function toPublic(tab: HostTabRecord): BrowserTabState {
  return {
    tabId: tab.tabId,
    workspaceId: tab.workspaceId,
    url: tab.url,
    title: tab.title,
    loading: tab.phase === "loading",
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
    error:
      tab.phase === "error" || tab.phase === "blocked" ? tab.message : null,
  };
}

export function publicTabStates(snapshot: BrowserHostSnapshot): BrowserTabState[] {
  return snapshot.tabs.map(toPublic);
}

/**
 * Applies one host event. Unknown tab ids are ignored (late guest events
 * after close must never resurrect a tab); the result is a new snapshot.
 */
export function applyHostAction(
  snapshot: BrowserHostSnapshot,
  action: HostAction,
): BrowserHostSnapshot {
  switch (action.type) {
    case "tab-opened": {
      if (snapshot.tabs.some((tab) => tab.tabId === action.tabId))
        return snapshot;
      const tab: HostTabRecord = {
        tabId: action.tabId,
        workspaceId: action.workspaceId,
        url: action.url,
        title: "",
        phase: "loading",
        message: null,
        canGoBack: false,
        canGoForward: false,
        committed: false,
      };
      return {
        tabs: [...snapshot.tabs, tab],
        activeTabId: action.tabId,
      };
    }
    case "tab-closed": {
      const tabs = snapshot.tabs.filter((tab) => tab.tabId !== action.tabId);
      if (tabs.length === snapshot.tabs.length) return snapshot;
      const activeTabId =
        snapshot.activeTabId === action.tabId
          ? (tabs.at(-1)?.tabId ?? null)
          : snapshot.activeTabId;
      return { tabs, activeTabId };
    }
    case "active-changed": {
      if (action.tabId !== null && !snapshot.tabs.some((tab) => tab.tabId === action.tabId))
        return snapshot;
      return { ...snapshot, activeTabId: action.tabId };
    }
    case "load-started":
    case "load-stopped":
    case "load-failed":
    case "load-blocked":
    case "title-changed":
    case "history-changed": {
      const index = snapshot.tabs.findIndex((tab) => tab.tabId === action.tabId);
      if (index < 0) return snapshot;
      const current = snapshot.tabs[index];
      let next = current;
      switch (action.type) {
        case "load-started":
          next = { ...current, phase: "loading", url: action.url, message: null };
          break;
        case "load-stopped":
          // A stop/finish for a tab stuck in blocked/error keeps the honest
          // state instead of flipping to ready with no commit.
          next =
            current.phase === "loading"
              ? {
                  ...current,
                  phase: "ready",
                  url: action.url,
                  message: null,
                  committed: true,
                }
              : current;
          break;
        case "load-failed":
          next = { ...current, phase: "error", message: action.message };
          break;
        case "load-blocked":
          next = {
            ...current,
            phase: "blocked",
            url: action.url,
            message: action.reason,
          };
          break;
        case "title-changed":
          next = { ...current, title: action.title.slice(0, 256) };
          break;
        case "history-changed":
          next = {
            ...current,
            canGoBack: action.canGoBack,
            canGoForward: action.canGoForward,
          };
          break;
      }
      if (next === current) return snapshot;
      const tabs = [...snapshot.tabs];
      tabs[index] = next;
      return { ...snapshot, tabs };
    }
  }
}
