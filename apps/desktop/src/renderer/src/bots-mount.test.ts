// Contract tests for the Bots mount adapter. bot.snapshot.v1 stays DARK
// until ROOT enables it; there is no run button until BotRun lands, so
// props built here never carry a dispatch callback.
import { describe, expect, it } from "vitest";
import type { BotBridge, BotScope } from "../../shared/bot-contract";
import type { BotsPanelSnapshot } from "./features/bots/bots-panel-contracts";
import {
  checkAvailability,
  createRouteRegistry,
  registerRoute,
  resolveRoute,
  routeId,
} from "./route-panel-contract";
import {
  BOTS_CAPABILITY,
  BOTS_ROUTE_ID,
  buildBotsPanelProps,
  createGatedBotBridge,
  isBotsAvailable,
  registerBotsRoute,
} from "./bots-mount";

const emptySnapshot: BotsPanelSnapshot = { bots: [], history: [] };

function botsRegistry() {
  const base = createRouteRegistry({
    capabilities: [BOTS_CAPABILITY],
    fallbackId: routeId("terminal"),
  });
  return registerRoute(base, {
    id: routeId("terminal"),
    title: "Terminal",
    component: () => null,
  });
}

describe("isBotsAvailable", () => {
  it("is true when the service advertises bot.snapshot.v1", () => {
    expect(isBotsAvailable([BOTS_CAPABILITY])).toBe(true);
    expect(isBotsAvailable(["harness.catalog.v1", BOTS_CAPABILITY])).toBe(
      true,
    );
  });
  it("is false without the capability or on an empty list", () => {
    expect(isBotsAvailable(["harness.catalog.v1"])).toBe(false);
    expect(isBotsAvailable([])).toBe(false);
  });
});

describe("buildBotsPanelProps", () => {
  it("carries the snapshot and observed liveness through verbatim", () => {
    const snapshot: BotsPanelSnapshot = {
      bots: [],
      history: [],
    };
    const props = buildBotsPanelProps(snapshot, { b1: "live" });
    expect(props.snapshot).toBe(snapshot);
    expect(props.observedLivenessByBotId).toEqual({ b1: "live" });
  });
  it("omits observedLivenessByBotId entirely when none is supplied (no invented liveness)", () => {
    const props = buildBotsPanelProps(emptySnapshot);
    expect(props).not.toHaveProperty("observedLivenessByBotId");
  });
  it("never sets a dispatch callback (no run button until BotRun lands)", () => {
    const props = buildBotsPanelProps(emptySnapshot, {});
    expect(props.onRunResponsibility).toBeUndefined();
  });
});

describe("gated bot bridge (fail-closed, gates the one botSnapshot method)", () => {
  const scopeA: BotScope & { locale: string } = {
    hostId: "host-a",
    workspaceId: "w-a",
    locale: "en-US",
  };
  const scopeB: BotScope & { locale: string } = {
    hostId: "host-b",
    workspaceId: "w-b",
    locale: "es-MX",
  };
  const calls: (typeof scopeA)[] = [];
  const source: BotBridge = {
    botSnapshot: async (input) => {
      calls.push(input);
      return {
        ok: true as const,
        result: { ...input, ...emptySnapshot },
      };
    },
  };

  it("passes calls through while allowed", async () => {
    calls.length = 0;
    const gated = createGatedBotBridge(source, () => true);
    const response = await gated.botSnapshot(scopeA);
    expect(response.ok).toBe(true);
    expect(calls).toEqual([scopeA]);
  });

  it("refuses with unsupported_capability while withheld and never calls source", async () => {
    calls.length = 0;
    const gated = createGatedBotBridge(source, () => false);
    const response = await gated.botSnapshot(scopeA);
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("unsupported_capability");
      expect(response.error.retryable).toBe(true);
    }
    expect(calls).toEqual([]);
  });

  it("mid-life availability loss fails closed on the next call", async () => {
    calls.length = 0;
    let allowed = true;
    const gated = createGatedBotBridge(source, () => allowed);
    expect((await gated.botSnapshot(scopeA)).ok).toBe(true);
    allowed = false;
    const refused = await gated.botSnapshot(scopeA);
    expect(refused.ok).toBe(false);
    expect(calls).toEqual([scopeA]);
  });

  it("scope fencing: two scopes reach source with their own exact hostId/workspaceId/locale, never reused across calls", async () => {
    calls.length = 0;
    const gated = createGatedBotBridge(source, () => true);
    await gated.botSnapshot(scopeA);
    await gated.botSnapshot(scopeB);
    expect(calls).toEqual([scopeA, scopeB]);
    expect(calls[0]).not.toBe(calls[1]);
    expect(calls[0]).toEqual({
      hostId: "host-a",
      workspaceId: "w-a",
      locale: "en-US",
    });
    expect(calls[1]).toEqual({
      hostId: "host-b",
      workspaceId: "w-b",
      locale: "es-MX",
    });
  });

  it("surfaces snapshot_too_large as its own distinct error state, never an empty success", async () => {
    const tooLarge: BotBridge = {
      botSnapshot: async () => ({
        ok: false as const,
        error: {
          code: "snapshot_too_large",
          message: "snapshot exceeds transport limit",
          retryable: false,
        },
      }),
    };
    const gated = createGatedBotBridge(tooLarge, () => true);
    const response = await gated.botSnapshot(scopeA);
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("snapshot_too_large");
      expect(response.error.code).not.toBe("unsupported_capability");
    }
  });
});

