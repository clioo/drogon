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
  /** Which harness launched the session (`harness.start`); absent for plain
   * shells. Drives the notification label — never the process basename. */
  harnessId?: string | null;
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
 * Harness display names, mirroring the daemon's `HarnessId::display_name`
 * (and the fork's agent-type labels): the session's `harnessId` names the
 * label, never the process basename — a Pi session launched through a
 * bundle path reports `pi`, not `cli.js`.
 */
const HARNESS_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  claude: "Claude Code",
  pi: "Pi",
  opencode: "OpenCode",
  antigravity: "Antigravity",
};

/**
 * Session label for the notification title: the harness display name when
 * the session carries a known `harnessId`, else the command basename when
 * it matches a known harness executable, else the raw basename. Main cannot
 * call the renderer's `sessionLabel` (separate bundle), so the small mapping
 * lives here.
 */
export function sessionLabelFor(
  command: string,
  harnessId?: string | null,
): string {
  if (harnessId && HARNESS_DISPLAY_NAMES[harnessId])
    return HARNESS_DISPLAY_NAMES[harnessId];
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

/**
 * Fork copy (`notification-options.ts` `buildAgentTaskComplete...` with a
 * `blocked`/`waiting` snapshot): `"<workspace> - <label> needs input"` +
 * `"<label> needs input."`. The fork's rich body (last assistant message /
 * tool preview) has no equivalent here — `session.list` carries no message
 * content — so the fallback body always applies.
 */
export function formatNeedsInput(
  session: WatchedSession,
  workspaceName: string | null,
): { title: string; body: string } {
  const label = sessionLabelFor(session.command, session.harnessId);
  const context = workspaceName || "workspace";
  return {
    title: `${context} - ${label} needs input`,
    body: `${label} needs input.`,
  };
}
