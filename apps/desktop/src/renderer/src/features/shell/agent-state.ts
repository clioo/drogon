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

/** Accessible label shared by the tab badge and the card dot. */
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
      return "No agent update";
  }
}

/** Renders `session.agentState ?? "unknown"`; never invents a state. */
export function agentStateOf(session: Session): AgentState {
  return session.agentState ?? "unknown";
}
