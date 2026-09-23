// Phase 1 preload: authority channel wiring. Each bridge method must hit
// the exact channel (and op envelope) its main-side gate listens on; a
// renamed channel or a rewritten op silently disconnects the authority
// path. Each test pins one (channel, payload) decision: the matching
// mutation renames the channel/op or drops a field and the test fails.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    handlers,
    ipcRenderer: {
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        handlers.set(channel, listener);
      }),
      removeListener: vi.fn((channel: string) => {
        handlers.delete(channel);
      }),
      invoke: vi.fn(),
    },
  };
});

vi.mock("electron", () => electron);

import { browserIpcChannels } from "../shared/browser-contract";
import { SHELL_OPEN_EXTERNAL_CHANNEL } from "../shared/shell-contract";

// Worker-reuse hermeticity (docs/reference/desktop-test-isolation.md): the
// desktop suite shares one module registry per worker, so statically
// imported bridges would stay bound to whichever file's `electron` mock won
// the import race (browser-state-replay.test.ts mocks the same module with
// an incompatible shape). Rebinding after a registry reset keeps the
// channel assertions below deterministic under any file order.
let automationBridge: typeof import("./automation").automationBridge;
let backups: typeof import("./backups").backups;
let browser: typeof import("./browser").browser;
let daemon: typeof import("./daemon").daemon;
let meetings: typeof import("./meetings").meetings;
let shell: typeof import("./shell").shell;

beforeAll(async () => {
  vi.resetModules();
  ({ automationBridge } = await import("./automation"));
  ({ backups } = await import("./backups"));
  ({ browser } = await import("./browser"));
  ({ daemon } = await import("./daemon"));
  ({ meetings } = await import("./meetings"));
  ({ shell } = await import("./shell"));
});

afterAll(() => {
  vi.resetModules();
});

describe("daemon restart authority rides its own gated channels", () => {
  it("restarts through drogon:daemon:restart with the input untouched", async () => {
    electron.ipcRenderer.invoke.mockResolvedValueOnce({ ok: true });
    await daemon.restart({ reason: "update-installed" } as never);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(
      "drogon:daemon:restart",
      { reason: "update-installed" },
    );
  });

  it("pulls update state through drogon:daemon:updateState", async () => {
    electron.ipcRenderer.invoke.mockResolvedValueOnce({ ok: true });
    await daemon.updateState();
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(
      "drogon:daemon:updateState",
    );
  });
});

describe("backups restore rides the bundled-CLI channel, never the daemon socket", () => {
  it.each([
    ["list", "list", {}],
    ["restore", "restore", { backupId: "b-1" }],
    ["relaunchApp", "relaunchApp", {}],
  ] as const)("backup %s sends op %s", async (method, op, extra) => {
    electron.ipcRenderer.invoke.mockResolvedValueOnce({ ok: true });
    if (method === "restore") await backups.restore("b-1");
    else if (method === "relaunchApp") await backups.relaunchApp();
    else await backups.list();
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith("drogon:backups", {
      op,
      ...extra,
    });
  });

  it("restore carries the exact backup id", async () => {
    electron.ipcRenderer.invoke.mockResolvedValueOnce({ ok: true });
    await backups.restore("backup-42");
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith("drogon:backups", {
      op: "restore",
      backupId: "backup-42",
    });
  });
});

describe("automation bridge op envelope matches main/automation-bridge.ts", () => {
  it.each([
    ["list", "list", {}],
    ["remove", "delete", { id: "a-1" }],
    ["runNow", "runNow", { id: "a-1" }],
  ] as const)("automation %s sends op %s", async (method, op, params) => {
    electron.ipcRenderer.invoke.mockResolvedValueOnce({ ok: true });
    if (method === "list") await automationBridge.list();
    else if (method === "remove") await automationBridge.remove({ id: "a-1" });
    else await automationBridge.runNow({ id: "a-1" });
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(
      "drogon:automation",
      { op, params },
    );
  });

  it("remove deletes, never re-sends a remove op main would ignore", async () => {
    electron.ipcRenderer.invoke.mockResolvedValueOnce({ ok: true });
    await automationBridge.remove({ id: "a-9" });
    const [, payload] = electron.ipcRenderer.invoke.mock.calls.at(-1)!;
    expect((payload as { op: string }).op).toBe("delete");
    expect((payload as { op: string }).op).not.toBe("remove");
  });
});

describe("meetings bridge op envelope and empty-params default", () => {
  it("list with no input still sends an object params envelope", async () => {
    electron.ipcRenderer.invoke.mockResolvedValueOnce({ ok: true });
    await meetings.list(undefined as never);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith("drogon:meetings", {
      op: "list",
      params: {},
    });
  });

  it("commitments with no input still sends an object params envelope", async () => {
    electron.ipcRenderer.invoke.mockResolvedValueOnce({ ok: true });
    await meetings.commitments(undefined as never);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith("drogon:meetings", {
      op: "commitments",
      params: {},
    });
  });

  it("read forwards its params untouched", async () => {
    electron.ipcRenderer.invoke.mockResolvedValueOnce({ ok: true });
    await meetings.read({ noteId: "n-1" } as never);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith("drogon:meetings", {
      op: "read",
      params: { noteId: "n-1" },
    });
  });
});

describe("shell external navigation uses the validated openExternal channel", () => {
  it("openExternal invokes drogon:openExternal with the URL", async () => {
    electron.ipcRenderer.invoke.mockResolvedValueOnce({ ok: true });
    await shell.openExternal("https://example.com/x" as never);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(
      SHELL_OPEN_EXTERNAL_CHANNEL,
      "https://example.com/x",
    );
  });
});

describe("browser tab authority hits the guest channels in main/browser", () => {
  it.each([
    ["createTab", browserIpcChannels.createTab, { workspaceId: "w-1" }],
    ["closeTab", browserIpcChannels.closeTab, { tabId: "t-1" }],
    ["navigate", browserIpcChannels.navigate, { tabId: "t-1", url: "https://x.test/" }],
  ] as const)("%s invokes %s with its payload", async (method, channel, payload) => {
    electron.ipcRenderer.invoke.mockResolvedValueOnce({ ok: true });
    await (browser[method] as (value: unknown) => unknown)(payload);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(channel, payload);
  });

  it("never replays a failed pull into the subscriber, even with a tab list present", async () => {
    electron.ipcRenderer.invoke.mockResolvedValue({
      ok: false,
      result: { tabs: [{ tabId: "t-1" }] },
    });
    const seen: unknown[] = [];
    browser.onState((event) => seen.push(event));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([]);
  });

  it("never replays an ok pull without a tab list into the subscriber", async () => {
    electron.ipcRenderer.invoke.mockResolvedValueOnce({ ok: true, result: {} });
    const seen: unknown[] = [];
    browser.onState((event) => seen.push(event));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([]);
  });

  it("unsubscribing onState removes its own wrapped listener", () => {
    electron.ipcRenderer.invoke.mockResolvedValue({ ok: false });
    const dispose = browser.onState(() => {});
    // Each onState wraps afresh, so re-derive the latest subscription.
    const latest = electron.ipcRenderer.on.mock.calls
      .filter(([channel]) => channel === browserIpcChannels.state)
      .at(-1)?.[1];
    dispose();
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(
      browserIpcChannels.state,
      latest,
    );
  });
});
