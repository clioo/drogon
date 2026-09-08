// @vitest-environment jsdom
// DaemonConnectionSegment: one status-bar segment for the local daemon —
// state label, tone and dot per state, diagnostics in the tooltip, and a
// Reconnect action only once automatic retries stop (fork row semantics).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DaemonConnectionSegment,
  daemonSegmentTitle,
} from "./DaemonConnectionSegment";
import {
  __resetDaemonConnectionMonitorForTests,
  ensureDaemonConnectionMonitor,
  getDaemonConnectionSnapshot,
} from "../shell/daemon-connection-store";

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), dismiss: vi.fn() },
}));

let releaseOuter: (() => void) | null = null;

function seedMonitor(probe: () => Promise<string | null>): void {
  releaseOuter = ensureDaemonConnectionMonitor({ probe, random: () => 0 });
}

async function settle(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function segmentHost(): Element | null {
  return document.querySelector("[data-daemon-connection-segment]");
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

describe("DaemonConnectionSegment", () => {
  it("reads Connected while the service answers", async () => {
    seedMonitor(() => Promise.resolve(null));
    render(<DaemonConnectionSegment />);
    await settle(0);
    const host = segmentHost();
    expect(host?.getAttribute("data-daemon-connection-segment")).toBe(
      "connected",
    );
    expect(host?.textContent).toContain("Connected");
    expect(host?.getAttribute("title")).toContain(
      "Drogon service: Connected",
    );
    expect(
      screen.queryByRole("button", { name: "Reconnect" }),
    ).toBeNull();
  });

  it("reads Reconnecting with the attempt in the tooltip while retrying", async () => {
    seedMonitor(() => Promise.resolve("refused"));
    render(<DaemonConnectionSegment />);
    await settle(0);
    const host = segmentHost();
    expect(host?.getAttribute("data-daemon-connection-segment")).toBe(
      "reconnecting",
    );
    expect(host?.textContent).toContain("Reconnecting");
    expect(host?.getAttribute("title")).toContain("Attempt 1");
    expect(host?.getAttribute("title")).toContain("may still be running");
    // The Reconnect action stays visible the whole outage (adaptation: no
    // menus in Drogon's bar, and retries never reach a stopped phase).
    expect(
      screen.getByRole("button", { name: "Reconnect" }),
    ).not.toBeNull();
  });

  it("keeps the action past the ladder cap and retries from the head", async () => {
    seedMonitor(() => Promise.resolve("refused"));
    render(<DaemonConnectionSegment />);
    await settle(0);
    await settle(500 + 1000 + 2000 + 4000 + 8000 + 15000 + 15000);
    expect(
      segmentHost()?.getAttribute("data-daemon-connection-segment"),
    ).toBe("reconnecting");
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await settle(0);
    expect(getDaemonConnectionSnapshot().state).toBe("reconnecting");
    expect(getDaemonConnectionSnapshot().attempt).toBe(0);
  });

  it("collapses to icon + dot at narrow widths, keeping the tooltip", async () => {
    seedMonitor(() => Promise.resolve(null));
    render(<DaemonConnectionSegment compact />);
    await settle(0);
    const host = segmentHost();
    expect(host?.getAttribute("data-daemon-connection-segment")).toBe(
      "connected",
    );
    expect(host?.textContent).not.toContain("Connected");
    expect(host?.getAttribute("title")).toContain(
      "Drogon service: Connected",
    );
  });

  it("composes the tooltip from summary, attempt and error", () => {
    const title = daemonSegmentTitle({
      state: "reconnecting",
      attempt: 2,
      lastError: "refused",
      lastConnectedAt: null,
    });
    expect(title).toContain("trying to restore");
    expect(title).toContain("Attempt 3");
    expect(title).toContain("refused");
  });
});
