// MIT Copyright (c) 2026 Lovecast Inc.
// Navigation adapted from drogon-orca/src/renderer/src/lib/worktree-activation.ts.
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Monitor,
  Moon,
  PanelRight,
  RefreshCw,
  Settings,
  Sun,
  TerminalSquare,
} from "lucide-react";
import { Tooltip } from "radix-ui";
import {
  agentSettingsState,
  migrateAgentPreferences,
  saveAgentSettings,
  useAgentSettings,
} from "./features/settings/agent-settings-state";
import { AGENT_CATALOG } from "./features/settings/agent-catalog";
import type {
  AgentState,
  Harness,
  HarnessId,
  HarnessLaunchInput,
  Project,
  Result,
  Session,
  Status,
  Worktree,
  Workspace,
} from "../../shared/session-contract";
import { Button } from "./components/ui/button";
import { Toaster } from "./components/ui/sonner";
import {
  isSessionDismissed,
  loadDismissedSessions,
  markSessionDismissed,
} from "./dismissed-sessions";
import { Sidebar } from "./features/shell/Sidebar";
import { DaemonConnectionBanner } from "./features/shell/DaemonConnectionBanner";
import {
  MENTU_TAB_ID,
  bulkCloseTargets,
  loadTabStripState,
  partitionPinnedOrder,
  reconcileTabOrder,
  remapTabOrder,
  saveTabStripState,
  togglePinnedOrder,
  type TabStripState,
} from "./features/shell/tab-order";
import { NewWorkspaceComposerModal } from "./features/new-workspace/NewWorkspaceComposerModal";
import {
  composerAgentLaunchInput,
  type ComposerAgentSelection,
} from "./features/new-workspace/composer-submit";
import {
  CLIENT_WORKTREE_CREATE_MAX_ATTEMPTS,
  getClientWorktreeCreateCandidate,
  isRetryableWorktreeCreateConflict,
} from "./features/new-workspace/worktree-create-retry";
// R16-AO (#231): every launch path resolves the Settings → Agents default
// permission mode (yolo/unattended for Claude Code, like the fork) instead
// of hardcoding one.
import { resolveHarnessPermissionMode } from "../../shared/agent-defaults";
import { TabBar } from "./features/shell/TabBar";
import { tabCreateMenuChord } from "./features/shell/TabCreateMenuChords";
import {
  editorDiffTabId,
  editorTabId,
  type EditorTabDiffArea,
  type EditorTabState,
} from "./features/shell/editor-tab";
import { EditorHost, planEditorRehydrate } from "./features/editor";
import { EditorDiffHost } from "./features/editor/EditorDiffHost";
import { useEditorTabMissingReconciler } from "./features/editor/editor-tab-missing-reconciler";
import {
  parseSourceControlRowOpenDetail,
  SOURCE_CONTROL_ROW_OPEN_EVENT,
} from "./features/source-control/row-open-event";
import { TitlebarLeftControls } from "./features/shell/TitlebarLeftControls";
import { RightSidebar } from "./features/right-sidebar/RightSidebar";
import { SessionDetailsPanel } from "./features/right-sidebar/SessionDetailsPanel";
import {
  buildRightSidebarActivityItems,
  getVisibleRightSidebarActivityItems,
  SIDEBAR_PORTS_TOGGLE_CHORD,
} from "./features/right-sidebar/activity-bar-items";
import { PortsPanel } from "./features/ports/PortsPanel";
import { loadRightSidebarTab, normalizeRightSidebarTab, resolveRightSidebarEffectiveTab, saveRightSidebarTab, type RightSidebarTab, resolveInitialRightSidebarTab } from "./features/right-sidebar/right-sidebar-route";
import {
  clampRightSidebarPanelWidth,
  loadRightSidebarOpen,
  loadRightSidebarWidth,
  saveRightSidebarOpen,
  saveRightSidebarWidth,
} from "./features/right-sidebar/right-sidebar-width";
import {
  formatSidebarChord,
  resolveChordPlatform,
  SIDEBAR_EXPLORER_TOGGLE_CHORD,
  SIDEBAR_RIGHT_TOGGLE_CHORD,
  SIDEBAR_SOURCE_CONTROL_TOGGLE_CHORD,
} from "./features/right-sidebar/shortcut-label";
import { resolveAppChromeLayout } from "./features/shell/app-chrome-layout";
import {
  canGoBackView,
  canGoForwardView,
  currentView,
  goBackView,
  goForwardView,
  initialViewHistory,
  pushView,
  rewindViewHistoryPastRoute,
} from "./features/shell/view-history";
import type { ViewEntry } from "./features/shell/view-history";
import {
  isFullPageRoute,
  noWorkspacePageCopy,
} from "./features/shell/page-host";
import {
  loadSidebarOpen,
  loadSidebarWidth,
  saveSidebarOpen,
  saveSidebarWidth,
} from "./features/shell/sidebar-width";
import { unreadDockBadgeCount } from "./features/shell/unread-badge-count";
import { Landing } from "./features/landing/Landing";
import { NewSessionDialog } from "./features/sessions/NewSessionDialog";
import { ServiceCapabilityNotice } from "./features/shell/ServiceCapabilityNotice";
import { NoWorkspacePage } from "./features/shell/NoWorkspacePage";
import {
  findWorkspaceForPath,
  gitProjectForWorkspace,
  isProjectsAvailable,
  isWorktreesAvailable,
  loadProjectView,
  reloadWorkspacesSnapshot,
  useProjectRegistryRefresh,
  windowProjectBridge,
} from "./features/shell/project-adapter";
import {
  resolveConnectionReadyReload,
  useConnectionReadyReload,
} from "./features/shell/connection-ready-reload";
import type { ProjectGroup } from "./features/shell/project-adapter";
import type { ProjectAction } from "./features/shell/ProjectList";
import { createUntitledMarkdown } from "./features/shell/untitled-markdown";
import type { FileOpenRequestCell } from "./features/workspaces/files-panel";
import { openCommandPalette } from "./features/shell/open-palette";
import { handleTextControlAppMenuPaste } from "./features/shell/text-control-paste";
import {
  buildHarnessLaunchRetry,
  harnessLaunchForRetry,
  rememberHarnessLaunch,
  type HarnessLaunchMemory,
} from "./features/shell/harness-launch-retry";
import { CommandPaletteHost } from "./components/command-palette";
import { supportsHarnessLaunch } from "./harness-capability";
import { projectTerminalRestartLaunch } from "./features/terminal/terminal-restart-launch";
import {
  TERMINAL_CLEAR_EVENT,
  TERMINAL_SEARCH_EVENT,
  TERMINAL_CLOSE_EVENT,
  TERMINAL_FILE_OPEN_EVENT,
  TERMINAL_RESTART_EVENT,
  type TerminalCloseDetail,
  type TerminalFileOpenDetail,
  type TerminalRestartDetail,
} from "./features/terminal/TerminalPane";
import { TerminalSplitHost } from "./features/terminal/TerminalSplitHost";
import {
  activateSplitPane,
  aggregateSplitAgentState,
  closeTerminalSplitPane,
  createTerminalSplit,
  hydrateTerminalSplits,
  isSplitPaneSession,
  migrateSplitTabIdentity,
  persistTerminalSplits,
  pruneTerminalSplits,
  replaceTerminalSplitPane,
  resizeTerminalSplit,
  secondarySplitPaneIds,
  splitForTab,
  type TerminalSplitMap,
} from "./features/terminal/terminal-split";
import { isExternalUrlAllowed } from "../../shared/shell-contract";
import type { ShellBridge } from "../../shared/shell-contract";
import { updateSessionProjection } from "./session-projection";
import { applySessionStatePush } from "./features/shell/session-state-push";
import { sessionLabel } from "./session-label";
import {
  FILES_ROUTE_ID,
  createGatedFileBridge,
  isFilesAvailable,
  registerFilesRoute,
} from "./files-mount";
import {
  CHANGES_ROUTE_ID,
  GIT_CAPABILITY,
  createGatedGitBridge,
  isChangesAvailable,
  registerChangesRoute,
  windowGitBridge,
} from "./changes-mount";
import {
  BOTS_CAPABILITY,
  BOTS_ROUTE_ID,
  buildBotsPanelProps,
  createGatedBotBridge,
  isBotsAvailable,
  registerBotsRoute,
} from "./bots-mount";
import {
  isAgentSettingsAvailable,
  shouldGateLaunchOnAgentSettingsReadiness,
} from "./daemon-capabilities";
import { BOTS_PAGE_HOST_TESTID } from "./features/bots";
import { MeetingsPage } from "./features/meetings";
import {
  MEETINGS_PAGE_HOST_TESTID,
  MEETINGS_ROUTE_ID,
  createGatedMeetingsBridge,
  isMeetingsAvailable,
  windowMeetingsBridge,
} from "./meetings-mount";
import type { BotsPanelProps } from "../../shared/bot-contract";
import { dispatchOpenBotSession } from "./features/bots/bot-session-open";
import { mergeSessionsForBots } from "./features/bots/bot-session-visibility";
import { resolveBotSession } from "./features/bots/bot-session-resolution";
import { harnessSupportsConversationResume } from "./features/bots/bots-page-model";
import { BotSessionHeader } from "./features/bots/BotSessionHeader";
import { BotSessionInspector } from "./features/bots/BotSessionInspector";
import {
  botSessionTitle,
  type BotSessionMeta,
} from "./features/bots/bot-session-chrome";
import {
  buildSidebarBotSessions,
  type SidebarBotSession,
} from "./features/shell/sidebar-bot-sessions";
import { sidebarSessionView } from "./features/shell/sidebar-sessions";
import {
  planBrowserRehydrate,
  windowBrowserBridge,
} from "./features/browser/browser-bridge";
import type { BrowserTabState } from "../../shared/browser-contract";
import { BrowserPanel } from "./features/browser/browser-panel";
import {
  AUTOMATIONS_CAPABILITY,
  AUTOMATIONS_PAGE_HOST_TESTID,
  AUTOMATIONS_ROUTE_ID,
  createGatedAutomationBridge,
  isAutomationsAvailable,
  registerAutomationsRoute,
} from "./automations-mount";
import {
  TASKS_CAPABILITY,
  TASKS_PAGE_HOST_TESTID,
  TASKS_ROUTE_ID,
  createGatedTasksBridge,
  createGatedTasksProjectBridge,
  isTasksAvailable,
  isTasksProjectsAvailable,
  registerTasksRoute,
  windowTasksBridge,
} from "./tasks-mount";
import {
  MENTU_CAPABILITY,
  MENTU_ROUTE_ID,
  createGatedMentuBridge,
  isMentuAvailable,
  registerMentuRoute,
  windowMentuBridge,
} from "./mentu-mount";
import { MENTU_OPEN_TAB_EVENT, MentuPanel } from "./features/mentu/MentuPanel";
import { WorkGraphPane } from "./features/work-graph/WorkGraphPane";
import { mentuStore } from "./features/mentu/mentu-store";
import { pickMentuMainSession } from "./features/mentu/mentu-run-dispatch";
import { refreshWorktreeIssueLinks } from "./features/tasks/issue-links";
import { TasksPage } from "./features/tasks/TasksPage";
import { loadBotSnapshot, resolveBotsScope } from "./bots-loader";
import type { BotsLoadResult } from "./bots-loader";
import { FILES_CAPABILITY } from "../../shared/file-contract";
import { subscribeWorkspaceFilesChanged } from "./features/file-explorer/files-watch";
import {
  applyPanelFocus,
  checkAvailability,
  createRouteRegistry,
  releasePanel,
  resolveRoute,
} from "./route-panel-contract";
import type { PanelDescriptor } from "./route-panel-contract";
import { dispatchShellKeybinding } from "./features/shell/keybinding-dispatcher";
import type {
  AppearanceMenuKey,
  AppearanceMenuState,
} from "../../shared/menu-contract";
import {
  useUnreadDockBadge,
  windowAppMenuBridge,
} from "./hooks/use-unread-dock-badge";
import { guardHandler } from "./shortcuts";
import {
  parsePersistedSettings,
  settingsStorageKey,
  SettingsStore,
} from "./settings-store";
import {
  assertCloseReplyFor,
  recoveryTabLabel,
  retryAffordanceDisabled,
  SESSIONS_INVALIDATE_EVENT,
} from "./session-recovery";
import {
  applyThemeToRoot,
  resolveEffectiveTheme,
  resolveInspectorDefault,
} from "./theme";
import type { HarnessAgentDefault, Theme, TerminalGpuAcceleration } from "./settings-store";
import { SettingsPage } from "./features/settings/SettingsPage";
import { SETTINGS_ROUTE_ID } from "./features/settings/settings-route";
import type { SettingsSectionId } from "./features/settings/settings-sections";
import { StatusBar } from "./components/status-bar/StatusBar";
import {
  loadSavedSelection,
  resolveRestoredSelection,
  resolveWorkspaceSelection,
  saveSavedSelection,
} from "./workspace-selection";

// One App mount owns one settings store; created lazily so importing this
// module (e.g. from pure-logic tests) never touches window/localStorage.
let uiSettingsStore: SettingsStore | null = null;
function uiSettings(): SettingsStore {
  if (!uiSettingsStore)
    uiSettingsStore = new SettingsStore(window.localStorage, {
      namespace: "ui",
    });
  return uiSettingsStore;
}

/**
 * Nullable read of the saved inspector choice: unlike the store's typed get
 * (which applies its default), this distinguishes "nothing saved yet" so
 * the reference default can be applied explicitly.
 */
