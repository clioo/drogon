// Pure session-recovery helpers for the V2 terminal surface. Encodes the
// AGENTS.md liveness rule at the UI layer: loss of contact is unverifiable,
// never exited; the execution host owns processes, so the renderer never
// auto-respawns and never fabricates a successful retry — a failed refresh
// keeps the unverifiable verdict and the error text.

import type { Verdict } from "../../shared/session-contract";

export type RecoveryAction =
  | { kind: "none" }
  | { kind: "retry-connection" }
  | { kind: "reveal-output+offer-new" };

/**
 * Maps a session verdict to the recovery affordance the tab may offer.
 * - live: nothing to recover.
 * - unverifiable: the transport lost contact (or a read failed) — offer the
 *   existing refresh/reconnect path; this is never proof of exit.
 * - exited: a confirmed close removes the tab, so an exit is "expected" only
 *   in that already-handled flow; an unexpectedly-exited session keeps its
 *   output visible and gets an explicit New terminal offer. Never auto-respawn.
 */
export function recoveryActionFor(
  verdict: Verdict,
  context: { exitExpected: boolean },
): RecoveryAction {
  if (verdict === "live") return { kind: "none" };
  if (verdict === "unverifiable") return { kind: "retry-connection" };
  return context.exitExpected
    ? { kind: "none" }
    : { kind: "reveal-output+offer-new" };
}

/**
 * Tab label during transport loss: keeps the exact session identity visible
 * so the user can confirm the recovered tab is the same id/incarnation (the
 * audit expectation: tab count retained, refresh recovers the same identity).
 * Live and exited tabs keep their plain label.
 */
export function recoveryTabLabel(input: {
  label: string;
  verdict: Verdict;
  id: string;
  incarnation: string;
}): string {
  if (input.verdict !== "unverifiable") return input.label;
  return `${input.label} · ${input.id}:${input.incarnation}`;
}

/** The retry affordance is inert while a refresh is already in flight. */
export function retryAffordanceDisabled(input: {
  refreshInFlight: boolean;
}): boolean {
  return input.refreshInFlight;
}
