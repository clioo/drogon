import { describe, expect, test, vi } from "vitest";
import { buildClickScript, buildFillScript } from "./browser-host";
import {
  baseBackoffMs,
  dispatchRelayCommand,
  nextBackoff,
  runRelayCycle,
  type RelayBrowserHost,
  type RelayDaemonCall,
} from "./relay-poller";
import type { BrowserTabState } from "../../shared/browser-contract";

// Runs a guest script against a stub DOM. The scripts only touch
// `document`, `HTMLInputElement`, `HTMLTextAreaElement` and `Event`, so a
// small stub proves the real behavior: selection, click, value set, events.
class FakeInput {
  value = "";
  focused = false;
  events: string[] = [];
  clicked = false;
  focus(): void {
    this.focused = true;
  }
  click(): void {
    this.clicked = true;
  }
  dispatchEvent(event: { type: string }): boolean {
    this.events.push(event.type);
    return true;
  }
}
class FakeTextArea extends FakeInput {}
class FakeEvent {
  type: string;
  constructor(type: string, _opts?: unknown) {
    this.type = type;
  }
}

function runGuest(
  script: string,
  querySelector: (selector: string) => unknown,
): unknown {
  const run = new Function(
    "document",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "Event",
    `return ${script}`,
  ) as (
    document: unknown,
    HTMLInputElement: unknown,
    HTMLTextAreaElement: unknown,
    Event: unknown,
  ) => unknown;
  const document = { querySelector };
  return run(document, FakeInput, FakeTextArea, FakeEvent);
}

function tab(tabId = "browser-tab-1", workspaceId = "w1"): BrowserTabState {
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
} {
  return {
    createTab: vi.fn((workspaceId: string) => tab("browser-tab-1", workspaceId)),
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
    tabsForWorkspace: vi.fn((workspaceId: string) => [
      tab("browser-tab-1", workspaceId),
      tab("browser-tab-9", "other"),
    ].filter((entry) => entry.workspaceId === workspaceId)),
  };
}

describe("guest click/fill scripts", () => {
  test("click script clicks the match and confirms without echo", () => {
    let seen = "";
    const clicked = { clicked: false };
    const result = runGuest(buildClickScript("#go"), (selector) => {
      seen = selector;
      return { click: () => { clicked.clicked = true; } };
    });
    expect(seen).toBe("#go");
    expect(clicked.clicked).toBe(true);
    expect(result).toEqual({ ok: true });
  });

  test("click script reports a miss and a bad selector distinctly", () => {
    expect(runGuest(buildClickScript("#missing"), () => null)).toEqual({
      ok: false,
      error: "no element matches selector",
    });
    expect(
      runGuest(buildClickScript("#bad"), () => {
        throw new Error("SyntaxError");
      }),
    ).toEqual({ ok: false, error: "invalid selector" });
  });

  test("hostile selector text stays a string literal, never code", () => {
    const hostile = `a"b\nc');alert(1);//`;
    let seen: unknown;
    const result = runGuest(buildClickScript(hostile), (selector) => {
      seen = selector;
      return { click: () => {} };
    });
    expect(seen).toBe(hostile);
    expect(result).toEqual({ ok: true });
    expect(buildClickScript(hostile)).toContain(JSON.stringify(hostile));
  });

  test("fill script sets the value verbatim and fires input/change", () => {
    const hostileText = `Ada "L" <b>&\nnewline`;
    const element = new FakeInput();
    let seen = "";
    const result = runGuest(buildFillScript("#name", hostileText), (selector) => {
      seen = selector;
      return element;
    });
    expect(seen).toBe("#name");
    expect(element.value).toBe(hostileText);
    expect(element.focused).toBe(true);
    expect(element.events).toEqual(["input", "change"]);
    expect(result).toEqual({ ok: true });
  });

  test("fill script handles contentEditable and refuses the rest", () => {
    const editable = { isContentEditable: true, textContent: "", focused: false, events: [] as string[],
      focus() { this.focused = true; },
      dispatchEvent(event: { type: string }) { this.events.push(event.type); return true; } };
    expect(runGuest(buildFillScript("#ed", "hi"), () => editable)).toEqual({ ok: true });
    expect(editable.textContent).toBe("hi");
    expect(editable.events).toEqual(["input"]);
    expect(runGuest(buildFillScript("#div", "hi"), () => ({}))).toEqual({
      ok: false,
      error: "element is not fillable",
    });
  });
});

