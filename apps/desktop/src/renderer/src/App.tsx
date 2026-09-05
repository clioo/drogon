import { useCallback, useEffect, useState } from "react";
import {
  Folder,
  FolderPlus,
  PanelRight,
  Plus,
  RefreshCw,
  TerminalSquare,
  X,
} from "lucide-react";
import { Tooltip } from "radix-ui";
import type {
  Result,
  Session,
  Status,
  Workspace,
} from "../../shared/session-contract";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { TerminalPane } from "./TerminalPane";
import { updateSessionProjection } from "./session-projection";

function IconButton({
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
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [folderPath, setFolderPath] = useState("");
  const [inspector, setInspector] = useState(
    () => matchMedia("(min-width: 1101px)").matches,
  );
  const [revision, setRevision] = useState(0);
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
            : (result.workspaces[0]?.id ?? ""),
        );
        setRevision((value) => value + 1);
      }),
    [action],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
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
      setSessions([]);
      setActive("");
      return;
    }
    let cancelled = false;
    void window.drogon
      .sessions(selected)
      .then((response) => {
        if (cancelled) return;
        if (!response.ok) {
          setError(response.error.message);
          return;
        }
        setSessions(response.result.sessions);
        setActive((value) =>
          response.result.sessions.some((item) => item.id === value)
            ? value
            : (response.result.sessions.at(-1)?.id ?? ""),
        );
      })
      .catch(() => {
        if (!cancelled)
          setError("Could not load sessions. Retry the connection.");
      });
    return () => {
      cancelled = true;
    };
  }, [selected, status, revision]);
  const create = () =>
    action(async () => {
      const result = checked(await window.drogon.start(selected));
      setSessions((items) => [...items, result]);
      setActive(result.id);
    });
  const close = (session: Session) =>
    action(async () => {
      const result = checked(
        await window.drogon.stop({
          sessionId: session.id,
          incarnation: session.incarnation,
        }),
      );
      if (result.verdict !== "exited")
        throw new Error("Session exit is not confirmed. The tab remains open.");
      setSessions((items) => items.filter((item) => item.id !== session.id));
      if (active === session.id)
        setActive(sessions.find((item) => item.id !== session.id)?.id ?? "");
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
    const keydown = (event: KeyboardEvent) => {
      const mod = navigator.userAgent.includes("Mac")
        ? event.metaKey
        : event.ctrlKey;
      if (
        mod &&
        event.shiftKey &&
        event.key.toLowerCase() === "n" &&
        selected &&
        status &&
        !busy
      ) {
        event.preventDefault();
        void create();
      }
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
                  setSelected(workspace.id);
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
            {status ? `Service ${status.version}` : "Service unavailable"}
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
                label="Refresh connection"
                disabled={busy}
                onClick={() => void refresh()}
              >
                <RefreshCw />
              </IconButton>
              <IconButton
                label="Toggle session details"
                onClick={() => setInspector((value) => !value)}
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
                      aria-selected={item.id === active}
                      onClick={() => setActive(item.id)}
                    >
                      <TerminalSquare size={14} />
                      <span>{item.command.split(/[\\/]/).at(-1)}</span>
                      <span className="session-verdict">{item.verdict}</span>
                    </button>
                    <IconButton
                      label={`Close ${item.command.split(/[\\/]/).at(-1)} session`}
                      disabled={busy || !status}
                      onClick={() => void close(item)}
                    >
                      <X />
                    </IconButton>
                  </div>
                ))}
                <IconButton
                  label="New terminal"
                  disabled={!selected || !status || busy}
                  onClick={() => void create()}
                >
                  <Plus />
                </IconButton>
              </div>
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
                      disabled={busy}
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
