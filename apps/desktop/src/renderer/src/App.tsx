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
  Plus,
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
  Result,
  Session,
  Status,
  Workspace,
} from "../../shared/session-contract";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import {
  isSessionDismissed,
  loadDismissedSessions,
  markSessionDismissed,
} from "./dismissed-sessions";
import { HarnessLaunchMenu } from "./HarnessLaunchMenu";
import { Sidebar } from "./features/shell/Sidebar";
import { TabBar } from "./features/shell/TabBar";
import { TitlebarLeftControls } from "./features/shell/TitlebarLeftControls";
import {
  canGoBackView,
  canGoForwardView,
  goBackView,
  goForwardView,
  initialViewHistory,
  pushView,
} from "./features/shell/view-history";
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
  windowProjectBridge,
} from "./features/shell/project-adapter";
import type { ProjectGroup } from "./features/shell/project-adapter";
import type { ProjectAction } from "./features/shell/ProjectList";
import type { FileOpenRequestCell } from "./features/workspaces/files-panel";
import { openCommandPalette } from "./features/shell/open-palette";
import { CommandPaletteHost } from "./components/command-palette";
import { supportsHarnessLaunch } from "./harness-capability";
import { TERMINAL_CLEAR_EVENT, TerminalPane } from "./TerminalPane";
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
import {
  BROWSER_ROUTE_ID,
  browserBridge,
  registerBrowserRoute,
} from "./browser-mount";
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
import { createShortcutRegistry, guardHandler } from "./shortcuts";
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
import type { HarnessAgentDefault, Theme } from "./settings-store";
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
  const [adding, setAdding] = useState(false);
  const [folderPath, setFolderPath] = useState("");
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
  const [defaultHarnessId, setDefaultHarnessId] = useState(
    () => settings.get("defaultHarnessId"),
  );
  const [harnessDefaults, setHarnessDefaults] = useState(
    () => settings.get("harnessDefaults"),
  );
  const [notifyOnAgentNeedsInput, setNotifyOnAgentNeedsInput] = useState(
    () => settings.get("notifyOnAgentNeedsInput"),
  );
  // Settings is a full page (route "settings"), not a dialog: opening it
  // remembers the previous route so "Back to app" returns to that view.
  const [settingsReturnRoute, setSettingsReturnRoute] = useState<string | null>(
    null,
  );
  const [settingsInitialSection, setSettingsInitialSection] =
    useState<SettingsSectionId>("appearance");
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
  // Sidebar project/worktree dialogs (add project, new worktree, remove
  // worktree). Null means none open; the palette opens the worktree form
  // through the same state.
  const [projectAction, setProjectAction] = useState<ProjectAction | null>(
    null,
  );
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
  const filesGateRef = useRef(false);
  useEffect(() => {
    filesGateRef.current = isFilesAvailable(liveCapabilities);
  }, [liveCapabilities]);
  const gitGateRef = useRef(false);
  useEffect(() => {
    gitGateRef.current = isChangesAvailable(liveCapabilities);
  }, [liveCapabilities]);
  const tasksGateRef = useRef(false);
  useEffect(() => {
    tasksGateRef.current = isTasksAvailable(liveCapabilities);
  }, [liveCapabilities]);
  const botsGateRef = useRef(false);
  useEffect(() => {
    botsGateRef.current = isBotsAvailable(liveCapabilities);
  }, [liveCapabilities]);
  const automationsGateRef = useRef(false);
  useEffect(() => {
    automationsGateRef.current = isAutomationsAvailable(liveCapabilities);
  }, [liveCapabilities]);
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
  // Browser is a local Electron feature (no service capability): the
  // bridge is static, so it joins the base registry unconditionally.
  const browserStaticBridge = useMemo(() => browserBridge(), []);
  const filesBaseRegistry = useMemo(
    () =>
      registerAutomationsRoute(
        registerBrowserRoute(
          registerChangesRoute(
            registerFilesRoute(
              createRouteRegistry({
                capabilities: [
                  FILES_CAPABILITY,
                  BOTS_CAPABILITY,
                  GIT_CAPABILITY,
                  AUTOMATIONS_CAPABILITY,
                  TASKS_CAPABILITY,
                ],
                fallbackId: BOTS_ROUTE_ID,
              }),
              filesGatedBridge,
              fileOpenCell,
            ),
            gitGatedBridge,
          ),
          browserStaticBridge,
        ),
        {
          bridge: automationsGatedBridge,
          listWorkspaces: () => window.drogon.workspaces(),
          listHarnesses: () => window.drogon.harnesses(),
        },
      ),
    [filesGatedBridge, gitGatedBridge, browserStaticBridge, automationsGatedBridge, fileOpenCell],
  );
  // Tasks host callbacks: stable across renders (the registry memo below
  // runs once). Groups ride a ref so the page always re-reads the current
  // projects on mount/refresh instead of a stale closure.
  const projectGroupsRef = useRef(projectGroups);
  projectGroupsRef.current = projectGroups;
  const loadTaskGroups = useCallback(() => projectGroupsRef.current, []);
  const panelRegistry = useMemo(() => {
    if (botsLoad?.status === "loaded" && botsScopeEquals(botsLoad.scope))
      return registerBotsRoute(
        filesBaseRegistry,
        botsGatedBridge,
        buildBotsPanelProps(botsLoad.snapshot, undefined, botsScope),
      );
    return filesBaseRegistry;
  }, [
    filesBaseRegistry,
    botsGatedBridge,
    botsLoad,
    botsScopeHost,
    botsScopeWorkspace,
    botsScopeLocale,
  ]);
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
  if (route === FILES_ROUTE_ID && filesAvailable && current)
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
    isChangesAvailable(liveCapabilities) &&
    checkAvailability(
      resolveRoute(filesBaseRegistry, CHANGES_ROUTE_ID),
      liveCapabilities,
    ) === "available";
  const changesAliveRef = useRef(false);
  const changesExplicitWithhold =
    status !== null && !isChangesAvailable(liveCapabilities);
  if (route === CHANGES_ROUTE_ID && changesAvailable && current)
    changesAliveRef.current = true;
  else if (
    changesExplicitWithhold ||
    (status && !current && !busy && !loadingSessions)
  )
    changesAliveRef.current = false;
  const changesAlive = changesAliveRef.current;
  const filesProps =
    current && status ? { workspace: current, status } : lastPropsRef.current;
  const settingsSectionRef = useRef<HTMLElement>(null);
  const filesSectionRef = useRef<HTMLElement>(null);
  const changesSectionRef = useRef<HTMLElement>(null);
  const botsSectionRef = useRef<HTMLElement>(null);
  const browserSectionRef = useRef<HTMLElement>(null);
  const automationsSectionRef = useRef<HTMLElement>(null);
  const tasksSectionRef = useRef<HTMLElement>(null);
  const prevRouteRef = useRef<string | null>(null);
  useEffect(() => {
    // Real focus, only on explicit user navigation to a panel: background
    // refreshes and re-renders must never steal focus.
    const target =
      route === FILES_ROUTE_ID
        ? filesSectionRef.current
        : route === CHANGES_ROUTE_ID
          ? changesSectionRef.current
          : route === BOTS_ROUTE_ID
            ? botsSectionRef.current
            : route === BROWSER_ROUTE_ID
              ? browserSectionRef.current
              : route === AUTOMATIONS_ROUTE_ID
                ? automationsSectionRef.current
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
  // Browser keep-alive mirrors files minus the capability withhold (local
  // feature, always available): survives switches and transients, unmounts
  // on settled workspace loss. The page itself lives in main, so a remount
  // only rebuilds chrome and re-reports bounds.
  const browserAliveRef = useRef(false);
  if (route === BROWSER_ROUTE_ID && current) browserAliveRef.current = true;
  else if (status && !current && !busy && !loadingSessions)
    browserAliveRef.current = false;
  const browserAlive = browserAliveRef.current;
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
      if (!wide.matches) setInspector(false);
    };
    wide.addEventListener("change", adapt);
    return () => wide.removeEventListener("change", adapt);
  }, []);
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
  const goBackViewHistory = () => {
    const next = goBackView(viewHistory);
    if (next === viewHistory) return;
    setViewHistory(next);
    applyViewEntry(next.present);
  };
  const goForwardViewHistory = () => {
    const next = goForwardView(viewHistory);
    if (next === viewHistory) return;
    setViewHistory(next);
    applyViewEntry(next.present);
  };
  // Add-project entry point shared by the sidebar, the landing empty state
  // and the workspace.create (Cmd+N) chord.
  const requestAddProject = () => {
    if (
      isProjectsAvailable(liveCapabilities) &&
      typeof windowProjectBridge(window.drogon).projectAdd === "function"
    )
      setProjectAction({ kind: "add" });
    else setAdding((value) => !value);
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
  const browseProject = async (): Promise<string | null> => {
    try {
      return await window.drogon.chooseFolder();
    } catch {
      return null;
    }
  };
  // Palette "New worktree" target: the git project owning the selected
  // workspace, else the first git project in the view.
  const newWorktreeTarget = () =>
    gitProjectForWorkspace(projectGroups, selected) ??
    projectGroups.find((group) => group.project.kind === "git")?.project ??
    null;
  const openNewWorktreeForm = () => {
    const target = newWorktreeTarget();
    if (!target) {
      setError("No git project selected: add a repository project first.");
      return;
    }
    setProjectAction({ kind: "worktree", projectId: target.id });
  };
  // Quick-open reveal: records the request for the Files panel and routes
  // there. The panel applies it when its workspace matches (see
  // FileOpenRequestCell); the tick re-renders even when already routed.
  const openFileInFiles = (path: string) => {
    if (!selected) {
      setRoute(FILES_ROUTE_ID);
      return;
    }
    fileOpenNonce.current += 1;
    fileOpenCell.current = {
      workspaceId: selected,
      path,
      nonce: fileOpenNonce.current,
    };
    setFileOpenTick((tick) => tick + 1);
    setRoute(FILES_ROUTE_ID);
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
  const closeSettings = () => setRoute(settingsReturnRoute);
  // Inspector toggles persist through the settings store; the narrow-viewport
  // guard below keeps overriding the pane shut on shrink without persisting,
  // so an accidental shrink never becomes a saved "closed" choice.
  const changeInspector = (next: boolean) => {
    setInspector(next);
    settings.set("inspectorVisible", next);
  };
  const toggleInspector = () => changeInspector(!inspector);
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
  const add = () =>
    action(async () => {
      const result = checked(await window.drogon.addWorkspace(folderPath));
      setWorkspaces((items) => [
        ...items.filter((item) => item.id !== result.id),
        result,
      ]);
      setSelected(result.id);
      setAdding(false);
      setFolderPath("");
    });
  useEffect(() => {
    const platform = navigator.userAgent.includes("Mac") ? "darwin" : "other";
    const isDisabled = () => !selected || !status || busy || loadingSessions;
    const registry = createShortcutRegistry();
    registry.register({
      id: "workspace.newTerminal",
      chord: "CmdOrCtrl+Shift+N",
      handler: guardHandler(() => void create(), isDisabled),
    });
    // J10: Cmd+, opens the Settings page from anywhere — never gated on
    // workspace, connection or busy state.
    registry.register({
      id: "settings.open",
      chord: "CmdOrCtrl+,",
      handler: () => openSettings(),
    });
    // R6-A source chords (definitions-core-1/3): Cmd+N creates a workspace,
    // Cmd+K clears the focused terminal pane (reserved: never the palette),
    // Cmd+B toggles the sidebar, Mod+Alt+arrows walk the view history.
    registry.register({
      id: "workspace.create",
      chord: "CmdOrCtrl+N",
      handler: guardHandler(requestAddProject, () => busy),
    });
    registry.register({
      id: "terminal.clear",
      chord: "CmdOrCtrl+K",
      handler: () => {
        window.dispatchEvent(new CustomEvent(TERMINAL_CLEAR_EVENT));
      },
    });
    registry.register({
      id: "sidebar.left.toggle",
      chord: "CmdOrCtrl+B",
      handler: toggleSidebar,
    });
    registry.register({
      id: "worktree.history.back",
      chord: "CmdOrCtrl+Alt+ArrowLeft",
      handler: guardHandler(goBackViewHistory, () =>
        !canGoBackView(viewHistory),
      ),
    });
    registry.register({
      id: "worktree.history.forward",
      chord: "CmdOrCtrl+Alt+ArrowRight",
      handler: guardHandler(goForwardViewHistory, () =>
        !canGoForwardView(viewHistory),
      ),
    });
    const keydown = (event: KeyboardEvent) => {
      const action = registry.matchKeyEvent(event, platform);
      if (!action) return;
      // terminal.clear is terminal-scoped: anywhere else the chord stays
      // reserved (no global handler may claim Cmd+K).
      if (action.id === "terminal.clear") {
        const target = event.target;
        const inTerminal =
          target instanceof HTMLElement &&
          target.closest("#active-session-panel") !== null;
        if (!inTerminal) return;
        event.preventDefault();
        action.handler();
        return;
      }
      // The palette owns its keys while open; only Settings tunnels through.
      if (
        action.id !== "settings.open" &&
        document.querySelector(".command-palette-overlay") !== null
      )
        return;
      if (action.id !== "settings.open" && isDisabled()) {
        // Window-level shell chords stay live without a workspace.
        if (
          action.id !== "workspace.create" &&
          action.id !== "sidebar.left.toggle" &&
          action.id !== "worktree.history.back" &&
          action.id !== "worktree.history.forward"
        )
          return;
        if (action.id === "workspace.create" && busy) return;
      }
      event.preventDefault();
      action.handler();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
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
          <TitlebarLeftControls
            canGoBack={canGoBackView(viewHistory)}
            canGoForward={canGoForwardView(viewHistory)}
            backShortcutLabel={shortcutLabel("⌥←")}
            forwardShortcutLabel={shortcutLabel("⌥→")}
            toggleShortcutLabel={shortcutLabel("B")}
            onToggleSidebar={toggleSidebar}
            onGoBack={goBackViewHistory}
            onGoForward={goForwardViewHistory}
          />
        </div>
        <div className="app-content">
        <Sidebar
          open={sidebarOpen}
          width={sidebarWidth}
          onWidthChange={changeSidebarWidth}
          route={route}
          onSelectRoute={setRoute}
          onOpenPalette={openCommandPalette}
          groups={projectGroups}
          workspaces={workspaces}
          sessions={sessions}
          selectedWorkspaceId={selected}
          workspaceDisabled={busy}
          addDisabled={!status || busy}
          onSelectWorkspace={selectWorkspaceId}
          onAddProject={requestAddProject}
          worktreesAvailable={isWorktreesAvailable(liveCapabilities)}
          projectAction={projectAction}
          onOpenProjectAction={setProjectAction}
          onCloseProjectAction={() => setProjectAction(null)}
          onBrowseProject={browseProject}
          onSubmitAddProject={submitAddProject}
          onSubmitWorktree={submitWorktree}
          onSubmitRemoveWorktree={submitRemoveWorktree}
          addSlot={
            <>
          {adding && (
            <form
              className="folder-form"
              onSubmit={(event) => {
                event.preventDefault();
                void add();
              }}
            >
              <label htmlFor="folder-path">Folder path</label>
              <Input
                id="folder-path"
                autoFocus
                value={folderPath}
                onChange={(event) => setFolderPath(event.target.value)}
                disabled={busy}
              />
              <div className="form-actions">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const value = await window.drogon.chooseFolder();
                      if (value) setFolderPath(value);
                    })
                  }
                >
                  Browse
                </Button>
                <Button size="sm" disabled={busy || !folderPath.trim()}>
                  Add
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setAdding(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
          {!workspaces.length && !adding && (
            <p className="sidebar-empty">
              Open a folder or repository to begin.
            </p>
          )}
            </>
          }
          serviceLabel={
            status ? `Service ${status.version}` : "Service unavailable"
          }
          buildRevision={
            buildInfo
              ? `${buildInfo.version} · ${buildInfo.revision.slice(0, 7)}`
              : null
          }
          buildTitle={buildInfo ? `Built ${buildInfo.builtAt}` : undefined}
          onOpenSettings={() => openSettings()}
          settingsExpanded={route === SETTINGS_ROUTE_ID}
        />
        <main className="session-area" style={{ position: "relative" }}>
          {workspaces.length === 0 ? (
            <Landing
              hasProjects={false}
              onAddProject={requestAddProject}
              onCreateWorkspace={() => setAdding(true)}
            />
          ) : (
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
                onClick={toggleInspector}
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
                  theme={theme}
                  onThemeChange={changeTheme}
                  terminalFontSize={terminalFontSize}
                  onTerminalFontSizeChange={changeTerminalFontSize}
                  inspectorVisible={inspector}
                  onInspectorChange={changeInspector}
                  harnesses={harnesses}
                  defaultHarnessId={defaultHarnessId}
                  onDefaultHarnessChange={changeDefaultHarness}
                  harnessDefaults={harnessDefaults}
                  onHarnessDefaultChange={changeHarnessDefault}
                  notifyOnAgentNeedsInput={notifyOnAgentNeedsInput}
                  onNotifyChange={changeNotifyOnAgentNeedsInput}
                  workspacePath={current?.path ?? null}
                  initialSection={settingsInitialSection}
                  onBack={closeSettings}
                />
              </section>
            </div>
          ) : (
          <div className="session-layout">
            <section
              className="terminal-column"
              aria-label="Terminals"
              style={{
                display:
                  (route === FILES_ROUTE_ID && filesAlive) ||
                  (route === CHANGES_ROUTE_ID &&
                    changesAlive &&
                    filesProps !== null) ||
                  (route === BOTS_ROUTE_ID &&
                    botsAlive &&
                    filesProps !== null) ||
                  (route === BROWSER_ROUTE_ID &&
                    browserAlive &&
                    filesProps !== null) ||
                  (route === BOTS_ROUTE_ID && botsAlive && filesProps !== null) ||
                  (route === AUTOMATIONS_ROUTE_ID &&
                    automationsAlive &&
                    filesProps !== null) ||
                  (route === TASKS_ROUTE_ID && tasksAlive)
                    ? "none"
                    : undefined,
              }}
            >
              <TabBar
                sessions={sessions}
                activeId={active}
                harnesses={harnesses}
                closeDisabled={busy || loadingSessions || !status}
                retryDisabled={retryAffordanceDisabled({
                  refreshInFlight: busy,
                })}
                onSelect={setActive}
                onClose={(item) => void close(item)}
                onRetry={() => void refresh()}
                launcher={
                  harnessCapability ? (
                  <HarnessLaunchMenu
                    workspaceId={selected}
                    hostId={status?.hostId ?? null}
                    harnesses={harnesses}
                    disabled={!selected || !status || busy || loadingSessions}
                    onCreateTerminal={() => void create()}
                    onLaunch={launchHarness}
                    defaultHarnessId={defaultHarnessId}
                    launchDefaults={harnessDefaults}
                  />
                ) : (
                  <IconButton
                    label="New terminal"
                    disabled={!selected || !status || busy || loadingSessions}
                    onClick={() => void create()}
                  >
                    <Plus />
                  </IconButton>
                )}
              />
              <div
                id="active-session-panel"
                role="tabpanel"
                aria-labelledby={
                  terminal ? `session-tab-${terminal.id}` : undefined
                }
                className="active-session-panel"
                aria-busy={loadingSessions}
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
                          current ? void create() : setAdding(true)
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
                          current ? void create() : setAdding(true)
                        }
                      >
                        {current ? "New terminal" : "Add workspace"}
                      </Button>
                    ) : (
                      <Button disabled={busy} onClick={() => void refresh()}>
                        Retry connection
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </section>
            {filesAlive && filesProps ? (
              <section
                ref={filesSectionRef}
                tabIndex={-1}
                className="terminal-column"
                aria-label="Files"
                style={{
                  display: route === FILES_ROUTE_ID ? undefined : "none",
                }}
              >
                <MountedPanel
                  descriptor={resolveRoute(filesBaseRegistry, FILES_ROUTE_ID)}
                  workspace={filesProps.workspace}
                  status={filesProps.status}
                />
              </section>
            ) : null}
            {changesAlive && filesProps ? (
              <section
                ref={changesSectionRef}
                tabIndex={-1}
                className="terminal-column"
                aria-label="Changes"
                style={{
                  display: route === CHANGES_ROUTE_ID ? undefined : "none",
                }}
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
            ) : null}
            {browserAlive && filesProps ? (
              <section
                ref={browserSectionRef}
                tabIndex={-1}
                className="terminal-column"
                aria-label="Browser"
                style={{
                  display: route === BROWSER_ROUTE_ID ? undefined : "none",
                }}
              >
                <MountedPanel
                  descriptor={resolveRoute(filesBaseRegistry, BROWSER_ROUTE_ID)}
                  workspace={filesProps.workspace}
                  status={filesProps.status}
                />
              </section>
            ) : null}
            {tasksAlive && status ? (
              <section
                ref={tasksSectionRef}
                tabIndex={-1}
                className="terminal-column"
                aria-label="Tasks"
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
                  />
                )}
              </section>
            ) : null}
            {botsAlive && filesProps ? (
              <section
                ref={botsSectionRef}
                tabIndex={-1}
                className="terminal-column"
                aria-label="Bots"
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
              <section
                ref={automationsSectionRef}
                tabIndex={-1}
                className="terminal-column"
                aria-label="Automations"
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
            {inspector && (
              <aside className="session-details" aria-label="Session details">
                <h2>Session</h2>
                {terminal ? (
                  <dl>
                    <dt>Command</dt>
                    <dd className="path">{terminal.command}</dd>
                    <dt>State</dt>
                    <dd>
                      {terminal.verdict}
                      {terminal.exitCode !== null
                        ? ` · exit ${terminal.exitCode}`
                        : ""}
                    </dd>
                    <dt>Execution host</dt>
                    <dd className="path">{terminal.hostId}</dd>
                    <dt>Session ID</dt>
                    <dd className="path">{terminal.id}</dd>
                  </dl>
                ) : (
                  <p>Select a terminal to see its execution details.</p>
                )}
                <div className="migration-note">
                  <h2>Coming in the migration</h2>
                  <p>
                    Mentu and Bots are not connected in this build. Source
                    control is available from the Changes panel.
                  </p>
                </div>
              </aside>
            )}
          </div>
          )}
            </>
          )}
        </main>
        </div>
      </div>
      <CommandPaletteHost
        fileBridge={filesGatedBridge}
        hostId={status?.hostId ?? null}
        workspaceId={selected}
        workspaces={workspaces}
        sessions={sessions}
        activeSessionId={active}
        filesAvailable={isFilesAvailable(liveCapabilities)}
        botsAvailable={isBotsAvailable(liveCapabilities)}
        harnessAvailable={harnessCapability}
        worktreesAvailable={isWorktreesAvailable(liveCapabilities)}
        canCreateWorktree={newWorktreeTarget() !== null}
        onNewWorktree={openNewWorktreeForm}
        theme={theme}
        connected={status !== null}
        busy={busy}
        onNewTerminal={() => void create()}
        onSelectWorkspace={(id) => {
          const resolution = resolveWorkspaceSelection(selected, id);
          if (!resolution.changed) return;
          setSelected(resolution.selected);
          setActive("");
          setSessions([]);
        }}
        onSelectSession={setActive}
        onOpenFiles={() => setRoute(FILES_ROUTE_ID)}
        onOpenBots={() => setRoute(BOTS_ROUTE_ID)}
        onToggleInspector={toggleInspector}
        onOpenSettings={() => openSettings()}
        onSetTheme={changeTheme}
        onAddWorkspace={() => setAdding(true)}
        onOpenFile={openFileInFiles}
      />
      <StatusBar terminalCount={sessions.length} onOpenSettings={() => openSettings()} />
    </Tooltip.Provider>
  );
}
