/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/tab-bar/tab-bar-surface.tsx (strip chrome,
   overflow chevrons) and SortableTab.tsx (tab root chrome: border/state
   classes, active indicator, close affordance). Adapter: the strip holds
   terminal sessions, browser pages and editor (open file) tabs (no
   simulator/agent rows); order/pin/rename state is owned by App through
   tab-order.ts instead of the zustand tab slice; keyboard reorder runs on
   Ctrl/Cmd+arrows so the plain-arrow roving-tabindex model stays intact. */
import { useLayoutEffect, useRef, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent, DragOverEvent } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import type {
  Harness,
  HarnessLaunchInput,
  Session,
} from "../../../../shared/session-contract";
import type { BrowserTabState } from "../../../../shared/browser-contract";
import type { HarnessAgentDefault } from "../../settings-store";
import {
  recoveryActionFor,
  recoveryTabLabel,
} from "../../session-recovery";
import { sessionDotState } from "./agent-state";
import { AgentStateIcon } from "./AgentStateIcon";
import type { EditorTabState } from "./editor-tab";
import { ShellIconButton } from "./ShellIconButton";
import { SortableTab, TAB_STRIP_DRAG_ACTIVATION_PX } from "./SortableTab";
import {
  hydrateTerminalSplits,
  splitForTab,
  type PersistedTerminalSplitMap,
} from "../terminal/terminal-split";
import { TabCreateMenu } from "./TabCreateMenu";
import { SortableBrowserTab } from "./tab-strip/SortableBrowserTab";
import { SortableEditorTab } from "./tab-strip/SortableEditorTab";
import type { DropIndicator } from "./tab-chrome";
import {
  moveTabOrder,
  partitionPinnedOrder,
  reconcileTabOrder,
  resolveTabTitle,
  shiftTabOrder,
} from "./tab-order";
import { defaultTerminalTabTitle } from "./tab-title";
import {
  computeTabStripOverflow,
  scrollTabStripByStep,
  tabStripFadeClass,
  type TabStripOverflowState,
} from "./tab-strip/tab-strip-overflow";

type StripEntry =
  | { kind: "session"; id: string }
  | { kind: "browser"; id: string }
  | { kind: "editor"; id: string };

/**
 * Unified tab strip: one tab per terminal session, one per browser page
 * and one per open file, then the "+" static create menu. Selecting a
 * browser tab shows the browser pane for that page, and selecting an
 * editor tab shows the full-width Monaco editor for that file, in the tab
 * area below the strip.
 */
