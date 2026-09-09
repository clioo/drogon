import { describe, expect, test, vi } from "vitest";
import {
  BrowserHost,
  GUEST_WEB_PREFERENCES,
  buildClickScript,
  buildFillScript,
  lockDownGuestSession,
  type BrowserParentWindowLike,
  type GuestContentsLike,
  type GuestSessionLike,
  type GuestViewLike,
} from "./browser-host";

function fakeSession(): GuestSessionLike & {
  permissionCallback: ((allow: boolean) => void) | null;
  checkHandler: (() => boolean) | null;
  downloadPrevented: boolean;
} {
  const state = {
    permissionCallback: null as ((allow: boolean) => void) | null,
    checkHandler: null as (() => boolean) | null,
    downloadPrevented: false,
  };
  const session: GuestSessionLike & typeof state = Object.assign(state, {
    setPermissionRequestHandler(
      handler: (
        webContents: { id: number } | undefined,
        permission: string,
        callback: (allow: boolean) => void,
      ) => void,
    ): void {
      // Record the real decision by invoking with a probe callback.
      handler({ id: 0 }, "media", (allow) => {
        (session as { lastDecision?: boolean }).lastDecision = allow;
      });
    },
    setPermissionCheckHandler(
      handler: (
        webContents: { id: number } | undefined,
        permission: string,
      ) => boolean,
    ): void {
      state.checkHandler = () => handler(undefined, "clipboard-read");
    },
    on(event: "will-download", listener: (event: { preventDefault(): void }) => void): void {
      if (event === "will-download")
        listener({ preventDefault: () => { state.downloadPrevented = true; } });
    },
  });
  return session;
}

function fakeContents(session?: GuestSessionLike): GuestContentsLike & {
  listeners: Map<string, (...args: never[]) => void>;
  loaded: string[];
  windowOpenHandler: ((details: { url: string }) => { action: "deny" }) | null;
  zoomLevel: number;
  found: { text: string; options?: unknown }[];
  devtoolsOpened: number;
} {
  const contents = {
    listeners: new Map<string, (...args: never[]) => void>(),
    loaded: [] as string[],
    windowOpenHandler: null as
      | ((details: { url: string }) => { action: "deny" })
      | null,
    zoomLevel: 0,
    found: [] as { text: string; options?: unknown }[],
    devtoolsOpened: 0,
    session: session ?? fakeSession(),
    loadURL(url: string) { this.loaded.push(url); },
    stop() {},
    goBack() {},
    goForward() {},
    reload() {},
    reloadIgnoringCache() {},
    getURL: () => "https://example.test/",
    getTitle: () => "Example",
    executeJavaScript: async () => ({ title: "Example", text: "hello" }),
    setBackgroundThrottling: vi.fn(),
    navigationHistory: {
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
      goBack: vi.fn(),
      goForward: vi.fn(),
    },
    setWindowOpenHandler(
      handler: (details: { url: string }) => { action: "deny" },
    ) { this.windowOpenHandler = handler; },
    on(event: string, listener: (...args: never[]) => void) {
      this.listeners.set(event, listener);
    },
    getZoomLevel() { return this.zoomLevel; },
    setZoomLevel(level: number) { this.zoomLevel = level; },
    findInPage(text: string, options?: { forward?: boolean; findNext?: boolean }) {
      this.found.push({ text, options });
      return this.found.length;
    },
    stopFindInPage() {},
    openDevTools() { this.devtoolsOpened += 1; },
  };
  return contents;
}

function harness() {
  const sent: { channel: string; payload: unknown }[] = [];
  const views: GuestViewLike[] = [];
  const window: BrowserParentWindowLike = {
    contentView: {
      addChildView: (view) => { views.push(view as GuestViewLike); },
      removeChildView: (view) => {
        const index = views.indexOf(view as GuestViewLike);
        if (index >= 0) views.splice(index, 1);
      },
    },
    webContents: { send: (channel, payload) => { sent.push({ channel, payload }); } },
    getContentBounds: () => ({ width: 1440, height: 900 }),
    on: () => {},
  };
  const createdPrefs: unknown[] = [];
  const host = new BrowserHost(
    () => window,
    (options) => {
      createdPrefs.push(options.webPreferences);
      const view: GuestViewLike = {
        webContents: fakeContents(),
        setBounds: vi.fn(),
        setVisible: vi.fn(),
      };
      return view;
    },
  );
  return { host, sent, views, createdPrefs, window };
}

