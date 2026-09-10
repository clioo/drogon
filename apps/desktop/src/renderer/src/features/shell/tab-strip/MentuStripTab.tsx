/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/tab-bar/RecipeTab.tsx (row chrome: container
   width, active indicator, Network glyph, pin, tooltip, close affordance,
   pinned middle-click guard and copy — `(tab.customLabel ?? tab.label) ||
   'Mentu'`). Adapter: Drogon's strip tabs carry the shared roving-tabindex
   contract every sibling tab uses (role="tab", aria-selected,
   aria-controls, data-tab-id, Enter/Space activation and the strip-level
   arrow/Home/End handler), because the strip and the CDP probes read the
   tabs through the tablist role; the fork's RecipeTab only carries
   data-testid. There is no custom label store for the Mentu tab in this
   build, so the label is always the fork's 'Mentu' fallback. */
import { Network, Pin, X } from "lucide-react";
import type { DraggableSyntheticListeners } from "@dnd-kit/core";
import { Tooltip } from "radix-ui";
import {
  ACTIVE_TAB_INDICATOR_CLASSES,
  getDropIndicatorClasses,
  getTabRootStateClasses,
  getTabStripBorderClasses,
  TAB_CONTAINER_WIDTH_CLASSES,
  TAB_LABEL_WIDTH_CLASSES,
  type DropIndicator,
} from "../tab-chrome";

/** The fork's label fallback (RecipeTab.tsx); the create actions label a
 *  recipe tab 'Mentu' too, so this is the only title this build shows. */
export const MENTU_TAB_LABEL = "Mentu";

/**
 * One Mentu tab as a tab-strip tab. Selecting it shows the wide Mentu
 * recipe surface in the tab area; closing it drops the tab (the panel's
 * own store keeps whichever recipe was selected, so reopening restores
 * it).
 */
export function MentuStripTab({
  isActive,
  isPinned,
  hasTabsToRight,
  onActivate,
  onClose,
  onStripKeyDown,
  dropIndicator,
  hideTooltip,
  sortableRef,
  dragListeners,
}: {
  isActive: boolean;
  isPinned: boolean;
  hasTabsToRight: boolean;
  onActivate: () => void;
  onClose: () => void;
  /** Strip-level arrows/Home/End, owned by the tab strip. */
  onStripKeyDown?: (event: React.KeyboardEvent) => void;
  dropIndicator?: DropIndicator;
  /** True while the tab's context menu is open (avoids a stuck tooltip). */
  hideTooltip?: boolean;
  /** dnd-kit node ref and pointer listeners, owned by the strip wrapper. */
  sortableRef?: (node: HTMLElement | null) => void;
  dragListeners?: DraggableSyntheticListeners;
}): React.JSX.Element {
  const title = MENTU_TAB_LABEL;
  const tabRoot = (
    <div
      ref={sortableRef}
      {...dragListeners}
      role="tab"
      id="mentu-tab"
      aria-selected={isActive}
      aria-controls="mentu-tab-panel"
      aria-label={title}
      data-tab-id="mentu-tab"
      data-testid="recipe-tab"
      data-pinned={isPinned ? "true" : "false"}
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
          if (isPinned) return;
          onClose();
        }
      }}
      className={`group relative flex h-full cursor-pointer select-none items-center px-1.5 text-xs outline-none focus:outline-none focus-visible:outline-none ${getTabStripBorderClasses(hasTabsToRight)} ${getDropIndicatorClasses(dropIndicator ?? null)} ${getTabRootStateClasses(isActive)}`}
    >
      {isActive && (
        <span className={ACTIVE_TAB_INDICATOR_CLASSES} aria-hidden />
      )}
      <Network
        className="mr-1 size-3 shrink-0 text-muted-foreground"
        aria-hidden
      />
      {isPinned && (
        <Pin
          className="mr-1 size-3 shrink-0 text-muted-foreground"
          aria-hidden
        />
      )}
      <span className={`${TAB_LABEL_WIDTH_CLASSES} mr-1`}>{title}</span>
      {!isPinned && (
        <button
          type="button"
          data-tab-close-button="true"
          aria-label={`Close tab ${title}`}
          className={`relative z-10 flex size-4 shrink-0 items-center justify-center rounded-sm ${isActive ? "text-muted-foreground hover:bg-muted hover:text-foreground" : "text-transparent group-hover:text-muted-foreground hover:!bg-muted hover:!text-foreground focus-visible:!bg-muted focus-visible:!text-foreground"}`}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
  if (hideTooltip) return <div className={TAB_CONTAINER_WIDTH_CLASSES}>{tabRoot}</div>;
  return (
    <div className={TAB_CONTAINER_WIDTH_CLASSES}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{tabRoot}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tooltip" side="bottom" sideOffset={6}>
            {title}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </div>
  );
}
