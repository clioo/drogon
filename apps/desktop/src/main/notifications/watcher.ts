/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/main/ipc/native-notification-delivery.ts content selection (adapter:
   Electron-free pure diff/format so the transition dedupe is unit-testable
   without a window; the OS delivery lives in service.ts). */
// Transition detection and copy for J1 `needs_input` notifications. The
// watcher polls `session.list` and reports per-session transitions; the
// service notifies only on entering `needs_input` (one notification per
// transition, never a repeat while the state holds) and forwards every
// transition to the renderer for the live badge.

export type WatchedSession = {
  id: string;
  workspaceId: string;
  command: string;
  agentState?: string;
  agentStateAt?: string | null;
};

export type SessionTransition = {
  session: WatchedSession;
  /** True when the session entered `needs_input`, false when it left. */
  entered: boolean;
};

function normalizedState(session: WatchedSession): string {
  return session.agentState ?? "unknown";
}

/**
 * Diffs one `session.list` snapshot against the previous states. Returns
 * the next state map plus the transitions since the previous poll: one
 * entry per session whose state changed (the tab badge and the card dot
 * render the new state; only entering `needs_input` also notifies), plus
 * a leave entry for a `needs_input` session that vanished from the list.
 * Steady states stay quiet — the renderer already shows them.
 */
export function diffAgentStates(
  previous: ReadonlyMap<string, string>,
  sessions: WatchedSession[],
): { next: Map<string, string>; transitions: SessionTransition[] } {
  const next = new Map<string, string>();
  const transitions: SessionTransition[] = [];
  for (const session of sessions) {
    const state = normalizedState(session);
    next.set(session.id, state);
    const was = previous.get(session.id);
    // A first sighting is the poll baseline, not a change — except an
    // already-waiting session, which the renderer never saw enter.
    if (was === undefined) {
      if (state === "needs_input")
        transitions.push({ session, entered: true });
      continue;
    }
    if (was === state) continue;
    transitions.push({ session, entered: state === "needs_input" });
  }
  for (const [id, was] of previous) {
    if (was === "needs_input" && !next.has(id))
      transitions.push({
        session: { id, workspaceId: "", command: "" },
        entered: false,
      });
  }
  return { next, transitions };
}

/**
 * Session label mirroring the renderer's `sessionLabel`: the harness
 * display name when the command matches a known harness executable, else
 * the command basename. Main cannot call the renderer helper (separate
 * bundle), so the small mapping lives here.
 */
export function sessionLabelFor(command: string): string {
  const base = command.split(/[\\/]/).at(-1) ?? "";
  switch (base) {
    case "claude":
      return "Claude Code";
    case "pi":
      return "Pi";
    case "opencode":
      return "OpenCode";
    case "agy":
      return "Antigravity";
    default:
      return base || "Terminal";
  }
}

/** Last path segment of a workspace path (`/repo/wt-1` -> `wt-1`). */
export function worktreeNameFor(workspacePath: string): string {
  const base = workspacePath.split(/[\\/]/).filter(Boolean).at(-1);
  return base || workspacePath;
}

/** `"<label> needs your input"` + `"in <worktree>"` (title/body split). */
export function formatNeedsInput(
  session: WatchedSession,
  workspacePath: string | null,
): { title: string; body: string } {
  return {
    title: `${sessionLabelFor(session.command)} needs your input`,
    body: `in ${workspacePath ? worktreeNameFor(workspacePath) : "the workspace"}`,
  };
}
