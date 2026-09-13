// The reproducible demo's guided tour: the panel says what the viewer should
// be looking at, and the surfaces that own that navigation answer.
//
// A window event, not a prop chain or a store import: App owns the tab strip
// and the Work Graph pane owns its view, and neither can be reached from a
// Settings section without threading state through half the renderer. This is
// the same seam the terminal file-open and sessions-invalidate contracts use.
//
// Requests are advisory. A surface that cannot honour one (the service has no
// graph capability, the workspace is not registered here) ignores it; nothing
// in the demo depends on the navigation having happened.

export const REPRO_TOUR_EVENT = "drogon:repro-demo-tour";

export type ReproTourRequest =
  /** Show the orchestration itself: select the workspace and open its Work
   *  Graph tab, leaving Settings. */
  | { kind: "open-work-graph"; workspaceId: string }
  /** Move the Work Graph's own view to the one that just changed. */
  | { kind: "focus-view"; view: "graph" | "evidence" | "usage" };

export type ReproTourSink = (request: ReproTourRequest) => void;

export function requestReproTour(request: ReproTourRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REPRO_TOUR_EVENT, { detail: request }));
}

/** Subscribes to tour requests; returns the unsubscribe. Payloads are shape
 *  checked before they reach the handler — a stray event of the same name can
 *  never drive navigation with a half-formed request. */
export function onReproTour(handler: ReproTourSink): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent).detail as Partial<ReproTourRequest> | null;
    if (!detail || typeof detail !== "object") return;
    if (
      detail.kind === "open-work-graph" &&
      typeof (detail as { workspaceId?: unknown }).workspaceId === "string" &&
      (detail as { workspaceId: string }).workspaceId.length > 0
    ) {
      handler(detail as ReproTourRequest);
      return;
    }
    if (
      detail.kind === "focus-view" &&
      ["graph", "evidence", "usage"].includes(
        String((detail as { view?: unknown }).view),
      )
    ) {
      handler(detail as ReproTourRequest);
    }
  };
  window.addEventListener(REPRO_TOUR_EVENT, listener);
  return () => window.removeEventListener(REPRO_TOUR_EVENT, listener);
}
