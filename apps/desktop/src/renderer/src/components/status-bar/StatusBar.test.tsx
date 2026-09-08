// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// StatusBar segment states against a fixture usage bridge, state-for-state
// with the fork's StatusBarProviderSegment: pulsing "···" while loading,
// "--" when signed out, alert + status label on a failed refresh, verbose
// windows + minibar with data, letter badges in the icon-only tier, the
// refresh gate, the Usage roster popover, the empty-usage CTA, the awake
// On/Agent/Off dropdown and the segment click targets. No real network: the
// bridge is a fixture and the daemon segment is stubbed (it has its own
// tests).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ProviderUsage, UsageSnapshot } from "../../../../shared/usage-contract";
import { installRadixJsdomStubs } from "../ui/radix-jsdom-stubs";

vi.mock("../../features/status-bar/DaemonConnectionSegment", () => ({
  DaemonConnectionSegment: () => (
    <span data-daemon-connection-segment="connected" />
  ),
}));

import { StatusBar } from "./StatusBar";

let refreshCalls: number[] = [];
let awakeCalls: string[] = [];
let resizeCallback: ((entries: ResizeObserverEntry[]) => void) | null = null;
const settingsCalls: (string | undefined)[] = [];
let portsOpened = 0;

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
          result: {
            mode,
            active: mode === "on" || (mode === "auto" && false),
            supported: true,
          },
        });
      },
    },
  };
}

