import type { AgentState, Session } from "../../../../shared/session-contract";

/**
 * Agent-state vocabulary for the shell (journey J1). The contract's five
 * states render as-is; nothing is invented — an unreported state stays
 * `unknown`.
 */
export type AgentIconKind =
  | "working"
  | "idle"
  | "needs-input"
  | "exited"
  | "unknown";

/** Maps a contract state to its shell icon kind (1:1, no invention). */
export function agentIconKind(state: AgentState): AgentIconKind {
  switch (state) {
    case "working":
      return "working";
    case "idle":
      return "idle";
    case "needs_input":
      return "needs-input";
    case "exited":
      return "exited";
    case "unknown":
      return "unknown";
  }
}

/**
 * Accessible label shared by the tab badge and the card dot — the fork's
 * `agentStateLabel` (AgentStateDot.tsx) verbatim for the four mapped states;
 * `exited` has no fork equivalent (a Drogon-only verdict) and keeps its own
 * label. The tooltip copy is the same string.
 */
export function agentStateLabel(state: AgentState): string {
  switch (state) {
    case "working":
      return "Working";
    case "idle":
      return "Idle";
    case "needs_input":
      return "Waiting for input";
    case "exited":
      return "Exited";
    case "unknown":
      return "No recent update";
  }
}

/** Renders `session.agentState ?? "unknown"`; never invents a state. */
export function agentStateOf(session: Session): AgentState {
  return sessionDotState(session);
}

/**
 * The single agent-dot derivation for the whole shell (journey J1),
 * ported from the fork's `getAgentDotState` →
 * `agentRowDotState` (`src/renderer/src/components/sidebar/
 * worktree-card-agent-summary.ts`, `src/renderer/src/lib/
 * agent-row-dot-state.ts`: one function feeds the row dot, the card dot
 * and the summary text so they can never disagree). The fork maps an
 * agent row's (state, workingMode, interrupted) triple; this repo's
 * Session contract carries the already-derived `agentState` (daemon
 * `agent_state::derive`), so the single function reads it, defaulting an
 * unreported state to `unknown` — never a guess. The tab badge, the card
 * dot and the card summary text must all go through this function.
 *
 * `unverifiable` is a verdict, not an agent state: the daemon holds no
 * child for that id (a held, running child always reports `live`), so a
 * `working`/`idle` agent state is history, never a live claim. Rendering
 * it as-is put the owner's "green check" (the row's concluded-turn glyph)
 * and the working spinner on a dead tab. Those two map to `unknown` ("not
 * reporting") here instead; `needs_input`/`exited` keep their own honest
 * meaning (the durable wait signal survives a restart by design).
 */
export function sessionDotState(session: Session): AgentState {
  const state = session.agentState ?? "unknown";
  if (
    session.verdict === "unverifiable" &&
    (state === "working" || state === "idle")
  )
    return "unknown";
  return state;
}
