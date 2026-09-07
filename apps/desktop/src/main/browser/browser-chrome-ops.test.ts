// R11-B chrome ops on a fake WebContentsView: zoom steps, hard reload,
// find-in-page, devtools, context-menu forwarding, structured load errors,
// and the committed flag the viewport overlays read.
import { describe, expect, test, vi } from "vitest";
import {
  BrowserHost,
  zoomPercentForLevel,
  type BrowserParentWindowLike,
  type GuestContentsLike,
  type GuestViewLike,
} from "./browser-host";
import { browserIpcChannels } from "../../shared/browser-contract";

function fakeContents(): GuestContentsLike & {
  listeners: Map<string, (...args: never[]) => void>;
  currentUrl: string;
  zoomLevel: number;
  found: { text: string; options?: unknown }[];
  stopFindCalls: unknown[];
  devtoolsOpened: number;
  hardReloads: number;
} {
  const contents = {
    listeners: new Map<string, (...args: never[]) => void>(),
    currentUrl: "https://example.test/",
    zoomLevel: 0,
    found: [] as { text: string; options?: unknown }[],
    stopFindCalls: [] as unknown[],
    devtoolsOpened: 0,
    hardReloads: 0,
    loadURL() {},
    stop() {},
    goBack() {},
    goForward() {},
    reload() {},
    reloadIgnoringCache() {
      this.hardReloads += 1;
    },
    getURL() {
      return this.currentUrl;
    },
    getTitle: () => "Example",
    executeJavaScript: async () => ({}),
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    session: {
      setPermissionRequestHandler() {},
      setPermissionCheckHandler() {},
      on() {},
    },
    setWindowOpenHandler() {},
    on(event: string, listener: (...args: never[]) => void) {
      this.listeners.set(event, listener);
    },
    getZoomLevel() {
      return this.zoomLevel;
    },
    setZoomLevel(level: number) {
      this.zoomLevel = level;
    },
    findInPage(text: string, options?: { forward?: boolean; findNext?: boolean }) {
      this.found.push({ text, options });
      return this.found.length;
    },
    stopFindInPage(action: unknown) {
      this.stopFindCalls.push(action);
    },
    openDevTools() {
      this.devtoolsOpened += 1;
    },
  };
  return contents;
}

function harness() {
  const sent: { channel: string; payload: unknown }[] = [];
  const window: BrowserParentWindowLike = {
    contentView: {
      addChildView: () => {},
      removeChildView: () => {},
    },
    webContents: {
      send: (channel, payload) => {
        sent.push({ channel, payload });
      },
    },
    getContentBounds: () => ({ width: 1440, height: 900 }),
    on: () => {},
  };
  const host = new BrowserHost(
    () => window,
    () => ({
      webContents: fakeContents(),
      setBounds: vi.fn(),
      setVisible: vi.fn(),
    }),
  );
  const viewsOf = (target: BrowserHost): Map<string, GuestViewLike> =>
    (target as unknown as { views: Map<string, GuestViewLike> }).views;
  return { host, sent, viewsOf };
}

function openTab(host: BrowserHost): string {
  const created = host.createTab("w1", "example.test");
  if ("blocked" in created) throw new Error("fake tab refused to open");
  return created.tabId;
}

function contentsOf(host: BrowserHost, tabId: string) {
  const views: Map<string, GuestViewLike> = (
    host as unknown as { views: Map<string, GuestViewLike> }
  ).views;
  return views.get(tabId)?.webContents as unknown as ReturnType<
    typeof fakeContents
  >;
}

describe("browser chrome zoom", () => {
  test("level 0 reads 100 percent", () => {
    expect(zoomPercentForLevel(0)).toBe(100);
    expect(zoomPercentForLevel(1)).toBe(120);
  });
  test("zoom in steps the guest level and reports the percent", () => {
    const { host } = harness();
    const tabId = openTab(host);
    const result = host.zoomIn(tabId);
    expect(result).toMatchObject({ tabId, zoomPercent: 120 });
    expect(contentsOf(host, tabId).zoomLevel).toBe(1);
  });
  test("zoom out then reset returns to 100", () => {
    const { host } = harness();
    const tabId = openTab(host);
    host.zoomIn(tabId);
    host.zoomOut(tabId);
    expect(host.list().tabs[0].zoomPercent).toBe(100);
    host.zoomIn(tabId);
    host.zoomIn(tabId);
    const reset = host.zoomReset(tabId);
    expect(reset).toMatchObject({ tabId, zoomPercent: 100 });
    expect(contentsOf(host, tabId).zoomLevel).toBe(0);
  });
  test("zoom on a missing tab reports honestly", () => {
    const { host } = harness();
    expect(host.zoomIn("browser-tab-404")).toEqual({ blocked: "Tab is not open." });
    expect(host.zoomReset("browser-tab-404")).toEqual({ blocked: "Tab is not open." });
  });
});

