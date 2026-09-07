import { spawn } from "node:child_process";
import type { LocalEndpointObservation } from "./native-client";
import type { Result, Status } from "../shared/session-contract";

/**
 * Pure decision core: every effect (status check, endpoint probe, binary
 * existence, spawn, sleep) is injected, so every branch below is directly
 * unit-testable without a real socket, filesystem, or child process.
 * `index.ts` wires the real Node/Electron effects; this module only decides
 * what to do with their results.
 */
export type BootstrapDeps = {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  binaryExists(): boolean;
  /** A full authenticated round-trip; its own signal is honored so a blown deadline can free the socket instead of leaking it. */
  checkStatus(signal: AbortSignal): Promise<Result<Status>>;
  /** Local-only liveness classification, independent of the auth token — see `native-client.ts`'s `observeLocalEndpoint`. */
  observeLocalEndpoint(signal: AbortSignal): Promise<LocalEndpointObservation>;
  /**
   * A real child process reports "failed to start" (ENOENT, EACCES) as an
   * async `error` event, not a synchronous throw — so this returns a
   * promise that rejects on that event. A synchronous throw here is still
   * treated as a failed spawn too, never an unhandled crash.
   */
  spawnDaemon(): Promise<void>;
  sleep(ms: number): Promise<void>;
  pollIntervalMs: number;
  /** One budget for the *entire* bootstrap: initial observation, the spawn decision, and readiness polling all draw from it — not a separate clock each. */
  deadlineMs: number;
};

export type BootstrapOutcome =
  | { kind: "not-packaged" }
  | { kind: "already-healthy" }
  | { kind: "unsupported-platform" }
  | { kind: "answered-but-not-ok"; code: string }
  | { kind: "observation-timed-out" }
  | { kind: "observation-failed"; message: string }
  | { kind: "endpoint-present-not-spawning" }
  | { kind: "endpoint-ambiguous-not-spawning"; reason: string }
  | { kind: "binary-check-failed"; message: string }
  | { kind: "binary-missing" }
  | { kind: "spawn-failed"; message: string }
  | { kind: "spawn-timed-out" }
  | { kind: "spawned-then-healthy" }
  | { kind: "spawned-then-timed-out" };

/**
 * A raced call settles exactly one of three ways, kept distinct rather than
 * collapsed: `"value"` (the dependency answered in time), `"timed-out"`
 * (the budget ran out before it answered — true even if it later would
 * have), and `"failed"` (it rejected, or threw synchronously instead of
 * returning a promise, before any deadline elapsed). Folding `"failed"`
 * into `"timed-out"` would report a real dependency failure as if the
 * clock had simply run out, which it had not.
 */
type Raced<T> =
  | { kind: "value"; value: T }
  | { kind: "timed-out" }
  | { kind: "failed"; error: unknown };

/**
 * The one timer/race every bounded call in this module goes through.
 * `run` is invoked (and only invoked) inside a `try` here, never
 * pre-evaluated by a caller, so a synchronous throw is routed through
 * `"failed"` exactly like an async rejection — never an uncaught exception
 * that would abort bootstrap before `createWindow()` runs. Callers that
 * pass no real cancellation-capable adapter (spawnDaemon/sleep) simply
 * ignore the signal; `abort()` on timeout is then a no-op for them, never
 * an unsafe kill.
 */
