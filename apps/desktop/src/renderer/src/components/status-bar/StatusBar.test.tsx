// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// StatusBar segment states against a fixture usage bridge, state-for-state
// with the fork's StatusBarProviderSegment: pulsing "···" while loading,
// "--" when signed out, alert + status label on a failed refresh, verbose
// windows + minibar with data, letter badges in the icon-only tier, the
// refresh gate, and the awake toggle. No real network: the bridge is a
// fixture and the daemon segment is stubbed (it has its own tests).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ProviderUsage, UsageSnapshot } from "../../../../shared/usage-contract";

vi.mock("../../features/status-bar/DaemonConnectionSegment", () => ({
  DaemonConnectionSegment: () => (
    <span data-daemon-connection-segment="connected" />
  ),
}));

import { StatusBar } from "./StatusBar";

let refreshCalls: number[] = [];
let awakeCalls: string[] = [];
let resizeCallback: ((entries: ResizeObserverEntry[]) => void) | null = null;

function provider(overrides: Partial<ProviderUsage> = {}): ProviderUsage {
  return {
    provider: "claude",
    session: {
      usedPercent: 55,
      windowMinutes: 300,
      resetsAt: Date.now() + 3_600_000,
      resetDescription: null,
    },
    weekly: null,
    fableWeekly: null,
    updatedAt: Date.now(),
    error: null,
    status: "ok",
    ...overrides,
  };
}

function snapshot(overrides: {
  claude?: Partial<ProviderUsage>;
  codex?: Partial<ProviderUsage>;
} = {}): UsageSnapshot {
  return {
    claude: provider({ provider: "claude", ...overrides.claude }),
    codex: provider({ provider: "codex", ...overrides.codex }),
    memory: { rssBytes: 888.3 * 1024 * 1024, processCount: 4, unavailableReason: null },
    ports: { listening: [{ port: 3000, process: "node" }], unavailableReason: null },
    awake: { mode: "off", active: false, supported: true },
    updatedAt: Date.now(),
  };
}

function installBridge(snap: UsageSnapshot | null, options: {
  /** The mount refresh resolves (so data shows); later refreshes hang. */
  hangRefresh?: boolean;
} = {}): void {
  let firstRefresh = true;
  (window as { drogon?: unknown }).drogon = {
    usage: {
      snapshot: () => Promise.resolve({ ok: true, result: snap }),
      refresh: () => {
        refreshCalls.push(Date.now());
        if (options.hangRefresh && !firstRefresh) {
          return new Promise(() => {});
        }
        firstRefresh = false;
        return Promise.resolve({ ok: true, result: snap });
      },
      setAwake: (mode: string) => {
        awakeCalls.push(mode);
        return Promise.resolve({
          ok: true,
          result: { mode, active: mode === "on", supported: true },
        });
      },
    },
  };
}

beforeEach(() => {
  refreshCalls = [];
  awakeCalls = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: typeof resizeCallback) {
        resizeCallback = callback;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  // jsdom reports zero-sized elements; the fork's tiers read the bar's real
  // width, so pin a full-width bar unless a test overrides one element.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        width: 1200,
        height: 24,
        top: 0,
        left: 0,
        right: 1200,
        bottom: 24,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as { drogon?: unknown }).drogon;
});

