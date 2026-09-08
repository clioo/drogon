/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/FileExplorerFilesTreePane.tsx
   (loading/error/empty gating around the row list, root drag handlers)
   and FileExplorerVirtualRows.tsx (row + inline-input interleaving,
   per-row drop-target highlight math).
   Adapted: no virtualizer (plain list — MVP workspaces are small), no
   download, browser-preview or search-pane branches, and no native OS
   file-drop (import) branch — the internal move drag (R16-BC) is the only
   drag surface. The inline-input slot math (insert after the parent row,
   rename replaces its row) is unchanged. */

import { FileExplorerRow } from "./FileExplorerRow";
import { FileExplorerTreeStatus } from "./FileExplorerTreeStatus";
import { InlineInputRow, type InlineInput } from "./InlineInputRow";
import { useFileExplorerRowDrag } from "./useFileExplorerRowDrag";
import type { SelectionMode } from "./keyboard-navigation";
import { isPathIgnored, type ExplorerNode } from "./tree-model";

/** Internal drag-and-drop bundle owned by FileExplorer (R16-BC). */
export interface ExplorerDnd {
  dragSourcePath: string | null;
  dropTargetDir: string | null;
  isRootDragOver: boolean;
  onRowDragStart: (node: ExplorerNode, event: React.DragEvent<HTMLButtonElement>) => void;
  onRowDragSourceChange: (path: string | null) => void;
  onRowDragTargetChange: (dir: string | null) => void;
  onRowDragExpandDir: (dirPath: string) => void;
  onRowMoveDrop: (sourcePath: string, destDir: string) => void;
  rootDrag: {
    onDragOver: (event: React.DragEvent) => void;
    onDragEnter: (event: React.DragEvent) => void;
    onDragLeave: (event: React.DragEvent) => void;
    onDrop: (event: React.DragEvent) => void;
  };
}

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
  /** Optional drag-and-drop wiring; absent renders inert (non-draggable) rows. */
  dnd?: ExplorerDnd;
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

function parentDirOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

const voidDir = (_dir: string | null) => {};
const voidDirMove = (_source: string, _dest: string) => {};

/**
 * One draggable row: owns the per-row drag hook (legal hooks need a
 * component per row, not a hook inside the slot map). Highlight and
 * handlers are the fork's: `rowDropDir` is the row directory for folders
 * and the containing directory for files, and every row whose parent dir
 * is the active target highlights.
 */
function DraggableExplorerRow({
  node,
  isExpanded,
  isLoading,
  isSelected,
  isIgnored,
  rowIndex,
  dnd,
  onSelectRow,
  onToggleDir,
  onMoveSelection,
  onSelectReplace,
  onStartRename,
  onRowMenu,
  selectedPaths,
}: {
  node: ExplorerNode;
  isExpanded: boolean;
  isLoading: boolean;
  isSelected: boolean;
  isIgnored: boolean;
  rowIndex: number;
  dnd: ExplorerDnd | undefined;
  selectedPaths: ReadonlySet<string>;
  onSelectRow: (node: ExplorerNode) => void;
  onToggleDir: (dirPath: string) => void;
  onMoveSelection: (targetPath: string, mode: SelectionMode) => void;
  onSelectReplace: (path: string) => void;
  onStartRename: (node: ExplorerNode) => void;
  onRowMenu: (node: ExplorerNode, paths: string[], point: { x: number; y: number }) => void;
}) {
  const rowDropDir = node.isDirectory ? node.path : parentDirOf(node.path);
  // Hooks stay unconditional; without a dnd bundle the handlers are
  // inert no-ops and the row renders without draggable wiring.
  const handlers = useFileExplorerRowDrag({
    rowDropDir,
    isDirectory: node.isDirectory,
    nodePath: node.path,
    isExpanded,
    onDragTargetChange: dnd?.onRowDragTargetChange ?? voidDir,
    onDragExpandDir: dnd?.onRowDragExpandDir ?? voidDir,
    onMoveDrop: dnd?.onRowMoveDrop ?? voidDirMove,
  });
  const sourceParentDir =
    dnd?.dragSourcePath != null ? parentDirOf(dnd.dragSourcePath) : null;
  const isInDropTarget =
    dnd != null &&
    dnd.dropTargetDir != null &&
    dnd.dropTargetDir === rowDropDir &&
    dnd.dropTargetDir !== sourceParentDir;
  return (
    <FileExplorerRow
      node={node}
      isExpanded={isExpanded}
      isLoading={node.isDirectory && isLoading}
      isSelected={isSelected}
      isIgnored={isIgnored}
      rowIndex={rowIndex}
      isDropTarget={isInDropTarget}
      rowDrag={
        dnd
          ? {
              onDragStart: (event) => dnd.onRowDragStart(node, event),
              onDragEnd: () => dnd.onRowDragSourceChange(null),
              onDragOver: handlers.handleDragOver,
              onDragEnter: handlers.handleDragEnter,
              onDragLeave: handlers.handleDragLeave,
              onDrop: handlers.handleDrop,
            }
          : undefined
      }
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
    dnd,
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
  // Why: dragging from the root onto the root is a no-op; without the
  // guard the whole pane would highlight for a drop that cannot happen
  // (source reasoning in FileExplorerFilesTreePane.tsx).
  const sourceParentDir =
    dnd?.dragSourcePath != null ? parentDirOf(dnd.dragSourcePath) : null;
  const showRootDragOver = dnd?.isRootDragOver === true && sourceParentDir !== "";

  // Why no tree role: the source (FileExplorerFilesTreePane) renders its rows
  // in a plain scroll container with plain buttons — no role="tree" and no
  // role="treeitem" (see FileExplorerRow). Keyboard stays container-owned.
  return (
    <div
      className={
        "file-explorer-scroll h-full min-h-0 overflow-auto py-2" +
        (showRootDragOver ? " bg-border" : "")
      }
      onDragOver={dnd?.rootDrag.onDragOver}
      onDragEnter={dnd?.rootDrag.onDragEnter}
      onDragLeave={dnd?.rootDrag.onDragLeave}
      onDrop={dnd?.rootDrag.onDrop}
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
          <DraggableExplorerRow
            key={node.path}
            node={node}
            isExpanded={expanded.has(node.path)}
            isLoading={pendingDirs.has(node.path)}
            isSelected={selectedPaths.has(node.path)}
            // Fork status-display.ts: a row under an ignored directory
            // decorates (and hides) with its ancestor.
            isIgnored={
              ignoredPaths !== undefined && isPathIgnored(ignoredPaths, node.path)
            }
            rowIndex={slot.rowIndex}
            dnd={dnd}
            selectedPaths={selectedPaths}
            onSelectRow={onSelectRow}
            onToggleDir={onToggleDir}
            onMoveSelection={onMoveSelection}
            onSelectReplace={onSelectReplace}
            onStartRename={onStartRename}
            onRowMenu={onRowMenu}
          />
        );
      })}
    </div>
  );
}
