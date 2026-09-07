// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/browser-pane/assemble-chrome/browser-page-context-menu.tsx
// Adapted: menu state arrives from the main-process guest over the bridge
// (no webview ref, no store); every action is an injected callback so the
// panel wires the bridge and the tests fixture the policy. Chrome (menu
// item class, portal, roving focus, flip-on-overflow, Escape) is literal.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";

// `focus:` rather than `focus-visible:` — items are only ever focused programmatically
// while the menu is open, so every focus here is keyboard navigation.
const MENU_ITEM_CLASS =
  "relative flex w-full cursor-default items-center gap-2 rounded-[7px] px-2 py-0.5 text-[12px] leading-5 font-medium outline-none select-none hover:bg-black/8 focus:bg-black/8 disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-white/14 dark:focus:bg-white/14";

export type BrowserPageMenuState = {
  x: number;
  y: number;
  linkUrl: string;
  pageUrl: string;
  selectionText: string;
};

export function isBrowserPageMenuLinkRow(menu: BrowserPageMenuState): boolean {
  return menu.linkUrl !== "";
}

export function isBrowserPageMenuCopyRow(menu: BrowserPageMenuState): boolean {
  return menu.selectionText.trim() !== "";
}

export function BrowserPageContextMenu({
  menu,
  canGoBack,
  canGoForward,
  onClose,
  onBack,
  onForward,
  onReload,
  onOpenLinkInPane,
  onOpenExternal,
  onCopyText,
  onInspect,
}: {
  menu: BrowserPageMenuState | null;
  canGoBack: boolean;
  canGoForward: boolean;
  onClose: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onOpenLinkInPane: (url: string) => void;
  onOpenExternal: (url: string) => void;
  onCopyText: (text: string) => void;
  onInspect: () => void;
}): React.JSX.Element | null {
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const menuItems = useCallback((): HTMLButtonElement[] => {
    const el = contextMenuRef.current;
    if (!el) {
      return [];
    }
    return [...el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
  }, []);

  useEffect(() => {
    if (!menu) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, menu]);

  // Why: role="menu" is unreachable by keyboard unless focus moves in on open.
  useEffect(() => {
    if (!menu) {
      return;
    }
    menuItems()[0]?.focus();
  }, [menu, menuItems]);

  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      const items = menuItems();
      if (items.length === 0) {
        return;
      }
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      let nextIndex: number;
      if (e.key === "ArrowDown") {
        nextIndex = (currentIndex + 1) % items.length;
      } else if (e.key === "ArrowUp") {
        nextIndex = (currentIndex <= 0 ? items.length : currentIndex) - 1;
      } else if (e.key === "Home") {
        nextIndex = 0;
      } else if (e.key === "End") {
        nextIndex = items.length - 1;
      } else {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      items[nextIndex]?.focus();
    },
    [menuItems],
  );

  // Why: ancestor CSS (transform/backdrop-filter) can shift position:fixed even via a body Portal, so measure/correct before paint; also flip on viewport overflow.
  useLayoutEffect(() => {
    const el = contextMenuRef.current;
    if (!el || !menu) {
      return;
    }
    el.style.left = `${menu.x}px`;
    el.style.top = `${menu.y}px`;
    const rect = el.getBoundingClientRect();

    // Why: CSS containing blocks can shift "fixed" elements; capture the offset between requested and actual position.
    const offsetX = menu.x - rect.left;
    const offsetY = menu.y - rect.top;

    let renderX = menu.x;
    let renderY = menu.y;

    // Flip so the opposite corner aligns with the cursor when the menu overflows.
    if (rect.right > window.innerWidth) {
      renderX = menu.x - rect.width;
    }
    if (rect.bottom > window.innerHeight) {
      renderY = menu.y - rect.height;
    }

    renderX = Math.max(0, renderX);
    renderY = Math.max(0, renderY);

    el.style.left = `${renderX + offsetX}px`;
    el.style.top = `${renderY + offsetY}px`;
  }, [menu]);

  if (!menu) {
    return null;
  }

  const showLinkRows = isBrowserPageMenuLinkRow(menu);
  const showCopyRow = isBrowserPageMenuCopyRow(menu);
  const dismiss = (action: () => void): void => {
    action();
    onClose();
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-50" onPointerDown={onClose} />
      <div
        ref={contextMenuRef}
        role="menu"
        aria-orientation="vertical"
        tabIndex={-1}
        onKeyDown={handleMenuKeyDown}
        data-testid="browser-context-menu"
        style={{ left: menu.x, top: menu.y }}
        className="fixed z-50 min-w-[13rem] overflow-hidden rounded-[11px] border border-black/14 bg-[rgba(255,255,255,0.82)] p-1 text-black shadow-[0_16px_36px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-2xl dark:border-white/14 dark:bg-[rgba(0,0,0,0.72)] dark:text-white dark:shadow-[0_20px_44px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.04)]"
      >
        {showLinkRows ? (
          <>
            <button
              role="menuitem"
              className={MENU_ITEM_CLASS}
              onClick={() => dismiss(() => onOpenLinkInPane(menu.linkUrl))}
            >
              Open Link in Drogon Browser
            </button>
            <button
              role="menuitem"
              className={MENU_ITEM_CLASS}
              onClick={() => dismiss(() => onOpenExternal(menu.linkUrl))}
            >
              Open Link in Default Browser
            </button>
            <button
              role="menuitem"
              className={MENU_ITEM_CLASS}
              onClick={() => dismiss(() => onCopyText(menu.linkUrl))}
            >
              Copy Link Address
            </button>
            <div className="my-1 h-px bg-border/70" />
          </>
        ) : null}
        {showCopyRow ? (
          <>
            <button
              role="menuitem"
              className={MENU_ITEM_CLASS}
              onClick={() => dismiss(() => onCopyText(menu.selectionText))}
            >
              Copy
            </button>
            <div className="my-1 h-px bg-border/70" />
          </>
        ) : null}
        <button
          role="menuitem"
          disabled={!canGoBack}
          className={MENU_ITEM_CLASS}
          onClick={() => dismiss(onBack)}
        >
          Back
        </button>
        <button
          role="menuitem"
          disabled={!canGoForward}
          className={MENU_ITEM_CLASS}
          onClick={() => dismiss(onForward)}
        >
          Forward
        </button>
        <button role="menuitem" className={MENU_ITEM_CLASS} onClick={() => dismiss(onReload)}>
          Reload
        </button>
        <div className="my-1 h-px bg-border/70" />
        <button
          role="menuitem"
          className={MENU_ITEM_CLASS}
          onClick={() => dismiss(() => onOpenExternal(menu.pageUrl))}
        >
          Open Page in Default Browser
        </button>
        <button
          role="menuitem"
          className={MENU_ITEM_CLASS}
          onClick={() => dismiss(() => onCopyText(menu.pageUrl))}
        >
          Copy Page URL
        </button>
        <div className="my-1 h-px bg-border/70" />
        <button
          role="menuitem"
          className={MENU_ITEM_CLASS}
          onClick={() => dismiss(onInspect)}
        >
          Inspect Page
        </button>
      </div>
    </>,
    document.body,
  );
}
