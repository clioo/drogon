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
  buildWiredBotsPanelProps,
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
    expect(isBotsAvailable(["harness.catalog.v1", BOTS_CAPABILITY])).toBe(true);
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

describe("gated bot bridge (R2-S: botCreate/botRun/botHistory/read)", () => {
  const scope: BotScope & { locale: string } = {
    hostId: "host-a",
    workspaceId: "w-a",
    locale: "en-US",
  };
  const runInput = {
    ...scope,
    botId: "bot-1",
    responsibilityId: "resp-1",
    reason: "manual" as const,
    eventIdentity: "evt-1",
    requestId: "req-1",
  };

  function fullSource(calls: string[]) {
    return {
      botSnapshot: async () => {
        calls.push("botSnapshot");
        return { ok: true as const, result: { ...scope, ...emptySnapshot } };
      },
      botCreate: async () => {
        calls.push("botCreate");
        return { ok: true as const, result: {} as never };
      },
      botRun: async () => {
        calls.push("botRun");
        return {
          ok: true as const,
          result: {
            requestId: "req-1",
            hostId: scope.hostId,
            workspaceId: scope.workspaceId,
            automationRunId: null,
            responsibilityRunId: null,
            messageId: null,
            session: null,
            outcome: "dispatched" as const,
            refusal: null,
            reason: null,
            error: null,
            observedAt: null,
            recordedAt: 0,
          },
        };
      },
      botHistory: async () => {
        calls.push("botHistory");
        return {
          ok: true as const,
          result: { ...scope, botId: "bot-1", messages: [] },
        };
      },
      read: async () => {
        calls.push("read");
        return {
          ok: true as const,
          result: {
            session: { verdict: "live" as const },
            dataBase64: "",
            startCursor: 0,
            nextCursor: 0,
            truncated: false,
          },
        } as never;
      },
    };
  }

  it("gates botCreate/botRun/botHistory the same as botSnapshot", async () => {
    const calls: string[] = [];
    const gated = createGatedBotBridge(fullSource(calls), () => false);
    const create = await gated.botCreate?.({} as never);
    const run = await gated.botRun?.(runInput);
    const history = await gated.botHistory?.({ ...scope, botId: "bot-1" });
    expect(create?.ok).toBe(false);
    expect(run?.ok).toBe(false);
    expect(history?.ok).toBe(false);
    if (!create?.ok) expect(create?.error.code).toBe("unsupported_capability");
    expect(calls).toEqual([]);
  });

  it("passes botCreate/botRun/botHistory through while allowed", async () => {
    const calls: string[] = [];
    const gated = createGatedBotBridge(fullSource(calls), () => true);
    await gated.botCreate?.({} as never);
    await gated.botRun?.(runInput);
    await gated.botHistory?.({ ...scope, botId: "bot-1" });
    expect(calls).toEqual(["botCreate", "botRun", "botHistory"]);
  });

  it("passes read through ungated even while the capability is withheld", async () => {
    const calls: string[] = [];
    const gated = createGatedBotBridge(fullSource(calls), () => false);
    const response = await gated.read?.({
      sessionId: "s1",
      incarnation: "i1",
      cursor: 0,
    });
    expect(response?.ok).toBe(true);
    expect(calls).toEqual(["read"]);
  });

  it("omits read entirely when the source does not provide it", () => {
    const gated = createGatedBotBridge(
      {
        botSnapshot: async () => ({
          ok: true as const,
          result: { ...scope, ...emptySnapshot },
        }),
      },
      () => true,
    );
    expect(gated.read).toBeUndefined();
  });
});

