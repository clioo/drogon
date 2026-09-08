// Electron host for the embedded browser pane. Main owns one
// WebContentsView per tab, attached to the main window's contentView and
// positioned over the renderer's Browser panel placeholder rect.
//
// Trust boundary: guest pages never get node integration, a preload or
// IPC; sandbox is on; permission requests are denied; downloads are
// blocked; popups are denied and routed into a new pane tab instead.

import type { WebContentsView } from "electron";
import {
  MAX_BROWSER_FILL_TEXT_CHARS,
  MAX_BROWSER_SELECTOR_CHARS,
  MAX_BROWSER_SNAPSHOT_CHARS,
  MAX_BROWSER_TABS,
  browserIpcChannels,
  type BrowserBounds,
  type BrowserSnapshot,
  type BrowserTabState,
} from "../../shared/browser-contract";
import { resolveViewBounds } from "./browser-bounds";
import { mapGuestLoadError } from "./browser-errors";
import { installGuestBrowserChordForwarding } from "./browser-guest-chord-forwarding";
import {
  applyHostAction,
  initialHostSnapshot,
  publicTabStates,
  type BrowserHostSnapshot,
} from "./browser-state";
import { normalizeBrowserUrl } from "./browser-url";

/**
 * The exact guest preferences every tab is created with. There is
 * deliberately NO preload key at all (Electron rejects even an empty
 * preload path, and the guest must have no preload, IPC or node).
 */
export const GUEST_WEB_PREFERENCES = {
  nodeIntegration: false,
  sandbox: true,
  contextIsolation: true,
  webSecurity: true,
} as const;

const HOME_URL = "about:blank";
let tabSequence = 0;
export function nextTabId(): string {
  tabSequence += 1;
  return `browser-tab-${tabSequence}`;
}

export type GuestSessionLike = {
  setPermissionRequestHandler(
    handler: (webContents: unknown, permission: string, callback: (allow: boolean) => void) => void,
  ): void;
  setPermissionCheckHandler(handler: () => boolean): void;
  on(event: "will-download", listener: (event: { preventDefault(): void }) => void): void;
};

export type GuestContentsLike = {
  loadURL(url: string): Promise<void> | void;
  stop(): void;
  goBack(): void;
  goForward(): void;
  reload(): void;
  /** Additive (R11-B chrome): cache-bypassing reload for the menu entry. */
  reloadIgnoringCache(): void;
  getURL(): string;
  getTitle(): string;
  executeJavaScript(code: string): Promise<unknown>;
  navigationHistory: {
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
  };
  session: GuestSessionLike;
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: "deny" },
  ): void;
  on(event: string, listener: (...args: never[]) => void): void;
  // Additive (R11-B chrome): zoom/find/devtools/context-menu surface used by
  // the pane chrome. Real WebContents provides all of these.
  getZoomLevel(): number;
  setZoomLevel(level: number): void;
  findInPage(
    text: string,
    options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean },
  ): number;
  stopFindInPage(action: "clearSelection" | "keepSelection" | "activateSelection"): void;
  openDevTools(options?: { mode?: string }): void;
};

export type GuestViewLike = {
  webContents: GuestContentsLike;
  setBounds(bounds: BrowserBounds): void;
  setVisible(visible: boolean): void;
};

export type BrowserParentWindowLike = {
  contentView: {
    addChildView(view: GuestViewLike | WebContentsView): void;
    removeChildView(view: GuestViewLike | WebContentsView): void;
  };
  webContents: { send(channel: string, payload: unknown): void };
  getContentBounds(): { width: number; height: number };
  on(event: "resize", listener: () => void): void;
};

export type BrowserHostEvents = {
  onPopupRouted?: (tab: BrowserTabState) => void;
};

/** Subset of Electron's `context-menu` params the pane menu needs. */
export type GuestContextMenuParams = {
  x: number;
  y: number;
  linkURL: string;
  pageURL: string;
  selectionText?: string;
};

/** Subset of Electron's `found-in-page` result the find bar needs. */
export type GuestFoundInPageResult = {
  requestId: number;
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
};