describe("guest trust boundary", () => {
  test("locked preferences: no preload, no node, sandbox on", () => {
    expect(GUEST_WEB_PREFERENCES).toEqual({
      nodeIntegration: false,
      sandbox: true,
      contextIsolation: true,
      webSecurity: true,
    });
    expect("preload" in GUEST_WEB_PREFERENCES).toBe(false);
  });
  test("every created view uses the locked preferences", () => {
    const { host, createdPrefs } = harness();
    host.createTab("w1", "example.test");
    host.createTab("w1", "example.test");
    expect(createdPrefs).toHaveLength(2);
    for (const prefs of createdPrefs) expect(prefs).toEqual(GUEST_WEB_PREFERENCES);
  });
  test("created guests opt out of Chromium background throttling", () => {
    const { host } = harness();
    host.createTab("w1", "example.test");
    const tabId = host.list().tabs[0].tabId;
    const contents = (host as unknown as {
      views: Map<string, GuestViewLike>;
    }).views.get(tabId)?.webContents as ReturnType<typeof fakeContents>;
    expect(contents.setBackgroundThrottling).toHaveBeenCalledWith(false);
  });
  test("permission requests denied and downloads blocked", () => {
    const session = fakeSession();
    lockDownGuestSession(session);
    expect(
      (session as unknown as { lastDecision?: boolean }).lastDecision,
    ).toBe(false);
    expect(session.checkHandler?.()).toBe(false);
    expect(session.downloadPrevented).toBe(true);
  });
  test("blank duplicate opens a fresh blank tab instead of blocking", () => {
    const { host } = harness();
    // Why: the tab-strip Duplicate item passes the source tab's URL; a New
    // Tab's URL is the blank identity, which must clone as a usable blank
    // tab (fork parity), never the blocked `about:` error.
    const created = host.createTab("w1", "about:blank");
    expect(created).toMatchObject({ url: "about:blank" });
    const contents = (host as unknown as {
      views: Map<string, GuestViewLike>;
    }).views.get((created as { tabId: string }).tabId)?.webContents as ReturnType<typeof fakeContents>;
    expect(contents.loaded).toEqual(["about:blank"]);
  });
  test("whitespace-only duplicate opens a fresh blank tab", () => {
    const { host } = harness();
    const created = host.createTab("w1", "   ");
    expect(created).toMatchObject({ url: "about:blank" });
  });
  test("guest popups are denied and routed into a pane tab", () => {
    const { host } = harness();
    host.createTab("w1", "example.test");
    const first = host.list().tabs[0];
    const contents = (host as unknown as {
      views: Map<string, GuestViewLike>;
    }).views.get(first.tabId)?.webContents as ReturnType<typeof fakeContents>;
    const verdict = contents.windowOpenHandler?.({ url: "https://popup.test/" });
    expect(verdict).toEqual({ action: "deny" });
    expect(host.list().tabs).toHaveLength(2);
  });
});

