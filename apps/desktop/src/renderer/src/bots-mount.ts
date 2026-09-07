// V2-owned mount adapter for the exported-but-unmounted Bots panel
// (features/bots/bots-panel-descriptor, V4-B4). Binds the real factory
// through the V2 route-panel-contract boundary. The single App mount stays
// V2-owned; this module registers nothing on import and Bots is never wired
// into App.tsx here.
//
// bot.snapshot.v1 stays DARK until ROOT enables it in the shared bridge
// contract, so BOTS_CAPABILITY is a module-local constant, not a
// shared/bot-contract.ts export. There is no run button until the BotRun
// bridge is accepted, so panel props built here never carry a dispatch
// callback.

import { createBotsPanelDescriptor } from "./features/bots/bots-panel-descriptor";
import type {
  BotsPanelHostObservation,
  BotsPanelProps,
  BotsPanelSnapshot,
} from "./features/bots/bots-panel-contracts";
import type { BotBridge } from "../../shared/bot-contract";
import { registerRoute, routeId } from "./route-panel-contract";
import type { PanelDescriptor, RouteRegistry } from "./route-panel-contract";

/** Module-local capability marker; not sourced from shared/bot-contract.ts,
 *  which does not export a capability id yet (ROOT-owned, unapproved). */
export const BOTS_CAPABILITY = "bot.snapshot.v1";

/** Branded route id for the Bots panel, minted once here (V2/ROOT owns
 *  minting per bots-panel-descriptor's contract). */
export const BOTS_ROUTE_ID = routeId("bots");

/** True exactly when the live service advertises bot.snapshot.v1. */
export function isBotsAvailable(capabilities: readonly string[]): boolean {
  return capabilities.includes(BOTS_CAPABILITY);
}

/**
 * Fail-closed capability gate around a BotBridge. The bridge has exactly one
 * method, botSnapshot, and this gates exactly it: every call evaluates
 * isAllowed at call time, so while bot.snapshot.v1 is withheld the call is
 * refused locally (never reaching source) with an explicit retryable error,
 * and a mid-life capability loss fails closed on the very next call.
 */
export function createGatedBotBridge(
  source: BotBridge,
  isAllowed: () => boolean,
): BotBridge {
  const refused = () =>
    Promise.resolve({
      ok: false as const,
      error: {
        code: "unsupported_capability",
        message: "bot.snapshot.v1 capability is not advertised by the service",
        retryable: true,
      },
    });
  return {
    botSnapshot: (input) =>
      isAllowed() ? source.botSnapshot(input) : refused(),
  };
}

/**
 * Builds Bots panel props from caller-supplied real data only: the snapshot
 * as observed and the caller-observed liveness map, verbatim. No dispatch
 * callback is set (no run button until BotRun lands) and no liveness or
 * persisted-session proof is invented here.
 */
export function buildBotsPanelProps(
  snapshot: BotsPanelSnapshot,
  observedLivenessByBotId?: Record<string, BotsPanelHostObservation>,
): BotsPanelProps {
  const props: BotsPanelProps = { snapshot };
  if (observedLivenessByBotId !== undefined) {
    props.observedLivenessByBotId = observedLivenessByBotId;
  }
  return props;
}

/**
 * Adapts the real factory's plain-id descriptor onto the contract: validates
 * the id into a branded RouteId (empty ids throw here, never at mount).
 */
function adaptBotsDescriptor(
  descriptor: ReturnType<typeof createBotsPanelDescriptor>,
): PanelDescriptor {
  const { id, ...hooks } = descriptor;
  return { ...hooks, id: routeId(id) };
}

/**
 * Registers the REAL Bots route (capability-gated on bot.snapshot.v1)
 * through the V2 contract and returns the new registry. gatedBridge is
 * accepted for parity with the gated-bridge mount shape used elsewhere; the
 * current panel carries no dispatch and the descriptor factory does not call
 * the bridge directly (see buildBotsPanelProps).
 */
export function registerBotsRoute(
  registry: RouteRegistry,
  gatedBridge: BotBridge,
  panel: BotsPanelProps,
): RouteRegistry {
  void gatedBridge;
  const descriptor = createBotsPanelDescriptor({
    routeId: BOTS_ROUTE_ID,
    title: "Bots",
    panel,
    capability: BOTS_CAPABILITY,
  });
  return registerRoute(registry, adaptBotsDescriptor(descriptor));
}