describe("registerBotsRoute (real factory)", () => {
  const bridge: BotBridge = {
    botSnapshot: async (input) => ({
      ok: true as const,
      result: { ...input, ...emptySnapshot },
    }),
  };
  const panel = buildBotsPanelProps(emptySnapshot);

  it("registers the Bots descriptor and resolveRoute finds it", () => {
    const registry = registerBotsRoute(botsRegistry(), bridge, panel);
    expect(resolveRoute(registry, BOTS_ROUTE_ID).title).toBe("Bots");
    expect(resolveRoute(registry, BOTS_ROUTE_ID).capability).toBe(
      BOTS_CAPABILITY,
    );
  });

  it("unknown ids fall back to the registry fallback and never throw", () => {
    const registry = registerBotsRoute(botsRegistry(), bridge, panel);
    let descriptor: { id: string } | undefined;
    expect(() => {
      descriptor = resolveRoute(registry, "no-such-panel");
    }).not.toThrow();
    expect(descriptor?.id).toBe("terminal");
  });

  it("rejects duplicate registration of the bots route", () => {
    const once = registerBotsRoute(botsRegistry(), bridge, panel);
    expect(() => registerBotsRoute(once, bridge, panel)).toThrow(/duplicate/);
  });
});

describe("capability gating on the registered descriptor", () => {
  const bridge: BotBridge = {
    botSnapshot: async (input) => ({
      ok: true as const,
      result: { ...input, ...emptySnapshot },
    }),
  };
  it("gates on the live service capabilities", () => {
    const registry = registerBotsRoute(
      botsRegistry(),
      bridge,
      buildBotsPanelProps(emptySnapshot),
    );
    const descriptor = resolveRoute(registry, BOTS_ROUTE_ID);
    expect(checkAvailability(descriptor, [BOTS_CAPABILITY])).toBe(
      "available",
    );
    expect(checkAvailability(descriptor, [])).toBe("unsupported");
    expect(checkAvailability(descriptor, ["harness.catalog.v1"])).toBe(
      "unsupported",
    );
  });
});

describe("real panel mount", () => {
  const bridge: BotBridge = {
    botSnapshot: async (input) => ({
      ok: true as const,
      result: { ...input, ...emptySnapshot },
    }),
  };
  it("server-renders the real BotsPanel with a null-session host (props carry no session)", async () => {
    const registry = registerBotsRoute(
      botsRegistry(),
      bridge,
      buildBotsPanelProps(emptySnapshot),
    );
    const descriptor = resolveRoute(registry, BOTS_ROUTE_ID);
    const { createElement } = await import("react");
    const { renderToString } = await import("react-dom/server");
    let html = "";
    expect(() => {
      html = renderToString(
        createElement(descriptor.component, { session: null } as never),
      );
    }).not.toThrow();
    expect(html.length).toBeGreaterThan(0);
  });
});
