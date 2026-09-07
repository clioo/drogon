/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/file-explorer-row-context-menu.tsx
   (item set, order and icons) and FileExplorerBackgroundMenu.tsx
   (background New File / New Folder). Adapted: this repo has no Radix
   context-menu primitive, so both menus render as lightweight fixed
   layers (role="menu") owned by the tree pane; remote-only actions
   (download, Copy, duplicate, browser/markdown previews, collapse-folder,
   find-in-folder, add-as-project) are out of MVP scope and never appear.
   Reveal in Finder and Open in Terminal are present per the task contract:
   reveal has no shell bridge in this repo (disabled with the reason as its
   title — see FileExplorerTreePane for the attempted wiring), while Open
   in Terminal is hosted by the Files panel through session.start. */

import { useEffect, useRef } from "react";
import { Copy, ExternalLink, FilePlus, FolderPlus, Pencil, SquareTerminal, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  buildBackgroundMenuItems,
  buildRowMenuItems,
  type ExplorerCapabilities,
  type RowMenuItem,
  type RowMenuItemId,
} from "./explorer-policy";
import type { ExplorerNode } from "./tree-model";

const ITEM_ICONS: Record<RowMenuItemId, React.ReactNode> = {
  "new-file": <FilePlus className="size-3.5 shrink-0" aria-hidden />,
  "new-folder": <FolderPlus className="size-3.5 shrink-0" aria-hidden />,
  "copy-path": <Copy className="size-3.5 shrink-0" aria-hidden />,
  "copy-relative-path": <Copy className="size-3.5 shrink-0" aria-hidden />,
  "open-in-terminal": <SquareTerminal className="size-3.5 shrink-0" aria-hidden />,
  "reveal-in-finder": <ExternalLink className="size-3.5 shrink-0" aria-hidden />,
  rename: <Pencil className="size-3.5 shrink-0" aria-hidden />,
  delete: <Trash2 className="size-3.5 shrink-0" aria-hidden />,
};

function MenuLayer({
  point,
  label,
  onClose,
  children,
}: {
  point: { x: number; y: number };
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!layerRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);
  // Clamp near the viewport corner so the menu never opens off-screen.
  const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight;
  const x = Math.min(point.x, viewportWidth - 260);
  const y = Math.min(point.y, viewportHeight - 320);
  return (
    <div
      ref={layerRef}
      role="menu"
      aria-label={label}
      className="fixed z-50 w-60 rounded-md border border-border bg-popover p-1 shadow-md"
      style={{ left: Math.max(4, x), top: Math.max(4, y) }}
    >
      {children}
    </div>
  );
}

function MenuItemButton({
  item,
  onSelect,
}: {
  item: RowMenuItem | { id: string; label: string; disabled?: boolean; disabledReason?: string; shortcut?: string; destructive?: boolean; separatorBefore?: boolean };
  onSelect: () => void;
}) {
  return (
    <>
      {"separatorBefore" in item && item.separatorBefore && (
        <div role="separator" className="mx-1 my-1 h-px bg-border" />
      )}
      <button
        type="button"
        role="menuitem"
        disabled={item.disabled}
        title={item.disabled ? (item.disabledReason ?? item.label) : undefined}
        className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none ${
          item.disabled
            ? "cursor-not-allowed opacity-50"
            : item.destructive
              ? "text-destructive hover:bg-destructive/10"
              : "hover:bg-accent hover:text-accent-foreground"
        }`}
        onClick={() => {
          if (item.disabled) return;
          onSelect();
        }}
      >
        {ITEM_ICONS[item.id as RowMenuItemId] ?? null}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.shortcut && (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            {item.shortcut}
          </span>
        )}
      </button>
    </>
  );
}

export function FileExplorerRowMenu({
  node,
  selectionSize,
  caps,
  point,
  onAction,
  onClose,
}: {
  node: ExplorerNode;
  selectionSize: number;
  caps: ExplorerCapabilities;
  point: { x: number; y: number };
  onAction: (id: RowMenuItemId) => void;
  onClose: () => void;
}) {
  const items = buildRowMenuItems(node, selectionSize, caps);
  return (
    <MenuLayer point={point} label={`Actions for ${node.name}`} onClose={onClose}>
      {items.map((item) => (
        <MenuItemButton
          key={item.id}
          item={item}
          onSelect={() => {
            onClose();
            onAction(item.id);
          }}
        />
      ))}
    </MenuLayer>
  );
}

export function FileExplorerBackgroundMenu({
  caps,
  point,
  onAction,
  onClose,
}: {
  caps: ExplorerCapabilities;
  point: { x: number; y: number };
  onAction: (id: RowMenuItemId) => void;
  onClose: () => void;
}) {
  const items = buildBackgroundMenuItems(caps);
  return (
    <MenuLayer point={point} label="Explorer actions" onClose={onClose}>
      {items.map((item) => (
        <MenuItemButton
          key={item.id}
          item={item}
          onSelect={() => {
            onClose();
            onAction(item.id);
          }}
        />
      ))}
    </MenuLayer>
  );
}

export function DeleteConfirmDialog({
  title,
  description,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby="file-explorer-delete-description"
        className="w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-border bg-popover p-4 shadow-lg"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !pending) onCancel();
        }}
      >
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p
          id="file-explorer-delete-description"
          className="mt-1 text-xs text-muted-foreground"
        >
          {description}
        </p>
        {error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
          >
            {pending ? "Deleting…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
