/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/tab-bar/BrowserTab.tsx (tab root chrome,
   tooltip, close affordance, loading dot, pinned middle-click guard) and
   ClientHostedBrowserTab.tsx is intentionally not ported (no
   paired-client rows in this build). Adapter: the strip owns the
   useSortable hook and context menu (row takes them as props); the host
   exposes no favicon URL, so BrowserFavicon always renders its Globe
   fallback until a favicon pipeline lands. */
import { Pin, X } from "lucide-react";
import type { DraggableSyntheticListeners } from "@dnd-kit/core";
import { Tooltip } from "radix-ui";
import type { BrowserTabState } from "../../../../shared/browser-contract";
import { BrowserFavicon } from "./browser-favicon";
import {
  ACTIVE_TAB_INDICATOR_CLASSES,
  getDropIndicatorClasses,
  getTabRootStateClasses,
  getTabStripBorderClasses,
  TAB_CONTAINER_WIDTH_CLASSES,
  TAB_LABEL_WIDTH_CLASSES,
  type DropIndicator,
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
  isPinned,
  dropIndicator,
  hideTooltip,
  sortableRef,
  dragListeners,
}: {
  tab: BrowserTabState;
  isActive: boolean;
  hasTabsToRight: boolean;
  onActivate: () => void;
  onClose: () => void;
  /** Strip-level arrows/Home/End, owned by the tab strip. */
  onStripKeyDown?: (event: React.KeyboardEvent) => void;
  /** Pinned tabs show the pin, hide the close button and ignore middle-click. */
  isPinned?: boolean;
  dropIndicator?: DropIndicator;
  /** True while the tab's context menu is open (avoids a stuck tooltip). */
  hideTooltip?: boolean;
  /** dnd-kit node ref and pointer listeners, owned by the strip wrapper. */
  sortableRef?: (node: HTMLElement | null) => void;
  dragListeners?: DraggableSyntheticListeners;
}): React.JSX.Element {
  const tabLabel = getBrowserStripTabLabel(tab);
  const pinned = isPinned === true;
  const tabRoot = (
    <div
      ref={sortableRef}
      {...dragListeners}
      role="tab"
      id={`browser-tab-${tab.tabId}`}
      aria-selected={isActive}
      aria-controls="browser-tab-panel"
      aria-label={tabLabel}
      data-tab-id={tab.tabId}
      data-testid="sortable-tab"
      data-pinned={pinned ? "true" : "false"}
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
          if (pinned) return;
          onClose();
        }
      }}
      className={`group relative flex items-center h-full px-1.5 text-xs cursor-pointer select-none outline-none focus:outline-none focus-visible:outline-none ${getTabStripBorderClasses(hasTabsToRight)} ${getDropIndicatorClasses(dropIndicator ?? null)} ${getTabRootStateClasses(isActive)}`}
    >
      {isActive && (
        <span className={ACTIVE_TAB_INDICATOR_CLASSES} aria-hidden />
      )}
      {/* Why: the browser tab icon is the only non-terminal, non-editor
          surface in the tab strip. Coloring the Globe blue (matching the
          in-app browser's identity and the default tab insertion bar)
          gives it a distinct, recognizable anchor so users can spot
          browser tabs at a glance even when the strip is saturated. We
          keep full color on both active and inactive tabs — dimming to
          muted-foreground made the icon read as "disabled" in practice. */}
      <BrowserFavicon
        faviconUrl={null}
        className="size-3 mr-1"
        fallbackClassName="text-blue-500"
      />
      {pinned && (
        <Pin
          className="mr-1 size-3 shrink-0 text-muted-foreground"
          aria-hidden
        />
      )}
      <span className={`${TAB_LABEL_WIDTH_CLASSES} mr-1`}>{tabLabel}</span>
      {tab.loading && tab.error === null && tab.loadError == null && !isBlankBrowserTab(tab) && (
        <span
          className="mr-1 size-1.5 rounded-full bg-sky-500/80 shrink-0"
          aria-hidden
        />
      )}
      {!pinned && (
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
      )}
    </div>
  );
  // Why h-full: the strip row stretches its flex items, but this width
  // box sits between the stretched wrapper and the h-full tab root — with
  // auto height it collapses to content height and the browser tab renders
  // shorter than the terminal tabs next to it (#235). Terminal tabs have
  // no middle box, so their h-full root stretches directly.
  if (hideTooltip)
    return <div className={`${TAB_CONTAINER_WIDTH_CLASSES} h-full`}>{tabRoot}</div>;
  return (
    <div className={`${TAB_CONTAINER_WIDTH_CLASSES} h-full`}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{tabRoot}</Tooltip.Trigger>
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