/** Chromium zoom: level 0 is 100%, each level multiplies by 1.2. */
export function zoomPercentForLevel(level: number): number {
  return Math.round(100 * 1.2 ** level);
}

const MIN_ZOOM_LEVEL = -7;
const MAX_ZOOM_LEVEL = 8;

/**
 * Creates one guest view with the locked-down preferences. Exported so
 * tests can prove the sandbox posture without a running Electron.
 */
export function lockDownGuestSession(session: GuestSessionLike): void {
  session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  session.setPermissionCheckHandler(() => false);
  session.on("will-download", (event) => event.preventDefault());
}

/**
 * Guest script for `click`: resolves one CSS selector and clicks it. The
 * selector is embedded with `JSON.stringify`, so it is always a string
 * literal — never code. Results never echo guest data back: only fixed
 * `ok`/`error` literals cross the boundary.
 */
export function buildClickScript(selector: string): string {
  return `(function(){var el;try{el=document.querySelector(${JSON.stringify(selector)});}catch(err){return{ok:false,error:"invalid selector"};}if(!el){return{ok:false,error:"no element matches selector"};}try{el.click();}catch(err){return{ok:false,error:"click failed"};}return{ok:true};})()`;
}

/**
 * Guest script for `fill`: resolves one CSS selector and sets its value,
 * firing the `input`/`change` events a real keystroke would. Same
 * selector-only embedding and no-echo rule as {@link buildClickScript}.
 */
export function buildFillScript(selector: string, text: string): string {
  return `(function(){var el;try{el=document.querySelector(${JSON.stringify(selector)});}catch(err){return{ok:false,error:"invalid selector"};}if(!el){return{ok:false,error:"no element matches selector"};}var value=${JSON.stringify(text)};try{if(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement){el.focus();el.value=value;el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));}else if(el.isContentEditable){el.focus();el.textContent=value;el.dispatchEvent(new Event("input",{bubbles:true}));}else{return{ok:false,error:"element is not fillable"};}}catch(err){return{ok:false,error:"fill failed"};}return{ok:true};})()`;
}

type GuestVerdict = { ok?: unknown; error?: unknown };

type PendingNavigation = { url: string };

function verdictError(verdict: unknown): string | null {
  if (
    verdict &&
    typeof verdict === "object" &&
    (verdict as GuestVerdict).ok === true
  )
    return null;
  const detail = (verdict as GuestVerdict | null)?.error;
  return typeof detail === "string" && detail
    ? detail.slice(0, 256)
    : "The page did not confirm the interaction.";
}

export type HostBlocked = { blocked: string; code?: string };

export class BrowserHost {
  private state: BrowserHostSnapshot = initialHostSnapshot();
  private views = new Map<string, GuestViewLike | WebContentsView>();
  private chordDisposers = new Map<string, () => void>();
  /** Main-frame target until commit/failure; getURL() is only last-commit truth. */
  private pendingNavigations = new Map<string, PendingNavigation>();
  private committedUrls = new Map<string, string>();
  private lastRect: BrowserBounds | null = null;

  constructor(
    private readonly getWindow: () => BrowserParentWindowLike | null,
    private readonly createView: (
      options: { webPreferences: typeof GUEST_WEB_PREFERENCES },
    ) => GuestViewLike | WebContentsView,
    private readonly events: BrowserHostEvents = {},
  ) {}

  list(): { tabs: BrowserTabState[]; activeTabId: string | null } {
    return {
      tabs: publicTabStates(this.state),
      activeTabId: this.state.activeTabId,
    };
  }

  private viewFor(tabId: string): GuestViewLike | WebContentsView | null {
    return this.views.get(tabId) ?? null;
  }

  private contentsOf(tabId: string): GuestContentsLike | null {
    const view = this.viewFor(tabId);
    return (view?.webContents as GuestContentsLike | undefined) ?? null;
  }

  private update(action: Parameters<typeof applyHostAction>[1]): void {
    this.state = applyHostAction(this.state, action);
    this.emit();
    this.applyVisibility();
  }

