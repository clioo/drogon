// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/listing/directory-action-paths.ts.
// Adapter: the MVP entry model (no submodule/conflict fields).

import type { DiscardAllArea } from "./discard-sequence";
import { getDiscardAllPaths, getStageAllPaths, getUnstageAllPaths } from "./discard-sequence";
import type { SourceControlEntry } from "./source-control-entry";

export type SourceControlTreeDirectoryNode = {
  key: string;
  name: string;
  depth: number;
  area: DiscardAllArea;
  fileCount: number;
  entries: SourceControlEntry[];
};

export type SourceControlDirectoryActionPaths = {
  stagePaths: string[];
  unstagePaths: string[];
  discardPaths: string[];
};

/** Bulk paths for one tree-directory row, under the same eligibility rules as the section actions. */
export function getSourceControlDirectoryActionPaths(
  node: Pick<SourceControlTreeDirectoryNode, "area" | "entries">,
): SourceControlDirectoryActionPaths {
  const entries = node.entries;
  return {
    stagePaths:
      node.area === "unstaged" || node.area === "untracked"
        ? getStageAllPaths(entries, node.area)
        : [],
    unstagePaths: node.area === "staged" ? getUnstageAllPaths(entries) : [],
    discardPaths: getDiscardAllPaths(entries, node.area),
  };
}
