import { useEffect, useState } from "react";
import type { GitStatusResult } from "../../../../shared/git-contract";
import { windowCardGitBridge } from "./worktree-bridges";

/**
 * Live `git.status` for one card workspace (branch + ahead/behind +
 * dirty entry counts). Returns null while unavailable — badges and the
 * delete-dialog dirty hint hide rather than invent data. Refetches when
 * the workspace identity changes; callers pass a `refreshKey` (e.g. the
 * dialog open generation) to re-read after outside mutations.
 */
export function useWorktreeGitStatus(args: {
  hostId: string | null;
  workspaceId: string | null;
  enabled: boolean;
  refreshKey?: number;
}): GitStatusResult | null {
  const { hostId, workspaceId, enabled, refreshKey = 0 } = args;
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  useEffect(() => {
    if (!enabled || !hostId || !workspaceId) {
      setStatus(null);
      return;
    }
    let stale = false;
    setStatus(null);
    const bridge = windowCardGitBridge();
    if (!bridge) return;
    bridge
      .gitStatus({ hostId, workspaceId })
      .then((result) => {
        if (!stale) setStatus(result.ok ? result.result : null);
      })
      .catch(() => {
        if (!stale) setStatus(null);
      });
    return () => {
      stale = true;
    };
  }, [enabled, hostId, workspaceId, refreshKey]);
  return status;
}

/** Dirty file count from a status result (staged + unstaged entries). */
export function countDirtyChanges(status: GitStatusResult | null): number {
  return status?.entries.length ?? 0;
}
