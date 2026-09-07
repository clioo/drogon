/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/tab-bar/tab-bar-surface.tsx (strip chrome,
   tab container/width recipe hooks) and SortableTab.tsx (tab root chrome:
   border/state classes, active indicator, close affordance). Adapter: no
   drag reorder, no rename, no context menu, no pin (out of MVP scope) —
   tabs keep this repo's roving-tabindex keyboard order and role=tab
   semantics; state comes from session.agentState; browser pages render
   with the BrowserStripTab chrome. */
import { RefreshCw, X } from "lucide-react";
import type {
  Harness,
  HarnessLaunchInput,
  Session,
} from "../../../../shared/session-contract";
import type { BrowserTabState } from "../../../../shared/browser-contract";
import type { HarnessAgentDefault } from "../../settings-store";
import { sessionLabel } from "../../session-label";
import {
  recoveryActionFor,
  recoveryTabLabel,
} from "../../session-recovery";
import { agentStateOf } from "./agent-state";
import { AgentStateIcon } from "./AgentStateIcon";
import { ShellIconButton } from "./ShellIconButton";
import { BrowserStripTab } from "../browser/BrowserStripTab";
import { TabCreateMenu } from "./TabCreateMenu";
import {
  ACTIVE_TAB_INDICATOR_CLASSES,
  getTabRootStateClasses,
  getTabStripBorderClasses,
  TAB_CONTAINER_WIDTH_CLASSES,
  TAB_LABEL_WIDTH_CLASSES,
} from "./tab-chrome";

type StripEntry =
  | { kind: "session"; id: string }
  | { kind: "browser"; id: string };

/**
 * Unified tab strip: one tab per terminal session plus one per browser
 * page, then the "+" static create menu. Selecting a browser tab shows
 * the browser pane for that page in the tab area below the strip.
 */
