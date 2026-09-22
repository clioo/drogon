/* Which worktree card shows each session.

   A card lists the sessions of its own workspace. An orchestration worker,
   though, runs wherever `drogon-cli orchestration worker-start --workspace`
   puts it — typically a checkout of its own, often a clone under the
   coordinator's `.preflight/` that no project lists as a worktree. That
   workspace has no card, so a live worker was drawn nowhere: on the owner's
   run_4573e2eb (2026-09-21) three live Pi workers in
   `collapsable-widgets/.preflight/sidebar-recovery/workspaces/*` left the
   coordinator's card showing only the coordinator.

   Rules, first match wins:
   1. its own workspace has a card: that card (unchanged; a worker in a real
      worktree keeps its row there and is never drawn twice);
   2. its recorded parent session resolves to a card: that card, so the
      lineage tree nests it under the row that spawned it;
   3. its workspace directory is inside a card's directory: the innermost
      such card, as a root row — where the session physically runs;
   otherwise no card shows it, as before. Every session lands on at most
   one card, so no card count doubles. The Sidebar computes one attribution
   for every card and hands it down through the context below. */
import { createContext } from "react";
import type { Session, Workspace } from "../../../../shared/session-contract";

/** Session id → workspace id of the card that shows the session. */
export type SidebarCardAttribution = ReadonlyMap<string, string>;

/** Null outside a Sidebar: a card rendered alone lists its own sessions. */
export const SidebarCardAttributionContext =
  createContext<SidebarCardAttribution | null>(null);

type CardDirectory = { workspaceId: string; hostId: string; dir: string };

function normalizeDirectory(path: string): string {
  const slashed = path.replace(/\\/g, "/");
  const trimmed = slashed.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function isSameOrInside(dir: string, parent: string): boolean {
  if (dir === parent) return true;
  return dir.startsWith(parent === "/" ? "/" : `${parent}/`);
}

export function attributeSessionsToCards(input: {
  sessions: readonly Session[];
  /** Workspaces that own a card, whether or not a filter hides it now. */
  cardWorkspaceIds: Iterable<string>;
  /** Every registered workspace, for the paths behind rule 3. */
  workspaces: readonly Workspace[];
  /** Sessions another sidebar section already draws (Bot chats): these
   *  keep rule 1 only and are never adopted into a card. */
  shownElsewhere?: ReadonlySet<string>;
}): SidebarCardAttribution {
  const cards = new Set(input.cardWorkspaceIds);
  const workspaceById = new Map(
    input.workspaces.map((workspace) => [workspace.id, workspace]),
  );
  const sessionById = new Map(
    input.sessions.map((session) => [session.id, session]),
  );
  // Longest directory first, so the first containing card is the innermost.
  const cardDirectories: CardDirectory[] = [...cards]
    .flatMap((workspaceId) => {
      const workspace = workspaceById.get(workspaceId);
      return workspace
        ? [
            {
              workspaceId,
              hostId: workspace.hostId,
              dir: normalizeDirectory(workspace.path),
            },
          ]
        : [];
    })
    .sort((a, b) => b.dir.length - a.dir.length);

  const containingCard = (workspaceId: string): string | null => {
    const workspace = workspaceById.get(workspaceId);
    if (!workspace) return null;
    const dir = normalizeDirectory(workspace.path);
    const card = cardDirectories.find(
      (candidate) =>
        candidate.hostId === workspace.hostId &&
        isSameOrInside(dir, candidate.dir),
    );
    return card?.workspaceId ?? null;
  };

  const resolved = new Map<string, string | null>();
  const resolve = (session: Session, visiting: Set<string>): string | null => {
    const known = resolved.get(session.id);
    if (known !== undefined) return known;
    let card: string | null = null;
    if (cards.has(session.workspaceId)) {
      card = session.workspaceId;
    } else if (!input.shownElsewhere?.has(session.id)) {
      const parent = session.parentSessionId
        ? sessionById.get(session.parentSessionId)
        : undefined;
      // A parent chain that loops back is malformed metadata: stop walking
      // and fall through to the directory rule instead of recursing forever.
      if (parent && !visiting.has(parent.id)) {
        visiting.add(session.id);
        card = resolve(parent, visiting);
        visiting.delete(session.id);
      }
      card ??= containingCard(session.workspaceId);
    }
    resolved.set(session.id, card);
    return card;
  };

  const attribution = new Map<string, string>();
  for (const session of input.sessions) {
    const card = resolve(session, new Set([session.id]));
    if (card !== null) attribution.set(session.id, card);
  }
  return attribution;
}

/**
 * Whether `session` belongs on the card of `cardWorkspaceId`. Without an
 * attribution (a caller that renders one card in isolation) a card shows
 * exactly its own workspace's sessions, the behaviour before rules 2–3.
 */
export function isSessionOnCard(
  session: Session,
  cardWorkspaceId: string,
  attribution?: SidebarCardAttribution | null,
): boolean {
  return attribution
    ? attribution.get(session.id) === cardWorkspaceId
    : session.workspaceId === cardWorkspaceId;
}
