import { describe, expect, it } from "vitest";
import type { Session, Status, Workspace } from "../../shared/session-contract";
import {
  applyPanelFocus,
  checkAvailability,
  createRouteRegistry,
  registerRoute,
  releasePanel,
  resolveRoute,
  restoreRouteState,
  routeId,
  serializeRouteState,
} from "./route-panel-contract";
import type { PanelDescriptor } from "./route-panel-contract";

const session = {
  id: "s1",
  workspaceId: "w1",
  hostId: "local",
  incarnation: "i1",
  command: "/opt/pi/cli.js",
  args: [],
  cols: 80,
  rows: 24,
  verdict: "live",
  exitCode: null,
  createdAt: "2026-09-07T00:00:00Z",
} as Session;
const workspace = {
  id: "w1",
  path: "/tmp/repo",
  name: "repo",
  kind: "git",
  hostId: "local",
} as Workspace;
const status = {
  hostId: "local",
  serviceInstanceId: "inst1",
  protocol: 1,
  capabilities: ["harness.catalog.v1", "workspaces.v1"],
  version: "1.0.0",
} as Status;

const capabilities = ["harness.catalog.v1", "workspaces.v1"];

function descriptor(overrides: Partial<PanelDescriptor> = {}): PanelDescriptor {
  return {
    id: routeId("terminal"),
    title: "Terminal",
    component: () => null,
    ...overrides,
  };
}

function registryWith(routes: PanelDescriptor[]) {
  let registry = createRouteRegistry({
    capabilities,
    fallbackId: routeId("terminal"),
  });
  for (const route of routes) registry = registerRoute(registry, route);
  return registry;
}

describe("route registry validation", () => {
  it("accepts a well-formed V3/V4 descriptor and indexes it by id", () => {
    const registry = registryWith([
      descriptor({ capability: "workspaces.v1" }),
    ]);
    const resolved = resolveRoute(registry, "terminal");
    expect(resolved.title).toBe("Terminal");
    expect(resolved.component({ routeId: routeId("terminal"), session, workspace, status, focusTarget: null })).toBeNull();
  });
  it("rejects a descriptor with a missing component key", () => {
    const registry = createRouteRegistry({
      capabilities,
      fallbackId: routeId("terminal"),
    });
    const malformed = {
      id: routeId("terminal"),
      title: "Terminal",
    } as unknown as PanelDescriptor;
    expect(() => registerRoute(registry, malformed)).toThrow(/component/);
  });
  it("rejects a duplicate route id", () => {
    const registry = createRouteRegistry({
      capabilities,
      fallbackId: routeId("terminal"),
    });
    const once = registerRoute(registry, descriptor());
    expect(() => registerRoute(once, descriptor())).toThrow(/duplicate/);
  });
  it("rejects an unknown capability gate", () => {
    const registry = createRouteRegistry({
      capabilities,
      fallbackId: routeId("terminal"),
    });
    expect(() =>
      registerRoute(registry, descriptor({ capability: "cloud.sync.v9" })),
    ).toThrow(/capability/);
  });
  it("rejects an empty route id", () => {
    expect(() => routeId("  ")).toThrow(/non-empty/);
  });
});

describe("resolveRoute", () => {
  it("picks the correct panel for a route id", () => {
    const registry = registryWith([
      descriptor({ id: routeId("terminal") }),
      descriptor({ id: routeId("cloud"), title: "Cloud" }),
    ]);
    expect(resolveRoute(registry, "cloud").title).toBe("Cloud");
    expect(resolveRoute(registry, "terminal").title).toBe("Terminal");
  });
  it("falls back to the explicit safe default for unknown ids", () => {
    const registry = registryWith([descriptor()]);
    const fallback = resolveRoute(registry, "no-such-panel");
    expect(fallback.id).toBe("terminal");
  });
});

describe("panel focus contract", () => {
  it("focuses the mount target element, then runs the onFocus hook", () => {
    const focused: string[] = [];
    const hooks: string[] = [];
    const target = { focus: () => focused.push("focus") } as unknown as HTMLElement;
    const route = descriptor({
      id: routeId("cloud"),
      onFocus: (id) => hooks.push(id),
    });
    applyPanelFocus(route, target);
    expect(focused).toEqual(["focus"]);
    expect(hooks).toEqual(["cloud"]);
  });
  it("still runs onFocus when the panel renders no focus target", () => {
    const hooks: string[] = [];
    applyPanelFocus(descriptor({ onFocus: (id) => hooks.push(id) }), null);
    expect(hooks).toEqual(["terminal"]);
  });
});

describe("panel cleanup contract", () => {
  it("releases the panel through onCleanup on unmount", () => {
    const released: string[] = [];
    releasePanel(descriptor({ onCleanup: (id) => released.push(id) }));
    expect(released).toEqual(["terminal"]);
  });
  it("tolerates a panel without cleanup hooks", () => {
    expect(() => releasePanel(descriptor())).not.toThrow();
  });
});

