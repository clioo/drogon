/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/WorktreeContextMenu.tsx,
   WorktreeContextMenuView.tsx (item order, the "Workspace" label, the
   destructive delete row with its shortcut chip) and WorktreeOpenInMenu.tsx
   (the "Open in" submenu). Adapter: MVP subset — the reference menu routes
   pins, read state, statuses, groups, lineage, sleep and developer items
   through zustand stores this repo does not have, so the menu holds Update
   (inline rename), the Open in submenu, Copy Path and the delete row over
   props; the submenu lists only the file-manager entry because this repo's
   shell bridge has no open-in-external-editor IPC and no open-in-apps
   settings section (both listed as not-ported). The Radix DropdownMenu
   primitive, the hidden click-point trigger and the ARIA names are the
   source's. Plain fallback copy replaces the clipboard IPC. */
import { useRef, useState } from "react";
import {
  ChevronRight,
  Copy,
  FolderOpen,
  Pencil,
  Trash2,
} from "lucide-react";
import { DropdownMenu, Tooltip } from "radix-ui";
import type { Worktree } from "../../../../shared/session-contract";
import {
  getFileManagerLabel,
  getWorktreeDeleteLabel,
  getWorktreeDeleteShortcutLabel,
  isWorktreeRenamable,
  PRIMARY_CHECKOUT_DELETE_DISABLED_HINT,
  worktreeDeleteRowKind,
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
  primaryCheckout,
  disabled,
  onRename,
  onDelete,
  children,
}: {
  worktree: Worktree;
  displayName: string;
  projectKind: "git" | "folder";
  implicitFolderWorktree: boolean;
  /**
   * The card is the project's main checkout (worktree.path ===
   * project.path). The source keeps a disabled "Delete Worktree" row and
   * pairs it with "Remove Project from Drogon".
   */
  primaryCheckout: boolean;
  disabled: boolean;
  /** Opens the inline title editor. Absent when the card cannot rename. */
  onRename: (() => void) | null;
  /**
   * Git worktrees: opens the delete confirm dialog. Primary checkout and
   * folder projects: opens the remove-project dialog (the source's
   * "Remove Project from Drogon" / "Remove Workspace" never touch the
   * folder on disk).
   */
  onDelete: (() => void) | null;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPoint, setMenuPoint] = useState({ x: 0, y: 0 });
  const openedAtRef = useRef<number | null>(null);
  const scopeRef = useRef<HTMLDivElement>(null);

  const renamable =
    onRename !== null && isWorktreeRenamable({ implicitFolderWorktree });
  const deleteKind = worktreeDeleteRowKind({
    projectKind,
    implicitFolderWorktree,
    primaryCheckout,
  });
  const deleteShortcut = getWorktreeDeleteShortcutLabel(
    typeof navigator === "undefined" ? "" : navigator.platform,
  );
  const userAgent =
    typeof navigator === "undefined" ? "" : navigator.userAgent;

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
  const handleRevealInFileManager = () => {
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
                Update
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Separator className="shell-worktree-context-menu-separator" />
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger
                className="shell-worktree-context-menu-item"
                disabled={disabled}
              >
                <FolderOpen className="size-3.5" />
                Open in
                <ChevronRight className="shell-worktree-context-menu-subtrigger-chevron" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  className="shell-worktree-context-menu"
                  sideOffset={2}
                  alignOffset={-5}
                >
                  <DropdownMenu.Item
                    className="shell-worktree-context-menu-item"
                    disabled={disabled}
                    onSelect={handleRevealInFileManager}
                  >
                    <FolderOpen className="size-3.5" />
                    {getFileManagerLabel(userAgent)}
                  </DropdownMenu.Item>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
            <DropdownMenu.Item
              className="shell-worktree-context-menu-item"
              disabled={disabled}
              onSelect={handleCopyPath}
            >
              <Copy className="size-3.5" />
              Copy Path
            </DropdownMenu.Item>
            {onDelete !== null && (
              <>
                <DropdownMenu.Separator className="shell-worktree-context-menu-separator" />
                {deleteKind === "primary-checkout" ? (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <div>
                        <DropdownMenu.Item
                          className="shell-worktree-context-menu-item shell-worktree-context-menu-item-destructive"
                          disabled
                        >
                          <Trash2 className="size-3.5" />
                          Delete Worktree
                        </DropdownMenu.Item>
                      </div>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content
                        side="right"
                        sideOffset={8}
                        className="tooltip max-w-[200px] text-pretty"
                      >
                        {PRIMARY_CHECKOUT_DELETE_DISABLED_HINT}
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                ) : null}
                <DropdownMenu.Item
                  className="shell-worktree-context-menu-item shell-worktree-context-menu-item-destructive"
                  disabled={disabled}
                  onSelect={() => onDelete?.()}
                >
                  <Trash2 className="size-3.5" />
                  {getWorktreeDeleteLabel(deleteKind)}
                  {deleteKind === "delete" ? (
                    <span className="shell-worktree-context-menu-shortcut">
                      {deleteShortcut}
                    </span>
                  ) : null}
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
