import { describe, expect, test, vi } from "vitest";
import type { BrowserBridge } from "../../../../shared/browser-contract";
import type { Result } from "../../../../shared/session-contract";
import {
  createBrowserAuthoritySource,
  readCaptureWindowOpen,
} from "./browser-bridge";

function stubCapture(value: boolean): void {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: () => (value ? "1" : "0"),
      setItem: () => {},
    },
  });
}

function fakeBridge(
  overrides: Partial<BrowserBridge> = {},
): BrowserBridge {
  const nope = () => Promise.resolve({ ok: false, error: { code: "x", message: "x", retryable: false } }) as Promise<Result<never>>;
  const okNull = () => Promise.resolve({ ok: true, result: null }) as Promise<Result<null>>;
  return {
    createTab: nope as BrowserBridge["createTab"],
    closeTab: nope as BrowserBridge["closeTab"],
    navigate: nope as BrowserBridge["navigate"],
    back: nope as BrowserBridge["back"],
    forward: nope as BrowserBridge["forward"],
    reload: nope as BrowserBridge["reload"],
    stop: nope as BrowserBridge["stop"],
    setBounds: () => Promise.resolve({ ok: true, result: null }),
    snapshot: nope as BrowserBridge["snapshot"],
    onState: () => () => {},
    getState: () =>
      Promise.resolve({ ok: true, result: { tabs: [], activeTabId: null } }) as ReturnType<
        BrowserBridge["getState"]
      >,
    hardReload: nope as BrowserBridge["hardReload"],
    zoomIn: nope as BrowserBridge["zoomIn"],
    zoomOut: nope as BrowserBridge["zoomOut"],
    zoomReset: nope as BrowserBridge["zoomReset"],
    findInPage: okNull as BrowserBridge["findInPage"],
    stopFind: okNull as BrowserBridge["stopFind"],
    openDevTools: okNull as BrowserBridge["openDevTools"],
    onFindResult: () => () => {},
    onContextMenu: () => () => {},
    onChord: () => () => {},
    ...overrides,
  };
}

describe("browser authority source", () => {
  test("allowed navigation proposes allow", async () => {
    stubCapture(false);
    const source = createBrowserAuthoritySource({
      bridge: fakeBridge({
        navigate: () =>
          Promise.resolve({
            ok: true,
            result: {
              tabId: "t1",
              workspaceId: "w1",
              url: "https://example.test/",
              title: "",
              loading: true,
              canGoBack: false,
              canGoForward: false,
              error: null,
            },
          }),
      }),
      workspaceId: () => "w1",
    });
    const decision = await source.requestNavigation({
      tabId: "t1",
      url: "https://example.test/",
      generation: 1,
    });
    expect(decision).toEqual({ ok: true, result: { outcome: "allow" } });
  });
  test("host policy refusal becomes a block proposal", async () => {
    stubCapture(false);
    const source = createBrowserAuthoritySource({
      bridge: fakeBridge({
        navigate: () =>
          Promise.resolve({
            ok: false,
            error: {
              code: "browser_blocked",
              message: "Blocked: scheme.",
              retryable: false,
            },
          }),
      }),
      workspaceId: () => "w1",
    });
    const decision = await source.requestNavigation({
      tabId: "t1",
      url: "file:///etc/passwd",
      generation: 1,
    });
    expect(decision).toEqual({
      ok: true,
      result: { outcome: "block", reason: "Blocked: scheme." },
    });
  });
  test("window-open routes into a pane tab only when captured", async () => {
    stubCapture(true);
    const createTab = vi.fn(() =>
      Promise.resolve({
        ok: true,
        result: {
          tabId: "t2",
          workspaceId: "w1",
          url: "https://example.test/",
          title: "",
          loading: true,
          canGoBack: false,
          canGoForward: false,
          error: null,
        },
      } as const),
    );
    const source = createBrowserAuthoritySource({
      bridge: fakeBridge({ createTab }),
      workspaceId: () => "w1",
    });
    const decision = await source.requestWindowOpen({
      tabId: "t1",
      url: "https://example.test/",
    });
    expect(createTab).toHaveBeenCalledWith({
      workspaceId: "w1",
      url: "https://example.test/",
    });
    expect(decision).toEqual({
      ok: true,
      result: { outcome: "allow", reason: "Opened in the Browser panel." },
    });
    expect(readCaptureWindowOpen()).toBe(true);
  });
  test("window-open proposes the system browser when not captured", async () => {
    stubCapture(false);
    const createTab = vi.fn();
    const source = createBrowserAuthoritySource({
      bridge: fakeBridge({
        createTab: createTab as unknown as BrowserBridge["createTab"],
      }),
      workspaceId: () => "w1",
    });
    const decision = await source.requestWindowOpen({
      tabId: "t1",
      url: "https://example.test/",
    });
    expect(createTab).not.toHaveBeenCalled();
    expect(decision).toEqual({
      ok: true,
      result: {
        outcome: "open-in-system",
        reason: expect.stringMatching(/system browser/),
      },
    });
  });
});
