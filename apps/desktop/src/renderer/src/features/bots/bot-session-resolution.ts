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
//
// An `unverifiable` verdict is NOT focusable either. The daemon derives it
// from the DURABLE session row: a session it currently holds a running child
// for always reports `live` (`session::current_verdict` reads the handle's
// own exit code). So `unverifiable` positively means this daemon instance has
// no child for that id -- typically a row recovered after a daemon restart or
// an app upgrade. Focusing such a row opened a blank terminal, could never
// produce output (`session.read` has no handle to read) and could never be
// stopped (`session.stop` had nothing to kill), which is exactly the owner's
// "la sesión no inicia / el botón de stop no funciona" report. The honest
// response is `reopen`: start a session that resumes the harness's own prior
// conversation. The liveness rule still holds -- reopening never rewrites
// loss of contact as `exited`.
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

  // The harness-reported provider conversation the record latched comes
  // FIRST. A reopen that names THAT conversation is safe no matter what
  // else is stale: the worst case is the same conversation coming back
  // (never two live processes on different conversations), and it is the
  // bot-record-alone recovery -- the durable row can be gone entirely
  // (closed, or a daemon restart) with the record as the only source.
  if (recorded.agentSessionId) {
    return {
      kind: "reopen",
      sessionId: recorded.sessionId,
      harnessId: recordedHarnessId(recorded),
      resumeByIdentity: "bot-record",
    };
  }

  // Next: the daemon's POSITIVE "the recorded link is gone" fact -- before
  // any renderer-side session copy. A stale local copy (a tab-strip entry,
  // a host-wide poll cached across a daemon restart) can still name the
  // recorded session with verdict exited/unverifiable and would shadow the
  // phantom into a `reopen` whose "will reopen its most recent
  // conversation" notice describes an intention -- the daemon has already
  // positively resolved the link to NOTHING and the record latched NO
  // conversation, so there is nothing to name: the honest answer is the
  // fresh open plus the gone-session notice. Liveness stays owned by the
  // host: when the daemon could NOT resolve the link (older build, snapshot
  // pending), `recordedSessionMissing` is absent and every rule below
  // stands unchanged.
  if (recorded.recordedSessionMissing) {
    return {
      kind: "open",
      notice:
        "This Bot's previous session is gone -- Drogon has no record of it anymore, so there is nothing to reopen. Starting a new conversation.",
    };
  }

  const observed = input.observed;
  if (observed) {
    if (observed.verdict === "exited" || observed.verdict === "unverifiable") {
      return {
        kind: "reopen",
        sessionId: observed.id,
        harnessId: observed.harnessId ?? recordedHarnessId(recorded),
        // The daemon reads the provider id off the session row this names.
        resumeByIdentity:
          observed.agentSessionId || recorded.agentSessionId ? "session" : null,
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
  // the record. `exited` is a positive exit observation; `unverifiable` is
  // the daemon stating it holds no running child for the id (see the module
  // comment) -- both are `reopen`, and neither is proof of exit.
  const verdict = recorded.verdict;
  if (verdict === "exited" || verdict === "unverifiable") {
    return {
      kind: "reopen",
      sessionId: recorded.sessionId,
      harnessId: recordedHarnessId(recorded),
      resumeByIdentity: recorded.agentSessionId ? "bot-record" : null,
    };
  }
  if (verdict === "live") {
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
  // A recorded link with no projected verdict (an older daemon build, or
  // -- the dead end this closes -- a Drogon session row that no longer
  // exists because the user closed that tab).
  //
  // The duplicate-prevention instinct is kept: a record whose liveness is
  // not established must never silently open a SECOND session. Without a
  // latched provider conversation and without a daemon-positive missing
  // fact, there is nothing to name and nothing positively gone, so the
  // refusal stands.
  // No projection at all (an older daemon build): the daemon COULD still
  // hold a live session this renderer cannot see, so the conservative
  // refusal stands -- but it must name a control that actually works (the
  // card's "New session" button), never a refresh that cannot change the
  // answer.
  return { kind: "unknown" };
}
