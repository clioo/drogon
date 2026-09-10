/* MIT Copyright (c) 2026 Lovecast Inc.
   The sidebar's own session view. The reference's worktree cards always list
   their own workspace's agents (`WorktreeCardAgents` /
   `worktree-card-compact-agents.tsx` read the store's tabs by worktree), and
   its list order never depends on which workspace is active — so the
   sidebar must be fed a session list that covers the WHOLE host, not the
   selected workspace's slice.
   Bug (round 2): App fed the sidebar its `selected`-scoped session list, so
   a card for any other worktree saw zero sessions — `WorktreeCard` rendered
   no nested rows for it, and ProjectList's "Sort by: Recent"/"Smart"
   comparator (`latestWorktreeActivityAt(worktree, sessions)`) collapsed to
   the worktree's `createdAt`. Clicking a card therefore moved it to the top
   of the list and emptied the card below it.
   Adapter: Orca reads one store; this repo polls `session.list` host-wide
   (`window.drogon.sessions()` with no workspaceId) and merges the selected
   workspace's fresher push-updated copies on top. */
import type { Session } from "../../../../shared/session-contract";

/** Session ids that must never appear as sidebar rows (split second panes,
 *  R16-N: only root sessions own strip tabs and cards). */
export type SplitSecondaryIds = ReadonlySet<string>;

/**
 * Host-wide sessions for the sidebar, freshest copy per id winning:
 * `selectedWorkspaceSessions` overrides `hostWideSessions` for any id both
 * contain (the freshly pushed copies of the workspace being looked at), and
 * split second panes are dropped.
 *
 * The result is a pure union: it contains every session the host reports,
 * so which workspace is selected can only change a session's freshness, not
 * its presence. Card order and card rows are therefore selection-stable.
 */
export function sidebarSessionView(
  hostWideSessions: readonly Session[],
  selectedWorkspaceSessions: readonly Session[],
  splitSecondaryIds: SplitSecondaryIds,
): Session[] {
  const merged = new Map<string, Session>();
  for (const session of hostWideSessions) {
    if (splitSecondaryIds.has(session.id)) continue;
    merged.set(session.id, session);
  }
  for (const session of selectedWorkspaceSessions) {
    if (splitSecondaryIds.has(session.id)) continue;
    merged.set(session.id, session);
  }
  return [...merged.values()];
}
