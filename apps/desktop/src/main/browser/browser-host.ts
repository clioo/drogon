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
  getURL(): string;
  getTitle(): string;
  executeJavaScript(code: string): Promise<unknown>;
  navigationHistory: { canGoBack(): boolean; canGoForward(): boolean };
  session: GuestSessionLike;
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: "deny" },
  ): void;
  on(event: string, listener: (...args: never[]) => void): void;
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
      `visibility active=${active} phase=${record?.phase} committed=${record?.committed} bounds=${JSON.stringify(bounds)} views=${this.views.size}`,
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
    contents.on("did-start-loading", () => {
      // Before commit getURL() is still the previous (possibly empty)
      // URL; the requested URL was already recorded by createTab/navigate,
      // so an empty read must never clobber it.
      const url = contents.getURL();
      if (url) this.update({ type: "load-started", tabId, url });
    });
    contents.on("did-stop-loading", () => {
      this.update({ type: "load-stopped", tabId, url: contents.getURL() });
      this.refreshHistory(tabId);
    });
    contents.on(
      "did-fail-load",
      (_event: never, errorCode: never, errorDescription: never, validatedURL: never, isMainFrame: never) => {
        if (!isMainFrame) return;
        const message = mapGuestLoadError({
          errorCode: errorCode as number,
          errorDescription: errorDescription as string,
          validatedURL: validatedURL as string,
        });
        // Abort (-3) is a caller-initiated stop: report the stop, no error.
        if (message === null) {
          this.update({
            type: "load-stopped",
            tabId,
            url: contents.getURL(),
          });
          return;
        }
        this.update({ type: "load-failed", tabId, message });
      },
    );
    contents.on("page-title-updated", (_event: never, title: never) => {
      this.update({ type: "title-changed", tabId, title: title as string });
    });
    window.contentView.addChildView(view as WebContentsView);
    this.views.set(tabId, view);
    this.update({ type: "tab-opened", tabId, workspaceId, url: normalized.url });
    this.applyVisibility();
    console.log(
      `[drogon] browser guest created: tab=${tabId} preload=none nodeIntegration=false sandbox=true permissions=denied downloads=blocked`,
    );
    void contents.loadURL(normalized.url);
    const created = publicTabStates(this.state).find((tab) => tab.tabId === tabId);
    if (created) this.events.onPopupRouted?.(created);
    return created ?? { blocked: "Tab was closed before it loaded." };
  }

  closeTab(tabId: string): boolean {
    const view = this.viewFor(tabId);
    if (!view) return false;
    this.getWindow()?.contentView.removeChildView(view as WebContentsView);
    const contents = view.webContents as unknown as {
      close?: () => void;
      destroy?: () => void;
    };
    if (typeof contents.close === "function") contents.close();
    else if (typeof contents.destroy === "function") contents.destroy();
    this.views.delete(tabId);
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
    void contents.loadURL(normalized.url);
    this.applyVisibility();
    const tab = publicTabStates(this.state).find((item) => item.tabId === tabId);
    return tab ?? { blocked: "Tab is not open." };
  }

  back(tabId: string): BrowserTabState | { blocked: string } {
    const contents = this.contentsOf(tabId);
    if (!contents) return { blocked: "Tab is not open." };
    if (!contents.navigationHistory.canGoBack())
      return { blocked: "No earlier page in this tab." };
    contents.goBack();
    return this.describe(tabId);
  }

  forward(tabId: string): BrowserTabState | { blocked: string } {
    const contents = this.contentsOf(tabId);
    if (!contents) return { blocked: "Tab is not open." };
    if (!contents.navigationHistory.canGoForward())
      return { blocked: "No later page in this tab." };
    contents.goForward();
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
    contents.stop();
    return this.describe(tabId);
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
