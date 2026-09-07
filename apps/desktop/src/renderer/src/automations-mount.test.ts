// Mount-adapter tests for the Automations page: registration, the
// fail-closed capability gate, and availability. No DOM: the panel itself
// is exercised live over CDP.
import { describe, expect, it, vi } from "vitest";
import type { AutomationBridge } from "../../shared/automation-contract";
import { AUTOMATION_CAPABILITY } from "../../shared/automation-contract";
import {
  checkAvailability,
  createRouteRegistry,
  resolveRoute,
  routeId,
} from "./route-panel-contract";
import {
  AUTOMATIONS_ROUTE_ID,
  createGatedAutomationBridge,
  isAutomationsAvailable,
  registerAutomationsRoute,
} from "./automations-mount";

const fakeBridge: AutomationBridge = {
  list: () => Promise.resolve({ ok: true, result: { automations: [] } }),
  create: () => Promise.reject(new Error("must be gated")),
  update: () => Promise.reject(new Error("must be gated")),
  remove: () => Promise.reject(new Error("must be gated")),
  runNow: () => Promise.reject(new Error("must be gated")),
  history: () => Promise.reject(new Error("must be gated")),
};

const loaders = {
  listWorkspaces: () => Promise.resolve({ ok: true as const, result: { workspaces: [] } }),
  listHarnesses: () =>
    Promise.resolve({ ok: true as const, result: { hostId: "h", harnesses: [] } }),
};

describe("automations mount", () => {
  it("mints a non-empty route id gated on automation.v1", () => {
    expect(AUTOMATIONS_ROUTE_ID).toBe("automations");
    expect(AUTOMATION_CAPABILITY).toBe("automation.v1");
    expect(isAutomationsAvailable(["automation.v1"])).toBe(true);
    expect(isAutomationsAvailable(["files.v1"])).toBe(false);
  });

  it("registers through the route contract with the capability gate", () => {
    const registry = registerAutomationsRoute(
      createRouteRegistry({
        capabilities: [AUTOMATION_CAPABILITY],
        fallbackId: routeId("fallback"),
      }),
      { bridge: fakeBridge, ...loaders },
    );
    const descriptor = resolveRoute(registry, AUTOMATIONS_ROUTE_ID);
    expect(descriptor.title).toBe("Automations");
    expect(checkAvailability(descriptor, ["automation.v1"])).toBe("available");
    expect(checkAvailability(descriptor, ["files.v1"])).toBe("unsupported");
    expect(typeof descriptor.component).toBe("function");
  });

  it("fails closed on every method while the capability is withheld", async () => {
    const source = { ...fakeBridge, list: vi.fn(fakeBridge.list) };
    const gated = createGatedAutomationBridge(source, () => false);
    const refused = await gated.list();
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("unsupported_capability");
      expect(refused.error.retryable).toBe(true);
    }
    expect(source.list).not.toHaveBeenCalled();
    for (const method of ["create", "update", "remove", "runNow", "history"] as const) {
      const result = await (gated[method] as (input: never) => Promise<{ ok: boolean }>)(
        {} as never,
      );
      expect(result.ok).toBe(false);
    }
  });

  it("passes calls through while the capability is advertised", async () => {
    const gated = createGatedAutomationBridge(fakeBridge, () => true);
    const result = await gated.list();
    expect(result).toEqual({ ok: true, result: { automations: [] } });
  });
});
