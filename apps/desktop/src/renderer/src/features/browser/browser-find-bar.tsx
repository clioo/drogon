// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/browser-pane/assemble-chrome/BrowserFind.tsx
// Adapted: the guest is a main-process WebContentsView, so find runs over
// the browser bridge (findInPage/stopFind/onFindResult) instead of a
// webview ref. Session-flag semantics are unchanged: the first request for
// a query starts a new session (findNext: true) and follow-ups advance it
// (findNext: false), because the guest treats findNext as "start over".
// Chrome (DOM, classes, copy, keyboard, ARIA) is literal.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { getFindRequestQuery } from "../terminal/find-query-bounds";
import type { BrowserBridge } from "./browser-bridge";
import { nextFindRequest } from "./browser-find-state";

export { nextFindRequest };

type BrowserFindProps = {
  tabId: string;
  bridge: Pick<BrowserBridge, "findInPage" | "stopFind" | "onFindResult">;
  isOpen: boolean;
  onClose: () => void;
  /**
   * Docked in the pane chrome (in-flow, right-aligned) instead of floating
   * over the viewport: the guest is a native view that paints over viewport
   * DOM, so a floating bar would hide under the page it searches.
   */
  docked?: boolean;
};

export default function BrowserFind({
  tabId,
  bridge,
  isOpen,
  onClose,
  docked = false,
}: BrowserFindProps): React.JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(isOpen);
  const activeFindQueryRef = useRef<string | null>(null);
  const tabRef = useRef(tabId);
  tabRef.current = tabId;
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const requestQuery = getFindRequestQuery(query);

  const safeFindInPage = useCallback(
    (text: string, opts?: { forward?: boolean; findNext?: boolean }): void => {
      if (!text) {
        return;
      }
      // Why: the tab can close mid-find; best-effort beats crashing.
      void bridge
        .findInPage({ tabId: tabRef.current, query: text, ...opts })
        .catch(() => {});
    },
    [bridge],
  );

  const safeStopFindInPage = useCallback((): void => {
    void bridge.stopFind({ tabId: tabRef.current }).catch(() => {});
  }, [bridge]);

  // Why: the guest's findNext means "start a NEW session" — follow-up requests that
  // advance the selection must pass false, or every Enter restarts at the first match.
  const findNext = useCallback(() => {
    const request = nextFindRequest({
      requestQuery,
      activeQuery: activeFindQueryRef.current,
      direction: "next",
    });
    if (!request) return;
    safeFindInPage(request.query, { forward: request.forward, findNext: request.findNext });
    activeFindQueryRef.current = request.query;
  }, [requestQuery, safeFindInPage]);

  const findPrevious = useCallback(() => {
    const request = nextFindRequest({
      requestQuery,
      activeQuery: activeFindQueryRef.current,
      direction: "previous",
    });
    if (!request) return;
    safeFindInPage(request.query, { forward: request.forward, findNext: request.findNext });
    activeFindQueryRef.current = request.query;
  }, [requestQuery, safeFindInPage]);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      safeStopFindInPage();
    }
  }, [isOpen, safeStopFindInPage]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = isOpen;
    if (!isOpen) {
      activeFindQueryRef.current = null;
      return;
    }
    if (!requestQuery) {
      activeFindQueryRef.current = null;
      safeStopFindInPage();
      return;
    }

    // A reopen or a changed query starts a fresh session, so findNext must be true here.
    const runFind = (): void => {
      const request = nextFindRequest({
        requestQuery,
        activeQuery: activeFindQueryRef.current,
        direction: "start",
      });
      if (!request) return;
      safeFindInPage(request.query, { forward: request.forward, findNext: request.findNext });
      activeFindQueryRef.current = request.query;
    };
    if (!wasOpen) {
      runFind();
      return;
    }
    // Why: findInPage re-highlights the active match on every call, which can
    // flash while typing. Debounce typing changes, while reopen and Enter
    // navigation still use the live query immediately.
    const id = window.setTimeout(runFind, 200);
    return () => window.clearTimeout(id);
  }, [isOpen, requestQuery, safeFindInPage, safeStopFindInPage]);

  // Why the tab id is a dependency: the effect closes over the current tab,
  // so a tab switch while the bar stays open rebinds the listener instead of
  // counting another tab's matches into this bar.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    return bridge.onFindResult((event) => {
      if (event.tabId !== tabRef.current) {
        return;
      }
      setActiveMatch(event.activeMatchOrdinal);
      setTotalMatches(event.matches);
    });
  }, [bridge, isOpen, tabId]);

  if ((!isOpen || !requestQuery) && (activeMatch !== 0 || totalMatches !== 0)) {
    setActiveMatch(0);
    setTotalMatches(0);
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();

      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" && e.shiftKey) {
        findPrevious();
      } else if (e.key === "Enter") {
        findNext();
      }
    },
    [onClose, findNext, findPrevious],
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={
        docked
          ? "flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/95 px-2 py-1 shadow-lg backdrop-blur-sm"
          : "absolute top-2 right-2 z-50 flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/95 px-2 py-1 shadow-lg backdrop-blur-sm"
      }
      style={{ width: 300 }}
      onKeyDown={handleKeyDown}
      role="search"
      aria-label="Find in page"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find in page..."
        aria-label="Find in page"
        className="min-w-0 flex-1 border-none bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
      />

      {query ? (
        <span className="shrink-0 text-xs text-zinc-400">
          {totalMatches > 0 ? `${activeMatch} of ${totalMatches}` : "No matches"}
        </span>
      ) : null}

      <div className="mx-0.5 h-4 w-px bg-zinc-700" />

      <button
        type="button"
        onClick={findPrevious}
        className="flex size-6 shrink-0 items-center justify-center rounded text-zinc-400 hover:text-zinc-200"
        title="Previous match"
        aria-label="Previous match"
      >
        <ChevronUp size={14} />
      </button>

      <button
        type="button"
        onClick={findNext}
        className="flex size-6 shrink-0 items-center justify-center rounded text-zinc-400 hover:text-zinc-200"
        title="Next match"
        aria-label="Next match"
      >
        <ChevronDown size={14} />
      </button>

      <div className="mx-0.5 h-4 w-px bg-zinc-700" />

      <button
        type="button"
        onClick={onClose}
        className="flex size-6 shrink-0 items-center justify-center rounded text-zinc-400 hover:text-zinc-200"
        title="Close"
        aria-label="Close find"
      >
        <X size={14} />
      </button>
    </div>
  );
}
