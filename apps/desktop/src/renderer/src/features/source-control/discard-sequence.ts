// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/commit/discard-all-sequence.ts
// (path-collection helpers only; the staged unstage-then-revert sequence
// lives in the panel, which calls gitUnstage before gitDiscard).
// Adapter: conflict/submodule fields do not exist in the MVP entry model.

import type { SourceControlEntry } from "./source-control-entry";

export type DiscardAllArea = "staged" | "unstaged" | "untracked";

/**
 * Collect the paths a "Discard all" bulk action should operate on for a given
 * area.
 */
export function getDiscardAllPaths(
  entries: readonly SourceControlEntry[],
  area: DiscardAllArea,
): string[] {
  return entries.filter((entry) => entry.area === area).map((entry) => entry.path);
}

export type StageAllArea = "unstaged" | "untracked";

/** Collect the paths a "Stage all" action should operate on. */
export function getStageAllPaths(
  entries: readonly SourceControlEntry[],
  area: StageAllArea,
): string[] {
  return entries
    .filter((entry) => entry.area === area && isStageableStatusEntry(entry))
    .map((entry) => entry.path);
}

export function isStageableStatusEntry(entry: SourceControlEntry): boolean {
  return entry.area === "unstaged" || entry.area === "untracked";
}

/** Collect the paths an "Unstage all" action should operate on. */
export function getUnstageAllPaths(entries: readonly SourceControlEntry[]): string[] {
  return entries.filter((entry) => entry.area === "staged").map((entry) => entry.path);
}

export type DiscardAllResult = {
  /** Paths whose discard call resolved successfully. */
  discarded: string[];
  /** Paths whose discard call rejected. Best-effort: the loop continues past these. */
  failed: string[];
};

type DiscardAllDeps = {
  /** Discard a single path (restore tracked, or remove untracked). */
  discardOne: (path: string, untracked: boolean) => Promise<void>;
  onError?: (path: string, error: unknown) => void;
};

/**
 * Run the "Discard all" sequence for a given area. Per-file failures are
 * best-effort: the loop continues past a failed file so a single stuck path
 * does not block the rest of the bulk action. Staged areas must be
 * unstaged by the caller first — discarding without that would reset the
 * working tree while the index still carries the delta.
 */
export async function runDiscardAllForArea(
  paths: readonly string[],
  untracked: boolean,
  deps: DiscardAllDeps,
): Promise<DiscardAllResult> {
  const discarded: string[] = [];
  const failed: string[] = [];
  for (const path of paths) {
    try {
      await deps.discardOne(path, untracked);
      discarded.push(path);
    } catch (error) {
      failed.push(path);
      deps.onError?.(path, error);
    }
  }
  return { discarded, failed };
}
