// V2-owned mount adapter for the Automations page
// (features/automations, journey J7). Binds the real descriptor factory
// through the V2 route-panel-contract boundary. The single App mount stays
// V2-owned; this module registers nothing on import.

import type { AutomationBridge } from "../../shared/automation-contract";
import { AUTOMATION_CAPABILITY } from "../../shared/automation-contract";
import type {
  Harness,
  Result,
  Workspace,
} from "../../shared/session-contract";
import { createAutomationsPanelDescriptor } from "./features/automations/automations-panel-descriptor";
import { registerRoute, routeId } from "./route-panel-contract";
import type { PanelDescriptor, RouteRegistry } from "./route-panel-contract";

export const AUTOMATIONS_ROUTE_ID = routeId("automations");

export { AUTOMATION_CAPABILITY as AUTOMATIONS_CAPABILITY };

/** True exactly when the live service advertises automation.v1. */
export function isAutomationsAvailable(
  capabilities: readonly string[],
): boolean {
  return capabilities.includes(AUTOMATION_CAPABILITY);
}

type AutomationMethod = keyof AutomationBridge;

/**
 * Fail-closed capability gate around an AutomationBridge. Every call
 * evaluates isAllowed at call time: while automation.v1 is withheld the
 * call is refused locally (never reaching the service) with an explicit
 * retryable error.
 */
export function createGatedAutomationBridge(
  source: AutomationBridge,
  isAllowed: () => boolean,
): AutomationBridge {
  const refused = () =>
    Promise.resolve({
      ok: false as const,
      error: {
        code: "unsupported_capability",
        message: "automation.v1 capability is not advertised by the service",
        retryable: true,
      },
    });
  const gate = <T extends AutomationMethod>(method: T): AutomationBridge[T] => {
    const call = (input: never) =>
      isAllowed()
        ? (source[method] as (input: never) => Promise<Result<unknown>>)(input)
        : refused();
    return call as AutomationBridge[T];
  };
  return {
    list: gate("list"),
    create: gate("create"),
    update: gate("update"),
    remove: gate("remove"),
    runNow: gate("runNow"),
    history: gate("history"),
  };
}

export type AutomationsRouteInput = {
  bridge: AutomationBridge;
  listWorkspaces: () => Promise<Result<{ workspaces: Workspace[] }>>;
  listHarnesses: () => Promise<
    Result<{ hostId: string; harnesses: Harness[] }>
  >;
};

/**
 * Registers the REAL Automations route (capability-gated on automation.v1)
 * through the V2 contract and returns the new registry.
 */
export function registerAutomationsRoute(
  registry: RouteRegistry,
  input: AutomationsRouteInput,
): RouteRegistry {
  const descriptor = createAutomationsPanelDescriptor({
    routeId: AUTOMATIONS_ROUTE_ID,
    title: "Automations",
    bridge: input.bridge,
    listWorkspaces: input.listWorkspaces,
    listHarnesses: input.listHarnesses,
    capability: AUTOMATION_CAPABILITY,
  });
  const { id, ...hooks } = descriptor;
  return registerRoute(registry, {
    ...hooks,
    id: routeId(id),
    component: hooks.component as PanelDescriptor["component"],
  });
}
