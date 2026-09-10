/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/tab-bar/SortableTabContextMenu.tsx (session
   tabs: pin, close variants, Change Title with the tab.close/tab.rename
   shortcut hints), BrowserTab.tsx (browser tabs: Duplicate Tab, pin, close
   variants, Open In Browser), EditorFileTabContextMenu.tsx (editor
   tabs: pin, close variants including Close All Editor Tabs, Copy Path /
   Copy Relative Path, Reveal in Finder) and TerminalTabSplitMenuSection.tsx
   (session tabs: the Split terminal submenu with its Split terminal right
   entry). Adapter: no Move Tab to Split row and no workspace-layout section
   (no split view), no split-down entry (#129 subset), no switch-view row
   (no native chat view), no Tab Color section (no tab-color store), no
   editor Rename row (no tab-driven file rename wiring) and no Open Markdown
   Preview row (no markdown preview surface) — all listed as not-ported.
   Shortcut hints resolve through the shared keybinding table with
   persisted overrides (./tab-menu-shortcuts.ts), like the source's
   useOptionalShortcutLabel. */

import {
  Copy,
  CopyX,
  ExternalLink,
  ListX,
  PanelLeftClose,
  PanelRightClose,
  Pencil,
  Pin,
  PinOff,
  SquareTerminal,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { TAB_CONTEXT_MENU_CONTENT_CLASS } from "./tab-chrome";
import {
  menuShortcutLabel,
  resolveMenuShortcutPlatform,
} from "./tab-menu-shortcuts";

export type TabMenuKind = "session" | "browser" | "editor" | "mentu";

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
  };
}

/** Platform-appropriate reveal label (EditorFileTabContextMenu copy). */
export function editorTabRevealLabel(userAgent?: string): string {
  const resolved =
    userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent);
  if (resolved.includes("Mac")) return "Reveal in Finder";
  if (resolved.includes("Linux")) return "Open Containing Folder";
  return "Reveal in File Explorer";
}

/**
 * Tab strip context menu. Controlled open state with a fixed 1px anchor at
 * the right-click point, like the source (no visible trigger element).
 * Item order, icons, separators and shortcut hints are the source's per
 * tab kind; rows whose backend does not exist in this build are omitted
 * (see the file header), never stubbed.
 */
export function TabContextMenu({
  open,
  onOpenChange,
  point,
  policy,
  onTogglePin,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseToLeft,
  onRenameOpen,
  splitTerminal = null,
  onDuplicate,
  openInBrowser,
  onCloseAllEditorTabs,
  onCopyPath,
  onCopyRelativePath,
  onRevealInFinder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  point: { x: number; y: number };
  policy: TabMenuPolicy;
  onTogglePin: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
  onCloseToLeft: () => void;
  /** Session tabs: opens the inline rename editor. */
  onRenameOpen?: () => void;
  /**
   * Session tabs: the fork's "Split terminal" submenu (TerminalTabSplitMenuSection).
   * Null hides the section; disabled greys it when the tab already holds
   * two panes. Only "Split terminal right" is wired — this build has no
   * split-down (#129 subset, listed as not-ported).
   */
  splitTerminal?: { disabled: boolean; onSplitRight: () => void } | null;
  /** Browser tabs: opens a second tab at the same URL (source: Duplicate Tab). */
  onDuplicate?: () => void;
  /** Browser tabs: opens the page in the system browser (shell.openExternal). */
  openInBrowser?: { disabled: boolean; onSelect: () => void };
  /** Editor tabs: closes every editor tab of the workspace. */
  onCloseAllEditorTabs?: () => void;
  /** Editor tabs: copies the absolute file path. */
  onCopyPath?: () => void;
  /** Editor tabs: copies the workspace-relative file path. */
  onCopyRelativePath?: () => void;
  /** Editor tabs: reveals the file in the OS file manager. */
  onRevealInFinder?: () => void;
}): React.JSX.Element {
  const platform = resolveMenuShortcutPlatform(
    typeof navigator === "undefined" ? "" : navigator.userAgent,
  );
  // The source renders DropdownMenuShortcut only when the action is bound.
  const closeShortcut = menuShortcutLabel("tab.close", platform);
  const renameShortcut = menuShortcutLabel("tab.rename", platform);
  const closeAllShortcut = menuShortcutLabel("tab.closeAll", platform);
  const splitRightShortcut = menuShortcutLabel("terminal.splitRight", platform);
  const closeOthersIcon =
    policy.kind === "session" ? (
      <ListX className="size-3.5 shrink-0" />
    ) : (
      <CopyX className="size-3.5 shrink-0" />
    );
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
        {policy.kind === "browser" && onDuplicate ? (
          <>
            <DropdownMenuItem onSelect={onDuplicate}>
              <Copy className="size-3.5 shrink-0" />
              Duplicate Tab
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {policy.kind === "session" && splitTerminal ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={splitTerminal.disabled}>
              <SquareTerminal className="size-3.5 shrink-0" />
              Split terminal
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[12rem]">
              <DropdownMenuItem onSelect={splitTerminal.onSplitRight}>
                <PanelRightClose className="size-3.5 shrink-0" />
                Split terminal right
                {splitRightShortcut ? (
                  <DropdownMenuShortcut>{splitRightShortcut}</DropdownMenuShortcut>
                ) : null}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
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
          {closeShortcut ? (
            <DropdownMenuShortcut>{closeShortcut}</DropdownMenuShortcut>
          ) : null}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={policy.closeOthersDisabled}
          onSelect={onCloseOthers}
        >
          {closeOthersIcon}
          Close Others
        </DropdownMenuItem>
        {policy.kind === "editor" && onCloseAllEditorTabs ? (
          <DropdownMenuItem onSelect={onCloseAllEditorTabs}>
            <ListX className="size-3.5 shrink-0" />
            Close All Editor Tabs
            {closeAllShortcut ? (
              <DropdownMenuShortcut>{closeAllShortcut}</DropdownMenuShortcut>
            ) : null}
          </DropdownMenuItem>
        ) : null}
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
        {policy.kind === "browser" && openInBrowser ? (
          <DropdownMenuItem
            disabled={openInBrowser.disabled}
            onSelect={openInBrowser.onSelect}
          >
            <ExternalLink className="size-3.5 shrink-0" />
            Open In Browser
          </DropdownMenuItem>
        ) : null}
        {policy.kind === "session" && onRenameOpen ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onRenameOpen}>
              <Pencil className="size-3.5 shrink-0" />
              Change Title
              {renameShortcut ? (
                <DropdownMenuShortcut>{renameShortcut}</DropdownMenuShortcut>
              ) : null}
            </DropdownMenuItem>
          </>
        ) : null}
        {policy.kind === "editor" ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onCopyPath}>
              <Copy className="size-3.5 shrink-0" />
              Copy Path
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onCopyRelativePath}>
              <Copy className="size-3.5 shrink-0" />
              Copy Relative Path
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onRevealInFinder}>
              <ExternalLink className="size-3.5 shrink-0" />
              {editorTabRevealLabel()}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
