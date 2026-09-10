/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/worktree-card-agent-summary.ts
   (adapter: the reference summarizes dashboard agent rows with dot
   states; this repo's card sees Sessions with `agentState`, so the same
   group-order/count projection runs over `agentState` values instead.
   Pure functions, unit-tested.) */
import type { AgentState, Session } from "../../../../shared/session-contract";
import { sessionDotState } from "./agent-state";

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

/**
 * The card dot: the first SUMMARY_STATE_ORDER group with a session in it
 * — the same grouped states the summary text counts, so the dot can never
 * name a state the text does not contain (a card reading "2 working, 1
 * idle" dots working; only "All sessions idle" dots idle). Empty input
 * dots `unknown`, like the text hides.
 */
export function cardDotState(sessions: Session[]): AgentState {
  if (sessions.length === 0) return "unknown";
  const present = new Set<AgentState>();
  for (const session of sessions) present.add(sessionDotState(session));
  return SUMMARY_STATE_ORDER.find((state) => present.has(state)) ?? "unknown";
}

/**
 * The worktree's agent identity for the card's status lane: the session that
 * owns the state the lane's glyph is showing (`cardDotState`'s winning
 * group), and only when that session actually reported a harness. The lane
 * draws no avatar for a plain shell or an empty card — the reference's
 * summary pill pairs an AgentStateDot with the AgentIcon of the agents in
 * that same state group (worktree-card-compact-agents.tsx), and this is the
 * same pairing for the single card-level lane.
 */
export function cardIdentitySession(sessions: Session[]): Session | null {
  const identified = sessions.filter(
    (session) => session.harnessId !== null && session.harnessId !== undefined,
  );
  if (identified.length === 0) return null;
  const dot = cardDotState(sessions);
  return (
    identified.find((session) => sessionDotState(session) === dot) ??
    identified[0] ??
    null
  );
}

export function summarizeCardAgentStates(sessions: Session[]): string {
  if (sessions.length === 0) return "";
  const counts = new Map<AgentState, number>();
  for (const session of sessions) {
    const state = sessionDotState(session);
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

/** One same-state cluster of the compact "N agents" summary pill
 *  (the source's `SummaryAgentGroup` over sessions). */
export type SummarySessionGroup = {
  state: AgentState;
  sessions: Session[];
};

/** The source's `buildSummaryAgentGroups`: same-state clusters in
 *  SUMMARY_STATE_ORDER, only groups with members. Feeds the compact
 *  summary pill's state-dot clusters. */
export function buildCardSummaryGroups(
  sessions: Session[],
): SummarySessionGroup[] {
  const groups = new Map<AgentState, Session[]>();
  for (const session of sessions) {
    const state = sessionDotState(session);
    const group = groups.get(state);
    if (group) {
      group.push(session);
    } else {
      groups.set(state, [session]);
    }
  }
  return SUMMARY_STATE_ORDER.flatMap((state) => {
    const groupSessions = groups.get(state);
    return groupSessions ? [{ state, sessions: groupSessions }] : [];
  });
}

/** The source's `summarizeAgentIdentities`, over the per-session harness
 *  label this repo has instead of agent types: "Claude working; Codex exited". */
export function summarizeSessionIdentities(
  sessions: Session[],
  labelFor: (session: Session) => string,
): string {
  return sessions
    .map((session) => {
      const stateLabel = formatSummaryStateLabel(sessionDotState(session));
      return `${labelFor(session)} ${stateLabel}`;
    })
    .join("; ");
}

/** The source's `summarizeAgents` with a count-bearing subject: "2 agents
 *  working" / "2 agents: 1 working, 1 exited" — the compact pill's
 *  aria-label body. */
export function summarizeAgentsForAria(
  sessions: Session[],
  subjectLabel: string,
): string {
  const summary = summarizeCardAgentStates(sessions);
  if (!summary) return subjectLabel;
  const multi = summary.includes(",");
  // The single-session/uniform summaries already carry a subject ("1 session
  // working" / "All sessions working"); replace it with the pill's own count
  // subject so the label reads "2 agents working", like the source.
  const body = summary.replace(/^(?:1 session|All sessions) /, "");
  return multi ? `${subjectLabel}: ${summary}` : `${subjectLabel} ${body}`;
}
