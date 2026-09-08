// Mount adapter for the Mentu tab (features/mentu, journey J9). Binds the
// real descriptor factory through the route-panel-contract boundary,
// mirroring automations-mount.ts. The single App mount stays the only
// mount point; this module registers nothing on import.

import {
  MENTU_CAPABILITY,
  type MentuBridge,
} from "../../shared/mentu-contract";
import type { Result } from "../../shared/session-contract";
import { createMentuPanelDescriptor } from "./features/mentu/mentu-panel-descriptor";
import { registerRoute, routeId } from "./route-panel-contract";
import type { PanelDescriptor, RouteRegistry } from "./route-panel-contract";

export const MENTU_ROUTE_ID = routeId("mentu");

export { MENTU_CAPABILITY };

/** True exactly when the live service advertises mentu.v1. */
export function isMentuAvailable(capabilities: readonly string[]): boolean {
  return capabilities.includes(MENTU_CAPABILITY);
}

/**
 * The granted `window.drogon.mentu.*` namespace. DesktopBridge
 * (coordinator-owned) does not declare it yet, so the cast lives here —
 * one place — rather than at every call site, mirroring
 * `changes-mount.ts`'s `windowGitBridge`/`tasks-mount.ts`'s
 * `windowTasksBridge`.
 */
export function windowMentuBridge(): MentuBridge {
  return (window.drogon as unknown as { mentu: MentuBridge }).mentu;
}

/**
 * Fail-closed capability gate around a MentuBridge. Every call evaluates
 * isAllowed at call time: when the live service withholds mentu.v1 the
 * call is refused locally (never reaching the service) with an explicit
 * retryable error.
 */
export function createGatedMentuBridge(
  source: MentuBridge,
  isAllowed: () => boolean,
): MentuBridge {
  const refused = () =>
    Promise.resolve({
      ok: false as const,
      error: {
        code: "unsupported_capability",
        message: "mentu.v1 capability is not advertised by the service",
        retryable: true,
      },
    });
  const gate = <A, T>(
    call: (input: A) => Promise<Result<T>>,
  ): ((input: A) => Promise<Result<T>>) =>
    ((input: A) => (isAllowed() ? call(input) : refused())) as (
      input: A,
    ) => Promise<Result<T>>;
  return {
    mentuRecipes: gate(source.mentuRecipes),
    mentuRecipe: gate(source.mentuRecipe),
    mentuRuntime: () => (isAllowed() ? source.mentuRuntime() : refused()),
    mentuApprove: gate(source.mentuApprove),
    mentuRun: gate(source.mentuRun),
    mentuRuns: gate(source.mentuRuns),
    mentuRunStatus: gate(source.mentuRunStatus),
    // Additive and optional like the contract: older preload builds have
    // no evidence method, and the gated bridge forwards it only when the
    // source provides it (R14-D run evidence content).
    ...(source.mentuRunEvidence
      ? { mentuRunEvidence: gate(source.mentuRunEvidence) }
      : {}),
    // Same optional-forwarding shape for recipe saves: without it the
    // recipe pane's editor reports saving as unavailable even though the
    // daemon and preload both implement `mentu.recipe_save` (R12-H).
    ...(source.mentuRecipeSave
      ? { mentuRecipeSave: gate(source.mentuRecipeSave) }
      : {}),
    mentuRetry: gate(source.mentuRetry),
    mentuCancel: gate(source.mentuCancel),
  };
}

/** Registers the real Mentu route (capability-gated on mentu.v1). */
export function registerMentuRoute(
  registry: RouteRegistry,
  bridge: MentuBridge,
): RouteRegistry {
  const descriptor = createMentuPanelDescriptor({
    routeId: MENTU_ROUTE_ID,
    title: "Mentu",
    bridge,
    capability: MENTU_CAPABILITY,
  });
  const adapted: PanelDescriptor = {
    ...descriptor,
    id: routeId(descriptor.id),
  };
  return registerRoute(registry, adapted);
}
