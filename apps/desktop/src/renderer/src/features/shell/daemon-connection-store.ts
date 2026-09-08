// Refcounted daemon-connection monitor: one retry ladder for the whole
// renderer, shared by the app banner, the status-bar segment and the
// terminal panes through useSyncExternalStore. There is no daemon push
// channel (main only forwards polls), so reachability is a `status()` probe
// on the fork's retry ladder; loss of contact flips sessions to
// `unverifiable` at the panes, never to `exited`.
import { useSyncExternalStore } from "react";
import {
  DAEMON_HEARTBEAT_INTERVAL_MS,
  daemonReconnectDelay,
  type DaemonConnectionState,
} from "./daemon-connection";

export type DaemonConnectionSnapshot = {
  state: DaemonConnectionState;
  /** 0-based ladder position of the scheduled retry; 0 while connected. */
  attempt: number;
  /** Short reason from the last failed probe, if any. */
  lastError: string | null;
  /** Wall-clock ms of the last successful probe, if any. */
  lastConnectedAt: number | null;
};

export type DaemonConnectionProbe = {
  /** Null when the daemon answered; otherwise a short reason. */
  probe: () => Promise<string | null>;
  now?: () => number;
  random?: () => number;
};

const INITIAL_SNAPSHOT: DaemonConnectionSnapshot = {
  state: "checking",
  attempt: 0,
  lastError: null,
  lastConnectedAt: null,
};

function defaultProbe(): Promise<string | null> {
  try {
    const status = (window as unknown as { drogon?: unknown }).drogon as
      | {
          status?: () => Promise<
            | { ok: true }
            | { ok: false; error: { message: string } }
          >;
        }
      | undefined;
    if (!status || typeof status.status !== "function")
      return Promise.resolve("Drogon bridge unavailable");
    return status
      .status()
      .then((result) =>
        result.ok ? null : result.error.message || "Service unreachable",
      )
      .catch((failure: unknown) =>
        failure instanceof Error ? failure.message : "Service unreachable",
      );
  } catch (failure: unknown) {
    return Promise.resolve(
      failure instanceof Error ? failure.message : "Service unreachable",
    );
  }
}

let snapshot: DaemonConnectionSnapshot = { ...INITIAL_SNAPSHOT };
const listeners = new Set<() => void>();
let owners = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
/** A probe is in flight; the heartbeat tick skips while this holds. */
let probing = false;
/**
 * Consecutive failed probes. The wait caps at the ladder's last step and
 * repeats there indefinitely — the monitor never gives up (web-transport
 * semantics), so a service restart minutes later still reconnects alone.
 */
let failedStreak = 0;
let deps: Required<Pick<DaemonConnectionProbe, "now" | "random">> &
  Pick<DaemonConnectionProbe, "probe"> = {
  probe: defaultProbe,
  now: () => Date.now(),
  random: () => Math.random(),
};

function emit(next: DaemonConnectionSnapshot): void {
  snapshot = next;
  for (const listener of [...listeners]) listener();
}

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

async function runProbe(owner: number): Promise<void> {
  let reason: string | null;
  try {
    reason = await deps.probe();
  } catch (failure: unknown) {
    reason =
      failure instanceof Error && failure.message
        ? failure.message.slice(0, 300)
        : "Service unreachable";
  }
  if (owner !== generation) return;
  probing = false;
  if (reason === null) {
    failedStreak = 0;
    emit({
      state: "connected",
      attempt: 0,
      lastError: null,
      lastConnectedAt: deps.now(),
    });
    // Steady-state heartbeat: a connected monitor keeps proving it, since
    // nothing pushes a daemon death to the renderer.
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (owner === generation && !probing) {
        probing = true;
        void runProbe(owner);
      }
    }, DAEMON_HEARTBEAT_INTERVAL_MS);
    return;
  }
  const attempt = failedStreak;
  failedStreak += 1;
  emit({
    state: "reconnecting",
    attempt,
    lastError: reason,
    lastConnectedAt: snapshot.lastConnectedAt,
  });
  clearTimer();
  timer = setTimeout(
    () => {
      timer = null;
      void runProbe(owner);
    },
    daemonReconnectDelay(attempt, deps.random),
  );
}

function startLocked(): void {
  generation += 1;
  const owner = generation;
  clearTimer();
  emit({ ...snapshot, state: "checking", attempt: 0 });
  probing = true;
  void runProbe(owner);
}

/**
 * Starts the monitor on first owner, no-ops for nested owners. Every owner
 * (banner, status segment) calls this in an effect and releases on unmount;
 * the loop only idles when no connection surface is mounted.
 */
export function ensureDaemonConnectionMonitor(
  overrides?: DaemonConnectionProbe,
): () => void {
  if (owners === 0 && overrides) {
    deps = {
      probe: overrides.probe,
      now: overrides.now ?? (() => Date.now()),
      random: overrides.random ?? (() => Math.random()),
    };
  }
  owners += 1;
  if (owners === 1) startLocked();
  return () => {
    owners = Math.max(0, owners - 1);
    if (owners === 0) {
      generation += 1;
      clearTimer();
    }
  };
}

/**
 * Manual retry (toast action, Reconnect buttons): restarts the ladder from
 * the head step and probes immediately instead of waiting out the backoff.
 */
export function retryDaemonConnectionNow(): void {
  if (owners === 0) return;
  failedStreak = 0;
  generation += 1;
  const owner = generation;
  clearTimer();
  emit({ ...snapshot, state: "checking", attempt: 0 });
  probing = true;
  void runProbe(owner);
}

export function getDaemonConnectionSnapshot(): DaemonConnectionSnapshot {
  return snapshot;
}

export function subscribeDaemonConnection(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDaemonConnection(): DaemonConnectionSnapshot {
  return useSyncExternalStore(
    subscribeDaemonConnection,
    getDaemonConnectionSnapshot,
    getDaemonConnectionSnapshot,
  );
}

/** Test-only: drops owners, timers and retry state between cases. */
export function __resetDaemonConnectionMonitorForTests(): void {
  generation += 1;
  clearTimer();
  probing = false;
  failedStreak = 0;
  owners = 0;
  listeners.clear();
  deps = {
    probe: defaultProbe,
    now: () => Date.now(),
    random: () => Math.random(),
  };
  snapshot = { ...INITIAL_SNAPSHOT };
}
