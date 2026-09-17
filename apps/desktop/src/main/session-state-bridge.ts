// R16-BF2 push: daemon `session.events.poll` long-poll → `ui:session-state-changed`
// forward. The renderer's worktree card and tab badge used to learn about
// session/agent-state changes on the notifications watcher's 2 s
// `session.list` poll (R16-BF measured ~1.3 s median for
// `update:worktree-card`); the daemon now sequences every state change
// (hook wait/clear, PTY activity, admission, exit) into an in-memory log
// (`crates/drogon-core/src/session_events.rs`) and this loop forwards each
// one over the existing state-changed IPC channel — the same channel the
// renderer already merges, so the card and badge react within a frame or two
// like the fork (hook event → main → IPC event → store update). The 2 s poll
// stays untouched as the reconciliation fallback (idle decay, missed
// wakeups); native `needs_input` banners stay with it too, so this loop
// never notifies and can never double-banner.
import { randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import { z } from "zod";
import {
  notificationsIpcChannels,
  sessionStateChangedSchema,
} from "../shared/notifications-contract";
import type { Result } from "../shared/session-contract";
import { callNativeHold } from "./native-client";

/** Long-poll hold per round trip; under the socket deadline below. */
const POLL_WAIT_MS = 20_000;
const POLL_CALL_TIMEOUT_MS = 25_000;
/** An old daemon without the push RPC: back off slow, the 2 s poll covers us. */
const LEGACY_DAEMON_RETRY_MS = 5_000;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 15_000;

const pushedEventSchema = sessionStateChangedSchema.extend({
  seq: z.number().int().nonnegative(),
});

const pollResultSchema = z.object({
  bootId: z.string(),
  events: z.array(pushedEventSchema),
  nextSeq: z.number().int().nonnegative(),
});

export type PushedSessionEvent = z.infer<typeof pushedEventSchema>;

export type SessionDaemonCall = (
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
) => Promise<Result<unknown>>;

/**
 * PERF-05 push fan-out: the loop below already dedupes every pushed event;
 * these additive subscribers let the notifications and awake-auto watchers
 * consume the same deduped push as their primary source instead of each
 * running their own 2 s `session.list` walk (those walks stay as the
 * reconciliation fallback). A throwing subscriber never breaks the loop or
 * the renderer forward. `index.ts` needs no change: each watcher subscribes
 * itself on creation and unsubscribes on stop.
 */
export type SessionPushListener = (event: PushedSessionEvent) => void;

const pushListeners = new Set<SessionPushListener>();

export function subscribeSessionPush(
  listener: SessionPushListener,
): () => void {
  pushListeners.add(listener);
  return () => {
    pushListeners.delete(listener);
  };
}

/** Test seam: drop every push subscriber between isolated tests. */
export function resetSessionPushListenersForTests(): void {
  pushListeners.clear();
}

function fanOutPush(event: PushedSessionEvent): void {
  for (const listener of [...pushListeners]) {
    try {
      listener(event);
    } catch {
      // One consumer's bug must never starve the loop or the renderer.
    }
  }
}

/** One framed-JSON round trip to the local daemon over a dedicated
 * one-shot connection (never the pool: a hold would head-of-line-block
 * every short call sharing its entry). Same reason `callNative` is
 * unusable here: the shared `resultSchemas` map has no
 * `session.events.poll` entry, and the pool is for short calls only.
 * Delegates to the lifted `callNativeHold` primitive (same framing, same
 * envelope validation, same `unverifiable` verdict family); the payload
 * contract below is unchanged. */
export function callSessionDaemon(
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
  requestId: string = randomUUID(),
): Promise<Result<unknown>> {
  // The singleton state loop bypasses the output-hold cap (grandfathered
  // at exactly one by the `active` guard in `startSessionStatePush`).
  return callNativeHold(method, params, timeoutMs, false, requestId);
}

/**
 * Pure forward dedupe for one pushed event: forwards the first sighting and
 * every genuine `(state, stamp)` move, drops steady-state repeats. Ordering
 * across the two main→renderer sources (this push stream and the 2 s
 * `session.list` poll) is the renderer's `applySessionStatePush`
 * (`agentStateAt` compare); this map only keeps the stream itself quiet.
 */
type ForwardedSession = { state: string; at: string | null } &
  Pick<PushedSessionEvent, "agentPromptPreview" | "cacheIdleAt">;

export function shouldForwardSessionEvent(
  forwarded: ReadonlyMap<string, ForwardedSession>,
  event: PushedSessionEvent,
): boolean {
  const prev = forwarded.get(event.sessionId);
  if (!prev) return true;
  return prev.state !== event.agentState || prev.at !== event.agentStateAt ||
    prev.agentPromptPreview !== event.agentPromptPreview || prev.cacheIdleAt !== event.cacheIdleAt;
}

/** Exponential reconnect backoff, capped; exported so tests pin the curve. */
export function nextBackoff(currentMs: number): number {
  return Math.min(currentMs * 2, MAX_BACKOFF_MS);
}

export function baseBackoffMs(): number {
  return BASE_BACKOFF_MS;
}

export type SessionStatePushDeps = {
  getWindow: () => BrowserWindow | null;
  /** Additive consumers (native notifications) observe the same deduped push
   * event that updates the renderer, avoiding a second polling source. */
  onEvent?: (event: PushedSessionEvent) => void;
  call?: SessionDaemonCall;
  log?: (message: string) => void;
  /** Test seam: bound the loop to a fixed number of poll rounds. */
  maxRounds?: number;
};

/**
 * Starts the single app-wide session-state push loop: long-poll
 * `session.events.poll`, forward each new event over
 * `ui:session-state-changed`, resync from zero when the daemon's boot id
 * moves (a restart resets its sequence). Returns a stop function for tests;
 * the app itself never stops it. A second call while one loop runs is a
 * no-op returning a no-op stop.
 */
let active = false;

export function startSessionStatePush(deps: SessionStatePushDeps): () => void {
  if (active) return () => {};
  active = true;
  let stopped = false;
  const call = deps.call ?? callSessionDaemon;
  const log = deps.log ?? ((message: string) => console.log(message));
  const forwarded = new Map<string, ForwardedSession>();
  let afterSeq = 0;
  let bootId: string | null = null;
  let rounds = 0;
  void (async () => {
    let backoff = BASE_BACKOFF_MS;
    try {
      while (!stopped) {
        if (deps.maxRounds !== undefined && rounds >= deps.maxRounds) return;
        rounds += 1;
        let polled: Result<unknown>;
        try {
          polled = await call(
            "session.events.poll",
            { afterSeq, waitMs: POLL_WAIT_MS },
            POLL_CALL_TIMEOUT_MS,
          );
        } catch {
          await new Promise((resolve) => setTimeout(resolve, backoff));
          backoff = nextBackoff(backoff);
          continue;
        }
        if (!polled.ok) {
          // An old daemon predates the push RPC: retry slow, the 2 s
          // `session.list` poll remains the live path there.
          if (polled.error.code === "method_not_found") {
            log("[drogon] session push unavailable (old daemon); polling covers state");
            await new Promise((resolve) => setTimeout(resolve, LEGACY_DAEMON_RETRY_MS));
            continue;
          }
          await new Promise((resolve) => setTimeout(resolve, backoff));
          backoff = nextBackoff(backoff);
          continue;
        }
        backoff = BASE_BACKOFF_MS;
        const parsed = pollResultSchema.safeParse(polled.result);
        if (!parsed.success) {
          log("[drogon] session push answer does not match the contract.");
          continue;
        }
        // A moved boot id means the daemon restarted and its sequence with
        // it: this round polled a stale cursor against the new log, so drain
        // the new log from zero next round instead of adopting this round's
        // cursor (which would skip everything the new boot logged below the
        // old cursor). The forward map stays: it dedupes the re-drain down
        // to genuine moves.
        if (bootId !== null && parsed.data.bootId !== bootId) afterSeq = 0;
        else afterSeq = parsed.data.nextSeq;
        bootId = parsed.data.bootId;
        for (const event of parsed.data.events) {
          if (!shouldForwardSessionEvent(forwarded, event)) continue;
          forwarded.set(event.sessionId, {
            state: event.agentState,
            at: event.agentStateAt,
            agentPromptPreview: event.agentPromptPreview,
            cacheIdleAt: event.cacheIdleAt,
          });
          deps.onEvent?.(event);
          fanOutPush(event);
          const window = deps.getWindow();
          if (window && !window.isDestroyed())
            window.webContents.send(notificationsIpcChannels.stateChanged, {
              sessionId: event.sessionId,
              workspaceId: event.workspaceId,
              agentState: event.agentState,
              agentStateAt: event.agentStateAt,
              ...(event.agentPromptPreview !== undefined ? { agentPromptPreview: event.agentPromptPreview } : {}),
              ...(event.cacheIdleAt !== undefined ? { cacheIdleAt: event.cacheIdleAt } : {}),
            });
        }
      }
    } finally {
      active = false;
    }
  })();
  return () => {
    stopped = true;
  };
}

/** Test seam: release the singleton guard between isolated tests. */
export function resetSessionStatePushForTests(): void {
  active = false;
}
