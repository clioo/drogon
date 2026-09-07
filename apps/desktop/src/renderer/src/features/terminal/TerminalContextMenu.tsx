// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/TerminalContextMenu.tsx.
// Adapted to the MVP subset (single pane per tab: no splits, no parking, no
// titles, no quick commands, no native chat): the menu keeps the source's
// copy strings and item order for Copy, Select All, Paste, Copy Terminal ID,
// Clear Screen and Close Pane. Radix is replaced by a lightweight
// fixed-position menu (role="menu") so no new component dependency is needed.

import { useEffect, useRef } from "react";
import { Clipboard, Copy, Eraser, TextSelect, X } from "lucide-react";

export type TerminalContextMenuPoint = { x: number; y: number };

type TerminalContextMenuProps = {
  open: boolean;
  menuPoint: TerminalContextMenuPoint;
  onOpenChange: (open: boolean) => void;
  onCopy: () => void;
  onSelectAll: () => void;
  onPaste: () => void;
  onCopyTerminalId: () => void;
  onClearScreen: () => void;
  onClosePane: () => void;
};

function MenuItem({
  onSelect,
  shortcut,
  children,
  destructive = false,
}: {
  onSelect: () => void;
  shortcut?: string;
  children: React.ReactNode;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] outline-none hover:bg-accent hover:text-accent-foreground ${
        destructive ? "text-destructive hover:bg-destructive/10" : ""
      }`}
    >
      {children}
      {shortcut ? (
        <span className="ml-auto pl-4 font-mono text-[11px] text-muted-foreground">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}

export default function TerminalContextMenu({
  open,
  menuPoint,
  onOpenChange,
  onCopy,
  onSelectAll,
  onPaste,
  onCopyTerminalId,
  onClearScreen,
  onClosePane,
}: TerminalContextMenuProps): React.JSX.Element | null {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Take focus (like the source's Radix menu) so Escape reaches the menu
    // instead of being sent to the PTY by xterm's helper textarea.
    menuRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (
        menuRef.current &&
        event.target instanceof Node &&
        !menuRef.current.contains(event.target)
      ) {
        onOpenChange(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  const isMac =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
  const mod = isMac ? "⌘" : "Ctrl";
  const width = 240;
  // renderToString (and any non-DOM host) has no viewport: fall back to the
  // raw point so the menu still renders for tests.
  const viewportWidth =
    typeof window !== "undefined" ? window.innerWidth : menuPoint.x + width + 8;
  const viewportHeight =
    typeof window !== "undefined" ? window.innerHeight : menuPoint.y + 244;
  const x = Math.max(4, Math.min(menuPoint.x, viewportWidth - width - 4));
  const y = Math.max(4, Math.min(menuPoint.y, viewportHeight - 240));

  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      aria-label="Terminal actions"
      className="fixed z-50 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-floating)]"
      style={{ left: x, top: y, width }}
    >
      <MenuItem onSelect={onCopy} shortcut={`${mod}C`}>
        <Copy size={14} />
        Copy
      </MenuItem>
      <MenuItem onSelect={onSelectAll} shortcut={`${mod}A`}>
        <TextSelect size={14} />
        Select All
      </MenuItem>
      <MenuItem onSelect={onPaste} shortcut={`${mod}V`}>
        <Clipboard size={14} />
        Paste
      </MenuItem>
      <MenuItem onSelect={onCopyTerminalId}>
        <Copy size={14} />
        Copy Terminal ID
      </MenuItem>
      <div className="mx-1 my-1 h-px bg-border" role="separator" />
      <MenuItem onSelect={onClearScreen} shortcut={`${mod}K`}>
        <Eraser size={14} />
        Clear Screen
      </MenuItem>
      <div className="mx-1 my-1 h-px bg-border" role="separator" />
      <MenuItem onSelect={onClosePane} shortcut={`${mod}W`} destructive>
        <X size={14} />
        Close Pane
      </MenuItem>
    </div>
  );
}
