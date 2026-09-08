// MIT Copyright (c) 2026 Lovecast Inc. #302: an editor tab whose file is
// deleted (Explorer context menu or externally) must never sit stale with
// a file-not-found alert. Fork parity target: the tab survives as a
// tombstone with its label struck through and a "deleted" badge
// (EditorFileTab.tsx isMissingFileMutation over externalMutation from
// editor-external-watch-event-reconciliation.ts). Adaptation: this
// build's watcher tick is workspace-coarse (which workspace changed,
// never what — see FilesChangedTick), so deletion is detected by
// RECONCILIATION, not by events: on each tick every open file tab's
// directory is re-listed (the same bounded listing the Explorer tree
// reconciles with) and a basename that stops appearing marks its tab.
// The fork's "renamed" badge needs per-path events (it correlates a
// delete with a same-basename create in one batch); this probe can only
// honestly ever say "deleted" — the fork also marks uncorrelated renames
// "deleted", so the visible outcome matches for external renames.
import { useEffect, useRef } from "react";
import {
  MAX_DIRECTORY_ENTRIES,
  type FileBridge,
} from "../../../../shared/file-contract";
import type { EditorTabMissingKind } from "../shell/editor-tab";

/** Workspace scope of the probed tabs (FileScope minus the per-call path,
 *  which the reconciliation supplies per directory listing). */
export type EditorTabProbeScope = {
  hostId: string;
  workspaceId: string;
};

export type EditorTabMissingProbeInput = {
  scope: EditorTabProbeScope;
  /** Every open file tab in the CURRENT workspace (path + tabId). */
  tabs: ReadonlyArray<{ tabId: string; path: string }>;
  bridge: Pick<FileBridge, "fileList">;
  subscribeFilesChanged: (listener: () => void) => () => void;
  onMissing: (tabId: string, kind: EditorTabMissingKind) => void;
  /** A previously-missing path reappeared: clear its tombstone. */
  onPresent: (tabId: string) => void;
};

/**
 * Reconciles open editor tabs against the filesystem on every workspace
 * change tick. One listing per DISTINCT parent directory of open tabs per
 * tick (bounded like the explorer's own reload). A truncated listing
 * proves nothing about any basename beyond its page, so it marks nothing
 * (honest-unverifiable, matching the rehydrate rule for non-not_found
 * reads); a present basename clears a stale tombstone (the fork clears
 * deleted/renamed marks when the file reappears).
 */
export function reconcileEditorTabsOnTick(
  input: EditorTabMissingProbeInput,
): Promise<void> {
  const { scope, tabs, bridge, onMissing, onPresent } = input;
  if (tabs.length === 0) return Promise.resolve();
  type DirTab = { tabId: string; path: string; name: string };
  const tabsByDir = new Map<string, DirTab[]>();
  for (const tab of tabs) {
    const at = tab.path.lastIndexOf("/");
    const dir = at === -1 ? "." : tab.path.slice(0, at);
    const name = at === -1 ? tab.path : tab.path.slice(at + 1);
    const bucket = tabsByDir.get(dir) ?? [];
    bucket.push({ tabId: tab.tabId, path: tab.path, name });
    tabsByDir.set(dir, bucket);
  }
  return Promise.all(
    [...tabsByDir].map(async ([dir, dirTabs]) => {
      const result = await bridge.fileList({
        ...scope,
        path: dir,
        limitEntries: MAX_DIRECTORY_ENTRIES,
      });
      if (!result.ok) return; // Unverifiable tick: never marks anything.
      if (result.result.truncated) return; // Page cut off: proves nothing.
      const present = new Set(
        result.result.entries.map((entry) => entry.name),
      );
      for (const tab of dirTabs) {
        if (present.has(tab.name)) onPresent(tab.tabId);
        else onMissing(tab.tabId, "deleted");
      }
    }),
  ).then(() => undefined);
}

/**
 * Effectful wrapper for App: subscribes once per workspace and reconciles
 * on every tick. Tick callbacks read refs, so re-renders never drop the
 * subscription.
 */
export function useEditorTabMissingReconciler(input: EditorTabMissingProbeInput): void {
  const inputRef = useRef(input);
  inputRef.current = input;
  const { scope, subscribeFilesChanged } = input;
  const scopeKey = `${scope.hostId}`;
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const unsubscribe = subscribeFilesChanged(() => {
      if (inFlight) return; // Coalesce: the latest state rides the next tick.
      const current = inputRef.current;
      if (current.tabs.length === 0) return;
      inFlight = true;
      void reconcileEditorTabsOnTick(current).finally(() => {
        inFlight = false;
      });
    });
    return () => {
      cancelled = true;
      void cancelled;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, subscribeFilesChanged]);
}
