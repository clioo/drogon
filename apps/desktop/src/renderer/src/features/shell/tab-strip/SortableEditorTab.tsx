/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/tab-bar/EditorFileTabContextMenu.tsx (menu
   items and order: pin, close variants with Close All Editor Tabs, Copy
   Path / Copy Relative Path, Reveal in Finder) and SortableTab.tsx (menu
   open/close discipline). Adapter: the row chrome stays in EditorStripTab
   (this wrapper only owns useSortable and the shared TabContextMenu); no
   workspace-layout section (no pane splits), no Rename row (no tab-driven
   file rename wiring) and no Open Markdown Preview row (no markdown
   preview surface) — listed as not-ported. */

import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import type { EditorTabState } from "../editor-tab";
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
  /** Strip-level arrows/Home/End plus reorder, owned by the tab strip. */
  onStripKeyDown: (event: React.KeyboardEvent) => void;
}): React.JSX.Element {
  const { setNodeRef, listeners } = useSortable({ id: tab.tabId });
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPoint, setMenuPoint] = useState({ x: 0, y: 0 });
  const pressPoint = useRef<{ x: number; y: number } | null>(null);

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
        hideTooltip={menuOpen}
        sortableRef={setNodeRef}
        dragListeners={listeners}
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
        onCopyPath={onCopyPath}
        onCopyRelativePath={onCopyRelativePath}
        onRevealInFinder={() => {
          void windowShellBridge()?.showItemInFolder({ path: tab.path });
        }}
      />
    </div>
  );
}
