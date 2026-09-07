import type { Result } from "../../../../shared/session-contract";
import type { WindowOpenDecision } from "./window-open-authority";

/** The service's verdict on a navigation request. */
export type NavDecision =
  | { outcome: "allow" }
  | { outcome: "block"; reason: string };

/**
 * The only backend surface the browser UI may touch — injected, never
 * imported. The service owns navigation policy and window authority; the
 * renderer proposes and displays, it does not decide.
 */
export interface BrowserAuthoritySource {
  /** Ask the service to adjudicate a navigation intent for a tab. */
  requestNavigation(input: {
    tabId: string;
    url: string;
    /** The request's fence id; host events for superseded ids are ignored. */
    generation: number;
  }): Promise<Result<NavDecision>>;
  /** Ask the service to adjudicate a window-open intent. */
  requestWindowOpen(input: {
    tabId: string;
    url: string;
  }): Promise<Result<WindowOpenDecision>>;
}
