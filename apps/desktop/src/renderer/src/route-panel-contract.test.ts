import { describe, expect, it } from "vitest";
import type { Session, Status, Workspace } from "../../shared/session-contract";
import {
  applyPanelFocus,
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
