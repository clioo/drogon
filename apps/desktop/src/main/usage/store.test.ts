import { describe, expect, test } from "vitest";
import type { ProviderUsage } from "../../shared/usage-contract";
import {
  forcedUnavailableProviders,
  mergeProviderReading,
  nextBackoffMs,
  shouldRefreshProvider,
  UsageStore,
} from "./store";

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

describe("usage backoff", () => {
  test("grows exponentially and caps at ten minutes", () => {
    expect(nextBackoffMs(0)).toBe(0);
    expect(nextBackoffMs(1)).toBe(30_000);
    expect(nextBackoffMs(2)).toBe(60_000);
    expect(nextBackoffMs(3)).toBe(120_000);
    expect(nextBackoffMs(99)).toBe(600_000);
  });
  test("refreshes immediately without failures, then honors backoff", () => {
    expect(shouldRefreshProvider(null, 0, 10_000)).toBe(true);
    expect(shouldRefreshProvider(0, 1, 29_999)).toBe(false);
    expect(shouldRefreshProvider(0, 1, 30_000)).toBe(true);
  });
});

describe("provider merging (fail closed, keep last good)", () => {
  test("transient errors keep last-good windows", () => {
    const previous = okProvider("claude", 42);
    const merged = mergeProviderReading(previous, {
      ...previous,
      session: null,
      status: "error",
      error: "boom",
    });
    expect(merged.status).toBe("error");
    expect(merged.session?.usedPercent).toBe(42);
  });
  test("unavailable replaces authoritatively", () => {
    const previous = okProvider("codex", 42);
    const next: ProviderUsage = {
      ...previous,
      session: null,
      status: "unavailable",
      error: "signed out",
    };
    expect(mergeProviderReading(previous, next)).toBe(next);
  });
});

describe("forced outage hook", () => {
  test("parses the env list and ignores unknown names", () => {
    expect(forcedUnavailableProviders({ DROGON_USAGE_FORCE_UNAVAILABLE: "claude, codex, x" })).toEqual(
      new Set(["claude", "codex"]),
    );
    expect(forcedUnavailableProviders({})).toEqual(new Set());
  });
});

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

describe("usage store", () => {
  test("throwing readers resolve fail-closed, never reject", async () => {
    const store = new UsageStore({
      now: () => 0,
      readClaude: () => Promise.reject(new Error("net down")),
      readCodex: () => Promise.reject(new Error("nope")),
      readMemory: () => Promise.reject(new Error("ps?")),
      readPorts: () => Promise.reject(new Error("lsof?")),
      readWorkspaceProbes: quietProbes,
    });
    const snapshot = await store.refresh();
    expect(snapshot.claude.status).toBe("error");
    expect(snapshot.claude.session).toBeNull();
    expect(snapshot.codex.status).toBe("error");
    expect(snapshot.memory.unavailableReason).toBeTruthy();
    expect(snapshot.ports.unavailableReason).toBeTruthy();
  });
  test("manual refresh() always re-probes, bypassing backoff", async () => {
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
    });
    await store.refresh();
    await store.refresh();
    expect(calls).toBe(2);
  });
  test("the automatic cadence backs off a repeatedly failing provider", async () => {
    let now = 0;
    let calls = 0;
    const store = new UsageStore({
      now: () => now,
      readClaude: () => {
        calls += 1;
        return Promise.reject(new Error("down"));
      },
      readCodex: quietCodex,
      readMemory: quietMemory,
      readPorts: quietPorts,
      readWorkspaceProbes: quietProbes,
    });
    // Three forced failures: backoff grows to 120s, updatedAt tracks now.
    await store.refresh();
    now = 1_000;
    await store.refresh();
    now = 2_000;
    await store.refresh();
    expect(calls).toBe(3);
    // 61s later the snapshot is stale, but the provider backoff (120s) holds.
    now = 63_000;
    store.getSnapshot();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(3);
  });
});

describe("store fixture seam and dispose", () => {
  test("a fixture snapshot is served whole, without probing anything", async () => {
    let probes = 0;
    const store = new UsageStore({
      readFixture: () =>
        Promise.resolve({
          claude: okProvider("claude", 55),
          codex: { ...okProvider("codex", 12), weekly: null },
          memory: { rssBytes: 931_135_488, processCount: 4, unavailableReason: null },
          ports: { listening: [{ port: 3000, process: "node" }], unavailableReason: null },
        }),
      readClaude: () => {
        probes += 1;
        return Promise.resolve(okProvider("claude", 1));
      },
      readCodex: () => {
        probes += 1;
        return Promise.resolve(okProvider("codex", 1));
      },
      readMemory: () => {
        probes += 1;
        return Promise.resolve({ rssBytes: 1, processCount: 1, unavailableReason: null });
      },
      readPorts: () => {
        probes += 1;
        return Promise.resolve({ listening: [], unavailableReason: null });
      },
      readWorkspaceProbes: () => Promise.resolve([]),
    });
    const snap = await store.refresh();
    expect(snap.claude.session?.usedPercent).toBe(55);
    expect(snap.memory.rssBytes).toBe(931_135_488);
    expect(snap.ports.listening).toHaveLength(1);
    expect(probes).toBe(0);
  });
  test("a missing fixture falls back to real probing", async () => {
    let probed = false;
    const store = new UsageStore({
      readFixture: () => Promise.resolve(null),
      readClaude: () => {
        probed = true;
        return Promise.resolve(okProvider("claude", 7));
      },
      readCodex: () => Promise.resolve(okProvider("codex", 7)),
      readMemory: () =>
        Promise.resolve({ rssBytes: null, processCount: null, unavailableReason: "n" }),
      readPorts: () => Promise.resolve({ listening: [], unavailableReason: null }),
      readWorkspaceProbes: () => Promise.resolve([]),
    });
    const snap = await store.refresh();
    expect(probed).toBe(true);
    expect(snap.claude.session?.usedPercent).toBe(7);
  });
  test("dispose releases the owned caffeinate child", () => {
    const killed: boolean[] = [];
    const awake = {
      getSnapshot: () => ({ mode: "on", active: true, supported: true }),
      setMode: () => ({ mode: "on", active: true, supported: true }),
      dispose: () => killed.push(true),
    };
    const store = new UsageStore({
      awake: awake as never,
      readWorkspaceProbes: () => Promise.resolve([]),
    });
    store.dispose();
    expect(killed).toEqual([true]);
  });
});
