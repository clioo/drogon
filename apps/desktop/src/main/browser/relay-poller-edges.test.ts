import { describe, expect, test, vi } from "vitest";
import {
  dispatchRelayCommand,
  runRelayCycle,
  type RelayBrowserHost,
  type RelayDaemonCall,
} from "./relay-poller";

function tab(tabId: string, workspaceId = "w1") {
  return {
    tabId,
    workspaceId,
    url: "https://example.test/",
    title: "Example",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
  };
}

function stubHost(): RelayBrowserHost & {
  createTab: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
  snapshot: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  tabsForWorkspace: ReturnType<typeof vi.fn>;
} {
  return {
    createTab: vi.fn((_workspaceId: string) => tab("browser-tab-1", _workspaceId)),
    navigate: vi.fn((tabId: string) => tab(tabId)),
    snapshot: vi.fn(async (tabId: string) => ({
      tabId,
      url: "https://example.test/",
      title: "Example",
      text: "hello",
      truncated: false,
    })),
    click: vi.fn(async (tabId: string) => tab(tabId)),
    fill: vi.fn(async (tabId: string) => tab(tabId)),
    tabsForWorkspace: vi.fn(() => []),
  };
}

describe("relay dispatch edges", () => {
  test("an open refused for a missing window completes browser_unavailable", async () => {
    const host = stubHost();
    host.createTab.mockReturnValue({ blocked: "Browser window is not ready." });
    const outcome = await dispatchRelayCommand(host, {
      commandId: "relay-edge-1",
      kind: "browser.open",
      params: { workspaceId: "w1", url: "https://example.test/" },
    });
    expect(outcome).toEqual({
      ok: false,
      error: { code: "browser_unavailable", message: "Browser window is not ready." },
    });
  });
  test("every kind rejects params outside its contract without touching the host", async () => {
    const host = stubHost();
    const cases: { kind: "browser.open" | "browser.navigate" | "browser.snapshot" | "browser.click" | "browser.tabs"; params: Record<string, unknown>; message: string }[] = [
      { kind: "browser.open", params: {}, message: "Invalid browser.open params." },
      { kind: "browser.navigate", params: { tabId: "browser-tab-1" }, message: "Invalid browser.navigate params." },
      { kind: "browser.snapshot", params: {}, message: "Invalid browser.snapshot params." },
      { kind: "browser.click", params: { tabId: "browser-tab-1" }, message: "Invalid browser.click params." },
      { kind: "browser.tabs", params: {}, message: "Invalid browser.tabs params." },
    ];
    for (const [index, entry] of cases.entries()) {
      const outcome = await dispatchRelayCommand(host, {
        commandId: `relay-edge-${index}`,
        kind: entry.kind,
        params: entry.params,
      });
      expect(outcome).toEqual({
        ok: false,
        error: { code: "invalid_argument", message: entry.message },
      });
    }
    expect(host.createTab).not.toHaveBeenCalled();
    expect(host.navigate).not.toHaveBeenCalled();
    expect(host.snapshot).not.toHaveBeenCalled();
    expect(host.click).not.toHaveBeenCalled();
    expect(host.tabsForWorkspace).not.toHaveBeenCalled();
  });
  test("mentu.open without a wired opener is a typed refusal, never a pretend open", async () => {
    const host = stubHost();
    const outcome = await dispatchRelayCommand(host, {
      commandId: "relay-edge-mentu",
      kind: "mentu.open",
      params: { workspaceId: "w1" },
    });
    expect(outcome).toEqual({
      ok: false,
      error: {
        code: "mentu_open_unsupported",
        message: "This Drogon build has no Work Graph tab relay wired.",
      },
    });
    expect(host.createTab).not.toHaveBeenCalled();
  });
});

describe("relay cycle edges", () => {
  test("an unverifiable poll error throws so the poller backs off", async () => {
    const host = stubHost();
    const call: RelayDaemonCall = async () => ({
      ok: false as const,
      error: { code: "unverifiable", message: "relay lost", retryable: true },
    });
    await expect(runRelayCycle(host, call, "desktop-1")).rejects.toThrow("relay lost");
    expect(host.tabsForWorkspace).not.toHaveBeenCalled();
  });
  test("a poll answer outside the contract is logged, never dispatched", async () => {
    const host = stubHost();
    const completed: unknown[] = [];
    const call: RelayDaemonCall = vi.fn(async (method: string) => {
      if (method === "desktop.commands.poll")
        return { ok: true as const, result: { commands: "nope" } };
      completed.push(method);
      return { ok: true as const, result: {} };
    });
    await runRelayCycle(host, call, "desktop-1");
    expect(host.tabsForWorkspace).not.toHaveBeenCalled();
    expect(completed).toHaveLength(0);
  });
  test("a lost completion is logged, the cycle still resolves", async () => {
    const host = stubHost();
    const call: RelayDaemonCall = vi.fn(async (method: string) => {
      if (method === "desktop.commands.poll")
        return {
          ok: true as const,
          result: {
            commands: [{ commandId: "c1", kind: "browser.tabs", params: { workspaceId: "w1" } }],
          },
        };
      throw new Error("complete socket gone");
    });
    await runRelayCycle(host, call, "desktop-1");
    expect(host.tabsForWorkspace).toHaveBeenCalledWith("w1");
  });
});
