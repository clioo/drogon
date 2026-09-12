// MIT Copyright (c) 2026 Lovecast Inc.
// Mount adapter for the work-graph AUTHORING seam (features/work-graph).
// Mirrors `mentu-mount.ts`: the granted `window.drogon.graph.*` namespace
// is reached through one cast here — never at call sites — and every call
// is fail-closed gated on the live service advertising `graph.v1`
// (crates/drogon-core/src/lib.rs's CAPABILITIES). When the capability is
// withheld, the call is refused locally with an explicit retryable error;
// it never reaches the service.

import {
  GRAPH_CAPABILITY,
  type GraphBridge,
} from "../../shared/graph-contract";
import type { Result } from "../../shared/session-contract";

export { GRAPH_CAPABILITY };

/** True exactly when the live service advertises graph.v1. */
export function isWorkGraphAuthoringAvailable(
  capabilities: readonly string[],
): boolean {
  return capabilities.includes(GRAPH_CAPABILITY);
}

/**
 * The granted `window.drogon.graph.*` namespace. DesktopBridge does not
 * declare it, so the cast lives here — one place — mirroring
 * `mentu-mount.ts`'s `windowMentuBridge`. Returns null on builds whose
 * preload predates the graph namespace, so callers can render an honest
 * "unavailable in this build" instead of throwing.
 */
export function windowGraphBridge(): GraphBridge | null {
  const bridge = (window.drogon as unknown as { graph?: GraphBridge }).graph;
  return bridge ?? null;
}

/**
 * Fail-closed capability gate around a GraphBridge. Every call evaluates
 * isAllowed at call time: when the live service withholds graph.v1 the
 * call is refused locally (never reaching the service) with an explicit
 * retryable error.
 */
export function createGatedGraphBridge(
  source: GraphBridge,
  isAllowed: () => boolean,
): GraphBridge {
  const refused = () =>
    Promise.resolve({
      ok: false as const,
      error: {
        code: "unsupported_capability",
        message: "graph.v1 capability is not advertised by the service",
        retryable: true,
      },
    });
  const gate =
    <A, T>(
      call: (input: A) => Promise<Result<T>>,
    ): ((input: A) => Promise<Result<T>>) =>
    ((input: A) => (isAllowed() ? call(input) : refused())) as (
      input: A,
    ) => Promise<Result<T>>;
  return {
    graphRead: gate(source.graphRead),
    graphWriteIntent: gate(source.graphWriteIntent),
    graphCompile: gate(source.graphCompile),
    graphRun: gate(source.graphRun),
    graphRunNodeFailover: gate(source.graphRunNodeFailover),
  };
}
