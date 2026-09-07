/**
 * Window-open authority, per the window/browser-host authority contract:
 * the renderer mirrors pages, it does not host or create them. The
 * service owns window creation, placement and privileged-navigation
 * policy, so "allow" is a decision only the host can make (granting a
 * host-managed window). The renderer's local classification below is a
 * PROPOSAL for the request only — the host's `WindowOpenDecision` is
 * authoritative and may differ.
 */
export type WindowOpenOutcome = "allow" | "block" | "open-in-system";

export interface WindowOpenDecision {
  outcome: WindowOpenOutcome;
  /** Why the decision was made; displayed verbatim in the UI. */
  reason: string;
}

/**
 * Renderer-local pre-classification of a window-open intent, used only to
 * pre-fill the request to the authority source. The renderer never
 * proposes "allow" — it cannot create windows, so at most it asks the host
 * to open a URL in the system handler or proposes blocking. Every other
 * outcome (including any host-granted in-app window) is the host's call.
 */
export function classifyWindowOpenRequest(url: string): WindowOpenDecision {
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  const scheme = schemeMatch?.[1]?.toLowerCase() ?? "";
  if (scheme === "http" || scheme === "https") {
    return {
      outcome: "block",
      reason:
        "Renderer windows are host-owned; request loading this URL in the existing tab instead.",
    };
  }
  if (scheme !== "") {
    return {
      outcome: "open-in-system",
      reason: `External protocol "${scheme}:" is not renderable in-app.`,
    };
  }
  return {
    outcome: "block",
    reason: "URL has no admissible scheme.",
  };
}
