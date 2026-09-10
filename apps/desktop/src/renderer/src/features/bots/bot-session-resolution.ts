// MIT Copyright (c) 2026 Lovecast Inc.
//
// Pure decision for the Bot "Open session" click (Defect 1). The host owns
// liveness, but the renderer must not decide "resume or dispatch a fresh
// session" by searching the SELECTED workspace's session list: a Bot's
// session runs in the Bot's own home workspace, so that lookup misses on the
// first click and the app silently opened a SECOND session ("cuando le doy
// click me abre una segunda sesión"). The daemon now projects the recorded
// link's own workspaceId/incarnation/verdict onto `bot.snapshot`, so the
// decision is workspace-independent and authoritative.
//
// The distinction that fixes the bug is `unknown`: a recorded session whose
// liveness is not established must NEVER fall through to "open a new one".
// `null` used to mean both "no record" and "don't know yet", and the caller
// dispatched on the second meaning.
import type {
  BotSessionResolution,
  BotsPanelBot,
  BotsPanelSession,
} from "../../../../shared/bot-contract";
import type { Session } from "../../../../shared/session-contract";

function recordedHarnessId(recorded: BotsPanelSession): string | null {
  return recorded.harness.length > 0 ? recorded.harness : null;
}

/**
 * Resolve the click against the daemon's own facts.
 *
 * `observed` is the fresh session-list entry for the recorded session when
 * the current view happens to list that workspace (an even fresher verdict
 * than the snapshot's projection); pass `null` otherwise. `hostId` is the
 * live connection's host, used only when projecting a focusable session from
 * the record (the observed entry carries its own host).
 */
export function resolveBotSession(input: {
  bot: BotsPanelBot;
  observed: Session | null;
  hostId: string;
}): BotSessionResolution {
  const recorded = input.bot.currentSession;
  if (!recorded) return { kind: "open" };

  const observed = input.observed;
  if (observed) {
    if (observed.verdict === "exited") {
      return {
        kind: "reopen",
        sessionId: observed.id,
        harnessId: observed.harnessId ?? recordedHarnessId(recorded),
      };
    }
    return {
      kind: "focus",
      session: {
        sessionId: observed.id,
        incarnation: observed.incarnation,
        workspaceId: observed.workspaceId,
        hostId: observed.hostId,
        harnessId: observed.harnessId ?? recordedHarnessId(recorded),
      },
    };
  }

  // Not in the current view's list: fall back to the daemon's projection on
  // the record. `exited` is a positive exit observation; `live`/
  // `unverifiable` are both "not exited" (the rest of the app reattaches to
  // a live/unverifiable tab), and `unverifiable` is never proof of exit.
  const verdict = recorded.verdict;
  if (verdict === "exited") {
    return {
      kind: "reopen",
      sessionId: recorded.sessionId,
      harnessId: recordedHarnessId(recorded),
    };
  }
  if (verdict === "live" || verdict === "unverifiable") {
    if (!recorded.incarnation || !recorded.workspaceId) return { kind: "unknown" };
    return {
      kind: "focus",
      session: {
        sessionId: recorded.sessionId,
        incarnation: recorded.incarnation,
        workspaceId: recorded.workspaceId,
        hostId: input.hostId,
        harnessId: recordedHarnessId(recorded),
      },
    };
  }
  // A recorded link with no projected verdict (an older daemon build, or a
  // snapshot that has not loaded). Refuse honestly; never open a duplicate.
  return { kind: "unknown" };
}
