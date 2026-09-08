// MIT Copyright (c) 2026 Lovecast Inc.
// Browser pane chrome ported from the Orca reference (read-only):
//   src/renderer/src/components/browser-pane/assemble-chrome/browser-page-toolbar.tsx
//   (toolbar composition: history + address slot + reload control + menu)
//   src/renderer/src/components/browser-pane/assemble-chrome/browser-navigation-control-row.tsx
//   src/renderer/src/components/browser-pane/assemble-chrome/browser-reload-control.tsx
//   src/renderer/src/components/browser-pane/assemble-chrome/BrowserAddressBar.tsx
//   src/renderer/src/components/browser-pane/assemble-chrome/BrowserToolbarMenu.tsx
//   src/renderer/src/components/browser-pane/assemble-chrome/BrowserFind.tsx
//   src/renderer/src/components/browser-pane/assemble-chrome/browser-page-context-menu.tsx
//   src/renderer/src/components/browser-pane/assemble-chrome/browser-page-chrome-banners.tsx
//   src/renderer/src/components/browser-pane/assemble-chrome/browser-page-viewport-overlays.tsx
//   src/renderer/src/components/browser-pane/assemble-chrome/browser-page-pane.tsx
//   (pane composition + Mod+L/Mod+R/Mod+F scope)
// Adapted: the guest is the existing main-process WebContentsView (never DOM),
// so chrome state comes from the browser bridge, not webview refs; the data
// layer below is Drogon's, the DOM/copy/keyboard/ARIA above is the source's.
// Not ported: profiles/user agents, egress indicator, import hint, mobile
// driver overlay, SSH routing, downloads/permissions notices, annotate,
// describe-page, stream-remote.
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type {
  BrowserStateEvent,
  BrowserTabState,
} from "../../../../shared/browser-contract";
import type { BrowserBridge } from "./browser-bridge";
import {
  readCaptureWindowOpen,
  writeCaptureWindowOpen,
} from "./browser-bridge";
import { windowShellOpenExternal } from "../landing/github-star";
import BrowserAddressBar from "./browser-address-bar";
import { BrowserNavigationControlRow } from "./browser-navigation-control-row";
import { BrowserReloadControl } from "./browser-reload-control";
import { BrowserToolbarMenu } from "./browser-toolbar-menu";
import BrowserFind from "./browser-find-bar";
import {
  BrowserPageContextMenu,
  type BrowserPageMenuState,
} from "./browser-page-context-menu";
import {
  BrowserChromeBanners,
  type BrowserChromeBanner,
} from "./browser-chrome-banners";
import {
  BrowserViewportOverlays,
  type BrowserViewportState,
} from "./browser-viewport-overlays";
import {
  browserReloadButtonLabel,
  resolveBrowserReloadButtonLabelKind,
  resolveBrowserReloadIntent,
  type BrowserReloadTrigger,
} from "./browser-reload-state";
import { matchBrowserPaneChord } from "./browser-pane-keyboard";
import {
  getBrowserDisplayTitle,
  getOpenableExternalUrl,
  hostOfUrl,
  isBlankBrowserUrl,
  toDisplayUrl,
} from "./browser-url-display";
import {
  readBrowserRecentUrls,
  recordBrowserRecentUrl,
  type BrowserRecentUrl,
} from "./browser-recent-urls";

function workspaceTabs(event: BrowserStateEvent, workspaceId: string): BrowserTabState[] {
  return event.tabs.filter((tab) => tab.workspaceId === workspaceId);
}

function tabLabel(tab: BrowserTabState): string {
  const title = getBrowserDisplayTitle(tab.title, tab.url);
  if (title !== "New Tab") return title;
  try {
    return new URL(tab.url).host || tab.url;
  } catch {
    return tab.url || "New Tab";
  }
}

function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" && navigator.userAgent.includes("Mac")
  );
}