beforeEach(() => {
  refreshCalls = [];
  awakeCalls = [];
  settingsCalls.length = 0;
  portsOpened = 0;
  installRadixJsdomStubs();
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
    <StatusBar
      terminalCount={2}
      onOpenSettings={(section) => settingsCalls.push(section)}
      onOpenPorts={() => {
        portsOpened += 1;
      }}
    />,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

/** Opens a Radix menu trigger the way the repo's stubs allow (TabCreateMenu
    pattern): pointerDown with a mouse pointerType, then the click. */
function openMenu(trigger: HTMLElement): void {
  fireEvent.pointerDown(trigger, { pointerType: "mouse", button: 0 });
  fireEvent.click(trigger);
}

describe("StatusBar provider states", () => {
  it("renders the fork's pulsing ··· idle form before the first snapshot", async () => {
    installBridge(null);
    const view = render(
      <StatusBar
        terminalCount={0}
        onOpenSettings={() => {}}
        onOpenPorts={() => {}}
      />,
    );
    expect(screen.getAllByText("···").length).toBe(2);
    expect(screen.queryByText("loading usage…")).toBeNull();
    await act(async () => {});
    view.unmount();
  });

  it("renders -- for a signed-out provider next to a live one, dimmed", async () => {
    await renderBar({
      snap: snapshot({
        claude: {
          session: null,
          status: "unavailable",
          error: "Claude is not signed in on this machine.",
        },
      }),
    });
    expect(screen.getAllByText("--").length).toBe(1);
    // Codex still carries data, so the refresh control stays.
    expect(
      screen.getByRole("button", { name: "Refresh rate limits" }),
    ).not.toBeNull();
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

  it("renders the resource cluster with the source memory badge and counts", async () => {
    await renderBar();
    const cluster = document.querySelector('[data-testid="resource-usage-segment"]')!;
    expect(cluster.getAttribute("aria-label")).toBe(
      "Resource Manager, 2 terminal sessions",
    );
    expect(cluster.textContent).toContain("888.3 MB");
    expect(cluster.textContent).toContain("·");
    expect(cluster.textContent).toContain("2");
    // #303 (fork resource-usage-status-trigger.tsx): the "·" separator is
    // regular visible content — nothing in the cluster is aria-hidden, so
    // the accessibility tree keeps "888.3 MB · 1".
    expect(
      cluster.querySelector('[aria-hidden="true"]:not(svg)'),
    ).toBeNull();
    expect(cluster.getAttribute("title")).toContain(
      "Resource Manager - 888.3 MB - 2 terminal sessions",
    );
    expect(screen.getByLabelText("Ports, 1 workspace port")).not.toBeNull();
    expect(screen.getByLabelText("Ports, 1 workspace port").textContent).toContain("1");
  });
});

describe("StatusBar usage roster popover", () => {
  it("opens the fork's roster panel: header, rows, per-window bars", async () => {
    await renderBar();
    openMenu(screen.getByTestId("usage-roster-trigger"));
    expect(screen.getByText("Usage")).toBeDefined();
    expect(screen.getByText("all agents")).toBeDefined();
    // Provider rows carry the source icon-box + name form.
    expect(document.querySelector('[data-usage-mode="verbose"]')).not.toBeNull();
    expect(screen.getAllByText("Claude").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
    // Verbose rows list both windows with bars.
    expect(document.querySelectorAll("[data-usage-window]").length).toBe(2);
  });

  it("the popover refresh item calls the bridge refresh without closing", async () => {
    await renderBar();
    openMenu(screen.getByTestId("usage-roster-trigger"));
    const refreshCount = refreshCalls.length;
    fireEvent.click(screen.getByRole("menuitem", { name: "Refresh rate limits" }));
    await act(async () => {});
    expect(refreshCalls.length).toBe(refreshCount + 1);
    // The panel is still open (onSelect preventDefault, fork behavior).
    expect(screen.getByText("all agents")).toBeDefined();
  });

  it("routes rows and Manage Accounts… to the Agents settings pane", async () => {
    await renderBar();
    openMenu(screen.getByTestId("usage-roster-trigger"));
    fireEvent.click(screen.getByText("Manage Accounts…"));
    await act(async () => {});
    expect(settingsCalls).toEqual(["agents"]);
  });

  it("the density picker swaps verbose rows for the compact tightest metric", async () => {
    await renderBar();
    openMenu(screen.getByTestId("usage-roster-trigger"));
    expect(document.querySelectorAll("[data-usage-window]").length).toBe(2);
    // Radios carry the fork's option copy as their names.
    expect(
      screen.getByRole("radio", { name: "Detailed" }).getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Compact" }));
    expect(document.querySelector('[data-usage-mode="compact"]')).not.toBeNull();
    // Compact keeps one bar-less tightest metric per provider (fork form).
    expect(document.querySelectorAll("[data-usage-window]").length).toBe(2);
    expect(
      document.querySelectorAll('[data-usage-mode="compact"] [data-usage-bar]').length,
    ).toBe(0);
  });
});

describe("StatusBar empty-usage CTA", () => {
  const emptySnap = () =>
    snapshot({
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
    });

  it("replaces the meters with the fork's Configure usage tracking CTA", async () => {
    await renderBar({ snap: emptySnap() });
    expect(screen.getByRole("button", { name: "Configure usage tracking" })).toBeDefined();
    // No meters, no popover trigger, no refresh over the empty state.
    expect(screen.queryByTestId("usage-roster-trigger")).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh rate limits" })).toBeNull();
    expect(screen.queryByText("--")).toBeNull();
  });

  it("opens the Agents settings pane from the CTA", async () => {
    await renderBar({ snap: emptySnap() });
    fireEvent.click(screen.getByRole("button", { name: "Configure usage tracking" }));
    expect(settingsCalls).toEqual(["agents"]);
  });

  it("keeps a transiently failing provider visible (never reads as empty)", async () => {
    await renderBar({
      snap: snapshot({
        claude: {
          session: null,
          status: "error",
          error: "Claude usage is unreachable (HTTP 503).",
        },
        codex: {
          session: null,
          status: "unavailable",
          error: "Codex is not signed in on this machine.",
        },
      }),
    });
    expect(screen.queryByRole("button", { name: "Configure usage tracking" })).toBeNull();
    expect(screen.getByText("Network issue")).toBeDefined();
  });
});

describe("StatusBar awake modes", () => {
  it("the trigger opens the fork's On/Agent/Off radio menu with descriptions", async () => {
    await renderBar();
    openMenu(screen.getByTestId("awake-segment"));
    expect(screen.getByText("Keep computer awake")).toBeDefined();
    expect(screen.getByText("Off · Inactive")).toBeDefined();
    expect(screen.getByText("Keep this computer awake continuously")).toBeDefined();
    expect(screen.getByText("Stay awake while an agent is working")).toBeDefined();
    expect(screen.getByText("Allow normal system sleep behavior")).toBeDefined();
    // Radio names include their description line (fork structure).
    expect(screen.getByRole("menuitemradio", { name: /^Off/ })).toBeDefined();
    expect(screen.getByRole("menuitemradio", { name: /^Agent/ })).toBeDefined();
    expect(screen.getByRole("menuitemradio", { name: /^On/ })).toBeDefined();
  });

  it("selecting Agent sends auto to the bridge and relabels the trigger", async () => {
    await renderBar();
    openMenu(screen.getByTestId("awake-segment"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Agent/ }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(awakeCalls).toEqual(["auto"]);
    // aria: "Keep computer awake, Agent · Inactive" (inactive: no agent yet).
    expect(
      screen.getByTestId("awake-segment").getAttribute("aria-label"),
    ).toBe("Keep computer awake, Agent · Inactive");
    expect(screen.getByText("Agent")).toBeDefined();
  });

  it("selecting Off releases the assertion and the label follows", async () => {
    await renderBar({
      snap: snapshot(),
    });
    // Start from On via the bridge, then back off through the menu.
    openMenu(screen.getByTestId("awake-segment"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^On/ }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByTestId("awake-segment").getAttribute("aria-label"),
    ).toBe("Keep computer awake, On · Active");
    openMenu(screen.getByTestId("awake-segment"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Off/ }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(awakeCalls).toEqual(["on", "off"]);
    expect(
      screen.getByTestId("awake-segment").getAttribute("aria-label"),
    ).toBe("Keep computer awake, Off · Inactive");
  });
});

describe("StatusBar segment click targets", () => {
  it("the resource cluster opens Settings → Terminal", async () => {
    await renderBar();
    fireEvent.click(document.querySelector('[data-testid="resource-usage-segment"]')!);
    expect(settingsCalls).toEqual(["terminal"]);
  });

  it("the ports segment opens the right-sidebar Ports panel", async () => {
    await renderBar();
    fireEvent.click(screen.getByLabelText("Ports, 1 workspace port"));
    expect(portsOpened).toBe(1);
  });

  it("the settings gear opens the page without a preselected pane", async () => {
    await renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(settingsCalls).toEqual([undefined]);
  });
});
