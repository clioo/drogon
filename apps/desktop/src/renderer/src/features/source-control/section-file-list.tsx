// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/listing/section-file-list.tsx.
// Adapter: no virtualized list primitive in this repo, so rows render
// directly (the status entry cap bounds the list); submodule placeholders
// have no MVP data and are not ported. Tree mode groups by directory with
// the source's collapsible directory rows; list mode renders flat rows.

import React, { useMemo } from "react";
import type { DiscardAllArea } from "./discard-sequence";
import type { SourceControlTreeDirectoryNode } from "./directory-action-paths";
import { getSourceControlDirectoryActionPaths } from "./directory-action-paths";
import { SourceControlTreeDirectoryRow } from "./tree-directory-rows";
import { UncommittedEntryRow } from "./uncommitted-entry-row";
import { rowKey, type SourceControlEntry } from "./source-control-entry";

export type SourceControlViewMode = "list" | "tree";

type FileTreeNode =
  | { type: "directory"; node: SourceControlTreeDirectoryNode }
  | { type: "file"; entry: SourceControlEntry; depth: number };

/** Groups flat entries into sorted directory nodes with nested file rows. */
export function buildFileTree(
  entries: readonly SourceControlEntry[],
  area: DiscardAllArea,
): FileTreeNode[] {
  const byDir = new Map<string, SourceControlEntry[]>();
  const rootFiles: SourceControlEntry[] = [];
  for (const entry of entries) {
    const slash = entry.path.lastIndexOf("/");
    if (slash === -1) {
      rootFiles.push(entry);
    } else {
      const dir = entry.path.slice(0, slash);
      const list = byDir.get(dir);
      if (list) list.push(entry);
      else byDir.set(dir, [entry]);
    }
  }
  const nodes: FileTreeNode[] = rootFiles.map((entry) => ({ type: "file", entry, depth: 0 }) as FileTreeNode);
  for (const dir of [...byDir.keys()].sort()) {
    const dirEntries = byDir.get(dir)!.slice().sort((a, b) => a.path.localeCompare(b.path));
    nodes.push({
      type: "directory",
      node: {
        key: `${area}::dir::${dir}`,
        name: dir,
        depth: 0,
        area,
        fileCount: dirEntries.length,
        entries: dirEntries,
      },
    });
    for (const entry of dirEntries) {
      nodes.push({ type: "file", entry, depth: 1 });
    }
  }
  return nodes;
}

export function SourceControlSectionFileList({
  entries,
  area,
  sourceControlViewMode,
  normalizedFilter,
  isExecutingBulk,
  collapsedTreeDirs,
  toggleTreeDir,
  requestDiscardPaths,
  handleStageAllPaths,
  handleUnstagePaths,
  selectedKeySet,
  activeOpenRowKeys,
  handleSelect,
  handleContextMenu,
  handleOpenDiff,
  handleStage,
  handleUnstage,
  requestDiscardEntry,
}: {
  entries: readonly SourceControlEntry[];
  area: DiscardAllArea;
  sourceControlViewMode: SourceControlViewMode;
  normalizedFilter: string;
  isExecutingBulk: boolean;
  collapsedTreeDirs: Set<string>;
  toggleTreeDir: (key: string) => void;
  requestDiscardPaths: (area: DiscardAllArea, paths: readonly string[]) => void;
  handleStageAllPaths: (paths: readonly string[]) => Promise<void>;
  handleUnstagePaths: (paths: readonly string[]) => Promise<void>;
  selectedKeySet: ReadonlySet<string>;
  activeOpenRowKeys: ReadonlySet<string>;
  handleSelect: (key: string) => void;
  handleContextMenu: (key: string) => void;
  handleOpenDiff: (entry: SourceControlEntry) => void;
  handleStage: (path: string) => Promise<void>;
  handleUnstage: (path: string) => Promise<void>;
  requestDiscardEntry: (entry: SourceControlEntry) => void;
}): React.JSX.Element {
  const tree = useMemo(
    () =>
      sourceControlViewMode === "tree" ? buildFileTree(entries, area) : null,
    [sourceControlViewMode, entries, area],
  );

  const renderRow = (entry: SourceControlEntry, depth: number, showPathHint: boolean) => {
    const key = rowKey(entry.area, entry.path);
    return (
      <UncommittedEntryRow
        key={key}
        entryKey={key}
        entry={entry}
        depth={depth}
        selected={selectedKeySet.has(key)}
        isOpenFile={activeOpenRowKeys.has(key)}
        onSelect={handleSelect}
        onContextMenu={handleContextMenu}
        onOpen={handleOpenDiff}
        onStage={handleStage}
        onUnstage={handleUnstage}
        onDiscard={requestDiscardEntry}
        showPathHint={showPathHint}
      />
    );
  };

  if (sourceControlViewMode === "tree" && tree) {
    return (
      <>
        {tree.map((node) => {
          if (node.type === "directory") {
            const collapsed = collapsedTreeDirs.has(node.node.key);
            return (
              <React.Fragment key={node.node.key}>
                <SourceControlTreeDirectoryRow
                  node={node.node}
                  actionPaths={getSourceControlDirectoryActionPaths(node.node)}
                  hideBulkActions={Boolean(normalizedFilter)}
                  isExecutingBulk={isExecutingBulk}
                  isCollapsed={collapsed}
                  onToggle={() => toggleTreeDir(node.node.key)}
                  onRequestDiscardPaths={requestDiscardPaths}
                  onStagePaths={handleStageAllPaths}
                  onUnstagePaths={handleUnstagePaths}
                />
                {!collapsed &&
                  node.node.entries.map((entry) => renderRow(entry, 1, false))}
              </React.Fragment>
            );
          }
          return renderRow(node.entry, node.depth, false);
        })}
      </>
    );
  }

  return (
    <>
      {entries.map((entry) => renderRow(entry, 0, true))}
    </>
  );
}
