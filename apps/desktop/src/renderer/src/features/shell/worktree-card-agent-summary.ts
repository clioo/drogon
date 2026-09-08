/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-card-agent-summary.ts
   (adapter: the reference summarizes dashboard agent rows with dot
   states; this repo's card sees Sessions with `agentState`, so the same
   group-order/count projection runs over `agentState` values instead.
   Pure functions, unit-tested.) */
import type { AgentState, Session } from "../../../../shared/session-contract";

// Why: the source's SUMMARY_STATE_ORDER (waiting, blocked, working,
// monitoring, interrupted, done, unverifiable, idle) puts the stale-channel
// marker above true idle — the pane is still held. The same projection over
// this repo's five states: needs_input first, then the live working state,
// the terminal exited state (the source's done), the not-reporting marker,
// and idle last.
const SUMMARY_STATE_ORDER: AgentState[] = [
  "needs_input",
  "working",
  "exited",
  "unknown",
  "idle",
];

export function formatSummaryStateLabel(state: AgentState): string {
  switch (state) {
    case "needs_input":
      return "needs input";
    case "working":
      return "working";
    case "idle":
      return "idle";
    case "exited":
      return "exited";
    case "unknown":
      return "not reporting";
  }
}

/**
 * One-line agent summary for the card meta row, e.g. "2 working, 1 idle"
 * or "All sessions idle" for a uniform group — the same shape as the
 * source's `summarizeAgents`. Empty string when there are no sessions;
 * the card hides the summary then.
 */
/**
 * One-line card summary: the agent summary plus the relative activity
 * time (the fork's compact summary shape). The summary already carries
 * the session count ("1 session working"), so no second count is ever
 * appended. Empty string when there is no summary to show.
 */
export function formatWorktreeCardSummaryLine(
  agentSummary: string,
  activeRelative: string,
): string {
  if (!agentSummary) return "";
  return activeRelative ? `${agentSummary} · ${activeRelative}` : agentSummary;
}

export function summarizeCardAgentStates(sessions: Session[]): string {
  if (sessions.length === 0) return "";
  const counts = new Map<AgentState, number>();
  for (const session of sessions) {
    const state = session.agentState ?? "unknown";
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  const parts = SUMMARY_STATE_ORDER.flatMap((state) => {
    const count = counts.get(state) ?? 0;
    if (count === 0) return [];
    return `${count} ${formatSummaryStateLabel(state)}`;
  });
  if (parts.length === 1) {
    const only = parts[0].replace(/^\d+\s+/, "");
    return sessions.length === 1 ? `1 session ${only}` : `All sessions ${only}`;
  }
  return parts.join(", ");
}
