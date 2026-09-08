// MIT Copyright (c) 2026 Lovecast Inc.
// Ported structure from the Orca reference (read-only):
//   src/renderer/src/components/settings/ManageSessionsSection.tsx
//     (Manage Sessions h3 + recovery description, Sessions(n) + Refresh /
//      Kill-all toolbar, sessions table with state dot, workspace, id and
//      per-row kill)
//   src/renderer/src/components/settings/ManageSessionsTable.tsx
//     (bordered table card, Refresh / Kill-all icon buttons with tooltips,
//      Loading / No-sessions empty states, row kill aria-labels)
//   src/renderer/src/components/settings/TerminalPane.tsx
//     (pane title "Terminal" + "Shells, renderer, sessions, and terminal
//      behavior.")
// Adapted: sessions list through this desktop's existing window.drogon
// workspaces()/sessions()/stop() surface, plus the additive
// window.drogon.daemon.restart() channel (drogon:daemon:restart) for the
// fork's Restart-daemon button. Per-row "go to terminal" navigation and the
// TCC attribution notice have no MVP seam and are omitted; killing one
// session and restarting the daemon confirm inline (arm-to-confirm)
// instead of the fork's dialogs, and the daemon stops through its own
// `runtime.shutdown` (refused while sessions live, so main stops every
// session first) rather than the fork's in-process spawner.
// Interaction (scroll sliders, right-click paste, focus-follows-mouse,
// copy-on-select, OSC 52) and Advanced (scrollback rows, word separators,
// option-as-alt, JIS yen) rows are omitted: TerminalPane hardcodes those
// behaviors (scrollback 5000, OSC 52 always on) and owns the wiring, so a
// switch here would be dead. Rendering (GPU acceleration, typography)
// stays under Appearance per the merged R16-G decision.
import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCw, RotateCw, Trash2, X } from "lucide-react";
import type { Session, Workspace } from "../../../../shared/session-contract";
import type {
  DaemonRestartInput,
  DaemonRestartResult,
} from "../../../../shared/daemon-contract";
import { SESSIONS_INVALIDATE_EVENT } from "../../session-recovery";
import { Button } from "../../components/ui/button";
import { SettingsSection, SettingsSubsectionHeader } from "./settings-rows";

type ManagedRow = {
  session: Session;
  workspacePath: string | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "unavailable"; reason: string }
  | { status: "ready"; rows: ManagedRow[] };

function windowDrogon(): {
  workspaces: () => Promise<{ ok: boolean; result?: { workspaces: Workspace[] }; error?: { message: string } }>;
  sessions: (workspaceId: string) => Promise<{ ok: boolean; result?: { sessions: Session[] }; error?: { message: string } }>;
  stop: (input: { sessionId: string; incarnation: string }) => Promise<{ ok: boolean; result?: Session; error?: { message: string } }>;
  // R16-AL2 (issue #228): close kills a live PTY and forgets the record,
  // so Kill all clears post-restart `unverifiable` stubs too — `stop`
  // can only report about those, never remove them.
  close?: (input: { sessionId: string; incarnation: string }) => Promise<{ ok: boolean; result?: Session; error?: { message: string } }>;
  daemon?: {
    restart: (input?: DaemonRestartInput) => Promise<DaemonRestartResult>;
  };
} | null {
  try {
    const bridge = (window as unknown as { drogon?: unknown }).drogon as Record<
      string,
      unknown
    > | undefined;
    if (
      !bridge ||
      typeof bridge.workspaces !== "function" ||
      typeof bridge.sessions !== "function" ||
      typeof bridge.stop !== "function"
    )
      return null;
    return bridge as unknown as NonNullable<ReturnType<typeof windowDrogon>>;
  } catch {
    return null;
  }
}

/** Status dot + label from the session's own verdict/agent state. */
function sessionLiveness(session: Session): { dot: string; label: string } {
  if (session.verdict === "exited" || session.exitCode !== null)
    return { dot: "bg-muted-foreground/40", label: "exited" };
  return { dot: "bg-emerald-500", label: session.agentState ?? "running" };
}

