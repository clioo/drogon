// R16-Y: `onState` replays the host's current tabs on subscribe, so a
// fresh subscriber (renderer reload, workspace reselect) sees open tabs
// immediately instead of waiting for the next host event.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

const { onMock, invokeMock, removeListenerMock } = vi.hoisted(() => ({
  onMock: vi.fn(),
  invokeMock: vi.fn(),
  removeListenerMock: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcRenderer: {
    on: onMock,
    invoke: invokeMock,
    removeListener: removeListenerMock,
  },
}));

import { browserIpcChannels } from "../shared/browser-contract";

// Worker-reuse hermeticity (docs/reference/desktop-test-isolation.md): the
// desktop suite shares one module registry per worker, so a statically
// imported bridge would stay bound to whichever file's `electron` mock won
// the import race (authority-channel-wiring.test.ts mocks the same module
// with an incompatible shape). Rebinding after a registry reset keeps the
// replay assertions below deterministic under any file order.
let browser: typeof import("./browser").browser;

beforeAll(async () => {
  vi.resetModules();
  ({ browser } = await import("./browser"));
});

afterAll(() => {
  vi.resetModules();
});

const STATE = {
  tabs: [
    {
      tabId: "browser-tab-1",
      workspaceId: "w1",
      url: "http://127.0.0.1:8931/index.html",
      title: "J4 Fixture Home",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: null,
    },
  ],
  activeTabId: "browser-tab-1",
};

describe("browser preload state replay", () => {
  test("onState subscribes and replays the pulled state", async () => {
    invokeMock.mockResolvedValueOnce({ ok: true, result: STATE });
    const seen: unknown[] = [];
    const unsubscribe = browser.onState((event) => seen.push(event));
    expect(onMock).toHaveBeenCalledWith(browserIpcChannels.state, expect.any(Function));
    expect(invokeMock).toHaveBeenCalledWith(browserIpcChannels.getState);
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([STATE]);
    unsubscribe();
    expect(removeListenerMock).toHaveBeenCalled();
  });

  test("a failed pull never calls the listener and never throws", async () => {
    invokeMock.mockRejectedValueOnce(new Error("gone"));
    const seen: unknown[] = [];
    browser.onState((event) => seen.push(event));
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([]);
  });

  test("live events still reach the listener", async () => {
    invokeMock.mockResolvedValueOnce({ ok: true, result: { tabs: [], activeTabId: null } });
    const seen: unknown[] = [];
    browser.onState((event) => seen.push(event));
    const wrapped = onMock.mock.calls[onMock.mock.calls.length - 1][1] as (
      event: unknown,
      state: unknown,
    ) => void;
    wrapped({}, STATE);
    expect(seen).toEqual([STATE]);
  });
});
