// Monitor transitions for the daemon-connection port: the ladder drives
// checking/reconnecting/disconnected/connected with the fork's cadence,
// manual retry restarts the ladder, and release stops the loop.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDaemonConnectionMonitorForTests,
  ensureDaemonConnectionMonitor,
  getDaemonConnectionSnapshot,
  retryDaemonConnectionNow,
  subscribeDaemonConnection,
} from "./daemon-connection-store";

function states(): string[] {
  const seen: string[] = [];
  seen.push(getDaemonConnectionSnapshot().state);
  return seen;
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetDaemonConnectionMonitorForTests();
});

afterEach(() => {
  __resetDaemonConnectionMonitorForTests();
  vi.useRealTimers();
});

describe("daemon connection monitor", () => {
  it("starts checking and connects on a healthy probe", async () => {
    const release = ensureDaemonConnectionMonitor({
      probe: () => Promise.resolve(null),
    });
    expect(states()).toEqual(["checking"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(getDaemonConnectionSnapshot().state).toBe("connected");
    expect(getDaemonConnectionSnapshot().lastConnectedAt).not.toBeNull();
    release();
  });

  it("backs off across failures and never gives up", async () => {
    const release = ensureDaemonConnectionMonitor({
      probe: () => Promise.resolve("refused"),
      random: () => 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(getDaemonConnectionSnapshot().state).toBe("reconnecting");
    expect(getDaemonConnectionSnapshot().attempt).toBe(0);
    // Ladder head step is 500ms: still waiting before it, retrying after.
    await vi.advanceTimersByTimeAsync(499);
    expect(getDaemonConnectionSnapshot().attempt).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(getDaemonConnectionSnapshot().attempt).toBe(1);
    // Run out the rest of the ladder (1000+2000+4000+8000+15000): the wait
    // pins at the 15s cap and the attempts keep counting past it.
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000 + 8000 + 15000);
    expect(getDaemonConnectionSnapshot().state).toBe("reconnecting");
    expect(getDaemonConnectionSnapshot().attempt).toBe(6);
    expect(getDaemonConnectionSnapshot().lastError).toBe("refused");
    await vi.advanceTimersByTimeAsync(15000);
    expect(getDaemonConnectionSnapshot().state).toBe("reconnecting");
    expect(getDaemonConnectionSnapshot().attempt).toBe(7);
    release();
  });

  it("reconnects when the service returns mid-backoff", async () => {
    let down = true;
    const release = ensureDaemonConnectionMonitor({
      probe: () => Promise.resolve(down ? "refused" : null),
      random: () => 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(getDaemonConnectionSnapshot().state).toBe("reconnecting");
    down = false;
    await vi.advanceTimersByTimeAsync(500);
    expect(getDaemonConnectionSnapshot().state).toBe("connected");
    expect(getDaemonConnectionSnapshot().lastError).toBeNull();
    release();
  });

  it("manual retry restarts the ladder from the head step", async () => {
    const release = ensureDaemonConnectionMonitor({
      probe: () => Promise.resolve("refused"),
      random: () => 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(getDaemonConnectionSnapshot().attempt).toBe(1);
    retryDaemonConnectionNow();
    expect(getDaemonConnectionSnapshot().state).toBe("checking");
    await vi.advanceTimersByTimeAsync(0);
    expect(getDaemonConnectionSnapshot().state).toBe("reconnecting");
    expect(getDaemonConnectionSnapshot().attempt).toBe(0);
    release();
  });

  it("notifies subscribers on every transition", async () => {
    const seen: string[] = [];
    const unsub = subscribeDaemonConnection(() =>
      seen.push(getDaemonConnectionSnapshot().state),
    );
    const release = ensureDaemonConnectionMonitor({
      probe: () => Promise.resolve(null),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual(["checking", "connected"]);
    unsub();
    release();
  });

  it("stops probing once the last owner releases", async () => {
    let probes = 0;
    const release = ensureDaemonConnectionMonitor({
      probe: () => {
        probes += 1;
        return Promise.resolve("refused");
      },
      random: () => 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(probes).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(probes).toBe(1);
  });

  it("heartbeats while connected and notices a later death", async () => {
    let down = false;
    let probes = 0;
    const release = ensureDaemonConnectionMonitor({
      probe: () => {
        probes += 1;
        return Promise.resolve(down ? "gone" : null);
      },
      random: () => 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(getDaemonConnectionSnapshot().state).toBe("connected");
    expect(probes).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(probes).toBe(2);
    expect(getDaemonConnectionSnapshot().state).toBe("connected");
    down = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(probes).toBe(3);
    expect(getDaemonConnectionSnapshot().state).toBe("reconnecting");
    release();
  });

  it("a probe rejection counts as a failure with its message", async () => {
    const release = ensureDaemonConnectionMonitor({
      probe: () => Promise.reject(new Error("socket hang up")),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(getDaemonConnectionSnapshot().state).toBe("reconnecting");
    expect(getDaemonConnectionSnapshot().lastError).toContain(
      "socket hang up",
    );
    release();
  });
});