export function TerminalSection(): React.JSX.Element {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [killing, setKilling] = useState<string | null>(null);
  const [killingAll, setKillingAll] = useState(false);
  const [armedKill, setArmedKill] = useState<string | null>(null);
  const [armedKillAll, setArmedKillAll] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [armedRestart, setArmedRestart] = useState(false);
  // Null while the manageability probe is in flight; a dev daemon started
  // by the operator reports managed:false with the disabled reason.
  const [daemonManaged, setDaemonManaged] = useState<boolean | null>(null);
  const [daemonReason, setDaemonReason] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const bridge = windowDrogon();
    if (!bridge) {
      if (mounted.current)
        setLoad({
          status: "unavailable",
          reason: "the desktop bridge is missing",
        });
      return;
    }
    if (mounted.current) setRefreshing(true);
    try {
      const workspacesResult = await bridge.workspaces();
      if (!workspacesResult.ok) {
        if (mounted.current)
          setLoad({
            status: "unavailable",
            reason: workspacesResult.error?.message ?? "could not list projects",
          });
        return;
      }
      const workspaces = workspacesResult.result?.workspaces ?? [];
      const paths = new Map(workspaces.map((w) => [w.id, w.path]));
      const rows: ManagedRow[] = [];
      for (const workspace of workspaces) {
        const sessionsResult = await bridge.sessions(workspace.id);
        if (!sessionsResult.ok) continue;
        for (const session of sessionsResult.result?.sessions ?? [])
          rows.push({ session, workspacePath: paths.get(session.workspaceId) ?? null });
      }
      if (mounted.current) setLoad({ status: "ready", rows });
    } catch {
      if (mounted.current)
        setLoad({ status: "unavailable", reason: "could not list sessions" });
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Manageability probe for the Restart daemon button: no side effects,
  // so it is safe to run once on mount next to the first list.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bridge = windowDrogon();
      if (!bridge?.daemon) {
        if (!cancelled) {
          setDaemonManaged(false);
          setDaemonReason("the desktop bridge is missing");
        }
        return;
      }
      try {
        const availability = await bridge.daemon.restart({ probe: true });
        if (!cancelled) {
          setDaemonManaged(availability.managed);
          setDaemonReason(availability.reason);
        }
      } catch {
        if (!cancelled) {
          setDaemonManaged(false);
          setDaemonReason("could not reach the desktop bridge");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const killOne = useCallback(
    async (row: ManagedRow) => {
      const bridge = windowDrogon();
      if (!bridge) return;
      setKilling(row.session.id);
      let outcome: string | null = null;
      try {
        // R16-AL2 (issue #228): a row the current service instance cannot
        // verify (a post-restart stub) has no PTY to kill — `stop` only
        // reports about it. `close` forgets the record, which is the only
        // honest dismissal for a row that can never be marked exited.
        // Live rows keep `stop`: the session ends, the record (and its
        // retained output) stays listed as exited, like the fork.
        const result = row.session.verdict === "unverifiable"
          ? await (bridge.close ?? bridge.stop)({
              sessionId: row.session.id,
              incarnation: row.session.incarnation,
            })
          : await bridge.stop({
              sessionId: row.session.id,
              incarnation: row.session.incarnation,
            });
        outcome = result.ok
          ? "Killed session."
          : (result.error?.message ?? "Could not kill session.");
        // The daemon registry changed (a live stop or a stub forget): the
        // strip re-lists on this signal so forgotten rows release their
        // tabs without waiting for the next natural refresh.
        if (result.ok)
          window.dispatchEvent(new CustomEvent(SESSIONS_INVALIDATE_EVENT));
      } catch {
        outcome = "Could not kill session.";
      } finally {
        if (mounted.current) {
          setKilling(null);
          setArmedKill(null);
        }
      }
      await refresh();
      if (mounted.current && outcome) setNotice(outcome);
    },
    [refresh],
  );

  const killAll = useCallback(async () => {
    if (load.status !== "ready") return;
    const bridge = windowDrogon();
    if (!bridge) return;
    setKillingAll(true);
    const total = load.rows.length;
    let killed = 0;
    try {
      // R16-AL2 (issue #228): `close`, not `stop`, so the sweep acts on
      // every row kind: live PTYs are killed, exited rows and post-restart
      // `unverifiable` stubs are forgotten. `stop` alone was a silent
      // no-op on stubs — it reports their verdict but can never remove
      // them, so they (and the tabs they re-list as) survived Kill all.
      for (const row of load.rows) {
        const result = await (bridge.close ?? bridge.stop)({
          sessionId: row.session.id,
          incarnation: row.session.incarnation,
        }).catch(() => null);
        if (result?.ok) killed += 1;
      }
      // Rows were killed and/or forgotten: let the strip re-list now (see
      // killOne for why the event matters).
      if (killed > 0)
        window.dispatchEvent(new CustomEvent(SESSIONS_INVALIDATE_EVENT));
    } finally {
      if (mounted.current) {
        setKillingAll(false);
        setArmedKillAll(false);
      }
    }
    await refresh();
    if (mounted.current)
      setNotice(
        killed === total
          ? "Killed all sessions."
          : `Killed ${killed} of ${total} sessions.`,
      );
  }, [load, refresh]);

  // The fork's restart kills every terminal pane first; main does the
  // same over `session.stop` before its own `runtime.shutdown`, so the
  // renderer only reports the outcome and re-lists. The R16-M connection
  // monitor owns the reconnecting banner while the daemon is down.
  const restartDaemon = useCallback(async () => {
    const bridge = windowDrogon();
    if (!bridge?.daemon) return;
    setRestarting(true);
    let outcome: string | null = null;
    try {
      const result = await bridge.daemon.restart();
      if (result.restarted) {
        outcome = "Daemon restarted.";
        if (mounted.current) {
          setDaemonManaged(result.managed);
          setDaemonReason(result.reason);
        }
      } else {
        outcome = result.reason ?? "Could not restart the daemon.";
      }
    } catch {
      outcome = "Could not restart the daemon.";
    } finally {
      if (mounted.current) {
        setRestarting(false);
        setArmedRestart(false);
      }
    }
    await refresh();
    if (mounted.current && outcome) setNotice(outcome);
  }, [refresh]);

  const rows = load.status === "ready" ? load.rows : [];
  const busy = refreshing || killing !== null || killingAll || restarting;

  return (
    <SettingsSection
      id="terminal"
      title="Terminal"
      description="Shells, renderer, sessions, and terminal behavior."
    >
      <SettingsSubsectionHeader
        title="Manage Sessions"
        description="Recover from a frozen or misbehaving terminal by killing sessions or restarting the underlying daemon."
      />
      <div className="mt-3 flex flex-col overflow-hidden rounded-lg border border-border/60">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Sessions
              {load.status === "ready" ? (
                <span className="ml-1 tabular-nums">({rows.length})</span>
              ) : null}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                setNotice(null);
                void refresh();
              }}
              disabled={busy}
              aria-label="Refresh"
              title="Refresh"
              className="text-muted-foreground"
            >
              <RefreshCw className={refreshing ? "animate-spin" : ""} />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={busy || rows.length === 0}
              onClick={() => {
                if (armedKillAll) void killAll();
                else setArmedKillAll(true);
              }}
              onBlur={() => setArmedKillAll(false)}
              aria-label={
                armedKillAll ? "Confirm kill all sessions" : "Kill all sessions"
              }
              title={armedKillAll ? "Confirm kill all sessions" : "Kill all sessions"}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={busy || daemonManaged !== true}
              onClick={() => {
                if (armedRestart) void restartDaemon();
                else setArmedRestart(true);
              }}
              onBlur={() => setArmedRestart(false)}
              aria-label={
                armedRestart ? "Confirm restart daemon" : "Restart daemon"
              }
              title={
                daemonManaged === true
                  ? (armedRestart ? "Confirm restart daemon" : "Restart daemon")
                  : (daemonReason ?? "Restart daemon")
              }
              className="text-muted-foreground"
            >
              {restarting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <RotateCw />
              )}
            </Button>
          </div>
        </div>

        {load.status === "loading" || (load.status === "ready" && refreshing && rows.length === 0) ? (
          <div className="flex items-center justify-center px-3 py-8 text-xs text-muted-foreground">
            Loading…
          </div>
        ) : load.status === "unavailable" ? (
          <p role="status" className="settings-unavailable px-3 py-8 text-center">
            Not available: {load.reason}
          </p>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center px-3 py-8 text-xs text-muted-foreground">
            No sessions.
          </div>
        ) : (
          <div className="max-h-[360px] overflow-y-auto">
            <table className="w-full text-xs">
              <tbody>
                {rows.map((row) => {
                  const liveness = sessionLiveness(row.session);
                  const armed = armedKill === row.session.id;
                  return (
                    <tr
                      key={row.session.id}
                      className="border-t border-border/50 first:border-t-0"
                    >
                      <td className="px-3 py-1.5">
                        <span
                          className={`block size-1.5 rounded-full ${liveness.dot}`}
                          aria-label={liveness.label}
                          title={liveness.label}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="block max-w-[280px] truncate font-mono font-medium">
                          {row.workspacePath ?? row.session.workspaceId}
                        </span>
                      </td>
                      <td
                        className="px-3 py-1.5 font-mono text-[11px] text-muted-foreground"
                        title={row.session.id}
                      >
                        <span className="block max-w-[280px] truncate">
                          {row.session.id}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => {
                            if (armed) void killOne(row);
                            else setArmedKill(row.session.id);
                          }}
                          onBlur={() => setArmedKill(null)}
                          disabled={busy}
                          aria-label={
                            armed
                              ? `Confirm kill session ${row.session.id}`
                              : `Kill session ${row.session.id}`
                          }
                          title={armed ? "Confirm kill" : "Kill session"}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {notice ? (
        <p role="status" className="settings-note mt-2">
          {notice}
        </p>
      ) : null}
      {armedKillAll && rows.length > 0 ? (
        <p role="status" className="settings-note mt-2">
          Press Kill all sessions again to kill every session.
        </p>
      ) : null}
      {armedRestart ? (
        <p role="status" className="settings-note mt-2">
          Press Restart daemon again to stop every session and restart the
          daemon.
        </p>
      ) : null}
    </SettingsSection>
  );
}
