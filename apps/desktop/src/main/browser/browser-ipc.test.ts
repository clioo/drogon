import { beforeEach, describe, expect, test, vi } from "vitest";

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input?: unknown) => unknown>(),
}));

function makeGuestContents() {
  return {
    loadURL: () => undefined,
    stop: () => {},
    goBack: () => {},
    goForward: () => {},
    reload: () => {},
    reloadIgnoringCache: () => {},
    getURL: () => "https://example.test/",
    getTitle: () => "Example",
    executeJavaScript: () => Promise.resolve({ title: "Example", text: "hello" }),
    setBackgroundThrottling: () => {},
    navigationHistory: {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: () => {},
      goForward: () => {},
    },
    session: {
      setPermissionRequestHandler: () => {},
      setPermissionCheckHandler: () => {},
      on: () => {},
    },
    setWindowOpenHandler: () => {},
    on: () => {},
    off: () => {},
    getZoomLevel: () => 0,
    setZoomLevel: () => {},
    findInPage: () => 1,
    stopFindInPage: () => {},
    openDevTools: () => {},
  };
}

vi.mock("electron", () => ({
  ipcMain: {
    // Like the real ipcMain.handle: a second handler for a channel throws,
    // so the registered-once guard below is load-bearing, not cosmetic.
    handle: (channel: string, listener: (event: unknown, input?: unknown) => unknown) => {
      if (handlers.has(channel)) throw new Error(`second handler for ${channel}`);
      handlers.set(channel, listener);
    },
  },
  WebContentsView: function (this: unknown, _options: unknown) {
    return {
      webContents: makeGuestContents(),
      setBounds: () => {},
      setVisible: () => {},
    };
  },
}));

import { browserIpcChannels } from "../../shared/browser-contract";
import { registerBrowserIpc } from "./browser-ipc";

const appFrame = { mainFrame: {} };
const appContents = { send: () => {}, mainFrame: appFrame.mainFrame, id: 7 };
let liveWindow: {
  contentView: { addChildView: () => void; removeChildView: () => void };
  webContents: typeof appContents;
  getContentBounds: () => { width: number; height: number };
  on: () => void;
} | null = null;

function resetWindow(): void {
  liveWindow = {
    contentView: { addChildView: () => {}, removeChildView: () => {} },
    webContents: appContents,
    getContentBounds: () => ({ width: 1440, height: 900 }),
    on: () => {},
  };
}

function appEvent() {
  return { sender: appContents, senderFrame: appFrame.mainFrame };
}

function guestEvent() {
  return { sender: appContents, senderFrame: {} };
}

async function call(channel: string, event: unknown, input?: unknown) {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(event, input);
}

beforeEach(() => {
  resetWindow();
});