  private emit(): void {
    this.getWindow()?.webContents.send(browserIpcChannels.state, {
      tabs: publicTabStates(this.state),
      activeTabId: this.state.activeTabId,
    });
  }

  /**
   * Additive (R11-B chrome): forwards one guest event to the renderer pane.
   * Coordinates for the context menu reuse the same 1:1 assumption the
   * setBounds path uses (renderer CSS px == view DIP): the click lands at
   * the placeholder origin plus the guest offset, and the pane clamps/flips
   * the menu before paint.
   */
  private sendGuestEvent(channel: string, payload: unknown): void {
    this.getWindow()?.webContents.send(channel, payload);
  }

  private contextMenuPoint(params: GuestContextMenuParams): { x: number; y: number } {
    const origin = this.lastRect ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
      x: Math.round(origin.x + params.x),
      y: Math.round(origin.y + params.y),
    };
  }

  /**
   * The guest view paints over the renderer, so DOM loading/error/blocked
   * states only show when the view is hidden: fresh tabs (nothing
   * committed yet) and failed/blocked navigations hide it; committed
   * pages stay visible while reloading (old content, standard behavior).
   */
  private applyVisibility(): void {
    const active = this.state.activeTabId;
    const bounds = this.currentBounds();
    const record = this.state.tabs.find((tab) => tab.tabId === active);
    this.debug(
      `visibility active=${active} url=${record?.url} title=${record?.title} phase=${record?.phase} committed=${record?.committed} back=${record?.canGoBack} forward=${record?.canGoForward} bounds=${JSON.stringify(bounds)} views=${this.views.size}`,
    );
    for (const [tabId, view] of this.views) {
      const visible =
        tabId === active &&
        bounds !== null &&
        record !== undefined &&
        (record.phase === "ready" ||
          record.phase === "idle" ||
          (record.phase === "loading" && record.committed));
      (view as GuestViewLike).setVisible(visible);
      if (visible) (view as GuestViewLike).setBounds(bounds);
    }
  }

  private debug(line: string): void {
    if (process.env.DROGON_BROWSER_DEBUG) console.log(`[drogon] browser-debug ${line}`);
  }

  private currentBounds(): BrowserBounds | null {
    const window = this.getWindow();
    if (!window || !this.lastRect) {
      this.debug(`bounds=null window=${Boolean(window)} rect=${JSON.stringify(this.lastRect)}`);
      return null;
    }
    const size = window.getContentBounds();
    return resolveViewBounds(this.lastRect, {
      width: size.width,
      height: size.height,
    });
  }

  private refreshHistory(tabId: string): void {
    const contents = this.contentsOf(tabId);
    if (!contents) return;
    this.update({
      type: "history-changed",
      tabId,
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
    });
  }

  private rememberRequestedNavigation(tabId: string, url: string): void {
    this.pendingNavigations.set(tabId, { url });
  }

  private navigationStarted(tabId: string, url: string): void {
    this.pendingNavigations.set(tabId, { url });
    this.update({ type: "load-started", tabId, url });
  }

  private navigationMatches(tabId: string, url: string): boolean {
    const pending = this.pendingNavigations.get(tabId);
    // Every loadURL call records a target before Electron emits events. A
    // missing pending record means that navigation already settled; late
    // failures/commits must not rewrite the next document.
    return pending !== undefined && (!url || pending.url === url);
  }

  private committedUrl(tabId: string, contents: GuestContentsLike): string {
    return this.committedUrls.get(tabId) || contents.getURL() || "about:blank";
  }

  private commitNavigation(
    tabId: string,
    url: string,
    allowWithoutPending = false,
  ): void {
    const contents = this.contentsOf(tabId);
    const pending = this.pendingNavigations.get(tabId);
    if (
      !contents ||
      (!allowWithoutPending && !pending) ||
      (pending && !this.navigationMatches(tabId, url))
    )
      return;
    const committed = url || contents.getURL() || "about:blank";
    this.pendingNavigations.delete(tabId);
    this.committedUrls.set(tabId, committed);
    this.update({ type: "navigation-committed", tabId, url: committed });
    this.refreshHistory(tabId);
  }

  private abortNavigation(tabId: string): void {
    const contents = this.contentsOf(tabId);
    if (!contents) return;
    this.pendingNavigations.delete(tabId);
    this.update({
      type: "navigation-aborted",
      tabId,
      url: this.committedUrl(tabId, contents),
    });
    this.refreshHistory(tabId);
  }

  private failNavigation(
    tabId: string,
    errorCode: number,
    errorDescription: string,
    validatedURL: string,
  ): void {
    const contents = this.contentsOf(tabId);
    if (!contents || !this.navigationMatches(tabId, validatedURL)) return;
    this.pendingNavigations.delete(tabId);
    const message = mapGuestLoadError({
      errorCode,
      errorDescription,
      validatedURL,
    });
    if (message === null) {
      this.abortNavigation(tabId);
      return;
    }
    this.update({
      type: "load-failed",
      tabId,
      message,
      loadError: {
        kind: "failed",
        code: errorCode,
        description: errorDescription,
        url: validatedURL,
      },
    });
    this.refreshHistory(tabId);
  }

  private loadURL(tabId: string, url: string): void {
    const contents = this.contentsOf(tabId);
    if (!contents) return;
    this.rememberRequestedNavigation(tabId, url);
    let result: Promise<void> | void;
    try {
      result = contents.loadURL(url);
    } catch (error) {
      this.failNavigation(tabId, -2, String(error), url);
      return;
    }
    // Electron returns a promise, while injected test guests may model the
    // call as fire-and-forget. Both are valid adapters; only attach a catch
    // when the adapter actually returned a thenable.
    if (result && typeof result.then === "function") {
      void result.catch((error) => {
        const text = String(error);
        const aborted = text.includes("ERR_ABORTED") || text.includes("(-3)");
        this.failNavigation(tabId, aborted ? -3 : -2, text, url);
      });
    }
  }

  createTab(workspaceId: string, rawUrl?: string): BrowserTabState | { blocked: string } {
    const window = this.getWindow();
    if (!window) return { blocked: "Browser window is not ready." };
    const existing = this.state.tabs.filter(
      (tab) => tab.workspaceId === workspaceId,
    );
    if (existing.length >= MAX_BROWSER_TABS)
      return { blocked: `Tab limit reached (${MAX_BROWSER_TABS}).` };
    const normalized = rawUrl?.trim()
      ? normalizeBrowserUrl(rawUrl)
      : { kind: "load" as const, url: HOME_URL };
    if (normalized.kind === "blocked") return { blocked: normalized.reason };
    const tabId = nextTabId();
    const view = this.createView({ webPreferences: { ...GUEST_WEB_PREFERENCES } });
    const contents = view.webContents as unknown as GuestContentsLike;
    lockDownGuestSession(contents.session);
    // Popups never open OS windows: denied here, routed into a pane tab.
    contents.setWindowOpenHandler(({ url }) => {
      this.createTab(workspaceId, url);
      return { action: "deny" };
    });
    contents.on("did-start-navigation", (
      _event: never,
      url: never,
      _isInPlace: never,
      isMainFrame: never,
    ) => {
      if (!isMainFrame) return;
      const target = url as string;
      this.debug(`did-start-navigation tab=${tabId} url=${target}`);
      this.navigationStarted(tabId, target);
    });
    const commitEvent = (eventName: string, url: string): void => {
      this.debug(`${eventName} tab=${tabId} url=${url}`);
      this.commitNavigation(tabId, url);
    };
    contents.on("did-navigate", (
      _event: never,
      url: never,
      _httpResponseCode: never,
      _httpStatusText: never,
    ) => {
      // Electron's did-navigate is main-frame-only (unlike
      // did-frame-navigate, which is filtered below).
      commitEvent("did-navigate", url as string);
    });
    // Electron 44 emits did-frame-navigate for WebContentsView main-frame
    // commits where did-navigate is not delivered. It carries the same
    // authoritative URL and is filtered to the main frame, so Forward cannot
    // remain stuck on the outgoing document when did-stop-loading wins the
    // race.
    contents.on("did-frame-navigate", (
      _event: never,
      url: never,
      _httpResponseCode: never,
      _httpStatusText: never,
      isMainFrame: never,
    ) => {
      if (!isMainFrame) return;
      commitEvent("did-frame-navigate", url as string);
    });
    contents.on("did-redirect-navigation", (
      _event: never,
      url: never,
      _isInPlace: never,
      isMainFrame: never,
    ) => {
      if (!isMainFrame) return;
      const pending = this.pendingNavigations.get(tabId);
      if (pending) {
        pending.url = url as string;
        this.debug(`did-redirect-navigation tab=${tabId} url=${pending.url}`);
      }
    });
    contents.on("did-navigate-in-page", (
      _event: never,
      url: never,
      isMainFrame: never,
    ) => {
      if (!isMainFrame) return;
      const committed = url as string;
      this.debug(`did-navigate-in-page tab=${tabId} url=${committed}`);
      this.commitNavigation(tabId, committed, true);
    });
    contents.on("did-start-loading", () => {
      // `getURL()` is the previous committed URL until navigation commits;
      // did-start-navigation above is the only event allowed to choose the
      // address-bar target. Keep this event for diagnostics only.
      this.debug(`did-start-loading tab=${tabId} getURL=${contents.getURL()}`);
    });
    contents.on("did-stop-loading", () => {
      // did-stop-loading carries no navigation URL and can arrive after a
      // superseded request. History is safe to refresh here; readiness and
      // URL selection belong to the commit/failure events above. The small
      // fallback only serves adapters that omit navigation events entirely.
      const pending = this.pendingNavigations.get(tabId);
      this.debug(`did-stop-loading tab=${tabId} getURL=${contents.getURL()}`);
      if (pending === undefined) {
        this.update({ type: "load-stopped", tabId, url: contents.getURL() });
      }
      this.refreshHistory(tabId);
    });
    contents.on(
      "did-fail-load",
      (_event: never, errorCode: never, errorDescription: never, validatedURL: never, isMainFrame: never) => {
        if (!isMainFrame) return;
        const code = errorCode as number;
        const description = errorDescription as string;
        const failedUrl = validatedURL as string;
        this.debug(
          `did-fail-load tab=${tabId} code=${code} description=${description} validatedURL=${failedUrl} getURL=${contents.getURL()}`,
        );
        this.failNavigation(tabId, code, description, failedUrl);
      },
    );
    contents.on("page-title-updated", (_event: never, title: never) => {
      this.debug(`page-title-updated tab=${tabId} title=${String(title)} getURL=${contents.getURL()}`);
      this.update({ type: "title-changed", tabId, title: title as string });
    });
    // Additive (R11-B chrome): guest find matches and context-menu requests
    // are forwarded to the pane that owns this tab; the payload carries the
    // tab id so a late event for a closed tab is dropped by identity.
    contents.on("found-in-page", (_event: never, result: never) => {
      const found = result as GuestFoundInPageResult;
      this.sendGuestEvent(browserIpcChannels.findResult, {
        tabId,
        requestId: found.requestId,
        activeMatchOrdinal: found.activeMatchOrdinal,
        matches: found.matches,
        finalUpdate: found.finalUpdate,
      });
    });
    contents.on("context-menu", (_event: never, params: never) => {
      const menu = params as GuestContextMenuParams;
      const point = this.contextMenuPoint(menu);
      this.sendGuestEvent(browserIpcChannels.contextMenu, {
        tabId,
        x: point.x,
        y: point.y,
        linkUrl: menu.linkURL ?? "",
        pageUrl: menu.pageURL ?? contents.getURL() ?? "",
        selectionText: menu.selectionText ?? "",
      });
    });
    window.contentView.addChildView(view as WebContentsView);
    this.views.set(tabId, view);
    // Additive (R12-E): a focused guest never lets keyboard events reach the
    // renderer, so pane chords (Mod+L/R/F) are captured here and forwarded;
    // the disposer rides the same close path as the view itself.
    this.chordDisposers.set(
      tabId,
      installGuestBrowserChordForwarding({
        tabId,
        guest: view.webContents as unknown as Parameters<
          typeof installGuestBrowserChordForwarding
        >[0]["guest"],
        isMac: process.platform === "darwin",
        forward: (event) =>
          this.sendGuestEvent(browserIpcChannels.chord, event),
      }),
    );
    this.update({ type: "tab-opened", tabId, workspaceId, url: normalized.url });
    this.applyVisibility();
    console.log(
      `[drogon] browser guest created: tab=${tabId} preload=none nodeIntegration=false sandbox=true permissions=denied downloads=blocked`,
    );
    this.debug(`create-load tab=${tabId} url=${normalized.url}`);
    this.loadURL(tabId, normalized.url);
    const created = publicTabStates(this.state).find((tab) => tab.tabId === tabId);
    if (created) this.events.onPopupRouted?.(created);
    return created ?? { blocked: "Tab was closed before it loaded." };
  }

  closeTab(tabId: string): boolean {
    const view = this.viewFor(tabId);
    if (!view) return false;
    // Additive (R12-E): drop the chord forwarder before the guest dies.
    this.chordDisposers.get(tabId)?.();
    this.chordDisposers.delete(tabId);
    try {
      (view.webContents as GuestContentsLike).stopFindInPage("clearSelection");
    } catch {
      // The guest can be mid-teardown; close proceeds regardless.
    }
    this.getWindow()?.contentView.removeChildView(view as WebContentsView);
    const contents = view.webContents as unknown as {
      close?: () => void;
      destroy?: () => void;
    };
    if (typeof contents.close === "function") contents.close();
    else if (typeof contents.destroy === "function") contents.destroy();
    this.views.delete(tabId);
    this.pendingNavigations.delete(tabId);
    this.committedUrls.delete(tabId);
    this.update({ type: "tab-closed", tabId });
    this.applyVisibility();
    return true;
  }

  navigate(tabId: string, rawUrl: string): BrowserTabState | { blocked: string } {
    const contents = this.contentsOf(tabId);
    if (!contents) return { blocked: "Tab is not open." };
    const normalized = normalizeBrowserUrl(rawUrl);
    if (normalized.kind === "blocked") {
      this.update({
        type: "load-blocked",
        tabId,
        url: rawUrl.trim(),
        reason: normalized.reason,
      });
      this.applyVisibility();
      const tab = publicTabStates(this.state).find((item) => item.tabId === tabId);
      return tab ?? { blocked: normalized.reason };
    }
    this.update({ type: "active-changed", tabId });
    // Optimistic request record: the address bar follows immediately, and
    // the host's commit/fail event for this navigation settles it.
    this.update({ type: "load-started", tabId, url: normalized.url });
    this.debug(`navigate-load tab=${tabId} url=${normalized.url}`);
    this.loadURL(tabId, normalized.url);
    this.applyVisibility();
    const tab = publicTabStates(this.state).find((item) => item.tabId === tabId);
    return tab ?? { blocked: "Tab is not open." };
  }

  back(tabId: string): BrowserTabState | { blocked: string } {
    const contents = this.contentsOf(tabId);
    if (!contents) return { blocked: "Tab is not open." };
    if (!contents.navigationHistory.canGoBack())
      return { blocked: "No earlier page in this tab." };
    this.debug(`go-back tab=${tabId}`);
    try {
      contents.navigationHistory.goBack();
    } catch {
      return { blocked: "The page could not go back." };
    }
    return this.describe(tabId);
  }

  forward(tabId: string): BrowserTabState | { blocked: string } {
    const contents = this.contentsOf(tabId);
    if (!contents) return { blocked: "Tab is not open." };
    if (!contents.navigationHistory.canGoForward())
      return { blocked: "No later page in this tab." };
    this.debug(`go-forward tab=${tabId}`);
    try {
      contents.navigationHistory.goForward();
    } catch {
      return { blocked: "The page could not go forward." };
    }
    return this.describe(tabId);
  }

  reload(tabId: string): BrowserTabState | { blocked: string } {
    const contents = this.contentsOf(tabId);
    if (!contents) return { blocked: "Tab is not open." };
    contents.reload();
    return this.describe(tabId);
  }

  stop(tabId: string): BrowserTabState | { blocked: string } {
    const contents = this.contentsOf(tabId);
    if (!contents) return { blocked: "Tab is not open." };
    this.abortNavigation(tabId);
    try {
      contents.stop();
    } catch {
      return { blocked: "The page could not be stopped." };
    }
    return this.describe(tabId);
  }

  /**
   * Additive (R11-B chrome): cache-bypassing reload for the reload control's
   * right-click menu. A failed load retries through `navigate` instead —
   * `reload()` on a guest error page only refreshes the error.
   */
  hardReload(tabId: string): BrowserTabState | { blocked: string } {
    const contents = this.contentsOf(tabId);
    if (!contents) return { blocked: "Tab is not open." };
    contents.reloadIgnoringCache();
    return this.describe(tabId);
  }

  private applyZoom(tabId: string, level: number): BrowserTabState | { blocked: string } {
    const contents = this.contentsOf(tabId);
    if (!contents) return { blocked: "Tab is not open." };
    const clamped = Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, level));
    contents.setZoomLevel(clamped);
    this.update({
      type: "zoom-changed",
      tabId,
      zoomPercent: zoomPercentForLevel(contents.getZoomLevel()),
    });
    return this.describe(tabId);
  }

  /** Additive (R11-B chrome): one zoom step in from the guest's level. */
  zoomIn(tabId: string): BrowserTabState | { blocked: string } {
    const contents = this.contentsOf(tabId);
    if (!contents) return { blocked: "Tab is not open." };
    return this.applyZoom(tabId, contents.getZoomLevel() + 1);
  }

  /** Additive (R11-B chrome): one zoom step out from the guest's level. */
  zoomOut(tabId: string): BrowserTabState | { blocked: string } {
    const contents = this.contentsOf(tabId);
    if (!contents) return { blocked: "Tab is not open." };
    return this.applyZoom(tabId, contents.getZoomLevel() - 1);
  }

  /** Additive (R11-B chrome): back to the 100 default (level 0). */
  zoomReset(tabId: string): BrowserTabState | { blocked: string } {
    return this.applyZoom(tabId, 0);
  }

  /**
   * Additive (R11-B chrome): starts or advances a guest find session.
   * `findNext: false` keeps the session open across follow-up requests
   * (Enter/arrows); the first request for a query passes `findNext: true`.
   * Empty queries never reach the guest — the pane stops instead.
   */
  findInPage(
    tabId: string,
    query: string,
    options?: { forward?: boolean; findNext?: boolean },
  ): { requestId: number } | { blocked: string; code?: string } {
    const contents = this.contentsOf(tabId);
    if (!contents) return { blocked: "Tab is not open.", code: "browser_no_tab" };
    if (!query) return { blocked: "Nothing to find.", code: "invalid_argument" };
    let requestId = 0;
    try {
      requestId = contents.findInPage(query, {
        forward: options?.forward ?? true,
        findNext: options?.findNext ?? true,
      });
    } catch {
      return { blocked: "The page refused find-in-page.", code: "browser_blocked" };
    }
    return { requestId };
  }

  /** Additive (R11-B chrome): clears the guest find selection. */
  stopFind(tabId: string): { stopped: true } | { blocked: string; code?: string } {
    const contents = this.contentsOf(tabId);
    if (!contents) return { blocked: "Tab is not open.", code: "browser_no_tab" };
    try {
      contents.stopFindInPage("clearSelection");
    } catch {
      return { blocked: "The page refused find-in-page.", code: "browser_blocked" };
    }
    return { stopped: true };
  }

  /** Additive (R11-B chrome): guest devtools for the page context menu. */
  openDevTools(tabId: string): { opened: true } | { blocked: string; code?: string } {
    const contents = this.contentsOf(tabId);
    if (!contents) return { blocked: "Tab is not open.", code: "browser_no_tab" };
    try {
      contents.openDevTools({ mode: "detach" });
    } catch {
      return { blocked: "Devtools could not be opened.", code: "browser_blocked" };
    }
    return { opened: true };
  }

  focusTab(tabId: string): boolean {
    if (!this.views.has(tabId)) return false;
    this.update({ type: "active-changed", tabId });
    this.applyVisibility();
    return true;
  }

  setBounds(tabId: string | undefined, rect: BrowserBounds): void {
    this.lastRect = rect;
    if (tabId && this.views.has(tabId)) {
      this.update({ type: "active-changed", tabId });
    }
    this.applyVisibility();
  }

  private describe(tabId: string): BrowserTabState | { blocked: string } {
    const tab = publicTabStates(this.state).find((item) => item.tabId === tabId);
    return tab ?? { blocked: "Tab is not open." };
  }

  tabsForWorkspace(workspaceId: string): BrowserTabState[] {
    return publicTabStates(this.state).filter(
      (tab) => tab.workspaceId === workspaceId,
    );
  }

  async click(tabId: string, selector: string): Promise<BrowserTabState | HostBlocked> {
    const contents = this.contentsOf(tabId);
    if (!contents) return { blocked: "Tab is not open.", code: "browser_no_tab" };
    if (
      !selector ||
      selector.length > MAX_BROWSER_SELECTOR_CHARS ||
      selector.includes("\0")
    )
      return { blocked: "Invalid CSS selector.", code: "invalid_argument" };
    let verdict: unknown;
    try {
      verdict = await contents.executeJavaScript(buildClickScript(selector));
    } catch {
      return { blocked: "The page refused script evaluation.", code: "browser_blocked" };
    }
    const failure = verdictError(verdict);
    if (failure) return { blocked: failure, code: "browser_blocked" };
    return this.describe(tabId);
  }

  async fill(
    tabId: string,
    selector: string,
    text: string,
  ): Promise<BrowserTabState | HostBlocked> {
    const contents = this.contentsOf(tabId);
    if (!contents) return { blocked: "Tab is not open.", code: "browser_no_tab" };
    if (!selector || selector.length > MAX_BROWSER_SELECTOR_CHARS || selector.includes("\0"))
      return { blocked: "Invalid CSS selector.", code: "invalid_argument" };
    if (text.length > MAX_BROWSER_FILL_TEXT_CHARS)
      return { blocked: "Fill text exceeds the budget.", code: "invalid_argument" };
    let verdict: unknown;
    try {
      verdict = await contents.executeJavaScript(buildFillScript(selector, text));
    } catch {
      return { blocked: "The page refused script evaluation.", code: "browser_blocked" };
    }
    const failure = verdictError(verdict);
    if (failure) return { blocked: failure, code: "browser_blocked" };
    return this.describe(tabId);
  }

  async snapshot(tabId: string): Promise<BrowserSnapshot | { blocked: string }> {
    const tab = publicTabStates(this.state).find((item) => item.tabId === tabId);
    const contents = this.contentsOf(tabId);
    if (!tab || !contents) return { blocked: "Tab is not open." };
    let title = tab.title;
    let text = "";
    try {
      const observed = (await contents.executeJavaScript(
        "({ title: document.title || '', text: (document.body && document.body.innerText) || '' })",
      )) as { title?: unknown; text?: unknown };
      if (typeof observed?.title === "string") title = observed.title;
      if (typeof observed?.text === "string") text = observed.text;
    } catch {
      // A page that refuses script evaluation still yields its URL/title.
    }
    const truncated = text.length > MAX_BROWSER_SNAPSHOT_CHARS;
    return {
      tabId,
      url: contents.getURL() || tab.url,
      title: title.slice(0, 256),
      text: text.slice(0, MAX_BROWSER_SNAPSHOT_CHARS),
      truncated,
    };
  }
}