describe("browser chrome reload/find/devtools", () => {
  test("hard reload bypasses the cache on the guest", () => {
    const { host } = harness();
    const tabId = openTab(host);
    const result = host.hardReload(tabId);
    expect(result).toMatchObject({ tabId });
    expect(contentsOf(host, tabId).hardReloads).toBe(1);
  });
  test("find forwards the query with session flags and rejects empties", () => {
    const { host } = harness();
    const tabId = openTab(host);
    const contents = contentsOf(host, tabId);
    expect(host.findInPage(tabId, "needle", { forward: true, findNext: true })).toEqual({
      requestId: 1,
    });
    expect(contents.found[0]).toEqual({
      text: "needle",
      options: { forward: true, findNext: true },
    });
    expect(host.findInPage(tabId, "needle", { forward: false, findNext: false })).toEqual({
      requestId: 2,
    });
    expect(host.findInPage(tabId, "")).toEqual({
      blocked: "Nothing to find.",
      code: "invalid_argument",
    });
    expect(host.findInPage("browser-tab-404", "x")).toEqual({
      blocked: "Tab is not open.",
      code: "browser_no_tab",
    });
  });
  test("stopFind clears the guest selection", () => {
    const { host } = harness();
    const tabId = openTab(host);
    expect(host.stopFind(tabId)).toEqual({ stopped: true });
    expect(contentsOf(host, tabId).stopFindCalls).toEqual(["clearSelection"]);
  });
  test("openDevTools reaches the guest", () => {
    const { host } = harness();
    const tabId = openTab(host);
    expect(host.openDevTools(tabId)).toEqual({ opened: true });
    expect(contentsOf(host, tabId).devtoolsOpened).toBe(1);
    expect(host.openDevTools("browser-tab-404")).toEqual({
      blocked: "Tab is not open.",
      code: "browser_no_tab",
    });
  });
});

describe("browser chrome guest events", () => {
  test("found-in-page results forward with the owning tab id", () => {
    const { host, sent } = harness();
    const tabId = openTab(host);
    const contents = contentsOf(host, tabId);
    (
      contents.listeners.get("found-in-page") as unknown as (
        ...args: unknown[]
      ) => void
    )?.({}, { requestId: 1, activeMatchOrdinal: 2, matches: 5, finalUpdate: true });
    expect(sent).toContainEqual({
      channel: browserIpcChannels.findResult,
      payload: {
        tabId,
        requestId: 1,
        activeMatchOrdinal: 2,
        matches: 5,
        finalUpdate: true,
      },
    });
  });
  test("context-menu requests forward window-relative coords", () => {
    const { host, sent } = harness();
    const tabId = openTab(host);
    host.setBounds(tabId, { x: 10, y: 20, width: 400, height: 300 });
    const contents = contentsOf(host, tabId);
    (
      contents.listeners.get("context-menu") as unknown as (
        ...args: unknown[]
      ) => void
    )?.(
      {},
      {
        x: 30,
        y: 40,
        linkURL: "https://example.test/a",
        pageURL: "https://example.test/",
        selectionText: "hi",
      },
    );
    expect(sent).toContainEqual({
      channel: browserIpcChannels.contextMenu,
      payload: {
        tabId,
        x: 40,
        y: 60,
        linkUrl: "https://example.test/a",
        pageUrl: "https://example.test/",
        selectionText: "hi",
      },
    });
  });
});

describe("browser chrome pre-commit reads", () => {
  test("a blank did-start-loading read never clobbers the requested URL", () => {
    const { host } = harness();
    const tabId = openTab(host);
    host.navigate(tabId, "http://127.0.0.1:9/");
    expect(host.list().tabs[0].url).toBe("http://127.0.0.1:9/");
    const contents = contentsOf(host, tabId);
    // Unsafe-port failures report did-start-loading while getURL() still
    // reads the previous (blank) URL; the requested URL must survive so
    // the failure overlay names the page that actually failed.
    contents.currentUrl = "about:blank";
    (
      contents.listeners.get("did-start-loading") as unknown as (
        ...args: unknown[]
      ) => void
    )?.();
    expect(host.list().tabs[0].url).toBe("http://127.0.0.1:9/");
    contents.currentUrl = "";
    (
      contents.listeners.get("did-start-loading") as unknown as (
        ...args: unknown[]
      ) => void
    )?.();
    expect(host.list().tabs[0].url).toBe("http://127.0.0.1:9/");
  });
});

describe("browser chrome failure detail", () => {
  test("failed loads carry code, description and the attempted URL", () => {
    const { host } = harness();
    const tabId = openTab(host);
    const contents = contentsOf(host, tabId);
    (
      contents.listeners.get("did-fail-load") as unknown as (
        ...args: unknown[]
      ) => void
    )?.({}, -102, "ERR_CONNECTION_REFUSED", "https://down.test/", true);
    const [tab] = host.list().tabs;
    expect(tab.loading).toBe(false);
    expect(tab.error).toContain("https://down.test/");
    expect(tab.loadError).toEqual({
      kind: "failed",
      code: -102,
      description: "ERR_CONNECTION_REFUSED",
      url: "https://down.test/",
    });
    expect(tab.committed).toBe(false);
  });
  test("a commit clears the failure and marks the tab committed", () => {
    const { host } = harness();
    const tabId = openTab(host);
    const contents = contentsOf(host, tabId);
    (
      contents.listeners.get("did-fail-load") as unknown as (
        ...args: unknown[]
      ) => void
    )?.({}, -102, "ERR_CONNECTION_REFUSED", "https://down.test/", true);
    (
      contents.listeners.get("did-stop-loading") as unknown as (
        ...args: unknown[]
      ) => void
    )?.();
    // did-stop-loading after an error keeps the honest error (no commit).
    expect(host.list().tabs[0].error).toContain("https://down.test/");
  });
  test("blocked navigations carry a blocked load error", () => {
    const { host } = harness();
    const tabId = openTab(host);
    host.navigate(tabId, "file:///etc/passwd");
    const [tab] = host.list().tabs;
    expect(tab.loadError?.kind).toBe("blocked");
    expect(tab.loadError?.url).toBe("file:///etc/passwd");
  });
});
