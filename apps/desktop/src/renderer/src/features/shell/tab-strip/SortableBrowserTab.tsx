/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/tab-bar/BrowserTab.tsx (menu items and
   order: Duplicate Tab, pin, close variants, Open In Browser) and
   SortableTab.tsx (menu open/close discipline). Adapter: the row chrome
   stays in BrowserStripTab (this wrapper only owns useSortable and the
   shared TabContextMenu); no workspace-layout section (no pane splits in
   this build). Duplicate Tab reuses the browser bridge's createTab(url)
   and Open In Browser the shell.openExternal gate (http(s) only, like the
   source's isHttpUrl guard). */

import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import type { BrowserTabState } from "../../../../../shared/browser-contract";
import { BrowserStripTab } from "../../browser/BrowserStripTab";
import type { DropIndicator } from "../tab-chrome";
import {
  buildTabMenuPolicy,
  TabContextMenu,
  TAB_STRIP_CLOSE_MENUS_EVENT,
} from "../TabContextMenu";
import { TAB_STRIP_DRAG_ACTIVATION_PX } from "../SortableTab";
import { windowShellOpenExternal } from "../../landing/github-star";

/** Source gate for Open In Browser (BrowserTab.tsx): http(s) pages only. */
function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/**
 * One browser page as a draggable tab-strip tab. Activation still runs on
 * click; a press that travels past the drag threshold is a drop and the
 * click is suppressed at capture so a reorder never switches pages.
 */
export function SortableBrowserTab({
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
  onDuplicate,
  onStripKeyDown,
}: {
  tab: BrowserTabState;
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
  /** Opens a second tab at the same URL; null hides Duplicate Tab. */
  onDuplicate: (() => void) | null;
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
      <BrowserStripTab
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
          kind: "browser",
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
        onDuplicate={onDuplicate ?? undefined}
        openInBrowser={{
          disabled: !isHttpUrl(tab.url),
          onSelect: () => {
            void windowShellOpenExternal(window.drogon)?.(tab.url);
          },
        }}
      />
    </div>
  );
}
