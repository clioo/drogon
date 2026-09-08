/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/index.tsx (top activity-bar
   layout, the default activityBarPosition) and
   right-sidebar-top-activity-bar.tsx (non-desktop-chrome branch).
   Adapter: props in place of the zustand store; the side activity-bar
   position, overflow "More" menu, checks-status dots and plugin tabs are
   out of MVP scope (three entries never overflow); resize follows this
   repo's Sidebar drag pattern with the source's width math. Panels are
   keep-alive mounts owned by App: the host only toggles their display,
   never their lifetime. */
import { useRef, useState } from "react";
import { PanelRight } from "lucide-react";
import { Tooltip } from "radix-ui";
import type { ReactNode } from "react";
import type {
  ActivityBarItem,
} from "./activity-bar-items";
import { ActivityBarButton } from "./ActivityBarButton";
import type { RightSidebarTab } from "./right-sidebar-route";
import { clampRightSidebarPanelWidth } from "./right-sidebar-width";

/** Stretchy icon strip; the header stays an Electron drag region around it. */
export const RIGHT_SIDEBAR_TOP_ACTIVITY_STRIP_CLASS_NAME =
  "right-sidebar-activity-strip flex min-w-0 flex-1 items-center overflow-hidden pl-2";

export function RightSidebar({
  open,
  width,
  onWidthChange,
  items,
  effectiveTab,
  onSelectTab,
  onToggle,
  toggleShortcutLabel,
  panels,
  hidden,
}: {
  open: boolean;
  /** Rendered (clamped) panel width. */
  width: number;
  onWidthChange: (width: number) => void;
  items: ActivityBarItem[];
  effectiveTab: RightSidebarTab;
  onSelectTab: (tab: RightSidebarTab) => void;
  onToggle: () => void;
  /** Display chord for the close tooltip, e.g. "⌘L". */
  toggleShortcutLabel: string;
  /** Keep-alive panel mounts keyed by tab; the host only toggles display. */
  panels: Partial<Record<RightSidebarTab, ReactNode>>;
  /**
   * Removes the bar from layout and the accessibility tree without
   * unmounting it. Full pages (Bots/Tasks/Automations) hide the bar like
   * the source suppresses it, while every panel mount survives for the
   * return to the session view.
   */
  hidden?: boolean;
}) {
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef({ startX: 0, startWidth: width });
  dragRef.current.startWidth = resizing ? dragRef.current.startWidth : width;
  const containerRef = useRef<HTMLDivElement>(null);

  const onResizeStart = (event: React.MouseEvent) => {
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: width };
    setResizing(true);
    const draft = (clientX: number) =>
      clampRightSidebarPanelWidth(
        dragRef.current.startWidth - (clientX - dragRef.current.startX),
        typeof window !== "undefined" ? window.innerWidth : null,
      );
    const onMove = (move: MouseEvent) => {
      if (containerRef.current)
        containerRef.current.style.width = `${draft(move.clientX)}px`;
    };
    const onUp = (up: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setResizing(false);
      if (containerRef.current) containerRef.current.style.width = "";
      onWidthChange(draft(up.clientX));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={containerRef}
      className={`relative flex-shrink-0 flex flex-row ${
        open ? "overflow-visible" : "overflow-hidden"
      }`}
      style={hidden ? { display: "none" } : open ? { width } : { width: 0 }}
      data-testid="right-sidebar"
    >
      <div
        className="flex flex-col flex-1 min-w-0 bg-sidebar overflow-hidden"
        style={{
          borderLeft: open ? "1px solid var(--sidebar-border)" : "none",
        }}
      >
        <div className="flex h-[36px] min-h-[36px] items-center border-b border-border right-sidebar-header-inset right-sidebar-header-drag overflow-hidden">
          <Tooltip.Provider delayDuration={400}>
            <div className={RIGHT_SIDEBAR_TOP_ACTIVITY_STRIP_CLASS_NAME}>
              <div className="flex min-w-0 shrink right-sidebar-header-no-drag">
                <div className="flex min-w-0 shrink">
                  {items.map((item) => (
                    <ActivityBarButton
                      key={item.id}
                      item={item}
                      active={effectiveTab === item.id}
                      onClick={() => onSelectTab(item.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center pr-1 right-sidebar-header-no-drag">
              {open && (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      type="button"
                      className="sidebar-toggle mr-1"
                      onClick={onToggle}
                      aria-label="Toggle right sidebar"
                    >
                      <PanelRight size={16} />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      className="tooltip"
                      side="bottom"
                      sideOffset={6}
                    >
                      {toggleShortcutLabel
                        ? `Toggle right sidebar (${toggleShortcutLabel})`
                        : "Toggle right sidebar"}
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              )}
            </div>
          </Tooltip.Provider>
        </div>

        {open && (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
                style={{
                  display: effectiveTab === item.id ? undefined : "none",
                }}
              >
                {panels[item.id] ?? null}
              </div>
            ))}
            {/* Tabs without an activity-bar button never match an item
                above. Only the session tab reaches this branch: the fork
                has no such item, so the panel stays reachable through the
                session header toggle and the palette instead. */}
            {!items.some((item) => item.id === effectiveTab) ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {panels[effectiveTab] ?? null}
              </div>
            ) : null}
          </div>
        )}

        <div
          className={`absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-ring/20 active:bg-ring/30 transition-colors z-10${
            resizing ? " bg-ring/10" : ""
          }`}
          onMouseDown={onResizeStart}
        />
      </div>
    </div>
  );
}
