import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  Plus,
  RotateCw,
  Square,
  X,
} from "lucide-react";
import type {
  BrowserStateEvent,
  BrowserTabState,
} from "../../../../shared/browser-contract";
import type { BrowserBridge } from "./browser-bridge";
import {
  readCaptureWindowOpen,
  writeCaptureWindowOpen,
} from "./browser-bridge";

function workspaceTabs(event: BrowserStateEvent, workspaceId: string): BrowserTabState[] {
  return event.tabs.filter((tab) => tab.workspaceId === workspaceId);
}

function tabLabel(tab: BrowserTabState): string {
  if (tab.title) return tab.title;
  try {
    return new URL(tab.url).host || tab.url;
  } catch {
    return tab.url || "New tab";
  }
}

/**
 * Browser pane: address bar, back/forward/reload/stop, per-workspace tab
 * strip and a placeholder rect the main-process guest view is positioned
 * over. The page itself renders in a sandboxed WebContentsView, never in
 * this DOM — this component is chrome plus honest loading/error/blocked
 * states mirrored from host events.
 */
export function BrowserPanel({
  bridge,
  workspaceId,
  hideTabStrip,
  controlledTabId,
}: {
  bridge: BrowserBridge;
  workspaceId: string;
  /**
   * Tab-hosting mode: the tab strip owns tab selection and renders one
   * strip tab per page, so the pane hides its inner strip and follows
   * `controlledTabId` (undefined keeps the legacy self-managed strip).
   */
  hideTabStrip?: boolean;
  controlledTabId?: string | null;
}) {
  const [tabs, setTabs] = useState<BrowserTabState[]>([]);
  const [internalTabId, setInternalTabId] = useState<string | null>(null);
  const controlled = controlledTabId !== undefined;
  const [address, setAddress] = useState("");
  const [notice, setNotice] = useState("");
  const [capture, setCapture] = useState(() => readCaptureWindowOpen());
  const placeholderRef = useRef<HTMLDivElement>(null);
  const activeTabIdRef = useRef<string | null>(null);
  const workspaceRef = useRef(workspaceId);
  workspaceRef.current = workspaceId;

  useEffect(
    () =>
      bridge.onState((event) => {
        const scoped = workspaceTabs(event, workspaceRef.current);
        setTabs(scoped);
        if (controlled) return;
        // The host owns the active tab (new tabs, popups, closes): the
        // renderer follows its verdict so chrome and guest never disagree.
        // A click sets the tab locally first for instant feedback; the
        // host's own active-changed event then confirms the same id.
        setInternalTabId((current) => {
          if (
            event.activeTabId &&
            scoped.some((tab) => tab.tabId === event.activeTabId)
          )
            return event.activeTabId;
          if (current && scoped.some((tab) => tab.tabId === current))
            return current;
          return scoped.at(-1)?.tabId ?? null;
        });
      }),
    [bridge, controlled],
  );

  // Controlled mode follows the strip's selection; a selected id that left
  // the list (closed elsewhere, App reconciling) falls back to the last
  // page exactly like the self-managed path above.
  const activeTabId = controlled
    ? (tabs.some((tab) => tab.tabId === controlledTabId)
        ? controlledTabId
        : (tabs.at(-1)?.tabId ?? null))
    : internalTabId;
  const selectTab = (tabId: string) => {
    setInternalTabId(tabId);
  };

  activeTabIdRef.current = activeTabId;
  const active = tabs.find((tab) => tab.tabId === activeTabId) ?? null;

  // The address bar mirrors the active tab until the user types.
  const activeKey = active?.tabId ?? null;
  const activeUrl = active?.url ?? "";
  useEffect(() => {
    setAddress(activeUrl);
  }, [activeKey, activeUrl]);

  const reportBounds = useCallback(() => {
    const element = placeholderRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    void bridge
      .setBounds({
        ...(activeTabIdRef.current
          ? { tabId: activeTabIdRef.current }
          : {}),
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      })
      .catch(() => {
        // Bounds are best-effort layout hints; a failed report must never
        // surface as a navigation error.
      });
  }, [bridge]);

  useEffect(() => {
    const element = placeholderRef.current;
    if (!element) return;
    reportBounds();
    const observer = new ResizeObserver(reportBounds);
    observer.observe(element);
    window.addEventListener("resize", reportBounds);
    window.addEventListener("scroll", reportBounds, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reportBounds);
      window.removeEventListener("scroll", reportBounds, true);
    };
  }, [bridge, reportBounds, activeTabId]);

  // First visit to the panel opens a home tab so the strip is never empty.
  // Tab-hosting mode is exempt: the strip owns creation (its empty list is
  // a legitimate "no pages" state, and auto-creating here would duplicate
  // a strip-initiated tab that the host has not echoed yet).
  const tabsEmpty = tabs.length === 0;
  useEffect(() => {
    if (controlled) return;
    if (!tabsEmpty) return;
    let cancelled = false;
    void bridge
      .createTab({ workspaceId })
      .then((result) => {
        if (!cancelled && !result.ok) setNotice(result.error.message);
      })
      .catch(() => {
        if (!cancelled) setNotice("The browser is not ready yet.");
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, workspaceId, tabsEmpty, controlled]);

  const go = (value: string) => {
    const url = value.trim();
    if (!url) return;
    setNotice("");
    if (!active) {
      void bridge
        .createTab({ workspaceId, url })
        .then((result) => {
          if (!result.ok) setNotice(result.error.message);
        })
        .catch(() => setNotice("The navigation could not be delivered."));
      return;
    }
    void bridge
      .navigate({ tabId: active.tabId, url })
      .then((result) => {
        if (!result.ok && result.error.code !== "browser_blocked")
          setNotice(result.error.message);
      })
      .catch(() => setNotice("The navigation could not be delivered."));
  };

  const closeTab = (tabId: string) => {
    void bridge
      .closeTab({ tabId })
      .then((result) => {
        if (!result.ok) setNotice(result.error.message);
      })
      .catch(() => setNotice("The tab could not be closed."));
  };

  const newTab = () => {
    setNotice("");
    void bridge
      .createTab({ workspaceId })
      .then((result) => {
        if (!result.ok) setNotice(result.error.message);
      })
      .catch(() => setNotice("The tab could not be opened."));
  };

  const toggleCapture = () => {
    const next = !capture;
    setCapture(next);
    writeCaptureWindowOpen(next);
  };

  return (
    <div className="browser-pane" data-testid="browser-pane">
      {!hideTabStrip && (
      <div
        className="browser-tabstrip"
        role="tablist"
        aria-label="Browser tabs"
      >
        {tabs.map((tab) => (
          <div
            key={tab.tabId}
            className="browser-tab"
            role="tab"
            aria-selected={tab.tabId === activeTabId}
            data-current={tab.tabId === activeTabId}
          >
            <button
              className="browser-tab-label"
              title={tab.url}
              onClick={() => {
                selectTab(tab.tabId);
                void bridge
                  .setBounds({
                    tabId: tab.tabId,
                    bounds: placeholderRef.current?.getBoundingClientRect() ?? {
                      x: 0,
                      y: 0,
                      width: 0,
                      height: 0,
                    },
                  })
                  .catch(() => {});
              }}
            >
              {tab.loading ? <span className="browser-dot" /> : null}
              <span>{tabLabel(tab)}</span>
            </button>
            <button
              className="browser-icon-button"
              aria-label={`Close ${tabLabel(tab)}`}
              onClick={() => closeTab(tab.tabId)}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        <button
          className="browser-icon-button"
          aria-label="New tab"
          title="New tab"
          onClick={newTab}
        >
          <Plus size={14} />
        </button>
      </div>
      )}
      <form
        className="browser-bar"
        onSubmit={(event) => {
          event.preventDefault();
          go(address);
        }}
      >
        <button
          type="button"
          className="browser-icon-button"
          aria-label="Back"
          title="Back"
          disabled={!active?.canGoBack}
          onClick={() => active && void bridge.back({ tabId: active.tabId })}
        >
          <ArrowLeft size={15} />
        </button>
        <button
          type="button"
          className="browser-icon-button"
          aria-label="Forward"
          title="Forward"
          disabled={!active?.canGoForward}
          onClick={() => active && void bridge.forward({ tabId: active.tabId })}
        >
          <ArrowRight size={15} />
        </button>
        <button
          type="button"
          className="browser-icon-button"
          aria-label="Reload"
          title="Reload"
          disabled={!active}
          onClick={() => active && void bridge.reload({ tabId: active.tabId })}
        >
          <RotateCw size={14} />
        </button>
        <button
          type="button"
          className="browser-icon-button"
          aria-label="Stop"
          title="Stop"
          disabled={!active?.loading}
          onClick={() => active && void bridge.stop({ tabId: active.tabId })}
        >
          <Square size={13} />
        </button>
        <input
          className="browser-address"
          aria-label="Address"
          placeholder="Search or enter a URL"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
      </form>
      {notice && (
        <p className="browser-notice" role="status">
          {notice}
        </p>
      )}
      <div ref={placeholderRef} className="browser-viewport">
        {!active || active.error || active.url === "about:blank" ? (
          <div className="browser-status" role="status">
            {active?.loading ? (
              <>
                <Globe size={28} />
                <h1>Loading…</h1>
                <p>{active.url}</p>
              </>
            ) : active?.error ? (
              <>
                <Globe size={28} />
                <h1>
                  {active.error.startsWith("Blocked")
                    ? "Blocked navigation"
                    : "This page could not be shown"}
                </h1>
                <p>{active.error}</p>
                <button
                  type="button"
                  className="browser-retry"
                  onClick={() => active && void bridge.reload({ tabId: active.tabId })}
                >
                  Retry
                </button>
              </>
            ) : (
              <>
                <Globe size={28} />
                <h1>Browse inside Drogon</h1>
                <p>
                  Enter a URL above. Pages render sandboxed in this pane;
                  downloads and permissions are denied.
                </p>
              </>
            )}
          </div>
        ) : null}
      </div>
      <label className="browser-capture" title="Route terminal link-opens into this pane">
        <input
          type="checkbox"
          checked={capture}
          onChange={toggleCapture}
        />
        Capture links from terminals
      </label>
    </div>
  );
}