describe("gated bot bridge (R9-C: botDelete)", () => {
  const scope: BotScope & { locale: string } = {
    hostId: "host-a",
    workspaceId: "w-a",
    locale: "en-US",
  };
  const deleteInput = { ...scope, requestId: "req-del", botId: "bot-1" };

  function deleteSource(calls: string[]) {
    return {
      botSnapshot: async () => ({
        ok: true as const,
        result: { ...scope, ...emptySnapshot },
      }),
      botDelete: async () => {
        calls.push("botDelete");
        return {
          ok: true as const,
          result: { ...scope, botId: "bot-1", removed: true, automationIds: [] },
        };
      },
    };
  }

  it("refuses botDelete while the capability is withheld and never calls source", async () => {
    const calls: string[] = [];
    const gated = createGatedBotBridge(deleteSource(calls), () => false);
    const response = await gated.botDelete?.(deleteInput);
    expect(response?.ok).toBe(false);
    if (!response?.ok) expect(response?.error.code).toBe("unsupported_capability");
    expect(calls).toEqual([]);
  });

  it("passes botDelete through while allowed", async () => {
    const calls: string[] = [];
    const gated = createGatedBotBridge(deleteSource(calls), () => true);
    const response = await gated.botDelete?.(deleteInput);
    expect(response?.ok).toBe(true);
    expect(calls).toEqual(["botDelete"]);
  });

  it("reports unsupported_method when the source predates botDelete", async () => {
    const gated = createGatedBotBridge(
      {
        botSnapshot: async () => ({
          ok: true as const,
          result: { ...scope, ...emptySnapshot },
        }),
      },
      () => true,
    );
    const response = await gated.botDelete?.(deleteInput);
    expect(response?.ok).toBe(false);
    if (!response?.ok) expect(response?.error.code).toBe("unsupported_method");
  });
});

