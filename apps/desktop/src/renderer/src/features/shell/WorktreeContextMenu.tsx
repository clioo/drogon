/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/WorktreeContextMenu.tsx and
   WorktreeContextMenuView.tsx (adapter: MVP subset — the reference menu
   routes pins, read state, groups, lineage, sleep, status and developer
   items through zustand stores; this repo's menu holds Open in editor,
   Reveal in Finder, Copy path, Rename, Create worktree from here and
   Delete worktree over props. The Radix DropdownMenu primitive, the
   hidden click-point trigger, the Workspace section label, the
   destructive Delete row with its shortcut chip, and the ARIA names are
   the source's. Plain fallback copy replaces the clipboard IPC.) */
import { useRef, useState } from "react";
import {
  Copy,
  ExternalLink,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { Worktree } from "../../../../shared/session-contract";
import {
  getFileManagerLabel,
  getWorktreeDeleteLabel,
  getWorktreeDeleteShortcutLabel,
  isWorktreeCreatable,
  isWorktreeDeletable,
  isWorktreeRenamable,
} from "./worktree-context-menu-policy";
import { windowShellBridge } from "./worktree-bridges";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const done = document.execCommand("copy");
      area.remove();
      return done;
    } catch {
      return false;
    }
  }
}

export function WorktreeContextMenu({
  worktree,
  displayName,
  projectKind,
  implicitFolderWorktree,
  disabled,
  onRename,
  onCreateWorktree,
  onDelete,
  children,
}: {
  worktree: Worktree;
  displayName: string;
  projectKind: "git" | "folder";
  implicitFolderWorktree: boolean;
  disabled: boolean;
  /** Opens the inline title editor. Absent when the card cannot rename. */
  onRename: (() => void) | null;
  /** Opens the new-workspace composer for this project. */
  onCreateWorktree: (() => void) | null;
  /** Opens the delete confirm dialog. Null for implicit folder worktrees. */
  onDelete: (() => void) | null;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPoint, setMenuPoint] = useState({ x: 0, y: 0 });
  const openedAtRef = useRef<number | null>(null);
  const scopeRef = useRef<HTMLDivElement>(null);

  const renamable =
    onRename !== null && isWorktreeRenamable({ implicitFolderWorktree });
  const creatable =
    onCreateWorktree !== null && isWorktreeCreatable({ projectKind });
  const deletable =
    onDelete !== null &&
    isWorktreeDeletable({ projectKind, implicitFolderWorktree });
  const deleteShortcut = getWorktreeDeleteShortcutLabel(
    typeof navigator === "undefined" ? "" : navigator.platform,
  );

  const openAt = (x: number, y: number) => {
    const bounds = scopeRef.current?.getBoundingClientRect();
    openedAtRef.current = Date.now();
    setMenuPoint({
      x: bounds ? x - bounds.left : 0,
      y: bounds ? y - bounds.top : 0,
    });
    setMenuOpen(true);
  };

  const shell = windowShellBridge();
  const handleOpenInEditor = () => {
    void shell?.openPath({ path: worktree.path });
  };
  const handleRevealInFinder = () => {
    void shell?.showItemInFolder({ path: worktree.path });
  };
  const handleCopyPath = () => {
    void copyText(worktree.path);
  };

  return (
    <div
      ref={scopeRef}
      className="shell-worktree-context-menu-scope"
      data-worktree-context-menu-scope="worktree"
      onContextMenu={(event) => {
        if (disabled) return;
        event.preventDefault();
        openAt(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        // Keyboard access to the same menu: the platform Menu key (and
        // Shift+F10, which Chromium does not always turn into a
        // contextmenu event with usable coordinates) opens it at the
        // focused card. Escape closes via Radix.
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          if (disabled) return;
          event.preventDefault();
          event.stopPropagation();
          const bounds = scopeRef.current?.getBoundingClientRect();
          openAt(bounds ? bounds.left + 24 : 0, bounds ? bounds.top + 24 : 0);
        }
      }}
    >
      {children}
      <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            aria-hidden
            tabIndex={-1}
            className="shell-worktree-context-menu-trigger"
            style={{ left: menuPoint.x, top: menuPoint.y }}
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="shell-worktree-context-menu"
            sideOffset={0}
            align="start"
            aria-label={`Worktree actions for ${displayName}`}
          >
            <DropdownMenu.Label className="shell-worktree-context-menu-label">
              Workspace
            </DropdownMenu.Label>
            {renamable && (
              <DropdownMenu.Item
                className="shell-worktree-context-menu-item"
                disabled={disabled}
                onSelect={() => onRename?.()}
              >
                <Pencil className="size-3.5" />
                Rename
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item
              className="shell-worktree-context-menu-item"
              disabled={disabled}
              onSelect={handleOpenInEditor}
            >
              <ExternalLink className="size-3.5" />
              Open in editor
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="shell-worktree-context-menu-item"
              disabled={disabled}
              onSelect={handleRevealInFinder}
            >
              <FolderOpen className="size-3.5" />
              {getFileManagerLabel(
                typeof navigator === "undefined" ? "" : navigator.platform,
              )}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="shell-worktree-context-menu-item"
              disabled={disabled}
              onSelect={handleCopyPath}
            >
              <Copy className="size-3.5" />
              Copy path
            </DropdownMenu.Item>
            {creatable && (
              <>
                <DropdownMenu.Separator className="shell-worktree-context-menu-separator" />
                <DropdownMenu.Item
                  className="shell-worktree-context-menu-item"
                  disabled={disabled}
                  onSelect={() => onCreateWorktree?.()}
                >
                  <FolderPlus className="size-3.5" />
                  Create worktree from here
                </DropdownMenu.Item>
              </>
            )}
            {deletable && (
              <>
                <DropdownMenu.Separator className="shell-worktree-context-menu-separator" />
                <DropdownMenu.Item
                  className="shell-worktree-context-menu-item shell-worktree-context-menu-item-destructive"
                  disabled={disabled}
                  onSelect={() => onDelete?.()}
                >
                  <Trash2 className="size-3.5" />
                  {getWorktreeDeleteLabel()}
                  <span className="shell-worktree-context-menu-shortcut">
                    {deleteShortcut}
                  </span>
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
