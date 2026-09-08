// @vitest-environment jsdom
// Issue #185: what the App reloads on a connection-ready transition.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  resolveConnectionReadyReload,
  useConnectionReadyReload,
} from "./connection-ready-reload";
import {
  __resetDaemonConnectionMonitorForTests,
  ensureDaemonConnectionMonitor,
} from "./daemon-connection-store";

describe("resolveConnectionReadyReload", () => {
  it("reloads everything when the boot pass finds no confirmed status", () => {
    // The #185 race: the mount refresh failed transiently while the
    // daemon was already answering probes, so the boot ready-transition
    // is the only retry that can populate the sidebar.
    expect(resolveConnectionReadyReload(false, "checking")).toBe("full");
  });

  it("skips a redundant reload after a good mount refresh", () => {
    expect(resolveConnectionReadyReload(true, "checking")).toBe("skip");
  });

  it("re-attaches via status only when returning from an outage", () => {
    expect(resolveConnectionReadyReload(true, "reconnecting")).toBe(
      "status-only",
    );
    expect(resolveConnectionReadyReload(false, "reconnecting")).toBe(
      "status-only",
    );
  });
});

describe("useConnectionReadyReload", () => {
  let releaseOuter: (() => void) | null = null;

  function seedMonitor(probe: () => Promise<string | null>): void {
    releaseOuter = ensureDaemonConnectionMonitor({
      probe,
      random: () => 0,
    });
  }

  async function settle(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    __resetDaemonConnectionMonitorForTests();
  });

  afterEach(() => {
    cleanup();
    releaseOuter?.();
    releaseOuter = null;
    __resetDaemonConnectionMonitorForTests();
    vi.useRealTimers();
  });

  it("reports the boot pass when the daemon answers the first probe", async () => {
    seedMonitor(() => Promise.resolve(null));
    const onReady = vi.fn();
    renderHook(() => useConnectionReadyReload(onReady));
    await settle(0);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith("checking");
  });

  it("reports the return from an outage exactly once", async () => {
    let down = true;
    seedMonitor(() => Promise.resolve(down ? "refused" : null));
    const onReady = vi.fn();
    renderHook(() => useConnectionReadyReload(onReady));
    await settle(0);
    expect(onReady).not.toHaveBeenCalled();
    down = false;
    await settle(500);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith("reconnecting");
  });

  it("requests a full reload when the first load failed and boot turns ready", async () => {
    // End-to-end wiring as App mounts it: the mount refresh failed (no
    // confirmed status), then the boot pass reports ready.
    seedMonitor(() => Promise.resolve(null));
    const requested: string[] = [];
    renderHook(() =>
      useConnectionReadyReload((previous) => {
        requested.push(resolveConnectionReadyReload(false, previous));
      }),
    );
    await settle(0);
    expect(requested).toEqual(["full"]);
  });

  it("requests nothing when the mount refresh already confirmed status", async () => {
    seedMonitor(() => Promise.resolve(null));
    const requested: string[] = [];
    renderHook(() =>
      useConnectionReadyReload((previous) => {
        requested.push(resolveConnectionReadyReload(true, previous));
      }),
    );
    await settle(0);
    expect(requested).toEqual(["skip"]);
  });
});
