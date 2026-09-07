// Single App-mount route/panel contract (handoff "Rutas y paneles": V2 <- V3/V4).
// V3/V4 build PanelDescriptor factories and register routes through
// registerRoute; App (V2) stays the only mount point. Route ids are an OPEN
// set: new ids are minted with routeId() and admitted via registerRoute, so
// this file's core never lists concrete panels.

import type { ReactNode } from "react";
import type {
  Session,
  Status,
  Workspace,
} from "../../shared/session-contract";

declare const brand: unique symbol;
/** Branded route id. Open for extension: any vertical calls routeId("my.panel"). */
export type RouteId = string & { readonly [brand]: true };

export function routeId(value: string): RouteId {
  if (!value.trim()) throw new Error("route id must be non-empty");
  return value as RouteId;
}

/** Typed props every mounted panel receives. Session/Workspace/Status are the shared bridge types, not parallel copies. */
export type PanelProps = {
  routeId: RouteId;
  /** Null when no terminal session backs this mount (e.g. files/Bots/settings panels). */
  session: Session | null;
  workspace: Workspace;
  status: Status;
  /** Persisted per-route state from the last session (see restoreRouteState). */
  restoreState?: unknown;
  /** Element the panel must leave holding keyboard focus; null when the panel declares no target. */
  focusTarget: HTMLElement | null;
};

export type PanelDescriptor = {
  id: RouteId;
  title: string;
  component: (props: PanelProps) => ReactNode;
  /** Optional service capability (Status.capabilities) that must be present to mount; unknown gates are rejected at registration. */
  capability?: string;
  /** Declared default state for the first mount and for invalid persisted payloads. */
  restoreState?: unknown;
  /** Runs after focusTarget.focus() on mount. */
  onFocus?: (routeId: RouteId) => void;
  /** Runs after unmount: release DOM listeners, subscriptions and timers here. */
  onCleanup?: (routeId: RouteId) => void;
};

export type RouteRegistry = {
  routes: ReadonlyMap<string, PanelDescriptor>;
  /** Explicit safe default for unknown ids; must be registered before mount. */
  fallbackId: RouteId;
  knownCapabilities: ReadonlySet<string>;
};

export function createRouteRegistry(input: {
  capabilities: readonly string[];
  fallbackId: RouteId;
}): RouteRegistry {
  return {
    routes: new Map(),
    fallbackId: input.fallbackId,
    knownCapabilities: new Set(input.capabilities),
  };
}

function validateDescriptor(
  descriptor: PanelDescriptor,
  known: ReadonlySet<string>,
): void {
  if (typeof descriptor.id !== "string" || descriptor.id.length === 0) {
    throw new Error("panel descriptor needs a non-empty id");
  }
  if (typeof descriptor.component !== "function") {
    throw new Error(`panel ${descriptor.id}: component key is required`);
  }
  if (
    descriptor.capability !== undefined &&
    !known.has(descriptor.capability)
  ) {
    throw new Error(
      `panel ${descriptor.id}: unknown capability gate ${descriptor.capability}`,
    );
  }
}

/** Pure registration: returns a new registry, validating shape, duplicates and the capability gate. */
export function registerRoute(
  registry: RouteRegistry,
  descriptor: PanelDescriptor,
): RouteRegistry {
  validateDescriptor(descriptor, registry.knownCapabilities);
  if (registry.routes.has(descriptor.id)) {
    throw new Error(`duplicate route id ${descriptor.id}`);
  }
  const routes = new Map(registry.routes);
  routes.set(descriptor.id, descriptor);
  return { ...registry, routes };
}

/** Live availability of a declared-capability gate: 'unsupported' means App must not mount the panel. */
export type Availability = "available" | "unsupported";

/** Pure gate: does the running service (serviceCaps) actually expose the descriptor's capability right now? App calls this before mounting; it is independent of the registry's declared vocabulary. */
export function checkAvailability(
  descriptor: PanelDescriptor,
  serviceCaps: readonly string[],
): Availability {
  if (descriptor.capability === undefined) return "available";
  return serviceCaps.includes(descriptor.capability)
    ? "available"
    : "unsupported";
}

/** Fixed id for the built-in unavailable panel; never mint this id via routeId() for a real panel. */
export const UNAVAILABLE_ROUTE_ID = routeId("__unavailable__");

/** Built-in safe descriptor App renders as an empty/unavailable panel when no real route can be resolved. */
const UNAVAILABLE_DESCRIPTOR: PanelDescriptor = {
  id: UNAVAILABLE_ROUTE_ID,
  title: "Unavailable",
  component: () => null,
};

/**
 * Resolves the panel for id; unknown ids resolve to the registered fallback.
 * Never throws, even on older hosts where neither id nor the fallback are
 * registered yet: App must be able to start up and render an empty/unavailable
 * panel instead of crashing.
 */
export function resolveRoute(
  registry: RouteRegistry,
  id: string,
): PanelDescriptor {
  const route = registry.routes.get(id);
  if (route) return route;
  const fallback = registry.routes.get(registry.fallbackId);
  if (fallback) return fallback;
  return UNAVAILABLE_DESCRIPTOR;
}

/** Focus contract: App focuses the panel's target element on mount, then runs onFocus. */
export function applyPanelFocus(
  descriptor: PanelDescriptor,
  focusTarget: HTMLElement | null,
): void {
  focusTarget?.focus();
  descriptor.onFocus?.(descriptor.id);
}

/** Cleanup contract: App calls this after unmount so the panel releases listeners, subscriptions and timers. */
export function releasePanel(descriptor: PanelDescriptor): void {
  descriptor.onCleanup?.(descriptor.id);
}

/** Tags state with its route id; rejects unregistered routes (typo guard against orphaned persisted bytes). */
export function serializeRouteState(
  registry: RouteRegistry,
  id: string,
  state: unknown,
): string {
  if (!registry.routes.has(id)) {
    throw new Error(`cannot serialize state for unregistered route ${id}`);
  }
  return JSON.stringify({ routeId: id, state });
}

/**
 * Restores persisted state for id: the stored state when the payload is valid
 * and belongs to this route, the descriptor's declared restoreState default
 * when the payload is malformed or belongs to another route, and undefined
 * when id is not registered at all.
 */
export function restoreRouteState(
  registry: RouteRegistry,
  id: RouteId,
  serialized: string | null | undefined,
): unknown {
  const descriptor = registry.routes.get(id);
  if (!descriptor) return undefined;
  try {
    if (!serialized) return descriptor.restoreState;
    const envelope = JSON.parse(serialized) as {
      routeId?: string;
      state?: unknown;
    };
    if (envelope.routeId !== id) return descriptor.restoreState;
    return envelope.state;
  } catch {
    return descriptor.restoreState;
  }
}