describe("buildWiredBotsPanelProps", () => {
  const scope: BotScope & { locale: string } = {
    hostId: "host-a",
    workspaceId: "w-a",
    locale: "en-US",
  };

  it("always threads the bridge onto the panel", () => {
    const bridge: BotBridge = {
      botSnapshot: async () => ({
        ok: true as const,
        result: { ...scope, ...emptySnapshot },
      }),
    };
    const wired = buildWiredBotsPanelProps(
      bridge,
      buildBotsPanelProps(emptySnapshot),
    );
    expect(wired.bridge).toBe(bridge);
  });

  it("threads sessionReader only when the bridge provides read", () => {
    const bridge: BotBridge = {
      botSnapshot: async () => ({
        ok: true as const,
        result: { ...scope, ...emptySnapshot },
      }),
    };
    const withoutRead = buildWiredBotsPanelProps(
      bridge,
      buildBotsPanelProps(emptySnapshot),
    );
    expect(withoutRead.sessionReader).toBeUndefined();

    const read = async () => ({
      ok: true as const,
      result: {
        session: { verdict: "live" as const },
        dataBase64: "",
        startCursor: 0,
        nextCursor: 0,
        truncated: false,
      },
    });
    const withRead = buildWiredBotsPanelProps(
      { ...bridge, read: read as never },
      buildBotsPanelProps(emptySnapshot),
    );
    expect(withRead.sessionReader).toBe(read);
  });

  const snapshotWithBot: BotsPanelSnapshot = {
    bots: [
      {
        id: "bot-1",
        characterPreset: "none",
        displayIdentity: { displayName: "Watcher", handle: null, title: null },
        harnessPolicy: { defaultHarness: "claude", explicitModel: null },
        instructions: "",
        memories: [],
        responsibilities: [],
        currentSession: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    history: [],
  };

  it("wires onRunResponsibility to bridge.botRun with a manual reason and the bot's own harness, only when scope is present", () => {
    const calls: unknown[] = [];
    const bridge: BotBridge = {
      botSnapshot: async () => ({
        ok: true as const,
        result: { ...scope, ...emptySnapshot },
      }),
      botRun: async (input) => {
        calls.push(input);
        return {
          ok: true as const,
          result: {
            requestId: "r",
            hostId: scope.hostId,
            workspaceId: scope.workspaceId,
            automationRunId: null,
            responsibilityRunId: null,
            messageId: null,
            session: null,
            outcome: "dispatched" as const,
            refusal: null,
            reason: null,
            error: null,
            observedAt: null,
            recordedAt: 0,
          },
        };
      },
    };

    const withoutScope = buildWiredBotsPanelProps(
      bridge,
      buildBotsPanelProps(snapshotWithBot),
    );
    expect(withoutScope.onRunResponsibility).toBeUndefined();

    const withScope = buildWiredBotsPanelProps(
      bridge,
      buildBotsPanelProps(snapshotWithBot, undefined, scope),
    );
    withScope.onRunResponsibility?.({
      botId: "bot-1",
      responsibilityId: "resp-1",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      hostId: scope.hostId,
      workspaceId: scope.workspaceId,
      locale: scope.locale,
      botId: "bot-1",
      responsibilityId: "resp-1",
      reason: "manual",
      harness: { harnessId: "claude" },
    });
  });

  it("prefers the panel's fresh harness over the stale registration snapshot and splits provider/model (R16-S)", async () => {
    const calls: unknown[] = [];
    const bridge: BotBridge = {
      botSnapshot: async () => ({
        ok: true as const,
        result: { ...scope, ...emptySnapshot },
      }),
      botRun: async (input) => {
        calls.push(input);
        return {
          ok: true as const,
          result: {
            requestId: "r",
            hostId: scope.hostId,
            workspaceId: scope.workspaceId,
            automationRunId: null,
            responsibilityRunId: null,
            messageId: null,
            session: null,
            outcome: "dispatched" as const,
            refusal: null,
            reason: null,
            error: null,
            observedAt: null,
            recordedAt: 0,
          },
        };
      },
    };
    // Registration snapshot still names claude with no model (stale: the bot
    // was switched to Pi with a local model after mount).
    const withScope = buildWiredBotsPanelProps(
      bridge,
      buildBotsPanelProps(snapshotWithBot, undefined, scope),
    );
    await withScope.onRunResponsibility?.({
      botId: "bot-1",
      responsibilityId: "resp-1",
      harness: {
        harnessId: "pi",
        explicitModel: "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      botId: "bot-1",
      responsibilityId: "resp-1",
      reason: "manual",
      harness: {
        harnessId: "pi",
        provider: "dgx-spark",
        model: "qwen3.8-flash-next-nvidia-nvfp4",
        permissionMode: "unattended",
      },
    });
  });

  it("rejects the returned promise on a refused outcome so the panel can surface it", async () => {
    const bridge: BotBridge = {
      botSnapshot: async () => ({
        ok: true as const,
        result: { ...scope, ...emptySnapshot },
      }),
      botRun: async () => ({
        ok: true as const,
        result: {
          requestId: "r",
          hostId: scope.hostId,
          workspaceId: scope.workspaceId,
          automationRunId: null,
          responsibilityRunId: null,
          messageId: null,
          session: null,
          outcome: "refused" as const,
          refusal: null,
          reason: null,
          error: "responsibility is disabled",
          observedAt: null,
          recordedAt: 0,
        },
      }),
    };
    const withScope = buildWiredBotsPanelProps(
      bridge,
      buildBotsPanelProps(snapshotWithBot, undefined, scope),
    );
    await expect(
      withScope.onRunResponsibility?.({
        botId: "bot-1",
        responsibilityId: "resp-1",
      }),
    ).rejects.toThrow("responsibility is disabled");
  });

  it("never calls bridge.botRun for a bot absent from the snapshot (no harness to resolve)", () => {
    const calls: unknown[] = [];
    const bridge: BotBridge = {
      botSnapshot: async () => ({
        ok: true as const,
        result: { ...scope, ...emptySnapshot },
      }),
      botRun: async (input) => {
        calls.push(input);
        throw new Error("must not be called");
      },
    };
    const withScope = buildWiredBotsPanelProps(
      bridge,
      buildBotsPanelProps(emptySnapshot, undefined, scope),
    );
    withScope.onRunResponsibility?.({
      botId: "unknown-bot",
      responsibilityId: "resp-1",
    });
    expect(calls).toHaveLength(0);
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
    expect(checkAvailability(descriptor, [BOTS_CAPABILITY])).toBe("available");
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
