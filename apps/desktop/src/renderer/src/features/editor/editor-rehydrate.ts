// MIT Copyright (c) 2026 Lovecast Inc.
// R16-AJ (fixes #215): pure rehydrate planner for persisted editor tabs.
// The tab-strip envelope stores open file paths per workspace; on workspace
// load the app reopens the ones that still exist on disk and are not
// already open. Existence itself is checked by the caller through the files
// bridge (a missing file is skipped, never resurrected as an empty tab),
// so this planner only decides *candidates*: stored order, deduped, minus
// already-open paths. Unsaved drafts are IN-MEMORY ONLY (see
// ../workspaces/files-draft-store.ts) and cannot survive a restart — the
// fork behaves the same; the dirty-tab close guard is the only protection.

/**
 * Stored editor paths worth reopening: stored order, deduped, excluding
 * paths already open in this workspace. Pure so the workspace-load path in
 * App stays unit-tested without mounting.
 */
export function planEditorRehydrate(input: {
  storedPaths: readonly string[];
  openPaths: readonly string[] | ReadonlySet<string>;
}): string[] {
  const open =
    input.openPaths instanceof Set
      ? input.openPaths
      : new Set(input.openPaths);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const path of input.storedPaths) {
    if (open.has(path) || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}
