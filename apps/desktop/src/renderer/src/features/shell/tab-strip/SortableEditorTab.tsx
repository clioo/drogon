/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/tab-bar/EditorFileTabContextMenu.tsx (menu
   items and order: pin, close variants with Close All Editor Tabs, Copy
   Path / Copy Relative Path, Reveal in Finder) and SortableTab.tsx (menu
   open/close discipline). Adapter: the row chrome stays in EditorStripTab
   (this wrapper only owns useSortable and the shared TabContextMenu); no
   workspace-layout section (no pane splits) and no Open Markdown Preview
   row (no markdown preview surface) — listed as not-ported. The Rename
   row (#335) opens the label's inline input and commits the base name to
   App through onRenameFile; null hides the row (diff, missing and dirty
   tabs never offer it). */

import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import type { EditorTabState } from "../editor-tab";
import { editorTabLabel } from "../editor-tab";
import { EditorStripTab } from "./EditorStripTab";
import type { DropIndicator } from "../tab-chrome";
import {
  buildTabMenuPolicy,
  TabContextMenu,
  TAB_STRIP_CLOSE_MENUS_EVENT,
} from "../TabContextMenu";
import { TAB_STRIP_DRAG_ACTIVATION_PX } from "../SortableTab";
import { windowShellBridge } from "../worktree-bridges";

/**
 * One open file as a draggable tab-strip tab. Activation still runs on
 * click; a press that travels past the drag threshold is a drop and the
 * click is suppressed at capture so a reorder never switches files.
 */
export function SortableEditorTab({
  tab,
  isActive,
  isPinned,
  hasTabsToRight,
  hasTabsToLeft,
  tabCount,
  dropIndicator,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseToLeft,
  onTogglePin,
  onCopyPath,
  onCopyRelativePath,
  onCloseAllEditorTabs,
  onRenameFile,
  onStripKeyDown,
}: {
  tab: EditorTabState;
  isActive: boolean;
  isPinned: boolean;
  hasTabsToRight: boolean;
  hasTabsToLeft: boolean;
  tabCount: number;
  dropIndicator?: DropIndicator;
  onActivate: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
  onCloseToLeft: () => void;
  onTogglePin: () => void;
  onCopyPath: () => void;
  /** Copies the workspace-relative path; null disables the row's wiring. */
  onCopyRelativePath: () => void;
  /** Closes every editor tab of the workspace (Close All Editor Tabs). */
  onCloseAllEditorTabs: () => void;
  /**
   * Commits an inline file rename as (tabId, new base name); App runs
   * files.rename and retargets the tab. Null hides the menu's Rename row.
   */
  onRenameFile: ((tabId: string, newName: string) => void) | null;
  /** Strip-level arrows/Home/End plus reorder, owned by the tab strip. */
  onStripKeyDown: (event: React.KeyboardEvent) => void;
}): React.JSX.Element {
  const { setNodeRef, listeners } = useSortable({ id: tab.tabId });
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPoint, setMenuPoint] = useState({ x: 0, y: 0 });
  const [isEditing, setIsEditing] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const pressPoint = useRef<{ x: number; y: number } | null>(null);
  const committedRef = useRef(false);

  const openRename = () => {
    committedRef.current = false;
    // Why: snapshot the base name once; a tab-label update mid-edit must
    // not overwrite what the user is typing.
    setRenameValue(editorTabLabel(tab.path));
    setIsEditing(true);
  };
  const commitRename = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    setIsEditing(false);
    const trimmed = renameValue.trim();
    // Empty and unchanged names cancel like the explorer's inline input;
    // App validates separators and collisions against the daemon result.
    if (trimmed.length === 0 || trimmed === editorTabLabel(tab.path)) return;
    onRenameFile?.(tab.tabId, trimmed);
  };
  const cancelRename = () => {
    committedRef.current = true;
    setIsEditing(false);
  };
  // While editing, drop drag listeners so typing can't start a drag.
  const dragListeners = isEditing ? undefined : listeners;

  useEffect(() => {
    const closeMenu = (): void => setMenuOpen(false);
    window.addEventListener(TAB_STRIP_CLOSE_MENUS_EVENT, closeMenu);
    return () =>
      window.removeEventListener(TAB_STRIP_CLOSE_MENUS_EVENT, closeMenu);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (): void => setMenuOpen(false);
    window.addEventListener("blur", dismiss);
    return () => window.removeEventListener("blur", dismiss);
  }, [menuOpen]);

  return (
    <div
      onContextMenuCapture={(event) => {
        if (isEditing) return;
        event.preventDefault();
        window.dispatchEvent(new Event(TAB_STRIP_CLOSE_MENUS_EVENT));
        setMenuPoint({ x: event.clientX, y: event.clientY });
        setMenuOpen(true);
      }}
      onPointerDownCapture={(event) => {
        if (event.button === 0) {
          pressPoint.current = { x: event.clientX, y: event.clientY };
        }
      }}
      onClickCapture={(event) => {
        const start = pressPoint.current;
        pressPoint.current = null;
        if (
          start &&
          Math.hypot(event.clientX - start.x, event.clientY - start.y) >=
            TAB_STRIP_DRAG_ACTIVATION_PX
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <EditorStripTab
        tab={tab}
        isActive={isActive}
        isPinned={isPinned}
        hasTabsToRight={hasTabsToRight}
        dropIndicator={dropIndicator}
        hideTooltip={menuOpen || isEditing}
        sortableRef={setNodeRef}
        dragListeners={dragListeners}
        renameEditing={
          isEditing
            ? {
                value: renameValue,
                onChange: setRenameValue,
                onCommit: commitRename,
                onCancel: cancelRename,
              }
            : null
        }
        onActivate={onActivate}
        onClose={onClose}
        onStripKeyDown={onStripKeyDown}
      />
      <TabContextMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        point={menuPoint}
        policy={buildTabMenuPolicy({
          kind: "editor",
          isPinned,
          tabCount,
          hasTabsToRight,
          hasTabsToLeft,
        })}
        onTogglePin={onTogglePin}
        onClose={onClose}
        onCloseOthers={onCloseOthers}
        onCloseToRight={onCloseToRight}
        onCloseToLeft={onCloseToLeft}
        onCloseAllEditorTabs={onCloseAllEditorTabs}
        onRenameFile={onRenameFile ? openRename : undefined}
        onCopyPath={onCopyPath}
        onCopyRelativePath={onCopyRelativePath}
        onRevealInFinder={() => {
          void windowShellBridge()?.showItemInFolder({ path: tab.path });
        }}
      />
    </div>
  );
}
