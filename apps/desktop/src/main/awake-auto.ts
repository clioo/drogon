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
import { subscribeSessionPush } from "./session-state-bridge";

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

/** Minimal push shape; the bridge's deduped event satisfies it structurally. */
export type AwakePushEvent = {
  sessionId: string;
  agentState?: string;
};

/**
 * Polls session.list while auto is selected and reports only transitions
 * (working → idle and back), so the controller is never asked to re-arm from
 * stale data. A failed poll keeps the previous verdict — the next tick diffs
 * against it, so no transition is lost.
 *
 * PERF-05: the session-state push feed is the primary source —
 * `observePush` reports working/idle moves with zero daemon I/O and the
 * 2 s `tick` stays as the authoritative reconciliation fallback (it alone
 * sees sessions the push never mentioned and notices vanished ones).
 */
export function createAwakeAutoWatcher(deps: AwakeAutoWatcherDeps): {
  tick: () => Promise<void>;
  stop: () => void;
  observePush: (event: AwakePushEvent) => void;
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
  // Union of both sources: the fallback poll snapshots `pollStates`, pushes
  // land in `pushStates` with arrival sequence numbers (a counter, not the
  // wall clock — a whole poll round routinely fits inside one millisecond).
  // A push wins for a session only while it arrived after the last poll
  // started; anything the poll no longer lists and no fresh push re-asserts
  // reads as gone.
  let pollStates = new Map<string, string>();
  let pushStates = new Map<string, { state: string; seq: number }>();
  let pushSeq = 0;
  let lastTickSeq = 0;

  function effectiveWorking(): boolean {
    const ids = new Set([...pollStates.keys(), ...pushStates.keys()]);
    for (const id of ids) {
      const push = pushStates.get(id);
      const poll = pollStates.get(id);
      let state: string | undefined;
      if (poll !== undefined)
        state = push && push.seq > lastTickSeq ? push.state : poll;
      else if (push && push.seq > lastTickSeq) state = push.state;
      else continue;
      if (state === "working") return true;
    }
    return false;
  }

  function report(working: boolean): void {
    if (working !== lastReport) {
      lastReport = working;
      deps.setAgentWorking(working);
    }
  }

  function observePush(event: AwakePushEvent): void {
    if (!deps.isAuto()) {
      // Same forget-on-leave as the tick path below.
      lastReport = null;
      return;
    }
    pushSeq += 1;
    pushStates.set(event.sessionId, {
      state: event.agentState ?? "unknown",
      seq: pushSeq,
    });
    report(effectiveWorking());
  }

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
      // The snapshot reflects daemon state somewhere inside this await; a
      // push that lands during or after it is fresher and must survive.
      const tickSeq = pushSeq;
      const snapshot = await listSessions();
      pollStates = new Map(
        snapshot.map((session) => [
          session.id,
          session.agentState ?? "unknown",
        ]),
      );
      lastTickSeq = tickSeq;
      // Pushes older than this poll are superseded everywhere now.
      for (const [id, push] of pushStates) {
        if (push.seq <= lastTickSeq) pushStates.delete(id);
      }
      report(effectiveWorking());
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
  // PERF-05: primary source is the push feed (zero daemon I/O per event);
  // the interval above stays as the reconciliation fallback.
  const unsubscribePush = subscribeSessionPush((event) =>
    observePush({
      sessionId: event.sessionId,
      agentState: event.agentState,
    }),
  );
  return {
    tick,
    observePush,
    stop: () => {
      unsubscribePush();
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