export function TabBar({
  sessions,
  activeSessionId,
  browserTabs,
  activeBrowserTabId,
  editorTabs,
  activeEditorTabId,
  harnesses,
  workspaceId,
  hostId,
  defaultHarnessId,
  launchDefaults,
  newTerminalShortcut,
  newBrowserShortcut,
  closeDisabled,
  retryDisabled,
  createDisabled,
  stripOrder,
  pinnedIds,
  customTitles,
  onOrderChange,
  onTogglePin,
  onCloseOthers,
  onCloseToRight,
  onCloseToLeft,
  onCommitTitle,
  onCopyText,
  workspacePath,
  onDuplicateBrowserTab,
  terminalSplits,
  onSplitTerminal,
  onSelectSession,
  onSelectBrowserTab,
  onSelectEditorTab,
  onCloseSession,
  onCloseBrowserTab,
  onCloseEditorTab,
  onRetrySession,
  onCreateTerminal,
  onLaunchHarness,
  onNewBrowserTab,
  onOpenMentu,
  mentuAvailable,
  onOpenAgentSettings,
  onNewMarkdown,
}: {
  sessions: Session[];
  activeSessionId: string;
  browserTabs: BrowserTabState[];
  activeBrowserTabId: string | null;
  editorTabs: EditorTabState[];
  activeEditorTabId: string | null;
  harnesses: Harness[];
  workspaceId: string;
  hostId: string | null;
  defaultHarnessId?: string;
  launchDefaults?: Record<string, HarnessAgentDefault>;
  newTerminalShortcut: string;
  newBrowserShortcut: string;
  closeDisabled: boolean;
  retryDisabled: boolean;
  createDisabled: boolean;
  /** Persisted strip order for this workspace (reconciled with live ids). */
  stripOrder: string[];
  pinnedIds: string[];
  customTitles: Record<string, string>;
  onOrderChange: (order: string[]) => void;
  onTogglePin: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseToRight: (id: string) => void;
  onCloseToLeft: (id: string) => void;
  onCommitTitle: (id: string, title: string | null) => void;
  onCopyText: (text: string) => void;
  /** Absolute path of the workspace root (editor Copy Relative Path). */
  workspacePath?: string | null;
  /** Persisted terminal splits (drives the Split terminal submenu gate). */
  terminalSplits?: PersistedTerminalSplitMap;
  /** Session tabs: Split terminal right for this tab's root session. */
  onSplitTerminal?: (sessionId: string) => void;
  /** Opens a second browser tab at the given URL (Duplicate Tab). */
  onDuplicateBrowserTab?: (url: string) => void;
  onSelectSession: (id: string) => void;
  onSelectBrowserTab: (tabId: string) => void;
  onSelectEditorTab: (tabId: string) => void;
  onCloseSession: (session: Session) => void;
  onCloseBrowserTab: (tabId: string) => void;
  onCloseEditorTab: (tabId: string) => void;
  /** Per-tab retry: the clicked session decides relaunch vs refresh. */
  onRetrySession: (session: Session) => void;
  onCreateTerminal: () => void;
  onLaunchHarness: (input: HarnessLaunchInput) => Promise<boolean>;
  onNewBrowserTab: () => void;
  /** Mentu (J9) entry in the create menu; optional until the right-sidebar
   *  Mentu activity item lands. */
  onOpenMentu?: () => void;
  mentuAvailable?: boolean;
  /** Create-menu Agent settings row (Settings → Agents); hidden without it. */
  onOpenAgentSettings?: () => void;
  /** Create-menu New Markdown row; hidden without it. */
  onNewMarkdown?: () => void;
}) {
  const sessionById = new Map(sessions.map((item) => [item.id, item]));
  const browserById = new Map(browserTabs.map((tab) => [tab.tabId, tab]));
  const editorById = new Map(editorTabs.map((tab) => [tab.tabId, tab]));
  const ordered = partitionPinnedOrder(
    reconcileTabOrder(
      stripOrder,
      sessions.map((item) => item.id),
      browserTabs.map((tab) => tab.tabId),
      editorTabs.map((tab) => tab.tabId),
    ),
    pinnedIds,
  );
  const entries: StripEntry[] = ordered.flatMap((id): StripEntry[] => {
    if (sessionById.has(id)) return [{ kind: "session", id }];
    if (browserById.has(id)) return [{ kind: "browser", id }];
    if (editorById.has(id)) return [{ kind: "editor", id }];
    return [];
  });
  const pinned = new Set(pinnedIds);
  // Why: fork tabs read "Terminal N" until renamed (tabs-create-actions
  // `Terminal ${n}`); the shell process name never becomes the tab label.
  // Numbering follows strip position so labels stay dense after closes.
  const defaultTitleBySessionId = new Map<string, string>();
  let sessionPosition = 0;
  for (const entry of entries) {
    if (entry.kind === "session") {
      sessionPosition += 1;
      defaultTitleBySessionId.set(
        entry.id,
        defaultTerminalTabTitle(sessionPosition),
      );
    }
  }
  const [dropIndicatorById, setDropIndicatorById] = useState<
    Map<string, DropIndicator>
  >(new Map());
  const tabStripRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<TabStripOverflowState>({
    hasOverflow: false,
    canScrollStart: false,
    canScrollEnd: false,
  });

  // Why: a distance constraint (not delay) so a plain click never becomes
  // a drag; matches the fork's TAB_DRAG_ACTIVATION_DISTANCE_PX.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: TAB_STRIP_DRAG_ACTIVATION_PX },
    }),
  );

  useLayoutEffect(() => {
    const el = tabStripRef.current;
    if (!el) return;
    const update = () => {
      const next = computeTabStripOverflow(el);
      setOverflow((previous) =>
        previous.hasOverflow === next.hasOverflow &&
        previous.canScrollStart === next.canScrollStart &&
        previous.canScrollEnd === next.canScrollEnd
          ? previous
          : next,
      );
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        el.scrollLeft += event.deltaY;
        update();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", onWheel);
      observer.disconnect();
    };
  }, [entries.length]);

  const handleDragOver = (event: DragOverEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || activeId === overId) {
      setDropIndicatorById(new Map());
      return;
    }
    const from = ordered.indexOf(activeId);
    const to = ordered.indexOf(overId);
    if (from === -1 || to === -1) {
      setDropIndicatorById(new Map());
      return;
    }
    setDropIndicatorById(
      new Map([[overId, from < to ? "right" : "left"]]),
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDropIndicatorById(new Map());
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || activeId === overId) return;
    const next = moveTabOrder(ordered, activeId, overId);
    onOrderChange(next);
  };

  const focusEntry = (entry: StripEntry) => {
    const selector =
      entry.kind === "session"
        ? `#session-tab-${CSS.escape(entry.id)}`
        : `[data-tab-id="${CSS.escape(entry.id)}"]`;
    document.querySelector<HTMLElement>(selector)?.focus();
  };
  const selectEntry = (entry: StripEntry) => {
    if (entry.kind === "session") onSelectSession(entry.id);
    else if (entry.kind === "browser") onSelectBrowserTab(entry.id);
    else onSelectEditorTab(entry.id);
  };
  const stepEntry = (currentId: string, delta: number) => {
    if (entries.length === 0) return;
    const at = entries.findIndex((entry) => entry.id === currentId);
    const next =
      entries[(at < 0 ? (delta < 0 ? 0 : -1) : at + delta + entries.length) %
        entries.length];
    selectEntry(next);
    focusEntry(next);
  };
  const reorderEntry = (currentId: string, delta: number) => {
    const next = shiftTabOrder(ordered, currentId, delta);
    if (next.join() === ordered.join()) return;
    onOrderChange(next);
    // Why: no refocus needed — the moved tab keeps its React key, so the
    // focused DOM node survives the reorder with focus intact. A deferred
    // focus would also steal focus from an open context menu.
  };
  const stripKeyDown = (event: React.KeyboardEvent, currentId: string) => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault();
      reorderEntry(currentId, event.key === "ArrowRight" ? 1 : -1);
      return;
    }
    if (mod && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      const at = ordered.indexOf(currentId);
      if (at === -1) return;
      const next = [...ordered];
      const [moved] = next.splice(at, 1);
      if (event.key === "Home") next.unshift(moved);
      else next.push(moved);
      onOrderChange(next);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      stepEntry(currentId, event.key === "ArrowRight" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next =
        entries[event.key === "Home" ? 0 : entries.length - 1];
      if (!next) return;
      selectEntry(next);
      focusEntry(next);
    }
  };

  return (
    <div
      // Why: fixed 32px row with a bottom border (fork TabGroupPanel tab
      // row: `h-[32px] shrink-0 border-b border-border bg-card`), so the
      // strip inside measures 31px like the reference; flex-1 is NOT set
      // — in this column layout it would stretch the strip to fill the
      // pane area (the source surface sits in a row parent where flex-1
      // only shares horizontal space).
      // Why tab-row (not tab-strip): the fork's full-width row carries no
      // tab-strip class — the `tab-strip` token belongs to the
      // content-sized group/tab-strip inside, and geometry probes match
      // `[class*="tab-strip"]`.
      // Why: with hiddenInset the empty strip area is a window-drag region
      // (fork TabGroupPanel tab row); tabs and controls opt out via the
      // tab-row-window-drag CSS so they stay clickable.
      className="flex items-stretch h-8 shrink-0 overflow-hidden min-w-0 w-full border-b border-border bg-card tab-row-window-drag"
      // Why: preload routes native OS drops by this marker — only the tab strip opens files in the editor, not terminal panes.
      data-native-file-drop-target="editor"
    >
      {overflow.hasOverflow && (
        <button
          type="button"
          aria-label="Scroll tabs left"
          aria-disabled={!overflow.canScrollStart}
          disabled={!overflow.canScrollStart}
          className="mx-0.5 my-auto h-6 w-5 shrink-0 text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-35"
          onClick={() => {
            const el = tabStripRef.current;
            if (el) scrollTabStripByStep(el, "start");
          }}
        >
          <ChevronLeft className="size-3.5" />
        </button>
      )}
      {/* Why: no strategy stops dnd-kit animating siblings, so tabs stay anchored during drag; only the insertion bar moves. */}
      <DndContext
        sensors={sensors}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDropIndicatorById(new Map())}
      >
        {/* Why: no-drag lets tab interactions work inside the titlebar's drag region (outer container stays window-draggable). */}
        <SortableContext items={ordered}>
          <div className="group/tab-strip relative flex min-h-0 min-w-0 max-w-full flex-[0_1_auto]">
            <div
              ref={tabStripRef}
              className={[
                "terminal-tab-strip flex h-full min-w-0 max-w-full flex-1 items-stretch overflow-x-auto overflow-y-hidden border-r border-border/70",
                tabStripFadeClass(overflow),
              ]
                .filter(Boolean)
                .join(" ")}
              role="tablist"
              aria-label="Sessions"
            >
              {entries.map((entry, index) => {
                const hasTabsToRight = index < entries.length - 1;
                const hasTabsToLeft = index > 0;
                if (entry.kind === "browser") {
                  const tab = browserById.get(entry.id);
                  if (!tab) return null;
                  return (
                    <SortableBrowserTab
                      key={tab.tabId}
                      tab={tab}
                      isActive={tab.tabId === activeBrowserTabId}
                      isPinned={pinned.has(tab.tabId)}
                      hasTabsToRight={hasTabsToRight}
                      hasTabsToLeft={hasTabsToLeft}
                      tabCount={entries.length}
                      dropIndicator={dropIndicatorById.get(tab.tabId)}
                      onActivate={() => onSelectBrowserTab(tab.tabId)}
                      onClose={() => onCloseBrowserTab(tab.tabId)}
                      onCloseOthers={() => onCloseOthers(tab.tabId)}
                      onCloseToRight={() => onCloseToRight(tab.tabId)}
                      onCloseToLeft={() => onCloseToLeft(tab.tabId)}
                      onTogglePin={() => onTogglePin(tab.tabId)}
                      onDuplicate={
                        onDuplicateBrowserTab
                          ? () => onDuplicateBrowserTab(tab.url)
                          : null
                      }
                      onStripKeyDown={(event) =>
                        stripKeyDown(event, tab.tabId)
                      }
                    />
                  );
                }
                if (entry.kind === "editor") {
                  const tab = editorById.get(entry.id);
                  if (!tab) return null;
                  return (
                    <SortableEditorTab
                      key={tab.tabId}
                      tab={tab}
                      isActive={tab.tabId === activeEditorTabId}
                      isPinned={pinned.has(tab.tabId)}
                      hasTabsToRight={hasTabsToRight}
                      hasTabsToLeft={hasTabsToLeft}
                      tabCount={entries.length}
                      dropIndicator={dropIndicatorById.get(tab.tabId)}
                      onActivate={() => onSelectEditorTab(tab.tabId)}
                      onClose={() => onCloseEditorTab(tab.tabId)}
                      onCloseOthers={() => onCloseOthers(tab.tabId)}
                      onCloseToRight={() => onCloseToRight(tab.tabId)}
                      onCloseToLeft={() => onCloseToLeft(tab.tabId)}
                      onTogglePin={() => onTogglePin(tab.tabId)}
                      onCopyPath={() => onCopyText(tab.path)}
                      onCopyRelativePath={() =>
                        onCopyText(
                          workspacePath && tab.path.startsWith(`${workspacePath}/`)
                            ? tab.path.slice(workspacePath.length + 1)
                            : tab.path,
                        )
                      }
                      onCloseAllEditorTabs={() => {
                        for (const open of editorTabs) onCloseEditorTab(open.tabId);
                      }}
                      onStripKeyDown={(event) =>
                        stripKeyDown(event, tab.tabId)
                      }
                    />
                  );
                }
                const item = sessionById.get(entry.id);
                if (!item) return null;
                const isActive =
                  item.id === activeSessionId &&
                  activeBrowserTabId === null &&
                  activeEditorTabId === null;
                // Accessible name keeps the legacy "<label> <verdict>" shape
                // (the verdict text moved off the visible row into the name
                // so the strip matches the source chrome without losing the
                // screen-reader state both probes assert on).
                const text = recoveryTabLabel({
                  label: resolveTabTitle(
                    item.id,
                    defaultTitleBySessionId.get(item.id) ??
                      defaultTerminalTabTitle(1),
                    customTitles,
                  ),
                  verdict: item.verdict,
                  id: item.id,
                  incarnation: item.incarnation,
                });
                const retryable =
                  recoveryActionFor(item.verdict, {
                    // A confirmed close removes the tab, so a still-listed
                    // exited session is one the user did not request.
                    exitExpected: false,
                  }).kind === "retry-connection";
                return (
                  <SortableTab
                    key={item.id}
                    id={item.id}
                    title={text}
                    ariaLabel={`${text} ${item.verdict}`}
                    closeLabel={`Close ${text} session`}
                    icon={
                      <AgentStateIcon state={sessionDotState(item)} size={13} />
                    }
                    retry={
                      retryable ? (
                        <ShellIconButton
                          label="Retry connection"
                          disabled={retryDisabled}
                          onClick={() => onRetrySession(item)}
                        >
                          <RefreshCw />
                        </ShellIconButton>
                      ) : null
                    }
                    isActive={isActive}
                    isPinned={pinned.has(item.id)}
                    hasTabsToRight={hasTabsToRight}
                    hasTabsToLeft={hasTabsToLeft}
                    tabCount={entries.length}
                    closeDisabled={closeDisabled}
                    dropIndicator={dropIndicatorById.get(item.id)}
                    onActivate={onSelectSession}
                    onClose={(id) => {
                      const session = sessionById.get(id);
                      if (session) onCloseSession(session);
                    }}
                    onCloseOthers={onCloseOthers}
                    onCloseToRight={onCloseToRight}
                    onCloseToLeft={onCloseToLeft}
                    onTogglePin={onTogglePin}
                    onCommitTitle={onCommitTitle}
                    splitTerminal={
                      onSplitTerminal
                        ? {
                            // Already split tabs keep the submenu visible
                            // but disabled, like the source's busy gates.
                            disabled:
                              splitForTab(
                                hydrateTerminalSplits(terminalSplits ?? {}),
                                item.id,
                              ) !== null,
                            onSplitRight: () => onSplitTerminal(item.id),
                          }
                        : null
                    }
                    onStripKeyDown={stripKeyDown}
                  />
                );
              })}
            </div>
          </div>
        </SortableContext>
      </DndContext>
      {overflow.hasOverflow && (
        <button
          type="button"
          aria-label="Scroll tabs right"
          aria-disabled={!overflow.canScrollEnd}
          disabled={!overflow.canScrollEnd}
          className="mx-0.5 my-auto h-6 w-5 shrink-0 text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-35"
          onClick={() => {
            const el = tabStripRef.current;
            if (el) scrollTabStripByStep(el, "end");
          }}
        >
          <ChevronRight className="size-3.5" />
        </button>
      )}
      <TabCreateMenu
        workspaceId={workspaceId}
        hostId={hostId}
        harnesses={harnesses}
        disabled={createDisabled}
        defaultHarnessId={defaultHarnessId}
        launchDefaults={launchDefaults}
        newTerminalShortcut={newTerminalShortcut}
        newBrowserShortcut={newBrowserShortcut}
        onCreateTerminal={onCreateTerminal}
        onLaunch={onLaunchHarness}
        onNewBrowserTab={onNewBrowserTab}
        onOpenMentu={onOpenMentu}
        mentuAvailable={mentuAvailable}
        onOpenAgentSettings={onOpenAgentSettings}
        onNewMarkdown={onNewMarkdown}
      />
    </div>
  );
}
