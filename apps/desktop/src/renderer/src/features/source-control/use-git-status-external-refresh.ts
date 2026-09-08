// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/useGitStatusPolling.ts
// (STATUS_SAFETY_INTERVAL_MS = 60_000 safety floor) and
// git-status-file-watch-refresh.ts (filesystem-signal refresh). Adapter:
// the producer is Electron main's coarse workspace-changed tick
// (file-explorer/files-watch) instead of the fork's per-path fs:changed bus,
// and the slow floor is the only timer — the fork's debounce/scheduler
// machinery has no MVP counterpart.
import { useEffect } from "react";
import { subscribeWorkspaceFilesChanged } from "../file-explorer/files-watch";

/** Fork parity (useGitStatusPolling.ts): slow floor under every refresh trigger. */
export const GIT_STATUS_SAFETY_INTERVAL_MS = 60_000;

/**
 * Re-reads git status when the world changes under the panel: a
 * files-changed tick for this workspace (edits or `git add` done from a
 * terminal — the watcher's coarse tick covers the working tree) and a slow
 * safety poll for what watchers miss (index-only changes on repos where the
 * watcher ignores `.git`). `refresh` must be referentially stable.
 */
export function useGitStatusExternalRefresh(workspaceId: string, refresh: () => void): void {
  useEffect(() => {
    if (!workspaceId) return;
    return subscribeWorkspaceFilesChanged(workspaceId, refresh);
  }, [workspaceId, refresh]);

  useEffect(() => {
    const timer = window.setInterval(refresh, GIT_STATUS_SAFETY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);
}
