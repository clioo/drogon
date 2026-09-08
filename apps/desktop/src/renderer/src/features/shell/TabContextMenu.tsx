/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/tab-bar/SortableTabContextMenu.tsx (item
   order, icons and disabled rules) and BrowserTab.tsx (browser menu:
   pin, close variants). Adapter: no split/view-mode/color rows (no pane
   splits, chat views or tab colors in this build); session tabs gain
   "Copy Session ID" (the id is this build's addressable handle) and
   browser tabs gain "Copy URL"; radix-ui stands in for the shadcn menu. */

import {
  Copy,
  Link2,
  ListX,
  PanelLeftClose,
  PanelRightClose,
  Pencil,
  Pin,
  PinOff,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { TAB_CONTEXT_MENU_CONTENT_CLASS } from "./tab-chrome";

export type TabMenuKind = "session" | "browser";

/** Window event that closes every other open tab menu before one opens. */
export const TAB_STRIP_CLOSE_MENUS_EVENT = "drogon-close-tab-menus";

/** Disabled rules, ported from the source menus (Close is pinned-guarded, bulk closes skip pinned). */
export type TabMenuPolicy = {
  kind: TabMenuKind;
  isPinned: boolean;
  closeDisabled: boolean;
  closeOthersDisabled: boolean;
  closeToRightDisabled: boolean;
  closeToLeftDisabled: boolean;
  renameVisible: boolean;
};

export function buildTabMenuPolicy(input: {
  kind: TabMenuKind;
  isPinned: boolean;
  tabCount: number;
  hasTabsToRight: boolean;
  hasTabsToLeft: boolean;
}): TabMenuPolicy {
  return {
    kind: input.kind,
    isPinned: input.isPinned,
    closeDisabled: input.isPinned,
    closeOthersDisabled: input.tabCount <= 1,
    closeToRightDisabled: !input.hasTabsToRight,
    closeToLeftDisabled: !input.hasTabsToLeft,
    renameVisible: input.kind === "session",
  };
}

/**
 * Tab strip context menu. Controlled open state with a fixed 1px anchor at
 * the right-click point, like the source (no visible trigger element).
 */
export function TabContextMenu({
  open,
  onOpenChange,
  point,
  policy,
  copyLabel,
  onTogglePin,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseToLeft,
  onRenameOpen,
  onCopy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  point: { x: number; y: number };
  policy: TabMenuPolicy;
  /** "Copy Session ID" for sessions, "Copy URL" for browser tabs. */
  copyLabel: string;
  onTogglePin: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
  onCloseToLeft: () => void;
  onRenameOpen: () => void;
  onCopy: () => void;
}): React.JSX.Element {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed size-px opacity-0"
          style={{ left: point.x, top: point.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className={TAB_CONTEXT_MENU_CONTENT_CLASS}
        sideOffset={0}
        align="start"
      >
        <DropdownMenuItem onSelect={onTogglePin}>
          {policy.isPinned ? (
            <PinOff className="size-3.5 shrink-0" />
          ) : (
            <Pin className="size-3.5 shrink-0" />
          )}
          {policy.isPinned ? "Unpin Tab" : "Pin Tab"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={policy.closeDisabled}
          onSelect={() => {
            if (!policy.isPinned) onClose();
          }}
        >
          <X className="size-3.5 shrink-0" />
          Close
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={policy.closeOthersDisabled}
          onSelect={onCloseOthers}
        >
          <ListX className="size-3.5 shrink-0" />
          Close Others
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={policy.closeToRightDisabled}
          onSelect={onCloseToRight}
        >
          <PanelRightClose className="size-3.5 shrink-0" />
          Close Tabs To The Right
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={policy.closeToLeftDisabled}
          onSelect={onCloseToLeft}
        >
          <PanelLeftClose className="size-3.5 shrink-0" />
          Close Tabs To The Left
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {policy.renameVisible && (
          <DropdownMenuItem onSelect={onRenameOpen}>
            <Pencil className="size-3.5 shrink-0" />
            Change Title
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onCopy}>
          {policy.kind === "session" ? (
            <Copy className="size-3.5 shrink-0" />
          ) : (
            <Link2 className="size-3.5 shrink-0" />
          )}
          {copyLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