export function TabBar({
  sessions,
  activeSessionId,
  browserTabs,
  activeBrowserTabId,
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
  onSelectSession,
  onSelectBrowserTab,
  onCloseSession,
  onCloseBrowserTab,
  onRetry,
  onCreateTerminal,
  onLaunchHarness,
  onNewBrowserTab,
  onOpenMentu,
  mentuAvailable,
}: {
  sessions: Session[];
  activeSessionId: string;
  browserTabs: BrowserTabState[];
  activeBrowserTabId: string | null;
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
  onSelectSession: (id: string) => void;
  onSelectBrowserTab: (tabId: string) => void;
  onCloseSession: (session: Session) => void;
  onCloseBrowserTab: (tabId: string) => void;
  onRetry: () => void;
  onCreateTerminal: () => void;
  onLaunchHarness: (input: HarnessLaunchInput) => Promise<boolean>;
  onNewBrowserTab: () => void;
  /** Mentu (J9) entry in the create menu; optional until the right-sidebar
   *  Mentu activity item lands. */
  onOpenMentu?: () => void;
  mentuAvailable?: boolean;
}) {
  const entries: StripEntry[] = [
    ...sessions.map((item) => ({ kind: "session" as const, id: item.id })),
    ...browserTabs.map((tab) => ({ kind: "browser" as const, id: tab.tabId })),
  ];
  const focusEntry = (entry: StripEntry) => {
    const selector =
      entry.kind === "session"
        ? `#session-tab-${CSS.escape(entry.id)}`
        : `[data-tab-id="${CSS.escape(entry.id)}"]`;
    document.querySelector<HTMLElement>(selector)?.focus();
  };
  const stepEntry = (currentId: string, delta: number) => {
    if (entries.length === 0) return;
    const at = entries.findIndex((entry) => entry.id === currentId);
    const next =
      entries[(at < 0 ? (delta < 0 ? 0 : -1) : at + delta + entries.length) %
        entries.length];
    if (next.kind === "session") onSelectSession(next.id);
    else onSelectBrowserTab(next.id);
    focusEntry(next);
  };
  const stripKeyDown = (event: React.KeyboardEvent, currentId: string) => {
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
      if (next.kind === "session") onSelectSession(next.id);
      else onSelectBrowserTab(next.id);
      focusEntry(next);
    }
  };

  return (
    <div
      // Why: fixed 40px row (the retired .terminal-tabs min-height); flex-1
      // is NOT set — in this column layout it would stretch the strip to
      // fill the pane area (the source surface sits in a row parent where
      // flex-1 only shares horizontal space).
      className="flex items-stretch h-10 shrink-0 overflow-hidden min-w-0 w-full"
      // Why: preload routes native OS drops by this marker — only the tab strip opens files in the editor, not terminal panes.
      data-native-file-drop-target="editor"
    >
      {/* Why: no-drag lets tab interactions work inside the titlebar's drag region (outer container stays window-draggable). */}
      <div className="group/tab-strip relative flex min-h-0 min-w-0 max-w-full flex-[0_1_auto]">
        <div
          className="terminal-tab-strip flex h-full min-w-0 max-w-full flex-1 items-stretch overflow-x-auto overflow-y-hidden border-r border-border/70"
          role="tablist"
          aria-label="Sessions"
        >
          {sessions.map((item, index) => {
            const isActive =
              item.id === activeSessionId && activeBrowserTabId === null;
            // Accessible name keeps the legacy "<label> <verdict>" shape
            // (the verdict text moved off the visible row into the name so
            // the strip matches the source chrome without losing the
            // screen-reader state both probes assert on).
            const text = recoveryTabLabel({
              label: sessionLabel(item, harnesses),
              verdict: item.verdict,
              id: item.id,
              incarnation: item.incarnation,
            });
            return (
              <div
                key={item.id}
                className={TAB_CONTAINER_WIDTH_CLASSES}
              >
                <div
                  className={`group relative flex items-center h-full px-1.5 text-xs cursor-pointer select-none outline-none focus:outline-none focus-visible:outline-none ${getTabStripBorderClasses(index < entries.length - 1)} ${getTabRootStateClasses(isActive)}`}
                  role="tab"
                  id={`session-tab-${item.id}`}
                  data-tab-id={item.id}
                  data-active={isActive ? "true" : "false"}
                  aria-selected={isActive}
                  aria-controls="active-session-panel"
                  aria-label={`${text} ${item.verdict}`}
                  tabIndex={isActive ? 0 : -1}
                  onKeyDown={(event) => stripKeyDown(event, item.id)}
                  onClick={() => onSelectSession(item.id)}
                >
                  {isActive && (
                    <span
                      className={ACTIVE_TAB_INDICATOR_CLASSES}
                      aria-hidden
                    />
                  )}
                  <AgentStateIcon state={agentStateOf(item)} size={13} />
                  <span className={`${TAB_LABEL_WIDTH_CLASSES} mr-1`}>
                    {text}
                  </span>
                  {recoveryActionFor(item.verdict, {
                    // A confirmed close removes the tab, so a still-listed
                    // exited session is one the user did not request.
                    exitExpected: false,
                  }).kind === "retry-connection" && (
                    <ShellIconButton
                      label="Retry connection"
                      disabled={retryDisabled}
                      onClick={onRetry}
                    >
                      <RefreshCw />
                    </ShellIconButton>
                  )}
                  <button
                    type="button"
                    aria-label={`Close ${sessionLabel(item, harnesses)} session`}
                    disabled={closeDisabled}
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
                      onCloseSession(item);
                    }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
          {browserTabs.map((tab, offset) => (
            <BrowserStripTab
              key={tab.tabId}
              tab={tab}
              isActive={tab.tabId === activeBrowserTabId}
              hasTabsToRight={sessions.length + offset < entries.length - 1}
              onActivate={() => onSelectBrowserTab(tab.tabId)}
              onClose={() => onCloseBrowserTab(tab.tabId)}
              onStripKeyDown={(event) => stripKeyDown(event, tab.tabId)}
            />
          ))}
        </div>
      </div>
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
      />
    </div>
  );
}
