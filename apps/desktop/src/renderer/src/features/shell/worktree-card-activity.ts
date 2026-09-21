/* MIT Copyright (c) 2026 Lovecast Inc.
   The worktree card's agent-activity projection (owner's sidebar design,
   2026-09-21). The card's left lane carries the workspace STATUS ring
   (`workspace-status-ring.tsx`); the activity the ring used to carry lives
   in two honest places instead: this module's one-line sentence under the
   card title, and each row's own state dot + label
   (`worktree-agent-rows.ts`). Both read `sessionDotState`, the single
   derivation the tab badge and the card already share, so no surface can
   disagree about what an agent is doing.
   The ring's own vocabulary (working / no active agents / no session) is
   therefore expressed as text here, never as a second, competing colour.
   Pure functions, unit-tested. */
import type { AgentState, Session } from "../../../../shared/session-contract";
import { sessionDotState } from "./agent-state";

/**
 * The card's activity class, in the owner's design order: an agent waiting
 * on the user wins over work in progress, which wins over a quiet card; a
 * card whose sessions never reported is "not reporting", never "no active
 * agents" (that sentence would claim knowledge this repo does not have).
 */
export type WorktreeActivityClass =
  | "needs-input"
  | "working"
  | "no-active-agents"
  | "not-reporting"
  | "no-session";

/** How many sessions sit in the class the sentence names. */
function countInState(sessions: readonly Session[], state: AgentState): number {
  return sessions.filter((session) => sessionDotState(session) === state).length;
}

export function worktreeActivityClass(
  sessions: readonly Session[],
): WorktreeActivityClass {
  if (sessions.length === 0) return "no-session";
  if (countInState(sessions, "needs_input") > 0) return "needs-input";
  if (countInState(sessions, "working") > 0) return "working";
  const notReporting = sessions.filter(
    (session) => sessionDotState(session) === "unknown",
  ).length;
  if (notReporting === sessions.length) return "not-reporting";
  return "no-active-agents";
}

function agentNoun(count: number): string {
  return count === 1 ? "AGENT" : "AGENTS";
}

/**
 * The uppercase sentence under the card title, e.g. `2 AGENTS WORKING`,
 * `1 AGENT NEEDS INPUT`, `NO ACTIVE AGENTS`, `NO SESSION`. Empty string is
 * never returned: the sentence is the card's whole activity statement, and
 * "nothing to say" does not exist here — an empty card says `NO SESSION`.
 */
export function worktreeActivitySentence(
  sessions: readonly Session[],
): string {
  const activity = worktreeActivityClass(sessions);
  if (activity === "no-session") return "NO SESSION";
  if (activity === "needs-input") {
    const count = countInState(sessions, "needs_input");
    return `${count} ${agentNoun(count)} NEED${count === 1 ? "S" : ""} INPUT`;
  }
  if (activity === "working") {
    const count = countInState(sessions, "working");
    return `${count} ${agentNoun(count)} WORKING`;
  }
  if (activity === "not-reporting") {
    return `${sessions.length} ${agentNoun(sessions.length)} NOT REPORTING`;
  }
  return "NO ACTIVE AGENTS";
}

/**
 * The card's live activity glyph (spinner while an agent works, the amber
 * bell while one waits for the user, nothing once the card is quiet): the
 * ring beside it belongs to the workspace status, so the one signal that
 * must never be hidden behind text keeps its own slot.
 */
export function worktreeActivityGlyph(
  sessions: readonly Session[],
): "working" | "needs-input" | null {
  const activity = worktreeActivityClass(sessions);
  return activity === "working" || activity === "needs-input" ? activity : null;
}
