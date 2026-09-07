/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/tab-bar/BrowserTab.tsx (tab root chrome,
   tooltip, close affordance, loading dot) and ClientHostedBrowserTab.tsx
   is intentionally not ported (no paired-client rows in this build).
   Adapter: no dnd-kit drag, no pin, no context menu — out of MVP scope;
   role="tab" retained like the session tabs so the strip keeps one
   keyboard model; the Globe fallback stands in for BrowserFavicon (no
   favicon pipeline here). */
import { Globe, X } from "lucide-react";
import { Tooltip } from "radix-ui";
import type { BrowserTabState } from "../../../../shared/browser-contract";
import {
  ACTIVE_TAB_INDICATOR_CLASSES,
  getTabRootStateClasses,
  getTabStripBorderClasses,
  TAB_CONTAINER_WIDTH_CLASSES,
  TAB_LABEL_WIDTH_CLASSES,
} from "../shell/tab-chrome";

export function formatBrowserTabUrlLabel(url: string): string {
  if (!url || url === "about:blank") {
    return "New Tab";
  }
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

export function getBrowserStripTabLabel(tab: BrowserTabState): string {
  if (!tab.title || tab.title === tab.url || tab.title === "about:blank") {
    return formatBrowserTabUrlLabel(tab.url);
  }
  return tab.title || tab.url;
}

function isBlankBrowserTab(tab: BrowserTabState): boolean {
  return tab.url === "about:blank" || tab.url === "";
}

/**
 * One browser page as a tab-strip tab. Selecting it shows the browser pane
 * for that page in the tab area; closing it closes the page on the host.
 */
export function BrowserStripTab({
  tab,
  isActive,
  hasTabsToRight,
  onActivate,
  onClose,
  onStripKeyDown,
}: {
  tab: BrowserTabState;
  isActive: boolean;
  hasTabsToRight: boolean;
  onActivate: () => void;
  onClose: () => void;
  /** Strip-level arrows/Home/End, owned by the tab strip. */
  onStripKeyDown?: (event: React.KeyboardEvent) => void;
}): React.JSX.Element {
  const tabLabel = getBrowserStripTabLabel(tab);
  return (
    <div className={TAB_CONTAINER_WIDTH_CLASSES}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div
            role="tab"
            id={`browser-tab-${tab.tabId}`}
            aria-selected={isActive}
            aria-controls="browser-tab-panel"
            aria-label={tabLabel}
            data-tab-id={tab.tabId}
            data-active={isActive ? "true" : "false"}
            tabIndex={isActive ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onActivate();
                return;
              }
              onStripKeyDown?.(event);
            }}
            onClick={onActivate}
            onMouseDown={(event) => {
              if (event.button === 1) event.preventDefault();
            }}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                event.stopPropagation();
                onClose();
              }
            }}
            className={`group relative flex items-center h-full px-1.5 text-xs cursor-pointer select-none outline-none focus:outline-none focus-visible:outline-none ${getTabStripBorderClasses(hasTabsToRight)} ${getTabRootStateClasses(isActive)}`}
          >
            {isActive && (
              <span className={ACTIVE_TAB_INDICATOR_CLASSES} aria-hidden />
            )}
            {/* Why: the browser tab icon is the only non-terminal surface in
                the tab strip. The source colors the Globe blue to match the
                in-app browser's identity; full color on active and inactive
                tabs so it never reads as disabled. */}
            <Globe className="size-3 mr-1 text-blue-500" aria-hidden />
            <span className={`${TAB_LABEL_WIDTH_CLASSES} mr-1`}>
              {tabLabel}
            </span>
            {tab.loading && !isBlankBrowserTab(tab) && (
              <span
                className="mr-1 size-1.5 rounded-full bg-sky-500/80 shrink-0"
                aria-hidden
              />
            )}
            <button
              type="button"
              aria-label={`Close ${tabLabel}`}
              className={`flex items-center justify-center w-4 h-4 rounded-sm shrink-0 ${
                isActive
                  ? "text-muted-foreground hover:text-foreground hover:bg-muted"
                  : "text-transparent group-hover:text-muted-foreground hover:!text-foreground hover:!bg-muted"
              }`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onClose();
              }}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="tooltip max-w-80 whitespace-normal break-words text-left"
            side="bottom"
            sideOffset={6}
          >
            {tabLabel}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </div>
  );
}
