/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/useFileExplorerWatch.ts
   (subscription lifecycle) and file-explorer-watch-refresh-scheduler.ts
   (producer-side batching). Adapted: the producer here is Electron main's
   filesystem watcher (see main/file-bridge.ts) pushing coarse
   workspace ticks over one preload channel instead of the fork's
   per-path fs:changed bus; there is no runtime-RPC leg in this repo. */

import type { FilesWatchBridge } from "../../../../shared/file-contract";

/**
 * The granted `window.drogon.filesWatch.*` namespace. DesktopBridge
 * (coordinator-owned) does not declare it yet, so the cast lives here —
 * one place — rather than at every call site.
 */
export function windowFilesWatchBridge(): FilesWatchBridge | null {
  // `window.drogon` is absent outside Electron (tests, alt hosts).
  const namespace = (
    window.drogon as unknown as { filesWatch?: FilesWatchBridge } | undefined
  )?.filesWatch;
  return namespace ?? null;
}

/**
 * Subscribes to live change ticks for exactly one workspace. Ticks for
 * other workspaces never reach the listener; an absent preload channel
 * subscribes to nothing (the tree still refreshes on its own mutations).
 */
export function subscribeWorkspaceFilesChanged(
  workspaceId: string,
  listener: () => void,
): () => void {
  const bridge = windowFilesWatchBridge();
  if (!bridge) return () => {};
  return bridge.onFilesChanged((tick) => {
    if (tick && tick.workspaceId === workspaceId) listener();
  });
}
