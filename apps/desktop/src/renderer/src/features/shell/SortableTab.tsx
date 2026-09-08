/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/tab-bar/SortableTab.tsx (tab root chrome,
   useSortable drag without transform styling, inline rename, pinned
   middle-click guard) and use-sortable-tab-rename.ts (snapshot-on-open
   rename). Adapter: the row renders this repo's session chrome (agent
   icon, retry affordance passed in from the strip) and the shared
   TabContextMenu; IME composition guard kept on the rename input. */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { Pin, X } from "lucide-react";
import {
  ACTIVE_TAB_INDICATOR_CLASSES,
  getDropIndicatorClasses,
  getTabRootStateClasses,
  getTabStripBorderClasses,
  TAB_CONTAINER_WIDTH_CLASSES,
  TAB_LABEL_WIDTH_CLASSES,
  type DropIndicator,
} from "./tab-chrome";
import {
  buildTabMenuPolicy,
  TabContextMenu,
  TAB_STRIP_CLOSE_MENUS_EVENT,
} from "./TabContextMenu";

/** Pointer travel that turns a press into a drag (source TAB_DRAG_ACTIVATION_DISTANCE_PX). */
export const TAB_STRIP_DRAG_ACTIVATION_PX = 12;

function isImeComposing(event: React.KeyboardEvent): boolean {
  return event.keyCode === 229 || event.nativeEvent?.isComposing === true;
}

/**
 * One terminal session as a draggable tab-strip tab. The strip owns
 * role=tab and the roving tabindex, so dnd-kit attributes are intentionally
 * not spread (they would clobber role/tabIndex); only the pointer
 * listeners and node ref attach.
 */
