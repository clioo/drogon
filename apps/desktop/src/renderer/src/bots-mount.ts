// V2-owned mount adapter for the Bots panel (features/bots/bots-panel-descriptor).
// Binds the real factory through the V2 route-panel-contract boundary. The
// single App mount stays V2-owned; this module registers nothing on import
// and Bots is never wired into App.tsx here.
//
// R2-S: create/chat turn/history land as real bridge calls, gated the same
// way botSnapshot always was. BOTS_CAPABILITY stays a module-local constant
// (not a shared/bot-contract.ts export, per the original ROOT-ownership
// note); it is now advertised by the service (see crates/drogon-core/src/lib.rs's
// CAPABILITIES list) so this panel is reachable end-to-end.

import { createBotsPanelDescriptor } from "./features/bots/bots-panel-descriptor";
import { buildBotRunHarness } from "./features/bots/bots-page-model";
import type {
  BotsPanelHostObservation,
  BotsPanelProps,
  BotsPanelSnapshot,
} from "./features/bots/bots-panel-contracts";
import type { BotsPanelHydrationProps } from "./features/bots/BotsPanel";
import type {
  BotBridge,
  BotScope,
  BotSessionReader,
} from "../../shared/bot-contract";
import type {
  Identity,
  ReadResult,
  Result,
} from "../../shared/session-contract";
import { registerRoute, routeId } from "./route-panel-contract";
import type { PanelDescriptor, RouteRegistry } from "./route-panel-contract";

/** Module-local capability marker; not sourced from shared/bot-contract.ts,
 *  which does not export a capability id (kept ROOT-owned by convention). */
export const BOTS_CAPABILITY = "bot.snapshot.v1";

/** Branded route id for the Bots panel, minted once here (V2/ROOT owns
 *  minting per bots-panel-descriptor's contract). */
export const BOTS_ROUTE_ID = routeId("bots");

/** True exactly when the live service advertises bot.snapshot.v1. */
export function isBotsAvailable(capabilities: readonly string[]): boolean {
  return capabilities.includes(BOTS_CAPABILITY);
}

/** Structural session-read source: `window.drogon.read` satisfies this
 *  (the widened parameter below), passed through ungated -- session reads
 *  carry their own liveness/authorization model, distinct from the
 *  bot.snapshot.v1 capability this gate enforces. */
type SessionReadSource = (
  input: Identity & { cursor: number },
) => Promise<Result<ReadResult>>;

/**
 * Fail-closed capability gate around a BotBridge. Every method (botSnapshot,
 * botCreate, botRun, botHistory, botResponsibilityCreate,
 * botResponsibilityDelete, botDelete) evaluates isAllowed at call time, so while
 * bot.snapshot.v1 is withheld every call is refused locally (never reaching
 * source) with an explicit retryable error, and a mid-life capability loss
 * fails closed on the very next call. `read` (if the source provides it,
 * e.g. the real `window.drogon`) passes through ungated -- see
 * `SessionReadSource`'s doc.
 */
export function createGatedBotBridge(
  source: BotBridge & { read?: SessionReadSource },
  isAllowed: () => boolean,
): BotBridge & { read?: SessionReadSource } {
  const refused = () =>
    Promise.resolve({
      ok: false as const,
      error: {
        code: "unsupported_capability",
        message: "bot.snapshot.v1 capability is not advertised by the service",
        retryable: true,
      },
    });
  const notImplemented = () =>
    Promise.resolve({
      ok: false as const,
      error: {
        code: "unsupported_method",
        message: "This bridge does not implement the requested Bot method.",
        retryable: false,
      },
    });
  const gated: BotBridge & { read?: SessionReadSource } = {
    botSnapshot: (input) =>
      isAllowed() ? source.botSnapshot(input) : refused(),
    botCreate: (input) =>
      isAllowed() ? (source.botCreate?.(input) ?? notImplemented()) : refused(),
    botRun: (input) =>
      isAllowed() ? (source.botRun?.(input) ?? notImplemented()) : refused(),
    botHistory: (input) =>
      isAllowed()
        ? (source.botHistory?.(input) ?? notImplemented())
        : refused(),
    botResponsibilityCreate: (input) =>
      isAllowed()
        ? (source.botResponsibilityCreate?.(input) ?? notImplemented())
        : refused(),
    botResponsibilityDelete: (input) =>
      isAllowed()
        ? (source.botResponsibilityDelete?.(input) ?? notImplemented())
        : refused(),
    botDelete: (input) =>
      isAllowed()
        ? (source.botDelete?.(input) ?? notImplemented())
        : refused(),
    // Redesigned page's monitor read — same fail-closed gate: a withheld
    // capability refuses locally, a source without the method reports
    // unsupported.
    botMonitorList: (input) =>
      isAllowed()
        ? (source.botMonitorList?.(input) ?? notImplemented())
        : refused(),
  };
  if (source.read) gated.read = source.read;
  return gated;
}

