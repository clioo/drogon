/* MIT Copyright (c) 2026 Lovecast Inc.
   The worktree card's agent-activity projection (owner's sidebar design,
   2026-09-21). One uppercase sentence under the card title plus each row's
   own state dot + label (`worktree-agent-rows.ts`). Both read
   `sessionAgentState`, as do the tab badge and the summary pill. */
import type { AgentState, Session } from "../../../../shared/session-contract";
import { sessionAgentState } from "./agent-state";
import { resolveRowHarnessId } from "./worktree-agent-rows";

/**
 * The card's activity class, in the owner's design order: an agent waiting
 * on the user wins over work in progress, which wins over a quiet card; a
 * card whose sessions never reported is "not reporting", never "no active
 * agents". A card with no known agent at all (plain terminals only) is its
 * own class: its sessions are not agents, so no agent noun may name them.
 */
export type WorktreeActivityClass =
  | "needs-input"
  | "working"
  | "no-active-agents"
  | "not-reporting"
  | "terminal-session"
  | "no-session";

/** Sessions with a known harness (launched or observed): the only countable agents. */
function knownAgentSessions(sessions: readonly Session[]): Session[] {
  return sessions.filter((session) => resolveRowHarnessId(session) !== null);
}

function countInState(sessions: readonly Session[], state: AgentState): number {
  return sessions.filter((session) => sessionAgentState(session) === state).length;
}

export function worktreeActivityClass(
  sessions: readonly Session[],
): WorktreeActivityClass {
  if (sessions.length === 0) return "no-session";
  if (countInState(sessions, "needs_input") > 0) return "needs-input";
  if (countInState(sessions, "working") > 0) return "working";
  // Plain shells cannot report these states (harness-less `working` reads
  // `unknown`; `needs_input` requires hooks, which require a launch), so
  // the counts above are agent counts without further filtering.
  if (knownAgentSessions(sessions).length === 0) return "terminal-session";
  const notReporting = sessions.filter(
    (session) => sessionAgentState(session) === "unknown",
  ).length;
  if (notReporting === sessions.length) return "not-reporting";
  return "no-active-agents";
}

function agentNoun(count: number): string {
  return count === 1 ? "AGENT" : "AGENTS";
}

/**
 * The uppercase sentence under the card title. Agent nouns count known
 * agents only: unidentified shells never inflate them, and a card holding
 * only plain terminals names its sessions (`1 TERMINAL SESSION`), never a
 * fabricated agent and never NO SESSION.
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
  if (activity === "terminal-session") {
    return sessions.length === 1
      ? "1 TERMINAL SESSION"
      : `${sessions.length} TERMINAL SESSIONS`;
  }
  if (activity === "not-reporting") {
    const count = knownAgentSessions(sessions).filter(
      (session) => sessionAgentState(session) === "unknown",
    ).length;
    return `${count} ${agentNoun(count)} NOT REPORTING`;
  }
  return "NO ACTIVE AGENTS";
}

/**
 * The card's live activity glyph (spinner while an agent works, the amber
 * bell while one waits for the user, nothing once the card is quiet).
 */
export function worktreeActivityGlyph(
  sessions: readonly Session[],
): "working" | "needs-input" | null {
  const activity = worktreeActivityClass(sessions);
  return activity === "working" || activity === "needs-input" ? activity : null;
}
