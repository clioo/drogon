/* MIT Copyright (c) 2026 Lovecast Inc.
   The rows a worktree card's context menu shows while several cards are
   selected. Same Radix primitive, row classes, icons and destructive
   treatment as the single-card menu (WorktreeContextMenu.tsx) — only the
   copy counts, so the menu always states how many workspaces an action
   will touch. Rows the selection cannot answer for as a group (inline
   rename, Reveal in file manager, one path) are absent rather than
   silently acting on one card. */
import {
  ChevronRight,
  Copy,
  Pin,
  PinOff,
  SquareDashedMousePointer,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { Worktree } from "../../../../shared/session-contract";
import type { WorkspaceStatusDefinition } from "../../../../shared/persistence-contracts/worktree-types";
import {
  bulkDeleteMenuLabel,
  formatWorkspaceCount,
} from "./worktree-bulk-actions";

export function WorktreeBulkContextMenuItems({
  worktrees,
  statuses,
  disabled,
  pinLabel,
  pinIntent,
  onTogglePin,
  onMoveToStatus,
  onCopyPaths,
  onClearSelection,
  onDelete,
  deletableCount,
}: {
  worktrees: readonly Worktree[];
  statuses: readonly WorkspaceStatusDefinition[];
  disabled: boolean;
  pinLabel: string;
  /** True when the row pins; false when every selected card is pinned already. */
  pinIntent: boolean;
  onTogglePin: (() => void) | null;
  onMoveToStatus: ((statusId: string | null) => void) | null;
  onCopyPaths: () => void;
  onClearSelection: () => void;
  onDelete: (() => void) | null;
  /** Selected cards a delete would really remove (the sidebar applies the
   *  main-checkout/folder-project protection rule before this renders). */
  deletableCount: number;
}): React.JSX.Element {
  const count = worktrees.length;
  const showStatusMenu = onMoveToStatus !== null && statuses.length > 0;
  const anyStatusSet = worktrees.some(
    (worktree) => worktree.workspaceStatus != null,
  );
  return (
    <>
      <DropdownMenu.Label className="shell-worktree-context-menu-label">
        {formatWorkspaceCount(count)} selected
      </DropdownMenu.Label>
      <DropdownMenu.Separator className="shell-worktree-context-menu-separator" />
      <DropdownMenu.Item
        className="shell-worktree-context-menu-item"
        disabled={disabled}
        onSelect={onCopyPaths}
      >
        <Copy className="size-3.5" />
        Copy {count} Paths
      </DropdownMenu.Item>
      {onTogglePin !== null && (
        <DropdownMenu.Item
          className="shell-worktree-context-menu-item"
          disabled={disabled}
          onSelect={() => onTogglePin()}
        >
          {pinIntent ? (
            <Pin className="size-3.5" />
          ) : (
            <PinOff className="size-3.5" />
          )}
          {pinLabel}
        </DropdownMenu.Item>
      )}
      {showStatusMenu && (
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger
            className="shell-worktree-context-menu-item"
            disabled={disabled}
          >
            <Tag className="size-3.5" />
            Move {count} to Status
            <ChevronRight className="shell-worktree-context-menu-subtrigger-chevron" />
          </DropdownMenu.SubTrigger>
          <DropdownMenu.Portal>
            <DropdownMenu.SubContent
              className="shell-worktree-context-menu"
              sideOffset={2}
              alignOffset={-5}
            >
              {statuses.map((status) => (
                <DropdownMenu.Item
                  key={status.id}
                  className="shell-worktree-context-menu-item"
                  disabled={disabled}
                  onSelect={() => onMoveToStatus?.(status.id)}
                >
                  {/* No check marks here: a mixed selection has no single
                      current status, and a tick on one of them would be a
                      claim about cards that do not share it. */}
                  <span className="size-3.5" aria-hidden />
                  {status.label}
                </DropdownMenu.Item>
              ))}
              {anyStatusSet && (
                <>
                  <DropdownMenu.Separator className="shell-worktree-context-menu-separator" />
                  <DropdownMenu.Item
                    className="shell-worktree-context-menu-item"
                    disabled={disabled}
                    onSelect={() => onMoveToStatus?.(null)}
                  >
                    <X className="size-3.5" />
                    Clear status
                  </DropdownMenu.Item>
                </>
              )}
            </DropdownMenu.SubContent>
          </DropdownMenu.Portal>
        </DropdownMenu.Sub>
      )}
      <DropdownMenu.Item
        className="shell-worktree-context-menu-item"
        disabled={disabled}
        onSelect={onClearSelection}
      >
        <SquareDashedMousePointer className="size-3.5" />
        Clear Selection
      </DropdownMenu.Item>
      {onDelete !== null && (
        <>
          <DropdownMenu.Separator className="shell-worktree-context-menu-separator" />
          <DropdownMenu.Item
            className="shell-worktree-context-menu-item shell-worktree-context-menu-item-destructive"
            disabled={disabled}
            onSelect={() => onDelete()}
          >
            <Trash2 className="size-3.5" />
            {bulkDeleteMenuLabel(deletableCount)}
          </DropdownMenu.Item>
        </>
      )}
    </>
  );
}
