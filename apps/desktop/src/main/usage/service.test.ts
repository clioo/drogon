import { beforeEach, describe, expect, test, vi } from "vitest";
import type { UsageSnapshot } from "../../shared/usage-contract";

const { handlers, windows } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input?: unknown) => unknown>(),
  windows: [] as { webContents: { mainFrame: object } }[],
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, input?: unknown) => unknown) => {
      handlers.set(channel, listener);
    },
  },
  BrowserWindow: { getAllWindows: () => windows },
}));

import { disposeUsage, getUsageStore, registerUsageIpc, setUsageStore } from "./service";
import type { UsageStore } from "./store";

function mainFrameEvent() {
  const webContents = { mainFrame: {} };
  windows.length = 0;
  windows.push({ webContents } as { webContents: { mainFrame: object } });
  return { sender: webContents, senderFrame: webContents.mainFrame };
}

function guestFrameEvent() {
  const webContents = { mainFrame: {} };
  windows.length = 0;
  windows.push({ webContents } as { webContents: { mainFrame: object } });
  return { sender: webContents, senderFrame: {} };
}

function validSnapshot(): UsageSnapshot {
  const provider = (name: "claude" | "codex") => ({
    provider: name,
    session: null,
    weekly: null,
    fableWeekly: null,
    updatedAt: 1,
    error: null,
    status: "idle" as const,
  });
  return {
    claude: provider("claude"),
    codex: provider("codex"),
    memory: { rssBytes: null, processCount: null, unavailableReason: "test" },
    ports: { listening: [], unavailableReason: "test" },
    awake: { mode: "off" as const, active: false, supported: false },
    updatedAt: 1,
  };
}

function fakeStore(snapshot: UsageSnapshot): UsageStore {
  return {
    getSnapshot: () => snapshot,
    refresh: () => Promise.resolve(snapshot),
    setAwake: () => ({ mode: "off" as const, active: false, supported: false }),
    dispose: () => {},
  } as unknown as UsageStore;
}

async function call(channel: string, event: unknown, input?: unknown) {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(event, input);
}

beforeEach(() => {
  handlers.clear();
  windows.length = 0;
  setUsageStore(null);
  registerUsageIpc();
});

describe("usage IPC registration", () => {
  test("registers exactly the three usage channels", () => {
    expect([...handlers.keys()].sort()).toEqual([
      "drogon:usageRefresh",
      "drogon:usageSetAwake",
      "drogon:usageSnapshot",
    ]);
  });
});

describe("usage snapshot channel", () => {
  test("the app main frame receives the validated snapshot", async () => {
    const snapshot = validSnapshot();
    setUsageStore(fakeStore(snapshot));
    const result = await call("drogon:usageSnapshot", mainFrameEvent());
    expect(result).toEqual({ ok: true, result: snapshot });
  });
  test("a guest frame is refused, never served numbers", async () => {
    setUsageStore(fakeStore(validSnapshot()));
    const result = (await call("drogon:usageSnapshot", guestFrameEvent())) as {
      ok: boolean;
      error: { message: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error.message).toBe("Invalid desktop request.");
  });
  test("a snapshot that fails validation never crosses the boundary", async () => {
    setUsageStore(fakeStore({ broken: true } as unknown as UsageSnapshot));
    const result = (await call("drogon:usageSnapshot", mainFrameEvent())) as {
      ok: boolean;
      error: { message: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error.message).toBe("Usage snapshot failed validation.");
  });
});

describe("usage refresh channel", () => {
  test("a throwing probe resolves failed, never rejects", async () => {
    setUsageStore({
      refresh: () => Promise.reject(new Error("lsof down")),
    } as unknown as UsageStore);
    const result = (await call("drogon:usageRefresh", mainFrameEvent())) as {
      ok: boolean;
      error: { message: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error.message).toBe("Usage refresh failed.");
  });
  test("a guest frame cannot trigger a refresh", async () => {
    setUsageStore(fakeStore(validSnapshot()));
    const result = (await call("drogon:usageRefresh", guestFrameEvent())) as {
      ok: boolean;
    };
    expect(result.ok).toBe(false);
  });
});

describe("usage set-awake channel", () => {
  test("rejects modes outside the contract, accepts the three literals", async () => {
    setUsageStore(fakeStore(validSnapshot()));
    for (const input of [{}, { mode: "sometimes" }, "sometimes", 42, null]) {
      const result = (await call("drogon:usageSetAwake", mainFrameEvent(), input)) as {
        ok: boolean;
        error: { message: string };
      };
      expect(result.ok).toBe(false);
      expect(result.error.message).toBe("Invalid awake mode.");
    }
    for (const input of ["on", "auto", "off"]) {
      const result = (await call("drogon:usageSetAwake", mainFrameEvent(), input)) as {
        ok: boolean;
      };
      expect(result.ok).toBe(true);
    }
  });
  test("a guest frame cannot change the awake mode", async () => {
    setUsageStore(fakeStore(validSnapshot()));
    const result = (await call("drogon:usageSetAwake", guestFrameEvent(), "on")) as {
      ok: boolean;
    };
    expect(result.ok).toBe(false);
  });
  test("a throwing store resolves failed, never rejects", async () => {
    setUsageStore({
      setAwake: () => {
        throw new Error("spawn failed");
      },
    } as unknown as UsageStore);
    const result = (await call("drogon:usageSetAwake", mainFrameEvent(), "on")) as {
      ok: boolean;
      error: { message: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error.message).toBe("Could not change the awake mode.");
  });
});

describe("usage store singleton", () => {
  test("getUsageStore reuses one instance until replaced", () => {
    const first = getUsageStore();
    expect(getUsageStore()).toBe(first);
    const fake = fakeStore(validSnapshot());
    setUsageStore(fake);
    expect(getUsageStore()).toBe(fake as unknown as ReturnType<typeof getUsageStore>);
  });
  test("disposeUsage releases the store and clears the singleton", () => {
    let disposed = 0;
    const fake = { dispose: () => { disposed += 1; } } as unknown as UsageStore;
    setUsageStore(fake);
    disposeUsage();
    expect(disposed).toBe(1);
    expect(getUsageStore()).not.toBe(fake);
  });
});
