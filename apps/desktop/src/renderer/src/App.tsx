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
import { loadProjectView } from "./features/shell/project-adapter";
import type {
  ProjectGroup,
  ProjectRpcBridge,
} from "./features/shell/project-adapter";
import { openCommandPalette } from "./features/shell/open-palette";
import { CommandPaletteHost } from "./components/command-palette";
import { supportsHarnessLaunch } from "./harness-capability";
import { TerminalPane } from "./TerminalPane";
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
import type { Theme } from "./settings-store";
import { SettingsPanel } from "./settings-panel";
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpenerRef = useRef<HTMLButtonElement>(null);
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
  const botsGateRef = useRef(false);
  useEffect(() => {
    botsGateRef.current = isBotsAvailable(liveCapabilities);
  }, [liveCapabilities]);
  const filesGatedBridge = useMemo(
    () => createGatedFileBridge(window.drogon, () => filesGateRef.current),
    [],
  );
  const gitGatedBridge = useMemo(
    () => createGatedGitBridge(windowGitBridge(), () => gitGateRef.current),
    [],
  );
  const botsGatedBridge = useMemo(
    () => createGatedBotBridge(window.drogon, () => botsGateRef.current),
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
  const filesBaseRegistry = useMemo(
    () =>
      registerChangesRoute(
        registerFilesRoute(
          createRouteRegistry({
            capabilities: [FILES_CAPABILITY, BOTS_CAPABILITY, GIT_CAPABILITY],
            fallbackId: BOTS_ROUTE_ID,
          }),
          filesGatedBridge,
        ),
        gitGatedBridge,
      ),
    [filesGatedBridge, gitGatedBridge],
  );
  const panelRegistry = useMemo(() => {
    if (botsLoad?.status === "loaded" && botsScopeEquals(botsLoad.scope))
      return registerBotsRoute(
        filesBaseRegistry,
        botsGatedBridge,
        buildBotsPanelProps(botsLoad.snapshot),
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
  const filesSectionRef = useRef<HTMLElement>(null);
  const changesSectionRef = useRef<HTMLElement>(null);
  const botsSectionRef = useRef<HTMLElement>(null);
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
    void loadProjectView(
      window.drogon as unknown as ProjectRpcBridge,
      status?.capabilities ?? [],
      workspaces,
    ).then((view) => {
      if (!cancelled) setProjectGroups(view.groups);
    });
    return () => {
      cancelled = true;
    };
  }, [status, workspaces]);
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
  // Shared by sidebar worktree cards: re-clicking the already-active
  // workspace must not clear its visible live-session projection.
  const selectWorkspaceId = (id: string) => {
    const resolution = resolveWorkspaceSelection(selected, id);
    if (!resolution.changed) return;
    setSelected(resolution.selected);
    setActive("");
    setSessions([]);
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
    const keydown = (event: KeyboardEvent) => {
      const action = registry.matchKeyEvent(event, platform);
      if (!action || isDisabled()) return;
      event.preventDefault();
      action.handler();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  return (
    <Tooltip.Provider delayDuration={400}>
      <div className="app-shell">
        <Sidebar
          route={route}
          panelsDisabled={busy || !current}
          filesAvailable={isFilesAvailable(liveCapabilities)}
          changesAvailable={isChangesAvailable(liveCapabilities)}
          botsAvailable={isBotsAvailable(liveCapabilities)}
          onSelectRoute={setRoute}
          onOpenPalette={openCommandPalette}
          groups={projectGroups}
          workspaces={workspaces}
          sessions={sessions}
          selectedWorkspaceId={selected}
          workspaceDisabled={busy}
          addDisabled={!status || busy}
          onSelectWorkspace={selectWorkspaceId}
          onAddProject={() => setAdding((value) => !value)}
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
          onOpenSettings={() => setSettingsOpen(true)}
          settingsExpanded={settingsOpen}
        />
        <main className="session-area">
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
                ref={settingsOpenerRef}
                label="Settings"
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen((value) => !value)}
              >
                <Settings size={16} />
              </IconButton>
            </div>
            {settingsOpen && (
              <SettingsPanel
                theme={theme}
                onThemeChange={changeTheme}
                inspectorVisible={inspector}
                onInspectorChange={changeInspector}
                onClose={() => setSettingsOpen(false)}
                openerRef={settingsOpenerRef}
              />
            )}
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
                  (route === BOTS_ROUTE_ID && botsAlive && filesProps !== null)
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
        </main>
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
        onOpenSettings={() => setSettingsOpen(true)}
        onSetTheme={changeTheme}
        onAddWorkspace={() => setAdding(true)}
        onOpenFile={() => setRoute(FILES_ROUTE_ID)}
      />
      <StatusBar terminalCount={sessions.length} onOpenSettings={() => setSettingsOpen(true)} />
    </Tooltip.Provider>
  );
}
