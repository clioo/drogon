import { describe, expect, test } from "vitest";
import type { ProviderUsage } from "../../shared/usage-contract";
import { UsageStore } from "./store";

function okProvider(provider: "claude" | "codex", usedPercent: number): ProviderUsage {
  return {
    provider,
    session: { usedPercent, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    fableWeekly: null,
    updatedAt: 1_000,
    error: null,
    status: "ok",
  };
}

const quietCodex = () =>
  Promise.resolve({
    provider: "codex" as const,
    session: null,
    weekly: null,
    fableWeekly: null,
    updatedAt: 0,
    error: null,
    status: "idle" as const,
  });
const quietMemory = () =>
  Promise.resolve({ rssBytes: null, processCount: null, unavailableReason: "test" });
const quietPorts = () => Promise.resolve({ listening: [], unavailableReason: "test" });
const quietProbes = () => Promise.resolve([]);
const noFixture = () => Promise.resolve(null);

function failingClaude() {
  return () => Promise.reject(new Error("down"));
}

describe("usage store edge decisions", () => {
  test("a forced outage never probes and reports forced, then recovers", async () => {
    const previousEnv = process.env.DROGON_USAGE_FORCE_UNAVAILABLE;
    process.env.DROGON_USAGE_FORCE_UNAVAILABLE = "claude";
    let calls = 0;
    const store = new UsageStore({
      now: () => 0,
      readClaude: () => {
        calls += 1;
        return Promise.resolve(okProvider("claude", 10));
      },
      readCodex: quietCodex,
      readMemory: quietMemory,
      readPorts: quietPorts,
      readWorkspaceProbes: quietProbes,
      readFixture: noFixture,
    });
    try {
      const forced = await store.refresh();
      expect(calls).toBe(0);
      expect(forced.claude.status).toBe("unavailable");
      expect(forced.claude.error).toMatch(/forced for testing/);
      delete process.env.DROGON_USAGE_FORCE_UNAVAILABLE;
      const recovered = await store.refresh();
      expect(calls).toBe(1);
      expect(recovered.claude.status).toBe("ok");
    } finally {
      if (previousEnv === undefined) delete process.env.DROGON_USAGE_FORCE_UNAVAILABLE;
      else process.env.DROGON_USAGE_FORCE_UNAVAILABLE = previousEnv;
    }
  });
  test("a success resets the failure count, so backoff does not compound", async () => {
    let now = 0;
    let calls = 0;
    const store = new UsageStore({
      now: () => now,
      readClaude: () => {
        calls += 1;
        return calls === 2
          ? Promise.resolve(okProvider("claude", 10))
          : Promise.reject(new Error("down"));
      },
      readCodex: quietCodex,
      readMemory: quietMemory,
      readPorts: quietPorts,
      readWorkspaceProbes: quietProbes,
      readFixture: noFixture,
    });
    await store.refresh(); // fail (1)
    await store.refresh(); // ok (resets), then fail, fail
    await store.refresh(); // fail (3)
    await store.refresh(); // fail (4): two consecutive failures after the reset
    expect(calls).toBe(4);
    // 61 s later the snapshot is stale; with the reset the backoff is 60 s
    // (two consecutive failures), so the provider is probed again.
    now = 61_000;
    store.getSnapshot();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(5);
  });
  test("concurrent refreshes share one probe", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const store = new UsageStore({
      now: () => 0,
      readClaude: async () => {
        calls += 1;
        await gate;
        return okProvider("claude", 10);
      },
      readCodex: quietCodex,
      readMemory: quietMemory,
      readPorts: quietPorts,
      readWorkspaceProbes: quietProbes,
      readFixture: noFixture,
    });
    const first = store.refresh();
    const second = store.refresh();
    release();
    const [snap1, snap2] = await Promise.all([first, second]);
    expect(snap1).toBe(snap2);
    expect(calls).toBe(1);
  });
  test("a fresh snapshot serves from cache; staleness starts at the poll interval", async () => {
    let now = 0;
    let calls = 0;
    const store = new UsageStore({
      now: () => now,
      readClaude: () => {
        calls += 1;
        return Promise.resolve(okProvider("claude", 10));
      },
      readCodex: quietCodex,
      readMemory: quietMemory,
      readPorts: quietPorts,
      readWorkspaceProbes: quietProbes,
      readFixture: noFixture,
    });
    store.getSnapshot();
    expect(calls).toBe(0);
    // One millisecond before the interval: still cached.
    now = 59_999;
    store.getSnapshot();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(0);
    // Exactly at the interval: a background probe starts.
    now = 60_000;
    store.getSnapshot();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(1);
  });
  test("a probe-list rejection scans with zero probes, never rejects", async () => {
    let seen: unknown = "unset";
    const store = new UsageStore({
      now: () => 0,
      readClaude: failingClaude(),
      readCodex: quietCodex,
      readMemory: quietMemory,
      readPorts: (workspaces) => {
        seen = workspaces;
        return quietPorts();
      },
      readWorkspaceProbes: () => Promise.reject(new Error("daemon down")),
      readFixture: noFixture,
    });
    const snapshot = await store.refresh();
    expect(seen).toEqual([]);
    expect(snapshot.ports.unavailableReason).toBe("test");
  });
  test("setAwake stamps the store clock", () => {
    let now = 7_000;
    const store = new UsageStore({
      now: () => now,
      readWorkspaceProbes: quietProbes,
      readFixture: noFixture,
    });
    try {
      now = 8_000;
      store.setAwake("off");
      expect(store.current().updatedAt).toBe(8_000);
    } finally {
      store.dispose();
    }
  });
});
