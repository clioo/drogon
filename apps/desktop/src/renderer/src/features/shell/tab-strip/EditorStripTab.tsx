/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/tab-bar/BrowserTab.tsx (tab root chrome,
   tooltip, close affordance, pinned middle-click guard) and the editor
   tab's shared dirty-dot/close slot in
   src/renderer/src/components/tab-bar/EditorFileTab.tsx:364-378 plus
   EditorFileTabCloseButton.tsx (the dot and the close button share one
   slot so tab width never shifts during auto-save; when dirty the dot
   shows and the close button appears on hover replacing it — no name
   suffix, no status line). Adapter: the FileText icon stands in for the
   source's per-language file icon (no file-type icon pipeline wired to
   the tab strip in this build); the tooltip shows the full
   workspace-relative path, matching the source's title attribute. The
   source's close-button tooltip/shortcut label and its rename, preview
   and git-status tab adornments have no counterpart in this build, so
   the label row stays a plain base-name span. */
import { FileText, Pin, X } from "lucide-react";
import type { DraggableSyntheticListeners } from "@dnd-kit/core";
import { Tooltip } from "radix-ui";
import type { EditorTabState } from "../editor-tab";
import { editorTabLabel } from "../editor-tab";
import {
  ACTIVE_TAB_INDICATOR_CLASSES,
  getDropIndicatorClasses,
  getTabRootStateClasses,
  getTabStripBorderClasses,
  TAB_CONTAINER_WIDTH_CLASSES,
  TAB_LABEL_WIDTH_CLASSES,
  type DropIndicator,
} from "../tab-chrome";

/**
 * One open file as a tab-strip tab. Selecting it shows the full-width
 * Monaco editor for that file in the tab area; closing it drops the tab
 * (the file's retained draft, if any, survives in the editor host's own
 * per-file store — reopening the same path restores it, dirty).
 */
export function EditorStripTab({
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
  tab: EditorTabState;
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
  const tabLabel = editorTabLabel(tab.path);
  const pinned = isPinned === true;
  const tabRoot = (
    <div
      ref={sortableRef}
      {...dragListeners}
      role="tab"
      id={`editor-tab-${tab.tabId}`}
      aria-selected={isActive}
      aria-controls="editor-tab-panel"
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
      <FileText className="size-3 mr-1 text-muted-foreground" aria-hidden />
      {pinned && (
        <Pin
          className="mr-1 size-3 shrink-0 text-muted-foreground"
          aria-hidden
        />
      )}
      <span className={`${TAB_LABEL_WIDTH_CLASSES} mr-1`}>{tabLabel}</span>
      {/* Dirty dot and close button share the same slot to prevent tab width shift during auto-save.
         When dirty: dot is shown, close button appears on hover (replacing the dot).
         When clean: close button is shown normally (visible on active tab, on hover for others). */}
      <div className="relative flex items-center justify-center w-4 h-4 shrink-0">
        {tab.dirty && (
          <span
            data-testid="editor-tab-dirty-dot"
            className="absolute size-1.5 rounded-full bg-foreground/60 group-hover:hidden group-focus-within:hidden"
          />
        )}
        {!pinned && (
          <button
            type="button"
            data-tab-close-button="true"
            aria-label={`Close ${tabLabel}`}
            className={`flex items-center justify-center w-4 h-4 rounded-sm ${
              tab.dirty
                ? "hidden group-hover:flex text-muted-foreground hover:text-foreground hover:bg-muted"
                : isActive
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
    </div>
  );
  if (hideTooltip) return <div className={TAB_CONTAINER_WIDTH_CLASSES}>{tabRoot}</div>;
  return (
    <div className={TAB_CONTAINER_WIDTH_CLASSES}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{tabRoot}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="tooltip max-w-80 whitespace-normal break-words text-left"
            side="bottom"
            sideOffset={6}
          >
            {tab.path}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </div>
  );
}