async function renderBar(
  props: { snap?: UsageSnapshot | null; hangRefresh?: boolean } = {},
) {
  installBridge(
    props.snap === undefined ? snapshot() : props.snap,
    { hangRefresh: props.hangRefresh },
  );
  const view = render(
    <StatusBar terminalCount={2} onOpenSettings={() => {}} />,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

describe("StatusBar provider states", () => {
  it("renders the fork's pulsing ··· idle form before the first snapshot", async () => {
    installBridge(null);
    const view = render(<StatusBar terminalCount={0} onOpenSettings={() => {}} />);
    expect(screen.getAllByText("···").length).toBe(2);
    expect(screen.queryByText("loading usage…")).toBeNull();
    await act(async () => {});
    view.unmount();
  });

  it("renders -- per signed-out provider, dimmed, with no refresh control", async () => {
    await renderBar({
      snap: snapshot({
        claude: {
          session: null,
          status: "unavailable",
          error: "Claude is not signed in on this machine.",
        },
        codex: {
          session: null,
          status: "unavailable",
          error: "Codex is not signed in on this machine.",
        },
      }),
    });
    expect(screen.getAllByText("--").length).toBe(2);
    expect(screen.queryByRole("button", { name: "Refresh rate limits" })).toBeNull();
  });

  it("renders alert + status label when a refresh fails without data", async () => {
    await renderBar({
      snap: snapshot({
        claude: {
          session: null,
          status: "error",
          error: "Claude usage is unreachable (HTTP 503).",
        },
        codex: {
          session: null,
          status: "error",
          error: "Codex helper exited before reporting usage.",
        },
      }),
    });
    expect(screen.getByText("Network issue")).toBeDefined();
    expect(screen.getByText("Refresh failed")).toBeDefined();
  });

  it("renders verbose windows plus the minibar with data and the refresh control", async () => {
    await renderBar();
    expect(document.querySelector("[data-usage-bar]")).not.toBeNull();
    expect(screen.getAllByText(/55% used/).length).toBe(2);
    expect(
      screen.getByRole("button", { name: "Refresh rate limits" }),
    ).not.toBeNull();
    // The tooltip keeps the identity and reset detail.
    expect(screen.getAllByText(/55% used/)[0].getAttribute("title")).toContain(
      "Resets in",
    );
  });

  it("keeps data visible with a trailing alert when the last refresh failed", async () => {
    await renderBar({
      snap: snapshot({
        claude: { status: "error", error: "Claude usage is unreachable (HTTP 503)." },
      }),
    });
    expect(screen.getAllByText(/55% used/).length).toBe(2);
    // One stale alert on the claude segment only; codex stays clean.
    const claudeSegment = document.querySelector('[data-provider-segment="claude"]')!;
    expect(claudeSegment.querySelectorAll("svg").length).toBe(2); // icon + alert
    const codexSegment = document.querySelector('[data-provider-segment="codex"]')!;
    expect(codexSegment.querySelectorAll("svg").length).toBe(1); // icon only
  });

  it("swaps data segments to the source letter badges in the icon-only tier", async () => {
    await renderBar();
    // Report a narrow bar through the observer like the fork's tracker.
    vi.spyOn(
      document.querySelector('[data-testid="status-bar"]') as HTMLElement,
      "getBoundingClientRect",
    ).mockImplementation(() => ({ width: 400 }) as DOMRect);
    await act(async () => {
      resizeCallback?.([
        { contentRect: { width: 400 } } as ResizeObserverEntry,
      ]);
    });
    expect(screen.getAllByText("C").length).toBe(1);
    expect(screen.getAllByText("X").length).toBe(1);
    expect(document.querySelector("[data-usage-bar]")).toBeNull();
    // The full detail moves to the tooltip.
    expect(
      document.querySelector('[data-provider-segment="claude"]')!.getAttribute("title"),
    ).toContain("55% used");
  });

  it("disables the refresh control while a refresh is in flight", async () => {
    await renderBar({ hangRefresh: true });
    const refresh = screen.getByRole("button", {
      name: "Refresh rate limits",
    }) as HTMLButtonElement;
    fireEvent.click(refresh);
    // The click's refresh hangs, so the control stays disabled and spinning.
    expect(refresh.disabled).toBe(true);
    expect(refresh.querySelector("svg")?.getAttribute("class")).toContain(
      "animate-spin",
    );
    expect(refreshCalls.length).toBe(2); // mount probe + click
  });

  it("toggles awake through the bridge and reflects the activity suffix", async () => {
    await renderBar();
    const awake = screen.getByRole("button", { name: "Keep computer awake, Off · Inactive" });
    fireEvent.click(awake);
    await act(async () => {
      await Promise.resolve();
    });
    expect(awakeCalls).toEqual(["on"]);
    expect(
      screen.getByRole("button", { name: "Keep computer awake, On · Active" }),
    ).not.toBeNull();
  });

  it("renders the resource cluster with the source memory badge and counts", async () => {
    await renderBar();
    const cluster = document.querySelector('[data-testid="resource-usage-segment"]')!;
    expect(cluster.getAttribute("aria-label")).toBe(
      "Resource Manager, 2 terminal sessions",
    );
    expect(cluster.textContent).toContain("888.3 MB");
    expect(cluster.textContent).toContain("·");
    expect(cluster.textContent).toContain("2");
    expect(cluster.getAttribute("title")).toContain(
      "Resource Manager - 888.3 MB - 2 terminal sessions",
    );
    expect(screen.getByLabelText("Ports, 1 workspace port")).not.toBeNull();
    expect(screen.getByLabelText("Ports, 1 workspace port").textContent).toContain("1");
  });
});