describe("relay dispatch", () => {
  test("open creates a tab and returns it", async () => {
    const host = stubHost();
    const outcome = await dispatchRelayCommand(host, {
      commandId: "relay-1",
      kind: "browser.open",
      params: { workspaceId: "w1", url: "https://example.test/" },
    });
    expect(host.createTab).toHaveBeenCalledWith("w1", "https://example.test/");
    expect(outcome).toEqual({ ok: true, result: tab("browser-tab-1", "w1") });
  });

  test("navigate maps a missing tab to browser_no_tab", async () => {
    const host = stubHost();
    host.navigate.mockReturnValue({ blocked: "Tab is not open." });
    const outcome = await dispatchRelayCommand(host, {
      commandId: "relay-2",
      kind: "browser.navigate",
      params: { tabId: "browser-tab-9", url: "https://example.test/" },
    });
    expect(outcome).toEqual({
      ok: false,
      error: { code: "browser_no_tab", message: "Tab is not open." },
    });
  });

  test("fill rejects bad params without touching the host", async () => {
    const host = stubHost();
    const outcome = await dispatchRelayCommand(host, {
      commandId: "relay-3",
      kind: "browser.fill",
      params: { tabId: "browser-tab-1", selector: "#a" },
    });
    expect(outcome).toEqual({
      ok: false,
      error: { code: "invalid_argument", message: "Invalid browser.fill params." },
    });
    expect(host.fill).not.toHaveBeenCalled();
  });

  test("host blocked codes pass through to the completion", async () => {
    const host = stubHost();
    host.click.mockResolvedValue({ blocked: "no element matches selector", code: "browser_blocked" });
    const outcome = await dispatchRelayCommand(host, {
      commandId: "relay-4",
      kind: "browser.click",
      params: { tabId: "browser-tab-1", selector: "#missing" },
    });
    expect(outcome).toEqual({
      ok: false,
      error: { code: "browser_blocked", message: "no element matches selector" },
    });
  });

  test("tabs returns only the requested workspace", async () => {
    const host = stubHost();
    const outcome = await dispatchRelayCommand(host, {
      commandId: "relay-5",
      kind: "browser.tabs",
      params: { workspaceId: "w1" },
    });
    expect(outcome).toEqual({ ok: true, result: { tabs: [tab("browser-tab-1", "w1")] } });
  });

  test("unknown kinds never throw; they complete invalid_argument", async () => {
    const host = stubHost();
    const outcome = await dispatchRelayCommand(host, {
      commandId: "relay-6",
      kind: "browser.time-travel",
      params: {},
    } as unknown as Parameters<typeof dispatchRelayCommand>[1]);
    expect(outcome.ok).toBe(false);
    expect((outcome as { ok: false; error: { code: string } }).error.code).toBe(
      "invalid_argument",
    );
  });
});

describe("relay cycle", () => {
  test("one cycle polls, dispatches and completes each command", async () => {
    const host = stubHost();
    const completed: unknown[] = [];
    const call: RelayDaemonCall = vi.fn(async (method: string) => {
      if (method === "desktop.commands.poll")
        return {
          ok: true as const,
          result: {
            commands: [
              {
                commandId: "relay-1",
                kind: "browser.snapshot",
                params: { tabId: "browser-tab-1" },
              },
              {
                commandId: "relay-2",
                kind: "browser.tabs",
                params: { workspaceId: "w1" },
              },
            ],
          },
        };
      completed.push(method);
      return { ok: true as const, result: {} };
    });
    await runRelayCycle(host, call, "desktop-1");
    expect(host.snapshot).toHaveBeenCalledWith("browser-tab-1");
    expect(call).toHaveBeenCalledTimes(3);
    const completeCalls = (call as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([method]) => method === "desktop.commands.complete",
    );
    expect(completeCalls).toHaveLength(2);
    expect(completeCalls[0][1]).toMatchObject({ commandId: "relay-1", ok: true });
    expect(completeCalls[1][1]).toMatchObject({ commandId: "relay-2", ok: true });
    expect(completed).toHaveLength(2);
  });

  test("transport loss throws so the poller backs off", async () => {
    const host = stubHost();
    const call: RelayDaemonCall = async () => {
      throw new Error("socket gone");
    };
    await expect(runRelayCycle(host, call, "desktop-1")).rejects.toThrow("socket gone");
  });

  test("a refused poll is logged, not thrown", async () => {
    const host = stubHost();
    const call: RelayDaemonCall = async () => ({
      ok: false as const,
      error: { code: "unauthorized", message: "no", retryable: false },
    });
    await runRelayCycle(host, call, "desktop-1");
    expect(host.snapshot).not.toHaveBeenCalled();
  });
});

describe("reconnect backoff", () => {
  test("doubles from the base and caps", () => {
    expect(baseBackoffMs()).toBe(1_000);
    expect(nextBackoff(1_000)).toBe(2_000);
    expect(nextBackoff(8_000)).toBe(15_000);
    expect(nextBackoff(15_000)).toBe(15_000);
  });
});