describe("persisted per-route state", () => {
  it("round-trips state through serialize and restore", () => {
    const registry = registryWith([
      descriptor({ id: routeId("cloud"), restoreState: { region: "auto" } }),
    ]);
    const serialized = serializeRouteState(registry, "cloud", {
      activeTab: "buckets",
    });
    expect(restoreRouteState(registry, routeId("cloud"), serialized)).toEqual({
      activeTab: "buckets",
    });
  });
  it("falls back to the declared descriptor default for malformed payloads", () => {
    const registry = registryWith([
      descriptor({ id: routeId("cloud"), restoreState: { region: "auto" } }),
    ]);
    expect(restoreRouteState(registry, routeId("cloud"), "not json")).toEqual({
      region: "auto",
    });
  });
  it("never applies another route's persisted state", () => {
    const registry = registryWith([
      descriptor({ id: routeId("terminal") }),
      descriptor({ id: routeId("cloud"), restoreState: { region: "auto" } }),
    ]);
    const terminalState = serializeRouteState(registry, "terminal", {
      scrollTop: 42,
    });
    expect(
      restoreRouteState(registry, routeId("cloud"), terminalState),
    ).toEqual({ region: "auto" });
  });
  it("refuses to serialize state for an unregistered route", () => {
    const registry = registryWith([descriptor()]);
    expect(() =>
      serializeRouteState(registry, "no-such-panel", {}),
    ).toThrow(/unregistered/);
  });
  it("returns undefined when the target route is not registered", () => {
    const registry = registryWith([descriptor()]);
    expect(
      restoreRouteState(registry, routeId("gone"), '{"routeId":"gone"}'),
    ).toBeUndefined();
  });
});

describe("nullable session mount (files/Bots/settings panels with no terminal)", () => {
  it("mounts a descriptor with session null and renders without throwing", () => {
    const registry = registryWith([descriptor({ id: routeId("settings") })]);
    const resolved = resolveRoute(registry, "settings");
    expect(() =>
      resolved.component({
        routeId: routeId("settings"),
        session: null,
        workspace,
        status,
        focusTarget: null,
      }),
    ).not.toThrow();
  });
  it("runs applyPanelFocus and releasePanel for a session-less mount", () => {
    const hooks: string[] = [];
    const route = descriptor({
      id: routeId("settings"),
      onFocus: (id) => hooks.push(`focus:${id}`),
      onCleanup: (id) => hooks.push(`cleanup:${id}`),
    });
    const target = { focus: () => hooks.push("dom-focus") } as unknown as HTMLElement;
    const props = {
      routeId: routeId("settings"),
      session: null,
      workspace,
      status,
      focusTarget: target,
    };
    void props;
    applyPanelFocus(route, target);
    releasePanel(route);
    expect(hooks).toEqual(["dom-focus", "focus:settings", "cleanup:settings"]);
  });
  it("serializes and restores route state for a session-less mount", () => {
    const registry = registryWith([
      descriptor({ id: routeId("settings"), restoreState: { tab: "general" } }),
    ]);
    const serialized = serializeRouteState(registry, "settings", {
      tab: "advanced",
    });
    expect(
      restoreRouteState(registry, routeId("settings"), serialized),
    ).toEqual({ tab: "advanced" });
  });
});

describe("capability vocabulary split (declared vs live service caps)", () => {
  it("reports available when the live service exposes the descriptor's capability", () => {
    const route = descriptor({ capability: "workspaces.v1" });
    expect(checkAvailability(route, ["harness.catalog.v1", "workspaces.v1"])).toBe(
      "available",
    );
  });
  it("reports unsupported when the live service lacks the descriptor's capability", () => {
    const route = descriptor({ capability: "workspaces.v1" });
    expect(checkAvailability(route, ["harness.catalog.v1"])).toBe("unsupported");
  });
  it("reports available for a descriptor with no capability gate regardless of live caps", () => {
    const route = descriptor();
    expect(checkAvailability(route, [])).toBe("available");
  });
  it("keeps the declared registration vocabulary separate from live service caps", () => {
    // Declared vocabulary includes workspaces.v1, so registration succeeds...
    const registry = registryWith([
      descriptor({ id: routeId("cloud"), capability: "workspaces.v1" }),
    ]);
    const route = resolveRoute(registry, "cloud");
    // ...even though the live service caps (checked separately) don't have it yet.
    expect(checkAvailability(route, ["harness.catalog.v1"])).toBe("unsupported");
  });
});

describe("resolveRoute safe unavailable fallback", () => {
  it("never throws when both the id and the fallback are unregistered", () => {
    const registry = createRouteRegistry({
      capabilities,
      fallbackId: routeId("terminal"),
    });
    expect(() => resolveRoute(registry, "missing")).not.toThrow();
  });
  it("returns a built-in safe unavailable descriptor with no capability gate", () => {
    const registry = createRouteRegistry({
      capabilities,
      fallbackId: routeId("terminal"),
    });
    const resolved = resolveRoute(registry, "missing");
    expect(resolved.title).toBe("Unavailable");
    expect(resolved.capability).toBeUndefined();
    expect(
      resolved.component({
        routeId: resolved.id,
        session: null,
        workspace,
        status,
        focusTarget: null,
      }),
    ).toBeNull();
  });
});
