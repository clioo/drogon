/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/FileExplorerRow.tsx (row DOM,
   indent math, chevron/folder/file affordances, git-status and
   git-ignored decorations) and status-display.ts (STATUS_LABELS).
   Adapted, all called out: rows carry role="treeitem" with
   aria-selected/aria-expanded/aria-level (the source leaves the row
   role-less; the tree role here makes the tree operable and keeps the
   rendered acceptance querying treeitems by name), drag-and-drop is out of
   MVP scope so the draggable wiring is gone, and the Radix context menu
   becomes a parent-owned `onContextMenu` callback. */

import { ChevronRight, CircleSlash, Folder, FolderOpen, Link, Loader2 } from "lucide-react";
import { getFileTypeIcon } from "./file-type-icons";
import type { ExplorerNode } from "./tree-model";

export const GIT_STATUS_LABELS: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  copied: "C",
};

export const GIT_STATUS_COLORS: Record<string, string> = {
  modified: "var(--git-decoration-modified)",
  added: "var(--git-decoration-added)",
  deleted: "var(--git-decoration-deleted)",
  renamed: "var(--git-decoration-renamed)",
  untracked: "var(--git-decoration-untracked)",
  copied: "var(--git-decoration-copied)",
};

export function FileExplorerRow({
  node,
  isExpanded,
  isLoading,
  isSelected,
  isIgnored = false,
  rowIndex,
  onClick,
  onDoubleClick,
  onNameDoubleClick,
  onContextMenu,
}: {
  node: ExplorerNode;
  isExpanded: boolean;
  isLoading: boolean;
  isSelected: boolean;
  /** Git-ignored decoration (italic + badge, ignored tint). */
  isIgnored?: boolean;
  rowIndex: number;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onDoubleClick: () => void;
  onNameDoubleClick: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const FileIcon = getFileTypeIcon(node.path);
  const status = node.gitStatus ?? null;
  const statusLabel = status ? (GIT_STATUS_LABELS[status] ?? "") : "";
  const statusColor = status ? (GIT_STATUS_COLORS[status] ?? null) : null;
  return (
    <button
      type="button"
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={node.isDirectory ? isExpanded : undefined}
      aria-level={node.depth + 1}
      data-file-explorer-row=""
      data-row-index={rowIndex}
      data-path={node.path}
      data-selected={isSelected ? "true" : undefined}
      className={
        "flex w-full items-center gap-1 rounded-sm px-2 py-1 text-left text-xs transition-colors " +
        (isSelected
          ? "text-accent-foreground"
          : "hover:bg-accent hover:text-foreground")
      }
      style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {node.isDirectory ? (
        <>
          <ChevronRight
            className={`size-3 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`}
            aria-hidden
          />
          {isLoading ? (
            <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          ) : isExpanded ? (
            <FolderOpen className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <Folder className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          )}
        </>
      ) : (
        <>
          <span className="size-3 shrink-0" aria-hidden />
          {node.isSymlink ? (
            <Link className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <FileIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          )}
        </>
      )}
      <span
        // Italic glyphs overhang their advance width; truncate's
        // overflow:hidden clips it, so pr-0.5 reserves room for the slant.
        className={`truncate${isIgnored ? " italic pr-0.5" : ""}`}
        style={
          status
            ? { color: statusColor ?? undefined }
            : isIgnored
              ? { color: "var(--git-decoration-ignored)" }
              : undefined
        }
        onDoubleClick={(event) => {
          // Renaming is scoped to the filename text so the directory toggle
          // stays reachable on the icon and empty row area.
          event.stopPropagation();
          onNameDoubleClick();
        }}
      >
        {node.name}
      </span>
      {status ? (
        <span
          className="ml-auto mr-2 shrink-0 text-[10px] font-semibold tracking-wide"
          style={{ color: statusColor ?? undefined }}
        >
          {statusLabel}
        </span>
      ) : isIgnored ? (
        <CircleSlash
          aria-label="Ignored by .gitignore"
          className="ml-auto mr-2 size-3 shrink-0"
          style={{ color: "var(--git-decoration-ignored)" }}
        />
      ) : null}
      {node.isSymlink && !node.isDirectory ? (
        <span className="sr-only">symlink</span>
      ) : null}
    </button>
  );
}