function copyText(text: string): Promise<boolean> {
  try {
    const clipboard = navigator.clipboard;
    if (!clipboard) return Promise.resolve(false);
    return clipboard.writeText(text).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

/**
 * Browser pane: reference chrome (navigation row, address bar, reload
 * control, toolbar menu, banners, find bar, context menu, viewport
 * overlays) over the main-process guest view. The page itself renders in a
 * sandboxed WebContentsView positioned over the placeholder rect, never in
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
  const [dismissedBanner, setDismissedBanner] = useState<string | null>(null);
  const [capture, setCapture] = useState(() => readCaptureWindowOpen());
  const [recentUrls, setRecentUrls] = useState<BrowserRecentUrl[]>(() =>
    readBrowserRecentUrls(workspaceId),
  );
  const [findOpen, setFindOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<BrowserPageMenuState | null>(null);
  const [reloadMenuOpen, setReloadMenuOpen] = useState(false);
  const [zoomFlash, setZoomFlash] = useState<number | null>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const dismissSuggestionsRef = useRef<(() => void) | null>(null);
  const activeTabIdRef = useRef<string | null>(null);
  const workspaceRef = useRef(workspaceId);
  workspaceRef.current = workspaceId;
  const recordedRef = useRef(new Set<string>());
  const zoomFlashTimer = useRef<number | null>(null);

  const refreshRecents = useCallback(() => {
    setRecentUrls(readBrowserRecentUrls(workspaceRef.current));
  }, []);

  useEffect(() => {
    refreshRecents();
  }, [workspaceId, refreshRecents]);

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
    setAddress(toDisplayUrl(activeUrl));
  }, [activeKey, activeUrl]);

  // A new blank tab lands in the address bar with its text selected, like
  // the source: one-shot per tab, so revisiting never steals focus back.
  const lastFocusedBlank = useRef<string | null>(null);
  useEffect(() => {
    if (!active || !isBlankBrowserUrl(active.url)) return;
    if (lastFocusedBlank.current === active.tabId) return;
    lastFocusedBlank.current = active.tabId;
    const id = window.requestAnimationFrame(() => {
      addressInputRef.current?.focus();
      addressInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [active]);

  // Committed pages join the workspace recents the suggestions read.
  useEffect(() => {
    if (!active || active.loading || active.error) return;
    if (!/^https?:\/\//i.test(active.url)) return;
    const key = `${workspaceId}:${active.url}`;
    if (recordedRef.current.has(key)) return;
    recordedRef.current.add(key);
    recordBrowserRecentUrl({ workspaceId, url: active.url, title: active.title });
    refreshRecents();
  }, [active, workspaceId, refreshRecents]);

  // Guest context-menu requests land on the active tab's menu; a late event
  // for a closed or background tab is dropped by identity.
  useEffect(
    () =>
      bridge.onContextMenu((event) => {
        if (event.tabId !== activeTabIdRef.current) return;
        setContextMenu({
          x: event.x,
          y: event.y,
          linkUrl: event.linkUrl,
          pageUrl: event.pageUrl,
          selectionText: event.selectionText,
        });
      }),
    [bridge],
  );

  // Tab switches and unmount close the transient chrome.
  useEffect(() => {
    setFindOpen(false);
    setContextMenu(null);
    setReloadMenuOpen(false);
  }, [activeKey]);
  useEffect(
    () => () => {
      if (zoomFlashTimer.current !== null) window.clearTimeout(zoomFlashTimer.current);
    },
    [],
  );

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
    setDismissedBanner(null);
    dismissSuggestionsRef.current?.();
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

  const submitAddressBar = () => go(address);
  const navigateToUrl = (url: string) => {
    setAddress(toDisplayUrl(url));
    go(url);
  };
  const revertAddressBar = () => {
    setAddress(toDisplayUrl(active?.url ?? ""));
  };

  const runReloadTrigger = (trigger: BrowserReloadTrigger) => {
    if (!active) return;
    setReloadMenuOpen(false);
    const intent = resolveBrowserReloadIntent(trigger, {
      loading: active.loading,
      hasLoadError: active.error !== null,
    });
    if (intent === "stop") {
      void bridge.stop({ tabId: active.tabId }).catch(() => {});
      return;
    }
    if (intent === "retry-load") {
      const retryUrl = active.loadError?.url || active.url;
      if (!retryUrl || isBlankBrowserUrl(retryUrl)) return;
      // Why navigate and not reload: after an error the guest sits on its
      // own failure state, and reload() would only refresh that — a fresh
      // loadURL back to the attempted URL is the retry.
      go(retryUrl);
      return;
    }
    const action =
      intent === "hard-reload"
        ? bridge.hardReload({ tabId: active.tabId })
        : bridge.reload({ tabId: active.tabId });
    void action
      .then((result) => {
        if (!result.ok) setNotice(result.error.message);
      })
      .catch(() => setNotice("The page could not be reloaded."));
  };

  const flashZoom = (percent: number | undefined) => {
    if (percent === undefined) return;
    setZoomFlash(percent);
    if (zoomFlashTimer.current !== null) window.clearTimeout(zoomFlashTimer.current);
    zoomFlashTimer.current = window.setTimeout(() => setZoomFlash(null), 1200);
  };

  const zoomBy = (step: "in" | "out" | "reset") => {
    if (!active) return;
    const action =
      step === "in"
        ? bridge.zoomIn({ tabId: active.tabId })
        : step === "out"
          ? bridge.zoomOut({ tabId: active.tabId })
          : bridge.zoomReset({ tabId: active.tabId });
    void action
      .then((result) => {
        if (result.ok) flashZoom(result.result.zoomPercent);
        else setNotice(result.error.message);
      })
      .catch(() => setNotice("The page zoom could not be changed."));
  };

  const openExternalUrl = (url: string) => {
    const openable = getOpenableExternalUrl(url);
    if (!openable) {
      setNotice("Only https URLs can leave the app.");
      return;
    }
    const open = windowShellOpenExternal(window.drogon);
    if (!open) {
      setNotice("The system browser is not available.");
      return;
    }
    void Promise.resolve(open(openable)).catch(() =>
      setNotice("The system browser could not be opened."),
    );
  };

  const copyAddress = (text: string) => {
    void copyText(text).then((copied) => {
      if (!copied) setNotice("Copy failed: clipboard unavailable.");
    });
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

  // One chord runner shared by the pane keydown handler and the forwarded
  // guest chords (R12-E): focus the address bar, reload, open find.
  const runBrowserPaneChord = (chord: "focus-address-bar" | "reload" | "find") => {
    if (chord === "focus-address-bar") {
      dismissSuggestionsRef.current?.();
      addressInputRef.current?.focus();
      addressInputRef.current?.select();
    } else if (chord === "reload") {
      void runReloadTrigger("button");
    } else {
      setFindOpen(true);
    }
  };

  // Reference keyboard, scoped to the active browser tab: the pane container
  // owns Mod+L (address bar), Mod+R (reload) and Mod+F (find) exactly like
  // the terminal owns its chords — preventDefault plus stopPropagation so
  // the window-level registry (Mod+L toggles the right sidebar) never sees
  // them while the user is in the page chrome.
  const onPaneKeyDown = (event: React.KeyboardEvent) => {
    const chord = matchBrowserPaneChord(event, isMacPlatform());
    if (!chord || !active) return;
    event.preventDefault();
    event.stopPropagation();
    runBrowserPaneChord(chord);
  };

  // Additive (R12-E): the same chords arrive via IPC while the guest
  // (WebContentsView) has focus — main captures them from the guest's
  // before-input-event and forwards here; only the tab that owns the
  // focused guest acts, and only while it is still this pane's active tab.
  useEffect(() => {
    const dispose = bridge.onChord((event) => {
      if (!active || event.tabId !== active.tabId) return;
      runBrowserPaneChord(event.chord);
    });
    return dispose;
  });

  const reloadKind = resolveBrowserReloadButtonLabelKind({
    loading: active?.loading ?? false,
    hasLoadError: active !== null && active.error !== null,
  });
  const reloadLabel = browserReloadButtonLabel(reloadKind);
  const isMac = isMacPlatform();
  const reloadShortcut = isMac ? "⌘R" : "Ctrl+R";

  const externalUrl = active ? getOpenableExternalUrl(active.url) : null;
  const zoomPercent = active?.zoomPercent ?? 100;

  const banner = bannerFor({ active, notice, dismissedBanner });
  const viewport = viewportFor({ active, externalUrl });

  return (
    <div className="browser-pane" data-testid="browser-pane" onKeyDown={onPaneKeyDown}>
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
      <BrowserNavigationControlRow
        controls={{
          canGoBack: active?.canGoBack ?? false,
          canGoForward: active?.canGoForward ?? false,
          loading: active?.loading ?? false,
          goBack: () => {
            if (!active) return;
            void bridge
              .back({ tabId: active.tabId })
              .then((result) => {
                if (!result.ok) setNotice(result.error.message);
              })
              .catch(() => setNotice("The page could not go back."));
          },
          goForward: () => {
            if (!active) return;
            void bridge
              .forward({ tabId: active.tabId })
              .then((result) => {
                if (!result.ok) setNotice(result.error.message);
              })
              .catch(() => setNotice("The page could not go forward."));
          },
          reload: () => runReloadTrigger("button"),
          navigate: navigateToUrl,
        }}
        addressSlot={
          <BrowserAddressBar
            value={address}
            onChange={setAddress}
            onSubmit={submitAddressBar}
            onNavigate={navigateToUrl}
            inputRef={addressInputRef}
            dismissSuggestionsRef={dismissSuggestionsRef}
            recentUrls={recentUrls}
            editSessionTabId={active?.tabId ?? null}
            onRevert={revertAddressBar}
          />
        }
        reloadControl={
          <BrowserReloadControl
            menuOpen={reloadMenuOpen}
            onMenuOpenChange={setReloadMenuOpen}
            label={reloadLabel}
            loading={active?.loading ?? false}
            showShortcutHint={reloadKind === "reload"}
            reloadShortcut={reloadShortcut}
            hardReloadShortcut=""
            onPrimary={() => runReloadTrigger("button")}
            onReload={() => runReloadTrigger("reload")}
            onHardReload={() => runReloadTrigger("hard-reload")}
          />
        }
        reloadLabel={reloadLabel}
      >
        {zoomFlash !== null ? (
          <span
            role="status"
            aria-live="polite"
            className="shrink-0 rounded-md border border-border bg-popover/95 px-2 py-0.5 text-xs font-medium text-popover-foreground"
          >
            {zoomFlash}%
          </span>
        ) : null}
        <BrowserToolbarMenu
          pageUrl={active?.url ?? ""}
          externalUrl={externalUrl}
          zoomPercent={zoomPercent}
          onReload={() => runReloadTrigger("reload")}
          onZoomIn={() => zoomBy("in")}
          onZoomOut={() => zoomBy("out")}
          onZoomReset={() => zoomBy("reset")}
          onFind={() => setFindOpen(true)}
        />
      </BrowserNavigationControlRow>
      <BrowserChromeBanners
        banner={banner}
        onRetry={() => {
          if (!active) return;
          setDismissedBanner(null);
          runReloadTrigger("button");
        }}
        onCopyAddress={() => active && copyAddress(active.url)}
        onOpenExternal={() => active && openExternalUrl(active.url)}
        onDismiss={() => {
          if (notice) {
            setNotice("");
            return;
          }
          if (active?.error) setDismissedBanner(`${active.tabId}:${active.error}`);
        }}
      />
      {findOpen && active ? (
        <div className="flex shrink-0 justify-end border-b border-border/70 bg-background/95 px-3 py-1.5">
          <BrowserFind
            tabId={active.tabId}
            bridge={bridge}
            isOpen={findOpen}
            onClose={() => setFindOpen(false)}
            docked
          />
        </div>
      ) : null}
      <div
        ref={placeholderRef}
        className="browser-viewport"
        onContextMenu={(event) => {
          // DOM-area right-clicks (blank/error states where the guest is
          // hidden). Right-clicks on a live page arrive from the guest over
          // the bridge instead — the guest is native and owns its rect.
          if (!active) return;
          event.preventDefault();
          setContextMenu({
            x: event.clientX,
            y: event.clientY,
            linkUrl: "",
            pageUrl: active.url,
            selectionText: "",
          });
        }}
      >
        <BrowserViewportOverlays
          viewport={viewport}
          onRetry={() => {
            if (!active) return;
            setDismissedBanner(null);
            runReloadTrigger("button");
          }}
          onCopyAddress={() => active && copyAddress(active.url)}
          onOpenExternal={() => active && openExternalUrl(active.url)}
        />
      </div>
      <BrowserPageContextMenu
        menu={contextMenu}
        canGoBack={active?.canGoBack ?? false}
        canGoForward={active?.canGoForward ?? false}
        onClose={() => setContextMenu(null)}
        onBack={() => {
          if (!active) return;
          void bridge.back({ tabId: active.tabId }).catch(() => {});
        }}
        onForward={() => {
          if (!active) return;
          void bridge.forward({ tabId: active.tabId }).catch(() => {});
        }}
        onReload={() => runReloadTrigger("reload")}
        onOpenLinkInPane={(url) => {
          void bridge
            .createTab({ workspaceId, url })
            .then((result) => {
              if (!result.ok) setNotice(result.error.message);
            })
            .catch(() => setNotice("The link could not be opened."));
        }}
        onOpenExternal={openExternalUrl}
        onCopyText={copyAddress}
        onInspect={() => {
          if (!active) return;
          void bridge
            .openDevTools({ tabId: active.tabId })
            .then((result) => {
              if (!result.ok) setNotice(result.error.message);
            })
            .catch(() => setNotice("Devtools could not be opened."));
        }}
      />
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

export function bannerFor(input: {
  active: BrowserTabState | null;
  notice: string;
  dismissedBanner: string | null;
}): BrowserChromeBanner | null {
  const { active, notice, dismissedBanner } = input;
  if (notice) return { kind: "notice", text: notice };
  if (!active || !active.error) return null;
  if (dismissedBanner === `${active.tabId}:${active.error}`) return null;
  // Blocked navigations read as policy, never as a broken page.
  if (active.error.startsWith("Blocked")) {
    return { kind: "blocked", reason: active.error };
  }
  const host = hostOfUrl(active.loadError?.url || active.url);
  return {
    kind: "failed",
    title: host ? `Can't reach ${host}` : "Can't load this page",
    description: active.loadError?.description || active.error,
    canOpenExternal: getOpenableExternalUrl(active.loadError?.url || active.url) !== null,
  };
}

export function viewportFor(input: {
  active: BrowserTabState | null;
  externalUrl: string | null;
}): BrowserViewportState {
  const { active, externalUrl } = input;
  if (!active) return { kind: "blank" };
  // Why error first: a failed load must read as failed even if the URL the
  // host reports is still blank — "New Tab" would hide the failure.
  if (active.error) {
    const host = hostOfUrl(active.loadError?.url || active.url);
    return {
      kind: "failed",
      title: active.error.startsWith("Blocked")
        ? "Blocked navigation"
        : host
          ? `Can't reach ${host}`
          : "Can't load this page",
      description: active.error,
      canOpenExternal: externalUrl !== null,
    };
  }
  if (isBlankBrowserUrl(active.url)) return { kind: "blank" };
  // Committed pages stay visible under the guest while reloading (old
  // content, standard behavior); only a never-committed load shows progress.
  if (active.loading && !(active.committed ?? false)) {
    return { kind: "loading", url: active.url };
  }
  return { kind: "page" };
}
