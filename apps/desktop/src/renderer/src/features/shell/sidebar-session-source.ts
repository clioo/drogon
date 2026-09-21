/* MIT Copyright (c) 2026 Lovecast Inc.
   The sidebar's session source. `sidebar-sessions.ts` merges whatever the
   shell already has; this module decides what the shell asks the daemon for.
   Why it exists (measured 2026-09-21 on the owner's data directory, 207
   sessions): `session.list` with no `workspaceId` is a single frame, and
   `drogond`'s `write_response` refuses any frame past `MAX_FRAME_BYTES`
   (1 MiB) — the connection closes instead, so one oversized response leaves
   the sidebar with only the SELECTED workspace's sessions and every other
   card silently empty. A scoped `session.list` is bounded by one workspace
   and always answers.
   So: read host-wide while that works (one call, selection-stable order),
   and when it fails, keep every card's rows by reading the workspaces the
   sidebar actually shows, in bounded rotating batches. Nothing here invents
   data: a workspace whose read failed keeps the last list that succeeded,
   and the source reports `degraded` so a caller can say so.
   The daemon-side bound belongs to the protocol (a separate change); this is
   the shell's own honest degradation. Pure state machine, unit-tested. */
import type { Session } from "../../../../shared/session-contract";

/** Workspaces one degraded tick may read: enough to cover a normal sidebar
 *  in a few ticks without turning a 3 s poll into a fan-out. */
export const SIDEBAR_SCOPED_READ_BATCH = 8;

/** Bound on cached per-workspace lists (a deleted worktree's list is pruned
 *  when the workspace ids are known, this only stops unbounded growth). */
export const SIDEBAR_SCOPED_READ_MAX_WORKSPACES = 512;

export type SidebarSessionSourceView = {
  /** Everything the sidebar may render as rows. */
  sessions: Session[];
  /**
   * True while the host-wide read is failing and the scoped reads are what
   * keeps the cards populated. Callers may surface it; nothing here hides it.
   */
  degraded: boolean;
};

export type SidebarSessionCollector = {
  /** A host-wide read succeeded: it is the whole truth again. */
  noteHostWide(sessions: readonly Session[]): void;
  /** A host-wide read failed: fall back to the cached scoped lists. */
  noteHostWideFailure(): void;
  /** The next workspace ids to read, in rotation order. */
  planScopedReads(
    workspaceIds: readonly string[],
    batchSize?: number,
  ): string[];
  /** One workspace's list arrived. */
  noteScoped(workspaceId: string, sessions: readonly Session[]): void;
  /** The current view, without asking the daemon for anything. */
  view(): SidebarSessionSourceView;
  /** True while the last host-wide read failed. */
  isDegraded(): boolean;
};

/**
 * One poll: ask host-wide first, and only when that read fails ask the
 * workspaces the sidebar shows, in the collector's rotation. Every bridge
 * call goes through the injected fetchers, so the whole poll path — the
 * healthy one and the degraded one — is unit-testable without a daemon.
 */
export async function pollSidebarSessions(deps: {
  collector: SidebarSessionCollector;
  workspaceIds: readonly string[];
  fetchHostWide: () => Promise<{ ok: boolean; sessions?: Session[] }>;
  fetchScoped: (
    workspaceId: string,
  ) => Promise<{ ok: boolean; sessions?: Session[] }>;
  batchSize?: number;
}): Promise<SidebarSessionSourceView> {
  const hostWide = await deps.fetchHostWide();
  if (hostWide.ok && Array.isArray(hostWide.sessions)) {
    deps.collector.noteHostWide(hostWide.sessions);
    return deps.collector.view();
  }
  deps.collector.noteHostWideFailure();
  const batch = deps.collector.planScopedReads(
    deps.workspaceIds,
    deps.batchSize ?? SIDEBAR_SCOPED_READ_BATCH,
  );
  const results = await Promise.all(
    batch.map(async (workspaceId) => ({
      workspaceId,
      result: await deps.fetchScoped(workspaceId),
    })),
  );
  for (const { workspaceId, result } of results) {
    // A workspace whose read failed keeps the list it last answered with:
    // one broken workspace never blanks the others.
    if (result.ok && Array.isArray(result.sessions)) {
      deps.collector.noteScoped(workspaceId, result.sessions);
    }
  }
  return deps.collector.view();
}

export function createSidebarSessionCollector(): SidebarSessionCollector {
  let healthy = true;
  let hostWide: Session[] = [];
  const byWorkspaceId = new Map<string, Session[]>();
  // Insertion order is the rotation: the oldest-read workspace is the next
  // one to refresh, so a degraded sidebar still converges on fresh rows.
  let cursor = 0;

  const merged = (): Session[] => {
    const byId = new Map<string, Session>();
    for (const sessions of byWorkspaceId.values()) {
      for (const session of sessions) byId.set(session.id, session);
    }
    return [...byId.values()];
  };

  return {
    noteHostWide(sessions) {
      healthy = true;
      hostWide = [...sessions];
      byWorkspaceId.clear();
      cursor = 0;
    },
    noteHostWideFailure() {
      healthy = false;
      // Keep `hostWide` as the last known full list: a transient failure must
      // not blank the sidebar (the shell's own poll contract).
    },
    planScopedReads(workspaceIds, batchSize = SIDEBAR_SCOPED_READ_BATCH) {
      const wanted = [...new Set(workspaceIds)].slice(
        0,
        SIDEBAR_SCOPED_READ_MAX_WORKSPACES,
      );
      // A workspace that no longer exists must not keep a cached list: its
      // sessions would render under a card that is gone.
      for (const id of [...byWorkspaceId.keys()]) {
        if (!wanted.includes(id)) byWorkspaceId.delete(id);
      }
      if (wanted.length === 0) return [];
      const batch: string[] = [];
      for (let step = 0; step < Math.min(batchSize, wanted.length); step += 1) {
        batch.push(wanted[(cursor + step) % wanted.length]!);
      }
      cursor = (cursor + batch.length) % wanted.length;
      return batch;
    },
    noteScoped(workspaceId, sessions) {
      byWorkspaceId.delete(workspaceId);
      byWorkspaceId.set(workspaceId, [...sessions]);
    },
    view() {
      if (healthy) return { sessions: hostWide, degraded: false };
      const scoped = merged();
      // Nothing scoped has landed yet: the last full list still beats blank.
      return {
        sessions: scoped.length > 0 ? [...scoped, ...hostWide.filter((s) => !scoped.some((row) => row.id === s.id))] : hostWide,
        degraded: true,
      };
    },
    isDegraded() {
      return !healthy;
    },
  };
}
