import { useEffect, useState } from "react";
import { WORKTREE_ISSUE_LINKS_CAPABILITY, type WorktreeIssueLink } from "../../../../shared/worktree-issue-contract";
import { windowProjectBridge, type ProjectGroup } from "./project-adapter";
const EMPTY: ReadonlyMap<string, readonly WorktreeIssueLink[]> = new Map();

/** Associations are fetched independently of visiting Tasks. The cache is
 * bound to project/host/worktree ownership, never to a display title. */
export function useWorktreeIssueLinks(groups: readonly ProjectGroup[], enabled: boolean) {
  const ownershipKey = JSON.stringify(groups.map(({ project, worktrees }) => ({
    id: project.id, hostId: project.hostId, worktreeIds: worktrees.map((w) => w.id).sort(),
  })).sort((a, b) => a.id.localeCompare(b.id)));
  const [snapshot, setSnapshot] = useState<{ ownershipKey: string; links: ReadonlyMap<string, readonly WorktreeIssueLink[]> } | null>(null);
  useEffect(() => {
    const bridge = windowProjectBridge(window.drogon);
    if (!enabled || !bridge.worktreeIssueLinks || !window.drogon?.status) { setSnapshot(null); return; }
    const owners = JSON.parse(ownershipKey) as { id: string; hostId: string; worktreeIds: string[] }[];
    if (owners.length === 0) { setSnapshot(null); return; }
    let cancelled = false;
    let inFlight = false;
    let requested = false;
    let timer: number | undefined;
    const publish = (links: ReadonlyMap<string, readonly WorktreeIssueLink[]>) => {
      if (!cancelled) setSnapshot({ ownershipKey, links });
    };
    async function refresh() {
      if (cancelled) return;
      if (inFlight) { requested = true; return; }
      window.clearTimeout(timer);
      inFlight = true;
      try {
        const status = await window.drogon.status();
        if (cancelled) return;
        if (!status.ok || !status.result.capabilities?.includes(WORKTREE_ISSUE_LINKS_CAPABILITY)) { publish(EMPTY); return; }
        const rows = await Promise.all(owners.filter((owner) => owner.hostId === status.result.hostId).map(async (owner) => {
          try {
            const reply = await bridge.worktreeIssueLinks!({ projectId: owner.id });
            const allowed = new Set(owner.worktreeIds);
            return reply.ok ? reply.result.links.filter((link) => allowed.has(link.worktreeId)) : [];
          } catch { return []; }
        }));
        const links = new Map<string, WorktreeIssueLink[]>();
        for (const link of rows.flat()) links.set(link.worktreeId, [...(links.get(link.worktreeId) ?? []), link]);
        publish(links);
      } catch { publish(EMPTY); }
      finally {
        inFlight = false;
        if (!cancelled) {
          if (requested) { requested = false; void refresh(); }
          else timer = window.setTimeout(() => void refresh(), 5000);
        }
      }
    }
    const unsubscribe = bridge.onProjectsChanged?.(() => void refresh());
    void refresh();
    return () => { cancelled = true; window.clearTimeout(timer); unsubscribe?.(); };
  }, [ownershipKey, enabled]);
  return enabled && snapshot?.ownershipKey === ownershipKey ? snapshot.links : EMPTY;
}
