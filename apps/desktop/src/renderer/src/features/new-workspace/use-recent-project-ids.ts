/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/new-workspace/use-recent-project-ids.ts
   (adapter: recency derives from this repo's ProjectGroup worktrees — the
   daemon's worktree records carry projectId and an ISO createdAt; the
   source's folder-group id prefix does not exist here, option ids are plain
   project ids). */
import { useMemo } from "react";
import type { ProjectGroup } from "../shell/project-adapter";

/**
 * Most-recently-used project option ids, newest first, derived from when the
 * user last created a workspace in each project. Orca stores no explicit
 * per-project recency, and workspace creation is exactly the action this picker
 * is about to repeat, so it's the honest proxy rather than a new store field.
 */
export function orderProjectIdsByRecency(groups: readonly ProjectGroup[]): string[] {
  const newestByProject = new Map<string, number>();
  for (const group of groups) {
    for (const worktree of group.worktrees) {
      const createdAt = Date.parse(worktree.createdAt) || 0;
      const seen = newestByProject.get(group.project.id);
      if (seen === undefined || createdAt > seen) {
        newestByProject.set(group.project.id, createdAt);
      }
    }
  }
  return [...newestByProject.entries()].sort((a, b) => b[1] - a[1]).map(([projectId]) => projectId);
}

export function useRecentProjectIds(groups: readonly ProjectGroup[]): string[] {
  return useMemo(() => orderProjectIdsByRecency(groups), [groups]);
}
