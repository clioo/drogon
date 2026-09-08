// MIT Copyright (c) 2026 Lovecast Inc.
// Awake Auto mode (R16-AY2), fork semantics from
//   src/renderer/src/components/status-bar/CaffeinateStatusSegment.tsx
//     ("Stay awake while an agent is working") and
//   src/shared/computer-awake-mode.ts (on/auto/off).
// Watches the daemon's session list and feeds working/idle transitions to the
// AwakeController, so `caffeinate` runs exactly while an agent session is
// working and is released on idle and app quit. Electron-free: the poll/diff
// core is unit-testable without a window (same adapter posture as the
// notifications watcher).
import { callNative } from "./native-client";

export type WatchedSession = {
  id: string;
  agentState?: string;
};

/**
 * Defensive row parse for session.list (per-record isolation like the
 * notifications watcher): a malformed record never fails the whole poll.
 */
export function asWatchedSessions(value: unknown): WatchedSession[] {
  if (typeof value !== "object" || value === null) return [];
  const sessions = (value as { sessions?: unknown }).sessions;
  if (!Array.isArray(sessions)) return [];
  const out: WatchedSession[] = [];
  for (const item of sessions) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string") continue;
    out.push({
      id: row.id,
      agentState: typeof row.agentState === "string" ? row.agentState : undefined,
    });
  }
  return out;
}

/** Fork predicate: "awake while agents are working" — any session working. */
export function anySessionWorking(sessions: readonly WatchedSession[]): boolean {
  return sessions.some((session) => session.agentState === "working");
}

export type AwakeAutoWatcherDeps = {
  /** Daemon session list; injectable for tests. */
  listSessions?: () => Promise<WatchedSession[]>;
  /** True while the user's awake mode is auto (the controller owns it). */
  isAuto: () => boolean;
  /** Delivers the working/idle transition to the AwakeController. */
  setAgentWorking: (working: boolean) => void;
  pollIntervalMs?: number;
};

export const AWAKE_AUTO_POLL_INTERVAL_MS = 2_000;

/**
 * Polls session.list while auto is selected and reports only transitions
 * (working → idle and back), so the controller is never asked to re-arm from
 * stale data. A failed poll keeps the previous verdict — the next tick diffs
 * against it, so no transition is lost.
 */
export function createAwakeAutoWatcher(deps: AwakeAutoWatcherDeps): {
  tick: () => Promise<void>;
  stop: () => void;
} {
  const listSessions =
    deps.listSessions ??
    (async () => {
      const response = await callNative("session.list", {});
      return response.ok ? asWatchedSessions(response.result) : [];
    });
  let lastReport: boolean | null = null;
  let inFlight = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      if (!deps.isAuto()) {
        // Auto left: forget the last report so re-entering auto re-arms from
        // a fresh poll instead of a stale "working".
        lastReport = null;
        return;
      }
      const working = anySessionWorking(await listSessions());
      if (working !== lastReport) {
        lastReport = working;
        deps.setAgentWorking(working);
      }
    } catch {
      // Keep the previous verdict; the next tick retries.
    } finally {
      inFlight = false;
    }
  }

  timer = setInterval(
    () => void tick(),
    deps.pollIntervalMs ?? AWAKE_AUTO_POLL_INTERVAL_MS,
  );
  // An interval alone must never keep the app alive past its windows.
  timer.unref?.();
  return {
    tick,
    stop: () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
