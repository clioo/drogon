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
  | { kind: "open-demo" }
  /** Show what the demo just configured: the run's workspace selected, and the
   *  Bots page, leaving Settings. */
  | { kind: "open-bots"; workspaceId: string }
  /** Show the orchestration as it happens: select the run's workspace and its
   *  session area, where the main session and its parallel workers appear. */
  | { kind: "open-sessions"; workspaceId: string }
  /** Show the Work Graph tab of the workspace (on demand — its canvas is not
   *  the orchestration, the sessions are). */
  | { kind: "open-work-graph"; workspaceId: string }
  /** Move the Work Graph's own view to the one that just changed. */
  | { kind: "focus-view"; view: "graph" | "evidence" | "usage" };

export type ReproTourSink = (request: ReproTourRequest) => void;
export type ReproTourView = Extract<ReproTourRequest, { kind: "focus-view" }>["view"];

// A `focus-view` sent right after `open-work-graph` lands before the pane
// exists (the tab is still opening), so the view is also kept here for the
// pane to take when it mounts; a mounted pane takes it through the event.
let pendingView: ReproTourView | null = null;

export function requestReproTour(request: ReproTourRequest): void {
  if (request.kind === "focus-view") pendingView = request.view;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REPRO_TOUR_EVENT, { detail: request }));
}

/** The view the tour asked for most recently and no pane has shown yet;
 *  taking it clears it, so a later pane never opens on a stale request. */
export function takePendingReproView(): ReproTourView | null {
  const view = pendingView;
  pendingView = null;
  return view;
}

/** Subscribes to tour requests; returns the unsubscribe. Payloads are shape
 *  checked before they reach the handler — a stray event of the same name can
 *  never drive navigation with a half-formed request. */
export function onReproTour(handler: ReproTourSink): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent).detail as Partial<ReproTourRequest> | null;
    if (!detail || typeof detail !== "object") return;
    if (detail.kind === "open-demo") {
      handler({ kind: "open-demo" });
      return;
    }
    if (
      detail.kind === "open-bots" &&
      typeof (detail as { workspaceId?: unknown }).workspaceId === "string" &&
      (detail as { workspaceId: string }).workspaceId.length > 0
    ) {
      handler(detail as ReproTourRequest);
      return;
    }
    if (
      (detail.kind === "open-work-graph" || detail.kind === "open-sessions") &&
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
