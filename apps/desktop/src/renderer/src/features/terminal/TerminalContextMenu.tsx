// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/TerminalContextMenu.tsx.
// Adapted to the Split Terminal Right subset of issue #129 (no split-down,
// no parking, no pane titles, no quick commands, no native chat, no pane-leaf
// ids): the menu keeps the source's copy strings, hints and item order for
// Copy, Select All, Paste, Split Terminal Right (its own separator section
// like the source), Copy Session ID (agent sessions only, like the source's
// canCopyAgentSessionId gate), Copy Terminal ID, the destructive Close Pane
// with its chord, and Clear Screen LAST with no hint, exactly like the
// source. Radix is replaced by a lightweight fixed-position menu
// (role="menu") so no new component dependency is needed.

import { useEffect, useRef } from "react";
import {
  Clipboard,
  Copy,
  Eraser,
  PanelRightClose,
  TextSelect,
  X,
} from "lucide-react";
import {
  menuShortcutLabel,
  resolveMenuShortcutPlatform,
} from "../shell/tab-menu-shortcuts";

export type TerminalContextMenuPoint = { x: number; y: number };

type TerminalContextMenuProps = {
  open: boolean;
  menuPoint: TerminalContextMenuPoint;
  onOpenChange: (open: boolean) => void;
  onCopy: () => void;
  onSelectAll: () => void;
  onPaste: () => void;
  /** False once the tab already holds two panes; hides the split section. */
  canSplit: boolean;
  splitShortcut: string;
  onSplitRight: () => void;
  /** Source gate: the pane runs an agent session (harnessId set). */
  canCopySessionId: boolean;
  onCopySessionId: () => void;
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
  canSplit,
  splitShortcut,
  onSplitRight,
  canCopySessionId,
  onCopySessionId,
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
  const platform = resolveMenuShortcutPlatform(
    typeof navigator === "undefined" ? "" : navigator.userAgent,
  );
  // Hints resolve from the shared keybinding table (persisted overrides
  // win), like the source's formatPrimaryShortcutLabel.
  const copyHint = menuShortcutLabel("terminal.copySelection", platform);
  const selectAllHint = menuShortcutLabel("terminal.selectAll", platform);
  const pasteHint = menuShortcutLabel("terminal.paste", platform);
  const closeHint = menuShortcutLabel("terminal.closePane", platform);
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
      <MenuItem onSelect={onCopy} shortcut={copyHint}>
        <Copy size={14} />
        Copy
      </MenuItem>
      <MenuItem onSelect={onSelectAll} shortcut={selectAllHint}>
        <TextSelect size={14} />
        Select All
      </MenuItem>
      <MenuItem onSelect={onPaste} shortcut={pasteHint}>
        <Clipboard size={14} />
        Paste
      </MenuItem>
      {canSplit ? (
        <>
          <div className="mx-1 my-1 h-px bg-border" role="separator" />
          <MenuItem onSelect={onSplitRight} shortcut={splitShortcut}>
            <PanelRightClose size={14} />
            Split Terminal Right
          </MenuItem>
        </>
      ) : null}
      <div className="mx-1 my-1 h-px bg-border" role="separator" />
      {canCopySessionId ? (
        <MenuItem onSelect={onCopySessionId}>
          <Copy size={14} />
          Copy Session ID
        </MenuItem>
      ) : null}
      <MenuItem onSelect={onCopyTerminalId}>
        <Copy size={14} />
        Copy Terminal ID
      </MenuItem>
      <div className="mx-1 my-1 h-px bg-border" role="separator" />
      <MenuItem onSelect={onClosePane} shortcut={closeHint} destructive>
        <X size={14} />
        Close Pane
      </MenuItem>
      <div className="mx-1 my-1 h-px bg-border" role="separator" />
      {/* The source's Clear Screen carries no shortcut hint. */}
      <MenuItem onSelect={onClearScreen}>
        <Eraser size={14} />
        Clear Screen
      </MenuItem>
    </div>
  );
}