export function SortableTab({
  id,
  title,
  ariaLabel,
  closeLabel,
  icon,
  retry,
  isActive,
  isPinned,
  hasTabsToRight,
  hasTabsToLeft,
  tabCount,
  closeDisabled,
  dropIndicator,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseToRight,
  onCloseToLeft,
  onTogglePin,
  onCommitTitle,
  onCopyId,
  onStripKeyDown,
}: {
  id: string;
  /** Resolved visible label (custom rename wins; computed by the strip). */
  title: string;
  ariaLabel: string;
  closeLabel: string;
  /** Leading agent-state icon. */
  icon: ReactNode;
  /** Retry-connection affordance, or null. */
  retry: ReactNode;
  isActive: boolean;
  isPinned: boolean;
  hasTabsToRight: boolean;
  hasTabsToLeft: boolean;
  tabCount: number;
  closeDisabled: boolean;
  dropIndicator?: DropIndicator;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseToRight: (id: string) => void;
  onCloseToLeft: (id: string) => void;
  onTogglePin: (id: string) => void;
  onCommitTitle: (id: string, title: string | null) => void;
  onCopyId: (id: string) => void;
  /** Strip-level arrows/Home/End plus reorder, owned by the tab strip. */
  onStripKeyDown: (event: React.KeyboardEvent, id: string) => void;
}): React.JSX.Element {
  // Why: no transform/transition styling — tabs stay anchored during drag,
  // only the insertion bar moves.
  const { setNodeRef, listeners } = useSortable({ id });
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPoint, setMenuPoint] = useState({ x: 0, y: 0 });
  const [isEditing, setIsEditing] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const pressPoint = useRef<{ x: number; y: number } | null>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    const closeMenu = (): void => setMenuOpen(false);
    window.addEventListener(TAB_STRIP_CLOSE_MENUS_EVENT, closeMenu);
    return () => window.removeEventListener(TAB_STRIP_CLOSE_MENUS_EVENT, closeMenu);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (): void => setMenuOpen(false);
    window.addEventListener("blur", dismiss);
    return () => window.removeEventListener("blur", dismiss);
  }, [menuOpen]);

  const openRename = () => {
    committedRef.current = false;
    // Why: snapshot the title once; a live title update mid-edit must not
    // overwrite what the user is typing.
    setRenameValue(title);
    setIsEditing(true);
  };
  const commitRename = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = renameValue.trim();
    onCommitTitle(id, trimmed.length > 0 ? trimmed : null);
    setIsEditing(false);
  };
  const cancelRename = () => {
    committedRef.current = true;
    setIsEditing(false);
  };

  // While editing, drop drag listeners so typing can't start a drag.
  const dragListeners = isEditing ? undefined : listeners;
  const policy = buildTabMenuPolicy({
    kind: "session",
    isPinned,
    tabCount,
    hasTabsToRight,
    hasTabsToLeft,
  });

  return (
    <div
      className={TAB_CONTAINER_WIDTH_CLASSES}
      onContextMenuCapture={(event) => {
        if (isEditing) return;
        event.preventDefault();
        window.dispatchEvent(new Event(TAB_STRIP_CLOSE_MENUS_EVENT));
        setMenuPoint({ x: event.clientX, y: event.clientY });
        setMenuOpen(true);
      }}
    >
      <div
        ref={setNodeRef}
        {...dragListeners}
        className={`group relative flex items-center h-full px-1.5 text-xs cursor-pointer select-none outline-none focus:outline-none focus-visible:outline-none ${getTabStripBorderClasses(hasTabsToRight)} ${getDropIndicatorClasses(dropIndicator ?? null)} ${getTabRootStateClasses(isActive)}`}
        role="tab"
        id={`session-tab-${id}`}
        data-tab-id={id}
        data-testid="sortable-tab"
        data-pinned={isPinned ? "true" : "false"}
        data-active={isActive ? "true" : "false"}
        aria-selected={isActive}
        aria-controls="active-session-panel"
        aria-label={ariaLabel}
        tabIndex={isActive ? 0 : -1}
        onKeyDown={(event) => onStripKeyDown(event, id)}
        onDoubleClick={(event) => {
          if (isEditing) return;
          event.stopPropagation();
          openRename();
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || isEditing) return;
          pressPoint.current = { x: event.clientX, y: event.clientY };
          (dragListeners?.onPointerDown as
            | ((event: React.PointerEvent<Element>) => void)
            | undefined)?.(event);
        }}
        onMouseDown={(event) => {
          // Why: block middle-click auto-scroll; don't close here — removing
          // the element pre-mouseup triggers a Linux X11 paste.
          if (event.button === 1) event.preventDefault();
        }}
        onMouseUp={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
        onAuxClick={(event) => {
          if (isEditing) return;
          if (event.button === 1) {
            event.preventDefault();
            event.stopPropagation();
            if (isPinned) return;
            onClose(id);
          }
        }}
        onClick={(event) => {
          if (isEditing) return;
          // Why: a press that travelled past the drag threshold is a drop,
          // not a click — don't switch tabs mid-gesture.
          const start = pressPoint.current;
          pressPoint.current = null;
          if (
            start &&
            Math.hypot(event.clientX - start.x, event.clientY - start.y) >=
              TAB_STRIP_DRAG_ACTIVATION_PX
          ) {
            return;
          }
          onActivate(id);
        }}
      >
        {isActive && (
          <span className={ACTIVE_TAB_INDICATOR_CLASSES} aria-hidden />
        )}
        {icon}
        {isPinned && !isEditing && (
          <Pin
            className="mr-1 size-3 shrink-0 text-muted-foreground"
            aria-hidden
          />
        )}
        {isEditing ? (
          <input
            // Why: autofocus via callback so the input exists past Radix menu
            // teardown; select-all so typing replaces the old title.
            ref={(input) => {
              if (input) {
                input.focus();
                input.select();
              }
            }}
            data-tab-rename-input="true"
            value={renameValue}
            aria-label={`Rename tab ${title}`}
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              // Why: an Enter confirming a CJK IME candidate must not commit
              // the rename; wait for a non-composition Enter.
              if (isImeComposing(event)) return;
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancelRename();
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
          <span className={`${TAB_LABEL_WIDTH_CLASSES} mr-1`}>{title}</span>
        )}
        {!isEditing && retry}
        {!isEditing && !isPinned && (
          <button
            type="button"
            aria-label={closeLabel}
            disabled={closeDisabled}
            data-tab-close-button="true"
            className={`relative z-10 flex items-center justify-center w-4 h-4 rounded-sm shrink-0 ${
              isActive
                ? "text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:text-foreground focus-visible:bg-muted"
                : "text-transparent group-hover:text-muted-foreground hover:!text-foreground hover:!bg-muted focus-visible:!text-foreground focus-visible:!bg-muted"
            }`}
            onPointerDown={(event) => {
              if (event.button === 0) event.stopPropagation();
            }}
            onMouseDown={(event) => {
              if (event.button === 0) event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onClose(id);
            }}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      <TabContextMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        point={menuPoint}
        policy={policy}
        copyLabel="Copy Session ID"
        onTogglePin={() => onTogglePin(id)}
        onClose={() => onClose(id)}
        onCloseOthers={() => onCloseOthers(id)}
        onCloseToRight={() => onCloseToRight(id)}
        onCloseToLeft={() => onCloseToLeft(id)}
        onRenameOpen={openRename}
        onCopy={() => onCopyId(id)}
      />
    </div>
  );
}
