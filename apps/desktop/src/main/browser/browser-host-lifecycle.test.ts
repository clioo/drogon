import { describe, expect, test } from "vitest";
import {
  BrowserHost,
  zoomPercentForLevel,
  type BrowserParentWindowLike,
  type GuestContentsLike,
  type GuestViewLike,
} from "./browser-host";

type FakeContents = {
  listeners: Map<string, (...args: unknown[]) => void>;
  loaded: string[];
  getURLValue: string;
  loadBehavior: "sync" | "throw" | "reject-aborted" | "reject-generic";
  canGoBack: boolean;
  canGoForward: boolean;
  goBackThrow: boolean;
  goForwardThrow: boolean;
  goBackCalls: number;
  stopThrow: boolean;
  zoomLevel: number;
  setZoomCalls: number[];
  scriptImpl: ((code: string) => Promise<unknown>) | null;
  scriptThrow: boolean;
  findThrow: boolean;
  found: { text: string; options?: unknown }[];
  stopFindThrow: boolean;
  devtoolsThrow: boolean;
  devtoolsOpened: number;
  offCalls: string[];
  view: GuestViewLike;
  contents: GuestContentsLike;
};

function makeContents(): FakeContents {
  const fake = {} as FakeContents;
  fake.listeners = new Map();
  fake.loaded = [];
  fake.getURLValue = "https://a.test/";
  fake.loadBehavior = "sync";
  fake.canGoBack = false;
  fake.canGoForward = false;
  fake.goBackThrow = false;
  fake.goForwardThrow = false;
  fake.goBackCalls = 0;
  fake.stopThrow = false;
  fake.zoomLevel = 0;
  fake.setZoomCalls = [];
  fake.scriptImpl = null;
  fake.scriptThrow = false;
  fake.findThrow = false;
  fake.found = [];
  fake.stopFindThrow = false;
  fake.devtoolsThrow = false;
  fake.devtoolsOpened = 0;
  fake.offCalls = [];
  const contents = {
    loadURL(url: string) {
      fake.loaded.push(url);
      if (fake.loadBehavior === "throw") throw new Error("load blew up");
      if (fake.loadBehavior === "reject-aborted")
        return Promise.reject(new Error("ERR_ABORTED (-3)"));
      if (fake.loadBehavior === "reject-generic")
        return Promise.reject(new Error("net down"));
      return undefined;
    },
    stop() {
      if (fake.stopThrow) throw new Error("stop blew up");
    },
    goBack() {},
    goForward() {},
    reload() {},
    reloadIgnoringCache() {},
    getURL: () => fake.getURLValue,
    getTitle: () => "Tab title",
    executeJavaScript: (code: string) => {
      if (fake.scriptThrow) return Promise.reject(new Error("no script"));
      if (fake.scriptImpl) return fake.scriptImpl(code);
      return Promise.resolve({ ok: true });
    },
    setBackgroundThrottling: () => {},
    navigationHistory: {
      canGoBack: () => fake.canGoBack,
      canGoForward: () => fake.canGoForward,
      goBack: () => {
        fake.goBackCalls += 1;
        if (fake.goBackThrow) throw new Error("no back");
      },
      goForward: () => {
        if (fake.goForwardThrow) throw new Error("no forward");
      },
    },
    session: {
      setPermissionRequestHandler: () => {},
      setPermissionCheckHandler: () => {},
      on: () => {},
    },
    setWindowOpenHandler: () => {},
    on: (event: string, listener: (...args: never[]) => void) => {
      fake.listeners.set(event, listener as (...args: unknown[]) => void);
    },
    off: (event: string) => {
      fake.offCalls.push(event);
    },
    getZoomLevel: () => fake.zoomLevel,
    setZoomLevel: (level: number) => {
      fake.setZoomCalls.push(level);
      fake.zoomLevel = level;
    },
    findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean }) => {
      if (fake.findThrow) throw new Error("no find");
      fake.found.push({ text, options });
      return fake.found.length;
    },
    stopFindInPage: () => {
      if (fake.stopFindThrow) throw new Error("no stop-find");
    },
    openDevTools: () => {
      if (fake.devtoolsThrow) throw new Error("no devtools");
      fake.devtoolsOpened += 1;
    },
  } as unknown as GuestContentsLike;
  fake.contents = contents;
  fake.view = {
    webContents: contents,
    setBounds: () => {},
    setVisible: () => {},
  };
  return fake;
}