describe("browser IPC gates", () => {
  test("createTab serves the app main frame", async () => {
    registerBrowserIpc(() => liveWindow as never);
    const result = (await call(browserIpcChannels.createTab, appEvent(), {
      workspaceId: "ipc-w1",
      url: "https://example.test/",
    })) as { ok: boolean; result: { tabId: string; url: string } };
    expect(result.ok).toBe(true);
    expect(result.result.url).toBe("https://example.test/");
    expect(typeof result.result.tabId).toBe("string");
  });
  test("a guest frame sender is refused on every channel", async () => {
    const channels = [
      browserIpcChannels.createTab,
      browserIpcChannels.navigate,
      browserIpcChannels.back,
      browserIpcChannels.closeTab,
      browserIpcChannels.setBounds,
      browserIpcChannels.snapshot,
      browserIpcChannels.getState,
      browserIpcChannels.findInPage,
    ];
    for (const channel of channels) {
      const result = (await call(channel, guestEvent(), {
        workspaceId: "ipc-w1",
        tabId: "browser-tab-1",
        url: "https://example.test/",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        query: "q",
      })) as { ok: boolean; error: { code: string } };
      expect(result).toEqual({
        ok: false,
        error: { code: "invalid_argument", message: "Invalid desktop request.", retryable: false },
      });
    }
  });
  test("a missing window is refused before validation", async () => {
    liveWindow = null;
    const result = (await call(browserIpcChannels.navigate, appEvent(), {
      tabId: "browser-tab-1",
      url: "https://example.test/",
    })) as { ok: boolean; error: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("invalid_argument");
  });
  test("inputs outside the contract are refused", async () => {
    const bad: [string, unknown][] = [
      [browserIpcChannels.createTab, { url: "https://example.test/" }],
      [browserIpcChannels.navigate, { tabId: "browser-tab-1" }],
      [browserIpcChannels.back, {}],
      [browserIpcChannels.back, { tabId: 42 }],
      [browserIpcChannels.findInPage, { tabId: "browser-tab-1", query: "" }],
    ];
    for (const [channel, input] of bad) {
      const result = (await call(channel, appEvent(), input)) as {
        ok: boolean;
        error: { code: string };
      };
      expect(result.error.code).toBe("invalid_argument");
    }
  });
});

describe("browser IPC decisions", () => {
  test("a blocked-scheme navigation resolves per-tab, not as a transport error", async () => {
    const created = (await call(browserIpcChannels.createTab, appEvent(), {
      workspaceId: "ipc-blocked",
      url: "https://example.test/",
    })) as { ok: boolean; result: { tabId: string } };
    const tabId = created.result.tabId;
    const result = (await call(browserIpcChannels.navigate, appEvent(), {
      tabId,
      url: "file:///etc/passwd",
    })) as { ok: boolean; result: { error: string | null } };
    expect(result.ok).toBe(true);
    expect(result.result.error).toContain("file:");
  });
  test("requests for missing tabs map to browser_no_tab", async () => {
    const navigate = (await call(browserIpcChannels.navigate, appEvent(), {
      tabId: "browser-tab-missing",
      url: "https://example.test/",
    })) as { ok: boolean; error: { code: string; retryable: boolean } };
    expect(navigate).toEqual({
      ok: false,
      error: { code: "browser_no_tab", message: "Tab is not open.", retryable: false },
    });
    const close = (await call(browserIpcChannels.closeTab, appEvent(), {
      tabId: "browser-tab-missing",
    })) as { ok: boolean; error: { code: string } };
    expect(close.error.code).toBe("browser_no_tab");
  });
  test("a history dead end maps to browser_blocked, not browser_no_tab", async () => {
    const created = (await call(browserIpcChannels.createTab, appEvent(), {
      workspaceId: "ipc-history",
      url: "https://example.test/",
    })) as { ok: boolean; result: { tabId: string } };
    const result = (await call(browserIpcChannels.back, appEvent(), {
      tabId: created.result.tabId,
    })) as { ok: boolean; error: { code: string; message: string } };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("browser_blocked");
    expect(result.error.message).toBe("No earlier page in this tab.");
  });
  test("closeTab removes the tab; a second close reports it missing", async () => {
    const created = (await call(browserIpcChannels.createTab, appEvent(), {
      workspaceId: "ipc-close",
      url: "https://example.test/",
    })) as { ok: boolean; result: { tabId: string } };
    const tabId = created.result.tabId;
    expect(await call(browserIpcChannels.closeTab, appEvent(), { tabId })).toEqual({
      ok: true,
      result: null,
    });
    const again = (await call(browserIpcChannels.closeTab, appEvent(), { tabId })) as {
      ok: boolean;
      error: { code: string };
    };
    expect(again.error.code).toBe("browser_no_tab");
  });
  test("setBounds and getState answer the pane", async () => {
    const created = (await call(browserIpcChannels.createTab, appEvent(), {
      workspaceId: "ipc-bounds",
      url: "https://example.test/",
    })) as { ok: boolean; result: { tabId: string } };
    expect(
      await call(browserIpcChannels.setBounds, appEvent(), {
        tabId: created.result.tabId,
        bounds: { x: 0, y: 0, width: 400, height: 300 },
      }),
    ).toEqual({ ok: true, result: null });
    const state = (await call(browserIpcChannels.getState, appEvent())) as {
      ok: boolean;
      result: { tabs: unknown[]; activeTabId: string | null };
    };
    expect(state.ok).toBe(true);
    expect(state.result.tabs.length).toBeGreaterThan(0);
    expect(typeof state.result.activeTabId).toBe("string");
  });
  test("snapshot on a missing tab reports it missing; find codes pass through", async () => {
    const snapshot = (await call(browserIpcChannels.snapshot, appEvent(), {
      tabId: "browser-tab-missing",
    })) as { ok: boolean; error: { code: string } };
    expect(snapshot.error.code).toBe("browser_no_tab");
    const findMissing = (await call(browserIpcChannels.findInPage, appEvent(), {
      tabId: "browser-tab-missing",
      query: "hello",
    })) as { ok: boolean; error: { code: string } };
    // The host's explicit browser_no_tab code crosses the boundary verbatim.
    expect(findMissing.error.code).toBe("browser_no_tab");
    const created = (await call(browserIpcChannels.createTab, appEvent(), {
      workspaceId: "ipc-find",
      url: "https://example.test/",
    })) as { ok: boolean; result: { tabId: string } };
    const stopMissing = (await call(browserIpcChannels.stopFind, appEvent(), {
      tabId: "browser-tab-missing",
    })) as { ok: boolean; error: { code: string } };
    expect(stopMissing.error.code).toBe("browser_no_tab");
    const devtoolsMissing = (await call(browserIpcChannels.openDevTools, appEvent(), {
      tabId: "browser-tab-missing",
    })) as { ok: boolean; error: { code: string } };
    expect(devtoolsMissing.error.code).toBe("browser_no_tab");
    expect(created.ok).toBe(true);
  });
  test("a second registration wires no new handlers", async () => {
    const before = handlers.size;
    expect(before).toBeGreaterThan(0);
    let host;
    expect(() => {
      host = registerBrowserIpc(() => liveWindow as never);
    }).not.toThrow();
    expect(handlers.size).toBe(before);
    expect((host as unknown as { list(): { tabs: unknown[] } }).list().tabs).toEqual([]);
  });
});