describe("browser host behavior", () => {
  test("blocked scheme never loads and reports honestly", () => {
    const { host } = harness();
    const result = host.createTab("w1", "file:///etc/passwd");
    expect(result).toEqual({
      blocked: expect.stringMatching(/Blocked/),
    });
    expect(host.list().tabs).toHaveLength(0);
  });
  test("setBounds with a zero rect hides the active view", () => {
    const { host, views } = harness();
    host.createTab("w1", "example.test");
    host.setBounds(undefined, { x: 0, y: 0, width: 0, height: 0 });
    expect(views[0].setVisible).toHaveBeenCalledWith(false);
  });
  test("failed main-frame load surfaces an honest error", () => {
    const { host } = harness();
    host.createTab("w1", "example.test");
    const tabId = host.list().tabs[0].tabId;
    const contents = (host as unknown as {
      views: Map<string, GuestViewLike>;
    }).views.get(tabId)?.webContents as ReturnType<typeof fakeContents>;
    host.navigate(tabId, "https://missing.test/");
    (contents.listeners.get("did-fail-load") as unknown as (
      ...args: unknown[]
    ) => void)?.(
      {},
      -105,
      "ERR_NAME_NOT_RESOLVED",
      "https://missing.test/",
      true,
    );
    const [tab] = host.list().tabs;
    expect(tab.loading).toBe(false);
    expect(tab.error).toContain("https://missing.test/");
  });
  test("navigate records the requested URL before commit", () => {
    const { host } = harness();
    host.createTab("w1", "example.test");
    const tabId = host.list().tabs[0].tabId;
    const result = host.navigate(tabId, "example.test/next");
    expect(result).toMatchObject({
      tabId,
      url: "https://example.test/next",
      loading: true,
    });
  });
  test("back then forward commits the history target instead of stale getURL", () => {
    const { host } = harness();
    host.createTab("w1", "https://first.test/");
    const tabId = host.list().tabs[0].tabId;
    const contents = (host as unknown as {
      views: Map<string, GuestViewLike>;
    }).views.get(tabId)?.webContents as ReturnType<typeof fakeContents>;
    const history = contents.navigationHistory as {
      canGoBack: ReturnType<typeof vi.fn>;
      canGoForward: ReturnType<typeof vi.fn>;
      goBack: ReturnType<typeof vi.fn>;
      goForward: ReturnType<typeof vi.fn>;
    };
    history.canGoBack.mockReturnValue(true);
    history.canGoForward.mockReturnValue(false);

    const started = contents.listeners.get("did-start-navigation") as unknown as (
      event: unknown,
      url: string,
      inPlace: boolean,
      mainFrame: boolean,
    ) => void;
    const committed = contents.listeners.get("did-navigate") as unknown as (
      event: unknown,
      url: string,
      responseCode: number,
      statusText: string,
    ) => void;
    const stopped = contents.listeners.get("did-stop-loading") as unknown as () => void;

    started({}, "https://first.test/", false, true);
    committed({}, "https://first.test/", 200, "OK");
    expect(host.list().tabs[0]).toMatchObject({
      url: "https://first.test/",
      loading: false,
      committed: true,
    });

    history.canGoBack.mockReturnValue(true);
    history.canGoForward.mockReturnValue(false);
    expect(host.back(tabId)).toMatchObject({ tabId });
    expect(history.goBack).toHaveBeenCalledTimes(1);
    started({}, "about:blank", false, true);
    // A stop event has no target URL and must not settle a history load.
    stopped();
    expect(host.list().tabs[0]).toMatchObject({
      url: "about:blank",
      loading: true,
    });
    committed({}, "about:blank", 200, "OK");
    expect(host.list().tabs[0]).toMatchObject({
      url: "about:blank",
      loading: false,
    });

    history.canGoBack.mockReturnValue(false);
    history.canGoForward.mockReturnValue(true);
    expect(host.forward(tabId)).toMatchObject({ tabId });
    expect(history.goForward).toHaveBeenCalledTimes(1);
    started({}, "https://first.test/", false, true);
    stopped();
    history.canGoBack.mockReturnValue(true);
    history.canGoForward.mockReturnValue(false);
    expect(host.list().tabs[0]).toMatchObject({
      url: "https://first.test/",
      loading: true,
    });
    committed({}, "https://first.test/", 200, "OK");
    expect(host.list().tabs[0]).toMatchObject({
      url: "https://first.test/",
      loading: false,
      canGoBack: true,
      canGoForward: false,
    });
  });
  test("late failure from an older navigation cannot settle the newer target", () => {
    const { host } = harness();
    host.createTab("w1", "https://first.test/");
    const tabId = host.list().tabs[0].tabId;
    const contents = (host as unknown as {
      views: Map<string, GuestViewLike>;
    }).views.get(tabId)?.webContents as ReturnType<typeof fakeContents>;
    const started = contents.listeners.get("did-start-navigation") as unknown as (
      event: unknown,
      url: string,
      inPlace: boolean,
      mainFrame: boolean,
    ) => void;
    const failed = contents.listeners.get("did-fail-load") as unknown as (
      event: unknown,
      code: number,
      description: string,
      url: string,
      mainFrame: boolean,
    ) => void;
    started({}, "https://old.test/", false, true);
    started({}, "https://new.test/", false, true);
    failed({}, -105, "ERR_NAME_NOT_RESOLVED", "https://old.test/", true);
    expect(host.list().tabs[0]).toMatchObject({
      url: "https://new.test/",
      loading: true,
      error: null,
    });
    const committed = contents.listeners.get("did-navigate") as unknown as (
      event: unknown,
      url: string,
      responseCode: number,
      statusText: string,
    ) => void;
    committed({}, "https://new.test/", 200, "OK");
    failed({}, -105, "ERR_NAME_NOT_RESOLVED", "https://old.test/", true);
    expect(host.list().tabs[0]).toMatchObject({
      url: "https://new.test/",
      loading: false,
      error: null,
    });
  });
  test("blocked navigate keeps an honest pane error", () => {
    const { host } = harness();
    host.createTab("w1", "example.test");
    const tabId = host.list().tabs[0].tabId;
    host.navigate(tabId, "file:///etc/passwd");
    const [tab] = host.list().tabs;
    expect(tab.loading).toBe(false);
    expect(tab.error).toMatch(/Blocked/);
  });
  test("snapshot is bounded", async () => {
    const { host } = harness();
    host.createTab("w1", "example.test");
    const tabId = host.list().tabs[0].tabId;
    const snapshot = await host.snapshot(tabId);
    expect(snapshot).toMatchObject({ tabId, url: expect.any(String) });
  });
  test("tabsForWorkspace scopes to one workspace", () => {
    const { host } = harness();
    host.createTab("w1", "example.test");
    host.createTab("w2", "example.test");
    expect(host.tabsForWorkspace("w1")).toHaveLength(1);
    expect(host.tabsForWorkspace("w1")[0].workspaceId).toBe("w1");
    expect(host.tabsForWorkspace("missing")).toHaveLength(0);
  });
  test("click on a missing tab reports browser_no_tab", async () => {
    const { host } = harness();
    expect(await host.click("browser-tab-9", "#go")).toEqual({
      blocked: "Tab is not open.",
      code: "browser_no_tab",
    });
    expect(await host.fill("browser-tab-9", "#a", "x")).toEqual({
      blocked: "Tab is not open.",
      code: "browser_no_tab",
    });
  });
  test("click runs the selector script and returns the tab", async () => {
    const { host } = harness();
    host.createTab("w1", "example.test");
    const tabId = host.list().tabs[0].tabId;
    const contents = (host as unknown as {
      views: Map<string, GuestViewLike>;
    }).views.get(tabId)?.webContents as ReturnType<typeof fakeContents> & {
      executeJavaScript: ReturnType<typeof vi.fn>;
    };
    const seen: string[] = [];
    contents.executeJavaScript = vi.fn(async (code: string) => {
      seen.push(code);
      return { ok: true };
    });
    const result = await host.click(tabId, "#go");
    expect(result).toMatchObject({ tabId });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(JSON.stringify("#go"));
  });
  test("fill verdict miss maps to browser_blocked without echo", async () => {
    const { host } = harness();
    host.createTab("w1", "example.test");
    const tabId = host.list().tabs[0].tabId;
    const contents = (host as unknown as {
      views: Map<string, GuestViewLike>;
    }).views.get(tabId)?.webContents as ReturnType<typeof fakeContents> & {
      executeJavaScript: ReturnType<typeof vi.fn>;
    };
    contents.executeJavaScript = vi.fn(async () => ({
      ok: false,
      error: "no element matches selector",
    }));
    expect(await host.fill(tabId, "#missing", "secret-text")).toEqual({
      blocked: "no element matches selector",
      code: "browser_blocked",
    });
  });
  test("guest scripts embed the selector as a JSON literal", () => {
    expect(buildClickScript("#go")).toContain(`querySelector(${JSON.stringify("#go")})`);
    const script = buildFillScript("#a", "x");
    expect(script).toContain(`querySelector(${JSON.stringify("#a")})`);
    expect(script).toContain(JSON.stringify("x"));
  });
});