function race<T>(
  run: (signal: AbortSignal) => Promise<T>,
  remainingMs: number,
): Promise<Raced<T>> {
  if (remainingMs <= 0) return Promise.resolve({ kind: "timed-out" });
  const controller = new AbortController();
  return new Promise((resolve) => {
    let settled = false;
    const onSettle = (outcome: Raced<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Only ever frees a real socket-based adapter; spawnDaemon/sleep
      // adapters don't accept a signal in the first place, so this abort
      // has nothing to reach for them — never a kill, just a "stop
      // listening for their answer."
      controller.abort();
      resolve({ kind: "timed-out" });
    }, remainingMs);
    try {
      run(controller.signal).then(
        (value) => onSettle({ kind: "value", value }),
        (error) => onSettle({ kind: "failed", error }),
      );
    } catch (error) {
      onSettle({ kind: "failed", error });
    }
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Attaches to an already-healthy service, or attempts the bundled daemon
 * exactly once. Never force-kills, removes a socket, or replaces a live
 * incumbent — `drogond`'s own endpoint lock decides ownership. A bare
 * `unverifiable` status is not positive evidence of absence (it also covers
 * a bad auth token or a connect timeout against a live daemon); only
 * `observeLocalEndpoint`'s `"absent"` authorizes a spawn. A dependency
 * *failure* (reject/throw) never authorizes one either — it's its own
 * distinct outcome, never spawned over, never retried.
 */
export async function bootstrapNativeRuntime(
  deps: BootstrapDeps,
): Promise<BootstrapOutcome> {
  // Development relies on a manually-started drogond; spawning one here
  // would mean every `pnpm dev` silently manages a background daemon no one
  // asked for, and packaged/dev would diverge from what's actually running.
  if (!deps.isPackaged) return { kind: "not-packaged" };

  const deadlineAt = Date.now() + deps.deadlineMs;
  const remaining = () => deadlineAt - Date.now();

  const initial = await race(deps.checkStatus, remaining());
  if (initial.kind === "timed-out") return { kind: "observation-timed-out" };
  if (initial.kind === "failed")
    return { kind: "observation-failed", message: messageOf(initial.error) };
  if (initial.value.ok) return { kind: "already-healthy" };
  // Anything other than "nothing answered" means a connection *was* made —
  // some process already owns this endpoint, just not answering as expected
  // (wrong token, malformed reply). Spawning a second daemon against an
  // endpoint something is already listening on is exactly the ownership
  // race this bootstrap must never risk; only silence is "try starting one."
  if (initial.value.error.code !== "unverifiable")
    return { kind: "answered-but-not-ok", code: initial.value.error.code };

  // `drogond` has no Windows named-pipe implementation; spawning it there
  // would only fail, and the attempt itself is the thing this task forbids.
  if (deps.platform === "win32") return { kind: "unsupported-platform" };

  const observation = await race(deps.observeLocalEndpoint, remaining());
  if (observation.kind === "timed-out")
    return { kind: "observation-timed-out" };
  if (observation.kind === "failed")
    return {
      kind: "observation-failed",
      message: messageOf(observation.error),
    };
  if (observation.value.kind === "present")
    return { kind: "endpoint-present-not-spawning" };
  if (observation.value.kind === "ambiguous")
    return {
      kind: "endpoint-ambiguous-not-spawning",
      reason: observation.value.reason,
    };

  let binaryExists: boolean;
  try {
    binaryExists = deps.binaryExists();
  } catch (error) {
    return { kind: "binary-check-failed", message: messageOf(error) };
  }
  if (!binaryExists) return { kind: "binary-missing" };
  if (remaining() <= 0) return { kind: "observation-timed-out" };

  // Spawned exactly once, never retried: a real process may already exist
  // by the time this stops waiting, so timeout here means "give up
  // waiting," never "kill and retry."
  const spawned = await race((_signal) => deps.spawnDaemon(), remaining());
  if (spawned.kind === "timed-out") return { kind: "spawn-timed-out" };
  if (spawned.kind === "failed")
    return { kind: "spawn-failed", message: messageOf(spawned.error) };

  // Each poll and each sleep is bounded by the same remaining budget via
  // `race` — a poll failure is treated like "not yet answered" (the daemon
  // is already spawned; a transient failure doesn't undo that), and a
  // `sleep` that hangs or throws can't extend the wait past the deadline.
  while (remaining() > 0) {
    const check = await race(deps.checkStatus, remaining());
    if (check.kind === "value" && check.value.ok)
      return { kind: "spawned-then-healthy" };
    if (remaining() <= 0) break;
    await race(
      (_signal) => deps.sleep(Math.min(deps.pollIntervalMs, remaining())),
      remaining(),
    );
  }
  return { kind: "spawned-then-timed-out" };
}

/**
 * Real launch adapter for the bundled daemon: wraps `child_process.spawn`
 * so a spawn failure (nonexistent binary, permission denied) surfaces as a
 * rejected promise instead of an unhandled async `error` event on a
 * detached, unref'd child no caller is otherwise listening to. Listeners
 * are attached synchronously before `unref()` is called; `unref()` only
 * stops the child's handle from keeping the event loop alive; it does not
 * delay or suppress either event. `spawn`'s own `spawn`/`error` events are
 * the only real signal used — no invented timeout stands in for them.
 */
export function spawnDetachedDaemon(
  binaryPath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
      env,
    });
    child.once("error", reject);
    child.once("spawn", () => resolve());
    // Detached + unref'd: the daemon outlives this process, including on
    // GUI quit. It is never spawned as a child this app would reap.
    child.unref();
  });
}
