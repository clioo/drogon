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
// workspaces()/sessions()/stop() surface (no new IPC, no preload change).
// The fork's Restart-daemon button, per-row "go to terminal" navigation and
// TCC attribution notice have no MVP seam and are omitted; killing one
// session confirms inline (arm-to-confirm) instead of the fork's dialog.
// Interaction (scroll sliders, right-click paste, focus-follows-mouse,
// copy-on-select, OSC 52) and Advanced (scrollback rows, word separators,
// option-as-alt, JIS yen) rows are omitted: TerminalPane hardcodes those
// behaviors (scrollback 5000, OSC 52 always on) and owns the wiring, so a
// switch here would be dead. Rendering (GPU acceleration, typography)
// stays under Appearance per the merged R16-G decision.
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Trash2, X } from "lucide-react";
import type { Session, Workspace } from "../../../../shared/session-contract";
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
  stop: (input: { sessionId: string; incarnation: string }) => Promise<{ ok: boolean; error?: { message: string } }>;
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

  const killOne = useCallback(
    async (row: ManagedRow) => {
      const bridge = windowDrogon();
      if (!bridge) return;
      setKilling(row.session.id);
      let outcome: string | null = null;
      try {
        const result = await bridge.stop({
          sessionId: row.session.id,
          incarnation: row.session.incarnation,
        });
        outcome = result.ok
          ? "Killed session."
          : (result.error?.message ?? "Could not kill session.");
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
      for (const row of load.rows) {
        const result = await bridge
          .stop({
            sessionId: row.session.id,
            incarnation: row.session.incarnation,
          })
          .catch(() => null);
        if (result?.ok) killed += 1;
      }
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

  const rows = load.status === "ready" ? load.rows : [];
  const busy = refreshing || killing !== null || killingAll;

  return (
    <SettingsSection
      id="terminal"
      title="Terminal"
      description="Shells, renderer, sessions, and terminal behavior."
    >
      <SettingsSubsectionHeader
        title="Manage Sessions"
        description="Recover from a frozen or misbehaving terminal by killing sessions."
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
    </SettingsSection>
  );
}