function harness(getWindow?: () => BrowserParentWindowLike | null) {
  const sent: { channel: string; payload: unknown }[] = [];
  const removed: GuestViewLike[] = [];
  const fakes: FakeContents[] = [];
  const window: BrowserParentWindowLike = {
    contentView: {
      addChildView: () => {},
      removeChildView: (view) => { removed.push(view as GuestViewLike); },
    },
    webContents: {
      send: (channel, payload) => { sent.push({ channel, payload }); },
      id: 7,
    },
    getContentBounds: () => ({ width: 1440, height: 900 }),
    on: () => {},
  };
  const host = new BrowserHost(getWindow ?? (() => window), () => {
    const fake = makeContents();
    fakes.push(fake);
    return fake.view;
  });
  return { host, window, sent, removed, fakes };
}

function emit(fake: FakeContents, event: string, ...args: unknown[]): void {
  fake.listeners.get(event)?.(...args);
}

function openTab(h: ReturnType<typeof harness>, url = "https://a.test/"): string {
  const created = h.host.createTab("w1", url);
  if (!("tabId" in created)) throw new Error(`expected a tab, got ${JSON.stringify(created)}`);
  return created.tabId;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("browser tab lifecycle (close and crashed panes)", () => {
  test("createTab without a window is refused, never constructed", () => {
    const h = harness(() => null);
    expect(h.host.createTab("w1", "https://a.test/")).toEqual({
      blocked: "Browser window is not ready.",
    });
    expect(h.fakes).toHaveLength(0);
  });
  test("the per-workspace tab limit refuses the overflow tab", () => {
    const h = harness();
    for (let i = 0; i < 16; i += 1) openTab(h);
    expect(h.host.createTab("w1", "https://a.test/")).toEqual({
      blocked: "Tab limit reached (16).",
    });
    // Another workspace still has room: the limit scopes per workspace.
    expect("tabId" in h.host.createTab("w2", "https://a.test/")).toBe(true);
  });
  test("closing an unknown tab is false; closing twice is false the second time", () => {
    const h = harness();
    expect(h.host.closeTab("ghost")).toBe(false);
    const tabId = openTab(h);
    expect(h.host.closeTab(tabId)).toBe(true);
    expect(h.removed).toHaveLength(1);
    expect(h.host.closeTab(tabId)).toBe(false);
  });
  test("close drops the chord forwarder even when the guest is mid-teardown", () => {
    const h = harness();
    const tabId = openTab(h);
    const fake = h.fakes[0];
    fake.stopFindThrow = true;
    expect(h.host.closeTab(tabId)).toBe(true);
    expect(fake.offCalls).toContain("before-input-event");
  });
  test("a commit landing after close never resurrects the tab", () => {
    const h = harness();
    const tabId = openTab(h);
    const fake = h.fakes[0];
    expect(h.host.closeTab(tabId)).toBe(true);
    // A dropped late event does no work at all: no state broadcast either.
    const sentAfterClose = h.sent.length;
    emit(fake, "did-navigate", {}, "https://a.test/");
    emit(fake, "did-fail-load", {}, -2, "failed", "https://a.test/", true);
    expect(h.host.list().tabs).toHaveLength(0);
    expect(h.sent.length).toBe(sentAfterClose);
  });
});

describe("browser navigation decisions", () => {
  test.each([
    ["navigate", (h: ReturnType<typeof harness>) => h.host.navigate("ghost", "https://a.test/")],
    ["back", (h: ReturnType<typeof harness>) => h.host.back("ghost")],
    ["forward", (h: ReturnType<typeof harness>) => h.host.forward("ghost")],
    ["reload", (h: ReturnType<typeof harness>) => h.host.reload("ghost")],
    ["stop", (h: ReturnType<typeof harness>) => h.host.stop("ghost")],
    ["hardReload", (h: ReturnType<typeof harness>) => h.host.hardReload("ghost")],
    ["zoomIn", (h: ReturnType<typeof harness>) => h.host.zoomIn("ghost")],
  ] as const)("a missing tab reports it on %s, never throws", (_name, run) => {
    const h = harness();
    expect(run(h)).toEqual({ blocked: "Tab is not open." });
  });
  test("back/forward without history report the dead end", () => {
    const h = harness();
    const tabId = openTab(h);
    expect(h.host.back(tabId)).toEqual({ blocked: "No earlier page in this tab." });
    expect(h.host.forward(tabId)).toEqual({ blocked: "No later page in this tab." });
  });
  test("a history throw reports the refusal, never a jump", () => {
    const h = harness();
    const tabId = openTab(h);
    h.fakes[0].canGoBack = true;
    h.fakes[0].goBackThrow = true;
    expect(h.host.back(tabId)).toEqual({ blocked: "The page could not go back." });
    h.fakes[0].canGoForward = true;
    h.fakes[0].goForwardThrow = true;
    expect(h.host.forward(tabId)).toEqual({ blocked: "The page could not go forward." });
  });
  test("back with history drives the guest and returns the tab", () => {
    const h = harness();
    const tabId = openTab(h);
    h.fakes[0].canGoBack = true;
    const result = h.host.back(tabId);
    expect(h.fakes[0].goBackCalls).toBe(1);
    expect("tabId" in result && result.tabId).toBe(tabId);
  });
  test("stop settles back to the committed page; late commits are dropped", () => {
    const h = harness();
    const tabId = openTab(h, "https://a.test/");
    const committed = h.host.navigate(tabId, "https://a.test/");
    expect("tabId" in committed).toBe(true);
    h.fakes[0].getURLValue = "https://a.test/";
    const stopped = h.host.stop(tabId);
    expect("tabId" in stopped).toBe(true);
    emit(h.fakes[0], "did-navigate", {}, "https://b.test/");
    expect(h.host.list().tabs[0]?.url).toBe("https://a.test/");
  });
  test("a stop the guest refuses reports the refusal", () => {
    const h = harness();
    const tabId = openTab(h);
    h.fakes[0].stopThrow = true;
    expect(h.host.stop(tabId)).toEqual({ blocked: "The page could not be stopped." });
  });
  test("an aborted load is a stop, not an error", async () => {
    const h = harness();
    const created = h.host.createTab("w1", "https://a.test/");
    expect("tabId" in created).toBe(true);
    // The next request aborts mid-flight: ERR_ABORTED must take the -3 path.
    h.fakes[0].loadBehavior = "reject-aborted";
    const second = h.host.navigate((created as { tabId: string }).tabId, "https://b.test/");
    expect("tabId" in second).toBe(true);
    await tick();
    await tick();
    const tab = h.host.list().tabs[0];
    expect(tab?.loading).toBe(false);
    expect(tab?.error).toBeNull();
  });
  test("a load the guest throws on surfaces an honest error", () => {
    const h = harness();
    const created = h.host.createTab("w1", "https://a.test/");
    expect("tabId" in created).toBe(true);
    h.fakes[0].loadBehavior = "throw";
    const tabId = (created as { tabId: string }).tabId;
    const moved = h.host.navigate(tabId, "https://b.test/");
    expect("tabId" in moved).toBe(true);
    const tab = h.host.list().tabs.find((entry) => entry.tabId === tabId);
    expect(tab?.loading).toBe(false);
    expect(tab?.error).toContain("https://b.test/");
  });
  test("did-stop-loading never moves the address bar while a request is pending", () => {
    const h = harness();
    const tabId = openTab(h, "https://a.test/");
    h.fakes[0].getURLValue = "https://a.test/";
    h.host.navigate(tabId, "https://b.test/");
    emit(h.fakes[0], "did-stop-loading");
    // Readiness belongs to the commit/failure events: the tab is still
    // loading the requested URL, not ready with the outgoing page's URL.
    const tab = h.host.list().tabs[0];
    expect(tab?.url).toBe("https://b.test/");
    expect(tab?.loading).toBe(true);
  });
  test("sub-frame navigation and failure events are ignored", () => {
    const h = harness();
    const tabId = openTab(h, "https://a.test/");
    emit(h.fakes[0], "did-navigate", {}, "https://a.test/");
    emit(h.fakes[0], "did-start-navigation", {}, "https://evil.test/", false, false);
    emit(h.fakes[0], "did-frame-navigate", {}, "https://evil.test/", 200, "OK", false);
    emit(h.fakes[0], "did-fail-load", {}, -2, "failed", "https://evil.test/", false);
    const tab = h.host.list().tabs.find((entry) => entry.tabId === tabId);
    expect(tab?.url).toBe("https://a.test/");
    expect(tab?.error).toBeNull();
  });
  test("a redirect retargets the pending navigation before commit", () => {
    const h = harness();
    const tabId = openTab(h, "https://a.test/start");
    emit(h.fakes[0], "did-redirect-navigation", {}, "https://a.test/landed", false, true);
    emit(h.fakes[0], "did-navigate", {}, "https://a.test/landed");
    expect(h.host.list().tabs.find((entry) => entry.tabId === tabId)?.url).toBe(
      "https://a.test/landed",
    );
  });
  test("an in-page navigation commits without a pending request", () => {
    const h = harness();
    const tabId = openTab(h, "https://a.test/");
    emit(h.fakes[0], "did-navigate", {}, "https://a.test/");
    emit(h.fakes[0], "did-navigate-in-page", {}, "https://a.test/#frag", true);
    const tab = h.host.list().tabs.find((entry) => entry.tabId === tabId);
    expect(tab?.url).toBe("https://a.test/#frag");
    expect(tab?.committed).toBe(true);
  });
  test("a commit for a superseded navigation is dropped", () => {
    const h = harness();
    const tabId = openTab(h, "https://a.test/");
    h.host.navigate(tabId, "https://b.test/");
    emit(h.fakes[0], "did-start-navigation", {}, "https://b.test/", false, true);
    emit(h.fakes[0], "did-navigate", {}, "https://a.test/");
    expect(h.host.list().tabs.find((entry) => entry.tabId === tabId)?.url).toBe(
      "https://b.test/",
    );
  });
  test("titles longer than the strip budget are cut on arrival", () => {
    const h = harness();
    const tabId = openTab(h);
    emit(h.fakes[0], "page-title-updated", {}, `T${"x".repeat(400)}`);
    expect(h.host.list().tabs[0]?.title).toHaveLength(256);
  });
});

describe("browser zoom, automation and reads", () => {
  test("zoom steps clamp to the guest range and report percents", () => {
    expect(zoomPercentForLevel(0)).toBe(100);
    expect(zoomPercentForLevel(1)).toBe(120);
    expect(zoomPercentForLevel(8)).toBe(430);
    const h = harness();
    const tabId = openTab(h);
    h.fakes[0].zoomLevel = 8;
    const capped = h.host.zoomIn(tabId);
    expect(h.fakes[0].setZoomCalls.at(-1)).toBe(8);
    expect("zoomPercent" in capped && capped.zoomPercent).toBe(430);
    const reset = h.host.zoomReset(tabId);
    expect(h.fakes[0].setZoomCalls.at(-1)).toBe(0);
    expect("zoomPercent" in reset && reset.zoomPercent).toBe(100);
  });
  test("click rejects hostile selectors before touching the guest", async () => {
    const h = harness();
    const tabId = openTab(h);
    for (const selector of ["", "a\0b", `#${"x".repeat(1024)}`]) {
      const result = await h.host.click(tabId, selector);
      expect(result).toEqual({ blocked: "Invalid CSS selector.", code: "invalid_argument" });
    }
    expect(h.fakes[0].loaded).toHaveLength(1);
  });
  test("a guest that refuses script evaluation reports blocked, never throws", async () => {
    const h = harness();
    const tabId = openTab(h);
    h.fakes[0].scriptThrow = true;
    const clicked = await h.host.click(tabId, "#a");
    expect(clicked).toEqual({
      blocked: "The page refused script evaluation.",
      code: "browser_blocked",
    });
    const filled = await h.host.fill(tabId, "#a", "text");
    expect(filled).toEqual({
      blocked: "The page refused script evaluation.",
      code: "browser_blocked",
    });
  });
  test("guest verdict details never echo past 256 chars", async () => {
    const h = harness();
    const tabId = openTab(h);
    h.fakes[0].scriptImpl = () => Promise.resolve({ ok: false, error: `x${"y".repeat(500)}` });
    const result = (await h.host.click(tabId, "#a")) as { blocked: string; code?: string };
    expect(result.code).toBe("browser_blocked");
    expect(result.blocked).toHaveLength(256);
  });
  test("a silent guest verdict reports the missing confirmation", async () => {
    const h = harness();
    const tabId = openTab(h);
    h.fakes[0].scriptImpl = () => Promise.resolve({ ok: false });
    expect(await h.host.click(tabId, "#a")).toEqual({
      blocked: "The page did not confirm the interaction.",
      code: "browser_blocked",
    });
  });
  test("fill enforces the text budget", async () => {
    const h = harness();
    const tabId = openTab(h);
    const result = await h.host.fill(tabId, "#a", `x${"y".repeat(8192)}`);
    expect(result).toEqual({
      blocked: "Fill text exceeds the budget.",
      code: "invalid_argument",
    });
  });
  test("snapshot truncates long pages and survives refused scripts", async () => {
    const h = harness();
    const tabId = openTab(h);
    h.fakes[0].scriptImpl = () =>
      Promise.resolve({ title: `T${"i".repeat(400)}`, text: `x${"y".repeat(40000)}` });
    const snapshot = (await h.host.snapshot(tabId)) as {
      title: string;
      text: string;
      truncated: boolean;
    };
    expect(snapshot.title).toHaveLength(256);
    expect(snapshot.text).toHaveLength(32768);
    expect(snapshot.truncated).toBe(true);
    emit(h.fakes[0], "page-title-updated", {}, "Real title");
    h.fakes[0].scriptThrow = true;
    const fallback = (await h.host.snapshot(tabId)) as { url: string; title: string };
    expect(fallback.url).toBe("https://a.test/");
    expect(fallback.title).toBe("Real title");
  });
  test("snapshot on a missing tab is blocked", async () => {
    const h = harness();
    expect(await h.host.snapshot("ghost")).toEqual({ blocked: "Tab is not open." });
  });
  test("find, stop-find and devtools refusals map to blocked", () => {
    const h = harness();
    const tabId = openTab(h);
    expect(h.host.findInPage(tabId, "")).toEqual({
      blocked: "Nothing to find.",
      code: "invalid_argument",
    });
    expect(h.fakes[0].found).toHaveLength(0);
    h.fakes[0].findThrow = true;
    h.fakes[0].stopFindThrow = true;
    h.fakes[0].devtoolsThrow = true;
    expect(h.host.findInPage(tabId, "q")).toEqual({
      blocked: "The page refused find-in-page.",
      code: "browser_blocked",
    });
    expect(h.host.stopFind(tabId)).toEqual({
      blocked: "The page refused find-in-page.",
      code: "browser_blocked",
    });
    expect(h.host.openDevTools(tabId)).toEqual({
      blocked: "Devtools could not be opened.",
      code: "browser_blocked",
    });
  });
  test("focus and bounds route to the right tab", () => {
    const h = harness();
    expect(h.host.focusTab("ghost")).toBe(false);
    const tabId = openTab(h);
    expect(h.host.focusTab(tabId)).toBe(true);
    expect(h.host.list().activeTabId).toBe(tabId);
    h.host.setBounds(undefined, { x: 100, y: 50, width: 200, height: 200 });
    emit(h.fakes[0], "context-menu", {}, { x: 10, y: 20, linkURL: "", pageURL: "" });
    const menu = h.sent.find((entry) => entry.channel === "drogon:browserContextMenu");
    expect(menu).toBeDefined();
    expect(menu?.payload).toMatchObject({ tabId, x: 110, y: 70 });
  });
});
