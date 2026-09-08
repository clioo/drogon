// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/lib/unread-badge-count.ts (badge counts unread
//   worktrees/tabs and clears on view, not on state exit).
// Adapted: Drogon has no worktree/tab unread maps — the shell owns one
// session list with `agentState` — so the count is the needs_input rows
// minus the currently viewed (active) session. Viewing a waiting session
// clears its badge contribution immediately; the daemon state still exits
// needs_input on its own hook/PTY path.
export type BadgeSession = {
  id: string;
  agentState?: string | null;
};

/** needs_input rows excluding the viewed session (fork: clears when viewed). */
export function unreadDockBadgeCount(
  sessions: readonly BadgeSession[],
  activeSessionId: string | null | undefined,
): number {
  let count = 0;
  for (const session of sessions) {
    if (session.agentState !== "needs_input") continue;
    if (activeSessionId && session.id === activeSessionId) continue;
    count += 1;
  }
  return count;
}
