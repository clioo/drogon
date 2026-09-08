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
import type {
  AgentState,
  Harness,
  HarnessLaunchInput,
  Project,
  Result,
  Session,
  Status,
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
import {
  bulkCloseTargets,
  loadTabStripState,
  partitionPinnedOrder,
  reconcileTabOrder,
  saveTabStripState,
  togglePinnedOrder,
  type TabStripState,
} from "./features/shell/tab-order";
import { NewWorkspaceComposerModal } from "./features/new-workspace/NewWorkspaceComposerModal";
import { TabBar } from "./features/shell/TabBar";
import { TitlebarLeftControls } from "./features/shell/TitlebarLeftControls";
import { RightSidebar } from "./features/right-sidebar/RightSidebar";
import { SessionDetailsPanel } from "./features/right-sidebar/SessionDetailsPanel";
import {
  buildRightSidebarActivityItems,
  getVisibleRightSidebarActivityItems,
  SIDEBAR_PORTS_TOGGLE_CHORD,
} from "./features/right-sidebar/activity-bar-items";
import { PortsPanel } from "./features/ports/PortsPanel";
import {
  loadRightSidebarTab,
  normalizeRightSidebarTab,
  resolveRightSidebarEffectiveTab,
  saveRightSidebarTab,
  type RightSidebarTab,
} from "./features/right-sidebar/right-sidebar-route";
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
  TAB_NEW_TERMINAL_CHORD,
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
} from "./features/shell/view-history";
import { isFullPageRoute } from "./features/shell/page-host";
import {
  loadSidebarOpen,
  loadSidebarWidth,
  saveSidebarOpen,
  saveSidebarWidth,
} from "./features/shell/sidebar-width";
import { Landing } from "./features/landing/Landing";
import {
  findWorkspaceForPath,
  gitProjectForWorkspace,
  isProjectsAvailable,
  isWorktreesAvailable,
  loadProjectView,
  useProjectRegistryRefresh,
  windowProjectBridge,
} from "./features/shell/project-adapter";
import type { ProjectGroup } from "./features/shell/project-adapter";
import type { ProjectAction } from "./features/shell/ProjectList";
import type { FileOpenRequestCell } from "./features/workspaces/files-panel";
import { openCommandPalette } from "./features/shell/open-palette";
import { CommandPaletteHost } from "./components/command-palette";
import { supportsHarnessLaunch } from "./harness-capability";
import { projectTerminalRestartLaunch } from "./features/terminal/terminal-restart-launch";
import {
  TERMINAL_CLEAR_EVENT,
  TERMINAL_CLOSE_EVENT,
  TERMINAL_FILE_OPEN_EVENT,
  TERMINAL_RESTART_EVENT,
  TerminalPane,
  type TerminalCloseDetail,
  type TerminalFileOpenDetail,
  type TerminalRestartDetail,
} from "./features/terminal/TerminalPane";
import { isExternalUrlAllowed } from "../../shared/shell-contract";
import type { ShellBridge } from "../../shared/shell-contract";
import { updateSessionProjection } from "./session-projection";
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
import { windowBrowserBridge } from "./features/browser/browser-bridge";
import type { BrowserTabState } from "../../shared/browser-contract";
import { BrowserPanel } from "./features/browser/browser-panel";
import {
  AUTOMATIONS_CAPABILITY,
  AUTOMATIONS_ROUTE_ID,
  createGatedAutomationBridge,
  isAutomationsAvailable,
  registerAutomationsRoute,
} from "./automations-mount";
import {
  TASKS_CAPABILITY,
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
import { refreshWorktreeIssueLinks } from "./features/tasks/issue-links";
import { TasksPage } from "./features/tasks/TasksPage";
import { loadBotSnapshot } from "./bots-loader";
import type { BotsLoadResult } from "./bots-loader";
import { FILES_CAPABILITY } from "../../shared/file-contract";
import {
  applyPanelFocus,
  checkAvailability,
  createRouteRegistry,
  releasePanel,
  resolveRoute,
} from "./route-panel-contract";
import type { PanelDescriptor } from "./route-panel-contract";
import {
  contextFromTarget,
  createKeybindingRegistry,
  getKeybindingDefinition,
  isEditableTarget,
  isPaletteOpen,
  resolveKeybindingPlatform,
  shouldDispatch,
} from "../../shared/keybindings";
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
  recoveryActionFor,
  recoveryTabLabel,
  retryAffordanceDisabled,
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
 * (which applies its default), this distinguishes "nothing saved yet" so the
 * viewport can decide the initial value.
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [inspector, setInspector] = useState(() =>
    resolveInspectorDefault(
      matchMedia("(min-width: 1101px)").matches,
      savedInspectorValue(),
    ),
  );
  const [theme, setTheme] = useState<Theme>(() => settings.get("theme"));
  const [terminalFontSize, setTerminalFontSize] = useState(
    () => settings.get("terminalFontSize"),
  );
  const [terminalGpuAcceleration, setTerminalGpuAcceleration] = useState(
    () => settings.get("terminalGpuAcceleration"),
  );
  const [defaultHarnessId, setDefaultHarnessId] = useState(
    () => settings.get("defaultHarnessId"),
  );
  const [harnessDefaults, setHarnessDefaults] = useState(
    () => settings.get("harnessDefaults"),
  );
  const [notifyOnAgentNeedsInput, setNotifyOnAgentNeedsInput] = useState(
    () => settings.get("notifyOnAgentNeedsInput"),
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
  const [harnesses, setHarnesses] = useState<Harness[]>([]);
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
  const terminal = sessions.find((item) => item.id === active);
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
  // A saved open choice wins; otherwise the open default follows the
  // inspector default for the viewport, preserving the pre-sidebar
  // first-run layout for existing users.
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() =>
    loadRightSidebarWidth(window.localStorage),
  );
  const [rightSidebarOpen, setRightSidebarOpen] = useState(
    () =>
      loadRightSidebarOpen(window.localStorage) ??
      resolveInspectorDefault(
        matchMedia("(min-width: 1101px)").matches,
        savedInspectorValue(),
      ),
  );
  const [rightSidebarTab, setRightSidebarTab] = useState<RightSidebarTab>(
    () => loadRightSidebarTab(window.localStorage) ?? "explorer",
  );
  // First mount needs explicit user routing per panel (activity bar,
  // palette, or chord); a persisted tab counts as prior routing for that
  // panel. Never auto-mounts unopened panels.
  const filesRoutedRef = useRef(
    loadRightSidebarTab(window.localStorage) === "explorer",
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
  // R12-D tab strip: order, pins and renames persist per workspace in the
  // shell's own localStorage envelope (tab-order.ts), like the sidebar keys.
  const [tabStrip, setTabStrip] = useState<TabStripState>(() =>
    loadTabStripState(window.localStorage, selected),
  );
  useEffect(() => {
    setTabStrip(loadTabStripState(window.localStorage, selected));
  }, [selected]);
  const updateTabStrip = (next: TabStripState) => {
    setTabStrip(next);
    saveTabStripState(window.localStorage, selected, next);
  };
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
  useEffect(() => {
    filesGateRef.current = isFilesAvailable(liveCapabilities);
    gitGateRef.current = isChangesAvailable(liveCapabilities);
    tasksGateRef.current = isTasksAvailable(liveCapabilities);
    botsGateRef.current = isBotsAvailable(liveCapabilities);
    automationsGateRef.current = isAutomationsAvailable(liveCapabilities);
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
  // stale snapshot ever shows for another workspace/host. No run control:
  // the panel is read-only until the BotRun bridge lands.
  const botsScope =
    current && status
      ? {
          hostId: status.hostId,
          workspaceId: current.id,
          locale: settings.get("locale"),
        }
      : null;
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
      if (route !== BOTS_ROUTE_ID || !botsAvailable || !botsScope) return;
      // Clear the previous result first: the UI shows in-progress instead
      // of a stale error while the fresh request is pending.
      setBotsLoad(null);
      const result = await loadBotSnapshot(botsGatedBridge, botsScope);
      if (!cancelled) setBotsLoad(result);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    route,
    botsAvailable,
    botsScopeHost,
    botsScopeWorkspace,
    botsScopeLocale,
    botsReload,
  ]);
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
  const panelRegistry = useMemo(() => {
    if (botsLoad?.status === "loaded" && botsScopeEquals(botsLoad.scope))
      return registerBotsRoute(filesBaseRegistry, botsGatedBridge, {
        ...buildBotsPanelProps(botsLoad.snapshot, undefined, botsScope),
        onClose: () => botsCloseRef.current(),
      });
    return filesBaseRegistry;
  }, [
    filesBaseRegistry,
    botsGatedBridge,
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
  const automationsSectionRef = useRef<HTMLElement>(null);
  const mentuSectionRef = useRef<HTMLElement>(null);
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
          : route === MENTU_ROUTE_ID
            ? mentuSectionRef.current
            : route === TASKS_ROUTE_ID
              ? tasksSectionRef.current
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
  // Bots keep-alive mirrors files: survives switches and transients,
  // unmounts on explicit withhold or settled workspace loss. The Bots
  // panel is read-only (no drafts), so remounts on snapshot refresh are
  // safe; scope mismatch never renders (no stale data).
  const botsExplicitWithhold =
    status !== null && !isBotsAvailable(liveCapabilities);
  const botsAliveRef = useRef(false);
  if (route === BOTS_ROUTE_ID && botsAvailable && current)
    botsAliveRef.current = true;
  else if (
    botsExplicitWithhold ||
    (status && !current && !busy && !loadingSessions)
  )
    botsAliveRef.current = false;
  const botsAlive = botsAliveRef.current;
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
    knownBrowserIds.current = new Set();
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
  // Mentu keep-alive mirrors Automations: survives switches and
  // transients, unmounts on explicit withhold or settled workspace loss.
  const mentuAvailable = isMentuAvailable(liveCapabilities);
  const mentuExplicitWithhold =
    status !== null && !isMentuAvailable(liveCapabilities);
  const mentuAliveRef = useRef(false);
  if (route === MENTU_ROUTE_ID && mentuAvailable && current)
    mentuAliveRef.current = true;
  else if (
    mentuExplicitWithhold ||
    (status && !current && !busy && !loadingSessions)
  )
    mentuAliveRef.current = false;
  const mentuAlive = mentuAliveRef.current;
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
  const botsScopeMatch =
    botsLoad?.status === "loaded" && botsScopeEquals(botsLoad.scope);
  const botsDescriptor: PanelDescriptor | null =
    botsAlive && filesProps && botsScopeMatch
      ? resolveRoute(panelRegistry, BOTS_ROUTE_ID)
      : null;
  // Full pages replace the session view, like the fork's ActivePage: no
  // session header above them, no terminal column or right sidebar beside
  // them — only the page's own chrome. The conditions mirror the mounts
  // below, so a routed-but-unavailable page falls back to the session
  // view instead of rendering an empty page. Back/Close return through
  // the view history, which restores the previous session entry.
  const botsPageActive =
    route === BOTS_ROUTE_ID && botsAlive && filesProps !== null;
  const automationsPageActive =
    route === AUTOMATIONS_ROUTE_ID && automationsAlive && filesProps !== null;
  const tasksPageActive = route === TASKS_ROUTE_ID && tasksAlive;
  const fullPageActive =
    isFullPageRoute(route) &&
    (botsPageActive || automationsPageActive || tasksPageActive);
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
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // Issue #146: re-read the project view when another process moves the registry.
  useProjectRegistryRefresh(setProjectReloadTick);
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
    const wide = matchMedia("(min-width: 1101px)");
    const adapt = () => {
      // Mirrors the old inspector guard: a shrink hides the session panel
      // without persisting, so an accidental shrink never becomes a saved
      // "closed" choice.
      if (!wide.matches && rightEffective === "session")
        setRightSidebarOpen(false);
    };
    wide.addEventListener("change", adapt);
    return () => wide.removeEventListener("change", adapt);
  }, [rightEffective]);
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
      setSelected(event.workspaceId);
      setActive(event.sessionId);
      setRevision((value) => value + 1);
    });
    const offState = bridge.onStateChanged((event) => {
      if (!known.includes(event.agentState as AgentState)) return;
      if (event.workspaceId !== contextRef.current.workspaceId) return;
      const existing = sessionsRef.current.find(
        (item) => item.id === event.sessionId,
      );
      if (!existing) {
        // A session this window never listed (started elsewhere): reload
        // once so it appears with its live state.
        setRevision((value) => value + 1);
        return;
      }
      if (
        (existing.agentState ?? "unknown") === event.agentState &&
        (existing.agentStateAt ?? null) === (event.agentStateAt ?? null)
      )
        return;
      setSessions((items) =>
        items.map((item) =>
          item.id === event.sessionId
            ? {
                ...item,
                agentState: event.agentState as AgentState,
                agentStateAt: event.agentStateAt,
              }
            : item,
        ),
      );
    });
    return () => {
      offFocus();
      offState();
    };
  }, []);
  // Shared by sidebar worktree cards: re-clicking the already-active
  // workspace must not clear its visible live-session projection.
  const selectWorkspaceId = (id: string) => {
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
  botsCloseRef.current = goBackViewHistory;
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
  const submitWorktree = async (input: {
    projectId: string;
    name: string;
    baseRef?: string;
  }): Promise<string | null> => {
    const bridge = windowProjectBridge(window.drogon);
    if (typeof bridge.worktreeCreate !== "function")
      return "Worktrees unavailable: service does not advertise worktree.v1";
    let workspaceId: string;
    try {
      const result = await bridge.worktreeCreate(input);
      if (!result.ok) return result.error.message;
      workspaceId = result.result.workspaceId;
    } catch {
      return "Could not create the worktree. Retry the connection.";
    }
    setProjectAction(null);
    setComposer(null);
    await refresh();
    selectWorkspaceId(workspaceId);
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
  // Quick-open reveal: records the request for the Files panel and opens
  // the sidebar there. The panel applies it when its workspace matches
  // (see FileOpenRequestCell); the tick re-renders even when already open.
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
  };
  const create = () =>
    action(async () => {
      const captured = contextRef.current;
      const result = checked(await window.drogon.start(captured.workspaceId));
      // A late reply for a host/workspace no longer current is skipped —
      // it's already covered by that workspace's next natural reload.
      if (!contextMatches(captured, contextRef.current)) return;
      setSessions((items) => appendOrReplaceSession(items, result));
      setActive(result.id);
    });
  // Browser pages share the tab strip with sessions: selecting a session
  // returns to the terminal pane, selecting a page shows the browser pane
  // for it (the pane reports bounds for the selection, activating it on
  // the host). Closing a page reconciles through the strip subscription.
  const selectSessionTab = (id: string) => {
    setActive(id);
    setActiveBrowserTabId(null);
  };
  const selectBrowserTab = (tabId: string) => {
    setActiveBrowserTabId(tabId);
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
        sessions.map((item) => item.id),
        browserTabs.map((tab) => tab.tabId),
      ),
      tabStrip.pinned,
    );
  const changeTabOrder = (order: string[]) =>
    updateTabStrip({ ...tabStrip, order });
  const toggleTabPin = (id: string) => {
    const order = reconcileTabOrder(
      tabStrip.order,
      sessions.map((item) => item.id),
      browserTabs.map((tab) => tab.tabId),
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
    const currentId = activeBrowserTabId ?? active;
    if (doomed.has(currentId)) {
      const at = order.indexOf(anchorId);
      const neighbor = [
        ...order.slice(at + 1),
        ...order.slice(0, at).reverse(),
      ].find((id) => !doomed.has(id));
      if (neighbor) {
        if (browserTabs.some((tab) => tab.tabId === neighbor))
          selectBrowserTab(neighbor);
        else selectSessionTab(neighbor);
      }
    }
    for (const target of targets) {
      const session = sessions.find((item) => item.id === target);
      if (session) void close(session);
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
      const result = checked(await window.drogon.startHarness(input));
      launched = true;
      if (!contextMatches(captured, contextRef.current)) return;
      setSessions((items) => appendOrReplaceSession(items, result));
      setActive(result.id);
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
  const changeDefaultHarness = (next: string) => {
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
  const close = (session: Session) =>
    action(async () => {
      const result = checked(
        await window.drogon.stop({
          sessionId: session.id,
          incarnation: session.incarnation,
        }),
      );
      // The service's own identity checks already reject a mismatched
      // reply at the IPC boundary; this is defense-in-depth so a confirmed
      // dismissal is never recorded against the wrong session if that
      // boundary were ever bypassed.
      if (
        result.id !== session.id ||
        result.incarnation !== session.incarnation ||
        result.hostId !== session.hostId
      )
        throw new Error("The service's response was not for this session.");
      if (result.verdict !== "exited")
        throw new Error("Session exit is not confirmed. The tab remains open.");
      // Only an explicit, confirmed close hides the tab going forward — a
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
      // Line/column ride the event but the cell carries path only — the
      // editor has no cursor addressing yet (files-panel owner follow-up).
      fileOpenNonce.current += 1;
      fileOpenCell.current = {
        workspaceId,
        path: detail.path,
        nonce: fileOpenNonce.current,
      };
      setFileOpenTick((tick) => tick + 1);
      showRightExplorer();
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
      const launch = projectTerminalRestartLaunch(prior, detail.workspaceId);
      void action(async () => {
        const captured = {
          hostId: contextRef.current.hostId,
          workspaceId: launch.workspaceId,
        };
        const result = checked(
          launch.kind === "harness"
            ? await window.drogon.startHarness({
                workspaceId: launch.workspaceId,
                harnessId: launch.harnessId,
                permissionMode: "inherit",
                requestId: crypto.randomUUID(),
              })
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
        setSessions((items) => appendOrReplaceSession(items, result));
        setActive(result.id);
      });
    };
    const onClose = (event: Event) => {
      const detail = (event as CustomEvent<TerminalCloseDetail>).detail;
      if (!detail || typeof detail.sessionId !== "string") return;
      // The tab's own close path (same confirmation policy): only the
      // exact listed session is confirmed-stopped and dismissed. A stale
      // event for a tab that is already gone is a no-op, never a blind
      // stop.
      const listed = sessionsRef.current.find(
        (item) =>
          item.id === detail.sessionId &&
          item.workspaceId === detail.workspaceId,
      );
      if (!listed) return;
      void close(listed);
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
    // Mentu panel "Open full tab" (R11-D): the panel dispatches a window
    // event because App owns routing; setRoute is a stable state setter.
    const onOpenMentuTab = () => setRoute(MENTU_ROUTE_ID);
    window.addEventListener(MENTU_OPEN_TAB_EVENT, onOpenMentuTab);
    return () =>
      window.removeEventListener(MENTU_OPEN_TAB_EVENT, onOpenMentuTab);
  }, []);
  useEffect(() => {
    // Source-parity window chords (keybindings/definitions.ts): one shared
    // table with the palette host, so a chord is claimed once per scope and
    // conflicts are impossible by construction. Ids the palette owns
    // (worktree.palette/quickOpen, tab travel) have no handler here.
    const uiPlatform = navigator.userAgent.includes("Mac")
      ? "darwin"
      : "other";
    const platform = resolveKeybindingPlatform(uiPlatform);
    const isDisabled = () => !selected || !status || busy || loadingSessions;
    const registry = createKeybindingRegistry();
    const stepWorkspace = (delta: 1 | -1) => {
      if (workspaces.length === 0) return;
      const at = workspaces.findIndex((item) => item.id === selected);
      const next =
        (at < 0 ? (delta < 0 ? 0 : -1) : at + delta + workspaces.length) %
        workspaces.length;
      setSelected(workspaces[next].id);
    };
    const selectWorkspaceAt = (index: number) => {
      const workspace = workspaces[index];
      if (workspace) setSelected(workspace.id);
    };
    const handlers: Record<string, (digit: number | null) => void> = {
      // Source id tab.newTerminal ("New terminal tab", Mod+T) replaces the
      // Drogon-only workspace.newTerminal on Mod+Shift+N; that chord is the
      // source's secondary workspace.create binding.
      "tab.newTerminal": guardHandler(() => void create(), isDisabled),
      // J10: Mod+, opens the Settings page from anywhere — never gated on
      // workspace, connection or busy state.
      "app.settings": () => openSettings(),
      "workspace.create": guardHandler(() => requestCreateWorkspace(), () => busy),
      "terminal.clear": () => {
        window.dispatchEvent(new CustomEvent(TERMINAL_CLEAR_EVENT));
      },
      "sidebar.left.toggle": toggleSidebar,
      // R6-B right sidebar (definitions-core-1.ts): Mod+L toggles the right
      // sidebar, Mod+Shift+E reveals Explorer, Mod+Shift+G reveals Source
      // Control (gated on git.v1, like the activity bar).
      "sidebar.right.toggle": toggleRightSidebar,
      "sidebar.explorer.toggle": showRightExplorer,
      "sidebar.sourceControl.toggle": guardHandler(
        showRightSourceControl,
        () => !gitPanelAvailable,
      ),
      // tab.newBrowser (definitions-core-2.ts): the strip's New Browser Tab.
      "tab.newBrowser": guardHandler(() => void newBrowserTab(), isDisabled),
      "worktree.history.back": guardHandler(goBackViewHistory, () =>
        !canGoBackView(viewHistory, liveWorkspaceIds),
      ),
      "worktree.history.forward": guardHandler(goForwardViewHistory, () =>
        !canGoForwardView(viewHistory, liveWorkspaceIds),
      ),
      "worktree.navigateUp": () => stepWorkspace(-1),
      "worktree.navigateDown": () => stepWorkspace(1),
      "workspace.selectByIndex": (digit) => {
        if (digit !== null) selectWorkspaceAt(digit);
      },
    };
    const keydown = (event: KeyboardEvent) => {
      const context = contextFromTarget(event.target);
      const editable = isEditableTarget(event.target);
      const match = registry.match(
        {
          key: event.key,
          altKey: event.altKey,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
        },
        platform,
        context,
        { editableTarget: editable },
      );
      if (!match) return;
      const handler = handlers[match.id];
      if (!handler) return;
      const scope =
        getKeybindingDefinition(match.id)?.scope ?? "global";
      if (
        !shouldDispatch({
          id: match.id,
          scope,
          paletteOpen: isPaletteOpen(),
          context,
          editableTarget: editable,
        })
      )
        return;
      // terminal.clear stays live without a workspace (clearing a visible
      // terminal is always safe); app.settings tunnels everywhere.
      if (match.id !== "app.settings" && match.id !== "terminal.clear" && isDisabled()) {
        // Window-level shell chords stay live without a workspace.
        if (
          match.id !== "workspace.create" &&
          match.id !== "sidebar.left.toggle" &&
          match.id !== "sidebar.right.toggle" &&
          match.id !== "sidebar.explorer.toggle" &&
          match.id !== "sidebar.sourceControl.toggle" &&
          match.id !== "worktree.history.back" &&
          match.id !== "worktree.history.forward" &&
          match.id !== "worktree.navigateUp" &&
          match.id !== "worktree.navigateDown" &&
          match.id !== "workspace.selectByIndex"
        )
          return;
        if (match.id === "workspace.create" && busy) return;
      }
      event.preventDefault();
      handler(match.digitIndex);
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
      // Source fallback for a focused text control (app-menu-paste.ts
      // performNativePaste); terminal-owned paste lands with the terminal
      // paste bridge, not here.
      document.execCommand("paste");
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
  // rides the same session list the sidebar cards use.
  useUnreadDockBadge(
    sessions.filter((session) => session.agentState === "needs_input").length,
  );
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
            sessions={sessions}
            selectedWorkspaceId={selected}
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
                  harnesses={harnesses}
                  defaultHarnessId={defaultHarnessId}
                  onDefaultHarnessChange={changeDefaultHarness}
                  harnessDefaults={harnessDefaults}
                  onHarnessDefaultChange={changeHarnessDefault}
                  notifyOnAgentNeedsInput={notifyOnAgentNeedsInput}
                  onNotifyChange={changeNotifyOnAgentNeedsInput}
                  workspacePath={current?.path ?? null}
                  initialSection={settingsInitialSection}
                  project={settingsProject}
                  onRemoveProject={removeProjectFromSettings}
                  onBack={closeSettings}
                />
              </section>
            </div>
          ) : workspaces.length === 0 ? (
            <Landing
              hasProjects={false}
              onAddProject={requestAddProject}
              onCreateWorkspace={() => requestCreateWorkspace()}
            />
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
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void refresh()}
              >
                Retry
              </Button>
            </div>
          )}
            </>
          )}
          <div className="session-layout">
            <section
              className="terminal-column"
              aria-label="Terminals"
              style={{
                display:
                  (route === BOTS_ROUTE_ID &&
                    botsAlive &&
                    filesProps !== null) ||
                  (route === AUTOMATIONS_ROUTE_ID &&
                    automationsAlive &&
                    filesProps !== null) ||
                  (route === MENTU_ROUTE_ID &&
                    mentuAlive &&
                    filesProps !== null) ||
                  (route === TASKS_ROUTE_ID && tasksAlive)
                    ? "none"
                    : undefined,
              }}
            >
              <TabBar
                sessions={sessions}
                activeSessionId={active}
                browserTabs={browserTabs}
                activeBrowserTabId={activeBrowserTabId}
                harnesses={harnesses}
                workspaceId={selected}
                hostId={status?.hostId ?? null}
                defaultHarnessId={defaultHarnessId}
                launchDefaults={harnessDefaults}
                newTerminalShortcut={formatSidebarChord(
                  TAB_NEW_TERMINAL_CHORD,
                  chordPlatform,
                )}
                newBrowserShortcut=""
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
                onSelectSession={selectSessionTab}
                onSelectBrowserTab={selectBrowserTab}
                onCloseSession={(item) => void close(item)}
                onCloseBrowserTab={(tabId) => void closeBrowserTab(tabId)}
                onRetry={() => void refresh()}
                onCreateTerminal={() => void create()}
                onLaunchHarness={launchHarness}
                onNewBrowserTab={() => void newBrowserTab()}
                onOpenMentu={() => setRoute(MENTU_ROUTE_ID)}
                mentuAvailable={mentuAvailable}
              />
              <div
                id="active-session-panel"
                role="tabpanel"
                aria-labelledby={
                  terminal ? `session-tab-${terminal.id}` : undefined
                }
                className="active-session-panel"
                aria-busy={loadingSessions}
                style={{
                  display: activeBrowserTab ? "none" : undefined,
                }}
              >
                {terminal &&
                  status &&
                  recoveryActionFor(terminal.verdict, {
                    exitExpected: false,
                  }).kind === "reveal-output+offer-new" && (
                    <div className="error-banner" role="status">
                      <span>
                        This session exited (exit{" "}
                        {terminal.exitCode ?? "unknown"}). Its output is kept
                        below.
                      </span>
                      <Button
                        size="sm"
                        disabled={busy || loadingSessions}
                        onClick={() =>
                          current
                            ? void create()
                            : requestCreateWorkspace()
                        }
                      >
                        New terminal
                      </Button>
                    </div>
                  )}
                {terminal && status ? (
                  <TerminalPane
                    key={`${terminal.id}:${revision}`}
                    session={terminal}
                    fontSize={terminalFontSize}
                    gpuMode={terminalGpuAcceleration}
                    onError={setError}
                    onSession={(value) =>
                      setSessions((items) =>
                        updateSessionProjection(items, value),
                      )
                    }
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
            </section>
            {tasksAlive && status ? (
              // No aria-label: an unnamed section is generic (invisible to
              // the accessibility tree), so the page owns its landmarks
              // exactly like the fork — no `region Tasks` wrapper.
              <section
                ref={tasksSectionRef}
                tabIndex={-1}
                className="terminal-column"
                data-testid="tasks-page-host"
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
            {botsAlive && filesProps ? (
              // No aria-label (see the Tasks host above): the Bots page
              // root is already `<main>`, so any label here would nest
              // `region Bots` around it — the double wrap from #128.
              <section
                ref={botsSectionRef}
                tabIndex={-1}
                className="terminal-column"
                data-testid="bots-page-host"
                style={{
                  display: route === BOTS_ROUTE_ID ? undefined : "none",
                }}
              >
                {botsDescriptor ? (
                  <MountedPanel
                    descriptor={botsDescriptor}
                    workspace={filesProps.workspace}
                    status={filesProps.status}
                  />
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
            {automationsAlive && filesProps ? (
              // No aria-label (see the Tasks host above): the Automations
              // surface already renders the fork's `<main>`.
              <section
                ref={automationsSectionRef}
                tabIndex={-1}
                className="terminal-column"
                data-testid="automations-page-host"
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
            {mentuAlive && filesProps ? (
              <section
                ref={mentuSectionRef}
                tabIndex={-1}
                className="terminal-column"
                aria-label="Mentu"
                style={{
                  display: route === MENTU_ROUTE_ID ? undefined : "none",
                }}
              >
                <MountedPanel
                  descriptor={resolveRoute(filesBaseRegistry, MENTU_ROUTE_ID)}
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
                    <SessionDetailsPanel terminal={terminal ?? null} />
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
        onSelectWorkspace={(id) => {
          const resolution = resolveWorkspaceSelection(selected, id);
          if (!resolution.changed) return;
          setSelected(resolution.selected);
          setActive("");
          setSessions([]);
        }}
        onSelectSession={selectSessionTab}
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
      {composer && (
        <NewWorkspaceComposerModal
          groups={projectGroups}
          workspaces={workspaces}
          initialProjectId={composer.initialProjectId}
          disabled={busy}
          onSubmitWorktree={submitWorktree}
          onSelectWorkspace={selectWorkspaceId}
          onAddProject={() => {
            setComposer(null);
            requestAddProject();
          }}
          onClose={() => setComposer(null)}
        />
      )}
      {appearanceFlags.statusBarVisible ? (
        <StatusBar
          terminalCount={sessions.length}
          onOpenSettings={() => openSettings()}
        />
      ) : null}
      <Toaster closeButton toastOptions={{ className: "font-sans text-sm" }} />
    </Tooltip.Provider>
  );
}
