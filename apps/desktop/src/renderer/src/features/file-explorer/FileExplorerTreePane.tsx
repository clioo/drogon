/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/FileExplorerFilesTreePane.tsx
   (loading/error/empty gating around the row list) and
   FileExplorerVirtualRows.tsx (row + inline-input interleaving).
   Adapted: no virtualizer (plain list — MVP workspaces are small) and no
   drag/drop, download, browser-preview or search-pane branches; the
   inline-input slot math (insert after the parent row, rename replaces
   its row) is unchanged. */

import { FileExplorerRow } from "./FileExplorerRow";
import { FileExplorerTreeStatus } from "./FileExplorerTreeStatus";
import { InlineInputRow, type InlineInput } from "./InlineInputRow";
import type { SelectionMode } from "./keyboard-navigation";
import { isPathIgnored, type ExplorerNode } from "./tree-model";

export interface FileExplorerTreePaneProps {
  rows: readonly ExplorerNode[];
  expanded: ReadonlySet<string>;
  pendingDirs: ReadonlySet<string>;
  selectedPaths: ReadonlySet<string>;
  /** Git-ignored row paths (R16-AM): rendered with the source's ignored tint. */
  ignoredPaths?: ReadonlySet<string>;
  inline: { input: InlineInput; error: string | null } | null;
  hasFilter: boolean;
  filterLoading: boolean;
  filterError: string | null;
  onSelectRow: (node: ExplorerNode) => void;
  onToggleDir: (dirPath: string) => void;
  onMoveSelection: (targetPath: string, mode: SelectionMode) => void;
  onSelectReplace: (path: string) => void;
  onStartRename: (node: ExplorerNode) => void;
  onRowMenu: (node: ExplorerNode, paths: string[], point: { x: number; y: number }) => void;
  onBackgroundMenu: (point: { x: number; y: number }) => void;
  onBackgroundDoubleClick: () => void;
  onSubmitInline: (value: string) => boolean;
  onCancelInline: () => void;
}

type Slot =
  | { kind: "row"; node: ExplorerNode; rowIndex: number }
  | { kind: "input" };

function buildSlots(
  rows: readonly ExplorerNode[],
  inline: { input: InlineInput; error: string | null } | null,
): Slot[] {
  if (!inline) {
    return rows.map((node, rowIndex) => ({ kind: "row" as const, node, rowIndex }));
  }
  const { input } = inline;
  if (input.type === "rename") {
    return rows.map((node, rowIndex) =>
      node.path === input.existingPath
        ? ({ kind: "input" } as Slot)
        : ({ kind: "row", node, rowIndex } as Slot),
    );
  }
  const parentIndex =
    input.parentPath === ""
      ? -1
      : rows.findIndex((row) => row.path === input.parentPath);
  const insertAt = parentIndex === -1 ? 0 : parentIndex + 1;
  const slots: Slot[] = [];
  rows.forEach((node, rowIndex) => {
    if (rowIndex === insertAt) slots.push({ kind: "input" });
    slots.push({ kind: "row", node, rowIndex });
  });
  if (insertAt >= rows.length) slots.push({ kind: "input" });
  return slots;
}

function inInteractiveSurface(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return (
    el.closest('[data-file-explorer-row],[role="menu"],[role="alertdialog"]') !== null
  );
}

export function FileExplorerTreePane(props: FileExplorerTreePaneProps) {
  const {
    rows,
    expanded,
    pendingDirs,
    selectedPaths,
    ignoredPaths,
    inline,
    hasFilter,
    filterLoading,
    filterError,
    onSelectRow,
    onToggleDir,
    onMoveSelection,
    onSelectReplace,
    onStartRename,
    onRowMenu,
    onBackgroundMenu,
    onBackgroundDoubleClick,
    onSubmitInline,
    onCancelInline,
  } = props;

  if (rows.length === 0 && !inline) {
    return (
      <FileExplorerTreeStatus
        isLoading={hasFilter && filterLoading}
        error={hasFilter ? filterError : null}
        isEmpty={!(hasFilter && filterLoading) && !filterError}
        emptyMessage={hasFilter ? "No files match this filter" : undefined}
      />
    );
  }

  const slots = buildSlots(rows, inline);

  // Why no tree role: the source (FileExplorerFilesTreePane) renders its rows
  // in a plain scroll container with plain buttons — no role="tree" and no
  // role="treeitem" (see FileExplorerRow). Keyboard stays container-owned.
  return (
    <div
      className="file-explorer-scroll h-full min-h-0 overflow-auto py-2"
      onContextMenu={(event) => {
        if (inInteractiveSurface(event.target)) return;
        event.preventDefault();
        onBackgroundMenu({ x: event.clientX, y: event.clientY });
      }}
      onDoubleClick={(event) => {
        if (inInteractiveSurface(event.target)) return;
        onBackgroundDoubleClick();
      }}
    >
      {slots.map((slot, index) => {
        if (slot.kind === "input" && inline) {
          return (
            <InlineInputRow
              key={`inline-${inline.input.parentPath}-${inline.input.type}`}
              depth={inline.input.depth}
              inlineInput={inline.input}
              error={inline.error}
              onSubmit={onSubmitInline}
              onCancel={onCancelInline}
            />
          );
        }
        if (slot.kind !== "row") return null;
        const node = slot.node;
        return (
          <FileExplorerRow
            key={node.path}
            node={node}
            isExpanded={expanded.has(node.path)}
            isLoading={node.isDirectory && pendingDirs.has(node.path)}
            isSelected={selectedPaths.has(node.path)}
            // Fork status-display.ts: a row under an ignored directory
            // decorates (and hides) with its ancestor.
            isIgnored={
              ignoredPaths !== undefined && isPathIgnored(ignoredPaths, node.path)
            }
            rowIndex={slot.rowIndex}
            onClick={(event) => {
              if (event.shiftKey) {
                onMoveSelection(node.path, "range");
                return;
              }
              if (event.metaKey || event.ctrlKey) {
                onMoveSelection(node.path, "toggle");
                return;
              }
              onSelectReplace(node.path);
              if (node.isDirectory) onToggleDir(node.path);
              else onSelectRow(node);
            }}
            onDoubleClick={() => {
              if (!node.isDirectory) onSelectRow(node);
            }}
            onNameDoubleClick={() => onStartRename(node)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRowMenu(node, [...selectedPaths], {
                x: event.clientX,
                y: event.clientY,
              });
            }}
          />
        );
      })}
    </div>
  );
}
