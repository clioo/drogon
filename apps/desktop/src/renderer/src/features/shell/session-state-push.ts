// MIT Copyright (c) 2026 Lovecast Inc.
// R16-BF2: applies one pushed session-state change to the visible rows —
// the fork's push-to-card/badge semantics over this build's row projection.
import type {
  AgentState,
  Session,
} from "../../../../shared/session-contract";

/**
 * One pushed session-state change as forwarded by main's push loop
 * (`session-state-bridge.ts`) over `ui:session-state-changed` — the same
 * event shape the 2 s `session.list` poller already sends, so both sources
 * merge through this one function.
 */
export type PushedSessionState = {
  sessionId: string;
  workspaceId: string;
  agentState: AgentState;
  agentStateAt: string | null;
  agentPromptPreview?: string | null;
  cacheIdleAt?: string | null;
};

export type SessionStatePushOutcome =
  | { applied: true; unknown: false; sessions: Session[] }
  | { applied: false; unknown: boolean; sessions: Session[] };

/**
 * Applies one pushed session-state change to the visible rows (R16-BF2).
 * Same-input idempotent and out-of-order safe:
 * - an unknown session id is reported (`unknown: true`) so the caller
 *   refetches once instead of inventing a row;
 * - an identical `(state, stamp)` is a duplicate and applied to nothing;
 * - an older stamp over a newer one is stale and dropped — except when the
 *   row currently waits for input: the daemon clock is second-resolution,
 *   so a sub-second wait→clear pair shares one stamp and the clear (which
 *   derives its stamp from older activity) must still win;
 * - `exited` always applies: it is terminal truth for the incarnation, and
 *   a newer live stamp afterwards (a restart reusing the id) applies on top
 *   by the same rules.
 * Returns the input array by reference when nothing changed so callers can
 * skip their state update.
 */
export function applySessionStatePush(
  items: Session[],
  event: PushedSessionState,
): SessionStatePushOutcome {
  const index = items.findIndex((item) => item.id === event.sessionId);
  if (index === -1) return { applied: false, unknown: true, sessions: items };
  const current = items[index]!;
  const state = current.agentState ?? "unknown";
  const at = current.agentStateAt ?? null;
  const metadata = {
    ...(event.agentPromptPreview !== undefined ? { agentPromptPreview: event.agentPromptPreview } : {}),
    ...(event.cacheIdleAt !== undefined ? { cacheIdleAt: event.cacheIdleAt } : {}),
  };
  const metadataChanged = Object.entries(metadata).some(
    ([key, value]) => current[key as keyof Session] !== value,
  );
  if (state === event.agentState && at === event.agentStateAt && !metadataChanged)
    return { applied: false, unknown: false, sessions: items };
  if (
    at !== null &&
    event.agentStateAt !== null &&
    event.agentStateAt < at &&
    state !== "needs_input"
  )
    return { applied: false, unknown: false, sessions: items };
  const next = items.slice();
  next[index] = {
    ...current,
    ...metadata,
    agentState: event.agentState,
    agentStateAt: event.agentStateAt,
  };
  return { applied: true, unknown: false, sessions: next };
}