/**
 * Builds Bots panel props from caller-supplied real data only: the snapshot
 * as observed, the caller-observed liveness map and the scope needed for
 * bridge calls, verbatim. No liveness or persisted-session proof is
 * invented here.
 */
export function buildBotsPanelProps(
  snapshot: BotsPanelSnapshot,
  observedLivenessByBotId?: Record<string, BotsPanelHostObservation>,
  scope?: (BotScope & { locale: string }) | null,
): BotsPanelProps {
  const props: BotsPanelProps = { snapshot };
  if (observedLivenessByBotId !== undefined) {
    props.observedLivenessByBotId = observedLivenessByBotId;
  }
  if (scope) props.scope = scope;
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

function mintRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `bot-run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Registers the REAL Bots route (capability-gated on bot.snapshot.v1)
 * through the V2 contract and returns the new registry. Threads the gated
 * bridge itself onto the panel props (create/chat/history need their own
 * request lifecycle, not a single fire-and-forget callback) and wires the
 * scheduled-responsibility manual-run control through `bridge.botRun` --
 * only when `panel.scope` is present, so a caller that never supplied scope
 * still renders the pre-R2-S read-only view (no run button without a
 * callback, unchanged contract).
 */
/**
 * Pure panel-wiring step, split out from registerBotsRoute so its logic is
 * directly unit-testable without rendering through the descriptor/registry.
 */
export function buildWiredBotsPanelProps(
  gatedBridge: BotBridge & { read?: SessionReadSource },
  panel: BotsPanelHydrationProps,
): BotsPanelHydrationProps {
  const wiredPanel: BotsPanelHydrationProps = { ...panel, bridge: gatedBridge };
  if (gatedBridge.read) {
    wiredPanel.sessionReader = gatedBridge.read as BotSessionReader;
  }
  if (panel.scope) {
    const scope = panel.scope;
    wiredPanel.onRunResponsibility = ({ botId, responsibilityId, harness }) => {
      // `bot.run` requires an admitted harness override on every call (no
      // default resolution exists). Prefer the panel's FRESH harness source:
      // this closure is built at registration time, so its snapshot predates
      // every in-panel mutation (create included) -- resolving here silently
      // dropped runs for bots created after mount (R16-S). The snapshot
      // lookup stays only as a fallback for older callers.
      const stored = panel.snapshot.bots.find((bot) => bot.id === botId);
      const source = harness ?? (stored
        ? {
            harnessId: stored.harnessPolicy.defaultHarness,
            explicitModel: stored.harnessPolicy.explicitModel,
          }
        : undefined);
      if (!source) return;
      // Returned (not voided) so the panel can await settlement, reload
      // history, and surface a refusal/unsupported outcome instead of
      // silence -- the fork's `await runResponsibility(); await load()`.
      return (async () => {
        const response = await gatedBridge.botRun?.({
          hostId: scope.hostId,
          workspaceId: scope.workspaceId,
          locale: scope.locale,
          botId,
          responsibilityId,
          reason: "manual",
          eventIdentity: `manual:${Date.now()}`,
          requestId: mintRequestId(),
          harness: buildBotRunHarness(
            source.harnessId,
            source.explicitModel,
          ),
        });
        if (!response) {
          throw new Error("This bridge does not support running a Bot.");
        }
        if (!response.ok) {
          throw new Error(response.error.message);
        }
        if (response.result.outcome !== "dispatched") {
          throw new Error(
            response.result.error ?? `Run ${response.result.outcome}.`,
          );
        }
      })();
    };
  }
  return wiredPanel;
}

export function registerBotsRoute(
  registry: RouteRegistry,
  gatedBridge: BotBridge & { read?: SessionReadSource },
  panel: BotsPanelHydrationProps,
): RouteRegistry {
  const descriptor = createBotsPanelDescriptor({
    routeId: BOTS_ROUTE_ID,
    title: "Bots",
    panel: buildWiredBotsPanelProps(gatedBridge, panel),
    capability: BOTS_CAPABILITY,
  });
  return registerRoute(registry, adaptBotsDescriptor(descriptor));
}
