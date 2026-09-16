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
   source's close-button tooltip/shortcut label and its preview and
   git-status tab adornments have no counterpart in this build, so
   the label row stays a plain base-name span outside a rename (#335 adds
   the menu-driven inline input, committing through the strip wrapper).
   R16-BJ (#294/#302) ports
   the source's diff-tab icon (GitCompareArrows) and its missing-file
   tab state (line-through label plus the mutation badge, verbatim
   classes and copy from EditorFileTab.tsx's isMissingFileMutation). */
import { FileText, GitCompareArrows, Pin, X } from "lucide-react";
import type { DraggableSyntheticListeners } from "@dnd-kit/core";
import { Tooltip } from "radix-ui";
import type { EditorTabState } from "../editor-tab";
import { editorDiffTabLabel, editorTabLabel } from "../editor-tab";
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
  renameEditing,
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
  /**
   * Inline file rename (#335): the menu's Rename row opens it with the base
   * name snapshotted; Enter commits, Escape cancels. Null renders the plain
   * label. Owned by the strip wrapper so the menu and the label share it.
   */
  renameEditing?: {
    value: string;
    onChange: (value: string) => void;
    onCommit: () => void;
    onCancel: () => void;
  } | null;
}): React.JSX.Element {
  const isDiff = tab.diff !== undefined;
  const tabLabel = isDiff
    ? editorDiffTabLabel(tab.path, tab.diff!)
    : editorTabLabel(tab.path);
  // Why: only deleted/renamed mean the file is gone from its path, which
  // is what strikethrough conveys (fork EditorFileTab.tsx verbatim).
  const isMissingFileMutation = tab.missing !== undefined;
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
      {isDiff ? (
        <GitCompareArrows
          className={`size-3 mr-1 shrink-0 ${isActive ? "text-foreground" : "text-muted-foreground"}`}
          aria-hidden
        />
      ) : (
        <FileText className="size-3 mr-1 text-muted-foreground" aria-hidden />
      )}
      {pinned && (
        <Pin
          className="mr-1 size-3 shrink-0 text-muted-foreground"
          aria-hidden
        />
      )}
      {renameEditing ? (
        <input
          // Why: autofocus via callback so the input exists past Radix menu
          // teardown; select-all so typing replaces the old base name.
          ref={(input) => {
            if (input) {
              input.focus();
              input.select();
            }
          }}
          data-tab-rename-input="true"
          value={renameEditing.value}
          aria-label={`Rename ${tabLabel}`}
          onChange={(event) => renameEditing.onChange(event.target.value)}
          onBlur={renameEditing.onCommit}
          onKeyDown={(event) => {
            // Why: an Enter confirming a CJK IME candidate must not commit
            // the rename; wait for a non-composition Enter.
            if (event.keyCode === 229 || event.nativeEvent?.isComposing === true)
              return;
            if (event.key === "Enter") {
              event.preventDefault();
              renameEditing.onCommit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              renameEditing.onCancel();
            }
          }}
          // Why: stop bubbling so clicking inside the input doesn't
          // activate the tab or start a dnd-kit drag.
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => {
            event.stopPropagation();
            if (event.button === 1) event.preventDefault();
          }}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onAuxClick={(event) => event.stopPropagation()}
          className="mr-1 h-5 min-w-[72px] flex-1 px-1 py-0 text-xs"
          spellCheck={false}
        />
      ) : (
        <span
          className={`${TAB_LABEL_WIDTH_CLASSES} mr-1${isMissingFileMutation ? " line-through" : ""}`}
        >
          {tabLabel}
        </span>
      )}
      {isMissingFileMutation && (
        <span className="shrink-0 text-[10px] leading-none font-semibold tracking-wide text-muted-foreground">
          {tab.missing}
        </span>
      )}
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
  // Why h-full: the strip row stretches its flex items, but this width
  // box sits between the stretched wrapper and the h-full tab root — with
  // auto height it collapses to content height and the editor tab renders
  // shorter than the terminal tabs next to it (the #235 browser-tab bug).
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
            {tab.path}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </div>
  );
}
