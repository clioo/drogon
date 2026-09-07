import { useCallback, useEffect, useRef, useState } from "react";
import {
  Folder,
  FolderPlus,
  Monitor,
  Moon,
  PanelRight,
  Plus,
  RefreshCw,
  Sun,
  TerminalSquare,
  X,
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
import { supportsHarnessLaunch } from "./harness-capability";
import { TerminalPane } from "./TerminalPane";
import { updateSessionProjection } from "./session-projection";
import { sessionLabel } from "./session-label";
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

export function IconButton({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} {...props}>
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
  const [revision, setRevision] = useState(0);
  const [harnessCapability, setHarnessCapability] = useState(false);
  const [harnesses, setHarnesses] = useState<Harness[]>([]);
  const [buildInfo, setBuildInfo] = useState<{
    revision: string;
    builtAt: string;
    version: string;
  } | null>(null);
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
            : resolveRestoredSelection(
                result.workspaces,
                loadSavedSelection(),
              ),
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
    // Persists every confirmed selection once it settles against a known
    // workspace, so the next reload's restore has an up-to-date target.
    const workspace = workspaces.find((item) => item.id === selected);
    if (workspace)
      saveSavedSelection({ workspaceId: workspace.id, hostId: workspace.hostId });
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
  // Inspector toggles persist through the settings store; the narrow-viewport
  // guard below keeps overriding the pane shut on shrink without persisting,
  // so an accidental shrink never becomes a saved "closed" choice.
  const toggleInspector = () => {
    const next = !inspector;
    setInspector(next);
    settings.set("inspectorVisible", next);
  };
  const cycleTheme = () => {
    const next: Theme =
      theme === "system" ? "dark" : theme === "dark" ? "light" : "system";
    setTheme(next);
    settings.set("theme", next);
  };
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
        <aside className="workspace-sidebar" aria-label="Workspaces">
          <header className="brand">Drogon</header>
          <div className="sidebar-label">
            <span>Workspaces</span>
            <IconButton
              label="Add workspace"
              disabled={!status || busy}
              onClick={() => setAdding((value) => !value)}
            >
              <FolderPlus />
            </IconButton>
          </div>
          <nav>
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                className="workspace-row"
                disabled={busy}
                data-current={workspace.id === selected}
                aria-current={workspace.id === selected ? "page" : undefined}
                onClick={() => {
                  // Re-clicking the already-active workspace must not clear
                  // its visible live-session projection.
                  const resolution = resolveWorkspaceSelection(
                    selected,
                    workspace.id,
                  );
                  if (!resolution.changed) return;
                  setSelected(resolution.selected);
                  setActive("");
                  setSessions([]);
                }}
              >
                <Folder size={16} />
                <span>{workspace.name}</span>
              </button>
            ))}
          </nav>
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
          <footer className="sidebar-footer">
            <span>
              {status ? `Service ${status.version}` : "Service unavailable"}
            </span>
            {buildInfo && (
              <span
                className="build-revision"
                title={`Built ${buildInfo.builtAt}`}
              >
                {buildInfo.version} · {buildInfo.revision.slice(0, 7)}
              </span>
            )}
          </footer>
        </aside>
        <main className="session-area">
          <header className="session-header">
            <div className="workspace-heading">
              <strong>{current?.name ?? "Your workspace"}</strong>
              {current && <span className="path">{current.path}</span>}
            </div>
            <div className="header-actions">
              <IconButton
                label={`Theme: ${theme}`}
                onClick={cycleTheme}
              >
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
          <div className="session-layout">
            <section className="terminal-column" aria-label="Terminals">
              <div
                className="terminal-tabs"
                role="tablist"
                aria-label="Sessions"
              >
                {sessions.map((item) => (
                  <div
                    className="terminal-tab"
                    data-current={item.id === active}
                    key={item.id}
                  >
                    <button
                      role="tab"
                      id={`session-tab-${item.id}`}
                      aria-selected={item.id === active}
                      aria-controls="active-session-panel"
                      tabIndex={item.id === active ? 0 : -1}
                      onKeyDown={(event) => {
                        const index = sessions.findIndex(
                          (value) => value.id === item.id,
                        );
                        const next =
                          event.key === "ArrowRight"
                            ? (index + 1) % sessions.length
                            : event.key === "ArrowLeft"
                              ? (index - 1 + sessions.length) % sessions.length
                              : event.key === "Home"
                                ? 0
                                : event.key === "End"
                                  ? sessions.length - 1
                                  : -1;
                        if (next < 0) return;
                        event.preventDefault();
                        setActive(sessions[next].id);
                        document
                          .getElementById(`session-tab-${sessions[next].id}`)
                          ?.focus();
                      }}
                      onClick={() => setActive(item.id)}
                    >
                      <TerminalSquare size={14} />
                      <span>
                        {recoveryTabLabel({
                          label: sessionLabel(item, harnesses),
                          verdict: item.verdict,
                          id: item.id,
                          incarnation: item.incarnation,
                        })}
                      </span>
                      <span className="session-verdict">{item.verdict}</span>
                    </button>
                    {recoveryActionFor(item.verdict, {
                      // A confirmed close removes the tab, so a still-listed
                      // exited session is one the user did not request.
                      exitExpected: false,
                    }).kind === "retry-connection" && (
                      <IconButton
                        label="Retry connection"
                        disabled={retryAffordanceDisabled({
                          refreshInFlight: busy,
                        })}
                        onClick={() => void refresh()}
                      >
                        <RefreshCw />
                      </IconButton>
                    )}
                    <IconButton
                      label={`Close ${sessionLabel(item, harnesses)} session`}
                      disabled={busy || loadingSessions || !status}
                      onClick={() => void close(item)}
                    >
                      <X />
                    </IconButton>
                  </div>
                ))}
                {harnessCapability ? (
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
              </div>
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
                    Mentu, Bots and source control are not connected in this
                    build.
                  </p>
                </div>
              </aside>
            )}
          </div>
        </main>
      </div>
    </Tooltip.Provider>
  );
}