function savedInspectorValue(): boolean | null {
  try {
    return (
      parsePersistedSettings(
        window.localStorage.getItem(settingsStorageKey("ui")),
      ).inspectorVisible ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Replaces an already-listed entry only on an exact host+id+incarnation
 * match (a retry recovering the same session); a coincident id from a
 * different host is appended, not overwritten, and a same-id/different-
 * incarnation match (the entry has since moved on, e.g. a restart) is
 * dropped as a stale receipt rather than clobbering the newer one.
 */
export function appendOrReplaceSession(
  items: Session[],
  result: Session,
): Session[] {
  const existing = items.find(
    (item) => item.id === result.id && item.hostId === result.hostId,
  );
  if (!existing) return [...items, result];
  if (existing.incarnation !== result.incarnation) return items;
  return items.map((item) => (item === existing ? result : item));
}

/**
 * Removes a session only on an exact host+id+incarnation match — a
 * coincident id from a different host, or a stale reply for an incarnation
 * that has since moved on, must never remove the actual current entry.
 */
export function removeSessionExact(
  items: Session[],
  target: { hostId: string; id: string; incarnation: string },
): Session[] {
  return items.filter(
    (item) =>
      !(
        item.id === target.id &&
        item.hostId === target.hostId &&
        item.incarnation === target.incarnation
      ),
  );
}

/** A late response is only ever applied against the host+workspace it was requested for, not whatever is current now. */
export function contextMatches(
  captured: { hostId: string | null; workspaceId: string },
  current: { hostId: string | null; workspaceId: string },
): boolean {
  return (
    captured.hostId === current.hostId &&
    captured.workspaceId === current.workspaceId
  );
}

/**
 * A confirmed close only ever removes/reselects the exact target
 * (host+id+incarnation) if it is still listed unchanged — a reply for an
 * incarnation since superseded (e.g. a restart raced the close) is a no-op,
 * never removing the newer entry. Callers pass an up-to-date snapshot
 * (e.g. a ref), not a stale closure.
 */
export function applyConfirmedClose(
  items: Session[],
  target: { hostId: string; id: string; incarnation: string },
  active: string,
): { sessions: Session[]; active: string } | null {
  const stillPresent = items.some(
    (item) =>
      item.hostId === target.hostId &&
      item.id === target.id &&
      item.incarnation === target.incarnation,
  );
  if (!stillPresent) return null;
  const sessions = removeSessionExact(items, target);
  const nextActive =
    active === target.id
      ? (sessions.find(
          (item) => !(item.id === target.id && item.hostId === target.hostId),
        )?.id ?? "")
      : active;
  return { sessions, active: nextActive };
}

export const IconButton = forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button> & { label: string }
>(function IconButton({ label, children, ...props }, ref) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          ref={ref}
          variant="ghost"
          size="icon"
          aria-label={label}
          {...props}
        >
          {children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" sideOffset={4}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
});

/**
 * Single App mount for contract-registered panels: resolves the visible
 * descriptor, applies the focus contract on mount and releases panel
 * resources on unmount. Files panels mount session-less by design.
 */
export function MountedPanel({
  descriptor,
  workspace,
  status,
}: {
  descriptor: PanelDescriptor;
  workspace: Workspace;
  status: Status;
}) {
  useEffect(() => {
    applyPanelFocus(descriptor, null);
    return () => releasePanel(descriptor);
  }, [descriptor]);
  const Component = descriptor.component;
  return (
    <Component
      routeId={descriptor.id}
      session={null}
      workspace={workspace}
      status={status}
      focusTarget={null}
    />
  );
}

export function App() {
  const settings = uiSettings();
  const agentPreferences = useAgentSettings();
  useEffect(() => {
    let legacy = {};
    try {
      legacy = parsePersistedSettings(window.localStorage.getItem(settingsStorageKey("ui")));
    } catch { /* Fresh profile. */ }
    void agentSettingsState.load(migrateAgentPreferences(legacy));
  }, []);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  // Read inside in-flight `create`/`launchHarness`/`close` callbacks so a
  // late response is checked against what's current *now*, not a stale
  // value closed over when the call started.
  const contextRef = useRef({
    hostId: status?.hostId ?? null,
    workspaceId: selected,
  });
  contextRef.current = {
    hostId: status?.hostId ?? null,
    workspaceId: selected,
  };
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeRef = useRef(active);
  activeRef.current = active;
  // Render-time mirror for the async tab rehydrate below (sessionsRef pattern).
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [inspector, setInspector] = useState(() =>
    resolveInspectorDefault(savedInspectorValue()),
  );
  const [theme, setTheme] = useState<Theme>(() => settings.get("theme"));
  const [terminalFontSize, setTerminalFontSize] = useState(
    () => settings.get("terminalFontSize"),
  );
  const [terminalGpuAcceleration, setTerminalGpuAcceleration] = useState(
    () => settings.get("terminalGpuAcceleration"),
  );
  // J10 typography (R14-E): App mirrors the store so the Settings controls
  // write through the single store path — direct envelope writes would be
  // clobbered by the store's next debounced whole-envelope flush.
  const [terminalFontFamily, setTerminalFontFamily] = useState(
    () => settings.get("terminalFontFamily"),
  );
  const [terminalFontWeight, setTerminalFontWeight] = useState(
    () => settings.get("terminalFontWeight"),
  );
  const [terminalFontWeightBold, setTerminalFontWeightBold] = useState(
    () => settings.get("terminalFontWeightBold"),
  );
  const [editorFontFamily, setEditorFontFamily] = useState(
    () => settings.get("editorFontFamily"),
  );
  const [legacyDefaultHarnessId, setDefaultHarnessId] = useState(
    () => settings.get("defaultHarnessId"),
  );
  const [legacyHarnessDefaults, setHarnessDefaults] = useState(
    () => settings.get("harnessDefaults"),
  );
  // Native launch arguments take over after the one-time migration.
  const harnessDefaults = agentPreferences.ready ? {} : legacyHarnessDefaults;
  const [notifyOnAgentNeedsInput, setNotifyOnAgentNeedsInput] = useState(
    () => settings.get("notifyOnAgentNeedsInput"),
  );
  const [notifyOnAgentTaskComplete, setNotifyOnAgentTaskComplete] = useState(
    () => settings.get("notifyOnAgentTaskComplete"),
  );
  const [notifyOnTerminalBell, setNotifyOnTerminalBell] = useState(
    () => settings.get("notifyOnTerminalBell"),
  );
  const [notifySuppressWhenFocused, setNotifySuppressWhenFocused] = useState(
    () => settings.get("notifySuppressWhenFocused"),
  );
  // R14-B appearance flags (source default-on settings the native View >
  // Appearance submenu checkbox-marks; consumed by the shell below).
  const [appearanceFlags, setAppearanceFlags] = useState(() => ({
    statusBarVisible: settings.get("statusBarVisible"),
    tasksButtonVisible: settings.get("tasksButtonVisible"),
    automationsButtonVisible: settings.get("automationsButtonVisible"),
    titlebarAppNameVisible: settings.get("titlebarAppNameVisible"),
  }));
  const appearanceReportRef = useRef<string | null>(null);
  // Settings is a full page (route "settings"), not a dialog: opening it
  // remembers the previous route so "Back to app" returns to that view.
  const [settingsReturnRoute, setSettingsReturnRoute] = useState<string | null>(
    null,
  );
  const [settingsInitialSection, setSettingsInitialSection] =
    useState<SettingsSectionId | "project">("general");
  // Per-project settings section (task R14-A): the project whose
  // "Project Settings > {name}" section the settings page shows. Null
  // hides the project section; set together with the initial section.
  const [settingsProject, setSettingsProject] = useState<Project | null>(
    null,
  );
  const [revision, setRevision] = useState(0);
  const [harnessCapability, setHarnessCapability] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [detectedHarnesses, setHarnesses] = useState<Harness[]>([]);
  const harnesses = useMemo(
    () => detectedHarnesses.filter((harness) => !agentPreferences.settings.disabledTuiAgents.includes(harness.harnessId)),
    [detectedHarnesses, agentPreferences.settings.disabledTuiAgents],
  );
  const preferredAgent = agentPreferences.settings.defaultTuiAgent;
  const automaticAgent = AGENT_CATALOG.find((agent) =>
    harnesses.some((harness) => harness.harnessId === agent.id && harness.availability === "available"),
  )?.id ?? "";
  const defaultHarnessId = !agentPreferences.ready
    ? legacyDefaultHarnessId
    : preferredAgent === "blank" ? "" : preferredAgent ?? automaticAgent;
  useEffect(() => {
    if (!agentPreferences.ready) return;
    let cancelled = false;
    void window.drogon.harnesses().then((result) => {
      if (!cancelled && result.ok) setHarnesses(result.result.harnesses);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [agentPreferences.ready, agentPreferences.settings.agentCmdOverrides]);
  const [buildInfo, setBuildInfo] = useState<{
    revision: string;
    builtAt: string;
    version: string;
  } | null>(null);
  // Sidebar project view: real projects/worktrees once the service
  // advertises them (project-adapter falls back to the Workspace list
  // until then, so this is never empty while workspaces exist).
  const [projectGroups, setProjectGroups] = useState<ProjectGroup[]>([]);
  // Sidebar project dialogs (add project, remove worktree). Null means
  // none open.
  const [projectAction, setProjectAction] = useState<ProjectAction | null>(
    null,
  );
  // New-workspace composer modal (Landing, Cmd+N, palette, Projects
  // header "+"). A project id preselects the composer; null leaves the
  // selector on the first listed project.
  const [composer, setComposer] = useState<{
    initialProjectId: string | null;
  } | null>(null);
  // Quick-open reveal cell: the Files descriptor is registered once (see
  // filesBaseRegistry), so the request travels through this stable cell
  // and a re-render tick rather than a re-registration (which would
  // remount every panel). Monotonic nonce lives in the ref.
  const fileOpenCell = useMemo<FileOpenRequestCell>(
    () => ({ current: null }),
    [],
  );
  const fileOpenNonce = useRef(0);
  const [, setFileOpenTick] = useState(0);
  useEffect(() => {
    // A local file read, not an RPC — available even while disconnected,
    // and simply absent (never fabricated) outside a packaged build. A
    // rejection (rather than the resolved `null` this bridge method
    // otherwise uses for "no build info") is still just "no build info",
    // not an unhandled promise.
    void window.drogon
      .buildInfo()
      .then(setBuildInfo)
      .catch(() => setBuildInfo(null));
  }, []);
  useEffect(() => {
    // Applies the effective theme to the documentElement (.dark hook in
    // main.css). While following the system scheme the class must track OS
    // changes live; an explicit choice skips the listener. The effect re-runs
    // on theme change and unmount, which is exactly the cleanup contract.
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      applyThemeToRoot(
        document.documentElement,
        resolveEffectiveTheme(theme, query.matches),
      );
    apply();
    if (theme !== "system") return;
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [theme]);
  const current = workspaces.find((item) => item.id === selected);
  // Single App mount for contract panels. The registry vocabulary is the
  // static contract set (files.v1 declared here); mounting additionally
  // requires the LIVE service to advertise it.
  // Mount lifetime: once user-routed while available, the panel stays
  // mounted (hidden, state intact) across Terminals/files switches and
  // transient refresh gaps (status null), so navigation never discards
  // unsaved editor drafts. It unmounts on explicit capability withhold
  // (present status without files.v1, even while busy) and on settled
  // workspace loss — a kept-alive panel can never call behind a withheld
  // capability because every bridge call additionally passes the
  // fail-closed gate below. Draft survival across a true capability loss
  // needs V3 draft-state hoisting (their item).
  const [route, setRoute] = useState<string | null>(null);
  // R6-A shell chrome: sidebar collapse + width persist in the shell's own
  // localStorage keys (settings-store.ts is owned by another task), and the
  // titlebar back/forward pair walks a small workspace/view history stack.
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    loadSidebarOpen(window.localStorage),
  );
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    loadSidebarWidth(window.localStorage),
  );
  // R6-B right sidebar: width, collapsed state and tab persist in the
  // shell's own localStorage keys (source defaults: width 280, Explorer).
  // A saved open choice wins; otherwise the reference's visible default is
  // used at every window width.
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    loadRightSidebarWidth(window.localStorage),
  );
  const [rightSidebarOpen, setRightSidebarOpen] = useState(
    () =>
      loadRightSidebarOpen(window.localStorage) ??
      resolveInspectorDefault(savedInspectorValue()),
  );
  const [rightSidebarTab, setRightSidebarTab] = useState<RightSidebarTab>(
    () => loadRightSidebarTab(window.localStorage) ?? "explorer",
  );
  // First mount needs explicit user routing per panel (activity bar,
  // palette, or chord); a persisted tab counts as prior routing for that
  // panel. Never auto-mounts unopened panels.
  const filesRoutedRef = useRef(
    resolveInitialRightSidebarTab(window.localStorage) === "explorer",
  );
  const changesRoutedRef = useRef(
    loadRightSidebarTab(window.localStorage) === "source-control",
  );
  const mentuRoutedRef = useRef(
    loadRightSidebarTab(window.localStorage) === "mentu",
  );
  // Browser tabs live in the main process; the strip mirrors the workspace
  // scope and owns the selection. A host-created page (capture-links,
  // relay) auto-selects only while a browser tab is already selected or
  // the creation came from the "+" menu (expectBrowserTab).
  const [browserTabs, setBrowserTabs] = useState<BrowserTabState[]>([]);
  const [activeBrowserTabId, setActiveBrowserTabId] = useState<string | null>(
    null,
  );
  // Render-time mirror for the tab rehydrate live-echo wait below.
  const browserTabsRef = useRef(browserTabs);
  browserTabsRef.current = browserTabs;
  // R16-A editor tabs (fixes #133): open files are a third tab kind in the
  // main strip, alongside sessions and browser tabs — purely local state
  // (no host/daemon concept of "open tabs"; the daemon just serves file
  // content). `tabId` is the path, so opening an already-open path can
  // never mint a duplicate tab. Reset on workspace switch below, like the
  // browser tab selection.
  const [editorTabs, setEditorTabs] = useState<EditorTabState[]>([]);
  const [activeEditorTabId, setActiveEditorTabId] = useState<string | null>(
    null,
  );
  // Render-time mirror for the async tab rehydrate below (sessionsRef pattern).
  const editorTabsRef = useRef(editorTabs);
  editorTabsRef.current = editorTabs;
  // Mentu as a fourth strip kind (fixes the reported bug: the "+" menu's
  // Mentu entry used to set a full-page ROUTE, and a full-page route hides
  // the terminal column — which is where the tab strip lives, so the whole
  // tab system vanished). Membership is per workspace and rides the
  // tab-strip envelope (`tabStrip.mentu`, tab-order.ts); the selection is
  // local like the browser/editor selections. Mentu is a singleton per
  // workspace (the fork's RecipeTab has one tab per worktree), so a
  // boolean plus the shared MENTU_TAB_ID is the whole record.
  const [activeMentuTab, setActiveMentuTab] = useState(false);
  // Set while a relayed `mentu.open` for a NOT-currently-selected workspace
  // is switching to it; cleared once that workspace's strip load lands.
  const pendingMentuOpenRef = useRef<string | null>(null);
  // R12-D tab strip: order, pins and renames persist per workspace in the
  // shell's own localStorage envelope (tab-order.ts), like the sidebar keys.
  const [tabStrip, setTabStrip] = useState<TabStripState>(() =>
    loadTabStripState(window.localStorage, selected),
  );
  useEffect(() => {
    setTabStrip(loadTabStripState(window.localStorage, selected));
  }, [selected]);
  /** This workspace's Mentu tab membership (the envelope is the owner). */
  const mentuTabOpen = tabStrip.mentu;
  const updateTabStrip = (next: TabStripState) => {
    setTabStrip(next);
    saveTabStripState(window.localStorage, selected, next);
  };
  // R16-N Split Terminal Right: splits live inside the tab-strip envelope
  // (additive `splits` key), so they persist per workspace across renderer
  // reloads exactly like order/pins/renames. Hydration + pruning are pure
  // (terminal-split.ts); only this block touches tabStrip for splits.
  const tabStripRef = useRef(tabStrip);
  tabStripRef.current = tabStrip;
  const writeSplits = (splits: TerminalSplitMap) => {
    const next: TabStripState = {
      ...tabStripRef.current,
      splits: persistTerminalSplits(splits),
    };
    tabStripRef.current = next;
    setTabStrip(next);
    saveTabStripState(window.localStorage, selectedRef.current, next);
  };
  const liveSplits: TerminalSplitMap = pruneTerminalSplits(
    hydrateTerminalSplits(tabStrip.splits ?? {}),
    new Set(sessions.map((item) => item.id)),
  );
  useEffect(() => {
    // Persists the prune once sessions settle (e.g. a pane's daemon
    // session is gone after reload): the split dissolves back to single.
    const persisted = persistTerminalSplits(liveSplits);
    if (JSON.stringify(persisted) !== JSON.stringify(tabStrip.splits ?? {})) {
      updateTabStrip({ ...tabStrip, splits: persisted });
    }
    // Runs when the inputs settle; the updater above is idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, selected]);
  // Second panes never own strip tabs: the strip, the sidebar and the
  // order helpers below only ever see root sessions.
  const splitSecondaryIds = secondarySplitPaneIds(liveSplits);
  const stripSessions = sessions.filter(
    (item) => !splitSecondaryIds.has(item.id),
  );
  const sessionById = new Map(sessions.map((item) => [item.id, item]));
  // Tab title/badge semantics for a split tab: the title stays the root
  // session's label/rename; the badge aggregates to the hottest pane.
  const displaySessions = stripSessions.map((item) => {
    const split = splitForTab(liveSplits, item.id);
    if (!split) return item;
    const second = sessionById.get(split.panes[1]);
    if (!second) return item;
    const aggregated = aggregateSplitAgentState(
      item.agentState ?? "unknown",
      second.agentState ?? "unknown",
    );
    return aggregated === (item.agentState ?? "unknown")
      ? item
      : { ...item, agentState: aggregated };
  });
  // A restored selection can point at a second pane (it was the last
  // session): the tab it belongs to is its split root.
  const activeRootId = (() => {
    if (splitSecondaryIds.has(active)) {
      for (const split of Object.values(liveSplits)) {
        if (split.panes[1] === active) return split.rootId;
      }
    }
    return active;
  })();
  // The session panel shows the tab's root session; split panes render
  // inside the host below.
  const terminal = sessions.find((item) => item.id === activeRootId);
  const knownBrowserIds = useRef(new Set<string>());
  const expectBrowserTab = useRef(false);
  // Focus follows explicit right-sidebar routing only (never capability
  // churn): handlers stamp the request, the effect below consumes it.
  const rightFocusRequest = useRef<RightSidebarTab | null>(null);
  // Routing intent must recompute the render-time keep-alive flags even
  // when the tab and open states are unchanged (React bails out on
  // identical setStates, so stamping the routed ref alone would never
  // mount the panel). Every explicit routing bumps this tick.
  const [rightTick, setRightTick] = useState(0);
  const [viewHistory, setViewHistory] = useState(() =>
    initialViewHistory({ route: null, workspaceId: "" }),
  );
  const historySeeded = useRef(false);
  const applyingHistory = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const routeRef = useRef(route);
  routeRef.current = route;
  const liveCapabilities = status?.capabilities ?? [];
  // Gate refs update in an effect (never during render): steady-state
  // exact, bounded one-commit staleness on transitions. The render guard
  // (explicitWithhold below) is synchronous, so the gate is
  // defense-in-depth for races, not the primary fence.
  // Fresh mounts additionally wait for the write (gatesArmedFor): the gate
  // refs are parent effects, so a panel mounting in the same commit that
  // delivers capabilities would otherwise read the previous commit's values
  // (child effects run first) and fail closed permanently — exactly the
  // post-reload persisted-tab mount. Deps use the stable snapshot, not the
  // capabilities array (a fresh [] identity every disconnected render would
  // loop on the epoch bump).
  const gateSnapshot = [
    isFilesAvailable(liveCapabilities),
    isChangesAvailable(liveCapabilities),
    isTasksAvailable(liveCapabilities),
    isBotsAvailable(liveCapabilities),
    isAutomationsAvailable(liveCapabilities),
  ].join("|");
  const [_gateEpoch, setGateEpoch] = useState(0);
  const gatedSnapshotRef = useRef<string | null>(null);
  const filesGateRef = useRef(false);
  const gitGateRef = useRef(false);
  const tasksGateRef = useRef(false);
  const botsGateRef = useRef(false);
  const automationsGateRef = useRef(false);
  const meetingsGateRef = useRef(false);
  useEffect(() => {
    filesGateRef.current = isFilesAvailable(liveCapabilities);
    gitGateRef.current = isChangesAvailable(liveCapabilities);
    tasksGateRef.current = isTasksAvailable(liveCapabilities);
    botsGateRef.current = isBotsAvailable(liveCapabilities);
    automationsGateRef.current = isAutomationsAvailable(liveCapabilities);
    meetingsGateRef.current = isMeetingsAvailable(liveCapabilities);
    gatedSnapshotRef.current = gateSnapshot;
    setGateEpoch((epoch) => epoch + 1);
  }, [gateSnapshot]);
  const gatesArmedFor = gatedSnapshotRef.current === gateSnapshot;
  // Updated synchronously during render (unlike the other feature gates
  // above, which flip in an effect): MentuPanel fetches its recipe list
  // from its own mount effect, in the very commit its parent's conditional
  // render first mounts it, so an effect-updated ref would still read one
  // commit stale at that exact moment and the fetch would never retry.
  const mentuGateRef = useRef(false);
  mentuGateRef.current = isMentuAvailable(liveCapabilities);
  const mentuGatedBridge = useMemo(
    () => createGatedMentuBridge(windowMentuBridge(), () => mentuGateRef.current),
    [],
  );
  // The Run Recipe delegation target: the selected workspace's main agent
  // session. Derived from the same session list the tab strip renders, so
  // the Mentu pane can never believe in a session the shell does not show.
  const mentuDispatchContext = useMemo(
    () => ({
      activeSessionId: active || null,
      mainSession: pickMentuMainSession(sessions, active || null),
    }),
    [active, sessions],
  );
  const filesGatedBridge = useMemo(
    () => createGatedFileBridge(window.drogon, () => filesGateRef.current),
    [],
  );
  const gitGatedBridge = useMemo(
    () => createGatedGitBridge(windowGitBridge(), () => gitGateRef.current),
    [],
  );
  const tasksGatedBridge = useMemo(
    () => createGatedTasksBridge(windowTasksBridge(), () => tasksGateRef.current),
    [],
  );
  // Interim project bridge (journey J6): feeds the sidebar's project view
  // with real project/worktree RPCs through the tasks namespace until the
  // coordinator lands the first-class project bridge. Gated on
  // project.v1/worktree.v1; when withheld, the workspace fallback below
  // behaves exactly as before this change.
  const tasksProjectGateRef = useRef(false);
  useEffect(() => {
    tasksProjectGateRef.current = isTasksProjectsAvailable(liveCapabilities);
  }, [liveCapabilities]);
  const tasksProjectBridge = useMemo(
    () =>
      createGatedTasksProjectBridge(
        windowTasksBridge(),
        () => tasksProjectGateRef.current,
      ),
    [],
  );
  const botsGatedBridge = useMemo(
    () => createGatedBotBridge(window.drogon, () => botsGateRef.current),
    [],
  );
  // Meetings: the granted namespace may be absent on an older bridge, so the
  // gate wraps whatever the window exposes and the page renders its honest
  // "no bridge" failure when there is nothing to wrap.
  const meetingsStaticBridge = useMemo(() => windowMeetingsBridge(), []);
  const meetingsGatedBridge = useMemo(
    () =>
      meetingsStaticBridge
        ? createGatedMeetingsBridge(meetingsStaticBridge, () => meetingsGateRef.current)
        : null,
    [meetingsStaticBridge],
  );
  const automationsGatedBridge = useMemo(
    () =>
      createGatedAutomationBridge(
        window.drogon.automation,
        () => automationsGateRef.current,
      ),
    [],
  );
  // Bots snapshot loads through the gated bridge for the exact live scope;
  // results carry their scope triple and render only on scope match, so no
  // stale snapshot ever shows for another host. No run control: the panel
  // is read-only until the BotRun bridge lands.
  // #348/R17-E: the scope is always the app-global empty-workspace scope
  // (""), matching the fork's app-global window.api.bots.list() — narrowing
  // to the selected workspace's folder rendered 'No Bots yet' for bots
  // owned elsewhere. The native bot.snapshot RPC admits the empty-workspace
  // scope as this host-global variant.
  const botsScope = resolveBotsScope(status, settings.get("locale"));
  const botsScopeHost = botsScope?.hostId ?? null;
  const botsScopeWorkspace = botsScope?.workspaceId ?? null;
  const botsScopeLocale = botsScope?.locale ?? null;
  function botsScopeEquals(
    scope:
      | { hostId: string; workspaceId: string; locale: string }
      | null
      | undefined,
  ): scope is { hostId: string; workspaceId: string; locale: string } {
    return (
      scope != null &&
      botsScopeHost !== null &&
      scope.hostId === botsScopeHost &&
      scope.workspaceId === botsScopeWorkspace &&
      scope.locale === botsScopeLocale
    );
  }
  const [botsLoad, setBotsLoad] = useState<BotsLoadResult | null>(null);
  const [botsReload, setBotsReload] = useState(0);
  const botsAvailable = isBotsAvailable(liveCapabilities);
  useEffect(() => {
    let cancelled = false;
    async function run() {
      // Loaded app-wide (not only on the Bots route): the sidebar's Chats
      // section lists Bots with a session, so the snapshot has to exist
      // wherever the user is. The previous result is kept while the fresh
      // read is in flight (never a stale error, never an empty flash).
      if (!botsAvailable || !botsScope) return;
      const result = await loadBotSnapshot(botsGatedBridge, botsScope);
      if (!cancelled) setBotsLoad(result);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    botsAvailable,
    botsScopeHost,
    botsScopeWorkspace,
    botsScopeLocale,
    botsReload,
  ]);
  // Entering the Bots page still forces a fresh read; the sidebar keeps the
  // last snapshot live in between, so this is a refresh, not the first load.
  useEffect(() => {
    if (route === BOTS_ROUTE_ID) setBotsReload((value) => value + 1);
  }, [route]);
  // Bot-session persistence: this app-level snapshot (not the Bots page's
  // own local one) is what the sidebar's Chats section reads. Without a
  // trigger here, a session opened/rotated/exited while the Bots page is
  // CLOSED would sit stale until the page is next revisited — a Bot
  // session must stay known and truthful for as long as it is alive,
  // never only while the page that opened it happens to still be open.
  // Runs on the same cadence as the host-wide session-list poll below.
  useEffect(() => {
    if (!botsAvailable || botsScopeHost === null) return;
    const timer = window.setInterval(
      () => setBotsReload((value) => value + 1),
      4000,
    );
    return () => window.clearInterval(timer);
  }, [botsAvailable, botsScopeHost, botsScopeWorkspace, botsScopeLocale]);
  // Stable files base: Bots snapshot refreshes must never reset the Files
  // descriptor identity (mounted editor drafts/attempts). The bots layer
  // rebuilds on snapshot change; the files base below never does.
  // Browser is a local Electron feature (no service capability, no route):
  // the static bridge feeds the tab strip subscription and the tab-hosted
  // pane directly.
  const browserStaticBridge = useMemo(() => windowBrowserBridge(), []);
  const filesBaseRegistry = useMemo(
    () =>
      registerMentuRoute(
        registerAutomationsRoute(
          registerChangesRoute(
            registerFilesRoute(
              createRouteRegistry({
                capabilities: [
                  FILES_CAPABILITY,
                  BOTS_CAPABILITY,
                  GIT_CAPABILITY,
                  AUTOMATIONS_CAPABILITY,
                  TASKS_CAPABILITY,
                  MENTU_CAPABILITY,
                ],
                fallbackId: BOTS_ROUTE_ID,
              }),
              filesGatedBridge,
              fileOpenCell,
            ),
            gitGatedBridge,
          ),
          {
            bridge: automationsGatedBridge,
            listWorkspaces: () => window.drogon.workspaces(),
            listHarnesses: () => window.drogon.harnesses(),
            // #270: fork use-automations-page-escape — top-level Escape
            // closes the page back to the view that opened it.
            onClose: () => automationsCloseRef.current(),
          },
        ),
        mentuGatedBridge,
      ),
    [
      filesGatedBridge,
      gitGatedBridge,
      automationsGatedBridge,
      mentuGatedBridge,
      fileOpenCell,
    ],
  );
  // Tasks host callbacks: stable across renders (the registry memo below
  // runs once). Groups ride a ref so the page always re-reads the current
  // projects on mount/refresh instead of a stale closure.
  const projectGroupsRef = useRef(projectGroups);
  projectGroupsRef.current = projectGroups;
  const loadTaskGroups = useCallback(() => projectGroupsRef.current, []);
  // Bots header Back closes the page like the fork: it rides a ref because
  // the view-history handler is defined further down this component.
  const botsCloseRef = useRef<() => void>(() => {});
  // Bot open-session focus (Carlos directive on task_0436fdf3aa91): the
  // Bots panel hands back the REAL session native opened for the bot.
  // Recorded here and activated when the session list delivers it (effect
  // below) — in-app tab state only, never OS activation. Rides refs
  // because closePageRoute is defined further down, same as botsCloseRef.
  const pendingBotSessionRef = useRef<{
    workspaceId: string;
    sessionId: string;
    meta: BotSessionMeta;
  } | null>(null);
  const openBotSessionRef = useRef<
    NonNullable<BotsPanelProps["onOpenSession"]>
  >(() => {});
  // Gap 2 liveness lookup, supplied by the host and read through a ref for
  // the same reason as openBotSessionRef: the panel registry memo must not
  // rebuild on every session poll.
  const resolveBotSessionRef = useRef<
    NonNullable<BotsPanelProps["resolveBotSession"]>
  >(() => ({ kind: "open" }));
  // Bot-scoped chrome (bug-bot-a836b4ebf8be65505): identity/harness/home
  // facts the dispatched open-session turn echoed, keyed by the real
  // session id it opened — never invented, never re-derived by guessing.
  // Liveness/timing (verdict, agentState, createdAt) still comes from the
  // live `sessions` list; this map is identity only.
  const [botSessions, setBotSessions] = useState<Map<string, BotSessionMeta>>(
    () => new Map(),
  );
  // Defect: a Bot session's Chats row (and the Gap-2 resume check) must
  // stay truthful regardless of which workspace is currently selected —
  // `sessions` below is deliberately scoped to `selected` (ordinary tab
  // strip membership stays per-workspace, untouched by this fix), so a
  // Bot's session living in a DIFFERENT workspace than the one you just
  // switched to would otherwise vanish from `sessions` entirely and look
  // exited/gone even though the daemon still runs it. This polls the
  // full host-wide session list (`window.drogon.sessions()` with no
  // `workspaceId`) on its own cadence, independent of `selected`.
  const [allBotSessions, setAllBotSessions] = useState<Session[]>([]);
  // Live pid for the currently-focused Bot session, refreshed by the
  // polling effect below (bot.snapshot's projected `currentSession.processId`).
  // Keyed by session id so a stale read for a since-switched-away session
  // can never paint over the pid of whichever Bot session is active now.
  const [botSessionPid, setBotSessionPid] = useState<{
    sessionId: string;
    processId: number | null;
  } | null>(null);
  // Live-ticking clock for the inspector's Started row; ticks only while a
  // Bot session tab is actually focused (effect below), never in the
  // background.
  const [botSessionClockMs, setBotSessionClockMs] = useState(() => Date.now());
  // #270: same pattern for the Tasks page's Close/Esc — the registered
  // descriptor (the workspace-scoped mount) needs a stable onClose that
  // resolves to the view-history handler defined further down.
  const tasksCloseRef = useRef<() => void>(() => {});
  // #270: same pattern for the Automations page's Esc — the fork's
  // use-automations-page-escape closes the page from its top level.
  const automationsCloseRef = useRef<() => void>(() => {});
  // #270: fork previousViewBefore<Tasks|Bots|Automations> — each full page
  // remembers the view that was active when it OPENED; Close/Escape return
  // there (never a history pop, which can land on an unrelated page).
  const pageReturnViewRef = useRef(new Map<string, ViewEntry>());
  const lastViewRef = useRef<ViewEntry | null>(null);
  // #237: the Bots page registers the moment its scope exists — over an
  // empty placeholder snapshot with snapshotPending — so the nav switch
  // paints the fork's page chrome (header + loading state) in the same
  // commit that hides the terminal. The live snapshot hydrates after
  // without blocking first paint; a scope mismatch falls back to the
  // placeholder, never stale rows for another workspace.
  const freshBotsLoad =
    botsLoad?.status === "loaded" && botsScopeEquals(botsLoad.scope)
      ? botsLoad
      : null;
  const panelRegistry = useMemo(() => {
    if (botsAvailable && botsScope)
      return registerBotsRoute(filesBaseRegistry, botsGatedBridge, {
        ...buildBotsPanelProps(
          freshBotsLoad?.snapshot ?? { bots: [], history: [] },
          undefined,
          botsScope,
        ),
        snapshotPending: freshBotsLoad === null,
        onClose: () => botsCloseRef.current(),
        // Reads ride the app-global scope, but bot.create needs a real
        // placement folder: the selected workspace, if any.
        createWorkspaceId: current?.id,
        // Real-session handoff: the panel reports native's opened session;
        // the ref below selects its workspace, leaves the page and focuses
        // the tab once the list delivers it.
        onOpenSession: (input) => openBotSessionRef.current(input),
        // Gap 2: the default Open-session click resumes a session the host
        // has positively observed is live instead of spawning a second one.
        resolveBotSession: (input) => resolveBotSessionRef.current(input),
      });
    return filesBaseRegistry;
  }, [
    filesBaseRegistry,
    botsGatedBridge,
    botsAvailable,
    botsLoad,
    botsScopeHost,
    botsScopeWorkspace,
    botsScopeLocale,
  ]);
  // Right sidebar activity items (source order and gating): Explorer
  // always; Mentu while a workspace is selected and mentu.v1 is
  // advertised; Source Control for git workspaces while git.v1 is
  // advertised; Ports while a workspace is selected (R13-B's local panel —
  // the source gates its bar item sshOnly, which no local workspace ever
  // satisfies). No Session details item: the source has none, so that
  // panel stays reachable only through the session header toggle and the
  // palette. A stored tab that is not visible renders the fallback
  // without losing the stored route.
  const chordPlatform = resolveChordPlatform(
    typeof navigator !== "undefined" ? navigator.userAgent : "",
  );
  const gitPanelAvailable = isChangesAvailable(liveCapabilities);
  const mentuPanelAvailable = isMentuAvailable(liveCapabilities);
  const rightItems = useMemo(
    () =>
      getVisibleRightSidebarActivityItems(
        buildRightSidebarActivityItems({
          explorerShortcut: formatSidebarChord(
            SIDEBAR_EXPLORER_TOGGLE_CHORD,
            chordPlatform,
          ),
          sourceControlShortcut: formatSidebarChord(
            SIDEBAR_SOURCE_CONTROL_TOGGLE_CHORD,
            chordPlatform,
          ),
          portsShortcut: formatSidebarChord(
            SIDEBAR_PORTS_TOGGLE_CHORD,
            chordPlatform,
          ),
        }),
        {
          // Source kind comes from the selected workspace (the fork's
          // isFolder/isFolderWorkspace); Drogon has no SSH workspaces, so
          // isSshRepo is reserved for that future and always false.
          isFolder: current?.kind !== "git",
          isFolderWorkspace: current?.kind === "folder",
          isSshRepo: false,
          hasActiveWorktree: selected !== "",
          gitAvailable: gitPanelAvailable,
          mentuAvailable: mentuPanelAvailable,
        },
      ),
    [
      chordPlatform,
      gitPanelAvailable,
      mentuPanelAvailable,
      current?.kind,
      selected,
    ],
  );
  // The session tab has no activity-bar button (the source has no such
  // item) but stays explicitly routable for the session header toggle and
  // the palette; every other stored tab resolves against the visible set.
  const storedRightTab = normalizeRightSidebarTab(rightSidebarTab);
  const rightEffective =
    storedRightTab === "session"
      ? storedRightTab
      : resolveRightSidebarEffectiveTab(
          storedRightTab,
          rightItems.map((item) => item.id),
        );
  const renderedRightWidth = clampRightSidebarPanelWidth(
    rightSidebarWidth,
    typeof window !== "undefined" ? window.innerWidth : null,
  );
  const filesAvailable =
    isFilesAvailable(liveCapabilities) &&
    checkAvailability(
      resolveRoute(filesBaseRegistry, FILES_ROUTE_ID),
      liveCapabilities,
    ) === "available";
  const lastPropsRef = useRef<{
    workspace: Workspace;
    status: Status;
  } | null>(null);
  if (current && status) lastPropsRef.current = { workspace: current, status };
  // Keep-alive: once user-routed while available, the panel survives
  // route switches and transient refresh gaps (status null). Render
  // stops immediately on explicit withhold (present status without
  // files.v1, even while busy) and on settled workspace loss — never on
  // switches, never on transients.
  const filesAliveRef = useRef(false);
  // First mount needs explicit user routing; keep-alive covers later
  // switches and transients. Never auto-mounts unopened panels.
  // Present status without files.v1 is an explicit withhold even mid-busy;
  // status null is the only transient that preserves the mount.
  const explicitWithhold =
    status !== null && !isFilesAvailable(liveCapabilities);
  if (
    rightEffective === "explorer" &&
    filesRoutedRef.current &&
    filesAvailable &&
    current &&
    gatesArmedFor
  )
    filesAliveRef.current = true;
  else if (
    explicitWithhold ||
    (status && !current && !busy && !loadingSessions)
  )
    filesAliveRef.current = false;
  const filesAlive = filesAliveRef.current;
  // Changes keep-alive mirrors files: survives switches and transients,
  // unmounts on explicit git.v1 withhold or settled workspace loss.
  const changesAvailable =
    gitPanelAvailable &&
    checkAvailability(
      resolveRoute(filesBaseRegistry, CHANGES_ROUTE_ID),
      liveCapabilities,
    ) === "available";
  const changesAliveRef = useRef(false);
  const changesExplicitWithhold =
    status !== null && !isChangesAvailable(liveCapabilities);
  if (
    rightEffective === "source-control" &&
    changesRoutedRef.current &&
    changesAvailable &&
    current &&
    gatesArmedFor
  )
    changesAliveRef.current = true;
  else if (
    changesExplicitWithhold ||
    (status && !current && !busy && !loadingSessions)
  )
    changesAliveRef.current = false;
  const changesAlive = changesAliveRef.current;
  // Mentu panel keep-alive mirrors files: survives switches and
  // transients, unmounts on explicit mentu.v1 withhold or settled
  // workspace loss. The wide Mentu tab keeps its own route keep-alive
  // below; this one owns the activity-bar panel mount.
  const mentuPanelAliveRef = useRef(false);
  const mentuPanelExplicitWithhold =
    status !== null && !isMentuAvailable(liveCapabilities);
  if (
    rightEffective === "mentu" &&
    mentuRoutedRef.current &&
    mentuPanelAvailable &&
    current &&
    gatesArmedFor
  )
    mentuPanelAliveRef.current = true;
  else if (
    mentuPanelExplicitWithhold ||
    (status && !current && !busy && !loadingSessions)
  )
    mentuPanelAliveRef.current = false;
  const mentuPanelAlive = mentuPanelAliveRef.current;
  const filesProps =
    current && status ? { workspace: current, status } : lastPropsRef.current;
  const settingsSectionRef = useRef<HTMLElement>(null);
  const filesSectionRef = useRef<HTMLElement>(null);
  const changesSectionRef = useRef<HTMLElement>(null);
  const mentuPanelSectionRef = useRef<HTMLElement>(null);
  const sessionSectionRef = useRef<HTMLElement>(null);
  const portsSectionRef = useRef<HTMLElement>(null);
  const botsSectionRef = useRef<HTMLElement>(null);
  const meetingsSectionRef = useRef<HTMLElement>(null);
  const automationsSectionRef = useRef<HTMLElement>(null);
  const tasksSectionRef = useRef<HTMLElement>(null);
  const prevRouteRef = useRef<string | null>(null);
  useEffect(() => {
    // Real focus, only on explicit user navigation to a panel: background
    // refreshes and re-renders must never steal focus.
    const target =
      route === BOTS_ROUTE_ID
        ? botsSectionRef.current
        : route === AUTOMATIONS_ROUTE_ID
          ? automationsSectionRef.current
          : route === TASKS_ROUTE_ID
            ? tasksSectionRef.current
            : route === MEETINGS_ROUTE_ID
              ? meetingsSectionRef.current
              : null;
    if (route !== null && target && prevRouteRef.current !== route) {
      applyPanelFocus(
        resolveRoute(
          route === BOTS_ROUTE_ID ? panelRegistry : filesBaseRegistry,
          route,
        ),
        target,
      );
      target.focus();
    }
    prevRouteRef.current = route;
  }, [route, panelRegistry, filesBaseRegistry]);
  useEffect(() => {
    // Right sidebar focus follows explicit routing only (activity bar,
    // palette, chord): capability churn that moves the effective tab must
    // never steal focus.
    const requested = rightFocusRequest.current;
    if (requested === null) return;
    rightFocusRequest.current = null;
    const target =
      requested === "explorer"
        ? filesSectionRef.current
        : requested === "source-control"
          ? changesSectionRef.current
          : requested === "mentu"
            ? mentuPanelSectionRef.current
            : requested === "ports"
              ? portsSectionRef.current
              : sessionSectionRef.current;
    target?.focus();
    // rightTick re-runs this for same-tab re-routing (state bail-outs).
  }, [rightEffective, rightSidebarOpen, rightTick]);
  // Bots keep-alive mirrors Tasks (#348): the fork renders its Bots surface
  // regardless of workspaces (AppWorkspaceShell.tsx mounts BotsPage with no
  // workspace condition), so the page stays alive with none selected and
  // unmounts only on explicit capability withhold or settled workspace loss
  // after one was selected — never for having none yet. The panel is
  // read-only (no drafts), so remounts on snapshot refresh are safe;
  // scope mismatch never renders (no stale data).
  const botsExplicitWithhold =
    status !== null && !isBotsAvailable(liveCapabilities);
  const botsAliveRef = useRef(false);
  const botsHadWorkspaceRef = useRef(false);
  if (current) botsHadWorkspaceRef.current = true;
  if (route === BOTS_ROUTE_ID && botsAvailable)
    botsAliveRef.current = true;
  else if (
    botsExplicitWithhold ||
    (status &&
      !current &&
      !busy &&
      !loadingSessions &&
      botsHadWorkspaceRef.current)
  )
    botsAliveRef.current = false;
  const botsAlive = botsAliveRef.current;
  // Meetings keep-alive mirrors Bots (#348): the notes live outside any
  // workspace, so the page mounts with none selected and unmounts only on an
  // explicit capability withhold — never for having no workspace, and never
  // because a session transiently vanished.
  const meetingsAvailable = isMeetingsAvailable(liveCapabilities);
  const meetingsExplicitWithhold =
    status !== null && !isMeetingsAvailable(liveCapabilities);
  const meetingsAliveRef = useRef(false);
  if (route === MEETINGS_ROUTE_ID && meetingsAvailable)
    meetingsAliveRef.current = true;
  else if (meetingsExplicitWithhold) meetingsAliveRef.current = false;
  const meetingsAlive = meetingsAliveRef.current;
  // Browser tab strip mirror: workspace-scoped pages from the host. The
  // strip selection below (not the host verdict) decides what the tab area
  // shows; the pane reports bounds for the selected page, which activates
  // it on the host.
  useEffect(() => {
    if (!selected) {
      setBrowserTabs([]);
      return;
    }
    return browserStaticBridge.onState((event) => {
      const scoped = event.tabs.filter(
        (tab) => tab.workspaceId === selectedRef.current,
      );
      setBrowserTabs(scoped);
    });
  }, [browserStaticBridge, selected]);
  useEffect(() => {
    // Workspace switches drop the strip selection (pages are
    // workspace-scoped); the subscription above repopulates the list.
    setActiveBrowserTabId(null);
    // The Mentu tab is workspace-scoped too: membership comes from the
    // incoming workspace's envelope, so the previous workspace's selection
    // must not leak.
    setActiveMentuTab(false);
    knownBrowserIds.current = new Set();
    // Editor tabs (R16-A) are NOT cleared here: they are scope-stamped
    // (EditorTabState.workspaceId) and filtered to the current workspace at
    // every use site below, exactly like FilesOpenEntry's scopeKey pattern.
    // An imperative reset here would race an open-and-switch-workspace
    // request landing in this same tick (e.g. a terminal file link from a
    // background workspace) — the effect runs after the render that also
    // opens the new tab, and would wipe it out.
  }, [selected]);
  useEffect(() => {
    const ids = new Set(browserTabs.map((tab) => tab.tabId));
    const fresh = browserTabs.filter(
      (tab) => !knownBrowserIds.current.has(tab.tabId),
    );
    knownBrowserIds.current = ids;
    if (
      fresh.length > 0 &&
      (activeBrowserTabId !== null || expectBrowserTab.current)
    ) {
      setActiveBrowserTabId(fresh[fresh.length - 1].tabId);
      // Consumed only on use: a transient empty echo between the "+" menu
      // creation and the host's list must not disarm the pending select
      // (failures clear the flag at the call site instead).
      expectBrowserTab.current = false;
    } else if (
      activeBrowserTabId !== null &&
      browserTabs.length > 0 &&
      !ids.has(activeBrowserTabId)
    ) {
      // A confirmed list that dropped the selection falls back; an empty
      // list is a transient echo, never proof the page closed.
      setActiveBrowserTabId(browserTabs[browserTabs.length - 1]?.tabId ?? null);
    }
  }, [browserTabs, activeBrowserTabId]);
  // Browser keep-alive mirrors files minus the capability withhold (local
  // feature, always available): mounts once a page exists or is selected,
  // survives switches and transients, unmounts on settled workspace loss.
  // The page itself lives in main, so a remount only rebuilds chrome and
  // re-reports bounds.
  const browserAliveRef = useRef(false);
  if (current && (activeBrowserTabId !== null || browserTabs.length > 0))
    browserAliveRef.current = true;
  else if (status && !current && !busy && !loadingSessions)
    browserAliveRef.current = false;
  const browserAlive = browserAliveRef.current;
  const activeBrowserTab =
    activeBrowserTabId !== null
      ? (browserTabs.find((tab) => tab.tabId === activeBrowserTabId) ?? null)
      : null;
  // Editor tabs are scope-stamped and never actively cleared on a
  // workspace switch (see the reset effect above); every render-time use
  // filters to the CURRENT workspace so a foreign-workspace tab is simply
  // never visible or active — one render after a switch, with no reset
  // effect that could race an open landing in the same tick.
  const visibleEditorTabs = editorTabs.filter(
    (tab) => tab.workspaceId === selected,
  );
  const activeEditorTab =
    activeEditorTabId !== null
      ? (visibleEditorTabs.find((tab) => tab.tabId === activeEditorTabId) ??
        null)
      : null;
  // Editor host keep-alive mirrors the browser pane: mounts once a file is
  // open or selected IN THIS WORKSPACE, survives tab-strip switches (the
  // host itself keeps every previously-opened file's retained draft,
  // matching EditorPane's own per-file reducer state), unmounts on settled
  // workspace loss.
  const editorHostAliveRef = useRef(false);
  if (current && (activeEditorTab !== null || visibleEditorTabs.length > 0))
    editorHostAliveRef.current = true;
  else if (status && !current && !busy && !loadingSessions)
    editorHostAliveRef.current = false;
  const editorHostAlive = editorHostAliveRef.current;
  // Automations keep-alive mirrors files: survives switches and
  // transients, unmounts on explicit withhold or settled workspace loss.
  const automationsAvailable = isAutomationsAvailable(liveCapabilities);
  const automationsExplicitWithhold =
    status !== null && !isAutomationsAvailable(liveCapabilities);
  const automationsAliveRef = useRef(false);
  if (route === AUTOMATIONS_ROUTE_ID && automationsAvailable && current)
    automationsAliveRef.current = true;
  else if (
    automationsExplicitWithhold ||
    (status && !current && !busy && !loadingSessions)
  )
    automationsAliveRef.current = false;
  const automationsAlive = automationsAliveRef.current;
  // Mentu keep-alive mirrors the browser/editor panes: the tab-area surface
  // mounts once the workspace's Mentu tab is open (or selected), survives
  // strip switches and transients, and unmounts on explicit capability
  // withhold or settled workspace loss — never on a mere route change.
  const mentuAvailable = isMentuAvailable(liveCapabilities);
  const mentuExplicitWithhold =
    status !== null && !isMentuAvailable(liveCapabilities);
  const mentuAliveRef = useRef(false);
  if (current && mentuAvailable && (activeMentuTab || mentuTabOpen))
    mentuAliveRef.current = true;
  else if (
    mentuExplicitWithhold ||
    (status && !current && !busy && !loadingSessions)
  )
    mentuAliveRef.current = false;
  const mentuAlive = mentuAliveRef.current;
  // The Mentu surface owns the tab area only while its tab is the selected
  // strip tab AND the tab is still a member of the strip.
  const mentuTabActive = activeMentuTab && mentuTabOpen && mentuAlive;
  // Tasks keep-alive: unlike the session-bound panels, Tasks is
  // project-scoped and mounts with no workspace selected, so the first
  // task can create the first worktree. It unmounts only on settled
  // workspace loss after one was selected — never for having none yet.
  const tasksAliveRef = useRef(false);
  const hadWorkspaceRef = useRef(false);
  if (current) hadWorkspaceRef.current = true;
  if (route === TASKS_ROUTE_ID) tasksAliveRef.current = true;
  else if (
    status &&
    !current &&
    !busy &&
    !loadingSessions &&
    hadWorkspaceRef.current
  )
    tasksAliveRef.current = false;
  const tasksAlive = tasksAliveRef.current;
  // #237: the descriptor resolves as soon as the page is alive with a
  // scope — over the placeholder while the snapshot is in flight — so the
  // section never falls back to the bare "Loading bots…" stub. Stale-scope
  // safety lives in the registry build above (placeholder, not old rows).
  // #348: no filesProps requirement — with zero workspaces the descriptor
  // resolves over the app-global scope and mounts without host props.
  const botsDescriptor: PanelDescriptor | null =
    botsAlive && botsAvailable && botsScope
      ? resolveRoute(panelRegistry, BOTS_ROUTE_ID)
      : null;
  // Full pages replace the session view, like the fork's ActivePage: no
  // session header above them, no terminal column or right sidebar beside
  // them — only the page's own chrome. The conditions mirror the mounts
  // below, so a routed-but-unavailable page falls back to the session
  // view instead of rendering an empty page. Back/Close return through
  // the view history, which restores the previous session entry.
  const botsPageActive = route === BOTS_ROUTE_ID;
  const automationsPageActive =
    route === AUTOMATIONS_ROUTE_ID && automationsAlive && filesProps !== null;
  const tasksPageActive = route === TASKS_ROUTE_ID && tasksAlive;
  const meetingsPageActive = route === MEETINGS_ROUTE_ID && meetingsAlive;
  const fullPageActive =
    isFullPageRoute(route) &&
    (botsPageActive || automationsPageActive || tasksPageActive || meetingsPageActive);
  const noWorkspaceCopy = noWorkspacePageCopy(route);
  const checked = <T,>(value: Result<T>): T => {
    if (!value.ok) throw new Error(value.error.message);
    return value.result;
  };
  const action = useCallback(async (run: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The operation could not be confirmed.",
      );
    } finally {
      setBusy(false);
    }
  }, []);
  // Tasks mount block (journey J6): the registry entry, the terminal
  // opener the page calls after `tasks.start`, and the sidebar badge
  // refresh. The page surfaces every honest state itself (withheld
  // capability, folder project, missing gh), so — like Browser — mounting
  // needs only a settled workspace, never a capability withhold check.
  // Bumped after a task start creates a worktree, so the effect below
  // re-reads the project view and the new worktree card (with its issue
  // badge) appears without a manual refresh.
  const [projectReloadTick, setProjectReloadTick] = useState(0);
  const openTaskTerminal = useCallback(
    (workspaceId: string) =>
      action(async () => {
        const result = checked(await window.drogon.start(workspaceId));
        setSelected(workspaceId);
        setActive(result.id);
        setSessions([result]);
        setProjectReloadTick((tick) => tick + 1);
      }),
    [action],
  );
  const tasksRegistry = useMemo(
    () =>
      registerTasksRoute(filesBaseRegistry, tasksGatedBridge, {
        loadGroups: loadTaskGroups,
        onOpenTerminal: (workspaceId: string) => {
          void openTaskTerminal(workspaceId);
        },
        // #270: the descriptor mount previously rendered with onClose
        // undefined, so the header Close button and Escape were no-ops
        // whenever a workspace was selected (the no-workspace mount below
        // passed goBackViewHistory directly and worked).
        onClose: () => tasksCloseRef.current(),
      }),
    [filesBaseRegistry, tasksGatedBridge, loadTaskGroups, openTaskTerminal],
  );
  useEffect(() => {
    // Keeps the sidebar issue badges current: every git project re-reads
    // its links whenever the projects or the live capabilities change.
    // Failures stay on the Tasks page; the sidebar keeps prior badges.
    if (!isTasksAvailable(liveCapabilities)) return;
    const gitIds = projectGroups
      .filter((group) => group.project.kind === "git")
      .map((group) => group.project.id);
    if (gitIds.length === 0) return;
    void refreshWorktreeIssueLinks(tasksGatedBridge, gitIds);
  }, [status, projectGroups, tasksGatedBridge]);
  const refresh = useCallback(
    () =>
      action(async () => {
        setStatus(null);
        const connected = checked(await window.drogon.status());
        const result = checked(await window.drogon.workspaces());
        setWorkspaces(result.workspaces);
        setStatus(connected);
        setSelected((value) =>
          result.workspaces.some((item) => item.id === value)
            ? value
            : resolveRestoredSelection(result.workspaces, loadSavedSelection()),
        );
        setRevision((value) => value + 1);
        const supportsHarnesses = supportsHarnessLaunch(connected.capabilities);
        setHarnessCapability(supportsHarnesses);
        if (!supportsHarnesses) {
          setHarnesses([]);
          return;
        }
        // Non-fatal: an older or momentarily flaky harness listing must not
        // take down workspace/session loading, which already succeeded.
        try {
          const listed = await window.drogon.harnesses();
          setHarnesses(listed.ok ? listed.result.harnesses : []);
        } catch {
          setHarnesses([]);
        }
      }),
    [action],
  );
  // R16-AL2 (issue #228): per-tab "Retry connection". `refresh` re-attaches
  // anything the service can still serve (a healed connection keeps its
  // handles; those panes resume on their own). A session the fresh list
  // still reports `unverifiable` now shows its own recovery overlay (the
  // pane gates on its verdict and connection), so the click is a plain
  // re-list rather than bookkeeping for a later overlay.
  // R16-AJ2 follow-up (issue #221): Retry must relaunch a failed harness
  // launch with the SAME inputs (provider/model/prompt). The session
  // record carries only harnessId, so every launch App makes remembers
  // its exact input under the resulting session id; retry and the pane's
  // Restart overlay replay it through startHarnessTracked/restart below.
  useEffect(() => {
    if (status?.serviceInstanceId) void agentSettingsState.load();
  }, [status?.serviceInstanceId]);
  const harnessLaunchMemoryRef = useRef<HarnessLaunchMemory>(new Map());
  const startHarnessTracked = async (input: HarnessLaunchInput) => {
    // User-feature-closure item 7 (coordinator review): a mixed-version old
    // daemon missing agent.settings.v1 made every launch here fail opaque
    // ("settings_unavailable") forever -- see
    // shouldGateLaunchOnAgentSettingsReadiness's own doc for why.
    if (
      shouldGateLaunchOnAgentSettingsReadiness(status !== null, liveCapabilities) &&
      !(await agentSettingsState.ensureReady())
    ) {
      return {
        ok: false,
        error: { code: "settings_unavailable", message: agentSettingsState.getSnapshot().error ?? "Could not load agent settings. Retry the connection.", retryable: true },
      } as const;
    }
    const result = await window.drogon.startHarness(input);
    if (result.ok)
      rememberHarnessLaunch(harnessLaunchMemoryRef.current, result.result, input);
    return result;
  };
  const retryConnection = useCallback(() => {
    void agentSettingsState.load();
    void refresh();
  }, [refresh]);
  // Per-tab retry (the strip hands over the clicked session): a harness
  // session with remembered inputs relaunches them — a refresh cannot
  // revive a launch that failed — by reusing the restart path, which owns
  // the stub cleanup, split repair and activation. Plain shells and
  // sessions App never launched keep the refresh/reconnect affordance.
  const retrySession = useCallback(
    (item: Session) => {
      if (harnessLaunchForRetry(harnessLaunchMemoryRef.current, item)) {
        window.dispatchEvent(
          new CustomEvent<TerminalRestartDetail>(TERMINAL_RESTART_EVENT, {
            detail: { sessionId: item.id, workspaceId: item.workspaceId },
          }),
        );
        return;
      }
      retryConnection();
    },
    [retryConnection],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    // R16-AL2 (issue #228): Settings → Terminal kills/closes sessions
    // directly through the daemon (its Kill buttons act on stubs too, via
    // `session.close`, which forgets the record). App owns no part of that
    // flow, so the pane re-lists on this signal: forgotten rows simply
    // never come back, and their tabs disappear. Registered once:
    // setRevision is a stable state setter.
    const onInvalidate = () => setRevision((value) => value + 1);
    window.addEventListener(SESSIONS_INVALIDATE_EVENT, onInvalidate);
    return () =>
      window.removeEventListener(SESSIONS_INVALIDATE_EVENT, onInvalidate);
  }, []);
  // R16-AJ (fixes #218): background workspaces reload for out-of-band
  // registry moves (digest below) and daemon reconnects (R16-M path).
  // Silent by design: a transient failure keeps the prior list (the
  // sidebar digest still applied), and selection/sessions are untouched —
  // same-id workspaces re-render in place, so terminal scrollback
  // survives. Exactly one `workspaces()` call per invocation.
  const reloadWorkspaces = useCallback(async () => {
    const next = await reloadWorkspacesSnapshot(() =>
      window.drogon.workspaces(),
    );
    // Null keeps the prior list; the next digest or reconnect retries.
    if (next) setWorkspaces(next);
  }, []);
  // Issue #146: re-read the project view when another process moves the
  // registry. Issue #218: the same digest re-runs the `workspaces()` load
  // that feeds the session area — the digest used to refresh only the
  // sidebar groups, so selecting a CLI-created worktree showed the
  // no-workspace fallback until restart. Stable handler: the subscription
  // below is created once, so each revision bumps + reloads exactly once.
  const handleRegistryRevision = useCallback(
    () => void reloadWorkspaces(),
    [reloadWorkspaces],
  );
  useProjectRegistryRefresh(setProjectReloadTick, handleRegistryRevision);
  // Issue #185: reload whenever the daemon connection becomes ready. The
  // watcher lives at root (not in the banner) because the banner unmounts
  // exactly when the workspace list is empty — the state that needs the
  // retry. A boot pass with no confirmed status means the mount refresh
  // failed transiently, so reload everything; otherwise re-attach via the
  // R16-M status-only path that preserves terminal pane scrollback.
  useConnectionReadyReload((previous) => {
    const reload = resolveConnectionReadyReload(status !== null, previous);
    if (reload === "skip") return;
    if (reload === "full") {
      void refresh();
      return;
    }
    // Re-attaches without remounting panes: a fresh status identity
    // retriggers the sessions effect while the unchanged revision keeps
    // every same-identity pane — and its scrollback — mounted. A full
    // refresh() here would remount all panes and clear their buffers just
    // as the service returns. Errors set during the outage belonged to
    // it, so a success clears them. R16-AJ (fixes #218): a silent
    // workspaces reload rides along, so worktrees created elsewhere while
    // disconnected (e.g. `drogon-cli worktree create`) open in the session
    // area without a restart.
    void window.drogon
      .status()
      .then((response) => {
        if (!response.ok) return;
        setError("");
        setStatus(response.result);
        void reloadWorkspaces();
      })
      .catch(() => {});
  });
  useEffect(() => {
    // Reloads the project view whenever the workspace list or the live
    // capabilities change; the adapter degrades to the workspace
    // projection while project.v1/worktree.v1 are withheld or failing.
    let cancelled = false;
    // The interim tasks project bridge fills the two methods the raw
    // `window.drogon` never advertised; every other method still comes
    // from the window bridge, and a withheld capability falls back to the
    // workspace projection exactly as before.
    void loadProjectView(
      windowProjectBridge(window.drogon),
      status?.capabilities ?? [],
      workspaces,
    ).then((view) => {
      if (!cancelled) setProjectGroups(view.groups);
    });
    return () => {
      cancelled = true;
    };
  }, [status, workspaces, tasksProjectBridge, projectReloadTick]);
  useEffect(() => {
    // Persists every confirmed selection once it settles against a known
    // workspace, so the next reload's restore has an up-to-date target.
    const workspace = workspaces.find((item) => item.id === selected);
    if (workspace)
      saveSavedSelection({
        workspaceId: workspace.id,
        hostId: workspace.hostId,
      });
  }, [selected, workspaces]);
  useEffect(() => {
    if (!selected || !status) {
      setLoadingSessions(false);
      setSessions([]);
      setActive("");
      return;
    }
    let cancelled = false;
    setLoadingSessions(true);
    void window.drogon
      .sessions(selected)
      .then((response) => {
        if (cancelled) return;
        if (!response.ok) {
          setError(response.error.message);
          return;
        }
        const dismissed = loadDismissedSessions();
        // Each session's own recorded host is what a dismissal is checked
        // against — not this connection's current `status.hostId` — and
        // `isSessionDismissed` itself refuses to hide anything but a
        // positively `exited` session, so tampered storage can never mask
        // a `live`/`unverifiable` one.
        const visible = response.result.sessions.filter(
          (item) => !isSessionDismissed(dismissed, item.hostId, item),
        );
        setSessions(visible);
        setActive((value) =>
          visible.some((item) => item.id === value)
            ? value
            : (visible.at(-1)?.id ?? ""),
        );
      })
      .catch(() => {
        if (!cancelled)
          setError("Could not load sessions. Retry the connection.");
      })
      .finally(() => {
        if (!cancelled) setLoadingSessions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, status, revision]);
  // Bot-session persistence (task_926fddc5e769 follow-up): the host-wide
  // counterpart to the `selected`-scoped fetch above. Deliberately its OWN
  // effect (not folded into the one above) so a workspace switch never
  // resets or gates it — a Bot session must stay known and reachable for
  // as long as it is alive, never only while its own workspace happens to
  // be selected. Gated on the daemon being connected only (it used to be
  // gated on `botsAvailable`): the SAME list is the sidebar's session view,
  // which must be host-wide whether or not Bots is advertised — see
  // `sidebarSessions` below. A transient failure keeps the prior list rather
  // than flashing every session away.
  useEffect(() => {
    if (!status) {
      setAllBotSessions([]);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const result = await window.drogon.sessions();
      if (cancelled || !result.ok) return;
      setAllBotSessions(result.result.sessions);
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [status]);
  useEffect(() => {
    // J1 needs_input: main polls session.list for transitions (this repo
    // has no daemon push channel) and forwards them here. Clicking the
    // native notification selects that workspace and session; every
    // transition also merges into the visible rows so the tab and card
    // badges track the state live without a manual refresh.
    const bridge = window.drogon.notifications;
    if (!bridge) return;
    const known: AgentState[] = [
      "working",
      "idle",
      "needs_input",
      "exited",
      "unknown",
    ];
    const offFocus = bridge.onFocusSession((event) => {
      setRoute(null);
      setSelected(event.workspaceId);
      selectSessionTab(event.sessionId);
      setRevision((value) => value + 1);
    });
    const offState = bridge.onStateChanged((event) => {
      if (!known.includes(event.agentState as AgentState)) return;
      if (event.workspaceId !== contextRef.current.workspaceId) return;
      // R16-BF2 push: one merge for the push stream and the 2 s poll alike,
      // with duplicate/stale protection (`agentStateAt` compare) so the two
      // sources can never regress each other. Previewed against the ref so
      // unknown/duplicate events skip the update; applied through the
      // updater form so back-to-back pushes cannot clobber each other.
      const pushed = {
        sessionId: event.sessionId,
        workspaceId: event.workspaceId,
        agentState: event.agentState as AgentState,
        agentStateAt: event.agentStateAt ?? null,
        agentPromptPreview: event.agentPromptPreview,
        cacheIdleAt: event.cacheIdleAt,
      };
      const preview = applySessionStatePush(sessionsRef.current, pushed);
      if (preview.unknown) {
        // A session this window never listed (started elsewhere): reload
        // once so it appears with its live state.
        setRevision((value) => value + 1);
        return;
      }
      if (!preview.applied) return;
      setSessions((items) => applySessionStatePush(items, pushed).sessions);
    });
    return () => {
      offFocus();
      offState();
    };
  }, []);
  // Shared by sidebar worktree cards: re-clicking the already-active
  // workspace must not clear its visible live-session projection.
  const selectWorkspaceId = (id: string) => {
    // The source activates the session surface even for the current workspace.
    setRoute(null);
    const resolution = resolveWorkspaceSelection(selected, id);
    if (!resolution.changed) return;
    setSelected(resolution.selected);
    setActive("");
    setSessions([]);
  };
  const toggleSidebar = () => {
    setSidebarOpen((open) => {
      saveSidebarOpen(window.localStorage, !open);
      return !open;
    });
  };
  const changeSidebarWidth = (width: number) => {
    setSidebarWidth(width);
    saveSidebarWidth(window.localStorage, width);
  };
  // Right sidebar routing (source: showRightSidebarFiles /
  // revealRightSidebarTab + selectActivityTab): explicit routing opens the
  // sidebar on the tab, stamps the per-panel first-mount flag and requests
  // focus; the collapsed/tab choices persist like the source store.
  const openRightSidebarOn = (tab: RightSidebarTab) => {
    if (tab === "explorer") filesRoutedRef.current = true;
    if (tab === "source-control") changesRoutedRef.current = true;
    if (tab === "mentu") mentuRoutedRef.current = true;
    rightFocusRequest.current = tab;
    setRightSidebarTab(tab);
    saveRightSidebarTab(window.localStorage, tab);
    setRightSidebarOpen((open) => {
      if (!open) saveRightSidebarOpen(window.localStorage, true);
      return true;
    });
    // Always re-render: the keep-alive flags below are render-computed.
    setRightTick((tick) => tick + 1);
  };
  // Activity-bar tabs route directly; the session tab (no activity
  // button since the source has none) routes through the session header
  // toggle and the palette instead, both of which call openRightSidebarOn.
  const selectRightTab = (tab: RightSidebarTab) => openRightSidebarOn(tab);
  const showRightExplorer = () => openRightSidebarOn("explorer");
  const showRightSourceControl = () => openRightSidebarOn("source-control");
  const toggleRightSidebar = () => {
    setRightSidebarOpen((open) => {
      saveRightSidebarOpen(window.localStorage, !open);
      return !open;
    });
  };
  const changeRightSidebarWidth = (width: number) => {
    const clamped = clampRightSidebarPanelWidth(
      width,
      typeof window !== "undefined" ? window.innerWidth : null,
    );
    setRightSidebarWidth(clamped);
    saveRightSidebarWidth(window.localStorage, clamped);
  };
  // Titlebar history: every user navigation pushes {route, workspace}; the
  // back/forward pair applies entries without pushing (applyingHistory).
  useEffect(() => {
    if (applyingHistory.current) {
      applyingHistory.current = false;
      return;
    }
    if (!historySeeded.current) {
      historySeeded.current = true;
      setViewHistory(initialViewHistory({ route, workspaceId: selected }));
      return;
    }
    setViewHistory((history) => pushView(history, { route, workspaceId: selected }));
  }, [route, selected]);
  // #270: record the view a full page was opened FROM (fork
  // previousViewBefore<Page> semantics: sticky while the page stays open,
  // refreshed when the page is re-entered from another view).
  useEffect(() => {
    const previous = lastViewRef.current;
    const current: ViewEntry = { route, workspaceId: selected };
    lastViewRef.current = current;
    if (
      route !== null &&
      isFullPageRoute(route) &&
      (previous === null || previous.route !== route)
    ) {
      pageReturnViewRef.current.set(
        route,
        previous ?? { route: null, workspaceId: selected },
      );
    }
  }, [route, selected]);
  const applyViewEntry = (entry: { route: string | null; workspaceId: string }) => {
    applyingHistory.current = true;
    if (entry.workspaceId !== selectedRef.current) {
      const resolution = resolveWorkspaceSelection(
        selectedRef.current,
        entry.workspaceId,
      );
      if (resolution.changed) {
        setSelected(resolution.selected);
        setActive("");
        setSessions([]);
      }
    }
    if (entry.route !== routeRef.current) setRoute(entry.route);
    else applyingHistory.current = false;
  };
  const liveWorkspaceIds = useMemo(
    () => new Set(workspaces.map((workspace) => workspace.id)),
    [workspaces],
  );
  // Titlebar placement follows the source AppChromeLayout rules: the left
  // controls live in the sidebar-column header (floating when collapsed),
  // and the settings full page mounts no sidebar and no titlebar controls.
  const chrome = resolveAppChromeLayout({
    route,
    settingsRouteId: SETTINGS_ROUTE_ID,
    sidebarOpen,
    sidebarWidth,
  });
  const goBackViewHistory = () => {
    const next = goBackView(viewHistory, liveWorkspaceIds);
    if (next === viewHistory) return;
    setViewHistory(next);
    applyViewEntry(currentView(next));
  };
  // #270: fork close<Page>Page — return to the view the page was opened
  // from (recorded above) and park the history index before the page
  // entry (fork rewindHistoryIndexPastView) so Back/Forward stay live.
  const closePageRoute = (pageRoute: string) => {
    const target = pageReturnViewRef.current.get(pageRoute) ?? null;
    pageReturnViewRef.current.delete(pageRoute);
    if (target !== null && target.route !== pageRoute) {
      setViewHistory((history) =>
        rewindViewHistoryPastRoute(history, pageRoute, liveWorkspaceIds),
      );
      applyViewEntry(target);
      return;
    }
    goBackViewHistory();
  };
  botsCloseRef.current = () => closePageRoute(BOTS_ROUTE_ID);
  // One focus path for every way a Bot session can be opened (the Bots
  // page's Open/New session and the sidebar row): record the REAL session
  // native returned, select its workspace, leave the page and set the
  // pending id the list-delivery effect below activates.
  const recordBotSession = (
    input: Parameters<NonNullable<BotsPanelProps["onOpenSession"]>>[0],
  ) => {
    pendingBotSessionRef.current = {
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      meta: {
        botId: input.botId,
        incarnation: input.incarnation,
        displayName: input.displayName,
        handle: input.handle,
        title: input.title,
        harnessId: input.harness.harnessId as HarnessId,
        model: input.harness.explicitModel,
        workspaceId: input.workspaceId,
        hostId: input.hostId,
      },
    };
    setSelected(input.workspaceId);
    // The Bot's own home workspace was just registered natively (or
    // already existed): `workspaces` will not know about it yet, and the
    // header/inspector's workspace-path chip needs the real path, not a
    // guess — same primitive the app already uses for out-of-band registry
    // moves.
    void reloadWorkspaces();
    // The app-level Bots snapshot (sidebar Chats section) otherwise only
    // refreshes on a timer or on re-entering the Bots page: bump it now so
    // this Bot's row/state appear immediately, not up to several seconds
    // later.
    setBotsReload((value) => value + 1);
    if (route === BOTS_ROUTE_ID) closePageRoute(BOTS_ROUTE_ID);
  };
  openBotSessionRef.current = recordBotSession;
  // Activates a Bot-opened session the moment the polled list delivers
  // it (the open call returns before the tab exists). Runs after the
  // refresh's own active-fallback in the same commit cycle, so the pending
  // id wins. selectSessionTab parity, inline: route reset, tab activate,
  // other panes cleared — in-app state only.
  useEffect(() => {
    const pending = pendingBotSessionRef.current;
    if (!pending) return;
    if (sessions.some((item) => item.id === pending.sessionId)) {
      pendingBotSessionRef.current = null;
      setSelected(pending.workspaceId);
      setRoute(null);
      setActive(pending.sessionId);
      setActiveBrowserTabId(null);
      setActiveEditorTabId(null);
      setBotSessions((current) => {
        const next = new Map(current);
        next.set(pending.sessionId, pending.meta);
        return next;
      });
      // Bot-scoped tab title ("<Bot name> · <Harness>"), through the SAME
      // custom-title store a manual rename uses — a later manual rename
      // still wins (commitTabTitle overwrites in place), same as any other
      // tab.
      commitTabTitle(
        pending.sessionId,
        botSessionTitle(pending.meta.displayName, pending.meta.harnessId),
      );
    }
  }, [sessions]);
  // The freshest copy wins per session id: `sessions` (the CURRENTLY
  // selected workspace's own push-updated list) overrides the host-wide
  // poll for any id both contain, so the workspace you are actually
  // looking at never lags behind its own live updates.
  const sessionsForBots = useMemo(
    () => mergeSessionsForBots(allBotSessions, sessions),
    [allBotSessions, sessions],
  );
  // The sidebar's session view is the host-wide union above, NOT the
  // `selected`-scoped `sessions`: every worktree card must list its own
  // workspace's sessions (the reference's cards always list their agents) and
  // the card order must not move when the selection does. With the scoped
  // list, a card for any other worktree saw zero sessions — its rows were not
  // rendered and "Sort by: Recent" fell back to `createdAt` for it — so
  // clicking a card reordered the list and emptied the sibling below it.
  // Split second panes are excluded exactly like `stripSessions` (R16-N).
  const sidebarSessions = sidebarSessionView(
    allBotSessions,
    sessions,
    splitSecondaryIds,
  );
  // Defect 1: the host owns liveness, and the decision must be
  // workspace-independent. The daemon projects the recorded link's own
  // workspaceId/incarnation/verdict onto `bot.snapshot`, so the click no
  // longer depends on the SELECTED workspace's session list (the old lookup
  // missed on the first click from anywhere else and silently opened a
  // second session). The host-wide `sessionsForBots` view (PR #431) supplies
  // the freshest observed copy when this host still lists the session; the
  // snapshot projection is the fallback, and an unestablished liveness is
  // `unknown` -- never a fresh dispatch.
  resolveBotSessionRef.current = ({ bot }) =>
    resolveBotSession({
      bot,
      observed:
        sessionsForBots.find(
          (item) => item.id === bot.currentSession?.sessionId,
        ) ?? null,
      hostId: status?.hostId ?? "",
    });
  // Gap 3: the sidebar's Chats section lists Bots with a session. Built from
  // the same daemon facts every other surface uses (the Bot snapshot's
  // currentSession link + the live session list), and the click handler
  // resumes the live session or opens a fresh one through the exact same
  // dispatch the Bots page uses. Uses `sessionsForBots` (host-wide) so the
  // row stays present and truthful while the session lives, regardless of
  // which workspace is currently selected — a Bot session disappears here
  // only when it is actually closed/stopped, never merely navigated away
  // from.
  const loadedBots =
    botsLoad?.status === "loaded" && botsScopeEquals(botsLoad.scope)
      ? botsLoad.snapshot.bots
      : [];
  const sidebarBotSessions: SidebarBotSession[] = buildSidebarBotSessions(
    loadedBots,
    sessionsForBots,
  );
  const openSidebarBotSession = (botId: string) => {
    const bot = loadedBots.find((candidate) => candidate.id === botId);
    if (!bot) return;
    // Defect 1: the same host resolution the Bots page uses. Focus a live
    // session, reopen a known-exited one with a resume, open fresh only when
    // there is no record, and do NOTHING (never a duplicate) when liveness
    // is not established.
    const resolution = resolveBotSessionRef.current({ bot });
    if (resolution.kind === "focus") {
      recordBotSession({
        botId: bot.id,
        sessionId: resolution.session.sessionId,
        incarnation: resolution.session.incarnation,
        harness: {
          harnessId:
            resolution.session.harnessId ?? bot.harnessPolicy.defaultHarness,
          explicitModel: bot.harnessPolicy.explicitModel,
        },
        workspaceId: resolution.session.workspaceId,
        hostId: resolution.session.hostId,
        displayName: bot.displayIdentity.displayName,
        handle: bot.displayIdentity.handle,
        title: bot.displayIdentity.title,
      });
      return;
    }
    if (resolution.kind === "unknown") return;
    if (!botsScope) return;
    // The recorded session is gone or exited (or there never was one):
    // dispatch a fresh open-session turn (no model turn) and focus it when
    // it lands. `resume` continues the harness's own prior conversation for
    // a known-exited session; a harness that cannot resume is not pretended
    // into a continuation.
    const resume =
      resolution.kind === "reopen" &&
      harnessSupportsConversationResume(
        resolution.harnessId ?? bot.harnessPolicy.defaultHarness,
      );
    void (async () => {
      const response = await dispatchOpenBotSession({
        bridge: botsGatedBridge,
        scope: botsScope,
        bot,
        requestId:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `bot-open-session-${Date.now()}`,
        resume,
      });
      if (!response || !response.ok) return;
      if (response.result.outcome !== "dispatched") return;
      const opened = response.result.session;
      if (!opened) return;
      recordBotSession({
        botId: bot.id,
        sessionId: opened.sessionId,
        incarnation: opened.incarnation,
        harness: {
          harnessId: bot.harnessPolicy.defaultHarness,
          explicitModel: bot.harnessPolicy.explicitModel,
        },
        workspaceId: response.result.workspaceId,
        hostId: response.result.hostId,
        displayName: bot.displayIdentity.displayName,
        handle: bot.displayIdentity.handle,
        title: bot.displayIdentity.title,
      });
    })();
  };
  // Bot session inspector (bug-bot-a836b4ebf8be65505): identity is known
  // synchronously from `botSessions` (recorded above), but the pid is a
  // live daemon-side fact that has to be fetched — `bot.snapshot`'s own
  // projection, polled only while a Bot session tab is actually focused.
  // The `sessionId` guard on the state write means a stale in-flight read
  // for a since-switched-away session can never paint over the currently
  // focused one's pid.
  const activeBotMeta = terminal ? (botSessions.get(terminal.id) ?? null) : null;
  useEffect(() => {
    if (!activeBotMeta || !status?.hostId || !terminal) {
      setBotSessionPid(null);
      return;
    }
    const sessionId = terminal.id;
    const hostId = status.hostId;
    let cancelled = false;
    const poll = async () => {
      const result = await window.drogon.botSnapshot({
        hostId,
        workspaceId: "",
        locale: settings.get("locale"),
      });
      if (cancelled || !result.ok) return;
      const bot = result.result.bots.find(
        (candidate) => candidate.id === activeBotMeta.botId,
      );
      const pid =
        bot?.currentSession?.sessionId === sessionId
          ? (bot.currentSession.processId ?? null)
          : null;
      setBotSessionPid({ sessionId, processId: pid });
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeBotMeta, status?.hostId, terminal?.id]);
  // Live-ticking clock for the inspector's Started row — only while a Bot
  // session is actually focused, never a background timer.
  useEffect(() => {
    if (!activeBotMeta) return;
    const timer = window.setInterval(() => setBotSessionClockMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeBotMeta]);
  const [stoppingBotSession, setStoppingBotSession] = useState(false);
  // Bot session Stop (bug-bot-a836b4ebf8be65505's working red Stop
  // button): the SAME generic `session.stop` every other session uses —
  // real termination, not a UI-only dismissal. `updateSessionProjection`
  // folds the returned verdict into `sessions` the same way the terminal
  // split host's own `onSession` callback already does.
  const stopActiveBotSession = async () => {
    if (!terminal) return;
    setStoppingBotSession(true);
    try {
      const result = await window.drogon.stop({
        sessionId: terminal.id,
        incarnation: terminal.incarnation,
      });
      if (result.ok) {
        setSessions((items) => updateSessionProjection(items, result.result));
        // Refresh the Bot snapshot so its projected `currentSession.verdict`
        // reflects the stop immediately (Defect 1/2: the next open must read
        // "exited" and reopen with a resume, not focus the closed tab).
        setBotsReload((value) => value + 1);
      }
    } finally {
      setStoppingBotSession(false);
    }
  };
  tasksCloseRef.current = () => closePageRoute(TASKS_ROUTE_ID);
  automationsCloseRef.current = () => closePageRoute(AUTOMATIONS_ROUTE_ID);
  const goForwardViewHistory = () => {
    const next = goForwardView(viewHistory, liveWorkspaceIds);
    if (next === viewHistory) return;
    setViewHistory(next);
    applyViewEntry(currentView(next));
  };
  // Add-project entry point shared by the sidebar and the landing empty
  // state. Every project — git repo or plain folder — registers through
  // `project.add`, so the sidebar always renders its row and cards.
  const requestAddProject = () => {
    if (
      isProjectsAvailable(liveCapabilities) &&
      typeof windowProjectBridge(window.drogon).projectAdd === "function"
    )
      setProjectAction({ kind: "add" });
    else
      setError("Projects unavailable: service does not advertise project.v1");
  };
  // Create-workspace entry point shared by Landing, the workspace.create
  // (Cmd+N) chord, the palette and the Projects header "+": opens the
  // new-workspace composer, which creates a worktree for git projects or
  // opens the implicit workspace for folder projects.
  const requestCreateWorkspace = (initialProjectId: string | null = null) => {
    setComposer({ initialProjectId });
  };
  // Project/worktree RPCs behind the sidebar dialogs. Each submit resolves
  // a verbatim daemon error for the form, or null on success (the dialog
  // then closes and the lists refresh through `refresh`, which also
  // reloads the project view via the effect above).
  const submitAddProject = async (input: {
    path: string;
    name?: string;
  }): Promise<string | null> => {
    const bridge = windowProjectBridge(window.drogon);
    if (typeof bridge.projectAdd !== "function")
      return "Projects unavailable: service does not advertise project.v1";
    let projectPath: string;
    try {
      const result = await bridge.projectAdd(input);
      if (!result.ok) return result.error.message;
      projectPath = result.result.path;
    } catch {
      return "Could not add the project. Retry the connection.";
    }
    setProjectAction(null);
    await refresh();
    // A folder project registers its workspace immediately: select it so
    // its implicit card becomes the selected workspace. A git project has
    // no workspace until its first worktree is created.
    try {
      const listed = await window.drogon.workspaces();
      if (listed.ok) {
        const match = findWorkspaceForPath(
          listed.result.workspaces,
          projectPath,
        );
        if (match) selectWorkspaceId(match.id);
      }
    } catch {
      // Selection stays: the refreshed lists already show the project.
    }
    return null;
  };
  // Starts the composer's picked agent in a workspace (journey J1): the
  // composer chains `worktree.create` + `harness.start` so a worktree can
  // open straight into a Pi session with the free local provider/model.
  // The Settings → Agents defaults drive the launch (R16-AO #231), like
  // the "+" menu. Resolves a verbatim daemon error, or null when the
  // agent tab is live.
  const launchComposerAgent = async (
    workspaceId: string,
    agent: ComposerAgentSelection,
  ): Promise<string | null> => {
    const launch = composerAgentLaunchInput(
      workspaceId,
      agent,
      crypto.randomUUID(),
      harnessDefaults,
    );
    if (!launch) return null;
    let session: Session;
    try {
      const result = await startHarnessTracked(launch);
      if (!result.ok) return result.error.message;
      session = result.result;
    } catch {
      return "Could not start the agent. Retry the connection.";
    }
    setSessions((items) => appendOrReplaceSession(items, session));
    setActive(session.id);
    return null;
  };
  const submitWorktree = async (input: {
    projectId: string;
    name: string;
    baseRef?: string;
    branch?: string;
    reuseBranch?: boolean;
    note?: string;
    parentWorktreeId?: string;
    sparse?: string[];
    setupScript?: string;
    waitForSetup?: boolean;
    agent: ComposerAgentSelection;
  }): Promise<string | null> => {
    const bridge = windowProjectBridge(window.drogon);
    if (typeof bridge.worktreeCreate !== "function")
      return "Worktrees unavailable: service does not advertise worktree.v1";
    const { setupScript, waitForSetup, agent, ...createInput } = input;
    let created: Worktree;
    try {
      // The fork's client-side suffix retry (worktree-create-retry-policy):
      // a branch/folder collision suffixed the candidate instead of failing
      // the create, so picking a busy branch still lands a workspace.
      created = await (async () => {
        let lastFailure: string | null = null;
        for (let attempt = 0; attempt < CLIENT_WORKTREE_CREATE_MAX_ATTEMPTS; attempt += 1) {
          const name = getClientWorktreeCreateCandidate(createInput.name, attempt);
          const result = await bridge.worktreeCreate!({
            ...createInput,
            name,
          });
          if (result.ok) return result.result;
          lastFailure = result.error.message;
          if (!isRetryableWorktreeCreateConflict(lastFailure)) break;
        }
        return Promise.reject(new Error(lastFailure ?? "worktree.create failed"));
      })();
    } catch (error) {
      return error instanceof Error && error.message
        ? error.message
        : "Could not create the worktree. Retry the connection.";
    }
    const workspaceId = created.workspaceId;
    selectWorkspaceId(workspaceId);

    // The fork's setup terminal is a real terminal titled "Setup". Drogon
    // has no daemon-side terminal title field, so persist the same title in
    // the existing per-workspace tab-strip metadata after starting a real
    // shell session in the new worktree.
    if (setupScript?.trim()) {
      const project = projectGroups.find(
        (group) => group.project.id === input.projectId,
      )?.project;
      const setupResult = await window.drogon.start(workspaceId, {
        command: "/usr/bin/env",
        args: [
          `DROGON_ROOT_PATH=${project?.path ?? ""}`,
          `DROGON_WORKTREE_PATH=${created.path}`,
          `DROGON_WORKSPACE_NAME=${input.name}`,
          "/bin/sh",
          "-lc",
          setupScript,
        ],
        cwd: created.path,
      });
      if (!setupResult.ok) return setupResult.error.message;
      setSessions((items) => appendOrReplaceSession(items, setupResult.result));
      setActive(setupResult.result.id);
      const setupTabs = loadTabStripState(window.localStorage, workspaceId);
      saveTabStripState(window.localStorage, workspaceId, {
        ...setupTabs,
        titles: { ...setupTabs.titles, [setupResult.result.id]: "Setup" },
      });
      if (waitForSetup) {
        // Loss of contact is not exit: only a confirmed `exited` verdict
        // releases the agent launch. Keep the composer in its creating state
        // while the setup command installs dependencies or writes config.
        const deadline = Date.now() + 10 * 60 * 1000;
        let settled = false;
        while (Date.now() < deadline) {
          const listed = await window.drogon.sessions(workspaceId);
          if (!listed.ok) return listed.error.message;
          const current = listed.result.sessions.find(
            (item) => item.id === setupResult.result.id,
          );
          if (current?.verdict === "exited") {
            settled = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!settled) return "Setup did not finish within 10 minutes.";
      }
    }

    // The worktree exists from here on: a failed agent launch keeps the
    // composer open on the error instead of closing over it, with the new
    // workspace already selected behind.
    const agentFailure = await launchComposerAgent(workspaceId, agent);
    await refresh();
    selectWorkspaceId(workspaceId);
    if (agentFailure) return agentFailure;
    setProjectAction(null);
    // The composer closes itself on success (or stays open for the fork's
    // "Create more"); it owns the close decision now.
    return null;
  };
  const submitRemoveWorktree = async (
    worktree: { id: string; workspaceId: string },
    force: boolean,
  ): Promise<string | null> => {
    const bridge = windowProjectBridge(window.drogon);
    if (typeof bridge.worktreeRemove !== "function")
      return "Worktrees unavailable: service does not advertise worktree.v1";
    try {
      const result = await bridge.worktreeRemove({ id: worktree.id, force });
      if (!result.ok) return result.error.message;
    } catch {
      return "Could not remove the worktree. Retry the connection.";
    }
    setProjectAction(null);
    await refresh();
    // The removed worktree's workspace is gone: move selection to the
    // first remaining workspace instead of leaving a stale id.
    try {
      const listed = await window.drogon.workspaces();
      if (
        listed.ok &&
        !listed.result.workspaces.some((item) => item.id === selected)
      )
        selectWorkspaceId(listed.result.workspaces[0]?.id ?? "");
    } catch {
      // Selection stays: the refreshed lists already dropped the card.
    }
    return null;
  };
  // Project removal (task R14-A) behind the remove-project dialog and the
  // project settings section. Removes the registration only — never files
  // (the source's dialog promises exactly that, with no counts and no
  // refusal, so no gating here). Same submit contract as the worktree
  // submit above: verbatim daemon error, or null on success.
  const createComposerQuickSession = async (input: {
    name: string;
    agent: ComposerAgentSelection;
  }): Promise<string | null> => {
    const bridge = windowProjectBridge(window.drogon);
    if (typeof bridge.quickSessionCreate !== "function")
      return "Quick Session unavailable: service does not advertise project.v1";
    if (!input.agent.harnessId) return "Choose an agent to start Quick Session.";
    let created: { project: Project; workspaceId: string };
    try {
      const result = await bridge.quickSessionCreate(
        input.name.trim() ? { name: input.name.trim() } : undefined,
      );
      if (!result.ok) return result.error.message;
      created = result.result;
    } catch {
      return "Could not create Quick Session. Retry the connection.";
    }
    const launch = composerAgentLaunchInput(
      created.workspaceId,
      input.agent,
      crypto.randomUUID(),
      harnessDefaults,
    );
    if (!launch) return "Choose an agent to start Quick Session.";
    let failure: string | null = null;
    try {
      const result = await startHarnessTracked(launch);
      if (!result.ok) failure = result.error.message;
      else {
        setSessions((items) => appendOrReplaceSession(items, result.result));
        setActive(result.result.id);
      }
    } catch {
      failure = "Could not start the Quick Session harness. Retry the connection.";
    }
    if (failure) {
      // Match the fork's cleanup on a failed quick launch: the scratch
      // project is app-owned, so remove it instead of leaving a dead row.
      if (typeof bridge.projectRemove === "function") {
        try {
          await bridge.projectRemove({ id: created.project.id });
        } catch {
          // Preserve the launch failure; cleanup is best effort.
        }
      }
      return failure;
    }
    await refresh();
    selectWorkspaceId(created.workspaceId);
    setProjectAction(null);
    return null;
  };
  const submitRemoveProject = async (project: {
    id: string;
  }): Promise<string | null> => {
    const bridge = windowProjectBridge(window.drogon);
    if (typeof bridge.projectRemove !== "function")
      return "Projects unavailable: service does not advertise project.v1";
    try {
      const result = await bridge.projectRemove({ id: project.id });
      if (!result.ok) return result.error.message;
    } catch {
      return "Could not remove the project. Retry the connection.";
    }
    setProjectAction(null);
    setSettingsProject((current) =>
      current?.id === project.id ? null : current,
    );
    await refresh();
    // The removed project's workspaces are gone with its worktree
    // registrations: move selection to the first remaining workspace.
    try {
      const listed = await window.drogon.workspaces();
      if (
        listed.ok &&
        !listed.result.workspaces.some((item) => item.id === selected)
      )
        selectWorkspaceId(listed.result.workspaces[0]?.id ?? "");
    } catch {
      // Selection stays: the refreshed lists already dropped the project.
    }
    return null;
  };
  const submitUpdateProjectSetupScript = async (
    projectId: string,
    setupScript: string | null,
  ): Promise<string | null> => {
    const bridge = windowProjectBridge(window.drogon);
    if (typeof bridge.projectUpdate !== "function")
      return "Projects unavailable: service does not advertise project.v1";
    try {
      const result = await bridge.projectUpdate({ id: projectId, setupScript });
      if (!result.ok) return result.error.message;
      setSettingsProject((current) =>
        current?.id === projectId ? result.result : current,
      );
      await refresh();
      return null;
    } catch {
      return "Could not save the setup script. Retry the connection.";
    }
  };
  // Worktree display-title rename (task R9-A): renames the card title
  // only, never the branch or directory; refresh re-reads the title.
  const submitRenameWorktree = async (
    worktree: { id: string },
    name: string,
  ): Promise<string | null> => {
    const bridge = windowProjectBridge(window.drogon);
    if (typeof bridge.worktreeRename !== "function")
      return "Worktrees unavailable: service does not advertise worktree.v1";
    try {
      const result = await bridge.worktreeRename({
        worktreeId: worktree.id,
        name,
      });
      if (!result.ok) return result.error.message;
    } catch {
      return "Could not rename the worktree. Retry the connection.";
    }
    await refresh();
    return null;
  };
  const browseProject = async (): Promise<string | null> => {
    try {
      return await window.drogon.chooseFolder();
    } catch {
      return null;
    }
  };
  // Palette "New worktree" target: the git project owning the selected
  // workspace, else the first git project in the view. The composer
  // preselects it; with no git project yet the composer opens
  // unselected so the user picks (or adds) a project there.
  const newWorktreeTarget = () =>
    gitProjectForWorkspace(projectGroups, selected) ??
    projectGroups.find((group) => group.project.kind === "git")?.project ??
    null;
  const openComposerForNewWorktree = () => {
    requestCreateWorkspace(newWorktreeTarget()?.id ?? null);
  };
  // Quick-open reveal: records the request for the Files panel (so the
  // Explorer tree highlights it) and opens the sidebar there, AND opens/
  // reuses a main tab-group editor tab for the path (#133) — quick-open,
  // the Explorer row click and the terminal file-link popover all funnel
  // through this and openEditorTab below.
  const openFileInFiles = (path: string) => {
    if (!selected) {
      showRightExplorer();
      return;
    }
    fileOpenNonce.current += 1;
    fileOpenCell.current = {
      workspaceId: selected,
      path,
      nonce: fileOpenNonce.current,
    };
    setFileOpenTick((tick) => tick + 1);
    showRightExplorer();
    openEditorTab(selected, path);
  };
  const create = () =>
    action(async () => {
      const captured = contextRef.current;
      const result = checked(await window.drogon.start(captured.workspaceId));
      // A late reply for a host/workspace no longer current is skipped —
      // it's already covered by that workspace's next natural reload.
      if (!contextMatches(captured, contextRef.current)) return;
      setSessions((items) => appendOrReplaceSession(items, result));
      // Fixes #198: a new terminal must win over a selected editor/browser
      // tab, exactly like selecting a session tab does.
      selectSessionTab(result.id);
    });
  // Browser pages share the tab strip with sessions: selecting a session
  // returns to the terminal pane, selecting a page shows the browser pane
  // for it (the pane reports bounds for the selection, activating it on
  // the host). Closing a page reconciles through the strip subscription.
  const selectSessionTab = (id: string) => {
    setRoute(null);
    setActive(id);
    setActiveBrowserTabId(null);
    setActiveEditorTabId(null);
    setActiveMentuTab(false);
  };
  const selectBrowserTab = (tabId: string) => {
    setRoute(null);
    setActiveBrowserTabId(tabId);
    setActiveEditorTabId(null);
    setActiveMentuTab(false);
  };
  // Editor tabs (R16-A, fixes #133): opening a path reuses its tab if
  // already open in that workspace (tabId is workspace+path, so a
  // duplicate can never be minted) and activates it; selecting one hides
  // the terminal/browser panes the same way selecting a browser tab does.
  // Closing the active tab falls back to a strip neighbor, or the
  // terminal pane once no editor tab is left open in this workspace —
  // never straight to a foreign tab kind's or workspace's state.
  //
  // `workspaceId` is an explicit argument (not read from `selected`/a ref)
  // because the terminal file-link opener can switch workspaces and open
  // a tab there in the SAME handler call, before `selected` itself has
  // re-rendered — the caller already knows the target workspace.
  // R16-BJ: `view` carries the fork's editorViewMode — a row click on
  // unstaged markdown re-opens with the Changes view active.
  const openEditorTab = (
    workspaceId: string,
    path: string,
    opts?: { view?: "changes" },
  ) => {
    const tabId = editorTabId(workspaceId, path);
    setEditorTabs((tabs) => {
      const existing = tabs.find((tab) => tab.tabId === tabId);
      if (existing) {
        // A plain open (no view request) never touches the stored view
        // mode — the fork's editorViewMode persists per file until the
        // toggle or a row click changes it.
        if (opts?.view === undefined || existing.view === opts.view) return tabs;
        return tabs.map((tab) =>
          tab.tabId === tabId ? { ...tab, view: opts.view } : tab,
        );
      }
      return [
        ...tabs,
        {
          tabId,
          workspaceId,
          path,
          dirty: false,
          ...(opts?.view ? { view: opts.view } : null),
        },
      ];
    });
    setActiveEditorTabId(tabId);
    setActiveBrowserTabId(null);
    setActiveMentuTab(false);
  };
  // R16-BJ (#294, fork openDiff): the Source Control row's diff opens as
  // its own editor tab, keyed by path AND diff area — the staged and
  // unstaged tabs of one file coexist, and a second click on the same row
  // focuses the existing tab instead of minting a duplicate (fork
  // buildDiffEditorFileId reuse). Diff tabs are session-scoped: the strip
  // persistence is path-shaped, so they are never written to it.
  const openEditorDiffTab = (
    workspaceId: string,
    path: string,
    area: EditorTabDiffArea,
  ) => {
    const tabId = editorDiffTabId(workspaceId, area, path);
    setEditorTabs((tabs) =>
      tabs.some((tab) => tab.tabId === tabId)
        ? tabs
        : [...tabs, { tabId, workspaceId, path, dirty: false, diff: area }],
    );
    setActiveEditorTabId(tabId);
    setActiveBrowserTabId(null);
    setActiveMentuTab(false);
  };
  // #197 New Markdown (fork `onNewFileTab`): the first free
  // untitled[-N].md at the workspace root via files.create, then the
  // shared open-file funnel (Explorer reveal + editor tab). Creation
  // failures surface through the App error banner via `action` — a tab
  // for a file that does not exist is never opened. No editor internals
  // involved: the file exists on disk before the tab opens, so R16-X's
  // surface needs no seam.
  const createNewMarkdownTab = () =>
    action(async () => {
      const workspace = workspaces.find((item) => item.id === selected);
      const hostId = workspace?.hostId || status?.hostId;
      if (!workspace || !hostId) {
        throw new Error("Choose a workspace to create the file in.");
      }
      const create = filesGatedBridge.fileCreate;
      if (!create) {
        throw new Error(
          "Creating files needs a newer daemon with files.create support.",
        );
      }
      const scope = { hostId, workspaceId: workspace.id };
      const name = await createUntitledMarkdown(async (candidate) => {
        const result = await create({ ...scope, path: candidate, kind: "file" });
        if (result.ok) return { ok: true as const };
        return { ok: false as const, message: result.error.message };
      });
      openFileInFiles(name);
    });
  const selectEditorTab = (tabId: string) => {
    setRoute(null);
    setActiveEditorTabId(tabId);
    setActiveBrowserTabId(null);
    setActiveMentuTab(false);
  };
  // Mentu tab (fixes the reported bug): the "+" menu's Mentu entry, the
  // panel's "Open full tab" button and `drogon-cli mentu open` all land
  // here. Opening is idempotent — it focuses the existing tab instead of
  // minting a second one — and it never touches `route`, which is exactly
  // what used to blank the strip.
  const openMentuTab = () => {
    if (!selectedRef.current) return;
    setRoute(null);
    if (!tabStripRef.current.mentu) {
      const next = { ...tabStripRef.current, mentu: true };
      tabStripRef.current = next;
      setTabStrip(next);
      saveTabStripState(window.localStorage, selectedRef.current, next);
    }
    setActiveBrowserTabId(null);
    setActiveEditorTabId(null);
    setActiveMentuTab(true);
  };
  // Closing the selected Mentu tab falls back to the strip neighbor, or the
  // terminal pane when it was the only tab — never to a foreign kind's
  // state.
  const closeMentuTab = () => {
    if (!tabStripRef.current.mentu) return;
    updateTabStrip({ ...tabStripRef.current, mentu: false });
    if (!activeMentuTab) return;
    setActiveMentuTab(false);
    const neighbor = liveStripOrder().find((id) => id !== MENTU_TAB_ID);
    if (!neighbor) return;
    if (visibleEditorTabs.some((tab) => tab.tabId === neighbor))
      setActiveEditorTabId(neighbor);
    else if (browserTabs.some((tab) => tab.tabId === neighbor))
      setActiveBrowserTabId(neighbor);
  };
  // EditorHost only ever reports a dirty change for the path it is
  // CURRENTLY rendering, which by construction is activeEditorTab's path
  // — so the active tab id (not the bare path, which is not unique
  // across workspaces) is the unambiguous target.
  const setEditorTabDirty = (tabId: string, dirty: boolean) => {
    setEditorTabs((tabs) =>
      tabs.map((tab) =>
        tab.tabId === tabId && tab.dirty !== dirty ? { ...tab, dirty } : tab,
      ),
    );
  };
  // R16-BJ: the tab's stored view mode follows the user's toggle (fork
  // setEditorViewMode). Undefined reads as "edit", so toggling back to
  // Edit clears the stored request and a later tab switch lands on Edit,
  // exactly like the fork's per-file view mode.
  const setEditorTabView = (tabId: string, view: "edit" | "changes") => {
    const next = view === "changes" ? ("changes" as const) : undefined;
    setEditorTabs((tabs) =>
      tabs.map((tab) =>
        tab.tabId === tabId && tab.view !== next ? { ...tab, view: next } : tab,
      ),
    );
  };
  // R16-BJ (#302): the tab's file vanished from disk. Only the probe-confirmed
  // kind "deleted" is ever written today (see editor-tab-missing-reconciler.ts);
  // reappearing paths clear the tombstone, like the fork's create event.
  const applyEditorTabMissing = (tabId: string, kind: "deleted" | "renamed" | null) => {
    setEditorTabs((tabs) =>
      tabs.map((tab) => {
        if (tab.tabId !== tabId || tab.diff !== undefined) return tab;
        if (kind === null) return tab.missing !== undefined ? { ...tab, missing: undefined } : tab;
        return tab.missing !== kind ? { ...tab, missing: kind } : tab;
      }),
    );
  };
  // #302 tombstone reconciler: on every workspace change tick, every open
  // file tab's directory is re-listed and vanished paths mark their tab
  // ("deleted" badge + struck label on the tab; the surface freezes on
  // its last snapshot). Diff tabs are exempt — their content comes from
  // git, not the working file. The selected workspace only: tabs of
  // other workspaces reconcile when the user switches there.
  const subscribeSelectedFilesChanged = useCallback(
    (listener: () => void) => subscribeWorkspaceFilesChanged(selected, listener),
    [selected],
  );
  useEditorTabMissingReconciler({
    scope: { hostId: status?.hostId ?? "", workspaceId: selected ?? "" },
    tabs: useMemo(
      () =>
        (selected ? visibleEditorTabs : [])
          // Diff tabs read git, not the working file, so they never
          // tombstone; missing tabs KEEP being probed — a reappearance
          // clears their tombstone (fork: create clears externalMutation).
          .filter((tab) => tab.diff === undefined)
          .map((tab) => ({ tabId: tab.tabId, path: tab.path })),
      [selected, visibleEditorTabs],
    ),
    bridge: filesGatedBridge,
    subscribeFilesChanged: subscribeSelectedFilesChanged,
    onMissing: applyEditorTabMissing,
    onPresent: (tabId) => applyEditorTabMissing(tabId, null),
  });
  const closeEditorTab = (tabId: string) => {
    setEditorTabs((tabs) => tabs.filter((tab) => tab.tabId !== tabId));
    if (activeEditorTabId !== tabId) return;
    const remaining = visibleEditorTabs.filter((tab) => tab.tabId !== tabId);
    if (remaining.length === 0) {
      setActiveEditorTabId(null);
      return;
    }
    const order = liveStripOrder();
    const at = order.indexOf(tabId);
    const remainingIds = new Set(remaining.map((tab) => tab.tabId));
    const neighbor = [
      ...order.slice(at + 1),
      ...order.slice(0, at).reverse(),
    ].find((id) => remainingIds.has(id));
    setActiveEditorTabId(neighbor ?? remaining[remaining.length - 1].tabId);
  };
  const newBrowserTab = () =>
    action(async () => {
      const workspaceId = contextRef.current.workspaceId;
      if (!workspaceId) return;
      expectBrowserTab.current = true;
      try {
        const result = checked(
          await browserStaticBridge.createTab({ workspaceId }),
        );
        if (selectedRef.current !== workspaceId) return;
        setActiveBrowserTabId(result.tabId);
      } catch (failure) {
        expectBrowserTab.current = false;
        throw failure;
      }
    });
  const closeBrowserTab = (tabId: string) =>
    action(async () => {
      checked(await browserStaticBridge.closeTab({ tabId }));
    });
  // R13-B Ports panel: "Open in Browser" creates the tab at the port URL;
  // the strip owns it like the "+" menu path above.
  const openPortBrowserTab = (url: string) =>
    action(async () => {
      const workspaceId = contextRef.current.workspaceId;
      if (!workspaceId) return;
      expectBrowserTab.current = true;
      try {
        const result = checked(
          await browserStaticBridge.createTab({ workspaceId, url }),
        );
        if (selectedRef.current !== workspaceId) return;
        setActiveBrowserTabId(result.tabId);
      } catch (failure) {
        expectBrowserTab.current = false;
        throw failure;
      }
    });
  // R12-D tab strip order/pin/rename/close-variant wiring (pure helpers in
  // tab-order.ts; the strip reconciles stored order with live tabs itself).
  const liveStripOrder = () =>
    partitionPinnedOrder(
      reconcileTabOrder(
        tabStrip.order,
        // Split second panes never own strip tabs (see stripSessions).
        stripSessions.map((item) => item.id),
        browserTabs.map((tab) => tab.tabId),
        visibleEditorTabs.map((tab) => tab.tabId),
        tabStrip.mentu,
      ),
      tabStrip.pinned,
    );
  // R16-AJ (fixes #215): the envelope holds strip MEMBERSHIP, not just
  // order actions. Editors (paths) and browser tabs (id+url) ride the same
  // per-workspace envelope as additive keys, written on every membership
  // change; the stored order is the live reconciled order so a restart
  // restores positions without a prior reorder. Storage-only write (never
  // setState): the read path already reconciles, so there is nothing to
  // loop on. The workspace-switch commit is owned by the load effect
  // above: this effect skips it (tabStrip still holds the previous
  // workspace) and the re-render after the load carries the right strip.
  // Per-kind settle gates (editors/browsers): a kind persists only after
  // its rehydrate verification settled for this workspace (or there was
  // nothing stored to verify). Until then the stored record wins, so a
  // boot with empty in-memory lists can never clobber a full envelope,
  // and an unverifiable kind (files.v1 withheld, host unreachable) keeps
  // its stored record instead of persisting "unknown" as empty.
  const membershipOwnerRef = useRef(selected);
  const editorsSettledRef = useRef(new Set<string>());
  const browsersSettledRef = useRef(new Set<string>());
  useEffect(() => {
    if (membershipOwnerRef.current !== selected) {
      membershipOwnerRef.current = selected;
      return;
    }
    if (!selected) return;
    const prev = loadTabStripState(window.localStorage, selected);
    const editors = editorsSettledRef.current.has(selected)
      ? editorTabs
          .filter((tab) => tab.workspaceId === selected)
          // Diff tabs (#294) are session-scoped: the persisted editors
          // list is path-shaped, so writing a diff tab's path would
          // resurrect it as a plain file tab on the next launch.
          .filter((tab) => tab.diff === undefined)
          .map((tab) => tab.path)
      : prev.editors;
    const browsers = browsersSettledRef.current.has(selected)
      ? browserTabs.map((tab) => ({
          tabId: tab.tabId,
          url: tab.url,
        }))
      : prev.browsers;
    saveTabStripState(window.localStorage, selected, {
      ...tabStrip,
      order: liveStripOrder(),
      editors,
      browsers,
    });
    // Runs when the inputs settle; the write is storage-only (idempotent).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, editorTabs, browserTabs, sessions, tabStrip]);
  // R16-AJ (fixes #215): one-shot per-workspace rehydrate of the persisted
  // strip membership. Editor paths reopen after an existence check through
  // the files bridge (missing files are skipped, never resurrected as
  // empty tabs); browser entries missing from the host's live list are
  // recreated with their stored URLs in stored strip order, and the stored
  // order is remapped old id -> new id so positions survive the host's
  // per-launch id minting. Runs once per workspace per mount: after this
  // the live lists are the source of truth, so a user-closed tab stays
  // closed across workspace switches (its close already rewrote the
  // envelope via the persist effect above). Rehydrate never steals
  // selection: tabs reopen in the background, like the fork's restore.
  // Unsaved drafts are IN-MEMORY ONLY (files-draft-store.ts) and cannot
  // survive a restart by construction — the fork behaves the same; the
  // dirty-tab close guard is the only protection.
  const rehydratedTabsRef = useRef(new Set<string>());
  const rehydrateWorkspaceTabs = async (workspaceId: string) => {
    const stored = loadTabStripState(window.localStorage, workspaceId);
    if (stored.editors.length === 0)
      editorsSettledRef.current.add(workspaceId);
    if (stored.browsers.length === 0)
      browsersSettledRef.current.add(workspaceId);
    if (stored.editors.length === 0 && stored.browsers.length === 0) return;
    if (selectedRef.current !== workspaceId) return;
    const workspace = workspacesRef.current.find(
      (item) => item.id === workspaceId,
    );
    const hostId = workspace?.hostId ?? contextRef.current.hostId;
    if (stored.editors.length > 0 && hostId) {
      const openPaths = new Set(
        editorTabsRef.current
          .filter((tab) => tab.workspaceId === workspaceId)
          .map((tab) => tab.path),
      );
      const candidates = planEditorRehydrate({
        storedPaths: stored.editors,
        openPaths,
      });
      const existing: string[] = [];
      let verified = true;
      for (const path of candidates) {
        if (selectedRef.current !== workspaceId) return;
        try {
          // Plain read, no maxBytes: maxBytes caps the file SIZE (a small
          // cap fails every non-trivial file), so only an uncapped read
          // answers "does this path still exist".
          const read = await filesGatedBridge.fileRead({
            hostId,
            workspaceId,
            path,
          });
          if (read.ok) existing.push(path);
          else if (read.error.code !== "not_found") {
            // Unverifiable (withheld capability, transient failure): abort
            // without settling, so the stored record survives for the next
            // restart instead of persisting "unknown" as empty. Only
            // not_found honestly means "skip this file".
            verified = false;
            break;
          }
        } catch {
          verified = false;
          break;
        }
      }
      if (selectedRef.current !== workspaceId) return;
      if (verified) editorsSettledRef.current.add(workspaceId);
      if (existing.length > 0) {
        setEditorTabs((tabs) => {
          const ids = new Set(tabs.map((tab) => tab.tabId));
          const additions = existing
            .filter((path) => !ids.has(editorTabId(workspaceId, path)))
            .map((path) => ({
              tabId: editorTabId(workspaceId, path),
              workspaceId,
              path,
              dirty: false,
            }));
          return additions.length > 0 ? [...tabs, ...additions] : tabs;
        });
      }
    }
    if (stored.browsers.length === 0) return;
    if (selectedRef.current !== workspaceId) return;
    let liveIds: Set<string>;
    try {
      const state = await browserStaticBridge.getState();
      if (!state.ok) return;
      liveIds = new Set(
        state.result.tabs
          .filter((tab) => tab.workspaceId === workspaceId)
          .map((tab) => tab.tabId),
      );
    } catch {
      // The live list is unknown: recreating blindly could duplicate the
      // host's tabs after a mere renderer reload, so nothing recreates and
      // browsers stay unsettled (the stored record survives). The onState
      // subscription still populates the strip with whatever the host
      // holds.
      return;
    }
    browsersSettledRef.current.add(workspaceId);
    const missing = planBrowserRehydrate({
      stored: stored.browsers,
      liveTabIds: liveIds,
    });
    if (missing.length === 0) return;
    const mapping: Record<string, string> = {};
    for (const entry of missing) {
      if (selectedRef.current !== workspaceId) return;
      try {
        let created = await browserStaticBridge.createTab({
          workspaceId,
          url: entry.url,
        });
        if (!created.ok && created.error.code === "browser_blocked") {
          // Unloadable stored URL (a fresh tab's about:blank is blocked as
          // an explicit load, while the default home tab IS blank): keep
          // the tab membership with a blank page, exactly what the user
          // left behind.
          created = await browserStaticBridge.createTab({ workspaceId });
        }
        if (created.ok) mapping[entry.tabId] = created.result.tabId;
      } catch {
        // One failed recreation never blocks the rest.
      }
    }
    // Total failure retries next restart: browsers stay unsettled, so the
    // stored record survives instead of persisting an empty live list.
    if (Object.keys(mapping).length === 0) return;
    // Remap builder: positions/pins/renames/splits come from in-memory
    // state (pristine stored positions plus any user reorder/pin/rename
    // that landed during rehydrate — every strip writer saves
    // synchronously, so in-memory is never behind storage here), while
    // the browser records carry the recreated ids.
    const buildRemapped = (): TabStripState => {
      const base = tabStripRef.current;
      const current = loadTabStripState(window.localStorage, workspaceId);
      return {
        ...current,
        order: remapTabOrder(base.order, mapping),
        pinned: base.pinned.map((id) => mapping[id] ?? id),
        titles: Object.fromEntries(
          Object.entries(base.titles).map(([id, title]) => [
            mapping[id] ?? id,
            title,
          ]),
        ),
        splits: base.splits,
        browsers: [
          ...current.browsers.filter((entry) => !(entry.tabId in mapping)),
          ...Object.keys(mapping).map((oldId) => ({
            tabId: mapping[oldId],
            url: missing.find((entry) => entry.tabId === oldId)?.url ?? "",
          })),
        ].filter((entry) => entry.url.length > 0),
      };
    };
    // Crash-safe first: the storage envelope carries the remap even if
    // the live echo below never arrives.
    saveTabStripState(window.localStorage, workspaceId, buildRemapped());
    // Bounded wait for the host subscription to echo the recreated tabs:
    // only then do the new ids become the settled live truth, so the
    // persist effect above can never write a settled-but-empty live list
    // over the remapped record. A timeout settles anyway — the live list
    // wins (e.g. the host dropped a tab as fast as it was recreated).
    const deadline = Date.now() + 5000;
    for (;;) {
      if (selectedRef.current !== workspaceId) return;
      const live = new Set(
        browserTabsRef.current
          .filter((tab) => tab.workspaceId === workspaceId)
          .map((tab) => tab.tabId),
      );
      if (Object.values(mapping).every((id) => live.has(id))) break;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (selectedRef.current !== workspaceId) return;
    browsersSettledRef.current.add(workspaceId);
    // Recapture (a user pin/rename may have landed during the wait), then
    // publish: the next persist run converges order + membership at once.
    const remapped = buildRemapped();
    tabStripRef.current = remapped;
    setTabStrip(remapped);
  };
  useEffect(() => {
    if (!selected || !status) return;
    if (rehydratedTabsRef.current.has(selected)) return;
    rehydratedTabsRef.current.add(selected);
    void rehydrateWorkspaceTabs(selected);
    // One-shot per workspace; the guard above owns re-entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, status]);
  const changeTabOrder = (order: string[]) =>
    updateTabStrip({ ...tabStrip, order });
  const toggleTabPin = (id: string) => {
    const order = reconcileTabOrder(
      tabStrip.order,
      stripSessions.map((item) => item.id),
      browserTabs.map((tab) => tab.tabId),
      visibleEditorTabs.map((tab) => tab.tabId),
    );
    const next = togglePinnedOrder(order, tabStrip.pinned, id);
    updateTabStrip({ ...tabStrip, ...next });
  };
  const commitTabTitle = (id: string, title: string | null) => {
    const titles = { ...tabStrip.titles };
    if (title === null) delete titles[id];
    else titles[id] = title;
    updateTabStrip({ ...tabStrip, titles });
  };
  const copyStripText = (text: string) => {
    try {
      void navigator.clipboard?.writeText(text)?.catch(() => {});
    } catch {
      // Clipboard unavailable: the menu action is a no-op.
    }
  };
  const closeStripTabs = (
    anchorId: string,
    mode: "others" | "to-right" | "to-left",
  ) => {
    const order = liveStripOrder();
    const targets = bulkCloseTargets(order, tabStrip.pinned, anchorId, mode);
    if (targets.length === 0) return;
    const doomed = new Set(targets);
    // Move selection off a doomed tab first so each close keeps a survivor.
    const currentId =
      activeMentuTab
        ? MENTU_TAB_ID
        : (activeEditorTabId ?? activeBrowserTabId ?? active);
    if (doomed.has(currentId)) {
      const at = order.indexOf(anchorId);
      const neighbor = [
        ...order.slice(at + 1),
        ...order.slice(0, at).reverse(),
      ].find((id) => !doomed.has(id));
      if (neighbor) {
        if (neighbor === MENTU_TAB_ID) openMentuTab();
        else if (visibleEditorTabs.some((tab) => tab.tabId === neighbor))
          selectEditorTab(neighbor);
        else if (browserTabs.some((tab) => tab.tabId === neighbor))
          selectBrowserTab(neighbor);
        else selectSessionTab(neighbor);
      }
    }
    for (const target of targets) {
      const session = sessions.find((item) => item.id === target);
      // Split-aware: closing a split tab stops both panes, never orphans.
      if (session) void closeTabSession(session);
      else if (target === MENTU_TAB_ID) closeMentuTab();
      else if (visibleEditorTabs.some((tab) => tab.tabId === target))
        closeEditorTab(target);
      else void closeBrowserTab(target);
    }
  };
  const launchHarness = (input: HarnessLaunchInput) => {
    const captured = {
      hostId: contextRef.current.hostId,
      workspaceId: input.workspaceId,
    };
    let launched = false;
    return action(async () => {
      const result = checked(await startHarnessTracked(input));
      launched = true;
      if (!contextMatches(captured, contextRef.current)) return;
      setSessions((items) => appendOrReplaceSession(items, result));
      // Source useTabGroupCreationCommands: a new agent activates its
      // terminal surface, not only the background session identifier.
      selectSessionTab(result.id);
    }).then(() => launched);
  };
  // Single write path for both the toolbar controls and the Settings panel:
  // uiSettings() stays the only source of truth, React state just mirrors it.
  const changeTheme = (next: Theme) => {
    setTheme(next);
    settings.set("theme", next);
  };
  // J10 settings write through on change, same pattern: state mirrors the store.
  const changeTerminalFontSize = (next: number) => {
    setTerminalFontSize(next);
    settings.set("terminalFontSize", next);
  };
  const changeTerminalGpuAcceleration = (
    next: TerminalGpuAcceleration,
  ) => {
    setTerminalGpuAcceleration(next);
    settings.set("terminalGpuAcceleration", next);
  };
  const changeTerminalFontFamily = (next: string) => {
    setTerminalFontFamily(next);
    settings.set("terminalFontFamily", next);
  };
  const changeTerminalFontWeight = (next: number) => {
    setTerminalFontWeight(next);
    settings.set("terminalFontWeight", next);
  };
  const changeTerminalFontWeightBold = (next: number) => {
    setTerminalFontWeightBold(next);
    settings.set("terminalFontWeightBold", next);
  };
  const changeEditorFontFamily = (next: string) => {
    setEditorFontFamily(next);
    settings.set("editorFontFamily", next);
  };
  const changeDefaultHarness = (next: string) => {
    saveAgentSettings({ defaultTuiAgent: next === "" ? "blank" : next as Harness["harnessId"] });
    setDefaultHarnessId(next);
    settings.set("defaultHarnessId", next);
  };
  const changeHarnessDefault = (
    harnessId: string,
    next: HarnessAgentDefault,
  ) => {
    const merged = { ...harnessDefaults, [harnessId]: next };
    setHarnessDefaults(merged);
    settings.set("harnessDefaults", merged);
  };
  const changeNotifyOnAgentNeedsInput = (next: boolean) => {
    setNotifyOnAgentNeedsInput(next);
    settings.set("notifyOnAgentNeedsInput", next);
  };
  const changeNotifyOnAgentTaskComplete = (next: boolean) => {
    setNotifyOnAgentTaskComplete(next);
    settings.set("notifyOnAgentTaskComplete", next);
  };
  const changeNotifyOnTerminalBell = (next: boolean) => {
    setNotifyOnTerminalBell(next);
    settings.set("notifyOnTerminalBell", next);
  };
  const changeNotifySuppressWhenFocused = (next: boolean) => {
    setNotifySuppressWhenFocused(next);
    settings.set("notifySuppressWhenFocused", next);
  };
  // Gear icons and Cmd+, open the settings page; "Back to app" returns to
  // the route that was visible before (null is the Terminals home view).
  const openSettings = (initialSection?: SettingsSectionId) => {
    setSettingsReturnRoute((current) =>
      route === SETTINGS_ROUTE_ID ? current : route,
    );
    if (initialSection) setSettingsInitialSection(initialSection);
    setRoute(SETTINGS_ROUTE_ID);
  };
  // Per-project settings (task R14-A): the sidebar "Project Settings" row
  // opens the settings page on this project's section.
  const openProjectSettings = (project: Project) => {
    setSettingsProject(project);
    setSettingsReturnRoute((current) =>
      route === SETTINGS_ROUTE_ID ? current : route,
    );
    setSettingsInitialSection("project");
    setRoute(SETTINGS_ROUTE_ID);
  };
  // Project settings section removal: on success the page closes back to
  // the route the settings page was opened from.
  const removeProjectFromSettings = (projectId: string) => {
    void submitRemoveProject({ id: projectId }).then((failure) => {
      if (!failure) closeSettings();
    });
  };
  const closeSettings = () => setRoute(settingsReturnRoute);
  // The session-details panel lives in the right sidebar; its visible
  // choice persists through the settings store like the old inspector did.
  // Showing it opens the sidebar on that tab; hiding it closes the sidebar
  // only when it is the visible panel, so the Settings toggle never steals
  // an Explorer/Source Control view.
  const changeInspector = (next: boolean) => {
    setInspector(next);
    settings.set("inspectorVisible", next);
    if (next) openRightSidebarOn("session");
    else if (rightEffective === "session" && rightSidebarOpen) {
      setRightSidebarOpen(false);
      saveRightSidebarOpen(window.localStorage, false);
    }
  };
  const toggleSessionPanel = () => {
    if (rightSidebarOpen && rightEffective === "session") {
      changeInspector(false);
      setRightSidebarOpen(false);
      saveRightSidebarOpen(window.localStorage, false);
    } else {
      changeInspector(true);
    }
  };
  const cycleTheme = () =>
    changeTheme(
      theme === "system" ? "dark" : theme === "dark" ? "light" : "system",
    );
  // The tab close is an explicit, confirmed dismissal (R16-AL2, issue
  // #228): `session.close` stops a live PTY and forgets the durable
  // record, so `exited` rows AND post-restart `unverifiable` stubs alike
  // release their tab. The reply verdict is never gated on: a stub keeps
  // its honest `unverifiable` (loss of contact is not exit) and is
  // removed anyway — the user, not the liveness oracle, decided to close.
  const close = (session: Session) =>
    action(async () => {
      const result = checked(
        await window.drogon.close({
          sessionId: session.id,
          incarnation: session.incarnation,
        }),
      );
      // The service's own identity checks already reject a mismatched
      // reply at the IPC boundary; this is defense-in-depth so a confirmed
      // dismissal is never recorded against the wrong session if that
      // boundary were ever bypassed.
      assertCloseReplyFor(result, session);
      // Only an explicit close hides the tab going forward — a
      // session that merely exited on its own must keep reappearing.
      // Dismissal keys off the session's own recorded host, not this
      // connection's current (mutable) belief about which host it's on.
      markSessionDismissed(session.hostId, session.id, session.incarnation);
      const target = {
        hostId: session.hostId,
        id: session.id,
        incarnation: session.incarnation,
      };
      // Read from refs (not the closure's stale `sessions`/`active`) and
      // apply both via one pure function — never nests a `setState` call
      // inside another's updater. A no-op result means the exact
      // incarnation was already superseded; nothing to remove or reselect.
      const applied = applyConfirmedClose(
        sessionsRef.current,
        target,
        activeRef.current,
      );
      if (!applied) return;
      setSessions(applied.sessions);
      setActive(applied.active);
    });
  // R16-N Split Terminal Right actions. Each pane is a daemon session of
  // the same workspace created through window.drogon.start (the existing
  // session bridge); the tab keeps its root identity while split.
  const splitTerminalRight = (sourceSessionId: string) =>
    action(async () => {
      const workspaceId = contextRef.current.workspaceId;
      if (!workspaceId) return;
      const current = sessionsRef.current;
      if (
        current.length === 0 ||
        splitForTab(
          pruneTerminalSplits(
            hydrateTerminalSplits(tabStripRef.current.splits ?? {}),
            new Set(current.map((item) => item.id)),
          ),
          sourceSessionId,
        )
      )
        return;
      const source = current.find((item) => item.id === sourceSessionId);
      if (!source || source.workspaceId !== workspaceId) return;
      const captured = {
        hostId: contextRef.current.hostId,
        workspaceId,
      };
      const result = checked(await window.drogon.start(workspaceId));
      if (!contextMatches(captured, contextRef.current)) return;
      // The new session joins the tab as the second pane (never its own
      // tab: stripSessions hides it); the tab selection stays on the root.
      setSessions((items) => appendOrReplaceSession(items, result));
      writeSplits({
        ...pruneTerminalSplits(
          hydrateTerminalSplits(tabStripRef.current.splits ?? {}),
          new Set([...current.map((item) => item.id), result.id]),
        ),
        [sourceSessionId]: createTerminalSplit(sourceSessionId, result.id),
      });
    });
  const stopOneSession = async (session: Session) => {
    // Pane teardown inside a tab close is a dismissal too (R16-AL2, #228):
    // `close` stops the PTY when live and forgets the record, so a split
    // member that is a post-restart stub cannot survive the tab close.
    const result = checked(
      await window.drogon.close({
        sessionId: session.id,
        incarnation: session.incarnation,
      }),
    );
    assertCloseReplyFor(result, session);
    markSessionDismissed(session.hostId, session.id, session.incarnation);
  };
  // Closing one split pane (header X, context menu, exit overlay): only
  // that daemon session stops; the survivor keeps the tab as a single.
  // Closing the root promotes the survivor with its strip identity.
  const closeSplitPane = (session: Session) =>
    action(async () => {
      const splits = pruneTerminalSplits(
        hydrateTerminalSplits(tabStripRef.current.splits ?? {}),
        new Set(sessionsRef.current.map((item) => item.id)),
      );
      const outcome = closeTerminalSplitPane(splits, session.id);
      if (!outcome.survivorId || !outcome.dissolvedRoot) {
        void close(session);
        return;
      }
      await stopOneSession(session);
      const survivorId = outcome.survivorId;
      const dissolvedRoot = outcome.dissolvedRoot;
      setSessions((items) =>
        items.filter(
          (item) =>
            !(
              item.id === session.id &&
              item.hostId === session.hostId &&
              item.incarnation === session.incarnation
            ),
        ),
      );
      // One strip write: the dissolved split plus the survivor's
      // migrated order/pins/rename land together. The base spread keeps
      // the R16-AJ membership keys (editors/browsers), which the identity
      // migration (order/pins/titles only) does not carry.
      const next: TabStripState = {
        ...tabStripRef.current,
        ...migrateSplitTabIdentity(
          tabStripRef.current,
          dissolvedRoot,
          survivorId,
        ),
        splits: persistTerminalSplits(outcome.splits),
      };
      tabStripRef.current = next;
      setTabStrip(next);
      saveTabStripState(window.localStorage, selectedRef.current, next);
      if (activeRef.current === session.id || activeRef.current === dissolvedRoot)
        setActive(survivorId);
    });
  // Closing a whole tab (strip X, bulk close): a split tab stops both
  // panes first so no orphan session survives as a surprise new tab.
  const closeTabSession = (session: Session) =>
    action(async () => {
      const splits = pruneTerminalSplits(
        hydrateTerminalSplits(tabStripRef.current.splits ?? {}),
        new Set(sessionsRef.current.map((item) => item.id)),
      );
      const split = splitForTab(splits, session.id);
      // The snapshot below already excludes the stopped second pane, so
      // the single applyConfirmedClose removes both sessions at once.
      const withoutSecond = split
        ? sessionsRef.current.filter((item) => item.id !== split.panes[1])
        : sessionsRef.current;
      if (split) {
        const second = sessionsRef.current.find(
          (item) => item.id === split.panes[1],
        );
        if (second) await stopOneSession(second);
        writeSplits(closeTerminalSplitPane(splits, split.panes[1]).splits);
      }
      await stopOneSession(session);
      markSessionDismissed(session.hostId, session.id, session.incarnation);
      const applied = applyConfirmedClose(
        withoutSecond,
        {
          hostId: session.hostId,
          id: session.id,
          incarnation: session.incarnation,
        },
        activeRef.current,
      );
      if (!applied) return;
      setSessions(applied.sessions);
      setActive(applied.active);
    });
  useEffect(() => {
    // Terminal pane DOM-event contracts (features/terminal): the pane owns
    // the xterm surface and dispatches window CustomEvents for anything it
    // cannot route itself — App owns tabs, the sidebar and the shell
    // bridge. Registered once: every branch reads refs and stable setters
    // only (close/create-shape/openRightSidebarOn touch nothing but
    // those), so the empty deps are exact, never stale. No new state
    // machines: each event reuses the existing handler below.
    const onOpenFile = (event: Event) => {
      const detail = (event as CustomEvent<TerminalFileOpenDetail>).detail;
      if (!detail || typeof detail.path !== "string" || detail.path === "")
        return;
      const workspaceId =
        typeof detail.workspaceId === "string" && detail.workspaceId !== ""
          ? detail.workspaceId
          : selectedRef.current;
      if (!workspaceId) {
        showRightExplorer();
        return;
      }
      // A link from a workspace that is no longer selected switches there
      // first: the file-open cell is workspace-scoped and the Files panel
      // only applies its own scope.
      if (workspaceId !== selectedRef.current) {
        setSelected(workspaceId);
        setActive("");
        setSessions([]);
      }
      // Shift+click (system-default app) has no main primitive in this
      // build; the in-app editor is the honest fallback, never a drop.
      // Line/column ride the event but the cell carries path only, and the
      // opened editor tab has no cursor addressing yet (owner follow-up).
      fileOpenNonce.current += 1;
      fileOpenCell.current = {
        workspaceId,
        path: detail.path,
        nonce: fileOpenNonce.current,
      };
      setFileOpenTick((tick) => tick + 1);
      showRightExplorer();
      // workspaceId (not selectedRef.current) — a workspace switch above
      // has not re-rendered yet, so `selected` may still read the OLD
      // workspace here; the tab must open under the id this handler
      // actually resolved.
      openEditorTab(workspaceId, detail.path);
    };
    const onRestart = (event: Event) => {
      const detail = (event as CustomEvent<TerminalRestartDetail>).detail;
      if (
        !detail ||
        typeof detail.workspaceId !== "string" ||
        detail.workspaceId === ""
      )
        return;
      // The exiting session's own record (when still listed) decides the
      // scope and the launch identity (R12-E): a harness session restarts
      // through harness.start with the record's harness id; a plain shell
      // restarts with the record's exact command/args; with no listed record
      // the daemon's default shell applies. The record is what makes
      // "restart" mean the same harness/command instead of a fresh shell.
      const prior =
        typeof detail.sessionId === "string"
          ? sessionsRef.current.find((item) => item.id === detail.sessionId)
          : undefined;
      // Orca restarts the pane in place. Once its replacement exists, the
      // old exited/recovery record must not return as another tab on reload.
      const forgetReplacedSession = (session: Session | undefined) => {
        if (!session || session.verdict === "live") return;
        markSessionDismissed(session.hostId, session.id, session.incarnation);
        setSessions((items) =>
          items.filter(
            (item) =>
              !(
                item.id === session.id &&
                item.hostId === session.hostId &&
                item.incarnation === session.incarnation
              ),
          ),
        );
        void window.drogon
          .close({
            sessionId: session.id,
            incarnation: session.incarnation,
          })
          .catch(() => {});
      };
      const launch = projectTerminalRestartLaunch(prior, detail.workspaceId);
      // R16-AJ2 follow-up (issue #221): the record alone carries only the
      // harness id; a remembered launch input replays provider/model/prompt
      // verbatim, so Restart/Retry relaunch the same agent command like the
      // fork's error overlay (it re-runs the pane's recorded startup).
      const remembered = harnessLaunchMemoryRef.current.get(detail.sessionId);
      void action(async () => {
        const captured = {
          hostId: contextRef.current.hostId,
          workspaceId: launch.workspaceId,
        };
        const result = checked(
          launch.kind === "harness"
            ? await startHarnessTracked(
                remembered
                  ? buildHarnessLaunchRetry(remembered, crypto.randomUUID())
                  : {
                      workspaceId: launch.workspaceId,
                      harnessId: launch.harnessId,
                      // R16-AO (#231): a restart relaunches the same harness, so
                      // it keeps the stored default permission mode (Claude Code
                      // restarts in yolo, like a fresh menu launch) instead of a
                      // hardcoded manual mode.
                      permissionMode: resolveHarnessPermissionMode(
                        launch.harnessId,
                        harnessDefaults,
                      ),
                      requestId: crypto.randomUUID(),
                    },
              )
            : await window.drogon.start(
                launch.workspaceId,
                launch.kind === "shell"
                  ? { command: launch.command, args: launch.args }
                  : undefined,
              ),
        );
        // A late reply for a host/workspace no longer current is skipped,
        // exactly like create() above; then the new tab activates.
        if (!contextMatches(captured, contextRef.current)) return;
        // The replacement owns the launch memory now; the superseded
        // session's entry must not grow the map unbounded.
        harnessLaunchMemoryRef.current.delete(detail.sessionId);
        // R16-N: a split pane restarts in place — the replacement session
        // takes the old pane's slot (and focus) instead of opening a tab,
        // and the exited pane leaves the list so it never resurfaces.
        const liveIds = new Set(sessionsRef.current.map((item) => item.id));
        const hydrated = pruneTerminalSplits(
          hydrateTerminalSplits(tabStripRef.current.splits ?? {}),
          liveIds,
        );
        if (
          typeof detail.sessionId === "string" &&
          isSplitPaneSession(hydrated, detail.sessionId)
        ) {
          const old = sessionsRef.current.find(
            (item) => item.id === detail.sessionId,
          );
          if (old)
            markSessionDismissed(old.hostId, old.id, old.incarnation);
          forgetReplacedSession(old);
          setSessions((items) =>
            appendOrReplaceSession(
              items.filter((item) => item.id !== detail.sessionId),
              result,
            ),
          );
          const next = {
            ...tabStripRef.current,
            ...migrateSplitTabIdentity(tabStripRef.current, detail.sessionId, result.id),
            splits: persistTerminalSplits(replaceTerminalSplitPane(hydrated, detail.sessionId, result.id)),
          };
          tabStripRef.current = next;
          setTabStrip(next);
          saveTabStripState(window.localStorage, selectedRef.current, next);
          if (activeRef.current === detail.sessionId) setActive(result.id);
          return;
        }
        forgetReplacedSession(prior);
        if (prior) {
          const next = {
            ...tabStripRef.current,
            ...migrateSplitTabIdentity(tabStripRef.current, prior.id, result.id),
          };
          tabStripRef.current = next;
          setTabStrip(next);
          saveTabStripState(window.localStorage, selectedRef.current, next);
        }
        setSessions((items) => appendOrReplaceSession(items, result));
        selectSessionTab(result.id);
      });
    };
    const onClose = (event: Event) => {
      const detail = (event as CustomEvent<TerminalCloseDetail>).detail;
      if (!detail || typeof detail.sessionId !== "string") return;
      // The tab's own close path (same confirmation policy): only the
      // exact listed session is confirmed-stopped and dismissed. A stale
      // event for a tab that is already gone is a no-op, never a blind
      // stop. R16-N: a split member closes its pane (the survivor keeps
      // the tab); any other session closes its tab.
      const listed = sessionsRef.current.find(
        (item) =>
          item.id === detail.sessionId &&
          item.workspaceId === detail.workspaceId,
      );
      if (!listed) return;
      const hydrated = pruneTerminalSplits(
        hydrateTerminalSplits(tabStripRef.current.splits ?? {}),
        new Set(sessionsRef.current.map((item) => item.id)),
      );
      if (isSplitPaneSession(hydrated, listed.id)) void closeSplitPane(listed);
      else void close(listed);
    };
    const onOpenExternalUrl = (event: Event) => {
      const detail = (event as CustomEvent<{ url: unknown }>).detail;
      // The pane resolves {ok:true} on dispatch, so a refusal here only
      // ever surfaces in the App error banner — never silently.
      if (!detail || !isExternalUrlAllowed(detail.url)) {
        setError("Refused to open a non-http(s) URL in the system browser.");
        return;
      }
      const shellBridge = (
        window.drogon as unknown as { shell?: ShellBridge }
      ).shell;
      if (!shellBridge || typeof shellBridge.openExternal !== "function") {
        setError(
          "System browser unavailable: the shell bridge is not exposed.",
        );
        return;
      }
      void shellBridge
        .openExternal(detail.url)
        .then((response) => {
          if (!response.ok) setError(response.error.message);
        })
        .catch(() => setError("Could not open the URL in the system browser."));
    };
    window.addEventListener(TERMINAL_FILE_OPEN_EVENT, onOpenFile);
    window.addEventListener(TERMINAL_RESTART_EVENT, onRestart);
    window.addEventListener(TERMINAL_CLOSE_EVENT, onClose);
    window.addEventListener("drogon:open-external-url", onOpenExternalUrl);
    return () => {
      window.removeEventListener(TERMINAL_FILE_OPEN_EVENT, onOpenFile);
      window.removeEventListener(TERMINAL_RESTART_EVENT, onRestart);
      window.removeEventListener(TERMINAL_CLOSE_EVENT, onClose);
      window.removeEventListener(
        "drogon:open-external-url",
        onOpenExternalUrl,
      );
    };
    // Registered once by design; every branch is ref/stable-setter only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // Mentu panel "Open full tab" (R11-D) and `drogon-cli mentu open`: both
    // dispatch this window event because App owns the strip. It opens the
    // workspace's Mentu TAB — never a route, because a full-page route
    // hides the tab strip (the reported bug). The handler is a
    // first-render closure, so it reads `selectedRef`/`tabStripRef`
    // instead of render-scoped state; every setter it touches is stable.
    const onOpenMentuTab = () => openMentuTab();
    window.addEventListener(MENTU_OPEN_TAB_EVENT, onOpenMentuTab);
    return () =>
      window.removeEventListener(MENTU_OPEN_TAB_EVENT, onOpenMentuTab);
  }, []);
  useEffect(() => {
    // `drogon-cli mentu open` (main process -> renderer): the relay command
    // is answered by this shell, because the Mentu tab is renderer state.
    // A registered-once closure over refs only, with one explicit verdict
    // per request — a workspace that does not exist, a withheld mentu.v1
    // capability and a successful open are three different answers, so the
    // CLI can never report an open that did not happen.
    const bridge = windowMentuBridge();
    if (!bridge?.onOpenTab || !bridge.reportOpenTab) return;
    const report = bridge.reportOpenTab.bind(bridge);
    const off = bridge.onOpenTab((request) => {
      const workspaceId = request.workspaceId;
      const refuse = (code: string, message: string) => {
        void report({ requestId: request.requestId, ok: false, code, message });
      };
      if (!workspacesRef.current.some((item) => item.id === workspaceId)) {
        refuse(
          "mentu_workspace_unknown",
          `No workspace '${workspaceId}' is registered in this Drogon window.`,
        );
        return;
      }
      if (!mentuGateRef.current) {
        refuse(
          "mentu_unavailable",
          "The running service does not advertise mentu.v1, so the Mentu tab cannot open.",
        );
        return;
      }
      // Membership is written to the REQUESTED workspace's envelope, not
      // the selected one: a relayed open must never open the tab in the
      // wrong workspace just because the user is looking elsewhere.
      const stored = loadTabStripState(window.localStorage, workspaceId);
      if (!stored.mentu)
        saveTabStripState(window.localStorage, workspaceId, {
          ...stored,
          mentu: true,
        });
      if (request.recipeId)
        mentuStore.set(workspaceId, { selectedRecipeId: request.recipeId });
      if (selectedRef.current !== workspaceId) {
        // Switching workspaces reloads the strip from the envelope written
        // above, and the workspace-switch effect clears the selection; the
        // pending marker re-applies it after the load lands.
        pendingMentuOpenRef.current = workspaceId;
        setRoute(null);
        setSelected(workspaceId);
      } else {
        const current = tabStripRef.current;
        if (!current.mentu) {
          const next = { ...current, mentu: true };
          tabStripRef.current = next;
          setTabStrip(next);
        }
        setRoute(null);
        setActiveBrowserTabId(null);
        setActiveEditorTabId(null);
        setActiveMentuTab(true);
      }
      void report({ requestId: request.requestId, ok: true });
    });
    return off;
  }, []);
  // Completes a relayed `mentu.open` for another workspace: the strip load
  // for that workspace has landed and the membership is there, so the
  // selection can be applied without racing the workspace-switch reset.
  useEffect(() => {
    if (pendingMentuOpenRef.current !== selected) return;
    if (!tabStrip.mentu) return;
    pendingMentuOpenRef.current = null;
    setActiveBrowserTabId(null);
    setActiveEditorTabId(null);
    setActiveMentuTab(true);
  }, [selected, tabStrip.mentu]);
  useEffect(() => {
    // Source Control row open (#294): the panel dispatches a window event
    // because App owns the main tab strip — the exact shape of the
    // terminal file-open contract above. The handler is first-render
    // closure over openEditorTab/openEditorDiffTab, which only touch
    // stable tab setters (same discipline as onOpenFile in the effect
    // above); the workspace always rides the detail (the panel is
    // mounted for the current workspace), with the selected workspace as
    // the honest fallback.
    const onRowOpen = (event: Event) => {
      const detail = parseSourceControlRowOpenDetail(
        (event as CustomEvent<unknown>).detail,
      );
      if (!detail) return;
      const workspaceId =
        detail.workspaceId || selectedRef.current;
      if (!workspaceId) return;
      if (detail.kind === "diff") {
        openEditorDiffTab(workspaceId, detail.path, detail.area);
        return;
      }
      // Fork use-row-opening.ts: unstaged markdown opens its edit tab
      // with the Changes view active instead of a diff tab.
      openEditorTab(workspaceId, detail.path, { view: "changes" });
    };
    window.addEventListener(SOURCE_CONTROL_ROW_OPEN_EVENT, onRowOpen);
    return () =>
      window.removeEventListener(SOURCE_CONTROL_ROW_OPEN_EVENT, onRowOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // Source-parity window chords (keybindings/definitions.ts) are matched by
    // one shell dispatcher. Palette-owned ids and pane-local ids deliberately
    // have no handler here, so the focused palette/browser/editor/terminal can
    // keep the chord just as it does in the fork.
    const isDisabled = () => !selected || !status || busy || loadingSessions;
    const stepWorkspace = (delta: 1 | -1) => {
      if (workspaces.length === 0) return;
      const at = workspaces.findIndex((item) => item.id === selected);
      const next =
        (at < 0 ? (delta < 0 ? 0 : -1) : at + delta + workspaces.length) %
        workspaces.length;
      selectWorkspaceId(workspaces[next].id);
    };
    const selectWorkspaceAt = (index: number) => {
      const workspace = workspaces[index];
      if (workspace) selectWorkspaceId(workspace.id);
    };
    const closeActiveTab = () => {
      if (activeEditorTabId) {
        closeEditorTab(activeEditorTabId);
        return;
      }
      if (activeBrowserTabId) {
        void closeBrowserTab(activeBrowserTabId);
        return;
      }
      const session = sessions.find((item) => item.id === active);
      if (session) void closeTabSession(session);
    };
    const closeAllEditorTabs = () => {
      for (const tab of visibleEditorTabs) closeEditorTab(tab.tabId);
    };
    const focusWorktreeList = () => {
      document
        .querySelector<HTMLElement>(
          '[aria-label="Filter projects and worktrees"]',
        )
        ?.focus();
    };
    const defaultAgent = harnesses.find(
      (harness) =>
        harness.availability === "available" &&
        harness.harnessId === defaultHarnessId,
    );
    const terminalPaneId = (event: KeyboardEvent): string => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const pane = target.closest<HTMLElement>("[data-terminal-pane-id]");
        if (pane?.dataset.terminalPaneId) return pane.dataset.terminalPaneId;
      }
      return activeRootId || active;
    };
    const focusAdjacentTerminalPane = (
      event: KeyboardEvent,
      direction: -1 | 1,
    ) => {
      const target = event.target;
      const pane =
        target instanceof HTMLElement
          ? target.closest<HTMLElement>(".terminal-split-pane")
          : null;
      const host = pane?.parentElement;
      const panes = host
        ? Array.from(host.querySelectorAll<HTMLElement>(".terminal-split-pane"))
        : [];
      const at = pane ? panes.indexOf(pane) : -1;
      const next = panes[at + direction];
      next?.querySelector<HTMLElement>(".xterm-helper-textarea")?.focus();
    };
    const handlers: Record<
      string,
      (digit: number | null, event: KeyboardEvent) => void
    > = {
      // Source id tab.newTerminal ("New terminal tab", Mod+T) replaces the
      // old Drogon workspace.newTerminal chord.
      "tab.newTerminal": guardHandler(() => void create(), isDisabled),
      // J10: Mod+, opens Settings from anywhere.
      "app.settings": () => openSettings(),
      // The source owns force reload in the window shortcut router; the
      // renderer fallback keeps the same behavior for Drogon's dev window.
      "app.forceReload": () => window.location.reload(),
      "workspace.create": guardHandler(
        () => requestCreateWorkspace(),
        () => busy,
      ),
      "terminal.clear": (_digit, event) => {
        window.dispatchEvent(
          new CustomEvent(TERMINAL_CLEAR_EVENT, {
            detail: { sessionId: terminalPaneId(event) },
          }),
        );
      },
      "terminal.search": (_digit, event) => {
        window.dispatchEvent(
          new CustomEvent(TERMINAL_SEARCH_EVENT, {
            detail: { sessionId: terminalPaneId(event) },
          }),
        );
      },
      "terminal.focusNextPane": (_digit, event) =>
        focusAdjacentTerminalPane(event, 1),
      "terminal.focusPreviousPane": (_digit, event) =>
        focusAdjacentTerminalPane(event, -1),
      "terminal.closePane": (_digit, event) => {
        const session = sessions.find(
          (item) => item.id === terminalPaneId(event),
        );
        if (session) {
          window.dispatchEvent(
            new CustomEvent<TerminalCloseDetail>(TERMINAL_CLOSE_EVENT, {
              detail: {
                sessionId: session.id,
                workspaceId: session.workspaceId,
              },
            }),
          );
        }
      },
      // R16-N: fork Split Terminal Right (Mod+D / Mod+Shift+D).
      "terminal.splitRight": guardHandler(
        () => {
          if (activeBrowserTabId) return;
          const id = activeRootId || active;
          if (id) void splitTerminalRight(id);
        },
        () => !activeRootId && !active,
      ),
      // Drogon's split host is horizontal-only today; keeping the source's
      // down chord on the same creation path is the honest fallback until a
      // tree layout replaces the flat two-pane adapter.
      "terminal.splitDown": guardHandler(
        () => {
          if (activeBrowserTabId) return;
          const id = activeRootId || active;
          if (id) void splitTerminalRight(id);
        },
        () => !activeRootId && !active,
      ),
      "sidebar.left.toggle": toggleSidebar,
      "sidebar.right.toggle": toggleRightSidebar,
      "sidebar.explorer.toggle": showRightExplorer,
      "sidebar.sourceControl.toggle": guardHandler(
        showRightSourceControl,
        () => !gitPanelAvailable,
      ),
      "sidebar.ports.toggle": guardHandler(
        () => openRightSidebarOn("ports"),
        () => !selected,
      ),
      "sidebar.focusWorktreeList": focusWorktreeList,
      "view.tasks": () => setRoute(TASKS_ROUTE_ID),
      // Source's default-agent tab action is macOS-only. The same default
      // harness/settings path as the New Workspace composer keeps its local
      // model/provider and permission defaults intact.
      "tab.newAgent": guardHandler(
        () => {
          if (defaultAgent && selected) {
            void launchComposerAgent(selected, {
              harnessId: defaultAgent.harnessId,
              model: "",
              provider: "",
            });
          }
        },
        () => !defaultAgent || isDisabled(),
      ),
      "tab.newBrowser": guardHandler(() => void newBrowserTab(), isDisabled),
      "tab.newMarkdown": guardHandler(
        () => void createNewMarkdownTab(),
        isDisabled,
      ),
      "tab.close": guardHandler(closeActiveTab, isDisabled),
      "tab.closeAll": guardHandler(closeAllEditorTabs, isDisabled),
      "worktree.history.back": guardHandler(
        goBackViewHistory,
        () => !canGoBackView(viewHistory, liveWorkspaceIds),
      ),
      "worktree.history.forward": guardHandler(
        goForwardViewHistory,
        () => !canGoForwardView(viewHistory, liveWorkspaceIds),
      ),
      "worktree.navigateUp": () => stepWorkspace(-1),
      "worktree.navigateDown": () => stepWorkspace(1),
      "workspace.selectByIndex": (digit) => {
        if (digit !== null) selectWorkspaceAt(digit);
      },
    };
    const keydown = (event: KeyboardEvent) => {
      dispatchShellKeybinding({ event, handlers });
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  const setAppearanceFlag = (key: AppearanceMenuKey, value: boolean) => {
    settings.set(key, value);
    setAppearanceFlags((flags) => ({ ...flags, [key]: value }));
  };
  const toggleAppearanceFlag = (key: AppearanceMenuKey) =>
    setAppearanceFlag(key, !appearanceFlags[key]);
  useEffect(() => {
    // R14-B native menu bridge (source register-app-menu.ts dispatches over
    // IPC; the renderer owns these surfaces): one subscription forwards menu
    // commands to the existing shell handlers, and the appearance flags are
    // reported to main so the View > Appearance checkbox marks stay accurate
    // (main rebuilds the menu on each report). Re-registered every render
    // like the keybinding effect above so the handlers never go stale; the
    // report is deduped because Electron re-applies the whole template.
    const bridge = windowAppMenuBridge();
    const offCommand = bridge?.onCommand((command) => {
      if (command.type === "open-settings") openSettings();
      else if (command.type === "toggle-left-sidebar") toggleSidebar();
      else if (command.type === "toggle-right-sidebar") toggleRightSidebar();
      else toggleAppearanceFlag(command.key);
    });
    const offPaste = bridge?.onPaste(() => {
      // Dialog/form inputs (Add Project et al): the Edit > Paste menu item
      // arrives here over IPC with the key event already consumed in main,
      // and document.execCommand("paste") is denied in Chromium, so the
      // clipboard is read explicitly and inserted into the focused text
      // control (text-control-paste.ts). Terminal and editor surfaces are
      // excluded there — their own pipelines keep working untouched — and
      // anything unclaimed keeps the legacy fallback below.
      void handleTextControlAppMenuPaste().then((result) => {
        if (result.status !== "pasted") document.execCommand("paste");
      });
    });
    const offSelection = bridge?.onSelectionAction((action) => {
      document.execCommand(action === "copy" ? "copy" : "selectAll");
    });
    if (bridge) {
      const state: AppearanceMenuState = {
        statusBarVisible: appearanceFlags.statusBarVisible,
        tasksButtonVisible: appearanceFlags.tasksButtonVisible,
        automationsButtonVisible: appearanceFlags.automationsButtonVisible,
        titlebarAppNameVisible: appearanceFlags.titlebarAppNameVisible,
      };
      const serialized = JSON.stringify(state);
      if (appearanceReportRef.current !== serialized) {
        appearanceReportRef.current = serialized;
        bridge.reportAppearanceState(state).catch(() => {
          // Menu sync is best-effort chrome; a missed report only delays a
          // checkbox mark until the next flag change.
        });
      }
    }
    return () => {
      offCommand?.();
      offPaste?.();
      offSelection?.();
    };
  });
  // Dock unread badge (source useUnreadDockBadge): the needs_input count
  // rides the same session list the sidebar cards use, minus the viewed
  // session so the badge clears on view like the fork's unread maps.
  useUnreadDockBadge(unreadDockBadgeCount(sessions, active));
  useEffect(() => {
    // Terminal font size rides a CSS hook the terminal surface reads, so the
    // stored choice applies without remounting sessions.
    document.documentElement.style.setProperty(
      "--terminal-font-size",
      `${terminalFontSize}px`,
    );
  }, [terminalFontSize]);
  const platformIsMac =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
  const shortcutLabel = (key: string) => `${platformIsMac ? "⌘" : "Ctrl"}${key}`;
  return (
    <Tooltip.Provider delayDuration={400}>
      <div className="app-shell">
        <div className="titlebar" data-testid="app-titlebar">
          {chrome.showChromeControls ? (
            <div
              className={`titlebar-left${chrome.floating ? " titlebar-left-floating" : ""}`}
              style={
                chrome.leftChromeWidth === null
                  ? undefined
                  : { width: chrome.leftChromeWidth }
              }
            >
              <TitlebarLeftControls
                canGoBack={canGoBackView(viewHistory, liveWorkspaceIds)}
                canGoForward={canGoForwardView(viewHistory, liveWorkspaceIds)}
                showSidebarToggle={chrome.showSidebar}
                showHistoryControls={chrome.showHistoryControls}
                floating={chrome.floating}
                backShortcutLabel={shortcutLabel("⌥←")}
                forwardShortcutLabel={shortcutLabel("⌥→")}
                toggleShortcutLabel={shortcutLabel("B")}
                onToggleSidebar={toggleSidebar}
                onGoBack={goBackViewHistory}
                onGoForward={goForwardViewHistory}
              />
            </div>
          ) : null}
        </div>
        <div className="app-content">
        {chrome.showSidebar ? (
          <Sidebar
            onNewSession={() => setNewSessionOpen(true)}
            open={sidebarOpen}
            width={sidebarWidth}
            onWidthChange={changeSidebarWidth}
            route={route}
            onSelectRoute={setRoute}
            onOpenPalette={openCommandPalette}
            showTasksButton={appearanceFlags.tasksButtonVisible}
            showAutomationsButton={appearanceFlags.automationsButtonVisible}
            groups={projectGroups}
            workspaces={workspaces}
            // R16-N: split second panes are not sidebar rows either. This is
            // the HOST-WIDE union, not the selected workspace's slice, so the
            // cards keep their own sessions and their order is
            // selection-independent (see `sidebarSessions`).
            sessions={sidebarSessions}
            selectedWorkspaceId={selected}
            activeSessionId={activeRootId}
            tabStrip={tabStrip}
            onSelectSession={selectSessionTab}
            botSessions={sidebarBotSessions}
            onOpenBotSession={openSidebarBotSession}
            workspaceDisabled={busy}
            addDisabled={!status || busy}
            onSelectWorkspace={selectWorkspaceId}
            onAddProject={requestAddProject}
            onCreateWorkspace={(projectId) =>
              requestCreateWorkspace(projectId ?? null)
            }
            worktreesAvailable={isWorktreesAvailable(liveCapabilities)}
            projectAction={projectAction}
            onOpenProjectAction={setProjectAction}
            onCloseProjectAction={() => setProjectAction(null)}
            onBrowseProject={browseProject}
            onSubmitAddProject={submitAddProject}
            onSubmitRemoveWorktree={submitRemoveWorktree}
            onSubmitRemoveProject={submitRemoveProject}
            onSubmitRenameWorktree={submitRenameWorktree}
            onOpenProjectSettings={openProjectSettings}
            onOpenSettings={openSettings}
          />
        ) : null}
        {/* Plain div, not main: the fork mounts no outer main landmark —
            full pages bring their own `<main>` (Bots/Automations) or none
            (Tasks), and the session view has none either. */}
        <div className="session-area" style={{ position: "relative" }}>
          {route === SETTINGS_ROUTE_ID ? (
            <div className="session-layout">
              <section
                ref={settingsSectionRef}
                tabIndex={-1}
                className="terminal-column"
                aria-label="Settings"
                style={{ flex: 1 }}
              >
                <SettingsPage
                  key={`settings:${settingsInitialSection}:${settingsProject?.id ?? "-"}`}
                  theme={theme}
                  onThemeChange={changeTheme}
                  terminalFontSize={terminalFontSize}
                  onTerminalFontSizeChange={changeTerminalFontSize}
                  terminalGpuAcceleration={terminalGpuAcceleration}
                  onTerminalGpuAccelerationChange={changeTerminalGpuAcceleration}
                  terminalFontFamily={terminalFontFamily}
                  onTerminalFontFamilyChange={changeTerminalFontFamily}
                  terminalFontWeight={terminalFontWeight}
                  onTerminalFontWeightChange={changeTerminalFontWeight}
                  terminalFontWeightBold={terminalFontWeightBold}
                  onTerminalFontWeightBoldChange={changeTerminalFontWeightBold}
                  editorFontFamily={editorFontFamily}
                  onEditorFontFamilyChange={changeEditorFontFamily}
                  inspectorVisible={inspector}
                  onInspectorChange={changeInspector}
                  statusBarVisible={appearanceFlags.statusBarVisible}
                  onStatusBarVisibleChange={(visible) =>
                    setAppearanceFlag("statusBarVisible", visible)
                  }
                  tasksButtonVisible={appearanceFlags.tasksButtonVisible}
                  onTasksButtonVisibleChange={(visible) =>
                    setAppearanceFlag("tasksButtonVisible", visible)
                  }
                  automationsButtonVisible={
                    appearanceFlags.automationsButtonVisible
                  }
                  onAutomationsButtonVisibleChange={(visible) =>
                    setAppearanceFlag("automationsButtonVisible", visible)
                  }
                  titlebarAppNameVisible={
                    appearanceFlags.titlebarAppNameVisible
                  }
                  onTitlebarAppNameVisibleChange={(visible) =>
                    setAppearanceFlag("titlebarAppNameVisible", visible)
                  }
                  harnesses={detectedHarnesses}
                  defaultHarnessId={defaultHarnessId}
                  onDefaultHarnessChange={changeDefaultHarness}
                  harnessDefaults={harnessDefaults}
                  onHarnessDefaultChange={changeHarnessDefault}
                  agentSettingsCapabilityAvailable={
                    status === null
                      ? undefined
                      : isAgentSettingsAvailable(liveCapabilities)
                  }
                  notifyOnAgentNeedsInput={notifyOnAgentNeedsInput}
                  onNotifyChange={changeNotifyOnAgentNeedsInput}
                  notifyOnAgentTaskComplete={notifyOnAgentTaskComplete}
                  onAgentTaskCompleteChange={changeNotifyOnAgentTaskComplete}
                  notifyOnTerminalBell={notifyOnTerminalBell}
                  onTerminalBellChange={changeNotifyOnTerminalBell}
                  notifySuppressWhenFocused={notifySuppressWhenFocused}
                  onSuppressWhenFocusedChange={changeNotifySuppressWhenFocused}
                  workspacePath={current?.path ?? null}
                  initialSection={settingsInitialSection}
                  project={settingsProject}
                  onRemoveProject={removeProjectFromSettings}
                  onUpdateSetupScript={submitUpdateProjectSetupScript}
                  onBack={closeSettings}
                />
              </section>
            </div>
          ) : workspaces.length === 0 &&
            route !== TASKS_ROUTE_ID &&
            route !== BOTS_ROUTE_ID &&
            // Meetings reads the owner's notes off disk: it is workspace-
            // independent, so a first-run install with no project must still
            // reach it instead of the Landing page.
            route !== MEETINGS_ROUTE_ID ? (
            noWorkspaceCopy ? (
              <NoWorkspacePage
                title={noWorkspaceCopy.title}
                description={noWorkspaceCopy.description}
                projects={projectGroups.map((group) => group.project)}
                onAddProject={requestAddProject}
                onCreateWorkspace={requestCreateWorkspace}
              />
            ) : (
              <Landing
                onNewSession={() => setNewSessionOpen(true)}
                hasProjects={projectGroups.length > 0}
                hasWorkspaces={false}
                onAddProject={requestAddProject}
                onCreateWorkspace={() => requestCreateWorkspace()}
              />
            )
          ) : (
            <>
          {/* Standalone pages (Bots/Tasks/Automations) replace the session
              view outright — the fork renders no session header above
              them, so the header and the connection banner unmount here
              (both stateless) while the layout below only hides. */}
          {!fullPageActive && (
            <>
          <header className="session-header" style={{ position: "relative" }}>
            <div className="workspace-heading">
              <strong>{current?.name ?? "Your workspace"}</strong>
              {current && <span className="path">{current.path}</span>}
            </div>
            <div className="header-actions">
              <IconButton label={`Theme: ${theme}`} onClick={cycleTheme}>
                {theme === "system" ? (
                  <Monitor size={16} />
                ) : theme === "dark" ? (
                  <Moon size={16} />
                ) : (
                  <Sun size={16} />
                )}
              </IconButton>
              <IconButton
                label="Refresh connection"
                disabled={busy}
                onClick={() => void refresh()}
              >
                <RefreshCw />
              </IconButton>
              <IconButton
                label="Toggle session details"
                onClick={toggleSessionPanel}
              >
                <PanelRight />
              </IconButton>
              <IconButton
                label="Settings"
                aria-expanded={route === SETTINGS_ROUTE_ID}
                onClick={() =>
                  route === SETTINGS_ROUTE_ID
                    ? closeSettings()
                    : openSettings()
                }
              >
                <Settings size={16} />
              </IconButton>
            </div>
          </header>
          {/* R16-M daemon connection (fork parity): the ported banner owns
              the retry ladder and the disconnect toast (ready-transition
              reloads live in useConnectionReadyReload at root, issue
              #185); while connected an unrelated error keeps the legacy
              banner. */}
          <DaemonConnectionBanner
            error={error}
            retryDisabled={busy}
            onRetry={() => void refresh()}
          />
            </>
          )}
          <div className="session-layout">
            <section
              className="terminal-column"
              aria-label="Terminals"
              style={{
                display:
                  (route === BOTS_ROUTE_ID && botsAlive) ||
                  (route === AUTOMATIONS_ROUTE_ID &&
                    automationsAlive &&
                    filesProps !== null) ||
                  (route === TASKS_ROUTE_ID && tasksAlive)
                    ? "none"
                    : undefined,
              }}
            >
              <TabBar
                // R16-N: second panes hide (displaySessions also aggregates
                // the split tab badge); selection stays on the root.
                sessions={displaySessions}
                activeSessionId={activeRootId}
                browserTabs={browserTabs}
                activeBrowserTabId={activeBrowserTabId}
                editorTabs={visibleEditorTabs}
                activeEditorTabId={activeEditorTab?.tabId ?? null}
                harnesses={harnesses}
                workspaceId={selected}
                hostId={status?.hostId ?? null}
                defaultHarnessId={defaultHarnessId}
                launchDefaults={harnessDefaults}
                newTerminalShortcut={tabCreateMenuChord(
                  "tab.newTerminal",
                  chordPlatform,
                )}
                newBrowserShortcut={tabCreateMenuChord(
                  "tab.newBrowser",
                  chordPlatform,
                )}
                closeDisabled={busy || loadingSessions || !status}
                retryDisabled={retryAffordanceDisabled({
                  refreshInFlight: busy,
                })}
                createDisabled={
                  !selected || !status || busy || loadingSessions
                }
                stripOrder={tabStrip.order}
                pinnedIds={tabStrip.pinned}
                customTitles={tabStrip.titles}
                onOrderChange={changeTabOrder}
                onTogglePin={toggleTabPin}
                onCloseOthers={(id) => closeStripTabs(id, "others")}
                onCloseToRight={(id) => closeStripTabs(id, "to-right")}
                onCloseToLeft={(id) => closeStripTabs(id, "to-left")}
                onCommitTitle={commitTabTitle}
                onCopyText={copyStripText}
                workspacePath={current?.path ?? null}
                onDuplicateBrowserTab={(url) => void openPortBrowserTab(url)}
                terminalSplits={tabStrip.splits ?? {}}
                onSplitTerminal={(id) => void splitTerminalRight(id)}
                onSelectSession={selectSessionTab}
                onSelectBrowserTab={selectBrowserTab}
                onSelectEditorTab={selectEditorTab}
                mentuOpen={mentuTabOpen}
                mentuActive={mentuTabActive}
                onSelectMentu={openMentuTab}
                onCloseMentu={closeMentuTab}
                onCloseSession={(item) => void closeTabSession(item)}
                onCloseBrowserTab={(tabId) => void closeBrowserTab(tabId)}
                onCloseEditorTab={closeEditorTab}
                onRetrySession={retrySession}
                onCreateTerminal={() => void create()}
                onLaunchHarness={launchHarness}
                onNewBrowserTab={() => void newBrowserTab()}
                onOpenMentu={openMentuTab}
                mentuAvailable={mentuAvailable}
                onOpenAgentSettings={() => openSettings("agents")}
                onNewMarkdown={() => void createNewMarkdownTab()}
              />
              {activeBotMeta &&
              terminal &&
              !activeBrowserTab &&
              !activeEditorTab &&
              !mentuTabActive ? (
                <BotSessionHeader
                  meta={activeBotMeta}
                  session={terminal}
                  workspacePath={
                    workspaces.find((item) => item.id === activeBotMeta.workspaceId)
                      ?.path ?? null
                  }
                  onStop={() => void stopActiveBotSession()}
                  stopping={stoppingBotSession}
                  onOpenBots={() => setRoute(BOTS_ROUTE_ID)}
                />
              ) : null}
              <div
                id="active-session-panel"
                role="tabpanel"
                aria-labelledby={
                  terminal ? `session-tab-${terminal.id}` : undefined
                }
                className="active-session-panel"
                aria-busy={loadingSessions}
                style={{
                  display:
                    activeBrowserTab || activeEditorTab || mentuTabActive
                      ? "none"
                      : undefined,
                }}
              >
                {terminal && status ? (
                  <TerminalSplitHost
                    rootId={terminal.id}
                    split={splitForTab(liveSplits, terminal.id)}
                    panes={(() => {
                      const split = splitForTab(liveSplits, terminal.id);
                      const second = split
                        ? sessionById.get(split.panes[1])
                        : undefined;
                      return second
                        ? ([terminal, second] as const)
                        : ([terminal] as const);
                    })()}
                    revision={revision}
                    fontSize={terminalFontSize}
                    gpuMode={terminalGpuAcceleration}
                    canSplit={Boolean(
                      selected && status && !busy && !loadingSessions,
                    )}
                    onError={setError}
                    onSession={(value) =>
                      setSessions((items) =>
                        updateSessionProjection(items, value),
                      )
                    }
                    onSplitRight={(paneId) => void splitTerminalRight(paneId)}
                    onClosePane={(paneId) => {
                      const listed = sessionById.get(paneId) ??
                        sessionsRef.current.find((item) => item.id === paneId);
                      if (listed) void closeSplitPane(listed);
                    }}
                    onFocusPane={(paneId) => {
                      const split = splitForTab(liveSplits, terminal.id);
                      if (!split || split.activePaneId === paneId) return;
                      writeSplits(
                        activateSplitPane(liveSplits, terminal.id, paneId),
                      );
                    }}
                    onResize={(first) => {
                      if (!splitForTab(liveSplits, terminal.id)) return;
                      writeSplits(
                        resizeTerminalSplit(liveSplits, terminal.id, first),
                      );
                    }}
                  />
                ) : (
                  <div className="empty-state">
                    <TerminalSquare size={32} />
                    <h1>
                      {status
                        ? current
                          ? "Start a session"
                          : "A place for your next task"
                        : "Connect to Drogon"}
                    </h1>
                    <p>
                      {status
                        ? current
                          ? "Open a terminal in this workspace. Your sessions stay with the service when this window closes."
                          : "Choose a folder or repository. No Git setup is required."
                        : "Start the Drogon service, then retry the connection. Your existing work is unchanged."}
                    </p>
                    {status ? (
                      <Button
                        disabled={busy || loadingSessions}
                        onClick={() =>
                          current
                            ? void create()
                            : requestCreateWorkspace()
                        }
                      >
                        {current ? "New terminal" : "Create workspace"}
                      </Button>
                    ) : (
                      <Button disabled={busy} onClick={() => void refresh()}>
                        Retry connection
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div
                id="browser-tab-panel"
                role="tabpanel"
                aria-labelledby={
                  activeBrowserTab
                    ? `browser-tab-${activeBrowserTab.tabId}`
                    : undefined
                }
                className="active-session-panel"
                style={{
                  display: activeBrowserTab ? undefined : "none",
                }}
              >
                {browserAlive && current ? (
                  // Why: .browser-pane was built for a full-width column
                  // host; in the tab area it needs an explicit fill wrapper
                  // or the row flex container shrink-to-fits it.
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <BrowserPanel
                      bridge={browserStaticBridge}
                      workspaceId={current.id}
                      hideTabStrip
                      controlledTabId={activeBrowserTabId}
                    />
                  </div>
                ) : null}
              </div>
              <div
                id="editor-tab-panel"
                role="tabpanel"
                aria-labelledby={
                  activeEditorTab ? `editor-tab-${activeEditorTab.tabId}` : undefined
                }
                className="active-session-panel"
                style={{
                  display: activeEditorTab ? undefined : "none",
                }}
              >
                {editorHostAlive && current && status ? (
                  activeEditorTab?.diff ? (
                    // R16-BJ (#294, fork openDiff): a Source Control row's
                    // diff renders as the tab area surface — read-only
                    // Monaco diff under the fork's diff-surface header.
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                      <EditorDiffHost
                        scope={{ hostId: status.hostId, workspaceId: current.id }}
                        path={activeEditorTab.path}
                        area={activeEditorTab.diff}
                        onClose={() =>
                          activeEditorTabId && closeEditorTab(activeEditorTabId)
                        }
                      />
                    </div>
                  ) : (
                    // Full-width Monaco in the main pane (fixes #133): the
                    // fill wrapper mirrors the browser pane above — the
                    // host was built for a full-width column, not this row.
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                      <EditorHost
                        bridge={filesGatedBridge}
                        scope={{ hostId: status.hostId, workspaceId: current.id }}
                        path={activeEditorTab?.path ?? null}
                        missing={activeEditorTab?.missing}
                        initialView={activeEditorTab?.view}
                        onViewModeChange={(view) => {
                          if (activeEditorTabId)
                            setEditorTabView(activeEditorTabId, view);
                        }}
                        onClose={() =>
                          activeEditorTabId && closeEditorTab(activeEditorTabId)
                        }
                        onDirtyChange={(_path, dirty) => {
                          if (activeEditorTabId)
                            setEditorTabDirty(activeEditorTabId, dirty);
                        }}
                      />
                    </div>
                  )
                ) : null}
              </div>
              {/* Mentu as a tab (fixes the reported bug): the tab area
                  renders the WORK GRAPH — the tab's content the owner
                  replaced (the recipe surface stays in the right-sidebar
                  Mentu panel). The graph reads <workspace>/.drogon/graph.json
                  through the files bridge: `intent` is the human's plan,
                  `state` is what the daemon observed, and the pane is
                  strictly read-only. The tab strip stays mounted and keeps
                  its membership exactly like the browser and editor panes.
                  Why overflow-hidden: the surface must never paint outside
                  this column — an overflowing child used to slide beneath
                  the right sidebar, whose rows then intercepted the clicks
                  aimed at the hidden controls (Evidence sub-tab). */}
              <div
                id="mentu-tab-panel"
                role="tabpanel"
                aria-labelledby={mentuTabActive ? "mentu-tab" : undefined}
                className="active-session-panel overflow-hidden"
                data-testid="mentu-tab-panel"
                style={{
                  display: mentuTabActive ? undefined : "none",
                }}
              >
                {mentuAlive && current ? (
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <WorkGraphPane
                      fileBridge={filesGatedBridge}
                      hostId={status?.hostId ?? null}
                      workspaceId={current.id}
                    />
                  </div>
                ) : null}
              </div>
            </section>
            {tasksAlive && status ? (
              // No aria-label: an unnamed section is generic (invisible to
              // the accessibility tree), so the page owns its landmarks
              // exactly like the fork — no `region Tasks` wrapper.
              <section
                ref={tasksSectionRef}
                tabIndex={-1}
                className="terminal-column"
                data-testid={TASKS_PAGE_HOST_TESTID}
                style={{
                  display: route === TASKS_ROUTE_ID ? undefined : "none",
                }}
              >
                {filesProps ? (
                  <MountedPanel
                    descriptor={resolveRoute(tasksRegistry, TASKS_ROUTE_ID)}
                    workspace={filesProps.workspace}
                    status={filesProps.status}
                  />
                ) : (
                  // No workspace selected yet (the first task creates the
                  // first worktree): the registered descriptor's component
                  // is project-scoped and ignores panel props, so render
                  // the same page directly instead of inventing a workspace.
                  <TasksPage
                    bridge={tasksGatedBridge}
                    loadGroups={loadTaskGroups}
                    onOpenTerminal={(workspaceId) => {
                      void openTaskTerminal(workspaceId);
                    }}
                    onClose={goBackViewHistory}
                  />
                )}
              </section>
            ) : null}
            {botsAlive || route === BOTS_ROUTE_ID ? (
              // No aria-label (see the Tasks host above): the Bots page
              // root is already `<main>`, so any label here would nest
              // `region Bots` around it — the double wrap from #128.
              <section
                ref={botsSectionRef}
                tabIndex={-1}
                className="terminal-column"
                data-testid={BOTS_PAGE_HOST_TESTID}
                style={{
                  display: route === BOTS_ROUTE_ID ? undefined : "none",
                }}
              >
                {!botsAvailable ? (
                  <div className="empty-state">
                    <ServiceCapabilityNotice feature="Bots" connected={status !== null} />
                  </div>
                ) : botsDescriptor && filesProps ? (
                  <MountedPanel
                    descriptor={botsDescriptor}
                    workspace={filesProps.workspace}
                    status={filesProps.status}
                  />
                ) : botsDescriptor ? (
                  // #348: no workspace yet (app-global snapshot scope): the
                  // Bots descriptor consumes none of the host props, so its
                  // component mounts over null host props — MountedPanel's
                  // contract requires a real workspace/status pair, and the
                  // Bots descriptor defines no focus/cleanup hooks, so
                  // skipping its MountedPanel effect is behaviorally
                  // identical.
                  botsDescriptor.component({
                    routeId: botsDescriptor.id,
                    session: null,
                    workspace: null,
                    status: null,
                    focusTarget: null,
                  } as unknown as Parameters<
                    typeof botsDescriptor.component
                  >[0])
                ) : (
                  <div className="empty-state" role="status">
                    {(() => {
                      const fresh =
                        botsLoad && botsScopeEquals(botsLoad.scope)
                          ? botsLoad
                          : null;
                      if (fresh === null) return <p>Loading bots…</p>;
                      if (fresh.status === "too_large")
                        return (
                          <>
                            <p>
                              Bots snapshot too large: {fresh.message} Narrow
                              the workspace scope and retry.
                            </p>
                            <Button
                              disabled={busy}
                              onClick={() => setBotsReload((tick) => tick + 1)}
                            >
                              Retry
                            </Button>
                          </>
                        );
                      if (fresh.status === "error")
                        return (
                          <>
                            <p>Bots unavailable: {fresh.message}</p>
                            <Button
                              disabled={busy}
                              onClick={() => setBotsReload((tick) => tick + 1)}
                            >
                              Retry
                            </Button>
                          </>
                        );
                      return <p>Loading bots…</p>;
                    })()}
                  </div>
                )}
              </section>
            ) : null}
            {meetingsAlive || route === MEETINGS_ROUTE_ID ? (
              // No aria-label (see the Tasks host above): the Meetings page
              // root is already `<main>`.
              <section
                ref={meetingsSectionRef}
                tabIndex={-1}
                className="terminal-column"
                data-testid={MEETINGS_PAGE_HOST_TESTID}
                style={{
                  display: route === MEETINGS_ROUTE_ID ? undefined : "none",
                }}
              >
                {!meetingsAvailable ? (
                  <div className="empty-state">
                    <ServiceCapabilityNotice
                      feature="Meetings"
                      connected={status !== null}
                    />
                  </div>
                ) : (
                  <MeetingsPage
                    bridge={meetingsGatedBridge}
                    onClose={() => closePageRoute(MEETINGS_ROUTE_ID)}
                  />
                )}
              </section>
            ) : null}
            {automationsAlive && filesProps ? (
              // No aria-label (see the Tasks host above): the Automations
              // surface already renders the fork's `<main>`.
              <section
                ref={automationsSectionRef}
                tabIndex={-1}
                className="terminal-column"
                data-testid={AUTOMATIONS_PAGE_HOST_TESTID}
                style={{
                  display: route === AUTOMATIONS_ROUTE_ID ? undefined : "none",
                }}
              >
                <MountedPanel
                  descriptor={resolveRoute(
                    filesBaseRegistry,
                    AUTOMATIONS_ROUTE_ID,
                  )}
                  workspace={filesProps.workspace}
                  status={filesProps.status}
                />
              </section>
            ) : null}
            <RightSidebar
              open={rightSidebarOpen}
              hidden={fullPageActive}
              width={renderedRightWidth}
              onWidthChange={changeRightSidebarWidth}
              items={rightItems}
              effectiveTab={rightEffective}
              onSelectTab={selectRightTab}
              onToggle={toggleRightSidebar}
              toggleShortcutLabel={formatSidebarChord(
                SIDEBAR_RIGHT_TOGGLE_CHORD,
                chordPlatform,
              )}
              panels={{
                ...(filesAlive && filesProps
                  ? {
                      explorer: (
                        <section
                          ref={filesSectionRef}
                          tabIndex={-1}
                          className="right-sidebar-panel"
                          aria-label="Files"
                        >
                          <MountedPanel
                            descriptor={resolveRoute(
                              filesBaseRegistry,
                              FILES_ROUTE_ID,
                            )}
                            workspace={filesProps.workspace}
                            status={filesProps.status}
                          />
                        </section>
                      ),
                    }
                  : null),
                ...(changesAlive && filesProps
                  ? {
                      "source-control": (
                        <section
                          ref={changesSectionRef}
                          tabIndex={-1}
                          className="right-sidebar-panel"
                          aria-label="Changes"
                        >
                          <MountedPanel
                            descriptor={resolveRoute(
                              filesBaseRegistry,
                              CHANGES_ROUTE_ID,
                            )}
                            workspace={filesProps.workspace}
                            status={filesProps.status}
                          />
                        </section>
                      ),
                    }
                  : null),
                ...(mentuPanelAlive && filesProps
                  ? {
                      mentu: (
                        <section
                          ref={mentuPanelSectionRef}
                          tabIndex={-1}
                          className="right-sidebar-panel"
                          aria-label="Mentu"
                        >
                          <MentuPanel
                            bridge={mentuGatedBridge}
                            workspaceId={filesProps.workspace.id}
                            variant="panel"
                            fileBridge={filesGatedBridge}
                            hostId={filesProps.status?.hostId ?? null}
                            workspacePath={filesProps.workspace.path}
                            dispatchContext={mentuDispatchContext}
                          />
                        </section>
                      ),
                    }
                  : null),
                ...(filesProps
                  ? {
                      ports: (
                        <section
                          ref={portsSectionRef}
                          tabIndex={-1}
                          className="right-sidebar-panel"
                          aria-label="Ports"
                        >
                          <PortsPanel
                            isVisible={
                              rightSidebarOpen && rightEffective === "ports"
                            }
                            workspace={filesProps.workspace}
                            onOpenInBrowserTab={openPortBrowserTab}
                          />
                        </section>
                      ),
                    }
                  : null),
                session: (
                  <section
                    ref={sessionSectionRef}
                    tabIndex={-1}
                    className="right-sidebar-panel"
                  >
                    {activeBotMeta && terminal ? (
                      <BotSessionInspector
                        meta={activeBotMeta}
                        session={terminal}
                        workspacePath={
                          workspaces.find(
                            (item) => item.id === activeBotMeta.workspaceId,
                          )?.path ?? null
                        }
                        processId={
                          botSessionPid?.sessionId === terminal.id
                            ? botSessionPid.processId
                            : null
                        }
                        nowMs={botSessionClockMs}
                      />
                    ) : (
                      <SessionDetailsPanel terminal={terminal ?? null} />
                    )}
                  </section>
                ),
              }}
            />
          </div>
            </>
          )}
        </div>
        </div>
      </div>
      <CommandPaletteHost
        fileBridge={filesGatedBridge}
        hostId={status?.hostId ?? null}
        workspaceId={selected}
        workspaces={workspaces}
        sessions={sessions}
        activeSessionId={active}
        editorTabs={visibleEditorTabs}
        activeEditorTabId={activeEditorTabId}
        projectGroups={projectGroups}
        browserTabs={browserTabs}
        activeBrowserTabId={activeBrowserTabId}
        filesAvailable={isFilesAvailable(liveCapabilities)}
        botsAvailable={isBotsAvailable(liveCapabilities)}
        changesAvailable={isChangesAvailable(liveCapabilities)}
        harnessAvailable={harnessCapability}
        worktreesAvailable={isWorktreesAvailable(liveCapabilities)}
        canCreateWorktree={newWorktreeTarget() !== null}
        onNewWorktree={openComposerForNewWorktree}
        theme={theme}
        connected={status !== null}
        busy={busy}
        onNewTerminal={() => void create()}
        onNewBrowserTab={() => void newBrowserTab()}
        onSelectWorkspace={selectWorkspaceId}
        onSelectSession={selectSessionTab}
        onSelectEditorTab={selectEditorTab}
        onSelectBrowserTab={selectBrowserTab}
        onOpenFiles={() => showRightExplorer()}
        onOpenBots={() => setRoute(BOTS_ROUTE_ID)}
        onToggleRightSidebar={toggleRightSidebar}
        onToggleSidebar={toggleSidebar}
        onShowExplorer={showRightExplorer}
        onShowSourceControl={showRightSourceControl}
        onToggleInspector={toggleSessionPanel}
        onOpenSettings={() => openSettings()}
        onSetTheme={changeTheme}
        onAddWorkspace={() => requestCreateWorkspace()}
        onAddProject={requestAddProject}
        onOpenFile={openFileInFiles}
      />
      {newSessionOpen && <NewSessionDialog
        harnesses={harnesses}
        defaultHarnessId={defaultHarnessId}
        onClose={() => setNewSessionOpen(false)}
        onCreate={(name, harnessId) => createComposerQuickSession({
          name,
          agent: { harnessId, model: "", provider: "" },
        })}
      />}
      {composer && (
        <NewWorkspaceComposerModal
          groups={projectGroups.filter((group) => !group.project.quickSession)}
          workspaces={workspaces}
          initialProjectId={composer.initialProjectId}
          disabled={busy}
          harnesses={harnesses}
          defaultHarnessId={defaultHarnessId}
          harnessDefaults={harnessDefaults}
          onSubmitWorktree={submitWorktree}
          onCreateQuickSession={createComposerQuickSession}
          onLaunchAgent={async (launch) => {
            let session: Session;
            try {
              const result = await startHarnessTracked(launch);
              if (!result.ok) return result.error.message;
              session = result.result;
            } catch {
              return "Could not start the agent. Retry the connection.";
            }
            setSessions((items) => appendOrReplaceSession(items, session));
            setActive(session.id);
            return null;
          }}
          onSelectWorkspace={selectWorkspaceId}
          onAddProject={() => {
            setComposer(null);
            requestAddProject();
          }}
          onOpenAgentSettings={() => {
            setComposer(null);
            openSettings("agents");
          }}
          onSetDefaultAgent={(next) =>
            changeDefaultHarness(next === "blank" ? "" : next)
          }
          onClose={() => setComposer(null)}
        />
      )}
      {appearanceFlags.statusBarVisible ? (
        <StatusBar
          terminalCount={sessions.length}
          // R16-AY2 segment click targets: settings/preselect via the existing
          // openSettings(section) hook; ports opens the right-sidebar Ports
          // panel, this repo's matching surface for the fork's ports popover.
          onOpenSettings={openSettings}
          onOpenPorts={() => openRightSidebarOn("ports")}
        />
      ) : null}
      <Toaster closeButton toastOptions={{ className: "font-sans text-sm" }} />
    </Tooltip.Provider>
  );
}
